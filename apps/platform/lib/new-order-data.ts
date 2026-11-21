import "server-only";
import { createClient } from "@mango/db/platform-server";
import type { AvailabilityRow, BookingInputs } from "./booking-inputs";

/**
 * The reads of the Price check (Phase 2 stage 11): the shop's
 * locations, its rentable products, and for one location and one span the
 * two existing reads, platform.booking_inputs() and platform.availability().
 * As the signed-in person: both functions let every member of the shop read
 * (booking_roles('read')) and hold no money. Nothing here writes, reserves
 * or holds.
 */

export type PriceCheckProduct = {
  id: string;
  name: string;
  type: "vehicle" | "gear" | "service";
  /** A vehicle's kind (lib/vehicle-kinds); null for gear and services. */
  kind: string | null;
  /** A vehicle's categories (lib/vehicle-kinds); empty for gear and services. */
  categories: string[];
};

export async function getPriceCheckLocations(
  tenantId: string,
): Promise<{ id: string; name: string; timezone: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, timezone, is_default")
    .eq("tenant_id", tenantId)
    .order("is_default", { ascending: false })
    .order("name");
  if (error) throw error;
  return data.map((l) => ({ id: l.id, name: l.name, timezone: l.timezone }));
}

/** Live vehicles, rental gear and services, A to Z (items for sale are sold, not rented). */
export async function getPriceCheckProducts(
  tenantId: string,
): Promise<PriceCheckProduct[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, type, vehicle_type, categories")
    .eq("tenant_id", tenantId)
    .in("type", ["vehicle", "gear", "service"])
    .is("retired_at", null)
    .order("type", { ascending: false })
    .order("name");
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type as PriceCheckProduct["type"],
    kind: p.type === "vehicle" ? (p.vehicle_type ?? "other") : null,
    categories: p.type === "vehicle" ? (p.categories ?? []) : [],
  }));
}

/** Both functions take up to 200 products at a time. */
const SLICE = 200;

/**
 * booking_inputs() and availability() for these products at one location
 * over one span, in slices of 200, the products in the order given.
 */
export async function getPriceCheckReads(
  tenantId: string,
  locationId: string,
  productIds: readonly string[],
  span: { start: Date; end: Date },
): Promise<{ inputs: BookingInputs; rows: AvailabilityRow[] } | null> {
  if (productIds.length === 0) return null;
  const supabase = await createClient();
  let first: BookingInputs | null = null;
  const inputProducts: BookingInputs["products"] = [];
  const rows: AvailabilityRow[] = [];
  for (let i = 0; i < productIds.length; i += SLICE) {
    const ids = productIds.slice(i, i + SLICE);
    const [read, counted] = await Promise.all([
      supabase.rpc("booking_inputs", {
        p_tenant_id: tenantId,
        p_location_id: locationId,
        p_product_ids: ids,
      }),
      supabase.rpc("availability", {
        p_tenant_id: tenantId,
        p_items: ids.map((id) => ({
          product_id: id,
          location_id: locationId,
          starts_at: span.start.toISOString(),
          ends_at: span.end.toISOString(),
        })),
      }),
    ]);
    if (read.error) throw read.error;
    if (counted.error) throw counted.error;
    const slice = read.data as unknown as BookingInputs;
    first ??= slice;
    inputProducts.push(...slice.products);
    rows.push(...(counted.data as unknown as AvailabilityRow[]));
  }
  return first ? { inputs: { ...first, products: inputProducts }, rows } : null;
}
