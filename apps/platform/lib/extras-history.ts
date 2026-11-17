import type { AuditRow } from "./history";

/**
 * History lines for the extras offered with a vehicle, or with every
 * vehicle (docs/phase-2-plan.md §7: "in the buttons' words, one action one
 * line"). save_product_extras() writes one `extras_change` event per save
 * that changed the list, with the whole list before and after; this file
 * says what changed between the two. Pure: names are the caller's (a
 * product deleted since is named from its own delete event).
 *
 * An event written before stage 6 has no "offered": every line was offered.
 */

export type ExtrasLine = {
  extra: string;
  included: number;
  /** Most per vehicle. Null: no limit. */
  most: number | null;
  offered: boolean;
};

export type ExtrasChange =
  /** A line of its own was added (it may replace the shop's line). */
  | { kind: "added"; extra: string; included: number; most: number | null }
  /** A line of its own was taken off. */
  | { kind: "removed"; extra: string }
  /** Its included quantity or its most per vehicle changed. */
  | {
      kind: "changed";
      extra: string;
      included: { from: number; to: number } | null;
      most: { from: number | null; to: number | null } | null;
    }
  /** "Not offered for this vehicle" switched on. */
  | { kind: "notOffered"; extra: string }
  /** "Not offered for this vehicle" switched off: offered as the shop says. */
  | { kind: "offeredAgain"; extra: string }
  /** The same lines in a new order. */
  | { kind: "reordered" };

export type ExtrasEntry = {
  id: number;
  at: string;
  actor: string | null;
  /** A vehicle's id, or "every_vehicle". */
  list: string;
  changes: ExtrasChange[];
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** An event's list (before or after), in its saved order. */
export function extrasLines(value: unknown): ExtrasLine[] {
  const list = record(value).extras;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const row = record(item);
    if (typeof row.extra_product_id !== "string") return [];
    return [
      {
        extra: row.extra_product_id,
        included:
          typeof row.included_quantity === "number" ? row.included_quantity : 0,
        most: typeof row.max_quantity === "number" ? row.max_quantity : null,
        offered: row.offered !== false,
      },
    ];
  });
}

/** What one save changed, in the order of the list after it (then removals). */
export function extrasChanges(
  before: readonly ExtrasLine[],
  after: readonly ExtrasLine[],
): ExtrasChange[] {
  const was = new Map(before.map((line) => [line.extra, line]));
  const now = new Map(after.map((line) => [line.extra, line]));
  const changes: ExtrasChange[] = [];
  for (const line of after) {
    const old = was.get(line.extra);
    if (!line.offered) {
      // Not offered now: say so unless it already was.
      if (!old || old.offered)
        changes.push({ kind: "notOffered", extra: line.extra });
      continue;
    }
    if (!old || !old.offered) {
      changes.push({
        kind: "added",
        extra: line.extra,
        included: line.included,
        most: line.most,
      });
      continue;
    }
    const included =
      old.included !== line.included
        ? { from: old.included, to: line.included }
        : null;
    const most =
      old.most !== line.most ? { from: old.most, to: line.most } : null;
    if (included || most)
      changes.push({ kind: "changed", extra: line.extra, included, most });
  }
  for (const line of before) {
    if (now.has(line.extra)) continue;
    changes.push(
      line.offered
        ? { kind: "removed", extra: line.extra }
        : { kind: "offeredAgain", extra: line.extra },
    );
  }
  // The lines offered both before and after, in a new order.
  const kept = (lines: readonly ExtrasLine[]) =>
    lines
      .filter(
        (line) =>
          line.offered &&
          was.get(line.extra)?.offered &&
          now.get(line.extra)?.offered,
      )
      .map((line) => line.extra);
  const order = kept(before);
  if (kept(after).some((extra, i) => extra !== order[i]))
    changes.push({ kind: "reordered" });
  return changes;
}

/** The extras_change events among audit rows, as History entries. */
export function extrasHistory(rows: readonly AuditRow[]): ExtrasEntry[] {
  return rows
    .filter(
      (row) =>
        row.entity === "product_extras" && row.action === "extras_change",
    )
    .map((row) => ({
      id: row.id,
      at: row.at,
      actor: row.actor,
      list: row.entity_id,
      changes: extrasChanges(extrasLines(row.before), extrasLines(row.after)),
    }))
    .filter((entry) => entry.changes.length > 0);
}

/** Every product an entry names, for one read of their names. */
export function extrasNamed(entries: readonly ExtrasEntry[]): string[] {
  return [
    ...new Set(
      entries.flatMap((entry) =>
        entry.changes.flatMap((change) =>
          "extra" in change ? [change.extra] : [],
        ),
      ),
    ),
  ];
}
