import { isTryAgain } from "./try-again";

/**
 * The staff paths to the booking functions (docs/phase-2-plan.md §3.2, §4).
 *
 * A signed-in owner, manager or staff member books at the counter or on the
 * phone, confirms a hold, cancels, names the units, and moves a booked unit,
 * each as themselves: the database checks the role. Every call here goes
 * through one place so that a lock that could not be had in time is
 * answered the same way everywhere: `{ ok: false, reason: "try_again" }`,
 * with nothing written, exactly what the functions themselves answer when
 * Postgres broke a deadlock. Any other database error is thrown as it is.
 *
 * Online channels never come through here: lib/book-online.ts is their one
 * entry point, and it runs the booking rules first.
 *
 * Phase 3's order screens call these. Today the vehicle's Details form
 * calls moveUnit().
 */

/** A signed-in member's client on the platform schema. */
export type StaffDb = {
  rpc(
    fn:
      | "reserve"
      | "confirm_hold"
      | "cancel_reservation"
      | "assign_units"
      | "move_unit",
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

export type Refused = {
  ok: false;
  /** `try_again`: nothing was written; the same call may be sent again. */
  reason: string;
  line?: number | null;
};

export type StaffLine = {
  productId: string;
  locationId: string;
  start: Date;
  end: Date;
  quantity: number;
  /** An extra: the index of the earlier vehicle line it goes with. */
  parent?: number;
  /** Vehicles and gear tracked unit by unit: one id per unit wanted. */
  unitIds?: string[];
};

export type StaffReserved = {
  ok: true;
  booking_id: string;
  hold_expires_at?: string;
  lines: { reservation_id: string; unit_ids: string[]; shortage: number }[];
};

async function call<T extends { ok: true }>(
  db: StaffDb,
  fn: Parameters<StaffDb["rpc"]>[0],
  args: Record<string, unknown>,
): Promise<T | Refused> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (isTryAgain(error)) return { ok: false, reason: "try_again" };
    throw Object.assign(new Error(error.message), { code: error.code });
  }
  return data as T | Refused;
}

/** A booking at the counter or on the phone. Never an online channel. */
export function reserveAsStaff(
  db: StaffDb,
  tenantId: string,
  booking: {
    channel: "walk_in" | "phone";
    hold?: boolean;
    lines: readonly StaffLine[];
  },
): Promise<StaffReserved | Refused> {
  return call<StaffReserved>(db, "reserve", {
    p_tenant_id: tenantId,
    p_request: {
      channel: booking.channel,
      mode: "staff",
      hold: booking.hold ?? false,
      lines: booking.lines.map((line) => ({
        product_id: line.productId,
        location_id: line.locationId,
        starts_at: line.start.toISOString(),
        ends_at: line.end.toISOString(),
        quantity: line.quantity,
        ...(line.parent === undefined ? {} : { parent: line.parent }),
        ...(line.unitIds === undefined ? {} : { unit_ids: line.unitIds }),
      })),
    },
  });
}

export function confirmHold(
  db: StaffDb,
  tenantId: string,
  bookingId: string,
): Promise<({ ok: true } & Record<string, unknown>) | Refused> {
  return call(db, "confirm_hold", {
    p_tenant_id: tenantId,
    p_booking_id: bookingId,
  });
}

/** A whole booking, or one of its rows (its extras go with it). */
export function cancelReservation(
  db: StaffDb,
  tenantId: string,
  which: { bookingId: string } | { reservationId: string },
): Promise<({ ok: true } & Record<string, unknown>) | Refused> {
  return call(db, "cancel_reservation", {
    p_tenant_id: tenantId,
    ...("bookingId" in which
      ? { p_booking_id: which.bookingId }
      : { p_reservation_id: which.reservationId }),
  });
}

/** Fill a shortage (no units named), or set the units a reservation holds. */
export function assignUnits(
  db: StaffDb,
  tenantId: string,
  reservationId: string,
  unitIds?: string[],
): Promise<({ ok: true } & Record<string, unknown>) | Refused> {
  return call(db, "assign_units", {
    p_tenant_id: tenantId,
    p_reservation_id: reservationId,
    ...(unitIds === undefined ? {} : { p_unit_ids: unitIds }),
  });
}

/** A unit to another product or place, its upcoming bookings with it. */
export function moveUnit(
  db: StaffDb,
  tenantId: string,
  move: {
    unitId: string;
    productId: string;
    locationId: string;
    expectedBookings?: number;
    expectedUpdatedAt?: string;
    details?: Record<string, unknown>;
  },
): Promise<({ ok: true } & Record<string, unknown>) | Refused> {
  return call(db, "move_unit", {
    p_tenant_id: tenantId,
    p_unit_id: move.unitId,
    p_product_id: move.productId,
    p_location_id: move.locationId,
    p_expected_bookings: move.expectedBookings,
    p_expected_updated_at: move.expectedUpdatedAt,
    p_details: move.details,
  });
}
