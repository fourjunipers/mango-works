/**
 * bookOnline(), the one server entry point for online bookings
 * (docs/phase-2-plan.md §2.3, §9.1; the owner's addition to Q5).
 *
 * Two things are held here.
 *
 * 1. On a spy: asked for a closed day, too little notice or too short a
 *    rental (or anything else offer() refuses), bookOnline() answers the
 *    reason and reserve() is never called. tests/db/booking-rules.test.ts
 *    holds the same against a real database that is left unchanged.
 * 2. A static test over both apps: no file but lib/book-online.ts, in either app
 *    or in packages/, can be a path to reserve() for an online channel. The detector is tried on
 *    made-up files first, so it is known to catch what it is there to catch.
 *
 * The third leg is in the database: reserve() refuses an online channel
 * from anyone but the service role, and a signed-out visitor or a Moto
 * Mangos customer can't execute it at all (tests/db/reservations.test.ts
 * and booking-rules.test.ts).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bookOnline,
  type OnlineBookingRequest,
  type OnlineDb,
} from "./book-online";
import type { AvailabilityRow, BookingInputs } from "./booking-inputs";
import type { PricingInputs } from "./pricing-inputs";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PLACE = "22222222-2222-4222-8222-222222222222";
const SCOOTER = "33333333-3333-4333-8333-333333333333";

// New York, June 2026 (UTC-4). Monday 15 June, 10:00 at the shop.
const utc = (iso: string) => new Date(`${iso}:00Z`);
const monday10 = utc("2026-06-15T14:00");
const wednesday10 = utc("2026-06-17T14:00");
const now = utc("2026-06-01T14:00");

const inputs = (
  location: Partial<BookingInputs["location"]> = {},
  listing: BookingInputs["products"][number]["listing"] = null,
): BookingInputs => ({
  shop: {
    currency: "USD",
    allow_overbooking: false,
    hold_minutes: 15,
    buffer_before_minutes: null,
    buffer_after_minutes: null,
  },
  location: {
    id: PLACE,
    timezone: "America/New_York",
    min_notice_hours: null,
    booking_cutoff_minutes: null,
    min_days_advance: null,
    min_days_walkin: null,
    hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      open: "09:00:00",
      close: "18:00:00",
    })),
    closures: [],
    ...location,
  },
  products: [
    {
      product_id: SCOOTER,
      type: "vehicle",
      buffer_before_minutes: null,
      buffer_after_minutes: null,
      min_days_advance: null,
      min_days_walkin: null,
      listing,
    },
  ],
});

const stock = (
  available: number,
  marketplace: AvailabilityRow["marketplace"] = null,
): AvailabilityRow[] => [
  {
    product_id: SCOOTER,
    location_id: PLACE,
    type: "vehicle",
    stock: 3,
    free: available,
    shortage_demand: 0,
    available,
    unlimited: false,
    marketplace,
  },
];

/** 45.00 a day, no tax, no deposit. */
const priced: PricingInputs = {
  settings: null,
  seasons: [],
  products: [
    {
      product_id: SCOOTER,
      product_name: "Scooter",
      product_type: "vehicle",
      currency: "USD",
      pricing_method: "per_period",
      price_amount: "4500",
      price_period: "day",
      base_amount: null,
      long_stay_day: null,
      deposit: null,
      replacement_price: null,
      taxable: false,
      tax_rate_bp: null,
      tax_profile_id: null,
      tax_profile_name: null,
      template: null,
    },
  ],
  extras: [],
};
const unpriced: PricingInputs = {
  settings: null,
  seasons: [],
  products: [],
  extras: [],
};

type Reply = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

/** A database that answers what it is told to, and remembers what it was asked. */
function spy(
  scene: {
    inputs?: BookingInputs;
    availability?: AvailabilityRow[];
    pricing?: PricingInputs;
    reserve?: Reply;
  } = {},
) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: OnlineDb = {
    rpc(fn, args) {
      calls.push({ fn, args });
      const answers: Record<string, Reply> = {
        booking_inputs: { data: scene.inputs ?? inputs(), error: null },
        availability: { data: scene.availability ?? stock(3), error: null },
        pricing_inputs: { data: scene.pricing ?? priced, error: null },
        reserve: scene.reserve ?? {
          data: {
            ok: true,
            booking_id: "b-1",
            lines: [{ reservation_id: "r-1", unit_ids: ["u-1"], shortage: 0 }],
          },
          error: null,
        },
      };
      return Promise.resolve(answers[fn]);
    },
  };
  const called = () => calls.map((call) => call.fn);
  return { db, calls, called, reserved: () => called().includes("reserve") };
}

const asked = (
  over: Partial<OnlineBookingRequest> = {},
): OnlineBookingRequest => ({
  tenantId: TENANT,
  locationId: PLACE,
  channel: "booking_page",
  mode: "instant",
  lines: [
    { productId: SCOOTER, start: monday10, end: wednesday10, quantity: 1 },
  ],
  ...over,
});

const READS = ["availability", "booking_inputs", "pricing_inputs"];

describe("bookOnline(): offer() first, reserve() only when it passes", () => {
  it("a closed day: the reason, and reserve() is never called", async () => {
    // 06:00 at the shop: three hours before it opens.
    const early = spy();
    expect(
      await bookOnline(
        asked({
          lines: [
            {
              productId: SCOOTER,
              start: utc("2026-06-15T10:00"),
              end: wednesday10,
              quantity: 1,
            },
          ],
        }),
        { db: early.db, now: () => now },
      ),
    ).toEqual({ ok: false, reason: "outside_hours", line: 0 });
    expect(early.reserved()).toBe(false);
    expect(early.called().sort()).toEqual(READS);

    // A closure on the return date.
    const holiday = spy({
      inputs: inputs({
        closures: [
          {
            start_date: "2026-06-17",
            end_date: "2026-06-17",
            repeats_yearly: false,
          },
        ],
      }),
    });
    expect(
      await bookOnline(asked(), { db: holiday.db, now: () => now }),
    ).toEqual({ ok: false, reason: "outside_hours", line: 0 });
    expect(holiday.reserved()).toBe(false);
  });

  it("too little notice: too_soon, and reserve() is never called", async () => {
    const s = spy({ inputs: inputs({ min_notice_hours: 48 }) });
    const dayBefore = new Date(monday10.getTime() - 24 * 3_600_000);
    expect(
      await bookOnline(asked(), { db: s.db, now: () => dayBefore }),
    ).toEqual({ ok: false, reason: "too_soon", line: 0 });
    expect(s.reserved()).toBe(false);
    // With the notice met, the same request goes through.
    const fine = spy({ inputs: inputs({ min_notice_hours: 48 }) });
    expect(
      (await bookOnline(asked(), { db: fine.db, now: () => now })).ok,
    ).toBe(true);
    expect(fine.reserved()).toBe(true);
  });

  it("too short a rental: too_short, and reserve() is never called", async () => {
    const s = spy({ inputs: inputs({ min_days_advance: 3 }) });
    expect(await bookOnline(asked(), { db: s.db, now: () => now })).toEqual({
      ok: false,
      reason: "too_short",
      line: 0,
    });
    expect(s.reserved()).toBe(false);
  });

  it("the second line refused: the answer names it, and nothing is reserved for the first", async () => {
    const s = spy({ availability: [...stock(3), ...stock(3)] });
    expect(
      await bookOnline(
        asked({
          lines: [
            {
              productId: SCOOTER,
              start: monday10,
              end: wednesday10,
              quantity: 1,
            },
            {
              productId: SCOOTER,
              start: utc("2026-06-20T14:00"),
              end: utc("2026-06-22T23:00"),
              quantity: 1,
            },
          ],
        }),
        { db: s.db, now: () => now },
      ),
    ).toEqual({ ok: false, reason: "outside_hours", line: 1 });
    expect(s.reserved()).toBe(false);
  });

  it("nothing free, as the read has it: unavailable, and reserve() is never called", async () => {
    const s = spy({ availability: stock(0) });
    expect(await bookOnline(asked(), { db: s.db, now: () => now })).toEqual({
      ok: false,
      reason: "unavailable",
      line: 0,
    });
    expect(s.reserved()).toBe(false);
  });

  it("a product with no price: cant_be_priced, never booked at zero", async () => {
    const s = spy({ pricing: unpriced });
    expect(await bookOnline(asked(), { db: s.db, now: () => now })).toEqual({
      ok: false,
      reason: "cant_be_priced",
      line: 0,
    });
    expect(s.reserved()).toBe(false);
  });

  it("Moto Mangos: not listed, the cap reached, or only by request: reserve() is never called", async () => {
    const listing = {
      enabled: true,
      instant_units: 1,
      request_units: 1,
      lead_time_hours: null,
      ready_now: 0,
    };
    const counts = (held: number, instant: number, request: number) => ({
      enabled: true,
      instant_units: 1,
      request_units: 1,
      mm_held: held,
      mm_instant: instant,
      mm_request: request,
    });
    const mm = asked({ channel: "marketplace" });

    const unlisted = spy();
    expect(await bookOnline(mm, { db: unlisted.db, now: () => now })).toEqual({
      ok: false,
      reason: "not_listed",
      line: 0,
    });
    expect(unlisted.reserved()).toBe(false);

    const full = spy({
      inputs: inputs({}, listing),
      availability: stock(3, counts(2, 1, 1)),
    });
    expect(await bookOnline(mm, { db: full.db, now: () => now })).toEqual({
      ok: false,
      reason: "cap_reached",
      line: 0,
    });
    expect(full.reserved()).toBe(false);

    // The Instant unit is out; the listing would take this one by request,
    // which reserve() does not do until 3M.
    const byRequest = spy({
      inputs: inputs({}, listing),
      availability: stock(3, counts(1, 1, 0)),
    });
    expect(await bookOnline(mm, { db: byRequest.db, now: () => now })).toEqual({
      ok: false,
      reason: "request_only",
      line: 0,
    });
    expect(byRequest.reserved()).toBe(false);

    const open = spy({
      inputs: inputs({}, listing),
      availability: stock(3, counts(0, 0, 0)),
    });
    expect((await bookOnline(mm, { db: open.db, now: () => now })).ok).toBe(
      true,
    );
    expect(open.reserved()).toBe(true);
  });

  it("everything passes: reserve() is called once, last, with what was asked; the answer carries the booking and its price", async () => {
    const s = spy();
    const answer = await bookOnline(asked({ hold: true }), {
      db: s.db,
      now: () => now,
    });
    expect(s.called().slice(0, 3).sort()).toEqual(READS);
    expect(s.called().slice(3)).toEqual(["reserve"]);
    expect(s.calls[3].args).toEqual({
      p_tenant_id: TENANT,
      p_request: {
        channel: "booking_page",
        mode: "instant",
        hold: true,
        lines: [
          {
            product_id: SCOOTER,
            location_id: PLACE,
            starts_at: "2026-06-15T14:00:00.000Z",
            ends_at: "2026-06-17T14:00:00.000Z",
            quantity: 1,
          },
        ],
      },
    });
    expect(answer).toMatchObject({
      ok: true,
      bookingId: "b-1",
      mode: "instant",
      lines: [{ reservationId: "r-1", unitIds: ["u-1"], shortage: 0 }],
      holdExpiresAt: null,
    });
    // Two days at 45.00.
    expect(answer.ok && answer.quote.totals.total).toBe(BigInt(9000));
  });

  it("helmets booked with the scooter are priced as its extra: the ones that come free with it (product_extras) are not charged", async () => {
    const HELMET = "44444444-4444-4444-8444-444444444444";
    const scene = inputs();
    const withHelmets = spy({
      inputs: {
        ...scene,
        products: [
          ...scene.products,
          { ...scene.products[0], product_id: HELMET, type: "gear" },
        ],
      },
      availability: [
        ...stock(3),
        { ...stock(10)[0], product_id: HELMET, type: "gear", stock: 10 },
      ],
      pricing: {
        ...priced,
        products: [
          ...priced.products,
          {
            ...priced.products[0],
            product_id: HELMET,
            product_name: "Helmet",
            product_type: "gear",
            price_amount: "500",
          },
        ],
        extras: [
          {
            product_id: SCOOTER,
            extra_product_id: HELMET,
            extra_product_type: "gear",
            included_quantity: 2,
            max_quantity: null,
            sort_position: 0,
            every_vehicle: false,
          },
        ],
      },
    });
    const answer = await bookOnline(
      asked({
        lines: [
          { productId: SCOOTER, start: monday10, end: wednesday10, quantity: 1 },
          {
            productId: HELMET,
            start: monday10,
            end: wednesday10,
            quantity: 3,
            parent: 0,
          },
        ],
      }),
      { db: withHelmets.db, now: () => now },
    );
    if (!answer.ok) throw new Error(`refused: ${answer.reason}`);
    // Two days: the scooter 90.00; 3 helmets, 2 of them free, 1 × 2 × 5.00.
    expect(
      answer.quote.lines.map((line) => [
        line.includedQuantity,
        line.chargedQuantity,
        line.listPrice,
      ]),
    ).toEqual([
      [0, 1, BigInt(9000)],
      [2, 1, BigInt(1000)],
    ]);
    expect(answer.quote.totals.total).toBe(BigInt(10_000));
    // reserve() is still sent all three helmets: the free ones hold stock too.
    const sent = withHelmets.calls.find((call) => call.fn === "reserve")!
      .args.p_request as { lines: { quantity: number; parent?: number }[] };
    expect(sent.lines.map((line) => [line.quantity, line.parent])).toEqual([
      [1, undefined],
      [3, 0],
    ]);
  });

  it("it is for online channels only: a counter or phone booking is refused before anything is read", async () => {
    for (const channel of ["walk_in", "phone", "anything"]) {
      const s = spy();
      await expect(
        bookOnline(asked({ channel: channel as never }), { db: s.db }),
      ).rejects.toThrow(RangeError);
      expect(s.calls).toEqual([]);
    }
    const s = spy();
    // "Ride today" is Moto Mangos' alone: the shop's page and the API can't
    // use it to skip their notice.
    for (const channel of ["booking_page", "api"] as const) {
      await expect(
        bookOnline(asked({ channel, mode: "now" }), { db: s.db }),
      ).rejects.toThrow(RangeError);
    }
    await expect(
      bookOnline(asked({ mode: "staff" as never }), { db: s.db }),
    ).rejects.toThrow(RangeError);
    await expect(
      bookOnline(asked({ mode: "request" as never }), { db: s.db }),
    ).rejects.toThrow(RangeError);
    expect(s.calls).toEqual([]);
  });
});

describe("bookOnline(): what reserve() answers", () => {
  const book = (reserve: Reply) =>
    bookOnline(asked(), { db: spy({ reserve }).db, now: () => now });

  it("a statement the API ended while reserve() waited (57014) is try_again too; from a read it is an error", async () => {
    expect(
      await book({
        data: null,
        error: {
          code: "57014",
          message: "canceling statement due to statement timeout",
        },
      }),
    ).toEqual({ ok: false, reason: "try_again", line: null });
    // Only from reserve(): a read that timed out says nothing about a booking.
    const s = spy();
    const slowRead: OnlineDb = {
      rpc: (fn, args) =>
        fn === "pricing_inputs"
          ? Promise.resolve({
              data: null,
              error: { code: "57014", message: "statement timeout" },
            })
          : s.db.rpc(fn, args),
    };
    await expect(
      bookOnline(asked(), { db: slowRead, now: () => now }),
    ).rejects.toMatchObject({ code: "57014" });
    expect(s.reserved()).toBe(false);
  });

  it("a lock that could not be had in time (55P03, lock_timeout) is try_again, the same as a broken deadlock", async () => {
    expect(
      await book({
        data: null,
        error: {
          code: "55P03",
          message: "canceling statement due to lock timeout",
        },
      }),
    ).toEqual({ ok: false, reason: "try_again", line: null });
    expect(
      await book({
        data: { ok: false, reason: "try_again", line: null },
        error: null,
      }),
    ).toEqual({ ok: false, reason: "try_again", line: null });
  });

  it("a refusal under the locks is passed on: someone else took the last one, or the cap's last place", async () => {
    for (const reason of [
      "unavailable",
      "cap_reached",
      "not_listed",
      "not_allowed",
    ]) {
      expect(
        await book({ data: { ok: false, reason, line: 0 }, error: null }),
      ).toEqual({ ok: false, reason, line: 0 });
    }
  });

  it("any other error is not an answer: it is thrown, with its code", async () => {
    await expect(
      book({
        data: null,
        error: { code: "P0001", message: "product_not_found" },
      }),
    ).rejects.toMatchObject({ message: "product_not_found", code: "P0001" });
    // A read that fails is thrown too, and reserve() is not reached.
    const s = spy();
    const failing: OnlineDb = {
      rpc: (fn, args) =>
        fn === "availability"
          ? Promise.resolve({
              data: null,
              error: { code: "42501", message: "not_allowed" },
            })
          : s.db.rpc(fn, args),
    };
    await expect(
      bookOnline(asked(), { db: failing, now: () => now }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(s.reserved()).toBe(false);
  });
});

// ------------------------------------------------------------ the static test

/** The one file that may reach reserve() for an online channel. */
const ENTRY = "apps/platform/lib/book-online.ts";

/** A call of the booking function through the API client. */
const CALLS_RESERVE = /\.rpc\s*(?:<[^>]*>)?\s*\(\s*["'`]reserve["'`]/;
/** Anything that makes or names a client with the service role. */
const SERVICE_ROLE =
  /@mango\/db\/admin|createAdminClient|SUPABASE_SERVICE_ROLE_KEY|service_role/;
/** An online channel named in the file. */
const ONLINE_CHANNEL =
  /["'`](?:booking_page|marketplace)["'`]|channel["'`]?\s*[:=]\s*["'`]api["'`]/;

/**
 * Every way a file other than the entry point could book for an online
 * channel. `files` maps a path from the repo root to its source.
 */
function pathsRoundBookOnline(files: Map<string, string>): string[] {
  const found: string[] = [];
  const callers = [...files].filter(
    ([path, source]) => path !== ENTRY && CALLS_RESERVE.test(source),
  );
  for (const [path, source] of callers) {
    if (path.startsWith("apps/marketplace/")) {
      found.push(`${path}: the marketplace calls reserve()`);
    }
    // Shared code is imported by both apps: a call there is a path for each.
    if (path.startsWith("packages/")) {
      found.push(`${path}: a shared package calls reserve()`);
    }
    if (SERVICE_ROLE.test(source)) {
      found.push(`${path}: calls reserve() with the service role`);
    }
    if (ONLINE_CHANNEL.test(source)) {
      found.push(`${path}: calls reserve() and names an online channel`);
    }
  }
  // A file with the service role's client that imports a file that calls
  // reserve() could hand it that client.
  for (const [path, source] of files) {
    if (path === ENTRY || !SERVICE_ROLE.test(source)) continue;
    for (const [caller] of callers) {
      const moduleName = basename(caller).replace(/\.[a-z]+$/, "");
      const imported = new RegExp(
        `from\\s+["'][^"']*/${moduleName}["']|import\\(\\s*["'][^"']*/${moduleName}["']`,
      );
      if (imported.test(source)) {
        found.push(
          `${path}: has the service role and imports ${caller}, which calls reserve()`,
        );
      }
    }
  }
  // The entry point's code, without its comments (which talk about offer()).
  const entry = files
    .get(ENTRY)
    ?.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  if (!entry) {
    found.push(`${ENTRY}: missing`);
  } else {
    const offerAt = entry.search(/\boffer\(/);
    const reserveAt = entry.search(/\.rpc\(\s*["'`]reserve["'`]/);
    if (!/from "@mango\/core\/booking-rules"/.test(entry) || offerAt < 0) {
      found.push(`${ENTRY}: does not call offer()`);
    } else if (reserveAt < 0 || reserveAt < offerAt) {
      found.push(`${ENTRY}: reserve() is not after offer()`);
    }
    if (
      (entry.match(new RegExp(CALLS_RESERVE.source, "g")) ?? []).length !== 1
    ) {
      found.push(`${ENTRY}: more than one call of reserve()`);
    }
  }
  return found;
}

const root = fileURLToPath(new URL("../../..", import.meta.url));
// Not paths a customer's booking can take: tests, and the scripts run by
// hand with the service role (the seed).
const SKIPPED = new Set([
  "node_modules",
  ".next",
  ".netlify",
  "e2e",
  "tests",
  "scripts",
  "public",
  "test-results",
  "playwright-report",
  "messages",
]);

function sourceFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIPPED.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (
        /\.(ts|tsx|mts|mjs|js|jsx)$/.test(entry) &&
        !/\.test\.|\.d\.ts$/.test(entry)
      ) {
        files.set(
          relative(root, full).split(sep).join("/"),
          readFileSync(full, "utf8"),
        );
      }
    }
  };
  walk(join(root, "apps"));
  walk(join(root, "packages"));
  return files;
}

describe("no booking-page or marketplace path reaches reserve() without passing bookable()", () => {
  const entry = readFileSync(join(root, ENTRY), "utf8");
  const withFile = (path: string, source: string) =>
    new Map([
      [ENTRY, entry],
      [path, source],
    ]);

  it("the detector catches each way round, on made-up files", () => {
    // A booking page that books straight with the service role.
    expect(
      pathsRoundBookOnline(
        withFile(
          "apps/platform/app/book/[slug]/actions.ts",
          `import { createAdminClient } from "@mango/db/admin";
           export const book = (r) => createAdminClient().schema("platform").rpc("reserve", r);`,
        ),
      ),
    ).toEqual([
      "apps/platform/app/book/[slug]/actions.ts: calls reserve() with the service role",
    ]);
    // A file that names an online channel beside the call.
    expect(
      pathsRoundBookOnline(
        withFile(
          "apps/platform/lib/quick-book.ts",
          `export const book = (db, lines) =>
             db.rpc<Answer>('reserve', { p_request: { channel: "booking_page", lines } });`,
        ),
      ),
    ).toEqual([
      "apps/platform/lib/quick-book.ts: calls reserve() and names an online channel",
    ]);
    expect(
      pathsRoundBookOnline(
        withFile(
          "apps/platform/lib/api-book.ts",
          "export const book = (db, lines) => db.rpc(`reserve`, { p_request: { channel: 'api', lines } });",
        ),
      ),
    ).toHaveLength(1);
    // The marketplace, by any client.
    expect(
      pathsRoundBookOnline(
        withFile(
          "apps/marketplace/app/api/checkout/route.ts",
          `export const book = (db, r) => db.schema("platform").rpc("reserve", r);`,
        ),
      ),
    ).toEqual([
      "apps/marketplace/app/api/checkout/route.ts: the marketplace calls reserve()",
    ]);
    // A shared package, by any client.
    expect(
      pathsRoundBookOnline(
        withFile(
          "packages/db/src/booking.ts",
          `export const book = (db, r) => db.rpc("reserve", r);`,
        ),
      ),
    ).toEqual(["packages/db/src/booking.ts: a shared package calls reserve()"]);
    // The service role's client handed to a file that calls reserve().
    const handed = withFile(
      "apps/platform/lib/staff-book.ts",
      `export const book = (db, request) => db.rpc("reserve", request);`,
    );
    handed.set(
      "apps/platform/app/api/hook/route.ts",
      `import { createAdminClient } from "@mango/db/admin";
       import { book } from "@/lib/staff-book";
       export const POST = (r) => book(createAdminClient(), r);`,
    );
    expect(pathsRoundBookOnline(handed)).toEqual([
      "apps/platform/app/api/hook/route.ts: has the service role and imports apps/platform/lib/staff-book.ts, which calls reserve()",
    ]);
    // The entry point itself, if it stopped asking offer() first.
    expect(
      pathsRoundBookOnline(
        new Map([[ENTRY, entry.replace(/= offer\(/, "= skipped(")]]),
      ),
    ).toEqual([`${ENTRY}: does not call offer()`]);
    expect(pathsRoundBookOnline(new Map())).toEqual([`${ENTRY}: missing`]);
  });

  it("the staff path is not one: a signed-in member booking at the counter passes", () => {
    expect(
      pathsRoundBookOnline(
        withFile(
          "apps/platform/app/[tenant]/new-order/actions.ts",
          `import { createClient } from "@mango/db/platform-server";
           export async function book(tenantId, lines) {
             const db = await createClient();
             return db.rpc("reserve", {
               p_tenant_id: tenantId,
               p_request: { channel: "walk_in", mode: "staff", lines },
             });
           }`,
        ),
      ),
    ).toEqual([]);
  });

  it("in both apps today: nothing but lib/book-online.ts", () => {
    const files = sourceFiles();
    // The walk found the apps: hundreds of files, the entry point among them.
    expect(files.size).toBeGreaterThan(200);
    expect(files.has(ENTRY)).toBe(true);
    for (const part of [
      "apps/marketplace/",
      "apps/platform/",
      "packages/core/",
      "packages/db/",
      "packages/config/",
    ]) {
      expect(
        [...files.keys()].some((path) => path.startsWith(part)),
        part,
      ).toBe(true);
    }
    // The service role's client is made in a shared package, which is why
    // the walk goes there.
    expect(files.has("packages/db/src/admin.ts")).toBe(true);
    expect(pathsRoundBookOnline(files)).toEqual([]);
    // And today it is the only file that calls reserve() at all.
    expect(
      [...files]
        .filter(([, source]) => CALLS_RESERVE.test(source))
        .map(([p]) => p),
    ).toEqual([ENTRY]);
  });
});
