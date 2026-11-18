import type {
  CouponOutcome,
  CouponRefusal,
} from "@mango/core/discounts";
import { quote, type Discount, type Quote } from "@mango/core/quote";
import type { BookingInputs } from "./booking-inputs";
import {
  codeGiven,
  couponOutcomeOf,
  couponRequestOf,
  couponUseOf,
  decideFor,
  readCoupon,
  type CouponInputs,
  type CouponUse,
} from "./coupons";
import { quoteInputFor, type PricingInputs } from "./pricing-inputs";
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
 * A coupon goes through bookAsStaff(): it reads the prices and the code,
 * asks decideDiscounts() in @mango/core (through lib/coupons.ts) which
 * discounts the booking gets, prices it with quote(), and hands reserve()
 * the coupon and what the quote says it took. reserve() counts the use
 * under the coupon's row and writes it with the booking.
 *
 * Phase 3's order screens call these. Today the vehicle's Details form
 * calls moveUnit().
 */

/** A signed-in member's client on the platform schema. */
export type StaffDb = {
  rpc(
    fn:
      | "pricing_inputs"
      | "booking_inputs"
      | "coupon_inputs"
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
    /**
     * The coupon decideDiscounts() applied and what the quote says it took
     * (lib/coupons.ts, couponUseOf). bookAsStaff() fills it in.
     */
    coupon?: CouponUse | null;
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
      ...(booking.coupon ? { coupon: couponRequestOf(booking.coupon) } : {}),
    },
  });
}

export type StaffBooking = {
  channel: "walk_in" | "phone";
  /** The pickup place: its clock says which day the booking is made. */
  locationId: string;
  hold?: boolean;
  lines: readonly Omit<StaffLine, "locationId">[];
  /** The code the customer gave. Empty: none. */
  couponCode?: string | null;
  /** The staff's own discounts: always last, never blocked. */
  discounts?: readonly Discount[];
  /**
   * Rentals this customer has completed here, and who they are. Inputs
   * until customers exist (Phase 3): 0 and nobody.
   */
  completedRentals?: number;
  customerId?: string | null;
  /** The moment the booking is made. */
  now?: Date;
};

export type StaffBooked =
  | (StaffReserved & {
      /** The price it was booked at. */
      quote: Extract<Quote, { ok: true }>;
      /** What became of the code. Null: none was given. */
      coupon: CouponOutcome | null;
    })
  | (Refused & {
      /** With `coupon_refused`: why the code was refused. */
      coupon?: CouponRefusal;
    });

async function read<T>(
  db: StaffDb,
  fn: "pricing_inputs" | "booking_inputs",
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error)
    throw Object.assign(new Error(error.message), { code: error.code });
  return data as T;
}

/**
 * A booking at the counter or on the phone, priced, with its coupon.
 *
 * Staff are not bound by the booking rules (hours, notice, minimum days),
 * so offer() is not asked; the price is quote()'s, with the discounts
 * decideDiscounts() gave. Answers, beside reserve()'s own:
 *
 * - `coupon_refused`, with why: nothing is booked, so the member can tell
 *   the customer and book again without the code;
 * - `cant_be_priced`, with the line: a product has no price yet;
 * - `coupon_used_up` / `coupon_not_valid` from reserve(): the last use
 *   went to another booking, or the coupon changed since it was read;
 * - `try_again`: a lock could not be had in time. Nothing was written.
 */
export async function bookAsStaff(
  db: StaffDb,
  tenantId: string,
  booking: StaffBooking,
): Promise<StaffBooked> {
  if (booking.lines.length === 0) throw new RangeError("No lines to book");
  const productIds = [...new Set(booking.lines.map((line) => line.productId))];
  const [inputs, pricing, coupon] = await Promise.all([
    read<BookingInputs>(db, "booking_inputs", {
      p_tenant_id: tenantId,
      p_location_id: booking.locationId,
      p_product_ids: productIds,
    }),
    read<PricingInputs>(db, "pricing_inputs", {
      p_tenant_id: tenantId,
      p_product_ids: productIds,
    }),
    codeGiven(booking.couponCode)
      ? readCoupon(db, tenantId, booking.couponCode, {
          customerId: booking.customerId,
        })
      : Promise.resolve<CouponInputs | null>(null),
  ]);

  const decided = decideFor({
    pricing,
    quote: quoteInputFor(
      pricing,
      booking.lines.map((line, index) => ({
        id: String(index),
        productId: line.productId,
        quantity: line.quantity,
        span: {
          start: line.start,
          end: line.end,
          timeZone: inputs.location.timezone,
        },
        extraOf: line.parent === undefined ? null : String(line.parent),
      })),
      { discounts: booking.discounts },
    ),
    now: booking.now ?? new Date(),
    timeZone: inputs.location.timezone,
    channel: booking.channel,
    code: booking.couponCode,
    coupon,
    completedRentals: booking.completedRentals,
  });
  if (decided.decision.outcome === "refused") {
    return {
      ok: false,
      reason: "coupon_refused",
      coupon: decided.decision.reason,
    };
  }
  const priced = quote(decided.quote);
  if (!priced.ok) {
    return {
      ok: false,
      reason: "cant_be_priced",
      line: Number(priced.unpriced[0].lineId),
    };
  }

  const reserved = await reserveAsStaff(db, tenantId, {
    channel: booking.channel,
    hold: booking.hold,
    lines: booking.lines.map((line) => ({
      ...line,
      locationId: booking.locationId,
    })),
    coupon: couponUseOf(decided.decision, priced, booking.customerId),
  });
  if (!reserved.ok) return reserved;
  return {
    ...reserved,
    quote: priced,
    coupon: couponOutcomeOf(decided.decision),
  };
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
