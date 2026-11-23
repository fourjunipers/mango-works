// One "target" per database the spike talks to: staging (Supabase), free and launch (Neon).
// Each gives the same four things: a service client, a way to make a user, a way to get a staff client,
// and a direct SQL connection. Everything above this file is written once and runs against all three.
import pg from "pg";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { env, need, staging, safe } from "./env.mjs";
import { neon } from "./pg.mjs";
import { sign } from "./token.mjs";
import { supabaseClient, neonClient } from "./clients.mjs";

const stateDir = new URL("../.state/", import.meta.url);

export function loadState(name) {
  const f = new URL(`${name}.json`, stateDir);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}
export function saveState(name, state) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(new URL(`${name}.json`, stateDir), JSON.stringify(state, null, 2));
}

export async function target(name) {
  if (name === "staging") return stagingTarget();
  if (name === "free" || name === "launch") return neonTarget(name.toUpperCase());
  throw new Error("target must be staging, free or launch");
}

async function stagingTarget() {
  const s = staging();
  const url = s.STAGING_SUPABASE_URL;
  const service = supabaseClient(url, s.STAGING_SUPABASE_SECRET_KEY);
  const admin = createSupabase(url, s.STAGING_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    name: "staging",
    vendor: "supabase",
    url,
    anonKey: s.STAGING_ANON_KEY,
    service,
    async createUser(email) {
      const { data, error } = await admin.auth.admin.createUser({ email, password: need("SPIKE_USER_PASSWORD"), email_confirm: true });
      if (error) throw new Error("createUser: " + safe(error.message));
      return data.user.id;
    },
    async deleteUser(id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error("deleteUser: " + safe(error.message));
    },
    /** Signs in as the throwaway user, as the app does, and returns the access token. */
    async userToken(user) {
      const anon = createSupabase(url, s.STAGING_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await anon.auth.signInWithPassword({ email: user.email, password: need("SPIKE_USER_PASSWORD") });
      if (error) throw new Error("signIn: " + safe(error.message));
      return data.session.access_token;
    },
    userClient(token) {
      return supabaseClient(url, s.STAGING_ANON_KEY, token);
    },
    async sql() {
      const c = new pg.Client({ connectionString: s.STAGING_DB_URL.replace("sslmode=require", "sslmode=no-verify"), application_name: "neon-spike", ssl: { rejectUnauthorized: false } });
      c.on("error", () => {});
      try {
        await c.connect();
      } catch (e) {
        throw new Error("could not connect to staging: " + safe(e.message));
      }
      return c;
    },
    usersTable: "auth.users",
  };
}

async function neonTarget(which) {
  const url = need(`NEON_${which}_DATA_API_URL`);
  const jwk = need("SPIKE_JWT_PRIVATE_JWK");
  const serviceToken = () => sign(jwk, { role: "service_role" }, 3600);
  return {
    name: which.toLowerCase(),
    vendor: "neon",
    url,
    service: neonClient(url, serviceToken),
    async createUser(email) {
      const db = await neon(which);
      try {
        return (await db.query("insert into spike_auth.users (email) values ($1) returning id", [email])).rows[0].id;
      } finally {
        await db.end();
      }
    },
    async deleteUser(id) {
      const db = await neon(which);
      try {
        await db.query("delete from spike_auth.users where id = $1", [id]);
      } finally {
        await db.end();
      }
    },
    async userToken(user, ttl = 3600) {
      return sign(jwk, { sub: user.id, role: "authenticated", email: user.email }, ttl);
    },
    userClient(token) {
      return neonClient(url, () => token);
    },
    sql: () => neon(which),
    usersTable: "spike_auth.users",
  };
}
