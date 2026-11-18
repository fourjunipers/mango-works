import { describe, expect, it } from "vitest";
import {
  couponChannelFor,
  couponDiscountId,
  decideDiscounts,
  isRentalLine,
  normalizeCouponCode,
  RETURNING_DISCOUNT_ID,
  type CouponSettings,
  type CouponUses,
  type DiscountDecision,
  type DiscountRequest,
  type ReturningCustomerSettings,
} from "./discounts";
import {
  lineDeposits,
  quote,
  type DepositSetting,
  type Discount,
  type Quote,
  type QuoteInput,
  type QuoteLineInput,
} from "./quote";
import {
  BANGKOK,
  bike300,
  bike350,
  bkk,
  contextFor,
  fixed,
  input,
  line,
  LOW_SEASON,
  perDay,
  pinnedQuotes,
  thb,
} from "./quote-pinned.fixtures";
import {
  readSnapshot,
  snapshotQuote,
  type SnapshotProductType,
} from "./quote-snapshot";
import type { SeasonRule } from "./season";
import { addZonedDays } from "./zoned";

// Coupons and the returning-customer discount: the rules
// (docs/phase-2-plan.md §5.3, stage 7).

type Priced = Extract<Quote, { ok: true }>;
type Decided = Extract<DiscountDecision, { outcome: "decided" }>;
type Refused = Extract<DiscountDecision, { outcome: "refused" }>;

const ALL_CHANNELS = ["staff", "booking_page", "marketplace"] as const;

/** ฿200 off everything, any day, any channel, not combined. */
const coupon = (more: Partial<CouponSettings> = {}): CouponSettings => ({
  id: "c1",
  code: "SAVE200",
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
  channels: ALL_CHANNELS,
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

type Ask = {
  lines: readonly QuoteLineInput[];
  /** A coupon: the code given is its own unless `code` says otherwise. */
  coupon?: CouponSettings | null;
  code?: string;
  uses?: CouponUses;
  types?: Record<string, SnapshotProductType>;
  quote?: Partial<QuoteInput>;
} & Partial<Omit<DiscountRequest, "quote" | "coupon" | "productTypes">>;

function request(ask: Ask): DiscountRequest {
  const { lines, coupon: c, code, uses, types, quote: more, ...rest } = ask;
  return {
    quote: input({ lines, couponsEnabled: true, ...more }),
    productTypes: Object.fromEntries(
      lines.map((each) => [
        each.id,
        types?.[each.id] ?? (each.vehicle ? "vehicle" : "gear"),
      ]),
    ),
    currency: "THB",
    now: bkk("2027-10-20"),
    timeZone: BANGKOK,
    channel: "walk_in",
    coupon:
      c === undefined && code === undefined
        ? null
        : {
            code: code ?? c?.code ?? "",
            found: c
              ? { settings: c, uses: uses ?? { total: 0, customer: 0 } }
              : null,
          },
    returningCustomer: null,
    completedRentals: 0,
    ...rest,
  };
}

function decided(ask: Ask): Decided {
  const decision = decideDiscounts(request(ask));
  if (decision.outcome !== "decided") {
    throw new Error(
      `expected a decision, got ${JSON.stringify(decision.outcome)}`,
    );
  }
  return decision;
}

function refusal(ask: Ask): Refused {
  const decision = decideDiscounts(request(ask));
  if (decision.outcome !== "refused") {
    throw new Error(`expected a refusal, got ${decision.outcome}`);
  }
  return decision;
}

const reason = (ask: Ask) => refusal(ask).reason;

/** Decides, then prices with what was decided: the caller's two steps. */
function priced(ask: Ask): { decision: Decided; q: Priced } {
  const req = request(ask);
  const decision = decideDiscounts(req);
  if (decision.outcome !== "decided") throw new Error("expected a decision");
  const q = quote({ ...req.quote, discounts: decision.discounts });
  if (!q.ok) throw new Error("expected a priced quote");
  return { decision, q };
}

/** A week on a scooter: ฿1,400. A month: ฿3,000. From 1 Nov 2027. */
const scooter = (more: Partial<QuoteLineInput> & { days?: number } = {}) =>
  line("scooter", bike300(), { days: 7, ...more });
const month = () => [line("scooter", bike300())];

/** A helmet for the same week at ฿50 a day: ฿350. */
const helmet = (more: Partial<QuoteLineInput> & { days?: number } = {}) =>
  line("helmet", perDay(thb("50")), { days: 7, vehicle: false, ...more });

const ids = (discounts: readonly Discount[]) => discounts.map((d) => d.id);
const COUPON_ID = couponDiscountId("c1");

// ------------------------------------------------------------------ refusals

describe("why a code is refused", () => {
  it("unknown: no coupon has that code, or the coupon found has another", () => {
    expect(reason({ lines: [scooter()], coupon: null, code: "NOPE" })).toBe(
      "unknown",
    );
    expect(
      reason({ lines: [scooter()], coupon: coupon(), code: "SAVE20" }),
    ).toBe("unknown");
  });

  it("compares the code in upper case with spaces removed", () => {
    expect(normalizeCouponCode("  save 200\t")).toBe("SAVE200");
    for (const code of ["SAVE200", "save200", " Save 200 ", "s a v e 2 0 0"]) {
      const { coupon: outcome } = decided({
        lines: [scooter()],
        coupon: coupon(),
        code,
      });
      expect(outcome, code).toMatchObject({ applied: true, code: "SAVE200" });
    }
    // The shop's own spelling is normalised too.
    expect(
      decided({
        lines: [scooter()],
        coupon: coupon({ code: "save 200" }),
        code: "SAVE200",
      }).coupon,
    ).toMatchObject({ applied: true, code: "SAVE200" });
  });

  it("not_active: switched off, or archived", () => {
    expect(
      reason({ lines: [scooter()], coupon: coupon({ active: false }) }),
    ).toBe("not_active");
    expect(
      reason({ lines: [scooter()], coupon: coupon({ archived: true }) }),
    ).toBe("not_active");
  });

  it("too_early and expired: the day the booking is made, both ends included", () => {
    // Booked on 20 Oct 2027 in Bangkok.
    const on = (more: Partial<CouponSettings>) =>
      decideDiscounts(request({ lines: [scooter()], coupon: coupon(more) }));
    expect(on({ validFrom: "2027-10-21" })).toMatchObject({
      reason: "too_early",
    });
    expect(on({ validFrom: "2027-10-20" }).outcome).toBe("decided");
    expect(on({ validTo: "2027-10-19" })).toMatchObject({ reason: "expired" });
    expect(on({ validTo: "2027-10-20" }).outcome).toBe("decided");
    expect(on({ validFrom: "2027-10-20", validTo: "2027-10-20" }).outcome).toBe(
      "decided",
    );
  });

  it("is judged at the shop's midnight, not UTC's", () => {
    const at = (now: Date) =>
      decideDiscounts(
        request({
          lines: [scooter()],
          coupon: coupon({ validFrom: "2027-10-20" }),
          now,
        }),
      );
    // 19 Oct 23:59 in Bangkok is already 16:59 UTC on the 19th.
    expect(at(bkk("2027-10-19", "23:59"))).toMatchObject({
      reason: "too_early",
    });
    expect(at(bkk("2027-10-20", "00:00")).outcome).toBe("decided");
  });

  it("wrong_dates: the rental must start inside the pickup dates", () => {
    // The scooter is collected on 1 Nov 2027.
    const on = (more: Partial<CouponSettings>) =>
      decideDiscounts(request({ lines: [scooter()], coupon: coupon(more) }));
    expect(on({ pickupFrom: "2027-11-02" })).toMatchObject({
      reason: "wrong_dates",
    });
    expect(on({ pickupTo: "2027-10-31" })).toMatchObject({
      reason: "wrong_dates",
    });
    expect(
      on({ pickupFrom: "2027-11-01", pickupTo: "2027-11-01" }).outcome,
    ).toBe("decided");
  });

  it("too_short: minimum days, at the boundary", () => {
    const week = { lines: [scooter()] };
    expect(reason({ ...week, coupon: coupon({ minDays: 8 }) })).toBe(
      "too_short",
    );
    expect(
      decided({ ...week, coupon: coupon({ minDays: 7 }) }).coupon?.applied,
    ).toBe(true);
    // One minute into the eighth day is eight days.
    const longer = scooter();
    longer.span = {
      ...longer.span,
      end: new Date(longer.span.end.getTime() + 60_000),
    };
    expect(
      decided({ lines: [longer], coupon: coupon({ minDays: 8 }) }).coupon
        ?.applied,
    ).toBe(true);
  });

  it("below_minimum: minimum spend, to the satang", () => {
    const week = { lines: [scooter()] }; // ฿1,400
    expect(
      reason({ ...week, coupon: coupon({ minSpend: thb("1400.01") }) }),
    ).toBe("below_minimum");
    expect(
      decided({ ...week, coupon: coupon({ minSpend: thb("1400") }) }).coupon
        ?.applied,
    ).toBe(true);
  });

  it("measures minimum spend on the coupon's own lines, after seasons and before any discount", () => {
    const scootersOnly = (minSpend: string) =>
      coupon({
        allProducts: false,
        productIds: ["scooter"],
        minSpend: thb(minSpend),
      });
    const lines = [scooter(), helmet()]; // ฿1,400 + ฿350
    // The helmet beside it does not count.
    expect(reason({ lines, coupon: scootersOnly("1500") })).toBe(
      "below_minimum",
    );
    expect(
      decided({ lines, coupon: scootersOnly("1400") }).coupon?.applied,
    ).toBe(true);

    // After seasons: a 10% surcharge lifts the week to ฿1,540.
    const peak: SeasonRule = {
      id: "peak",
      startsOn: "2027-11-01",
      endsOn: "2027-11-30",
      repeatsYearly: false,
      adjustBp: 1000,
      products: "all",
    };
    expect(
      decided({
        lines,
        coupon: scootersOnly("1540"),
        quote: { seasonRules: [peak] },
      }).coupon?.applied,
    ).toBe(true);

    // Before any discount: the returning customer's 10% and a staff ฿500
    // leave ฿760, and the ฿1,400 minimum is still met.
    const { q, decision } = priced({
      lines,
      coupon: scootersOnly("1400"),
      returningCustomer: RETURNING_10,
      completedRentals: 1,
      quote: {
        discounts: [
          {
            id: "staff",
            source: "staff",
            lines: ["scooter"],
            amount: thb("500"),
          },
        ],
      },
    });
    // Not combined: 10% of ฿1,750 is ฿175, the coupon's ฿200 is more.
    expect(ids(decision.discounts)).toEqual([COUPON_ID, "staff"]);
    expect(q.lines[0].amount).toBe(thb("700"));
  });

  it("not_these_products: none of its products is in the booking", () => {
    expect(
      reason({
        lines: [scooter(), helmet()],
        coupon: coupon({ allProducts: false, productIds: ["touring"] }),
      }),
    ).toBe("not_these_products");
    // "All products" off with no product chosen is a coupon for nothing.
    expect(
      reason({ lines: [scooter()], coupon: coupon({ allProducts: false }) }),
    ).toBe("not_these_products");
  });

  it("wrong_channel: staff covers the counter and the phone; api has no coupons", () => {
    expect(couponChannelFor("walk_in")).toBe("staff");
    expect(couponChannelFor("phone")).toBe("staff");
    expect(couponChannelFor("booking_page")).toBe("booking_page");
    expect(couponChannelFor("marketplace")).toBe("marketplace");
    expect(couponChannelFor("api")).toBeNull();

    const on = (
      channels: CouponSettings["channels"],
      channel: DiscountRequest["channel"],
    ) =>
      decideDiscounts(
        request({ lines: [scooter()], coupon: coupon({ channels }), channel }),
      );
    expect(on(["booking_page"], "walk_in")).toMatchObject({
      reason: "wrong_channel",
    });
    expect(on(["booking_page"], "booking_page").outcome).toBe("decided");
    expect(on(["staff"], "phone").outcome).toBe("decided");
    expect(on(["staff"], "marketplace")).toMatchObject({
      reason: "wrong_channel",
    });
    expect(on(["marketplace"], "marketplace").outcome).toBe("decided");
    expect(on([], "walk_in")).toMatchObject({ reason: "wrong_channel" });
    expect(on(ALL_CHANNELS, "api")).toMatchObject({ reason: "wrong_channel" });
  });

  it("used_up: the last use is accepted, the one after it is not", () => {
    const on = (total: number) =>
      decideDiscounts(
        request({
          lines: [scooter()],
          coupon: coupon({ maxUses: 5 }),
          uses: { total, customer: 0 },
        }),
      );
    expect(on(4).outcome).toBe("decided");
    expect(on(5)).toMatchObject({ reason: "used_up" });
    expect(on(6)).toMatchObject({ reason: "used_up" });
  });

  it("customer_used_up: this customer's uses", () => {
    const on = (customer: number) =>
      decideDiscounts(
        request({
          lines: [scooter()],
          coupon: coupon({ maxUses: 50, maxUsesPerCustomer: 1 }),
          uses: { total: 10, customer },
        }),
      );
    expect(on(0).outcome).toBe("decided");
    expect(on(1)).toMatchObject({ reason: "customer_used_up" });
  });

  it("coupons_off: no code is accepted on any channel, whatever the code", () => {
    const off = { quote: { couponsEnabled: false } };
    for (const channel of [
      "walk_in",
      "phone",
      "booking_page",
      "marketplace",
      "api",
    ] as const) {
      expect(
        reason({ lines: [scooter()], coupon: coupon(), channel, ...off }),
      ).toBe("coupons_off");
    }
    // Before the code is even looked at.
    expect(
      reason({ lines: [scooter()], coupon: null, code: "NOPE", ...off }),
    ).toBe("coupons_off");
    expect(
      reason({ lines: [scooter()], coupon: coupon({ active: false }), ...off }),
    ).toBe("coupons_off");
    // With no code given there is nothing to refuse.
    expect(
      decideDiscounts(request({ lines: [scooter()], ...off })).outcome,
    ).toBe("decided");
  });

  it("answers the first rule that refuses, in a fixed order", () => {
    const everythingWrong = coupon({
      active: false,
      channels: ["booking_page"],
      validTo: "2027-01-01",
      maxUses: 1,
      maxUsesPerCustomer: 1,
      allProducts: false,
      productIds: ["touring"],
      pickupFrom: "2028-01-01",
      minDays: 30,
      minSpend: thb("99999"),
    });
    const fixes: Array<[string, Partial<CouponSettings>]> = [
      ["not_active", { active: true }],
      ["wrong_channel", { channels: ALL_CHANNELS }],
      ["expired", { validTo: null }],
      ["used_up", { maxUses: null }],
      ["customer_used_up", { maxUsesPerCustomer: null }],
      ["not_these_products", { allProducts: true }],
      ["wrong_dates", { pickupFrom: null }],
      ["too_short", { minDays: null }],
      ["below_minimum", { minSpend: null }],
    ];
    let current = everythingWrong;
    for (const [expected, fix] of fixes) {
      expect(
        reason({
          lines: [scooter()],
          coupon: current,
          uses: { total: 1, customer: 1 },
        }),
      ).toBe(expected);
      current = { ...current, ...fix };
    }
    expect(
      decided({
        lines: [scooter()],
        coupon: current,
        uses: { total: 1, customer: 1 },
      }).coupon?.applied,
    ).toBe(true);
  });

  it("a refusal still carries what applies without the code", () => {
    const staff: Discount = {
      id: "staff",
      source: "staff",
      lines: "all",
      percentBp: 500,
    };
    const refused = refusal({
      lines: [scooter()],
      coupon: coupon({ active: false }),
      returningCustomer: RETURNING_10,
      completedRentals: 3,
      quote: { discounts: [staff] },
    });
    expect(refused.returningCustomer).toBe(true);
    expect(ids(refused.discounts)).toEqual([RETURNING_DISCOUNT_ID, "staff"]);
    const q = quote({
      ...request({ lines: [scooter()] }).quote,
      discounts: refused.discounts,
    });
    // ฿1,400 − 10% = ฿1,260 − 5% = ฿1,197.
    expect(q.ok && q.totals.total).toBe(thb("1197"));
  });

  it("can't judge a coupon on a line with no price, and says which", () => {
    expect(
      decideDiscounts(
        request({
          lines: [scooter(), line("mystery", null)],
          coupon: coupon(),
        }),
      ),
    ).toEqual({
      outcome: "cant_price",
      unpriced: [{ lineId: "mystery", reason: "no_price" }],
    });
  });

  it("throws for input that could not have been saved", () => {
    const bad = (more: Partial<CouponSettings>) => () =>
      decideDiscounts(request({ lines: [scooter()], coupon: coupon(more) }));
    expect(bad({ currency: "USD" })).toThrow(RangeError);
    expect(bad({ amount: null })).toThrow(RangeError);
    expect(bad({ amount: 0n })).toThrow(RangeError);
    expect(bad({ kind: "percent", percentBp: 10001 })).toThrow(RangeError);
    expect(bad({ kind: "percent", percentBp: null })).toThrow(RangeError);
    expect(bad({ validFrom: "2027-02-30" })).toThrow(RangeError);
    expect(bad({ pickupTo: "1 Nov" })).toThrow(RangeError);
    expect(bad({ minDays: 0 })).toThrow(RangeError);
    expect(bad({ maxUses: 1.5 })).toThrow(RangeError);
    expect(bad({ minSpend: -1n })).toThrow(RangeError);
    // One coupon per booking: a coupon is never passed in beside a code.
    expect(() =>
      decideDiscounts(
        request({
          lines: [scooter()],
          quote: {
            discounts: [
              { id: "x", source: "coupon", lines: "all", percentBp: 500 },
            ],
          },
        }),
      ),
    ).toThrow(/decided here/);
    expect(() =>
      decideDiscounts(
        request({
          lines: [scooter()],
          coupon: coupon(),
          quote: {
            discounts: [
              { id: COUPON_ID, source: "staff", lines: "all", percentBp: 500 },
            ],
          },
        }),
      ),
    ).toThrow(/share an id/);
    expect(() =>
      decideDiscounts({
        ...request({ lines: [scooter()] }),
        productTypes: {},
        returningCustomer: RETURNING_10,
        completedRentals: 1,
      }),
    ).toThrow(/product type/);
  });
});

// ------------------------------------------------------------- how it prices

describe("the order: seasons, returning customer, coupon, staff", () => {
  it("the plan's worked example: ฿3,000, 10% returning, a ฿200 coupon that stacks", () => {
    const { decision, q } = priced({
      lines: month(),
      coupon: coupon({ withReturningDiscount: true }),
      returningCustomer: RETURNING_10,
      completedRentals: 1,
    });
    expect(ids(decision.discounts)).toEqual([RETURNING_DISCOUNT_ID, COUPON_ID]);
    expect(q.lines[0].discounts).toEqual([
      { discountId: RETURNING_DISCOUNT_ID, amount: thb("300") },
      { discountId: COUPON_ID, amount: thb("200") },
    ]);
    expect(q.totals.total).toBe(thb("2500"));
    expect(q.totals.vat).toBe(thb("163.55"));
  });

  it("the same without stacking: the customer gets the ฿300, the larger", () => {
    const { decision, q } = priced({
      lines: month(),
      coupon: coupon(),
      returningCustomer: RETURNING_10,
      completedRentals: 1,
    });
    expect(ids(decision.discounts)).toEqual([RETURNING_DISCOUNT_ID]);
    expect(decision.coupon).toEqual({
      applied: false,
      because: "returning_discount_is_better",
      couponId: "c1",
      code: "SAVE200",
    });
    expect(decision.coupons).toEqual({});
    expect(q.totals.total).toBe(thb("2700"));
    expect(q.totals.vat).toBe(thb("176.64"));
  });

  it("a stacking percentage coupon is taken on what the returning discount left", () => {
    const { q } = priced({
      lines: month(),
      coupon: percent(1000, { withReturningDiscount: true }),
      returningCustomer: RETURNING_10,
      completedRentals: 1,
    });
    // 3,000 − 300 = 2,700; 10% of 2,700 = 270.
    expect(q.lines[0].discounts.map((d) => d.amount)).toEqual([
      thb("300"),
      thb("270"),
    ]);
    expect(q.totals.total).toBe(thb("2430"));
  });

  it("a percentage coupon is taken on the price after seasons", () => {
    const { q } = priced({
      lines: [
        {
          ...scooter(),
          span: {
            start: bkk("2027-06-01"),
            end: bkk("2027-06-08"),
            timeZone: BANGKOK,
          },
        },
      ],
      coupon: percent(1000),
      quote: { seasonRules: [LOW_SEASON] },
    });
    // ฿1,400 − 20% = ฿1,120; 10% of that is ฿112.
    expect(q.lines[0].seasonPrice).toBe(thb("1120"));
    expect(q.lines[0].discount).toBe(thb("112"));
  });

  it("the staff discount is always last and never blocked by either", () => {
    const staff: Discount = {
      id: "staff",
      source: "staff",
      lines: "all",
      percentBp: 5000,
    };
    const other: Discount = {
      id: "other",
      source: "other",
      lines: "all",
      amount: thb("10"),
    };
    const ask = {
      lines: month(),
      returningCustomer: RETURNING_10,
      completedRentals: 1,
      quote: { discounts: [other, staff] },
    };
    expect(ids(decided(ask).discounts)).toEqual([
      RETURNING_DISCOUNT_ID,
      "other",
      "staff",
    ]);
    expect(
      ids(
        decided({ ...ask, coupon: coupon({ withReturningDiscount: true }) })
          .discounts,
      ),
    ).toEqual([RETURNING_DISCOUNT_ID, COUPON_ID, "other", "staff"]);
    // Not combined, the returning discount wins: staff still there.
    expect(ids(decided({ ...ask, coupon: coupon() }).discounts)).toEqual([
      RETURNING_DISCOUNT_ID,
      "other",
      "staff",
    ]);
    // Coupons off: the code is refused and the staff discount stays.
    expect(
      ids(
        refusal({
          ...ask,
          coupon: coupon(),
          quote: { ...ask.quote, couponsEnabled: false },
        }).discounts,
      ),
    ).toEqual([RETURNING_DISCOUNT_ID, "other", "staff"]);
    // 3,000 − 300 − 200 − 10 = 2,490; staff takes half of what is left.
    const { q } = priced({
      ...ask,
      coupon: coupon({ withReturningDiscount: true }),
    });
    expect(q.totals.total).toBe(thb("1245"));
  });

  it("hands snapshotQuote the coupon's id and code under its discount id", () => {
    const { decision } = priced({
      lines: month(),
      coupon: coupon({ code: "save 200" }),
    });
    expect(decision.coupon).toEqual({
      applied: true,
      couponId: "c1",
      code: "SAVE200",
      discountId: COUPON_ID,
      lineIds: ["scooter"],
    });
    expect(decision.coupons).toEqual({
      [COUPON_ID]: { couponId: "c1", code: "SAVE200" },
    });
  });
});

describe("the larger of the two, when they don't stack", () => {
  // A ฿3,000 month: the returning customer's 10% is ฿300.
  const ask = (c: CouponSettings) => ({
    lines: month(),
    coupon: c,
    returningCustomer: RETURNING_10,
    completedRentals: 1,
  });

  it("the returning discount when it takes more", () => {
    const { decision, q } = priced(ask(coupon({ amount: thb("299.99") })));
    expect(ids(decision.discounts)).toEqual([RETURNING_DISCOUNT_ID]);
    expect(decision.returningCustomer).toBe(true);
    expect(decision.coupon?.applied).toBe(false);
    expect(q.totals.total).toBe(thb("2700"));
  });

  it("the coupon when it takes more, and then no returning discount", () => {
    const { decision, q } = priced(ask(coupon({ amount: thb("300.01") })));
    expect(ids(decision.discounts)).toEqual([COUPON_ID]);
    expect(decision.returningCustomer).toBe(false);
    expect(decision.coupon?.applied).toBe(true);
    expect(q.totals.total).toBe(thb("2699.99"));

    const pct = priced(ask(percent(1500)));
    expect(ids(pct.decision.discounts)).toEqual([COUPON_ID]);
    expect(pct.q.totals.total).toBe(thb("2550"));
  });

  it("on a tie the returning discount, so the coupon is not used up", () => {
    for (const c of [coupon({ amount: thb("300") }), percent(1000)]) {
      const { decision, q } = priced(ask(c));
      expect(ids(decision.discounts)).toEqual([RETURNING_DISCOUNT_ID]);
      expect(decision.coupon).toMatchObject({
        applied: false,
        because: "returning_discount_is_better",
      });
      expect(decision.coupons).toEqual({});
      expect(q.totals.total).toBe(thb("2700"));
    }
  });

  it("is worked out on the whole invoice, by pricing it both ways", () => {
    // The returning discount reaches only the scooter (฿140 of ฿1,400); a
    // 10% coupon on everything also takes ฿50 off the ฿500 lock.
    const lines = [scooter(), line("lock", fixed("500"), { vehicle: false })];
    const types = { lock: "sale_item" as const };
    const both = priced({
      lines,
      types,
      coupon: percent(1000),
      returningCustomer: RETURNING_10,
      completedRentals: 1,
    });
    expect(ids(both.decision.discounts)).toEqual([COUPON_ID]);
    expect(both.q.totals.total).toBe(thb("1710"));
    // A coupon for the lock alone takes ฿50, less than ฿140.
    const lockOnly = priced({
      lines,
      types,
      coupon: percent(1000, { allProducts: false, productIds: ["lock"] }),
      returningCustomer: RETURNING_10,
      completedRentals: 1,
    });
    expect(ids(lockOnly.decision.discounts)).toEqual([RETURNING_DISCOUNT_ID]);
    expect(lockOnly.q.totals.total).toBe(thb("1760"));
  });

  it("a refused code never costs the customer the returning discount", () => {
    const refused = refusal({ ...ask(coupon({ minDays: 31 })) });
    expect(refused.reason).toBe("too_short");
    expect(ids(refused.discounts)).toEqual([RETURNING_DISCOUNT_ID]);
  });
});

// -------------------------------------------------- the returning customer

describe("the returning-customer discount", () => {
  const lines = [
    scooter(), // ฿1,400, a vehicle by time
    helmet(), // ฿350, gear by time
    line("jacket", fixed("200"), { days: 7, vehicle: false }), // gear at a fixed price
    line("lock", fixed("500"), { days: 7, vehicle: false }), // for sale
    line("phone-holder", perDay(thb("20")), { days: 7, vehicle: false }), // for sale
    line("delivery", fixed("300"), { days: 7, vehicle: false }), // a service
    line("wash", perDay(thb("10")), { days: 7, vehicle: false }), // a service
  ];
  const types = {
    jacket: "gear",
    lock: "sale_item",
    "phone-holder": "sale_item",
    delivery: "service",
    wash: "service",
  } as const;

  it("applies to rental lines only: vehicles and gear priced by time (Q8)", () => {
    const { decision, q } = priced({
      lines,
      types,
      returningCustomer: RETURNING_10,
      completedRentals: 1,
    });
    expect(decision.discounts).toEqual([
      {
        id: RETURNING_DISCOUNT_ID,
        source: "returning_customer",
        lines: ["scooter", "helmet"],
        percentBp: 1000,
      },
    ]);
    expect(q.lines.map((l) => l.discount)).toEqual([
      thb("140"),
      thb("35"),
      0n,
      0n,
      0n,
      0n,
      0n,
    ]);
    expect(isRentalLine(lines[0], "vehicle")).toBe(true);
    expect(isRentalLine(lines[2], "gear")).toBe(false);
    expect(isRentalLine(lines[4], "sale_item")).toBe(false);
    expect(isRentalLine(lines[6], "service")).toBe(false);
  });

  it("is not given when nothing on the invoice is a rental line", () => {
    const decision = decided({
      lines: [lines[3], lines[5]],
      types,
      returningCustomer: RETURNING_10,
      completedRentals: 9,
    });
    expect(decision.discounts).toEqual([]);
    expect(decision.returningCustomer).toBe(false);
  });

  it("needs the shop's number of completed rentals, and the setting on", () => {
    const on = (
      settings: ReturningCustomerSettings | null,
      completedRentals: number,
    ) =>
      decided({ lines: month(), returningCustomer: settings, completedRentals })
        .returningCustomer;
    expect(on(RETURNING_10, 0)).toBe(false);
    expect(on(RETURNING_10, 1)).toBe(true);
    expect(on({ ...RETURNING_10, completedRentalsNeeded: 3 }, 2)).toBe(false);
    expect(on({ ...RETURNING_10, completedRentalsNeeded: 3 }, 3)).toBe(true);
    expect(on({ ...RETURNING_10, enabled: false }, 5)).toBe(false);
    expect(on(null, 5)).toBe(false);
    expect(() => on({ ...RETURNING_10, percentBp: 0 }, 1)).toThrow(RangeError);
    expect(() => on({ ...RETURNING_10, completedRentalsNeeded: 0 }, 1)).toThrow(
      RangeError,
    );
    expect(() => on(RETURNING_10, -1)).toThrow(RangeError);
  });

  it("is not stopped by the coupons switch", () => {
    const { decision, q } = priced({
      lines: month(),
      returningCustomer: RETURNING_10,
      completedRentals: 1,
      quote: { couponsEnabled: false },
    });
    expect(decision.returningCustomer).toBe(true);
    expect(q.totals.total).toBe(thb("2700"));
  });
});

// --------------------------------------------------------- which lines

describe("which lines a coupon is taken on", () => {
  it("a coupon for chosen scooters does not reduce the helmets beside them", () => {
    const lines = [
      scooter({ quantity: 2 }), // ฿2,800
      line("helmet", perDay(thb("50")), {
        days: 7,
        quantity: 5,
        vehicle: false,
        extraOf: { lineId: "scooter", includedQuantity: 2 },
      }), // 4 included, 1 charged: ฿350
      line("delivery", fixed("300"), { days: 7, vehicle: false }),
    ];
    const types = { delivery: "service" as const };
    const scootersOnly = { allProducts: false, productIds: ["scooter"] };

    const pct = priced({ lines, types, coupon: percent(1000, scootersOnly) });
    expect(pct.decision.coupon).toMatchObject({ lineIds: ["scooter"] });
    expect(pct.q.lines.map((l) => l.discount)).toEqual([thb("280"), 0n, 0n]);
    expect(pct.q.totals.total).toBe(thb("3170"));

    // A fixed amount larger than the scooters stops at the scooters: the
    // rest is not carried to the helmets or the delivery.
    const big = priced({
      lines,
      types,
      coupon: coupon({ ...scootersOnly, amount: thb("5000") }),
    });
    expect(big.q.lines.map((l) => l.amount)).toEqual([
      0n,
      thb("350"),
      thb("300"),
    ]);
    expect(big.q.totals.discount).toBe(thb("2800"));
    expect(big.q.totals.total).toBe(thb("650"));
  });

  it("a fixed coupon is shared over its lines in proportion, to the satang", () => {
    const lines = [
      scooter(),
      line("touring", bike350(), { days: 7 }),
      helmet(),
    ];
    const { q } = priced({
      lines,
      coupon: coupon({
        amount: thb("100"),
        allProducts: false,
        productIds: ["scooter", "touring"],
      }),
    });
    // ฿1,400 and ฿1,500: 100 × 1400 ÷ 2900 = 48.28, 100 × 1500 ÷ 2900 = 51.72.
    expect(q.lines.map((l) => l.discount)).toEqual([
      thb("48.28"),
      thb("51.72"),
      0n,
    ]);
  });

  it("pickup dates and minimum days are judged line by line", () => {
    const early = scooter(); // 1 to 8 Nov
    const late = line("touring", bike350(), {
      span: {
        start: bkk("2027-11-10"),
        end: bkk("2027-11-13"),
        timeZone: BANGKOK,
      },
    }); // 10 to 13 Nov, 3 days
    const lines = [early, late];
    expect(
      decided({ lines, coupon: coupon({ pickupFrom: "2027-11-05" }) }).coupon,
    ).toMatchObject({ lineIds: ["touring"] });
    expect(
      decided({ lines, coupon: coupon({ minDays: 4 }) }).coupon,
    ).toMatchObject({
      lineIds: ["scooter"],
    });
    // The line in the pickup dates is the short one.
    expect(
      reason({
        lines,
        coupon: coupon({ pickupFrom: "2027-11-05", minDays: 4 }),
      }),
    ).toBe("too_short");
    expect(
      reason({ lines, coupon: coupon({ pickupFrom: "2027-11-11" }) }),
    ).toBe("wrong_dates");
  });

  it("a coupon on lines that come to nothing takes nothing, and is still a use", () => {
    const { decision, q } = priced({
      lines: [
        scooter(),
        line("map", { method: "free" }, { days: 7, vehicle: false }),
      ],
      coupon: coupon({ allProducts: false, productIds: ["map"] }),
    });
    expect(decision.coupon?.applied).toBe(true);
    expect(q.totals.discount).toBe(0n);
    expect(q.totals.total).toBe(thb("1400"));
  });
});

describe('"Can be used on season discounts"', () => {
  /** A week in June 2027, inside the low season (20% off). */
  const june = (id: string, more: Partial<QuoteLineInput> = {}) =>
    line(id, bike300(), {
      span: {
        start: bkk("2027-06-01"),
        end: bkk("2027-06-08"),
        timeZone: BANGKOK,
      },
      ...more,
    });
  const peak: SeasonRule = { ...LOW_SEASON, id: "peak", adjustBp: 1000 };
  const scootersLow: SeasonRule = { ...LOW_SEASON, products: ["scooter"] };

  it("on: the coupon is taken on the season price", () => {
    const { decision, q } = priced({
      lines: [june("scooter")],
      coupon: percent(1000, { withSeasonDiscount: true }),
      quote: { seasonRules: [LOW_SEASON] },
    });
    expect(decision.coupon?.applied).toBe(true);
    expect(q.lines[0].seasonPrice).toBe(thb("1120"));
    expect(q.totals.total).toBe(thb("1008"));
  });

  it("off: a line a season made cheaper is not the coupon's, and with none left it is refused", () => {
    const refused = refusal({
      lines: [june("scooter")],
      coupon: percent(1000, { withSeasonDiscount: false }),
      quote: { seasonRules: [LOW_SEASON] },
    });
    expect(refused.reason).toBe("not_these_products");
  });

  it("off: a line a season made dearer is still the coupon's", () => {
    const { decision, q } = priced({
      lines: [june("scooter")],
      coupon: percent(1000, { withSeasonDiscount: false }),
      quote: { seasonRules: [peak] },
    });
    expect(decision.coupon).toMatchObject({
      applied: true,
      lineIds: ["scooter"],
    });
    // ฿1,400 + 10% = ฿1,540; the coupon takes ฿154.
    expect(q.totals.total).toBe(thb("1386"));
  });

  it("off, mixed lines: only the lines no season made cheaper", () => {
    const lines = [
      june("scooter"), // in the scooters' low season
      june("touring", { pricing: bike350() }), // no season: ฿1,500
      line("helmet", perDay(thb("50")), {
        span: {
          start: bkk("2027-06-01"),
          end: bkk("2027-06-08"),
          timeZone: BANGKOK,
        },
        vehicle: false,
      }),
    ];
    const off = priced({
      lines,
      coupon: percent(1000, { withSeasonDiscount: false }),
      quote: { seasonRules: [scootersLow] },
    });
    expect(off.decision.coupon).toMatchObject({
      lineIds: ["touring", "helmet"],
    });
    expect(off.q.lines.map((l) => l.discount)).toEqual([
      0n,
      thb("150"),
      thb("35"),
    ]);

    const on = priced({
      lines,
      coupon: percent(1000),
      quote: { seasonRules: [scootersLow] },
    });
    expect(on.q.lines.map((l) => l.discount)).toEqual([
      thb("112"),
      thb("150"),
      thb("35"),
    ]);

    // Minimum spend then counts only the lines that are left.
    expect(
      reason({
        lines,
        coupon: percent(1000, {
          withSeasonDiscount: false,
          minSpend: thb("1850.01"),
        }),
        quote: { seasonRules: [scootersLow] },
      }),
    ).toBe("below_minimum");
  });

  it("off: a line with a cheaper season and a dearer one is still out", () => {
    // Half the week in a 20%-off season, the whole week in a 10% surcharge.
    const half: SeasonRule = {
      id: "half",
      startsOn: "2027-06-01",
      endsOn: "2027-06-03",
      repeatsYearly: false,
      adjustBp: -2000,
      products: "all",
    };
    expect(
      reason({
        lines: [june("scooter")],
        coupon: coupon({ withSeasonDiscount: false }),
        quote: { seasonRules: [half, { ...peak, adjustBp: 5000 }] },
      }),
    ).toBe("not_these_products");
  });
});

// ------------------------------------------------- deposit, and never below 0

describe("a coupon never reduces the deposit", () => {
  const lines = () => [
    scooter({ quantity: 2, deposit: thb("2000") }), // ฿2,800
    line("touring", bike350(), { days: 7 }), // ฿1,500, no deposit of its own
    helmet({ deposit: thb("999") }), // gear: never a deposit
  ];
  const modes: Array<[string, DepositSetting, bigint | "percent"]> = [
    ["no deposit", { mode: "none" }, 0n],
    [
      "fixed per order",
      { mode: "fixed_per_order", amount: thb("3000") },
      thb("3000"),
    ],
    ["per vehicle", { mode: "per_product", amount: thb("1500") }, thb("5500")],
    [
      "a percentage of the order",
      { mode: "percent_of_order", percentBp: 2000 },
      "percent",
    ],
  ];
  const coupons: Array<[string, CouponSettings]> = [
    ["a percentage coupon", percent(2500)],
    ["a fixed coupon", coupon({ amount: thb("1000") })],
    ["a fixed coupon larger than the order", coupon({ amount: thb("99999") })],
  ];

  for (const [modeName, shop, expected] of modes) {
    for (const [couponName, c] of coupons) {
      it(`${modeName}, ${couponName}`, () => {
        const deposit = { shop };
        const without = priced({ lines: lines(), quote: { deposit } }).q;
        const withCoupon = priced({
          lines: lines(),
          coupon: c,
          quote: { deposit },
        });
        const q = withCoupon.q;
        expect(withCoupon.decision.coupon?.applied).toBe(true);
        expect(q.totals.discount > 0n).toBe(true);
        expect(q.deposit.setting).toEqual(without.deposit.setting);
        if (expected === "percent") {
          // It moved only because the total it is a percentage of moved:
          // 20% of the total after discounts, tax included.
          expect(without.deposit.amount).toBe(thb("930"));
          expect(q.deposit.amount * 5n).toBe(q.totals.total);
        } else {
          expect(without.deposit.amount).toBe(expected);
          expect(q.deposit.amount).toBe(expected);
        }
        // No discount is set against a deposit: each line's is as it was.
        const req = request({ lines: lines(), quote: { deposit } });
        expect(lineDeposits(q.deposit.setting, req.quote.lines)).toEqual(
          lineDeposits(without.deposit.setting, req.quote.lines),
        );
        // The total is the lines less the discount, and nothing else.
        expect(q.totals.total).toBe(without.totals.total - q.totals.discount);
      });
    }
  }

  it("a percentage coupon with a per-vehicle deposit: the plan's case", () => {
    const one = [scooter({ deposit: thb("2000") })];
    const deposit = { shop: { mode: "per_product" as const } };
    const { q } = priced({
      lines: one,
      coupon: percent(5000),
      quote: { deposit },
    });
    expect(q.totals.total).toBe(thb("700"));
    expect(q.deposit.amount).toBe(thb("2000"));
  });

  it("a fixed coupon larger than its line stops at zero; the deposit is unchanged", () => {
    const one = [scooter({ deposit: thb("2000") })];
    const deposit = { shop: { mode: "per_product" as const } };
    const { q } = priced({
      lines: one,
      coupon: coupon({ amount: thb("5000") }),
      quote: { deposit },
    });
    expect(q.lines[0].amount).toBe(0n);
    expect(q.totals.discount).toBe(thb("1400"));
    expect(q.totals).toMatchObject({ total: 0n, vat: 0n, net: 0n });
    expect(q.deposit.amount).toBe(thb("2000"));
  });
});

describe("the total never goes below zero", () => {
  const huge = (currency: string, more: Partial<CouponSettings> = {}) =>
    coupon({
      currency,
      amount: 99_999_999n,
      withReturningDiscount: true,
      ...more,
    });
  const staff: Discount = {
    id: "staff",
    source: "staff",
    lines: "all",
    amount: 50_000n,
  };
  const staffPct: Discount = {
    id: "staff",
    source: "staff",
    lines: "all",
    percentBp: 10000,
  };

  function assertNeverNegative(q: Priced) {
    for (const each of q.lines) {
      expect(each.amount >= 0n, each.id).toBe(true);
      expect(each.discount <= each.seasonPrice, each.id).toBe(true);
    }
    for (const group of q.taxGroups) {
      expect(group.base >= 0n).toBe(true);
      expect(group.vat >= 0n).toBe(true);
      expect(group.net >= 0n).toBe(true);
    }
    expect(q.nonTaxable >= 0n).toBe(true);
    expect(q.totals.total >= 0n).toBe(true);
    expect(q.totals.vat >= 0n).toBe(true);
    expect(q.totals.net >= 0n).toBe(true);
  }

  const shops: Array<[string, string, () => QuoteLineInput[]]> = [
    ["THB", "one line", () => [scooter()]],
    [
      "THB",
      "several lines and two tax rates",
      () => [
        scooter({ quantity: 2 }),
        helmet({ taxRateBp: null }),
        line("delivery", fixed("300"), {
          days: 7,
          vehicle: false,
          taxRateBp: 1000,
        }),
      ],
    ],
    [
      "JPY",
      "several lines, no decimals",
      () => [
        line("scooter", perDay(3333n), { days: 3 }),
        line("helmet", perDay(1000n), {
          days: 3,
          vehicle: false,
          taxRateBp: 1000,
        }),
        line(
          "lock",
          { method: "fixed", amount: 500n },
          { days: 3, vehicle: false },
        ),
      ],
    ],
  ];

  for (const [currency, name, make] of shops) {
    for (const taxInclusive of [true, false]) {
      it(`${currency}, ${name}, tax ${taxInclusive ? "included" : "on top"}: alone, stacked, and with staff discounts`, () => {
        const settings: Array<Partial<Ask>> = [
          {},
          { returningCustomer: RETURNING_10, completedRentals: 1 },
          {
            returningCustomer: RETURNING_10,
            completedRentals: 1,
            quote: { taxInclusive, discounts: [staff] },
          },
          {
            returningCustomer: { ...RETURNING_10, percentBp: 10000 },
            completedRentals: 1,
            quote: { taxInclusive, discounts: [staffPct] },
          },
        ];
        for (const more of settings) {
          const { decision, q } = priced({
            lines: make(),
            currency,
            coupon: huge(currency),
            quote: { taxInclusive },
            ...more,
          });
          expect(decision.coupon?.applied).toBe(true);
          assertNeverNegative(q);
          // Larger than every line: they all come to nothing.
          expect(q.lines.map((l) => l.amount)).toEqual(q.lines.map(() => 0n));
          expect(q.totals.total).toBe(0n);
          expect(q.totals.vat).toBe(0n);
        }
        // Aimed at one product only: the others are untouched.
        const first = make()[0];
        const { q } = priced({
          lines: make(),
          currency,
          coupon: huge(currency, {
            allProducts: false,
            productIds: [first.productId],
          }),
          quote: { taxInclusive, discounts: [staff] },
          returningCustomer: RETURNING_10,
          completedRentals: 1,
        });
        assertNeverNegative(q);
        expect(q.lines[0].amount).toBe(0n);
      });
    }
  }
});

// -------------------------------------------------------- time zones, money

describe("valid dates across a New York daylight-saving change", () => {
  const NEW_YORK = "America/New_York";
  // 12 to 15 March 2027, 10:00 in New York: the clocks go forward on the 14th.
  const nycLine = (more: Partial<QuoteLineInput> = {}) =>
    line("scooter", perDay(4000n), {
      span: {
        start: new Date("2027-03-12T15:00:00.000Z"),
        end: new Date("2027-03-15T14:00:00.000Z"),
        timeZone: NEW_YORK,
      },
      ...more,
    });
  const at = (
    iso: string,
    more: Partial<CouponSettings>,
    lines = [nycLine()],
  ) => {
    const decision = decideDiscounts(
      request({
        lines,
        currency: "USD",
        coupon: coupon({ currency: "USD", ...more }),
        now: new Date(iso),
        timeZone: NEW_YORK,
        channel: "booking_page",
      }),
    );
    return decision.outcome === "refused" ? decision.reason : decision.outcome;
  };

  it("spring forward, 14 March 2027: a 23-hour day", () => {
    // The 14th starts at 00:00 EST (05:00 UTC) and ends at 24:00 EDT (04:00 UTC).
    expect(at("2027-03-14T04:59:59.999Z", { validFrom: "2027-03-14" })).toBe(
      "too_early",
    );
    expect(at("2027-03-14T05:00:00.000Z", { validFrom: "2027-03-14" })).toBe(
      "decided",
    );
    expect(at("2027-03-15T03:59:59.999Z", { validTo: "2027-03-14" })).toBe(
      "decided",
    );
    expect(at("2027-03-15T04:00:00.000Z", { validTo: "2027-03-14" })).toBe(
      "expired",
    );
    // The day before ends at 05:00 UTC, an hour later than a fixed −4 would say.
    expect(at("2027-03-14T04:30:00.000Z", { validTo: "2027-03-13" })).toBe(
      "decided",
    );
  });

  it("fall back, 7 November 2027: a 25-hour day", () => {
    // The 7th starts at 00:00 EDT (04:00 UTC) and ends at 24:00 EST (05:00 UTC).
    expect(at("2027-11-07T03:59:59.999Z", { validFrom: "2027-11-07" })).toBe(
      "too_early",
    );
    expect(at("2027-11-07T04:00:00.000Z", { validFrom: "2027-11-07" })).toBe(
      "decided",
    );
    expect(at("2027-11-08T04:59:59.999Z", { validTo: "2027-11-07" })).toBe(
      "decided",
    );
    expect(at("2027-11-08T05:00:00.000Z", { validTo: "2027-11-07" })).toBe(
      "expired",
    );
    // 01:30 happens twice that night; both are the 7th.
    expect(
      at("2027-11-07T05:30:00.000Z", {
        validFrom: "2027-11-07",
        validTo: "2027-11-07",
      }),
    ).toBe("decided");
    expect(
      at("2027-11-07T06:30:00.000Z", {
        validFrom: "2027-11-07",
        validTo: "2027-11-07",
      }),
    ).toBe("decided");
  });

  it("the pickup day and the rental's days are the location's too", () => {
    const now = "2027-03-01T15:00:00.000Z";
    // Collected at 00:30 on the 14th in New York, which is 05:30 UTC.
    const midnight = nycLine({
      span: {
        start: new Date("2027-03-14T05:30:00.000Z"),
        end: new Date("2027-03-16T04:30:00.000Z"),
        timeZone: NEW_YORK,
      },
    });
    expect(
      at(now, { pickupFrom: "2027-03-14", pickupTo: "2027-03-14" }, [midnight]),
    ).toBe("decided");
    // 23:30 on the 13th in New York is already the 14th in UTC.
    const lateEvening = nycLine({
      span: {
        start: new Date("2027-03-14T04:30:00.000Z"),
        end: new Date("2027-03-16T03:30:00.000Z"),
        timeZone: NEW_YORK,
      },
    });
    expect(at(now, { pickupFrom: "2027-03-14" }, [lateEvening])).toBe(
      "wrong_dates",
    );
    expect(at(now, { pickupTo: "2027-03-13" }, [lateEvening])).toBe("decided");
    // 10:00 on the 12th to 10:00 on the 15th is 3 days, in 71 hours.
    expect(at(now, { minDays: 3 })).toBe("decided");
    expect(at(now, { minDays: 4 })).toBe("too_short");
  });
});

describe("currencies with no decimals", () => {
  const jpyLines = () => [
    line("scooter", perDay(3333n), { days: 3 }), // ¥9,999
    line("helmet", perDay(1000n), { days: 3, vehicle: false }), // ¥3,000
    line(
      "lock",
      { method: "fixed", amount: 500n },
      { days: 3, vehicle: false },
    ), // ¥500
  ];
  const types = { lock: "sale_item" as const };

  it("JPY, a fixed coupon split over three lines in whole yen", () => {
    const { q } = priced({
      lines: jpyLines(),
      types,
      currency: "JPY",
      coupon: coupon({ currency: "JPY", amount: 1000n }),
    });
    // 1,000 × 9,999 ÷ 13,499 = 740.7, × 3,000 = 222.2, × 500 = 37.04:
    // 740 + 222 + 37 = 999, and the yen left over goes to the largest remainder.
    expect(q.lines.map((l) => l.discount)).toEqual([741n, 222n, 37n]);
    expect(q.totals.discount).toBe(1000n);
    expect(q.totals.total).toBe(12_499n);
    // 12,499 × 7 ÷ 107 = 817.69…
    expect(q.totals.vat).toBe(818n);
  });

  it("JPY, a percentage coupon and the returning discount, one rounding per line", () => {
    const pct = priced({
      lines: jpyLines(),
      types,
      currency: "JPY",
      coupon: percent(1500, { currency: "JPY" }),
    });
    // 15% of 9,999 is 1,499.85; of 3,000 is 450; of 500 is 75.
    expect(pct.q.lines.map((l) => l.discount)).toEqual([1500n, 450n, 75n]);

    const stacked = priced({
      lines: jpyLines(),
      types,
      currency: "JPY",
      coupon: percent(1500, { currency: "JPY", withReturningDiscount: true }),
      returningCustomer: { ...RETURNING_10, percentBp: 750 },
      completedRentals: 2,
    });
    // 7.5%: 749.925 → 750 and 225; then 15% of 9,249 = 1,387.35, of 2,775 =
    // 416.25, of 500 = 75.
    expect(
      stacked.q.lines.map((l) => l.discounts.map((d) => d.amount)),
    ).toEqual([[750n, 1387n], [225n, 416n], [75n]]);
    expect(stacked.q.totals.total).toBe(
      13_499n - 750n - 225n - 1387n - 416n - 75n,
    );
  });

  it("VND, tax on top: fixed and percentage, and the larger of the two", () => {
    const lines = () => [
      line("scooter", perDay(150_000n), { days: 7, taxRateBp: 1000 }),
    ];
    const ask = { currency: "VND", quote: { taxInclusive: false } };
    const fixedCoupon = priced({
      lines: lines(),
      ...ask,
      coupon: coupon({
        currency: "VND",
        amount: 100_000n,
        minSpend: 1_050_000n,
      }),
    });
    // 1,050,000 − 100,000 = 950,000 + 10% VAT.
    expect(fixedCoupon.q.totals).toMatchObject({
      vat: 95_000n,
      total: 1_045_000n,
    });

    const pct = priced({
      lines: lines(),
      ...ask,
      coupon: percent(1250, { currency: "VND" }),
    });
    expect(pct.q.totals).toMatchObject({
      discount: 131_250n,
      vat: 91_875n,
      total: 1_010_625n,
    });

    // 10% is ₫105,000: more than ₫100,000, less than 12.5%.
    const returning = { returningCustomer: RETURNING_10, completedRentals: 1 };
    expect(
      priced({
        lines: lines(),
        ...ask,
        ...returning,
        coupon: coupon({ currency: "VND", amount: 100_000n }),
      }).decision.coupon?.applied,
    ).toBe(false);
    expect(
      priced({
        lines: lines(),
        ...ask,
        ...returning,
        coupon: percent(1250, { currency: "VND" }),
      }).decision.coupon?.applied,
    ).toBe(true);
  });
});

// ----------------------------------------------------------------- properties

describe("totals never fall as days rise, with each discount in play", () => {
  const NEW_YORK = "America/New_York";
  const starts: Array<[Date, string]> = [
    [bkk("2027-01-01"), BANGKOK],
    [bkk("2027-01-31"), BANGKOK], // a month end
    [bkk("2028-02-29"), BANGKOK], // a leap day
    [bkk("2027-12-15", "23:30"), BANGKOK], // over New Year
    [new Date("2027-03-13T15:00:00.000Z"), NEW_YORK], // the day before the clocks go forward
    [new Date("2027-11-06T14:00:00.000Z"), NEW_YORK], // the day before they go back
  ];
  const staff: Discount = {
    id: "staff",
    source: "staff",
    lines: "all",
    amount: thb("150"),
  };
  const returning = { returningCustomer: RETURNING_10, completedRentals: 1 };
  const plays: Array<[string, Partial<Ask>]> = [
    ["the returning-customer discount", returning],
    ["a percentage coupon", { coupon: percent(1500) }],
    ["a fixed coupon", { coupon: coupon({ amount: thb("500") }) }],
    [
      "a fixed coupon for the scooter only",
      {
        coupon: coupon({
          amount: thb("2500"),
          allProducts: false,
          productIds: ["scooter"],
        }),
      },
    ],
    [
      "a coupon or the returning discount, whichever is larger",
      { ...returning, coupon: coupon({ amount: thb("450") }) },
    ],
    [
      "all three stacked, and a staff discount",
      {
        ...returning,
        coupon: percent(1500, { withReturningDiscount: true }),
        quote: { discounts: [staff] },
      },
    ],
  ];

  it.each(plays)("%s", (_name, play) => {
    let checked = 0;
    for (const [start, timeZone] of starts) {
      const linesTo = (end: Date) => [
        line("scooter", bike300(), { span: { start, end, timeZone } }),
        line("helmet", perDay(thb("50")), {
          span: { start, end, timeZone },
          quantity: 2,
          vehicle: false,
          extraOf: { lineId: "scooter", includedQuantity: 1 },
        }),
      ];
      const ends: Date[] = [];
      for (const hours of [1, 6, 23]) {
        ends.push(new Date(start.getTime() + hours * 60 * 60 * 1000));
      }
      for (let days = 1; days <= 400; days += 1) {
        ends.push(addZonedDays(start, days, timeZone));
      }
      let before: Priced | null = null;
      for (const end of ends) {
        const { q } = priced({ lines: linesTo(end), timeZone, ...play });
        if (before) {
          const label = `${timeZone} ${start.toISOString()} → ${end.toISOString()}`;
          expect(q.totals.total >= before.totals.total, label).toBe(true);
          expect(q.totals.listPrice >= before.totals.listPrice, label).toBe(
            true,
          );
          q.lines.forEach((each, index) => {
            expect(each.amount >= before!.lines[index].amount, label).toBe(
              true,
            );
          });
        }
        expect(q.totals.total >= 0n).toBe(true);
        before = q;
        checked += 1;
      }
    }
    expect(checked).toBe(starts.length * 403);
  });

  it("a coupon's own thresholds are the exception: reaching the minimum days makes the longer rental cheaper", () => {
    const c = coupon({ amount: thb("500"), minDays: 7 });
    const six = decideDiscounts(
      request({ lines: [scooter({ days: 6 })], coupon: c }),
    );
    expect(six).toMatchObject({ outcome: "refused", reason: "too_short" });
    const seven = priced({ lines: [scooter({ days: 7 })], coupon: c });
    // 6 days cost more than 7 with the coupon: the coupon doing its job.
    const sixPrice = quote(request({ lines: [scooter({ days: 6 })] }).quote);
    expect(sixPrice.ok && sixPrice.totals.total > seven.q.totals.total).toBe(
      true,
    );
  });
});

describe("every pinned D2 and D3 figure is unchanged when no discount applies", () => {
  const all = pinnedQuotes();
  const hasCoupon = (each: (typeof all)[number]) =>
    (each.input.discounts ?? []).some((d) => d.source === "coupon");
  const plain = all.filter((each) => !hasCoupon(each));

  it("covers every pinned invoice but the ones that pass a coupon in themselves", () => {
    expect(all.length).toBe(43);
    // A coupon passed in is refused here: a coupon comes from a code.
    expect(all.filter(hasCoupon).map((each) => each.name).length).toBe(
      all.length - plain.length,
    );
    expect(plain.length).toBeGreaterThanOrEqual(40);
    for (const each of all.filter(hasCoupon)) {
      expect(() =>
        decideDiscounts({
          quote: each.input,
          productTypes: {},
          currency: each.context.currency,
          now: each.context.pricedAt,
          timeZone: BANGKOK,
          channel: "walk_in",
          completedRentals: 0,
        }),
      ).toThrow(/decided here/);
    }
  });

  const settings: Array<[string, Partial<DiscountRequest>]> = [
    ["no code, no returning-customer settings", {}],
    [
      "a first-time customer in a shop with the returning discount on",
      { returningCustomer: RETURNING_10, completedRentals: 0 },
    ],
    [
      "a returning customer in a shop with it off",
      {
        returningCustomer: { ...RETURNING_10, enabled: false },
        completedRentals: 9,
      },
    ],
  ];

  it.each(plain.map((each) => [`${each.from}: ${each.name}`, each] as const))(
    "%s",
    (_name, each) => {
      for (const [, more] of settings) {
        const decision = decideDiscounts({
          quote: each.input,
          productTypes: Object.fromEntries(
            Object.entries(each.context.lines).map(([id, l]) => [
              id,
              l.productType,
            ]),
          ),
          currency: each.context.currency,
          now: each.context.pricedAt,
          timeZone: each.input.lines[0].span.timeZone,
          channel: "walk_in",
          completedRentals: 0,
          ...more,
        });
        if (decision.outcome !== "decided")
          throw new Error("expected a decision");
        expect(decision.discounts).toEqual(each.input.discounts ?? []);
        expect(decision.coupon).toBeNull();
        expect(decision.returningCustomer).toBe(false);

        const q = quote({ ...each.input, discounts: decision.discounts });
        expect(q).toEqual(quote(each.input));
        if (!q.ok) throw new Error("expected a priced quote");
        const got = {
          total: q.totals.total,
          vat: q.totals.vat,
          net: q.totals.net,
          discount: q.totals.discount,
          credit: q.totals.credit,
          nonTaxable: q.nonTaxable,
          deposit: q.deposit.amount,
          amounts: q.lines.map((l) => l.amount),
        };
        for (const key of Object.keys(each.pinned) as Array<keyof typeof got>) {
          expect(got[key], key).toEqual(each.pinned[key]);
        }
      }
    },
  );
});

// ------------------------------------------------------------------- snapshot

describe("snapshotQuote records each discount that was decided", () => {
  it("id, source, the coupon's id and code, kind, value and the amount per line", () => {
    const lines = [
      scooter(), // ฿1,400
      helmet(), // ฿350
      line("lock", fixed("500"), { days: 7, vehicle: false }),
    ];
    const staff: Discount = {
      id: "staff-1",
      source: "staff",
      lines: ["lock"],
      amount: thb("50"),
    };
    const req = request({
      lines,
      types: { lock: "sale_item" },
      coupon: coupon({
        id: "8c0d",
        code: "Low Season 27",
        amount: thb("175"),
        allProducts: false,
        productIds: ["scooter", "helmet"],
        withReturningDiscount: true,
      }),
      returningCustomer: RETURNING_10,
      completedRentals: 2,
      quote: { discounts: [staff] },
    });
    const decision = decideDiscounts(req);
    if (decision.outcome !== "decided") throw new Error("expected a decision");
    const quoteInput = { ...req.quote, discounts: decision.discounts };
    const context = contextFor(quoteInput, { coupons: decision.coupons });
    const read = readSnapshot(
      JSON.parse(JSON.stringify(snapshotQuote(quoteInput, context))),
    );

    const couponId = couponDiscountId("8c0d");
    expect(read.discounts).toEqual([
      {
        discountId: RETURNING_DISCOUNT_ID,
        source: "returning_customer",
        couponId: null,
        couponCode: null,
        kind: "percent",
        percentBp: 1000,
        fixedAmount: null,
        allLines: false,
        lineIds: ["scooter", "helmet"],
        total: thb("175"),
      },
      {
        discountId: couponId,
        source: "coupon",
        couponId: "8c0d",
        couponCode: "LOWSEASON27",
        kind: "fixed",
        percentBp: null,
        fixedAmount: thb("175"),
        allLines: false,
        lineIds: ["scooter", "helmet"],
        total: thb("175"),
      },
      {
        discountId: "staff-1",
        source: "staff",
        couponId: null,
        couponCode: null,
        kind: "fixed",
        percentBp: null,
        fixedAmount: thb("50"),
        allLines: false,
        lineIds: ["lock"],
        total: thb("50"),
      },
    ]);

    // Per line: 10% of 1,400 and of 350, then ฿175 shared 1,260 : 315.
    const perLine = read.lines.map((l) =>
      l.discounts.map((d) => [d.discountId, d.source, d.couponCode, d.amount]),
    );
    expect(perLine).toEqual([
      [
        [RETURNING_DISCOUNT_ID, "returning_customer", null, thb("140")],
        [couponId, "coupon", "LOWSEASON27", thb("140")],
      ],
      [
        [RETURNING_DISCOUNT_ID, "returning_customer", null, thb("35")],
        [couponId, "coupon", "LOWSEASON27", thb("35")],
      ],
      [["staff-1", "staff", null, thb("50")]],
    ]);
    expect(read.lines.map((l) => l.amount)).toEqual([
      thb("1120"),
      thb("280"),
      thb("450"),
    ]);
    expect(read.totals.discount).toBe(thb("400"));
    expect(read.totals.total).toBe(thb("1850"));
  });

  it("a coupon that lost to the returning discount is not in the snapshot", () => {
    const req = request({
      lines: month(),
      coupon: coupon(),
      returningCustomer: RETURNING_10,
      completedRentals: 1,
    });
    const decision = decideDiscounts(req);
    if (decision.outcome !== "decided") throw new Error("expected a decision");
    const quoteInput = { ...req.quote, discounts: decision.discounts };
    const read = readSnapshot(
      snapshotQuote(
        quoteInput,
        contextFor(quoteInput, { coupons: decision.coupons }),
      ),
    );
    expect(read.discounts.map((d) => d.source)).toEqual(["returning_customer"]);
    expect(read.lines[0].discounts.map((d) => d.couponId)).toEqual([null]);
  });

  it("a coupon larger than its lines is recorded with what it was and what it took", () => {
    const req = request({
      lines: [scooter({ deposit: thb("2000") })],
      coupon: coupon({ amount: thb("5000") }),
      quote: { deposit: { shop: { mode: "per_product" } } },
    });
    const decision = decideDiscounts(req);
    if (decision.outcome !== "decided") throw new Error("expected a decision");
    const quoteInput = { ...req.quote, discounts: decision.discounts };
    const read = readSnapshot(
      snapshotQuote(
        quoteInput,
        contextFor(quoteInput, { coupons: decision.coupons }),
      ),
    );
    expect(read.discounts[0]).toMatchObject({
      couponId: "c1",
      couponCode: "SAVE200",
      fixedAmount: thb("5000"),
      total: thb("1400"),
    });
    expect(read.totals.total).toBe(0n);
    expect(read.deposit.amount).toBe(thb("2000"));
    expect(read.lines[0].deposit).toBe(thb("2000"));
  });
});
