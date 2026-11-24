/**
 * Phase 3, stage 2a: orders: tables, RLS, customers, settings
 * (docs/phase-3-plan.md §3.1, §3.2, §3.9, §3.10, §9.1, §8 stage 2a;
 * migration 20261124000100_platform_orders).
 *
 *  - Who reads and writes the six new tables: five roles in each of two
 *    shops, a signed-in stranger, a Moto Mangos customer, a signed-out
 *    visitor.
 *  - save_customer(), and a customer's contacts never in the audit.
 *  - The six staff permissions, save_staff_permissions() and staff_may().
 *  - The time step of the date-and-time pickers.
 *  - What the tables themselves refuse.
 *  - move_unit() splitting a row keeps its rental.
 *  - A shop with an order can't change its currency (the foreign key).
 *  - Migration 2's clearing of Phase 2's bookings.
 *
 * The rows of orders, rentals, charges and lines are written here with the
 * service role: their own writers (create_order and the rest) arrive with
 * migration 3.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { roles, type Role } from "@/lib/roles";
import {
  allocationFor,
  anonClient,
  createTenant,
  createUser,
  deleteTenant,
  deleteUser,
  hours,
  period,
  serviceClient,
  sql,
  type Db,
  type TestTenant,
  type TestUser,
} from "./helpers";

type Row = Record<string, unknown>;
type Shop = TestTenant & {
  productId: string;
  customerId: string;
  orderId: string;
  rentalId: string;
  chargeId: string;
  lineId: string;
};

const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let counter = 0;

let a: Shop;
let b: Shop;
/** Signed in, with no place in any shop. */
let stranger: TestUser;
/** A Moto Mangos customer: signed in, a renter's profile, no place in any shop. */
let renter: TestUser;

/** The table name is a string here, so the typed client can't know it. */
const from = (db: Db, table: string) => db.from(table as "orders");

/** The one row of an answer; anything else is a failed step. */
function only<T>(result: { data: T[] | null; error: unknown }): T {
  if (result.error) throw result.error;
  if (!result.data || result.data.length !== 1)
    throw new Error(`Expected one row, got ${result.data?.length ?? 0}`);
  return result.data[0]!;
}

const TABLES = [
  "customers",
  "orders",
  "rentals",
  "order_charges",
  "order_lines",
  "order_counters",
] as const;
type Table = (typeof TABLES)[number];

/** Who reads each table's rows of their own shop (plan §3.9). */
const READERS: Record<Table, readonly Role[]> = {
  customers: ["owner", "manager", "staff"],
  orders: ["owner", "manager", "staff"],
  rentals: ["owner", "manager", "staff"],
  order_charges: ["owner", "manager", "staff"],
  order_lines: ["owner", "manager", "staff"],
  order_counters: [],
};

async function vehicle(tenant: TestTenant, units: number) {
  const product = only(
    await service
      .from("products")
      .insert({
        tenant_id: tenant.id,
        name: `Orders ${tag} ${++counter}`,
        vehicle_type: "motorbike",
      })
      .select("id"),
  );
  const unitIds: string[] = [];
  for (let i = 0; i < units; i++) {
    const unit = only(
      await service
        .from("units")
        .insert({
          tenant_id: tenant.id,
          product_id: product.id,
          location_id: tenant.locationId,
          plate: `OR-${tag}-${++counter}`,
        })
        .select("id"),
    );
    unitIds.push(unit.id);
  }
  return { id: product.id as string, units: unitIds };
}

const orderRow = (tenant: TestTenant, code: string) => ({
  tenant_id: tenant.id,
  code,
  status: "draft",
  channel: "walk_in",
  mode: "staff",
  currency: tenant.currency,
});

const rentalRow = (tenant: TestTenant, orderId: string, productId: string) => ({
  tenant_id: tenant.id,
  order_id: orderId,
  product_id: productId,
  product_type: "vehicle",
  location_id: tenant.locationId,
  quantity: 1,
  starts_at: "2031-05-01T03:00:00Z",
  ends_at: "2031-05-03T03:00:00Z",
  status: "draft",
});

const chargeRow = (tenant: TestTenant, orderId: string) => ({
  tenant_id: tenant.id,
  order_id: orderId,
  kind: "booking",
  currency: tenant.currency,
  priced_at: "2031-04-01T03:00:00Z",
  total: 2000,
  tax_total: 0,
  snapshot: {},
});

const lineRow = (tenant: TestTenant, orderId: string, chargeId: string) => ({
  tenant_id: tenant.id,
  order_id: orderId,
  charge_id: chargeId,
  kind: "period",
  amount: 2000,
  currency: tenant.currency,
  position: 0,
});

/** One row in each of the five tables (the counter came with the shop). */
async function withOrder(tenant: TestTenant): Promise<Shop> {
  const product = await vehicle(tenant, 0);
  const customer = only(
    await service
      .from("customers")
      .insert({
        tenant_id: tenant.id,
        full_name: "Scene Customer",
        phone: "+66811111111",
      })
      .select("id"),
  );
  // The same code in both shops: a code is unique in its own shop only.
  const order = only(
    await service
      .from("orders")
      .insert({ ...orderRow(tenant, "SCENE2"), customer_id: customer.id })
      .select("id"),
  );
  const rental = only(
    await service
      .from("rentals")
      .insert(rentalRow(tenant, order.id, product.id))
      .select("id"),
  );
  const charge = only(
    await service
      .from("order_charges")
      .insert(chargeRow(tenant, order.id))
      .select("id"),
  );
  const line = only(
    await service
      .from("order_lines")
      .insert({
        ...lineRow(tenant, order.id, charge.id),
        rental_id: rental.id,
        product_id: product.id,
        product_type: "vehicle",
      })
      .select("id"),
  );
  return {
    ...tenant,
    productId: product.id,
    customerId: customer.id,
    orderId: order.id,
    rentalId: rental.id,
    chargeId: charge.id,
    lineId: line.id,
  };
}

/**
 * Statements run as a signed-in user (or, with null, as the server), the
 * way the API would run them. Answers the lines that begin "ans:".
 */
function answersAs(userId: string | null, statements: string[]) {
  const claims = userId
    ? { sub: userId, role: "authenticated" }
    : { role: "service_role" };
  const { out, failed } = sql(
    [
      "begin;",
      `select set_config('request.jwt.claims', '${JSON.stringify(claims)}', true);`,
      `set local role ${userId ? "authenticated" : "service_role"};`,
      ...statements,
      "commit;",
    ].join("\n"),
  );
  return {
    failed,
    answers: out
      .split("\n")
      .filter((line) => line.startsWith("ans:"))
      .map((line) => line.slice(4)),
  };
}

const eventsOf = async (
  tenantId: string,
  entity: string,
  entityId?: string,
) => {
  let query = service
    .from("audit_events")
    .select("id, entity_id, action, actor, before, after")
    .eq("tenant_id", tenantId)
    .eq("entity", entity);
  if (entityId) query = query.eq("entity_id", entityId);
  const { data, error } = await query.order("id");
  if (error) throw error;
  return data;
};

beforeAll(async () => {
  const [tenantA, tenantB, one, two] = await Promise.all([
    createTenant("orders-bkk", {
      country: "TH",
      currency: "THB",
      locale: "th-TH",
      timezone: "Asia/Bangkok",
    }),
    createTenant("orders-nyc", {
      country: "US",
      currency: "USD",
      locale: "en-US",
      timezone: "America/New_York",
    }),
    createUser("orders-stranger"),
    createUser("orders-renter"),
  ]);
  stranger = one;
  renter = two;
  [a, b] = await Promise.all([withOrder(tenantA), withOrder(tenantB)]);
}, 180_000);

afterAll(async () => {
  await Promise.all([deleteTenant(a), deleteTenant(b)]);
  await Promise.all([deleteUser(stranger), deleteUser(renter)]);
}, 180_000);

describe("who reads the six tables: five roles in two shops, a stranger, a Moto Mangos customer, a signed-out visitor", () => {
  /** The tenant ids a client sees in a table; "refused" when it may not ask. */
  async function seen(db: Db, table: Table): Promise<string[] | "refused"> {
    const { data, error } = await from(db, table).select("tenant_id");
    if (error) {
      expect(error.code, `${table}: ${error.message}`).toBe("42501");
      return "refused";
    }
    return (data as unknown as Row[]).map((row) => String(row.tenant_id));
  }

  it("owners, managers and staff read their own shop's customers, orders, rentals, charges and lines; mechanics and drivers none of them; nobody signed in reads the counter; nobody reads the other shop's", async () => {
    for (const [shop, other] of [
      [a, b],
      [b, a],
    ] as const) {
      for (const role of roles) {
        for (const table of TABLES) {
          const what = `${shop.slug} ${role} reading ${table}`;
          const ids = await seen(shop.members[role].db, table);
          if (table === "order_counters") {
            expect(ids, what).toBe("refused");
            continue;
          }
          expect(ids, what).not.toBe("refused");
          expect(ids, what).not.toContain(other.id);
          expect(ids, what).toEqual(
            READERS[table].includes(role) ? [shop.id] : [],
          );
        }
      }
    }
  });

  it("asked for the other shop's rows by id, a member finds nothing", async () => {
    for (const role of roles) {
      const db = a.members[role].db;
      for (const [table, id] of [
        ["customers", b.customerId],
        ["orders", b.orderId],
        ["rentals", b.rentalId],
        ["order_charges", b.chargeId],
        ["order_lines", b.lineId],
      ] as const) {
        const { data, error } = await from(db, table).select("id").eq("id", id);
        expect(error, `${role} ${table}`).toBeNull();
        expect(data, `${role} ${table}`).toEqual([]);
      }
    }
  });

  it("a signed-in stranger and a Moto Mangos customer read nothing", async () => {
    // The renter has a Moto Mangos profile, as every customer of the
    // marketplace has, and no membership.
    const profile = await service
      .schema("public")
      .from("profiles")
      .select("id")
      .eq("id", renter.id);
    expect(profile.data).toHaveLength(1);
    const memberships = await service
      .from("memberships")
      .select("id")
      .in("user_id", [stranger.id, renter.id]);
    expect(memberships.data).toEqual([]);
    for (const [who, user] of [
      ["stranger", stranger],
      ["Moto Mangos customer", renter],
    ] as const) {
      for (const table of TABLES) {
        expect(await seen(user.db, table), `${who} reading ${table}`).toEqual(
          table === "order_counters" ? "refused" : [],
        );
      }
    }
  });

  it("a signed-out visitor is refused every table", async () => {
    const anon = anonClient();
    for (const table of TABLES) {
      const { data, error } = await from(anon, table).select("*").limit(1);
      expect(error, table).not.toBeNull();
      expect(data ?? [], table).toEqual([]);
    }
  });
});

describe("nobody signed in writes the six tables: their own shop's rows or the other's", () => {
  const snapshot = async () => {
    const result: Record<string, Row[]> = {};
    for (const table of TABLES) {
      const { data, error } = await from(service, table)
        .select("*")
        .in("tenant_id", [a.id, b.id]);
      if (error) throw error;
      result[table] = (data as unknown as Row[]).sort((x, y) =>
        JSON.stringify(x).localeCompare(JSON.stringify(y)),
      );
    }
    return result;
  };

  const payload = (shop: Shop, table: Table): Row =>
    ({
      customers: { tenant_id: shop.id, full_name: "Written directly" },
      orders: orderRow(shop, "DRCT22"),
      rentals: rentalRow(shop, shop.orderId, shop.productId),
      order_charges: { ...chargeRow(shop, shop.orderId), kind: "difference" },
      order_lines: {
        ...lineRow(shop, shop.orderId, shop.chargeId),
        position: 5,
      },
      order_counters: { tenant_id: shop.id, next_number: 50 },
    })[table];

  const change: Record<Table, Row> = {
    customers: { full_name: "Changed directly" },
    orders: { status: "canceled" },
    rentals: { status: "canceled" },
    order_charges: { status: "void" },
    order_lines: { amount: 0 },
    order_counters: { next_number: 999 },
  };

  it("insert, update and delete are refused for every role of both shops, a stranger, a Moto Mangos customer and a signed-out visitor; every row is as it was", async () => {
    const before = await snapshot();
    const writers: [string, Db][] = [
      ...roles.map((role): [string, Db] => [`A's ${role}`, a.members[role].db]),
      ...roles.map((role): [string, Db] => [`B's ${role}`, b.members[role].db]),
      ["a stranger", stranger.db],
      ["a Moto Mangos customer", renter.db],
      ["a signed-out visitor", anonClient()],
    ];
    for (const [who, db] of writers) {
      for (const shop of [a, b]) {
        for (const table of TABLES) {
          const what = `${who}, ${table} of ${shop.slug}`;
          const inserted = await from(db, table)
            .insert(payload(shop, table) as never)
            .select("*");
          expect(inserted.error, `${what}: insert`).not.toBeNull();
          expect(inserted.data ?? [], `${what}: insert`).toEqual([]);
          const updated = await from(db, table)
            .update(change[table] as never)
            .eq("tenant_id", shop.id)
            .select("*");
          expect(updated.error, `${what}: update`).not.toBeNull();
          expect(updated.data ?? [], `${what}: update`).toEqual([]);
          const deleted = await from(db, table)
            .delete()
            .eq("tenant_id", shop.id)
            .select("*");
          expect(deleted.error, `${what}: delete`).not.toBeNull();
          expect(deleted.data ?? [], `${what}: delete`).toEqual([]);
        }
      }
    }
    expect(await snapshot()).toEqual(before);
  }, 120_000);
});

describe("save_customer(): owners, managers and staff", () => {
  const save = (db: Db, shop: TestTenant, customer: Row) =>
    db.rpc("save_customer", {
      p_tenant_id: shop.id,
      p_customer: customer as never,
    });
  type Saved = { ok: true; id: string; created: boolean; updated_at: string };
  const customerOf = async (id: string) =>
    only(await service.from("customers").select("*").eq("id", id));

  it("owners, managers and staff add a customer; mechanics, drivers, a stranger, a Moto Mangos customer, the other shop's owner, a signed-out visitor and the server may not", async () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      const saved = await save(a.members[role].db, a, {
        full_name: `By ${role}`,
      });
      expect(saved.error, role).toBeNull();
      const answer = saved.data as Saved;
      expect(answer, role).toMatchObject({ ok: true, created: true });
      expect(await customerOf(answer.id), role).toMatchObject({
        tenant_id: a.id,
        full_name: `By ${role}`,
        created_by: a.members[role].id,
        phone: null,
        email: null,
        archived_at: null,
      });
    }
    const before = sql(
      `select count(*) from platform.customers where tenant_id = '${a.id}';`,
    ).out;
    for (const [who, db] of [
      ["mechanic", a.members.mechanic.db],
      ["driver", a.members.driver.db],
      ["stranger", stranger.db],
      ["Moto Mangos customer", renter.db],
      ["the other shop's owner", b.members.owner.db],
    ] as const) {
      const refused = await save(db, a, { full_name: "Not allowed" });
      expect(refused.error?.message, who).toBe("role_not_allowed");
      expect(refused.error?.code, who).toBe("42501");
    }
    // Not granted at all.
    for (const [who, db] of [
      ["signed out", anonClient()],
      ["the server", service],
    ] as const) {
      const refused = await save(db, a, { full_name: "Not allowed" });
      expect(refused.error?.code, who).toBe("42501");
      expect(refused.data, who).toBeNull();
    }
    expect(
      sql(
        `select count(*) from platform.customers where tenant_id = '${a.id}';`,
      ).out,
    ).toBe(before);
  });

  it("stores each field as it should be read: a phone as E.164 when it is an international number, else as typed; the country in capitals; an email found whatever its case", async () => {
    const db = a.members.staff.db;
    for (const [typed, stored] of [
      ["+66 81 234 5678", "+66812345678"],
      ["0066-81-234-5678", "+66812345678"],
      ["+1 (212) 555-0100", "+12125550100"],
      ["  +84.90.123.4567 ", "+84901234567"],
      // No country code: kept as typed, trimmed. Which country a national
      // number belongs to is the form's to say.
      ["081 234 5678", "081 234 5678"],
      ["ext. 12", "ext. 12"],
    ] as const) {
      const saved = await save(db, a, { full_name: "Phone", phone: typed });
      expect(saved.error, typed).toBeNull();
      expect((await customerOf((saved.data as Saved).id)).phone, typed).toBe(
        stored,
      );
    }
    const saved = await save(db, a, {
      full_name: "  Anna Example  ",
      email: " Anna@Example.Test ",
      line_id: " anna.line ",
      nationality: "de",
      language: "pt-BR",
      notes: "Prefers mornings",
    });
    expect(saved.error).toBeNull();
    const id = (saved.data as Saved).id;
    expect(await customerOf(id)).toMatchObject({
      full_name: "Anna Example",
      email: "Anna@Example.Test",
      line_id: "anna.line",
      nationality: "DE",
      language: "pt-BR",
      notes: "Prefers mornings",
    });
    const found = await service
      .from("customers")
      .select("id")
      .eq("tenant_id", a.id)
      .eq("email", "ANNA@EXAMPLE.TEST");
    expect(found.data).toEqual([{ id }]);
  });

  it("refuses what it can't store, with nothing written: no name, an unknown key, a wrong type, a bad email, country or language, a phone too long, an id that is not one", async () => {
    const db = a.members.owner.db;
    const before = sql(
      `select count(*) from platform.customers where tenant_id = '${a.id}';`,
    ).out;
    for (const bad of [
      {},
      { full_name: "" },
      { full_name: "   " },
      { full_name: null },
      { full_name: "x".repeat(201) },
      { full_name: "Ok", shoe_size: 42 },
      // The Moto Mangos account is never set from a screen.
      { full_name: "Ok", marketplace_account_id: randomUUID() },
      { full_name: "Ok", tenant_id: b.id },
      { full_name: 12 },
      { full_name: "Ok", phone: 66812345678 },
      { full_name: "Ok", archived: "yes" },
      { full_name: "Ok", email: "not-an-email" },
      { full_name: "Ok", email: "two words@example.test" },
      { full_name: "Ok", nationality: "DEU" },
      { full_name: "Ok", language: "english please" },
      { full_name: "Ok", phone: "x".repeat(41) },
      { full_name: "Ok", notes: "x".repeat(4001) },
      { id: "not-a-uuid", full_name: "Ok" },
      { id: null, full_name: "Ok" },
    ]) {
      const refused = await save(db, a, bad);
      expect(refused.error?.message, JSON.stringify(bad).slice(0, 60)).toBe(
        "invalid_customer",
      );
      expect(refused.error?.code).toBe("22023");
    }
    for (const bad of [null, [], "text", 5]) {
      const refused = await db.rpc("save_customer", {
        p_tenant_id: a.id,
        p_customer: bad as never,
      });
      expect(refused.error?.message, JSON.stringify(bad)).toBe(
        "invalid_customer",
      );
    }
    expect(
      sql(
        `select count(*) from platform.customers where tenant_id = '${a.id}';`,
      ).out,
    ).toBe(before);
  });

  it("changes only what is named; null or an empty text clears a field but never the name; an old form is answered stale; archived and back", async () => {
    const db = a.members.manager.db;
    const made = (
      await save(db, a, {
        full_name: "Ben Example",
        phone: "+66 82 000 0001",
        email: "ben@example.test",
        notes: "First note",
      })
    ).data as Saved;

    const renamed = await save(db, a, { id: made.id, full_name: "Ben E." });
    expect(renamed.data).toMatchObject({
      ok: true,
      id: made.id,
      created: false,
    });
    expect(await customerOf(made.id)).toMatchObject({
      full_name: "Ben E.",
      phone: "+66820000001",
      email: "ben@example.test",
      notes: "First note",
    });

    await save(db, a, { id: made.id, phone: null, notes: "" });
    expect(await customerOf(made.id)).toMatchObject({
      full_name: "Ben E.",
      phone: null,
      email: "ben@example.test",
      notes: null,
    });

    for (const name of [null, "", "  "]) {
      const refused = await save(db, a, { id: made.id, full_name: name });
      expect(refused.error?.message).toBe("invalid_customer");
    }

    const stale = await save(db, a, {
      id: made.id,
      full_name: "Too late",
      expected_updated_at: made.updated_at,
    });
    expect(stale.error).toBeNull();
    expect(stale.data).toEqual({ ok: false, reason: "stale" });
    const now = await customerOf(made.id);
    expect(now.full_name).toBe("Ben E.");
    const fresh = await save(db, a, {
      id: made.id,
      full_name: "In time",
      expected_updated_at: now.updated_at,
    });
    expect(fresh.data).toMatchObject({ ok: true });

    await save(db, a, { id: made.id, archived: true });
    const archived = await customerOf(made.id);
    expect(archived.archived_at).not.toBeNull();
    // Archived again: the first moment stands.
    await save(db, a, { id: made.id, archived: true });
    expect((await customerOf(made.id)).archived_at).toBe(archived.archived_at);
    await save(db, a, { id: made.id, archived: false });
    expect((await customerOf(made.id)).archived_at).toBeNull();
  });

  it("another shop's customer is answered exactly like one that does not exist, and is not touched", async () => {
    const before = await customerOf(b.customerId);
    for (const id of [b.customerId, randomUUID()]) {
      const refused = await save(a.members.owner.db, a, {
        id,
        full_name: "Taken over",
      });
      expect(refused.error?.message, id).toBe("customer_not_found");
      expect(refused.error?.code, id).toBe("P0001");
    }
    expect(await customerOf(b.customerId)).toEqual(before);
  });

  it("one customer per Moto Mangos account in a shop; the same account may be a customer of two shops", async () => {
    const account = randomUUID();
    const row = (shop: TestTenant, name: string) => ({
      tenant_id: shop.id,
      full_name: name,
      marketplace_account_id: account,
    });
    expect(
      (await service.from("customers").insert(row(a, "Renter one"))).error,
    ).toBeNull();
    expect(
      (await service.from("customers").insert(row(a, "Renter again"))).error
        ?.code,
    ).toBe("23505");
    expect(
      (await service.from("customers").insert(row(b, "Renter one"))).error,
    ).toBeNull();
  });
});

describe("a customer's contacts are never in the audit", () => {
  const PHONES = ["+66830000111", "+66830000222"];
  const EMAILS = ["carla.secret@example.test", "carla.other@example.test"];
  const LINES = ["carla-line-secret", "carla-line-other"];

  it("added, changed and cleared through save_customer(): the events say that a contact changed, by whom, and never what it was or is; other fields are recorded as usual", async () => {
    const staff = a.members.staff;
    const made = await staff.db.rpc("save_customer", {
      p_tenant_id: a.id,
      p_customer: {
        full_name: "Carla Example",
        phone: PHONES[0]!,
        email: EMAILS[0]!,
        line_id: LINES[0]!,
        nationality: "IT",
      },
    });
    expect(made.error).toBeNull();
    const id = (made.data as { id: string }).id;
    // Changed.
    await a.members.owner.db
      .rpc("save_customer", {
        p_tenant_id: a.id,
        p_customer: {
          id,
          full_name: "Carla E.",
          phone: PHONES[1]!,
          email: EMAILS[1]!,
          line_id: LINES[1]!,
        },
      })
      .throwOnError();
    // Cleared, then set again.
    await a.members.manager.db
      .rpc("save_customer", {
        p_tenant_id: a.id,
        p_customer: { id, phone: null, email: "", line_id: null },
      })
      .throwOnError();
    await staff.db
      .rpc("save_customer", {
        p_tenant_id: a.id,
        p_customer: { id, phone: PHONES[0]! },
      })
      .throwOnError();

    const events = await eventsOf(a.id, "customers", id);
    expect(events.map((e) => [e.action, e.actor, e.before, e.after])).toEqual([
      [
        "insert",
        staff.id,
        null,
        expect.objectContaining({
          full_name: "Carla Example",
          nationality: "IT",
          phone: "changed",
          email: "changed",
          line_id: "changed",
        }),
      ],
      [
        "update",
        a.members.owner.id,
        {
          full_name: "Carla Example",
          phone: "changed",
          email: "changed",
          line_id: "changed",
        },
        {
          full_name: "Carla E.",
          phone: "changed",
          email: "changed",
          line_id: "changed",
        },
      ],
      [
        "update",
        a.members.manager.id,
        { phone: "changed", email: "changed", line_id: "changed" },
        { phone: null, email: null, line_id: null },
      ],
      ["update", staff.id, { phone: null }, { phone: "changed" }],
    ]);
  });

  it("written or removed by the server directly: the same, since the table's own trigger writes the event", async () => {
    const made = only(
      await service
        .from("customers")
        .insert({
          tenant_id: a.id,
          full_name: "Dario Example",
          phone: PHONES[1]!,
          email: EMAILS[0]!,
          line_id: LINES[1]!,
        })
        .select("id"),
    );
    await service
      .from("customers")
      .update({ email: EMAILS[1]!, notes: "Called twice" })
      .eq("id", made.id)
      .throwOnError();
    await service.from("customers").delete().eq("id", made.id).throwOnError();
    const events = await eventsOf(a.id, "customers", made.id);
    expect(events.map((e) => e.action)).toEqual(["insert", "update", "delete"]);
    expect(events[1]).toMatchObject({
      actor: null,
      before: { email: "changed", notes: null },
      after: { email: "changed", notes: "Called twice" },
    });
    expect(events[2]!.before).toMatchObject({
      full_name: "Dario Example",
      phone: "changed",
      email: "changed",
      line_id: "changed",
    });
  });

  it("no audit row of either shop holds any phone number, email address or LINE id a customer has or had", async () => {
    for (const shop of [a, b]) {
      const { data, error } = await service
        .from("audit_events")
        .select("entity, before, after")
        .eq("tenant_id", shop.id);
      expect(error).toBeNull();
      const everything = JSON.stringify(data).toLowerCase();
      // What the tests above wrote, and whatever the table holds now.
      const contacts = await service
        .from("customers")
        .select("phone, email, line_id")
        .eq("tenant_id", shop.id);
      const values = [
        ...PHONES,
        ...EMAILS,
        ...LINES,
        "+66811111111",
        "+66812345678",
        "anna@example.test",
        "anna.line",
        "ben@example.test",
        "+66820000001",
        ...contacts.data!.flatMap((c) => [c.phone, c.email, c.line_id]),
      ].filter((v): v is string => typeof v === "string");
      expect(values.length).toBeGreaterThan(8);
      for (const value of values)
        expect(everything, `${shop.slug}: ${value}`).not.toContain(
          value.toLowerCase(),
        );
      // Sanity: the customers' events are there to be searched.
      expect(
        data!.filter((e) => e.entity === "customers").length,
      ).toBeGreaterThan(0);
    }
  });
});

const PERMISSIONS = [
  "change_price",
  "waive_late_charge",
  "edit_return_time",
  "revert",
  "refund",
  "write_off_credit",
] as const;
type Permission = (typeof PERMISSIONS)[number];
const setting = (p: Permission) => `staff_can_${p}` as const;
const DEFAULTS: Record<Permission, boolean> = {
  change_price: true,
  waive_late_charge: true,
  edit_return_time: true,
  revert: false,
  refund: false,
  write_off_credit: false,
};

describe("the six staff permissions (decision 6)", () => {
  const savePermissions = (db: Db, shop: TestTenant, permissions: Row) =>
    db.rpc("save_staff_permissions", {
      p_tenant_id: shop.id,
      p_permissions: permissions as never,
    });

  const settingsOf = async (shop: TestTenant) => {
    const row = only(
      await service
        .from("tenants")
        .select(PERMISSIONS.map(setting).join(", "))
        .eq("id", shop.id),
    ) as unknown as Record<string, boolean>;
    return Object.fromEntries(
      PERMISSIONS.map((p) => [p, row[setting(p)]]),
    ) as Record<Permission, boolean>;
  };

  /** staff_may() for all six, as that user would be answered. */
  const mayAs = (userId: string, shop: TestTenant) => {
    const { failed, answers } = answersAs(userId, [
      `select 'ans:' || string_agg(p || '=' || platform_private.staff_may('${shop.id}', p), ' ' order by o)
       from unnest(array[${PERMISSIONS.map((p) => `'${p}'`).join(", ")}]) with ordinality as t(p, o);`,
    ]);
    expect(failed).toBe("");
    return Object.fromEntries(
      answers[0]!.split(" ").map((pair) => {
        const [name, value] = pair.split("=");
        return [name, value === "true"];
      }),
    ) as Record<Permission, boolean>;
  };

  const all = (value: boolean) =>
    Object.fromEntries(PERMISSIONS.map((p) => [p, value])) as Record<
      Permission,
      boolean
    >;

  it("a new shop starts with price changes, late-charge waivers and return-time edits on, and reverts, refunds and write-offs off", async () => {
    expect(await settingsOf(a)).toEqual(DEFAULTS);
    expect(await settingsOf(b)).toEqual(DEFAULTS);
    // Every member reads them.
    for (const role of roles) {
      const row = only(
        await a.members[role].db
          .from("tenants")
          .select("staff_can_refund, staff_can_change_price")
          .eq("id", a.id),
      );
      expect(row, role).toEqual({
        staff_can_refund: false,
        staff_can_change_price: true,
      });
    }
  });

  it("staff_may(): owners and managers always; staff as each setting says; mechanics, drivers, a stranger, a Moto Mangos customer and another shop's people never (every setting, on and off, each role)", async () => {
    const check = async (
      settings: Record<Permission, boolean>,
      what: string,
    ) => {
      expect(await settingsOf(b), what).toEqual(settings);
      expect(mayAs(b.members.owner.id, b), `${what}: owner`).toEqual(all(true));
      expect(mayAs(b.members.manager.id, b), `${what}: manager`).toEqual(
        all(true),
      );
      expect(mayAs(b.members.staff.id, b), `${what}: staff`).toEqual(settings);
      for (const [who, id] of [
        ["mechanic", b.members.mechanic.id],
        ["driver", b.members.driver.id],
        ["stranger", stranger.id],
        ["Moto Mangos customer", renter.id],
        ["the other shop's owner", a.members.owner.id],
        ["the other shop's staff", a.members.staff.id],
      ] as const)
        expect(mayAs(id, b), `${what}: ${who}`).toEqual(all(false));
    };

    await check(DEFAULTS, "as a new shop has them");

    // Each setting alone on, the other five off; then alone off.
    for (const value of [true, false]) {
      for (const one of PERMISSIONS) {
        const settings = { ...all(!value), [one]: value };
        const saved = await savePermissions(
          b.members.owner.db,
          b,
          Object.fromEntries(PERMISSIONS.map((p) => [setting(p), settings[p]])),
        );
        expect(saved.error).toBeNull();
        await check(settings, `${one} alone ${value ? "on" : "off"}`);
      }
    }
    // The other shop was never touched.
    expect(await settingsOf(a)).toEqual(DEFAULTS);
    expect(mayAs(a.members.staff.id, a)).toEqual(DEFAULTS);
  }, 240_000);

  it("staff_may(): an unknown permission is an error, not a no; the server has no call; with nobody signed in the answer is no", () => {
    const unknown = answersAs(b.members.owner.id, [
      `select 'ans:' || platform_private.staff_may('${b.id}', 'do_anything');`,
    ]);
    expect(unknown.failed).toContain("invalid_permission");
    const empty = answersAs(b.members.owner.id, [
      `select 'ans:' || platform_private.staff_may('${b.id}', null);`,
    ]);
    expect(empty.failed).toContain("invalid_permission");
    const server = answersAs(null, [
      `select 'ans:' || platform_private.staff_may('${b.id}', 'refund');`,
    ]);
    expect(server.failed).toContain("permission denied");
    // A job inside the database (no request at all).
    expect(
      sql(`select platform_private.staff_may('${b.id}', 'change_price');`).out,
    ).toBe("f");
  });

  it("save_staff_permissions(): owners and managers; only what is named changes; staff, mechanics, drivers, a stranger, the other shop's owner, a signed-out visitor and the server are refused", async () => {
    await savePermissions(
      a.members.owner.db,
      a,
      Object.fromEntries(PERMISSIONS.map((p) => [setting(p), DEFAULTS[p]])),
    );
    const byOwner = await savePermissions(a.members.owner.db, a, {
      staff_can_refund: true,
    });
    expect(byOwner.error).toBeNull();
    expect(byOwner.data).toEqual({
      ok: true,
      permissions: Object.fromEntries(
        PERMISSIONS.map((p) => [
          setting(p),
          p === "refund" ? true : DEFAULTS[p],
        ]),
      ),
    });
    const byManager = await savePermissions(a.members.manager.db, a, {
      staff_can_refund: false,
      staff_can_revert: true,
    });
    expect(byManager.error).toBeNull();
    expect(await settingsOf(a)).toEqual({ ...DEFAULTS, revert: true });

    for (const [who, db] of [
      ["staff", a.members.staff.db],
      ["mechanic", a.members.mechanic.db],
      ["driver", a.members.driver.db],
      ["stranger", stranger.db],
      ["Moto Mangos customer", renter.db],
      ["the other shop's owner", b.members.owner.db],
    ] as const) {
      const refused = await savePermissions(db, a, { staff_can_refund: true });
      expect(refused.error?.message, who).toBe("only_owner_or_manager");
      expect(refused.error?.code, who).toBe("42501");
    }
    for (const [who, db] of [
      ["signed out", anonClient()],
      ["the server", service],
    ] as const) {
      const refused = await savePermissions(db, a, { staff_can_refund: true });
      expect(refused.error?.code, who).toBe("42501");
    }
    for (const bad of [
      { staff_can_fly: true },
      { staff_can_refund: "yes" },
      { staff_can_refund: null },
      { staff_can_refund: 1 },
      { staff_can_refund: true, time_step_minutes: 5 },
      [],
      null,
    ]) {
      const refused = await savePermissions(a.members.owner.db, a, bad as Row);
      expect(refused.error?.message, JSON.stringify(bad)).toBe(
        "invalid_permissions",
      );
    }
    expect(await settingsOf(a)).toEqual({ ...DEFAULTS, revert: true });
  });

  it("each change is an audit event with who made it and only what changed; a save that changes nothing writes none", async () => {
    const last = async () => {
      const events = await eventsOf(a.id, "tenants", a.id);
      return events[events.length - 1]!;
    };
    await savePermissions(a.members.owner.db, a, {
      staff_can_write_off_credit: true,
      staff_can_change_price: false,
    }).throwOnError();
    const event = await last();
    expect(event).toMatchObject({
      action: "update",
      actor: a.members.owner.id,
      before: {
        staff_can_write_off_credit: false,
        staff_can_change_price: true,
      },
      after: {
        staff_can_write_off_credit: true,
        staff_can_change_price: false,
      },
    });
    await savePermissions(a.members.manager.db, a, {
      staff_can_write_off_credit: true,
    }).throwOnError();
    await savePermissions(a.members.manager.db, a, {}).throwOnError();
    expect((await last()).id).toBe(event.id);
    await savePermissions(a.members.manager.db, a, {
      staff_can_write_off_credit: false,
    }).throwOnError();
    expect(await last()).toMatchObject({
      actor: a.members.manager.id,
      before: { staff_can_write_off_credit: true },
      after: { staff_can_write_off_credit: false },
    });
  });

  it("no signed-in person writes a permission or the time step straight into the shop's row, the owner included", async () => {
    const before = await settingsOf(a);
    for (const role of roles) {
      for (const change of [
        { staff_can_refund: true },
        { staff_can_revert: false },
        { time_step_minutes: 30 },
      ]) {
        const direct = await a.members[role].db
          .from("tenants")
          .update(change)
          .eq("id", a.id)
          .select("id");
        expect(direct.error?.code, `${role} ${JSON.stringify(change)}`).toBe(
          "42501",
        );
      }
    }
    expect(await settingsOf(a)).toEqual(before);
  });
});

describe("the time step of the date-and-time pickers (plan §9.1)", () => {
  const stepOf = async (db: Db, shop: TestTenant) =>
    only(await db.from("tenants").select("time_step_minutes").eq("id", shop.id))
      .time_step_minutes;

  it("is 15 minutes for a new shop, and every member reads it", async () => {
    const fresh = await createTenant("orders-step");
    try {
      expect(await stepOf(service, fresh)).toBe(15);
      for (const role of roles)
        expect(await stepOf(fresh.members[role].db, fresh), role).toBe(15);
    } finally {
      await deleteTenant(fresh);
    }
  }, 120_000);

  it("takes 1, 5, 10, 15 or 30 minutes or 1 hour, and nothing else", async () => {
    for (const step of [1, 5, 10, 15, 30, 60]) {
      const saved = await service
        .from("tenants")
        .update({ time_step_minutes: step })
        .eq("id", b.id)
        .select("time_step_minutes");
      expect(saved.error, String(step)).toBeNull();
      expect(saved.data, String(step)).toEqual([{ time_step_minutes: step }]);
    }
    for (const step of [0, -15, 2, 3, 20, 45, 59, 61, 90, 120, 1440]) {
      const refused = await service
        .from("tenants")
        .update({ time_step_minutes: step })
        .eq("id", b.id)
        .select("time_step_minutes");
      expect(refused.error?.code, String(step)).toBe("23514");
      expect(refused.error?.message, String(step)).toContain(
        "tenants_time_step_minutes_check",
      );
    }
    const empty = await service
      .from("tenants")
      .update({ time_step_minutes: null as never })
      .eq("id", b.id)
      .select("time_step_minutes");
    expect(empty.error?.code).toBe("23502");
    expect(await stepOf(service, b)).toBe(60);
    // The other shop's is its own.
    expect(await stepOf(service, a)).toBe(15);
    await service
      .from("tenants")
      .update({ time_step_minutes: 15 })
      .eq("id", b.id)
      .throwOnError();
  });
});

describe("what the tables themselves refuse (written with the service role)", () => {
  const code = () => {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from(
      { length: 6 },
      () => letters[Math.floor(Math.random() * letters.length)],
    ).join("");
  };
  const refusal = async (table: Table, row: Row) =>
    (await from(service, table).insert(row as never)).error?.code;

  it("an order: a code of 6 characters without 0, O, 1 or I, unique in its shop; a known status, channel and mode; a held order has its expiry; a number and an idempotency key are unique in the shop", async () => {
    for (const bad of ["ABC1O0", "abcdef", "ABCDE", "ABCDEFG", "ABCDI2"])
      expect(await refusal("orders", orderRow(a, bad)), bad).toBe("23514");
    // The scene's code, again in the same shop.
    expect(await refusal("orders", orderRow(a, "SCENE2"))).toBe("23505");
    for (const bad of [
      { status: "reserved" },
      { status: "cancelled" },
      { channel: "fax" },
      { mode: "magic" },
      { status: "new" },
      { number: 0 },
    ])
      expect(
        await refusal("orders", { ...orderRow(a, code()), ...bad }),
        JSON.stringify(bad),
      ).toBe("23514");

    const key = randomUUID();
    const first = {
      ...orderRow(a, code()),
      status: "new",
      hold_expires_at: hours(1).toISOString(),
      number: 7001,
      idempotency_key: key,
    };
    expect(await refusal("orders", first)).toBeUndefined();
    expect(
      await refusal("orders", { ...orderRow(a, code()), number: 7001 }),
    ).toBe("23505");
    expect(
      await refusal("orders", { ...orderRow(a, code()), idempotency_key: key }),
    ).toBe("23505");
    // The other shop may use both.
    expect(
      await refusal("orders", {
        ...orderRow(b, code()),
        number: 7001,
        idempotency_key: key,
      }),
    ).toBeUndefined();
    // Any number of orders wait for their number at once.
    expect(await refusal("orders", orderRow(a, code()))).toBeUndefined();
    expect(await refusal("orders", orderRow(a, code()))).toBeUndefined();
  });

  it("a rental: one vehicle only; ends after it starts; an extra's parent is a rental, a vehicle has none; a known status", async () => {
    const rental = rentalRow(a, a.orderId, a.productId);
    for (const bad of [
      { quantity: 2 },
      { quantity: 0 },
      { ends_at: rental.starts_at },
      { status: "out" },
      { parent_rental_id: a.rentalId },
    ])
      expect(
        await refusal("rentals", { ...rental, ...bad }),
        JSON.stringify(bad),
      ).toBe("23514");
    expect(await refusal("rentals", rental)).toBeUndefined();
  });

  it("a charge and a line: the kinds of the plan, cancellation_fee and marketplace_fee among them, and no other; a price changed by hand has its reason; a deposit is never negative", async () => {
    for (const kind of [
      "booking",
      "period",
      "extension",
      "addition",
      "swap",
      "early_return",
      "late_return",
      "difference",
      "cancellation_fee",
    ])
      expect(
        await refusal("order_charges", { ...chargeRow(a, a.orderId), kind }),
        kind,
      ).toBeUndefined();
    for (const bad of [
      { kind: "tip" },
      { status: "settled" },
      { deposit: -1 },
      { snapshot: [] },
      { rate_groups: {} },
    ])
      expect(
        await refusal("order_charges", { ...chargeRow(a, a.orderId), ...bad }),
        JSON.stringify(bad),
      ).toBe("23514");

    const line = lineRow(a, a.orderId, a.chargeId);
    let position = 10;
    for (const kind of [
      "period",
      "extra",
      "sale_item",
      "fee",
      "credit",
      "manual",
      "marketplace_fee",
    ])
      expect(
        await refusal("order_lines", {
          ...line,
          kind,
          // The Moto Mangos fee is a negative line (decision 38).
          amount: kind === "marketplace_fee" ? -150 : 100,
          position: position++,
        }),
        kind,
      ).toBeUndefined();
    for (const bad of [
      { kind: "tip" },
      { override_by: a.members.staff.id },
      { override_by: a.members.staff.id, override_reason: "  " },
      { product_id: a.productId },
      { deposit: -1 },
      { tax_rate_bp: 10001 },
      {
        period_start: "2031-05-03T03:00:00Z",
        period_end: "2031-05-01T03:00:00Z",
      },
    ])
      expect(
        await refusal("order_lines", { ...line, ...bad, position: position++ }),
        JSON.stringify(bad),
      ).toBe("23514");
    expect(
      await refusal("order_lines", {
        ...line,
        override_by: a.members.staff.id,
        override_reason: "Regular customer",
        position: position++,
      }),
    ).toBeUndefined();
  });

  it("a shop gets its order counter when it is made, starting at 1; a reservation's rental may be empty until migration 3", async () => {
    expect(
      sql(
        `select next_number from platform.order_counters where tenant_id in ('${a.id}', '${b.id}') order by 1;`,
      ).out,
    ).toBe("1\n1");
    expect(
      sql(
        `select count(*) from platform.tenants t where not exists (select 1 from platform.order_counters c where c.tenant_id = t.id);`,
      ).out,
    ).toBe("0");
    expect(
      sql(
        `select is_nullable from information_schema.columns where table_schema = 'platform' and table_name = 'reservations' and column_name = 'rental_id';`,
      ).out,
    ).toBe("YES");
  });
});

describe("move_unit(): a row for several units that is split keeps its rental (M2)", () => {
  type Booked = {
    ok: true;
    booking_id: string;
    lines: { reservation_id: string; unit_ids: string[] }[];
  };
  const book = async (productId: string, quantity: number, day: number) => {
    const from = new Date(Date.UTC(2032, 0, day, 3));
    const to = new Date(Date.UTC(2032, 0, day + 2, 3));
    const { data, error } = await a.members.staff.db.rpc("reserve", {
      p_tenant_id: a.id,
      p_request: {
        channel: "walk_in",
        mode: "staff",
        lines: [
          {
            product_id: productId,
            location_id: a.locationId,
            starts_at: from.toISOString(),
            ends_at: to.toISOString(),
            quantity,
          },
        ],
      },
    });
    expect(error).toBeNull();
    expect((data as { ok: boolean }).ok, JSON.stringify(data)).toBe(true);
    return data as Booked;
  };
  const move = async (unitId: string, productId: string) => {
    const { data, error } = await a.members.owner.db.rpc("move_unit", {
      p_tenant_id: a.id,
      p_unit_id: unitId,
      p_product_id: productId,
      p_location_id: a.locationId,
    });
    expect(error).toBeNull();
    return data as { ok: boolean; reservation_ids: string[] };
  };
  const reservation = async (id: string) =>
    only(
      await service
        .from("reservations")
        .select("id, booking_id, product_id, quantity, rental_id, state")
        .eq("id", id),
    );

  it("the moved unit's new row carries the same rental; the row it left keeps it; a row for one unit moved in place keeps it; a booking with no rental stays without", async () => {
    const x = await vehicle(a, 3);
    const y = await vehicle(a, 0);
    const order = only(
      await service
        .from("orders")
        .insert({ ...orderRow(a, "SPLT22"), status: "booked" })
        .select("id"),
    );
    const rental = only(
      await service
        .from("rentals")
        .insert({ ...rentalRow(a, order.id, x.id), status: "booked" })
        .select("id"),
    );

    // Three units in one row, as Phase 2's reserve() still books them; the
    // row is given its rental the way migration 3's core will write it.
    const big = await book(x.id, 3, 5);
    const original = big.lines[0]!.reservation_id;
    await service
      .from("reservations")
      .update({ rental_id: rental.id })
      .eq("id", original)
      .throwOnError();

    const [first, second] = big.lines[0]!.unit_ids;
    const moved = await move(first!, y.id);
    expect(moved.ok).toBe(true);
    const part = moved.reservation_ids[0]!;
    expect(part).not.toBe(original);
    expect(await reservation(part)).toMatchObject({
      booking_id: big.booking_id,
      product_id: y.id,
      quantity: 1,
      rental_id: rental.id,
      state: "reserved",
    });
    expect(await reservation(original)).toMatchObject({
      product_id: x.id,
      quantity: 2,
      rental_id: rental.id,
    });
    // The rental's live reservations are still all of its stock: 3 units.
    expect(
      sql(
        `select sum(quantity) || ' ' || count(*) from platform.reservations where rental_id = '${rental.id}' and state in ('held', 'reserved', 'out');`,
      ).out,
    ).toBe("3 2");

    // The part is a row for one unit: moved back, it is the same row.
    const back = await move(first!, x.id);
    expect(back.reservation_ids).toEqual([part]);
    expect(await reservation(part)).toMatchObject({
      product_id: x.id,
      rental_id: rental.id,
    });

    // A second split of the same row.
    const again = await move(second!, y.id);
    expect(again.reservation_ids[0]).not.toBe(original);
    expect(await reservation(again.reservation_ids[0]!)).toMatchObject({
      quantity: 1,
      rental_id: rental.id,
    });
    expect(await reservation(original)).toMatchObject({
      quantity: 1,
      rental_id: rental.id,
    });

    // A Phase 2 booking, with no rental: its split has none either.
    const z = await vehicle(a, 2);
    const plain = await book(z.id, 2, 12);
    const split = await move(plain.lines[0]!.unit_ids[0]!, y.id);
    expect(split.ok).toBe(true);
    expect(await reservation(split.reservation_ids[0]!)).toMatchObject({
      quantity: 1,
      rental_id: null,
    });
    expect(await reservation(plain.lines[0]!.reservation_id)).toMatchObject({
      quantity: 1,
      rental_id: null,
    });
  }, 120_000);
});

describe("a shop's currency is held by its orders and charges (S8)", () => {
  it("a shop with an order can't change its currency, whoever asks; with the order gone it can; neither key cascades", async () => {
    const shop = await createTenant("orders-currency");
    try {
      const change = (db: Db, currency: string) =>
        db
          .from("tenants")
          .update({ currency })
          .eq("id", shop.id)
          .select("currency");

      // Nothing holds it yet.
      const free = await change(shop.members.owner.db, "USD");
      expect(free.error).toBeNull();
      expect(free.data).toEqual([{ currency: "USD" }]);

      const order = only(
        await service
          .from("orders")
          .insert({ ...orderRow(shop, "CRNC22"), currency: "USD" })
          .select("id"),
      );
      for (const [who, db] of [
        ["the owner", shop.members.owner.db],
        ["the server", service],
      ] as const) {
        const refused = await change(db, "EUR");
        expect(refused.error?.code, who).toBe("23503");
        expect(refused.error?.message, who).toContain("orders_currency_fkey");
      }
      expect(
        sql(
          `update platform.tenants set currency = 'EUR' where id = '${shop.id}';`,
        ).failed,
      ).toContain("orders_currency_fkey");

      // A charge holds it as its order does (a void one too).
      const charge = only(
        await service
          .from("order_charges")
          .insert({
            ...chargeRow(shop, order.id),
            currency: "USD",
            status: "void",
          })
          .select("id"),
      );
      const held = await change(shop.members.owner.db, "EUR");
      expect(held.error?.code).toBe("23503");
      expect(held.error?.message).toMatch(
        /orders_currency_fkey|order_charges_currency_fkey/,
      );
      expect(
        only(await service.from("tenants").select("currency").eq("id", shop.id))
          .currency,
      ).toBe("USD");

      await service
        .from("order_charges")
        .delete()
        .eq("id", charge.id)
        .throwOnError();
      await service.from("orders").delete().eq("id", order.id).throwOnError();
      const after = await change(shop.members.owner.db, "EUR");
      expect(after.error).toBeNull();
      expect(after.data).toEqual([{ currency: "EUR" }]);

      // No action on update and on delete, for all three.
      expect(
        sql(
          `select conname || ' ' || confupdtype::text || confdeltype::text from pg_constraint
           where conname in ('orders_currency_fkey', 'order_charges_currency_fkey', 'order_lines_currency_fkey')
           order by 1;`,
        ).out.split("\n"),
      ).toEqual([
        "order_charges_currency_fkey aa",
        "order_lines_currency_fkey aa",
        "orders_currency_fkey aa",
      ]);
    } finally {
      await deleteTenant(shop);
    }
  }, 120_000);
});

describe("migration 2 clears Phase 2's bookings (S7, decision 24)", () => {
  const migration = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../supabase/migrations/20261124000100_platform_orders.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  it("run again here, inside a transaction that is rolled back: every reservation, its allocation and hold blocks and every coupon redemption go; downtime, coupons, products, units, orders and customers stay", async () => {
    const parts = migration.split(/^-- clear:(?:begin|end)$/m);
    expect(parts).toHaveLength(3);
    const block = parts[1]!;
    expect(block).toContain("delete from platform.reservations;");

    // A scene in shop A: a booking with its allocation, a hold, a downtime
    // block, a coupon used once and given back once.
    const bike = await vehicle(a, 2);
    const [one, two] = bike.units;
    await service
      .from("unit_blocks")
      .insert(await allocationFor(a.id, one!, hours(200), hours(210)))
      .throwOnError();
    const held = await a.members.staff.db.rpc("reserve", {
      p_tenant_id: a.id,
      p_request: {
        channel: "walk_in",
        mode: "staff",
        hold: true,
        lines: [
          {
            product_id: bike.id,
            location_id: a.locationId,
            starts_at: hours(300).toISOString(),
            ends_at: hours(310).toISOString(),
            quantity: 1,
          },
        ],
      },
    });
    expect((held.data as { ok: boolean }).ok, JSON.stringify(held.data)).toBe(
      true,
    );
    await service
      .from("unit_blocks")
      .insert({
        tenant_id: a.id,
        unit_id: two!,
        kind: "downtime",
        period: period(hours(400), hours(410)),
      })
      .throwOnError();
    const coupon = only(
      await service
        .from("coupons")
        .insert({
          tenant_id: a.id,
          currency: a.currency,
          code: `CLEAR${tag.toUpperCase()}`,
          kind: "percent",
          percent_bp: 1000,
        })
        .select("id"),
    );
    await service
      .from("coupon_redemptions")
      .insert([
        {
          tenant_id: a.id,
          coupon_id: coupon.id,
          booking_id: randomUUID(),
          amount: 100,
        },
        {
          tenant_id: a.id,
          coupon_id: coupon.id,
          booking_id: randomUUID(),
          amount: 100,
          released_at: new Date().toISOString(),
        },
      ])
      .throwOnError();

    const mine = `tenant_id = '${a.id}'`;
    const counts = `
      select 'ans:' || concat_ws(' ',
        'all', (select count(*) from platform.reservations),
        (select count(*) from platform.unit_blocks where reservation_id is not null),
        (select count(*) from platform.coupon_redemptions),
        'mine', (select count(*) from platform.reservations where ${mine}),
        (select count(*) from platform.unit_blocks where reservation_id is not null and ${mine}),
        (select count(*) from platform.unit_blocks where kind = 'hold' and ${mine}),
        (select count(*) from platform.coupon_redemptions where ${mine}),
        'kept', (select count(*) from platform.unit_blocks where reservation_id is null),
        (select count(*) from platform.coupons),
        (select count(*) from platform.products),
        (select count(*) from platform.units),
        (select count(*) from platform.orders),
        (select count(*) from platform.rentals),
        (select count(*) from platform.customers));`;
    const run = sql(
      ["begin;", counts, block, counts, "rollback;", counts].join("\n"),
    );
    expect(run.failed).toBe("");
    const [before, inside, after] = run.out
      .split("\n")
      .filter((line) => line.startsWith("ans:"))
      .map((line) => line.slice(4));

    // Before: this shop's two reservations (the booking and the hold), their
    // two blocks (one a hold) and two redemptions are there at least.
    const numbers = (line: string) => line.match(/\d+/g)!.map(Number);
    const [allR, allB, allC, myR, myB, myHolds, myC, ...kept] = numbers(
      before!,
    );
    expect(myR).toBeGreaterThanOrEqual(2);
    expect(myB).toBeGreaterThanOrEqual(2);
    expect(myHolds).toBeGreaterThanOrEqual(1);
    expect(myC).toBe(2);
    expect(allR).toBeGreaterThanOrEqual(myR!);
    expect(allB).toBeGreaterThanOrEqual(myB!);
    expect(allC).toBeGreaterThanOrEqual(2);
    // The downtime block, the coupon and the rest are counted in "kept".
    expect(kept[0]).toBeGreaterThanOrEqual(1);
    expect(kept[1]).toBeGreaterThanOrEqual(1);

    // Inside: none of the three left, anywhere; everything else as it was.
    expect(inside).toBe(`all 0 0 0 mine 0 0 0 0 kept ${kept.join(" ")}`);
    // Rolled back: this database is as it was.
    expect(after).toBe(before);
  }, 120_000);

  it("the migration clears before it adds reservations.rental_id, and stops if anything is left", () => {
    expect(migration.indexOf("-- clear:end")).toBeLessThan(
      migration.indexOf("add column rental_id uuid"),
    );
    expect(migration).toMatch(
      /if v_reservations <> 0 or v_blocks <> 0 or v_redemptions <> 0 then\s+raise exception/,
    );
  });
});
