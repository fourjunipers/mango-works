import { parseWholeInRange } from "./number-input";
import { isTryAgain } from "./try-again";

/**
 * The gear and services offered with a vehicle, as the Extras screens edit
 * them (docs/phase-2-plan.md §5.2, §7): the Extras tab of a vehicle and
 * Settings › Extras (the list offered with every vehicle).
 *
 * Pure: the screens read the rows, this file turns what was typed into
 * save_product_extras()'s list and the database's refusals into messages.
 * The database checks everything again.
 *
 * "Most per vehicle" is `max_quantity`: up to N with each vehicle, so a
 * booking of two scooters may take up to 2 × N (the owner, 17 Nov 2026).
 */

/** The most an included quantity or a most per vehicle can be. */
export const EXTRAS_LIMIT = 1000;
/** The most extras one list can hold (save_product_extras() says the same). */
export const EXTRAS_PER_LIST = 100;

/** One line of a list as it is saved (product_extras). */
export type SavedExtra = {
  extra_product_id: string;
  included_quantity: number;
  /** Most per vehicle. Null: no limit. */
  max_quantity: number | null;
  /** False: "Not offered for this vehicle" (a vehicle's own row only). */
  offered: boolean;
  sort_position: number;
};

/** One line in the editor: the boxes as typed. */
export type ExtraDraft = {
  extraProductId: string;
  /** Free with each vehicle, as typed. Empty is 0. */
  included: string;
  /** Most per vehicle, as typed. Empty is no limit. */
  most: string;
};

/** save_product_extras()'s list. */
export type ExtrasPayload = {
  extra_product_id: string;
  included_quantity: number;
  max_quantity: number | null;
  offered?: false;
}[];

/** What the editor sends: its own lines, in order, and the opt-outs. */
export type ExtrasForm = {
  lines: ExtraDraft[];
  /** Shop-wide extras this vehicle does not offer (vehicle lists only). */
  notOffered: string[];
};

export type ExtrasLineError = {
  line: number;
  field: "included" | "most";
  /** A FormErrors key. */
  key: "invalidNumber" | "extrasMostBelowIncluded";
};

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * A box as a whole number, or null when it is empty. NaN when it is not one
 * by the platform's one number rule (lib/number-input.ts).
 */
function whole(text: string): number | null {
  const typed = parseWholeInRange(text, 0, 9999);
  return typed === "invalid" ? Number.NaN : typed;
}

/** The errors of each line, in the order they are shown. */
export function extrasErrors(lines: readonly ExtraDraft[]): ExtrasLineError[] {
  const errors: ExtrasLineError[] = [];
  lines.forEach((line, index) => {
    const included = whole(line.included) ?? 0;
    const most = whole(line.most);
    const includedOk =
      Number.isInteger(included) && included >= 0 && included <= EXTRAS_LIMIT;
    if (!includedOk)
      errors.push({ line: index, field: "included", key: "invalidNumber" });
    if (most !== null) {
      if (!Number.isInteger(most) || most < 1 || most > EXTRAS_LIMIT)
        errors.push({ line: index, field: "most", key: "invalidNumber" });
      else if (includedOk && most < included)
        errors.push({
          line: index,
          field: "most",
          key: "extrasMostBelowIncluded",
        });
    }
  });
  return errors;
}

/**
 * The list to save, or null when a line is wrong (extrasErrors() says
 * which). The vehicle's own lines come first, in the order shown; then one
 * "not offered" line for each shop-wide extra it opts out of that it has no
 * line of its own for (an own line already wins over the shop's).
 */
export function extrasPayload(form: ExtrasForm): ExtrasPayload | null {
  if (extrasErrors(form.lines).length > 0) return null;
  const own = form.lines.map((line) => ({
    extra_product_id: line.extraProductId,
    included_quantity: whole(line.included) ?? 0,
    max_quantity: whole(line.most),
  }));
  const named = new Set(own.map((line) => line.extra_product_id));
  const notOffered = [...new Set(form.notOffered)]
    .filter((id) => !named.has(id))
    .map((id) => ({
      extra_product_id: id,
      included_quantity: 0,
      max_quantity: null,
      offered: false as const,
    }));
  return [...own, ...notOffered];
}

/**
 * The editor's form as it arrives at the server (one hidden JSON field),
 * or null when it is not one. Nothing in it is trusted: the payload is
 * checked again here and by the database.
 */
export function readExtrasForm(text: string): ExtrasForm | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { lines, notOffered } = value as Record<string, unknown>;
  if (!Array.isArray(lines) || !Array.isArray(notOffered)) return null;
  if (lines.length + notOffered.length > EXTRAS_PER_LIST) return null;
  const drafts: ExtraDraft[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object") return null;
    const { extraProductId, included, most } = line as Record<string, unknown>;
    if (typeof extraProductId !== "string" || !UUID.test(extraProductId))
      return null;
    if (typeof included !== "string" || typeof most !== "string") return null;
    drafts.push({ extraProductId, included, most });
  }
  if (
    !notOffered.every(
      (id): id is string => typeof id === "string" && UUID.test(id),
    )
  )
    return null;
  // The same extra twice in one list.
  if (new Set(drafts.map((d) => d.extraProductId)).size !== drafts.length)
    return null;
  return { lines: drafts, notOffered };
}

/** A saved list as the editor's boxes, in the order it is shown. */
export function draftsOf(rows: readonly SavedExtra[]): ExtrasForm {
  const sorted = [...rows].sort(
    (a, b) =>
      a.sort_position - b.sort_position ||
      a.extra_product_id.localeCompare(b.extra_product_id),
  );
  return {
    lines: sorted
      .filter((row) => row.offered)
      .map((row) => ({
        extraProductId: row.extra_product_id,
        included: String(row.included_quantity),
        most: row.max_quantity === null ? "" : String(row.max_quantity),
      })),
    notOffered: sorted
      .filter((row) => !row.offered)
      .map((row) => row.extra_product_id),
  };
}

/**
 * How a shop-wide extra stands on one vehicle: offered as the shop says,
 * set by the vehicle's own line (which wins), or not offered with it.
 */
export type ShopWideState = "offered" | "own" | "notOffered";

export function shopWideState(
  extraProductId: string,
  own: readonly SavedExtra[],
): ShopWideState {
  const row = own.find((r) => r.extra_product_id === extraProductId);
  if (!row) return "offered";
  return row.offered ? "own" : "notOffered";
}

/**
 * save_product_extras()'s refusal as a FormErrors key. A lock that could
 * not be had in time (55P03, or the API's 57014) is "try again": nothing
 * was written (lib/try-again.ts).
 */
export function extrasErrorKey(
  error: { code?: string; message?: string } | null | undefined,
): string {
  if (isTryAgain(error)) return "extrasTryAgain";
  const message = error?.message ?? "";
  const known: Record<string, string> = {
    only_owner_or_manager: "extrasOnlyOwnerOrManager",
    invalid_extras: "extrasInvalid",
    product_not_found: "extrasProductNotFound",
    extra_not_found: "extrasExtraNotFound",
    not_a_vehicle: "extrasProductNotFound",
    not_an_extra: "extrasExtraNotFound",
  };
  for (const [code, key] of Object.entries(known))
    if (message.includes(code)) return key;
  if (error?.code === "42501") return "extrasOnlyOwnerOrManager";
  return "saveFailed";
}
