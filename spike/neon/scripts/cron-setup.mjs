// Row 7: pg_cron on the always-on Launch compute.
// Usage: node scripts/cron-setup.mjs read      -> read the compute's settings (no change)
//        node scripts/cron-setup.mjs set       -> set cron.database_name = neondb (keeps other pg_settings), restart
//        node scripts/cron-setup.mjs schedule  -> create extension pg_cron, schedule the minute hold sweep
// Second argument: launch (default) or free. Three API calls in all per project: read, set, restart.
import { writeFileSync } from "node:fs";
import { neonApi, branchAndEndpoint } from "../lib/neon-api.mjs";
import { neon } from "../lib/pg.mjs";

const step = process.argv[2];
const W = (process.argv[3] ?? "launch").toUpperCase(); // "free" only for the cron-awake test (row 8), approved 23 Nov
const w = W.toLowerCase();
const show = (e) => ({
  id_prefix: e.id.slice(0, 3),
  type: e.type,
  state: e.current_state,
  min_cu: e.autoscaling_limit_min_cu,
  max_cu: e.autoscaling_limit_max_cu,
  suspend_timeout_seconds: e.suspend_timeout_seconds,
  settings: e.settings,
  region: e.region_id,
});

if (step === "read" || step === "set") {
  const { endpointId, endpoint } = await branchAndEndpoint(W);
  console.log("compute now:", JSON.stringify(show(endpoint), null, 1));
  writeFileSync(new URL(`../results/${w}-compute-before.json`, import.meta.url), JSON.stringify(show(endpoint), null, 2));
  if (step === "set") {
    const pg_settings = { ...(endpoint.settings?.pg_settings ?? {}), "cron.database_name": "neondb" };
    const patch = await neonApi(W, "PATCH", `/endpoints/${endpointId}`, { endpoint: { settings: { ...(endpoint.settings ?? {}), pg_settings } } });
    console.log("PATCH", patch.status, patch.status >= 300 ? JSON.stringify(patch.body).slice(0, 500) : JSON.stringify(show(patch.body.endpoint).settings));
    if (patch.status >= 300) process.exit(1);
    // Wait for the settings operation to finish before restarting.
    for (let i = 0; i < 30; i++) {
      const e = await neonApi(W, "GET", `/endpoints/${endpointId}`);
      if (!e.body.endpoint.pending_state) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const restart = await neonApi(W, "POST", `/endpoints/${endpointId}/restart`);
    console.log("restart", restart.status, restart.status >= 300 ? JSON.stringify(restart.body).slice(0, 500) : "");
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const e = await neonApi(W, "GET", `/endpoints/${endpointId}`);
      if (e.body.endpoint.current_state === "active" && !e.body.endpoint.pending_state) {
        console.log("compute active again:", JSON.stringify(show(e.body.endpoint), null, 1));
        writeFileSync(new URL(`../results/${w}-compute-after.json`, import.meta.url), JSON.stringify(show(e.body.endpoint), null, 2));
        break;
      }
    }
  }
}

if (step === "schedule") {
  const db = await neon(W);
  const q = async (s, p) => (await db.query(s, p)).rows;
  console.log("cron.database_name =", (await q("show cron.database_name"))[0]["cron.database_name"]);
  await db.query("create extension if not exists pg_cron");
  console.log("pg_cron", (await q("select extversion v, extnamespace::regnamespace::text s from pg_extension where extname = 'pg_cron'"))[0]);
  // The same job, name and command as migration 20261116000200 schedules on Supabase.
  await db.query("select cron.schedule('platform-release-expired-holds', '* * * * *', 'select platform_private.release_expired_holds()')");
  console.log(await q("select jobid, jobname, schedule, command, database, username, active from cron.job order by jobid"));
  console.log("scheduled at", (await q("select now() at time zone 'utc' t"))[0].t);
  await db.end();
}
