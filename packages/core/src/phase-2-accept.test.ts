/**
 * Phase 2's accept line, one block per clause, so the list can be read off
 * the test names (docs/phase-2-plan.md §9.1; docs/platform/SPEC.md, Phase
 * 2, as changed in stage 11):
 *
 *   50+ unit tests on pricing (tiers, season, VAT inclusive/exclusive); a
 *   concurrency test where two parallel bookings for the last unit results
 *   in one success, through the staff path and the online model-level path;
 *   a booking that overlaps a downtime block is refused; the total never
 *   falls as days rise; the tests include one tenant in a daylight-saving
 *   time zone and one in a zero-decimal currency.
 *
 * The pricing clauses are proved here, on @mango/core alone. The two
 * database clauses (the race for the last unit; downtime) are proved in
 * apps/platform/tests/db/phase-2-accept.test.ts, against a real database;
 * apps/platform/tests/phase-2-accept-suites.test.ts checks that the two
 * suites between them name every clause.
 *
 * Weekday and weekend rules are not built (Q14), and the per-day pricing
 * mode was dropped (change request 48): neither is in the line any more.
 */
import { describe, expect, it } from "vitest";
import { bookable, type BookingRules } from "./booking-rules";
import {
  decideDiscounts,
  type CouponSettings,
  type DiscountRequest,
  type ReturningCustomerSettings,
} from "./discounts";
import {
  quote,
  type DepositSetting,
  type Quote,
  type QuoteInput,
  type QuoteLineInput,
} from "./quote";
import {
  BANGKOK,
  bike300,
  bkk,
  contextFor,
  fixed,
  input,
  line,
  LOW_SEASON,
  minor,
  perDay,
  thb,
} from "./quote-pinned.fixtures";
import { readSnapshot, snapshotQuote } from "./quote-snapshot";
import { fillPriceList } from "./price-list";
import type { Pricing } from "./rental-price";
import type { SeasonRule } from "./season";
import { addZonedDays } from "./zoned";

type Priced = Extract<Quote, { ok: true }>;

function priced(
  more: Partial<QuoteInput> & { lines: readonly QuoteLineInput[] },
): Priced {
  const q = quote(input(more));
  if (!q.ok) throw new Error("expected a priced quote");
  return q;
}

const ALL = ["staff", "booking_page", "marketplace"] as const;
const coupon = (more: Partial<CouponSettings> = {}): CouponSettings => ({
  id: "c1",
  code: "SAVE",
  currency: "THB",
  kind: "fixed",
  percentBp: null,
  amount: thb("200"),
  allProducts: true,
  productIds: [],
  validFrom: null,
  validTo: null,
  pickupFrom: null,
  pickupTo: null,
  minDays: null,
  minSpend: null,
  maxUses: null,
  maxUsesPerCustomer: null,
  channels: ALL,
  withReturningDiscount: false,
  withSeasonDiscount: true,
  active: true,
  archived: false,
  ...more,
});
const percent = (bp: number, more: Partial<CouponSettings> = {}) =>
  coupon({ kind: "percent", percentBp: bp, amount: null, ...more });
const RETURNING_10: ReturningCustomerSettings = {
  enabled: true,
  percentBp: 1000,
  completedRentalsNeeded: 1,
};

/** Decides the discounts as a booking would, then prices with them. */
function withDiscounts(
  q: QuoteInput,
  more: Partial<Omit<DiscountRequest, "quote">> & {
    code?: CouponSettings | null;
  } = {},
): Priced {
  const { code, ...rest } = more;
  const request: DiscountRequest = {
    quote: { ...q, couponsEnabled: true },
    productTypes: Object.fromEntries(
      q.lines.map((l) => [l.id, l.vehicle ? "vehicle" : "gear"]),
    ),
    currency: "THB",
    now: bkk("2027-10-20"),
    timeZone: BANGKOK,
    channel: "walk_in",
    coupon: code
      ? {
          code: code.code,
          found: { settings: code, uses: { total: 0, customer: 0 } },
        }
      : null,
    returningCustomer: null,
    completedRentals: 0,
    ...rest,
  };
  const decision = decideDiscounts(request);
  if (decision.outcome !== "decided")
    throw new Error(`expected a decision, got ${decision.outcome}`);
  const result = quote({ ...request.quote, discounts: decision.discounts });
  if (!result.ok) throw new Error("expected a priced quote");
  return result;
}

// ------------------------------------------------------------------ clause 1

// 50 tests: 30 list lengths, 4 past a month, 1 past a year, 2 VAT, 3
// seasons, 4 deposit modes, 1 extra, 1 other ways of pricing, 3 discounts,
// 1 deposit-and-zero. More pricing tests are in the files beside this one.
describe("Phase 2 accept: 50+ unit tests on pricing (tiers, season, VAT inclusive and on top)", () => {
  // The list: ฿300 a day, ฿1,400 a week, ฿2,100 two weeks, ฿3,000 a month,
  // filled for every day by the shop's rounding step (fillPriceList).
  const list = fillPriceList(
    {
      daily: thb("300"),
      weekly: thb("1400"),
      twoWeeks: thb("2100"),
      monthly: thb("3000"),
    },
    new Map(),
    thb("10"),
  ).days.map((d) => d.total);
  const days = Array.from({ length: 30 }, (_, i) => i + 1);

  it.each(days)("tiers: %i day(s) cost that day's total on the list", (n) => {
    const q = priced({
      taxInclusive: true,
      lines: [line("bike", bike300(), { days: n, taxRateBp: null })],
    });
    expect(q.totals.total).toBe(list[n - 1]);
  });

  it.each([
    [31, thb("3100")],
    [45, thb("4500")],
    [60, thb("6000")],
    // 1 Nov 2027 + 90 days is 30 Jan 2028: two months and 29 days.
    [90, thb("8900")],
  ] as const)(
    "tiers past a month: %i days are whole calendar months and the long-stay rate",
    (n, total) => {
      const q = priced({
        lines: [line("bike", bike300(), { days: n, taxRateBp: null })],
      });
      expect(q.totals.total).toBe(total);
    },
  );

  it("tiers: a rental of more than a year (400 days) is priced, and costs more than a year", () => {
    const year = priced({
      lines: [line("bike", bike300(), { days: 365, taxRateBp: null })],
    });
    const more = priced({
      lines: [line("bike", bike300(), { days: 400, taxRateBp: null })],
    });
    expect(more.totals.total > year.totals.total).toBe(true);
  });

  it("VAT inclusive: ฿3,000 at 7% is ฿196.26 of VAT inside it", () => {
    const q = priced({ taxInclusive: true, lines: [line("bike", bike300())] });
    expect([q.totals.net, q.totals.vat, q.totals.total]).toEqual([
      thb("2803.74"),
      thb("196.26"),
      thb("3000"),
    ]);
  });

  it("VAT on top: ฿3,000 at 7% is ฿210 added, ฿3,210 in all", () => {
    const q = priced({ taxInclusive: false, lines: [line("bike", bike300())] });
    expect([q.totals.net, q.totals.vat, q.totals.total]).toEqual([
      thb("3000"),
      thb("210"),
      thb("3210"),
    ]);
  });

  const inSeason = (rule: SeasonRule) =>
    priced({
      seasonRules: [rule],
      lines: [
        line("bike", bike300(), {
          days: 7,
          taxRateBp: null,
          span: {
            start: bkk("2027-05-01"),
            end: bkk("2027-05-08"),
            timeZone: BANGKOK,
          },
        }),
      ],
    });

  it("season down: 20% off a week in low season, ฿1,400 → ฿1,120", () => {
    expect(inSeason(LOW_SEASON).totals.total).toBe(thb("1120"));
  });

  it("season up: 20% on a week in high season, ฿1,400 → ฿1,680", () => {
    expect(
      inSeason({ ...LOW_SEASON, id: "high", adjustBp: 2000 }).totals.total,
    ).toBe(thb("1680"));
  });

  it("season: a rental outside the season's dates is not touched", () => {
    const q = priced({
      seasonRules: [LOW_SEASON],
      lines: [line("bike", bike300(), { days: 7, taxRateBp: null })],
    });
    expect(q.totals.total).toBe(thb("1400"));
  });

  const deposits: [string, DepositSetting, bigint][] = [
    ["none", { mode: "none" }, 0n],
    [
      "a percentage of the order (10%)",
      { mode: "percent_of_order", percentBp: 1000 },
      thb("300"),
    ],
    [
      "a fixed amount per order (฿1,000)",
      { mode: "fixed_per_order", amount: thb("1000") },
      thb("1000"),
    ],
    [
      "per vehicle (฿2,000 each, two vehicles)",
      { mode: "per_product", amount: thb("2000") },
      thb("4000"),
    ],
  ];
  it.each(deposits)("deposit: %s", (_name, setting, expected) => {
    const quantity = setting.mode === "per_product" ? 2 : 1;
    const q = priced({
      deposit: { shop: setting },
      lines: [line("bike", bike300(), { quantity, taxRateBp: null })],
    });
    expect(q.deposit.amount).toBe(expected);
  });

  it("an extra with included units: three helmets with a scooter, one free, ฿50 a day for a week", () => {
    const q = priced({
      lines: [
        line("bike", bike300(), { days: 7, taxRateBp: null }),
        line("helmet", perDay(thb("50")), {
          days: 7,
          quantity: 3,
          vehicle: false,
          taxRateBp: null,
          extraOf: { lineId: "bike", includedQuantity: 1 },
        }),
      ],
    });
    const helmet = q.lines.find((l) => l.id === "helmet")!;
    expect(helmet.chargedQuantity).toBe(2);
    expect(helmet.amount).toBe(thb("700"));
    expect(q.totals.total).toBe(thb("2100"));
  });

  it("a fixed price, a free service and a price per week", () => {
    const q = priced({
      lines: [
        line("delivery", fixed("200"), {
          days: 7,
          vehicle: false,
          taxRateBp: null,
        }),
        line(
          "wash",
          { method: "free" },
          { days: 7, vehicle: false, taxRateBp: null },
        ),
        line(
          "box",
          { method: "per_period", amount: thb("500"), period: "week" },
          {
            days: 14,
            vehicle: false,
            taxRateBp: null,
          },
        ),
      ],
    });
    expect(q.lines.map((l) => l.amount)).toEqual([thb("200"), 0n, thb("1000")]);
  });

  it("a percentage coupon: 15% off a week, ฿1,400 → ฿1,190", () => {
    const q = withDiscounts(
      input({ lines: [line("bike", bike300(), { days: 7, taxRateBp: null })] }),
      {
        code: percent(1500),
      },
    );
    expect(q.totals.total).toBe(thb("1190"));
  });

  it("a fixed coupon: ฿200 off a week, ฿1,400 → ฿1,200", () => {
    const q = withDiscounts(
      input({ lines: [line("bike", bike300(), { days: 7, taxRateBp: null })] }),
      {
        code: coupon(),
      },
    );
    expect(q.totals.total).toBe(thb("1200"));
  });

  it("the returning-customer discount: 10% off a week for a customer with one rental done", () => {
    const q = withDiscounts(
      input({ lines: [line("bike", bike300(), { days: 7, taxRateBp: null })] }),
      {
        returningCustomer: RETURNING_10,
        completedRentals: 1,
      },
    );
    expect(q.totals.total).toBe(thb("1260"));
  });

  it("a coupon never reduces the deposit, and the total never goes below zero", () => {
    const q = withDiscounts(
      input({
        deposit: { shop: { mode: "fixed_per_order", amount: thb("1000") } },
        lines: [line("bike", bike300(), { days: 1, taxRateBp: null })],
      }),
      { code: coupon({ amount: thb("5000") }) },
    );
    expect(q.totals.total).toBe(0n);
    expect(q.deposit.amount).toBe(thb("1000"));
  });
});

// ------------------------------------------------------------- clauses 2 and 3
// Two parallel bookings for the last unit, and a booking over downtime, are
// the database's to prove: apps/platform/tests/db/phase-2-accept.test.ts.
// apps/platform/tests/phase-2-accept-suites.test.ts checks that the two
// suites between them name every clause.

// ------------------------------------------------------------------ clause 4

describe("Phase 2 accept: the total never falls as days rise", () => {
  const NEW_YORK = "America/New_York";
  const starts: [Date, string][] = [
    [bkk("2027-01-31"), BANGKOK], // a month end
    [bkk("2028-02-29"), BANGKOK], // a leap day
    [new Date("2027-03-13T15:00:00.000Z"), NEW_YORK], // the day before the clocks go forward
    [new Date("2027-11-06T14:00:00.000Z"), NEW_YORK], // the day before they go back
  ];
  const high: SeasonRule = { ...LOW_SEASON, id: "high", adjustBp: 2000 };
  const plays: [string, (lines: QuoteLineInput[]) => Priced][] = [
    ["no discount", (lines) => priced({ lines })],
    [
      "a season up, all year",
      (lines) =>
        priced({
          lines,
          seasonRules: [
            { ...high, startsOn: "2027-01-01", endsOn: "2027-12-31" },
          ],
        }),
    ],
    [
      "a percentage coupon",
      (lines) => withDiscounts(input({ lines }), { code: percent(1500) }),
    ],
    [
      "a fixed coupon",
      (lines) =>
        withDiscounts(input({ lines }), {
          code: coupon({ amount: thb("500") }),
        }),
    ],
    [
      "the returning-customer discount",
      (lines) =>
        withDiscounts(input({ lines }), {
          returningCustomer: RETURNING_10,
          completedRentals: 1,
        }),
    ],
  ];

  it.each(plays)(
    "with %s, and an extra with an included unit, from 1 hour to 400 days",
    (_name, price) => {
      let checked = 0;
      for (const [start, timeZone] of starts) {
        const ends = [1, 6, 23].map(
          (h) => new Date(start.getTime() + h * 3_600_000),
        );
        for (let d = 1; d <= 400; d += 1)
          ends.push(addZonedDays(start, d, timeZone));
        let before: Priced | null = null;
        for (const end of ends) {
          const span = { start, end, timeZone };
          const q = price([
            line("bike", bike300(), { span }),
            line("helmet", perDay(thb("50")), {
              span,
              quantity: 2,
              vehicle: false,
              extraOf: { lineId: "bike", includedQuantity: 1 },
            }),
          ]);
          if (before) {
            const label = `${timeZone} ${start.toISOString()} → ${end.toISOString()}`;
            expect(q.totals.total >= before.totals.total, label).toBe(true);
            expect(q.totals.listPrice >= before.totals.listPrice, label).toBe(
              true,
            );
          }
          expect(q.totals.total >= 0n).toBe(true);
          before = q;
          checked += 1;
        }
      }
      expect(checked).toBe(starts.length * 403);
    },
  );
});

// ------------------------------------------------------------------ clause 5

describe("Phase 2 accept: a tenant in a daylight-saving time zone (America/New_York)", () => {
  const NY = "America/New_York";
  const at = (iso: string) => new Date(iso);

  it("a day is a day on the shop's clock across both clock changes (23 and 25 real hours)", () => {
    const short = priced({
      lines: [
        line("bike", bike300(), {
          taxRateBp: null,
          // 10:00 EST on 13 Mar to 10:00 EDT on 14 Mar 2027: 23 hours.
          span: {
            start: at("2027-03-13T15:00:00Z"),
            end: at("2027-03-14T14:00:00Z"),
            timeZone: NY,
          },
        }),
      ],
    });
    const long = priced({
      lines: [
        line("bike", bike300(), {
          taxRateBp: null,
          // 10:00 EDT on 6 Nov to 10:00 EST on 7 Nov 2027: 25 hours.
          span: {
            start: at("2027-11-06T14:00:00Z"),
            end: at("2027-11-07T15:00:00Z"),
            timeZone: NY,
          },
        }),
      ],
    });
    expect(short.totals.total).toBe(thb("300"));
    expect(long.totals.total).toBe(thb("300"));
  });

  it("a season that starts on the clock-change day covers that whole day", () => {
    const rule: SeasonRule = {
      id: "spring",
      startsOn: "2027-03-14",
      endsOn: "2027-03-20",
      repeatsYearly: false,
      adjustBp: -5000,
      products: "all",
    };
    const q = priced({
      seasonRules: [rule],
      lines: [
        line("bike", bike300(), {
          taxRateBp: null,
          span: {
            start: at("2027-03-14T05:00:00Z"),
            end: at("2027-03-15T04:00:00Z"),
            timeZone: NY,
          },
        }),
      ],
    });
    expect(q.totals.total).toBe(thb("150"));
  });

  const rules = (more: Partial<BookingRules> = {}): BookingRules => ({
    timeZone: NY,
    hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      open: "09:00",
      close: "18:00",
    })),
    closures: [],
    minNoticeHours: null,
    bookingCutoffMinutes: null,
    minDaysAdvance: null,
    minDaysWalkin: null,
    leadTimeHours: null,
    ...more,
  });
  const online = { channel: "booking_page", mode: "instant" } as const;

  it("notice is real hours across the short day: 24 hours from 10:00 EST is 11:00 EDT", () => {
    const answer = bookable(
      rules({ minNoticeHours: 24 }),
      at("2027-03-14T14:00:00Z"), // 10:00 EDT on 14 Mar
      at("2027-03-15T14:00:00Z"),
      online,
      at("2027-03-13T15:00:00Z"), // 10:00 EST on 13 Mar
    );
    expect(answer).toEqual({
      ok: false,
      reason: "too_soon",
      earliestPickup: at("2027-03-14T15:00:00Z"),
    });
  });

  it("opening hours on the long day are the shop's wall clock: 17:30 EST is open, 18:30 EST is not", () => {
    const end = at("2027-11-09T15:00:00Z");
    expect(
      bookable(
        rules(),
        at("2027-11-07T22:30:00Z"),
        end,
        online,
        at("2027-11-01T12:00:00Z"),
      ).ok,
    ).toBe(true);
    expect(
      bookable(
        rules(),
        at("2027-11-07T23:30:00Z"),
        end,
        online,
        at("2027-11-01T12:00:00Z"),
      ),
    ).toMatchObject({ ok: false, reason: "outside_hours", at: "pickup" });
  });
});

// ------------------------------------------------------------------ clause 6

describe("Phase 2 accept: a tenant in a zero-decimal currency (VND)", () => {
  const vnd = (amount: string) => minor(amount, 0);
  const bike: Pricing = {
    method: "per_period",
    amount: vnd("150000"),
    period: "day",
  };
  const helmet: Pricing = {
    method: "per_period",
    amount: vnd("33333"),
    period: "day",
  };
  const lines = () =>
    [
      line("bike", bike, { days: 3, taxRateBp: 1000 }),
      line("helmet", helmet, { days: 3, vehicle: false, taxRateBp: 1000 }),
      line("box", fixed("0"), { days: 3, vehicle: false, taxRateBp: 1000 }),
    ].map((l) =>
      l.id === "box"
        ? {
            ...l,
            pricing: { method: "fixed", amount: vnd("77777") } as Pricing,
          }
        : l,
    );
  const vndRequest = (code: CouponSettings) =>
    withDiscounts(input({ lines: lines() }), {
      currency: "VND",
      code: { ...code, currency: "VND" },
    });

  it("a percentage coupon: every line's share is a whole đồng, and they add up", () => {
    const q = vndRequest(percent(1250));
    const taken = q.lines.reduce((sum, l) => sum + l.discount, 0n);
    const before = q.lines.reduce((sum, l) => sum + l.seasonPrice, 0n);
    expect(taken).toBe((before * 1250n) / 10000n);
    expect(q.totals.total).toBe(before - taken);
  });

  it("a fixed coupon split over three lines adds up to the coupon, to the đồng", () => {
    const q = vndRequest(coupon({ amount: vnd("100000") }));
    expect(q.lines.map((l) => l.discount).reduce((a, b) => a + b, 0n)).toBe(
      vnd("100000"),
    );
    expect(q.lines.every((l) => l.discount >= 0n)).toBe(true);
  });

  it("a season and VAT both ways: whole đồng throughout, and net plus VAT is the total", () => {
    for (const taxInclusive of [true, false]) {
      const q = priced({
        taxInclusive,
        seasonRules: [
          {
            ...LOW_SEASON,
            startsOn: "2027-01-01",
            endsOn: "2027-12-31",
            adjustBp: -1500,
          },
        ],
        lines: lines(),
      });
      expect(q.totals.net + q.totals.vat).toBe(q.totals.total);
      expect(q.lines.some((l) => l.seasons.length > 0)).toBe(true);
    }
  });

  it("the snapshot keeps the exponent 0 and reads back the same figures", () => {
    const q = input({ lines: lines() });
    const stored = snapshotQuote(
      q,
      contextFor(q, { currency: "VND", exponent: 0 }),
    );
    const read = readSnapshot(stored);
    const live = priced({ lines: lines() });
    expect(read.totals.total).toBe(live.totals.total);
    expect(stored).toMatchObject({ currency: "VND", exponent: 0 });
    // No amount is stored with a decimal point.
    expect(JSON.stringify(stored)).not.toMatch(/"-?\d+\.\d+"/);
  });
});
