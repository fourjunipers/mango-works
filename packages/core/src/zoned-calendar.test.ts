/**
 * The calendar at a location (zoned.ts, Phase 2): a wall-clock time back to
 * its instant, the date and weekday of an instant, the start of its day, and
 * whole days on the clock. In New York across both of 2026's clock changes
 * (forward on 8 March, back on 1 November), and in zones with other offsets.
 */
import { describe, expect, it } from "vitest";
import {
  addZonedDays,
  formatZoned,
  fromWallClock,
  startOfZonedDay,
  toWallClock,
  zonedDateString,
  zonedDateTime,
  zonedParts,
  zonedWeekday,
} from "./zoned";

const NEW_YORK = "America/New_York";
const iso = (instant: Date) => instant.toISOString();

describe("zonedDateTime: a time on the clock to its instant", () => {
  it("uses the offset in force on that date", () => {
    expect(iso(zonedDateTime("2026-01-15", "10:00", NEW_YORK))).toBe(
      "2026-01-15T15:00:00.000Z",
    );
    expect(iso(zonedDateTime("2026-07-15", "10:00", NEW_YORK))).toBe(
      "2026-07-15T14:00:00.000Z",
    );
    expect(iso(zonedDateTime("2026-11-03", "10:00", "Asia/Bangkok"))).toBe(
      "2026-11-03T03:00:00.000Z",
    );
    expect(iso(zonedDateTime("2026-11-03", "10:00", "Asia/Kolkata"))).toBe(
      "2026-11-03T04:30:00.000Z",
    );
    expect(iso(zonedDateTime("2026-11-03", "10:00", "Australia/Sydney"))).toBe(
      "2026-11-02T23:00:00.000Z",
    );
  });

  it("on the day the clocks go forward: either side of the gap, and a time inside it moves past it", () => {
    expect(iso(zonedDateTime("2026-03-08", "01:59", NEW_YORK))).toBe(
      "2026-03-08T06:59:00.000Z",
    );
    expect(iso(zonedDateTime("2026-03-08", "03:00", NEW_YORK))).toBe(
      "2026-03-08T07:00:00.000Z",
    );
    // 02:30 does not happen: it is read as 03:30.
    expect(iso(zonedDateTime("2026-03-08", "02:30", NEW_YORK))).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(iso(zonedDateTime("2026-03-08", "10:00", NEW_YORK))).toBe(
      "2026-03-08T14:00:00.000Z",
    );
  });

  it("on the day the clocks go back: a time that happens twice is the first of the two", () => {
    expect(iso(zonedDateTime("2026-11-01", "00:59", NEW_YORK))).toBe(
      "2026-11-01T04:59:00.000Z",
    );
    expect(iso(zonedDateTime("2026-11-01", "01:30", NEW_YORK))).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(iso(zonedDateTime("2026-11-01", "02:00", NEW_YORK))).toBe(
      "2026-11-01T07:00:00.000Z",
    );
    expect(iso(zonedDateTime("2026-11-01", "10:00", NEW_YORK))).toBe(
      "2026-11-01T15:00:00.000Z",
    );
  });

  it("refuses what is not a date and a time", () => {
    expect(() => zonedDateTime("2026-02-30", "10:00", NEW_YORK)).toThrow(
      RangeError,
    );
    expect(() => zonedDateTime("2026-11-03", "24:00", NEW_YORK)).toThrow(
      RangeError,
    );
    expect(() => zonedDateTime("2026-11-03", "10:00", "Mars/Olympus")).toThrow(
      RangeError,
    );
  });

  it("round trip: every hour of both change days reads back as the hour it was", () => {
    for (const day of [
      "2026-03-07",
      "2026-03-08",
      "2026-10-31",
      "2026-11-01",
    ]) {
      const start = Date.parse(`${day}T00:00:00Z`);
      for (let h = 0; h < 48; h++) {
        const instant = new Date(start + h * 3_600_000 + 17 * 60_000 + 3_456);
        const wall = toWallClock(instant, NEW_YORK);
        const back = fromWallClock(wall, NEW_YORK);
        // The same reading on the clock; the same instant unless that
        // reading happens twice, when it is the earlier one.
        expect(toWallClock(back, NEW_YORK)).toBe(wall);
        expect(back.getTime()).toBeLessThanOrEqual(instant.getTime());
        expect(instant.getTime() - back.getTime()).toBeLessThanOrEqual(
          3_600_000,
        );
      }
    }
  });
});

describe("the date, the weekday and the day's start at a location", () => {
  it("reads the calendar on the location's clock", () => {
    // 03:30 UTC on Sunday 8 March is still Saturday evening in New York.
    const instant = new Date("2026-03-08T03:30:00Z");
    expect(zonedParts(instant, NEW_YORK)).toEqual({
      year: 2026,
      month: 3,
      day: 7,
      hour: 22,
      minute: 30,
      weekday: 6,
    });
    expect(zonedDateString(instant, NEW_YORK)).toBe("2026-03-07");
    expect(zonedWeekday(instant, NEW_YORK)).toBe(6);
    expect(zonedDateString(instant, "Asia/Tokyo")).toBe("2026-03-08");
    expect(zonedWeekday(instant, "Asia/Tokyo")).toBe(0);
  });

  it("the day starts at the location's midnight, on a 23-hour and a 25-hour day too", () => {
    const start = (isoText: string) =>
      iso(startOfZonedDay(new Date(isoText), NEW_YORK));
    expect(start("2026-03-08T20:00:00Z")).toBe("2026-03-08T05:00:00.000Z");
    expect(start("2026-03-09T03:59:00Z")).toBe("2026-03-08T05:00:00.000Z");
    expect(start("2026-03-09T04:00:00Z")).toBe("2026-03-09T04:00:00.000Z");
    expect(start("2026-11-01T20:00:00Z")).toBe("2026-11-01T04:00:00.000Z");
    expect(start("2026-11-02T04:59:00Z")).toBe("2026-11-01T04:00:00.000Z");
    expect(start("2026-11-02T05:00:00Z")).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("addZonedDays: whole days on the clock", () => {
  it("10:00 stays 10:00 across a night when the clocks change", () => {
    // Saturday 7 March, 10:00 EST.
    const saturday = new Date("2026-03-07T15:00:00Z");
    expect(iso(addZonedDays(saturday, 1, NEW_YORK))).toBe(
      "2026-03-08T14:00:00.000Z",
    );
    expect(iso(addZonedDays(saturday, 2, NEW_YORK))).toBe(
      "2026-03-09T14:00:00.000Z",
    );
    // Saturday 31 October, 10:00 EDT.
    const october = new Date("2026-10-31T14:00:00Z");
    expect(iso(addZonedDays(october, 1, NEW_YORK))).toBe(
      "2026-11-01T15:00:00.000Z",
    );
    // And back again.
    expect(
      iso(addZonedDays(new Date("2026-11-01T15:00:00Z"), -1, NEW_YORK)),
    ).toBe("2026-10-31T14:00:00.000Z");
  });

  it("is exactly 24 hours a day where the clocks never change", () => {
    const instant = new Date("2026-03-07T15:00:00.123Z");
    expect(addZonedDays(instant, 3, "Asia/Bangkok").getTime()).toBe(
      instant.getTime() + 3 * 86_400_000,
    );
  });
});

describe("formatZoned", () => {
  it("shows an instant on the location's clock in the viewer's locale", () => {
    expect(formatZoned("2026-11-04T01:30:00Z", "Asia/Bangkok", "en-GB")).toBe(
      "4 Nov 2026, 08:30",
    );
    expect(formatZoned("2026-11-04T01:30:00Z", NEW_YORK, "en-GB")).toBe(
      "3 Nov 2026, 20:30",
    );
    expect(formatZoned(null, NEW_YORK, "en-GB")).toBe("");
  });
});
