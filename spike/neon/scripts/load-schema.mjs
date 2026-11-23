// Applies sql/bootstrap.sql and then the repo's migrations to a Neon project, over the direct connection.
// Usage: node scripts/load-schema.mjs FREE|LAUNCH
// The migration FILES are never edited. Two things are changed in memory as each is sent, and both are
// findings for the write-up (stage 2's baseline has to deal with them):
//   a. `for role postgres` -> `for role <current user>`: Neon has no role called postgres.
//   b. the `pg_available_extensions ... 'pg_cron'` check is made false: on Neon pg_cron is "available" in every
//      database but can only be created in the one named by cron.database_name, so the migration would fail.
import { readFileSync, readdirSync } from "node:fs";
import { neon } from "../lib/pg.mjs";
import { safe } from "../lib/env.mjs";

const which = process.argv[2];
if (!["FREE", "LAUNCH"].includes(which)) throw new Error("say FREE or LAUNCH");
const dir = new URL("../../../supabase/migrations/", import.meta.url);
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const db = await neon(which);
const me = (await db.query("select current_user u")).rows[0].u;
try {
  await db.query(readFileSync(new URL("../sql/bootstrap.sql", import.meta.url), "utf8"));
} catch (e) {
  console.log(`FAILED bootstrap: [${e.code}] ${safe(e.message)} (position ${e.position ?? "?"})`);
  await db.end();
  process.exit(1);
}
await db.query('set search_path = "$user", public, extensions');
const done = new Set((await db.query("select name from spike.migrations")).rows.map((r) => r.name));

let applied = 0;
const changed = [];
for (const f of files) {
  if (done.has(f)) continue;
  let text = readFileSync(new URL(f, dir), "utf8");
  const a = text.replaceAll(/for role postgres\b/g, `for role ${me}`);
  if (a !== text) changed.push(`${f}: for role postgres`);
  const b = a.replaceAll(/(pg_available_extensions[^;]*?name\s*=\s*)'pg_cron'/g, "$1'pg_cron__skipped_by_spike'");
  if (b !== a) changed.push(`${f}: pg_cron check`);
  // c. Schema `auth` is Neon's once the Data API is on: users and auth.role() live in spike_auth instead.
  const c = b
    .replaceAll(/(?<![A-Za-z0-9_])auth[.](users|identities)(?![A-Za-z0-9_])/g, "spike_auth.$1")
    .replaceAll(/(?<![A-Za-z0-9_])auth[.](role|uid)[(][)]/g, "spike_auth.$1()");
  if (c !== b) changed.push(`${f}: auth.users / auth.identities / auth.uid() / auth.role()`);
  // d. Two migrations first check, by md5, that the functions they replace are the bodies main has. Rewrite c
  //    changed those bodies by exactly the schema name, so the check undoes that before it compares. It still
  //    proves every other character is main's.
  const d = c.replaceAll("md5(p.prosrc)", "md5(replace(p.prosrc, 'spike_auth.', 'auth.'))");
  if (d !== c) changed.push(`${f}: body check allows for rewrite c`);
  text = d;
  try {
    await db.query("begin");
    await db.query(text);
    await db.query("insert into spike.migrations (name) values ($1)", [f]);
    await db.query("commit");
    applied++;
  } catch (e) {
    await db.query("rollback").catch(() => {});
    const line = e.position ? text.slice(0, Number(e.position)).split("\n").length : null;
    console.log(`FAILED ${f}${line ? " line " + line : ""}: [${e.code}] ${safe(e.message)}`);
    if (e.detail) console.log("  detail:", safe(e.detail));
    if (e.hint) console.log("  hint:", safe(e.hint));
    if (e.where) console.log("  where:", safe(e.where).split("\n")[0]);
    console.log(`applied ${applied} this run; ${done.size + applied} of ${files.length} in all`);
    await db.end();
    process.exit(1);
  }
}
console.log(`applied ${applied} this run; ${done.size + applied} of ${files.length} in all`);
if (changed.length) console.log("changed in memory:\n  " + changed.join("\n  "));
await db.end();
