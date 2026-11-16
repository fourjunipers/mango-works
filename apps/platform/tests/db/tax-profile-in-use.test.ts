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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/lib/roles";
import {
  createTenant,
  deleteTenant,
  serviceClient,
  sql,
  sqlBackground,
  type TestTenant,
} from "./helpers";

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
  const { data, error } = await service
    .from("products")
    .insert({
      tenant_id: shop.id,
      name: `Taxed ${tag} ${++counter}`,
      type: "vehicle",
      tracking: "unit",
      vehicle_type: "motorbike",
    })
    .select("id")
    .single();
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
    await service
      .from("tax_profiles")
      .select("archived_at")
      .eq("id", id)
      .single()
  ).data!.archived_at;

async function holding(marker: string) {
  for (let i = 0; i < 100; i++) {
    const { out } = sql(
      `select count(*) from pg_stat_activity where state = 'active' and query like '%${marker}%' and pid <> pg_backend_pid();`,
    );
    if (out === "1") return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`No session reached ${marker}`);
}

/**
 * Waits until a session running `call` is waiting for a lock: polled, so
 * the test neither guesses how long that takes nor reads the locks early.
 */
async function waitingOnLock(call: string) {
  for (let i = 0; i < 80; i++) {
    const { out } = sql(
      `select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%${call}%' and pid <> pg_backend_pid();`,
    );
    if (Number(out) > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`No session running ${call} came to wait for a lock`);
}

/** A call made as a member in a session that stays open for `seconds`. */
function heldAs(role: Role, call: string, marker: string, seconds = 1.5) {
  const claims = JSON.stringify({
    sub: shop.members[role].id,
    role: "authenticated",
  });
  return sqlBackground(`
    begin;
    select set_config('request.jwt.claims', '${claims}', true);
    set local role authenticated;
    ${call};
    select pg_sleep(${seconds}) /* ${marker} */;
    commit;
  `);
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
        p_profile: { id: profile, rate_bp: 1000, name: `VAT10 ${tag}` } as never,
      })
      .throwOnError();
    const row = await service
      .from("tax_profiles")
      .select("rate_bp, name")
      .eq("id", profile)
      .single();
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
      p_profile: { id: profile, name: `Old VAT ${tag}`, archived: true } as never,
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
    const held = heldAs(
      "owner",
      `select platform.save_tax_profile('${shop.id}', ${json({ id: profile, archived: true })})`,
      marker,
    );
    await holding(marker);
    const started = Date.now();
    const { error } = await useProfile(product, profile);
    expect(Date.now() - started).toBeGreaterThan(700);
    expect(error?.message).toBe("invalid_tax_profile");
    expect((await held).failed).toBe("");
    expect(await archivedAt(profile)).not.toBeNull();
  });

  it("a product save first, then the archive: the archive waits and is refused", async () => {
    const profile = await addProfile();
    const product = await addProduct();
    const marker = `hold-use-${tag}-${++counter}`;
    const held = heldAs(
      "manager",
      `select platform.save_product_pricing('${product}', ${json({ tax_profile_id: profile })})`,
      marker,
    );
    await holding(marker);
    const started = Date.now();
    const { error } = await archive(profile);
    expect(Date.now() - started).toBeGreaterThan(700);
    expect(error?.message).toBe("tax_profile_in_use");
    expect((await held).failed).toBe("");
    expect(await archivedAt(profile)).toBeNull();
    await useProfile(product, null).throwOnError();
  });

  it("archive first, then making it the default: refused", async () => {
    const profile = await addProfile();
    const marker = `hold-archive-default-${tag}-${++counter}`;
    const held = heldAs(
      "owner",
      `select platform.save_tax_profile('${shop.id}', ${json({ id: profile, archived: true })})`,
      marker,
    );
    await holding(marker);
    const started = Date.now();
    const { error } = await setDefault(profile);
    expect(Date.now() - started).toBeGreaterThan(700);
    expect(error?.message).toBe("invalid_tax_profile");
    expect((await held).failed).toBe("");
  });

  it("making it the default first, then the archive: refused", async () => {
    const profile = await addProfile();
    const marker = `hold-default-${tag}-${++counter}`;
    const held = heldAs(
      "manager",
      `select platform.save_pricing_settings('${shop.id}', ${json({ default_tax_profile_id: profile })})`,
      marker,
    );
    await holding(marker);
    const started = Date.now();
    const { error } = await archive(profile);
    expect(Date.now() - started).toBeGreaterThan(700);
    expect(error?.message).toBe("tax_profile_is_default");
    expect((await held).failed).toBe("");
    await setDefault(null).throwOnError();
    expect(await archivedAt(profile)).toBeNull();
  });
});

describe("lock order: the product, the price list, the tax profile, the pricing row", () => {
  it("a product save waiting on the profile holds the product and the list, and no pricing row", async () => {
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
    const holder = sqlBackground(`
      begin;
      select 1 from platform.tax_profiles where id = '${profile}' for update;
      select pg_sleep(5) /* ${marker} */;
      commit;
    `);
    await holding(marker);
    const saving = db("manager").rpc("save_product_pricing", {
      p_product_id: product,
      p_settings: {
        pricing_method: "tiered",
        price_template_id: list,
        tax_profile_id: profile,
      } as never,
    })
      // A query builder sends nothing until it is awaited: start it now.
      .then((result) => result);
    // The holder keeps the profile for 5 s; the save reaches it well inside.
    await waitingOnLock("save_product_pricing");
    const locks = (relation: string) =>
      sql(`
        select count(*) from pg_locks l
        join pg_stat_activity a on a.pid = l.pid
        where l.relation = '${relation}'::regclass
          and l.granted
          and a.wait_event_type = 'Lock'
          and a.query not like '%pg_sleep%'
          and a.pid <> pg_backend_pid();
      `).out;
    // The waiting save already holds the product's row and the list's row
    // (their tables carry its row-share lock), and nothing on pricing rows.
    expect(Number(locks("platform.products"))).toBeGreaterThan(0);
    expect(Number(locks("platform.price_templates"))).toBeGreaterThan(0);
    expect(locks("platform.product_pricing")).toBe("0");
    const { error } = await saving;
    expect(error).toBeNull();
    expect((await holder).failed).toBe("");
  }, 30_000);

  it("the archive locks no settings row and no pricing row", async () => {
    const profile = await addProfile();
    const marker = `hold-archive-locks-${tag}-${++counter}`;
    const held = heldAs(
      "owner",
      `select platform.save_tax_profile('${shop.id}', ${json({ id: profile, archived: true })})`,
      marker,
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
