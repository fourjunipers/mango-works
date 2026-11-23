// Rows 3, 4 and 8 (and one row 5 follow-up) against one Neon project. Neon only; nothing here touches staging.
// Usage: node scripts/rows-3-4-8.mjs launch|free
import { writeFileSync } from "node:fs";
import pg from "pg";
import { target, loadState } from "../lib/targets.mjs";
import { neon } from "../lib/pg.mjs";
import { need, safe } from "../lib/env.mjs";
import { sign } from "../lib/token.mjs";

const name = process.argv[2];
const W = name.toUpperCase();
const shop = loadState(name);
const t = await target(name);
const base = need(`NEON_${W}_DATA_API_URL`).replace(/\/$/, "");
const jwk = need("SPIKE_JWT_PRIVATE_JWK");
const db = await neon(W);
const q = async (s, p) => (await db.query(s, p)).rows;
const out = { target: name, at: new Date().toISOString() };

async function api(path, { token, method = "GET", body, headers = {} } = {}) {
  const t0 = performance.now();
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, ms: Math.round(performance.now() - t0), body: json ?? safe(text).slice(0, 300) };
}
const P = { "accept-profile": "platform", "content-profile": "platform" };
const ownerToken = await sign(jwk, { sub: shop.users[0].id, role: "authenticated" });
const strangerToken = await sign(jwk, { sub: "22222222-2222-4222-8222-222222222222", role: "authenticated" });
const serviceToken = await sign(jwk, { role: "service_role" });
const anonToken = await sign(jwk, { role: "anon" });
const noRoleToken = await sign(jwk, { sub: shop.users[0].id });
const rows = (r) => (Array.isArray(r.body) ? r.body.length : r.body);

// ---- Row 3: a service_role that bypasses RLS, and a login role that does not ---------------------------
{
  const productsOf = (token) => api(`/products?select=id&tenant_id=eq.${shop.tenantId}`, { token, headers: P });
  const [member, stranger, service] = [await productsOf(ownerToken), await productsOf(strangerToken), await productsOf(serviceToken)];
  out.row3 = {
    roles: await q("select rolname, rolbypassrls, rolcanlogin, rolsuper, rolinherit from pg_roles where rolname in ('service_role','authenticator','authenticated','anon','anonymous','neondb_owner') order by 1"),
    howServiceRoleWasMade: "create role service_role nologin bypassrls (plain SQL, as neondb_owner); grant service_role to authenticator",
    rowsSeen: { member: rows(member), strangerSignedIn: rows(stranger), serviceRole: rows(service) },
    rlsOnProducts: (await q("select relrowsecurity, relforcerowsecurity from pg_class where oid = 'platform.products'::regclass"))[0],
    pass: null,
  };
  out.row3.pass = out.row3.rowsSeen.strangerSignedIn === 0 && out.row3.rowsSeen.serviceRole > 0 && out.row3.roles.find((r) => r.rolname === "service_role").rolbypassrls === true && out.row3.roles.find((r) => r.rolname === "authenticator").rolbypassrls === false;
}

// ---- Row 4: does the Data API apply a role's statement timeout? ----------------------------------------
{
  await db.query(`
    create or replace function public.spike_sleep(p_seconds numeric) returns text language plpgsql set search_path = '' as $f$
    begin perform pg_sleep(p_seconds); return current_setting('statement_timeout'); end $f$;
    revoke all on function public.spike_sleep(numeric) from public;
    grant execute on function public.spike_sleep(numeric) to anon, authenticated, service_role;`);
  await api("/rpc/spike_whoami", { token: ownerToken, method: "POST", body: {} }); // lets the schema cache see the new function
  await new Promise((r) => setTimeout(r, 3000));
  const sleep = (token, s) => api("/rpc/spike_sleep", { token, method: "POST", body: { p_seconds: s } });
  const brief = (r) => ({ status: r.status, ms: r.ms, code: r.body?.code ?? null, message: r.body?.message ?? r.body });
  out.row4 = { roleSettings: await q("select rolname, rolconfig from pg_roles where rolname in ('authenticator','authenticated','anonymous','anon','service_role') order by 1") };
  out.row4.authenticated10s = brief(await sleep(ownerToken, 10));
  out.row4.authenticated2s = brief(await sleep(ownerToken, 2));
  // Is it the ROLE's setting that is applied, or the login role's? Give two roles a different value and look.
  // anon is ours (3s, set in after-load.sql); service_role is ours: set it to 4s for this test, then back to 8s.
  out.row4.anon5s_roleSaysThree = brief(await sleep(anonToken, 5));
  await db.query("alter role service_role set statement_timeout = '4s'");
  out.row4.service6s_roleSaysFour = brief(await sleep(serviceToken, 6));
  await db.query("alter role service_role set statement_timeout = '8s'");
  // Can we change the setting on Neon's own roles at all?
  for (const [role, label] of [["authenticated", "alterAuthenticated"], ["authenticator", "alterAuthenticator"]]) {
    try {
      await db.query("begin");
      await db.query(`alter role ${role} set statement_timeout = '8s'`);
      out.row4[label] = "allowed";
    } catch (e) {
      out.row4[label] = `refused: [${e.code}] ${e.message}`;
    } finally {
      await db.query("rollback");
    }
  }
  // A function's own statement_timeout setting, as PostgREST 12 honours ("set on functions").
  await db.query("alter function public.spike_sleep(numeric) set statement_timeout = '3s'");
  await new Promise((r) => setTimeout(r, 3000));
  out.row4.functionSaysThree_sleep5 = brief(await sleep(ownerToken, 5));
  await db.query("alter function public.spike_sleep(numeric) reset statement_timeout");
  out.row4.pass = out.row4.authenticated10s.code === "57014" && out.row4.authenticated10s.ms > 7500 && out.row4.authenticated10s.ms < 9500;
}

// ---- Row 5 follow-up: .single() with no row ------------------------------------------------------------
{
  const object = { ...P, accept: "application/vnd.pgrst.object+json" };
  const NIL = "00000000-0000-4000-8000-000000000000";
  const zero = await api(`/tenants?select=id&id=eq.${NIL}`, { token: ownerToken, headers: object });
  const many = await api(`/products?select=id&tenant_id=eq.${shop.tenantId}`, { token: ownerToken, headers: object });
  const one = await api(`/tenants?select=id&id=eq.${shop.tenantId}`, { token: ownerToken, headers: object });
  out.row5_single = {
    rawZeroRows: { status: zero.status, body: zero.body },
    rawManyRows: { status: many.status, body: typeof many.body === "object" && !Array.isArray(many.body) ? many.body : `array of ${rows(many)}` },
    rawOneRow: { status: one.status, isObject: !!one.body && !Array.isArray(one.body) },
  };
}

// ---- Row 8: anon against anonymous -----------------------------------------------------------------------
{
  const whoami = async (token) => {
    const r = await api("/rpc/spike_whoami", { token, method: "POST", body: {} });
    return r.status === 200 ? { status: 200, current_user: r.body.current_user } : { status: r.status, code: r.body?.code, message: r.body?.message };
  };
  // A table anon may read on Supabase today: public.bike_catalog (approved rows only, by policy).
  const catalog = async (token) => {
    const r = await api("/bike_catalog?select=id&limit=1", { token });
    return { status: r.status, code: r.body?.code ?? null };
  };
  out.row8_anon = {
    noToken: await whoami(undefined),
    tokenWithRoleAnon: await whoami(anonToken),
    tokenWithNoRoleClaim: await whoami(noRoleToken),
    catalogRead: { noToken: await catalog(undefined), roleAnon: await catalog(anonToken), noRoleClaim_runsAsAnonymous: await catalog(noRoleToken) },
    membership: await q("select r.rolname member, g.rolname of from pg_auth_members m join pg_roles r on r.oid = m.member join pg_roles g on g.oid = m.roleid where r.rolname in ('anonymous','authenticator') order by 1, 2"),
  };
}

// ---- Row 8: transaction advisory locks through the pooler ------------------------------------------------
{
  const pooled = async () => {
    const c = new pg.Client({ connectionString: need(`NEON_${W}_POOLED_URL`).replace("sslmode=require", "sslmode=verify-full"), application_name: "neon-spike-pooled" });
    c.on("error", () => {});
    await c.connect();
    return c;
  };
  const a = await pooled();
  const b = await pooled();
  const r = {};
  await a.query("begin");
  await a.query("select pg_advisory_xact_lock(x'1a02'::int, 424242)");
  r.pidA = (await a.query("select pg_backend_pid() p")).rows[0].p;
  await b.query("begin");
  r.secondSessionGetsItWhileHeld = (await b.query("select pg_try_advisory_xact_lock(x'1a02'::int, 424242) got")).rows[0].got;
  await b.query("rollback");
  await a.query("commit");
  await b.query("begin");
  r.secondSessionGetsItAfterCommit = (await b.query("select pg_try_advisory_xact_lock(x'1a02'::int, 424242) got")).rows[0].got;
  await b.query("rollback");
  // The real thing: the product lock taken through the pooler makes a booking through the Data API wait.
  await a.query("begin");
  await a.query("select platform_private.lock_products_stock(array[$1]::uuid[], array[$2]::uuid[])", [shop.products[5].id, shop.locationId]);
  const started = performance.now();
  const day = new Date("2029-02-01T03:00:00Z");
  const booking = api("/rpc/reserve", {
    token: ownerToken, method: "POST", headers: P,
    body: { p_tenant_id: shop.tenantId, p_request: { channel: "walk_in", mode: "staff", hold: false, lines: [{ product_id: shop.products[5].id, location_id: shop.locationId, starts_at: day.toISOString(), ends_at: new Date(day.getTime() + 8 * 3600_000).toISOString(), quantity: 1 }] } },
  });
  await new Promise((res) => setTimeout(res, 2500));
  await a.query("commit");
  const done = await booking;
  r.bookingWaitedForPooledLock = { waitedMs: Math.round(performance.now() - started), status: done.status, ok: done.body?.ok ?? null };
  // Session-level SET through the pooler (the plan's pitfall 2): is it refused, or does it leak?
  try {
    await a.query("set statement_timeout = '1234ms'");
    r.sessionSetThroughPooler = { accepted: true, seenByNextQuery: (await a.query("show statement_timeout")).rows[0].statement_timeout, seenByOtherClient: (await b.query("show statement_timeout")).rows[0].statement_timeout };
    await a.query("reset statement_timeout").catch(() => {});
  } catch (e) {
    r.sessionSetThroughPooler = { accepted: false, code: e.code, message: e.message };
  }
  // Way B (plan §3.3) through the pooler: set local role + claims inside one transaction.
  try {
    await db.query("grant service_role, anon to neondb_owner");
    await a.query("begin");
    await a.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    await a.query("set local role service_role");
    await a.query("set local statement_timeout = '8s'");
    const inside = (await a.query("select current_user cu, spike_auth.role() r, current_setting('statement_timeout') st, (select count(*) from platform.products where tenant_id = $1) n", [shop.tenantId])).rows[0];
    await a.query("commit");
    const after = (await a.query("select current_user cu, coalesce(nullif(current_setting('request.jwt.claims', true), ''), '(none)') claims")).rows[0];
    r.wayB_serviceRole = { inside, afterCommit: after };
  } catch (e) {
    await a.query("rollback").catch(() => {});
    r.wayB_serviceRole = { error: `[${e.code}] ${e.message}` };
  }
  try {
    await db.query("begin");
    await db.query("grant authenticated to neondb_owner");
    r.wayB_canJoinAuthenticated = "allowed";
  } catch (e) {
    r.wayB_canJoinAuthenticated = `refused: [${e.code}] ${e.message}`;
  } finally {
    await db.query("rollback");
  }
  await a.end();
  await b.end();
  out.row8_pooler = r;
}

// ---- Row 8: PostGIS and btree_gist in schema extensions --------------------------------------------------
out.row8_extensions = {
  installed: await q("select e.extname, e.extversion, n.nspname schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname in ('postgis','btree_gist','pgcrypto','pg_cron','pg_session_jwt') order by 1"),
  postgisWorks: (await q("select extensions.st_astext(extensions.st_makepoint(100.5, 13.75)) p, round(extensions.st_distance(extensions.st_makepoint(100.5,13.75)::extensions.geography, extensions.st_makepoint(98.98,18.79)::extensions.geography)/1000) km"))[0],
  exclusionConstraintsUsingGist: (await q("select count(*)::int n from pg_constraint c join pg_class i on i.oid = c.conindid join pg_am a on a.oid = i.relam where c.contype = 'x' and a.amname = 'gist'"))[0].n,
  serverVersion: (await q("show server_version"))[0].server_version,
  databaseSize: (await q("select pg_size_pretty(pg_database_size(current_database())) s"))[0].s,
};

await db.end();
writeFileSync(new URL(`../results/rows-3-4-8-${name}.json`, import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
