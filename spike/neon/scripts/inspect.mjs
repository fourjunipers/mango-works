// Read-only look at a Neon project: version, roles, schemas, extensions, timeouts.
// Usage: node scripts/inspect.mjs FREE|LAUNCH [label]   -> results/inspect-<which>-<label>.json
import { writeFileSync } from "node:fs";
import { neon, rolledBack } from "../lib/pg.mjs";
import { safe } from "../lib/env.mjs";

const which = process.argv[2] ?? "FREE";
const label = process.argv[3] ?? "now";
const db = await neon(which);
const q = async (sql) => (await db.query(sql)).rows;
const out = { which, label, at: new Date().toISOString() };

out.version = (await q("select current_setting('server_version') v, current_user u, current_database() d"))[0];
out.roles = await q(`select rolname, rolsuper, rolinherit, rolcreaterole, rolcanlogin, rolbypassrls, rolconfig,
  (select array_agg(g.rolname order by g.rolname) from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid) member_of
  from pg_roles r where rolname !~ '^pg_' order by rolname`);
out.schemas = (await q("select nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema' order by 1")).map((r) => r.nspname);
out.extensions = await q("select e.extname, e.extversion, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by 1");
out.available = await q("select name, default_version from pg_available_extensions where name in ('postgis','btree_gist','pgcrypto','pg_cron','pg_session_jwt','pgtap') order by 1");
out.authFunctions = await q("select p.proname, pg_get_function_result(p.oid) returns, pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' order by 1");
out.settings = await q("select name, setting, unit from pg_settings where name in ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout','max_connections','cron.database_name','shared_preload_libraries','deadlock_timeout') order by 1");
out.size = (await q("select pg_size_pretty(pg_database_size(current_database())) s"))[0].s;

// Row 3, first look: is BYPASSRLS allowed from SQL? Tried in a transaction that is rolled back, so nothing is left.
out.bypassFromSql = await rolledBack(db, async () => {
  try {
    await db.query("create role spike_probe_bypass nologin bypassrls");
    const r = (await q("select rolbypassrls from pg_roles where rolname = 'spike_probe_bypass'"))[0];
    return { allowed: true, rolbypassrls: r.rolbypassrls };
  } catch (e) {
    return { allowed: false, code: e.code, message: safe(e.message) };
  }
});

writeFileSync(new URL(`../results/inspect-${which.toLowerCase()}-${label}.json`, import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await db.end();
