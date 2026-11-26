/**
 * Phase 3, stage 2b: the order core (migration 20261125000100;
 * docs/phase-3-plan.md §2, §3.3, §4.2, §5.1, §8 row 2b).
 *
 * What is new with orders, beside Phase 2's tests, which were ported to
 * create_order() (reservations, availability, booking-rules, coupons,
 * product-extras): the order and its rentals, numbering, the idempotency
 * key, the 200-line cap, drafts held again, a hold that has run out being
 * settled and kept, the per-customer coupon limit, which key failures are
 * "a unit was taken", the same unit twice on one order, charges, cancelling,
 * the currency lock, and migration 3's own re-check.
 *
 * Three shops: Bangkok (THB), New York (USD, daylight saving), Saigon (VND).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exactlyOne } from "@mango/db/rows";
import {
  createCustomer,
  createTenant,
  createUser,
  type Db,
  deleteTenant,
  deleteUser,
  GATE_TIMEOUTS,
  period,
  serviceClient,
  sql,
  sqlAs,
  type TestTenant,
  type TestUser,
} from "./helpers";

vi.setConfig(GATE_TIMEOUTS);

let shop: TestTenant;
let newYork: TestTenant;
let saigon: TestTenant;
let outsider: TestUser;
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let counter = 0;
const name = (what: string) => `${what} ${tag} ${++counter}`;
let deadlocksBefore: number;

const staff = (tenant: TestTenant = shop): Db => tenant.members.staff.db;

/** A moment far ahead: day `d` at `h` o'clock UTC. Every test has its own products. */
const at = (d: number, h = 3) =>
  new Date(Date.UTC(2035, 2, 1) + d * 86_400_000 + h * 3_600_000);

type Raw = Record<string, unknown> & {
  ok: boolean;
  reason?: string;
  order_id?: string;
  lines?: {
    rental_id: string;
    reservation_id: string | null;
    unit_ids: string[];
    shortage: number;
  }[];
};

/** create_order() as it is, with nothing folded: the order the test wrote. */
const order = async (
  client: Db,
  tenant: TestTenant,
  p_order: Record<string, unknown>,
) => {
  const { data, error } = await client.rpc("create_order", {
    p_tenant_id: tenant.id,
    p_order: p_order as never,
  });
  return { data: data as Raw | null, error };
};

const line = (
  tenant: TestTenant,
  productId: string,
  from: Date,
  to: Date,
  more: Record<string, unknown> = {},
) => ({
  product_id: productId,
  location_id: tenant.locationId,
  starts_at: from.toISOString(),
  ends_at: to.toISOString(),
  quantity: 1,
  ...more,
});

const walkIn = (
  lines: Record<string, unknown>[],
  more: Record<string, unknown> = {},
) => ({ channel: "walk_in", mode: "staff", action: "reserve", lines, ...more });

async function vehicle(
  count: number,
  tenant: TestTenant = shop,
  buffers: { before?: number; after?: number } = {},
) {
  const product = await exactlyOne(
    service
      .from("products")
      .insert({
        tenant_id: tenant.id,
        name: name("Scooter"),
        vehicle_type: "motorbike",
        buffer_before_minutes: buffers.before ?? null,
        buffer_after_minutes: buffers.after ?? null,
      })
      .select("id")
      .throwOnError(),
  );
  const units = await service
    .from("units")
    .insert(
      Array.from({ length: count }, () => ({
        tenant_id: tenant.id,
        product_id: product.data!.id,
        location_id: tenant.locationId,
        plate: `OC-${tag}-${++counter}`,
      })),
    )
    .select("id")
    .throwOnError();
  return { id: product.data!.id, units: units.data!.map((u) => u.id) };
}

async function gear(quantity: number, tenant: TestTenant = shop) {
  const { data, error } = await tenant.members.owner.db.rpc(
    "create_general_product",
    {
      p_tenant_id: tenant.id,
      p_type: "gear",
      p_name: name("Helmet"),
      p_track_units: false,
      p_quantities: [{ location_id: tenant.locationId, quantity }],
    } as never,
  );
  if (error) throw new Error(error.message);
  return data as unknown as string;
}

/** A coupon saved by the owner, with "Accept coupons" on. */
async function coupon(tenant: TestTenant, over: Record<string, unknown>) {
  const on = await tenant.members.owner.db.rpc("save_pricing_settings", {
    p_tenant_id: tenant.id,
    p_settings: { coupons_enabled: true } as never,
  });
  if (on.error) throw new Error(on.error.message);
  const { data, error } = await tenant.members.owner.db.rpc("save_coupon", {
    p_tenant_id: tenant.id,
    p_coupon: {
      code: `OC${tag}${++counter}`.toUpperCase(),
      kind: "percent",
      percent_bp: 1000,
      channels: ["staff", "booking_page", "marketplace"],
      ...over,
    },
  } as never);
  if (error) throw new Error(error.message);
  return (data as unknown as { id: string }).id;
}

/** Everything an order writes in a shop, counted. */
async function written(tenant: TestTenant = shop) {
  const out = sql(`
    select jsonb_build_object(
      'orders', (select count(*) from platform.orders where tenant_id = '${tenant.id}'),
      'rentals', (select count(*) from platform.rentals where tenant_id = '${tenant.id}'),
      'reservations', (select count(*) from platform.reservations where tenant_id = '${tenant.id}'),
      'blocks', (select count(*) from platform.unit_blocks where tenant_id = '${tenant.id}'),
      'charges', (select count(*) from platform.order_charges where tenant_id = '${tenant.id}'),
      'lines', (select count(*) from platform.order_lines where tenant_id = '${tenant.id}'),
      'redemptions', (select count(*) from platform.coupon_redemptions where tenant_id = '${tenant.id}'),
      'events', (select count(*) from platform.audit_events where tenant_id = '${tenant.id}' and entity in ('bookings', 'orders', 'rentals')),
      'next_number', (select next_number from platform.order_counters where tenant_id = '${tenant.id}')
    )::text;`);
  if (out.failed) throw new Error(out.failed);
  return JSON.parse(out.out) as Record<string, number>;
}

const orderRow = async (id: string) =>
  (
    await exactlyOne(
      service
        .from("orders")
        .select(
          "status, number, code, hold_expires_at, channel, mode, customer_id, cancelled_by, cancel_reason, canceled_at, no_show, currency, created_by",
        )
        .eq("id", id)
        .throwOnError(),
    )
  ).data!;

const statesOf = async (orderId: string) =>
  (
    await service
      .from("reservations")
      .select("state, created_at, id")
      .eq("booking_id", orderId)
      .order("created_at")
      .order("id")
      .throwOnError()
  ).data!.map((r) => r.state);

/** The order's hold, and its reservations', as if it ran out a minute ago. */
const runOut = (orderId: string) => {
  const done = sql(`
    update platform.orders set hold_expires_at = now() - interval '1 minute' where id = '${orderId}';
    update platform.reservations set hold_expires_at = now() - interval '1 minute'
      where booking_id = '${orderId}' and state = 'held';`);
  if (done.failed) throw new Error(done.failed);
};

const deadlocks = () =>
  Number(
    sql(
      `select pg_stat_force_next_flush(); select deadlocks from pg_stat_database where datname = current_database();`,
    )
      .out.split("\n")
      .pop(),
  );

/** A booking charge that adds up: one line, no VAT. */
const charge = (total: number, more: Record<string, unknown> = {}) => ({
  kind: "booking",
  priced_at: "2035-01-01T00:00:00Z",
  total: String(total),
  tax_total: "0",
  deposit: "0",
  rate_groups: [],
  snapshot: { version: 1, non_taxable: String(total) },
  lines: [
    { rental: 0, kind: "period", amount: String(total), tax_amount: "0" },
  ],
  ...more,
});

beforeAll(async () => {
  deadlocksBefore = deadlocks();
  [shop, newYork, saigon, outsider] = await Promise.all([
    createTenant("core-bkk", {
      country: "TH",
      currency: "THB",
      locale: "th-TH",
      timezone: "Asia/Bangkok",
    }),
    createTenant("core-nyc", {
      country: "US",
      currency: "USD",
      locale: "en-US",
      timezone: "America/New_York",
    }),
    createTenant("core-sgn"),
    createUser("core-outsider"),
  ]);
}, 120_000);

afterAll(async () => {
  await Promise.all([
    deleteTenant(shop),
    deleteTenant(newYork),
    deleteTenant(saigon),
    deleteUser(outsider),
  ]);
});

describe("create_order(): what an order writes", () => {
  it("an order, a rental and a reservation per line, its number and code, who made it; the answer names them", async () => {
    const bike = await vehicle(2);
    const helmet = await gear(4);
    const customer = await createCustomer(shop.id);
    const before = await written();
    const { data, error } = await order(
      staff(),
      shop,
      walkIn(
        [
          line(shop, bike.id, at(1), at(3)),
          line(shop, helmet, at(1), at(3), { quantity: 2, parent: 0 }),
          line(shop, bike.id, at(1), at(3)),
        ],
        { customer_id: customer, notes: "Hotel pickup" },
      ),
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, status: "booked" });
    expect(data).not.toHaveProperty("hold_expires_at");
    const row = await orderRow(data!.order_id!);
    expect(row).toMatchObject({
      status: "booked",
      number: before.next_number,
      channel: "walk_in",
      mode: "staff",
      customer_id: customer,
      currency: "THB",
      hold_expires_at: null,
      created_by: shop.members.staff.id,
    });
    expect(row.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(data).toMatchObject({ number: row.number, code: row.code });

    const rentals = (
      await service
        .from("rentals")
        .select(
          "id, position, product_id, product_type, quantity, status, parent_rental_id",
        )
        .eq("order_id", data!.order_id!)
        .order("position")
        .throwOnError()
    ).data!;
    expect(rentals.map((r) => r.id)).toEqual(
      data!.lines!.map((l) => l.rental_id),
    );
    expect(rentals).toMatchObject([
      { position: 0, product_type: "vehicle", quantity: 1, status: "booked" },
      {
        position: 1,
        product_type: "gear",
        quantity: 2,
        status: "booked",
        parent_rental_id: rentals[0].id,
      },
      { position: 2, product_type: "vehicle", quantity: 1, status: "booked" },
    ]);
    const reservations = (
      await service
        .from("reservations")
        .select("id, rental_id, booking_id, state, quantity")
        .eq("booking_id", data!.order_id!)
        .throwOnError()
    ).data!;
    expect(
      data!.lines!.map((l) =>
        reservations.find((r) => r.id === l.reservation_id),
      ),
    ).toMatchObject(
      rentals.map((r) => ({
        rental_id: r.id,
        state: "reserved",
        quantity: r.quantity,
      })),
    );
    // Two bikes, each its own unit.
    expect(
      new Set([...data!.lines![0].unit_ids, ...data!.lines![2].unit_ids]),
    ).toEqual(new Set(bike.units));
    expect(await written()).toMatchObject({
      orders: before.orders + 1,
      rentals: before.rentals + 3,
      reservations: before.reservations + 3,
      next_number: before.next_number + 1,
    });
  });

  it("a vehicle line is one vehicle: a quantity above 1 is invalid_request, and nothing is written", async () => {
    const bike = await vehicle(3);
    const before = await written();
    const { data, error } = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(1), at(2), { quantity: 2 })]),
    );
    expect(data).toBeNull();
    expect(error?.message).toBe("invalid_request");
    expect(await written()).toEqual(before);
  });

  it("a held order is 'new' with one hold expiry, copied to its reservations", async () => {
    const bike = await vehicle(2);
    const { data } = await order(
      staff(),
      shop,
      walkIn(
        [line(shop, bike.id, at(1), at(2)), line(shop, bike.id, at(1), at(2))],
        {
          action: "hold",
        },
      ),
    );
    expect(data).toMatchObject({ ok: true, status: "new" });
    const row = await orderRow(data!.order_id!);
    expect(row.status).toBe("new");
    expect(Date.parse(row.hold_expires_at!)).toBe(
      Date.parse(data!.hold_expires_at as string),
    );
    const held = (
      await service
        .from("reservations")
        .select("state, hold_expires_at")
        .eq("booking_id", data!.order_id!)
        .throwOnError()
    ).data!;
    expect(held).toHaveLength(2);
    for (const r of held) {
      expect(r.state).toBe("held");
      expect(Date.parse(r.hold_expires_at!)).toBe(
        Date.parse(row.hold_expires_at!),
      );
    }
  });

  it("a draft holds nothing: an order and its rentals, no reservation, no block, no coupon use; units can't be named", async () => {
    const bike = await vehicle(1);
    const code = await coupon(shop, { max_uses: 1 });
    const before = await written();
    const { data, error } = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(1), at(2))], {
        action: "draft",
        coupon: { coupon_id: code, amount: "100" },
      }),
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({
      ok: true,
      status: "draft",
      lines: [{ reservation_id: null, unit_ids: [], shortage: 0 }],
    });
    expect(await written()).toMatchObject({
      orders: before.orders + 1,
      rentals: before.rentals + 1,
      reservations: before.reservations,
      blocks: before.blocks,
      redemptions: before.redemptions,
      next_number: before.next_number + 1,
    });
    // The bike is still free for someone else.
    const other = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(1), at(2))]),
    );
    expect(other.data).toMatchObject({ ok: true });
    const named = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(5), at(6), { unit_ids: bike.units })], {
        action: "draft",
      }),
    );
    expect(named.error?.message).toBe("invalid_request");
  });

  it("who may: a member for the counter, the server for online, nobody else; no customer of another shop", async () => {
    const bike = await vehicle(1);
    const theirs = await createCustomer(saigon.id);
    const before = await written();
    const asServer = await order(
      service,
      shop,
      walkIn([line(shop, bike.id, at(1), at(2))]),
    );
    expect(asServer.data).toEqual({
      ok: false,
      reason: "not_allowed",
      line: null,
    });
    for (const role of ["mechanic", "driver"] as const) {
      const refused = await order(
        shop.members[role].db,
        shop,
        walkIn([line(shop, bike.id, at(1), at(2))]),
      );
      expect(refused.data, role).toEqual({
        ok: false,
        reason: "not_allowed",
        line: null,
      });
    }
    const stranger = await order(
      outsider.db,
      shop,
      walkIn([line(shop, bike.id, at(1), at(2))]),
    );
    expect(stranger.data).toEqual({
      ok: false,
      reason: "not_allowed",
      line: null,
    });
    for (const customer_id of [theirs, randomUUID()]) {
      const { error } = await order(
        staff(),
        shop,
        walkIn([line(shop, bike.id, at(1), at(2))], { customer_id }),
      );
      expect(error?.message).toBe("customer_not_found");
    }
    expect(await written()).toEqual(before);
  });
});

describe("numbering", () => {
  it("50 orders at once in each shop: no number and no code twice, the numbers run on from the counter, and every order has its number", async () => {
    const before = deadlocks();
    await Promise.all(
      [shop, newYork, saigon].map(async (tenant) => {
        const helmet = await gear(100, tenant);
        const start = (await written(tenant)).next_number;
        const answers = await Promise.all(
          Array.from({ length: 50 }, (_, i) =>
            order(
              i % 2 ? tenant.members.owner.db : tenant.members.staff.db,
              tenant,
              walkIn([line(tenant, helmet, at(1), at(2))]),
            ),
          ),
        );
        for (const { data, error } of answers) {
          expect(error, tenant.slug).toBeNull();
          expect(data?.ok, `${tenant.slug} ${data?.reason}`).toBe(true);
        }
        const numbers = answers.map((a) => a.data!.number as number);
        expect(new Set(numbers).size, tenant.slug).toBe(50);
        expect(
          [...numbers].sort((a, b) => a - b),
          tenant.slug,
        ).toEqual(Array.from({ length: 50 }, (_, i) => start + i));
        expect(new Set(answers.map((a) => a.data!.code)).size).toBe(50);
        const stored = (
          await service
            .from("orders")
            .select("number, code")
            .in(
              "id",
              answers.map((a) => a.data!.order_id!),
            )
            .throwOnError()
        ).data!;
        expect(stored.every((o) => o.number !== null)).toBe(true);
        expect((await written(tenant)).next_number).toBe(start + 50);
      }),
    );
    expect(deadlocks()).toBe(before);
  }, 180_000);

  it("an order with no number can't be committed, whoever writes it; with its number in the same transaction it can", async () => {
    const insert = (number: string) => `
      insert into platform.orders (tenant_id, code, status, channel, mode, currency${number ? ", number" : ""})
      values ('${shop.id}', 'ZZZZ${String(++counter).padStart(2, "2").replace(/[01]/g, "3")}', 'draft', 'walk_in', 'staff', 'THB'${number});`;
    const refused = sql(`begin; ${insert("")} commit;`);
    expect(refused.failed).toMatch(/order_without_number/);
    // Deferred: the number may come later in the same transaction.
    const later = sql(`
      begin;
      ${insert("")}
      update platform.orders set number = 900000000 + ${counter} where tenant_id = '${shop.id}' and number is null;
      commit;`);
    expect(later.failed).toBe("");
    const taken = sql(`
      begin;
      update platform.orders set number = null where tenant_id = '${shop.id}' and number = 900000000 + ${counter};
      commit;`);
    expect(taken.failed).toMatch(/order_without_number/);
    expect(
      sql(
        `select tgdeferrable::text || ' ' || tginitdeferred::text from pg_trigger where tgname = 'orders_require_number';`,
      ).out,
    ).toBe("true true");
  });
});

describe("the idempotency key", () => {
  it("a repeat answers the order the first call made, marked a repeat, and writes nothing; another key books again", async () => {
    const bike = await vehicle(2);
    const key = randomUUID();
    const request = walkIn([line(shop, bike.id, at(1), at(2))], {
      idempotency_key: key,
    });
    const first = await order(staff(), shop, request);
    expect(first.data).toMatchObject({ ok: true });
    expect(first.data).not.toHaveProperty("repeat");
    const before = await written();
    const again = await order(shop.members.owner.db, shop, request);
    expect(again.data).toEqual({ ...first.data, repeat: true });
    expect(await written()).toEqual(before);
    // Even when the stock is gone meanwhile: still the first answer.
    const other = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(1), at(2))], {
        idempotency_key: randomUUID(),
      }),
    );
    expect(other.data).toMatchObject({ ok: true });
    expect(other.data!.order_id).not.toBe(first.data!.order_id);
    const third = await order(staff(), shop, request);
    expect(third.data).toMatchObject({
      ok: true,
      repeat: true,
      order_id: first.data!.order_id,
    });
    // The key is the shop's own: the same key in another shop is a new order.
    const theirs = await vehicle(1, saigon);
    const elsewhere = await order(
      staff(saigon),
      saigon,
      walkIn([line(saigon, theirs.id, at(1), at(2))], { idempotency_key: key }),
    );
    expect(elsewhere.data).toMatchObject({ ok: true });
    expect(elsewhere.data).not.toHaveProperty("repeat");
    const notAKey = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(8), at(9))], { idempotency_key: "abc" }),
    );
    expect(notAKey.error?.message).toBe("invalid_request");
  });

  it("the same call sent 6 times at once, for the last bike, a draft too: one order, and every call answers it", async () => {
    for (const tenant of [shop, newYork, saigon]) {
      for (const action of ["reserve", "hold", "draft"]) {
        const bike = await vehicle(1, tenant);
        const before = await written(tenant);
        const request = walkIn([line(tenant, bike.id, at(1), at(2))], {
          action,
          idempotency_key: randomUUID(),
        });
        const answers = await Promise.all(
          Array.from({ length: 6 }, () =>
            order(staff(tenant), tenant, request),
          ),
        );
        const what = `${tenant.slug} ${action}`;
        for (const { data, error } of answers) {
          expect(error, what).toBeNull();
          expect(data?.ok, `${what}: ${data?.reason}`).toBe(true);
        }
        expect(new Set(answers.map((a) => a.data!.order_id)).size, what).toBe(
          1,
        );
        expect(
          answers.filter((a) => a.data!.repeat !== true),
          what,
        ).toHaveLength(1);
        expect(await written(tenant), what).toMatchObject({
          orders: before.orders + 1,
          rentals: before.rentals + 1,
          reservations: before.reservations + (action === "draft" ? 0 : 1),
          next_number: before.next_number + 1,
        });
      }
    }
  }, 180_000);
});

describe("the line cap", () => {
  it("200 lines in one call are booked, and timed; 201 are invalid_request", async () => {
    const helmet = await gear(300);
    const lines = (n: number) =>
      Array.from({ length: n }, () => line(shop, helmet, at(1), at(2)));
    const before = await written();
    // Run in the database as the staff member, without the API's 8-second
    // statement limit, so the time is the function's own and the test does
    // not depend on how busy the machine is. The time is recorded, not
    // bounded: see docs/PROGRESS.md (stage 2b, known issues) for what it
    // was, and what it means for a 200-line order through the API.
    const run = sqlAs(
      shop.members.staff.id,
      `select clock_timestamp() as t0 \\gset
       select platform.create_order('${shop.id}', '${JSON.stringify(walkIn(lines(200)))}'::jsonb)::text;
       select 'ms:' || round(extract(epoch from clock_timestamp() - :'t0'::timestamptz) * 1000);`,
    );
    expect(run.failed).toBe("");
    const printed = run.out.split("\n");
    const data = JSON.parse(printed.find((l) => l.startsWith('{"ok"'))!) as Raw;
    const took = Number(
      printed.find((l) => l.startsWith("ms:"))!.slice("ms:".length),
    );
    expect(data.ok, data.reason).toBe(true);
    expect(data.lines).toHaveLength(200);
    expect(await written()).toMatchObject({
      orders: before.orders + 1,
      rentals: before.rentals + 200,
      reservations: before.reservations + 200,
      blocks: before.blocks + 200,
    });
    console.log(`create_order, 200 lines: ${took} ms`);
    expect(took).toBeGreaterThan(0);
    const tooMany = await order(staff(), shop, walkIn(lines(201)));
    expect(tooMany.error?.message).toBe("invalid_request");
    expect((await written()).orders).toBe(before.orders + 1);
  }, 60_000);
});

describe("a refusal leaves nothing written", () => {
  it("unavailable, unit_taken, a coupon refused, customer_needed, an invalid charge: no order, rental, reservation, block, charge, line, use or number, wherever the bad line stands", async () => {
    const bike = await vehicle(1);
    const other = await vehicle(1);
    const customer = await createCustomer(shop.id);
    const usedUp = await coupon(shop, { max_uses: 1 });
    const perCustomer = await coupon(shop, { max_uses_per_customer: 1 });
    const taken = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(1), at(3))], {
        customer_id: customer,
        coupon: { coupon_id: usedUp, amount: "100" },
      }),
    );
    expect(taken.data).toMatchObject({ ok: true });
    const before = await written();
    const good = line(shop, other.id, at(1), at(3));
    const cases: [string, Record<string, unknown>, unknown][] = [
      [
        "unavailable, last",
        walkIn([good, line(shop, bike.id, at(2), at(4))], {
          charges: [charge(500)],
        }),
        { ok: false, reason: "unavailable", line: 1 },
      ],
      [
        "unavailable, first",
        walkIn([line(shop, bike.id, at(2), at(4)), good]),
        { ok: false, reason: "unavailable", line: 0 },
      ],
      [
        "unit_taken",
        walkIn([
          good,
          line(shop, bike.id, at(2), at(4), { unit_ids: bike.units }),
        ]),
        { ok: false, reason: "unit_taken", line: 1 },
      ],
      [
        "coupon_used_up",
        walkIn([good], {
          coupon: { coupon_id: usedUp, amount: "100" },
          charges: [charge(500)],
        }),
        { ok: false, reason: "coupon_used_up", line: null },
      ],
      [
        "customer_needed",
        walkIn([good], { coupon: { coupon_id: perCustomer, amount: "100" } }),
        { ok: false, reason: "customer_needed", line: null },
      ],
      [
        "coupon_not_valid",
        walkIn([good], { coupon: { coupon_id: randomUUID(), amount: "100" } }),
        { ok: false, reason: "coupon_not_valid", line: null },
      ],
    ];
    for (const [what, request, answer] of cases) {
      for (const action of ["reserve", "hold"]) {
        const { data, error } = await order(staff(), shop, {
          ...request,
          action,
        });
        expect(error, what).toBeNull();
        expect(data, `${what} ${action}`).toEqual(answer);
        expect(await written(), `${what} ${action}`).toEqual(before);
      }
    }
    // A charge that does not add up is raised, before any lock.
    const bad: [string, Record<string, unknown>][] = [
      ["lines' VAT is not the charge's", charge(500, { tax_total: "35" })],
      [
        "groups and non-taxable are not the total",
        charge(500, { total: "501" }),
      ],
      [
        "a group's gross is not its net and VAT",
        charge(107, {
          tax_total: "7",
          snapshot: { version: 1 },
          rate_groups: [{ rate_bp: 700, net: "100", vat: "7", gross: "108" }],
        }),
      ],
      [
        "the snapshot's total is another",
        charge(500, {
          snapshot: {
            version: 1,
            non_taxable: "500",
            totals: { total: "400", vat: "0" },
          },
        }),
      ],
      [
        "a line of no rental of this order",
        charge(500, { lines: [{ rental: 1, kind: "period", amount: "500" }] }),
      ],
      [
        "a kind create_order does not write",
        charge(500, { kind: "difference" }),
      ],
      ["an unknown field", charge(500, { paid: true })],
    ];
    for (const [what, wrong] of bad) {
      const { data, error } = await order(
        staff(),
        shop,
        walkIn([good], { charges: [wrong] }),
      );
      expect(data, what).toBeNull();
      expect(error?.message, what).toBe("invalid_charge");
    }
    expect(await written()).toEqual(before);
  });

  it("a key failure that is not the block's key to its unit is raised, never answered as a unit taken; the unit's own is 'pick again'", async () => {
    const bike = await vehicle(2);
    const request = JSON.stringify(walkIn([line(shop, bike.id, at(1), at(2))]));
    const claims = JSON.stringify({
      sub: shop.members.staff.id,
      role: "authenticated",
    });
    // A trigger that fails as a foreign key would, on the table and with the
    // constraint named. All inside a transaction that is rolled back.
    const attempt = (table: string, constraint: string) =>
      sql(`
        begin;
        create function pg_temp.fail() returns trigger language plpgsql as $f$
        begin
          raise exception 'made-up key failure' using errcode = '23503', constraint = '${constraint}';
        end $f$;
        create trigger zz_fail before insert on platform.${table}
          for each row execute function pg_temp.fail();
        select set_config('request.jwt.claims', '${claims}', true);
        set local role authenticated;
        select platform.create_order('${shop.id}', '${request}'::jsonb)::text;
        rollback;`);
    for (const [table, constraint] of [
      ["rentals", "rentals_product_fkey"],
      ["reservations", "reservations_order_rental_fkey"],
      ["orders", "orders_customer_fkey"],
      ["unit_blocks", "unit_blocks_tenant_id_reservation_id_fkey"],
      ["coupon_redemptions", "coupon_redemptions_customer_fkey"],
    ]) {
      const run = attempt(table, constraint);
      if (table === "coupon_redemptions") {
        // No coupon in this order: the table is never written.
        expect(run.failed, table).toBe("");
        continue;
      }
      expect(run.failed, table).toMatch(/made-up key failure/);
      expect(run.out, table).not.toMatch(/unit_taken|unavailable/);
    }
    // The block's key to its unit (a unit deleted under the booking): every
    // attempt picks again, and the answer is a plain refusal.
    const unit = attempt("unit_blocks", "unit_blocks_tenant_id_unit_id_fkey");
    expect(unit.failed).toBe("");
    expect(
      JSON.parse(unit.out.split("\n").find((l) => l.startsWith('{"ok"'))!),
    ).toEqual({
      ok: false,
      reason: "unavailable",
      line: 0,
    });
    expect(
      (
        await service
          .from("reservations")
          .select("id")
          .eq("product_id", bike.id)
      ).data,
    ).toEqual([]);
  });
});

describe("the same unit on one order (the owner, 25 Nov 2026)", () => {
  it("named twice for times that overlap or touch: unit_twice, nothing written; for another period of the same order: booked", async () => {
    // An hour's turnaround after each rental.
    const bike = await vehicle(2, shop, { after: 60 });
    const [a] = bike.units;
    const before = await written();
    const named = (from: Date, to: Date) =>
      line(shop, bike.id, from, to, { unit_ids: [a] });
    for (const [what, second] of [
      ["overlapping", named(at(2), at(4))],
      ["inside", named(at(1, 12), at(2))],
      ["touching: starts the moment the first ends", named(at(3), at(5))],
      ["touching: ends the moment the first starts", named(at(0), at(1))],
    ] as const) {
      const { data, error } = await order(
        staff(),
        shop,
        walkIn([named(at(1), at(3)), second]),
      );
      expect(error, what).toBeNull();
      expect(data, what).toEqual({ ok: false, reason: "unit_twice", line: 1 });
      expect(await written(), what).toEqual(before);
    }
    // Back to back: the next period starts when the turnaround ends.
    const inTurn = await order(
      staff(),
      shop,
      walkIn([
        named(at(1), at(3)),
        named(at(3, 4), at(5)),
        named(at(8), at(9)),
      ]),
    );
    expect(inTurn.data).toMatchObject({
      ok: true,
      lines: [{ unit_ids: [a] }, { unit_ids: [a] }, { unit_ids: [a] }],
    });
    expect(
      sql(
        `select count(*) from platform.unit_blocks b join platform.reservations r on r.id = b.reservation_id where r.booking_id = '${inTurn.data!.order_id}' and b.unit_id = '${a}';`,
      ).out,
    ).toBe("3");
  });

  it("the pick follows the rule: two lines that touch take two bikes, or are unavailable with one; lines apart share one", async () => {
    const one = await vehicle(1);
    const touching = [
      line(shop, one.id, at(1), at(2)),
      line(shop, one.id, at(2), at(3)),
    ];
    const refused = await order(staff(), shop, walkIn(touching));
    expect(refused.data).toEqual({ ok: false, reason: "unavailable", line: 1 });
    const apart = await order(
      staff(),
      shop,
      walkIn([
        line(shop, one.id, at(1), at(2)),
        line(shop, one.id, at(2, 4), at(3)),
      ]),
    );
    expect(apart.data).toMatchObject({
      ok: true,
      lines: [{ unit_ids: one.units }, { unit_ids: one.units }],
    });
    const two = await vehicle(2);
    const both = await order(
      staff(),
      shop,
      walkIn([
        line(shop, two.id, at(1), at(2)),
        line(shop, two.id, at(2), at(3)),
      ]),
    );
    expect(both.data?.ok).toBe(true);
    expect(both.data!.lines![0].unit_ids).not.toEqual(
      both.data!.lines![1].unit_ids,
    );
  });

  it("across orders an overlap is still refused: by the pick, by name, and by the exclusion constraint itself", async () => {
    const bike = await vehicle(1);
    const first = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(1), at(3))]),
    );
    expect(first.data?.ok).toBe(true);
    const second = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(2), at(4))]),
    );
    expect(second.data).toEqual({ ok: false, reason: "unavailable", line: 0 });
    const byName = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(2), at(4), { unit_ids: bike.units })]),
    );
    expect(byName.data).toEqual({ ok: false, reason: "unit_taken", line: 0 });
    // A block written by hand for another order's reservation.
    const later = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(10), at(11))]),
    );
    const byHand = await service.from("unit_blocks").insert({
      tenant_id: shop.id,
      unit_id: bike.units[0],
      kind: "allocation",
      period: period(at(2), at(4)),
      reservation_id: later.data!.lines![0].reservation_id!,
    });
    expect(byHand.error?.code).toBe("23P01");
  });

  it("assign_order_units(): a unit this order already has for a time that touches is unit_twice when named, and is never the one a fill picks", async () => {
    const overbook = sql(
      `update platform.tenants set allow_overbooking = true where id = '${saigon.id}';`,
    );
    expect(overbook.failed).toBe("");
    const bike = await vehicle(1, saigon);
    // The second line touches the first: saved short, with no bike.
    const { data } = await order(
      staff(saigon),
      saigon,
      walkIn([
        line(saigon, bike.id, at(1), at(2)),
        line(saigon, bike.id, at(2), at(3)),
      ]),
    );
    expect(data).toMatchObject({
      ok: true,
      lines: [
        { unit_ids: bike.units, shortage: 0 },
        { unit_ids: [], shortage: 1 },
      ],
    });
    const assign = (unitIds?: string[]) =>
      staff(saigon).rpc("assign_order_units", {
        p_tenant_id: saigon.id,
        p_order_id: data!.order_id!,
        p_rental_id: data!.lines![1].rental_id,
        ...(unitIds ? { p_unit_ids: unitIds } : {}),
      });
    expect((await assign(bike.units)).data).toEqual({
      ok: false,
      reason: "unit_twice",
    });
    expect((await assign()).data).toEqual({ ok: false, reason: "unavailable" });
    // A second bike arrives: the fill takes that one.
    const more = await service
      .from("units")
      .insert({
        tenant_id: saigon.id,
        product_id: bike.id,
        location_id: saigon.locationId,
        plate: `OC-${tag}-${++counter}`,
      })
      .select("id")
      .throwOnError();
    expect((await assign()).data).toMatchObject({
      ok: true,
      order_id: data!.order_id,
      rental_id: data!.lines![1].rental_id,
      unit_ids: [more.data![0].id],
      shortage: 0,
    });
  });
});

describe("a draft held again, and a hold that has run out", () => {
  it("a draft is held, runs out, is held again and confirmed: the old rows stay expired, the new ones are reserved, and the order is booked", async () => {
    for (const tenant of [shop, newYork, saigon]) {
      const bike = await vehicle(1, tenant);
      const helmet = await gear(2, tenant);
      const draft = await order(
        staff(tenant),
        tenant,
        walkIn(
          [
            line(tenant, bike.id, at(1), at(3)),
            line(tenant, helmet, at(1), at(3), { quantity: 2, parent: 0 }),
          ],
          { action: "draft", charges: [charge(900)] },
        ),
      );
      const id = draft.data!.order_id!;
      const hold = () =>
        staff(tenant).rpc("hold_order", {
          p_tenant_id: tenant.id,
          p_order_id: id,
        });
      const confirm = () =>
        staff(tenant).rpc("confirm_order", {
          p_tenant_id: tenant.id,
          p_order_id: id,
        });

      const held = await hold();
      expect(held.error).toBeNull();
      expect(held.data).toMatchObject({
        ok: true,
        order_id: id,
        number: draft.data!.number,
        status: "new",
        lines: [{ unit_ids: bike.units, shortage: 0 }, { shortage: 0 }],
      });
      expect(await statesOf(id)).toEqual(["held", "held"]);
      // Held already: not a draft.
      expect((await hold()).data).toEqual({
        ok: false,
        reason: "not_draft",
        line: null,
      });

      runOut(id);
      // Held again: the run-out hold is settled first, then a new one made.
      const again = await hold();
      expect(again.data, tenant.slug).toMatchObject({
        ok: true,
        status: "new",
      });
      expect(await statesOf(id)).toEqual([
        "expired",
        "expired",
        "held",
        "held",
      ]);
      const row = await orderRow(id);
      expect(Date.parse(row.hold_expires_at!)).toBeGreaterThan(Date.now());
      // The rentals are the same two; the new reservations are theirs.
      expect((again.data as Raw).lines!.map((l) => l.rental_id)).toEqual(
        draft.data!.lines!.map((l) => l.rental_id),
      );

      const confirmed = await confirm();
      expect(confirmed.data, tenant.slug).toMatchObject({
        ok: true,
        order_id: id,
      });
      expect(
        (confirmed.data as { reservation_ids: string[] }).reservation_ids,
      ).toHaveLength(2);
      expect(await statesOf(id)).toEqual([
        "expired",
        "expired",
        "reserved",
        "reserved",
      ]);
      expect(await orderRow(id)).toMatchObject({
        status: "booked",
        hold_expires_at: null,
      });
      expect(
        sql(
          `select string_agg(kind, ',') from platform.unit_blocks b join platform.reservations r on r.id = b.reservation_id where r.booking_id = '${id}' and r.product_type = 'vehicle';`,
        ).out,
      ).toBe("allocation");
      // Its charge was stored with the draft and is still the one.
      expect(
        sql(
          `select count(*) || ' ' || min(status) from platform.order_charges where order_id = '${id}';`,
        ).out,
      ).toBe("1 open");
      // Booked: confirming again is fine and changes nothing.
      expect((await confirm()).data).toEqual({
        ok: true,
        order_id: id,
        reservation_ids: [],
      });
    }
  }, 120_000);

  it("reserve_order(): a draft is booked straight away; with its bike gone meanwhile it is refused and stays a draft", async () => {
    const bike = await vehicle(1);
    const draft = async () =>
      (
        await order(
          staff(),
          shop,
          walkIn([line(shop, bike.id, at(1), at(3))], { action: "draft" }),
        )
      ).data!.order_id!;
    const [first, second] = [await draft(), await draft()];
    const reserve = (id: string, db: Db = staff()) =>
      db.rpc("reserve_order", { p_tenant_id: shop.id, p_order_id: id });
    expect((await reserve(first, shop.members.mechanic.db)).data).toEqual({
      ok: false,
      reason: "not_allowed",
      line: null,
    });
    expect((await reserve(first, service)).data).toEqual({
      ok: false,
      reason: "not_allowed",
      line: null,
    });
    expect((await reserve(first)).data).toMatchObject({
      ok: true,
      status: "booked",
      lines: [{ unit_ids: bike.units }],
    });
    const before = await written();
    expect((await reserve(second)).data).toEqual({
      ok: false,
      reason: "unavailable",
      line: 0,
    });
    expect(await written()).toEqual(before);
    expect((await orderRow(second)).status).toBe("draft");
    for (const id of [
      randomUUID(),
      (
        await order(
          staff(saigon),
          saigon,
          walkIn([line(saigon, (await vehicle(1, saigon)).id, at(1), at(2))], {
            action: "draft",
          }),
        )
      ).data!.order_id!,
    ]) {
      expect((await reserve(id)).data).toEqual({
        ok: false,
        reason: "not_found",
        line: null,
      });
    }
  });

  it("confirm_order() on a hold that has run out answers hold_expired, and the settlement is kept: a staff order is a draft with its rentals, an online order is canceled as expired", async () => {
    for (const tenant of [shop, newYork, saigon]) {
      const bike = await vehicle(2, tenant);
      const code = await coupon(tenant, { max_uses: 5 });
      const counterOrder = await order(
        staff(tenant),
        tenant,
        walkIn([line(tenant, bike.id, at(1), at(3))], {
          action: "hold",
          coupon: { coupon_id: code, amount: "100" },
          charges: [charge(900)],
        }),
      );
      const online = await order(service, tenant, {
        channel: "booking_page",
        mode: "instant",
        action: "hold",
        lines: [line(tenant, bike.id, at(1), at(3))],
        charges: [charge(900)],
      });
      for (const made of [counterOrder, online]) {
        expect(made.data?.ok, made.data?.reason).toBe(true);
        runOut(made.data!.order_id!);
      }
      const confirm = (db: Db, id: string) =>
        db.rpc("confirm_order", { p_tenant_id: tenant.id, p_order_id: id });

      const a = await confirm(staff(tenant), counterOrder.data!.order_id!);
      expect(a.data, tenant.slug).toEqual({
        ok: false,
        reason: "hold_expired",
      });
      expect(await orderRow(counterOrder.data!.order_id!)).toMatchObject({
        status: "draft",
        hold_expires_at: null,
        cancelled_by: null,
      });
      expect(await statesOf(counterOrder.data!.order_id!)).toEqual(["expired"]);
      expect(
        sql(`
          select (select string_agg(status, ',') from platform.rentals where order_id = '${counterOrder.data!.order_id}')
            || ' ' || (select count(*) from platform.unit_blocks b join platform.reservations r on r.id = b.reservation_id where r.booking_id = '${counterOrder.data!.order_id}')
            || ' ' || (select count(*) from platform.coupon_redemptions where booking_id = '${counterOrder.data!.order_id}' and released_at is null)
            || ' ' || (select string_agg(status, ',') from platform.order_charges where order_id = '${counterOrder.data!.order_id}');`)
          .out,
      ).toBe("draft 0 0 open");
      // Asked again: still hold_expired, and nothing more happens.
      expect(
        (await confirm(staff(tenant), counterOrder.data!.order_id!)).data,
      ).toEqual({
        ok: false,
        reason: "hold_expired",
      });

      const b = await confirm(service, online.data!.order_id!);
      expect(b.data, tenant.slug).toEqual({
        ok: false,
        reason: "hold_expired",
      });
      const row = await orderRow(online.data!.order_id!);
      expect(row).toMatchObject({
        status: "canceled",
        hold_expires_at: null,
        cancelled_by: "system",
        cancel_reason: "expired",
        no_show: false,
      });
      expect(row.canceled_at).not.toBeNull();
      expect(
        sql(`
          select (select string_agg(status, ',') from platform.rentals where order_id = '${online.data!.order_id}')
            || ' ' || (select string_agg(status, ',') from platform.order_charges where order_id = '${online.data!.order_id}');`)
          .out,
      ).toBe("canceled void");
      // One event says so, for each.
      for (const [id, status] of [
        [counterOrder.data!.order_id!, "draft"],
        [online.data!.order_id!, "canceled"],
      ]) {
        const events = (
          await service
            .from("audit_events")
            .select("action, after")
            .eq("entity", "bookings")
            .eq("entity_id", id)
            .in("action", ["expire", "hold_expired"])
            .order("id")
            .throwOnError()
        ).data!;
        expect(events.map((e) => e.action)).toEqual(["expire", "hold_expired"]);
        expect(events[1].after).toMatchObject({ status });
      }
      // Both bikes are free again.
      const free = await order(
        staff(tenant),
        tenant,
        walkIn([
          line(tenant, bike.id, at(1), at(3)),
          line(tenant, bike.id, at(1), at(3)),
        ]),
      );
      expect(free.data?.ok, free.data?.reason).toBe(true);
    }
  }, 120_000);

  it("assign_order_units() on a hold that has run out: hold_expired, settled and kept; after the sweep got there first: the same", async () => {
    const bike = await vehicle(2);
    const make = async () =>
      (
        await order(
          staff(),
          shop,
          walkIn([line(shop, bike.id, at(1), at(3))], { action: "hold" }),
        )
      ).data!;
    const assign = (made: Raw) =>
      staff().rpc("assign_order_units", {
        p_tenant_id: shop.id,
        p_order_id: made.order_id!,
        p_rental_id: made.lines![0].rental_id,
        p_unit_ids: made.lines![0].unit_ids,
      });
    const first = await make();
    runOut(first.order_id!);
    expect((await assign(first)).data).toEqual({
      ok: false,
      reason: "hold_expired",
    });
    expect(await orderRow(first.order_id!)).toMatchObject({ status: "draft" });
    expect(await statesOf(first.order_id!)).toEqual(["expired"]);
    // A draft has nothing to assign.
    expect((await assign(first)).data).toEqual({
      ok: false,
      reason: "not_assignable",
    });

    // The sweep releases the reservations and leaves the order to its next
    // function, which settles it.
    const second = await make();
    runOut(second.order_id!);
    expect(sql(`select platform.release_expired_holds();`).failed).toBe("");
    expect(await statesOf(second.order_id!)).toEqual(["expired"]);
    expect((await orderRow(second.order_id!)).status).toBe("new");
    // An assign after the sweep: the same answer, and it settles the order.
    // (The sweep runs every minute, so this order of events is an everyday
    // one.)
    const third = await make();
    runOut(third.order_id!);
    expect(sql(`select platform.release_expired_holds();`).failed).toBe("");
    expect(await statesOf(third.order_id!)).toEqual(["expired"]);
    expect((await assign(third)).data).toEqual({
      ok: false,
      reason: "hold_expired",
    });
    expect((await orderRow(third.order_id!)).status).toBe("draft");
    expect((await assign(third)).data).toEqual({
      ok: false,
      reason: "not_assignable",
    });
    const confirmed = await staff().rpc("confirm_order", {
      p_tenant_id: shop.id,
      p_order_id: second.order_id!,
    });
    expect(confirmed.data).toEqual({ ok: false, reason: "hold_expired" });
    expect((await orderRow(second.order_id!)).status).toBe("draft");
  });

  it("cancel_order() carries on from a hold that has run out: the order ends canceled by the shop, not left a draft", async () => {
    const bike = await vehicle(1);
    const held = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(1), at(3))], { action: "hold" }),
    );
    runOut(held.data!.order_id!);
    const cancelled = await staff().rpc("cancel_order", {
      p_tenant_id: shop.id,
      p_order_id: held.data!.order_id!,
      p_cancel_reason: "no_show",
    });
    expect(cancelled.data).toEqual({
      ok: true,
      order_id: held.data!.order_id,
      reservation_ids: [],
    });
    expect(await orderRow(held.data!.order_id!)).toMatchObject({
      status: "canceled",
      cancelled_by: "shop",
      cancel_reason: "no_show",
      no_show: true,
    });
    expect(await statesOf(held.data!.order_id!)).toEqual(["expired"]);
  });
});

describe("cancel_order()", () => {
  it("who and why: the lists, the defaults for a member and for the server, and what can't be sent", async () => {
    const helmet = await gear(20);
    const make = async (db: Db, request: Record<string, unknown>) =>
      (await order(db, shop, request)).data!.order_id!;
    const counterOrder = () =>
      make(
        staff(),
        walkIn([line(shop, helmet, at(1), at(2))], { charges: [charge(300)] }),
      );
    const cancel = (db: Db, id: string, by?: string, reason?: string) =>
      db.rpc("cancel_order", {
        p_tenant_id: shop.id,
        p_order_id: id,
        ...(by ? { p_cancelled_by: by } : {}),
        ...(reason ? { p_cancel_reason: reason } : {}),
      });

    const byShop = await counterOrder();
    expect((await cancel(staff(), byShop)).data).toMatchObject({ ok: true });
    expect(await orderRow(byShop)).toMatchObject({
      status: "canceled",
      cancelled_by: "shop",
      cancel_reason: "shop_request",
      no_show: false,
    });
    expect(
      sql(`
        select (select string_agg(status, ',') from platform.rentals where order_id = '${byShop}')
          || ' ' || (select string_agg(status, ',') from platform.order_charges where order_id = '${byShop}');`)
        .out,
    ).toBe("canceled void");

    const byCustomer = await counterOrder();
    await cancel(staff(), byCustomer, "customer");
    expect(await orderRow(byCustomer)).toMatchObject({
      cancelled_by: "customer",
      cancel_reason: "customer_request",
    });

    const online = await make(service, {
      channel: "api",
      mode: "instant",
      action: "reserve",
      lines: [line(shop, helmet, at(1), at(2))],
    });
    await cancel(service, online);
    expect(await orderRow(online)).toMatchObject({
      cancelled_by: "customer",
      cancel_reason: "customer_request",
    });

    // The database's own, and anything off the lists, can't be sent.
    const open = await counterOrder();
    for (const [by, reason] of [
      ["system", undefined],
      [undefined, "expired"],
      ["vendor", undefined],
      [undefined, "changed my mind"],
    ]) {
      const refused = await cancel(staff(), open, by, reason);
      expect(refused.error?.message, `${by} ${reason}`).toBe("invalid_request");
    }
    expect((await orderRow(open)).status).toBe("booked");
    // By hand, with the service role: the checks hold the lists.
    for (const values of [
      { cancelled_by: "vendor" },
      { cancel_reason: "because" },
    ]) {
      const forced = await service
        .from("orders")
        .update(values)
        .eq("id", open)
        .select("id");
      expect(forced.error?.code, JSON.stringify(values)).toBe("23514");
    }
    // A draft is cancelled the same way; mechanics and strangers may not.
    const draft = await make(
      staff(),
      walkIn([line(shop, helmet, at(1), at(2))], { action: "draft" }),
    );
    expect((await cancel(shop.members.mechanic.db, draft)).data).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    expect((await cancel(outsider.db, draft)).data).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    expect((await cancel(staff(), draft, undefined, "other")).data).toEqual({
      ok: true,
      order_id: draft,
      reservation_ids: [],
    });
    expect(await orderRow(draft)).toMatchObject({
      status: "canceled",
      cancel_reason: "other",
    });
  });

  it("a Moto Mangos order is the server's to cancel, not a member's (the owner, 25 Nov 2026); a member cancels a counter, phone, booking-page or api order of the shop", async () => {
    for (const tenant of [shop, newYork, saigon]) {
      const helmet = await gear(40, tenant);
      const make = async (channel: string) => {
        const online = !["walk_in", "phone"].includes(channel);
        const made = await order(online ? service : staff(tenant), tenant, {
          channel,
          mode: online ? "instant" : "staff",
          action: "reserve",
          lines: [line(tenant, helmet, at(1), at(2))],
        });
        expect(made.data?.ok, `${channel}: ${made.data?.reason}`).toBe(true);
        return made.data!.order_id!;
      };
      const cancel = (db: Db, id: string) =>
        db.rpc("cancel_order", { p_tenant_id: tenant.id, p_order_id: id });

      // Moto Mangos: no member, whatever the role; nothing changes.
      const marketplace = await make("marketplace");
      const before = await written(tenant);
      for (const role of ["owner", "manager", "staff"] as const) {
        const refused = await cancel(tenant.members[role].db, marketplace);
        expect(refused.error, `${tenant.slug} ${role}`).toBeNull();
        expect(refused.data, `${tenant.slug} ${role}`).toEqual({
          ok: false,
          reason: "not_allowed",
        });
      }
      expect(await written(tenant)).toEqual(before);
      expect((await orderRow(marketplace)).status).toBe("booked");
      // The server cancels it.
      const byServer = await cancel(service, marketplace);
      expect(byServer.data, tenant.slug).toMatchObject({
        ok: true,
        order_id: marketplace,
      });
      expect(await orderRow(marketplace)).toMatchObject({
        status: "canceled",
        cancelled_by: "customer",
      });

      // Every other channel: a member of the shop cancels it.
      for (const [channel, role] of [
        ["walk_in", "staff"],
        ["phone", "manager"],
        ["booking_page", "staff"],
        ["api", "owner"],
      ] as const) {
        const id = await make(channel);
        const done = await cancel(tenant.members[role].db, id);
        expect(done.data, `${tenant.slug} ${channel}`).toMatchObject({
          ok: true,
          order_id: id,
        });
        expect(await orderRow(id), `${tenant.slug} ${channel}`).toMatchObject({
          status: "canceled",
          cancelled_by: "shop",
        });
      }
      // And the server cancels any of them too.
      for (const channel of ["walk_in", "booking_page"]) {
        const id = await make(channel);
        expect((await cancel(service, id)).data, channel).toMatchObject({
          ok: true,
        });
      }
    }
  });
});

describe("charges", () => {
  it("a booking charge is stored once with its lines, keyed to the order and its rentals, in the shop's currency", async () => {
    for (const tenant of [shop, newYork, saigon]) {
      const bike = await vehicle(1, tenant);
      const helmet = await gear(3, tenant);
      const { data, error } = await order(
        staff(tenant),
        tenant,
        walkIn(
          [
            line(tenant, bike.id, at(1), at(3)),
            line(tenant, helmet, at(1), at(3), { quantity: 2, parent: 0 }),
          ],
          {
            charges: [
              {
                kind: "booking",
                priced_at: "2035-02-01T05:00:00.000Z",
                total: "1177",
                tax_total: "77",
                deposit: "5000",
                rate_groups: [
                  {
                    rate_bp: 700,
                    base: "1100",
                    net: "1100",
                    vat: "77",
                    gross: "1177",
                  },
                ],
                snapshot: {
                  version: 1,
                  non_taxable: "0",
                  totals: { total: "1177", vat: "77" },
                  deposit: { amount: "5000" },
                },
                lines: [
                  {
                    rental: 0,
                    kind: "period",
                    product_id: bike.id,
                    product_type: "vehicle",
                    period_start: at(1).toISOString(),
                    period_end: at(3).toISOString(),
                    quantity: 1,
                    included_quantity: 0,
                    charged_quantity: 1,
                    list_price: "1200",
                    season_total: "-100",
                    discount_total: "100",
                    amount: "1000",
                    tax_rate_bp: 700,
                    tax_profile_name: "VAT",
                    tax_inclusive: false,
                    tax_amount: "70",
                    deposit: "5000",
                    snapshot: { version: 1, id: "0" },
                  },
                  {
                    rental: 1,
                    kind: "extra",
                    quantity: 2,
                    amount: "100",
                    tax_amount: "7",
                  },
                ],
              },
            ],
          },
        ),
      );
      expect(error, tenant.slug).toBeNull();
      expect(data?.ok, data?.reason).toBe(true);
      const charges = (
        await service
          .from("order_charges")
          .select(
            "id, kind, currency, total, tax_total, deposit, status, due_at",
          )
          .eq("order_id", data!.order_id!)
          .throwOnError()
      ).data!;
      expect(charges).toMatchObject([
        {
          kind: "booking",
          currency: tenant.currency,
          total: 1177,
          tax_total: 77,
          deposit: 5000,
          status: "open",
          due_at: null,
        },
      ]);
      const lines = (
        await service
          .from("order_lines")
          .select(
            "position, kind, rental_id, charge_id, amount, tax_amount, season_total, currency, quantity",
          )
          .eq("order_id", data!.order_id!)
          .order("position")
          .throwOnError()
      ).data!;
      expect(lines).toEqual([
        {
          position: 0,
          kind: "period",
          rental_id: data!.lines![0].rental_id,
          charge_id: charges[0].id,
          amount: 1000,
          tax_amount: 70,
          season_total: -100,
          currency: tenant.currency,
          quantity: 1,
        },
        {
          position: 1,
          kind: "extra",
          rental_id: data!.lines![1].rental_id,
          charge_id: charges[0].id,
          amount: 100,
          tax_amount: 7,
          season_total: null,
          currency: tenant.currency,
          quantity: 2,
        },
      ]);
    }
  });
});

describe("the per-customer coupon limit (plan §5.1)", () => {
  it("counted for the order's customer under the coupon's row: the second order of one customer is refused, another customer's is not", async () => {
    const helmet = await gear(20);
    const [ann, bob] = await Promise.all([
      createCustomer(shop.id),
      createCustomer(shop.id),
    ]);
    const code = await coupon(shop, { max_uses_per_customer: 1 });
    const book = (customer_id?: string) =>
      order(
        staff(),
        shop,
        walkIn([line(shop, helmet, at(1), at(2))], {
          ...(customer_id ? { customer_id } : {}),
          coupon: { coupon_id: code, amount: "50" },
        }),
      );
    expect((await book()).data).toEqual({
      ok: false,
      reason: "customer_needed",
      line: null,
    });
    const first = await book(ann);
    expect(first.data?.ok).toBe(true);
    expect((await book(ann)).data).toEqual({
      ok: false,
      reason: "coupon_used_up",
      line: null,
    });
    expect((await book(bob)).data?.ok).toBe(true);
    // The use names the order's customer.
    expect(
      sql(
        `select customer_id from platform.coupon_redemptions where booking_id = '${first.data!.order_id}';`,
      ).out,
    ).toBe(ann);
    // The customer is not sent with the coupon any more.
    const old = await order(
      staff(),
      shop,
      walkIn([line(shop, helmet, at(1), at(2))], {
        coupon: { coupon_id: code, amount: "50", customer_id: ann },
      }),
    );
    expect(old.error?.message).toBe("invalid_request");
    // Cancelled: the use is given back, and the customer may use it again.
    await staff().rpc("cancel_order", {
      p_tenant_id: shop.id,
      p_order_id: first.data!.order_id!,
    });
    expect((await book(ann)).data?.ok).toBe(true);
    // A use is a customer's: one of no customer of the shop can't be written.
    const forged = await service.from("coupon_redemptions").insert({
      tenant_id: shop.id,
      coupon_id: code,
      booking_id: randomUUID(),
      customer_id: randomUUID(),
      amount: 1,
    });
    expect(forged.error?.code).toBe("23503");
    expect(forged.error?.message).toContain("coupon_redemptions_customer_fkey");
  });

  it("the last use of one customer, two staff at once, 10 rounds in each shop: exactly one order, the other coupon_used_up, no deadlock", async () => {
    const before = deadlocks();
    await Promise.all(
      [shop, newYork, saigon].map(async (tenant) => {
        const helmet = await gear(100, tenant);
        for (let round = 0; round < 10; round++) {
          const customer = await createCustomer(tenant.id);
          const code = await coupon(tenant, { max_uses_per_customer: 1 });
          const answers = await Promise.all(
            [tenant.members.staff.db, tenant.members.manager.db].map((db) =>
              order(
                db,
                tenant,
                walkIn([line(tenant, helmet, at(1 + round), at(2 + round))], {
                  customer_id: customer,
                  coupon: { coupon_id: code, amount: "50" },
                }),
              ),
            ),
          );
          const what = `${tenant.slug} round ${round}`;
          for (const { error } of answers) expect(error, what).toBeNull();
          expect(
            answers.map((a) => (a.data!.ok ? "ok" : a.data!.reason)).sort(),
            what,
          ).toEqual(["coupon_used_up", "ok"]);
          expect(
            sql(
              `select count(*) from platform.coupon_redemptions where coupon_id = '${code}' and released_at is null;`,
            ).out,
            what,
          ).toBe("1");
        }
      }),
    );
    expect(deadlocks()).toBe(before);
  }, 180_000);
});

describe("the currency lock knows about orders", () => {
  it("a shop with an order, and nothing else that fixes its currency: currency_locked() says so, and the change is refused by the order's own key", async () => {
    const fresh = await createTenant("core-currency");
    try {
      const locked = async () =>
        (
          await fresh.members.owner.db.rpc("currency_locked", {
            p_tenant_id: fresh.id,
          })
        ).data;
      expect(await locked()).toBe(false);
      const helmet = await gear(2, fresh);
      const draft = await order(
        staff(fresh),
        fresh,
        walkIn([line(fresh, helmet, at(1), at(2))], { action: "draft" }),
      );
      expect(draft.data?.ok, draft.data?.reason).toBe(true);
      expect(await locked()).toBe(true);
      const change = await fresh.members.owner.db
        .from("tenants")
        .update({ currency: fresh.currency === "EUR" ? "USD" : "EUR" })
        .eq("id", fresh.id)
        .select("currency");
      // What the Settings action reads to say "the currency is fixed".
      expect(change.error?.code).toBe("23503");
      expect(change.error?.message).toMatch(/_currency_fkey"/);
      // Not for someone who is not in the shop.
      expect(
        (await outsider.db.rpc("currency_locked", { p_tenant_id: fresh.id }))
          .data,
      ).toBe(false);
    } finally {
      await deleteTenant(fresh);
    }
  });
});

describe("the cores are nobody's to call", () => {
  it("a signed-in owner, the server's role and a visitor can't execute reserve_core, the three cores or their helpers; reserve() and its siblings are gone", () => {
    for (const call of [
      `platform_private.reserve_core('${shop.id}', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)`,
      `platform_private.confirm_hold('${shop.id}', gen_random_uuid())`,
      `platform_private.cancel_reservation('${shop.id}', gen_random_uuid(), null, 'shop', 'other')`,
      `platform_private.assign_units('${shop.id}', gen_random_uuid(), gen_random_uuid(), null)`,
      `platform_private.settle_order_hold('${shop.id}', gen_random_uuid(), now())`,
      `platform_private.store_charges('${shop.id}', gen_random_uuid(), 'THB', '[]'::jsonb, null, 0, true)`,
      `platform_private.order_answer('${shop.id}', gen_random_uuid())`,
      `platform_private.reserve_existing('${shop.id}', gen_random_uuid(), 'hold', null)`,
    ]) {
      expect(
        sqlAs(shop.members.owner.id, `select ${call};`).failed,
        call,
      ).toMatch(/permission denied/);
    }
    expect(
      sql(`
        select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'platform'
          and p.proname in ('reserve', 'confirm_hold', 'cancel_reservation', 'assign_units');`)
        .out,
    ).toBe("0");
    expect(
      sql(`
        select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'platform'
          and p.proname in ('create_order', 'hold_order', 'reserve_order', 'confirm_order', 'cancel_order', 'assign_order_units')
          and p.prosecdef and p.proconfig @> array['search_path=""', 'lock_timeout=6s'];`)
        .out,
    ).toBe(
      "assign_order_units,cancel_order,confirm_order,create_order,hold_order,reserve_order",
    );
  });
});

describe("migration 3's re-check", () => {
  const migration = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../supabase/migrations/20261125000100_platform_order_core.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  it("finds no reservation without a rental in this database, and the column is required", () => {
    expect(
      sql(`select count(*) from platform.reservations where rental_id is null;`)
        .out,
    ).toBe("0");
    expect(
      sql(
        `select is_nullable from information_schema.columns where table_schema = 'platform' and table_name = 'reservations' and column_name = 'rental_id';`,
      ).out,
    ).toBe("NO");
    // The order of the migration: locked, cleared, then required.
    const locked = migration.indexOf("lock table platform.reservations");
    const cleared = migration.indexOf("-- recheck:end");
    const required = migration.indexOf("alter column rental_id set not null");
    expect(locked).toBeGreaterThan(0);
    expect(locked).toBeLessThan(cleared);
    expect(cleared).toBeLessThan(required);
    expect(migration).toMatch(
      /perform set_config\('lock_timeout', '10s', true\);\s+lock table/,
    );
  });

  it("run again on a database that took a Phase 2 booking in between: that reservation, its block and its coupon use go; an order's rows and a downtime block stay", async () => {
    const bike = await vehicle(3);
    const code = await coupon(shop, {});
    const kept = await order(
      staff(),
      shop,
      walkIn([line(shop, bike.id, at(1), at(2))], {
        coupon: { coupon_id: code, amount: "10" },
      }),
    );
    expect(kept.data?.ok, kept.data?.reason).toBe(true);
    const block = migration.slice(
      migration.indexOf("-- recheck:begin"),
      migration.indexOf("-- recheck:end"),
    );
    expect(block).toContain("do $recheck$");
    const free = bike.units.filter(
      (u) => !kept.data!.lines![0].unit_ids.includes(u),
    );
    const counts = `
      select (select count(*) from platform.reservations where tenant_id = '${shop.id}' and rental_id is null)
        || ' ' || (select count(*) from platform.reservations where booking_id = '${kept.data!.order_id}')
        || ' ' || (select count(*) from platform.unit_blocks where unit_id = any ('{${bike.units.join(",")}}'))
        || ' ' || (select count(*) from platform.coupon_redemptions where coupon_id = '${code}');`;
    const run = sql(`
      begin;
      -- As the database stood between migrations 2 and 3.
      alter table platform.reservations alter column rental_id drop not null;
      with made as (
        insert into platform.reservations (
          tenant_id, booking_id, product_id, product_type, location_id, starts_at, ends_at,
          block_period, quantity, channel, mode, state)
        values (
          '${shop.id}', gen_random_uuid(), '${bike.id}', 'vehicle', '${shop.locationId}',
          '${at(5).toISOString()}', '${at(6).toISOString()}', '${period(at(5), at(6))}',
          1, 'walk_in', 'staff', 'reserved')
        returning id, booking_id
      ), blocked as (
        insert into platform.unit_blocks (tenant_id, unit_id, kind, period, reservation_id)
        select '${shop.id}', '${free[0]}', 'allocation', '${period(at(5), at(6))}', id from made
      )
      insert into platform.coupon_redemptions (tenant_id, coupon_id, booking_id, amount)
      select '${shop.id}', '${code}', booking_id, 5 from made;
      insert into platform.unit_blocks (tenant_id, unit_id, kind, period)
      values ('${shop.id}', '${free[1]}', 'downtime', '${period(at(5), at(6))}');
      ${counts}
      ${block}
      ${counts}
      alter table platform.reservations alter column rental_id set not null;
      rollback;`);
    expect(run.failed).toBe("");
    // Before: 1 with no rental, the order's 1, 3 blocks, 2 uses. After: 0, 1, 2, 1.
    expect(
      run.out.split("\n").filter((l) => /^\d+ \d+ \d+ \d+$/.test(l)),
    ).toEqual(["1 1 3 2", "0 1 2 1"]);
  });
});

describe("last: Postgres reported no deadlock", () => {
  it("the database's own count of detected deadlocks did not move during this file", () => {
    expect(deadlocks()).toBe(deadlocksBefore);
  });
});
