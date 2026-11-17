import { describe, expect, it } from "vitest";
import { quote } from "@mango/core/quote";
import {
  depositOf,
  extrasOf,
  includedWith,
  listOf,
  minorUnits,
  pricingOf,
  pricingRowOf,
  quoteInputFor,
  seasonsFor,
  seasonsOf,
  snapshotContextFor,
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
  product_name: "Bike",
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
  tax_profile_id: "p1",
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

const month = {
  start: bkk("2027-11-01"),
  end: bkk("2027-12-01"),
  timeZone: BANGKOK,
};

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
        row({
          pricing_method: "per_period",
          price_amount: "20000",
          price_period: "week",
        }),
      ),
    ).toEqual({ method: "per_period", amount: BigInt(20000), period: "week" });
    expect(pricingOf(row({ pricing_method: "free" }))).toEqual({
      method: "free",
    });
    const tiered = pricingOf(
      row({
        pricing_method: "tiered",
        template: amountsList,
        long_stay_day: "10000",
      }),
    );
    expect(tiered).toMatchObject({
      method: "tiered",
      longStayDay: BigInt(10000),
    });
    expect(tiered?.method === "tiered" && tiered.list.days[29]).toBe(
      BigInt(300000),
    );
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
    expect(depositOf(settings)).toEqual({
      mode: "per_product",
      amount: BigInt(150000),
    });
    expect(
      depositOf({
        ...settings,
        deposit_mode: "percent_of_order",
        deposit_percent_bp: 3000,
      }),
    ).toEqual({ mode: "percent_of_order", percentBp: 3000 });
    expect(
      depositOf({
        ...settings,
        deposit_mode: "fixed_per_order",
        deposit_amount: "200000",
      }),
    ).toEqual({ mode: "fixed_per_order", amount: BigInt(200000) });
    expect(depositOf({ ...settings, deposit_mode: "none" })).toEqual({
      mode: "none",
    });
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
    expect(
      seasonsOf([season, { ...season, id: "s2", all_products: true }]),
    ).toEqual([
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
      row({
        pricing_method: "tiered",
        template: amountsList,
        deposit: "200000",
      }),
      row({
        product_id: "helmet",
        product_type: "gear",
        pricing_method: "fixed",
        price_amount: "10700",
      }),
    ],
    seasons: [],
    extras: [],
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
    expect(input.lines.map((l) => [l.vehicle, l.taxRateBp, l.deposit])).toEqual(
      [
        [true, 700, BigInt(200000)],
        [false, 700, null],
      ],
    );
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
    const nothing: PricingInputs = {
      settings: null,
      products: [],
      seasons: [],
      extras: [],
    };
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
          span: {
            start: bkk("2027-12-01"),
            end: bkk("2028-01-01"),
            timeZone: BANGKOK,
          },
          rentalStart: bkk("2027-11-01"),
        },
      ],
      {
        discounts: [
          { id: "d", source: "staff", lines: "all", amount: BigInt(50000) },
        ],
        credits: [{ id: "c", amount: BigInt(30000), taxRateBp: 700 }],
        customerDeposit: { mode: "none" },
      },
    );
    const result = quote(input);
    // The second month is a continuation: ฿3,000 − ฿500 − ฿300.
    expect(result.ok && result.totals.total).toBe(BigInt(220000));
    expect(result.ok && result.deposit).toMatchObject({
      amount: BigInt(0),
      from: "customer",
    });
  });
});

describe("extras: gear and services taken with a vehicle", () => {
  const perDay = (
    id: string,
    amount: string,
    more: Partial<ProductPricingRow> = {},
  ) =>
    row({
      product_id: id,
      product_name: id,
      pricing_method: "per_period",
      price_amount: amount,
      price_period: "day",
      ...more,
    });
  const extra = (
    vehicle: string,
    id: string,
    included: number,
    more: Partial<PricingInputs["extras"][number]> = {},
  ): PricingInputs["extras"][number] => ({
    product_id: vehicle,
    extra_product_id: id,
    extra_product_type: "gear",
    included_quantity: included,
    max_quantity: null,
    sort_position: 0,
    every_vehicle: false,
    ...more,
  });
  // A scooter at ฿200 a day with 2 helmets included; helmets at ฿50 a day.
  const inputs: PricingInputs = {
    settings: { ...settings, deposit_mode: "none", deposit_amount: null },
    products: [
      perDay("scooter", "20000"),
      perDay("tourer", "50000"),
      perDay("helmet", "5000", { product_type: "gear" }),
      perDay("cover", "3000", {
        product_type: "gear",
        taxable: false,
        tax_rate_bp: null,
        tax_profile_id: null,
        tax_profile_name: null,
      }),
    ],
    seasons: [
      {
        id: "low",
        name: "Low season",
        starts_on: "2028-05-01",
        ends_on: "2028-09-30",
        repeats_yearly: false,
        adjust_bp: -2000,
        all_products: true,
        product_ids: [],
      },
    ],
    extras: [
      extra("scooter", "helmet", 2, { max_quantity: 4 }),
      extra("tourer", "helmet", 1, { every_vehicle: true }),
    ],
  };
  const week = {
    start: bkk("2027-11-01"),
    end: bkk("2027-11-08"),
    timeZone: BANGKOK,
  };

  it("stage 4's pinned figures: 2 helmets included, 3 taken at ฿50 a day for 7 days is 1 charged, ฿350; two scooters and 5 helmets is 4 included, 1 charged", () => {
    const one = quote(
      quoteInputFor(inputs, [
        { id: "s", productId: "scooter", quantity: 1, span: week },
        { id: "h", productId: "helmet", quantity: 3, extraOf: "s" },
      ]),
    );
    if (!one.ok) throw new Error("expected a price");
    expect(one.lines[1]).toMatchObject({
      parentLineId: "s",
      includedQuantity: 2,
      chargedQuantity: 1,
      listPrice: BigInt(35000),
    });
    expect(one.totals.total).toBe(BigInt(175000));
    const two = quote(
      quoteInputFor(inputs, [
        { id: "s", productId: "scooter", quantity: 2, span: week },
        { id: "h", productId: "helmet", quantity: 5, extraOf: "s" },
      ]),
    );
    if (!two.ok) throw new Error("expected a price");
    expect(two.lines[1]).toMatchObject({
      includedQuantity: 4,
      chargedQuantity: 1,
      listPrice: BigInt(35000),
    });
    expect(two.totals.total).toBe(BigInt(315000));
  });

  it("an extra with no dates takes its vehicle's, and its vehicle's original pickup on a later period; with its own dates it keeps them", () => {
    const later = {
      start: bkk("2027-12-01"),
      end: bkk("2027-12-08"),
      timeZone: BANGKOK,
    };
    const input = quoteInputFor(inputs, [
      {
        id: "s",
        productId: "scooter",
        quantity: 1,
        span: later,
        rentalStart: bkk("2027-11-01"),
      },
      { id: "h", productId: "helmet", quantity: 1, extraOf: "s" },
      {
        id: "c",
        productId: "cover",
        quantity: 1,
        extraOf: "s",
        span: { ...later, end: bkk("2027-12-04") },
      },
    ]);
    expect(input.lines[1].span).toEqual(later);
    expect(input.lines[1].rentalStart).toEqual(bkk("2027-11-01"));
    expect(input.lines[2].span.end).toEqual(bkk("2027-12-04"));
    expect(input.lines[2].rentalStart).toBeNull();
    // A line that is no extra is as it always was.
    expect(input.lines[0].extraOf).toBeNull();
  });

  it("the allowance is the one of the vehicle on the parent line: each vehicle's own, and none for a product not offered with it", () => {
    const input = quoteInputFor(inputs, [
      { id: "s", productId: "scooter", quantity: 1, span: week },
      { id: "t", productId: "tourer", quantity: 1, span: week },
      { id: "hs", productId: "helmet", quantity: 3, extraOf: "s" },
      { id: "ht", productId: "helmet", quantity: 3, extraOf: "t" },
      { id: "c", productId: "cover", quantity: 1, extraOf: "s" },
      { id: "alone", productId: "helmet", quantity: 1, span: week },
    ]);
    expect(input.lines.map((l) => l.extraOf)).toEqual([
      null,
      null,
      { lineId: "s", includedQuantity: 2 },
      { lineId: "t", includedQuantity: 1 },
      { lineId: "s", includedQuantity: 0 },
      null,
    ]);
    expect(includedWith(inputs, "scooter", "helmet")).toBe(2);
    expect(includedWith(inputs, "scooter", "cover")).toBe(0);
    expect(extrasOf(inputs, "tourer").map((e) => e.every_vehicle)).toEqual([
      true,
    ]);
    expect(extrasOf(inputs, "helmet")).toEqual([]);
  });

  it("refuses a line with no dates and no vehicle line to take them from, and an extra of a line that isn't there or of itself", () => {
    expect(() =>
      quoteInputFor(inputs, [{ id: "h", productId: "helmet", quantity: 1 }]),
    ).toThrow(/no dates/);
    expect(() =>
      quoteInputFor(inputs, [
        {
          id: "h",
          productId: "helmet",
          quantity: 1,
          span: week,
          extraOf: "gone",
        },
      ]),
    ).toThrow(/isn't here/);
    expect(() =>
      quoteInputFor(inputs, [
        { id: "h", productId: "helmet", quantity: 1, span: week, extraOf: "h" },
      ]),
    ).toThrow(/isn't here/);
    // An extra of an extra, or of gear: quote()'s own check.
    expect(() =>
      quote(
        quoteInputFor(inputs, [
          { id: "h", productId: "helmet", quantity: 1, span: week },
          { id: "c", productId: "cover", quantity: 1, extraOf: "h" },
        ]),
      ),
    ).toThrow(/vehicle/);
  });

  it("the snapshot's context comes from the same rows: names, the profile in force and each season's name", () => {
    const lines = [
      { id: "s", productId: "scooter", quantity: 1, span: week },
      { id: "c", productId: "cover", quantity: 1, extraOf: "s" },
      { id: "x", productId: "unknown", quantity: 1, span: week },
    ];
    const pricedAt = new Date("2027-10-01T00:00:00Z");
    expect(snapshotContextFor(inputs, lines, { pricedAt })).toEqual({
      currency: "THB",
      exponent: 2,
      pricedAt,
      lines: {
        s: {
          productName: "scooter",
          productType: "vehicle",
          taxProfile: { id: "p1", name: "VAT 7%" },
        },
        // Not taxable: no profile. No pricing row: no entry at all.
        c: { productName: "cover", productType: "gear", taxProfile: null },
      },
      seasons: { low: { name: "Low season" } },
      coupons: undefined,
    });
    // No settings row: the currency is the priced products'. Dong has no decimals.
    const dong = snapshotContextFor(
      {
        settings: null,
        products: [perDay("scooter", "150000", { currency: "VND" })],
        seasons: [],
        extras: [],
      },
      lines.slice(0, 1),
      { pricedAt },
    );
    expect([dong.currency, dong.exponent]).toEqual(["VND", 0]);
    expect(() =>
      snapshotContextFor(
        { settings: null, products: [], seasons: [], extras: [] },
        lines,
        { pricedAt },
      ),
    ).toThrow(/No currency/);
  });
});

describe("a read about one vehicle also carries its extras (review of PR 43)", () => {
  // As the database sends it: rows in product-id order, and the helmet's id
  // sorts before the scooter's. One season for every product, one for the
  // scooter, one for the helmet only.
  const season = (id: string, productIds: string[] | "all") => ({
    id,
    name: id,
    starts_on: "2028-01-01",
    ends_on: "2028-01-31",
    repeats_yearly: false,
    adjust_bp: 1000,
    all_products: productIds === "all",
    product_ids: productIds === "all" ? [] : productIds,
  });
  const HELMET = "0aaaaaaa-0000-4000-8000-000000000001";
  const SCOOTER = "f0000000-0000-4000-8000-000000000002";
  const read: PricingInputs = {
    settings,
    products: [
      row({
        product_id: HELMET,
        product_type: "gear",
        pricing_method: "per_period",
        price_amount: "5000",
        price_period: "day",
      }),
      row({
        product_id: SCOOTER,
        pricing_method: "tiered",
        template: amountsList,
      }),
    ],
    seasons: [
      season("everything", "all"),
      season("scooters", [SCOOTER]),
      season("helmets", [HELMET]),
    ],
    extras: [
      {
        product_id: SCOOTER,
        extra_product_id: HELMET,
        extra_product_type: "gear",
        included_quantity: 2,
        max_quantity: null,
        sort_position: 0,
        every_vehicle: false,
      },
    ],
  };

  it("the vehicle's row is found by its id: the first row is its helmet's, priced another way", () => {
    expect(read.products[0].product_id).toBe(HELMET);
    expect(read.products[0].pricing_method).toBe("per_period");
    // What the Moto Mangos tab asks: is the vehicle priced by rental length?
    expect(pricingRowOf(read, SCOOTER)?.pricing_method).toBe("tiered");
    expect(pricingRowOf(read, HELMET)?.pricing_method).toBe("per_period");
    expect(pricingRowOf(read, "unknown")).toBeUndefined();
  });

  it("a product's seasons are the ones for every product and the ones that name it, not its extras'", () => {
    expect(read.seasons.map((s) => s.id)).toEqual([
      "everything",
      "scooters",
      "helmets",
    ]);
    expect(seasonsFor(read, SCOOTER).map((s) => s.id)).toEqual([
      "everything",
      "scooters",
    ]);
    expect(seasonsFor(read, HELMET).map((s) => s.id)).toEqual([
      "everything",
      "helmets",
    ]);
    expect(seasonsFor(read, "unknown").map((s) => s.id)).toEqual([
      "everything",
    ]);
  });
});
