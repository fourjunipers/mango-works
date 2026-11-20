import { describe, expect, it } from "vitest";
import {
  bookingRulesErrorKey,
  readBookingRulesForm,
  ruleField,
  ruleText,
} from "./booking-rules";

const loc = "10000000-0000-4000-8000-000000000001";
const bike = "20000000-0000-4000-8000-000000000001";
const read = {
  locations: [
    {
      id: loc,
      name: "Main",
      min_notice_hours: null,
      booking_cutoff_minutes: null,
      min_days_advance: null,
      min_days_walkin: null,
    },
  ],
  vehicles: [
    { id: bike, name: "Click 125", min_days_advance: null, min_days_walkin: null },
  ],
};

const form = (values: Record<string, string>) => (name: string) =>
  values[name] ?? "";

const filled = {
  hold_minutes: "15",
  allow_overbooking: "on",
  buffer_before_hours: "0.5",
  buffer_after_hours: "1",
  [ruleField.location(loc, "min_notice_hours")]: "24",
  [ruleField.location(loc, "booking_cutoff_minutes")]: "60",
  [ruleField.location(loc, "min_days_advance")]: "2",
  [ruleField.location(loc, "min_days_walkin")]: "1",
  [ruleField.vehicle(bike, "min_days_advance")]: "3",
  [ruleField.vehicle(bike, "min_days_walkin")]: "",
};

describe("Booking rules: the form read into save_booking_rules()' payload", () => {
  it("reads every box", () => {
    expect(readBookingRulesForm(form(filled), read)).toEqual({
      ok: true,
      payload: {
        shop: {
          allow_overbooking: true,
          hold_minutes: 15,
          buffer_before_minutes: 30,
          buffer_after_minutes: 60,
        },
        locations: [
          {
            id: loc,
            min_notice_hours: 24,
            booking_cutoff_minutes: 60,
            min_days_advance: 2,
            min_days_walkin: 1,
          },
        ],
        products: [{ id: bike, min_days_advance: 3, min_days_walkin: null }],
      },
    });
  });

  it("blank is no rule of its own (null), and overbooking unticked is off", () => {
    const answer = readBookingRulesForm(form({ hold_minutes: "60" }), read);
    expect(answer).toEqual({
      ok: true,
      payload: {
        shop: {
          allow_overbooking: false,
          hold_minutes: 60,
          buffer_before_minutes: null,
          buffer_after_minutes: null,
        },
        locations: [
          {
            id: loc,
            min_notice_hours: null,
            booking_cutoff_minutes: null,
            min_days_advance: null,
            min_days_walkin: null,
          },
        ],
        products: [{ id: bike, min_days_advance: null, min_days_walkin: null }],
      },
    });
  });

  it("each box at its edges, as the database's ranges", () => {
    const at = (name: string, text: string) =>
      readBookingRulesForm(form({ ...filled, [name]: text }), read);
    const cases: [string, string, boolean][] = [
      ["hold_minutes", "5", true],
      ["hold_minutes", "60", true],
      ["hold_minutes", "4", false],
      ["hold_minutes", "61", false],
      ["hold_minutes", "", false],
      ["buffer_before_hours", "168", true],
      ["buffer_before_hours", "168.01", false],
      ["buffer_before_hours", "0,5", false],
      [ruleField.location(loc, "min_notice_hours"), "0", true],
      [ruleField.location(loc, "min_notice_hours"), "720", true],
      [ruleField.location(loc, "min_notice_hours"), "721", false],
      [ruleField.location(loc, "min_notice_hours"), "1.5", false],
      [ruleField.location(loc, "booking_cutoff_minutes"), "1,440", true],
      [ruleField.location(loc, "booking_cutoff_minutes"), "1441", false],
      [ruleField.location(loc, "min_days_advance"), "0", false],
      [ruleField.location(loc, "min_days_walkin"), "365", true],
      [ruleField.vehicle(bike, "min_days_advance"), "366", false],
      [ruleField.vehicle(bike, "min_days_walkin"), "-1", false],
    ];
    for (const [name, text, ok] of cases)
      expect(at(name, text).ok, `${name} ${JSON.stringify(text)}`).toBe(ok);
  });

  it("names each wrong box with its own words", () => {
    const answer = readBookingRulesForm(
      form({
        ...filled,
        hold_minutes: "90",
        buffer_after_hours: "abc",
        [ruleField.location(loc, "min_notice_hours")]: "1000",
        [ruleField.location(loc, "booking_cutoff_minutes")]: "2000",
        [ruleField.vehicle(bike, "min_days_walkin")]: "0",
      }),
      read,
    );
    expect(answer).toEqual({
      ok: false,
      errors: {
        hold_minutes: "bookingRulesHold",
        buffer_after_hours: "invalidHours",
        [ruleField.location(loc, "min_notice_hours")]: "bookingRulesNotice",
        [ruleField.location(loc, "booking_cutoff_minutes")]:
          "bookingRulesCutoff",
        [ruleField.vehicle(bike, "min_days_walkin")]: "bookingRulesMinDays",
      },
    });
  });

  it("reads only the locations and vehicles of the page, never ids the browser added", () => {
    const stranger = "30000000-0000-4000-8000-000000000009";
    const answer = readBookingRulesForm(
      form({ ...filled, [ruleField.vehicle(stranger, "min_days_advance")]: "9" }),
      read,
    );
    expect(answer.ok && answer.payload.products.map((p) => p.id)).toEqual([
      bike,
    ]);
  });

  it("shows stored values: blank for none, buffers in hours", () => {
    expect(ruleText.whole(null)).toBe("");
    expect(ruleText.whole(24)).toBe("24");
    expect(ruleText.hours(null)).toBe("");
    expect(ruleText.hours(90)).toBe("1.5");
  });

  it("answers every refusal of save_booking_rules() in words", () => {
    expect(bookingRulesErrorKey({ message: "only_owner_or_manager" })).toBe(
      "bookingRulesOwnerOrManager",
    );
    expect(bookingRulesErrorKey({ message: "invalid_rules" })).toBe(
      "bookingRulesInvalid",
    );
    expect(bookingRulesErrorKey({ message: "location_not_found" })).toBe(
      "location_not_found",
    );
    expect(bookingRulesErrorKey({ message: "product_not_found" })).toBe(
      "bookingRulesVehicleGone",
    );
    expect(bookingRulesErrorKey({ message: "not_a_vehicle" })).toBe(
      "bookingRulesVehicleGone",
    );
    expect(bookingRulesErrorKey({ message: "anything else" })).toBe(
      "saveFailed",
    );
  });
});
