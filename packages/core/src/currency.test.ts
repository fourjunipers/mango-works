import { describe, expect, it } from "vitest";
import { currencyDefaults, majorToMinor } from "./currency";

describe("currencyDefaults", () => {
  it("gives the design's figures for Thai baht", () => {
    expect(currencyDefaults("THB")).toEqual({
      roundingStep: "10",
      sampleBase: "100",
    });
    expect(currencyDefaults("thb").roundingStep).toBe("10");
  });

  it("falls back to one major unit for any other currency", () => {
    for (const currency of ["VND", "JPY", "USD", "KWD", "EUR"]) {
      expect(currencyDefaults(currency)).toEqual({
        roundingStep: "1",
        sampleBase: "10",
      });
    }
  });
});

describe("majorToMinor", () => {
  it("adds the currency's decimal places as zeros", () => {
    expect(majorToMinor("10", 2)).toBe(BigInt(1000));
    expect(majorToMinor("1", 0)).toBe(BigInt(1));
    expect(majorToMinor("1", 3)).toBe(BigInt(1000));
  });

  it("refuses anything but whole digits", () => {
    expect(() => majorToMinor("1.5", 2)).toThrow(RangeError);
    expect(() => majorToMinor("-1", 2)).toThrow(RangeError);
    expect(() => majorToMinor("1", -1)).toThrow(RangeError);
  });
});
