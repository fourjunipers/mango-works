import { describe, expect, it } from "vitest";
import { parseCouponAmount } from "./coupon-form";
import { hoursToMinutes, minutesToHours } from "./fleet";
import {
  minorDecimal,
  moneyInputValue,
  multiplierText,
  parseMinorUnits,
  parseMoney,
  parseMultiplier,
} from "./money";
import {
  parseScaled,
  parseTypedNumber,
  parseWholeNumber,
} from "./number-input";
import { parsePercentBp, percentInput } from "./seasons";

/**
 * The platform's one number rule (lib/number-input.ts), as a table: what a
 * box takes and what it refuses, and every parser on the platform giving the
 * same answer for the same text.
 */

const n = (value: number) => BigInt(value);

/** Typed text, and its digits before and after the point. */
const VALID: [string, string, string][] = [
  ["0", "0", ""],
  ["7", "7", ""],
  ["300", "300", ""],
  ["1400", "1400", ""],
  ["1234567", "1234567", ""],
  ["12.5", "12", "5"],
  ["0.5", "0", "5"],
  ["0.005", "0", "005"],
  ["300.00", "300", "00"],
  ["1,234", "1234", ""],
  ["1,234.5", "1234", "5"],
  ["12,345", "12345", ""],
  ["123,456", "123456", ""],
  ["1,234,567", "1234567", ""],
  ["1,234,567.89", "1234567", "89"],
  ["50,000", "50000", ""],
  // Leading zeros are dropped; spaces around the number are not part of it.
  ["007", "7", ""],
  ["00.5", "0", "5"],
  ["  1,000  ", "1000", ""],
  ["\t42\n", "42", ""],
];

const INVALID: [string, string][] = [
  ["1,23", "a comma before two digits"],
  ["12,34,5", "groups not of three"],
  ["2,50", "a comma as a decimal point"],
  ["12,5", "a comma as a decimal point"],
  ["0,5", "a comma as a decimal point"],
  ["0,500", "a group after a leading zero"],
  ["01,234", "a first group that starts with zero"],
  ["1,2345", "a last group of four"],
  ["1234,567", "a first group of four"],
  ["1,,234", "two commas together"],
  [",500", "nothing before the comma"],
  ["500,", "nothing after the comma"],
  ["1,234,", "nothing after the last comma"],
  ["1.234,56", "a dot for thousands and a comma for decimals"],
  ["1.234.567", "two dots"],
  ["1,234.5.6", "two dots"],
  ["1.2,345", "a comma after the decimal point"],
  ["1 400", "a space"],
  ["1 400.50", "a space"],
  ["1 400", "a no-break space"],
  ["1_400", "an underscore"],
  ["1'400", "an apostrophe"],
  ["-200", "a minus sign"],
  ["−200", "a typographic minus sign"],
  ["+200", "a plus sign"],
  ["2.", "nothing after the dot"],
  [".5", "nothing before the dot"],
  [".", "a dot alone"],
  [",", "a comma alone"],
  ["1e3", "an exponent"],
  ["0x10", "hexadecimal"],
  ["200 THB", "a currency code"],
  ["฿200", "a currency sign"],
  ["$200", "a currency sign"],
  ["abc", "letters"],
  ["２００", "full-width digits"],
  ["๒๐๐", "Thai digits"],
  ["Infinity", "a word"],
  ["NaN", "a word"],
];

describe("the one number rule: a dot for decimals, a comma only between thousands", () => {
  it.each(VALID)("takes %j", (typed, whole, fraction) => {
    expect(parseTypedNumber(typed)).toEqual({ whole, fraction });
  });

  it.each(INVALID)("refuses %j (%s)", (typed) => {
    expect(parseTypedNumber(typed)).toBe("invalid");
  });

  it("blank is not a number and not a mistake", () => {
    for (const blank of ["", " ", "\t", "\n  "]) {
      expect(parseTypedNumber(blank), JSON.stringify(blank)).toBeNull();
    }
  });

  it("the three named in the rule: 1,234.5 is fine; 1,23 and 12,34,5 are refused", () => {
    expect(parseTypedNumber("1,234.5")).toEqual({
      whole: "1234",
      fraction: "5",
    });
    expect(parseTypedNumber("1,23")).toBe("invalid");
    expect(parseTypedNumber("12,34,5")).toBe("invalid");
  });

  it("parseScaled keeps every digit and refuses more decimal places than asked", () => {
    expect(parseScaled("12.5", 2)).toBe(n(1250));
    expect(parseScaled("1,234.5", 2)).toBe(n(123450));
    expect(parseScaled("1,234.56", 2)).toBe(n(123456));
    expect(parseScaled("1,234.567", 2)).toBe("invalid");
    expect(parseScaled("5", 0)).toBe(n(5));
    expect(parseScaled("5.0", 0)).toBe("invalid");
    expect(parseScaled("", 2)).toBeNull();
    // 30 digits: no float is ever involved.
    expect(parseScaled("123456789012345678901234567890.12", 2)).toBe(
      BigInt("12345678901234567890123456789012"),
    );
  });

  it("parseWholeNumber takes no decimal point at all", () => {
    expect(parseWholeNumber("1,000")).toBe(n(1000));
    expect(parseWholeNumber("42")).toBe(n(42));
    expect(parseWholeNumber("42.0")).toBe("invalid");
    expect(parseWholeNumber("4 2")).toBe("invalid");
    expect(parseWholeNumber("")).toBeNull();
  });
});

describe("every parser on the platform reads a number by that rule", () => {
  /** Each parser's answer for one text, as "ok", "blank" or "invalid". */
  const readers: [string, (typed: string) => unknown][] = [
    [
      "an amount (price lists, pricing settings)",
      (t) => parseMinorUnits(t, "THB"),
    ],
    [
      "an amount (fleet costs and prices)",
      (t) => parseMoney(t, "THB") ?? "invalid",
    ],
    ["an amount (coupons)", (t) => parseCouponAmount(t, "THB")],
    [
      "a percentage (seasons, deposits, returning customers, coupons)",
      parsePercentBp,
    ],
    ["a multiplier (price lists)", parseMultiplier],
    ["hours (buffers)", hoursToMinutes],
  ];

  it.each(readers)("%s refuses every text the rule refuses", (_, read) => {
    for (const [typed] of INVALID) {
      expect(read(typed), JSON.stringify(typed)).toBe("invalid");
    }
  });

  it("the same text is the same number everywhere it is taken", () => {
    expect(parseMinorUnits("1,234.5", "THB")).toBe(n(123450));
    expect(parseMoney("1,234.5", "THB")).toBe(123450);
    expect(parseCouponAmount("1,234.5", "THB")).toBe(n(123450));
    expect(parsePercentBp("12.5")).toBe(1250);
    expect(parsePercentBp("12.5%")).toBe(1250);
    expect(parsePercentBp("12.5 %")).toBe(1250);
    expect(parseMultiplier("1.1666")).toBe(n(1166600));
    expect(parseMultiplier("x1.5")).toBe(n(1500000));
    expect(hoursToMinutes("1.5")).toBe(90);
  });

  it('"2,50" is refused on every screen: never 250 on one and 2.5 on another', () => {
    expect(parseMinorUnits("2,50", "THB")).toBe("invalid");
    expect(parseMoney("2,50", "THB")).toBeNull();
    expect(parseCouponAmount("2,50", "THB")).toBe("invalid");
    expect(parsePercentBp("2,50")).toBe("invalid");
    expect(parseMultiplier("2,50")).toBe("invalid");
    expect(hoursToMinutes("2,50")).toBe("invalid");
  });

  it("decimal places follow the currency: THB two, KWD three, JPY and VND none", () => {
    expect(parseMinorUnits("0.005", "KWD")).toBe(n(5));
    expect(parseMinorUnits("0.005", "THB")).toBe("invalid");
    expect(parseMinorUnits("50,000", "VND")).toBe(n(50000));
    expect(parseMinorUnits("500.5", "JPY")).toBe("invalid");
    expect(parseMoney("45,000.50", "THB")).toBe(4500050);
    expect(parseMoney("45000.505", "THB")).toBeNull();
  });

  it("a stored value shown in a box is read back as the same value: no saved number is refused on load", () => {
    // The only five functions that fill a number box from a stored value
    // (minorDecimal, moneyInputValue, percentInput, multiplierText,
    // minutesToHours) write a dot and no separators, which the rule takes.
    const amounts = [
      "0",
      "1",
      "99",
      "100",
      "30000",
      "140050",
      "4500050",
      "123456789012345678",
    ];
    for (const currency of ["THB", "USD", "KWD", "JPY", "VND"]) {
      for (const stored of amounts) {
        const shown = minorDecimal(stored, currency);
        expect(parseMinorUnits(shown, currency), `${shown} ${currency}`).toBe(
          BigInt(stored),
        );
        expect(parseCouponAmount(shown, currency), `${shown} ${currency}`).toBe(
          BigInt(stored),
        );
      }
      for (const stored of [0, 1, 99, 100, 64_500, 4_500_050]) {
        const shown = moneyInputValue(stored, currency);
        expect(parseMoney(shown, currency), `${shown} ${currency}`).toBe(
          stored,
        );
      }
    }
    for (const bp of [1, 50, 700, 1250, 2000, 9999, 10000]) {
      expect(parsePercentBp(percentInput(bp)), String(bp)).toBe(bp);
    }
    for (const millionths of ["1", "500000", "1000000", "1166600", "3000000"]) {
      expect(parseMultiplier(multiplierText(millionths)), millionths).toBe(
        BigInt(millionths),
      );
    }
    // Every buffer a form can have saved: 0 to a week, to the minute. Hours
    // are shown to two decimal places, so the minutes read back are the
    // nearest minute to what is shown; what matters is that none is refused.
    for (let minutes = 0; minutes <= 10_080; minutes++) {
      const shown = minutesToHours(minutes);
      const back = hoursToMinutes(shown);
      expect(back, shown).not.toBe("invalid");
      expect(Math.abs((back as number) - minutes), shown).toBeLessThanOrEqual(
        1,
      );
    }
  });
});
