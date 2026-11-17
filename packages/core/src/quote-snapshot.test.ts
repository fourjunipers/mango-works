import { describe, expect, it } from "vitest";
import {
  lineTaxShares,
  quote,
  QuoteError,
  vatFor,
  type Quote,
  type QuoteInput,
  type QuoteLineInput,
} from "./quote";
import {
  bike300,
  bikeA,
  bikeB,
  bkk,
  contextFor,
  continuationLine,
  firstBooking,
  fixed,
  input,
  line,
  LOW_SEASON,
  minor,
  perDay,
  pinnedQuotes,
  thb,
  VAT_7,
  BANGKOK,
  type Pinned,
} from "./quote-pinned.fixtures";
import {
  readSnapshot,
  readSnapshotLine,
  SNAPSHOT_VERSION,
  SnapshotError,
  snapshotQuote,
  upgradeSnapshot,
  upgradeSnapshotLine,
  type Json,
  type QuoteSnapshot,
  type SnapshotContext,
  type StoredSnapshot,
} from "./quote-snapshot";
import {
  earlyReturn,
  settleSwap,
  swapAmounts,
  type OpenPeriod,
} from "./rental-period";

// The quote snapshot (docs/phase-2-plan.md §5.4).

type Priced = Extract<Quote, { ok: true }>;

function priced(quoteInput: QuoteInput): Priced {
  const result = quote(quoteInput);
  if (!result.ok) throw new Error("expected a priced quote");
  return result;
}

/** Priced, snapshotted, turned to JSON text, parsed and read back. */
function roundTrip(quoteInput: QuoteInput, context: SnapshotContext) {
  // snapshotQuote() prices the input itself; `q` is the same input priced
  // here, to compare what was stored with.
  const q = priced(quoteInput);
  const stored = snapshotQuote(quoteInput, context);
  const json = JSON.stringify(stored);
  return { q, stored, json, read: readSnapshot(JSON.parse(json)) };
}

const sum = (amounts: readonly bigint[]) => amounts.reduce((a, b) => a + b, 0n);

/** Every amount of the quote, beside the same amount read back. */
function expectSameToTheMinorUnit(read: QuoteSnapshot, q: Priced) {
  expect(read.totals).toEqual(q.totals);
  expect(read.nonTaxable).toBe(q.nonTaxable);
  expect(read.deposit.amount).toBe(q.deposit.amount);
  expect(read.deposit.from).toBe(q.deposit.from);
  expect(
    read.taxGroups.map(({ rateBp, base, net, vat, gross }) => ({
      rateBp,
      base,
      net,
      vat,
      gross,
    })),
  ).toEqual(q.taxGroups);
  expect(read.lines).toHaveLength(q.lines.length);
  for (const [index, line] of q.lines.entries()) {
    const back = read.lines[index];
    expect({
      id: back.id,
      productId: back.productId,
      quantity: back.quantity,
      parentLineId: back.parentLineId,
      includedQuantity: back.includedQuantity,
      chargedQuantity: back.chargedQuantity,
      unit: back.unitPrice,
      listPrice: back.listPrice,
      seasons: back.seasons.map(({ ruleId, periodsInside, amount }) => ({
        ruleId,
        periodsInside,
        amount,
      })),
      seasonPrice: back.seasonPrice,
      discounts: back.discounts.map(({ discountId, amount }) => ({
        discountId,
        amount,
      })),
      discount: back.discountTotal,
      amount: back.amount,
      taxRateBp: back.taxRateBp,
    }).toEqual(line);
  }
}

describe("every pinned figure, snapshotted, turned to JSON and read back", () => {
  const all = pinnedQuotes();

  it("covers a first booking, an extension, a swap with a credit, a cheaper bike, and Phase 2's own", () => {
    const names = all.map((p) => `${p.from}: ${p.name}`).join("\n");
    expect(all.filter((p) => p.from === "D2").length).toBe(31);
    expect(all.filter((p) => p.from === "D3").length).toBe(8);
    expect(all.filter((p) => p.from === "Phase 2").length).toBe(4);
    for (const part of [
      "prices include VAT",
      "an extension",
      "a swap with a credit",
      "a cheaper bike",
      "helmets included",
      "a dong shop",
      "New York",
    ]) {
      expect(names).toContain(part);
    }
  });

  it.each(all.map((p) => [`${p.from}: ${p.name}`, p] as const))(
    "%s",
    (_name, each: Pinned) => {
      const { q, stored, json, read } = roundTrip(each.input, each.context);

      // The figures the older tests pin, on the copy that was read back.
      const got = {
        total: read.totals.total,
        vat: read.totals.vat,
        net: read.totals.net,
        discount: read.totals.discount,
        credit: read.totals.credit,
        nonTaxable: read.nonTaxable,
        deposit: read.deposit.amount,
        amounts: read.lines.map((l) => l.amount),
      };
      for (const key of Object.keys(each.pinned) as Array<keyof typeof got>) {
        expect(got[key], key).toEqual(each.pinned[key]);
      }

      // And every other amount, against the quote itself.
      expectSameToTheMinorUnit(read, q);

      // The stored form is plain JSON: text and back changes nothing.
      expect(JSON.parse(json)).toEqual(stored);
      expect(snapshotQuote(each.input, each.context)).toEqual(stored);
      // Reading twice gives equal, separate copies.
      expect(readSnapshot(JSON.parse(json))).toEqual(read);
    },
  );
});

describe("the stored form", () => {
  const first = pinnedQuotes()[0];
  const { stored } = roundTrip(first.input, first.context);

  it("holds every amount as a string of digits, never a number", () => {
    const numbers: Array<[string, number]> = [];
    const amounts: string[] = [];
    const walk = (value: Json, path: string) => {
      if (typeof value === "number") numbers.push([path, value]);
      else if (Array.isArray(value))
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (value && typeof value === "object") {
        for (const [key, v] of Object.entries(value)) walk(v, `${path}.${key}`);
      } else if (typeof value === "string" && /^-?\d+$/.test(value)) {
        amounts.push(path);
      }
    };
    for (const each of pinnedQuotes()) {
      numbers.length = 0;
      walk(roundTrip(each.input, each.context).stored, "");
      // The only numbers are counts, rates in basis points and the version.
      for (const [path, value] of numbers) {
        expect(Number.isSafeInteger(value), path).toBe(true);
        expect(path).toMatch(
          /(version|exponent|quantity|included_per_vehicle|_bp|count|days|months|hours|periods|periods_inside)$/,
        );
      }
    }
    expect(amounts.length).toBeGreaterThan(40);
    expect(stored.totals).toEqual({
      list_price: "300000",
      seasons: "0",
      discount: "0",
      credit: "0",
      net: "280374",
      vat: "19626",
      total: "300000",
    });
  });

  it("writes a negative season amount with a leading minus and nothing else signed", () => {
    const season = pinnedQuotes().find((p) =>
      p.name.startsWith("3 of 7 days"),
    )!;
    const { stored: s } = roundTrip(season.input, season.context);
    const lines = s.lines as Array<{ [key: string]: Json }>;
    expect(lines[0].season_total).toBe("-12000");
    expect(lines[0].seasons).toEqual([
      {
        rule_id: "low",
        name: "Season low",
        adjust_bp: -2000,
        periods_inside: 3,
        periods: 7,
        amount: "-12000",
      },
    ]);
    expect((s.totals as { seasons: string }).seasons).toBe("-12000");
  });

  it("has every field of the plan's §5.4 on a line", () => {
    const extras = pinnedQuotes().find((p) =>
      p.name.includes("helmets included"),
    )!;
    const { stored: s } = roundTrip(extras.input, extras.context);
    const helmet = (s.lines as Array<{ [key: string]: Json }>)[1];
    expect(helmet).toEqual({
      version: 1,
      id: "helmet",
      currency: "THB",
      exponent: 2,
      product_id: "helmet",
      product_name: "Product helmet",
      product_type: "gear",
      parent_line_id: "scooter",
      start: "2027-11-01T03:00:00.000Z",
      end: "2027-11-08T03:00:00.000Z",
      rental_start: null,
      time_zone: "Asia/Bangkok",
      periods: { unit: "day", count: 7 },
      quantity: 3,
      included_quantity: 2,
      charged_quantity: 1,
      included_per_vehicle: 2,
      unit_price: {
        amount: "35000",
        basis: { kind: "periods", period: "day", count: 7 },
      },
      list_price: "35000",
      pricing: { method: "per_period", amount: "5000", period: "day" },
      seasons: [],
      season_total: "0",
      season_price: "35000",
      discounts: [],
      discount_total: "0",
      amount: "35000",
      taxable: true,
      tax_rate_bp: 700,
      tax_profile_id: "tax-700",
      tax_profile_name: "VAT 700",
      tax_inclusive: true,
      // 1,750 × 7 ÷ 107 = ฿114.49, shared 1,400 : 350.
      tax_amount: "2290",
      deposit: null,
    });
    expect(Object.keys(s).sort()).toEqual(
      [
        "version",
        "currency",
        "exponent",
        "priced_at",
        "tax_inclusive",
        "lines",
        "tax_groups",
        "non_taxable",
        "credits",
        "discounts",
        "totals",
        "deposit",
      ].sort(),
    );
    expect(s.version).toBe(SNAPSHOT_VERSION);
    expect(s.priced_at).toBe("2027-10-20T03:15:00.000Z");
  });

  it("keeps the prices a line was worked out from: the list's 30 totals and the long-stay rate", () => {
    const line0 = (stored.lines as Array<{ [key: string]: Json }>)[0];
    const pricing = line0.pricing as {
      method: string;
      list: { days: string[]; hourly: string | null };
      long_stay_day: string;
    };
    expect(pricing.method).toBe("tiered");
    expect(pricing.list.days).toHaveLength(30);
    expect(pricing.list.days[0]).toBe("30000");
    expect(pricing.list.days[6]).toBe("140000");
    expect(pricing.list.days[29]).toBe("300000");
    expect(pricing.list.hourly).toBeNull();
    expect(pricing.long_stay_day).toBe("10000");
    expect(line0.unit_price).toEqual({
      amount: "300000",
      basis: { kind: "list", days: 30 },
    });
  });

  it("keeps a continuation's original pickup and both prices it is the difference of", () => {
    const swap = pinnedQuotes().find((p) =>
      p.name.startsWith("a swap with a credit"),
    )!;
    const { read, stored: s } = roundTrip(swap.input, swap.context);
    expect(read.lines[0].rentalStart).toEqual(bkk("2027-01-01"));
    expect(read.lines[0].start).toEqual(bkk("2027-01-15"));
    expect(read.lines[0].periods).toEqual({ unit: "day", count: 17 });
    expect(read.lines[0].unitPrice).toEqual({
      amount: thb("1800"),
      basis: {
        kind: "continuation",
        rentalStart: bkk("2027-01-01"),
        whole: {
          amount: thb("3500"),
          basis: {
            kind: "months",
            days: 31,
            months: 1,
            monthly: thb("3500"),
            leftoverDays: 0,
            longStayDay: thb("116.66"),
            longStayFromMonthly: false,
            leftoverCapped: false,
            underOneMonth: false,
          },
        },
        soFar: { amount: thb("1700"), basis: { kind: "list", days: 14 } },
      },
    });
    expect(s.credits).toEqual([
      { id: "from-a", amount: "150000", tax_rate_bp: 700 },
    ]);
  });

  it("names each discount: its source, kind and value, the coupon's id and code, and what it took from the line", () => {
    const quoteInput = input({
      couponsEnabled: true,
      lines: [
        line("bike", bike300(), { days: 7 }),
        line("box", fixed("300"), { vehicle: false }),
      ],
      discounts: [
        {
          id: "back",
          source: "returning_customer",
          lines: ["bike"],
          percentBp: 1000,
        },
        { id: "SAVE200", source: "coupon", lines: "all", amount: thb("200") },
      ],
    });
    const { read } = roundTrip(
      quoteInput,
      contextFor(quoteInput, {
        coupons: { SAVE200: { couponId: "c-77", code: "SAVE200" } },
      }),
    );
    // 1,400 − 140 = 1,260; ฿200 over 1,260 and 300: 161.54 and 38.46.
    expect(read.lines[0].discounts).toEqual([
      {
        discountId: "back",
        source: "returning_customer",
        couponId: null,
        couponCode: null,
        kind: "percent",
        percentBp: 1000,
        fixedAmount: null,
        amount: thb("140"),
      },
      {
        discountId: "SAVE200",
        source: "coupon",
        couponId: "c-77",
        couponCode: "SAVE200",
        kind: "fixed",
        percentBp: null,
        fixedAmount: thb("200"),
        amount: thb("161.54"),
      },
    ]);
    expect(read.lines[1].discounts.map((d) => d.amount)).toEqual([
      thb("38.46"),
    ]);
    expect(read.lines[0].discountTotal).toBe(thb("301.54"));
  });

  it("records the deposit with its mode, its number, where it came from, and each vehicle's own", () => {
    const find = (name: string) => {
      const each = pinnedQuotes().find((p) => p.name === name)!;
      return roundTrip(each.input, each.context).read;
    };
    const perVehicle = find(
      "deposit: per vehicle, with the shop's amount for a bike with none",
    );
    expect(perVehicle.deposit).toEqual({
      amount: thb("10500"),
      mode: "per_product",
      percentBp: null,
      fixedAmount: thb("1500"),
      from: "shop",
    });
    // 2 × 2,000; 5,000; the shop's 1,500; and nothing for the helmet.
    expect(perVehicle.lines.map((l) => l.deposit)).toEqual([
      thb("4000"),
      thb("5000"),
      thb("1500"),
      null,
    ]);

    const percent = find("deposit: 30% of the order");
    expect(percent.deposit).toEqual({
      amount: thb("3780"),
      mode: "percent_of_order",
      percentBp: 3000,
      fixedAmount: null,
      from: "shop",
    });
    expect(percent.lines.every((l) => l.deposit === null)).toBe(true);

    expect(find("deposit: waived for the customer").deposit).toEqual({
      amount: 0n,
      mode: "none",
      percentBp: null,
      fixedAmount: null,
      from: "customer",
    });
    expect(find("deposit: set on the order").deposit).toEqual({
      amount: thb("1000"),
      mode: "fixed_per_order",
      percentBp: null,
      fixedAmount: thb("1000"),
      from: "order",
    });
  });

  it("names each rate group's profiles and the shop's style", () => {
    const quoteInput = input({
      taxInclusive: false,
      lines: [
        line("a", fixed("100")),
        line("b", fixed("100")),
        line("c", fixed("100"), { taxRateBp: 1000 }),
      ],
    });
    const context = contextFor(quoteInput);
    const { read } = roundTrip(quoteInput, {
      ...context,
      lines: {
        ...context.lines,
        b: {
          ...context.lines.b,
          taxProfile: { id: "p2", name: "VAT (services)" },
        },
      },
    });
    expect(
      read.taxGroups.map((g) => [g.rateBp, g.profileNames, g.taxInclusive]),
    ).toEqual([
      [700, ["VAT 700", "VAT (services)"], false],
      [1000, ["VAT 1000"], false],
    ]);
    expect(read.lines.map((l) => l.taxInclusive)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("each line's tax share", () => {
  it("three lines of ฿350: VAT ฿68.69 is shared 22.90, 22.90, 22.89", () => {
    const three = pinnedQuotes().find((p) => p.name.startsWith("three lines"))!;
    const { read } = roundTrip(three.input, three.context);
    expect(read.lines.map((l) => l.taxAmount)).toEqual([
      thb("22.90"),
      thb("22.90"),
      thb("22.89"),
    ]);
    // Line by line it would have been 3 × ฿22.90 = ฿68.70: one satang too many.
    expect(vatFor(thb("350"), 700, true).vat * 3n).toBe(thb("68.70"));
  });

  it("is in proportion to what each line comes to, per rate group, and nothing for an untaxed line", () => {
    const mixed = pinnedQuotes().find((p) =>
      p.name.startsWith("one VAT line per rate"),
    )!;
    const { read } = roundTrip(mixed.input, mixed.context);
    // 7% group: ฿203.26 over 3,000 and 107 → 196.26 and 7.00. 10%: 90.91.
    expect(read.lines.map((l) => [l.id, l.taxable, l.taxAmount])).toEqual([
      ["bike", true, thb("196.26")],
      ["cover", true, thb("90.91")],
      ["permit", false, 0n],
      ["helmet", true, thb("7")],
    ]);
  });

  it("follows the VAT actually charged when a credit has reduced the base", () => {
    const swap = pinnedQuotes().find((p) =>
      p.name.startsWith("a swap credit: VAT"),
    )!;
    const { read } = roundTrip(swap.input, swap.context);
    expect(read.lines[0].taxAmount).toBe(thb("19.63"));
  });

  it("adds up to the invoice's VAT lines in every pinned case", () => {
    for (const each of pinnedQuotes()) {
      const { read } = roundTrip(each.input, each.context);
      for (const group of read.taxGroups) {
        const members = read.lines.filter((l) => l.taxRateBp === group.rateBp);
        expect(sum(members.map((l) => l.taxAmount)), each.name).toBe(group.vat);
      }
      expect(sum(read.lines.map((l) => l.taxAmount)), each.name).toBe(
        read.totals.vat,
      );
      for (const l of read.lines) {
        expect(l.taxAmount >= 0n).toBe(true);
        if (!l.taxable) expect(l.taxAmount).toBe(0n);
      }
    }
  });

  it("in a currency with no decimals: whole dong, adding up exactly", () => {
    const vnd = (amount: string) => minor(amount, 0);
    const all = pinnedQuotes();
    const onTop = roundTrip(
      ...(() => {
        const each = all.find((p) =>
          p.name.startsWith("a dong shop with 10%"),
        )!;
        return [each.input, each.context] as const;
      })(),
    ).read;
    // 10,001 over 33,333, 33,333 and 33,339: 3,333.47, 3,333.47, 3,334.07 →
    // 3,333 each and 3,334, and the one dong left to the largest remainder.
    expect(onTop.lines.map((l) => l.taxAmount)).toEqual([
      vnd("3334"),
      vnd("3333"),
      vnd("3334"),
    ]);
    expect(sum(onTop.lines.map((l) => l.taxAmount))).toBe(vnd("10001"));

    const coupon = roundTrip(
      ...(() => {
        const each = all.find((p) => p.name.startsWith("a dong shop: three"))!;
        return [each.input, each.context] as const;
      })(),
    ).read;
    expect(coupon.currency).toBe("VND");
    expect(coupon.exponent).toBe(0);
    expect(
      coupon.lines.every((l) => l.currency === "VND" && l.exponent === 0),
    ).toBe(true);
    // The ฿-free coupon: 100,000 over 495,000, 120,000 and 70,000.
    expect(coupon.lines.map((l) => l.discountTotal)).toEqual([
      vnd("72263"),
      vnd("17518"),
      vnd("10219"),
    ]);
    expect(sum(coupon.lines.map((l) => l.taxAmount))).toBe(vnd("43333"));
    expect(coupon.lines.map((l) => l.taxAmount)).toEqual([
      vnd("31314"),
      vnd("7591"),
      vnd("4428"),
    ]);
  });

  it("adds up for 1,500 made-up invoices, in two- and zero-decimal amounts, both tax styles, with discounts and credits", () => {
    // A fixed sequence, so a failure can be found again.
    let seed = 20261116;
    const next = (below: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % below;
    };
    const rates = [null, 0, 700, 800, 1000, 2000];
    let invoices = 0;
    let leftovers = 0;
    for (let round = 0; round < 1500; round++) {
      const exponent = round % 2 === 0 ? 2 : 0;
      const count = 1 + next(6);
      const lines: QuoteLineInput[] = Array.from({ length: count }, (_, i) =>
        line(
          `l${i}`,
          {
            method: "fixed",
            amount: BigInt(1 + next(exponent === 2 ? 500000 : 90000)),
          },
          {
            quantity: 1 + next(3),
            taxRateBp: rates[next(rates.length)],
            vehicle: false,
          },
        ),
      );
      const quoteInput = input({
        taxInclusive: next(2) === 0,
        lines,
        discounts: [
          ...(next(2) === 0
            ? [
                {
                  id: "pc",
                  source: "staff" as const,
                  lines: "all" as const,
                  percentBp: 1 + next(9000),
                },
              ]
            : []),
          ...(next(2) === 0
            ? [
                {
                  id: "fx",
                  source: "staff" as const,
                  lines: "all" as const,
                  amount: BigInt(1 + next(70000)),
                },
              ]
            : []),
        ],
      });
      // A credit against the first taxed line's group, never more than its base.
      const before = priced(quoteInput);
      const group = before.taxGroups.find((g) => g.base > 1n);
      const withCredit: QuoteInput =
        group && next(3) === 0
          ? {
              ...quoteInput,
              credits: [
                { id: "cr", amount: group.base / 2n, taxRateBp: group.rateBp },
              ],
            }
          : quoteInput;
      const { read, q } = roundTrip(
        withCredit,
        contextFor(
          withCredit,
          exponent === 0 ? { currency: "JPY", exponent: 0 } : {},
        ),
      );
      invoices += 1;
      for (const g of read.taxGroups) {
        const members = read.lines.filter((l) => l.taxRateBp === g.rateBp);
        expect(sum(members.map((l) => l.taxAmount))).toBe(g.vat);
        const weights = sum(members.map((l) => l.amount));
        if (weights > 0n && (g.vat * members[0].amount) % weights !== 0n)
          leftovers += 1;
        // No share is more than a minor unit away from its exact proportion.
        for (const l of members) {
          if (weights === 0n) continue;
          const floor = (g.vat * l.amount) / weights;
          expect(l.taxAmount === floor || l.taxAmount === floor + 1n).toBe(
            true,
          );
        }
      }
      expect(sum(read.lines.map((l) => l.taxAmount))).toBe(q.totals.vat);
    }
    expect(invoices).toBe(1500);
    // The leftover rule was really needed, not only in a rare round.
    expect(leftovers).toBeGreaterThan(250);
  }, 30_000);

  it("lineTaxShares gives nothing where there is nothing to share", () => {
    expect(lineTaxShares([], [])).toEqual([]);
    const free = priced(
      input({
        lines: [line("a", { method: "free" }), line("b", { method: "free" })],
      }),
    );
    expect(lineTaxShares(free.lines, free.taxGroups)).toEqual([0n, 0n]);
  });
});

describe("Phase 3's columns, and its check by addition alone", () => {
  // docs/phase-2-plan.md §5.4, "Phase 3's columns, fixed now".
  const COLUMNS = [
    "list_price",
    "season_total",
    "discount_total",
    "amount",
    "tax_rate_bp",
    "tax_profile_id",
    "tax_profile_name",
    "tax_inclusive",
    "tax_amount",
    "deposit",
    "currency",
  ];

  it("every order-line column is a field of the stored line, under that name", () => {
    for (const each of pinnedQuotes()) {
      const { stored } = roundTrip(each.input, each.context);
      for (const stored_line of stored.lines as Array<{
        [key: string]: Json;
      }>) {
        for (const column of COLUMNS) {
          expect(Object.hasOwn(stored_line, column), column).toBe(true);
        }
      }
    }
  });

  it("the lines add up to the totals with no multiplying, dividing or rounding", () => {
    for (const each of pinnedQuotes()) {
      const { read } = roundTrip(each.input, each.context);
      const name = each.name;
      for (const l of read.lines) {
        expect(l.listPrice + l.seasonTotal, name).toBe(l.seasonPrice);
        expect(l.seasonPrice - l.discountTotal, name).toBe(l.amount);
        expect(sum(l.discounts.map((d) => d.amount)), name).toBe(
          l.discountTotal,
        );
        expect(l.includedQuantity + l.chargedQuantity, name).toBe(l.quantity);
      }
      const { totals } = read;
      expect(sum(read.lines.map((l) => l.listPrice)), name).toBe(
        totals.listPrice,
      );
      expect(sum(read.lines.map((l) => l.seasonTotal)), name).toBe(
        totals.seasons,
      );
      expect(sum(read.lines.map((l) => l.discountTotal)), name).toBe(
        totals.discount,
      );
      expect(sum(read.credits.map((c) => c.amount)), name).toBe(totals.credit);
      expect(sum(read.lines.map((l) => l.taxAmount)), name).toBe(totals.vat);
      // Each rate group: its lines, less the credits set against it.
      for (const g of read.taxGroups) {
        const lines = sum(
          read.lines
            .filter((l) => l.taxRateBp === g.rateBp)
            .map((l) => l.amount),
        );
        const credits = sum(
          read.credits
            .filter((c) => c.taxRateBp === g.rateBp)
            .map((c) => c.amount),
        );
        expect(lines - credits, name).toBe(g.base);
        expect(g.net + g.vat, name).toBe(g.gross);
      }
      const untaxed =
        sum(read.lines.filter((l) => !l.taxable).map((l) => l.amount)) -
        sum(
          read.credits.filter((c) => c.taxRateBp === null).map((c) => c.amount),
        );
      expect(untaxed, name).toBe(read.nonTaxable);
      expect(
        sum(read.taxGroups.map((g) => g.gross)) + read.nonTaxable,
        name,
      ).toBe(totals.total);
      expect(totals.net + totals.vat, name).toBe(totals.total);
      if (read.deposit.mode === "per_product") {
        expect(sum(read.lines.map((l) => l.deposit ?? 0n)), name).toBe(
          read.deposit.amount,
        );
      }
    }
  });
});

describe("a snapshot does not change when the shop's settings do", () => {
  // A booking with everything a shop can later change: a tax profile, a
  // price list, a season and a coupon.
  const build = () => {
    const pricing = bike300();
    const season = { ...LOW_SEASON };
    const quoteInput = input({
      couponsEnabled: true,
      lines: [
        line("bike", pricing, {
          span: {
            start: bkk("2027-03-28"),
            end: bkk("2027-04-04"),
            timeZone: BANGKOK,
          },
        }),
      ],
      seasonRules: [season],
      discounts: [
        { id: "SONGKRAN", source: "coupon", lines: "all", percentBp: 1000 },
      ],
    });
    const context: SnapshotContext = {
      currency: "THB",
      exponent: 2,
      pricedAt: new Date("2027-03-01T02:00:00.000Z"),
      lines: {
        bike: {
          productName: "Honda Click 125",
          productType: "vehicle",
          taxProfile: { id: "vat-profile", name: "VAT 7%" },
        },
      },
      seasons: { low: { name: "Low season" } },
      coupons: { SONGKRAN: { couponId: "coupon-1", code: "SONGKRAN" } },
    };
    return { pricing, season, quoteInput, context };
  };

  it("the profile renamed, re-rated and archived, the list repriced, the season deleted, the coupon archived: unchanged", () => {
    const { pricing, quoteInput, context } = build();
    const json = JSON.stringify(snapshotQuote(quoteInput, context));
    const before = readSnapshot(JSON.parse(json));
    expect(before.totals).toMatchObject({
      total: thb("1152"),
      vat: thb("75.36"),
    });

    // The shop changes everything the booking was priced from, in place, in
    // the very objects the snapshot was made from.
    const bikeLine = quoteInput.lines[0] as QuoteLineInput;
    bikeLine.taxRateBp = 1000; // re-rated
    (context.lines.bike.taxProfile as { name: string }).name = "GST (archived)";
    (context.lines.bike as { taxProfile: unknown }).taxProfile = null; // archived
    (context.lines.bike as { productName: string }).productName = "Renamed";
    if (pricing.method !== "tiered") throw new Error("a list");
    const days = pricing.list.days as bigint[];
    for (let i = 0; i < days.length; i++) days[i] = days[i] * 2n; // repriced
    pricing.longStayDay = thb("250");
    (quoteInput.seasonRules as unknown[]).length = 0; // season deleted
    delete (context.seasons as Record<string, unknown>).low;
    (quoteInput.discounts as unknown[]).length = 0; // coupon archived
    delete (context.coupons as Record<string, unknown>).SONGKRAN;
    (quoteInput as { couponsEnabled: boolean }).couponsEnabled = false;

    // Today the same booking would cost something else entirely.
    const today = priced(quoteInput);
    expect(today.totals.total).toBe(thb("2800"));
    expect(today.totals.total).not.toBe(before.totals.total);

    // The stored snapshot reads exactly as it did.
    const after = readSnapshot(JSON.parse(json));
    expect(after).toEqual(before);
    expect(after.lines[0]).toMatchObject({
      productName: "Honda Click 125",
      taxRateBp: 700,
      taxProfileId: "vat-profile",
      taxProfileName: "VAT 7%",
      listPrice: thb("1400"),
      seasonPrice: thb("1280"),
      amount: thb("1152"),
      taxAmount: thb("75.36"),
    });
    expect(after.lines[0].seasons).toEqual([
      {
        ruleId: "low",
        name: "Low season",
        adjustBp: -2000,
        periodsInside: 3,
        periods: 7,
        amount: thb("-120"),
      },
    ]);
    expect(after.lines[0].discounts[0]).toMatchObject({
      couponId: "coupon-1",
      couponCode: "SONGKRAN",
      percentBp: 1000,
      amount: thb("128"),
    });
    const kept = after.lines[0].pricing;
    if (kept.method !== "tiered") throw new Error("a list");
    expect(kept.list.days[6]).toBe(thb("1400"));
    expect(kept.longStayDay).toBe(thb("100"));
    expect(after.taxGroups[0]).toMatchObject({
      rateBp: 700,
      profileNames: ["VAT 7%"],
      vat: thb("75.36"),
    });
  });

  it("readSnapshot takes the stored data and nothing else", () => {
    expect(readSnapshot.length).toBe(1);
  });

  it("what is read back shares nothing with the stored data either", () => {
    const { quoteInput, context } = build();
    const stored = snapshotQuote(quoteInput, context);
    const read = readSnapshot(stored);
    (stored.totals as { total: string }).total = "1";
    (stored.lines as Array<{ amount: string }>)[0].amount = "1";
    expect(read.totals.total).toBe(thb("1152"));
    expect(read.lines[0].amount).toBe(thb("1152"));
  });
});

describe("a swap and an early return take their shares from the snapshot", () => {
  /** The old period, from nothing but the stored snapshot of its invoice. */
  const periodFrom = (json: string, at: Date): OpenPeriod => {
    const stored = readSnapshot(JSON.parse(json)).lines[0];
    return {
      rentalStart: stored.rentalStart ?? stored.start,
      start: stored.start,
      end: stored.end,
      at,
      timeZone: stored.timeZone,
      pricing: stored.pricing,
      priceBeforeDiscount: stored.seasonPrice,
      charged: stored.amount,
    };
  };
  const snapshotOf = (quoteInput: QuoteInput) =>
    JSON.stringify(snapshotQuote(quoteInput, contextFor(quoteInput)));

  it("an early return on 15 Jan: ฿1,500 of the ฿3,000 paid is unused, under each of the shop's choices", () => {
    const json = snapshotOf(firstBooking());
    const period = periodFrom(json, bkk("2027-01-15"));
    expect(earlyReturn(period, "credit")).toMatchObject({
      periodList: thb("3000"),
      usedList: thb("1500"),
      unusedList: thb("1500"),
      paidRemainder: thb("1500"),
      settlement: {
        toPay: 0n,
        creditKept: thb("1500"),
        refund: 0n,
        forgone: 0n,
      },
    });
    expect(earlyReturn(period, "refund").settlement.refund).toBe(thb("1500"));
    expect(earlyReturn(period, "no_charge").settlement.forgone).toBe(
      thb("1500"),
    );
  });

  it("with ฿2,500 paid against ฿3,000: ฿1,250", () => {
    const json = snapshotOf(firstBooking(thb("500")));
    expect(
      earlyReturn(periodFrom(json, bkk("2027-01-15")), "refund").settlement
        .refund,
    ).toBe(thb("1250"));
  });

  it("the shares come from the list as it was, though the shop has doubled it since", () => {
    const quoteInput = firstBooking();
    const json = snapshotOf(quoteInput);
    const pricing = quoteInput.lines[0].pricing!;
    if (pricing.method !== "tiered") throw new Error("a list");
    const days = pricing.list.days as bigint[];
    // The first two weeks now cost as much as the month: nothing would be unused.
    for (let i = 13; i < 29; i++) days[i] = days[29];
    expect(
      earlyReturn({ ...periodFrom(json, bkk("2027-01-15")), pricing }, "refund")
        .settlement.refund,
    ).toBe(0n);
    expect(
      earlyReturn(periodFrom(json, bkk("2027-01-15")), "refund").settlement
        .refund,
    ).toBe(thb("1500"));
  });

  it("the owner's swap: ฿300 extra, and the swap's own invoice snapshots too", () => {
    const period = periodFrom(snapshotOf(firstBooking()), bkk("2027-01-15"));
    const swap = swapAmounts(period, bikeB());
    expect(swap.remainder.fullPrice).toEqual({
      newCharged: thb("1800"),
      extra: thb("300"),
    });
    const swapInput = input({
      lines: [
        continuationLine(
          bikeB(),
          period.rentalStart,
          swap.span.start,
          swap.span.end,
        ),
      ],
      credits: [{ id: "from-a", amount: swap.paidRemainder, taxRateBp: VAT_7 }],
    });
    const { read } = roundTrip(swapInput, contextFor(swapInput));
    expect(read.totals).toMatchObject({
      total: thb("300"),
      credit: thb("1500"),
      vat: thb("19.63"),
    });
  });

  it("a cheaper bike, from bike B's snapshot: ฿300 left over", () => {
    const onB: QuoteInput = {
      ...firstBooking(),
      lines: [
        { ...firstBooking().lines[0], productId: "bike-b", pricing: bikeB() },
      ],
    };
    const period = periodFrom(snapshotOf(onB), bkk("2027-01-15"));
    expect(period.charged).toBe(thb("3500"));
    const down = swapAmounts(period, bikeA());
    expect(down.remainder.fullPrice.extra).toBe(thb("-300"));
    expect(
      settleSwap(down.newRemainder, down.paidRemainder, "refund"),
    ).toMatchObject({
      toPay: 0n,
      creditApplied: thb("1500"),
      refund: thb("300"),
    });
  });
});

describe("versions", () => {
  /**
   * A version 1 snapshot exactly as it is stored, written out by hand. It is
   * here so that the day the shape changes, this text does not: from then on
   * it is the older version that must still read.
   */
  const VERSION_1 = `{
    "version": 1,
    "currency": "THB",
    "exponent": 2,
    "priced_at": "2027-10-20T03:15:00.000Z",
    "tax_inclusive": true,
    "lines": [
      {
        "version": 1,
        "id": "helmet",
        "currency": "THB",
        "exponent": 2,
        "product_id": "helmet-1",
        "product_name": "Open-face helmet",
        "product_type": "gear",
        "parent_line_id": null,
        "start": "2027-11-01T03:00:00.000Z",
        "end": "2027-11-08T03:00:00.000Z",
        "rental_start": null,
        "time_zone": "Asia/Bangkok",
        "periods": { "unit": "day", "count": 7 },
        "quantity": 3,
        "included_quantity": 0,
        "charged_quantity": 3,
        "included_per_vehicle": null,
        "unit_price": {
          "amount": "35000",
          "basis": { "kind": "periods", "period": "day", "count": 7 }
        },
        "list_price": "105000",
        "pricing": { "method": "per_period", "amount": "5000", "period": "day" },
        "seasons": [
          {
            "rule_id": "peak",
            "name": "Peak",
            "adjust_bp": 1000,
            "periods_inside": 7,
            "periods": 7,
            "amount": "10500"
          }
        ],
        "season_total": "10500",
        "season_price": "115500",
        "discounts": [
          {
            "discount_id": "d1",
            "source": "staff",
            "coupon_id": null,
            "coupon_code": null,
            "kind": "fixed",
            "percent_bp": null,
            "fixed_amount": "8500",
            "amount": "8500"
          }
        ],
        "discount_total": "8500",
        "amount": "107000",
        "taxable": true,
        "tax_rate_bp": 700,
        "tax_profile_id": "p1",
        "tax_profile_name": "VAT 7%",
        "tax_inclusive": true,
        "tax_amount": "7000",
        "deposit": null
      }
    ],
    "tax_groups": [
      {
        "rate_bp": 700,
        "profile_names": ["VAT 7%"],
        "base": "107000",
        "net": "100000",
        "vat": "7000",
        "gross": "107000",
        "tax_inclusive": true
      }
    ],
    "non_taxable": "0",
    "credits": [],
    "discounts": [
      {
        "discount_id": "d1",
        "source": "staff",
        "coupon_id": null,
        "coupon_code": null,
        "kind": "fixed",
        "percent_bp": null,
        "fixed_amount": "8500",
        "all_lines": true,
        "line_ids": [],
        "total": "8500"
      }
    ],
    "totals": {
      "list_price": "105000",
      "seasons": "10500",
      "discount": "8500",
      "credit": "0",
      "net": "100000",
      "vat": "7000",
      "total": "107000"
    },
    "deposit": {
      "amount": "200000",
      "mode": "fixed_per_order",
      "percent_bp": null,
      "fixed_amount": "200000",
      "from": "shop"
    }
  }`;

  it("the hand-written version 1 reads, to the satang", () => {
    const read = readSnapshot(JSON.parse(VERSION_1));
    expect(read.version).toBe(1);
    expect(read.totals).toEqual({
      listPrice: thb("1050"),
      seasons: thb("105"),
      discount: thb("85"),
      credit: 0n,
      net: thb("1000"),
      vat: thb("70"),
      total: thb("1070"),
    });
    expect(read.lines[0]).toMatchObject({
      productName: "Open-face helmet",
      start: bkk("2027-11-01"),
      unitPrice: { amount: thb("350") },
      amount: thb("1070"),
      taxAmount: thb("70"),
    });
    expect(read.deposit.amount).toBe(thb("2000"));
  });

  it("and it is exactly what the code writes today for that invoice", () => {
    const quoteInput = input({
      lines: [
        line("helmet", perDay(thb("50")), {
          productId: "helmet-1",
          days: 7,
          quantity: 3,
          vehicle: false,
        }),
      ],
      seasonRules: [
        {
          id: "peak",
          startsOn: "2027-10-15",
          endsOn: "2027-11-30",
          repeatsYearly: false,
          adjustBp: 1000,
          products: "all",
        },
      ],
      discounts: [
        { id: "d1", source: "staff", lines: "all", amount: thb("85") },
      ],
      deposit: { shop: { mode: "fixed_per_order", amount: thb("2000") } },
    });
    const stored = snapshotQuote(quoteInput, {
      currency: "THB",
      exponent: 2,
      pricedAt: new Date("2027-10-20T03:15:00.000Z"),
      lines: {
        helmet: {
          productName: "Open-face helmet",
          productType: "gear",
          taxProfile: { id: "p1", name: "VAT 7%" },
        },
      },
      seasons: { peak: { name: "Peak" } },
    });
    expect(stored).toEqual(JSON.parse(VERSION_1));
  });

  it("an older version still reads: it is brought up to date step by step as it is read", () => {
    // No version 2 exists yet, so the chain is run here with the steps a
    // version 2 and a version 3 would add.
    const v1 = JSON.parse(VERSION_1) as StoredSnapshot;
    const upgrades = {
      1: {
        invoice: (older: { [key: string]: Json }) => ({
          ...older,
          channel: "walk_in",
        }),
        line: (older: { [key: string]: Json }) => ({ ...older, plate: "1กก" }),
      },
      2: {
        invoice: (older: { [key: string]: Json }) => {
          const { channel, ...rest } = older;
          return { ...rest, booked_through: channel };
        },
        line: (older: { [key: string]: Json }) => {
          const { plate, ...rest } = older;
          return { ...rest, plate_number: plate };
        },
      },
    };
    const v3 = upgradeSnapshot(v1, upgrades, 3);
    expect(v3.version).toBe(3);
    expect(v3.booked_through).toBe("walk_in");
    expect(v3).not.toHaveProperty("channel");
    // Its lines go with it: each takes the line steps and the new version.
    const v3Lines = v3.lines as Array<{ [key: string]: Json }>;
    expect(v3Lines).toHaveLength(1);
    expect(v3Lines[0].version).toBe(3);
    expect(v3Lines[0].plate_number).toBe("1กก");
    expect(v3Lines[0]).not.toHaveProperty("plate");
    // Nothing else moved, and the stored original was not touched.
    const v1Lines = v1.lines as Array<{ [key: string]: Json }>;
    expect({ ...v3Lines[0], version: 1, plate_number: undefined }).toEqual({
      ...v1Lines[0],
      plate_number: undefined,
    });
    expect({
      ...v3,
      version: 1,
      lines: v1.lines,
      booked_through: undefined,
    }).toEqual({ ...v1, booked_through: undefined });
    expect(v1.version).toBe(1);
    expect(v1).not.toHaveProperty("channel");
    expect(v1Lines[0].version).toBe(1);
    expect(v1Lines[0]).not.toHaveProperty("plate");
    // A version 2 snapshot takes only the second step.
    expect(
      upgradeSnapshot(
        {
          ...v1,
          version: 2,
          channel: "phone",
          lines: v1Lines.map((l) => ({ ...l, version: 2, plate: "2ขข" })),
        },
        upgrades,
        3,
      ).booked_through,
    ).toBe("phone");
    // A step with nothing to do for a line (or for the invoice) is allowed.
    expect(
      (
        upgradeSnapshot(v1, { 1: {} }, 2).lines as Array<{
          [key: string]: Json;
        }>
      )[0].version,
    ).toBe(2);
    // The current version passes through as it is.
    expect(upgradeSnapshot(v1)).toEqual(v1);
  });

  it("refuses a version it does not know, rather than guess", () => {
    const v1 = JSON.parse(VERSION_1) as StoredSnapshot;
    expect(() => readSnapshot({ ...v1, version: 2 })).toThrow(/reads up to 1/);
    expect(() => readSnapshot({ ...v1, version: 0 })).toThrow(SnapshotError);
    expect(() => readSnapshot({ ...v1, version: "1" })).toThrow(SnapshotError);
    expect(() => readSnapshot({ ...v1, version: 1.5 })).toThrow(SnapshotError);
    const { version: _gone, ...unversioned } = v1;
    void _gone;
    expect(() => readSnapshot(unversioned)).toThrow(SnapshotError);
    // A gap in the chain is an error, not a skipped step.
    expect(() => upgradeSnapshot(v1, { 2: {} }, 3)).toThrow(/version 1/);
    for (const junk of [null, "text", 7, [v1]]) {
      expect(() => readSnapshot(junk)).toThrow(SnapshotError);
    }
  });
});

describe("what is refused", () => {
  const first = pinnedQuotes()[0];
  const good = () =>
    JSON.parse(JSON.stringify(snapshotQuote(first.input, first.context)));
  const unreadable = (change: (stored: ReturnType<typeof good>) => void) => {
    const stored = good();
    change(stored);
    expect(() => readSnapshot(stored)).toThrow(SnapshotError);
  };

  it("reading: an amount that is a number, has a decimal point, or is negative where it can't be", () => {
    expect(() => readSnapshot(good())).not.toThrow();
    unreadable((s) => (s.totals.total = 300000));
    unreadable((s) => (s.totals.total = "3000.00"));
    unreadable((s) => (s.totals.total = "-300000"));
    unreadable((s) => (s.totals.total = ""));
    unreadable((s) => (s.totals.total = "3e5"));
    unreadable((s) => (s.lines[0].tax_amount = null));
    unreadable((s) => (s.lines[0].pricing.list.days[3] = 1234));
  });

  it("reading: a missing field, an unknown field, a wrong kind", () => {
    unreadable((s) => delete s.totals.vat);
    unreadable((s) => delete s.lines[0].tax_amount);
    unreadable((s) => delete s.deposit);
    unreadable((s) => (s.totals.tip = "100"));
    unreadable((s) => (s.lines[0].listPrice = "300000"));
    unreadable((s) => (s.lines[0].quantity = 1.5));
    unreadable((s) => (s.lines[0].quantity = "1"));
    unreadable((s) => (s.lines[0].product_type = "boat"));
    unreadable((s) => (s.lines[0].pricing.method = "auction"));
    unreadable((s) => (s.lines[0].unit_price.basis.kind = "guess"));
    unreadable((s) => (s.lines[0].start = "1 Nov 2027"));
    unreadable((s) => (s.lines[0].start = "2027-11-01T10:00:00+07:00"));
    unreadable((s) => (s.lines = {}));
    unreadable((s) => (s.tax_inclusive = "yes"));
  });

  const unwritable = (
    change: (parts: {
      quoteInput: QuoteInput;
      context: SnapshotContext;
    }) => void,
    quoteInput: QuoteInput = first.input,
  ) => {
    const parts = {
      quoteInput: { ...quoteInput },
      context: { ...contextFor(quoteInput) },
    };
    change(parts);
    expect(() => snapshotQuote(parts.quoteInput, parts.context)).toThrow(
      SnapshotError,
    );
  };

  it("writing: a line with no product name, or a taxed line with no profile", () => {
    unwritable((p) => (p.context.lines = {}));
    unwritable(
      (p) =>
        (p.context.lines = { a: { ...p.context.lines.a, taxProfile: null } }),
    );
    unwritable(
      (p) =>
        (p.context.lines = {
          a: { ...p.context.lines.a, productType: "gear" },
        }),
    );
  });

  it("writing: a season or a coupon with no name to keep", () => {
    const season = pinnedQuotes().find((p) =>
      p.name.startsWith("3 of 7 days"),
    )!;
    unwritable((p) => (p.context.seasons = {}), season.input);
    const coupon = pinnedQuotes().find((p) =>
      p.name.startsWith("a 10% coupon"),
    )!;
    unwritable((p) => (p.context.coupons = {}), coupon.input);
  });

  it("writing: a currency that is not one, an exponent or a moment that is not one", () => {
    unwritable((p) => (p.context.currency = "baht"));
    unwritable((p) => (p.context.currency = "thb"));
    unwritable((p) => (p.context.exponent = 5));
    unwritable((p) => (p.context.exponent = 2.5));
    unwritable((p) => (p.context.pricedAt = new Date("never")));
  });

  it("an invoice with no lines snapshots as an empty one", () => {
    const empty = input({ lines: [] });
    const { read } = roundTrip(empty, contextFor(empty));
    expect(read.lines).toEqual([]);
    expect(read.totals.total).toBe(0n);
  });
});

// ------------------------------------------- after the review of PR 40

describe("snapshotQuote() prices the input itself", () => {
  it("takes the input and the context, and nothing that could disagree with them", () => {
    expect(snapshotQuote.length).toBe(2);
    const quoteInput = input({
      lines: [line("a", bike300(), { quantity: 3 })],
    });
    const read = readSnapshot(
      snapshotQuote(quoteInput, contextFor(quoteInput)),
    );
    const q = priced(quoteInput);
    expect(read.lines[0].quantity).toBe(3);
    expect(read.lines[0].listPrice).toBe(q.lines[0].listPrice);
    expect(read.totals).toEqual(q.totals);
  });

  it("refuses an invoice with a line that can't be priced, naming the line", () => {
    const quoteInput = input({
      lines: [line("a", bike300()), line("b", null), line("c", null)],
    });
    expect(() => snapshotQuote(quoteInput, contextFor(quoteInput))).toThrow(
      SnapshotError,
    );
    expect(() => snapshotQuote(quoteInput, contextFor(quoteInput))).toThrow(
      /can't be priced: b, c/,
    );
  });

  it("lets the pricer's own refusals through as they are", () => {
    const off = input({
      couponsEnabled: false,
      lines: [line("a", bike300())],
      discounts: [{ id: "X", source: "coupon", lines: "all", percentBp: 1000 }],
    });
    expect(() => snapshotQuote(off, contextFor(off))).toThrow(QuoteError);
  });

  it("refuses a line with charge rules, so they can't be dropped silently when they are built", () => {
    const rules = { chargeFullReturnDay: true } as unknown as NonNullable<
      QuoteLineInput["span"]["rules"]
    >;
    for (const pricing of [
      bike300(),
      fixed("100"),
      { method: "free" } as const,
    ]) {
      const base = line("a", pricing, { days: 7 });
      const quoteInput = input({
        lines: [{ ...base, span: { ...base.span, rules } }],
      });
      expect(() => snapshotQuote(quoteInput, contextFor(quoteInput))).toThrow(
        SnapshotError,
      );
      expect(() => snapshotQuote(quoteInput, contextFor(quoteInput))).toThrow(
        /charge rules/,
      );
    }
    // No rules, or an empty set, is what every line has today.
    const base = line("a", bike300(), { days: 7 });
    const empty = input({
      lines: [{ ...base, span: { ...base.span, rules: {} } }],
    });
    expect(() => snapshotQuote(empty, contextFor(empty))).not.toThrow();
  });
});

describe("a line stored on its own", () => {
  const extras = pinnedQuotes().find((p) =>
    p.name.includes("helmets included"),
  )!;

  it("carries the snapshot's version, and reads alone exactly as it reads in its invoice", () => {
    for (const each of pinnedQuotes()) {
      const { stored, read } = roundTrip(each.input, each.context);
      const lines = stored.lines as Array<{ [key: string]: Json }>;
      lines.forEach((storedLine, index) => {
        expect(storedLine.version, each.name).toBe(SNAPSHOT_VERSION);
        // As an order line keeps it: the line's JSON and nothing else.
        const alone = readSnapshotLine(JSON.parse(JSON.stringify(storedLine)));
        expect(alone, each.name).toEqual(read.lines[index]);
        expect(alone.version).toBe(SNAPSHOT_VERSION);
      });
    }
  });

  it("is upgraded on its own, by the line steps of the same chain", () => {
    const { stored } = roundTrip(extras.input, extras.context);
    const v1 = (stored.lines as Array<{ [key: string]: Json }>)[1];
    const upgrades = {
      1: {
        invoice: () => {
          throw new Error("a line alone has no invoice to upgrade");
        },
        line: (older: { [key: string]: Json }) => ({ ...older, plate: "1กก" }),
      },
      2: {
        line: (older: { [key: string]: Json }) => {
          const { plate, ...rest } = older;
          return { ...rest, plate_number: plate };
        },
      },
    };
    const v3 = upgradeSnapshotLine(v1, upgrades, 3);
    expect(v3.version).toBe(3);
    expect(v3.plate_number).toBe("1กก");
    expect(v3).not.toHaveProperty("plate");
    expect({ ...v3, version: 1, plate_number: undefined }).toEqual({
      ...v1,
      plate_number: undefined,
    });
    // The stored line was not touched, and a version 2 line takes one step.
    expect(v1.version).toBe(1);
    expect(v1).not.toHaveProperty("plate");
    expect(
      upgradeSnapshotLine({ ...v1, version: 2, plate: "2ขข" }, upgrades, 3)
        .plate_number,
    ).toBe("2ขข");
    // A step with nothing for a line only raises its version.
    expect(upgradeSnapshotLine(v1, { 1: {} }, 2)).toEqual({
      ...v1,
      version: 2,
    });
    // The current version passes through, and reads.
    expect(upgradeSnapshotLine(v1)).toEqual(v1);
    expect(readSnapshotLine(v1).id).toBe("helmet");
  });

  it("refuses a line with no version, a newer one, a gap in the chain, or one that is not its invoice's", () => {
    const { stored } = roundTrip(extras.input, extras.context);
    const v1 = (stored.lines as Array<{ [key: string]: Json }>)[1];
    const { version: _gone, ...unversioned } = v1;
    void _gone;
    expect(() => readSnapshotLine(unversioned)).toThrow(SnapshotError);
    expect(() => readSnapshotLine({ ...v1, version: 2 })).toThrow(
      /reads up to 1/,
    );
    expect(() => readSnapshotLine({ ...v1, version: 0 })).toThrow(
      SnapshotError,
    );
    expect(() => readSnapshotLine({ ...v1, version: "1" })).toThrow(
      SnapshotError,
    );
    expect(() => upgradeSnapshotLine(v1, { 2: {} }, 3)).toThrow(/version 1/);
    for (const junk of [null, "text", 7, [v1]]) {
      expect(() => readSnapshotLine(junk)).toThrow(SnapshotError);
    }
    // A whole snapshot is not a line, and a line is not a snapshot.
    expect(() => readSnapshotLine(stored)).toThrow(SnapshotError);
    expect(() => readSnapshot(v1)).toThrow(SnapshotError);
    // In an invoice, every line carries the invoice's version.
    const mixed = JSON.parse(JSON.stringify(stored));
    delete mixed.lines[0].version;
    expect(() => readSnapshot(mixed)).toThrow(/carries the snapshot's version/);
    const ahead = JSON.parse(JSON.stringify(stored));
    ahead.lines[1].version = 2;
    expect(() => readSnapshot(ahead)).toThrow(/carries the snapshot's version/);
  });
});

describe("an extra's allowance per vehicle", () => {
  const helmets = (scooters: number, taken: number, perVehicle: number) => {
    const quoteInput = input({
      lines: [
        line("scooter", bike300(), { days: 7, quantity: scooters }),
        line("helmet", perDay(thb("50")), {
          days: 7,
          quantity: taken,
          vehicle: false,
          extraOf: { lineId: "scooter", includedQuantity: perVehicle },
        }),
        line("box", fixed("300"), { vehicle: false }),
      ],
    });
    return roundTrip(quoteInput, contextFor(quoteInput));
  };

  it("is stored as it was passed in, and empty for a line with no parent", () => {
    const { read, stored } = helmets(1, 3, 2);
    expect(read.lines.map((l) => l.includedPerVehicle)).toEqual([
      null,
      2,
      null,
    ]);
    expect(
      (stored.lines as Array<{ [key: string]: Json }>).map(
        (l) => l.included_per_vehicle,
      ),
    ).toEqual([null, 2, null]);
  });

  it("3 helmets taken where 2 scooters give 4: 3 included, and the 2 each is still on record", () => {
    const { read } = helmets(2, 3, 2);
    expect(read.lines[1]).toMatchObject({
      quantity: 3,
      includedQuantity: 3,
      chargedQuantity: 0,
      includedPerVehicle: 2,
      parentLineId: "scooter",
    });
    // The allowance Phase 3 needs when a fourth and a fifth helmet are added:
    // 2 each × the parent's 2, from the snapshot alone.
    expect(read.lines[0].quantity).toBe(2);
  });

  it("an allowance of none is 0, not empty", () => {
    expect(helmets(1, 2, 0).read.lines[1].includedPerVehicle).toBe(0);
  });

  it("is refused below 0 when read", () => {
    const stored = JSON.parse(JSON.stringify(helmets(1, 3, 2).stored));
    stored.lines[1].included_per_vehicle = -1;
    expect(() => readSnapshot(stored)).toThrow(SnapshotError);
  });
});

describe("the invoice's discounts", () => {
  it("lists each one: id, source, coupon, kind, value, the lines it was aimed at and what it took", () => {
    const quoteInput = input({
      couponsEnabled: true,
      lines: [
        line("bike", bike300(), { days: 7 }),
        line("box", fixed("300"), { vehicle: false }),
      ],
      discounts: [
        {
          id: "back",
          source: "returning_customer",
          lines: ["bike"],
          percentBp: 1000,
        },
        { id: "SAVE200", source: "coupon", lines: "all", amount: thb("200") },
      ],
    });
    const { read, stored } = roundTrip(
      quoteInput,
      contextFor(quoteInput, {
        coupons: { SAVE200: { couponId: "c-77", code: "SAVE200" } },
      }),
    );
    expect(read.discounts).toEqual([
      {
        discountId: "back",
        source: "returning_customer",
        couponId: null,
        couponCode: null,
        kind: "percent",
        percentBp: 1000,
        fixedAmount: null,
        allLines: false,
        lineIds: ["bike"],
        total: thb("140"),
      },
      {
        discountId: "SAVE200",
        source: "coupon",
        couponId: "c-77",
        couponCode: "SAVE200",
        kind: "fixed",
        percentBp: null,
        fixedAmount: thb("200"),
        allLines: true,
        lineIds: [],
        total: thb("200"),
      },
    ]);
    expect((stored.discounts as Json[])[1]).toEqual({
      discount_id: "SAVE200",
      source: "coupon",
      coupon_id: "c-77",
      coupon_code: "SAVE200",
      kind: "fixed",
      percent_bp: null,
      fixed_amount: "20000",
      all_lines: true,
      line_ids: [],
      total: "20000",
    });
  });

  it("keeps a coupon that took 0: it was still used", () => {
    // Everything on the invoice is free, so 10% off comes to nothing.
    const quoteInput = input({
      couponsEnabled: true,
      lines: [line("gift", { method: "free" }, { vehicle: false })],
      discounts: [
        { id: "FREEBIE", source: "coupon", lines: "all", percentBp: 1000 },
      ],
    });
    const context = contextFor(quoteInput, {
      coupons: { FREEBIE: { couponId: "c-9", code: "FREEBIE" } },
    });
    const { read } = roundTrip(quoteInput, context);
    expect(read.lines[0].discounts).toEqual([]);
    expect(read.discounts).toEqual([
      {
        discountId: "FREEBIE",
        source: "coupon",
        couponId: "c-9",
        couponCode: "FREEBIE",
        kind: "percent",
        percentBp: 1000,
        fixedAmount: null,
        allLines: true,
        lineIds: [],
        total: 0n,
      },
    ]);
    // Its id and code are needed even then.
    expect(() =>
      snapshotQuote(quoteInput, { ...context, coupons: {} }),
    ).toThrow(/needs its id and code/);
  });

  it("a fixed coupon bigger than its lines: the value as given, and what it really took", () => {
    const quoteInput = input({
      couponsEnabled: true,
      lines: [
        line("bike", bike300(), { days: 7 }),
        line("box", fixed("300"), { vehicle: false }),
      ],
      discounts: [
        { id: "BIG", source: "coupon", lines: ["box"], amount: thb("500") },
      ],
    });
    const { read } = roundTrip(quoteInput, contextFor(quoteInput));
    expect(read.discounts[0]).toMatchObject({
      fixedAmount: thb("500"),
      allLines: false,
      lineIds: ["box"],
      total: thb("300"),
    });
  });

  it("adds up, by addition alone, in every pinned case: each discount's lines to its total, and the discounts to the invoice's", () => {
    let withDiscounts = 0;
    for (const each of pinnedQuotes()) {
      const { read } = roundTrip(each.input, each.context);
      expect(
        read.discounts.map((d) => d.discountId),
        each.name,
      ).toEqual((each.input.discounts ?? []).map((d) => d.id));
      for (const discount of read.discounts) {
        withDiscounts += 1;
        const taken = read.lines.flatMap((l) =>
          l.discounts.filter((d) => d.discountId === discount.discountId),
        );
        expect(sum(taken.map((d) => d.amount)), each.name).toBe(discount.total);
        // A line it took from is one it was aimed at.
        for (const l of read.lines) {
          if (l.discounts.some((d) => d.discountId === discount.discountId)) {
            expect(discount.allLines || discount.lineIds.includes(l.id)).toBe(
              true,
            );
          }
        }
      }
      expect(sum(read.discounts.map((d) => d.total)), each.name).toBe(
        read.totals.discount,
      );
    }
    expect(withDiscounts).toBeGreaterThan(5);
  });
});

describe("what the reader refuses, value by value", () => {
  const extras = pinnedQuotes().find((p) =>
    p.name.includes("helmets included"),
  )!;
  const season = pinnedQuotes().find((p) => p.name.startsWith("3 of 7 days"))!;
  const good = (from: Pinned = extras) =>
    JSON.parse(JSON.stringify(snapshotQuote(from.input, from.context)));
  type Stored = ReturnType<typeof good>;
  const unreadable = (change: (stored: Stored) => void, from?: Pinned) => {
    const stored = good(from);
    change(stored);
    expect(() => readSnapshot(stored)).toThrow(SnapshotError);
    return stored;
  };
  /** The same change, on a line read alone. */
  const lineUnreadable = (change: (line: Stored) => void) => {
    const stored = good().lines[1];
    expect(() => readSnapshotLine(stored)).not.toThrow();
    change(stored);
    expect(() => readSnapshotLine(stored)).toThrow(SnapshotError);
  };

  it("reads the good ones", () => {
    expect(() => readSnapshot(good())).not.toThrow();
    expect(() => readSnapshot(good(season))).not.toThrow();
  });

  it("an amount with a leading zero", () => {
    unreadable((s) => (s.totals.total = "0175000"));
    unreadable((s) => (s.totals.total = "00"));
    unreadable((s) => (s.lines[0].list_price = "0140000"));
    unreadable((s) => (s.lines[1].pricing.amount = "05000"));
    unreadable((s) => (s.deposit.amount = "01"));
    lineUnreadable((l) => (l.amount = "035000"));
    // A plain zero is an amount.
    const zero = good();
    zero.lines[2].amount = "0";
    expect(() => readSnapshot(zero)).not.toThrow();
  });

  it("a signed amount with a leading zero, or a minus zero", () => {
    unreadable((s) => (s.totals.seasons = "-0"), season);
    unreadable((s) => (s.totals.seasons = "-012000"), season);
    unreadable((s) => (s.totals.seasons = "012000"), season);
    unreadable((s) => (s.lines[0].season_total = "-0"), season);
    unreadable((s) => (s.lines[0].seasons[0].amount = "--12000"), season);
    // The real one reads, minus and all.
    expect(readSnapshot(good(season)).totals.seasons).toBe(thb("-120"));
  });

  it("a quantity under 1", () => {
    unreadable((s) => (s.lines[0].quantity = 0));
    unreadable((s) => (s.lines[0].quantity = -1));
    lineUnreadable((l) => (l.quantity = 0));
  });

  it("an included or charged quantity, or a count of periods, under 0", () => {
    unreadable((s) => (s.lines[1].included_quantity = -1));
    unreadable((s) => (s.lines[1].charged_quantity = -1));
    unreadable((s) => (s.lines[1].periods.count = -7));
    unreadable((s) => (s.lines[0].seasons[0].periods_inside = -1), season);
    // 0 charged is what a fully included extra has.
    const none = good();
    none.lines[1].charged_quantity = 0;
    expect(() => readSnapshot(none)).not.toThrow();
  });

  it("an exponent outside 0 to 4", () => {
    unreadable((s) => (s.exponent = 5));
    unreadable((s) => (s.exponent = 9));
    unreadable((s) => (s.exponent = -1));
    unreadable((s) => (s.lines[0].exponent = 5));
    lineUnreadable((l) => (l.exponent = -1));
    for (const exponent of [0, 2, 3, 4]) {
      const stored = good();
      stored.exponent = exponent;
      expect(() => readSnapshot(stored)).not.toThrow();
    }
  });

  it("a tax rate outside 0 to 10000", () => {
    unreadable((s) => (s.lines[0].tax_rate_bp = 10001));
    unreadable((s) => (s.lines[0].tax_rate_bp = 99999));
    unreadable((s) => (s.lines[0].tax_rate_bp = -1));
    unreadable((s) => (s.tax_groups[0].rate_bp = 10001));
    unreadable((s) => (s.tax_groups[0].rate_bp = -700));
    lineUnreadable((l) => (l.tax_rate_bp = 10001));
    const swap = pinnedQuotes().find((p) =>
      p.name.startsWith("a swap with a credit"),
    )!;
    unreadable((s) => (s.credits[0].tax_rate_bp = 10001), swap);
    // Both ends are rates: 0% and 100%. So is none at all.
    for (const rate of [0, 10000, null]) {
      const stored = good();
      stored.lines[0].tax_rate_bp = rate;
      expect(() => readSnapshot(stored)).not.toThrow();
    }
  });

  it("a currency that is not three capitals", () => {
    for (const currency of ["zzz", "Thb", "TH", "THBX", "", "฿", 764, null]) {
      unreadable((s) => (s.currency = currency));
      unreadable((s) => (s.lines[0].currency = currency));
      lineUnreadable((l) => (l.currency = currency));
    }
  });

  it("a version under 1 on a line", () => {
    lineUnreadable((l) => (l.version = 0));
    lineUnreadable((l) => (l.version = 1.5));
  });

  it("and writing refuses the same values, so a bad one is never stored", () => {
    const quoteInput = input({ lines: [line("a", bike300())] });
    for (const context of [
      contextFor(quoteInput, { currency: "thb" }),
      contextFor(quoteInput, { currency: "BAHT" }),
      contextFor(quoteInput, { exponent: 5 }),
      contextFor(quoteInput, { exponent: -1 }),
    ]) {
      expect(() => snapshotQuote(quoteInput, context)).toThrow(SnapshotError);
    }
  });
});
