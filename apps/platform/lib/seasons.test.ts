import { describe, expect, it } from "vitest";
import {
  emptySeasonDraft,
  parsePercentBp,
  percentInput,
  percentLabel,
  seasonCovers,
  seasonDates,
  seasonDraft,
  seasonPayload,
  type SeasonDraft,
} from "./seasons";

const low: SeasonDraft = {
  ...emptySeasonDraft(),
  name: " Low season ",
  startsOn: "2027-04-01",
  endsOn: "2027-09-30",
  percent: "20",
};

describe("parsePercentBp", () => {
  it("reads whole and decimal percentages as basis points", () => {
    expect(parsePercentBp("20")).toBe(2000);
    expect(parsePercentBp("12.5")).toBe(1250);
    expect(parsePercentBp("12,5")).toBe(1250);
    expect(parsePercentBp("0.01 %")).toBe(1);
    expect(parsePercentBp("")).toBeNull();
  });
  it("refuses a sign, three decimals or text", () => {
    expect(parsePercentBp("-20")).toBe("invalid");
    expect(parsePercentBp("1.234")).toBe("invalid");
    expect(parsePercentBp("abc")).toBe("invalid");
  });
  it("turns back into what is typed", () => {
    expect(percentInput(1250)).toBe("12.5");
    expect(percentInput(-2000)).toBe("20");
    expect(percentInput(1)).toBe("0.01");
    expect(percentLabel(-2000, "en")).toBe("20%");
  });
});

describe("seasonPayload", () => {
  it("sends a decrease as negative basis points, name trimmed", () => {
    const result = seasonPayload(low);
    expect(result).toEqual({
      ok: true,
      payload: {
        name: "Low season",
        starts_on: "2027-04-01",
        ends_on: "2027-09-30",
        repeats_yearly: true,
        adjust_bp: -2000,
        all_products: true,
        active: true,
        product_ids: [],
      },
    });
  });
  it("sends an increase and the chosen products once each", () => {
    const result = seasonPayload(
      {
        ...low,
        direction: "increase",
        percent: "10",
        allProducts: false,
        productIds: ["b", "a", "b"],
      },
      "rule-1",
    );
    expect(result.ok && result.payload).toMatchObject({
      id: "rule-1",
      adjust_bp: 1000,
      product_ids: ["b", "a"],
    });
  });
  it("names what is wrong", () => {
    const bad = seasonPayload({
      ...low,
      name: "",
      startsOn: "2027-02-30",
      percent: "0",
      allProducts: false,
    });
    expect(bad).toEqual({
      ok: false,
      errors: {
        name: "required",
        startsOn: "invalidDate",
        percent: "percentZero",
        products: "seasonNoProducts",
      },
    });
  });
  it("lets a yearly season wrap the new year, not a one-year one", () => {
    const wrap = { ...low, startsOn: "2026-12-15", endsOn: "2026-01-15" };
    expect(seasonPayload(wrap).ok).toBe(true);
    expect(seasonPayload({ ...wrap, repeatsYearly: false })).toMatchObject({
      ok: false,
      errors: { endsOn: "seasonEndsBeforeStart" },
    });
  });
  it("keeps a decrease under 100% and an increase to 1,000%", () => {
    expect(seasonPayload({ ...low, percent: "99.99" }).ok).toBe(true);
    expect(seasonPayload({ ...low, percent: "100" })).toMatchObject({
      errors: { percent: "decreaseTooLarge" },
    });
    const up = { ...low, direction: "increase" as const };
    expect(seasonPayload({ ...up, percent: "1000" }).ok).toBe(true);
    expect(seasonPayload({ ...up, percent: "1000.01" })).toMatchObject({
      errors: { percent: "increaseTooLarge" },
    });
  });
});

describe("seasonDraft and seasonDates", () => {
  const row = {
    id: "r",
    name: "Low season",
    starts_on: "2027-04-01",
    ends_on: "2027-09-30",
    repeats_yearly: false,
    adjust_bp: -1250,
    all_products: false,
    active: true,
    product_ids: ["p1"],
  };
  it("reads a saved season back into the form", () => {
    expect(seasonDraft(row)).toMatchObject({
      direction: "decrease",
      percent: "12.5",
      productIds: ["p1"],
    });
    expect(seasonPayload(seasonDraft(row), "r")).toMatchObject({
      ok: true,
      payload: { adjust_bp: -1250 },
    });
  });
  it("shows the dates in the viewer's format, without the year when yearly", () => {
    expect(seasonDates(row.starts_on, row.ends_on, false, "en-GB")).toEqual({
      from: "1 Apr 2027",
      to: "30 Sept 2027",
    });
    expect(seasonDates(row.starts_on, row.ends_on, true, "en-GB")).toEqual({
      from: "1 Apr",
      to: "30 Sept",
    });
  });
  it("knows which products a season covers", () => {
    expect(seasonCovers(row, "p1")).toBe(true);
    expect(seasonCovers(row, "p2")).toBe(false);
    expect(seasonCovers({ ...row, all_products: true }, "p2")).toBe(true);
  });
});
