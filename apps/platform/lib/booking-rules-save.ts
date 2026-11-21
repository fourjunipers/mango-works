import {
  bookingRulesErrorKey,
  readBookingRulesForm,
  type BookingRulesRead,
} from "./booking-rules";

/**
 * Saving Settings › Booking rules through platform.save_booking_rules(), its
 * one caller (Phase 2 stage 11). The form is read first, box by box
 * (lib/booking-rules.ts); then everything is sent in one call, which saves
 * the shop, its locations and its vehicles together or not at all.
 *
 * The database is the judge of who may: it raises only_owner_or_manager
 * for anyone else, answered here in words. save_booking_rules() takes the
 * locations' and the vehicles' rows only (no advisory lock); a booking reads
 * the rules before its transaction and never waits for them.
 */

export type BookingRulesDb = {
  rpc(
    fn: "save_booking_rules",
    args: { p_tenant_id: string; p_rules: unknown },
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

export async function saveBookingRules(
  db: BookingRulesDb,
  tenantId: string,
  get: (name: string) => string,
  read: Pick<BookingRulesRead, "locations" | "vehicles">,
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const form = readBookingRulesForm(get, read);
  if (!form.ok) return { ok: false, errors: form.errors };
  const { error } = await db.rpc("save_booking_rules", {
    p_tenant_id: tenantId,
    p_rules: form.payload,
  });
  if (error) return { ok: false, errors: { form: bookingRulesErrorKey(error) } };
  return { ok: true };
}
