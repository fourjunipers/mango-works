/**
 * "Check a price" on the Pricing tab (docs/products-redesign.md §9.12), and
 * the Products list's price column. Pure.
 *
 * The preview prices what is on the form, saved or not, so the owner sees
 * what a change would do before saving it. It builds the same row
 * platform.pricing_inputs() returns and sends it through the same adapter
 * (lib/pricing-inputs.ts) to quote() in @mango/core: there is no other way a
 * price is worked out.
 */

import type { BookingChannel } from "@mango/core/booking-rules";
import { quote, type Quote } from "@mango/core/quote";
import {
  RETURNING_DISCOUNT_ID,
  type DiscountDecision,
} from "@mango/core/discounts";
import { decideFor, type CouponInputs } from "./coupons";
import { parseMinorUnits } from "./money";
import { addCalendarDays, fromLocalInput } from "./shop-time";
import {
  computeList,
  type PricingContext,
  type PricingDraft,
} from "./pricing-form";
import {
  listOf,
  quoteInputFor,
  type PricingInputs,
  type ProductPricingRow,
} from "./pricing-inputs";

/** A shared list as the form knows it (values are strings of digits). */
export type SharedList = {
  id: string;
  name: string;
  kind: "amounts" | "multipliers";
  hourly: string | null;
  days: string[];
};

export type TaxProfile = { id: string; name: string; rate_bp: number };

const digits = (text: string, currency: string): string | null => {
  const value = parseMinorUnits(text, currency);
  return value === null || value === "invalid" || value === BigInt(0)
    ? null
    : String(value);
};

/**
 * The row pricing_inputs() would return for this product once the form is
 * saved. Null when the form can't be priced yet (a box missing, a list that
 * falls, no amount).
 */
export function draftRow(
  productId: string,
  draft: PricingDraft,
  ctx: PricingContext,
  shared: readonly SharedList[],
  tax: { profiles: readonly TaxProfile[]; defaultId: string | null },
): ProductPricingRow | null {
  const base: Omit<ProductPricingRow, "pricing_method" | "template"> = {
    product_id: productId,
    // A draft is priced, never snapshotted: the name is not needed here.
    product_name: "",
    product_type: ctx.type,
    currency: ctx.currency,
    price_amount: null,
    price_period: null,
    base_amount: null,
    long_stay_day: null,
    deposit: ctx.showDeposit ? draftDeposit(draft.deposit, ctx.currency) : null,
    replacement_price: null,
    taxable: draft.tax !== "none",
    tax_rate_bp: null,
    tax_profile_id: null,
    tax_profile_name: null,
  };
  if (draft.tax !== "none") {
    const id = draft.tax === "default" ? tax.defaultId : draft.tax;
    const profile = tax.profiles.find((p) => p.id === id);
    if (profile) {
      base.tax_rate_bp = profile.rate_bp;
      base.tax_profile_id = profile.id;
      base.tax_profile_name = profile.name;
    }
  }
  switch (draft.method) {
    case null:
      return null;
    case "free":
      return { ...base, pricing_method: "free", template: null };
    case "fixed": {
      const amount = digits(draft.fixedAmount, ctx.currency);
      return amount
        ? {
            ...base,
            pricing_method: "fixed",
            price_amount: amount,
            template: null,
          }
        : null;
    }
    case "per_period": {
      const amount = digits(draft.flatAmount, ctx.currency);
      return amount
        ? {
            ...base,
            pricing_method: "per_period",
            price_amount: amount,
            price_period: draft.flatPeriod,
            template: null,
          }
        : null;
    }
    case "tiered": {
      const longStay = digits(draft.longStay, ctx.currency);
      if (draft.source === "shared") {
        const list = shared.find((l) => l.id === draft.sharedId);
        if (!list) return null;
        const baseAmount =
          list.kind === "multipliers"
            ? digits(draft.baseAmount, ctx.currency)
            : null;
        if (list.kind === "multipliers" && !baseAmount) return null;
        return {
          ...base,
          pricing_method: "tiered",
          base_amount: baseAmount,
          long_stay_day: longStay,
          template: { ...list, shared: true },
        };
      }
      const list = computeList(draft.list, "amounts", ctx.currency, ctx.step);
      if (!list.ok) return null;
      return {
        ...base,
        pricing_method: "tiered",
        long_stay_day: longStay,
        template: {
          id: "draft",
          name: "",
          kind: "amounts",
          shared: false,
          hourly: list.hourly === null ? null : String(list.hourly),
          days: list.days.map((d) => String(d.value)),
        },
      };
    }
  }
}

function draftDeposit(text: string, currency: string): string | null {
  const value = parseMinorUnits(text, currency);
  return value === null || value === "invalid" ? null : String(value);
}

/** The sample rental: from, to, how many, in the shop's time zone. */
export type Sample = {
  start: Date;
  end: Date;
  quantity: number;
  timeZone: string;
};

/**
 * The sample rental priced by quote(), with the shop's settings and seasons.
 * Null when it can't be priced (nothing to price, the return not after the
 * pickup, a quantity under one).
 */
export function previewQuote(
  inputs: PricingInputs,
  row: ProductPricingRow | null,
  sample: Sample,
): Quote | null {
  if (!row) return null;
  if (!(sample.end.getTime() > sample.start.getTime())) return null;
  if (!Number.isInteger(sample.quantity) || sample.quantity < 1) return null;
  try {
    const result = quote(
      quoteInputFor({ ...inputs, products: [row] }, [
        {
          id: "sample",
          productId: row.product_id,
          quantity: sample.quantity,
          span: {
            start: sample.start,
            end: sample.end,
            timeZone: sample.timeZone,
          },
        },
      ]),
    );
    return result.ok ? result : null;
  } catch {
    return null;
  }
}

// ------------------------------------- with extras, a coupon and a returning customer

/** One extra in the sample, taken with the vehicle (its dates are the vehicle's). */
export type SampleExtra = { productId: string; quantity: number };

export type CheckAsked = {
  /** pricing_inputs() for this product: the shop's settings, seasons, extras. */
  inputs: PricingInputs;
  /** The form's row (draftRow), saved or not. */
  row: ProductPricingRow | null;
  sample: Sample;
  /** Extras with a quantity; 0 or less is left out. Vehicles only. */
  extras?: readonly SampleExtra[];
  /** The code as typed, and what coupon_inputs() answered for it. */
  code?: string | null;
  coupon?: CouponInputs | null;
  /** The "Returning customer" tick. */
  returning?: boolean;
  /** The moment the price is checked: "today" for a coupon's valid dates. */
  now: Date;
  /**
   * The channel the booking would come from, for a coupon's "where it can be
   * used" (stage 11's channel picker on the Price check). Walk-in when not given,
   * as the Pricing tab's Check a price always is.
   */
  channel?: BookingChannel;
};

/** One discount on the breakdown: what it took over every line. */
export type CheckedDiscount =
  | { kind: "returning"; id: string; amount: bigint }
  | { kind: "coupon"; id: string; code: string; amount: bigint };

export type Checked = {
  quote: Extract<Quote, { ok: true }>;
  decision: DiscountDecision;
  /** In the order they were taken: returning-customer, then the coupon. */
  discounts: CheckedDiscount[];
  /**
   * The coupon was applied and the returning-customer discount, which this
   * customer would have had, was left out: they don't stack and the coupon
   * took more off.
   */
  couponBeatReturning: boolean;
};

/**
 * "Check a price" with everything a counter booking has: the sample rental,
 * the extras taken with it, a coupon code and the "Returning customer"
 * tick. Judged by decideDiscounts() through lib/coupons.ts' decideFor(), the
 * one place a booking's discounts are decided, on the staff channel; priced
 * by quote(). Read-only: nothing is reserved and no use is counted. Null
 * when it can't be priced.
 *
 * The tick stands in for the customer's completed rentals until Phase 3:
 * ticked, the customer has exactly as many as the shop asks for.
 */
export function checkPrice(asked: CheckAsked): Checked | null {
  const { inputs, row, sample } = asked;
  if (!row) return null;
  if (!(sample.end.getTime() > sample.start.getTime())) return null;
  if (!Number.isInteger(sample.quantity) || sample.quantity < 1) return null;
  const extras = (asked.extras ?? []).filter(
    (e) => Number.isInteger(e.quantity) && e.quantity > 0,
  );
  const pricing: PricingInputs = {
    ...inputs,
    products: [
      row,
      ...inputs.products.filter((p) => p.product_id !== row.product_id),
    ],
  };
  const completedRentals = asked.returning
    ? (inputs.settings?.returning_rentals_needed ?? 1)
    : 0;
  try {
    const invoice = quoteInputFor(pricing, [
      {
        id: "sample",
        productId: row.product_id,
        quantity: sample.quantity,
        span: {
          start: sample.start,
          end: sample.end,
          timeZone: sample.timeZone,
        },
      },
      ...extras.map((extra) => ({
        id: `extra:${extra.productId}`,
        productId: extra.productId,
        quantity: extra.quantity,
        extraOf: "sample",
      })),
    ]);
    const judge = (code: string | null | undefined) =>
      decideFor({
        pricing,
        quote: invoice,
        now: asked.now,
        timeZone: sample.timeZone,
        channel: asked.channel ?? "walk_in",
        code,
        coupon: code ? (asked.coupon ?? null) : null,
        completedRentals,
      });
    const decided = judge(asked.code);
    const decision = decided.decision;
    if (decision.outcome === "cant_price") return null;
    const result = quote(decided.quote);
    if (!result.ok) return null;

    const taken = new Map<string, bigint>();
    for (const line of result.lines)
      for (const d of line.discounts)
        taken.set(
          d.discountId,
          (taken.get(d.discountId) ?? BigInt(0)) + d.amount,
        );
    const coupons = decision.outcome === "decided" ? decision.coupons : {};
    const discounts: CheckedDiscount[] = decision.discounts.flatMap(
      (d): CheckedDiscount[] => {
        const amount = taken.get(d.id) ?? BigInt(0);
        if (d.id === RETURNING_DISCOUNT_ID)
          return [{ kind: "returning", id: d.id, amount }];
        const coupon = coupons[d.id];
        return coupon
          ? [{ kind: "coupon", id: d.id, code: coupon.code, amount }]
          : [];
      },
    );

    const couponBeatReturning =
      !!asked.returning &&
      decision.outcome === "decided" &&
      decision.coupon?.applied === true &&
      !decision.returningCustomer &&
      (() => {
        const without = judge(null).decision;
        return without.outcome === "decided" && without.returningCustomer;
      })();

    return { quote: result, decision, discounts, couponBeatReturning };
  } catch {
    return null;
  }
}

// ------------------------------------------------------- the list's price column

/** What the Products list shows as a product's price (§9.12). */
export type PriceSummary =
  | { kind: "day"; amount: bigint }
  | {
      kind: "period";
      amount: bigint;
      period: "hour" | "day" | "week" | "month";
    }
  | { kind: "fixed"; amount: bigint }
  | { kind: "free" }
  | { kind: "none" };

/**
 * "฿300 / day" for a product priced by rental length (its list's 1-day
 * total, a multipliers list at the product's base price), "฿200 / week" for
 * a flat fee, "฿150" for a fixed price, "Free", or "No price yet".
 */
export function priceSummary(row: ProductPricingRow | undefined): PriceSummary {
  if (!row) return { kind: "none" };
  try {
    switch (row.pricing_method) {
      case "tiered": {
        const list = listOf(row);
        return list ? { kind: "day", amount: list.days[0] } : { kind: "none" };
      }
      case "per_period":
        return row.price_amount && row.price_period
          ? {
              kind: "period",
              amount: BigInt(row.price_amount),
              period: row.price_period,
            }
          : { kind: "none" };
      case "fixed":
        return row.price_amount
          ? { kind: "fixed", amount: BigInt(row.price_amount) }
          : { kind: "none" };
      case "free":
        return { kind: "free" };
      default:
        return { kind: "none" };
    }
  } catch {
    return { kind: "none" };
  }
}

// ----------------------------------------------------------- the sample's dates

/** "2027-01-01T10:00": a pickup or return as typed, on the shop's clock. */
export type LocalDateTime = string;

/**
 * The sample rental's pickup and return. By number of days: from the pickup,
 * that many calendar days later at the same time on the shop's clock (so a
 * night when the clocks change is still one day). By dates: as typed.
 */
export function sampleSpan(
  sample:
    | { by: "days"; pickup: LocalDateTime; days: number }
    | { by: "dates"; pickup: LocalDateTime; dropoff: LocalDateTime },
  timeZone: string,
): { start: Date; end: Date } | null {
  const start = fromLocalInput(sample.pickup, timeZone);
  if (!start) return null;
  if (sample.by === "dates") {
    const end = fromLocalInput(sample.dropoff, timeZone);
    return end && end.getTime() > start.getTime() ? { start, end } : null;
  }
  if (!Number.isInteger(sample.days) || sample.days < 1) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(sample.pickup);
  if (!match) return null;
  const date = addCalendarDays(
    { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) },
    sample.days,
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  const end = fromLocalInput(
    `${date.year}-${pad(date.month)}-${pad(date.day)}T${match[4]}`,
    timeZone,
  );
  return end ? { start, end } : null;
}
