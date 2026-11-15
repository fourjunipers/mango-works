import { describe, expect, it } from "vitest";
import {
  isUnderOneDay,
  rentalDays,
  rentalHours,
  rentalMonths,
} from "./rental-days";
import { bangkokDateTime } from "./time";

const at = (date: string, time: string) => bangkokDateTime(date, time);

describe("rentalDays", () => {
  it("counts every started 24 hours as a day (owner's examples)", () => {
    const mon = at("2026-11-09", "10:00");
    expect(rentalDays(mon, at("2026-11-10", "10:00"))).toBe(1);
    expect(rentalDays(mon, at("2026-11-11", "10:00"))).toBe(2);
    expect(rentalDays(mon, at("2026-11-10", "10:30"))).toBe(2);
  });

  it("is at least one day", () => {
    expect(
      rentalDays(at("2026-11-09", "10:00"), at("2026-11-09", "14:00")),
    ).toBe(1);
  });

  it("rejects a return before the pickup", () => {
    const t = at("2026-11-09", "10:00");
    expect(() => rentalDays(t, t)).toThrow(RangeError);
  });
});

describe("rentalDays on the wall clock", () => {
  const NEW_YORK = "America/New_York";

  it("is unchanged in Bangkok, with or without the time zone", () => {
    const mon = at("2026-11-09", "10:00");
    const options = { timeZone: "Asia/Bangkok" };
    expect(rentalDays(mon, at("2026-11-10", "10:00"), options)).toBe(1);
    expect(rentalDays(mon, at("2026-11-10", "10:30"), options)).toBe(2);
    expect(rentalDays(mon, at("2026-12-09", "10:00"), options)).toBe(30);
  });

  it("counts a night when the clocks change as one day", () => {
    // Clocks go back on 7 Nov 2027: 10:00 to 10:00 is 25 elapsed hours.
    const start = new Date("2027-11-06T10:00:00-04:00");
    const end = new Date("2027-11-07T10:00:00-05:00");
    expect(rentalDays(start, end, { timeZone: NEW_YORK })).toBe(1);
    // Without a time zone a day is 24 elapsed hours (the marketplace, Thailand only).
    expect(rentalDays(start, end)).toBe(2);
    // Clocks go forward on 14 Mar 2027: 10:00 to 10:30 the next day is still 2 days.
    expect(
      rentalDays(
        new Date("2027-03-13T10:00:00-05:00"),
        new Date("2027-03-14T10:30:00-04:00"),
        { timeZone: NEW_YORK },
      ),
    ).toBe(2);
  });

  it("takes no charge rules yet", () => {
    const mon = at("2026-11-09", "10:00");
    const tue = at("2026-11-10", "10:00");
    expect(rentalDays(mon, tue, { rules: {} })).toBe(1);
    expect(() =>
      rentalDays(mon, tue, { rules: { skipSundays: true } as never }),
    ).toThrow(/not built/);
  });

  it("rejects an unknown time zone", () => {
    expect(() =>
      rentalDays(at("2026-11-09", "10:00"), at("2026-11-10", "10:00"), {
        timeZone: "Mars/Olympus",
      }),
    ).toThrow(RangeError);
  });
});

describe("rentalHours and isUnderOneDay", () => {
  it("counts every started 60 minutes", () => {
    const start = at("2026-11-09", "10:00");
    expect(rentalHours(start, at("2026-11-09", "11:00"))).toBe(1);
    expect(rentalHours(start, at("2026-11-09", "11:01"))).toBe(2);
    expect(() => rentalHours(start, start)).toThrow(RangeError);
  });

  it("is under a day until exactly 24 hours", () => {
    const start = at("2026-11-09", "10:00");
    const zone = { timeZone: "Asia/Bangkok" };
    expect(isUnderOneDay(start, at("2026-11-10", "09:59"), zone)).toBe(true);
    expect(isUnderOneDay(start, at("2026-11-10", "10:00"), zone)).toBe(false);
  });
});

describe("rentalMonths: date to date from the pickup date", () => {
  const zone = { timeZone: "Asia/Bangkok" };
  const months = (from: string, to: string, time = "10:00") =>
    rentalMonths(at(from, "10:00"), at(to, time), zone);

  it("runs 1 Jan to 1 Feb to 1 Mar", () => {
    expect(months("2027-01-01", "2027-02-01")).toEqual({
      months: 1,
      leftoverDays: 0,
    });
    expect(months("2027-01-01", "2027-03-01")).toEqual({
      months: 2,
      leftoverDays: 0,
    });
    expect(months("2027-01-01", "2028-01-01")).toEqual({
      months: 12,
      leftoverDays: 0,
    });
    expect(months("2027-01-01", "2027-02-15")).toEqual({
      months: 1,
      leftoverDays: 14,
    });
  });

  it("uses the last day of a month that lacks the date, without drifting", () => {
    // 31 Jan renews 28 Feb, then 31 Mar, then 30 Apr.
    expect(months("2027-01-31", "2027-02-28")).toEqual({
      months: 1,
      leftoverDays: 0,
    });
    expect(months("2027-01-31", "2027-03-01")).toEqual({
      months: 1,
      leftoverDays: 1,
    });
    expect(months("2027-01-31", "2027-03-30")).toEqual({
      months: 1,
      leftoverDays: 30,
    });
    expect(months("2027-01-31", "2027-03-31")).toEqual({
      months: 2,
      leftoverDays: 0,
    });
    expect(months("2027-01-31", "2027-04-30")).toEqual({
      months: 3,
      leftoverDays: 0,
    });
    // The 29th and 30th of January also renew on 28 Feb, then on their own date.
    expect(months("2027-01-30", "2027-02-28")).toEqual({
      months: 1,
      leftoverDays: 0,
    });
    expect(months("2027-01-30", "2027-03-30")).toEqual({
      months: 2,
      leftoverDays: 0,
    });
    expect(months("2027-01-29", "2027-03-29")).toEqual({
      months: 2,
      leftoverDays: 0,
    });
  });

  it("knows a leap year", () => {
    expect(months("2028-01-31", "2028-02-29")).toEqual({
      months: 1,
      leftoverDays: 0,
    });
    expect(months("2028-01-31", "2028-02-28")).toEqual({
      months: 0,
      leftoverDays: 28,
    });
    expect(months("2028-02-29", "2029-02-28")).toEqual({
      months: 12,
      leftoverDays: 0,
    });
  });

  it("keeps the time of day of the pickup at each boundary", () => {
    expect(months("2027-01-01", "2027-02-01", "09:59")).toEqual({
      months: 0,
      leftoverDays: 31,
    });
    expect(months("2027-01-01", "2027-02-01", "10:01")).toEqual({
      months: 1,
      leftoverDays: 1,
    });
  });

  it("counts months on the wall clock across a clock change", () => {
    expect(
      rentalMonths(
        new Date("2027-03-01T10:00:00-05:00"),
        new Date("2027-04-01T10:00:00-04:00"),
        { timeZone: "America/New_York" },
      ),
    ).toEqual({ months: 1, leftoverDays: 0 });
  });
});
