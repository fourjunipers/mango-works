/**
 * A product's price changes in its History (docs/products-redesign.md
 * §9.12): one change, one line, in the field's own words. Pure: the page
 * fetches the audit rows (owners and managers, by RLS) and words the lines.
 *
 * Where the lines come from (stage D4's audit):
 * - product_pricing, row by row: a price, a period, a shared list, a base
 *   price, the long-stay rate, the deposit, tax, the replacement value;
 * - pricing_change on the product: how it is priced;
 * - template_change on a price list: the days that changed. On the
 *   product's own list, or on a shared list it is on (the event names the
 *   products);
 * - the own list's row: its hourly price.
 *
 * Amounts stay strings of digits here; the tab formats them in the viewer's
 * locale and the shop's currency.
 */

import { QUICK_ENTRY_DAYS } from "@mango/core/price-list";
import type { AuditRow } from "./history";
import type { ListKind, Method, Period } from "./pricing-form";

export type PricingArg =
  | { money: string }
  | { multiplier: string }
  | { text: string }
  | { number: number }
  | { method: Method | null }
  | { period: Period }
  /** "default", "none" (not taxable), or a profile's id. */
  | { tax: string };

export type PricingLine = {
  key: string;
  args: Record<string, PricingArg>;
  /** Lines beneath it, e.g. "5 other days changed". */
  sub?: { key: string; args: Record<string, PricingArg> }[];
};

export type PricingEntry = {
  /** Unique on the page: the audit row's id and the line's place in it. */
  key: string;
  rowId: number;
  at: string;
  actor: string | null;
  line: PricingLine;
};

export type TemplateInfo = { name: string; kind: ListKind };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const str = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/** The box names by the day they are the total for (1, 7, 14, 21, 30). */
const boxByDay = new Map<number, string>(
  Object.entries(QUICK_ENTRY_DAYS).map(([box, day]) => [day, box]),
);

/** Set, changed or removed: one line from a before and an after. */
function amountLine(
  name: string,
  from: string | null,
  to: string | null,
  extra: Record<string, PricingArg> = {},
): PricingLine | null {
  if (from === to) return null;
  if (from === null)
    return { key: `${name}Set`, args: { to: { money: to! }, ...extra } };
  if (to === null)
    return { key: `${name}Removed`, args: { from: { money: from }, ...extra } };
  return {
    key: `${name}Changed`,
    args: { from: { money: from }, to: { money: to }, ...extra },
  };
}

/** The tax choice a row's values make: "none", a profile's id, or "default". */
function taxOf(values: Record<string, unknown>): string {
  if (values.taxable === false) return "none";
  return str(values.tax_profile_id) ?? "default";
}

/** One product_pricing audit row as lines. */
function pricingRowLines(
  row: AuditRow,
  ownIds: ReadonlySet<string>,
  templates: ReadonlyMap<string, TemplateInfo>,
): PricingLine[] {
  const insert = row.action === "insert";
  if (row.action !== "insert" && row.action !== "update") return [];
  const after = record(row.after);
  const before = insert ? {} : record(row.before);
  const has = (field: string) => field in after;
  const was = (field: string) => (insert ? null : str(before[field]));
  const now = (field: string) => str(after[field]);
  // How it is priced changed in this save: its own line says it (the
  // pricing_change event), and the columns it cleared need no line.
  const methodChanged = has("pricing_method") && !insert;
  const lines: PricingLine[] = [];
  const push = (line: PricingLine | null) => {
    if (line) lines.push(line);
  };

  if (has("price_amount") && !(methodChanged && now("price_amount") === null)) {
    const period = now("price_period");
    push(
      amountLine(
        period ? "pricePer" : "price",
        was("price_amount"),
        now("price_amount"),
        period ? { period: { period: period as Period } } : {},
      ),
    );
  } else if (
    has("price_period") &&
    !insert &&
    now("price_period") !== null &&
    was("price_period") !== null
  ) {
    lines.push({
      key: "periodChanged",
      args: {
        from: { period: was("price_period") as Period },
        to: { period: now("price_period") as Period },
      },
    });
  }

  if (has("price_template_id") && now("price_template_id") !== null) {
    const to = now("price_template_id")!;
    const from = was("price_template_id");
    const fromShared = from !== null && !ownIds.has(from);
    if (ownIds.has(to)) {
      // Its first prices: the list's own line ("set the price: …") says it.
      if (!insert)
        lines.push(
          fromShared
            ? {
                key: "ownPricesFrom",
                args: { list: { text: templates.get(from)?.name ?? "" } },
              }
            : { key: "ownPrices", args: {} },
        );
    } else {
      const base = now("base_amount");
      lines.push({
        key: base ? "movedToListBase" : "movedToList",
        args: {
          list: { text: templates.get(to)?.name ?? "" },
          ...(base ? { base: { money: base } } : {}),
        },
      });
    }
  } else if (has("base_amount") && now("base_amount") !== null) {
    push(amountLine("base", was("base_amount"), now("base_amount")));
  }

  if (has("long_stay_day") && !(methodChanged && now("long_stay_day") === null))
    push(amountLine("longStay", was("long_stay_day"), now("long_stay_day")));
  if (has("deposit"))
    push(amountLine("deposit", was("deposit"), now("deposit")));
  if (has("replacement_price"))
    push(
      amountLine(
        "replacement",
        was("replacement_price"),
        now("replacement_price"),
      ),
    );

  if (has("taxable") || has("tax_profile_id")) {
    const from = insert ? "default" : taxOf({ taxable: true, ...before });
    const to = taxOf({ taxable: true, ...after });
    if (from !== to)
      lines.push({
        key: "taxChanged",
        args: { from: { tax: from }, to: { tax: to } },
      });
  }
  return lines;
}

/** A value of a list: money on an amounts list, a multiplier on the other. */
const listValue = (value: string, kind: ListKind): PricingArg =>
  kind === "amounts" ? { money: value } : { multiplier: value };

/** A list's 30 days saved: what changed on it, as lines. */
function templateLines(
  row: AuditRow,
  productId: string,
  ownIds: ReadonlySet<string>,
  templates: ReadonlyMap<string, TemplateInfo>,
): PricingLine[] {
  const before = record(record(row.before).days);
  const after = record(record(row.after).days);
  const changed = Object.keys(after)
    .map(Number)
    .filter((day) => Number.isInteger(day))
    .sort((a, b) => a - b);
  if (changed.length === 0) return [];

  if (ownIds.has(row.entity_id)) {
    // The first save of its own prices: the five quick-entry totals. (The
    // event names every day it wrote, with nothing before each.)
    if (Object.values(before).every((value) => value === null)) {
      return [
        {
          key: "firstPrice",
          args: Object.fromEntries(
            [...boxByDay].map(([day, box]) => [
              box,
              { money: str(after[day]) ?? "" },
            ]),
          ),
        },
      ];
    }
    const boxDays = changed.filter((day) => boxByDay.has(day));
    const others = changed.filter((day) => !boxByDay.has(day));
    if (boxDays.length === 0 && others.length === 1) {
      const day = others[0];
      return [
        {
          key: "dayChanged",
          args: {
            days: { number: day },
            from: { money: str(before[day]) ?? "" },
            to: { money: str(after[day]) ?? "" },
          },
        },
      ];
    }
    const lines: PricingLine[] = boxDays.map((day) => ({
      key: "boxChanged",
      args: {
        box: { text: boxByDay.get(day)! },
        from: { money: str(before[day]) ?? "" },
        to: { money: str(after[day]) ?? "" },
      },
    }));
    const sub =
      others.length > 0
        ? [{ key: "otherDays", args: { count: { number: others.length } } }]
        : undefined;
    if (lines.length === 0)
      return [
        { key: "daysChanged", args: { count: { number: others.length } } },
      ];
    lines[lines.length - 1] = { ...lines[lines.length - 1], sub };
    return lines;
  }

  // A shared list this product is on: what changed, and who else uses it.
  const info = templates.get(row.entity_id);
  const kind = info?.kind ?? "amounts";
  const products = Array.isArray(record(row.after).products)
    ? (record(row.after).products as unknown[])
    : [];
  const shown = changed.slice(0, 3);
  return [
    {
      key: "sharedListChanged",
      args: {
        list: { text: info?.name ?? "" },
        others: {
          number: products.filter((id) => id !== productId).length,
        },
      },
      sub: [
        ...shown.map((day) => ({
          key: "sharedDay",
          args: {
            days: { number: day },
            from: listValue(str(before[day]) ?? "", kind),
            to: listValue(str(after[day]) ?? "", kind),
          },
        })),
        ...(changed.length > shown.length
          ? [
              {
                key: "otherDays",
                args: { count: { number: changed.length - shown.length } },
              },
            ]
          : []),
      ],
    },
  ];
}

/**
 * The ids of the product's own lists, ever: a price_templates row made with
 * this product's id. An own list is deleted when the product moves to a
 * shared one, and a new one made when it gets its own prices again.
 */
export function ownListIds(
  rows: readonly AuditRow[],
  productId: string,
): Set<string> {
  return new Set(
    rows
      .filter(
        (row) =>
          row.entity === "price_templates" &&
          row.action === "insert" &&
          record(row.after).product_id === productId,
      )
      .map((row) => row.entity_id),
  );
}

/** Names and kinds of lists from their audit rows, for lists since deleted. */
export function templatesFromAudit(
  rows: readonly AuditRow[],
): Map<string, TemplateInfo> {
  const out = new Map<string, TemplateInfo>();
  for (const row of rows) {
    if (row.entity !== "price_templates" || row.action !== "insert") continue;
    const after = record(row.after);
    if (typeof after.name === "string")
      out.set(row.entity_id, {
        name: after.name,
        kind: after.kind === "multipliers" ? "multipliers" : "amounts",
      });
  }
  return out;
}

/**
 * Every price line for one product, newest first. `rows` holds its
 * product_pricing rows, its pricing_change events, and the price_templates
 * rows of its own lists and of the shared lists it was on.
 */
export function pricingHistory(
  rows: readonly AuditRow[],
  productId: string,
  templates: ReadonlyMap<string, TemplateInfo>,
): PricingEntry[] {
  const ownIds = ownListIds(rows, productId);
  const out: PricingEntry[] = [];
  const add = (row: AuditRow, lines: PricingLine[]) =>
    lines.forEach((line, i) =>
      out.push({
        key: `${row.id}-${i}`,
        rowId: row.id,
        at: row.at,
        actor: row.actor,
        line,
      }),
    );
  for (const row of rows) {
    if (row.entity === "product_pricing") {
      if (row.entity_id === productId)
        add(row, pricingRowLines(row, ownIds, templates));
    } else if (row.entity === "products" && row.action === "pricing_change") {
      if (row.entity_id !== productId) continue;
      const from = str(record(row.before).pricing_method) as Method | null;
      const to = str(record(row.after).pricing_method) as Method | null;
      add(row, [
        from === null
          ? { key: "methodSet", args: { to: { method: to } } }
          : {
              key: "methodChanged",
              args: { from: { method: from }, to: { method: to } },
            },
      ]);
    } else if (row.entity === "price_templates") {
      if (row.action === "template_change") {
        add(row, templateLines(row, productId, ownIds, templates));
      } else if (
        ownIds.has(row.entity_id) &&
        (row.action === "update" || row.action === "insert") &&
        "hourly" in record(row.after)
      ) {
        const from =
          row.action === "insert" ? null : str(record(row.before).hourly);
        const line = amountLine("hourly", from, str(record(row.after).hourly));
        if (line) add(row, [line]);
      }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || b.rowId - a.rowId);
}

/** Rows the general History leaves to the price lines. */
export function isPricingRow(row: AuditRow): boolean {
  return (
    row.entity === "product_pricing" ||
    row.entity === "price_templates" ||
    row.action === "pricing_change"
  );
}
