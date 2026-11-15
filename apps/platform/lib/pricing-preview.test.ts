import { describe, expect, it } from "vitest";
import {
  emptyBoxes,
  type PricingContext,
  type PricingDraft,
} from "./pricing-form";
import type { PricingInputs } from "./pricing-inputs";
import {
  draftRow,
  previewInputs,
  previewQuote,
  priceSummary,
  sampleSpan,
  type SharedList,
} from "./pricing-preview";

const n = (value: number) => BigInt(value);
const zone = "Asia/Bangkok";
const ctx: PricingContext = {
  type: "vehicle",
  currency: "THB",
  step: n(1000),
  sharedKinds: new Map([["m", "multipliers"]]),
  showDeposit: true,
  showTax: true,
};
const draft = (change: Partial<PricingDraft>): PricingDraft => ({
  method: "tiered",
  flatAmount: "",
  flatPeriod: "day",
  fixedAmount: "",
  source: "own",
  sharedId: "",
  baseAmount: "",
  list: {
    boxes: { ...emptyBoxes(), daily: "300", twoWeeks: "2100", monthly: "3000" },
    manual: {},
  },
  longStay: "100",
  deposit: "",
  tax: "default",
  replacement: "",
  ...change,
});
const tax = {
  profiles: [{ id: "vat", name: "VAT 7%", rate_bp: 700 }],
  defaultId: "vat",
};
const inputs: PricingInputs = {
  settings: {
    currency: "THB",
    rounding_step: "1000",
    tax_inclusive: true,
    coupons_enabled: false,
    deposit_mode: "per_product",
    deposit_percent_bp: null,
    deposit_amount: "200000",
    default_tax_profile_id: "vat",
  },
  products: [],
  seasons: [],
};
const span = (pickup: string, days: number) =>
  sampleSpan({ by: "days", pickup, days }, zone)!;

describe("Check a price: the form priced by quote()", () => {
  it("a month and 14 days from 1 Jan: ฿3,000 + 14 × ฿100, VAT included", () => {
    const row = draftRow("p", draft({}), ctx, [], tax);
    const { start, end } = sampleSpan(
      { by: "dates", pickup: "2027-01-01T10:00", dropoff: "2027-02-15T10:00" },
      zone,
    )!;
    const quote = previewQuote(inputs, row, {
      start,
      end,
      quantity: 1,
      timeZone: zone,
    });
    expect(quote?.ok).toBe(true);
    if (!quote?.ok) return;
    expect(quote.totals.total).toBe(n(440000));
    expect(quote.lines[0].unit.basis).toMatchObject({
      kind: "months",
      months: 1,
      leftoverDays: 14,
    });
    // No deposit typed: the shop's ฿2,000 per vehicle.
    expect(quote.deposit.amount).toBe(n(200000));
  });

  it("14 days is the list's two-week price; a month is ฿3,000 with VAT ฿196.26", () => {
    const row = draftRow("p", draft({}), ctx, [], tax);
    const twoWeeks = previewQuote(inputs, row, {
      ...span("2027-01-01T10:00", 14),
      quantity: 1,
      timeZone: zone,
    });
    expect(twoWeeks?.ok && twoWeeks.totals.total).toBe(n(210000));
    const month = previewQuote(inputs, row, {
      ...span("2027-01-01T10:00", 30),
      quantity: 1,
      timeZone: zone,
    });
    expect(month?.ok && month.taxGroups[0].vat).toBe(n(19626));
  });

  it("prices unsaved edits: a deposit typed, two bikes, not taxable", () => {
    const row = draftRow(
      "p",
      draft({ deposit: "5000", tax: "none" }),
      ctx,
      [],
      tax,
    );
    const quote = previewQuote(inputs, row, {
      ...span("2027-01-01T10:00", 1),
      quantity: 2,
      timeZone: zone,
    });
    expect(quote?.ok).toBe(true);
    if (!quote?.ok) return;
    expect(quote.totals.total).toBe(n(60000));
    expect(quote.taxGroups).toEqual([]);
    expect(quote.deposit.amount).toBe(n(1000000));
  });

  it("a shop with no settings row: the deposit typed is the deposit Save will give", () => {
    // No pricing settings saved yet: the shop takes no deposit, until the
    // save of its first product deposit sets it to "per product".
    const none: PricingInputs = { settings: null, products: [], seasons: [] };
    const typed = draft({ deposit: "2000" });
    const row = draftRow("p", typed, ctx, [], tax);
    const sample = {
      ...span("2027-01-01T10:00", 45),
      quantity: 2,
      timeZone: zone,
    };
    const quote = previewQuote(previewInputs(none, typed, ctx), row, sample);
    expect(quote?.ok).toBe(true);
    if (!quote?.ok) return;
    // A month and 14 days: 2 × (฿3,000 + 14 × ฿100), and 2 × ฿2,000.
    expect(quote.totals.total).toBe(n(880000));
    expect(quote.deposit.amount).toBe(n(400000));
    // The settings row's defaults otherwise: tax included, no coupons.
    expect(previewInputs(none, typed, ctx).settings).toMatchObject({
      currency: "THB",
      deposit_mode: "per_product",
      deposit_amount: null,
      tax_inclusive: true,
      coupons_enabled: false,
    });

    // Nothing typed, or 0 ("no deposit for this one"): Save sets nothing.
    for (const deposit of ["", "0", "abc"]) {
      const d = draft({ deposit });
      expect(previewInputs(none, d, ctx)).toBe(none);
      const q = previewQuote(
        previewInputs(none, d, ctx),
        draftRow("p", d, ctx, [], tax),
        sample,
      );
      expect(q?.ok && q.deposit.amount).toBe(n(0));
    }
    // The deposit is not on the form (not a vehicle): nothing changes.
    expect(previewInputs(none, typed, { ...ctx, showDeposit: false })).toBe(
      none,
    );
    // A shop that has chosen keeps its choice.
    expect(previewInputs(inputs, typed, ctx)).toBe(inputs);
    const fixed: PricingInputs = {
      ...inputs,
      settings: {
        ...inputs.settings!,
        deposit_mode: "none",
        deposit_amount: null,
      },
    };
    expect(previewInputs(fixed, typed, ctx)).toBe(fixed);
  });

  it("a shared multipliers list at this product's base price", () => {
    const shared: SharedList[] = [
      {
        id: "m",
        name: "350–3500",
        kind: "multipliers",
        hourly: null,
        days: Array.from({ length: 30 }, (_, i) =>
          String(
            i === 0 ? 3500000 : i === 29 ? 35000000 : 3500000 + i * 1000000,
          ),
        ),
      },
    ];
    const row = draftRow(
      "p",
      draft({ source: "shared", sharedId: "m", baseAmount: "100" }),
      ctx,
      shared,
      tax,
    );
    const quote = previewQuote(inputs, row, {
      ...span("2027-01-01T10:00", 1),
      quantity: 1,
      timeZone: zone,
    });
    expect(quote?.ok && quote.totals.total).toBe(n(35000));
    // No base price yet: nothing to price.
    expect(
      draftRow(
        "p",
        draft({ source: "shared", sharedId: "m" }),
        ctx,
        shared,
        tax,
      ),
    ).toBeNull();
  });

  it("a season takes its share of the days inside it", () => {
    const row = draftRow(
      "p",
      draft({ method: "per_period", flatAmount: "200" }),
      ctx,
      [],
      tax,
    );
    const quote = previewQuote(
      {
        ...inputs,
        seasons: [
          {
            id: "low",
            name: "Low season",
            starts_on: "2027-04-01",
            ends_on: "2027-09-30",
            repeats_yearly: true,
            adjust_bp: -2000,
            all_products: true,
            product_ids: [],
          },
        ],
      },
      row,
      { ...span("2027-03-29T10:00", 7), quantity: 1, timeZone: zone },
    );
    expect(quote?.ok).toBe(true);
    if (!quote?.ok) return;
    // 7 × ฿200 = ฿1,400; 4 days inside at 20% off: ฿160 off.
    expect(quote.lines[0].seasons[0]).toMatchObject({
      periodsInside: 4,
      amount: n(-16000),
    });
    expect(quote.totals.total).toBe(n(124000));
  });

  it("nothing to price: no method, a list that falls, a return before the pickup", () => {
    expect(draftRow("p", draft({ method: null }), ctx, [], tax)).toBeNull();
    const falling = draft({
      list: {
        boxes: { ...emptyBoxes(), daily: "300", monthly: "3000" },
        manual: { 4: "1" },
      },
    });
    expect(draftRow("p", falling, ctx, [], tax)).toBeNull();
    expect(
      sampleSpan(
        {
          by: "dates",
          pickup: "2027-01-02T10:00",
          dropoff: "2027-01-01T10:00",
        },
        zone,
      ),
    ).toBeNull();
    const row = draftRow("p", draft({}), ctx, [], tax);
    expect(
      previewQuote(inputs, row, {
        ...span("2027-01-01T10:00", 1),
        quantity: 0,
        timeZone: zone,
      }),
    ).toBeNull();
  });

  it("days are counted on the shop's clock, across a clock change", () => {
    const { start, end } = sampleSpan(
      { by: "days", pickup: "2027-03-13T10:00", days: 2 },
      "America/New_York",
    )!;
    // 47 hours: the clocks went forward on 14 March.
    expect(end.getTime() - start.getTime()).toBe(47 * 3600 * 1000);
  });
});

describe("the Products list's price", () => {
  const base = {
    product_id: "p",
    product_type: "vehicle" as const,
    currency: "THB",
    price_amount: null,
    price_period: null,
    base_amount: null,
    long_stay_day: null,
    deposit: null,
    replacement_price: null,
    taxable: true,
    tax_rate_bp: null,
    tax_profile_name: null,
    template: null,
  };

  it("a list's 1-day total, a flat fee, fixed, free, or no price yet", () => {
    expect(
      priceSummary({
        ...base,
        pricing_method: "tiered",
        base_amount: "10000",
        template: {
          id: "m",
          name: "x",
          kind: "multipliers",
          shared: true,
          hourly: null,
          days: Array.from({ length: 30 }, (_, i) => String((i + 3) * 1000000)),
        },
      }),
    ).toEqual({ kind: "day", amount: n(30000) });
    expect(
      priceSummary({
        ...base,
        pricing_method: "per_period",
        price_amount: "20000",
        price_period: "week",
      }),
    ).toEqual({ kind: "period", amount: n(20000), period: "week" });
    expect(
      priceSummary({ ...base, pricing_method: "fixed", price_amount: "15000" }),
    ).toEqual({
      kind: "fixed",
      amount: n(15000),
    });
    expect(priceSummary({ ...base, pricing_method: "free" })).toEqual({
      kind: "free",
    });
    expect(priceSummary({ ...base, pricing_method: null })).toEqual({
      kind: "none",
    });
    expect(priceSummary(undefined)).toEqual({ kind: "none" });
  });
});
