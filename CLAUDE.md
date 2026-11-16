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
- Small commits, one logical change each. Work on branches; merge to `main` in batches (each Netlify production deploy costs credits).
- Migrations live only in `supabase/migrations`. Never edit an applied migration and never change the database by hand.
- New tables get no access by default (live, local and CI alike). A migration that creates a table grants on purpose, to `service_role` too; a new function starts with `revoke all on function ... from public, anon`. `apps/platform/tests/db/default-grants.test.ts` fails otherwise.
- Migration names carry the owner: `<timestamp>_platform_<what>.sql` or `<timestamp>_marketplace_<what>.sql`. The 27 migrations from before Step R keep their names.

## Lock order (platform database)

Every function or trigger that takes more than one lock takes them in this order (docs/phase-2-plan.md §4). A new writer that needs another order is a deadlock waiting to happen: ask first.

1. **Product-and-location advisory locks** (namespace `1a02`), sorted by the lock's own key: `platform_private.lock_product_stock()` for one product, `lock_products_stock()` for several.
2. **Unit advisory locks** (namespace `1a01`), sorted by the lock's own key, through `platform_private.lock_units()`. By key (`hashtext` of the id), never by UUID.
3. **Rows**, always after the advisory locks: unit rows in id order, then the product's row, then its listing's row, in product-id order; then `reservations`; then `unit_blocks`. Unit rows come first because deleting a unit takes no advisory lock: it locks the unit's row, then the product's.

A booking reads prices before its transaction and never locks a pricing row, a price list or a tax profile. Stock is taken only through `platform.reserve()` and its siblings; nothing else writes an allocation or a hold.

## Environments

| Environment | Supabase | Gets migrations |
| --- | --- | --- |
| Local | Supabase CLI (Docker), run from the repo root | Every branch |
| Staging | Separate free project | Branches under test, pushed by hand |
| Live | Today's Bike-Booking project (also runs the marketplace) | Only from `main` |

Never push migrations to live from a branch. Stripe stays in test mode until the owner says otherwise. Never commit secrets: keys live in each app's `.env.local` (git-ignored), and each app's `.env.example` lists every variable.

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
