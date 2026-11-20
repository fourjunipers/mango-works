/**
 * Seasons (docs/products-redesign.md §9.5, §9.12): a name, a first and last
 * calendar day, every year or one year only, Increase or Decrease by a
 * percentage, and the products it applies to. Pure: no React, no database.
 *
 * A percentage is basis points (20% is 2000), read digit by digit from what
 * was typed: no float. The direction is a choice, never a typed minus sign.
 */

import { MAX_ADJUST_BP, MIN_ADJUST_BP } from "@mango/core/season";
import { parseTypedNumber } from "./number-input";

export type Direction = "increase" | "decrease";

/** What the season form holds, as typed. */
export type SeasonDraft = {
  name: string;
  startsOn: string;
  endsOn: string;
  repeatsYearly: boolean;
  direction: Direction;
  percent: string;
  allProducts: boolean;
  productIds: string[];
  active: boolean;
};

export type SeasonRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  repeats_yearly: boolean;
  adjust_bp: number;
  all_products: boolean;
  active: boolean;
  product_ids: string[];
};

/** Two decimal places of a percentage: basis points. */
const PERCENT_DECIMALS = 2;

/**
 * A percentage as typed ("20", "12.5", "20%") in basis points, by the
 * platform's one number rule (lib/number-input.ts): a dot for decimals,
 * never a comma. Null: blank. "invalid": not that rule, more than two
 * decimal places, or more than six digits before the point.
 */
export function parsePercentBp(input: string): number | null | "invalid" {
  const typed = parseTypedNumber(input.trim().replace(/%$/, ""));
  if (typed === null || typed === "invalid") return typed;
  if (typed.fraction.length > PERCENT_DECIMALS || typed.whole.length > 6)
    return "invalid";
  return Number(typed.whole + typed.fraction.padEnd(PERCENT_DECIMALS, "0"));
}

/** Basis points as the percentage typed in the form: 1250 → "12.5", 2000 → "20". */
export function percentInput(bp: number): string {
  const digits = String(Math.abs(bp)).padStart(PERCENT_DECIMALS + 1, "0");
  const whole = digits.slice(0, -PERCENT_DECIMALS).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(-PERCENT_DECIMALS).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** "20%" / "12.5%" in the viewer's locale, from basis points (never signed). */
export function percentLabel(bp: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    Number(percentInput(bp)),
  )}%`;
}

const isDay = (text: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
};

export const SEASON_NAME_MAX = 120;

/**
 * What platform.save_price_rule() is sent, or what is wrong (an error key
 * per field). A new season sends every field; the database checks them all
 * again.
 */
export function seasonPayload(
  draft: SeasonDraft,
  id?: string,
):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (!name) errors.name = "required";
  else if (name.length > SEASON_NAME_MAX) errors.name = "tooLong";

  if (!draft.startsOn) errors.startsOn = "required";
  else if (!isDay(draft.startsOn)) errors.startsOn = "invalidDate";
  if (!draft.endsOn) errors.endsOn = "required";
  else if (!isDay(draft.endsOn)) errors.endsOn = "invalidDate";
  if (
    !errors.startsOn &&
    !errors.endsOn &&
    !draft.repeatsYearly &&
    draft.endsOn < draft.startsOn
  )
    errors.endsOn = "seasonEndsBeforeStart";

  const bp = parsePercentBp(draft.percent);
  let adjust = 0;
  if (bp === null) errors.percent = "required";
  else if (bp === "invalid") errors.percent = "invalidPercent";
  else if (bp === 0) errors.percent = "percentZero";
  else {
    adjust = draft.direction === "decrease" ? -bp : bp;
    if (adjust < MIN_ADJUST_BP) errors.percent = "decreaseTooLarge";
    else if (adjust > MAX_ADJUST_BP) errors.percent = "increaseTooLarge";
  }

  if (!draft.allProducts && draft.productIds.length === 0)
    errors.products = "seasonNoProducts";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      ...(id ? { id } : {}),
      name,
      starts_on: draft.startsOn,
      ends_on: draft.endsOn,
      repeats_yearly: draft.repeatsYearly,
      adjust_bp: adjust,
      all_products: draft.allProducts,
      active: draft.active,
      product_ids: draft.allProducts ? [] : [...new Set(draft.productIds)],
    },
  };
}

/** A saved season as the form shows it. */
export function seasonDraft(row: SeasonRow): SeasonDraft {
  return {
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    repeatsYearly: row.repeats_yearly,
    direction: row.adjust_bp < 0 ? "decrease" : "increase",
    percent: percentInput(row.adjust_bp),
    allProducts: row.all_products,
    productIds: [...row.product_ids],
    active: row.active,
  };
}

export const emptySeasonDraft = (): SeasonDraft => ({
  name: "",
  startsOn: "",
  endsOn: "",
  repeatsYearly: true,
  direction: "decrease",
  percent: "",
  allProducts: true,
  productIds: [],
  active: true,
});

/**
 * A season's first and last day in the viewer's format: "1 Apr" for a season
 * every year (the year is not used), "1 Apr 2027" for one year only. The
 * dates are calendar days, so they are formatted in UTC and never shift.
 */
export function seasonDates(
  startsOn: string,
  endsOn: string,
  repeatsYearly: boolean,
  locale: string,
): { from: string; to: string } {
  const format = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(repeatsYearly ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
  const show = (text: string) =>
    isDay(text) ? format.format(new Date(`${text}T00:00:00Z`)) : text;
  return { from: show(startsOn), to: show(endsOn) };
}

/** Whether a season names a product: every product, or this one among its own. */
export function seasonCovers(row: SeasonRow, productId: string): boolean {
  return row.all_products || row.product_ids.includes(productId);
}
