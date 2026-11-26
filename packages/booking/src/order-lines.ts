/**
 * A booking's lines as platform.create_order() takes them, and its answer
 * folded back (docs/phase-3-plan.md §2.2, decision 2).
 *
 * A vehicle rental is exactly one vehicle, so create_order() takes one line
 * per bike: a line asked for N bikes is sent as N lines of one. Gear and
 * services keep their quantity. An extra goes with its vehicle line's first
 * bike. The answer comes back one entry per rental; foldOrderLines() gives
 * the caller one entry per line it asked for.
 *
 * The price is not touched here: a line for N bikes is still one quote line
 * (quote() in @mango/core), and its one billed line names the first rental.
 */

export type AskedLine = {
  productId: string;
  locationId: string;
  start: Date;
  end: Date;
  quantity: number;
  /** An extra: the index of the earlier vehicle line it goes with. */
  parent?: number;
  /** Staff only: one id per unit wanted. */
  unitIds?: readonly string[];
};

export type SentLines = {
  /** create_order()'s `lines`. */
  lines: Record<string, unknown>[];
  /** For each line asked for: where it starts in `lines`, and how many it is. */
  first: number[];
  count: number[];
};

export function orderLinesOf(
  asked: readonly AskedLine[],
  isVehicle: (productId: string) => boolean,
): SentLines {
  const first: number[] = [];
  const count: number[] = [];
  const lines: Record<string, unknown>[] = [];
  asked.forEach((line, index) => {
    // N bikes with their units named: one unit each. Named some other way
    // (not one per bike), the line is sent whole, for the database to refuse.
    const each =
      isVehicle(line.productId) &&
      line.quantity > 1 &&
      (line.unitIds === undefined || line.unitIds.length === line.quantity);
    first[index] = lines.length;
    count[index] = each ? line.quantity : 1;
    for (let n = 0; n < count[index]; n++) {
      lines.push({
        product_id: line.productId,
        location_id: line.locationId,
        starts_at: line.start.toISOString(),
        ends_at: line.end.toISOString(),
        quantity: each ? 1 : line.quantity,
        ...(line.parent === undefined ? {} : { parent: first[line.parent] }),
        ...(line.unitIds === undefined
          ? {}
          : { unit_ids: each ? [line.unitIds[n]] : [...line.unitIds] }),
      });
    }
  });
  return { lines, first, count };
}

/** One entry of create_order()'s answer: a rental. */
export type MadeLine = {
  rental_id: string;
  reservation_id: string | null;
  unit_ids: string[];
  shortage: number;
};

/** The same, for one line as it was asked for. */
export type FoldedLine = {
  /** The line's first reservation (its only one, unless it was N bikes). */
  reservationId: string | null;
  rentalIds: string[];
  unitIds: string[];
  shortage: number;
};

export function foldOrderLines(
  made: readonly MadeLine[],
  sent: Pick<SentLines, "first" | "count">,
): FoldedLine[] {
  return sent.first.map((start, index) => {
    const rentals = made.slice(start, start + sent.count[index]);
    return {
      reservationId: rentals[0].reservation_id,
      rentalIds: rentals.map((rental) => rental.rental_id),
      unitIds: rentals.flatMap((rental) => rental.unit_ids),
      shortage: rentals.reduce((sum, rental) => sum + rental.shortage, 0),
    };
  });
}

/** The line a refusal names, as the caller numbered its own lines. */
export function askedLineOf(
  sentLine: number | null | undefined,
  sent: Pick<SentLines, "first">,
): number | null {
  if (sentLine === null || sentLine === undefined) return null;
  return sent.first.findLastIndex((start) => start <= sentLine);
}
