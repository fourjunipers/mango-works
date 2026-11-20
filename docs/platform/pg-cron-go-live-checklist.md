# Scheduled jobs: the go-live checklist

Every job the platform's migrations schedule with Supabase Cron (`pg_cron`), for whoever applies migrations to live (`docs/RUNBOOK-GO-LIVE-PLATFORM.md`). A job starts on live the moment its migration is applied there, so check this list **before** the push and run its checks **after**.

Each migration schedules its job only where `pg_cron` is available, and still applies where it is not (it prints a notice instead). `pg_cron` 1.6.4 is on staging (checked 16 Nov 2026) and was available on live at the 12 Nov 2026 pre-flight; check 1 below confirms it on live.

## The jobs

| Job name | Schedule | Runs | Scheduled by | On live |
| --- | --- | --- | --- | --- |
| `platform-renewal-notifications` | `7 * * * *` (hourly, at seven minutes past) | `select platform_private.queue_renewal_notifications()` | `20261111000200_platform_fleet_followups` | Since 12 Nov 2026 |
| `platform-release-expired-holds` | `* * * * *` (every minute) | `select platform_private.release_expired_holds()` | `20261116000200_platform_availability` | **Not yet.** Starts when Phase 2's migrations reach live |

## The hold sweep (`platform-release-expired-holds`)

**What it does.** A held booking (`reservations.state = 'held'`) keeps its units until `hold_expires_at`. Once that moment has passed, the sweep releases it: the reservation becomes `expired`, its blocks on the units are deleted, a coupon use it held is given back (`coupon_redemptions.released_at`), and one `expire` event per booking is written to `audit_events`.

**What it does not do.** It decides nothing. A hold that has run out holds no unit and no coupon use from that moment, whether or not the sweep has run: `reserve()`, `availability()`, `confirm_hold()` and `coupon_uses()` all leave it out by the clock, and `reserve()` and `assign_units()` run the same sweep for the products they touch. The job only tidies up, so a minute in which it does not run costs nothing but tidiness.

**Locks.** It takes the product-and-location locks of the holds it releases, in key order, then the reservations and the blocks (root `CLAUDE.md` › lock order). It has **no lock timeout**, on purpose: it runs from cron, not from the API, and waits its turn behind a booking. So a sweep can take longer than a minute when a booking is slow; `pg_cron` runs one instance of a job at a time, so the next run waits for it rather than running beside it.

**Who can run it.** The job runs as the database's own role. `platform.release_expired_holds()` is the server's (service role) way to run it by hand. Nobody signed in can call either.

### Before the push

1. Staging has had the job since its migration was pushed there on 16 Nov 2026. Look at `cron.job` and `cron.job_run_details` on staging first (checks 1 to 3 below, run there): a job that fails on staging will fail on live.
2. Count what the first run on live will release, so the number afterwards is no surprise:

   ```sql
   select count(*) from platform.reservations
   where state = 'held' and hold_expires_at <= now();
   ```

   On live before Phase 2 there are no reservations at all, so this is 0.

### After the push

Run these in the SQL editor on live, a few minutes after the migrations are applied.

1. **The job is there and active.** Expected: two rows, both `active = true`, with the schedules in the table above.

   ```sql
   select jobname, schedule, active, command from cron.job order by jobname;
   ```

2. **It has run, every minute, without failing.** Expected: one row a minute, every `status` `succeeded`.

   ```sql
   select d.start_time, d.end_time, d.status, d.return_message
   from cron.job_run_details d
   join cron.job j on j.jobid = d.jobid
   where j.jobname = 'platform-release-expired-holds'
   order by d.start_time desc
   limit 10;
   ```

3. **Nothing has failed since it started.** Expected: 0.

   ```sql
   select count(*)
   from cron.job_run_details d
   join cron.job j on j.jobid = d.jobid
   where j.jobname = 'platform-release-expired-holds' and d.status <> 'succeeded';
   ```

4. **No hold is left long past its time.** A hold may sit expired for up to a minute before the sweep reaches it; two minutes means the job is not doing its work. Expected: 0.

   ```sql
   select count(*) from platform.reservations
   where state = 'held' and hold_expires_at < now() - interval '2 minutes';
   ```

5. **The run history is not growing without end.** `cron.job_run_details` gets a row a minute from this job (1,440 a day). If nothing clears it, schedule the clean-up Supabase documents (a daily `delete from cron.job_run_details where end_time < now() - interval '7 days'`), as its own migration. Not scheduled today: decide at go-live, and record the choice in `docs/PROGRESS.md`.

### If it goes wrong

- **The job is missing.** `pg_cron` was not available when the migration ran. Nothing is lost (see "What it does not do"). Enable `pg_cron` in the dashboard and schedule the job in a new migration; do not schedule it by hand.
- **Runs fail.** Read `return_message` in `cron.job_run_details`. To stop it while the cause is found: `select cron.alter_job(jobid, active := false) from cron.job where jobname = 'platform-release-expired-holds';` and record that it was done. Bookings keep working with the job off.
- **A run never ends.** It is waiting for a lock behind another session. Find the blocker with `pg_blocking_pids()` on the job's backend (`select pid, query, wait_event_type from pg_stat_activity where query like '%release_expired_holds%'`); the next run does not start until this one ends.

## Adding a job

A new job goes in a migration, in the same shape as the two above (`if exists (select 1 from pg_available_extensions where name = 'pg_cron')`, a `platform-` name, a notice where the extension is missing), and gets a row in the table here and its own "after the push" checks.
