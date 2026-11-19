# Neon move: assessment and plan

**Status: decided by Mark, 19 Nov 2026. The move goes ahead if the spike passes.** This document holds the assessment (§1 to §6, written before the decision and kept as written), Mark's decisions (below), and the staged plan (§7). It was written from `main` at `d458717` and the Phase 3 draft on `platform/phase-3-plan-draft`. No code, migration, test or database was touched. Nothing was run against staging or live.

Every price and limit below was read on the vendor's own page on **19 Nov 2026** and is cited in §9. Prices change: check the page again before acting on a number. Where the vendor's pages disagree or a point could not be confirmed, the text says so.

## Summary

1. **Mango Works moves fully to Neon after Phase 3, before 3M and before BSR goes live.** Neon for Postgres, the Neon Data API for the calls, Better Auth in the apps for sign-in, pg_cron for the jobs. Never a part move that keeps Supabase Auth.
2. **A spike comes first, as its own stage, with a go or no-go for Mark** (§7.1). The move goes ahead only if the spike shows no meaningful performance loss on live.
3. **Live is always on, in Singapore, with no scale-to-zero.** Staging and trial projects may scale to zero; Mark accepts a short cold start there.

The assessment had recommended staying (§6). Its cost and risk findings stand and are the reason the spike is a gate and every stage has a rollback: the move costs about 12 to 15 PRs, saves roughly nothing a month at production sizes, and its riskiest parts are sign-in, the access model and the path every booking takes.

## Decisions made, 19 Nov 2026

| # | Decision | Notes |
| --- | --- | --- |
| 1 | **Move fully to Neon in the planned slot**: after Phase 3, before 3M, before BSR goes live. Never a part move | Build order becomes 0 → 1a → 2 → 3 → Neon move → 3M → 1b → 4 onward |
| 2 | **Spike first, its own stage, go or no-go for Mark** | What it must measure and settle: §7.1. No meaningful performance loss on live, or the move stops |
| 3 | **Trial projects go in a Neon Free organisation, from now** | A paid organisation for any that grows; a project transfers with its connection string unchanged |
| 4 | **Live: Neon Launch, always on, Singapore** (`aws-ap-southeast-1`). No scale-to-zero on live | Launch is the cheapest plan that can switch scale-to-zero off. About $19 a month at the smallest size, 0.25 CU (§5) |
| 5 | **Staging: a Neon Free project that may scale to zero** | What that means for the hold sweep and for testing: §7.3 |
| 6 | **Calls: the Neon Data API, subject to the spike** | Fallback if it fails: §7.2 |
| 7 | **Sign-in: Better Auth, run in the apps** | LINE and Google proved in the spike |
| 8 | **Scheduler: pg_cron on the always-on compute** | Live only; staging has no schedule (§7.3) |
| 9 | **Migration tool: decided after the spike** | The lean is a small SQL-file runner (a new dependency, so it needs asking) |
| 10 | **Phase 3 adds our own "who is calling" functions from stage 1** | Already sent to the Phase 3 plan. They are the only places `auth.uid()` and `auth.role()` are read |
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

### 7.1 Stage 1: the spike

On throwaway Neon projects in the new Free organisation and a throwaway Netlify site. No real data. Its only output on `main` is a write-up with numbers and a yes or no on each point. **Mark then says go or no-go.**

**What it must measure.**

| # | Question | How | Passes when |
| --- | --- | --- | --- |
| 1 | **Latency from Netlify server functions to Neon in Singapore, against today's Supabase in Singapore** | The same two calls, 200 times each, warm, from one Netlify function: a typical read (a product list with its prices, through the data API) and an RPC-style write (a booking function that takes locks and writes). Median and 95th percentile. **Both measured the same way, from today's function region (US East)**, in the same run | **Neon's median and 95th percentile are each no worse than Supabase's by more than 10% or 20 ms, whichever is larger** (Mark's line, 19 Nov 2026) |
| 2 | **Cold start** of a scaled-to-zero compute, and **none on an always-on compute** | First call after 10 idle minutes on a Free project, 20 times. The same on a Launch project with scale-to-zero off, after 1 hour and after a night idle | Always on: the first call is no slower than the rest. Scale-to-zero: the number is written down for staging (Neon says "a few hundred milliseconds") |
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

**Rollback:** delete the throwaway projects and site. Nothing else exists.

### 7.2 If the Data API fails the spike

In order:

1. **Run PostgREST ourselves in front of Neon**: the same software Supabase runs today, as one small always-on container in Singapore (Fly.io or Railway, a few dollars a month). All 1,510 calls stay as they are, and we set the roles and timeouts ourselves. The cost is one more service to keep running and to watch. It is measured in the same spike before being chosen. (PostgREST's own documentation was not read for this document.)
2. **If that fails on latency too: no-go.** Stay on Supabase and decide again on the events in §6.2. Rewriting 1,510 calls as SQL is not a fallback.

### 7.3 Staging on Neon Free

- **Scale-to-zero cannot be switched off on Free.** The compute sleeps after 5 idle minutes; the first request after that pays the cold start. Mark accepts this on staging.
- **The hold sweep is not scheduled on staging.** pg_cron runs only while the compute is awake, and a job every minute may itself keep it awake: 0.25 CU for a whole month is 182 compute-hours against 100 free, after which Neon suspends the compute until the next month. (Whether cron keeps a Free compute awake is spike item 8.) Nothing breaks: the migration that created the job says a hold that has run out is already left out by reads and bookings, and the next booking releases it. Staging will show run-out holds for longer than live does. The sweep can be run by hand when a test needs it.
- **So scheduling moves out of the migrations.** Today each job is scheduled wherever pg_cron is available, which on Neon is everywhere. In the baseline, a small per-environment script schedules the jobs, and it is run on live only.
- **What staging tests and what it does not.** Staging tests screens, sign-in, the data path and migrations. It does **not** test the scheduler, an always-on compute or live's timings. Those are tested on the local stack (pg_cron included), in the spike, and in the rehearsal, which runs on the future live project while it is still empty (stage 8).
- **Limits to watch:** 100 compute-hours a month (400 hours awake at the smallest size); storage of 0.5 or 1 GB (Neon's pages disagree; the spike checks staging's size against it); a 6-hour restore window.
- **Playwright against staging** already allows 15-second waits; the first test after an idle spell pays the cold start.

### 7.4 Point-in-time recovery on live

Neon's "instant restore" on the Launch plan:

- **What it covers:** the whole database can be put back to any moment inside the window, or a copy made as it was at that moment. The window is **1 day by default and can be set up to 7 days** on Launch (30 on Scale). **Set it to 7 days on live.** It costs $0.20 per GB a month of stored change history, on the main branch only. Because Better Auth keeps users in the same database, users and their data go back together, which is not so today.
- **What it does not cover:** anything older than the window; files in R2; a mistake noticed after 7 days. Neon's page also says restore to a moment is not supported on a branch made from a snapshot restore.
- **So, as well:** a manual Neon snapshot before each migration to live (100 are included), and the runbook's own dump kept outside Neon weekly, as today's runbook keeps one outside the repo. SPEC's "restore drill before Gate A" stays, done on Neon.

### 7.5 The stages

**Fable build** for sign-in, RLS and roles, the data copy and the cutover. **Opus + Fable check** where a mistake cannot reach a booking, money or who may see what.

| # | Stage | Model | Done when | Rollback |
| --- | --- | --- | --- | --- |
| 0 | **Inside Phase 3, from its stage 1: our own "who is calling" functions** (decision 10) | Fable build (it is Phase 3's) | No new code reads `auth.uid()` or `auth.role()` directly | It is ordinary Phase 3 work; revert with its PR |
| 1 | **Spike** (§7.1) | Fable | Mark has a number or a yes or no on every row, and says go or no-go | Delete the throwaway projects and site |
| 2 | **Baseline, roles and local stack.** One baseline made from the schema (the applied migrations stay as history, unedited); the bootstrap that makes `anon`, `authenticated`, `service_role` and the login role; explicit grants; one migration that re-points the remaining old `auth.uid()` and `auth.role()` calls at the two functions; the Compose stack; the harness changes of §4; the migration tool; CI on both stacks | Fable build | Every database test file passes on the new stack, the rewritten default-grants test and the gate tests included | Revert the PR. The Supabase stack and its tests are untouched |
| 3 | **Sign-in helper, still on Supabase** (CLAUDE.md rule 3): every sign-in, sign-out, session and "who is this" call goes through one module | Opus + Fable check | Playwright sign-in specs pass unchanged; ESLint refuses `.auth.` outside the helper | Revert the PR |
| 4 | **Better Auth behind the helper**, switch off: email and password with bcrypt checking, email link, Google, LINE, both brands' emails through Resend, tokens that carry `role: authenticated` from a constant. **Email verification must be required here too** (Better Auth's `requireEmailVerification`): Supabase's "Confirm email" is on in live and staging and anonymous sign-ins are off (checked 19 Nov 2026, security audit H1), and the move must not loosen either | Fable build | Playwright sign-in for every method on both apps with the switch on; a token cannot be made to say `service_role`; with the switch off nothing changes | Switch off; revert the PR |
| 5 | **Data path**, switch off: the five `packages/db` factories gain a Data API side (or the fallback of §7.2); the service path; the 12 stray `@supabase/*` files brought inside | Fable build for the service path and the factories; Opus + Fable check for the stray files | Typecheck, lint, unit, database and Playwright suites pass on both sides of the switch; the smoke suite passes against a Neon branch | Switch off; revert the PR |
| 6 | **Files**: rule 2's module; R2 buckets; the six storage policies become server-side checks that hand out upload addresses; a copy script that can be run again | Opus + Fable check (Fable reads the access checks) | Every photo loads from R2 on a copy of staging's data; an upload by a non-member is refused | Switch off: the module reads Supabase Storage again. Files copied to R2 are left; nothing was deleted |
| 7 | **Jobs**: the per-environment scheduling script (§7.3); remove the keep-alive function at cutover, not before | Opus + Fable check (the job SQL is unchanged) | On a Launch project each job runs on schedule; run twice, it writes once | Unschedule on Neon. Supabase's jobs were never touched |
| 8 | **Neon projects, staging's move and the rehearsal.** Create the paid organisation, the live project (Launch, always on, Singapore, 7-day window) and the staging project (Free). Move staging first, on Mark's word. Then rehearse the whole cutover into the still-empty live project with a copy of staging's data, time it, and practise the rollback | Fable (the copy script and the rehearsal); Mark runs anything that touches staging | The script runs start to finish without a hand edit; the read-only checks match on both sides; rollback practised once | Staging: point its sites back at the Supabase staging project, which is kept. Live project: empty it |
| 9 | **Cutover of live** (§7.6) | Fable, with Mark at the keyboard for every command on live | The checks match and Mark says go | §7.7 |
| 10 | **Clean-up, 30 days later, on Mark's word**: remove the switches and the Supabase side; drop `@supabase/*`; pause, then delete the Supabase projects; update CLAUDE.md, the runbook and the specs | Opus + Fable check | Nothing in the repo names Supabase except history | Before the projects are deleted: restore the switches from git. After: none, which is why it waits 30 days and for Mark's word |
| 11 | **Go-live preparation: Netlify Pro, functions to Singapore** (§7.8). The last step of the build, just before go-live; not tied to the cutover | Mark makes the change in Netlify; Opus + Fable check for the measurement and the test timeouts | Both sites' functions run in `sin`; the spike's two calls measured again from Singapore | Set the region back and redeploy; the plan can be lowered again |

Stages 3 to 7 can overlap once stage 2 is merged; 4 needs 3. Stage 8 needs all of 2 to 7.

### 7.6 Cutover

Data copy is by dump and restore, not by replication. The database is small (minutes to copy), Neon's import assistant refuses Supabase, and replication out of Supabase needs its paid IPv4 add-on for little gain.

Before the day:

1. Register the new sign-in return addresses with Google and LINE (they move from the Supabase project's address to our own domains). Keep the old ones registered.
2. Lower nothing and delete nothing on Supabase.

On the day, in a quiet hour for Bangkok:

1. Both sites to a maintenance page. From here no write reaches Supabase.
2. Take the runbook's backup of live (`docs/RUNBOOK-GO-LIVE-PLATFORM.md`), outside the repo as it says.
3. Dump data only from `public`, `platform` and the users (`auth.users`, `auth.identities`), over the direct connection. Restore into the Neon project, which already holds the baseline schema. Load users through the Better Auth mapping. Reset every sequence.
4. Run the same read-only checks on both sides and compare (a script written in stage 8, in the manner of the runbook's `checks.sql`, which I did not read): row counts per table, sums of money columns, the count of live reservations and blocks, the highest order number.
5. Copy the files to R2 (done ahead; a last pass for anything new).
6. Turn the switches on in both Netlify sites' environment variables and deploy.
7. Smoke test behind the maintenance page: sign in by each method, one staff booking, one online hold and its expiry by the sweep, one photo upload.
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
3. Measure the spike's two calls again, from Singapore, against the live Neon project, and write the numbers beside the spike's. Expect them to be far lower than the spike's: the calls no longer cross to Singapore and back.
4. Check that nothing relied on the slow path: test timeouts, the 8-second statement timeout and the 6-second lock timeout are unchanged; the Playwright waits for previews can come down.

It is independent of the Neon cutover and comes after it. **Rollback:** set the region back to the default and redeploy.

## 8. Still open

Decided on 19 Nov 2026: the seventeen rows under the Summary, Mark's answers to this section's earlier questions among them (13 to 17). What is left:

| # | Open | Options | My recommendation | Needed by |
| --- | --- | --- | --- | --- |
| 1 | Migration tool (decision 9; confirmed 19 Nov 2026 that it waits for the spike) | (a) Supabase CLI pointed at Neon; (b) a small SQL-file runner | Decide after the spike; I lean **(b)** | Stage 2 |
| 2 | Staging once the move is done | (a) Stay on Neon Free; (b) a paid project if the cold start or the 100 hours get in the way | **(a)** until it annoys | After stage 8 |
| 3 | Neon plan for live later | (a) Stay on Launch; (b) Scale, for the 99.95% promise at about twice the compute price | **(a)** until a shop asks for the promise in writing | When a shop asks |

## 9. Sources

All read 19 Nov 2026. Most were read through a tool that summarises pages, so short quotes should be checked against the page before being relied on.

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

**Not checked, and said so above:** either vendor's incident history; Neon's Object Storage and Functions products; the hosted Supabase project's dashboard settings (the send-email hook, the SMTP set-up); whether the Data API applies role settings; whether a SQL-made role can bypass RLS on Neon. The last two are what the spike in §7.1 is for. PostgREST's own documentation (the fallback of §7.2) was not read.
