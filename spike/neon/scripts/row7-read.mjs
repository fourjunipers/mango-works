// Row 7: read the 24 hours of the minute hold sweep on the Launch compute (read-only).
// Usage: node scripts/row7-read.mjs
import { writeFileSync } from "node:fs";
import { neon } from "../lib/pg.mjs";
import { loadState } from "../lib/targets.mjs";

const shop = loadState("launch");
const db = await neon("LAUNCH");
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const FROM = "2026-11-23T01:16:00Z";
const TO = "2026-11-24T01:16:00Z";
const sweep = `from cron.job_run_details d join cron.job j using (jobid)
  where j.jobname = 'platform-release-expired-holds' and d.start_time >= $1::timestamptz - interval '1 second' and d.start_time < $2::timestamptz - interval '1 second'`;

const out = {
  readAt: new Date().toISOString(),
  window: { from: FROM, to: TO, minutes: 1440 },
  sweep: {
    byStatus: await q(`select d.status, count(*)::int n ${sweep} group by 1 order by 1`, [FROM, TO]),
    distinctMinutes: (await one(`select count(distinct date_trunc('minute', d.start_time + interval '1 second'))::int n ${sweep}`, [FROM, TO])).n,
    first: (await one(`select min(d.start_time) t ${sweep}`, [FROM, TO])).t,
    last: (await one(`select max(d.start_time) t ${sweep}`, [FROM, TO])).t,
    // How late after the top of its minute each run started, and how long it took.
    timing: await one(`select round(max(extract(epoch from d.start_time - date_trunc('minute', d.start_time)))::numeric * 1000) max_start_delay_ms,
        round((percentile_cont(0.5) within group (order by extract(epoch from d.end_time - d.start_time)))::numeric * 1000, 1) median_ms,
        round(max(extract(epoch from d.end_time - d.start_time))::numeric * 1000, 1) max_ms ${sweep}`, [FROM, TO]),
    gapsNot60s: await q(`select * from (select d.start_time, round(extract(epoch from d.start_time - lag(d.start_time) over (order by d.start_time))::numeric, 1) gap ${sweep}) x where gap is not null and (gap < 59 or gap > 61) order by 1 limit 20`, [FROM, TO]),
    overlaps: (await one(`select count(*)::int n from (select d.start_time, lag(d.end_time) over (order by d.start_time) prev_end ${sweep}) x where prev_end > start_time`, [FROM, TO])).n,
    returnMessages: await q(`select d.return_message, count(*)::int n ${sweep} group by 1 order by 2 desc limit 5`, [FROM, TO]),
  },
  holdMaker: {
    runs: await q(`select d.status, count(*)::int n from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'spike-make-hold' and d.start_time < $1::timestamptz group by 1`, [TO]),
    logged: (await one("select count(*)::int n from spike.hold_log where at < $1::timestamptz", [TO])).n,
    results: await q("select coalesce(result->>'status', result->>'error', left(result::text, 40)) outcome, count(*)::int n from spike.hold_log where at < $1::timestamptz group by 1 order by 2 desc", [TO]),
  },
  reservationsByStatus: await q("select state::text, count(*)::int n from platform.reservations where tenant_id = $1 group by 1 order by 1", [shop.tenantId]),
  // A hold that has run out and still has blocks is one the sweep missed.
  expiredHoldsStillHoldingBlocks: (await one(`select count(*)::int n from platform.reservations r
      where r.tenant_id = $1 and r.hold_expires_at is not null and r.hold_expires_at < now() - interval '2 minutes'
        and r.state::text = 'held' and exists (select 1 from platform.unit_blocks b where b.reservation_id = r.id)`, [shop.tenantId]).catch((e) => ({ n: `query failed: ${e.message}` }))).n,
  waitingOnLocksNow: (await one("select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock'")).n,
  cronSessionsNow: (await one("select count(*)::int n from pg_stat_activity where application_name ilike '%cron%'")).n,
};
writeFileSync(new URL("../results/row7.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await db.end();
