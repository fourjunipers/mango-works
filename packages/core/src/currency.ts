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

// Whole major units and the minor units a payment provider takes ------------------------
// (docs/phase-2-plan.md §2.6). The generic forms of what money.ts did for
// baht only; money.ts is now a thin wrapper that passes THB.

/** Decimal places of a currency (ISO 4217): 2 for THB, 0 for JPY and VND, 3 for KWD. */
export function currencyExponent(currency: string): number {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** Throws unless `major` is a whole number of the currency's major unit. */
export function assertWholeAmount(major: number, currency: string): void {
  if (!Number.isSafeInteger(major)) {
    throw new RangeError(
      `Expected a whole amount of ${currency}, got ${major}`,
    );
  }
}

/** One major unit in minor units: 100 for THB, 1 for JPY. */
function minorPerMajor(currency: string): number {
  return 10 ** currencyExponent(currency);
}

/** A whole amount in major units → minor units: (288, "THB") → 28800. */
export function toMinorUnits(major: number, currency: string): number {
  assertWholeAmount(major, currency);
  const minor = major * minorPerMajor(currency);
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Amount too large: ${major} ${currency}`);
  }
  return minor;
}

/**
 * Minor units → a whole amount in major units: (28800, "THB") → 288. Throws
 * if the amount has a minor part, so nothing is ever rounded away.
 */
export function fromMinorUnits(minor: number, currency: string): number {
  const per = minorPerMajor(currency);
  if (!Number.isSafeInteger(minor) || minor % per !== 0) {
    throw new RangeError(
      `Expected a whole amount of ${currency} in minor units, got ${minor}`,
    );
  }
  return minor / per;
}

const wholeFormats = new Map<string, Intl.NumberFormat>();

/**
 * A whole amount with its currency symbol, in the given locale:
 * (2592, "THB", "en-US") → "฿2,592". A negative amount leads with a true
 * minus sign: "−฿320".
 */
export function formatWholeAmount(
  major: number,
  currency: string,
  locale: string,
): string {
  assertWholeAmount(major, currency);
  const key = `${locale}|${currency}`;
  let format = wholeFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    wholeFormats.set(key, format);
  }
  const sign = major < 0 ? "−" : "";
  return `${sign}${format.format(Math.abs(major))}`;
}
