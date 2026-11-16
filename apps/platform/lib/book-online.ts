import "server-only";
import {
  offer,
  type BookingMode,
  type OfferRefusal,
  type OfferRequest,
} from "@mango/core/booking-rules";
import type { Quote } from "@mango/core/quote";
import { createAdminClient } from "@mango/db/admin";
import {
  lineAvailabilityOf,
  offerInputsOf,
  type AvailabilityRow,
  type BookingInputs,
} from "./booking-inputs";
import { quoteInputFor, type PricingInputs } from "./pricing-inputs";

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
 * cut-off and minimum days are checked here and nowhere else, so a path
 * round this function would skip them. lib/book-online.test.ts fails if any
 * other file could be such a path.
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
   * walk-in. A booking the listing would take only by request is refused
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
};

export type OnlineRefusal =
  /** offer(): the rules, stock as read, the cap as read, the price. */
  | OfferRefusal
  /** The listing would take this booking only by request (3M). */
  | "request_only"
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
    }
  | {
      ok: false;
      reason: OnlineRefusal;
      /** The index of the line that was refused, when one was. */
      line: number | null;
    };

/** The database calls this needs: three reads and reserve(). */
export type OnlineDb = {
  rpc(
    fn: "booking_inputs" | "availability" | "pricing_inputs" | "reserve",
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

/** Postgres: a lock was not available in time (lock_timeout, or NOWAIT). */
const LOCK_NOT_AVAILABLE = "55P03";

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
  if (request.lines.length === 0) throw new RangeError("No lines to book");

  const db: OnlineDb =
    deps.db ?? (createAdminClient().schema("platform") as unknown as OnlineDb);
  const now = (deps.now ?? (() => new Date()))();
  const productIds = [...new Set(request.lines.map((line) => line.productId))];

  // The reads. None takes a lock; reserve() checks stock again under its own.
  const [inputs, availability, pricing] = await Promise.all([
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
  ]);

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
  const answer = offer(
    offerInputsOf(inputs),
    lineAvailabilityOf(availability),
    quoteInputFor(
      pricing,
      lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        quantity: line.quantity,
        span: {
          start: line.start,
          end: line.end,
          timeZone: inputs.location.timezone,
        },
      })),
    ),
    asked,
  );
  if (!answer.ok) {
    return { ok: false, reason: answer.reason, line: Number(answer.lineId) };
  }
  if (answer.mode === "request") {
    const first = answer.lines.findIndex((line) => line.mode === "request");
    return { ok: false, reason: "request_only", line: first };
  }

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
    },
  });
  if (error) {
    // A lock that could not be had in time is the same to the caller as a
    // deadlock Postgres broke: nothing was written, send it again.
    if (error.code === LOCK_NOT_AVAILABLE) {
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
  };
}
