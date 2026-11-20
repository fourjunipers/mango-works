import { hoursToMinutes, minutesToHours } from "./fleet";
import { parseWholeInRange } from "./number-input";

/**
 * Settings › Booking rules (Phase 2 stage 11; docs/phase-2-plan.md §7):
 * what the form sends, read into the one payload platform.save_booking_rules()
 * takes, and its refusals in words. Pure: the database call is the caller's
 * (lib/booking-rules-save.ts).
 *
 * The ranges are the database's own (20261116000300): hold 5 to 60 minutes;
 * buffers up to a week; notice 0 to 720 hours; the cut-off 0 to 1,440
 * minutes before closing; minimum days 1 to 365. Blank means "no rule of its
 * own": for a location, none; for a vehicle, its location's rule; for the
 * shop's buffers, none. The hold length can't be blank.
 *
 * Numbers are read by the platform's one number rule (lib/number-input.ts).
 * Buffers are typed in hours, to the minute, as a product's own are
 * (hoursToMinutes in lib/fleet.ts).
 */

/** The shop's rules, as stored on platform.tenants. */
export type ShopRules = {
  allow_overbooking: boolean;
  hold_minutes: number;
  buffer_before_minutes: number | null;
  buffer_after_minutes: number | null;
};

/** A location's rules, as stored on platform.locations. */
export type LocationRules = {
  id: string;
  name: string;
  min_notice_hours: number | null;
  booking_cutoff_minutes: number | null;
  min_days_advance: number | null;
  min_days_walkin: number | null;
};

/** A vehicle product's own minimum days, as stored on platform.products. */
export type VehicleRules = {
  id: string;
  name: string;
  min_days_advance: number | null;
  min_days_walkin: number | null;
};

export type BookingRulesRead = {
  shop: ShopRules;
  locations: LocationRules[];
  vehicles: VehicleRules[];
};

/** The payload of save_booking_rules(p_rules). */
export type BookingRulesPayload = {
  shop: ShopRules;
  locations: Omit<LocationRules, "name">[];
  products: Omit<VehicleRules, "name">[];
};

/** A box's name in the form: one per rule, per location, per vehicle. */
export const ruleField = {
  location: (id: string, rule: keyof Omit<LocationRules, "id" | "name">) =>
    `location-${id}-${rule}`,
  vehicle: (id: string, rule: keyof Omit<VehicleRules, "id" | "name">) =>
    `vehicle-${id}-${rule}`,
};

/** What a box shows: the stored value, or blank. */
export const ruleText = {
  whole: (value: number | null) => (value === null ? "" : String(value)),
  hours: minutesToHours,
};

type Get = (name: string) => string;

/**
 * The form as sent, read against the rows it was drawn from (the ids come
 * from the page, never from the browser alone; the database checks them
 * again). Errors are keys of "FormErrors", by box name.
 */
export function readBookingRulesForm(
  get: Get,
  read: Pick<BookingRulesRead, "locations" | "vehicles">,
):
  | { ok: true; payload: BookingRulesPayload }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const whole = (
    name: string,
    min: number,
    max: number,
    key: string,
  ): number | null => {
    const value = parseWholeInRange(get(name), min, max);
    if (value === "invalid") {
      errors[name] = key;
      return null;
    }
    return value;
  };
  const hours = (name: string): number | null => {
    const value = hoursToMinutes(get(name));
    if (value === "invalid") {
      errors[name] = "invalidHours";
      return null;
    }
    return value;
  };

  const hold = whole("hold_minutes", 5, 60, "bookingRulesHold");
  if (hold === null && !errors.hold_minutes)
    errors.hold_minutes = "bookingRulesHold";
  const shop: ShopRules = {
    allow_overbooking: get("allow_overbooking") === "on",
    hold_minutes: hold ?? 15,
    buffer_before_minutes: hours("buffer_before_hours"),
    buffer_after_minutes: hours("buffer_after_hours"),
  };

  const locations = read.locations.map((location) => {
    const f = (rule: keyof Omit<LocationRules, "id" | "name">) =>
      ruleField.location(location.id, rule);
    return {
      id: location.id,
      min_notice_hours: whole(
        f("min_notice_hours"),
        0,
        720,
        "bookingRulesNotice",
      ),
      booking_cutoff_minutes: whole(
        f("booking_cutoff_minutes"),
        0,
        1440,
        "bookingRulesCutoff",
      ),
      min_days_advance: whole(
        f("min_days_advance"),
        1,
        365,
        "bookingRulesMinDays",
      ),
      min_days_walkin: whole(
        f("min_days_walkin"),
        1,
        365,
        "bookingRulesMinDays",
      ),
    };
  });

  const products = read.vehicles.map((vehicle) => {
    const f = (rule: keyof Omit<VehicleRules, "id" | "name">) =>
      ruleField.vehicle(vehicle.id, rule);
    return {
      id: vehicle.id,
      min_days_advance: whole(
        f("min_days_advance"),
        1,
        365,
        "bookingRulesMinDays",
      ),
      min_days_walkin: whole(
        f("min_days_walkin"),
        1,
        365,
        "bookingRulesMinDays",
      ),
    };
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, payload: { shop, locations, products } };
}

/**
 * save_booking_rules()' refusals, as "FormErrors" keys for the whole form.
 * It raises only_owner_or_manager, invalid_rules, location_not_found,
 * product_not_found and not_a_vehicle; anything else is "Couldn't save".
 */
export function bookingRulesErrorKey(error: { message?: string }): string {
  switch (error.message) {
    case "only_owner_or_manager":
      return "bookingRulesOwnerOrManager";
    case "invalid_rules":
      return "bookingRulesInvalid";
    case "location_not_found":
      return "location_not_found";
    case "product_not_found":
    case "not_a_vehicle":
      return "bookingRulesVehicleGone";
    default:
      return "saveFailed";
  }
}
