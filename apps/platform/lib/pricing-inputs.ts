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
 *
 * Gear and services offered with a vehicle (platform.product_extras) arrive
 * as `extras`: which extra goes with which vehicle and how many come free
 * with each one. A line that says it is an extra of a vehicle's line takes
 * that vehicle's dates unless it has its own, and its included quantity
 * from those rows; quote() does step 4 with them.
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
import type { SnapshotContext } from "@mango/core/quote-snapshot";
import type { SeasonRule } from "@mango/core/season";
import { currencyExponent } from "@mango/core/currency";

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
  /**
   * The products asked for, and the extras offered with the vehicles among
   * them: one call prices a vehicle with what goes with it.
   */
  products: ProductPricingRow[];
  seasons: SeasonRow[];
  /** What is offered with each vehicle asked for. Readable by every member. */
  extras: ExtraRow[];
};

/**
 * A gear or service product offered with a vehicle. The database has
 * already let a vehicle's own row win over the shop's "every vehicle" row
 * for the same extra, so there is one row per vehicle and extra.
 */
export type ExtraRow = {
  /** The vehicle product. */
  product_id: string;
  extra_product_id: string;
  extra_product_type: "gear" | "service";
  /** Free with each vehicle. */
  included_quantity: number;
  /**
   * The most per vehicle ("up to N per bike"); for a booking, this times
   * the number of vehicles it is offered with, as the included quantity is
   * counted. Online channels only: staff are not bound. Null: no limit.
   */
  max_quantity: number | null;
  sort_position: number;
  /** True: it comes from the shop's "every vehicle" list. */
  every_vehicle: boolean;
};

export type ProductPricingRow = {
  product_id: string;
  /** As it is now. The quote snapshot keeps it. */
  product_name: string;
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
  /**
   * The profile in force: the product's own, else the shop's default. The
   * rate and the name come from the same profile. Null: not taxable, or the
   * shop charges no tax.
   */
  tax_profile_id: string | null;
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
  /**
   * When. An extra may leave it out: it then takes its vehicle's dates
   * (helmets for the whole rental). With its own it is priced on them.
   */
  span?: RentalSpan;
  /** Set on a later period of a rental: the original pickup. */
  rentalStart?: Date | null;
  /**
   * Gear or a service taken with a vehicle: the id of that vehicle's line
   * in this request. How many come free is read from the database's rows.
   */
  extraOf?: string | null;
};

/**
 * The extras offered with a vehicle product, in the order to show them:
 * the vehicle's own first, then the shop's "every vehicle" ones.
 */
export function extrasOf(
  inputs: Pick<PricingInputs, "extras">,
  vehicleProductId: string,
): ExtraRow[] {
  return inputs.extras.filter((row) => row.product_id === vehicleProductId);
}

/**
 * How many units of an extra come free with each vehicle. 0 when the shop
 * does not offer that product with that vehicle: staff may still add it to
 * the vehicle's line, and every unit is charged.
 */
export function includedWith(
  inputs: Pick<PricingInputs, "extras">,
  vehicleProductId: string,
  extraProductId: string,
): number {
  return (
    extrasOf(inputs, vehicleProductId).find(
      (row) => row.extra_product_id === extraProductId,
    )?.included_quantity ?? 0
  );
}

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
  const byLine = new Map(lines.map((line) => [line.id, line]));
  const quoteLines: QuoteLineInput[] = lines.map((line) => {
    const row = byProduct.get(line.productId);
    // An extra: its vehicle's line gives it its dates (unless it has its
    // own) and, with the database's rows, how many come free. Whether the
    // parent is a vehicle's line is quote()'s check, not this file's.
    const parent = line.extraOf ? byLine.get(line.extraOf) : undefined;
    if (line.extraOf && (!parent || parent.id === line.id)) {
      throw new RangeError(
        `Line ${line.id} names a vehicle line that isn't here: ${line.extraOf}`,
      );
    }
    const span = line.span ?? parent?.span;
    if (!span) throw new RangeError(`Line ${line.id} has no dates`);
    return {
      id: line.id,
      productId: line.productId,
      pricing: pricingOf(row),
      quantity: line.quantity,
      span,
      // On a later period of a rental, an extra that takes its vehicle's
      // dates carries its vehicle's original pickup too.
      rentalStart:
        line.rentalStart ?? (line.span ? null : (parent?.rentalStart ?? null)),
      taxRateBp: row?.tax_rate_bp ?? null,
      vehicle: row?.product_type === "vehicle",
      deposit: row ? minorUnits(row.deposit) : null,
      extraOf: parent
        ? {
            lineId: parent.id,
            includedQuantity: includedWith(
              inputs,
              parent.productId,
              line.productId,
            ),
          }
        : null,
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

/**
 * What the quote snapshot needs beside quote()'s input (snapshotQuote()'s
 * context), from the same rows: each line's product name and type, the tax
 * profile its rate came from (the one in force, by id and name) and each
 * season's name. The currency is the shop's; its decimal places come from
 * @mango/core. Coupons are the caller's (stage 8).
 *
 * A line whose product has no pricing row can't be priced, so it can't be
 * in a snapshot: it is left out here and snapshotQuote() says so.
 */
export function snapshotContextFor(
  inputs: PricingInputs,
  lines: readonly Pick<LineRequest, "id" | "productId">[],
  more: { pricedAt: Date; coupons?: SnapshotContext["coupons"] },
): SnapshotContext {
  const byProduct = new Map(inputs.products.map((row) => [row.product_id, row]));
  const currency =
    inputs.settings?.currency ??
    lines.map((line) => byProduct.get(line.productId)?.currency).find(Boolean);
  if (!currency) throw new RangeError("No currency: nothing here has a price");
  const context: Record<string, SnapshotContext["lines"][string]> = {};
  for (const line of lines) {
    const row = byProduct.get(line.productId);
    if (!row) continue;
    context[line.id] = {
      productName: row.product_name,
      productType: row.product_type,
      taxProfile:
        row.tax_profile_id !== null && row.tax_profile_name !== null
          ? { id: row.tax_profile_id, name: row.tax_profile_name }
          : null,
    };
  }
  return {
    currency,
    exponent: currencyExponent(currency),
    pricedAt: more.pricedAt,
    lines: context,
    seasons: Object.fromEntries(
      inputs.seasons.map((season) => [season.id, { name: season.name }]),
    ),
    coupons: more.coupons,
  };
}
