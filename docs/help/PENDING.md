# Pending article updates

Changes waiting on unmerged work. When the PR merges, update the articles listed, set their `updated` date, and delete the entry here.

## PR 51: Phase 2 stage 10, review follow-ups and migration 6 (open, head `2474a6e`)

The articles were written against `main` at `b9e0b33` and leave out everything below.

### 1. One number rule for every amount and percentage box

After PR 51, `lib/number-input.ts` reads every amount and percentage: a dot for decimals, a comma only between thousands ("1,400"), no spaces. "12,5" and "0,5" are refused where they were read as decimals before, and "1 400" or "1_400" are refused where the separators were dropped.

Messages that change (quote the new text exactly):

| Key | Now on `main` | After PR 51 |
| --- | --- | --- |
| `FormErrors.invalidMoney` | "Enter an amount, such as 45000 or 45000.50." | "Enter an amount such as 200 or 1,234.50. Use a dot for decimals; a comma only between thousands (1,000). No spaces, and no more decimal places than the currency has." |
| `FormErrors.invalidPercent` | "Enter a percentage such as 20 or 12.5." | "Enter a percentage such as 10 or 12.5. Use a dot for decimals, not a comma." |
| `FormErrors.couponInvalidAmount`, `couponInvalidPercent` | the coupon form's own keys | removed; the coupon form uses `invalidMoney` and `invalidPercent` (same text as the old coupon keys) |

Articles to update (each quotes one of these, or describes a box whose input rule changes):

- `en/fleet/mark-as-sold.md` (purchase and sale prices)
- `en/fleet/import-vehicles-csv.md` (purchase price column: only correct thousands commas)
- `en/products/create-a-vehicle-product.md` (buffers in hours: "0,5" is refused; check the message shown)
- `en/products/price-by-rental-length.md`, `long-stay-rate.md`, `use-a-price-list.md`, `flat-fixed-or-free-price.md`, `vehicle-deposit.md` (every amount on the Pricing tab; Check a price)
- `en/price-lists/create-a-price-list.md` (amounts; multipliers may now take a thousands comma)
- `en/pricing-settings/rounding-step.md`, `deposit.md`, `returning-customer-discount.md`, `tax-profiles.md` (rate)
- `en/seasons/set-a-seasonal-price.md` (percentage)
- `en/coupons/create-a-coupon.md` (amount off, minimum spend, percentage, minimum days, total uses)

Consider one short shared article, "Typing amounts and percentages", and link to it from these.

### 2. Coupon codes: full-width letters and digits

After PR 51, full-width letters and digits (such as Ａ or ０) are read as the plain ones instead of refused. Thai letters are still refused.

- `Settings.coupons.codeCantSave` becomes "This code can’t be saved: use only the letters A to Z and the numbers 0 to 9. Thai letters can’t be used."
- `FormErrors.couponInvalidCode` becomes "Use only the letters A to Z and the numbers 0 to 9, up to 40 of them. Spaces are taken out, and full-width letters and numbers (such as Ａ or ０) are read as A or 0. Thai letters can’t be used in a code."

Update: `en/coupons/create-a-coupon.md` (step 3 and both quotes).

### 3. The coupon list's uses

PR 51 reads every coupon's uses in one call, so the list always shows "Used {used} of {limit}" or "Used {used}". The "Uses: not shown (its code is used by a newer coupon)" case and its message are removed.

Update: `en/coupons/switch-off-or-archive-a-coupon.md`. Describe the uses shown on each row, and that an archived coupon whose code was reused shows its own uses.

### 4. Recording a renewal's cost

PR 51 records a tax or insurance renewal and its cost together (`platform.record_renewal()`): either both are saved or neither. The renewal's `recorded_by` is set by the database.

`en/fleet/record-tax-and-insurance.md` leaves the **Cost** box out on purpose. After merge, add it: who sees it (owners and managers), what it is for, and any new refusal messages the form can show.

### 5. Saving opening hours

PR 51 saves a location's week as one set (`platform.save_location_hours()`): if any day is wrong, nothing changes and the old hours stay.

Update: `en/locations/set-opening-hours.md`. Check the messages on a refused save and say that nothing is saved until every day is right.

### 6. Error focus on refused saves

After a refused save, focus moves to the first field with an error. Not needed in any article, but a "Common problems" intro could say "the first box with a problem is selected".

## PR 59: help articles for the Moto Mangos tab, gear stock, history and catalog requests (open)

Written against `main` before Phase 2 stage 11. When it merges:

### 1. The Moto Mangos tab: the notice line (stage 11)

Under **Lead time (hours)** the tab now shows, when the shop's minimum notice is longer than the lead time: "Bookings need N hours: your shop's minimum notice." (`Fleet.motoMangos.shopNotice`). Add it to the Moto Mangos tab article, with a link to [Set your booking rules](en/booking-rules/set-booking-rules.md): the longer of the two applies to Moto Mangos bookings.

### 2. Catalog requests: approving does not switch the listing on (Mark, 20 Nov 2026)

Mark's decision: approving or merging a request at `/admin/catalog` connects the shop's model to the catalog entry and must **not** switch its Moto Mangos listing on; the shop switches it on itself, with the same switch and steps as any other connected vehicle.

**Today the database still switches it on** (`platform.review_catalog_request()`, `supabase/migrations/20261114000200_platform_product_listings.sql`, lines 684 to 689 for a merge and 715 to 720 for an approval). The change needs a migration and is listed in `docs/PROGRESS.md` under "Next platform migration". So:

- When PR 59 merges, before that migration: the catalog-requests article says what happens today (approval lists the model on Moto Mangos), and that this changes with the next platform update.
- When the migration lands: the article says approval connects the model only, and the shop then switches the listing on from the vehicle's Moto Mangos tab ("the same as any other connected vehicle"), and its `updated` date moves.
