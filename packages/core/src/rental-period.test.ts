import { describe, expect, it } from "vitest";
import { fillPriceList, type ResolvedList } from "./price-list";
import {
  quote,
  vatFor,
  type DepositSetting,
  type QuoteLineInput,
} from "./quote";
import {
  carryDiscount,
  earlyReturn,
  extensionPrice,
  settleSwap,
  swapAmounts,
  unusedPart,
  type OpenPeriod,
} from "./rental-period";
import { unitPrice, type Pricing } from "./rental-price";
import type { SeasonRule } from "./season";

/** Baht as a string ("116.66") → satang, with no float on the way. */
function thb(amount: string): bigint {
  const negative = amount.startsWith("-");
  const [whole, fraction = ""] = amount.replace(/[-,]/g, "").split(".");
  const satang =
    BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -satang : satang;
}

const BANGKOK = "Asia/Bangkok";
const bkk = (date: string, time = "10:00") =>
  new Date(`${date}T${time}:00+07:00`);

function list(
  daily: string,
  weekly: string,
  twoWeeks: string,
  monthly: string,
) {
  const filled = fillPriceList(
    {
      daily: thb(daily),
      weekly: thb(weekly),
      twoWeeks: thb(twoWeeks),
      monthly: thb(monthly),
    },
    new Map(),
    thb("10"),
  );
  return {
    days: filled.days.map((d) => d.total),
    hourly: null,
  } as ResolvedList;
}

const tiered = (l: ResolvedList, longStay: string): Pricing => ({
  method: "tiered",
  list: l,
  longStayDay: thb(longStay),
});

// BSR's 300–3000 list: ฿2,100 for two weeks, ฿3,000 a month, ฿100 a long-stay day.
const BIKE_300 = tiered(list("300", "1400", "2100", "3000"), "100");

// The owner's swap example (15 Nov 2026): bike A is ฿1,500 for two weeks and
// ฿3,000 a month; bike B is ฿1,700 for two weeks and ฿3,500 a month.
const BIKE_A = tiered(list("300", "900", "1500", "3000"), "100");
const BIKE_B = tiered(list("350", "1000", "1700", "3500"), "116.66");

/** January: collected 1 Jan, billed to 1 Feb, swapped or returned on 15 Jan. */
const january = (more: Partial<OpenPeriod> = {}): OpenPeriod => ({
  rentalStart: bkk("2027-01-01"),
  start: bkk("2027-01-01"),
  end: bkk("2027-02-01"),
  at: bkk("2027-01-15"),
  timeZone: BANGKOK,
  pricing: BIKE_A,
  priceBeforeDiscount: thb("3000"),
  charged: thb("3000"),
  ...more,
});

const VAT_7 = 700;
const NO_DEPOSIT: DepositSetting = { mode: "none" };

/** The new period of a swap or an extension, as a line of its own invoice. */
function continuationLine(
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

function invoice(
  input: Omit<
    Parameters<typeof quote>[0],
    "taxInclusive" | "couponsEnabled" | "deposit"
  > & { deposit?: DepositSetting },
) {
  const { deposit = NO_DEPOSIT, ...rest } = input;
  const result = quote({
    taxInclusive: true,
    couponsEnabled: false,
    deposit: { shop: deposit },
    ...rest,
  });
  if (!result.ok) throw new Error("expected a priced invoice");
  return result;
}

describe("Extend rental: priced as a continuation (owner, 15 Nov 2026)", () => {
  const jan1 = bkk("2027-01-01");
  const extend = (currentEnd: string, newEnd: string, pricing = BIKE_300) =>
    extensionPrice({
      pricing,
      rentalStart: jan1,
      currentEnd: bkk(currentEnd),
      newEnd: bkk(newEnd),
      timeZone: BANGKOK,
    });

  it("month 13 costs ฿3,000", () => {
    expect(extend("2028-01-01", "2028-02-01").listPrice).toBe(thb("3000"));
  });

  it("a year, a month at a time, costs ฿36,000", () => {
    // prettier-ignore
    const boundaries = [
      "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01",
      "2027-06-01", "2027-07-01", "2027-08-01", "2027-09-01", "2027-10-01",
      "2027-11-01", "2027-12-01", "2028-01-01",
    ];
    // The first month is a first rental; the other eleven are extensions.
    let total = unitPrice(BIKE_300, {
      start: jan1,
      end: bkk(boundaries[1]),
      timeZone: BANGKOK,
    }).amount;
    for (let month = 1; month < 12; month++) {
      const period = extend(boundaries[month], boundaries[month + 1]);
      expect(period.listPrice).toBe(thb("3000"));
      total += period.listPrice;
    }
    expect(total).toBe(thb("36000"));
    // And billed in one go it is the same.
    expect(
      unitPrice(BIKE_300, {
        start: jan1,
        end: bkk("2028-01-01"),
        timeZone: BANGKOK,
      }).amount,
    ).toBe(thb("36000"));
  });

  it("a month extended by 14 days costs 14 × ฿100 = ฿1,400, not the two-week price", () => {
    const period = extend("2027-02-01", "2027-02-15");
    expect(period.listPrice).toBe(thb("1400"));
    // A first-time 14-day rental still pays the two-week price.
    const first = unitPrice(BIKE_300, {
      start: jan1,
      end: bkk("2027-01-15"),
      timeZone: BANGKOK,
    });
    expect(first.amount).toBe(thb("2100"));
    expect(first.basis).toEqual({ kind: "list", days: 14 });
  });

  it("keeps satang exact on a long-stay day of ฿116.66", () => {
    expect(extend("2027-02-01", "2027-02-15", BIKE_B).listPrice).toBe(
      thb("1633.24"),
    );
  });

  it("renews from the original pickup date: 31 Jan, 28 Feb, 31 Mar", () => {
    const from31 = (currentEnd: string, newEnd: string) =>
      extensionPrice({
        pricing: BIKE_300,
        rentalStart: bkk("2027-01-31"),
        currentEnd: bkk(currentEnd),
        newEnd: bkk(newEnd),
        timeZone: BANGKOK,
      }).listPrice;
    // A first period of 31 Jan → 3 Mar (31 days) is one month and 3 days.
    expect(from31("2027-03-03", "2027-03-31")).toBe(thb("2700")); // to two months
    expect(from31("2027-03-31", "2027-04-30")).toBe(thb("3000"));
  });

  it("extends inside the list at the list's own steps", () => {
    // 14 days extended to 28: the 28-day total less the 14-day total.
    const l = BIKE_300.method === "tiered" ? BIKE_300.list.days : [];
    expect(extend("2027-01-15", "2027-01-29").listPrice).toBe(l[27] - l[13]);
  });

  it("uses today's prices at both ends, so a price rise reaches only the new period", () => {
    // The bike was ฿3,000 a month for a year and is ฿3,300 today.
    const today = tiered(list("330", "1500", "2300", "3300"), "110");
    // Month 13 is ฿3,300: not 13 × 3,300 − 36,000 = ฿6,900.
    expect(extend("2028-01-01", "2028-02-01", today).listPrice).toBe(
      thb("3300"),
    );
  });

  it("keeps the last period's discount, as a ratio, by default", () => {
    const withLast = (charged: string, before = "3000") =>
      extensionPrice({
        pricing: BIKE_300,
        rentalStart: jan1,
        currentEnd: bkk("2027-02-01"),
        newEnd: bkk("2027-03-01"),
        timeZone: BANGKOK,
        lastPeriod: { priceBeforeDiscount: thb(before), charged: thb(charged) },
      });
    // ฿2,500 against ฿3,000: the next ฿3,000 month starts at ฿2,500.
    expect(withLast("2500")).toMatchObject({
      listPrice: thb("3000"),
      keepDiscount: thb("2500"),
    });
    // No discount last time: the list price.
    expect(withLast("3000").keepDiscount).toBe(thb("3000"));
    // With nothing to go on it is the list price too.
    expect(extend("2027-02-01", "2027-03-01").keepDiscount).toBe(thb("3000"));
    // A season on the last period is not a discount: ฿2,400 charged against
    // ฿2,400 after the season carries nothing over.
    expect(withLast("2400", "2400").keepDiscount).toBe(thb("3000"));
    // ฿2,000 against ฿2,400 after the season keeps five sixths.
    expect(withLast("2000", "2400").keepDiscount).toBe(thb("2500"));
  });

  it("extends a flat fee by its own periods, and a fixed price costs nothing more", () => {
    const perDay: Pricing = {
      method: "per_period",
      amount: thb("200"),
      period: "day",
    };
    expect(extend("2027-01-08", "2027-01-11", perDay).listPrice).toBe(
      thb("600"),
    );
    expect(
      extend("2027-01-08", "2027-01-11", {
        method: "fixed",
        amount: thb("150"),
      }).listPrice,
    ).toBe(0n);
  });

  it("refuses an end that is not later, and a start before the pickup", () => {
    expect(() => extend("2027-02-01", "2027-02-01")).toThrow(RangeError);
    expect(() => extend("2027-02-01", "2027-01-20")).toThrow(RangeError);
    expect(() => extend("2026-12-01", "2027-01-20")).toThrow(RangeError);
  });
});

describe("an extension on its own invoice", () => {
  const low: SeasonRule = {
    id: "low",
    startsOn: "2027-04-01",
    endsOn: "2027-09-30",
    repeatsYearly: true,
    adjustBp: -2000,
    products: "all",
  };

  it("takes seasons on its own days only, and its own VAT", () => {
    // Rented 1 Mar → 1 Apr, extended to 15 Apr. The 14 new days start on
    // 1 to 14 Apr, all in low season: ฿1,400 − 20% = ฿1,120.
    const q = invoice({
      lines: [
        continuationLine(
          BIKE_300,
          bkk("2027-03-01"),
          bkk("2027-04-01"),
          bkk("2027-04-15"),
        ),
      ],
      seasonRules: [low],
    });
    expect(q.lines[0]).toMatchObject({
      listPrice: thb("1400"),
      seasonPrice: thb("1120"),
    });
    expect(q.lines[0].seasons).toEqual([
      { ruleId: "low", periodsInside: 14, amount: thb("-280") },
    ]);
    // 1,120 × 7 ÷ 107 = 73.271…
    expect(q.totals).toMatchObject({ total: thb("1120"), vat: thb("73.27") });
  });

  it("counts only the new days when the extension crosses into a season", () => {
    // Rented 1 Mar → 25 Mar (24 days), extended to 4 Apr (34 days: a month
    // and 3 days = ฿3,300). The 10 new days start on 25 Mar to 3 Apr: 3 inside.
    const l = BIKE_300.method === "tiered" ? BIKE_300.list.days : [];
    const listPrice = thb("3300") - l[23];
    const q = invoice({
      lines: [
        continuationLine(
          BIKE_300,
          bkk("2027-03-01"),
          bkk("2027-03-25"),
          bkk("2027-04-04"),
        ),
      ],
      seasonRules: [low],
    });
    expect(q.lines[0].listPrice).toBe(listPrice);
    expect(q.lines[0].seasons[0].periodsInside).toBe(3);
    // list price × 20% × 3 ÷ 10, half up.
    expect(q.lines[0].seasons[0].amount).toBe(
      -((2n * listPrice * 2000n * 3n + 100000n) / 200000n),
    );
  });

  it("puts a kept discount through as a staff discount, before VAT", () => {
    const period = extensionPrice({
      pricing: BIKE_300,
      rentalStart: bkk("2027-01-01"),
      currentEnd: bkk("2027-02-01"),
      newEnd: bkk("2027-03-01"),
      timeZone: BANGKOK,
      lastPeriod: { priceBeforeDiscount: thb("3000"), charged: thb("2500") },
    });
    const q = invoice({
      lines: [
        continuationLine(
          BIKE_300,
          bkk("2027-01-01"),
          period.span.start,
          period.span.end,
        ),
      ],
      discounts: [
        {
          id: "kept",
          source: "staff",
          lines: ["new-period"],
          amount: period.listPrice - period.keepDiscount,
        },
      ],
    });
    expect(q.totals.total).toBe(thb("2500"));
    expect(q.totals.vat).toBe(vatFor(thb("2500"), 700, true).vat);
  });
});

describe("Swap bike: the owner's example, remainder of the period", () => {
  it("costs ฿300 extra at the two-week point after paying ฿3,000", () => {
    const swap = swapAmounts(january(), BIKE_B);
    // B's remainder: 3,500 − 1,700.
    expect(swap.newRemainder).toBe(thb("1800"));
    // A's paid remainder: 3,000 × (1,500 ÷ 3,000).
    expect(swap).toMatchObject({
      periodList: thb("3000"),
      usedList: thb("1500"),
      unusedList: thb("1500"),
      paidRemainder: thb("1500"),
    });
    expect(swap.remainder.fullPrice).toEqual({
      newCharged: thb("1800"),
      extra: thb("300"),
    });
    // With no discount to keep, both amounts are the same.
    expect(swap.remainder.keepDiscount).toEqual(swap.remainder.fullPrice);
  });

  it("with ฿2,500 paid against ฿3,000: ฿250 keeping the discount, ฿550 without", () => {
    const swap = swapAmounts(january({ charged: thb("2500") }), BIKE_B);
    // The paid remainder is 2,500 × (1,500 ÷ 3,000).
    expect(swap.paidRemainder).toBe(thb("1250"));
    // Keep the discount: B's remainder scales by 2,500 ÷ 3,000.
    expect(swap.remainder.keepDiscount).toEqual({
      newCharged: thb("1500"),
      extra: thb("250"),
    });
    expect(swap.remainder.fullPrice).toEqual({
      newCharged: thb("1800"),
      extra: thb("550"),
    });
  });

  it("gives the same ฿300 on the new invoice, with VAT on the ฿300 paid", () => {
    const swap = swapAmounts(january(), BIKE_B);
    const q = invoice({
      lines: [
        continuationLine(
          BIKE_B,
          bkk("2027-01-01"),
          swap.span.start,
          swap.span.end,
        ),
      ],
      credits: [{ id: "from-a", amount: swap.paidRemainder, taxRateBp: VAT_7 }],
    });
    expect(q.lines[0].listPrice).toBe(swap.newRemainder);
    expect(q.totals).toMatchObject({
      total: thb("300"),
      credit: thb("1500"),
      vat: thb("19.63"),
    });
  });

  it("gives the same ฿250 on the new invoice when the discount is kept", () => {
    const swap = swapAmounts(january({ charged: thb("2500") }), BIKE_B);
    const q = invoice({
      lines: [
        continuationLine(
          BIKE_B,
          bkk("2027-01-01"),
          swap.span.start,
          swap.span.end,
        ),
      ],
      discounts: [
        {
          id: "kept",
          source: "staff",
          lines: ["new-period"],
          amount: swap.newRemainder - swap.remainder.keepDiscount.newCharged,
        },
      ],
      credits: [{ id: "from-a", amount: swap.paidRemainder, taxRateBp: VAT_7 }],
    });
    expect(q.totals.total).toBe(thb("250"));
    expect(q.totals.vat).toBe(vatFor(thb("250"), 700, true).vat);
  });

  it("does not carry a season over as if it were a discount", () => {
    // The old period was in low season: ฿2,400 after the season, ฿2,400 paid.
    const inSeason = swapAmounts(
      january({ priceBeforeDiscount: thb("2400"), charged: thb("2400") }),
      BIKE_B,
    );
    expect(inSeason.remainder.keepDiscount.newCharged).toBe(thb("1800"));
    expect(inSeason.paidRemainder).toBe(thb("1200"));
    // With ฿2,000 paid against that ฿2,400, five sixths are kept.
    const discounted = swapAmounts(
      january({ priceBeforeDiscount: thb("2400"), charged: thb("2000") }),
      BIKE_B,
    );
    expect(discounted.remainder.keepDiscount.newCharged).toBe(thb("1500"));
    expect(discounted.paidRemainder).toBe(thb("1000"));
  });

  it("counts a part-used day as used", () => {
    // Swapped on 15 Jan at 15:00: 15 days have started on each bike.
    const swap = swapAmounts(
      january({ at: bkk("2027-01-15", "15:00") }),
      BIKE_B,
    );
    const a = BIKE_A.method === "tiered" ? BIKE_A.list.days : [];
    const b = BIKE_B.method === "tiered" ? BIKE_B.list.days : [];
    expect(swap.usedList).toBe(a[14]);
    expect(swap.newRemainder).toBe(thb("3500") - b[14]);
  });

  it("works in a later period of the rental, with long-stay days", () => {
    // Month 2 (1 Feb → 1 Mar), ฿3,000 paid, swapped on 15 Feb.
    const swap = swapAmounts(
      january({
        start: bkk("2027-02-01"),
        end: bkk("2027-03-01"),
        at: bkk("2027-02-15"),
      }),
      BIKE_B,
    );
    // A: the month is ฿3,000; the 14 days used are 14 × ฿100.
    expect(swap).toMatchObject({
      periodList: thb("3000"),
      usedList: thb("1400"),
      unusedList: thb("1600"),
      paidRemainder: thb("1600"),
    });
    // B: two months ฿7,000, less a month and 14 days at ฿116.66 (฿5,133.24).
    expect(swap.newRemainder).toBe(thb("1866.76"));
    expect(swap.remainder.fullPrice.extra).toBe(thb("266.76"));
  });
});

describe("Swap bike: prorated difference", () => {
  it("is the two bikes' list prices for the period × the remaining share of days", () => {
    // (3,500 − 3,000) × 17 ÷ 31 = 274.193…
    expect(swapAmounts(january(), BIKE_B).proratedDifference).toEqual({
      amount: thb("274.19"),
      remainingDays: 17,
      periodDays: 31,
    });
  });

  it("is not scaled by the customer's discount", () => {
    expect(
      swapAmounts(january({ charged: thb("2500") }), BIKE_B).proratedDifference
        .amount,
    ).toBe(thb("274.19"));
  });

  it("is negative for a cheaper bike", () => {
    expect(
      swapAmounts(
        january({
          pricing: BIKE_B,
          priceBeforeDiscount: thb("3500"),
          charged: thb("3500"),
        }),
        BIKE_A,
      ).proratedDifference.amount,
    ).toBe(thb("-274.19"));
  });
});

describe("Swap to a cheaper bike: credit, refund or no charge", () => {
  // From B (฿3,500 paid) to A at the two-week point.
  const down = swapAmounts(
    january({
      pricing: BIKE_B,
      priceBeforeDiscount: thb("3500"),
      charged: thb("3500"),
    }),
    BIKE_A,
  );

  it("comes to a negative amount", () => {
    // A's remainder: 3,000 − 1,500. B's paid remainder: 3,500 × (1,800 ÷ 3,500).
    expect(down.newRemainder).toBe(thb("1500"));
    expect(down.paidRemainder).toBe(thb("1800"));
    expect(down.remainder.fullPrice.extra).toBe(thb("-300"));
  });

  it("credit: nothing to pay now, ฿300 kept toward the next extension", () => {
    expect(settleSwap(down.newRemainder, down.paidRemainder, "credit")).toEqual(
      {
        toPay: 0n,
        creditApplied: thb("1500"),
        creditKept: thb("300"),
        refund: 0n,
        forgone: 0n,
      },
    );
  });

  it("refund: nothing to pay now, ฿300 refunded", () => {
    expect(settleSwap(down.newRemainder, down.paidRemainder, "refund")).toEqual(
      {
        toPay: 0n,
        creditApplied: thb("1500"),
        creditKept: 0n,
        refund: thb("300"),
        forgone: 0n,
      },
    );
  });

  it("no charge: nothing to pay and nothing back", () => {
    expect(
      settleSwap(down.newRemainder, down.paidRemainder, "no_charge"),
    ).toEqual({
      toPay: 0n,
      creditApplied: thb("1500"),
      creditKept: 0n,
      refund: 0n,
      forgone: thb("300"),
    });
  });

  it("leaves nothing over on an upgrade, whatever the shop's choice", () => {
    for (const choice of ["credit", "refund", "no_charge"] as const) {
      expect(settleSwap(thb("1800"), thb("1500"), choice)).toEqual({
        toPay: thb("300"),
        creditApplied: thb("1500"),
        creditKept: 0n,
        refund: 0n,
        forgone: 0n,
      });
    }
  });

  it("the swap invoice comes to nothing, and the kept credit reduces the next extension", () => {
    const settled = settleSwap(down.newRemainder, down.paidRemainder, "credit");
    const swapInvoice = invoice({
      lines: [
        continuationLine(
          BIKE_A,
          bkk("2027-01-01"),
          down.span.start,
          down.span.end,
        ),
      ],
      credits: [
        { id: "from-b", amount: settled.creditApplied, taxRateBp: VAT_7 },
      ],
    });
    expect(swapInvoice.totals).toMatchObject({ total: 0n, vat: 0n });
    // The next month on bike A is ฿3,000; the ฿300 kept comes off it.
    const next = invoice({
      lines: [
        continuationLine(
          BIKE_A,
          bkk("2027-01-01"),
          bkk("2027-02-01"),
          bkk("2027-03-01"),
        ),
      ],
      credits: [{ id: "kept", amount: settled.creditKept, taxRateBp: VAT_7 }],
    });
    expect(next.totals.total).toBe(thb("2700"));
    expect(next.totals.vat).toBe(vatFor(thb("2700"), 700, true).vat);
  });
});

describe("Early return: a swap to nothing", () => {
  it("leaves the money paid toward the unused part, under the same three choices", () => {
    // ฿3,000 paid for January, returned on 15 Jan: half the list price is unused.
    expect(earlyReturn(january(), "credit")).toMatchObject({
      unusedList: thb("1500"),
      paidRemainder: thb("1500"),
      settlement: {
        toPay: 0n,
        creditApplied: 0n,
        creditKept: thb("1500"),
        refund: 0n,
        forgone: 0n,
      },
    });
    expect(earlyReturn(january(), "refund").settlement).toMatchObject({
      refund: thb("1500"),
      creditKept: 0n,
    });
    expect(earlyReturn(january(), "no_charge").settlement).toMatchObject({
      forgone: thb("1500"),
      refund: 0n,
      creditKept: 0n,
    });
  });

  it("is the same unused part as a swap's, discount included", () => {
    const period = january({ charged: thb("2500") });
    const returned = earlyReturn(period, "refund");
    expect(returned.paidRemainder).toBe(thb("1250"));
    expect(returned.settlement.refund).toBe(thb("1250"));
    expect(returned.paidRemainder).toBe(
      swapAmounts(period, BIKE_B).paidRemainder,
    );
    expect(unusedPart(period).paidRemainder).toBe(thb("1250"));
  });

  it("returns less the later the bike comes back", () => {
    const l = BIKE_A.method === "tiered" ? BIKE_A.list.days : [];
    // Returned on 25 Jan: 24 days used.
    const late = earlyReturn(january({ at: bkk("2027-01-25") }), "refund");
    expect(late.usedList).toBe(l[23]);
    expect(late.settlement.refund).toBe(thb("3000") - l[23]);
    expect(late.settlement.refund < thb("1500")).toBe(true);
  });
});

describe("the deposit is not touched by any of this", () => {
  it("no swap, settlement, early-return or extension result has a deposit in it", () => {
    const results = [
      swapAmounts(january(), BIKE_B),
      settleSwap(thb("1500"), thb("1800"), "refund"),
      earlyReturn(january(), "credit"),
      extensionPrice({
        pricing: BIKE_300,
        rentalStart: bkk("2027-01-01"),
        currentEnd: bkk("2027-02-01"),
        newEnd: bkk("2027-03-01"),
        timeZone: BANGKOK,
      }),
    ];
    for (const result of results) {
      expect(
        JSON.stringify(result, (_, v) => (typeof v === "bigint" ? `${v}` : v)),
      ).not.toMatch(/deposit/i);
    }
  });

  it("the swap's invoice and its VAT are the same whatever the deposit setting", () => {
    const swap = swapAmounts(january(), BIKE_B);
    const swapInvoice = (deposit: DepositSetting, bikeDeposit: bigint | null) =>
      invoice({
        lines: [
          continuationLine(
            BIKE_B,
            bkk("2027-01-01"),
            swap.span.start,
            swap.span.end,
            {
              deposit: bikeDeposit,
            },
          ),
        ],
        credits: [
          { id: "from-a", amount: swap.paidRemainder, taxRateBp: VAT_7 },
        ],
        deposit,
      });
    const plain = swapInvoice(NO_DEPOSIT, null);
    // Bike A's deposit was ฿2,000 and bike B's is ฿5,000: the pricer reports
    // B's beside the price, and the totals and the VAT base do not move.
    const perProduct = swapInvoice({ mode: "per_product" }, thb("5000"));
    expect(perProduct.deposit.amount).toBe(thb("5000"));
    expect(perProduct.totals).toEqual(plain.totals);
    expect(perProduct.taxGroups).toEqual(plain.taxGroups);
    expect(plain.totals).toMatchObject({
      total: thb("300"),
      vat: thb("19.63"),
    });
  });
});

describe("carryDiscount", () => {
  it("keeps the ratio, rounded half up once", () => {
    const last = { priceBeforeDiscount: thb("3000"), charged: thb("2500") };
    expect(carryDiscount(thb("3000"), last)).toBe(thb("2500"));
    expect(carryDiscount(thb("1800"), last)).toBe(thb("1500"));
    // 1,400 × 2,500 ÷ 3,000 = 1,166.666…
    expect(carryDiscount(thb("1400"), last)).toBe(thb("1166.67"));
    expect(carryDiscount(3n, { priceBeforeDiscount: 2n, charged: 1n })).toBe(
      2n,
    ); // 1.5
    expect(carryDiscount(100n, { priceBeforeDiscount: 3n, charged: 1n })).toBe(
      33n,
    );
    expect(carryDiscount(0n, last)).toBe(0n);
  });

  it("carries nothing from a period that cost nothing or was given away", () => {
    expect(
      carryDiscount(thb("3000"), { priceBeforeDiscount: 0n, charged: 0n }),
    ).toBe(thb("3000"));
    expect(
      carryDiscount(thb("3000"), {
        priceBeforeDiscount: thb("3000"),
        charged: 0n,
      }),
    ).toBe(0n);
  });

  it("refuses amounts that can't be", () => {
    expect(() =>
      carryDiscount(thb("3000"), {
        priceBeforeDiscount: thb("3000"),
        charged: thb("3001"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      carryDiscount(-1n, { priceBeforeDiscount: 1n, charged: 1n }),
    ).toThrow(RangeError);
  });
});

describe("what a swap or a return needs", () => {
  it("must fall inside the period", () => {
    expect(() => unusedPart(january({ at: bkk("2027-02-01") }))).toThrow(
      RangeError,
    );
    expect(() => unusedPart(january({ at: bkk("2027-01-01") }))).toThrow(
      RangeError,
    );
    expect(() => unusedPart(january({ at: bkk("2027-03-01") }))).toThrow(
      RangeError,
    );
    expect(() => unusedPart(january({ start: bkk("2026-12-01") }))).toThrow(
      RangeError,
    );
  });

  it("carries nothing from a period that had no list price", () => {
    const free = unusedPart(
      january({
        pricing: { method: "free" },
        priceBeforeDiscount: 0n,
        charged: 0n,
      }),
    );
    expect(free).toEqual({
      periodList: 0n,
      usedList: 0n,
      unusedList: 0n,
      paidRemainder: 0n,
    });
  });

  it("refuses negative amounts to settle", () => {
    expect(() => settleSwap(-1n, 0n, "credit")).toThrow(RangeError);
    expect(() => settleSwap(0n, -1n, "credit")).toThrow(RangeError);
  });
});
