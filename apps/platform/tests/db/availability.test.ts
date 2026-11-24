/**
 * Phase 2, stage 2: shortage, holds and the availability read (migration
 * 20261116000200; docs/phase-2-plan.md §3.2 to §3.5, §4, §9.2).
 *
 * Holds, their confirmation and their expiry (also across both New York
 * clock changes); overbooking and the shortage rule; shortage demand taken
 * off what is free; assign_units(); the overdue rule with a hand-set 'out'
 * state; the availability read; who may call each new function, and shop
 * against shop; a unit delete that never waits; and the races between
 * reserve, confirm, cancel, assign and the hold sweep; and move_unit(): a
 * unit's bookings move with it to another product or place. The races run in
 * three shops: Bangkok (THB), New York (USD, daylight saving) and Saigon
 * (VND).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { roles, type Role } from "@/lib/roles";
import {
  anonClient,
  closedGate,
  createCatalogEntry,
  createTenant,
  createUser,
  type Db,
  deleteTenant,
  deleteUser,
  forceListing,
  type Gate,
  GATE_TEST_TIMEOUT,
  GATE_TIMEOUTS,
  GATE_WAIT,
  holding,
  period,
  removeCatalogEntry,
  seenWaitingForLock,
  serviceClient,
  sql,
  sqlBackground,
  stillHolding,
  type TestTenant,
  type TestUser,
  until,
} from "./helpers";

// Tests here hold sessions at gates: see GATE_TIMEOUTS in helpers.ts.
vi.setConfig(GATE_TIMEOUTS);

let shop: TestTenant;
let newYork: TestTenant;
let saigon: TestTenant;
let outsider: TestUser;
let catalogId: string;
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let counter = 0;
const name = (what: string) => `${what} ${tag} ${++counter}`;

/** How many times each race is run, in each shop. */
const ROUNDS = 10;
/** Race rounds run by this file, for the report. */
let raceRounds = 0;
let deadlocksBefore: number;

const db = (role: Role, tenant: TestTenant = shop): Db =>
  tenant.members[role].db;

/** A moment far ahead: day `d` at `h` o'clock UTC. Every test has its own products. */
const at = (d: number, h = 0) =>
  new Date(Date.UTC(2032, 0, 1) + d * 86_400_000 + h * 3_600_000);
const hoursFromNow = (n: number) => new Date(Date.now() + n * 3_600_000);

type Line = {
  product_id: string;
  location_id?: string;
  starts_at: Date;
  ends_at: Date;
  quantity?: number;
  unit_ids?: string[];
};
type Booked = {
  ok: true;
  booking_id: string;
  hold_expires_at?: string;
  lines: { reservation_id: string; unit_ids: string[]; shortage: number }[];
};
type Answer = Booked | { ok: false; reason: string; line: number | null };
type Result<T = Answer> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

function request(
  tenant: TestTenant,
  channel: string,
  mode: string,
  lines: Line[],
  hold: boolean,
) {
  return {
    p_tenant_id: tenant.id,
    p_request: {
      channel,
      mode,
      ...(hold ? { hold: true } : {}),
      lines: lines.map((line) => ({
        ...line,
        location_id: line.location_id ?? tenant.locationId,
        starts_at: line.starts_at.toISOString(),
        ends_at: line.ends_at.toISOString(),
        quantity: line.quantity ?? 1,
      })),
    },
  };
}

type Options = { tenant?: TestTenant; hold?: boolean; channel?: string };

/** The staff path: a signed-in member at the counter. */
const staffBook = (
  role: Role,
  lines: Line[],
  o: Options = {},
): Promise<Result> =>
  Promise.resolve(
    db(role, o.tenant ?? shop).rpc(
      "reserve",
      request(
        o.tenant ?? shop,
        o.channel ?? "walk_in",
        "staff",
        lines,
        !!o.hold,
      ),
    ),
  ) as Promise<Result>;

/** The online path: the server, with the service role. */
const onlineBook = (lines: Line[], o: Options = {}): Promise<Result> =>
  Promise.resolve(
    service.rpc(
      "reserve",
      request(
        o.tenant ?? shop,
        o.channel ?? "booking_page",
        "instant",
        lines,
        !!o.hold,
      ),
    ),
  ) as Promise<Result>;

type Simple = { ok: boolean; reason?: string; [key: string]: unknown };

const confirm = (client: Db, tenant: TestTenant, booking: string) =>
  Promise.resolve(
    client.rpc("confirm_hold", {
      p_tenant_id: tenant.id,
      p_booking_id: booking,
    }),
  ) as Promise<Result<Simple>>;

const cancel = (client: Db, tenant: TestTenant, booking: string) =>
  Promise.resolve(
    client.rpc("cancel_reservation", {
      p_tenant_id: tenant.id,
      p_booking_id: booking,
    }),
  ) as Promise<Result<Simple>>;

const assign = (
  client: Db,
  tenant: TestTenant,
  reservation: string,
  units?: string[],
) =>
  Promise.resolve(
    client.rpc("assign_units", {
      p_tenant_id: tenant.id,
      p_reservation_id: reservation,
      ...(units ? { p_unit_ids: units } : {}),
    }),
  ) as Promise<Result<Simple>>;

const sweep = () =>
  Promise.resolve(service.rpc("release_expired_holds")) as Promise<
    Result<number>
  >;

type Available = {
  product_id: string;
  location_id: string;
  type: string;
  stock: number | null;
  free: number | null;
  shortage_demand: number;
  available: number | null;
  unlimited: boolean;
  marketplace: null | Record<string, number | boolean>;
};
const availability = (
  client: Db,
  tenant: TestTenant,
  items: {
    product_id: string;
    location_id?: string;
    starts_at: Date;
    ends_at: Date;
  }[],
) =>
  Promise.resolve(
    client.rpc("availability", {
      p_tenant_id: tenant.id,
      p_items: items.map((i) => ({
        product_id: i.product_id,
        location_id: i.location_id ?? tenant.locationId,
        starts_at: i.starts_at.toISOString(),
        ends_at: i.ends_at.toISOString(),
      })),
    }),
  ) as Promise<Result<Available[]>>;

/** stock / free / shortage demand / available for one product and window. */
async function counts(
  productId: string,
  from: Date,
  to: Date,
  tenant: TestTenant = shop,
  client: Db = service,
) {
  const { data, error } = await availability(client, tenant, [
    { product_id: productId, starts_at: from, ends_at: to },
  ]);
  expect(error, error?.message).toBeNull();
  const a = data![0];
  return `${a.stock} / ${a.free} / ${a.shortage_demand} / ${a.available}`;
}

/** A vehicle product with `count` units, made with the service role. */
async function vehicle(
  count: number,
  options: { tenant?: TestTenant; before?: number; after?: number } = {},
) {
  const tenant = options.tenant ?? shop;
  const product = await service
    .from("products")
    .insert({
      tenant_id: tenant.id,
      name: name("Scooter"),
      vehicle_type: "motorbike",
      buffer_before_minutes: options.before ?? null,
      buffer_after_minutes: options.after ?? null,
    })
    .select("id")
    .single();
  if (product.error) throw product.error;
  const units = count ? await addUnits(product.data.id, count, tenant) : [];
  return { id: product.data.id, units };
}

async function addUnits(
  productId: string,
  count: number,
  tenant: TestTenant = shop,
  locationId: string = tenant.locationId,
) {
  const units = await service
    .from("units")
    .insert(
      Array.from({ length: count }, () => ({
        tenant_id: tenant.id,
        product_id: productId,
        location_id: locationId,
        plate: `AV-${tag}-${++counter}`,
      })),
    )
    .select("id");
  if (units.error) throw units.error;
  return units.data.map((u) => u.id);
}

/** Rental gear, a service or an item for sale, made as the owner. */
async function general(
  type: "gear" | "service" | "sale_item",
  quantity = 0,
  tenant: TestTenant = shop,
) {
  const { data, error } = await db("owner", tenant).rpc(
    "create_general_product",
    {
      p_tenant_id: tenant.id,
      p_type: type,
      p_name: name(type),
      p_track_units: false,
      p_quantities:
        type === "service"
          ? []
          : [{ location_id: tenant.locationId, quantity }],
    },
  );
  if (error) throw error;
  const units = await service
    .from("units")
    .select("id")
    .eq("product_id", data)
    .order("id");
  return { id: data as string, units: (units.data ?? []).map((u) => u.id) };
}

const reservationsOf = async (productId: string) =>
  (
    await service
      .from("reservations")
      .select("*")
      .eq("product_id", productId)
      .order("created_at")
      .order("id")
      .throwOnError()
  ).data!;

const blocksOf = async (productId: string) =>
  (
    await service
      .from("unit_blocks")
      .select("id, unit_id, kind, reservation_id, unit:units!inner(product_id)")
      .eq("unit.product_id", productId)
      .order("id")
      .throwOnError()
  ).data!;

/** "state kind,kind" of everything a product holds: its rows and its blocks. */
async function held(productId: string) {
  const states = (await reservationsOf(productId)).map((r) => r.state).sort();
  const kinds = (await blocksOf(productId)).map((b) => b.kind).sort();
  return `${states.join(",")} | ${kinds.join(",")}`;
}

const eventsOf = async (bookingId: string) =>
  (
    await service
      .from("audit_events")
      .select("action, after, actor")
      .eq("entity", "bookings")
      .eq("entity_id", bookingId)
      .order("id")
      .throwOnError()
  ).data!;

async function setShop(
  tenant: TestTenant,
  values: { allow_overbooking?: boolean; hold_minutes?: number },
) {
  const { error } = await service
    .from("tenants")
    .update(values)
    .eq("id", tenant.id);
  if (error) throw error;
}

/** Makes a hold's time run out, as the clock would. */
async function runOut(bookingId: string) {
  const { error } = await service
    .from("reservations")
    .update({ hold_expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("booking_id", bookingId)
    .eq("state", "held");
  if (error) throw error;
}

const booked = (result: Result): Booked => {
  expect(result.error, result.error?.message).toBeNull();
  expect(result.data, JSON.stringify(result.data)).toMatchObject({ ok: true });
  return result.data as Booked;
};

/** "ok" or the refusal's reason; a raised error fails the test. */
const outcome = (result: Result<Simple> | Result) => {
  expect(result.error, result.error?.message).toBeNull();
  const data = result.data as Simple;
  return data.ok ? "ok" : (data.reason as string);
};

/** No call was ended by Postgres to break a deadlock, caught or not. */
const noDeadlock = (
  results: { data?: unknown; error: Result["error"] | null }[],
) => {
  for (const result of results) {
    expect(result.error?.code, result.error?.message).not.toBe("40P01");
    expect(result.error?.message ?? "").not.toMatch(/deadlock/i);
    const data = result.data as Simple | null | undefined;
    if (data && typeof data === "object" && data.ok === false)
      expect(data.reason).not.toBe("try_again");
  }
};

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
  const running = Promise.resolve(call()).then((result) => {
    answered = true;
    return result;
  });
  await seenWaitingForLock(name);
  expect(answered, `${name} answered before the holder let go`).toBe(false);
  await gate.open();
  return running;
}

/**
 * Starts `call`, which may answer at once or wait for the holder, and comes
 * back when it has done one or the other: answered, or seen waiting for a
 * lock (`queryLike` is found in its statement). Polled with a bound.
 */
async function answeredOrWaiting<T>(
  queryLike: string,
  call: () => PromiseLike<T>,
): Promise<{ running: Promise<T> }> {
  let answered = false;
  const running = Promise.resolve(call()).then((result) => {
    answered = true;
    return result;
  });
  for (let i = 0; i < 200; i++) {
    if (answered) return { running };
    const { out, failed } = sql(
      `select count(*) from pg_stat_activity a where a.wait_event_type = 'Lock' and a.query like '%${queryLike}%' and a.query not like '%${GATE_WAIT}%' and a.pid <> pg_backend_pid();`,
    );
    expect(failed).toBe("");
    if (out !== "0") return { running };
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${queryLike} neither answered nor waited`);
}

/**
 * Postgres's count of detected deadlocks, once every session that has just
 * gone idle has handed in its numbers. A backend reports them up to a second
 * after its statement (the server's own PGSTAT_MIN_INTERVAL), and nothing in
 * the database shows whether it has yet: this pause is that interval, not a
 * race with a holder. Being late can only hide a deadlock, never invent one.
 */
async function deadlocksReported() {
  await new Promise((r) => setTimeout(r, 1200));
  return deadlocks();
}

const deadlocks = () =>
  Number(
    sql(
      `select pg_stat_force_next_flush(); select deadlocks from pg_stat_database where datname = current_database();`,
    )
      .out.split("\n")
      .pop(),
  );

/**
 * The session whose statement carries `needle` (a function's name) is
 * waiting for a product lock; with how many unit locks in hand. Keyed to
 * that session, so another one that happens to wait at the same moment (the
 * minute's sweep, say) is not mistaken for it.
 */
const waitingForProductLock = (needle: string) =>
  until(`
    select 'waiting, unit locks: ' || (
      select count(*) from pg_locks u
      where u.pid = w.pid and u.locktype = 'advisory' and u.classid = x'1a01'::int
    )
    from pg_locks w
    join pg_stat_activity a on a.pid = w.pid
    where w.locktype = 'advisory' and w.classid = x'1a02'::int and not w.granted
      and a.query like '%${needle}%' and a.pid <> pg_backend_pid()
    limit 1;
  `);

const everyShop = (): [string, TestTenant][] => [
  ["Bangkok", shop],
  ["New York", newYork],
  ["Saigon", saigon],
];

beforeAll(async () => {
  deadlocksBefore = deadlocks();
  [shop, newYork, saigon, outsider] = await Promise.all([
    createTenant("avail-bkk", {
      country: "TH",
      currency: "THB",
      locale: "th-TH",
      timezone: "Asia/Bangkok",
    }),
    createTenant("avail-nyc", {
      country: "US",
      currency: "USD",
      locale: "en-US",
      timezone: "America/New_York",
    }),
    createTenant("avail-sgn"),
    createUser("avail-outsider"),
  ]);
  catalogId = await createCatalogEntry("avail");
}, 120_000);

afterAll(async () => {
  console.log(`availability.test.ts: ${raceRounds} race rounds`);
  await Promise.all([
    deleteTenant(shop),
    deleteTenant(newYork),
    deleteTenant(saigon),
    deleteUser(outsider),
  ]);
  await removeCatalogEntry(catalogId);
});

describe("the shop's two settings", () => {
  it("overbooking is off and a hold lasts 15 minutes unless the shop says otherwise; 5 to 60", async () => {
    const { data } = await service
      .from("tenants")
      .select("allow_overbooking, hold_minutes")
      .eq("id", saigon.id)
      .single();
    expect(data).toEqual({ allow_overbooking: false, hold_minutes: 15 });
    for (const minutes of [4, 61]) {
      const { error } = await service
        .from("tenants")
        .update({ hold_minutes: minutes })
        .eq("id", saigon.id);
      expect(error?.message, String(minutes)).toMatch(
        /tenants_hold_minutes_check/,
      );
    }
    for (const minutes of [5, 60, 15])
      await setShop(saigon, { hold_minutes: minutes });
  });

  it("every member reads them; no signed-in person can change them yet, the owner included", async () => {
    for (const role of roles) {
      const read = await db(role)
        .from("tenants")
        .select("allow_overbooking, hold_minutes")
        .eq("id", shop.id)
        .single();
      expect(read.data, role).toEqual({
        allow_overbooking: false,
        hold_minutes: 15,
      });
      for (const change of [
        { allow_overbooking: true },
        { hold_minutes: 30 },
      ]) {
        const { error } = await db(role)
          .from("tenants")
          .update(change)
          .eq("id", shop.id);
        expect(error?.code, `${role} ${JSON.stringify(change)}`).toBe("42501");
      }
    }
    const { data } = await service
      .from("tenants")
      .select("allow_overbooking, hold_minutes")
      .eq("id", shop.id)
      .single();
    expect(data).toEqual({ allow_overbooking: false, hold_minutes: 15 });
  });
});

describe("holds", () => {
  it("a hold: rows 'held' with an expiry, blocks of kind 'hold', and the unit is not free for anyone else", async () => {
    const bike = await vehicle(1);
    const before = Date.now();
    const result = booked(
      await staffBook(
        "staff",
        [{ product_id: bike.id, starts_at: at(1), ends_at: at(2) }],
        { hold: true },
      ),
    );
    const expires = new Date(result.hold_expires_at!).getTime();
    // 15 minutes from the call, give or take the call itself.
    expect(expires - before).toBeGreaterThan(15 * 60_000 - 5_000);
    expect(expires - before).toBeLessThan(15 * 60_000 + 30_000);

    const [row] = await reservationsOf(bike.id);
    expect(row).toMatchObject({
      state: "held",
      shortage: 0,
      created_by: shop.members.staff.id,
    });
    expect(new Date(row.hold_expires_at!).getTime()).toBe(expires);
    expect(
      (await blocksOf(bike.id)).map((b) => `${b.kind} ${b.unit_id}`),
    ).toEqual([`hold ${bike.units[0]}`]);

    // Held is taken: for an online booking, for staff, by name.
    expect(
      outcome(
        await onlineBook([
          { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
        ]),
      ),
    ).toBe("unavailable");
    expect(
      outcome(
        await staffBook("owner", [
          {
            product_id: bike.id,
            starts_at: at(1),
            ends_at: at(2),
            unit_ids: bike.units,
          },
        ]),
      ),
    ).toBe("unit_taken");
    expect(await counts(bike.id, at(1), at(2))).toBe("1 / 0 / 0 / 0");

    // The event says it is a hold and when it runs out.
    const [event] = await eventsOf(result.booking_id);
    expect(event.action).toBe("reserve");
    expect(event.after).toMatchObject({
      hold: true,
      hold_expires_at: expect.any(String),
      lines: [{ unit_ids: bike.units, shortage: 0 }],
    });
  });

  it("a booking that is not a hold says so in its event, and has no expiry", async () => {
    const bike = await vehicle(1);
    const result = booked(
      await onlineBook([
        { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
      ]),
    );
    expect(result.hold_expires_at).toBeUndefined();
    const [event] = await eventsOf(result.booking_id);
    expect(event.after).toMatchObject({ hold: false, hold_expires_at: null });
    const [row] = await reservationsOf(bike.id);
    expect(row).toMatchObject({ state: "reserved", hold_expires_at: null });
  });

  it("the hold lasts as long as the shop says", async () => {
    await setShop(saigon, { hold_minutes: 45 });
    try {
      const bike = await vehicle(1, { tenant: saigon });
      const before = Date.now();
      const result = booked(
        await onlineBook(
          [{ product_id: bike.id, starts_at: at(1), ends_at: at(2) }],
          { tenant: saigon, hold: true },
        ),
      );
      const lasts = new Date(result.hold_expires_at!).getTime() - before;
      expect(lasts).toBeGreaterThan(45 * 60_000 - 5_000);
      expect(lasts).toBeLessThan(45 * 60_000 + 30_000);
    } finally {
      await setShop(saigon, { hold_minutes: 15 });
    }
  });

  it('"hold" must be true or false', async () => {
    const bike = await vehicle(1);
    const call = request(
      shop,
      "walk_in",
      "staff",
      [{ product_id: bike.id, starts_at: at(1), ends_at: at(2) }],
      false,
    );
    for (const hold of ["yes", 1, {}]) {
      const { error } = await db("staff").rpc("reserve", {
        ...call,
        p_request: { ...call.p_request, hold },
      });
      expect(error?.message, JSON.stringify(hold)).toBe("invalid_request");
    }
    expect(await reservationsOf(bike.id)).toEqual([]);
  });

  it("confirmed: the same rows and the same blocks, now a reservation; confirming again changes nothing", async () => {
    const bike = await vehicle(1);
    const helmet = await general("gear", 3);
    const result = booked(
      await staffBook(
        "manager",
        [
          { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
          {
            product_id: helmet.id,
            starts_at: at(1),
            ends_at: at(2),
            quantity: 2,
          },
        ],
        { hold: true },
      ),
    );
    const blocksBefore = [
      ...(await blocksOf(bike.id)),
      ...(await blocksOf(helmet.id)),
    ];
    expect(blocksBefore.map((b) => b.kind)).toEqual(["hold", "hold", "hold"]);

    const done = await confirm(db("staff"), shop, result.booking_id);
    expect(done.data).toEqual({
      ok: true,
      booking_id: result.booking_id,
      reservation_ids: result.lines.map((l) => l.reservation_id).sort(),
    });
    const blocksAfter = [
      ...(await blocksOf(bike.id)),
      ...(await blocksOf(helmet.id)),
    ];
    expect(blocksAfter.map((b) => `${b.id} ${b.unit_id}`)).toEqual(
      blocksBefore.map((b) => `${b.id} ${b.unit_id}`),
    );
    expect(blocksAfter.map((b) => b.kind)).toEqual([
      "allocation",
      "allocation",
      "allocation",
    ]);
    for (const row of [
      ...(await reservationsOf(bike.id)),
      ...(await reservationsOf(helmet.id)),
    ]) {
      expect(row).toMatchObject({ state: "reserved", hold_expires_at: null });
    }

    const again = await confirm(db("owner"), shop, result.booking_id);
    expect(again.data).toEqual({
      ok: true,
      booking_id: result.booking_id,
      reservation_ids: [],
    });
    expect((await eventsOf(result.booking_id)).map((e) => e.action)).toEqual([
      "reserve",
      "confirm",
    ]);
  });

  it("a hold is confirmed by whoever could have made it: the counter's by a member, an online one by the server", async () => {
    const bike = await vehicle(2);
    const line = { product_id: bike.id, starts_at: at(1), ends_at: at(2) };
    const counter = booked(await staffBook("staff", [line], { hold: true }));
    const online = booked(await onlineBook([line], { hold: true }));
    expect(outcome(await confirm(service, shop, counter.booking_id))).toBe(
      "not_allowed",
    );
    expect(outcome(await confirm(db("owner"), shop, online.booking_id))).toBe(
      "not_allowed",
    );
    expect(await held(bike.id)).toBe("held,held | hold,hold");
    expect(outcome(await confirm(db("owner"), shop, counter.booking_id))).toBe(
      "ok",
    );
    expect(outcome(await confirm(service, shop, online.booking_id))).toBe("ok");
    expect(await held(bike.id)).toBe(
      "reserved,reserved | allocation,allocation",
    );
  });

  it("a cancelled booking can't be confirmed, and a hold can be cancelled: its units come back", async () => {
    const bike = await vehicle(1);
    const line = { product_id: bike.id, starts_at: at(1), ends_at: at(2) };
    const result = booked(await staffBook("staff", [line], { hold: true }));
    const cancelled = await cancel(db("staff"), shop, result.booking_id);
    expect(outcome(cancelled)).toBe("ok");
    expect(await held(bike.id)).toBe("cancelled | ");
    expect(outcome(await confirm(db("staff"), shop, result.booking_id))).toBe(
      "not_held",
    );
    expect(await counts(bike.id, at(1), at(2))).toBe("1 / 1 / 0 / 1");
    expect(outcome(await onlineBook([line]))).toBe("ok");
  });

  it("a hold that has run out frees its unit at once: for the read, and for the next booking, which releases it", async () => {
    const bike = await vehicle(1);
    const line = { product_id: bike.id, starts_at: at(1), ends_at: at(2) };
    const hold = booked(await onlineBook([line], { hold: true }));
    expect(await counts(bike.id, at(1), at(2))).toBe("1 / 0 / 0 / 0");

    await runOut(hold.booking_id);
    // Released yet or not, it holds nothing.
    expect(await counts(bike.id, at(1), at(2))).toBe("1 / 1 / 0 / 1");

    const next = booked(await staffBook("staff", [line]));
    expect(next.lines[0].unit_ids).toEqual(bike.units);
    const rows = await reservationsOf(bike.id);
    expect(rows.map((r) => r.state)).toEqual(["expired", "reserved"]);
    // The expired row keeps the time it ran out.
    expect(rows[0].hold_expires_at).not.toBeNull();
    expect(
      (await blocksOf(bike.id)).map((b) => `${b.kind} ${b.reservation_id}`),
    ).toEqual([`allocation ${next.lines[0].reservation_id}`]);

    const events = await eventsOf(hold.booking_id);
    expect(events.map((e) => e.action)).toEqual(["reserve", "expire"]);
    expect(events[1].after).toEqual({
      reservation_ids: [hold.lines[0].reservation_id],
      lines: [
        { reservation_id: hold.lines[0].reservation_id, unit_ids: bike.units },
      ],
    });
  });

  it("a hold confirmed after it has run out is refused, released yet or not, and stays refused", async () => {
    for (const released of [false, true]) {
      const bike = await vehicle(1);
      const hold = booked(
        await staffBook(
          "staff",
          [{ product_id: bike.id, starts_at: at(1), ends_at: at(2) }],
          { hold: true },
        ),
      );
      await runOut(hold.booking_id);
      if (released) {
        const swept = await sweep();
        expect(swept.error).toBeNull();
        expect(await held(bike.id)).toBe("expired | ");
      }
      const late = await confirm(db("staff"), shop, hold.booking_id);
      expect(late.data, `released: ${released}`).toEqual({
        ok: false,
        reason: "hold_expired",
      });
      // Nothing was turned into a reservation.
      expect(
        (await reservationsOf(bike.id)).every((r) => r.state !== "reserved"),
      ).toBe(true);
      expect(
        (await blocksOf(bike.id)).every((b) => b.kind !== "allocation"),
      ).toBe(true);
      expect(
        (await eventsOf(hold.booking_id)).map((e) => e.action),
      ).not.toContain("confirm");
    }
  });

  it("the sweep releases every hold that has run out and leaves the others; it is scheduled every minute", async () => {
    const bike = await vehicle(3);
    const line = { product_id: bike.id, starts_at: at(1), ends_at: at(2) };
    const gone = booked(await staffBook("staff", [line], { hold: true }));
    const alsoGone = booked(await onlineBook([line], { hold: true }));
    const live = booked(await onlineBook([line], { hold: true }));
    await runOut(gone.booking_id);
    await runOut(alsoGone.booking_id);

    const swept = await sweep();
    expect(swept.error).toBeNull();
    const rows = await reservationsOf(bike.id);
    expect(rows.map((r) => r.state)).toEqual(["expired", "expired", "held"]);
    expect(
      (await blocksOf(bike.id)).map((b) => `${b.kind} ${b.reservation_id}`),
    ).toEqual([`hold ${live.lines[0].reservation_id}`]);
    expect(await counts(bike.id, at(1), at(2))).toBe("3 / 2 / 0 / 2");
    // Once each, whoever released it (this call or the job).
    for (const booking of [gone, alsoGone]) {
      expect((await eventsOf(booking.booking_id)).map((e) => e.action)).toEqual(
        ["reserve", "expire"],
      );
    }
    expect((await sweep()).error).toBeNull();
    expect(await held(bike.id)).toBe("expired,expired,held | hold");

    expect(
      sql(
        `select schedule || ' ' || command from cron.job where jobname = 'platform-release-expired-holds';`,
      ).out,
    ).toBe("* * * * * select platform_private.release_expired_holds()");
  });

  it("New York: a hold made minutes before each clock change runs out 15 elapsed minutes later, and the sweep releases it then and not before", async () => {
    // Spring forward, 9 March 2031: 01:50 EST is 06:50 UTC; 15 minutes later
    // the wall clock says 03:05 EDT. Fall back, 2 November 2031: 01:50 EDT
    // is 05:50 UTC; 15 minutes later it is 01:05 EST, "earlier" on the wall.
    const changes = [
      {
        made: "2031-03-09T06:50:00Z",
        expires: "2031-03-09T07:05:00Z",
        wallMade: "2031-03-09 01:50:00-05",
        wallExpires: "2031-03-09 03:05:00-04",
      },
      {
        made: "2031-11-02T05:50:00Z",
        expires: "2031-11-02T06:05:00Z",
        wallMade: "2031-11-02 01:50:00-04",
        wallExpires: "2031-11-02 01:05:00-05",
      },
    ];
    for (const change of changes) {
      // The arithmetic reserve() uses, in a session on New York time.
      const wall = sql(`
        set time zone 'America/New_York';
        select '${change.made}'::timestamptz;
        select platform_private.hold_expiry('${change.made}'::timestamptz, 15);
        select extract(epoch from platform_private.hold_expiry('${change.made}'::timestamptz, 15)
          - '${change.made}'::timestamptz)::int;
      `);
      expect(wall.failed).toBe("");
      expect(wall.out.split("\n").slice(-3)).toEqual([
        change.wallMade,
        change.wallExpires,
        "900",
      ]);

      // A hold in the New York shop that runs out at that moment.
      const bike = await vehicle(1, { tenant: newYork });
      const hold = booked(
        await onlineBook(
          [{ product_id: bike.id, starts_at: at(1), ends_at: at(2) }],
          { tenant: newYork, hold: true },
        ),
      );
      const moved = await service
        .from("reservations")
        .update({ hold_expires_at: change.expires })
        .eq("booking_id", hold.booking_id);
      expect(moved.error).toBeNull();

      const sweepAt = (when: string) =>
        sql(`
          set time zone 'America/New_York';
          select platform_private.release_expired_holds('${when}'::timestamptz, '${newYork.id}');
        `);
      // One second before: not yet, by the elapsed clock. A sweep that read
      // the wall clock would be an hour out one way or the other.
      const early = sweepAt(
        new Date(new Date(change.expires).getTime() - 1000).toISOString(),
      );
      expect(early.failed).toBe("");
      expect(early.out.split("\n").pop()).toBe("0");
      expect(await held(bike.id)).toBe("held | hold");
      // Fifty-nine minutes before, which the wall clock in autumn calls "after".
      const hourOut = sweepAt(
        new Date(
          new Date(change.expires).getTime() - 59 * 60_000,
        ).toISOString(),
      );
      expect(hourOut.out.split("\n").pop()).toBe("0");
      expect(await held(bike.id)).toBe("held | hold");

      const onTime = sweepAt(change.expires);
      expect(onTime.failed).toBe("");
      expect(onTime.out.split("\n").pop()).toBe("1");
      expect(await held(bike.id)).toBe("expired | ");
      expect(
        outcome(
          await onlineBook(
            [{ product_id: bike.id, starts_at: at(1), ends_at: at(2) }],
            { tenant: newYork },
          ),
        ),
      ).toBe("ok");
    }
  });

  it("a hold on a service is confirmed and runs out like any other, with no block", async () => {
    const wash = await general("service");
    const line = { product_id: wash.id, starts_at: at(1), ends_at: at(2) };
    const a = booked(await staffBook("staff", [line], { hold: true }));
    const b = booked(await staffBook("staff", [line], { hold: true }));
    expect(outcome(await confirm(db("staff"), shop, a.booking_id))).toBe("ok");
    await runOut(b.booking_id);
    expect((await sweep()).error).toBeNull();
    expect(await held(wash.id)).toBe("expired,reserved | ");
  });
});

describe("overbooking and the shortage rule", () => {
  it("off, as every shop starts: too few units answers unavailable for staff and online, and nothing is written", async () => {
    const bike = await vehicle(2);
    const line = {
      product_id: bike.id,
      starts_at: at(1),
      ends_at: at(2),
      quantity: 3,
    };
    for (const result of [
      await staffBook("owner", [line]),
      await staffBook("staff", [line], { hold: true }),
      await onlineBook([line]),
    ]) {
      expect(result.data).toEqual({
        ok: false,
        reason: "unavailable",
        line: 0,
      });
    }
    expect(await held(bike.id)).toBe(" | ");
  });

  it("on: staff's booking is saved with the units it could get and the rest as its shortage; an online channel still answers unavailable", async () => {
    await setShop(saigon, { allow_overbooking: true });
    try {
      const bike = await vehicle(2, { tenant: saigon });
      const line = {
        product_id: bike.id,
        starts_at: at(1),
        ends_at: at(2),
        quantity: 3,
      };
      for (const channel of ["booking_page", "marketplace", "api"]) {
        const online = await onlineBook([line], { tenant: saigon, channel });
        expect(online.data, channel).toEqual({
          ok: false,
          reason: "unavailable",
          line: 0,
        });
      }
      expect(await held(bike.id)).toBe(" | ");

      const short = booked(
        await staffBook("staff", [line], { tenant: saigon }),
      );
      expect(short.lines[0].shortage).toBe(1);
      expect([...short.lines[0].unit_ids].sort()).toEqual(
        [...bike.units].sort(),
      );
      const [row] = await reservationsOf(bike.id);
      expect(row).toMatchObject({
        state: "reserved",
        quantity: 3,
        shortage: 1,
      });
      expect(await held(bike.id)).toBe("reserved | allocation,allocation");
      const [event] = await eventsOf(short.booking_id);
      expect(event.after).toMatchObject({ lines: [{ shortage: 1 }] });

      // Nothing free at all: saved with no unit, all of it short.
      const none = booked(
        await staffBook("owner", [{ ...line, quantity: 2 }], {
          tenant: saigon,
          channel: "phone",
        }),
      );
      expect(none.lines[0]).toMatchObject({ unit_ids: [], shortage: 2 });
      // Online still can't, with one unit or three.
      expect(
        outcome(
          await onlineBook([{ ...line, quantity: 1 }], { tenant: saigon }),
        ),
      ).toBe("unavailable");
      // Mechanics and drivers can't book at all, short or not.
      for (const role of ["mechanic", "driver"] as const) {
        expect(outcome(await staffBook(role, [line], { tenant: saigon }))).toBe(
          "not_allowed",
        );
      }
    } finally {
      await setShop(saigon, { allow_overbooking: false });
    }
  });

  it("a line that names its units is never saved short: a busy named unit is unit_taken, overbooking or not", async () => {
    await setShop(saigon, { allow_overbooking: true });
    try {
      const bike = await vehicle(1, { tenant: saigon });
      const line = {
        product_id: bike.id,
        starts_at: at(1),
        ends_at: at(2),
        unit_ids: bike.units,
      };
      booked(await staffBook("staff", [line], { tenant: saigon }));
      expect(
        (await staffBook("staff", [line], { tenant: saigon })).data,
      ).toEqual({ ok: false, reason: "unit_taken", line: 0 });
    } finally {
      await setShop(saigon, { allow_overbooking: false });
    }
  });

  it("shortage demand is taken off what is free: a unit a short reservation is waiting for can't be booked by anyone else, by name either", async () => {
    await setShop(saigon, { allow_overbooking: true });
    const o = { tenant: saigon };
    try {
      const bike = await vehicle(2, o);
      const window = { starts_at: at(10), ends_at: at(12) };
      const short = booked(
        await staffBook(
          "staff",
          [{ product_id: bike.id, ...window, quantity: 3 }],
          o,
        ),
      );
      expect(short.lines[0].shortage).toBe(1);
      expect(await counts(bike.id, at(10), at(12), saigon)).toBe(
        "2 / 0 / 1 / 0",
      );

      // A third scooter arrives. It is free, and owed.
      const [third] = await addUnits(bike.id, 1, saigon);
      expect(await counts(bike.id, at(10), at(12), saigon)).toBe(
        "3 / 1 / 1 / 0",
      );
      // Any window that touches the short one sees it; one that doesn't, doesn't.
      expect(await counts(bike.id, at(11), at(14), saigon)).toBe(
        "3 / 1 / 1 / 0",
      );
      expect(await counts(bike.id, at(12), at(14), saigon)).toBe(
        "3 / 3 / 0 / 3",
      );

      const line = { product_id: bike.id, starts_at: at(11), ends_at: at(13) };
      expect(outcome(await onlineBook([line], o))).toBe("unavailable");
      expect(
        (await staffBook("owner", [{ ...line, unit_ids: [third] }], o)).data,
      ).toEqual({ ok: false, reason: "unavailable", line: 0 });
      // With overbooking off again, staff are refused like everyone.
      await setShop(saigon, { allow_overbooking: false });
      expect(outcome(await staffBook("staff", [line], o))).toBe("unavailable");
      await setShop(saigon, { allow_overbooking: true });
      // On: staff's own booking joins the queue, short, without the unit.
      const second = booked(await staffBook("staff", [line], o));
      expect(second.lines[0]).toMatchObject({ unit_ids: [], shortage: 1 });
      expect(await counts(bike.id, at(11), at(12), saigon)).toBe(
        "3 / 1 / 2 / 0",
      );
      expect(
        (await blocksOf(bike.id)).filter((b) => b.unit_id === third),
      ).toEqual([]);

      // A cancelled short reservation is owed nothing.
      expect(
        outcome(await cancel(db("staff", saigon), saigon, second.booking_id)),
      ).toBe("ok");
      expect(
        outcome(await cancel(db("staff", saigon), saigon, short.booking_id)),
      ).toBe("ok");
      expect(await counts(bike.id, at(10), at(12), saigon)).toBe(
        "3 / 3 / 0 / 3",
      );
    } finally {
      await setShop(saigon, { allow_overbooking: false });
    }
  });

  it("shortage demand is the most owed at any one moment of the window, not the sum over it", async () => {
    await setShop(saigon, { allow_overbooking: true });
    const o = { tenant: saigon };
    try {
      const helmet = await general("gear", 0, saigon);
      const want = (from: number, to: number, quantity: number) =>
        staffBook(
          "staff",
          [
            {
              product_id: helmet.id,
              starts_at: at(from),
              ends_at: at(to),
              quantity,
            },
          ],
          o,
        );
      // Days 1 to 3: 2 short. Days 5 to 7: 1 short. Days 6 to 9: 3 short.
      for (const [from, to, quantity] of [
        [1, 3, 2],
        [5, 7, 1],
        [6, 9, 3],
      ]) {
        expect(booked(await want(from, to, quantity)).lines[0].shortage).toBe(
          quantity,
        );
      }
      const demand = async (from: number, to: number) =>
        (await counts(helmet.id, at(from), at(to), saigon)).split(" / ")[2];
      expect(await demand(0, 1)).toBe("0");
      expect(await demand(0, 4)).toBe("2");
      expect(await demand(3, 5)).toBe("0");
      expect(await demand(4, 6)).toBe("1");
      // 2, then 1, then 1 + 3 on day 6: the busiest moment is 4, not 6.
      expect(await demand(0, 10)).toBe("4");
      expect(await demand(7, 8)).toBe("3");
      // Stock arrives: 5 helmets, 4 of them owed on day 6.
      const { error } = await db("owner", saigon).rpc("set_stock_quantity", {
        p_product_id: helmet.id,
        p_location_id: saigon.locationId,
        p_quantity: 5,
      });
      expect(error).toBeNull();
      expect(await counts(helmet.id, at(6), at(7), saigon)).toBe(
        "5 / 5 / 4 / 1",
      );
      expect(
        outcome(
          await onlineBook(
            [
              {
                product_id: helmet.id,
                starts_at: at(6),
                ends_at: at(7),
                quantity: 2,
              },
            ],
            o,
          ),
        ),
      ).toBe("unavailable");
      expect(
        outcome(
          await onlineBook(
            [{ product_id: helmet.id, starts_at: at(6), ends_at: at(7) }],
            o,
          ),
        ),
      ).toBe("ok");
    } finally {
      await setShop(saigon, { allow_overbooking: false });
    }
  });

  it("two lines for one product in one call: the second can't take what the first is short of", async () => {
    await setShop(saigon, { allow_overbooking: true });
    try {
      const bike = await vehicle(1, { tenant: saigon });
      const line = {
        product_id: bike.id,
        starts_at: at(1),
        ends_at: at(2),
        quantity: 2,
      };
      const both = booked(
        await staffBook("staff", [line, { ...line, quantity: 1 }], {
          tenant: saigon,
        }),
      );
      expect(
        both.lines.map((l) => `${l.unit_ids.length} ${l.shortage}`),
      ).toEqual(["1 1", "0 1"]);
    } finally {
      await setShop(saigon, { allow_overbooking: false });
    }
  });

  it("a hold that is short stops being owed when it runs out", async () => {
    await setShop(saigon, { allow_overbooking: true });
    try {
      const bike = await vehicle(1, { tenant: saigon });
      const short = booked(
        await staffBook(
          "staff",
          [
            {
              product_id: bike.id,
              starts_at: at(1),
              ends_at: at(2),
              quantity: 2,
            },
          ],
          { tenant: saigon, hold: true },
        ),
      );
      expect(await counts(bike.id, at(1), at(2), saigon)).toBe("1 / 0 / 1 / 0");
      await runOut(short.booking_id);
      expect(await counts(bike.id, at(1), at(2), saigon)).toBe("1 / 1 / 0 / 1");
    } finally {
      await setShop(saigon, { allow_overbooking: false });
    }
  });
});

describe("assign_units()", () => {
  /** A reservation for 3 of a 2-unit scooter in Saigon, short by 1, then a third unit. */
  async function shortOne() {
    await setShop(saigon, { allow_overbooking: true });
    const bike = await vehicle(2, { tenant: saigon });
    const short = booked(
      await staffBook(
        "staff",
        [
          {
            product_id: bike.id,
            starts_at: at(1),
            ends_at: at(3),
            quantity: 3,
          },
        ],
        { tenant: saigon },
      ),
    );
    await setShop(saigon, { allow_overbooking: false });
    const [third] = await addUnits(bike.id, 1, saigon);
    return { bike, short, third, id: short.lines[0].reservation_id };
  }

  it("fills a shortage when a unit frees up, and says so in the booking's history", async () => {
    const { bike, short, third, id } = await shortOne();
    // Nothing free yet for a second short reservation to take.
    const filled = await assign(db("staff", saigon), saigon, id);
    expect(filled.error).toBeNull();
    expect(filled.data).toMatchObject({
      ok: true,
      reservation_id: id,
      added: [third],
      removed: [],
      shortage: 0,
    });
    expect((filled.data!.unit_ids as string[]).sort()).toEqual(
      [...bike.units, third].sort(),
    );
    const [row] = await reservationsOf(bike.id);
    expect(row).toMatchObject({ shortage: 0, state: "reserved" });
    expect(await held(bike.id)).toBe(
      "reserved | allocation,allocation,allocation",
    );
    expect(await counts(bike.id, at(1), at(3), saigon)).toBe("3 / 0 / 0 / 0");
    const events = await eventsOf(short.booking_id);
    expect(events.map((e) => e.action)).toEqual(["reserve", "assign"]);
    expect(events[1]).toMatchObject({
      actor: saigon.members.staff.id,
      after: { reservation_id: id, added: [third], removed: [], shortage: 0 },
    });
    // Nothing left to fill: fine, and nothing more is written.
    const again = await assign(db("owner", saigon), saigon, id);
    expect(again.data).toMatchObject({ ok: true, added: [], shortage: 0 });
    expect(await eventsOf(short.booking_id)).toHaveLength(2);
  });

  it("with no unit free the shortage stays and the answer is unavailable; part of it is filled when only part can be", async () => {
    await setShop(saigon, { allow_overbooking: true });
    const bike = await vehicle(1, { tenant: saigon });
    const short = booked(
      await staffBook(
        "staff",
        [
          {
            product_id: bike.id,
            starts_at: at(1),
            ends_at: at(3),
            quantity: 4,
          },
        ],
        { tenant: saigon },
      ),
    );
    await setShop(saigon, { allow_overbooking: false });
    const id = short.lines[0].reservation_id;
    expect((await assign(db("staff", saigon), saigon, id)).data).toEqual({
      ok: false,
      reason: "unavailable",
    });
    await addUnits(bike.id, 2, saigon);
    const part = await assign(db("staff", saigon), saigon, id);
    expect(part.data).toMatchObject({ ok: true, shortage: 1 });
    expect((part.data!.added as string[]).length).toBe(2);
    expect((await reservationsOf(bike.id))[0].shortage).toBe(1);
  });

  it("by name: a chosen unit fills the shortage; a reservation is moved to another unit and the first is free again", async () => {
    const { bike, third, id } = await shortOne();
    const named = await assign(db("manager", saigon), saigon, id, [
      ...bike.units,
      third,
    ]);
    expect(named.data).toMatchObject({ ok: true, added: [third], shortage: 0 });

    // Staff's swap before pickup: one booked scooter for another.
    const other = await vehicle(2, { tenant: saigon });
    const [a, b] = other.units;
    const one = booked(
      await staffBook(
        "staff",
        [
          {
            product_id: other.id,
            starts_at: at(1),
            ends_at: at(2),
            unit_ids: [a],
          },
        ],
        { tenant: saigon },
      ),
    );
    const moved = await assign(
      db("staff", saigon),
      saigon,
      one.lines[0].reservation_id,
      [b],
    );
    expect(moved.data).toEqual({
      ok: true,
      reservation_id: one.lines[0].reservation_id,
      unit_ids: [b],
      added: [b],
      removed: [a],
      shortage: 0,
    });
    expect(
      (await blocksOf(other.id)).map((x) => `${x.kind} ${x.unit_id}`),
    ).toEqual([`allocation ${b}`]);
    expect(
      outcome(
        await onlineBook(
          [{ product_id: other.id, starts_at: at(1), ends_at: at(2) }],
          { tenant: saigon },
        ),
      ),
    ).toBe("ok");
    // The same units again: nothing to do.
    const same = await assign(
      db("staff", saigon),
      saigon,
      one.lines[0].reservation_id,
      [b],
    );
    expect(same.data).toMatchObject({ ok: true, added: [], removed: [] });
  });

  it("a held reservation keeps blocks of kind 'hold' when it is moved", async () => {
    const bike = await vehicle(2);
    const [a, b] = bike.units;
    const hold = booked(
      await staffBook(
        "staff",
        [
          {
            product_id: bike.id,
            starts_at: at(1),
            ends_at: at(2),
            unit_ids: [a],
          },
        ],
        { hold: true },
      ),
    );
    expect(
      outcome(
        await assign(db("staff"), shop, hold.lines[0].reservation_id, [b]),
      ),
    ).toBe("ok");
    expect(
      (await blocksOf(bike.id)).map((x) => `${x.kind} ${x.unit_id}`),
    ).toEqual([`hold ${b}`]);
  });

  it("what it refuses: a busy unit, fewer units than it holds, more than its quantity, another product's unit, and a reservation that is over", async () => {
    const bike = await vehicle(3);
    const [a, b, c] = bike.units;
    const window = { starts_at: at(1), ends_at: at(2) };
    const one = booked(
      await staffBook("staff", [
        { product_id: bike.id, ...window, unit_ids: [a] },
      ]),
    );
    booked(
      await staffBook("staff", [
        { product_id: bike.id, ...window, unit_ids: [b] },
      ]),
    );
    const id = one.lines[0].reservation_id;
    expect((await assign(db("staff"), shop, id, [b])).data).toEqual({
      ok: false,
      reason: "unit_taken",
    });
    // A unit in repair is not free either.
    await service.from("units").update({ status: "maintenance" }).eq("id", c);
    expect(outcome(await assign(db("staff"), shop, id, [c]))).toBe(
      "unit_taken",
    );
    await service.from("units").update({ status: "active" }).eq("id", c);

    for (const units of [[], [a, c], [a, a]]) {
      const { error } = await assign(db("staff"), shop, id, units);
      expect(error?.message, JSON.stringify(units)).toBe("invalid_request");
    }
    const other = await vehicle(1);
    for (const unit of [other.units[0], randomUUID()]) {
      const { error } = await assign(db("staff"), shop, id, [unit]);
      expect(error?.message).toBe("unit_not_found");
    }
    // Counted gear has no unit to name; a service has none at all.
    const helmet = await general("gear", 2);
    const gear = booked(
      await staffBook("staff", [{ product_id: helmet.id, ...window }]),
    );
    expect(
      (
        await assign(db("staff"), shop, gear.lines[0].reservation_id, [
          helmet.units[0],
        ])
      ).error?.message,
    ).toBe("invalid_request");
    const wash = await general("service");
    const service_ = booked(
      await staffBook("staff", [{ product_id: wash.id, ...window }]),
    );
    expect(
      outcome(
        await assign(db("staff"), shop, service_.lines[0].reservation_id),
      ),
    ).toBe("not_assignable");

    expect(await held(bike.id)).toBe(
      "reserved,reserved | allocation,allocation",
    );
    // Cancelled, collected, returned, expired: not assignable.
    expect(outcome(await cancel(db("staff"), shop, one.booking_id))).toBe("ok");
    expect(outcome(await assign(db("staff"), shop, id, [c]))).toBe(
      "not_assignable",
    );
    for (const state of ["out", "returned"]) {
      await service.from("reservations").update({ state }).eq("id", id);
      expect(outcome(await assign(db("staff"), shop, id)), state).toBe(
        "not_assignable",
      );
    }
    const hold = booked(
      await staffBook("staff", [{ product_id: bike.id, ...window }], {
        hold: true,
      }),
    );
    await runOut(hold.booking_id);
    expect(
      outcome(await assign(db("staff"), shop, hold.lines[0].reservation_id)),
    ).toBe("not_assignable");
  });

  it("fills a shortage under the locks: it waits for the product's lock with no unit lock in hand", async () => {
    const { bike, third, id } = await shortOne();
    const marker = `hold-product-assign-${tag}`;
    const gate = await closedGate();
    const holder = sqlBackground(`
      begin;
      select platform_private.lock_products_stock(
        array['${bike.id}']::uuid[], array['${saigon.locationId}']::uuid[]);
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    const call = assign(db("staff", saigon), saigon, id);
    expect(await waitingForProductLock("assign_units")).toBe(
      "waiting, unit locks: 0",
    );
    await gate.open();
    expect((await holder).failed).toBe("");
    expect((await call).data).toMatchObject({ ok: true, added: [third] });
  }, 60_000);

  it("a downtime written on the unit it picked, not yet saved: it waits for that unit's lock, reads again, and takes another unit or answers unavailable", async () => {
    for (const spare of [true, false]) {
      const { bike, third, id } = await shortOne();
      const extra = spare ? (await addUnits(bike.id, 1, saigon))[0] : null;
      // Without a block on either, the pick goes by the lower lock key.
      const first = sql(
        `select id from platform.units where id in ('${third}'${extra ? `, '${extra}'` : ""}) order by hashtext(id::text), id limit 1;`,
      ).out;
      const marker = `hold-downtime-assign-${tag}-${spare}`;
      const gate = await closedGate();
      const holder = sqlBackground(`
        begin;
        insert into platform.unit_blocks (tenant_id, unit_id, kind, period)
        values ('${saigon.id}', '${first}', 'downtime',
          tstzrange('${at(2).toISOString()}', '${at(4).toISOString()}'));
        ${gate.wait(marker)}
        commit;
      `);
      await holding(marker);
      const call = assign(db("staff", saigon), saigon, id);
      const seen = await until(`
        select 'waiting for the unit, product locks: ' || (
          select count(*) from pg_locks g
          where g.pid = w.pid and g.locktype = 'advisory' and g.granted
            and g.classid = x'1a02'::int
        )
        from pg_locks w
        where w.locktype = 'advisory' and w.classid = x'1a01'::int and not w.granted
          and w.objid::bigint = (hashtext('${first}')::bigint & 4294967295)
        limit 1;
      `);
      expect(seen).toBe("waiting for the unit, product locks: 1");
      await gate.open();
      expect((await holder).failed).toBe("");
      const result = await call;
      if (spare) {
        expect(result.data).toMatchObject({
          ok: true,
          added: [[third, extra].find((u) => u !== first)],
          shortage: 0,
        });
      } else {
        expect(result.data).toEqual({ ok: false, reason: "unavailable" });
        expect((await reservationsOf(bike.id))[0].shortage).toBe(1);
      }
    }
  }, 90_000);
});

describe("a unit still out past its end is not free", () => {
  it("with a hand-set 'out' state: no new booking gets it, whatever the window, until it is checked in", async () => {
    const bike = await vehicle(2);
    const [late, other] = bike.units;
    // Collected three hours ago, due back an hour ago.
    const rental = booked(
      await staffBook("staff", [
        {
          product_id: bike.id,
          starts_at: hoursFromNow(-3),
          ends_at: hoursFromNow(-1),
          unit_ids: [late],
        },
      ]),
    );
    const id = rental.lines[0].reservation_id;
    // Reserved and past its end is just a past booking: both are free.
    expect(await counts(bike.id, at(1), at(2))).toBe("2 / 2 / 0 / 2");

    // Nothing can be 'out' until Phase 3: set by hand.
    await service.from("reservations").update({ state: "out" }).eq("id", id);
    for (const [from, to] of [
      [hoursFromNow(1), hoursFromNow(2)],
      [at(1), at(2)],
      [at(300), at(330)],
    ]) {
      expect(await counts(bike.id, from, to)).toBe("2 / 1 / 0 / 1");
    }
    const line = { product_id: bike.id, starts_at: at(1), ends_at: at(2) };
    expect(
      (await staffBook("owner", [{ ...line, unit_ids: [late] }])).data,
    ).toEqual({ ok: false, reason: "unit_taken", line: 0 });
    expect(outcome(await onlineBook([{ ...line, quantity: 2 }]))).toBe(
      "unavailable",
    );
    const next = booked(await onlineBook([line]));
    expect(next.lines[0].unit_ids).toEqual([other]);
    // A reservation can't be moved onto it either.
    expect(
      outcome(
        await assign(db("staff"), shop, next.lines[0].reservation_id, [late]),
      ),
    ).toBe("unit_taken");

    // Checked in: free again.
    await service
      .from("reservations")
      .update({ state: "returned" })
      .eq("id", id);
    expect(await counts(bike.id, at(5), at(6))).toBe("2 / 2 / 0 / 2");
    expect(
      outcome(
        await staffBook("owner", [
          {
            product_id: bike.id,
            starts_at: at(5),
            ends_at: at(6),
            unit_ids: [late],
          },
        ]),
      ),
    ).toBe("ok");
  });

  it("out and not yet due back blocks its own window only; bookings already made on a late unit stay", async () => {
    const bike = await vehicle(1);
    const rental = booked(
      await staffBook("staff", [
        {
          product_id: bike.id,
          starts_at: hoursFromNow(-2),
          ends_at: hoursFromNow(2),
        },
      ]),
    );
    const later = booked(
      await onlineBook([
        { product_id: bike.id, starts_at: at(3), ends_at: at(4) },
      ]),
    );
    await service
      .from("reservations")
      .update({ state: "out" })
      .eq("id", rental.lines[0].reservation_id);
    // Not late: tomorrow is free, now is not.
    expect(await counts(bike.id, at(1), at(2))).toBe("1 / 1 / 0 / 1");
    expect(await counts(bike.id, hoursFromNow(1), hoursFromNow(3))).toBe(
      "1 / 0 / 0 / 0",
    );
    // Now it is late: due back an hour ago.
    const due = [hoursFromNow(-3), hoursFromNow(-1)];
    await service
      .from("reservations")
      .update({
        starts_at: due[0].toISOString(),
        ends_at: due[1].toISOString(),
        block_period: period(due[0], hoursFromNow(2)),
      })
      .eq("id", rental.lines[0].reservation_id)
      .throwOnError();
    expect(await counts(bike.id, at(1), at(2))).toBe("1 / 0 / 0 / 0");
    // The later booking is untouched: Phase 3 flags it for staff to move.
    const rows = await reservationsOf(bike.id);
    expect(rows.find((r) => r.booking_id === later.booking_id)).toMatchObject({
      state: "reserved",
    });
    expect((await blocksOf(bike.id)).length).toBe(2);
  });
});

describe("availability(): the read", () => {
  it("stock, free and available against bookings, holds and downtime; buffers widen both sides; only units in use are stock", async () => {
    const bike = await vehicle(6, { before: 60, after: 120 });
    const [a, b, c, d, e] = bike.units;
    // a booked days 2 to 4, b held days 3 to 5, c in downtime days 1 to 2.
    booked(
      await staffBook("staff", [
        {
          product_id: bike.id,
          starts_at: at(2),
          ends_at: at(4),
          unit_ids: [a],
        },
      ]),
    );
    booked(
      await staffBook(
        "staff",
        [
          {
            product_id: bike.id,
            starts_at: at(3),
            ends_at: at(5),
            unit_ids: [b],
          },
        ],
        { hold: true },
      ),
    );
    await service
      .from("unit_blocks")
      .insert({
        tenant_id: shop.id,
        unit_id: c,
        kind: "downtime",
        period: period(at(1), at(2)),
      })
      .throwOnError();
    // d is in repair, e is retired: neither is stock.
    await service.from("units").update({ status: "maintenance" }).eq("id", d);
    await service.from("units").update({ status: "retired" }).eq("id", e);

    expect(await counts(bike.id, at(0, 1), at(0, 20))).toBe("4 / 4 / 0 / 4");
    expect(await counts(bike.id, at(1, 6), at(1, 12))).toBe("4 / 3 / 0 / 3");
    expect(await counts(bike.id, at(3, 6), at(3, 12))).toBe("4 / 2 / 0 / 2");
    expect(await counts(bike.id, at(1), at(6))).toBe("4 / 1 / 0 / 1");
    // a's block ends at day 4 + 2 h (its after); a request is widened by
    // 1 h before. So a is free for a pickup from day 4, 03:00.
    expect(await counts(bike.id, at(4, 2), at(4, 3))).toBe("4 / 2 / 0 / 2");
    expect(await counts(bike.id, at(4, 3), at(4, 4))).toBe("4 / 3 / 0 / 3");
    // And before a: its block starts at day 2 less 1 h; a return by day 1,
    // 21:00 plus 2 h after just clears it (c's downtime still counts).
    expect(await counts(bike.id, at(1, 20), at(1, 21))).toBe("4 / 3 / 0 / 3");
    expect(await counts(bike.id, at(1, 20), at(1, 22))).toBe("4 / 2 / 0 / 2");

    for (const status of ["sold", "lost"]) {
      await service.from("units").update({ status }).eq("id", d);
      expect((await counts(bike.id, at(20), at(21))).startsWith("4 / 4")).toBe(
        true,
      );
    }
  });

  it("several items in one call, answered in the order sent; every role reads the same counts", async () => {
    const bike = await vehicle(2);
    const helmet = await general("gear", 5);
    booked(
      await staffBook("staff", [
        { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
        {
          product_id: helmet.id,
          starts_at: at(1),
          ends_at: at(2),
          quantity: 2,
        },
      ]),
    );
    const items = [
      { product_id: helmet.id, starts_at: at(1), ends_at: at(2) },
      { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
      { product_id: bike.id, starts_at: at(5), ends_at: at(6) },
    ];
    for (const role of roles) {
      const { data, error } = await availability(db(role), shop, items);
      expect(error, role).toBeNull();
      expect(
        data!.map((a) => `${a.type} ${a.stock}/${a.free}/${a.available}`),
        role,
      ).toEqual(["gear 5/3/3", "vehicle 2/1/1", "vehicle 2/2/2"]);
      expect(data![0]).toMatchObject({
        product_id: helmet.id,
        location_id: shop.locationId,
        unlimited: false,
        marketplace: null,
      });
    }
  });

  it("a service has nothing to count; an item for sale answers what the ledger has on hand; another place's units are not counted", async () => {
    const wash = await general("service");
    const oil = await general("sale_item", 7);
    const bike = await vehicle(2);
    const second = await service
      .from("locations")
      .insert({
        tenant_id: shop.id,
        name: name("Branch"),
        timezone: "Asia/Bangkok",
      })
      .select("id")
      .single();
    expect(second.error).toBeNull();
    await addUnits(bike.id, 3, shop, second.data!.id);
    booked(
      await staffBook("staff", [
        {
          product_id: bike.id,
          location_id: second.data!.id,
          starts_at: at(1),
          ends_at: at(2),
        },
      ]),
    );

    const { data, error } = await availability(db("driver"), shop, [
      { product_id: wash.id, starts_at: at(1), ends_at: at(2) },
      { product_id: oil.id, starts_at: at(1), ends_at: at(2) },
      { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
      {
        product_id: bike.id,
        location_id: second.data!.id,
        starts_at: at(1),
        ends_at: at(2),
      },
      {
        product_id: oil.id,
        location_id: second.data!.id,
        starts_at: at(1),
        ends_at: at(2),
      },
    ]);
    expect(error).toBeNull();
    expect(
      data!.map(
        (a) => `${a.type} ${a.stock}/${a.free}/${a.available} ${a.unlimited}`,
      ),
    ).toEqual([
      "service null/null/null true",
      "sale_item 7/7/7 false",
      "vehicle 2/2/2 false",
      "vehicle 3/2/2 false",
      "sale_item 0/0/0 false",
    ]);
  });

  it("the Moto Mangos figures: the most advance bookings out at once, by kind; Ride today and other channels don't count", async () => {
    const bike = await vehicle(6);
    // Only a product on an approved list entry can be listed.
    await service
      .from("products")
      .update({ catalog_id: catalogId })
      .eq("id", bike.id)
      .throwOnError();
    const listed = await forceListing(shop.id, bike.id, {
      marketplace_listed: true,
      instant_units: 3,
      request_units: 1,
    });
    expect(listed.error).toBeNull();
    const mm = (from: number, to: number, mode = "instant", hold = false) =>
      service.rpc(
        "reserve",
        request(
          shop,
          "marketplace",
          mode,
          [{ product_id: bike.id, starts_at: at(from), ends_at: at(to) }],
          hold,
        ),
      ) as unknown as Promise<Result>;
    booked(await mm(1, 3));
    booked(await mm(2, 4));
    booked(await mm(5, 6));
    booked(await mm(2, 3, "now"));
    const hold = booked(await mm(2, 3, "instant", true));
    booked(
      await onlineBook([
        { product_id: bike.id, starts_at: at(2), ends_at: at(3) },
      ]),
    );
    booked(
      await staffBook("staff", [
        { product_id: bike.id, starts_at: at(2), ends_at: at(3) },
      ]),
    );
    const figures = async (from: number, to: number) => {
      const { data } = await availability(db("staff"), shop, [
        { product_id: bike.id, starts_at: at(from), ends_at: at(to) },
      ]);
      const m = data![0].marketplace!;
      return `${data![0].free} free, held ${m.mm_held}, instant ${m.mm_instant}, request ${m.mm_request}, offers ${m.instant_units}+${m.request_units} ${m.enabled}`;
    };
    // Days 2 to 3: three Moto Mangos advance bookings (one a hold) hold a
    // scooter; six bookings in all.
    expect(await figures(2, 3)).toBe(
      "0 free, held 3, instant 3, request 0, offers 3+1 true",
    );
    expect(await figures(0, 10)).toBe(
      "0 free, held 3, instant 3, request 0, offers 3+1 true",
    );
    expect(await figures(3, 5)).toBe(
      "5 free, held 1, instant 1, request 0, offers 3+1 true",
    );
    expect(await figures(4, 5)).toBe(
      "6 free, held 0, instant 0, request 0, offers 3+1 true",
    );
    // A hold that has run out counts for nothing.
    await runOut(hold.booking_id);
    expect(await figures(2, 3)).toBe(
      "1 free, held 2, instant 2, request 0, offers 3+1 true",
    );
  });

  it("refuses a request that could not have come from our own code, a retired product and an unknown place", async () => {
    const bike = await vehicle(1);
    const good = {
      product_id: bike.id,
      location_id: shop.locationId,
      starts_at: at(1).toISOString(),
      ends_at: at(2).toISOString(),
    };
    const call = (items: unknown) =>
      db("staff").rpc("availability", {
        p_tenant_id: shop.id,
        p_items: items as never,
      });
    for (const [what, items] of Object.entries({
      "not a list": good,
      "an empty list": [],
      "an item that is not an object": ["x"],
      "an unknown key": [{ ...good, quantity: 1 }],
      "no product": [{ ...good, product_id: undefined }],
      "a time with no offset": [{ ...good, starts_at: "2032-01-02T00:00:00" }],
      "an end before its start": [{ ...good, ends_at: good.starts_at }],
      "more than 200 items": Array.from({ length: 201 }, () => good),
    })) {
      const { error } = await call(items);
      expect(error?.message, what).toBe("invalid_request");
    }
    expect((await call([good])).error).toBeNull();
    expect(
      (await call([{ ...good, location_id: randomUUID() }])).error?.message,
    ).toBe("location_not_found");
    await service
      .from("units")
      .update({ status: "retired" })
      .eq("product_id", bike.id);
    await service
      .from("products")
      .update({ retired_at: new Date().toISOString() })
      .eq("id", bike.id)
      .throwOnError();
    expect((await call([good])).error?.message).toBe("product_not_found");
  });

  it(
    "takes no lock: it answers while a booking holds the product's lock",
    async () => {
      const bike = await vehicle(2);
      const marker = `hold-product-read-${tag}`;
      const gate = await closedGate();
      const holder = sqlBackground(`
      begin;
      select platform_private.lock_products_stock(
        array['${bike.id}']::uuid[], array['${shop.locationId}']::uuid[]);
      select platform_private.lock_units(array['${bike.units[0]}', '${bike.units[1]}']::uuid[]);
      ${gate.wait(marker)}
      commit;
    `);
      await holding(marker);
      expect(await counts(bike.id, at(1), at(2), shop, db("mechanic"))).toBe(
        "2 / 2 / 0 / 2",
      );
      // Back while the holder still has its locks: it waited for none of them.
      await stillHolding(marker);
      await gate.open();
      expect((await holder).failed).toBe("");
    },
    GATE_TEST_TIMEOUT,
  );
});

describe("who may call each new function", () => {
  it("confirm_hold and assign_units: owners, managers and staff; mechanics and drivers are refused and nothing changes", async () => {
    for (const role of roles) {
      const allowed = ["owner", "manager", "staff"].includes(role);
      const bike = await vehicle(2);
      const [a, b] = bike.units;
      const hold = booked(
        await staffBook(
          "staff",
          [
            {
              product_id: bike.id,
              starts_at: at(1),
              ends_at: at(2),
              unit_ids: [a],
            },
          ],
          { hold: true },
        ),
      );
      const moved = await assign(db(role), shop, hold.lines[0].reservation_id, [
        b,
      ]);
      expect(outcome(moved), `${role} assigns`).toBe(
        allowed ? "ok" : "not_allowed",
      );
      const confirmed = await confirm(db(role), shop, hold.booking_id);
      expect(outcome(confirmed), `${role} confirms`).toBe(
        allowed ? "ok" : "not_allowed",
      );
      expect(await held(bike.id), role).toBe(
        allowed ? "reserved | allocation" : "held | hold",
      );
      expect((await blocksOf(bike.id))[0].unit_id, role).toBe(allowed ? b : a);
    }
  });

  it("the service role can't assign units: that is staff's; the sweep is the server's and the job's alone", async () => {
    const bike = await vehicle(2);
    const one = booked(
      await onlineBook([
        { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
      ]),
    );
    const viaService = await assign(service, shop, one.lines[0].reservation_id);
    expect(viaService.error?.code).toBe("42501");
    for (const role of roles) {
      const { error } = await db(role).rpc("release_expired_holds");
      expect(error?.code, role).toBe("42501");
    }
    expect((await sweep()).error).toBeNull();
  });

  it("a signed-in person with no membership is refused by each; a signed-out visitor can't call any of them", async () => {
    const bike = await vehicle(1);
    const hold = booked(
      await staffBook(
        "staff",
        [{ product_id: bike.id, starts_at: at(1), ends_at: at(2) }],
        { hold: true },
      ),
    );
    const id = hold.lines[0].reservation_id;
    const items = [{ product_id: bike.id, starts_at: at(1), ends_at: at(2) }];
    expect(outcome(await confirm(outsider.db, shop, hold.booking_id))).toBe(
      "not_allowed",
    );
    expect(outcome(await assign(outsider.db, shop, id))).toBe("not_allowed");
    const read = await availability(outsider.db, shop, items);
    expect(read.error?.code).toBe("42501");
    expect(read.error?.message).toBe("not_allowed");
    expect((await outsider.db.rpc("release_expired_holds")).error?.code).toBe(
      "42501",
    );

    const anon = anonClient();
    for (const call of [
      confirm(anon, shop, hold.booking_id),
      assign(anon, shop, id),
      availability(anon, shop, items),
      Promise.resolve(anon.rpc("release_expired_holds")),
    ]) {
      const { data, error } = await call;
      expect(data).toBeNull();
      expect(error?.code).toBe("42501");
    }
    expect(await held(bike.id)).toBe("held | hold");
  });
});

describe("shop against shop: another shop's thing is answered exactly like one that does not exist", () => {
  it("confirm_hold, assign_units and cancel: another shop's booking, row and unit", async () => {
    const theirs = await vehicle(2, { tenant: newYork });
    const hold = booked(
      await staffBook(
        "staff",
        [{ product_id: theirs.id, starts_at: at(1), ends_at: at(2) }],
        { tenant: newYork, hold: true },
      ),
    );
    const theirRow = hold.lines[0].reservation_id;
    const made = randomUUID();
    for (const role of ["owner", "staff"] as const) {
      // Naming their own shop: no such booking, as for a made-up id.
      for (const booking of [hold.booking_id, made]) {
        expect((await confirm(db(role), shop, booking)).data).toEqual({
          ok: false,
          reason: "not_found",
        });
        expect((await confirm(service, shop, booking)).data).toEqual({
          ok: false,
          reason: "not_found",
        });
      }
      for (const row of [theirRow, made]) {
        expect((await assign(db(role), shop, row)).data).toEqual({
          ok: false,
          reason: "not_found",
        });
        expect(
          (await assign(db(role), shop, row, [theirs.units[1]])).data,
        ).toEqual({ ok: false, reason: "not_found" });
      }
      // Naming the other shop: not allowed, as for any stranger.
      expect(outcome(await confirm(db(role), newYork, hold.booking_id))).toBe(
        "not_allowed",
      );
      expect(outcome(await assign(db(role), newYork, theirRow))).toBe(
        "not_allowed",
      );
    }
    // Their unit named for our own reservation: no such unit.
    const ours = await vehicle(2);
    const mine = booked(
      await staffBook("staff", [
        {
          product_id: ours.id,
          starts_at: at(1),
          ends_at: at(2),
          unit_ids: [ours.units[0]],
        },
      ]),
    );
    for (const unit of [theirs.units[1], made]) {
      const { error } = await assign(
        db("owner"),
        shop,
        mine.lines[0].reservation_id,
        [unit],
      );
      expect(error?.message).toBe("unit_not_found");
    }
    expect(await held(theirs.id)).toBe("held | hold");
    expect((await blocksOf(ours.id)).map((b) => b.unit_id)).toEqual([
      ours.units[0],
    ]);
  });

  it("availability: another shop's product and place; another shop's id; nothing of theirs is counted", async () => {
    const theirs = await vehicle(3, { tenant: newYork });
    const window = { starts_at: at(1), ends_at: at(2) };
    for (const role of roles) {
      for (const product of [theirs.id, randomUUID()]) {
        const { data, error } = await availability(db(role), shop, [
          { product_id: product, ...window },
        ]);
        expect(data).toBeNull();
        expect(error?.message, role).toBe("product_not_found");
      }
      const ours = await vehicle(1);
      for (const location of [newYork.locationId, randomUUID()]) {
        const { error } = await availability(db(role), shop, [
          { product_id: ours.id, location_id: location, ...window },
        ]);
        expect(error?.message, role).toBe("location_not_found");
      }
      const other = await availability(db(role), newYork, [
        { product_id: theirs.id, ...window },
      ]);
      expect(other.error?.code, role).toBe("42501");
    }
    // The server, naming the wrong shop for a product: the same answer.
    const { error } = await availability(service, shop, [
      { product_id: theirs.id, ...window },
    ]);
    expect(error?.message).toBe("product_not_found");
  });

  it("the helpers a member can call see nothing of another shop", async () => {
    const theirs = await listedVehicle(2, newYork);
    booked(
      (await service.rpc(
        "reserve",
        request(
          newYork,
          "marketplace",
          "instant",
          [{ product_id: theirs.id, starts_at: at(1), ends_at: at(2) }],
          false,
        ),
      )) as unknown as Result,
    );
    const claims = JSON.stringify({
      sub: shop.members.owner.id,
      role: "authenticated",
    });
    const asOwner = sql(`
      begin;
      select set_config('request.jwt.claims', '${claims}', true);
      set local role authenticated;
      select count(*) from platform_private.free_units(
        '${theirs.id}', '${newYork.locationId}',
        tstzrange('${at(1).toISOString()}', '${at(2).toISOString()}'));
      select platform_private.shortage_demand(
        '${theirs.id}', '${newYork.locationId}',
        tstzrange('${at(1).toISOString()}', '${at(2).toISOString()}'));
      select held from platform_private.marketplace_peaks(
        '${theirs.id}', tstzrange('${at(1).toISOString()}', '${at(2).toISOString()}'));
      commit;
    `);
    expect(asOwner.failed).toBe("");
    expect(asOwner.out.split("\n").slice(-4, -1)).toEqual(["0", "0", "0"]);
  });
});

describe("audit: a booking's blocks are in the booking's own events", () => {
  it("no audit row for an allocation or a hold, written, confirmed, moved, cancelled or released; downtime is audited as before", async () => {
    const bike = await vehicle(2);
    const [a, b] = bike.units;
    // Every audit row for a block in this shop from here on. Nothing else
    // writes in this shop while the test runs.
    const { data: latest } = await service
      .from("audit_events")
      .select("id")
      .order("id", { ascending: false })
      .limit(1);
    const last = latest?.[0]?.id ?? 0;
    const blockRows = async () =>
      (
        await service
          .from("audit_events")
          .select("action, after, before")
          .eq("tenant_id", shop.id)
          .eq("entity", "unit_blocks")
          .gt("id", last)
          .order("id")
          .throwOnError()
      ).data!;
    const window = { starts_at: at(1), ends_at: at(2) };
    const hold = booked(
      await staffBook(
        "staff",
        [{ product_id: bike.id, ...window, unit_ids: [a] }],
        { hold: true },
      ),
    );
    expect(outcome(await confirm(db("staff"), shop, hold.booking_id))).toBe(
      "ok",
    );
    expect(
      outcome(
        await assign(db("staff"), shop, hold.lines[0].reservation_id, [b]),
      ),
    ).toBe("ok");
    expect(outcome(await cancel(db("staff"), shop, hold.booking_id))).toBe(
      "ok",
    );
    const second = booked(
      await onlineBook([{ product_id: bike.id, ...window }], { hold: true }),
    );
    await runOut(second.booking_id);
    expect((await sweep()).error).toBeNull();
    expect(await held(bike.id)).toBe("cancelled,expired | ");
    expect(await blockRows()).toEqual([]);

    // The reservation's own rows are still audited, one row a change.
    const rowEvents = await service
      .from("audit_events")
      .select("action")
      .eq("entity", "reservations")
      .eq("entity_id", hold.lines[0].reservation_id)
      .order("id");
    expect(rowEvents.data!.map((e) => e.action)).toEqual([
      "insert",
      "update",
      "update",
    ]);

    // Downtime: written, changed, removed, each with its row.
    const down = await db("mechanic")
      .from("unit_blocks")
      .insert({
        tenant_id: shop.id,
        unit_id: a,
        kind: "downtime",
        period: period(at(5), at(6)),
      })
      .select("id")
      .single();
    expect(down.error).toBeNull();
    await db("mechanic")
      .from("unit_blocks")
      .update({ note: "Brake pads" })
      .eq("id", down.data!.id)
      .throwOnError();
    await db("mechanic")
      .from("unit_blocks")
      .delete()
      .eq("id", down.data!.id)
      .throwOnError();
    expect((await blockRows()).map((e) => e.action)).toEqual([
      "insert",
      "update",
      "delete",
    ]);
  });

  it("the cancel event names the units each row held", async () => {
    const bike = await vehicle(1);
    const helmet = await general("gear", 3);
    const wash = await general("service");
    const window = { starts_at: at(1), ends_at: at(2) };
    const result = booked(
      await staffBook("staff", [
        { product_id: bike.id, ...window },
        { product_id: helmet.id, ...window, quantity: 2 },
        { product_id: wash.id, ...window },
      ]),
    );
    const units = Object.fromEntries(
      result.lines.map((l) => [l.reservation_id, l.unit_ids]),
    );
    expect(outcome(await cancel(db("owner"), shop, result.booking_id))).toBe(
      "ok",
    );
    const events = await eventsOf(result.booking_id);
    expect(events.map((e) => e.action)).toEqual(["reserve", "cancel"]);
    const after = events[1].after as {
      reservation_ids: string[];
      lines: { reservation_id: string; unit_ids: string[] }[];
    };
    expect(after.reservation_ids).toEqual(Object.keys(units).sort());
    expect(after.lines).toEqual(
      Object.keys(units)
        .sort()
        .map((id) => ({ reservation_id: id, unit_ids: units[id] })),
    );
    expect(after.lines.map((l) => l.unit_ids.length).sort()).toEqual([0, 1, 2]);
  });
});

describe("a block that reached a unit past its lock", () => {
  /** A downtime written with the triggers off (no unit lock), not yet saved. */
  const pastTheGuard = (unit: string, marker: string, gate: Gate) =>
    sqlBackground(`
      begin;
      set local session_replication_role = replica;
      insert into platform.unit_blocks (tenant_id, unit_id, kind, period)
      values ('${shop.id}', '${unit}', 'downtime',
        tstzrange('${at(1).toISOString()}', '${at(3).toISOString()}'));
      ${gate.wait(marker)}
      commit;
    `);

  it(
    "the constraint refuses the booking's block; the unit is left out of the next attempt, so a line that named it answers unit_taken",
    async () => {
      const bike = await vehicle(1);
      const marker = `past-guard-named-${tag}`;
      const gate = await closedGate();
      const holder = pastTheGuard(bike.units[0], marker, gate);
      await holding(marker);
      // The booking's block waits for the unsaved downtime to be saved or
      // dropped; the gate is opened once it is seen waiting there.
      const result = await waitsForGate(gate, "reserve", () =>
        staffBook("staff", [
          {
            product_id: bike.id,
            starts_at: at(2),
            ends_at: at(4),
            unit_ids: bike.units,
          },
        ]),
      );
      expect((await holder).failed).toBe("");
      expect(result.data).toEqual({ ok: false, reason: "unit_taken", line: 0 });
      expect(await reservationsOf(bike.id)).toEqual([]);
    },
    GATE_TEST_TIMEOUT,
  );

  it("a line that named none takes another unit, or answers unavailable when there is none", async () => {
    for (const units of [2, 1]) {
      const bike = await vehicle(units);
      const first = sql(
        `select id from platform.units where product_id = '${bike.id}' order by hashtext(id::text), id limit 1;`,
      ).out;
      const marker = `past-guard-${tag}-${units}`;
      const gate = await closedGate();
      const holder = pastTheGuard(first, marker, gate);
      await holding(marker);
      const result = await waitsForGate(gate, "reserve", () =>
        onlineBook([{ product_id: bike.id, starts_at: at(2), ends_at: at(4) }]),
      );
      expect((await holder).failed).toBe("");
      if (units === 2) {
        expect(booked(result).lines[0].unit_ids).toEqual(
          bike.units.filter((u) => u !== first),
        );
      } else {
        expect(result.data).toEqual({
          ok: false,
          reason: "unavailable",
          line: 0,
        });
        expect(await reservationsOf(bike.id)).toEqual([]);
      }
    }
  }, 60_000);
});

describe("deleting a unit never waits for its lock", () => {
  it(
    "while something holds the unit's lock the delete is refused at once with unit_busy, and goes through afterwards",
    async () => {
      const bike = await vehicle(1);
      const marker = `hold-unit-delete-${tag}`;
      const gate = await closedGate();
      const holder = sqlBackground(`
      begin;
      select platform_private.lock_units(array['${bike.units[0]}']::uuid[]);
      ${gate.wait(marker)}
      commit;
    `);
      await holding(marker);
      const refused = await db("owner")
        .from("units")
        .delete()
        .eq("id", bike.units[0])
        .select("id");
      expect(refused.error).toMatchObject({
        code: "55P03",
        message: "unit_busy",
      });
      // At once: the holder still has the lock, and keeps it until the gate.
      await stillHolding(marker);
      await gate.open();
      expect((await holder).failed).toBe("");
      const deleted = await db("owner")
        .from("units")
        .delete()
        .eq("id", bike.units[0])
        .select("id");
      expect(deleted.error).toBeNull();
      expect(deleted.data).toHaveLength(1);
    },
    GATE_TEST_TIMEOUT,
  );

  it(
    "several units in one statement against a booking in flight on two of them: refused at once or after the booking, never a deadlock",
    async () => {
      const bike = await vehicle(4);
      const before = deadlocks();
      const [first, second] = [...bike.units].sort();
      const units = async () =>
        (
          await service
            .from("units")
            .select("*", { count: "exact", head: true })
            .eq("product_id", bike.id)
        ).count;

      // The booking has its unit locks and no row yet (between lock_units and
      // the unit rows): the delete meets a held lock and is refused at once.
      const lockMarker = `booking-has-locks-${tag}`;
      const lockGate = await closedGate();
      const locked = sqlBackground(`
      begin;
      select platform_private.lock_products_stock(
        array['${bike.id}']::uuid[], array['${shop.locationId}']::uuid[]);
      select platform_private.lock_units(array['${first}', '${second}']::uuid[]);
      ${lockGate.wait(lockMarker)}
      commit;
    `);
      await holding(lockMarker);
      const refused = await db("owner")
        .from("units")
        .delete()
        .eq("product_id", bike.id)
        .select("id");
      expect(refused.error?.message).toBe("unit_busy");
      // At once: the holder still has its locks, and keeps them until the gate.
      await stillHolding(lockMarker);
      await lockGate.open();
      expect((await locked).failed).toBe("");
      expect(await units()).toBe(4);

      // A real booking for those two units, written and not yet saved: it
      // holds their locks and their rows. The delete waits for a row holding
      // nothing the booking still needs, and once the booking is saved it is
      // refused by the booking's blocks (the app's "retire instead").
      const bookMarker = `booking-written-${tag}`;
      const bookGate = await closedGate();
      const booking = sqlBackground(`
      begin;
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      select platform.reserve('${shop.id}', '${JSON.stringify(
        request(
          shop,
          "booking_page",
          "instant",
          [
            {
              product_id: bike.id,
              starts_at: at(1),
              ends_at: at(2),
              quantity: 4,
            },
          ],
          false,
        ).p_request,
      )}'::jsonb) ->> 'ok';
      ${bookGate.wait(bookMarker)}
      commit;
    `);
      await holding(bookMarker);
      // Either answer is allowed, so the booking is saved once the delete has
      // been refused or is seen waiting for it.
      const deleting = await answeredOrWaiting("units", () =>
        db("owner")
          .from("units")
          .delete()
          .eq("product_id", bike.id)
          .select("id"),
      );
      await bookGate.open();
      const late = await deleting.running;
      const saved = await booking;
      expect(saved.failed).toBe("");
      expect(saved.out).toContain("true");
      expect(["23503", "55P03"]).toContain(late.error?.code);
      noDeadlock([late]);
      expect(await deadlocksReported()).toBe(before);
      expect(await units()).toBe(4);
      expect(await held(bike.id)).toBe(
        "reserved | allocation,allocation,allocation,allocation",
      );
    },
    GATE_TEST_TIMEOUT,
  );

  it(
    "a delete of both units, not yet saved, against a booking for both: the booking waits for a unit's lock with no row locked, then finds them gone",
    async () => {
      const bike = await vehicle(2);
      const before = deadlocks();
      const marker = `delete-both-${tag}`;
      const gate = await closedGate();
      const deleter = sqlBackground(`
      begin;
      delete from platform.units where product_id = '${bike.id}';
      ${gate.wait(marker)}
      commit;
    `);
      await holding(marker);
      const call = onlineBook([
        { product_id: bike.id, starts_at: at(1), ends_at: at(2), quantity: 2 },
      ]);
      const seen = await until(`
      select 'waiting for a unit lock, nothing locked or written: ' || (a.backend_xid is null)
      from pg_locks w
      join pg_stat_activity a on a.pid = w.pid
      where w.locktype = 'advisory' and w.classid = x'1a01'::int and not w.granted
        and a.query like '%reserve%'
      limit 1;
    `);
      expect(seen).toBe(
        "waiting for a unit lock, nothing locked or written: true",
      );
      await gate.open();
      expect((await deleter).failed).toBe("");
      const result = await call;
      noDeadlock([result]);
      expect(result.data).toEqual({
        ok: false,
        reason: "unavailable",
        line: 0,
      });
      expect(await deadlocksReported()).toBe(before);
    },
    GATE_TEST_TIMEOUT,
  );

  it("the stock functions that delete units hold these locks already and still work", async () => {
    const helmet = await general("gear", 5);
    const { error } = await db("owner").rpc("set_stock_quantity", {
      p_product_id: helmet.id,
      p_location_id: shop.locationId,
      p_quantity: 2,
    });
    expect(error).toBeNull();
    const { count } = await service
      .from("units")
      .select("*", { count: "exact", head: true })
      .eq("product_id", helmet.id);
    expect(count).toBe(2);
  });
});

describe("races between reserve, confirm, cancel, assign and the sweep: no deadlock, nothing half-done", () => {
  it(`two holds for the last unit, staff and online, with the sweep running: exactly one wins, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      const bike = await vehicle(1, { tenant });
      for (let round = 0; round < ROUNDS; round++) {
        const line = {
          product_id: bike.id,
          starts_at: at(round * 2),
          ends_at: at(round * 2 + 1),
        };
        const results = await Promise.all([
          round % 2
            ? staffBook("staff", [line], { tenant, hold: true })
            : onlineBook([line], { tenant, hold: true }),
          onlineBook([line], { tenant, hold: round % 3 === 0 }),
          sweep(),
        ]);
        raceRounds++;
        noDeadlock(results);
        expect(
          [outcome(results[0]), outcome(results[1])].sort(),
          `${where}, round ${round}`,
        ).toEqual(["ok", "unavailable"]);
      }
      const rows = await reservationsOf(bike.id);
      expect(rows, where).toHaveLength(ROUNDS);
      expect(await blocksOf(bike.id), where).toHaveLength(ROUNDS);
      expect(rows.every((r) => ["held", "reserved"].includes(r.state))).toBe(
        true,
      );
    }
  }, 240_000);

  it(`a hold confirmed while it is being cancelled: it ends cancelled with no block, or confirmed then cancelled, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      for (let round = 0; round < ROUNDS; round++) {
        const bike = await vehicle(1, { tenant });
        const online = round % 2 === 0;
        const line = { product_id: bike.id, starts_at: at(1), ends_at: at(2) };
        const hold = booked(
          online
            ? await onlineBook([line], { tenant, hold: true })
            : await staffBook("staff", [line], { tenant, hold: true }),
        );
        const client = online ? service : db("staff", tenant);
        const [confirmed, cancelled, swept] = await Promise.all([
          confirm(client, tenant, hold.booking_id),
          cancel(db("owner", tenant), tenant, hold.booking_id),
          sweep(),
        ]);
        raceRounds++;
        noDeadlock([confirmed, cancelled, swept]);
        expect(outcome(cancelled), `${where}, round ${round}`).toBe("ok");
        expect(["ok", "not_held"], `${where}, round ${round}`).toContain(
          outcome(confirmed),
        );
        expect(await held(bike.id), `${where}, round ${round}`).toBe(
          "cancelled | ",
        );
      }
    }
  }, 240_000);

  it(`a hold that has run out, confirmed while the sweep and a new booking for its unit arrive: never confirmed, the unit ends with the new booking alone, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      for (let round = 0; round < ROUNDS; round++) {
        const bike = await vehicle(1, { tenant });
        const line = { product_id: bike.id, starts_at: at(1), ends_at: at(2) };
        const hold = booked(await onlineBook([line], { tenant, hold: true }));
        await runOut(hold.booking_id);
        const [confirmed, swept, next] = await Promise.all([
          confirm(service, tenant, hold.booking_id),
          sweep(),
          round % 2
            ? staffBook("staff", [line], { tenant })
            : onlineBook([line], { tenant, hold: true }),
        ]);
        raceRounds++;
        noDeadlock([confirmed, swept, next]);
        expect(outcome(confirmed), `${where}, round ${round}`).toBe(
          "hold_expired",
        );
        expect(outcome(next), `${where}, round ${round}`).toBe("ok");
        expect(await held(bike.id), `${where}, round ${round}`).toBe(
          round % 2 ? "expired,reserved | allocation" : "expired,held | hold",
        );
        // Released exactly once, by the sweep or by the booking.
        expect((await eventsOf(hold.booking_id)).map((e) => e.action)).toEqual([
          "reserve",
          "expire",
        ]);
      }
    }
  }, 240_000);

  it(`a live hold confirmed against the sweep and a rival booking: confirmed, and the rival refused, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      for (let round = 0; round < ROUNDS; round++) {
        const bike = await vehicle(1, { tenant });
        const line = { product_id: bike.id, starts_at: at(1), ends_at: at(2) };
        const hold = booked(
          await staffBook("staff", [line], { tenant, hold: true }),
        );
        const [confirmed, swept, rival] = await Promise.all([
          confirm(db("manager", tenant), tenant, hold.booking_id),
          sweep(),
          onlineBook([line], { tenant }),
        ]);
        raceRounds++;
        noDeadlock([confirmed, swept, rival]);
        expect(outcome(confirmed), `${where}, round ${round}`).toBe("ok");
        expect(outcome(rival), `${where}, round ${round}`).toBe("unavailable");
        expect(await held(bike.id)).toBe("reserved | allocation");
      }
    }
  }, 240_000);

  it(`a reservation moved to a unit while a booking names that unit: one of them gets it, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      for (let round = 0; round < ROUNDS; round++) {
        const bike = await vehicle(2, { tenant });
        const [a, b] = bike.units;
        const window = { starts_at: at(1), ends_at: at(2) };
        const one = booked(
          await staffBook(
            "staff",
            [{ product_id: bike.id, ...window, unit_ids: [a] }],
            { tenant },
          ),
        );
        const [moved, rival] = await Promise.all([
          assign(db("staff", tenant), tenant, one.lines[0].reservation_id, [b]),
          round % 2
            ? staffBook(
                "owner",
                [{ product_id: bike.id, ...window, unit_ids: [b] }],
                { tenant },
              )
            : onlineBook([{ product_id: bike.id, ...window }], { tenant }),
        ]);
        raceRounds++;
        noDeadlock([moved, rival]);
        const pair = `${outcome(moved)} / ${outcome(rival)}`;
        // Unnamed, the rival can also take the unit the move gave back.
        expect(
          round % 2
            ? ["ok / unit_taken", "unit_taken / ok"]
            : ["ok / ok", "unit_taken / ok"],
          `${where}, round ${round}`,
        ).toContain(pair);
        const blocks = await blocksOf(bike.id);
        // Never two blocks on one unit, and every booking that stands has one.
        expect(new Set(blocks.map((x) => x.unit_id)).size).toBe(blocks.length);
        expect(blocks).toHaveLength(
          (await reservationsOf(bike.id)).filter((r) => r.state === "reserved")
            .length,
        );
      }
    }
  }, 240_000);

  it(`a shortage filled while a mechanic blocks the freed unit, a rival books and the sweep runs: the unit ends with one block, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      for (let round = 0; round < ROUNDS; round++) {
        await setShop(tenant, { allow_overbooking: true });
        const bike = await vehicle(1, { tenant });
        const window = { starts_at: at(1), ends_at: at(2) };
        const short = booked(
          await staffBook(
            "staff",
            [{ product_id: bike.id, ...window, quantity: 2 }],
            { tenant },
          ),
        );
        await setShop(tenant, { allow_overbooking: false });
        const [extra] = await addUnits(bike.id, 1, tenant);
        const [filled, down, rival, swept] = await Promise.all([
          assign(db("staff", tenant), tenant, short.lines[0].reservation_id),
          db("mechanic", tenant)
            .from("unit_blocks")
            .insert({
              tenant_id: tenant.id,
              unit_id: extra,
              kind: "downtime",
              period: period(window.starts_at, window.ends_at),
            }),
          onlineBook([{ product_id: bike.id, ...window }], { tenant }),
          sweep(),
        ]);
        raceRounds++;
        noDeadlock([filled, down, rival, swept]);
        // The unit is owed to the short reservation: the rival never gets it.
        expect(outcome(rival), `${where}, round ${round}`).toBe("unavailable");
        const pair = `${outcome(filled)} / ${down.error?.code ?? "ok"}`;
        expect(
          ["ok / 23P01", "unavailable / ok"],
          `${where}, round ${round}`,
        ).toContain(pair);
        const onExtra = (await blocksOf(bike.id)).filter(
          (x) => x.unit_id === extra,
        );
        expect(onExtra.map((x) => x.kind)).toEqual([
          pair.startsWith("ok") ? "allocation" : "downtime",
        ]);
        expect((await reservationsOf(bike.id))[0].shortage).toBe(
          pair.startsWith("ok") ? 0 : 1,
        );
      }
    }
  }, 300_000);

  it(`a booking, a cancel and a fill for the same product at once: stock is never counted twice, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      for (let round = 0; round < ROUNDS; round++) {
        await setShop(tenant, { allow_overbooking: true });
        const helmet = await general("gear", 2, tenant);
        const window = { starts_at: at(1), ends_at: at(2) };
        const line = { product_id: helmet.id, ...window };
        const first = booked(
          await staffBook("staff", [{ ...line, quantity: 2 }], { tenant }),
        );
        const short = booked(await staffBook("staff", [line], { tenant }));
        expect(short.lines[0].shortage).toBe(1);
        await setShop(tenant, { allow_overbooking: false });
        // The first is cancelled while the short one is filled and a new
        // booking for one helmet arrives.
        const [cancelled, filled, rival, swept] = await Promise.all([
          cancel(db("owner", tenant), tenant, first.booking_id),
          assign(db("staff", tenant), tenant, short.lines[0].reservation_id),
          onlineBook([line], { tenant, hold: round % 2 === 0 }),
          sweep(),
        ]);
        raceRounds++;
        noDeadlock([cancelled, filled, rival, swept]);
        expect(outcome(cancelled), `${where}, round ${round}`).toBe("ok");
        // Two helmets, at most one for each of the two that want one.
        const rows = await reservationsOf(helmet.id);
        const blocks = await blocksOf(helmet.id);
        expect(new Set(blocks.map((x) => x.unit_id)).size).toBe(blocks.length);
        expect(blocks.length).toBeLessThanOrEqual(2);
        const standing = rows.filter((r) =>
          ["held", "reserved"].includes(r.state),
        );
        for (const row of standing) {
          expect(
            blocks.filter((x) => x.reservation_id === row.id).length,
            `${where}, round ${round}`,
          ).toBe(row.quantity - row.shortage);
        }
        // A rival that got in did not take the unit the shortage is owed.
        if (outcome(rival) === "ok" && outcome(filled) !== "ok") {
          expect(
            await counts(helmet.id, window.starts_at, window.ends_at, tenant),
          ).toBe("2 / 1 / 1 / 0");
        }
      }
    }
  }, 300_000);
});

type Moved =
  | {
      ok: true;
      unit_id: string;
      bookings: number;
      reservation_ids: string[];
      updated_at: string;
    }
  | { ok: false; reason: string; bookings?: number };

const move = (
  client: Db,
  tenant: TestTenant,
  unit: string,
  to: { product: string; location?: string },
  expect_: { bookings?: number; updatedAt?: string } = {},
) =>
  Promise.resolve(
    client.rpc("move_unit", {
      p_tenant_id: tenant.id,
      p_unit_id: unit,
      p_product_id: to.product,
      p_location_id: to.location ?? tenant.locationId,
      ...(expect_.bookings === undefined
        ? {}
        : { p_expected_bookings: expect_.bookings }),
      ...(expect_.updatedAt === undefined
        ? {}
        : { p_expected_updated_at: expect_.updatedAt }),
    }),
  ) as Promise<Result<Moved>>;

/** A vehicle on an approved list entry, listed on Moto Mangos. */
async function listedVehicle(units: number, tenant: TestTenant = shop) {
  const bike = await vehicle(units, { tenant });
  await service
    .from("products")
    .update({ catalog_id: catalogId })
    .eq("id", bike.id)
    .throwOnError();
  const listed = await forceListing(tenant.id, bike.id, {
    marketplace_listed: true,
    instant_units: 1,
    request_units: 0,
  });
  expect(listed.error).toBeNull();
  return bike;
}

/** "stock/free/available, MM held" for a product over a window. */
async function figures(
  productId: string,
  from: Date,
  to: Date,
  tenant: TestTenant = shop,
  locationId?: string,
) {
  const { data, error } = await availability(service, tenant, [
    {
      product_id: productId,
      location_id: locationId,
      starts_at: from,
      ends_at: to,
    },
  ]);
  expect(error, error?.message).toBeNull();
  const a = data![0];
  return `${a.stock}/${a.free}/${a.available}${a.marketplace ? `, MM held ${a.marketplace.mm_held}` : ""}`;
}

/** Every reservation that holds a unit names that unit's product and place. */
async function agree(productIds: string[]) {
  const out = sql(`
    select count(*)
    from platform.unit_blocks b
    join platform.reservations r on r.id = b.reservation_id
    join platform.units u on u.id = b.unit_id
    where r.state in ('held', 'reserved', 'out')
      and (r.product_id in (${productIds.map((p) => `'${p}'`).join(",")})
        or u.product_id in (${productIds.map((p) => `'${p}'`).join(",")}))
      and (r.product_id <> u.product_id or r.location_id <> u.location_id);
  `).out;
  expect(out, "reservations that name another product than their unit").toBe(
    "0",
  );
}

/** A background session acting as a signed-in member, or as the server. */
const actingAs = (userId: string | null) =>
  userId
    ? `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: "authenticated" })}', true); set local role authenticated;`
    : `select set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role;`;

/** A second place in a shop. */
async function branchOf(tenant: TestTenant) {
  const { data, error } = await service
    .from("locations")
    .insert({
      tenant_id: tenant.id,
      name: name("Branch"),
      timezone: "Asia/Bangkok",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

describe("moving a unit that has bookings: the bookings move with it", () => {
  it("to another product: both products' counts and Moto Mangos figures before and after; the rows, blocks and one event per booking", async () => {
    const a = await listedVehicle(3);
    const b = await listedVehicle(1);
    const window = { starts_at: at(1), ends_at: at(3) };
    const mm = booked(
      (await service.rpc(
        "reserve",
        request(
          shop,
          "marketplace",
          "instant",
          [{ product_id: a.id, ...window }],
          false,
        ),
      )) as unknown as Result,
    );
    const hold = booked(
      await staffBook("staff", [{ product_id: a.id, ...window }], {
        hold: true,
      }),
    );
    const [mmUnit, heldUnit] = [mm, hold].map((x) => x.lines[0].unit_ids[0]);
    const blocksBefore = await blocksOf(a.id);

    expect(await figures(a.id, at(1), at(3))).toBe("3/1/1, MM held 1");
    expect(await figures(b.id, at(1), at(3))).toBe("1/1/1, MM held 0");

    const first = await move(db("owner"), shop, mmUnit, { product: b.id });
    expect(first.error).toBeNull();
    expect(first.data).toEqual({
      ok: true,
      unit_id: mmUnit,
      bookings: 1,
      reservation_ids: [mm.lines[0].reservation_id],
      updated_at: expect.any(String),
    });
    // One unit and its Moto Mangos booking have gone from A to B.
    expect(await figures(a.id, at(1), at(3))).toBe("2/1/1, MM held 0");
    expect(await figures(b.id, at(1), at(3))).toBe("2/1/1, MM held 1");

    const second = await move(db("manager"), shop, heldUnit, { product: b.id });
    expect(second.data).toMatchObject({ ok: true, bookings: 1 });
    expect(await figures(a.id, at(1), at(3))).toBe("1/1/1, MM held 0");
    expect(await figures(b.id, at(1), at(3))).toBe("3/1/1, MM held 1");
    // A window that touches neither booking: all of B is free.
    expect(await figures(b.id, at(5), at(6))).toBe("3/3/3, MM held 0");

    // The same rows, now B's, each in the state it was in.
    const rows = await reservationsOf(b.id);
    expect(rows.map((r) => `${r.id} ${r.state} ${r.quantity}`).sort()).toEqual(
      [
        `${mm.lines[0].reservation_id} reserved 1`,
        `${hold.lines[0].reservation_id} held 1`,
      ].sort(),
    );
    expect(await reservationsOf(a.id)).toEqual([]);
    // The same blocks, on the same units.
    const blocksAfter = (await blocksOf(b.id)).filter((x) =>
      [mmUnit, heldUnit].includes(x.unit_id),
    );
    expect(
      blocksAfter.map((x) => `${x.id} ${x.unit_id} ${x.kind}`).sort(),
    ).toEqual(blocksBefore.map((x) => `${x.id} ${x.unit_id} ${x.kind}`).sort());
    await agree([a.id, b.id]);

    for (const [booking, unit, actor] of [
      [mm, mmUnit, shop.members.owner.id],
      [hold, heldUnit, shop.members.manager.id],
    ] as const) {
      const events = await eventsOf(booking.booking_id);
      expect(events.map((e) => e.action)).toEqual(["reserve", "move"]);
      expect(events[1]).toEqual({
        action: "move",
        actor,
        after: {
          unit_id: unit,
          reservation_ids: [booking.lines[0].reservation_id],
          from: { product_id: a.id, location_id: shop.locationId },
          to: { product_id: b.id, location_id: shop.locationId },
        },
      });
    }

    // New bookings see what is really there.
    expect(outcome(await onlineBook([{ product_id: b.id, ...window }]))).toBe(
      "ok",
    );
    expect(outcome(await onlineBook([{ product_id: b.id, ...window }]))).toBe(
      "unavailable",
    );
    // The hold is confirmed and the booking cancelled as B's.
    expect(outcome(await confirm(db("staff"), shop, hold.booking_id))).toBe(
      "ok",
    );
    expect(outcome(await cancel(service, shop, mm.booking_id))).toBe("ok");
    expect(await figures(b.id, at(1), at(3))).toBe("3/1/1, MM held 0");
  });

  it("to another place: the booking's place follows, and each place counts what is there", async () => {
    const bike = await vehicle(2);
    const branch = await service
      .from("locations")
      .insert({
        tenant_id: shop.id,
        name: name("Branch"),
        timezone: "Asia/Bangkok",
      })
      .select("id")
      .single();
    expect(branch.error).toBeNull();
    const there = branch.data!.id;
    const one = booked(
      await onlineBook([
        { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
      ]),
    );
    const unit = one.lines[0].unit_ids[0];
    expect(await figures(bike.id, at(1), at(2))).toBe("2/1/1");
    expect(await figures(bike.id, at(1), at(2), shop, there)).toBe("0/0/0");

    const moved = await move(db("owner"), shop, unit, {
      product: bike.id,
      location: there,
    });
    expect(moved.data).toMatchObject({ ok: true, bookings: 1 });
    expect(await figures(bike.id, at(1), at(2))).toBe("1/1/1");
    expect(await figures(bike.id, at(1), at(2), shop, there)).toBe("1/0/0");
    const [row] = await reservationsOf(bike.id);
    expect(row).toMatchObject({ location_id: there, state: "reserved" });
    const [, event] = await eventsOf(one.booking_id);
    expect(event.after).toMatchObject({
      from: { product_id: bike.id, location_id: shop.locationId },
      to: { product_id: bike.id, location_id: there },
    });
    await agree([bike.id]);
  });

  it("a row for several units is split: the moved unit's part is a row of its own for one unit, in the same booking", async () => {
    await setShop(saigon, { allow_overbooking: true });
    const a = await vehicle(3, { tenant: saigon });
    const b = await vehicle(0, { tenant: saigon });
    // Four wanted, three there: a row for 4 with 3 units and 1 short.
    const big = booked(
      await staffBook(
        "staff",
        [
          {
            product_id: a.id,
            starts_at: at(1),
            ends_at: at(2),
            quantity: 4,
          },
        ],
        { tenant: saigon },
      ),
    );
    await setShop(saigon, { allow_overbooking: false });
    const original = big.lines[0].reservation_id;
    const [first, second, third] = big.lines[0].unit_ids;

    const moved = await move(db("owner", saigon), saigon, first, {
      product: b.id,
    });
    expect(moved.data).toMatchObject({ ok: true, bookings: 1 });
    const part = (moved.data as Extract<Moved, { ok: true }>)
      .reservation_ids[0];
    expect(part).not.toBe(original);

    const [left] = await reservationsOf(a.id);
    expect(left).toMatchObject({
      id: original,
      quantity: 3,
      shortage: 1,
      state: "reserved",
    });
    const [split] = await reservationsOf(b.id);
    expect(split).toMatchObject({
      id: part,
      booking_id: big.booking_id,
      quantity: 1,
      shortage: 0,
      state: "reserved",
      channel: left.channel,
      mode: left.mode,
      starts_at: left.starts_at,
      ends_at: left.ends_at,
      block_period: left.block_period,
      created_by: saigon.members.staff.id,
    });
    expect(
      (await blocksOf(a.id))
        .map((x) => `${x.unit_id} ${x.reservation_id}`)
        .sort(),
    ).toEqual([`${second} ${original}`, `${third} ${original}`].sort());
    expect(
      (await blocksOf(b.id)).map((x) => `${x.unit_id} ${x.reservation_id}`),
    ).toEqual([`${first} ${part}`]);
    // What is owed stays owed, on the product it was booked on.
    expect(await counts(a.id, at(1), at(2), saigon)).toBe("2 / 0 / 1 / 0");
    expect(await counts(b.id, at(1), at(2), saigon)).toBe("1 / 0 / 0 / 0");
    expect((await eventsOf(big.booking_id)).map((e) => e.action)).toEqual([
      "reserve",
      "move",
    ]);

    // A second unit: split again. The last one: the row itself would move,
    // but it is still a row for more than one, so it is split too.
    for (const unit of [second, third]) {
      expect(
        outcome(
          await move(db("owner", saigon), saigon, unit, { product: b.id }),
        ),
      ).toBe("ok");
    }
    expect((await reservationsOf(a.id))[0]).toMatchObject({
      id: original,
      quantity: 1,
      shortage: 1,
    });
    expect(
      (await reservationsOf(b.id)).map((r) => `${r.quantity} ${r.shortage}`),
    ).toEqual(["1 0", "1 0", "1 0"]);
    expect(await blocksOf(a.id)).toEqual([]);
    await agree([a.id, b.id]);
    // Cancelling the booking cancels every part of it.
    expect(
      outcome(await cancel(db("staff", saigon), saigon, big.booking_id)),
    ).toBe("ok");
    expect(await held(b.id)).toBe("cancelled,cancelled,cancelled | ");
  });

  it("only bookings that hold the unit from now on move: a finished, cancelled or returned one stays where it was", async () => {
    const a = await vehicle(1);
    const b = await vehicle(0);
    const [unit] = a.units;
    const past = booked(
      await staffBook("staff", [
        {
          product_id: a.id,
          starts_at: hoursFromNow(-5),
          ends_at: hoursFromNow(-3),
        },
      ]),
    );
    const returned = booked(
      await staffBook("staff", [
        {
          product_id: a.id,
          starts_at: hoursFromNow(-2),
          ends_at: hoursFromNow(-1),
        },
      ]),
    );
    await service
      .from("reservations")
      .update({ state: "returned" })
      .eq("booking_id", returned.booking_id)
      .throwOnError();
    const gone = booked(
      await staffBook("staff", [
        { product_id: a.id, starts_at: at(1), ends_at: at(2) },
      ]),
    );
    expect(outcome(await cancel(db("staff"), shop, gone.booking_id))).toBe(
      "ok",
    );
    const out = booked(
      await staffBook("staff", [
        {
          product_id: a.id,
          starts_at: hoursFromNow(-0.5),
          ends_at: hoursFromNow(4),
        },
      ]),
    );
    await service
      .from("reservations")
      .update({ state: "out" })
      .eq("booking_id", out.booking_id)
      .throwOnError();
    const next = booked(
      await onlineBook([
        { product_id: a.id, starts_at: at(3), ends_at: at(4) },
      ]),
    );

    const moved = await move(db("owner"), shop, unit, { product: b.id });
    expect(moved.data).toMatchObject({ ok: true, bookings: 2 });
    expect(
      [...(moved.data as Extract<Moved, { ok: true }>).reservation_ids].sort(),
    ).toEqual(
      [out.lines[0].reservation_id, next.lines[0].reservation_id].sort(),
    );
    expect((await reservationsOf(a.id)).map((r) => r.state).sort()).toEqual([
      "cancelled",
      "reserved",
      "returned",
    ]);
    expect((await reservationsOf(b.id)).map((r) => r.state).sort()).toEqual([
      "out",
      "reserved",
    ]);
    expect((await eventsOf(past.booking_id)).map((e) => e.action)).toEqual([
      "reserve",
    ]);
  });

  it("a direct change of a booked unit's place is refused, and of any unit's product (move_unit() only), for the owner and for the service role; an unbooked unit moves through move_unit()", async () => {
    const a = await vehicle(2);
    const b = await vehicle(0);
    const branch = await service
      .from("locations")
      .insert({
        tenant_id: shop.id,
        name: name("Branch"),
        timezone: "Asia/Bangkok",
      })
      .select("id")
      .single();
    const [bookedUnit, freeUnit] = a.units;
    const hold = booked(
      await staffBook(
        "staff",
        [
          {
            product_id: a.id,
            starts_at: at(1),
            ends_at: at(2),
            unit_ids: [bookedUnit],
          },
        ],
        { hold: true },
      ),
    );
    for (const client of [db("owner"), db("manager"), service]) {
      for (const change of [
        { product_id: b.id },
        { location_id: branch.data!.id },
        { product_id: b.id, location_id: branch.data!.id },
      ]) {
        const { error } = await client
          .from("units")
          .update(change)
          .eq("id", bookedUnit)
          .select("id");
        // A product change is refused whatever the bookings (since Phase 3
        // stage 1); a place change while a booking names the old place.
        expect(error?.message, JSON.stringify(change)).toBe(
          "product_id" in change ? "use_move_unit" : "unit_has_bookings",
        );
      }
    }
    // Anything else about it can still be changed directly.
    const other = await db("owner")
      .from("units")
      .update({ colour: "Red", product_id: a.id })
      .eq("id", bookedUnit)
      .select("colour");
    expect(other.error).toBeNull();
    expect(other.data).toEqual([{ colour: "Red" }]);
    // A unit with no booking: its product still changes through
    // move_unit() only; its place alone, directly, as it always did.
    const direct = await db("owner")
      .from("units")
      .update({ product_id: b.id, location_id: branch.data!.id })
      .eq("id", freeUnit)
      .select("product_id");
    expect(direct.error?.message).toBe("use_move_unit");
    expect(
      outcome(
        await move(db("owner"), shop, freeUnit, {
          product: b.id,
          location: branch.data!.id,
        }),
      ),
    ).toBe("ok");
    const free = await db("owner")
      .from("units")
      .update({ location_id: shop.locationId })
      .eq("id", freeUnit)
      .select("product_id, location_id");
    expect(free.error).toBeNull();
    expect(free.data).toEqual([
      { product_id: b.id, location_id: shop.locationId },
    ]);
    // Once its booking is over, so does the first.
    expect(outcome(await cancel(db("staff"), shop, hold.booking_id))).toBe(
      "ok",
    );
    const after = await db("owner")
      .from("units")
      .update({ location_id: branch.data!.id })
      .eq("id", bookedUnit)
      .select("location_id");
    expect(after.error).toBeNull();
    expect(after.data).toEqual([{ location_id: branch.data!.id }]);
    expect(
      outcome(await move(db("owner"), shop, bookedUnit, { product: b.id })),
    ).toBe("ok");
  });

  it("assign_units() by name after a move: the unit it holds is its own again, and it can be swapped for another of the new product", async () => {
    const a = await vehicle(1);
    const b = await vehicle(1);
    const one = booked(
      await staffBook("staff", [
        { product_id: a.id, starts_at: at(1), ends_at: at(2) },
      ]),
    );
    const id = one.lines[0].reservation_id;
    const [unit] = a.units;
    expect(
      outcome(await move(db("owner"), shop, unit, { product: b.id })),
    ).toBe("ok");
    // Naming the unit it already holds raised unit_not_found before.
    const same = await assign(db("staff"), shop, id, [unit]);
    expect(same.error).toBeNull();
    expect(same.data).toMatchObject({
      ok: true,
      unit_ids: [unit],
      added: [],
      removed: [],
    });
    const swapped = await assign(db("staff"), shop, id, [b.units[0]]);
    expect(swapped.data).toMatchObject({
      ok: true,
      added: [b.units[0]],
      removed: [unit],
    });
    // A unit of the product it left is no longer its kind.
    const back = await vehicle(1);
    expect(
      (await assign(db("staff"), shop, id, [back.units[0]])).error?.message,
    ).toBe("unit_not_found");
    await agree([a.id, b.id]);
  });

  it("the warning's count and the form's age are checked: other bookings than the ones warned about, or a changed unit, move nothing", async () => {
    const a = await vehicle(1);
    const b = await vehicle(0);
    const [unit] = a.units;
    booked(
      await onlineBook([
        { product_id: a.id, starts_at: at(1), ends_at: at(2) },
      ]),
    );
    const loaded = await service
      .from("units")
      .select("updated_at")
      .eq("id", unit)
      .single();
    // Warned about none; there is one.
    expect(
      (await move(db("owner"), shop, unit, { product: b.id }, { bookings: 0 }))
        .data,
    ).toEqual({ ok: false, reason: "bookings_changed", bookings: 1 });
    // A second booking arrives after the warning about one.
    booked(
      await onlineBook([
        { product_id: a.id, starts_at: at(3), ends_at: at(4) },
      ]),
    );
    expect(
      (await move(db("owner"), shop, unit, { product: b.id }, { bookings: 1 }))
        .data,
    ).toEqual({ ok: false, reason: "bookings_changed", bookings: 2 });
    // Someone changed the unit since the form was loaded.
    await service
      .from("units")
      .update({ colour: "Blue" })
      .eq("id", unit)
      .throwOnError();
    expect(
      (
        await move(
          db("owner"),
          shop,
          unit,
          { product: b.id },
          { bookings: 2, updatedAt: loaded.data!.updated_at },
        )
      ).data,
    ).toEqual({ ok: false, reason: "stale" });
    expect(await held(a.id)).toBe("reserved,reserved | allocation,allocation");
    expect(await reservationsOf(b.id)).toEqual([]);

    const now = await service
      .from("units")
      .select("updated_at")
      .eq("id", unit)
      .single();
    const done = await move(
      db("owner"),
      shop,
      unit,
      { product: b.id },
      { bookings: 2, updatedAt: now.data!.updated_at },
    );
    expect(done.data).toMatchObject({ ok: true, bookings: 2 });
    const after = await service
      .from("units")
      .select("updated_at, product_id")
      .eq("id", unit)
      .single();
    // The answer carries the unit's new age, for the save that follows.
    expect(new Date(after.data!.updated_at).getTime()).toBe(
      new Date(
        (done.data as Extract<Moved, { ok: true }>).updated_at,
      ).getTime(),
    );
    // Where it already is: nothing to do.
    expect(
      (await move(db("owner"), shop, unit, { product: b.id })).data,
    ).toMatchObject({ ok: true, bookings: 0, reservation_ids: [] });
  });

  it("who may move: owners and managers; staff, mechanics, drivers and strangers are refused; another shop's thing is like one that does not exist", async () => {
    const a = await vehicle(1);
    const b = await vehicle(0);
    const [unit] = a.units;
    booked(
      await onlineBook([
        { product_id: a.id, starts_at: at(1), ends_at: at(2) },
      ]),
    );
    for (const role of ["staff", "mechanic", "driver"] as const) {
      expect(
        (await move(db(role), shop, unit, { product: b.id })).data,
        role,
      ).toEqual({ ok: false, reason: "not_allowed" });
    }
    expect(
      (await move(outsider.db, shop, unit, { product: b.id })).data,
    ).toEqual({ ok: false, reason: "not_allowed" });
    const visitor = await move(anonClient(), shop, unit, { product: b.id });
    expect(visitor.data).toBeNull();
    expect(visitor.error?.code).toBe("42501");
    expect(await held(a.id)).toBe("reserved | allocation");

    const theirs = await vehicle(1, { tenant: newYork });
    const gear = await general("gear", 1);
    const retired = await vehicle(0);
    await service
      .from("products")
      .update({ retired_at: new Date().toISOString() })
      .eq("id", retired.id)
      .throwOnError();
    const cases: [string, Promise<Result<Moved>>, string][] = [
      [
        "another shop's unit",
        move(db("owner"), shop, theirs.units[0], { product: b.id }),
        "unit_not_found",
      ],
      [
        "a made-up unit",
        move(db("owner"), shop, randomUUID(), { product: b.id }),
        "unit_not_found",
      ],
      [
        "another shop's product",
        move(db("owner"), shop, unit, { product: theirs.id }),
        "product_not_found",
      ],
      [
        "a made-up product",
        move(db("owner"), shop, unit, { product: randomUUID() }),
        "product_not_found",
      ],
      [
        "a retired product",
        move(db("owner"), shop, unit, { product: retired.id }),
        "product_not_found",
      ],
      [
        "another shop's place",
        move(db("owner"), shop, unit, {
          product: b.id,
          location: newYork.locationId,
        }),
        "location_not_found",
      ],
      [
        "a made-up place",
        move(db("owner"), shop, unit, {
          product: b.id,
          location: randomUUID(),
        }),
        "location_not_found",
      ],
      [
        "a product of another kind",
        move(db("owner"), shop, unit, { product: gear.id }),
        "invalid_request",
      ],
    ];
    for (const [what, call, message] of cases) {
      const { data, error } = await call;
      expect(data, what).toBeNull();
      expect(error?.message, what).toBe(message);
    }
    // Naming the other shop: not allowed, as for any stranger.
    expect(
      (
        await move(db("owner"), newYork, theirs.units[0], {
          product: theirs.id,
        })
      ).data,
    ).toEqual({ ok: false, reason: "not_allowed" });
    expect(await held(a.id)).toBe("reserved | allocation");
    for (const role of ["owner", "manager"] as const) {
      const target = role === "owner" ? b.id : a.id;
      expect(
        outcome(await move(db(role), shop, unit, { product: target })),
        role,
      ).toBe("ok");
    }
  });

  it("a hold that has run out on a unit since moved to another product (through move_unit(), the hold with it) is released by a booking of that product", async () => {
    const a = await vehicle(1);
    const b = await vehicle(0);
    const [unit] = a.units;
    const window = { starts_at: at(1), ends_at: at(2) };
    const hold = booked(
      await staffBook("staff", [{ product_id: a.id, ...window }], {
        hold: true,
      }),
    );
    // The only way a unit gets to another product (Phase 3 stage 1): the
    // hold goes with it. (This test once forced the unit across with the
    // triggers switched off, leaving the hold naming A: a state that
    // move_unit() never leaves and nothing else can make any more.)
    expect(
      outcome(await move(db("owner"), shop, unit, { product: b.id })),
    ).toBe("ok");
    await runOut(hold.booking_id);
    // B's only unit carries a run-out hold, which now names B.
    const next = booked(await onlineBook([{ product_id: b.id, ...window }]));
    expect(next.lines[0].unit_ids).toEqual([unit]);
    expect(await reservationsOf(a.id)).toEqual([]);
    expect((await reservationsOf(b.id)).map((r) => r.state).sort()).toEqual([
      "expired",
      "reserved",
    ]);
    expect((await eventsOf(hold.booking_id)).map((e) => e.action)).toEqual([
      "reserve",
      "move",
      "expire",
    ]);
    expect(
      (await blocksOf(b.id)).map((x) => `${x.kind} ${x.reservation_id}`),
    ).toEqual([`allocation ${next.lines[0].reservation_id}`]);
  });

  it("a booking of the product it leaves, written and not yet saved: the move waits for that product's lock with no unit lock, then takes the new booking with it", async () => {
    const a = await vehicle(1);
    const b = await vehicle(0);
    const [unit] = a.units;
    const marker = `booking-of-a-${tag}`;
    const call = request(
      shop,
      "booking_page",
      "instant",
      [{ product_id: a.id, starts_at: at(1), ends_at: at(2) }],
      false,
    );
    const gate = await closedGate();
    const booking = sqlBackground(`
      begin;
      ${actingAs(null)}
      select platform.reserve('${shop.id}', '${JSON.stringify(call.p_request)}'::jsonb) ->> 'ok';
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    const moving = move(db("owner"), shop, unit, { product: b.id });
    expect(await waitingForProductLock("move_unit")).toBe(
      "waiting, unit locks: 0",
    );
    await gate.open();
    const saved = await booking;
    expect(saved.failed).toBe("");
    expect(saved.out).toContain("true");
    const moved = await moving;
    noDeadlock([moved]);
    expect(moved.data).toMatchObject({ ok: true, bookings: 1 });
    expect(await held(b.id)).toBe("reserved | allocation");
    expect(await reservationsOf(a.id)).toEqual([]);
    await agree([a.id, b.id]);
  }, 60_000);

  it("a booking of the product it goes to, written and not yet saved: the move waits for that product's lock too", async () => {
    const a = await vehicle(1);
    const b = await vehicle(1);
    const [unit] = a.units;
    booked(
      await onlineBook([
        { product_id: a.id, starts_at: at(1), ends_at: at(2) },
      ]),
    );
    const marker = `booking-of-b-${tag}`;
    const call = request(
      shop,
      "walk_in",
      "staff",
      [{ product_id: b.id, starts_at: at(1), ends_at: at(2) }],
      false,
    );
    const gate = await closedGate();
    const booking = sqlBackground(`
      begin;
      ${actingAs(shop.members.staff.id)}
      select platform.reserve('${shop.id}', '${JSON.stringify(call.p_request)}'::jsonb) ->> 'ok';
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    const moving = move(db("manager"), shop, unit, { product: b.id });
    expect(await waitingForProductLock("move_unit")).toBe(
      "waiting, unit locks: 0",
    );
    await gate.open();
    expect((await booking).failed).toBe("");
    const moved = await moving;
    noDeadlock([moved]);
    expect(moved.data).toMatchObject({ ok: true, bookings: 1 });
    expect(await held(b.id)).toBe("reserved,reserved | allocation,allocation");
    expect(await counts(b.id, at(1), at(2))).toBe("2 / 0 / 0 / 0");
    await agree([a.id, b.id]);
  }, 60_000);

  it("the move written and not yet saved: a booking of either product waits for its lock; the one it left finds the unit gone, the one it joined gets it", async () => {
    for (const side of ["left", "joined"] as const) {
      const a = await vehicle(1);
      const b = await vehicle(0);
      const [unit] = a.units;
      const marker = `move-held-${side}-${tag}`;
      const gate = await closedGate();
      const moving = sqlBackground(`
        begin;
        ${actingAs(shop.members.owner.id)}
        select platform.move_unit('${shop.id}', '${unit}', '${b.id}', '${shop.locationId}') ->> 'ok';
        ${gate.wait(marker)}
        commit;
      `);
      await holding(marker);
      const call = onlineBook([
        {
          product_id: side === "left" ? a.id : b.id,
          starts_at: at(1),
          ends_at: at(2),
        },
      ]);
      expect(await waitingForProductLock("reserve"), side).toBe(
        "waiting, unit locks: 0",
      );
      await gate.open();
      const saved = await moving;
      expect(saved.failed).toBe("");
      expect(saved.out).toContain("true");
      const result = await call;
      noDeadlock([result]);
      if (side === "left") {
        expect(result.data).toEqual({
          ok: false,
          reason: "unavailable",
          line: 0,
        });
      } else {
        expect(booked(result).lines[0].unit_ids).toEqual([unit]);
      }
      await agree([a.id, b.id]);
    }
  }, 90_000);

  it("a direct change of an unbooked unit's place while a booking of it is written and not yet saved: it waits for the unit's lock, then is refused; a direct change of its product is refused at once, before any lock", async () => {
    const a = await vehicle(1);
    const b = await vehicle(0);
    const branch = await branchOf(shop);
    const [unit] = a.units;
    const marker = `booking-before-direct-${tag}`;
    const call = request(
      shop,
      "booking_page",
      "instant",
      [{ product_id: a.id, starts_at: at(1), ends_at: at(2) }],
      false,
    );
    const gate = await closedGate();
    const booking = sqlBackground(`
      begin;
      ${actingAs(null)}
      select platform.reserve('${shop.id}', '${JSON.stringify(call.p_request)}'::jsonb) ->> 'ok';
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    // The product: refused straight away, with the booking still open.
    const product = await db("owner")
      .from("units")
      .update({ product_id: b.id })
      .eq("id", unit)
      .select("id");
    expect(product.error?.message).toBe("use_move_unit");
    const direct = Promise.resolve(
      db("owner")
        .from("units")
        .update({ location_id: branch })
        .eq("id", unit)
        .select("id"),
    );
    const seen = await until(`
      select 'waiting for the unit lock'
      from pg_locks w
      where w.locktype = 'advisory' and w.classid = x'1a01'::int and not w.granted
        and w.objid::bigint = (hashtext('${unit}')::bigint & 4294967295)
      limit 1;
    `);
    expect(seen).toBe("waiting for the unit lock");
    await gate.open();
    expect((await booking).failed).toBe("");
    const refused = await direct;
    noDeadlock([refused]);
    expect(refused.error?.message).toBe("unit_has_bookings");
    expect(await held(a.id)).toBe("reserved | allocation");
    await agree([a.id, b.id]);
  }, 60_000);

  it("someone changing the unit directly holds its row and waits for its lock, which the move then gets: the move does not wait for the row, it answers try_again; no deadlock", async () => {
    const a = await vehicle(1);
    const b = await vehicle(0);
    const [unit] = a.units;
    const before = deadlocks();
    const unitLock = `w.locktype = 'advisory' and w.classid = x'1a01'::int
      and w.objid::bigint = (hashtext('${unit}')::bigint & 4294967295)`;

    // Session 1 holds the unit's lock (a downtime being written, say).
    const marker = `holds-unit-lock-${tag}`;
    const gate = await closedGate();
    const holder = sqlBackground(`
      begin;
      select platform_private.lock_units(array['${unit}']::uuid[]);
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    // Session 2, the move: it has its product locks and queues for the
    // unit's lock.
    const moving = move(db("owner"), shop, unit, { product: b.id });
    await until(`
      select 'queued' from pg_locks w join pg_stat_activity a on a.pid = w.pid
      where ${unitLock} and not w.granted and a.query like '%move_unit%'
      limit 1;
    `);
    // Session 3, a direct change that reads the unit's blocks (retiring it):
    // it locks the unit's row, then queues for the unit's lock behind the
    // move.
    const direct = Promise.resolve(
      db("manager")
        .from("units")
        .update({ status: "retired" })
        .eq("id", unit)
        .select("status"),
    );
    expect(
      await until(`
        select count(*)::text from pg_locks w
        where ${unitLock} and not w.granted
        having count(*) = 2;
      `),
    ).toBe("2");

    // Session 1 lets go. The move gets the lock and finds the row held by
    // the session that now waits for that lock. Waiting there would be a
    // deadlock; it asks once and steps back.
    await gate.open();
    expect((await holder).failed).toBe("");
    const moved = await moving;
    expect(moved.error).toBeNull();
    expect(moved.data).toEqual({ ok: false, reason: "try_again" });
    const retired = await direct;
    expect(retired.error).toBeNull();
    expect(retired.data).toEqual([{ status: "retired" }]);
    expect(await deadlocksReported()).toBe(before);
    const { data: after } = await service
      .from("units")
      .select("product_id, status")
      .eq("id", unit)
      .single();
    expect(after).toEqual({ product_id: a.id, status: "retired" });
  }, 60_000);

  it("two moves of units of one product at two places: the second waits for the product's row, it does not hold it half-locked; both go through", async () => {
    const a = await vehicle(1);
    const b = await vehicle(0);
    const there = await branchOf(shop);
    const [here] = a.units;
    const [other] = await addUnits(a.id, 1, shop, there);
    const before = deadlocks();
    // The first move, written and not yet saved: the unit at the main place.
    const marker = `first-move-${tag}`;
    const gate = await closedGate();
    const first = sqlBackground(`
      begin;
      ${actingAs(shop.members.owner.id)}
      select platform.move_unit('${shop.id}', '${here}', '${b.id}', '${shop.locationId}') ->> 'ok';
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    // The second: the unit at the branch. Other product-and-place locks, so
    // nothing stops it until the product's own row.
    const second = move(db("manager"), shop, other, {
      product: b.id,
      location: there,
    });
    const seen = await until(`
      select 'waiting for a row, product locks: ' || (
        select count(*) from pg_locks g
        where g.pid = a.pid and g.locktype = 'advisory' and g.granted
          and g.classid = x'1a02'::int
      )
      from pg_stat_activity a
      join pg_locks w on w.pid = a.pid and not w.granted
        and w.locktype in ('transactionid', 'tuple')
      where a.query like '%move_unit%' and a.query not like '%${marker}%'
        and a.pid <> pg_backend_pid()
      limit 1;
    `);
    expect(seen).toBe("waiting for a row, product locks: 2");
    await gate.open();
    const saved = await first;
    expect(saved.failed).toBe("");
    expect(saved.out).toContain("true");
    const result = await second;
    noDeadlock([result]);
    expect(result.data).toMatchObject({ ok: true });
    expect(await deadlocksReported()).toBe(before);
    expect(await counts(a.id, at(1), at(2))).toBe("0 / 0 / 0 / 0");
  }, 60_000);

  it(`two moves of units of one product at two places, at the same instant: both go through, no deadlock, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      const there = await branchOf(tenant);
      for (let round = 0; round < ROUNDS; round++) {
        const a = await listedVehicle(1, tenant);
        const b = await vehicle(0, { tenant });
        const [here] = a.units;
        const [other] = await addUnits(a.id, 1, tenant, there);
        booked(
          await onlineBook(
            [{ product_id: a.id, starts_at: at(1), ends_at: at(2) }],
            { tenant },
          ),
        );
        const results = await Promise.all([
          move(db("owner", tenant), tenant, here, { product: b.id }),
          move(db("manager", tenant), tenant, other, {
            product: b.id,
            location: there,
          }),
        ]);
        raceRounds++;
        noDeadlock(results);
        expect(
          results.map((r) => outcome(r)),
          `${where}, round ${round}`,
        ).toEqual(["ok", "ok"]);
        await agree([a.id, b.id]);
      }
    }
  }, 300_000);

  it("a cancel, a confirm and an assign that chose their lock before a move changed the row's product: each waits, reads again under the lock, and answers try_again; sent again, it works", async () => {
    for (const what of ["cancel", "confirm", "assign"] as const) {
      const a = await vehicle(1);
      const b = await vehicle(1);
      const [unit] = a.units;
      const one = booked(
        await staffBook(
          "staff",
          [{ product_id: a.id, starts_at: at(1), ends_at: at(2) }],
          { hold: what === "confirm" },
        ),
      );
      const id = one.lines[0].reservation_id;
      const call = () =>
        what === "cancel"
          ? cancel(db("staff"), shop, one.booking_id)
          : what === "confirm"
            ? confirm(db("staff"), shop, one.booking_id)
            : assign(db("staff"), shop, id);
      const needle = {
        cancel: "cancel_reservation",
        confirm: "confirm_hold",
        assign: "assign_units",
      }[what];

      // The move, written and not yet saved: the row still reads product A
      // to everyone else, and A's lock is held.
      const marker = `move-before-${what}-${tag}`;
      const gate = await closedGate();
      const moving = sqlBackground(`
        begin;
        ${actingAs(shop.members.owner.id)}
        select platform.move_unit('${shop.id}', '${unit}', '${b.id}', '${shop.locationId}') ->> 'ok';
        ${gate.wait(marker)}
        commit;
      `);
      await holding(marker);
      const early = call();
      expect(await waitingForProductLock(needle), what).toBe(
        "waiting, unit locks: 0",
      );
      await gate.open();
      const saved = await moving;
      expect(saved.failed).toBe("");
      expect(saved.out).toContain("true");
      // It got A's lock; the row is B's now.
      const answer = await early;
      expect(answer.error).toBeNull();
      expect(answer.data, what).toEqual({ ok: false, reason: "try_again" });
      expect(await held(b.id), what).toBe(
        what === "confirm" ? "held | hold" : "reserved | allocation",
      );

      expect(outcome(await call()), what).toBe("ok");
      expect(await held(b.id), what).toBe(
        what === "cancel" ? "cancelled | " : "reserved | allocation",
      );
      await agree([a.id, b.id]);
    }
  }, 120_000);

  it("the rest of the Details form is saved by the same call: all of it with the move, or none of it", async () => {
    const a = await vehicle(2);
    const b = await vehicle(0);
    const [unit, other] = a.units;
    booked(
      await staffBook("staff", [
        {
          product_id: a.id,
          starts_at: at(1),
          ends_at: at(2),
          unit_ids: [unit],
        },
      ]),
    );
    const { data: taken } = await service
      .from("units")
      .select("plate")
      .eq("id", other)
      .single();
    const details = (plate: string) => ({
      p_tenant_id: shop.id,
      p_unit_id: unit,
      p_product_id: b.id,
      p_location_id: shop.locationId,
      p_details: {
        plate,
        plate_pending: false,
        frame_number: "FRAME-1",
        engine_number: null,
        colour: "Green",
        model_year: 2024,
        notes: "Moved",
        current_odometer_km: 1234.5,
      },
    });
    // A plate another vehicle has: the whole call is undone, the move too.
    const clash = await db("owner").rpc("move_unit", details(taken!.plate!));
    expect(clash.data).toBeNull();
    expect(clash.error?.message).toMatch(/units_plate_idx/);
    expect(await held(a.id)).toBe("reserved | allocation");
    expect(await reservationsOf(b.id)).toEqual([]);
    const { data: untouched } = await service
      .from("units")
      .select("product_id, colour, notes")
      .eq("id", unit)
      .single();
    expect(untouched).toEqual({ product_id: a.id, colour: null, notes: null });

    const plate = `AV-${tag}-MOVED`;
    const done = await db("owner").rpc("move_unit", details(plate));
    expect(done.error).toBeNull();
    expect(done.data).toMatchObject({ ok: true, bookings: 1 });
    const { data: saved } = await service
      .from("units")
      .select(
        "product_id, plate, plate_pending, frame_number, engine_number, colour, model_year, notes, current_odometer_km",
      )
      .eq("id", unit)
      .single();
    expect(saved).toEqual({
      product_id: b.id,
      plate,
      plate_pending: false,
      frame_number: "FRAME-1",
      engine_number: null,
      colour: "Green",
      model_year: 2024,
      notes: "Moved",
      current_odometer_km: 1234.5,
    });
    expect(await held(b.id)).toBe("reserved | allocation");

    // Only the form's own fields: anything else is not this function's.
    for (const extra of [{ status: "sold" }, { tenant_id: newYork.id }, []]) {
      const { error } = await db("owner").rpc("move_unit", {
        ...details(plate),
        p_details: extra as never,
      });
      expect(error?.message, JSON.stringify(extra)).toBe("invalid_request");
    }
  });

  it(`a move racing bookings of both products and the sweep: every booking ends on the product its unit is on, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      for (let round = 0; round < ROUNDS; round++) {
        const a = await vehicle(1, { tenant });
        const b = await vehicle(1, { tenant });
        const [unit] = a.units;
        const window = { starts_at: at(1), ends_at: at(2) };
        const results = await Promise.all([
          move(db("owner", tenant), tenant, unit, { product: b.id }),
          round % 2
            ? staffBook("staff", [{ product_id: a.id, ...window }], {
                tenant,
                hold: true,
              })
            : onlineBook([{ product_id: a.id, ...window }], { tenant }),
          onlineBook([{ product_id: b.id, ...window, quantity: 2 }], {
            tenant,
          }),
          sweep(),
        ]);
        raceRounds++;
        noDeadlock(results);
        const [moved, ofA, ofB] = results.map((r) => outcome(r as Result));
        expect(moved, `${where}, round ${round}`).toBe("ok");
        // A's booking got the unit before it left (and went with it), or
        // found it gone. B's booking for two got both only if the unit had
        // arrived free.
        expect(["ok", "unavailable"]).toContain(ofA);
        expect(["ok", "unavailable"]).toContain(ofB);
        expect(ofA === "ok" && ofB === "ok", `${where}, round ${round}`).toBe(
          false,
        );
        const blocks = await blocksOf(b.id);
        expect(new Set(blocks.map((x) => x.unit_id)).size).toBe(blocks.length);
        expect(await blocksOf(a.id)).toEqual([]);
        expect(
          (await reservationsOf(a.id)).filter((r) =>
            ["held", "reserved"].includes(r.state),
          ),
          `${where}, round ${round}`,
        ).toEqual([]);
        await agree([a.id, b.id]);
      }
    }
  }, 300_000);
});

describe("best fit, measured: how often a unit-by-unit pick refuses what a pool would allow", () => {
  it("random bookings on 20 helmets", async () => {
    const helmet = await general("gear", 20, saigon);
    // A fixed sequence, so every run measures the same thing.
    let seed = 20261116;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    let asked = 0;
    let bookedCount = 0;
    let refused = 0;
    let poolWouldAllow = 0;
    for (let i = 0; i < 160; i++) {
      const from = random(30 * 4) * 6; // hours, on a 6-hour grid over 30 days
      const length = (1 + random(16)) * 6;
      const quantity = 1 + random(3);
      const window = [at(400, from), at(400, from + length)] as const;
      asked++;
      const result = await onlineBook(
        [
          {
            product_id: helmet.id,
            starts_at: window[0],
            ends_at: window[1],
            quantity,
          },
        ],
        { tenant: saigon },
      );
      if (outcome(result) === "ok") {
        bookedCount++;
        continue;
      }
      refused++;
      // The pool rule: stock less the most out at any one moment.
      const busiest = Number(
        sql(`
          with b as (
            select b.period from platform.unit_blocks b
            join platform.units u on u.id = b.unit_id
            where u.product_id = '${helmet.id}'
              and b.period && tstzrange('${window[0].toISOString()}', '${window[1].toISOString()}')
          )
          select coalesce(max((select count(*) from b o
            where o.period @> greatest(lower(s.period), '${window[0].toISOString()}'::timestamptz))), 0)
          from b s;
        `).out,
      );
      if (20 - busiest >= quantity) poolWouldAllow++;
    }
    console.log(
      `fragmentation: ${asked} asked, ${bookedCount} booked, ${refused} refused, of which a pool would have allowed ${poolWouldAllow}`,
    );
    expect(asked).toBe(160);
    expect(bookedCount + refused).toBe(160);
    // A measure, not a rule: it is reported in docs/PROGRESS.md.
    expect(poolWouldAllow).toBeLessThanOrEqual(refused);
  }, 240_000);
});

describe("last: Postgres reported no deadlock", () => {
  it("the database's own count of detected deadlocks did not move during this file", async () => {
    expect(await deadlocksReported()).toBe(deadlocksBefore);
  });
});
