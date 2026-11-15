/**
 * Price lists (docs/products-redesign.md §9.3 and §9.4). Pure functions.
 *
 * A price list is a total for each rental length from 1 to 30 days and,
 * optionally, an hourly price. It is one of two kinds, as Booqable has them:
 * amounts, or multipliers of a base price that each product sets.
 *
 * Money is `bigint` minor units of the shop's currency (THB: satang). Nothing
 * here knows a currency: the rounding step and every amount are passed in.
 * There are no floats and no `n` literals (apps compile this file too, at a
 * lower language target).
 */

export const LIST_DAYS = 30;

/**
 * A multiplier is a whole number of millionths: 1.1666 is 1166600. Six
 * decimal places (owner, 15 Nov 2026): BSR's Booqable lists need four, and
 * six leaves room.
 */
export const MULTIPLIER_SCALE = BigInt(1000000);

const ZERO = BigInt(0);
const TWO = BigInt(2);

function assertAmount(value: bigint, what: string): void {
  if (typeof value !== "bigint") {
    throw new TypeError(`${what} must be a bigint, got ${typeof value}`);
  }
  if (value <= ZERO) throw new RangeError(`${what} must be more than 0`);
}

/**
 * numerator ÷ divisor, rounded half up, in integers. For amounts that are
 * never negative. This is the one rounding rule for prices (§9.9).
 */
export function divideHalfUp(numerator: bigint, divisor: bigint): bigint {
  if (numerator < ZERO) throw new RangeError("Can't round a negative amount");
  if (divisor <= ZERO) throw new RangeError("Divisor must be more than 0");
  return (TWO * numerator + divisor) / (TWO * divisor);
}

/** numerator ÷ divisor, rounded half up to a whole number of `step`. */
function divideToStep(
  numerator: bigint,
  divisor: bigint,
  step: bigint,
): bigint {
  return divideHalfUp(numerator, divisor * step) * step;
}

/**
 * The total for day `d` between two entered prices: a + (b − a) × (d − da) ÷
 * (db − da), rounded half up to the rounding step.
 */
export function interpolateToStep(
  da: number,
  a: bigint,
  db: number,
  b: bigint,
  d: number,
  step: bigint,
): bigint {
  // a × (db − d) + b × (d − da) is the same sum and is never negative.
  const numerator = a * BigInt(db - d) + b * BigInt(d - da);
  return divideToStep(numerator, BigInt(db - da), step);
}

/**
 * Past the last entered price (the marketplace's extras only): continue at
 * that price's daily rate. From a day-1 price alone it is exactly price × days.
 */
export function extrapolateToStep(
  dl: number,
  last: bigint,
  d: number,
  step: bigint,
): bigint {
  if (dl === 1) return last * BigInt(d);
  return divideToStep(last * BigInt(d), BigInt(dl), step);
}

// ---------------------------------------------------------------- quick entry

/** Quick price entry (§9.4): up to six prices; the days between fill in. */
export type QuickEntry = {
  hourly?: bigint;
  daily?: bigint;
  weekly?: bigint;
  twoWeeks?: bigint;
  threeWeeks?: bigint;
  monthly?: bigint;
};

/** The day each quick-entry box is the total for. A month is the 30-day total. */
export const QUICK_ENTRY_DAYS = {
  daily: 1,
  weekly: 7,
  twoWeeks: 14,
  threeWeeks: 21,
  monthly: 30,
} as const;

export type QuickEntryBox = keyof typeof QUICK_ENTRY_DAYS;

const BOXES = Object.keys(QUICK_ENTRY_DAYS) as QuickEntryBox[];

export type QuickEntryError = "daily_required" | "monthly_required";

/** Daily and monthly are required; the rest are optional. */
export function quickEntryErrors(entry: QuickEntry): QuickEntryError[] {
  const errors: QuickEntryError[] = [];
  if (entry.daily === undefined) errors.push("daily_required");
  if (entry.monthly === undefined) errors.push("monthly_required");
  return errors;
}

/** "Same price every day": the five boxes from one daily price. */
export function sameEveryDay(daily: bigint): QuickEntry {
  assertAmount(daily, "The daily price");
  const entry: QuickEntry = {};
  for (const box of BOXES) {
    entry[box] = daily * BigInt(QUICK_ENTRY_DAYS[box]);
  }
  return entry;
}

export type DaySource = "anchor" | "filled" | "manual";

export type ListDay = { day: number; total: bigint; source: DaySource };

/** Totals edited by hand, by day (never a day that has a quick-entry price). */
export type ManualTotals = ReadonlyMap<number, bigint>;

/**
 * The 30 days of a list from quick entry. An entered price keeps its exact
 * total ("anchor"); a day edited by hand keeps the owner's value ("manual");
 * every other day rises in equal steps between the entered prices around it,
 * rounded half up to the shop's rounding step ("filled").
 *
 * `step` is in minor units (THB ฿10 = 1000). It shapes filled days only:
 * entered and hand-edited totals are never rounded.
 */
export function fillPriceList(
  entry: QuickEntry,
  manual: ManualTotals,
  step: bigint,
): { days: ListDay[]; hourly: bigint | null } {
  const errors = quickEntryErrors(entry);
  if (errors.length > 0) {
    throw new RangeError(`Quick entry is incomplete: ${errors.join(", ")}`);
  }
  assertAmount(step, "The rounding step");
  if (entry.hourly !== undefined)
    assertAmount(entry.hourly, "The hourly price");

  const anchors: Array<[number, bigint]> = [];
  for (const box of BOXES) {
    const total = entry[box];
    if (total === undefined) continue;
    assertAmount(total, `The ${box} price`);
    anchors.push([QUICK_ENTRY_DAYS[box], total]);
  }

  for (const [day, total] of manual) {
    if (!Number.isInteger(day) || day < 1 || day > LIST_DAYS) {
      throw new RangeError(
        `A hand-edited day must be 1–${LIST_DAYS}, got ${day}`,
      );
    }
    if (anchors.some(([d]) => d === day)) {
      throw new RangeError(
        `Day ${day} has a quick-entry price; change that instead`,
      );
    }
    assertAmount(total, `The day-${day} price`);
  }

  const days: ListDay[] = [];
  for (let day = 1; day <= LIST_DAYS; day++) {
    const anchor = anchors.find(([d]) => d === day);
    if (anchor) {
      days.push({ day, total: anchor[1], source: "anchor" });
      continue;
    }
    const byHand = manual.get(day);
    if (byHand !== undefined) {
      days.push({ day, total: byHand, source: "manual" });
      continue;
    }
    // Days 1 and 30 are always entered, so both neighbours exist.
    const before = anchors.filter(([d]) => d < day).at(-1)!;
    const after = anchors.find(([d]) => d > day)!;
    days.push({
      day,
      total: interpolateToStep(
        before[0],
        before[1],
        after[0],
        after[1],
        day,
        step,
      ),
      source: "filled",
    });
  }
  return { days, hourly: entry.hourly ?? null };
}

// ----------------------------------------------------------------- validation

export type ListProblem =
  | { kind: "wrong_length"; length: number }
  | { kind: "not_positive"; day: number }
  /** This day's total is lower than the day before it. */
  | { kind: "falls"; day: number };

/**
 * What stops a list from being saved (owner, 15 Nov 2026): it must have all
 * 30 days, every total above zero, and no total lower than the day before.
 * **Equal totals on neighbouring days are allowed.**
 */
export function listProblems(totals: readonly bigint[]): ListProblem[] {
  if (totals.length !== LIST_DAYS) {
    return [{ kind: "wrong_length", length: totals.length }];
  }
  const problems: ListProblem[] = [];
  totals.forEach((total, index) => {
    const day = index + 1;
    if (total <= ZERO) problems.push({ kind: "not_positive", day });
    else if (index > 0 && total < totals[index - 1]) {
      problems.push({ kind: "falls", day });
    }
  });
  return problems;
}

// ---------------------------------------------------------------- the two kinds

export type PriceList =
  | {
      kind: "amounts";
      /** Totals for 1 to 30 days, minor units. */
      days: readonly bigint[];
      hourly?: bigint | null;
    }
  | {
      kind: "multipliers";
      /** Multipliers for 1 to 30 days, in millionths. */
      days: readonly bigint[];
      /** The hourly multiplier, in millionths. */
      hourly?: bigint | null;
    };

/** A list as money: what the price lookup reads. */
export type ResolvedList = {
  /** Totals for 1 to 30 days, minor units. Never falls as days rise. */
  days: readonly bigint[];
  hourly: bigint | null;
};

/** base × multiplier, rounded half up to one minor unit. */
export function applyMultiplier(base: bigint, multiplier: bigint): bigint {
  assertAmount(base, "The base price");
  assertAmount(multiplier, "The multiplier");
  return divideHalfUp(base * multiplier, MULTIPLIER_SCALE);
}

/**
 * Turns either kind of list into totals. An amounts list is used as it is. A
 * multipliers list needs the product's base price. Throws when the result
 * could not be saved (`listProblems`), so a price is never read from a list
 * that falls.
 */
export function resolvePriceList(
  list: PriceList,
  basePrice?: bigint | null,
): ResolvedList {
  let days: bigint[];
  let hourly: bigint | null;
  if (list.kind === "amounts") {
    days = [...list.days];
    hourly = list.hourly ?? null;
  } else {
    if (basePrice === undefined || basePrice === null) {
      throw new RangeError("A multipliers list needs the product's base price");
    }
    const problems = listProblems(list.days);
    if (problems.length > 0) {
      throw new RangeError(
        `The multipliers can't be used: ${problems[0].kind}`,
      );
    }
    days = list.days.map((multiplier) =>
      applyMultiplier(basePrice, multiplier),
    );
    hourly =
      list.hourly === undefined || list.hourly === null
        ? null
        : applyMultiplier(basePrice, list.hourly);
  }
  const problems = listProblems(days);
  if (problems.length > 0) {
    const first = problems[0];
    throw new RangeError(
      `The price list can't be used: ${first.kind}${"day" in first ? ` on day ${first.day}` : ""}`,
    );
  }
  if (hourly !== null) assertAmount(hourly, "The hourly price");
  return { days, hourly };
}
