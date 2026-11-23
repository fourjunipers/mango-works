// Makes the spike's throwaway shop on one target, through the data API, the way the apps and tests do:
// create_tenant (service role), one owner user + membership, 12 vehicle products with 3 units each,
// a price by the day on each (as the owner). Same data on every target.
// Usage: node scripts/seed-shop.mjs staging|free|launch
import { randomBytes } from "node:crypto";
import { target, loadState, saveState } from "../lib/targets.mjs";
import { safe } from "../lib/env.mjs";

const name = process.argv[2];
if (loadState(name)) throw new Error(`${name} already has a spike shop on record (.state/${name}.json); remove it first`);
const t = await target(name);
const tag = randomBytes(4).toString("hex");
const must = (label, r) => {
  if (r.error) throw new Error(`${label}: [${r.error.code}] ${safe(r.error.message)}`);
  return r.data;
};

const state = { target: name, tag, createdAt: new Date().toISOString(), slug: `neon-spike-${tag}`, users: [], products: [] };
// Recorded before anything is made, so a failure half-way still leaves a record to clean up from.
saveState(name, state);

state.tenantId = must(
  "create_tenant",
  await t.service.rpc("create_tenant", {
    p_name: `Neon spike ${tag} (throwaway)`,
    p_slug: state.slug,
    p_country: "TH",
    p_currency: "THB",
    p_locale: "th-TH",
    p_timezone: "Asia/Bangkok",
  }),
);
saveState(name, state);
state.locationId = must("location", await t.service.from("locations").select("id").eq("tenant_id", state.tenantId).eq("is_default", true).single()).id;

const email = `neon-spike-owner-${tag}@platform-test.test`;
const userId = await t.createUser(email);
state.users.push({ id: userId, email, role: "owner" });
saveState(name, state);
must("membership", await t.service.from("memberships").insert({ tenant_id: state.tenantId, user_id: userId, role: "owner" }).select("id").single());

const owner = t.userClient(await t.userToken(state.users[0]));
for (let i = 1; i <= 12; i++) {
  const product = must(
    `product ${i}`,
    await t.service
      .from("products")
      .insert({ tenant_id: state.tenantId, name: `Spike scooter ${String(i).padStart(2, "0")}`, vehicle_type: "motorbike" })
      .select("id")
      .single(),
  );
  const units = must(
    `units ${i}`,
    await t.service
      .from("units")
      .insert([1, 2, 3].map((u) => ({ tenant_id: state.tenantId, product_id: product.id, location_id: state.locationId, plate: `SPK-${tag}-${i}-${u}` })))
      .select("id"),
  );
  must(
    `price ${i}`,
    await owner.rpc("save_product_pricing", {
      p_product_id: product.id,
      p_settings: { pricing_method: "per_period", price_amount: 25000 + i * 1000, price_period: "day" },
    }),
  );
  state.products.push({ id: product.id, unitIds: units.map((u) => u.id) });
  saveState(name, state);
}
console.log(`${name}: shop ${state.slug} made: 1 user, ${state.products.length} products, ${state.products.length * 3} units`);
