import "server-only";
import { createClient } from "@mango/db/platform-server";
import type { CouponRecord } from "./coupon-form";
import { readCoupon, type CouponDb } from "./coupons";
import { exactAuditRows, type AuditRow } from "./history";

/**
 * Reads for Settings › Coupons (Phase 2 stage 9). Everything runs as the
 * signed-in member, so row-level security decides: owners, managers and
 * staff read coupons (the page itself is for owners and managers). Nothing
 * here writes: platform.save_coupon() is the only writer.
 *
 * Amounts are cast to text in the query, as coupon_inputs() sends them.
 */

const couponColumns =
  "id, code, name, currency, kind, percent_bp, amount::text, all_products, valid_from, valid_to, pickup_from, pickup_to, min_days, min_spend::text, max_uses, channels, with_returning_discount, with_season_discount, active, archived_at, coupon_products(product_id)";

type Read = Omit<CouponRecord, "product_ids"> & {
  coupon_products: { product_id: string }[];
};

const record = (row: Read): CouponRecord => {
  const { coupon_products, ...rest } = row;
  return {
    ...rest,
    product_ids: coupon_products.map((l) => l.product_id).sort(),
  };
};

/** The shop's coupons: live ones by code, then the archived, newest first. */
export async function getCoupons(tenantId: string): Promise<CouponRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coupons")
    .select(couponColumns)
    .eq("tenant_id", tenantId)
    .order("code")
    .limit(1000);
  if (error) throw error;
  const rows = (data as unknown as Read[]).map(record);
  const live = rows.filter((r) => r.archived_at === null);
  const archived = rows
    .filter((r) => r.archived_at !== null)
    .sort((a, b) => b.archived_at!.localeCompare(a.archived_at!));
  return [...live, ...archived];
}

export async function getCoupon(
  tenantId: string,
  id: string,
): Promise<CouponRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coupons")
    .select(couponColumns)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? record(data as unknown as Read) : null;
}

/**
 * Each coupon's uses, from coupon_inputs().uses.total: the database's own
 * count, which leaves out a hold that has run out and not been swept. Never
 * a count of coupon_redemptions here, which would include those.
 *
 * coupon_inputs() looks a coupon up by its code (the live one first, else
 * the one archived last). An archived coupon whose code a newer coupon has
 * taken can't be reached that way, so its uses are not known here (null):
 * the list says so rather than show the newer coupon's count.
 */
export async function getCouponUses(
  tenantId: string,
  coupons: readonly Pick<CouponRecord, "id" | "code">[],
): Promise<Map<string, number | null>> {
  const supabase = (await createClient()) as unknown as CouponDb;
  const answers = await Promise.all(
    coupons.map(async (c) => {
      const read = await readCoupon(supabase, tenantId, c.code);
      return [
        c.id,
        read.coupon?.id === c.id ? (read.uses?.total ?? 0) : null,
      ] as const;
    }),
  );
  return new Map(answers);
}

/** The live coupon that has this code (stored form), for "code_taken". */
export async function getLiveCouponByCode(
  tenantId: string,
  code: string,
): Promise<{ id: string; code: string; name: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coupons")
    .select("id, code, name")
    .eq("tenant_id", tenantId)
    .eq("code", code)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Products a coupon can be for, with their type, for the form and History. */
export async function getCouponProducts(
  tenantId: string,
): Promise<{ id: string; name: string; type: string; retired: boolean }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, type, retired_at")
    .eq("tenant_id", tenantId)
    .order("name");
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    retired: p.retired_at !== null,
  }));
}

const auditColumns =
  "id, entity, entity_id, action, actor, before::text, after::text, at";

/**
 * The audit rows of the shop's coupons (owners and managers, by RLS), or of
 * one coupon: the row events and the `coupon_change` events of its product
 * links. The newest 2,000, read newest first so a long history keeps its
 * latest changes (review of PR 50); lib/coupon-history.ts sorts and replays
 * them. A coupon whose "created" row is older than those is named by its
 * code now.
 */
export async function getCouponAudit(
  tenantId: string,
  couponId?: string,
): Promise<AuditRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("audit_events")
    .select(auditColumns)
    .eq("tenant_id", tenantId)
    .eq("entity", "coupons");
  if (couponId) query = query.eq("entity_id", couponId);
  const { data, error } = await query
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return exactAuditRows(data);
}
