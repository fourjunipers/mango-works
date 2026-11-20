/**
 * "Nothing was written, send it again."
 *
 * The booking functions (reserve, confirm_hold, cancel_reservation,
 * assign_units, move_unit), save_product_extras (its caller is
 * lib/extras-save.ts) and save_coupon (lib/coupon-save.ts) each have their
 * own lock timeout, 6 seconds,
 * shorter than the API's statement timeout of 8. A wait for a lock that
 * runs out raises one of two Postgres codes, and to a caller both mean the
 * same as the `try_again` those functions answer when Postgres broke a
 * deadlock:
 *
 * - 55P03 (lock_not_available): the function's own lock timeout. The one
 *   that normally arrives.
 * - 57014 (query_canceled): the API's statement timeout, when several
 *   shorter waits added up to it.
 *
 * Only for a call to one of those functions, or to save_booking_rules()
 * (lib/booking-rules.ts), a writer of rows with no lock timeout of its own,
 * whose wait behind a booking can reach the API's 57014. From a read, 57014
 * is an error, not an answer.
 */
export const TRY_AGAIN_CODES: readonly string[] = ["55P03", "57014"];

export function isTryAgain(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return !!error?.code && TRY_AGAIN_CODES.includes(error.code);
}
