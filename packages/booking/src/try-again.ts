/**
 * "Nothing was written, send it again."
 *
 * The order functions (create_order, hold_order, reserve_order,
 * confirm_order, cancel_order, assign_order_units), move_unit,
 * save_product_extras (its caller is apps/platform/lib/extras-save.ts) and
 * save_coupon (lib/coupon-save.ts) each have their own lock timeout, 6
 * seconds, shorter than the API's statement timeout of 8. A wait for a lock
 * that runs out raises one of two Postgres codes, and to a caller both mean
 * the same as the `try_again` those functions answer when Postgres broke a
 * deadlock:
 *
 * - 55P03 (lock_not_available): the function's own lock timeout. The one
 *   that normally arrives.
 * - 57014 (query_canceled): the API's statement timeout, when several
 *   shorter waits added up to it.
 *
 * Only for a call to one of those functions, or to save_booking_rules()
 * (its caller is lib/booking-rules-save.ts, its words lib/booking-rules.ts),
 * a writer of rows with no lock timeout of its own,
 * whose wait behind a booking can reach the API's 57014. From a read, 57014
 * is an error, not an answer.
 *
 * The order functions' callers (./book-online.ts and the platform's
 * lib/staff-booking.ts) also answer `try_again` for 40P01, a deadlock
 * Postgres broke that reached the caller (docs/phase-3-plan.md §3.3): the
 * functions catch it themselves, and one raised past them (at commit, say)
 * means the same. ORDER_TRY_AGAIN_CODES and isOrderTryAgain() are theirs.
 */
export const TRY_AGAIN_CODES: readonly string[] = ["55P03", "57014"];

export function isTryAgain(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return !!error?.code && TRY_AGAIN_CODES.includes(error.code);
}

export const ORDER_TRY_AGAIN_CODES: readonly string[] = [
  ...TRY_AGAIN_CODES,
  "40P01",
];

export function isOrderTryAgain(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return !!error?.code && ORDER_TRY_AGAIN_CODES.includes(error.code);
}
