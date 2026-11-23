# Neon spike: results

**Status: in progress (23 Nov 2026).** Rows 1, 3, 4, 5 and 8 are measured. Row 2 (cold start), row 6 (LINE and Google sign-in) and row 7 (24 hours of pg_cron) are still running; their lines say so. The recommendation at the end is provisional until they finish.

This is stage 1 of `docs/platform/neon-move-plan.md` (§7.1). It answers the plan's eight rows with a number or a yes or no, lists what the plan got wrong, and ends with a go or no-go recommendation for Mark. The spike's code is under `spike/neon/` and its raw results under `spike/neon/results/`. Nothing in `apps/` or `packages/` changed, no migration file was edited, and live was never touched.

## What was set up

| Thing | What |
| --- | --- |
| Neon Free project | `mango-spike-free`, organisation "Four Junipers (Start ups)", Singapore, Postgres 17.12 |
| Neon Launch project | `mango-spike-launch`, organisation "Mango Works spike", Singapore, Postgres 17.12, fixed 0.25 CU, scale-to-zero off |
| Netlify site | `mango-neon-spike`, draft deploys only (alias `spike`), functions in `us-east-2` (US East, the default) |
| Supabase side | `mango-works-staging` (Postgres 17.11), through a throwaway shop that has been removed (counts below) |
| Schema on Neon | All 67 migrations on both projects, loaded by `spike/neon/scripts/load-schema.mjs` |
| Clients | Supabase: `@supabase/supabase-js` 2.118.0, as the apps use. Neon: `@neon/neon-js` 0.10.2 (`createClient` with `dataApi.getToken`) |

The same throwaway shop was made on each database through the data API: one owner, 12 vehicle products with 3 units each, a price by the day on each.

## Results

| # | Question | Answer | Against the plan's line | How it was measured |
| --- | --- | --- | --- | --- |
| 1 | Latency from Netlify to Neon against Supabase | Neon's median is 39 to 52 ms **lower** than Supabase's on every call, and its 95th percentile about 520 ms lower. Figures below | **Pass** on all three calls, for both Neon projects | 200 warm calls of each of three calls, against staging, Neon Launch and Neon Free, interleaved from one Netlify function instance in `us-east-2` in one run. 0 failures in 1,800 calls |
| 2 | Cold start | **Running.** Free: 20 cycles of 10.5 idle minutes. Launch: after 1 hour and after a night | Pending | First call through the Data API after the idle spell, then five more |
| 3 | Can a role made in SQL bypass RLS? | **Yes.** `create role service_role nologin bypassrls` works in plain SQL. A token with `role: service_role` sees the shop's 13 products; a signed-in stranger sees 0; the Data API's login role (`authenticator`) has no BYPASSRLS | **Pass** | SQL as `neondb_owner`, then reads of `platform.products` through the Data API with three tokens |
| 4 | Does the Data API apply a role's statement timeout? | **A 10-second call is cancelled at 8.4 s with `57014`.** But not because of the role's setting: see "Timeouts" below | **Pass**, with a caveat | `pg_sleep(10)` through the Data API as `authenticated`; then roles given other values |
| 5 | Does the Data API handle our RPC calls? | **Yes, with one real difference (`.single()`).** `55P03` after 6.3 s, `try_again` at the caller, nothing written; `57014` at 8.3 s; a real `40P01` reaches the caller. Codes, HTTP statuses, messages and times match Supabase | **Pass** on codes and times. One difference to handle: below | 32 shape and error checks and 3 lock tests, the same script against staging and both Neon projects, compared field by field |
| 6 | LINE and Google sign-in through Better Auth | **Waiting for Mark to sign in.** Better Auth 1.7.27 runs in a Netlify function, issues ES256 tokens with a constant `role: authenticated`, and both providers' sign-in links carry the registered callback addresses | Pending | Real LINE and Google test channels; then a Data API call as that user |
| 7 | pg_cron running the minute hold sweep for 24 hours | **Running since 23 Nov 01:16 UTC.** First 36 minutes: 36 runs, 36 succeeded, longest 16 ms; holds are being made and released | Pending (ends 24 Nov 01:16 UTC) | `cron.job_run_details` on the Launch compute |
| 8 | The rest of the unknowns | Each has an answer: below | Answered, except one | See below |

### Row 1: the numbers

Milliseconds, from one Netlify function instance in `us-east-2`, 23 Nov 2026 01:28 to 01:36 UTC. 10 warm-up iterations were thrown away first. 36 invocations, all on one instance, 1 cold start (in the warm-up).

| Call | Database | n | Median | 95th percentile | Min | Max |
| --- | --- | --- | --- | --- | --- | --- |
| Product list (`.from("products").select(…, product_listings(enabled))`) | Supabase staging | 200 | 257.1 | 734.6 | 245.2 | 755.7 |
| | Neon Launch | 200 | 213.4 | 214.6 | 212.9 | 219.5 |
| | Neon Free | 200 | 204.7 | 205.5 | 204.1 | 243.6 |
| Prices (`rpc("pricing_inputs")`, `uuid[]` in, `jsonb` out) | Supabase staging | 200 | 255.8 | 731.4 | 247.0 | 756.3 |
| | Neon Launch | 200 | 216.9 | 218.3 | 215.1 | 221.8 |
| | Neon Free | 200 | 209.3 | 210.5 | 208.4 | 219.5 |
| Booking (`rpc("reserve")`: advisory locks, row locks, writes) | Supabase staging | 200 | 258.7 | 731.5 | 250.0 | 781.5 |
| | Neon Launch | 200 | 217.9 | 220.1 | 217.1 | 239.2 |
| | Neon Free | 200 | 210.0 | 212.8 | 208.6 | 221.1 |

The line (decision 13): Neon's median and 95th percentile must each be no worse than Supabase's by more than 10% or 20 ms, whichever is larger. The limits were 281 to 285 ms on the median and 805 to 808 ms on the 95th percentile. Neon is under Supabase's own figure on every one, so the allowance was never needed.

Three things to know about these numbers:

- **The plan asked for two calls; three were measured.** The product list with its prices is not one query in the app: the Products page reads the products table and then calls `pricing_inputs`. Both were measured, plus the booking.
- **Supabase's 95th percentile is high because 9% of its calls (52 of 600) took about 740 ms instead of about 255 ms.** That is three round trips to Singapore instead of one, which is what a new connection costs. They were spread evenly through the run. Neon had none. The cause was not established; it may be Supabase's gateway closing idle connections. The medians are the like-for-like comparison.
- **Staging is a Supabase Free project** on shared compute, and the Neon Launch project is the smallest size (0.25 CU). At these latencies almost all of the time is the network crossing from US East to Singapore and back, so the size of either database hardly shows.

As the plan says, this answers "is Neon slower than Supabase from the same place", not "how fast will the sites be". Stage 11 measures again from Singapore.

### Row 5: what matches and what does not

**Lock behaviour (the gate tests' checks), all the same on Supabase and Neon:**

| Test | Supabase staging | Neon Free | Neon Launch |
| --- | --- | --- | --- |
| `reserve()` as staff against a held product lock | `55P03`, HTTP 500, 6,891 ms | `55P03`, HTTP 500, 6,269 ms | `55P03`, HTTP 500, 6,258 ms |
| `reserve()` online (service role) against the same lock | `55P03`, HTTP 500, 7,136 ms | `55P03`, HTTP 500, 6,889 ms | `55P03`, HTTP 500, 7,343 ms |
| Caller's answer (the code of `lib/try-again.ts`) | `try_again` | `try_again` | `try_again` |
| Rows written | none | none | none |
| A statement held past 8 s (`save_product_pricing()` against a locked row) | `57014`, HTTP 500, 8,325 ms | `57014`, HTTP 500, 8,281 ms | `57014`, HTTP 500, 8,256 ms |
| A real deadlock (`save_product_extras()` made the victim) | `40P01`, HTTP 500, 1,319 ms | `40P01`, HTTP 500, 1,257 ms | `40P01`, HTTP 500, 1,257 ms |

`reserve()` keeps `lock_timeout=6s` on Neon. The repo has no database test today that produces a real `40P01` or `57014` at a caller (only mocked unit tests), so the spike provoked both itself, the same way on each side.

**Shapes and errors.** 32 checks: table reads with an embedded relation, `count`, `.in()`, `.range()`, `.schema("public")`; RPCs with `uuid[]`, `jsonb`, defaulted arguments, `returns table`, boolean, void; `tstzrange`, `timestamptz`, enum and `int[]` columns; and errors `P0001`, `22023`, `42501`, `23505`, `23502`, `22P02`, `PGRST202`, `PGRST205`, `PGRST106`. HTTP statuses and Postgres codes match on all of them except one.

**The one real difference: `.single()`.** When the result is not exactly one row, PostgREST answers HTTP 406 with `PGRST116`. The Neon Data API answers HTTP 200: with no rows it returns `null` and no error, and with many rows it returns the first row and no error. The apps call `.single()` in 35 places (and 178 in tests). Any of them that relies on the error (for "not found", or for "this must be unique") would behave differently. This needs a decision in stage 5: check the result in `packages/db`, or change those calls.

**Small differences, text only:** Neon's `42501` has no "GRANT …" hint; its "function not found" and "schema not exposed" messages are worded differently. The codes are the same.

### Timeouts (row 4 in full)

- Enabling the Data API creates three roles: `authenticator` (the login role, `statement_timeout=8s`), `authenticated` (8 s) and `anonymous` (3 s).
- **Every request runs with the login role's 8 seconds, whatever role the token names.** `anon` set to 3 s and `service_role` set to 4 s both ran 5 and 6 second calls to the end, and both reported `statement_timeout = 8s`. PostgREST applies the token role's own settings; Neon does not.
- **We cannot change it.** `alter role authenticated …` and `alter role authenticator …` are refused (`42501`): Neon's service role made those roles, not ours.
- A function's own `set statement_timeout` shows inside the function but does not cancel the running call (plain Postgres behaviour; PostgREST 12 hoists it, Neon does not).
- A function's own `set lock_timeout` works: that is the 6-second rule, proven in row 5.

So the 6-seconds-under-8 rule in CLAUDE.md holds on Neon today. It holds because Neon's default happens to equal Supabase's, and it cannot be set per role. That is fine for the move and worth a line in the runbook.

### Row 8: the rest

| Unknown | Answer |
| --- | --- |
| `anon` against `anonymous` | A request with **no token is refused (HTTP 401)**; it does not run as `anonymous`. A token with no `role` claim runs as `anonymous`. A token with `role: anon` runs as `anon` once `anon` is granted to `authenticator`. So the public (signed-out) path needs a signed `role: anon` token, as Supabase's anon key is today. The 207 grants to `anon` stay as they are |
| Transaction advisory locks through the pooler | **Work.** A second pooled session cannot take a `pg_advisory_xact_lock` that the first holds, and can after its commit. A product lock held through the pooler made a booking through the Data API wait 2.8 s and then succeed |
| Session `SET` through the pooler (plan §3.4, pitfall 2) | **Accepted, and it leaks:** a `set statement_timeout` on one pooled client was seen by another client. The pitfall is real. `set local` inside a transaction is the only safe form |
| Way B (a direct connection with `set local role` and claims) | Works for `service_role` through the pooler; role and claims are gone after commit. **It cannot be done for `authenticated`:** we may not grant Neon's `authenticated` role to a login role of our own (`42501`) |
| PostGIS and btree_gist in schema `extensions` | **Yes.** PostGIS 3.5.7, btree_gist 1.7 and pgcrypto 1.3 all install into `extensions`; the two GiST exclusion constraints exist and bookings go through them |
| Type generation | **Works with today's tool.** `supabase gen types typescript --db-url <Neon address> --schema public,platform` (CLI 2.121.0, 8 seconds) gives the repo's `database.types.ts` text for text, apart from the `graphql_public` block. The address needs `channel_binding` removed or the CLI is refused |
| Does a minute's cron keep a Free compute awake? | **Not tested yet.** It needs `cron.database_name` set on the Free project (an API call Mark has approved for Launch only). To be asked |
| Free limits against staging | Free is 1 GB and 100 CU-hours a project. Staging's database is 31 MB. The full schema on Neon is 20 MB |

## What the plan got wrong, or did not foresee

1. **Neon's `auth` schema is closed to us (§3.2, §6.3).** Once the Data API is enabled, schema `auth` belongs to Neon's own admin role. We cannot create a table or function in it, our roles have no USAGE on it and we cannot grant it, and `auth.uid()` called from a security-definer function through the Data API returns null. There is no `auth.role()`. The plan expected `pg_session_jwt` to supply `auth.uid()`; it does not, for us.
2. **The fix is small and is the plan's own decision 10.** The Data API sets the transaction setting `request.jwt.claims` from the checked token, exactly as PostgREST does (undocumented by Neon). The "who is calling" functions read that setting. In the spike, two stand-in functions (`spike_auth.uid()`, `spike_auth.role()`) did this and every policy, booking function and audit row worked. Stage 2's baseline must point all 58 `auth.uid()` and 16 `auth.role()` calls at our own functions before the schema can load on Neon at all, not as a later tidy-up.
3. **`auth.users` cannot exist on Neon** for the same reason. The 13 references (7 foreign keys, 2 triggers, joins) must point at our own users table in the baseline. The plan has users moving to Better Auth's tables; this makes it a hard requirement of stage 2.
4. **Enabling the Data API on a database that already has an `auth` schema was not tried,** and probably fails. The order on Neon is: enable the Data API on the empty database, then load the schema.
5. **No token is not `anonymous` (§3.2).** See row 8. The plan's two options collapse to one: issue a signed `role: anon` token.
6. **Role timeouts (§2, §3.4 pitfall 7).** The plan asked whether the Data API applies a role's timeout. It does not, and the roles cannot be altered; the login role's 8 s applies to all.
7. **We cannot administer Neon's roles.** `neondb_owner` cannot alter `authenticated` or `authenticator`, or grant `authenticated` to another role. So §3.3's `app_authenticator` (a login role that is a member of `anon` and `authenticated`) cannot be built as written. If the fallback of §7.2 (our own PostgREST) is ever needed, it needs roles of our own with other names, or the Data API left off.
8. **pg_cron in migrations fails on Neon (§1 row 9, §7.3).** The migrations create pg_cron "if it is available". On Neon it is listed as available in every database but can only be created in the one that `cron.database_name` names (default `postgres`), so the migration stops. The plan already moves scheduling out of the migrations; the baseline must also drop the `create extension`.
9. **`cron.database_name` can only be set through Neon's API** (or CLI), followed by a compute restart. There is no Console setting. Stage 7 needs an API key and one call per environment.
10. **The Data API's schema cache does not refresh itself.** A new function or table is not visible through the API until the cache is refreshed through Neon's API or Console; `NOTIFY pgrst` does nothing. On Supabase this is automatic. Every migration run on Neon must end with a refresh, and stage 2's migration tool should do it.
11. **Exposed schemas and the extra search path could not be set in the Console.** Its list offered only `auth` and `public`, because it was last read before the schema was loaded, and it has no search-path field. Both were set through Neon's API. This was a stale list, not a missing USAGE grant.
12. **There is no role called `postgres`,** as the plan says, and three `alter default privileges for role postgres` statements name it. New objects on Neon get no grants by default, so the default-grants rule holds without them.
13. **`.single()` differs** (row 5). Not foreseen.
14. **Three migrations check function bodies by md5** before replacing them (`20261117000200`, `20261118000100` and `20261119000100`). Any baseline that renames `auth.uid()` inside those bodies must be built from the final schema, not by replaying those migrations.
15. **Better Auth does not check LINE's ID token signature in the redirect flow** (1.7.27 decodes the token it receives from LINE's token endpoint). That is why LINE's HS256 does not break it. The spike adds its own HS256 check with the channel secret; the real build should keep one.
16. **Netlify:** a new site in the team starts with team-login protection on every deploy, which blocks Neon from reading the key file and the providers from reaching the callbacks. It was switched off for the spike site only. Draft deploys cost no credits (190.9 before, 190.8 after the first).

The spike loaded the migrations with four changes made in memory as each file was sent (no file was edited): `for role postgres` to the current role; the pg_cron check made false; `auth.users`, `auth.identities`, `auth.uid()` and `auth.role()` pointed at the stand-ins; and the md5 checks made to allow for that.

## Recommendation (provisional)

**Go, so far.** Nothing measured stops the move. Neon is faster than Supabase from today's function region on every call, the lock rules behave identically through the Data API to the millisecond scale that matters, a `service_role` that bypasses RLS can be made in plain SQL, and the 8-second timeout is in place. The surprises are all in the access model's plumbing (points 1 to 7 above) and each has a known, small answer that fits decisions the plan already made; they make stage 2 a little larger and none of them is a reason to stop. This paragraph is provisional until row 2 (cold start on an always-on compute), row 6 (LINE and Google) and row 7 (24 hours of pg_cron) are in.

## Staging: before and after

The spike made one throwaway shop on `mango-works-staging` (slug `neon-spike-32f982c7`, one user), ran row 1 and row 5's Supabase side against it, and removed it. It was removed over the direct connection, because `audit_events.tenant_id` is `on delete restrict` and no API role may delete audit rows.

| | Tables counted | Rows |
| --- | --- | --- |
| Before the spike (23 Nov 2026, 01:28 UTC) | 91 | 4,487 |
| With the shop | 91 | 5,512 |
| After removal | 91 | 4,487 |

Every table in `platform`, `public`, `auth` and `storage` was counted; no table's count differs between before and after (`spike/neon/results/counts-staging-*.json`). Removed: 1 tenant with 513 audit rows, 213 reservations, 212 unit blocks, 41 units, 13 products, 1 membership; 1 user with its profile, identity and sessions. Left behind for those ids: 0 tenants, 0 audit rows, 0 users, 0 profiles. No migration was run on staging. After the removal the spike made one read-only query there (the database size) and nothing else.

## Clean-up list

Nothing here has been deleted yet: the Launch project is still running row 7, and Mark does the deleting.

| # | What Mark deletes | Where | When |
| --- | --- | --- | --- |
| 1 | **Project `mango-spike-launch`, then the organisation "Mango Works spike"** (the only paid thing; about $0.64 a day) | Neon Console | **By 26 Nov 2026**, after row 7 is read |
| 2 | Project `mango-spike-free` (never `faregoblin`) | Neon Console, organisation "Four Junipers (Start ups)" | After the write-up is final |
| 3 | The two project-scoped API keys | Neon Console, each organisation's Settings, API keys | With the projects |
| 4 | Site `mango-neon-spike` (its environment variables go with it) | Netlify, team FourJumipers | After the write-up is final |
| 5 | LINE Login channel "Neon spike" | LINE Developers Console, provider Four Junipers | After row 6 |
| 6 | Google Cloud project `mango-neon-spike` (its OAuth client goes with it) | Google Cloud Console | After row 6 |
| 7 | `spike/neon/.env`, `.env.spike`, `.env.netlify`, `.state/`, `.netlify/` and `node_modules/` in the worktree | Local disk (all git-ignored) | With the worktree |

Staging needs nothing: it is as it was.
