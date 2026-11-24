/**
 * time.ts and money.ts became thin wrappers in Phase 2 (docs/phase-2-plan.md
 * §2.6): the rules are generic now (zoned.ts takes a time zone, currency.ts
 * a currency) and the old names pass Asia/Bangkok and THB.
 *
 * This holds that the marketplace gets the answers it always got, to the
 * minute and to the baht. The reference below is the code as it stood before
 * the change (fixed UTC+7 arithmetic, whole baht × 100), kept here only to be
 * compared against. Every wrapper is run beside it over a spread of inputs.
 */
import { describe, expect, it } from "vitest";
import {
  assertWholeAmount,
  formatWholeAmount,
  fromMinorUnits,
  toMinorUnits,
} from "./currency";
import {
  assertWholeBaht,
  bahtToSatang,
  formatBaht,
  satangToBaht,
} from "./money";
import {
  addDays,
  addHours,
  bangkokDateString,
  bangkokDateTime,
  bangkokWeekday,
  formatBangkok,
  startOfBangkokDay,
  toBangkok,
} from "./time";
import {
  addZonedDays,
  formatZoned,
  startOfZonedDay,
  zonedDateString,
  zonedDateTime,
  zonedParts,
  zonedWeekday,
} from "./zoned";

// ------------------------------------------------- the code as it stood before

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BANGKOK_OFFSET_MS = 7 * HOUR_MS;
const pad = (n: number) => String(n).padStart(2, "0");

const before = {
  toBangkok(instant: Date) {
    const shifted = new Date(instant.getTime() + BANGKOK_OFFSET_MS);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      weekday: shifted.getUTCDay(),
    };
  },
  bangkokDateString(instant: Date) {
    const { year, month, day } = before.toBangkok(instant);
    return `${year}-${pad(month)}-${pad(day)}`;
  },
  bangkokWeekday(instant: Date) {
    return before.toBangkok(instant).weekday;
  },
  startOfBangkokDay(instant: Date) {
    return before.bangkokDateTime(before.bangkokDateString(instant), "00:00");
  },
  bangkokDateTime(date: string, time: string) {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
    if (!dateMatch || !timeMatch) {
      throw new RangeError(`Invalid Bangkok date/time: ${date} ${time}`);
    }
    const [, y, mo, d] = dateMatch.map(Number);
    const [, h, mi] = timeMatch.map(Number);
    const utc = Date.UTC(y, mo - 1, d, h, mi);
    const check = new Date(utc);
    if (
      check.getUTCFullYear() !== y ||
      check.getUTCMonth() !== mo - 1 ||
      check.getUTCDate() !== d ||
      h > 23 ||
      mi > 59
    ) {
      throw new RangeError(`Invalid Bangkok date/time: ${date} ${time}`);
    }
    return new Date(utc - BANGKOK_OFFSET_MS);
  },
  addDays(instant: Date, days: number) {
    return new Date(instant.getTime() + days * DAY_MS);
  },
  addHours(instant: Date, hours: number) {
    return new Date(instant.getTime() + hours * HOUR_MS);
  },
  formatBangkok(iso: string | null) {
    return iso
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Bangkok",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(iso))
      : "";
  },
  bahtToSatang(baht: number) {
    before.assertWholeBaht(baht);
    return baht * 100;
  },
  satangToBaht(satang: number) {
    if (!Number.isInteger(satang) || satang % 100 !== 0) {
      throw new RangeError(
        `Expected a whole number of baht in satang, got ${satang}`,
      );
    }
    return satang / 100;
  },
  formatBaht(baht: number) {
    before.assertWholeBaht(baht);
    const sign = baht < 0 ? "−" : "";
    return `${sign}฿${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.abs(baht))}`;
  },
  assertWholeBaht(baht: number) {
    if (!Number.isSafeInteger(baht)) {
      throw new RangeError(`Expected a whole number of baht, got ${baht}`);
    }
  },
};

// ------------------------------------------------------------------ the inputs

/**
 * Instants from 2019 to 2035, about 16 hours 41 minutes apart and never on
 * a whole second (so every time of day, weekday, month end and year end
 * comes up), plus the edges.
 */
function instants(): Date[] {
  const out: Date[] = [];
  const step = 60_067_013;
  for (let t = Date.UTC(2019, 0, 1); t < Date.UTC(2036, 0, 1); t += step) {
    out.push(new Date(t));
  }
  for (const iso of [
    "2026-10-22T16:59:00Z",
    "2026-10-22T17:00:00Z",
    "2026-12-31T16:59:59.999Z",
    "2026-12-31T17:00:00Z",
    "2028-02-28T17:00:00Z",
    "2028-02-29T16:59:00Z",
    "2028-02-29T17:00:00Z",
    "2027-06-15T03:04:05.678Z",
  ]) {
    out.push(new Date(iso));
  }
  return out;
}

const all = instants();

/**
 * What the first time.ts test runs over (the wrappers cost about 70 µs a
 * call, so the full grid of `all` took 2.6 s, over 5 s on a busy machine):
 * every fourth instant of the grid, so the steps are about 2.8 days and the
 * time of day and the weekday still cycle through every value, plus the
 * edges the grid only met by chance, on purpose. For every month from 2019 to
 * 2035, so every month end, every year end and the four leap days among
 * them: the last millisecond of the old month, Bangkok midnight, and the first
 * millisecond after it (Bangkok midnight is 17:00 UTC the day before). The
 * eight named edge instants that end `instants()` are kept whole too.
 */
function sweepOf(): Date[] {
  const out = all.filter((_, i) => i % 4 === 0);
  const midnight = (year: number, month: number) =>
    Date.UTC(year, month, 1) - 7 * HOUR_MS;
  for (let year = 2019; year <= 2035; year++) {
    for (let month = 0; month < 12; month++) {
      for (const offset of [-1, 0, 1]) {
        out.push(new Date(midnight(year, month) + offset));
      }
    }
  }
  out.push(...all.slice(-8));
  return out;
}
const sweep = sweepOf();
const sameOrThrows = <T>(now: () => T, then: () => T, what: string) => {
  let expected: T | "throws";
  try {
    expected = then();
  } catch (error) {
    expect(error, what).toBeInstanceOf(RangeError);
    expected = "throws";
  }
  if (expected === "throws") {
    expect(now, what).toThrow(RangeError);
  } else {
    expect(now(), what).toEqual(expected);
  }
};

describe("time.ts: the marketplace gets the answers it had before, to the minute", () => {
  it(`over ${sweep.length} instants from 2019 to 2035: the clock, the date, the weekday and the day's start`, () => {
    expect(sweep.length).toBeGreaterThan(2500);
    for (const instant of sweep) {
      const what = instant.toISOString();
      expect(toBangkok(instant), what).toEqual(before.toBangkok(instant));
      expect(bangkokDateString(instant), what).toBe(
        before.bangkokDateString(instant),
      );
      expect(bangkokWeekday(instant), what).toBe(
        before.bangkokWeekday(instant),
      );
      expect(startOfBangkokDay(instant).getTime(), what).toBe(
        before.startOfBangkokDay(instant).getTime(),
      );
    }
  });

  it("adding days and hours, forwards and back, keeping seconds and milliseconds", () => {
    for (const instant of all.filter((_, i) => i % 7 === 0)) {
      for (const days of [-400, -31, -3, -1, 0, 1, 2, 7, 30, 365, 1000]) {
        expect(
          addDays(instant, days).getTime(),
          `${instant.toISOString()} ${days}`,
        ).toBe(before.addDays(instant, days).getTime());
      }
      for (const hours of [-48, -2, 0, 0.5, 1, 4, 24, 168]) {
        expect(addHours(instant, hours).getTime()).toBe(
          before.addHours(instant, hours).getTime(),
        );
      }
    }
  });

  it("a date and a time on the Bangkok clock: every day of eight years at four times, and what is refused", () => {
    let count = 0;
    for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2032, 0, 1); t += DAY_MS) {
      const date = new Date(t).toISOString().slice(0, 10);
      for (const time of ["00:00", "06:59", "10:00", "23:59"]) {
        expect(bangkokDateTime(date, time).getTime(), `${date} ${time}`).toBe(
          before.bangkokDateTime(date, time).getTime(),
        );
        count += 1;
      }
    }
    expect(count).toBeGreaterThan(11000);
    for (const [date, time] of [
      ["2026-02-30", "10:00"],
      ["2026-11-03", "24:00"],
      ["2026-11-03", "10:60"],
      ["3 Nov", "10:00"],
      ["2026-11-03", "10"],
      ["2026-13-01", "10:00"],
      ["2027-02-29", "00:00"],
      ["2028-02-29", "00:00"],
    ]) {
      sameOrThrows(
        () => bangkokDateTime(date, time).getTime(),
        () => before.bangkokDateTime(date, time).getTime(),
        `${date} ${time}`,
      );
    }
  });

  it("the admin lists' date and time", () => {
    for (const instant of all.filter((_, i) => i % 11 === 0)) {
      const iso = instant.toISOString();
      expect(formatBangkok(iso), iso).toBe(before.formatBangkok(iso));
    }
    expect(formatBangkok(null)).toBe("");
    expect(formatBangkok("2026-11-04T01:30:00Z")).toBe("4 Nov 2026, 08:30");
  });

  it("each wrapper is the generic function with Asia/Bangkok, and nothing more", () => {
    const zone = "Asia/Bangkok";
    for (const instant of all.filter((_, i) => i % 97 === 0)) {
      expect(toBangkok(instant)).toEqual(zonedParts(instant, zone));
      expect(bangkokDateString(instant)).toBe(zonedDateString(instant, zone));
      expect(bangkokWeekday(instant)).toBe(zonedWeekday(instant, zone));
      expect(startOfBangkokDay(instant)).toEqual(
        startOfZonedDay(instant, zone),
      );
      expect(addDays(instant, 3)).toEqual(addZonedDays(instant, 3, zone));
      expect(formatBangkok(instant.toISOString())).toBe(
        formatZoned(instant.toISOString(), zone, "en-GB"),
      );
    }
    expect(bangkokDateTime("2026-11-03", "10:00")).toEqual(
      zonedDateTime("2026-11-03", "10:00", zone),
    );
  });
});

describe("money.ts: the marketplace gets the answers it had before, to the baht", () => {
  const amounts = [
    0,
    1,
    2,
    7,
    50,
    99,
    100,
    288,
    320,
    999,
    1000,
    2592,
    8870,
    12345,
    99999,
    100000,
    1234567,
    99999999,
    2 ** 31,
    90_071_992_547_409,
  ];
  const whole = [...amounts, ...amounts.map((a) => -a)];
  const notWhole = [
    28.8,
    0.5,
    -0.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    2 ** 53,
  ];

  it("baht to satang, and back", () => {
    for (const baht of [...whole, ...notWhole]) {
      sameOrThrows(
        () => bahtToSatang(baht),
        () => before.bahtToSatang(baht),
        `bahtToSatang(${baht})`,
      );
    }
    for (const baht of whole) {
      expect(satangToBaht(bahtToSatang(baht))).toBe(baht);
    }
    for (const satang of [
      ...whole.map((baht) => baht * 100),
      28850,
      1,
      99,
      -150,
      100.5,
      Number.NaN,
    ]) {
      sameOrThrows(
        () => satangToBaht(satang),
        () => before.satangToBaht(satang),
        `satangToBaht(${satang})`,
      );
    }
  });

  it("the formatted amount, sign and separators included", () => {
    for (const baht of [...whole, ...notWhole]) {
      sameOrThrows(
        () => formatBaht(baht),
        () => before.formatBaht(baht),
        `formatBaht(${baht})`,
      );
    }
    expect(formatBaht(2592)).toBe("฿2,592");
    expect(formatBaht(-320)).toBe("−฿320");
    for (const baht of [...whole, ...notWhole]) {
      sameOrThrows(
        () => assertWholeBaht(baht),
        () => before.assertWholeBaht(baht),
        `assertWholeBaht(${baht})`,
      );
    }
  });

  it("each wrapper is the generic function with THB, and nothing more", () => {
    for (const baht of whole) {
      expect(bahtToSatang(baht)).toBe(toMinorUnits(baht, "THB"));
      expect(satangToBaht(baht * 100)).toBe(fromMinorUnits(baht * 100, "THB"));
      expect(formatBaht(baht)).toBe(formatWholeAmount(baht, "THB", "en-US"));
    }
    expect(() => assertWholeAmount(1.5, "THB")).toThrow(RangeError);
  });
});

describe("the generic money functions, in other currencies", () => {
  it("minor units by the currency's own exponent: none for yen and dong, three places for the dinar", () => {
    expect(toMinorUnits(1500, "JPY")).toBe(1500);
    expect(toMinorUnits(250000, "VND")).toBe(250000);
    expect(toMinorUnits(45, "USD")).toBe(4500);
    expect(toMinorUnits(3, "KWD")).toBe(3000);
    expect(fromMinorUnits(1500, "JPY")).toBe(1500);
    expect(fromMinorUnits(4500, "USD")).toBe(45);
    expect(fromMinorUnits(3000, "KWD")).toBe(3);
    expect(() => fromMinorUnits(4550, "USD")).toThrow(RangeError);
    expect(() => fromMinorUnits(3500, "KWD")).toThrow(RangeError);
    expect(() => toMinorUnits(1.5, "JPY")).toThrow(RangeError);
  });

  it("a whole amount with its own symbol, in the viewer's locale", () => {
    expect(formatWholeAmount(1234567, "JPY", "en-US")).toBe("¥1,234,567");
    expect(formatWholeAmount(1234567, "VND", "en-US")).toBe("₫1,234,567");
    expect(formatWholeAmount(-45, "USD", "en-US")).toBe("−$45");
    expect(formatWholeAmount(1234567, "USD", "de-DE")).toMatch(/1\.234\.567/);
  });
});
