// The calls row 1 measures, written once and run with either vendor's client.
// They are the calls the platform app makes (file:line in apps/platform):
//   readProducts : getFleet's products query, lib/fleet-data.ts:69 (a table read with an embedded relation)
//   readPrices   : getPricingInputs, lib/pricing-data.ts:28 (rpc pricing_inputs, uuid[] argument, jsonb result)
//   reserve      : reserveAsStaff, lib/staff-booking.ts:103 (rpc reserve: advisory locks, row locks, writes)

export const PRODUCT_COLUMNS =
  "id, name, type, catalog_id, make, model, vehicle_type, categories, cc, transmission, bookable_online, catalog_rejected_at, catalog_approved_at, photos, retired_at, sort_position, product_listings(enabled)";

export function readProducts(db, shop) {
  return db.from("products").select(PRODUCT_COLUMNS).eq("tenant_id", shop.tenantId).eq("type", "vehicle").order("name");
}

export function readPrices(db, shop) {
  return db.rpc("pricing_inputs", { p_tenant_id: shop.tenantId, p_product_ids: shop.products.map((p) => p.id) });
}

/**
 * One staff booking of one unit of one product for one day. `slot` picks the product and the day, so every
 * call books something nobody else has: slot n -> product n mod 12, day 2 * floor(n / 12) from the base day.
 */
export function reserveRequest(shop, slot, baseDay) {
  const product = shop.products[slot % shop.products.length];
  const day = new Date(baseDay.getTime() + 2 * Math.floor(slot / shop.products.length) * 86_400_000);
  const starts = new Date(day.getTime() + 3 * 3_600_000); // 10:00 Bangkok
  const ends = new Date(day.getTime() + 11 * 3_600_000); // 18:00 Bangkok
  return {
    p_tenant_id: shop.tenantId,
    p_request: {
      channel: "walk_in",
      mode: "staff",
      hold: false,
      lines: [{ product_id: product.id, location_id: shop.locationId, starts_at: starts.toISOString(), ends_at: ends.toISOString(), quantity: 1 }],
    },
  };
}

export function reserve(db, shop, slot, baseDay) {
  return db.rpc("reserve", reserveRequest(shop, slot, baseDay));
}

/** apps/platform/lib/try-again.ts, word for word in behaviour. */
export const TRY_AGAIN_CODES = ["55P03", "57014"];
export const isTryAgain = (error) => !!error?.code && TRY_AGAIN_CODES.includes(error.code);

/** apps/platform/lib/staff-booking.ts `call()`: what the staff caller answers for a result. */
export function staffAnswer({ data, error }) {
  if (error) {
    if (isTryAgain(error)) return { ok: false, reason: "try_again" };
    throw Object.assign(new Error(error.message), { code: error.code });
  }
  return data;
}
