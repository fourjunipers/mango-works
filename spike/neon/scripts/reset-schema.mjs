// Empties a Neon spike project of everything load-schema.mjs made, so it can be loaded again.
// Usage: node scripts/reset-schema.mjs FREE|LAUNCH
// Only ever run against the two throwaway Neon projects. Leaves Neon's own things alone: the roles, schema
// auth, schema pgrst and the pg_session_jwt extension (which lives in public).
import { neon } from "../lib/pg.mjs";

const which = process.argv[2];
if (!["FREE", "LAUNCH"].includes(which)) throw new Error("say FREE or LAUNCH");
const db = await neon(which);
const host = (await db.query("select current_database() d, current_user u")).rows[0];
if (host.d !== "neondb" || host.u !== "neondb_owner") throw new Error("not a spike database");

await db.query("begin");
for (const s of ["platform", "platform_private", "marketplace_api", "spike", "spike_auth", "storage", "graphql_public"]) {
  await db.query(`drop schema if exists ${s} cascade`);
}
// Everything of ours in public: by owner, so pg_session_jwt's objects (owned by Neon) stay.
await db.query(`
do $$
declare r record;
begin
  for r in select c.oid::regclass::text n, c.relkind k from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relowner = current_user::regrole and c.relkind in ('r','v','m','S','p','f')
             -- a sequence that belongs to a column goes with its table
             and not (c.relkind = 'S' and exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a','i')))
           order by case c.relkind when 'v' then 1 when 'm' then 2 when 'r' then 3 when 'p' then 3 else 4 end
  loop
    execute format('drop %s if exists %s cascade',
      case r.k when 'r' then 'table' when 'p' then 'table' when 'v' then 'view' when 'm' then 'materialized view' when 'S' then 'sequence' else 'foreign table' end, r.n);
  end loop;
  for r in select p.oid::regprocedure::text n, p.prokind k from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proowner = current_user::regrole
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('drop %s if exists %s cascade', case r.k when 'p' then 'procedure' when 'a' then 'aggregate' else 'function' end, r.n);
  end loop;
  for r in select t.oid::regtype::text n from pg_type t
           where t.typnamespace = 'public'::regnamespace and t.typowner = current_user::regrole and t.typtype in ('e','d','c')
             and (t.typrelid = 0 or (select relkind from pg_class where oid = t.typrelid) = 'c')
  loop
    execute format('drop type if exists %s cascade', r.n);
  end loop;
end $$;`);
await db.query("drop schema if exists extensions cascade");
await db.query("commit");

const left = (
  await db.query(`select
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relowner = current_user::regrole) public_relations,
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proowner = current_user::regrole) public_functions,
    (select string_agg(nspname, ', ' order by nspname) from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema') schemas,
    (select string_agg(extname, ', ' order by extname) from pg_extension) extensions`)
).rows[0];
console.log(which, "after reset:", left);
await db.end();
