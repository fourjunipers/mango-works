/**
 * From the database to the pricer (docs/products-redesign.md §9.9).
 *
 * platform.pricing_inputs() returns everything quote() needs as rows, and
 * does no arithmetic. This file turns those rows into quote()'s input, and
 * does none either: every price is worked out by quote() in @mango/core.
 * Amounts arrive as strings of digits and become `bigint` here.
 *
 * It is the one feed for every caller in this app (the Pricing tab's "Check
 * a price", the Products list, later the order editor), so they all price
 * the same way. Pure functions: the database call is the caller's.
 */

import {
  resolvePriceList,
  type PriceList,
  type ResolvedList,
} from "@mango/core/price-list";
import type {
  Credit,
  DepositSetting,
  Discount,
  QuoteInput,
  QuoteLineInput,
} from "@mango/core/quote";
import type { Pricing, RentalSpan } from "@mango/core/rental-price";
import type { SeasonRule } from "@mango/core/season";

/** platform.pricing_inputs() as it arrives: amounts are strings of digits. */
export type PricingInputs = {
  /** Null: the shop has saved no pricing setting, or the caller may not see prices. */
  settings: {
    currency: string;
    rounding_step: string | null;
    tax_inclusive: boolean;
    coupons_enabled: boolean;
    deposit_mode: "none" | "percent_of_order" | "fixed_per_order" | "per_product";
    deposit_percent_bp: number | null;
    deposit_amount: string | null;
    default_tax_profile_id: string | null;
  } | null;
  products: ProductPricingRow[];
  seasons: SeasonRow[];
};

export type ProductPricingRow = {
  product_id: string;
  product_type: "vehicle" | "gear" | "sale_item" | "service";
  currency: string;
  pricing_method: "tiered" | "per_period" | "fixed" | "free" | null;
  price_amount: string | null;
  price_period: "hour" | "day" | "week" | "month" | null;
  base_amount: string | null;
  long_stay_day: string | null;
  deposit: string | null;
  replacement_price: string | null;
  taxable: boolean;
  tax_rate_bp: number | null;
  tax_profile_name: string | null;
  template: {
    id: string;
    name: string;
    kind: "amounts" | "multipliers";
    shared: boolean;
    hourly: string | null;
    days: string[];
  } | null;
};

export type SeasonRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  repeats_yearly: boolean;
  adjust_bp: number;
  all_products: boolean;
  product_ids: string[];
};

/** A string of digits from the database → minor units. Null stays null. */
export function minorUnits(value: string | null): bigint | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) {
    throw new RangeError(`Expected an amount in minor units, got ${value}`);
  }
  return BigInt(value);
}

/** A product's price list as money: a multipliers list at the product's base price. */
export function listOf(row: ProductPricingRow): ResolvedList | null {
  if (!row.template) return null;
  const list: PriceList = {
    kind: row.template.kind,
    days: row.template.days.map((value) => minorUnits(value)!),
    hourly: minorUnits(row.template.hourly),
  };
  return resolvePriceList(list, minorUnits(row.base_amount));
}

/** How a product is priced, for quote(). Null: it has no price yet. */
export function pricingOf(row: ProductPricingRow | undefined): Pricing | null {
  if (!row) return null;
  switch (row.pricing_method) {
    case "tiered": {
      const list = listOf(row);
      return list
        ? {
            method: "tiered",
            list,
            longStayDay: minorUnits(row.long_stay_day),
          }
        : null;
    }
    case "per_period": {
      const amount = minorUnits(row.price_amount);
      return amount !== null && row.price_period
        ? { method: "per_period", amount, period: row.price_period }
        : null;
    }
    case "fixed": {
      const amount = minorUnits(row.price_amount);
      return amount === null ? null : { method: "fixed", amount };
    }
    case "free":
      return { method: "free" };
    case null:
      return null;
  }
}

/** The shop's deposit choice. No settings row is "none". */
export function depositOf(settings: PricingInputs["settings"]): DepositSetting {
  if (!settings) return { mode: "none" };
  switch (settings.deposit_mode) {
    case "none":
      return { mode: "none" };
    case "percent_of_order":
      return {
        mode: "percent_of_order",
        percentBp: settings.deposit_percent_bp ?? 0,
      };
    case "fixed_per_order":
      return {
        mode: "fixed_per_order",
        amount: minorUnits(settings.deposit_amount) ?? BigInt(0),
      };
    case "per_product":
      return {
        mode: "per_product",
        amount: minorUnits(settings.deposit_amount),
      };
  }
}

export function seasonsOf(rows: readonly SeasonRow[]): SeasonRule[] {
  return rows.map((row) => ({
    id: row.id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    repeatsYearly: row.repeats_yearly,
    adjustBp: row.adjust_bp,
    products: row.all_products ? "all" : row.product_ids,
  }));
}

/** One line to price: a product, how many, and when. */
export type LineRequest = {
  id: string;
  productId: string;
  quantity: number;
  span: RentalSpan;
  /** Set on a later period of a rental: the original pickup. */
  rentalStart?: Date | null;
};

/**
 * quote()'s input for the lines billed together, from the database's rows.
 * A product with no pricing row, or one the caller may not see, is a line
 * that can't be priced: quote() says which.
 */
export function quoteInputFor(
  inputs: PricingInputs,
  lines: readonly LineRequest[],
  more: {
    discounts?: readonly Discount[];
    credits?: readonly Credit[];
    customerDeposit?: DepositSetting | null;
    orderDeposit?: DepositSetting | null;
  } = {},
): QuoteInput {
  const byProduct = new Map(inputs.products.map((row) => [row.product_id, row]));
  const quoteLines: QuoteLineInput[] = lines.map((line) => {
    const row = byProduct.get(line.productId);
    return {
      id: line.id,
      productId: line.productId,
      pricing: pricingOf(row),
      quantity: line.quantity,
      span: line.span,
      rentalStart: line.rentalStart ?? null,
      taxRateBp: row?.tax_rate_bp ?? null,
      vehicle: row?.product_type === "vehicle",
      deposit: row ? minorUnits(row.deposit) : null,
    };
  });
  return {
    // A shop that has saved no setting types prices that include tax (the
    // column's default), charges none, and accepts no coupons.
    taxInclusive: inputs.settings?.tax_inclusive ?? true,
    couponsEnabled: inputs.settings?.coupons_enabled ?? false,
    lines: quoteLines,
    seasonRules: seasonsOf(inputs.seasons),
    discounts: more.discounts,
    credits: more.credits,
    deposit: {
      shop: depositOf(inputs.settings),
      customer: more.customerDeposit,
      order: more.orderDeposit,
    },
  };
}
