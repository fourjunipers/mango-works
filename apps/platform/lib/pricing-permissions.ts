import type { Role } from "./roles";

/**
 * Who may do what with prices (docs/products-redesign.md §9.2, decision 12):
 * owners, managers and staff see them; owners and managers change them;
 * mechanics and drivers see none.
 *
 * The one place in the app: every screen and every server action asks
 * canPricing(). It mirrors platform_private.pricing_roles() in the database,
 * which is the real rule (tests/db/product-pricing.test.ts holds the two
 * together). "See" is enforced by row-level security: for a mechanic the
 * database returns no pricing row at all, so nothing here hides a column.
 *
 * Today the answer depends on the role alone. When owners set their own
 * permissions, this table becomes the default and canPricing() reads the
 * shop's choices first; nothing that calls it has to change.
 */
export const pricingActions = ["read", "write"] as const;
export type PricingAction = (typeof pricingActions)[number];

const allowed: Record<PricingAction, readonly Role[]> = {
  /** See prices, price lists, tax, deposits and seasons. */
  read: ["owner", "manager", "staff"],
  /** Change any of them. */
  write: ["owner", "manager"],
};

export function pricingRoles(action: PricingAction): readonly Role[] {
  return allowed[action];
}

export function canPricing(role: Role, action: PricingAction): boolean {
  return allowed[action].includes(role);
}
