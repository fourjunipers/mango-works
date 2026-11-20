/**
 * Settings › Coupons (docs/phase-2-plan.md §5.3, §7; Phase 2 stage 9): the
 * coupon form as typed, what it sends to platform.save_coupon(), and the
 * words for each refusal. Pure: no React, no database.
 *
 * Amounts are parsed digit by digit in the shop's currency and exponent
 * (lib/money.ts) and sent as strings of digits; a percentage is basis
 * points read the same way (lib/seasons.ts). The code is shown as it will
 * be stored (normalizeCouponCode) and refused here when the database would
 * refuse it (isCouponCode), so the shop sees why before saving. The
 * database checks everything again.
 *
 * "Uses per customer" is not on the form (stage 9 brief): nothing sends a
 * customer until Phase 3, so a limit saved now would never be reached. The
 * form never names `max_uses_per_customer`, so save_coupon() leaves the
 * column as it is.
 */

import { isCouponCode, normalizeCouponCode } from "@mango/core/discounts";
import type { CouponPayload, CouponSaveReason } from "./coupon-save";
import { minorDecimal, minorExponent } from "./money";
import { parseTypedNumber, parseWholeNumber } from "./number-input";
import { parsePercentBp, percentInput } from "./seasons";

export const couponChannels = ["staff", "booking_page", "marketplace"] as const;
export type CouponChannelChoice = (typeof couponChannels)[number];

/** The longest code save_coupon() stores, after normalising. */
export const COUPON_CODE_MAX = 40;
/** The longest note the table holds. */
export const COUPON_NAME_MAX = 120;
/** save_coupon()'s bounds. */
export const COUPON_MIN_DAYS_MAX = 1000;
export const COUPON_MAX_USES_MAX = 2_000_000_000;
/** 100%: a percentage coupon can take a line to nothing, never below. */
export const COUPON_PERCENT_MAX_BP = 10000;

/** What the coupon form holds, as typed. */
export type CouponDraft = {
  code: string;
  name: string;
  kind: "percent" | "fixed";
  percent: string;
  amount: string;
  allProducts: boolean;
  productIds: string[];
  validFrom: string;
  validTo: string;
  pickupFrom: string;
  pickupTo: string;
  minDays: string;
  minSpend: string;
  maxUses: string;
  channels: CouponChannelChoice[];
  withReturningDiscount: boolean;
  withSeasonDiscount: boolean;
};

/** A coupon as Settings › Coupons reads it (platform.coupons and its links). */
export type CouponRecord = {
  id: string;
  code: string;
  name: string;
  currency: string;
  kind: "percent" | "fixed";
  percent_bp: number | null;
  /** Minor units, a string of digits. */
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
  channels: CouponChannelChoice[];
  with_returning_discount: boolean;
  with_season_discount: boolean;
  active: boolean;
  archived_at: string | null;
};

// ------------------------------------------------------ numbers as typed

/** The most digits an amount may have: a bigint column holds 18 safely. */
export const COUPON_AMOUNT_MAX_DIGITS = 18;

/**
 * An amount as typed, in the currency's minor units by its ISO 4217
 * exponent (THB ×100, KWD ×1000, VND ×1), by the platform's one number
 * rule (lib/number-input.ts). Null: blank. "invalid": not that rule, or
 * more decimal places than the currency has. "tooLong": more than 18
 * digits.
 */
export function parseCouponAmount(
  input: string,
  currency: string,
): bigint | null | "invalid" | "tooLong" {
  const typed = parseTypedNumber(input);
  if (typed === null || typed === "invalid") return typed;
  const exponent = minorExponent(currency);
  if (typed.fraction.length > exponent) return "invalid";
  const digits = (typed.whole + typed.fraction.padEnd(exponent, "0")).replace(
    /^0+(?=\d)/,
    "",
  );
  if (digits.length > COUPON_AMOUNT_MAX_DIGITS) return "tooLong";
  return BigInt(digits);
}

/**
 * A new coupon. Nothing is preset but what the database itself starts
 * with: percentage, all products, "Can be used on season discounts" on, not
 * combined with the returning-customer discount, and no channel ticked.
 */
export function emptyCouponDraft(): CouponDraft {
  return {
    code: "",
    name: "",
    kind: "percent",
    percent: "",
    amount: "",
    allProducts: true,
    productIds: [],
    validFrom: "",
    validTo: "",
    pickupFrom: "",
    pickupTo: "",
    minDays: "",
    minSpend: "",
    maxUses: "",
    channels: [],
    withReturningDiscount: false,
    withSeasonDiscount: true,
  };
}

/** A saved coupon as the form shows it. */
export function couponDraft(row: CouponRecord): CouponDraft {
  const money = (value: string | null) =>
    value === null ? "" : minorDecimal(value, row.currency);
  return {
    code: row.code,
    name: row.name,
    kind: row.kind,
    percent: row.percent_bp === null ? "" : percentInput(row.percent_bp),
    amount: money(row.amount),
    allProducts: row.all_products,
    productIds: [...row.product_ids],
    validFrom: row.valid_from ?? "",
    validTo: row.valid_to ?? "",
    pickupFrom: row.pickup_from ?? "",
    pickupTo: row.pickup_to ?? "",
    minDays: row.min_days === null ? "" : String(row.min_days),
    minSpend: money(row.min_spend),
    maxUses: row.max_uses === null ? "" : String(row.max_uses),
    channels: couponChannels.filter((c) => row.channels.includes(c)),
    withReturningDiscount: row.with_returning_discount,
    withSeasonDiscount: row.with_season_discount,
  };
}

/**
 * The code as it will be stored, and whether it can be. Empty: nothing
 * typed yet (or only spaces).
 */
export function codePreview(
  typed: string,
): { stored: string; ok: boolean } | null {
  const stored = normalizeCouponCode(typed);
  if (stored === "") return null;
  return { stored, ok: isCouponCode(stored) };
}

const isDay = (text: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return (
    check.getUTCFullYear() === y &&
    check.getUTCMonth() === m - 1 &&
    check.getUTCDate() === d
  );
};

/** A whole number as typed, or null for blank; "invalid" otherwise. */
function parseWhole(text: string, max: number): number | null | "invalid" {
  const value = parseWholeNumber(text);
  if (value === null || value === "invalid") return value;
  return value >= BigInt(1) && value <= BigInt(max) ? Number(value) : "invalid";
}

/**
 * What platform.save_coupon() is sent, or what is wrong (an error key of
 * "FormErrors" per field). Every field on the form is sent, blanks as null,
 * so a cleared box clears the setting. `max_uses_per_customer` is never
 * named (see the header).
 */
export function couponPayload(
  draft: CouponDraft,
  currency: string,
  id?: string,
):
  | { ok: true; payload: CouponPayload }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const code = codePreview(draft.code);
  if (!code) errors.code = "required";
  else if (!code.ok) errors.code = "couponInvalidCode";

  const name = draft.name.trim();
  if (name.length > COUPON_NAME_MAX) errors.name = "tooLong";

  let percentBp: number | null = null;
  let amount: string | null = null;
  if (draft.kind === "percent") {
    const bp = parsePercentBp(draft.percent);
    if (bp === null) errors.percent = "required";
    else if (bp === "invalid") errors.percent = "invalidPercent";
    else if (bp === 0) errors.percent = "percentZero";
    else if (bp > COUPON_PERCENT_MAX_BP)
      errors.percent = "couponPercentTooLarge";
    else percentBp = bp;
  } else {
    const value = parseCouponAmount(draft.amount, currency);
    if (value === null) errors.amount = "required";
    else if (value === "invalid") errors.amount = "invalidMoney";
    else if (value === "tooLong") errors.amount = "couponAmountTooLong";
    else if (value === BigInt(0)) errors.amount = "couponAmountZero";
    else amount = String(value);
  }

  if (!draft.allProducts && draft.productIds.length === 0)
    errors.products = "couponNoProducts";

  const day = (key: keyof CouponDraft & string, text: string) => {
    if (!text) return null;
    if (!isDay(text)) {
      errors[key] = "invalidDate";
      return null;
    }
    return text;
  };
  const validFrom = day("validFrom", draft.validFrom);
  const validTo = day("validTo", draft.validTo);
  if (validFrom && validTo && validTo < validFrom)
    errors.validTo = "couponDatesOrder";
  const pickupFrom = day("pickupFrom", draft.pickupFrom);
  const pickupTo = day("pickupTo", draft.pickupTo);
  if (pickupFrom && pickupTo && pickupTo < pickupFrom)
    errors.pickupTo = "couponDatesOrder";

  const minDays = parseWhole(draft.minDays, COUPON_MIN_DAYS_MAX);
  if (minDays === "invalid") errors.minDays = "couponMinDaysRange";

  const minSpend = parseCouponAmount(draft.minSpend, currency);
  if (minSpend === "invalid") errors.minSpend = "invalidMoney";
  else if (minSpend === "tooLong") errors.minSpend = "couponAmountTooLong";
  else if (minSpend === BigInt(0)) errors.minSpend = "couponAmountZero";

  const maxUses = parseWhole(draft.maxUses, COUPON_MAX_USES_MAX);
  if (maxUses === "invalid") errors.maxUses = "couponMaxUsesRange";

  const channels = couponChannels.filter((c) => draft.channels.includes(c));
  if (channels.length === 0) errors.channels = "couponNoChannels";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      ...(id ? { id } : {}),
      code: code!.stored,
      name,
      kind: draft.kind,
      percent_bp: percentBp,
      amount,
      all_products: draft.allProducts,
      ...(draft.allProducts
        ? {}
        : { product_ids: [...new Set(draft.productIds)] }),
      valid_from: validFrom,
      valid_to: validTo,
      pickup_from: pickupFrom,
      pickup_to: pickupTo,
      min_days: minDays as number | null,
      min_spend: typeof minSpend === "bigint" ? String(minSpend) : null,
      max_uses: maxUses as number | null,
      channels,
      with_returning_discount: draft.withReturningDiscount,
      with_season_discount: draft.withSeasonDiscount,
    },
  };
}

/**
 * Where each refusal of save_coupon() is shown, and its "FormErrors" key.
 * A code refusal sits under the code box; the rest over the form.
 */
export function couponSaveError(reason: CouponSaveReason): {
  field: "code" | "form";
  key: string;
} {
  switch (reason) {
    case "invalid_code":
      return { field: "code", key: "couponInvalidCode" };
    case "code_taken":
      return { field: "code", key: "couponCodeTaken" };
    case "only_owner_or_manager":
      return { field: "form", key: "couponOnlyOwnerOrManager" };
    case "invalid_coupon":
      return { field: "form", key: "couponInvalid" };
    case "coupon_not_found":
      return { field: "form", key: "couponNotFound" };
    case "product_not_found":
      return { field: "form", key: "couponProductNotFound" };
    case "try_again":
      return { field: "form", key: "couponTryAgain" };
  }
}

/** A coupon's state on the list. */
export type CouponStatus = "on" | "off" | "archived";

export function couponStatus(
  row: Pick<CouponRecord, "active" | "archived_at">,
): CouponStatus {
  if (row.archived_at !== null) return "archived";
  return row.active ? "on" : "off";
}

/**
 * "12 of 50" or "12": the uses from coupon_inputs().uses.total (never a raw
 * count of redemptions, which would count holds that have run out and not
 * been swept).
 */
export type CouponUsesText =
  | { kind: "ofLimit"; used: number; limit: number }
  | { kind: "noLimit"; used: number };

export function couponUsesText(
  used: number,
  limit: number | null,
): CouponUsesText {
  return limit === null
    ? { kind: "noLimit", used }
    : { kind: "ofLimit", used, limit };
}
