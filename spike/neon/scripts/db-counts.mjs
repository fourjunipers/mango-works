// Read-only: the number of rows in every table of the schemas the spike could touch, on one target.
// Usage: node scripts/db-counts.mjs staging|free|launch <label>   -> results/counts-<target>-<label>.json
// For staging this is the "before" and "after" of the clean-up: the two files must be identical.
import { writeFileSync } from "node:fs";
import { target } from "../lib/targets.mjs";

const [name, label] = process.argv.slice(2);
const t = await target(name);
const db = await t.sql();
await db.query("begin transaction read only");
const tables = (
  await db.query(`
    select n.nspname s, c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'platform', 'auth', 'storage', 'spike_auth')
      and not (n.nspname = 'public' and c.relname = 'spatial_ref_sys')
    order by 1, 2`)
).rows;
const counts = {};
for (const { s, t: tbl } of tables) {
  try {
    await db.query("savepoint one");
    counts[`${s}.${tbl}`] = Number((await db.query(`select count(*) n from "${s}"."${tbl}"`)).rows[0].n);
  } catch (e) {
    await db.query("rollback to savepoint one");
    counts[`${s}.${tbl}`] = `not readable (${e.code})`;
  }
}
await db.query("rollback");
await db.end();
const total = Object.values(counts).filter((v) => typeof v === "number").reduce((a, b) => a + b, 0);
writeFileSync(new URL(`../results/counts-${name}-${label}.json`, import.meta.url), JSON.stringify({ target: name, label, at: new Date().toISOString(), tables: Object.keys(counts).length, totalRows: total, counts }, null, 2));
console.log(`${name} ${label}: ${Object.keys(counts).length} tables, ${total} rows in all`);
