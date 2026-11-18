import "server-only";
import { createClient } from "@mango/db/platform-server";
import type { SavedExtra } from "./extras";
import { productNames, type ProductNames } from "./extras-names";
import { exactAuditRows, type AuditRow } from "./history";

/**
 * Reads for the Extras screens (docs/phase-2-plan.md §7): a vehicle's
 * Extras tab and Settings › Extras. Everything runs as the signed-in
 * member, so row-level security decides: every member of the shop reads
 * product_extras (it holds no amount); prices and the audit log stay with
 * those who may read them. Nothing here writes: save_product_extras() is
 * the only writer.
 */

/** A gear or service product that can be offered with a vehicle. */
export type ExtraProduct = {
  id: string;
  name: string;
  type: "gear" | "service";
  /** Retired: kept on a list, but not offered (pricing_inputs()). */
  retired: boolean;
  /**
   * False: it has no price yet, so it is not offered until it has one.
   * Null: the reader may not see prices.
   */
  priced: boolean | null;
};

export type ExtrasScreen = {
  /** The vehicle's own lines, opt-outs included. Empty on the shop's list. */
  own: SavedExtra[];
  /** The lines offered with every vehicle. */
  shopWide: SavedExtra[];
  /** Every gear and service product, by id, retired ones too. */
  products: Map<string, ExtraProduct>;
};

const columns =
  "extra_product_id, product_id, included_quantity, max_quantity, offered, sort_position";

/**
 * One vehicle's lists, or (productId null) the shop's "every vehicle" list,
 * with the gear and services they can name. `withPrices`: the reader may
 * see prices (owners, managers and staff); "No price yet" is shown then.
 */
export async function getExtrasScreen(
  tenantId: string,
  productId: string | null,
  withPrices: boolean,
): Promise<ExtrasScreen> {
  const supabase = await createClient();
  const links = supabase
    .from("product_extras")
    .select(columns)
    .eq("tenant_id", tenantId);
  const [rows, products, pricing] = await Promise.all([
    productId
      ? links.or(`product_id.eq.${productId},product_id.is.null`)
      : links.is("product_id", null),
    supabase
      .from("products")
      .select("id, name, type, retired_at")
      .eq("tenant_id", tenantId)
      .in("type", ["gear", "service"])
      .order("name"),
    withPrices
      ? supabase
          .from("product_pricing")
          .select("product_id, pricing_method")
          .eq("tenant_id", tenantId)
          .in("product_type", ["gear", "service"])
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (rows.error) throw rows.error;
  if (products.error) throw products.error;
  if (pricing.error) throw pricing.error;
  const priced = pricing.data
    ? new Set(
        pricing.data
          .filter((row) => row.pricing_method !== null)
          .map((row) => row.product_id),
      )
    : null;
  const byPosition = (a: SavedExtra, b: SavedExtra) =>
    a.sort_position - b.sort_position ||
    a.extra_product_id.localeCompare(b.extra_product_id);
  const saved = rows.data.map((row) => ({
    product_id: row.product_id,
    extra_product_id: row.extra_product_id,
    included_quantity: row.included_quantity,
    max_quantity: row.max_quantity,
    offered: row.offered,
    sort_position: row.sort_position,
  }));
  const strip = (row: (typeof saved)[number]): SavedExtra => ({
    extra_product_id: row.extra_product_id,
    included_quantity: row.included_quantity,
    max_quantity: row.max_quantity,
    offered: row.offered,
    sort_position: row.sort_position,
  });
  return {
    own: saved
      .filter((row) => productId && row.product_id === productId)
      .map(strip)
      .sort(byPosition),
    shopWide: saved
      .filter((row) => row.product_id === null)
      .map(strip)
      .sort(byPosition),
    products: new Map(
      products.data.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          type: p.type as "gear" | "service",
          retired: p.retired_at !== null,
          priced: priced ? priced.has(p.id) : null,
        },
      ]),
    ),
  };
}

const auditColumns =
  "id, entity, entity_id, action, actor, before::text, after::text, at";

/**
 * The extras_change events of one list, newest first: a vehicle's (its id)
 * or the shop's "every vehicle" list. Owners and managers, by the audit
 * log's RLS. A vehicle's own events come with its History tab's other rows
 * (getProductHistory); this is for Settings › Extras.
 */
export async function getExtrasAudit(
  tenantId: string,
  list: string,
  limit: number,
): Promise<AuditRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_events")
    .select(auditColumns)
    .eq("tenant_id", tenantId)
    .eq("entity", "product_extras")
    .eq("entity_id", list)
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return exactAuditRows(data);
}

/**
 * Names for History lines, as the signed-in member (lib/extras-names.ts):
 * a product deleted since is named from its own delete event.
 */
export async function getProductNames(
  tenantId: string,
  ids: readonly string[],
): Promise<ProductNames> {
  return productNames(await createClient(), tenantId, ids);
}
