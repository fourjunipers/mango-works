import {
  bookable,
  rulesFor,
  type Bookable,
  type BookingChannel,
  type BookingHow,
} from "@mango/core/booking-rules";
import { listingOfferFromPeaks } from "@mango/core/listing";
import {
  lineAvailabilityOf,
  offerInputsOf,
  type AvailabilityRow,
  type BookingInputs,
} from "./booking-inputs";
import { addCalendarDays, dateInZone, fromLocalInput } from "./shop-time";

/**
 * The Price check (route /new-order; Phase 2 stage 11;
 * docs/phase-2-plan.md §7): for a location, a pickup, a return and a
 * channel, each product's free count and, when it can't be booked, why.
 * Pure: the reads (booking_inputs(), availability()) are the page's. Nothing
 * is reserved or held; orders come in Phase 3, which continues this screen.
 *
 * Every rule is @mango/core's: bookable() for the opening hours, closures,
 * minimum days and notice; the counts are availability()'s.
 */

/** The channels the screen can try: the counter, the shop's booking page, Moto Mangos. */
export const priceCheckChannels = [
  "walk_in",
  "booking_page",
  "marketplace",
] as const satisfies readonly BookingChannel[];
export type PriceCheckChannel = (typeof priceCheckChannels)[number];

/**
 * The booking each channel would make: staff book in mode "staff"; an online
 * booking is an advance one ("instant"), so the shop's notice applies to it.
 * "Ride today" and request mode are Moto Mangos' to send (3M).
 */
export function howFor(channel: PriceCheckChannel): BookingHow {
  return channel === "walk_in"
    ? { channel, mode: "staff" }
    : { channel, mode: "instant" };
}

export type PriceCheckAsked = {
  locationId: string;
  pickup: string;
  dropoff: string;
  channel: PriceCheckChannel;
  productId: string | null;
  /** What was typed in the search box: used when no product was picked (no scripts, or Enter). */
  search: string;
};

/** "2026-11-21T10:00" for a calendar day at 10:00. */
const at10 = (date: { year: number; month: number; day: number }) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.year}-${pad(date.month)}-${pad(date.day)}T10:00`;
};

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * The search as asked, or the defaults: the first location, tomorrow at
 * 10:00 to the day after at 10:00 on the location's clock, at the counter.
 */
export function readPriceCheck(
  query: Record<string, string | string[] | undefined>,
  locations: readonly { id: string; timezone: string }[],
  now: Date,
): PriceCheckAsked | null {
  const text = (key: string) => {
    const value = query[key];
    return typeof value === "string" ? value : "";
  };
  const location =
    locations.find((l) => l.id === text("location")) ?? locations[0];
  if (!location) return null;
  const today = dateInZone(now, location.timezone);
  const pickup = LOCAL.test(text("pickup"))
    ? text("pickup")
    : at10(addCalendarDays(today, 1));
  const dropoff = LOCAL.test(text("return"))
    ? text("return")
    : at10(addCalendarDays(today, 2));
  const channel = (priceCheckChannels as readonly string[]).includes(
    text("channel"),
  )
    ? (text("channel") as PriceCheckChannel)
    : "walk_in";
  const product = text("product");
  return {
    locationId: location.id,
    pickup,
    dropoff,
    channel,
    productId: /^[0-9a-f-]{36}$/i.test(product) ? product : null,
    search: text("q").trim().slice(0, 100),
  };
}

/** The span asked, as instants on the location's clock, or why not. */
export function spanOf(
  asked: PriceCheckAsked,
  timeZone: string,
): { start: Date; end: Date } | "invalid" {
  const start = fromLocalInput(asked.pickup, timeZone);
  const end = fromLocalInput(asked.dropoff, timeZone);
  if (!start || !end || !(end.getTime() > start.getTime())) return "invalid";
  return { start, end };
}

/** One product's answer on the screen. */
export type ProductAnswer = {
  productId: string;
  /** Free for these dates; null: a service, nothing to count. */
  available: number | null;
  /** How many the location has; null: a service. */
  stock: number | null;
  /** Why it can't be booked for these dates on this channel, if it can't. */
  refused:
    | Exclude<Bookable, { ok: true }>
    | { ok: false; reason: "none_free"; overbooking: boolean }
    | { ok: false; reason: "not_listed" }
    | { ok: false; reason: "cap_reached" }
    | null;
};

/**
 * Each product's answer, in the order of `rows`. Moto Mangos books only
 * vehicles that are listed there, within the listing's Instant and Request
 * units less what Moto Mangos already holds; staff can save a booking with none free
 * as a shortage when the shop allows overbooking, online channels never.
 */
export function answersFor(
  inputs: BookingInputs,
  rows: readonly AvailabilityRow[],
  span: { start: Date; end: Date },
  channel: PriceCheckChannel,
  now: Date,
): ProductAnswer[] {
  const offer = offerInputsOf(inputs);
  const how = howFor(channel);
  const rules = new Map(offer.products.map((p) => [p.productId, p]));
  return rows.map((row) => {
    const available = row.unlimited ? null : (row.available ?? 0);
    const stock = row.unlimited ? null : (row.stock ?? 0);
    const answer: ProductAnswer = {
      productId: row.product_id,
      available,
      stock,
      refused: null,
    };
    const product = rules.get(row.product_id);
    if (!product) return answer;
    const judged = bookable(
      rulesFor(offer.location, product),
      span.start,
      span.end,
      how,
      now,
    );
    if (!judged.ok) return { ...answer, refused: judged };
    if (
      channel === "marketplace" &&
      row.type === "vehicle" &&
      !row.marketplace?.enabled
    )
      return { ...answer, refused: { ok: false, reason: "not_listed" } };
    if (available !== null && available < 1)
      return {
        ...answer,
        refused: {
          ok: false,
          reason: "none_free",
          overbooking: channel === "walk_in" && inputs.shop.allow_overbooking,
        },
      };
    // Moto Mangos books a vehicle only within its listing's Instant and
    // Request units, less what Moto Mangos already holds over these dates:
    // the same check offer() makes (listingOfferFromPeaks, @mango/core).
    if (channel === "marketplace" && row.type === "vehicle") {
      const listing = lineAvailabilityOf([row])[0].marketplace!;
      const offer = listingOfferFromPeaks({
        settings: listing,
        available: available ?? Number.MAX_SAFE_INTEGER,
        peaks: listing,
        quantity: 1,
      });
      if (offer.mode === null)
        return { ...answer, refused: { ok: false, reason: "cap_reached" } };
    }
    return answer;
  });
}

/** A product as the search box offers it: its name, and what it is in words ("Motorbike · Scooter"). */
export type PriceCheckOption = { id: string; name: string; what: string };

const byName = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const fold = (text: string) => text.normalize("NFKC").toLocaleLowerCase();

/**
 * The products matching what was typed, best first, at most `max`: every
 * word typed must be in the name or in what it is (kind, category). A name
 * that starts with the text comes first, then a name with a word that starts
 * with it, then a name that holds it, then a match on the kind or category
 * alone; A to Z within each. Nothing typed matches nothing.
 */
export function matchOptions<T extends PriceCheckOption>(
  options: readonly T[],
  typed: string,
  max = 8,
): T[] {
  const query = fold(typed).trim().replace(/\s+/g, " ");
  if (!query) return [];
  const words = query.split(" ");
  const rank = (option: T) => {
    const name = fold(option.name);
    if (name.startsWith(query)) return 0;
    if (name.split(/\s+/).some((word) => word.startsWith(words[0]))) return 1;
    if (name.includes(query)) return 2;
    return 3;
  };
  return options
    .filter((option) => {
      const text = `${fold(option.name)} ${fold(option.what)}`;
      return words.every((word) => text.includes(word));
    })
    .map((option) => ({ option, rank: rank(option) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        byName.compare(a.option.name, b.option.name) ||
        a.option.id.localeCompare(b.option.id),
    )
    .slice(0, max)
    .map(({ option }) => option);
}

/** How many recent searches are kept as quick chips. */
export const RECENT_MAX = 5;

/** The recent products after `id` was looked at: it goes first, once. */
export function recentAfter(
  recent: readonly string[],
  id: string,
  max = RECENT_MAX,
): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}

/** A stored list of recent products, kept only if it is one: ids, at most RECENT_MAX. */
export function readRecent(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const value: unknown = JSON.parse(stored);
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v),
      )
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}
