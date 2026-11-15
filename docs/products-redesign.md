# Products redesign: design review

13 Nov 2026. Design only: no code, no migration, nothing applied anywhere. Written from `main` at `771fa4f` (PR 13 merged).

**What this is.** Mark approved a brief to replace the separate "Make & model" and "Add to inventory" screens with one Products list, closer to Booqable's workflow, while keeping the vehicle records Booqable lacks. This document turns that brief into a database design, availability and pricing rules, a screen map, a build order and a list of questions. Where it says "recommended", that is my proposal, not a decision. Nothing here overrides `docs/platform/SPEC.md` until Mark works it into the spec (§8 lists the spec edits it needs).

**Second version, same day.** Mark answered the review's questions and accepted its five disagreements with the brief. His decisions are listed next and worked into every section below; where a section still says "recommended", it is a point he has not ruled on.

## Decisions (Mark, 13 Nov 2026)

| # | Decision | Where |
| --- | --- | --- |
| 1 | Rename `models` to `products` | §1.2 |
| 2 | Moto Mangos listings keep today's split: two counts (instant, by request) with a simple control on top | §1.4, §2.6 |
| 3 | ~~The create form has one type-ahead of known models that fills make, model, engine size and transmission.~~ **Superseded by decision 17** after the click-through: it was built, tried and removed | §4.1 |
| 4 | Delivery: the computed distance fee stays for every shop. A shop may also add its own flat "Delivery" service product. Nothing is preset | §3.5 |
| 5 | **No preset products ship**, and product names are free text. No built-in damage cover, "tax and insurance" or delivery product | §1.2 |
| 6 | A vehicle's own tax and insurance are the legally required records on each unit (`unit_renewals`). A product a vendor calls "tax and insurance" or "full coverage" is that vendor's own optional add-on or side service (BSR helps customers with licences, tax and insurance for their own vehicles) | §1.3 |
| 7 | Service and Item for sale must handle any vendor's own general goods and services: stickers, shirts, hats | §1.2 |
| 8 | Thai for "product" is สินค้า, provisional, until Korn or BSR's admin reviews it | §4.1 |
| 9 | Items for sale: allowed in the database from stage A; owners enter them (name and stock) from stage B; prices come in stage D; selling comes with orders in Phase 3 | §2.5 |
| 10 | Sizes: separate products per size (Helmet S, M, L), each with its own quantity, until after the pilot; then real variations | §5.5 |
| 11 | The units-to-offer cap counts only Moto Mangos bookings | §2.6 |
| 12 | Only owners and managers switch Moto Mangos on and off or change gear quantities. Owners, managers and staff may mark a unit lost or damaged; mechanics may not mark one lost. Staff see prices but can't change them. Mechanics and drivers see no prices | §4.2 |
| 13 | Lead time is plain hours from now. The stricter of the shop's minimum notice and the listing's lead time applies | §2.6 |
| 14 | The deposit on an order is the sum of each vehicle's deposit (two bikes, two deposits), adjustable by staff | §3.3 |
| 15 | Tiered pricing is entered as anchor prices (daily, weekly, two weeks, three weeks, monthly); the system fills the days between; every filled-in price stays editable. The spec's stored "price per day" mode is dropped; a "same price every day" helper fills the anchor totals instead, all editable | §3.2 |
| 16 | Open, Mark answers later: whether BSR's 30 Booqable templates are multipliers or fixed amounts. It matters only to the importer (Phase 10) | §7 |
| 17 | **After the Stage A click-through (13 Nov 2026).** The create form is headed "Product details" and asks for the kind ("What kind of product is it?") and one line: the product name (placeholder "e.g. Honda PCX 160"). No type-ahead, no make, model, engine size or transmission on it. Names are unique in a shop ignoring case and all spacing. The four columns stay, nullable, for Moto Mangos matching. When a motorbike is sent for review, the Moto Mangos panel asks for all four at that moment (required), or the shop picks an approved model from the list. Off-road gains Dirt bike beside ATV and UTV | §1.2, §4.1 |
| 18 | **Stage B direction (13 Nov 2026).** The create page opens with two choices, Vehicle and General. Vehicle: kind chips and name, with licence class, minimum age, buffers and categories. General: a type (Rental gear, Item for sale, Service or extra), no licence class, minimum age or buffers, and a quantity where it applies. The Products list gets All, Vehicles and General tabs | §4.1, §5.7 |
| 19 | **No make or model on the platform (13 Nov 2026, second click-through). This supersedes every earlier make and model decision in this document** (decisions 3 and 17 where they speak of them, §4.1's vehicle form, §5.6's create form, and the unit and Fleet columns in §1.3 and §4.1). A product is known by its name on every platform screen: no make, model, engine size or transmission field, filter, column, grouping, count or label, including Add vehicle (one Product dropdown, A to Z), Fleet, Products, search, stickers and the CSV import (a product name per row). The database columns stay, nullable, for Moto Mangos matching. The only place the five details are asked is the Moto Mangos review form: make, model, engine size, transmission and "Year of your bike" (one year, required). The year range a list entry covers is set by the Moto Mangos admin at approval. The Moto Mangos panel reads top to bottom: logo; "List it on Moto Mangos"; "Select your make and model from the list"; "Don't see your bike above? Send us the details and we'll get it added", which opens the review form; then the listing switch and settings, usable once a model is selected or approved. Fleet is one line per product, A to Z, with vehicle and available counts and one search box. Buffers are entered in hours and stored in minutes. A product page has Duplicate, and Retire and Delete at its very bottom | §4.1, docs/PROGRESS.md |
| 20 | **After the third click-through (13 Nov 2026).** The Moto Mangos panel shows only for the Motorbike kind (any of its categories); hidden for Off-road (ATV, UTV, Dirt bike), Car, Boat and Other. The list picker is two dropdowns, Make then Model with its years, and its button reads "Select". Listing quantities are headed "Set bike quantities per booking type" with a line each for Instant units, Request units and Walk-ins. A product is deleted, not retired, from its page, and only when it has no vehicles of any status; the retired status stays in the database. Fleet lines carry the Products list's tags; an edit pencil beside the title opens the product on both lists. **This supersedes §1.2's "retire, restore and delete rules apply to every type" as far as the screens go.** Manual ordering of products (drag, Move up and Move down, Reset to A–Z, one shared order per shop) is asked for and not built yet: see docs/PROGRESS.md | §4.1, docs/PROGRESS.md |
| 21 | **Stage B confirmations (13 Nov 2026), built in PR 17.** General products hide and store no buffers (and no deposit). New product opens with Vehicle or General; General asks for a type (Rental gear, Item for sale, Service or extra), a name and a description, with a quantity per location for gear and items for sale and none for a service. The Products list has All, Vehicles and General tabs. A general product's page is Details, Stock and History: "Change quantity" is for owners and managers; "Mark damaged" and "Mark lost" for owners, managers and staff; a mechanic is refused on lost; only an owner or manager restores or removes a lost unit. **Tracked gear is one nameless row per unit with an optional label: this supersedes §1.3 and §2.4 where they say a tracked unit needs a label.** A product already on a Moto Mangos list entry has "Change model" and "Disconnect" (owners and managers, audited, bookings left untouched). Manual order, step one: one order per shop for Fleet and Products, Move up and Move down on each line, "Reset to A–Z"; dragging is a follow-up PR (§5.8) | §5.7, §5.8 |
| 22 | **After the PR 17 click-through (14 Nov 2026): the Stock tab's states.** A unit of gear is in one of three states, each under its own heading on the Stock tab with one line of help and its own actions: **In use** ("Mark damaged", "Mark lost"), **Damaged** ("Back in use": it returns to the available count) and **Lost** ("Found, back in use" restores it; "Write off" removes it permanently). "Write off" replaces "Remove for good" and "Found, back in use" replaces "Back in stock". "Write off" asks first, saying it cannot be undone, that the unit leaves the product's stock counts, and that History keeps a record. History uses the buttons' words. Who may do what is unchanged, and so is the database | §5.7 |
| 23 | **Stage C answers (14 Nov 2026).** (1) No shop minimum notice in stage C: only the listing's lead time is stored, and the stricter-of rule is a pure, tested function in `@mango/core`. (2) The stricter rule stands, though the old marketplace let a model's notice replace its shop's; noted for the 3M switch-over check (`docs/platform/MAPPING.md`). (3) The quantities stay three plain lines (Instant units, Request units, Walk-ins) with a derived "Offering N of M" line: **this supersedes decision 2's "simple control on top" and §1.4's "Units to offer / All instant / All by request / Split them"**. (4) Owners and managers only for now, the walk-ins count included, with the database built so staff can be added later: **this supersedes §1.4 and §4.2 where they let staff change the walk-ins count**. (5) No switch on the Products list row: **this supersedes §4.1's "Moto Mangos chip and switch" on the list**. (6) "Ride today" bookings do not count against the cap. (7) The listing's counts are per product, not per location. (8) Only a product that is listed, has a count above zero or has a ready-updated time gets a listing row at conversion | §1.4, §2.6, §5.10 |
| 24 | **Stage D, pricing (15 Nov 2026), from BSR's real Booqable data.** Booqable's templates are multipliers; BSR's have a tile for every day 1 to 31 and then a set amount per extra day. Equal totals on neighbouring days are allowed; only a total that falls as days rise is refused. An import stores the exact amount Booqable charges for each day, satang included. Only four templates are loaded (300–3000, 350–3500, 400–4000, 500–5400). All in stage D: flat fee per period, fixed price and tiered pricing (a base price × multipliers, or amounts per day); quick entry of hourly, daily, weekly, two-week, three-week and monthly prices with the days between filled in and editable; seasonal date-range percentage rules on the part of the order inside the range; four deposit choices (none, a percentage of the order, fixed per order, per product) with order and customer overrides; shops' own tax profiles, a default, non-taxable products and a shop setting for prices including or excluding tax; a coupons on/off switch and the pricer's discount step, with coupon creation in Phase 2. **This supersedes decision 15 and §3.2 where they say price lists are never multipliers, decision 14 as the only deposit rule, decision 16, and §3.3's inclusive flag per tax profile** | §9 |
| 25 | **Stage D, pricing, second round of answers (15 Nov 2026).** (1) Booqable's four pickup-day and return-day rules and weekday skipping are shop settings, off by default; BSR uses none. (2) **A month is date to date, anchored on the original pickup date** (1 Jan to 1 Feb; a month without the date uses its last day: 31 Jan renews 28 Feb, then 31 Mar). (3) The long-stay daily rate, for days after whole months, is a per-product setting until tested. (4) For Phase 3, and the pricer must fit it now: a rental has billed periods (one bike, one date range, one frozen price), each its own order line with a list price, the price charged and an automatic note; several rentals per order, each with its own dates; Extend rental, priced as a continuation (whole months at the monthly price, leftover days at the long-stay rate); Swap bike with owner-chosen pricing options (remainder of the period, prorated difference, no charge, manual amount; credit, refund or no charge for a cheaper bike), as one atomic step. (5) Decided as recommended: the rounding step is a shop setting; a deposit is never taxed, a percentage deposit is of the order total after discounts with tax, per-product deposits are for vehicles only; hourly below a day, capped at the 1-day price; no zero price, and "Free" stays for services and extras; a season-adjusted price keeps its satang. (6) Tax per line on a Thai tax invoice waits for Korn or BSR's accountant. (7) Mark supplies BSR's four lists in full before the last build stage. **This supersedes the over-30-days rule of §3.2 and §3.4, the second version's extra-day amount on a price list, and decision 24 where it has an import keep day 31** | §9.13, §9.17 to §9.19 |
| 26 | **Stage D design approved (15 Nov 2026).** (1) The price list prices every rental of 30 days or fewer; the month rule starts at 31 days; a rental never costs more than the list's price for the same number of days. (2) A product with no long-stay rate uses its monthly price ÷ 30, and leftover days never cost more than one more month. (3) Extend uses today's price to the new end minus today's price to the old end, with "keep the last period's discount" on by default and the amount editable by staff. (4) In a season each charged day belongs to the calendar day it starts on. (5) The rental-period maths goes into stage D as pure functions with tests. (6) Charge rules stay after Phase 3 and before 3M; their worked examples are not confirmed until then. (7) Early return is a Phase 3 swap to nothing, with the same credit, refund and no-charge settings. (8) Tax per line, and credit notes for swap credits and refunds, go to Korn and do not block the maths. (9) Build in small stages, one PR each; no migration until the database stage; nothing to staging or live | §9.13, §9.15, §9.19 |
| 27 | **Tax, from the accountant through Korn (15 Nov 2026). This replaces per-line tax** (the original brief, §3.3, §3.4 and the first three versions of §9.7). (1) VAT is worked out once per invoice, not per line: lines carry only their tax profile or rate and a taxable flag; the pricer groups the taxable amount after discounts by rate and works out one VAT amount per rate, rounded once to the satang; the invoice shows one VAT line per rate. (2) Two shop styles, the existing setting: prices include VAT (VAT = total × rate ÷ (100 + rate), net = total − VAT; ฿3,000 at 7% is ฿196.26 and ฿2,803.74) or VAT added on top (VAT = net × rate, total = net + VAT). (3) Discounts reduce the VAT base. (4) Deposits are never taxed and sit outside the VAT base. (5) Each payment gets its own tax invoice, so each billing event is its own invoice and earlier invoices never change. (6) A swap credit reduces the VAT base of the new invoice: VAT follows the money actually coming in or going out; kept in one function and one paragraph. (7) A credit note is only for a refund; a credit toward the next payment needs none. (8) Per-bike net revenue is a derived figure; reports total from invoices | §9.7, §9.19 |
| 28 | **Stage D3 answers (15 Nov 2026).** (1) The customer's discount ratio is the amount charged ÷ the price before the staff discount (after seasons); the same ratio drives "keep the last period's discount" on Extend and "keep the customer's discount" on a swap. (2) "Keep the customer's discount" does not apply to the prorated-difference swap option, which is the two bikes' list prices × the remaining share of days with nothing scaled. (3) The deposit on a swap stays the same when the two bikes' deposits are equal; when they differ, the difference is shown to staff as a deposit top-up or a deposit release, never charged or returned silently, and the deposit is never part of the swap's VAT base. The swap pricing functions are independent of it | §9.19 |
| 29 | **Database-stage answers (15 Nov 2026).** (1) Booqable multipliers are stored to six decimal places, not four: BSR's four lists need only four, and six leaves room. (2) Pricing methods per product type, enforced as a database check: vehicles by rental length or flat fee; rental gear by rental length, flat fee or fixed; services and extras flat fee, fixed or free; items for sale fixed only. (3) At migration a shop that already has deposits on products is set to "per product"; every other shop starts on "none". (4) One migration with the seven tables, including season rules and the replacement-value field for gear; charge rules, swap settings and the extras table get their own migrations later. (5) The migration is applied locally only until Mark says, and goes to staging at the same time as the merge | §9.2 |

Decisions 9, 12 and 15 include Mark's second round of answers the same day (items for sale by stage, who may mark a unit lost, and the price-per-day mode).

## Summary

1. **One `products` table, renamed from `models`**, with a `type` (vehicle, gear, sale item, service) and a `tracking` mode. Vehicle-only fields stay on it, guarded by checks. The platform has no rows on live, so the rename costs no data work; it does mean re-creating about 15 database functions that name the old table.
2. **Rental gear counted by quantity is stored as real, nameless unit rows.** "20 helmets" is 20 rows in `units`. The existing exclusion constraint, per-unit locks and availability rule then cover gear with no second mechanism, and "track individual units" becomes giving those rows labels. Items for sale are different (they are used up, not lent) and get a stock ledger in stage B; selling them comes with orders in Phase 3. Services have no stock.
3. **Moto Mangos settings move to their own table, `product_listings`**, so a product is created with no marketplace fields and listed later from its tab. The existing instant and request counts become the "units to offer" cap.
4. **Pricing sits in its own table, `product_pricing`, one row per product**: a method plus an amount or a shared price template, a tax profile and a deposit. It is a separate table because mechanics and drivers must not see prices, and row-level security hides rows, not columns. Extras are not a separate table: an extra is a gear or service product linked to a vehicle product. This is laid out now so Phase 2's one pricer (`quote()`) reads it without rework.
5. **PR 13's migration: keep it as it is.** Do not change it in place again; build forward with new migrations. Reasons in §1.6.
6. **The review's five disagreements with the brief are accepted** (§5.4), and every question is answered except one that only the importer needs (§7).

## 1. Database design

### 1.1 Today's tables and where they go

| Today (`platform` schema) | Becomes | Change |
| --- | --- | --- |
| `models` | `products` | Renamed. New `type`, `tracking`. Vehicle-only columns become nullable, required for vehicles by a check. Marketplace columns move out (next row) |
| `models.marketplace_listed`, `instant_units`, `request_units`, `ready_now`, `ready_updated_at` | `product_listings` | Moved to a new table, one row per listed (or once-listed) vehicle product |
| `models.catalog_id`, `make`, `model`, `vehicle_type`, `cc`, `transmission`, `categories` | Stay on `products` | Vehicle description. `catalog_id` stays the link to the one catalog (`public.bike_catalog`) |
| `models.catalog_approved_at`, `catalog_rejected_at`, `catalog_reject_reason` | Stay on `products` | They describe the catalog request on this product. Moving them would mean rewriting the review function for no gain |
| `models.deposit`, `deposit_currency` | `product_pricing.deposit`, `currency` | Moved in stage D with the other prices, so mechanics and drivers can't read it (§3). Until then it stays where it is, readable by every member as today |
| `models.buffer_before_minutes`, `buffer_after_minutes`, `min_age`, `licence_class`, `photos`, `description`, `bookable_online`, `retired_at` | Stay on `products` | Buffers and `retired_at` apply to every type; `min_age` and `licence_class` to vehicles only |
| `units` | `units` | Kept. `model_id` renamed `product_id`. New `product_type` (copied by a composite key), `label`. Vehicle-only columns guarded by a check |
| `unit_financials`, `unit_renewals`, `unit_renewal_costs` | Unchanged | Vehicle records. Tracked gear units may use `unit_financials` too |
| `unit_blocks` | Unchanged | Still the one availability lock, one exclusion constraint. Gains `order_line_id` in Phase 3, as already planned |
| `model_year_bands` | `product_year_bands` | Renamed with its `model_id` column. Vehicles only |
| `audit_events`, `notification_outbox`, locations, tenants, memberships | Unchanged | |
| `public.bike_catalog`, `public.vehicle_types` | Unchanged | Shared with the marketplace. Not touched |
| Extras (spec's `extras` table; never built on the platform) | Not built | Replaced by gear and service products plus `product_extras` (§3.5) |
| Spec's `price_structures` (not built) | `price_templates` + `price_template_days` | Same content (anchors, filled days, hand edits), made shareable between products (§3.2) |

Nothing is dropped outright. Legacy marketplace tables (`bike_models`, `shop_extras`, `price_days` and the rest) stay as they are until 3M; `docs/platform/MAPPING.md` needs its target names updated (§8).

### 1.2 `products`

```text
products
  id, tenant_id                      unique (tenant_id, id) and unique (tenant_id, id, type)
  type        text not null          'vehicle' | 'gear' | 'sale_item' | 'service'   (fixed after creation)
  tracking    text not null          'unit' | 'bulk' | 'consumable' | 'none'
  name, description, photos, categories, retired_at, bookable_online
  buffer_before_minutes, buffer_after_minutes
  -- vehicles only (null for the rest)
  vehicle_type, make, model, cc, transmission, catalog_id,
  catalog_approved_at, catalog_rejected_at, catalog_reject_reason,
  min_age, licence_class
```

Prices are not on this table: see `product_pricing` (§3.1).

| Type | Tracking allowed | Stock lives in |
| --- | --- | --- |
| Vehicle | `unit` only | `units`, one row per vehicle, each with a plate (or plate pending) |
| Rental gear | `bulk` (default) or `unit` | `units`: nameless rows for bulk, labelled rows for tracked |
| Item for sale | `consumable` | `stock_movements` ledger (stage B) |
| Service or extra | `none` | Nothing. Always available while the product is active |

Rules, all as check constraints or the existing guard trigger:

- `type` and `tracking` must be one of the pairs above.
- A vehicle needs its kind (`vehicle_type`). Its `make`, `model`, `cc` and `transmission` are optional (decision 17): the create form asks for a name only, and they are filled in when a motorbike is sent to Moto Mangos (all four required then) or copied from the approved list entry it is put on. A make and a model come together or not at all. Every other type must leave all vehicle-only columns empty. The old rule "a motorbike can't be saved without engine size and transmission" (`models_required_specs_check`) is dropped by the Stage A migration.
- `type` cannot change once the row exists. `tracking` can change only between `bulk` and `unit` on gear (§2.4).
- Names are unique within a shop ignoring case and all spacing (`products_name_idx` on the name with spaces removed and in lower case; it was lower-case and trimmed only). The "no duplicate own make and model" index covers vehicles that have a make and model.
- **No product is preset and names are free text** (decisions 5 and 7). A new shop starts with an empty Products list. A service can be "Full coverage", "Licence help" or "Tax and insurance for your own bike"; an item for sale can be a sticker, a shirt or a hat. Nothing in the database or the code knows what a particular service or item is, so no behaviour hangs on its name.
- `categories` keeps its shape check. The lists stay in code (`apps/platform/lib/vehicle-kinds.ts`, to be renamed). Vehicles keep today's lists, required for motorbikes and cars. Gear gets a short optional list for filtering (helmet, jacket, gloves, camera, phone holder, luggage, lock, other). Services and items for sale get no list at first: each vendor's are too different to guess.
- Retire, restore and delete rules from the fleet rework apply to every type through the same triggers: a product is retired only when none of its units is in use; a retired product takes no new units and comes off Moto Mangos.

**Why one table and not `products` plus a `vehicle_details` side table.** Every guard written so far (`models_guard`, the catalog review, retire rules, the CSV import) reads vehicle fields and the row together. Splitting them means rewriting each one against a join and adds a second audit row to every save. The cost of one table is a dozen nullable columns on helmets and services, which the checks keep empty.

**Why rename the table instead of only changing the screen text.** A table called `models` holding helmets and insurance cover will mislead every later session, and the rename gets harder with every phase that adds a foreign key to it. Live has no platform rows and no code outside `apps/platform` reads these tables (checked: the marketplace has no reference to `platform.models`, `platform.units` or the catalog functions).

### 1.3 `units`

```text
units  (existing columns kept)
  product_id       was model_id
  product_type     new; foreign key (tenant_id, product_id, product_type) → products (tenant_id, id, type)
  label            new; text, for tracked gear ("GoPro 3", a serial number)
```

- The composite key means a unit's `product_type` can never disagree with its product, so plain check constraints can use it. This is the same trick as the tenant keys.
- Check: a vehicle unit keeps today's rule (`plate is not null or plate_pending`). A gear unit has no plate, frame number, engine number, model year or odometer. A tracked gear unit needs a `label`, unique within its product. A bulk unit has neither plate nor label.
- Sale items and services have no unit rows (enforced by the type pair: the foreign key only matches vehicle and gear products).
- `status` (active, maintenance, retired, sold), `location_id`, `qr_token`, the role guard (`units_guard`), the sold and retired rules and `units_clear_downtime` all carry over unchanged. A tracked camera gets a QR sticker for free.
- **New status `lost`** (decision 12), added in stage B. Owners, managers and staff may set it; mechanics may not (they still set maintenance). It takes the unit out of stock at once. Only an owner or manager can bring a lost unit back, retire it or delete it. "Damaged" is the existing `maintenance` status (or a downtime block with an end date), which staff can already set.
- `unit_renewals` is the vehicle's own legally required tax and insurance record (decision 6) and has nothing to do with any product a vendor names "tax and insurance". It stays vehicle-only in the screens. No database rule is needed: a renewal on a helmet would be odd but harmless.

### 1.4 `product_listings` (Moto Mangos)

```text
product_listings
  tenant_id, product_id     primary key (product_id); foreign key (tenant_id, product_id, product_type) → products
  product_type              always 'vehicle' (check), so only vehicles can be listed
  enabled        boolean    the quick on/off switch (today's marketplace_listed)
  instant_units  int        units offered for instant booking
  request_units  int        units offered by request
  lead_time_hours   int     null = none of its own; the shop's minimum notice still applies (§2.6)
  ready_now, ready_updated_at    walk-in count for "Ride today"
  created_at, updated_at
```

- A product with no row has never been listed. "List on Moto Mangos" creates the row; the switch flips `enabled`.
- Existing rules move with the columns: `enabled` only while the product is on an approved catalog entry (`not_listable`) and not retired; `instant_units + request_units` and `ready_now` never exceed the product's active units, and are clamped down when a unit leaves (`units_clamp_model_counts`).
- The two counts stay as they are today (decision 2). The tab shows a simple control on top: "Units to offer" and "All instant / All by request"; "Split them" opens the two numbers.
- Policies: every member reads; only owners and managers write, including the on/off switch (decision 12). Staff may change `ready_now` only (the spec has staff updating the walk-in count from the app; it is a count of bikes standing ready, not the listing switch), enforced by a column guard like `units_guard`.
- The marketplace's `listingId` stays the product's id (`MAPPING.md` §4), so nothing changes for 3M.

### 1.5 New tables at a glance

| Table | Stage | Purpose |
| --- | --- | --- |
| `product_listings` | C | §1.4 |
| `product_pricing` | D (Phase 2) | One row per priced product: method, amount, template, tax profile, deposit. Owners, managers and staff read; mechanics and drivers don't (§3.1) |
| `price_templates`, `price_template_days` | D (Phase 2) | Prices by rental length from anchors, shareable between products (§3.2) |
| `tax_profiles` | D (Phase 2) | Rate and inclusive or exclusive, per shop (§3.3) |
| `product_extras` | D (Phase 2) | Which gear and services are offered with which vehicle product (§3.5) |
| `stock_movements` | B | Ledger for items for sale: stock in and adjustments from stage B, sales from Phase 3 (§2.5) |

Every new table follows the repo rules: `tenant_id` and a parent reference by `(tenant_id, id)`; RLS in the set form `tenant_id = any((select my_tenant_ids()))`, no `using (true)`; an explicit `grant` to `authenticated` in the migration (`default-grants.test.ts`); new functions start with `revoke all ... from public, anon`; amounts are `bigint` minor units with a `currency` column keyed to `tenants (id, currency)`; `set_updated_at` and `audit_row` triggers; a fixture row per tenant in the isolation tests. Columns that record who did something are set in the database from `auth.uid()`, not sent by the client (this closes the open item in PROGRESS, "Before Phase 2").

The currency lock (`tenants_lock_currency`, `currency_locked`) is extended to every new amount: a price, a template tier or a deposit on any product locks the shop's currency.

### 1.6 PR 13's migration (`20261113000100_platform_fleet_rework`): keep, don't reshape

Recommended: leave the file exactly as merged and put every change in new migrations after it.

- Everything in it survives the redesign: categories, the review outcome dates, approved-means-listed, retire and restore, withdrawing a request on delete, clearing downtime on delete. The new migrations rename and move these; they don't undo them.
- It is on `main`, on staging, in CI and in every local database. The file was changed in place four times on its branch, and each time staging had to be taken back by hand. Doing it again from `main` breaks the repo rule ("never edit an applied migration") for every checkout, and buys nothing: a follow-up migration reaches the same end state.
- "Not on live" only means live gets it and the follow-ups in one push. On live it adds columns and triggers to empty tables and replaces functions; it touches nothing the marketplace reads.

### 1.7 Migration order

Each migration is one logical change. All of them act on platform tables that are empty on live.

| # | Migration (name after the timestamp) | What it does | Stage |
| --- | --- | --- | --- |
| 1 | `platform_products` | Rename `models` → `products`, `units.model_id` → `product_id`, `model_year_bands` → `product_year_bands`. Add `type` (existing rows: `vehicle`), `tracking` (`unit`), `units.product_type`, the composite key and the type checks. Rename policies, indexes and triggers to match. Re-create every function that names the old table or column, in the same file | A |
| 2 | `platform_products_stage_b` (`20261113000300`; planned as `platform_gear_units`) | `units.label`, the `lost` status, the per-type unit rules, `set_stock_quantity()`, `mark_units_damaged()` and `mark_units_repaired()` (planned as `set_quantity_out()`), `mark_units_lost()`, `resolve_lost_units()` (§2.3), the product-level advisory lock, `stock_movements` for items for sale; and, added by decision 21, `products.sort_position` with `move_product()` and `reset_product_order()`, and `change_listing_entry()` and `disconnect_listing()` | B |
| 3 | `platform_product_listings` (`20261114000200`) | Create the table, copy the five columns across, drop them from `products`, add `lead_time_hours`, re-point the guards and the review function. As built: §5.10 | C |
| 4 | `platform_product_pricing` | `product_pricing` (the deposit moves into it), `price_templates`, `price_template_days`, `tax_profiles`, `product_extras`, the wider currency lock | D |

Functions to re-create in migration 1 (they hold the old names in their bodies, which Postgres does not rewrite on rename): `models_guard`, `units_guard`, `unit_blocks_guard`, `units_clamp_model_counts`, `models_default_category`, `models_keep_catalog_outcome`, `models_retire_guard`, `units_model_not_retired`, `models_withdraw_request`, `review_catalog_request`, `submit_model_to_catalog`, `catalog_requests`, `import_fleet`, `tenants_lock_currency`, `currency_locked`, and `queue_renewal_notifications` if it reads the model name. The build session must find the full list by searching function bodies in the database (`pg_get_functiondef`), not by reading migrations.

Keeping live safe:

1. **Nothing reaches live before it is on `main`**, and live is pushed by hand with the runbook steps used on 12 Nov: fresh backup, dry run listing exactly the expected files, grants fingerprint (C6) and row counts before and after, the 36 public read queries byte-identical.
2. **Push PR 13's migration and migrations 1 to 3 together**, once stages A to C are merged and clicked through on staging. There is no reason to push earlier: the platform app does not point at live yet. One push means one backup and one check run.
3. **The hourly job is the one thing running on live that reads these tables** (`platform-renewal-notifications`). The rename and the re-created function must be in the same migration file so the job never meets a half-renamed schema. Confirm on the dry-run copy that the job's function runs after the push. (Whether the CLI wraps each file in one transaction should be checked in the dry run, not assumed.)
4. **`public.bike_catalog` and `public.vehicle_types` are not altered.** No column is added to the catalog, so its column grant is unchanged.
5. **Staging holds demo shops with models and units.** Migration 1 must carry them across unchanged; the check is unit and product counts per shop before and after, and the fleet Playwright tests on the migrated data.
6. `rollback.sql` in the runbook covers only the first 21 platform migrations. The way back from a bad push is the backup or a forward fix, as it was for the last four.

## 2. Availability

### 2.1 One rule for vehicles and gear

Availability is always computed from `units` and `unit_blocks`. No count is stored anywhere. The "quantity" a screen shows is `count(units)`.

For a product P at location L and a rental from `start` to `end`:

1. **Window.** Widen the rental by the product's buffers: `[start − buffer_before, end + buffer_after)`. Blocks are stored already widened (review decision: "period incl. buffers"), so the unit is truly busy for the whole stored period.
2. **Stock.** Units of P at L with `status = 'active'`. A unit in maintenance, retired or sold is not stock, for any dates.
3. **Free.** Stock units with no `unit_blocks` row overlapping the window, of any kind (allocation, downtime, hold, transfer).
4. **Shortage demand.** If the shop allows overbooking (spec: off by default), reserved order lines that have fewer unit blocks than their quantity count against the product: subtract the largest such unassigned quantity at any moment in the window.
5. `available = max(0, free − shortage demand)`.

A vehicle and a bulk helmet go through the same five steps. The only difference is on screen: a vehicle's units are listed by plate, a bulk product's units are shown as a number.

### 2.2 Booking and locks

The booking function (Phase 2) for an order with several lines:

1. Take a **product-level advisory lock** for every (product, location) on the order, in sorted order. This is the review decision's "per-location-and-model advisory lock". It makes two people booking the same product queue instead of both picking the same free units.
2. For each line, pick the units: staff's choice for a vehicle if given, else the best-fitting free unit (the one whose previous block ends closest before this rental, which keeps long gaps whole).
3. Insert the blocks in sorted unit order. The existing trigger takes each **per-unit advisory lock** (namespace `1a01`) as the row is written, and the exclusion constraint has the final say.

Lock order, to be written into the root rules: product locks first (sorted), then unit locks (sorted). Downtime writers take a single unit lock and can't form a cycle. One detail for the build: the unit lock key is `hashtext(unit_id)`, so "sorted" must mean sorted by that key, not by the UUID; otherwise two rare hash collisions could still cross. Postgres would detect and cancel such a deadlock, but the rule should be exact.

### 2.3 Gear counted by quantity

- **Setting the quantity** is one function, `set_stock_quantity(product, location, n)`, owners and managers only. Raising it inserts nameless active units. Lowering it removes units that have no block now or in the future; if too few are free it refuses and says how many are booked. This is the same question "retire" asks of a vehicle, so the rule is already familiar.
- **Damaged gear** ("2 helmets being cleaned or repaired until Friday") is downtime blocks on any 2 free nameless units, through `set_quantity_out(product, location, n, until)`. Staff and mechanics may do this, as they may for vehicle downtime today.
- **Lost gear** (decision 12): an owner, manager or staff member (not a mechanic) calls `mark_units_lost(product, location, n)`, which sets `lost` on n free nameless units. The product then reads "18 in stock, 2 lost". An owner or manager later confirms (the units are removed, which is a quantity change) or brings them back. Staff never change the quantity itself.
- **Booking 3 helmets** is 3 allocation blocks on 3 units. Staff never see which rows.
- **Why rows and not a counted pool.** The alternative is a `stock_blocks` table with a quantity per row and a "sum of overlapping quantities ≤ stock" check inside a function. That check can't be an exclusion constraint, so gear would have a second, weaker lock that only holds if every writer goes through the function. With rows, the database itself refuses the 21st helmet. The costs are more rows (60 helmets = 60 rows) and one audit row per unit when the quantity changes; `set_stock_quantity` also writes one summary audit event ("quantity 20 → 25") so the history reads cleanly. A limit of 1,000 bulk units per product per location keeps a typo from creating a million rows.
- **Nameless units can be re-packed.** Because they are interchangeable, the booking function may move not-yet-collected allocations between nameless units when no single unit is free for the whole window but the count says one should be. Build the simple best-fit pick first and add re-packing only if the race and fragmentation tests show a need.

### 2.4 Tracking individual units of gear

Switching a gear product from `bulk` to `unit` asks for a label per existing unit (pre-filled "Helmet 1…20") and from then on staff pick or scan a specific unit at check-out. Blocks, history and quantity are untouched because the rows were always there. Switching back to `bulk` clears the labels; allow it only while no unit has purchase details.

### 2.5 Items for sale and services

- **Services** have no stock: available whenever the product is active.
- **Items for sale** (stickers, shirts, hats: any vendor's own goods) are used up. On-hand is the sum of a `stock_movements` ledger (received, sold, returned, adjusted; append-only, each row with who and when), minus quantities on open orders. They never enter `unit_blocks`.
- **By stage** (decision 9). Stage A: the type check allows `sale_item`; nothing on screen. Stage B: owners and managers create items for sale with a name and a stock count per location; the ledger exists and takes "received" and "adjusted" rows, so the count has a history from the first day. Stage D: a price. Phase 3: order lines, payments and the "sold" and "returned" rows. Until Phase 3 an item for sale can be counted but not sold through the platform.

### 2.6 Moto Mangos: units to offer and lead time

On top of §2.1, for a listed vehicle product:

```text
cap            = instant_units + request_units
mm_held        = most Moto Mangos bookings holding a unit at any moment in the window
offered        = min(available, cap − mm_held)

mode = instant   if offered > 0 and instant-mode Moto Mangos bookings in the window < instant_units
     = request   else if offered > 0 and request-mode ones < request_units
     = none      otherwise
```

- The cap counts **Moto Mangos bookings only** (decision 11). A walk-in or a direct booking uses up real availability (step 3) but not the cap. So "offer 3 of my 8 PCX on Moto Mangos" means at most 3 out through Moto Mangos at once, and fewer when the shop itself is nearly full.
- This is `docs/INTEGRATION.md` §4.4 unchanged (decision 2): the contract already defines the instant and request split. The cap is not a new stored number.
- **Lead time** (decision 13): plain hours from now. The pickup must be at least `max(the location's minimum notice, the listing's lead_time_hours)` after now: whichever is stricter. A listing with no lead time of its own uses the shop's notice. It is a duration, so it needs no time zone and is not counted in opening hours. Opening hours, closures and minimum days (§4.6 of the contract) still apply in the location's time zone, which must not assume a fixed offset. Walk-ins ("Ride today") skip both, as the contract says.
- A product that is retired, not `enabled`, off an approved catalog entry, or (per the contract) without a photo and a full price is never offered.
- The marketplace keeps showing only what `marketplace_api` returns. It never computes availability itself after 3M.

## 3. Pricing

Phase 2 builds the pricer. This section fixes where its inputs live so that work needs no schema change.

### 3.1 `product_pricing`: one row per priced product

```text
product_pricing
  tenant_id, product_id      primary key (product_id); foreign key (tenant_id, product_id) → products
  pricing_method             'per_period' | 'fixed' | 'tiered' | 'free'
  price_amount   bigint      minor units; per period or once
  price_period               'hour' | 'day'
  price_template_id          for 'tiered'
  deposit        bigint      per unit rented; vehicles only for now (§3.3)
  tax_profile_id             null = the shop's default
  currency                   foreign key (tenant_id, currency) → tenants
```

It is a separate table for one reason: **mechanics and drivers see no prices** (decision 12). Row-level security hides rows, not columns, so prices can't sit on `products`, which every member reads. The policies: owners, managers and staff read; owners and managers write. `price_templates`, their days and `tax_profiles` get the same read rule. It is the pattern `unit_financials` already uses for purchase prices. The deposit that sits on `models` today moves here in stage D.

| `pricing_method` | Columns used | Charge for one line |
| --- | --- | --- |
| `per_period` | `price_amount`, `price_period` (`hour` or `day`) | amount × periods × quantity |
| `fixed` | `price_amount` | amount × quantity, once per order |
| `tiered` | `price_template_id` | the template's total for the rental length × quantity |
| `free` | none | 0 (shown on the order as included) |

- Any type can use any method. Typical: vehicle `tiered`; helmet `per_period` by day or `free`; a shirt or a sticker `fixed`; a vendor's "full coverage" `per_period`; licence help `fixed`; a vendor's own flat "Delivery" `fixed`.
- A product with no `product_pricing` row has no price yet: it can be created and stocked but not put on an order or listed.
- Periods: a day is every started 24 hours from pickup (`@mango/core` `rental-days`, contract §4.1). An hour is every started 60 minutes. Days are counted in the location's wall-clock time (review decision).
- The method list is a check constraint, so a later method (for example "percent of the rental", common for damage waivers) is one small migration.

### 3.2 Price templates (tiered by rental length)

Built around decision 15: the owner types anchor prices, the system fills the days between, and every filled-in price stays editable.

```text
price_templates       tenant_id, id, name, currency, shared boolean
price_template_days   tenant_id, template_id, day (1..30), total bigint, source ('anchor' | 'filled' | 'manual')
                      primary key (template_id, day); a complete template has all 30 rows
```

- **Anchors** are the totals for 1, 7, 14, 21 and 30 days: daily, weekly, two weeks, three weeks, monthly. 1 and 30 are required; 7, 14 and 21 are optional, as the spec has it. Each is the total for that many days, not a rate per day.
- **Filling.** Between two neighbouring anchors the days rise in equal steps, each rounded to the shop's rounding step (the currency's default: ฿10 for THB; set per shop, never a constant in code). With no 7, 14 or 21 anchor the fill runs straight between the anchors that exist.
- **Editing.** Any filled day can be overwritten; it becomes `manual` and is kept. Changing an anchor refills only the `filled` days between it and its neighbours and leaves `manual` ones alone. "Reset to filled" turns a manual day back.
- **Never more for fewer days** (review decision): a template is refused on save if any day's total is lower than the day before it. A refill that would break this against a manual day is shown to the owner to resolve, not silently changed.
- **Over 30 days** derives from the 30-day total, as decided: `round(total(30) × days ÷ 30)`.
- **One stored shape.** Every template is the same 30 totals, so `quote()` has one lookup. The spec's second stored mode, "price per day" (change request 41), is dropped (decision 15).
- **"Same price every day" helper.** The owner types one daily price; the helper sets the anchors to that price times 1, 7, 14, 21 and 30, and the fill does the rest. The result is an ordinary template: every anchor and every day stays editable, so a shop can start flat and then lower the weekly and monthly totals by hand.
- **Sharing.** A template can be used by many products ("Scooters 125 cc"). "Own prices" for one product is a template with `shared = false` that only it points to. The Pricing tab offers "Use a shared price list" or "Set this product's own prices"; either way the owner sees the same five anchor boxes and the 30-day grid.
- Changing a shared template changes every product on it. The form names them before saving. Past orders are unaffected because an order stores its quote snapshot (review decision).
- Amounts are **absolute, in minor units**, never multipliers. Whether BSR's Booqable templates are multipliers or fixed amounts only decides how the importer turns them into these rows (decision 16).
- This is the spec's `price_structures` and the legacy `price_days` (`day`, `total`, `is_anchor`, `is_manual`) in one shape; a legacy listing maps to one unshared template at 3M with its flags kept.

### 3.3 Tax profiles and deposits

- `tax_profiles`: `name`, `rate_bp` (basis points, integer: 7% = 700), `inclusive`, `is_default`. One default per shop, created from the tenant's current `vat_rate` and `vat_inclusive`. `product_pricing.tax_profile_id` null means the default. A shop that sells an exempt insurance cover gives that product a 0% profile.
- Tax is computed and stored **per order line** with the rate and inclusive flag copied onto the line, so a later change to a profile never alters an old order.
- **Deposits** (decision 14). `product_pricing.deposit` is the deposit for one vehicle; null means the shop default. The order's deposit is the **sum over every vehicle on it**: two bikes, two deposits; three of the same scooter, three times its deposit. Gear, services and items for sale add nothing to it. Staff can change the order's deposit; the order keeps both the computed and the charged amount, and the change is in the audit trail with who made it. A per-customer waiver (spec) sets it to zero the same way.
- Season and date rules (`price_rules`, Phase 2) point at a scope: one product, one template, one product type, or all. Nothing in this design needs to change for them.

### 3.4 Money and rounding

1. Every amount is `bigint` minor units of the shop's currency, by the ISO 4217 exponent. No floats anywhere; a rate is basis points.
2. All arithmetic is integer. Division happens in three places only, each rounding half up to one minor unit: the over-30-days total, a percentage rule, and tax.
3. The **rounding step** (review decision: a setting with a default per currency) applies to prices a shop generates, such as the filled-in days of a table, not to tax.
4. Tax per line: exclusive `tax = round(net × rate_bp / 10000)`; inclusive `tax = gross − round(gross × 10000 / (10000 + rate_bp))`. Order tax is the sum of line taxes. **Superseded by decision 27:** VAT is worked out once per invoice and rate group (§9.7).
5. The total never falls as days rise (review decision), checked when a template is saved and again in `quote()`.
6. Display uses `Intl.NumberFormat` with the viewer's locale and the shop's currency. No currency symbol in code.

### 3.5 Extras and services on an order

- `product_extras`: `tenant_id`, `product_id` (the vehicle product, or null for "every vehicle"), `extra_product_id` (a gear or service product), `included_quantity`, `max_quantity`, `sort`. This replaces the spec's `extras` table and the legacy `shop_extras` + `shop_extra_models`.
- `included_quantity` covers "2 helmets come with the scooter": the first 2 are free on the line, a third is charged by the helmet's own method. This is better than a `free` method on the helmet itself, which could not charge for the third.
- On an order (Phase 3) every chosen product is its own `order_lines` row: `product_id`, `quantity`, `parent_line_id` (the vehicle line an extra belongs to), its own start and end (an extra defaults to its parent's), and the price, tax and deposit snapshot. A service line has no blocks; a gear line has one block per unit; a sale line writes a stock movement.
- `quote(order)` in `@mango/core` stays the only pricer. It takes plain data: for each line the product's method, amount, period and template tiers, the tax profile, any rules, and the quantity and dates. One database function returns all of that for a list of products, so admin, booking page and `marketplace_api` price the same way.
- The marketplace contract's extras shape (`{kind: "rental", amount}` or `{kind: "time", perDay, per7Days, per30Days}`, contract §3.7) is derived: `fixed` → rental; `per_period` by day → time with the same daily rate; `tiered` → time from the template's 1, 7 and 30-day totals. Hourly extras are not offered on Moto Mangos until the contract has a shape for them.
- **Delivery** (decision 4). The distance fee from the spec (`delivery_bands`: straight-line distance, the first enabled band that covers it) stays for every shop and is a computed fee line on the order, not a product. A shop that wants a flat charge can also create its own service product and call it "Delivery"; it is priced and added like any other service and the system gives it no special meaning. The two don't interact: if a shop uses both, both lines can appear on an order, and that is the shop's choice.

## 4. Screens, permissions and audit

### 4.1 How the screens fit together

| Screen | Address | What it shows |
| --- | --- | --- |
| **Products** | `/[tenant]/products` | Every product, one row each: photo or type icon, name, type, price, stock (units in use / total; "—" for services), Moto Mangos chip and switch (vehicles only). Filters: type, category, status, Moto Mangos state. "+ New product" |
| **New product** | `/[tenant]/products/new` | Headed "Product details". Stage A: the kind ("What kind of product is it?"), the product name on one line, categories, then description, buffers, deposit, minimum age and licence class. No make, model, engine size or transmission and no marketplace fields. From stage B it opens with two choices, Vehicle and General (decision 18, §5.7) |
| **Product page** | `/[tenant]/products/[id]` | Tabs: **Details**, **Units** (vehicle and tracked gear: rows with "+ Add unit"; bulk gear: quantity per location, with "damaged" and "lost" counts), **Pricing**, **Moto Mangos** (vehicles only), **History** |
| **Unit rows** | on the Units tab and in Fleet | Vehicle: plate, status, odometer, location; opens the unit page. Tracked gear: label, status, location |
| **Unit page** | `/[tenant]/fleet/units/[id]` | Unchanged: status, odometer, downtime, tax and insurance, purchase and sale, sticker, delete |
| **Fleet** | `/[tenant]/fleet` | Vehicle units only, for the mechanic: plate, product, status, odometer, service due (Phase 1b), insurance and tax expiry, current or next downtime. Today's grouping, filters and sort carry over |
| **Moto Mangos tab** | on the product page | Not listed: "List on Moto Mangos" → match an approved catalog model ("Did you mean…") or send a new one for review → instant, request and units to offer → lead time. Listed: the same settings plus the switch and the review state. Rejected: the reviewer's note and the two next steps from the fleet rework |

- **Superseded in part by decision 19:** wherever the paragraphs and the table in this section speak of make, model, engine size or transmission on a platform screen, or of "Did you mean" suggestions, read decision 19 instead. The Moto Mangos tab of stage C keeps the order decision 19 gives the panel.
- **No type-ahead (decision 17).** Stage A first shipped one make-and-model field that suggested known models and filled in the details. Mark's click-through removed it: the create form is the kind and a name. The known-models list is used in one place only, the Moto Mangos panel on the product page: it suggests close matches from the product's name ("Did you mean…"), offers the whole approved list to choose from, and otherwise shows the send-for-review form, which asks for make, model, engine size and transmission (required for a motorbike; the make and model start from the name) with the model years and a note. A rejected product's "Edit and send again" opens that same form with what was sent before.
- On the create form this leaves nothing from the fleet rework's two paths: no dropdowns, no "Manually enter", no list picker. The Moto Mangos tip stays for motorbikes and now says the model is chosen or sent for review from the product page.
- Products and Fleet read the same rows. Fleet is `units` joined to `products` where the type is vehicle; Products is `products` with unit counts. A change in one shows in the other at once.
- Old addresses redirect: `/fleet/models/[id]` → `/products/[id]`, `/fleet/models/new` → `/products/new`, `/fleet/units/new?model=` → the product's Units tab. Printed QR stickers are unaffected (they hold a token, not a path).
- CSV import stays on Fleet for vehicles; a `type` column and a gear and services import can follow with the Booqable importer (Phase 10).
- Wording: "product" everywhere; "vehicle" only for a vehicle unit and the Fleet screen; "unit" for a tracked piece of gear. In Thai, "product" is สินค้า (decision 8), provisional: every new Thai line goes in a review list for Korn or BSR's admin, like `docs/platform/thai-review-fleet-rework.md`, and one find-and-replace changes the word if they pick another.

### 4.2 Permissions

| Action | Owner | Manager | Staff | Mechanic | Driver |
| --- | --- | --- | --- | --- | --- |
| See Products list and product pages | Yes | Yes | Yes | Read only | Read only |
| See Fleet | Yes | Yes | Yes | Yes (their home) | Read only |
| Create, edit, retire, restore, delete a product | Yes | Yes | No | No | No |
| Add or remove units; change gear quantity; switch tracking | Yes | Yes | No | No | No |
| Unit status active ↔ maintenance, odometer, downtime | Yes | Yes | Yes | Yes | No |
| Gear: mark in repair, back in use, edit a repair's line (§5.9) | Yes | Yes | Yes | Yes | No |
| Mark a unit or gear lost; edit a lost unit's line | Yes | Yes | Yes | No | No |
| Mark a lost unit found, back in use | Yes | Yes | No | No | No |
| Write off gear for good, as damaged or as lost (§5.9) | Yes | Yes | No | No | No |
| Tax and insurance records: add and edit / delete | Yes / Yes | Yes / Yes | Yes / No | Yes / No | No |
| Purchase, sale and renewal costs | Yes | Yes | Hidden | Hidden | Hidden |
| Prices, templates, tax profiles, deposits: see / change | Yes / Yes | Yes / Yes | See | Hidden | Hidden |
| Moto Mangos: list, settings, on/off switch | Yes | Yes | No | No | No |
| Walk-in "ready now" count | Yes | Yes | Yes | No | No |
| History tab (audit) | Yes | Yes | No | No | No |

This is today's split carried over (owners and managers set up; staff and mechanics work on units) with Mark's rulings (decision 12): only owners and managers switch Moto Mangos or change a gear quantity; owners, managers and staff may mark a unit lost, mechanics may not; staff see prices but can't change them; mechanics and drivers see no prices.

Each row is enforced in the database by RLS and the guard triggers, and repeated in `lib/roles.ts` for the menus. "Hidden" means the database returns no row to that role, not that the screen leaves a column out: for a mechanic the Products list has no price column and the product page has no Pricing tab. The isolation tests cover each role limit. Until stage D moves it, the one price that exists today (the deposit on a model) stays readable by every member.

### 4.3 Audit: who changed what

- Every table above gets the `audit_row` trigger, so each insert, update and delete is recorded with the signed-in person, the time, and before and after values of the changed columns only.
- Named events through `platform_private.audit()` for actions that are more than one row: `stock_adjust` (quantity from → to, location), `tracking_change`, `listing_on` / `listing_off`, `template_change` (with the products affected), plus the existing `import`, `approve`, `merge`, `reject`, `clamp_booking_counts`.
- The **History tab** on a product and on a unit page is the first screen that shows this to the shop: a dated list reading "Mark changed the price from … to …", built from `audit_events` for that product, its units, its listing and its template. Owners and managers only, as the table's RLS already says. Per-unit rows from a quantity change are folded under their summary event.
- Price history does not need to explain old orders: each order keeps its quote snapshot.
- No personal data enters these snapshots (products hold none), so the Phase 4 rule on audit snapshots is not affected.

## 5. Build order, risks and tests

### 5.1 Stages

| Stage | Scope | Migrations | Main risks |
| --- | --- | --- | --- |
| **A. Products core** | Rename; four types in the schema; Products list; create page with the one type-ahead; product page with Details, Units and History tabs; Fleet becomes the vehicle-units view; redirects; wording (สินค้า). Only vehicles on screen, and they behave exactly as today | 1 | The rename touches about 40 app files, every fleet test and the Playwright flows. A missed function body fails only when called, so the function list must come from the database. Thai wording |
| **B. Gear and services** | Bulk gear with quantity per location, damaged and lost; tracked gear with labels; services as products without stock; one product per size; items for sale with a name and a stock count (no price, no selling yet) | 2 | Quantity changes racing with downtime or (later) bookings; audit noise from many unit rows |
| **C. Moto Mangos tab** | `product_listings`; the tab; the switch in the list; units to offer and lead time stored and validated. Still no effect on the marketplace until 3M | 3 | Moving columns the review function writes; keeping "approved means listed" and the clamp working |
| **D. Pricing fields** (opens Phase 2) | Method, amount, period; templates; tax profiles; deposit; `product_extras`; Pricing tab; price column in the list | 4 | Getting a shape Phase 2 then has to change. Mitigated by settling §5.3 first |
| **Phase 2 proper** | `quote()`, the availability function (§2), the booking function with both lock levels, `price_rules`, coupons | Phase 2's own | As the spec says: where bugs cost real money |
| **Phase 3** | Orders and order lines as in §3.5; selling items for sale ("sold" and "returned" stock rows); `unit_blocks.order_line_id` | Phase 3's own | |

A, B and C are independent of pricing and can each be a PR. Stage A should merge alone first: it is the one with a wide, mechanical diff, and reviewing it mixed with new behaviour would hide mistakes. Push to live once, after C (§1.7).

### 5.2 Test plan

**Database (Vitest against local Supabase, in CI's RLS job)**

- Isolation harness: every new or renamed table has a fixture row per tenant and passes cross-tenant read, insert, update and delete; role limits from §4.2 (a mechanic can't change a product, staff can change only `ready_now` on a listing, nobody but owner and manager reads the History).
- `default-grants.test.ts` passes: every new table granted on purpose; no new function executable by everyone.
- Type rules: a service or sale item takes no unit; a gear unit takes no plate; a vehicle needs its specs; a tracked unit needs a unique label; `type` can't change; only a vehicle on an approved entry can be listed.
- Fleet rework rules re-run after the rename (`fleet-rework.test.ts`, `review-fixes.test.ts`, `recheck-followups.test.ts` unchanged in what they assert): categories, retire and restore, withdraw on delete, clamp, reject and resubmit.
- Quantity: raise and lower; lowering refused when units are blocked; n units marked damaged, then lost, by staff; staff refused a quantity change and refused bringing a lost unit back; switching bulk ↔ tracked keeps blocks.
- Prices: a mechanic and a driver read no row of `product_pricing`, `price_templates`, `price_template_days` or `tax_profiles`; staff read and can't write. Template fill: anchors only at 1 and 30; all five; a manual day survives an anchor change; a falling total is refused; a zero-decimal currency.
- Lead time: the stricter of shop notice and listing lead time, both ways round; a listing with none.
- Races, in the style of the existing twelve-writer test: twelve writers for the last helmet (one success, eleven clean refusals); two orders each wanting 2 of the same 3 helmets (no deadlock, one succeeds or both get a clear refusal); lowering the quantity while a unit is being blocked; listing switched on while the product is being retired.
- Migration test: build a database at PR 13's state with seeded shops, apply the new migrations, and compare product and unit counts, listing settings and categories per shop.

**Unit (`@mango/core` and `apps/platform/lib`)**

- Availability with bulk units, buffers, shortage demand, and the Moto Mangos cap and mode against the contract's §4.3–4.4 examples; one tenant in a daylight-saving time zone.
- Each pricing method; template monotonic check; tax inclusive and exclusive; a zero-decimal currency (JPY) and a two-decimal one; rounding half up at each of the three division points.
- Type and category lists, labels in both languages, list filters, the permission helpers.

**Playwright (375 px and 1280 px)**

- Create one product of each type; the Products list filters and the Moto Mangos switch; the product tabs; add a vehicle unit from the Units tab; set a helmet quantity; as staff, mark 2 damaged and 1 lost.
- Fleet as a mechanic (lands there, can't open pricing or create a product); a driver reads only.
- The Moto Mangos tab from "not listed" through match, send for review, approve (in `/admin/catalog`), switch off and on; the rejected flow.
- Old addresses redirect; the History tab shows who changed a price.

**Before the live push:** the runbook's dry run on a copy of live (36 public queries byte-identical, grants fingerprint unchanged, row counts unchanged, the hourly job's function runs).

**Not truly testable now:** anything that needs an order (blocks from bookings, the cap against real Moto Mangos bookings, selling an item for sale). Those tests are written with Phases 2 and 3; stage tests use hand-made blocks, as Phase 1a did for "selling a unit with future bookings".

### 5.3 Decide before Phase 2

1. **Pool or assigned units.** The marketplace contract (§4.3) says bikes are a pool and `freeUnits = quantity − busiest moment`. The review decision gives every reserved booking a real unit at once. With assigned units, a product can have one free at every moment and still no single unit free for the whole rental. The availability function must report what the booking function can deliver. Options: accept the stricter answer, or re-pack not-yet-collected allocations automatically (safe for bulk gear; for vehicles it moves a customer to another plate before pickup, which is normally fine).
2. **Buffers between two rentals.** With blocks stored widened and requests widened too, the gap between rental A and rental B is A's "after" plus B's "before". Confirm that is intended, with a worked example in the spec.
3. **Tax rounding per line or per order**, to match the Thai tax invoice (ask Korn with the open invoice-format question).
4. **Hourly products on a daily order**: each line by its own period unit (recommended), with worked examples.
5. **Overbooking per product.** The spec has one shop-wide switch; Booqable has "allow shortage" with a limit per product. Recommended: shop-wide in Phase 3, a per-product override later; the design in §2.1 step 4 supports both.
6. **Which category Moto Mangos files a multi-category motorbike under** (open in PROGRESS already).
7. **Extras on Moto Mangos need stock.** The contract's `extras[]` has no availability. When helmets are counted, checkout must not sell a fourth helmet when three are left: a contract addition for 3M.

Settled on 13 Nov and no longer open: how deposits combine (sum per vehicle, staff can adjust), template amounts (absolute, from anchors), lead time (plain hours, the stricter of the two), the "price per day" mode (dropped; a fill helper instead).

### 5.4 The approved brief: what looked wrong or risky, and how it was settled

Mark accepted all five disagreements on 13 Nov 2026.

| # | The review said | Settled as |
| --- | --- | --- |
| 1 | "Instant vs request" as one choice loses today's split and changes the marketplace contract | Keep the two counts; a simple control on top (decision 2) |
| 2 | Dropping the catalog from the create form costs typing and invites typos | First settled as one type-ahead (decision 3), then overruled after the click-through: the create form has no catalog at all, and the details are asked for when a motorbike is sent to Moto Mangos (decision 17). The typo risk is now carried by the review step |
| 3 | Delivery as a priced service collides with the distance fee | The distance fee stays for every shop; a shop may add its own flat "Delivery" service; nothing preset (decision 4) |
| 4 | "Tax and insurance" as a service name clashes with the vehicle's own record | No preset products at all, and names are free text. The unit's record is the legal one; a product by that name is the vendor's own add-on (decisions 5 and 6) |
| 5 | Items for sale need orders | In the database from stage A; name and stock from stage B; price in stage D; selling in Phase 3 (decision 9) |

Still worth keeping in view:

1. **A third rework of the same screens before any booking exists.** Stages A to C are worthwhile because Phase 2 builds on products, but they delay Phase 2. Keeping A mechanical and B and C small matters more than polish here.
2. **"Product" for a rental vehicle** may read as "something for sale" to staff. สินค้า leans the same way in Thai, which is why it is provisional.
3. **Shared templates** make one edit reprice many products. Safe with the confirmation in §3.2, risky without it.
4. **Only vehicles can be listed**, and Moto Mangos lists motorbikes only today. The tab should say so for a car or boat instead of offering a flow that ends in "not yet".
5. **A flat "Delivery" product and the distance fee on one order** double-charge if a shop switches on both without meaning to. The order editor should make both lines plain to see; nothing more.
6. **One product per size** means a renter can't be asked "which size?" on one helmet line; staff pick the right product. Fine for the pilot, and the reason variations come after it.

### 5.5 Missing from the brief

| Topic | Booqable has it | Recommendation |
| --- | --- | --- |
| **Variations** (helmet S / M / L, jacket sizes) | Yes | Decided: one product per size, each with its own quantity, until after the pilot; then real variations (decision 10). A `variant_of` link can be added then without reshaping. The spec's feature table still says "variations: match" |
| **Bundles** | Yes | Removed by change request 15. `product_extras` with an included quantity covers the common case (bike + 2 helmets). Keep removed |
| **Collections** | Yes | Removed by change request 16. Categories and the type filter cover it |
| **Per-product buffers** | Yes | Already stored (`buffer_before_minutes`, `buffer_after_minutes`); unused until Phase 2. They apply to gear too (helmet cleaning time) |
| **Allow shortage** | Yes, per product with a limit | Shop-wide switch in Phase 3 as the spec says; per-product later (§5.3) |
| **Replacement value** of gear (what a lost helmet costs the customer) | Yes | Add a `replacement_price` to `product_pricing` in stage D; used by damage charges in Phase 5 and when staff mark gear lost on an order |
| **Quantity limits per order** | Partly | `product_extras.max_quantity` covers extras |
| **SKU or barcode** for sale items | Yes | A free-text `sku` column with stage B |
| **Stock per location and transfers** | Add-on | Units already carry a location; transfers are a `unit_blocks` kind. Multi-location is Phase 11 |
| **Photos** for every type | Yes | The `photos` column exists; upload arrives with Phase 3 as already planned |
| **Lost or damaged gear** | Yes | Decided: staff mark it (decision 12). `lost` status and downtime, §1.3 and §2.3 |
| **Minimum rental length or minimum charge per product** | Yes | Phase 2 decision; a column pair on `product_pricing` if wanted |
| **Booqable importer mapping** | — | Booqable's product types (rental, consumable, service) and tracking (trackable, bulk, none) map one-to-one onto `type` and `tracking`, which is a good sign for Phase 10 |

### 5.6 Stage A in detail

Stage A is the rename and the new screens for vehicles only. No new behaviour: a shop can do exactly what it can do today, under new names and in a new layout.

**What it touches**

| Area | Size today | Change |
| --- | --- | --- |
| Migration | 1 new file | Migration 1 of §1.7: the renames, `type`, `tracking`, `units.product_type` and its composite key, the type checks (all four types allowed), about 15 functions re-created. No table created, so no new grants |
| `packages/db` | generated types | Regenerated (`models` → `products`) |
| `apps/platform/app/[tenant]/fleet/**` | 22 files, about 4,500 lines | Split: product screens move to `/products` (list, new, `[id]` with Details, Units, History tabs); Fleet keeps the vehicle-unit list, unit page, stickers and import. Redirects from the old addresses |
| Create form | part of the above | The linked dropdowns, "Manually enter" and the separate list picker are gone. First replaced by one type-ahead; after the click-through, by the kind and one name line (decision 17) |
| `apps/platform/lib` | 12 of 29 files name models | Renamed types and queries (`fleet-data`, `fleet`, `fleet-view`, `fleet-import`, `model-options`, `catalog-match`, `vehicle-kinds`, `dashboard`, `roles`); a new products-list view beside the fleet view |
| Menu and roles | `lib/roles.ts`, the shell | "Products" joins "Fleet" in the menu; mechanics still land on Maintenance and see Fleet |
| Messages | `en.json` and `th.json`, about 130 lines in each mention model, vehicle or inventory | Reworded to "product"; Thai with สินค้า and a review list for Korn |
| Tests | 153 database, 15 fleet Playwright, about 70 unit tests touch these tables or screens | Updated for the new names and routes; new ones below |
| Seeds | `supabase/seed.sql`, `apps/platform/scripts/seed.mts`, demo data | Table and column names |
| Docs | `PROGRESS.md`, `MAPPING.md` target names | `SPEC.md` stays the owner's |

Not in stage A: gear, services, quantities, the `lost` status (B); `product_listings` and the Moto Mangos tab (C; in A the existing Moto Mangos panel sits on the product's Details tab unchanged); prices (D). Nothing in `apps/marketplace`. Nothing on live or staging until asked.

**How long.** An estimate, not a measurement: two to three working sessions, about a day and a half to two days including the owner's click-through and one round of fixes. The migration with its function re-creations and the database tests are roughly a third; the screens and the type-ahead a third; wording, Playwright and the History tab a third. The fleet rework, a smaller change, took five rounds over a day and a half, most of them wording and layout after click-throughs; the same is likely here.

**What would be tested**

1. *Nothing broke.* Every existing database test passes with only names changed (categories, retire and restore, withdraw on delete, clamp, review approve, merge and reject, sold units, the twelve-writer race, tenant isolation, default grants). Any test that needs its assertion changed, not just a name, is listed in the PR.
2. *The migration carries data.* A database built at today's `main` with the three demo shops (including the 150-bike one) is migrated; products, units, categories, listing switches, year bands and audit rows are counted per shop before and after.
3. *Every re-created function runs*: one call each, including the hourly reminder queue and the CSV import, so a body still naming `models` can't hide until someone clicks it.
4. *New rules*: `type` can't change; only the four type and tracking pairs are accepted; a unit's `product_type` always matches its product; a vehicle still needs its specs.
5. *Type-ahead* (unit and Playwright): a known model fills the four fields; an unknown one saves as the shop's own after asking for what is missing; a motorbike without engine size or transmission is refused; an exact duplicate of a known model is pointed at it; keyboard-only use and a 375 px screen.
6. *Screens* (Playwright, 375 px and 1280 px): Products list with filters; create a vehicle product; add a unit from the Units tab; Fleet shows the same unit; old addresses redirect; a mechanic sees Fleet and can't create a product; History shows who renamed a product; the existing Moto Mangos send-for-review flow still works from the product page.
7. *Wording*: English and Thai key parity; no "make & model" or "inventory" left in the product screens.
8. `npm run typecheck && npm run lint && npm test` from the root, and CI's RLS and Playwright job.

Not testable in stage A: anything with a non-vehicle product on screen (stage B), and the live push (done once, after stage C, by the runbook).

### 5.7 Stage B: general products (built 13 Nov 2026, PR 17)

Mark's direction (decision 18), confirmed point by point on 13 Nov 2026 (decision 21) and built on `platform/products-stage-b`. The plan as it was written follows; "As built" after it says where the build differs.

**What the owner sees**

- **New product opens with two choices: Vehicle and General.** Vehicle is today's form: kind chips, name, categories, description, buffers, deposit, minimum age, licence class. General asks for a type (Rental gear, Item for sale, Service or extra), a name and a description; no licence class, minimum age or buffers; and a quantity per location for gear (default: counted; "track individual units" as an option) and for items for sale. A service has no quantity.
- **The Products list gets three tabs: All, Vehicles, General.** General rows show the type and the stock ("18 in stock, 2 lost", "—" for a service) in place of vehicle facts. The kind and Moto Mangos filters apply to Vehicles only.
- **A general product's page** has Details, Stock (gear and items for sale) and History. Stock: the quantity per location with "Change quantity" (owners and managers), "Mark damaged" and "Mark lost" (owners, managers and staff; not mechanics), and, for tracked gear, one row per unit with its label. No Moto Mangos panel and no year bands.
- One product per size (Helmet S, M, L), no prices and no selling yet, as decided.

**What it touches**

| Area | Change |
| --- | --- |
| Migration (one new file, `platform_gear_units`) | `units.label`; unit status `lost` with who may set it; per-type unit checks (a gear unit has no plate or odometer; a tracked one needs a label unique in its product; a bulk one has neither); `set_stock_quantity()`, `set_quantity_out()`, `mark_units_lost()`; the product-and-location advisory lock; `stock_movements` for items for sale (received and adjusted rows; sold rows come with orders) with RLS, grants and a fixture row per tenant. The Stage A migration is not touched |
| Decision to confirm | The brief says "no buffers" on a general product. The design had buffers apply to gear too (cleaning time between rentals). Stage B would hide them and store none; they can return with Phase 2 if wanted |
| Screens | The two-choice start of New product and the General form; list tabs; the general product page with its Stock tab; quantity, damaged and lost dialogs; tracked-gear unit rows. Fleet stays vehicles only |
| App code | Product readers stop assuming a vehicle (`getFleet` and `getModel` filter to vehicles today); a products reader for every type; stock counts from unit rows and the ledger; role helpers for "may mark lost" |
| Wording | New English and Thai texts for the types, stock and dialogs, on the Thai review list |
| Tests | Below |

**Estimate.** Two to three working sessions, about two days with a click-through and one round of fixes. It is new behaviour, not a rename, so more of the time goes to the database functions and their race tests than in Stage A.

**Tests**

1. Database: type rules for units (no plate on gear, label rules, no units on a service or an item for sale); quantity up and down, with a refusal when units are blocked; damaged and lost by role (staff yes, mechanic no for lost; nobody but owners and managers changes a quantity or brings a lost unit back); switching counted and tracked keeps blocks; the stock ledger is append-only and sums to the count; isolation and default-grants for the new table; twelve writers lowering a quantity while units are being blocked.
2. Unit: list tabs and filters, stock wording, the General form's rules, key parity.
3. Browser, phone and desktop: create one of each general type; the three list tabs; set a helmet quantity, mark 2 damaged and 1 lost as staff, confirm the loss as owner; a tracked camera with labels; a mechanic can't mark lost; vehicles behave exactly as before (the Stage A suite unchanged).
4. The Stage A demo data carried again, counts before and after.

**As built** (migration `20261113000300_platform_products_stage_b`; the Stage A migration is untouched)

- **Unit rules per type.** A vehicle unit keeps its rule (a plate, or "plate pending") as the check `units_check`, now for vehicles only, and takes no label. The gear half (no plate, plate pending, frame or engine number, year or odometer) is a trigger, `units_gear_fields`, not a check: it runs after the row's foreign keys, so a unit that claims a type its product doesn't have is still refused by the key first, which Stage A's tests assert. A label is optional, unique in its product ignoring case and spacing (`units_label_idx`), and only on a product tracked unit by unit (`units_label_guard`). Switching gear back to counted clears its labels and is refused while a unit has purchase details.
- **Lost.** `units_guard` is re-created with the status: staff may set it from active or maintenance; a mechanic or driver is refused (`role_not_allowed`); every way out of lost is for owners and managers. A unit can't be marked lost while a booking, hold or transfer on it has not ended; its downtime ends at that moment. `unit_blocks_guard` is re-created so a lost unit takes no new block. The status is in the database for every unit; **the screens offer it for gear only in this stage** (a vehicle's status control is unchanged).
- **A general product stores no buffers and no deposit** (`products_general_fields_check`).
- **Stock functions**, all run as the caller, so RLS and the guards stay the real rule: `set_stock_quantity(product, location, n)` (owners and managers; gear up to 1,000 in one place, an item for sale up to 100,000); `mark_units_damaged(product, location, n, until)` and `mark_units_repaired(product, location, n)` (owners, managers, staff and mechanics); `mark_units_lost(product, location, n)` (owners, managers, staff); `resolve_lost_units(product, location, n, 'restore' | 'remove')` (owners and managers); `create_general_product(...)` (the product and its first quantities in one transaction); `product_stock(tenant)` (counts per product and location, so a shop with 600 helmets doesn't send 600 rows to the screen). Each writes one named audit event on the product (`stock_adjust`, `units_damaged`, `units_repaired`, `units_lost`, `lost_restored`, `lost_removed`).
- **Lowering a quantity** removes only units that no block holds now or later, unlabelled ones first. With too few free it refuses (`units_blocked`) and names the lowest quantity that could be set. A unit with bookings on record is retired, not deleted, so its history stays (nothing has bookings until Phase 3; tested with a hand-made block).
- **Locks.** Product-and-location locks first (advisory namespace `1a02`, sorted by key), then the per-unit locks (`1a01`, the one `unit_blocks_guard` takes, sorted by key): `lock_product_stock()` and `lock_units()`. Every stock function takes them in that order. The manual order has its own lock per shop (`1a03`).
- **Items for sale: `stock_movements`.** Signed quantities; `received`, `adjusted`, and from Phase 3 `sold` and `returned`. Members read; owners and managers add `received` and `adjusted`; nobody updates or deletes (no grant, no policy). Who did it is set in the database from `auth.uid()`. What is on hand can't go below zero. An item for sale with stock on hand can't be deleted (`product_has_stock`); at zero it goes, and its ledger with it.
- **Screens.** As decision 21. Counted gear has "Change quantity", "Mark damaged" (with an optional "back in use on"), "Back in use", "Mark lost" and, for lost units, "Found, back in use" and "Write off" (decision 22; first built as "Back in stock" and "Remove for good"). Tracked gear has "Change quantity" and one line per unit with its label and the same actions as buttons on the line. An item for sale has its count on hand and its stock history. A service has Details and History only.

**The Stock tab's three states** (decision 22, 14 Nov 2026; wording and layout only, no database change)

| State | What it means | Actions | Who |
| --- | --- | --- | --- |
| **In use** | Available to rent | "Mark damaged" (with an optional "back in use on") | Owner, manager, staff, mechanic |
| | | "Mark lost" | Owner, manager, staff |
| **Damaged** | Not available to rent; still counted in stock | "Back in use": it returns to the available count | Owner, manager, staff, mechanic |
| | | "Mark lost" (tracked gear: on the unit's line; counted gear: "Mark lost" takes a damaged unit when no other is free) | Owner, manager, staff |
| **Lost** | Not available to rent; not counted in stock | "Found, back in use": restores it | Owner, manager |
| | | "Write off": removes it permanently, after a confirmation | Owner, manager |

- "Change quantity" (owners and managers) sits above the three states: it adds units in use, or removes units in use that are free.
- Each state is a headed part of the Stock tab with its count ("Damaged (2)") and one line of help. Damaged and Lost appear once something is in them. Counted gear asks "how many" under each heading; tracked gear lists its units under the heading of the state each is in.
- "Write off" asks: "Write off? This cannot be undone. The unit leaves this product's stock counts for good and can't be marked found again. The History keeps a record."
- **History in the buttons' words.** Counted gear: "marked 2 damaged", "put 2 back in use", "marked 1 lost", "marked 1 found, back in use", "wrote off 1". Tracked gear, one line per unit: "marked unit GoPro 3 damaged", "put unit GoPro 3 back in use", "marked unit GoPro 3 lost", "marked unit GoPro 3 found, back in use", "wrote off unit GoPro 3". A written-off unit's row is deleted, but its lines stay in History with its label: they are read from the audit trail by the product the unit belonged to (`lib/history.ts` `gearUnitHistory`), not from the unit rows that are left.
- The database is as it was. The functions keep their names (`resolve_lost_units(..., 'restore' | 'remove')`) and the audit actions theirs (`lost_restored`, `lost_removed`); only the words on screen changed.

**Moto Mangos: "Change model" and "Disconnect"** (decision 21)

- Shown on the panel of a product that is on an approved list entry; owners and managers only (the panel itself is theirs). "Change model" opens the same Make, then Model dropdowns with a Select button; "Disconnect" asks first.
- `change_listing_entry(product, entry)` moves the product to another approved entry; the listing switch and its quantities stay. `disconnect_listing(product)` switches the listing off, sets its quantities to zero and clears the entry with the make, model, engine size and transmission copied from it. It is refused while a request for the product is still waiting for review. Each writes a named audit event (`listing_change_model`, `listing_disconnect`) beside the row's own, and both show in the product's History.
- **Existing bookings made through Moto Mangos: left exactly as they are.** Neither function touches a unit or a block, so every booked vehicle stays booked for its dates and stays in the fleet. Each answers with the number of bookings on the product's vehicles that have not ended; the panel shows that number above the two actions, and the confirmation says "Bookings already made stay as they are." The other choice, refusing while bookings exist, would leave a shop unable to come off Moto Mangos for as long as one booking was outstanding. Tested with hand-made booking blocks (orders arrive in Phase 3). **For Phase 3:** an order must keep its own copy of what the customer booked (the list entry's make, model and years), because the product may point at another entry, or none, by pickup day.

**Manual order, step one** (decision 21)

- `products.sort_position`, per shop. No position on any product means A to Z (the default). `move_product(product, target, 'before' | 'after', current_order)` puts one product just before or after another of the same shop; `reset_product_order(tenant)` clears every position. Owners and managers only; everyone else reads the saved order.
- A shop still on A to Z has nothing saved to move within, so the first move saves the order on screen (the server works it out; the browser doesn't send it) with the one change. From then on a new product goes to the bottom (`products_sort_bottom`).
- Fleet and the Products list read the one order; general products take part in it. On Fleet, which shows vehicles only, "Move up" puts a product before the line above it, passing over any general product that sits between them.
- "Move up" and "Move down" are plain buttons on each line (44 px), "Reset to A–Z" sits above the list while the shop has its own order, and all three are gone while a search or filter is on (a line says why). The All, Vehicles and General tabs count as views, like Fleet, not as filters.
- `move_product` already takes "before or after any product", which is what a drop needs: dragging (§5.8) adds no database work.


**Superseded in part (14 Nov 2026):** the Stock tab's damaged and lost forms described above were replaced by the stock rework, §5.9. Items for sale, the manual order and the Moto Mangos functions are as built here.

### 5.8 Dragging to reorder (built 14 Nov 2026)

Built on `platform/drag-reorder` after Mark approved the library (14 Nov 2026). The proposal from PR 17 follows "As built"; where the two differ, "As built" is right.

**As built**

- **Library:** `@dnd-kit/core` 6.3.1 and `@dnd-kit/sortable` 10.0.0, pinned to those exact versions in `apps/platform/package.json`. They bring `@dnd-kit/utilities` 3.2.2, `@dnd-kit/accessibility` 3.1.1 and `tslib`; nothing else was added (the "up and down only" rule is four lines of our own, not `@dnd-kit/modifiers`).
- **React 19.3:** confirmed by building and running, not by the declared range. Before it went into the repo: a throwaway project on React and React DOM 19.3.0, drawn on a server and hydrated in strict mode, then driven in Chrome with a mouse, touch events and the keyboard: every drag worked, with no error, warning or hydration mismatch in the console. Then the real thing: `next build` and the browser tests below. One thing needed care: `DndContext` gets a fixed `id` (React's `useId`), because the library's own counter differs between server and browser.
- **Where the handle is:** in reorder mode only, last in the row's last column, after Move up and Move down, at the row's outside (right) edge (`DragHandle` in `components/fleet/drag-handle.tsx`, placed by `MoveButtons`). It was before the arrows at first; Mark's phone test (15 Nov 2026) moved it to the edge, where a thumb reaches it. A grip icon 16 px to see, 44 px to hold, in the arrows' quiet grey. The proposal said "at its start".
- **Only the handle drags.** Mouse: press the handle and move 8 px; a plain click does nothing. Touch: hold a quarter of a second (250 ms, 5 px tolerance), then drag; a quick tap does nothing; a finger that moves sooner scrolls the page, because the handle keeps `touch-action: manipulation` and never blocks scrolling before a drag starts. Keyboard: Space to pick up, arrows to move, Space to drop, Escape to cancel (Enter also picks up and drops: the library's default, left on).
- **Screen readers:** the handle is named "Drag to move: <product>" and described by one sentence of instructions; picking up, each move, the drop and a cancel are announced with the product's name and "position N of M", in English and Thai (`Lists.drag.*`). "Picked up" is not talked over by the first "position" line.
- **Rows move up and down only**, and the row being dragged lifts on its own background with a shadow.
- **Fleet groups** drag as one block: in reorder mode a product's line is shut (PR 19), so the line is the group.
- **Saving:** a drop calls the same server action as the arrows (`moveProduct`, then `move_product` in the database), with "after" the row it was dropped on when dragged down and "before" it when dragged up (`dropTarget` in `lib/general-products.ts`). So Fleet and the Products list keep their one order, general products take part, and on Fleet a drop passes over a general product that sits between two vehicles, as the arrows do. No migration. The list shows the new order at once (React's `useOptimistic`) and goes back to the saved order if the save is refused.
- **Move up and Move down stay**, for anyone who prefers them and for a browser without JavaScript. The rows are drawn on the server, so the arrows work before the library has arrived.
- **Loading:** the library is in its own file (`components/fleet/drag-rows.tsx`, loaded with `next/dynamic` from `drag-reorder.tsx`): 47.8 kB minified, 15.9 kB gzipped (14.4 kB with Brotli), measured from this build. It is fetched only when a list is in reorder mode, which only owners and managers can reach; Fleet and the Products list as they normally are, every other page, and staff do not fetch it. A browser test reads every script each page fetched to check this.
- **A phone's row in reorder mode:** the handle and two arrows take 132 px, which cut names to "Yamaha …". So at phone width, in reorder mode only, the Moto Mangos mango is hidden and its column goes to the name. Desktop keeps the mango.
- **Tests:** `lib/drag-order.test.ts` (where a drop goes; that the saved order is the order shown, for every possible drop, with and without hidden general products; that one row up or down is what the arrows do; the wording in both languages). `e2e/drag-reorder.spec.ts` at 375 px and 1280 px, on both lists: mouse, simulated touch and keyboard drags, a click and a tap that do nothing, a swipe from the handle that scrolls, Escape, the announcements, the arrows after a drag, a reload after each kind of drag, Done, and the loading rule above.
- **Touch in the tests is simulated:** real touch events through Chromium's input pipeline (`Input.dispatchTouchEvent`), desktop Chromium, not a phone. It passed six runs in a row. What it cannot show: how the hold feels under a real finger, iOS Safari's long-press behaviour (text selection, the callout menu, the magnifier), Android's haptics, and the page scrolling by itself when a row is dragged to the screen's edge. Those need a real phone.

**The proposal (PR 17)**

Not built in PR 17, by instruction. The library needed Mark's approval first (root `CLAUDE.md`: ask before adding a dependency).

**Library: dnd-kit.** Checked on 13 Nov 2026 against the npm registry, GitHub and Bundlephobia.

| | |
| --- | --- |
| Packages | `@dnd-kit/core` 6.3.1 and `@dnd-kit/sortable` 10.0.0 (they bring `@dnd-kit/utilities` 3.2.2 and `@dnd-kit/accessibility` 3.1.1; these four depend on nothing else but `tslib`) |
| Licence | MIT, all of them |
| Size | `core` 14.2 kB and `sortable` 3.7 kB, minified and gzipped (Bundlephobia): about 18 kB. Loaded only on Fleet and the Products list, only for owners and managers, and it can be fetched when a drag is first started |
| Maintenance | The repository (`clauderic/dnd-kit`) is active: last push 31 Oct 2026, not archived, about 17,800 stars, 152 open issues. **But the two packages above were last released on 4 and 5 Dec 2024.** The author's work since then goes into a rewrite, `@dnd-kit/react` (0.5.3, 31 Oct 2026), which is still 0.x |
| React 19 | The classic packages ask for `react >= 16.8`, which our 19.3 satisfies on paper. Since confirmed by building and running: see "As built" |

**Recommended:** the classic packages (`core` + `sortable`). Their API has been stable for two years and they include a keyboard sensor and screen-reader announcements. The risk is that they get no more fixes; it is small here because the use is one sortable list and the Move up and Move down buttons stay as the fallback. The rewrite is the better choice once it reaches 1.0; choosing it today means building on an API that may still change.

**How long-press sits beside the taps and links on a line**

- **A drag handle, and only the handle.** Each line gets a grip button (44 px) at its start. Dragging starts from the handle and nowhere else, so everything a line already does is untouched: a tap on a Fleet line still opens and closes it, the title and the pencil still open the product, "+ Vehicle" and the arrows still work.
- **Phone:** press and hold the handle for a quarter of a second, then drag (dnd-kit's touch sensor with a 250 ms delay and 5 px tolerance). A quick tap on the handle does nothing. A finger that moves before the quarter second is a scroll, as anywhere else on the page. The handle switches off text selection and the long-press menu for itself only.
- **Desktop:** no long-press. Press the handle and move 8 px to start; a plain click does nothing.
- **Keyboard and screen reader:** focus the handle, Space to pick up, arrows to move, Space to drop, Escape to cancel, with spoken announcements (built into the library). Move up and Move down stay for anyone who prefers them and for a browser without JavaScript.
- **A Fleet line is a `<summary>`.** A button inside it doesn't toggle the line: PR 17's arrows sit there already and its browser test checks the line stays as it was.
- **On drop:** one call to `move_product(product, target, before | after)`, which exists. The list shows the new order at once and goes back if the server refuses.
- **Same rules as the buttons:** owners and managers only; off while a search or filter is on.

**Tests.** Mouse drag at desktop width; keyboard drag (the dependable one); one touch long-press drag at phone width, which is the test most likely to be flaky and is why this was split out; and that a tap on a line, the pencil and "+ Vehicle" still do what they did.

**Size of the work.** About one session, most of it the touch test.

### 5.9 Rental gear: the stock rework (built 14 Nov 2026)

Mark's testing of the Stock tab found it confusing: three state sections, each with its own "how many" forms, up to six full-width buttons in one card. Reworked on `platform/gear-stock-rework` to his eleven points. Rental gear only; items for sale are untouched.

**The three states of a unit**

| State | In stock | Available | How it is stored |
| --- | --- | --- | --- |
| In use | Yes | Yes, unless a booking holds it | `status = 'active'`, no downtime running |
| In repair | Yes | No | An open-ended downtime block (as before, so the availability rule is unchanged) |
| Lost | No | No | `status = 'lost'` |

Stock = in use + in repair. Available = in use, minus bookings. A unit written off (damaged for good, or a loss confirmed) is permanent: its row is deleted, or retired when bookings on record need it, and the History keeps the event with its day and notes. "Out of service" holds only units that can still come back: in repair and lost.

**Details tab, top to bottom** (everyone who can open the product; one set of stock cards per location when the shop has more than one):

1. **Product details** (owners and managers): name, description, "Track each unit on its own". First on the page since the owner's click-through of 14 Nov 2026.
2. **Stock:** large tiles for In stock, Available now and In repair; Lost only when above zero.
3. **Change quantity** (owners and managers): − and + beside a number field. "Save quantity" appears only when the number differs from what is saved.
4. **Report a problem:** one button, one dialog (a bottom sheet on a phone). What happened (In repair, Lost, Damaged for good; a role sees only what it may report); How many, or Which unit for tracked gear; Date it happened (today by default, never later); Expected back (In repair only, optional); Notes (optional, 500 characters). Under each date: "For information only. It does not affect stock quantities."
5. **Out of service:** one line per unit, tracked or not, with its status chip, day, expected-back day and notes. In repair: Back in use, Edit, Remove from stock. Lost: Found, back in use, Edit, Remove from stock.
6. Delete (owners and managers), last.

**"Remove from stock", not "Write off"** (owner, 14 Nov 2026, after the click-through). Every button that removes a unit for good says "Remove from stock": on a line in repair, on a lost line, and in the dialog for "Damaged for good". The confirmation opens "Remove from stock? This cannot be undone. …" and the History says "removed 1 from stock as damaged" or "as lost". The database keeps its names (`write_off`, `units_written_off`); only the words shown changed.

Each card has its title above a divider and at most one filled button; every action on a line is outlined.

**Stock tab:** one row per unit with its name or label and a status chip. Owners and managers label tracked units there. Counted gear shows a hint that "Track each unit on its own" is under Product details on the Details tab, with a link to it for owners and managers. Nothing on this tab changes a unit's state.

**Each unit has its own record.** Three columns on `platform.units`: `problem_on` (the day it happened, a calendar day at the unit's location), `expected_back` and `problem_notes`. Reporting three units writes three records, each edited and resolved on its own afterwards. `units_problem_check` keeps them to gear, requires the day, keeps expected back on or after it and off a lost unit. The record is cleared when the unit is back in use.

**"Expected back" is information.** Stage B's "until" time ended the downtime by itself. A repair now runs until someone presses "Back in use"; the expected day is shown on the line and in the History.

**Only units in use and free are reported.** A unit that a booking holds now or later is never put out of service from under its booking; the dialog says how many are free. (Moving a booking to another unit comes with orders, Phase 3.)

**Who may do what: one place.** `platform_private.gear_roles(action)` in the database and `lib/gear-permissions.ts` in the app hold the same table, and a database test compares them. Every function and every screen asks it, so owner-set permissions can later replace the table without touching the callers. Not built now.

| Action | Roles |
| --- | --- |
| `set_quantity` | owner, manager |
| `mark_repair` (and edit a repair's line), `back_in_use` | owner, manager, staff, mechanic |
| `mark_lost` (and edit a lost unit's line) | owner, manager, staff |
| `found` | owner, manager |
| `write_off` (as damaged or as lost) | owner, manager |

New: writing off as damaged is for owners and managers only. Everything else is as it was. RLS and `units_guard` remain the real rule underneath: a mechanic who writes `status = 'lost'` by hand is refused, as is anyone but an owner or manager deleting or retiring a unit.

**Database: `20261114000100_platform_gear_stock_rework`**, on top of Stage B's migration, which is untouched. No new table.

- `report_gear_problem()`, `update_unit_problem()` and `resolve_unit_problem()` replace `mark_units_damaged()`, `mark_units_repaired()`, `mark_units_lost()` and `resolve_lost_units()`, which are dropped. They run as the caller, take the product-and-location lock then the unit locks (Stage B's order), and write one audit event each.
- `product_stock()` answers `in_repair` where it said `damaged`.
- `units_guard` lets staff and mechanics write the three record columns on gear, and clears the record when a unit stops being lost.
- Lowering a quantity still removes only free units: `set_stock_quantity()` is unchanged, and a test holds that units in repair and lost keep their records.
- **Existing data:** a gear unit damaged at the moment of migration becomes In repair. Its day is the day the downtime started, the downtime's end (if it had one) becomes Expected back, its note becomes the notes, and the downtime is made open-ended unless a later block on that unit is in the way. A lost unit stays Lost, with the day it was last changed. Nothing is deleted.

**History, in the buttons' words.** One line per event from the functions themselves: "marked 2 in repair", "marked 1 lost", "marked 1 back in use", "marked 1 found, back in use", "removed 1 from stock as damaged", "removed 1 from stock as lost", "changed the details of a unit in repair". Under each: the unit's label (tracked gear), the day it happened, expected back and notes. Events from before the rework read in the same words ("marked 2 damaged" now reads "marked 2 in repair").

**Tests.** Database (`tests/db/gear-stock-rework.test.ts`): every action by every role, by the function and by hand; each unit's own record; what is refused; written off as damaged and as lost, with the audit event; tracked gear by unit; booked units never taken; the quantity rule; six races (the last free unit, three kinds of report at once, back in use against write off, found against write off, lowering the quantity against reports, two edits); another shop's five roles and a signed-out visitor. Browser (`e2e/gear-stock.spec.ts`, phone and desktop): the whole click-through by owner, staff, mechanic and driver, the bottom sheet's position, tracked gear, and the History.

### 5.10 Stage C, the database part (built 14 Nov 2026)

PR 1 of stage C: the table and everything behind it. Nothing a shop sees changes; the Moto Mangos panel stays on the Details tab until PR 2 moves it to its own tab. Mark's answers are decision 23.

**Migration `20261114000200_platform_product_listings`**, on top of the ones before it, none of which is touched.

- **The table** is §1.4's, with `lead_time_hours` (0 to 720, empty = none of its own). One row per product that is or once was listed; a product with no row has never been listed and reads as off, with every count at zero.
- **The data.** A row for every vehicle product that is listed, has a count above zero, or has a ready-updated time. The five columns are then dropped from `products`.
- **`products_vehicle_fields_check` is put back.** Dropping a column drops every check that names it, and this one holds the whole "a general product has no vehicle details" rule. It is dropped by name and re-created without the listing columns. That a general product has no listing is now the table's key (vehicles only).
- **Nobody signed in writes the table directly.** Members read it (RLS). Every change goes through a function that locks the product's row first: `platform.save_listing(product, settings)` for a shop, and the re-created functions below. This is what makes the lock order hold: a direct update would lock the listing's row before its guard could reach the product's.
- **`save_listing`** takes only what is to change (`{"enabled": true, "instant_units": 2, "lead_time_hours": 24}`); a lead time of null means none. It makes the row on the first real setting, sets the ready-updated time itself, and refuses a setting it doesn't know. It runs with its owner's rights, so it checks the caller per setting with `platform_private.listing_roles(action)`: `settings` and `walk_ins`, both owner and manager today. Letting staff set the walk-ins count later is one word there.
- **The guard on the table** (`product_listings_guard`) holds the rules that were in `products_guard` and `products_retire_guard`, for every writer including the service role: on only on an approved list entry (`not_listable`) and not while retired (`model_retired`); instant plus request, and walk-ins, never above the active vehicles (`more_units_than_active`).
- **`listing_on` and `listing_off`** are written on the product whenever the switch changes, whoever or whatever changed it (a save, an approval, a rejection, a retire, a disconnect). The row's own changes are in the audit trail too, under `product_listings`.
- **Re-created**, the five functions whose bodies named a dropped column (the list is from the database, not from reading migrations): `products_guard` (the other half of "listed needs an approved entry": a product whose listing is on can't be taken off its entry), `products_retire_guard`, `units_clamp_product_counts`, `review_catalog_request`, `disconnect_listing`.

**Lock order, everywhere: the product's row, then the listing's row.** Each writer and where it takes them:

| Writer | Product's row | Listing's row |
| --- | --- | --- |
| `save_listing` | `for no key update`, first thing | `for update`, then the write |
| A vehicle leaving (`units_clamp_product_counts`) | `for no key update`, as before | `for update`, then the write |
| Retire (`products_retire_guard`) | The row being written | Updated from the trigger |
| Review (`review_catalog_request`) | Every product on the request, in id order | Then each listing |
| Disconnect, Change model | `for update`, as before | Through `listing_clear`; Change model writes none |

The table's guard takes the product's lock as well, so a service-role write is checked against a settled count; such a write is the one path that reaches the listing's row first, and nothing in the app makes one.

**What changed in behaviour, on purpose**

- **Approving a request whose product the shop retired meanwhile** now goes through and leaves that product off Moto Mangos. Before, the retire rule refused the whole review.
- **Disconnect keeps the lead time.** It switches the listing off and zeroes the three counts, as before; the lead time is the shop's setting and stays.
- **The ready-updated time is set in the database**, whenever a walk-ins count above zero is saved. The browser sent it before.

**The pure rule: `@mango/core` `listing`.** `noticeHours(shop, listing)`, `earliestPickup` and `hasEnoughNotice` for the lead time (the stricter of the two; either may be missing; plain hours, no time zone); `listingCap` and `listingOffer` for the cap and the mode, as §2.6 has them, with "Ride today" bookings left out of the cap. Nothing calls them yet: Phase 2's availability function and `marketplace_api` will.

**For Phase 3.** A Moto Mangos booking is an order with `channel = 'marketplace'` whose line holds a unit block; the order must store how it was made (instant, request or now), because the mode rule counts them apart. The booking function checks the cap under the product-and-location lock (`1a02`) and reads the listing's row under the product's row lock, so two bookings can't both take the last offered unit. Lowering the cap below what is already booked leaves those bookings standing.

**The app, changed as little as possible.** `lib/fleet-data.ts` reads the listing beside the product and hands the screens the names they already use; `saveListing` calls `save_listing`; the History tab reads the listing's rows as the product's own, in the same words ("Listed on Moto Mangos: No → Yes"), and leaves `listing_on` and `listing_off` unsaid until PR 2 words them. One visible difference: retiring or disconnecting a listed product now shows two History lines (the product's, and the listing going off) where it showed one.

**Tests.** `tests/db/product-listings.test.ts`: the vehicle-fields rule (a helmet with a make, and ten other details); every moved rule; the lead time's bounds; what `save_listing` refuses; each role, by the function and by hand on the table; another shop, an outsider and a signed-out visitor; the events; Change model and Disconnect; the lock order (a save waits for the product's row; while the product's row is held, no writer holds a lock on the listing); six races (counts raised while a vehicle is sold, an approval against a retire, the switch against Disconnect, four saves at once, twelve first saves at once, five writers at once). The isolation harness has the table's fixture; `default-grants.test.ts` has its grants, its one policy and its functions. `packages/core/src/listing.test.ts`: 25 tests against the contract's §4.4 and the decisions' examples.

**Not here (PR 2, built: §5.11):** the Moto Mangos tab, the lead time field, the "Offering N of M" line, the switch saving at once, the words for `listing_on` and `listing_off`, the Thai review list.

### 5.11 Stage C, the screens (built 15 Nov 2026)

PR 2 of stage C: the Moto Mangos tab. No migration; the database is §5.10's.

**The tab.** A product page reads Details, Units, Moto Mangos, History, at `?tab=moto-mangos`. It is there only for the Motorbike kind (any of its categories) and only for owners and managers; Off-road, Car, Boat and Other, general products, and staff, mechanics and drivers have none, and asking for it by address opens the first tab they do have. The panel moved over in its order (decision 19): the logo, "List it on Moto Mangos", the Make then Model picker, "Don't see your bike above?" with the review form, the waiting, approved and rejected states, Change model and Disconnect, then the listing part. Details keeps the product form, Duplicate (in the page header, on every tab) and Delete.

**The listing part.**

- **The switch** is a switch (`role="switch"`), not a checkbox, and saves by itself through `save_listing` with `{"enabled": …}` alone. A line under it says it is on or off and that it saves as soon as it is pressed.
- **Instant units, Request units, Walk-ins and Lead time (hours)** are saved together under one Save button. The page's values go along as `was_*`, so only what changed is sent (`lib/listing-settings.ts`, `changedSettings`). Lead time is 0 to 720, empty for none, with a help line.
- **"Offering N of M bikes for advance booking"**: N is instant plus request as typed, M the product's active vehicles. It follows the typing.
- **The two messages** (the owner's words): "Total units listed on Moto Mangos can not exceed the number of units in your inventory" and "Walk-ins can not exceed the number of units in your inventory". They show as soon as a count is typed too high, and Save waits until it is put right. The server action checks the same against a fresh count of active vehicles before saving, and the database refuses with its one code, `more_units_than_active`, which the action turns into whichever of the two applies.
- "Listing takes effect when Moto Mangos starts reading from this system" stays under it.

**Links.** The dashboard's "Moto Mangos reviews" lines open the tab. The mango on a Fleet or Products row is a link to the tab (44 px to tap, owners and managers only, not in Reorder mode), keeping `?back=`, so the back link returns to the list it came from. An old link to the panel (`…/products/[id]#moto-mangos`) lands on the tab; one to a place in it (`#choose-from-list`, `#send-for-review`) keeps that place. The browser never sends the part after `#`, so a small script on the Details tab does it (`old-anchor.tsx`).

**History.** `listing_on` and `listing_off` read "switched Moto Mangos on" and "… off"; the listing's own row no longer says "Listed on Moto Mangos: No → Yes", so the switch is said once. A lead time change on its own is one line: "changed lead time from 12 to 24 hours", "set lead time to 12 hours", "removed the lead time (it was 12 hours)". Saved together with a count, it is one of the changes listed under that save's line ("Lead time (hours): (empty) → 12"). **One action, one line:** a retire or a disconnect of a listed product also switches its listing off and zeroes its counts in the same moment; the listing's row and its `listing_off` of that moment are left out, so a retire shows only "Retired" and a disconnect only "disconnected this product from Moto Mangos".

**Wording.** The picker's button "Select" is "Connect" (Change model's too: it is the same picker). The label "Select your make and model from the list" stays. The 16 new or changed texts, and the tab's unchanged ones, are in `docs/platform/thai-review-products.md`.

**Tests.** `e2e/products-stage-c.spec.ts`, at 375 px and 1280 px: the whole tab from not listed through Connect, the switch, the counts and their messages, lead time, Change model, Disconnect and the History's lines; sent for review, rejected, sent again and approved (by merging, so no run leaves an entry on the shared list); no tab for a car, a helmet, staff, a mechanic or a driver; old anchors, the mango and the back link. `fleet.spec.ts`'s Moto Mangos click-through goes through the tab; stage B's Change model and Disconnect test moved into the new file. Unit: `lib/listing-settings.test.ts` and the History reader's cases in `lib/products.test.ts`.

## 6. The brief and this design side by side

| Brief | This design, as decided |
| --- | --- |
| Instant vs request as a setting | The two stored counts stay; simple control on top |
| No marketplace fields at creation | No listing fields, and no catalog on the create form either: a kind and a name. Make, model, engine size and transmission are asked for at Moto Mangos review |
| Delivery is a service product | The distance fee stays for every shop; a shop's own flat "Delivery" product is allowed; nothing preset |
| Services such as tax and insurance, damage cover | No preset products; free-text names; any vendor's own goods and services |
| Gear counted by quantity | Counted on screen; stored as nameless unit rows so the database lock covers it. One product per size until after the pilot |
| Four types built together | Sale items: database in stage A, name and stock in B, price in D, selling in Phase 3 |
| PR 13's migration may be reshaped | Kept untouched; follow-up migrations |

## 7. Questions for Mark

Answered on 13 Nov 2026 and worked in above: the rename, the type-ahead, the Thai word, items for sale, sizes, the instant and request split, what the cap counts, who may do what, lead time, deposits, and what "tax and insurance" and delivery are.

Answered in a second round the same day: items for sale by stage, the "price per day" mode, and who may mark a unit lost.

Still open:

1. **BSR's Booqable price templates:** multipliers on a base price, or fixed amounts per length? Only the importer needs this (Phase 10).
   **15 Nov 2026:** Booqable's templates are multipliers on each product's base price (its own help pages); BSR's account itself has not been seen. §9.11 has what was seen and how BSR's four lists are loaded.

**Stage D (pricing):** Mark answered the import questions from BSR's real data on 15 Nov 2026 (decision 24). He answered again the same day (decision 25). §9.13 has what is decided and the 15 items still open, each with options and a recommendation; §9.14 has the conflicts with the spec, the contract and earlier decisions.

## 8. Spec and doc edits this design needs (owner keeps the spec)

- `docs/platform/SPEC.md` › Data model: `models` → `products` with type and tracking; `extras` row removed in favour of products and `product_extras`; `price_structures` → `price_templates` and `price_template_days`, built from anchors; the stored "price per day" mode (change request 41) dropped, with a "same price every day" fill helper in its place; new `product_pricing` (the model's deposit moves into it); `order_lines.kind` → a product line with `parent_line_id`; new `product_listings`, `tax_profiles`, `stock_movements`. › Fleet and Pricing module text to match, including: the order deposit is the sum of each vehicle's deposit; lead time; unit status `lost`; no preset products. › Booqable table: variations marked as after the pilot.
- `docs/platform/MAPPING.md`: target names in §4 and §6; `shop_extras` → service or gear products plus `product_extras`.
- `docs/INTEGRATION.md`: no change now. At 3M: extras availability (§5.3) and the lead-time rule (the stricter of shop notice and listing lead time) in §4.6.
- Root `CLAUDE.md`: the two-level lock order (§2.2) once Phase 2 builds it.
- `apps/platform/CLAUDE.md` still says the exclusion constraint is "on allocations/downtime"; it is on `unit_blocks`.

## 9. Stage D: pricing (approved 15 Nov 2026)

Design only: no code, no migration, nothing applied anywhere. Written from `main` at `dc4d8ee` (stages A to C merged; 58 migrations). It builds on §3 and says where it changes it.

**Second version, same day.** Mark looked at BSR's real Booqable data, answered the import questions and added seven requirements, all for stage D (decision 24). They are worked in below.

**Third version, same day.** Mark answered the second version's questions and added requirements for rentals, extensions and swaps that Phase 3 will build but the pricer must fit from the start (decision 25). New here: charge rules (§9.17), date-to-date months and the long-stay daily rate (§9.18), rental periods, Extend rental and Swap bike (§9.19). §9.13 lists what is decided and what is still open; §9.14 lists every place the answers cut across the spec, the contract or an earlier decision.

**Approved by Mark, 15 Nov 2026 (decision 26)**, with the four maths questions settled, the rental-period maths in stage D, charge rules after Phase 3, early return added to Phase 3, and the two tax questions sent to Korn. The build goes in the stages of §9.15, one PR each. "Recommended" is a proposal. **No money rule here is to be built from a guess: every one that is not a recorded decision is in §9.13's open list.**

### 9.1 What changed from §3 and from the first version

| Earlier | Now | Why |
| --- | --- | --- |
| §3.2, decision 15: price lists hold absolute amounts, "never multipliers" | **A price list is one of two kinds: amounts per day, or multipliers of a base price** that each product on it sets | Requirement 1. Supersedes that line of §3.2 and decision 15 |
| A total lower than the day before is refused; equal totals not mentioned | **Equal totals on neighbouring days are allowed.** Only a total that falls as days rise is refused | Mark, from BSR's data |
| Anchors at 1, 7, 14, 21, 30 days | Quick entry: **hourly**, daily, weekly, two weeks, three weeks, monthly | Requirement 2 |
| `per_period` by hour or day | Flat fee per **hour, day, week or month** | Requirement 1 |
| Season rules in Phase 2; first version recommended "the pickup day decides" | **In stage D**: a percentage up or down over a date range, on the part of the rental inside it | Requirement 4. Supersedes the first version's Q4 recommendation |
| Decision 14: the order's deposit is the sum of each vehicle's | **Four deposit choices** per shop: none, a percentage of the order, a fixed amount per order, per product. Decision 14 is the "per product" choice | Requirement 5 |
| A tax-free product takes a 0% profile | A product can be marked **not taxable**; "prices include tax" is one shop setting | Requirement 6 |
| Coupons: nothing in stage D | An on/off switch per shop and the discount step in the pricer; no coupon can be made until Phase 2 | Requirement 7 |
| Importer in Phase 10 for all 30 templates | **Four templates only**, loaded in stage D | Requirement 3 |
| `price_templates.shared`; shop defaults on `tenants` | `price_templates.product_id`; a `pricing_settings` table | As the first version |
| `product_extras` in stage D | Phase 2, with the order editor (recommended; open) | Nothing reads it yet |
| Spec, contract §4.2 and the second version: beyond 30 days, the 30-day total ÷ 30, or a list's extra-day amount | **Whole months, date to date from the pickup date, at the monthly price; leftover days at a long-stay daily rate set per product** (§9.18) | Decision 25. Lists hold days 1 to 30 only |
| A flat-fee month is 30 days | A flat-fee month is date to date | Decision 25 |
| Pickup-day and return-day rules: held until BSR's were known | Five optional shop settings, off by default; BSR uses none (§9.17) | Decision 25 |
| An order line has one price snapshot; dates sit on the order | A rental has billed periods, each its own order line with a list price and a charged price; dates sit on the rental (§9.19) | Decision 25, for Phase 3 |

### 9.2 Where prices live

```text
pricing_settings        one row per shop
  tenant_id (primary key), currency
  rounding_step        bigint   minor units; quick entry rounds filled-in days to it (THB: 1000 = ฿10)
  tax_inclusive        boolean  the prices the shop types already include tax
  default_tax_profile_id        empty = the shop charges no tax
  deposit_mode         'none' | 'percent_of_order' | 'fixed_per_order' | 'per_product'
  deposit_percent_bp   int      percent_of_order only
  deposit_amount       bigint   fixed_per_order: the amount. per_product: for a vehicle with none of its own
  coupons_enabled      boolean  default off
  (charge rules, §9.17, and swap settings, §9.19, are added here by their own later migrations)

tax_profiles            tenant_id, id, name, rate_bp (0..10000), archived_at

price_templates         tenant_id, id, name, currency
  product_id           empty = a shared price list; filled = that one product's own prices
  kind                 'amounts' | 'multipliers'
  hourly               optional; an amount or a multiplier, as the kind says
price_template_days     tenant_id, template_id, day (1..30), value, source ('anchor' | 'filled' | 'manual')
                        always all 30

product_pricing         tenant_id, product_id (primary key), currency
  pricing_method     empty | 'tiered' | 'per_period' | 'fixed' | 'free'
  price_amount       bigint > 0     per_period and fixed
  price_period       'hour' | 'day' | 'week' | 'month'     per_period
  price_template_id  tiered
  base_amount        bigint > 0     tiered on a multipliers list
  long_stay_day      bigint > 0     tiered: each leftover day after whole months (§9.18)
  deposit            bigint ≥ 0     per unit; used when the shop's deposit_mode is per_product
  taxable            boolean        default true
  tax_profile_id     empty = the shop's default
  replacement_price  bigint > 0     gear only

price_rules             tenant_id, id, name, starts_on, ends_on (calendar days), repeats_yearly,
                        adjust_bp (−9999..+100000, not 0), all_products, active
price_rule_products     tenant_id, rule_id, product_id
```

- **Amounts and multipliers.** An amount is `bigint` minor units. A multiplier is a whole number of millionths (1.1666 is stored as 1166600), never a float. **Six decimal places** (decision 29): BSR's four lists need four (฿100 × 1.1666 = ฿116.66), and six leaves room.
- **Keys.** Every parent is referenced with the tenant: `(tenant_id, product_id)` → `products`, `(tenant_id, price_template_id)` → `price_templates`, `(tenant_id, tax_profile_id)` → `tax_profiles`, `(tenant_id, rule_id)` → `price_rules`, `(tenant_id, currency)` → `tenants`.
- **Checks.** The method decides which price columns may be filled; `base_amount` only with a multipliers list. A list has days 1 to 30 with no gap; **its values never fall as days rise, and may be equal**. A rule's end is not before its start.
- **Who reads.** Owners, managers and staff read all seven tables; mechanics and drivers get no row from any (RLS). `platform_private.pricing_roles(action)` holds it (`read`: owner, manager, staff; `write`: owner, manager), like `gear_roles` and `listing_roles`, with the database test that compares it to the app's copy.
- **Who writes.** Nobody signed in writes these tables directly. Functions, each starting with `revoke all ... from public, anon`: `save_product_pricing`, `save_price_template`, `save_tax_profile`, `save_pricing_settings`, `save_price_rule`. Each takes only what is to change and refuses a setting it doesn't know.
- **Lock order**, added to the existing one (advisory `1a02` product-and-location, then `1a01` units; the product's row, then its listing's row):

  | Writer | Order |
  | --- | --- |
  | `save_product_pricing` | The product's row (`for no key update`), then the list's row if one is named (`for key share`), then the pricing row |
  | `save_price_template` | The list's row (`for update`), then its day rows in day order. It reads the names of the products on it and locks none |
  | `save_price_rule` | The rule's row, then its product links in product-id order. It locks no product |
  | Delete a product | The product's row, then its pricing row, own list and rule links by cascade |
  | Delete a shared list | Refused while a product points at it |

  A pricing row is never locked before its product's row, and no product's row is taken while a list's or a rule's is held. Pricing takes no advisory lock: it holds no stock.
- **Audit.** `audit_row` on all seven tables. Named events: `template_change` (the days that changed and the products on the list), `pricing_change` (a product's method), `price_rule_change`. Who did it comes from `auth.uid()`.
- **Currency lock.** `tenants_lock_currency` and `currency_locked` count any amount in these tables.
- **The deposit moves.** `products.deposit` and `deposit_currency` are copied into `product_pricing` and dropped; a shop that has any gets `deposit_mode = 'per_product'`, so nothing changes for it. `products_general_fields_check` names the column and is dropped by name and re-created; every function whose body names `deposit` is found in the database, not by reading migrations. From then a mechanic can't read a deposit.
- **Repo rules:** RLS in the set form, no default grants, a grant to `service_role` on purpose, `set_updated_at`, a fixture row per tenant in the isolation tests, `default-grants.test.ts` extended.

**As built in stage D4** (migration `20261115000100_platform_product_pricing`, on top of the ones before it, none of which is touched; decision 29). Where this differs from the text above, this is right.

- **Seven tables**, as listed: `pricing_settings`, `tax_profiles`, `price_templates`, `price_template_days`, `product_pricing`, `price_rules`, `price_rule_products`. Charge rules, swap settings and the extras table are not here; each gets its own migration later.
- **Ways of pricing per product type are a database check** (`product_pricing_method_by_type_check`): vehicles by rental length or flat fee; rental gear by rental length, flat fee or fixed; services and extras flat fee, fixed or free; items for sale fixed only. `save_product_pricing` says the same in words (`pricing_method_not_allowed`).
- **Multipliers are millionths**: six decimal places.
- **`pricing_settings` has no `default_deposit`**: `deposit_amount` is the fixed amount per order, or, on "per product", the amount for a vehicle with none of its own. `rounding_step` may be empty: not chosen yet, and the app suggests one for the currency. A shop gets its row the first time a setting is saved; no row means no tax, no deposit and coupons off.
- **`product_pricing` also carries** `product_type` and `template_kind`, each copied by a composite key (from the product, and from the price list), so the checks can use them: a base price only on a multipliers list, a deposit only on a vehicle, a replacement value only on gear.
- **A list is complete whoever writes it.** A check at the end of the transaction (`price_template_days_complete`) holds all 30 days and "never lower than the day before; equal allowed", for the service role too.
- **The save functions** are `save_pricing_settings`, `save_tax_profile`, `save_price_template`, `delete_price_template`, `save_product_pricing` and `save_price_rule`. **A product's own prices are saved with the product** (`save_product_pricing` with `own_list`), so the lock order is the product's row, then the list's, then the pricing row; `save_price_template` is for shared lists only. A list's kind can't be changed once made. A tax profile is archived, never deleted. `save_price_rule` also deletes a season.
- **Audit.** Row by row on five tables (`pricing_settings`, `tax_profiles`, `price_templates`, `product_pricing`, `price_rules`). The 30 days of a list and a season's product links are one named event each (`template_change` with the days that changed and the products on the list; `price_rule_change` with the products before and after), so a save is one line and not thirty. How a product is priced changing is `pricing_change` on the product.
- **`pricing_inputs(tenant, product ids)`** is the one read that feeds `quote()`: the shop's settings, each product's pricing with its price list and the tax rate in force (its own profile, else the shop's default, else none), and the active seasons that apply. It runs as the caller, so row-level security decides: a mechanic or a driver gets no settings, no products and no seasons. Amounts are sent as strings of digits. `apps/platform/lib/pricing-inputs.ts` turns the rows into `quote()`'s input and does no arithmetic.
- **The guard against a second pricing path** is three things: a lint rule in `apps/platform` that refuses multiplying, dividing or taking a remainder of anything named as money (`eslint.config.mjs`, with a test of the rule itself); a database test that no pricing function multiplies, divides or rounds; and a database test that prices real rows through `pricing_inputs`, the adapter and `quote()`. The marketplace keeps its own whole-baht pricing until 3M and is not under the lint rule.
- **The deposit moved.** Every product deposit was copied to `product_pricing` with its currency, and the two columns dropped from `products`. A shop that had deposits on products is set to "per product"; every other shop has no settings row, which is "none". The currency lock counts any pricing row, price list or settings row.
- **On screen nothing changed in this stage.** The deposit is still typed on the vehicle form, and is saved through `save_product_pricing`; it moves to the Pricing tab with stage D5. Until the shop's settings have a screen (D6), a shop that enters its first product deposit is set to "per product", which is how every deposit worked before. A product's deposit changes still read as the product's own in the History.

### 9.3 The ways of pricing (requirement 1)

| Way | What the shop enters | Charge for one unit |
| --- | --- | --- |
| **Flat fee per period** | An amount and a period: hour, day, week or month | Amount × periods, every started period counted. A week is 7 days; a month is date to date from the pickup date (§9.18) |
| **Fixed price** | One amount | The amount, once per order line, whatever the length |
| **By rental length** (tiered) | A price list: its own, or a shared one | The list's total for the rental's length (below) |
| **Free** | Nothing | 0, shown as included. Services and extras only |

**A price list** is a total for each of days 1 to 30 and, optionally, an hourly price. Two kinds, as Booqable has them:

- **Amounts.** The totals are money. One product's own list is always this kind.
- **Multipliers of a base price.** The list holds a multiplier per day; each product on it has its own base price; the total for a day is `base × multiplier`, rounded half up to one minor unit. One list then serves products at different price levels, and changing a base price moves every length at once. This is exactly Booqable's template.

Either way the pricer first turns the list into totals and then does one lookup:

1. **Under 24 hours, when the list has an hourly price:** every started hour × the hourly price, never more than the 1-day total (decided). With no hourly price it is one day.
2. **Up to 30 days:** the list's total for that many days. A day is every started 24 hours of the charged period (§9.17; with no charge rule, from pickup).
3. **From 31 days:** whole months at the monthly price plus leftover days at the product's long-stay daily rate (§9.18). The list prices every rental of 30 days or fewer (decision 26).

**BSR's four lists**, from Mark's reading of the Booqable account (example base ฿100):

| List | 1 day | 7 days | 14 days | 30 days | Booqable's extra day, now the long-stay daily rate |
| --- | --- | --- | --- | --- | --- |
| 300–3000 | ฿300 | ฿1,400 | ฿2,100 | ฿3,000 | ฿100 |
| 350–3500 | ฿350 | ฿1,500 | ฿2,500 | ฿3,500 | ฿116.66 |
| 400–4000 | ฿400 | ฿1,800 | ฿2,800 | ฿4,000 | ฿133.33 |
| 500–5400 | ฿500 | ฿2,200 | ฿3,500 | ฿5,400 | ฿180 |

Each has a tile for every day 1 to 31; steps between days are uneven, and some neighbouring days cost the same. The extra-day amounts are the 30-day total ÷ 30 cut off, not rounded, at the satang (3,500 ÷ 30 = 116.666…, stored as 116.66), which is why they are stored and never re-derived. Under the month rule they become each product's long-stay daily rate, and a list's day-31 tile is no longer used.

### 9.4 Quick price entry (requirement 2)

On any amounts list the owner types up to six prices and the days between fill in:

| Box | Means | Required |
| --- | --- | --- |
| Hourly | The list's hourly price | No |
| Daily | Total for 1 day | Yes |
| Weekly | Total for 7 days | No |
| 2 weeks | Total for 14 days | No |
| 3 weeks | Total for 21 days | No |
| Monthly | Total for 30 days | Yes |

- **Filling.** Between two neighbouring prices the days rise in equal steps, each rounded to the shop's rounding step (a shop setting, pre-filled per currency: decided). With a box left empty the fill runs straight between the ones that exist. This is `fillDays` in `@mango/core`, made currency-neutral.
- **Every day stays editable by hand.** An edited day is marked `manual` and kept; changing a box refills only the `filled` days around it; "Reset" turns a manual day back.
- **"Same price every day"** fills the boxes from one daily price (decision 15's helper).
- **The long-stay daily rate** is not on the list: it is one box on the product's Pricing tab (§9.18).
- **A falling total** is shown on the day and Save waits. Equal totals save.
- On a multipliers list the same six boxes and grid hold multipliers, with a sample base price beside them showing the resulting amounts, as Booqable's editor does.
- **Imported lists are not refilled.** Every day of BSR's four lists is stored as loaded (`manual`), so their uneven steps survive; typing in a box on such a list changes that day only.

### 9.5 Seasonal pricing (requirement 4)

A **season rule** is a name, a first and last calendar day, "every year" or one year only, a percentage up or down, and the products it applies to (all, or chosen ones). BSR's is "Low season, 1 Apr to 30 Sep, every year, −20%, the touring bikes".

**What it charges.** Only the part of the rental inside the range is adjusted, as Booqable's "Rule overlaps order" does ("the product's price is adjusted for the part of the rental period that matches this rule period").

```text
list price       P, for N charged periods (days; or hours, weeks, months for a flat fee)
inside           the charged periods that fall in the rule's range
adjustment       round half up ( P × adjust_bp × inside ÷ (N × 10000) )   one rounding, on the line
season price     P + the adjustments of every rule that applies
```

- **Which periods are inside** (decision 26): each charged day belongs to the calendar day it **starts** on, at the location, in the location's time zone. Day 1 starts at pickup, day 2 exactly 24 hours later. So the pickup day decides for day 1, and the return day counts only if a new 24 hours starts on it.
- Examples. 7 days at ฿1,400, 3 of them in a −20% season: 1,400 × 20% × 3 ÷ 7 = ฿120 off, ฿1,280. 7 days at ฿1,500, 2 of them inside: ฿85.71 off, ฿1,414.29. The satang are kept (decided).
- **Every day carries an equal share of the list price.** A price list makes early days dearer than late ones; the rule ignores that on purpose, so a customer can check the sum by hand.
- **Two rules on the same day** are each worked out on the list price and added, never compounded (Booqable's "stacking off").
- **What it applies to:** lines priced by time (by rental length, or a flat fee per period). Never a fixed price, a free line, an item for sale or a deposit.
- **Order of steps:** after the list price and before any discount, so a coupon later applies to the season price.
- **Pickup-day and return-day charge rules.** Booqable has four optional rules of its own kind ("Adjust charge period"): charge, or don't charge, the pickup day when pickup is before or after a time; the same for the return day by the return time. They change how many days are charged, before any price is looked up. BSR uses none of them. They are designed in §9.17 as shop settings, off by default, beside the seasons.

### 9.6 Deposits (requirement 5)

The shop picks one default; an order or a customer can replace it.

| Choice | The order's deposit |
| --- | --- |
| None | 0 |
| A percentage of the order | The order's total after discounts, tax included, × the percentage, rounded half up to one minor unit (decided) |
| A fixed amount per order | The amount, however many vehicles |
| Per product | The sum over vehicle lines of quantity × the product's deposit (or the shop's amount for a vehicle with none). This is decision 14 |

- **Override order:** the order's own setting, else the customer's, else the shop's. An override is the same four choices with its own number; "None" on a customer is the spec's deposit waiver.
- **What stage D can build of the overrides.** There are no orders (Phase 3) or customers (Phase 4) yet. Stage D builds the shop default, each product's deposit, and the pricer taking the two overrides as inputs, with tests. Their columns and screens arrive with those tables; nothing has to change in the pricer then.
- A deposit is never taxed, never discounted and never touched by a season rule.

### 9.7 Tax (requirement 6; the accountant's rules, 15 Nov 2026)

- A shop adds its own **tax profiles** (a name and a rate) and marks one as its default. With no default the shop charges no tax and no tax line shows anywhere.
- Each product is one of: the shop's default; another profile; **not taxable**.
- **VAT is worked out once per invoice, not per line** (decision 27). A line carries only its tax profile or rate and whether it is taxable; it has no tax amount of its own. The pricer adds up the taxable amounts after discounts by rate, and works out one VAT amount per rate, rounded once, half up, to one minor unit. The invoice shows one VAT line per rate at the bottom.
- **Two shop styles, one setting** ("Our prices include tax" or "exclude tax"):

  | Style | Total charged | VAT | Net |
  | --- | --- | --- | --- |
  | **Prices include VAT** (BSR) | The sum of the line prices | total × rate ÷ (100 + rate) | total − VAT |
  | **VAT added on top** | net + VAT | net × rate ÷ 100 | The sum of the line prices |

  Pinned by tests: ฿3,000 at 7% included is VAT ฿196.26 and net ฿2,803.74. ฿3,000 with 7% on top is VAT ฿210 and a total of ฿3,210. Three lines of ฿350 at 7% included are VAT ฿68.69 on the invoice (line by line it would have been ฿68.70).
- **The invoice breakdown follows the style.** Prices include VAT: lines at the prices the customer sees, their sum as the total, then "includes VAT 7%: ฿196.26" for each rate. VAT on top: lines at net prices, a subtotal, "VAT 7%: ฿210" for each rate, then the total. A part that is not taxable is in the total and in no VAT line.
- **Discounts reduce the VAT base** before VAT is worked out. A discount on the whole order is shared out over its lines in proportion to their amounts, the leftover minor units going to the largest remainders so the shares add up exactly (฿200 over ฿1,400 and ฿300: ฿164.71 and ฿35.29). That split is what puts the right share of the discount into each rate group when the lines are at different rates.
- **Deposits are never taxed** and sit outside the VAT base, shown separately on the order.
- **One invoice per payment.** Each payment gets its own tax invoice, so each billing event (the first booking, each extension, each swap extra) is its own invoice. VAT is worked out over the lines billed together, and an earlier invoice is never worked out again. `quote()` is called once per invoice.
- **What an invoice keeps:** for each rate, the rate itself, the profile's name, the taxable amount, the VAT and the style it was worked out in, so a later change to a profile or to the shop's setting never alters an old invoice. Each line keeps its rate.
- **Reports.** Net revenue for one bike is a derived figure: its lines' share of an invoice's net. Shares can differ from the invoice by a minor unit, so reports total from invoices, never from lines (Phase 10).
- Not covered: Thai withholding tax on business customers.

**A swap credit and the VAT base** (the accountant's rule; decision 27). This rule lives in one place: the function `creditVatBases` in `@mango/core` `quote`, and this paragraph.

- **VAT follows the money actually coming into or going out of the company.** When a bike is swapped, the money already paid for the unused part of the old bike was taxed on the first invoice. It is carried to the new invoice as a credit, and **the credit reduces the VAT base of the new invoice**: VAT there is on what the customer pays now.
- The owner's example: the new bike's remainder is ฿1,800, the credit from the old bike is ฿1,500, the customer pays ฿300. VAT on the new invoice is on ฿300 (฿19.63 at 7% included). Across both invoices it is ฿196.26 + ฿19.63 = ฿215.89, which is the VAT on the ฿3,300 paid in all. Pinned by a test.
- **A credit is not a discount.** The new period's line keeps its own price; the credit is a separate amount beside it, set against the rate group it was taxed in.
- **A credit stays a credit and needs no credit note. Only a refund, money leaving the company, creates a credit note** (§9.19).
- A credit larger than the amount it is set against is refused by the pricer. What happens to a negative amount (a cheaper bike, an early return) is the shop's choice of credit, refund or no charge, made before the pricer is called (Phase 3).

### 9.8 Coupons (requirement 7)

Stage D builds two things and no more:

1. **A switch, "Accept coupons", per shop** (`pricing_settings.coupons_enabled`, off to start), in Settings, owners and managers. Under it: "You will be able to create coupons in a later update." Until Phase 2 it changes nothing a customer sees.
2. **The discount step in the pricer.** `quote()` takes a list of already-decided discounts, each "this amount, or this percentage, off these lines", and applies them after season rules and before tax. A discount marked as a coupon is refused when the shop's switch is off; that check lives in the pricer so no channel can skip it. Until Phase 2 the list is always empty outside tests.

No coupon table, code, screen or column. Deciding whether a coupon applies (code, dates, uses, customer, channel, minimum spend, products) is Phase 2's job and happens before the pricer, so whatever settings vendors are given need no change here. Every line keeps its list price beside its discounted price.

### 9.9 One pricer, and the order it works in

**`quote()` in `@mango/core` is the only code that produces a price.** No SQL function, server action, component or marketplace file multiplies, divides or rounds money.

| Step | What | Built in |
| --- | --- | --- |
| 1. Charged length | Charge rules first (§9.17; none until they are built), then started hours, days, weeks or date-to-date months, in the location's wall-clock time | D; the rules after Phase 3 |
| 2. Unit price | §9.3 | D |
| 3. Quantity | Unit price × quantity = the line's list price | D |
| 4. Included quantity | An extra's free units (`product_extras`) | Phase 2 |
| 5. Season rules | §9.5 | D |
| 6. Discounts | §9.8; later the returning-customer discount, and a staff price on a billed period (§9.19) | D (the step), Phase 2 and 3 (what feeds it) |
| 7. VAT | Once per invoice and rate group, on the amounts after discounts and credits (§9.7) | D |
| 8. Deposit | §9.6, beside the price, never part of it | D (the number), Phase 3 (charging it) |

- **Its data** comes from one database function, `pricing_inputs(product ids)`, which returns rows under RLS and does no arithmetic. `marketplace_api` gets a sibling at 3M.
- **Its callers:** the Pricing tab's "Check a price", the Products list's price column, Phase 2's availability-and-price answer, the order editor, the shop's booking page, the marketplace's adapter.
- **Two more pure functions beside `quote()`**, in the same module and on the same rounding rules: the price of a continuation (an extension) and a swap's amounts (§9.19). They call the same unit-price lookup; nothing else prices a rental.
- **No price is not zero.** A product with no way of pricing answers "can't be priced" (the contract's `getQuote` → `null`).
- **A price is a snapshot.** The pricer reads today's prices; an order stores what it was quoted, line by line, and each invoice its VAT.
- **One call is one invoice:** the lines billed together (§9.7).
- **One rounding per step, on the line after quantity.** The steps that divide or take a percentage: a multiplier, a season rule, a swap's shares (§9.19), a percentage discount, sharing out an order discount, VAT (once per rate group), a percentage deposit.
- **The database stores and checks; it does not calculate.** `save_price_template` receives the values the editor produced and checks shape only.
- **Numbers in code.** The database is `bigint`. Inside `quote()` arithmetic is JavaScript `bigint`; at the edges a value that is not a safe integer is refused. No float anywhere.
- **`fillDays` and `priceForDays`** in `@mango/core` are today whole baht with a hard-coded ฿10. They are made currency-neutral (integers and a step passed in); the marketplace keeps calling them with whole baht and 10 until 3M, and a test pins that its numbers do not move.
- **A guard against a second path:** a lint rule forbidding arithmetic on amounts outside `@mango/core`, and a test that prices the same fixtures through every caller.

### 9.10 Phase 2, and the shop's minimum notice

Phase 2 puts one function in front of the pricer: `offer(product, location, start, end, channel)` answers bookable (hours, closures, minimum days, minimum notice), available (§2.1; for Moto Mangos the cap and mode of §2.6) and the price together, so no channel gets a price for something it can't book. The booking function repeats the first two under the locks of §2.2.

| Channel | Notice that applies |
| --- | --- |
| Moto Mangos, advance booking | The stricter of the shop's minimum notice and the listing's lead time |
| Moto Mangos, "Ride today" | None (contract §4.5) |
| The shop's own booking page | The shop's minimum notice only |
| Staff, in the app | None (recommended; open item 8) |

The shop's notice is `locations.min_notice_hours`, added by Phase 2's booking-rules migration, not by stage D. When it is the stricter one (shop 24 hours, listing 12), the listing keeps its 12 and bookings need 24; the Moto Mangos tab then says so under the lead time field. `noticeHours()` is already built and tested (decision 23).

Also Phase 2, on this design without reshaping it: `product_extras` and included quantities, coupon creation, the returning-customer discount, weekday rules, and the contract's `getQuote` and `dayPrices[30]`.

### 9.11 BSR's Booqable prices: what is loaded and how (requirement 3)

**Seen by Mark in BSR's account:** the templates are multipliers; each has a tile for every day 1 to 31 with an example base of ฿100; after day 31 a set amount per extra day; the figures in §9.3. **Seen by Claude:** only Booqable's public help pages, which agree (a template is tiles of "multiply base price by"; between tiles Booqable charges the next tile up, which never arises with a tile for every day). BSR's account was not opened by Claude.

- **Four lists only:** 300–3000, 350–3500, 400–4000 and 500–5400. The other 26 are not imported. A product that used one of them is priced by hand with quick entry.
- **Exact amounts, satang included.** For each list the loader stores what Booqable charges for each of days 1 to 30, and sets the list's extra-day amount (฿116.66 and ฿133.33 as they are) as the long-stay daily rate of each product on it. Nothing is rounded, refilled or snapped to the rounding step. Equal neighbouring days load as they are.
- **As multipliers or as amounts?** With every product at a base of ฿100 the two give the same prices. Recommended: load them as **multipliers lists**, the way Booqable holds them, so they stay BSR's shared templates and a product with another base price can use one.
- **How.** Not a migration (it is one shop's data). A small script reads a file of the four lists and calls `save_price_template` as an owner of BSR's shop, on staging first. It then prints, for each list, `quote()` for days 1 to 30 beside the file's figures; any difference stops it. The full Booqable importer (products, stock, customers, orders) stays in Phase 10 and reuses this.
- **Needed before it can run, and promised by Mark before the last build stage:** every daily amount of each list (the design has days 1, 7, 14 and 30 only), the base prices, and which product goes on which list. The maths stages do not wait for it.
- Booqable's rulesets and coupons are not loaded; BSR's low season is entered as one season rule.

### 9.12 Screens, History and Thai

**Product page: a Pricing tab**, after Units or Stock and before Moto Mangos. Owners and managers edit; staff read; mechanics and drivers have no tab.

| Card | What is on it |
| --- | --- |
| **How it is priced** | Flat fee per period, Fixed price, By rental length, Free: the ones its type allows (open item 6) |
| **By rental length** | "Use a shared price list" (a dropdown; a multipliers list then asks for this product's **base price** and shows the resulting amounts, read-only) or "Set this product's own prices" (the six quick-entry boxes and the grid of 30 days). Under either: **Long-stay daily rate**, "for each day after a whole month". On a phone the grid is behind "Show all days" |
| **Flat fee / Fixed price** | One amount; for a flat fee the period (hour, day, week, month) |
| **Deposit** | Shown when the shop's choice is "per product": one amount, empty reads "Shop amount: ฿2,000". Otherwise a line saying what the shop charges, with a link to Settings |
| **Tax** | Shop default, another profile, or Not taxable. Hidden while the shop has no tax profile |
| **Replacement value** (gear) | One amount (open item 7) |
| **Seasons** | The season rules that apply to this product, read-only, with a link to Settings |
| **Check a price** | Pick a pickup and return (and a quantity): shows the list price, any season adjustment, tax, deposit and total, from `quote()` |

- **Products list:** a Price column for owners, managers and staff: "฿300 / day" (a list's 1-day total), "฿200 / week", "฿150", "Free" or "No price yet". None for mechanics and drivers.
- **Moto Mangos tab:** a listed product with no price by rental length shows "No price yet: it won't be offered on Moto Mangos" (open item 9).
- **Settings › Price lists:** shared lists with the number of products on each; "New price list" asks Amounts or Multipliers. Saving a shared list first names the products it reprices.
- **Settings › Seasons:** the rules, each with its dates, "every year", the percentage (a choice of Increase or Decrease and a number, never a typed minus sign) and its products. A rule can be switched off without deleting it. The charge rules (§9.17) join this screen when they are built.
- **Settings › Pricing and tax:** rounding step; "Our prices include tax" or "exclude tax"; tax profiles and the default; the deposit choice with its number; "Accept coupons".

**History**, in the style of §5.9 and §5.11: the field's own words, one action one line, amounts in the viewer's number format and the shop's currency. Owners and managers only.

| Action | Line |
| --- | --- |
| First price | "set the price: daily ฿300, weekly ฿1,400, 2 weeks ฿2,100, 3 weeks ฿2,600, monthly ฿3,000" |
| A quick-entry box | "changed the weekly price from ฿1,400 to ฿1,500", with "5 filled-in days recalculated" beneath |
| One day by hand | "changed the 10-day price from ฿1,700 to ฿1,800 (by hand)"; "reset the 10-day price to ฿1,700" |
| Hourly, long stay | "set the hourly price to ฿80"; "changed the long-stay daily rate from ฿100 to ฿110" |
| Flat fee, fixed | "changed the price from ฿200 to ฿250 per day"; "set the price to ฿150"; "made it free" |
| How it is priced | "changed how it is priced from Flat fee per day to By rental length" |
| Shared lists | "moved to the shared price list 350–3500 with a base price of ฿100"; "changed the base price from ฿100 to ฿110"; "gave it its own prices (it was on 350–3500)" |
| A shared list edited | On each product on it: "price list 350–3500 changed: 7 days ฿1,500 → ฿1,600 (also used by 3 other products)" |
| Deposit | "changed the deposit from ฿2,000 to ฿3,000" |
| Tax | "changed tax from Shop default to Not taxable" |
| A season | On each product it covers: "season Low season added: 20% off, 1 Apr to 30 Sep, every year"; "… changed from 20% off to 15% off"; "… removed" |

Shop-level changes (rounding step, deposit choice, tax profiles, the coupons switch) are in the audit table; Settings has no History screen yet.

**Thai wording needs.** About 130 new texts, Claude's translations, listed in `docs/platform/thai-review-products.md` under "Products, stage D: pricing" for Korn or BSR's admin.

- **Terms to settle first** (provisional): price ราคา; price list ตารางราคา; base price ราคาฐาน; multiplier ตัวคูณ; hourly, daily, weekly, monthly รายชั่วโมง, รายวัน, รายสัปดาห์, รายเดือน; per hour, day, week, month ต่อชั่วโมง, ต่อวัน, ต่อสัปดาห์, ต่อเดือน; flat fee ราคาต่อช่วงเวลา; fixed price ราคาคงที่; free ฟรี; long-stay daily rate ราคาต่อวันสำหรับเช่าระยะยาว; extend rental ต่อสัญญาเช่า; swap bike เปลี่ยนรถ; credit เครดิต; refund คืนเงิน; deposit เงินมัดจำ (in use); season ฤดูกาล, with ไฮซีซั่น and โลว์ซีซั่น as shops say it; increase, decrease เพิ่ม, ลด; discount ส่วนลด; coupon คูปอง; replacement value มูลค่าทดแทน.
- **Tax words are not ours to choose:** ภาษีมูลค่าเพิ่ม (VAT), ใบกำกับภาษี (tax invoice), ราคารวมภาษีมูลค่าเพิ่มแล้ว (price includes VAT), ไม่คิดภาษี (not taxable) are to be confirmed by Korn or the shop's accountant as the Revenue Department's wording.
- **Lengths.** One message with a number ("{n} วัน"); Thai has no plural. The quick-entry labels show the day count too ("2 weeks (14 days)") so the two languages can't disagree.
- **Percentages.** "20% off" and "20% more" are whole messages per language (ลด 20%, เพิ่ม 20%), not a sign glued to a number.
- **Money** is never typed into a translation: amounts go through `Intl.NumberFormat` with the shop's currency.
- **History lines** are whole sentences per language, never pieces joined in code.
- Six quick-entry labels across at 375 px will not fit in Thai; they stack two to a row, checked in the browser tests in both languages.

**As built in stage D6** (15 Nov 2026; Mark's answers of the same day, and Fable's review of the migration). Where this differs from the text above, this is right.

- **Settings has four sections**, owners and managers only: Shop, Pricing and tax, Seasons, Price lists. **Price lists moved here from Products** (`/settings/price-lists`; the old addresses redirect), so staff no longer open them; staff see each product's prices and the seasons that apply on its Pricing tab.
- **The deposit choice is the shop's, in Settings.** A shop's first product deposit no longer switches it to "per product". A vehicle's own deposit is asked only while the shop is on "per product"; on any other choice a stored deposit is kept, not charged, and shows again on a switch back. A shop with no settings row works exactly like "none". Check a price uses the shop's choice, as Save does.
- **The settings row is made by the first Save, never by opening a page.** Any row fixes the shop's currency (as in D4), so the page says so and asks before the first save.
- **A tax profile in use can't be removed** (migration `20261115000200_platform_tax_profile_in_use`): `save_tax_profile` refuses to archive a profile that any product's pricing names, retired products included (`tax_profile_in_use`), and the shop's default (as before); the refusal names the products. A rename and a rate change are allowed. Lock order: the product, the price list, the tax profile, the pricing row; the archive takes the profile for update and locks no settings or pricing row.
- **One tap for the country's usual tax profile**: Thailand, "VAT 7%", made the default. No other country is offered one yet (open item 10 (a)).
- **The rounding step is edited in Settings** and only shapes what quick entry fills in from then on; a saved list reads as stored. The default per currency comes from one table in `@mango/core` (`currency.ts`): THB ฿10 (sample base ฿100); any other currency one major unit (sample base 10).
- **Season lines in each covered product's History** (added, percentage changed, dates changed, renamed, switched off or on, removed), one save read as one change.

### 9.13 Questions: decided, and still open

**Decided by Mark** (15 Nov 2026, three rounds; decisions 24 and 25).

| Was | Decided |
| --- | --- |
| Q3 | A falling total is refused; equal totals on neighbouring days are allowed |
| Q4 | Seasons in stage D: a percentage up or down over a date range, on the part of the rental inside it. A season-adjusted price keeps its satang |
| Q5, Q6 (part) | "Prices include tax" is one shop setting; shops add their own profiles and pick a default; a product can be not taxable |
| Q2 | The rounding step is a shop setting, pre-filled per currency (THB ฿10). It shapes only what quick entry fills in |
| Q8 | A deposit is never taxed or discounted. A percentage deposit is of the order's total after discounts, tax included, rounded half up to one minor unit. Per-product deposits are for vehicles only |
| Q9 | A rental under 24 hours on a list with an hourly price: every started hour × the hourly price, never more than the 1-day total. From 24 hours on, days only. With no hourly price a short rental is one day |
| Q11 | A typed price of 0 is refused. "Free" stays as its own choice, for services and extras |
| Q12 | "None" is one of the shop's deposit choices |
| Q1, Q19, old item 2 | Replaced by the month rule (§9.18): whole months at the monthly price, leftover days at the product's long-stay daily rate |
| Old item 4 | A month is date to date, anchored on the original pickup date (§9.18) |
| Old item 6 | The four pickup-day and return-day rules and weekday skipping are shop settings, off by default; BSR uses none (§9.17) |
| Open item 1 | The price list prices every rental of 30 days or fewer; the month rule starts at 31 days. A rental never costs more than the list's price for the same number of days |
| Open item 2 | A product with no long-stay rate: the monthly price ÷ 30; leftover days never cost more than one more month |
| Open item 3 | Extending: today's price to the new end minus today's price to the old end. "Keep the last period's discount" on by default, the amount editable by staff |
| Open item 4 | Seasons: each charged day belongs to the calendar day it starts on |
| Open item 11, and D3's two questions | **Decision 28.** The discount ratio is the amount charged ÷ the price before the staff discount, after seasons, for both Extend and a swap. "Prorated difference" is the two bikes' list prices for the period × the remaining share of its days, with nothing scaled. The deposit on a swap is shown to staff as a top-up or a release, never moved silently |
| Open item 14 | The rental-period maths (continuation, swap, early return) goes into stage D as pure functions with tests |
| Charge rules | After Phase 3 and before 3M. The worked examples of §9.17 are not confirmed until then |
| Early return | Phase 3: a swap to nothing, with the same credit, refund and no-charge settings |
| Q7, and open item 5 | **Answered by the accountant, through Korn (decision 27).** VAT is worked out once per invoice and rate group, not per line; one invoice per payment; a swap credit reduces the VAT base of the new invoice; a credit note only for a refund |
| Q16 to Q18 | Multipliers; exact amounts, satang included; four lists only. Mark supplies every daily amount, the base prices and which product is on which list before the last build stage; the maths stages don't wait for it |

**Still open.** The design is approved, so each of these goes ahead as recommended unless Mark says otherwise. There is no open tax question (decision 27). Item 6 is used by the database stage.

| # | Question | Options | Recommended |
| --- | --- | --- | --- |
| **6** | **Which type gets which way of pricing** | Vehicle: by rental length, flat fee. Rental gear: by rental length, flat fee, fixed. Service or extra: flat fee, fixed, free. Item for sale: fixed only | As listed. "Free" is for services and extras only, as Mark put it; a helmet that comes with the bike is an included quantity (Phase 2), not a free product |
| **7** | **Replacement value for gear; `product_extras`** | The field now or with damage charges (Phase 5). `product_extras` with the order editor (Phase 2) or now | The field now; `product_extras` in Phase 2 |
| **8** | **Does minimum notice bind staff?** | (a) online channels only. (b) staff too, with a manager's override | (a) |
| **9** | **A listed product with no price** | (a) warn on the Moto Mangos tab now; never offered at 3M. (b) refuse to switch the listing on | (a) |
| **10** | **A new shop's tax** | (a) none until the owner adds a profile; one tap offers the country's usual one. (b) the country's default on from the start | (a) |
| **12** | **Left for Phase 3, named now:** credit still unused when a rental ends (refund it, or it lapses); the deposit when an extension changes what it should be (a swap's is decided: §9.19); a swap or early return on a Moto Mangos booking and the booking fee | To be designed with Phase 3 | — |
| **13** | **Charge rules, before they are built** (§9.17): Mark confirms the worked examples; is there always at least one charged day; do the rules move the month anchor; are minimum days counted in charged days | See §9.17 | At least one day; the anchor stays the real pickup date; charged days |

### 9.14 Where the answers cut across the spec, the contract or earlier decisions

**The month rule (§9.18)**

1. **It replaces the spec's and the contract's rule for long rentals.** Spec › Pricing, the contract's §4.2 and the owner's decision of 7 Nov 2026 say: beyond 30 days, the 30-day total ÷ 30 per day ("30 days ฿5,500 → 45 days ฿8,250, 2 months ฿11,000"). At ฿3,000 a month and ฿100 a long-stay day, from 1 Jan: 45 days was ฿4,500, now ฿4,400; 60 days was ฿6,000, now ฿6,100 (two months are 59 days); a year was ฿36,500, now ฿36,000.
2. **A long rental's price now depends on its start date.** The contract passes 30 day prices (`dayPrices[30]`) and lets the marketplace derive the rest. That no longer works past 30 days: at 3M the marketplace must ask the platform for the price of the actual dates, and the contract needs the long-stay rate or a quote call. Until 3M the marketplace keeps its own rule, so the same bike could show two prices for a long rental if both were live at once; they are not.
3. **It does not match Booqable past a month.** Booqable charges BSR's day-31 tile and then a set amount per day. Gate A's "reconciles exactly" therefore holds for 1 to 30 days and not beyond, by choice. Decision 24's "the exact amount Booqable charges for each day" stands for days 1 to 30.
4. **The extra-day amount moves** from the price list (the second version, and Booqable) to the product, as Mark decided. The load script copies each list's amount to the products on it.
5. **February.** Settled by decision 26: the list prices 30 days or fewer, so 29 or 30 days from 1 Feb never cost more than the list. The same 60 days still cost ฿6,100 from 1 Jan in a common year and ฿6,000 in a leap year, because two months are then 59 or 60 days.
6. **The spec's long-term rentals** (`subscriptions_lt`: interval, next charge, auto-charge) describe the same thing as "extend by another month" from another side. Phase 3 should build one of them on the other, not both.

**Charge rules (§9.17)**

7. **They change the contract's "a rental day is every started 24 hours from pickup" (§4.1)** for any shop that switches one on, on every channel including Moto Mangos. With all of them off, which is the default and BSR's case, nothing changes. Also touched: the contract's minimum days (§4.6), walk-in lengths (§4.5), `perDay = ceil(total ÷ days)` and the booking fee, which all follow the charged days.
8. **Booqable's own description of two of the four contradicts itself** (its text and its example disagree for "charge the full return day"), and BSR has none to compare with. The rules are designed from their names, with worked examples for Mark to confirm.
9. **A search by date alone** has no time of day, and three of the rules depend on one. Moto Mangos would show a day count for its default times that can change when the customer picks a time.

**Rental periods, extending and swapping (§9.19)**

10. **The spec's order carries the dates** (`orders.starts_at`, `ends_at`) and its lines a `kind` (model, extra, bundle, fee, discount). Dates on each rental and one line per billed period replace that; the order's dates become the earliest start and latest end of its rentals.
11. **"Nothing reprices a billed period"** against the spec's "extend, swap and early return with automatic re-pricing and a credit or charge". The new rule is the stricter and clearer one. Early return is a swap to nothing (§9.19).
12. **§3.5's order line** had one price snapshot. A period needs two amounts (list and charged), the rental it belongs to, and the price list it was worked out from, so a swap can take its shares from the same numbers.
13. **A staff discount is not a coupon.** It goes through the same discount step but is not stopped by the "Accept coupons" switch.
14. **Profit per vehicle** (spec): a swap's credit moves money already paid from the first bike to the second. Reports must count each period's revenue net of that, or bike A is credited with a month it worked two weeks of.
15. **Tax documents.** Settled by decision 27: a credit applied toward the customer's next payment stays a credit and needs no credit note; a refund creates one. The first version's per-line tax, and the per-line tax snapshot of §3.3 and §3.4, are gone: VAT is per invoice and rate group.

**Carried over from the second version, unchanged:** multipliers reverse decision 15; satang in customer prices while the marketplace is in whole baht until 3M; hourly prices beside the contract's day rule (Moto Mangos keeps days only); four deposit choices in place of decision 14 alone, with order and customer overrides that have no screen until orders and customers exist; four lists loaded in stage D ahead of the Phase 10 importer; the coupons switch visible before it does anything.

### 9.15 Build order after the go-ahead

Small stages, each its own PR. No migration reaches staging or live without Mark's word. BSR's data is needed only for D7.

| Stage | Scope | Tests that pin it |
| --- | --- | --- |
| **D1. Price lists and ways of pricing** (`@mango/core`, no database) | The fill made currency-neutral, with the hourly box; amounts and multipliers lists; date-to-date months; the month rule and the long-stay daily rate; flat fee per hour, day, week, month; fixed; free. `rentalDays` takes charge rules as an argument, always empty for now | Hand-worked tables: every day 1 to 30 of each published BSR price set; equal neighbours accepted, a fall refused; multipliers with every half-up boundary (six decimals since D4); months from the 28th, 29th, 30th and 31st, across February in a leap and a common year, and across a daylight-saving change; a month, a month + 14 days, 13 months, a year; under 24 hours with and without an hourly price, at the cap; THB, a zero-decimal and a three-decimal currency; the marketplace's numbers unchanged to the baht |
| **D2. `quote()`** (`@mango/core`) | The eight steps: season rules, the discount step with the coupons switch, tax both ways, the four deposit choices with both overrides, sharing out an order discount | Seasons: a rental inside, outside, across the start, across the end, across a year's end, two rules at once; satang kept; tax per line against the order total; discount shares always add up; each deposit choice and override order; a coupon refused when the switch is off, a staff price not |
| **D3. Rental-period maths** (`@mango/core`; decision 26) | The price of a continuation, with "keep the last period's discount"; a swap's amounts under each option; an early return's unused part | Mark's examples to the baht: month 13 = ฿3,000 and a year = ฿36,000; a month + 14 days = ฿1,400; a first 14 days = the two-week price; the swap at two weeks = ฿300; with a ฿2,500 payment, ฿250 keeping the discount and ฿550 without; a cheaper bike giving a negative amount; a swap in a second period |
| **D4. The database** | The migration of §9.2: seven tables, RLS, the five save functions, the deposit's move, the wider currency lock | Each role by function and by hand; another shop and a signed-out visitor; shape checks; the lock order; races (two saves of one list, a product moved to a list being deleted, twelve first saves, a rule saved while its product is deleted); isolation fixtures and default grants; the deposit carried across on a copy shaped like staging |
| **D5. The Pricing tab** | The tab, "Check a price", the Products list's price column, History, Thai review list | Browser tests at 375 px and 1280 px in both languages, by owner, staff, mechanic and driver; the same fixtures priced on screen as in D1 and D2 |
| **D6. Settings** | Price lists, Seasons, Pricing and tax (profiles, include or exclude, deposit choice, the coupons switch) | The reprice warning names the right products; a profile in use can't be deleted; a season shows on the products it covers |
| **D7. BSR's four lists** | The load script and file, run on staging, once Mark has supplied the amounts, base prices and the list for each product | Every day 1 to 30 of every list equal to Booqable's figure; each product's long-stay rate equal to its list's extra-day amount |

After stage D:

- **Phase 2:** booking rules and minimum notice, `offer()`, `product_extras`, coupon creation.
- **Phase 3:** rentals and billed periods, Extend rental, Swap bike as one atomic step (§9.19), the swap settings.
- **Charge rules (§9.17): after Phase 3 and before 3M.** No shop needs them today, they are the one thing here that changes the day count the marketplace also computes, and they are safer to add once every caller already goes through `rentalDays` and bookings exist to test against.

### 9.16 Decided in this design without asking (say if any is wrong)

- Prices are written only through functions, never directly, to keep one lock order.
- Shop-level pricing settings sit in `pricing_settings`, not on `tenants`, so mechanics and drivers can't read them.
- A multiplier is stored as a whole number of millionths (six decimal places, decision 29), and `base × multiplier` rounds half up to one minor unit.
- A season's percentage is entered as Increase or Decrease and a number; every charged day carries an equal share of the list price.
- A percentage or a division rounds once, on the line after quantity.
- The deposit leaves the create form and the Details tab for the Pricing tab; a shop that has deposits today is set to "per product".
- The Products list shows a list's 1-day total as its price.
- BSR's four lists are loaded as multipliers lists, every day kept as hand-set.
- `quote()` uses JavaScript `bigint` inside.
- The "Monthly" box of quick entry is both the list's 30-day total and the price of one calendar month.
- A month boundary keeps the pickup's time of day on the wall clock, in the location's time zone.
- A swap's money moved from the old bike is its own line beside the new period, not a discount on it.
- "Keep the last period's discount" keeps the same proportion (charged ÷ list), not the same amount in baht.

### 9.17 Charge rules: the pickup day, the return day and skipped weekdays

Five optional rules, **all off by default** (decision 25). BSR uses none: its only Booqable ruleset is the 20% season discount. They are Booqable's "Adjust charge period" rules, and like Booqable's they run first: they decide how many days are charged, and every price step after that works on the result.

**Where they live.** With seasons, on one screen: Settings › Seasons and charge rules. Stored on the shop's `pricing_settings` row when they are built (their own migration): four times of day and a list of weekdays, each empty when off. Owners and managers set them; they are read like any other pricing setting.

| Rule | When it applies | Effect on the charged period |
| --- | --- | --- |
| Charge the full pickup day | Pickup before the set time | It starts at 00:00 on the pickup day |
| Don't charge the pickup day | Pickup after the set time | It starts at 00:00 on the day after pickup |
| Charge the full return day | Return after the set time | It ends at 24:00 on the return day |
| Don't charge the return day | Return before the set time | It ends at 00:00 on the return day |
| Skip weekdays | Always, for the chosen weekdays | Those calendar days are taken out of it |

Charged days are then every started 24 hours of the time that is left, in the location's time zone, with no fixed offset assumed. With every rule off the charged period is the rental itself, which is today's rule exactly.

Worked examples. **Not confirmed, on purpose** (decision 26): Mark confirms them when the rules are built, after Phase 3, and nothing is built from them before:

| Rule on | Rental | Without it | With it |
| --- | --- | --- | --- |
| Charge the full pickup day before 10:00 | Sat 09:00 to Mon 08:00 | 47 hours, 2 days | Sat 00:00 to Mon 08:00, 56 hours, 3 days |
| Don't charge the pickup day after 16:00 | Sat 17:00 to Mon 18:00 | 49 hours, 3 days | Sun 00:00 to Mon 18:00, 42 hours, 2 days |
| Charge the full return day after 16:00 | Sat 18:00 to Mon 17:00 | 47 hours, 2 days | Sat 18:00 to Tue 00:00, 54 hours, 3 days |
| Don't charge the return day before 10:00 | Sat 08:00 to Mon 09:00 | 49 hours, 3 days | Sat 08:00 to Mon 00:00, 40 hours, 2 days |
| Skip Sundays | Sat 10:00 to Tue 10:00 | 72 hours, 3 days | Sunday's 24 hours out, 48 hours, 2 days |

**Every channel, one function.** `rentalDays(start, end, time zone, rules)` in `@mango/core` is the only place a day is counted. The staff app, the shop's booking page and `quote()` call it; so does the marketplace, which passes no rules until 3M and from 3M takes the day count from the platform with the shop's rules applied. A customer on Moto Mangos therefore sees the same number of days and the same price as at the shop's desk.

**What does not change.** Availability: a bike is blocked for the real pickup and return times, with its buffers, whatever is charged. Whole months stay anchored on the real pickup date (recommended; open item 13), so the rules touch only rentals under a month and the leftover days after whole months.

**Conflict with the contract** (§9.14, 7 to 9): §4.1 defines a rental day as every started 24 hours from pickup. With a rule on, that becomes "of the charged period". The contract text, the marketplace's `rental-days` call, minimum days and `perDay` all follow at 3M.

**Build order:** after Phase 3 and before 3M (§9.15). In stage D only the function's signature is prepared.

### 9.18 Months and long stays

**A month is date to date, anchored on the original pickup date** (decision 25). 1 Jan runs to 1 Feb, then 1 Mar. When a month has no such date, its last day is used, and the anchor does not drift: a rental from 31 Jan renews on 28 Feb (29 in a leap year), then 31 Mar, then 30 Apr. Each boundary keeps the pickup's time of day on the wall clock at the location.

It is used in three places:

1. **A flat fee per month:** every started month is charged. (This replaces the second version's 30 days.) A week stays 7 days.
2. **A rental priced by length that runs past the list.** Its length is split into whole months from the pickup date and the leftover days after the last boundary (every started 24 hours):

   ```text
   price = whole months × the monthly price  +  leftover days × the long-stay daily rate
   ```

   The monthly price is the list's 30-day total. The **long-stay daily rate is set on each product** (`product_pricing.long_stay_day`), for now and until it has been tried in use. For BSR it is Booqable's extra-day amount: ฿100 on 300–3000, ฿116.66 on 350–3500, ฿133.33 on 400–4000, ฿180 on 500–5400.
3. **Extending a rental** by "another month" (§9.19).

Examples at ฿3,000 a month and ฿100 a long-stay day:

| Rental | Length | Price |
| --- | --- | --- |
| 1 Jan to 15 Jan | 14 days | The list's two-week price |
| 1 Jan to 1 Feb | 1 month | ฿3,000 |
| 1 Jan to 15 Feb | 1 month + 14 days | ฿3,000 + 14 × ฿100 = ฿4,400 |
| 1 Jan to 1 Jan next year | 12 months | ฿36,000 |
| 31 Jan to 31 Mar | 2 months | ฿6,000 |

- **The list prices every rental of 30 days or fewer; the month rule starts at 31 days** (decision 26). So 28, 29 and 30 days from 1 Feb cost what the list says, never more, and 31 days from 1 Feb is one month and 3 days.
- **A product with no long-stay rate** uses its monthly price ÷ 30, rounded half up to one minor unit (฿3,200 → ฿106.67). **Leftover days never cost more than one more month** (decision 26).
- **Totals still never fall as days rise:** the monthly price is the list's highest total, and with the cap a month plus its leftover days never passes two months.
- **Seasons on a long stay** work as in §9.5, on the rental's charged days.
- The list no longer has a day 31 or an extra-day amount of its own.

### 9.19 Rental periods, extending and swapping (Phase 3; the maths fits the pricer now)

Built with bookings in Phase 3. Written here because the pricer must carry it from the start, and its money maths is pinned by tests in stage D (D3).

**The shape**

- **An order holds one or more rentals. A rental is one bike for one customer over time, with its own dates.** The date picker is on the rental line, not on the order. An order with a scooter for a week and a touring bike for a weekend is two rentals; each is checked for availability and notice and priced by itself.
- **A rental is made of billed periods. A period is one bike, one date range and one frozen price.** It stores its **list price** and the **price actually charged**; the difference is the staff discount (฿2,500 charged against ฿3,000 is a ฿500 discount, with who gave it). It also keeps the tax applied and the price list it was worked out from.
- **Each period is its own order line, with a note written for it:** the dates, the bike (name and plate) and, once paid, how ("1 Jan to 1 Feb 2027 · Honda Click 125i · 1กข 1234 · paid in cash").
- **Nothing reprices a billed period.** Extending adds a period. A swap ends one and starts another. A price-list change, a season added later or a new discount never reach back.
- A period's vehicle block in `unit_blocks` is tied to its order line (`order_line_id`, as already planned).

**Extend rental** (a button on the rental): staff choose "another month" or an end date.

```text
new period's list price = price of the whole rental, from the original pickup to the new end
                        − price of the rental up to the current end
```

Both at **today's prices** for the bike (decision 26), with the rental's clock running from the original pickup. A price rise therefore reaches only the new period, and a discount on an earlier period is not taken back. So:

- Whole months renew at the monthly price: month 13 is 13 × ฿3,000 − 12 × ฿3,000 = ฿3,000, and a year is ฿36,000.
- Days after the first month use the long-stay daily rate: a month extended by 14 days is (฿3,000 + 14 × ฿100) − ฿3,000 = ฿1,400, not the two-week price.
- A first-time 14-day rental is not a continuation and pays the two-week price.
- **"Keep the last period's discount"**, on by default (decision 26): the new period's charged price starts as its list price × **the last period's discount ratio: the amount charged ÷ the price before the staff discount, after seasons** (decision 28), rounded half up to one minor unit (last period ฿2,500 against ฿3,000, new period ฿3,000 → ฿2,500). Because the ratio is taken after seasons, a season on the last period is not carried over and then applied a second time: ฿2,400 charged against ฿2,400 after a 20% season carries nothing. Staff can change the amount before confirming; off, it starts at the list price.
- The new period then goes through seasons (its own days only) and tax, like any line. The same bike must be free for the added time and its buffer.

**Swap bike** (on a rental that is out). The current period closes at the swap time and the old bike is released then. A new period opens for the new bike to the same end date. Staff pick how it is priced from the options the owner has switched on in shop settings, one of them the default:

| Option | Amount |
| --- | --- |
| **Remainder of the period** (default for an upgrade) | The new bike's remainder − the money paid toward the remainder on the old bike |
| **Prorated difference** | (The new bike's list price for the period − the old bike's) × the period's remaining charged days ÷ its charged days. Nothing is scaled: "keep the customer's discount" does not apply to it (decision 28). ฿3,500 against ฿3,000 with 17 of January's 31 days left is ฿274.19 |
| **No charge** | 0 |
| **Manual amount** | What staff type, with a reason that is kept in History |

Remainder of the period, with A the old bike and B the new, `period` its full length and `used` the time up to the swap:

```text
B's remainder     = B's price for the period − B's price for the time used
unused share of A = (A's list price for the period − A's list price for the time used) ÷ A's list price for the period
paid remainder    = the amount actually paid for the period × unused share of A
extra to pay      = B's remainder − paid remainder
```

- **Mark's example, pinned by a test.** A: ฿1,500 for two weeks, ฿3,000 a month. B: ฿1,700 and ฿3,500. Swap at two weeks, ฿3,000 paid. B's remainder = 3,500 − 1,700 = ฿1,800. Paid remainder = 3,000 × (1,500 ÷ 3,000) = ฿1,500. Extra = **฿300**.
- **When the old period was discounted** (฿2,500 paid against ฿3,000): paid remainder = 2,500 × (1,500 ÷ 3,000) = ฿1,250. **"Keep the customer's discount"**, on by default, scales B's remainder by the same discount ratio as Extend (the amount charged ÷ the price before the staff discount, after seasons; decision 28): 1,800 × 2,500 ÷ 3,000 = ฿1,500, so the extra is **฿250**. Off, it is 1,800 − 1,250 = **฿550**. The screen shows both amounts before staff confirm.
- **A cheaper bike** gives a negative amount. The owner switches on any of: **credit** (kept on the rental and taken off its next extension), **refund** (recorded as a refund; no payment gateway is called) and **no charge**.
- **How it is recorded.** The new period's list price is B's remainder and its charged price is the same, or the scaled amount when the discount is kept. The paid remainder is a separate credit line beside it ("Credit from Honda Click 125i, 14 unused days: −฿1,500"). The closed period keeps the amounts it was billed; only its end date changes. Each bike's revenue is then its own.
- **Documents and VAT** (decision 27). The swap extra is a new payment, so it is a new tax invoice: the new period's line, the credit beside it, and VAT on what is paid now (§9.7). The first invoice is not touched. **A swap credit stays a credit: no credit note.** When the shop's choice for a cheaper bike is a **refund**, money leaves the company, and **the refund creates a credit note**; the VAT on it is worked out the same way, once, on the amount refunded.
- Every division rounds once, half up to one minor unit, as elsewhere.

**Early return** (decision 26) is a swap to nothing. The period closes at the return time and the bike is released then; no new period opens. The unused part is the paid remainder of the swap formula (the amount paid × the unused share of the bike's list price for the period), and what happens to it follows the same shop settings as a swap to a cheaper bike: credit, refund or no charge. It runs through the same atomic step, with no new bike to block. For documents it follows the same rule as a swap: an unused part kept as a credit needs no credit note; one paid back as a refund creates a credit note; "no charge" creates neither.

**The deposit on a swap** (decision 28). When the two bikes' deposits are equal, the deposit stays as it is. When they differ, the difference is **shown to staff as a deposit top-up or a deposit release**; it is never charged or returned silently. The deposit is never part of the swap's VAT base. The swap pricing functions know nothing about deposits: they take none and return none, and a test holds that.

**As built in stage D3** (`@mango/core` `rental-period`): `extensionPrice`, `swapAmounts`, `settleSwap`, `earlyReturn`, `unusedPart` and `carryDiscount`. On the new invoice the new period is a `quote()` line with the rental's original pickup set, "keep the discount" is a staff discount on it, and the money carried from the old bike is a credit.

**Shop settings for swaps and early returns** (Phase 3, on `pricing_settings`): which of the four options are offered and which is the default; "Keep the customer's discount" on or off by default; which of credit, refund and no charge are allowed for a cheaper bike. Owners and managers.

**The risky part, for Phase 3: a swap is one atomic step.** Shortening the old period, releasing the old bike and blocking the new one must happen in one database function and one transaction, or not at all. A swap that fails because the new bike is taken must leave the customer's old bike still held.

- **Lock order, the same as everywhere else:** the product-and-location advisory locks (`1a02`) of both products, sorted by key; then the unit advisory locks (`1a01`) of both bikes, sorted by key; then rows: the order, its lines in id order, then the `unit_blocks` rows.
- **Inside it:** check the caller's role and that the period is out; shorten the old block to the swap time (its after-buffer then runs from there); insert the new bike's block to the period's end plus buffer; close the old period; insert the new period and any credit, refund or manual line; write one audit event naming both bikes, the option chosen and the amounts. The exclusion constraint has the last word.
- **The amounts are worked out by `@mango/core` and passed in**, as with every price; the function checks that the lines add up to the total it is given and stores them.
- **Extend rental** takes the same locks for the one bike and lengthens or adds its block in the same transaction as the new period.
- **Tests when built**, in the style of the twelve-writer test: two swaps onto the last free bike; a swap against a new booking of the same bike; a swap against an extension of the same rental; a swap whose new bike is taken at the last moment leaves everything as it was.
