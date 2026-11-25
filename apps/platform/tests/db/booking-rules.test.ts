/**
 * Phase 2, stage 3: booking rules and the Moto Mangos cap (migration
 * 20261116000300; docs/phase-2-plan.md §2.3, §3.6, §4, §9).
 *
 * The rule columns and what they refuse; save_booking_rules() by every role
 * and shop against shop; booking_inputs(), the read; the shop's default
 * buffers in create_order() and in the availability read; the Moto Mangos
 * cap inside create_order(), also under races (two online bookings for the cap's last
 * place give one success and no deadlock, at one place and at two); and
 * bookOnline(), the one server entry point, against this database: a
 * booking the rules refuse leaves it unchanged, and nobody but the server
 * can book an online channel. The races run in three shops: Bangkok (THB),
 * New York (USD, daylight saving) and Saigon (VND).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  bookOnline,
  type OnlineBookingRequest,
  type OnlineDb,
} from "@/lib/book-online";
import { roles, type Role } from "@/lib/roles";
import {
  anonClient,
  type BookingAnswer,
  type BookingResult,
  cancelOrder,
  closedGate,
  createCatalogEntry,
  createOrder,
  createTenant,
  createUser,
  type Db,
  deleteTenant,
  deleteUser,
  forceListing,
  GATE_TIMEOUTS,
  holding,
  orderSql,
  removeCatalogEntry,
  serviceClient,
  sql,
  sqlBackground,
  type TestTenant,
  type TestUser,
  until,
  watch,
} from "./helpers";
import { exactlyOne } from "@mango/db/rows";

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

type Line = {
  product_id: string;
  location_id?: string;
  starts_at: Date;
  ends_at: Date;
  quantity?: number;
  parent?: number;
};
// Since Phase 3 stage 2b every booking is an order: create_order(), through
// the createOrder() helper, which keeps Phase 2's request and answer shapes
// (booking_id is the order's id).
type Answer = BookingAnswer;
type Booked = Extract<BookingAnswer, { ok: true }>;
type Result<T = Answer> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

function request(
  tenant: TestTenant,
  channel: string,
  mode: string,
  lines: Line[],
  hold = false,
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

type Options = { tenant?: TestTenant; mode?: string; hold?: boolean };

/** The server booking for Moto Mangos, straight at create_order(). */
const mmBook = (lines: Line[], o: Options = {}): Promise<BookingResult> =>
  createOrder(
    service,
    (o.tenant ?? shop).id,
    request(
      o.tenant ?? shop,
      "marketplace",
      o.mode ?? "instant",
      lines,
      !!o.hold,
    ).p_request,
  );

/** The server booking for the shop's own page. */
const pageBook = (lines: Line[], o: Options = {}): Promise<BookingResult> =>
  createOrder(
    service,
    (o.tenant ?? shop).id,
    request(o.tenant ?? shop, "booking_page", "instant", lines, !!o.hold)
      .p_request,
  );

const staffBook = (
  role: Role,
  lines: Line[],
  o: Options = {},
): Promise<BookingResult> =>
  createOrder(
    db(role, o.tenant ?? shop),
    (o.tenant ?? shop).id,
    request(o.tenant ?? shop, "walk_in", "staff", lines, !!o.hold).p_request,
  );

const booked = (result: Result): Booked => {
  expect(result.error, result.error?.message).toBeNull();
  expect(result.data, JSON.stringify(result.data)).toMatchObject({ ok: true });
  return result.data as Booked;
};

/** "ok" or the refusal's reason; a raised error fails the test. */
const outcome = (result: Result) => {
  expect(result.error, result.error?.message).toBeNull();
  const data = result.data as Answer;
  return data.ok ? "ok" : data.reason;
};

type Rules = {
  shop?: Record<string, unknown>;
  locations?: Record<string, unknown>[];
  products?: Record<string, unknown>[];
};
type Saved = {
  shop: Record<string, unknown>;
  locations: Record<string, unknown>[];
  products: Record<string, unknown>[];
};

const saveRules = (client: Db, tenant: TestTenant, rules: unknown) =>
  Promise.resolve(
    client.rpc("save_booking_rules", {
      p_tenant_id: tenant.id,
      p_rules: rules as never,
    }),
  ) as Promise<Result<Saved>>;

/** Saves rules as the shop's owner; fails the test if it is refused. */
async function rulesAs(tenant: TestTenant, rules: Rules): Promise<Saved> {
  const { data, error } = await saveRules(db("owner", tenant), tenant, rules);
  expect(error, error?.message).toBeNull();
  return data!;
}

type Inputs = {
  shop: Record<string, unknown>;
  location: Record<string, unknown> & {
    hours: { weekday: number; open: string; close: string }[];
    closures: Record<string, unknown>[];
  };
  products: (Record<string, unknown> & {
    product_id: string;
    listing: Record<string, unknown> | null;
  })[];
};

const inputs = (
  client: Db,
  tenant: TestTenant,
  products: string[],
  locationId: string = tenant.locationId,
) =>
  Promise.resolve(
    client.rpc("booking_inputs", {
      p_tenant_id: tenant.id,
      p_location_id: locationId,
      p_product_ids: products,
    }),
  ) as Promise<Result<Inputs>>;

/** A vehicle product with `count` units, made with the service role. */
async function vehicle(
  count: number,
  options: {
    tenant?: TestTenant;
    before?: number | null;
    after?: number | null;
    locationId?: string;
  } = {},
) {
  const tenant = options.tenant ?? shop;
  const product = await exactlyOne(
    service
      .from("products")
      .insert({
        tenant_id: tenant.id,
        name: name("Scooter"),
        vehicle_type: "motorbike",
        buffer_before_minutes: options.before ?? null,
        buffer_after_minutes: options.after ?? null,
      })
      .select("id"),
  );
  if (product.error) throw product.error;
  const units = count
    ? await addUnits(product.data.id, count, tenant, options.locationId)
    : [];
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
        plate: `BR-${tag}-${++counter}`,
      })),
    )
    .select("id");
  if (units.error) throw units.error;
  return units.data.map((u) => u.id);
}

/** A vehicle on Moto Mangos: only a product on an approved list entry can be listed. */
async function listedVehicle(
  count: number,
  listing: { instant: number; request?: number; enabled?: boolean },
  tenant: TestTenant = shop,
) {
  const bike = await vehicle(count, { tenant });
  await service
    .from("products")
    .update({ catalog_id: catalogId })
    .eq("id", bike.id)
    .throwOnError();
  const { error } = await forceListing(tenant.id, bike.id, {
    marketplace_listed: listing.enabled ?? true,
    instant_units: listing.instant,
    request_units: listing.request ?? 0,
  });
  if (error) throw error;
  return bike;
}

/** Rental gear or a service, made as the owner. */
async function general(
  type: "gear" | "service",
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
  return { id: data as string };
}

async function branch(tenant: TestTenant, timezone: string) {
  const { data, error } = await exactlyOne(
    service
      .from("locations")
      .insert({ tenant_id: tenant.id, name: name("Branch"), timezone })
      .select("id"),
  );
  if (error) throw error;
  return data.id as string;
}

/** A price by the day, saved as the owner. */
async function priceByDay(
  productId: string,
  amount: number,
  tenant: TestTenant = shop,
) {
  const { error } = await db("owner", tenant).rpc("save_product_pricing", {
    p_product_id: productId,
    p_settings: {
      pricing_method: "per_period",
      price_amount: amount,
      price_period: "day",
    } as never,
  });
  if (error) throw error;
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

const blockCount = async (productId: string) =>
  (
    await service
      .from("unit_blocks")
      .select("id, unit:units!inner(product_id)")
      .eq("unit.product_id", productId)
      .throwOnError()
  ).data!.length;

/** Everything a booking could have written for a shop, as counts. */
function written(tenant: TestTenant) {
  return sql(`
    select (select count(*) from platform.reservations where tenant_id = '${tenant.id}')
      || ' reservations, '
      || (select count(*) from platform.unit_blocks where tenant_id = '${tenant.id}')
      || ' blocks, '
      || (select count(*) from platform.audit_events
          where tenant_id = '${tenant.id}' and entity in ('bookings', 'reservations', 'unit_blocks'))
      || ' events';
  `).out;
}

/** No call was ended by Postgres to break a deadlock, caught or not. */
const noDeadlock = (
  results: { data?: unknown; error: Result["error"] | null }[],
) => {
  for (const result of results) {
    expect(result.error?.code, result.error?.message).not.toBe("40P01");
    expect(result.error?.message ?? "").not.toMatch(/deadlock/i);
    const data = result.data as { ok?: boolean; reason?: string } | null;
    if (data && typeof data === "object" && data.ok === false)
      expect(data.reason).not.toBe("try_again");
  }
};

const deadlocks = () =>
  Number(
    sql(
      `select pg_stat_force_next_flush(); select deadlocks from pg_stat_database where datname = current_database();`,
    )
      .out.split("\n")
      .pop(),
  );

/** A psql session acting as the server (the service role). */
const asServer = `select set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role;`;

const everyShop = (): [string, TestTenant][] => [
  ["Bangkok", shop],
  ["New York", newYork],
  ["Saigon", saigon],
];

const everyDay = (open: string, close: string, tenant: TestTenant) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    tenant_id: tenant.id,
    location_id: tenant.locationId,
    weekday,
    open,
    close,
  }));

beforeAll(async () => {
  deadlocksBefore = deadlocks();
  [shop, newYork, saigon, outsider] = await Promise.all([
    createTenant("rules-bkk", {
      country: "TH",
      currency: "THB",
      locale: "th-TH",
      timezone: "Asia/Bangkok",
    }),
    createTenant("rules-nyc", {
      country: "US",
      currency: "USD",
      locale: "en-US",
      timezone: "America/New_York",
    }),
    createTenant("rules-sgn"),
    createUser("rules-outsider"),
  ]);
  catalogId = await createCatalogEntry("rules");
}, 120_000);

afterAll(async () => {
  console.log(`booking-rules.test.ts: ${raceRounds} race rounds`);
  await Promise.all([
    deleteTenant(shop),
    deleteTenant(newYork),
    deleteTenant(saigon),
    deleteUser(outsider),
  ]);
  await removeCatalogEntry(catalogId);
});

describe("the rule columns", () => {
  it("nothing is set on a new shop: no rule, no default buffer, overbooking off, a 15-minute hold", async () => {
    const location = await exactlyOne(
      service
        .from("locations")
        .select(
          "min_notice_hours, booking_cutoff_minutes, min_days_advance, min_days_walkin",
        )
        .eq("id", saigon.locationId),
    );
    expect(location.data).toEqual({
      min_notice_hours: null,
      booking_cutoff_minutes: null,
      min_days_advance: null,
      min_days_walkin: null,
    });
    const tenant = await exactlyOne(
      service
        .from("tenants")
        .select(
          "buffer_before_minutes, buffer_after_minutes, allow_overbooking, hold_minutes",
        )
        .eq("id", saigon.id),
    );
    expect(tenant.data).toEqual({
      buffer_before_minutes: null,
      buffer_after_minutes: null,
      allow_overbooking: false,
      hold_minutes: 15,
    });
    const bike = await vehicle(0, { tenant: saigon });
    const product = await exactlyOne(
      service
        .from("products")
        .select("min_days_advance, min_days_walkin")
        .eq("id", bike.id),
    );
    expect(product.data).toEqual({
      min_days_advance: null,
      min_days_walkin: null,
    });
  });

  it("each column has its range, held by the table itself (the service role is refused too)", async () => {
    const refusedLocation = async (values: object) =>
      (
        await service
          .from("locations")
          .update(values)
          .eq("id", saigon.locationId)
      ).error?.code;
    for (const values of [
      { min_notice_hours: -1 },
      { min_notice_hours: 721 },
      { booking_cutoff_minutes: -1 },
      { booking_cutoff_minutes: 1441 },
      { min_days_advance: 0 },
      { min_days_advance: 366 },
      { min_days_walkin: 0 },
      { min_days_walkin: 366 },
    ]) {
      expect(await refusedLocation(values), JSON.stringify(values)).toBe(
        "23514",
      );
    }
    for (const values of [
      { buffer_before_minutes: -1 },
      { buffer_before_minutes: 10081 },
      { buffer_after_minutes: -1 },
      { buffer_after_minutes: 10081 },
    ]) {
      const { error } = await service
        .from("tenants")
        .update(values)
        .eq("id", saigon.id);
      expect(error?.code, JSON.stringify(values)).toBe("23514");
    }
    const bike = await vehicle(0, { tenant: saigon });
    for (const values of [{ min_days_advance: 0 }, { min_days_walkin: 366 }]) {
      const { error } = await service
        .from("products")
        .update(values)
        .eq("id", bike.id);
      expect(error?.code, JSON.stringify(values)).toBe("23514");
    }
  });

  it("only a vehicle has minimum days of its own", async () => {
    const helmet = await general("gear", 2, saigon);
    const { error } = await service
      .from("products")
      .update({ min_days_advance: 2 })
      .eq("id", helmet.id);
    expect(error?.message).toContain("products_min_days_vehicle_check");
  });

  it("no signed-in person writes the shop's settings directly, the owner included", async () => {
    for (const role of roles) {
      for (const values of [
        { allow_overbooking: true },
        { hold_minutes: 30 },
        { buffer_before_minutes: 60 },
        { buffer_after_minutes: 60 },
      ]) {
        const { error } = await db(role, saigon)
          .from("tenants")
          .update(values as never)
          .eq("id", saigon.id);
        expect(error?.code, `${role} ${JSON.stringify(values)}`).toBe("42501");
      }
    }
  });
});

describe("save_booking_rules()", () => {
  it("the shop's settings: the first way to switch overbooking on, set the hold length and the default buffers", async () => {
    const tenant = await createTenant("rules-shop");
    try {
      const saved = await rulesAs(tenant, {
        shop: {
          allow_overbooking: true,
          hold_minutes: 30,
          buffer_before_minutes: 60,
          buffer_after_minutes: 120,
        },
      });
      expect(saved).toEqual({
        shop: {
          allow_overbooking: true,
          hold_minutes: 30,
          buffer_before_minutes: 60,
          buffer_after_minutes: 120,
        },
        locations: [],
        products: [],
      });
      // Only what is named changes; null clears a buffer.
      const next = await rulesAs(tenant, {
        shop: { hold_minutes: 5, buffer_after_minutes: null },
      });
      expect(next.shop).toEqual({
        allow_overbooking: true,
        hold_minutes: 5,
        buffer_before_minutes: 60,
        buffer_after_minutes: null,
      });
      const row = await exactlyOne(
        service
          .from("tenants")
          .select(
            "allow_overbooking, hold_minutes, buffer_before_minutes, buffer_after_minutes",
          )
          .eq("id", tenant.id),
      );
      expect(row.data).toEqual(next.shop);

      // Overbooking is on for real: staff can now save a booking short.
      const bike = await vehicle(1, { tenant });
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
          { tenant },
        ),
      );
      expect(short.lines[0].shortage).toBe(1);
      // And a hold lasts the five minutes just set.
      const hold = (await staffBook(
        "staff",
        [{ product_id: bike.id, starts_at: at(5), ends_at: at(6) }],
        { tenant, hold: true },
      )) as Result<Booked & { hold_expires_at: string }>;
      const expires = Date.parse(hold.data!.hold_expires_at) - Date.now();
      expect(expires).toBeGreaterThan(4 * 60_000);
      expect(expires).toBeLessThan(5 * 60_000 + 5_000);
    } finally {
      await deleteTenant(tenant);
    }
  }, 60_000);

  it("a location's rules: notice, cut-off and minimum days; only what is named changes; null clears", async () => {
    const saved = await rulesAs(newYork, {
      locations: [
        {
          id: newYork.locationId,
          min_notice_hours: 24,
          booking_cutoff_minutes: 90,
          min_days_advance: 2,
          min_days_walkin: 1,
        },
      ],
    });
    expect(saved.locations).toEqual([
      {
        id: newYork.locationId,
        min_notice_hours: 24,
        booking_cutoff_minutes: 90,
        min_days_advance: 2,
        min_days_walkin: 1,
      },
    ]);
    const next = await rulesAs(newYork, {
      locations: [
        { id: newYork.locationId, min_notice_hours: 0, min_days_walkin: null },
      ],
    });
    expect(next.locations[0]).toEqual({
      id: newYork.locationId,
      min_notice_hours: 0,
      booking_cutoff_minutes: 90,
      min_days_advance: 2,
      min_days_walkin: null,
    });
    // The shop's own settings were not named: untouched.
    expect(next.shop).toMatchObject({
      allow_overbooking: false,
      hold_minutes: 15,
    });
    await rulesAs(newYork, {
      locations: [
        {
          id: newYork.locationId,
          min_notice_hours: null,
          booking_cutoff_minutes: null,
          min_days_advance: null,
        },
      ],
    });
  });

  it("a vehicle's own minimum days; gear and services have none; a retired product is not found", async () => {
    const bike = await vehicle(0);
    const other = await vehicle(0);
    const saved = await rulesAs(shop, {
      products: [
        { id: bike.id, min_days_advance: 3, min_days_walkin: 2 },
        { id: other.id, min_days_advance: 7 },
      ],
    });
    expect(
      saved.products.sort((a, b) =>
        String(a.min_days_advance).localeCompare(String(b.min_days_advance)),
      ),
    ).toEqual([
      { id: bike.id, min_days_advance: 3, min_days_walkin: 2 },
      { id: other.id, min_days_advance: 7, min_days_walkin: null },
    ]);
    const helmet = await general("gear", 1);
    const gear = await saveRules(db("owner"), shop, {
      products: [{ id: helmet.id, min_days_advance: 2 }],
    });
    expect(gear.error?.message).toBe("not_a_vehicle");
    await service
      .from("products")
      .update({ retired_at: new Date().toISOString() })
      .eq("id", other.id)
      .throwOnError();
    const retired = await saveRules(db("owner"), shop, {
      products: [{ id: other.id, min_days_advance: 2 }],
    });
    expect(retired.error?.message).toBe("product_not_found");
  });

  it("what it refuses: a value out of range, the wrong kind of value, an unknown key, the same row twice", async () => {
    const bike = await vehicle(0);
    const place = shop.locationId;
    const bad: unknown[] = [
      null,
      [],
      "rules",
      { shops: {} },
      { shop: [] },
      { shop: { allow_overbooking: "yes" } },
      { shop: { allow_overbooking: null } },
      { shop: { hold_minutes: 4 } },
      { shop: { hold_minutes: 61 } },
      { shop: { hold_minutes: null } },
      { shop: { hold_minutes: "15" } },
      { shop: { hold_minutes: 15.5 } },
      { shop: { buffer_before_minutes: -1 } },
      { shop: { buffer_after_minutes: 10081 } },
      { shop: { currency: "USD" } },
      { locations: {} },
      { locations: [{ min_notice_hours: 2 }] },
      { locations: [{ id: "not-a-uuid" }] },
      { locations: [{ id: place, min_notice_hours: 721 }] },
      { locations: [{ id: place, booking_cutoff_minutes: 1441 }] },
      { locations: [{ id: place, min_days_advance: 0 }] },
      { locations: [{ id: place, min_days_walkin: 366 }] },
      { locations: [{ id: place, timezone: "UTC" }] },
      { locations: [{ id: place }, { id: place }] },
      { products: [{ id: bike.id, min_days_advance: 0 }] },
      { products: [{ id: bike.id, buffer_before_minutes: 5 }] },
      { products: [{ id: bike.id }, { id: bike.id }] },
    ];
    for (const rules of bad) {
      const { error } = await saveRules(db("owner"), shop, rules);
      expect(error?.message, JSON.stringify(rules)).toBe("invalid_rules");
      expect(error?.code, JSON.stringify(rules)).toBe("22023");
    }
  });

  it("all or nothing: one bad value and none of the call is saved", async () => {
    const before = await rulesAs(saigon, {
      shop: {},
      locations: [{ id: saigon.locationId }],
    });
    const { error } = await saveRules(db("owner", saigon), saigon, {
      shop: { hold_minutes: 45, allow_overbooking: true },
      locations: [
        { id: saigon.locationId, min_notice_hours: 12 },
        { id: randomUUID(), min_notice_hours: 12 },
      ],
    });
    expect(error?.message).toBe("location_not_found");
    expect(
      await rulesAs(saigon, {
        shop: {},
        locations: [{ id: saigon.locationId }],
      }),
    ).toEqual(before);
  });

  it("owners and managers save; staff, mechanics and drivers are refused and nothing changes", async () => {
    const bike = await vehicle(0);
    for (const role of roles) {
      const minutes = 20 + roles.indexOf(role);
      const { data, error } = await saveRules(db(role), shop, {
        shop: { hold_minutes: minutes },
        locations: [{ id: shop.locationId, booking_cutoff_minutes: minutes }],
        products: [{ id: bike.id, min_days_advance: minutes }],
      });
      const row = await exactlyOne(
        service.from("tenants").select("hold_minutes").eq("id", shop.id),
      );
      if (role === "owner" || role === "manager") {
        expect(error, `${role}: ${error?.message}`).toBeNull();
        expect(data!.shop.hold_minutes).toBe(minutes);
        expect(row.data!.hold_minutes).toBe(minutes);
      } else {
        expect(error?.message, role).toBe("only_owner_or_manager");
        expect(error?.code, role).toBe("42501");
        // Still what the manager saved.
        expect(row.data!.hold_minutes, role).toBe(21);
      }
    }
    await rulesAs(shop, {
      shop: { hold_minutes: 15 },
      locations: [{ id: shop.locationId, booking_cutoff_minutes: null }],
    });
  }, 60_000);

  it("another shop's five roles, a stranger, a signed-out visitor and the server: none can save this shop's rules", async () => {
    const before = written(shop);
    const row = () =>
      exactlyOne(
        service
          .from("tenants")
          .select("hold_minutes, allow_overbooking")
          .eq("id", shop.id),
      );
    const start = (await row()).data;
    const rules = { shop: { hold_minutes: 59, allow_overbooking: true } };
    for (const role of roles) {
      const { error } = await saveRules(db(role, saigon), shop, rules);
      expect(error?.message, `Saigon's ${role}`).toBe("only_owner_or_manager");
    }
    expect(
      (await saveRules(outsider.db, shop, rules)).error?.message,
      "a stranger",
    ).toBe("only_owner_or_manager");
    // Not granted to them at all.
    for (const [who, client] of [
      ["signed out", anonClient()],
      ["the server", service],
    ] as const) {
      const { error } = await saveRules(client, shop, rules);
      expect(error?.code, who).toBe("42501");
      expect(error?.message, who).toMatch(/permission denied/);
    }
    expect((await row()).data).toEqual(start);
    expect(written(shop)).toBe(before);
  });

  it("another shop's location or vehicle is answered exactly like one that does not exist, and is not changed", async () => {
    const theirs = await vehicle(0, { tenant: saigon });
    const madeUp = randomUUID();
    const location = (id: string) =>
      saveRules(db("owner"), shop, {
        locations: [{ id, min_notice_hours: 99 }],
      });
    const product = (id: string) =>
      saveRules(db("owner"), shop, {
        products: [{ id, min_days_advance: 99 }],
      });
    const a = await location(saigon.locationId);
    const b = await location(madeUp);
    expect(a.error).toEqual(b.error);
    expect(a.error?.message).toBe("location_not_found");
    const c = await product(theirs.id);
    const d = await product(madeUp);
    expect(c.error).toEqual(d.error);
    expect(c.error?.message).toBe("product_not_found");
    const untouched = await exactlyOne(
      service
        .from("locations")
        .select("min_notice_hours")
        .eq("id", saigon.locationId),
    );
    expect(untouched.data!.min_notice_hours).toBeNull();
    const untouchedProduct = await exactlyOne(
      service.from("products").select("min_days_advance").eq("id", theirs.id),
    );
    expect(untouchedProduct.data!.min_days_advance).toBeNull();
  });

  it("each row it changes is in the shop's history, with who changed it", async () => {
    const tenant = await createTenant("rules-audit");
    try {
      await rulesAs(tenant, {
        shop: { allow_overbooking: true },
        locations: [{ id: tenant.locationId, min_notice_hours: 12 }],
      });
      const events = await service
        .from("audit_events")
        .select("entity, action, actor, after")
        .eq("tenant_id", tenant.id)
        .in("entity", ["tenants", "locations"])
        .eq("action", "update")
        .order("id");
      expect(events.data!.map((e) => `${e.entity} ${e.actor}`)).toEqual([
        `tenants ${tenant.members.owner.id}`,
        `locations ${tenant.members.owner.id}`,
      ]);
      expect(events.data![0].after).toMatchObject({ allow_overbooking: true });
      expect(events.data![1].after).toMatchObject({ min_notice_hours: 12 });
    } finally {
      await deleteTenant(tenant);
    }
  }, 60_000);
});

describe("booking_inputs(): the read", () => {
  it("one answer with the location's time zone, hours, closures and rules, the shop's settings, and each product's buffers, minimum days and listing", async () => {
    const tenant = await createTenant("rules-read", {
      country: "US",
      currency: "USD",
      locale: "en-US",
      timezone: "America/New_York",
    });
    try {
      await service
        .from("location_hours")
        .insert(
          everyDay("09:00", "18:30", tenant).filter((h) => h.weekday !== 0),
        )
        .throwOnError();
      await service
        .from("location_closures")
        .insert([
          {
            tenant_id: tenant.id,
            location_id: tenant.locationId,
            start_date: "2031-12-24",
            end_date: "2032-01-01",
            repeats_yearly: true,
          },
          {
            tenant_id: tenant.id,
            location_id: tenant.locationId,
            start_date: "2031-07-04",
            end_date: "2031-07-04",
            repeats_yearly: false,
          },
        ])
        .throwOnError();
      const own = await listedVehicle(3, { instant: 1, request: 2 }, tenant);
      await service
        .from("products")
        .update({ buffer_before_minutes: 30 })
        .eq("id", own.id)
        .throwOnError();
      await service
        .from("product_listings")
        .update({ lead_time_hours: 12 })
        .eq("product_id", own.id)
        .throwOnError();
      const plain = await vehicle(1, { tenant });
      const helmet = await general("gear", 3, tenant);
      await rulesAs(tenant, {
        shop: { buffer_before_minutes: 60, buffer_after_minutes: 120 },
        locations: [
          {
            id: tenant.locationId,
            min_notice_hours: 24,
            booking_cutoff_minutes: 45,
            min_days_advance: 2,
          },
        ],
        products: [{ id: own.id, min_days_walkin: 3 }],
      });

      // In the order asked.
      const { data, error } = await inputs(db("driver", tenant), tenant, [
        helmet.id,
        own.id,
        plain.id,
      ]);
      expect(error, error?.message).toBeNull();
      expect(data).toEqual({
        shop: {
          currency: "USD",
          allow_overbooking: false,
          hold_minutes: 15,
          buffer_before_minutes: 60,
          buffer_after_minutes: 120,
        },
        location: {
          id: tenant.locationId,
          timezone: "America/New_York",
          min_notice_hours: 24,
          booking_cutoff_minutes: 45,
          min_days_advance: 2,
          min_days_walkin: null,
          hours: [1, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            open: "09:00:00",
            close: "18:30:00",
          })),
          closures: [
            {
              start_date: "2031-07-04",
              end_date: "2031-07-04",
              repeats_yearly: false,
            },
            {
              start_date: "2031-12-24",
              end_date: "2032-01-01",
              repeats_yearly: true,
            },
          ],
        },
        products: [
          // Gear: no buffers (the shop's default is for vehicles), no listing.
          {
            product_id: helmet.id,
            type: "gear",
            buffer_before_minutes: null,
            buffer_after_minutes: null,
            min_days_advance: null,
            min_days_walkin: null,
            listing: null,
          },
          // Its own "before"; the shop's "after".
          {
            product_id: own.id,
            type: "vehicle",
            buffer_before_minutes: 30,
            buffer_after_minutes: 120,
            min_days_advance: null,
            min_days_walkin: 3,
            listing: {
              enabled: true,
              instant_units: 1,
              request_units: 2,
              lead_time_hours: 12,
              ready_now: 0,
            },
          },
          {
            product_id: plain.id,
            type: "vehicle",
            buffer_before_minutes: 60,
            buffer_after_minutes: 120,
            min_days_advance: null,
            min_days_walkin: null,
            listing: null,
          },
        ],
      });
      // The server reads the same thing.
      expect(
        (await inputs(service, tenant, [helmet.id, own.id, plain.id])).data,
      ).toEqual(data);
    } finally {
      await deleteTenant(tenant);
    }
  }, 60_000);

  it("every member of the shop reads it, and the server; another shop's roles, a stranger and a signed-out visitor do not", async () => {
    const bike = await vehicle(0);
    for (const role of roles) {
      const mine = await inputs(db(role), shop, [bike.id]);
      expect(mine.error, `${role}: ${mine.error?.message}`).toBeNull();
      expect(mine.data!.products[0].product_id).toBe(bike.id);
      const theirs = await inputs(db(role, saigon), shop, [bike.id]);
      expect(theirs.error?.message, `Saigon's ${role}`).toBe("not_allowed");
      expect(theirs.error?.code).toBe("42501");
    }
    expect((await inputs(service, shop, [bike.id])).error).toBeNull();
    expect((await inputs(outsider.db, shop, [bike.id])).error?.message).toBe(
      "not_allowed",
    );
    const anon = await inputs(anonClient(), shop, [bike.id]);
    expect(anon.error?.code).toBe("42501");
    expect(anon.data).toBeNull();
  });

  it("another shop's product or place is answered exactly like a made-up one; a retired product too; what is not a request is refused", async () => {
    const mine = await vehicle(0);
    const theirs = await vehicle(0, { tenant: saigon });
    const madeUp = randomUUID();
    for (const client of [db("staff"), service]) {
      const a = await inputs(client, shop, [mine.id, theirs.id]);
      const b = await inputs(client, shop, [mine.id, madeUp]);
      expect(a.error).toEqual(b.error);
      expect(a.error?.message).toBe("product_not_found");
      const c = await inputs(client, shop, [mine.id], saigon.locationId);
      const d = await inputs(client, shop, [mine.id], madeUp);
      expect(c.error).toEqual(d.error);
      expect(c.error?.message).toBe("location_not_found");
    }
    const retired = await vehicle(0);
    await service
      .from("products")
      .update({ retired_at: new Date().toISOString() })
      .eq("id", retired.id)
      .throwOnError();
    expect((await inputs(service, shop, [retired.id])).error?.message).toBe(
      "product_not_found",
    );
    for (const products of [[], [mine.id, mine.id]]) {
      const { error } = await inputs(service, shop, products);
      expect(error?.message, JSON.stringify(products)).toBe("invalid_request");
    }
  });
});

describe("the shop's default buffers", () => {
  it("widen a vehicle's window when it has none of its own, each side on its own; gear is not widened; a later change moves no block", async () => {
    const tenant = await createTenant("rules-buffers");
    try {
      await rulesAs(tenant, {
        shop: { buffer_before_minutes: 60, buffer_after_minutes: 120 },
      });
      const plain = await vehicle(1, { tenant });
      const own = await vehicle(1, { tenant, before: 30 });
      const none = await vehicle(1, { tenant, before: 0, after: 0 });
      const helmet = await general("gear", 2, tenant);
      const window = { starts_at: at(10, 10), ends_at: at(11, 10) };
      booked(
        await pageBook(
          [plain, own, none, helmet].map((p) => ({
            product_id: p.id,
            ...window,
          })),
          { tenant },
        ),
      );
      const periodOf = async (productId: string) => {
        const [row] = await reservationsOf(productId);
        const [from, to] = (row.block_period as string)
          .replace(/[[\]()"]/g, "")
          .split(",")
          .map((t) =>
            new Date(t.replace(" ", "T").replace(/\+00$/, "Z")).toISOString(),
          );
        return `${from} to ${to}`;
      };
      const iso = (d: number, h: number, m = 0) =>
        new Date(at(d, h).getTime() + m * 60_000).toISOString();
      // The shop's hour before and two hours after.
      expect(await periodOf(plain.id)).toBe(`${iso(10, 9)} to ${iso(11, 12)}`);
      // Its own half hour before; the shop's two hours after.
      expect(await periodOf(own.id)).toBe(
        `${iso(10, 9, 30)} to ${iso(11, 12)}`,
      );
      // "No buffer" said on the product is its own choice.
      expect(await periodOf(none.id)).toBe(`${iso(10, 10)} to ${iso(11, 10)}`);
      expect(await periodOf(helmet.id)).toBe(
        `${iso(10, 10)} to ${iso(11, 10)}`,
      );

      // The availability read widens the same way: a rental that starts
      // inside the two hours after the return finds nothing free; one that
      // starts after the buffers of both (2 hours after, 1 before) does.
      const free = async (productId: string, from: Date, to: Date) => {
        const { data, error } = await service.rpc("availability", {
          p_tenant_id: tenant.id,
          p_items: [
            {
              product_id: productId,
              location_id: tenant.locationId,
              starts_at: from.toISOString(),
              ends_at: to.toISOString(),
            },
          ],
        });
        expect(error, error?.message).toBeNull();
        return (data as { free: number }[])[0].free;
      };
      expect(await free(plain.id, at(11, 12), at(12, 12))).toBe(0);
      expect(await free(plain.id, at(11, 13), at(12, 12))).toBe(1);
      expect(await free(none.id, at(11, 10), at(12, 12))).toBe(1);
      // And create_order() agrees with the read.
      expect(
        outcome(
          await pageBook(
            [{ product_id: plain.id, starts_at: at(11, 12), ends_at: at(12) }],
            { tenant },
          ),
        ),
      ).toBe("unavailable");

      // The buffers were copied onto the reservation: a new default moves nothing.
      const before = await periodOf(plain.id);
      await rulesAs(tenant, {
        shop: { buffer_before_minutes: null, buffer_after_minutes: 600 },
      });
      expect(await periodOf(plain.id)).toBe(before);
      // But the next rental is asked with the new ones: no hour before now.
      expect(await free(plain.id, at(11, 12), at(12, 12))).toBe(1);
    } finally {
      await deleteTenant(tenant);
    }
  }, 90_000);
});

describe("the Moto Mangos cap inside create_order()", () => {
  const window = (d = 1) => ({ starts_at: at(d), ends_at: at(d + 2) });

  it("a vehicle that is not listed, or whose listing is off, can't be booked through Moto Mangos at all; the shop's own page can", async () => {
    const unlisted = await vehicle(2);
    const off = await listedVehicle(2, { instant: 2, enabled: false });
    const before = written(shop);
    for (const bike of [unlisted, off]) {
      for (const mode of ["instant", "now"]) {
        const result = await mmBook([{ product_id: bike.id, ...window() }], {
          mode,
        });
        expect(result.data).toEqual({
          ok: false,
          reason: "not_listed",
          line: 0,
        });
      }
    }
    // A refusal writes nothing.
    expect(written(shop)).toBe(before);
    booked(await pageBook([{ product_id: unlisted.id, ...window() }]));
    booked(await staffBook("staff", [{ product_id: off.id, ...window() }]));
  });

  it("at most the Instant units out through Moto Mangos at once: the next is cap_reached, though scooters stand free", async () => {
    const bike = await listedVehicle(6, { instant: 2, request: 1 });
    booked(await mmBook([{ product_id: bike.id, ...window() }]));
    booked(await mmBook([{ product_id: bike.id, ...window() }]));
    const before = written(shop);
    const third = await mmBook([{ product_id: bike.id, ...window() }]);
    // The third would be a request booking, which waits for 3M.
    expect(third.data).toEqual({ ok: false, reason: "cap_reached", line: 0 });
    expect(written(shop)).toBe(before);
    expect(await blockCount(bike.id)).toBe(2);
    // Other days are another matter; so is a window that only touches.
    booked(await mmBook([{ product_id: bike.id, ...window(10) }]));
    booked(
      await mmBook([{ product_id: bike.id, starts_at: at(3), ends_at: at(4) }]),
    );
    // A window that overlaps either of the two is refused.
    expect(
      outcome(
        await mmBook([
          { product_id: bike.id, starts_at: at(2, 23), ends_at: at(5) },
        ]),
      ),
    ).toBe("cap_reached");
  });

  it("only Moto Mangos advance bookings count: the shop's own bookings and Ride today use scooters, not the cap; and Ride today is never refused by it", async () => {
    const bike = await listedVehicle(6, { instant: 1 });
    booked(await pageBook([{ product_id: bike.id, ...window() }]));
    booked(await staffBook("staff", [{ product_id: bike.id, ...window() }]));
    booked(
      await mmBook([{ product_id: bike.id, ...window() }], { mode: "now" }),
    );
    // Three scooters are out and the cap is untouched.
    booked(await mmBook([{ product_id: bike.id, ...window() }]));
    expect(outcome(await mmBook([{ product_id: bike.id, ...window() }]))).toBe(
      "cap_reached",
    );
    // With the cap full, a walk-in still rides away.
    booked(
      await mmBook([{ product_id: bike.id, ...window() }], { mode: "now" }),
    );
    expect((await reservationsOf(bike.id)).map((r) => r.mode).sort()).toEqual([
      "instant",
      "instant",
      "now",
      "now",
      "staff",
    ]);
  });

  it("a hold takes a place until it runs out; a cancelled booking gives its place back", async () => {
    const bike = await listedVehicle(4, { instant: 1 });
    const hold = booked(
      await mmBook([{ product_id: bike.id, ...window() }], { hold: true }),
    );
    expect(outcome(await mmBook([{ product_id: bike.id, ...window() }]))).toBe(
      "cap_reached",
    );
    // Its time runs out, as the clock would run it.
    // A second ago by the database's clock, which is the one that judges.
    // (The order carries the hold's expiry now, and its reservations a copy.)
    expect(
      sql(`
        update platform.orders
        set hold_expires_at = clock_timestamp() - interval '1 second'
        where id = '${hold.booking_id}';
        update platform.reservations
        set hold_expires_at = (select o.hold_expires_at from platform.orders o where o.id = '${hold.booking_id}')
        where booking_id = '${hold.booking_id}';
      `).failed,
    ).toBe("");
    const next = booked(await mmBook([{ product_id: bike.id, ...window() }]));
    expect(outcome(await mmBook([{ product_id: bike.id, ...window() }]))).toBe(
      "cap_reached",
    );
    const cancelled = await cancelOrder(service, shop.id, next.booking_id);
    expect(cancelled.data).toMatchObject({ ok: true });
    booked(await mmBook([{ product_id: bike.id, ...window() }]));
  });

  it("a booking of several, and two lines for one scooter model, are counted together", async () => {
    const bike = await listedVehicle(6, { instant: 3 });
    booked(await mmBook([{ product_id: bike.id, ...window() }]));
    const before = written(shop);
    // Two places left.
    expect(
      (await mmBook([{ product_id: bike.id, ...window(), quantity: 3 }])).data,
    ).toEqual({ ok: false, reason: "cap_reached", line: 0 });
    expect(
      (
        await mmBook([
          { product_id: bike.id, ...window(), quantity: 2 },
          { product_id: bike.id, ...window() },
        ])
      ).data,
    ).toEqual({ ok: false, reason: "cap_reached", line: 1 });
    expect(written(shop)).toBe(before);
    // Lines for other days don't add up.
    booked(
      await mmBook([
        { product_id: bike.id, ...window(), quantity: 2 },
        { product_id: bike.id, ...window(20), quantity: 3 },
      ]),
    );
  });

  it("helmets booked with the scooter have no listing and no cap; the scooter's cap still refuses the whole booking", async () => {
    const bike = await listedVehicle(4, { instant: 1 });
    const helmet = await general("gear", 5);
    const lines = () => [
      { product_id: bike.id, ...window() },
      { product_id: helmet.id, ...window(), quantity: 2, parent: 0 },
    ];
    const first = booked(await mmBook(lines()));
    expect(first.lines.map((l) => l.unit_ids.length)).toEqual([1, 2]);
    const before = written(shop);
    expect((await mmBook(lines())).data).toEqual({
      ok: false,
      reason: "cap_reached",
      line: 0,
    });
    // All or nothing: no helmet was taken for the refused booking.
    expect(written(shop)).toBe(before);
  });

  it("the shop's real stock still has the first word: unavailable when nothing is free, whatever the cap says", async () => {
    const bike = await listedVehicle(1, { instant: 1, request: 0 });
    booked(await staffBook("staff", [{ product_id: bike.id, ...window() }]));
    expect(outcome(await mmBook([{ product_id: bike.id, ...window() }]))).toBe(
      "unavailable",
    );
  });

  it("the cap is the product's, across its places", async () => {
    const bike = await listedVehicle(2, { instant: 1 });
    const second = await branch(shop, "Asia/Bangkok");
    await addUnits(bike.id, 2, shop, second);
    booked(
      await mmBook([{ product_id: bike.id, location_id: second, ...window() }]),
    );
    expect(outcome(await mmBook([{ product_id: bike.id, ...window() }]))).toBe(
      "cap_reached",
    );
    // The shop's own page books the other place's scooters freely.
    booked(await pageBook([{ product_id: bike.id, ...window() }]));
  });

  it("another shop's listed scooter: the server naming the wrong shop is answered product_not_found, as for a made-up one", async () => {
    const theirs = await listedVehicle(2, { instant: 2 }, saigon);
    const a = await mmBook([{ product_id: theirs.id, ...window() }]);
    const b = await mmBook([{ product_id: randomUUID(), ...window() }]);
    expect(a.error).toEqual(b.error);
    expect(a.error?.message).toBe("product_not_found");
    expect(await reservationsOf(theirs.id)).toEqual([]);
  });

  it("two bookings of one scooter model for two places take turns at the listing's row: the second is seen waiting with its own product lock in hand, then refused", async () => {
    const bike = await listedVehicle(2, { instant: 1 });
    const second = await branch(shop, "Asia/Bangkok");
    await addUnits(bike.id, 2, shop, second);
    const before = deadlocks();
    const marker = `cap-two-places-${tag}`;
    const lineAt = (location: string) =>
      orderSql(
        shop.id,
        request(shop, "marketplace", "instant", [
          { product_id: bike.id, location_id: location, ...window() },
        ]).p_request,
      );
    // The first booking, made and not yet saved: it waits at its gate, its
    // locks held, until the second has been seen waiting.
    const gate = await closedGate();
    const holder = sqlBackground(`
      begin;
      ${asServer}
      select ${lineAt(shop.locationId)} ->> 'ok';
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    const call = mmBook([
      { product_id: bike.id, location_id: second, ...window() },
    ]);
    const seen = await until(`
      select 'waiting for a row, product locks: ' || (
        select count(*) from pg_locks g
        where g.pid = w.pid and g.locktype = 'advisory' and g.granted
          and g.classid = x'1a02'::int
      ) || ', unit locks: ' || (
        select count(*) from pg_locks g
        where g.pid = w.pid and g.locktype = 'advisory' and g.granted
          and g.classid = x'1a01'::int
      )
      from pg_locks w
      join pg_stat_activity a on a.pid = w.pid
      where w.locktype in ('transactionid', 'tuple') and not w.granted
        and a.query like '%create_order%' and a.query not like '%${marker}%'
        and a.pid <> pg_backend_pid()
      limit 1;
    `);
    await gate.open();
    // Two places, two product-and-location locks: the advisory locks did
    // not make it wait. The listing's row does.
    expect(seen).toBe("waiting for a row, product locks: 1, unit locks: 1");
    const held = await holder;
    expect(held.failed).toBe("");
    expect(held.out).toContain("true");
    const result = await call;
    expect(result.data).toEqual({ ok: false, reason: "cap_reached", line: 0 });
    noDeadlock([result]);
    expect(deadlocks()).toBe(before);
    expect(await blockCount(bike.id)).toBe(1);
  }, 60_000);
});

describe("confirm_order() for a Moto Mangos hold: under the listing's row, its expiry judged once it holds it", () => {
  const window = { starts_at: at(1), ends_at: at(3) };
  const confirmSql = (booking: string) =>
    `select 'confirm: ' || coalesce(platform.confirm_order('${shop.id}', '${booking}') ->> 'reason', 'ok');`;
  /**
   * Runs a booking's hold out at this very moment, by the database's own
   * clock, as the superuser: to a transaction already open the expiry is
   * after its start, and to everything that follows it is past.
   */
  const runOutNow = (booking: string) => {
    // The order carries the expiry that confirm_order() judges; its
    // reservations carry the copy the sweep and the cap read. Both, the same.
    const { failed } = sql(`
      update platform.orders set hold_expires_at = clock_timestamp() where id = '${booking}';
      update platform.reservations
        set hold_expires_at = (select o.hold_expires_at from platform.orders o where o.id = '${booking}')
        where booking_id = '${booking}';
    `);
    expect(failed).toBe("");
  };
  /**
   * The minute's sweep (pg_cron) releases a hold that has run out whenever
   * it comes by, and a scene that needs such a hold left alone can't keep
   * it away. So the scene is not timed to miss it: it is run with a scooter
   * of its own, and again with a new one if the sweep is seen to have
   * taken its hold (a reservation in state expired). The job can't meet two
   * runs within its minute; the third run is for a sweep some other test
   * file called meanwhile. Since Phase 3 stage 2b a confirm that finds its
   * hold run out settles it, which leaves an expired reservation too: so a
   * scene that fails after such a confirm is run again as well, and its
   * failure is thrown from the third run.
   */
  async function leftAloneByTheSweep(
    scene: (bike: { id: string; units: string[] }) => Promise<void>,
  ) {
    for (let attempt = 0; ; attempt++) {
      const bike = await listedVehicle(3, { instant: 1 });
      try {
        return await scene(bike);
      } catch (error) {
        const swept = (await reservationsOf(bike.id)).some(
          (r) => r.state === "expired",
        );
        if (attempt > 1 || !swept) throw error;
      }
    }
  }

  // Since stage 8 (20261118000100, review of PR 48) every hold is judged by
  // the clock once the locks are held: a hold that has run out holds no
  // coupon use, so one confirmed after that moment would bring a use back.
  // Before, a hold of the shop's own page was judged by when the call began.
  it("a confirm that began before the expiry and reaches the row after it is refused, by the clock, for a Moto Mangos hold and for a hold of the shop's own page alike", async () => {
    await leftAloneByTheSweep(async (bike) => {
      const mm = booked(
        await mmBook([{ product_id: bike.id, ...window }], { hold: true }),
      );
      const page = booked(
        await pageBook([{ product_id: bike.id, ...window }], { hold: true }),
      );
      // One call each, begun now, that gets to its work only when the gate
      // is opened: after its hold has run out.
      const gate = await closedGate();
      const mmMarker = `late-mm-${tag}-${++counter}`;
      const pageMarker = `late-page-${tag}-${++counter}`;
      const late = (booking: string, marker: string) =>
        sqlBackground(`
          begin;
          ${asServer}
          select now();
          ${gate.wait(marker)}
          select 'began before the expiry: ' || (now() < min(hold_expires_at))
            from platform.reservations where booking_id = '${booking}';
          ${confirmSql(booking)}
          commit;
        `);
      try {
        const answers = Promise.all([
          late(mm.booking_id, mmMarker),
          late(page.booking_id, pageMarker),
        ]);
        await holding(mmMarker);
        await holding(pageMarker);
        // Both have begun. Their holds run out now, before either is at
        // its work.
        runOutNow(mm.booking_id);
        runOutNow(page.booking_id);
        await gate.open();
        const [mmAnswer, pageAnswer] = await answers;
        expect(mmAnswer.failed).toBe("");
        expect(mmAnswer.out).toContain("began before the expiry: true");
        expect(mmAnswer.out).toContain("confirm: hold_expired");
        expect(pageAnswer.failed).toBe("");
        expect(pageAnswer.out).toContain("began before the expiry: true");
        expect(pageAnswer.out).toContain("confirm: hold_expired");
        const states = (await reservationsOf(bike.id)).map(
          (r) => `${r.channel} ${r.state}`,
        );
        // Phase 3 stage 2b: a confirm that finds the hold run out settles
        // it (an online order is canceled, its reservations expired);
        // Phase 2 left the rows held for the sweep.
        expect(states.sort()).toEqual([
          "booking_page expired",
          "marketplace expired",
        ]);
      } finally {
        await gate.open();
      }
    });
  }, 60_000);

  it("a confirm in flight at the expiry instant: a new booking begun after the expiry waits at the listing's row, then counts the confirmed hold and is refused; the cap is not passed", async () => {
    const bike = await listedVehicle(3, { instant: 1 });
    // The new booking is for another place of the same shop: it shares no
    // product lock with the confirm, only the listing.
    const second = await branch(shop, "Asia/Bangkok");
    await addUnits(bike.id, 2, shop, second);
    const hold = booked(
      await mmBook([{ product_id: bike.id, ...window }], { hold: true }),
    );
    const before = deadlocks();
    const marker = `confirm-in-flight-${tag}`;
    // The confirm is in time, and not yet saved when the hold's time is up:
    // it waits at its gate. Its own session sets the expiry, one second on
    // by the database's clock, in the statement before it confirms, so
    // nothing but that one step has to fit inside the second.
    const gate = await closedGate();
    const holder = sqlBackground(`
      update platform.orders
        set hold_expires_at = clock_timestamp() + interval '1 second'
        where id = '${hold.booking_id}';
      update platform.reservations
        set hold_expires_at = (select o.hold_expires_at from platform.orders o where o.id = '${hold.booking_id}')
        where booking_id = '${hold.booking_id}';
      begin;
      ${asServer}
      ${confirmSql(hold.booking_id)}
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    // The hold's time is up, by the database's clock (the confirm is not
    // saved, so the row still reads as a hold and carries its expiry).
    // The poll looks for longer than the hold lasts (one second, and ten
    // more), so it can't give up before the hold is over.
    await until(
      `
      select 'run out' from platform.reservations
      where booking_id = '${hold.booking_id}' and state = 'held'
        and hold_expires_at < clock_timestamp()
      limit 1;
    `,
      11_000,
    );
    // To this booking the hold has run out: it does not count it.
    const call = mmBook([
      { product_id: bike.id, location_id: second, ...window },
    ]);
    const seen = await until(`
      select 'waiting for a row'
      from pg_locks w
      join pg_stat_activity a on a.pid = w.pid
      where w.locktype in ('transactionid', 'tuple') and not w.granted
        and a.query like '%create_order%' and a.query not like '%${marker}%'
        and a.pid <> pg_backend_pid()
      limit 1;
    `);
    await gate.open();
    expect(seen).toBe("waiting for a row");
    const held = await holder;
    expect(held.failed).toBe("");
    expect(held.out).toContain("confirm: ok");
    const result = await call;
    expect(result.data).toEqual({ ok: false, reason: "cap_reached", line: 0 });
    noDeadlock([result]);
    expect(deadlocks()).toBe(before);
    expect(
      (await reservationsOf(bike.id)).map((r) => `${r.mode} ${r.state}`),
    ).toEqual(["instant reserved"]);
    expect(await blockCount(bike.id)).toBe(1);
  }, 60_000);

  it("the other way round: the confirm begins before the expiry; a new booking at a second place, begun after it, takes the listing's row first; the confirm is seen waiting at that row and is then refused; the cap is not passed", async () => {
    await leftAloneByTheSweep(otherWayRound);
  }, 60_000);

  async function otherWayRound(bike: { id: string; units: string[] }) {
    // The new booking is for another place of the same shop: it shares no
    // product lock with the confirm, only the listing. (At the same place
    // the product lock alone would make the two take turns.)
    const second = await branch(shop, "Asia/Bangkok");
    await addUnits(bike.id, 2, shop, second);
    const hold = booked(
      await mmBook([{ product_id: bike.id, ...window }], { hold: true }),
    );
    const before = deadlocks();
    // Each of the two waits at a gate of its own.
    const confirmGate = await closedGate();
    const bookingGate = await closedGate();
    try {
      // The confirm: its transaction begins now, in time, and gets to its
      // work when its gate is opened, after the hold has run out and the
      // booking below has the listing's row.
      const began = `confirm-begun-${tag}-${++counter}`;
      const confirm = sqlBackground(`
        begin;
        ${confirmGate.wait(began)}
        select 'began in time: ' || (now() < min(hold_expires_at))
          from platform.reservations where booking_id = '${hold.booking_id}';
        ${asServer}
        ${confirmSql(hold.booking_id)}
        select 'judged at: ' || (clock_timestamp() > min(hold_expires_at))
          from platform.reservations where booking_id = '${hold.booking_id}';
        commit;
      `);
      await holding(began);
      // The hold runs out now: after the confirm began, before its work.
      runOutNow(hold.booking_id);

      // The booking, begun after the expiry: to it the hold has run out, so
      // it does not count it, takes the cap's one place and is not yet saved.
      const marker = `booking-in-flight-${tag}-${++counter}`;
      const body = orderSql(
        shop.id,
        request(shop, "marketplace", "instant", [
          { product_id: bike.id, location_id: second, ...window },
        ]).p_request,
      );
      const booking = sqlBackground(`
        begin;
        ${asServer}
        select 'booking: ' || (${body} ->> 'ok');
        ${bookingGate.wait(marker)}
        commit;
      `);
      await holding(marker);
      // The confirm has not got to its work yet: the booking was first.
      expect(
        (
          await watch(
            `select count(*) from pg_stat_activity where state = 'active' and query like '%${began}%' and pid <> pg_backend_pid();`,
          )
        ).out,
        "the confirm left its gate before the booking was in place",
      ).toBe("1");
      // The booking did not release the hold (it is another place's), so the
      // only thing between the confirm and the cap is the listing's row.
      expect((await reservationsOf(bike.id)).map((r) => r.state)).toEqual([
        "held",
      ]);

      // The confirm reaches its work and stops at the listing's row: it has
      // the row's tuple lock and waits for the booking's transaction.
      // (Polled until it is seen, or until the confirm has answered without
      // ever waiting, which is what it does with the listing's row left out.)
      let answered = false;
      void confirm.then(() => (answered = true));
      await confirmGate.open();
      let seen = "";
      while (!seen && !answered) {
        seen = (
          await watch(`
      select 'waiting at the listing''s row'
      from pg_locks w
      join pg_stat_activity a on a.pid = w.pid
      where not w.granted
        and a.query like '%confirm_order%'
        and a.pid <> pg_backend_pid()
        and (
          (w.locktype = 'tuple'
            and w.relation = 'platform.product_listings'::regclass)
          or (w.locktype = 'transactionid' and exists (
            select 1 from pg_locks t
            where t.pid = w.pid and t.granted and t.locktype = 'tuple'
              and t.relation = 'platform.product_listings'::regclass))
        )
      limit 1;
    `)
        ).out;
        if (!seen) await new Promise((r) => setTimeout(r, 25));
      }
      expect
        .soft(seen, "the confirm answered without waiting at the listing's row")
        .toBe("waiting at the listing's row");
      // And it waits for that booking, not for anything else.
      expect
        .soft(
          (
            await watch(`
        select count(*) from pg_stat_activity a
        where a.query like '%confirm_order%' and a.pid <> pg_backend_pid()
          and pg_blocking_pids(a.pid) = array(
            select b.pid from pg_stat_activity b
            where b.query like '%${marker}%' and b.pid <> pg_backend_pid());
      `)
          ).out,
          "the confirm is not waiting for the booking",
        )
        .toBe("1");

      await bookingGate.open();
      const booked_ = await booking;
      expect(booked_.failed).toBe("");
      expect(booked_.out).toContain("booking: true");
      const confirmed = await confirm;
      expect(confirmed.failed).toBe("");
      expect(confirmed.out).toContain("began in time: true");
      expect(confirmed.out).toContain("judged at: true");
      expect(confirmed.out).toContain("confirm: hold_expired");
      expect(confirmed.out).not.toContain("confirm: ok");
      expect(deadlocks()).toBe(before);

      // One place under the cap, one booking: the new one. The hold was
      // never confirmed. (Phase 3 stage 2b: the refused confirm settled it,
      // so its row is expired; Phase 2 left it held for the sweep.)
      const rows = await reservationsOf(bike.id);
      expect(
        rows.map((r) => `${r.location_id === second} ${r.state}`).sort(),
      ).toEqual(["false expired", "true reserved"]);
      expect(rows.filter((r) => r.state === "reserved")).toHaveLength(1);
    } finally {
      await confirmGate.open();
      await bookingGate.open();
    }
  }
});

describe("races for the cap's last place", () => {
  it(`two online bookings for the cap's last place, at one place: exactly one success and one cap_reached, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      // Plenty of scooters: only the cap can refuse.
      const bike = await listedVehicle(4, { instant: 1 }, tenant);
      for (let round = 0; round < ROUNDS; round++) {
        const line = {
          product_id: bike.id,
          starts_at: at(round * 3),
          ends_at: at(round * 3 + 2),
        };
        const results = await Promise.all([
          mmBook([line], { tenant }),
          mmBook([line], { tenant }),
        ]);
        raceRounds++;
        noDeadlock(results);
        expect(results.map(outcome).sort(), `${where} round ${round}`).toEqual([
          "cap_reached",
          "ok",
        ]);
      }
      const rows = await reservationsOf(bike.id);
      expect(rows, where).toHaveLength(ROUNDS);
      expect(await blockCount(bike.id), where).toBe(ROUNDS);
    }
  }, 180_000);

  it(`the same at two places of one shop, where the two bookings share no product lock: exactly one success, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      const bike = await listedVehicle(2, { instant: 1 }, tenant);
      const second = await branch(
        tenant,
        tenant === newYork ? "America/Los_Angeles" : "Asia/Bangkok",
      );
      await addUnits(bike.id, 2, tenant, second);
      for (let round = 0; round < ROUNDS; round++) {
        const line = (location_id: string) => ({
          product_id: bike.id,
          location_id,
          starts_at: at(round * 3),
          ends_at: at(round * 3 + 2),
        });
        const results = await Promise.all([
          mmBook([line(tenant.locationId)], { tenant }),
          mmBook([line(second)], { tenant }),
        ]);
        raceRounds++;
        noDeadlock(results);
        expect(results.map(outcome).sort(), `${where} round ${round}`).toEqual([
          "cap_reached",
          "ok",
        ]);
      }
      expect(await reservationsOf(bike.id), where).toHaveLength(ROUNDS);
      expect(await blockCount(bike.id), where).toBe(ROUNDS);
    }
  }, 180_000);

  it(`six bookings at once for a cap of two: exactly two succeed, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      const bike = await listedVehicle(6, { instant: 2 }, tenant);
      for (let round = 0; round < ROUNDS; round++) {
        const line = {
          product_id: bike.id,
          starts_at: at(round * 3),
          ends_at: at(round * 3 + 2),
        };
        const results = await Promise.all(
          Array.from({ length: 6 }, () => mmBook([line], { tenant })),
        );
        raceRounds++;
        noDeadlock(results);
        expect(
          results.map(outcome).sort().join(","),
          `${where} round ${round}`,
        ).toBe("cap_reached,cap_reached,cap_reached,cap_reached,ok,ok");
      }
      expect(await blockCount(bike.id), where).toBe(ROUNDS * 2);
    }
  }, 240_000);

  it(`a booking for the last place against the owner taking the listing off Moto Mangos, and against a save of the scooter's booking rules: no deadlock, and never a booking on a listing that was already off, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      const bike = await listedVehicle(3, { instant: 1 }, tenant);
      for (let round = 0; round < ROUNDS; round++) {
        await forceListing(tenant.id, bike.id, { marketplace_listed: true });
        const line = {
          product_id: bike.id,
          starts_at: at(round * 3),
          ends_at: at(round * 3 + 2),
        };
        const [booking, listing, rules] = await Promise.all([
          mmBook([line], { tenant }),
          Promise.resolve(
            db("owner", tenant).rpc("save_listing", {
              p_product_id: bike.id,
              p_settings: { enabled: false },
            }),
          ),
          saveRules(db("manager", tenant), tenant, {
            products: [{ id: bike.id, min_days_advance: 1 + (round % 3) }],
          }),
        ]);
        raceRounds++;
        noDeadlock([booking, listing, rules]);
        expect(listing.error, listing.error?.message).toBeNull();
        expect(rules.error, rules.error?.message).toBeNull();
        // The booking got in before the switch, or was told the listing is off.
        expect(["ok", "not_listed"], `${where} round ${round}`).toContain(
          outcome(booking),
        );
        // The switch is off now, whoever was first: the next one is refused.
        expect(
          outcome(
            await mmBook([{ ...line, starts_at: at(900), ends_at: at(901) }], {
              tenant,
            }),
          ),
        ).toBe("not_listed");
      }
    }
  }, 240_000);

  it(`a hold confirmed at the very moment it runs out, against a new booking for the cap's last place: never both, ${ROUNDS} rounds a shop`, async () => {
    for (const [where, tenant] of everyShop()) {
      const bike = await listedVehicle(4, { instant: 1 }, tenant);
      // The booking is for a second place, so that only the listing's row
      // stands between it and the confirm.
      const second = await branch(
        tenant,
        tenant === newYork ? "America/Los_Angeles" : "Asia/Bangkok",
      );
      await addUnits(bike.id, 2, tenant, second);
      for (let round = 0; round < ROUNDS; round++) {
        const line = {
          product_id: bike.id,
          starts_at: at(round * 3),
          ends_at: at(round * 3 + 2),
        };
        const hold = booked(await mmBook([line], { tenant, hold: true }));
        // The hold runs out a few milliseconds from now, a little later
        // from round to round, and both are sent at once: they arrive
        // around the expiry, either side of it. Nothing waits for the
        // clock, and whichever side they land is one of the answers below.
        const expires = new Date(Date.now() + 10 + (round % 5) * 15);
        // On the order, which confirm_order() judges, and on its
        // reservations, which the cap and the sweep read.
        await service
          .from("orders")
          .update({ hold_expires_at: expires.toISOString() })
          .eq("id", hold.booking_id)
          .throwOnError();
        await service
          .from("reservations")
          .update({ hold_expires_at: expires.toISOString() })
          .eq("booking_id", hold.booking_id)
          .throwOnError();
        const [confirmed, booking] = await Promise.all([
          Promise.resolve(
            service.rpc("confirm_order", {
              p_tenant_id: tenant.id,
              p_order_id: hold.booking_id,
            }),
          ) as Promise<Result>,
          mmBook([{ ...line, location_id: second }], { tenant }),
        ]);
        raceRounds++;
        noDeadlock([confirmed, booking]);
        const pair = `${outcome(confirmed)} / ${outcome(booking)}`;
        expect(
          [
            "ok / cap_reached",
            "hold_expired / ok",
            "hold_expired / cap_reached",
          ],
          `${where} round ${round}`,
        ).toContain(pair);
      }
      // Over all the rounds: never more reserved than rounds.
      const reserved = (await reservationsOf(bike.id)).filter(
        (r) => r.state === "reserved",
      );
      expect(reserved.length, where).toBeLessThanOrEqual(ROUNDS);
    }
  }, 240_000);

  it("no deadlock was detected by Postgres anywhere in this file's races", () => {
    expect(raceRounds).toBe(ROUNDS * 3 * 5);
    expect(deadlocks()).toBe(deadlocksBefore);
  });
});

describe("bookOnline(): the one server entry point, against the database", () => {
  let tenant: TestTenant;
  let bike: { id: string; units: string[] };
  /** The server's client on the platform schema, as bookOnline() makes it. */
  const server = service as unknown as OnlineDb;
  // Bangkok is UTC+7: 04:00 UTC is 11:00 at the shop. 1 January 2032 is a Thursday.
  const pickup = (d: number, h = 4) => at(d, h);
  const now = () => new Date();

  const ask = (
    lines: OnlineBookingRequest["lines"],
    over: Partial<OnlineBookingRequest> = {},
  ): OnlineBookingRequest => ({
    tenantId: tenant.id,
    locationId: tenant.locationId,
    channel: "booking_page",
    mode: "instant",
    lines,
    ...over,
  });
  const one = (d: number, days = 2, h = 4) => [
    {
      productId: bike.id,
      start: pickup(d, h),
      end: pickup(d + days, h),
      quantity: 1,
    },
  ];

  beforeAll(async () => {
    tenant = await createTenant("rules-online", {
      country: "TH",
      currency: "THB",
      locale: "th-TH",
      timezone: "Asia/Bangkok",
    });
    // Open 10:00 to 18:00 every day but Sunday; closed 13 to 15 April every year.
    await service
      .from("location_hours")
      .insert(everyDay("10:00", "18:00", tenant).filter((h) => h.weekday !== 0))
      .throwOnError();
    await service
      .from("location_closures")
      .insert({
        tenant_id: tenant.id,
        location_id: tenant.locationId,
        start_date: "2030-04-13",
        end_date: "2030-04-15",
        repeats_yearly: true,
      })
      .throwOnError();
    bike = await vehicle(2, { tenant });
    await priceByDay(bike.id, 30_000, tenant);
  }, 120_000);

  afterAll(async () => {
    await deleteTenant(tenant);
  });

  it("a closed day, too little notice and too short a rental: each answers its reason and the database is unchanged", async () => {
    await rulesAs(tenant, {
      locations: [
        { id: tenant.locationId, min_notice_hours: 48, min_days_advance: 3 },
      ],
    });
    const before = written(tenant);
    const refused = async (
      lines: OnlineBookingRequest["lines"],
      when: () => Date = now,
    ) => {
      const answer = await bookOnline(ask(lines), { db: server, now: when });
      return answer.ok ? "ok" : `${answer.reason} @ ${answer.line}`;
    };
    // 4 January 2032 is a Sunday: no hours.
    expect(await refused(one(3, 3))).toBe("outside_hours @ 0");
    // 08:00 at the shop: two hours before it opens.
    expect(await refused(one(5, 3, 1))).toBe("outside_hours @ 0");
    // Back on 14 April, in the Songkran closure.
    expect(
      await refused([
        { productId: bike.id, start: at(102, 4), end: at(104, 4), quantity: 1 },
      ]),
    ).toBe("outside_hours @ 0");
    // Two days, where the shop asks for three.
    expect(await refused(one(5, 2))).toBe("too_short @ 0");
    // Three days, asked for 47 hours before the pickup.
    const tooLate = () => new Date(pickup(5).getTime() - 47 * 3_600_000);
    expect(await refused(one(5, 3), tooLate)).toBe("too_soon @ 0");
    // Nothing was reserved, held, blocked or logged by any of them.
    expect(written(tenant)).toBe(before);

    // The same booking with the rules met goes through, and is there.
    const answer = await bookOnline(ask(one(5, 3)), { db: server, now });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    // Three days at 300.00.
    expect(answer.quote.totals.total).toBe(BigInt(90_000));
    const [row] = await reservationsOf(bike.id);
    expect(row).toMatchObject({
      booking_id: answer.bookingId,
      channel: "booking_page",
      mode: "instant",
      state: "reserved",
      created_by: null,
    });
    expect(written(tenant)).not.toBe(before);
    await rulesAs(tenant, {
      locations: [
        {
          id: tenant.locationId,
          min_notice_hours: null,
          min_days_advance: null,
        },
      ],
    });
  }, 60_000);

  it("a product with no price can't be priced: nothing is booked, at zero or otherwise", async () => {
    const unpriced = await vehicle(1, { tenant });
    const before = written(tenant);
    const answer = await bookOnline(
      ask([
        { productId: bike.id, start: pickup(40), end: pickup(42), quantity: 1 },
        {
          productId: unpriced.id,
          start: pickup(40),
          end: pickup(42),
          quantity: 1,
        },
      ]),
      { db: server, now },
    );
    expect(answer).toEqual({ ok: false, reason: "cant_be_priced", line: 1 });
    expect(written(tenant)).toBe(before);
    expect(await reservationsOf(unpriced.id)).toEqual([]);
  });

  it("nothing free: unavailable from the read, and the database is unchanged; a hold is made as a hold", async () => {
    const single = await vehicle(1, { tenant });
    await priceByDay(single.id, 10_000, tenant);
    const lines = [
      { productId: single.id, start: pickup(54), end: pickup(56), quantity: 1 },
    ];
    const hold = await bookOnline(ask(lines, { hold: true }), {
      db: server,
      now,
    });
    expect(hold.ok && hold.holdExpiresAt).toBeTruthy();
    expect((await reservationsOf(single.id))[0].state).toBe("held");
    const before = written(tenant);
    expect(await bookOnline(ask(lines), { db: server, now })).toEqual({
      ok: false,
      reason: "unavailable",
      line: 0,
    });
    expect(written(tenant)).toBe(before);
  });

  it("Moto Mangos through the entry point: the listing's lead time binds, then the cap", async () => {
    const listed = await listedVehicle(3, { instant: 1 }, tenant);
    await priceByDay(listed.id, 20_000, tenant);
    await service
      .from("product_listings")
      .update({ lead_time_hours: 72 })
      .eq("product_id", listed.id)
      .throwOnError();
    const lines = [
      { productId: listed.id, start: pickup(60), end: pickup(62), quantity: 1 },
    ];
    const mm = (when: () => Date) =>
      bookOnline(ask(lines, { channel: "marketplace" }), {
        db: server,
        now: when,
      });
    const before = written(tenant);
    const twoDaysBefore = () => new Date(pickup(60).getTime() - 48 * 3_600_000);
    expect(await mm(twoDaysBefore)).toEqual({
      ok: false,
      reason: "too_soon",
      line: 0,
    });
    // The shop's own page is not bound by the listing's lead time.
    expect(written(tenant)).toBe(before);
    expect((await mm(now)).ok).toBe(true);
    const after = written(tenant);
    expect(await mm(now)).toEqual({
      ok: false,
      reason: "cap_reached",
      line: 0,
    });
    expect(written(tenant)).toBe(after);
    // Not listed at all.
    expect(
      await bookOnline(ask(one(70), { channel: "marketplace" }), {
        db: server,
        now,
      }),
    ).toEqual({ ok: false, reason: "not_listed", line: 0 });
    expect(written(tenant)).toBe(after);
  });

  it("the location's own clock decides, from its row: in New York the same UTC time is open on the day the clocks went forward and shut the day before", async () => {
    await service
      .from("location_hours")
      .insert(everyDay("09:00", "18:00", newYork))
      .throwOnError();
    const scooter = await vehicle(2, { tenant: newYork });
    await priceByDay(scooter.id, 4_500, newYork);
    // Clocks go forward on Sunday 14 March 2032. 13:30 UTC is 08:30 on the
    // 13th (EST) and 09:30 on the 14th (EDT).
    const at1330 = (day: number) => new Date(Date.UTC(2032, 2, day, 13, 30));
    const book = (day: number) =>
      bookOnline(
        {
          tenantId: newYork.id,
          locationId: newYork.locationId,
          channel: "booking_page",
          mode: "instant",
          lines: [
            {
              productId: scooter.id,
              start: at1330(day),
              end: new Date(Date.UTC(2032, 2, day + 3, 15, 0)),
              quantity: 1,
            },
          ],
        },
        { db: server, now },
      );
    const before = written(newYork);
    expect(await book(13)).toEqual({
      ok: false,
      reason: "outside_hours",
      line: 0,
    });
    expect(written(newYork)).toBe(before);
    const answer = await book(14);
    expect(answer.ok).toBe(true);
    // 09:30 on the 14th to 11:00 on the 17th: four started days at 45.00.
    expect(answer.ok && answer.quote.totals.total).toBe(BigInt(18_000));
    await service
      .from("location_hours")
      .delete()
      .eq("location_id", newYork.locationId)
      .throwOnError();
  }, 60_000);

  it("a lock that can't be had in time, through the API: create_order() gives up after its own 6 seconds with 55P03, before the API's 8-second limit, and bookOnline() answers try_again with nothing written", async () => {
    const single = await vehicle(1, { tenant });
    await priceByDay(single.id, 10_000, tenant);
    const marker = `lock-timeout-${tag}`;
    // Someone holds this product's lock for longer than anyone should
    // wait: until both calls below have given up and answered.
    const gate = await closedGate();
    const holder = sqlBackground(`
      begin;
      select platform_private.lock_products_stock(
        array['${single.id}']::uuid[], array['${tenant.locationId}']::uuid[]);
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    const before = written(tenant);
    const lines = [
      { productId: single.id, start: pickup(82), end: pickup(84), quantity: 1 },
    ];
    // The same call twice, at once, both through the API as the server:
    // what the database itself says, and what the entry point makes of it.
    const [raw, answer] = await Promise.all([
      createOrder(
        service,
        tenant.id,
        request(tenant, "booking_page", "instant", [
          { product_id: single.id, starts_at: pickup(82), ends_at: pickup(84) },
        ]).p_request,
      ),
      bookOnline(ask(lines), { db: server, now }),
    ]);
    // Both have answered with the lock still held; now it is let go.
    await gate.open();
    // lock_not_available, not the statement timeout (57014): create_order()'s
    // own limit ran out first, before the API's 8 seconds.
    expect(raw.error?.code).toBe("55P03");
    expect(raw.error?.message).toMatch(/lock timeout/);
    expect(answer).toEqual({ ok: false, reason: "try_again", line: null });
    // And that limit is the function's own 6 seconds: read, not timed.
    expect(
      sql(
        `select array_to_string(proconfig, ',') from pg_proc where oid = 'platform.create_order(uuid, jsonb)'::regprocedure;`,
      ).out.split(","),
    ).toContain("lock_timeout=6s");
    expect(written(tenant)).toBe(before);
    expect((await holder).failed).toBe("");
    // Sent again once the lock is free, it goes through.
    expect((await bookOnline(ask(lines), { db: server, now })).ok).toBe(true);
  }, 60_000);

  it("Ride today through the entry point: Moto Mangos only, and only for a pickup that is now; create_order() itself refuses the mode on any other channel", async () => {
    const listed = await listedVehicle(3, { instant: 1 }, tenant);
    await priceByDay(listed.id, 20_000, tenant);
    await service
      .from("product_listings")
      .update({ lead_time_hours: 72 })
      .eq("product_id", listed.id)
      .throwOnError();
    // A customer at the shop on Tuesday 6 January 2032 at 11:00.
    const atTheShop = () => pickup(5);
    const ride = (
      start: Date,
      end: Date,
      over: Partial<OnlineBookingRequest> = {},
    ) =>
      bookOnline(
        ask([{ productId: listed.id, start, end, quantity: 1 }], {
          channel: "marketplace",
          mode: "now",
          ...over,
        }),
        { db: server, now: atTheShop },
      );
    // The cap's one place is taken by an advance booking for the same days.
    booked(
      await mmBook(
        [{ product_id: listed.id, starts_at: pickup(5), ends_at: pickup(7) }],
        { tenant },
      ),
    );
    const before = written(tenant);
    // A "walk-in" for next week: it used to skip the 72 hours and the cap.
    expect(await ride(pickup(12), pickup(14))).toEqual({
      ok: false,
      reason: "not_now",
      line: 0,
    });
    // Later today.
    expect(await ride(pickup(5, 8), pickup(7))).toEqual({
      ok: false,
      reason: "not_now",
      line: 0,
    });
    // The shop's own page and the API can't use the mode at all.
    for (const channel of ["booking_page", "api"] as const) {
      await expect(ride(pickup(5), pickup(7), { channel })).rejects.toThrow(
        RangeError,
      );
      const direct = await createOrder(
        service,
        tenant.id,
        request(tenant, channel, "now", [
          { product_id: listed.id, starts_at: pickup(5), ends_at: pickup(7) },
        ]).p_request,
      );
      expect(direct.error?.message, channel).toBe("invalid_request");
      expect(direct.error?.code, channel).toBe("22023");
    }
    expect(written(tenant)).toBe(before);
    // A real walk-in, ten minutes from now, with the cap full: rides away.
    const tenMinutes = new Date(pickup(5).getTime() + 10 * 60_000);
    const answer = await ride(tenMinutes, pickup(7));
    expect(answer.ok && answer.mode).toBe("now");
    expect((await reservationsOf(listed.id)).map((r) => r.mode).sort()).toEqual(
      ["instant", "now"],
    );
  }, 60_000);

  it("a location with no opening hours saved can't be booked online, on any online channel; staff book it as before", async () => {
    // Saigon has saved no hours.
    expect(
      (
        await service
          .from("location_hours")
          .select("weekday")
          .eq("location_id", saigon.locationId)
      ).data,
    ).toEqual([]);
    const scooter = await listedVehicle(2, { instant: 2 }, saigon);
    await priceByDay(scooter.id, 150_000, saigon);
    const before = written(saigon);
    for (const channel of ["booking_page", "marketplace", "api"] as const) {
      expect(
        await bookOnline(
          {
            tenantId: saigon.id,
            locationId: saigon.locationId,
            channel,
            mode: "instant",
            lines: [
              {
                productId: scooter.id,
                start: at(30, 4),
                end: at(32, 4),
                quantity: 1,
              },
            ],
          },
          { db: server, now },
        ),
        channel,
      ).toEqual({ ok: false, reason: "outside_hours", line: 0 });
    }
    expect(written(saigon)).toBe(before);
    // The counter is not bound by it.
    booked(
      await staffBook(
        "staff",
        [{ product_id: scooter.id, starts_at: at(30, 4), ends_at: at(32, 4) }],
        { tenant: saigon },
      ),
    );
    // With hours saved, the same online booking goes through.
    await service
      .from("location_hours")
      .insert(everyDay("08:00", "20:00", saigon))
      .throwOnError();
    const answer = await bookOnline(
      {
        tenantId: saigon.id,
        locationId: saigon.locationId,
        channel: "booking_page",
        mode: "instant",
        lines: [
          {
            productId: scooter.id,
            start: at(30, 4),
            end: at(32, 4),
            quantity: 1,
          },
        ],
      },
      { db: server, now },
    );
    expect(answer.ok).toBe(true);
    await service
      .from("location_hours")
      .delete()
      .eq("location_id", saigon.locationId)
      .throwOnError();
  }, 60_000);

  it("nobody but the server books an online channel: a signed-out visitor and a signed-in Moto Mangos customer can't run create_order() for any shop; a member can't use an online channel", async () => {
    const before = written(tenant);
    const line = [
      { product_id: bike.id, starts_at: pickup(90), ends_at: pickup(92) },
    ];
    for (const channel of ["booking_page", "marketplace", "api"]) {
      const body = request(tenant, channel, "instant", line);
      // Signed out: not granted at all.
      const visitor = await createOrder(
        anonClient(),
        body.p_tenant_id,
        body.p_request,
      );
      expect(visitor.error?.code, `signed out, ${channel}`).toBe("42501");
      expect(visitor.data).toBeNull();
      // A Moto Mangos customer is a signed-in person with no place in any shop.
      const customer = await createOrder(
        outsider.db,
        body.p_tenant_id,
        body.p_request,
      );
      expect(customer.data, `customer, ${channel}`).toEqual({
        ok: false,
        reason: "not_allowed",
        line: null,
      });
      // The shop's own people book as themselves, at the counter or on the phone.
      for (const role of roles) {
        const member = await createOrder(
          db(role, tenant),
          body.p_tenant_id,
          body.p_request,
        );
        expect(member.data, `${role}, ${channel}`).toEqual({
          ok: false,
          reason: "not_allowed",
          line: null,
        });
      }
    }
    // And the customer can't book as staff either.
    const asStaff = await createOrder(
      outsider.db,
      tenant.id,
      request(tenant, "walk_in", "staff", line).p_request,
    );
    expect(asStaff.data).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(written(tenant)).toBe(before);
  }, 60_000);
});
