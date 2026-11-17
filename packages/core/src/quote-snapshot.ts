/**
 * The quote snapshot (docs/phase-2-plan.md §5.4). One priced invoice as plain
 * data, so an order never calls `quote()` on stored prices again and never
 * re-reads a tax profile, a price list, a season or a coupon.
 *
 * `snapshotQuote()` writes it; `readSnapshot()` reads it back. Phase 3 stores
 * it (`snapshot jsonb` on each order line and each invoice); nothing stores
 * it yet.
 *
 * The stored form is JSON with nothing JSON can't hold:
 *  - keys in snake_case, as the database's own rows are;
 *  - every amount a string of digits in minor units ("300000"; a signed one
 *    may lead with "-"), never a number, so no float can touch it;
 *  - every instant an ISO 8601 string in UTC;
 *  - a `version`.
 *
 * **This file prices nothing itself.** `snapshotQuote()` calls `quote()` on
 * the input it is given, so the snapshot can never disagree with its input,
 * then copies what went in and what came out, and takes each line's tax share
 * and deposit from `quote.ts`. Its only sums are additions and one
 * subtraction (a line's season total; what a discount took over its lines):
 * nothing here multiplies, divides or rounds.
 *
 * A line can be stored on its own (`snapshot jsonb` on an order line), so
 * each stored line carries the `version` too: `readSnapshotLine()` reads one.
 *
 * Changing the stored shape: add a step to `UPGRADES` that turns the version
 * before into the new one, and raise `SNAPSHOT_VERSION`. A stored snapshot is
 * never rewritten; an older one is upgraded as it is read.
 */

import {
  lineDeposits,
  lineTaxShares,
  quote as priceQuote,
  type DiscountSource,
  type Quote,
  type QuoteInput,
} from "./quote";
import type { PricePeriod, Pricing, UnitPrice } from "./rental-price";
import { chargedPeriodStarts } from "./season";

export const SNAPSHOT_VERSION = 1;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

function fail(message: string): never {
  throw new SnapshotError(message);
}

// ------------------------------------------------------------------ context

export type SnapshotProductType = "vehicle" | "gear" | "sale_item" | "service";

/**
 * What the pricer never needed and the record does: names, and the currency.
 * Everything is copied in as it is at this moment.
 */
export type SnapshotContext = {
  /** ISO 4217. */
  currency: string;
  /** The currency's decimal places as the amounts were priced: THB 2, VND 0. */
  exponent: number;
  pricedAt: Date;
  /** By line id. */
  lines: Readonly<
    Record<
      string,
      {
        productName: string;
        productType: SnapshotProductType;
        /** The profile the line's rate came from. Needed when it is taxable. */
        taxProfile?: { id: string; name: string } | null;
      }
    >
  >;
  /** By season rule id: needed for every rule that adjusted a line. */
  seasons?: Readonly<Record<string, { name: string }>>;
  /** By discount id: needed for every discount whose source is a coupon. */
  coupons?: Readonly<Record<string, { couponId: string; code: string }>>;
};

// ------------------------------------------------------- the snapshot, read

export type SnapshotLine = {
  /** The snapshot's version, on the line too: a line can be stored alone. */
  version: number;
  id: string;
  currency: string;
  exponent: number;
  productId: string;
  productName: string;
  productType: SnapshotProductType;
  /** The vehicle line this one is an extra of, or null. */
  parentLineId: string | null;
  start: Date;
  end: Date;
  /** The rental's original pickup when the line is a continuation. */
  rentalStart: Date | null;
  /** The location's time zone. */
  timeZone: string;
  /** The charged periods and their unit. Null for a fixed price or a free line. */
  periods: { unit: PricePeriod; count: number } | null;
  quantity: number;
  includedQuantity: number;
  chargedQuantity: number;
  /**
   * An extra's allowance: how many units came free with each vehicle when it
   * was priced (`extraOf.includedQuantity`). `includedQuantity` is capped at
   * the line's quantity, so this is the only place the allowance is kept:
   * 3 helmets taken where 2 scooters gave 4 reads 3 included and 2 here.
   * Null for a line with no parent.
   */
  includedPerVehicle: number | null;
  /** The price of one unit and how it was worked out (the pricer's basis). */
  unitPrice: UnitPrice;
  /** Unit price × charged quantity. */
  listPrice: bigint;
  /**
   * The way of pricing as it was passed in: the list's 30 totals, the hourly
   * price, the long-stay rate, or the flat fee. A swap and an early return
   * take their shares from these, never from today's prices.
   */
  pricing: Pricing;
  seasons: Array<{
    ruleId: string;
    name: string;
    /** Basis points, signed: −2000 is 20% off. */
    adjustBp: number;
    periodsInside: number;
    periods: number;
    /** Signed. */
    amount: bigint;
  }>;
  /** Signed: the season price less the list price. */
  seasonTotal: bigint;
  seasonPrice: bigint;
  discounts: Array<{
    discountId: string;
    source: DiscountSource;
    couponId: string | null;
    couponCode: string | null;
    kind: "percent" | "fixed";
    /** A percentage discount's basis points. */
    percentBp: number | null;
    /** A fixed discount's whole amount, over all its lines. */
    fixedAmount: bigint | null;
    /** What it took from this line. */
    amount: bigint;
  }>;
  discountTotal: bigint;
  /** What the line comes to. */
  amount: bigint;
  taxable: boolean;
  taxRateBp: number | null;
  /** Kept for reference only: nothing reads the profile through it. */
  taxProfileId: string | null;
  taxProfileName: string | null;
  /** The shop's style when it was priced. */
  taxInclusive: boolean;
  /** The line's share of its rate group's VAT. 0 when it is not taxable. */
  taxAmount: bigint;
  /** Per-vehicle mode: this line's deposit. Otherwise null: it is the invoice's. */
  deposit: bigint | null;
};

export type QuoteSnapshot = {
  version: number;
  currency: string;
  exponent: number;
  pricedAt: Date;
  taxInclusive: boolean;
  lines: SnapshotLine[];
  /** One per tax rate, lowest first: the invoice's VAT lines. */
  taxGroups: Array<{
    rateBp: number;
    profileNames: string[];
    base: bigint;
    net: bigint;
    vat: bigint;
    gross: bigint;
    taxInclusive: boolean;
  }>;
  nonTaxable: bigint;
  credits: Array<{ id: string; amount: bigint; taxRateBp: number | null }>;
  /**
   * Every discount the invoice was priced with, in the order applied, one
   * that took nothing included (a coupon on lines that came to 0 is still
   * a use of the coupon).
   */
  discounts: Array<{
    discountId: string;
    source: DiscountSource;
    couponId: string | null;
    couponCode: string | null;
    kind: "percent" | "fixed";
    percentBp: number | null;
    /** A fixed discount's whole amount, as it was given. */
    fixedAmount: bigint | null;
    /** True: it was aimed at every line. Then `lineIds` is empty. */
    allLines: boolean;
    /** The lines it was aimed at, when not all of them. */
    lineIds: string[];
    /** What it took over all its lines. May be 0. */
    total: bigint;
  }>;
  totals: {
    listPrice: bigint;
    /** Signed. */
    seasons: bigint;
    discount: bigint;
    credit: bigint;
    net: bigint;
    vat: bigint;
    total: bigint;
  };
  deposit: {
    amount: bigint;
    mode: "none" | "percent_of_order" | "fixed_per_order" | "per_product";
    /** The percentage, in the percentage mode. */
    percentBp: number | null;
    /** The fixed amount, or the per-vehicle mode's amount for a vehicle with none. */
    fixedAmount: bigint | null;
    from: "order" | "customer" | "shop";
  };
};

// ----------------------------------------------------- the snapshot, stored

export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json };

/** The stored form: plain JSON. Read it only through `readSnapshot()`. */
export type StoredSnapshot = { version: number; [key: string]: Json };

// The shape of the stored form, field by field. Writing and reading both walk
// it, and both are strict: a field the shape does not name, or one it names
// that is missing, is an error, so the type above and the stored form can't
// drift apart without a test failing.

type Shape =
  | { is: "money" | "signed" | "text" | "bool" | "instant" | "currency" }
  | { is: "int"; min?: number; max?: number }
  | { is: "one_of"; values: readonly string[] }
  | { is: "nullable"; of: Shape }
  | { is: "list"; of: Shape }
  | { is: "record"; fields: Fields }
  | { is: "union"; tag: string; variants: Readonly<Record<string, Fields>> }
  | { is: "lazy"; shape: () => Shape };
type Fields = Readonly<Record<string, Shape>>;

const money: Shape = { is: "money" };
const signed: Shape = { is: "signed" };
const int: Shape = { is: "int" };
/** A whole number in a range, both ends included. */
const intIn = (min: number, max?: number): Shape => ({ is: "int", min, max });
const count = intIn(0);
const version = intIn(1);
const currencyCode: Shape = { is: "currency" };
const exponent = intIn(0, 4);
const rateBp = intIn(0, 10000);
const text: Shape = { is: "text" };
const bool: Shape = { is: "bool" };
const instant: Shape = { is: "instant" };
const oneOf = (...values: string[]): Shape => ({ is: "one_of", values });
const nullable = (of: Shape): Shape => ({ is: "nullable", of });
const list = (of: Shape): Shape => ({ is: "list", of });
const record = (fields: Fields): Shape => ({ is: "record", fields });

const period = oneOf("hour", "day", "week", "month");

const pricingShape: Shape = {
  is: "union",
  tag: "method",
  variants: {
    tiered: {
      list: record({ days: list(money), hourly: nullable(money) }),
      longStayDay: nullable(money),
    },
    per_period: { amount: money, period },
    fixed: { amount: money },
    free: {},
  },
};

const unitPriceShape: Shape = record({
  amount: money,
  basis: {
    is: "union",
    tag: "kind",
    variants: {
      hours: { hours: int, hourly: money, capped: bool },
      list: { days: int },
      months: {
        days: int,
        months: int,
        monthly: money,
        leftoverDays: int,
        longStayDay: money,
        longStayFromMonthly: bool,
        leftoverCapped: bool,
        underOneMonth: bool,
      },
      periods: { period, count: int },
      fixed: {},
      free: {},
      continuation: {
        rentalStart: instant,
        whole: { is: "lazy", shape: () => unitPriceShape },
        soFar: { is: "lazy", shape: () => unitPriceShape },
      },
    },
  },
});

const discountFields = {
  discountId: text,
  source: oneOf("coupon", "staff", "returning_customer", "other"),
  couponId: nullable(text),
  couponCode: nullable(text),
  kind: oneOf("percent", "fixed"),
  percentBp: nullable(int),
  fixedAmount: nullable(money),
};

const lineShape = record({
  version,
  id: text,
  currency: currencyCode,
  exponent,
  productId: text,
  productName: text,
  productType: oneOf("vehicle", "gear", "sale_item", "service"),
  parentLineId: nullable(text),
  start: instant,
  end: instant,
  rentalStart: nullable(instant),
  timeZone: text,
  periods: nullable(record({ unit: period, count })),
  quantity: intIn(1),
  includedQuantity: count,
  chargedQuantity: count,
  includedPerVehicle: nullable(count),
  unitPrice: unitPriceShape,
  listPrice: money,
  pricing: pricingShape,
  seasons: list(
    record({
      ruleId: text,
      name: text,
      adjustBp: int,
      periodsInside: count,
      periods: count,
      amount: signed,
    }),
  ),
  seasonTotal: signed,
  seasonPrice: money,
  discounts: list(record({ ...discountFields, amount: money })),
  discountTotal: money,
  amount: money,
  taxable: bool,
  taxRateBp: nullable(rateBp),
  taxProfileId: nullable(text),
  taxProfileName: nullable(text),
  taxInclusive: bool,
  taxAmount: money,
  deposit: nullable(money),
});

const snapshotShape = record({
  version,
  currency: currencyCode,
  exponent,
  pricedAt: instant,
  taxInclusive: bool,
  lines: list(lineShape),
  taxGroups: list(
    record({
      rateBp,
      profileNames: list(text),
      base: money,
      net: money,
      vat: money,
      gross: money,
      taxInclusive: bool,
    }),
  ),
  nonTaxable: money,
  credits: list(
    record({ id: text, amount: money, taxRateBp: nullable(rateBp) }),
  ),
  discounts: list(
    record({
      ...discountFields,
      allLines: bool,
      lineIds: list(text),
      total: money,
    }),
  ),
  totals: record({
    listPrice: money,
    seasons: signed,
    discount: money,
    credit: money,
    net: money,
    vat: money,
    total: money,
  }),
  deposit: record({
    amount: money,
    mode: oneOf("none", "percent_of_order", "fixed_per_order", "per_product"),
    percentBp: nullable(int),
    fixedAmount: nullable(money),
    from: oneOf("order", "customer", "shop"),
  }),
});

const snake = (key: string) =>
  key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ZERO = BigInt(0);

/** A whole number inside the shape's range. */
function wholeIn(shape: { min?: number; max?: number }, value: unknown) {
  return (
    Number.isSafeInteger(value) &&
    (shape.min === undefined || (value as number) >= shape.min) &&
    (shape.max === undefined || (value as number) <= shape.max)
  );
}

/** What a whole number must be, for an error message. */
function wholeWords(shape: { min?: number; max?: number }): string {
  if (shape.min === undefined) return "a whole number";
  return shape.max === undefined
    ? `a whole number of ${shape.min} or more`
    : `a whole number from ${shape.min} to ${shape.max}`;
}

const isCurrency = (value: unknown) =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);

/** A value as the pricer has it → its stored form. */
function encode(shape: Shape, value: unknown, at: string): Json {
  const wrong = (what: string): never =>
    fail(`Can't snapshot ${at}: expected ${what}`);
  switch (shape.is) {
    case "money":
      if (typeof value !== "bigint" || value < ZERO)
        wrong("an amount of 0 or more");
      return String(value);
    case "signed":
      if (typeof value !== "bigint") wrong("an amount");
      return String(value);
    case "int":
      if (!wholeIn(shape, value)) wrong(wholeWords(shape));
      return value as number;
    case "currency":
      if (!isCurrency(value)) wrong("a currency code of three capitals");
      return value as string;
    case "text":
      if (typeof value !== "string") wrong("text");
      return value as string;
    case "bool":
      if (typeof value !== "boolean") wrong("true or false");
      return value as boolean;
    case "instant":
      if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        wrong("a date and time");
      return (value as Date).toISOString();
    case "one_of":
      if (typeof value !== "string" || !shape.values.includes(value))
        wrong(`one of ${shape.values.join(", ")}`);
      return value as string;
    case "nullable":
      return value === null || value === undefined
        ? null
        : encode(shape.of, value, at);
    case "list":
      if (!Array.isArray(value)) wrong("a list");
      return (value as unknown[]).map((item, index) =>
        encode(shape.of, item, `${at}[${index}]`),
      );
    case "record":
      return encodeFields(shape.fields, value, at);
    case "union": {
      if (!isObject(value)) return wrong("an object");
      const tag = value[shape.tag];
      const fields =
        typeof tag === "string" && Object.hasOwn(shape.variants, tag)
          ? shape.variants[tag]
          : wrong(`a known ${shape.tag}`);
      return {
        [snake(shape.tag)]: tag as string,
        ...encodeFields(fields, value, at, shape.tag),
      };
    }
    case "lazy":
      return encode(shape.shape(), value, at);
  }
}

function encodeFields(
  fields: Fields,
  value: unknown,
  at: string,
  tag?: string,
): { [key: string]: Json } {
  if (!isObject(value)) return fail(`Can't snapshot ${at}: expected an object`);
  for (const key of Object.keys(value)) {
    if (key !== tag && value[key] !== undefined && !Object.hasOwn(fields, key))
      fail(`Can't snapshot ${at}.${key}: the snapshot has no such field`);
  }
  const stored: { [key: string]: Json } = {};
  for (const [key, shape] of Object.entries(fields)) {
    stored[snake(key)] = encode(shape, value[key], `${at}.${key}`);
  }
  return stored;
}

/** A stored value → the value as the pricer has it. */
function decode(shape: Shape, stored: unknown, at: string): unknown {
  const wrong = (what: string): never =>
    fail(`Can't read the snapshot at ${at}: expected ${what}`);
  switch (shape.is) {
    // One spelling for one amount: no leading zeros, no "-0".
    case "money":
      if (typeof stored !== "string" || !/^(0|[1-9]\d*)$/.test(stored))
        wrong("a string of digits with no leading zero");
      return BigInt(stored as string);
    case "signed":
      if (typeof stored !== "string" || !/^(0|-?[1-9]\d*)$/.test(stored))
        wrong("a string of digits with no leading zero");
      return BigInt(stored as string);
    case "int":
      if (!wholeIn(shape, stored)) wrong(wholeWords(shape));
      return stored;
    case "currency":
      if (!isCurrency(stored)) wrong("a currency code of three capitals");
      return stored;
    case "text":
      if (typeof stored !== "string") wrong("text");
      return stored;
    case "bool":
      if (typeof stored !== "boolean") wrong("true or false");
      return stored;
    case "instant": {
      const date = typeof stored === "string" ? new Date(stored) : null;
      // Only what `toISOString()` writes: one spelling for one instant.
      if (
        !date ||
        Number.isNaN(date.getTime()) ||
        date.toISOString() !== stored
      )
        wrong("an ISO date and time in UTC");
      return date;
    }
    case "one_of":
      if (typeof stored !== "string" || !shape.values.includes(stored))
        wrong(`one of ${shape.values.join(", ")}`);
      return stored;
    case "nullable":
      return stored === null ? null : decode(shape.of, stored, at);
    case "list":
      if (!Array.isArray(stored)) wrong("a list");
      return (stored as unknown[]).map((item, index) =>
        decode(shape.of, item, `${at}[${index}]`),
      );
    case "record":
      return decodeFields(shape.fields, stored, at);
    case "union": {
      if (!isObject(stored)) return wrong("an object");
      const tag = stored[snake(shape.tag)];
      const fields =
        typeof tag === "string" && Object.hasOwn(shape.variants, tag)
          ? shape.variants[tag]
          : wrong(`a known ${shape.tag}`);
      return {
        [shape.tag]: tag,
        ...decodeFields(fields, stored, at, snake(shape.tag)),
      };
    }
    case "lazy":
      return decode(shape.shape(), stored, at);
  }
}

function decodeFields(
  fields: Fields,
  stored: unknown,
  at: string,
  tag?: string,
): Record<string, unknown> {
  if (!isObject(stored)) {
    return fail(`Can't read the snapshot at ${at}: expected an object`);
  }
  const known = new Set(Object.keys(fields).map(snake));
  for (const key of Object.keys(stored)) {
    if (key !== tag && !known.has(key))
      fail(`Can't read the snapshot at ${at}.${key}: no such field`);
  }
  const value: Record<string, unknown> = {};
  for (const [key, shape] of Object.entries(fields)) {
    const name = snake(key);
    if (!Object.hasOwn(stored, name))
      fail(`Can't read the snapshot at ${at}.${name}: it is missing`);
    value[key] = decode(shape, stored[name], `${at}.${name}`);
  }
  return value;
}

// -------------------------------------------------------------------- write

/** The unit a line's charged periods are counted in, or null for none. */
function periodUnit(unit: UnitPrice): PricePeriod | null {
  const basis = unit.basis;
  switch (basis.kind) {
    case "hours":
      return "hour";
    case "list":
    case "months":
      return "day";
    case "periods":
      return basis.period;
    case "fixed":
    case "free":
      return null;
    case "continuation":
      return periodUnit(basis.whole);
  }
}

function buildSnapshot(
  input: QuoteInput,
  quote: Extract<Quote, { ok: true }>,
  context: SnapshotContext,
): QuoteSnapshot {
  if (!/^[A-Z]{3}$/.test(context.currency))
    fail(`Not a currency code: ${context.currency}`);
  if (
    !Number.isInteger(context.exponent) ||
    context.exponent < 0 ||
    context.exponent > 4
  )
    fail(`Not a currency exponent: ${context.exponent}`);

  const discounts = new Map<
    string,
    NonNullable<QuoteInput["discounts"]>[number]
  >();
  for (const discount of input.discounts ?? []) {
    if (discounts.has(discount.id))
      fail(`Two discounts share the id ${discount.id}`);
    discounts.set(discount.id, discount);
  }
  const seasonRules = new Map(
    (input.seasonRules ?? []).map((rule) => [rule.id, rule]),
  );
  const taxShares = lineTaxShares(quote.lines, quote.taxGroups);
  const deposits = lineDeposits(quote.deposit.setting, input.lines);

  /** A discount as the record names it: on a line, and on the invoice. */
  const named = (discount: NonNullable<QuoteInput["discounts"]>[number]) => {
    const isCoupon = discount.source === "coupon";
    const coupon = Object.hasOwn(context.coupons ?? {}, discount.id)
      ? context.coupons![discount.id]
      : null;
    if (isCoupon && !coupon)
      fail(`Coupon ${discount.id}: the snapshot needs its id and code`);
    return {
      discountId: discount.id,
      source: discount.source,
      couponId: isCoupon ? coupon!.couponId : null,
      couponCode: isCoupon ? coupon!.code : null,
      kind:
        discount.percentBp !== undefined
          ? ("percent" as const)
          : ("fixed" as const),
      percentBp: discount.percentBp ?? null,
      fixedAmount: discount.amount ?? null,
    };
  };

  const lines: SnapshotLine[] = quote.lines.map((line, index) => {
    const from = input.lines[index];
    const about = Object.hasOwn(context.lines, line.id)
      ? context.lines[line.id]
      : fail(`Line ${line.id}: the snapshot needs its product's name and type`);
    if ((about.productType === "vehicle") !== from.vehicle)
      fail(`Line ${line.id}: its product type and the priced line disagree`);
    if (from.pricing === null) fail(`Line ${line.id} has no price`);
    const profile = about.taxProfile ?? null;
    if (line.taxRateBp !== null && !profile)
      fail(`Line ${line.id} is taxed: the snapshot needs its tax profile`);

    const starts = chargedPeriodStarts(line.unit, from.span);
    const unit = periodUnit(line.unit);
    return {
      version: SNAPSHOT_VERSION,
      id: line.id,
      currency: context.currency,
      exponent: context.exponent,
      productId: line.productId,
      productName: about.productName,
      productType: about.productType,
      parentLineId: line.parentLineId,
      start: from.span.start,
      end: from.span.end,
      rentalStart: from.rentalStart ?? null,
      timeZone: from.span.timeZone,
      periods:
        starts === null || unit === null
          ? null
          : { unit, count: starts.length },
      quantity: line.quantity,
      includedQuantity: line.includedQuantity,
      chargedQuantity: line.chargedQuantity,
      includedPerVehicle: from.extraOf ? from.extraOf.includedQuantity : null,
      unitPrice: line.unit,
      listPrice: line.listPrice,
      pricing: from.pricing,
      seasons: line.seasons.map((season) => {
        const rule = seasonRules.get(season.ruleId);
        const named = context.seasons?.[season.ruleId];
        if (!rule || !named)
          return fail(`Season ${season.ruleId}: the snapshot needs its name`);
        return {
          ruleId: season.ruleId,
          name: named.name,
          adjustBp: rule.adjustBp,
          periodsInside: season.periodsInside,
          periods: starts === null ? 0 : starts.length,
          amount: season.amount,
        };
      }),
      seasonTotal: line.seasonPrice - line.listPrice,
      seasonPrice: line.seasonPrice,
      discounts: line.discounts.map((taken) => {
        const discount =
          discounts.get(taken.discountId) ??
          fail(`Discount ${taken.discountId} is not in the input`);
        return { ...named(discount), amount: taken.amount };
      }),
      discountTotal: line.discount,
      amount: line.amount,
      taxable: line.taxRateBp !== null,
      taxRateBp: line.taxRateBp,
      taxProfileId: line.taxRateBp === null ? null : profile!.id,
      taxProfileName: line.taxRateBp === null ? null : profile!.name,
      taxInclusive: input.taxInclusive,
      taxAmount: taxShares[index],
      deposit: deposits[index],
    };
  });

  const setting = quote.deposit.setting;

  return {
    version: SNAPSHOT_VERSION,
    currency: context.currency,
    exponent: context.exponent,
    pricedAt: context.pricedAt,
    taxInclusive: input.taxInclusive,
    lines,
    taxGroups: quote.taxGroups.map((group) => ({
      rateBp: group.rateBp,
      profileNames: [
        ...new Set(
          lines
            .filter((line) => line.taxRateBp === group.rateBp)
            .map((line) => line.taxProfileName!),
        ),
      ],
      base: group.base,
      net: group.net,
      vat: group.vat,
      gross: group.gross,
      taxInclusive: input.taxInclusive,
    })),
    nonTaxable: quote.nonTaxable,
    credits: (input.credits ?? []).map((credit) => ({
      id: credit.id,
      amount: credit.amount,
      taxRateBp: credit.taxRateBp,
    })),
    // Every discount given, in order: one that took nothing is still here.
    discounts: [...discounts.values()].map((discount) => ({
      ...named(discount),
      allLines: discount.lines === "all",
      lineIds: discount.lines === "all" ? [] : [...discount.lines],
      // What it took, added up over the lines: an addition, nothing more.
      total: quote.lines.reduce(
        (sum, line) =>
          line.discounts
            .filter((taken) => taken.discountId === discount.id)
            .reduce((all, taken) => all + taken.amount, sum),
        ZERO,
      ),
    })),
    totals: { ...quote.totals },
    deposit: {
      amount: quote.deposit.amount,
      mode: setting.mode,
      percentBp: setting.mode === "percent_of_order" ? setting.percentBp : null,
      fixedAmount:
        setting.mode === "fixed_per_order" || setting.mode === "per_product"
          ? (setting.amount ?? null)
          : null,
      from: quote.deposit.from,
    },
  };
}

/**
 * One invoice, priced and turned into plain data, ready to store.
 *
 * It calls `quote()` on `input` itself (owner, 17 Nov 2026), so a snapshot
 * can never hold one invoice's prices beside another's figures. `context`
 * adds the names and the currency. The answer shares nothing with its
 * arguments: changing them afterwards does not change it.
 *
 * Throws `SnapshotError` for an invoice with a line that can't be priced (a
 * snapshot is of a priced invoice), and for a line whose span has charge
 * rules: they are not in the stored shape yet, and must not be dropped
 * silently on the day they are built. Bad input throws `QuoteError`, as
 * `quote()` does.
 */
export function snapshotQuote(
  input: QuoteInput,
  context: SnapshotContext,
): StoredSnapshot {
  for (const line of input.lines) {
    if (line.span.rules && Object.keys(line.span.rules).length > 0) {
      fail(
        `Line ${line.id} has charge rules: the snapshot does not store them yet`,
      );
    }
  }
  const quote = priceQuote(input);
  if (!quote.ok) {
    return fail(
      `Can't snapshot an invoice that can't be priced: ${quote.unpriced
        .map((line) => line.lineId)
        .join(", ")}`,
    );
  }
  return encode(
    snapshotShape,
    buildSnapshot(input, quote, context),
    "the quote",
  ) as StoredSnapshot;
}

// --------------------------------------------------------------------- read

type StoredObject = { [key: string]: Json };
type Step = (older: StoredObject) => StoredObject;

/**
 * How one version becomes the next. `invoice` changes the snapshot outside
 * its lines; `line` changes one stored line, and is all a line stored on its
 * own needs. Steps add or rename fields; none may work out an amount.
 */
export type Upgrade = { invoice?: Step; line?: Step };

/**
 * One step per version that has been replaced: `UPGRADES[n]` turns a stored
 * snapshot of version n into version n + 1. Empty while version 1 is the
 * only one.
 */
const UPGRADES: Readonly<Record<number, Upgrade>> = {};

/** The version of a stored snapshot or line, checked against `current`. */
function storedVersion(data: StoredObject, current: number): number {
  const version = data.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    return fail("A snapshot has a version");
  if (version > current) {
    return fail(
      `This snapshot is version ${version}; this code reads up to ${current}`,
    );
  }
  return version;
}

function stepFrom(
  upgrades: Readonly<Record<number, Upgrade>>,
  version: number,
): Upgrade {
  return Object.hasOwn(upgrades, version)
    ? upgrades[version]
    : fail(`No way to read a version ${version} snapshot`);
}

/**
 * A stored snapshot of any version → the stored form of `current`, its lines
 * with it. Throws for a version newer than this code knows: it must not be
 * guessed at. (`upgrades` and `current` are arguments so the chain can be
 * tested before a second version exists.)
 */
export function upgradeSnapshot(
  stored: unknown,
  upgrades: Readonly<Record<number, Upgrade>> = UPGRADES,
  current: number = SNAPSHOT_VERSION,
): StoredSnapshot {
  if (!isObject(stored)) return fail("A snapshot is an object");
  let data = stored as StoredObject;
  let version = storedVersion(data, current);
  // A snapshot and its lines are written together and upgraded together.
  if (
    !Array.isArray(data.lines) ||
    data.lines.some((line) => !isObject(line) || line.version !== version)
  ) {
    return fail("Every line of a snapshot carries the snapshot's version");
  }
  while (version < current) {
    const step = stepFrom(upgrades, version);
    const next = step.invoice ? step.invoice(data) : data;
    const lines = Array.isArray(next.lines) ? next.lines : [];
    data = {
      ...next,
      lines: lines.map((line) => ({
        ...(step.line
          ? step.line(line as StoredObject)
          : (line as StoredObject)),
        version: version + 1,
      })),
      version: version + 1,
    };
    version += 1;
  }
  return data as StoredSnapshot;
}

/**
 * One stored line of any version → the stored form of `current`: the line
 * steps of the same chain, with no invoice around it.
 */
export function upgradeSnapshotLine(
  stored: unknown,
  upgrades: Readonly<Record<number, Upgrade>> = UPGRADES,
  current: number = SNAPSHOT_VERSION,
): StoredSnapshot {
  if (!isObject(stored)) return fail("A snapshot line is an object");
  let data = stored as StoredObject;
  let version = storedVersion(data, current);
  while (version < current) {
    const step = stepFrom(upgrades, version);
    data = { ...(step.line ? step.line(data) : data), version: version + 1 };
    version += 1;
  }
  return data as StoredSnapshot;
}

/**
 * Reads a stored snapshot back: amounts as `bigint`, instants as `Date`.
 * It takes the stored data and nothing else, so it can't look anything up:
 * what a profile, a price list, a season or a coupon says today is not its
 * business.
 *
 * Strict about the shape and about each value on its own: a missing or
 * unknown field throws `SnapshotError`, and so does an amount that is not a
 * string of digits or has a leading zero, a quantity under 1, an exponent
 * outside 0 to 4, a tax rate outside 0 to 10000, or a currency that is not
 * three capitals. It does not check that the lines add up to the totals:
 * that is Phase 3's save check, by addition alone.
 */
export function readSnapshot(stored: unknown): QuoteSnapshot {
  return decode(
    snapshotShape,
    upgradeSnapshot(stored),
    "snapshot",
  ) as QuoteSnapshot;
}

/**
 * Reads one stored line on its own, as an order line keeps it
 * (`snapshot jsonb`): the line carries its version, so it is upgraded and
 * read without its invoice. As strict as `readSnapshot()`.
 */
export function readSnapshotLine(stored: unknown): SnapshotLine {
  return decode(lineShape, upgradeSnapshotLine(stored), "line") as SnapshotLine;
}
