/**
 * Booking rules (docs/phase-2-plan.md §2.3, §3.6; docs/INTEGRATION.md §4.4
 * to §4.6; docs/products-redesign.md §9.10). Pure functions: no database and
 * no clock of their own.
 *
 * The database decides stock, under its locks. Everything else that can
 * refuse a booking is decided here, once, for every channel:
 *
 *   bookable()  opening hours, closures, the cut-off, minimum days and
 *               minimum notice, in the location's time zone;
 *   offer()     bookable, then available (with the Moto Mangos cap and mode),
 *               then the price from quote(), as one answer, so no caller can
 *               show a price for something it can't book.
 *
 * Time. A location's hours and closures are wall-clock times and calendar
 * dates at the location, so an instant is read on the location's clock
 * through zoned.ts: no fixed offset, daylight saving included. Minimum days
 * are rental days on that clock (rental-days.ts). Notice, and the cut-off
 * before closing, are elapsed time: 24 hours of notice is 24 real hours
 * even on a night when the clocks change.
 */

import { isShopClosedOn, type Closure } from "./closures";
import {
  listingOfferFromPeaks,
  noticeHours,
  type ListingPeaks,
  type ListingSettings,
} from "./listing";
import { quote, type Quote, type QuoteInput } from "./quote";
import { rentalDays } from "./rental-days";
import { fromWallClock, toWallClock, zonedDateString } from "./zoned";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// ------------------------------------------------------------------ channels

/** Where a booking comes from (platform.reservations.channel). */
export type BookingChannel =
  "walk_in" | "phone" | "booking_page" | "marketplace" | "api";

/**
 * How it confirms (platform.reservations.mode). "now" is a Moto Mangos
 * "Ride today" walk-in; "instant" and "request" are advance bookings.
 */
export type BookingMode = "staff" | "instant" | "request" | "now";

export type BookingHow = { channel: BookingChannel; mode: BookingMode };

/** The channels the server books for; the others are a signed-in member's. */
export const ONLINE_CHANNELS = ["booking_page", "marketplace", "api"] as const;

export function isOnlineChannel(channel: BookingChannel): boolean {
  return (ONLINE_CHANNELS as readonly string[]).includes(channel);
}

// --------------------------------------------------------------------- rules

/** One weekday's opening hours at a location. 0 = Sunday. */
export type OpeningHours = {
  weekday: number;
  /** Wall-clock times at the location: "09:00" or "09:00:00". */
  open: string;
  close: string;
};

/**
 * The rules in force for one product at one location. Every one may be
 * missing: "not set" is no rule.
 */
export type BookingRules = {
  /** The location's IANA time zone. */
  timeZone: string;
  /**
   * The location's opening hours. A location that has saved none has no
   * hours rule; one that has saved some is closed on a weekday it left out.
   */
  hours: readonly OpeningHours[];
  closures: readonly Closure[];
  /** The shop's minimum notice (the location's), in hours. */
  minNoticeHours: number | null;
  /** The product's own Moto Mangos lead time, in hours. */
  leadTimeHours: number | null;
  /** "Ride today" stops this many minutes before closing. */
  bookingCutoffMinutes: number | null;
  /** Minimum rental days: the product's own, else the location's. */
  minDaysAdvance: number | null;
  minDaysWalkin: number | null;
};

/**
 * The contract's reasons (docs/INTEGRATION.md §3.12), and one more:
 * "not_now", a "Ride today" booking whose pickup is not now.
 */
export type BookableReason =
  "outside_hours" | "too_short" | "too_soon" | "not_now";

/**
 * "Ride today" is for riding away now (docs/INTEGRATION.md §4.5, "from
 * now"). The pickup may be this many minutes either side of the moment the
 * booking is made: time to fill in a form, and for the request to arrive.
 */
export const RIDE_TODAY_GRACE_MINUTES = 15;

export type Bookable =
  | { ok: true }
  | {
      ok: false;
      reason: "outside_hours";
      /**
       * What fell outside: the pickup, the return, or (Ride today) now or
       * the cut-off. "no_hours": an online booking at a location that has
       * saved no opening hours.
       */
      at: "pickup" | "return" | "now" | "cutoff" | "no_hours";
    }
  | { ok: false; reason: "not_now"; earliest: Date; latest: Date }
  | { ok: false; reason: "too_short"; days: number; minDays: number }
  | { ok: false; reason: "too_soon"; earliestPickup: Date };

function timeOfDay(text: string): number {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) throw new RangeError(`Not a time of day: ${text}`);
  const [h, m, s] = [match[1], match[2], match[3] ?? "0"].map(Number);
  const ms = h * HOUR_MS + m * MINUTE_MS + s * 1000;
  if (m > 59 || s > 59 || ms > DAY_MS) {
    throw new RangeError(`Not a time of day: ${text}`);
  }
  return ms;
}

/** The location's hours on the day of `wall`, or null: closed that weekday. */
function hoursOn(
  rules: BookingRules,
  wall: number,
): { open: number; close: number } | null {
  const weekday = new Date(wall).getUTCDay();
  const row = rules.hours.find((h) => h.weekday === weekday);
  return row
    ? { open: timeOfDay(row.open), close: timeOfDay(row.close) }
    : null;
}

const msIntoDay = (wall: number) => ((wall % DAY_MS) + DAY_MS) % DAY_MS;

/**
 * Whether the location is open at an instant: not on a closure date, and
 * inside that weekday's hours (both ends count), on the location's clock.
 */
export function isOpenAt(rules: BookingRules, instant: Date): boolean {
  if (
    isShopClosedOn(
      rules.closures as Closure[],
      zonedDateString(instant, rules.timeZone),
    )
  ) {
    return false;
  }
  if (rules.hours.length === 0) return true;
  const wall = toWallClock(instant, rules.timeZone);
  const hours = hoursOn(rules, wall);
  if (!hours) return false;
  const at = msIntoDay(wall);
  return at >= hours.open && at <= hours.close;
}

/**
 * The last moment a "Ride today" booking may be made on the day of `now`:
 * the cut-off minutes before that day's closing time, as elapsed time. Null:
 * no cut-off, or no closing time to count back from.
 */
export function cutoffInstant(rules: BookingRules, now: Date): Date | null {
  if (rules.bookingCutoffMinutes === null || rules.hours.length === 0) {
    return null;
  }
  const wall = toWallClock(now, rules.timeZone);
  const hours = hoursOn(rules, wall);
  if (!hours) return null;
  const closing = fromWallClock(
    wall - msIntoDay(wall) + hours.close,
    rules.timeZone,
  );
  return new Date(closing.getTime() - rules.bookingCutoffMinutes * MINUTE_MS);
}

const isStaffChannel = (channel: BookingChannel) =>
  channel === "walk_in" || channel === "phone";

/**
 * Throws unless the channel and the mode go together: staff channels book
 * in mode "staff" only; online channels in "instant", "request" or, for
 * Moto Mangos alone, "now".
 */
export function assertHow(how: BookingHow): void {
  const ok = isStaffChannel(how.channel)
    ? how.mode === "staff"
    : how.mode === "instant" ||
      how.mode === "request" ||
      (how.mode === "now" && how.channel === "marketplace");
  if (!ok) {
    throw new RangeError(
      `A ${how.channel} booking can't be made in mode ${how.mode}`,
    );
  }
}

/**
 * Hours of notice a booking needs, or null where notice does not apply
 * (docs/products-redesign.md §9.10):
 *
 *   Moto Mangos, advance booking   the stricter of the shop's notice and the
 *                                  listing's lead time
 *   Moto Mangos, "Ride today"      none
 *   the shop's own booking page    the shop's notice only (the API the same)
 *   staff, in the app              none
 */
export function noticeFor(rules: BookingRules, how: BookingHow): number | null {
  if (isStaffChannel(how.channel) || how.mode === "now") return null;
  if (how.channel === "marketplace") {
    return noticeHours(rules.minNoticeHours, rules.leadTimeHours);
  }
  return noticeHours(rules.minNoticeHours, null);
}

/**
 * The minimum rental days that apply: the walk-in value for a "Ride today"
 * booking and for a customer at the counter, the advance value otherwise.
 */
export function minDaysFor(
  rules: BookingRules,
  how: BookingHow,
): number | null {
  return how.mode === "now" || how.channel === "walk_in"
    ? rules.minDaysWalkin
    : rules.minDaysAdvance;
}

/**
 * May a rental from `start` to `end` be booked at `now`, by the rules alone?
 * Stock is not asked here. The first rule that refuses is the answer, in
 * this order: hours and closures, minimum days, notice.
 *
 * - The pickup and the return must each fall inside the location's hours
 *   and on no closure date.
 * - Online channels need the hours to be known: a location that has saved
 *   no opening hours can't be booked online at all ("outside_hours", at
 *   "no_hours"). For staff, no hours saved is no hours rule.
 * - "Ride today" is a Moto Mangos booking for a pickup that is now, give or
 *   take RIDE_TODAY_GRACE_MINUTES: any other pickup answers "not_now". The
 *   location must also be open now, and now must be no later than the
 *   cut-off before closing.
 * - Minimum days are rental days on the location's clock.
 * - An online advance booking's pickup must be at least the notice after
 *   now (so never in the past). Staff, and "Ride today", have no notice.
 *
 * A channel and a mode that don't go together are a programming error and
 * throw: staff channels book in mode "staff" and online channels never do,
 * and mode "now" is Moto Mangos' alone. Without that, any channel could
 * skip its notice by calling itself "Ride today".
 */
export function bookable(
  rules: BookingRules,
  start: Date,
  end: Date,
  how: BookingHow,
  now: Date,
): Bookable {
  if (!(end.getTime() > start.getTime())) {
    throw new RangeError("The return must be after the pickup");
  }

  assertHow(how);

  if (isOnlineChannel(how.channel) && rules.hours.length === 0) {
    return { ok: false, reason: "outside_hours", at: "no_hours" };
  }

  if (how.mode === "now") {
    const grace = RIDE_TODAY_GRACE_MINUTES * MINUTE_MS;
    if (Math.abs(start.getTime() - now.getTime()) > grace) {
      return {
        ok: false,
        reason: "not_now",
        earliest: new Date(now.getTime() - grace),
        latest: new Date(now.getTime() + grace),
      };
    }
    if (!isOpenAt(rules, now)) {
      return { ok: false, reason: "outside_hours", at: "now" };
    }
    const cutoff = cutoffInstant(rules, now);
    if (cutoff && now.getTime() > cutoff.getTime()) {
      return { ok: false, reason: "outside_hours", at: "cutoff" };
    }
  }
  if (!isOpenAt(rules, start)) {
    return { ok: false, reason: "outside_hours", at: "pickup" };
  }
  if (!isOpenAt(rules, end)) {
    return { ok: false, reason: "outside_hours", at: "return" };
  }

  const minDays = minDaysFor(rules, how);
  if (minDays !== null) {
    const days = rentalDays(start, end, { timeZone: rules.timeZone });
    if (days < minDays) {
      return { ok: false, reason: "too_short", days, minDays };
    }
  }

  const notice = noticeFor(rules, how);
  if (notice !== null) {
    const earliestPickup = new Date(now.getTime() + notice * HOUR_MS);
    if (start.getTime() < earliestPickup.getTime()) {
      return { ok: false, reason: "too_soon", earliestPickup };
    }
  }
  return { ok: true };
}

// --------------------------------------------------------------------- offer

/** A location's own rules (platform.booking_inputs › location). */
export type LocationRules = {
  timeZone: string;
  hours: readonly OpeningHours[];
  closures: readonly Closure[];
  minNoticeHours: number | null;
  bookingCutoffMinutes: number | null;
  minDaysAdvance: number | null;
  minDaysWalkin: number | null;
};

/** A product's own rules and its Moto Mangos listing, if it has one. */
export type ProductRules = {
  productId: string;
  type: "vehicle" | "gear" | "sale_item" | "service";
  /** Empty: the location's. */
  minDaysAdvance: number | null;
  minDaysWalkin: number | null;
  listing: (ListingSettings & { leadTimeHours: number | null }) | null;
};

export type OfferInputs = {
  location: LocationRules;
  products: readonly ProductRules[];
};

/** The rules in force for one product at the location. */
export function rulesFor(
  location: LocationRules,
  product: ProductRules,
): BookingRules {
  return {
    timeZone: location.timeZone,
    hours: location.hours,
    closures: location.closures,
    minNoticeHours: location.minNoticeHours,
    leadTimeHours: product.listing?.leadTimeHours ?? null,
    bookingCutoffMinutes: location.bookingCutoffMinutes,
    minDaysAdvance: product.minDaysAdvance ?? location.minDaysAdvance,
    minDaysWalkin: product.minDaysWalkin ?? location.minDaysWalkin,
  };
}

/** One line someone wants to book. */
export type OfferLine = {
  id: string;
  productId: string;
  start: Date;
  end: Date;
  quantity: number;
};

export type OfferRequest = {
  channel: BookingChannel;
  /**
   * For Moto Mangos, "instant" and "request" both ask for an advance
   * booking: the answer says which of the two it would be.
   */
  mode: BookingMode;
  /** The moment the booking is being made. */
  now: Date;
  lines: readonly OfferLine[];
};

/**
 * What the database's availability read answered for one line
 * (platform.availability), in the request's line order.
 */
export type LineAvailability = {
  productId: string;
  /** Units free for the whole window. Null: a service, nothing to count. */
  available: number | null;
  /** The product's listing and the Moto Mangos counts in the window. */
  marketplace: (ListingSettings & ListingPeaks) | null;
};

export type OfferRefusal =
  | BookableReason
  /** Not enough units free for the whole window. */
  | "unavailable"
  /** A Moto Mangos booking of a vehicle whose listing is off or missing. */
  | "not_listed"
  /** The listing's units to offer are all out through Moto Mangos. */
  | "cap_reached"
  /** A product on the booking has no price yet. Never priced as zero. */
  | "cant_be_priced";

export type Offer =
  | {
      ok: true;
      /** How the booking would confirm: the request's mode, or for a Moto
       * Mangos advance booking "instant" or "request" as the listing has it. */
      mode: BookingMode;
      lines: Array<{ id: string; mode: BookingMode; available: number | null }>;
      quote: Extract<Quote, { ok: true }>;
    }
  | {
      ok: false;
      reason: OfferRefusal;
      /** The first line that was refused. */
      lineId: string;
      /** For a bookable() refusal: its detail. */
      bookable?: Exclude<Bookable, { ok: true }>;
      /** For "cant_be_priced": every line that has no price. */
      unpriced?: string[];
    };

function assertSameLines(request: OfferRequest, pricing: QuoteInput): void {
  const fail = (what: string): never => {
    throw new RangeError(`offer(): the lines to price ${what}`);
  };
  if (pricing.lines.length !== request.lines.length)
    fail("are not the request's");
  request.lines.forEach((line, i) => {
    const priced = pricing.lines[i];
    if (
      priced.id !== line.id ||
      priced.productId !== line.productId ||
      priced.quantity !== line.quantity ||
      priced.span.start.getTime() !== line.start.getTime() ||
      priced.span.end.getTime() !== line.end.getTime()
    ) {
      fail(`differ from the request at line ${line.id}`);
    }
  });
}

/**
 * One answer for a booking someone wants to make: may it be booked, is
 * there stock, and what does it cost. In that order, and the price only
 * when the first two pass.
 *
 * `availability` is the database's read for each line, in the same order;
 * `pricing` is quote()'s input for the same lines (same ids, products,
 * quantities and dates: anything else is a programming error and throws).
 *
 * For Moto Mangos (channel "marketplace"), a vehicle needs its listing
 * switched on. An advance booking is counted against the listing's units to
 * offer and takes the mode the listing gives it; "Ride today" uses real
 * availability only and skips the cap (docs/INTEGRATION.md §4.5).
 *
 * This checks nothing under a lock: platform.reserve() has the last word on
 * stock and on the cap.
 */
export function offer(
  inputs: OfferInputs,
  availability: readonly LineAvailability[],
  pricing: QuoteInput,
  request: OfferRequest,
): Offer {
  if (request.lines.length === 0) throw new RangeError("offer(): no lines");
  if (availability.length !== request.lines.length) {
    throw new RangeError("offer(): one availability answer per line");
  }
  assertSameLines(request, pricing);
  const how: BookingHow = { channel: request.channel, mode: request.mode };
  const products = new Map(inputs.products.map((p) => [p.productId, p]));
  const productOf = (line: OfferLine): ProductRules => {
    const product = products.get(line.productId);
    if (!product) {
      throw new RangeError(`offer(): no rules for product ${line.productId}`);
    }
    return product;
  };

  // 1. Bookable, by the rules alone.
  for (const line of request.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError(
        "offer(): a quantity is a whole number of 1 or more",
      );
    }
    const answer = bookable(
      rulesFor(inputs.location, productOf(line)),
      line.start,
      line.end,
      how,
      request.now,
    );
    if (!answer.ok) {
      return {
        ok: false,
        reason: answer.reason,
        lineId: line.id,
        bookable: answer,
      };
    }
  }

  // 2. Available: every line of one product over the same time shares it.
  const lines: Array<{
    id: string;
    mode: BookingMode;
    available: number | null;
  }> = [];
  let mode: BookingMode = request.mode;
  for (const [i, line] of request.lines.entries()) {
    const have = availability[i];
    if (have.productId !== line.productId) {
      throw new RangeError(
        "offer(): availability is not in the request's order",
      );
    }
    const product = productOf(line);
    // What earlier lines of the same product take in an overlapping window.
    const taken = request.lines
      .slice(0, i)
      .filter(
        (other) =>
          other.productId === line.productId &&
          other.start.getTime() < line.end.getTime() &&
          line.start.getTime() < other.end.getTime(),
      )
      .reduce((sum, other) => sum + other.quantity, 0);
    const wanted = taken + line.quantity;
    let lineMode: BookingMode = request.mode;

    if (request.channel === "marketplace" && product.type === "vehicle") {
      const listing = have.marketplace;
      if (!listing || !listing.enabled) {
        return { ok: false, reason: "not_listed", lineId: line.id };
      }
      if (have.available !== null && have.available < wanted) {
        return { ok: false, reason: "unavailable", lineId: line.id };
      }
      if (request.mode !== "now") {
        const answer = listingOfferFromPeaks({
          settings: listing,
          available: have.available ?? Number.MAX_SAFE_INTEGER,
          peaks: listing,
          quantity: wanted,
        });
        if (answer.mode === null) {
          return { ok: false, reason: "cap_reached", lineId: line.id };
        }
        lineMode = answer.mode;
        if (lineMode === "request") mode = "request";
        else if (mode !== "request") mode = "instant";
      }
    } else if (have.available !== null && have.available < wanted) {
      return { ok: false, reason: "unavailable", lineId: line.id };
    }
    lines.push({ id: line.id, mode: lineMode, available: have.available });
  }

  // 3. The price. A product with no price can't be priced: never zero.
  const priced = quote(pricing);
  if (!priced.ok) {
    return {
      ok: false,
      reason: "cant_be_priced",
      lineId: priced.unpriced[0].lineId,
      unpriced: priced.unpriced.map((line) => line.lineId),
    };
  }
  return { ok: true, mode, lines, quote: priced };
}
