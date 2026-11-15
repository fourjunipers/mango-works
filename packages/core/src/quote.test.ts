import { describe, expect, it } from "vitest";
import { fillPriceList, type ResolvedList } from "./price-list";
import {
  creditVatBases,
  depositAmount,
  depositSettingFor,
  quote,
  QuoteError,
  splitProportionally,
  vatFor,
  type DepositSetting,
  type Discount,
  type Quote,
  type QuoteInput,
  type QuoteLineInput,
} from "./quote";
import type { Pricing } from "./rental-price";
import type { SeasonRule } from "./season";

/** Baht as a string ("116.66") → satang, with no float on the way. */
function thb(amount: string): bigint {
  const [whole, fraction = ""] = amount.replace(/,/g, "").split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

const bkk = (date: string, time = "10:00") =>
  new Date(`${date}T${time}:00+07:00`);

function list(
  daily: string,
  weekly: string,
  twoWeeks: string,
  monthly: string,
) {
  const filled = fillPriceList(
    {
      daily: thb(daily),
      weekly: thb(weekly),
      twoWeeks: thb(twoWeeks),
      monthly: thb(monthly),
    },
    new Map(),
    thb("10"),
  );
  return {
    days: filled.days.map((d) => d.total),
    hourly: null,
  } as ResolvedList;
}

const BIKE_300: Pricing = {
  method: "tiered",
  list: list("300", "1400", "2100", "3000"),
  longStayDay: thb("100"),
};
const BIKE_350: Pricing = {
  method: "tiered",
  list: list("350", "1500", "2500", "3500"),
  longStayDay: thb("116.66"),
};
const fixed = (amount: string): Pricing => ({
  method: "fixed",
  amount: thb(amount),
});

const VAT_7 = 700;
const NO_DEPOSIT: DepositSetting = { mode: "none" };

/** A line for 1 Nov 2027 (outside any season used here) for `days` days. */
function line(
  id: string,
  pricing: Pricing | null,
  more: Partial<QuoteLineInput> & { days?: number } = {},
): QuoteLineInput {
  const { days = 30, ...rest } = more;
  const start = bkk("2027-11-01");
  return {
    id,
    productId: id,
    pricing,
    quantity: 1,
    span: {
      start,
      end: new Date(start.getTime() + days * 24 * 60 * 60 * 1000),
      timeZone: "Asia/Bangkok",
    },
    taxRateBp: VAT_7,
    vehicle: true,
    ...rest,
  };
}

function run(
  input: Partial<QuoteInput> & { lines: readonly QuoteLineInput[] },
) {
  const result = quote({
    taxInclusive: true,
    couponsEnabled: false,
    deposit: { shop: NO_DEPOSIT },
    ...input,
  });
  if (!result.ok) throw new Error("expected a priced quote");
  return result;
}

type Priced = Extract<Quote, { ok: true }>;
const money = (q: Priced) => ({
  net: q.totals.net,
  vat: q.totals.vat,
  total: q.totals.total,
});

describe("VAT, once per invoice (accountant, 15 Nov 2026)", () => {
  it("prices include VAT: ฿3,000 at 7% is VAT ฿196.26 and net ฿2,803.74", () => {
    const q = run({ taxInclusive: true, lines: [line("a", BIKE_300)] });
    expect(money(q)).toEqual({
      net: thb("2803.74"),
      vat: thb("196.26"),
      total: thb("3000"),
    });
    expect(q.taxGroups).toEqual([
      {
        rateBp: 700,
        base: thb("3000"),
        net: thb("2803.74"),
        vat: thb("196.26"),
        gross: thb("3000"),
      },
    ]);
    // The total charged is the sum of the line prices.
    expect(q.totals.total).toBe(q.lines[0].amount);
  });

  it("VAT added on top: ฿3,000 net at 7% is VAT ฿210 and total ฿3,210", () => {
    const q = run({ taxInclusive: false, lines: [line("a", BIKE_300)] });
    expect(money(q)).toEqual({
      net: thb("3000"),
      vat: thb("210"),
      total: thb("3210"),
    });
    expect(q.taxGroups).toEqual([
      {
        rateBp: 700,
        base: thb("3000"),
        net: thb("3000"),
        vat: thb("210"),
        gross: thb("3210"),
      },
    ]);
  });

  it("the two styles agree: ฿2,803.74 net with VAT on top comes back to ฿3,000", () => {
    expect(vatFor(thb("2803.74"), 700, false)).toMatchObject({
      vat: thb("196.26"),
      gross: thb("3000"),
    });
    expect(vatFor(thb("3000"), 700, true)).toMatchObject({
      vat: thb("196.26"),
      net: thb("2803.74"),
    });
  });

  it("is worked out on the invoice, not line by line", () => {
    // Three lines of ฿350. Line by line VAT would be 3 × ฿22.90 = ฿68.70.
    // On the invoice: 1,050 × 7 ÷ 107 = 68.691… → ฿68.69.
    const q = run({
      lines: [
        line("a", fixed("350")),
        line("b", fixed("350")),
        line("c", fixed("350")),
      ],
    });
    expect(money(q)).toEqual({
      net: thb("981.31"),
      vat: thb("68.69"),
      total: thb("1050"),
    });
    expect(q.taxGroups).toHaveLength(1);
    // A line carries its rate and no tax amount.
    expect(q.lines[0]).not.toHaveProperty("vat");
    expect(q.lines[0].taxRateBp).toBe(700);
  });

  it("rounds once per rate group, half up to the satang", () => {
    expect(vatFor(107n, 700, true).vat).toBe(7n); // exactly 7
    expect(vatFor(100n, 700, true).vat).toBe(7n); // 6.54
    expect(vatFor(99n, 700, true).vat).toBe(6n); // 6.48
    expect(vatFor(50n, 700, false).vat).toBe(4n); // 3.5 → 4
    expect(vatFor(49n, 700, false).vat).toBe(3n); // 3.43
    expect(vatFor(0n, 700, true).vat).toBe(0n);
  });

  it("gives one VAT line per rate, and none for what is not taxable", () => {
    const q = run({
      lines: [
        line("bike", BIKE_300), // 3,000 at 7%
        line("cover", fixed("1000"), { taxRateBp: 1000, vehicle: false }),
        line("permit", fixed("500"), { taxRateBp: null, vehicle: false }),
        line("helmet", fixed("107"), { vehicle: false }), // joins the 7% group
      ],
    });
    expect(q.taxGroups.map((g) => [g.rateBp, g.base, g.vat])).toEqual([
      [700, thb("3107"), thb("203.26")], // 3,107 × 7 ÷ 107 = 203.2616…
      [1000, thb("1000"), thb("90.91")], // 1,000 × 10 ÷ 110
    ]);
    expect(q.nonTaxable).toBe(thb("500"));
    expect(q.totals.total).toBe(thb("4607"));
    expect(q.totals.vat).toBe(thb("294.17"));
    expect(q.totals.net).toBe(thb("4312.83"));
  });

  it("shows no VAT at all for a shop that charges none", () => {
    const q = run({ lines: [line("a", BIKE_300, { taxRateBp: null })] });
    expect(q.taxGroups).toEqual([]);
    expect(money(q)).toEqual({ net: thb("3000"), vat: 0n, total: thb("3000") });
  });

  it("keeps a zero-rated group as its own line with no VAT", () => {
    const q = run({ lines: [line("a", BIKE_300, { taxRateBp: 0 })] });
    expect(q.taxGroups).toEqual([
      {
        rateBp: 0,
        base: thb("3000"),
        net: thb("3000"),
        vat: 0n,
        gross: thb("3000"),
      },
    ]);
  });
});

describe("discounts reduce the VAT base", () => {
  const staff = (more: Partial<Discount> & { id?: string }): Discount =>
    ({ id: "d", source: "staff", lines: "all", ...more }) as Discount;

  it("a staff price of ฿2,500 against ฿3,000: VAT is on ฿2,500", () => {
    const q = run({
      lines: [line("a", BIKE_300)],
      discounts: [staff({ amount: thb("500"), lines: ["a"] })],
    });
    expect(q.lines[0]).toMatchObject({
      listPrice: thb("3000"),
      discount: thb("500"),
      amount: thb("2500"),
    });
    // 2,500 × 7 ÷ 107 = 163.551…
    expect(money(q)).toEqual({
      net: thb("2336.45"),
      vat: thb("163.55"),
      total: thb("2500"),
    });
    expect(q.totals.discount).toBe(thb("500"));
  });

  it("takes a percentage on each line, and VAT on top of what is left", () => {
    const q = run({
      taxInclusive: false,
      lines: [line("a", BIKE_300), line("b", fixed("333"), { vehicle: false })],
      discounts: [staff({ percentBp: 1000 })],
    });
    expect(q.lines.map((l) => l.discount)).toEqual([thb("300"), thb("33.30")]);
    // Net 2,700 + 299.70 = 2,999.70; VAT 7% = 209.979 → 209.98.
    expect(money(q)).toEqual({
      net: thb("2999.70"),
      vat: thb("209.98"),
      total: thb("3209.68"),
    });
  });

  it("shares an order discount over its lines so the shares add up exactly", () => {
    // ฿200 over ฿1,400 and ฿300: 164.705… and 35.294… → ฿164.71 and ฿35.29.
    const q = run({
      lines: [
        line("bike", BIKE_300, { days: 7 }),
        line("box", fixed("300"), { vehicle: false }),
      ],
      discounts: [staff({ amount: thb("200") })],
    });
    expect(q.lines.map((l) => l.discount)).toEqual([
      thb("164.71"),
      thb("35.29"),
    ]);
    expect(q.totals.discount).toBe(thb("200"));
    expect(q.totals.total).toBe(thb("1500"));
  });

  it("splits an order discount across tax-rate groups before VAT", () => {
    // The same ฿200, but the box is not taxable. The 7% group is then
    // 1,400 − 164.71 = 1,235.29 and the rest 300 − 35.29 = 264.71.
    const q = run({
      lines: [
        line("bike", BIKE_300, { days: 7 }),
        line("box", fixed("300"), { vehicle: false, taxRateBp: null }),
      ],
      discounts: [staff({ amount: thb("200") })],
    });
    expect(q.taxGroups).toEqual([
      {
        rateBp: 700,
        base: thb("1235.29"),
        net: thb("1154.48"),
        vat: thb("80.81"), // 1,235.29 × 7 ÷ 107 = 80.813…
        gross: thb("1235.29"),
      },
    ]);
    expect(q.nonTaxable).toBe(thb("264.71"));
    expect(q.totals.total).toBe(thb("1500"));
  });

  it("applies discounts in the order given, each on what the last one left", () => {
    const q = run({
      lines: [line("a", BIKE_300)],
      discounts: [
        staff({ id: "first", percentBp: 1000 }), // 3,000 → 2,700
        staff({ id: "second", percentBp: 1000 }), // 2,700 → 2,430
      ],
    });
    expect(q.lines[0].discounts).toEqual([
      { discountId: "first", amount: thb("300") },
      { discountId: "second", amount: thb("270") },
    ]);
    expect(q.lines[0].amount).toBe(thb("2430"));
  });

  it("never takes more than the lines come to", () => {
    const q = run({
      lines: [line("a", fixed("100")), line("b", fixed("50"))],
      discounts: [staff({ amount: thb("500") })],
    });
    expect(q.lines.map((l) => l.amount)).toEqual([0n, 0n]);
    expect(q.totals.discount).toBe(thb("150"));
    expect(money(q)).toEqual({ net: 0n, vat: 0n, total: 0n });
  });

  it("touches only the lines it names, and refuses a line that isn't there", () => {
    const lines = [line("a", BIKE_300), line("b", fixed("300"))];
    const q = run({
      lines,
      discounts: [staff({ percentBp: 5000, lines: ["b"] })],
    });
    expect(q.lines.map((l) => l.discount)).toEqual([0n, thb("150")]);
    expect(() =>
      run({ lines, discounts: [staff({ percentBp: 5000, lines: ["zzz"] })] }),
    ).toThrow(QuoteError);
  });

  it("refuses a discount of nothing, or of more than 100%", () => {
    const lines = [line("a", BIKE_300)];
    expect(() => run({ lines, discounts: [staff({ amount: 0n })] })).toThrow(
      QuoteError,
    );
    expect(() => run({ lines, discounts: [staff({ percentBp: 0 })] })).toThrow(
      QuoteError,
    );
    expect(() =>
      run({ lines, discounts: [staff({ percentBp: 10001 })] }),
    ).toThrow(QuoteError);
  });
});

describe("the Accept coupons switch", () => {
  const coupon: Discount = {
    id: "WELCOME10",
    source: "coupon",
    lines: "all",
    percentBp: 1000,
  };
  const lines = [line("a", BIKE_300)];

  it("is off by default in a shop, and a coupon is then refused", () => {
    let error: unknown;
    try {
      quote({
        taxInclusive: true,
        couponsEnabled: false,
        lines,
        discounts: [coupon],
        deposit: { shop: NO_DEPOSIT },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(QuoteError);
    expect((error as QuoteError).code).toBe("coupons_off");
  });

  it("lets a coupon through when the shop has switched it on", () => {
    const q = run({ couponsEnabled: true, lines, discounts: [coupon] });
    expect(q.lines[0].amount).toBe(thb("2700"));
    // 2,700 × 7 ÷ 107 = 176.635…
    expect(q.totals.vat).toBe(thb("176.64"));
  });

  it("does not stop a staff price or any other discount", () => {
    for (const source of ["staff", "returning_customer", "other"] as const) {
      const q = run({
        couponsEnabled: false,
        lines,
        discounts: [{ id: "x", source, lines: "all", percentBp: 1000 }],
      });
      expect(q.lines[0].amount).toBe(thb("2700"));
    }
  });
});

describe("seasons inside the pricer", () => {
  const low: SeasonRule = {
    id: "low",
    startsOn: "2027-04-01",
    endsOn: "2027-09-30",
    repeatsYearly: true,
    adjustBp: -2000,
    products: "all",
  };
  const week = (id: string, pricing: Pricing, from: string, to: string) =>
    line(id, pricing, {
      span: { start: bkk(from), end: bkk(to), timeZone: "Asia/Bangkok" },
    });

  it("comes before discounts and VAT: 3 of 7 days at 20% off", () => {
    const q = run({
      lines: [week("a", BIKE_300, "2027-03-28", "2027-04-04")],
      seasonRules: [low],
      discounts: [{ id: "d", source: "staff", lines: "all", percentBp: 1000 }],
    });
    expect(q.lines[0]).toMatchObject({
      listPrice: thb("1400"),
      seasonPrice: thb("1280"),
      discount: thb("128"), // 10% of the season price
      amount: thb("1152"),
    });
    expect(q.totals.seasons).toBe(-thb("120"));
    // 1,152 × 7 ÷ 107 = 75.364…
    expect(q.totals.vat).toBe(thb("75.36"));
  });

  it("keeps the satang through to the total", () => {
    const q = run({
      lines: [week("a", BIKE_350, "2027-03-27", "2027-04-03")],
      seasonRules: [low],
    });
    expect(q.lines[0].seasonPrice).toBe(thb("1414.29"));
    expect(q.totals.total).toBe(thb("1414.29"));
  });

  it("works the adjustment out on the line, after quantity", () => {
    // Two bikes: 3,000 × 20% × 2 ÷ 7 = 171.428… → ฿171.43, rounded once,
    // not ฿85.71 twice (฿171.42).
    const q = run({
      lines: [
        { ...week("a", BIKE_350, "2027-03-27", "2027-04-03"), quantity: 2 },
      ],
      seasonRules: [low],
    });
    expect(q.lines[0].listPrice).toBe(thb("3000"));
    expect(q.lines[0].seasonPrice).toBe(thb("2828.57"));
  });

  it("leaves a fixed price and a deposit alone", () => {
    const q = run({
      lines: [
        week("bike", BIKE_300, "2027-06-01", "2027-06-08"),
        {
          ...week("box", fixed("300"), "2027-06-01", "2027-06-08"),
          vehicle: false,
        },
      ],
      seasonRules: [low],
      deposit: { shop: { mode: "fixed_per_order", amount: thb("2000") } },
    });
    expect(q.lines.map((l) => l.seasonPrice)).toEqual([
      thb("1120"),
      thb("300"),
    ]);
    expect(q.deposit.amount).toBe(thb("2000"));
  });
});

describe("a swap credit and the VAT base (accountant, 15 Nov 2026)", () => {
  // The owner's swap: the new bike's remainder is ฿1,800, the credit carried
  // from the old bike is ฿1,500, and the customer pays ฿300.
  const swap = (taxInclusive: boolean) =>
    run({
      taxInclusive,
      lines: [line("b", fixed("1800"))],
      credits: [{ id: "from-a", amount: thb("1500"), taxRateBp: VAT_7 }],
    });

  it("puts VAT on the ฿300 actually paid", () => {
    const q = swap(true);
    // 300 × 7 ÷ 107 = 19.626…
    expect(money(q)).toEqual({
      net: thb("280.37"),
      vat: thb("19.63"),
      total: thb("300"),
    });
    expect(q.totals.credit).toBe(thb("1500"));
    // The line itself is not discounted: the credit is beside it.
    expect(q.lines[0]).toMatchObject({ amount: thb("1800"), discount: 0n });
  });

  it("makes VAT across both invoices the VAT on the ฿3,300 paid in all", () => {
    const first = run({ lines: [line("a", BIKE_300)] }); // ฿3,000, VAT ฿196.26
    const second = swap(true);
    expect(first.totals.vat + second.totals.vat).toBe(thb("215.89"));
    expect(vatFor(thb("3300"), 700, true).vat).toBe(thb("215.89"));
  });

  it("does the same with VAT added on top", () => {
    expect(money(swap(false))).toEqual({
      net: thb("300"),
      vat: thb("21"),
      total: thb("321"),
    });
  });

  it("sets a credit against its own rate group only", () => {
    const bases = new Map<number | "none", bigint>([
      [700, thb("1800")],
      ["none", thb("500")],
    ]);
    const after = creditVatBases(bases, [
      { id: "c1", amount: thb("1500"), taxRateBp: 700 },
      { id: "c2", amount: thb("200"), taxRateBp: null },
    ]);
    expect(after.get(700)).toBe(thb("300"));
    expect(after.get("none")).toBe(thb("300"));
    // The input is not changed.
    expect(bases.get(700)).toBe(thb("1800"));
  });

  it("refuses a credit larger than what it is set against", () => {
    let error: unknown;
    try {
      run({
        lines: [line("b", fixed("1000"))],
        credits: [{ id: "big", amount: thb("1500"), taxRateBp: VAT_7 }],
      });
    } catch (caught) {
      error = caught;
    }
    expect((error as QuoteError).code).toBe("credit_exceeds_base");
    // And one against a rate that is not on the invoice.
    expect(() =>
      run({
        lines: [line("b", fixed("1000"))],
        credits: [{ id: "other", amount: thb("10"), taxRateBp: 1000 }],
      }),
    ).toThrow(QuoteError);
  });
});

describe("deposits", () => {
  const helmet = line("helmet", fixed("100"), {
    vehicle: false,
    deposit: thb("999"), // ignored: gear carries no deposit
  });
  const lines = [
    line("scooter", BIKE_300, { quantity: 2, deposit: thb("2000") }),
    line("touring", BIKE_350, { deposit: thb("5000") }),
    line("plain", BIKE_300, { deposit: null }),
    helmet,
  ];
  // 2 × 3,000 + 3,500 + 3,000 + 100 = ฿12,600.
  const deposit = (shop: DepositSetting, more: Partial<QuoteInput> = {}) =>
    run({ lines, deposit: { shop }, ...more }).deposit.amount;

  it("none", () => {
    expect(deposit({ mode: "none" })).toBe(0n);
  });

  it("a percentage of the order total after discounts, tax included", () => {
    expect(deposit({ mode: "percent_of_order", percentBp: 3000 })).toBe(
      thb("3780"),
    );
    // After a ฿600 discount the total is ฿12,000.
    expect(
      deposit(
        { mode: "percent_of_order", percentBp: 3000 },
        {
          discounts: [
            { id: "d", source: "staff", lines: "all", amount: thb("600") },
          ],
        },
      ),
    ).toBe(thb("3600"));
    // With VAT on top the total is 12,600 + 882 = ฿13,482; 30% is ฿4,044.60.
    expect(
      deposit(
        { mode: "percent_of_order", percentBp: 3000 },
        { taxInclusive: false },
      ),
    ).toBe(thb("4044.60"));
    // Half up to the satang: 12.5% of ฿12,600.01 = 1,575.00125.
    expect(
      depositAmount(
        { mode: "percent_of_order", percentBp: 1250 },
        1260001n,
        [],
      ),
    ).toBe(157500n);
    expect(
      depositAmount({ mode: "percent_of_order", percentBp: 5000 }, 3n, []),
    ).toBe(2n);
  });

  it("a fixed amount per order, however many vehicles", () => {
    expect(deposit({ mode: "fixed_per_order", amount: thb("3000") })).toBe(
      thb("3000"),
    );
  });

  it("per product: each vehicle's own deposit × quantity; vehicles only", () => {
    // 2 × 2,000 + 5,000 + the shop's 1,500 for the bike with none of its own.
    expect(deposit({ mode: "per_product", amount: thb("1500") })).toBe(
      thb("10500"),
    );
    // With no shop amount, a vehicle with none adds nothing.
    expect(deposit({ mode: "per_product" })).toBe(thb("9000"));
    // A deposit of 0 on a product is its own answer, not "use the shop's".
    expect(
      depositAmount({ mode: "per_product", amount: thb("1500") }, 0n, [
        line("free", BIKE_300, { deposit: 0n }),
      ]),
    ).toBe(0n);
  });

  it("takes the order's setting, else the customer's, else the shop's", () => {
    const shop: DepositSetting = { mode: "per_product", amount: thb("1500") };
    const customer: DepositSetting = { mode: "none" }; // a waiver
    const order: DepositSetting = {
      mode: "fixed_per_order",
      amount: thb("1000"),
    };
    expect(depositSettingFor({ shop })).toEqual({
      setting: shop,
      from: "shop",
    });
    expect(depositSettingFor({ shop, customer })).toEqual({
      setting: customer,
      from: "customer",
    });
    expect(depositSettingFor({ shop, customer, order })).toEqual({
      setting: order,
      from: "order",
    });
    expect(depositSettingFor({ shop, customer: null, order })).toEqual({
      setting: order,
      from: "order",
    });

    expect(run({ lines, deposit: { shop } }).deposit.amount).toBe(thb("10500"));
    expect(run({ lines, deposit: { shop, customer } }).deposit).toEqual({
      amount: 0n,
      setting: customer,
      from: "customer",
    });
    expect(run({ lines, deposit: { shop, customer, order } }).deposit).toEqual({
      amount: thb("1000"),
      setting: order,
      from: "order",
    });
  });

  it("is never taxed and never part of the total or the VAT base", () => {
    const without = run({ lines, deposit: { shop: NO_DEPOSIT } });
    for (const shop of [
      { mode: "percent_of_order", percentBp: 3000 },
      { mode: "fixed_per_order", amount: thb("3000") },
      { mode: "per_product", amount: thb("1500") },
    ] as DepositSetting[]) {
      const withDeposit = run({ lines, deposit: { shop } });
      expect(withDeposit.deposit.amount > 0n).toBe(true);
      expect(withDeposit.totals).toEqual(without.totals);
      expect(withDeposit.taxGroups).toEqual(without.taxGroups);
    }
  });

  it("is not reduced by a discount or a season (other than through the percentage)", () => {
    const low: SeasonRule = {
      id: "low",
      startsOn: "2027-01-01",
      endsOn: "2027-12-31",
      repeatsYearly: true,
      adjustBp: -2000,
      products: "all",
    };
    expect(
      run({
        lines,
        seasonRules: [low],
        discounts: [
          { id: "d", source: "staff", lines: "all", percentBp: 5000 },
        ],
        deposit: { shop: { mode: "per_product", amount: thb("1500") } },
      }).deposit.amount,
    ).toBe(thb("10500"));
  });

  it("refuses a negative deposit and a percentage of zero", () => {
    expect(() =>
      depositAmount({ mode: "fixed_per_order", amount: -1n }, 0n, []),
    ).toThrow(QuoteError);
    expect(() =>
      depositAmount({ mode: "percent_of_order", percentBp: 0 }, 100n, []),
    ).toThrow(QuoteError);
  });
});

describe("the rest of quote()", () => {
  it("multiplies by quantity before anything else", () => {
    const q = run({ lines: [line("a", fixed("107"), { quantity: 3 })] });
    expect(q.lines[0].listPrice).toBe(thb("321"));
    expect(q.totals.vat).toBe(thb("21"));
  });

  it("says which lines can't be priced, and prices nothing", () => {
    const result = quote({
      taxInclusive: true,
      couponsEnabled: false,
      lines: [line("a", BIKE_300), line("b", null), line("c", null)],
      deposit: { shop: NO_DEPOSIT },
    });
    expect(result).toEqual({
      ok: false,
      unpriced: [
        { lineId: "b", reason: "no_price" },
        { lineId: "c", reason: "no_price" },
      ],
    });
  });

  it("charges nothing for a free line, which is not the same as no price", () => {
    const q = run({ lines: [line("a", { method: "free" })] });
    expect(money(q)).toEqual({ net: 0n, vat: 0n, total: 0n });
  });

  it("adds up: list price + seasons − discounts − credits = what is charged", () => {
    const q = run({
      lines: [
        line("a", BIKE_300, {
          span: {
            start: bkk("2027-03-28"),
            end: bkk("2027-04-04"),
            timeZone: "Asia/Bangkok",
          },
        }),
        line("b", fixed("300"), { taxRateBp: null, vehicle: false }),
      ],
      seasonRules: [
        {
          id: "low",
          startsOn: "2027-04-01",
          endsOn: "2027-09-30",
          repeatsYearly: true,
          adjustBp: -2000,
          products: "all",
        },
      ],
      discounts: [
        { id: "d", source: "staff", lines: "all", amount: thb("77.77") },
      ],
      credits: [{ id: "c", amount: thb("100"), taxRateBp: VAT_7 }],
    });
    const { listPrice, seasons, discount, credit, net, vat, total } = q.totals;
    expect(listPrice + seasons - discount - credit).toBe(total);
    expect(net + vat).toBe(total);
    expect(q.lines.reduce((sum, l) => sum + l.amount, 0n) - credit).toBe(total);
  });

  it("refuses two lines with one id, and a quantity that is not a whole number", () => {
    expect(() =>
      run({ lines: [line("a", BIKE_300), line("a", BIKE_300)] }),
    ).toThrow(QuoteError);
    expect(() =>
      run({ lines: [line("a", BIKE_300, { quantity: 0 })] }),
    ).toThrow(QuoteError);
    expect(() =>
      run({ lines: [line("a", BIKE_300, { quantity: 1.5 })] }),
    ).toThrow(QuoteError);
    expect(() =>
      run({ lines: [line("a", BIKE_300, { taxRateBp: 10001 })] }),
    ).toThrow(QuoteError);
  });
});

describe("splitProportionally", () => {
  it("adds up exactly and gives leftover units to the largest remainders", () => {
    expect(splitProportionally(20000n, [140000n, 30000n])).toEqual([
      16471n,
      3529n,
    ]);
    expect(splitProportionally(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(splitProportionally(1n, [1n, 1n, 1n])).toEqual([1n, 0n, 0n]);
    expect(splitProportionally(2n, [1n, 3n])).toEqual([1n, 1n]); // 0.5 and 1.5
    expect(splitProportionally(0n, [5n, 5n])).toEqual([0n, 0n]);
    expect(splitProportionally(10n, [0n, 5n])).toEqual([0n, 10n]);
  });

  it("always sums to the total, whatever the weights", () => {
    const weights = [333n, 1n, 77777n, 5n, 12345n, 0n, 9n];
    for (let total = 0n; total < 500n; total += 7n) {
      const shares = splitProportionally(total, weights);
      expect(shares.reduce((a, b) => a + b, 0n)).toBe(total);
      expect(shares.every((share) => share >= 0n)).toBe(true);
    }
  });

  it("has nothing to share over when every weight is zero", () => {
    expect(splitProportionally(0n, [0n, 0n])).toEqual([0n, 0n]);
    expect(() => splitProportionally(5n, [0n, 0n])).toThrow(QuoteError);
  });
});
