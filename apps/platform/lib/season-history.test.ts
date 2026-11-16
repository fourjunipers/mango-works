import { describe, expect, it } from "vitest";
import type { AuditRow } from "./history";
import { seasonHistory } from "./season-history";

let id = 0;
const row = (
  at: string,
  action: string,
  after: unknown,
  before: unknown = null,
  rule = "r1",
): AuditRow => ({
  id: ++id,
  entity: "price_rules",
  entity_id: rule,
  action,
  actor: "owner",
  before,
  after,
  at,
});

const low = {
  id: "r1",
  name: "Low season",
  starts_on: "2027-04-01",
  ends_on: "2027-09-30",
  repeats_yearly: true,
  adjust_bp: -2000,
  all_products: false,
  active: true,
};

const keys = (rows: AuditRow[], product: string) =>
  seasonHistory(rows, product).map((e) => [e.line.key, e.line.args]);

describe("seasonHistory", () => {
  const t1 = "2027-01-01T10:00:00Z";
  const t2 = "2027-01-02T10:00:00Z";
  const t3 = "2027-01-03T10:00:00Z";
  const created = [
    row(t1, "insert", low),
    row(t1, "price_rule_change", { products: ["p1"] }, { products: [] }),
  ];

  it("says a season was added on each product it names, and nothing on the others", () => {
    expect(keys(created, "p1")).toEqual([
      [
        "seasonAdded",
        {
          name: { text: "Low season" },
          change: { adjust: -2000 },
          when: {
            dates: {
              startsOn: "2027-04-01",
              endsOn: "2027-09-30",
              yearly: true,
            },
          },
        },
      ],
    ]);
    expect(keys(created, "p2")).toEqual([]);
  });

  it("puts a season for every product on every product", () => {
    const all = [row(t1, "insert", { ...low, all_products: true })];
    expect(keys(all, "p9").map(([k]) => k)).toEqual(["seasonAdded"]);
  });

  it("words a change of percentage, dates, name and on/off, newest first", () => {
    const rows = [
      ...created,
      row(t2, "update", { adjust_bp: -1500 }, { adjust_bp: -2000 }),
      row(
        t3,
        "update",
        { name: "Green season", ends_on: "2027-10-31", active: false },
        { name: "Low season", ends_on: "2027-09-30", active: true },
      ),
    ];
    expect(keys(rows, "p1")).toEqual([
      [
        "seasonRenamed",
        { from: { text: "Low season" }, to: { text: "Green season" } },
      ],
      [
        "seasonDatesChanged",
        {
          name: { text: "Green season" },
          from: {
            dates: {
              startsOn: "2027-04-01",
              endsOn: "2027-09-30",
              yearly: true,
            },
          },
          to: {
            dates: {
              startsOn: "2027-04-01",
              endsOn: "2027-10-31",
              yearly: true,
            },
          },
        },
      ],
      ["seasonOff", { name: { text: "Green season" } }],
      [
        "seasonChanged",
        {
          name: { text: "Low season" },
          from: { adjust: -2000 },
          to: { adjust: -1500 },
        },
      ],
      expect.arrayContaining(["seasonAdded"]),
    ]);
  });

  it("says removed when a product is taken off, added when one is put on", () => {
    const rows = [
      ...created,
      row(t2, "price_rule_change", { products: ["p2"] }, { products: ["p1"] }),
    ];
    expect(keys(rows, "p1").map(([k]) => k)).toEqual([
      "seasonRemoved",
      "seasonAdded",
    ]);
    expect(keys(rows, "p2").map(([k]) => k)).toEqual(["seasonAdded"]);
  });

  it("reads one save as one change: all products to chosen ones keeps a chosen product quiet", () => {
    const rows = [
      row(t1, "insert", { ...low, all_products: true }),
      row(t2, "update", { all_products: false }, { all_products: true }),
      row(t2, "price_rule_change", { products: ["p1"] }, { products: [] }),
    ];
    expect(keys(rows, "p1").map(([k]) => k)).toEqual(["seasonAdded"]);
    expect(keys(rows, "p2").map(([k]) => k)).toEqual([
      "seasonRemoved",
      "seasonAdded",
    ]);
  });

  it("says removed when a season is deleted", () => {
    const rows = [...created, row(t2, "delete", null, low)];
    expect(keys(rows, "p1")[0]).toEqual([
      "seasonRemoved",
      { name: { text: "Low season" } },
    ]);
  });

  it("keeps two seasons apart and ignores other entities", () => {
    const rows = [
      ...created,
      row(
        t2,
        "insert",
        { ...low, id: "r2", name: "High", adjust_bp: 1000, all_products: true },
        null,
        "r2",
      ),
      { ...row(t3, "update", { name: "x" }), entity: "price_templates" },
    ];
    expect(
      keys(rows, "p1").map(([k, a]) => [
        k,
        (a as { name: { text: string } }).name.text,
      ]),
    ).toEqual([
      ["seasonAdded", "High"],
      ["seasonAdded", "Low season"],
    ]);
  });
});
