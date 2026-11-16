/**
 * Seasons in a product's History (docs/products-redesign.md §9.12, stage
 * D6): on each product a season covers, "season Low season added: 20% off,
 * 1 Apr to 30 Sep, every year", "… changed from 20% off to 15% off",
 * "… removed". Pure: the page fetches the audit rows.
 *
 * What the audit holds (stage D4): price_rules row by row (an insert and a
 * delete carry the whole row, an update only the fields that changed), and
 * price_rule_change with the products named before and after. One save is
 * one transaction, so its rows share a time: they are read together, and a
 * product's line says what the save did to the season as that product sees
 * it.
 */

import type { AuditRow } from "./history";
import type { PricingEntry, PricingLine } from "./pricing-history";

type State = {
  exists: boolean;
  name: string;
  startsOn: string;
  endsOn: string;
  yearly: boolean;
  adjustBp: number;
  all: boolean;
  active: boolean;
  products: Set<string>;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const ids = (value: unknown): Set<string> =>
  new Set(Array.isArray(value) ? value.map(String) : []);

function apply(state: State, fields: Record<string, unknown>): State {
  const next = { ...state };
  if (typeof fields.name === "string") next.name = fields.name;
  if (typeof fields.starts_on === "string") next.startsOn = fields.starts_on;
  if (typeof fields.ends_on === "string") next.endsOn = fields.ends_on;
  if (typeof fields.repeats_yearly === "boolean")
    next.yearly = fields.repeats_yearly;
  if (typeof fields.adjust_bp === "number") next.adjustBp = fields.adjust_bp;
  if (typeof fields.all_products === "boolean") next.all = fields.all_products;
  if (typeof fields.active === "boolean") next.active = fields.active;
  return next;
}

const empty: State = {
  exists: false,
  name: "",
  startsOn: "",
  endsOn: "",
  yearly: false,
  adjustBp: 0,
  all: false,
  active: false,
  products: new Set(),
};

const covers = (state: State, productId: string) =>
  state.exists && (state.all || state.products.has(productId));

const dates = (state: State) => ({
  dates: {
    startsOn: state.startsOn,
    endsOn: state.endsOn,
    yearly: state.yearly,
  },
});

/** What one save did to a season, as one product sees it. */
function lines(before: State, after: State, productId: string): PricingLine[] {
  const was = covers(before, productId);
  const is = covers(after, productId);
  const name = { text: after.exists ? after.name : before.name };
  if (!was && is)
    return [
      {
        key: "seasonAdded",
        args: { name, change: { adjust: after.adjustBp }, when: dates(after) },
      },
    ];
  if (was && !is) return [{ key: "seasonRemoved", args: { name } }];
  if (!was || !is) return [];
  const out: PricingLine[] = [];
  if (before.name !== after.name)
    out.push({
      key: "seasonRenamed",
      args: { from: { text: before.name }, to: { text: after.name } },
    });
  if (before.adjustBp !== after.adjustBp)
    out.push({
      key: "seasonChanged",
      args: {
        name,
        from: { adjust: before.adjustBp },
        to: { adjust: after.adjustBp },
      },
    });
  if (
    before.startsOn !== after.startsOn ||
    before.endsOn !== after.endsOn ||
    before.yearly !== after.yearly
  )
    out.push({
      key: "seasonDatesChanged",
      args: { name, from: dates(before), to: dates(after) },
    });
  if (before.active !== after.active)
    out.push({ key: after.active ? "seasonOn" : "seasonOff", args: { name } });
  return out;
}

/**
 * Every season line for one product, newest first. `rows` are the shop's
 * price_rules audit rows (row by row, and price_rule_change), in any order.
 */
export function seasonHistory(
  rows: readonly AuditRow[],
  productId: string,
): PricingEntry[] {
  const byRule = new Map<string, AuditRow[]>();
  for (const row of rows) {
    if (row.entity !== "price_rules") continue;
    byRule.set(row.entity_id, [...(byRule.get(row.entity_id) ?? []), row]);
  }
  const out: PricingEntry[] = [];
  for (const ruleRows of byRule.values()) {
    ruleRows.sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
    let state = empty;
    for (let i = 0; i < ruleRows.length;) {
      // One save: the rows of one moment.
      const at = ruleRows[i].at;
      const before = state;
      let last = ruleRows[i];
      for (; i < ruleRows.length && ruleRows[i].at === at; i++) {
        const row = ruleRows[i];
        last = row;
        if (row.action === "insert")
          state = { ...apply(empty, record(row.after)), exists: true };
        else if (row.action === "update")
          state = apply(state, record(row.after));
        else if (row.action === "delete") state = { ...state, exists: false };
        else if (row.action === "price_rule_change")
          state = { ...state, products: ids(record(row.after).products) };
      }
      lines(before, state, productId).forEach((line, n) =>
        out.push({
          key: `season-${last.id}-${n}`,
          rowId: last.id,
          at,
          actor: last.actor,
          line,
        }),
      );
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || b.rowId - a.rowId);
}
