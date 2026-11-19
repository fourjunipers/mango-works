# Progress

What's done, open decisions and known issues, across both apps. Update this at the end of every session so the next one starts clean.

## Status (12 Nov 2026)

| Track | Where it stands |
| --- | --- |
| Repo | **Step R** merged to `main` (PR #5). GitHub repo renamed to `fourjunipers/mango-works`; Netlify site `bike-booking-th` relinked to it |
| Marketplace (Moto Mangos, `apps/marketplace`) | Customer search and pages live on the `lib/data` adapter (Phase 3). Booking fee, fee lifecycle and the `BOOKING_ENABLED` flag merged to `main` (step 2, PR #6). Nothing uses them yet |
| Platform (`apps/platform`) | **Phase 0** (foundations) merged to `main` (PR #7, 10 Nov 2026) and deployed on the Netlify site `mango-works-platform` (staging data): auth, tenants, memberships, roles, RLS, app shell, staff app with its 4 tabs (placeholders), demo seed, CI. **Phase 1a** (fleet core) is built on `platform/phase-1a-fleet-core`, PR open |
| Database | 53 migrations on `main`, **all 53 on live since 12 Nov 2026** (see below). Platform tables live in the `platform` schema from Phase 1a. Live = today's Bike-Booking project (migrations only from `main`). Staging = Supabase project `mango-works-staging` (Singapore), with all 48 and the demo seed |

Build order after the 10 Nov 2026 review (docs/platform/SPEC.md › Review decisions): 0 → 1a → 2 → 3 → 3M → 1b → 4 onward.

## Security fixes from the 19 Nov audit (branch `security/audit-fixes-2026-11`, 19 Nov 2026)

Fixes for the findings of the security audit of `main` at `d458717`. Two migrations, kept apart on purpose: `20261120000100_marketplace_security_audit.sql` (public schema only) and `20261120000200_platform_security_audit.sql` (platform schema only). Both are timestamped after PR 51's `20261119000100` and need nothing from it. Every fix has a test that failed before it.

**Live stays untouched by decision; M1 remains open on live until the marketplace moves onto the platform (3M) or the Neon cutover, whichever comes first, when this migration applies with the rest.** (Mark, 19 Nov 2026: neither migration is pushed to live; both are in the PR for local and staging.) **The code fixes (M2, M3, M6 and the lows) reach live with the next publish**, when `main` is merged into `release`.

**H1 is closed.** Supabase Auth's "Confirm email" is on in both live and staging, and anonymous sign-ins are off (checked by Mark, 19 Nov 2026). The Neon move plan's Better Auth stage now says email verification must be required there too (branch `docs/neon-move-plan`).

**Marketplace and shared**

- **M1, shop members.** The policy "Owners add team members" let an owner insert a membership for any user id with any role, and the teammates policy then showed that user's profile. The policy is dropped and `insert` on `public.shop_members` is revoked from `anon` and `authenticated`. `create_shop()` and `accept_shop_invite()` still add members (tested). **Not on live** (see above).
- **M2, open redirect.** `safeNextPath()` in both apps kept `"/\t/evil.example"` (a browser drops the tab and reads `//evil.example`). It now keeps a value only when it starts with `/`, holds no control character or backslash, and `new URL(next, "http://x").origin` is still `http://x`. A table of 24 attack strings in each app.
- **M3, Google reviews.** `/api/google-reviews/[shopId]` now calls `overLimit(request)` before anything else (60 calls a minute per caller, shared with place search). The limiter's key is Netlify's `x-nf-client-connection-ip` only; `x-forwarded-for` is never read (the caller writes it). With no Netlify header (local, another host) every caller shares one budget. **The limiter is in memory, so it is per server instance:** on Netlify each function instance counts by itself and instances come and go, so it slows one caller down and is not a hard cap. The hard cap on spend is the quota on the key in Google Cloud.
  - **Not done, needs a decision: the 24-hour cache.** SPEC (Google rating and reviews) says "Only the place ID is stored. Rating and reviews are fetched from Google when the page is shown, because Google doesn't allow storing them", and the route's own comment says the same of Google's terms. A per-shop cache of the response is storing them. The response is still `no-store`. If Mark wants a cache anyway, the spec line changes first.
- **M6, security headers** on both sites (`next.config.ts` › `headers()`, from `lib/security-headers.ts` in each app): `X-Frame-Options: DENY` and an enforced `Content-Security-Policy: frame-ancestors 'none'` (that one directive only); `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Strict-Transport-Security: max-age=31536000` (this host only: no `includeSubDomains`, no `preload`, until that is decided for the whole domain). **The full CSP is report-only** (`Content-Security-Policy-Report-Only`): it has no nonces, so `script-src` allows `'unsafe-inline'` (Next.js writes inline scripts into every page). It has no reporting endpoint: violations show in the browser's console. What it would block is listed in the PR. Enforcing it, and nonces, come after it has run clean on staging and live.
- **auth/confirm** (both apps) verifies only `email` and `magiclink` links; any other `type` goes back to sign-in without Supabase being asked.
- **Search functions** (`rental_price`, `model_offer`, `longest_walkin`, `shop_stats`) answer when the shop is live, or the caller is a member of it, or the caller is the server; anyone else gets what an unknown id gets. `longest_walkin()` looks no further than 90 days whatever it is asked (100000 ran to the statement timeout) and answers 0 for a model that is missing or not readable (it answered the limit). Not changed: `model_offer()` still accepts any date range (one row per day of it, ended by the API's statement timeout).
- **A shop's map link and photos.** `maps_url` must be an https address on Google Maps' hosts (`maps.app.goo.gl`, `goo.gl/maps`, `g.co/kgs`, `maps.google.*`, `google.*/maps`, where `*` is `com`, `co.xx` or `com.xx`); a photo is a path, never an address: `/images/<file>` or a file in the row's own folder. Checked in the app (`lib/maps-url.ts`, `lib/photos.ts`: a stored `//host/x` used to be returned as it stood) and in the database by a trigger that looks only at a value being changed, so a row holding something older can still have its other columns saved. A Google domain such as `google.de` is refused by this rule; add it when a market needs it.
- **Marketplace admin.** `requireAdmin()` reads `ADMIN_EMAILS` on every call: an admin no longer listed gets the 404 and loses the role then, not at their next sign-in.
- **Last owner of a marketplace shop.** `protect_last_owner()` takes the shop's row (`for no key update`) before it counts, so two owners removing each other at once take turns and one stays.
- **A booking's Stripe ids** (`stripe_customer_id`, `stripe_payment_method_id`): the spec gives the shop the customer's name, contact, dates, amount and code, not these. No signed-in user reads them now (column grants on `public.bookings`; the server reads everything). **`select("*")` on `bookings` is refused for signed-in users from now on, and a column added later needs its own grant.**
  - **Noted, not narrowed:** shop members read the full profile row of anyone who has a booking with them, declined and expired requests included ("Members read profiles of their shop's customers"). The spec says the shop sees the customer's "name, contact" on a booking and does not say what it sees after declining. To decide with the 3M move, where customer records become the platform's.
- **Old redirect pages** (`/[tenant]/fleet/models/new` and `/[id]`): membership is checked first, the id must be an id, and the destination is built from the shop the membership names.
- **CI:** `permissions: contents: read`, and every action pinned to a commit (`apps/platform/tests/ci-workflow.test.ts` fails if either slips).
- **`cn` 0.5.0: not replaced.** It is not a one-line helper: it is shadcn-ui's own package (`github.com/shadcn-ui/cn`), a compiled replacement for clsx + tailwind-merge, and every component relies on its merging of conflicting Tailwind classes. A few local lines would change how components look; a faithful replacement means adding `clsx` and `tailwind-merge`, which needs Mark's yes (root CLAUDE.md: ask before adding a dependency).

**Platform**

- **M5, the audit log.** `update`, `delete`, `truncate`, `references` and `trigger` on `platform.audit_events` are revoked from every role but the owner (the service role keeps `select` and `insert`). Two triggers refuse update, delete and truncate whoever asks (`audit_events_are_kept`), with one change let through: `actor` emptied and nothing else, which is what deleting a user's account does. `truncate` is revoked on every platform table. `price_template_days`, `price_rule_products`, `coupon_products` and `product_extras` have audit triggers (rows recorded under the table's own name, so the History screens read what they read before). A price list save now also writes an audit row for each day row it changes.
  - **A shop with audit rows can't be hard-deleted** (the delete would take its log). The test helpers remove a test's tenant as the local superuser, audit rows first with the triggers off for that statement (`session_replication_role`). **When PR 51 and this branch meet, `deleteTenant()` in both `tests/db/helpers.ts` files conflicts:** keep PR 51's version and add the two `set local session_replication_role` lines around its `delete from platform.audit_events`.
  - **Phase 4** (audit retention) and **Phase 11** (closing a shop) will need a deliberate way past these triggers, run by the database's owner.
- **Check before lock.** `save_listing()`, `save_product_pricing()`, `delete_price_template()` and `submit_product_to_catalog()` read the row unlocked, check the caller, and only then take the lock they took before. The lock order is unchanged. Bodies are main's with only that change:

| Function | md5 before | md5 after |
| --- | --- | --- |
| `platform.save_listing(uuid, jsonb)` | `1f5e5ac5fe92d0d7a4facf2ea1230cfc` | `9ecb770e0b5067baeb4fbbe78f33bfd4` |
| `platform.save_product_pricing(uuid, jsonb)` | `5e219d230c2981fd397353399bccd261` | `2e48043424ae349b50484d4ceff55aab` |
| `platform.delete_price_template(uuid)` | `5bd3763de4ff775e12e4b40e9ccf4477` | `81104426463ae1a80a0426b924e526c1` |
| `platform.submit_product_to_catalog(…)` | `d23b15e11893b605218a02df82b6bba5` | `af7d788f4cea1444ffe734f759e18cee` |
| `platform_private.units_guard()` | `9ecef4280ebf4c019a053d3addd14df4` | `c58ae1d2ab6f913ac4d294fec4d2a3de` |

  The marketplace migration guards its five the same way (`rental_price`, `model_offer`, `longest_walkin`, `shop_stats`, `protect_last_owner`).
- **`tenant_id` is fixed** on `platform.locations`, `platform.products` and `platform.price_templates` (a trigger: `tenant_is_fixed`). The price list is there because the check-before-lock in `delete_price_template()` relies on it.
- **`units_guard`:** a lost gear unit's problem line is changed by direct update only by whoever may mark a unit lost (owners, managers, staff), as in `update_unit_problem()`. A mechanic still edits a unit in repair.
- **`saveExtras`** checks the role in the app as well (`canExtras`).
- **A shop's last owner** can't go by a row delete or a direct role change (`memberships_keep_an_owner`), so the only owner's user account can't be deleted until someone else is an owner. It takes the shop's row without waiting (55P03 if a team change holds it). Who inherits a shop when its owner asks to be erased is Phase 11.
- **Not done: revoking `execute` on `platform_private.audit()` from `authenticated`.** Eight functions run as their caller and call it (`change_listing_entry`, `disconnect_listing`, `import_fleet`, `report_gear_problem`, `reset_product_order`, `resolve_unit_problem`, `set_stock_quantity`, `update_unit_problem`): the revoke would break all of them. The function is not reachable through the API (its schema is not exposed) and it already refuses a tenant its caller is not in (20261111000800). Closing it properly means making those eight run as their owner with their own role checks, or giving them an audited write of their own: a change to how they are authorised, so it waits for a decision.

**For Phase 3 (noted, not fixed)**

- **M4: `reserve()` trusts the coupon amount it is sent** and does not check again, in the database, the coupon's dates, channel, product scope, minimum days or minimum spend (it re-reads only what a save or another booking can have changed: switched off, archived, the currency, "Accept coupons", the uses). **Phase 3's `create_order` must recompute the amount and recheck every coupon rule under the coupon's row.**
- **`bookOnline()`:** its Phase 3 caller must take the tenant from the server (the booking page's address or the listing), never from the request body; rate-limit; and give one public reason for every refusal.
- **Hosted settings to check before each go-live:** Auth "Confirm email" on (on in live and staging, 19 Nov 2026) and anonymous sign-ins off; the redirect allow-list; the exposed schemas; table privileges on live and on staging (the default grants on older `public` tables still include `truncate`, `references` and `trigger` for `anon` and `authenticated`: not reachable through the API, worth removing in a marketplace migration).

**npm audit** (`npm audit --package-lock-only`, root): before, 13 (1 high, 12 moderate). `npm audit fix` without `--force` fixed 9, the high one (`body-parser`) among them. Left: 4 moderate, one chain (`minimatch` ← `@ts-morph/common` ← `ts-morph` ← `shadcn`), whose only fix offered is `shadcn@1.0.0`, a breaking downgrade of a build-time tool.

**Local set-up.** This worktree has its own stack, `Bike_Booking_secfix` on ports 6372x, started with CI's service list; `supabase/config.toml`'s change is local only (`git update-index --skip-worktree`), and both apps' `.env.local` name the same stack.

## Help articles for built screens (branch `docs/help-articles-built-screens`, 19 Nov 2026)

**Docs only: no code, migration or test changed.** Written from `main` at `b9e0b33`.

- **46 help articles** in `docs/help/en/<area>/<slug>.md` (English only; Thai after Korn's review), one task each, with front matter (title, summary, keywords in English and Thai script, screens, updated), short steps and a "Common problems" section quoting every refusal message from `en.json`. Areas: sign-in and device, team, locations, shop settings, fleet, products and prices, pricing and tax settings, seasons, price lists, coupons. A script checked every bold quote against `en.json` and every link.
- `docs/help/README.md`: index by area, the article format, and the rule that each PR changing a screen updates its article. `docs/help/PENDING.md`: what PR 51 will change (the number rule, coupon code messages, the coupon list's uses, the renewal cost, saving opening hours).
- **Written from the screens, not the spec, where they differ:** platform screens have no make or model (a product is known by its name) and no year bands (the panel was removed in Products stage A); a product can be restored but there is no button to retire one; booking rules have no screen yet, so they have no article. Not covered yet: the Moto Mangos tab, gear stock, product History, platform admin.
- **Spec: vehicle notes.** SPEC's units table and Vehicle record now have a notes field (fitted accessories). `platform.units.notes` already exists (text, up to 2,000 characters, since `20261110000500_platform_fleet.sql`); it is on the vehicle's Details form for owners and managers, shown on the vehicle page, and audited by the `units_audit` trigger. Still to build: show it on the staff app's bike card and make the Fleet search find it (Fleet search today matches product name, plate, frame and engine number). Listed under Phase 1b below.

## Next.js security upgrade (branch `security/next-upgrade`, 17 Nov 2026)

`next build` warned that the Next.js version is affected by a known security vulnerability.

- **Advisory:** GHSA-mfr8-8qww-v76h (CVE-2026-119790), **medium**, published 16 Nov 2026. Information disclosure across root params: a `'use cache'` function that reads a root param and is called both directly and through `unstable_cache()` can, in a race on a cold process start, have its result stored without root params and served to requests for other root param values. Affects `next` 16.3.0 to 16.4.4; **first fixed 16.4.5**.
- **Exposure:** the marketplace uses `'use cache'` (`cacheComponents: true`) but nothing in the repo calls `unstable_cache()`, so the affected path was not reachable.
- **Change:** `next` and `eslint-config-next` 16.4.2 → **16.4.5** in both apps, and the `next` peer range in `packages/db` (it pinned 16.4.2, which kept a second, vulnerable copy installed). Lockfile: only the `next`, `@next/*` and `eslint-config-next` entries change. Same major line; no code change. `npm audit` no longer lists `next`. The other `npm audit` findings (hono, body-parser, typescript-eslint, shadcn's tree) are left as they are.
- **Tests**, on this worktree's own local stack: typecheck and lint clean; unit 929 (marketplace 202, platform 364, core 363); database: marketplace 87, platform 556. In the full platform run, 4 lock-timing tests failed under load (timeouts in `availability`, `reservations`' cleanup hook, and a 620 ms wait where over 700 ms was expected in `tax-profile-in-use`); the three files pass when run alone (78, 68, 11). Browser, on a freshly reset and seeded database, 375 px and 1280 px, two workers: 142 tests, **135 passed, 7 skipped, 0 failed**. Production build of both apps on 16.4.5 succeeded with no vulnerability warning.

## Phase 2: plan only (branch `docs/phase-2-plan`, 16 Nov 2026)

**No code and no migration.** The plan is `docs/phase-2-plan.md`, written from `main` at `731d4e8`. **Approved by the owner on 16 Nov 2026:** all 17 recommendations of §10 and everything in §11, with three additions (online channels reach `reserve()` only through one server entry point that calls `offer()` first, tested in stage 3; a coupon never reduces the deposit and the total can't go below zero, tested in stage 7; no weekday or weekend rules, and stage 11 updates the spec's Phase 2 accept line). Stages 1 to 5 are built (below).

- **Already built by stage D:** price lists, seasons, VAT, deposits and `quote()` steps 1 to 3 and 5 to 8.
- **Still to build:** the booking function (`reserve()`) with product locks, then unit locks sorted by their hash key, and a best-fit pick; the availability read; overbooking and the shortage rule; holds; booking rules (notice, cut-off, minimum days); `product_extras` and the pricer's included-quantity step; coupons and the returning-customer discount; the quote snapshot.
- **Six migrations, eleven stages, one PR each**, the booking core first.
- **Found while reading, to fix in stage 1:** `unit_blocks_guard` orders two unit locks by UUID where `lock_units()` orders by hash key. Nothing crosses today (only a hand-edited downtime row moves a block between units).
- **Not in any migration yet, though the spec lists them:** `allow_overbooking`, and the notice, cut-off and minimum-days columns.
- `docs/platform/SPEC.md`, `docs/INTEGRATION.md` and `docs/platform/MAPPING.md` are not changed; the plan's §12 lists what each will need.

## Phase 2, stage 1: the booking core (branch `platform/phase-2-stage-1-booking-core`, 16 Nov 2026)

The first build stage of Phase 2, of eleven (`docs/phase-2-plan.md` §2.1, §3.1 to §3.4, §4, §8). **Database only: nothing on any screen changes.** **On staging since 16 Nov 2026** (pushed with stage 2's; see "On staging" under stage 2); **not on live.** `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**The first test, before anything else: a rolled-back sub-transaction does give back its transaction-level advisory locks** (Postgres 17.11, the local stack). One session inside one open transaction; a second session trying each lock while it is still open:

- taken inside a savepoint that was rolled back: **free**;
- taken inside a PL/pgSQL block that raised: **free**;
- taken before the savepoint, and taken again inside it: **still held**;
- taken inside a PL/pgSQL block that finished: **still held**.

So `reserve()` is built as the plan designed it (pick, lock the picked units in key order, read again, undo and pick again), and the fallback (lock every candidate unit before picking) is not used. It is the first test of `tests/db/reservations.test.ts` and runs in CI.

**What changed**

- **One new migration, `20261116000100_platform_reservations`.** No earlier migration is touched.
  - **`platform.reservations`**: N units of one product at one place for one window, with a booking id shared by the rows of one call, a parent row for an extra, the window widened by the buffers in force, channel, mode and state. No money, no customer. Every member reads; nobody signed in writes it directly; grants written on purpose (`service_role` too); `updated_at` and audit.
  - **`unit_blocks.reservation_id`**: an allocation or a hold must belong to a reservation, downtime and a transfer to none (`unit_blocks_reservation_check`).
  - **`unit_blocks.created_by` is set in the database** from `auth.uid()` on insert (in the block guard) and can't be changed afterwards: a signed-in person may now update a block's unit, period and note only (column grants). Empty for the service role.
  - **`unit_blocks_guard` re-created** from its body in the database (`pg_get_functiondef`): a block moved between two units takes both locks through `lock_units()`, so in key order, where it took them in UUID order. The only other change is the `created_by` line.
  - **`platform_private.booking_roles()`**, mirrored by `apps/platform/lib/booking-permissions.ts`; a database test compares the two.
  - **`platform_private.lock_products_stock()`**: every (product, place) pair of a booking, sorted once by the same key `lock_product_stock()` uses.
  - **`platform_private.free_units()`**: active units of a product at a place with no block of any kind overlapping the widened window.
  - **`platform.reserve(p_tenant_id, p_request)`**: staff (`walk_in`, `phone`, a signed-in owner, manager or staff member) and online (`booking_page`, `marketplace`, `api`, the service role) through the same function and the same locks. Named units for staff; best fit otherwise. All lines or none. One `reserve` audit event per booking.
  - **`platform.cancel_reservation(p_tenant_id, p_booking_id | p_reservation_id)`**: blocks that have not started are deleted, one that has is ended now; one `cancel` audit event.
- **The stock functions that ask "does a booking hold this unit"** (`set_stock_quantity`, `report_gear_problem`, `resolve_unit_problem`, `product_stock`, `gear_unit_state`, `upcoming_bookings`, `units_guard`, `units_clear_downtime`) were read from the database against the new column. Each asks by a block's kind or period, so none changed.
- **Root `CLAUDE.md`** has the lock order (plan §4, §12). Types regenerated (`packages/db/src/database.types.ts`).

**Where this differs from the plan, or decides what it left open** (say if any should change)

1. **`unit_blocks.reservation_id` is "no action", not "on delete restrict".** Both stop a reservation being deleted from under its block. `restrict` would also stop a whole tenant being deleted in one statement (it refuses before the blocks are gone); "no action" checks at the end of the statement, as every other composite key here does.
2. **Two kinds of answer.** A refusal the caller can meet in normal use is `{ok: false, reason}`: `not_allowed`, `unavailable`, `unit_taken`. A request our own code could not have sent raises an error instead: `invalid_request`, `product_not_found`, `location_not_found`, `unit_not_found`, `not_reservable` (an item for sale). The plan listed only the first kind. Another shop's product, place or unit raises exactly what a made-up id raises.
3. **One reason more than the plan's list: `try_again`**, for the plan's "Postgres detects a deadlock and cancels one side; answered as a clean refusal the caller may retry once". No test has ever produced it.
4. **`cancel_reservation` has its own reasons**: `not_found` (also another shop's), `not_cancellable` (a row already `out` or `returned`). Cancelling again answers `ok` with nothing cancelled. Cancelling one row by its id cancels the extras that came with it.
5. **Unit locks are taken once for the whole booking, not line by line** (the plan's step 4 reads "for each line"). Every line is picked first, then all picked units are locked together in key order, then every line is read again. Line by line, a two-line booking could hold a unit of its first line while waiting for one of its second, out of key order.
6. **A request-mode booking is refused for now** (`invalid_request`): the plan's §11 says it holds no unit until the shop accepts it, and that state is not written in Phase 2. Online modes accepted: `instant`, `now`. Staff: `staff`.
7. **An extra's parent is the index of an earlier vehicle line** in the same request (`"parent": 0`). An extra is gear or a service; a vehicle can't be one.
8. **Units can be named only where a unit is a thing with a name**: a vehicle, or gear tracked unit by unit; one id per unit wanted. Naming a unit of counted gear is `invalid_request`.
9. **Two lines for the same product in one call never share a unit while their windows overlap**; lines that don't overlap can.
10. **`free_units()` has rules 1 and 2 of plan §3.3.** Rule 3 (a unit still out past its end) is stage 2's, as the plan's migration table has it.
11. **The service role may cancel any booking of the shop it names**, as the plan's table says ("Owner, manager, staff; service role"), not only online ones.
12. **The trigger function `unit_blocks_guard` lost its default execute grant** (revoked from `public`, `anon` and `authenticated`), like every later trigger function. Nobody could call a trigger function anyway.
13. **A reservation's rows are audited row by row and the booking once** (`reserve`, `cancel`), and each block still writes its own audit row as before. A five-helmet booking is seven audit rows. Say if the row-level ones should go.

**Tests**

- Database: 418 on the platform, all passing on a freshly reset local database (353 before). New: `reservations.test.ts` (60 tests, the unit-delete test added after the review) and 5 in `default-grants.test.ts`. The isolation harness has a fixture row, a forged row and a change to try for `reservations`. Eight older tests that wrote an "allocation" by hand now make its reservation first (`allocationFor` in `tests/db/helpers.ts`); what they assert is the same.
- **The accept races, 20 rounds each, in each of three shops** (Bangkok THB, New York USD with daylight saving, Saigon VND): staff against staff, online against online, staff against online, staff naming the unit against staff naming none, staff naming the unit against online, both naming the same unit. **360 rounds, every one with exactly one success**, the loser answered `unavailable` or `unit_taken`, and after each set the product has exactly two reservations, two blocks and two audit events a round.
- More races, in all three shops: twelve bookings for the last helmet (15 rounds); two bookings each wanting 2 of the same 3 helmets (30); two two-product bookings naming the products in opposite orders (45); a booking against a downtime on the unit it picks (45); against its unit being sold, retired or marked lost (54); against the quantity being lowered or a problem report (24); a cancel against a new booking (30). **603 race rounds in all.**
- **No deadlock on any path:** no call answered `40P01` or `try_again`, and Postgres' own count of detected deadlocks for the database (`pg_stat_database.deadlocks`) is the same after the file as before it.
- Also held: a booking overlapping downtime is refused by the pick (`unavailable`), by name (`unit_taken`) and by the constraint when written by hand as the service role; all or nothing with the blocked line first, in the middle and last, on both paths; every one of the five roles through both functions and by hand on both tables; another shop's five roles, a stranger and a signed-out visitor; cross-tenant refusals for `reserve`, `cancel_reservation` and `free_units`, each beside the same call with a made-up id; buffers; best fit; the lock order (a second booking waits on the product lock with no unit lock in hand; `lock_products_stock` takes keys in order; the guard's two unit locks in key order, which fails against the old body; a unit taken between the pick and its lock is left out and the booking picks again).
- Unit: 347 on the platform (345 before; `lib/booking-permissions.test.ts`, 2), 290 in `@mango/core`, 202 on the marketplace. Typecheck and lint pass for every workspace, the one-pricer (money) rule included.
- **The migration on a seeded copy of `main`'s database** (reset to the 60 migrations of `main`, the three demo shops seeded, then this migration): 3 shops, 16 products, 170 units and 263 audit rows before and after, with the same checksums over the products and the units. The demo seed has no blocks and no prices, so nothing had to move; D7's BSR prices are on staging only and were not loaded here.
- Browser: the full suite on a freshly reset and seeded local database, 375 px and 1280 px, two workers, run twice (before and after the review fix): 140 tests, 131 passed, 7 skipped, 2 failed, the same two both times, in `products-stage-d6.spec.ts` at desktop width ("tax profiles: one in use can't be removed" and "the rounding step changed in Settings"). CI passes all of them. The tax-profile one was traced: at phone width the test removes its "E2E VAT" profile at the end; the desktop run that follows looks for "Bring back" with `count()`, which does not wait for the page, finds nothing, never brings the profile back, and then waits its whole six minutes for a "Tax on this product" option that is not there. So it is a race in the test itself (a known issue below), not in this stage: no app code changed and the migration does not touch tax profiles. The second failure sits behind the first in the same settings queue. No new browser test: nothing on a screen changed.

**After the review of PR 36 (16 Nov 2026).** Two things fixed before merge, in the same PR. The migration had not left this machine, so it was edited in place.

- **A booking could deadlock with a unit being deleted.** Deleting a unit takes no advisory lock: it locks the unit's row, then the product's row (the count-clamping trigger). `reserve()` locked the product's row first and met the unit's row only at its block insert, the other way round. Now, right after `lock_units()` and before it reads again, it locks the picked units' rows `for key share` in id order. It holds no row lock at that point, so behind a delete it only waits; the unit is then gone from the read, and the booking picks again. The lock order in the root `CLAUDE.md` and in the migration's header says "unit rows, then the product's row".
- **The test:** three sessions. Someone's unsaved edit of the product; a unit delete that has removed the unit's row and waits for the product's row behind that edit; a booking that picks that unit. The booking is seen waiting for the delete with nothing locked or written, the delete goes through, no deadlock is counted, and the booking takes the other unit (two units) or answers `unavailable` (one unit). Against the function as first pushed, the test fails: the booking never waits on the unit.
- **An assertion that could not fail** (`bookings >= 0` in the downtime race) is replaced: per shop, the allocations in the database equal the bookings that answered ok, the downtime rows equal the other rounds, and there is no reservation without its block.

**Carried to stage 2** (from the review)

- Provably-waiting versions of the named-unit race and of the sold, retired or lost race: one side held in place and seen waiting, as the lock-order tests do, not only fired at the same instant.
- Drop the row-level audit rows for allocation and hold blocks (keep them for downtime, and for reservations), and add the unit ids to the `cancel` event.
- After an exclusion violation in `reserve()`, add the unit to `v_exclude` so the next attempt can't pick it again.
- Correct the "A downtime write, a unit status change" row of the plan's §4 table: a change between active and maintenance takes no unit lock (only selling, retiring and marking lost do).

**Carried to stage 3** (from the review)

- `bookOnline()` treats `55P03` (`lock_timeout`) the same as `try_again`.

**Carried to 3M** (from the review)

- Request mode needs its own state and its own migration before Moto Mangos books through the platform. `reserve()` refuses it until then.

**Before this goes to staging** (the owner's word each time, plan Q17): the migration adds a check that every allocation and hold has a reservation. Nothing could write either kind before this stage, so there should be none; the read-only count before the push must show 0 rows of `unit_blocks` with `kind` in (`allocation`, `hold`), or the migration stops there and changes nothing.

**Known issues and follow-ups**

- A product that has ever been reserved can't be deleted (the reservation's key to it), as a unit that has ever been booked can't. For a service this is new: the app should offer "retire" there when Phase 3 makes real bookings.
- `e2e/products-stage-d6.spec.ts`, the tax-profile test: its "Bring back" check uses `count()` without waiting for the list, so the second width of a local run can miss a removed profile and time out. Not touched here; it needs a waiting check (CI's retries hide it).
- A race test shows a race is closed for the timings it hit.
- Nothing on a screen calls `reserve()` yet. Stage 3 builds the one server entry point for online channels; Phase 3 the staff screens.

**Local set-up.** This worktree has its own stack, `Bike_Booking_phase2_s1` on ports 6132x; `supabase/config.toml`'s change is local only (`git update-index --skip-worktree`), and `apps/platform/.env.local` names the same stack.

**Next:** stage 2, shortage, holds and the availability read (migration 2).

## Phase 2, stage 2: shortage, holds and the availability read (branch `platform/phase-2-stage-2-availability`, 16 Nov 2026)

The second build stage of Phase 2, of eleven (`docs/phase-2-plan.md` §3.2 to §3.5, §4, §8). **Database only, apart from one thing on a screen: the vehicle's Details form warns before a booked vehicle is moved.** **On staging since 16 Nov 2026** (62 of 62; see "On staging" below); **not on live.** `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **One new migration, `20261116000200_platform_availability`.** No earlier migration is touched. Functions that existed are re-created from their bodies in the database (`pg_get_functiondef`) with the changes listed, and their grants restated.
  - **`tenants.allow_overbooking`** (off) and **`hold_minutes`** (15; 5 to 60). Every member reads them. Nobody signed in can write them yet: the Booking rules screen and `save_booking_rules()` are stage 3's, so until then only the service role can switch overbooking on.
  - **`platform.reserve()` re-created.** `"hold": true` makes a hold: rows `held` with `hold_expires_at`, blocks of kind `hold`. The shortage rule: with overbooking on, a signed-in member's booking that can't get all its units is saved with the ones it could get and `shortage` = the rest; online channels answer `unavailable` as before, on or off. Shortage demand is taken off what is free. Holds that have run out on the booking's products are released before its rows are written.
  - **`platform.confirm_hold()`**: `held` becomes `reserved`, the same blocks become allocations. A hold is confirmed by whoever could have made it: a member for the counter and the phone, the service role for online channels. After it has run out: `hold_expired`.
  - **`platform.assign_units()`**: fills a shortage with the best-fitting free units, or (with units named) sets the units a not-yet-collected reservation holds: staff's swap before pickup. Owner, manager and staff; not the service role.
  - **`platform.release_expired_holds()`** and its schedule: every minute with `pg_cron`, as the renewal job is. One `expire` event per booking.
  - **`platform.availability()`**: the read. For each product, place and window: `stock`, `free`, `shortage_demand`, `available`, and for a product with a listing the Moto Mangos figures `listingOffer()` needs. It runs as its caller under RLS and takes no lock. A service is `unlimited`; an item for sale answers what the ledger has on hand.
  - **`platform_private.free_units()` re-created**: a hold that has run out holds nothing, released yet or not; **the overdue rule** (a unit whose reservation is `out` and past its end is not free for any window).
  - **`platform.cancel_reservation()` re-created**: its event names the units each row held.
  - **`platform_private.booking_roles()`** gains `confirm` and `assign`; `apps/platform/lib/booking-permissions.ts` is its copy.
- **App:** the vehicle's Details form warns before a move and saves it through `move_unit()`; new messages `unit_busy` (a unit delete that met a booking in flight), `unit_has_bookings`, `bookingsChanged` and the warning, English and Thai, on the Thai review list. Types regenerated.
- **Root `CLAUDE.md`**: four lines under the lock order (releasing a hold, deleting a unit, which unit changes take the lock, moving a unit). **`docs/phase-2-plan.md` §4**: the "status change" row corrected, and rows added for a unit delete, the sweep, `move_unit()` and a direct move.

**The six items carried from stage 1 and the review of PR 36**

1. **The flaky `products-stage-d6.spec.ts` test is fixed.** Its "Bring back" check used `count()`, which reads the page as it is. It now waits for the tax-profile section's last element first, so a removed profile is always found and brought back. On a freshly reset and seeded database the file was run at phone width and then at desktop width, back to back: 7 passed and 1 skipped each time, the tax-profile test among them (it used to fail on the second).
2. **Provably-waiting versions of two races** (`reservations.test.ts`, "one side held in place, the other seen waiting"). The named-unit race, three ways round: a whole booking is made in one session and left unsaved; the second is seen in `pg_locks` waiting for the product's lock with no unit lock in hand; then it is refused (`unit_taken` or `unavailable`). The sold, retired and lost race, both ways round for each: the status change unsaved and the booking seen waiting for that unit's lock with its product lock in hand, then `unavailable`; and the booking unsaved and the status change seen waiting for the unit's lock, then `unit_has_future_blocks`.
3. **Audit.** Allocation and hold blocks are no longer audited row by row (the one trigger became three, each with a `WHEN`). Downtime, transfers and every reservation row still are. The `cancel` event has `lines` with each row's unit ids; `expire` and `assign` name their units too.
4. **After an exclusion or foreign-key violation, the units that are now taken join `v_exclude`**, so the next attempt can't pick them again and a line that named one answers `unit_taken`. Tested with a block written with the triggers off (so past the unit lock) and not yet saved.
5. **A unit delete takes the unit's lock, but it can't wait for it** (see "differs from the plan", 1).
6. **Decided: a unit put into repair or back takes no unit lock. A move to another product or place was decided the same way at first; the owner then decided that a booked unit's bookings move with it, which is built (below) and does take locks.** The reasons, which still hold for repair:
   - Neither checks anything a booking writes. A unit with bookings may go into repair (bikes break; Phase 3's today board flags the bookings), and nothing refuses a move. So whichever lands first, the result is the one the shop could also reach a second later: a booked unit that is in repair, or that moved. The lock would make one side wait and change no outcome. Selling, retiring and marking lost are different: each reads the unit's blocks and refuses, so each must see them settled, and each takes the lock.
   - Neither changes a key column of `units`, so its row lock does not conflict with the key-share lock a booking takes: it can neither stop a booking nor be stopped by one.
   - Taking it would add a path that takes unit locks out of key order: one statement that changes several units (an owner's bulk change through the API) would take them in whatever order it met the rows.
   - If a rule is ever added that reads a unit's blocks on such a change ("can't be moved while it has bookings"), the lock goes in with that rule. The plan's §4 table and the root `CLAUDE.md` say so.

**Item 6, the owner's decision (16 Nov 2026): a move stays allowed, and the bookings move with the unit.** Built on this branch, in the same migration (it had not left this machine or CI's throwaway databases, so it was edited in place, as stage 1's was).

- **What a move did before this** (checked on the local database: a Moto Mangos booking and a staff hold on product A, both units then moved to product B). Stock counts stayed right on both sides, because a unit is counted where it is and its blocks go with it. The reservation did not follow, so three things disagreed with where the unit was: the Moto Mangos counts (A still showed the booking held, B showed none); `assign_units()` by name (naming the unit the reservation already held raised `unit_not_found`); and a run-out hold on a moved unit, which only the minute sweep released. The app's "upcoming bookings" count on a product already followed the unit.
- **`platform.move_unit(tenant, unit, product, place)`**: every reservation that is `held`, `reserved` or `out` with a block on the unit that has not ended takes the new product and place. A row for several units is split: the moved unit's part becomes a row of its own for one unit, in the same booking; what the row is short of stays on the product it was booked on. One `move` event per booking, with the unit and where it went from and to. Owner and manager, and the service role. Finished, cancelled, expired and returned bookings stay where they were. The price does not move: Phase 3's order line keeps the quote snapshot.
- **Locks:** the product-and-location locks of where the unit is, where it goes and whatever its bookings name, sorted once; then the unit's lock; then rows. Root `CLAUDE.md` and the plan's §4 table have it.
- **A direct change of a booked unit's product or place is refused** (`unit_has_bookings`), for the service role too: `units_guard` re-created from the database with that one check. It reads the unit's blocks, so it takes the unit's lock, as selling and retiring do. A unit with no booking moves directly, as before. So a reservation that holds a unit always names that unit's product and place; a test helper asserts it after every move and race.
- **The warning before saving**, on the vehicle's Details form: "This vehicle has an upcoming booking. It will move with it to {destination}." / "This vehicle has # upcoming bookings. They will move with it to {destination}." (Thai: "รถคันนี้มีการจองที่กำลังจะมาถึง {count} รายการ การจองจะย้ายตามรถไปที่ {destination}"). The destination is the new product, the new place, or both. Both languages are on `docs/platform/thai-review-products.md`, with two error lines (`unit_has_bookings`, `bookingsChanged`).
- **The save checks the warning was true.** The form sends how many bookings it warned about and when it loaded the unit; `move_unit()` moves nothing if either has changed (`bookings_changed`, `stale`) and the form asks the person to reload.
- **Hold release is wider:** `expire_holds()` also releases a run-out hold whose block is on a unit of the products it was given, whatever product its reservation names. Such a hold is not under a lock the caller holds, so its rows are locked first and read again (reservations, then blocks, as a cancel takes them).
- **Not moved, for Phase 3** (orders and the today board):
  - **An overdue rental stays on the old product.** A reservation follows only while its block on the unit has not ended. A rental that is `out` and past its end has a block that has ended, so its row keeps the product and place it was booked on. The unit itself is still held back by the overdue rule wherever it is, so nothing can book it.
  - **An extra's reservation does not follow its vehicle to another place.** Helmets booked with a scooter are their own rows on their own units; when the scooter moves to another place, the scooter's row goes and the helmets' rows stay at the first place.
- **Decided here** (say if any should change): a rental that is `out` and not yet due follows (the bike is that product now); a place move changes where the customer collects and nothing tells the customer yet (Phase 3's orders and messages); the form's save is one call when the product or place changes: `move_unit()` writes the other fields in the same statement that moves the unit, so a refused field (a plate another vehicle has) undoes the move too.

**After the review of PR 37 (16 Nov 2026).** Eight items, all in this PR; the migration was edited in place again.

1. **`move_unit()` takes the unit's row without waiting** and answers `try_again`. A direct update of a unit locks its row and then waits for its lock (the guard); the move holds the lock by then, so waiting for the row was a deadlock. Test, three sessions: one holds the unit's lock, the move queues for it, a manager retiring the unit takes the row and queues behind the move; the first lets go, the move answers `try_again`, the unit is retired, and Postgres counts no deadlock. With the wait put back the test fails (one deadlock counted).
2. **`move_unit()` locks the products' rows `for no key update`**, the strength the unit's own update needs at the end. With `for share`, two moves of units of one product at two places each held share and each waited to raise it. Tests: one move unsaved and the second seen waiting for the row with both its product locks; and both at the same instant, 10 rounds a shop. With `for share` put back the second fails in its first round.
3. **The Details form saves in one call.** `move_unit()` takes the form's other fields (`p_details`) and writes them in the statement that moves the unit. The two-step save is gone. Tested in the database (a plate that is taken undoes the move) and in the browser (a colour and a move in one save).
4. **The key-share step in `reserve()` has its own test again.** One session holds the unit's row; the booking is seen waiting for a row with the unit's lock in hand; a third session takes the product's row `nowait` and gets it. With the step removed the third session fails ("could not obtain lock").
5. **`cancel_reservation`, `confirm_hold` and `assign_units` read the reservation's product again under the lock** and answer `try_again` if a move changed it, or split the booking, between their first read and the lock. Test: a move unsaved, each of the three seen waiting for the old product's lock, then `try_again`, then fine when sent again.
6. **PUBLIC can no longer execute anything in `platform_private`.** Letting the service role into that schema (for the read) had also opened the fourteen older functions there that PUBLIC could execute. They are revoked from PUBLIC; members keep the six they call, by their own grants. A test asserts the exact list the service role can execute (eight functions), that each is granted to it by name, and that PUBLIC has none.
7. **The "seen waiting for a product lock" checks are keyed to the session under test** (by the function it is running), in both test files.
8. **Docs:** downtime added to the run-out-hold known issue; the two things a move leaves behind (below); the `expire` event comment; a root `CLAUDE.md` line on the two guards locking the row before the unit lock.

**Where this differs from the plan or the brief, or decides what they left open** (say if any should change)

1. **The unit-delete trigger asks for the lock once and never waits.** A waiting lock there is a deadlock every time, not a fix: Postgres locks the unit's row before a `before delete` trigger runs, so the delete would hold the row and wait for the lock while a booking holds the lock and waits for the row. Tried on a scratch table before building: Postgres reported the deadlock. So when anything holds the unit's lock at that moment the delete is refused with `unit_busy` (`55P03`) and can be sent again; the app says "Someone is saving a booking or a block on this one right now. Please try again." A delete of several units in one statement can no longer cross a booking: it is refused at once, or it waits on a row holding nothing the booking still needs. The stock functions that delete units hold these locks already.
2. **Holds are released in the rows phase, not straight after the product locks** (the plan's step 3), and without unit locks. Until then the pick simply does not count a hold that has run out. Releasing first would either take a second batch of unit locks out of key order, or delete block rows before the unit rows are locked; each opens a cycle with a unit being deleted. Releasing only deletes blocks, under the product lock every writer of that reservation's blocks holds.
3. **A hold that has run out holds nothing from that moment**, for bookings and for the read, whether or not the sweep has run. The sweep only tidies up.
4. **Expiry is judged by the transaction's start time** (`now()`). A confirm that started before the expiry and waited for a lock is still in time; one that started after is refused.
5. **A line that names its units is never saved short.** A named unit that is busy answers `unit_taken`, overbooking or not; a named unit that is free but owed to a short reservation answers `unavailable`.
6. **A hold can be short too** (staff, overbooking on), and stops being owed when it runs out.
7. **Filling a shortage is first come, first served**: `assign_units()` gives a reservation the free units, up to its shortage, without asking which short reservation is older.
8. **`assign_units()` with units named never leaves a reservation with fewer units than it has**, so it can't create a shortage; and units can be named only where a unit is a thing with a name, as in `reserve()`.
9. **`confirm_hold()` answers `hold_expired` and leaves releasing to the sweep or the next booking**; `not_held` for a booking that is cancelled, collected or returned; `ok` with nothing confirmed for one confirmed already.
10. **`availability()` raises instead of answering a refusal**: `not_allowed` (42501) for someone outside the shop; `product_not_found` and `location_not_found`, the same for another shop's as for a made-up id; `invalid_request`.
11. **The Moto Mangos figures are per product, not per place** (a listing is per product), over the widened window, counting `reserved`, `out` and live `held` rows of channel `marketplace` in modes `instant` and `request`. Stage 3 builds the cap check on them.
12. **The service role may now look into `platform_private`** (schema usage), because the read runs as its caller and the server calls it. Each function there is still granted one by one; a test lists them.
13. **The window is widened by the product's own buffers only**, as in stage 1. The shop's default buffers are stage 3's.
14. **`release_expired_holds()` takes the product locks of every shop's expired holds in one sorted batch.** A run that Postgres ends to break a deadlock answers 0 and leaves it to the next minute. None has been seen.

**Tests**

- **Database: 509 on the platform, all passing on a freshly reset local database** (418 before). New: `availability.test.ts` (78 tests, 19 of them the move), 7 in `reservations.test.ts` (the provably-waiting races) and 4 in `default-grants.test.ts`. Six stage 1 tests were changed where this stage changes what they read on purpose: the `reserve` and `cancel` events' shape, `hold` no longer an unknown key, the grants of three helpers, and the unit-delete test's wait.
- **Holds:** made, confirmed (the same rows and blocks), cancelled, run out. A hold that has run out frees its unit at once for the read and for the next booking, which releases it; confirmed after it has run out it is refused, released yet or not. **In the New York shop across both clock changes of 2031** (made 01:50 before each): the expiry is 15 elapsed minutes later (03:05 on the wall in March, 01:05 in November), and the sweep releases it at that moment and not one second, or 59 minutes, before, in a session on New York time.
- **Overbooking:** off answers `unavailable` for staff and online and writes nothing; on saves a shortage for staff and still answers `unavailable` on all three online channels. **Shortage demand** is taken off availability, at the busiest moment and not as a sum; a unit that is owed can't be booked by anyone else, by name either. **`assign_units`** fills a shortage, in part when only part can be filled, moves a reservation, and is seen in `pg_locks` waiting for the product's lock with no unit lock in hand, and for a unit's lock with the product lock in hand.
- **Moving a booked unit:** both products' counts and Moto Mangos figures before and after; a place move; a row for four split three times, its shortage left behind; finished, cancelled and returned bookings stay; a direct change refused for owner, manager and the service role; `assign_units()` by name afterwards; the warning's count and the form's age checked; roles and another shop's things; a run-out hold on a unit moved past the guard; and four held-in-place tests (a booking of either product unsaved and the move seen waiting for a product lock with no unit lock; the move unsaved and a booking of either product seen waiting; a direct change seen waiting for the unit's lock, then refused).
- **The overdue rule** with a hand-set `out` state: the unit is free for no window until it is checked in; out and not yet due blocks its own window only.
- **The read:** stock, free and available against bookings, holds and downtime; buffers on both sides; units in repair, retired, sold or lost are not stock; a service, an item for sale, a second place, the Moto Mangos figures; it answers while another session holds the product's and the units' locks.
- **Roles and shops:** every one of the five roles through `confirm_hold`, `assign_units` and `availability`; the service role where it may and may not; a stranger and a signed-out visitor for all four new functions; another shop's booking, row, unit, product and place answered exactly like a made-up id, beside the same call with one.
- **Races, 10 rounds each in each of three shops** (Bangkok THB, New York USD, Saigon VND), most with the sweep running beside them: two holds for the last unit; a hold confirmed while it is cancelled; a hold that has run out confirmed while the sweep and a new booking arrive (never confirmed, released exactly once); a live hold confirmed against the sweep and a rival; a reservation moved to a unit a booking names; a shortage filled while a mechanic blocks the unit and a rival books; a booking, a cancel and a fill at once. **270 rounds here (60 of them moves: a move racing bookings of both products, and two moves from one product), 873 with stage 1's 603**, plus 20 held-in-place scenarios. **No deadlock:** no call answered `40P01` or `try_again`, and Postgres' own count of detected deadlocks did not move in either file.
- **Fragmentation, measured as the plan's Q2 asked:** 160 fixed-sequence bookings of 1 to 3 helmets on 20, 6 hours to 4 days long over 30 days: 126 booked, 34 refused, and **none of the 34 would have been allowed by a pool rule** ("one free at every moment"). On this measure nameless gear does not need re-packing.
- **Unit:** 347 on the platform, 290 in `@mango/core`, 202 on the marketplace. Typecheck and lint pass for every workspace, the one-pricer (money) rule included.
- **The migration on a seeded copy of `main`'s database** (61 migrations, the three demo shops seeded, then this one): 3 shops, 16 products, 170 units and 263 audit rows before and after, with the same checksums over the products and the units; no block, reservation or pricing row either side. Every shop reads overbooking off and 15 minutes; the second cron job is there.
- **Browser:** the full suite on that database, 375 px and 1280 px, two workers: 142 tests, **135 passed, 7 skipped, 0 failed** (stage 1 had 2 failing locally, both behind the test fixed here). New: `unit-move.spec.ts`, at both widths: the warning in the singular and the plural with the destination's name; declined, nothing moves; accepted, both bookings follow; a save that moves nothing asks nothing.
- **One intermittent failure while building, not seen again:** in one full run a held-in-place test (a booked unit marked retired) hit its 60-second limit. Typecheck, lint and the unit tests were running on the same machine at that moment, and these tests poll through `docker exec`. It passed alone five times in a row and in the two full runs since. The test now says at once if its held session ends early, where it would have polled to the limit.

**Known issues and follow-ups**

- **Overbooking can't be switched on from a screen yet** (stage 3's `save_booking_rules()`, stage 11's screen). Until then the shortage rule is reachable only where the service role sets the column, which is the tests.
- **The older stock checks still count a hold that has run out until the sweep removes its block** (at most a minute with `pg_cron`): `set_stock_quantity`, `report_gear_problem`, `resolve_unit_problem`, selling or retiring a unit, the gear counts of `product_stock`, and **downtime**: a downtime written over a run-out hold's window on that unit is refused by the exclusion constraint ("overlaps another block") until the block is gone. They ask by a block's kind or period. Bookings and the availability read do not have this lag. Where `pg_cron` is not on, the block stays until the next booking of that product.
- The stage 1 test for a unit delete stalled behind a product edit no longer shows that `reserve()` locks unit rows before the product's row (the delete holds the unit's lock now, so the booking meets it one step earlier). That step has its own test since the review of PR 37 (item 4 above).
- **`pg_cron` on live** is on the go-live checklist; this adds a second job, `platform-release-expired-holds`.
- The best-fit pick is written twice (in `reserve()` and in `assign_units()`), because `reserve()` is re-created as a minimal diff. Stage 3 re-creates `reserve()` again and can fold the two into one helper.
- A race test shows a race is closed for the timings it hit.

**Before this goes to staging** (the owner's word each time, plan Q17): nothing to count first. The migration adds two columns with defaults and no check on existing rows; staging has no allocation, hold or reservation.

**On staging since 16 Nov 2026; not on live.** Stage 1's and stage 2's migrations (`20261116000100_platform_reservations`, `20261116000200_platform_availability`) were pushed together to staging (`mango-works-staging`, `qafhmdxsodeqkeznafaq`) at 12:29 UTC, from `main` at `65cc20f`, with `npx supabase db push --db-url` (never `--linked`). Staging records 62 of 62. Live was not touched.

Why then: `main`'s deployment (`mango-works-platform.netlify.app`) has run stage 2's code since PR 37 merged, and its vehicle form calls `move_unit()`. Staging did not have the function, so changing a vehicle's product or location failed there until this push.

- **Read-only checks first**, in one read-only transaction; all six passed:
  1. 60 migrations on record, newest `20261115000200`, neither of the two, and none that sorts after them. The CLI's migration list showed the same: 60 matching the repo, the two not yet on staging.
  2. `unit_blocks` rows of kind allocation or hold: 0 (all 21 blocks are downtime).
  3. The trigger `unit_blocks_audit` existed under that name. None of the 16 new function names existed in `platform` or `platform_private`; no `reservations` table, no `reservation_id`, `allow_overbooking` or `hold_minutes` column.
  4. The two functions that existed and are re-created had `main`'s bodies, by MD5 of the stored source against the body in the last migration that wrote each: `unit_blocks_guard` `8269353f…` (from `20261113000300`), `units_guard` `51474742…` (from `20261114000100`). The other re-created functions (`booking_roles`, `free_units`, `reserve`, `cancel_reservation`) are made by the first of the two migrations, so they had no body on staging to compare.
  5. `pg_cron` 1.6.4 is on, with one job: `platform-renewal-notifications` (`7 * * * *`, active).
  6. `authenticator`: `session_preload_libraries=supautils, safeupdate`, `statement_timeout=8s`, `lock_timeout=8s`. Also `authenticated` `statement_timeout=8s`, `anon` `statement_timeout=3s`, `service_role` none.
- **The dry run** listed exactly the two migrations. The push applied both in about five seconds.
- **After, read-only:**
  - 62 migrations on record, newest `20261116000200`.
  - All three shops (`big-fleet`, `bsr`, `saigon-scooters`) read overbooking off and a hold of 15 minutes.
  - Two cron jobs, both active: `platform-renewal-notifications` and `platform-release-expired-holds` (`* * * * *`). The new job's first three runs (12:30 to 12:32 UTC) all succeeded.
  - The service role's execute list in `platform_private` is the expected eight, the same as `default-grants.test.ts`: `booking_roles`, `free_units`, `json_time`, `json_uuid`, `marketplace_peaks`, `norm`, `queue_renewal_notifications`, `shortage_demand`. The service role has usage on the schema; PUBLIC can execute nothing there.
  - The one audit trigger on `unit_blocks` is now three (insert, update, delete); `units_busy_on_delete` is on `units`; all 17 new functions exist.
- **Counts, the same before and after:** 32 products, 205 units, 21 blocks, 3,413 audit rows, 13 pricing rows (5 price lists with 150 days, 1 settings row), 3 shops; every other `platform` table the same too. The same checksums before and after over products, units, pricing rows, price lists and their days, the settings row, and over blocks and shops with the new columns left out. `reservations` is new and empty.
- **On the deployed site**, as BSR's demo owner (`mango-works-platform.netlify.app`, `main`'s deployment): the test vehicle `E2E-MWBPU6LZ7871` was moved from Honda PCX 160 to Honda NX500 and saved (12:31:27 UTC), then moved back and saved (12:31:59 UTC). Both showed "Saved". The vehicle's row is as it was apart from its updated time (same checksum). The vehicle had no blocks, so no booking moved with it and the warning was not shown; `unit-move.spec.ts` covers that case and was not run against staging.
- **Left on staging:** two audit rows for those two moves (3,415 in all), and the vehicle's new updated time.
- **Not run against staging:** the browser suite. CI ran all of it on a clean local database.

**Local set-up.** This worktree has its own stack, `Bike_Booking_phase2_s2` on ports 6232x; `supabase/config.toml`'s change is local only (`git update-index --skip-worktree`), and `apps/platform/.env.local` names the same stack. Every other local stack was stopped (not removed).

**Next:** stage 3, booking rules and `offer()` (migration 3): the rule columns, `save_booking_rules()`, `booking_inputs()`, `bookOnline()` with its test, and the Moto Mangos cap inside `reserve()`. Carried to it from the review of PR 36: `bookOnline()` treats `55P03` (`lock_timeout`) the same as `try_again`.

## Phase 2, stage 3: booking rules and `offer()` (branch `platform/phase-2-stage-3-booking-rules`, 16 Nov 2026)

The third build stage of Phase 2, of eleven (`docs/phase-2-plan.md` §2.3, §2.6, §3.6, §4, §8; the owner's answers in §10, Q5 with its addition). **No screen changes: database, `@mango/core` and one server module.** **On staging since 16 Nov 2026** (63 of 63; see "On staging" below); **not on live.** `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **One new migration, `20261116000300_platform_booking_rules`.** No earlier migration is touched. Functions that existed are re-created from their bodies in the database (`pg_get_functiondef`, compared line by line with stage 2's text first: identical) with the changes listed, and their grants restated.
  - **The rule columns**, all empty to start ("not set" is no rule), each with its range held by the table: `locations.min_notice_hours` (0 to 720), `booking_cutoff_minutes` (0 to 1440), `min_days_advance` and `min_days_walkin` (1 to 365); `products.min_days_advance` and `min_days_walkin` (vehicles only; empty is the location's); `tenants.buffer_before_minutes` and `buffer_after_minutes` (the shop's default, 0 to 10080 like a product's).
  - **`platform.save_booking_rules(p_tenant_id, p_rules)`**: owners and managers. **The first writer of `allow_overbooking`, `hold_minutes` and the shop's default buffers**, which no signed-in person can write directly; also a location's four rules and a vehicle's minimum days. Only what is named changes, null clears a rule, all or nothing. Not the server's (revoked from the service role).
  - **`platform.booking_inputs(p_tenant_id, p_location_id, p_product_ids)`**: one read of everything the rules need: the location's time zone, hours, closures and rules; the shop's settings; each product's buffers in force, minimum days and listing. As its caller under RLS; every member, and the server.
  - **`platform.reserve()` re-created**: the shop's default buffers widen a vehicle that has none of its own; and **the Moto Mangos cap** (below).
  - **`platform.availability()` re-created**: the shop's default buffers, exactly as `reserve()` widens.
  - **`platform_private.booking_roles()`** gains `rules`; `apps/platform/lib/booking-permissions.ts` is its copy.
- **`@mango/core`**
  - **`booking-rules.ts`**: `bookable(rules, start, end, how, now)` answers `ok` or `outside_hours`, `too_short`, `too_soon`, in the location's time zone with no fixed offset; `offer(inputs, availability, pricing, request)` composes bookable, then available (with the Moto Mangos cap and mode), then `quote()`, so no caller gets a price for something it can't book. A product with no price answers `cant_be_priced` and carries no price at all, never zero.
  - **`time.ts` and `money.ts` are thin wrappers.** The rules are generic in `zoned.ts` (`fromWallClock`, `zonedDateTime`, `zonedParts`, `startOfZonedDay`, `addZonedDays`, `formatZoned`) and `currency.ts` (`toMinorUnits`, `fromMinorUnits`, `formatWholeAmount`, `currencyExponent`). The old names pass `Asia/Bangkok` and THB. The fixed UTC+7 arithmetic is gone.
  - `listing.ts`: `listingOfferFromPeaks()`, the same offer rule from the counts the availability read already takes, for one or several vehicles.
- **`apps/platform/lib/book-online.ts`: `bookOnline()`, the one server entry point for online channels.** It reads `booking_inputs`, `availability` and `pricing_inputs`, asks `offer()`, and calls `reserve()` only when the answer is bookable, available and priced. `lib/booking-inputs.ts` turns the rows into the rules' input and decides nothing. Nothing calls `bookOnline()` yet: Phase 8's booking page and 3M's `marketplace_api` will.
- **Root `CLAUDE.md`**: the sentence on a unit delete against a mechanic editing a downtime block, and a line on the listing's row. **`docs/phase-2-plan.md` §4**: item 3 says how the listing's row is taken. Types regenerated.

**The Moto Mangos cap inside `reserve()`** (channel `marketplace`)

- In the rows phase, after the products' rows: the listings' rows of the booking's products, in product-id order, `for no key update`. Under it, for each vehicle line:
  - a listing that is off or missing answers **`not_listed`**;
  - an advance booking (mode `instant`) must fit the units to offer (`instant_units + request_units`) **and** the Instant units, counting the Moto Mangos advance bookings that hold a vehicle in the window (`marketplace_peaks`, stage 2) and the call's own earlier lines: else **`cap_reached`**;
  - "Ride today" (mode `now`) is not counted and not refused by the cap.
- Gear and services booked with the vehicle have no listing and no cap. A refusal writes nothing.
- **Why the row lock is not `for share`:** the cap is per product, the advisory locks are per product and place. Two Moto Mangos bookings of one product for two places share no advisory lock, so with a shared row lock both would count the cap before either wrote. The listing's row makes them take turns. Tested held in place (the second booking is seen waiting for a row with its own product lock and unit lock in hand, then answers `cap_reached`) and as a race.

**The three items carried in**

1. **`bookOnline()` treats `55P03` (`lock_timeout`) the same as `try_again`.** `reserve()` does not catch it (tested: with another session holding the product's lock and a 300 ms lock timeout, the database raises `55P03` as it is); `bookOnline()` answers `{ok: false, reason: "try_again"}` with nothing written, and the same request goes through once the lock is free.
2. **No booking-page or marketplace path reaches `reserve()` without passing `bookable()`**, in three legs:
   - on a spy (`lib/book-online.test.ts`): a closed day, too little notice, too short a rental, nothing free, no price, not listed, the cap, request-only: each answers its reason and `reserve()` is never called;
   - on the database (`tests/db/booking-rules.test.ts`): the same refusals leave reservations, blocks and audit rows unchanged, counted before and after;
   - a static test over both apps: no file but `lib/book-online.ts` calls `reserve()` with the service role or names an online channel beside the call; the marketplace never calls it; no file with the service role imports a file that calls it; and the entry point itself calls `offer()` before its one `reserve()`. The detector is run on made-up files first (each way round is caught; a signed-in counter booking passes).
   - and in the database, as before: a signed-out visitor can't execute `reserve()`, a signed-in Moto Mangos customer is answered `not_allowed`, and so is a member of the shop naming an online channel.
3. **Docs from the re-check of PR 37:** the "review is not on PR 37" line is gone; root `CLAUDE.md` has the sentence on the unit delete and the downtime block.

**Where this differs from the plan or the brief, or decides what they left open** (say if any should change)

1. **A new refusal, `not_listed`**, in `reserve()` and in `offer()`: a Moto Mangos booking of a vehicle whose listing is off or missing, in any mode. The plan's step 5 reads "on a listed product" and names no answer for one that is not.
2. **The listing's row is taken `for no key update`, not `for share`** (plan §4), and all the products' rows come before any listing's row. Reason above.
3. **`reserve()` checks the cap for mode `instant` only, and it must fit the Instant units too.** A booking the listing would take only by request is refused there (`cap_reached`): request mode is 3M's. `offer()` does answer `request` as the mode; `bookOnline()` then answers **`request_only`** and does not call `reserve()`.
4. **`bookable()`'s fourth argument is `{channel, mode}`**, not the channel alone: "Ride today" is a mode of the Moto Mangos channel. **`offer()` takes `quote()`'s input** for the same lines as its pricing argument and throws if the two differ.
5. **The cut-off binds "Ride today" only** (contract §4.5): the location must be open now, and now must be no later than the cut-off before that day's closing. It is real minutes before the closing instant, so it is right through a night when the clocks change. A booking-page pickup later today is bound by the notice, not the cut-off.
6. **Which minimum days:** the walk-in minimum for "Ride today" and for the counter (`walk_in`); the advance minimum for the phone and every online advance booking.
7. **Staff are answered by `bookable()` but not bound by it.** Hours, closures and minimum days are checked for a staff channel (so Phase 3's screen can say why); notice is not. Nothing enforces it: staff call `reserve()` as themselves.
8. **The `api` channel is treated as the shop's own page** (the shop's notice only).
9. **An online advance booking can't start in the past**, with no notice set at all: it answers `too_soon`.
10. **A location that has saved no opening hours has no hours rule, for staff; online it can't be booked at all** (changed after the review, below); one that has saved some is closed on a weekday it left out. Two of the three demo shops have no hours.
11. **When several rules refuse, the answer is the first of: hours and closures, minimum days, notice.**
12. **`save_booking_rules()` writes a vehicle's minimum days as well as the shop's and the locations' rules** (the plan's §6 table), answers `not_a_vehicle` for gear or a service, and is not the service role's.
13. **The shop's default buffers apply side by side:** a vehicle with its own "before" and no "after" gets the shop's "after". Vehicles only.
14. **`bookOnline()` books one place per booking**, modes `instant` and `now`, and takes its database client and its clock as optional arguments so it can be tested. Under Vitest the `server-only` marker package is aliased to an empty file (`tests/server-only-stub.ts`).
15. **The static test reads `app/`, `components/` and `lib/` and the root files of both apps.** `scripts/` and tests are left out: the seed is run by hand with the service role, and stage 11's demo reservations will come from it.
16. **Extras are priced as lines of their own in `offer()`** until stage 4 builds the included quantity. "Ride today" does not read or lower the listing's ready count (3M).
17. **The best-fit pick is still written twice** (`reserve()`, `assign_units()`): the brief asked for minimal diffs, so stage 2's suggestion to fold them was not taken.
18. **`docs/platform/MAPPING.md` is not changed** (the plan's §12 lists it; the columns are built as it names them).

**Tests**

- **Unit: 357 in `@mango/core`** (290 before), **363 on the platform** (347 before), **202 on the marketplace** (unchanged). Typecheck and lint pass for every workspace, the one-pricer (money) rule included.
  - `booking-rules.test.ts` (44): every `bookable()` reason, with each place it can come from (pickup, return, now, the cut-off, a closure, a weekday left out); each channel's notice rule (Moto Mangos advance takes the stricter of shop and listing, both ways round; "Ride today" none; the booking page and the API the shop's; staff none); which minimum days apply to which channel; `offer()` in order (rules, stock, price), the cap and mode, "Ride today" past a full cap, gear with a scooter, and a product with no price answering `cant_be_priced` with no price in the answer, beside a free product that is priced at nothing.
  - **New York across both clock changes of 2026** (8 March, 1 November), every instant written in UTC so the test does not lean on the code under test: the same UTC time inside the hours one day and outside the next; the skipped hour and the hour that happens twice; a closed date that is 23 and 25 hours long; the cut-off at 16:00 on the shop's clock on both days, and as real minutes through the night of each change; 10:00 to 10:00 as one rental day over 23 and over 25 hours; 24 hours of notice not met by the same clock time after a 23-hour day. **And in Bangkok:** the Bangkok weekday against the UTC one, Songkran every year by the Bangkok date, the cut-off from each day's own closing time, both minimums.
  - `wrappers.test.ts` (10): each old name beside the code as it stood before (kept in the test as the reference), over some 8,900 instants from 2019 to 2035, every day of eight years at four times, and 40 amounts either side of zero with the ones that must throw: **the same answer every time, to the minute and to the baht.** `zoned-calendar.test.ts` (10): the generic functions in New York on both change days and in other zones.
  - `lib/book-online.test.ts` (15): the spy tests and the static test of item 2 above; `55P03`.
- **Database: 550 on the platform, all passing on a freshly reset local database** (509 before). New: `booking-rules.test.ts` (39) and 2 in `default-grants.test.ts`. Three stage 1 and 2 scenes were changed because they booked an unlisted vehicle through the Moto Mangos channel, which is now refused on purpose: the "online against online" race uses `api` for its second channel, one cross-shop scene lists its vehicle, and "who may book" expects `not_listed` there.
  - `save_booking_rules()`: every one of the five roles; another shop's five roles, a stranger, a signed-out visitor and the server; another shop's location or vehicle answered exactly like a made-up id, and left unchanged; 27 things it refuses; all or nothing; the audit rows; overbooking switched on through it and then used.
  - `booking_inputs()`: the whole answer pinned; every role, the server, and who is refused; cross-shop answers beside made-up ids.
  - The shop's default buffers in `reserve()` and in the read, side by side with a product's own; a later change moves no block.
  - The cap: not listed, off, full, by quantity, across two lines, with a hold and after it runs out, after a cancel, across two places, with gear, and never for "Ride today" or the shop's own channels.
  - `bookOnline()` against the database: each refusal leaves reservations, blocks and audit rows unchanged; the New York shop's own clock decides on the day the clocks go forward (2032); the real `55P03`.
- **Races: 120 rounds in this stage** (10 a shop in Bangkok THB, New York USD and Saigon VND, four races): two online bookings for the cap's last place at one place; the same at two places, where the bookings share no product lock; six at once for a cap of two; and a booking against the owner switching the listing off and a manager saving the scooter's rules. **Every round gave exactly the successes the cap allows.** With stage 1's 603 and stage 2's 270: **993 rounds.** **No deadlock:** no call answered `40P01` or `try_again`, and Postgres' own count of detected deadlocks did not move in any of the three files.
- **The lock was checked both ways.** With the listing's row taken `for share` instead (put into the local database by hand, then restored), the held-in-place test and the two-place race both fail: both bookings succeed and the cap is passed in round 0.
- **The migration on a seeded copy of `main`'s database** (reset to 62 migrations, the three demo shops seeded, then this one): 3 shops, 4 locations, 16 products, 170 units and 263 audit rows before and after, with the same checksums over products, units, locations and tenants (the new columns left out); no block, reservation, pricing row or listing either side. Every shop reads overbooking off, 15 minutes and no default buffer; no location has a rule.
- **Browser:** the full suite on that database, 375 px and 1280 px, two workers: 142 tests, **135 passed, 7 skipped, 0 failed**, the same as stage 2. No new browser test: nothing on a screen changed.

**After the review of PR 38 (16 Nov 2026).** Six items, all in this PR; the migration had not left this machine or CI's throwaway databases, so it was edited in place.

1. **"Ride today" is Moto Mangos' alone, and only for a pickup that is now.** It skips the notice and the cap, and nothing stopped any channel, or a pickup next week, from calling itself that.
   - `bookable()` throws for a channel and mode that don't go together (`assertHow()`): mode `now` on any channel but `marketplace`, a staff channel in an online mode, an online channel in mode `staff`.
   - A "Ride today" pickup must be within **15 minutes either side of now** (`RIDE_TODAY_GRACE_MINUTES`: time to fill in the form and for the request to arrive; contract §4.5, "from now"). Anything else answers a new reason, **`not_now`**, with the earliest and latest pickup.
   - `bookOnline()` refuses mode `now` on `booking_page` and `api` before it reads anything; `reserve()` raises `invalid_request` for it.
   - **Five probes, each answered `ok` before:** the booking page as "Ride today" to skip its notice; the API and the staff channels the same; Moto Mangos "Ride today" for next week (it skipped a 72-hour lead time); for later today, and for a pickup long begun, with the 15 minutes checked to the minute; and through `offer()` with the cap full (a real walk-in is offered, one for next week is not, and as an advance booking it meets the cap). The same on the database through `bookOnline()`, with nothing written by any refusal.
2. **`reserve()` has its own lock timeout, 6 seconds**, set on the function, shorter than the API's 8-second statement timeout, so a wait that runs out raises `55P03` and not `57014`. `bookOnline()` answers **`try_again` for `57014` from `reserve()` too** (several shorter waits can still add up to the 8 seconds); from one of its reads `57014` is an error, not an answer. **Tested through the API, not psql:** another session holds the product's lock for 9 seconds; a plain `reserve()` call and `bookOnline()`, both as the server through the API, come back after 6 seconds and before 8, the first with `55P03`, the second with `try_again`; nothing is written, and the booking goes through when sent again.
3. **`confirm_hold()` for a Moto Mangos hold takes the listing's row** (the products' rows first, then the listings', as `reserve()` does) **and judges the expiry once it holds it**, by the clock. Before, a confirm begun just before the expiry could still be in flight when a booking begun just after no longer counted the hold: both kept their place and the cap was passed by one. That needs the booking to be for another place of the same shop; at the same place the product lock already made them take turns. Tests: a confirm that began in time and reaches the row after the expiry answers `hold_expired` (a booking-page hold is still judged by when the call began); a confirm in flight at the expiry, with a new booking at a second place seen waiting for a row and then answered `cap_reached`; and the booking first. **With the lock taken out again both of the first two fail.** Every other hold is judged as stage 2 decided.
4. **The static test walks `packages/` too** (the service role's client is made in `packages/db`): a shared package that calls `reserve()` is a finding, by any client.
5. **A location with no opening hours saved can't be booked online**: `bookable()` answers `outside_hours` (its detail says `no_hours`) on every online channel, before any other rule. Staff are unaffected: for them no hours saved is still no hours rule. Tested in `@mango/core` and on the database (Saigon's shop, which has none: refused on all three online channels with nothing written, booked at the counter, and booked online once hours are saved). **Two of the three demo shops have no hours, so nothing can be booked online at them until they do.**
6. **Docs:** the currency-exponent note on the inventory below; this section's line on the timing-sensitive test (known issues); root `CLAUDE.md` and the runbook say production now publishes from the `release` branch.

This replaces items 5 and 10 of the list above where they differ, and adds a reason (`not_now`) to item 1's.

**Tests after the review, on a freshly reset database**

- **Unit: 363 in `@mango/core`** (357 before the review), **364 on the platform** (363), **202 on the marketplace**. Typecheck and lint pass for every workspace, the money rule included.
- **Database: 556 of 556** (550 before the review): `booking-rules.test.ts` is 45 tests (39).
- **Races: 150 rounds in this stage** (120 before the review; the fifth race is a hold confirmed at its expiry instant against a new booking at a second place, 10 rounds a shop), **1,023 with stages 1 and 2**. No call answered `40P01` or `try_again`, and Postgres' own count of detected deadlocks did not move.
- **Browser:** the full suite, 375 px and 1280 px, two workers: 142 tests, **135 passed, 7 skipped, 0 failed**.
- Each suite was run on its own, one after the other.

**Known issues and follow-ups**

- **The lock-timeout test is timing-sensitive under load.** It expects `reserve()` to give up between 5.5 and 8 seconds after it was sent, while another session holds a lock for 9. On a machine busy with other work (typecheck, lint or the browser suite at the same time) the API call can start late or the statement timeout can win, and the test fails without anything being wrong. Run the database suite on its own; if it fails alone, that is a finding.
- **The race for a hold confirmed at its expiry instant does not prove the fix by itself.** It depends on timing (it passes with and without the listing's row in `confirm_hold()`); the held-in-place tests are the proof.
- **`bookOnline()` needs the service-role key where it runs.** The runbook says that key is never on Netlify, because the app did not use it. Nothing calls `bookOnline()` yet; when Phase 8 or 3M gives it a caller, the key goes to the server environment (never the browser) and the runbook's table changes.
- **A location's rules and a vehicle's minimum days can also be written directly** by an owner or a manager, as every other column of those two tables can (their policies); the ranges are held by the tables. The shop's four settings can't: `save_booking_rules()` only.
- **Nothing on a screen saves a rule or calls `bookOnline()` yet.** Settings › Booking rules is stage 11; the booking page is Phase 8; `marketplace_api` is 3M.
- **`offer()` reads without a lock.** Stock and the cap can change between its read and `reserve()`, which has the last word: the caller then gets `unavailable` or `cap_reached` from `reserve()` instead.
- **Request mode** still needs its own state and migration before Moto Mangos books through the platform (carried to 3M from PR 36).
- A race test shows a race is closed for the timings it hit.

**Before this goes to staging** (the owner's word each time, plan Q17): nothing to count first. The migration adds nullable columns with no default and re-creates two functions; migrations `20261116000100` and `20261116000200` must be there in their merged form. Afterwards: every location and product reads empty rules, every shop reads empty default buffers, and counts of products, units, blocks and audit rows are unchanged.

**On staging since 16 Nov 2026; not on live.** The migration (`20261116000300_platform_booking_rules`) was pushed to staging (`mango-works-staging`, `qafhmdxsodeqkeznafaq`) at 15:15 UTC, from `main` at `9749bf4`, with `npx supabase db push --db-url` (never `--linked`). Staging records 63 of 63. Live was not touched.

- **Read-only checks first**, in one read-only transaction; all four passed:
  1. 62 migrations on record, newest `20261116000200`; `20261116000300` absent, and none that sorts after it.
  2. The migration re-creates four functions that existed, not two. Each had `main`'s body as of `65cc20f` (just before PR 38 merged), by MD5 of the stored source against the body in `20261116000200`, the last migration that wrote each: `reserve` `3a3a1865…`, `confirm_hold` `be90036c…`, `availability` `c62fd4ec…`, `booking_roles` `6a2a6bd5…`. The three new functions (`save_booking_rules`, `booking_inputs`, `json_int_between`) did not exist.
  3. None of the eight rule columns existed (four on `locations`, two on `products`, two on `tenants`), nor the check `products_min_days_vehicle_check`.
  4. Counts taken of every `platform` table (below).
- **The dry run** listed exactly this one migration. The push applied it in about eight seconds.
- **After, read-only:**
  - 63 migrations on record, newest `20261116000300`.
  - Every rule column is empty: 4 locations, 32 products and 3 shops, no value in any of the eight.
  - All three shops (`big-fleet`, `bsr`, `saigon-scooters`) read overbooking off, a hold of 15 minutes and no default buffers.
  - `save_booking_rules()` can be executed by `authenticated` only: not by the service role, `anon` or PUBLIC.
  - The four re-created functions now have this migration's bodies, by MD5 against `main`: `reserve` `d38413ff…`, `confirm_hold` `744aefe0…`, `availability` `ce99cff2…`, `booking_roles` `51a20ff2…`.
  - Both cron jobs are still active: `platform-renewal-notifications` (`7 * * * *`) and `platform-release-expired-holds` (`* * * * *`). The second ran at 15:15 and 15:16 UTC, either side of the push, and succeeded both times.
- **Counts, the same before and after:** 32 products, 205 units, 21 blocks, 0 reservations, 3,415 audit rows, 13 pricing rows (5 price lists with 150 days, 1 settings row), 3 shops, 4 locations; every other `platform` table the same too. The same checksums before and after over products, locations and shops with the new columns left out, and over units, blocks, pricing rows, price lists and their days, and the settings row.
- **Two of the three demo shops have no opening hours on staging, so they can't be booked online until hours are saved.** `big-fleet` (2 locations) and `saigon-scooters` (1 location) have no row in `location_hours`; `bsr` has all seven days. A location with no hours saved answers `outside_hours` on every online channel (decision 10 above); staff bookings are unaffected.
- **Not run against staging:** the browser suite. CI ran all of it on a clean local database.

**Local set-up.** This worktree has its own stack, `Bike_Booking_phase2_s3` on ports 6332x; `supabase/config.toml`'s change is local only (`git update-index --skip-worktree`), and `apps/platform/.env.local` names the same stack. Stage 2's stack was stopped (not removed).

**Next:** stage 4, the pricer's included quantity and the quote snapshot (`@mango/core` only, no migration).

## Phase 2, stage 4: the pricer's included quantity and the quote snapshot (branch `platform/phase-2-stage-4-pricer-snapshot`, 16 Nov 2026)

The fourth build stage of Phase 2, of eleven (`docs/phase-2-plan.md` §5.1, §5.2 (step 4's pricing only), §5.4, §8; the owner's answers in §10, Q9). **`@mango/core` only: no migration, no database change, nothing on a screen.** `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **`quote()` step 4, the included quantity** (`packages/core/src/quote.ts`). A line for gear or a service taken with a vehicle names that vehicle's line and how many units come free with each one (`extraOf: { lineId, includedQuantity }`):
  - allowance = included per vehicle × the vehicle line's quantity; charged = max(0, quantity − allowance); list price = unit price × charged quantity.
  - The plan's examples are tests: a scooter with 2 helmets included, 3 taken at ฿50 a day for 7 days: 1 charged, ฿350; two scooters and 5 helmets: 4 included, 1 charged.
  - Quoted lines gain `parentLineId`, `includedQuantity` and `chargedQuantity`. A line with no parent reads 0 included and every unit charged, and is priced exactly as before.
  - Included units are not a discount: they are in no discount total. From the list price on, an extra is a line like any other: seasons on its charged units, discounts, its own tax rate, no deposit.
- **`lineTaxShares()`**: each line's share of its rate group's VAT, in proportion to what the line comes to, leftover minor units to the largest remainders, so the shares add up to the invoice's VAT lines exactly (Q9). VAT is still worked out once per invoice and rate; the invoice's figure is the one of record. Three lines of ฿350: VAT ฿68.69, shared 22.90, 22.90, 22.89 (line by line it would have been ฿68.70).
- **`lineDeposits()`**: each vehicle line's own deposit in the per-vehicle mode; `depositAmount()` is now their sum, the same figure as before.
- **`packages/core/src/quote-snapshot.ts`** (new; exported as `@mango/core/quote-snapshot`):
  - **`snapshotQuote(input, context)`** prices the invoice itself (it calls `quote()` on the input: review of PR 40, below) and turns it into plain JSON: keys in snake_case, every amount a string of digits in minor units (a season amount may lead with "-"; nothing else is signed), every instant an ISO string in UTC, and `version` 1. `context` adds what the pricer never needed: the currency and its exponent, `pricedAt`, each line's product name and type, the tax profile's id and name, each season's name, each coupon's id and code. A name that is missing is an error, not an empty field. An invoice with a line that can't be priced, or a line with charge rules, is refused.
  - **`readSnapshot(stored)`** reads it back with amounts as `bigint` and instants as `Date`. It takes the stored data and nothing else, so it can't look up a profile, a price list, a season or a coupon. It is strict about the shape and about each value on its own: a missing field, an unknown field, an amount that is a number, has a decimal point or a leading zero, a quantity under 1, an exponent outside 0 to 4, a tax rate outside 0 to 10000, or a currency that is not three capitals throws `SnapshotError`. It does not check that the lines add up: that is Phase 3's save check.
  - **`readSnapshotLine(stored)`** reads one stored line on its own, as an order line's `snapshot jsonb` keeps it. Each stored line carries the `version`, so it is upgraded and read without its invoice.
  - **Every field of §5.4, and three more** (review of PR 40). On each line: the version; currency and exponent; product id, name and type; start, end, the original pickup for a continuation, the time zone, the charged periods and their unit; quantity, included and charged; **the allowance per vehicle** (`included_per_vehicle`: what `extraOf.includedQuantity` was, empty for a line with no parent); the unit price with the pricer's basis; the list price; **the way of pricing as it was passed in** (the list's 30 totals, the hourly price, the long-stay rate, or the flat fee); each season (rule id, name, percentage, periods inside and in all, amount); the season total and price; each discount (id, source, the coupon's id and code, percentage or fixed and its value, what it took from this line); the discount total; the amount; taxable, rate, profile id and name, the shop's style; the tax share; the line's deposit. On the invoice: the totals; one entry per rate (rate, profile names, base, net, VAT, gross, style); the non-taxable part; credits; **every discount the invoice was priced with** (`discounts`: id, source, the coupon's id and code, percentage or fixed and its value, all lines or the lines it was aimed at, and what it took in total, a coupon that took 0 included); the deposit with its mode, its number and whether it came from the order, the customer or the shop; `priced_at`; `version`.
  - **It prices nothing itself.** It calls `quote()`, copies what went in and what came out, and takes the tax share and the line deposit from `quote.ts`. Its only sums are additions and one subtraction (a line's season total; what a discount took over its lines).
  - **Versions.** `UPGRADES[n]` turns a stored version n into n + 1 as it is read, in two parts: one for the invoice and one for a line, so a line stored alone takes the line part. A stored snapshot is never rewritten. A version newer than the code knows is refused, not guessed at, and so is an invoice whose lines don't carry its version.
- **`offer()` needed no change**: it passes `quote()`'s input through, so an extra with included units is priced that way (one new test). Stage 3's item 16 ("extras are priced as lines of their own until stage 4") is done for the pricer; stage 5's adapter fills `extraOf` from `product_extras`.
- Root `CLAUDE.md`: a new section, "Not tied to Supabase" (below). `packages/core/README.md` names the new module.

**Phase 3's columns, confirmed** (plan §5.4, "fixed now"). No column added or dropped. Each order-line column is a field of the stored line under the same name, and a test holds that:

| On each order line | From the snapshot line | Notes |
| --- | --- | --- |
| `list_price` | `list_price` | Unit price × charged quantity |
| `season_total` | `season_total` | Signed: negative when seasons lower the price |
| `discount_total` | `discount_total` | |
| `amount` | `amount` | |
| `tax_rate_bp` | `tax_rate_bp` | Empty for a line that is not taxable |
| `tax_profile_id`, `tax_profile_name` | the same | Empty for a line that is not taxable. Reference only |
| `tax_inclusive` | `tax_inclusive` | |
| `tax_amount` | `tax_amount` | The share; 0, not empty, for a line that is not taxable |
| `deposit` | `deposit` | Empty unless the mode is per vehicle and the line is a vehicle |
| `currency` | `currency` | The line also has `exponent` |
| `snapshot jsonb` | the whole stored line | With its `version`; read with `readSnapshotLine()` |

On each invoice: its totals, its rate groups and `snapshot jsonb` (the whole stored snapshot). **Phase 3's save check needs addition and comparison only**, and a test runs it on every pinned invoice: list price + season total = season price; season price − discount total = amount; a line's discounts add up to its discount total; each discount's amounts over the lines add up to its total on the invoice, and those totals to the invoice's discount; included + charged = quantity; the lines add up to each total; each rate group's base is its lines less its credits; net + VAT = gross; the groups' gross + the non-taxable part = the total; the lines' tax shares add up to each VAT line; the lines' deposits add up to the invoice's in the per-vehicle mode.

**Also in this stage**

1. **Four standing rules in the root `CLAUDE.md`** ("Not tied to Supabase": the owner plans to move from Supabase to Neon after Phase 3): all database access goes through `packages/db`; file storage sits behind one module; sign-in goes through one helper with no Supabase-only features; RLS uses the `my_tenant_ids()`-style helpers and not `auth.uid()` directly. What does not follow them yet is listed at the end of this section.
2. **The line saying the review is not on PR 38 is gone** from stage 3's section.
3. **The "other way round" `confirm_hold()` test is strengthened** (`apps/platform/tests/db/booking-rules.test.ts`). As it was, the confirm began after the expiry and the booking was at the same place, so it passed with or without the listing's row in `confirm_hold()` (checked: it passes with the lock taken out). Now:
   - the confirm's transaction begins **before** the expiry (the session prints that its `now()` is earlier) and gets to its work five seconds on;
   - a new Moto Mangos booking at a **second place** of the shop, begun after the expiry, takes the cap's one place and is left unsaved. It shares no product lock with the confirm, and it does not release the hold (another place's), so only the listing's row stands between them;
   - the confirm is **seen in `pg_locks` waiting at the listing's row** (it has that row's tuple lock and waits for a transaction), and `pg_blocking_pids` names the booking's session as the one it waits for;
   - the booking saves; the confirm answers `hold_expired`, judged by the clock after the expiry; one reservation is `reserved` (the new one), the hold is still a run-out hold, and Postgres counts no deadlock.
   - **With the fix removed it fails.** `confirm_hold()` was put into the local database without the listing block (the products' and listings' rows and `clock_timestamp()`), by hand, then restored from the migration's text. The test failed on three counts: the confirm answered without ever waiting at the listing's row; it was not waiting for the booking; and it answered `ok`, so the cap of one was passed by one. Restored, it passed five times in a row.
4. **Carried to stage 5** is below.

**Where this differs from the plan or the brief, or decides what they left open** (say if any should change)

1. **`includedQuantity` on a quoted line is how many of that line's units are free, never more than its quantity.** Two scooters with 2 helmets each and 3 helmets taken reads "3 included, 0 charged", not the plan's formula taken literally ("4 included"). So included + charged = quantity on every line, which Phase 3's save check can add up. The allowance is stored beside it, per vehicle (`included_per_vehicle`: 2), with the parent line's id, so adding a helmet later needs no look at `product_extras` as it is by then.
2. **The pricer does not default an extra's dates to its vehicle's.** A line's dates stay required; stage 5's adapter gives an extra its vehicle's dates. An extra with its own dates (helmets for 3 of the 7 days) is priced on them.
3. **What step 4 refuses** (`bad_input`): a parent that is not on the invoice, is the line itself, is not a vehicle, or is itself an extra; a vehicle as an extra; an included quantity that is negative or not whole; and **two lines of the same product naming the same parent**, which would each take the free units. These are checked before "can't be priced" is answered, so a wrong parent is `bad_input` even when another line has no price yet.
4. **A season on a line whose units are all included** still lists the rule, with an amount of 0.
5. **An older version still reads, tested two ways, because only version 1 exists.** A version 1 snapshot is written out by hand in the test: it reads to the satang, and it is exactly what the code writes today for that invoice, so the stored shape can't change without that test failing and a version being added. And the upgrade chain is run with made-up steps for a version 2 and a version 3 (a field added, then renamed): a version 1 snapshot comes out as version 3, a version 2 takes only the second step, and a gap in the chain is an error. The first real step is written with version 2.
6. **An early return has no invoice of its own**, so its pinned figures (฿1,500 of ฿3,000; ฿1,250 of ฿2,500) are tested the way Phase 3 will work them out: the period is rebuilt from **the stored snapshot of the period the return falls in**, and `earlyReturn()` is run on that. For a rental that was never extended or swapped that is the first booking's invoice; after an extension or a swap it is the continuation's invoice, whose line carries the rental's original pickup. (See "For Phase 3" below: what an early return leaves to be stored.) The swap and the cheaper bike are tested the same way, and the swap's own invoice is snapshotted too. One more test changes the shop's list after the snapshot: the shares still come from the list as it was.
7. **The stored keys are snake_case** (`list_price`, `tax_rate_bp`), as the plan's column list and the database's own rows are; what `readSnapshot()` returns is camelCase like the rest of `@mango/core`.
8. **A rate group stores `profile_names`**, a list: two profiles at one rate share a VAT line.
9. **Charge rules are not in the snapshot.** `RentalSpan.rules` is an empty type today (charge rules come after Phase 3). When they are built the line gains them and the version goes to 2. Until then `snapshotQuote()` refuses a line whose rules have any key, so they can't be dropped without anyone noticing.
10. **Nothing calls `snapshotQuote()` yet.** Phase 3 stores it. `offer()` and `bookOnline()` are unchanged.
11. **The older test files are not changed** (`quote.test.ts`, `rental-period.test.ts`): they are the proof that a line with no parent is priced as before. Their invoices are restated in `quote-pinned.fixtures.ts` so the snapshot is tested on the same ones.
12. **`snapshotQuote(input, context)` calls `quote()` itself** (the owner, 17 Nov 2026), where the plan had `snapshotQuote(input, quote, context)`; §5.4 of the plan now has the two-argument form. Given a quote from outside it could only check the line ids: a quote of three bikes beside an input of one was stored with the one's prices. Now the two can't disagree.
13. **The invoice has a `discounts` list of its own**, which §5.4 did not name (it does now, with the line's `version` and `included_per_vehicle`). A line lists only the discounts that took something from it, so a coupon's target lines, and a coupon that took 0, were nowhere.

**Tests**

- **Unit: 522 in `@mango/core`** (363 before; 480 before the review of PR 40, 506 after the first), **364 on the platform** and **202 on the marketplace** (both unchanged). Typecheck and lint pass for every workspace, the one-pricer (money) rule included.
  - `quote-extras.test.ts` (42): included quantity with one vehicle and with several; more included than taken; an extra priced each way (a flat fee per hour, day, week and month, by rental length, a fixed price); a free service; an extra with no price yet answering "can't be priced" even when all of it is included; in a currency with no decimals; included units in no discount total and no VAT base; seasons, a percentage and a fixed discount on the charged units; its own tax rate; no deposit; every refusal; and **every D2 and D3 pinned figure unchanged for lines with no parent** (31 invoices from D2, 8 from D3).
  - `quote-snapshot.test.ts` (116): **every pinned figure snapshotted, turned to JSON text, parsed, read back and compared to the satang** (43 invoices: D2's 31, D3's 8, and four of Phase 2's own: a scooter with helmets included and a free drop-off, a dong shop with a season and a fixed coupon, a dong shop with VAT on top, a New York shop across the night the clocks go forward). Every amount of the quote is compared with the same amount read back, not only the pinned ones.
  - **Tax shares add up to the VAT lines in every one of the 43**, and in 1,500 made-up invoices (a fixed sequence) in two-decimal and zero-decimal amounts, both tax styles, six rates, with percentage and fixed discounts and credits; more than 250 of them needed the leftover rule. In dong: ₫10,001 over three lines is 3,334, 3,333 and 3,334.
  - **A snapshot read back after the profile is renamed, re-rated and archived, the list repriced, the season deleted and the coupon archived is unchanged**: the changes are made in place in the very objects the snapshot was made from, the same booking priced again comes to ฿2,800 where it was ฿1,152, and the stored snapshot reads exactly as before.
  - The stored form (every amount a string of digits; the only numbers are counts, basis points, the exponent and the version); every field of §5.4 on a line, pinned whole; Phase 3's columns and its check by addition; versions; and what reading and writing refuse.
  - One more in `booking-rules.test.ts`: `offer()` with an extra's included units.
  - **The new tests fail when the code is wrong** (tried, then put back): with step 3 on the whole quantity, 25 tests fail; with the tax share rounded line by line, 5 fail.
- **Database: 556 of 556 on the platform, on a freshly reset local database** (the same count as stage 3: one test rewritten, none added).
- **Browser:** the full suite on a freshly reset and seeded database, 375 px and 1280 px, two workers: 142 tests, **135 passed, 7 skipped, 0 failed**, the same as stage 3. No new browser test: nothing on a screen changed.
- Each suite was run on its own, one after the other.

**After the review of PR 40 (17 Nov 2026).** The review is a comment on the PR. Its verdict: the pricer, step 4 and the tax shares are right; the snapshot lacked four things Phase 3 needs. Seven items and one decision of the owner's, all in this PR. Nothing is stored yet, so the shape changed in place and the version is still 1.

1. **Each stored line carries the `version`**, and `readSnapshotLine()` / `upgradeSnapshotLine()` read and upgrade a line stored alone. An upgrade step has an invoice part and a line part. Tests: every line of every pinned invoice reads alone exactly as it reads in its invoice; a line goes from version 1 to 3 by made-up line steps with no invoice; an invoice whose lines don't carry its version is refused.
2. **The allowance per vehicle is stored** on an extra's line (`included_per_vehicle`), empty for a line with no parent.
3. **`snapshotQuote()` refuses a line whose `span.rules` has any key.**
4. **The invoice lists every discount** it was priced with: id, source, the coupon's id and code, kind, value, all lines or the lines aimed at, and the total taken. A coupon that took 0 is there. A coupon's id and code are now needed for every coupon passed in, not only one that took something from a line.
5. **Step 4's checks run before "can't be priced"**, and the comment says so.
6. **The reader is tighter**: no leading zeros (and no "-0"), quantity ≥ 1, counts ≥ 0, exponent 0 to 4, rate 0 to 10000, currency three capitals, each refusal tested. Writing refuses the same values.
7. This section's item 6, the stage 5 carry and "For Phase 3" below.
8. **The owner's decision on the input and the quote not matching:** `snapshotQuote()` takes the input and the context and calls `quote()` itself.

**After the second review of PR 40 (17 Nov 2026).** All eight items of the first were closed; a second reader found four more, all in this PR.

1. **An upgrade step that drops or renames `lines` is an error.** It fell back to an empty list, so the invoice read as a valid one with no lines. A step must leave a list of line objects.
2. **`quote()` refuses a discount that names a line more than once** (`bad_input`). 10% on `["bike", "bike"]` took 20%, and a fixed amount named twice could take more than the line came to. It was so since stage D2; nothing built a list with a repeat. Checked before "can't be priced" is answered. The test is in `quote-extras.test.ts`, so `quote.test.ts` is still as D2 left it.
3. **The guard against two discounts sharing an id is tested.** `quote()` accepts them (each line lists the id twice); the snapshot names a discount by its id, so `snapshotQuote()` refuses.
4. **Each write-side refusal has one guard and one test that names its message**: a line the context says nothing about, a product type that disagrees with the priced line, a taxed line with no profile, a season or a coupon with no name to keep, the currency, the exponent, `pricedAt`, two discounts with one id, charge rules, an invoice that can't be priced. The currency and the exponent were checked twice (once in `buildSnapshot`, once as they are written), so taking either check out failed nothing: they are checked once now, as they are written, by the reader's own rules.
5. Also: **a season's name is looked up as the context's own key**, as a line's and a coupon's already were (a rule whose id is `constructor` got the name "Object").
6. **Each fix broken once, then put back:** 18 breaks, one guard at a time, and each failed at least one test.

**For Phase 3** (from the two reviews; none of it is built here)

- **Lines are never re-sorted, and their tax shares never recomputed, after storing.** Where two lines' remainders tie, the spare minor unit goes to the earlier line, so the same lines in another order give different shares (weights 5, 3, 5 and 3, 5, 5). The stored share is the one of record for that line; the order of the stored lines is the invoice's order.
- **A refund's credit note needs VAT figures of its own.** `earlyReturn()` and `settleSwap()` answer how much is left over, and nothing in `@mango/core` works out or stores the VAT in a refund. On a shop that adds tax on top, a line's `amount` is net, so the figure they give leaves out the VAT the customer paid: the refund must include it. That is pricer work (a rate group's VAT on the refunded amount, rounded once) and a stored document, so "no pricer change in Phase 3" does not hold for a refund. A credit kept, or "no charge", needs neither.
- **An early return's outcome is stored when it happens, never recomputed**: the return time, the period's list price, the used and unused parts, the money carried, the shop's choice and what became of it. Working it out again later would run `unitPrice()` on the stored prices with whatever the code is by then (charge rules, for one).
- **A vehicle line of more than one unit** holds several bikes in one amount, one tax share and one deposit. A swap or an early return of one of them, and a per-bike report, need that line's figures per unit, which is a division. Phase 3 decides: one line per unit, or a split made in `@mango/core`.

- **What `readSnapshot()` still does not check belongs in Phase 3's save check**, beside the adding-up. It checks the shape and each of the values listed above on its own, and no more:
  - **Unbounded numbers:** a discount's `percent_bp` (on a line and on the invoice) and the deposit's; the counts inside the unit price's basis (`hours`, `days`, `months`, `leftover_days`, `count`); a season's `adjust_bp`.
  - **Nothing across fields:** a line's currency and exponent matching the invoice's; a parent line that is on the invoice (and `included_per_vehicle` set exactly when there is one); `end` after `start`. The same goes for a percentage discount with no percentage, a taxable line with no rate, and two lines, discounts or rate groups with one id.
  - An amount has no length limit here; the column's type sets one.
- **A line's season amounts need not add up to its season total, so that sum must not be checked.** The season price is held at 0: two rules of −60% on ฿1,400 store −840 and −840 with a season total of −1,400 and a season price of 0. What does hold, and is checked, is list price + season total = season price.

**Carried to stage 5** (the owner's, 16 Nov 2026, and two found here)

- **`confirm_hold()`, `cancel_reservation()`, `assign_units()` and `move_unit()` get their own lock timeout, like `reserve()`'s 6 seconds**, so a lock wait that runs out answers `55P03` and not `57014`. **Staff callers of `reserve()` handle `55P03`** (today only `bookOnline()` does).
- Found here: **`pricing_inputs()` returns a product's tax profile name but not its id, and no product name.** The snapshot needs both. Stage 5 re-creates `pricing_inputs()` for extras; they can go in then, or Phase 3's caller reads them itself. **The id is the effective tax profile id: `coalesce(product's, shop default)`**, the same profile the name and the rate already come from (the join in `pricing_inputs()`), not the product's own column, which is empty for a product on the shop's default. Nothing else is missing: the product type, the profile's name, each season's name and the currency are there, and the exponent is `currencyExponent()` in `@mango/core`.
- Found here: stage 5's adapter (`lib/pricing-inputs.ts`) fills `extraOf` and gives an extra its vehicle's dates (item 2 above).

**What does not follow the four "Not tied to Supabase" rules yet** (found by searching, not a full audit; nothing here was changed)

- **Database access outside `packages/db`** (files that import `@supabase/*` themselves): both apps' `proxy.ts` and `app/auth/confirm/route.ts`; the marketplace's `lib/admin-queue.ts`, `lib/auth/sync-role.ts` and `lib/stations/merge.ts`; the platform's `scripts/seed.mts` and `scripts/load-bsr-pricing.mts`; both apps' `scripts/create-line-provider.mjs` (on `main` before this list; found by the lint rule's check, PR 45); and the test helpers (`tests/db/helpers.ts` in both apps, `e2e/shop-settings.ts`). **Since PR 45 ESLint refuses `@supabase/*` in `apps/`, type imports included**, except in these files (`supabaseAllowed` in each app's `eslint.config.mjs`).
- **File storage** is called directly in four marketplace files (`app/admin/actions.ts`, `app/vendor/actions/fleet.ts`, `app/vendor/actions/shop.ts`, `components/photo-picker.tsx`). The platform stores no file yet, so the one module does not exist: the first platform feature that stores a file creates it.
- **Sign-in** is called directly from each app's login form and its `auth/callback`, `auth/confirm` and `auth/signout` routes: there is no one helper yet.
- **RLS:** one platform policy calls `auth.uid()` directly (a member reading their own membership row, `20261110000100_platform_schema.sql`). The helpers themselves, the audit function and the "who did it" columns read `auth.uid()` too, and several tables have keys to `auth.users`: those are the places the move changes. The marketplace's own policies (the 27 older migrations) were not looked at.

**Known issues and follow-ups**

- The strengthened `confirm_hold()` test depends on timing in one place: the booking must hold the listing's row before the confirm's five seconds are up. It checks that itself and says so ("timing, run again") rather than report a false finding. It also waits to be clear of the minute's sweep, so it can take up to 20 seconds to start.
- `quote-pinned.fixtures.ts` restates the older tests' invoices; if a D2 or D3 figure is ever changed on purpose, both places change.
- A race test shows a race is closed for the timings it hit.

**Local set-up.** This worktree has its own stack, `Bike_Booking_phase2_s4` on ports 6432x, started with CI's service list (`supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta,supavisor`): with stage 3's stack and another project's still running, the full list timed out on the analytics container. `supabase/config.toml`'s change is local only (`git update-index --skip-worktree`), and `apps/platform/.env.local` names the same stack. Stage 3's stack was left running.

**Next:** stage 5, extras in the database (migration 4): `product_extras`, `save_product_extras()`, `pricing_inputs()` with extras, the adapter in `lib/pricing-inputs.ts`, and the carried list above. **Done: see stage 5, below.**

## Phase 2, stage 5: extras in the database (branch `platform/phase-2-stage-5-extras-db`, 17 Nov 2026)

The fifth build stage of Phase 2, of eleven (`docs/phase-2-plan.md` §5.2, §6, §8; the owner's answers in §10, Q16). **Database, the pricing adapter and the staff path to the booking functions: nothing on a screen changes** (the Extras tab and Settings › Extras are stage 6). **On staging since 17 Nov 2026** (64 of 64; see "On staging" below); **not on live.** `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **One new migration, `20261117000100_platform_product_extras`** (migration 4 of the plan). No earlier migration is touched.
  - **`platform.product_extras`**: a gear or service product offered with one vehicle product, or with every vehicle (`product_id` empty). `included_quantity` (0 to 1000, free with each vehicle), `max_quantity` (**the most per vehicle**; empty for no limit, else 1 to 1000 and never below the included quantity), `sort_position`. One row per (vehicle or "every vehicle", extra). The vehicle must be a vehicle and the extra gear or a service: both types are held by the composite keys to `products`, so neither can drift. It holds no amount. Every member reads; nobody signed in writes it directly; grants written on purpose (`service_role` too); `updated_at`. A deleted product takes its links with it.
  - **`platform.save_product_extras(p_tenant_id, p_product_id, p_extras)`**: owners and managers. Replaces a vehicle's whole list in one call, in the order given; `p_product_id` empty is the "every vehicle" list. Rows that stay keep their id; all of it or none of it; one `extras_change` audit event when the list changed, none when it did not. Not the server's (revoked from the service role).
  - **`platform_private.extras_roles()`**, mirrored by `apps/platform/lib/extras-permissions.ts`; a database test compares the two.
  - **`platform.pricing_inputs()` re-created** from its body in the database (`pg_get_functiondef`), grants restated (members and the server, as before). Three additions:
    - `extras`: for each vehicle asked about, what is offered with it. **A vehicle's own row wins over the "every vehicle" row for the same extra**; that rule is in this one place. A retired extra is not offered. Any member gets it, so a mechanic or a driver gets the extras and still no prices.
    - on each product: `product_name`, and `tax_profile_id`, **the profile in force** (`coalesce(the product's, the shop's default)`), from the same joined row the rate and the name already come from.
    - the extras' own pricing rows and seasons come back beside the ones asked for, so one call prices a vehicle with what goes with it.
  - **`confirm_hold()`, `cancel_reservation()`, `assign_units()` and `move_unit()` have a 6-second lock timeout**, as `reserve()` has had since stage 3. A wait for a lock that runs out raises `55P03`, before the API's 8-second statement timeout can answer `57014`.
- **`apps/platform/lib/pricing-inputs.ts`, the adapter**
  - A line may say it is an extra of a vehicle's line (`extraOf: "<line id>"`). It then **takes its vehicle's dates unless it has its own** (stage 4's item 2), its vehicle's original pickup on a later period, and its included quantity from the database's rows for that vehicle. A product that is not offered with that vehicle has nothing free. `quote()` does step 4 with it; the adapter still does no arithmetic.
  - `extrasOf()` and `includedWith()` read the rows; `snapshotContextFor()` builds `snapshotQuote()`'s context (names, the profile in force by id and name, each season's name, the currency and its exponent) from the same rows.
  - `bookOnline()` passes each extra line's parent, so helmets booked online with a scooter are priced with the scooter's allowance.
- **`apps/platform/lib/staff-booking.ts` (new): the staff paths.** `reserveAsStaff()`, `confirmHold()`, `cancelReservation()`, `assignUnits()` and `moveUnit()`: a signed-in member's call to each booking function. A lock that could not be had in time (`55P03`, or `57014` when shorter waits added up) is answered `{ ok: false, reason: "try_again" }`, the same answer the functions give for a broken deadlock; any other error is thrown. `lib/try-again.ts` holds the two codes, and `bookOnline()` uses it too. The vehicle's Details form now moves a booked unit through `moveUnit()`; the other four have no screen yet (Phase 3 calls them).
- **Root `CLAUDE.md`**: two lines under the lock order (saving a vehicle's extras; the 6-second lock timeout and who answers `try_again`). **`docs/phase-2-plan.md` §4**: the `save_product_extras` row says how it is built. Types regenerated.

**Lock order of `save_product_extras()`**: no advisory lock; rows only.

1. The vehicle product's row, `for no key update`. For the "every vehicle" list there is no vehicle, so the shop's row instead (`for no key update`, as `save_booking_rules()` takes it).
2. The extra products' rows, `for key share`, in id order.
3. The list's own rows, in extra-id order; then the deletes, updates and inserts, in the same order.

A booking takes product rows `for share` and never a `product_extras` row, so a booking and a save can only take turns at the vehicle's row. `move_unit()` takes product rows `for no key update`: the same.

**Where this differs from the plan or the brief, or decides what they left open** (say if any should change)

1. **The four booking functions are not re-created.** The lock timeout is a setting on the function (`alter function … set lock_timeout = '6s'`), so their bodies and grants are exactly as stage 3 left them. The brief read "re-created functions are minimal diffs"; this is smaller than one. Only `pricing_inputs()` is re-created.
2. **`save_product_extras()` locks the extra products' rows between the vehicle's row and the links** (the plan's §4: "the vehicle product's row, then its extra links"). Deleting a product locks its row and then, by the cascade, its links; a save that held a link and then needed the product's row (its foreign key) would cross it. Taken in this order the save only waits.
3. **The "every vehicle" list is saved under the shop's row**, which the plan did not say. Without something to hold, two saves of that list at once could each insert into an empty list and leave both.
4. **`pricing_inputs()` returns more rows than it is asked for**: the extras' own pricing and seasons. Asked about a scooter alone it returns the scooter, its helmets and its delivery. Nothing asked for is missing. **Corrected after the review of PR 43:** not every caller looked products up by id. The adapter and the Pricing tab did; the Moto Mangos tab read the first row, and the Pricing tab's seasons card listed every season returned (both fixed, below).
5. **`max_quantity` is stored and returned, and nothing enforces it yet.** The plan has it bind online channels only (Q16); the place is `bookOnline()`, which has no caller, and `reserve()` does not read `product_extras` at all (so a booking never locks one). **It is per vehicle, "up to N per bike" (the owner, 17 Nov 2026):** for a booking, the most is `max_quantity` × the number of vehicles the extra is offered with, exactly as the included quantity is counted (2 scooters and a most of 2: up to 4 helmets). The column comment, the adapter and the plan's §5.2 and §7 say so, and stage 6's screen label is **"Most per vehicle"** (the plan had "most per booking"). **Not enforced in this stage, on the owner's word**, because it is not a one-line check: it needs each extra line matched to its vehicle's row in `bookOnline()`, a refusal reason of its own, and tests. **To do with the online channels, in stage 6 or stage 11:** `bookOnline()` refuses an extra line whose quantity is above `max_quantity` × its vehicle line's quantity; staff paths are never bound.
6. **A product that is not offered with a vehicle can still be priced as that vehicle's extra**, with nothing free: staff may add any gear to a bike. `bookOnline()` does not refuse it either (see 5).
7. **A retired extra stays linked and is not offered** (left out of the read). Retiring a helmet does not rewrite every vehicle's list, and bringing it back brings it back.
8. **No row-level audit on `product_extras`**: one `extras_change` event per save, with the list before and after, on the vehicle's id (or `every_vehicle`). `price_rule_products`, the other list of links, is the same. A product deleted with links leaves no extras event (the product's own delete is audited).
9. **Two kinds of answer, as in stage 1.** `save_product_extras()` raises: `only_owner_or_manager` (42501), `invalid_extras` (22023), `product_not_found` and `extra_not_found` (another shop's product is answered exactly like a made-up id), `not_a_vehicle`, `not_an_extra`. It answers the saved list.
10. **`57014` can still arrive, and is answered the same way.** Two `move_unit()` calls for one unit sent at the same instant each took one of the two product locks and waited for the other's, behind a third session: two waits of under 6 seconds added up to the API's 8. Found while writing the test, which now sends one at a time. The staff path and `bookOnline()` answer `try_again` for both codes.

**Tests**

- **Database: 588 of 588 on the platform, on a freshly reset local database** (556 before). New: `product-extras.test.ts` (29) and 3 in `default-grants.test.ts`. The isolation harness has a fixture row, a forged row and a change to try for `product_extras`. Changed on purpose: two `product-pricing` tests expect the new `extras` key, and the grants tests' pinned settings of the four functions now read `lock_timeout=6s`.
  - **`save_product_extras()`**: every one of the five roles; another shop's five roles, a stranger, a signed-out visitor and the server, with the shop's lists unchanged; another shop's vehicle or extra answered exactly like a made-up id, beside the same call with one; every member reads the table and nobody signed in writes it by hand; the list in the order given, rows that stay keeping their id, one event per change and none for the same list again; the "every vehicle" list as a list of its own; a deleted product taking its links.
  - **What it refuses** (20 cases, each leaving every row as it was): **a most below the included quantity**; a most of 0; a negative, fractional, text or over-1000 included quantity; an unknown key; no extra named; the same extra twice; not a list; more than 100; **an extra of the wrong type** (a vehicle, the vehicle itself, an item for sale, in a vehicle's list and in the shop's); a parent that is gear or a service; a good row beside a bad one. **The table holds the same rules** for a row written by hand as the server: each check and key by name, the type that can't be lied about, one row per vehicle and extra, and one per extra in the "every vehicle" list.
  - **`pricing_inputs()`**: **a vehicle's own row winning** over the "every vehicle" row for the same extra, with the rest of the shop's list still coming with it and a vehicle with no rows of its own getting the shop's list as it is; the extras' own prices beside the vehicle asked for; each product's name; **the tax profile in force by id** (a product on the shop's default reads the default's id while its own column is empty; one with its own profile reads that; one that is not taxable reads none); no extras for gear or a service asked about alone; a retired extra not offered; staff the same as the owner; a mechanic and a driver the extras and no price; the server; another shop's member, a stranger and a signed-out visitor nothing.
  - **`quote()` fed by the adapter gives stage 4's pinned figures from real rows**: a scooter with 2 helmets included, 3 taken at ฿50 a day for 7 days, the helmets with no dates of their own: 1 charged, ฿350, ฿1,750 in all with VAT ฿114.49; two scooters and 5 helmets: 4 included, 1 charged, ฿3,150; two scooters and 3 helmets: all 3 free. Also: the shop-wide allowance on a vehicle with no rows of its own, an extra with its own dates, a product not offered with the vehicle (nothing free), and the snapshot made through `snapshotContextFor()` carrying each product's name, the profile in force by id and name, and the allowance per vehicle.
  - **The lock order, held in place** (one side unsaved, the other seen in `pg_locks`): a booking of the scooter and its helmets unsaved, and the save seen waiting for a row with no advisory lock in hand; the save unsaved, and a booking seen waiting for a row with its two product locks and its unit locks in hand; a `move_unit()` unsaved and the save seen waiting; the save unsaved and the move seen waiting with its unit lock in hand. Each then goes through.
  - **The race: 30 rounds** (10 a shop in Bangkok THB, New York USD and Saigon VND): a save of the scooter's list, a save of the shop's list, a counter booking and an online booking of the scooter with helmets, a `move_unit()` of one of its two units and the read, all at the same instant. Every call answered cleanly, both lists were exactly what was sent, and each booking was whole or refused. **1,053 rounds with stages 1 to 3.** **No deadlock:** no call answered `40P01` or `try_again`, and Postgres' own count of detected deadlocks did not move.
  - **The four lock timeouts, through the API as signed-in staff, not psql**: another session holds the product's lock for 9 seconds; `confirm_hold()`, `cancel_reservation()`, `assign_units()` and `move_unit()` each come back after 6 seconds and before 8 with `55P03`, the staff path answers `try_again`, nothing is written (reservations, blocks, units and booking events compared), and the same call goes through when sent again. `move_unit()` is tried with the lock of the product the unit is on, and of the one it goes to. A fifth test does the same for `reserve()` from the counter.
  - **The new tests fail when the code is wrong** (put into the local database by hand, then the database reset): with the "own row wins" condition taken out of `pricing_inputs()`, that test fails (four extras where three are expected); with the timeout taken off the four functions, all four tests fail with `57014`, and `reserve()`'s still passes.
- **Unit: 379 on the platform** (364 before), **522 in `@mango/core`** and **202 on the marketplace** (both unchanged). Typecheck and lint pass for every workspace, the one-pricer (money) rule included.
  - `lib/pricing-inputs.test.ts` (5 more): the pinned figures through the adapter; an extra taking its vehicle's dates and original pickup, or keeping its own; the allowance of the vehicle on the parent line; what it refuses; the snapshot's context, in baht and in dong.
  - `lib/staff-booking.test.ts` (9): each of the five staff calls answering `try_again` for `55P03` and for `57014`, throwing any other error, and passing an answer on; what each sends; the extras role table.
  - `lib/book-online.test.ts` (1 more): helmets booked with a scooter priced as its extra, and all of them still sent to `reserve()`. The static test (no file but `book-online.ts` reaches `reserve()` for an online channel) passes with `staff-booking.ts` in the tree.
- **Browser:** the full suite, 375 px and 1280 px, two workers: 142 tests, **135 passed, 7 skipped, 0 failed**, the same as stage 4. No new browser test: nothing on a screen changed. The vehicle form's move, which now goes through `moveUnit()`, is covered by `unit-move.spec.ts`.
- **Order of the final run:** typecheck, lint and unit; then the database was reset and the database suite run on its own; then the demo seed and the browser suite on that same database (CI's order).

**After the review of PR 43 (17 Nov 2026).** The review is a comment on the PR. Its verdict: the lock order, the lock timeouts, RLS, audit and pricing are sound; two screens misread the wider `pricing_inputs()` answer once any extras row exists. Neither showed yet, because no screen can create an extras row before stage 6. Four items, all in this PR.

1. **The Moto Mangos tab found the vehicle's pricing by position** (`pricing.products[0]`). The rows come in product-id order and now include the vehicle's extras, so with a priced extra whose id sorts first, the "no price by rental length" warning was judged on the helmet's row. It now asks `pricingRowOf(inputs, productId)`, a new reader in the adapter; the Pricing tab uses it too.
2. **The Pricing tab's seasons card listed every season returned**, so it would have shown seasons that apply only to the vehicle's extras. It now lists `seasonsFor(inputs, productId)`: the seasons for every product and the ones that name this product. The price was always right (`seasonsOf()` scopes each season by product).
3. **`bookOnline()` throws a `RangeError` when a line's parent is not an earlier line**, before it reads anything, as `reserve()` requires. `quote()` takes any vehicle line as a parent, so a later one passed `offer()` and `reserve()` then raised a raw `22023`.
4. **Docs:** item 4 of the list above corrected; the stage 6 list below; root `CLAUDE.md` says the hold sweep runs from cron and has no lock timeout.

Also in the same push: **`max_quantity` is the most per vehicle** (the owner, 17 Nov 2026; item 5 above).

**Tests after the review**

- **Unit: 382 on the platform** (379 before the review), **522 in `@mango/core`**, **202 on the marketplace**. Typecheck and lint pass for every workspace, the money rule included. New: in `lib/pricing-inputs.test.ts`, a read whose first row is a priced helmet with an id that sorts before the scooter's (the scooter's row is found by id; the helmet's season is not one of the scooter's); in `lib/book-online.test.ts`, a parent that is a later line, the line itself, a line that isn't there, a negative or a fractional index, each a `RangeError` with nothing read.
- **Database: 589 of 589, on a freshly reset database, the suite run on its own** (588 before the review). New in `product-extras.test.ts` (30 tests): a priced service with an id that sorts before every other is linked to a vehicle priced by rental length; the real read's first row is the service's, the vehicle's row is found by id, and of three seasons returned (every product, this bike, the service alone) the bike's are two.
- **One run before that had 2 failures of 589, both in older lock-timing tests this PR does not touch** (`product-listings`: "save_listing waits for whoever holds the product's row", 405 ms; `recheck-followups`: "team changes in one shop still go one at a time", 475 ms; each expects over 700 ms of a 1.5-second hold). A commit was being made on the same machine during that run. The two files pass alone (51 of 51) and the whole suite passed when run again with nothing beside it. They are the same kind as the `tax-profile-in-use` test noted under the Next.js upgrade: the wait is measured after a poll through `docker exec`, so a slow poll eats into it.
- **Browser:** the full suite on a freshly reset and seeded database, 375 px and 1280 px, two workers: 142 tests, **135 passed, 7 skipped, 0 failed**.
- Race rounds are unchanged: 30 in this stage, 1,053 with stages 1 to 3; no deadlock counted.

**For stage 6** (from the review and the owner, 17 Nov 2026; none of it is built here)

- **A vehicle can opt out of a shop-wide extra: "Not offered for this vehicle"** (the owner's answer, 17 Nov 2026: yes). Today a vehicle's own row can only set its own included quantity and most; it can't say "not offered". This needs a column, for example `offered boolean not null default true` on `product_extras`, **added by stage 6 in a migration of its own** (this stage's migration is not changed): an own row with `offered = false` still wins over the "every vehicle" row and takes the extra out of `pricing_inputs()`'s list for that vehicle; `save_product_extras()` takes the flag; the Extras tab shows the shop-wide line with the switch.
- **`save_product_extras()` needs a lock timeout like the booking functions.** It waits for the vehicle's row behind a booking that holds it; with no timeout a stuck save ends as a raw `57014` from the API's 8 seconds. Stage 6 gives it `lock_timeout = '6s'` and its server action answers "try again" for `55P03` and `57014` (`lib/try-again.ts`).
- **History lines need each extra's name from the product's own delete event.** An `extras_change` event holds product ids only, and a product deleted with links leaves no extras event (item 8 above). To name a helmet that has since been deleted, the History line reads the name from that product's `delete` audit row; one that still exists is read from `products`.
- **The screen label is "Most per vehicle"**, and `max_quantity` is enforced for the online channels here or in stage 11 (item 5 above).
- **`release_expired_holds()` has no lock timeout, on purpose**: it runs from cron, not through the API. Root `CLAUDE.md` says so.

**Known issues and follow-ups**

- **The lock-timeout tests are timing-sensitive under load**, as stage 3's is: each expects a call to give up between 5.5 and 8 seconds after it was sent while another session holds a lock for 9. Run the database suite on its own.
- **`max_quantity` (the most per vehicle) is not enforced anywhere yet** (item 5 above): for the online channels, in stage 6 or 11.
- **`reserve()` still knows nothing of extras**: an extra line is an ordinary gear or service line with a parent. Included units hold stock like charged ones (plan §11), which needs no change there.
- **An extra's reservation still does not follow its vehicle to another place** (stage 2, "For Phase 3").
- Nothing on a screen saves or shows extras yet (stage 6).
- A race test shows a race is closed for the timings it hit.

**Before this goes to staging** (the owner's word each time, plan Q17): nothing to count first. The migration adds one empty table and one function, re-creates `pricing_inputs()` and sets a timeout on four functions. Migrations `20261116000100` to `20261116000300` must be there in their merged form, and `pricing_inputs()` on staging must have `main`'s body (the one from `20261115000100`). Afterwards: `product_extras` is empty; `pricing_inputs()` answers `extras: []` for every shop; the five booking functions each read `lock_timeout=6s`; `save_product_extras()` can be executed by `authenticated` only; counts of products, units, blocks, reservations, pricing rows and audit rows are unchanged.

**On staging since 17 Nov 2026; not on live.** The migration (`20261117000100_platform_product_extras`) was pushed to staging (`mango-works-staging`, `qafhmdxsodeqkeznafaq`) at 10:46 UTC, from `main` at `4d435d0`, with `npx supabase db push --db-url` (never `--linked`). Staging records 64 of 64. Live was not touched.

- **Read-only checks first**, in one read-only transaction; all six passed:
  1. 63 migrations on record, newest `20261116000300`, none at or after `20261117000100`. The CLI's migration list showed 63 matching the repo and this one not yet on staging; the dry run listed exactly this one.
  2. `pricing_inputs(uuid, uuid[])` had `main`'s body, by MD5 of the stored source against the body in `20261115000100`: `5da5271a…` both.
  3. `confirm_hold(uuid, uuid)`, `cancel_reservation(uuid, uuid, uuid)`, `assign_units(uuid, uuid, uuid[])` and `move_unit(uuid, uuid, uuid, uuid, integer, timestamptz, jsonb)` each existed once with exactly those arguments and no lock timeout; `reserve()` already read `lock_timeout=6s`.
  4. No `product_extras` table; no `save_product_extras` or `extras_roles` function.
  5. `authenticated` `statement_timeout=8s`, `anon` `statement_timeout=3s`, `service_role` none; `authenticator` `statement_timeout=8s`, `lock_timeout=8s`. As on 16 Nov.
  6. Postgres 17.11.
- **The push** applied the one migration in about four seconds.
- **After, read-only:**
  - 64 migrations on record, newest `20261117000100`.
  - `product_extras` exists, empty, RLS on, one policy: "Members read product extras" (select, `authenticated`), by `my_tenant_ids(extras_roles('read'))`. Table grants: `authenticated` select only; `service_role` all; `anon` none.
  - `pricing_inputs()` has the migration's body (MD5 `6c662a4f…`, the same as the file's). It answers `extras: []` for all three shops, and each of BSR's 13 product rows has `product_name` and `tax_profile_id`. **`tax_profile_id` is empty on every row on staging** (no priced product is taxable under a profile there), so a filled one was not seen on staging; the database tests cover it.
  - `confirm_hold`, `cancel_reservation`, `assign_units` and `move_unit` each read `lock_timeout=6s` in `pg_proc.proconfig`, with `reserve`. `save_product_extras` has none (stage 6).
  - `save_product_extras()`: `authenticated` can execute; `anon` and `service_role` cannot. `extras_roles()` the same. `pricing_inputs()`: `authenticated` and `service_role`, not `anon`.
- **Smoke test through the API, as BSR's demo users, then removed** (10:49 UTC):
  - Signed out, a save is refused (401). **As `staff@bsr.demo.test` a save is refused with `only_owner_or_manager` (403), as designed**, so the two saves were made as `owner@bsr.demo.test` and everything was read as staff.
  - Saved: "Drivers License Assistance" on Honda ADV 160 (2025-2026) with 2 included and at most 4; the same extra on the "every vehicle" list with 1 included. Staff read both rows.
  - `pricing_inputs()` as staff: the ADV 160 got one row, its own (2 included, most 4, `every_vehicle` false); Honda Click 160 got the shop-wide row (1 included, `every_vehicle` true). The extra's own product row came back beside the vehicles'.
  - `quote()` for the ADV 160, 3 days, no extras: the whole result was identical before the saves, with the extras saved, and after they were removed (total 90000 minor units, THB 900.00).
  - Both lists were saved empty again: `product_extras` has 0 rows and `pricing_inputs()` answers `extras: []`.
- **Counts, the same before and after** for every `platform` table (32 products, 205 units, 21 blocks, 0 reservations, 13 pricing rows, 3 shops), **except `audit_events`: 3,415 before, 3,419 after.** The four are the smoke test's `extras_change` events (two saves, two clears); audit rows are not removed by hand.

**Local set-up.** This worktree has its own stack, `Bike_Booking_phase2_s5` on ports 6532x, started with CI's service list. `supabase/config.toml`'s change is local only (`git update-index --skip-worktree`), and `apps/platform/.env.local` names the same stack. The stacks of stage 3, stage 4 and the Next.js upgrade were stopped (not removed); another project's stack was left alone.

**Next:** stage 6, extras on screens: the Extras tab, Settings › Extras, History lines, Check a price with extras. **Done, except Check a price with extras (carried to stage 9): see stage 6, above.**

## Phase 2, stage 6: extras on screens (branch `platform/phase-2-stage-6-extras-screens`, 17 Nov 2026)

The sixth build stage of Phase 2, of eleven (`docs/phase-2-plan.md` §5.2, §7, §8; the owner's answers of 17 Nov 2026 under stage 5, "For stage 6"). **Migration on staging since 18 Nov 2026, 65/65** (see "On staging" below); **not on live.** `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**On staging since 18 Nov 2026; not on live.** The migration (`20261117000200_platform_extras_opt_out`) was pushed to staging (`mango-works-staging`, `qafhmdxsodeqkeznafaq`) at 02:40 UTC, from `main` at `b31abd7` (PR 45 squash-merged), with `supabase db push --db-url` (never `--linked`); the connection string was checked to name the staging project, and not live's, before each use. Staging records 65 of 65. Live was not touched.

- **Read-only checks first**, in one read-only transaction; all four passed:
  1. 64 migrations on record, newest `20261117000100`. The CLI's migration list showed 64 matching the repo and this one not yet on staging; the dry run listed exactly this one.
  2. The bodies the migration's guard expects, by MD5 of the stored source: `pricing_inputs(uuid, uuid[])` `6c662a4f…`, `save_product_extras(uuid, uuid, jsonb)` `d52de865…`.
  3. `product_extras` had no column named `offered` (its 11 columns as stage 5 left them).
  4. `authenticated` `statement_timeout=8s`, `anon` `statement_timeout=3s`, `service_role` none; `authenticator` `statement_timeout=8s`, `lock_timeout=8s`. As on 17 Nov. Postgres 17.11.
- **The push** applied the one migration in about four seconds.
- **After, read-only:**
  - 65 migrations on record, newest `20261117000200`.
  - `product_extras.offered` exists: `boolean`, not null, default `true`. `product_extras_not_offered_check` is there and validated: `offered OR (product_id IS NOT NULL AND included_quantity = 0 AND max_quantity IS NULL)`.
  - `save_product_extras()` reads `lock_timeout=6s` in `pg_proc.proconfig` (with its empty search path) and has the migration file's body (MD5 `01e347d3…` both). `authenticated` can execute it; `anon`, `service_role` and `public` cannot.
  - `pricing_inputs()` has the migration file's body (MD5 `2753d9bd…` both). `authenticated` and `service_role` can execute it, not `anon`.
  - Role timeouts as before the push.
- **Smoke test through the API, as BSR's demo users, then removed** (02:42 UTC). Saves as `owner@bsr.demo.test`, every read as `staff@bsr.demo.test`:
  - As staff, a save is refused with `only_owner_or_manager` (42501), as designed.
  - a) Saved "Drivers License Assistance" on the "every vehicle" list with 1 included; the answer carries `offered: true`.
  - b) Saved Honda ADV 160 (2025-2026)'s own row for it with `offered: false` (0 included, no most). Staff read both rows. `pricing_inputs()` as staff: **the ADV 160 got no row for it**; Honda Click 160 still got the shop-wide row (1 included, `every_vehicle` true). The extra's own product row came back beside the vehicles'.
  - c) `quote()` for the ADV 160, 3 days, no extras: the whole result was identical before the saves, with them in place, and after they were removed (total 90000 minor units, THB 900.00, as on 17 Nov).
  - d) Both lists were saved empty again: `product_extras` has 0 rows and `pricing_inputs()` answers `extras: []`.
- **Counts, the same before and after** (32 products, 205 units, 0 reservations, 13 pricing rows, 3 shops, 0 `product_extras` rows), **except `audit_events`: 3,419 before, 3,423 after.** The four are the smoke test's `extras_change` events (two saves, two clears); audit rows are not removed by hand.
- **Not checked here:** the Extras tab and Settings › Extras in a browser against staging.

**What changed**

- **One new migration, `20261117000200_platform_extras_opt_out`.** Stage 5's migration is not touched. An MD5 guard runs first: `pricing_inputs()` and `save_product_extras()` must still have the bodies `20261117000100` gave them, or it stops with nothing changed.
  - **`product_extras.offered`** (`boolean not null default true`): a vehicle's own row with `offered = false` is **"Not offered for this vehicle"**. It still wins over the "every vehicle" row for the same extra.
  - **`save_product_extras()` re-created** to take `offered` (its checks, answers and lock order as before), and given **`lock_timeout = '6s'`**, like the five booking functions.
  - **`pricing_inputs()` re-created**: an extra a vehicle opted out of is not offered with that vehicle, so nothing comes free with it.
- **The Extras tab** on a vehicle's page (`?tab=extras`): owners and managers add the shop's gear and services, set **Included free** and **Most per vehicle**, order and remove them, and switch a shop-wide extra off with **Not offered for this vehicle**. Everyone else who reads extras sees the same lists with no box, button or switch.
- **Settings › Extras** (`/[tenant]/settings/extras`): the list offered with every vehicle. Owners and managers edit it and see its History; **staff read it** (**Mark's decision**, 17 Nov 2026; the plan's §7 table had owners and managers only, and §12 now lists that edit). Mechanics and drivers see a vehicle's extras on its Extras tab, not here.
- **The Settings layout now lets staff in** (`lib/settings-access.ts`): owners and managers as before; staff for Settings › Extras alone, with no menu of sections. **Every other Settings page keeps its own `requireArea(slug, "settings")`**, now held by a test per page (below). A review focus in the PR.
- **`lib/extras-save.ts`, the save path**: the editor's form is checked, sent to `save_product_extras()` as the signed-in member, and the answer put in words: `only_owner_or_manager` is "Only an owner or a manager can change extras."; a lock not had in time (`55P03`, `57014`) is "try again" (`lib/try-again.ts`).
- **History lines** (`lib/extras-history.ts`): one line per save in the buttons' words ("added Helmet: 1 included, most 2 per vehicle", "set Rain gear to Not offered for this vehicle"), on the vehicle's History tab and on Settings › Extras. A product deleted since is named from its own delete event.
- **The labels**: "Most per vehicle" / สูงสุดต่อคัน everywhere. The stage 5 test that said "most-per-booking" is renamed.
- **Item 9, the most per vehicle, enforced in `bookOnline()`** (`lib/book-online.ts`). An extra line whose quantity is above its `max_quantity` × its vehicle line's quantity is refused with **`over_most_per_vehicle`** and the line's index, before `offer()` and before anything is reserved. `bookOnline()` is the only path to `reserve()` for every online channel (the booking page, **Moto Mangos** and the API), so all three are covered. **Not in `quote()` and not in `reserve()`**: staff use both, and staff are not bound (plan Q16, the owner: online only). An extra with no limit, or one not offered with that vehicle, is not bound; it is priced with nothing free (stage 5, item 6).
- **Lint:** the unused binding in `lib/extras-data.ts` is gone (the row is copied field by field).

**Where this differs from the plan or the brief, or decides what they left open** (say if any should change)

1. **"Check a price with extras" is deferred, carried to stage 9.** The plan (§7) has the Pricing tab's Check a price gain extras, the coupon code and the returning-customer tick "from the same component". Stage 9 (coupons on screens) adds the code and the tick to that component; doing extras now would rebuild the panel's inputs twice. Nothing a customer pays depends on it: `quote()` prices extras today (stage 5's pinned figures) and `bookOnline()` passes each extra's parent.
2. **The most-per-vehicle check runs before `offer()`.** A request that breaks both a rule (a closed day, say) and the most is answered `over_most_per_vehicle`. It is a fault in what was asked, cheaper to find, and its line is named.
3. **Two saves of one vehicle's list at the same instant, behind a held row,** can make the second wait longer than 6 seconds: it queues behind the first one's row lock and its own timeout starts again there. It then ends as `57014` from the API's 8 seconds, which the save path also answers "try again". The same kind as stage 5's item 10. The test sends the two one after the other.
4. **No Thai generator script is kept**: the lines were added to the review file once, from `th.json`.

**Tests**

- **Unit: 409 on the platform** (382 before), **522 in `@mango/core`**, **202 on the marketplace**. Typecheck and lint pass for every workspace, with no warnings.
  - `lib/book-online.test.ts` (1 more): above the most on each online channel (a Moto Mangos request is refused before its listing is looked at); two scooters and five helmets refused; at the most (1 and 2, 2 and 4) booked; no limit, or not offered, not bound; `reserve()` never called when refused.
  - `lib/extras.test.ts` (new, 15): the boxes to the payload (empty is 0 or no limit, 0 to 1000, a most below the included refused on its box); opt-outs as lines of their own; the editor's form read and refused; saved rows back to boxes; each refusal in words. The save path on a stand-in database: what is sent, the shop's list can't opt out, a wrong line sends nothing, staff's `only_owner_or_manager` and the two try-again codes. History changes: added, removed, changed, not offered, offered again, a new order, nothing. **The labels**: "Most per vehicle" and สูงสุดต่อคัน, "Not offered for this vehicle" and its Thai, no "most per booking" anywhere in English, every extras key in both languages with the same placeholders.
  - `tests/settings-access.test.ts` (new, 11): the Settings pages on disk are the ones listed; **one test per page** (eight) that its first check is `requireArea(slug, "settings")`, with nothing read, returned or redirected before it; Settings › Extras turns away mechanics and drivers; the sections each role gets.
- **Database: 594 of 595 on a freshly reset local database, the suite run on its own** (589 before; 6 new). The one failure is `tax-profile-in-use`'s "archive first, then making it the default: refused" (584 ms where over 700 were expected), a timing check this branch does not touch; the file passes alone (11 of 11). Stage 5's `product-extras.test.ts` now expects `offered: true` on each row `save_product_extras()` answers (two tests and the race's expectation); its 30 pass. New: `tests/db/extras-screens.test.ts` (6):
  - **the save path by role**: owner and manager save through `lib/extras-save.ts`; staff, mechanic and driver get "Only an owner or a manager can change extras." and nothing is written, for a vehicle's list and the shop's;
  - **opt-out in `pricing_inputs()`**: the shop offers a helmet and rain gear; one scooter opts out of the helmet; read as owner, staff and mechanic, that scooter gets the rain gear alone and another scooter both; the helmet priced as its extra has nothing free; switched back on, the shop's row applies again;
  - **the 6-second lock timeout**: another session holds the vehicle's row for 15 seconds; a raw call and the save path each give up after more than 5.5 and less than 8 seconds with `55P03` / "try again", nothing is written, and the save goes through once the row is free;
  - **the most per vehicle**: online above the most refused on the helmet's line for `booking_page`, `marketplace` and `api` (1 and 3, 2 and 5), with nothing written; two scooters and four helmets booked online (2 free, 2 charged); **staff at the counter book one scooter with five helmets.**
  - `default-grants.test.ts`: `save_product_extras` now reads `lock_timeout=6s` (stage 5 expected none).
  - Checked to fail when wrong: with the check in `bookOnline()` switched off, the unit test and the database test both fail.
- **Browser:** the full suite on a freshly reset and seeded database, 375 px and 1280 px, two workers: 164 tests, **153 passed, 7 skipped, 4 failed**. The four were 5-second waits on the phone project (a "Saved" note, a panel, two redirects) in `fleet.spec.ts` and `foundations.spec.ts`. This branch does not change `foundations.spec.ts`, and changes one assertion in `fleet.spec.ts` (a product's tab list, now with Extras, in "a manager adds a product…"; that test's failure came later, at a "Saved" note). The two files pass alone, **52 of 52**. Before that run, the first full run found 14 failures: the new spec's gear could not be deleted while it had stock (the spec now makes it with none), and four older specs did not know the Extras tab (below); the five specs then passed, **72 of 72**. New: `e2e/extras.spec.ts`, at 375 px and 1280 px: the owner on a boat's Extras tab (a most below the included refused with Save off, saved, read back, the History line, no sideways scroll); Settings › Extras (added to the list for every vehicle and its History line; on the boat, Not offered for this vehicle switched on, kept, and in History), holding a lock on BSR's list and putting it back; **staff** on both screens (the lists, "Only an owner or a manager can change extras.", no button, box or menu, no History) and a mechanic (the tab, not Settings › Extras); **one test per other Settings page** (Shop, Pricing and tax, Seasons, a new season, a season, Price lists, a new price list, a price list): the owner sees it, staff get "Page not found". `products-stage-d6.spec.ts` now expects five sections; `products.spec.ts`, `fleet.spec.ts` and `products-stage-c.spec.ts` expect the Extras tab.
- **Checked by eye at 375 px**, in Chromium through Playwright, signed in from `.env.local`: the Extras tab and Settings › Extras as the owner (a line with its two boxes and the error under the most, the History list) and as staff (read-only). No sideways scroll on any of the four.
- **Order of the final run:** typecheck, lint and unit; then the database was reset and the database suite run on its own; then the demo seed and the browser suite on that same database (CI's order).

**Known issues and follow-ups**

- **Check a price with extras**: carried to stage 9 (item 1 above).
- **The Thai lines need Korn's check**: 63 lines in `docs/platform/thai-review-products.md`, "Phase 2, stage 6", and a question at the top of that file: สูงสุดต่อคัน counts in คัน (land vehicles), where a boat is ลำ.
- **Known flakes, carried: `availability.test.ts`'s held-lock polls (one gave up after the review's fixes; passes alone) and `tax-profile-in-use`'s timing check** ("archive first, then making it the default: refused" expects the second call to wait over 700 ms of a held lock; it saw 584 ms in this stage's full run, 620 ms under the Next.js upgrade). The wait is measured after a poll through `docker exec`, so a slow poll eats into it. It passes alone. Not touched here. Suggested for stage 10 (review follow-ups): measure the wait from when the lock is seen held.
- **The other lock-timing tests are sensitive under load too**, as stage 5's are: in one run of `product-extras.test.ts` alone three of its held-lock tests failed once and passed on the next two runs. Run the database suite on its own.
- **Every member now has the Extras tab**, so a mechanic and a driver see a tab menu (Units, Extras) on a product where they had none. Intended (plan §7: every member reads extras); `products.spec.ts`, `fleet.spec.ts` and `products-stage-c.spec.ts` expect it.
- `bookOnline()` still has no caller (Phase 8's booking page, 3M's API), so `over_most_per_vehicle` has no screen words yet.

**After the independent review of PR 45 (17 Nov 2026; verdict: fix first).** All in this PR.

1. **The most per vehicle could be got round with a line of no parent.** `overMostPerVehicle()` skipped parentless lines, so an online caller could send the same helmet as a line of its own and exceed the limit. Now, when a vehicle line in the booking offers that extra with a limit, the extra's parentless units and its units attached to those vehicles are counted together against the sum of their mosts (each such vehicle line's `max_quantity` × its quantity, which is "max × the vehicle lines" counted by vehicle, as the attached check counts). Above it, `over_most_per_vehicle` with that line's index. Not bound: no vehicle line offers it with a limit (none offers it, or each opted out), or one offers it with no limit. Staff are still not bound.
2. Root `CLAUDE.md` says `save_product_extras()` has the 6-second lock timeout and its caller is `lib/extras-save.ts`; `lib/try-again.ts`'s header names it.
3. **Staff reading Settings › Extras is Mark's decision** (above); the plan's §12 lists the §7 edit.
4. A database test: an extra saved on a vehicle, then the product deleted; the vehicle's History entry is named from the product's delete event. The lookup moved to `lib/extras-names.ts` (`productNames()`, given a client) so the test runs the screens' own code; `getProductNames()` calls it.
5. `tests/settings-access.test.ts` strips comments before matching, so a commented-out `requireArea` fails it (a test of its own holds the stripping).
6. The read-only "every vehicle" list has no intro (it repeated the heading); `everyIntroRead` is gone from both languages and the Thai list (63 lines now).
7. A question for Korn at the top of `docs/platform/thai-review-products.md`: สูงสุดต่อคัน counts in คัน, boats in ลำ; keep คัน or a neutral word? The strings are not changed.
8. The browser note above is corrected: this branch changes one assertion in `fleet.spec.ts`.
9. **After the re-check:** `lib/extras-names.ts` imported `SupabaseClient` from `@supabase/supabase-js`, against the Neon rule; its client type now comes from `@mango/db/platform-server`. No other `@supabase` import was added on this branch. A lint rule now refuses `@supabase/*` in `apps/` (type imports too) outside the listed files (`packages/config/eslint/boundaries.mjs`, `next.mjs`).

**Tests after the review**

- **Unit: 411 on the platform** (409 before the review), 522 in `@mango/core`, 202 on the marketplace; typecheck and lint clean, no warnings. New: in `lib/book-online.test.ts`, the bypass (3 on a line of their own with one scooter; 2 attached and 1 on its own; the parentless line before the scooter's), within the most (2 on their own, 1 and 1, 4 with two scooters), opted out and no limit not bound; and `overMostPerVehicle()` across three vehicles (one with no limit frees it, one that doesn't offer it adds nothing, attached units counted only where the vehicle limits it). With the parentless count switched off, both tests fail. `tests/settings-access.test.ts` +1 (comments).
- **Database: 599 of 600, on a freshly reset database, the suite run on its own** (595 before; 5 new in `extras-screens.test.ts`, now 11): the bypass refused on all three online channels with nothing written; within the most booked; opted out of or no limit, a line of its own not bound; staff booking 5 helmets on their own line with one scooter, taken; the deleted extra's name. The one failure was `availability.test.ts`'s "a cancel, a confirm and an assign that chose their lock before a move…", a poll that gave up ("Never true"), the same `docker exec` timing kind as the flakes above; the file passes alone, 78 of 78.
- **Browser:** `e2e/extras.spec.ts` on a reset and seeded database, 375 px and 1280 px: **22 of 22**.

**Before this goes to staging** (the owner's word each time, plan Q17): `20261117000100` must be there in its merged form (the guard checks both bodies by MD5). Afterwards: `product_extras.offered` exists and is true on every row; `save_product_extras` reads `lock_timeout=6s`; `pricing_inputs()` answers as before for every shop with no opted-out row.

**Local set-up.** This worktree has its own stack, `Bike_Booking_phase2_s6`, started with CI's service list; `supabase/config.toml`'s change is local only (`git update-index --skip-worktree`).

**Next:** stage 7, coupons: the rules (`@mango/core` only).

## Phase 2, stage 7: coupons, the rules (branch `platform/phase-2-stage-7-coupon-rules`, 18 Nov 2026)

**`@mango/core` and docs only: no migration, no database, no screen, nothing in `apps/`.** From `main` at `b31abd7`. `quote()` is not changed by one line: it stays the only pricer, and nothing here multiplies, divides or rounds money (adding and comparing only).

**What was built: `packages/core/src/discounts.ts`** (exported as `@mango/core/discounts`)

- **`decideDiscounts(request)`**, a pure function. It takes the invoice as `quote()` takes it (its `couponsEnabled` is the shop's "Accept coupons" switch; its `discounts` are the staff's), each line's product type, the shop's currency, the booking moment, the location's time zone, the channel, the code given with the coupon it found and its uses so far (total and this customer's), the returning-customer settings and the customer's completed rentals (an input until Phase 3). It answers one of three things:
  - **decided:** the ordered discounts for `quote()`, whether the returning-customer discount is in them, what happened to the coupon, and the coupon's id and code keyed by discount id, ready for `snapshotQuote`'s context;
  - **refused:** one of the twelve reasons, with the discounts that still apply without the code, so a screen can say why and still show the price;
  - **can't be priced:** a line has no price yet, as `quote()` says it.
- **The order it fixes:** returning-customer discount (`returning_customer`), then the coupon (`coupon:<id>`), then whatever was passed in (staff and other), unchanged and in its own order. The staff discount is never blocked.
- **The first rule that refuses is the answer**, in this order: `coupons_off`, `unknown`, `not_active` (switched off or archived), `wrong_channel`, `too_early` / `expired`, `used_up`, `customer_used_up`, `not_these_products`, `wrong_dates`, `too_short`, `below_minimum`. With the switch off the code is not even looked at.
- **The code** is compared in upper case with every space removed, on both sides (`normalizeCouponCode`).
- **Valid dates** are the calendar day the booking is made, on the location's clock (`zonedDateString`), both ends included. No fixed offset: tested across both New York clock changes.
- **Which lines.** A line is the coupon's when its product is one of the coupon's, it starts inside the pickup dates and it is long enough (rental days on the location's clock). A percentage coupon names those lines; a fixed one is shared over them by the pricer's own proportional split, and the pricer already stops it at what they come to.
- **Minimum spend** (Mark, 18 Nov 2026): the price after seasons of the coupon's own lines, before any discount. Helmets beside a scooters-only coupon don't count; nor does the returning-customer or a staff discount lower it.
- **The returning-customer discount** applies to rental lines only: a vehicle or gear **priced by time** (by rental length or per period, the same test the season step uses). An item for sale, a service, and gear at a fixed price or free are left out. It needs the setting on and the shop's number of completed rentals; with no rental line on the invoice it is not given. The coupons switch does not stop it.
- **Not combined unless the coupon says so** (Q7). When they don't stack, the invoice is priced both ways with `quote()` and the customer gets the one that leaves less to pay.
- **A coupon never reduces the deposit and the total never goes below zero**: no change was needed in the pricer; both are now pinned by tests in every deposit mode.

**New from Mark on 18 Nov 2026, built here**

- **`with_season_discount`, "Can be used on season discounts"** (boolean, default true). When false, a line a season made cheaper is not one of the coupon's lines; a season that raised the price never rules a line out. With no line left the code is refused as `not_these_products`. In `decideDiscounts` it is `CouponSettings.withSeasonDiscount`.
  - **For stage 8:** a column on `coupons`, `with_season_discount boolean not null default true`, written by `save_coupon` and returned by `coupon_inputs`.
  - **For stage 9:** a tick on the coupon form, "Can be used on season discounts", on by default.
  - The plan's §12 lists the edit §5.3 needs.

**For Phase 3** (noted, not built)

- **A planned coupon kind: "every Nth period free"** (for example the 6th month free; Mark, 18 Nov 2026). It depends on period billing: an extension changes the count of periods, so it can't be decided on one invoice the way `percent` and `fixed` are. Not built in Phase 2; `kind` stays `'percent' | 'fixed'` until then.
- "Uses per customer" and "returning customer" run on passed-in facts until orders and customers exist (plan §2.5).
- **An extension's line should be judged on the rental's own pickup and length**, not the new period's: `rentalStart ?? span.start` for the pickup dates, and the days from the original pickup for minimum days. Today `decideDiscounts` reads `span` alone, which is right for a first booking, the only kind Phase 2 makes. Mark's lean; to confirm when Phase 3 builds extensions.

**Mark's decisions, 18 Nov 2026.** The plan did not say. The first three were built on the recommended option and Mark confirmed them as built the same day; the fourth came with the review of PR 47.

1. **A tie, when the coupon and the returning-customer discount don't stack and take the same: the returning-customer discount.** The coupon is not applied and nothing is used up (`coupon.applied: false`, `because: "returning_discount_is_better"`), so stage 8 writes no redemption and the customer keeps the code. The same answer when the returning discount is larger: the code is good, it is just not used. This is not a refusal, so the twelve reasons are unchanged.
2. **The `api` channel accepts no coupon** (`wrong_channel`). A coupon's channels are staff, booking page and Moto Mangos; staff covers `walk_in` and `phone`. `api` gets coupons when a coupon can tick it.
3. **Pickup dates and minimum days are judged line by line.** When a booking's lines have different dates, the coupon is taken only on the lines that start in its pickup dates and are long enough, and is refused (`wrong_dates`, `too_short`) when none do. With one set of dates, as every booking has today, it is the same as judging the booking.
4. **A coupon that takes 0 is not applied and uses no use** (Mark, 18 Nov 2026, after the review of PR 47). Its lines are free, or the returning-customer discount it stacks on already took them to nothing. The code is good, so this is not a refusal: the outcome is `coupon.applied: false`, `because: "takes_nothing"`, and stage 8 writes no redemption. A coupon that takes even one minor unit is applied and is a use.

**Smaller decisions, in the code's comments**

- "The larger" is judged on **what the customer pays** (the invoice total, each way), not on the two discount amounts, so tax added on top and a staff discount after them are counted.
- A line with both a cheaper season and a dearer one is out when `with_season_discount` is false: any season rule that lowers the price rules it out, judged by the rule's sign (review, item 2 below).
- A coupon whose lines come to nothing is not applied: see Mark's decision 4. (`quote-snapshot.ts` still says "a coupon on lines that came to 0 is still a use" in a comment; nothing reads it, and `decideDiscounts` no longer hands the pricer such a coupon.)
- A coupon or a returning-customer discount passed in beside the request is a programming error and throws: both are decided here, and there is one coupon per booking. So is a coupon in another currency than the shop's, and settings that could not have been saved (a day that is not a date, 0 days, a percentage over 100).
- **Totals never fall as days rise** holds with each discount in play. A coupon's own thresholds are the stated exception: reaching its minimum days or minimum spend can make the longer rental cheaper, which is the coupon doing its job. One test says so.

**Tests**

- **`discounts.test.ts`: 120 tests.** Every refusal reason, each at its boundary, and their order; the code in any case and spacing; the plan's worked example to the satang (฿3,000, 10% returning, ฿200 stacking: ฿2,500, VAT ฿163.55; not stacking: ฿2,700, VAT ฿176.64); a fixed coupon larger than its lines (zero, deposit unchanged) and a percentage coupon with a per-vehicle deposit; all four deposit modes against three coupons (12 tests: the fixed and per-vehicle deposits are the same amount, a percentage deposit moves only with the total); never below zero, alone, stacked and with staff discounts, on one line and several, two tax rates, tax included and on top, THB and JPY; a chosen-products coupon with included helmets and a service beside it; the returning discount skipping items for sale, services and fixed-price gear; the larger of the two both ways and on a tie; "Can be used on season discounts" on, off, a surcharged line, mixed lines, and a line with both kinds of season; valid dates, pickup day and rental days across both New York clock changes; JPY and VND, fixed and percentage, with a fixed coupon split over three lines in whole yen; totals never falling over 1 hour to 400 days from six starts (a month end, a leap day, New Year, both clock changes) for six combinations of discounts; **every pinned D2 and D3 figure unchanged when no discount applies** (41 of the 43 pinned invoices; the other two pass a coupon in themselves, which `decideDiscounts` refuses by design, and stay pinned in `quote-snapshot.test.ts`); `snapshotQuote` recording each decided discount (id, source, coupon id and code, kind, value, lines, amount per line).
- **Unit: 642 in `@mango/core`** (522 before), 411 on the platform, 202 on the marketplace. Typecheck and lint clean in every workspace. No database or browser test is touched.

**After the review of PR 47** (18 Nov 2026: merge as it is, no must-fix; these were asked for before the merge)

1. **A way the pricer refuses is not on offer.** When a coupon and the returning-customer discount don't stack, the invoice is priced both ways. If one way throws `credit_exceeds_base` (a credit carried to the invoice is larger than what that discount would leave), the customer gets the other; the error is thrown on only when both ways throw. The review's case is a test: a ฿1,400 week with a ฿1,200 credit, 10% returning and a ฿400 coupon gives the returning discount and ฿60 to pay, where it threw before.
2. **"Can be used on season discounts" judges the season rule's sign, not the rounded amount.** The ids of the rules with `adjustBp < 0` are collected from the invoice's season rules, and a line is out when one of them adjusted it. A ¥40 helmet for a day in a 1%-off season (¥0.4, so ¥0) is refused as `not_these_products`; it was accepted before.
3. **A coupon that takes 0 is not applied and uses no use** (Mark's decision 4, above). The outcome is `coupon.applied: false`, `because: "takes_nothing"`; the coupon is not in the discounts and not in the snapshot's coupons. Found by pricing the chosen list with `quote()` and adding what the coupon took.
4. **The two pinned invoices that pass a coupon in** (D2's 10% coupon, the dong shop's fixed coupon) are now also run through the code path: the same coupon as `CouponSettings`, found by its code, gives the same totals, tax groups, line amounts and pinned figures. The count of the others is pinned at exactly 41.
5. **"The larger" is not "the bigger discount"**, in two tests: a staff ฿450 after a ฿150 coupon finds only ฿350 left to take, so the ฿140 returning discount leaves less to pay (฿1,310 against ฿1,400); and with tax on top at 10% and 7%, ฿140 off the scooter saves ฿154 where ฿142 off the lock saves ฿151.94.
6. **A static test holds `discounts.ts` to adding and comparing**: with comments and strings stripped, any `*`, `/` or `%` in the file fails `discounts.test.ts`. The file's two patterns are built from strings for that reason.
7. **Tests after the review: 130 in `discounts.test.ts`, 652 in `@mango/core`.** Typecheck and lint clean.

**For stage 8** (from the review of PR 47; none of it is built here)

- **One code normaliser.** `save_coupon` normalises the code (upper case, spaces removed), accepts only A to Z and 0 to 9 after that, stores that form, and the lookup compares by equality. `normalizeCouponCode` in `@mango/core` and the database must not drift apart.
- **Uses leave out this booking's own redemption** when a held booking is priced again: otherwise a coupon's last use refuses the very booking that holds it.
- **The redemption's amount is read from the quote's lines by `discountId`** (what the coupon took, added up), and the column allows 0.
- **`not_active` needs the lookup to see archived coupons**: a lookup that hides them answers `unknown`. Decide then whether an archived code can be used again for a new coupon.
- **`reserve()` rechecks active and archived under the coupon's row lock**, with the count of uses.
- The `with_season_discount` column (above).
- A coupon with `applied: false` (`returning_discount_is_better` or `takes_nothing`) writes no redemption.

**Carried**

- **Extend the money lint to `packages/core`.** The rule that refuses `*`, `/` and `%` on amounts covers `apps/platform` only (`one-pricer.test.ts`). In core it has to let the pricer's own files through and hold every other file; until then `discounts.ts` is held by its static test (item 6 above).

**Next:** stage 8, coupons in the database (the three tables with `with_season_discount`, the returning-customer settings columns, `save_coupon`, `coupon_inputs`, redemption inside `reserve()`). **Done: see stage 8, below.**

## Phase 2, stage 8: coupons in the database (branch `platform/phase-2-stage-8-coupons-db`, 18 Nov 2026)

The eighth build stage of Phase 2, of eleven (`docs/phase-2-plan.md` §3.2, §4, §5.3, §6, §8). From `main` at `3c3b4bd` (PR 47 merged). **Database, the two booking paths and their tests: nothing on a screen changes** (Settings › Coupons, the returning-customer card and "Check a price" with a code are stage 9). **Migration on staging since 18 Nov 2026, 66/66** (see "On staging" below); **not on live.** `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**On staging since 18 Nov 2026; not on live.** Migration 20261118000100 pushed to staging, 66/66. The migration (`20261118000100_platform_coupons`) was pushed to staging (`mango-works-staging`, `qafhmdxsodeqkeznafaq`) at 08:15 UTC, from `main` at `165cb9e` (PR 48 squash-merged), with `supabase db push --db-url` (never `--linked`); the connection string was checked to name the staging project, and not live's, before each use. Live was not touched.

- **Read-only checks first**, in one read-only transaction; all passed:
  1. 65 migrations on record, newest `20261117000200`, none newer. The dry run listed exactly this one.
  2. The eight bodies the migration's guard expects, by MD5 of the stored source (`md5(prosrc)`, as the guard computes it): `reserve` `d38413ff…`, `cancel_reservation` `d9d02760…`, `confirm_hold` `744aefe0…`, `expire_holds` `93e204f2…`, `save_pricing_settings` `dbd61712…`, `pricing_inputs` `2753d9bd…`, `tenants_lock_currency` `4b545b4c…`, `currency_locked` `20c8317e…`.
  3. No table or function with "coupon" in its name. (`pricing_settings.coupons_enabled`, from an earlier migration, was already there.)
  4. `reserve()`, `cancel_reservation()` and `confirm_hold()` each read `lock_timeout=6s`.
- **The push** applied the one migration in about seven seconds.
- **After, read-only:**
  - 66 migrations on record, newest `20261118000100`.
  - The eight re-created functions have the migration's bodies: `reserve` `e0ca7239…`, `cancel_reservation` `858f50b0…`, `confirm_hold` `fb5aa3c6…`, `expire_holds` `ff6fa160…`, `save_pricing_settings` `f6eccceb…`, `pricing_inputs` `56d38b5a…`, `tenants_lock_currency` `4325072b…`, `currency_locked` `af9db486…`. The new ones too: `save_coupon` `c9e3304f…`, `coupon_inputs` `f22497a9…`, `coupon_uses` `7dda4ec5…`.
  - `reserve()`, `cancel_reservation()`, `confirm_hold()` and `save_coupon()` read `lock_timeout=6s`.
  - `coupons`, `coupon_products` and `coupon_redemptions` exist, each with RLS on and one policy, each empty.
  - `anon` has no privilege on the three tables and cannot execute `coupon_inputs()` or `save_coupon()`; real attempts as `anon` were all refused ("permission denied for schema platform"). `authenticated` has `select` only on the three tables. `save_coupon()` can be executed by `authenticated` only (not `service_role`, `anon` or `public`); `coupon_inputs()` by `authenticated` and `service_role`.
  - `pricing_settings` has `returning_enabled` (boolean, not null, default `false`), `returning_percent_bp` (integer, nullable, no default) and `returning_rentals_needed` (integer, not null, default `1`); the one row there reads `false`, empty, `1`.
  - Generated types: regenerated against staging (`supabase gen types typescript --db-url`, schemas `public,graphql_public,platform`), no difference from `packages/db/src/database.types.ts` on `main`.
- **Smoke test, read-only** (one read-only transaction as BSR's demo owner, rolled back): `coupon_inputs()` for a code that doesn't exist answered `{"coupon": null, "uses": null}`, no error. No coupon or booking was created.
- **Counts, the same before and after:** 3 shops, 32 products, 0 reservations, 1 `pricing_settings` row.
- **Not checked here:** nothing in a browser against staging (no screen uses this until stage 9).

**What changed**

- **One new migration, `20261118000100_platform_coupons`** (migration 5 of the plan). No earlier migration is touched.
  - **A guard first.** The eight functions it re-creates must still have the bodies `main` gave them, by MD5 of the stored source (as `20261117000200` does): `reserve()`, `cancel_reservation()`, `confirm_hold()` (added after the review, below), `expire_holds()`, `save_pricing_settings()`, `pricing_inputs()`, `tenants_lock_currency()` and `currency_locked()`. On a mismatch it raises before anything is changed. Each body was read from the database (`pg_get_functiondef`) and patched by a script that fails unless every edit matches exactly once; none was retyped.
  - **`platform.coupons`**: `currency`, `code`, `name`, `kind` (`percent` | `fixed`), `percent_bp` (1 to 10000), `amount` (more than 0), `all_products`, `valid_from` / `valid_to`, `pickup_from` / `pickup_to`, `min_days`, `min_spend`, `max_uses`, `max_uses_per_customer`, `channels` (any of `staff`, `booking_page`, `marketplace`; no `api`), `with_returning_discount`, `with_season_discount` (default true), `active`, `archived_at`. Only the number of the kind in force is kept.
  - **`platform.coupon_products`**: `tenant_id`, `coupon_id`, `product_id`. A deleted product takes its links with it.
  - **`platform.coupon_redemptions`**: `tenant_id`, `coupon_id`, `booking_id`, `customer_id` (empty until Phase 3), `amount` (more than 0; it was 0 or more before the review, below), `redeemed_at`, `released_at`. One live use per booking in a shop.
  - All three: parents by `(tenant_id, id)`, RLS, grants written on purpose (`service_role` too), `updated_at`, audit (a row event for every change to a coupon and every use; a coupon's product links are one `coupon_change` event, as a season's are), and a fixture row per tenant in the isolation tests.
  - **`platform_private.normalize_coupon_code()`**: the code's one normaliser (below).
  - **`platform.save_coupon(p_tenant_id, p_coupon)`**: owners and managers. Names only what is to change; a new coupon needs a code and a kind with its number. `"archived": true` archives, `false` brings it back. 6-second lock timeout, set with `alter function`. Not the server's.
  - **`platform.coupon_inputs(p_tenant_id, p_code, p_booking_id, p_customer_id)`**: one read, as its caller under RLS, of what `decideDiscounts` needs about a code: the coupon's settings, its product ids and its uses (in total and by one customer). Amounts are strings of digits.
  - **Three settings on `pricing_settings`**: `returning_enabled` (off to start), `returning_percent_bp`, `returning_rentals_needed` (default 1). `save_pricing_settings()` takes them and `pricing_inputs()` returns them in `settings`.
  - **`reserve()`** takes `"coupon": {"coupon_id", "amount", "customer_id"}`; **`cancel_reservation()`** and **the hold sweep** (`expire_holds()`, which `release_expired_holds()`, `reserve()` and `assign_units()` all run) give the use back. `reserve()` keeps its 6-second lock timeout and every guard it had.
  - **The currency lock** counts a coupon that holds an amount of money.
- **`@mango/core`**: `normalizeCouponCode()` rewritten to the database's rule, `isCouponCode()`, and `coupon-code.cases.ts`, the one list of cases both sides are tested against. The stale comment in `quote-snapshot.ts` is fixed (a coupon that would take 0 is not applied and is not a use).
- **`apps/platform/lib`**
  - **`coupons.ts` (new), the one feed**: `readCoupon()` (the read), `couponFoundOf()` and `returningCustomerOf()` (rows to `decideDiscounts`' input), `decideFor()` (builds the request and puts the decided discounts on the invoice for `quote()`), `couponUseOf()` (what the coupon took, added up from the quote's lines by `discountId`).
  - **`book-online.ts`**: a code (`couponCode`), the customer's completed rentals and id are inputs. Order: the reads, `decideDiscounts`, `offer()` (which calls `quote()` with the discounts), then `reserve()` with the coupon and its amount. It is still the only file that calls `reserve()` for an online channel, and still calls it once, after `offer()`.
  - **`staff-booking.ts`**: `bookAsStaff()`, a counter or phone booking priced with its coupon (`decideDiscounts` → `quote()` → `reserve()`); `reserveAsStaff()` passes a coupon when given one.
  - **`coupon-save.ts` (new)**: `saveCoupon()`, which answers `try_again` for `55P03` and `57014` and names the database's refusals. Stage 9's form calls it.
  - All database access is through the client from `@mango/db`; `quote()` is still the only pricer (the coupon's amount is read from the quote and added, nothing more).
- **Root `CLAUDE.md`**: coupon rows in the lock order, how a use is counted and given back, `save_coupon()`'s locks and timeout. **`docs/phase-2-plan.md`**: §4's `save_coupon` and hold-sweep rows say how they are built; §12 lists what §5.3 needs. Types regenerated.

**The code: one normaliser**

- Two steps and nothing else: the spaces and invisible characters in a fixed list are removed (tab, line breaks, space, no-break space, U+1680, U+2000 to U+200A, line and paragraph separator, U+202F, U+205F, the ideographic space, the byte order mark, the zero-width space, non-joiner, joiner and word joiner); then **a to z become A to Z**.
- **No locale's upper case is asked**, so the database and TypeScript can't disagree: a sharp s stays as it is (JavaScript's `toUpperCase()` would make it `SS`), full-width letters are not folded, the fi ligature and the Kelvin sign are left alone. Any such character is then refused by the next rule.
- `save_coupon()` accepts only **A to Z and 0 to 9, 1 to 40 characters,** after normalising (`invalid_code`), and stores that form. The table has the same check. The lookup compares by equality.
- 31 shared cases (no-break space, zero-width space, sharp s, full-width letters and digits, accents, a dotless i, Greek and Cyrillic look-alikes, an emoji, Thai, a quote) run through both functions: a unit test in `@mango/core`, and a database test that sends each code as hex and compares the stored form byte for byte.

**Lock order, as built** (root `CLAUDE.md`)

1. `reserve()`: product-and-location locks, unit locks, unit rows, product rows, listing rows (Moto Mangos), **the coupon's row `for update`**, then the sweep's reservations and blocks, then the inserts (the redemption with the reservations).
2. `cancel_reservation()`: product-and-location locks, unit locks, **the coupon's row**, reservations, blocks, the redemption.
3. The hold sweep: reservations, blocks, then the redemption's `released_at`. **No coupon row.**
4. `save_coupon()`: no advisory lock. The coupon's row, then its product links in product-id order.

**Where this differs from the plan or the brief, or decides what they left open** (say if any should change)

1. **An archived code can be used again** (the brief's recommendation). The code is unique among coupons that are not archived (a partial unique index). The lookup finds the live coupon first, else the one archived last, so an archived code still answers `not_active` and not `unknown`. Bringing an archived coupon back while a live one has its code is refused (`code_taken`).
2. **The hold sweep takes no coupon row** (the plan's §4 gave it none; the brief did not say). Inside `reserve()` the sweep runs with that call's own coupon row held; locking the swept holds' coupons there would be a second coupon lock out of id order, and two bookings could cross. It is safe without: a use is only ever added under the coupon's row, so a use given back without it can only make a count read high for a moment.
3. **A hold that has run out holds no use, swept or not.** `coupon_uses()` leaves out a redemption whose booking is only expired holds. Otherwise a coupon's last use would stay taken until the sweep reached that product (the sweep inside `reserve()` only covers the products being booked). An expired hold can't be confirmed, so the use can't come back to it.
4. **A booking cancelled in part keeps its use.** It is given back when nothing of the booking is left (every row cancelled or expired).
5. **`reserve()` also refuses a fixed coupon said to have taken more than its amount** (`coupon_not_valid`). The amount is the quote's and the database does not work it out, but a staff member calls `reserve()` as themselves, and this is the one bound it can hold. No such coupon, or another shop's, is `coupon_not_valid` too, before any lock.
6. **The currency recheck can't fail today.** `coupons` has a foreign key to the shop's `(id, currency)`, so a coupon can't be in another currency than its shop. `reserve()` checks it under the lock all the same, as asked.
7. **The currency lock counts a minimum spend as well as a fixed amount** (the plan: "a fixed-amount coupon"). Both are amounts of money in the shop's currency. A percentage coupon with no minimum spend holds none: the currency can still change, and the coupon follows the shop (`on update cascade`). An archived coupon still counts.
8. **A refused code refuses the booking**, on both paths (`coupon_refused`, with the reason), rather than booking at the price without it. Nobody is booked at a price they did not expect; the screen says why and the booking is sent again without the code.
9. **`customer_id` is carried now** (in `reserve()`'s coupon, `coupon_inputs()` and the redemption), so "uses per customer" is counted under the lock from the day customers exist. Until Phase 3 nobody sends one.
10. **Per customer, the refusal under the lock is `coupon_used_up`** (the plan gives `reserve()` two reasons only). `decideDiscounts` says `customer_used_up` before the transaction.
11. **Two kinds of answer, as in stage 1.** `save_coupon()` raises: `only_owner_or_manager` (42501), `invalid_coupon` and `invalid_code` (22023), `coupon_not_found`, `product_not_found` and `code_taken` (P0001; another shop's coupon or product is answered exactly like a made-up id). `reserve()` answers `coupon_not_valid` and `coupon_used_up`; a coupon it can't read at all is `invalid_request`.
12. **A coupon for chosen products must name at least one** (`invalid_coupon`): it could never be used. A retired product may stay linked.
13. **`save_coupon()` leaves the links that stay alone** (it deletes the ones no longer named and adds the new ones), where `save_price_rule()` deletes and re-inserts them all.
14. **Changed after the review (below): `reserve()` now refuses a coupon on the `api` channel.** As first built, the `api` channel was not rechecked in `reserve()`: the channel is one of the rules that ran before the transaction (`wrong_channel`), and nothing can change it meanwhile but a save, which the brief's list of rechecks does not include. Say if it should be.
15. **The one-coupon-per-booking index is per shop** (`(tenant_id, booking_id)`). Found by the isolation test: two shops' fixture rows with the same booking id.

**Tests**

- **Database: 644 tests on the platform** (600 before). On a freshly reset local database, the suite run on its own: **640 passed, 4 failed, all four in older lock-timing tests this PR does not touch** (`reservations`: three "held in place" tests that timed out; `product-listings`: "save_listing waits for whoever holds the product's row", 44 ms where over 700 ms is expected). **The two files pass when run alone: 107 of 107.** They are the load-sensitive kind recorded under stage 5 and the Next.js upgrade. New: `coupons.test.ts` (41), 3 in `default-grants.test.ts`, and the isolation harness has a fixture row, a forged row and a change to try for each of the three tables.
  - **The normaliser, TypeScript against SQL**: the 31 shared cases through both, byte for byte; `save_coupon()` storing that form and refusing the rest; the lookup finding a code however it is typed; the table's own check for a row written by hand.
  - **Who may**: `save_coupon()` by each of the five roles; another shop's five roles, a stranger, a signed-out visitor and the server refused, with the shop's coupons unchanged; owners, managers and staff reading the three tables and mechanics, drivers and outsiders seeing none; every direct write refused.
  - **Cross-tenant**: shop A naming shop B's coupon in `save_coupon()` and in `reserve()` (as a member and as the server), B's product in a coupon, and B's code in `coupon_inputs()`: each answered exactly like a made-up one, beside the same call with one, and B's rows untouched.
  - **`save_coupon()`**: every setting; only what is named changing; the kind's other number cleared; 35 malformed payloads each `invalid_coupon` or `invalid_code` with nothing written; a bad change leaving an existing coupon whole; each table check by name; the code unique among live coupons, an archived code used again, and the lookup finding the right row at each step; the audit events.
  - **`coupon_inputs()`**: every setting, an amount past what a JSON number holds arriving whole, uses in total and by customer, by role; real rows through the adapter and `decideDiscounts` (an archived or switched-off code is `not_active`, never `unknown`); **no coupon function multiplies, divides or rounds**.
  - **The returning-customer settings**: off to start, saved, carried by `pricing_inputs()`, kept when another setting is saved; what is refused; the table's checks.
  - **`reserve()`**: one redemption with the booking for the amount sent, from the counter and online; none without a coupon; refused under the lock with nothing written (switched off, archived, a fixed coupon taking more than its amount; the last use gone in total and by customer); a coupon that can't be read; a booking refused for stock using no use.
  - **A use given back**: by a cancel (and the last use had again); kept by a booking cancelled in part; held and kept by a confirmed hold; back at once when a hold runs out, for a booking of another product too; marked by the scheduled sweep and by the sweep inside `reserve()`.
  - **A held booking priced again** does not count its own use: `used_up` without its booking id, applied with it.
  - **Both paths end to end on real rows**: `bookAsStaff()` and `bookOnline()` at ฿300 a day for two days with a ฿200 coupon: ฿400, and the redemption holds 20000. **A coupon that is not applied writes no redemption** (the returning discount is better; it would take nothing). **A coupon archived, switched off or used up between the quote and `reserve()`** is refused under the lock with nothing written, both ways round.
  - **The lock order, held in place** (one side unsaved, the other seen in `pg_locks`): a save unsaved, and a booking seen waiting for a row with its product and unit locks in hand, then refused `coupon_not_valid`; a booking unsaved, and a save seen waiting with no advisory lock, and a second booking refused `coupon_used_up`; a cancel unsaved, and a booking that waits behind it and gets the use that came back.
  - **`save_coupon()`'s lock timeout, through the API**: another session holds the coupon's row for 9 seconds; the save comes back after 6 and before 8 with `55P03`, `saveCoupon()` answers `try_again`, nothing is written, and the same save goes through when sent again.
  - **The races: 120 rounds** (8 a shop for each of five races, in Bangkok THB, New York USD and Saigon VND): two bookings after a coupon's last use, staff against staff, online against online and staff against online: **exactly one succeeds, the other is `coupon_used_up` and wrote nothing**; two coupons with one use each, booked by four bookings naming two products in opposite orders: one booking per coupon; and bookings, a cancel, a hold that ran out, the sweep, a save and the read all at once: never more live uses than the coupon allows.
  - **The race rounds of stages 1 to 3 and stage 5 ran again in the same suite** (`reservations`, `availability`, `booking-rules`, `product-extras`). **No deadlock:** no call answered `40P01` or `try_again`, each file's own check passed, and Postgres' count of detected deadlocks for the database was **0** after the whole run and the reruns.
  - **The currency lock**: a fixed coupon and a minimum spend each lock it, archived too; a percentage coupon with neither leaves it free and follows the shop.
  - **The guard**: run against a function whose body was changed (in a transaction that is undone), it raises and names the function.
  - **The new race test fails when the code is wrong** (put into the local database by hand, then put back): with `for update` taken off the coupon's row in `reserve()`, "two bookings after a coupon's last use" fails in its first round with both bookings `ok`.
- **Unit: 435 on the platform** (411 before), **654 in `@mango/core`** (652), **202 on the marketplace** (unchanged). Typecheck and lint pass for every workspace, the money rule included.
  - `lib/coupons.test.ts` (17): the adapter; `decideFor()` and what `reserve()` is handed (a fixed coupon on its own line; a percentage over two lines beside the returning discount, added up by discount id; refused; not applied; no code); `bookAsStaff()`; `saveCoupon()`'s answers.
  - `lib/book-online.test.ts` (7 more): no code (the coupon is never read); a good code (`reserve()` handed the coupon and 900 of 9000); a fixed coupon larger than its lines (what it took, not its face value); six refusals with `reserve()` never called; not applied (no coupon sent); the returning discount with no code; `reserve()`'s two refusals passed on. The static test still finds `book-online.ts` the only file that calls `reserve()`.
  - `discounts.test.ts` (2 more): the shared cases; a to z alone.
- **Browser:** not run here: nothing on a screen changed. CI runs the full suite.

**After the review of PR 48** (18 Nov 2026, an independent review at `cdd321e`: "ready to merge once finding 1 is fixed"). All nine findings are fixed in this PR. The migration was on no database but the local one, so `20261118000100_platform_coupons` was edited in place and the local database reset; there is still one migration.

1. **Blocker: `confirm_hold()` could add a coupon use outside the coupon's row.** A hold that has run out holds no use (`coupon_uses()`), and `confirm_hold()` took no coupon row and judged a hold's expiry by when the call began (all but Moto Mangos holds). A confirm that began just before the expiry and a booking of another product that began just after it could both go through: two confirmed bookings on a coupon with one use. **Fixed:** `confirm_hold()` is re-created in this migration (and is in the guard). After its advisory locks and, for Moto Mangos, the products' and listings' rows, it takes the booking's coupon row `for update`, as `cancel_reservation()` does; then the reservations; then it judges the expiry by `clock_timestamp()`, for every channel. Its `lock_timeout` is still 6 seconds and its grants are as they were. Whichever of a confirm and a booking holds the coupon's row first, the other sees what it did: the booking counts the confirmed hold and is refused, or the confirm finds the hold expired.
   - **One behaviour changes on purpose:** a counter or booking-page hold whose confirm waits for a lock past the hold's expiry is now refused (`hold_expired`); before, only a Moto Mangos hold was judged that way. Stage 3's test that pinned the old rule ("a hold of the shop's own page is still judged by when the call began") now expects the refusal.
2. **`reserve()` wrote a use for a coupon amount of 0.** Now `invalid_request` for an amount under 1, and the column's check is `amount > 0`.
3. **`reserve()` took a coupon on the `api` channel**, and did not read the shop's "Accept coupons" switch. Now a coupon on `api` is `invalid_request`, and the switch is read again under the coupon's row: off, or never saved, is `coupon_not_valid`.
4. **The "staff against staff" race booked one product on both sides**, so the product's advisory lock made them take turns with or without the coupon's row. Now the two sides book two products.
5. **The parity test covered 15 of the 29 removed characters.** Now every code point in all 17 planes goes through both normalisers (a database test: the same 55 code points change, to the same bytes, and no other), and a unit test holds the TypeScript side to exactly the 26 letters and the 29 removed characters. Every invisible character in `coupon-code.cases.ts` and in `REMOVED` is a backslash-u escape; a test fails on a literal one. (They had been written as literal bytes.)
6. **A code Postgres can't hold threw instead of answering `unknown`** (a NUL: `22P05`; a lone surrogate: `PGRST102`). `readCoupon()` now sends a code only when it could be a coupon's (`isCouponCode(normalizeCouponCode(code))`); anything else is "no such coupon" with no read, and `decideDiscounts` answers `unknown`.
7. **A held booking priced again is looked up by the coupon id on its redemption** (`coupon_inputs()` with a booking id), when that coupon has the code given. Archived since, with its code used again for a new coupon, it is still the booking's own coupon and not the new one.
8. **A coupon with no limit is not counted under the lock**: `reserve()` calls `coupon_uses()` only when the coupon has `max_uses`, or `max_uses_per_customer` and a customer. `coupon_inputs()` still counts, for the screen.
9. **`saveCoupon()` answers `try_again` for a deadlock (`40P01`)** as well as `55P03` and `57014`. The booking functions catch a deadlock themselves; `save_coupon()` raises it.

**Decided differently from the review's wording** (say if either should change)

- **Finding 3, the switch off under the lock: `coupon_not_valid`**, not `coupon_refused` with `not_active`. `reserve()` has two coupon refusals (plan §3.2), and `coupon_not_valid` already means "it changed since the rules ran: send the booking again and the rules will say why", which is what happens: on the next try `decideDiscounts` answers `coupons_off`. `coupon_refused` is the app's answer for a rule's refusal, made before the transaction.
- **Finding 7: the booking's own coupon is preferred only when it has the code that was typed.** A different code typed for that booking is looked up by the code, so staff can still try another coupon on a held booking.
- **Finding 5: the full sweep is a test, not a script.** It takes about two seconds.

**The guard, and the functions' MD5s** (of the stored source)

| Function | `main`'s body (what the guard expects) | After this migration |
| --- | --- | --- |
| `platform.reserve(uuid, jsonb)` | `d38413ff072b5db4bd0470dd16d05532` | `e0ca7239cb2f8e2fabc9f3ae3dd717b7` |
| `platform.cancel_reservation(uuid, uuid, uuid)` | `d9d027600fd6ac40db35b9a4fb6d784e` | `858f50b095813dcacbce1694941dbd4f` |
| `platform.confirm_hold(uuid, uuid)` | `744aefe0ac56779f2ccc4c364af6be75` | `fb5aa3c61e7d12ddf0e76f93feaf082b` |
| `platform_private.expire_holds(uuid, uuid[], uuid[], timestamptz)` | `93e204f23400cf8292e3d45e323a94be` | `ff6fa160435d21f476daa3c553262859` |
| `platform.save_pricing_settings(uuid, jsonb)` | `dbd61712f2c4d2b00c99fffd861244e5` | `f6ecccebc42680ca2ba7b48c2c36892b` |
| `platform.pricing_inputs(uuid, uuid[])` | `2753d9bdbb7712ebefe027b68e8978b3` | `56d38b5ae5b33fdcf9ecddd80d0e3890` |
| `platform_private.tenants_lock_currency()` | `4b545b4c94e3d10b1172745cfd33f7fe` | `4325072baf78a6ffd19b702f56444ac4` |
| `platform.currency_locked(uuid)` | `20c8317efa611bd2ecc721fdde56e7ba` | `af9db486f48ae6f358e731dfff476c6c` |

New in this migration: `save_coupon()` `c9e3304f25b0291d2de692835e18ce8a`, `coupon_inputs()` `f22497a912c8fbde8a42e994f82e3cde`, `coupon_uses()` `7dda4ec5b9ef42934a63afff213a4ac3`.

**Two mutation checks** (the function changed by hand in the local database, the test run, the function put back and its MD5 compared)

- **Finding 1:** with the coupon's row taken out of `confirm_hold()`, "a confirm in flight across the hold's expiry" fails: the booking of the other product answers `ok` where `coupon_used_up` is expected. Put back: `fb5aa3c6…`, the migration's.
- **Finding 4:** with `for update` taken off the coupon's row in `reserve()`, the race fails at **Bangkok, staff against staff, round 0**, the first round run: both bookings `ok`. (Before the fix to the test, the staff rounds passed with the lock removed and the first failure was "online against online".) Put back: `e0ca7239…`, the migration's.

**Tests after the review**

- **Database: 654 of 654 on the platform, on a freshly reset local database, the suite run on its own** (644 tests before the review; 19 files). The run before it had 653 of 654: the one failure was stage 3's test that pinned the old expiry rule (item 1 above), since changed. In between, `booking-rules.test.ts` run alone once timed out in an older held-in-place test ("two bookings of one scooter model for two places") and passed 45 of 45 when run again: the load-sensitive kind already on the stage 10 list. **No deadlock:** Postgres' count for the database was 0 after the whole run, and after the run before it.
- **Unit: 439 on the platform** (435 before the review), **656 in `@mango/core`** (654), **202 on the marketplace**. Typecheck and lint pass for every workspace, the money rule included.
- New database tests, in `coupons.test.ts` (51, was 41), under "after the review of PR 48": the confirm in flight across the expiry (one live use); the other way round, and a confirm that waits for a lock past the expiry; an amount of 0; the `api` channel; the switch under the lock (never saved, on, off); the 17-plane sweep; a NUL and a lone surrogate, through the read and through both booking paths; a held booking whose coupon was archived and its code used again; the count skipped for a coupon with no limit. The guard test expects eight functions; `default-grants.test.ts` pins `confirm_hold()`'s grants and timeout as re-created.
- New unit tests: `readCoupon()` sending nothing for a code that could not be a coupon's, `decideFor()` and `bookAsStaff()` then answering `unknown` (3); `bookOnline()` the same (1); the sweep and the escapes in `discounts.test.ts` (2); `40P01` in the `saveCoupon()` test.

**For stage 9** (none of it is built here)

- Settings › Coupons calls `saveCoupon()` (`lib/coupon-save.ts`) and shows `try_again`, `code_taken`, `invalid_code` and the rest in words.
- **The list's "12 of 50" must come from `coupon_inputs().uses.total`**, not from a raw count of `coupon_redemptions` with `released_at` empty: that count still includes holds that have run out and not been swept, which no longer hold a use (review of PR 48).
- **The coupon form must not promise "uses per customer"** until Phase 3 sends a `customer_id`: nothing sends one today, so the limit is stored and never reached (review of PR 48).
- **`invalid_code` needs plain wording for the shop** ("Use only the letters A to Z and the numbers 0 to 9"): Thai characters and full-width digits land here (review of PR 48).
- The returning-customer card saves `returning_enabled`, `returning_percent_bp` and `returning_rentals_needed` through `save_pricing_settings()`; switched on with no percentage is `returning_percent_required`.
- "Check a price" with a code: `readCoupon()` then `decideFor()` then `quote()`, the same three calls the booking paths make. A held booking priced again passes its booking id.
- The form's tick "Can be used on season discounts" (`with_season_discount`), on by default.
- The form should show the code as it will be stored (`normalizeCouponCode`) and say when it can't be saved (`isCouponCode`).

**For stage 10** (from the review of PR 48; none of it is built here)

- **Fold full-width A to Z and 0 to 9 in both normalisers** (a fixed list, no locale), so a customer typing a code with an IME in full-width letters gets a match. The shared cases and the 17-plane sweep must move with it.
- **Test a shop's currency change racing `save_coupon()` and `reserve()`**: the tenant's row against the coupon's row, while the currency is still unlocked.
- **Consider counting any redemption in the currency lock**: `coupon_redemptions.amount` has no currency of its own, so a percentage coupon that has been used leaves amounts behind in the old currency if the currency then changes.
- The flaky lock-timing tests stay on the stage 10 list as before.

**For Phase 8** (from the review of PR 48)

- **Rate-limit code checks on the public booking page**: `not_active` against `unknown` tells a visitor that a code exists.
- **`customerId` and `completedRentals` on `bookOnline()` must come from the server**, never from the browser: they decide a discount and a coupon's uses.

**For Phase 3** (noted, not built)

- **`max_uses_per_customer` is enforced only once a `customer_id` is sent** (review of PR 48): the count is built and tested with ids passed in; Phase 3 sends the real one from both booking paths.
- **A held booking whose coupon was archived since** is priced again as `not_active` (the lookup finds its own coupon, archived). Whether a hold keeps a coupon that was archived after it was made is for the order editor to decide.
- **A stacking coupon with a credit still throws `credit_exceeds_base`.** When a coupon and the returning-customer discount do not stack, `decideDiscounts` prices both ways and drops the way the pricer refuses (stage 7, review item 1). When they do stack there is only one way, so a credit carried to the invoice that is larger than what the two discounts leave in its rate group is thrown on as `QuoteError`, and `bookOnline()` and `bookAsStaff()` do not catch it. No booking in Phase 2 carries a credit (a credit comes from a swap); Phase 3 must decide what the customer is told.
- `customer_id` on a redemption has no foreign key: there is no customers table yet.
- `booking_id` on a redemption is `reservations.booking_id`; Phase 3's order takes it over. An order with no reservation rows (items for sale only) keeps its use until it is given back by whatever cancels an order.
- A booking cancelled in part keeps the coupon and its stored amount; re-pricing what is left is the order's job.
- The plan's Phase 3 notes from stage 7 stand ("every Nth period free"; an extension judged on the rental's own pickup and length).

**Known issues and follow-ups**

- **The lock-timing tests are sensitive to load**, as stage 3's and stage 5's are. Run the database suite on its own.
- A race test shows a race is closed for the timings it hit.
- `docs/platform/SPEC.md`'s data model does not have the three tables or the settings columns (plan §12).

**Before this goes to staging** (the owner's word each time, plan Q17): nothing to count first. The migration adds three empty tables, three nullable-or-defaulted columns on `pricing_settings`, six new functions, and re-creates seven. Staging must be at 65 of 65 with `main`'s bodies; **the guard checks exactly that and stops with nothing changed if one differs.** Afterwards: the three tables are empty; every `pricing_settings` row reads `returning_enabled = false`, `returning_percent_bp` empty, `returning_rentals_needed = 1`; `reserve()`, `cancel_reservation()` and `save_coupon()` read `lock_timeout=6s`; `save_coupon()` can be executed by `authenticated` only; counts of products, units, blocks, reservations, pricing rows and audit rows are unchanged; `currency_locked()` answers as before for every shop.

**Local set-up.** This worktree has its own stack, `Bike_Booking_phase2_s8` on ports 6232x, started with CI's service list. `supabase/config.toml`'s change is local only (`git update-index --skip-worktree`), and `apps/platform/.env.local` names the same stack. The stacks of stage 5 and stage 6 were stopped (not removed); another project's stack was left alone.

**Next:** stage 9, coupons on screens: Settings › Coupons, the returning-customer card, "Check a price" with a code (and with extras, carried from stage 6). **Done: see stage 9, below.**

## Phase 2, stage 9: coupons on screens (branch `platform/phase-2-stage-9-coupon-screens`, 18 Nov 2026)

The ninth build stage of Phase 2, of eleven (`docs/phase-2-plan.md` §5.3, §6, §7, §8). From `main` at `a7d68b5` (PR 48 merged, its migration on staging 66/66). **No migration**: screens, `apps/platform/lib`, messages, tests and docs only. Nothing on staging or live was touched; nothing was pushed to a database but the local one.

**What was built**

- **Settings › Coupons** (`/[tenant]/settings/coupons`, `/new`, `/[id]`), a sixth Settings section. Owners and managers; staff, mechanics and drivers get "Page not found" (each page's first check is `requireArea(slug, "settings")`, held by `tests/settings-access.test.ts`), and the database refuses them anyway (`save_coupon()`).
  - **The list:** code, name, value ("15% off", "฿200 off"), status (On, Off, Archived) and uses: "Used 12 of 50", or "Used 12" with no limit. **Uses come from `coupon_inputs().uses.total`** (`lib/coupons-data.ts`' `getCouponUses()`, through `readCoupon()`), never from a count of `coupon_redemptions`. Each live coupon has Edit, Switch off or Switch on, and Archive (asked first). Archived coupons come last, newest first, with View only. New coupon at the top.
  - **The form, in the brief's order:** code; name (the shop's own note); percentage or fixed amount in the shop's currency and exponent; all or chosen products; valid from and to (when the booking is made); pickup from and to; minimum days; minimum spend (its hint says it counts the coupon's own lines after seasonal prices); total uses; where it can be used (staff, booking page, Moto Mangos); "Can be combined with the returning-customer discount"; **"Can be used on season discounts"** (`with_season_discount`, on by default, hint: "Off: the coupon takes nothing off a rental that a season has already made cheaper.").
  - **The code** is shown as it will be stored ("Saved as SUMMER10") and said to be impossible as soon as it is typed (`codePreview()` uses `normalizeCouponCode` and `isCouponCode` from `@mango/core`, the database's own rule; a unit test runs stage 8's shared cases through it).
  - **Every refusal in words**, through `saveCoupon()` (`lib/coupon-save.ts`): `invalid_code` under the code box ("Use only the letters A to Z and the numbers 0 to 9, up to 40 of them (spaces are taken out). Thai letters and full-width characters (such as Ａ or ０) can't be used in a code."); `code_taken` names the clash (the live coupon with that code, by its name when it has one); `try_again` (40P01, 55P03, 57014) asks to save again; `only_owner_or_manager`, `invalid_coupon`, `coupon_not_found`, `product_not_found` over the form. The form's own checks come first (`lib/coupon-form.ts`), field by field.
  - **"Accept coupons" off:** a note at the top with a link to Settings › Pricing and tax; coupons can still be created and edited.
  - **History** on the list (the shop's coupons) and on each coupon's page, owners and managers: one action a line in the buttons' words ("Ann switched off SUMMER10", "Ann changed SUMMER10 from 10% off to ฿200 off", "Ann archived SUMMER10"), from the audit's row events and `coupon_change` (`lib/coupon-history.ts`). A new coupon's links are counted on its "created" line.
- **Settings › Pricing and tax:** a **Returning-customer discount** card (on or off, percentage, completed rentals needed, default 1), saved with the form's one Save through `save_pricing_settings()`. On with no percentage is refused on its box (`returningPercentRequired`, and the database's `returning_percent_required` maps to the same words). The "You will be able to create coupons in a later update" line is gone; the switch has a one-line hint instead.
- **Check a price** (`app/[tenant]/products/check-price.tsx`, moved out of the Pricing form so the New order screen can use it in stage 11):
  - **Extras** (carried from stage 6): for a vehicle, each extra offered with it that has a price, with a quantity and its included number; the breakdown has a line for each.
  - **A coupon code box** with Apply, and a **"Returning customer" tick** (its hint gives the shop's percentage and rentals needed, or says the discount is off).
  - The breakdown shows **each discount**: the returning-customer discount, then "Coupon CODE", each with what it took over every line.
  - **A note says what became of the code:** applied; refused, with the reason in words for every one of `decideDiscounts`' twelve reasons (naming the coupon's own dates, minimum days or spend where it has them); "not applied" for a coupon that would take ฿0; and when the two discounts don't stack, which one won and why ("the larger discount applies"), both ways round.
  - **Read-only:** the code is looked up with `coupon_inputs()` (`lookUpCoupon()`, a server action that reads and nothing else) and judged with `decideFor()` from `lib/coupons.ts`, the same path both booking paths use, on the staff channel. Nothing is reserved and no use is counted (a browser test reads the uses after).
- **Shared words for the booking refusals** a screen will show from stage 11 and Phase 3: `FormErrors.hold_expired` ("This hold has run out; make the booking again."), `coupon_not_valid` ("This coupon can't be used right now; send it again."), `coupon_used_up`; `bookingRefusalKey()` in `lib/coupon-words.ts`. No screen calls them yet.
- **Root `CLAUDE.md`:** "Saving a coupon" now says the caller answers `try_again` for `40P01`, `55P03` and `57014`.
- **English and Thai together:** 175 keys; every Thai line is on `docs/platform/thai-review-products.md` ("Phase 2, stage 9") for Korn.

**Decided here, not in the brief** (say if any should change)

1. **Extras in Check a price are built here.** The brief speaks of "the extras it already has", but stage 6 had carried them to stage 9; they were not there.
2. **Check a price is its own component** (`check-price.tsx`), so the New order screen can take it whole.
3. **A coupon needs at least one channel** (`couponNoChannels`). The database allows none, but such a coupon could never be used; a new coupon starts with none ticked (nothing is preset).
4. **An archived coupon is read-only, with "Bring back"** (save_coupon's `archived: false`); refused, with the clash named, while a live coupon has its code.
5. **Uses of an archived coupon whose code a newer coupon has taken are not shown** ("Uses: not shown (its code is used by a newer coupon)"). `coupon_inputs()` looks a coupon up by code, so it would answer with the newer coupon's count. A read by id needs a migration; suggested for stage 10.
6. **The returning-customer card is part of the Pricing and tax form** (one Save), not a form of its own. A percentage typed while the discount is off is kept.
7. **"Not combined unless it says so", the tie:** the note says the returning-customer discount "takes off at least as much" (Mark's stage 7 decision: on a tie, the returning discount).
8. **The coupon is judged on the staff channel** (`walk_in`) in Check a price: a coupon not ticked for staff is refused there ("can't be used by staff").
9. **"Today" for a coupon's valid dates is the moment Apply is pressed** (it was when the page opened until the review, item 5 below), on the shop's clock (the product's location is not known on the Pricing tab; the shop's time zone is used, as the sample rental already is).
10. **The coupons list makes one `coupon_inputs()` call per coupon.** Fine for tens of coupons; a list read with uses would need a migration.

**For Phase 3**

- **Add "Uses per customer" back to the coupon form** once both booking paths send a `customer_id`. It is left off now because nothing sends one, so a limit saved today would never be reached (stage 8's note). The column, `save_coupon()` and the count under the lock are built; the form never names `max_uses_per_customer`, so an existing value is left as it is.

**Tests**

- **Unit: 472 on the platform** (439 before), **656 in `@mango/core`**, **202 on the marketplace**. Typecheck and lint pass in every workspace, with no warnings; the money rule holds (Check a price only adds what `quote()` gave).
  - `lib/coupon-screens.test.ts` (new, 30): the form's every check, on its own box (Thai and full-width codes, a hyphen, 41 letters, 0% and 100.01%, ฿0, a yen decimal, dates in the wrong order, 0 and 1,001 days, 0 uses, no channel, no chosen product) and at its edges; the payload in THB and JPY, blanks as null, no `max_uses_per_customer`; a saved coupon back on the form and saved again unchanged; the code preview against stage 8's shared cases; every `save_coupon()` refusal placed and worded in both languages; the list's state and uses; every `decideDiscounts` reason and both "not applied" outcomes worded in both languages, with the coupon's own dates, days or minimum; the three booking refusals; every new string in both languages with the same placeholders, and no "later update" or "per customer" left; History lines from audit rows (created with its chosen products, switched off and on, the value, the uses, renamed, a new code, archived, brought back, every other setting); the returning-customer card (off to start, saved, refused, read back); **Check a price** with two helmets one included, a good code, the tick alone and with the shop's discount off, the coupon beating the returning discount, the returning discount beating a non-stacking coupon, a stacking coupon (both rows, returning first), a coupon that takes ฿0, and each of the twelve refusals with the price left as it was.
  - `tests/settings-access.test.ts`: the three coupon pages each start with `requireArea(slug, "settings")`; owners and managers get six sections.
  - `lib/pricing-settings.test.ts`: the draft and payload carry the three returning-customer settings.
- **Database: 654 of 654, on a freshly reset local database, the suite run on its own.** Unchanged in count: this stage adds no migration and no database test. **No lock-timing test failed in this run** (`tax-profile-in-use`, `reservations`, `product-listings`, `booking-rules` all passed).
- **Browser:** `e2e/coupons.spec.ts` (new), 375 px and 1280 px, **8 of 8**: create (a Thai code refused in words first, then a code typed in small letters with a space, shown and saved as stored), edit to a fixed ฿200 with 50 uses, the list's "Used 0 of 50", switch off and on, archive (asked first), the code used again by a new coupon, a third refused naming the code, "Bring back" refused while the new one has it, the History lines; the returning-customer card (on with no percentage refused, saved, read back) and the coupons-off note with its link; **Check a price** with a good code (its row, −฿280), the tick (the coupon wins: "the larger discount applies"), a ฿50 coupon against 10% (not applied, the returning row −฿140), a code refused as too short and an unknown one, and **no use counted** (read after); **staff** get "Page not found" on Settings › Coupons and the new-coupon form, with no form, no button and no Coupons section. Then the **full suite** on a freshly reset and seeded database, two workers: **168 tests, 160 passed, 7 skipped, 1 failed**: `products-stage-d6.spec.ts`' "a season…" on the phone, where the pickup was typed before the page had started and the price was read without the season. It passed **6 of 6** run alone (3 rounds, both widths); that step now types again until the price agrees, as the file's other Check a price steps already do. `products-stage-d6.spec.ts` expects six Settings sections; `e2e/shop-settings.ts` puts the returning-customer settings back too.
- **Checked by eye** at 375 px and 1280 px (screenshots in the PR report): the coupon list, the form, Check a price with a coupon applied over the returning-customer discount. No sideways scroll on any coupon screen (asserted in the spec).

**Known issues and follow-ups**

- The flaky lock-timing tests stay on the stage 10 list (none failed in this stage's database run; `tax-profile-in-use.test.ts` and the held-lock tests in `reservations`, `product-listings` and `booking-rules` are still load-sensitive).
- The Thai lines need Korn's check.

**After the review of PR 50** (18 Nov 2026, an independent review at `36a67b3`: no blockers). All fixed in this PR; no migration.

1. **Check a price could show a price that did not match its boxes.** Typed into before the page's scripts had started, a box kept (or lost) the text while the price was worked out from the defaults. **Fixed by keeping every box of Check a price disabled until the component has started** (`useSyncExternalStore`: false in the server's HTML and while the page starts, true once it runs), rather than reading the boxes into state on mount: it covers every input (the two radios, pickup, days or return, how many, each extra, the code, Apply and the tick) with one rule, and nothing can be typed that the price does not see. A browser test holds the page's scripts back 4 seconds, types Days and Pickup at once, and checks the boxes and the price agree (1 day from 1 Apr in a 20% season: 300 − 60 = 240). **With the fix switched off it fails at both widths** (in that run hydration put Days back to 7, so the typed value was lost; the reviewer's run kept the box at 1 with the 7-day price; the test checks both the box and the price). The retry-until-right loops are gone from `products-stage-d6.spec.ts` (both of them) and `coupons.spec.ts`.
2. **The coupon form's numbers have one rule** (`parseCouponAmount`, `parseCouponPercent` in `lib/coupon-form.ts`): a dot is the decimal point; a comma only between thousands in groups of three with digits on both sides ("1,234.56", "50,000"); "2,50", "12,5", spaces, underscores, a minus sign and any other comma are refused, with words that say to use a dot for decimals (`couponInvalidAmount`, `couponInvalidPercent`). Amount off, Minimum spend and Percentage off. `lib/seasons.ts` and `lib/money.ts`' `parseMinorUnits` are not changed (stage 10, below).
3. **More tests:** the form in KWD (0.005 saves as 5 and shows as 0.005; 1,000.250) and VND (whole dong; 50,000); commas, spaces, underscores, a negative and 19 digits; Check a price in the browser with two boats and five helmets, two included with each (4 included, 1 charged, 650 in all) and the shop's "every vehicle" row overridden by the boat's own (the lock keeps the shop's one each); a New York shop's coupon valid dates across both 2027 clock changes (unit); mechanics and drivers by address on the coupon list, the new form, a coupon's page and Pricing and tax, and staff on a coupon's page, each "Page not found"; **"Bring back" racing two creates of the same code** (`tests/db/coupon-screens.test.ts`, 10 rounds through `saveCoupon()`): one wins, the others are `code_taken`, one live coupon has the code (both sides won rounds: bring back 7, a create 3).
4. **Enter in "Find a product"** no longer sends the form, on the coupon form and the season form (the phone keyboard shows Search).
5. **"Today" for a coupon's valid dates is the moment Apply is pressed** (judged on the shop's clock by `decideDiscounts`), not when the page opened.
6. **An amount over 18 digits** (Amount off, Minimum spend) is refused on its box: "That amount is too long: 18 digits at most."
7. **History reads the newest 2,000 audit rows**, newest first; a coupon whose "created" row is older than those is named by its code now.

**Review tests**

- **Typecheck and lint** clean in every workspace, no warnings.
- **Unit: 480 on the platform** (472 before the review), **656 in `@mango/core`**, **202 on the marketplace**. `lib/coupon-screens.test.ts` is 38 (number rule, KWD, VND, 18 digits, New York clock changes).
- **Database: 654 of 655 on a freshly reset local database, the suite run on its own** (654 before; +1, `tests/db/coupon-screens.test.ts`). The one failure was `availability.test.ts`' "a downtime written on the unit it picked, not yet saved…", a held-lock test that timed out at 90 s, the load-sensitive kind already on the stage 10 list; this PR does not touch it, and the file passes alone, **78 of 78**.
- **Browser: the full suite on that database, seeded, 375 px and 1280 px, two workers: 178 tests, 171 passed, 7 skipped, 0 failed.** `coupons.spec.ts` is now 14 (7 at each width): the delayed-scripts test, the extras test and the roles test are new. The d6 season step that failed once before the review passed with no retry.

**For stage 10** (from the review of PR 50; not built here)

- **A `coupon_inputs` read by coupon id that takes a list of ids in one call.** It replaces the one-call-per-coupon list (`lib/coupons-data.ts`' `getCouponUses()`) and fixes "Uses: not shown" on an archived coupon whose code was used again. A migration.
- **One number-input rule across seasons, price lists and coupons.** Today `lib/seasons.ts` reads a comma as a decimal point and `parseMinorUnits` (`lib/money.ts`) drops commas, spaces and underscores, so "2,50" is 2.5% on a season and 250 baht on a price list, where the coupon form refuses it. Bring them onto the coupon form's rule (and the returning-customer card's percentage, which still uses `parsePercentBp`).
- **The shared form** (`components/action-form.tsx`): put focus on the first error after a refused save, and tie each box's error to it with `aria-describedby`.

**For stage 11**

- **A channel picker in Check a price, or on the New order screen**, so a shop can try a booking-page-only or Moto Mangos-only coupon. Check a price judges every code on the staff channel.
- **Out-of-date screen text:** the gear create form still says 'Prices come in a later stage…' (`general-forms.tsx:195`, `Products.general.pricesLater`). Fix it in stage 11.

**Local set-up.** This worktree has its own stack, `Bike_Booking_phase2_s9` on ports 624xx, started with CI's service list; `supabase/config.toml`'s change is local only (`git update-index --skip-worktree`), and `apps/platform/.env.local` names the same stack.

**Next:** stage 10, review follow-ups (§3.8 and the items carried above).

## Products, stage D4: the pricing database (branch `platform/products-stage-d4-database`, 15 Nov 2026)

The fourth build stage of pricing, of seven (`docs/products-redesign.md` §9.2, "As built in stage D4"; decision 29). **The first with a migration.** Nothing on any screen changes in this stage. `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**On staging since 15 Nov 2026; not on live.** Staging records 59 of 59. Live stays at 53 of 53 and gets this with the five before it only from `main`, by the runbook.

- **Pushed** on the owner's instruction on 15 Nov 2026 at 09:34:08 UTC (16:34 in Bangkok), finished 09:34:14 UTC, from the PR's branch at `a4ba484` with `supabase db push --db-url`, once CI was green on every check. The dry run before it listed exactly one pending migration (`20261115000100`). The PR was merged straight after (`0046249`), as the owner had arranged, because `main`'s deployment reads the dropped deposit column until then.
- **Before and after, read-only:** 3 shops, 32 products, 205 vehicles and 3,243 audit rows, the same on both sides. Staging had no deposit on any product, so the move carried nothing and no shop got a settings row. After: the seven tables with RLS on and one policy each, read-only for a signed-in person and nothing for a signed-out one, the seven functions, and no deposit column on products.
- **The pages' own reads, run on staging as the demo owner and the demo mechanic** (read-only, rolled back): the shop, its 23 products, the product page's read for all 17 vehicles, the deposit, units and History for the owner; products and no pricing row for the mechanic.
- **Browser tests against staging.** They could not sign in at first: staging refused the demo password, which turned out to be recorded nowhere. The ten demo users were reset to `DEMO_PASSWORD` through the auth admin API, with no full re-seed (`docs/RUNBOOK-GO-LIVE-PLATFORM.md` › Staging has where the password comes from and what that means for the demo data). Then, on the PR's deploy preview, at 375 px and 1280 px: `foundations.spec.ts` (22), `products.spec.ts` (10) and `products-stage-d4.spec.ts` (2), 34 of 34 passed. On `mango-works-platform.netlify.app` after the merge, desktop width: `products-stage-d4.spec.ts` and `products.spec.ts`, 6 of 6 passed. The deposit round trip (typed, saved, reloaded, changed, in the History, cleared) is in those. None failed, so nothing had to be read as drift from the seed.
- **Left on staging by the tests, and put back:** the deposit test saved the demo shop BSR's first product deposit, which made BSR a settings row on "per product" (15 Nov 2026, 09:52 UTC); the test then removed the product. Before that BSR had no settings row, which is "none" (staging had none at all after the push). On the owner's instruction that one row was removed by hand on 15 Nov 2026 at 10:06 UTC, the only way back to "no row": setting it to "none" through the app would have left a row, and a shop with a row is not switched to "per product" by its first deposit. Staging again has no settings row, no pricing row and no deposit; the audit trail keeps the three events.
- **Not run against staging:** the rest of the browser suite (fleet, gear stock, lists, drag, scan, settings). CI ran all of it on a clean local database.

**What changed**

- **One new migration, `20261115000100_platform_product_pricing`.** No earlier migration is touched.
  - Seven tables: `pricing_settings`, `tax_profiles`, `price_templates`, `price_template_days`, `product_pricing`, `price_rules`, `price_rule_products`. RLS on; grants written on purpose (`service_role` too). Owners, managers and staff read; mechanics and drivers get no row; nobody signed in writes them directly.
  - The save functions, each checking the caller with `platform_private.pricing_roles()`: `save_pricing_settings`, `save_tax_profile`, `save_price_template`, `delete_price_template`, `save_product_pricing`, `save_price_rule`.
  - `platform.pricing_inputs()`: the one read that feeds `quote()`. It runs as the caller and does no arithmetic.
  - Ways of pricing per product type as a check; a list kept complete (30 days, never lower than the day before, equal allowed) whoever writes it; composite tenant keys on every parent; `updated_at` and audit.
  - **The deposit moved** from `products` to `product_pricing`; the two columns are dropped and `products_general_fields_check` is put back without them. A shop with deposits on products is set to "per product"; every other shop has no settings row ("none").
  - The currency lock (`tenants_lock_currency`, `currency_locked`) counts any pricing row, price list or settings row. The only two functions whose bodies named the deposit (found in the database, not by reading migrations).
- **`@mango/core`:** multipliers are millionths (six decimal places) where they were ten-thousandths.
- **The app, as little as possible:** the deposit is still typed on the vehicle form and now saved through `save_product_pricing` (`saveDeposit` in `app/[tenant]/fleet/actions.ts`); `lib/fleet-data.ts` reads it from `product_pricing`; the History reads a product's pricing rows as its own, saying only the deposit until the Pricing tab words the rest. New: `lib/pricing-inputs.ts` (the database's rows to `quote()`'s input), `lib/pricing-permissions.ts` (the app's copy of who may read and write prices), and `@mango/core` as a dependency of the platform app.
- **The guard against a second pricing path:** a lint rule in `apps/platform/eslint.config.mjs` refuses multiplying, dividing or taking a remainder of anything named as money; `lib/one-pricer.test.ts` tests the rule; a database test holds that no pricing function multiplies, divides or rounds; another prices real rows through `pricing_inputs`, the adapter and `quote()`.
- **Types regenerated** (`packages/db/src/database.types.ts`). `docs/platform/MAPPING.md`: the deposit and price-table targets.

**Decided here, not specified by the owner** (all in §9.2 "As built"; say if any should change)

- **A product's own prices are saved with the product** (`save_product_pricing` with `own_list`), not through `save_price_template`, which is for shared lists only. This is what keeps the lock order: the product's row, then the list's, then the pricing row.
- **The 30 days of a list and a season's product links are audited as one named event each** (`template_change`, `price_rule_change`), not row by row: the design said `audit_row` on all seven tables, which would write thirty rows for one save. The other five tables are audited row by row.
- **`rounding_step` may be empty** (not chosen yet). The migration can't know a currency's sensible step, and the root rules forbid a constant; the app suggests one when a shop first sets prices.
- **A shop's settings row is made on the first save**, and no row means no tax, no deposit and coupons off.
- **A list's kind can't be changed once made; a tax profile is archived, never deleted; a season can be switched off or deleted.**
- **Until the shop's settings have a screen (stage D6), a shop that enters its first product deposit is set to "per product"**, which is how every deposit worked before this stage. Without this, a deposit typed after the migration would do nothing until D6.
- **Creating a product with a deposit is two steps** (the product, then its pricing). If the second fails the product just made is taken back, so the form can be sent again.
- **The lint rule covers `apps/platform` only.** The marketplace keeps its whole-baht pricing until 3M.
- **A settings row alone locks a shop's currency**, since its rounding step and deposit amount are in that currency. So does a price list with no product on it.
- **This worktree has its own local database** (`Bike_Booking_stage_d4`, ports 5932x). The change to `supabase/config.toml` is local only (`git update-index --skip-worktree`), not committed.

**The data move, on a local copy** (reset to the migration before, three shops added by hand, then this migration): 7 products, 4 with a deposit (฿2,000 and ฿5,000 in THB; ¥0 and ¥9,007,199,254,740,993 in JPY), one shop with none. After: 4 pricing rows, each with the same amount and currency, no other row; the two shops with deposits on "per product", the third with no settings row; product and audit counts unchanged.

**Tests**

- Database: 342 on the platform, all passing locally (294 before; 47 new in `product-pricing.test.ts`, 1 new in `tenant-isolation.test.ts`). Four older tests were changed in how they reach the deposit (`fleet.test.ts`, `products.test.ts`, `products-stage-b.test.ts`, `tenant-isolation.test.ts`); what they assert is the same, except that "a general product stores no deposit" is now `deposit_vehicles_only` from the function and `product_pricing_deposit_vehicle_check` from the table. The isolation harness has a fixture row, a forged row and a change to try for each of the seven tables.
- `product-pricing.test.ts` holds: the role table (database and app compared); reads by role, by another shop, a stranger and a signed-out visitor; no direct writes, the owner included; every save function and what it refuses; ways of pricing per type, by the function and by the table; own and shared lists; six-decimal multipliers; equal neighbours allowed and a fall refused, by the function and by hand; the audit rows and named events with who did it; `pricing_inputs` by role, and a month priced through it at ฿3,000 with VAT ฿196.26; grants, RLS and search paths; no arithmetic in any pricing function; the currency lock; the lock order (a save waits for the product's row; while it is held no writer holds a lock on a pricing row or a list); five races (two saves of one list, twelve first saves of one product's pricing, a product moved to a list being deleted, twelve first saves of a shop's settings, a season saved while its product is deleted).
- Unit: 244 on the platform (228 before: `lib/pricing-inputs.test.ts`, 12; `lib/one-pricer.test.ts`, 4), 284 in `@mango/core`, 202 on the marketplace. All passing. Typecheck and lint pass for every workspace.
- Browser: `e2e/products-stage-d4.spec.ts` (a vehicle's deposit typed, kept, in the History, cleared), at 375 px and 1280 px. It and the two older product specs (`products.spec.ts`, `products-stage-b.spec.ts`) pass locally run one at a time: 15 passed, 1 skipped as on `main`. Run in parallel on this machine, beside five other local database stacks, seven timed out on page loads; none did one at a time. The rest of the browser suite was left to CI.

**For Phase 3, noted:** an invoice must keep its own copy of each rate, profile name and tax style it was worked out with; `pricing_inputs` gives today's.

**Next:** D5, the Pricing tab: the tab, "Check a price", the Products list's price column, History lines and the Thai review list. The deposit field moves there from the vehicle form.

## Products, stage D5: the Pricing tab (branch `platform/products-stage-d5-pricing-tab`, 15 Nov 2026)

The fifth build stage of pricing, of seven (`docs/products-redesign.md` §9.12, §9.15). **No migration**: everything reads and writes through stage D4's functions. `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **A Pricing tab on every product page**, after Units or Stock and before Moto Mangos. Owners and managers edit; staff see the same, read only; mechanics and drivers have no tab (and the database gives them no row).
  - **How it is priced:** only the ways the product's type allows (vehicles: by rental length or flat fee; rental gear: also fixed; services and extras: flat fee, fixed or free; items for sale: fixed).
  - **Flat fee:** one amount per hour, day, week or month. **Fixed price**, **Free**.
  - **By rental length:** this product's own prices (six quick-entry boxes: hourly, daily, weekly, 2 weeks, 3 weeks, monthly; days 1 to 30 fill in equal steps to the rounding step; every day editable by hand, with Reset; "Same price every day"), or a shared price list (a multipliers list asks for this product's base price and shows the resulting amounts). A total lower than the day before is named on the day, in words, and Save waits; equal neighbours save.
  - **Long-stay daily rate** for rentals of 31 days or more.
  - **Deposit**, moved here from the vehicle form (vehicles only). **Tax** (shop default, another profile, or not taxable; hidden while the shop has no profile). **Replacement value** (gear). **Seasons** that apply, read only.
  - **Check a price:** a sample rental by number of days or by dates, and a quantity, priced by `quote()` from what is on screen, saved or not: list price and how it was worked out, seasons, VAT lines, total, deposit.
- **Price lists** (Products › Price lists): the shop's shared lists with the products on each; New price list (Amounts or Multipliers of a base price, chosen once), edit, delete. Delete is refused while a product uses the list (`price_list_in_use`), in words. Saving a list that products use asks first and names them. A multipliers list shows its amounts at a sample base price.
- **The Products list** shows each product's price beside its stock line ("฿300 / day", "฿200 / week", "฿150", "Free", "No price yet") for owners, managers and staff.
- **The Moto Mangos tab** says when a listed motorbike has no price by rental length ("it won't be offered on Moto Mangos"; open item 9 (a)).
- **History:** one line per price change in the field's words (first price, a box, a day, the hourly price, a flat fee, how it is priced, a shared list moved to or edited, base price, long-stay rate, deposit, tax, replacement value).
- **No money arithmetic in the app.** Lists are filled by `fillPriceList`, multipliers resolved by `resolvePriceList`, prices by `quote()`; the app only parses and formats amounts as digits (`lib/money.ts`). The one-pricer lint rule passes. Saves go through `save_product_pricing`, `save_price_template` and `delete_price_template` only.
- New: `lib/pricing-form.ts`, `lib/pricing-preview.ts`, `lib/pricing-history.ts`, `lib/pricing-data.ts`; `app/[tenant]/products/pricing-*.tsx`, `price-list-form.tsx`, `price-lists/`. About 220 new Thai lines in `docs/platform/thai-review-products.md` for Korn.

**Decided here, not specified by the owner** (say if any should change)

- **Price lists live under Products for now** (`/products/price-lists`), linked from the Products list and the Pricing tab. Stage D6 can move them under Settings. Staff read them.
- **One Save for the whole tab.** "Check a price" sits outside it and prices the unsaved form.
- **The rounding step when the shop has none:** ฿10 for THB (the design's figure), one major unit for any other currency. Multipliers fill to four decimal places.
- **Editor-only details are read straight from the tables** (under the same row-level security): how each day of a list got its value, which tax choice a product has, the shop's lists and profiles. Prices themselves come from `pricing_inputs()`. That read did not need to change, so no migration.
- **A day with a quick-entry price is read only in the grid** (change it in its box). Typing in a box replaces a hand-typed value on the same day. Reading a list back, daily and monthly are always boxes, so a list loaded with every day by hand keeps every day.
- **The deposit card** shows on a vehicle while the shop has no settings or charges per product: blank is the shop's amount, 0 is no deposit for this one. Any other shop choice is one line saying what the shop charges. A shop's first product deposit still sets it to "per product" (as in D4) until Settings exist.
- **Replacement value for gear** is on the tab now (open item 7, as recommended).
- **History:** a day's "by hand" cannot be told from the audit (it keeps values, not how each was set), so a single day changed reads "changed the 10-day price", without "(by hand)". Box prices are told by their day (1, 7, 14, 21, 30). A shared list's hourly price and name changes are not on each product's History. A change of how it is priced names the way, not the period.
- **The price is on each row's second line**, after the stock ("3 vehicles in the fleet · ฿300 / day"), not a column of its own: the row layout has no room for one at 375 px.
- **Duplicate no longer copies the deposit:** prices are not copied with a product.
- **The sample rental** starts tomorrow at 10:00 on the shop's clock, 7 days, quantity 1, in the shop's time zone (not a location's: the tab has no location).
- **A staff member on a service** sees only its Pricing tab.

**Tests**

- Unit: 286 on the platform (244 before; new `lib/pricing-form.test.ts` 26, `lib/pricing-preview.test.ts` 8, `lib/pricing-history.test.ts` 8), 284 in `@mango/core`, 202 on the marketplace. Typecheck and lint pass for every workspace.
- The preview's figures pinned through `quote()`: a month and 14 days from 1 Jan at ฿3,000 and ฿100 a long-stay day = ฿4,400; 14 days = the list's two-week price; a month = ฿3,000 with VAT ฿196.26; 3 of 7 days in a −20% season off a ฿200 daily fee = ฿160 off; a multipliers list at a ฿100 base.
- Browser: `e2e/products-stage-d5.spec.ts` replaces `products-stage-d4.spec.ts` (the deposit left the vehicle form): own prices entered, the fall refused and reset, equal neighbours, Check a price, saved, reloaded, History, the price on the list, the deposit cleared; a flat fee and the role check (staff read only, mechanic and driver no tab); a shared multipliers list made, used with a base price, delete refused while used, then deleted; the ways offered for a service and an item for sale, 0 refused; Thai at 375 px. 9 passed and 1 skipped (Thai is phone only), at 375 px and 1280 px, against a production build on the local database.
- Older specs updated for the new tab and the price on the list (`products`, `products-stage-b`, `products-stage-c`, `gear-stock`, `fleet`): all pass run one file at a time, except `fleet.spec.ts`'s search for "pcx", which fails locally because this machine's shared database holds leftover "PCX copy" products from earlier interrupted runs. CI starts from a clean database.
- No database tests changed: nothing in the database changed.
- **Not run against staging.** Note for when it is: the deposit test saves BSR's first product deposit, which gives BSR a settings row on "per product", as the D4 test did.

**Review fixes (15 Nov 2026, after the review of PR 29).** No migration.

- **Check a price and a shop with no settings row.** The CI failure at `products-stage-d5.spec.ts:146` was not a clock or a pricing fault: ฿9,000 was the right total (2 × (฿3,000 + 15 × ฿100) for 45 days from 16 Nov). The test's "4,000" was the deposit line, 2 × ฿2,000, which only showed on a database where BSR already had a settings row; on a clean one the preview said ฿0, although saving the first product deposit sets the shop to "per product". The preview now prices the sample the way Save will (`previewInputs` in `lib/pricing-preview.ts`).
- **The D5 browser test no longer depends on the date or on what an earlier run left.** Every "Check a price" gets a fixed pickup (1 Jan 2027, 10:00), so 45 days is always a month and 14 days; the Total (฿8,800 for two) and the Deposit (฿4,000) are each read from their own row.
- **A saved list reads as it is stored.** The days that were filled in used to be thrown away on load and filled in again with the rounding step of the day, so after a change of step the grid and Check a price would have shown amounts that are not the ones stored and charged, and any Save would have rewritten the list (on a shared list, repricing every product on it). Now a list read back keeps each filled day's saved value (`ListDraft.stored`); only the days between the boxes on either side of a box the owner changes are filled in again (`withBox`). This holds for a product's own prices and for the shared-list editor.
- **A save that leaves the prices alone sends no days.** The deposit alone, or a shared list's new name, no longer rewrites the 30 rows (`sameAsSaved`; `save_product_pricing` and `save_price_template` already keep what is not sent).
- **Amounts read from the tables are strings of digits** (`value::text`, `hourly::text` in the query), as `pricing_inputs()` sends them, never JSON numbers. A shared list's days are read with their list (an embedded read), so the API's 1,000-row limit can't drop a day of the 34th list.
- **Local set-up.** In a worktree with its own local stack, `supabase/config.toml` (project and ports) and `apps/platform/.env.local` must name the same stack: the database tests reach the database through the container named in `config.toml`, the app through `.env.local`. In this worktree they did not, which is why the database tests failed here and the browser run used a database with leftovers. `fleet.spec.ts`'s "pcx" search passes on a clean database.

- **Tests after the fixes:** 297 unit tests on the platform (11 new), 284 in `@mango/core`, 202 on the marketplace; 342 database tests; the full browser suite on a freshly reset and seeded local database: 119 passed, 5 skipped (each runs at one width only), none failed. A new browser test saves a list in the Saigon demo shop (dong, no decimals), changes the shop's rounding step in the database, and checks that the grid, Check a price and a save of the deposit alone all keep the stored days.

**Follow-ups from the review (not done here)**

1. **One table of per-currency defaults** in place of the two `currency === "THB"` checks (`lib/pricing-form.ts` `suggestedStep`: ฿10; `price-list-form.tsx`: the sample base price of 100). The figures are the design's; a currency check in code is against "Built for any country".
2. **`parseBase` in `pricing-form.tsx` is a second money parser** with other rules than `parseMinorUnits` ("1 000" saves, but hides the resulting amounts). Use `parseMinorUnits`. Guard the server action's reading of the form: a hand-made draft (a day 31 typed by hand, no `list`) throws instead of returning a form error.
3. **"A shop's first product deposit sets it to per product" is a second call** (`save_pricing_settings`) after the prices are saved. If it fails, the form shows an error although the prices were saved. One transaction, or say what was saved. Stage D6's Settings screen may remove the need.
4. Nits:
   - a season's amount is negated in the component to show "−" (`pricing-form.tsx`, Check a price): the pricer could return the sign and the size;
   - a season's dates show as ISO text ("2027-04-01"), not in the viewer's format;
   - `formatMinor` passes a decimal string to `Intl.NumberFormat.format` through a cast: fine on Node 24 and today's browsers, worth a line on the oldest browser supported;
   - after a save, "Check a price" can still say "saved or not" when what was typed ("300") differs from what is read back ("300.00");
   - the products on shared lists (`getSharedLists`) are read in one query, so past 1,000 priced products the names under a list would be cut short (the prices would not);
   - History reads `product_pricing` amounts from the audit rows as JSON numbers (exact below 2^53);
   - no browser test opens a duplicate's Pricing tab to show it starts empty;
   - the shared-list editor's "reads as stored" is covered by unit tests only; the browser test uses a product's own list.

All of these are closed: 1 to 3 and the first two nits in stage D6, the rest in "Pricing follow-ups before Phase 2" below (16 Nov 2026).

**Next:** D6, Settings: pricing and tax (rounding step, tax profiles and the default, include or exclude tax, the deposit choice, the coupons switch) and Seasons; perhaps the price lists screen moved under it.

## Products, stage D6: Settings (branch `platform/products-stage-d6-settings`, 15 Nov 2026)

The sixth build stage of pricing, of seven (`docs/products-redesign.md` §9.12, §9.15, and "As built in stage D6" there). **One migration**, reviewed by Fable before it was written. On staging since 16 Nov 2026 (60 of 60); not on live, which stays at 53 of 53 (see "On staging" below). `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **Settings has four sections**, owners and managers only (a sub-nav on every Settings page): Shop (as before), **Pricing and tax**, **Seasons**, **Price lists**.
- **Pricing and tax** (`/settings/pricing`): the rounding step (blank uses the currency's default; saved prices never change), "Our prices include tax" or "Tax is added on top", the default tax profile, the deposit choice (No deposit, a percentage of the order, a fixed amount per order, per vehicle with an optional shop amount) and "Accept coupons" with its "later update" line. One Save, through `save_pricing_settings`. Opening the page writes nothing; the first Save makes the shop's settings row and, because any row fixes the currency, the page says so and asks first.
- **Tax profiles** on the same page: add, change name or rate (a rate change on a profile in use names the products it reprices and asks first), remove from use, bring back. Removing a profile a product uses is refused, and the error names the products (retired ones included) so the owner can move them. One tap adds "VAT 7%" as the default in Thailand. All through `save_tax_profile` (and `save_pricing_settings` for the default).
- **Seasons** (`/settings/seasons`): the list with dates in the viewer's format, "every year", Increase or Decrease and a percentage, all products or chosen ones (searchable), on or off, delete. Through `save_price_rule`.
- **Price lists moved** from `/products/price-lists` to `/settings/price-lists` (Mark, 15 Nov 2026). The old addresses redirect (`next.config.ts`). Staff no longer open them; the Products list's and the Pricing tab's links show for owners and managers only.
- **The deposit is the shop's choice.** The automatic switch to "per product" on a shop's first product deposit is gone (the second `save_pricing_settings` call, the deposit field for a shop with no settings row, `previewInputs` and its test, the "first deposit" help). A vehicle's own deposit is asked only on "per vehicle"; on another choice it is kept, not charged, and shows again on a switch back (Mark). The Pricing tab's deposit card then says what the shop charges, with "Change in Settings". Check a price reads the same choice Save does; unit tests cover all four modes.
- **Season lines in a product's History**, on each product a season covers (`lib/season-history.ts`): added (its change and dates), percentage changed, dates changed, renamed, switched off or on, removed. One save is read as one change.
- **One per-currency defaults table** in `@mango/core` (`currency.ts`): the rounding step and the sample base price. THB ฿10 and ฿100; any other currency one major unit and 10 (Mark). It replaces both `currency === "THB"` checks (D5 follow-up 1).
- **D5 follow-ups 2 and 4:** `parseBase` goes through `parseMinorUnits`; the pricing actions read a posted draft field by field (`readPricingDraft`, `readListDraft`) and answer a hand-made one with a form error instead of throwing; a season's amount is shown from the pricer's direction and size (`adjustmentParts` in `@mango/core/season`), its dates in the viewer's format. Follow-up 3 (the second call) is gone with the automatic switch.
- **The migration, `20261115000200_platform_tax_profile_in_use`**, replaces three functions of D4, each a minimal change of its body, same signatures, grants restated: `save_tax_profile` takes the profile for update, then refuses to archive it (only when it goes from not archived to archived) while any `product_pricing` row names it (`tax_profile_in_use`) or it is the shop's default; it locks no settings or pricing row. `save_product_pricing` takes the profile it names for share after the price list and before the pricing row. `save_pricing_settings` takes the default it names for share after the settings row. A rename of an archived profile and a rate change still work.
- About 130 new Thai lines in `docs/platform/thai-review-products.md` for Korn, with one term to settle (ประเภทภาษี here, รายการภาษี in two D5 lines).

**Decided here, not specified by the owner** (say if any should change)

- **Settings › Pricing and tax is one form with one Save**, and tax profiles are separate small forms beside it, each saving on its own.
- **A blank rounding step is saved as "not chosen"** (null), not as the currency's default, so a later change to the per-currency table reaches the shop.
- **"Per vehicle"** is the screen's word for "per product" (only vehicles carry a deposit). The shop's amount for a vehicle with none of its own is optional; blank is none.
- **A percentage deposit** goes from 0.01% to 1,000% (the database's range); a fixed amount per order must be above 0.
- **A season names chosen products from the whole list**, retired ones shown only when already chosen. A season with chosen products must name at least one.
- **The one-tap profile is stored as "VAT 7%" in every language**: it is the shop's data, which the owner can rename. It is made the default at once; if that second save fails, the page says the profile was added but not made the default.
- **Season lines on History read every season of the shop** (the audit rows of `price_rules`, up to 1,000), since a season for all products names none.
- **Pricing tab cards are named regions** (for screen readers, and so tests can find "Seasons").
- **The rounding-step browser test of PR 29 moved** to `products-stage-d6.spec.ts`, in BSR instead of Saigon (no settings row may be made there), and changes the step on the Settings screen instead of in the database. It asserts the same: a saved list reads as stored after the step changes, Check a price charges the stored amount, a save that leaves the list alone (now the long-stay rate, since the deposit needs "per vehicle") rewrites no day, and a box changed refills only the days around it.
- **Browser tests that change BSR's settings, or read a total that depends on them, take turns** (a lock file across workers and both widths, `e2e/shop-settings.ts`) and put every setting back through `save_pricing_settings` as the owner, pass or fail.

**For later stages (Mark, 15 Nov 2026)**

1. **Phase 2: every order line keeps a snapshot** of the tax rate, the tax profile's name and id, whether prices included tax, the tax amount, the list price, each season adjustment, the discounts, the deposit and the currency. An order never reads a profile again: a later change of rate, name or tax style, or a removed profile, never alters an order.
2. **D7: the import names only tax profiles that are not archived**, and a check query after the load proves it (the load does not go through `save_product_pricing`, so nothing else stops it). The import sets BSR's deposit choice explicitly.
3. **Open: the currency lock on any settings row.** Any `pricing_settings` row fixes a shop's currency (D4; Mark keeps it). Revisit before self-serve sign-up, when a new shop may open Settings before it has chosen its currency for good.

**Read-only check before any push to staging, and later to live.** Rows that name an archived tax profile, defaults that name one, and shops with a product deposit but no settings row. Any count above zero: stop and tell Mark. No backfill is written.

```sql
select
  (select count(*) from platform.product_pricing pp
     join platform.tax_profiles tp on tp.id = pp.tax_profile_id
   where tp.archived_at is not null) as pricing_rows_on_archived_profile,
  (select count(*) from platform.pricing_settings s
     join platform.tax_profiles tp on tp.id = s.default_tax_profile_id
   where tp.archived_at is not null) as defaults_on_archived_profile,
  (select count(distinct pp.tenant_id) from platform.product_pricing pp
   where pp.deposit is not null
     and not exists (select 1 from platform.pricing_settings s where s.tenant_id = pp.tenant_id)
  ) as shops_with_deposit_but_no_settings;
```

| Database | When | pricing rows on archived | defaults on archived | shops with a deposit, no settings |
| --- | --- | --- | --- | --- |
| Local, this worktree (reset and seeded) | 15 Nov 2026, before the browser run | 0 | 0 | 0 |
| Local, this worktree | 15 Nov 2026, after the full browser run | 0 | 0 | 0 |
| Staging | 16 Nov 2026, before the push | 0 | 0 | 0 |
| Staging | 16 Nov 2026, after the push and the D6 browser run | 0 | 0 | 0 |
| Live | Not run: D4 to D6 are not on live | | | |

**Tests**

- Unit: 332 on the platform (297 before; new `lib/pricing-settings.test.ts` 9, `lib/seasons.test.ts` 13, `lib/season-history.test.ts` 7, and in `pricing-form.test.ts` the draft readers and the per-currency step; `pricing-preview.test.ts` loses `previewInputs` and gains the four deposit modes), 290 in `@mango/core` (284 before; `currency.test.ts`, `adjustmentParts`), 202 on the marketplace. Typecheck and lint pass for every workspace; the one-pricer lint rule passes.
- Database: 353 on the platform, all passing on a freshly reset and seeded local database (342 before; 11 new in `tax-profile-in-use.test.ts`: the refusal, retired products counted, a rename and a rate change while in use, renaming an archived profile still named, the default still refused, both orders of archive against a product save, both orders against set-default, the lock order of a waiting product save, the archive locking no settings or pricing row, and grants). In `product-pricing.test.ts` only the header comment and the lock-order block's title changed; its tests pass unchanged.
- Browser: `e2e/products-stage-d6.spec.ts` (7 tests: Settings sections and access, old price-list address, deposit modes, tax profiles, rounding step, a season, the first-save warning, Thai), at 375 px and 1280 px. The full suite on a freshly reset and seeded local database: 136 tests, 122 passed, 7 skipped (each runs at one width only), 7 failed on page loads that timed out (in `drag-reorder`, `products-stage-b`, `products-stage-c` and `fleet`'s stickers, none of them touched by this stage); those 7, run again on their own with two workers, all passed. This machine runs about 40 other local database containers; D5 saw the same timeouts. CI runs the suite on a clean database.
- Read-only counts after the browser run, locally: 0, 0, 0. What the run left: BSR has a settings row on the defaults and the archived "E2E VAT" profile; Saigon and big-fleet have no settings row.

**Local set-up.** This worktree has its own stack, `Bike_Booking_stage_d6` on ports 6032x; `supabase/config.toml`'s change is local only (`git update-index --skip-worktree`), and `apps/platform/.env.local` names the same stack.

**On staging since 16 Nov 2026; not on live.** Staging records 60 of 60. Live stays at 53 of 53 and gets this with the six before it only from `main`, by the runbook.

- **Read-only counts first**, in a read-only transaction on staging (`mango-works-staging`, `qafhmdxsodeqkeznafaq`): pricing rows that name an archived tax profile 0, defaults that name one 0, shops with a product deposit but no settings row 0. Staging then had no settings row, no tax profile and no pricing row at all, and 59 migrations on record (newest `20261115000100`).
- **Pushed** on the owner's instruction on 16 Nov 2026 at 00:15 UTC (07:15 in Bangkok), from `main` at `1146bb1` (PR 30 merged), with `supabase db push --db-url`. The dry run before it listed exactly one pending migration, `20261115000200_platform_tax_profile_in_use.sql`.
- **After, read-only:** staging records 60 migrations, newest `20261115000200`. The three functions are the new ones (`save_tax_profile` holds the `tax_profile_in_use` refusal; `save_product_pricing` and `save_pricing_settings` take the profile for share), each still security definer, open to a signed-in member and closed to a signed-out visitor.
- **Live was only read** (the CLI's migration list for the linked project, `mfaqydyoweerlqsgwnay`): 53 migrations, newest `20261112100000`; `20261115000200` is not there.
- **Browser tests against staging**, `products-stage-d6.spec.ts` on `https://mango-works-platform.netlify.app` (main's deployment, with stage D6): 11 passed, 3 skipped, none failed, in 8.1 minutes. Skipped: the Thai check at desktop width and the first-save warning at phone width (each runs at one width), and **the first-save warning at desktop width too**, because on staging the big-fleet shop's currency is already fixed, so the note it looks for is not shown. That warning is therefore checked by CI's clean database only, not on staging.
- **BSR's settings were put back.** After the run BSR has one settings row on the defaults: rounding step not chosen, prices include tax, no default profile, no deposit, coupons off. It had no row before; since stage D6 a row on the defaults works exactly like no row. Also left, as the runbook says: one archived tax profile in BSR, "E2E VAT" (7%). Nothing else: no test product, no pricing row, no price list and no season remain, and Saigon and big-fleet have no settings row. The three counts are 0, 0, 0 again.
- **Signing in to staging:** the main checkout's `apps/platform/.env.local` holds two `DEMO_PASSWORD` lines. Staging takes the first; a run that used the second was refused at the login page (one read-only test, nothing written). The API client in `e2e/shop-settings.ts` also needs staging's own `NEXT_PUBLIC_SUPABASE_URL` and anon key in the environment for a run against staging; `.env.local` has the URL (`STAGING_SUPABASE_URL`) but not the anon key, which was read from the project's API keys for this run and written nowhere.
- **Not run against staging:** the rest of the browser suite, the D5 spec included. CI ran all of it on a clean local database.

**Next:** D7, BSR's four lists, once Mark has supplied the amounts, base prices and the list for each product (with the tax-profile check and the explicit deposit choice above).

## Products, stage D7: BSR's price lists and test prices, on staging (branch `platform/products-stage-d7-bsr-test-prices`, 16 Nov 2026)

The seventh and last build stage of pricing (`docs/products-redesign.md` §9.11). **No migration.** A script, `apps/platform/scripts/load-bsr-pricing.mts`, and data on **staging only** (`mango-works-staging`, `qafhmdxsodeqkeznafaq`). Live was not touched and stays at 53 of 53.

**10 of the 25 scooters are priced.** The other 15 are not on staging and were skipped on Mark's instruction; none was created. **A load on live must look for those 15** (listed below).

**Before the load**

- **Staging: 60 of 60 migrations**, newest `20261115000200_platform_tax_profile_in_use`, every one matching the repo (the CLI's migration list against `STAGING_DB_URL`).
- **`.env.local` fixes** (values written nowhere):
  - The main checkout's `apps/platform/.env.local` had two `DEMO_PASSWORD` lines. Each was tried against staging as BSR's demo owner: the first signs in, the second is refused. The second line was removed; the sign-in works with what is left.
  - `STAGING_ANON_KEY` was added to the same file, read from the staging project's API keys. It is a public key, and still not committed; `.env.example` names the variable.
  - **Every checkout was checked.** Five others held the same two lines (`drag-reorder`, `gear-stock-rework`, `lists-mobile-polish`, `products-stage-a`, and the `Bike Booking-ui-refresh` folder). On Mark's instruction the stale second line was removed from each, and nothing else in them was changed; the line left is the same as the main checkout's. `products-stage-c-db` and `products-stage-c-tab` have one line, the right one. `products-stage-d4`, `-d5` and `-d6` have one line with another value and no staging variables (their own local stacks).

**What the script does** (`npm run load:bsr-pricing -w @mango/platform`, reads only; `-- --load` to write)

- Signs in as BSR's demo owner with the anon key and writes only through `save_price_template`, `save_product_pricing` and `save_pricing_settings`. No service key and no table write.
- Its target is `STAGING_SUPABASE_URL` and `STAGING_ANON_KEY`, nothing else; it refuses the live project's address and a local one.
- **Safe to run again:** a shared list is found by its exact name and updated; a product's pricing is saved over itself. Run four times on 16 Nov 2026: the first made the four lists, the later ones updated them, and staging still has four.
- Products are matched by name (case and outer spaces ignored), never created. Where BSR's product on staging has another name than Mark's, the script holds the mapping (`productNames`), so a re-run matches the same products. The 15 skipped scooters are named in the script too (`notOnStaging`): a scooter with no product that is not one of them fails the checks.
- No arithmetic on money: every figure is written out in the script as Mark gave it, turned into minor units by `parseMinorUnits`, and priced by `quote()`.

**Loaded on staging, 16 Nov 2026**

- **Four shared price lists in BSR, kind Amounts**, named "300–3000", "350–3500", "400–4000" and "500–5400": days 1 to 30 in THB from Booqable at a base price of 100, every day stored as loaded (`manual`), equal neighbours kept (days 28 and 29 of 300–3000; days 21 and 22 of 350–3500), no hourly price.
- **Long-stay daily rate** (31 days or more), per product, as Mark wrote them: 300–3000 → ฿100.00, 350–3500 → ฿116.67, 400–4000 → ฿133.33, 500–5400 → ฿180.00.
- **Deposit ฿2,000** on each scooter.
- **BSR's settings:** deposit "per vehicle" (`per_product`) and prices include tax, set explicitly. The rounding step (not chosen), the default tax profile (none) and the tax profiles were not sent and are as they were. No product was given a tax profile.
- **Not touched:** BSR's bigger bikes (CB300R, CB500X, CRF300L, Forza 350, NX500, Z250, Hunter 350, WR155, GTS300); Mark prices those by hand. Saigon and big-fleet.

**These are test prices.** The four lists are BSR's real ones; which scooter is on which is round-robin in the order of Mark's list, whether or not the product exists yet:

| List | Scooters, by position in the list of 25 |
| --- | --- |
| 300–3000 | Benelli Leoncino 250, **Honda ADV160**, **Honda Giorno**, **Honda Spacy**, **Yamaha Aerox**, Yamaha GT, Kawasaki Z250SL |
| 350–3500 | Benelli TNT135, Honda Click 125, Honda Lead, Honda Zoomer-X, **Yamaha Fino**, Yamaha Mio 115 |
| 400–4000 | **Fazzio**, Honda Click 150, **Honda PCX**, **Yamaha Nmax**, Yamaha Freego, Yamaha Qbix |
| 500–5400 | GPX 250, **Honda Click 160**, **Honda Scoopy**, Ryuka Infinity 250, Yamaha Grand Filano, Yamaha TTX |

In bold: the ten that are priced on staging.

**Five are matched to a product with another name** (Mark, 16 Nov 2026), each keeping its own place in the turn of lists:

| Mark's name | Product on staging | List |
| --- | --- | --- |
| Fazzio | Yamaha Fazzio | 400–4000 |
| Honda ADV160 | Honda ADV 160 (2025-2026) | 300–3000 |
| Honda PCX | Honda PCX 160 | 400–4000 |
| Honda Scoopy | Honda Scoopy (New Gen) | 500–5400 |
| Yamaha Aerox | Yamaha Aerox 155 (2nd Gen) | 300–3000 |

**Not on staging, skipped (15).** Not created; a load on live must look for them: Benelli Leoncino 250, Benelli TNT135, GPX 250, Honda Click 125, Honda Click 150, Honda Lead, Honda Zoomer-X, Ryuka Infinity 250, Yamaha Freego, Yamaha Grand Filano, Yamaha GT, Yamaha Mio 115, Yamaha Qbix, Yamaha TTX, Kawasaki Z250SL.

**Checks after the load** (reads only, as the owner; the script runs them every time)

| Check | Result |
| --- | --- |
| Four lists, one of each name, kind Amounts, no hourly price, 30 days each, every day equal to Mark's figure | Pass |
| Products on the right list, with its long-stay rate and a ฿2,000 deposit | **10 of 25**, all ten right; 15 skipped on purpose, none missing unexpectedly |
| Products in BSR that name an archived tax profile | 0 (no product names any profile) |
| `quote()` through `pricing_inputs`, one product per list, pickup 1 Apr 2027 10:00 at BSR's main location | Pass, below |
| Settings as the pricer reads them | Deposit per product, prices include tax, rounding step not chosen, no default tax profile |

| List | Product | 1 day | 7 days | 30 days | 45 days |
| --- | --- | --- | --- | --- | --- |
| 300–3000 | Honda ADV160 (Honda ADV 160 (2025-2026)) | ฿300 | ฿1,400 | ฿3,000 | ฿4,500.00 |
| 350–3500 | Yamaha Fino | ฿350 | ฿1,500 | ฿3,500 | ฿5,250.05 |
| 400–4000 | Fazzio (Yamaha Fazzio) | ฿400 | ฿1,800 | ฿4,000 | ฿5,999.95 |
| 500–5400 | Honda Click 160 | ฿500 | ฿2,200 | ฿5,400 | ฿8,100.00 |

Each matches the list; 45 days is the day-30 price and 15 long-stay days (April has 30 days, so 45 days from 1 April is one month and 15 days). The deposit on each quote is ฿2,000. No season applies to any of the four.

**Where this differs from §9.11, on Mark's D7 instructions**

- **The lists are Amounts, not multipliers** (§9.11 recommended multipliers). No product has a base price.
- **The long-stay rates are rounded, not cut off:** ฿116.67 where §9.3 has ฿116.66 (฿133.33 is the same either way). They are written in as given and never derived.
- **Which product is on which list is a test mapping**, not BSR's.

**Left on staging:** the four lists, ten pricing rows, BSR's settings row now on "per vehicle", and the audit rows of four runs. A browser run that reads BSR's deposit choice (`e2e/shop-settings.ts`) puts back what it finds, which is now "per vehicle".

**Tests:** typecheck, lint and Prettier pass on the platform workspace with the script in it. No app or database code changed, so no test was added; the script's own checks are its test.

**Next**

1. The 15 scooters not on staging: nothing more to do there. At go-live, check that each is a product on live before its prices are loaded.
2. Live gets BSR's real prices at go-live (`docs/RUNBOOK-GO-LIVE-PLATFORM.md` › Staging), not this load.

## Pricing follow-ups before Phase 2 (branch `platform/pricing-follow-ups`, 16 Nov 2026)

What was left open by the reviews of PR 29 (D5) and PR 30 (D6). **No migration.** Nothing on staging or live was touched.

**The rounding-step browser test does catch the bug it was written for**

- **PR 29's code before the fix** (`aeca494`, the commit before `f90215d`), in a scratch worktree, with the test as PR 29 wrote it (`ed0b7c8`: Saigon, the step changed in the database; the Settings screen the D6 version uses did not exist yet): **failed at both widths**, at "every day is the stored amount". Day 2 was stored as 483333 and shown as 500000 (phone) and 490000 (desktop): filled in again with the new step.
- **The test as it is now** (`products-stage-d6.spec.ts`), on `main` with only the fix switched off (the saved values of filled days not kept on load, one line of `draftFromSaved`): **failed at both widths**, day 3 stored 670.00 and shown 660.00.
- **On `main` as it is** (`d5a22a8`): **passed at both widths.**
- Nothing was changed because of this. The scratch worktree is removed.

**What changed**

- **A first product price or a first price list warns that it fixes the shop's currency**, as Settings › Pricing and tax does: the same note on the page and the same question before the save, on a product's Pricing tab and on "New price list", while `currency_locked` is false for the shop. The same two texts (`Settings.pricing.firstSaveNote`, `firstSaveConfirm`), so no new Thai. As on Settings, the question is asked by the screen; the database's rule is unchanged.
- **D5 follow-ups 1 to 3 and the first two nits** were closed in D6 (checked in the code: no currency check left, one money parser, draft readers, no second call, the season's sign and dates). **The rest are closed here:**
  - Check a price says "saved or not" only when a Save would send other prices: what was typed ("300") is the saved "300.00", and a list typed in the boxes is the same list read back (`sameAsSavedDraft` in `lib/pricing-form.ts`).
  - `formatMinor` formats an amount of up to 15 digits as a number, which every browser does exactly; only a larger one is passed as a decimal string, which needs ES2023's `Intl.NumberFormat` (Chrome 106, Safari 15.4, Firefox 116). An older browser would round such an amount on screen only.
  - The products under a shared list are read with their list (`getSharedLists`), so the API's 1,000-row limit cannot cut the names.
  - History reads the audit rows' before and after as text and keeps a whole number past 2^53 as its digits (`parseExactJson` in `lib/history.ts`), for a product's pricing rows, its price lists and the seasons.
  - A browser test opens a duplicate's Pricing tab: it starts empty, and the original keeps its price.
  - A browser test covers the shared-list editor: after the rounding step changes it shows every day as stored, a new name alone rewrites no day, and a changed box fills in again only the days around it.
- **From the review of PR 30:**
  - The lock-order database test polls until the product save is waiting on a lock (`pg_stat_activity`), instead of sleeping 600 ms.
  - A stale browser-test lock file expires in 30 seconds, not 10 minutes (the waiting test's timeout is 6 minutes). The holder touches its file every 5 seconds, so a live holder is never robbed however long it runs (`e2e/file-lock.ts`, unit-tested in `tests/file-lock.test.ts`).
  - The first-save warning test decides whether to run from the database (a settings row, or `currency_locked`), not from the page, and a skip prints why. Before, a missing note made the test skip; now it fails.

**Decided here, not specified by the owner** (say if any should change)

- **The warning on the Pricing tab shows for any save while the currency is open**, also one that only chooses "not priced": every save there makes the product's pricing row, and any row fixes the currency.
- **The first-save browser test declines every question**, so it saves nothing in big-fleet and can run again on the same database. The accepted path is the ordinary save, which the other tests cover in BSR.
- **Left as it is:** the open item of D6, whether any settings row should fix a shop's currency at all (Mark keeps it; revisit before self-serve sign-up).

**Tests**

- Unit: 345 on the platform (332 before; the lock file 5, `sameAsSavedDraft` 4, `formatMinor` at any size 1, audit rows read exactly 3), 290 in `@mango/core`, 202 on the marketplace. Typecheck and lint pass for every workspace, the one-pricer (money) rule included.
- Database: 353 on the platform, all passing on a freshly reset local database (the same 353; the lock-order test changed how it waits).
- Browser, the full suite on a freshly reset and seeded local database, 375 px and 1280 px: 140 tests, 132 passed, 7 skipped (each runs at one width only), 1 failed on a page load that timed out (`drag-reorder.spec.ts`, "the drag library is fetched in reorder mode only", phone; not touched here). Run again on its own it passed at both widths. D5 and D6 saw the same timeouts on this machine. 140 is 136 plus the duplicate test and the shared-list editor test at both widths.
- After the run: no settings row outside BSR, no pricing row, no price list; BSR has its one settings row on the defaults.

**Local set-up.** This worktree uses the stage D6 stack (`Bike_Booking_stage_d6`, ports 6032x): `supabase/config.toml`'s change is local only (`git update-index --skip-worktree`), and `apps/platform/.env.local` names the same stack.

## Products, stage D3: rental-period maths (branch `platform/products-stage-d3-rental-periods`, 15 Nov 2026)

The third build stage of pricing, of seven (`docs/products-redesign.md` §9.15 and §9.19). **`@mango/core` and docs only: no migration, no screen, nothing in `apps/`.** Phase 3 builds the orders, the screens and the atomic database step; the money for extending, swapping and returning early is worked out here.

**What was built** (pure functions, money as `bigint` minor units)

- **`@mango/core/rental-period`:**
  - `extensionPrice`: the new period of an extended rental, priced as a continuation: today's price for the whole rental to the new end, less today's price to the current end. With "keep the last period's discount" it also gives where the charged price starts.
  - `swapAmounts`: at the swap time, the new bike's remainder, the money paid toward the unused part of the old bike, and what each pricing option comes to: remainder of the period (with and without the customer's discount, both shown to staff) and prorated difference.
  - `settleSwap`: the new period's charge against the money carried over. When the carried money is more (a cheaper bike), the rest is kept as credit, refunded, or left with the shop, by the shop's choice.
  - `earlyReturn`: a swap to nothing, under the same three choices.
  - `carryDiscount`: the one discount ratio, the amount charged ÷ the price before the staff discount, after seasons.
- **`continuationPrice`** in `@mango/core/rental-price`, and **a `quote()` line can carry the rental's original pickup** (`rentalStart`). The new period of an extension or a swap then goes through the one pricer like any line: seasons on its own days only, discounts, and VAT on its own invoice.
- **The deposit is not in any of it.** The functions take no deposit and return none.
- **Design:** decision 28 and §9.19 (the discount ratio, prorated difference unscaled, the deposit on a swap shown as a top-up or a release).

**The owner's figures, pinned by tests**

| What | Figure |
| --- | --- |
| Swap at the two-week point, ฿3,000 paid | Bike B's remainder ฿1,800, paid remainder ฿1,500, extra **฿300** |
| The same with ฿2,500 paid against ฿3,000 | Paid remainder ฿1,250; **฿250** keeping the discount, **฿550** without |
| The swap's own invoice | Pays ฿300 with VAT ฿19.63; ฿250 when the discount is kept |
| Month 13; a year, a month at a time | **฿3,000**; **฿36,000** |
| A month extended by 14 days | **฿1,400** (14 × ฿100), not the two-week price |
| Swap to a cheaper bike (฿3,500 paid, B to A) | −฿300: nothing to pay, and ฿300 kept as credit, refunded, or no charge |
| The kept ฿300 on the next extension | A ฿3,000 month comes to ฿2,700, VAT on ฿2,700 |
| Early return on 15 Jan, ฿3,000 paid | ฿1,500 as credit, refund or no charge; ฿1,250 when ฿2,500 was paid |
| Prorated difference | (3,500 − 3,000) × 17 ÷ 31 = ฿274.19, the same with or without a discount |
| The deposit | In no swap, settlement, return or extension result; the swap invoice's total and VAT are the same whatever the deposit setting |

**Decided here, not specified by the owner** (say if any should change)

- **A part-used day counts as used.** A swap or return at 15:00 on day 15 has 15 started days used on the old bike, and the new bike's remainder is its period price less its 15-day price.
- **The unused share comes from the old bike's prices as passed in.** Phase 3 passes the prices the period was billed from (the snapshot the design gives each period), so a later change to the old bike's list does not move the share.
- **In a later period of a rental, "used" is measured inside that period.** Swapping on day 14 of month 2 uses 14 long-stay days of the old bike (฿1,400 of its ฿3,000), and the new bike's remainder is its two months less its month and 14 days.
- **On a cheaper bike the carried money first pays for the new period**; only what is left over is credit, refund or no charge.
- **Under "no charge" the leftover stays with the shop** and is reported as its own figure, so the books can show it.
- **A period charged more than its price before discount is refused** (a surcharge is not a discount ratio).
- **Extending a fixed-price or free line costs nothing more**; extending a flat fee costs its own added periods.
- **The prorated-difference option counts days**, also on a list priced in months.

**Not in this stage:** "no charge" and "manual amount" need no function (0, and what staff type). The swap settings, the atomic swap, credit balances, refunds and credit notes are Phase 3.

**Tests**

- Unit: 284 in `@mango/core` (244 before; 40 new in `rental-period.test.ts`), 202 on the marketplace and 228 on the platform, all passing. Typecheck and lint pass for every workspace.
- No database or browser tests: nothing they cover changed.

**Next:** D4, the database: the tables of §9.2, RLS, the save functions and the deposit's move. This is the first stage with a migration.

## Products, stage D2: the pricer (branch `platform/products-stage-d2-pricer`, 15 Nov 2026)

The second build stage of pricing, of seven (`docs/products-redesign.md` §9.15). **`@mango/core` and docs only: no migration, no screen, nothing in `apps/`.** Nothing calls `quote()` yet; the Pricing tab (D5) is the first caller.

**What was built** (pure functions, money as `bigint` minor units, no float, no currency named)

- **`@mango/core/quote`: `quote()`, the one pricer.** One call prices the lines billed together, which is one invoice. For each line: the unit price (D1) × quantity, season rules, discounts. Then VAT once per rate group, and the deposit beside the price. It answers "can't be priced" for a product with no price, never zero.
- **`@mango/core/season`:** date-range percentage rules, up or down, every year or one year, for all products or named ones. Only the charged periods inside the range are adjusted; each charged day belongs to the calendar day it starts on at the location; one rounding on the line, satang kept; two rules on the same day are added, not compounded. Time-priced lines only (by rental length, flat fee per hour, day, week or month).
- **Discounts:** a list of already-decided discounts, each a percentage or an amount off all lines or named ones, applied in the order given. A percentage is taken on each line. An amount is shared out over its lines in proportion, to the satang, so each tax-rate group loses its exact share before VAT.
- **The "Accept coupons" switch:** a discount marked as a coupon is refused (`coupons_off`) when the shop's switch is off, before anything is priced. A staff price or any other discount is not stopped by it.
- **VAT, the accountant's rules (decision 27):** worked out once per invoice and rate group, rounded once, in both shop styles. Lines carry a rate and no tax amount. What is not taxable is in the total and in no VAT line.
- **A swap credit reduces the VAT base** of the new invoice: one function, `creditVatBases`, and one paragraph in §9.7.
- **Deposits:** none; a percentage of the order total after discounts, tax included; a fixed amount per order; per product (vehicles only, with the shop's amount for a vehicle with none). The order's setting wins over the customer's, which wins over the shop's. Never taxed, never in the total or the VAT base.
- **Design:** §9.7 rewritten for the tax decisions, Q7 marked answered, decision 27 added, and the Phase 3 notes on documents for swaps and early return (a credit stays a credit; a refund creates a credit note).

**Pinned by tests**

| What | Figure |
| --- | --- |
| ฿3,000 at 7%, prices include VAT | VAT ฿196.26, net ฿2,803.74 |
| ฿3,000 at 7%, VAT on top | VAT ฿210, total ฿3,210 |
| Three lines of ฿350, 7% included | VAT ฿68.69 on the invoice (not 3 × ฿22.90) |
| ฿500 staff discount on ฿3,000 | VAT on ฿2,500: ฿163.55 |
| ฿200 off ฿1,400 and ฿300 | ฿164.71 and ฿35.29; the 7% group is then ฿1,235.29, VAT ฿80.81 |
| Swap: ฿1,800 less a ฿1,500 credit | Pays ฿300, VAT ฿19.63; with the first invoice ฿215.89, the VAT on ฿3,300 |
| Season: 3 of 7 days at 20% off ฿1,400 | ฿120 off, ฿1,280 |
| Season: 2 of 7 days at 20% off ฿1,500 | ฿85.71 off, ฿1,414.29 |
| Deposit: 30% of ฿12,600 | ฿3,780; ฿3,600 after a ฿600 discount; ฿4,044.60 with VAT on top |
| Deposit: per product | 2 × ฿2,000 + ฿5,000 + the shop's ฿1,500 = ฿10,500; a helmet adds nothing |

**Decided here, not specified by the owner** (say if any should change)

- **Discounts apply in the order given, each on what the one before left.** Two 10% discounts on ฿3,000 leave ฿2,430, not ฿2,400. Phase 2 decides which discounts may be combined at all; this only fixes the arithmetic when they are.
- **A discount can't take more than its lines come to**, and seasons can't take a line below zero.
- **A coupon while the switch is off is an error, not ignored**, so a caller can't show a price that silently left it out.
- **One line that can't be priced means the whole quote is not priced**; the answer names the lines.
- **A percentage deposit is taken on what this invoice charges**, which is the order total after discounts with tax. On a swap invoice that would be after the credit; whether a swap changes a deposit at all is already a Phase 3 question (§9.13, item 12).
- **A product's own deposit of 0 means no deposit for it**; only a product with none set uses the shop's amount.
- **A zero-rated profile (0%) keeps its own VAT line of nothing; "not taxable" has no line.**
- **A credit larger than the amount it is set against is refused.** A negative amount (a cheaper bike, an early return) is handled before the pricer by the shop's choice of credit, refund or no charge.
- **The swap credit's VAT rule is built here**, ahead of the swap maths (D3), because the accountant's rule is a tax rule and belongs with the tax step.
- A season on a flat fee per week or month goes by the day each period starts on.

**Not in this stage:** included quantities (step 4 of the pricer, Phase 2); the database function that feeds `quote()` and the guard against a second pricing path (they come with the first callers, D4 and D5).

**Tests**

- Unit: 244 in `@mango/core` (182 before; 62 new in `quote.test.ts` and `season.test.ts`), 202 on the marketplace and 228 on the platform, all passing. Typecheck and lint pass for every workspace.
- No database or browser tests: nothing they cover changed.

**Next:** D3, the rental-period maths (a continuation, a swap, an early return).

## Products, stage D1: price lists and months (branch `platform/products-stage-d1-price-lists`, 15 Nov 2026)

The first build stage of pricing, of seven (`docs/products-redesign.md` §9.15; the design itself is PR 23). **`@mango/core` only: no migration, no screen, nothing in `apps/`.** Nothing calls the new functions yet; D2 (`quote()`) is the first caller.

**What was built** (all pure functions, money as `bigint` minor units, no float, no currency named)

- **`@mango/core/price-list`:** quick entry (hourly, daily, weekly, two weeks, three weeks, monthly) filled to the 30 days of a list at the shop's rounding step, each day marked entered, filled or edited by hand; "same price every day"; what stops a list being saved (30 days, every total above zero, no total lower than the day before, **equal neighbours allowed**); the two kinds of list, amounts and multipliers of a base price (a multiplier is a whole number of ten-thousandths; `base × multiplier` rounds half up to one minor unit).
- **`@mango/core/rental-price`:** the list price of one unit for one rental, with how it was worked out. Flat fee per started hour, day, week or month; fixed price; free; and by rental length: under 24 hours with an hourly price, every started hour capped at the 1-day total; **30 days or fewer from the list; from 31 days, whole months at the monthly price plus leftover days at the product's long-stay daily rate** (monthly ÷ 30 when the product has none), leftover days never more than one more month.
- **`@mango/core/rental-days`:** `rentalDays` takes the location's time zone (a day is then 24 hours on the clock there, so a night when the clocks change is one day) and a charge-rules argument that accepts only "no rules" until they are built. New: `rentalHours`, `isUnderOneDay`, `rentalMonths` (date to date from the pickup date; a month without the date uses its last day and the anchor does not drift).
- **`@mango/core/zoned`:** wall-clock time in any time zone through `Intl`, no fixed offset, no new dependency.
- **The marketplace's fill is unchanged to the baht.** `fillDays` now does its arithmetic through the platform's function with whole baht and a step of 10; its existing tests pass untouched, and a new test fills every published BSR price set both ways and compares.

**The owner's figures, pinned by tests** (list 300–3000, ฿100 a long-stay day, from 1 Jan 2027)

| Rental | Price |
| --- | --- |
| 14 days | The list's two-week price |
| 1 month + 14 days | ฿4,400: ฿1,400 for the 14 days |
| 45 days | ฿4,400 |
| 60 days | ฿6,100 (฿6,000 from 1 Jan 2028, a leap year: two months are then 60 days) |
| A year, and month 13 | ฿36,000, and ฿3,000 |
| 28, 29, 30 days from 1 Feb | The list's price for 28, 29, 30 days; never more |
| 31 days from 1 Feb | ฿3,300 (a month and 3 days) |
| Satang | 350–3500 at ฿116.66: a month + 14 days = ฿5,133.24. 400–4000 at ฿133.33: ฿5,866.62. ฿100 × 1.1666 = ฿116.66 exactly |

The swap extras (฿300, ฿250, ฿550) are stage D3's.

**Decided here, not specified by the owner** (say if any should change)

- **A 31st day that starts before the first month is complete costs the monthly price.** In a 31-day month, a bike collected 1 Jan 10:00 and returned 31 Jan 12:00 has 31 started days but no whole month yet (that is 1 Feb 10:00). The month rule alone would charge 31 × the long-stay rate, which at a low rate is less than 30 days cost. It is charged the monthly price: not less than 30 days, not more than the month it is about to become.
- **Days and months are counted on the wall clock at the location** when a time zone is given (the design's §3.1). Without one, `rentalDays` counts 24 elapsed hours as before, which is what the marketplace passes today; the two agree wherever there is no daylight saving.
- **Hours are elapsed time** (every started 60 minutes), also across a clock change.
- **A week is 7 started days; a flat-fee month is every started date-to-date month** (1 Jan to 2 Feb is two).
- **A flat fee per day has no month rule:** 45 days is 45 × the fee. Only "by rental length" has months and a long-stay rate.
- **The test lists are quick-entry fills, not BSR's real tiles**, which arrive before the last stage. The pinned figures depend only on BSR's 14-day and 30-day totals and extra-day amounts.
- No `n` literals in the source (the apps compile these files at a lower language target); tests use them.

**Tests**

- Unit: 182 in `@mango/core` (111 before; 71 new in `price-list.test.ts`, `rental-price.test.ts`, `zoned.test.ts` and `rental-days.test.ts`), 202 on the marketplace and 228 on the platform, all passing. Typecheck and lint pass for every workspace.
- Among the new ones: Honda Click 125i's 30 days worked by hand; every half-up boundary of the step and of a multiplier; a zero-decimal (JPY) and a three-decimal (KWD) currency; the list price for 1, 7 and 27 to 30 days from every start date over two years; the price never falling as days rise, across month ends, a leap year and both New York clock changes.
- No database or browser tests: nothing they cover changed.

**The two tax questions with Korn** (tax per line; credit notes for swap credits and refunds) do not touch this stage.

**Next:** D2, `quote()`: seasons, the discount step and the coupons switch, tax, deposits.

## Products, stage D: pricing, design only (branch `platform/products-stage-d-pricing`, 15 Nov 2026)

**No code and no migration on this branch.** The design is `docs/products-redesign.md` §9, written from `main` at `dc4d8ee` and **approved by the owner on 15 Nov 2026 (decision 26)**. The build follows in the stages of §9.15, one PR each, starting with D1 (price lists and months, `@mango/core` only).

- **Owner's decisions, three rounds on 15 Nov 2026 (decisions 24 and 25).** From BSR's real Booqable data: templates are multipliers; equal neighbouring totals are allowed and a falling one refused; an import keeps Booqable's exact amounts, satang included; four templates only. In stage D: flat fee per period, fixed price and tiered lists (amounts, or multipliers of a base price); quick entry with editable filled-in days; seasonal percentage rules on the part of a rental inside a date range; four deposit choices with order and customer overrides; tax profiles, a default, non-taxable products, prices including or excluding tax; a coupons switch and the pricer's discount step.
- **Second round:** a month is date to date, anchored on the original pickup date; whole months at the monthly price and leftover days at a per-product long-stay daily rate; pickup-day, return-day and weekday charge rules as shop settings, off by default (BSR uses none); and, for Phase 3, rental periods, several rentals per order, Extend rental and Swap bike (§9.19), whose maths the pricer carries from stage D.
- **The design:** seven tables written only through functions and hidden from mechanics and drivers; one pricer, `quote()` in `@mango/core`, in a fixed eight-step order, with two more pure functions for a continuation and a swap; seven small build stages (§9.15), then Phase 2, Phase 3, and the charge rules after Phase 3 and before 3M.
- **Conflicts with the spec, the contract and earlier decisions are in §9.14.** The largest: the month rule replaces "beyond 30 days, the 30-day total ÷ 30" (spec, contract §4.2, the 7 Nov decision), makes a long rental's price depend on its start date so `dayPrices[30]` no longer covers it, and does not match Booqable's totals past a month; charge rules change the contract's "a day is every started 24 hours" for a shop that switches one on; dates move from the order to the rental and a line gains a list price and a charged price.
- **Settled at approval:** the list prices 30 days or fewer and the month rule starts at 31; a missing long-stay rate is the monthly price ÷ 30, with leftover days capped at one more month; extending uses today's prices at both ends, with "keep the last period's discount"; a season day belongs to the calendar day it starts on; rental-period maths is in stage D; early return is a Phase 3 swap to nothing.
- **With Korn:** tax per line on a Thai tax invoice, and credit notes for swap credits and refunds. Neither blocks a maths stage; the first could change the tax step in D2 only.
- **Going ahead as recommended unless the owner says otherwise:** the other items of §9.13 (ways of pricing per type, replacement value now and `product_extras` in Phase 2, staff not bound by minimum notice, a warning for a listed product with no price, a new shop starting with no tax, the prorated-difference swap option by days).
- **BSR's four lists:** the owner supplies every daily amount, the base prices and the list for each product before the last build stage. The maths stages do not wait.
- **Not seen by Claude:** BSR's Booqable account (the figures are the owner's reading of it). Booqable's help text for two of the four charge rules contradicts itself, so those rules are designed from their names, with worked examples for the owner to confirm.
- `docs/platform/SPEC.md`, `docs/platform/MAPPING.md` and `docs/INTEGRATION.md` are not changed; §9.14 lists what each will need.

## Products, stage C: the Moto Mangos tab (branch `platform/products-stage-c-tab`, 15 Nov 2026)

PR 2 of stage C, of two. The Moto Mangos panel moves from a motorbike's Details tab to its own tab, with the listing part reworked. The design is `docs/products-redesign.md` §5.11. Platform only; **no migration** (the database is PR 21's). `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **The Moto Mangos tab**, after Units (Details, Units, Moto Mangos, History), at `?tab=moto-mangos`. Motorbikes only, owners and managers only. The panel moved over in its order; Details keeps the product form, Duplicate and Delete.
- **The listing part:** the switch saves by itself (`save_listing` with the switch alone); Instant units, Request units, Walk-ins and the new **Lead time (hours)** (0 to 720, empty for none, with a help line) are saved under one Save, sending only what changed; "Offering N of M bikes for advance booking" follows the typing; the line that the listing does nothing until Moto Mangos reads from the platform stays.
- **Wording, as Mark asked:** "Total units listed on Moto Mangos can not exceed the number of units in your inventory"; "Walk-ins can not exceed the number of units in your inventory" (both live on the page, in the server action, and as the mapping of the database's `more_units_than_active`); the picker's "Select" is "Connect"; the label "Select your make and model from the list" stays.
- **Links:** the dashboard's "Moto Mangos reviews" lines and the mango on Fleet and Products rows open the tab, keeping the way back; old `#moto-mangos` links land on the tab.
- **History:** "switched Moto Mangos on" and "… off"; "changed lead time from 12 to 24 hours" (and "set …", "removed …"); one line for a retire or a disconnect of a listed product.
- **Thai:** 16 new or changed texts, plus the tab's 41 unchanged ones for context, in `docs/platform/thai-review-products.md` under "Products, stage C: the Moto Mangos tab".

**Decided here, not specified by the owner** (all in §5.11; say if any should change)

- **The two messages are worked out by the app.** The database refuses both with one code (`more_units_than_active`); a new message key, `more_walk_ins_than_active`, is chosen by comparing the counts with the active vehicles, so no migration was needed. The old message ("Instant plus Request units, and Ready now, can't be more than the model's active vehicles") is gone in both languages.
- **Save waits while a count is too high** (the button is disabled and the reason shows under the counts), so the message is never shown twice. Without JavaScript the server says the same.
- **"Connect" on Change model too**, since it is the same picker.
- **The switch's line** reads "On. The switch saves as soon as you press it." (or "Off. …").
- **The mango is a link** for owners and managers (the only people who see it), 44 px to tap, not in Reorder mode. It wasn't a link before, and the dashboard linked to the product page, not to `#moto-mangos`: no live link used the anchor, so the old-anchor redirect is for bookmarks and anything typed or pasted.
- **History, one action, one line:** for a retire or a disconnect, the listing's row and its `listing_off` of the same moment are left out, so the retire reads only "Retired: … → …" and the disconnect only "disconnected this product from Moto Mangos". The switch is said only by `listing_on` and `listing_off`; the listing row's "Listed on Moto Mangos" line is gone (old rows from before stage C still read that way). A lead time saved together with a count is a bullet under that save ("Lead time (hours): 12 → 24"), so one Save is still one line.
- **"inventory"**: a stage A test kept the word off every screen. Mark's two sentences use it; the test now allows exactly those two.
- **Approval in the browser test is by merging** into an entry already on the list (as `fleet.spec.ts` does), so runs against staging don't leave new entries on the shared Moto Mangos list.
- Stage B's "Change model or disconnect" browser test moved into the new spec file, rewritten for the tab.
- **After PR 20 (dragging) merged (15 Nov 2026):** main merged into this branch. Both list pages take main's drag layout unchanged; the mango is re-added there as a link to the tab, not a link in Reorder mode, and still hidden in Reorder mode on phones (main's `cell.reorderMango`). The Walk-ins help text now reads "Bookings that are ready for immediate pickup today (overrides the lead time)" (owner's wording), in English and Thai (ไม่ใช้เวลาจองล่วงหน้า, the lead time field's own words), in both tests and both rows of the Thai review list. The old sentence is nowhere in the repo.
- This worktree has its own local database (`Bike_Booking_stage_c_tab`, ports 5832x); the change to `supabase/config.toml` is local only (`git update-index --skip-worktree`), not committed.

**Tests**

- Unit: 219 on the platform (new: `lib/listing-settings.test.ts`, 5; the History reader's listing cases rewritten and two added in `lib/products.test.ts`; the old `listingSchema` test removed), 111 in `@mango/core`, 202 on the marketplace. All passing.
- Database: 294, all passing locally (none changed; no migration).
- Browser: `e2e/products-stage-c.spec.ts`, 5 tests at 375 px and 1280 px, all passing locally: the whole tab (Connect, switch, counts, both messages, lead time, Change model, Disconnect, History lines), review rejected then approved, no tab for a car, a helmet, staff, a mechanic or a driver, old anchors with the mango and back link, and screenshots in light and dark. Changed to go through the tab: `fleet.spec.ts`'s Moto Mangos click-through, `products.spec.ts`'s tabs and Duplicate tests; stage B's Change model and Disconnect test moved to the new file. The whole suite ran locally (96 passed, 3 skipped as on `main`); the 7 that failed were the tests still expecting the panel on Details, fixed and re-run green, plus `fleet.spec.ts` "one line per product", which failed only on products a failed run had left behind and passes on clean data.
- Typecheck and lint pass for every workspace.

**Not built here**

- The shop's minimum notice (`locations.min_notice_hours`): Phase 2.
- Counting real Moto Mangos bookings against the cap: Phase 3.
- Staff changing the walk-ins count: a one-word migration in `listing_roles('walk_ins')` when wanted; the tab would then need a staff view.

## Dragging to reorder (branch `platform/drag-reorder`, 14 Nov 2026)

Fleet and the Products list can be reordered by dragging, in Reorder mode. The design and what was decided is `docs/products-redesign.md` §5.8 ("As built"). Platform only. No migration (`move_product` already takes "before or after any product"). `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **A drag handle on each row in Reorder mode**, at the row's outside (right) edge, after Move up and Move down: small and quiet to see, 44 px to hold. Only the handle starts a drag. Mouse: press and move 8 px. Touch: hold a quarter of a second, then drag; a quick tap does nothing and a finger that moves sooner scrolls the page. Keyboard: Space, arrows, Space (Escape cancels), with announcements for screen readers in English and Thai.
- **One order, one move:** a drop saves through the same action and database function as the arrows. Fleet and the Products list share the order and general products take part. A Fleet group drags as one block (its line is shut in Reorder mode). The arrows stay, and work without JavaScript.
- **New dependency, approved by Mark (14 Nov 2026):** `@dnd-kit/core` 6.3.1 and `@dnd-kit/sortable` 10.0.0, exact versions. Confirmed on React 19.3.0 by building and running before it was installed here (a throwaway project, then `next build` and the browser tests).
- **Loaded only in Reorder mode**, which only owners and managers reach: 47.8 kB minified, 15.9 kB gzipped (14.4 kB with Brotli), measured from this build, in its own file. A browser test checks that the two lists as they normally are, and staff, do not fetch it.
- **Wording:** 7 new texts and 1 changed (`Lists.reorder.help`), English and Thai, listed in `docs/platform/thai-review-products.md` under "Dragging to reorder".
- **Tests:** 9 unit tests in `lib/drag-order.test.ts`; `e2e/drag-reorder.spec.ts` at 375 px and 1280 px (mouse, simulated touch, keyboard, reloads, the loading rule).

**Decided here without being asked**

- **On a phone in Reorder mode the Moto Mangos mango is hidden** and its column goes to the name. With the handle added, names were cut to "Yamaha …" and two Yamahas could not be told apart. Desktop keeps the mango; outside Reorder mode nothing changed.
- **Rows move up and down only**; the row being dragged gets a shadow. **Enter** also picks up and drops (the library's default); the brief asked for Space, which works.
- **A refused save is silent:** the list goes back to the saved order, with no message. The arrows behave the same way today.
- **The browser test for dragging runs once** (in the phone project) and opens 375 px and 1280 px itself, in the `big-fleet` demo shop: the order is shop-wide, so two copies side by side would reorder the same shop under each other. It adds one rental-gear product and removes it, and resets the shop to A to Z at the end.
- **No `@dnd-kit/modifiers`:** "up and down only" is four lines of our own, to keep to the two approved packages.

**After Mark's phone test (15 Nov 2026): passed, with two changes**

- **The handle moved to the row's outside (right) edge**, after the arrows, on both lists.
- **The line above the list in Reorder mode** is his sentence: "Select and drag to move anywhere on the list, or use the arrows to move one row at a time".
- **The mango is still hidden on a phone in Reorder mode.** Moving the handle changes the order of the three controls, not their width: two arrows and the handle are 132 px either way. With the mango's 44 px column back, a name gets about 85 px at 375 px wide ("Yamaha …"); without it, about 137 px. Desktop shows the mango.

**Known issues and what was not tested**

- **Touch was simulated**, with real touch events in desktop Chromium. It passed six runs in a row, so it is not flaky here. Not covered, and for a real phone: how the quarter-second hold feels, iOS Safari's long-press behaviour on the handle (selection, callout menu), haptics, and the page scrolling by itself when a row is dragged to the edge of the screen.
- **Keyboard at machine speed:** keys sent with no pause at all (under 50 ms apart) can arrive before the library has measured the list, and the move is skipped. A person can't type that fast; the tests leave 150 ms between keys.
- **The two packages' last release was December 2024** (§5.8). If they stop working with a later React, the arrows still do the job and the handle can be removed in one file.

**Next:** Mark's click-through on a real phone (the list is in the PR).

## Products, stage C: the database part (branch `platform/products-stage-c-db`, 14 Nov 2026)

PR 1 of stage C, of two. Moto Mangos listings move from columns on `products` to their own table, `platform.product_listings`. The design is `docs/products-redesign.md` §5.10 and decision 23 (the owner's eight answers of 14 Nov 2026). Platform only: nothing in `apps/marketplace`. **Nothing a shop sees changes in this PR**: the Moto Mangos panel stays on the Details tab until PR 2. `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **One new migration, `20261114000200_platform_product_listings`.** No earlier migration is touched. The table (RLS on; members read; the service role granted on purpose; nobody signed in writes it directly); the data copied (a row for each product that is listed, has a count above zero or has a ready-updated time); the five columns dropped from `products`; `products_vehicle_fields_check` re-created; a guard, `updated_at` and audit triggers on the new table; `listing_on` and `listing_off` events; `platform.save_listing()`; and the five functions that named the old columns re-created (`products_guard`, `products_retire_guard`, `units_clamp_product_counts`, `review_catalog_request`, `disconnect_listing`). The list of five is from the database: every function whose body names one of the columns.
- **One new setting:** `lead_time_hours` (0 to 720; empty = none of its own). Stored and validated; no screen sets it until PR 2.
- **Lock order everywhere: the product's row, then the listing's row.** The table of writers is in §5.10.
- **`@mango/core` `listing`** (`packages/core/src/listing.ts`): the lead time rule (the stricter of the shop's minimum notice and the listing's lead time; either may be missing) and the cap and mode rules, pure, with 25 unit tests. Nothing calls it yet.
- **The app, as little as possible:** `lib/fleet-data.ts` reads the listing beside the product under the names the screens already use; `saveListing` calls `save_listing`; the History tab reads the listing's audit rows as the product's own, in the same words.
- **Types regenerated** (`packages/db/src/database.types.ts`).

**Decided here, not specified by the owner** (all in §5.10; say if any should change)

- **A shop changes a listing only through `save_listing()`; the table gives signed-in people no insert, update or delete.** This is how "product row, then listing row" is kept: a direct update locks the listing's row before anything can lock the product's. The function runs with its owner's rights and checks the caller itself.
- **Who may change what is one function, `platform_private.listing_roles(action)`**, with two actions: `settings` (the switch, instant and request units, the lead time) and `walk_ins` (the walk-ins count). Both are owner and manager. Adding staff to `walk_ins` is a one-word migration; nothing else needs to change in the database.
- **`save_listing` takes only what is to change**, as a list of named settings, so PR 2's switch can save by itself and a lead time of "none" can be told from "not mentioned".
- **A product that was never listed gets no row for saving "off, zero, none"**, and a vehicle leaving or a retire makes no row either.
- **Lead time is 0 to 720 hours** (the old marketplace's range for notice).
- **Disconnect keeps the lead time**; it still switches off and zeroes the three counts.
- **Approving a request whose product the shop retired meanwhile now goes through**, leaving that product off Moto Mangos. Before, the retire rule refused the whole review, so the Moto Mangos admin could not approve the entry at all.
- **The ready-updated time is set by the database** whenever a walk-ins count above zero is saved (the browser sent it before), also when the same count is saved again.
- **`listing_on` and `listing_off` are written by a trigger on the table**, so every path writes them (a save, an approval, a rejection, a retire, a disconnect), with whoever did it as the actor. The History tab leaves them unsaid for now, because the listing's own row already says "Listed on Moto Mangos: No → Yes"; PR 2 gives them their words.
- **One small visible difference in History:** retiring or disconnecting a listed product shows two lines (the product's change, and the listing going off) where it showed one. Nothing else on any screen changed.
- **The migration is `20261114000200`**, the next number after the gear rework's.
- **This worktree has its own local database** (`Bike_Booking_stage_c`, ports 5732x), so resets here don't touch other sessions' databases. The change to `supabase/config.toml` is local only (`git update-index --skip-worktree`), not committed.

**For the marketplace switch-over (3M), noted as asked:** the old marketplace lets a model's notice replace its shop's, so a model can have a shorter notice than its shop. On the platform the stricter of the two applies. A legacy model with a shorter notice than its shop takes the shop's at 3M and can drop out of a search it is in today, so the "search results identical before and after" check must expect it. Written into `docs/platform/MAPPING.md` on the `notice_h` row.

**For Phase 3:** an order from Moto Mangos must store how it was made (instant, request or now); the booking function checks the cap under the product-and-location lock. §5.10 has the detail.

**Tests**

- Database: 294, all passing locally (251 before; 39 new in `product-listings.test.ts`, 4 new in `default-grants.test.ts`). The seven older files that set or read a listing were changed only in how they reach it (the new table and `save_listing`); two assertions changed in substance: a general product with `marketplace_listed` or `instant_units` is no longer a case (the columns are gone; the table's key refuses a listing on a helmet instead), and the isolation test's "can't list another shop's product" now expects `save_listing` to refuse with 42501.
- Unit: 111 in `@mango/core` (25 new in `listing.test.ts`), 213 on the platform (3 new, on the History reader), 202 on the marketplace (untouched). All passing.
- Browser: the whole suite at 375 px and 1280 px on a local production build against a database built from scratch with all 58 migrations and the demo seed: 97 passed, 3 skipped (the two timing measurements and one manual-order test, skipped as on `main`), none failed. No browser test was changed: the panel, Change model, Disconnect, the lists and the History behave as before.
- The data move, on a local copy shaped like staging (16 products, 14 with a listing setting of some kind, including "counts but not listed" and "a ready-updated time only"): the settings read line for line the same from `product_listings` after the migration as from `products` before; product, unit and audit counts unchanged.
- Typecheck and lint pass for every workspace.

**Not built here**

- PR 2 (screens): the Moto Mangos tab, the lead time field, the "Offering N of M" line, the switch saving at once, words for `listing_on` and `listing_off`, the Thai review list. No new text was added in this PR, so there is nothing new for the Thai review.
- The shop's minimum notice (`locations.min_notice_hours`): Phase 2, by the owner's answer.
- Counting real Moto Mangos bookings against the cap: Phase 3 (orders).

**Known issues**

- `review_catalog_request` locks the list entry, then the products; deleting a product locks the product, then updates its pending entry. The two can meet in a deadlock, which Postgres ends by refusing one of them. It was so before this PR and is not changed here.
- Root `CLAUDE.md` does not have the lock order yet (`docs/products-redesign.md` §8 puts it there once Phase 2 builds the booking locks).

**On staging, not on live (14 Nov 2026).** Staging records 58 of 58. Live stays at 53 of 53 and gets this with the four before it only from `main`, by the runbook.

- **When:** pushed on 14 Nov 2026 at 15:37:55 UTC (22:37 in Bangkok), finished 15:38:03 UTC, from this branch at `b3af3e7`, once PR 21's CI was green on every check, as the owner asked ("only when this PR is ready to merge"). With `supabase db push --db-url`, after a dry run at 15:37:47 UTC that listed exactly one pending migration (`20261114000200_platform_product_listings.sql`).
- **Staging's data came through unchanged.** The same counts and checksums before and after: 32 products, 205 units, 21 blocks, 15 year bands, 1 stock movement, 3,190 audit rows (none added: the copy is not a change anyone made). Staging had two products with listing settings, both BSR's, both with counts and neither switched on: they are the two rows of `product_listings`, with the same checksum over product, switch, the three counts and the ready-updated time as the columns had.
- **Staging matches a fresh build:** its `platform` and `platform_private` schemas, dumped with their grants, are line for line identical to the local database built from the migration files (5,171 lines each; the only differing lines are pg_dump's own random session token).
- **Until PR 21 merges, the platform site's main deploy runs the old code against staging:** it still asks `products` for the dropped columns, so Fleet, Products and every product page fail there. PR 21's deploy preview runs the new code against staging (its login page answers; it was not clicked through after the push: the same code passed the browser suite against the same schema locally and in CI). Merge PR 21, or use its preview, to use staging.

## Rental gear: the stock rework (branch `platform/gear-stock-rework`, 14 Nov 2026)

The owner's testing of the Rental gear Stock tab found it confusing. Reworked to his eleven points; the design is `docs/products-redesign.md` §5.9. Rental gear only: items for sale are as they were. Platform only. On staging; **not on live**. `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **Details tab** (everyone who can open the product), top to bottom: the name and description for owners and managers; then large tiles (In stock, Available now, In repair; Lost only when above zero); "Change quantity" with a −/+ stepper and a "Save quantity" button that appears when the number changed; one "Report a problem" button; the "Out of service" list; Delete last, for owners and managers.
- **Report a problem** is one dialog, a bottom sheet on a phone: What happened (In repair, Lost, Damaged for good), How many or Which unit, Date it happened, Expected back (In repair only), Notes.
- **Stock tab:** one row per unit with its name or label and a status chip; a hint about "Track each unit on its own" for counted gear. Labels are edited here.
- **Statuses:** In repair (in stock, not available), Lost (not in stock), written off (gone for good, kept in the History with its day and notes). "Damaged" for a unit that can come back is now "In repair" everywhere, the History included.
- **Each unit out of service has its own record:** day, expected-back day and notes, edited on its own line.
- **Permissions:** every existing rule kept. New: writing off as damaged is for owners and managers. All of it is in one place, `lib/gear-permissions.ts`, mirrored by `platform_private.gear_roles()`; a database test compares the two. Owner-set permissions are not built.
- **One new migration, `20261114000100_platform_gear_stock_rework`**, on top of Stage B's, which is untouched. No new table: three columns on `platform.units`; `report_gear_problem()`, `update_unit_problem()` and `resolve_unit_problem()` in place of Stage B's four stock functions, which are dropped; `product_stock()` answers `in_repair` where it said `damaged`. Every new function starts closed and is granted to `authenticated` on purpose; `default-grants.test.ts` lists them.
- **Wording:** 89 new or changed texts in English and Thai, listed in `docs/platform/thai-review-products.md` under "Rental gear, the stock rework". The confirmation before removing a unit is the owner's sentence.

**Second round, after the owner's click-through (14 Nov 2026).** Steps 1 to 5, 7, 8, 10 and 12 passed as built. Changed, with no migration and nothing on staging:

- "Write off" and "Write off as damaged" are "Remove from stock" on every button, in the confirmation ("Remove from stock? This cannot be undone. …") and in the History ("removed 1 from stock as damaged"). The stock-blocked message on Delete follows. Function and audit names are as built.
- Product details is the first card on the Details tab; the stock cards follow; Delete stays last.
- Under "Date it happened" and "Expected back", in the dialog and when editing a line: "For information only. It does not affect stock quantities."
- The Stock tab's hint says the switch is under Product details on the Details tab, and links there for owners and managers.
- Done from this chat's own worktree (`.claude/worktrees/gear-stock-rework`), by the owner's rule of the same day.

**Decided here, not specified by the owner** (all in §5.9):

- Staff and mechanics now get the Details tab for gear (they had only Stock), because the tiles, the dialog and the list are there. They do not see the name form, the stepper or Delete.
- Every unit out of service gets its own line, tracked or not, so "Back in use", "Found" and "Remove from stock" act on one line and no longer ask "how many".
- "Expected back" is information: a repair no longer ends by itself at that time. Someone presses "Back in use".
- "Report a problem" takes only units that are in use and that no booking holds now or later. Before, "Mark lost" could take a unit that was damaged.
- A unit in repair can't be marked lost in one step: put it back in use, then report it lost.
- Whoever may mark a unit a certain way may edit its line (so a mechanic edits a repair's line, not a lost unit's).
- "Date it happened" can't be in the future; "Expected back" can't be before it.
- Tracked gear: the dialog reports one unit at a time.
- More than one location: the cards repeat under each location's name.
- An edited line is recorded in the History ("changed the details of a unit in repair").
- `ActionForm` gained three optional props (`quiet`, `showSubmit`, `onOk`); nothing else that uses it changed.

**On staging, not on live (14 Nov 2026).** Staging records 57 of 57. Live stays at 53 of 53.

- Pushed from this branch on the owner's instruction with `supabase db push --db-url`, after a dry run that listed exactly one pending migration (`20261114000100`).
- Staging's data came through unchanged: 196 units, 21 blocks and 29 products before and after, with the same checksums over the units (id, status, label, product, location) and the blocks (id, unit, kind, start). Staging had one gear product (BSR's Helmet "M", 20 units, 6 damaged, none lost): the 6 are now In repair with 13 Nov 2026 as their day, and its counts read 20 in stock, 6 in repair, 14 available. No vehicle carries a record. The audit log gained 6 rows, one for each of those units.
- **Staging matches a fresh build:** its `platform` and `platform_private` schemas, dumped with their grants, are line for line identical to the local database built from the migration files (4,749 lines each).
- The conversion's other paths (a damaged unit with an end time, with a note, with a later block behind it; a lost unit) were checked on local data before the push: the end time became Expected back, the note became the notes, the block became open-ended except where a later block stood in the way, and lost units stayed lost. Unit and block counts were the same before and after.
- **Until this PR merges, the platform site's main deploy runs Stage B's code against staging:** the Products and Fleet lists work, but a gear product's Stock tab shows no damaged count and its damaged and lost buttons fail, because the functions they call are gone. Items for sale and vehicles are not affected.

**Tests**

- Database: 251, all passing locally (28 new in `gear-stock-rework.test.ts`; Stage B's damaged and lost tests moved there and were rewritten).
- Unit: 191 on the platform, all passing (20 new in `gear-stock.test.ts`).
- Browser: `gear-stock.spec.ts`, two tests at phone and desktop width, passing locally. The whole browser suite passes locally with two workers; at the default worker count this machine times out on "Delete product" redirects, and `fleet.spec.ts` "one line per product" fails when its phone and desktop runs overlap (both pass alone). Neither touches code changed here.

**Known issues and follow-ups**

- A unit booked for later can't be reported in repair or lost. Moving its booking to another unit belongs with orders (Phase 3).
- The Fleet and Products list rows are being polished on another branch; this branch changed nothing in them (the lists read `in_stock` and `lost`, whose names did not change).
- Thai: the 89 texts need a native check, "Out of service" (งดใช้งาน) and "Remove from stock" (นำออกจากสต็อก) first.
- The owner asked for these permissions to be changeable in Settings (click-through, steps 13 to 15). Not built: `lib/gear-permissions.ts` and `gear_roles()` are ready for it.

## Fleet and Products lists on a phone (branch `platform/lists-mobile-polish`, 14 Nov 2026)

Platform UI only: no migration, nothing pushed to staging or live, nothing in `apps/marketplace`. The product page's Details and Stock tabs are untouched (another branch, `platform/gear-stock-rework`, is reworking the Stock tab).

**What changed**

- **Every row is two lines and the same height**, on Fleet and on all three Products tabs (`components/fleet/list-bits.tsx` `rowGrid`). Line 1: the kind icon, the name on one line with "…" when too long (the full name is a tooltip and on the product page), the edit pencil. Line 2: the summary ("2 vehicles · 1 available" on Fleet; "3 vehicles in the fleet" for a vehicle, "18 in stock, 2 lost" for gear or an item for sale, a dash for a service on Products) and the Moto Mangos mango. Both lines have a fixed height, so a long name or many tags can't make a row taller. Fleet keeps its chevron at the end of the row.
- **Tags:** no kind or category tags on a phone. On a wide screen (640 px and up) the kind and categories follow the summary, cut off where the line ends. "Retired" is now words at the start of the summary, at every width.
- **The Moto Mangos mango** (motorbikes only, owners and managers only, as the chip was): colour = on Moto Mangos; colour with an amber dot = in review; grey = not on Moto Mangos. Named for screen readers and as a tooltip ("On Moto Mangos", "In review for Moto Mangos", "Not on Moto Mangos"). It replaces the listing chip everywhere it was (the two lists). Assets: `apps/platform/public/brand/moto-mangos-mango-{colour,grey}-{48,96}.png`, cropped square from the owner's two images; their background was already fully transparent (no white edge), but the figure itself was about 1% see-through (alpha 252), so it was made fully opaque.
- **"Add vehicle"** is inside the opened Fleet line, under its vehicles; the product page's Units tab already had it.
- **Reorder mode:** the always-on Move up and Move down buttons are gone. "Reorder" above each list (owners and managers, `?reorder=1`) shows small, quiet arrows on each row (44 px to tap), hides the pencil, stops a Fleet line opening and the Products name being a link, and offers "Reset to A–Z" and "Done". The arrows sit in their own last column, with a marked place for a drag handle (`MoveButtons` in `components/fleet/order-controls.tsx`).
- **Sort:** A–Z, By type and My order above each list, in the address (`?sort=az|type`). A–Z and By type are views of one list and never change the other list or the saved order; My order is the shared manual order (A to Z while the shop has none) and is the default. **"By type" is kind, then category**, in the order of `lib/vehicle-kinds.ts`: Motorbike (Scooter, Touring, Adventure, Sport, Classic, Off-road), Car, Off-road, Boat or jet ski, Other. A product with several categories sorts under its first; one with none after its kind's categories; then A to Z. On Products, general products come after the vehicles: Rental gear, Items for sale, Services.
- **Filter chips** above each list, scrolling sideways on a phone: All, then only the kinds and categories the shop has (on Products' General tab, the general types). A kind gets its own chip only when the list holds more than one kind, so a motorbike-only shop sees Scooter, Touring, Adventure… The chips keep the search and the search keeps the chip. The Kind and Category dropdowns in Filters are gone (the chips replace them); the kind still works from an address (`?kind=car`).
- **Row colours:** the alternating brown shading is gone; rows are split by the theme's border colour, which works on light and dark.

**Honda Spacy shows a boat (investigated on staging, read only).** Its saved kind is Boat: staging's audit trail (row 913) shows it was created that way on 11 Nov 2026 at 13:06 UTC by a signed-in person, with make Honda, model Spacy, no engine size and no transmission, and never changed since (its five later changes are manual-order moves). It was created between commit `aedbb20` (19:48 +07, a motorbike needed an engine size and a transmission) and `2154111` (20:55 +07): a motorbike without those couldn't be saved then, and Boat could. The icon code is right: a boat shows a boat, a missing kind shows Other. That rule has been gone since the 13 Nov rework, so nothing in the code needs changing; `rowIcon` in `lib/product-list.ts` now holds the mapping, with tests. **To fix the record:** open Honda Spacy, choose Motorbike and Scooter, Save (not done here: it is staging data).

**Appearance bug (fixed).** On a phone set to dark, Light and Dark did nothing and Match device turned the app light. Cause: the root layout puts `dark` on `<html>` only when the saved choice is Dark, and a script in `<head>` adds it for Match device on a dark phone, on a full page load only. Choosing an appearance re-renders the layout without a reload, and React rewrites `<html>`'s class only when its own server value changes. Match device → Light: the server value was the same (no `dark` either way), so the script's `dark` stayed. Light → Dark: `dark` was already there, so nothing changed on screen. Dark → Match device: the server value lost `dark`, so the app went light on a dark phone. Fix: `components/theme-sync.tsx` sets the class from the choice and the device every time the choice changes, and follows the device while Match device is on. After a reload it was always right.

**Decided here without being asked** (say if any should change)

- **"Needs changes"** (Moto Mangos turned a request down) shows the grey mango with a small red dot, named "Moto Mangos needs changes". The instruction named three states; the old chip had four.
- **The mango is for owners and managers only**, like the chip before it. Staff, mechanics and drivers see no Moto Mangos state.
- **Reorder** opens the whole list in My order: from A–Z or By type, or with a search on, the button goes to the unfiltered list in My order. `?reorder=1` on a filtered or other-sorted list is ignored.
- **The sort is not remembered** between visits (it is in the address only); My order is the default.
- **"Filters (n)" leaves out the chip:** the count is only what is in the Filters panel.
- **The full name** is in a tooltip on the row (desktop) as well as on the product page.
- **The kind tag** shows on wide screens on both lists (Fleet showed categories only before).
- **Unchanged:** "Showing 11 of 15" on the Vehicles tab counts the shop's products on all tabs, as before.

**After the owner's click-through (14 Nov 2026, second round).** All eight checks passed; three changes:

- **Back link returns to where you came from.** A product page opened from Fleet says "‹ Fleet" and returns to Fleet with the same search, chips, sort, the lines that were open, and the scroll position; from the Products list it says "‹ Products" and returns there as it was. Opened any other way: "‹ Products", to the Products list. The list's address travels in `?back=`; `backTarget` in `lib/product-list.ts` accepts only this shop's `/fleet` or `/products` (with its query), and anything else (another site, `//host`, another shop, another page, a fragment, over 4,000 characters) falls back to Products. The product page's tabs and "Duplicate" keep it, and so does the "Add vehicle" page opened from a Fleet line. `components/fleet/list-return.tsx` adds the opened lines (`open=`) on a plain click and keeps the scroll position for the browser tab (session storage; without it, the list opens at the top).
- **"Add vehicle"** is a solid brand-colour button with its + icon, 44 px tall: the only solid button in an opened line.
- **Fleet groups:** a product's line and its vehicles share one background; the next group has the other shade, by turns (`--group-alt`: #ececee light, #2b2b30 dark; neutral greys, not brown). Vehicles sit inset under their product, with a 2 px brand-colour line down the left and slightly smaller text. Lines stay one height; Reorder mode and the drag-handle spot are unchanged. The Products list keeps one background.

**Decided here without being asked (second round):**

- Only lines someone opened go in `open=`; lines open anyway (a search, a filter, 12 lines or fewer) are not listed, which keeps the address short. A line someone closed among those opens again on return.
- The scroll position is kept per browser tab, not in the address.
- The "Add vehicle" page's back link returns to the list too (Fleet otherwise, as before). The product page's own "Add vehicle" (Units tab) and the Stock tab's link to Product details are unchanged.
- A link opened in a new tab (Ctrl or Cmd click) still carries the list's search, chips and sort, without the opened lines.
- The accent line is the brand colour at 60%, also down the "No vehicles yet" note and the "Add vehicle" strip, so the whole group reads as one.
- `BackLink` gained a `data-back` marker for tests.

**Tests**

- Unit: `lib/product-list.test.ts` (sort, By type, chips, the row icon including the Spacy case, the mango) and `isDarkTheme` in `lib/preferences.test.ts`.
- Browser (375 px and 1280 px): `e2e/lists-mobile.spec.ts`: rows two lines and equal height on Fleet and Products, long names and year ranges on one line (cut short on a phone), the icon by saved kind, the mango and its name, tags hidden on a phone, no alternating shading, "Add vehicle" inside the opened line, Reorder mode, the sort, the chips with the search, the appearance on a dark and a light device and after reloads, and screenshots of Fleet and the three Products tabs in light and dark (attached to the run). Updated: `fleet.spec.ts`, `products.spec.ts` and `products-stage-b.spec.ts` (the mango instead of the chip, chips instead of the dropdowns, Reorder mode for the manual order).
- **Run locally (14 Nov 2026):** typecheck, lint and 189 unit tests pass. The browser suite on a local production build: everything this branch touches passes at both widths. Two Stock tab tests (`stock: staff mark helmets…`, `tracked gear…`) fail locally only because the shared local database had another branch's migration applied (`20261114000100_platform_gear_stock_rework`, from `platform/gear-stock-rework`); this branch has no migration and doesn't touch that tab. `print stickers` failed once of three runs (the page is unchanged here). CI, which builds its database from this branch, is the check.
- **After merging `main` with PR 18 (14 Nov 2026):** conflicts only in this file, the Thai review file (kept both sections) and a test's header comment. Typecheck, lint, unit tests (202 + 206 + 86) and database tests (251) pass. The full browser suite: 92 passed, 3 skipped, 1 failed: the Fleet test's "kind=car shows nothing" step, because another test adds a temporary car to the same shop meanwhile. The step now checks that the shop's motorbikes are filtered out instead; it passed 4 of 4. The two Stock tab failures noted above are gone (the local database and the branch now agree).
- **Second round, run locally (14 Nov 2026):** typecheck, lint, unit tests and the Fleet, Products and lists browser specs pass at 375 and 1280 px (61 tests). New: `lib/product-list.test.ts` (back target, `withBack`, `open=`); `e2e/lists-mobile.spec.ts` (group shades alternate and are neutral, vehicles inset with the line, Add vehicle solid and 44 px, back link from Fleet with sort, opened line and scroll, through the tabs and Duplicate, from "Add vehicle", from the Products list, and the fallback for odd addresses); screenshots now include Fleet with its lines open. Older tests now allow `?back=` on a product's address.
- **Working note:** this branch was built in its own worktree (`.claude/worktrees/lists-mobile-polish`) because another session was editing the main checkout at the same time.

## Products, stage B (branch `platform/products-stage-b`, 13 Nov 2026)

General products: rental gear, items for sale, services. Built to `docs/products-redesign.md` §5.7 with the owner's twelve confirmations of 13 Nov 2026 (decision 21 there). Platform only: nothing in `apps/marketplace`. On staging; **not on live**. `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **One new migration, `20261113000300_platform_products_stage_b`.** The Stage A migration is untouched. It adds: unit rules per type; the unit status `lost`; `products_general_fields_check` (a general product stores no buffers and no deposit); the stock functions; the two lock helpers; the table `stock_movements`; `products.sort_position` with `move_product()` and `reset_product_order()`; and `change_listing_entry()` and `disconnect_listing()`. Details in `docs/products-redesign.md` §5.7 "As built".
- **Create page:** "New product" opens with two choices, Vehicle and General. Vehicle is the form as it was. General asks for the type (Rental gear, Item for sale, Service or extra), a name and a description; gear and items for sale get a quantity per location, a service none. No kind, licence class, minimum age, buffers or deposit on it.
- **Products list:** All, Vehicles and General tabs. A general row shows its type and stock ("18 in stock, 2 lost"; a dash for a service), with the same edit pencil and tag area as every other line. The kind, category and Moto Mangos filters are on All and Vehicles only.
- **General product page:** Details, Stock and History. Stock is the quantity per location. "Change quantity": owners and managers. "Mark damaged" and "Back in use": owners, managers, staff and mechanics. "Mark lost": owners, managers and staff; a mechanic is refused. "Found, back in use" and "Write off" for a lost unit: owners and managers (first built as "Back in stock" and "Remove for good"; renamed in the second round, below). Tracked gear ("Track each unit on its own") shows one line per unit with an optional label and the same actions on the line. An item for sale shows what is on hand and its stock history. A service has Details and History only.
- **Moto Mangos panel:** a product on an approved list entry has "Change model" (the same Make, then Model dropdowns and a Select button) and "Disconnect" (asks first; switches the listing off and clears the entry). Owners and managers only; both audited and in the product's History.
- **Manual order, step one:** one order per shop, shared by Fleet and the Products list. "Move up" and "Move down" on each line, "Reset to A–Z" (asks first) above the list while the shop has its own order. A to Z by default; a new product goes to the bottom of a custom order; owners and managers only, everyone else sees the saved order; the buttons are gone while a search or filter is on. General products take part. No dragging: proposed as a follow-up in `docs/products-redesign.md` §5.8 (dnd-kit; the library needs the owner's approval).
- **Wording:** 123 new texts in English and Thai (the second round changed or added 24 and removed 8); the Thai ones are listed in `docs/platform/thai-review-products.md` under "Stage B" for Korn or BSR's admin. `Products.type.service` changed from "Service" to "Service or extra".

**Existing bookings made through Moto Mangos, when a model is changed or disconnected: left exactly as they are.** Neither function touches a vehicle or a block, so a booked vehicle stays booked for its dates. The panel says how many bookings on the product's vehicles have not ended, and the Disconnect confirmation says they stay. Refusing while bookings exist was the other choice; it would stop a shop coming off Moto Mangos while one booking was outstanding. Orders don't exist until Phase 3, so this is tested with hand-made booking blocks. **To carry into Phase 3:** an order keeps its own copy of what the customer booked (make, model, years), because the product may point at another list entry, or none, by pickup day.

**Decided here without being asked** (say if any should change)

- **A mechanic may mark gear damaged.** The instruction lists "Mark damaged" for owners, managers and staff and says a mechanic is refused on lost. The design's table (§4.2) and the database's downtime rule let a mechanic mark damage, so only "Mark lost" is kept from mechanics. One line in `lib/roles.ts` and one in each function if it should be staff only.
- **"Lost" is on screen for gear only.** The database takes the status for any unit; a vehicle's status control is unchanged in this stage.
- **Disconnect** also clears the make, model, engine size and transmission that were copied from the list entry, sets the listing quantities to zero, and is refused while a request for the product is still waiting for review. **Change model** keeps the listing switch and its quantities.
- **A general product stores no deposit either** (the instruction named buffers). The deposit is per vehicle in the design.
- **Limits:** 1,000 units of one gear product in one location; 100,000 of an item for sale.
- **Lowering a quantity** removes free units, unlabelled ones first, and refuses with the lowest quantity it could reach ("2 units are damaged or booked, so the quantity can't go below 2").
- **Deleting:** a gear product goes once its quantity is 0 and no lost unit is left; an item for sale once nothing is on hand (its stock history goes with it).
- **"Mark damaged" can take a "back in use on" time**, and there is a "Back in use" action to undo it. Damage is stored as downtime, as for a vehicle.
- **The first move saves the whole shop's order** as it is on screen, with the one change. On Fleet, which shows vehicles only, a move passes over any general product that sits between two lines.
- **Tabs are views, not filters:** the order can be changed on All, Vehicles and General. A search or any filter turns the buttons off.
- **A to Z is now the same on both lists** (numbers in order, case ignored). The Products list sorted slightly differently before ("PCX 10" came before "PCX 2").
- **A service, for someone who doesn't set the shop up,** shows its description and "You can view this product but not change it."
- **No "Duplicate" on a general product**, and **no demo general products in the seed**: the click-through adds them.
- **Not built, though the design mentions it:** a `sku` column for items for sale (§5.5), and categories for gear (§1.2). Neither was in the confirmations.
- **Names:** the migration is `platform_products_stage_b` (the design said `platform_gear_units`; it now carries the order and the Moto Mangos functions too). `set_quantity_out()` became `mark_units_damaged()` and `mark_units_repaired()`.

**Stage A's tests**

- Stage A's browser tests (`e2e/products.spec.ts`, `e2e/fleet.spec.ts` and the rest) and unit tests are unchanged and pass.
- Stage A's database tests are unchanged and pass, with one file touched: `tests/db/tenant-isolation.test.ts`. That harness fails by design until a new table has a fixture, so `stock_movements` got its fixture, payload and change, and the table list one more name. The fixture needs a second product per shop (an item for sale), so one existing assertion, "still shows members their own tenant", now compares the distinct shop ids it sees instead of the exact list. Nothing else in it changed.
- `tests/db/default-grants.test.ts` gained a block, as asked: `stock_movements` is select and insert for members and nothing for signed-out visitors, and each of the 21 new functions is listed with who may run it.
- **The loosened assertion still catches a leak, checked by opening one.** On the local database, a policy letting any signed-in user read every row was added to `products`, then `units`, then `stock_movements`, and `product_stock()` was made to skip row-level security, one at a time. Each made tests fail (7, 8, 6 and 2 of the 67 in the two files), "still shows members their own tenant" among them for products and units; with the leaks removed all 67 pass.
- Two of Stage A's database tests shaped the migration: "a unit can't claim a type its product doesn't have" expects the foreign key's refusal, so the gear half of the unit rule is a trigger that runs after the keys (`units_gear_fields`), not a check; and "nothing is named after models" is why the function is `change_listing_entry`.

**Tests (all passing locally, 13 Nov 2026)**

- Database: 227, unchanged by the second round (185 before; 40 new in `products-stage-b.test.ts`, 2 in `default-grants.test.ts`). Run on a database built from scratch with all 56 migrations, and again on one migrated from Stage A with demo data. New: unit rules per type; quantity up and down by role; the refusal when units are blocked; damaged and lost by role; restore and remove; the ledger (append-only, never below zero, who did it); the manual order (role, per-shop isolation, persistence, new at the bottom, reset); change model and disconnect (role, isolation, audit, bookings untouched); another shop refused everywhere; and the stock ledger and stock counts shop against shop for every role, reading and writing (owner's request, 13 Nov). Races: twelve writers, six lowering a quantity while six block units, three rounds; two people setting different quantities at once; twelve staff marking the last free helmet damaged.
- Unit: platform 175 (145 before; 30 new in `lib/general-products.test.ts`, 8 of them in the second round), marketplace 202, core 86.
- Playwright: 81 passed at 375 px and 1280 px, 3 skipped (the two timing measurements, and the desktop twin of the manual-order test). New, at both widths: Vehicle or General and one product of each general type; the three list tabs; staff mark 2 damaged and 1 lost, a mechanic isn't offered "Mark lost", a driver nothing, the owner confirms the loss; tracked gear with labels; Change model and Disconnect; the manual order on the Products list and on Fleet, kept after a reload, new product at the bottom, off under a search, read-only for staff, Reset to A–Z.
- `npm run typecheck && npm run lint && npm test` from the root: clean.

**Second round, after the owner's click-through of PR 17 (14 Nov 2026)**

Everything passed except the Stock tab, where the owner could not tell how "Remove for good" and "Back in use" related. Changed, wording and layout only:

- **Three states, each under its own heading** with its count and one line of help: In use, Damaged, Lost. The actions that belong to a state sit under its heading; Damaged and Lost appear once something is in them. Tracked gear lists each unit under the heading of the state it is in.
- **Labels.** Damaged: "Back in use". Lost: "Found, back in use" (was "Back in stock") and "Write off" (was "Remove for good"). The owner's suggested wording was used as given.
- **Help lines.** "In use: available to rent. Mark a unit damaged while it is cleaned or repaired, or lost if it is missing." "Damaged: not available to rent, but still counted in your stock. Mark it back in use when it is ready." "Lost: not available to rent and not counted in your stock. Mark it found to put it back in use, or write it off to remove it permanently."
- **"Write off" asks first:** "Write off? This cannot be undone. The unit leaves this product's stock counts for good and can't be marked found again. The History keeps a record."
- **History uses the buttons' words**: "marked 2 damaged", "put 2 back in use", "marked 1 lost", "marked 1 found, back in use", "wrote off 1"; and for tracked gear one line per unit ("wrote off unit GoPro 3").
- **Permissions: exactly as they were. Database: not changed.** No migration, nothing pushed to staging. Function names and audit action names are as built; only the words shown changed.

What the round found and fixed beside the wording:

- **A tracked unit that was written off had no line left in History.** Its row is deleted, and History looked units up by the rows that exist. History now reads a tracked product's unit lines from the audit trail by product, so a written-off unit keeps its lines and its label. The same change puts "Mark damaged" and "Back in use" on a tracked unit into History, which were not shown before.
- **A screen-reader fault introduced and caught in this round:** the Damaged and Lost headings shared an id with a field below them, so each part was announced as "2" or "1". The browser test that looks parts up by name failed on it; the ids are now distinct.

Decided here without being asked:

- **"Mark lost" stays under In use for counted gear** and takes a damaged unit only when no other is free, as before. For tracked gear it is also on a damaged unit's own line.
- **The unit's state chip on a tracked line reads "In use"** (was "Available"), to match the heading.
- **The confirmation says the unit "leaves this product's stock counts"**: a lost unit is already out of "in stock", so what it leaves is the "lost" count. Say if the sentence should name that.
- **Thai for "Write off" is ตัดจำหน่าย**, the accounting term. It is flagged in the Thai review file as the word to check first.

Tests in this round: 8 new unit tests (the labels, the three help lines, the confirmation, History's words, and tracked-unit history from audit rows); the two Stock browser tests rewritten around the three states, checking each heading, its help line, exactly which buttons sit under it for each role, the confirmation text, and History. Docker Desktop was not running at the start of the day; it was started and the local database rebuilt from scratch (56 migrations) and seeded before the runs.

**Demo data carried across.** A database at Stage A (55 migrations) was seeded with the three demo shops, given two listed products and three downtime blocks, and migrated. Per shop, before and after: products 5 / 11 / 0, vehicles 150 / 20 / 0, year bands 15, listed 2, blocks 3, renewals 8, purchase records 20, audit rows 177 / 86 / 5, and checksums over every product (id, name, make, model, list entry, categories, listing, type, tracking, buffers, deposit, retired), every vehicle (id, product, plate, status, type, odometer, frame, year) and every block: identical. All 16 products are still vehicle / unit and all 170 units vehicle units.

**On staging, not on live (13 Nov 2026).** Staging records 56 of 56. Live stays at 53 of 53 and gets PR 13's, Stage A's and this migration only from `main`, by the runbook, after stage C.

- Pushed from this branch on the owner's instruction with `supabase db push --db-url`, after a dry run that listed exactly one pending migration (`20261113000300`).
- Staging's data came through unchanged: the same counts and checksums before and after (big-fleet 9 products and 150 vehicles, bsr 20 and 26, saigon-scooters none; year bands, listings, blocks, renewals, purchase records and audit rows the same). All 29 products are vehicle / unit and all 176 units vehicle units.
- **Staging matches a fresh build:** its `platform` and `platform_private` schemas, dumped with their grants, are line for line identical to a database built from the migration files (3,655 lines each).
- The demo seed was not re-run: it did not change.
- Until this PR merges, the platform site's main deploy runs Stage A's code against staging. That works: the migration only adds to what Stage A reads.

**Not truly tested**

- The full browser suite ran on a local production build with a local database, and in CI; not against the Netlify preview.
- A real phone: phone width in a desktop browser only. Thai wording: key and placeholder parity only.
- Anything that needs an order: a booking made through Moto Mangos is a hand-made block here.
- The live push: not done, by instruction.

**Found on the way**

- Ports 3300 and 3310, which the browser tests and an earlier session used, were held by servers from other checkouts. The tests ran against this checkout's own server on port 3320.
- One write of `messages/en.json` failed once with "Invalid argument" (the folder is in OneDrive) and worked on the second try. Both files were checked afterwards.

**Next:** the owner's click-through of the preview; then stage C (`product_listings` and the Moto Mangos tab), and dragging (§5.8) if the library is approved. (Dragging was approved and built on 14 Nov 2026: see "Dragging to reorder" above.)

## Products, stage A (branch `platform/products-stage-a`, 13 Nov 2026)

The first build stage of the products redesign. The design and the owner's decisions are in `docs/products-redesign.md` (PR #15, docs only). Platform only: nothing in `apps/marketplace`, nothing pushed to staging or live. `docs/platform/SPEC.md` does not have this yet (the owner maintains it).

**What changed**

- **`platform.models` is `platform.products`** (migration `20261113000200_platform_products`), with `units.model_id` → `product_id` and `model_year_bands` → `product_year_bands`, and their constraints, indexes, triggers, policies and trigger functions renamed to match. PR 13's migration (`20261113000100`) is untouched.
- **A product has a `type`** (vehicle, gear, sale_item, service) **and a `tracking` mode** (unit, bulk, consumable, none). Only the pairs that make sense are accepted, the type can never change, and every existing row is a vehicle tracked by unit. Make, model and kind are required for a vehicle and must be empty for anything else (`products_vehicle_fields_check`), so those three columns are no longer NOT NULL.
- **A unit carries its product's type** (`units.product_type`), kept equal by a composite foreign key. Only vehicles and gear can have units.
- **Functions re-created: ten, not the fifteen the design guessed.** Read from the database, these name the old table or column in their bodies: `products_guard`, `products_retire_guard`, `products_withdraw_request`, `units_clamp_product_counts`, `units_product_not_retired`, `tenants_lock_currency`, `currency_locked`, `import_fleet`, `review_catalog_request`, `submit_product_to_catalog`. Two more were only renamed (`products_keep_catalog_outcome`, `products_default_category`). `units_guard`, `unit_blocks_guard`, `catalog_requests` and the reminder queue never named the table and are unchanged.
- **`submit_model_to_catalog(p_model_id)` is `submit_product_to_catalog(p_product_id)`**: dropped and created again (a parameter name can't be changed in place), with its grant restated. `import_fleet()` reads `product_id` from each unit and answers `{"products": n, "units": n}`.
- **Audit rows written before today were relabelled** from entity `models` to `products` (and `model_year_bands` to `product_year_bands`), so a product's history is found in one place. Nothing else in those rows changed. Say if the old label should have been kept.
- **Grants:** no new table. The renamed tables keep their grants; the migration restates them under the new names, because `default-grants.test.ts` looks for each reachable table's grant by name.
- **Screens.** New **Products** list (`/[tenant]/products`: one row per product with type, kind, categories, vehicles in the fleet and the Moto Mangos chip; search and filters in the address). The product page has three tabs: **Details** (the form, the Moto Mangos panel, retire and delete), **Units** (its vehicles, "Add vehicle", year bands) and **History**. **Fleet** keeps the vehicle-unit list, the unit page, stickers and import. "Products" is in the menu before "Fleet", for every role.
- **The create form is a kind and a name** (second round, below). The first version of this stage had one make-and-model type-ahead here; the owner's click-through removed it. The linked dropdowns, "Manually enter" and "Choose from the list instead" are gone either way.
- **History tab** (owners and managers): who changed what on the product, its vehicles and its year bands, newest first, the latest 100. It is the first screen that shows the audit trail to a shop.
- **Old addresses redirect:** `/fleet/models/[id]` and `/fleet/models/new`; `/fleet/units/new?model=` still works beside `?product=`.
- **Wording:** "product" in place of "make & model" and "model"; "Add vehicle" in place of "Add to inventory" and "Add product to inventory" (the owner chose those two names on 13 Nov, before the redesign: say if "Add vehicle" should go back). Thai uses สินค้า, provisional; every new or changed Thai line is in `docs/platform/thai-review-products.md` for Korn or BSR's admin.
- **Kept from the fleet rework:** categories (several per product, required for motorbikes and cars), retire and restore, the delete rules, the rejected-model flow with its two next steps, the Moto Mangos tip on the create form and the panel on the product page.

**Second round, after the owner's click-through (13 Nov 2026)**

Stage A passed except for the create form. Changed on the owner's instruction:

- **Create form:** headed "Product details". The kind ("What kind of product is it?"), one line for the product name (placeholder "e.g. Honda PCX 160", required), then categories and the rest. The type-ahead and the make, model, engine size and transmission inputs are gone from it.
- **Names are unique ignoring case and all spacing** (`products_name_idx` now on the name with every space removed, in lower case; before, lower case and trimmed only). "Honda PCX 160" and "honda pcx160" are one name.
- **Make, model, engine size and transmission stay as columns, nullable.** Migrated demo data keeps its values. A motorbike no longer needs engine size and transmission to be saved: `products_required_specs_check` (from `20261111000500`, which is on live and so can't be edited) is dropped by the Stage A migration. A make and a model come together or not at all.
- **Moto Mangos panel:** sending a motorbike for review now asks for make, model, engine size and transmission at that moment, all four required, with the model years and note as before. The make and model start from the product's name; a rejected product's form holds what was sent before. `submit_product_to_catalog()` takes the four with the request and saves them on the product and the request in one transaction; without all four it answers `specs_required` and saves nothing. "Did you mean" suggests list entries from the name until the product has a make. Choosing an approved model from the list, the rejected-model buttons and the listing switch work as before; "Edit and send again" now opens the review form (`#send-for-review`).
- **On a list entry, or waiting on one, the kind is fixed**: the Details form shows the name and categories, not the kind chips (the database already kept the entry's kind).
- **Tip on the create form:** one text for motorbikes, saying the model is chosen or sent for review from the product page. It no longer speaks of a list on this form.
- **Off-road has Dirt bike** beside ATV and UTV (`dirt_bike`; Thai รถวิบาก, for approval). The motorbike category "Off-road" is unchanged.
- **The Stage A migration was amended in place** (not on `main` or live), on the owner's instruction: the vehicle-fields check, the dropped specs check, the two indexes and the submit function. Nothing from an earlier migration was edited.
- **Staging, by hand, exactly this:** in one transaction, `products_vehicle_fields_check` was dropped and re-added with the new rule; `products_required_specs_check` was dropped; `products_own_make_model_idx` and `products_name_idx` were dropped and re-created; `submit_product_to_catalog` (5 arguments) was dropped and the 9-argument one created with its grant. The statements were cut from the migration file itself. The migration stays recorded as applied (55 of 55). This differs from earlier rounds, where a migration was taken back whole and pushed again: taking back the rename of every fleet table was the larger risk, and the result is the same. Checked: staging's `platform` and `platform_private` schemas, dumped with their grants, are line for line identical to a database built fresh from the amended migration (1,622 lines each); staging's data counts and checksums are identical before and after; no duplicate names stood in the way. The demo seed was re-run: nothing added. Live is untouched.
- **Left as it was:** the CSV import still takes `make` and `model` per row and, for a motorbike that isn't on the list, still asks for `cc` and `transmission`. It is the bulk path and was not part of this change; say if it should take a name only too. The unit form still has a Make dropdown above the Product one; a product with no make is chosen from the Product dropdown directly.
- **docs/products-redesign.md** (merged with PR #15, brought in from `main`): decision 3 (the type-ahead) is marked superseded by new decision 17; the create-form and type-ahead paragraphs are rewritten; decision 18 and §5.7 record the Stage B direction and plan (not started).

**Third round, after the owner's second click-through (13 Nov 2026)**

- **The "Vespa GTX300" report** (sent to Moto Mangos without seeing the details form). Staging's audit trail shows the product was created with a name only at 05:32 UTC and sent at 05:39 with make Vespa, model GTX300, 300 cc and automatic: the engine size and transmission can only have come from the review form, so the form was on screen and was filled in. It sat open inside the panel with the make and model already filled from the name and the button reading "Switch on and send for review", which did not read as a separate step. Fixed by the new panel order below: the form is closed until "Don't see your bike above?" is opened, and nothing can be sent before that. Browser test: the send button and the year field are hidden, and "Sent" never shows, until the line is opened; the server refuses a request without all five details.
- **Review form: "Year of your bike"**, one required year, beside make, model, engine size and transmission. The shop no longer enters a year range. `submit_product_to_catalog()` takes `p_year` in place of `p_year_from` and `p_year_to` and refuses without it; the request is stored with that year as both ends of its range. **The range is set at approval**: `review_catalog_request()` takes `p_year_from` and `p_year_to` (left out, the bike's year stands), and the Moto Mangos admin page shows "The shop's own bike is a 2023" with first and last model year to set before approving. No table changed: `public.bike_catalog` already had both year columns.
- **Moto Mangos panel, top to bottom:** the logo; "List it on Moto Mangos"; one picker, "Select your make and model from the list" (the approved list, A to Z, with years); "Don't see your bike above? Send us the details and we'll get it added", which opens the review form; then "Listing": the switch and the instant, request and ready-now counts, disabled with a line saying why until the product is on an approved entry (a model selected, or a request approved).
- **Buffers are typed in hours**, decimals allowed ("0.5", "1,5"), up to 168; stored in minutes as before (`buffer_before_minutes`, `buffer_after_minutes`: no migration). What was saved in minutes reads back to the nearest hundredth of an hour.
- **Retire product and Delete product** are the last things on the product page.
- **No make or model on the platform's screens.** Removed: the make and model line under a product's name, the engine size and transmission beside it, the Make dropdown on Add vehicle and on stickers (each is one Product dropdown, A to Z by name), the make, engine-size and transmission filters, group-by and sort on Fleet, the make and model search on Products (it searches the name), the "Make" line on a vehicle's page, the list of makes and models on the import page, and make, model, engine size, transmission and list entry in a product's History. A product without a make shows nothing in its place. "Model year" on a vehicle reads "Year". The only place the five are asked is the Moto Mangos review form; the database columns stay, nullable.
- **CSV import takes a product name per row** (`product`, required): a name the shop has puts the vehicle on that product, ignoring case and spacing; a new name creates the product, with `vehicle_type` (blank is motorbike) and `category` (required for a motorbike or a car). No make, model, cc or transmission column; `model_year` is `year`; `name` is gone. The page tells the shop to put the make, model and years in the name or description if it wants them. `import_fleet()` in the database is unchanged: it simply receives no make or model.
- **Fleet is one line per product**, A to Z by name, no group headings: the product's name, "N vehicles · M available", "Open product" and "Add vehicle". A line opens to its vehicles. One search box finds a product by name or a vehicle by plate, frame or engine number. Filters: show, product, kind, category, status, location (with more than one), year. A retired product is not in the product dropdown.
- **Create-form placeholder:** "e.g. Honda CB500X 2022-2024".
- **Duplicate** on the product page opens the create form with the product's kind, categories, description, online-booking tick, buffers, deposit, minimum age and licence class, and its name filled in and selected. It copies no vehicles and no Moto Mangos listing. Saved under the same name it is refused, as any duplicate name is.
- **The Stage A migration was amended in place again** (not on `main` or live): only the two functions above. **Staging, by hand, in one transaction, exactly this:** `review_catalog_request(uuid, boolean, text, uuid)` dropped and the six-argument one created with its grant; `submit_product_to_catalog` (nine arguments) dropped and the eight-argument one created with its grant. Texts cut from the migration file. Afterwards staging's `platform` and `platform_private` schemas with their grants are line for line identical to a fresh build (1,628 lines each), its data counts and checksums unchanged, the migration still recorded as applied (55 of 55), the demo seed re-run with nothing added. Live untouched.

Decided here without being asked (say if any should change):

- **"Did you mean" is gone** from the panel. The owner's order has one picker and one review form; a third way to choose would have sat between them.
- **The listing counts moved** from the Details form into the panel's "Listing" part, with the switch. They were the "listing settings" the owner placed there.
- **The year-band panel is gone from the product page.** Fleet no longer splits a product by year band, so the setting had nothing to act on. The table and its data are kept.
- **Fleet lines start closed** when more than 12 vehicles would show, and open when a search or filter is on. The Moto Mangos chip is on the Products list only. The remembered last view (a cookie) is gone with group and sort.
- **"Available"** is an active vehicle that no block (downtime, later a booking) holds at this moment.
- **A new product from the CSV needs its kind and category** in the row, because the name alone can't say what it is.
- **The demo seed** (`scripts/demo/bsr-fleet.csv`) is in the new shape. The seed then puts each demo product on the Moto Mangos list entry its name starts with, as a shop would with the picker, so the demo still shows listed-ready products.
- **A product's page shows no make or model even when it is on a list entry.** The panel's line "On the Moto Mangos list as Honda Forza 350 (2023)" is the one place it is named.

Still depending on make and model, and left alone (nothing a shop sees):

- `products_guard` copies make, model, engine size and transmission from the list entry onto a product put on it; `review_catalog_request` on reject keeps a product linked if the shop has another of its own with the same make and model; `products_own_make_model_idx` still stops two own products with the same make and model where both have one. All three only act on products that have been through the Moto Mangos panel.
- Staging and demo products keep the values they had.
- `lib/catalog-match.ts` (used by the Moto Mangos admin page to offer merge targets), and `ownModelSchema` and `exactPresets` with their unit tests, are no longer used by any shop screen. Kept; removable in a tidy-up.
- The marketplace adapter switch (3M) will read a listed product's make, model and specs through its list entry, as planned.

**Fourth round, after the owner's third click-through (13 Nov 2026)**

Items 3 to 7 of the third round passed. Changed now (no migration and nothing on staging needed changing this round):

- **The Moto Mangos panel shows for motorcycles only**: the kind Motorbike, with any of its categories (Scooter, Touring, Adventure, Sport, Classic, Off-road). It is hidden, not greyed, for the Off-road kind (ATV, UTV, Dirt bike), Car, Boat or jet ski and Other; the product form then takes the page's width. The tip on the create form and the Moto Mangos chip follow the same rule, as before. **No listed product can lose its panel:** a product is listed only on an approved list entry, an entry is always a motorbike, and the database keeps a product's kind equal to its entry's, so a product on the list is always a Motorbike. Checked on staging: 0 products that are not motorbikes are listed or on a list entry, and 0 list entries are not motorbikes. Nothing had to be changed.
- **Listing texts.** "Set bike quantities per booking type", then three lines, each with its field: Instant units ("Future bookings that receive instant approval"), Request units ("Future bookings that require your approval"), Walk-ins ("Bookings that are ready for immediate pickup today (overrides the lead time)"). The old sentence is gone. The field was labelled "Ready for walk-ins now".
- **The list picker is two dropdowns**: Make, then Model with the years it covers, the second filtered by the first and disabled until a make is chosen. Its legend is still "Select your make and model from the list"; the button reads "Select". This is the Moto Mangos list only; the rest of the platform still has no make or model.
- **Delete only, and only when empty.** "Retire product" is gone from the product page. "Delete product" is always there, last on the page. With any vehicle left, whatever its status, it shows a pop-up, "This product still has vehicles. Remove all its vehicles first.", and does nothing. **The database already refused this** and still does: a vehicle points at its product (`units_tenant_id_product_id_type_fkey`), so a delete with any vehicle left fails for everyone, the service role included; the server turns that refusal into the same sentence. No new rule was needed, so no migration change. The retired status stays in the database (`products.retired_at` and its rules), and a product that is already retired still shows its "Retired" note with "Restore product", so it is not stuck.
- **Fleet lines carry the same tags as the Products list**: Retired, the Moto Mangos chip (owners and managers; motorcycles), and the categories. One shared component draws both.
- **The edit pencil** replaces "Open product" on Fleet and is added beside the title on the Products list. It is a link named "Edit product: <name>", 44 px square, with a focus ring. On the Products list the title is also a link to the product; the whole row is no longer one link.

Can a product be undeletable? Today, no: no vehicle has bookings yet, so every vehicle can be deleted and then its product. From Phase 3, a vehicle with bookings can't be deleted (past orders need it), so its product can't be either until the planned "Remove for good" step exists. The pop-up says the same sentence in that case; it does not yet say that a vehicle with bookings can only be retired. That wording belongs with Phase 3.

Decided here without being asked:

- A product that is already retired keeps "Restore product" (there is no other way back from that state on screen).
- The pop-up is the browser's own message box, like the confirmations already used on these pages.
- The retired-product browser steps (retire, see it under "Retired", restore) are gone with the button. The rules are still tested in the database and unit tests.

**Not built: manual order (drag to reorder, item 7).** The owner asked to be told before building if it looked risky or too big for this PR. It is both, for one part: long-press and hold-and-drag on lines that are also buttons (a Fleet line opens on a tap and holds links), working alike on phone and desktop, with a browser test for touch dragging that doesn't flake. The repo has no drag library, and adding one needs the owner's say (root CLAUDE.md). Proposed split: first the dependable part (a `sort_position` on the product, one function to move a product or reset to A–Z, owner and manager only, both lists reading the one order, "Move up" and "Move down" on each line, "Reset to A–Z", new products at the bottom, off while a search or filter is on), with its database and browser tests; then dragging on top of that, either hand-written or with a small library the owner approves. Waiting on the owner's choice.

**Demo data carried across.** A database built at `main` (54 migrations) was seeded with the three demo shops, given two listed products and three downtime blocks, and migrated. Per shop, before and after: products 5 / 11 / 0, vehicles 150 / 20 / 0, year bands 15, listed 2, blocks 3, renewals 8, purchase records 20, audit rows 174 / 89 / 5, and checksums over every product's id, name, make, model, list entry, categories and listing, and every vehicle's id, product, plate and status: identical. All 16 products came out as vehicle / unit and all 170 units as vehicle units.

**Decisions and notes**

- Existing database tests whose assertions changed, not just a name: a vehicle without a kind (or with a make and no model) now fails `products_vehicle_fields_check` where a missing make failed NOT NULL; and "a motorbike needs engine size and transmission" became "specs are optional on a product", because the owner changed that rule.
- TypeScript names inside the app (`getModel`, `saveModel`, `FleetModel` and the like) were left: they are internal, and renaming them would have doubled the diff with no change a user or the database sees. The `Fleet.model.*` message keys kept their key names for the same reason; their texts say "product".
- The Moto Mangos listing fields (instant, request and ready-now counts, the switch) are still on the product and on the Details tab. They move to `product_listings` and their own tab in stage C.
- The deposit is still on the product and readable by every member, as before. It moves to `product_pricing` in stage D, where mechanics and drivers stop seeing prices.
- This worktree runs its own local Supabase (`Bike_Booking_products_a`, ports 563xx) so it does not disturb the other two. Its `supabase/config.toml` change is local only (`git update-index --skip-worktree`).

**Tests (all passing locally, 13 Nov 2026)**

- Database: 185 (fourth round: a product with any vehicle left, whatever its status, can't be deleted by anyone, the service role included; a retired product with a retired vehicle is no exception; it goes once its last vehicle is gone, for owners and managers only; another shop can't delete it). Run on a database rebuilt from scratch with all 55 migrations.
- Unit: platform 145, marketplace 202, core 86.
- Playwright: 72 passed at 375 px and 1280 px, 2 skipped (the timing measurement). Fourth round: no panel for a car, a boat or a dirt bike; the two-dropdown picker; the new listing texts; the delete pop-up with a retired vehicle left; the pencil's name, size and focus; the tags on a Fleet line.
- `npm run typecheck && npm run lint && npm test` from the root: clean.

**On staging, not on live (13 Nov 2026).** PR 13's migration (`20261113000100_platform_fleet_rework`) and PR 16's (`20261113000200_platform_products`) are both on staging: staging records 55 of 55. **Neither is on live**, which stays at 53 of 53; live gets them only from `main`, by the runbook, after stage C.

- Pushed from this branch on the owner's instruction with `supabase db push --db-url` after a dry run that listed exactly one pending migration (`20261113000200`); staging already had PR 13's.
- Staging's data came through unchanged: per shop, the same counts and checksums before and after (big-fleet 9 products and 150 vehicles, bsr 18 and 26, saigon-scooters none; year bands, listings, blocks, renewals, purchase records and audit rows the same). All 27 products are vehicle / unit and all 176 units vehicle units; no function is left naming `models`; the reminder queue function runs.
- The demo seed was re-run on staging (`npm run seed:staging`): everything was already there, nothing added.
- PR 16's Netlify preview (`deploy-preview-16--mango-works-platform.netlify.app`) was opened signed in as the BSR demo owner at phone and desktop width: the Products list, the new-product form with its suggestions, a product's Details, Units and History tabs, and Fleet all load. That pass only read; it saved nothing.
- Until PR 16 merges, the platform site's main deploy and any other branch's preview still run the old code against staging and will fail on the fleet pages, because the table they read was renamed.

**Not truly tested**

- The full browser suite was not run against the Netlify preview, only the read-only pass above. The suite ran on a local production build with a local database, and in CI.
- A real phone: phone width in a desktop browser only. Thai wording: key parity only.
- The live push: not done, by instruction. It follows the runbook after stage C.

**Found on the way**

- A product address that isn't an id (`/products/abc`) gave "Something went wrong"; it is "Page not found" now. The old model page had the same fault.
- Port 3300, which the browser tests use, was held by a server from the `Bike Booking-ui-refresh` checkout. A first test run was pointed at it for about two minutes before this was noticed and stopped; it may have left a few test rows in that checkout's local demo database (local only). The tests were then run against this worktree's own server on port 3310.

**Not built here (later stages):** gear, services and items for sale on screen, quantities, the `lost` status (B); the Moto Mangos tab and `product_listings` (C); prices (D).

## Products redesign: design review (branch `docs/products-redesign`, 13 Nov 2026)

Docs only: `docs/products-redesign.md`. No code, no migration, nothing applied to local, staging or live.

- The owner approved a brief to replace "Make & model" and "Add to inventory" with one Products list (four types: vehicle, rental gear, item for sale, service), a Fleet view beside it, and Moto Mangos controls on a product tab. The document is the design for it: tables, availability, pricing, screens, permissions, audit, build stages, tests.
- **Proposed, not decided:** rename `platform.models` to `products` with a type and a tracking mode; store quantity-counted gear as nameless `units` rows so the one exclusion constraint covers it; move the Moto Mangos columns to a new `product_listings` table; pricing as a method on the product plus shareable price templates; extras as products linked to a vehicle product.
- **PR 13's migration (`20261113000100`):** the review recommends keeping it unchanged and building forward with new migrations. It is still not on live; the proposal is to push it with the follow-ups in one go after the first three stages.
- **Second version (13 Nov 2026):** the owner accepted the review's five disagreements and answered its questions; all 16 decisions are in the table at the top of the document and worked into each section. Among them: rename to `products`; one type-ahead of known models on the create form; no preset products and free-text names; one product per size until after the pilot; the instant and request split stays; only owners and managers switch Moto Mangos or change gear quantities, staff mark units lost or damaged, mechanics and drivers see no prices (so prices get their own table, `product_pricing`); lead time is the stricter of shop notice and listing lead time; the order deposit is the sum of each vehicle's; tiered prices come from anchors (1, 7, 14, 21, 30 days) with every filled day editable; สินค้า for "product", provisional.
- **Second round of answers (13 Nov 2026):** items for sale are in the database from stage A, entered with a name and stock from stage B, priced in stage D and sold from Phase 3; the stored "price per day" mode is dropped, with a "same price every day" fill helper in its place; owners, managers and staff may mark a unit lost, mechanics may not; staff see prices and can't change them.
- **Still open for the owner** (§7): only whether BSR's Booqable templates are multipliers or fixed amounts (importer, Phase 10). The spec edits are listed in §8; `docs/platform/SPEC.md` is not changed here.
- **Stage A** (§5.6 of the document) is approved and built on its own branch, `platform/products-stage-a`.
- Found on the way: `apps/platform/CLAUDE.md` says the exclusion constraint is "on allocations/downtime"; it is on `unit_blocks`. Not changed (docs-only review of the design, and the owner keeps that file in step with the spec).

## Fleet rework: Make & model, Add to inventory, kinds and categories (branch `platform/fleet-rework`, 12 Nov 2026)

Owner's request after the click-through: "Add model" and "Add bike" did the same job and read alike. Built to the owner's instruction in chat; `docs/platform/SPEC.md` in the repo does not have this text yet (the owner maintains it).

- **Two buttons, one job each.** "+ Make & model" (top of Fleet) adds a kind of vehicle. "+ Add to inventory" (just above the list) adds one vehicle of a make & model the shop already has, and **never creates a make & model**: its dropdowns list the shop's own only, with a link to "+ Make & model" that comes back afterwards. Each model row has a labelled, outlined “+ Vehicle” button (44 px tall) left of the arrow that opens the inventory form with that model chosen.
- **The old "Add my own" page is gone** (`/fleet/own-model`): typing a make and model in is part of the Make & model form.
- **Kind first.** The form starts with Motorbike, Car, Off-road, Boat or jet ski, Other, and reshapes: a motorbike is picked from the Moto Mangos list or typed in; everything else is typed in; engine size and transmission are required for motorbikes only (unchanged rule). The kinds are the database's vehicle types (`atv` reads "Off-road", `boat` reads "Boat or jet ski"). Dirt bikes are motorbikes, category off-road.
- **Categories: one list in the code**, `apps/platform/lib/vehicle-kinds.ts`, changeable with no migration (the database only checks the key's shape). First guesses: motorbike scooter, touring, adventure, sport, classic, off-road; car sedan, SUV, pickup, van, hatchback, convertible; off-road ATV, UTV; boat jet ski, speedboat, pontoon. Required for motorbikes and cars, optional for the rest, none for Other. Labels are in the messages; a key with no label shows as the key made readable.
- **Categories are stored on the model** (`platform.models.categories`, a list: a model can have several, e.g. Adventure and Touring). Motorbike keys are the types Moto Mangos files a bike under, so "Send to Moto Mangos" no longer asks for the type. A model on a list entry takes the entry's type unless the shop picks its own; existing models were filled that way. A typed-in motorbike with no category is asked for one before it can be sent.
- **Helpful tip** on the add form, motorbikes only, right under the make and model: a lightly tinted box with a lightbulb. One text for a model picked from the Moto Mangos list, another for one typed in (the owner's wording). No toggle there: listing stays on the model page, and does nothing until Moto Mangos reads from the platform (after Phase 3). The Moto Mangos mark (inline SVG copied from the marketplace refresh) is still used for the review markers.
- **Review results reach the shop.** New `platform.models.catalog_approved_at`, set by `review_catalog_request()` on approve and merge (the shop can't write it). The dashboard shows a "Moto Mangos reviews" block for owners and managers, the Fleet list a marker beside the model, and the model page a line: "not added" for as long as the rejection stands, "added" for 14 days (`reviewNewsDays`). No email or LINE yet (Phases 3 and 6).
- **"Bike" is "vehicle"** in every platform text except the Moto Mangos panel and the catalog admin (Moto Mangos lists motorbikes). Thai already used the general word (รถ), so only new lines changed there: `docs/platform/thai-review-fleet-rework.md` lists them for the owner's approval.
- **CSV import:** new optional `category` column (required for a new motorbike or car that isn't on the list; several are separated by a semicolon, `adventure; touring`); `vehicle_type` also accepts "Off-road", "jet ski" and the like; the page lists each kind's categories from the code. The import still creates makes & models: it is the bulk path.
- **Fleet list:** a "Kind of vehicle" filter and a "Category" filter (a model matches on any of its categories); each model's heading line shows all its categories. A make & model with no vehicles yet still shows when only those filters are on. Model titles have no underline at rest (underline on hover, ring on focus).
- **Pencil** beside a model's name: a plain 44 px icon button, no box, soft tint on hover, focus ring.
- **Migration `20261113000100_platform_fleet_rework`:** the two columns, a trigger that defaults the categories from the list entry, the review function and `import_fleet()` replaced in place. No new table or API-reachable function, so no new grants; `default-grants.test.ts` passes. On local and staging; **not on live**.
- **Tests:** `lib/vehicle-kinds.test.ts` (kinds, categories, labels in both languages, CSV category, kind filter, review news); `tests/db/fleet-rework.test.ts` (9); the fleet Playwright tests follow the new flow, plus a new one for the two buttons, the row +, and the kind filter.
- **Test helper:** database tests now pick this checkout's own database container (by `project_id`), because a second checkout of the repo can run its own beside it.

Second round, after the owner's click-through (12 Nov 2026, evening):

- **Several categories per model.** The form's category field is a row of checkbox chips (44 px, real checkboxes); "required" for motorbikes and cars means at least one, checked on the server. Stored in the list's own order, without repeats.
- **The migration was changed in place** (`category text` became `categories text[]`), on the owner's instruction, because it was not on live or `main`. Local was rebuilt. **Staging had the first version applied**, so it was taken back there by hand (the old trigger, trigger function and two columns dropped; the migration marked as not applied) and the new version pushed, together with `20261112100000_marketplace_station_osm_refresh` from `main`, which staging did not have yet.
- "Not in the list?" and "Choose from the list instead" are outlined buttons, 44 px tall.
- The Moto Mangos card became the helpful tip; the row + became "+ Vehicle"; model titles lost their underline; a category filter was added to the Fleet list (the owner's note mentioned the filter; there was none for categories before).
- The branch has `main` merged in (PRs #12 and #14); `docs/PROGRESS.md` was the only conflict.

Third round (owner's second click-through, 12 Nov 2026, late):

- **Bug: a model could be saved with no category.** Cause: `saveModel` skipped the category check for a model picked from the Moto Mangos list when no chip was ticked ("as Moto Mangos files it") and let the database fill in the list's type, so the form never refused it. A typed-in motorbike or car was already refused. The exception is removed: a motorbike or a car needs at least one category, list model or not, with the message under the chips. `e2e/fleet.spec.ts` unticks a list model's chip and expects the refusal (it saved before the fix). The database default stays for the CSV import, where a list model with no `category` cell takes the list's.
- **Leaf green buttons.** New tokens `--leaf` and `--leaf-soft` in `app/globals.css` (text and outline #336600: 6.89:1 on white, 6.22:1 on the hover tint; dark theme #a3d977). "Manually enter" (was "Not in the list?") sits beside the line "Don't see your bike in the list?"; "Choose from the list instead" has the same look. The "Pick from the Moto Mangos list" label is gone.
- **Rejected models: what to do next.** Beside the reviewer's note: one line and two buttons. "Edit and send again" goes to the details form; the send button then reads "Send for review again". "Choose a model from the list instead" goes to a new picker of the whole approved list ("Use this model"), which is there for every own motorbike.
- **Resubmitting needed no migration.** A rejected model goes back to being the shop's own; `submit_model_to_catalog()` makes a new request, and the trigger from `20261112000400` clears the rejection on the model once it is on that request. The old reason is kept on the old request (`bike_catalog.review_notes`, status rejected) and in the audit log, not on the model; `tests/db/fleet-rework.test.ts` checks this. The shop has no screen for that history yet.
- **Approved means listed.** The owner's text says "switch it on and we'll review it first... It goes live once approved", so `review_catalog_request()` now sets `marketplace_listed = true` when it approves or merges a request (in the fleet-rework migration, changed in place again; nothing from `20261112000400` was touched). The shop can switch it off. The control is still the send form (first and last model year, a note), with the button "Switch on and send for review".
- **Moto Mangos panel** on the model page is headed by the logo (`apps/platform/public/moto-mangos-logo.png`, copied from the marketplace), on a white plate so it reads on the dark theme.
- **Fleet list look.** Each make & model is one card: a header row in the light mango tint (dark text, AA) with a kind icon in a fixed 44 px box (a photo instead when the model has one with a web address; none do until Phase 3 uploads them), the title and pencil, then chips: Moto Mangos status for owners and managers (green Listed on Moto Mangos, amber In review, red Needs changes, grey Not listed; motorbikes only), the categories, and a dark count badge. Rows under it alternate with a very light cream. The old "Added / Not added to Moto Mangos" markers are replaced by the chips; the dashboard block is unchanged.
- Staging: the first second-round version of the migration was taken back by hand again and the new one pushed (see the report).

Fourth round, deleting and retiring (owner, 12 Nov 2026, night):

- **What was already there:** a vehicle can be deleted by an owner or manager unless anything on its calendar points at it (downtime now, bookings from Phase 3); sold and retired vehicles leave the default list ("Show: Sold and retired" brings them back); a make & model can be deleted when it has no vehicles; every insert, update and delete is in the audit trail with who did it.
- **Retire instead.** When deleting a vehicle is refused, the message says why and shows a "Retire instead" button (not for one that is already sold or retired). It is refused in turn while the vehicle has a block still to come.
- **Restore.** A retired vehicle has a plain "Restore" button (back to active).
- **Confirmations.** Choosing Retired or Sold in the status form asks first and says what will happen. Deleting already asked.
- **Retiring a make & model.** New `platform.models.retired_at`. "Retire make & model" shows on its page once none of its vehicles is in the fleet (all sold or retired, or it has none); it asks first. A retired model leaves the fleet list (it is under "Show: Sold and retired", with a "Retired" chip) and the "Add to inventory" form, comes off Moto Mangos (`marketplace_listed` goes off and can't be switched on), and takes no vehicle that is in the fleet, new or restored, until "Restore make & model". The database enforces all of it (`models_retire_guard`, `units_model_not_retired`).
- **Deleting a model that waits for review withdraws the request** (owner's decision): the request is closed as rejected with the note "Withdrawn: the shop deleted the model." (`models_withdraw_request`). A model on an approved list entry leaves the entry alone.
- All of this is in `20261113000100_platform_fleet_rework`, changed in place again (not on `main` or live); nothing from `20261112000400` was touched. No new table or API-reachable function, so no new grants.
- Found on the way: the status choices on a vehicle's page kept showing the old status after a button changed it; they now redraw.
- Tests: `tests/db/fleet-rework.test.ts` (retire rules, listing off, no vehicles on a retired model, who may and the audit row, refused delete, withdrawn request); a Playwright test for the whole flow; the fleet-view unit test covers where a retired model shows.

Fifth round (owner's click-through, 13 Nov 2026):

- **Deleting a vehicle clears its downtime records.** The owner could not delete DEMO-004 on staging: it had five downtime records that ended days before (left by test runs), and any block, however old, stopped the delete. A `units_clear_downtime` trigger now deletes a vehicle's downtime with it (in the fleet-rework migration, changed in place). Bookings still stop it: an allocation, hold or transfer keeps the foreign key, and the app then offers "Retire instead". Until Phase 3 there are no bookings, so today every vehicle can be deleted.
- **This supersedes the fourth-round line** "a vehicle can be deleted unless anything on its calendar points at it".
- **Delete vehicle** is the last thing on the vehicle's page, under Purchase and sale, a solid red button; "Retire instead" appears to its right when a delete is refused. The warning says it is permanent and what is erased (purchase and sale details, tax and insurance, downtime, odometer history).
- **Buttons renamed:** "+ Make & model" is "+ New Product"; the row's "+ Vehicle" is "+ Add product to inventory"; the separate "+ Add to inventory" button above the Fleet list is gone (the form is still reached from each row and from a model's page). Page titles and other texts still say "make & model" and "Add to inventory".
- The grey chip reads "Not on Moto Mangos" (was "Not listed", which did not say of what).
- Text for a model not on the list now ends "Or select the model if already in the list below."

Open, for the owner:

- **Deleting a vehicle that has bookings (from Phase 3).** The owner wants vendors to be able to remove any vehicle for good while past sales history stays. A real delete can't do both: it erases the vehicle's own records and would leave past orders pointing at nothing. Proposed for Phase 3: "Remove for good" marks the vehicle as removed (never shown again, not restorable from the app, plate free to reuse) and keeps the row for past orders and reports. Needs a column and every vehicle query to leave removed ones out.
- **"Edit" button beside Save on the make & model page:** not built; the page is already an edit form. Waiting for the owner to say what could not be changed.

Known limits and open points:

- **A retired make & model still counts** in the "N makes & models" line at the top of Fleet and still appears in the fleet filters' model dropdown.
- **Sold vehicles have no Restore button** (only retired ones, as asked); the status form can still set one back to active.
- **Moto Mangos files a motorbike under one type.** A model with several categories is sent with the first one in the list's order (Scooter, Touring, Adventure, Sport, Classic, Off-road), so "Adventure and Touring" goes as Touring. Phase 3 (or the owner) should decide whether the shop picks the main one or Moto Mangos takes several.
- A motorbike on a list entry can be given a category different from the list's. Nothing uses the difference yet; Phase 3 should decide which one Moto Mangos search reads.
- Removing a category from the list leaves models that have it unchanged; the form then asks for a new one on the next save.
- The review block has no "dismiss": a rejection shows until the model is sent again or put on a list entry.
- The local dev server (`next dev`) is too slow for the long Playwright tests; they were run against a local production build, as CI does.

## Marketplace UI batch (branch `marketplace/ui-refresh`, 12 Nov 2026, not merged)

Done (items 1 to 5 of the owner's batch):

- **Moto Mangos look.** Tokens in `app/globals.css` (hex, so `lib/design-tokens.test.ts` checks WCAG contrast): mango primary with **near-black text** (white on mango fails AA), leaf green accents, cream background (palette updated to the logo, see below), `--link` (dark mango) for mango-coloured text. Nunito 800 headings (Thai falls back to the system font). Mango badge drawn in `components/brand/logo.tsx` and `app/icon.svg` (the favicon; `favicon.ico` removed); speed-line and leaf accents. The shared header is restyled for admin and vendor too; they show their area name as a pill.
- **Page titles and descriptions, Thailand-wide** (owner approved, 12 Nov 2026), English and Thai: "Motorbike rental in Thailand", "Rent a {name} in Thailand", "{shop} – motorbike rental", root title "Moto Mangos – Motorbike rental in Thailand". The Thai is listed for native review in `i18n/machine-translated.ts` (`thaiNeedsNativeReview`).
- **Bike types** are multi-select toggles; none = any type. URL: repeated `type=` (old one-type links still work). Adapter: `SearchQuery.types` (docs/INTEGRATION.md updated); `current-db.ts` passes one type to `search_offers` and filters several in code, so no migration.
- **Book ahead / Ride today.** "Search bikes" → "Check availability & prices". The home form has two paths: Book ahead (dates) and Ride today (`now=1`, only bikes ready now; no dates). "Get your bike now" text is gone from the customer site and the vendor help text. docs/marketplace/SPEC.md (Home, Filters rows) updated.
- **24-hour times**: a 00:00–23:30 list in 30-minute steps (`TIME_OPTIONS`), default 10:00 for pickup and return; picking a pickup date sets the return to the next day.
- **Place search (item 2).** The station dropdown is replaced by a place search with suggestions (city, area, landmark, airport; any country), "Use my location", and an optional "Near a train station" list. Google Places API (New) through our own routes (`/api/places/autocomplete`, `/api/places/[placeId]`, `lib/places.ts`) with the server-only `GOOGLE_PLACES_SERVER_KEY`: one session token per search, 3 characters and a 300 ms pause before a request, Place Details asks for `location` only (Essentials SKU; `displayName` would be Pro), chosen places cached per server instance for 6 hours (Google allows 30 days), 60 requests a minute per caller. If Places fails or answers 429, the form shows the station list and "Use my location" instead (`e2e/place-search.spec.ts`).
- **Station refresh from OpenStreetMap.** Migration `20261112100000_marketplace_station_osm_refresh` adds `osm_id`, `osm_last_seen_at`, `osm_missing_since` to `public.stations` (no new table or function; grants restated; `default-grants.test.ts` passes). Netlify scheduled function `refresh-stations` (03:00 UTC on the 1st) → `POST /api/cron/stations` (Bearer `CRON_SECRET`) → Overpass → merge by OSM id (`lib/stations/osm.ts`, `merge.ts`, `refresh.ts`). Seeded stations link by name within 400 m; a same-name station within 400 m of one we have is an interchange platform and isn't added; vanished stations are switched off, never deleted, and switched back on if they return; stations an admin switched off stay off; nothing is switched off if Overpass returns under half of the linked stations. Dry run on real OpenStreetMap data (12 Nov 2026): 181 of 182 seeded stations linked ("Sena Ruam" not found, left as is), 60 new (mostly SRT commuter and Maeklong line halts).
- **Seed dates relative to today**: the seeded booking K7Q4ZP now runs from 2 days ago to 12 days on (Bangkok), so `e2e/customer.spec.ts` "dates show the total…" and the two DB tests that use it no longer fall into the past (`tests/db/helpers.ts` → `bangkokDay()`).
- New keys in all 10 customer languages. The other eight are unreviewed machine translations, and the Thai awaits a native speaker's check; both lists are in `apps/marketplace/i18n/machine-translated.ts`.
- **Sort**: "Recommended" (ranking score, 20% distance) stays the default when a place is chosen (owner, 12 Nov 2026); "Distance" is in Sort.
- **Logo palette, logo, hero, search tabs** (owner, 12 Nov 2026, second pass):
  - Navy is gone. Tokens now follow the logo: `--mango` #f8920a (sampled from the wordmark), `--ink` #0b1220 near-black for text and headings, `--leaf` #3f7f00 accent (`--leaf-bright` #68a800 is the logo's leaf, decorative only), white cards on warm cream. The header is white, and the footer is near-black. The favicon was recoloured to match. AA is checked in `lib/design-tokens.test.ts`, which now also covers the tab colours and tints. That test's token regex had lost its `\s` escape and only matched by luck; fixed.
  - Logo: `public/logo.png` is the owner's "04 Helmet Mango" PNG (710×290), shown in the top bar on the left. It links to the language's home (`/`, `/th`, …) with the alt text "Moto Mangos – motorbike rental in Thailand". The drawn SVG logo component was removed.
  - Hero: the H1 stays real text. A subline under it replaces the old intro line: "Compare bikes, prices and deposits from local shops. Get the best bike at the best price." (`Customer.subline`). Thai is flagged for native review; the other eight languages are machine-translated and listed. `<title>` and the meta description are unchanged.
  - Book ahead / Ride today are now two large tabs at the top of the search box (the ARIA tabs pattern: arrows, Home, End, roving focus; at least 56 px tall). Each tab swaps a tinted card: leaf-soft for Book ahead, mango-soft for Ride today. The active tab is filled in its colour and has a notch pointing at the card; the inactive one is outlined. The URL and state are unchanged (`now=1`, `from`/`to` only for Book ahead).

Open:

- **Vendor opening hours still use the old time input** (`<input type="time">` in `app/vendor/settings/forms.tsx`), not the 24-hour list: the vendor screens are hidden and not built on. Mango Works replaces them.
- **Station refresh not run against real Overpass end to end yet**: on 12 Nov 2026 overpass-api.de answered 502 and the mirror timed out (twice). The write path is tested (`tests/db/stations-refresh.test.ts`) and the merge was dry-run on real data. First real run: after deploy, or by hand with `curl -X POST -H "Authorization: Bearer $CRON_SECRET" <site>/api/cron/stations`.
- **Check the station refresh after its first monthly run** (1st of the month, 03:00 UTC): open Netlify → Logs → Functions and look for the route's "Station refresh {…}" line (counts added, linked, switched off) or "Station refresh failed". The scheduled function waits only 25 s (its limit is 30 s; the route's is 60 s and Overpass often needs 30-40 s) and assumes the route keeps running after it stops waiting. **If the route times out**, split the work by region: one Overpass request per area in `STATION_AREAS` (`lib/stations/osm.ts`), one area per run or per call, instead of one large area at once.
- **Migration only on local**: not on staging or live. Live gets it only from `main`.
- **Titles in the other eight languages** still say Bangkok (only English and Thai were changed, as asked).
- **Google keys are set in Netlify** (owner, 12 Nov 2026): place search works on deploy preview 12 (real suggestions checked). Quotas and the budget alert (checklist steps 4 and 5) are the owner's to confirm.

Later, Moto Mangos (owner, 12 Nov 2026; not built):

- **Suggest our own shop locations first, Google second.** As the customer types, match the text against our shops' names, areas and towns (free, from the shop list we already have). Call Google Places only when nothing of ours matches, to cut Places cost. Keep the 3-character, 300 ms and session-token rules for the Google calls.

Google Cloud checklist (owner; keys set in Netlify on 12 Nov 2026, kept for reference):

1. APIs enabled: Places API (New) and Maps JavaScript API only.
2. Server key (`GOOGLE_PLACES_SERVER_KEY`): API restriction = Places API (New) only. Application restriction: none (Netlify has no fixed IP); it never reaches the browser.
3. Browser key (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, map only): API restriction = Maps JavaScript API; website restriction = the site and deploy-preview domains.
4. Quotas (Google Maps Platform → Quotas, Places API (New)): per-day caps on Autocomplete and Place Details/Get Place. Google's free-tier sizing is 10,000 ÷ 31 ≈ 322 a day each; raise when traffic grows. Also lower the per-minute caps if offered.
5. Budget with alerts at e.g. 50%, 90%, 100% of a small monthly amount. Budgets only alert; the daily quotas are what stop spending.
6. Put the key in Netlify → Site configuration → Environment variables only (scopes: Builds and Functions; the home page is built ahead, so redeploy after setting it). Never in the repo or chat.

## Live at 53 of 53 migrations (12 Nov 2026, evening)

Asked: push PR #12's one migration (`20261112100000_marketplace_station_osm_refresh`) to live. The dry run listed four, because **PR #11's three migrations had merged to `main` but had never been pushed to live**. Stopped, reported, and on the owner's go pushed all four together, in order.

| Migration | On live it |
| --- | --- |
| `20261112000200_platform_lock_strength` | Replaces three platform functions (no data) |
| `20261112000300_marketplace_catalog_requester_private` | Makes `requested_by_shop_id` unreadable to the public: 21 readable catalog columns, was 22 |
| `20261112000400_platform_reject_reason` | Adds two columns and a trigger on `platform.models` (no rows) |
| `20261112100000_marketplace_station_osm_refresh` | Adds `osm_id`, `osm_last_seen_at`, `osm_missing_since` to `public.stations` and a unique index on `osm_id` |

- **From** `main` at `f0f7f19`, with `npx supabase db push --linked`, after a fresh backup (`C:\Users\markw\mango-live-backups\2026-11-12_1738`: roles, schema, data) and a dry run listing exactly these four. No errors.
- **Live records 53 of 53.**
- **Runbook checks (read-only):** row counts of all 24 `public` tables identical before and after (A1/B2); catalog defaults 25 of 25 (B3); private catalog columns readable by the public 0, now checking all four (B4); readable catalog columns **21** for anon and for authenticated (B5); platform still empty (B6); vehicle types and the hourly job unchanged (B7, B8); C1 to C5 identical to the earlier runs; grants fingerprint (C6) identical before and after.
- **No-default-grants expectations on live:** defaults for new `public` tables, sequences and functions are still empty for anon, authenticated and service_role; 39 tables reachable by anon or authenticated, the same set as before (no new table); no function in `public` or `platform` is executable by everyone beyond the closed list; no table without RLS.
- **Through live's API as the public (anon key, reads only):** 37 of 38 queries answer 200 and the private-column probe is refused, as before. 35 of the 36 dry-run queries are byte-identical to the dry-run answers. The one that differs is `stations` read with every column: the same 182 rows, now with the three new columns (all empty until the first refresh runs).
- **Station list:** `station_list()` returns the same answer as before, byte for byte (182 stations). The marketplace home page and `/search` return 200.
- **New station columns exist:** `osm_id text`, `osm_last_seen_at timestamptz`, `osm_missing_since timestamptz`, all nullable; 0 of 182 rows have an `osm_id` yet.
- Not done here: nothing on Netlify or Google was touched, and whether the scheduled station refresh runs was not checked. PR #13's migration (`20261113000100`) is not on `main` and not on live.
- `checks.sql` still says "22" for B5 with a note that it is 21 once `20261112000300` is applied; that is now the case on live.
- The runbook's `rollback.sql` undoes the first 21 platform migrations only. It would not have been the way back for these four; a failure here would have needed a forward fix or the backup.

## Re-check follow-ups (branch `platform/recheck-followups`, 12 Nov 2026)

Four follow-ups from the second look at the Phase 1a review. Three migrations. They merged with PR #11 but **were not on live until the push of 12 Nov 2026 recorded below** (live stayed at 49 in between).

| # | What | Migration | Test |
| --- | --- | --- | --- |
| 1 | **Lock strength.** `set_member_role`, `remove_member` and the counts trigger took a full row lock (`FOR UPDATE`), which also waits for every foreign-key check on that row. A team change waited behind any open insert in the shop (3.6 s behind a 4 s downtime insert), and two bikes swapping models deadlocked. Now `FOR NO KEY UPDATE`: still one at a time, no longer in the way of foreign keys | `20261112000200_platform_lock_strength` | `recheck-followups.test.ts` › 1 (4 tests; the first and third failed before) |
| 2 | **Marketplace admin queue** lists only requests from marketplace shops (`requested_by_shop_id is not null`). A platform shop's request is decided in the platform's `/admin/catalog`, which also unlinks or relinks the shop's models. The query moved to `apps/marketplace/lib/admin-queue.ts` so it can be tested | none | `apps/marketplace/tests/db/admin-queue.test.ts` (3 tests; 2 fail without the filter) |
| 3 | **`requested_by_shop_id` is private.** Taken out of the catalog columns anon and signed-in users may select: 21 readable now, 4 private (`request_note`, `requested_by_tenant_id`, `review_notes`, `requested_by_shop_id`). No marketplace or platform query selected it with those roles: vendors only insert it, the "Shops read their own requests" policy uses it inside the database, and the admin pages use the service role | `20261112000300_marketplace_catalog_requester_private` | `recheck-followups.test.ts` › 3 |
| 4 | **A rejected request says why.** New on `platform.models`: `catalog_rejected_at`, `catalog_reject_reason`, set by `review_catalog_request()` on reject, shown on the model page ("Moto Mangos reviewed this model on … and didn't add it", with the reviewer's note). Cleared when the model is sent again or put on a catalog entry. A trigger stops the shop writing them. `bike_catalog.review_notes` stays private. The admin's note field now says the shop will see it | `20261112000400_platform_reject_reason` | `recheck-followups.test.ts` › 4 (5 tests), and a step in the own-model Playwright test |

Decisions and notes:

- **Why a column on the model, not the audit row:** after a reject the model is unlinked from the catalog entry, and the audit row names the entry, not the model, so there was nothing to join on. The audit log is also owners and managers only. The audit row still records the note.
- **No new grants were needed** under the no-default-grants rule: no new table, the two new columns sit on `platform.models` (granted on purpose in `20261110000500`), functions were replaced in place and keep their grants, and the one new function is a trigger function in `platform_private` with everything revoked. `default-grants.test.ts` passes.
- **The 36 public read queries** were run again on a copy of live's data (from the 12 Nov backup) with all 52 migrations applied: answers byte-identical to the dry run's.
- `review_catalog_request` still takes `FOR UPDATE` on the catalog entry. Not changed: the re-check named the three above, and nothing takes a foreign-key lock on a waiting request in a way that matters. Say if it should follow.
- The marketplace admin can still open a platform shop's request by its direct address (`/admin/catalog/<id>`); only the queue hides it. Left as is.
- Thai texts for the new lines are mine and need a native check, like the others.
- Not covered by a test: that a real API call never waits behind other kinds of open inserts (bikes, models); the test uses a downtime insert, and the lock is the same one.

## Platform migrations on live (12 Nov 2026)

Done by `docs/RUNBOOK-GO-LIVE-PLATFORM.md`, from `main` at `02f5a26` (PR #8 merged).

- **Pre-flight (read-only):** 27 migrations on live, `pg_cron` 1.6.4 and `btree_gist` 1.7 available and not installed, nothing in the way, row counts as on the dry-run copy.
- **Backup:** `C:\Users\markw\mango-live-backups\2026-11-12_1112` (`roles.sql`, `schema.sql`, `data.sql`), outside the repo. The schema file is identical to the copy the dry run used. Owner: keep a second private copy.
- **Applied:** `npx supabase db push --linked`, 21 migrations, no errors. Live records 48 of 48.
- **Verified (B1 to B8, C1 to C5):** all as expected. Every marketplace table has the row count it had before; the 25 catalog entries got the defaults; the public reads 22 catalog columns and none of the 3 private ones; the platform is empty (0 shops, 0 members, 0 admins); the hourly job `platform-renewal-notifications` is scheduled and active; RLS is on for every `public` and `platform` table and no platform policy is open.
- **Dashboard (owner):** `platform` added to Exposed schemas (`platform_private` is not); "Automatically expose new tables" turned off.
- **After the dashboard change:** the grants fingerprint (C6) is unchanged (anon/public 135, authenticated/platform 45, authenticated/public 135, same hashes), so the switch altered no existing grant. C1 to C5 again: identical.
- **Through live's API as the public (anon key, reads only):** the dry run's 36 public queries (22 tables, the catalog as each page asks for it, stations, search, shop and model functions) returned answers byte-identical to the dry-run copy; a private catalog column is refused. Every `platform` table and function answers "permission denied for schema platform" (the schema is exposed and the public has no way in; no rows), and `platform_private` answers "Only the following schemas are exposed: public, graphql_public, platform".
- **How live was read:** the CLI has no SQL command, so checks ran through the CLI's own temporary login in a session set to read-only (a write was tried first and refused).
- Not done: the signed-in marketplace click-through (vendor fleet, admin catalog) is the owner's. The dry run's 21 service-role queries were not repeated on live (public key only).
- Still open before the platform app can point at live: a way to create the first shop and first platform admin there, and the platform URL in live's Auth redirect list. Netlify still points every platform context at staging.

## No default grants on new tables (branch `platform/no-default-grants`, 12 Nov 2026)

Live no longer exposes new tables automatically, but local and CI databases still granted everything by default, so a migration that forgot its grant would have passed every test and failed on live.

- **What the dashboard switch did on live** (read from `pg_default_acl`): for objects `postgres` creates in `public`, anon, authenticated **and service_role** lost SELECT, INSERT, UPDATE, DELETE on tables, USAGE and SELECT on sequences, and EXECUTE on functions. It left TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on tables and UPDATE on sequences.
- **Migration `20261112000100_platform_no_default_grants`:** removes every default for those three roles on new tables, sequences and functions in `public`. Local and CI now behave like live; on live it only removes the leftovers above. Nothing that exists changes. `platform` keeps its own defaults for service_role and never had any for anon or authenticated.
- **Rule from now on:** a migration that creates a table in `public` grants on purpose, to service_role too (`grant select on public.thing to anon, authenticated; grant all on public.thing to service_role;`). In root `CLAUDE.md`.
- **Test** `apps/platform/tests/db/default-grants.test.ts` (runs in CI's "RLS + Playwright" job): the defaults give the API roles nothing; a new table or sequence is closed until granted; every table in `public` or `platform` that anon or authenticated can reach has a `grant` statement in a migration (the 23 marketplace tables from before the switch are a closed list); no function in `public` or `platform` is executable by everyone (the 35 marketplace functions from before the switch are a closed list). Shown to fail on a table granted outside a migration and on an open function, and to pass again when they are removed.
- **Functions, known limit:** Postgres lets PUBLIC execute every new function, on live too, and that default can only be removed for all schemas at once, which would also hit extensions. So functions keep the existing rule (`revoke all on function ... from public, anon`, then grant), now enforced by the test above instead of by a default.
- **On live since 12 Nov 2026** (PR #9 merged; pushed from `main` at `b6fc97c` with `npx supabase db push --linked`, the dry run listing only this migration). Live records 49 of 49.
  - Grants fingerprint (C6) before and after the push: identical (anon/public 135, authenticated/platform 45, authenticated/public 135, same hashes). No existing grant changed.
  - C1 to C5 again: identical to the earlier runs.
  - Live's defaults for what `postgres` creates in `public` are now empty for anon, authenticated and service_role on tables, sequences and functions (only `postgres` itself is listed). `platform` keeps its defaults for service_role only.

## Go-live runbook for the platform migrations (12 Nov 2026)

Prepared and dry-run before the go-live above: `docs/RUNBOOK-GO-LIVE-PLATFORM.md`, with `docs/runbook-go-live-platform/checks.sql` (read-only checks and expected results) and `rollback.sql` (emergency undo). Live was only read (migration list and a `pg_dump` copy through the CLI); the copy of its data was deleted after the dry run.

- Live has 27 migrations; 21 are pending (3 from Phase 0, 18 from PR #8). Migrations reach live only by hand, `npx supabase db push --linked` from `main`. Nothing touches the database on merge.
- Live's schema is identical to a local database built from the first 27 migrations (no drift).
- Dry run on a copy of live's schema and data: all 21 applied; every marketplace table, `auth.users` and `storage.objects` kept the same rows and checksums; 57 marketplace read queries returned identical answers before and after, with `platform` exposed and not.
- The marketplace's own tests need the seed's fixed IDs and accounts, and the seed would not load on top of the copy of live's data, so they ran on the seeded local database built by the same 48 migrations: 81 passed (platform 115, unit 144 + 102 + 86).
- `rollback.sql` was tested on the copy from three states; each time the schema and data came back identical to live's. It refuses to run once the platform holds a shop.
- **Order matters on the dashboard:** exposing `platform` before the schema exists makes the API return 503 for every request, the marketplace's too. Expose it only after the migrations are applied and checked.
- After "Automatically expose new tables" is turned off on live, a migration adding a table to `public` must grant access on purpose; local and CI still grant by default, so a missing grant would pass tests and fail on live.
- Netlify's variables were not read (no access from the repo).
- Open before the platform app can point at live: a way to create the first shop and first platform admin there (only the demo seed does it today), and the platform URL in live's Auth redirect list.

## Platform Phase 1a: independent review fixes (same branch and PR #8, 11 Nov 2026)

An independent review of Phase 1a found six things that had to be fixed and three small ones. All nine are fixed. Each has a database test in `apps/platform/tests/db/review-fixes.test.ts` that was run against the database before the fix (it failed, including the real races: a shop left with no owner, a sold bike with a future block, two admins both deciding one request) and after (it passes).

| # | Finding | Fix | Migration |
| --- | --- | --- | --- |
| 1 | An approved catalog entry is public, but a shop's request note, which shop asked, and the admin's review note could be read on it by anyone | Signed-out visitors and signed-in users may select a list of columns that leaves those three out. Approving clears the note and the shop from the entry (the audit row keeps them). Platform admins read waiting requests, with the note and the shop's name, through `platform.catalog_requests()` | `20261111000700_platform_catalog_private_fields`, `20261111001100_platform_review_gaps` |
| 2 | `platform_private.audit()` wrote a row for any tenant it was handed | It refuses unless the caller is the service role or a database job, a member of that tenant, or a platform admin | `20261111000800_platform_audit_caller_check` |
| 3 | Two owners demoting or removing each other at the same instant left a shop with no owner | Team changes for one shop queue behind a lock on the tenant's row; the membership is read again after the lock | `20261111000900_platform_owner_lock` |
| 4 | A bike could be sold at the same instant someone added a block to it; a block could be moved onto a sold bike or stretched into the future on one | Selling or retiring takes the same per-bike lock as block writes, then checks. The "bike is in the fleet" check runs when a block is changed too: on a sold or retired bike a block may only be shortened | `20261111001000_platform_sold_units_blocks` |
| 5 | `review_catalog_request` also decided marketplace shops' requests; two admins could both decide one request; a reject failed with a raw error when the shop had re-added the same make and model | It takes only a platform shop's request and locks it while deciding. On reject, a model whose return would make a duplicate stays linked (unlisted) and the function says so; the admin page shows a notice. Approve, merge and reject each write one audit row. It now returns `{decision, kept_linked}` | `20261111001100_platform_review_gaps` |
| 6 | A model's instant / request / ready-now counts could stay higher than its active bikes after a bike left | A trigger on bikes clamps the counts down (never up) when a bike leaves a model's active set (status change, model change, delete), and writes an audit row (`clamp_booking_counts`) with before, after and which bike. Request units give way before instant units | `20261111001200_platform_clamp_booking_counts` |
| 7 | "End downtime" from a stale page could re-extend a block someone had already ended | The update only matches a block that is running right now; otherwise the page says it was already ended | none (app) |
| 8 | An old bike form could overwrite a newer odometer reading | The details form carries the bike's `updated_at`; a save is refused with "changed by someone else, reload" when it has moved on | none (app) |
| 9 | A shop's own model accepted 1 to 20000 cc, the catalog 50 to 2500: a 49 cc moped saved, then failed with a raw error when submitted | Both accept 1 to 20000 cc. Out of range gives "Enter an engine size from 1 to 20000 cc." under the field; the database's refusal maps to the same message | `20261111001300_platform_cc_range` |

**After the owner's click-through (12 Nov 2026): downtime on the bike page**
- "End now" from a stale tab did refuse to write, but its message sat inside the row that then disappeared, so nothing was shown. The bike page now reloads with a notice: "That downtime was already ended or removed by someone else."
- A new downtime couldn't be added after ending one without a reload. "From" was filled with the time the page was opened, which by then lay inside the block just ended. "From" now starts blank, and blank means now, taken from the server when it is saved.
- Even after a reload it could be refused within the same minute: the old block ended at, say, 10:30:45 and the new one was typed as 10:30. Ending a downtime, and starting one "now", both use the start of the current minute. A downtime started and ended within one minute is removed, not kept.

**Rules for later phases that come out of this**
- **Phase 2 must compute availability from `units` and `unit_blocks`, never from the stored counts alone.** `instant_units`, `request_units` and `ready_now` are a shop's setting. They are kept within the active bikes, but a bike in a block is still "active".
- **Lock order:** code that needs the lock of more than one bike in one transaction takes the per-bike advisory locks in sorted `unit_id` order. The block guard does (a block moved from one bike to another).
- **A column added to `public.bike_catalog` is not readable by the public** until it is added to the column grant on purpose.

**Changed for the marketplace: nothing it uses.** Its public and vendor queries name their columns and use none of the three private ones; its admin pages use the service role. All 81 marketplace database tests pass with the new grant. The catalog's engine-size limit is wider (1 to 20000); the marketplace's own vendor form still checks 50 to 2500.

**Known limits**
- A model kept linked to a rejected entry (fix 5) can't be listed and can't be sent again from the screen. It is rare (the shop re-added the same make and model while waiting); the model page says why. Tidying it up means deleting one of the two.
- Fix 2 is tested through direct SQL as a signed-in user (the `platform_private` schema is not reachable through the API, so it could not be reached that way before either).
- The race tests (3, 4, 5) fire the two calls at the same instant several rounds each. They failed every run before the fixes and pass every run after, but a race test can only show a race is closed for the timings it hit.
- Not built, by decision: see "Before Phase 2" below.

### Before Phase 2

Review findings deferred, to do before or with Phase 2:
- **Non-atomic pairs:** a renewal and its cost, and opening hours (delete then upsert), are two writes. Make each one RPC or transaction.
- **`unit_blocks.created_by` and `unit_renewals.recorded_by` are client-settable.** Set them in the database from `auth.uid()`.
- **Preset copies drift:** a model's copy of its catalog entry's make, model and specs isn't updated when an approved entry is edited or un-approved.
- **Audit gaps:** log changes to `platform_admins`; keep audit rows when a tenant is deleted (or block hard tenant delete).
- **Phase 2 multi-bike bookings must take per-bike locks in sorted order** (the rule above).
- **pg_cron on live:** the migrations enable the hourly reminder job where `pg_cron` is available, so it will start on live when Phase 1a's migrations are applied there. Expected; put it on the go-live checklist.

Tests after these fixes: 102 platform unit, 115 platform database, 81 marketplace database, 58 Playwright (29 at 375 px, 29 at 1280 px).

## Platform Phase 1a follow-ups (same branch and PR #8, 11 Nov 2026)

Ten requests from the owner after trying Phase 1a. Where they differ from the Phase 1a notes below, these are the current state. Migration `20261111000200_platform_fleet_followups.sql`.

**Decisions that change the spec** (owner, 11 Nov 2026; `docs/platform/SPEC.md` still has the old wording and needs the same edits at its next export)
- **Odometer:** a lower reading is no longer refused for anyone who may update the odometer. The app asks "Are you sure?" first; the audit log records who changed it, from what, to what. (Spec: "a reading lower than the last one needs a manager override".) Drivers still can't change a bike at all.
- **Borrowed units removed:** the `borrowed` status and the active-from / active-to window are gone. (Spec: "Borrowed units (sub-rentals) with an active window".) Nothing else depended on them: no query, rule or screen read them.
- **"First registered" removed** from the data model, screens and import. Before the column was dropped, its year was copied into the new `model_year` where a bike had one.
- **Tax and insurance pulled forward from Phase 1b:** the renewal log (minimum), reminder settings and dashboard items are built now. Service schedules, odometer alerts, keys, GPS, the unit timeline and profit stay in 1b.
- **Scheduled jobs:** the hourly reminder queue uses Supabase Cron (`pg_cron`), the scheduler the spec names. It is the repo's first scheduled job. The migration enables the extension where it is available and skips the schedule where it isn't.

**Built**
- **Bug fixed: the distance unit "reverted" after saving.** The save always worked. The form was left to the browser to submit, and React then reset it, so the dropdown showed the value the page first loaded with until a reload. The settings form is now submitted by script like the others. The same class of bug existed on the Fleet filter form ("Reset view" left old values on screen) and is fixed by redrawing the form when the view changes.
- **Fleet list, grouped.** By model (default), each split into the shop's own model-year bands, newest first; "Unknown year" for bikes with no year, "Other years" for a year outside every band, one group for all years when a model has no bands. Each group shows make, model, year band, bike count and a status breakdown, and opens with its arrow. Expand all, collapse all. Group by model, make, location, status or none. Filters: make and model (linked), engine size range, transmission, status, location, model year, plate or frame search. Sort: make and model, engine size, bike count, plate, odometer, purchase date (owners and managers only). The view lives in the address, so it can be bookmarked, and the last view is remembered per person per device (a cookie, like the other per-device choices). "Next service due" is not offered as a sort: that data arrives in Phase 1b.
- **Model-year bands:** `model_year_bands`, edited on each model's page by owners and managers; a year can sit in one band of a model only (database rule).
- **Make, then model, everywhere a model is chosen** (add bike, add model, Fleet filters, sticker filters): two linked dropdowns from the catalog. Choosing a catalog model the shop doesn't have yet creates the shop's model on save. "Add a make or model" covers what the catalog lacks: the shop uses it at once and a platform admin reviews it (the existing catalog-request path, renamed).
- **CSV import** now takes `make, model, model_year, name` instead of `model, catalog`. Where the catalog has several generations of a model, the model year picks the one whose years include it. `name` is optional: the shop's own model name.
- **Status:** one control per bike (active, maintenance, retired, sold), each with a line saying whether the bike can be rented. The duplicate beside the odometer is gone. Staff and mechanics are offered active and maintenance only.
- **Selling:** choosing Sold only changes the status (still refused while the bike has a block ending in the future), then lands on the one "Purchase and sale" section at the bottom, where every purchase and sale field is viewed, edited and saved. The separate "Mark as sold" panel with its own price fields is gone.
- **Tax and insurance:** `unit_renewals` (kind, provider, reference, start, expiry; everyone reads, staff and mechanics record, owners and managers delete) and `unit_renewal_costs` (owners and managers only, like purchase prices; a cost locks the currency too). The bike page shows "Road tax expires" and "Insurance expires" from the latest record of each kind, highlighted when due or expired. Reminder settings per shop: days before expiry (default 45, 30, 14, 7) and an optional monthly digest day (1 to 28). Dashboard: a renewal shows from the shop's first reminder day, under Upcoming with its date (Today and Tomorrow when it is that close), and under Late once expired. Only the current record of each kind counts; sold and retired bikes are left out.
- **Notification outbox:** `notification_outbox` plus `queue_renewal_notifications()`, run hourly. It queues one message per reminder day reached (only the nearest one for a record added late), one "expired", and one monthly digest, each exactly once, by the calendar date at the bike's location. **Nothing sends them yet** (see below).
- **Print stickers:** a button on the Fleet page opens a list with a checkbox per bike, select-all for what the filter shows, make and model filters, newest first or by plate. Printing shows only the ticked stickers. The bike page keeps "Print this sticker", which opens the list with that bike ticked.
- **Demo data:** BSR renewals in every state (insurance expiring 30 days after the seed runs, one in 5 days, road tax 3 days overdue), and a third shop, Big Fleet Demo (`/big-fleet`, `owner@big.demo.test`), with 150 bikes in 5 models, three year bands each, two locations and mixed statuses.

**What statuses and downtime do to availability today** (asked by the owner)
- Nothing computes availability yet: that is Phase 2, and there are no bookings until Phase 3. What exists today:
- **Active** is the only status counted as rentable stock: a model's Instant, Request and Ready-now counts can't exceed its active bikes.
- **Maintenance** therefore already takes the bike out of those counts, and the status text says it can't be rented. Phase 2's availability function must count active bikes only for this to hold for bookings; that is how the spec defines it.
- **Retired and Sold:** refused while the bike has a block ending in the future; afterwards no new block can be added; left off the sticker list and the dashboard.
- **Scheduled downtime** is a `unit_blocks` row. The database already refuses any other block on that bike for overlapping times, whatever its kind, so from Phase 2 a booking can't land on it.

**Sending by email or LINE: what the codebase can do**
- Nothing. There is no email sender, no LINE client, no outbox and no job runner anywhere in the repo, in either app. Sign-in emails are sent by Supabase itself. The spec puts jobs + outbox + email in Phase 3 and LINE in Phase 6.
- So reminders are queued, not sent, and no sender was built. The outbox rows hold facts (bike, kind, expiry, days before), not text, so the Phase 3 sender can word them per language and choose recipients. Until then the dashboard is the only place a reminder is seen.

**Tests** (all passing locally, 11 Nov 2026)
- Unit: 91 platform (new: fleet view incl. 150 bikes, import by make and model, renewals and reminder settings), 144 marketplace, 86 core.
- Database: 84. New: the four new tables in the isolation harness (fixtures, cross-tenant read/insert/update/delete), year bands, renewals and cost visibility by role, reminder settings, the queue (once each, nearest reminder only, location date, expired, digest, sold bikes skipped), lowered odometer with its audit row, removed columns and status.
- Playwright: 50 (25 at 375 px, 25 at 1280 px). New or rewritten: grouped fleet, the 150-bike shop, status and odometer confirmation, renewals to dashboard, bands, adding a make, sticker picker with print media, the settings bug.
- Tests updated because the rule changed: the two that expected a refusal on a lowered odometer; the Phase 0 dashboard test (tab counts are no longer zero).

**Not truly tested**
- The hourly schedule itself: the queue function is tested directly; that `pg_cron` fires it each hour is checked only by seeing the job listed on local and staging.
- Printing on paper and scanning a printed sticker (as before); the print layout is tested with the browser's print styles.
- 150 bikes on a real phone: tested at 375 px in a desktop browser, and the page loaded within the test's limit.
- Thai wording of the new text (key parity only).

**Surprises**
- The "reverted to kilometres" bug was a display bug: the database had the right value all along.
- Models with no bikes had dropped off the first version of the grouped list; the browser test for adding a make caught it.
- The catalog's entries are per generation (CB500X 2016–2018, 2019–2021, 2022–2023), so "make then model" can list the same model name more than once, told apart by years. Year bands are the shop's own and separate from those.

**Scan QR on the Maintenance tab (owner request, 11 Nov 2026; QR scanning was planned for Phase 5)**
- A camera button sits beside the plate search. It opens the camera, reads a bike's sticker and opens that bike. Only the sticker's token is used, so a sticker printed with another address (a preview, an old domain) still opens the bike on the site the person is signed in to, and a code that isn't a sticker is never followed.
- It reads codes on Android, iPhone and laptops with a camera. Chrome on Android has a code reader built in. Safari on iPhone and Firefox don't, so there each camera frame is decoded on the device by the `jsqr` library (owner OK, 11 Nov 2026; Apache-2.0, no dependencies of its own), which is downloaded only on those browsers and only when the scanner is opened. Nothing is uploaded.
- Tests: the token rule (unit). In Playwright the stand-in camera plays a file showing a QR sticker (`e2e/fake-camera.ts`): one test reads that code for real from the camera frames with `jsqr`, as an iPhone would; others cover the right bike opening, a foreign code refused, the camera turned off on close, and the message when a browser has no camera access. Not tested: a real phone camera reading a real printed sticker, and Safari itself (the tests run in Chromium with its own reader removed).
- Stickers hold the address of the site they were printed from. Print the real ones from the final domain, not from a deploy preview: the in-app scanner copes either way, but a phone's own camera app follows the printed address.
- Playwright: 58 (29 at 375 px, 29 at 1280 px).
- CI (11 Nov 2026): for some hours GitHub's runners could not look up Ubuntu's package servers, so installing Chromium's system packages (mostly fonts) failed before any test ran. The install step now falls back to Chromium without them (`.github/workflows/ci.yml`); all 58 Playwright tests pass that way. Known issue: while such an outage lasts the step spends about 10 minutes timing out first.

**Spec rules that changed** (`docs/platform/SPEC.md` is not edited here: the owner keeps the spec in a separate document and re-exports it after merge)

From the catalog and listing decision (11 Nov 2026):
- **(a) A model no longer needs a catalog entry.** The spec says "a model can't be saved without a catalog entry, so cc and transmission are always filled in". Now a model is either on a preset (an approved catalog entry) or is the shop's own, with its make, model and specs stored on the model.
- **(b) Required specs.** Vehicle type: always. Engine size (cc) and transmission: required for motorbikes only; optional for cars, ATVs, boats and "other" (a shop may add them). An earlier version the same day also required a transmission for cars; the owner withdrew that.
- **(c) Moto Mangos listing and approval.** Approval appears only when a shop wants a model on Moto Mangos. A model on an approved entry can be switched on directly. One of the shop's own is matched to a suggested entry ("Did you mean…") or sent to the platform admin, who approves it (it becomes a preset for every shop), merges it into an existing entry, or rejects it. Only a model on an approved entry can be listed. The spec's "a missing catalog entry goes to the platform admin for approval" now applies at listing, not when a bike is added.
- **(d) Writes to one bike's `unit_blocks` queue behind each other** (a transaction-level advisory lock per bike), on top of the exclusion constraint. The spec's review decision asks for "check + insert inside one function under a per-location-and-model advisory lock" before Phase 2; the per-bike lock is in place now and Phase 2's booking function takes the same one.

From the earlier follow-ups the same day (details further down): a lowered odometer is confirmed, not refused; borrowed units and "first registered" are removed; the tax and insurance log, reminder settings and dashboard items were built ahead of Phase 1b; the hourly reminder queue uses Supabase Cron.

**Shops' own vehicles and one list for Moto Mangos (owner decision, 11 Nov 2026; built)**

This replaces the spec rule "a model can't be saved without a catalog entry" and the open decision recorded just below. Migrations `20261111000300_platform_own_models.sql` and `20261111000400_platform_unit_block_lock.sql`.

- **One list, two uses.** The approved entries of the vehicle catalog are the presets in the management system's make and model dropdowns, and they are the list Moto Mangos uses. There is no second list to keep in step: approving an entry makes it a preset for every shop at once.
- **Presets first.** Make, then model, from the presets is the default path everywhere. "Not in the list? Add my own" is the link underneath.
- **A shop's own make and model** is saved straight away with no approval, for any vehicle (motorbike, car, ATV, boat, other). A model now carries its own make, model, vehicle type, engine size and transmission; a model on a preset takes them from the preset (the database copies them, so they can't drift).
- **Required specs** (owner, 11 Nov 2026, final): vehicle type always; engine size and transmission for motorbikes only. For cars, ATVs, boats and "other" both are optional. The same rule holds in the Add my own form, the model edit form, CSV import and the database (`models_required_specs_check`; migrations `20261111000500` and `20261111000600`, the second withdrawing a short-lived rule that cars need a transmission).
- **No duplicates within a shop:** the same make and model of the shop's own can't be added twice, ignoring case and spacing (database rule). Adding something that is exactly a preset is refused with a link to the preset. Models on presets are not affected: the catalog has one entry per generation, and a shop may keep two models on one entry (owner, 10 Nov).
- **Listing on Moto Mangos is the only place approval comes up.** Each model page has a Moto Mangos box:
  - on a preset: "On the Moto Mangos list as …" and a "List this model on Moto Mangos" switch;
  - the shop's own: close matches are suggested ("Did you mean: Use Honda PCX 160 (2026)"), which links the model to the preset in one click; or "Send to Moto Mangos", which puts it in the platform admin's list;
  - waiting: the shop keeps using the model meanwhile;
  - not a motorbike: Moto Mangos lists motorbikes only for now.
- **The admin's list** (`/admin/catalog`) now offers Approve (it becomes a preset for everyone), Merge into an existing entry (every model waiting on it moves to that entry, closest matches listed first), or Reject (the model goes back to being the shop's own, unlisted).
- **Only a model on an approved preset can be switched on for Moto Mangos** (database rule). The switch is stored now and takes effect when the marketplace reads the platform (Phase 3M).
- **CSV import:** a make and model that matches a preset goes on it; one that doesn't becomes the shop's own, with new optional columns `vehicle_type`, `cc` and `transmission` (required for a motorbike). The old "this make isn't in the catalog" errors are gone.
- **Risk to know:** a shop that types "Hodna PCX 160" as its own gets its own model. Nothing blocks a typo at entry; it is caught when the shop goes to list it, by "Did you mean". Exact matches (any case or spacing) are blocked at entry.

**The availability lock under a real race (found and fixed, 11 Nov 2026)**
- While rerunning the tests, the four-way "who gets the bike" race sometimes hung for 20 seconds. Cause: with the exclusion constraint alone, simultaneous overlapping writes for one bike wait on each other in a circle; Postgres cancels one with "deadlock detected" and the API layer retries it, so losers could spin instead of being refused. Earlier runs passed because the requests happened not to overlap closely enough.
- Fix: writes to one bike's blocks queue behind each other (a transaction-level advisory lock on the bike, taken in the trigger). The exclusion constraint is still the rule. Phase 2's booking function takes the same lock, as the review decision asks.
- The test is now twelve simultaneous writers, five rounds, exact outcome every time (one success, eleven clean overlap refusals, within 5 seconds), plus "different bikes don't wait on each other" and "ending a block while another is added".

- **Platform admins land on their page.** Signing in as a platform admin with no shop used to show "You're not in a shop yet" (found by the owner). They now go straight to the catalog requests; an admin who also works in a shop gets a link beside the shop list.

- **Catalog reviews are audited.** Approve, merge and reject each write an audit record under the shop that sent the entry (who decided, the entry, the note, and for a merge the entry it went into). Before, only the entry's own status, note and review time recorded the decision.

Tests: 95 platform unit, 93 database, 50 Playwright, passing locally and against the PR #8 deploy preview.

**Second round of owner feedback (11 Nov 2026, later the same day)**
- **Current fleet by default.** The Fleet list shows the working fleet: sold and retired bikes are kept, with all their records, but stay out of the list. A "Show" control switches between Current fleet, Sold and retired, and Everything; the header counts the working fleet and links to "N sold or retired". Choosing the Sold or Retired status in the filters finds them whatever "Show" says. The choice is remembered with the rest of the view.
- **Bike Details reordered:** the odometer sits where the location was (for owners and managers it is now part of the Details form, with the same lower-reading confirmation), and the location is the last field. Staff and mechanics keep their separate odometer box, since they can't edit the details.
- **"Group by location" and the location filter** are only offered to shops with more than one location.
- **A make and model already in the list can't be added again** for overlapping years (checked when adding a make or model). Found because three overlapping "Honda Test" entries were added during testing; that check previously existed only for a model's own year bands.
- **A note on bikes with sale details but a status other than Sold.** Saving sale details never changes the status (by design), so a bike could look sold on paper while still Active. The purchase and sale section now says so.
- Tests: 92 platform unit, 84 database, 50 Playwright.

**Closed (11 Nov 2026): how the shared catalog and shops' own vehicles fit together.** Decided and built as described above: the catalog link is optional, and approval happens only when a model is listed on Moto Mangos. The notes below are the question as it was first put.
- Today every model must link to a catalog entry, and the catalog only describes motorbikes (engine size and a bike type are required). A shop can add its own entry and use it at once, but each one lands in the platform admin's review list.
- The owner wants shops to add any vehicle (cars, boats, ATVs) with no approval, while Moto Mangos stays tidy: one Honda PCX, not three spellings.
- Recommended: a model's catalog link becomes optional. A shop's own make and model are stored on its model and need no approval. Moto Mangos lists only models linked to an approved catalog entry, so linking (or asking for a new entry) happens when a shop chooses to list a model there, not when it adds a bike. The catalog is pre-loaded with the popular bikes and year ranges so most shops just pick. This changes the spec rule "a model can't be saved without a catalog entry" and needs the owner's OK before any migration.

## Platform Phase 1a: fleet core (branch `platform/phase-1a-fleet-core`, 11 Nov 2026)

Mapping first: `docs/platform/MAPPING.md` (legacy marketplace tables → tenants, locations, models, units, unit blocks; column by column), approved by the owner on 10 Nov 2026 with the decisions in its §8.

**Built**
- **`platform` schema** (owner decision). Platform tables left `public`; `tenants` and `memberships` moved with their functions. Signed-out visitors have no access to the schema. The app's database client (`@mango/db/platform-server`) points at `platform` only and reads the shared catalog with `.schema("public")`. Nothing is granted by default; every function revokes public execute and checks its caller.
- **Migrations** `20261110000100`–`500` and `20261111000100` (all `_platform_`): schema move and set-form RLS helpers (`my_tenant_ids`, `my_role`), `platform_admins`; `audit_events` with a row trigger and a helper; `locations`, `location_hours`, `location_closures`, `create_tenant()`; the catalog link; `models`, `units`, `unit_financials`, `unit_blocks`, `import_fleet()`.
- **Locations.** Time zone, address, map pin, contacts, hours, closures and (empty until 3M) market sit on the location. `tenants.timezone` is gone. A tenant can only be created together with its default location (`create_tenant`, checked when the transaction ends); the default can't be deleted or unset. Only an owner changes a time zone, with a confirm.
- **Catalog.** `public.bike_catalog` stays the one catalog. Added: `vehicle_type` (new `public.vehicle_types`: motorbike, car with a spec schema), `specs`, `requested_by_tenant_id`. A shop can request an entry and use its own pending request; a platform admin approves at `/admin/catalog`. **Platform admin is defined in one place: `platform.platform_admins`.**
- **Models and units.** Several models per catalog entry, each with its own name. Units: plate (free-form, unique per shop, any letter case) or a "plate pending" flag, frame and engine numbers, colour, odometer in km, status, borrowed window, QR token.
- **`unit_blocks`**: one table (allocation, downtime, hold, transfer), one exclusion constraint on `[start, end)`. Phase 1a writes downtime only.
- **Money.** `bigint` minor units with a currency that must equal the tenant's (composite foreign key). `unit_financials` is owner and manager only. The currency locks once a deposit or a financial row exists (trigger; the settings form shows it locked).
- **Tenant keys.** Every child carries `tenant_id` and references its parent by `(tenant_id, id)`.
- **Audit.** Every insert, update and delete on tenants, memberships, locations, hours, closures, models, units, financials and blocks writes `audit_events` (actor, only the changed columns). Imports and catalog requests are logged too. Owners and managers read it; nobody signed in can write it.
- **Role limits** (owner, 10 Nov 2026): owners and managers edit everything. Staff and mechanics add or end downtime, update the odometer (never down: that needs a manager) and switch a unit between active and maintenance. Drivers read only. The database enforces all of it (`units_guard`, policies); the screens only hide what a role can't do.
- **Screens** (375 px and 1280 px, EN and TH): Fleet list with search, model, bike (details, odometer and status, downtime, purchase and sale, mark as sold, QR sticker), add model, add bike, CSV import with a problems table, QR sticker sheet (prints without the app shell), catalog request, locations (details, hours, closures), `/admin/catalog`. Shop settings: distance unit (km or miles) added, time zone moved out, currency shown locked. Maintenance tab: real search by plate or frame number, plus the bikes in maintenance. Fleet is in the sidebar; on a phone it is reached from Maintenance or "You and this device".
- **CSV import.** Hand-written reader (`lib/csv.ts`: quotes, line breaks in quotes, BOM, comma, semicolon or tab). `lib/fleet-import.ts` checks the whole file and reports every problem by line and column; `import_fleet()` saves it in one transaction. One row per bike; a new model is created from its catalog code.
- **QR stickers.** `qrcode` package (owner OK). A sticker is a link to `/q/<token>`; the token says nothing about the bike. A member of the bike's shop lands on the bike; anyone else gets "not found".
- **Distances** are stored in km and shown in the shop's unit (`lib/distance.ts`; a reading typed in miles comes back as the same miles).
- **Forms keep what was typed** when the server answers with an error (they are submitted by script, with the plain form action as the no-JavaScript fallback).
- **Demo seed**: BSR's address, contacts, hours and a yearly Songkran closure; a platform admin (`admin@mangoworks.demo.test`); 20 demo bikes in 11 models read from `apps/platform/scripts/demo/bsr-fleet.csv` through the real reader and checks. Plates and frame numbers are fake (`DEMO-…`); one bike has no plate. Safe to run again.

**Tests** (all passing locally, 11 Nov 2026)
- Unit: 76 in the platform (CSV, import checks, money, distance, times across daylight-saving changes, form rules), 144 marketplace, 86 core.
- Database: 74 (`npm run test:db -w @mango/platform`). The isolation test now needs a fixture row per tenant in every tenant table (it fails if one is missing, or if a new table has no payload), and tries cross-tenant read, insert, update, delete and "move my row into your shop" as every role and as an outsider, then compares every row of both tenants before and after. Parent keys are tested with the service role. Every function gets a cross-tenant call. No policy may be `using (true)`.
- Playwright: 42 (21 at 375 px, 21 at 1280 px), passing locally, in CI and against the PR #8 deploy preview on staging.
- The hardened test found one real gap while it was being written: `platform_rls_report` and `platform_open_policies` were callable by any signed-in user. Fixed before the migrations were pushed anywhere.
- **No platform table is readable without RLS** (owner's question, 11 Nov 2026). Checked in the database on local and staging: all 11 tables in the schema have RLS on with at least one policy, signed-out visitors have no access to the schema, and a new table gets no automatic grants (the schema's default privileges name the service role only). The check found leftover grants on `tenants` and `memberships` from their Phase 0 creation in `public` (signed-out `select`; `truncate`, `references`, `trigger`). They couldn't be used, and migration `20261111000100` removes them. Two tests now hold this on every run (`platform_exposure_report`, `platform_schema_access`), including for tables without a `tenant_id` and with no views allowed until one has its own test.

**Server response time per page** (median of 5, signed in as the BSR owner, 20 bikes; `TIMINGS=1 npx playwright test timings --project=desktop`)

| Page | Local production build | Deploy preview (US East → Singapore) |
| --- | --- | --- |
| Dashboard | 53 ms | 1.2 s |
| Maintenance | 51 ms | 1.4 s |
| Maintenance search | 56 ms | 1.5 s |
| Fleet | 60 ms | 1.3 s |
| Model | 57 ms | 1.5 s |
| Bike | 65 ms | 1.6 s |
| Add bike | 48 ms | 1.2 s |
| Import CSV | 42 ms | 1.3 s |
| QR stickers (all 20) | 65 ms | 1.7 s |
| Locations | 44 ms | 1.5 s |
| Location | 61 ms | 1.7 s |
| Shop settings | 46 ms | 1.0 s |
| Team | 39 ms | 0.9 s |

**Acceptance checks not truly tested**
- **Scanning a printed sticker with a phone camera.** Tested: the code's link opens the bike for its shop and "not found" for anyone else. Not tested: that a real camera reads the printed code at sticker size. Needs a phone and a printout.
- **Printing.** The sheet hides the app shell with print styles; no test prints a page or checks label alignment.
- **Legacy mapping.** MAPPING.md is a design. No legacy row has been moved; the mapping is exercised for the first time at 3M.
- **"Selling a unit with future bookings is refused"** is tested with a future block (allocation and downtime kinds), as the spec says for this phase. Real bookings arrive in Phase 3.
- **Two people blocking the same bike at once**: tested with four parallel requests on a local database (one wins). Not tested under load or against the hosted database.
- **Time-zone change warning**: the confirm dialog is not driven by a test (no test changes BSR's zone, because other tests read it). The owner-only rule itself is tested in the database.
- **Thai text**: key-for-key parity with English is tested; the wording has not been read by a Thai speaker.

**Staging (11 Nov 2026)**
- All six Phase 1a migrations are on `mango-works-staging` (`supabase db push --db-url`, dry run first; live untouched), `platform` is in its Exposed schemas (owner), and the demo seed has run there (11 catalog entries added, 20 demo bikes).
- **Live needs `platform` added to API › Exposed schemas when this merges.**
- Preview pages take 0.9-1.7 s on the server against 40-65 ms locally: the functions run in US East and each query crosses to Singapore. Pages make 3-6 queries (membership, fleet, catalog, locations, blocks, money), mostly in parallel. The move to Singapore functions is already planned before Phase 4.
- Because `tenants` moved schema on staging, the Phase 0 build on the platform site's production URL stops working against staging until this branch is merged.

**Deferred / known issues**
- Model photo upload (the column exists; upload comes with the online booking page, with its own storage policy and cross-tenant test).
- Booking-mode counts are checked when a model is saved, not when a bike later leaves the fleet; Phase 2's availability function takes the smaller number.
- Odometer history is one current value; the readings log is Phase 1b.
- The audit log has no viewer yet (before Gate A).
- A shop slug of `q`, `admin`, `login`, `auth` or `offline` would collide with a route; sign-up (Phase 11) must reserve them.
- `apps/platform/CLAUDE.md` still says "allocations/downtime"; the spec's handoff section is the source for that file and wasn't edited.
- Running the seed prints a harmless Node warning about module type.

## Platform Phase 0: foundations (merged in PR #7, 10 Nov 2026)

**Built**
- Migrations (`20261109000100`–`300`, all `_platform_`): `tenants` (name, slug, country, currency, timezone, locale; no defaults, time zone checked by a trigger), `memberships` (owner, manager, staff, mechanic, driver; one user can be in several tenants), RLS helpers in a `platform_private` schema the API doesn't expose, `tenant_members()` for the team list, `set_member_role()` / `remove_member()` (owners change anyone; managers only staff, mechanics and drivers; a tenant always keeps an owner), and `platform_rls_report()` (service role only) listing every table with a `tenant_id`.
- `apps/platform` (Next.js 16, same versions as the marketplace, plus `@sentry/nextjs`): sign-in by email + password, email link, Google and LINE (buttons from `NEXT_PUBLIC_AUTH_PROVIDERS`); shop picker for people in several shops; `/[tenant]/…` shell with a sidebar on wide screens and a tab bar on phones; the 4 staff tabs (Dashboard, Orders, New order, Maintenance) laid out with "Arrives in Phase N" placeholders; Team and Shop settings for owners and managers; "You and this device" page with language (EN/TH), appearance (match device/light/dark) and tab bar position (top/bottom), each a per-device cookie; installable PWA (manifest, icons, service worker with an offline page); Sentry, off when the DSN is blank.
- Roles: owners, managers and staff see all 4 tabs; mechanics Dashboard + Maintenance and open on Maintenance; drivers Dashboard + Orders. Team and Shop settings: owners and managers.
- Demo seed: `npm run seed -w @mango/platform` (local) and `npm run seed:staging` — BSR Bike Shop (TH/THB/Asia/Bangkok) with a user per role, Saigon Scooters (VN/VND/Asia/Ho_Chi_Minh), and `both@demo.test` in both. Password = `DEMO_PASSWORD` in `apps/platform/.env.local` (the repo is public, so never committed).
- Tests: 35 unit; 26 DB tests (`npm run test:db -w @mango/platform`), incl. the acceptance check that no member of one tenant, in any role, can read any row of the other, for every table the RLS report lists (new tables are covered automatically); 18 Playwright tests at 375 px and 1280 px.
- CI: platform added to the matrix; new job starts a local Supabase in CI and runs the RLS tests, the seed and Playwright.
- Netlify: `apps/platform/netlify.toml` + ignore script. Marketplace ignore script no longer rebuilds for `supabase/`-only commits.

**Staging and preview (10 Nov 2026)**
- `mango-works-staging` has all 30 migrations (pushed with `supabase db push --db-url`, never `--linked`) and the demo seed (`npm run seed:staging`).
- Netlify site `mango-works-platform` (package dir `apps/platform`, every context on staging). It didn't auto-detect Next.js, so `apps/platform/netlify.toml` names `@netlify/plugin-nextjs`. The Netlify Drawer is off for deploy previews (it covered the phone tab bar).
- Functions run in US East (the plan can't change the region), so each page waits on round trips to Singapore. Playwright against a preview (`PLAYWRIGHT_BASE_URL`) gets 15 s waits, 60 s per test and 2 workers; local and CI keep the defaults. All 18 pass against the PR #7 preview.

**Dashboard, look and speed (10 Nov 2026, change requests #43-44)**
- Dashboard: four tabs (Today, Tomorrow, Upcoming = the 7 days after tomorrow, Late) with a count each; Late is highlighted when it has items. `lib/dashboard.ts` puts each item in exactly one tab. No items yet: each phase feeds its own in. The open tab is kept in `?view=`.
- Decided (owner, 10 Nov 2026): a pickup, delivery or collection whose date has passed and isn't done shows under Late, in its own "Missed" section. The spec's Late sentence says so.
- Look: page `#f4f4f5`, panels white, orange `#c2410c`. Contrast (WCAG 2): white on orange 5.18:1; orange on white 5.18:1, on the grey page 4.71:1; grey text 7.03:1 or better. Dark mode keeps the same orange for fills (white on it 5.18:1) and uses a lighter orange `#fb923c` for text and focus rings, because `#c2410c` on dark grey is only 3.55:1. Ratios are recorded in `app/globals.css`.
- Speed: every route has a `loading.tsx` skeleton; nav links prefetch (Next.js default in production builds). `getUser` checks the access token locally (`getClaims`) instead of calling Supabase Auth, which removes one round trip per page.
- Preview timings, median of 5, signed in as the BSR owner, 1280 px, measured from Thailand against US East functions:
  - Tap to first response: 1.5-2.7 s before, 60-75 ms after (the skeleton).
  - Tap to page content: 1.5-2.7 s before, about 1.4 s after.
  - Full page load: 1.5-2.3 s before, 1.1-1.7 s after.
- Known: because pages now stream behind their loading state, a role opening an admin page it can't see (Team, Shop settings) gets the not-found page with HTTP status 200, not 404. No data is sent. A shop you're not in is still a real 404: the shop picker sits in the `(start)` route group so no loading state wraps the shop layout's membership check.
- Remaining per-page round trips: one memberships query (plus the Team list on Team). The rest of the wait is US East to Singapore.
- Tests: 46 unit, 26 DB, 22 Playwright (11 at 375 px, 11 at 1280 px), all passing locally, in CI and against the PR #7 preview.

**Decided (9 Nov 2026, owner)**
- Sentry added; DSN from env, no-op when unset.
- Staff language and tab bar position are per-device cookies; no `/th` URL prefix.
- Every platform Netlify context points at staging until Gate A.
- Branded sign-in emails deferred (Supabase default emails until then).
- The marketplace `profiles` trigger stays: every auth user, staff included, gets a marketplace profile.
- Desktop works fully for every staff-app screen: same pages, sidebar instead of the tab bar; forms are native inputs and selects, so mouse and keyboard work everywhere.

**Deferred / known issues**
- Inviting team members is Phase 11 (spec). Until then members are added by the seed script or by Mango Works with the service role. Owners and managers can change roles and remove members.
- Tenant columns for later phases (plan, VAT, Stripe, LINE channel, booking rules, marketplace switches) are added by those phases.
- Google and LINE sign-in need the OAuth apps registered under Mango Works and enabled in staging (steps in the PR). Not tested end to end yet; email sign-in is.
- Sentry source-map upload isn't set up (needs `withSentryConfig` and an auth token), so browser stack traces are minified.
- "Pull down to refresh" on the Dashboard is a Refresh button (installed apps have no browser pull-to-refresh). A gesture can come with Phase 3's data.
- The UI and manifest say "Mango Works" until the product name is chosen.
- 2FA, session list and audit log viewer: Phase 11.

## Step 2: marketplace/booking-fees, done (merged in PR #6, 9 Nov 2026)

- From `booking-flow` (commit `ec7de98`) only: `lib/fees.ts`, `lib/fee-lifecycle.ts`, `lib/flags.ts`, `lib/fees.test.ts`, `lib/fee-lifecycle.test.ts` (23 tests). The WIP `marketplace_bookings` migration and everything else stayed behind. `booking-flow` is kept on GitHub for now.
- `fees.ts` takes the market's fee settings: `bookingFee(rental, market)` and `priceBreakdown(…, market)` with `MarketFeeSettings = { currency, feeMinimum, feeRoundingUnit? }`. Amounts are integer minor units of `currency` (THB satang, JPY yen); the exponent comes from `Intl`. No ฿50 or THB in the code. The caller (checkout, not built) supplies the settings: THB, ฿50 minimum, rounding 1 for Bangkok until markets arrive at the adapter switch. Because the adapter still returns whole baht, checkout must convert to satang before calling.
- `fee-lifecycle.ts` takes the shop's IANA time zone on every function. `lib/zoned-time.ts` (`addCalendarDays`) does the DST-aware calendar arithmetic with `Intl` only, no new dependency.
- Tests: 8 fee, 20 lifecycle (the original 23, reworked, plus DST cases), 6 zoned-time.

### Decided (9 Nov 2026, owner)

- **Fee rounding:** the booking fee rounds to whole currency units, halves up, whatever the minor units of the rental. The rounding unit is a per-market setting (`feeRoundingUnit`, in whole units, default 1; e.g. 10 → nearest ฿10).
- **Fee deadlines:** "charged 3 days before pickup" and "unpaid 2 days before pickup → cancelled" are calendar days at the pickup's clock time in the shop's time zone, not 72/48 hours. Across a DST change the gap is 71 or 73 hours. A clock time skipped by a spring-forward change moves forward by the gap; a repeated one takes the earlier instant. `docs/marketplace/SPEC.md` (Failed card charge) updated from "48 hours" to match.
- `BOOKING_ENABLED` is off unless set to exactly `"true"`, and nothing imports `flags.ts` yet, so the site is unchanged whatever the value. Added to `.env.example`. `PLATFORM_EVENTS_SECRET` from `booking-flow`'s `.env.example` was not brought over (nothing uses it).
- The `marketplace` branch (fully merged into `main`) was deleted locally and on GitHub: git can't hold both `marketplace` and `marketplace/…` branches.
- Nothing moved to `packages/core`: the fee and its states are marketplace-owned (`docs/INTEGRATION.md`), not shared rules.

## Step R: done (merged in PR #5)

- `apps/marketplace`: the Bike-Booking app, moved with `git mv` so history is kept.
- `packages/core` (`@mango/core`): rental-days, pricing, availability, closures, money, time, with their tests. Logic unchanged.
- `packages/db` (`@mango/db`): Supabase client factories and `database.types.ts`; `npm run db:types` writes there.
- `packages/config` (`@mango/config`): tsconfig base, ESLint presets with the monorepo boundaries, Prettier base.
- Root npm workspaces with one lockfile; CI (`.github/workflows/ci.yml`); `apps/marketplace/netlify.toml` with an ignore command.
- Docs: `docs/platform/SPEC.md`, `docs/marketplace/*`, the merged `docs/INTEGRATION.md`, and CLAUDE.md files at the root, in the marketplace and in the platform.

## Phase 1b: fleet care (to build)

- Vehicle notes field (fitted accessories), see SPEC Vehicle record: column exists, screen only. Still to do: the staff app's bike card and the Fleet search.

## Next

1. Owner: try the Phase 1a click-through on the deploy preview (phone and desktop), review PR #8, then follow `docs/RUNBOOK-GO-LIVE-PLATFORM.md` after it merges (it covers exposing `platform` on live, in the right order).
2. Owner: register Google and LINE sign-in for staging (not tested end to end yet).
3. Owner: archive `mango-works-platform` (the old repo) if not done yet.
4. Then Phase 2 (pricing + availability), 3 (orders + calendar), 3M (marketplace switch), 1b (fleet care).

## Open

- Platform product name.
- Shared time-zone helper: `lib/zoned-time.ts` is generic (any IANA zone, DST-aware). It may belong in `@mango/core/time` when platform Phase 2 gives that module a time-zone argument; not moved without the owner's say.

## Hard-coded Thailand assumptions (inventory, not fixed)

Step R moved this code unchanged. Each item has a target:
- **P2:** platform Phase 2 (pricing + availability engine). `@mango/core` takes a currency and a time zone.
- **AS:** the marketplace adapter switch after platform Phase 3. Markets arrive, and money moves to minor units.

Marketplace paths are relative to `apps/marketplace/`. Line numbers are as of the Step R branch.

### packages/core

| File:line | What | Target |
| --- | --- | --- |
| `packages/core/src/time.ts` | **Done in Phase 2, stage 3.** The rules are generic in `zoned.ts` (a time-zone argument, no fixed offset, daylight saving handled). `time.ts` keeps the marketplace's names (`toBangkok`, `bangkokDateTime`, `addDays`, `formatBangkok` and the rest) as thin wrappers that pass `Asia/Bangkok`; the fixed UTC+7 arithmetic is gone. The wrappers go when the marketplace gets markets | 3M |
| `packages/core/src/availability.ts:57` | Repair back-on dates compared as Bangkok calendar days. Stays with the pool rule, which is retired at 3M (phase-2-plan §2.6) | 3M |
| `packages/core/src/availability.ts:75` | "Bangkok midnight = 17:00 UTC the day before" boundary. The same | 3M |
| `packages/core/src/money.ts` | **Done in Phase 2, stage 3.** The rules are generic in `currency.ts` (`toMinorUnits`, `fromMinorUnits`, `formatWholeAmount`, by the currency's ISO 4217 exponent and the viewer's locale). `money.ts` keeps `bahtToSatang`, `satangToBaht`, `formatBaht` and `assertWholeBaht` as thin wrappers that pass THB, until the marketplace's money moves to minor units | 3M |
| `packages/core/src/currency.ts` (`currencyExponent`), `apps/platform/lib/money.ts` (`minorExponent`) | **Not Thailand, but the same kind of assumption: the number of decimal places is read from `Intl`, which does not always agree with ISO 4217.** For IDR, HUF, COP, PKR, LAK and MMK, `Intl` (CLDR) answers 0 decimal places, where ISO 4217 and the payment providers use 2 (checked on Node 24: all six answer 0; THB 2, JPY 0, VND 0, KWD 3 are right). A shop in one of those currencies would have its amounts stored and sent 100 times too small or too large at the payment boundary. Nothing takes payments yet. **To fix before a shop in any of those six currencies takes payments:** a table of ISO 4217 exponents in `currency.ts`, used by both functions, with `Intl` kept for display only | Before payments (Phase 7) |
| `packages/core/src/pricing.ts` | Day tables require whole baht (`assertWholeBaht`) and a ฿10 step. Since stage D1 the arithmetic is the currency-neutral one in `price-list.ts`; only the marketplace's wrapper keeps baht, until 3M | 3M |
| `packages/core/src/pricing.ts:61,79` | Autofill rounds to the nearest ฿10, a THB-sized step | P2 |

### apps/marketplace

| File:line | What | Target |
| --- | --- | --- |
| `lib/data/types.ts:233-234` | `NewBooking.payment.currency: "THB"` literal type | AS |
| `lib/fees.test.ts`, `lib/fee-lifecycle.test.ts` | Test fixtures use THB / ฿50 and `Asia/Bangkok`; the code takes currency, minimum and time zone as arguments | none |
| `lib/data/types.ts:235` | `referralCode` passes through; there are no per-market referral rules in code yet (the referral program isn't built) | AS |
| `i18n/request.ts:14` | next-intl `timeZone: "Asia/Bangkok"` | AS |
| `app/(customer)/[locale]/layout.tsx:39` | `timeZone="Asia/Bangkok"` on the customer intl provider | AS |
| `app/admin/layout.tsx:16` | `timeZone="Asia/Bangkok"` on the admin intl provider | AS |
| `app/vendor/layout.tsx:42` | `timeZone="Asia/Bangkok"` (hidden vendor area) | AS |
| `lib/search-params.ts:33,72-77` | Search dates read as Bangkok wall-clock time (`bangkokDateTime`) | AS |
| `app/vendor/actions/fleet.ts:54,316`, `app/vendor/fleet/page.tsx:20` | "Today" is the Bangkok date (hidden vendor area) | AS |
| `app/admin/page.tsx:77`, `app/admin/shops/page.tsx:43`, `app/admin/shops/[id]/page.tsx:85-86` | `formatBangkok` for admin timestamps | AS |
| `components/customer/cards.tsx:88,154,173,178` | `formatBaht` on search cards | AS |
| `components/customer/inclusions.tsx:65` | `formatBaht` for the deposit | AS |
| `app/(customer)/[locale]/bikes/[slug]/[shop]/page.tsx:168,171,217,222,259` | `formatBaht` on the listing page | AS |
| `app/admin/shops/[id]/page.tsx:243,281,289,308,310`, `app/vendor/extras/page.tsx:62-68`, `app/vendor/fleet/[id]/model-form.tsx:114`, `components/vendor/price-editor.tsx:128,173-174` | `formatBaht` in admin and the hidden vendor area | AS |
| `components/vendor/price-editor.tsx:48,138`, `lib/validation/vendor.ts:368` | Price input strips `฿` only | AS |
| `lib/google-maps.ts:44` | `BANGKOK` default map centre (used by `components/customer/map-view.tsx:56`, `components/vendor/map-picker.tsx:95`) | AS |
| `lib/validation/vendor.ts:106-114` | Shop coordinates limited to lat 5–21, lng 97–106 ("Thailand and its neighbours") | AS |
| `app/admin/actions.ts:312-314` | Station coordinates limited to "roughly Thailand" | AS |
| `app/admin/stations/station-form.tsx:44` | Stations have a Thai name only as the second language (`name_th`) | AS |
| `lib/inclusions.ts:59-64` | Riding-area options `bangkok` / `province` / `thailand` / `cross_border` (DB enum `usage_area`) | AS |
| `app/layout.tsx:21-22` | Root metadata "Motorbike Rental Bangkok" | AS |
| `messages/en.json:3,5,542,628,629,649,732` (and the same keys in the 9 other locale files) | "Bangkok" in titles and SEO text | AS |
| `messages/en.json:308,720` (and the other locale files) | "Bangkok only" riding-area label | AS |
| `messages/en.json:280,421,504-507,606` (and the other locale files) | `(฿)` in form labels | AS |
| `e2e/customer.spec.ts:24,40,53-59` | Expected prices in `฿` | AS |
| `e2e/areas.spec.ts:6`, `e2e/languages.spec.ts:70` | Expect the "Motorbike rental in Bangkok" heading | AS |
| `components/customer/shop-info.tsx:6`, `app/vendor/settings/forms.tsx:159` | Weeks start on Monday, "as calendars in Thailand show it" | AS |
| `netlify/functions/supabase-keep-alive.mts:21` | Comment only (07:00 Bangkok); the schedule is UTC | none |

Phone numbers are already international (`lib/validation/profile.ts:3` and `lib/validation/vendor.ts:85` normalise to `+<country><number>`; tests cover a UK number), so there's nothing to change there.

Outside the two folders inventoried: `supabase/migrations` hard-codes `Asia/Bangkok` in `20261105000100_fleet_modes.sql` (3) and `20261107000200_search.sql` (11), and defaults `currency` to `THB` in `20261104000900_country_currency.sql`. New migrations change these. Applied migrations are never edited.
