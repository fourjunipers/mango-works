/**
 * The Pricing tab's form logic (docs/products-redesign.md §9.3, §9.4, §9.12).
 * Pure: no React, no database. It reads what was typed, fills a price list
 * from quick entry, says what stops a save, and builds what
 * platform.save_product_pricing() and platform.save_price_template() take.
 *
 * No arithmetic on money here (the one-pricer lint rule): the days are
 * filled by fillPriceList in @mango/core, a list is checked by listProblems,
 * and amounts are only parsed and passed on as strings of digits.
 */

import {
  LIST_DAYS,
  QUICK_ENTRY_DAYS,
  fillPriceList,
  listProblems,
  sameEveryDay,
  type DaySource,
  type ListProblem,
  type QuickEntry,
} from "@mango/core/price-list";
import {
  minorDecimal,
  minorExponent,
  multiplierText,
  parseMinorUnits,
  parseMultiplier,
} from "./money";

export type ProductType = "vehicle" | "gear" | "sale_item" | "service";
export type Method = "tiered" | "per_period" | "fixed" | "free";
export type Period = "hour" | "day" | "week" | "month";
export type ListKind = "amounts" | "multipliers";

export const periods = ["hour", "day", "week", "month"] as const;

/**
 * The ways of pricing each type may use (decision 29), in the order they
 * are offered. The database holds the same rule
 * (product_pricing_method_by_type_check, pricing_method_not_allowed).
 */
export const methodsFor: Record<ProductType, readonly Method[]> = {
  vehicle: ["tiered", "per_period"],
  gear: ["tiered", "per_period", "fixed"],
  service: ["per_period", "fixed", "free"],
  sale_item: ["fixed"],
};

/** The six quick-entry boxes (§9.4), in screen order. */
export const boxes = [
  "hourly",
  "daily",
  "weekly",
  "twoWeeks",
  "threeWeeks",
  "monthly",
] as const;
export type Box = (typeof boxes)[number];
export type BoxValues = Record<Box, string>;

/** The day each box is the total for; the hourly box has none. */
export const boxDay: Record<Exclude<Box, "hourly">, number> = QUICK_ENTRY_DAYS;

export const emptyBoxes = (): BoxValues => ({
  hourly: "",
  daily: "",
  weekly: "",
  twoWeeks: "",
  threeWeeks: "",
  monthly: "",
});

/**
 * The rounding step quick entry fills days to, when the shop has not chosen
 * one (Settings come in stage D6). Thai baht: ฿10, as the design says; any
 * other currency: one major unit. Never a value assumed for every shop.
 */
export function suggestedStep(currency: string): bigint {
  const exponent = minorExponent(currency);
  const majorUnits = currency === "THB" ? "10" : "1";
  return BigInt(majorUnits + "0".repeat(exponent));
}

/** Multipliers are filled to four decimal places, as Booqable shows them. */
export const MULTIPLIER_STEP = BigInt(100);

// ------------------------------------------------------------------ a list

/** One day of a price list on screen. */
export type GridDay = {
  day: number;
  /** Null when this day can't be worked out yet (a box is missing or wrong). */
  value: bigint | null;
  source: DaySource;
  /** A day the owner typed by hand that isn't a valid number. */
  invalid?: boolean;
};

/** What the owner typed for a list: the boxes, and days edited by hand. */
export type ListDraft = {
  boxes: BoxValues;
  /** Days typed by hand (never a day whose box is filled), as typed. */
  manual: Record<number, string>;
};

export type ListResult = {
  /** Box errors: "invalid" (not a number) or "required" (daily, monthly). */
  boxErrors: Partial<Record<Box, "invalid" | "required">>;
  days: GridDay[];
  hourly: bigint | null;
  /** What stops a save: a day that falls, or isn't above zero. */
  problems: ListProblem[];
  /** True when the list can be saved as it is. */
  ok: boolean;
};

const parseValue = (text: string, kind: ListKind, currency: string) =>
  kind === "amounts" ? parseMinorUnits(text, currency) : parseMultiplier(text);

/** The value as it is typed into a box or a day: "300.00", or "1.1666". */
export function valueText(
  value: bigint | string,
  kind: ListKind,
  currency: string,
): string {
  return kind === "amounts"
    ? minorDecimal(value, currency)
    : multiplierText(value);
}

/** Box days that have a value typed: a hand-typed day there gives way. */
function anchoredDays(values: BoxValues): Set<number> {
  const days = new Set<number>();
  for (const box of boxes) {
    if (box !== "hourly" && values[box].trim()) days.add(boxDay[box]);
  }
  return days;
}

/**
 * The 30 days from what was typed. Entered boxes keep their exact value,
 * days typed by hand keep theirs, and the rest rise in equal steps between
 * them (fillPriceList), rounded to `step`. Equal neighbours are fine; a day
 * lower than the day before is a problem, and the list can't be saved.
 */
export function computeList(
  draft: ListDraft,
  kind: ListKind,
  currency: string,
  step: bigint,
): ListResult {
  const boxErrors: ListResult["boxErrors"] = {};
  const entry: QuickEntry = {};
  for (const box of boxes) {
    const value = parseValue(draft.boxes[box], kind, currency);
    if (value === "invalid" || value === BigInt(0)) boxErrors[box] = "invalid";
    else if (value !== null) entry[box] = value;
  }
  if (entry.daily === undefined && !boxErrors.daily)
    boxErrors.daily = "required";
  if (entry.monthly === undefined && !boxErrors.monthly)
    boxErrors.monthly = "required";

  const anchors = anchoredDays(draft.boxes);
  const manual = new Map<number, bigint>();
  const invalidDays = new Set<number>();
  for (const [key, text] of Object.entries(draft.manual)) {
    const day = Number(key);
    if (anchors.has(day)) continue;
    const value = parseValue(text, kind, currency);
    if (value === null) continue;
    if (value === "invalid" || value === BigInt(0)) invalidDays.add(day);
    else manual.set(day, value);
  }

  const dayNumbers = Array.from({ length: LIST_DAYS }, (_, i) => i + 1);
  if (Object.keys(boxErrors).length > 0) {
    // Without daily and monthly nothing can be filled: show what is known.
    const known = new Map<number, bigint>();
    for (const box of boxes) {
      if (box !== "hourly" && entry[box] !== undefined)
        known.set(boxDay[box], entry[box]!);
    }
    const days = dayNumbers.map((day): GridDay => {
      if (known.has(day))
        return { day, value: known.get(day)!, source: "anchor" };
      if (manual.has(day))
        return { day, value: manual.get(day)!, source: "manual" };
      return {
        day,
        value: null,
        source: invalidDays.has(day) ? "manual" : "filled",
        ...(invalidDays.has(day) ? { invalid: true } : {}),
      };
    });
    return { boxErrors, days, hourly: null, problems: [], ok: false };
  }

  const filled = fillPriceList(entry, manual, step);
  const days = filled.days.map((d): GridDay =>
    invalidDays.has(d.day)
      ? { day: d.day, value: null, source: "manual", invalid: true }
      : { day: d.day, value: d.total, source: d.source },
  );
  const problems =
    invalidDays.size > 0 ? [] : listProblems(filled.days.map((d) => d.total));
  return {
    boxErrors,
    days,
    hourly: filled.hourly,
    problems,
    ok: invalidDays.size === 0 && problems.length === 0,
  };
}

/** "Same price every day": the boxes from the daily price, days by hand cleared. */
export function sameEveryDayDraft(
  draft: ListDraft,
  kind: ListKind,
  currency: string,
): ListDraft | null {
  const daily = parseValue(draft.boxes.daily, kind, currency);
  if (daily === null || daily === "invalid" || daily === BigInt(0)) return null;
  const entry = sameEveryDay(daily);
  const text = (value: bigint | undefined) =>
    value === undefined ? "" : valueText(value, kind, currency);
  return {
    boxes: {
      hourly: draft.boxes.hourly,
      daily: text(entry.daily),
      weekly: text(entry.weekly),
      twoWeeks: text(entry.twoWeeks),
      threeWeeks: text(entry.threeWeeks),
      monthly: text(entry.monthly),
    },
    manual: {},
  };
}

/** A saved day of a list: its value (a string of digits) and how it got it. */
export type SavedDay = { day: number; value: string; source: DaySource };

/**
 * Back from a saved list to what the owner typed. A box shows its day's
 * value when that day was entered. Daily and monthly are always boxes. A day
 * typed by hand stays typed by hand. A list loaded as it was (every day by
 * hand, §9.11) keeps every day: typing in a box then changes that day only.
 */
export function draftFromSaved(
  days: readonly SavedDay[],
  hourly: string | null,
  kind: ListKind,
  currency: string,
): ListDraft {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const text = (value: string) => valueText(value, kind, currency);
  const draft: ListDraft = { boxes: emptyBoxes(), manual: {} };
  if (hourly) draft.boxes.hourly = text(hourly);
  for (const box of boxes) {
    if (box === "hourly") continue;
    const saved = byDay.get(boxDay[box]);
    if (!saved) continue;
    if (saved.source === "anchor" || box === "daily" || box === "monthly")
      draft.boxes[box] = text(saved.value);
  }
  const anchors = anchoredDays(draft.boxes);
  for (const saved of days) {
    if (saved.source === "manual" && !anchors.has(saved.day))
      draft.manual[saved.day] = text(saved.value);
  }
  return draft;
}

/** The 30 days as platform.save_price_template() and own_list take them. */
export function daysPayload(result: ListResult) {
  if (!result.ok) throw new RangeError("The list can't be saved yet");
  return result.days.map((d) => ({
    day: d.day,
    value: String(d.value),
    source: d.source,
  }));
}

// --------------------------------------------------------------- a product

/** Everything the Pricing tab's form holds, as typed. */
export type PricingDraft = {
  /** Null: not priced yet, and not being priced now. */
  method: Method | null;
  /** Flat fee per period. */
  flatAmount: string;
  flatPeriod: Period;
  /** Fixed price. */
  fixedAmount: string;
  /** By rental length: its own prices, or a shared list. */
  source: "own" | "shared";
  sharedId: string;
  /** On a multipliers list: this product's base price. */
  baseAmount: string;
  list: ListDraft;
  longStay: string;
  /** Vehicles, when the shop takes a deposit per product. */
  deposit: string;
  /** "default" (the shop's), "none" (not taxable), or a profile's id. */
  tax: string;
  /** Rental gear: what a lost item costs. */
  replacement: string;
};

export type PricingContext = {
  type: ProductType;
  currency: string;
  step: bigint;
  /** The shop's shared lists, with their kind. */
  sharedKinds: ReadonlyMap<string, ListKind>;
  /** The deposit field is on the form (a vehicle, deposits per product). */
  showDeposit: boolean;
  /** The tax picker is on the form (the shop has a tax profile). */
  showTax: boolean;
};

/** An error key per field, as FormErrors / Pricing.errors name them. */
export type DraftErrors = Record<string, string>;

/**
 * What platform.save_product_pricing() is sent, or what is wrong. Amounts go
 * as strings of digits. The function clears whatever doesn't belong to the
 * method chosen, and keeps what is not sent.
 */
export function pricingPayload(
  draft: PricingDraft,
  ctx: PricingContext,
):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const payload: Record<string, unknown> = {};
  const amount = (field: string, text: string, required: boolean) => {
    const value = parseMinorUnits(text, ctx.currency);
    if (value === "invalid") errors[field] = "invalidMoney";
    else if (value === BigInt(0)) errors[field] = "priceZero";
    else if (value === null && required) errors[field] = "required";
    else return value === null ? null : String(value);
    return undefined;
  };

  if (draft.method !== null) {
    if (!methodsFor[ctx.type].includes(draft.method)) {
      errors.method = "methodNotAllowed";
    } else {
      payload.pricing_method = draft.method;
      if (draft.method === "per_period") {
        payload.price_amount = amount("flatAmount", draft.flatAmount, true);
        payload.price_period = draft.flatPeriod;
      } else if (draft.method === "fixed") {
        payload.price_amount = amount("fixedAmount", draft.fixedAmount, true);
      } else if (draft.method === "tiered") {
        if (draft.source === "shared") {
          const kind = ctx.sharedKinds.get(draft.sharedId);
          if (!kind) errors.sharedId = "required";
          else {
            payload.price_template_id = draft.sharedId;
            if (kind === "multipliers")
              payload.base_amount = amount(
                "baseAmount",
                draft.baseAmount,
                true,
              );
          }
        } else {
          const list = computeList(
            draft.list,
            "amounts",
            ctx.currency,
            ctx.step,
          );
          if (!list.ok) errors.list = "listNotReady";
          else
            payload.own_list = {
              hourly: list.hourly === null ? null : String(list.hourly),
              days: daysPayload(list),
            };
        }
        payload.long_stay_day = amount("longStay", draft.longStay, false);
      }
    }
  }
  if (ctx.showDeposit)
    payload.deposit = amount("deposit", draft.deposit, false);
  // A deposit of 0 is allowed: it means "no deposit for this one".
  if (errors.deposit === "priceZero") {
    delete errors.deposit;
    payload.deposit = "0";
  }
  if (ctx.showTax) {
    payload.taxable = draft.tax !== "none";
    payload.tax_profile_id =
      draft.tax === "none" || draft.tax === "default" ? null : draft.tax;
  }
  if (ctx.type === "gear")
    payload.replacement_price = amount("replacement", draft.replacement, false);

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, payload };
}

/** Which tax choice a saved row is: not taxable, its own profile, or the shop's. */
export function taxChoice(row: {
  taxable: boolean;
  tax_profile_id: string | null;
}): string {
  if (!row.taxable) return "none";
  return row.tax_profile_id ?? "default";
}

/** A list's name: trimmed, 1 to 120 characters (as the database holds it). */
export function listNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "required";
  if (trimmed.length > 120) return "tooLong";
  return null;
}
