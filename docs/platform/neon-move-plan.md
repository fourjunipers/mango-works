# Neon move: assessment and plan

**Status: decided by Mark, 19 Nov 2026. The spike is done and Mark decided Go on 23 Nov 2026** (§7.1; results in [`neon-spike.md`](neon-spike.md)). The spike's 18 findings are folded into §7 (where each went: §7.0). §1 to §6 are kept as written, with a short note where the spike proved them wrong.

This document holds the assessment (§1 to §6, written before the decision and kept as written), Mark's decisions (below), and the staged plan (§7). It was written from `main` at `d458717` and the Phase 3 draft on `platform/phase-3-plan-draft`. No code, migration, test or database was touched. Nothing was run against staging or live.

Every price and limit below was read on the vendor's own page on **19 Nov 2026** and is cited in §9. Prices change: check the page again before acting on a number. Where the vendor's pages disagree or a point could not be confirmed, the text says so.

## Summary

1. **Mango Works moves fully to Neon after Phase 3, before 3M and before BSR goes live.** Neon for Postgres, the Neon Data API for the calls, Better Auth in the apps for sign-in, pg_cron for the jobs. Never a part move that keeps Supabase Auth.
2. **A spike comes first, as its own stage, with a go or no-go for Mark** (§7.1). The move goes ahead only if the spike shows no meaningful performance loss on live. **Done: Go (Mark, 23 Nov 2026).** Neon was faster than Supabase on every call measured; the surprises were in the access model's plumbing and `.single()`, and they make stage 2 larger.
3. **Live is always on, in Singapore, with no scale-to-zero.** Staging and trial projects may scale to zero; Mark accepts a short cold start there.

The assessment had recommended staying (§6). Its cost and risk findings stand and are the reason the spike is a gate and every stage has a rollback: the move costs about 12 to 15 PRs, saves roughly nothing a month at production sizes, and its riskiest parts are sign-in, the access model and the path every booking takes.

## Decisions made, 19 Nov 2026

| # | Decision | Notes |
| --- | --- | --- |
| 1 | **Move fully to Neon in the planned slot**: after Phase 3, before 3M, before BSR goes live. Never a part move | Build order becomes 0 → 1a → 2 → 3 → Neon move → 3M → 1b → 4 onward |
| 2 | **Spike first, its own stage, go or no-go for Mark** | What it must measure and settle: §7.1. No meaningful performance loss on live, or the move stops. **Done; Go, 23 Nov 2026** |
| 3 | **Trial projects go in a Neon Free organisation, from now** | A paid organisation for any that grows; a project transfers with its connection string unchanged |
| 4 | **Live: Neon Launch, always on, Singapore** (`aws-ap-southeast-1`). No scale-to-zero on live | Launch is the cheapest plan that can switch scale-to-zero off. About $19 a month at the smallest size, 0.25 CU (§5) |
| 5 | **Staging: a Neon Free project that may scale to zero** | What that means for the hold sweep and for testing: §7.3 |
| 6 | **Calls: the Neon Data API, subject to the spike** | Fallback if it fails: §7.2. **The spike passed it** (rows 1 and 5), so the fallback is not needed |
| 7 | **Sign-in: Better Auth, run in the apps** | LINE and Google proved in the spike (row 6, 23 Nov 2026) |
| 8 | **Scheduler: pg_cron on the always-on compute** | Live only; staging has no schedule (§7.3). Proven by spike row 7 (1,440 runs in 1,440 minutes) |
| 9 | **Migration tool: decided after the spike** | The lean is a small SQL-file runner (a new dependency, so it needs asking). Whatever it is, every run on Neon ends with a Data API schema-cache refresh (§7.5 stage 2). Still open: §8 |
| 10 | **Phase 3 adds our own "who is calling" functions from stage 1** | Already sent to the Phase 3 plan (`app_uid()`, `app_role()`, phase-3-plan §3.11). They are the only places `auth.uid()` and `auth.role()` are read. **On Neon their bodies read `request.jwt.claims`** (spike point 2): `auth.uid()` does not work there for us |
| 11 | **A "do not start using" list in root CLAUDE.md** | Added with this document |
| 12 | **Point-in-time recovery: Neon's restore window on live** | What it covers: §7.4 |
| 13 | **The line for "no meaningful performance loss": 10% or 20 ms on median and 95th percentile, whichever is larger** | Spike row 1, §7.1 |
| 14 | **The spike may read and write a throwaway shop on staging, and must remove it afterwards** | §7.1 |
| 15 | **Staff 2FA is built after the move, on Better Auth** | Noted against Phase 11 in SPEC. Supabase's MFA is on the "do not start using" list |
| 16 | **Keep the rule that queries use only `.from()`, `.rpc()` and `.schema()`** | Root CLAUDE.md, first rule |
| 17 | **Netlify Pro is not taken now.** It is a final step of the build, just before go-live: upgrade to Pro and move the functions to Singapore | Stage 11, §7.8. The spike measures from today's function region, US East |

## 1. What depends on Supabase today

Counted on `main` by search (migrations: `supabase/migrations`, 66 files; code: `apps/` and `packages/`, tests included).

| # | Dependency | What is in the repo | Size |
| --- | --- | --- | --- |
| 1 | **Data API (PostgREST through supabase-js)** | `.from()`: 874 in the platform app, 236 in the marketplace, 8 in packages. `.rpc()`: 351 and 42. `.schema()`: 37. Exposed schemas `public`, `graphql_public`, `platform`; `max_rows = 1000` | **About 1,510 call sites** |
| 2 | **Client factories** | `packages/db/src`: `server.ts`, `platform-server.ts`, `client.ts`, `public.ts`, `admin.ts` (`@supabase/ssr`, `@supabase/supabase-js`). 12 more files import `@supabase/*` themselves (listed in `docs/PROGRESS.md`, "What does not follow the four rules yet"); ESLint refuses any new one | 5 + 12 files |
| 3 | **Auth, in the apps** | `signInWithPassword` 3, `signInWithOtp` 2, `signInWithOAuth` 2, `verifyOtp` 3, `exchangeCodeForSession` 4, `getClaims` 4, `signOut` 2; admin: `createUser` 2, `deleteUser` 3, `generateLink` 1, `customProviders` 2. Session cookies refreshed in each app's `proxy.ts`. No single sign-in helper yet (rule 3) | About 28 calls |
| 4 | **Auth, sign-in methods** | Email and password, email link (token hash checked at `/auth/confirm`, custom template `supabase/templates/magic-link.html`), Google, **LINE as a Supabase custom OAuth2 provider `custom:line`** (not OIDC: LINE signs its ID tokens with HS256; `scripts/create-line-provider.mjs` in both apps) | 4 methods |
| 5 | **Auth, the send-email hook** | Named in SPEC ("each app sends its own branded sign-in emails through Supabase's send-email hook and Resend"). **Nothing for it is in the repo**: it is set in the hosted project's dashboard, which I did not look at | Dashboard only |
| 6 | **Auth, in SQL** | `auth.uid()` 55 times in 23 migrations: the four helpers (`my_tenant_ids`, `is_member`, `has_role`, `my_role`), the audit function, column defaults (`created_by uuid default auth.uid()`), and about 9 policies directly. `auth.role()` 16 times, in the booking functions ("is the caller the service role?"). `auth.users`: 7 foreign keys, 2 triggers (new user makes a profile; email change), 2 joins | 71 calls, 11 references |
| 7 | **Roles** | `anon` 207, `authenticated` 382, `service_role` 91 mentions in grants, revokes and policies. 141 policies. 153 `security definer` functions (230 `set search_path = ''`). 3 `alter default privileges for role postgres` | In 47 of 66 migrations |
| 8 | **Storage** | Three public photo buckets (`shop-photos`, `model-photos`, `catalog-photos`) made by inserting into `storage.buckets`; 6 policies on `storage.objects` that use `storage.foldername()`. Called from 4 marketplace files. The platform stores no file yet; Phase 4 adds private documents | 2 migrations, 4 files |
| 9 | **pg_cron** | Two jobs: `platform-release-expired-holds` every minute; `platform-renewal-notifications` hourly at :07. Both are created only `if exists (... pg_available_extensions ... 'pg_cron')`, and both comments say nothing breaks without them. Phase 3 adds three more jobs | 2 jobs, 3 planned |
| 10 | **Netlify scheduled functions** | `supabase-keep-alive.mts` (daily; exists only because Free projects pause) and `refresh-stations.mts` (monthly) | 2 |
| 11 | **Extensions** | `postgis` and `btree_gist` in schema `extensions` (570 `extensions.` references, almost all PostGIS types and functions); `pg_cron` in `pg_catalog`; `extensions.digest` and `gen_random_bytes` (pgcrypto, already present on Supabase) | 4 |
| 12 | **Generated types** | `supabase gen types typescript --local --schema public,graphql_public,platform` writes `packages/db/src/database.types.ts` | 1 script |
| 13 | **Migration workflow** | Supabase CLI: `supabase start` locally and in CI, `supabase db push` to staging with `STAGING_DB_URL`; migration history in `supabase_migrations.schema_migrations` | CLI |
| 14 | **Local stack for tests** | CI runs `supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta,supavisor`, so the tests need **Postgres, PostgREST, GoTrue and Kong**. 29 database test files (21 platform, 8 marketplace). 14 platform files also run `docker exec … psql` in the container `supabase_db_<project_id>` (`sql`, `sqlAs`, `sqlBackground` in `tests/db/helpers.ts`). The **gate helper** (advisory-lock class 27262, `pg_stat_activity`) is on `platform/phase-2-stage-10-review-followups`, not on `main` yet | 29 files |
| 15 | **Limits Supabase sets for us** | The API's 8-second statement timeout that the 6-second `lock_timeout` rule in CLAUDE.md is built against | 1 rule |
| 16 | **Not used at all** | Realtime, Edge Functions, `pg_net`, Vault, GraphQL, anonymous sign-in, MFA, phone sign-in | 0 |

Two things make the picture better than the counts suggest. Everything in rows 6, 7, 9 and 11 is **plain Postgres** once three roles and a handful of functions exist. And the platform app never uses the service-role key at run time (`apps/platform/.env.example`); only the marketplace's admin pages and two platform library files do.

## 2. What Neon offers for each, or what replaces it

Effort is in PRs of the size this repo makes. Risk is to bookings, money or sign-in.

> **Spike, 23 to 24 Nov 2026:** a role made in SQL can have BYPASSRLS (row 3); the Data API does **not** apply a role's timeout and Neon's roles cannot be altered (row 4); transaction advisory locks work through the pooler; type generation works with today's tool against a Neon address. Details in §7.0 and [`neon-spike.md`](neon-spike.md).

| Dependency | Neon today (19 Nov 2026) | Replacement if not Neon's | Effort | Risk |
| --- | --- | --- | --- | --- |
| Postgres itself | Postgres 14 to 18; Singapore (`aws-ap-southeast-1`), nothing nearer Bangkok. No real superuser: `neon_superuser` has CREATEROLE, BYPASSRLS, no more | None needed | Low | Low |
| Extensions | `postgis` 3.5.7 on Postgres 17, `btree_gist`, `pgcrypto`, `pg_cron` 1.6, `pgtap` all supported. **Not there: `pg_net`, `http`, `pgmq`, Vault** | We use none of the missing ones. Phase 3's sender is app-side already | Low | Low |
| Data API | **Neon Data API, "fully compatible with PostgREST"**, with a client `createClient` from `@neon/neon-js/supabase` that keeps `.from().select()` and `.rpc()`. Checks a JWT against any JWKS address ("Other Provider"). Its changelog of 18 Sep 2026 lists it as generally available; an older blog post still says beta; some pages name the package `@neondatabase/neon-js` | Or rewrite 1,510 calls as SQL through a driver: not realistic | **Medium with the Data API; very high without** | **Medium**: young product, and the booking path runs through it |
| Auth | **Neon Auth = managed Better Auth**, generally available, users in a `neon_auth` schema in our database, 60,000 monthly users free. **No LINE, no generic OAuth, no plugins, no custom hooks.** Its own guide says Supabase password users cannot be moved | **Better Auth, run inside the two apps** (MIT, free): LINE built in, users in our Postgres, a Supabase guide that keeps bcrypt passwords. Clerk as the hosted fallback (LINE built in, 50,000 users free, users live at Clerk) | **High** (3 to 4 PRs) | **High**: we would own session security, password reset, account linking and the LINE quirk |
| Send-email hook | Neon Auth has blocking webhooks only | Better Auth calls our own function to send; Resend stays | Low | Low |
| Roles and grants | `CREATE ROLE … NOLOGIN` works. The Data API makes its own `authenticator`, `authenticated` and **`anonymous`** (not `anon`). Roles made in SQL get only basic rights. Whether a SQL-made role can be given BYPASSRLS (our `service_role`): **not confirmed** | A bootstrap script that makes `anon`, `authenticated`, `service_role` before the first migration | Medium | **High** if wrong: this is the whole access model |
| Storage | Neon's region page lists an "Object Storage" product; I did not assess it | **Cloudflare R2**: 10 GB and free egress in the free tier, then $0.015 per GB a month. Public photos on a custom domain; private documents by presigned address (presigned addresses do not work on a custom domain). Location is an `apac` hint only | Medium (1 to 2 PRs, plus copying files) | Low for photos. Medium for Phase 4 documents: the six storage policies become server-side checks |
| pg_cron | Supported, but **"runs only while the compute is active"**; set up through the compute API (`cron.database_name`) and a restart. Free cannot switch scale-to-zero off; Launch can | Netlify scheduled function calling the same SQL function (30-second limit); or QStash at about $0.43 a month for a minute's schedule | Low | Low: every job is written to be safe when it does not run |
| Pooler | PgBouncer, transaction mode. Session `SET`, `LISTEN`, session advisory locks do not work through it; `SET LOCAL` does. Transaction advisory locks (all 22 of ours are `pg_advisory_xact_lock`) are not mentioned on Neon's page; standard PgBouncer behaviour says they are fine | Use the direct connection for migrations | Low | Low, to be proved in the spike |
| Timeouts | Not documented: whether the Data API applies a role's `statement_timeout` after it switches role, and whether `alter function … set lock_timeout` is honoured | Set them ourselves and test | Low | **Medium**: the lock-order rules assume 6 s under 8 s |
| Generated types | Nothing of Neon's own found | Keep `supabase gen types` against the local database by address; not promised for plain Postgres | Low | Low |
| Migrations | No CLI of Neon's own; it points to Drizzle, Prisma, Flyway, dbmate and others | A small SQL-file runner, or the Supabase CLI with `--remote=<address>` (documented for self-hosted Supabase only; `--db-url` goes away in CLI v4) | Medium | Medium: history table and the "never edit an applied migration" rule |
| Local stack | "Neon Local" is a proxy to a cloud branch, not a local database | Plain Postgres 17 in Docker with PostGIS and pg_cron, plus the PostgREST image (§4) | Medium (2 to 3 PRs) | Medium |
| Backups | Instant restore: 6 hours on Free, up to 7 days on Launch, 30 on Scale, **$0.20 per GB a month** | n/a | None | Lower than today |
| Uptime promise | 99.95%, **Scale plan only** | n/a | n/a | n/a |

Other hosts were looked at briefly (PlanetScale Postgres, Aiven, Nile, Fly, Crunchy, Xata, Prisma, Railway, Aurora). None clearly beats both Supabase and Neon for this project, and none gives back the data API or Auth. They are not considered further.

## 3. The RLS question

### 3.1 What the policies need

A policy here never knows a user by itself. It asks, through the helpers, two things that Supabase supplies on every request:

1. **The database role** the statement runs as: `anon`, `authenticated` or `service_role`. PostgREST connects as `authenticator` and runs `set local role <the token's role claim>`.
2. **The claims**: PostgREST puts the token's contents in the transaction setting `request.jwt.claims`. `auth.uid()` reads `sub` from it; `auth.role()` reads `role`.

So the policies keep working anywhere that sets those two things, inside a transaction, from a token it has checked. There are two ways to do that on Neon.

### 3.2 Way A: the Neon Data API (what I would choose)

It does what PostgREST does: checks the token against a JWKS address, connects as `authenticator`, switches to the role in the token's `role` claim, and exposes the claims. Its `pg_session_jwt` extension supplies `auth.uid()`, `auth.jwt()`, `auth.user_id()` and `auth.session()`.

> **Spike, 23 to 24 Nov 2026: three expectations here were wrong** (points 1, 5, 6 and 7 in §7.0). `pg_session_jwt` does not give us `auth.uid()`: Neon owns the `auth` schema once the Data API is on, and our functions read `request.jwt.claims` instead. A request with no token is refused (401), not run as `anonymous`. Role timeouts are not applied. And §3.3's `app_authenticator` cannot be built, because we may not grant Neon's `authenticated` role.

What does not line up, and must be settled in a spike before any promise is made:

- **The role for a caller with no token is `anonymous`, not `anon`.** 207 grants name `anon`. Either the bootstrap makes `anonymous` a member of `anon`, or we issue our own signed token with `role: anon` as Supabase does.
- **`auth.role()` is not in Neon's list.** Sixteen booking-function checks call it. We must supply it (see §6.3: our own functions, so nothing depends on anyone's `auth` schema).
- **The token must carry `role: authenticated`.** Whoever issues it (Better Auth's JWT plugin) must set that claim from a constant and never from anything a user can change. A token that says `service_role` is the master key.
- **The service path.** `createAdminClient()` works because Supabase gives a key whose role is `service_role`. On Neon we would sign a short-lived `service_role` token on the server, or use a direct connection as a role that bypasses RLS. Either way the signing key or that connection string is as dangerous as today's service-role key.
- **The 8-second statement timeout.** PostgREST applies a role's settings after switching role. Whether Neon's Data API does is not documented.

### 3.3 Way B: a direct connection from our own server

Documented by Neon for trusted servers. The exact pattern, per request:

```sql
begin;
set local role authenticated;                                  -- or anon
select set_config('request.jwt.claims', $1, true);             -- $1 = claims as JSON, a bound parameter
set local statement_timeout = '8s';
-- the request's statements
commit;
```

The connection logs in as its own role, for example `app_authenticator`: `LOGIN`, `NOINHERIT`, no BYPASSRLS, no rights of its own, a member of `anon` and `authenticated` only.

### 3.4 The pitfalls, either way

1. **Never connect the app as the owner.** `neondb_owner` bypasses RLS, and so does the owner of a table unless RLS is forced. The owner role is for migrations only.
2. **`true` (transaction-local) and `set local`, always inside `begin … commit`.** Through a transaction-mode pooler a session-level `SET` is either refused or, worse, stays on a connection the next request gets: one customer acting as another. Neon's HTTP driver runs only a single non-interactive batch, which is enough for "set, then query" but not for a conversation; use WebSockets for those.
3. **The claims come only from a session the server has just checked**, never from a header or body, and are passed as a bound parameter. (The tests' `sqlAs()` builds the string by hand; that is right for tests and wrong for an app.)
4. **`request.jwt.claims` is an ordinary setting: anyone who can run SQL as that role can set it.** Today nobody can run SQL of their own choosing, only call what PostgREST exposes. On Way B one SQL injection anywhere becomes "be any user of any shop". `pg_session_jwt` can check the token's signature inside the database when given the key, which closes this; without the key, Neon's page says the claims "can be modified by any database user".
5. **A caller with no claims must not look like a database job.** `audit` treats a missing `auth.role()` as the service role (`coalesce(auth.role(), 'service_role')`), because pg_cron and migrations have none. That is safe today because every outside caller has a role claim. It stays safe only if the login role has no rights of its own (point 3.3), so a request that forgot to set claims can do nothing at all.
6. **`security definer` functions run as their owner and bypass RLS**, as they do today. After a restore with `--no-owner` they belong to the Neon owner. The 153 of them keep their own caller checks; nothing changes, but the default-grants test must be rewritten for Neon's defaults (roles made in SQL start with almost nothing; `alter default privileges` covers only objects made by the role that ran it; there is no role called `postgres`).
7. **Role settings are read at login, not at `set role`.** `alter role authenticated set statement_timeout` does nothing for a connection that logged in as someone else. Set it per transaction.
8. **A signed token is good until it expires.** Signing out does not recall it. This is true on Supabase today (`getClaims()` checks locally); keep the lifetime short.

## 4. The test harness

Today a database test needs four parts of the Supabase stack: Postgres, PostgREST, GoTrue (to make users and sign them in) and Kong. The race tests add `docker exec … psql` sessions and, from stage 10, gates.

What would replace it after a move:

| Piece today | Replacement | Changes in the tests |
| --- | --- | --- |
| `supabase start` | **A Docker Compose file**: Postgres 17 with PostGIS and pg_cron (our own small image; no stock image has both), and the official PostgREST image. A bootstrap SQL file makes the three roles, the `extensions` schema and our "who is calling" functions before the first migration | None |
| GoTrue: `auth.admin.createUser` then `signInWithPassword` | **Insert a user row and sign a token in the test** with a local key that PostgREST trusts. No auth server in database tests; quicker than today | `createUser()` and `deleteUser()` in the two `helpers.ts` files, once each |
| `serviceClient()`, `anonClient()` | The same supabase-js-shaped client pointed at local PostgREST, with a `service_role` or `anon` token signed locally | The two factory functions |
| `sql()`, `sqlAs()`, `sqlBackground()` | **Unchanged in idea**: `docker exec … psql` into the Compose project's database container. Only `dbContainer()` changes its name lookup | One function |
| Gates | **Unchanged.** They are advisory locks and `pg_stat_activity`: plain Postgres | None |
| `default-grants.test.ts` | Rewritten: the rule "a new table grants nothing by default" has to be made true by our bootstrap, not by Supabase's defaults | One file |
| Sign-in itself | Tested where it lives: Better Auth's own tests in the apps and the Playwright suites | New tests |
| CI | Same job, `docker compose up` instead of `supabase start`; faster and lighter (Supabase recommends 7 GB of memory for its stack) | `ci.yml` |

What local Postgres cannot show is how Neon's pooler and Data API behave. So one more suite is needed: **a short smoke suite that runs against a Neon branch** (roles, timeouts, a booking race through the pooler, a held lock answering `try_again`), run by hand before the rehearsal and before the cutover, never in every PR.

If we stay, none of this is needed, and the harness as it is keeps working.

## 5. Cost at three sizes

US dollars a month. Assumptions are mine and are stated; change them and the sums change.

**Rates used.** Supabase: Free $0 (2 active projects per person across every organisation they own or administer, paused after a week idle, 500 MB, no backups); Pro $25 per organisation with $10 of compute credit; every further project at least about $10; compute Micro about $10, Small $15, Medium $60; disk 8 GB then $0.125 per GB; 100,000 monthly users, 100 GB of files; 7 days of daily backups; point-in-time recovery from about $100. Neon: Free $0 (100 projects, 100 compute-hours and 0.5 or 1 GB each: Neon's pages disagree; sleeps after 5 idle minutes, cannot be switched off); Launch $0.106 per compute-hour and $0.35 per GB, no minimum; Scale $0.222 per compute-hour, with the 99.95% promise; restore history $0.20 per GB. R2: 10 GB free, then $0.015 per GB. Better Auth: $0.

| Size | Supabase | Neon + Better Auth + R2 | Neon, keeping Supabase Auth |
| --- | --- | --- | --- |
| **Today** (no real users; live and staging) | **$0**. Uses both of Mark's free projects. Pauses after a week idle (hence the keep-alive function). No backups | **$0**. Two of 100 free projects. The minute sweep cannot run: any schedule shorter than the 5-minute sleep keeps the compute awake, 182 compute-hours against 100 free. Restore window 6 hours | $0 + $0, with the user table in a project that has no backups |
| **BSR live, Moto Mangos in Bangkok** (database under 2 GB, photos under 10 GB, a few thousand users) | **$25** (Micro included). Staging **+$10** inside the organisation, or $0 as a Free project elsewhere. **$25 to $35** | Launch, always on at 0.25 CU: 182.5 h × $0.106 = **$19**; averaging 0.5 CU: $39. Storage and history about $1. Staging on Free. **$20 to $40** | $25 (Pro, for the Auth project) + $20 to $40 = **$45 to $65** |
| **50 shops** (20 GB database, 50 GB of files with documents, under 100,000 users) | $25 + Small ($5 after credit) or Medium ($50 after credit), disk overage $1.50, staging $10. **$40 to $90**; with point-in-time recovery **$140 to $190** | Launch at 0.5 to 1 CU: $39 to $77; storage $7; history about $1; R2 under $1. **$50 to $90**, recovery included. On Scale for the uptime promise: **$90 to $170** | $25 + the middle column = **$75 to $115** or more |

What the table says:

- **At production sizes the two cost about the same.** The move does not pay for itself in money.
- **Neon is clearly better for many small projects**: 100 free against 2, no week-long-idle pause, and a paid organisation with no floor per project. This is Mark's "free organisation for trials, paid one for what grows", and it is real. On Supabase each grown project costs at least $10 a month on top of the $25, and moving one between organisations works but the free side stays capped at two.
- **Recovery to a point in time is far cheaper on Neon** ($0.20 per GB against about $100 a month).
- **Keeping Supabase Auth and moving only the database costs more than staying**, and keeps a second vendor in the sign-in path. It also breaks the seven foreign keys to `auth.users`, because the users would live in another database.
- **Neither gives an uptime promise on its cheap plan.** Neon sells one on Scale; Supabase only on Enterprise (not on Team at $599). I did not study either status page's history, so I make no claim about which has been more reliable.

## 6. The assessment's recommendation (before the decision)

**Kept as written. Mark decided otherwise on 19 Nov 2026** (the table under the Summary): the move goes ahead if the spike passes. Of this section, the trial projects on Neon (6.1, point 3) and both additions in 6.3 were taken up; 6.2 is what applies if the spike says no-go.

### 6.1 Stay, for this database, for now

1. **Do not move Mango Works between Phase 3 and 3M.** Twelve to fifteen PRs go to changing vendors instead of to 3M and BSR's go-live, and the riskiest of them (sign-in, the access model, the path every booking takes) are the ones this repo has spent most care on. The monthly saving is about nil.
2. **Do not move partly.** Keeping Supabase Auth with the database on Neon costs more, keeps both vendors, and splits users from the tables that point at them.
3. **Put the trial projects on Neon now.** A Free Neon organisation for the small projects, a paid one for any that grows (a project transfers with its connection string unchanged, to an organisation on the same plan or higher). This frees Supabase's two free slots for Mango Works live and staging.
4. **At BSR go-live, put Mango Works on Supabase Pro in its own organisation** ($25; staging either $10 more or kept Free). Remove the keep-alive function then, as its TODO says.

### 6.2 When to decide again

Not by date; by event. Reopen this when any one is true:

- Supabase changes its prices or limits so that Mango Works costs clearly more than the Neon column in §5.
- A paying shop asks for an uptime promise in writing.
- Supabase has an outage that costs BSR bookings, or two in a quarter that staff notice.
- Neon Auth gains LINE (or generic OAuth). That removes the hardest part of the move.
- The SaaS layer (Phase 11) is planned: the last cheap moment before many shops' staff have accounts.

A later move is dearer than one made now in one way only: real users are signed out once and BSR needs a short maintenance window. Passwords survive (bcrypt hashes move as they are, per Better Auth's own guide). That is a small price for waiting.

### 6.3 Do the four rules still fit?

Yes, all four, and they are cheap. Two additions would make a later move much smaller; both are worth doing even if the move never happens.

| Rule | Verdict |
| --- | --- |
| 1. All database access through `packages/db` | **Keep.** It is what lets the Data API replace PostgREST by changing five files. Its worth depends on a PostgREST-shaped API existing on the other side, which is now true |
| 2. File storage behind one module | **Keep.** Build the module when 3M touches the marketplace's four files, not before |
| 3. Sign-in through one helper, nothing Supabase-only | **Keep, and build the helper before Phase 4.** Note that LINE is set up through a Supabase admin call (`customProviders`); that is set-up, not run time, and is fine |
| 4. RLS through the `my_tenant_ids()`-style helpers | **Keep, and widen it** (below) |

**Addition A: our own "who is calling" functions, used by Phase 3 from stage 1.** Rule 4 covers policies. It does not cover the 16 `auth.role()` checks in the booking functions, the `default auth.uid()` columns, or the audit function, and Phase 3 is about to write many more of exactly these. Add two functions in `platform_private`, for example `caller_id()` and `caller_is_service()`, that are the only places `auth.uid()` and `auth.role()` are read. New code calls them; a later migration can re-point the existing calls. Then a move changes two function bodies. **This needs Mark's yes and an edit to the Phase 3 plan before stage 1 is built.**

**Addition B: a short "do not start using" list in CLAUDE.md.** New code does not use `pg_net`, Vault, Realtime, Edge Functions, GraphQL, policies on `storage.objects`, or new foreign keys to `auth.users` (point at `profiles` or a platform table instead). Database jobs only queue; whatever calls the outside world runs in the app. Phase 3's plan already works this way ("Jobs only queue; the sender is app-side").

## 7. The plan

**Order: Phase 3 → the move → 3M → 1b.** After Phase 3 the booking core has settled; before 3M and BSR's go-live there are no real bookings to freeze. 3M then builds `marketplace_api` once, on the final stack.

**`main` stays able to run on Supabase until the cutover.** Each stage adds the Neon side behind a server-side switch (which sign-in, which data path, which file store) and merges with the switch off. That is what gives every stage a rollback: turn the switch back, or revert one PR. While both sides exist, CI runs the database tests on both stacks.

### 7.0 What the spike changed (23 Nov 2026)

The spike's write-up lists 18 points the plan got wrong or did not foresee ([`neon-spike.md`](neon-spike.md), "What the plan got wrong, or did not foresee"). Each is folded in where it belongs; this table says where.

| # | Spike point, in short | Where it now is |
| --- | --- | --- |
| 1 | Neon's `auth` schema is closed to us once the Data API is on: no table or function of ours in it, no USAGE, `auth.uid()` returns null through the Data API, no `auth.role()` | Stage 0, stage 2 |
| 2 | The Data API sets `request.jwt.claims` as PostgREST does (undocumented by Neon); our "who is calling" functions read it. All 58 `auth.uid()` and 16 `auth.role()` calls point at our own functions in the baseline | Decision 10, stage 0, stage 2 |
| 3 | `auth.users` cannot exist on Neon: its 13 references (7 foreign keys, 2 triggers, joins) point at our own users table in the baseline | Stage 2, stage 4, cutover step 3 |
| 4 | Enable the Data API on the empty database, then load the schema | Stage 2, stage 8 |
| 5 | No token is refused (401), not run as `anonymous`; the signed-out path needs a signed `role: anon` token | Stage 5 |
| 6 | Role timeouts are not applied, and Neon's roles cannot be altered; the login role's 8 s applies to every request | Stage 5, runbook line |
| 7 | We cannot administer Neon's roles (no altering or granting `authenticated`); §3.3's `app_authenticator` cannot be built | Stage 2, §7.2 |
| 8 | pg_cron can only be created in the database `cron.database_name` names; the baseline drops the `create extension` | Stage 2, stage 7, §7.3 |
| 9 | `cron.database_name` is set only through Neon's API or CLI, then a compute restart | Stage 7, stage 8 |
| 10 | The Data API's schema cache does not refresh itself; `NOTIFY pgrst` does nothing. Every migration run ends with a refresh | Stage 2 (migration tool), stage 8, cutover |
| 11 | Exposed schemas and the extra search path set through Neon's API; the Console's schema list can be stale | Stage 2, stage 8 |
| 12 | No role called `postgres`; the three `alter default privileges for role postgres` go; new objects get no grants by default | Stage 2 |
| 13 | `.single()` returns HTTP 200 and no error for zero rows (`null`) or several (the first). 35 call sites in the apps | Stage 4a (new), stage 5 |
| 14 | Three migrations check function bodies by md5; the baseline is built from the final schema, not by replaying them | Stage 2 |
| 15 | Better Auth does not check LINE's ID token signature in the redirect flow; keep our own HS256 check | Stage 4 |
| 16 | A new Netlify site starts with team-login protection, which blocks Neon from reading the key file and the providers from the callbacks. Draft deploys cost no credits; function calls do | Stage 4, stage 8 |
| 17 | A Free compute's cold start adds about 1.4 s to the first call; one cycle in 26 took 6 to 8 s | §7.3 |
| 18 | "The first call is no slower than the rest" fails for any new connection; the useful line is "no slower than a new connection to a database in use" | §7.1 row 2, stage 11 |

### 7.1 Stage 1: the spike

**Done, 23 to 24 Nov 2026. Decision: Go (Mark, 23 Nov 2026).** Results, figures and the clean-up list: [`neon-spike.md`](neon-spike.md). Seven rows passed outright; row 2's whole-night reading on the always-on compute was not reliable (the measuring computer was in and out of standby), so stage 11 watches live's first request after a long quiet spell. The spike's code is kept at the tag `archive/neon-spike-2026-11`, not on `main`.

| # | Answer in one line |
| --- | --- |
| 1 | Pass. Neon's median 39 to 52 ms lower than Supabase's on every call, its 95th percentile about 520 ms lower |
| 2 | Free: about 2.1 s on the first call after 10 idle minutes, about 1.4 s of it the sleep. Launch: no cold start after 10 minutes, 1 hour or 4 h 45 min; the 8 h 20 min reading is not reliable |
| 3 | Pass. `create role service_role nologin bypassrls` works in plain SQL |
| 4 | Pass, with a caveat: a 10-second call is cancelled at 8.4 s with `57014`, but by the login role's setting, not the token role's |
| 5 | Pass on codes and times (`55P03` after 6.3 s, `try_again`, nothing written; `57014`; `40P01`). One real difference: `.single()` |
| 6 | Pass. LINE and Google through Better Auth; RLS sees the right user; a forged role refused three ways |
| 7 | Pass. 1,440 runs in 1,440 minutes, none missed or overlapping |
| 8 | Answered: no token is 401; advisory locks work through the pooler; session `SET` leaks through the pooler; PostGIS and btree_gist in `extensions`; type generation works; a minute's cron keeps a Free compute awake |

What follows is the spike as it was planned, kept for the record.

On throwaway Neon projects in the new Free organisation and a throwaway Netlify site. No real data. Its only output on `main` is a write-up with numbers and a yes or no on each point. **Mark then says go or no-go.**

**What it must measure.**

| # | Question | How | Passes when |
| --- | --- | --- | --- |
| 1 | **Latency from Netlify server functions to Neon in Singapore, against today's Supabase in Singapore** | The same two calls, 200 times each, warm, from one Netlify function: a typical read (a product list with its prices, through the data API) and an RPC-style write (a booking function that takes locks and writes). Median and 95th percentile. **Both measured the same way, from today's function region (US East)**, in the same run | **Neon's median and 95th percentile are each no worse than Supabase's by more than 10% or 20 ms, whichever is larger** (Mark's line, 19 Nov 2026) |
| 2 | **Cold start** of a scaled-to-zero compute, and **none on an always-on compute** | First call after 10 idle minutes on a Free project, 20 times. The same on a Launch project with scale-to-zero off, after 1 hour and after a night idle | Always on: the first call is no slower than the rest. Scale-to-zero: the number is written down for staging (Neon says "a few hundred milliseconds"). **Corrected by the spike (point 18):** the always-on line cannot be met as written, because any new connection's first two calls are slow, idle or not (0.75 to 1.1 s against 0.25 s warm). The line used from now on, at stage 11 too: **no slower than a new connection to a database in use** |
| 3 | **Can a role made in SQL bypass RLS?** (our `service_role`) | Create it in SQL with BYPASSRLS; if refused, create it through the Console or API. Read a table whose policy would hide the row | A `service_role` exists that bypasses RLS, and the app's own login role does not |
| 4 | **Does the Data API apply a role's statement timeout?** | `alter role authenticated set statement_timeout = '8s'`, then a 10-second call through the Data API | The call is cancelled at 8 seconds with `57014`. If not, find where the timeout can be set, or fail the point |
| 5 | **Does the Data API handle our RPC calls?** | `.rpc()` and `.schema("platform")` through the supabase-js-shaped client against the real schema: arguments and results of every type we use (arrays, jsonb, composite results), errors with their codes. **Then the gate tests' lock behaviour**: one session holds a product lock at a gate; a booking through the Data API must answer `55P03` after 6 seconds (the function's own `lock_timeout`), the caller must answer `try_again`, and nothing may be written. Also `40P01` and `57014` reaching the caller unchanged | Every code arrives as it does through PostgREST today, at the same times |
| 6 | **LINE and Google sign-in through Better Auth**, with sessions mapped to our "who is calling" functions | Real LINE and Google test channels. Sign in, then a call through the Data API as that user; the two functions must answer the user's id and "not the service role". A token must not be able to claim another role. LINE's HS256 ID token (the case that broke OIDC on Supabase) checked | Both sign in; RLS sees the right user; a forged role is refused |
| 7 | **pg_cron on an always-on compute running the minute hold sweep** | Set `cron.database_name`, restart, schedule `release_expired_holds()` every minute for 24 hours; read `cron.job_run_details` | 1,440 runs, none missed, none overlapping; the sweep's own lock waits do not pile up |
| 8 | The rest of the unknowns from §2 and §3 | `anon` against `anonymous`; transaction advisory locks through the pooler; PostGIS and btree_gist in schema `extensions`; type generation; whether a minute's cron keeps a Free compute awake | Each has an answer in the write-up |

**Netlify's function region, which decides more of the latency than the vendor does.**

- **Where functions run today:** US East. Netlify's default for new sites is `cmh` (Ohio). `docs/PROGRESS.md` (10 Nov 2026) records "Functions run in US East (the plan can't change the region), so each page waits on round trips to Singapore".
- **How it is set:** in the Netlify UI under the site's Functions settings (Region, Configure), then a redeploy; old deploys keep their region. A `region` set for one function in code or `netlify.toml` overrides the site's.
- **Whether the plan allows it:** Netlify's docs say choosing a region is "available on all Pro and Enterprise plans", and the pricing page shows it as not included on Free and Personal. Singapore is offered (`sin`). Pro is $20 a month.
- **Netlify Pro is not taken now (Mark, 19 Nov 2026).** It is a final step of the build, just before go-live: upgrade to Pro and move the functions to Singapore (stage 11, §7.8).
- **So the spike compares Neon and Supabase from US East, both measured the same way.** What it answers is whether Neon is slower than Supabase, not how fast the sites will be. **Absolute latencies will drop for both once the functions move to Singapore**, because every call stops crossing to Singapore and back. A difference of a few milliseconds between the vendors is a small share of a US East round trip and a larger share of a Singapore one, which is why the line has a fixed part (20 ms) as well as a share (10%), and why stage 11 measures again.

**The Supabase side of the comparison uses staging (allowed by Mark, 19 Nov 2026).** The spike may read and write a throwaway shop on `mango-works-staging`, and **must remove it afterwards**: the shop, its users and everything under it, with a count before and after in the write-up to show nothing was left. It touches no other shop's rows and never touches live.

**Rollback:** delete the throwaway projects and site. Nothing else exists. **Done in part:** the Launch project and its organisation were deleted on 23 Nov 2026 (US time); the rest is Mark's clean-up list in `neon-spike.md`. Staging was counted before and after (91 tables, 4,487 rows both times); live was never touched.

### 7.2 If the Data API fails the spike

**Not needed: the Data API passed** (rows 1, 3, 4 and 5). Kept for the record, with one correction from the spike (point 7): running our own PostgREST in front of Neon needs login and request roles of our own **with names other than Neon's** (`authenticator`, `authenticated`), or the Data API left off, because we cannot alter or grant Neon's roles.

In order:

1. **Run PostgREST ourselves in front of Neon**: the same software Supabase runs today, as one small always-on container in Singapore (Fly.io or Railway, a few dollars a month). All 1,510 calls stay as they are, and we set the roles and timeouts ourselves. The cost is one more service to keep running and to watch. It is measured in the same spike before being chosen. (PostgREST's own documentation was not read for this document.)
2. **If that fails on latency too: no-go.** Stay on Supabase and decide again on the events in §6.2. Rewriting 1,510 calls as SQL is not a fallback.

### 7.3 Staging on Neon Free

- **Scale-to-zero cannot be switched off on Free.** The compute sleeps after 5 idle minutes; the first request after that pays the cold start. Mark accepts this on staging. **Measured (spike row 2, point 17):** about 2.1 s on the first call after 10 idle minutes (median of 20; 1.5 to 6.1 s), of which about 1.4 s is the sleep, and the second call is often slow too. One cycle in 26 took 6.1 s and then 7.7 s: inside Playwright's 15-second wait, but close to the 8-second statement timeout. Not "a few hundred milliseconds".
- **Staging runs no schedule at all.** The spike settled it (row 8): with the minute sweep scheduled on a Free project and nothing else connecting, the compute stayed `active` on all 106 minute readings and the job ran 107 times in 107 minutes; five minutes after unscheduling it the compute was `idle`. A minute job on Free means awake all month: 0.25 CU for about 730 hours is about 182 compute-hours against 100 free, after which Neon suspends the compute until the next month. So the sweep cannot be scheduled on a Free staging project, and neither is any other job: no `cron.database_name` call, no pg_cron extension on staging. Nothing breaks: the migration that created the job says a hold that has run out is already left out by reads and bookings, and the next booking releases it. Staging will show run-out holds for longer than live does. The sweep can be run by hand (`select platform.release_expired_holds()`) when a test needs it.
- **So scheduling moves out of the migrations.** Today each job is scheduled wherever pg_cron is available, which on Neon is everywhere, and on Neon the migration's `create extension pg_cron` itself fails in any database but the one `cron.database_name` names (point 8). In the baseline there is no `create extension pg_cron` and no `cron.schedule`; a small per-environment script (stage 7) does both, and it is run on live only.
- **What staging tests and what it does not.** Staging tests screens, sign-in, the data path and migrations. It does **not** test the scheduler, an always-on compute or live's timings. Those are tested on the local stack (pg_cron included), in the spike, and in the rehearsal, which runs on the future live project while it is still empty (stage 8).
- **Limits to watch:** 100 compute-hours a month (400 hours awake at the smallest size); 1 GB of storage (the spike's reading of Free; staging's database is 31 MB and the full schema on Neon 20 MB); a 6-hour restore window.
- **Playwright against staging** already allows 15-second waits; the first test after an idle spell pays the cold start, occasionally 6 to 8 seconds.

### 7.4 Point-in-time recovery on live

Neon's "instant restore" on the Launch plan:

- **What it covers:** the whole database can be put back to any moment inside the window, or a copy made as it was at that moment. The window is **1 day by default and can be set up to 7 days** on Launch (30 on Scale). **Set it to 7 days on live.** It costs $0.20 per GB a month of stored change history, on the main branch only. Because Better Auth keeps users in the same database, users and their data go back together, which is not so today.
- **What it does not cover:** anything older than the window; files in R2; a mistake noticed after 7 days. Neon's page also says restore to a moment is not supported on a branch made from a snapshot restore.
- **So, as well:** a manual Neon snapshot before each migration to live (100 are included), and the runbook's own dump kept outside Neon weekly, as today's runbook keeps one outside the repo. SPEC's "restore drill before Gate A" stays, done on Neon.

### 7.5 The stages

**Fable build** for sign-in, RLS and roles, the data copy and the cutover. **Opus + Fable check** where a mistake cannot reach a booking, money or who may see what.

| # | Stage | Model | Done when | Rollback |
| --- | --- | --- | --- | --- |
| 0 | **Inside Phase 3, from its stage 1: our own "who is calling" functions** (decision 10): `platform_private.app_uid()` and `app_role()` (phase-3-plan §3.11). On Neon their bodies read `request.jwt.claims` (`sub`, `role`), because `auth.uid()` returns null there and `auth.role()` does not exist (spike points 1 and 2) | Fable build (it is Phase 3's) | No new code reads `auth.uid()` or `auth.role()` directly | It is ordinary Phase 3 work; revert with its PR |
| 1 | **Spike** (§7.1). **Done; Go, 23 Nov 2026** | Fable | Mark has a number or a yes or no on every row, and says go or no-go | Delete the throwaway projects and site |
| 2 | **Baseline, roles and local stack.** One baseline made from the final schema (the applied migrations stay as history, unedited) with **no object in, and no reference to, the `auth` schema**: all 58 `auth.uid()` and 16 `auth.role()` calls point at the two functions, and the 13 `auth.users` references at our own users table; no pg_cron, no `for role postgres`; the bootstrap of roles; explicit grants; the Compose stack; the harness changes of §4; the migration tool, which ends every run on Neon with a schema-cache refresh; CI on both stacks. Detail: below | Fable build | Every database test file passes on the new stack, the rewritten default-grants test and the gate tests included; the baseline loads on a Neon branch whose Data API was enabled while it was empty; a function added by a migration run answers through the Data API with no step by hand | Revert the PR; delete the Neon branch. The Supabase stack and its tests are untouched |
| 3 | **Sign-in helper, still on Supabase** (CLAUDE.md rule 3): every sign-in, sign-out, session and "who is this" call goes through one module | Opus + Fable check | Playwright sign-in specs pass unchanged; ESLint refuses `.auth.` outside the helper | Revert the PR |
| 4 | **Better Auth behind the helper**, switch off: email and password with bcrypt checking, email link, Google, LINE, both brands' emails through Resend, tokens that carry `role: authenticated` from a constant. **Email verification must be required here too** (Better Auth's `requireEmailVerification`): Supabase's "Confirm email" is on in live and staging and anonymous sign-ins are off (checked 19 Nov 2026, security audit H1), and the move must not loosen either. Users land in the users table of stage 2. Our own HS256 check of LINE's ID token (spike point 15). Detail: below | Fable build | Playwright sign-in for every method on both apps with the switch on; a token cannot be made to say `service_role` (the spike's three forgeries refused again); LINE's ID token with a wrong signature refused; with the switch off nothing changes | Switch off; revert the PR |
| 4a | **`.single()` wrapper in `packages/db`, before the move and still on Supabase** (spike point 13; a separate PR, can be done now). One helper in `packages/db` gives "exactly one row" and "zero or one row" with PostgREST's error (`PGRST116`) on any backend; the apps' 35 `.single()` calls (and their `.maybeSingle()` calls) move onto it; ESLint refuses both outside `packages/db` | Opus + Fable check | Unit tests of the wrapper for zero, one and several rows; typecheck, lint, unit, database and Playwright suites unchanged on Supabase | Revert the PR |
| 5 | **Data path**, switch off: the five `packages/db` factories gain a Data API side (or the fallback of §7.2); the service path; a signed `role: anon` token for every signed-out call (no token is refused, spike point 5); the wrapper of 4a in use on both sides; the 12 stray `@supabase/*` files brought inside. Detail: below | Fable build for the service path and the factories; Opus + Fable check for the stray files | Typecheck, lint, unit, database and Playwright suites pass on both sides of the switch; the smoke suite passes against a Neon branch | Switch off; revert the PR |
| 6 | **Public listing images to R2**: rule 2's module; R2 for the three public photo buckets (`shop-photos`, `model-photos`, `catalog-photos`) only, with no private bucket (private files stay in each shop's Google Drive, decision 49; `docs/platform/file-storage-design.md`); the six storage policies become server-side checks that hand out upload addresses; a copy script that can be run again | Opus + Fable check (Fable reads the access checks) | Every photo loads from R2 on a copy of staging's data; an upload by a non-member is refused | Switch off: the module reads Supabase Storage again. Files copied to R2 are left; nothing was deleted |
| 7 | **Jobs**: the per-environment scheduling script (§7.3), live only: set `cron.database_name` to the app's database through Neon's API (there is no Console setting), restart the compute, then `create extension pg_cron` and schedule the jobs (spike points 8 and 9). Staging runs none. Remove the keep-alive function at cutover, not before | Opus + Fable check (the job SQL is unchanged) | On a Launch project each job runs on schedule (the spike's reference: 1,440 runs in 1,440 minutes, none overlapping); run twice, the script writes once; on staging no job and no pg_cron | Unschedule on Neon. Supabase's jobs were never touched |
| 8 | **Neon projects, staging's move and the rehearsal.** Create the paid organisation, the live project (Launch, always on, Singapore, 7-day window) and the staging project (Free). On each: enable the Data API **while the database is empty**, set its exposed schemas and extra search path through Neon's API, run the bootstrap and the baseline, refresh the schema cache. Move staging first, on Mark's word. Then rehearse the whole cutover into the still-empty live project with a copy of staging's data, time it, and practise the rollback. Detail: below | Fable (the copy script and the rehearsal); Mark runs anything that touches staging | The script runs start to finish without a hand edit; the read-only checks match on both sides; rollback practised once; staging's first month stays under 100 compute-hours | Staging: point its sites back at the Supabase staging project, which is kept. Live project: empty it |
| 9 | **Cutover of live** (§7.6) | Fable, with Mark at the keyboard for every command on live | The checks match and Mark says go | §7.7 |
| 10 | **Clean-up, 30 days later, on Mark's word**: remove the switches and the Supabase side; drop `@supabase/*`; pause, then delete the Supabase projects; update CLAUDE.md, the runbook and the specs | Opus + Fable check | Nothing in the repo names Supabase except history | Before the projects are deleted: restore the switches from git. After: none, which is why it waits 30 days and for Mark's word |
| 11 | **Go-live preparation: Netlify Pro, functions to Singapore** (§7.8). The last step of the build, just before go-live; not tied to the cutover | Mark makes the change in Netlify; Opus + Fable check for the measurement and the test timeouts | Both sites' functions run in `sin`; the spike's three calls measured again from Singapore; live's first request after a long quiet spell watched (the spike's one long-idle reading was unreliable) | Set the region back and redeploy; the plan can be lowered again |

Stages 3 to 7 can overlap once stage 2 is merged; 4 needs 3. Stage 4a needs nothing and can be done before the move starts; 5 needs 4a. Stage 8 needs all of 2 to 7.

#### Stage 2 in detail (what the spike added)

The spike makes stage 2 larger than first planned: before, the `auth` schema could be left as it was and re-pointed later; on Neon the schema does not load at all until nothing in it names `auth`.

- **Order on a Neon database** (points 4 and 11): create the database, **enable the Data API while it is empty** (enabling it on a database that already has an `auth` schema was not tried and probably fails), set the exposed schemas (`public`, `platform`) and the extra search path **through Neon's API** (the Console's list was stale in the spike and it has no search-path field; read the result back from the API, not the Console), then the bootstrap, then the baseline, then a schema-cache refresh.
- **Our own "who is calling" functions are in the baseline from the start** (points 1 and 2). `platform_private.app_uid()` and `app_role()` read `current_setting('request.jwt.claims', true)` (`sub` and `role`), which the Data API sets from the checked token as PostgREST does. They return empty with no request (pg_cron, a migration, a console), as phase-3-plan §3.11 says. All 58 `auth.uid()` and 16 `auth.role()` calls in the schema, `public.shop_numbers_readable()` among them (§8), call them instead; nothing in the baseline reads `auth.*`. In the spike two stand-ins did exactly this and every policy, booking function and audit row worked.
- **Our own users table is in the baseline from the start** (point 3). The 13 references to `auth.users` (7 foreign keys, 2 triggers, joins) and the reads of `auth.identities` point at it. Better Auth writes to it (stage 4); at cutover the users are copied into it (§7.6 step 3). Its shape, and how it sits beside `profiles` and Better Auth's own tables, is open (§8).
- **Built from the final schema, not by replaying migrations** (point 14): `20261117000200`, `20261118000100` and `20261119000100` check function bodies by md5 before replacing them, so a baseline that re-points `auth.uid()` inside those bodies cannot be made by replay.
- **Dropped from the baseline:** `create extension pg_cron` and every `cron.schedule` (point 8; stage 7 does both, live only); the three `alter default privileges for role postgres` (point 12: there is no `postgres` role, and on Neon new objects get no grants by default, so the default-grants rule holds without them; the test is rewritten for it).
- **Roles** (points 5 and 7, row 3). On Neon the Data API brings `authenticator` (the login role), `authenticated` and `anonymous`; they belong to Neon and we cannot alter them or grant `authenticated` to a role of ours. The bootstrap makes `anon` and `service_role` (`nologin`; `service_role` with `bypassrls`, proven in row 3) and grants both to `authenticator`, so a token's `role: anon` or `role: service_role` can be taken. It uses Neon's `authenticated` as it is. The 207 grants to `anon` stay as they are. No `app_authenticator` (§3.3 cannot be built). On the local stack (plain Postgres and PostgREST, which we do own) the bootstrap makes all four, with the same names and settings as Neon's (`authenticator` with `statement_timeout = 8s`).
- **The migration tool** (point 10; decision 9, §8): every run on Neon ends with a Data API schema-cache refresh through Neon's API. `NOTIFY pgrst` does nothing on Neon (it is still what the local PostgREST needs, so the tool does whichever the target needs). Without the refresh, a new function or table answers `PGRST202`/`PGRST205` through the API although it is in the database. The tool needs a Neon API key per environment, kept like the other secrets.
- **Type generation** (row 8): `supabase gen types typescript --db-url <address> --schema public,platform` against a Neon address gives today's `database.types.ts` text for text, apart from the `graphql_public` block. The address needs `channel_binding` removed or the CLI is refused. (§2's caveat stands: `--db-url` goes away in CLI v4.)
- **Checks added:** a static check that nothing in the baseline names `auth.`; `caller-functions.test.ts` reduced to the two functions; the baseline loaded on a Neon branch prepared in the order above; one migration run on that branch adding a function, which then answers through the Data API with no hand step.
- **Rollback:** unchanged (revert the PR), plus delete the Neon branch.

#### Stage 4 in detail

- **The token** (row 6): ES256 with a `kid`, `sub` = the user's id, `role: authenticated` from a constant, 900 s, checked by the Data API against our JWKS address. The spike's three forgeries (payload changed; signed by another key under our `kid`; an update-user request carrying a role field) are tests here.
- **LINE** (point 15): Better Auth (1.7.27) decodes LINE's ID token without checking its signature in the redirect flow. Keep our own HS256 check with the channel secret. With the `openid profile` scopes LINE's token carries **no email**, so a LINE user may have none.
- **Netlify** (point 16): a new site in the team starts with team-login protection on every deploy, which stops Neon reading the key file (every call then fails 401) and stops LINE and Google reaching the callbacks. Every site and deploy that Neon or a provider must reach has it off; check this on each environment, previews included, before blaming the token.

#### Stage 5 in detail

- **The signed-out path** (point 5): a request with no token is refused (HTTP 401); it is not run as `anonymous`. The public client factory sends a signed `role: anon` token, as Supabase's anon key is today. (A token with no `role` claim would run as Neon's `anonymous`; never issue one.)
- **The service path** (row 3, row 8): a short-lived `service_role` token signed on the server, or a direct pooled connection with `set local role service_role` inside a transaction (works; role and claims are gone after commit). The direct way **cannot** be used for `authenticated` (point 7).
- **Session settings through the pooler leak** (row 8): a session `set` on one pooled client was seen by another. Only `set local` inside a transaction, as §3.4 pitfall 2 says.
- **`.single()`** (point 13): the Neon side must go through stage 4a's wrapper. With no rows Neon returns `null` and no error; with several, the first row and no error. Any caller that relied on the error for "not found" or "must be unique" would otherwise go wrong quietly.
- **Error text** (row 5): codes and HTTP statuses match PostgREST's on every check but `.single()`; messages differ (`42501` has no "GRANT …" hint; "function not found" and "schema not exposed" are worded differently). Nothing may branch on message text.
- **Timeouts** (point 6, row 4): every request runs with the login role's 8 seconds, whatever role the token names; `anon` (3 s on Supabase today) gets 8 s too. We cannot change it. A function's own `set statement_timeout` does not cancel a running call; its own `set lock_timeout` does work, which is the 6-second rule. So "6 s under 8 s" holds on Neon because Neon's default happens to equal Supabase's. **A runbook line**, and the smoke suite reads `statement_timeout` through the Data API as each role, so a change of Neon's default is caught.
- **Smoke suite additions:** `.single()` against zero and several rows through the wrapper; a call with no token (401); a public read with the anon token; `statement_timeout` as each role; a held lock answering `try_again`.

#### Stage 8 in detail

- **Each project is prepared in stage 2's order** (Data API on the empty database, schemas and search path by API, bootstrap, baseline, cache refresh). Live also gets stage 7's `cron.database_name` call and a compute restart before its jobs are scheduled; staging gets none.
- **Staging's sites and previews** must not have Netlify's team-login protection where Neon or a provider has to reach them (point 16).
- **Every migration run after this,** on staging and on live, ends with the schema-cache refresh; the runbook says so.

**Files after decision 49** (private files in each shop's Google Drive, designed in `docs/platform/file-storage-design.md`): only public photos move to R2, so §2's "private documents by presigned address" and §5's "50 GB of files with documents" no longer apply; at 50 shops the public photos stay inside R2's free 10 GB. Private files are outside the restore window as well as outside R2: the shop's Drive is their only copy.

### 7.6 Cutover

Data copy is by dump and restore, not by replication. The database is small (minutes to copy), Neon's import assistant refuses Supabase, and replication out of Supabase needs its paid IPv4 add-on for little gain.

Before the day:

1. Register the new sign-in return addresses with Google and LINE (they move from the Supabase project's address to our own domains). Keep the old ones registered.
2. Lower nothing and delete nothing on Supabase.

On the day, in a quiet hour for Bangkok:

1. Both sites to a maintenance page. From here no write reaches Supabase.
2. Take the runbook's backup of live (`docs/RUNBOOK-GO-LIVE-PLATFORM.md`), outside the repo as it says.
3. Dump data only from `public`, `platform` and the users (`auth.users`, `auth.identities`), over the direct connection. Restore into the Neon project, which already holds the baseline schema (with the Data API enabled before it was loaded, and its cache refreshed after the last migration). Load users through the Better Auth mapping **into our own users table**: nothing may be restored into Neon's `auth` schema, which we cannot write (spike point 3). Reset every sequence.
4. Run the same read-only checks on both sides and compare (a script written in stage 8, in the manner of the runbook's `checks.sql`, which I did not read): row counts per table, sums of money columns, the count of live reservations and blocks, the highest order number.
5. Copy the public listing images to R2 (done ahead; a last pass for anything new).
6. Turn the switches on in both Netlify sites' environment variables and deploy.
7. Smoke test behind the maintenance page: sign in by each method, one staff booking, one online hold and its expiry by the sweep, one photo upload; a signed-out page that reads shop data (the anon token); `cron.job_run_details` showing the minute sweep running on live.
8. Mark says go; the maintenance page comes down. **Everyone signs in again once**: sessions do not move. Passwords do.

### 7.7 Rollback of the cutover

- **Supabase is left exactly as it was at step 1**, running and unwritten, for 30 days.
- **Before the maintenance page comes down**, rollback is: switches off and publish the previous deploy (Netlify keeps it). Nothing is lost, because nothing was written.
- **After it comes down, the point of no return is the first real booking or payment on Neon.** From then a rollback loses what was written since, unless it is copied back by hand. So the smoke test in step 7 must be complete, and the first day is watched: if something is wrong, the maintenance page goes back up first, and the choice is fix forward or copy back the few rows by hand.
- Because the move happens before BSR is live, there should be no real bookings yet, and rollback stays free for as long as Supabase is kept.

### 7.8 Stage 11: go-live preparation

Decided 19 Nov 2026: **Netlify Pro is not taken during the build.** Functions stay in US East until then, and the tests keep their longer waits for previews.

The last step of the build, just before go-live:

1. Upgrade the Netlify team to Pro ($20 a month on 19 Nov 2026).
2. Set both sites' function region to Singapore (`sin`) in the Functions settings, and redeploy both. Old deploys keep their old region.
3. Measure the spike's three calls again (product list, `pricing_inputs`, `reserve`), from Singapore, against the live Neon project, and write the numbers beside the spike's. Expect them to be far lower than the spike's: the calls no longer cross to Singapore and back.
4. **Watch live's first request after a long quiet spell** (the first of the morning, Bangkok time), end to end from a Netlify function in Singapore, on several mornings. The spike could not measure this cleanly: its one long-idle reading (8 h 20 min, 3,651 ms) was spoiled by the measuring computer, and its 4 h 45 min reading (1,180 ms) showed no cost of idleness. The line (spike point 18): **no slower than a new connection to a database in use**, measured the same way the same day. A Netlify function instance that has been idle starts cold itself; tell the two apart (function cold start against the database call). If the line fails, look at Neon's compute settings first.
5. Check that nothing relied on the slow path: test timeouts, the 8-second statement timeout and the 6-second lock timeout are unchanged; the Playwright waits for previews can come down.

It is independent of the Neon cutover and comes after it. **Rollback:** set the region back to the default and redeploy.

## 8. Still open

Decided on 19 Nov 2026: the seventeen rows under the Summary, Mark's answers to this section's earlier questions among them (13 to 17). What is left:

| # | Open | Options | My recommendation | Needed by |
| --- | --- | --- | --- | --- |
| 1 | Migration tool (decision 9; confirmed 19 Nov 2026 that it waits for the spike) | (a) Supabase CLI pointed at Neon; (b) a small SQL-file runner. Either must end every run on Neon with a Data API schema-cache refresh through Neon's API (spike point 10) | The spike is done; now due. I lean **(b)**, which can make the refresh call itself | Stage 2 |
| 4 | Our own users table (spike point 3) | (a) Better Auth's own `user` table, renamed into our schema, the 13 references pointing at it; (b) a table of ours (or `profiles`) that Better Auth's tables point at. Either way it must exist on the Supabase stack too while both run (fed from `auth.users` there) | Needs a design before stage 2 | Stage 2 |
| 5 | Where the `role: anon` token is signed and how long it lives (spike point 5) | Signed on the server per request, or a long-lived public token like today's anon key; the spike saw a one-hour token run out mid-test (401 `PGRST303`) | Needs a design before stage 5 | Stage 5 |
| 2 | Staging once the move is done | (a) Stay on Neon Free; (b) a paid project if the cold start or the 100 hours get in the way | **(a)** until it annoys | After stage 8 |
| 3 | Neon plan for live later | (a) Stay on Launch; (b) Scale, for the 99.95% promise at about twice the compute price | **(a)** until a shop asks for the promise in writing | When a shop asks |

Also to replace in the move: `public.shop_numbers_readable()` calls `auth.role()` directly (added by PR 57, `20261120000100_marketplace_security_audit.sql`), a Supabase-only dependency.

## 8a. Open points: options and recommendations (prep for Fable design review)

**Written 25 Nov 2026, from `main` at `25a82df` (PR 80 merged; 71 migrations). Docs only: nothing was run, built or tested, and no Neon, Supabase, Netlify or provider console was opened.** Its purpose is to give the Fable design review one place with each open decision, what we already know, and a recommendation. **Nothing here is decided.** §8 and the decisions under the Summary stand as written. Each point below is a proposal for Mark.

**Where the points come from.** §8 lists five numbered rows (1 to 5) and one "also to replace" note. Mark asked for those five, then for every other decision the plan or the spike's 18 points leaves open, each marked as added. **Points 6 to 12 are added by this section** and are each marked **[added in §8a]**. Point 6 is §8's "also to replace" note. Points 7 to 12 are decisions that §7, the spike write-up or the code leave open without saying so. All 18 spike points were checked against §7.0: each has a stage that deals with it, and only points 3, 5, 10 and 17 still leave a choice open. Those four are in points 4, 5, 1 and 2 below. Twelve points in all.

**Facts and inferences.** A statement with a file reference, a spike row or a spike point is documented fact. **Anything marked *(inference)* is my reading** and has not been checked. Prices are §5's, read 19 Nov 2026.

**The limits every recommendation keeps to** (Mark's): one database for the platform and Moto Mangos; LINE and Google sign-in; private files only in each shop's Google Drive (decision 49); live (`mfaqydyoweerlqsgwnay`) untouched until the cutover; Netlify Personal until go-live (Pro and Singapore functions are stage 11); a slight cold start for the first user after a quiet spell is acceptable, and no other performance loss is; free tiers until the product proves itself.

### Summary

| # | Point | Recommended | Confidence | Must be proven before deciding |
| --- | --- | --- | --- | --- |
| 1 | Migration tool | (b) Our own small SQL-file runner, which also refreshes the schema cache | Medium | That Neon's API refresh can be called and checked from a script; whether the runner should replace the Supabase CLI locally now |
| 2 | Staging after the move | (a) Neon Free; run the hold sweep by hand | High | Staging's first month stays under 100 CU-hours with real Playwright runs |
| 3 | Neon plan for live later | (a) Launch, until a shop asks for an uptime promise in writing | High | Nothing before go-live; watch live's compute size in the first months |
| 4 | Our own users table | (b) `public.users`, ours, with a nullable email; Better Auth's tables point at it by id | Medium | Better Auth writing to a table we own by id; a LINE user with no email end to end |
| 5 | The `role: anon` token | (b) One long-lived anon token signed once by a script, kept server-side, rotated with the key | Medium | The Data API trusting one JWKS that holds two keys |
| 6 **[added in §8a]** | `shop_numbers_readable()` and the rest of `public` | (b) Re-point in the baseline; extend the static test to `public` now | High | The count of direct `auth.*` uses left in `public` |
| 7 **[added in §8a]** | The service path on Neon | (a) A short-lived `service_role` token signed on the server | Medium | A `service_role` call from a Netlify function through the Data API, same codes |
| 8 **[added in §8a]** | Generated types after Supabase CLI v4 | (a) Pin the CLI version that still has `--db-url` | Medium | That the pinned CLI keeps running against plain Postgres |
| 9 **[added in §8a]** | The local stack's database image | (a) Our own small image: Postgres 17 with PostGIS and pg_cron | Medium | Build time in CI; same extension versions as Neon |
| 10 **[added in §8a]** | One Better Auth for two apps, or two | (b) One user table and one signing key, a Better Auth instance in each app | Medium | Better Auth's JWT plugin signing with a key we supply and share |
| 11 **[added in §8a]** | Two schema histories while both stacks run | (a) Every new migration written once, run on both stacks; the baseline rebuilt at the end | Low | That every new migration loads on both; a CI check that compares the two schemas |
| 12 **[added in §8a]** | The session check on every request | (a) Better Auth's cookie cache, so no database call per request | Medium | That a cookie-cached session plus a token costs no more than today's `getClaims()` |

### 1. Migration tool (§8 row 1; decision 9)

**Question.** What applies migrations to Neon (staging and live), the local stack and CI once Supabase's CLI no longer runs the database?

**What we already know.**
- On Neon every run must end with a Data API schema-cache refresh through Neon's API. `NOTIFY pgrst` does nothing there (spike point 10; stage 2 detail). The local PostgREST still needs `NOTIFY pgrst`.
- The history today is `supabase_migrations.schema_migrations`, written by `supabase db push` (§1 row 13). The CLI is a root dev dependency (`package.json`: `"supabase": "^2.121.0"`).
- The spike loaded all 67 migrations of the time with its own small loader, `spike/neon/scripts/load-schema.mjs`, which wrote its own history table (`spike.migrations`, `spike/neon/sql/bootstrap.sql` §8). It set the Data API's schemas through Neon's API (`spike/neon/scripts/data-api-settings.mjs`).
- The baseline is built from the final schema, not by replay (spike point 14). Neon has no CLI of its own and points to Drizzle, Prisma, Flyway, dbmate and others (§2).
- `supabase db push --db-url` is documented for self-hosted Supabase only, and `--db-url` goes away in CLI v4 (§2).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Supabase CLI pointed at Neon** (`db push --db-url`), plus a separate refresh step | No new dependency now. But it is used outside what it is documented for, it disappears in v4, and it keeps a Supabase tool in a stack meant to be free of Supabase. The refresh is a second command that can be forgotten, and a forgotten refresh makes a new function answer `PGRST202` (spike point 10). Free |
| (b) | **Our own SQL-file runner** (a short Node script in the repo, using the `pg` driver already in the spike), with a history table, one transaction per file, a checksum per applied file (so an edited applied migration is refused: CLAUDE.md's rule), and the refresh as its last step, chosen per target (Neon API or `NOTIFY pgrst`) | About one PR inside stage 2. Needs Mark's yes for the `pg` driver if it is not already present (CLAUDE.md: ask before a dependency) *(inference: `pg` may already come in through Better Auth's Postgres adapter in stage 4)*. We own its bugs; a runner is small and the rules it must keep are few. Free. Needs a Neon API key per environment, kept as a secret (stage 2 detail) |
| (c) | **An off-the-shelf runner** (dbmate, Flyway, or Drizzle's migrator) | A tested history table and locking. But a new dependency and a binary in CI, it does not know Neon's refresh (a wrapper is still needed), and Drizzle or Prisma bring a schema model we do not use. Free for the open-source editions |

**Recommendation: (b).** The one step that matters most on Neon, the refresh, is the step no general tool does. A runner that does it every time, and refuses to report success without it, removes a failure the spike showed is easy to make. It is the plan's existing lean (§8 row 1).

**To prove first.** On a Neon branch: the runner applies a migration that adds a function, refreshes, and the function answers through the Data API with no hand step (already stage 2's "done when"). The refresh call's own success is read back, not assumed. Running the same file twice writes once. An applied file changed by one byte is refused. **Also to decide in the review:** whether the runner replaces `supabase db push` for staging before the move, or only on the Neon side *(inference: Neon only is safer; the Supabase side keeps its current tool until stage 10)*.

### 2. Staging once the move is done (§8 row 2)

**Question.** Does staging stay a Neon Free project after stage 8, or become paid?

**What we already know.** Decision 5: staging is a Neon Free project that may scale to zero. Measured (spike row 2, point 17): about 2.1 s on the first call after 10 idle minutes, occasionally 6 to 8 s. Staging runs no schedule (§7.3), because a minute job keeps a Free compute awake all month (182 CU-hours against 100; spike row 8). Staging's database is 31 MB; Free allows 0.5 or 1 GB (Neon's pages disagree, §5).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Stay on Neon Free** | $0. Cold starts in Playwright (inside its 15 s wait; one in 26 near the 8 s statement timeout). No scheduler, so staging shows run-out holds longer than live, and the sweep is run by hand. If CI or a long test session uses up the 100 CU-hours, Neon suspends the compute until the next month *(inference: a busy test month is the likeliest way to reach it)* |
| (b) | **A paid project in the Launch organisation, scale-to-zero on** | Pay per compute-hour ($0.106; roughly $1 to $10 a month at staging's use *(inference)*). No 100-hour ceiling; same cold start |
| (c) | **Paid, always on** | About $19 a month (§5). No cold start, and the scheduler could run. Pays for comfort, not for anything a user sees |

**Recommendation: (a)**, as §8 says, with a written trigger for (b): the month's CU-hours pass 70, or a cold start fails a CI run twice in a week. Free tiers are preferred and nothing on staging reaches a customer.

**To prove first.** Staging's first month after stage 8 under 100 CU-hours with real Playwright runs (stage 8's "done when"). A test that needs the sweep calls `platform.release_expired_holds()` itself.

### 3. Neon plan for live later (§8 row 3)

**Question.** Does live stay on Launch, or move to Scale for the 99.95% uptime promise?

**What we already know.** Decision 4: Launch, always on, Singapore, about $19 a month at 0.25 CU. Scale is about twice the compute price ($0.222 against $0.106 a compute-hour) and is the only plan with an uptime promise (§2, §5). At 50 shops: Launch $50 to $90, Scale $90 to $170 a month (§5).

**Options.** (a) **Stay on Launch**, until a shop asks for an uptime promise in writing. (b) **Scale from go-live**: double the compute bill, a promise no shop has asked for. (c) **Launch, with a size limit raised** as load grows *(inference: compute size is a setting on both plans, so growth alone does not force Scale)*.

**Recommendation: (a)**, with (c) as the growth path. It is §8's recommendation and Mark's preference for cheap plans until the product proves itself. §6.2's reopening events still apply.

**To prove first.** Nothing before go-live. In the first months, watch live's compute use against 0.25 CU (stage 11 measures latency from Singapore).

### 4. Our own users table (§8 row 4; spike point 3)

**Question.** What table do the 13 references to `auth.users` point at in the baseline, and how does it sit beside `profiles` and Better Auth's own tables, given that a LINE user may have no email?

**What we already know.**
- On Neon `auth.users` cannot exist: the `auth` schema belongs to Neon once the Data API is on (spike points 1 and 3). The references: `profiles.id`, `memberships.user_id` (two migrations), `audit_events.actor`, four `created_by`/`recorded_by` defaults with foreign keys, the review follow-up's `not exists (select 1 from auth.users …)`, two joins for the member list, and three triggers on `auth.users`/`auth.identities` that make a profile, copy an email change, and record `line_user_id` (`20261024000200_profiles.sql`; `20261109000200_platform_memberships.sql:10,99`; `20261110000100_platform_schema.sql:135,202`; `20261110000200_platform_audit.sql:18`; `20261110000500`, `20261111000200`, `20261113000300`, `20261116000100`, `20261119000100`). Phase 3 adds none: "the 'who' columns are plain ids" (`20261124000100_platform_orders.sql:28`).
- **LINE gives no email today either.** Both apps' LINE providers ask for `openid profile` with `email_optional: true` (`apps/*/scripts/create-line-provider.mjs`). The spike's LINE token carried no email (row 6). The spike gave such a user a placeholder address that can never be real (`${sub}@line.spike.invalid`, `spike/neon/lib/auth.mjs`).
- `profiles.email` is already nullable, but `profiles_notify_channels_has_email` requires `'email'` in `notify_channels` for every profile (`20261024000200_profiles.sql`). *(Inference: a LINE-only customer therefore has email as a notification channel and no address to send to, today as well. That is a product question beyond the move, and is noted here only because the users table makes it visible.)*
- In the spike, Better Auth kept its own tables in its own schema under a restricted login role (no BYPASSRLS, no rights on our tables), with uuid ids so a user's id is the token's `sub`. A security-definer function linked a Better Auth user to the stand-in users table by the same id (`spike/neon/scripts/row6-setup.mjs`).
- While both stacks run, the table must exist on Supabase too, fed from `auth.users` there (§8 row 4).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Better Auth's own `user` table is the users table**, moved into our schema; the 13 references point at it | One table fewer. But Better Auth's migrations then own a table that seven of our foreign keys and RLS depend on, and its required columns (`email` not null, unique, in Better Auth's default schema *(inference from the spike's placeholder)*) force placeholder emails into our data. An upgrade of Better Auth that alters its table touches our core. On Supabase, `auth.users` would have to feed a table shaped like Better Auth's |
| (b) | **A table of ours, `public.users` (id uuid, email nullable, created_at)**, that our foreign keys point at; Better Auth's tables stay in their own schema under their own role, and its user's id equals ours. One security-definer function, called when Better Auth makes a user, writes our row and the profile (the spike's `link_better_auth_user` pattern). On Supabase until the cutover, the existing triggers on `auth.users` feed the same table | Our schema stays ours; Better Auth can be upgraded or replaced without touching a foreign key; a missing email is a null, not a fake address. Costs one more table and a link step that must never be skipped. Cutover step 3 loads the users into both. Free |
| (c) | **`profiles` becomes the users table** (the 13 references point at `profiles`) | No new table. But `profiles` is a marketplace table with user-editable columns and its own policies, and the platform's membership and audit would depend on a marketplace table (INTEGRATION.md §1 ownership: *(inference: probably wrong owner)*) |

**Recommendation: (b).** It keeps the foreign keys and RLS on a table only our migrations change, handles "no email" honestly, and matches what the spike proved (a restricted Better Auth role, uuid ids, a link function). Better Auth's own email column still needs a value for LINE-only users: keep the spike's unroutable placeholder **inside Better Auth's table only**, never copied into ours *(inference: whether Better Auth can run with a null email for a social account was not tested)*.

**To prove first.** On the local stack: Better Auth (as configured for stage 4) creating a LINE user with no email, the link function writing `public.users` and `profiles` in the same request, a staff membership and an audit row referring to it, and a user deleted on one side cascading as today. On Supabase: the existing triggers feeding `public.users` from `auth.users`, so both stacks have the same table. Also settle, in the review, who owns `public.users` (platform or marketplace; INTEGRATION.md §1).

### 5. Where the `role: anon` token is signed, and how long it lives (§8 row 5; spike point 5)

**Question.** The Data API refuses a request with no token (401), so every signed-out call needs a signed `role: anon` token. Who signs it, with which key, and for how long?

**What we already know.**
- No token is 401; a token with no `role` claim runs as Neon's `anonymous`, which must never be issued; a token with `role: anon` runs as `anon` once `anon` is granted to `authenticator` (spike row 8). The 207 grants to `anon` stay.
- The Data API checks tokens against one JWKS address, RS256 or ES256, with a `kid` (`spike/neon/scripts/make-key.mjs`). In the spike, rows 1 to 5 used a key of the spike's own (`spike/neon/lib/token.mjs`, JWKS served as a static file with a 60-second cache, `spike/neon/netlify.toml`), and row 6 used Better Auth's JWT plugin and its `/jwks` route (`spike/neon/lib/auth.mjs`). *(Inference: the Launch project's JWKS address was pointed at one or the other in turn. Whether the Data API accepts a JWKS with two keys, or two addresses, was not tested.)*
- A one-hour token ran out mid-test and answered 401 `PGRST303` (spike row 2).
- Today's anon key is a long-lived signed token, public in the browser, which is how Supabase works.

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Signed on the server per request** (or cached in the function's memory for a few minutes), short-lived (15 minutes, like the user tokens) | Nothing long-lived exists to leak. Costs a signature per cold function (microseconds, *(inference)*) and needs the private signing key in both sites' environments, the same key that can sign `service_role` |
| (b) | **One long-lived anon token** (for example a year), signed once by a script, kept in each site's environment and rotated with the key; it may be as public as today's anon key, which the browser client (`packages/db/src/client.ts`) carries | Like today's anon key: no signing at run time, so the signing key need not be in every function. If it leaks, it grants only what `anon` may do, which is already public by design, and the key's rotation ends it. A token that expires unnoticed breaks every signed-out page at once *(inference: an expiry check in the smoke suite and a calendar line in the runbook would cover it)* |
| (c) | **Signed by Better Auth's JWT plugin** for a pseudo-user | Ties the public path to the sign-in service; an anon token with a `sub` is a confusing shape. Not recommended |

**Recommendation: (b)**, provided point 10's single key set is adopted, so that the anon token, the service token and the user tokens are checked against one JWKS. It costs nothing at run time and keeps the signing key in as few places as possible. *(Inference: whether the browser still needs a data token after the move, or whether every call goes through our server, is for stage 5; either way the anon token grants only what is public by design.)*

**To prove first.** On a Neon branch: one JWKS with two keys (Better Auth's and ours), each `kid` accepted; a forged or expired anon token refused; the anon token able to read exactly what `anon` reads today and nothing more (the public-read tests of the marketplace). If the Data API takes only one key, point 10 decides which side signs everything.

### 6. `public.shop_numbers_readable()` and the rest of `public` [added in §8a]

**Question.** §8's note says `shop_numbers_readable()` calls `auth.role()` directly. When is it re-pointed, and what else in `public` is like it?

**What we already know.** `20261120000100_marketplace_security_audit.sql:71-72` reads `coalesce((select auth.role()), 'service_role') = 'service_role'`. Stage 2's baseline re-points all 58 `auth.uid()` and 16 `auth.role()` calls (stage 2 detail). **The static test that pins direct uses, `apps/platform/tests/db/caller-functions.test.ts`, reads only the `platform` and `platform_private` schemas** (lines 66, 75, 81), so it does not see `public` (the marketplace's functions and policies, `profiles` among them).

**Options.** (a) **Re-point it now** in a small marketplace migration calling `platform_private.app_role()`: one more migration to staging, and a marketplace function would then depend on a platform schema *(inference: an ownership question under INTEGRATION.md §1)*. (b) **Leave it to the baseline, and extend the static test to `public` now**, pinning today's direct uses so the count can only go down there too. (c) Leave it and the test as they are: the baseline's "nothing names `auth.`" check finds it in stage 2 anyway.

**Recommendation: (b).** The baseline already does the re-pointing, and a check that catches a new direct use in `public` before stage 2 costs one test change.

**To prove first.** The extended test lists the current direct uses in `public` (a number, written into the test); nothing else.

### 7. The service path on Neon [added in §8a]

**Question.** How does server code that acts as `service_role` (online booking in `apps/platform/lib/book-online.ts`, the marketplace's admin pages and `lib/auth/sync-role.ts`, `lib/stations/refresh.ts`, the seed, `packages/db/src/admin.ts`) reach Neon? Stage 5 lists two ways and does not choose.

**What we already know.** A `service_role` made in SQL with BYPASSRLS works, and a `role: service_role` token through the Data API sees what RLS hides (spike row 3). A direct pooled connection with `set local role service_role` inside a transaction works, and role and claims are gone after commit (spike row 8). That way cannot be used for `authenticated` (spike point 7). Session settings leak through the pooler (spike row 8). Booking functions check `app_role() = 'service_role'`, which reads the token's claims (phase-3-plan §3.11).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **A short-lived `service_role` token signed on the server**, through the same Data API client as every other call | One data path for everything: the same codes, `.single()` wrapper, 8 s timeout and `try_again` handling as today (spike row 5 measured `reserve()` online this way). The signing key is as dangerous as today's service-role key and lives only in server environments |
| (b) | **A direct pooled connection** with `set local role service_role` and claims set per transaction | A second data path with its own error shapes; `app_role()` must see claims set by hand on every transaction; a forgotten `set local` runs as the owner *(inference: the login role would have to be one without BYPASSRLS to make that harmless)*. A database password in every function that uses it |
| (c) | **Both**: (a) for app code, (b) for scripts (seed, copy, cutover checks) | Scripts already connect directly (the spike's did); keeps the app on one path |

**Recommendation: (a) for app code, with (c)'s direct connection for scripts only.** It is the shape today's code already has, so stage 5 changes the client factory and not the callers.

**To prove first.** From a Netlify function, `reserve()` online with a `service_role` token: the same `55P03`, `57014` and `40P01` at the caller (spike row 5 did this from the spike's own function; repeat with the real factory). ESLint keeps the signing helper inside `packages/db`.

### 8. Generated types after Supabase CLI v4 [added in §8a]

**Question.** What writes `packages/db/src/database.types.ts` once `--db-url` leaves the CLI?

**What we already know.** Today `supabase gen types typescript --local --schema public,graphql_public,platform` (`packages/db/package.json`). Against a Neon address, CLI 2.121.0 with `--db-url` gave the same text apart from `graphql_public`, with `channel_binding` removed from the address (spike row 8). `--db-url` goes away in v4 (§2). Against the local stack (plain Postgres) it was not tried *(inference: it should work the same, since it read Neon's plain Postgres)*.

**Options.** (a) **Pin the CLI to the last version with `--db-url`** and run it against the local stack: no new tool, no change to the generated file; a pinned old tool for one job. (b) **Another generator** (for example a PostgREST-schema or `pg`-catalog generator): a new dependency, and a generated file whose shape differs, so every typed call site may need touching. (c) **Write our own small generator**: fits exactly, but it is code to own for little gain.

**Recommendation: (a).** It keeps the typed call sites unchanged through the move. Reopen only if the pinned CLI stops working.

**To prove first.** The pinned CLI against the local stack of point 9 gives the same file, text for text, as against Neon.

### 9. The local stack's database image [added in §8a]

**Question.** The Compose stack needs Postgres 17 with PostGIS and pg_cron, and "no stock image has both" (§4). Whose image?

**What we already know.** Neon runs PostGIS 3.5.7, btree_gist 1.7, pgcrypto 1.3 and pg_cron 1.6 on Postgres 17.12 (spike row 8, §2). The race and gate tests use `docker exec … psql` into the database container (§1 row 14, §4).

**Options.** (a) **Our own small Dockerfile** (the official PostGIS image plus the pg_cron package), built in CI and cached: we pin the versions to Neon's; a few minutes per CI build when the cache misses *(inference)*. (b) **A community image that has both**: no build, but an outside image in the test path (and CLAUDE.md's care with untrusted downloads applies). (c) **pg_cron off locally**, scheduling tested only on Neon: smallest image, but the local stack then cannot test the scheduling script of stage 7.

**Recommendation: (a)**, with the Dockerfile in the repo and versions matching Neon's. It needs Mark's yes (a build step in CI).

**To prove first.** The image builds in CI within today's job time; every database test file passes on it (stage 2's "done when").

### 10. One Better Auth for two apps, or two [added in §8a]

**Question.** Moto Mangos and the platform are two Netlify sites on one database. Do they share one user table and one signing key, and does each run its own Better Auth?

**What we already know.** Decision 7: Better Auth "run in the apps". Today one Supabase project serves both, with one `auth.users`, and each app has its own LINE provider set-up (`apps/*/scripts/create-line-provider.mjs`) and its own sign-in emails (SPEC, Two brands). The Data API trusts one JWKS address (point 5). In the spike, one Better Auth served one site (`spike/neon/lib/auth.mjs`).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Two Better Auth instances, two key sets** | Each app fully separate. But the Data API trusts one JWKS address *(inference, see point 5)*, and the same person would be two users unless the tables are shared |
| (b) | **One user table and one signing key; a Better Auth instance in each app**, each with its own cookies, providers' callback addresses and branded emails, both signing tokens with the same private key and the same `kid`, published at one JWKS address | One person is one user across both brands, as today. One JWKS for the Data API. The private key sits in both sites' environments *(inference: as the service-role key does today in the marketplace and the platform's two library files)*. Needs Better Auth's JWT plugin to sign with a key we give it, not one it generates in its own table *(inference: not checked)* |
| (c) | **One sign-in service** (one Better Auth on one domain) used by both sites | One place for sessions, but cross-domain sessions for two brands, a third deployable thing, and a function call per sign-in on Netlify Personal's credits |

**Recommendation: (b).** It keeps today's single user per person and gives the Data API one key set, which points 5 and 7 then use as well.

**To prove first.** Both apps' Better Auth instances writing to one set of tables without conflict (two migrations runners must not both own Better Auth's schema *(inference)*); a token from each accepted by the Data API under the one JWKS; Better Auth's JWT plugin signing with a supplied key, or else our own signing helper used for all four token kinds.

### 11. Two schema histories while both stacks run [added in §8a]

**Question.** From stage 2 to the cutover, Supabase runs the 71 migrations plus new ones, and Neon runs a baseline built from the final schema. How does a migration written in that window reach both?

**What we already know.** §7: `main` stays able to run on Supabase until the cutover, and CI runs the database tests on both stacks. Stage 2: one baseline made from the final schema, the applied migrations kept as history and unedited. Three migrations check function bodies by md5 (spike point 14). The plan does not say what happens to a migration written after the baseline is made *(this is the gap)*.

**Options.** (a) **Write each new migration once, so that it loads on both**: it calls `app_uid()`/`app_role()` and names no `auth.` object (CLAUDE.md already requires this of new SQL), and both runners apply it; the baseline is rebuilt from Supabase's final schema just before stage 8, and a CI check compares the two schemas. Low risk if new migrations follow today's rules; the risk is a migration that re-creates an old function body still holding `auth.uid()`. (b) **Freeze schema changes from stage 2 to the cutover**: simplest, but Phase 3 follow-ups or 3M preparation would wait. (c) **Two copies of each migration**: drift waiting to happen.

**Recommendation: (a)**, with the schema comparison in CI, because the build order (Phase 3, then the move, then 3M) leaves few schema changes in the window. **Low confidence**: this needs the reviewer's eye most.

**To prove first.** A CI job that loads the baseline plus every newer migration on the local stack and compares the result (`pg_dump --schema-only`, with `auth.*` re-pointing normalised) to Supabase's schema; one real migration from the window through both.

### 12. The session check on every request [added in §8a]

**Question.** Today each request checks the session locally (`supabase.auth.getClaims()` in both `proxy.ts` files, `apps/platform/lib/session.ts`, `apps/marketplace/lib/auth/session.ts`): no network call. Will Better Auth add a database call per request?

**What we already know.** In the spike, each call first asked Better Auth for the session (`auth.api.getSession`) and then for a token (`auth.api.getToken`) (`spike/neon/netlify/functions/row6.mts`). *(Inference: by default Better Auth's session check reads its session table, which from US East is a round trip to Singapore, about 200 ms on spike row 1's figures, on every page until stage 11.)* Mark accepts a cold start after a quiet spell and no other performance loss.

**Options.** (a) **Better Auth's cookie cache** (a signed, short-lived copy of the session in a cookie, checked without the database), plus the 15-minute Data API token kept in an HttpOnly cookie and reused until it nears expiry: no extra round trip on most requests. A signed-out user's revoked session lives up to the cache's age *(as today: a Supabase token is good until it expires, §3.4 pitfall 8)*. (b) **The database lookup every request**: always current, but a round trip per page, a performance loss Mark has not accepted. (c) **Our own signed session cookie** in place of Better Auth's: more code of ours in the sign-in path.

**Recommendation: (a)**, with the cache's age no longer than the token's 15 minutes.

**To prove first.** In stage 4, page timings with the switch on and off from the same function region: a signed-in page no slower than on Supabase by more than decision 13's line (10% or 20 ms). A session revoked in Better Auth stops working within the cache's age.

## 9. Sources

**The spike (23 to 24 Nov 2026):** [`neon-spike.md`](neon-spike.md); code and raw results at the git tag `archive/neon-spike-2026-11`, under `spike/neon/`. The spike found two Neon behaviours that Neon does not document: the Data API sets `request.jwt.claims`, and it does not apply a role's settings.

The rest were all read 19 Nov 2026. Most were read through a tool that summarises pages, so short quotes should be checked against the page before being relied on.

**Neon**

- Plans and prices: https://neon.com/docs/introduction/plans , https://neon.com/pricing . Free storage is given as 1 GB on some pages and 0.5 GB on others.
- Restore window: https://neon.com/docs/postgres/backup-restore/history-window
- Organisations and project transfer: https://neon.com/docs/manage/organizations , https://neon.com/docs/manage/orgs-project-transfer . That a Free and a paid organisation can sit side by side is implied, not stated.
- Neon Auth: https://neon.com/docs/auth/overview , https://neon.com/docs/auth/roadmap , https://neon.com/docs/auth/guides/setup-oauth , https://neon.com/faqs/managed-better-auth-vs-self-hosting-better-auth , https://neon.com/docs/auth/migrate/from-supabase , https://neon.com/blog/neon-auth-branchable-identity-in-your-database
- Data API: https://neon.com/docs/data-api/overview , https://neon.com/docs/data-api/custom-authentication-providers , https://neon.com/docs/data-api/access-control , https://neon.com/docs/changelog/2026-09-18 (status; seen as a search result only)
- RLS and the trusted-server pattern: https://neon.com/docs/guides/row-level-security , https://neon.com/docs/guides/rls-query-execution , https://neon.com/docs/extensions/pg_session_jwt
- Extensions, PostGIS versions, pg_cron: https://neon.com/docs/extensions/pg-extensions , https://neon.com/docs/extensions/pg_cron
- Roles: https://neon.com/docs/manage/roles
- Pooler and driver: https://neon.com/docs/connect/connection-pooling , https://neon.com/docs/serverless/serverless-driver , https://neon.com/docs/introduction/scale-to-zero
- Regions, uptime promise, status: https://neon.com/docs/introduction/regions , https://neon.com/sla , https://neonstatus.com (not opened)
- Moving in from Supabase: https://neon.com/docs/import/migrate-from-supabase , https://neon.com/docs/guides/logical-replication-supabase-to-neon , https://neon.com/docs/import/import-data-assistant
- Local and CI: https://neon.com/docs/local/neon-local , https://neon.com/docs/guides/neon-github-integration

**Supabase**

- Prices, plans, compute: https://supabase.com/pricing , https://supabase.com/docs/guides/platform/compute-and-disk , https://supabase.com/docs/guides/platform/manage-your-usage/compute
- Organisations, the two-free-projects rule, transfer: https://supabase.com/docs/guides/platform/billing-on-supabase , https://supabase.com/docs/guides/platform/project-transfer
- Backups and recovery: https://supabase.com/docs/guides/platform/backups . Uptime promise: https://supabase.com/sla
- Auth: https://supabase.com/docs/guides/auth/auth-hooks , https://supabase.com/docs/guides/auth/social-login , https://supabase.com/docs/guides/auth/custom-oauth-providers , https://supabase.com/docs/guides/auth/signing-keys
- Storage: https://supabase.com/docs/guides/storage/pricing
- Cron: https://supabase.com/docs/guides/cron
- CLI: https://supabase.com/docs/reference/cli/supabase-db-push
- Leaving: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore , https://supabase.com/docs/guides/database/postgres/setup-replication-external

**Replacements**

- Better Auth: https://www.better-auth.com/docs/authentication/line , https://www.better-auth.com/docs/adapters/postgresql , https://www.better-auth.com/docs/guides/supabase-migration-guide , https://better-auth.com/blog/better-auth-joins-vercel
- Clerk: https://clerk.com/pricing , https://clerk.com/docs/guides/configure/auth-strategies/social-connections/line
- Cloudflare R2: https://developers.cloudflare.com/r2/pricing/ , https://developers.cloudflare.com/r2/buckets/public-buckets/ , https://developers.cloudflare.com/r2/api/s3/presigned-urls/ , https://developers.cloudflare.com/r2/reference/data-location/
- Netlify function region (default `cmh`, Singapore `sin`, Pro and Enterprise only): https://docs.netlify.com/build/functions/optional-configuration/ , https://www.netlify.com/pricing/ (both seen as search results, not opened in full)
- Netlify: https://docs.netlify.com/build/functions/scheduled-functions/ , https://docs.netlify.com/build/functions/background-functions/ , https://www.netlify.com/pricing/
- QStash: https://upstash.com/pricing/qstash

**Not checked, and said so above:** either vendor's incident history; Neon's Object Storage and Functions products; the hosted Supabase project's dashboard settings (the send-email hook, the SMTP set-up); whether the Data API applies role settings; whether a SQL-made role can bypass RLS on Neon. The last two are what the spike in §7.1 was for; it answered them (no, and yes). PostgREST's own documentation (the fallback of §7.2) was not read.
