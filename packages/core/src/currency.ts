/**
 * Per-currency defaults (docs/products-redesign.md §9.4, decision 25 (5);
 * root CLAUDE.md › Built for any country). The one table: no code anywhere
 * else may ask "is this THB?".
 *
 * Values are major units as strings of digits, so no float and no
 * arithmetic: the minor units are the digits followed by as many zeros as
 * the currency has decimal places.
 *
 * Only figures the owner has decided are listed. Any other currency falls
 * back to one major unit and a sample base of 10 (Mark, 15 Nov 2026).
 */

export type CurrencyDefaults = {
  /** The rounding step quick entry fills days to, until the shop picks one. */
  roundingStep: string;
  /** The sample base price a multipliers list shows its amounts at. */
  sampleBase: string;
};

const fallback: CurrencyDefaults = { roundingStep: "1", sampleBase: "10" };

const table: Readonly<Record<string, CurrencyDefaults>> = {
  // ฿10 and ฿100, the design's figures (§9.4, §9.11).
  THB: { roundingStep: "10", sampleBase: "100" },
};

/** The defaults for a currency (ISO 4217 code), or the fallback. */
export function currencyDefaults(currency: string): CurrencyDefaults {
  return table[currency.toUpperCase()] ?? fallback;
}

/** A whole number of major units in minor units: ("10", 2) → 1000n. */
export function majorToMinor(major: string, exponent: number): bigint {
  if (!/^\d+$/.test(major) || !Number.isInteger(exponent) || exponent < 0)
    throw new RangeError(`Not a whole amount: ${major}`);
  return BigInt(major + "0".repeat(exponent));
}
