import { describe, expect, it } from "vitest";
import {
  parseRateBp,
  profileNameError,
  settingsDraft,
  settingsPayload,
  usualTaxProfile,
  type SettingsDraft,
} from "./pricing-settings";

const blank = settingsDraft(null, "THB");

describe("settingsDraft", () => {
  it("reads no settings row as the defaults", () => {
    expect(blank).toEqual({
      roundingStep: "",
      taxInclusive: true,
      defaultTaxId: "",
      depositMode: "none",
      depositPercent: "",
      depositAmount: "",
      couponsEnabled: false,
    });
  });

  it("reads saved settings as typed text, amounts from digit strings", () => {
    expect(
      settingsDraft(
        {
          currency: "THB",
          rounding_step: "1000",
          tax_inclusive: false,
          coupons_enabled: true,
          deposit_mode: "percent_of_order",
          deposit_percent_bp: 1250,
          deposit_amount: null,
          default_tax_profile_id: "vat",
        },
        "THB",
      ),
    ).toEqual({
      roundingStep: "10.00",
      taxInclusive: false,
      defaultTaxId: "vat",
      depositMode: "percent_of_order",
      depositPercent: "12.5",
      depositAmount: "",
      couponsEnabled: true,
    });
  });
});

describe("settingsPayload", () => {
  const send = (change: Partial<SettingsDraft>, currency = "THB") =>
    settingsPayload({ ...blank, ...change }, currency, ["vat"]);

  it("sends every setting; a blank rounding step is not chosen", () => {
    expect(send({})).toEqual({
      ok: true,
      payload: {
        tax_inclusive: true,
        coupons_enabled: false,
        deposit_mode: "none",
        rounding_step: null,
        default_tax_profile_id: null,
      },
    });
  });

  it("takes a rounding step in the currency's minor units", () => {
    expect(send({ roundingStep: "10" })).toMatchObject({
      payload: { rounding_step: "1000" },
    });
    expect(send({ roundingStep: "1000" }, "VND")).toMatchObject({
      payload: { rounding_step: "1000" },
    });
    expect(send({ roundingStep: "0" })).toMatchObject({
      errors: { roundingStep: "priceZero" },
    });
    expect(send({ roundingStep: "0.5" }, "VND")).toMatchObject({
      errors: { roundingStep: "invalidMoney" },
    });
  });

  it("asks for the number each deposit choice needs", () => {
    expect(
      send({ depositMode: "percent_of_order", depositPercent: "10" }),
    ).toMatchObject({ payload: { deposit_percent_bp: 1000 } });
    expect(send({ depositMode: "percent_of_order" })).toMatchObject({
      errors: { depositPercent: "required" },
    });
    expect(
      send({ depositMode: "percent_of_order", depositPercent: "1000.01" }),
    ).toMatchObject({ errors: { depositPercent: "increaseTooLarge" } });
    expect(
      send({ depositMode: "fixed_per_order", depositAmount: "3,000" }),
    ).toMatchObject({ payload: { deposit_amount: "300000" } });
    expect(send({ depositMode: "fixed_per_order" })).toMatchObject({
      errors: { depositAmount: "required" },
    });
    // Per product: the shop's amount is optional, and 0 is allowed.
    expect(send({ depositMode: "per_product" })).toMatchObject({
      payload: { deposit_amount: null },
    });
    expect(
      send({ depositMode: "per_product", depositAmount: "0" }),
    ).toMatchObject({ payload: { deposit_amount: "0" } });
  });

  it("names only a tax profile that is in use as the default", () => {
    expect(send({ defaultTaxId: "vat" })).toMatchObject({
      payload: { default_tax_profile_id: "vat" },
    });
    expect(send({ defaultTaxId: "old" })).toMatchObject({
      errors: { defaultTaxId: "invalidTaxProfile" },
    });
  });
});

describe("tax profiles", () => {
  it("reads a rate from 0 to 100%", () => {
    expect(parseRateBp("7")).toBe(700);
    expect(parseRateBp("0")).toBe(0);
    expect(parseRateBp("100")).toBe(10000);
    expect(parseRateBp("100.01")).toBe("invalid");
    expect(parseRateBp("")).toBeNull();
  });
  it("checks a name like the database", () => {
    expect(profileNameError(" ")).toBe("required");
    expect(profileNameError("x".repeat(81))).toBe("tooLong");
    expect(profileNameError("VAT 7%")).toBeNull();
  });
  it("offers Thailand's VAT 7% only", () => {
    expect(usualTaxProfile("TH")).toEqual({ name: "VAT 7%", rateBp: 700 });
    expect(usualTaxProfile("VN")).toBeNull();
    expect(usualTaxProfile("JP")).toBeNull();
  });
});
