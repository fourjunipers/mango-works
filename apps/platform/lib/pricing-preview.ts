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

import { quote, type Quote } from "@mango/core/quote";
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
    tax_profile_name: null,
  };
  if (draft.tax !== "none") {
    const id = draft.tax === "default" ? tax.defaultId : draft.tax;
    const profile = tax.profiles.find((p) => p.id === id);
    if (profile) {
      base.tax_rate_bp = profile.rate_bp;
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
