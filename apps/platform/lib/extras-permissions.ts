import type { Role } from "./roles";

/**
 * Who may do what with the gear and services offered with a vehicle
 * (docs/phase-2-plan.md §6): everyone in a shop sees which extras go with a
 * vehicle (the list holds no amount; a mechanic preparing a bike should
 * know two helmets go with it); owners and managers change it.
 *
 * It mirrors platform_private.extras_roles() in the database, which is the
 * real rule (tests/db/product-extras.test.ts holds the two together).
 */
export const extrasActions = ["read", "write"] as const;
export type ExtrasAction = (typeof extrasActions)[number];

const allowed: Record<ExtrasAction, readonly Role[]> = {
  /** See which extras go with a vehicle, and how many come free. */
  read: ["owner", "manager", "staff", "mechanic", "driver"],
  /** Change a vehicle's extras, or the ones offered with every vehicle. */
  write: ["owner", "manager"],
};

export function extrasRoles(action: ExtrasAction): readonly Role[] {
  return allowed[action];
}

export function canExtras(role: Role, action: ExtrasAction): boolean {
  return allowed[action].includes(role);
}
