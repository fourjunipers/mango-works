// Removes the spike's throwaway shop from one target: the shop and everything under it, its audit rows,
// and its users. Touches rows of that one tenant and those users only; every statement names the id.
// Usage: node scripts/remove-shop.mjs staging|free|launch
//
// Why the direct connection: audit_events.tenant_id is "on delete restrict" (20261119000100), and no API role
// may delete audit rows, so the API cannot remove a shop. This is the same order the tests' deleteTenant() uses.
import { renameSync, existsSync } from "node:fs";
import { target, loadState } from "../lib/targets.mjs";

const name = process.argv[2];
const shop = loadState(name);
if (!shop) throw new Error(`no spike shop on record for ${name}`);
if (!/^neon-spike-[0-9a-f]{8}$/.test(shop.slug)) throw new Error("the record's slug is not a spike shop's");
const t = await target(name);
const db = await t.sql();
const out = { target: name, slug: shop.slug };

if (shop.tenantId) {
  // The tenant on record must be the spike's own: same id AND the spike's slug and name.
  const found = (await db.query("select id, slug, name from platform.tenants where id = $1", [shop.tenantId])).rows;
  if (found.length && (found[0].slug !== shop.slug || !found[0].name.startsWith("Neon spike "))) throw new Error("the tenant on record is not the spike shop; nothing removed");
  if (found.length) {
    await db.query("begin");
    await db.query("set local lock_timeout = '5s'");
    out.rowsUnderShopBefore = (
      await db.query(
        `select
          (select count(*) from platform.audit_events where tenant_id = $1) audit_events,
          (select count(*) from platform.reservations where tenant_id = $1) reservations,
          (select count(*) from platform.unit_blocks where tenant_id = $1) unit_blocks,
          (select count(*) from platform.units where tenant_id = $1) units,
          (select count(*) from platform.products where tenant_id = $1) products,
          (select count(*) from platform.memberships where tenant_id = $1) memberships`,
        [shop.tenantId],
      )
    ).rows[0];
    out.auditDeleted = (await db.query("delete from platform.audit_events where tenant_id = $1", [shop.tenantId])).rowCount;
    out.tenantDeleted = (await db.query("delete from platform.tenants where id = $1 and slug = $2", [shop.tenantId, shop.slug])).rowCount;
    await db.query("commit");
  } else {
    out.tenantDeleted = 0;
  }
}
await db.end();

out.usersDeleted = 0;
for (const u of shop.users) {
  if (!/^neon-spike-owner-[0-9a-f]{8}@platform-test\.test$/.test(u.email)) throw new Error("a user on record is not a spike user");
  await t.deleteUser(u.id);
  out.usersDeleted++;
}

// Proof nothing of the shop is left.
const check = await t.sql();
out.left = (
  await check.query(
    `select
      (select count(*) from platform.tenants where id = $1 or slug = $2) tenants,
      (select count(*) from platform.audit_events where tenant_id = $1) audit_events,
      (select count(*) from ${t.usersTable} where id = any($3::uuid[])) users,
      (select count(*) from public.profiles where id = any($3::uuid[])) profiles`,
    [shop.tenantId, shop.slug, shop.users.map((u) => u.id)],
  )
).rows[0];
await check.end();

const file = new URL(`../.state/${name}.json`, import.meta.url);
if (existsSync(file)) renameSync(file, new URL(`../.state/${name}.removed-${Date.now()}.json`, import.meta.url));
console.log(JSON.stringify(out, null, 1));
