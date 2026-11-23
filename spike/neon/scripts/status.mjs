// Where the long-running rows stand, read from the Launch project (read-only).
// Usage: node scripts/status.mjs
import { neon } from "../lib/pg.mjs";

const db = await neon("LAUNCH");
const q = async (s) => (await db.query(s)).rows;
console.log("now (UTC):", (await q("select now() as t"))[0].t);
console.log("row 7, cron runs by job and status:");
console.table(await q(`
  select j.jobname, d.status, count(*)::int n, min(d.start_time) first, max(d.start_time) last,
         round(max(extract(epoch from d.end_time - d.start_time))::numeric, 2) max_seconds
  from cron.job_run_details d join cron.job j using (jobid)
  group by 1, 2 order by 1, 2`));
console.log("row 6, sign-in log by kind:");
console.table(await q("select kind, count(*)::int n, max(at) last from better_auth.spike_log group by 1 order by 1"));
await db.end();
