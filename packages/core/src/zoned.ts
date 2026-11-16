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

// Wall clock to instant, and the calendar at a location --------------------------------
// (docs/phase-2-plan.md §2.6). The generic forms of what time.ts did for
// Bangkok only; time.ts is now a thin wrapper that passes Asia/Bangkok.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant at which a clock in `timeZone` shows the wall-clock value
 * `wall` (as `toWallClock` gives it). Where the clocks go back and a time
 * happens twice, the earlier instant. Where they go forward and a time is
 * skipped, the time the same distance past the gap (02:30 on a night that
 * jumps from 02:00 to 03:00 is 03:30).
 */
export function fromWallClock(wall: number, timeZone: string): Date {
  if (!Number.isFinite(wall)) throw new RangeError("Invalid date");
  const offsetAt = (instant: number) =>
    toWallClock(new Date(instant), timeZone) - instant;
  // The zone's offset a day before and a day after: they differ only when a
  // clock change falls in between.
  const before = offsetAt(wall - DAY_MS);
  const after = offsetAt(wall + DAY_MS);
  const candidates = [wall - before, wall - after].filter(
    (candidate) => toWallClock(new Date(candidate), timeZone) === wall,
  );
  if (candidates.length > 0) return new Date(Math.min(...candidates));
  return new Date(wall - before);
}

export type ZonedParts = {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
};

/** Calendar fields of an instant as seen on a clock in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const wall = new Date(toWallClock(instant, timeZone));
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    weekday: wall.getUTCDay(),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The calendar date of an instant in `timeZone`, as "YYYY-MM-DD". */
export function zonedDateString(instant: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(instant, timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** 0 = Sunday … 6 = Saturday, in `timeZone`. */
export function zonedWeekday(instant: Date, timeZone: string): number {
  return zonedParts(instant, timeZone).weekday;
}

/** The wall-clock value of a date and time: ("2026-11-03", "10:00"). */
function wallOf(date: string, time: string): number {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) {
    throw new RangeError(`Invalid date/time: ${date} ${time}`);
  }
  const [, y, mo, d] = dateMatch.map(Number);
  const [, h, mi] = timeMatch.map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    h > 23 ||
    mi > 59
  ) {
    throw new RangeError(`Invalid date/time: ${date} ${time}`);
  }
  return wall;
}

/** The instant of a wall-clock time in `timeZone`: ("2026-11-03", "10:00"). */
export function zonedDateTime(
  date: string,
  time: string,
  timeZone: string,
): Date {
  return fromWallClock(wallOf(date, time), timeZone);
}

/** The instant of 00:00 in `timeZone` on the day containing `instant`. */
export function startOfZonedDay(instant: Date, timeZone: string): Date {
  const wall = toWallClock(instant, timeZone);
  return fromWallClock(wall - (((wall % DAY_MS) + DAY_MS) % DAY_MS), timeZone);
}

/**
 * Moves an instant by whole calendar days in `timeZone`, keeping the time on
 * the clock: 10:00 stays 10:00 across a night when the clocks change, which
 * is 23 or 25 elapsed hours.
 */
export function addZonedDays(
  instant: Date,
  days: number,
  timeZone: string,
): Date {
  return fromWallClock(
    toWallClock(instant, timeZone) + days * DAY_MS,
    timeZone,
  );
}

const displayFormats = new Map<string, Intl.DateTimeFormat>();

/** "4 Nov 2026, 08:30" in `timeZone` and the given locale. Null → "". */
export function formatZoned(
  iso: string | null,
  timeZone: string,
  locale: string,
): string {
  if (!iso) return "";
  const key = `${locale}|${timeZone}`;
  let format = displayFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    displayFormats.set(key, format);
  }
  return format.format(new Date(iso));
}
