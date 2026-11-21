import "server-only";
import { createClient } from "@mango/db/platform-server";
import type { UnitBooking, UnitBookingState } from "./unit-bookings";

/**
 * The reservations that hold one unit (through its blocks), as the
 * signed-in person under row-level security: every member of the shop reads
 * reservations and blocks (plan §6). A reservation carries no price, so
 * mechanics and drivers see nothing the Pricing tab hides. Nothing here
 * writes.
 *
 * Two reads, by date, so a booking far ahead can never drop out behind
 * newer ones: everything that has not ended (and anything still out, which
 * keeps the unit blocked past its end), soonest first, up to 200; and the
 * last few that are over, latest first.
 */

const COLUMNS =
  "id, booking_id, state, channel, starts_at, ends_at, hold_expires_at, unit_blocks!inner(unit_id)";
const UPCOMING_CAP = 200;
const PAST_CAP = 5;

type Row = {
  id: string;
  booking_id: string;
  state: string;
  channel: string;
  starts_at: string;
  ends_at: string;
  hold_expires_at: string | null;
};

export async function getUnitBookings(
  tenantId: string,
  unitId: string,
  now: Date = new Date(),
): Promise<UnitBooking[]> {
  const supabase = await createClient();
  const at = now.toISOString();
  const [upcoming, past] = await Promise.all([
    supabase
      .from("reservations")
      .select(COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("unit_blocks.unit_id", unitId)
      .in("state", ["held", "reserved", "out"])
      .or(`ends_at.gt.${at},state.eq.out`)
      .order("starts_at")
      .limit(UPCOMING_CAP),
    supabase
      .from("reservations")
      .select(COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("unit_blocks.unit_id", unitId)
      .in("state", ["held", "reserved", "returned"])
      .lte("ends_at", at)
      .order("ends_at", { ascending: false })
      .limit(PAST_CAP),
  ]);
  if (upcoming.error) throw upcoming.error;
  if (past.error) throw past.error;
  const seen = new Set<string>();
  const bookings: UnitBooking[] = [];
  for (const r of [...upcoming.data, ...past.data] as unknown as Row[]) {
    if (seen.has(r.id)) continue;
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
