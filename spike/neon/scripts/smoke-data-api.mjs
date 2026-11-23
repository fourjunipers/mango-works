// First calls through the Neon Data API with tokens signed by the spike's key. Read-only.
// Usage: node scripts/smoke-data-api.mjs FREE|LAUNCH
import { readFileSync } from "node:fs";
import { neon } from "../lib/pg.mjs";
import { need, safe } from "../lib/env.mjs";
import { sign } from "../lib/token.mjs";

const which = process.argv[2] ?? "FREE";
const base = need(`NEON_${which}_DATA_API_URL`).replace(/\/$/, "");
const jwk = need("SPIKE_JWT_PRIVATE_JWK");

if (process.argv[3] === "--wire") {
  const db = await neon(which);
  await db.query(readFileSync(new URL("../sql/after-load.sql", import.meta.url), "utf8"));
  // A tiny function in public that reports what a request looks like from inside the database.
  await db.query(`
    create or replace function public.spike_whoami() returns jsonb language sql stable set search_path = '' as $f$
      select jsonb_build_object(
        'current_user', current_user, 'session_user', session_user,
        'spike_auth_uid', spike_auth.uid(), 'spike_auth_role', spike_auth.role(),
        'claims_guc', nullif(current_setting('request.jwt.claims', true), ''),
        'statement_timeout', current_setting('statement_timeout'),
        'lock_timeout', current_setting('lock_timeout'),
        'search_path', current_setting('search_path'),
        'in_transaction', now() = transaction_timestamp(),
        'application_name', current_setting('application_name'))
    $f$;
    revoke all on function public.spike_whoami() from public;
    grant execute on function public.spike_whoami() to anon, authenticated, service_role;`);
  console.log("wired roles and made public.spike_whoami()");
  await db.end();
}

async function call(label, path, { token, method = "GET", body, headers = {} } = {}) {
  const t0 = performance.now();
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  console.log(`${label}: HTTP ${res.status} in ${ms} ms -> ${safe(text).slice(0, 700)}`);
}

const sub = "11111111-1111-4111-8111-111111111111";
const authed = await sign(jwk, { sub, role: "authenticated" });
const service = await sign(jwk, { sub, role: "service_role" });
const anon = await sign(jwk, { role: "anon" });
const bogusRole = await sign(jwk, { sub, role: "neondb_owner" });

await call("whoami, authenticated", "/rpc/spike_whoami", { token: authed, method: "POST", body: {} });
await call("whoami, service_role", "/rpc/spike_whoami", { token: service, method: "POST", body: {} });
await call("whoami, role anon token", "/rpc/spike_whoami", { token: anon, method: "POST", body: {} });
await call("whoami, no token (anonymous)", "/rpc/spike_whoami", { method: "POST", body: {} });
await call("whoami, token claiming neondb_owner", "/rpc/spike_whoami", { token: bogusRole, method: "POST", body: {} });
await call("whoami, tampered token", "/rpc/spike_whoami", { token: authed.slice(0, -4) + "AAAA", method: "POST", body: {} });
await call("public table, authenticated", "/bike_catalog?select=id&limit=1", { token: authed });
await call("platform schema via Accept-Profile", "/products?select=id&limit=1", { token: authed, headers: { "accept-profile": "platform" } });
