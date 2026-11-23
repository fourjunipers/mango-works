// Row 5, shapes: .rpc() and .schema("platform") with every kind of argument and result the apps use, and
// errors with their codes. Run against each target; scripts/row5-compare.mjs then compares the outputs.
// Usage: node scripts/row5-shapes.mjs staging|free|launch
// Everything it writes is inside the spike shop (two bookings, one cancelled; a product order reset).
import { writeFileSync } from "node:fs";
import { target, loadState } from "../lib/targets.mjs";
import { readProducts, readPrices, reserveRequest } from "../lib/calls.mjs";
import { safe } from "../lib/env.mjs";

const name = process.argv[2];
const shop = loadState(name);
const t = await target(name);
const owner = t.userClient(await t.userToken(shop.users[0]));
const service = t.service;
const baseDay = new Date("2028-06-05T00:00:00+07:00");
const NIL = "00000000-0000-4000-8000-000000000000";

// Ids, times and names differ between targets; the shape must not. Values are reduced to their kind.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function kind(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? [kind(v[0])] : [];
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, kind(v[k])]));
  if (typeof v === "string") return UUID.test(v) ? "uuid-string" : TIME.test(v) ? "timestamp-string" : /^-?\d+$/.test(v) ? "digits-string" : "string";
  return typeof v;
}
const scrub = (s) => (s == null ? s : safe(String(s)).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>").replace(new RegExp(shop.tag, "g"), "<tag>"));

const results = {};
async function check(label, promise, pick = (d) => kind(d)) {
  let r;
  try {
    r = await promise;
  } catch (e) {
    r = { status: 0, error: { code: "THROWN", message: e.message } };
  }
  results[label] = {
    httpStatus: r.status,
    error: r.error ? { code: r.error.code ?? null, message: scrub(r.error.message), details: scrub(r.error.details), hint: scrub(r.error.hint) } : null,
    shape: r.error ? null : pick(r.data),
    ...(r.count !== undefined && r.count !== null ? { count: r.count } : {}),
  };
  return r;
}

// ---- results of every kind --------------------------------------------------------------------------
await check("table read with embedded relation (.from().select(embed))", readProducts(owner, shop));
await check("rpc: uuid[] argument, jsonb result (pricing_inputs)", readPrices(owner, shop));
await check("rpc: returns table(...) of uuids and ints (product_stock)", owner.rpc("product_stock", { p_tenant_id: shop.tenantId }));
await check("rpc: returns table with enum and timestamptz (tenant_members)", owner.rpc("tenant_members", { p_tenant_id: shop.tenantId }));
await check("rpc: returns boolean (currency_locked)", owner.rpc("currency_locked", { p_tenant_id: shop.tenantId }));
await check("rpc: returns void (reset_product_order)", owner.rpc("reset_product_order", { p_tenant_id: shop.tenantId }));
await check("rpc: jsonb argument and result (availability)", owner.rpc("availability", { p_tenant_id: shop.tenantId, p_items: [{ product_id: shop.products[2].id, location_id: shop.locationId, starts_at: new Date(baseDay.getTime() + 3 * 3600_000).toISOString(), ends_at: new Date(baseDay.getTime() + 11 * 3600_000).toISOString() }] }));
await check("rpc: uuid + uuid + uuid[] arguments (booking_inputs)", owner.rpc("booking_inputs", { p_tenant_id: shop.tenantId, p_location_id: shop.locationId, p_product_ids: shop.products.slice(0, 3).map((p) => p.id) }));
const booked = await check("rpc: reserve, a held booking (jsonb in, jsonb out with timestamptz)", owner.rpc("reserve", { ...reserveRequest({ ...shop, products: [shop.products[2]] }, 0, baseDay), p_request: { ...reserveRequest({ ...shop, products: [shop.products[2]] }, 0, baseDay).p_request, hold: true } }));
const bookingId = booked.data?.booking_id ?? NIL;
await check("rpc: confirm_hold (two uuid arguments)", owner.rpc("confirm_hold", { p_tenant_id: shop.tenantId, p_booking_id: bookingId }));
await check("rpc: default arguments left out (cancel_reservation by booking)", owner.rpc("cancel_reservation", { p_tenant_id: shop.tenantId, p_booking_id: bookingId }));
await check("table read: timestamptz, tstzrange and enum columns (reservations)", owner.from("reservations").select("id, state, channel, mode, block_period, starts_at, ends_at, hold_expires_at, created_at, quantity, shortage").eq("booking_id", bookingId));
await check("table read: .single()", owner.from("tenants").select("id, name, currency, locale, hold_minutes, renewal_reminder_days, allow_overbooking, created_at").eq("id", shop.tenantId).single());
await check("table read: .maybeSingle() with no row", owner.from("tenants").select("id").eq("id", NIL).maybeSingle());
await check("table read: count exact, head only", owner.from("units").select("id", { count: "exact", head: true }).eq("tenant_id", shop.tenantId));
await check("table read: .in() filter, order, range", owner.from("units").select("id, plate, status").in("product_id", shop.products.slice(0, 2).map((p) => p.id)).order("plate").range(0, 3));
await check(".schema('public') from a platform client (bike_catalog)", owner.schema("public").from("bike_catalog").select("id, slug").limit(1));
await check("service role reads past RLS (memberships)", service.from("memberships").select("id, role").eq("tenant_id", shop.tenantId));

// ---- errors, with their codes -----------------------------------------------------------------------
await check("error P0001 raised by a function (reserve: product_not_found)", owner.rpc("reserve", { p_tenant_id: shop.tenantId, p_request: { channel: "walk_in", mode: "staff", hold: false, lines: [{ product_id: NIL, location_id: shop.locationId, starts_at: baseDay.toISOString(), ends_at: new Date(baseDay.getTime() + 3600_000).toISOString(), quantity: 1 }] } }));
await check("error 22023 raised by a function (reserve: invalid_request)", owner.rpc("reserve", { p_tenant_id: shop.tenantId, p_request: { channel: "walk_in", mode: "staff", hold: false, lines: [], nonsense: true } }));
await check("refusal as data, not an error (reserve by a non-member's tenant: not_allowed)", owner.rpc("reserve", { ...reserveRequest(shop, 0, baseDay), p_tenant_id: NIL }));
await check("error 42501: a function the role may not execute (create_tenant as staff)", owner.rpc("create_tenant", { p_name: "x", p_slug: "x", p_country: "TH", p_currency: "THB", p_locale: "th-TH", p_timezone: "Asia/Bangkok" }));
await check("error 42501: a table the role may not write (insert into reservations as owner)", owner.from("reservations").insert({ tenant_id: shop.tenantId, product_id: shop.products[0].id, location_id: shop.locationId, starts_at: baseDay.toISOString(), ends_at: new Date(baseDay.getTime() + 3600_000).toISOString(), quantity: 1 }).select("id"));
await check("RLS hides another shop's rows (empty list, no error)", owner.from("products").select("id").eq("tenant_id", NIL));
await check("error 23505 unique violation (service insert of a plate that exists)", service.from("units").insert({ tenant_id: shop.tenantId, product_id: shop.products[0].id, location_id: shop.locationId, plate: `SPK-${shop.tag}-1-1` }).select("id"));
await check("error 23502 not-null violation (service insert of a product with no name)", service.from("products").insert({ tenant_id: shop.tenantId, vehicle_type: "motorbike" }).select("id"));
await check("error 22P02 bad uuid text in a filter", owner.from("products").select("id").eq("id", "not-a-uuid"));
await check("error PGRST116: .single() with no row", owner.from("tenants").select("id").eq("id", NIL).single());
await check("error PGRST202: a function that does not exist", owner.rpc("no_such_function_spike", { p: 1 }));
await check("error PGRST205: a table that does not exist", owner.from("no_such_table_spike").select("id"));
await check("error PGRST204/42703: a column that does not exist", owner.from("products").select("id, no_such_column_spike"));
await check("error PGRST106: a schema that is not exposed", owner.schema("platform_private").from("anything").select("*"));

writeFileSync(new URL(`../results/row5-shapes-${name}.json`, import.meta.url), JSON.stringify({ target: name, vendor: t.vendor, at: new Date().toISOString(), results }, null, 2));
const errors = Object.entries(results).filter(([, r]) => r.error);
console.log(`${name}: ${Object.keys(results).length} checks, ${errors.length} answered with an error`);
for (const [label, r] of Object.entries(results)) console.log(` ${r.error ? `[${r.error.code}] ${r.httpStatus}` : `ok ${r.httpStatus}`}  ${label}${r.error ? "  -> " + String(r.error.message).slice(0, 90) : ""}`);
