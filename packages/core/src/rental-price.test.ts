import { describe, expect, it } from "vitest";
import { fillPriceList, type ResolvedList } from "./price-list";
import {
  chargedPeriods,
  longStayRate,
  unitPrice,
  type Pricing,
  type RentalSpan,
} from "./rental-price";

/** Baht as a string ("116.66") → satang, with no float on the way. */
function thb(amount: string): bigint {
  const [whole, fraction = ""] = amount.replace(/,/g, "").split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

const BANGKOK = "Asia/Bangkok";
const NEW_YORK = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;

/** A Bangkok wall-clock time as an instant. Bangkok is UTC+7 with no daylight saving. */
const bkk = (date: string, time = "10:00") =>
  new Date(`${date}T${time}:00+07:00`);

const span = (start: Date, end: Date, timeZone = BANGKOK): RentalSpan => ({
  start,
  end,
  timeZone,
});

/** `days` whole days from a Bangkok pickup. */
const daysFrom = (date: string, days: number) =>
  span(bkk(date), new Date(bkk(date).getTime() + days * DAY_MS));

/**
 * A list from quick entry (฿10 step). BSR's real lists have a hand-set total
 * for every day and arrive before the last build stage; these stand in for
 * them. The figures pinned below depend only on the 14-day and 30-day totals
 * and the long-stay daily rate, which are BSR's.
 */
function list(
  daily: string,
  weekly: string,
  twoWeeks: string,
  monthly: string,
  hourly?: string,
): ResolvedList {
  const filled = fillPriceList(
    {
      daily: thb(daily),
      weekly: thb(weekly),
      twoWeeks: thb(twoWeeks),
      monthly: thb(monthly),
      hourly: hourly === undefined ? undefined : thb(hourly),
    },
    new Map(),
    thb("10"),
  );
  return { days: filled.days.map((d) => d.total), hourly: filled.hourly };
}

// BSR's four Booqable lists: 1 / 7 / 14 / 30 days and the extra day.
const LIST_300 = list("300", "1400", "2100", "3000");
const LIST_350 = list("350", "1500", "2500", "3500");
const LIST_400 = list("400", "1800", "2800", "4000");
const LIST_500 = list("500", "2200", "3500", "5400");

const tiered = (l: ResolvedList, longStay?: string): Pricing => ({
  method: "tiered",
  list: l,
  longStayDay: longStay === undefined ? null : thb(longStay),
});

const BIKE_300 = tiered(LIST_300, "100");
const BIKE_350 = tiered(LIST_350, "116.66");
const BIKE_400 = tiered(LIST_400, "133.33");
const BIKE_500 = tiered(LIST_500, "180");

const price = (pricing: Pricing, s: RentalSpan) => unitPrice(pricing, s).amount;

describe("by rental length: the owner's pinned figures (15 Nov 2026)", () => {
  it("prices a first 14 days from the list (the two-week price)", () => {
    expect(price(BIKE_300, daysFrom("2027-01-01", 14))).toBe(thb("2100"));
    expect(unitPrice(BIKE_300, daysFrom("2027-01-01", 14)).basis).toEqual({
      kind: "list",
      days: 14,
    });
  });

  it("charges a month plus 14 days as ฿3,000 + 14 × ฿100: ฿1,400 for the 14 days", () => {
    const month = price(BIKE_300, span(bkk("2027-01-01"), bkk("2027-02-01")));
    const monthAnd14 = price(
      BIKE_300,
      span(bkk("2027-01-01"), bkk("2027-02-15")),
    );
    expect(month).toBe(thb("3000"));
    expect(monthAnd14).toBe(thb("4400"));
    expect(monthAnd14 - month).toBe(thb("1400"));
    // Not the two-week price.
    expect(monthAnd14 - month).not.toBe(LIST_300.days[13]);
  });

  it("charges 45 days from 1 Jan ฿4,400", () => {
    // 1 Jan → 15 Feb: one month (31 days) and 14 days.
    const quote = unitPrice(BIKE_300, daysFrom("2027-01-01", 45));
    expect(quote.amount).toBe(thb("4400"));
    expect(quote.basis).toMatchObject({
      kind: "months",
      days: 45,
      months: 1,
      leftoverDays: 14,
    });
  });

  it("charges 60 days from 1 Jan ฿6,100 (two months are 59 days)", () => {
    const quote = unitPrice(BIKE_300, daysFrom("2027-01-01", 60));
    expect(quote.amount).toBe(thb("6100"));
    expect(quote.basis).toMatchObject({ months: 2, leftoverDays: 1 });
  });

  it("charges the same 60 days ฿6,000 in a leap year (two months are 60 days)", () => {
    const quote = unitPrice(BIKE_300, daysFrom("2028-01-01", 60));
    expect(quote.amount).toBe(thb("6000"));
    expect(quote.basis).toMatchObject({ months: 2, leftoverDays: 0 });
  });

  it("charges a year ฿36,000 and month 13 ฿3,000", () => {
    const year = price(BIKE_300, span(bkk("2027-01-01"), bkk("2028-01-01")));
    const thirteen = price(
      BIKE_300,
      span(bkk("2027-01-01"), bkk("2028-02-01")),
    );
    expect(year).toBe(thb("36000"));
    expect(thirteen - year).toBe(thb("3000"));
    expect(
      unitPrice(BIKE_300, span(bkk("2027-01-01"), bkk("2028-01-01"))).basis,
    ).toMatchObject({ months: 12, leftoverDays: 0 });
  });

  it("never charges 28, 29 or 30 days from 1 Feb more than the list", () => {
    // February 2027 has 28 days, so 28 days is already a calendar month.
    for (const days of [28, 29, 30]) {
      const quote = unitPrice(BIKE_300, daysFrom("2027-02-01", days));
      expect(quote.basis).toEqual({ kind: "list", days });
      expect(quote.amount).toBe(LIST_300.days[days - 1]);
      expect(quote.amount <= LIST_300.days[days - 1]).toBe(true);
      // And the same number of days costs the same from 1 Jan.
      expect(quote.amount).toBe(price(BIKE_300, daysFrom("2027-01-01", days)));
    }
    expect(price(BIKE_300, daysFrom("2027-02-01", 30))).toBe(thb("3000"));
  });

  it("starts the month rule at 31 days: 31 days from 1 Feb is a month and 3 days", () => {
    const quote = unitPrice(BIKE_300, daysFrom("2027-02-01", 31));
    expect(quote.amount).toBe(thb("3300"));
    expect(quote.basis).toMatchObject({ months: 1, leftoverDays: 3 });
    // 31 days from 1 Jan is exactly one month.
    expect(price(BIKE_300, daysFrom("2027-01-01", 31))).toBe(thb("3000"));
  });

  it("keeps satang exact: ฿116.66 and ฿133.33 a long-stay day", () => {
    const jan1 = bkk("2027-01-01");
    const feb15 = bkk("2027-02-15");
    // 3,500 + 14 × 116.66 = 5,133.24
    expect(price(BIKE_350, span(jan1, feb15))).toBe(thb("5133.24"));
    // 4,000 + 14 × 133.33 = 5,866.62
    expect(price(BIKE_400, span(jan1, feb15))).toBe(thb("5866.62"));
    // 5,400 + 14 × 180 = 7,920
    expect(price(BIKE_500, span(jan1, feb15))).toBe(thb("7920"));
    // One day over a month.
    expect(price(BIKE_350, span(jan1, bkk("2027-02-02")))).toBe(thb("3616.66"));
    expect(price(BIKE_400, span(jan1, bkk("2027-02-02")))).toBe(thb("4133.33"));
  });
});

describe("by rental length: the rest of the rule", () => {
  it("is the list for every length of 30 days or fewer, whatever the start date", () => {
    const first = bkk("2027-01-01").getTime();
    for (let offset = 0; offset < 730; offset += 1) {
      const start = new Date(first + offset * DAY_MS);
      for (const days of [1, 7, 27, 28, 29, 30]) {
        const end = new Date(start.getTime() + days * DAY_MS);
        expect(price(BIKE_350, span(start, end))).toBe(LIST_350.days[days - 1]);
      }
    }
  });

  it("never falls as days rise, in any month, leap year or time zone", () => {
    const bikes = [
      BIKE_300,
      BIKE_350,
      tiered(LIST_400),
      tiered(LIST_300, "250"),
      tiered(LIST_300, "50"),
    ];
    const starts: Array<[Date, string]> = [];
    for (let offset = 0; offset < 760; offset += 29) {
      starts.push([
        new Date(bkk("2027-01-01").getTime() + offset * DAY_MS),
        BANGKOK,
      ]);
    }
    // Month ends, and New York across both clock changes.
    for (const date of [
      "2027-01-29",
      "2027-01-30",
      "2027-01-31",
      "2028-01-31",
    ]) {
      starts.push([bkk(date), BANGKOK]);
    }
    for (const iso of [
      "2027-02-20T10:00:00-05:00",
      "2027-10-15T10:00:00-04:00",
    ]) {
      starts.push([new Date(iso), NEW_YORK]);
    }
    for (const bike of bikes) {
      for (const [start, zone] of starts) {
        let last = 0n;
        for (let hours = 24; hours <= 24 * 100; hours += 12) {
          const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
          const amount = price(bike, span(start, end, zone));
          expect(amount >= last).toBe(true);
          last = amount;
        }
      }
    }
  }, 30_000);

  it("anchors months on the pickup date: 31 Jan, 28 Feb, 31 Mar", () => {
    const jan31 = bkk("2027-01-31");
    // 31 Jan → 31 Mar is two months, not two months and three days.
    const twoMonths = unitPrice(BIKE_300, span(jan31, bkk("2027-03-31")));
    expect(twoMonths.amount).toBe(thb("6000"));
    expect(twoMonths.basis).toMatchObject({ months: 2, leftoverDays: 0 });
    // 31 Jan → 1 Apr is two months and a day.
    expect(price(BIKE_300, span(jan31, bkk("2027-04-01")))).toBe(thb("6100"));
    // 31 Jan → 30 Apr is three months.
    expect(price(BIKE_300, span(jan31, bkk("2027-04-30")))).toBe(thb("9000"));
  });

  it("keeps the pickup's time of day at each month boundary", () => {
    const start = bkk("2027-01-01", "10:00");
    expect(price(BIKE_300, span(start, bkk("2027-02-01", "10:00")))).toBe(
      thb("3000"),
    );
    // One minute past the boundary starts a leftover day.
    expect(price(BIKE_300, span(start, bkk("2027-02-01", "10:01")))).toBe(
      thb("3100"),
    );
  });

  it("charges the monthly price for a 31st day that starts before the month is complete", () => {
    // 1 Jan 10:00 → 31 Jan 12:00 is 31 started days, well short of a
    // month (which is 1 Feb 10:00). It costs the month, whatever the long-stay
    // rate: not less than 30 days, not more than the month it is becoming.
    const start = bkk("2027-01-01", "10:00");
    const end = bkk("2027-01-31", "12:00");
    for (const bike of [
      BIKE_300,
      tiered(LIST_300, "50"),
      tiered(LIST_300, "250"),
    ]) {
      const quote = unitPrice(bike, span(start, end));
      expect(quote.amount).toBe(thb("3000"));
      expect(quote.basis).toMatchObject({
        days: 31,
        months: 0,
        underOneMonth: true,
        leftoverCapped: false,
      });
    }
  });

  it("uses the monthly price ÷ 30 when the product has no long-stay rate", () => {
    const bike = tiered(list("320", "1500", "2300", "3200"));
    expect(longStayRate(thb("3200"))).toEqual({
      rate: thb("106.67"),
      fromMonthly: true,
    });
    expect(longStayRate(thb("3000"), thb("100"))).toEqual({
      rate: thb("100"),
      fromMonthly: false,
    });
    // 1 Feb → 4 Mar 2027: a month and 3 days = 3,200 + 3 × 106.67.
    const quote = unitPrice(bike, daysFrom("2027-02-01", 31));
    expect(quote.amount).toBe(thb("3520.01"));
    expect(quote.basis).toMatchObject({
      longStayDay: thb("106.67"),
      longStayFromMonthly: true,
      leftoverCapped: false,
      underOneMonth: false,
    });
  });

  it("never charges leftover days more than one more month", () => {
    // 1 Feb → 31 Mar 2027: one month and 30 leftover days.
    const s = span(bkk("2027-02-01"), bkk("2027-03-31"));
    // At ฿116.66 the 30 days are ฿3,499.80, under ฿3,500: no cap.
    const under = unitPrice(BIKE_350, s);
    expect(under.amount).toBe(thb("6999.80"));
    expect(under.basis).toMatchObject({
      leftoverDays: 30,
      leftoverCapped: false,
    });
    // At ฿250 a day they would be ฿7,500: held to one more month.
    const dear = tiered(LIST_300, "250");
    const capped = unitPrice(dear, s);
    expect(capped.amount).toBe(thb("6000"));
    expect(capped.basis).toMatchObject({ leftoverCapped: true });
    // Which is what two whole months cost.
    expect(price(dear, span(bkk("2027-02-01"), bkk("2027-04-01")))).toBe(
      thb("6000"),
    );
  });

  it("refuses a long-stay rate of zero, and a list that is not 30 days", () => {
    expect(() =>
      unitPrice(
        { method: "tiered", list: LIST_300, longStayDay: 0n },
        daysFrom("2027-01-01", 40),
      ),
    ).toThrow(RangeError);
    expect(() =>
      unitPrice(
        {
          method: "tiered",
          list: { days: LIST_300.days.slice(1), hourly: null },
        },
        daysFrom("2027-01-01", 3),
      ),
    ).toThrow(RangeError);
  });
});

describe("under 24 hours on a list with an hourly price", () => {
  const hourlyList = list("300", "1400", "2100", "3000", "80");
  const withHourly = tiered(hourlyList, "100");
  const at = (time: string, date = "2027-01-01") => bkk(date, time);

  it("charges every started hour", () => {
    expect(price(withHourly, span(at("10:00"), at("13:00")))).toBe(thb("240"));
    // 2 hours 1 minute is 3 started hours.
    expect(price(withHourly, span(at("10:00"), at("12:01")))).toBe(thb("240"));
    expect(unitPrice(withHourly, span(at("10:00"), at("13:00"))).basis).toEqual(
      {
        kind: "hours",
        hours: 3,
        hourly: thb("80"),
        capped: false,
      },
    );
  });

  it("never charges more than the 1-day price", () => {
    // 3 h 45 min = 4 started hours = ฿320, over ฿300.
    const quote = unitPrice(withHourly, span(at("10:00"), at("13:45")));
    expect(quote.amount).toBe(thb("300"));
    expect(quote.basis).toMatchObject({ hours: 4, capped: true });
    expect(
      price(withHourly, span(at("10:00"), at("09:59", "2027-01-02"))),
    ).toBe(thb("300"));
  });

  it("is days only from 24 hours on", () => {
    expect(
      unitPrice(withHourly, span(at("10:00"), at("10:00", "2027-01-02"))).basis,
    ).toEqual({ kind: "list", days: 1 });
    expect(
      price(withHourly, span(at("10:00"), at("11:00", "2027-01-02"))),
    ).toBe(hourlyList.days[1]);
  });

  it("is one day when the list has no hourly price", () => {
    expect(price(BIKE_300, span(at("10:00"), at("13:00")))).toBe(thb("300"));
  });
});

describe("flat fee per period, fixed and free", () => {
  const fee = (
    amount: string,
    period: "hour" | "day" | "week" | "month",
  ): Pricing => ({
    method: "per_period",
    amount: thb(amount),
    period,
  });
  const jan1 = bkk("2027-01-01");

  it("charges every started hour", () => {
    expect(
      price(fee("50", "hour"), span(jan1, bkk("2027-01-01", "11:30"))),
    ).toBe(thb("100"));
    expect(
      price(fee("50", "hour"), span(jan1, bkk("2027-01-01", "12:00"))),
    ).toBe(thb("100"));
  });

  it("charges every started day", () => {
    expect(price(fee("200", "day"), daysFrom("2027-01-01", 3))).toBe(
      thb("600"),
    );
    expect(
      price(fee("200", "day"), span(jan1, bkk("2027-01-04", "10:30"))),
    ).toBe(thb("800"));
    // A flat fee has no month rule: 45 days is 45 × the fee.
    expect(price(fee("200", "day"), daysFrom("2027-01-01", 45))).toBe(
      thb("9000"),
    );
  });

  it("charges every started week of 7 days", () => {
    expect(price(fee("1200", "week"), daysFrom("2027-01-01", 7))).toBe(
      thb("1200"),
    );
    expect(price(fee("1200", "week"), daysFrom("2027-01-01", 8))).toBe(
      thb("2400"),
    );
    expect(chargedPeriods("week", daysFrom("2027-01-01", 1))).toBe(1);
  });

  it("charges every started month, date to date", () => {
    const monthly = fee("3000", "month");
    expect(price(monthly, span(jan1, bkk("2027-02-01")))).toBe(thb("3000"));
    expect(price(monthly, span(jan1, bkk("2027-02-02")))).toBe(thb("6000"));
    expect(price(monthly, daysFrom("2027-01-01", 10))).toBe(thb("3000"));
    // 31 Jan → 28 Feb is one month; → 1 Mar starts a second.
    expect(
      chargedPeriods("month", span(bkk("2027-01-31"), bkk("2027-02-28"))),
    ).toBe(1);
    expect(
      chargedPeriods("month", span(bkk("2027-01-31"), bkk("2027-03-01"))),
    ).toBe(2);
    // February to March is one month whether it is 28 or 29 days.
    expect(
      chargedPeriods("month", span(bkk("2028-02-01"), bkk("2028-03-01"))),
    ).toBe(1);
  });

  it("charges a fixed price once, whatever the length, and nothing when free", () => {
    const fixed: Pricing = { method: "fixed", amount: thb("150") };
    expect(price(fixed, daysFrom("2027-01-01", 1))).toBe(thb("150"));
    expect(price(fixed, daysFrom("2027-01-01", 90))).toBe(thb("150"));
    expect(unitPrice({ method: "free" }, daysFrom("2027-01-01", 5))).toEqual({
      amount: 0n,
      basis: { kind: "free" },
    });
  });

  it("refuses a price of zero", () => {
    expect(() =>
      unitPrice({ method: "fixed", amount: 0n }, daysFrom("2027-01-01", 1)),
    ).toThrow(RangeError);
    expect(() => unitPrice(fee("0", "day"), daysFrom("2027-01-01", 1))).toThrow(
      RangeError,
    );
  });
});

describe("other currencies and time zones", () => {
  it("prices in a zero-decimal currency (JPY)", () => {
    const filled = fillPriceList(
      { daily: 3000n, monthly: 60000n },
      new Map(),
      100n,
    );
    const bike: Pricing = {
      method: "tiered",
      list: { days: filled.days.map((d) => d.total), hourly: null },
    };
    // ¥60,000 a month, ¥2,000 a long-stay day (60,000 ÷ 30).
    expect(price(bike, span(bkk("2027-01-01"), bkk("2027-02-15")))).toBe(
      88000n,
    );
  });

  it("counts days and months on the wall clock where the clocks change", () => {
    // New York: clocks go forward on 14 Mar 2027 and back on 7 Nov 2027.
    const bike = BIKE_300;
    // 1 Mar 10:00 EST → 1 Apr 10:00 EDT is one month, though an hour short in elapsed time.
    const march = unitPrice(
      bike,
      span(
        new Date("2027-03-01T10:00:00-05:00"),
        new Date("2027-04-01T10:00:00-04:00"),
        NEW_YORK,
      ),
    );
    expect(march.basis).toMatchObject({ months: 1, leftoverDays: 0 });
    // 6 Nov 10:00 EDT → 7 Nov 10:00 EST is 25 elapsed hours and one day on the clock.
    const november = unitPrice(
      bike,
      span(
        new Date("2027-11-06T10:00:00-04:00"),
        new Date("2027-11-07T10:00:00-05:00"),
        NEW_YORK,
      ),
    );
    expect(november.basis).toEqual({ kind: "list", days: 1 });
  });
});
