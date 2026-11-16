/**
 * The pricer (docs/products-redesign.md §9.9). **This is the only code that
 * produces a price.** Pure functions, `bigint` minor units, no float, no
 * currency named.
 *
 * `quote()` prices the lines that are billed together: one invoice. Each
 * payment gets its own tax invoice (accountant, 15 Nov 2026), so the first
 * booking, each extension and each swap extra is a separate call, and an
 * earlier invoice is never worked out again.
 *
 * The fixed order, per line unless it says otherwise:
 *   1. charged length            rental-days.ts
 *   2. unit price                rental-price.ts
 *   3. × charged quantity = list price
 *   4. included quantity         here: an extra's units that come free with
 *                                its vehicle are taken off before step 3
 *   5. season rules              season.ts
 *   6. discounts                 here
 *   7. VAT, once per invoice and rate group   here
 *   8. deposit, beside the price, never taxed here
 *
 * One rounding per step that divides: half up to one minor unit.
 */

import { divideHalfUp } from "./price-list";
import {
  continuationPrice,
  unitPrice,
  type Pricing,
  type RentalSpan,
  type UnitPrice,
} from "./rental-price";
import {
  chargedPeriodStarts,
  seasonAdjustments,
  type SeasonAdjustment,
  type SeasonRule,
} from "./season";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const BP_SCALE = BigInt(10000);

export type QuoteErrorCode =
  | "bad_input"
  /** A coupon was passed while the shop's "Accept coupons" switch is off. */
  | "coupons_off"
  /** A credit is larger than the amount it is set against. */
  | "credit_exceeds_base";

export class QuoteError extends Error {
  readonly code: QuoteErrorCode;
  constructor(code: QuoteErrorCode, message: string) {
    super(message);
    this.name = "QuoteError";
    this.code = code;
  }
}

function bad(message: string): never {
  throw new QuoteError("bad_input", message);
}

// ------------------------------------------------------------------- inputs

export type QuoteLineInput = {
  id: string;
  productId: string;
  /** Null: the product has no price yet. The line can't be priced. */
  pricing: Pricing | null;
  quantity: number;
  span: RentalSpan;
  /**
   * The line's tax rate in basis points (7% = 700), from its tax profile or
   * the shop's default. Null: not taxable, or the shop charges no tax.
   */
  taxRateBp: number | null;
  /**
   * Set on a later period of a rental (an extension, or the new bike after a
   * swap): the rental's original pickup. `span` is then the new period, and
   * the line is priced as a continuation (`continuationPrice`).
   */
  rentalStart?: Date | null;
  /** True for a vehicle: only vehicles carry a per-product deposit. */
  vehicle: boolean;
  /** The product's own deposit per unit, when it has one. */
  deposit?: bigint | null;
  /**
   * Set on gear or a service taken with a vehicle (step 4): the vehicle's
   * line on this invoice, and how many units come free with each one.
   * Empty: the line stands alone and every unit is charged.
   */
  extraOf?: { lineId: string; includedQuantity: number } | null;
};

/** Who or what a discount comes from. Only a coupon is stopped by the switch. */
export type DiscountSource =
  "coupon" | "staff" | "returning_customer" | "other";

/**
 * An already-decided discount. Whether a coupon applies (code, dates, uses,
 * customer, channel, minimum spend, products) is decided before the pricer.
 */
export type Discount = {
  id: string;
  source: DiscountSource;
  /** The lines it applies to. */
  lines: "all" | readonly string[];
} & (
  | { percentBp: number; amount?: undefined }
  | { amount: bigint; percentBp?: undefined }
);

/**
 * Money already paid on an earlier invoice and carried to this one: a swap's
 * credit from the old bike (§9.19). See `creditVatBases`.
 */
export type Credit = {
  id: string;
  amount: bigint;
  /** The rate group it is set against; null for the non-taxable part. */
  taxRateBp: number | null;
};

export type DepositSetting =
  | { mode: "none" }
  | { mode: "percent_of_order"; percentBp: number }
  | { mode: "fixed_per_order"; amount: bigint }
  /** `amount` is for a vehicle that has no deposit of its own. */
  | { mode: "per_product"; amount?: bigint | null };

export type QuoteInput = {
  /** The shop's setting: true = "our prices include tax", false = tax is added on top. */
  taxInclusive: boolean;
  /** The shop's "Accept coupons" switch. Off by default. */
  couponsEnabled: boolean;
  lines: readonly QuoteLineInput[];
  seasonRules?: readonly SeasonRule[];
  discounts?: readonly Discount[];
  credits?: readonly Credit[];
  deposit: {
    shop: DepositSetting;
    customer?: DepositSetting | null;
    order?: DepositSetting | null;
  };
};

// ------------------------------------------------------------------ results

export type QuotedLine = {
  id: string;
  productId: string;
  quantity: number;
  /** The vehicle line this one is an extra of, or null. */
  parentLineId: string | null;
  /**
   * How many of `quantity` come free with the vehicle (step 4). Never more
   * than the quantity: 3 helmets taken where 4 would be free is 3 included.
   * 0 for a line with no parent.
   */
  includedQuantity: number;
  /** quantity − includedQuantity: the units that are paid for. */
  chargedQuantity: number;
  unit: UnitPrice;
  /** Unit price × charged quantity. */
  listPrice: bigint;
  seasons: SeasonAdjustment[];
  /** The list price after season rules. */
  seasonPrice: bigint;
  discounts: Array<{ discountId: string; amount: bigint }>;
  /** All of this line's discounts together. */
  discount: bigint;
  /** What the line comes to: the season price less its discounts. */
  amount: bigint;
  /** Tax is not worked out per line: the line carries its rate only. */
  taxRateBp: number | null;
};

export type TaxGroup = {
  rateBp: number;
  /** The taxable amount after discounts and credits, as the shop prices it. */
  base: bigint;
  net: bigint;
  vat: bigint;
  gross: bigint;
};

export type Quote =
  | {
      ok: true;
      lines: QuotedLine[];
      /** One per tax rate, lowest first: the invoice's VAT lines. */
      taxGroups: TaxGroup[];
      /** The part of the invoice that is not taxable, after discounts and credits. */
      nonTaxable: bigint;
      totals: {
        listPrice: bigint;
        /** Signed: negative when seasons lower the price. */
        seasons: bigint;
        discount: bigint;
        credit: bigint;
        net: bigint;
        vat: bigint;
        /** What the customer pays on this invoice. The deposit is not in it. */
        total: bigint;
      };
      deposit: {
        amount: bigint;
        setting: DepositSetting;
        from: "order" | "customer" | "shop";
      };
    }
  | { ok: false; unpriced: Array<{ lineId: string; reason: "no_price" }> };

// ---------------------------------------------------------------- the pieces

function assertBp(value: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    bad(`${what} is out of range: ${value}`);
  }
}

/**
 * Shares `total` over `weights` in proportion, in whole minor units that add
 * up to it exactly. Each share is rounded down and the leftover units go to
 * the largest remainders, earlier lines first on a tie.
 */
export function splitProportionally(
  total: bigint,
  weights: readonly bigint[],
): bigint[] {
  if (total < ZERO || weights.some((w) => w < ZERO)) {
    bad("Can't share out a negative amount");
  }
  const sum = weights.reduce((a, b) => a + b, ZERO);
  if (sum === ZERO) {
    if (total !== ZERO) bad("Nothing to share the amount over");
    return weights.map(() => ZERO);
  }
  const shares = weights.map((w) => (total * w) / sum);
  const remainders = weights.map((w) => (total * w) % sum);
  let left = total - shares.reduce((a, b) => a + b, ZERO);
  const order = weights
    .map((_, index) => index)
    .sort((a, b) =>
      remainders[a] === remainders[b]
        ? a - b
        : remainders[a] > remainders[b]
          ? -1
          : 1,
    );
  for (const index of order) {
    if (left === ZERO) break;
    shares[index] += ONE;
    left -= ONE;
  }
  return shares;
}

/**
 * VAT for one rate group of one invoice, rounded once (accountant, 15 Nov
 * 2026). `base` is the taxable amount after discounts.
 *
 *  - Prices include VAT: the base is what is charged.
 *      VAT = base × rate ÷ (100 + rate);  net = base − VAT
 *  - VAT added on top: the base is the net.
 *      VAT = base × rate ÷ 100;           gross = base + VAT
 */
export function vatFor(
  base: bigint,
  rateBp: number,
  taxInclusive: boolean,
): TaxGroup {
  assertBp(rateBp, 0, 10000, "A tax rate");
  if (base < ZERO) bad("A taxable amount can't be negative");
  const rate = BigInt(rateBp);
  if (taxInclusive) {
    const vat = divideHalfUp(base * rate, BP_SCALE + rate);
    return { rateBp, base, net: base - vat, vat, gross: base };
  }
  const vat = divideHalfUp(base * rate, BP_SCALE);
  return { rateBp, base, net: base, vat, gross: base + vat };
}

/** The key of a rate group: a rate, or "none" for what is not taxable. */
type RateKey = number | "none";
const rateKey = (rateBp: number | null): RateKey =>
  rateBp === null ? "none" : rateBp;

/**
 * **A credit reduces the VAT base of the new invoice** (accountant, 15 Nov
 * 2026). This is the one place that rule lives.
 *
 * VAT follows the money actually coming in or going out. When a bike is
 * swapped, the money already paid for the unused part of the old bike was
 * taxed on the first invoice. It is carried to the new invoice as a credit,
 * and VAT there is on what the customer pays now. Example: the new bike's
 * remainder is ฿1,800, the credit is ฿1,500, the customer pays ฿300, so VAT
 * is on ฿300; across both invoices it is on ฿3,300, which is what was paid.
 *
 * A credit stays a credit and needs no credit note. Only a refund, money
 * leaving the company, creates one (Phase 3).
 *
 * Each credit is set against the rate group it was taxed in. One that is
 * larger than its group is refused: what happens to a negative amount (a
 * cheaper bike) is a shop setting decided before the pricer, in Phase 3.
 */
export function creditVatBases(
  bases: ReadonlyMap<RateKey, bigint>,
  credits: readonly Credit[],
): Map<RateKey, bigint> {
  const after = new Map(bases);
  for (const credit of credits) {
    if (typeof credit.amount !== "bigint" || credit.amount <= ZERO) {
      bad(`Credit ${credit.id} must be more than 0`);
    }
    const key = rateKey(credit.taxRateBp);
    const base = after.get(key) ?? ZERO;
    if (credit.amount > base) {
      throw new QuoteError(
        "credit_exceeds_base",
        `Credit ${credit.id} is more than the amount it is set against`,
      );
    }
    after.set(key, base - credit.amount);
  }
  return after;
}

/** The deposit setting in force: the order's, else the customer's, else the shop's. */
export function depositSettingFor(deposit: QuoteInput["deposit"]): {
  setting: DepositSetting;
  from: "order" | "customer" | "shop";
} {
  if (deposit.order) return { setting: deposit.order, from: "order" };
  if (deposit.customer) return { setting: deposit.customer, from: "customer" };
  return { setting: deposit.shop, from: "shop" };
}

/**
 * The deposit (§9.6). Never taxed, never discounted, never touched by a
 * season, and not part of the total.
 *
 * `total` is the order's total after discounts, tax included.
 */
export function depositAmount(
  setting: DepositSetting,
  total: bigint,
  lines: readonly QuoteLineInput[],
): bigint {
  switch (setting.mode) {
    case "none":
      return ZERO;
    case "percent_of_order":
      assertBp(setting.percentBp, 1, 100000, "A deposit percentage");
      return divideHalfUp(total * BigInt(setting.percentBp), BP_SCALE);
    case "fixed_per_order":
      if (setting.amount < ZERO) bad("A deposit can't be negative");
      return setting.amount;
    case "per_product":
      return lineDeposits(setting, lines).reduce<bigint>(
        (sum, each) => sum + (each ?? ZERO),
        ZERO,
      );
  }
}

/**
 * Each line's own deposit, for the order's record: its deposit per unit ×
 * its quantity in the per-product mode, for a vehicle. Null for gear, a
 * service or an item for sale, and for every line in the other modes, where
 * the deposit belongs to the invoice and not to a line.
 */
export function lineDeposits(
  setting: DepositSetting,
  lines: readonly QuoteLineInput[],
): Array<bigint | null> {
  if (setting.mode !== "per_product") return lines.map(() => null);
  const fallback = setting.amount ?? ZERO;
  if (fallback < ZERO) bad("A deposit can't be negative");
  return lines.map((line) => {
    // Vehicles only: gear, services and items for sale add nothing.
    if (!line.vehicle) return null;
    const each = line.deposit ?? fallback;
    if (each < ZERO) bad("A deposit can't be negative");
    return each * BigInt(line.quantity);
  });
}

/**
 * Each line's share of its rate group's VAT (docs/phase-2-plan.md §5.4, Q9).
 * VAT is still worked out once per invoice and rate (`vatFor`); this shares
 * that figure over the group's lines in proportion to what each comes to,
 * leftover minor units to the largest remainders, so the shares add up to
 * the invoice's VAT exactly. The invoice's figure is the one of record: a
 * share is for per-bike reports. A line that is not taxable has none.
 *
 * In the lines' order.
 */
export function lineTaxShares(
  lines: readonly Pick<QuotedLine, "amount" | "taxRateBp">[],
  taxGroups: readonly TaxGroup[],
): bigint[] {
  const shares = lines.map(() => ZERO);
  for (const group of taxGroups) {
    const members = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.taxRateBp === group.rateBp);
    const split = splitProportionally(
      group.vat,
      members.map(({ line }) => line.amount),
    );
    members.forEach(({ index }, i) => {
      shares[index] = split[i];
    });
  }
  return shares;
}

/**
 * Step 4, the included quantity (docs/phase-2-plan.md §5.2). An extra's line
 * names its vehicle's line and how many units come free with each vehicle:
 *
 *   allowance = included per vehicle × the vehicle line's quantity
 *   charged   = max(0, quantity − allowance)
 *
 * The free units are "included", not a discount: they are in no discount
 * total. A scooter with 2 helmets included and 3 taken: 2 included, 1
 * charged. Two scooters and 5 helmets: 4 included, 1 charged.
 */
export function includedQuantities(
  line: QuoteLineInput,
  lines: readonly QuoteLineInput[],
): { parentLineId: string | null; included: number; charged: number } {
  const extra = line.extraOf;
  if (!extra) {
    return { parentLineId: null, included: 0, charged: line.quantity };
  }
  if (!Number.isInteger(extra.includedQuantity) || extra.includedQuantity < 0) {
    bad(`Line ${line.id}: the included quantity must be a whole number ≥ 0`);
  }
  if (line.vehicle) bad(`Line ${line.id}: a vehicle can't be an extra`);
  const parent = lines.find((other) => other.id === extra.lineId);
  if (!parent || parent.id === line.id) {
    bad(`Line ${line.id} names a parent line that isn't here: ${extra.lineId}`);
  }
  if (!parent.vehicle || parent.extraOf) {
    bad(`Line ${line.id}: an extra goes with a vehicle's line`);
  }
  // Two lines of one extra on one vehicle would each take the free units.
  const twin = lines.find(
    (other) =>
      other !== line &&
      other.productId === line.productId &&
      other.extraOf?.lineId === extra.lineId,
  );
  if (twin) {
    bad(`Lines ${line.id} and ${twin.id} are the same extra of one line`);
  }
  const allowance = extra.includedQuantity * parent.quantity;
  const included = allowance < line.quantity ? allowance : line.quantity;
  return {
    parentLineId: parent.id,
    included,
    charged: line.quantity - included,
  };
}

// ------------------------------------------------------------------ quote()

export function quote(input: QuoteInput): Quote {
  const seasonRules = input.seasonRules ?? [];
  const discounts = input.discounts ?? [];
  const credits = input.credits ?? [];

  const ids = new Set<string>();
  for (const line of input.lines) {
    if (ids.has(line.id)) bad(`Two lines share the id ${line.id}`);
    ids.add(line.id);
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      bad(`Line ${line.id}: the quantity must be a whole number ≥ 1`);
    }
    if (line.taxRateBp !== null)
      assertBp(line.taxRateBp, 0, 10000, "A tax rate");
  }

  // The switch is checked before anything is priced, so no channel can skip it.
  for (const discount of discounts) {
    if (discount.source === "coupon" && !input.couponsEnabled) {
      throw new QuoteError("coupons_off", "This shop does not accept coupons");
    }
  }

  // No price is not zero: say which lines can't be priced.
  const unpriced = input.lines.filter((line) => line.pricing === null);
  if (unpriced.length > 0) {
    return {
      ok: false,
      unpriced: unpriced.map((line) => ({
        lineId: line.id,
        reason: "no_price",
      })),
    };
  }

  // Step 4 is worked out first, and for every line, so a wrong parent is
  // refused before anything is priced.
  const quantities = input.lines.map((line) =>
    includedQuantities(line, input.lines),
  );

  // Steps 1 to 5: length, unit price, charged quantity, seasons.
  const lines: QuotedLine[] = input.lines.map((line, index) => {
    const unit = line.rentalStart
      ? continuationPrice(line.pricing!, line.span, line.rentalStart)
      : unitPrice(line.pricing!, line.span);
    const { parentLineId, included, charged } = quantities[index];
    const listPrice = unit.amount * BigInt(charged);
    const starts = chargedPeriodStarts(unit, line.span);
    const seasons =
      starts === null
        ? []
        : seasonAdjustments(listPrice, starts, seasonRules, line.productId);
    const adjusted = seasons.reduce((sum, s) => sum + s.amount, listPrice);
    const seasonPrice = adjusted < ZERO ? ZERO : adjusted;
    return {
      id: line.id,
      productId: line.productId,
      quantity: line.quantity,
      parentLineId,
      includedQuantity: included,
      chargedQuantity: charged,
      unit,
      listPrice,
      seasons,
      seasonPrice,
      discounts: [],
      discount: ZERO,
      amount: seasonPrice,
      taxRateBp: line.taxRateBp,
    };
  });

  // Step 6: discounts, in the order given, each on what the one before left.
  for (const discount of discounts) {
    const targets =
      discount.lines === "all"
        ? lines
        : discount.lines.map(
            (id) =>
              lines.find((line) => line.id === id) ??
              bad(
                `Discount ${discount.id} names a line that isn't here: ${id}`,
              ),
          );
    let shares: bigint[];
    if (discount.percentBp !== undefined) {
      assertBp(discount.percentBp, 1, 10000, "A discount percentage");
      const percent = BigInt(discount.percentBp);
      // A percentage is taken on each line, one rounding per line.
      shares = targets.map((line) =>
        divideHalfUp(line.amount * percent, BP_SCALE),
      );
    } else {
      if (typeof discount.amount !== "bigint" || discount.amount <= ZERO) {
        bad(`Discount ${discount.id} must be more than 0`);
      }
      // A fixed amount is shared out over its lines in proportion, so each
      // tax-rate group loses its exact share before VAT is worked out. It
      // can't take more than the lines come to.
      const weights = targets.map((line) => line.amount);
      const available = weights.reduce((a, b) => a + b, ZERO);
      const taken = discount.amount > available ? available : discount.amount;
      shares = splitProportionally(taken, weights);
    }
    targets.forEach((line, index) => {
      const share = shares[index];
      if (share === ZERO) return;
      line.discounts.push({ discountId: discount.id, amount: share });
      line.discount += share;
      line.amount -= share;
    });
  }

  // Step 7: VAT, once per invoice and rate group, on the amount after
  // discounts (and after any credit: see `creditVatBases`).
  const bases = new Map<RateKey, bigint>();
  for (const line of lines) {
    const key = rateKey(line.taxRateBp);
    bases.set(key, (bases.get(key) ?? ZERO) + line.amount);
  }
  const credited = creditVatBases(bases, credits);
  const taxGroups = [...credited.entries()]
    .filter((entry): entry is [number, bigint] => entry[0] !== "none")
    .sort((a, b) => a[0] - b[0])
    .map(([rateBp, base]) => vatFor(base, rateBp, input.taxInclusive));
  const nonTaxable = credited.get("none") ?? ZERO;

  const sum = (pick: (line: QuotedLine) => bigint) =>
    lines.reduce((total, line) => total + pick(line), ZERO);
  const vat = taxGroups.reduce((total, group) => total + group.vat, ZERO);
  const gross =
    taxGroups.reduce((total, group) => total + group.gross, ZERO) + nonTaxable;

  // Step 8: the deposit, beside the price.
  const { setting, from } = depositSettingFor(input.deposit);

  return {
    ok: true,
    lines,
    taxGroups,
    nonTaxable,
    totals: {
      listPrice: sum((line) => line.listPrice),
      seasons: sum((line) => line.seasonPrice - line.listPrice),
      discount: sum((line) => line.discount),
      credit: credits.reduce((total, credit) => total + credit.amount, ZERO),
      net: gross - vat,
      vat,
      total: gross,
    },
    deposit: {
      amount: depositAmount(setting, gross, input.lines),
      setting,
      from,
    },
  };
}
