# Pending article updates

Changes waiting on unmerged work. When the PR merges, update the articles listed, set their `updated` date, and delete the entry here.

## PR 59: help articles for the Moto Mangos tab, gear stock, history and catalog requests (open)

Written against `main` before Phase 2 stage 11. When it merges:

### 1. The Moto Mangos tab: the notice line (stage 11)

Under **Lead time (hours)** the tab now shows, when the shop's minimum notice is longer than the lead time: "Bookings need N hours: your shop's minimum notice." (`Fleet.motoMangos.shopNotice`). Add it to the Moto Mangos tab article, with a link to [Set your booking rules](en/booking-rules/set-booking-rules.md): the longer of the two applies to Moto Mangos bookings.

### 2. Catalog requests: approving does not switch the listing on (Mark, 20 Nov 2026)

Mark's decision: approving or merging a request at `/admin/catalog` connects the shop's model to the catalog entry and must **not** switch its Moto Mangos listing on; the shop switches it on itself, with the same switch and steps as any other connected vehicle.

**Today the database still switches it on** (`platform.review_catalog_request()`, `supabase/migrations/20261114000200_platform_product_listings.sql`, lines 684 to 689 for a merge and 715 to 720 for an approval). The change needs a migration and is listed in `docs/PROGRESS.md` under "Next platform migration". So:

- When PR 59 merges, before that migration: the catalog-requests article says what happens today (approval lists the model on Moto Mangos), and that this changes with the next platform update.
- When the migration lands: the article says approval connects the model only, and the shop then switches the listing on from the vehicle's Moto Mangos tab ("the same as any other connected vehicle"), and its `updated` date moves.
