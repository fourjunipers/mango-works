# CLAUDE.md (repo root)

Rules for every session in this repo. Each app has its own CLAUDE.md as well; read the root file and the app's file before any work:

- Marketplace: `apps/marketplace/CLAUDE.md`. Spec: `docs/marketplace/SPEC.md`.
- Platform: `apps/platform/CLAUDE.md`. Spec: `docs/platform/SPEC.md`.
- Contract between them: `docs/INTEGRATION.md`. Status and known issues: `docs/PROGRESS.md`.

If code and the spec disagree, the spec wins. If the spec is unclear or seems wrong, stop and ask. Don't guess.

## Names

| Name | What |
| --- | --- |
| **Mango Works Co., Ltd.** | Parent company. Repo (`mango-works`) and package scope (`@mango`) |
| **Moto Mangos** | Marketplace brand: the customer site in `apps/marketplace` (today's Bike-Booking site) |
| Platform | Rental management platform in `apps/platform`. Product name not chosen yet |

Folder and package names stay brand-neutral (`apps/marketplace`, `apps/platform`, `@mango/*`). Don't rebrand UI text unless asked.

## Layout

```text
apps/marketplace/   Moto Mangos (Next.js)
apps/platform/      rental management platform (scaffolded in platform Phase 0)
packages/core/      @mango/core: pure rules (rental days, pricing, availability, closures, money, time)
packages/db/        @mango/db: Supabase client factories + generated database types
packages/config/    @mango/config: shared tsconfig, ESLint, Prettier
supabase/           the one migrations folder for the one database
docs/               platform/, marketplace/, INTEGRATION.md, PROGRESS.md
```

npm workspaces, one `package-lock.json` at the root. Run `npm install` at the root only. Ask before adding a dependency or a build tool (no Turborepo, Nx or pnpm without asking).

## Boundaries (ESLint enforces these)

- An app never imports from another app. Shared code goes in `packages/`.
- `packages/core` is pure TypeScript: no React, Next.js or Supabase. Packages never import from an app or use an app's `@/` alias.
- The marketplace reads shop data only through its `lib/data` adapter (see `apps/marketplace/CLAUDE.md`).
- Table ownership follows `docs/INTEGRATION.md` §1.

## Branches, commits and migrations

- Branches carry the app: `platform/phase-N-name`, `marketplace/phase-N-name` (repo-wide work: a plain descriptive name, e.g. `restructure-monorepo`).
- Small commits, one logical change each. Work on branches and merge to `main` through a PR.
- **Production publishes from the `release` branch, not from `main`.** A merge to `main` makes a branch deploy, which is free. `main` is merged into `release` only when Mark says "publish": never on your own, and never as part of merging a PR. (Database migrations are a separate matter: see Environments.)
- Migrations live only in `supabase/migrations`. Never edit an applied migration and never change the database by hand.
- New tables get no access by default (live, local and CI alike). A migration that creates a table grants on purpose, to `service_role` too; a new function starts with `revoke all on function ... from public, anon`. `apps/platform/tests/db/default-grants.test.ts` fails otherwise.
- Migration names carry the owner: `<timestamp>_platform_<what>.sql` or `<timestamp>_marketplace_<what>.sql`. The 27 migrations from before Step R keep their names.

## Lock order (platform database)

Every function or trigger that takes more than one lock takes them in this order (docs/phase-2-plan.md §4). A new writer that needs another order is a deadlock waiting to happen: ask first.

1. **Product-and-location advisory locks** (namespace `1a02`), sorted by the lock's own key: `platform_private.lock_product_stock()` for one product, `lock_products_stock()` for several.
2. **Unit advisory locks** (namespace `1a01`), sorted by the lock's own key, through `platform_private.lock_units()`. By key (`hashtext` of the id), never by UUID.
3. **Rows**, always after the advisory locks: unit rows in id order, then the product's row, then its listing's row, in product-id order; then coupon rows in id order (`for update`); then `reservations`; then `unit_blocks`. Unit rows come first because deleting a unit takes no advisory lock: it locks the unit's row, then the product's.

A booking reads prices before its transaction and never locks a pricing row, a price list or a tax profile. Stock is taken only through `platform.reserve()` and its siblings (`confirm_hold`, `cancel_reservation`, `assign_units`, `move_unit`, the hold sweep); nothing else writes an allocation or a hold.

- **Releasing a hold that has run out** only deletes blocks, in the rows phase, under the product lock that every writer of that reservation's blocks holds. It takes no unit lock: a second batch of unit locks, or a block row deleted before the unit rows are locked, would each open a cycle.
- **Deleting a unit** takes the unit's lock without waiting (a `before delete` trigger): if anything holds it, the delete fails with `unit_busy` and can be sent again. It must never wait there, because Postgres locks the row before the trigger runs, and row-then-lock is the opposite of this order. A function that deletes units takes their locks first with `lock_units()`.
- **Which unit changes take the unit lock:** a block written or moved; a unit sold, retired or marked lost; a unit changing its product or place. Each reads the unit's blocks, so it must see them settled. A unit put into repair or back takes none: it checks nothing a booking writes, and it changes no key column, so it can neither be refused by a booking nor wait for one.
- **Sold, retired or lost: one unit per transaction, unless the transaction already holds every such unit's lock (as `lock_units()` takes them)** (Phase 3 stage 1, `20261123000100`). `units_guard` takes such a unit's lock in the statement's row order, so two statements over several units could cross: a second unit is refused (`one_unit_status_change`) before its lock is asked for. `report_gear_problem()` and `set_stock_quantity()` change several gear units in one call and are the only users of the exception: each takes the product-and-location lock, then all its units' locks through `lock_units()`, then updates. A new function that changes several units to sold, retired or lost does the same. The guard checks only that the locks are held; it cannot see that they were taken sorted, so that is the caller's part: only functions that take all their units' locks through `lock_units()` may use this path, and it is not reachable through PostgREST. The guard reads `pg_locks` through `platform_private.holds_unit_lock()`, and the lock's key comes from `unit_lock_class()` and `unit_lock_key()`, which `lock_units()` uses too. **Every unit lock is transaction-level (`pg_advisory_xact_lock`) and must stay so:** `pg_locks` can't tell a session-level lock apart. A unit can be marked lost at any time, while it is out and with bookings ahead; selling or retiring is still refused while blocks lie ahead (`unit_has_future_blocks`).
- **The two guards lock the row before the unit lock.** `units_guard` and `unit_blocks_guard` are `before` triggers, and Postgres locks the row before a trigger runs: a direct update of a unit takes the unit's row and then its lock; a block insert or update takes its lock inside the statement. That is safe only because nothing that holds a unit's lock waits for that unit's row in a conflicting strength: a booking takes the row `for key share`, which a status or product change does not block, and anything stronger is asked for without waiting (`move_unit()` takes the row `nowait` and answers `try_again`; a delete asks for the lock without waiting). A new function that holds a unit's lock and needs its row for update must do the same. One crossing of this kind is known and left as it is, a unit delete against a mechanic editing that unit's downtime block: the edit holds the block's row and then asks for the unit's lock (the block's row, then the unit lock), while the delete, having taken the unit's lock without waiting, waits for the block's row to clear the unit's downtime, which needs the delete to land in the microseconds between the edit's two steps and which Postgres would break as a deadlock that either side can send again.
- **A Moto Mangos booking takes its listings' rows after the products' rows**, in product-id order, `for no key update`: the cap (`instant_units + request_units`) is counted under that row. Two Moto Mangos bookings of one product for two places share no product-and-location lock, so the listing's row is what makes them take turns. `save_listing()` and a vehicle leaving take the same two rows in the same order.
- **A unit's product changes only through `platform.move_unit()`, one unit per transaction** (Phase 3 stage 1). `move_unit()` sets the transaction-local setting `platform.moving_unit` to the unit's id just before it updates the unit and to `done` straight after; `units_guard` refuses any other product change (`use_move_unit`), for the service role and the database's owner too, and a direct one after a `move_unit()` in the same transaction; a second `move_unit()` in one transaction is refused (`one_move_per_transaction`), whatever the first answered (`stale`, `try_again`, `bookings_changed`, nothing to do: each leaves its locks held), because the marker is set to `started` straight after that check. Its locks: the product-and-location locks of where the unit is, where it goes and whatever its bookings name, sorted once; then the unit's lock; then rows (the unit's row without waiting, **both products' rows in id order, `for no key update`, at once**, the reservations, which take the new product and place, then the unit's own row). Two opposite moves at one place take turns at the advisory locks; at two places, at the product rows. **A place change alone** may still be a direct update: the guard refuses it while a booking that has not ended names where the unit was (`unit_has_bookings`), and `move_unit()` takes the bookings along. So a reservation that holds a unit always names that unit's product and place.
- **A statement that changes or deletes units takes every product row it affects once, in id order** (`for no key update`), then each product's listing row in the same order: the statement-level triggers `units_counts_after_update` and `units_counts_after_delete` (transition tables), which replaced the row trigger `units_clamp_product_counts`. A booking holds its product rows `for share` in id order, so the two can only take turns. A new trigger on `units` that needs a product row takes it the same way, or asks first.
- **`review_catalog_request()` takes its products' rows in id order, `for no key update`, then the catalog entry** (the order a product's delete takes them in); a product linked to the entry in between is answered `try_again`; it has the 6-second lock timeout. It never writes a listing on approve or merge: the shop switches its Moto Mangos listing on itself.
- **Saving the extras offered with a vehicle** (`platform.save_product_extras()`) takes no advisory lock, only rows: the vehicle product's row `for no key update` (for the "every vehicle" list, the shop's row instead), then the extra products' rows `for key share` in id order, then the list's own `product_extras` rows in extra-id order. A booking takes product rows `for share` and never a `product_extras` row, so the two can only take turns at the vehicle's row. The extra products' rows come before the links because deleting a product locks its row and then, by the cascade, its links.
- **A booking with a coupon takes the coupon's row after the products' and the listings' rows** (`platform.coupons`, `for update`), before any reservation or block. The coupon's rules ran before the transaction (`decideDiscounts`); under that row `reserve()` reads again what a save or another booking can have changed (switched off, archived, the currency, the shop's "Accept coupons" switch, the uses), counts the uses and writes the redemption with the booking. **A use is only ever added under the coupon's row**, so two bookings after a coupon's last use take turns there. Two functions add one: `reserve()`, which writes it, and **`confirm_hold()`**, which makes a hold's use last. A hold that has run out holds no use, so a confirm that finished after that moment would bring a use back beside a booking that had taken it meanwhile. `confirm_hold()` therefore takes the booking's coupon row `for update`, after its advisory locks and (for Moto Mangos) the products' and listings' rows and before the reservations, and judges the hold's expiry by the clock (`clock_timestamp()`) once every lock is held, never by when the call began. `cancel_reservation()` takes the coupon's row in the same place, and gives the use back under it. A new function that turns a held or released use into a live one takes the coupon's row first. **The hold sweep takes no coupon row**: the sweep inside `reserve()` runs with that call's own coupon row already held, and a second coupon row there could not be taken in id order. It does not need one, because a use given back without the lock can only make a count read high for a moment. A hold that has run out holds no use, swept or not (`platform_private.coupon_uses()`).
- **Saving a coupon** (`platform.save_coupon()`) takes no advisory lock, only rows: the coupon's row `for update`, then its `coupon_products` links in product-id order. A new link takes its product's row `for key share` (the foreign key), which a booking's `for share` does not block. It has the 6-second lock timeout; its one caller, `apps/platform/lib/coupon-save.ts` (used by Settings › Coupons), answers `try_again` for `40P01` (a deadlock Postgres broke: `save_coupon()` raises it, where the booking functions catch it themselves), `55P03` and `57014`, with nothing written.
- **Saving the booking rules** (`platform.save_booking_rules()`) takes no advisory lock, only rows: the shop's row (`update`), then its locations' rows `for no key update` in id order, then the vehicles' rows `for no key update` in id order. A booking reads the rules before its transaction (`booking_inputs()`), takes product rows `for share` and never a location's or the shop's row, so the two can only take turns at a vehicle's row. It has no lock timeout of its own; its one caller, `apps/platform/lib/booking-rules-save.ts` (Settings › Booking rules, since stage 11), answers "try again" for `57014` (the API's 8 seconds) and `55P03`, with nothing written.
- **The booking functions give up on a lock after 6 seconds.** `reserve()`, `confirm_hold()`, `cancel_reservation()`, `assign_units()` and `move_unit()` each have `lock_timeout = '6s'` set on the function, shorter than the API's 8-second statement timeout, so a wait that runs out raises `55P03` with nothing written. Every caller answers `try_again` for `55P03` and for `57014` (`apps/platform/lib/try-again.ts`): online through `bookOnline()`, staff through `lib/staff-booking.ts`. A new function that waits for these locks gets the same setting, and its caller goes through one of those two. One waiter has none on purpose: the hold sweep, `platform.release_expired_holds()`, runs from cron (no API statement timeout, nobody to answer) and waits for the product locks as long as it must. `save_product_extras()` takes rows only and has the same 6-second lock timeout (since stage 6, `20261117000200`); its one caller, `apps/platform/lib/extras-save.ts`, answers "try again" for `55P03` and `57014` too.

## Environments

| Environment | Supabase | Gets migrations |
| --- | --- | --- |
| Local | Supabase CLI (Docker), run from the repo root | Every branch |
| Staging | Separate free project | Branches under test, pushed by hand |
| Live | Today's Bike-Booking project (also runs the marketplace) | Only from `main` |

Never push migrations to live from a branch. Stripe stays in test mode until the owner says otherwise. Never commit secrets: keys live in each app's `.env.local` (git-ignored), and each app's `.env.example` lists every variable.

## Not tied to Supabase: the Neon move

**Decided 19 Nov 2026: the database moves from Supabase to Neon after Phase 3, before 3M and before BSR goes live.** A spike comes first, with a go or no-go for Mark; the move goes ahead only if it shows no meaningful performance loss on live. Live is always on, in Singapore, with no scale-to-zero; staging may scale to zero. The plan, its stages and their rollbacks are in `docs/platform/neon-move-plan.md`. Until the cutover everything still runs on Supabase, and the rest of this file describes that.

Six standing rules keep the move small. They bind all new code; code that does not follow them yet is listed in `docs/PROGRESS.md`, so don't spread it.

- **All database access goes through `packages/db`.** An app or another package gets its client from `@mango/db` and never creates one itself or imports `@supabase/*`. Queries and RPC calls are made with that client, using only `.from()`, `.rpc()` and `.schema()`.
- **File storage sits behind one module.** Uploading, deleting, viewing and making the address of a stored file go through that module, and nothing else calls `.storage` or a file provider's API. Public images live on the platform's own store; every private file lives in the shop's connected provider (Google Drive today), with only a link kept (`docs/platform/file-storage-design.md`). Mango Works staff never open a shop's files.
- **Sign-in goes through one helper, with no Supabase-only features.** Signing in, signing out, the session and "who is this" are asked of that helper. Use only what any sign-in provider offers (email and password or link, OAuth, a session); nothing that exists on Supabase alone.
- **RLS uses the `my_tenant_ids()`-style helpers, not `auth.uid()` directly.** A policy asks `platform_private.my_tenant_ids()`, `my_role()` or `has_role()`. Who the caller is, is read in those helpers and nowhere else in a policy, so moving changes the helpers and not every policy.
- **Who is calling is read in our own functions and nowhere else.** From Phase 3 stage 1, new SQL (functions, triggers, column defaults, the audit) asks the platform's own "who is calling" functions for the caller's id and whether the caller is the service role. They are `platform_private.app_uid()` and `platform_private.app_role()` (`20261123000100`; Phase 3 plan §3.11). They read the request's claims (`request.jwt.claims`) and nothing of Supabase's, so the move leaves them as they are; with no request they answer null. New and re-created SQL calls them and never `auth.uid()` or `auth.role()`; `apps/platform/tests/db/caller-functions.test.ts` pins the older direct uses that are left, and that count only goes down.
- **Database jobs only queue.** A scheduled job writes rows; whatever calls the outside world (email, LINE, a webhook, a payment provider) runs in the app. A job must be safe when it does not run: staging on Neon has no schedule.

**Do not start using** (each would make the move harder; ask first if a feature seems to need one):

- **Realtime**: channels, `postgres_changes`, broadcast, presence.
- **Edge Functions**, and `supabase.functions.invoke()`.
- **`pg_net`, the `http` extension and Database Webhooks**: no HTTP call from inside the database.
- **Vault and pgsodium.** Secrets live in the app's environment.
- **Supabase Queues (`pgmq`)** and **Supabase Cron jobs that call a URL or an Edge Function.** A pg_cron job that runs SQL is fine.
- **GraphQL** (`pg_graphql`, the `graphql_public` API).
- **Storage beyond the one module**: no new policy on `storage.objects`, no `storage.foldername()` in new SQL, no image transformations, no signed addresses made outside the module.
- **Auth features only Supabase has**: its MFA, phone and SMS sign-in, anonymous sign-in, SSO or SAML, new Auth hooks (custom access token, before user created), `app_metadata` or custom claims read by a policy, `auth.admin.*` outside the sign-in helper and the scripts.
- **The `auth` schema in new SQL**: no new foreign key to `auth.users` (point at `profiles` or a platform table), no new trigger on it, no read of any `auth.*` table, no `auth.jwt()`.
- **A new extension** before checking that Neon supports it (`https://neon.com/docs/extensions/pg-extensions`).
- **A setting made only in the Supabase dashboard.** If one is needed, write it down in the runbook the same day: the send-email hook is in no file in this repo.
- **Supabase branching, log drains and the dashboard's SQL editor** as part of any workflow.

## Built for any country

The platform works for a shop in any country; Moto Mangos goes live market by market (docs/platform/SPEC.md › Built for any country).

- **No new code may assume Thailand, THB, Bangkok time or Thai-only formats.** Currency, time zone and locale come from the **tenant** (platform) or the **market** (marketplace), never a constant.
- **Money** is stored as integer minor units by the currency's ISO 4217 exponent (THB ×100, JPY and VND ×1), always with a currency code. No floats. Format with the viewer's locale (`Intl.NumberFormat`), not a hard-coded symbol.
- **Time** is stored in UTC (`timestamptz`). Business rules run in the tenant's or market's time zone, and must not assume a fixed offset or no daylight saving.
- **Phones, addresses, plates:** international phone format; free-form addresses and plates.
- **Existing hard-codes** (whole baht, Asia/Bangkok, `฿`) are listed in `docs/PROGRESS.md` with the phase that removes them. Don't spread them into new code; don't fix them outside that phase.

## Checks

Every PR runs typecheck, lint and unit tests per workspace in CI (`.github/workflows/ci.yml`). From the root:

```bash
npm run typecheck && npm run lint && npm test
```

At the end of a session, update `docs/PROGRESS.md` (what's done, decisions, known issues).
