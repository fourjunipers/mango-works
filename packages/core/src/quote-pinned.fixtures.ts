/**
 * Test fixtures only: every pinned figure of stages D2 (`quote.test.ts`) and
 * D3 (`rental-period.test.ts`), and Phase 2's own (extras, a zero-decimal
 * shop, a daylight-saving shop), as invoices that can be priced again.
 *
 * `quote-snapshot.test.ts` prices each one, checks the pinned figures, and
 * puts it through the snapshot. The two older test files are not changed by
 * Phase 2, stage 4: they are the proof that a line with no parent is priced
 * as before. This file restates their inputs so the snapshot can be tested
 * on the same invoices.
 */

import { fillPriceList, type ResolvedList } from "./price-list";
import type {
  DepositSetting,
  Discount,
  QuoteInput,
  QuoteLineInput,
} from "./quote";
import type { SnapshotContext } from "./quote-snapshot";
import { settleSwap, swapAmounts, type OpenPeriod } from "./rental-period";
import type { Pricing } from "./rental-price";
import type { SeasonRule } from "./season";

/** A decimal amount as a string ("116.66") → minor units, with no float. */
export function minor(amount: string, exponent = 2): bigint {
  const negative = amount.startsWith("-");
  const [whole, fraction = ""] = amount.replace(/[-,]/g, "").split(".");
  if (fraction.length > exponent)
    throw new RangeError(`Too precise: ${amount}`);
  const units = BigInt(whole + fraction.padEnd(exponent, "0"));
  return negative ? -units : units;
}
export const thb = (amount: string) => minor(amount, 2);

export const BANGKOK = "Asia/Bangkok";
export const bkk = (date: string, time = "10:00") =>
  new Date(`${date}T${time}:00+07:00`);

function list(
  daily: string,
  weekly: string,
  twoWeeks: string,
  monthly: string,
  exponent = 2,
  step = "10",
): ResolvedList {
  const filled = fillPriceList(
    {
      daily: minor(daily, exponent),
      weekly: minor(weekly, exponent),
      twoWeeks: minor(twoWeeks, exponent),
      monthly: minor(monthly, exponent),
    },
    new Map(),
    minor(step, exponent),
  );
  return { days: filled.days.map((d) => d.total), hourly: null };
}

const tiered = (l: ResolvedList, longStay: bigint): Pricing => ({
  method: "tiered",
  list: l,
  longStayDay: longStay,
});

/** Fresh every call, so a test may change one without touching the others. */
export const bike300 = () =>
  tiered(list("300", "1400", "2100", "3000"), thb("100"));
export const bike350 = () =>
  tiered(list("350", "1500", "2500", "3500"), thb("116.66"));
/** The owner's swap example: A is ฿1,500 for two weeks, B is ฿1,700. */
export const bikeA = () =>
  tiered(list("300", "900", "1500", "3000"), thb("100"));
export const bikeB = () =>
  tiered(list("350", "1000", "1700", "3500"), thb("116.66"));
export const fixed = (amount: string): Pricing => ({
  method: "fixed",
  amount: thb(amount),
});
export const perDay = (amount: bigint): Pricing => ({
  method: "per_period",
  amount,
  period: "day",
});

export const VAT_7 = 700;
export const NO_DEPOSIT: DepositSetting = { mode: "none" };

/** A line from 1 Nov 2027 (outside any season used here) for `days` days. */
export function line(
  id: string,
  pricing: Pricing | null,
  more: Partial<QuoteLineInput> & { days?: number } = {},
): QuoteLineInput {
  const { days = 30, ...rest } = more;
  const start = bkk("2027-11-01");
  return {
    id,
    productId: id,
    pricing,
    quantity: 1,
    span: {
      start,
      end: new Date(start.getTime() + days * 24 * 60 * 60 * 1000),
      timeZone: BANGKOK,
    },
    taxRateBp: VAT_7,
    vehicle: true,
    ...rest,
  };
}

const between = (from: string, to: string) => ({
  span: { start: bkk(from), end: bkk(to), timeZone: BANGKOK },
});

export const LOW_SEASON: SeasonRule = {
  id: "low",
  startsOn: "2027-04-01",
  endsOn: "2027-09-30",
  repeatsYearly: true,
  adjustBp: -2000,
  products: "all",
};

export function input(
  more: Partial<QuoteInput> & { lines: readonly QuoteLineInput[] },
): QuoteInput {
  return {
    taxInclusive: true,
    couponsEnabled: false,
    deposit: { shop: NO_DEPOSIT },
    ...more,
  };
}

/**
 * The names a snapshot needs, made up from the input: every line's product,
 * the profile of every taxed line, every season and every coupon.
 */
export function contextFor(
  quoteInput: QuoteInput,
  more: Partial<SnapshotContext> = {},
): SnapshotContext {
  return {
    currency: "THB",
    exponent: 2,
    pricedAt: new Date("2027-10-20T03:15:00.000Z"),
    lines: Object.fromEntries(
      quoteInput.lines.map((each) => [
        each.id,
        {
          productName: `Product ${each.productId}`,
          productType: each.vehicle ? ("vehicle" as const) : ("gear" as const),
          taxProfile:
            each.taxRateBp === null
              ? null
              : { id: `tax-${each.taxRateBp}`, name: `VAT ${each.taxRateBp}` },
        },
      ]),
    ),
    seasons: Object.fromEntries(
      (quoteInput.seasonRules ?? []).map((rule) => [
        rule.id,
        { name: `Season ${rule.id}` },
      ]),
    ),
    coupons: Object.fromEntries(
      (quoteInput.discounts ?? [])
        .filter((discount) => discount.source === "coupon")
        .map((discount) => [
          discount.id,
          { couponId: `coupon-${discount.id}`, code: discount.id },
        ]),
    ),
    ...more,
  };
}

export type Pinned = {
  from: "D2" | "D3" | "Phase 2";
  name: string;
  input: QuoteInput;
  context: SnapshotContext;
  /** The figures the older tests pin, in minor units. */
  pinned: {
    total?: bigint;
    vat?: bigint;
    net?: bigint;
    discount?: bigint;
    credit?: bigint;
    nonTaxable?: bigint;
    deposit?: bigint;
    /** Each line's amount, in order. */
    amounts?: bigint[];
  };
};

const staff = (more: Partial<Discount>): Discount =>
  ({ id: "d", source: "staff", lines: "all", ...more }) as Discount;

function scenario(
  from: Pinned["from"],
  name: string,
  more: Partial<QuoteInput> & { lines: readonly QuoteLineInput[] },
  pinned: Pinned["pinned"],
  context: Partial<SnapshotContext> = {},
): Pinned {
  const quoteInput = input(more);
  return {
    from,
    name,
    input: quoteInput,
    context: contextFor(quoteInput, context),
    pinned,
  };
}

// ---------------------------------------------------------------- D3's swap

/** January: collected 1 Jan, billed to 1 Feb, swapped or returned on 15 Jan. */
export const january = (more: Partial<OpenPeriod> = {}): OpenPeriod => ({
  rentalStart: bkk("2027-01-01"),
  start: bkk("2027-01-01"),
  end: bkk("2027-02-01"),
  at: bkk("2027-01-15"),
  timeZone: BANGKOK,
  pricing: bikeA(),
  priceBeforeDiscount: thb("3000"),
  charged: thb("3000"),
  ...more,
});

export function continuationLine(
  pricing: Pricing,
  rentalStart: Date,
  start: Date,
  end: Date,
  more: Partial<QuoteLineInput> = {},
): QuoteLineInput {
  return {
    id: "new-period",
    productId: "bike",
    pricing,
    quantity: 1,
    span: { start, end, timeZone: BANGKOK },
    rentalStart,
    taxRateBp: VAT_7,
    vehicle: true,
    ...more,
  };
}

/** The first booking of the owner's swap example: bike A for January. */
export const firstBooking = (discount?: bigint): QuoteInput =>
  input({
    lines: [
      {
        id: "january",
        productId: "bike-a",
        pricing: bikeA(),
        quantity: 1,
        span: {
          start: bkk("2027-01-01"),
          end: bkk("2027-02-01"),
          timeZone: BANGKOK,
        },
        taxRateBp: VAT_7,
        vehicle: true,
      },
    ],
    discounts: discount
      ? [{ id: "deal", source: "staff", lines: ["january"], amount: discount }]
      : [],
  });

// ------------------------------------------------------------ every scenario

export function pinnedQuotes(): Pinned[] {
  const scooters = [
    line("scooter", bike300(), { quantity: 2, deposit: thb("2000") }),
    line("touring", bike350(), { deposit: thb("5000") }),
    line("plain", bike300(), { deposit: null }),
    line("helmet", fixed("100"), { vehicle: false, deposit: thb("999") }),
  ];
  const up = swapAmounts(january(), bikeB());
  const upKept = swapAmounts(january({ charged: thb("2500") }), bikeB());
  const down = swapAmounts(
    january({
      pricing: bikeB(),
      priceBeforeDiscount: thb("3500"),
      charged: thb("3500"),
    }),
    bikeA(),
  );
  const settled = settleSwap(down.newRemainder, down.paidRemainder, "credit");
  const jan1 = bkk("2027-01-01");

  // Phase 2: a dong shop (no decimals) and a New York shop (daylight saving).
  const vnd = (amount: string) => minor(amount, 0);
  const saigon = (date: string) => new Date(`${date}T09:00:00+07:00`);
  const dongLine = (
    id: string,
    pricing: Pricing,
    more: Partial<QuoteLineInput> = {},
  ): QuoteLineInput => ({
    id,
    productId: id,
    pricing,
    quantity: 1,
    span: {
      start: saigon("2027-11-01"),
      end: saigon("2027-11-04"),
      timeZone: "Asia/Ho_Chi_Minh",
    },
    taxRateBp: 800,
    vehicle: false,
    ...more,
  });
  const usd = (amount: string) => minor(amount, 2);
  const nyc = {
    // 12 to 15 March 2027, 10:00 in New York: the clocks go forward on the 14th.
    start: new Date("2027-03-12T15:00:00.000Z"),
    end: new Date("2027-03-15T14:00:00.000Z"),
    timeZone: "America/New_York",
  };

  return [
    // -------------------------------------------------------------- D2: VAT
    scenario(
      "D2",
      "prices include VAT: ฿3,000 at 7%",
      { lines: [line("a", bike300())] },
      { total: thb("3000"), vat: thb("196.26"), net: thb("2803.74") },
    ),
    scenario(
      "D2",
      "VAT added on top: ฿3,000 net at 7%",
      { taxInclusive: false, lines: [line("a", bike300())] },
      { total: thb("3210"), vat: thb("210"), net: thb("3000") },
    ),
    scenario(
      "D2",
      "three lines of ฿350: VAT on the invoice, not line by line",
      {
        lines: [
          line("a", fixed("350")),
          line("b", fixed("350")),
          line("c", fixed("350")),
        ],
      },
      { total: thb("1050"), vat: thb("68.69"), net: thb("981.31") },
    ),
    scenario(
      "D2",
      "one VAT line per rate, and none for what is not taxable",
      {
        lines: [
          line("bike", bike300()),
          line("cover", fixed("1000"), { taxRateBp: 1000, vehicle: false }),
          line("permit", fixed("500"), { taxRateBp: null, vehicle: false }),
          line("helmet", fixed("107"), { vehicle: false }),
        ],
      },
      {
        total: thb("4607"),
        vat: thb("294.17"),
        net: thb("4312.83"),
        nonTaxable: thb("500"),
      },
    ),
    scenario(
      "D2",
      "a shop that charges no tax",
      { lines: [line("a", bike300(), { taxRateBp: null })] },
      { total: thb("3000"), vat: 0n, net: thb("3000") },
    ),
    scenario(
      "D2",
      "a zero-rated group",
      { lines: [line("a", bike300(), { taxRateBp: 0 })] },
      { total: thb("3000"), vat: 0n, net: thb("3000") },
    ),
    // -------------------------------------------------------- D2: discounts
    scenario(
      "D2",
      "a staff price of ฿2,500 against ฿3,000",
      {
        lines: [line("a", bike300())],
        discounts: [staff({ amount: thb("500"), lines: ["a"] })],
      },
      {
        total: thb("2500"),
        vat: thb("163.55"),
        net: thb("2336.45"),
        discount: thb("500"),
      },
    ),
    scenario(
      "D2",
      "a percentage on each line, VAT on top of what is left",
      {
        taxInclusive: false,
        lines: [
          line("a", bike300()),
          line("b", fixed("333"), { vehicle: false }),
        ],
        discounts: [staff({ percentBp: 1000 })],
      },
      { total: thb("3209.68"), vat: thb("209.98"), net: thb("2999.70") },
    ),
    scenario(
      "D2",
      "an order discount shared over its lines",
      {
        lines: [
          line("bike", bike300(), { days: 7 }),
          line("box", fixed("300"), { vehicle: false }),
        ],
        discounts: [staff({ amount: thb("200") })],
      },
      {
        total: thb("1500"),
        discount: thb("200"),
        amounts: [thb("1235.29"), thb("264.71")],
      },
    ),
    scenario(
      "D2",
      "an order discount split across tax-rate groups before VAT",
      {
        lines: [
          line("bike", bike300(), { days: 7 }),
          line("box", fixed("300"), { vehicle: false, taxRateBp: null }),
        ],
        discounts: [staff({ amount: thb("200") })],
      },
      {
        total: thb("1500"),
        vat: thb("80.81"),
        nonTaxable: thb("264.71"),
      },
    ),
    scenario(
      "D2",
      "two discounts, each on what the last one left",
      {
        lines: [line("a", bike300())],
        discounts: [
          staff({ id: "first", percentBp: 1000 }),
          staff({ id: "second", percentBp: 1000 }),
        ],
      },
      { total: thb("2430"), amounts: [thb("2430")] },
    ),
    scenario(
      "D2",
      "a discount larger than its lines takes them to zero",
      {
        lines: [line("a", fixed("100")), line("b", fixed("50"))],
        discounts: [staff({ amount: thb("500") })],
      },
      { total: 0n, vat: 0n, net: 0n, discount: thb("150"), amounts: [0n, 0n] },
    ),
    scenario(
      "D2",
      "a 10% coupon, with the switch on",
      {
        couponsEnabled: true,
        lines: [line("a", bike300())],
        discounts: [
          { id: "WELCOME10", source: "coupon", lines: "all", percentBp: 1000 },
        ],
      },
      { total: thb("2700"), vat: thb("176.64") },
    ),
    // ---------------------------------------------------------- D2: seasons
    scenario(
      "D2",
      "3 of 7 days at 20% off, then a 10% discount",
      {
        lines: [line("a", bike300(), between("2027-03-28", "2027-04-04"))],
        seasonRules: [LOW_SEASON],
        discounts: [staff({ percentBp: 1000 })],
      },
      { total: thb("1152"), vat: thb("75.36"), discount: thb("128") },
    ),
    scenario(
      "D2",
      "a season that keeps the satang",
      {
        lines: [line("a", bike350(), between("2027-03-27", "2027-04-03"))],
        seasonRules: [LOW_SEASON],
      },
      { total: thb("1414.29") },
    ),
    scenario(
      "D2",
      "a season on two bikes, rounded once on the line",
      {
        lines: [
          {
            ...line("a", bike350(), between("2027-03-27", "2027-04-03")),
            quantity: 2,
          },
        ],
        seasonRules: [LOW_SEASON],
      },
      { total: thb("2828.57") },
    ),
    scenario(
      "D2",
      "a season leaves a fixed price and a deposit alone",
      {
        lines: [
          line("bike", bike300(), between("2027-06-01", "2027-06-08")),
          line("box", fixed("300"), {
            ...between("2027-06-01", "2027-06-08"),
            vehicle: false,
          }),
        ],
        seasonRules: [LOW_SEASON],
        deposit: { shop: { mode: "fixed_per_order", amount: thb("2000") } },
      },
      {
        total: thb("1420"),
        amounts: [thb("1120"), thb("300")],
        deposit: thb("2000"),
      },
    ),
    // ------------------------------------------------------ D2: swap credit
    scenario(
      "D2",
      "a swap credit: VAT on the ฿300 actually paid",
      {
        lines: [line("b", fixed("1800"))],
        credits: [{ id: "from-a", amount: thb("1500"), taxRateBp: VAT_7 }],
      },
      {
        total: thb("300"),
        vat: thb("19.63"),
        net: thb("280.37"),
        credit: thb("1500"),
        amounts: [thb("1800")],
      },
    ),
    scenario(
      "D2",
      "a swap credit with VAT added on top",
      {
        taxInclusive: false,
        lines: [line("b", fixed("1800"))],
        credits: [{ id: "from-a", amount: thb("1500"), taxRateBp: VAT_7 }],
      },
      { total: thb("321"), vat: thb("21"), net: thb("300") },
    ),
    // --------------------------------------------------------- D2: deposits
    scenario("D2", "deposit: none", { lines: scooters }, { deposit: 0n }),
    scenario(
      "D2",
      "deposit: 30% of the order",
      {
        lines: scooters,
        deposit: { shop: { mode: "percent_of_order", percentBp: 3000 } },
      },
      { total: thb("12600"), deposit: thb("3780") },
    ),
    scenario(
      "D2",
      "deposit: 30% of the order after a ฿600 discount",
      {
        lines: scooters,
        discounts: [staff({ amount: thb("600") })],
        deposit: { shop: { mode: "percent_of_order", percentBp: 3000 } },
      },
      { total: thb("12000"), deposit: thb("3600") },
    ),
    scenario(
      "D2",
      "deposit: 30% of the order with VAT on top",
      {
        taxInclusive: false,
        lines: scooters,
        deposit: { shop: { mode: "percent_of_order", percentBp: 3000 } },
      },
      { total: thb("13482"), deposit: thb("4044.60") },
    ),
    scenario(
      "D2",
      "deposit: a fixed amount per order",
      {
        lines: scooters,
        deposit: { shop: { mode: "fixed_per_order", amount: thb("3000") } },
      },
      { deposit: thb("3000") },
    ),
    scenario(
      "D2",
      "deposit: per vehicle, with the shop's amount for a bike with none",
      {
        lines: scooters,
        deposit: { shop: { mode: "per_product", amount: thb("1500") } },
      },
      { deposit: thb("10500") },
    ),
    scenario(
      "D2",
      "deposit: per vehicle, no shop amount",
      { lines: scooters, deposit: { shop: { mode: "per_product" } } },
      { deposit: thb("9000") },
    ),
    scenario(
      "D2",
      "deposit: waived for the customer",
      {
        lines: scooters,
        deposit: {
          shop: { mode: "per_product", amount: thb("1500") },
          customer: { mode: "none" },
        },
      },
      { deposit: 0n },
    ),
    scenario(
      "D2",
      "deposit: set on the order",
      {
        lines: scooters,
        deposit: {
          shop: { mode: "per_product", amount: thb("1500") },
          customer: { mode: "none" },
          order: { mode: "fixed_per_order", amount: thb("1000") },
        },
      },
      { deposit: thb("1000") },
    ),
    // ------------------------------------------------------------- D2: rest
    scenario(
      "D2",
      "three units of ฿107",
      { lines: [line("a", fixed("107"), { quantity: 3 })] },
      { total: thb("321"), vat: thb("21") },
    ),
    scenario(
      "D2",
      "a free line",
      { lines: [line("a", { method: "free" })] },
      { total: 0n, vat: 0n, net: 0n },
    ),
    scenario(
      "D2",
      "a season, a discount and a credit on one invoice",
      {
        lines: [
          line("a", bike300(), between("2027-03-28", "2027-04-04")),
          line("b", fixed("300"), { taxRateBp: null, vehicle: false }),
        ],
        seasonRules: [LOW_SEASON],
        discounts: [staff({ amount: thb("77.77") })],
        credits: [{ id: "c", amount: thb("100"), taxRateBp: VAT_7 }],
      },
      { total: thb("1402.23"), discount: thb("77.77"), credit: thb("100") },
    ),
    // ------------------------------------------------------- D3: extensions
    scenario(
      "D3",
      "an extension of 14 days, all in low season",
      {
        lines: [
          continuationLine(
            bike300(),
            bkk("2027-03-01"),
            bkk("2027-04-01"),
            bkk("2027-04-15"),
          ),
        ],
        seasonRules: [LOW_SEASON],
      },
      { total: thb("1120"), vat: thb("73.27") },
    ),
    scenario(
      "D3",
      "an extension that crosses into a season: 3 of its 10 days",
      {
        lines: [
          continuationLine(
            bike300(),
            bkk("2027-03-01"),
            bkk("2027-03-25"),
            bkk("2027-04-04"),
          ),
        ],
        seasonRules: [LOW_SEASON],
      },
      {},
    ),
    scenario(
      "D3",
      "an extension that keeps the last period's discount",
      {
        lines: [
          continuationLine(
            bike300(),
            jan1,
            bkk("2027-02-01"),
            bkk("2027-03-01"),
          ),
        ],
        discounts: [
          {
            id: "kept",
            source: "staff",
            lines: ["new-period"],
            amount: thb("500"),
          },
        ],
      },
      { total: thb("2500"), vat: thb("163.55") },
    ),
    // ------------------------------------------------------------ D3: swaps
    scenario(
      "D3",
      "a swap with a credit: ฿300 extra at the two-week point",
      {
        lines: [continuationLine(bikeB(), jan1, up.span.start, up.span.end)],
        credits: [{ id: "from-a", amount: up.paidRemainder, taxRateBp: VAT_7 }],
      },
      { total: thb("300"), credit: thb("1500"), vat: thb("19.63") },
    ),
    scenario(
      "D3",
      "a swap that keeps the customer's discount: ฿250",
      {
        lines: [
          continuationLine(bikeB(), jan1, upKept.span.start, upKept.span.end),
        ],
        discounts: [
          {
            id: "kept",
            source: "staff",
            lines: ["new-period"],
            amount:
              upKept.newRemainder - upKept.remainder.keepDiscount.newCharged,
          },
        ],
        credits: [
          { id: "from-a", amount: upKept.paidRemainder, taxRateBp: VAT_7 },
        ],
      },
      { total: thb("250"), vat: thb("16.36"), credit: thb("1250") },
    ),
    scenario(
      "D3",
      "a cheaper bike: the swap invoice comes to nothing",
      {
        lines: [
          continuationLine(bikeA(), jan1, down.span.start, down.span.end),
        ],
        credits: [
          { id: "from-b", amount: settled.creditApplied, taxRateBp: VAT_7 },
        ],
      },
      { total: 0n, vat: 0n, credit: thb("1500") },
    ),
    scenario(
      "D3",
      "a cheaper bike: the ฿300 kept comes off the next extension",
      {
        lines: [
          continuationLine(bikeA(), jan1, bkk("2027-02-01"), bkk("2027-03-01")),
        ],
        credits: [{ id: "kept", amount: settled.creditKept, taxRateBp: VAT_7 }],
      },
      { total: thb("2700"), vat: thb("176.64"), credit: thb("300") },
    ),
    scenario(
      "D3",
      "a swap with the new bike's own deposit beside it",
      {
        lines: [
          continuationLine(bikeB(), jan1, up.span.start, up.span.end, {
            deposit: thb("5000"),
          }),
        ],
        credits: [{ id: "from-a", amount: up.paidRemainder, taxRateBp: VAT_7 }],
        deposit: { shop: { mode: "per_product" } },
      },
      { total: thb("300"), vat: thb("19.63"), deposit: thb("5000") },
    ),
    // -------------------------------------------------------------- Phase 2
    scenario(
      "Phase 2",
      "a scooter with 2 helmets included, 3 taken, and a free drop-off",
      {
        lines: [
          line("scooter", bike300(), { days: 7 }),
          line("helmet", perDay(thb("50")), {
            days: 7,
            quantity: 3,
            vehicle: false,
            extraOf: { lineId: "scooter", includedQuantity: 2 },
          }),
          line(
            "drop-off",
            { method: "free" },
            {
              days: 7,
              vehicle: false,
              taxRateBp: null,
              extraOf: { lineId: "scooter", includedQuantity: 0 },
            },
          ),
        ],
      },
      // 1,400 + one helmet at ฿50 × 7 days.
      { total: thb("1750"), amounts: [thb("1400"), thb("350"), 0n] },
    ),
    scenario(
      "Phase 2",
      "a dong shop: three lines, a season, a fixed coupon, 8% VAT included",
      {
        couponsEnabled: true,
        lines: [
          dongLine("scooter", perDay(vnd("150000")), { vehicle: true }),
          dongLine("helmet", perDay(vnd("20000")), {
            quantity: 3,
            extraOf: { lineId: "scooter", includedQuantity: 1 },
          }),
          dongLine("rack", { method: "fixed", amount: vnd("70000") }),
        ],
        seasonRules: [
          {
            id: "tet",
            startsOn: "2027-11-02",
            endsOn: "2027-11-03",
            repeatsYearly: false,
            adjustBp: 1500,
            products: ["scooter"],
          },
        ],
        discounts: [
          {
            id: "XINCHAO",
            source: "coupon",
            lines: "all",
            amount: vnd("100000"),
          },
        ],
      },
      // 450,000 + 15% of 2 of 3 days (45,000) = 495,000; helmets 2 × 60,000;
      // the rack 70,000: 685,000, less 100,000.
      { total: vnd("585000"), discount: vnd("100000"), vat: vnd("43333") },
      { currency: "VND", exponent: 0 },
    ),
    scenario(
      "Phase 2",
      "a dong shop with 10% VAT added on top",
      {
        taxInclusive: false,
        lines: [
          dongLine(
            "a",
            { method: "fixed", amount: vnd("33333") },
            {
              taxRateBp: 1000,
            },
          ),
          dongLine(
            "b",
            { method: "fixed", amount: vnd("33333") },
            {
              taxRateBp: 1000,
            },
          ),
          dongLine(
            "c",
            { method: "fixed", amount: vnd("33339") },
            {
              taxRateBp: 1000,
            },
          ),
        ],
      },
      // 100,005 × 10% = 10,000.5 → 10,001.
      { total: vnd("110006"), vat: vnd("10001"), net: vnd("100005") },
      { currency: "VND", exponent: 0 },
    ),
    scenario(
      "Phase 2",
      "a New York shop across the night the clocks go forward",
      {
        taxInclusive: false,
        lines: [
          {
            id: "bike",
            productId: "bike",
            pricing: perDay(usd("45.00")),
            quantity: 1,
            span: nyc,
            taxRateBp: 888,
            vehicle: true,
          },
          {
            id: "lock",
            productId: "lock",
            pricing: perDay(usd("3.33")),
            quantity: 2,
            span: nyc,
            taxRateBp: 888,
            vehicle: false,
            extraOf: { lineId: "bike", includedQuantity: 1 },
          },
        ],
      },
      // 3 days on New York's clock though only 71 hours pass: 135.00 + 9.99;
      // 144.99 × 8.88% = 12.875… → 12.88.
      { total: usd("157.87"), vat: usd("12.88"), net: usd("144.99") },
      { currency: "USD", exponent: 2 },
    ),
  ];
}
