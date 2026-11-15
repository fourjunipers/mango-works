/**
 * Seasonal pricing (docs/products-redesign.md §9.5; step 5 of the pricer's
 * fixed order). Pure functions, `bigint` minor units.
 *
 * A season rule is a date range, "every year" or one year only, a percentage
 * up or down, and the products it applies to. Only the part of the rental
 * inside the range is adjusted:
 *
 *   adjustment = list price × percentage × periods inside ÷ all periods
 *
 * rounded half up once, on the line, to one minor unit. The satang are kept.
 * Every charged period carries an equal share of the list price, and **each
 * charged day belongs to the calendar day it starts on** at the location
 * (owner decision, 15 Nov 2026). Two rules on the same day are each worked
 * out on the list price and added, never compounded.
 *
 * Seasons apply to lines priced by time (by rental length, or a flat fee per
 * period). Never to a fixed price, a free line or a deposit.
 */

import { divideHalfUp } from "./price-list";
import type { RentalSpan, UnitPrice } from "./rental-price";
import { addWallMonths, toWallClock } from "./zoned";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BP_SCALE = BigInt(10000);
const ZERO = BigInt(0);

/** The lowest and highest adjustment: −99.99% and +1,000%. */
export const MIN_ADJUST_BP = -9999;
export const MAX_ADJUST_BP = 100000;

export type SeasonRule = {
  id: string;
  /** First and last calendar day at the location, both included: "YYYY-MM-DD". */
  startsOn: string;
  endsOn: string;
  /** True: the same days every year (the years in the dates are ignored). */
  repeatsYearly: boolean;
  /** Basis points: −2000 is 20% off, 1000 is 10% more. Never 0. */
  adjustBp: number;
  products: "all" | readonly string[];
};

export type SeasonAdjustment = {
  ruleId: string;
  periodsInside: number;
  /** Signed: negative for a decrease. */
  amount: bigint;
};

type Day = { year: number; monthDay: number };

function parseDay(text: string, what: string): Day {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new RangeError(`${what} must be YYYY-MM-DD, got ${text}`);
  const [, y, m, d] = match.map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`${what} is not a real date: ${text}`);
  }
  return { year: y, monthDay: m * 100 + d };
}

const ordinal = (day: Day) => day.year * 10000 + day.monthDay;

function assertRule(rule: SeasonRule): { from: Day; to: Day } {
  const from = parseDay(rule.startsOn, "A season's first day");
  const to = parseDay(rule.endsOn, "A season's last day");
  if (!rule.repeatsYearly && ordinal(to) < ordinal(from)) {
    throw new RangeError("A season can't end before it starts");
  }
  if (
    !Number.isInteger(rule.adjustBp) ||
    rule.adjustBp === 0 ||
    rule.adjustBp < MIN_ADJUST_BP ||
    rule.adjustBp > MAX_ADJUST_BP
  ) {
    throw new RangeError(
      `A season's percentage is out of range: ${rule.adjustBp}`,
    );
  }
  return { from, to };
}

/** The calendar day of a wall-clock value (see `zoned.ts`). */
function dayOf(wall: number): Day {
  const date = new Date(wall);
  return {
    year: date.getUTCFullYear(),
    monthDay: (date.getUTCMonth() + 1) * 100 + date.getUTCDate(),
  };
}

function covers(from: Day, to: Day, yearly: boolean, day: Day): boolean {
  if (!yearly) {
    return ordinal(from) <= ordinal(day) && ordinal(day) <= ordinal(to);
  }
  // Every year: compare month and day only. A range such as 15 Dec to 15 Jan
  // wraps over the new year.
  return from.monthDay <= to.monthDay
    ? from.monthDay <= day.monthDay && day.monthDay <= to.monthDay
    : day.monthDay >= from.monthDay || day.monthDay <= to.monthDay;
}

/**
 * When each charged period of a priced rental starts, on the wall clock at
 * the location. Null for a fixed price or a free line: no season applies.
 */
export function chargedPeriodStarts(
  unit: UnitPrice,
  span: RentalSpan,
): number[] | null {
  const wallStart = toWallClock(span.start, span.timeZone);
  const every = (count: number, at: (index: number) => number) =>
    Array.from({ length: count }, (_, index) => at(index));
  // Hours are elapsed time, so each hour's start is read on the clock in turn.
  const hours = (count: number) =>
    every(count, (i) =>
      toWallClock(new Date(span.start.getTime() + i * HOUR_MS), span.timeZone),
    );
  const basis = unit.basis;
  switch (basis.kind) {
    case "hours":
      return hours(basis.hours);
    case "list":
    case "months":
      return every(basis.days, (i) => wallStart + i * DAY_MS);
    case "periods": {
      const { period, count } = basis;
      if (period === "hour") return hours(count);
      if (period === "day") return every(count, (i) => wallStart + i * DAY_MS);
      if (period === "week") {
        return every(count, (i) => wallStart + i * 7 * DAY_MS);
      }
      return every(count, (i) => addWallMonths(wallStart, i));
    }
    case "fixed":
    case "free":
      return null;
  }
}

/**
 * The season adjustments of one line: one entry per rule that covers at
 * least one of its charged periods. `listPrice` is the line's, after quantity.
 */
export function seasonAdjustments(
  listPrice: bigint,
  periodStarts: readonly number[],
  rules: readonly SeasonRule[],
  productId: string,
): SeasonAdjustment[] {
  if (listPrice < ZERO) throw new RangeError("A list price can't be negative");
  const days = periodStarts.map(dayOf);
  const adjustments: SeasonAdjustment[] = [];
  for (const rule of rules) {
    const { from, to } = assertRule(rule);
    if (rule.products !== "all" && !rule.products.includes(productId)) continue;
    const inside = days.filter((day) =>
      covers(from, to, rule.repeatsYearly, day),
    ).length;
    if (inside === 0) continue;
    const size = divideHalfUp(
      listPrice * BigInt(Math.abs(rule.adjustBp)) * BigInt(inside),
      BigInt(days.length) * BP_SCALE,
    );
    adjustments.push({
      ruleId: rule.id,
      periodsInside: inside,
      amount: rule.adjustBp < 0 ? -size : size,
    });
  }
  return adjustments;
}
