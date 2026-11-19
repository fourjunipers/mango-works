# Neon move: assessment and plan

**Status: draft for Mark, 19 Nov 2026.** An assessment and a plan, not the move. Written from `main` at `d458717` and the Phase 3 draft on `platform/phase-3-plan-draft` (`f996c4e`). No code, migration, test or database was touched. Nothing was run against staging or live.

Every price and limit below was read on the vendor's own page on **19 Nov 2026** and is cited in §9. Prices change: check the page again before acting on a number. Where the vendor's pages disagree or a point could not be confirmed, the text says so.

## Summary

1. **Recommendation: stay on Supabase for this database, and do not make the move in the slot between Phase 3 and 3M.** The move replaces Auth, the data API, Storage, the scheduler, the test stack and the migration workflow (about 12 to 15 PRs, my estimate) and saves roughly nothing each month at any of the three sizes (§5).
2. **Mark's three wishes are met without it.** Trial projects go in a Neon Free organisation now (100 projects, no pausing after a week, transfer to a paid organisation later). Mango Works goes to Supabase Pro in its own organisation at BSR go-live: one known price, not a per-project trap for a single project.
3. **Keep the four CLAUDE.md rules, and add two things to them** (§6.3): our own "who is calling" functions used by Phase 3 from its first stage, and a list of Supabase-only features new code must not start using. Decide again at a named point (§6.2). If Mark decides to move anyway, §7 is the plan: a full move, never a part move.

The three facts that drive this:

- **The data API is the largest tie, not the database.** About 1,120 `.from()` and 390 `.rpc()` calls go through PostgREST. Neon now has a PostgREST-compatible Data API with a supabase-js-shaped client, so these calls could survive, but that product is young and its documentation is in flux.
- **Neon's own auth cannot do LINE.** Neon Auth (managed Better Auth) lists six social providers, LINE is not one, and custom providers and plugins are refused. Leaving Supabase Auth means running Better Auth ourselves, inside the two apps.
- **On Neon the minute sweep needs an always-on paid compute.** pg_cron only runs while the compute is awake, and the Free plan cannot switch scale-to-zero off.

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

## 6. Recommendation

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

## 7. If Mark decides to move anyway: the plan

A full move: Neon for Postgres, the Neon Data API for the calls, Better Auth run in the apps, R2 for files, pg_cron kept on an always-on Launch compute for live.

**Order: Phase 3 → the move → 3M → 1b.** The planned slot is the right one if the move happens at all: after Phase 3 the booking core has settled, and before 3M and BSR's go-live there are no real customers to sign out and no bookings to freeze. 3M then builds `marketplace_api` once, on the final stack. 1b is unaffected.

Models follow the Phase 3 plan's rule: **Fable build** for locks, RLS, roles, sign-in and money; **Opus + Fable check** for the rest.

| # | Step | Model | Done when |
| --- | --- | --- | --- |
| 0 | **Addition A inside Phase 3** (own caller functions; existing calls re-pointed by one migration) | Fable build | No `auth.uid()` or `auth.role()` outside the two functions; every database test passes unchanged |
| 1 | **Spike, on a throwaway Neon Free project, no real data.** Prove or disprove: a SQL-made `service_role` with BYPASSRLS; `anon` against `anonymous`; the Data API with our own JWKS and a `role` claim; `.rpc()` and `.schema()` through `@neon/neon-js`; statement timeout after the role switch; `alter function … set lock_timeout`; transaction advisory locks through the pooler; pg_cron set-up; PostGIS and btree_gist in schema `extensions`; type generation. Written up as go or no-go | Fable | Mark has a yes or no on each point. **Any no on roles, timeouts or locks stops the move** |
| 2 | **Baseline and local stack.** A new migrations folder with one baseline made from the schema (the 66 files stay as history and are not edited); the bootstrap file for roles; explicit grants; the Compose stack; the harness changes of §4; CI | Fable build | All 29 database test files pass on the new stack, the rewritten default-grants test included |
| 3 | **Sign-in.** Rule 3's helper first, on Supabase. Then Better Auth behind it: email and password with bcrypt checking, email link, Google, LINE (test the HS256 case that broke OIDC on Supabase), both brands' emails through Resend, tokens with `role: authenticated` for the Data API | Fable build | Playwright sign-in for every method on both apps; a token cannot be made to say `service_role`; a signed-out session is refused within the token's lifetime |
| 4 | **Data path.** The five `packages/db` factories point at the Data API; the service path; the 12 stray `@supabase/*` files brought in | Fable build (service path); Opus + Fable check (the rest) | Typecheck, lint, unit, database and Playwright suites pass against local, then the smoke suite against a Neon branch |
| 5 | **Files.** Rule 2's module; R2 buckets; the six storage policies become server-side checks that hand out upload addresses; a copy script; stored addresses rewritten | Opus + Fable check | Every photo loads from the new address on a copied staging data set |
| 6 | **Jobs.** The two cron jobs and Phase 3's three on pg_cron on Neon (always-on compute); remove the keep-alive function | Opus + Fable check | Each job runs on schedule on the Neon staging project; twice running writes once |
| 7 | **Rehearsal on staging** (only on Mark's word, since it touches staging): copy staging's data to a Neon staging project by the cutover script, point the staging sites at it, run everything, time it, then practise the rollback | Fable | The script runs start to finish without a hand edit; rollback practised once |
| 8 | **Cutover of live** (below) | Fable, with Mark at the keyboard for every command on live | The checks pass and Mark says go |
| 9 | **Clean-up, 30 days later, on Mark's word**: pause then delete the Supabase projects; drop `@supabase/*`; update CLAUDE.md, the runbook and the specs | Opus + Fable check | Nothing in the repo names Supabase except history |

### 7.1 Cutover

Data copy is by dump and restore, not by replication. The database is small (minutes to copy), Neon's import assistant refuses Supabase, and replication out of Supabase needs its paid IPv4 add-on for little gain.

Before the day:

1. Register the new sign-in return addresses with Google and LINE (they move from the Supabase project's address to our own domains). Keep the old ones registered.
2. Lower nothing and delete nothing on Supabase.

On the day, in a quiet hour for Bangkok:

1. Both sites to a maintenance page. From here no write reaches Supabase.
2. Take the runbook's backup of live (`docs/RUNBOOK-GO-LIVE-PLATFORM.md`), outside the repo as it says.
3. Dump data only from `public`, `platform` and the users (`auth.users`, `auth.identities`), over the direct connection. Restore into the Neon project, which already holds the baseline schema. Load users through the Better Auth mapping. Reset every sequence.
4. Run the same read-only checks on both sides and compare (a script written in step 7, in the manner of the runbook's `checks.sql`, which I did not read): row counts per table, sums of money columns, the count of live reservations and blocks, the highest order number.
5. Copy the files to R2 (done ahead; a last pass for anything new).
6. Switch both Netlify sites' environment variables and deploy.
7. Smoke test behind the maintenance page: sign in by each method, one staff booking, one online hold and its expiry, one photo upload.
8. Mark says go; the maintenance page comes down. **Everyone signs in again once**: sessions do not move.

### 7.2 Rollback

- **Supabase is left exactly as it was at step 1**, running and unwritten, for 30 days.
- **Before the maintenance page comes down**, rollback is: put the old environment variables back and publish the previous deploy (Netlify keeps it). Nothing is lost, because nothing was written.
- **After it comes down, the point of no return is the first real booking or payment on Neon.** From then a rollback loses what was written since, unless it is copied back by hand. So the smoke test in step 7 must be complete, and the first day is watched: if something is wrong, the maintenance page goes back up first, and the choice is fix forward or copy back the few rows by hand.
- If the move happens in its planned slot, before BSR is live, there are no real bookings and rollback is free for as long as Supabase is kept.

## 8. Open decisions for Mark

| # | Decision | Options | My recommendation |
| --- | --- | --- | --- |
| 1 | Move this database? | (a) Stay and decide again on the events in §6.2; (b) full move in the planned slot; (c) part move, keeping Supabase Auth | **(a).** If not (a), then (b). Never (c) |
| 2 | Where do the small trial projects live? | (a) A Neon Free organisation, with a paid one for what grows; (b) stay within Supabase's two free projects | **(a), now** |
| 3 | Mango Works's plan at BSR go-live | (a) Supabase Pro in its own organisation; (b) stay Free with the keep-alive | **(a).** Free has no backups and can pause |
| 4 | Staging, once on Pro | (a) Keep it a Free project (pauses when idle; one of the two free slots); (b) $10 a month inside the Pro organisation | **(a)** until the pause annoys; then (b) |
| 5 | Own "who is calling" functions in Phase 3 (§6.3 A) | (a) Yes, from stage 1, and edit the Phase 3 plan; (b) no, keep calling `auth.uid()` and `auth.role()` | **(a).** It must be decided before Phase 3 stage 1 |
| 6 | The "do not start using" list in CLAUDE.md (§6.3 B) | (a) Add it; (b) leave the four rules as they are | **(a)** |
| 7 | Point-in-time recovery on Supabase | (a) Not yet: daily backups for 7 days plus the runbook's own dumps; (b) about $100 a month | **(a)** until money moves through the platform (Phase 7) |
| 8 | If moving: the calls | (a) Neon Data API, keeping the supabase-js shape; (b) rewrite as SQL through a driver | **(a)**, subject to the spike |
| 9 | If moving: sign-in | (a) Better Auth in the apps; (b) Clerk; (c) Neon Auth | **(a).** (c) has no LINE. Note Better Auth was bought by Vercel in July 2026; it says it stays open source |
| 10 | If moving: Neon plan for live | (a) Launch, always on; (b) Scale, for the 99.95% promise at about twice the compute price | **(a)** until a shop asks for the promise |
| 11 | If moving: scheduler | (a) pg_cron on the always-on compute; (b) Netlify scheduled functions calling the same SQL | **(a)** for live: the jobs are SQL and already in the lock order. Staging on Free runs without, as the migrations already allow |
| 12 | If moving: migration tool | (a) Supabase CLI pointed at Neon; (b) a small SQL-file runner (a new dependency, which needs asking) | Decide after the spike; I lean **(b)** |
| 13 | If moving: when | (a) After Phase 3, before 3M (the plan); (b) after 3M, when the legacy marketplace tables are gone and there is less to move | **(a)**, as long as BSR is not live yet |

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
- Netlify: https://docs.netlify.com/build/functions/scheduled-functions/ , https://docs.netlify.com/build/functions/background-functions/ , https://www.netlify.com/pricing/
- QStash: https://upstash.com/pricing/qstash

**Not checked, and said so above:** either vendor's incident history; Neon's Object Storage and Functions products; the hosted Supabase project's dashboard settings (the send-email hook, the SMTP set-up); whether the Data API applies role settings; whether a SQL-made role can bypass RLS on Neon. The last two are what the spike in §7 is for.
