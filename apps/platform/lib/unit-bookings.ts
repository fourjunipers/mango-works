/**
 * Bookings on a unit's page (Phase 2 stage 11; docs/phase-2-plan.md §7):
 * the reservations that hold this unit, read-only. Pure: the read is
 * lib/unit-bookings-data.ts'.
 *
 * A reservation holds a unit through its block (unit_blocks.reservation_id).
 * Its states: held (a hold, until it runs out), reserved, out (picked up),
 * returned. A cancelled or expired reservation keeps no block, so it is not
 * here. Phase 2 writes only held and reserved; out and returned come with
 * pickup and return in Phase 3 (until then only test rows have them).
 */

export type UnitBookingState = "held" | "reserved" | "out" | "returned";

export type UnitBooking = {
  reservationId: string;
  bookingId: string;
  state: UnitBookingState;
  channel: string;
  start: Date;
  end: Date;
  holdExpiresAt: Date | null;
};

/** What the screen says of one booking, as of `now`. */
export type UnitBookingStatus =
  | { kind: "held"; until: Date | null }
  /** A hold past its expiry that the sweep has not cleared yet. */
  | { kind: "ranOut" }
  | { kind: "booked" }
  | { kind: "out" }
  | { kind: "overdue" }
  | { kind: "returned" };

export function statusOf(booking: UnitBooking, now: Date): UnitBookingStatus {
  switch (booking.state) {
    case "held":
      // The sweep runs every minute; until it does, the hold is still a
      // row, but it holds nothing.
      return booking.holdExpiresAt !== null &&
        booking.holdExpiresAt.getTime() <= now.getTime()
        ? { kind: "ranOut" }
        : { kind: "held", until: booking.holdExpiresAt };
    case "reserved":
      return { kind: "booked" };
    case "out":
      // Still out past its return: the overdue rule keeps the unit blocked.
      return booking.end.getTime() < now.getTime()
        ? { kind: "overdue" }
        : { kind: "out" };
    case "returned":
      return { kind: "returned" };
  }
}

/**
 * Split for the screen: what is coming or going on now (soonest first),
 * and the last few that are over (latest first). A unit still out past its
 * return stays in the first list; a hold that has run out is over.
 */
export function splitUnitBookings(
  bookings: readonly UnitBooking[],
  now: Date,
  pastLimit = 5,
): { current: UnitBooking[]; past: UnitBooking[] } {
  const over = (b: UnitBooking) =>
    b.state === "returned" ||
    (b.state === "held" &&
      b.holdExpiresAt !== null &&
      b.holdExpiresAt.getTime() <= now.getTime()) ||
    (b.state !== "out" && b.end.getTime() <= now.getTime());
  const current = bookings
    .filter((b) => !over(b))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const past = bookings
    .filter(over)
    .sort((a, b) => b.end.getTime() - a.end.getTime())
    .slice(0, pastLimit);
  return { current, past };
}
