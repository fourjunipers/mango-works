import { describe, expect, it } from "vitest";
import { addWallMonths, toWallClock } from "./zoned";

describe("toWallClock", () => {
  it("reads an instant on the clock at the location", () => {
    const instant = new Date("2027-01-01T03:00:00.000Z");
    expect(toWallClock(instant, "Asia/Bangkok")).toBe(
      Date.UTC(2027, 0, 1, 10, 0),
    );
    expect(toWallClock(instant, "Asia/Tokyo")).toBe(
      Date.UTC(2027, 0, 1, 12, 0),
    );
    expect(toWallClock(instant, "America/New_York")).toBe(
      Date.UTC(2026, 11, 31, 22, 0),
    );
    expect(toWallClock(instant, "UTC")).toBe(instant.getTime());
  });

  it("follows daylight saving without a fixed offset", () => {
    // New York is UTC−5 in winter and UTC−4 in summer.
    expect(
      toWallClock(new Date("2027-01-15T15:00:00Z"), "America/New_York"),
    ).toBe(Date.UTC(2027, 0, 15, 10, 0));
    expect(
      toWallClock(new Date("2027-07-15T14:00:00Z"), "America/New_York"),
    ).toBe(Date.UTC(2027, 6, 15, 10, 0));
  });

  it("keeps seconds and milliseconds, and midnight is hour 0", () => {
    expect(
      toWallClock(new Date("2027-01-01T17:00:05.250Z"), "Asia/Bangkok"),
    ).toBe(Date.UTC(2027, 0, 2, 0, 0, 5, 250));
  });

  it("rejects an unknown time zone and an invalid date", () => {
    expect(() => toWallClock(new Date(), "Mars/Olympus")).toThrow(RangeError);
    expect(() => toWallClock(new Date("nope"), "UTC")).toThrow(RangeError);
  });
});

describe("addWallMonths", () => {
  const wall = (y: number, m: number, d: number, h = 10) =>
    Date.UTC(y, m - 1, d, h);

  it("goes date to date and keeps the time of day", () => {
    expect(addWallMonths(wall(2027, 1, 1), 1)).toBe(wall(2027, 2, 1));
    expect(addWallMonths(wall(2027, 1, 1), 12)).toBe(wall(2028, 1, 1));
    expect(addWallMonths(wall(2027, 11, 15, 18), 3)).toBe(
      wall(2028, 2, 15, 18),
    );
    expect(addWallMonths(wall(2027, 1, 1), 0)).toBe(wall(2027, 1, 1));
  });

  it("uses the last day of a short month and returns to the anchor after it", () => {
    const jan31 = wall(2027, 1, 31);
    expect(addWallMonths(jan31, 1)).toBe(wall(2027, 2, 28));
    expect(addWallMonths(jan31, 2)).toBe(wall(2027, 3, 31));
    expect(addWallMonths(jan31, 3)).toBe(wall(2027, 4, 30));
    expect(addWallMonths(wall(2028, 1, 31), 1)).toBe(wall(2028, 2, 29));
    expect(addWallMonths(wall(2028, 2, 29), 12)).toBe(wall(2029, 2, 28));
  });

  it("refuses a negative or fractional number of months", () => {
    expect(() => addWallMonths(wall(2027, 1, 1), -1)).toThrow(RangeError);
    expect(() => addWallMonths(wall(2027, 1, 1), 1.5)).toThrow(RangeError);
  });
});
