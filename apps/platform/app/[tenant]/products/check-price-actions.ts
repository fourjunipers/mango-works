"use server";

import { readCoupon, type CouponDb, type CouponInputs } from "@/lib/coupons";
import { canPricing } from "@/lib/pricing-permissions";
import { requireMembership } from "@/lib/session";
import { createClient } from "@mango/db/platform-server";

/**
 * "Check a price" with a coupon code (Phase 2 stage 9): the one read,
 * platform.coupon_inputs() through lib/coupons.ts' readCoupon(), the same
 * read both booking paths make. It is a read and nothing else: nothing is
 * reserved and no use is counted. The screen then judges the code with
 * decideDiscounts() (lib/pricing-preview.ts' checkPrice()).
 *
 * Owners, managers and staff (pricing_roles('read')); the database's RLS
 * says the same, so anyone else would find no coupon either way.
 */
export async function lookUpCoupon(
  slug: string,
  code: string,
): Promise<{ ok: true; read: CouponInputs } | { ok: false }> {
  const { membership } = await requireMembership(slug);
  if (!canPricing(membership.role, "read")) return { ok: false };
  try {
    const read = await readCoupon(
      (await createClient()) as unknown as CouponDb,
      membership.tenant.id,
      String(code).slice(0, 200),
    );
    return { ok: true, read };
  } catch {
    return { ok: false };
  }
}
