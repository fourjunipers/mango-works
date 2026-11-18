/**
 * From the database to decideDiscounts() and on to reserve()
 * (docs/phase-2-plan.md §2.4, §5.3).
 *
 * platform.coupon_inputs() returns what is known about one code as rows:
 * the coupon it finds, its product ids and its uses so far. This file turns
 * those rows into decideDiscounts()'s input, hands quote() the discounts it
 * decided, and reads back from the quote what the coupon took, for
 * reserve() to store with the booking. It works no price out: every amount
 * here is one quote() gave, added up and nothing else.
 *
 * The one feed for both booking paths (lib/book-online.ts and
 * lib/staff-booking.ts) and, from stage 9, "Check a price". Pure functions
 * but for readCoupon(), whose database call is the caller's client.
 */

import {
  decideDiscounts,
  normalizeCouponCode,
  type CouponChannel,
  type CouponOutcome,
  type CouponSettings,
  type CouponUses,
  type DiscountDecision,
  type ReturningCustomerSettings,
} from "@mango/core/discounts";
import type { BookingChannel } from "@mango/core/booking-rules";
import type { Quote, QuoteInput } from "@mango/core/quote";
import { minorUnits, type PricingInputs } from "./pricing-inputs";

/** platform.coupon_inputs() as it arrives: amounts are strings of digits. */
export type CouponInputs = {
  /** Null: the shop has no coupon with that code, or the caller may not see coupons. */
  coupon: CouponRow | null;
  /** Uses not given back. Null with no coupon. */
  uses: { total: number; customer: number } | null;
};

export type CouponRow = {
  id: string;
  /** As stored: A to Z and 0 to 9. */
  code: string;
  name: string;
  currency: string;
  kind: "percent" | "fixed";
  percent_bp: number | null;
  amount: string | null;
  all_products: boolean;
  product_ids: string[];
  valid_from: string | null;
  valid_to: string | null;
  pickup_from: string | null;
  pickup_to: string | null;
  min_days: number | null;
  min_spend: string | null;
  max_uses: number | null;
  max_uses_per_customer: number | null;
  channels: CouponChannel[];
  with_returning_discount: boolean;
  with_season_discount: boolean;
  active: boolean;
  /** True for an archived coupon: the read still finds it, as "not active". */
  archived: boolean;
};

/** A client on the platform schema: a signed-in member's, or the server's. */
export type CouponDb = {
  rpc(
    fn: "coupon_inputs",
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

/**
 * True when a code was given at all: something is left of it once spaces
 * and invisible characters are gone. An empty box is not a refused code.
 */
export function codeGiven(code: string | null | undefined): code is string {
  return typeof code === "string" && normalizeCouponCode(code) !== "";
}

/**
 * What the database knows about a code. `bookingId`: a held booking being
 * priced again, whose own use is then left out of the count. `customerId`:
 * whose uses to count beside the total (nobody's until Phase 3).
 */
export async function readCoupon(
  db: CouponDb,
  tenantId: string,
  code: string,
  more: { bookingId?: string | null; customerId?: string | null } = {},
): Promise<CouponInputs> {
  const { data, error } = await db.rpc("coupon_inputs", {
    p_tenant_id: tenantId,
    p_code: code,
    p_booking_id: more.bookingId ?? null,
    p_customer_id: more.customerId ?? null,
  });
  if (error)
    throw Object.assign(new Error(error.message), { code: error.code });
  return data as CouponInputs;
}

/** The coupon found and its uses, for decideDiscounts(). Null: no such code. */
export function couponFoundOf(
  read: CouponInputs | null,
): { settings: CouponSettings; uses: CouponUses } | null {
  const row = read?.coupon;
  if (!row) return null;
  return {
    settings: {
      id: row.id,
      code: row.code,
      currency: row.currency,
      kind: row.kind,
      percentBp: row.percent_bp,
      amount: minorUnits(row.amount),
      allProducts: row.all_products,
      productIds: row.product_ids,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      pickupFrom: row.pickup_from,
      pickupTo: row.pickup_to,
      minDays: row.min_days,
      minSpend: minorUnits(row.min_spend),
      maxUses: row.max_uses,
      maxUsesPerCustomer: row.max_uses_per_customer,
      channels: row.channels,
      withReturningDiscount: row.with_returning_discount,
      withSeasonDiscount: row.with_season_discount,
      active: row.active,
      archived: row.archived,
    },
    uses: {
      total: read?.uses?.total ?? 0,
      customer: read?.uses?.customer ?? 0,
    },
  };
}

/**
 * The automatic discount's settings (platform.pricing_settings, through
 * pricing_inputs()). Null: never saved, or the caller may not see prices,
 * which decideDiscounts() reads as "off".
 */
export function returningCustomerOf(
  settings: PricingInputs["settings"],
): ReturningCustomerSettings | null {
  if (!settings || settings.returning_percent_bp == null) return null;
  return {
    enabled: settings.returning_enabled ?? false,
    percentBp: settings.returning_percent_bp,
    completedRentalsNeeded: settings.returning_rentals_needed ?? 1,
  };
}

export type DiscountsAsked = {
  pricing: PricingInputs;
  /** The invoice, from quoteInputFor(): its discounts are the staff's. */
  quote: QuoteInput;
  /** The moment the booking is made, and the location's time zone. */
  now: Date;
  timeZone: string;
  channel: BookingChannel;
  /** The code as typed. Empty: none was given. */
  code?: string | null;
  /** What readCoupon() answered for that code. */
  coupon?: CouponInputs | null;
  /** Rentals this customer has completed here. Nobody's until Phase 3. */
  completedRentals?: number;
};

export type DiscountsDecided = {
  decision: DiscountDecision;
  /**
   * The invoice with the decided discounts in order, for quote(): the
   * returning-customer discount, the coupon, then the staff's. With a
   * refused code it is priced with what still applies; with a line that
   * has no price it is as it came, and quote() says which line.
   */
  quote: QuoteInput;
};

/**
 * Asks decideDiscounts() which discounts this invoice gets and puts them
 * on it. The only place in the app that builds its request, so a staff
 * booking, an online booking and a price check are all judged the same way.
 */
export function decideFor(asked: DiscountsAsked): DiscountsDecided {
  const types = new Map(
    asked.pricing.products.map((row) => [row.product_id, row.product_type]),
  );
  const found = couponFoundOf(asked.coupon ?? null);
  const decision = decideDiscounts({
    quote: asked.quote,
    productTypes: Object.fromEntries(
      asked.quote.lines.flatMap((line) => {
        const type = types.get(line.productId);
        return type ? [[line.id, type] as const] : [];
      }),
    ),
    currency:
      asked.pricing.settings?.currency ?? found?.settings.currency ?? "",
    now: asked.now,
    timeZone: asked.timeZone,
    channel: asked.channel,
    coupon: codeGiven(asked.code) ? { code: asked.code, found } : null,
    returningCustomer: returningCustomerOf(asked.pricing.settings),
    completedRentals: asked.completedRentals ?? 0,
  });
  return {
    decision,
    quote:
      decision.outcome === "cant_price"
        ? asked.quote
        : { ...asked.quote, discounts: decision.discounts },
  };
}

/** The coupon's outcome, when a code was given and judged. */
export function couponOutcomeOf(
  decision: DiscountDecision,
): CouponOutcome | null {
  return decision.outcome === "decided" ? decision.coupon : null;
}

/** What reserve() takes as "coupon": the use to count and write. */
export type CouponUse = {
  couponId: string;
  /** What the quote says the coupon took, in minor units. */
  amount: bigint;
  customerId?: string | null;
};

/**
 * The use to hand reserve(), or null when there is none to write: no code,
 * or a coupon that was not applied (the returning-customer discount was
 * better, or it would take nothing). The amount is read from the quote's
 * lines by the coupon's discount id and added up; nothing else.
 */
export function couponUseOf(
  decision: DiscountDecision,
  priced: Extract<Quote, { ok: true }>,
  customerId?: string | null,
): CouponUse | null {
  const coupon = couponOutcomeOf(decision);
  if (!coupon || !coupon.applied) return null;
  let amount = BigInt(0);
  for (const line of priced.lines) {
    for (const taken of line.discounts) {
      if (taken.discountId === coupon.discountId) amount += taken.amount;
    }
  }
  return {
    couponId: coupon.couponId,
    amount,
    ...(customerId ? { customerId } : {}),
  };
}

/** The use as reserve()'s request carries it: the amount a string of digits. */
export function couponRequestOf(use: CouponUse) {
  return {
    coupon_id: use.couponId,
    amount: use.amount.toString(),
    ...(use.customerId ? { customer_id: use.customerId } : {}),
  };
}
