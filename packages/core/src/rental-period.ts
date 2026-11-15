/**
 * Rental-period maths: extending a rental, swapping its bike, and returning
 * it early (docs/products-redesign.md §9.19). Pure functions, `bigint` minor
 * units. Phase 3 builds the orders, the screens and the atomic database step;
 * the money is worked out here and nowhere else.
 *
 * A rental is made of billed periods: one bike, one date range, one frozen
 * price. **Nothing here reprices a period already billed.** An extension
 * adds a period; a swap closes one and opens another; an early return closes
 * one and opens none.
 *
 * **The deposit is not part of any of this.** These functions take no
 * deposit and return none. When a swap's two bikes have different deposits
 * the difference is shown to staff as a top-up or a release (Phase 3), never
 * charged or returned silently, and never in a VAT base.
 *
 * What each amount becomes on the new invoice (`quote()`):
 *  - the new period is a line with `rentalStart` set (a continuation);
 *  - "keep the customer's discount" is a staff discount on that line;
 *  - the money carried from the old bike is a credit, which reduces the VAT
 *    base of the new invoice (`creditVatBases`).
 */

import { divideHalfUp } from "./price-list";
import { rentalDays, type ChargeRules } from "./rental-days";
import {
  continuationPrice,
  unitPrice,
  type Pricing,
  type RentalSpan,
} from "./rental-price";

const ZERO = BigInt(0);

/** What a billed period came to, as the discount ratio needs it. */
export type PeriodAmounts = {
  /** The period's price after seasons and before any staff discount. */
  priceBeforeDiscount: bigint;
  /** What was actually charged for it. */
  charged: bigint;
};

function assertPeriodAmounts(period: PeriodAmounts): void {
  if (period.priceBeforeDiscount < ZERO || period.charged < ZERO) {
    throw new RangeError("A period's amounts can't be negative");
  }
  if (period.charged > period.priceBeforeDiscount) {
    throw new RangeError(
      "A period can't have been charged more than its price before discount",
    );
  }
}

/**
 * Carries a customer's discount to a new amount (owner decision, 15 Nov
 * 2026). The ratio is **the amount charged ÷ the price before the staff
 * discount, after seasons**, so a season is never carried over and then
 * applied a second time. ฿2,500 charged against ฿3,000 keeps five sixths:
 * ฿3,000 becomes ฿2,500, ฿1,800 becomes ฿1,500. One rounding, half up.
 *
 * It drives both "keep the last period's discount" on Extend and "keep the
 * customer's discount" on a swap. Staff can change the result before
 * confirming; this is only where it starts.
 */
export function carryDiscount(amount: bigint, last: PeriodAmounts): bigint {
  if (amount < ZERO) throw new RangeError("An amount can't be negative");
  assertPeriodAmounts(last);
  // A period that cost nothing had no discount to carry.
  if (last.priceBeforeDiscount === ZERO) return amount;
  return divideHalfUp(amount * last.charged, last.priceBeforeDiscount);
}

// ------------------------------------------------------------------- extend

export type ExtensionInput = {
  /** The bike's prices today. */
  pricing: Pricing;
  /** The rental's original pickup: its clock runs from here. */
  rentalStart: Date;
  /** Where the rental ends now, and where the extension takes it. */
  currentEnd: Date;
  newEnd: Date;
  timeZone: string;
  rules?: ChargeRules;
  /** The last billed period, for "keep the last period's discount". */
  lastPeriod?: PeriodAmounts | null;
};

export type Extension = {
  /** The new period's list price: the whole rental less the rental so far. */
  listPrice: bigint;
  /** The new period, to pass to `quote()` with `rentalStart`. */
  span: RentalSpan;
  /**
   * Where the charged price starts with "keep the last period's discount" on
   * (the default): the list price at the last period's ratio. Seasons on the
   * new period's own days are applied by `quote()`, after this.
   */
  keepDiscount: bigint;
};

/**
 * Extend rental: staff choose another month or an end date. The new period
 * is priced as a continuation, at today's prices at both ends.
 */
export function extensionPrice(input: ExtensionInput): Extension {
  const span: RentalSpan = {
    start: input.currentEnd,
    end: input.newEnd,
    timeZone: input.timeZone,
    rules: input.rules,
  };
  const listPrice = continuationPrice(
    input.pricing,
    span,
    input.rentalStart,
  ).amount;
  return {
    listPrice,
    span,
    keepDiscount: input.lastPeriod
      ? carryDiscount(listPrice, input.lastPeriod)
      : listPrice,
  };
}

// --------------------------------------------------------------------- swap

/** The period a swap or an early return happens in. */
export type OpenPeriod = PeriodAmounts & {
  /** The rental's original pickup. */
  rentalStart: Date;
  /** The billed period's own start and end. */
  start: Date;
  end: Date;
  /** When the bike is swapped or returned: inside the period. */
  at: Date;
  timeZone: string;
  rules?: ChargeRules;
  /** The old bike's prices, as the period was priced from them. */
  pricing: Pricing;
};

export type UnusedPart = {
  /** The old bike's list price for the whole period, and for the part used. */
  periodList: bigint;
  usedList: bigint;
  /** periodList − usedList. */
  unusedList: bigint;
  /**
   * The money paid toward the unused part: the amount actually charged ×
   * the unused share of the old bike's list price. One rounding, half up.
   */
  paidRemainder: bigint;
};

function assertOpen(period: OpenPeriod): void {
  const [origin, start, at, end] = [
    period.rentalStart,
    period.start,
    period.at,
    period.end,
  ].map((date) => date.getTime());
  if (!(origin <= start && start < at && at < end)) {
    throw new RangeError("A swap or return must fall inside the period");
  }
  assertPeriodAmounts(period);
}

/** A bike's list price from the rental's original pickup to `end`. */
function priceTo(pricing: Pricing, period: OpenPeriod, end: Date): bigint {
  if (end.getTime() === period.rentalStart.getTime()) return ZERO;
  return unitPrice(pricing, {
    start: period.rentalStart,
    end,
    timeZone: period.timeZone,
    rules: period.rules,
  }).amount;
}

/**
 * The unused part of a period when its bike leaves early, by swap or by
 * return. Shares are taken on the old bike's **list** prices, so a discount
 * is spread evenly over the period: ฿3,000 paid, half the list price unused,
 * ฿1,500 carried; ฿2,500 paid, ฿1,250 carried.
 */
export function unusedPart(period: OpenPeriod): UnusedPart {
  assertOpen(period);
  const before = priceTo(period.pricing, period, period.start);
  const periodList = priceTo(period.pricing, period, period.end) - before;
  const usedList = priceTo(period.pricing, period, period.at) - before;
  const unusedList = periodList - usedList;
  return {
    periodList,
    usedList,
    unusedList,
    paidRemainder:
      periodList === ZERO
        ? ZERO
        : divideHalfUp(period.charged * unusedList, periodList),
  };
}

export type SwapAmounts = UnusedPart & {
  /** The new period, to pass to `quote()` with `rentalStart`. */
  span: RentalSpan;
  /**
   * The new bike's remainder: its price for the whole period less its price
   * for the time used, at today's prices.
   */
  newRemainder: bigint;
  /**
   * "Remainder of the period", the default for an upgrade. Both amounts are
   * shown to staff before they confirm.
   *  - keepDiscount: the new remainder at the customer's discount ratio,
   *    less the paid remainder.
   *  - fullPrice: the new remainder as it is, less the paid remainder.
   * Negative when the new bike is cheaper: see `settleSwap`.
   */
  remainder: {
    keepDiscount: { newCharged: bigint; extra: bigint };
    fullPrice: { newCharged: bigint; extra: bigint };
  };
  /**
   * "Prorated difference": the two bikes' list prices for the period × the
   * remaining share of its days. Nothing is scaled by a discount (owner, 15
   * Nov 2026). Negative when the new bike is cheaper.
   */
  proratedDifference: {
    amount: bigint;
    remainingDays: number;
    periodDays: number;
  };
};

/**
 * Swap bike, at the swap time: what each pricing option comes to. The old
 * period closes at `period.at`; the new period runs from there to the same
 * end on the new bike. "No charge" is 0 and "manual amount" is what staff
 * type, so neither needs a function.
 */
export function swapAmounts(
  period: OpenPeriod,
  newPricing: Pricing,
): SwapAmounts {
  const unused = unusedPart(period);
  const span: RentalSpan = {
    start: period.at,
    end: period.end,
    timeZone: period.timeZone,
    rules: period.rules,
  };
  const newRemainder = continuationPrice(
    newPricing,
    span,
    period.rentalStart,
  ).amount;
  const kept = carryDiscount(newRemainder, period);

  // The remaining share of the period, in charged days.
  const days = (end: Date) =>
    end.getTime() === period.rentalStart.getTime()
      ? 0
      : rentalDays(period.rentalStart, end, {
          timeZone: period.timeZone,
          rules: period.rules,
        });
  const periodDays = days(period.end) - days(period.start);
  const remainingDays = days(period.end) - days(period.at);
  const newPeriodList =
    priceTo(newPricing, period, period.end) -
    priceTo(newPricing, period, period.start);
  const difference = newPeriodList - unused.periodList;
  const size =
    periodDays === 0
      ? ZERO
      : divideHalfUp(
          (difference < ZERO ? -difference : difference) *
            BigInt(remainingDays),
          BigInt(periodDays),
        );

  return {
    ...unused,
    span,
    newRemainder,
    remainder: {
      keepDiscount: { newCharged: kept, extra: kept - unused.paidRemainder },
      fullPrice: {
        newCharged: newRemainder,
        extra: newRemainder - unused.paidRemainder,
      },
    },
    proratedDifference: {
      amount: difference < ZERO ? -size : size,
      remainingDays,
      periodDays,
    },
  };
}

// ------------------------------------------------- cheaper bike, early return

/** What the shop does with money left over: each is a shop setting. */
export type LeftoverChoice = "credit" | "refund" | "no_charge";

export type Settlement = {
  /** What the customer pays now. Never negative. */
  toPay: bigint;
  /** Carried money set against the new period on this invoice. */
  creditApplied: bigint;
  /** Kept on the rental, to reduce its next extension. No credit note. */
  creditKept: bigint;
  /** Paid back to the customer. A refund creates a credit note. */
  refund: bigint;
  /** Left with the shop under "no charge". */
  forgone: bigint;
};

/**
 * Settles a swap: the new period's charge against the money carried from the
 * old bike. When the carried money covers it and more (a cheaper bike), the
 * rest follows the shop's choice: kept as credit, refunded, or no charge.
 */
export function settleSwap(
  newCharged: bigint,
  paidRemainder: bigint,
  leftover: LeftoverChoice,
): Settlement {
  if (newCharged < ZERO || paidRemainder < ZERO) {
    throw new RangeError("Amounts to settle can't be negative");
  }
  const creditApplied = paidRemainder < newCharged ? paidRemainder : newCharged;
  const rest = paidRemainder - creditApplied;
  return {
    toPay: newCharged - creditApplied,
    creditApplied,
    creditKept: leftover === "credit" ? rest : ZERO,
    refund: leftover === "refund" ? rest : ZERO,
    forgone: leftover === "no_charge" ? rest : ZERO,
  };
}

/**
 * Early return: a swap to nothing (owner decision, 15 Nov 2026). The period
 * closes at the return time and no new period opens, so all of the money
 * paid toward the unused part is left over, under the same three choices.
 */
export function earlyReturn(
  period: OpenPeriod,
  leftover: LeftoverChoice,
): UnusedPart & { settlement: Settlement } {
  const unused = unusedPart(period);
  return {
    ...unused,
    settlement: settleSwap(ZERO, unused.paidRemainder, leftover),
  };
}
