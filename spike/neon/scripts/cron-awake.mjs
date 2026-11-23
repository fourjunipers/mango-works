// Row 8, "does a minute pg_cron job keep a scale-to-zero compute awake?" on the Free project only.
// Usage: node scripts/cron-awake.mjs usage <label>   -> save the project's usage counters (read-only API call)
//        node scripts/cron-awake.mjs watch <minutes> -> ask the API for the compute's state once a minute; no database connection,
//                                                     so nothing but the cron job itself can keep the compute awake
//        node scripts/cron-awake.mjs finish          -> unschedule the job, read cron.job_run_details
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { neonApi, branchAndEndpoint } from "../lib/neon-api.mjs";
import { neon } from "../lib/pg.mjs";

const [step, arg] = process.argv.slice(2);
const W = "FREE";
const file = (n) => new URL(`../results/cron-awake-${n}.json`, import.meta.url);

if (step === "usage") {
  const p = await neonApi(W, "GET", "");
  if (p.status !== 200) throw new Error(`read project: HTTP ${p.status}`);
  const x = p.body.project;
  const out = { at: new Date().toISOString(), active_time_seconds: x.active_time_seconds, compute_time_seconds: x.compute_time_seconds, cpu_used_sec: x.cpu_used_sec, consumption_period_start: x.consumption_period_start, compute_last_active_at: x.compute_last_active_at };
  writeFileSync(file(`usage-${arg}`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}

if (step === "watch") {
  const minutes = Number(arg);
  const { endpointId } = await branchAndEndpoint(W);
  const out = { startedAt: new Date().toISOString(), minutes, samples: [] };
  for (let i = 0; i <= minutes; i++) {
    const e = await neonApi(W, "GET", `/endpoints/${endpointId}`);
    const ep = e.body?.endpoint;
    const s = { at: new Date().toISOString(), http: e.status, state: ep?.current_state ?? null, pending: ep?.pending_state ?? null, last_active: ep?.last_active ?? null };
    out.samples.push(s);
    writeFileSync(file(process.argv[4] ?? "watch"), JSON.stringify(out, null, 2));
    if (i % 10 === 0 || s.state !== out.samples.at(-2)?.state) console.log(`${s.at} ${s.state} last_active ${s.last_active}`);
    if (i < minutes) await new Promise((r) => setTimeout(r, 60_000));
  }
  const counts = {};
  for (const s of out.samples) counts[s.state] = (counts[s.state] ?? 0) + 1;
  out.finishedAt = new Date().toISOString();
  out.stateCounts = counts;
  writeFileSync(file(process.argv[4] ?? "watch"), JSON.stringify(out, null, 2));
  console.log("states seen:", JSON.stringify(counts));
}

if (step === "finish") {
  const db = await neon(W);
  const q = async (s) => (await db.query(s)).rows;
  const jobs = await q("select jobid, jobname from cron.job order by jobid");
  for (const j of jobs) await db.query("select cron.unschedule($1::bigint)", [j.jobid]);
  const runs = await q(`
    select status, count(*)::int n, min(start_time) first, max(start_time) last,
           round(max(extract(epoch from end_time - start_time))::numeric, 2) max_seconds
    from cron.job_run_details group by 1 order by 1`);
  const gaps = await q(`
    select start_time as after_gap, round(extract(epoch from start_time - lag(start_time) over (order by start_time))::numeric) seconds
    from cron.job_run_details order by 2 desc nulls last limit 5`);
  const out = { at: new Date().toISOString(), unscheduled: jobs.map((j) => j.jobname), jobsLeft: (await q("select count(*)::int n from cron.job"))[0].n, runs, longestGaps: gaps };
  if (existsSync(file("watch"))) out.watch = JSON.parse(readFileSync(file("watch"), "utf8")).stateCounts ?? null;
  writeFileSync(file("finish"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  await db.end();
}
