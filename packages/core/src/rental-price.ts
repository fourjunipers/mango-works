/**
 * The price of one unit for one rental, before quantity, seasons, discounts
 * and tax (docs/products-redesign.md §9.3 and §9.18; steps 1 and 2 of the
 * pricer's fixed order, §9.9). Pure functions, `bigint` minor units.
 *
 * Ways of pricing:
 *  - flat fee per period: amount × every started hour, day, week or month
 *  - fixed price: the amount, whatever the length
 *  - by rental length: a price list (below)
 *  - free: 0
 *
 * By rental length (owner decisions, 15 Nov 2026):
 *  1. Under 24 hours, when the list has an hourly price: every started hour ×
 *     the hourly price, never more than the 1-day total.
 *  2. 30 days or fewer: the list's total for that many days. So a rental never
 *     costs more than the list's price for the same number of days.
 *  3. From 31 days: whole months, date to date from the pickup date, at the
 *     monthly price (the list's 30-day total), plus leftover days at the
 *     product's long-stay daily rate. With no rate set it is the monthly
 *     price ÷ 30. Leftover days never cost more than one more month.
 *     A rental of 31 started days that is still short of its first calendar
 *     month (1 Jan 10:00 to 31 Jan 12:00) costs the monthly price.
 */

import { divideHalfUp, LIST_DAYS, type ResolvedList } from "./price-list";
import {
  isUnderOneDay,
  rentalDays,
  rentalHours,
  rentalMonths,
  type ChargeRules,
} from "./rental-days";

const ZERO = BigInt(0);

export type PricePeriod = "hour" | "day" | "week" | "month";

export type Pricing =
  | {
      method: "tiered";
      list: ResolvedList;
      /** For each leftover day after whole months. Empty = monthly ÷ 30. */
      longStayDay?: bigint | null;
    }
  | { method: "per_period"; amount: bigint; period: PricePeriod }
  | { method: "fixed"; amount: bigint }
  | { method: "free" };

export type RentalSpan = {
  start: Date;
  end: Date;
  /** The location's time zone: days and months run on its wall clock. */
  timeZone: string;
  rules?: ChargeRules;
};

/** How the amount was worked out, for the screen and the order's record. */
export type PriceBasis =
  | { kind: "hours"; hours: number; hourly: bigint; capped: boolean }
  | { kind: "list"; days: number }
  | {
      kind: "months";
      days: number;
      months: number;
      monthly: bigint;
      leftoverDays: number;
      longStayDay: bigint;
      /** True when the product has no rate of its own. */
      longStayFromMonthly: boolean;
      /** True when the leftover days were held to one more month. */
      leftoverCapped: boolean;
      /** True when 31 days have started but the first month is not complete. */
      underOneMonth: boolean;
    }
  | { kind: "periods"; period: PricePeriod; count: number }
  | { kind: "fixed" }
  | { kind: "free" };

export type UnitPrice = { amount: bigint; basis: PriceBasis };

function assertPositive(value: bigint, what: string): void {
  if (typeof value !== "bigint" || value <= ZERO) {
    throw new RangeError(`${what} must be more than 0`);
  }
}

/** The long-stay daily rate in use: the product's own, or the monthly price ÷ 30. */
export function longStayRate(
  monthly: bigint,
  longStayDay?: bigint | null,
): { rate: bigint; fromMonthly: boolean } {
  if (longStayDay === undefined || longStayDay === null) {
    return {
      rate: divideHalfUp(monthly, BigInt(LIST_DAYS)),
      fromMonthly: true,
    };
  }
  assertPositive(longStayDay, "The long-stay daily rate");
  return { rate: longStayDay, fromMonthly: false };
}

function tieredPrice(
  list: ResolvedList,
  longStayDay: bigint | null | undefined,
  span: RentalSpan,
): UnitPrice {
  if (list.days.length !== LIST_DAYS) {
    throw new RangeError(`A price list has ${LIST_DAYS} days`);
  }
  const options = { timeZone: span.timeZone, rules: span.rules };

  if (list.hourly !== null && isUnderOneDay(span.start, span.end, options)) {
    const hours = rentalHours(span.start, span.end);
    const byHour = list.hourly * BigInt(hours);
    const oneDay = list.days[0];
    const capped = byHour > oneDay;
    return {
      amount: capped ? oneDay : byHour,
      basis: { kind: "hours", hours, hourly: list.hourly, capped },
    };
  }

  const days = rentalDays(span.start, span.end, options);
  if (days <= LIST_DAYS) {
    return { amount: list.days[days - 1], basis: { kind: "list", days } };
  }

  const { months, leftoverDays } = rentalMonths(span.start, span.end, options);
  const monthly = list.days[LIST_DAYS - 1];
  const { rate, fromMonthly } = longStayRate(monthly, longStayDay);
  // The 31st day can start before the first month is complete (a 31-day month,
  // returned later in the day than the pickup). That is the monthly price:
  // not less than 30 days cost, not more than the month it is about to become.
  const underOneMonth = months === 0;
  const leftover = rate * BigInt(leftoverDays);
  const leftoverCapped = !underOneMonth && leftover > monthly;
  return {
    amount:
      monthly * BigInt(months) +
      (underOneMonth || leftoverCapped ? monthly : leftover),
    basis: {
      kind: "months",
      days,
      months,
      monthly,
      leftoverDays,
      longStayDay: rate,
      longStayFromMonthly: fromMonthly,
      leftoverCapped,
      underOneMonth,
    },
  };
}

/** Every started period. A week is 7 days; a month is date to date. */
export function chargedPeriods(period: PricePeriod, span: RentalSpan): number {
  const options = { timeZone: span.timeZone, rules: span.rules };
  switch (period) {
    case "hour":
      return rentalHours(span.start, span.end);
    case "day":
      return rentalDays(span.start, span.end, options);
    case "week":
      return Math.ceil(rentalDays(span.start, span.end, options) / 7);
    case "month": {
      const { months, leftoverDays } = rentalMonths(
        span.start,
        span.end,
        options,
      );
      return months + (leftoverDays > 0 ? 1 : 0);
    }
  }
}

/**
 * The list price of one unit for the rental. Seasons, quantity, discounts and
 * tax come after it, in `quote()`.
 */
export function unitPrice(pricing: Pricing, span: RentalSpan): UnitPrice {
  switch (pricing.method) {
    case "tiered":
      return tieredPrice(pricing.list, pricing.longStayDay, span);
    case "per_period": {
      assertPositive(pricing.amount, "The price");
      const count = chargedPeriods(pricing.period, span);
      return {
        amount: pricing.amount * BigInt(count),
        basis: { kind: "periods", period: pricing.period, count },
      };
    }
    case "fixed":
      assertPositive(pricing.amount, "The price");
      return { amount: pricing.amount, basis: { kind: "fixed" } };
    case "free":
      return { amount: ZERO, basis: { kind: "free" } };
  }
}
