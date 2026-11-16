import { describe, expect, it } from "vitest";
import {
  bookingActions,
  bookingRoles,
  canBooking,
} from "./booking-permissions";
import { roles } from "./roles";

describe("who may do what with bookings", () => {
  it("everyone in the shop reads; owners, managers and staff book, confirm, cancel and re-assign", () => {
    expect(bookingRoles("read")).toEqual(roles);
    expect([...bookingActions].sort()).toEqual([
      "assign",
      "cancel",
      "confirm",
      "read",
      "reserve",
      "rules",
    ]);
    for (const action of ["reserve", "cancel", "confirm", "assign"] as const) {
      expect(bookingRoles(action), action).toEqual([
        "owner",
        "manager",
        "staff",
      ]);
    }
  });

  it("only owners and managers set the booking rules", () => {
    expect(bookingRoles("rules")).toEqual(["owner", "manager"]);
    expect(canBooking("staff", "rules")).toBe(false);
  });

  it("canBooking answers from the same table", () => {
    for (const action of bookingActions) {
      for (const role of roles) {
        expect(canBooking(role, action), `${role} ${action}`).toBe(
          bookingRoles(action).includes(role),
        );
      }
    }
    expect(canBooking("mechanic", "reserve")).toBe(false);
    expect(canBooking("driver", "cancel")).toBe(false);
    expect(canBooking("driver", "read")).toBe(true);
  });
});
