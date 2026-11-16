/**
 * Money helpers for the marketplace. Its amounts are whole Thai baht in the
 * app and the database; satang (1/100 baht) exist only at the Stripe
 * boundary, and these are the only functions that convert between the two.
 *
 * Since Phase 2 (docs/phase-2-plan.md §2.6) every function here is a thin
 * wrapper: the rule itself is in currency.ts and takes the currency as an
 * argument. These names stay so the marketplace does not change until 3M,
 * and money.test.ts holds the two to the same answers. **New code passes
 * the shop's currency to currency.ts, never calls these.**
 */

import {
  assertWholeAmount,
  formatWholeAmount,
  fromMinorUnits,
  toMinorUnits,
} from "./currency";

const BAHT = "THB";

/** Whole baht → satang, for amounts sent to Stripe. */
export function bahtToSatang(baht: number): number {
  return toMinorUnits(baht, BAHT);
}

/** Satang from Stripe → whole baht. Throws if the amount has a satang part. */
export function satangToBaht(satang: number): number {
  return fromMinorUnits(satang, BAHT);
}

/** 2592 → "฿2,592", -320 → "−฿320". */
export function formatBaht(baht: number): string {
  return formatWholeAmount(baht, BAHT, "en-US");
}

export function assertWholeBaht(baht: number): void {
  assertWholeAmount(baht, BAHT);
}
