/**
 * Plain words for what a coupon answer means (Phase 2 stage 9). Pure: each
 * function picks a message key and its values; the screen translates it.
 *
 * - Check a price: each of decideDiscounts()' refusal reasons, and the two
 *   ways a good code is "not applied", in the namespace "Pricing.coupon".
 * - reserve() and confirm_hold(): the refusals a booking screen will show
 *   from stage 11 and Phase 3 (`hold_expired`, `coupon_not_valid`,
 *   `coupon_used_up`), in the shared "FormErrors" namespace beside every
 *   other refusal a form can show. No screen calls them yet.
 */

import type { CouponRefusal, CouponSettings } from "@mango/core/discounts";

/** Every reason decideDiscounts() can refuse a code for. */
export const couponRefusals = [
  "coupons_off",
  "unknown",
  "not_active",
  "wrong_channel",
  "too_early",
  "expired",
  "used_up",
  "customer_used_up",
  "not_these_products",
  "wrong_dates",
  "too_short",
  "below_minimum",
] as const satisfies readonly CouponRefusal[];

/** The key under "Pricing.coupon.refused" for each reason. */
export const refusalKey: Record<CouponRefusal, string> = {
  coupons_off: "couponsOff",
  unknown: "unknown",
  not_active: "notActive",
  wrong_channel: "wrongChannel",
  too_early: "tooEarly",
  expired: "expired",
  used_up: "usedUp",
  customer_used_up: "customerUsedUp",
  not_these_products: "notTheseProducts",
  wrong_dates: "wrongDates",
  too_short: "tooShort",
  below_minimum: "belowMinimum",
};

/**
 * What a refusal's sentence names, from the coupon's own settings: its
 * first or last day, its pickup dates, its minimum days or spend. Dates are
 * calendar days as stored ("2027-06-01"); the screen formats them. An
 * amount is minor units, formatted by the screen in the shop's currency.
 */
export type RefusalValues = {
  from?: string;
  to?: string;
  days?: number;
  amount?: bigint;
};

export function refusalWords(
  reason: CouponRefusal,
  coupon: Pick<
    CouponSettings,
    "validFrom" | "validTo" | "pickupFrom" | "pickupTo" | "minDays" | "minSpend"
  > | null,
): { key: string; values: RefusalValues } {
  const key = refusalKey[reason];
  if (!coupon) return { key, values: {} };
  switch (reason) {
    case "too_early":
      return coupon.validFrom
        ? { key, values: { from: coupon.validFrom } }
        : { key, values: {} };
    case "expired":
      return coupon.validTo
        ? { key, values: { to: coupon.validTo } }
        : { key, values: {} };
    case "wrong_dates":
      return {
        key:
          coupon.pickupFrom && coupon.pickupTo
            ? "wrongDatesBetween"
            : coupon.pickupFrom
              ? "wrongDatesFrom"
              : coupon.pickupTo
                ? "wrongDatesUntil"
                : key,
        values: {
          ...(coupon.pickupFrom ? { from: coupon.pickupFrom } : {}),
          ...(coupon.pickupTo ? { to: coupon.pickupTo } : {}),
        },
      };
    case "too_short":
      return coupon.minDays
        ? { key, values: { days: coupon.minDays } }
        : { key, values: {} };
    case "below_minimum":
      return coupon.minSpend !== null
        ? { key, values: { amount: coupon.minSpend } }
        : { key, values: {} };
    default:
      return { key, values: {} };
  }
}

/** Why a good code took nothing off, under "Pricing.coupon.notApplied". */
export function notAppliedKey(
  because: "returning_discount_is_better" | "takes_nothing",
): string {
  return because === "takes_nothing" ? "takesNothing" : "returningIsLarger";
}

// ------------------------------------------------- reserve() and confirm_hold()

/** The booking refusals that have shared words now (stage 9). */
export const bookingRefusals = [
  "hold_expired",
  "coupon_not_valid",
  "coupon_used_up",
] as const;
export type BookingRefusal = (typeof bookingRefusals)[number];

/**
 * The "FormErrors" key for a refusal of reserve() or confirm_hold(), or
 * null for one that has no words here yet (the screen then shows
 * "Couldn't save").
 */
export function bookingRefusalKey(reason: string): BookingRefusal | null {
  return (bookingRefusals as readonly string[]).includes(reason)
    ? (reason as BookingRefusal)
    : null;
}

// ------------------------------------------------------------- showing values

/** A calendar day as stored ("2027-06-01"), in the viewer's locale. */
export function dayText(day: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    dateStyle: "medium",
  }).format(
    new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    ),
  );
}
