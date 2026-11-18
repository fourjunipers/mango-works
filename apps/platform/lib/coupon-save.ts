import { isTryAgain } from "./try-again";

/**
 * Saving a coupon through platform.save_coupon(), the only writer of
 * platform.coupons and its product links (docs/phase-2-plan.md §5.3, §6).
 *
 * The database is the judge of who may: it raises only_owner_or_manager
 * for anyone but an owner or a manager. It normalises the code itself
 * (the same rule as normalizeCouponCode in @mango/core) and refuses one
 * that is not A to Z and 0 to 9 after that.
 *
 * save_coupon() waits for the coupon's row behind a booking that is
 * counting its uses, and gives up after 6 seconds (55P03); a statement the
 * API ended while it waited is 57014. Both are answered here as
 * `try_again`, with nothing written (lib/try-again.ts). The screens are
 * stage 9; this is what they will call.
 */

/** A signed-in member's client on the platform schema. */
export type CouponSaveDb = {
  rpc(
    fn: "save_coupon",
    args: { p_tenant_id: string; p_coupon: unknown },
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

/**
 * What to change, by the database's names. Only what is named changes; a
 * new coupon (no `id`) needs a code and a kind with its number. Amounts
 * are minor units: a string of digits is safe at any size.
 */
export type CouponPayload = {
  id?: string;
  code?: string;
  name?: string;
  kind?: "percent" | "fixed";
  percent_bp?: number | null;
  amount?: string | number | null;
  all_products?: boolean;
  product_ids?: string[];
  valid_from?: string | null;
  valid_to?: string | null;
  pickup_from?: string | null;
  pickup_to?: string | null;
  min_days?: number | null;
  min_spend?: string | number | null;
  max_uses?: number | null;
  max_uses_per_customer?: number | null;
  channels?: ("staff" | "booking_page" | "marketplace")[];
  with_returning_discount?: boolean;
  with_season_discount?: boolean;
  active?: boolean;
  archived?: boolean;
};

/** The refusals a form can show beside a field or over the form. */
export const COUPON_SAVE_REASONS = [
  "only_owner_or_manager",
  "invalid_coupon",
  "invalid_code",
  "code_taken",
  "coupon_not_found",
  "product_not_found",
] as const;
export type CouponSaveReason =
  (typeof COUPON_SAVE_REASONS)[number] | "try_again";

export type SavedCoupon = Record<string, unknown> & {
  id: string;
  code: string;
};

export type CouponSaveAnswer =
  { ok: true; coupon: SavedCoupon } | { ok: false; reason: CouponSaveReason };

export async function saveCoupon(
  db: CouponSaveDb,
  tenantId: string,
  coupon: CouponPayload,
): Promise<CouponSaveAnswer> {
  const { data, error } = await db.rpc("save_coupon", {
    p_tenant_id: tenantId,
    p_coupon: coupon,
  });
  if (error) {
    // Nothing was written: the same save may be sent again.
    if (isTryAgain(error)) return { ok: false, reason: "try_again" };
    const reason = COUPON_SAVE_REASONS.find((each) => each === error.message);
    if (reason) return { ok: false, reason };
    throw Object.assign(new Error(error.message), { code: error.code });
  }
  return { ok: true, coupon: data as SavedCoupon };
}
