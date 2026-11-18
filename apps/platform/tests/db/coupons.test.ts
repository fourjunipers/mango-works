/**
 * Phase 2, stage 8: coupons in the database (migration 20261118000100;
 * docs/phase-2-plan.md §3.2, §4, §5.3, §6, §9.2).
 *
 * The code's one normaliser, against the same cases as @mango/core's;
 * save_coupon() by every role and shop against shop, and what it refuses;
 * coupon_inputs() and the uses it counts; the returning-customer settings;
 * the redemption inside reserve(), rechecked under the coupon's row; a use
 * given back by a cancel and by a hold running out; a held booking priced
 * again; both booking paths end to end on real rows; the lock order, held
 * in place and as races (two bookings after a coupon's last use, across the
 * staff and online paths and across two coupons booked in opposite orders)
 * with no deadlock; save_coupon()'s lock timeout; the currency lock. The
 * races run in three shops: Bangkok (THB), New York (USD, daylight saving)
 * and Saigon (VND).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COUPON_CODE_CASES } from "@mango/core/coupon-code.cases";
import { isCouponCode, normalizeCouponCode } from "@mango/core/discounts";
import { quote } from "@mango/core/quote";
import { bookOnline, type OnlineDb } from "@/lib/book-online";
import { saveCoupon, type CouponSaveDb } from "@/lib/coupon-save";
import {
  couponOutcomeOf,
  decideFor,
  readCoupon,
  returningCustomerOf,
  type CouponDb,
  type CouponInputs,
} from "@/lib/coupons";
import { quoteInputFor, type PricingInputs } from "@/lib/pricing-inputs";
import { roles, type Role } from "@/lib/roles";
import {
  bookAsStaff,
  cancelReservation,
  confirmHold,
  type StaffDb,
} from "@/lib/staff-booking";
import {
  anonClient,
  createTenant,
  createUser,
  deleteTenant,
  deleteUser,
  serviceClient,
  sql,
  sqlBackground,
  type Db,
  type TestTenant,
  type TestUser,
} from "./helpers";

let shop: TestTenant;
let rival: TestTenant;
let newYork: TestTenant;
let saigon: TestTenant;
let outsider: TestUser;
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
let counter = 0;
const name = (what: string) => `${what} ${tag} ${++counter}`;
/** A code nobody else in this run has: A to Z and 0 to 9. */
const code = (what = "C") =>
  `${what}${tag}${++counter}`.replace(/[^A-Z0-9]/g, "");

/** How many times each race is run, in each shop. */
const ROUNDS = 8;
/** Race rounds run by this file, for the report. */
let raceRounds = 0;
let deadlocksBefore: number;

const db = (role: Role, tenant: TestTenant = shop): Db =>
  tenant.members[role].db;
const staffDb = (role: Role, tenant: TestTenant = shop) =>
  db(role, tenant) as unknown as StaffDb;
const server = service as unknown as OnlineDb;

const MADE_UP = "00000000-0000-4000-8000-00000000abcd";
const CUSTOMER = "00000000-0000-4000-8000-0000000c0001";
const OTHER_CUSTOMER = "00000000-0000-4000-8000-0000000c0002";

/** A moment far ahead: day `d` at `h` o'clock UTC. Every test has its own products. */
const at = (d: number, h = 4) =>
  new Date(Date.UTC(2034, 0, 2) + d * 86_400_000 + h * 3_600_000);

type Failure = { code?: string; message?: string } | null;
type Saved = Record<string, unknown> & {
  id: string;
  code: string;
  product_ids: string[];
};

/** save_coupon(), as whoever `client` is. */
const save = (
  client: Db,
  tenant: TestTenant,
  coupon: Record<string, unknown>,
): Promise<{ data: Saved | null; error: Failure }> =>
  Promise.resolve(
    client.rpc("save_coupon", {
      p_tenant_id: tenant.id,
      p_coupon: coupon,
    } as never),
  ) as Promise<{ data: Saved | null; error: Failure }>;

/** A coupon saved by the owner: 10% off everything, on every channel. */
async function coupon(
  over: Record<string, unknown> = {},
  tenant: TestTenant = shop,
): Promise<Saved> {
  const { data, error } = await save(db("owner", tenant), tenant, {
    code: code(),
    kind: "percent",
    percent_bp: 1000,
    channels: ["staff", "booking_page", "marketplace"],
    ...over,
  });
  if (error) throw new Error(error.message);
  return data!;
}

/** A vehicle product with `count` units, made with the service role. */
async function vehicle(count: number, tenant: TestTenant = shop) {
  const product = await service
    .from("products")
    .insert({
      tenant_id: tenant.id,
      name: name("Scooter"),
      vehicle_type: "motorbike",
    })
    .select("id, name")
    .single()
    .throwOnError();
  const units = count
    ? await service
        .from("units")
        .insert(
          Array.from({ length: count }, () => ({
            tenant_id: tenant.id,
            product_id: product.data!.id,
            location_id: tenant.locationId,
            plate: `CP-${tag}-${++counter}`,
          })),
        )
        .select("id")
        .throwOnError()
    : { data: [] as { id: string }[] };
  return {
    id: product.data!.id,
    name: product.data!.name,
    units: units.data!.map((u) => u.id),
  };
}

const priceByDay = async (
  productId: string,
  amount: number,
  tenant: TestTenant = shop,
) => {
  const { error } = await db("owner", tenant).rpc("save_product_pricing", {
    p_product_id: productId,
    p_settings: {
      pricing_method: "per_period",
      price_amount: amount,
      price_period: "day",
    } as never,
  });
  if (error) throw error;
};

const settings = async (
  values: Record<string, unknown>,
  tenant: TestTenant = shop,
  role: Role = "owner",
) =>
  Promise.resolve(
    db(role, tenant).rpc("save_pricing_settings", {
      p_tenant_id: tenant.id,
      p_settings: values as never,
    }),
  ) as Promise<{ data: Record<string, unknown> | null; error: Failure }>;

type Line = {
  product_id: string;
  starts_at: Date;
  ends_at: Date;
  quantity?: number;
  parent?: number;
};
type Use = { coupon_id: string; amount: string | number; customer_id?: string };
type Booked = {
  ok: true;
  booking_id: string;
  lines: { reservation_id: string; unit_ids: string[]; shortage: number }[];
};
type Answer = Booked | { ok: false; reason: string; line?: number | null };
type Result = { data: Answer | null; error: Failure };

const request = (
  tenant: TestTenant,
  channel: string,
  mode: string,
  lines: Line[],
  more: { hold?: boolean; coupon?: unknown } = {},
) => ({
  p_tenant_id: tenant.id,
  p_request: {
    channel,
    mode,
    ...(more.hold ? { hold: true } : {}),
    ...(more.coupon === undefined ? {} : { coupon: more.coupon }),
    lines: lines.map((line) => ({
      ...line,
      location_id: tenant.locationId,
      starts_at: line.starts_at.toISOString(),
      ends_at: line.ends_at.toISOString(),
      quantity: line.quantity ?? 1,
    })),
  },
});

const staffBook = (
  lines: Line[],
  o: {
    tenant?: TestTenant;
    hold?: boolean;
    role?: Role;
    coupon?: unknown;
  } = {},
): Promise<Result> =>
  Promise.resolve(
    db(o.role ?? "staff", o.tenant ?? shop).rpc(
      "reserve",
      request(o.tenant ?? shop, "walk_in", "staff", lines, o) as never,
    ),
  ) as Promise<Result>;

const pageBook = (
  lines: Line[],
  o: { tenant?: TestTenant; hold?: boolean; coupon?: unknown } = {},
): Promise<Result> =>
  Promise.resolve(
    service.rpc(
      "reserve",
      request(o.tenant ?? shop, "booking_page", "instant", lines, o) as never,
    ),
  ) as Promise<Result>;

const booked = (result: Result): Booked => {
  expect(result.error, result.error?.message).toBeNull();
  expect(result.data, JSON.stringify(result.data)).toMatchObject({ ok: true });
  return result.data as Booked;
};
const refusal = (result: Result) => {
  expect(result.error, result.error?.message).toBeNull();
  const data = result.data!;
  return data.ok ? "ok" : data.reason;
};

const days = (bike: { id: string }, day: number, length = 2): Line[] => [
  { product_id: bike.id, starts_at: at(day), ends_at: at(day + length) },
];
const taking = (
  c: { id: string },
  amount: number | string = 100,
  customer?: string,
): Use => ({
  coupon_id: c.id,
  amount,
  ...(customer ? { customer_id: customer } : {}),
});

/** Everything a booking writes in a shop, as text. */
const written = (tenant: TestTenant) =>
  sql(`
    select (select count(*) from platform.reservations where tenant_id = '${tenant.id}')
      || ' reservations, '
      || (select coalesce(string_agg(state, ',' order by id), '') from platform.reservations where tenant_id = '${tenant.id}')
      || ' | ' || (select coalesce(string_agg(kind || ':' || unit_id, ',' order by id), '') from platform.unit_blocks where tenant_id = '${tenant.id}')
      || ' | ' || (select coalesce(string_agg(coupon_id || ':' || amount || ':' || (released_at is null), ',' order by id), '') from platform.coupon_redemptions where tenant_id = '${tenant.id}')
      || ' | ' || (select count(*) from platform.audit_events where tenant_id = '${tenant.id}' and entity in ('bookings', 'coupon_redemptions'));
  `).out;

const redemptions = async (couponId: string) =>
  (
    await service
      .from("coupon_redemptions")
      .select("id, booking_id, customer_id, amount, released_at")
      .eq("coupon_id", couponId)
      .order("redeemed_at")
      .throwOnError()
  ).data!;
const live = async (couponId: string) =>
  (await redemptions(couponId)).filter((r) => r.released_at === null);

const read = async (
  client: Db,
  tenant: TestTenant,
  typed: string,
  more: { bookingId?: string; customerId?: string } = {},
): Promise<CouponInputs> =>
  readCoupon(client as unknown as CouponDb, tenant.id, typed, more);

const couponRows = (tenant: TestTenant) =>
  sql(`
    select coalesce(string_agg(to_jsonb(c)::text, ',' order by c.id), '')
      || ' | ' || (select coalesce(string_agg(coupon_id || ':' || product_id, ',' order by coupon_id, product_id), '') from platform.coupon_products where tenant_id = '${tenant.id}')
      || ' | ' || (select count(*) from platform.coupon_redemptions where tenant_id = '${tenant.id}')
    from platform.coupons c where c.tenant_id = '${tenant.id}';
  `).out;

/** A background session that acts as a signed-in member, or as the server. */
const actingAs = (userId: string | null) =>
  userId
    ? `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: "authenticated" })}', true); set local role authenticated;`
    : `select set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role;`;

/** Waits until another session is running a statement carrying `marker`. */
async function holding(
  marker: string,
  session?: Promise<{ out: string; failed: string }>,
) {
  let ended: { out: string; failed: string } | undefined;
  void session?.then((result) => (ended = result));
  for (let i = 0; i < 100; i++) {
    if (ended)
      throw new Error(
        `The session ended before ${marker}: ${ended.failed || ended.out}`,
      );
    const { out } = sql(
      `select count(*) from pg_stat_activity where state = 'active' and query like '%${marker}%' and pid <> pg_backend_pid();`,
    );
    if (out === "1") return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`No session reached ${marker}`);
}

/** Polls `statement` until it answers something other than an empty string. */
async function until(statement: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const { out, failed } = sql(statement);
    expect(failed).toBe("");
    if (out) return out;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Never true: ${statement}`);
}

/**
 * A session other than this one and the holder is waiting for a row (not an
 * advisory lock) while the holder sleeps on `holder`: answers the advisory
 * locks the waiter has in hand, by namespace.
 */
const waitingForRow = (holder: string) =>
  until(`
    select 'waiting for a row; product locks: ' || (
      select count(*) from pg_locks u
      where u.pid = w.pid and u.locktype = 'advisory' and u.classid = x'1a02'::int
    ) || ', unit locks: ' || (
      select count(*) from pg_locks u
      where u.pid = w.pid and u.locktype = 'advisory' and u.classid = x'1a01'::int
    )
    from pg_locks w
    join pg_stat_activity a on a.pid = w.pid
    where not w.granted and w.locktype in ('transactionid', 'tuple')
      and a.query not like '%${holder}%' and a.pid <> pg_backend_pid()
      and exists (
        select 1 from pg_stat_activity h
        where h.query like '%${holder}%' and h.pid <> pg_backend_pid()
          and h.pid = any (pg_blocking_pids(w.pid))
      )
    limit 1;
  `);

const deadlocks = () =>
  Number(
    sql(
      `select pg_stat_force_next_flush(); select deadlocks from pg_stat_database where datname = current_database();`,
    )
      .out.split("\n")
      .pop(),
  );

const noDeadlock = (results: { data?: unknown; error: Failure }[]) => {
  for (const result of results) {
    expect(result.error?.code, result.error?.message).not.toBe("40P01");
    expect(result.error?.message ?? "").not.toMatch(/deadlock/i);
    const data = result.data as { ok?: boolean; reason?: string } | null;
    if (data && data.ok === false) expect(data.reason).not.toBe("try_again");
  }
};

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");

const thailand = {
  country: "TH",
  currency: "THB",
  locale: "th-TH",
  timezone: "Asia/Bangkok",
};

beforeAll(async () => {
  deadlocksBefore = deadlocks();
  [shop, rival, newYork, saigon, outsider] = await Promise.all([
    createTenant("coupons-bkk", thailand),
    createTenant("coupons-rival", thailand),
    createTenant("coupons-nyc", {
      country: "US",
      currency: "USD",
      locale: "en-US",
      timezone: "America/New_York",
    }),
    createTenant("coupons-sgn"),
    createUser("coupons-outsider"),
  ]);
  // "Accept coupons" on in every shop: reserve() reads the switch again
  // under the coupon's row (review of PR 48, finding 3).
  for (const tenant of [shop, rival, newYork, saigon]) {
    const { error } = await db("owner", tenant).rpc("save_pricing_settings", {
      p_tenant_id: tenant.id,
      p_settings: { coupons_enabled: true },
    });
    if (error) throw error;
  }
}, 180_000);

afterAll(async () => {
  console.log(`coupons.test.ts: ${raceRounds} race rounds`);
  await Promise.all([
    deleteTenant(shop),
    deleteTenant(rival),
    deleteTenant(newYork),
    deleteTenant(saigon),
    deleteUser(outsider),
  ]);
}, 120_000);

// ------------------------------------------------------------ the normaliser

describe("the code's one normaliser: the database and @mango/core agree", () => {
  it("every shared case: the database gives the stored form @mango/core gives, character for character", () => {
    expect(COUPON_CODE_CASES.length).toBeGreaterThanOrEqual(30);
    // Each code goes in and comes out as hex, so no quoting is in the way.
    const { out, failed } = sql(
      COUPON_CODE_CASES.map(
        (each) => `
          select 'r:' || encode(convert_to(
            platform_private.normalize_coupon_code(
              convert_from(decode('${hex(each.typed)}', 'hex'), 'utf8')),
            'utf8'), 'hex')
            || ':' || (platform_private.normalize_coupon_code(
              convert_from(decode('${hex(each.typed)}', 'hex'), 'utf8'))
              ~ '^[A-Z0-9]{1,40}$');`,
      ).join("\n"),
    );
    expect(failed).toBe("");
    const answers = out.split("\n");
    expect(answers).toHaveLength(COUPON_CODE_CASES.length);
    COUPON_CODE_CASES.forEach((each, index) => {
      const [, stored, accepted] = answers[index].split(":");
      // The database against the list, and against the TypeScript function.
      expect(stored, each.what).toBe(hex(each.normalized));
      expect(stored, each.what).toBe(hex(normalizeCouponCode(each.typed)));
      expect(accepted === "true", each.what).toBe(each.accepted);
      expect(isCouponCode(normalizeCouponCode(each.typed)), each.what).toBe(
        each.accepted,
      );
    });
    // Null in, null out; and it is a function of its input alone.
    expect(
      sql(`
        select (platform_private.normalize_coupon_code(null) is null)::text
          || ' ' || p.provolatile::text
        from pg_proc p
        where p.oid = 'platform_private.normalize_coupon_code(text)'::regprocedure;
      `).out,
    ).toBe("true i");
  });

  it("save_coupon() stores that form and takes nothing but A to Z and 0 to 9; the lookup finds it however it is typed", async () => {
    const tenant = await createTenant("coupons-codes", thailand);
    try {
      const owner = db("owner", tenant);
      for (const each of COUPON_CODE_CASES) {
        const saved = await save(owner, tenant, {
          code: each.typed,
          kind: "percent",
          percent_bp: 500,
        });
        if (!each.accepted) {
          expect(saved.error?.message, each.what).toBe("invalid_code");
          expect(saved.error?.code, each.what).toBe("22023");
          continue;
        }
        expect(saved.error, each.what).toBeNull();
        expect(saved.data!.code, each.what).toBe(each.normalized);
        // Typed as it was, and as it is stored: the same coupon.
        for (const typed of [each.typed, each.normalized]) {
          expect((await read(owner, tenant, typed)).coupon?.id, each.what).toBe(
            saved.data!.id,
          );
        }
        // Archived, so the next case that normalises to the same code can
        // take it.
        await save(owner, tenant, { id: saved.data!.id, archived: true });
      }
      // Only the accepted ones were ever written.
      const stored = (
        await service
          .from("coupons")
          .select("code")
          .eq("tenant_id", tenant.id)
          .throwOnError()
      ).data!;
      expect(stored).toHaveLength(
        COUPON_CODE_CASES.filter((each) => each.accepted).length,
      );
      for (const row of stored) expect(row.code).toMatch(/^[A-Z0-9]{1,40}$/);
      // A code with a character that is not stored finds nothing.
      await save(owner, tenant, {
        code: "STRASSE",
        kind: "percent",
        percent_bp: 500,
      });
      expect((await read(owner, tenant, "stra\u00dfe")).coupon).toBeNull();
      expect((await read(owner, tenant, "strasse")).coupon?.code).toBe(
        "STRASSE",
      );
    } finally {
      await deleteTenant(tenant);
    }
  }, 120_000);

  it("the table holds the stored form for a row written by hand as the server", async () => {
    const base = {
      tenant_id: shop.id,
      currency: shop.currency,
      kind: "percent",
      percent_bp: 100,
    };
    for (const bad of [
      "summer10",
      "SUMMER 10",
      "",
      "A".repeat(41),
      "STRA\u00dfE",
    ]) {
      const { error } = await service
        .from("coupons")
        .insert({ ...base, code: bad });
      expect(error?.code, JSON.stringify(bad)).toBe("23514");
      expect(error?.message).toContain("coupons_code_check");
    }
  });
});

// ------------------------------------------------------------- who may what

describe("who may read and change coupons", () => {
  it("save_coupon(): owners and managers save; staff, mechanics and drivers are refused and nothing is written", async () => {
    for (const role of roles) {
      const before = couponRows(shop);
      const typed = code("ROLE");
      const saved = await save(db(role), shop, {
        code: typed,
        kind: "fixed",
        amount: 5000,
      });
      if (role === "owner" || role === "manager") {
        expect(saved.error, role).toBeNull();
        expect(saved.data, role).toMatchObject({
          code: typed,
          kind: "fixed",
          amount: 5000,
          percent_bp: null,
          currency: "THB",
          all_products: true,
          channels: [],
          with_returning_discount: false,
          with_season_discount: true,
          active: true,
          archived_at: null,
          product_ids: [],
        });
      } else {
        expect(saved.error?.message, role).toBe("only_owner_or_manager");
        expect(saved.error?.code, role).toBe("42501");
        expect(couponRows(shop), role).toBe(before);
      }
    }
  });

  it("another shop's five roles, a stranger, a signed-out visitor and the server are all refused, and the shop's coupons are as they were", async () => {
    const mine = await coupon();
    const before = couponRows(shop);
    const callers: [string, Db][] = [
      ...roles.map((role): [string, Db] => [`rival ${role}`, db(role, rival)]),
      ["stranger", outsider.db],
      ["signed out", anonClient()],
      ["server", service],
    ];
    for (const [who, client] of callers) {
      for (const payload of [
        { code: code("X"), kind: "percent", percent_bp: 100 },
        { id: mine.id, active: false },
        { id: mine.id, archived: true },
      ]) {
        const saved = await save(client, shop, payload);
        expect(saved.data, who).toBeNull();
        expect(saved.error?.code, who).toBe("42501");
      }
    }
    expect(couponRows(shop)).toBe(before);
  });

  it("owners, managers and staff read coupons, their products and their uses; mechanics, drivers and anyone outside the shop see none; nobody signed in writes the tables directly", async () => {
    const bike = await vehicle(1);
    const mine = await coupon({ all_products: false, product_ids: [bike.id] });
    booked(await staffBook(days(bike, 400), { coupon: taking(mine, 700) }));
    const tables = [
      "coupons",
      "coupon_products",
      "coupon_redemptions",
    ] as const;
    const seen = async (client: Db) =>
      Promise.all(
        tables.map(
          async (table) =>
            (
              (await client.from(table).select("*").eq("tenant_id", shop.id))
                .data ?? []
            ).length,
        ),
      );
    for (const role of ["owner", "manager", "staff"] as const) {
      const [coupons, products, uses] = await seen(db(role));
      expect(coupons, role).toBeGreaterThan(0);
      expect(products, role).toBeGreaterThan(0);
      expect(uses, role).toBeGreaterThan(0);
    }
    for (const [who, client] of [
      ["mechanic", db("mechanic")],
      ["driver", db("driver")],
      ...roles.map((role): [string, Db] => [`rival ${role}`, db(role, rival)]),
      ["stranger", outsider.db],
      ["signed out", anonClient()],
    ] as [string, Db][]) {
      expect(await seen(client), who).toEqual([0, 0, 0]);
    }

    // By hand, as the shop's own owner: every write is refused by the grants.
    const before = couponRows(shop);
    const owner = db("owner");
    const attempts = [
      owner.from("coupons").insert({
        tenant_id: shop.id,
        currency: "THB",
        code: code("HAND"),
        kind: "percent",
        percent_bp: 9999,
      }),
      owner.from("coupons").update({ percent_bp: 9999 }).eq("id", mine.id),
      owner.from("coupons").delete().eq("id", mine.id),
      owner.from("coupon_products").insert({
        tenant_id: shop.id,
        coupon_id: mine.id,
        product_id: (await vehicle(0)).id,
      }),
      owner.from("coupon_products").delete().eq("coupon_id", mine.id),
      owner.from("coupon_redemptions").insert({
        tenant_id: shop.id,
        coupon_id: mine.id,
        booking_id: MADE_UP,
        amount: 1,
      }),
      owner
        .from("coupon_redemptions")
        .update({ released_at: new Date().toISOString() })
        .eq("coupon_id", mine.id),
      owner.from("coupon_redemptions").delete().eq("coupon_id", mine.id),
    ];
    for (const attempt of attempts) {
      expect((await attempt).error?.code).toBe("42501");
    }
    expect(couponRows(shop)).toBe(before);
  });

  it("another shop's coupon or product is answered exactly like a made-up id, and that shop's rows are untouched", async () => {
    const theirs = await coupon({ max_uses: 1 }, rival);
    const theirBike = await vehicle(1, rival);
    const mine = await vehicle(1);
    const rivalBefore = couponRows(rival);
    const before = couponRows(shop);
    const owner = db("owner");

    // save_coupon(): changing it, and naming its product.
    for (const id of [theirs.id, MADE_UP]) {
      const saved = await save(owner, shop, { id, active: false });
      expect(saved.error?.message, id).toBe("coupon_not_found");
      expect(saved.error?.code, id).toBe("P0001");
    }
    for (const id of [theirBike.id, MADE_UP]) {
      const saved = await save(owner, shop, {
        code: code("X"),
        kind: "percent",
        percent_bp: 100,
        all_products: false,
        product_ids: [mine.id, id],
      });
      expect(saved.error?.message, id).toBe("product_not_found");
      expect(saved.error?.code, id).toBe("P0001");
    }
    // The other shop's tenant named outright: not a member there.
    expect(
      (await save(owner, rival, { id: theirs.id, active: false })).error?.code,
    ).toBe("42501");

    // coupon_inputs(): their code in my shop is no code; in theirs, as me,
    // RLS shows nothing. The same answer as a code nobody has.
    const nothing = { coupon: null, uses: null };
    expect(await read(owner, shop, theirs.code)).toEqual(nothing);
    expect(await read(owner, shop, "NOSUCHCODE")).toEqual(nothing);
    expect(await read(owner, rival, theirs.code)).toEqual(nothing);
    expect(await read(db("staff"), rival, theirs.code)).toEqual(nothing);
    // The server reads a shop's own code, and never another shop's by it.
    expect((await read(service, rival, theirs.code)).coupon?.id).toBe(
      theirs.id,
    );
    expect(await read(service, shop, theirs.code)).toEqual(nothing);

    // reserve(): their coupon on my booking, by a member and by the server.
    const wrote = written(shop);
    for (const id of [theirs.id, MADE_UP]) {
      const lines = days(mine, 1);
      expect(
        (await staffBook(lines, { coupon: { coupon_id: id, amount: 1 } })).data,
        id,
      ).toEqual({ ok: false, reason: "coupon_not_valid", line: null });
      expect(
        (await pageBook(lines, { coupon: { coupon_id: id, amount: 1 } })).data,
        id,
      ).toEqual({ ok: false, reason: "coupon_not_valid", line: null });
    }
    expect(written(shop)).toBe(wrote);
    expect(couponRows(shop)).toBe(before);
    expect(couponRows(rival)).toBe(rivalBefore);
    expect(await live(theirs.id)).toEqual([]);
  });
});

// ------------------------------------------------------------- save_coupon()

describe("save_coupon(): one coupon, only what is named changes", () => {
  it("a new coupon with every setting; then only what is named changes, and only the number of the kind in force is kept", async () => {
    const [a, b] = await Promise.all([vehicle(0), vehicle(0)]);
    const typed = code("FULL");
    const owner = db("owner");
    const made = await save(owner, shop, {
      code: ` ${typed.toLowerCase()} `,
      name: "  Summer  ",
      kind: "fixed",
      amount: "20000",
      percent_bp: 500,
      all_products: false,
      product_ids: [b.id, a.id, a.id],
      valid_from: "2027-06-01",
      valid_to: "2027-08-31",
      pickup_from: "2027-06-15",
      pickup_to: "2027-09-15",
      min_days: 3,
      min_spend: 100000,
      max_uses: 50,
      max_uses_per_customer: 1,
      channels: ["marketplace", "staff", "staff"],
      with_returning_discount: true,
      with_season_discount: false,
      active: false,
    });
    expect(made.error).toBeNull();
    const id = made.data!.id;
    expect(made.data).toMatchObject({
      tenant_id: shop.id,
      currency: "THB",
      code: typed,
      name: "Summer",
      kind: "fixed",
      amount: 20000,
      percent_bp: null,
      all_products: false,
      product_ids: [a.id, b.id].sort(),
      valid_from: "2027-06-01",
      valid_to: "2027-08-31",
      pickup_from: "2027-06-15",
      pickup_to: "2027-09-15",
      min_days: 3,
      min_spend: 100000,
      max_uses: 50,
      max_uses_per_customer: 1,
      channels: ["marketplace", "staff"],
      with_returning_discount: true,
      with_season_discount: false,
      active: false,
      archived_at: null,
    });

    // Switched on: nothing else moves.
    const on = await save(db("manager"), shop, { id, active: true });
    expect(on.data).toEqual({
      ...made.data,
      active: true,
      updated_at: on.data!.updated_at,
    });
    // A percentage instead: the amount goes. Limits cleared with null.
    const percent = await save(owner, shop, {
      id,
      kind: "percent",
      percent_bp: 1500,
      min_days: null,
      min_spend: null,
      max_uses: null,
      valid_to: null,
    });
    expect(percent.data).toMatchObject({
      kind: "percent",
      percent_bp: 1500,
      amount: null,
      min_days: null,
      min_spend: null,
      max_uses: null,
      max_uses_per_customer: 1,
      valid_from: "2027-06-01",
      valid_to: null,
      product_ids: [a.id, b.id].sort(),
    });
    // Every product: its links go. Chosen again: they are what is named.
    expect(
      (await save(owner, shop, { id, all_products: true })).data!.product_ids,
    ).toEqual([]);
    expect(
      (
        await save(owner, shop, {
          id,
          all_products: false,
          product_ids: [b.id],
        })
      ).data!.product_ids,
    ).toEqual([b.id]);

    // The coupon's own changes are row events with who made them; a change
    // of its products is one named event.
    const events = (
      await service
        .from("audit_events")
        .select("action, actor, before, after")
        .eq("tenant_id", shop.id)
        .eq("entity", "coupons")
        .eq("entity_id", id)
        .order("id")
        .throwOnError()
    ).data!;
    expect(events.map((e) => e.action)).toEqual([
      "insert",
      "coupon_change",
      "update",
      "update",
      "update",
      "coupon_change",
      "update",
      "coupon_change",
    ]);
    expect(events[0].actor).toBe(shop.members.owner.id);
    expect(events[2]).toMatchObject({
      actor: shop.members.manager.id,
      before: { active: false },
      after: { active: true },
    });
    expect(events[1]).toMatchObject({
      before: { products: [] },
      after: { products: [a.id, b.id].sort() },
    });
    expect(events.at(-1)).toMatchObject({
      before: { products: [] },
      after: { products: [b.id] },
    });
    // The same save again changes nothing and records nothing.
    await save(owner, shop, { id, all_products: false, product_ids: [b.id] });
    expect(
      (
        await service
          .from("audit_events")
          .select("id")
          .eq("entity", "coupons")
          .eq("entity_id", id)
          .throwOnError()
      ).data,
    ).toHaveLength(events.length);
  });

  it("a code is unique in the shop among coupons that are not archived; an archived code can be used again, and the lookup finds the right row", async () => {
    const typed = code("ONCE");
    const owner = db("owner");
    const first = await coupon({ code: typed, max_uses: 3 });
    // Taken, however it is typed; another shop may have the same code.
    for (const again of [
      typed,
      typed.toLowerCase(),
      ` ${typed.slice(0, 2)} ${typed.slice(2)}`,
    ]) {
      const clash = await save(owner, shop, {
        code: again,
        kind: "percent",
        percent_bp: 100,
      });
      expect(clash.error?.message, again).toBe("code_taken");
      expect(clash.error?.code, again).toBe("P0001");
    }
    const elsewhere = await coupon({ code: typed }, rival);
    expect(elsewhere.code).toBe(typed);
    // Renaming another coupon onto it is refused too.
    const other = await coupon();
    expect(
      (await save(owner, shop, { id: other.id, code: typed })).error?.message,
    ).toBe("code_taken");

    // The lookup: the live coupon.
    expect((await read(owner, shop, typed)).coupon).toMatchObject({
      id: first.id,
      archived: false,
    });
    // Archived: still found, as archived, so the code answers "not active"
    // and not "unknown".
    const archived = await save(owner, shop, { id: first.id, archived: true });
    expect(archived.data!.archived_at).not.toBeNull();
    expect((await read(owner, shop, typed)).coupon).toMatchObject({
      id: first.id,
      archived: true,
      active: true,
    });
    // The code is free: a new coupon takes it, and the lookup finds the
    // new one, not the archived one.
    const second = await coupon({ code: typed, kind: "fixed", amount: 100 });
    expect(second.id).not.toBe(first.id);
    expect((await read(owner, shop, typed)).coupon).toMatchObject({
      id: second.id,
      archived: false,
      kind: "fixed",
    });
    // The archived one can't come back while the code is in use.
    expect(
      (await save(owner, shop, { id: first.id, archived: false })).error
        ?.message,
    ).toBe("code_taken");
    // Both archived: the one archived last.
    await save(owner, shop, { id: second.id, archived: true });
    expect((await read(owner, shop, typed)).coupon).toMatchObject({
      id: second.id,
      archived: true,
    });
    // And then the first can come back.
    const back = await save(owner, shop, { id: first.id, archived: false });
    expect(back.data).toMatchObject({ id: first.id, archived_at: null });
    expect((await read(owner, shop, typed)).coupon?.id).toBe(first.id);
    // By hand as the server: the index says the same.
    const forced = await service.from("coupons").insert({
      tenant_id: shop.id,
      currency: "THB",
      code: typed,
      kind: "percent",
      percent_bp: 100,
    });
    expect(forced.error?.code).toBe("23505");
  });

  it("refuses what could not be a coupon, every malformed payload, and writes nothing; the table itself holds the same rules", async () => {
    const bike = await vehicle(0);
    const good = { code: code("BAD"), kind: "percent", percent_bp: 1000 };
    const before = couponRows(shop);
    const bad: [string, unknown, string?][] = [
      ["not an object", [good]],
      ["null", null],
      ["an unknown key", { ...good, discount: 5 }],
      ["no code", { kind: "percent", percent_bp: 1000 }],
      ["no kind", { code: good.code, percent_bp: 1000 }],
      ["a code that is not text", { ...good, code: 10 }, "invalid_coupon"],
      ["a code with a hyphen", { ...good, code: "SUMMER-10" }, "invalid_code"],
      ["an empty code", { ...good, code: "  " }, "invalid_code"],
      ["a kind nobody has", { ...good, kind: "every_nth_free" }],
      ["a percentage with no number", { code: good.code, kind: "percent" }],
      ["a percentage of 0", { ...good, percent_bp: 0 }],
      ["a percentage over 100", { ...good, percent_bp: 10001 }],
      ["a fractional percentage", { ...good, percent_bp: 10.5 }],
      ["a fixed coupon with no amount", { code: good.code, kind: "fixed" }],
      ["a fixed coupon of 0", { code: good.code, kind: "fixed", amount: 0 }],
      ["a negative amount", { code: good.code, kind: "fixed", amount: -5 }],
      [
        "an amount with a decimal",
        { code: good.code, kind: "fixed", amount: "10.50" },
      ],
      ["a day that is not a date", { ...good, valid_from: "2027-02-30" }],
      ["a day with a time", { ...good, valid_from: "2027-02-01T00:00:00Z" }],
      ["a day that is a number", { ...good, pickup_to: 20270201 }],
      [
        "valid dates the wrong way round",
        { ...good, valid_from: "2027-02-02", valid_to: "2027-02-01" },
      ],
      [
        "pickup dates the wrong way round",
        { ...good, pickup_from: "2027-02-02", pickup_to: "2027-02-01" },
      ],
      ["0 minimum days", { ...good, min_days: 0 }],
      ["1001 minimum days", { ...good, min_days: 1001 }],
      ["a minimum spend of 0", { ...good, min_spend: 0 }],
      ["0 uses", { ...good, max_uses: 0 }],
      ["0 uses per customer", { ...good, max_uses_per_customer: 0 }],
      ["the api channel", { ...good, channels: ["staff", "api"] }],
      ["channels that are not a list", { ...good, channels: "staff" }],
      ["a switch that is not a boolean", { ...good, active: "yes" }],
      [
        "products that are not ids",
        { ...good, all_products: false, product_ids: ["scooter"] },
      ],
      [
        "chosen products, none chosen",
        { ...good, all_products: false, product_ids: [] },
      ],
      ["chosen products, none named", { ...good, all_products: false }],
      ["a name of 121 characters", { ...good, name: "n".repeat(121) }],
      ["an id that is not one", { ...good, id: "first" }],
    ];
    for (const [what, payload, reason] of bad) {
      const saved = await save(db("owner"), shop, payload as never);
      expect(saved.error?.message, what).toBe(reason ?? "invalid_coupon");
      expect(saved.error?.code, what).toBe("22023");
    }
    expect(couponRows(shop)).toBe(before);
    // A coupon that exists is not left half-changed by a bad change.
    const mine = await coupon({ all_products: false, product_ids: [bike.id] });
    const after = couponRows(shop);
    for (const payload of [
      { id: mine.id, name: "Changed", percent_bp: 0 },
      { id: mine.id, name: "Changed", product_ids: [] },
      { id: mine.id, name: "Changed", product_ids: [bike.id, MADE_UP] },
      { id: mine.id, name: "Changed", kind: "fixed" },
    ]) {
      expect((await save(db("owner"), shop, payload)).error).not.toBeNull();
    }
    expect(couponRows(shop)).toBe(after);

    // By hand, as the server: each check by name.
    const row = { tenant_id: shop.id, currency: "THB", code: code("ROW") };
    const checks: [Record<string, unknown>, string][] = [
      [{ kind: "percent" }, "coupons_kind_fields_check"],
      [
        { kind: "percent", percent_bp: 100, amount: 5 },
        "coupons_kind_fields_check",
      ],
      [{ kind: "fixed", percent_bp: 100 }, "coupons_kind_fields_check"],
      [{ kind: "fixed", amount: 0 }, "coupons_amount_check"],
      [{ kind: "percent", percent_bp: 10001 }, "coupons_percent_bp_check"],
      [{ kind: "nth", percent_bp: 100 }, "coupons_kind_check"],
      [
        { kind: "percent", percent_bp: 100, channels: ["api"] },
        "coupons_channels_check",
      ],
      [
        { kind: "percent", percent_bp: 100, min_days: 0 },
        "coupons_min_days_check",
      ],
      [
        { kind: "percent", percent_bp: 100, min_spend: 0 },
        "coupons_min_spend_check",
      ],
      [
        { kind: "percent", percent_bp: 100, max_uses: 0 },
        "coupons_max_uses_check",
      ],
      [
        { kind: "percent", percent_bp: 100, max_uses_per_customer: 0 },
        "coupons_max_uses_per_customer_check",
      ],
      [
        {
          kind: "percent",
          percent_bp: 100,
          valid_from: "2027-02-02",
          valid_to: "2027-02-01",
        },
        "coupons_valid_dates_check",
      ],
      [
        {
          kind: "percent",
          percent_bp: 100,
          pickup_from: "2027-02-02",
          pickup_to: "2027-02-01",
        },
        "coupons_pickup_dates_check",
      ],
      // Another currency than the shop's.
      [
        { kind: "percent", percent_bp: 100, currency: "USD" },
        "coupons_currency_fkey",
      ],
    ];
    for (const [values, constraint] of checks) {
      const { error } = await service
        .from("coupons")
        .insert({ ...row, ...values } as never);
      expect(error?.message, constraint).toContain(constraint);
    }
    // A use below zero, and a second live use for one booking.
    const used = await service.from("coupon_redemptions").insert({
      tenant_id: shop.id,
      coupon_id: mine.id,
      booking_id: MADE_UP,
      amount: -1,
    });
    expect(used.error?.message).toContain("coupon_redemptions_amount_check");
    // Another shop's coupon can't be used by this shop's row.
    const theirs = await coupon({}, rival);
    const crossed = await service.from("coupon_redemptions").insert({
      tenant_id: shop.id,
      coupon_id: theirs.id,
      booking_id: MADE_UP,
      amount: 1,
    });
    expect(crossed.error?.code).toBe("23503");
    const link = await service.from("coupon_products").insert({
      tenant_id: shop.id,
      coupon_id: theirs.id,
      product_id: bike.id,
    });
    expect(link.error?.code).toBe("23503");
  });

  it("a product that is deleted takes its coupon links with it; the coupon stays", async () => {
    const [keep, gone] = await Promise.all([vehicle(0), vehicle(0)]);
    const mine = await coupon({
      all_products: false,
      product_ids: [keep.id, gone.id],
    });
    await service.from("products").delete().eq("id", gone.id).throwOnError();
    expect(
      (await read(db("owner"), shop, mine.code)).coupon?.product_ids,
    ).toEqual([keep.id]);
  });
});

// ----------------------------------------------------------- coupon_inputs()

describe("coupon_inputs(): the one read decideDiscounts needs", () => {
  it("answers every setting, amounts as strings of digits, the product ids, and the uses; by role; and no arithmetic is done in any coupon function", async () => {
    const [a, b] = await Promise.all([vehicle(1), vehicle(0)]);
    const mine = await coupon({
      name: "Read me",
      kind: "fixed",
      amount: "9007199254740993",
      all_products: false,
      product_ids: [a.id, b.id],
      valid_from: "2027-06-01",
      pickup_to: "2027-09-15",
      min_days: 2,
      min_spend: "50000",
      max_uses: 10,
      max_uses_per_customer: 2,
      channels: ["staff"],
      with_returning_discount: true,
      with_season_discount: false,
    });
    const expected: CouponInputs = {
      coupon: {
        id: mine.id,
        code: mine.code,
        name: "Read me",
        currency: "THB",
        kind: "fixed",
        percent_bp: null,
        // Past what a JSON number can hold: it arrives whole.
        amount: "9007199254740993",
        all_products: false,
        product_ids: [a.id, b.id].sort(),
        valid_from: "2027-06-01",
        valid_to: null,
        pickup_from: null,
        pickup_to: "2027-09-15",
        min_days: 2,
        min_spend: "50000",
        max_uses: 10,
        max_uses_per_customer: 2,
        channels: ["staff"],
        with_returning_discount: true,
        with_season_discount: false,
        active: true,
        archived: false,
      },
      uses: { total: 0, customer: 0 },
    };
    for (const role of ["owner", "manager", "staff"] as const) {
      expect(await read(db(role), shop, mine.code), role).toEqual(expected);
    }
    expect(await read(service, shop, ` ${mine.code.toLowerCase()} `)).toEqual(
      expected,
    );
    // No prices for a mechanic or a driver, so no coupons either.
    for (const role of ["mechanic", "driver"] as const) {
      expect(await read(db(role), shop, mine.code), role).toEqual({
        coupon: null,
        uses: null,
      });
    }
    expect(await read(outsider.db, shop, mine.code)).toEqual({
      coupon: null,
      uses: null,
    });
    expect(
      (
        await anonClient().rpc("coupon_inputs", {
          p_tenant_id: shop.id,
          p_code: mine.code,
        })
      ).error?.code,
    ).toBe("42501");

    // Uses: in total, by one customer, and not another shop's.
    booked(
      await staffBook(days(a, 1), { coupon: taking(mine, 100, CUSTOMER) }),
    );
    booked(
      await staffBook(days(a, 10), { coupon: taking(mine, 100, CUSTOMER) }),
    );
    booked(await staffBook(days(a, 20), { coupon: taking(mine, 100) }));
    expect((await read(db("staff"), shop, mine.code)).uses).toEqual({
      total: 3,
      customer: 0,
    });
    expect(
      (await read(db("staff"), shop, mine.code, { customerId: CUSTOMER })).uses,
    ).toEqual({ total: 3, customer: 2 });
    expect(
      (await read(service, shop, mine.code, { customerId: OTHER_CUSTOMER }))
        .uses,
    ).toEqual({ total: 3, customer: 0 });

    // The database stores and counts; it never works an amount out.
    const arithmetic = sql(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in ('save_coupon', 'coupon_inputs', 'coupon_uses',
          'release_coupon_use', 'normalize_coupon_code', 'json_day')
        and regexp_replace(
            regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'),
            '(select|returning|count)\\s*\\(?\\s*\\*', '', 'gi')
          ~* '(\\m(round|ceil|ceiling|floor|trunc|div|mod|power)\\s*\\(|[a-z0-9_\\)]\\s*[*/%]\\s*[a-z0-9_\\(])';
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in ('save_coupon', 'coupon_inputs', 'coupon_uses',
          'release_coupon_use', 'normalize_coupon_code', 'json_day');
    `);
    expect(arithmetic.failed).toBe("");
    expect(arithmetic.out).toBe("6");
  });

  it("real rows through the adapter and decideDiscounts(): an archived or switched-off code is not_active, never unknown", async () => {
    const tenant = await createTenant("coupons-read", thailand);
    try {
      await settings({ coupons_enabled: true }, tenant);
      const bike = await vehicle(1, tenant);
      await priceByDay(bike.id, 30_000, tenant);
      const mine = await coupon({ kind: "fixed", amount: 20_000 }, tenant);
      const staff = db("staff", tenant);
      const pricing = (
        await staff.rpc("pricing_inputs", {
          p_tenant_id: tenant.id,
          p_product_ids: [bike.id],
        })
      ).data as unknown as PricingInputs;
      const decide = async (typed: string) =>
        decideFor({
          pricing,
          quote: quoteInputFor(pricing, [
            {
              id: "0",
              productId: bike.id,
              quantity: 1,
              span: { start: at(1), end: at(3), timeZone: "Asia/Bangkok" },
            },
          ]),
          now: new Date(),
          timeZone: "Asia/Bangkok",
          channel: "walk_in",
          code: typed,
          coupon: await read(staff, tenant, typed),
        });
      const good = await decide(mine.code.toLowerCase());
      expect(couponOutcomeOf(good.decision)).toMatchObject({ applied: true });
      const priced = quote(good.quote);
      // Two days at ฿300, less ฿200.
      expect(priced.ok && priced.totals.total).toBe(BigInt(40_000));
      expect((await decide("NOSUCH")).decision).toMatchObject({
        outcome: "refused",
        reason: "unknown",
      });
      await save(db("owner", tenant), tenant, { id: mine.id, active: false });
      expect((await decide(mine.code)).decision).toMatchObject({
        reason: "not_active",
      });
      await save(db("owner", tenant), tenant, {
        id: mine.id,
        active: true,
        archived: true,
      });
      expect((await decide(mine.code)).decision).toMatchObject({
        reason: "not_active",
      });
    } finally {
      await deleteTenant(tenant);
    }
  }, 60_000);
});

// ------------------------------------------- the returning-customer settings

describe("the returning-customer discount's settings", () => {
  it("off to start; saved by owners and managers through save_pricing_settings(); carried by pricing_inputs(); what is not named is kept", async () => {
    const tenant = await createTenant("coupons-returning", thailand);
    try {
      const first = await settings({ coupons_enabled: true }, tenant);
      expect(first.data).toMatchObject({
        returning_enabled: false,
        returning_percent_bp: null,
        returning_rentals_needed: 1,
      });
      const inputs = async (role: Role) =>
        (
          (
            await db(role, tenant).rpc("pricing_inputs", {
              p_tenant_id: tenant.id,
              p_product_ids: [],
            })
          ).data as unknown as PricingInputs
        ).settings;
      expect(returningCustomerOf(await inputs("staff"))).toBeNull();

      const on = await settings(
        {
          returning_enabled: true,
          returning_percent_bp: 1000,
          returning_rentals_needed: 3,
        },
        tenant,
        "manager",
      );
      expect(on.error).toBeNull();
      expect(on.data).toMatchObject({
        coupons_enabled: true,
        returning_enabled: true,
        returning_percent_bp: 1000,
        returning_rentals_needed: 3,
      });
      expect(await inputs("staff")).toMatchObject({
        coupons_enabled: true,
        returning_enabled: true,
        returning_percent_bp: 1000,
        returning_rentals_needed: 3,
      });
      expect(returningCustomerOf(await inputs("owner"))).toEqual({
        enabled: true,
        percentBp: 1000,
        completedRentalsNeeded: 3,
      });
      // Another setting saved: these three stay.
      expect(
        (await settings({ tax_inclusive: false }, tenant)).data,
      ).toMatchObject({
        returning_enabled: true,
        returning_percent_bp: 1000,
        returning_rentals_needed: 3,
      });
      // Switched off: the percentage is kept for next time.
      expect(
        (await settings({ returning_enabled: false }, tenant)).data,
      ).toMatchObject({ returning_enabled: false, returning_percent_bp: 1000 });
      // A mechanic sees no settings at all.
      expect(await inputs("mechanic")).toBeNull();
      // The change is in the History, with who made it.
      const events = (
        await service
          .from("audit_events")
          .select("actor, after")
          .eq("tenant_id", tenant.id)
          .eq("entity", "pricing_settings")
          .eq("action", "update")
          .order("id")
          .throwOnError()
      ).data!;
      // The first update is the owner's "Accept coupons"; the second is this.
      expect(events[1]).toMatchObject({
        actor: tenant.members.manager.id,
        after: {
          returning_enabled: true,
          returning_percent_bp: 1000,
          returning_rentals_needed: 3,
        },
      });
    } finally {
      await deleteTenant(tenant);
    }
  }, 60_000);

  it("refuses a percentage of 0 or over 100, 0 or 1001 rentals, a switch that is not a boolean, on with no percentage, and anyone but an owner or a manager; nothing is written", async () => {
    const row = async () =>
      JSON.stringify(
        (
          await service
            .from("pricing_settings")
            .select("*")
            .eq("tenant_id", shop.id)
            .single()
            .throwOnError()
        ).data,
      );
    const before = await row();
    const bad: [Record<string, unknown>, string][] = [
      [{ returning_percent_bp: 0 }, "invalid_pricing"],
      [{ returning_percent_bp: 10001 }, "invalid_pricing"],
      [{ returning_percent_bp: 12.5 }, "invalid_pricing"],
      [{ returning_rentals_needed: 0 }, "invalid_pricing"],
      [{ returning_rentals_needed: 1001 }, "invalid_pricing"],
      [{ returning_rentals_needed: null }, "invalid_pricing"],
      [{ returning_enabled: 1 }, "invalid_pricing"],
      [{ returning_enabled: true }, "returning_percent_required"],
      [
        { returning_enabled: true, returning_percent_bp: null },
        "returning_percent_required",
      ],
    ];
    for (const [values, reason] of bad) {
      expect(
        (await settings(values)).error?.message,
        JSON.stringify(values),
      ).toBe(reason);
    }
    for (const role of ["staff", "mechanic", "driver"] as const) {
      const refused = await settings(
        { returning_enabled: true, returning_percent_bp: 500 },
        shop,
        role,
      );
      expect(refused.error?.message, role).toBe("only_owner_or_manager");
    }
    expect(
      (
        await db("owner", rival).rpc("save_pricing_settings", {
          p_tenant_id: shop.id,
          p_settings: { returning_enabled: true, returning_percent_bp: 500 },
        })
      ).error?.message,
    ).toBe("only_owner_or_manager");
    expect(await row()).toBe(before);
    // The table says the same for a row written by hand.
    for (const [values, constraint] of [
      [
        { returning_enabled: true },
        "pricing_settings_returning_percent_required_check",
      ],
      [
        { returning_percent_bp: 0 },
        "pricing_settings_returning_percent_bp_check",
      ],
      [
        { returning_rentals_needed: 0 },
        "pricing_settings_returning_rentals_needed_check",
      ],
    ] as const) {
      const { error } = await service
        .from("pricing_settings")
        .update(values)
        .eq("tenant_id", shop.id);
      expect(error?.message).toContain(constraint);
    }
  });
});

// ------------------------------------------------ the redemption in reserve()

describe("reserve() with a coupon: counted and written under the coupon's row", () => {
  it("writes one redemption with the booking, for the amount the quote gave, from the counter and online; a booking with no coupon writes none", async () => {
    const bike = await vehicle(3);
    const mine = await coupon({ kind: "fixed", amount: 50_000, max_uses: 5 });
    const first = booked(
      await staffBook(days(bike, 1), {
        coupon: taking(mine, "20000", CUSTOMER),
      }),
    );
    const second = booked(
      await pageBook(days(bike, 1), { coupon: taking(mine, 1) }),
    );
    booked(await staffBook(days(bike, 1)));
    const rows = await redemptions(mine.id);
    expect(rows).toEqual([
      {
        id: expect.any(String),
        booking_id: first.booking_id,
        customer_id: CUSTOMER,
        amount: 20_000,
        released_at: null,
      },
      // One minor unit is the least a use can be: 0 is refused (below,
      // "after the review of PR 48", finding 2).
      {
        id: expect.any(String),
        booking_id: second.booking_id,
        customer_id: null,
        amount: 1,
        released_at: null,
      },
    ]);
    // The booking's own event names the coupon; one without a coupon has
    // no such key. The use is a row event too.
    const events = (
      await service
        .from("audit_events")
        .select("entity_id, after")
        .eq("tenant_id", shop.id)
        .eq("entity", "bookings")
        .eq("action", "reserve")
        .order("id", { ascending: false })
        .limit(3)
        .throwOnError()
    ).data!;
    expect(events[2].after).toMatchObject({
      coupon: { coupon_id: mine.id, amount: "20000" },
    });
    expect(events[0].after).not.toHaveProperty("coupon");
    const usedEvent = (
      await service
        .from("audit_events")
        .select("action, actor, after")
        .eq("entity", "coupon_redemptions")
        .eq("entity_id", rows[0].id)
        .throwOnError()
    ).data!;
    expect(usedEvent).toMatchObject([
      {
        action: "insert",
        actor: shop.members.staff.id,
        after: { coupon_id: mine.id, amount: 20_000 },
      },
    ]);
  });

  it("refuses under the lock, writing nothing: switched off, archived, a fixed coupon taking more than its amount (coupon_not_valid); its last use gone, in total or for this customer (coupon_used_up)", async () => {
    const bike = await vehicle(4);
    const owner = db("owner");
    const lines = () => days(bike, ++counter * 3);
    const both = async (c: Use) => [
      refusal(await staffBook(lines(), { coupon: c })),
      refusal(await pageBook(lines(), { coupon: c })),
    ];

    const off = await coupon({ active: false });
    const archived = await coupon();
    await save(owner, shop, { id: archived.id, archived: true });
    const fixed = await coupon({ kind: "fixed", amount: 20_000 });
    const before = written(shop);
    expect(await both(taking(off))).toEqual([
      "coupon_not_valid",
      "coupon_not_valid",
    ]);
    expect(await both(taking(archived))).toEqual([
      "coupon_not_valid",
      "coupon_not_valid",
    ]);
    // What the coupon took can't be more than the coupon.
    expect(await both(taking(fixed, 20_001))).toEqual([
      "coupon_not_valid",
      "coupon_not_valid",
    ]);
    expect(written(shop)).toBe(before);
    // Its whole amount, and switched back on, go through.
    expect(await both(taking(fixed, 20_000))).toEqual(["ok", "ok"]);
    await save(owner, shop, { id: off.id, active: true });
    expect(refusal(await staffBook(lines(), { coupon: taking(off) }))).toBe(
      "ok",
    );

    // The uses, in total.
    const twice = await coupon({ max_uses: 2 });
    expect(await both(taking(twice))).toEqual(["ok", "ok"]);
    const full = written(shop);
    expect(await both(taking(twice))).toEqual([
      "coupon_used_up",
      "coupon_used_up",
    ]);
    expect(written(shop)).toBe(full);
    // Raised to three: one more.
    await save(owner, shop, { id: twice.id, max_uses: 3 });
    expect(await both(taking(twice))).toEqual(["ok", "coupon_used_up"]);

    // And by one customer: the second customer still has theirs.
    const each = await coupon({ max_uses_per_customer: 1 });
    expect(
      refusal(await staffBook(lines(), { coupon: taking(each, 1, CUSTOMER) })),
    ).toBe("ok");
    expect(
      refusal(await pageBook(lines(), { coupon: taking(each, 1, CUSTOMER) })),
    ).toBe("coupon_used_up");
    expect(
      refusal(
        await pageBook(lines(), { coupon: taking(each, 1, OTHER_CUSTOMER) }),
      ),
    ).toBe("ok");
    // Nobody named: only the total is counted.
    expect(refusal(await staffBook(lines(), { coupon: taking(each, 1) }))).toBe(
      "ok",
    );
    expect(await live(each.id)).toHaveLength(3);
  }, 60_000);

  it("a coupon that could not be read is invalid_request, before anything is locked; a booking refused for stock uses no use", async () => {
    const bike = await vehicle(1);
    const mine = await coupon({ max_uses: 1 });
    const before = written(shop);
    const bad: unknown[] = [
      "SUMMER10",
      [],
      {},
      { coupon_id: mine.id },
      { amount: 5 },
      { coupon_id: "summer", amount: 5 },
      { coupon_id: mine.id, amount: -5 },
      { coupon_id: mine.id, amount: "5.5" },
      { coupon_id: mine.id, amount: 5, code: mine.code },
      { coupon_id: mine.id, amount: 5, customer_id: "me" },
    ];
    for (const c of bad) {
      const result = await staffBook(days(bike, 1), { coupon: c });
      expect(result.error?.message, JSON.stringify(c)).toBe("invalid_request");
      expect(result.error?.code, JSON.stringify(c)).toBe("22023");
    }
    // null is "no coupon".
    booked(await staffBook(days(bike, 1), { coupon: null }));
    expect(await live(mine.id)).toEqual([]);
    // The one unit is taken: the next booking is refused, and the coupon's
    // one use is still there afterwards.
    expect(
      refusal(await staffBook(days(bike, 1), { coupon: taking(mine) })),
    ).toBe("unavailable");
    expect(await live(mine.id)).toEqual([]);
    expect(
      refusal(await staffBook(days(bike, 5), { coupon: taking(mine) })),
    ).toBe("ok");
    void before;
  });
});

// ------------------------------------------------------- giving a use back

describe("a use is given back by a cancel and by a hold that runs out", () => {
  const expire = (bookingId: string) =>
    service
      .from("reservations")
      .update({ hold_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("booking_id", bookingId)
      .throwOnError();
  const sweep = async () => {
    const { error } = await service.rpc("release_expired_holds");
    expect(error).toBeNull();
  };

  it("cancel_reservation(): the whole booking gives the use back, and the coupon's last use can be had again; a booking cancelled in part keeps it", async () => {
    const bike = await vehicle(2);
    const mine = await coupon({ max_uses: 1 });
    const first = booked(
      await staffBook(days(bike, 1), { coupon: taking(mine) }),
    );
    expect(
      refusal(await pageBook(days(bike, 1), { coupon: taking(mine) })),
    ).toBe("coupon_used_up");
    expect(
      await cancelReservation(staffDb("staff"), shop.id, {
        bookingId: first.booking_id,
      }),
    ).toMatchObject({ ok: true });
    const [released] = await redemptions(mine.id);
    expect(released.released_at).not.toBeNull();
    expect((await read(db("staff"), shop, mine.code)).uses?.total).toBe(0);
    // Giving it back is in the History, with who cancelled.
    const events = (
      await service
        .from("audit_events")
        .select("action, actor")
        .eq("entity", "coupon_redemptions")
        .eq("entity_id", released.id)
        .order("id")
        .throwOnError()
    ).data!;
    expect(events).toEqual([
      { action: "insert", actor: shop.members.staff.id },
      { action: "update", actor: shop.members.staff.id },
    ]);

    // Two lines; one cancelled: the booking still stands, so does its use.
    const [other, third] = await Promise.all([vehicle(1), vehicle(1)]);
    const second = booked(
      await pageBook([...days(other, 1), ...days(third, 1)], {
        coupon: taking(mine),
      }),
    );
    await cancelReservation(staffDb("manager"), shop.id, {
      reservationId: second.lines[1].reservation_id,
    });
    expect(await live(mine.id)).toHaveLength(1);
    expect(
      refusal(await staffBook(days(bike, 9), { coupon: taking(mine) })),
    ).toBe("coupon_used_up");
    // The rest cancelled, by the server: now it is back.
    const { error } = await service.rpc("cancel_reservation", {
      p_tenant_id: shop.id,
      p_reservation_id: second.lines[0].reservation_id,
    });
    expect(error).toBeNull();
    expect(await live(mine.id)).toEqual([]);
    // Cancelled twice: nothing more happens.
    await cancelReservation(staffDb("staff"), shop.id, {
      bookingId: second.booking_id,
    });
    expect(
      (await redemptions(mine.id)).filter((r) => r.released_at !== null),
    ).toHaveLength(2);
    expect(
      refusal(await staffBook(days(bike, 9), { coupon: taking(mine) })),
    ).toBe("ok");
  });

  it("a hold holds its use while it lasts and when it is confirmed; when it runs out the use is back at once, and the sweep (the scheduled one, and the one inside reserve()) marks it given back", async () => {
    const [bike, elsewhere] = await Promise.all([vehicle(2), vehicle(1)]);
    const mine = await coupon({ max_uses: 1 });
    const uses = async () =>
      (await read(db("staff"), shop, mine.code)).uses?.total;

    // Held: used. Confirmed: still used.
    const kept = booked(
      await staffBook(days(bike, 1), { hold: true, coupon: taking(mine) }),
    );
    expect(await uses()).toBe(1);
    expect(
      refusal(await pageBook(days(elsewhere, 1), { coupon: taking(mine) })),
    ).toBe("coupon_used_up");
    expect(
      await confirmHold(staffDb("staff"), shop.id, kept.booking_id),
    ).toMatchObject({ ok: true });
    await sweep();
    expect(await uses()).toBe(1);
    expect((await live(mine.id)).map((r) => r.booking_id)).toEqual([
      kept.booking_id,
    ]);
    await cancelReservation(staffDb("staff"), shop.id, {
      bookingId: kept.booking_id,
    });
    expect(await uses()).toBe(0);

    // Run out, and a booking of ANOTHER product: its sweep does not reach
    // the hold, and the use is still not counted against it.
    const lapsed = booked(
      await pageBook(days(bike, 20), { hold: true, coupon: taking(mine) }),
    );
    expect(await uses()).toBe(1);
    await expire(lapsed.booking_id);
    expect(await uses()).toBe(0);
    const next = booked(
      await staffBook(days(elsewhere, 20), { coupon: taking(mine) }),
    );
    expect(await uses()).toBe(1);
    // The scheduled sweep marks the lapsed one given back; the live one stays.
    await sweep();
    const rows = await redemptions(mine.id);
    expect(
      rows.find((r) => r.booking_id === lapsed.booking_id)?.released_at,
    ).not.toBeNull();
    expect((await live(mine.id)).map((r) => r.booking_id)).toEqual([
      next.booking_id,
    ]);
    await cancelReservation(staffDb("staff"), shop.id, {
      bookingId: next.booking_id,
    });

    // Run out, and a booking of the SAME product: the sweep inside
    // reserve() releases the hold and its use in the same transaction.
    const again = booked(
      await staffBook(days(bike, 40), { hold: true, coupon: taking(mine) }),
    );
    await expire(again.booking_id);
    const taker = booked(
      await pageBook(days(bike, 40), { coupon: taking(mine) }),
    );
    expect((await live(mine.id)).map((r) => r.booking_id)).toEqual([
      taker.booking_id,
    ]);
    const state = (
      await service
        .from("reservations")
        .select("state")
        .eq("booking_id", again.booking_id)
        .throwOnError()
    ).data!;
    expect(state).toEqual([{ state: "expired" }]);
    // An expired hold can't be confirmed, so its use can't come back.
    expect(
      await confirmHold(staffDb("staff"), shop.id, again.booking_id),
    ).toMatchObject({ ok: false });
    expect(await uses()).toBe(1);
  }, 60_000);

  it("a held booking priced again does not count its own use: without its booking the code is used_up, with it the coupon applies", async () => {
    const tenant = await createTenant("coupons-reprice", thailand);
    try {
      await settings({ coupons_enabled: true }, tenant);
      const bike = await vehicle(2, tenant);
      await priceByDay(bike.id, 30_000, tenant);
      const mine = await coupon(
        { max_uses: 1, max_uses_per_customer: 1 },
        tenant,
      );
      const staff = db("staff", tenant);
      const held = await bookAsStaff(staff as unknown as StaffDb, tenant.id, {
        channel: "walk_in",
        locationId: tenant.locationId,
        hold: true,
        lines: [{ productId: bike.id, start: at(1), end: at(3), quantity: 1 }],
        couponCode: mine.code,
        customerId: CUSTOMER,
      });
      if (!held.ok) throw new Error(held.reason);
      const pricing = (
        await staff.rpc("pricing_inputs", {
          p_tenant_id: tenant.id,
          p_product_ids: [bike.id],
        })
      ).data as unknown as PricingInputs;
      const priceAgain = async (bookingId?: string) => {
        const found = await read(staff, tenant, mine.code, {
          bookingId,
          customerId: CUSTOMER,
        });
        return {
          uses: found.uses,
          decision: decideFor({
            pricing,
            quote: quoteInputFor(pricing, [
              {
                id: "0",
                productId: bike.id,
                quantity: 1,
                span: { start: at(1), end: at(3), timeZone: "Asia/Bangkok" },
              },
            ]),
            now: new Date(),
            timeZone: "Asia/Bangkok",
            channel: "walk_in",
            code: mine.code,
            coupon: found,
          }).decision,
        };
      };
      // Anyone else: the last use is gone, for the shop and for this customer.
      const others = await priceAgain();
      expect(others.uses).toEqual({ total: 1, customer: 1 });
      expect(others.decision).toMatchObject({
        outcome: "refused",
        reason: "used_up",
      });
      expect((await priceAgain(MADE_UP)).uses).toEqual({
        total: 1,
        customer: 1,
      });
      // The booking itself: its own use is left out.
      const own = await priceAgain(held.booking_id);
      expect(own.uses).toEqual({ total: 0, customer: 0 });
      expect(couponOutcomeOf(own.decision)).toMatchObject({ applied: true });
      // And nothing was written by pricing it again.
      expect(await live(mine.id)).toHaveLength(1);
    } finally {
      await deleteTenant(tenant);
    }
  }, 60_000);
});

// --------------------------------------------------- both paths, end to end

describe("both booking paths, on real rows: decideDiscounts → quote() → reserve()", () => {
  let tenant: TestTenant;
  let bike: { id: string; units: string[] };
  const lines = (day: number) => [
    { productId: bike.id, start: at(day), end: at(day + 2), quantity: 1 },
  ];
  const staff = () => db("staff", tenant) as unknown as StaffDb;

  beforeAll(async () => {
    tenant = await createTenant("coupons-paths", thailand);
    // Open every day, 10:00 to 18:00 at the shop (11:00 is 04:00 UTC).
    await service
      .from("location_hours")
      .insert(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          tenant_id: tenant.id,
          location_id: tenant.locationId,
          weekday,
          open: "10:00",
          close: "18:00",
        })),
      )
      .throwOnError();
    await settings({ coupons_enabled: true }, tenant);
    bike = await vehicle(6, tenant);
    await priceByDay(bike.id, 30_000, tenant);
  }, 120_000);

  afterAll(async () => {
    await deleteTenant(tenant);
  });

  it("the counter and the booking page: the price is quote()'s with the coupon, and the redemption holds what the quote says it took", async () => {
    const mine = await coupon(
      { kind: "fixed", amount: 20_000, max_uses: 2 },
      tenant,
    );
    const counter = await bookAsStaff(staff(), tenant.id, {
      channel: "phone",
      locationId: tenant.locationId,
      lines: lines(1),
      couponCode: ` ${mine.code.toLowerCase()} `,
    });
    if (!counter.ok) throw new Error(counter.reason);
    // Two days at ฿300, less ฿200.
    expect(counter.quote.totals.total).toBe(BigInt(40_000));
    const online = await bookOnline(
      {
        tenantId: tenant.id,
        locationId: tenant.locationId,
        channel: "booking_page",
        mode: "instant",
        lines: lines(1),
        couponCode: mine.code,
      },
      { db: server },
    );
    if (!online.ok) throw new Error(online.reason);
    expect(online.quote.totals.total).toBe(BigInt(40_000));
    expect(
      (await redemptions(mine.id)).map((r) => [r.booking_id, r.amount]),
    ).toEqual([
      [counter.booking_id, 20_000],
      [online.bookingId, 20_000],
    ]);
    // Both uses are gone: the rules refuse the third before reserve().
    const before = written(tenant);
    expect(
      await bookOnline(
        {
          tenantId: tenant.id,
          locationId: tenant.locationId,
          channel: "booking_page",
          mode: "instant",
          lines: lines(1),
          couponCode: mine.code,
        },
        { db: server },
      ),
    ).toEqual({
      ok: false,
      reason: "coupon_refused",
      line: null,
      coupon: "used_up",
    });
    expect(
      await bookAsStaff(staff(), tenant.id, {
        channel: "walk_in",
        locationId: tenant.locationId,
        lines: lines(1),
        couponCode: mine.code,
      }),
    ).toEqual({ ok: false, reason: "coupon_refused", coupon: "used_up" });
    expect(written(tenant)).toBe(before);
  });

  it("a coupon that is good but not applied writes no redemption: the returning-customer discount is better, or the coupon would take nothing", async () => {
    await settings(
      { returning_enabled: true, returning_percent_bp: 5000 },
      tenant,
    );
    try {
      const small = await coupon({ percent_bp: 1000 }, tenant);
      const better = await bookAsStaff(staff(), tenant.id, {
        channel: "walk_in",
        locationId: tenant.locationId,
        lines: lines(10),
        couponCode: small.code,
        completedRentals: 1,
      });
      if (!better.ok) throw new Error(better.reason);
      expect(better.coupon).toMatchObject({
        applied: false,
        because: "returning_discount_is_better",
      });
      // Half off, not the coupon's 10%.
      expect(better.quote.totals.total).toBe(BigInt(30_000));
      expect(await redemptions(small.id)).toEqual([]);

      // 100% returning, and a coupon that stacks on it: nothing left to take.
      await settings({ returning_percent_bp: 10000 }, tenant);
      const stacking = await coupon(
        { kind: "fixed", amount: 5_000, with_returning_discount: true },
        tenant,
      );
      const nothing = await bookOnline(
        {
          tenantId: tenant.id,
          locationId: tenant.locationId,
          channel: "booking_page",
          mode: "instant",
          lines: lines(10),
          couponCode: stacking.code,
          completedRentals: 1,
        },
        { db: server },
      );
      if (!nothing.ok) throw new Error(nothing.reason);
      expect(nothing.coupon).toMatchObject({
        applied: false,
        because: "takes_nothing",
      });
      expect(nothing.quote.totals.total).toBe(BigInt(0));
      expect(await redemptions(stacking.id)).toEqual([]);
      // Both bookings are there all the same.
      expect(
        (
          await service
            .from("reservations")
            .select("id")
            .in("booking_id", [better.booking_id, nothing.bookingId])
            .throwOnError()
        ).data,
      ).toHaveLength(2);
    } finally {
      await settings({ returning_enabled: false }, tenant);
    }
  });

  it("a code Postgres can't hold (a NUL, a lone surrogate): both paths answer coupon_refused, unknown, with nothing written, where the read would have thrown", async () => {
    const before = written(tenant);
    for (const typed of [
      `SAVE${String.fromCharCode(0)}10`,
      `SAVE${String.fromCharCode(0xd83c)}10`,
    ]) {
      expect(
        await bookOnline(
          {
            tenantId: tenant.id,
            locationId: tenant.locationId,
            channel: "booking_page",
            mode: "instant",
            lines: lines(50),
            couponCode: typed,
          },
          { db: server },
        ),
        JSON.stringify(typed),
      ).toEqual({
        ok: false,
        reason: "coupon_refused",
        line: null,
        coupon: "unknown",
      });
      expect(
        await bookAsStaff(staff(), tenant.id, {
          channel: "walk_in",
          locationId: tenant.locationId,
          lines: lines(50),
          couponCode: typed,
        }),
        JSON.stringify(typed),
      ).toEqual({ ok: false, reason: "coupon_refused", coupon: "unknown" });
    }
    expect(written(tenant)).toBe(before);
  });

  it("a coupon archived, switched off or used up between the quote and reserve(): the rules passed, and reserve() refuses under the lock with nothing written", async () => {
    const owner = db("owner", tenant);
    /** A member's client that does something else just before reserve(). */
    const then = (between: () => Promise<unknown>): StaffDb => ({
      rpc(fn, args) {
        const call = () => staff().rpc(fn, args);
        return fn === "reserve" ? between().then(call) : call();
      },
    });
    const attempt = (c: Saved, between: () => Promise<unknown>) =>
      bookAsStaff(then(between), tenant.id, {
        channel: "walk_in",
        locationId: tenant.locationId,
        lines: lines(30),
        couponCode: c.code,
      });

    const archived = await coupon({}, tenant);
    const off = await coupon({}, tenant);
    const last = await coupon({ max_uses: 1 }, tenant);
    const before = written(tenant);
    expect(
      await attempt(archived, () =>
        save(owner, tenant, { id: archived.id, archived: true }),
      ),
    ).toEqual({ ok: false, reason: "coupon_not_valid", line: null });
    expect(
      await attempt(off, () =>
        save(owner, tenant, { id: off.id, active: false }),
      ),
    ).toEqual({ ok: false, reason: "coupon_not_valid", line: null });
    // "Accept coupons" switched off in between.
    const stillOn = await coupon({}, tenant);
    expect(
      await attempt(stillOn, () =>
        settings({ coupons_enabled: false }, tenant),
      ),
    ).toEqual({ ok: false, reason: "coupon_not_valid", line: null });
    await settings({ coupons_enabled: true }, tenant);
    expect(written(tenant)).toBe(before);
    // The last use taken by the booking page in between.
    expect(
      await attempt(last, () =>
        bookOnline(
          {
            tenantId: tenant.id,
            locationId: tenant.locationId,
            channel: "booking_page",
            mode: "instant",
            lines: lines(30),
            couponCode: last.code,
          },
          { db: server },
        ),
      ),
    ).toEqual({ ok: false, reason: "coupon_used_up", line: null });
    expect(await live(last.id)).toHaveLength(1);
    // The same the other way round: the page's quote, then the counter's
    // booking takes the last use before the page's reserve().
    const other = await coupon({ max_uses: 1 }, tenant);
    const slowPage: OnlineDb = {
      rpc(fn, args) {
        const call = () => server.rpc(fn, args);
        return fn === "reserve"
          ? bookAsStaff(staff(), tenant.id, {
              channel: "phone",
              locationId: tenant.locationId,
              lines: lines(30),
              couponCode: other.code,
            }).then(call)
          : call();
      },
    };
    expect(
      await bookOnline(
        {
          tenantId: tenant.id,
          locationId: tenant.locationId,
          channel: "booking_page",
          mode: "instant",
          lines: lines(30),
          couponCode: other.code,
        },
        { db: slowPage },
      ),
    ).toEqual({ ok: false, reason: "coupon_used_up", line: null });
    expect(await live(other.id)).toHaveLength(1);
  }, 60_000);
});

// ------------------------------------------------------------ the lock order

describe("the lock order: the coupon's row comes after every advisory lock and the product's row", () => {
  it("a save of the coupon, written and not yet saved: a booking with that coupon waits at its row with its product and unit locks in hand, then reads the coupon again and is refused", async () => {
    const bike = await vehicle(1);
    const mine = await coupon();
    const marker = `coupon-save-held-${tag}-${++counter}`;
    const holder = sqlBackground(`
      begin;
      ${actingAs(shop.members.owner.id)}
      select platform.save_coupon('${shop.id}', '{"id": "${mine.id}", "archived": true}'::jsonb);
      select pg_sleep(5) /* ${marker} */;
      commit;
    `);
    await holding(marker, holder);
    const before = written(shop);
    const booking = staffBook(days(bike, 1), { coupon: taking(mine) });
    expect(await waitingForRow(marker)).toBe(
      "waiting for a row; product locks: 1, unit locks: 1",
    );
    const result = await booking;
    noDeadlock([result]);
    // It was valid when the booking was sent; under the lock it is archived.
    expect(result.data).toEqual({
      ok: false,
      reason: "coupon_not_valid",
      line: null,
    });
    expect(written(shop)).toBe(before);
    expect((await holder).failed).toBe("");
  }, 60_000);

  it("a booking with the coupon, written and not yet saved: a save of that coupon waits for its row holding no advisory lock, and a second booking after its last use waits there too and is refused", async () => {
    const [bike, other] = await Promise.all([vehicle(1), vehicle(1)]);
    const mine = await coupon({ max_uses: 1 });
    const marker = `coupon-booking-held-${tag}-${++counter}`;
    const holder = sqlBackground(`
      begin;
      ${actingAs(null)}
      select platform.reserve('${shop.id}', '${JSON.stringify(
        request(shop, "booking_page", "instant", days(bike, 1), {
          coupon: taking(mine),
        }).p_request,
      )}'::jsonb);
      select pg_sleep(5) /* ${marker} */;
      commit;
    `);
    await holding(marker, holder);
    const saving = save(db("owner"), shop, { id: mine.id, name: "Waited" });
    expect(await waitingForRow(marker)).toBe(
      "waiting for a row; product locks: 0, unit locks: 0",
    );
    // Another product, so only the coupon's row is in its way.
    const second = staffBook(days(other, 1), { coupon: taking(mine) });
    const [saved, late] = await Promise.all([saving, second]);
    noDeadlock([saved, late]);
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({ name: "Waited" });
    expect(late.data).toEqual({
      ok: false,
      reason: "coupon_used_up",
      line: null,
    });
    expect((await holder).failed).toBe("");
    expect(await live(mine.id)).toHaveLength(1);
  }, 60_000);

  it("a cancel takes the coupon's row before the reservations: a booking after the last use waits behind it and gets the use that came back", async () => {
    const [bike, other] = await Promise.all([vehicle(1), vehicle(1)]);
    const mine = await coupon({ max_uses: 1 });
    const first = booked(
      await staffBook(days(bike, 1), { coupon: taking(mine) }),
    );
    const marker = `coupon-cancel-held-${tag}-${++counter}`;
    const holder = sqlBackground(`
      begin;
      ${actingAs(shop.members.staff.id)}
      select platform.cancel_reservation('${shop.id}', '${first.booking_id}');
      select pg_sleep(5) /* ${marker} */;
      commit;
    `);
    await holding(marker, holder);
    const waiting = pageBook(days(other, 1), { coupon: taking(mine) });
    expect(await waitingForRow(marker)).toBe(
      "waiting for a row; product locks: 1, unit locks: 1",
    );
    const result = await waiting;
    noDeadlock([result]);
    const taken = booked(result);
    expect((await holder).failed).toBe("");
    expect((await live(mine.id)).map((r) => r.booking_id)).toEqual([
      taken.booking_id,
    ]);
  }, 60_000);

  it("save_coupon() gives up on a lock after its own 6 seconds with 55P03, before the API's 8, and lib/coupon-save.ts answers try_again with nothing written", async () => {
    const mine = await coupon();
    const marker = `coupon-row-held-${tag}-${++counter}`;
    const holder = sqlBackground(`
      begin;
      select 1 from platform.coupons where id = '${mine.id}' for update;
      select pg_sleep(9) /* ${marker} */;
      commit;
    `);
    await holding(marker, holder);
    const before = couponRows(shop);
    const started = Date.now();
    // One call, through the API as the signed-in owner. (Two at once would
    // queue behind each other, and the second's two waits add up to the
    // API's 8 seconds: stage 5 found the same with move_unit().) What the
    // database itself said is kept as it passes.
    let direct: { data: unknown; error: Failure } | undefined;
    const seeing: CouponSaveDb = {
      rpc: (fn, args) =>
        Promise.resolve(
          (db("owner") as unknown as CouponSaveDb).rpc(fn, args),
        ).then((result) => (direct = result)),
    };
    const answer = await saveCoupon(seeing, shop.id, {
      id: mine.id,
      name: "Never",
    });
    const waited = Date.now() - started;
    // lock_not_available, not the statement timeout (57014).
    expect(direct?.error?.code).toBe("55P03");
    expect(direct?.error?.message).toMatch(/lock timeout/);
    expect(direct?.data).toBeNull();
    expect(answer).toEqual({ ok: false, reason: "try_again" });
    expect(waited).toBeGreaterThan(5_500);
    expect(waited).toBeLessThan(8_000);
    expect(couponRows(shop)).toBe(before);
    expect((await holder).failed).toBe("");
    // Sent again once the row is free, it goes through; and the database's
    // refusals come back as answers.
    expect(
      await saveCoupon(db("owner") as unknown as CouponSaveDb, shop.id, {
        id: mine.id,
        name: "Now",
      }),
    ).toMatchObject({ ok: true, coupon: { id: mine.id, name: "Now" } });
    expect(
      await saveCoupon(db("staff") as unknown as CouponSaveDb, shop.id, {
        id: mine.id,
        name: "No",
      }),
    ).toEqual({ ok: false, reason: "only_owner_or_manager" });
    expect(
      await saveCoupon(db("owner") as unknown as CouponSaveDb, shop.id, {
        code: mine.code,
        kind: "percent",
        percent_bp: 1,
      }),
    ).toEqual({ ok: false, reason: "code_taken" });
  }, 60_000);
});

// ------------------------------------------------------------------ the races

describe("races for a coupon's last use: exactly one booking gets it, and no deadlock", () => {
  const shops = [
    ["Bangkok", () => shop],
    ["New York", () => newYork],
    ["Saigon", () => saigon],
  ] as const;

  /** Exactly one of the results is a booking; the rest are coupon_used_up. */
  const oneWinner = async (c: Saved, results: Result[], what: string) => {
    noDeadlock(results);
    const outcomes = results.map(refusal).sort();
    expect(outcomes, what).toEqual([
      ...Array.from({ length: results.length - 1 }, () => "coupon_used_up"),
      "ok",
    ]);
    const winner = results.find((r) => r.data!.ok)!.data as Booked;
    // One use, the winner's; and nothing of the losers is left behind.
    expect(
      (await live(c.id)).map((r) => r.booking_id),
      what,
    ).toEqual([winner.booking_id]);
    return winner;
  };

  for (const [where, tenantOf] of shops) {
    it(`${where}: two bookings after a coupon's last use, staff against staff, online against online and staff against online, ${ROUNDS} rounds each`, async () => {
      const tenant = tenantOf();
      // Enough units that stock never decides it: the coupon does.
      const [a, b] = await Promise.all([
        vehicle(2, tenant),
        vehicle(2, tenant),
      ]);
      const pairs: [string, (c: Saved, day: number) => Promise<Result>[]][] = [
        [
          "staff against staff",
          // Two products: with one, the product's advisory lock would
          // make them take turns whether or not the coupon's row is locked.
          (c, day) => [
            staffBook(days(a, day), { tenant, coupon: taking(c) }),
            staffBook(days(b, day), {
              tenant,
              role: "manager",
              coupon: taking(c),
            }),
          ],
        ],
        [
          "online against online",
          (c, day) => [
            pageBook(days(b, day), { tenant, coupon: taking(c) }),
            pageBook(days(a, day), { tenant, coupon: taking(c) }),
          ],
        ],
        [
          "staff against online",
          (c, day) => [
            staffBook(days(b, day), { tenant, coupon: taking(c) }),
            pageBook(days(a, day), { tenant, coupon: taking(c) }),
          ],
        ],
      ];
      let day = 0;
      for (const [what, send] of pairs) {
        for (let round = 0; round < ROUNDS; round++) {
          day += 3;
          const c = await coupon({ max_uses: 1 }, tenant);
          const before = (
            await service
              .from("reservations")
              .select("id")
              .eq("tenant_id", tenant.id)
              .throwOnError()
          ).data!.length;
          const results = await Promise.all(send(c, day));
          raceRounds++;
          await oneWinner(c, results, `${where}, ${what}, round ${round}`);
          // The loser wrote no reservation and no block.
          expect(
            (
              await service
                .from("reservations")
                .select("id")
                .eq("tenant_id", tenant.id)
                .throwOnError()
            ).data!.length,
          ).toBe(before + 1);
        }
      }
      expect(deadlocks()).toBe(deadlocksBefore);
    }, 300_000);

    it(`${where}: two coupons, each with one use left, booked with two products named in opposite orders by four bookings at once, ${ROUNDS} rounds: one booking per coupon, no deadlock`, async () => {
      const tenant = tenantOf();
      const [a, b] = await Promise.all([
        vehicle(4, tenant),
        vehicle(4, tenant),
      ]);
      for (let round = 0; round < ROUNDS; round++) {
        const day = round * 3 + 1;
        const [first, second] = await Promise.all([
          coupon({ max_uses: 1 }, tenant),
          coupon({ max_uses: 1 }, tenant),
        ]);
        const ab = [...days(a, day), ...days(b, day)];
        const ba = [...days(b, day), ...days(a, day)];
        const results = await Promise.all([
          staffBook(ab, { tenant, coupon: taking(first) }),
          pageBook(ba, { tenant, coupon: taking(second) }),
          pageBook(ba, { tenant, coupon: taking(first) }),
          staffBook(ab, { tenant, role: "owner", coupon: taking(second) }),
        ]);
        raceRounds++;
        const what = `${where}, round ${round}`;
        await oneWinner(first, [results[0], results[2]], what);
        await oneWinner(second, [results[1], results[3]], what);
        // Each winner has both of its products: whole, or not at all.
        const blocks = (
          await service
            .from("unit_blocks")
            .select("id")
            .in("unit_id", [...a.units, ...b.units])
            .not("reservation_id", "is", null)
            .throwOnError()
        ).data!.length;
        expect(blocks, what).toBe((round + 1) * 4);
      }
      expect(deadlocks()).toBe(deadlocksBefore);
    }, 300_000);

    it(`${where}: bookings, a cancel that gives the use back, a hold running out, a save of the coupon and the read, all at once, ${ROUNDS} rounds: never more live uses than the coupon allows, every call answers cleanly`, async () => {
      const tenant = tenantOf();
      const [a, b] = await Promise.all([
        vehicle(3, tenant),
        vehicle(3, tenant),
      ]);
      for (let round = 0; round < ROUNDS; round++) {
        const day = round * 3 + 1;
        const c = await coupon({ max_uses: 2 }, tenant);
        // Both uses taken: one by a booking, one by a hold that has run out.
        const earlier = booked(
          await staffBook(days(a, day), { tenant, coupon: taking(c) }),
        );
        const hold = booked(
          await pageBook(days(b, day), {
            tenant,
            hold: true,
            coupon: taking(c),
          }),
        );
        await service
          .from("reservations")
          .update({
            hold_expires_at: new Date(Date.now() - 1000).toISOString(),
          })
          .eq("booking_id", hold.booking_id)
          .throwOnError();
        const [one, two, three, cancelled, saved, found, swept] =
          await Promise.all([
            staffBook(days(a, day), { tenant, coupon: taking(c) }),
            pageBook(days(b, day), { tenant, coupon: taking(c) }),
            pageBook([...days(b, day), ...days(a, day)], {
              tenant,
              coupon: taking(c),
            }),
            Promise.resolve(
              db("staff", tenant).rpc("cancel_reservation", {
                p_tenant_id: tenant.id,
                p_booking_id: earlier.booking_id,
              }),
            ) as Promise<Result>,
            save(db("owner", tenant), tenant, {
              id: c.id,
              name: `Round ${round}`,
            }),
            Promise.resolve(
              db("manager", tenant).rpc("coupon_inputs", {
                p_tenant_id: tenant.id,
                p_code: c.code,
              }),
            ),
            Promise.resolve(service.rpc("release_expired_holds")),
          ]);
        raceRounds++;
        const what = `${where}, round ${round}`;
        noDeadlock([
          one,
          two,
          three,
          cancelled,
          saved,
          found as never,
          swept as never,
        ]);
        for (const result of [cancelled, saved, found, swept]) {
          expect(result.error, what).toBeNull();
        }
        expect(cancelled.data, what).toMatchObject({ ok: true });
        expect(saved.data, what).toMatchObject({ name: `Round ${round}` });
        for (const result of [one, two, three]) {
          expect(["ok", "coupon_used_up", "unavailable"], what).toContain(
            refusal(result),
          );
        }
        // The hold had run out, so at least one use was free from the start.
        const won = [one, two, three].filter((r) => r.data!.ok).length;
        expect(won, what).toBeGreaterThanOrEqual(1);
        expect(won, what).toBeLessThanOrEqual(2);
        // Never more live uses than the coupon allows, and each one is a
        // booking that is really there.
        const uses = await live(c.id);
        expect(uses.length, what).toBe(won);
        const standing = (
          await service
            .from("reservations")
            .select("booking_id")
            .in(
              "booking_id",
              uses.map((u) => u.booking_id),
            )
            .eq("state", "reserved")
            .throwOnError()
        ).data!;
        expect(new Set(standing.map((r) => r.booking_id)).size, what).toBe(won);
        // Tidy: the round's bookings go, so the next round has its units.
        for (const result of [one, two, three]) {
          if (result.data!.ok)
            await service.rpc("cancel_reservation", {
              p_tenant_id: tenant.id,
              p_booking_id: (result.data as Booked).booking_id,
            });
        }
      }
      expect(deadlocks()).toBe(deadlocksBefore);
    }, 300_000);
  }
});

// ----------------------------------------------------------- the currency lock

// --------------------------------------------- after the review of PR 48

describe("after the review of PR 48", () => {
  /** The database's own clock: the test machine's may not agree with it. */
  const expiresIn = (bookingId: string, seconds: number) => {
    const { failed } = sql(`
      update platform.reservations
      set hold_expires_at = clock_timestamp() + interval '${seconds} seconds'
      where booking_id = '${bookingId}';
    `);
    expect(failed).toBe("");
  };
  const expired = (bookingId: string) =>
    until(`
      select 'expired' from platform.reservations
      where booking_id = '${bookingId}'
        and hold_expires_at + interval '300 milliseconds' < clock_timestamp()
      limit 1;
    `);

  it("finding 1: a confirm in flight across the hold's expiry holds the coupon's row, so a booking of another product after the same coupon's last use waits for it and is refused: exactly one live use", async () => {
    const [bike, other] = await Promise.all([vehicle(1), vehicle(1)]);
    const mine = await coupon({ max_uses: 1 });
    const hold = booked(
      await staffBook(days(bike, 1), { hold: true, coupon: taking(mine) }),
    );
    expiresIn(hold.booking_id, 3);
    // The confirm starts before the hold runs out, and is not saved until
    // well after it has.
    const marker = `confirm-in-flight-${tag}-${++counter}`;
    const confirming = sqlBackground(`
      begin;
      ${actingAs(shop.members.staff.id)}
      select 'confirmed:' || (platform.confirm_hold('${shop.id}', '${hold.booking_id}') ->> 'ok');
      select pg_sleep(6) /* ${marker} */;
      commit;
    `);
    await holding(marker, confirming);
    await expired(hold.booking_id);
    // By now coupon_uses() no longer counts the hold. Without the coupon's
    // row in confirm_hold() this booking takes the use at once, and the
    // confirm then commits a second one.
    const late = await pageBook(days(other, 1), { coupon: taking(mine) });
    const done = await confirming;
    expect(done.failed).toBe("");
    expect(done.out).toContain("confirmed:true");
    noDeadlock([late]);
    expect(late.data).toEqual({
      ok: false,
      reason: "coupon_used_up",
      line: null,
    });
    expect((await live(mine.id)).map((r) => r.booking_id)).toEqual([
      hold.booking_id,
    ]);
    expect((await read(db("staff"), shop, mine.code)).uses?.total).toBe(1);
    expect(
      (
        await service
          .from("reservations")
          .select("state")
          .eq("booking_id", hold.booking_id)
          .throwOnError()
      ).data,
    ).toEqual([{ state: "reserved" }]);
  }, 60_000);

  it("finding 1, the other way round: the booking takes the use first, and the confirm that comes after the hold ran out is refused; a confirm that waits for a lock past the expiry is judged by the clock, not by when it began", async () => {
    const [bike, other] = await Promise.all([vehicle(1), vehicle(1)]);
    const mine = await coupon({ max_uses: 1 });
    const hold = booked(
      await staffBook(days(bike, 1), { hold: true, coupon: taking(mine) }),
    );
    expiresIn(hold.booking_id, 1);
    await expired(hold.booking_id);
    const taker = booked(
      await pageBook(days(other, 1), { coupon: taking(mine) }),
    );
    expect(
      await confirmHold(staffDb("staff"), shop.id, hold.booking_id),
    ).toMatchObject({ ok: false, reason: "hold_expired" });
    expect((await read(db("staff"), shop, mine.code)).uses?.total).toBe(1);
    await service.rpc("release_expired_holds");
    expect((await live(mine.id)).map((r) => r.booking_id)).toEqual([
      taker.booking_id,
    ]);

    // A counter hold, confirmed in time but stuck behind the product's
    // lock until after it has run out: before, a hold that was not Moto
    // Mangos' was judged at the call's start and confirmed.
    const third = await vehicle(1);
    const waiting = booked(await staffBook(days(third, 1), { hold: true }));
    const marker = `confirm-waits-${tag}-${++counter}`;
    const holder = sqlBackground(`
      begin;
      select platform_private.lock_products_stock(
        array['${third.id}']::uuid[], array['${shop.locationId}']::uuid[]);
      select pg_sleep(4) /* ${marker} */;
      commit;
    `);
    await holding(marker, holder);
    expiresIn(waiting.booking_id, 2);
    const answer = await confirmHold(
      staffDb("staff"),
      shop.id,
      waiting.booking_id,
    );
    expect((await holder).failed).toBe("");
    expect(answer).toMatchObject({ ok: false, reason: "hold_expired" });
    const states = (
      await service
        .from("reservations")
        .select("state")
        .eq("booking_id", waiting.booking_id)
        .throwOnError()
    ).data!;
    expect(states.map((r) => r.state)).not.toContain("reserved");
  }, 60_000);

  it("finding 2: a coupon said to have taken 0 is invalid_request, from the counter and online, and writes nothing; the column refuses 0 too", async () => {
    const bike = await vehicle(2);
    const mine = await coupon();
    const before = written(shop);
    for (const amount of [0, "0", "000"]) {
      for (const result of [
        await staffBook(days(bike, 1), { coupon: taking(mine, amount) }),
        await pageBook(days(bike, 1), { coupon: taking(mine, amount) }),
      ]) {
        expect(result.error?.message, String(amount)).toBe("invalid_request");
        expect(result.error?.code, String(amount)).toBe("22023");
        expect(result.data).toBeNull();
      }
    }
    expect(written(shop)).toBe(before);
    // One minor unit is a use.
    booked(await staffBook(days(bike, 1), { coupon: taking(mine, 1) }));
    expect((await live(mine.id)).map((r) => r.amount)).toEqual([1]);
    const byHand = await service.from("coupon_redemptions").insert({
      tenant_id: shop.id,
      coupon_id: mine.id,
      booking_id: MADE_UP,
      amount: 0,
    });
    expect(byHand.error?.message).toContain("coupon_redemptions_amount_check");
  });

  it("finding 3: reserve() takes no coupon on the api channel (invalid_request), though it books there without one", async () => {
    const bike = await vehicle(2);
    const mine = await coupon();
    const api = (c?: unknown) =>
      Promise.resolve(
        service.rpc(
          "reserve",
          request(shop, "api", "instant", days(bike, 1), {
            coupon: c,
          }) as never,
        ),
      ) as Promise<Result>;
    const before = written(shop);
    const refused = await api(taking(mine));
    expect(refused.error?.message).toBe("invalid_request");
    expect(refused.error?.code).toBe("22023");
    expect(written(shop)).toBe(before);
    booked(await api());
    booked(await api(null));
    expect(await live(mine.id)).toEqual([]);
  });

  it('finding 3: the shop\'s "Accept coupons" switch is read again under the lock: off, or never saved, is coupon_not_valid with nothing written', async () => {
    const tenant = await createTenant("coupons-switch", thailand);
    try {
      const bike = await vehicle(3, tenant);
      const mine = await coupon({}, tenant);
      const both = async () => [
        refusal(
          await staffBook(days(bike, 1), { tenant, coupon: taking(mine) }),
        ),
        refusal(
          await pageBook(days(bike, 1), { tenant, coupon: taking(mine) }),
        ),
      ];
      // Never saved: the shop accepts no coupons.
      const before = written(tenant);
      expect(await both()).toEqual(["coupon_not_valid", "coupon_not_valid"]);
      expect(written(tenant)).toBe(before);
      await settings({ coupons_enabled: true }, tenant);
      expect(await both()).toEqual(["ok", "ok"]);
      await settings({ coupons_enabled: false }, tenant);
      const after = written(tenant);
      expect(await both()).toEqual(["coupon_not_valid", "coupon_not_valid"]);
      expect(written(tenant)).toBe(after);
      // A booking with no coupon is not the switch's business.
      booked(await staffBook(days(bike, 1), { tenant }));
      expect(await live(mine.id)).toHaveLength(2);
    } finally {
      await deleteTenant(tenant);
    }
  }, 60_000);

  it("finding 5: every code point in all 17 planes through both normalisers: no difference, and exactly the 26 letters and the 29 removed characters change", () => {
    const { out, failed } = sql(`
      select coalesce(string_agg(
        i || ':' || encode(convert_to(
          platform_private.normalize_coupon_code(chr(i)), 'utf8'), 'hex'),
        ',' order by i), '')
      from generate_series(1, 1114111) i
      where (i < 55296 or i > 57343)
        and platform_private.normalize_coupon_code(chr(i)) is distinct from chr(i);
    `);
    expect(failed).toBe("");
    const changed: string[] = [];
    let seen = 0;
    for (let point = 1; point <= 0x10ffff; point++) {
      // Surrogates are not characters: Postgres can't hold one.
      if (point >= 0xd800 && point <= 0xdfff) continue;
      seen++;
      const typed = String.fromCodePoint(point);
      const stored = normalizeCouponCode(typed);
      if (stored !== typed) changed.push(`${point}:${hex(stored)}`);
    }
    expect(seen).toBe(0x10ffff - 0x800);
    // The same code points change, to the same bytes, in both.
    expect(changed.join(",")).toBe(out);
    expect(changed).toHaveLength(26 + 29);
    // And a code of several of them together.
    const mixed = [0x61, 0xa0, 0x7a, 0x200b, 0xdf, 0xff21, 0x39, 0x3000]
      .map((point) => String.fromCodePoint(point))
      .join("");
    expect(
      sql(
        `select encode(convert_to(platform_private.normalize_coupon_code(
           convert_from(decode('${hex(mixed)}', 'hex'), 'utf8')), 'utf8'), 'hex');`,
      ).out,
    ).toBe(hex(normalizeCouponCode(mixed)));
  }, 120_000);

  it("finding 6: a code Postgres can't hold (a NUL, a lone surrogate) is never sent to the database: no coupon, as for any code that could not be saved", async () => {
    const nul = `SAVE${String.fromCharCode(0)}10`;
    const surrogate = `SAVE${String.fromCharCode(0xd83c)}10`;
    // Sent as they are, the API itself refuses them: an error, not an answer.
    for (const typed of [nul, surrogate]) {
      const raw = await service.rpc("coupon_inputs", {
        p_tenant_id: shop.id,
        p_code: typed,
      });
      expect(raw.error, JSON.stringify(typed)).not.toBeNull();
      expect(await read(service, shop, typed)).toEqual({
        coupon: null,
        uses: null,
      });
      expect(await read(db("staff"), shop, typed)).toEqual({
        coupon: null,
        uses: null,
      });
    }
  });

  it("finding 7: a held booking priced again finds its coupon by the id on its redemption: archived since, with its code used again, it is still that coupon and not the new one", async () => {
    const bike = await vehicle(2);
    const typed = code("REUSE");
    const first = await coupon({ code: typed, max_uses: 1 });
    const hold = booked(
      await staffBook(days(bike, 1), { hold: true, coupon: taking(first) }),
    );
    await save(db("owner"), shop, { id: first.id, archived: true });
    const second = await coupon({ code: typed, kind: "fixed", amount: 100 });
    const staff = db("staff");
    // Anyone else typing the code gets the new coupon.
    expect((await read(staff, shop, typed)).coupon).toMatchObject({
      id: second.id,
      archived: false,
    });
    expect(
      (await read(staff, shop, typed, { bookingId: MADE_UP })).coupon?.id,
    ).toBe(second.id);
    // The booking that holds a use of the first: the first, as it is now
    // (archived), with its own use left out of the count.
    expect(
      await read(staff, shop, typed, { bookingId: hold.booking_id }),
    ).toMatchObject({
      coupon: { id: first.id, archived: true, kind: "percent" },
      uses: { total: 0, customer: 0 },
    });
    expect(
      (await read(service, shop, typed, { bookingId: hold.booking_id })).coupon
        ?.id,
    ).toBe(first.id);
    // Another code typed for that booking is looked up by the code.
    const other = await coupon();
    expect(
      (await read(staff, shop, other.code, { bookingId: hold.booking_id }))
        .coupon?.id,
    ).toBe(other.id);
    // Once the booking's use is given back, it is like anyone else.
    await cancelReservation(staffDb("staff"), shop.id, {
      bookingId: hold.booking_id,
    });
    expect(
      (await read(staff, shop, typed, { bookingId: hold.booking_id })).coupon
        ?.id,
    ).toBe(second.id);
  });

  it("finding 8: a coupon with no limit is not counted under the lock; one with a limit still is", () => {
    const source = sql(
      `select prosrc from pg_proc where oid = 'platform.reserve(uuid, jsonb)'::regprocedure;`,
    ).out;
    const guardAt = source.indexOf("if v_coupon.max_uses is not null");
    const countAt = source.indexOf("platform_private.coupon_uses(");
    expect(guardAt).toBeGreaterThan(0);
    expect(countAt).toBeGreaterThan(guardAt);
    // One call of it, inside that condition.
    expect(source.split("platform_private.coupon_uses(")).toHaveLength(2);
  });
});

// ----------------------------------------------------------- the currency lock

describe("the currency lock counts a coupon that holds an amount of money", () => {
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

  it("a fixed-amount coupon locks it, archived or not; so does a minimum spend on a percentage coupon", async () => {
    const makers: [string, Record<string, unknown>][] = [
      ["a fixed amount", { kind: "fixed", amount: 20_000 }],
      [
        "a minimum spend",
        { kind: "percent", percent_bp: 1000, min_spend: 50_000 },
      ],
    ];
    for (const [what, values] of makers) {
      const fresh = await createTenant("coupon-lock", thailand);
      try {
        expect(await locked(fresh), what).toBe(false);
        const made = await coupon(values, fresh);
        expect(await locked(fresh), what).toBe(true);
        expect((await change(fresh)).error?.message, what).toBe(
          "currency_locked",
        );
        // Archived: its amount is still an amount in that currency.
        await save(db("owner", fresh), fresh, { id: made.id, archived: true });
        expect(await locked(fresh), what).toBe(true);
        expect((await change(fresh)).error?.message, what).toBe(
          "currency_locked",
        );
        // Another shop's member is told nothing.
        expect(
          (
            await db("owner", rival).rpc("currency_locked", {
              p_tenant_id: fresh.id,
            })
          ).data,
        ).toBe(false);
      } finally {
        await deleteTenant(fresh);
      }
    }
  }, 120_000);

  it("a percentage coupon with no minimum spend holds no amount: the currency can still change, and the coupon follows the shop", async () => {
    const fresh = await createTenant("coupon-unlocked", thailand);
    try {
      const made = await coupon({ percent_bp: 1500, max_uses: 3 }, fresh);
      expect(made.currency).toBe("THB");
      expect(await locked(fresh)).toBe(false);
      expect((await change(fresh)).data).toEqual([{ currency: "USD" }]);
      expect((await read(service, fresh, made.code)).coupon?.currency).toBe(
        "USD",
      );
      // Given a fixed amount now, it is in the new currency and locks it.
      const fixed = await save(db("owner", fresh), fresh, {
        id: made.id,
        kind: "fixed",
        amount: 500,
      });
      expect(fixed.data).toMatchObject({ currency: "USD", amount: 500 });
      expect(await locked(fresh)).toBe(true);
      const back = await service
        .from("tenants")
        .update({ currency: "THB" })
        .eq("id", fresh.id)
        .select("currency");
      expect(back.error?.message).toBe("currency_locked");
    } finally {
      await deleteTenant(fresh);
    }
  }, 60_000);
});

// ------------------------------------------------------------------ the guard

describe("the migration's guard", () => {
  it("stops, with nothing changed, when one of the functions it re-creates is not the body it expects", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../../../../supabase/migrations/20261118000100_platform_coupons.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const guard = /do \$guard\$[\s\S]*?\$guard\$;/.exec(migration)?.[0];
    expect(guard).toBeDefined();
    // Eight functions, each with its 32-character MD5; confirm_hold() is
    // one of them (review of PR 48, finding 1).
    expect(guard!.match(/'[0-9a-f]{32}'/g)).toHaveLength(8);
    expect(guard).toContain("'platform.confirm_hold(uuid, uuid)'");
    // Today's bodies are the migration's own, not the ones it replaced: the
    // guard run again refuses, naming the first function that differs, and
    // changes nothing (it is one statement, and it only reads).
    const again = sql(guard!);
    expect(again.failed).toMatch(/is not the body main has \(md5 [0-9a-f]{32}/);
    // On a database that has the bodies it expects, it passes: each
    // function is put back as main had it, inside a transaction that is
    // undone, with the guard's own MD5 for it checked first.
    const names = [
      ...guard!.matchAll(
        /'((?:platform|platform_private)\.[a-z_]+\([^']*\))'/g,
      ),
    ].map((match) => match[1]);
    expect(names).toHaveLength(8);
    const drifted = sql(`
      begin;
      create or replace function platform.currency_locked(p_tenant_id uuid)
      returns boolean language sql stable security definer set search_path = ''
      as $$ select false; $$;
      ${guard}
      rollback;
    `);
    expect(drifted.failed).toMatch(/is not the body main has/);
  });
});

describe("after every test in this file", () => {
  it("Postgres counted no deadlock", () => {
    expect(deadlocks()).toBe(deadlocksBefore);
  });
});
