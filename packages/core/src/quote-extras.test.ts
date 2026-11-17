import { describe, expect, it } from "vitest";
import {
  includedQuantities,
  quote,
  QuoteError,
  type Discount,
  type Quote,
  type QuoteInput,
  type QuoteLineInput,
} from "./quote";
import {
  bike300,
  bike350,
  fixed,
  input,
  line,
  LOW_SEASON,
  minor,
  perDay,
  pinnedQuotes,
  thb,
  bkk,
  BANGKOK,
} from "./quote-pinned.fixtures";
import type { Pricing } from "./rental-price";

// Step 4 of the pricer: the included quantity (docs/phase-2-plan.md §5.2).

type Priced = Extract<Quote, { ok: true }>;

function run(
  more: Partial<QuoteInput> & { lines: readonly QuoteLineInput[] },
): Priced {
  const result = quote(input(more));
  if (!result.ok) throw new Error("expected a priced quote");
  return result;
}

/** A week on a scooter: ฿1,400. */
const scooter = (more: Partial<QuoteLineInput> = {}) =>
  line("scooter", bike300(), { days: 7, ...more });

/** An extra taken with the scooter for the same week. */
const extra = (
  id: string,
  pricing: Pricing | null,
  quantity: number,
  included: number,
  more: Partial<QuoteLineInput> & { days?: number } = {},
) =>
  line(id, pricing, {
    days: 7,
    quantity,
    vehicle: false,
    extraOf: { lineId: "scooter", includedQuantity: included },
    ...more,
  });

const HELMET = perDay(thb("50"));

const quantities = (q: Priced, id: string) => {
  const found = q.lines.find((l) => l.id === id)!;
  return {
    quantity: found.quantity,
    included: found.includedQuantity,
    charged: found.chargedQuantity,
    listPrice: found.listPrice,
  };
};

describe("included quantity with one vehicle", () => {
  it("the plan's example: 2 helmets included, 3 taken at ฿50 a day for 7 days: 1 charged, ฿350", () => {
    const q = run({ lines: [scooter(), extra("helmet", HELMET, 3, 2)] });
    expect(quantities(q, "helmet")).toEqual({
      quantity: 3,
      included: 2,
      charged: 1,
      listPrice: thb("350"),
    });
    expect(q.lines[1].parentLineId).toBe("scooter");
    expect(q.lines[1].unit.amount).toBe(thb("350"));
    expect(q.totals.total).toBe(thb("1750"));
  });

  it("exactly as many as are included: nothing charged", () => {
    const q = run({ lines: [scooter(), extra("helmet", HELMET, 2, 2)] });
    expect(quantities(q, "helmet")).toEqual({
      quantity: 2,
      included: 2,
      charged: 0,
      listPrice: 0n,
    });
    expect(q.totals.total).toBe(thb("1400"));
  });

  it("none included: every unit is charged", () => {
    const q = run({ lines: [scooter(), extra("helmet", HELMET, 3, 0)] });
    expect(quantities(q, "helmet")).toEqual({
      quantity: 3,
      included: 0,
      charged: 3,
      listPrice: thb("1050"),
    });
  });

  it("leaves the vehicle's own line exactly as it is without the extra", () => {
    const alone = run({ lines: [scooter()] });
    const withExtras = run({
      lines: [scooter(), extra("helmet", HELMET, 3, 2)],
    });
    expect(withExtras.lines[0]).toEqual(alone.lines[0]);
  });

  it("finds its parent wherever it is in the list", () => {
    const q = run({ lines: [extra("helmet", HELMET, 3, 2), scooter()] });
    expect(quantities(q, "helmet")).toMatchObject({ included: 2, charged: 1 });
  });
});

describe("included quantity with several vehicles", () => {
  it("the plan's example: two scooters, 5 helmets: 4 included, 1 charged", () => {
    const q = run({
      lines: [scooter({ quantity: 2 }), extra("helmet", HELMET, 5, 2)],
    });
    expect(quantities(q, "helmet")).toEqual({
      quantity: 5,
      included: 4,
      charged: 1,
      listPrice: thb("350"),
    });
  });

  it("three scooters with one helmet each, 7 taken: 3 included, 4 charged", () => {
    const q = run({
      lines: [scooter({ quantity: 3 }), extra("helmet", HELMET, 7, 1)],
    });
    expect(quantities(q, "helmet")).toEqual({
      quantity: 7,
      included: 3,
      charged: 4,
      listPrice: thb("1400"),
    });
  });

  it("each vehicle line has its own extras", () => {
    const q = run({
      lines: [
        scooter(),
        line("touring", bike350(), { days: 7, quantity: 2 }),
        extra("helmet-a", HELMET, 3, 2),
        extra("helmet-b", HELMET, 3, 1, {
          productId: "helmet-a",
          extraOf: { lineId: "touring", includedQuantity: 1 },
        }),
      ],
    });
    expect(quantities(q, "helmet-a")).toMatchObject({
      included: 2,
      charged: 1,
    });
    expect(quantities(q, "helmet-b")).toMatchObject({
      included: 2,
      charged: 1,
    });
  });

  it("is the same sum for every quantity, allowance and number of vehicles", () => {
    for (let vehicles = 1; vehicles <= 4; vehicles++) {
      for (let each = 0; each <= 3; each++) {
        let before = -1n;
        for (let taken = 1; taken <= 14; taken++) {
          const q = run({
            lines: [
              scooter({ quantity: vehicles }),
              extra("helmet", HELMET, taken, each),
            ],
          });
          const helmet = q.lines[1];
          const charged = Math.max(0, taken - each * vehicles);
          expect(helmet.chargedQuantity).toBe(charged);
          expect(helmet.includedQuantity + helmet.chargedQuantity).toBe(taken);
          expect(helmet.listPrice).toBe(thb("350") * BigInt(charged));
          // One more helmet never costs less.
          expect(helmet.listPrice >= before).toBe(true);
          before = helmet.listPrice;
        }
      }
    }
  });
});

describe("more included than taken", () => {
  const q = run({
    lines: [scooter({ quantity: 2 }), extra("helmet", HELMET, 3, 2)],
  });

  it("4 would be free, 3 are taken: 3 included, none charged", () => {
    expect(quantities(q, "helmet")).toEqual({
      quantity: 3,
      included: 3,
      charged: 0,
      listPrice: 0n,
    });
  });

  it("the line comes to nothing and nothing is owed back for the unused one", () => {
    expect(q.lines[1].amount).toBe(0n);
    expect(q.totals.total).toBe(thb("2800"));
    expect(q.lines.every((l) => l.amount >= 0n)).toBe(true);
  });
});

describe("an extra priced each way", () => {
  const week = (pricing: Pricing | null, taken = 3, included = 2) =>
    run({ lines: [scooter(), extra("x", pricing, taken, included)] }).lines[1];

  it("a flat fee per day: every started day × the charged units", () => {
    expect(week(perDay(thb("50")))).toMatchObject({
      listPrice: thb("350"),
      unit: { amount: thb("350"), basis: { kind: "periods", count: 7 } },
    });
  });

  it("a flat fee per hour, per week and per month", () => {
    expect(
      week({ method: "per_period", amount: thb("2"), period: "hour" }, 4, 1)
        .listPrice,
    ).toBe(thb("2") * 168n * 3n);
    expect(
      week({ method: "per_period", amount: thb("200"), period: "week" }, 4, 1)
        .listPrice,
    ).toBe(thb("600"));
    expect(
      week({ method: "per_period", amount: thb("500"), period: "month" }, 4, 1)
        .listPrice,
    ).toBe(thb("1500"));
  });

  it("by rental length: the list's 7-day total × the charged units", () => {
    // A top box on the 300 list: ฿1,400 a week.
    expect(week(bike300(), 2, 1)).toMatchObject({
      listPrice: thb("1400"),
      unit: { basis: { kind: "list", days: 7 } },
    });
    expect(week(bike300(), 3, 1).listPrice).toBe(thb("2800"));
  });

  it("a fixed price: the amount × the charged units, whatever the length", () => {
    // A delivery at ฿200: one comes with the scooter, the second is paid.
    expect(week(fixed("200"), 2, 1).listPrice).toBe(thb("200"));
    expect(week(fixed("200"), 1, 1).listPrice).toBe(0n);
    expect(week(fixed("200"), 3, 0).listPrice).toBe(thb("600"));
  });

  it("a free service costs nothing, included or not, and is still priced", () => {
    for (const [taken, included] of [
      [1, 0],
      [1, 1],
      [5, 2],
    ]) {
      const q = run({
        lines: [
          scooter(),
          extra("drop-off", { method: "free" }, taken, included),
        ],
      });
      expect(q.lines[1]).toMatchObject({
        listPrice: 0n,
        amount: 0n,
        unit: { amount: 0n, basis: { kind: "free" } },
        chargedQuantity: Math.max(0, taken - included),
      });
      expect(q.totals.total).toBe(thb("1400"));
    }
  });

  it("an extra with no price yet can't be priced: never zero, even when all of it is included", () => {
    const result = quote(
      input({ lines: [scooter(), extra("helmet", null, 2, 2)] }),
    );
    expect(result).toEqual({
      ok: false,
      unpriced: [{ lineId: "helmet", reason: "no_price" }],
    });
  });

  it("in a currency with no decimals", () => {
    const dong = (amount: string) => minor(amount, 0);
    const q = run({
      lines: [
        scooter({ pricing: perDay(dong("150000")) }),
        extra("helmet", perDay(dong("20000")), 3, 1),
      ],
    });
    expect(q.lines[1].listPrice).toBe(dong("280000"));
    expect(q.totals.total).toBe(dong("1330000"));
  });
});

describe("included units are not a discount", () => {
  const q = run({
    lines: [scooter(), extra("helmet", HELMET, 3, 2)],
    deposit: { shop: { mode: "per_product", amount: thb("1000") } },
  });

  it("they are in no discount total", () => {
    expect(q.lines[1].discounts).toEqual([]);
    expect(q.lines[1].discount).toBe(0n);
    expect(q.totals.discount).toBe(0n);
    expect(q.totals.listPrice).toBe(thb("1750"));
  });

  it("VAT is on what is charged, and nothing more comes off the base", () => {
    // 1,750 × 7 ÷ 107 = 114.485…
    expect(q.taxGroups).toEqual([
      {
        rateBp: 700,
        base: thb("1750"),
        net: thb("1635.51"),
        vat: thb("114.49"),
        gross: thb("1750"),
      },
    ]);
  });

  it("an extra carries no deposit, even with one typed on it", () => {
    const withDeposit = run({
      lines: [
        scooter(),
        extra("helmet", HELMET, 3, 2, { deposit: thb("500") }),
      ],
      deposit: { shop: { mode: "per_product", amount: thb("1000") } },
    });
    expect(q.deposit.amount).toBe(thb("1000"));
    expect(withDeposit.deposit.amount).toBe(thb("1000"));
  });
});

describe("from the list price on, an extra is a line like any other", () => {
  const inSeason = {
    span: {
      start: bkk("2027-03-28"),
      end: bkk("2027-04-04"),
      timeZone: BANGKOK,
    },
  };

  it("a season covers its charged units only: 3 of 7 days at 20% off one helmet", () => {
    const q = run({
      lines: [
        scooter(inSeason),
        extra("helmet", HELMET, 3, 2, inSeason),
        extra("delivery", fixed("200"), 1, 0, inSeason),
      ],
      seasonRules: [LOW_SEASON],
    });
    // ฿350 × 20% × 3 ÷ 7 = ฿30.
    expect(q.lines[1]).toMatchObject({
      listPrice: thb("350"),
      seasonPrice: thb("320"),
    });
    // A fixed price takes no season.
    expect(q.lines[2].seasonPrice).toBe(thb("200"));
  });

  it("a season on a line whose units are all included adjusts nothing", () => {
    const q = run({
      lines: [scooter(inSeason), extra("helmet", HELMET, 2, 2, inSeason)],
      seasonRules: [LOW_SEASON],
    });
    expect(q.lines[1]).toMatchObject({ listPrice: 0n, seasonPrice: 0n });
    expect(q.lines[1].seasons.every((s) => s.amount === 0n)).toBe(true);
  });

  it("a percentage discount is taken on what is charged", () => {
    const q = run({
      lines: [scooter(), extra("helmet", HELMET, 3, 2)],
      discounts: [{ id: "d", source: "staff", lines: "all", percentBp: 1000 }],
    });
    expect(q.lines.map((l) => l.discount)).toEqual([thb("140"), thb("35")]);
  });

  it("a fixed discount is shared by what each line comes to, so an included line gets none", () => {
    const q = run({
      lines: [
        scooter(),
        extra("helmet", HELMET, 2, 2),
        extra("lock", perDay(thb("20")), 1, 0),
      ],
      discounts: [
        { id: "d", source: "staff", lines: "all", amount: thb("154") },
      ],
    });
    // ฿154 over ฿1,400 and ฿140.
    expect(q.lines.map((l) => l.discount)).toEqual([thb("140"), 0n, thb("14")]);
    expect(q.lines.map((l) => l.amount)).toEqual([thb("1260"), 0n, thb("126")]);
  });

  it("it has its own tax rate", () => {
    const q = run({
      lines: [
        scooter(),
        extra("helmet", HELMET, 3, 2, { taxRateBp: null }),
        extra("cover", fixed("1000"), 1, 0, { taxRateBp: 1000 }),
      ],
    });
    expect(q.taxGroups.map((g) => [g.rateBp, g.base])).toEqual([
      [700, thb("1400")],
      [1000, thb("1000")],
    ]);
    expect(q.nonTaxable).toBe(thb("350"));
  });

  it("its dates are its own when they differ from the vehicle's", () => {
    // Helmets for the first 3 of the 7 days.
    const q = run({
      lines: [scooter(), extra("helmet", HELMET, 3, 2, { days: 3 })],
    });
    expect(q.lines[1].listPrice).toBe(thb("150"));
  });
});

describe("a line with no parent is priced exactly as before", () => {
  it("reports nothing included and every unit charged", () => {
    for (const each of pinnedQuotes().filter((p) => p.from !== "Phase 2")) {
      const q = quote(each.input);
      if (!q.ok) throw new Error(each.name);
      for (const [index, priced] of q.lines.entries()) {
        expect(priced.parentLineId).toBeNull();
        expect(priced.includedQuantity).toBe(0);
        expect(priced.chargedQuantity).toBe(each.input.lines[index].quantity);
        expect(priced.listPrice).toBe(
          priced.unit.amount * BigInt(priced.quantity),
        );
      }
    }
  });

  it("every D2 and D3 pinned figure is the same", () => {
    // The two older test files pass unchanged; this is the same list of
    // figures, checked here beside the step that could have moved them.
    const all = pinnedQuotes().filter((p) => p.from !== "Phase 2");
    expect(all.filter((p) => p.from === "D2").length).toBeGreaterThanOrEqual(
      30,
    );
    expect(all.filter((p) => p.from === "D3").length).toBeGreaterThanOrEqual(8);
    for (const each of all) {
      const q = quote(each.input);
      if (!q.ok) throw new Error(each.name);
      const { pinned } = each;
      const got = {
        total: q.totals.total,
        vat: q.totals.vat,
        net: q.totals.net,
        discount: q.totals.discount,
        credit: q.totals.credit,
        nonTaxable: q.nonTaxable,
        deposit: q.deposit.amount,
        amounts: q.lines.map((l) => l.amount),
      };
      for (const key of Object.keys(pinned) as Array<keyof typeof pinned>) {
        expect(got[key], `${each.name}: ${key}`).toEqual(pinned[key]);
      }
    }
  });

  it("an empty parent is the same as none", () => {
    const plain = run({
      lines: [scooter(), line("helmet", HELMET, { days: 7 })],
    });
    const empty = run({
      lines: [scooter(), line("helmet", HELMET, { days: 7, extraOf: null })],
    });
    expect(empty).toEqual(plain);
  });

  it("gear taken on its own, with no vehicle, is charged in full", () => {
    const q = run({
      lines: [line("helmet", HELMET, { days: 7, quantity: 3, vehicle: false })],
    });
    expect(quantities(q, "helmet")).toEqual({
      quantity: 3,
      included: 0,
      charged: 3,
      listPrice: thb("1050"),
    });
  });
});

describe("what step 4 refuses", () => {
  const refused = (lines: QuoteLineInput[]) => {
    let error: unknown;
    try {
      quote(input({ lines }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(QuoteError);
    expect((error as QuoteError).code).toBe("bad_input");
  };

  it("a parent that is not on the invoice, or is the line itself", () => {
    refused([
      scooter(),
      extra("helmet", HELMET, 1, 1, {
        extraOf: { lineId: "nope", includedQuantity: 1 },
      }),
    ]);
    refused([
      scooter(),
      extra("helmet", HELMET, 1, 1, {
        extraOf: { lineId: "helmet", includedQuantity: 1 },
      }),
    ]);
  });

  it("a parent that is not a vehicle, or is itself an extra", () => {
    refused([
      scooter(),
      extra("helmet", HELMET, 1, 1),
      extra("visor", HELMET, 1, 1, {
        extraOf: { lineId: "helmet", includedQuantity: 1 },
      }),
    ]);
    refused([
      line("box", fixed("300"), { vehicle: false }),
      extra("helmet", HELMET, 1, 1, {
        extraOf: { lineId: "box", includedQuantity: 1 },
      }),
    ]);
  });

  it("a vehicle as an extra", () => {
    refused([scooter(), extra("second", bike300(), 1, 1, { vehicle: true })]);
  });

  it("an included quantity that is negative or not whole", () => {
    refused([scooter(), extra("helmet", HELMET, 1, -1)]);
    refused([scooter(), extra("helmet", HELMET, 1, 0.5)]);
  });

  it("two lines of the same extra on one vehicle, which would both take the free units", () => {
    refused([
      scooter(),
      extra("h1", HELMET, 2, 2, { productId: "helmet" }),
      extra("h2", HELMET, 2, 2, { productId: "helmet" }),
    ]);
  });

  it("a wrong parent is bad input even when another line has no price yet", () => {
    // "Can't be priced" must not hide it (review of PR 40, item 5).
    const wrongParent = extra("helmet", HELMET, 1, 1, {
      extraOf: { lineId: "nope", includedQuantity: 1 },
    });
    refused([scooter(), wrongParent, line("unpriced", null)]);
    refused([line("scooter", null, { days: 7 }), wrongParent]);
    // The extra itself has no price, and its parent is wrong.
    refused([scooter(), { ...wrongParent, pricing: null }]);
    // Twins are refused too, priced or not.
    refused([
      scooter(),
      extra("h1", null, 2, 2, { productId: "helmet" }),
      extra("h2", HELMET, 2, 2, { productId: "helmet" }),
    ]);
    // With the parents right, the answer is still "can't be priced".
    expect(
      quote(
        input({
          lines: [
            scooter(),
            extra("helmet", HELMET, 1, 1),
            line("unpriced", null),
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      unpriced: [{ lineId: "unpriced", reason: "no_price" }],
    });
  });

  it("and says so before pricing anything", () => {
    expect(() =>
      includedQuantities(extra("helmet", HELMET, 1, 1), [
        extra("helmet", HELMET, 1, 1),
      ]),
    ).toThrow(/isn't here/);
    expect(includedQuantities(scooter(), [scooter()])).toEqual({
      parentLineId: null,
      included: 0,
      charged: 1,
    });
  });
});

// Not about extras, but kept here so quote.test.ts stays as stage D2 left it
// (second review of PR 40).
describe("a discount names each of its lines once", () => {
  const two = () => [
    line("bike", bike300(), { days: 7 }),
    line("box", fixed("300"), { vehicle: false }),
  ];
  const refusedWith = (lines: QuoteLineInput[], discount: Discount) => {
    let error: unknown;
    try {
      quote(input({ lines, discounts: [discount] }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(QuoteError);
    expect((error as QuoteError).code).toBe("bad_input");
    expect((error as QuoteError).message).toMatch(/more than once/);
  };

  it("10% on [bike, bike] is refused: it would take 20%", () => {
    refusedWith(two(), {
      id: "d",
      source: "staff",
      lines: ["bike", "bike"],
      percentBp: 1000,
    });
  });

  it("a fixed amount on a line named twice is refused: it could take more than the line comes to", () => {
    refusedWith(two(), {
      id: "d",
      source: "staff",
      lines: ["box", "box"],
      amount: thb("500"),
    });
  });

  it("a repeat anywhere in the list is refused, priced or not, coupon or not", () => {
    refusedWith(two(), {
      id: "d",
      source: "returning_customer",
      lines: ["bike", "box", "bike"],
      percentBp: 1000,
    });
    // Before "can't be priced" is answered, like every other bad input.
    refusedWith([...two(), line("unpriced", null)], {
      id: "d",
      source: "staff",
      lines: ["box", "box"],
      percentBp: 1000,
    });
  });

  it("each line named once, in any order, is priced as before", () => {
    const once = quote(
      input({
        lines: two(),
        discounts: [
          { id: "d", source: "staff", lines: ["box", "bike"], percentBp: 1000 },
        ],
      }),
    );
    if (!once.ok) throw new Error("expected a priced quote");
    // 1,400 and 300, 10% off each.
    expect(once.lines.map((l) => l.discount)).toEqual([thb("140"), thb("30")]);
    expect(once.totals.discount).toBe(thb("170"));
    const all = quote(
      input({
        lines: two(),
        discounts: [
          { id: "d", source: "staff", lines: "all", percentBp: 1000 },
        ],
      }),
    );
    if (!all.ok) throw new Error("expected a priced quote");
    expect(all.totals).toEqual(once.totals);
  });
});
