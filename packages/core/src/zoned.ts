/**
 * Wall-clock time in any time zone (root CLAUDE.md › Built for any country).
 *
 * Business rules count days and months on the clock at the shop's location,
 * which may have daylight saving. `toWallClock` turns an instant into the
 * local date and time *as if it were UTC*, in milliseconds. Two such values
 * can be subtracted and compared with plain arithmetic, and the answer is
 * what a clock on the wall would show: 10:00 to 10:00 the next day is 24
 * hours, whether or not the clocks changed that night.
 *
 * No fixed offset is assumed anywhere; the offset comes from the platform's
 * time zone data through `Intl`.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    // Throws a RangeError for an unknown time zone, which is what we want.
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/**
 * The local date and time of `instant` in `timeZone`, as milliseconds since
 * the epoch *read as if the wall clock were UTC*. Only differences and
 * comparisons of these values mean anything.
 */
export function toWallClock(instant: Date, timeZone: string): number {
  const time = instant.getTime();
  if (Number.isNaN(time)) throw new RangeError("Invalid date");
  const fields: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  const wall = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
  // Offsets are whole seconds, so the milliseconds carry over unchanged.
  return wall + (((time % 1000) + 1000) % 1000);
}

/** Days in a month of the Gregorian calendar. `month` is 0–11 and may overflow. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The wall-clock value `months` whole months after `wallStart`, date to date
 * (owner decision, 15 Nov 2026). The day of the month is always taken from
 * the start, so the anchor never drifts: from 31 Jan the boundaries are
 * 28 Feb (29 in a leap year), 31 Mar, 30 Apr. A month that lacks the date
 * uses its last day. The time of day is the start's.
 */
export function addWallMonths(wallStart: number, months: number): number {
  if (!Number.isInteger(months) || months < 0) {
    throw new RangeError(`Months must be a whole number ≥ 0, got ${months}`);
  }
  const start = new Date(wallStart);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const day = Math.min(start.getUTCDate(), daysInMonth(year, month));
  return Date.UTC(
    year,
    month,
    day,
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds(),
  );
}
