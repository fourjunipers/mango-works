/**
 * The one rule for a number typed into any box on the platform (Phase 2
 * stage 10; the coupon form had it first, review of PR 50).
 *
 * - A dot is the decimal point.
 * - A comma is taken only as a thousands separator in its right place:
 *   groups of three digits after a first group of one to three that does
 *   not start with 0, with digits on both sides ("1,234.5", "50,000").
 * - Everything else is refused: a comma anywhere else ("1,23", "12,34,5",
 *   "0,5"), a space, an underscore, a sign, a second dot, a dot with no
 *   digit before or after it, letters.
 *
 * So "2,50" can never be read as 250 on one screen and 2.5 on another.
 * Amounts, percentages, multipliers, hours and whole numbers are all read
 * through parseTypedNumber(); their own parsers (lib/money.ts,
 * lib/seasons.ts, lib/coupon-form.ts, lib/fleet.ts, lib/distance.ts and the
 * whole-number boxes through parseWholeInRange()) only add their limits.
 * Digits are kept as text, so no float touches an amount.
 */

const NUMBER = /^([1-9]\d{0,2}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;

/** The digits before and after the decimal point, with no separators. */
export type TypedNumber = { whole: string; fraction: string };

/**
 * A number as typed. Null: left blank. "invalid": not the rule above.
 * `whole` has no leading zeros ("007" is "7", "0" is "0").
 */
export function parseTypedNumber(
  input: string,
): TypedNumber | null | "invalid" {
  const text = input.trim();
  if (!text) return null;
  const match = NUMBER.exec(text);
  if (!match) return "invalid";
  return {
    whole: match[1].replace(/,/g, "").replace(/^0+(?=\d)/, ""),
    fraction: match[2] ?? "",
  };
}

/**
 * A typed number as an integer of `decimals` decimal places: "12.5" at 2 is
 * 1250n. "invalid" when it has more decimal places than that.
 */
export function parseScaled(
  input: string,
  decimals: number,
): bigint | null | "invalid" {
  const typed = parseTypedNumber(input);
  if (typed === null || typed === "invalid") return typed;
  if (typed.fraction.length > decimals) return "invalid";
  return BigInt(typed.whole + typed.fraction.padEnd(decimals, "0"));
}

/** A typed whole number: no decimal point at all. */
export function parseWholeNumber(input: string): bigint | null | "invalid" {
  const typed = parseTypedNumber(input);
  if (typed === null || typed === "invalid") return typed;
  if (input.includes(".")) return "invalid";
  return BigInt(typed.whole);
}

/**
 * A typed whole number from `min` to `max`, as a plain number: years, counts,
 * days, engine sizes. Null: left blank. "invalid": not a whole number by the
 * rule above, or outside the range. Each box says what blank means.
 */
export function parseWholeInRange(
  input: string,
  min: number,
  max: number,
): number | null | "invalid" {
  const whole = parseWholeNumber(input);
  if (whole === null || whole === "invalid") return whole;
  return whole >= BigInt(min) && whole <= BigInt(max)
    ? Number(whole)
    : "invalid";
}
