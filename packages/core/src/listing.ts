/**
 * A product's Moto Mangos listing (docs/products-redesign.md §2.6, owner
 * decisions 11 and 13 of 13 Nov 2026 and the Stage C answers of 14 Nov 2026).
 * Pure functions: no database, no clock of their own, no time zone.
 *
 * Two rules live here.
 *
 * Lead time. An advance booking's pickup must be at least a number of hours
 * after now: the stricter (longer) of the shop's minimum notice and the
 * listing's own lead time. Either may be missing. It is a plain duration, so
 * it needs no time zone and is not counted in opening hours. Walk-ins
 * ("Ride today") skip it (docs/INTEGRATION.md §4.5).
 *
 * Units to offer. A listing offers `instantUnits + requestUnits` vehicles for
 * advance booking through Moto Mangos: the cap. Only Moto Mangos advance
 * bookings count against it; a walk-in at the counter, a direct booking or a
 * "Ride today" booking uses up real availability but not the cap. So "offer
 * 3 of my 8" means at most 3 out through Moto Mangos at once, and fewer when
 * the shop itself is nearly full:
 *
 *   held    = the most Moto Mangos advance bookings holding a vehicle at any
 *             one moment of the window
 *   offered = min(available, cap − held), never below 0
 *   mode    = instant   if offered > 0 and Instant bookings < instantUnits
 *           = request   else if offered > 0 and Request bookings < requestUnits
 *           = null      otherwise (docs/INTEGRATION.md §4.4)
 *
 * The window and the bookings are given as the periods a vehicle is really
 * busy, buffers included: the platform stores blocks already widened.
 */

const HOUR_MS = 60 * 60 * 1000;

/** How a booking was made on Moto Mangos. "now" is a "Ride today" walk-in. */
export type ListingBookingKind = "instant" | "request" | "now";

/** A Moto Mangos booking that holds a vehicle for [start, end). */
export type ListingBooking = {
  start: Date;
  end: Date;
  kind: ListingBookingKind;
};

export type ListingSettings = {
  /** The on and off switch. */
  enabled: boolean;
  instantUnits: number;
  requestUnits: number;
};

export type ListingOffer = {
  /** Vehicles a new Moto Mangos advance booking could still take. */
  offered: number;
  /** How a new advance booking would confirm, or null if none can be made. */
  mode: "instant" | "request" | null;
  /** The most Moto Mangos advance bookings out at once in the window. */
  held: number;
};

const hoursOrZero = (hours: number | null | undefined): number => {
  if (hours === null || hours === undefined) return 0;
  if (!Number.isFinite(hours) || hours < 0)
    throw new RangeError("Hours of notice can't be negative");
  return hours;
};

/**
 * Hours of notice an advance booking needs: the stricter of the shop's
 * minimum notice and the listing's lead time. A missing one doesn't count;
 * with neither, 0.
 */
export function noticeHours(
  shopNoticeHours: number | null | undefined,
  leadTimeHours: number | null | undefined,
): number {
  return Math.max(hoursOrZero(shopNoticeHours), hoursOrZero(leadTimeHours));
}

/** The earliest pickup an advance booking made at `now` may have. */
export function earliestPickup(
  now: Date,
  shopNoticeHours: number | null | undefined,
  leadTimeHours: number | null | undefined,
): Date {
  return new Date(
    now.getTime() + noticeHours(shopNoticeHours, leadTimeHours) * HOUR_MS,
  );
}

/** False when the pickup is "too soon" (docs/INTEGRATION.md §3.12). */
export function hasEnoughNotice(
  now: Date,
  pickup: Date,
  shopNoticeHours: number | null | undefined,
  leadTimeHours: number | null | undefined,
): boolean {
  return (
    pickup.getTime() >=
    earliestPickup(now, shopNoticeHours, leadTimeHours).getTime()
  );
}

/** Units offered for advance booking through Moto Mangos at most at once. */
export function listingCap(settings: ListingSettings): number {
  return settings.instantUnits + settings.requestUnits;
}

/** The most bookings of each kind holding a vehicle at one moment of [from, to). */
function peaks(bookings: ListingBooking[], from: number, to: number) {
  // The count can only rise at the window's start or where a booking starts.
  const points = new Set<number>([from]);
  for (const b of bookings) {
    const start = b.start.getTime();
    if (start > from && start < to) points.add(start);
  }
  let held = 0;
  let instant = 0;
  let request = 0;
  for (const p of points) {
    let heldAt = 0;
    let instantAt = 0;
    let requestAt = 0;
    for (const b of bookings) {
      if (b.start.getTime() <= p && p < b.end.getTime()) {
        if (b.kind === "instant") instantAt++;
        else if (b.kind === "request") requestAt++;
        else continue; // "Ride today" doesn't count against the cap.
        heldAt++;
      }
    }
    held = Math.max(held, heldAt);
    instant = Math.max(instant, instantAt);
    request = Math.max(request, requestAt);
  }
  return { held, instant, request };
}

/**
 * What a listing offers for a new advance booking over [start, end).
 * `available` is what the shop really has free for the whole window, every
 * booking and block counted (docs/products-redesign.md §2.1). `bookings` are
 * the Moto Mangos bookings on this product that hold a vehicle.
 */
export function listingOffer(input: {
  settings: ListingSettings;
  available: number;
  bookings: ListingBooking[];
  start: Date;
  end: Date;
}): ListingOffer {
  const { settings, bookings, start, end } = input;
  if (end <= start) throw new RangeError("The return must be after the pickup");
  const p = peaks(bookings, start.getTime(), end.getTime());
  if (!settings.enabled) return { offered: 0, mode: null, held: p.held };
  const offered = Math.max(
    0,
    Math.min(input.available, listingCap(settings) - p.held),
  );
  let mode: ListingOffer["mode"] = null;
  if (offered > 0 && p.instant < settings.instantUnits) mode = "instant";
  else if (offered > 0 && p.request < settings.requestUnits) mode = "request";
  return { offered, mode, held: p.held };
}
