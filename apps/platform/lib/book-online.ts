import "server-only";
import {
  offer,
  type BookingMode,
  type OfferRefusal,
  type OfferRequest,
} from "@mango/core/booking-rules";
import type { CouponOutcome, CouponRefusal } from "@mango/core/discounts";
import type { Quote } from "@mango/core/quote";
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
import { extrasOf, quoteInputFor, type PricingInputs } from "./pricing-inputs";
import { isTryAgain } from "./try-again";

/**
 * The one server entry point for online bookings (docs/phase-2-plan.md §2.3,
 * the owner's addition to Q5, 16 Nov 2026).
 *
 * **This is the only code in either app that may call platform.reserve() for
 * an online channel** (`booking_page`, `marketplace`, `api`), and the only
 * code that calls it with the service role. It asks offer() in @mango/core
 * first, which runs bookable(), and goes on to reserve() only when the
 * answer is bookable, available and priced. The database checks stock and
 * the Moto Mangos cap under its locks; opening hours, closures, notice, the
 * cut-off, minimum days and an extra's most per vehicle are checked here
 * and nowhere else, so a path
 * round this function would skip them. lib/book-online.test.ts fails if any
 * other file could be such a path.
 *
 * A coupon code and the returning-customer discount are decided here too,
 * before the price: decideDiscounts() in @mango/core (through
 * lib/coupons.ts) says which discounts the booking gets, quote() prices it
 * with them inside offer(), and reserve() is handed the coupon and what the
 * quote says it took. It counts the use under the coupon's row and writes
 * it with the booking. A code that is refused refuses the booking, with the
 * reason, so nobody is booked at a price they did not expect.
 *
 * Phase 8's booking page and 3M's `marketplace_api` call this. Staff book as
 * themselves (Phase 3), never through here.
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
   * returning-customer discount, and who they are, for a coupon's uses per
   * customer. Inputs until customers exist (Phase 3): 0 and nobody.
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
   * reserve(), under the coupon's row: its last use went to another booking,
   * or it was switched off, archived or changed since it was read.
   */
  | "coupon_used_up"
  | "coupon_not_valid"
  /** reserve(): someone else got there first, or it could not get its locks. */
  | "try_again"
  | "not_allowed";

export type OnlineBookingAnswer =
  | {
      ok: true;
      bookingId: string;
      mode: BookingMode;
      lines: { reservationId: string; unitIds: string[]; shortage: number }[];
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
 * given, and reserve().
 */
export type OnlineDb = {
  rpc(
    fn:
      | "booking_inputs"
      | "availability"
      | "pricing_inputs"
      | "coupon_inputs"
      | "reserve",
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

type ReserveAnswer =
  | {
      ok: true;
      booking_id: string;
      hold_expires_at?: string;
      lines: { reservation_id: string; unit_ids: string[]; shortage: number }[];
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
  // An extra goes with an earlier line, as reserve() requires. quote()
  // would take any vehicle line, so without this a later parent passed
  // offer() and reserve() then raised invalid_request.
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

  // The reads. None takes a lock; reserve() checks stock again under its own.
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
  // reserve(), which staff use too (plan Q16).
  const over = overMostPerVehicle(request.lines, pricing);
  if (over !== null) {
    return { ok: false, reason: "over_most_per_vehicle", line: over };
  }

  // offer() first: bookable, available, priced. Only then reserve().
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
  const use = couponUseOf(
    discounts.decision,
    answer.quote,
    request.customerId,
  );

  const { data, error } = await db.rpc("reserve", {
    p_tenant_id: request.tenantId,
    p_request: {
      channel: request.channel,
      mode: request.mode,
      hold: request.hold ?? false,
      lines: request.lines.map((line) => ({
        product_id: line.productId,
        location_id: request.locationId,
        starts_at: line.start.toISOString(),
        ends_at: line.end.toISOString(),
        quantity: line.quantity,
        ...(line.parent === undefined ? {} : { parent: line.parent }),
      })),
      ...(use ? { coupon: couponRequestOf(use) } : {}),
    },
  });
  if (error) {
    // A lock that could not be had in time, or a statement the API ended
    // while it waited, is the same to the caller as a deadlock Postgres
    // broke: nothing was written, send it again (lib/try-again.ts).
    if (isTryAgain(error)) {
      return { ok: false, reason: "try_again", line: null };
    }
    throw Object.assign(new Error(error.message), { code: error.code });
  }
  const reserved = data as ReserveAnswer;
  if (!reserved.ok) {
    return {
      ok: false,
      reason: reserved.reason as OnlineRefusal,
      line: reserved.line,
    };
  }
  return {
    ok: true,
    bookingId: reserved.booking_id,
    mode: answer.mode,
    lines: reserved.lines.map((line) => ({
      reservationId: line.reservation_id,
      unitIds: line.unit_ids,
      shortage: line.shortage,
    })),
    holdExpiresAt: reserved.hold_expires_at ?? null,
    quote: answer.quote,
    coupon: couponOutcomeOf(discounts.decision),
  };
}
