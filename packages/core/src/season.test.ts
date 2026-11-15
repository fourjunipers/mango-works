import { describe, expect, it } from "vitest";
import { fillPriceList, type ResolvedList } from "./price-list";
import { unitPrice, type Pricing, type RentalSpan } from "./rental-price";
import {
  adjustmentParts,
  chargedPeriodStarts,
  seasonAdjustments,
  type SeasonRule,
} from "./season";

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
const span = (start: Date, end: Date, timeZone = BANGKOK): RentalSpan => ({
  start,
  end,
  timeZone,
});

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

const BIKE_300: Pricing = {
  method: "tiered",
  list: list("300", "1400", "2100", "3000"),
  longStayDay: thb("100"),
};
const BIKE_350: Pricing = {
  method: "tiered",
  list: list("350", "1500", "2500", "3500"),
  longStayDay: thb("116.66"),
};

/** BSR's rule: low season, 1 Apr to 30 Sep, every year, 20% off. */
const LOW_SEASON: SeasonRule = {
  id: "low",
  startsOn: "2027-04-01",
  endsOn: "2027-09-30",
  repeatsYearly: true,
  adjustBp: -2000,
  products: "all",
};

/** The adjustments of one unit of a product for a rental. */
function adjust(
  pricing: Pricing,
  s: RentalSpan,
  rules: SeasonRule[],
  productId = "bike",
) {
  const unit = unitPrice(pricing, s);
  const starts = chargedPeriodStarts(unit, s);
  if (starts === null) return null;
  return seasonAdjustments(unit.amount, starts, rules, productId);
}

describe("season rules: the part of the rental inside the range", () => {
  it("takes 20% off 3 of 7 days: ฿120 off ฿1,400", () => {
    // 28 Mar → 4 Apr: days start on 28, 29, 30, 31 Mar and 1, 2, 3 Apr.
    expect(
      adjust(BIKE_300, span(bkk("2027-03-28"), bkk("2027-04-04")), [
        LOW_SEASON,
      ]),
    ).toEqual([{ ruleId: "low", periodsInside: 3, amount: thb("-120") }]);
  });

  it("keeps the satang: 2 of 7 days of ฿1,500 is ฿85.71 off", () => {
    // 1,500 × 20% × 2 ÷ 7 = 85.714…
    expect(
      adjust(BIKE_350, span(bkk("2027-03-27"), bkk("2027-04-03")), [
        LOW_SEASON,
      ]),
    ).toEqual([{ ruleId: "low", periodsInside: 2, amount: thb("-85.71") }]);
  });

  it("adjusts the whole price when every day is inside, and nothing when none is", () => {
    expect(
      adjust(BIKE_300, span(bkk("2027-06-01"), bkk("2027-06-08")), [
        LOW_SEASON,
      ]),
    ).toEqual([{ ruleId: "low", periodsInside: 7, amount: thb("-280") }]);
    expect(
      adjust(BIKE_300, span(bkk("2027-11-01"), bkk("2027-11-08")), [
        LOW_SEASON,
      ]),
    ).toEqual([]);
  });

  it("raises a price as well as lowering it", () => {
    const high: SeasonRule = { ...LOW_SEASON, id: "high", adjustBp: 1000 };
    expect(
      adjust(BIKE_300, span(bkk("2027-06-01"), bkk("2027-06-08")), [high]),
    ).toEqual([{ ruleId: "high", periodsInside: 7, amount: thb("140") }]);
  });
});

describe("each charged day belongs to the calendar day it starts on", () => {
  it("leaves out a first day that starts the night before the season", () => {
    // One day, collected 31 Mar 23:00: it starts on 31 Mar.
    expect(
      adjust(
        BIKE_300,
        span(bkk("2027-03-31", "23:00"), bkk("2027-04-01", "23:00")),
        [LOW_SEASON],
      ),
    ).toEqual([]);
    // Collected half an hour into 1 Apr: it starts on 1 Apr.
    expect(
      adjust(
        BIKE_300,
        span(bkk("2027-04-01", "00:30"), bkk("2027-04-02", "00:30")),
        [LOW_SEASON],
      ),
    ).toEqual([{ ruleId: "low", periodsInside: 1, amount: thb("-60") }]);
  });

  it("counts the return day only if a new 24 hours starts on it", () => {
    // 28 Sep 10:00 → 2 Oct 10:00: four days, starting 28, 29, 30 Sep and 1 Oct.
    // The 4-day total is ฿850; 850 × 20% × 3 ÷ 4 = ฿127.50.
    expect(
      adjust(BIKE_300, span(bkk("2027-09-28"), bkk("2027-10-02")), [
        LOW_SEASON,
      ]),
    ).toEqual([{ ruleId: "low", periodsInside: 3, amount: thb("-127.50") }]);
  });

  it("includes the first and the last day of the range", () => {
    const oneDay = (date: string, next: string) =>
      adjust(BIKE_300, span(bkk(date), bkk(next)), [LOW_SEASON]);
    expect(oneDay("2027-03-31", "2027-04-01")).toEqual([]);
    expect(oneDay("2027-04-01", "2027-04-02")).toHaveLength(1);
    expect(oneDay("2027-09-30", "2027-10-01")).toHaveLength(1);
    expect(oneDay("2027-10-01", "2027-10-02")).toEqual([]);
  });

  it("reads the day on the clock at the location, not in UTC", () => {
    // 31 Mar 23:00 in New York is already 1 Apr in UTC and in Bangkok.
    const start = new Date("2027-03-31T23:00:00-04:00");
    const end = new Date("2027-04-01T23:00:00-04:00");
    expect(
      adjust(BIKE_300, span(start, end, "America/New_York"), [LOW_SEASON]),
    ).toEqual([]);
    expect(
      adjust(BIKE_300, span(start, end, BANGKOK), [LOW_SEASON]),
    ).toHaveLength(1);
  });
});

describe("every year, or one year only", () => {
  const christmas: SeasonRule = {
    id: "peak",
    startsOn: "2027-12-15",
    endsOn: "2028-01-15",
    repeatsYearly: true,
    adjustBp: 1000,
    products: "all",
  };

  it("wraps over the new year when it repeats", () => {
    // 13 Dec → 20 Dec: days 13 to 19; 15 to 19 are inside. 1,400 × 10% × 5 ÷ 7 = 100.
    expect(
      adjust(BIKE_300, span(bkk("2027-12-13"), bkk("2027-12-20")), [christmas]),
    ).toEqual([{ ruleId: "peak", periodsInside: 5, amount: thb("100") }]);
    // 12 Jan → 19 Jan: 12 to 15 are inside. 1,400 × 10% × 4 ÷ 7 = 80.
    expect(
      adjust(BIKE_300, span(bkk("2028-01-12"), bkk("2028-01-19")), [christmas]),
    ).toEqual([{ ruleId: "peak", periodsInside: 4, amount: thb("80") }]);
    // And again the year after.
    expect(
      adjust(BIKE_300, span(bkk("2029-12-28"), bkk("2030-01-04")), [christmas]),
    ).toEqual([{ ruleId: "peak", periodsInside: 7, amount: thb("140") }]);
    expect(
      adjust(BIKE_300, span(bkk("2028-06-01"), bkk("2028-06-08")), [christmas]),
    ).toEqual([]);
  });

  it("applies in its own year only when it does not repeat", () => {
    const once: SeasonRule = { ...LOW_SEASON, repeatsYearly: false };
    expect(
      adjust(BIKE_300, span(bkk("2027-06-01"), bkk("2027-06-08")), [once]),
    ).toHaveLength(1);
    expect(
      adjust(BIKE_300, span(bkk("2028-06-01"), bkk("2028-06-08")), [once]),
    ).toEqual([]);
  });
});

describe("more than one rule, and which products", () => {
  it("adds two rules on the same days, never compounds them", () => {
    const festival: SeasonRule = {
      id: "festival",
      startsOn: "2027-04-13",
      endsOn: "2027-04-15",
      repeatsYearly: true,
      adjustBp: 5000,
      products: "all",
    };
    // 10 Apr → 17 Apr: all 7 days are low season (−280); 13, 14, 15 are the
    // festival (+50% of 3 ÷ 7 of 1,400 = +300). Each on the list price.
    expect(
      adjust(BIKE_300, span(bkk("2027-04-10"), bkk("2027-04-17")), [
        LOW_SEASON,
        festival,
      ]),
    ).toEqual([
      { ruleId: "low", periodsInside: 7, amount: thb("-280") },
      { ruleId: "festival", periodsInside: 3, amount: thb("300") },
    ]);
  });

  it("applies to the products it names", () => {
    const touring: SeasonRule = {
      ...LOW_SEASON,
      products: ["nx500", "cb500x"],
    };
    const s = span(bkk("2027-06-01"), bkk("2027-06-08"));
    expect(adjust(BIKE_300, s, [touring], "nx500")).toHaveLength(1);
    expect(adjust(BIKE_300, s, [touring], "click")).toEqual([]);
  });
});

describe("other ways of pricing", () => {
  it("adjusts a long stay by its charged days", () => {
    // 1 Mar → 15 Apr 2027: a month and 14 days = ฿4,400 over 45 days.
    // Days from 1 Apr on: 14. 4,400 × 20% × 14 ÷ 45 = 273.777…
    expect(
      adjust(BIKE_300, span(bkk("2027-03-01"), bkk("2027-04-15")), [
        LOW_SEASON,
      ]),
    ).toEqual([{ ruleId: "low", periodsInside: 14, amount: thb("-273.78") }]);
  });

  it("adjusts a flat fee per hour by the hour", () => {
    const perHour: Pricing = {
      method: "per_period",
      amount: thb("50"),
      period: "hour",
    };
    // 31 Mar 22:00 → 1 Apr 02:00: hours start at 22, 23, 00 and 01.
    expect(
      adjust(
        perHour,
        span(bkk("2027-03-31", "22:00"), bkk("2027-04-01", "02:00")),
        [LOW_SEASON],
      ),
    ).toEqual([{ ruleId: "low", periodsInside: 2, amount: thb("-20") }]);
  });

  it("adjusts a flat fee per week and per month by the period's first day", () => {
    const perMonth: Pricing = {
      method: "per_period",
      amount: thb("3000"),
      period: "month",
    };
    // 1 Mar → 1 Jun: months start 1 Mar, 1 Apr, 1 May. 9,000 × 20% × 2 ÷ 3.
    expect(
      adjust(perMonth, span(bkk("2027-03-01"), bkk("2027-06-01")), [
        LOW_SEASON,
      ]),
    ).toEqual([{ ruleId: "low", periodsInside: 2, amount: thb("-1200") }]);
    const perWeek: Pricing = {
      method: "per_period",
      amount: thb("1200"),
      period: "week",
    };
    // 26 Mar → 9 Apr: weeks start 26 Mar and 2 Apr. 2,400 × 20% × 1 ÷ 2.
    expect(
      adjust(perWeek, span(bkk("2027-03-26"), bkk("2027-04-09")), [LOW_SEASON]),
    ).toEqual([{ ruleId: "low", periodsInside: 1, amount: thb("-240") }]);
  });

  it("never applies to a fixed price or a free line", () => {
    const s = span(bkk("2027-06-01"), bkk("2027-06-08"));
    expect(
      adjust({ method: "fixed", amount: thb("150") }, s, [LOW_SEASON]),
    ).toBe(null);
    expect(adjust({ method: "free" }, s, [LOW_SEASON])).toBe(null);
  });
});

describe("what a rule must be", () => {
  const s = span(bkk("2027-06-01"), bkk("2027-06-08"));
  const broken = (change: Partial<SeasonRule>) => () =>
    adjust(BIKE_300, s, [{ ...LOW_SEASON, ...change }]);

  it("refuses a percentage of zero or out of range", () => {
    expect(broken({ adjustBp: 0 })).toThrow(RangeError);
    expect(broken({ adjustBp: -10000 })).toThrow(RangeError);
    expect(broken({ adjustBp: 100001 })).toThrow(RangeError);
    expect(broken({ adjustBp: 12.5 })).toThrow(RangeError);
    expect(broken({ adjustBp: -9999 })).not.toThrow();
  });

  it("refuses a date that is not real, and an end before the start", () => {
    expect(broken({ startsOn: "2027-02-30" })).toThrow(RangeError);
    expect(broken({ endsOn: "1 Apr" })).toThrow(RangeError);
    expect(
      broken({
        repeatsYearly: false,
        startsOn: "2027-09-30",
        endsOn: "2027-04-01",
      }),
    ).toThrow(/before it starts/);
  });
});

describe("adjustmentParts", () => {
  it("gives a decrease and its size", () => {
    expect(adjustmentParts(BigInt(-12000))).toEqual({
      direction: "decrease",
      size: BigInt(12000),
    });
  });
  it("gives an increase and its size", () => {
    expect(adjustmentParts(BigInt(500))).toEqual({
      direction: "increase",
      size: BigInt(500),
    });
  });
});
