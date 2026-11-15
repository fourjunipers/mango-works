import { describe, expect, it } from "vitest";
import { quote } from "@mango/core/quote";
import {
  depositOf,
  listOf,
  minorUnits,
  pricingOf,
  quoteInputFor,
  seasonsOf,
  type PricingInputs,
  type ProductPricingRow,
} from "./pricing-inputs";

const BANGKOK = "Asia/Bangkok";
const bkk = (date: string) => new Date(`${date}T10:00:00+07:00`);

/** A list rising by `step` satang a day from `first`: 30 strings of digits. */
const days = (first: number, step: number) =>
  Array.from({ length: 30 }, (_, i) => String(first + step * i));

const row = (more: Partial<ProductPricingRow> = {}): ProductPricingRow => ({
  product_id: "bike",
  product_type: "vehicle",
  currency: "THB",
  pricing_method: null,
  price_amount: null,
  price_period: null,
  base_amount: null,
  long_stay_day: null,
  deposit: null,
  replacement_price: null,
  taxable: true,
  tax_rate_bp: 700,
  tax_profile_name: "VAT 7%",
  template: null,
  ...more,
});

// 30 days come to ฿3,000.00: 10,000 satang a day.
const amountsList = {
  id: "t1",
  name: "Own prices",
  kind: "amounts" as const,
  shared: false,
  hourly: null,
  days: days(10_000, 10_000),
};

const settings: NonNullable<PricingInputs["settings"]> = {
  currency: "THB",
  rounding_step: "1000",
  tax_inclusive: true,
  coupons_enabled: false,
  deposit_mode: "per_product",
  deposit_percent_bp: null,
  deposit_amount: "150000",
  default_tax_profile_id: "p1",
};

const month = { start: bkk("2027-11-01"), end: bkk("2027-12-01"), timeZone: BANGKOK };

describe("minorUnits", () => {
  it("reads a string of digits as minor units, at any size", () => {
    expect(minorUnits("300000")).toBe(BigInt(300000));
    expect(minorUnits("9007199254740993")).toBe(BigInt("9007199254740993"));
    expect(minorUnits(null)).toBeNull();
  });

  it("refuses anything that is not whole minor units", () => {
    expect(() => minorUnits("3000.50")).toThrow(RangeError);
    expect(() => minorUnits("-5")).toThrow(RangeError);
    expect(() => minorUnits("")).toThrow(RangeError);
  });
});

describe("pricingOf", () => {
  it("turns each way of pricing into the pricer's shape", () => {
    expect(
      pricingOf(row({ pricing_method: "fixed", price_amount: "15000" })),
    ).toEqual({ method: "fixed", amount: BigInt(15000) });
    expect(
      pricingOf(
        row({ pricing_method: "per_period", price_amount: "20000", price_period: "week" }),
      ),
    ).toEqual({ method: "per_period", amount: BigInt(20000), period: "week" });
    expect(pricingOf(row({ pricing_method: "free" }))).toEqual({ method: "free" });
    const tiered = pricingOf(
      row({ pricing_method: "tiered", template: amountsList, long_stay_day: "10000" }),
    );
    expect(tiered).toMatchObject({ method: "tiered", longStayDay: BigInt(10000) });
    expect(tiered?.method === "tiered" && tiered.list.days[29]).toBe(BigInt(300000));
  });

  it("has no price for a product with no row, no method, or no list", () => {
    expect(pricingOf(undefined)).toBeNull();
    expect(pricingOf(row())).toBeNull();
    expect(pricingOf(row({ pricing_method: "tiered" }))).toBeNull();
  });

  it("resolves a multipliers list at the product's base price", () => {
    // Multipliers in millionths: ×1 on day 1 rising to ×30 on day 30.
    const multipliers = {
      ...amountsList,
      kind: "multipliers" as const,
      shared: true,
      hourly: "800000",
      days: days(1_000_000, 1_000_000),
    };
    const list = listOf(row({ template: multipliers, base_amount: "11000" }));
    expect(list?.days[0]).toBe(BigInt(11000));
    expect(list?.days[29]).toBe(BigInt(330000));
    expect(list?.hourly).toBe(BigInt(8800));
  });
});

describe("depositOf and seasonsOf", () => {
  it("reads the shop's deposit choice; no settings row is none", () => {
    expect(depositOf(null)).toEqual({ mode: "none" });
    expect(depositOf(settings)).toEqual({ mode: "per_product", amount: BigInt(150000) });
    expect(
      depositOf({ ...settings, deposit_mode: "percent_of_order", deposit_percent_bp: 3000 }),
    ).toEqual({ mode: "percent_of_order", percentBp: 3000 });
    expect(
      depositOf({ ...settings, deposit_mode: "fixed_per_order", deposit_amount: "200000" }),
    ).toEqual({ mode: "fixed_per_order", amount: BigInt(200000) });
    expect(depositOf({ ...settings, deposit_mode: "none" })).toEqual({ mode: "none" });
  });

  it("maps a season, for every product or for the ones it names", () => {
    const season = {
      id: "s1",
      name: "Low season",
      starts_on: "2027-04-01",
      ends_on: "2027-09-30",
      repeats_yearly: true,
      adjust_bp: -2000,
      all_products: false,
      product_ids: ["bike"],
    };
    expect(seasonsOf([season, { ...season, id: "s2", all_products: true }])).toEqual([
      {
        id: "s1",
        startsOn: "2027-04-01",
        endsOn: "2027-09-30",
        repeatsYearly: true,
        adjustBp: -2000,
        products: ["bike"],
      },
      {
        id: "s2",
        startsOn: "2027-04-01",
        endsOn: "2027-09-30",
        repeatsYearly: true,
        adjustBp: -2000,
        products: "all",
      },
    ]);
  });
});

describe("quoteInputFor: the database's rows through the one pricer", () => {
  const inputs: PricingInputs = {
    settings,
    products: [
      row({ pricing_method: "tiered", template: amountsList, deposit: "200000" }),
      row({
        product_id: "helmet",
        product_type: "gear",
        pricing_method: "fixed",
        price_amount: "10700",
      }),
    ],
    seasons: [],
  };

  it("prices a month at ฿3,000 with VAT ฿196.26, and the deposit beside it", () => {
    const result = quote(
      quoteInputFor(inputs, [
        { id: "l1", productId: "bike", quantity: 1, span: month },
      ]),
    );
    expect(result.ok && result.totals).toMatchObject({
      total: BigInt(300000),
      vat: BigInt(19626),
      net: BigInt(280374),
    });
    expect(result.ok && result.deposit.amount).toBe(BigInt(200000));
  });

  it("carries the type, the rate and the product's own deposit onto each line", () => {
    const input = quoteInputFor(inputs, [
      { id: "l1", productId: "bike", quantity: 2, span: month },
      { id: "l2", productId: "helmet", quantity: 1, span: month },
    ]);
    expect(input.lines.map((l) => [l.vehicle, l.taxRateBp, l.deposit])).toEqual([
      [true, 700, BigInt(200000)],
      [false, 700, null],
    ]);
    const result = quote(input);
    // 2 × 3,000 + 107 = ฿6,107; the helmet adds nothing to the deposit.
    expect(result.ok && result.totals.total).toBe(BigInt(610700));
    expect(result.ok && result.deposit.amount).toBe(BigInt(400000));
  });

  it("can't price a product with no pricing row, and says which line", () => {
    const result = quote(
      quoteInputFor(inputs, [
        { id: "l1", productId: "bike", quantity: 1, span: month },
        { id: "l2", productId: "unknown", quantity: 1, span: month },
      ]),
    );
    expect(result).toEqual({
      ok: false,
      unpriced: [{ lineId: "l2", reason: "no_price" }],
    });
  });

  it("gives a mechanic, who gets no rows, no price at all", () => {
    const nothing: PricingInputs = { settings: null, products: [], seasons: [] };
    const input = quoteInputFor(nothing, [
      { id: "l1", productId: "bike", quantity: 1, span: month },
    ]);
    expect(input.deposit.shop).toEqual({ mode: "none" });
    expect(input.couponsEnabled).toBe(false);
    expect(quote(input)).toEqual({
      ok: false,
      unpriced: [{ lineId: "l1", reason: "no_price" }],
    });
  });

  it("passes on a later period's original pickup, discounts, credits and overrides", () => {
    const input = quoteInputFor(
      inputs,
      [
        {
          id: "l1",
          productId: "bike",
          quantity: 1,
          span: { start: bkk("2027-12-01"), end: bkk("2028-01-01"), timeZone: BANGKOK },
          rentalStart: bkk("2027-11-01"),
        },
      ],
      {
        discounts: [{ id: "d", source: "staff", lines: "all", amount: BigInt(50000) }],
        credits: [{ id: "c", amount: BigInt(30000), taxRateBp: 700 }],
        customerDeposit: { mode: "none" },
      },
    );
    const result = quote(input);
    // The second month is a continuation: ฿3,000 − ฿500 − ฿300.
    expect(result.ok && result.totals.total).toBe(BigInt(220000));
    expect(result.ok && result.deposit).toMatchObject({ amount: BigInt(0), from: "customer" });
  });
});
