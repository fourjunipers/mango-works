import type { Role } from "./roles";

/**
 * Who may do what with bookings (docs/phase-2-plan.md §6): everyone in a
 * shop sees reservations (dates, product, units; no money); owners, managers
 * and staff make, confirm, cancel and re-assign them.
 *
 * The one place in the app: every screen and every server action asks
 * canBooking(). It mirrors platform_private.booking_roles() in the database,
 * which is the real rule (tests/db/reservations.test.ts holds the two
 * together). Online channels are not a role: the server books for them with
 * the service role, never a signed-in member.
 *
 * Today the answer depends on the role alone. When owners set their own
 * permissions, this table becomes the default and canBooking() reads the
 * shop's choices first; nothing that calls it has to change.
 */
export const bookingActions = [
  "read",
  "reserve",
  "cancel",
  "confirm",
  "assign",
] as const;
export type BookingAction = (typeof bookingActions)[number];

const allowed: Record<BookingAction, readonly Role[]> = {
  /** See reservations and the blocks they hold. */
  read: ["owner", "manager", "staff", "mechanic", "driver"],
  /** Make a reservation, naming the units or not. */
  reserve: ["owner", "manager", "staff"],
  /** Cancel a reservation. */
  cancel: ["owner", "manager", "staff"],
  /** Turn a hold made at the counter or on the phone into a reservation. */
  confirm: ["owner", "manager", "staff"],
  /** Name a reservation's units, move it to other units, fill a shortage. */
  assign: ["owner", "manager", "staff"],
};

export function bookingRoles(action: BookingAction): readonly Role[] {
  return allowed[action];
}

export function canBooking(role: Role, action: BookingAction): boolean {
  return allowed[action].includes(role);
}
