"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { getBookingRules } from "@/lib/booking-rules-data";
import { canBooking } from "@/lib/booking-permissions";
import {
  saveBookingRules,
  type BookingRulesDb,
} from "@/lib/booking-rules-save";
import { requireMembership } from "@/lib/session";
import { createClient } from "@mango/db/platform-server";

/**
 * Settings › Booking rules: one Save for the shop, its locations and its
 * vehicles. The locations and vehicles to read are the shop's as the
 * database has them now, never a list the browser sent; the role check here
 * only spares a round trip (save_booking_rules() is the judge).
 */
export async function saveBookingRulesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const slug = String(formData.get("slug") ?? "");
  const { membership } = await requireMembership(slug);
  if (!canBooking(membership.role, "rules"))
    return { errors: { form: "bookingRulesOwnerOrManager" } };
  const read = await getBookingRules(membership.tenant.id);
  const answer = await saveBookingRules(
    (await createClient()) as unknown as BookingRulesDb,
    membership.tenant.id,
    (name) => String(formData.get(name) ?? ""),
    read,
  );
  if (!answer.ok) return { errors: answer.errors };
  revalidatePath(`/${slug}/settings/booking-rules`);
  return { ok: true };
}
