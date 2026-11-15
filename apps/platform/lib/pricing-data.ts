import "server-only";
import { createClient } from "@mango/db/platform-server";
import type { AuditRow } from "./history";
import type { ListKind, ProductType, SavedList } from "./pricing-form";
import type { PricingInputs } from "./pricing-inputs";
import type { SharedList, TaxProfile } from "./pricing-preview";
import type { DaySource } from "@mango/core/price-list";

/**
 * Reads for the Pricing tab, the price lists screen and the Products list's
 * price column (docs/products-redesign.md §9.12). Everything runs as the
 * signed-in person, so row-level security decides: owners, managers and
 * staff read prices; a mechanic or a driver gets no row at all.
 *
 * Prices come from platform.pricing_inputs(), the one read that feeds
 * quote(). The editor also needs a few things that read doesn't carry (how
 * each day of a list got its value, which tax choice a product has, the
 * shop's lists and tax profiles): those are read from the tables directly,
 * which the same row-level security guards. Nothing here writes.
 *
 * Amounts read from a table are cast to text in the query (`value::text`),
 * as pricing_inputs() sends them: a string of digits, never a JSON number,
 * so nothing is lost at any size. A list's days are read with their list
 * (an embedded read), so the API's row limit can never drop a day.
 */

/** The rows quote() is fed for these products. */
export async function getPricingInputs(
  tenantId: string,
  productIds: string[],
): Promise<PricingInputs> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pricing_inputs", {
    p_tenant_id: tenantId,
    p_product_ids: productIds,
  });
  if (error) throw error;
  return data as unknown as PricingInputs;
}

export type ListSummary = SharedList & {
  /** How many products are priced from it. */
  products: { id: string; name: string }[];
  updated_at: string;
};

/** The shop's shared price lists, with their days and the products on each. */
export async function getSharedLists(tenantId: string): Promise<ListSummary[]> {
  const supabase = await createClient();
  const [lists, users] = await Promise.all([
    supabase
      .from("price_templates")
      .select(
        "id, name, kind, hourly::text, updated_at, price_template_days(day, value::text)",
      )
      .eq("tenant_id", tenantId)
      .is("product_id", null)
      .order("name"),
    supabase
      .from("product_pricing")
      .select("price_template_id, products!inner(id, name)")
      .eq("tenant_id", tenantId)
      .not("price_template_id", "is", null),
  ]);
  if (lists.error) throw lists.error;
  if (users.error) throw users.error;
  return lists.data.map((list) => ({
    id: list.id,
    name: list.name,
    kind: list.kind as ListKind,
    hourly: list.hourly,
    updated_at: list.updated_at,
    days: [...list.price_template_days]
      .sort((a, b) => a.day - b.day)
      .map((d) => d.value),
    products: users.data
      .filter((u) => u.price_template_id === list.id)
      .map((u) => {
        const product = u.products as unknown as { id: string; name: string };
        return { id: product.id, name: product.name };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/** One shared list with how each day got its value, for its editor. */
export async function getSharedList(tenantId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("price_templates")
    .select(
      "id, name, kind, hourly::text, price_template_days(day, value::text, source)",
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .is("product_id", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    kind: data.kind as ListKind,
    hourly: data.hourly,
    days: [...data.price_template_days]
      .sort((a, b) => a.day - b.day)
      .map((d) => ({
        day: d.day,
        value: d.value,
        source: d.source as DaySource,
      })),
  };
}

/** The shop's tax profiles in use (not archived). */
export async function getTaxProfiles(tenantId: string): Promise<TaxProfile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tax_profiles")
    .select("id, name, rate_bp")
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .order("name");
  if (error) throw error;
  return data;
}

/** What the editor needs of one product beyond pricing_inputs(). */
export async function getProductPricingExtras(
  tenantId: string,
  productId: string,
): Promise<{
  type: ProductType;
  tax_profile_id: string | null;
  taxable: boolean;
  /** Its own list's days, with how each got its value. */
  ownDays: { day: number; value: string; source: DaySource }[];
  /** Its own list as it is saved. Null: it has none. */
  ownList: SavedList | null;
}> {
  const supabase = await createClient();
  const [pricing, own] = await Promise.all([
    supabase
      .from("product_pricing")
      .select("product_type, taxable, tax_profile_id")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .maybeSingle(),
    supabase
      .from("price_templates")
      .select("id, hourly::text, price_template_days(day, value::text, source)")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .maybeSingle(),
  ]);
  if (pricing.error) throw pricing.error;
  if (own.error) throw own.error;
  const ownDays = [...(own.data?.price_template_days ?? [])]
    .sort((a, b) => a.day - b.day)
    .map((d) => ({
      day: d.day,
      value: d.value,
      source: d.source as DaySource,
    }));
  return {
    type: (pricing.data?.product_type ?? "vehicle") as ProductType,
    taxable: pricing.data?.taxable ?? true,
    tax_profile_id: pricing.data?.tax_profile_id ?? null,
    ownDays,
    ownList: own.data ? { hourly: own.data.hourly, days: ownDays } : null,
  };
}

const auditColumns = "id, entity, entity_id, action, actor, before, after, at";

/**
 * The audit rows behind a product's price lines (owners and managers, by
 * the audit log's RLS): its own lists' rows, ever, and every change to a
 * shared list that named it. Its pricing row and pricing_change come with
 * the product's own rows (getProductHistory).
 */
export async function getPricingAudit(
  tenantId: string,
  productId: string,
  limit: number,
): Promise<AuditRow[]> {
  const supabase = await createClient();
  const [own, shared] = await Promise.all([
    supabase
      .from("audit_events")
      .select(auditColumns)
      .eq("tenant_id", tenantId)
      .eq("entity", "price_templates")
      .eq("action", "insert")
      .eq("after->>product_id", productId),
    supabase
      .from("audit_events")
      .select(auditColumns)
      .eq("tenant_id", tenantId)
      .eq("entity", "price_templates")
      .eq("action", "template_change")
      .filter("after->products", "cs", JSON.stringify([productId]))
      .order("at", { ascending: false })
      .limit(limit),
  ]);
  if (own.error) throw own.error;
  if (shared.error) throw shared.error;
  const ownIds = own.data.map((row) => row.entity_id);
  const ownRows =
    ownIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("audit_events")
          .select(auditColumns)
          .eq("tenant_id", tenantId)
          .eq("entity", "price_templates")
          .in("entity_id", ownIds)
          .neq("action", "insert")
          .order("at", { ascending: false })
          .limit(limit);
  if (ownRows.error) throw ownRows.error;
  const seen = new Set<number>();
  return [...own.data, ...ownRows.data, ...shared.data].filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

/** Names and kinds of the shop's lists, shared and own, for History lines. */
export async function getTemplateNames(tenantId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("price_templates")
    .select("id, name, kind")
    .eq("tenant_id", tenantId);
  if (error) throw error;
  return new Map(
    data.map((t) => [t.id, { name: t.name, kind: t.kind as ListKind }]),
  );
}

/** Every tax profile's name, archived ones too, for History lines. */
export async function getTaxProfileNames(tenantId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tax_profiles")
    .select("id, name")
    .eq("tenant_id", tenantId);
  if (error) throw error;
  return new Map(data.map((p) => [p.id, p.name]));
}
