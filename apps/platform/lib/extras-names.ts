import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@mango/db/database.types";

/** A signed-in member's client on the platform schema. */
export type NamesDb = SupabaseClient<Database, "platform">;

export type ProductNames = Map<string, { name: string; deleted: boolean }>;

/**
 * Names for extras History lines: each product's name as it is now, and for
 * a product that has since been deleted, the name its own delete event
 * kept. An extras_change event holds ids only, and a product deleted with
 * links leaves no extras event of its own (PROGRESS, stage 5, item 8).
 *
 * Runs as the member whose client it is given, so row-level security
 * decides (the audit log is owners' and managers'). lib/extras-data.ts
 * calls it for the screens; tests/db/extras-screens.test.ts calls it as
 * the owner.
 */
export async function productNames(
  supabase: NamesDb,
  tenantId: string,
  ids: readonly string[],
): Promise<ProductNames> {
  const names: ProductNames = new Map();
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return names;
  const { data, error } = await supabase
    .from("products")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("id", wanted);
  if (error) throw error;
  for (const row of data) names.set(row.id, { name: row.name, deleted: false });
  const gone = wanted.filter((id) => !names.has(id));
  if (gone.length === 0) return names;
  const deleted = await supabase
    .from("audit_events")
    .select("entity_id, before->>name")
    .eq("tenant_id", tenantId)
    .eq("entity", "products")
    .eq("action", "delete")
    .in("entity_id", gone);
  if (deleted.error) throw deleted.error;
  for (const row of deleted.data as {
    entity_id: string;
    name: string | null;
  }[])
    if (row.name) names.set(row.entity_id, { name: row.name, deleted: true });
  return names;
}
