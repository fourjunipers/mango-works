import type { CouponOutcome, CouponRefusal } from "@mango/core/discounts";
import { quote, type Discount, type Quote } from "@mango/core/quote";
import { snapshotQuote } from "@mango/core/quote-snapshot";
import { bookingChargeOf, type ChargeRequest } from "@mango/booking/charges";
import {
  askedLineOf,
  foldOrderLines,
  orderLinesOf,
  type MadeLine,
  type SentLines,
} from "@mango/booking/order-lines";
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
import {
  quoteInputFor,
  snapshotContextFor,
  type PricingInputs,
} from "./pricing-inputs";
import { isOrderTryAgain } from "./try-again";

/**
 * The staff paths to the order functions (docs/phase-3-plan.md §3.3, §4;
 * docs/phase-2-plan.md §3.2).
 *
 * A signed-in owner, manager or staff member books at the counter or on the
 * phone, holds or reserves a draft, confirms a hold, cancels, names the
 * units, and moves a booked unit, each as themselves: the database checks
 * the role. Every booking is an order (platform.create_order() and its
 * siblings; Phase 2's reserve() is gone). Every call here goes through one
 * place so that a lock that could not be had in time is answered the same
 * way everywhere: `{ ok: false, reason: "try_again" }`, with nothing
 * written, exactly what the functions themselves answer when Postgres broke
 * a deadlock. Any other database error is thrown as it is.
 *
 * Online channels never come through here: bookOnline() in @mango/booking
 * is their one entry point, and it runs the booking rules first.
 *
 * A coupon goes through bookAsStaff(): it reads the prices and the code,
 * asks decideDiscounts() in @mango/core (through lib/coupons.ts) which
 * discounts the booking gets, prices it with quote(), and hands
 * create_order() the coupon and what the quote says it took, with the
 * booking charge (the quote's snapshot). create_order() counts the use
 * under the coupon's row, for the order's customer, and writes it with the
 * order.
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
      | "create_order"
      | "hold_order"
      | "reserve_order"
      | "confirm_order"
      | "cancel_order"
      | "assign_order_units"
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
  /**
   * A vehicle rental is one vehicle: 1 for a vehicle line (so many bikes
   * are so many lines). Gear and services keep a quantity. bookAsStaff()
   * knows which products are vehicles and sends a line for N bikes as N;
   * reserveAsStaff() sends its lines as they are.
   */
  quantity: number;
  /** An extra: the index of the earlier vehicle line it goes with. */
  parent?: number;
  /** Vehicles and gear tracked unit by unit: one id per unit wanted. */
  unitIds?: string[];
};

/** What an order function answers when it has done its work. */
export type StaffReserved = {
  ok: true;
  /** The order's id: reservations.booking_id. */
  booking_id: string;
  /** Its number in the shop, and the code the customer quotes. */
  number: number;
  code: string;
  /** new (held), booked or draft. */
  status: string;
  /** Set while it is held. */
  hold_expires_at?: string;
  /** A repeat of a call already answered (the idempotency key). */
  repeat?: boolean;
  /**
   * One per line asked for. A line sent as N bikes is N rentals: its first
   * reservation, every rental, and all their units. A draft's rentals have
   * no reservation yet.
   */
  lines: {
    reservation_id: string | null;
    rental_ids: string[];
    unit_ids: string[];
    shortage: number;
  }[];
};

type OrderAnswer =
  | {
      ok: true;
      order_id: string;
      number: number;
      code: string;
      status: string;
      hold_expires_at?: string;
      repeat?: boolean;
      lines: MadeLine[];
    }
  | Refused;

async function call<T extends { ok: true }>(
  db: StaffDb,
  fn: Parameters<StaffDb["rpc"]>[0],
  args: Record<string, unknown>,
): Promise<T | Refused> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (isOrderTryAgain(error)) return { ok: false, reason: "try_again" };
    throw Object.assign(new Error(error.message), { code: error.code });
  }
  return data as T | Refused;
}

/** An order function's answer, one entry per line the caller asked for. */
function reservedOf(
  answer: OrderAnswer,
  sent: Pick<SentLines, "first" | "count">,
): StaffReserved | Refused {
  if (!answer.ok) {
    return "line" in answer
      ? { ...answer, line: askedLineOf(answer.line, sent) }
      : answer;
  }
  const { order_id, lines, ...order } = answer;
  return {
    ...order,
    booking_id: order_id,
    lines: foldOrderLines(lines, sent).map((line) => ({
      reservation_id: line.reservationId,
      rental_ids: line.rentalIds,
      unit_ids: line.unitIds,
      shortage: line.shortage,
    })),
  };
}

/** Each rental its own line: what create_order() answered, as it is. */
const asMade = (count: number): Pick<SentLines, "first" | "count"> => ({
  first: Array.from({ length: count }, (_, index) => index),
  count: Array.from({ length: count }, () => 1),
});

export type StaffOrder = {
  channel: "walk_in" | "phone";
  /** True: hold the units for the shop's hold time, to be confirmed. */
  hold?: boolean;
  /** True: save it as a draft, which holds nothing. Not with `hold`. */
  draft?: boolean;
  /** The order's customer: whose use a coupon's is. */
  customerId?: string | null;
  notes?: string | null;
  /**
   * A uuid made once per attempt: the same call sent again answers the
   * order the first one made.
   */
  idempotencyKey?: string;
  /**
   * The coupon decideDiscounts() applied and what the quote says it took
   * (lib/coupons.ts, couponUseOf). bookAsStaff() fills it in.
   */
  coupon?: CouponUse | null;
  /** The booking charge (the quote's snapshot). bookAsStaff() fills it in. */
  charges?: readonly ChargeRequest[];
};

const orderRequest = (
  order: StaffOrder,
  lines: Record<string, unknown>[],
): Record<string, unknown> => ({
  channel: order.channel,
  mode: "staff",
  action: order.draft ? "draft" : order.hold ? "hold" : "reserve",
  ...(order.customerId ? { customer_id: order.customerId } : {}),
  ...(order.notes ? { notes: order.notes } : {}),
  ...(order.idempotencyKey ? { idempotency_key: order.idempotencyKey } : {}),
  lines,
  ...(order.coupon ? { coupon: couponRequestOf(order.coupon) } : {}),
  ...(order.charges?.length ? { charges: order.charges } : {}),
});

/**
 * An order at the counter or on the phone, with no price worked out here:
 * its lines are sent as they are, one rental each (so a vehicle line is one
 * bike). Never an online channel.
 */
export async function reserveAsStaff(
  db: StaffDb,
  tenantId: string,
  booking: StaffOrder & { lines: readonly StaffLine[] },
): Promise<StaffReserved | Refused> {
  const sent = orderLinesOf(booking.lines, () => false);
  const answer = await call<Extract<OrderAnswer, { ok: true }>>(
    db,
    "create_order",
    { p_tenant_id: tenantId, p_order: orderRequest(booking, sent.lines) },
  );
  return reservedOf(answer, sent);
}

export type StaffBooking = Omit<StaffOrder, "coupon" | "charges"> & {
  /** The pickup place: its clock says which day the booking is made. */
  locationId: string;
  lines: readonly Omit<StaffLine, "locationId">[];
  /** The code the customer gave. Empty: none. */
  couponCode?: string | null;
  /** The staff's own discounts: always last, never blocked. */
  discounts?: readonly Discount[];
  /**
   * Rentals this customer has completed here, for the returning-customer
   * discount. Worked out from real orders in stage 7; an input until then.
   */
  completedRentals?: number;
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
 * An order at the counter or on the phone, priced, with its coupon and its
 * booking charge.
 *
 * Staff are not bound by the booking rules (hours, notice, minimum days),
 * so offer() is not asked; the price is quote()'s, with the discounts
 * decideDiscounts() gave. A line for N bikes is priced as one line and sent
 * as N rentals. Answers, beside create_order()'s own:
 *
 * - `coupon_refused`, with why: nothing is booked, so the member can tell
 *   the customer and book again without the code;
 * - `cant_be_priced`, with the line: a product has no price yet;
 * - `coupon_used_up` / `coupon_not_valid` / `customer_needed` from
 *   create_order(): the last use went to another booking, the coupon
 *   changed since it was read, or it has a limit per customer and the order
 *   has no customer;
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

  const now = booking.now ?? new Date();
  const lines = booking.lines.map((line, index) => ({
    id: String(index),
    productId: line.productId,
    quantity: line.quantity,
    span: {
      start: line.start,
      end: line.end,
      timeZone: inputs.location.timezone,
    },
    extraOf: line.parent === undefined ? null : String(line.parent),
  }));
  const decided = decideFor({
    pricing,
    quote: quoteInputFor(pricing, lines, { discounts: booking.discounts }),
    now,
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

  // One rental per bike (decision 2): a line for N bikes is sent as N.
  const vehicles = new Set(
    inputs.products
      .filter((product) => product.type === "vehicle")
      .map((product) => product.product_id),
  );
  const sent = orderLinesOf(
    booking.lines.map((line) => ({ ...line, locationId: booking.locationId })),
    (productId) => vehicles.has(productId),
  );
  // The booking charge: the same invoice quote() just priced, snapshotted.
  const charge = bookingChargeOf(
    snapshotQuote(
      decided.quote,
      snapshotContextFor(pricing, lines, {
        pricedAt: now,
        coupons:
          decided.decision.outcome === "decided"
            ? decided.decision.coupons
            : undefined,
      }),
    ),
    (lineId) => sent.first[Number(lineId)],
  );

  const answer = await call<Extract<OrderAnswer, { ok: true }>>(
    db,
    "create_order",
    {
      p_tenant_id: tenantId,
      p_order: orderRequest(
        {
          ...booking,
          coupon: couponUseOf(decided.decision, priced),
          charges: [charge],
        },
        sent.lines,
      ),
    },
  );
  const reserved = reservedOf(answer, sent);
  if (!reserved.ok) return reserved;
  return {
    ...reserved,
    quote: priced,
    coupon: couponOutcomeOf(decided.decision),
  };
}

/**
 * A draft held (`hold`) or reserved, with its rentals as they were saved.
 * Also a hold that has run out: it is settled first, then held or reserved
 * again (decision 22). A draft holds no coupon use, and a hold that ran out
 * gave its use back, so the coupon is handed over again.
 */
export async function reserveDraft(
  db: StaffDb,
  tenantId: string,
  orderId: string,
  options: { hold?: boolean; coupon?: CouponUse | null } = {},
): Promise<StaffReserved | Refused> {
  const answer = await call<Extract<OrderAnswer, { ok: true }>>(
    db,
    options.hold ? "hold_order" : "reserve_order",
    {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      ...(options.coupon
        ? { p_request: { coupon: couponRequestOf(options.coupon) } }
        : {}),
    },
  );
  // A refusal names a rental by its place in the order, as it is.
  if (!answer.ok) return answer;
  return reservedOf(answer, asMade(answer.lines.length));
}

type Done = { ok: true; booking_id: string } & Record<string, unknown>;

/** The order functions answer `order_id`: the booking's id by its Phase 2 name too. */
const doneOf = (
  answer: ({ ok: true } & Record<string, unknown>) | Refused,
): Done | Refused =>
  answer.ok ? { ...answer, booking_id: answer.order_id as string } : answer;

/**
 * A held order becomes booked. `hold_expired`: the hold had run out; the
 * order is a draft now, to be held or reserved again (reserveDraft()).
 */
export async function confirmHold(
  db: StaffDb,
  tenantId: string,
  bookingId: string,
): Promise<Done | Refused> {
  return doneOf(
    await call(db, "confirm_order", {
      p_tenant_id: tenantId,
      p_order_id: bookingId,
    }),
  );
}

/**
 * A whole order, with who cancelled and why (the shop, unless said). One
 * rental of an order is cancel_rental()'s (Phase 3 stage 5).
 */
export async function cancelReservation(
  db: StaffDb,
  tenantId: string,
  which: {
    bookingId: string;
    cancelledBy?: "customer" | "shop";
    reason?: "customer_request" | "shop_request" | "no_show" | "other";
  },
): Promise<Done | Refused> {
  return doneOf(
    await call(db, "cancel_order", {
      p_tenant_id: tenantId,
      p_order_id: which.bookingId,
      ...(which.cancelledBy ? { p_cancelled_by: which.cancelledBy } : {}),
      ...(which.reason ? { p_cancel_reason: which.reason } : {}),
    }),
  );
}

/**
 * Before pickup: fill a rental's shortage (no units named), or set the
 * units it holds.
 */
export async function assignUnits(
  db: StaffDb,
  tenantId: string,
  which: { bookingId: string; rentalId: string },
  unitIds?: string[],
): Promise<Done | Refused> {
  return doneOf(
    await call(db, "assign_order_units", {
      p_tenant_id: tenantId,
      p_order_id: which.bookingId,
      p_rental_id: which.rentalId,
      ...(unitIds === undefined ? {} : { p_unit_ids: unitIds }),
    }),
  );
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
