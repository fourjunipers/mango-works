/**
 * Time helpers for the marketplace. Timestamps are stored in UTC; the
 * marketplace's business rules (shop hours, cut-offs, "today", the
 * 3-days-before payment date) run in Asia/Bangkok until Phase 3M gives it
 * markets.
 *
 * Since Phase 2 (docs/phase-2-plan.md §2.6) every function here is a thin
 * wrapper: the rule itself is in zoned.ts, takes the time zone as an
 * argument and assumes no fixed offset. These names stay so the marketplace
 * does not change, and time.test.ts holds the two to the same answers.
 * **New code calls zoned.ts with the location's time zone, never these.**
 *
 * This is the only module allowed to call `new Date()` for the current time.
 * Everything else asks `now()`, so tests can control the clock.
 */

import {
  addZonedDays,
  formatZoned,
  startOfZonedDay,
  zonedDateString,
  zonedDateTime,
  zonedParts,
  zonedWeekday,
  type ZonedParts,
} from "./zoned";

export const BANGKOK_TIME_ZONE = "Asia/Bangkok";

const HOUR_MS = 60 * 60 * 1000;

/** The current instant. */
export function now(): Date {
  return new Date();
}

export type BangkokParts = ZonedParts;

/** Calendar fields of an instant as seen on a clock in Bangkok. */
export function toBangkok(instant: Date): BangkokParts {
  return zonedParts(instant, BANGKOK_TIME_ZONE);
}

/** The Bangkok calendar date of an instant, as "YYYY-MM-DD". */
export function bangkokDateString(instant: Date): string {
  return zonedDateString(instant, BANGKOK_TIME_ZONE);
}

/** 0 = Sunday … 6 = Saturday, in Bangkok. */
export function bangkokWeekday(instant: Date): number {
  return zonedWeekday(instant, BANGKOK_TIME_ZONE);
}

/** The instant of 00:00 Bangkok time on the day containing `instant`. */
export function startOfBangkokDay(instant: Date): Date {
  return startOfZonedDay(instant, BANGKOK_TIME_ZONE);
}

/** The instant of a Bangkok wall-clock time, e.g. ("2026-11-03", "10:00"). */
export function bangkokDateTime(date: string, time: string): Date {
  return zonedDateTime(date, time, BANGKOK_TIME_ZONE);
}

/** Moves an instant by whole days on the clock in Bangkok. */
export function addDays(instant: Date, days: number): Date {
  return addZonedDays(instant, days, BANGKOK_TIME_ZONE);
}

/** Moves an instant by hours, e.g. for pickup and return buffers. */
export function addHours(instant: Date, hours: number): Date {
  return new Date(instant.getTime() + hours * HOUR_MS);
}

/** "4 Nov 2026, 08:30" in Bangkok time, for admin lists. Null → "". */
export function formatBangkok(iso: string | null): string {
  return formatZoned(iso, BANGKOK_TIME_ZONE, "en-GB");
}
