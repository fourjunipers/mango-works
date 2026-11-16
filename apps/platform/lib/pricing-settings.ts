/**
 * Settings › Pricing and tax (docs/products-redesign.md §9.2, §9.6 to §9.8,
 * §9.12): the rounding step, whether prices include tax, the default tax
 * profile, the deposit choice and "Accept coupons". Pure: no React, no
 * database.
 *
 * Amounts are parsed digit by digit (lib/money.ts) and sent as strings of
 * digits; percentages are basis points read the same way (lib/seasons.ts).
 * Nothing here works out a price.
 */

import { minorDecimal, parseMinorUnits } from "./money";
import type { PricingInputs } from "./pricing-inputs";
import { parsePercentBp, percentInput } from "./seasons";

export const depositModes = [
  "none",
  "percent_of_order",
  "fixed_per_order",
  "per_product",
] as const;
export type DepositMode = (typeof depositModes)[number];

/** What the Pricing and tax form holds, as typed. */
export type SettingsDraft = {
  /** Blank: not chosen; quick entry uses the currency's default. */
  roundingStep: string;
  taxInclusive: boolean;
  /** "" for no default: the shop charges no tax. */
  defaultTaxId: string;
  depositMode: DepositMode;
  depositPercent: string;
  /** The fixed amount per order, or the shop's amount on "per product". */
  depositAmount: string;
  couponsEnabled: boolean;
};

type Settings = NonNullable<PricingInputs["settings"]>;

/**
 * The form from the shop's saved settings. No settings row reads as the
 * columns' defaults: tax included, no default profile, no deposit, coupons
 * off, no rounding step chosen.
 */
export function settingsDraft(
  settings: Settings | null,
  currency: string,
): SettingsDraft {
  return {
    roundingStep: settings?.rounding_step
      ? minorDecimal(settings.rounding_step, currency)
      : "",
    taxInclusive: settings?.tax_inclusive ?? true,
    defaultTaxId: settings?.default_tax_profile_id ?? "",
    depositMode: settings?.deposit_mode ?? "none",
    depositPercent:
      settings?.deposit_percent_bp != null
        ? percentInput(settings.deposit_percent_bp)
        : "",
    depositAmount: settings?.deposit_amount
      ? minorDecimal(settings.deposit_amount, currency)
      : "",
    couponsEnabled: settings?.coupons_enabled ?? false,
  };
}

/** The highest percentage deposit the database takes: 1,000%. */
export const MAX_DEPOSIT_PERCENT_BP = 100000;

/**
 * What platform.save_pricing_settings() is sent, or what is wrong (an error
 * key per field, as FormErrors names them). Every setting is sent; the
 * function clears the deposit numbers that don't belong to the choice.
 */
export function settingsPayload(
  draft: SettingsDraft,
  currency: string,
  activeProfileIds: readonly string[],
):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const payload: Record<string, unknown> = {
    tax_inclusive: draft.taxInclusive,
    coupons_enabled: draft.couponsEnabled,
    deposit_mode: draft.depositMode,
  };

  const step = parseMinorUnits(draft.roundingStep, currency);
  if (step === "invalid") errors.roundingStep = "invalidMoney";
  else if (step === BigInt(0)) errors.roundingStep = "priceZero";
  else payload.rounding_step = step === null ? null : String(step);

  if (draft.defaultTaxId && !activeProfileIds.includes(draft.defaultTaxId))
    errors.defaultTaxId = "invalidTaxProfile";
  else payload.default_tax_profile_id = draft.defaultTaxId || null;

  if (!depositModes.includes(draft.depositMode)) errors.depositMode = "required";
  if (draft.depositMode === "percent_of_order") {
    const bp = parsePercentBp(draft.depositPercent);
    if (bp === null) errors.depositPercent = "required";
    else if (bp === "invalid") errors.depositPercent = "invalidPercent";
    else if (bp === 0) errors.depositPercent = "percentZero";
    else if (bp > MAX_DEPOSIT_PERCENT_BP)
      errors.depositPercent = "increaseTooLarge";
    else payload.deposit_percent_bp = bp;
  }
  if (
    draft.depositMode === "fixed_per_order" ||
    draft.depositMode === "per_product"
  ) {
    const amount = parseMinorUnits(draft.depositAmount, currency);
    if (amount === "invalid") errors.depositAmount = "invalidMoney";
    else if (amount === null && draft.depositMode === "fixed_per_order")
      errors.depositAmount = "required";
    else if (amount === BigInt(0) && draft.depositMode === "fixed_per_order")
      errors.depositAmount = "priceZero";
    else payload.deposit_amount = amount === null ? null : String(amount);
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, payload };
}

/** A tax rate as typed ("7", "7.5") in basis points, 0 to 100%. */
export function parseRateBp(input: string): number | null | "invalid" {
  const bp = parsePercentBp(input);
  if (typeof bp === "number" && bp > 10000) return "invalid";
  return bp;
}

/** A profile's name: trimmed, 1 to 80 characters (as the database holds it). */
export function profileNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "required";
  if (trimmed.length > 80) return "tooLong";
  return null;
}

/**
 * The tax profile a country usually starts with, offered as one tap while
 * the shop has none (open item 10 (a)). Only countries Mark has confirmed:
 * Thailand, VAT 7% (15 Nov 2026). A country not listed is offered nothing.
 */
const usualTax: Readonly<Record<string, { name: string; rateBp: number }>> = {
  TH: { name: "VAT 7%", rateBp: 700 },
};

export function usualTaxProfile(
  country: string,
): { name: string; rateBp: number } | null {
  return usualTax[country.toUpperCase()] ?? null;
}
