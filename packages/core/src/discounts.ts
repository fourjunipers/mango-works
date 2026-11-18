/**
 * Which discounts an invoice gets (docs/phase-2-plan.md §2.4 and §5.3). Pure:
 * no database and no clock of its own. Everything it needs is passed in.
 *
 * `decideDiscounts()` answers the ordered list to hand to `quote()`, or why
 * a coupon code was refused. It never works a price out itself: where it
 * needs one (a minimum spend, a season discount on a line, "the larger of
 * the two") it calls `quote()`, which stays the only pricer. The only thing
 * done to money here is adding and comparing.
 *
 * The order it fixes (§5.3), each taken on what the one before left:
 *
 *   5.  seasons                       inside quote()
 *   6a. returning-customer discount   rental lines only
 *   6b. the coupon                    its own lines only; one per booking
 *   6c. staff and any other discount  always last, never blocked
 *   7.  VAT on what is left
 *   8.  the deposit, beside the price: no discount is ever set against it
 */

import type { BookingChannel } from "./booking-rules";
import {
  quote,
  QuoteError,
  type Discount,
  type Quote,
  type QuoteInput,
  type QuoteLineInput,
  type QuotedLine,
} from "./quote";
import type { SnapshotProductType } from "./quote-snapshot";
import { rentalDays } from "./rental-days";
import { zonedDateString } from "./zoned";

const ZERO = BigInt(0);

// ----------------------------------------------------------------- settings

/** The channels a coupon can be switched on for (coupons.channels). */
export type CouponChannel = "staff" | "booking_page" | "marketplace";

/** A coupon as the shop saved it (platform.coupons, built in stage 8). */
export type CouponSettings = {
  id: string;
  code: string;
  /** ISO 4217. A coupon belongs to the shop's currency. */
  currency: string;
  kind: "percent" | "fixed";
  /** 1 to 10000, for a percentage coupon. */
  percentBp: number | null;
  /** Minor units, more than 0, for a fixed coupon: off its lines together. */
  amount: bigint | null;
  /** True: every product. False: the products in `productIds`. */
  allProducts: boolean;
  productIds: readonly string[];
  /**
   * Calendar days at the location, both included ("YYYY-MM-DD"): when the
   * booking is made. Either may be empty.
   */
  validFrom: string | null;
  validTo: string | null;
  /** Calendar days at the location, both included: the rental must start here. */
  pickupFrom: string | null;
  pickupTo: string | null;
  /** Rental days on the location's clock. */
  minDays: number | null;
  /** Minor units: what the coupon's own lines must come to after seasons. */
  minSpend: bigint | null;
  /** Uses in total, and by one customer. */
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  channels: readonly CouponChannel[];
  /** May be combined with the returning-customer discount. */
  withReturningDiscount: boolean;
  /**
   * "Can be used on season discounts" (Mark, 18 Nov 2026). False: a line a
   * season made cheaper is not one of the coupon's lines. A season that
   * raised the price never rules a line out.
   */
  withSeasonDiscount: boolean;
  active: boolean;
  archived: boolean;
};

/** Uses not given back, counted before this booking. */
export type CouponUses = { total: number; customer: number };

/** The automatic discount's three settings (platform.pricing_settings). */
export type ReturningCustomerSettings = {
  enabled: boolean;
  /** 1 to 10000. */
  percentBp: number;
  /** Completed rentals at this shop that make a customer "returning". */
  completedRentalsNeeded: number;
};

export type CouponRefusal =
  /** No coupon has this code. */
  | "unknown"
  /** Switched off, or archived. */
  | "not_active"
  /** Today is before its first valid day, or after its last. */
  | "too_early"
  | "expired"
  /** No line of its products starts inside its pickup dates. */
  | "wrong_dates"
  /** No such line is long enough. */
  | "too_short"
  /** Its lines come to less than its minimum spend. */
  | "below_minimum"
  /**
   * None of its products is in the booking, or every line of them was made
   * cheaper by a season and the coupon can't be used on season discounts.
   */
  | "not_these_products"
  | "wrong_channel"
  | "used_up"
  | "customer_used_up"
  /** The shop's "Accept coupons" switch is off. */
  | "coupons_off";

// ------------------------------------------------------------------ request

export type DiscountRequest = {
  /**
   * The invoice to price, with no coupon and no returning-customer discount
   * in it. Its `couponsEnabled` is the shop's "Accept coupons" switch. Its
   * `discounts` are the staff's (and any other): they are kept, in order,
   * after the two decided here.
   */
  quote: QuoteInput;
  /** By line id: what each line's product is. */
  productTypes: Readonly<Record<string, SnapshotProductType>>;
  /** The shop's currency (ISO 4217). */
  currency: string;
  /** The moment the booking is made. */
  now: Date;
  /** The location's IANA time zone: "today" is the day on its clock. */
  timeZone: string;
  channel: BookingChannel;
  /**
   * The code the customer gave, and the coupon it found (`found: null` when
   * the shop has no coupon with that code). Empty: no code was given.
   */
  coupon?: {
    code: string;
    found: { settings: CouponSettings; uses: CouponUses } | null;
  } | null;
  /** Empty: the shop has never saved the settings, which is "off". */
  returningCustomer?: ReturningCustomerSettings | null;
  /**
   * Rentals this customer has completed at this shop. An input: there is no
   * customer table until Phase 3 (§2.5). 0 for a customer nobody knows.
   */
  completedRentals: number;
};

/** The id of the returning-customer discount in the list for `quote()`. */
export const RETURNING_DISCOUNT_ID = "returning_customer";

/** The id of a coupon's discount in the list for `quote()`. */
export const couponDiscountId = (couponId: string) => `coupon:${couponId}`;

export type CouponOutcome =
  | {
      applied: true;
      couponId: string;
      code: string;
      discountId: string;
      /** The lines it is taken on. */
      lineIds: string[];
    }
  /**
   * The code is good and nothing is used up: no redemption is written.
   *
   * "returning_discount_is_better": it can't be combined with the
   * returning-customer discount, and that one leaves the customer paying no
   * more (or the coupon's way can't be priced: a credit is larger than what
   * it would leave).
   *
   * "takes_nothing": its lines already come to nothing, so it would take 0
   * (Mark, 18 Nov 2026). It is not in the discounts.
   */
  | {
      applied: false;
      because: "returning_discount_is_better" | "takes_nothing";
      couponId: string;
      code: string;
    };

export type DiscountDecision =
  | {
      outcome: "decided";
      /** In order, ready for `quote()`. */
      discounts: Discount[];
      /** True when the returning-customer discount is in the list. */
      returningCustomer: boolean;
      /** Null: no code was given. */
      coupon: CouponOutcome | null;
      /** For `snapshotQuote`'s context: the coupon's id and code, by discount id. */
      coupons: Record<string, { couponId: string; code: string }>;
    }
  | {
      outcome: "refused";
      reason: CouponRefusal;
      /** What still applies without the code, in order, ready for `quote()`. */
      discounts: Discount[];
      returningCustomer: boolean;
    }
  /** A line has no price yet, so the coupon can't be judged. As `quote()` says it. */
  | {
      outcome: "cant_price";
      unpriced: Array<{ lineId: string; reason: "no_price" }>;
    };

// ---------------------------------------------------------------- the pieces

/**
 * A code as it is stored and compared (§11). Two steps, and nothing else:
 *
 *   1. every space and invisible character in REMOVED is taken out;
 *   2. the 26 letters a to z become A to Z.
 *
 * No other character is changed: no Unicode case mapping (a sharp s stays
 * as it is, it does not become SS) and no folding of full-width letters. So
 * the answer does not depend on a locale, and the database's
 * platform_private.normalize_coupon_code() gives the same one, character
 * for character. The two are held together by coupon-code.cases.ts: a unit
 * test runs the cases here and a database test runs them there.
 *
 * A code is saved only when it is A to Z and 0 to 9 after this
 * (isCouponCode), so one typed with any other character finds no coupon.
 */
export function normalizeCouponCode(code: string): string {
  let out = "";
  for (const character of code) {
    if (REMOVED.includes(character)) continue;
    const letter = LOWER.indexOf(character);
    out += letter < 0 ? character : UPPER[letter];
  }
  return out;
}

/** True for a code that can be saved: A to Z and 0 to 9, 1 to 40 of them. */
export function isCouponCode(normalized: string): boolean {
  return CODE.test(normalized);
}

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/**
 * Tab, line feed, vertical tab, form feed, carriage return, space, no-break
 * space, U+1680, U+2000 to U+200A, line and paragraph separator, U+202F,
 * U+205F, the ideographic space, the byte order mark, and the zero-width
 * space, non-joiner, joiner and word joiner. The same list as the
 * database's function.
 */
const REMOVED =
  "\u0009\u000a\u000b\u000c\u000d   " + "           " + "    　﻿​‌‍⁠";

// Patterns are built from strings so this file holds no "/" or "*" outside
// comments and strings: discounts.test.ts fails on any money arithmetic here.
const CODE = new RegExp("^[A-Z0-9]{1,40}$");
const DAY = new RegExp("^\\d{4}-\\d{2}-\\d{2}$");

/**
 * The coupon channel a booking's channel counts as. Staff covers the counter
 * and the phone. `api` has no coupon channel of its own yet, so no coupon is
 * accepted there.
 */
export function couponChannelFor(
  channel: BookingChannel,
): CouponChannel | null {
  switch (channel) {
    case "walk_in":
    case "phone":
      return "staff";
    case "booking_page":
      return "booking_page";
    case "marketplace":
      return "marketplace";
    case "api":
      return null;
  }
}

function assertDay(day: string | null, what: string): void {
  if (day === null) return;
  // A day that is not on the calendar (30 Feb) does not read back as itself.
  const time = DAY.test(day) ? Date.parse(`${day}T00:00:00.000Z`) : NaN;
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw new RangeError(`${what} must be a real date, YYYY-MM-DD: ${day}`);
  }
}

function assertCount(value: number | null, min: number, what: string): void {
  if (value === null) return;
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${what} must be a whole number ≥ ${min}: ${value}`);
  }
}

function assertBp(value: number | null, what: string): asserts value is number {
  if (
    value === null ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 10000
  ) {
    throw new RangeError(`${what} must be 1 to 10000 basis points: ${value}`);
  }
}

/** A coupon that could not have been saved is a programming error. */
function assertCoupon(coupon: CouponSettings, currency: string): void {
  if (coupon.currency !== currency) {
    throw new RangeError(
      `Coupon ${coupon.id} is in ${coupon.currency}, the shop in ${currency}`,
    );
  }
  if (coupon.kind === "percent") {
    assertBp(coupon.percentBp, `Coupon ${coupon.id}: the percentage`);
  } else if (typeof coupon.amount !== "bigint" || coupon.amount <= ZERO) {
    throw new RangeError(`Coupon ${coupon.id}: the amount must be more than 0`);
  }
  assertDay(coupon.validFrom, "valid_from");
  assertDay(coupon.validTo, "valid_to");
  assertDay(coupon.pickupFrom, "pickup_from");
  assertDay(coupon.pickupTo, "pickup_to");
  assertCount(coupon.minDays, 1, "min_days");
  assertCount(coupon.maxUses, 1, "max_uses");
  assertCount(coupon.maxUsesPerCustomer, 1, "max_uses_per_customer");
  if (
    coupon.minSpend !== null &&
    (typeof coupon.minSpend !== "bigint" || coupon.minSpend <= ZERO)
  ) {
    throw new RangeError(`Coupon ${coupon.id}: min_spend must be more than 0`);
  }
}

/**
 * A rental line (Q8): a vehicle or gear, priced by time. An item for sale, a
 * service, and anything at a fixed price or free is not one. "Priced by
 * time" is the same test the season step uses.
 */
export function isRentalLine(
  line: QuoteLineInput,
  productType: SnapshotProductType,
): boolean {
  if (productType !== "vehicle" && productType !== "gear") return false;
  const method = line.pricing?.method;
  return method === "tiered" || method === "per_period";
}

/**
 * The returning-customer discount, or null when it does not apply: switched
 * off, too few completed rentals, or no rental line to take it on. The
 * coupons switch does not stop it.
 */
export function returningCustomerDiscount(
  request: Pick<
    DiscountRequest,
    "quote" | "productTypes" | "returningCustomer" | "completedRentals"
  >,
): Discount | null {
  const settings = request.returningCustomer;
  assertCount(request.completedRentals, 0, "Completed rentals");
  if (!settings || !settings.enabled) return null;
  assertBp(settings.percentBp, "The returning-customer percentage");
  assertCount(settings.completedRentalsNeeded, 1, "Completed rentals needed");
  if (request.completedRentals < settings.completedRentalsNeeded) return null;
  const lines = request.quote.lines
    .filter((line) => isRentalLine(line, typeOf(request.productTypes, line)))
    .map((line) => line.id);
  if (lines.length === 0) return null;
  return {
    id: RETURNING_DISCOUNT_ID,
    source: "returning_customer",
    lines,
    percentBp: settings.percentBp,
  };
}

function typeOf(
  productTypes: DiscountRequest["productTypes"],
  line: QuoteLineInput,
): SnapshotProductType {
  if (!Object.hasOwn(productTypes, line.id)) {
    throw new RangeError(`Line ${line.id}: its product type is not given`);
  }
  return productTypes[line.id];
}

const inRange = (day: string, from: string | null, to: string | null) =>
  (from === null || day >= from) && (to === null || day <= to);

/**
 * The lines a coupon is taken on, or why there are none. A line is the
 * coupon's when its product is one of the coupon's, no season made it
 * cheaper (unless the coupon allows that), it starts inside the pickup
 * dates and it is long enough. Each is judged line by line, so a coupon
 * for chosen scooters does not reduce the helmets beside them.
 *
 * `priced` is the invoice priced with no discount, in the lines' order.
 * `down` holds the ids of the season rules that lower a price. A season
 * discount is judged by its rule, not by the amount it came to: 1% off a
 * ¥40 helmet rounds to ¥0 and is still a season discount.
 */
function couponLines(
  coupon: CouponSettings,
  lines: readonly QuoteLineInput[],
  priced: readonly QuotedLine[],
  down: ReadonlySet<string>,
): { ok: true; lines: QuotedLine[] } | { ok: false; reason: CouponRefusal } {
  let left = lines.map((line, index) => ({ line, priced: priced[index] }));

  left = left.filter(
    ({ line, priced: p }) =>
      (coupon.allProducts || coupon.productIds.includes(line.productId)) &&
      (coupon.withSeasonDiscount || !p.seasons.some((s) => down.has(s.ruleId))),
  );
  if (left.length === 0) return { ok: false, reason: "not_these_products" };

  left = left.filter(({ line }) =>
    inRange(
      zonedDateString(line.span.start, line.span.timeZone),
      coupon.pickupFrom,
      coupon.pickupTo,
    ),
  );
  if (left.length === 0) return { ok: false, reason: "wrong_dates" };

  const minDays = coupon.minDays;
  if (minDays !== null) {
    left = left.filter(
      ({ line }) =>
        rentalDays(line.span.start, line.span.end, {
          timeZone: line.span.timeZone,
          rules: line.span.rules,
        }) >= minDays,
    );
    if (left.length === 0) return { ok: false, reason: "too_short" };
  }

  if (coupon.minSpend !== null) {
    // After seasons, before any discount: adding only.
    const spend = left.reduce(
      (sum, each) => sum + each.priced.seasonPrice,
      ZERO,
    );
    if (spend < coupon.minSpend) return { ok: false, reason: "below_minimum" };
  }
  return { ok: true, lines: left.map((each) => each.priced) };
}

// ---------------------------------------------------------- decideDiscounts

/**
 * The discounts for one invoice, in the order `quote()` must apply them, or
 * why the code was refused. The first rule that refuses is the answer, in
 * this order: the switch, the code, active, channel, valid dates, uses,
 * products (and season discounts), pickup dates, minimum days, minimum spend.
 *
 * A refusal still carries the discounts that apply without the code, so a
 * screen can say why and show the price.
 */
export function decideDiscounts(request: DiscountRequest): DiscountDecision {
  const base = request.quote;
  const given = [...(base.discounts ?? [])];
  for (const discount of given) {
    // One coupon per booking, and both of these are decided here.
    if (
      discount.source === "coupon" ||
      discount.source === "returning_customer"
    ) {
      throw new RangeError(
        `Discount ${discount.id}: a ${discount.source} discount is decided here, not passed in`,
      );
    }
  }

  const returning = returningCustomerDiscount(request);
  const without = returning ? [returning, ...given] : given;
  const unique = (discounts: Discount[]) => {
    const ids = new Set(discounts.map((discount) => discount.id));
    if (ids.size !== discounts.length) {
      throw new RangeError("Two discounts share an id");
    }
    return discounts;
  };
  unique(without);

  const asked = request.coupon;
  if (!asked) {
    return {
      outcome: "decided",
      discounts: without,
      returningCustomer: returning !== null,
      coupon: null,
      coupons: {},
    };
  }
  const refused = (reason: CouponRefusal): DiscountDecision => ({
    outcome: "refused",
    reason,
    discounts: without,
    returningCustomer: returning !== null,
  });

  // Off: no code is accepted on any channel, whatever the code is.
  if (!base.couponsEnabled) return refused("coupons_off");

  const found = asked.found;
  if (
    !found ||
    normalizeCouponCode(found.settings.code) !== normalizeCouponCode(asked.code)
  ) {
    return refused("unknown");
  }
  const { settings: coupon, uses } = found;
  assertCoupon(coupon, request.currency);
  assertCount(uses.total, 0, "Uses in total");
  assertCount(uses.customer, 0, "The customer's uses");

  if (!coupon.active || coupon.archived) return refused("not_active");

  const channel = couponChannelFor(request.channel);
  if (channel === null || !coupon.channels.includes(channel)) {
    return refused("wrong_channel");
  }

  // "Valid" is the day the booking is made, on the location's clock.
  const today = zonedDateString(request.now, request.timeZone);
  if (coupon.validFrom !== null && today < coupon.validFrom) {
    return refused("too_early");
  }
  if (coupon.validTo !== null && today > coupon.validTo)
    return refused("expired");

  if (coupon.maxUses !== null && uses.total >= coupon.maxUses) {
    return refused("used_up");
  }
  if (
    coupon.maxUsesPerCustomer !== null &&
    uses.customer >= coupon.maxUsesPerCustomer
  ) {
    return refused("customer_used_up");
  }

  // The lines' prices after seasons, from the pricer, with no discount.
  const plain = quote({ ...base, discounts: [] });
  if (!plain.ok) return { outcome: "cant_price", unpriced: plain.unpriced };

  const down = new Set(
    (base.seasonRules ?? [])
      .filter((rule) => rule.adjustBp < 0)
      .map((rule) => rule.id),
  );
  const eligible = couponLines(coupon, base.lines, plain.lines, down);
  if (!eligible.ok) return refused(eligible.reason);

  const discountId = couponDiscountId(coupon.id);
  const lineIds = eligible.lines.map((line) => line.id);
  const couponDiscount: Discount =
    coupon.kind === "percent"
      ? {
          id: discountId,
          source: "coupon",
          lines: lineIds,
          percentBp: coupon.percentBp!,
        }
      : {
          id: discountId,
          source: "coupon",
          lines: lineIds,
          amount: coupon.amount!,
        };
  const code = normalizeCouponCode(coupon.code);
  const applied = (
    discounts: Discount[],
    withReturning: boolean,
  ): DiscountDecision => ({
    outcome: "decided",
    discounts: unique(discounts),
    returningCustomer: withReturning,
    coupon: { applied: true, couponId: coupon.id, code, discountId, lineIds },
    coupons: { [discountId]: { couponId: coupon.id, code } },
  });
  /** The code is good and is not used: the coupon is not in `discounts`. */
  const notApplied = (
    because: Extract<CouponOutcome, { applied: false }>["because"],
    discounts: Discount[],
    withReturning: boolean,
  ): DiscountDecision => ({
    outcome: "decided",
    discounts,
    returningCustomer: withReturning,
    coupon: { applied: false, because, couponId: coupon.id, code },
    coupons: {},
  });
  /** What the coupon took over all its lines: adding only. */
  const taken = (priced: Extract<Quote, { ok: true }>) =>
    priced.lines.reduce(
      (sum, line) =>
        line.discounts
          .filter((each) => each.discountId === discountId)
          .reduce((lineSum, each) => lineSum + each.amount, sum),
      ZERO,
    );
  const price = (discounts: Discount[]) => {
    const priced = quote({ ...base, discounts });
    if (!priced.ok) {
      throw new RangeError("An invoice that was priced can't be priced");
    }
    return priced;
  };

  if (!returning || coupon.withReturningDiscount) {
    const withCoupon = returning
      ? [returning, couponDiscount, ...given]
      : [couponDiscount, ...given];
    // A coupon that takes 0 is not applied and uses no use (Mark, 18 Nov
    // 2026): its lines are free, or the returning discount took them all.
    return taken(price(withCoupon)) === ZERO
      ? notApplied("takes_nothing", without, returning !== null)
      : applied(withCoupon, returning !== null);
  }

  // They don't stack: the customer gets the one that leaves less to pay
  // (Q7), found by pricing the invoice both ways. The same to pay: the
  // returning-customer discount, so the coupon is not used up.
  //
  // One way may be impossible: a credit carried to this invoice is larger
  // than what that discount would leave in its rate group, which the pricer
  // refuses. That way is then not on offer and the customer gets the other.
  // Both impossible is the caller's error, as `quote()` would say it.
  const option = (discounts: Discount[]) => {
    try {
      return { priced: price(discounts), error: null };
    } catch (error) {
      if (error instanceof QuoteError && error.code === "credit_exceeds_base") {
        return { priced: null, error };
      }
      throw error;
    }
  };
  const withCoupon = [couponDiscount, ...given];
  const byReturning = option(without);
  const byCoupon = option(withCoupon);
  if (!byCoupon.priced) {
    if (!byReturning.priced) throw byCoupon.error;
    return notApplied("returning_discount_is_better", without, true);
  }
  if (!byReturning.priced) {
    return taken(byCoupon.priced) === ZERO
      ? notApplied("takes_nothing", given, false)
      : applied(withCoupon, false);
  }
  // Paying less with the coupon means the coupon took something.
  return byCoupon.priced.totals.total < byReturning.priced.totals.total
    ? applied(withCoupon, false)
    : notApplied("returning_discount_is_better", without, true);
}
