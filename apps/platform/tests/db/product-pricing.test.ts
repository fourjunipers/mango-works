/**
 * Products, stage D4 (20261115000100): where prices live. Stage D6
 * (20261115000200) adds the tax profile to the lock order; its own tests are
 * in tax-profile-in-use.test.ts.
 *
 * What is held here: who may read and who may write, by role and by shop;
 * that nobody signed in writes the tables directly; every save function and
 * what it refuses; the checks the tables hold whoever writes; the one read
 * that feeds quote(), end to end through the pricer; the audit trail; the
 * currency lock; the lock order and the races around it; and that no
 * function here does arithmetic on money.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { quote } from "@mango/core/quote";
import { quoteInputFor, type PricingInputs } from "@/lib/pricing-inputs";
import { pricingActions, pricingRoles } from "@/lib/pricing-permissions";
import { roles, type Role } from "@/lib/roles";
import {
  anonClient,
  createTenant,
  createUser,
  deleteTenant,
  deleteUser,
  serviceClient,
  sql,
  sqlBackground,
  type TestTenant,
  type TestUser,
} from "./helpers";

let shop: TestTenant;
let other: TestTenant;
let outsider: TestUser;
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let counter = 0;
const db = (role: Role) => shop.members[role].db;

const tables = [
  "tax_profiles",
  "pricing_settings",
  "price_templates",
  "price_template_days",
  "product_pricing",
  "price_rules",
  "price_rule_products",
] as const;
type PricingTable = (typeof tables)[number];
/** The typed client can't take a table name from a variable. */
const from = (client: ReturnType<typeof db>, table: PricingTable) =>
  client.from(table as "product_pricing");

type ProductType = "vehicle" | "gear" | "service" | "sale_item";
const tracking: Record<ProductType, string> = {
  vehicle: "unit",
  gear: "bulk",
  service: "none",
  sale_item: "consumable",
};

async function addProduct(
  type: ProductType = "vehicle",
  tenant: TestTenant = shop,
): Promise<string> {
  const { data, error } = await service
    .from("products")
    .insert({
      tenant_id: tenant.id,
      name: `Priced ${tag} ${++counter}`,
      type,
      tracking: tracking[type],
      ...(type === "vehicle" ? { vehicle_type: "motorbike" } : {}),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

type Day = { day: number; value: number | string; source: string };
/** 30 days rising by `step` from `first`. */
const days = (first: number, step: number, source = "manual"): Day[] =>
  Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    value: first + step * i,
    source,
  }));

const savePricing = (role: Role, productId: string, settings: object) =>
  db(role).rpc("save_product_pricing", {
    p_product_id: productId,
    p_settings: settings as never,
  });
const saveTemplate = (role: Role, template: object, tenant = shop) =>
  db(role).rpc("save_price_template", {
    p_tenant_id: tenant.id,
    p_template: template as never,
  });
const saveSettings = (role: Role, settings: object, tenant = shop) =>
  db(role).rpc("save_pricing_settings", {
    p_tenant_id: tenant.id,
    p_settings: settings as never,
  });
const saveProfile = (role: Role, profile: object, tenant = shop) =>
  db(role).rpc("save_tax_profile", {
    p_tenant_id: tenant.id,
    p_profile: profile as never,
  });
const saveRule = (role: Role, rule: object, tenant = shop) =>
  db(role).rpc("save_price_rule", {
    p_tenant_id: tenant.id,
    p_rule: rule as never,
  });

async function sharedList(
  kind: "amounts" | "multipliers" = "amounts",
  list: Day[] = days(30_000, 10_000),
): Promise<string> {
  const { data, error } = await saveTemplate("owner", {
    name: `List ${tag} ${++counter}`,
    kind,
    days: list,
  });
  if (error) throw error;
  return data as string;
}

const pricingRow = async (productId: string) =>
  (
    await service
      .from("product_pricing")
      .select("*")
      .eq("product_id", productId)
      .maybeSingle()
  ).data;

const ownList = async (productId: string) =>
  (
    await service
      .from("price_templates")
      .select("id, kind, hourly, product_id")
      .eq("product_id", productId)
      .maybeSingle()
  ).data;

const dayValues = async (templateId: string) =>
  (
    await service
      .from("price_template_days")
      .select("day, value, source")
      .eq("template_id", templateId)
      .order("day")
  ).data!;

const events = async (entityId: string, actions: string[]) =>
  (
    await service
      .from("audit_events")
      .select("entity, action, actor, before, after")
      .eq("entity_id", entityId)
      .in("action", actions)
      .order("id")
  ).data!;

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

const noDeadlock = (
  results: { error: { code?: string; message?: string } | null }[],
) => {
  for (const { error } of results) {
    expect(error?.code, error?.message).not.toBe("40P01");
    expect(error?.message ?? "").not.toMatch(/deadlock/i);
  }
};

const lines = (statement: string): string[] => {
  const { out, failed } = sql(statement);
  expect(failed).toBe("");
  return out.split("\n").filter(Boolean);
};

const thailand = {
  country: "TH",
  currency: "THB",
  locale: "th-TH",
  timezone: "Asia/Bangkok",
};

beforeAll(async () => {
  [shop, other, outsider] = await Promise.all([
    createTenant("price", thailand),
    createTenant("price-other", thailand),
    createUser("price-outsider"),
  ]);
}, 120_000);

afterAll(async () => {
  await Promise.all([
    deleteTenant(shop),
    deleteTenant(other),
    deleteUser(outsider),
  ]);
});

describe("who may do what", () => {
  it("is one table, the same in the database and in the app", () => {
    for (const action of pricingActions) {
      const { out } = sql(
        `select array_to_string(platform_private.pricing_roles('${action}'), ',');`,
      );
      expect(out, action).toBe(pricingRoles(action).join(","));
    }
    expect(
      sql(`select platform_private.pricing_roles('nonsense') is null;`).out,
    ).toBe("t");
  });

  let product: string;
  let template: string;

  it("owners and managers save; staff, mechanics and drivers are refused", async () => {
    product = await addProduct();
    template = await sharedList();
    for (const role of roles) {
      const allowed = pricingRoles("write").includes(role);
      const calls = [
        savePricing(role, product, { deposit: 200_000 }),
        saveTemplate(role, { id: template, name: `List ${tag} ${role}` }),
        saveSettings(role, { coupons_enabled: false }),
        saveProfile(role, { name: `VAT ${tag} ${role}`, rate_bp: 700 }),
        saveRule(role, {
          name: `Season ${role}`,
          starts_on: "2027-04-01",
          ends_on: "2027-09-30",
          adjust_bp: -2000,
          all_products: true,
        }),
      ];
      for (const { error } of await Promise.all(calls)) {
        if (allowed) expect(error, role).toBeNull();
        else {
          expect(error?.code, role).toBe("42501");
          expect(error?.message, role).toBe("only_owner_or_manager");
        }
      }
    }
    const blocked = await db("staff").rpc("delete_price_template", {
      p_template_id: template,
    });
    expect(blocked.error?.message).toBe("only_owner_or_manager");
  });

  it("owners, managers and staff read every pricing table; mechanics and drivers read none", async () => {
    await savePricing("owner", product, {
      pricing_method: "tiered",
      price_template_id: template,
    }).throwOnError();
    await saveRule("owner", {
      name: "Named",
      starts_on: "2027-01-01",
      ends_on: "2027-01-31",
      adjust_bp: 1000,
      product_ids: [product],
    }).throwOnError();
    for (const role of roles) {
      const sees = pricingRoles("read").includes(role);
      for (const table of tables) {
        const { data, error } = await from(db(role), table)
          .select("tenant_id")
          .eq("tenant_id", shop.id);
        expect(error, `${role} ${table}`).toBeNull();
        if (sees) expect(data!.length, `${role} ${table}`).toBeGreaterThan(0);
        else expect(data, `${role} ${table}`).toEqual([]);
      }
    }
  });

  it("another shop, a stranger and a signed-out visitor get nothing", async () => {
    for (const table of tables) {
      for (const client of [other.members.owner.db, outsider.db]) {
        const { data } = await from(client, table)
          .select("tenant_id")
          .eq("tenant_id", shop.id);
        expect(data, table).toEqual([]);
      }
      const signedOut = await from(anonClient(), table)
        .select("tenant_id")
        .limit(1);
      expect(signedOut.error, table).not.toBeNull();
    }
    const theirs = other.members.owner.db;
    const refused = await Promise.all([
      theirs.rpc("save_product_pricing", {
        p_product_id: product,
        p_settings: { deposit: 1 },
      }),
      theirs.rpc("save_price_template", {
        p_tenant_id: shop.id,
        p_template: { id: template, name: "Hijacked" },
      }),
      theirs.rpc("save_pricing_settings", {
        p_tenant_id: shop.id,
        p_settings: { coupons_enabled: true },
      }),
      theirs.rpc("save_tax_profile", {
        p_tenant_id: shop.id,
        p_profile: { name: "Hijacked", rate_bp: 0 },
      }),
      theirs.rpc("save_price_rule", {
        p_tenant_id: shop.id,
        p_rule: {
          name: "Hijacked",
          starts_on: "2027-01-01",
          ends_on: "2027-01-02",
          adjust_bp: -9999,
        },
      }),
      theirs.rpc("delete_price_template", { p_template_id: template }),
      outsider.db.rpc("save_product_pricing", {
        p_product_id: product,
        p_settings: { deposit: 1 },
      }),
      anonClient().rpc("save_product_pricing", {
        p_product_id: product,
        p_settings: { deposit: 1 },
      }),
    ]);
    for (const { error } of refused) expect(error).not.toBeNull();
    expect((await pricingRow(product))?.deposit).toBe(200_000);
  });

  it("nobody signed in writes a pricing table directly, the owner included", async () => {
    for (const table of tables) {
      const client = db("owner");
      const before = await service
        .from(table)
        .select("*")
        .eq("tenant_id", shop.id);
      const attempts = await Promise.all([
        from(client, table)
          .insert({ tenant_id: shop.id } as never)
          .select(),
        from(client, table)
          .update({ tenant_id: shop.id } as never)
          .eq("tenant_id", shop.id)
          .select(),
        from(client, table).delete().eq("tenant_id", shop.id).select(),
      ]);
      for (const { data, error } of attempts) {
        expect(error?.code, table).toBe("42501");
        expect(data ?? []).toEqual([]);
      }
      const after = await service
        .from(table)
        .select("*")
        .eq("tenant_id", shop.id);
      expect(after.data, table).toEqual(before.data);
    }
  });
});

describe("save_product_pricing", () => {
  it("lets each type of product use only its own ways of pricing", async () => {
    const allowed: Record<ProductType, string[]> = {
      vehicle: ["tiered", "per_period"],
      gear: ["tiered", "per_period", "fixed"],
      service: ["per_period", "fixed", "free"],
      sale_item: ["fixed"],
    };
    const template = await sharedList();
    const settingsFor: Record<string, object> = {
      tiered: { pricing_method: "tiered", price_template_id: template },
      per_period: {
        pricing_method: "per_period",
        price_amount: 20_000,
        price_period: "day",
      },
      fixed: { pricing_method: "fixed", price_amount: 15_000 },
      free: { pricing_method: "free" },
    };
    for (const type of Object.keys(allowed) as ProductType[]) {
      const id = await addProduct(type);
      for (const method of Object.keys(settingsFor)) {
        const { error } = await savePricing("owner", id, settingsFor[method]);
        if (allowed[type].includes(method)) {
          expect(error, `${type} ${method}`).toBeNull();
          expect((await pricingRow(id))?.pricing_method).toBe(method);
        } else {
          expect(error?.message, `${type} ${method}`).toBe(
            "pricing_method_not_allowed",
          );
        }
      }
    }
  });

  it("holds the same rule in the table, whoever writes", async () => {
    const helmet = await addProduct("gear");
    const { error } = await service.from("product_pricing").insert({
      tenant_id: shop.id,
      product_id: helmet,
      product_type: "gear",
      currency: "THB",
      pricing_method: "free",
    });
    expect(error?.message).toContain("product_pricing_method_by_type_check");
    const sticker = await addProduct("sale_item");
    const perDay = await service.from("product_pricing").insert({
      tenant_id: shop.id,
      product_id: sticker,
      product_type: "sale_item",
      currency: "THB",
      pricing_method: "per_period",
      price_amount: 100,
      price_period: "day",
    });
    expect(perDay.error?.message).toContain(
      "product_pricing_method_by_type_check",
    );
    const halfFilled = await service.from("product_pricing").insert({
      tenant_id: shop.id,
      product_id: sticker,
      product_type: "sale_item",
      currency: "THB",
      pricing_method: "fixed",
    });
    expect(halfFilled.error?.message).toContain(
      "product_pricing_method_fields_check",
    );
  });

  it("changes only what is named", async () => {
    const id = await addProduct();
    await savePricing("owner", id, { deposit: 200_000 }).throwOnError();
    await savePricing("owner", id, {
      pricing_method: "per_period",
      price_amount: 25_000,
      price_period: "week",
    }).throwOnError();
    await savePricing("manager", id, { taxable: false }).throwOnError();
    expect(await pricingRow(id)).toMatchObject({
      deposit: 200_000,
      pricing_method: "per_period",
      price_amount: 25_000,
      price_period: "week",
      taxable: false,
      currency: "THB",
      product_type: "vehicle",
    });
    await savePricing("owner", id, { deposit: null }).throwOnError();
    expect((await pricingRow(id))?.deposit).toBeNull();
  });

  it("saves a product's own prices, and keeps one list per product", async () => {
    const id = await addProduct();
    await savePricing("owner", id, {
      pricing_method: "tiered",
      own_list: { hourly: 8_000, days: days(30_000, 9_310, "filled") },
      long_stay_day: 11_666,
    }).throwOnError();
    const list = (await ownList(id))!;
    expect(list).toMatchObject({
      kind: "amounts",
      hourly: 8_000,
      product_id: id,
    });
    expect(await pricingRow(id)).toMatchObject({
      pricing_method: "tiered",
      price_template_id: list.id,
      template_kind: "amounts",
      long_stay_day: 11_666,
      base_amount: null,
    });
    const stored = await dayValues(list.id);
    expect(stored).toHaveLength(30);
    expect(stored[0]).toEqual({ day: 1, value: 30_000, source: "filled" });
    expect(stored[29]).toEqual({
      day: 30,
      value: 30_000 + 9_310 * 29,
      source: "filled",
    });
    // Saved again: the same list, not a second one.
    await savePricing("owner", id, {
      own_list: { hourly: null, days: days(35_000, 10_000) },
    }).throwOnError();
    expect((await ownList(id))?.id).toBe(list.id);
    expect((await ownList(id))?.hourly).toBeNull();
    expect((await dayValues(list.id))[0].value).toBe(35_000);
  });

  it("deletes an own list the product no longer uses", async () => {
    const id = await addProduct();
    const own = {
      pricing_method: "tiered",
      own_list: { days: days(30_000, 10_000) },
    };
    await savePricing("owner", id, own).throwOnError();
    // To a shared list.
    const shared = await sharedList();
    await savePricing("owner", id, {
      price_template_id: shared,
    }).throwOnError();
    expect(await ownList(id)).toBeNull();
    expect((await pricingRow(id))?.price_template_id).toBe(shared);
    // Back to its own, then to a flat fee: the list and its columns go.
    await savePricing("owner", id, own).throwOnError();
    await savePricing("owner", id, {
      pricing_method: "per_period",
      price_amount: 20_000,
      price_period: "day",
      long_stay_day: 5_000,
    }).throwOnError();
    expect(await ownList(id)).toBeNull();
    expect(await pricingRow(id)).toMatchObject({
      pricing_method: "per_period",
      price_template_id: null,
      template_kind: null,
      long_stay_day: null,
    });
    // The shared list is still there.
    expect((await dayValues(shared)).length).toBe(30);
  });

  it("asks for a base price on a multipliers list, stored to six decimals", async () => {
    // 1.1666 is 1166600 millionths.
    const list = await sharedList("multipliers", days(1_166_600, 1_000_000));
    const id = await addProduct();
    const without = await savePricing("owner", id, {
      pricing_method: "tiered",
      price_template_id: list,
    });
    expect(without.error?.message).toBe("base_price_required");
    await savePricing("owner", id, {
      pricing_method: "tiered",
      price_template_id: list,
      base_amount: 10_000,
    }).throwOnError();
    expect(await pricingRow(id)).toMatchObject({
      template_kind: "multipliers",
      base_amount: 10_000,
    });
    expect((await dayValues(list))[0].value).toBe(1_166_600);
    // On an amounts list a base price is dropped.
    const amounts = await sharedList();
    await savePricing("owner", id, {
      price_template_id: amounts,
    }).throwOnError();
    expect((await pricingRow(id))?.base_amount).toBeNull();
  });

  it("says what is missing or wrong, in its own words", async () => {
    const bike = await addProduct();
    const helmet = await addProduct("gear");
    const cases: [string, object, string][] = [
      ["no list", { pricing_method: "tiered" }, "price_list_required"],
      [
        "no amount",
        { pricing_method: "per_period", price_period: "day" },
        "price_required",
      ],
      [
        "no period",
        { pricing_method: "per_period", price_amount: 100 },
        "price_required",
      ],
      [
        "zero",
        { pricing_method: "per_period", price_amount: 0, price_period: "day" },
        "price_zero",
      ],
      ["unknown key", { price: 100 }, "invalid_pricing"],
      ["bad method", { pricing_method: "auction" }, "invalid_pricing"],
      ["bad period", { price_period: "fortnight" }, "invalid_pricing"],
      ["fraction", { deposit: 100.5 }, "invalid_pricing"],
      ["negative", { deposit: -1 }, "invalid_pricing"],
      [
        "both lists",
        { own_list: { days: days(1, 1) }, price_template_id: null },
        "invalid_pricing",
      ],
      [
        "unknown list",
        { pricing_method: "tiered", price_template_id: crypto.randomUUID() },
        "invalid_price_list",
      ],
      ["bad uuid", { tax_profile_id: "nope" }, "invalid_pricing"],
      [
        "29 days",
        { pricing_method: "tiered", own_list: { days: days(1, 1).slice(1) } },
        "price_list_incomplete",
      ],
    ];
    for (const [what, settings, message] of cases) {
      const { error } = await savePricing("owner", bike, settings);
      expect(error?.message, what).toBe(message);
    }
    const notObject = await savePricing("owner", bike, [1] as never);
    expect(notObject.error?.message).toBe("invalid_pricing");
    expect(
      (await savePricing("owner", helmet, { deposit: 1 })).error?.message,
    ).toBe("deposit_vehicles_only");
    expect(
      (await savePricing("owner", bike, { replacement_price: 1 })).error
        ?.message,
    ).toBe("replacement_gear_only");
    await savePricing("owner", helmet, {
      replacement_price: 150_000,
    }).throwOnError();
    expect((await pricingRow(helmet))?.replacement_price).toBe(150_000);
    // Nothing was saved by a refused call.
    expect(await pricingRow(bike)).toBeNull();
    // Another shop's list is not found.
    const theirs = await other.members.owner.db.rpc("save_price_template", {
      p_tenant_id: other.id,
      p_template: {
        name: "Theirs",
        kind: "amounts",
        days: days(1, 1),
      } as never,
    });
    const borrowed = await savePricing("owner", bike, {
      pricing_method: "tiered",
      price_template_id: theirs.data,
    });
    expect(borrowed.error?.message).toBe("invalid_price_list");
  });

  it("takes an amount of any size exactly, as a string of digits", async () => {
    const id = await addProduct();
    // Past what a JavaScript number holds exactly.
    await savePricing("owner", id, {
      deposit: "9007199254740993",
    }).throwOnError();
    expect(
      sql(
        `select deposit from platform.product_pricing where product_id = '${id}';`,
      ).out,
    ).toBe("9007199254740993");
  });

  it("takes a product's own tax profile, or not taxable; never an archived or foreign one", async () => {
    const id = await addProduct();
    const { data: profile } = await saveProfile("owner", {
      name: `Insurance ${tag}`,
      rate_bp: 0,
    });
    await savePricing("owner", id, { tax_profile_id: profile }).throwOnError();
    expect(await pricingRow(id)).toMatchObject({
      taxable: true,
      tax_profile_id: profile,
    });
    // Not taxable clears the profile.
    await savePricing("owner", id, { taxable: false }).throwOnError();
    expect(await pricingRow(id)).toMatchObject({
      taxable: false,
      tax_profile_id: null,
    });
    await saveProfile("owner", { id: profile, archived: true }).throwOnError();
    const archived = await savePricing("owner", id, {
      taxable: true,
      tax_profile_id: profile,
    });
    expect(archived.error?.message).toBe("invalid_tax_profile");
    const { data: foreign } = await other.members.owner.db.rpc(
      "save_tax_profile",
      {
        p_tenant_id: other.id,
        p_profile: { name: "Theirs", rate_bp: 700 },
      },
    );
    const borrowed = await savePricing("owner", id, {
      tax_profile_id: foreign,
    });
    expect(borrowed.error?.message).toBe("invalid_tax_profile");
  });

  it("records who changed what, and how it is priced as its own event", async () => {
    const id = await addProduct();
    await savePricing("manager", id, {
      pricing_method: "per_period",
      price_amount: 20_000,
      price_period: "day",
    }).throwOnError();
    await savePricing("owner", id, { price_amount: 25_000 }).throwOnError();
    const rows = await service
      .from("audit_events")
      .select("action, actor, before, after")
      .eq("entity", "product_pricing")
      .eq("entity_id", id)
      .order("id");
    expect(rows.data!.map((row) => [row.action, row.actor])).toEqual([
      ["insert", shop.members.manager.id],
      ["update", shop.members.owner.id],
    ]);
    expect(rows.data![1]).toMatchObject({
      before: { price_amount: 20_000 },
      after: { price_amount: 25_000 },
    });
    expect(await events(id, ["pricing_change"])).toEqual([
      {
        entity: "products",
        action: "pricing_change",
        actor: shop.members.manager.id,
        before: { pricing_method: null },
        after: { pricing_method: "per_period" },
      },
    ]);
  });

  it("goes with its product, own list included", async () => {
    const id = await addProduct();
    await savePricing("owner", id, {
      pricing_method: "tiered",
      own_list: { days: days(30_000, 10_000) },
    }).throwOnError();
    const list = (await ownList(id))!.id;
    const { error } = await service.from("products").delete().eq("id", id);
    expect(error).toBeNull();
    expect(await pricingRow(id)).toBeNull();
    expect(await ownList(id)).toBeNull();
    expect(await dayValues(list)).toEqual([]);
  });
});

describe("price lists", () => {
  it("allows equal totals on neighbouring days and refuses a fall", async () => {
    const flat = days(30_000, 10_000);
    flat[7].value = flat[6].value; // day 8 = day 7
    flat[8].value = flat[6].value; // day 9 = day 7
    const equal = await saveTemplate("owner", {
      name: `Equal ${tag}`,
      kind: "amounts",
      days: flat,
    });
    expect(equal.error).toBeNull();
    const falling = days(30_000, 10_000);
    falling[7].value = (falling[6].value as number) - 1;
    const fall = await saveTemplate("owner", {
      name: `Falls ${tag}`,
      kind: "amounts",
      days: falling,
    });
    expect(fall.error?.message).toBe("price_list_falls");
  });

  it("needs all 30 days, in order, each above zero", async () => {
    const cases: [string, Day[] | unknown, string][] = [
      ["29 days", days(1, 1).slice(0, 29), "price_list_incomplete"],
      [
        "31 days",
        [...days(1, 1), { day: 31, value: 99, source: "manual" }],
        "price_list_incomplete",
      ],
      ["not a list", "thirty", "price_list_incomplete"],
      ["out of order", [...days(1, 1)].reverse(), "invalid_price_list"],
      ["a zero", days(0, 1), "invalid_price_list"],
      ["a fraction", days(1.5, 1), "invalid_price_list"],
      ["bad source", days(1, 1, "guessed"), "invalid_price_list"],
    ];
    for (const [what, list, message] of cases) {
      const { error } = await saveTemplate("owner", {
        name: `Bad ${tag} ${what}`,
        kind: "amounts",
        days: list,
      });
      expect(error?.message, what).toBe(message);
    }
    const noName = await saveTemplate("owner", {
      kind: "amounts",
      days: days(1, 1),
    });
    expect(noName.error?.message).toBe("invalid_price_list");
    const badKind = await saveTemplate("owner", {
      name: "x",
      kind: "percent",
      days: days(1, 1),
    });
    expect(badKind.error?.message).toBe("invalid_price_list");
  });

  it("holds the same rule in the table, whoever writes", () => {
    const insert = (values: string) =>
      sql(`
        begin;
        insert into platform.price_templates (id, tenant_id, name, currency, kind)
        values ('${crypto.randomUUID()}', '${shop.id}', 'Raw ${tag} ${++counter}', 'THB', 'amounts')
        returning id \\gset
        insert into platform.price_template_days (template_id, tenant_id, day, value, source)
        select :'id', '${shop.id}', d, ${values}, 'manual' from generate_series(1, 30) d
        where d <> 0;
        commit;
      `).failed;
    expect(insert("d * 100")).toBe("");
    expect(insert("3100 - d * 100")).toContain("price_list_falls");
    const short = sql(`
      begin;
      insert into platform.price_templates (id, tenant_id, name, currency, kind)
      values ('${crypto.randomUUID()}', '${shop.id}', 'Raw short ${tag}', 'THB', 'amounts')
      returning id \\gset
      insert into platform.price_template_days (template_id, tenant_id, day, value, source)
      select :'id', '${shop.id}', d, d, 'manual' from generate_series(1, 29) d;
      commit;
    `).failed;
    expect(short).toContain("price_list_incomplete");
  });

  it("changes a name, an hourly price or the days, but never the kind", async () => {
    const id = await sharedList();
    await saveTemplate("owner", {
      id,
      name: `Renamed ${tag}`,
      hourly: 8_000,
    }).throwOnError();
    const { data } = await service
      .from("price_templates")
      .select("name, hourly, kind, currency, product_id")
      .eq("id", id)
      .single();
    expect(data).toEqual({
      name: `Renamed ${tag}`,
      hourly: 8_000,
      kind: "amounts",
      currency: "THB",
      product_id: null,
    });
    const kind = await saveTemplate("owner", { id, kind: "multipliers" });
    expect(kind.error?.message).toBe("price_list_kind_fixed");
    const sameName = await saveTemplate("owner", {
      name: `renamed ${tag} `,
      kind: "amounts",
      days: days(1, 1),
    });
    expect(sameName.error?.code).toBe("23505");
    // A product's own list is not a shared one: it can't be changed here.
    const product = await addProduct();
    await savePricing("owner", product, {
      pricing_method: "tiered",
      own_list: { days: days(1, 1) },
    }).throwOnError();
    const own = (await ownList(product))!.id;
    expect(
      (await saveTemplate("owner", { id: own, name: "Shared now" })).error
        ?.message,
    ).toBe("invalid_price_list");
  });

  it("records a change of days as one event, with the days that changed and the products on the list", async () => {
    const id = await sharedList();
    const product = await addProduct();
    await savePricing("owner", product, {
      pricing_method: "tiered",
      price_template_id: id,
    }).throwOnError();
    const changed = days(30_000, 10_000);
    changed[6].value = 95_000; // day 7: 90,000 → 95,000
    await saveTemplate("manager", { id, days: changed }).throwOnError();
    const [created, change] = await events(id, ["template_change"]);
    expect(created.actor).toBe(shop.members.owner.id);
    expect(Object.keys((created.after as { days: object }).days)).toHaveLength(
      30,
    );
    expect(change).toEqual({
      entity: "price_templates",
      action: "template_change",
      actor: shop.members.manager.id,
      before: { days: { "7": "90000" } },
      after: { days: { "7": "95000" }, products: [product] },
    });
    // The same days again: nothing to record.
    await saveTemplate("owner", { id, days: changed }).throwOnError();
    expect(await events(id, ["template_change"])).toHaveLength(2);
  });

  it("can't be deleted while a product is on it", async () => {
    const id = await sharedList();
    const product = await addProduct();
    await savePricing("owner", product, {
      pricing_method: "tiered",
      price_template_id: id,
    }).throwOnError();
    const inUse = await db("owner").rpc("delete_price_template", {
      p_template_id: id,
    });
    expect(inUse.error?.message).toBe("price_list_in_use");
    // By hand it is the key that refuses.
    expect(
      (await service.from("price_templates").delete().eq("id", id)).error?.code,
    ).toBe("23503");
    await savePricing("owner", product, {
      pricing_method: null,
    }).throwOnError();
    const gone = await db("manager").rpc("delete_price_template", {
      p_template_id: id,
    });
    expect(gone.error).toBeNull();
    expect(await dayValues(id)).toEqual([]);
  });
});

describe("tax profiles and the shop's settings", () => {
  it("adds, renames and archives a profile, but not the shop's default", async () => {
    const { data: id } = await saveProfile("owner", {
      name: `VAT ${tag}`,
      rate_bp: 700,
    });
    await saveProfile("manager", { id, name: `VAT 7% ${tag}` }).throwOnError();
    await saveSettings("owner", { default_tax_profile_id: id }).throwOnError();
    const archive = await saveProfile("owner", { id, archived: true });
    expect(archive.error?.message).toBe("tax_profile_is_default");
    await saveSettings("owner", {
      default_tax_profile_id: null,
    }).throwOnError();
    await saveProfile("owner", { id, archived: true }).throwOnError();
    const row = await service
      .from("tax_profiles")
      .select("*")
      .eq("id", id as string)
      .single();
    expect(row.data).toMatchObject({ name: `VAT 7% ${tag}`, rate_bp: 700 });
    expect(row.data!.archived_at).not.toBeNull();
    // An archived profile can't become the default.
    const asDefault = await saveSettings("owner", {
      default_tax_profile_id: id,
    });
    expect(asDefault.error?.message).toBe("invalid_tax_profile");
    await saveProfile("owner", { id, archived: false }).throwOnError();
  });

  it("refuses a rate over 100%, a missing name and a name already used", async () => {
    expect(
      (await saveProfile("owner", { name: "Too much", rate_bp: 10_001 })).error
        ?.message,
    ).toBe("invalid_tax_profile");
    expect((await saveProfile("owner", { rate_bp: 700 })).error?.message).toBe(
      "invalid_tax_profile",
    );
    expect(
      (await saveProfile("owner", { name: "No rate" })).error?.message,
    ).toBe("invalid_tax_profile");
    await saveProfile("owner", {
      name: `Twice ${tag}`,
      rate_bp: 700,
    }).throwOnError();
    expect(
      (await saveProfile("owner", { name: ` twice ${tag}`, rate_bp: 0 })).error
        ?.code,
    ).toBe("23505");
    // Zero is a rate: a zero-rated profile.
    expect(
      (await saveProfile("owner", { name: `Zero ${tag}`, rate_bp: 0 })).error,
    ).toBeNull();
  });

  it("starts a shop with no tax, no deposit and coupons off", async () => {
    const fresh = await createTenant("price-fresh", thailand);
    try {
      const none = await service
        .from("pricing_settings")
        .select("*")
        .eq("tenant_id", fresh.id);
      expect(none.data).toEqual([]);
      const { data } = await fresh.members.owner.db.rpc(
        "save_pricing_settings",
        {
          p_tenant_id: fresh.id,
          p_settings: { rounding_step: 1000 },
        },
      );
      expect(data).toMatchObject({
        currency: "THB",
        rounding_step: 1000,
        tax_inclusive: true,
        default_tax_profile_id: null,
        deposit_mode: "none",
        deposit_percent_bp: null,
        deposit_amount: null,
        coupons_enabled: false,
      });
    } finally {
      await deleteTenant(fresh);
    }
  });

  it("keeps only the numbers of the deposit choice in force", async () => {
    const read = async () =>
      (
        await service
          .from("pricing_settings")
          .select("deposit_mode, deposit_percent_bp, deposit_amount")
          .eq("tenant_id", shop.id)
          .single()
      ).data;
    await saveSettings("owner", {
      deposit_mode: "percent_of_order",
      deposit_percent_bp: 3000,
      deposit_amount: 999,
    }).throwOnError();
    expect(await read()).toEqual({
      deposit_mode: "percent_of_order",
      deposit_percent_bp: 3000,
      deposit_amount: null,
    });
    await saveSettings("owner", {
      deposit_mode: "fixed_per_order",
      deposit_amount: 200_000,
    }).throwOnError();
    expect(await read()).toEqual({
      deposit_mode: "fixed_per_order",
      deposit_percent_bp: null,
      deposit_amount: 200_000,
    });
    await saveSettings("owner", { deposit_mode: "per_product" }).throwOnError();
    expect(await read()).toMatchObject({
      deposit_mode: "per_product",
      deposit_amount: 200_000,
    });
    await saveSettings("owner", { deposit_mode: "none" }).throwOnError();
    expect(await read()).toEqual({
      deposit_mode: "none",
      deposit_percent_bp: null,
      deposit_amount: null,
    });
    for (const settings of [
      { deposit_mode: "percent_of_order" },
      { deposit_mode: "fixed_per_order" },
    ]) {
      expect((await saveSettings("owner", settings)).error?.message).toBe(
        "deposit_number_required",
      );
    }
    for (const settings of [
      { deposit_mode: "half" },
      { tax_inclusive: "yes" },
      { coupons_enabled: 1 },
      { rounding_step: 0.5 },
      { theme: "dark" },
    ]) {
      expect((await saveSettings("owner", settings)).error?.message).toBe(
        "invalid_pricing",
      );
    }
    // A percentage of nothing is held by the table.
    expect(
      (
        await saveSettings("owner", {
          deposit_mode: "percent_of_order",
          deposit_percent_bp: 0,
        })
      ).error?.code,
    ).toBe("23514");
  });

  it("switches coupons and the tax style, and records who did", async () => {
    await saveSettings("manager", {
      coupons_enabled: true,
      tax_inclusive: false,
    }).throwOnError();
    const row = await service
      .from("pricing_settings")
      .select("coupons_enabled, tax_inclusive")
      .eq("tenant_id", shop.id)
      .single();
    expect(row.data).toEqual({ coupons_enabled: true, tax_inclusive: false });
    const audit = await service
      .from("audit_events")
      .select("actor, after")
      .eq("entity", "pricing_settings")
      .eq("entity_id", shop.id)
      .order("id", { ascending: false })
      .limit(1);
    expect(audit.data![0]).toEqual({
      actor: shop.members.manager.id,
      after: { coupons_enabled: true, tax_inclusive: false },
    });
    await saveSettings("owner", {
      coupons_enabled: false,
      tax_inclusive: true,
    }).throwOnError();
  });
});

describe("seasons", () => {
  const links = async (rule: string) =>
    (
      await service
        .from("price_rule_products")
        .select("product_id")
        .eq("rule_id", rule)
        .order("product_id")
    ).data!.map((row) => row.product_id);

  it("adds a season for named products, replaces the list, and deletes it", async () => {
    const [first, second, third] = await Promise.all([
      addProduct(),
      addProduct(),
      addProduct(),
    ]);
    const { data: id, error } = await saveRule("owner", {
      name: `Low season ${tag}`,
      starts_on: "2027-04-01",
      ends_on: "2027-09-30",
      repeats_yearly: true,
      adjust_bp: -2000,
      product_ids: [first, second, first],
    });
    expect(error).toBeNull();
    expect(await links(id as string)).toEqual([first, second].sort());
    const row = await service
      .from("price_rules")
      .select("*")
      .eq("id", id as string)
      .single();
    expect(row.data).toMatchObject({
      starts_on: "2027-04-01",
      ends_on: "2027-09-30",
      repeats_yearly: true,
      adjust_bp: -2000,
      all_products: false,
      active: true,
    });
    await saveRule("manager", {
      id,
      product_ids: [third],
      adjust_bp: -1500,
    }).throwOnError();
    expect(await links(id as string)).toEqual([third]);
    // For every product: it names none.
    await saveRule("owner", { id, all_products: true }).throwOnError();
    expect(await links(id as string)).toEqual([]);
    expect(
      (await events(id as string, ["price_rule_change"])).map((event) => [
        event.actor,
        (event.after as { products: string[] }).products.length,
      ]),
    ).toEqual([
      [shop.members.owner.id, 2],
      [shop.members.manager.id, 1],
      [shop.members.owner.id, 0],
    ]);
    await saveRule("owner", { id, active: false }).throwOnError();
    await saveRule("owner", { id, delete: true }).throwOnError();
    expect(
      (
        await service
          .from("price_rules")
          .select("id")
          .eq("id", id as string)
      ).data,
    ).toEqual([]);
  });

  it("refuses what a season can't be", async () => {
    const base = {
      name: "Bad",
      starts_on: "2027-04-01",
      ends_on: "2027-09-30",
      adjust_bp: -2000,
    };
    const invalid: object[] = [
      { ...base, starts_on: "1 April" },
      { ...base, adjust_bp: "a lot" },
      { ...base, adjust_bp: 12.5 },
      { ...base, product_ids: ["not-a-uuid"] },
      { ...base, product_ids: "all" },
      { ...base, colour: "green" },
      { name: "No dates", adjust_bp: -1000 },
      { ...base, delete: true },
    ];
    for (const rule of invalid) {
      expect(
        (await saveRule("owner", rule)).error?.message,
        JSON.stringify(rule),
      ).toBe("invalid_season");
    }
    // Held by the table: zero, out of range, and an end before the start.
    for (const rule of [
      { ...base, adjust_bp: 0 },
      { ...base, adjust_bp: -10_000 },
      { ...base, adjust_bp: 100_001 },
      { ...base, starts_on: "2027-09-30", ends_on: "2027-04-01" },
    ]) {
      expect(
        (await saveRule("owner", rule)).error?.code,
        JSON.stringify(rule),
      ).toBe("23514");
    }
    // Every year, a range may wrap over the new year.
    const wraps = await saveRule("owner", {
      ...base,
      name: `Peak ${tag}`,
      starts_on: "2027-12-15",
      ends_on: "2027-01-15",
      repeats_yearly: true,
      adjust_bp: 1000,
      all_products: true,
    });
    expect(wraps.error).toBeNull();
    // Another shop's product can't be named.
    const theirs = await addProduct("vehicle", other);
    expect(
      (await saveRule("owner", { ...base, product_ids: [theirs] })).error?.code,
    ).toBe("23503");
  });
});

describe("pricing_inputs: the one read that feeds quote()", () => {
  let bike: string;
  let helmet: string;
  let cover: string;
  let unpriced: string;
  let fresh: TestTenant;
  const inputs = async (
    client = fresh.members.owner.db,
    ids = [bike, helmet, cover, unpriced],
  ) => {
    const { data, error } = await client.rpc("pricing_inputs", {
      p_tenant_id: fresh.id,
      p_product_ids: ids,
    });
    if (error) throw error;
    return data as unknown as PricingInputs;
  };
  const owner = () => fresh.members.owner.db;

  beforeAll(async () => {
    fresh = await createTenant("price-inputs", thailand);
    [bike, helmet, cover, unpriced] = await Promise.all([
      addProduct("vehicle", fresh),
      addProduct("gear", fresh),
      addProduct("service", fresh),
      addProduct("vehicle", fresh),
    ]);
    const { data: vat } = await owner().rpc("save_tax_profile", {
      p_tenant_id: fresh.id,
      p_profile: { name: "VAT 7%", rate_bp: 700 },
    });
    const { data: exempt } = await owner().rpc("save_tax_profile", {
      p_tenant_id: fresh.id,
      p_profile: { name: "Insurance", rate_bp: 0 },
    });
    await owner()
      .rpc("save_pricing_settings", {
        p_tenant_id: fresh.id,
        p_settings: {
          rounding_step: 1000,
          tax_inclusive: true,
          default_tax_profile_id: vat,
          deposit_mode: "per_product",
          deposit_amount: 150_000,
        },
      })
      .throwOnError();
    // 30 days come to ฿3,000.00; ฿100 a long-stay day.
    await owner()
      .rpc("save_product_pricing", {
        p_product_id: bike,
        p_settings: {
          pricing_method: "tiered",
          own_list: { hourly: 8_000, days: days(10_000, 10_000) },
          long_stay_day: 10_000,
          deposit: 200_000,
        } as never,
      })
      .throwOnError();
    await owner()
      .rpc("save_product_pricing", {
        p_product_id: helmet,
        p_settings: {
          pricing_method: "fixed",
          price_amount: 10_700,
          taxable: false,
          replacement_price: 150_000,
        },
      })
      .throwOnError();
    await owner()
      .rpc("save_product_pricing", {
        p_product_id: cover,
        p_settings: {
          pricing_method: "per_period",
          price_amount: 20_000,
          price_period: "day",
          tax_profile_id: exempt,
        },
      })
      .throwOnError();
    for (const rule of [
      {
        name: "Low",
        starts_on: "2027-04-01",
        ends_on: "2027-09-30",
        repeats_yearly: true,
        adjust_bp: -2000,
        product_ids: [bike],
      },
      {
        name: "Everything",
        starts_on: "2027-12-20",
        ends_on: "2027-12-31",
        adjust_bp: 1000,
        all_products: true,
      },
      {
        name: "Switched off",
        starts_on: "2027-01-01",
        ends_on: "2027-01-31",
        adjust_bp: 500,
        all_products: true,
        active: false,
      },
      {
        name: "Other product",
        starts_on: "2027-02-01",
        ends_on: "2027-02-28",
        adjust_bp: 500,
        product_ids: [unpriced],
      },
    ]) {
      await owner()
        .rpc("save_price_rule", {
          p_tenant_id: fresh.id,
          p_rule: rule as never,
        })
        .throwOnError();
    }
  }, 120_000);

  afterAll(async () => {
    await deleteTenant(fresh);
  });

  it("returns the settings, each product's pricing and the seasons, amounts as strings", async () => {
    const got = await inputs();
    expect(got.settings).toMatchObject({
      currency: "THB",
      rounding_step: "1000",
      tax_inclusive: true,
      coupons_enabled: false,
      deposit_mode: "per_product",
      deposit_percent_bp: null,
      deposit_amount: "150000",
    });
    const byId = new Map(got.products.map((row) => [row.product_id, row]));
    expect([...byId.keys()].sort()).toEqual([bike, helmet, cover].sort());
    expect(byId.get(bike)).toMatchObject({
      product_type: "vehicle",
      pricing_method: "tiered",
      long_stay_day: "10000",
      deposit: "200000",
      taxable: true,
      tax_rate_bp: 700,
      tax_profile_name: "VAT 7%",
      template: { kind: "amounts", shared: false, hourly: "8000" },
    });
    expect(byId.get(bike)!.template!.days).toEqual(
      days(10_000, 10_000).map((day) => String(day.value)),
    );
    // Not taxable: no rate. Its own profile: that rate, not the default.
    expect(byId.get(helmet)).toMatchObject({
      pricing_method: "fixed",
      price_amount: "10700",
      replacement_price: "150000",
      taxable: false,
      tax_rate_bp: null,
      template: null,
    });
    expect(byId.get(cover)).toMatchObject({
      pricing_method: "per_period",
      price_amount: "20000",
      price_period: "day",
      tax_rate_bp: 0,
      tax_profile_name: "Insurance",
    });
    // Seasons: the active ones that apply to a product asked about.
    expect(
      got.seasons.map((season) => [
        season.name,
        season.all_products,
        season.product_ids,
      ]),
    ).toEqual([
      ["Other product", false, [unpriced]],
      ["Low", false, [bike]],
      ["Everything", true, []],
    ]);
    expect(
      (await inputs(owner(), [helmet])).seasons.map((s) => s.name),
    ).toEqual(["Everything"]);
  });

  it("prices a month through the one pricer: ฿3,000 with VAT ฿196.26", async () => {
    const bkk = (date: string) => new Date(`${date}T10:00:00+07:00`);
    const november = {
      start: bkk("2027-11-01"),
      end: bkk("2027-12-01"),
      timeZone: "Asia/Bangkok",
    };
    const result = quote(
      quoteInputFor(await inputs(), [
        { id: "bike", productId: bike, quantity: 1, span: november },
      ]),
    );
    expect(result.ok && result.totals).toMatchObject({
      total: BigInt(300000),
      vat: BigInt(19626),
      net: BigInt(280374),
    });
    expect(result.ok && result.deposit).toMatchObject({
      amount: BigInt(200000),
      from: "shop",
    });

    // Staff see prices too, and get the same answer from the same rows.
    const asStaff = quote(
      quoteInputFor(await inputs(fresh.members.staff.db), [
        { id: "bike", productId: bike, quantity: 1, span: november },
      ]),
    );
    expect(asStaff).toEqual(result);

    // A month and 14 days, 3 lines, two rates and a part that is not taxable.
    const long = quote(
      quoteInputFor(await inputs(), [
        {
          id: "bike",
          productId: bike,
          quantity: 1,
          span: { ...november, end: bkk("2027-12-15") },
        },
        { id: "helmet", productId: helmet, quantity: 2, span: november },
        {
          id: "cover",
          productId: cover,
          quantity: 1,
          span: { ...november, end: bkk("2027-11-04") },
        },
      ]),
    );
    // Bike ฿3,000 + 14 × ฿100 = ฿4,400; helmets 2 × ฿107; cover 3 × ฿200.
    expect(long.ok && long.totals.total).toBe(
      BigInt(440000) + BigInt(21400) + BigInt(60000),
    );
    expect(long.ok && long.taxGroups.map((g) => [g.rateBp, g.base])).toEqual([
      [0, BigInt(60000)],
      [700, BigInt(440000)],
    ]);
    expect(long.ok && long.nonTaxable).toBe(BigInt(21400));

    // In low season, 3 of 7 days: the season comes through the same read.
    const april = quote(
      quoteInputFor(await inputs(), [
        {
          id: "bike",
          productId: bike,
          quantity: 1,
          span: {
            start: bkk("2027-03-29"),
            end: bkk("2027-04-05"),
            timeZone: "Asia/Bangkok",
          },
        },
      ]),
    );
    // 7 days ฿700; days starting 1 to 4 Apr are inside: 700 × 20% × 4 ÷ 7 = ฿80.
    expect(april.ok && april.lines[0]).toMatchObject({
      listPrice: BigInt(70000),
      seasonPrice: BigInt(62000),
    });
  });

  it("can't price a product with no price, and says so", async () => {
    const bkk = (date: string) => new Date(`${date}T10:00:00+07:00`);
    const result = quote(
      quoteInputFor(await inputs(), [
        {
          id: "x",
          productId: unpriced,
          quantity: 1,
          span: {
            start: bkk("2027-11-01"),
            end: bkk("2027-11-02"),
            timeZone: "Asia/Bangkok",
          },
        },
      ]),
    );
    expect(result).toEqual({
      ok: false,
      unpriced: [{ lineId: "x", reason: "no_price" }],
    });
  });

  it("gives a mechanic and a driver nothing to price with", async () => {
    for (const role of ["mechanic", "driver"] as const) {
      expect(await inputs(fresh.members[role].db), role).toEqual({
        settings: null,
        products: [],
        seasons: [],
      });
    }
  });

  it("gives another shop, a stranger and a signed-out visitor nothing", async () => {
    for (const client of [shop.members.owner.db, outsider.db]) {
      expect(await inputs(client)).toEqual({
        settings: null,
        products: [],
        seasons: [],
      });
    }
    const signedOut = await anonClient().rpc("pricing_inputs", {
      p_tenant_id: fresh.id,
      p_product_ids: [bike],
    });
    expect(signedOut.error).not.toBeNull();
    // Asking for this shop's settings with another shop's products finds none.
    const mixed = await inputs(owner(), [await addProduct()]);
    expect(mixed.products).toEqual([]);
  });
});

describe("the database stores and checks; it does not calculate", () => {
  const pricingFunctions = [
    "save_pricing_settings",
    "save_tax_profile",
    "save_price_template",
    "delete_price_template",
    "save_product_pricing",
    "save_price_rule",
    "pricing_inputs",
    "pricing_roles",
    "write_template_days",
    "check_template_days",
    "price_template_days_complete",
    "json_whole",
    "json_uuid",
  ];
  const named = pricingFunctions.map((name) => `'${name}'`).join(", ");

  it("no pricing function multiplies, divides or rounds", () => {
    const rows = lines(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in (${named})
        -- Comments and "select *" / "returning *" are not arithmetic.
        and regexp_replace(
            regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'),
            '(select|returning)\\s+\\*', '', 'gi')
          ~*'(\\m(round|ceil|ceiling|floor|trunc|div|mod|power)\\s*\\(|[a-z0-9_\\)]\\s*[*/%]\\s*[a-z0-9_\\(])';
    `);
    expect(rows).toEqual([]);
    // All thirteen are there to be checked.
    expect(
      lines(`
        select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('platform', 'platform_private') and p.proname in (${named});
      `),
    ).toEqual([String(pricingFunctions.length)]);
  });

  it("every pricing table: RLS on, read only for a signed-in person, nothing for a signed-out one", () => {
    for (const table of tables) {
      const rows = lines(`
        select r || ' ' || coalesce(string_agg(p, ',' order by p)
          filter (where has_table_privilege(r, 'platform.${table}', p)), 'none')
        from unnest(array['anon', 'authenticated']) r,
             unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
        group by r order by r;
        select c.relrowsecurity::text from pg_class c where c.oid = 'platform.${table}'::regclass;
        select count(*) || ' ' || string_agg(polcmd::text || ' ' || polroles::regrole[]::text, ';')
        from pg_policy where polrelid = 'platform.${table}'::regclass;
      `);
      expect(rows, table).toEqual([
        "anon none",
        "authenticated select",
        "true",
        "1 r {authenticated}",
      ]);
    }
  });

  it("every function is closed to signed-out visitors and to PUBLIC; members call the ones meant for them", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
        || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private') and p.proname in (${named})
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, PUBLIC, runs with its owner's rights, search path
      'platform.delete_price_template false true false true search_path=""',
      // The read runs as the caller, so row-level security decides.
      'platform.pricing_inputs false true false false search_path=""',
      'platform.save_price_rule false true false true search_path=""',
      'platform.save_price_template false true false true search_path=""',
      'platform.save_pricing_settings false true false true search_path=""',
      'platform.save_product_pricing false true false true search_path=""',
      'platform.save_tax_profile false true false true search_path=""',
      // Helpers and trigger functions: nobody calls them.
      'platform_private.check_template_days false false false false search_path=""',
      // Since 20261116000200 the availability read, which runs as its
      // caller, parses its request with it.
      'platform_private.json_uuid false true false false search_path=""',
      'platform_private.json_whole false false false false search_path=""',
      'platform_private.price_template_days_complete false false false true search_path=""',
      // The policies ask it, as the member.
      'platform_private.pricing_roles false true false false search_path=""',
      'platform_private.write_template_days false false false true search_path=""',
    ]);
  });

  it("the deposit is gone from products, and a general product still stores no buffers", async () => {
    expect(
      lines(`
        select count(*) from information_schema.columns
        where table_schema = 'platform' and table_name = 'products'
          and column_name in ('deposit', 'deposit_currency');
        select pg_get_constraintdef(oid) from pg_constraint
        where conrelid = 'platform.products'::regclass and conname = 'products_general_fields_check';
      `),
    ).toEqual([
      "0",
      "CHECK (((type = 'vehicle'::text) OR ((buffer_before_minutes IS NULL) AND (buffer_after_minutes IS NULL))))",
    ]);
  });
});

describe("the currency lock", () => {
  it("counts a price, a price list and the shop's settings", async () => {
    const locked = async (tenant: TestTenant) =>
      (
        await tenant.members.owner.db.rpc("currency_locked", {
          p_tenant_id: tenant.id,
        })
      ).data;
    const change = (tenant: TestTenant) =>
      service
        .from("tenants")
        .update({ currency: "USD" })
        .eq("id", tenant.id)
        .select("currency");
    const makers: ((tenant: TestTenant) => PromiseLike<unknown>)[] = [
      async (tenant) =>
        tenant.members.owner.db
          .rpc("save_product_pricing", {
            p_product_id: await addProduct("vehicle", tenant),
            p_settings: { deposit: 1 },
          })
          .throwOnError(),
      (tenant) =>
        tenant.members.owner.db
          .rpc("save_price_template", {
            p_tenant_id: tenant.id,
            p_template: {
              name: "L",
              kind: "amounts",
              days: days(1, 1),
            } as never,
          })
          .throwOnError(),
      (tenant) =>
        tenant.members.owner.db
          .rpc("save_pricing_settings", {
            p_tenant_id: tenant.id,
            p_settings: { coupons_enabled: false },
          })
          .throwOnError(),
    ];
    for (const make of makers) {
      const fresh = await createTenant("price-lock", thailand);
      try {
        expect(await locked(fresh)).toBe(false);
        await make(fresh);
        expect(await locked(fresh)).toBe(true);
        expect((await change(fresh)).error?.message).toBe("currency_locked");
      } finally {
        await deleteTenant(fresh);
      }
    }
    // With nothing stored the currency can still change.
    const empty = await createTenant("price-unlocked", thailand);
    try {
      expect((await change(empty)).data).toEqual([{ currency: "USD" }]);
    } finally {
      await deleteTenant(empty);
    }
  }, 120_000);
});

describe("lock order: the product's row, then the price list's, then the tax profile's, then the pricing row", () => {
  it("save_product_pricing waits for whoever holds the product's row", async () => {
    const id = await addProduct();
    const marker = `hold-priced-${tag}`;
    const first = sqlBackground(`
      begin;
      select 1 from platform.products where id = '${id}' for no key update;
      select pg_sleep(1.5) /* ${marker} */;
      commit;
    `);
    await holding(marker);
    const started = Date.now();
    const { error } = await savePricing("owner", id, { deposit: 1 });
    expect(error).toBeNull();
    expect(Date.now() - started).toBeGreaterThan(700);
    expect((await first).failed).toBe("");
  });

  it("while the product's row is held, no writer holds a lock on its pricing row or its price list", async () => {
    const id = await addProduct();
    const shared = await sharedList();
    await savePricing("owner", id, {
      pricing_method: "tiered",
      own_list: { days: days(30_000, 10_000) },
    }).throwOnError();
    const marker = `hold-order-priced-${tag}`;
    const holder = sqlBackground(`
      begin;
      select 1 from platform.products where id = '${id}' for no key update;
      select pg_sleep(2) /* ${marker} */;
      commit;
    `);
    await holding(marker);
    const writers = [
      savePricing("owner", id, { own_list: { days: days(31_000, 10_000) } }),
      savePricing("manager", id, { price_template_id: shared }),
      savePricing("owner", id, { deposit: 5 }),
    ];
    await new Promise((r) => setTimeout(r, 600));
    const { out } = sql(`
      select count(*) from pg_locks l
      join pg_stat_activity a on a.pid = l.pid
      where l.relation in (
          'platform.product_pricing'::regclass,
          'platform.price_templates'::regclass,
          'platform.price_template_days'::regclass)
        and l.mode in ('RowExclusiveLock', 'RowShareLock')
        and a.pid <> pg_backend_pid();
    `);
    expect(out).toBe("0");
    const results = await Promise.all(writers);
    expect((await holder).failed).toBe("");
    noDeadlock(results);
    for (const { error } of results) expect(error).toBeNull();
    const row = (await pricingRow(id))!;
    expect(row.deposit).toBe(5);
    // Whichever list won, the row points at a list that exists with 30 days.
    expect(await dayValues(row.price_template_id!)).toHaveLength(30);
  }, 30_000);

  it("save_price_template waits for whoever holds the list's row, and locks no product", async () => {
    const list = await sharedList();
    const product = await addProduct();
    await savePricing("owner", product, {
      pricing_method: "tiered",
      price_template_id: list,
    }).throwOnError();
    const marker = `hold-list-${tag}`;
    const holder = sqlBackground(`
      begin;
      select 1 from platform.products where id = '${product}' for update;
      select pg_sleep(1.2) /* ${marker} */;
      commit;
    `);
    await holding(marker);
    // The product's row is held; saving the list it is on does not wait.
    const started = Date.now();
    const { error } = await saveTemplate("owner", {
      id: list,
      days: days(31_000, 10_000),
    });
    expect(error).toBeNull();
    expect(Date.now() - started).toBeLessThan(900);
    expect((await holder).failed).toBe("");
  });
});

describe("races", () => {
  it("two saves of one price list at once: one whole list is left", async () => {
    for (let round = 0; round < 6; round++) {
      const list = await sharedList();
      const results = await Promise.all([
        saveTemplate("owner", { id: list, days: days(40_000, 10_000) }),
        saveTemplate("manager", { id: list, days: days(50_000, 10_000) }),
      ]);
      noDeadlock(results);
      for (const { error } of results) expect(error).toBeNull();
      const stored = await dayValues(list);
      expect(stored).toHaveLength(30);
      const first = stored[0].value;
      expect([40_000, 50_000]).toContain(first);
      // Never a mix of the two.
      expect(stored.map((day) => day.value)).toEqual(
        days(first, 10_000).map((day) => day.value),
      );
    }
  }, 60_000);

  it("twelve first saves of one product's pricing at once: one row, the last word kept", async () => {
    const id = await addProduct();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        savePricing(i % 2 ? "owner" : "manager", id, {
          pricing_method: "tiered",
          own_list: { days: days(30_000 + i, 10_000) },
          deposit: 1000 + i,
        }),
      ),
    );
    noDeadlock(results);
    for (const { error } of results) expect(error).toBeNull();
    const rows = await service
      .from("product_pricing")
      .select("*")
      .eq("product_id", id);
    expect(rows.data).toHaveLength(1);
    const lists = await service
      .from("price_templates")
      .select("id")
      .eq("product_id", id);
    expect(lists.data).toHaveLength(1);
    const stored = await dayValues(lists.data![0].id);
    expect(stored).toHaveLength(30);
    // The list and the deposit come from the same save.
    expect(stored[0].value - 30_000).toBe(rows.data![0].deposit! - 1000);
  }, 60_000);

  it("a product moved to a list while the list is deleted: never left on a list that is gone", async () => {
    for (let round = 0; round < 8; round++) {
      const list = await sharedList();
      const id = await addProduct();
      const [move, remove] = await Promise.all([
        savePricing("owner", id, {
          pricing_method: "tiered",
          price_template_id: list,
        }),
        db("manager").rpc("delete_price_template", { p_template_id: list }),
      ]);
      noDeadlock([move, remove]);
      const row = await pricingRow(id);
      const exists =
        (await service.from("price_templates").select("id").eq("id", list))
          .data!.length === 1;
      if (move.error) {
        // The delete won.
        expect(move.error.message).toBe("invalid_price_list");
        expect(remove.error).toBeNull();
        expect(exists).toBe(false);
        expect(row).toBeNull();
      } else {
        // The move won: the list is in use and stays.
        expect(remove.error?.message).toBe("price_list_in_use");
        expect(exists).toBe(true);
        expect(row?.price_template_id).toBe(list);
      }
    }
  }, 60_000);

  it("twelve first saves of a shop's settings at once: one row", async () => {
    const fresh = await createTenant("price-race", thailand);
    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          fresh.members[i % 2 ? "owner" : "manager"].db.rpc(
            "save_pricing_settings",
            {
              p_tenant_id: fresh.id,
              p_settings: { rounding_step: 1000 + i },
            },
          ),
        ),
      );
      noDeadlock(results);
      for (const { error } of results) expect(error).toBeNull();
      const rows = await service
        .from("pricing_settings")
        .select("*")
        .eq("tenant_id", fresh.id);
      expect(rows.data).toHaveLength(1);
    } finally {
      await deleteTenant(fresh);
    }
  }, 60_000);

  it("a season saved while one of its products is deleted: no deadlock, no link to a product that is gone", async () => {
    for (let round = 0; round < 8; round++) {
      const [keep, leave] = await Promise.all([addProduct(), addProduct()]);
      const [saved, removed] = await Promise.all([
        saveRule("owner", {
          name: `Race ${tag} ${round}`,
          starts_on: "2027-04-01",
          ends_on: "2027-09-30",
          adjust_bp: -2000,
          product_ids: [keep, leave],
        }),
        service.from("products").delete().eq("id", leave),
      ]);
      noDeadlock([saved, removed]);
      expect(removed.error).toBeNull();
      // Either the save came first (and the link went with the product) or
      // it came second and was refused by the key.
      if (saved.error) expect(saved.error.code).toBe("23503");
      const left = await service
        .from("price_rule_products")
        .select("product_id")
        .eq("product_id", leave);
      expect(left.data).toEqual([]);
    }
  }, 60_000);
});
