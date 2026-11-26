import "server-only";
import {
  offer,
  type BookingMode,
  type OfferRefusal,
  type OfferRequest,
} from "@mango/core/booking-rules";
import type { CouponOutcome, CouponRefusal } from "@mango/core/discounts";
import type { Quote } from "@mango/core/quote";
import { snapshotQuote } from "@mango/core/quote-snapshot";
import { createAdminClient } from "@mango/db/admin";
import {
  lineAvailabilityOf,
  offerInputsOf,
  type AvailabilityRow,
  type BookingInputs,
} from "./booking-inputs";
import {
  codeGiven,
  couponOutcomeOf,
  couponRequestOf,
  couponUseOf,
  decideFor,
  readCoupon,
  type CouponInputs,
} from "./coupons";
import { bookingChargeOf } from "./charges";
import {
  extrasOf,
  quoteInputFor,
  snapshotContextFor,
  type PricingInputs,
} from "./pricing-inputs";
import {
  askedLineOf,
  foldOrderLines,
  orderLinesOf,
  type FoldedLine,
  type MadeLine,
} from "./order-lines";
import { isOrderTryAgain } from "./try-again";

/**
 * The one server entry point for online bookings (docs/phase-2-plan.md §2.3,
 * the owner's addition to Q5, 16 Nov 2026). In the shared server-only
 * package since Phase 3 stage 2b (docs/phase-3-plan.md, decision 15), so the
 * booking page (Phase 8) and `marketplace_api` (3M) call the same code.
 *
 * **This is the only code in either app or any package that may call
 * platform.create_order() for an online channel** (`booking_page`,
 * `marketplace`, `api`), and the only code that calls it with the service
 * role. It asks offer() in @mango/core
 * first, which runs bookable(), and goes on to create_order() only when the
 * answer is bookable, available and priced. The database checks stock and
 * the Moto Mangos cap under its locks; opening hours, closures, notice, the
 * cut-off, minimum days and an extra's most per vehicle are checked here
 * and nowhere else, so a path
 * round this function would skip them. src/book-online.test.ts fails if any
 * other file could be such a path.
 *
 * A coupon code and the returning-customer discount are decided here too,
 * before the price: decideDiscounts() in @mango/core (through
 * ./coupons.ts) says which discounts the booking gets, quote() prices it
 * with them inside offer(), and create_order() is handed the coupon and what
 * the quote says it took. It counts the use under the coupon's row, for the
 * order's customer, and writes it with the order. A code that is refused
 * refuses the booking, with the reason, so nobody is booked at a price they
 * did not expect.
 *
 * Every booking is an order: create_order() is sent the order's lines (one
 * per bike: a vehicle rental is one vehicle, so a line for N bikes is sent
 * as N), the coupon, and the booking charge, which is the quote's snapshot
 * (snapshotQuote() in @mango/core, through ./charges.ts).
 *
 * Phase 8's booking page and 3M's `marketplace_api` call this. Staff book as
 * themselves, never through here.
 */

export type OnlineChannel = "booking_page" | "marketplace" | "api";

export type OnlineBookingRequest = {
  tenantId: string;
  /** The pickup place. One place per booking until multi-location. */
  locationId: string;
  channel: OnlineChannel;
  /**
   * "instant": an advance booking. "now": a Moto Mangos "Ride today"
   * walk-in, for that channel only and for a pickup that is now. A booking the listing would take only by request is refused
   * (`request_only`) until 3M builds request mode.
   */
  mode: "instant" | "now";
  /** True: hold the units for the shop's hold time, to be confirmed. */
  hold?: boolean;
  /**
   * A uuid the caller makes once per booking attempt. The same call sent
   * again (a retry after a lost answer) answers the order the first one
   * made, and books nothing twice.
   */
  idempotencyKey?: string;
  lines: readonly {
    productId: string;
    start: Date;
    end: Date;
    quantity: number;
    /** An extra: the index of the earlier vehicle line it goes with. */
    parent?: number;
  }[];
  /** The coupon code the customer typed. Empty: none. */
  couponCode?: string | null;
  /**
   * Rentals this customer has completed at this shop, for the
   * returning-customer discount, and who they are: the order's customer,
   * whose use a coupon's is. From the server, never the browser.
   */
  completedRentals?: number;
  customerId?: string | null;
};

export type OnlineRefusal =
  /** offer(): the rules, stock as read, the cap as read, the price. */
  | OfferRefusal
  /** The listing would take this booking only by request (3M). */
  | "request_only"
  /**
   * An extra line asks for more than the shop allows online: above its
   * "Most per vehicle" × its vehicle line's quantity. Staff are not bound.
   */
  | "over_most_per_vehicle"
  /** decideDiscounts() refused the code: `coupon` says why. */
  | "coupon_refused"
  /**
   * create_order(), under the coupon's row: its last use went to another
   * booking, or it was switched off, archived or changed since it was read;
   * or it has a limit per customer and the order has no customer.
   */
  | "coupon_used_up"
  | "coupon_not_valid"
  | "customer_needed"
  /** create_order(): someone else got there first, or it could not get its locks. */
  | "try_again"
  | "not_allowed";

export type OnlineBookingAnswer =
  | {
      ok: true;
      /** The order's id (reservations.booking_id). */
      bookingId: string;
      /** The order's number in the shop, and the code the customer quotes. */
      orderNumber: number;
      orderCode: string;
      mode: BookingMode;
      /**
       * One per line asked for. A line for N bikes is N rentals: its first
       * reservation, every rental, and all their units.
       */
      lines: FoldedLine[];
      /** Set when it is a hold. */
      holdExpiresAt: string | null;
      /** The price it was offered at. */
      quote: Extract<Quote, { ok: true }>;
      /**
       * What became of the code: applied, or good but not used (no use is
       * written then). Null: no code was given.
       */
      coupon: CouponOutcome | null;
    }
  | {
      ok: false;
      reason: OnlineRefusal;
      /** The index of the line that was refused, when one was. */
      line: number | null;
      /** With `coupon_refused`: why the code was refused. */
      coupon?: CouponRefusal;
    };

/**
 * The database calls this needs: three reads, a fourth when a code was
 * given, and create_order().
 */
export type OnlineDb = {
  rpc(
    fn:
      | "booking_inputs"
      | "availability"
      | "pricing_inputs"
      | "coupon_inputs"
      | "create_order",
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

export type OnlineDeps = {
  /** The service-role client on the platform schema. */
  db?: OnlineDb;
  /** The moment the booking is made. */
  now?: () => Date;
};

type OrderAnswer =
  | {
      ok: true;
      order_id: string;
      number: number;
      code: string;
      hold_expires_at?: string;
      lines: MadeLine[];
    }
  | { ok: false; reason: string; line: number | null };

const ONLINE: readonly string[] = ["booking_page", "marketplace", "api"];

async function read<T>(
  db: OnlineDb,
  fn: "booking_inputs" | "availability" | "pricing_inputs",
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error)
    throw Object.assign(new Error(error.message), { code: error.code });
  return data as T;
}

/**
 * The first extra line above the most the shop allows with its vehicle, or
 * null. The most is per vehicle ("up to N per bike", the owner, 17 Nov
 * 2026): the extra's max_quantity for that vehicle product × the vehicle
 * line's quantity, counted as the included quantity is (2 scooters and a
 * most of 2: up to 4 helmets). pricing_inputs() has already let the
 * vehicle's own row win over the "every vehicle" row and left out an extra
 * the vehicle opts out of. An extra with no limit, or one not offered with
 * that vehicle (priced with nothing free, plan stage 5 item 6), is not
 * bound here. Two lines of one extra on one vehicle are quote()'s refusal.
 *
 * A line of the same product with no parent can't get round it (review of
 * PR 45): when a vehicle line in the booking offers that extra with a
 * limit, the extra's parentless units and its units attached to those
 * vehicles are counted together against the sum of their mosts (each
 * vehicle line's max_quantity × its quantity). Such a line is answered with
 * its own index. Not bound: when no vehicle line offers it with a limit
 * (none offers it, or each opted out), or when one offers it with no limit,
 * which could take any number.
 */
export function overMostPerVehicle(
  lines: OnlineBookingRequest["lines"],
  pricing: Pick<PricingInputs, "extras">,
): number | null {
  /** The extra's row on that line's vehicle product, if it offers it. */
  const rowOf = (vehicleLine: number, extraProductId: string) =>
    extrasOf(pricing, lines[vehicleLine].productId).find(
      (row) => row.extra_product_id === extraProductId,
    );
  const vehicleLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.parent === undefined);

  for (const [index, line] of lines.entries()) {
    if (line.parent !== undefined) {
      const most = rowOf(line.parent, line.productId)?.max_quantity;
      if (most != null && line.quantity > most * lines[line.parent].quantity)
        return index;
      continue;
    }
    // A parentless line: an extra of a vehicle line here, with a limit?
    const offering = vehicleLines
      .map(({ index: at }) => ({ at, row: rowOf(at, line.productId) }))
      .filter((o) => o.row !== undefined);
    if (offering.length === 0) continue;
    if (offering.some((o) => o.row!.max_quantity === null)) continue;
    const limited = new Set(offering.map((o) => o.at));
    const allowed = offering.reduce(
      (sum, o) => sum + o.row!.max_quantity! * lines[o.at].quantity,
      0,
    );
    const taken = lines.reduce(
      (sum, other) =>
        other.productId === line.productId &&
        (other.parent === undefined || limited.has(other.parent))
          ? sum + other.quantity
          : sum,
      0,
    );
    if (taken > allowed) return index;
  }
  return null;
}

export async function bookOnline(
  request: OnlineBookingRequest,
  deps: OnlineDeps = {},
): Promise<OnlineBookingAnswer> {
  if (!ONLINE.includes(request.channel)) {
    throw new RangeError("bookOnline() is for online channels only");
  }
  if (request.mode !== "instant" && request.mode !== "now") {
    throw new RangeError("bookOnline() books instant or Ride today");
  }
  // "Ride today" skips the notice and the cap: it is Moto Mangos' alone.
  if (request.mode === "now" && request.channel !== "marketplace") {
    throw new RangeError("Ride today is a Moto Mangos booking");
  }
  if (request.lines.length === 0) throw new RangeError("No lines to book");
  // An extra goes with an earlier line, as create_order() requires. quote()
  // would take any vehicle line, so without this a later parent passed
  // offer() and create_order() then raised invalid_request.
  request.lines.forEach((line, index) => {
    if (
      line.parent !== undefined &&
      !(
        Number.isInteger(line.parent) &&
        line.parent >= 0 &&
        line.parent < index
      )
    ) {
      throw new RangeError(
        `Line ${index}: an extra goes with an earlier line, not ${line.parent}`,
      );
    }
  });

  const db: OnlineDb =
    deps.db ?? (createAdminClient().schema("platform") as unknown as OnlineDb);
  const now = (deps.now ?? (() => new Date()))();
  const productIds = [...new Set(request.lines.map((line) => line.productId))];

  // The reads. None takes a lock; create_order() checks stock again under its own.
  const [inputs, availability, pricing, coupon] = await Promise.all([
    read<BookingInputs>(db, "booking_inputs", {
      p_tenant_id: request.tenantId,
      p_location_id: request.locationId,
      p_product_ids: productIds,
    }),
    read<AvailabilityRow[]>(db, "availability", {
      p_tenant_id: request.tenantId,
      p_items: request.lines.map((line) => ({
        product_id: line.productId,
        location_id: request.locationId,
        starts_at: line.start.toISOString(),
        ends_at: line.end.toISOString(),
      })),
    }),
    read<PricingInputs>(db, "pricing_inputs", {
      p_tenant_id: request.tenantId,
      p_product_ids: productIds,
    }),
    // The coupon the code finds, and its uses so far: only when one was typed.
    codeGiven(request.couponCode)
      ? readCoupon(db, request.tenantId, request.couponCode, {
          customerId: request.customerId,
        })
      : Promise.resolve<CouponInputs | null>(null),
  ]);

  // The most per vehicle (product_extras.max_quantity), before anything
  // else is weighed: online channels only, so here and not in quote() or
  // create_order(), which staff use too (plan Q16).
  const over = overMostPerVehicle(request.lines, pricing);
  if (over !== null) {
    return { ok: false, reason: "over_most_per_vehicle", line: over };
  }

  // offer() first: bookable, available, priced. Only then create_order().
  const lines = request.lines.map((line, index) => ({
    id: String(index),
    productId: line.productId,
    start: line.start,
    end: line.end,
    quantity: line.quantity,
  }));
  const asked: OfferRequest = {
    channel: request.channel,
    mode: request.mode,
    now,
    lines,
  };
  // Which discounts the booking gets, decided before the price: the
  // returning-customer discount, then the coupon. A code that is refused
  // refuses the booking. (A line with no price is offer()'s to answer.)
  const discounts = decideFor({
    pricing,
    quote: quoteInputFor(
      pricing,
      // An extra is priced as its vehicle's extra: the units that come
      // free with the vehicle (product_extras) are not charged.
      lines.map((line, index) => ({
        id: line.id,
        productId: line.productId,
        quantity: line.quantity,
        span: {
          start: line.start,
          end: line.end,
          timeZone: inputs.location.timezone,
        },
        extraOf:
          request.lines[index].parent === undefined
            ? null
            : String(request.lines[index].parent),
      })),
    ),
    now,
    timeZone: inputs.location.timezone,
    channel: request.channel,
    code: request.couponCode,
    coupon,
    completedRentals: request.completedRentals,
  });
  if (discounts.decision.outcome === "refused") {
    return {
      ok: false,
      reason: "coupon_refused",
      line: null,
      coupon: discounts.decision.reason,
    };
  }

  const answer = offer(
    offerInputsOf(inputs),
    lineAvailabilityOf(availability),
    discounts.quote,
    asked,
  );
  if (!answer.ok) {
    return { ok: false, reason: answer.reason, line: Number(answer.lineId) };
  }
  if (answer.mode === "request") {
    const first = answer.lines.findIndex((line) => line.mode === "request");
    return { ok: false, reason: "request_only", line: first };
  }
  // The coupon's use, with what the quote says it took. None when no code
  // was given or the coupon was not applied: then no redemption is written.
  const use = couponUseOf(discounts.decision, answer.quote);

  // The order's lines: one per bike (./order-lines.ts). A vehicle rental is
  // one vehicle (decision 2), so a line for N bikes is sent as N lines.
  const vehicles = new Set(
    inputs.products
      .filter((product) => product.type === "vehicle")
      .map((product) => product.product_id),
  );
  const sent = orderLinesOf(
    request.lines.map((line) => ({
      ...line,
      locationId: request.locationId,
    })),
    (productId) => vehicles.has(productId),
  );
  // The booking charge: the quote as it was offered, snapshotted. The same
  // input offer() priced, so the charge can't hold another invoice's figures.
  const charge = bookingChargeOf(
    snapshotQuote(
      discounts.quote,
      snapshotContextFor(pricing, lines, {
        pricedAt: now,
        coupons:
          discounts.decision.outcome === "decided"
            ? discounts.decision.coupons
            : undefined,
      }),
    ),
    (lineId) => sent.first[Number(lineId)],
  );

  const { data, error } = await db.rpc("create_order", {
    p_tenant_id: request.tenantId,
    p_order: {
      channel: request.channel,
      mode: request.mode,
      action: request.hold ? "hold" : "reserve",
      ...(request.customerId ? { customer_id: request.customerId } : {}),
      ...(request.idempotencyKey
        ? { idempotency_key: request.idempotencyKey }
        : {}),
      lines: sent.lines,
      ...(use ? { coupon: couponRequestOf(use) } : {}),
      charges: [charge],
    },
  });
  if (error) {
    // A lock that could not be had in time, or a statement the API ended
    // while it waited, is the same to the caller as a deadlock Postgres
    // broke: nothing was written, send it again (./try-again.ts).
    if (isOrderTryAgain(error)) {
      return { ok: false, reason: "try_again", line: null };
    }
    throw Object.assign(new Error(error.message), { code: error.code });
  }
  const made = data as OrderAnswer;
  if (!made.ok) {
    return {
      ok: false,
      reason: made.reason as OnlineRefusal,
      // The line refused, as the caller numbered it.
      line: askedLineOf(made.line, sent),
    };
  }
  return {
    ok: true,
    bookingId: made.order_id,
    orderNumber: made.number,
    orderCode: made.code,
    mode: answer.mode,
    lines: foldOrderLines(made.lines, sent),
    holdExpiresAt: made.hold_expires_at ?? null,
    quote: answer.quote,
    coupon: couponOutcomeOf(discounts.decision),
  };
}
