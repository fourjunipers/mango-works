import "server-only";
import { createClient } from "@mango/db/platform-server";
import type { UnitBooking, UnitBookingState } from "./unit-bookings";

/**
 * The reservations that hold one unit, through its blocks, as the
 * signed-in person under row-level security: every member of the shop reads
 * reservations and blocks (plan §6). A reservation carries no price, so
 * mechanics and drivers see nothing the Pricing tab hides. Nothing here
 * writes.
 */
export async function getUnitBookings(
  tenantId: string,
  unitId: string,
): Promise<UnitBooking[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_blocks")
    .select(
      "reservation_id, reservations(id, booking_id, state, channel, starts_at, ends_at, hold_expires_at)",
    )
    .eq("tenant_id", tenantId)
    .eq("unit_id", unitId)
    .not("reservation_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const seen = new Set<string>();
  const bookings: UnitBooking[] = [];
  for (const row of data) {
    const r = row.reservations as unknown as {
      id: string;
      booking_id: string;
      state: string;
      channel: string;
      starts_at: string;
      ends_at: string;
      hold_expires_at: string | null;
    } | null;
    if (!r || seen.has(r.id)) continue;
    if (!["held", "reserved", "out", "returned"].includes(r.state)) continue;
    seen.add(r.id);
    bookings.push({
      reservationId: r.id,
      bookingId: r.booking_id,
      state: r.state as UnitBookingState,
      channel: r.channel,
      start: new Date(r.starts_at),
      end: new Date(r.ends_at),
      holdExpiresAt: r.hold_expires_at ? new Date(r.hold_expires_at) : null,
    });
  }
  return bookings;
}
