import type { Json, StoredSnapshot } from "@mango/core/quote-snapshot";

/**
 * The charge platform.create_order() stores with a new order
 * (docs/phase-3-plan.md §3.2): one quote() call, as its snapshot has it.
 *
 * Nothing is worked out here. Every figure is read from the stored snapshot
 * (snapshotQuote() in @mango/core), which holds amounts as strings of
 * digits; the database adds them up and compares (store_charges(), migration
 * 20261125000100), and refuses a charge whose lines and rate groups do not
 * come to its totals.
 */

export type ChargeLineRequest = {
  /** The index of the order's line (its rental) this line bills. */
  rental: number;
  kind: "period" | "extra";
  product_id: string;
  product_type: string;
  period_start: string;
  period_end: string;
  quantity: number;
  included_quantity: number;
  charged_quantity: number;
  list_price: string;
  season_total: string;
  discount_total: string;
  amount: string;
  tax_rate_bp: number | null;
  tax_profile_id: string | null;
  tax_profile_name: string | null;
  tax_inclusive: boolean;
  tax_amount: string;
  deposit: string;
  snapshot: Json;
};

export type ChargeRequest = {
  kind: "booking";
  priced_at: string;
  total: string;
  tax_total: string;
  deposit: string;
  rate_groups: Json;
  snapshot: StoredSnapshot;
  lines: ChargeLineRequest[];
};

type Stored = { [key: string]: Json };

const record = (value: Json | undefined, what: string): Stored => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new RangeError(`The snapshot has no ${what}`);
  return value;
};

const text = (value: Json | undefined, what: string): string => {
  if (typeof value !== "string")
    throw new RangeError(`The snapshot has no ${what}`);
  return value;
};

const whole = (value: Json | undefined, what: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new RangeError(`The snapshot has no ${what}`);
  return value;
};

/**
 * The booking charge of a new order, from the stored snapshot of its quote.
 *
 * `rentalOf` says which of the order's lines a quote line bills: the index
 * of its rental in create_order()'s `lines`. A quote line for N bikes is
 * sent as N rentals (a vehicle rental is one bike); its one period line
 * then names the first of them.
 */
export function bookingChargeOf(
  snapshot: StoredSnapshot,
  rentalOf: (lineId: string) => number,
): ChargeRequest {
  const totals = record(snapshot.totals, "totals");
  const deposit = record(snapshot.deposit, "deposit");
  const lines = snapshot.lines;
  if (!Array.isArray(lines)) throw new RangeError("The snapshot has no lines");
  return {
    kind: "booking",
    priced_at: text(snapshot.priced_at, "priced_at"),
    total: text(totals.total, "total"),
    tax_total: text(totals.vat, "VAT total"),
    deposit: text(deposit.amount, "deposit"),
    rate_groups: snapshot.tax_groups ?? [],
    snapshot,
    lines: lines.map((stored) => {
      const line = record(stored, "line");
      const id = text(line.id, "line id");
      return {
        rental: rentalOf(id),
        kind: line.parent_line_id === null ? "period" : "extra",
        product_id: text(line.product_id, "product"),
        product_type: text(line.product_type, "product type"),
        period_start: text(line.start, "start"),
        period_end: text(line.end, "end"),
        quantity: whole(line.quantity, "quantity"),
        included_quantity: whole(line.included_quantity, "included quantity"),
        charged_quantity: whole(line.charged_quantity, "charged quantity"),
        list_price: text(line.list_price, "list price"),
        season_total: text(line.season_total, "season total"),
        discount_total: text(line.discount_total, "discount total"),
        amount: text(line.amount, "amount"),
        tax_rate_bp:
          line.tax_rate_bp === null ? null : whole(line.tax_rate_bp, "rate"),
        tax_profile_id:
          typeof line.tax_profile_id === "string" ? line.tax_profile_id : null,
        tax_profile_name:
          typeof line.tax_profile_name === "string"
            ? line.tax_profile_name
            : null,
        tax_inclusive: line.tax_inclusive === true,
        tax_amount: text(line.tax_amount, "tax amount"),
        // A line has a deposit of its own only in the per-vehicle mode.
        deposit: typeof line.deposit === "string" ? line.deposit : "0",
        snapshot: line,
      };
    }),
  };
}
