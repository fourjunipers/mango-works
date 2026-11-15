import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import th from "../messages/th.json";
import {
  changedSettings,
  countProblems,
  listingSettingsSchema,
  typedCount,
} from "./listing-settings";

const parse = (values: Record<string, string | undefined>) =>
  listingSettingsSchema.safeParse(values);

describe("the Moto Mangos tab's listing settings", () => {
  it("takes whole counts, empty as 0, and a lead time of 0 to 720 hours, empty as none", () => {
    expect(
      parse({
        instant_units: "2",
        request_units: "",
        ready_now: "1",
        lead_time_hours: "",
      }).data,
    ).toEqual({
      instant_units: 2,
      request_units: 0,
      ready_now: 1,
      lead_time_hours: null,
    });
    expect(
      parse({
        instant_units: "0",
        request_units: "0",
        ready_now: "0",
        lead_time_hours: "720",
      }).data?.lead_time_hours,
    ).toBe(720);
    expect(
      parse({
        instant_units: "0",
        request_units: "0",
        ready_now: "0",
        lead_time_hours: "0",
      }).data?.lead_time_hours,
    ).toBe(0);
    for (const bad of ["721", "-1", "1.5", "a day"]) {
      const result = parse({
        instant_units: "0",
        request_units: "0",
        ready_now: "0",
        lead_time_hours: bad,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe("leadTimeRange");
    }
    expect(
      parse({
        instant_units: "-1",
        request_units: "0",
        ready_now: "0",
        lead_time_hours: "",
      }).success,
    ).toBe(false);
  });

  it("sends only what changed from what the page showed", () => {
    const was = {
      instant_units: 1,
      request_units: 2,
      ready_now: 0,
      lead_time_hours: 12,
    };
    expect(changedSettings(was, was)).toEqual({});
    expect(
      changedSettings(was, { ...was, instant_units: 3, lead_time_hours: null }),
    ).toEqual({ instant_units: 3, lead_time_hours: null });
  });

  it("says which count is above the active vehicles", () => {
    const counts = { instant_units: 3, request_units: 2, ready_now: 5 };
    expect(countProblems(counts, 5)).toEqual([]);
    expect(countProblems(counts, 4)).toEqual([
      "more_units_than_active",
      "more_walk_ins_than_active",
    ]);
    expect(countProblems({ ...counts, ready_now: 1 }, 4)).toEqual([
      "more_units_than_active",
    ]);
    expect(
      countProblems({ instant_units: 0, request_units: 0, ready_now: 2 }, 1),
    ).toEqual(["more_walk_ins_than_active"]);
  });

  it("reads a typed count for the live line: empty is 0, anything else not a count is null", () => {
    expect(typedCount("")).toBe(0);
    expect(typedCount(" 3 ")).toBe(3);
    expect(typedCount("-1")).toBeNull();
    expect(typedCount("two")).toBeNull();
  });

  it("has the owner's words, in English and Thai", () => {
    expect(en.FormErrors.more_units_than_active).toBe(
      "Total units listed on Moto Mangos can not exceed the number of units in your inventory",
    );
    expect(en.FormErrors.more_walk_ins_than_active).toBe(
      "Walk-ins can not exceed the number of units in your inventory",
    );
    expect(en.Fleet.motoMangos.useChosen).toBe("Connect");
    expect(en.Fleet.motoMangos.selectFromList).toBe(
      "Select your make and model from the list",
    );
    expect(th.FormErrors.more_walk_ins_than_active).toBeTruthy();
    expect(th.Fleet.motoMangos.leadTime).toBeTruthy();
  });
});
