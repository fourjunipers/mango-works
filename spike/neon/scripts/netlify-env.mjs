// Writes .env.netlify (git-ignored): the values the throwaway site's functions need, and nothing else.
// NEVER included: the staging service key, STAGING_DB_URL, DEMO_PASSWORD, the Neon owner connection strings,
// the Neon API keys, the spike's private signing key.
// Usage: node scripts/netlify-env.mjs   (then: netlify env:import .env.netlify)
import { writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { env, need, staging } from "../lib/env.mjs";

if (!env.BENCH_SECRET) {
  appendFileSync(new URL("../.env.spike", import.meta.url), "BENCH_SECRET=" + randomBytes(32).toString("base64url") + "\n");
  env.BENCH_SECRET = readFileSync(new URL("../.env.spike", import.meta.url), "utf8").match(/^BENCH_SECRET=(.+)$/m)[1];
}
const s = staging();
const out = {
  BENCH_SECRET: env.BENCH_SECRET,
  SUPABASE_URL: s.STAGING_SUPABASE_URL,
  SUPABASE_ANON_KEY: s.STAGING_ANON_KEY,
  NEON_FREE_DATA_API_URL: need("NEON_FREE_DATA_API_URL"),
  NEON_LAUNCH_DATA_API_URL: need("NEON_LAUNCH_DATA_API_URL"),
};
// Row 6 adds its own values when they exist (the sign-in secrets and the restricted role's connection string).
for (const k of ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "AUTH_DATABASE_URL", "LINE_CHANNEL_ID", "LINE_CHANNEL_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SPIKE_JWT_PRIVATE_JWK_AUTH"]) {
  if (process.argv.includes("--auth") && env[k]) out[k] = env[k];
}
writeFileSync(new URL("../.env.netlify", import.meta.url), Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
console.log("wrote .env.netlify with:", Object.keys(out).join(", "));
