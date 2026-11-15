import { describe, expect, it } from "vitest";
import {
  applyMultiplier,
  divideHalfUp,
  extrapolateToStep,
  fillPriceList,
  interpolateToStep,
  LIST_DAYS,
  listProblems,
  quickEntryErrors,
  resolvePriceList,
  sameEveryDay,
  type QuickEntry,
} from "./price-list";
import { fillDays, type Anchors } from "./pricing";

/** Baht as a string ("116.66") → satang, with no float on the way. */
function thb(amount: string): bigint {
  const [whole, fraction = ""] = amount.replace(/,/g, "").split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

const STEP_10_BAHT = thb("10");
const NO_MANUAL = new Map<number, bigint>();

const totals = (entry: QuickEntry, manual = NO_MANUAL, step = STEP_10_BAHT) =>
  fillPriceList(entry, manual, step).days.map((d) => d.total);

// BSR's published price sets (docs/marketplace/BSR_SEED.md): the totals for
// 1, 7, 14, 21 and 30 days, in baht.
// prettier-ignore
const BSR_SETS: Array<[number, number, number, number, number]> = [
  [250, 1200, 1700, 2200, 2500], [300, 1400, 2100, 2600, 3000],
  [300, 1400, 2300, 2800, 3200], [300, 1500, 2500, 3000, 3500],
  [350, 1500, 2500, 3000, 3500], [350, 1700, 2700, 3400, 3900],
  [400, 1800, 2800, 3500, 4000], [400, 1900, 2900, 3700, 4500],
  [500, 2200, 3500, 4500, 5400], [600, 2500, 3900, 5000, 5900],
  [650, 2800, 4200, 5400, 6200], [650, 3000, 4400, 5700, 6500],
  [2100, 14000, 22000, 28000, 34000], [1800, 12000, 20000, 26000, 31000],
  [1500, 10000, 18000, 23000, 28000], [1200, 8000, 15000, 21000, 26000],
  [1100, 7000, 13000, 17000, 21000], [900, 6000, 10000, 15000, 19000],
  [1100, 7000, 13000, 18000, 22000], [700, 4500, 8000, 11500, 14000],
];

const entryOf = (set: readonly number[]): QuickEntry => ({
  daily: thb(String(set[0])),
  weekly: thb(String(set[1])),
  twoWeeks: thb(String(set[2])),
  threeWeeks: thb(String(set[3])),
  monthly: thb(String(set[4])),
});

describe("divideHalfUp", () => {
  it("rounds halves up and everything else to the nearest", () => {
    expect(divideHalfUp(3n, 2n)).toBe(2n); // 1.5
    expect(divideHalfUp(5n, 2n)).toBe(3n); // 2.5
    expect(divideHalfUp(149n, 100n)).toBe(1n); // 1.49
    expect(divideHalfUp(150n, 100n)).toBe(2n); // 1.50
    expect(divideHalfUp(151n, 100n)).toBe(2n);
    expect(divideHalfUp(0n, 7n)).toBe(0n);
    expect(divideHalfUp(21n, 7n)).toBe(3n);
  });

  it("refuses a negative amount or a zero divisor", () => {
    expect(() => divideHalfUp(-1n, 2n)).toThrow(RangeError);
    expect(() => divideHalfUp(1n, 0n)).toThrow(RangeError);
  });
});

describe("fillPriceList", () => {
  it("fills Honda Click 125i's list, worked by hand (฿10 step)", () => {
    // 300 / 1,400 / 2,100 / 2,600 / 3,000.
    // Days 2–6 rise by 1,100 ÷ 6 = 183.33; 8–13 by 100; 15–20 by 500 ÷ 7 =
    // 71.43; 22–29 by 400 ÷ 9 = 44.44; each rounded to the nearest ฿10.
    // prettier-ignore
    const byHand = [
      300, 480, 670, 850, 1030, 1220, 1400,
      1500, 1600, 1700, 1800, 1900, 2000, 2100,
      2170, 2240, 2310, 2390, 2460, 2530, 2600,
      2640, 2690, 2730, 2780, 2820, 2870, 2910, 2960, 3000,
    ];
    expect(totals(entryOf([300, 1400, 2100, 2600, 3000]))).toEqual(
      byHand.map((baht) => thb(String(baht))),
    );
  });

  it("marks each day as entered, filled or edited by hand", () => {
    const { days } = fillPriceList(
      entryOf([300, 1400, 2100, 2600, 3000]),
      new Map([[10, thb("1750")]]),
      STEP_10_BAHT,
    );
    expect(days).toHaveLength(LIST_DAYS);
    expect(days.filter((d) => d.source === "anchor").map((d) => d.day)).toEqual(
      [1, 7, 14, 21, 30],
    );
    expect(days[9]).toEqual({ day: 10, total: thb("1750"), source: "manual" });
    expect(days[10]).toEqual({ day: 11, total: thb("1800"), source: "filled" });
  });

  it("keeps a hand-edited day when a box changes, and refills the rest", () => {
    const manual = new Map([[10, thb("1750")]]);
    const before = totals(entryOf([300, 1400, 2100, 2600, 3000]), manual);
    const after = totals(entryOf([300, 1500, 2100, 2600, 3000]), manual);
    expect(after[9]).toBe(thb("1750"));
    expect(after[6]).toBe(thb("1500"));
    expect(after[7]).not.toBe(before[7]);
    // Days after the next box (14 days) are untouched.
    expect(after.slice(13)).toEqual(before.slice(13));
  });

  it("runs straight between daily and monthly when nothing else is entered", () => {
    // 300 → 3,200 over 29 steps of exactly ฿100.
    const list = totals({ daily: thb("300"), monthly: thb("3200") });
    expect(list).toEqual(
      Array.from({ length: 30 }, (_, i) => thb(String(300 + 100 * i))),
    );
  });

  it("never rounds an entered or hand-edited total, satang included", () => {
    const { days, hourly } = fillPriceList(
      {
        hourly: thb("83.33"),
        daily: thb("349.99"),
        weekly: thb("1500.01"),
        monthly: thb("3499.80"),
      },
      new Map([[3, thb("777.77")]]),
      STEP_10_BAHT,
    );
    expect(hourly).toBe(thb("83.33"));
    expect(days[0].total).toBe(thb("349.99"));
    expect(days[2].total).toBe(thb("777.77"));
    expect(days[6].total).toBe(thb("1500.01"));
    expect(days[29].total).toBe(thb("3499.80"));
    // Filled days are whole steps of ฿10.
    for (const day of days.filter((d) => d.source === "filled")) {
      expect(day.total % STEP_10_BAHT).toBe(0n);
    }
  });

  it("needs a daily and a monthly price", () => {
    expect(quickEntryErrors({})).toEqual([
      "daily_required",
      "monthly_required",
    ]);
    expect(quickEntryErrors({ daily: 1n, monthly: 2n })).toEqual([]);
    expect(() => fillPriceList({ daily: 1n }, NO_MANUAL, 1n)).toThrow(
      /monthly_required/,
    );
  });

  it("refuses a zero price, a zero step, and a hand edit on an entered day", () => {
    const ok = entryOf([300, 1400, 2100, 2600, 3000]);
    expect(() => totals({ ...ok, weekly: 0n })).toThrow(RangeError);
    expect(() => totals({ ...ok, hourly: 0n })).toThrow(RangeError);
    expect(() => totals(ok, NO_MANUAL, 0n)).toThrow(RangeError);
    expect(() => totals(ok, new Map([[7, thb("1450")]]))).toThrow(
      /quick-entry/,
    );
    expect(() => totals(ok, new Map([[31, thb("3100")]]))).toThrow(RangeError);
    expect(() => totals(ok, new Map([[5, 0n]]))).toThrow(RangeError);
  });

  it("fills every published BSR price set without a fall, on the step", () => {
    for (const set of BSR_SETS) {
      const list = totals(entryOf(set));
      expect(listProblems(list)).toEqual([]);
      expect(list[0]).toBe(thb(String(set[0])));
      expect(list[29]).toBe(thb(String(set[4])));
      for (const total of list) expect(total % STEP_10_BAHT).toBe(0n);
    }
  });

  it("fills exactly as the marketplace does, to the baht", () => {
    // The marketplace fills in whole baht with a ฿10 step (`fillDays`); the
    // platform in satang with a 1,000-satang step. Same numbers, × 100.
    const sets = [...BSR_SETS, [300, 1800, 3200, 4400, 5500] as const];
    for (const set of sets) {
      const anchors: Anchors = {
        1: set[0],
        7: set[1],
        14: set[2],
        21: set[3],
        30: set[4],
      };
      const marketplace = fillDays(anchors).map((d) => BigInt(d.total) * 100n);
      expect(totals(entryOf(set))).toEqual(marketplace);
    }
    // And with only the two required prices.
    expect(totals({ daily: thb("250"), monthly: thb("2500") })).toEqual(
      fillDays({ 1: 250, 30: 2500 }).map((d) => BigInt(d.total) * 100n),
    );
  });

  it("works in a currency with no decimals and one with three", () => {
    // JPY: minor unit = ¥1, step ¥100.
    const yen = totals({ daily: 3000n, monthly: 60000n }, NO_MANUAL, 100n);
    expect(yen[0]).toBe(3000n);
    expect(yen[1]).toBe(5000n); // 3,000 + 57,000 ÷ 29 = 4,965.5 → ¥5,000
    expect(yen[29]).toBe(60000n);
    for (const total of yen) expect(total % 100n).toBe(0n);
    // KWD: 1,000 fils to the dinar, step 1 dinar.
    const fils = totals({ daily: 5000n, monthly: 100000n }, NO_MANUAL, 1000n);
    expect(fils[1]).toBe(8000n); // 5,000 + 95,000 ÷ 29 = 8,275.9 → 8 dinar
    for (const total of fils) expect(total % 1000n).toBe(0n);
  });

  it("gives 'same price every day' as the five boxes", () => {
    expect(sameEveryDay(thb("200"))).toEqual({
      daily: thb("200"),
      weekly: thb("1400"),
      twoWeeks: thb("2800"),
      threeWeeks: thb("4200"),
      monthly: thb("6000"),
    });
    // The fill between them is then exactly the daily price × days.
    expect(totals(sameEveryDay(thb("200")))).toEqual(
      Array.from({ length: 30 }, (_, i) => thb(String(200 * (i + 1)))),
    );
  });
});

describe("rounding to the step", () => {
  it("rounds a half up, at every step size", () => {
    // Midway between 100 and 200 is 150: half a step of 100 → up.
    expect(interpolateToStep(1, 100n, 3, 200n, 2, 100n)).toBe(200n);
    // 149.5 → down.
    expect(interpolateToStep(1, 100n, 3, 199n, 2, 100n)).toBe(100n);
    // Step 1: 1.5 → 2.
    expect(interpolateToStep(1, 1n, 3, 2n, 2, 1n)).toBe(2n);
    // An odd step: 10 and 25, midway 17.5, step 5 → 20 (17.5 is half a step up from 15).
    expect(interpolateToStep(1, 10n, 3, 25n, 2, 5n)).toBe(20n);
    // Step 3: 4 ÷ 3 = 1.33 steps → 3; 5 ÷ 3 = 1.67 steps → 6.
    expect(interpolateToStep(1, 3n, 3, 5n, 2, 3n)).toBe(3n);
    expect(interpolateToStep(1, 4n, 3, 6n, 2, 3n)).toBe(6n);
  });

  it("continues past the last price at its daily rate (marketplace extras)", () => {
    expect(extrapolateToStep(1, 200n, 9, 10n)).toBe(1800n);
    // 1,000 for 7 days → day 10 = 1,428.57 → 1,430.
    expect(extrapolateToStep(7, 1000n, 10, 10n)).toBe(1430n);
  });
});

describe("listProblems", () => {
  const flat = Array.from({ length: 30 }, (_, i) => BigInt(100 * (i + 1)));

  it("accepts equal totals on neighbouring days", () => {
    const list = [...flat];
    list[7] = list[6]; // day 8 = day 7
    list[8] = list[6]; // day 9 = day 7
    expect(listProblems(list)).toEqual([]);
    expect(listProblems(Array.from({ length: 30 }, () => 500n))).toEqual([]);
  });

  it("refuses a total that falls as days rise, and says which day", () => {
    const list = [...flat];
    list[7] = list[6] - 1n; // day 8 one satang under day 7
    expect(listProblems(list)).toEqual([{ kind: "falls", day: 8 }]);
  });

  it("refuses a zero total and a list that is not 30 days", () => {
    const list = [...flat];
    list[0] = 0n;
    expect(listProblems(list)).toEqual([{ kind: "not_positive", day: 1 }]);
    expect(listProblems(flat.slice(0, 29))).toEqual([
      { kind: "wrong_length", length: 29 },
    ]);
    expect(listProblems([...flat, 3100n])).toEqual([
      { kind: "wrong_length", length: 31 },
    ]);
  });
});

describe("multipliers of a base price", () => {
  it("keeps Booqable's satang exactly (฿100 × 1.1666 = ฿116.66)", () => {
    expect(applyMultiplier(thb("100"), 11666n)).toBe(thb("116.66"));
    expect(applyMultiplier(thb("100"), 13333n)).toBe(thb("133.33"));
    expect(applyMultiplier(thb("100"), 18000n)).toBe(thb("180"));
    expect(applyMultiplier(thb("100"), 10000n)).toBe(thb("100"));
  });

  it("rounds half up to one minor unit", () => {
    expect(applyMultiplier(3n, 5000n)).toBe(2n); // 1.5
    expect(applyMultiplier(1n, 14999n)).toBe(1n); // 1.4999
    expect(applyMultiplier(1n, 15000n)).toBe(2n); // 1.5
    expect(applyMultiplier(10001n, 11666n)).toBe(11667n); // 11,667.1666
    expect(applyMultiplier(thb("110"), 11666n)).toBe(thb("128.33")); // 128.326
  });

  // With a base of ฿100.00, a multiplier in ten-thousandths is the total in
  // satang: ×3.0000 is 30,000, and ฿300.00 is 30,000 satang.
  const amounts = totals(entryOf([350, 1500, 2500, 3000, 3500]));
  const multipliers = { kind: "multipliers" as const, days: amounts };

  it("gives the same totals as an amounts list at a base of ฿100", () => {
    expect(resolvePriceList(multipliers, thb("100")).days).toEqual(amounts);
    expect(resolvePriceList({ kind: "amounts", days: amounts }).days).toEqual(
      amounts,
    );
  });

  it("moves every length at once when the base price changes", () => {
    const dearer = resolvePriceList(multipliers, thb("110")).days;
    expect(dearer[0]).toBe(thb("385")); // 350 × 1.1
    expect(dearer[6]).toBe(thb("1650"));
    expect(dearer[29]).toBe(thb("3850"));
    expect(listProblems(dearer)).toEqual([]);
  });

  it("resolves an hourly multiplier, and none stays none", () => {
    expect(
      resolvePriceList({ ...multipliers, hourly: 8000n }, thb("100")).hourly,
    ).toBe(thb("80"));
    expect(resolvePriceList(multipliers, thb("100")).hourly).toBeNull();
  });

  it("needs a base price, and refuses a list that could not be saved", () => {
    expect(() => resolvePriceList(multipliers)).toThrow(/base price/);
    const falling = [...amounts];
    falling[10] = falling[9] - 1n;
    expect(() => resolvePriceList({ kind: "amounts", days: falling })).toThrow(
      /falls on day 11/,
    );
    expect(() =>
      resolvePriceList({ kind: "multipliers", days: falling }, thb("100")),
    ).toThrow(/falls/);
    // A base so small that a day rounds to nothing.
    expect(() =>
      resolvePriceList(
        { kind: "multipliers", days: Array(30).fill(4999n) },
        1n,
      ),
    ).toThrow(/not_positive/);
  });
});
