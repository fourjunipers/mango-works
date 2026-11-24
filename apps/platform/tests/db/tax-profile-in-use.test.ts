/**
 * Stage D6 (20261115000200): a tax profile in use can't be archived.
 *
 * save_tax_profile refuses to archive a profile any product's pricing names
 * (retired products included) and, as before, the shop's default. The two
 * writers that name a profile take its row for share, and the archive takes
 * it for update before it looks, so an archive and such a save never both
 * pass, in either order. Lock order: the product, the price list, the tax
 * profile, the pricing row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/roles";
import {
  closedGate,
  createTenant,
  deleteTenant,
  type Gate,
  GATE_TEST_TIMEOUT,
  GATE_TIMEOUTS,
  GATE_WAIT,
  holding,
  seenWaitingForLock,
  serviceClient,
  sql,
  sqlBackground,
  type TestTenant,
  watch,
} from "./helpers";
import { exactlyOne } from "@mango/db/rows";

// Tests here hold sessions at gates: see GATE_TIMEOUTS in helpers.ts.
vi.setConfig(GATE_TIMEOUTS);

let shop: TestTenant;
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let counter = 0;
const db = (role: Role) => shop.members[role].db;

const thailand = {
  country: "TH",
  currency: "THB",
  locale: "th-TH",
  timezone: "Asia/Bangkok",
};

beforeAll(async () => {
  shop = await createTenant("taxuse", thailand);
}, 120_000);

afterAll(async () => {
  await deleteTenant(shop);
});

async function addProduct(): Promise<string> {
  const { data, error } = await exactlyOne(
    service
      .from("products")
      .insert({
        tenant_id: shop.id,
        name: `Taxed ${tag} ${++counter}`,
        type: "vehicle",
        tracking: "unit",
        vehicle_type: "motorbike",
      })
      .select("id"),
  );
  if (error) throw error;
  return data.id;
}

async function addProfile(): Promise<string> {
  const { data, error } = await db("owner").rpc("save_tax_profile", {
    p_tenant_id: shop.id,
    p_profile: { name: `VAT ${tag} ${++counter}`, rate_bp: 700 } as never,
  });
  if (error) throw error;
  return data as string;
}

const archive = (id: string, archived = true) =>
  db("owner").rpc("save_tax_profile", {
    p_tenant_id: shop.id,
    p_profile: { id, archived } as never,
  });
const useProfile = (productId: string, profileId: string | null) =>
  db("manager").rpc("save_product_pricing", {
    p_product_id: productId,
    p_settings: { tax_profile_id: profileId } as never,
  });
const setDefault = (profileId: string | null) =>
  db("manager").rpc("save_pricing_settings", {
    p_tenant_id: shop.id,
    p_settings: { default_tax_profile_id: profileId } as never,
  });

const archivedAt = async (id: string) =>
  (
    await exactlyOne(
      service.from("tax_profiles").select("archived_at").eq("id", id),
    )
  ).data!.archived_at;

/**
 * A call made as a member in a session that stays open, the call's locks
 * held, until the gate is opened (helpers.ts: no clock, so nothing here
 * depends on how fast the machine is).
 */
function heldAs(role: Role, call: string, marker: string, gate: Gate) {
  const claims = JSON.stringify({
    sub: shop.members[role].id,
    role: "authenticated",
  });
  return sqlBackground(`
    begin;
    select set_config('request.jwt.claims', '${claims}', true);
    set local role authenticated;
    ${call};
    ${gate.wait(marker)}
    commit;
  `);
}

/**
 * Starts `call` while a holder is at its gate, and shows that it waits:
 * it is seen waiting for a lock, it has not answered while the gate is
 * still closed, and it answers once the gate is opened. `name` is the
 * function the call runs, as it appears in pg_stat_activity.
 */
async function waitsForGate<T>(
  gate: Gate,
  name: string,
  call: () => PromiseLike<T>,
): Promise<T> {
  let answered = false;
  // A query builder sends nothing until it is awaited: start it now.
  const running = Promise.resolve(call()).then((result) => {
    answered = true;
    return result;
  });
  await seenWaitingForLock(name);
  expect(answered, `${name} answered before the holder let go`).toBe(false);
  await gate.open();
  return running;
}

const json = (value: object) => `'${JSON.stringify(value)}'::jsonb`;

describe("a tax profile in use", () => {
  it("can't be archived while a product names it, retired products included", async () => {
    const profile = await addProfile();
    const product = await addProduct();
    await useProfile(product, profile).throwOnError();
    const refused = await archive(profile);
    expect(refused.error?.message).toBe("tax_profile_in_use");
    expect(await archivedAt(profile)).toBeNull();

    // A retired product still counts.
    const retired = await addProduct();
    await useProfile(retired, profile).throwOnError();
    await service
      .from("products")
      .update({ retired_at: new Date().toISOString() })
      .eq("id", retired)
      .throwOnError();
    await useProfile(product, null).throwOnError();
    expect((await archive(profile)).error?.message).toBe("tax_profile_in_use");

    // Free of every product: archived.
    await useProfile(retired, null).throwOnError();
    await archive(profile).throwOnError();
    expect(await archivedAt(profile)).not.toBeNull();
  });

  it("still takes a rate change and a rename while in use", async () => {
    const profile = await addProfile();
    const product = await addProduct();
    await useProfile(product, profile).throwOnError();
    await db("owner")
      .rpc("save_tax_profile", {
        p_tenant_id: shop.id,
        p_profile: {
          id: profile,
          rate_bp: 1000,
          name: `VAT10 ${tag}`,
        } as never,
      })
      .throwOnError();
    const row = await exactlyOne(
      service.from("tax_profiles").select("rate_bp, name").eq("id", profile),
    );
    expect(row.data).toEqual({ rate_bp: 1000, name: `VAT10 ${tag}` });
  });

  it("renames an already archived profile that a product still names", async () => {
    // A product can name an archived profile only from before this
    // migration (or a load that skipped the save function): made by hand.
    const profile = await addProfile();
    const product = await addProduct();
    await useProfile(product, profile).throwOnError();
    const { failed } = sql(
      `update platform.tax_profiles set archived_at = now() where id = '${profile}';`,
    );
    expect(failed).toBe("");
    const renamed = await db("owner").rpc("save_tax_profile", {
      p_tenant_id: shop.id,
      p_profile: {
        id: profile,
        name: `Old VAT ${tag}`,
        archived: true,
      } as never,
    });
    expect(renamed.error).toBeNull();
    // Unarchiving and archiving again is the move from null to set: refused.
    await archive(profile, false).throwOnError();
    expect((await archive(profile)).error?.message).toBe("tax_profile_in_use");
    await useProfile(product, null).throwOnError();
  });

  it("is still refused as the shop's default", async () => {
    const profile = await addProfile();
    await setDefault(profile).throwOnError();
    expect((await archive(profile)).error?.message).toBe(
      "tax_profile_is_default",
    );
    await setDefault(null).throwOnError();
    await archive(profile).throwOnError();
  });
});

describe("races: whichever locks the profile first goes first", () => {
  it("archive first, then a product save naming it: the save waits and is refused", async () => {
    const profile = await addProfile();
    const product = await addProduct();
    const marker = `hold-archive-${tag}-${++counter}`;
    const gate = await closedGate();
    const held = heldAs(
      "owner",
      `select platform.save_tax_profile('${shop.id}', ${json({ id: profile, archived: true })})`,
      marker,
      gate,
    );
    await holding(marker);
    const { error } = await waitsForGate(gate, "save_product_pricing", () =>
      useProfile(product, profile),
    );
    expect(error?.message).toBe("invalid_tax_profile");
    expect((await held).failed).toBe("");
    expect(await archivedAt(profile)).not.toBeNull();
  });

  it("a product save first, then the archive: the archive waits and is refused", async () => {
    const profile = await addProfile();
    const product = await addProduct();
    const marker = `hold-use-${tag}-${++counter}`;
    const gate = await closedGate();
    const held = heldAs(
      "manager",
      `select platform.save_product_pricing('${product}', ${json({ tax_profile_id: profile })})`,
      marker,
      gate,
    );
    await holding(marker);
    const { error } = await waitsForGate(gate, "save_tax_profile", () =>
      archive(profile),
    );
    expect(error?.message).toBe("tax_profile_in_use");
    expect((await held).failed).toBe("");
    expect(await archivedAt(profile)).toBeNull();
    await useProfile(product, null).throwOnError();
  });

  it("archive first, then making it the default: refused", async () => {
    const profile = await addProfile();
    const marker = `hold-archive-default-${tag}-${++counter}`;
    const gate = await closedGate();
    const held = heldAs(
      "owner",
      `select platform.save_tax_profile('${shop.id}', ${json({ id: profile, archived: true })})`,
      marker,
      gate,
    );
    await holding(marker);
    const { error } = await waitsForGate(gate, "save_pricing_settings", () =>
      setDefault(profile),
    );
    expect(error?.message).toBe("invalid_tax_profile");
    expect((await held).failed).toBe("");
  });

  it("making it the default first, then the archive: refused", async () => {
    const profile = await addProfile();
    const marker = `hold-default-${tag}-${++counter}`;
    const gate = await closedGate();
    const held = heldAs(
      "manager",
      `select platform.save_pricing_settings('${shop.id}', ${json({ default_tax_profile_id: profile })})`,
      marker,
      gate,
    );
    await holding(marker);
    const { error } = await waitsForGate(gate, "save_tax_profile", () =>
      archive(profile),
    );
    expect(error?.message).toBe("tax_profile_is_default");
    expect((await held).failed).toBe("");
    await setDefault(null).throwOnError();
    expect(await archivedAt(profile)).toBeNull();
  });
});

describe("lock order: the product, the price list, the tax profile, the pricing row", () => {
  it(
    "a product save waiting on the profile holds the product and the list, and no pricing row",
    async () => {
      const profile = await addProfile();
      const product = await addProduct();
      const { data: list, error: listError } = await db("owner").rpc(
        "save_price_template",
        {
          p_tenant_id: shop.id,
          p_template: {
            name: `Order ${tag} ${++counter}`,
            kind: "amounts",
            days: Array.from({ length: 30 }, (_, i) => ({
              day: i + 1,
              value: 30_000 + 1_000 * i,
              source: "manual",
            })),
          } as never,
        },
      );
      if (listError) throw listError;
      const marker = `hold-profile-${tag}-${++counter}`;
      const gate = await closedGate();
      const holder = sqlBackground(`
      begin;
      select 1 from platform.tax_profiles where id = '${profile}' for update;
      ${gate.wait(marker)}
      commit;
    `);
      await holding(marker);
      const saving = db("manager")
        .rpc("save_product_pricing", {
          p_product_id: product,
          p_settings: {
            pricing_method: "tiered",
            price_template_id: list,
            tax_profile_id: profile,
          } as never,
        })
        // A query builder sends nothing until it is awaited: start it now.
        .then((result) => result);
      // The holder keeps the profile until its gate is opened, below.
      await seenWaitingForLock("save_product_pricing");
      const locks = async (relation: string) =>
        (
          await watch(`
        select count(*) from pg_locks l
        join pg_stat_activity a on a.pid = l.pid
        where l.relation = '${relation}'::regclass
          and l.granted
          and a.wait_event_type = 'Lock'
          and a.query not like '%${GATE_WAIT}%'
          and a.pid <> pg_backend_pid();
      `)
        ).out;
      // The waiting save already holds the product's row and the list's row
      // (their tables carry its row-share lock), and nothing on pricing rows.
      expect(Number(await locks("platform.products"))).toBeGreaterThan(0);
      expect(Number(await locks("platform.price_templates"))).toBeGreaterThan(
        0,
      );
      expect(await locks("platform.product_pricing")).toBe("0");
      await gate.open();
      const { error } = await saving;
      expect(error).toBeNull();
      expect((await holder).failed).toBe("");
    },
    GATE_TEST_TIMEOUT,
  );

  it("the archive locks no settings row and no pricing row", async () => {
    const profile = await addProfile();
    const marker = `hold-archive-locks-${tag}-${++counter}`;
    const gate = await closedGate();
    const held = heldAs(
      "owner",
      `select platform.save_tax_profile('${shop.id}', ${json({ id: profile, archived: true })})`,
      marker,
      gate,
    );
    await holding(marker);
    const { out } = sql(`
      select count(*) from pg_locks l
      join pg_stat_activity a on a.pid = l.pid
      where l.relation in (
          'platform.pricing_settings'::regclass,
          'platform.product_pricing'::regclass)
        and l.mode in ('RowShareLock', 'RowExclusiveLock')
        and a.query like '%${marker}%';
    `);
    expect(out).toBe("0");
    await gate.open();
    expect((await held).failed).toBe("");
  });
});

describe("grants", () => {
  it("the three replaced functions stay closed to signed-out visitors and PUBLIC", () => {
    const { out, failed } = sql(`
      select p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
        || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'platform'
        and p.proname in ('save_tax_profile', 'save_product_pricing', 'save_pricing_settings')
      order by 1;
    `);
    expect(failed).toBe("");
    expect(out.split("\n")).toEqual([
      'save_pricing_settings false true false true search_path=""',
      'save_product_pricing false true false true search_path=""',
      'save_tax_profile false true false true search_path=""',
    ]);
  });
});
