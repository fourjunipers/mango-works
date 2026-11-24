import "server-only";
import { createClient } from "@mango/db/platform-server";
import type { BookingRulesRead } from "./booking-rules";
import { exactlyOne } from "@mango/db/rows";

/**
 * The read of Settings › Booking rules (Phase 2 stage 11): the shop's rules
 * (platform.tenants: overbooking, hold length, default buffers), each
 * location's (notice, cut-off, minimum days) and each live vehicle
 * product's own minimum days. As the signed-in person, under row-level
 * security; the page is for owners and managers. Nothing here writes: the
 * one writer is platform.save_booking_rules() (lib/booking-rules-save.ts).
 *
 * These are the stored values, blank where there is no rule of its own;
 * platform.booking_inputs() answers the rules in force for a booking, which
 * is a different question.
 */
export async function getBookingRules(
  tenantId: string,
): Promise<BookingRulesRead> {
  const supabase = await createClient();
  const [shop, locations, vehicles] = await Promise.all([
    exactlyOne(
      supabase
        .from("tenants")
        .select(
          "allow_overbooking, hold_minutes, buffer_before_minutes, buffer_after_minutes",
        )
        .eq("id", tenantId),
    ),
    supabase
      .from("locations")
      .select(
        "id, name, is_default, min_notice_hours, booking_cutoff_minutes, min_days_advance, min_days_walkin",
      )
      .eq("tenant_id", tenantId)
      .order("is_default", { ascending: false })
      .order("name"),
    supabase
      .from("products")
      .select("id, name, min_days_advance, min_days_walkin")
      .eq("tenant_id", tenantId)
      .eq("type", "vehicle")
      .is("retired_at", null)
      .order("name"),
  ]);
  if (shop.error) throw shop.error;
  if (locations.error) throw locations.error;
  if (vehicles.error) throw vehicles.error;
  return {
    shop: shop.data,
    locations: locations.data.map((l) => ({
      id: l.id,
      name: l.name,
      min_notice_hours: l.min_notice_hours,
      booking_cutoff_minutes: l.booking_cutoff_minutes,
      min_days_advance: l.min_days_advance,
      min_days_walkin: l.min_days_walkin,
    })),
    vehicles: vehicles.data,
  };
}

/**
 * The minimum notice for a vehicle's Moto Mangos bookings, for the Moto
 * Mangos tab's line: the strictest of the notices of the locations where
 * it has active vehicles (a booking can be for any of them). Null when
 * none of them asks for notice.
 */
export async function getShopNoticeHours(
  tenantId: string,
  productId: string,
): Promise<number | null> {
  const supabase = await createClient();
  const { data: units, error } = await supabase
    .from("units")
    .select("location_id")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .eq("status", "active");
  if (error) throw error;
  const ids = [...new Set(units.map((u) => u.location_id))];
  if (ids.length === 0) return null;
  const { data: locations, error: e2 } = await supabase
    .from("locations")
    .select("min_notice_hours")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (e2) throw e2;
  const hours = locations
    .map((l) => l.min_notice_hours)
    .filter((h): h is number => h !== null);
  return hours.length > 0 ? Math.max(...hours) : null;
}
