/**
 * Rental length in days (owner decision, 2026-11-07): every started 24 hours
 * is a day. 10:00 Mon → 10:00 Tue is 1 day; → 10:00 Wed is 2 days; → 10:30
 * Tue is 2 days. There is no grace period on the price: the turnaround time
 * between rentals is the shop's "buffer after return".
 *
 * This is the only place a rental day is counted, for every channel.
 */

import { addWallMonths, toWallClock } from "./zoned";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * A shop's charge rules (docs/products-redesign.md §9.17): charge or skip the
 * pickup day or the return day by a time of day, and skip weekdays. They are
 * built after Phase 3. Until then the only value is "no rules", and every
 * caller already passes through here, so adding them later changes one file.
 */
export type ChargeRules = Readonly<Record<string, never>>;

export type RentalDaysOptions = {
  /**
   * The location's time zone. With it, a day is 24 hours on the clock at the
   * location, so a night when the clocks change is still one day. Without it
   * a day is 24 elapsed hours, which is the same thing wherever there is no
   * daylight saving (the marketplace, Thailand only, until 3M).
   */
  timeZone?: string;
  rules?: ChargeRules;
};

function assertNoRules(rules: ChargeRules | undefined): void {
  if (rules && Object.keys(rules).length > 0) {
    throw new RangeError("Charge rules are not built yet");
  }
}

/** Start and end as comparable numbers: wall clock with a time zone, else elapsed. */
function span(
  start: Date,
  end: Date,
  options: RentalDaysOptions,
): { from: number; to: number } {
  assertNoRules(options.rules);
  const from = options.timeZone
    ? toWallClock(start, options.timeZone)
    : start.getTime();
  const to = options.timeZone
    ? toWallClock(end, options.timeZone)
    : end.getTime();
  if (!(to > from)) {
    throw new RangeError("The return must be after the pickup");
  }
  return { from, to };
}

export function rentalDays(
  start: Date,
  end: Date,
  options: RentalDaysOptions = {},
): number {
  const { from, to } = span(start, end, options);
  return Math.ceil((to - from) / DAY_MS);
}

/** Every started 60 minutes of real, elapsed time. */
export function rentalHours(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (!(ms > 0)) {
    throw new RangeError("The return must be after the pickup");
  }
  return Math.ceil(ms / HOUR_MS);
}

/** True when the rental is shorter than 24 hours on the clock. */
export function isUnderOneDay(
  start: Date,
  end: Date,
  options: RentalDaysOptions = {},
): boolean {
  const { from, to } = span(start, end, options);
  return to - from < DAY_MS;
}

export type RentalMonths = {
  /** Whole months, date to date from the pickup date. */
  months: number;
  /** Every started 24 hours after the last whole month; 0 when it ends on a boundary. */
  leftoverDays: number;
};

/**
 * A rental as whole months plus leftover days (owner decision, 15 Nov 2026).
 * A month is date to date, anchored on the original pickup date: 1 Jan to
 * 1 Feb; from 31 Jan the boundaries are 28 Feb, 31 Mar, 30 Apr. Each boundary
 * keeps the pickup's time of day on the clock at the location.
 */
export function rentalMonths(
  start: Date,
  end: Date,
  options: RentalDaysOptions & { timeZone: string },
): RentalMonths {
  const { from, to } = span(start, end, options);
  // A month is at most 31 days, so this is never more than the answer.
  let months = Math.floor((to - from) / (31 * DAY_MS));
  while (addWallMonths(from, months + 1) <= to) months += 1;
  const boundary = addWallMonths(from, months);
  return { months, leftoverDays: Math.ceil((to - boundary) / DAY_MS) };
}
