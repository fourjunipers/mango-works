// Row 6 set-up on the Launch project, over the direct connection:
//  1. a restricted login role for Better Auth (its own schema only; no BYPASSRLS, no rights on our tables),
//  2. Better Auth's tables, made by its own migration code,
//  3. a log table, and one function that makes a signed-in user a staff member of the spike shop.
// The role's connection string goes into .env.spike as AUTH_DATABASE_URL (never printed).
// Usage: node scripts/row6-setup.mjs
import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { getMigrations } from "better-auth/db/migration";
import { neon } from "../lib/pg.mjs";
import { env, need } from "../lib/env.mjs";
import { loadState } from "../lib/targets.mjs";
import { makeAuth, authPool } from "../lib/auth.mjs";

const shop = loadState("launch");
const db = await neon("LAUNCH");
const q = async (s, p) => (await db.query(s, p)).rows;

if (!env.AUTH_DATABASE_URL) {
  const password = randomBytes(24).toString("base64url");
  const exists = (await q("select 1 from pg_roles where rolname = 'spike_better_auth'")).length;
  await db.query(`${exists ? "alter" : "create"} role spike_better_auth login password '${password}' nobypassrls nocreaterole nocreatedb`);
  const u = new URL(need("NEON_LAUNCH_POOLED_URL"));
  u.username = "spike_better_auth";
  u.password = password;
  appendFileSync(new URL("../.env.spike", import.meta.url), `AUTH_DATABASE_URL=${u.toString()}\nBETTER_AUTH_URL=https://spike--${need("NETLIFY_SITE_NAME")}.netlify.app\nROW6_TENANT_ID=${shop.tenantId}\n`);
  for (const line of readFileSync(new URL("../.env.spike", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
}
await db.query(`
  -- Postgres 16+: the creator of a role holds ADMIN on it but may not "set role" to it until it grants itself that.
  grant spike_better_auth to neondb_owner;
  create schema if not exists better_auth authorization spike_better_auth;
  alter role spike_better_auth set search_path = better_auth;
  grant usage on schema spike to spike_better_auth;`);

// Better Auth's own tables, created by Better Auth, connected as its restricted role.
const auth = makeAuth(env);
const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
console.log("Better Auth will create:", toBeCreated.map((t) => t.table).join(", ") || "(nothing)", "| add to:", toBeAdded.map((t) => t.table).join(", ") || "(nothing)");
await runMigrations();
await authPool(env).query("create table if not exists spike_log (id bigint generated always as identity primary key, at timestamptz not null default now(), kind text not null, detail jsonb not null)");
await authPool(env).end();

// The link between a Better Auth user and our tables: a users row (the stand-in for auth.users, same id)
// and a staff membership of the spike shop. Owned by neondb_owner; the auth role may only execute it.
await db.query(`
  create or replace function spike.link_better_auth_user(p_id uuid, p_email text) returns text
  language plpgsql security definer set search_path = '' as $f$
  begin
    if not exists (select 1 from better_auth."user" u where u.id = p_id) then
      return 'not a Better Auth user';
    end if;
    insert into spike_auth.users (id, email) values (p_id, p_email) on conflict (id) do nothing;
    insert into platform.memberships (tenant_id, user_id, role) values ('${shop.tenantId}'::uuid, p_id, 'staff')
      on conflict do nothing;
    return 'member';
  end $f$;
  revoke all on function spike.link_better_auth_user(uuid, text) from public;
  grant execute on function spike.link_better_auth_user(uuid, text) to spike_better_auth;`);

console.log("tables:", (await q("select table_name, (select data_type from information_schema.columns c where c.table_schema = t.table_schema and c.table_name = t.table_name and c.column_name = 'id') id_type from information_schema.tables t where table_schema = 'better_auth' order by 1")).map((r) => `${r.table_name}(id ${r.id_type})`).join(", "));
console.log("role:", (await q("select rolname, rolcanlogin, rolbypassrls, rolcreaterole, rolconfig from pg_roles where rolname = 'spike_better_auth'"))[0]);
console.log("its rights on our tables:", (await q("select count(*)::int n from information_schema.role_table_grants where grantee = 'spike_better_auth' and table_schema in ('platform','public','spike_auth')"))[0].n);
await db.end();
