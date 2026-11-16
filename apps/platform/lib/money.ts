/**
 * Money (root CLAUDE.md › Built for any country): integer minor units by the
 * currency's ISO 4217 exponent (THB ×100, JPY and VND ×1), always with a
 * currency code, formatted in the viewer's locale. No floats in storage.
 */

/** Decimal places of a currency: 2 for THB, 0 for JPY and VND, 3 for KWD. */
export function minorExponent(currency: string): number {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/**
 * Parses an amount typed in major units ("45000", "45,000.50") into minor
 * units. Returns null when it isn't a non-negative amount or has more decimal
 * places than the currency allows. String arithmetic, so no float rounding.
 */
export function parseMoney(input: string, currency: string): number | null {
  const text = input.trim().replace(/[\s,_]/g, "");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const exponent = minorExponent(currency);
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) return null;
  const minor = Number(match[1] + fraction.padEnd(exponent, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units as a plain major-unit string for a form field: 4500050 → "45000.50". */
export function moneyInputValue(minor: number, currency: string): string {
  const exponent = minorExponent(currency);
  if (exponent === 0) return String(minor);
  const digits = String(minor).padStart(exponent + 1, "0");
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/** "฿45,000.00" / "₫1,200,000" in the viewer's locale. */
export function formatMoney(
  minor: number,
  currency: string,
  locale: string,
): string {
  const exponent = minorExponent(currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    minor / 10 ** exponent,
  );
}

// Prices (stage D5) ------------------------------------------------------------------
// Prices are `bigint` minor units, worked out by quote() in @mango/core.
// These helpers only turn them into text and back, digit by digit: no
// arithmetic on an amount, so no float can creep in at any size.

/**
 * An amount typed in major units ("300", "1,400.50") as minor units. Null:
 * left blank. "invalid": not a non-negative amount, or more decimal places
 * than the currency has.
 */
export function parseMinorUnits(
  input: string,
  currency: string,
): bigint | null | "invalid" {
  const text = input.trim().replace(/[\s,_]/g, "");
  if (!text) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return "invalid";
  const exponent = minorExponent(currency);
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) return "invalid";
  return BigInt(match[1] + fraction.padEnd(exponent, "0"));
}

/** Minor units (a bigint or a string of digits) as a decimal string: 30050 → "300.50". */
export function minorDecimal(minor: bigint | string, currency: string): string {
  const exponent = minorExponent(currency);
  const digits = String(minor);
  if (!/^\d+$/.test(digits)) throw new RangeError(`Not an amount: ${digits}`);
  if (exponent === 0) return digits;
  const padded = digits.padStart(exponent + 1, "0");
  return `${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}

/** "฿1,400" / "฿116.66" in the viewer's locale; whole amounts without decimals. */
export function formatMinor(
  minor: bigint | string,
  currency: string,
  locale: string,
): string {
  const decimal = minorDecimal(minor, currency);
  const whole = !decimal.includes(".") || /\.0+$/.test(decimal);
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  });
  // Up to 15 digits a number holds the amount exactly, and every browser
  // formats a number. Past that only a decimal string keeps every digit,
  // which needs ES2023's Intl.NumberFormat (Chrome 106, Safari 15.4,
  // Firefox 116, Node 19); an older browser would round such an amount.
  const digits = decimal.replace(".", "").replace(/^0+/, "");
  return digits.length <= EXACT_NUMBER_DIGITS
    ? format.format(Number(decimal))
    : format.format(decimal as Intl.StringNumericLiteral);
}

/** A double holds any decimal of up to 15 significant digits exactly. */
const EXACT_NUMBER_DIGITS = 15;

/** A multiplier is stored in millionths (decision 29): "1.1666" → 1166600. */
export const MULTIPLIER_DECIMALS = 6;

/** A multiplier as typed ("1.1666") in millionths. Null: blank. */
export function parseMultiplier(input: string): bigint | null | "invalid" {
  const text = input.trim().replace(/^[x×]/i, "").trim();
  if (!text) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return "invalid";
  const fraction = match[2] ?? "";
  if (fraction.length > MULTIPLIER_DECIMALS) return "invalid";
  return BigInt(match[1] + fraction.padEnd(MULTIPLIER_DECIMALS, "0"));
}

/** Millionths as a plain multiplier: 1166600 → "1.1666", 3000000 → "3". */
export function multiplierText(millionths: bigint | string): string {
  const digits = String(millionths).padStart(MULTIPLIER_DECIMALS + 1, "0");
  const whole = digits.slice(0, -MULTIPLIER_DECIMALS).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(-MULTIPLIER_DECIMALS).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
