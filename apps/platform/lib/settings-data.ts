import "server-only";
import { createClient } from "@mango/db/platform-server";
import type { SeasonRow } from "./seasons";

/**
 * Reads for Settings › Pricing and tax and Settings › Seasons (stage D6).
 * They run as the signed-in person, so row-level security decides; the
 * pages themselves are for owners and managers. The shop's settings are
 * read through pricing_inputs() (lib/pricing-data.ts), amounts as strings of
 * digits; what is read here holds no money (names, rates in basis points,
 * dates, which products). Nothing here writes.
 */

export type ProductRef = { id: string; name: string; retired: boolean };

export type TaxProfileUse = {
  id: string;
  name: string;
  rate_bp: number;
  archived: boolean;
  /** Products whose pricing names this profile, retired ones included. */
  products: ProductRef[];
};

/** Names of these products, A to Z, retired ones marked. */
async function productRefs(
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, ProductRef>> {
  const refs = new Map<string, ProductRef>();
  if (ids.length === 0) return refs;
  const supabase = await createClient();
  // In slices, so a long list never makes an address too long.
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, retired_at")
      .eq("tenant_id", tenantId)
      .in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const p of data)
      refs.set(p.id, { id: p.id, name: p.name, retired: p.retired_at !== null });
  }
  return refs;
}

const byName = (a: ProductRef, b: ProductRef) => a.name.localeCompare(b.name);

/**
 * Products whose pricing names a tax profile, retired ones included: what
 * stops it being archived (tax_profile_in_use).
 */
export async function productsUsingProfile(
  tenantId: string,
  profileId: string,
): Promise<ProductRef[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_pricing")
    .select("product_id")
    .eq("tenant_id", tenantId)
    .eq("tax_profile_id", profileId);
  if (error) throw error;
  const refs = await productRefs(
    tenantId,
    data.map((r) => r.product_id),
  );
  return [...refs.values()].sort(byName);
}

/** Every tax profile of the shop, archived ones too, with the products on each. */
export async function getTaxProfileUses(
  tenantId: string,
): Promise<TaxProfileUse[]> {
  const supabase = await createClient();
  const [profiles, uses] = await Promise.all([
    supabase
      .from("tax_profiles")
      .select("id, name, rate_bp, archived_at")
      .eq("tenant_id", tenantId)
      .order("name"),
    supabase
      .from("product_pricing")
      .select("product_id, tax_profile_id")
      .eq("tenant_id", tenantId)
      .not("tax_profile_id", "is", null),
  ]);
  if (profiles.error) throw profiles.error;
  if (uses.error) throw uses.error;
  const refs = await productRefs(
    tenantId,
    uses.data.map((u) => u.product_id),
  );
  return profiles.data.map((p) => ({
    id: p.id,
    name: p.name,
    rate_bp: p.rate_bp,
    archived: p.archived_at !== null,
    products: uses.data
      .filter((u) => u.tax_profile_id === p.id)
      .flatMap((u) => refs.get(u.product_id) ?? [])
      .sort(byName),
  }));
}

/** The shop's seasons, by first day, with the products each names. */
export async function getSeasons(tenantId: string): Promise<SeasonRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("price_rules")
    .select(
      "id, name, starts_on, ends_on, repeats_yearly, adjust_bp, all_products, active, price_rule_products(product_id)",
    )
    .eq("tenant_id", tenantId)
    .order("starts_on")
    .order("name");
  if (error) throw error;
  return data.map(({ price_rule_products, ...row }) => ({
    ...row,
    product_ids: price_rule_products.map((l) => l.product_id),
  }));
}

/** One season, or null. */
export async function getSeason(
  tenantId: string,
  id: string,
): Promise<SeasonRow | null> {
  return (await getSeasons(tenantId)).find((s) => s.id === id) ?? null;
}

/** Products a season can name: every product of the shop, A to Z. */
export async function getSeasonProducts(
  tenantId: string,
): Promise<(ProductRef & { type: string })[]> {
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
