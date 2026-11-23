// Row 7, Launch only: installs spike.make_hold(), tries it once, and schedules it every 5 minutes.
// Usage: node scripts/cron-hold-maker.mjs
import { readFileSync } from "node:fs";
import { neon } from "../lib/pg.mjs";
import { loadState } from "../lib/targets.mjs";

const shop = loadState("launch");
const db = await neon("LAUNCH");
const q = async (s) => (await db.query(s)).rows;
const sql = readFileSync(new URL("../sql/cron-hold-maker.sql", import.meta.url), "utf8")
  .replaceAll("__TENANT__", shop.tenantId)
  .replaceAll("__LOCATION__", shop.locationId);
// The table first (the function's insert needs it at run time only, but keep the order plain).
const [fn, table] = sql.split("create table if not exists");
await db.query("create table if not exists" + table);
await db.query(fn);

console.log("hold_minutes:", (await q(`select hold_minutes from platform.tenants where id = '${shop.tenantId}'`))[0]);
console.log("one try:", JSON.stringify((await q("select spike.make_hold() r"))[0].r));
await db.query("select cron.schedule('spike-make-hold', '*/5 * * * *', 'select spike.make_hold()')");
console.log(await q("select jobid, jobname, schedule, active from cron.job order by jobid"));
await db.end();
