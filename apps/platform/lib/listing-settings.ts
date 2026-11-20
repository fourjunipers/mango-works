import { z } from "zod";
import { typedWhole, wholeNumber } from "./fleet";
import { parseWholeInRange } from "./number-input";

/**
 * The listing part of a product's Moto Mangos tab (docs/products-redesign.md
 * §5.11): the counts and the lead time, saved together under one Save
 * button. The on and off switch saves by itself and is not here. Pure, so
 * the page, the server action and the tests share it.
 */

/** The longest lead time, in hours (the database's check: 0 to 720). */
export const maxLeadTimeHours = 720;

/** The most a count box takes. */
const maxCount = 9999;

// Typed text is read by the platform's one number rule (lib/number-input.ts).
/** Empty (or not sent) is 0. */
const count = z.preprocess(
  (value) => typedWhole(value) ?? 0,
  wholeNumber(0, maxCount, "invalidNumber"),
);

/** Empty (or not sent) is "none of its own". */
const leadTime = z.preprocess(
  (value) => typedWhole(value) ?? null,
  wholeNumber(0, maxLeadTimeHours, "leadTimeRange").nullable(),
);

export const listingSettingsSchema = z
  .object({
    instant_units: count,
    request_units: count,
    ready_now: count,
    lead_time_hours: leadTime,
  })
  .strict();

export type ListingSettings = z.infer<typeof listingSettingsSchema>;

/**
 * Only what changed from what the page showed, in save_listing's words: a
 * setting left as it was is not sent, so two people saving different
 * settings at once don't undo each other's.
 */
export function changedSettings(
  was: ListingSettings,
  now: ListingSettings,
): Partial<ListingSettings> {
  return Object.fromEntries(
    (Object.keys(now) as (keyof ListingSettings)[])
      .filter((key) => now[key] !== was[key])
      .map((key) => [key, now[key]]),
  );
}

/**
 * What is wrong with the counts against the product's active vehicles, as
 * FormErrors keys: instant plus request above them, and walk-ins above them.
 * The database refuses both with one code (more_units_than_active); the
 * screen says which.
 */
export function countProblems(
  counts: Pick<
    ListingSettings,
    "instant_units" | "request_units" | "ready_now"
  >,
  active: number,
): ("more_units_than_active" | "more_walk_ins_than_active")[] {
  const problems: ("more_units_than_active" | "more_walk_ins_than_active")[] =
    [];
  if (counts.instant_units + counts.request_units > active)
    problems.push("more_units_than_active");
  if (counts.ready_now > active) problems.push("more_walk_ins_than_active");
  return problems;
}

/**
 * A typed count as a number for the live lines on the page: empty is 0,
 * anything that isn't a whole number is null (the form will say so on Save).
 */
export function typedCount(value: string): number | null {
  const typed = parseWholeInRange(value, 0, maxCount);
  return typed === "invalid" ? null : (typed ?? 0);
}
