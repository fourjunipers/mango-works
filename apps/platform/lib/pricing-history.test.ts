import { describe, expect, it } from "vitest";
import { buildHistory, type AuditRow } from "./history";
import { pricingHistory, type TemplateInfo } from "./pricing-history";

const product = "p1";
let id = 0;
const row = (part: Partial<AuditRow>): AuditRow => ({
  id: ++id,
  entity: "product_pricing",
  entity_id: product,
  action: "update",
  actor: "u1",
  before: null,
  after: null,
  at: `2026-11-15T10:00:${String(id).padStart(2, "0")}Z`,
  ...part,
});
const templates = new Map<string, TemplateInfo>([
  ["shared-1", { name: "350–3500", kind: "multipliers" }],
  ["shared-a", { name: "Scooters", kind: "amounts" }],
]);
const days = (values: Record<number, number>) =>
  Object.fromEntries(Object.entries(values).map(([d, v]) => [d, String(v)]));
const lines = (rows: AuditRow[]) =>
  pricingHistory(rows, product, templates).map((e) => e.line);

describe("a product's price lines in its History (§9.12)", () => {
  it("the first own prices: the five quick-entry totals, once", () => {
    const own = row({
      entity: "price_templates",
      entity_id: "own-1",
      action: "insert",
      after: {
        product_id: product,
        name: "PCX",
        kind: "amounts",
        hourly: null,
      },
    });
    const all = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [i + 1, (i + 1) * 10000]),
    );
    const change = row({
      entity: "price_templates",
      entity_id: "own-1",
      action: "template_change",
      // As write_template_days records it: each day, with nothing before.
      before: {
        days: Object.fromEntries(Object.keys(all).map((d) => [d, null])),
      },
      after: { days: days(all), products: [] },
    });
    const pricing = row({
      action: "insert",
      after: {
        pricing_method: "tiered",
        price_template_id: "own-1",
        taxable: true,
        tax_profile_id: null,
        deposit: null,
      },
    });
    const method = row({
      entity: "products",
      action: "pricing_change",
      before: { pricing_method: null },
      after: { pricing_method: "tiered" },
    });
    expect(lines([own, change, pricing, method])).toEqual([
      { key: "methodSet", args: { to: { method: "tiered" } } },
      {
        key: "firstPrice",
        args: {
          daily: { money: "10000" },
          weekly: { money: "70000" },
          twoWeeks: { money: "140000" },
          threeWeeks: { money: "210000" },
          monthly: { money: "300000" },
        },
      },
    ]);
  });

  it("a box changed, with the filled days beneath; one day by hand", () => {
    const own = row({
      entity: "price_templates",
      entity_id: "own-1",
      action: "insert",
      after: { product_id: product, name: "PCX", kind: "amounts" },
    });
    const box = row({
      entity: "price_templates",
      entity_id: "own-1",
      action: "template_change",
      before: { days: days({ 2: 48000, 3: 67000, 7: 140000 }) },
      after: {
        days: days({ 2: 49000, 3: 68000, 7: 150000 }),
        products: [product],
      },
    });
    const one = row({
      entity: "price_templates",
      entity_id: "own-1",
      action: "template_change",
      before: { days: days({ 10: 170000 }) },
      after: { days: days({ 10: 180000 }), products: [product] },
    });
    expect(lines([own, box, one])).toEqual([
      {
        key: "dayChanged",
        args: {
          days: { number: 10 },
          from: { money: "170000" },
          to: { money: "180000" },
        },
      },
      {
        key: "boxChanged",
        args: {
          box: { text: "weekly" },
          from: { money: "140000" },
          to: { money: "150000" },
        },
        sub: [{ key: "otherDays", args: { count: { number: 2 } } }],
      },
    ]);
  });

  it("a shared list edited: on each product on it, with who else uses it", () => {
    const edit = row({
      entity: "price_templates",
      entity_id: "shared-1",
      action: "template_change",
      before: { days: days({ 7: 4500000 }) },
      after: { days: days({ 7: 4600000 }), products: [product, "p2", "p3"] },
    });
    expect(lines([edit])).toEqual([
      {
        key: "sharedListChanged",
        args: { list: { text: "350–3500" }, others: { number: 2 } },
        sub: [
          {
            key: "sharedDay",
            args: {
              days: { number: 7 },
              from: { multiplier: "4500000" },
              to: { multiplier: "4600000" },
            },
          },
        ],
      },
    ]);
  });

  it("moved to a shared list with a base price; then its own prices again", () => {
    const moved = row({
      before: { price_template_id: "own-1", base_amount: null },
      after: { price_template_id: "shared-1", base_amount: "10000" },
    });
    const own = row({
      entity: "price_templates",
      entity_id: "own-2",
      action: "insert",
      after: { product_id: product, name: "PCX", kind: "amounts" },
    });
    const back = row({
      before: { price_template_id: "shared-1", base_amount: "10000" },
      after: { price_template_id: "own-2", base_amount: null },
    });
    expect(lines([moved, own, back])).toEqual([
      { key: "ownPricesFrom", args: { list: { text: "350–3500" } } },
      {
        key: "movedToListBase",
        args: { list: { text: "350–3500" }, base: { money: "10000" } },
      },
    ]);
  });

  it("a flat fee, the deposit, the long-stay rate and tax, each its own line", () => {
    const save = row({
      before: {
        price_amount: "20000",
        deposit: "200000",
        long_stay_day: null,
        taxable: true,
      },
      after: {
        price_amount: "25000",
        price_period: "day",
        deposit: "300000",
        long_stay_day: "10000",
        taxable: false,
      },
    });
    expect(lines([save]).map((l) => l.key)).toEqual([
      "pricePerChanged",
      "longStaySet",
      "depositChanged",
      "taxChanged",
    ]);
    expect(lines([save])[3].args).toEqual({
      from: { tax: "default" },
      to: { tax: "none" },
    });
  });

  it("columns a new way of pricing cleared need no line", () => {
    const change = row({
      before: {
        pricing_method: "per_period",
        price_amount: "20000",
        price_period: "day",
      },
      after: {
        pricing_method: "fixed",
        price_period: null,
        price_amount: "15000",
      },
    });
    expect(lines([change]).map((l) => l.key)).toEqual(["priceChanged"]);
    const cleared = row({
      before: { pricing_method: "per_period", price_amount: "20000" },
      after: { pricing_method: "free", price_amount: null },
    });
    expect(lines([cleared])).toEqual([]);
  });

  it("the own list's hourly price", () => {
    const own = row({
      entity: "price_templates",
      entity_id: "own-1",
      action: "insert",
      after: {
        product_id: product,
        name: "PCX",
        kind: "amounts",
        hourly: "8000",
      },
    });
    const later = row({
      entity: "price_templates",
      entity_id: "own-1",
      before: { hourly: "8000" },
      after: { hourly: "9000" },
    });
    expect(lines([own, later]).map((l) => l.key)).toEqual([
      "hourlyChanged",
      "hourlySet",
    ]);
  });

  it("leaves another product's rows out, and the general History leaves these out", () => {
    const other = row({ entity_id: "p2", after: { deposit: "1" } });
    expect(lines([other])).toEqual([]);
    const pricingRow = row({ after: { deposit: "100" } });
    const method = row({ entity: "products", action: "pricing_change" });
    const named = row({
      entity: "products",
      action: "update",
      before: { name: "A" },
      after: { name: "B" },
    });
    expect(
      buildHistory([pricingRow, method, named]).map((e) => e.action),
    ).toEqual(["update"]);
  });
});
