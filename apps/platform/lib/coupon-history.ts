import type { AuditRow } from "./history";

/**
 * History lines for coupons (docs/phase-2-plan.md §7: "in the buttons'
 * words, one action one line"; Phase 2 stage 9). Pure: the page reads the
 * audit rows and turns each change into words.
 *
 * What the audit holds (stage 8): `coupons` row by row (an insert carries
 * the whole row, an update only the fields that changed, before and after),
 * and `coupon_change` with the coupon's product ids before and after, when
 * a save changed its links. One save is one transaction, so its rows share
 * a time. A new coupon's links are part of "Created", not a line of their
 * own.
 */

export type CouponValue =
  { kind: "percent"; bp: number } | { kind: "fixed"; amount: string };

export type CouponChange =
  | {
      kind: "created";
      value: CouponValue | null;
      allProducts: boolean;
      products: number;
    }
  | { kind: "switchedOn" }
  | { kind: "switchedOff" }
  | { kind: "archived" }
  | { kind: "restored" }
  | { kind: "codeChanged"; from: string; to: string }
  | { kind: "renamed"; to: string }
  | { kind: "valueChanged"; from: CouponValue | null; to: CouponValue | null }
  | { kind: "allProducts" }
  | { kind: "chosenProducts"; count: number }
  | { kind: "validDates"; from: string | null; to: string | null }
  | { kind: "pickupDates"; from: string | null; to: string | null }
  | { kind: "minDays"; to: number | null }
  | { kind: "minSpend"; to: string | null }
  | { kind: "maxUses"; to: number | null }
  | { kind: "channels"; to: string[] }
  | { kind: "withReturning"; on: boolean }
  | { kind: "withSeason"; on: boolean };

export type CouponHistoryLine = {
  /** Unique on the page: the audit row's id and the line's place. */
  key: string;
  at: string;
  actor: string | null;
  couponId: string;
  /** The coupon's code at that moment. */
  code: string;
  change: CouponChange;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const has = (row: Record<string, unknown>, key: string) => key in row;
const text = (value: unknown): string | null =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : null;
const whole = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

function valueOf(row: Record<string, unknown>): CouponValue | null {
  if (row.kind === "percent" && typeof row.percent_bp === "number")
    return { kind: "percent", bp: row.percent_bp };
  const amount = text(row.amount);
  if (row.kind === "fixed" && amount !== null) return { kind: "fixed", amount };
  return null;
}

/** The lines of one update row (only the fields that changed). */
function updateLines(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  state: Record<string, unknown>,
): CouponChange[] {
  const out: CouponChange[] = [];
  if (has(after, "code"))
    out.push({
      kind: "codeChanged",
      from: text(before.code) ?? "",
      to: text(after.code) ?? "",
    });
  if (has(after, "name"))
    out.push({ kind: "renamed", to: text(after.name) ?? "" });
  if (has(after, "kind") || has(after, "percent_bp") || has(after, "amount")) {
    const was = valueOf({ ...state, ...before });
    const is = valueOf({ ...state, ...after });
    if (JSON.stringify(was) !== JSON.stringify(is))
      out.push({ kind: "valueChanged", from: was, to: is });
  }
  if (has(after, "all_products") && after.all_products === true)
    out.push({ kind: "allProducts" });
  if (has(after, "valid_from") || has(after, "valid_to"))
    out.push({
      kind: "validDates",
      from: text({ ...state, ...after }.valid_from),
      to: text({ ...state, ...after }.valid_to),
    });
  if (has(after, "pickup_from") || has(after, "pickup_to"))
    out.push({
      kind: "pickupDates",
      from: text({ ...state, ...after }.pickup_from),
      to: text({ ...state, ...after }.pickup_to),
    });
  if (has(after, "min_days"))
    out.push({ kind: "minDays", to: whole(after.min_days) });
  if (has(after, "min_spend"))
    out.push({ kind: "minSpend", to: text(after.min_spend) });
  if (has(after, "max_uses"))
    out.push({ kind: "maxUses", to: whole(after.max_uses) });
  if (has(after, "channels"))
    out.push({
      kind: "channels",
      to: Array.isArray(after.channels) ? after.channels.map(String) : [],
    });
  if (has(after, "with_returning_discount"))
    out.push({
      kind: "withReturning",
      on: after.with_returning_discount === true,
    });
  if (has(after, "with_season_discount"))
    out.push({ kind: "withSeason", on: after.with_season_discount === true });
  if (has(after, "active"))
    out.push({ kind: after.active === true ? "switchedOn" : "switchedOff" });
  if (has(after, "archived_at"))
    out.push({ kind: after.archived_at === null ? "restored" : "archived" });
  return out;
}

/**
 * Every coupon line, newest first. `rows` are the `coupons` audit rows of
 * the shop or of one coupon, in any order.
 */
export function couponHistory(rows: readonly AuditRow[]): CouponHistoryLine[] {
  const byCoupon = new Map<string, AuditRow[]>();
  for (const row of rows) {
    if (row.entity !== "coupons") continue;
    byCoupon.set(row.entity_id, [...(byCoupon.get(row.entity_id) ?? []), row]);
  }
  const out: CouponHistoryLine[] = [];
  for (const [couponId, couponRows] of byCoupon) {
    couponRows.sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
    let state: Record<string, unknown> = {};
    let createdAt: string | null = null;
    for (const row of couponRows) {
      const before = record(row.before);
      const after = record(row.after);
      const changes: CouponChange[] = [];
      if (row.action === "insert") {
        state = { ...after };
        createdAt = row.at;
        changes.push({
          kind: "created",
          value: valueOf(after),
          allProducts: after.all_products !== false,
          products: 0,
        });
      } else if (row.action === "update") {
        changes.push(...updateLines(before, after, state));
        state = { ...state, ...after };
      } else if (row.action === "coupon_change") {
        const products = Array.isArray(after.products)
          ? after.products.length
          : 0;
        if (row.at === createdAt) {
          // The new coupon's own links: counted on its "Created" line.
          const created = out.find(
            (line) =>
              line.couponId === couponId && line.change.kind === "created",
          );
          if (created && created.change.kind === "created")
            created.change = { ...created.change, products };
          continue;
        }
        if (products > 0)
          changes.push({ kind: "chosenProducts", count: products });
      } else continue;
      const code = text(state.code) ?? "";
      changes.forEach((change, n) =>
        out.push({
          key: `${row.id}:${n}`,
          at: row.at,
          actor: row.actor,
          couponId,
          code: change.kind === "codeChanged" ? change.to : code,
          change,
        }),
      );
    }
  }
  // Newest save first; a save's own lines in the order above.
  const parts = (line: CouponHistoryLine) => line.key.split(":").map(Number);
  return out.sort((a, b) => {
    const [aRow, aN] = parts(a);
    const [bRow, bN] = parts(b);
    return b.at.localeCompare(a.at) || bRow - aRow || aN - bN;
  });
}
