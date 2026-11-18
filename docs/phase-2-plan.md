# Phase 2 plan: availability, booking, extras, coupons and the quote snapshot

16 Nov 2026. **Plan only: no code, no migration, nothing applied anywhere.** Written from `main` at `731d4e8` (PR 34 merged; 60 migrations in the repo, staging at 60 of 60, live at 53 of 53).

Read for this: `docs/platform/SPEC.md` (Build plan, Phase 2, "Products redesign and pricing (as built)", Review decisions), `docs/products-redesign.md` (§2, §3.5, §9, decisions 1 to 29), `docs/PROGRESS.md` (stages D1 to D7 and the pricing follow-ups, and "Before Phase 2"), `docs/INTEGRATION.md`, `docs/platform/MAPPING.md`, and the code and migrations they describe.

**Approved by Mark, 16 Nov 2026.** He accepted all 17 recommendations of §10 and everything in §11, with three additions (to Q5, Q11 and Q14), written in below. Where a section still says "recommended" or names a question, read it as decided as §10 records. No build stage has started.

## Summary

1. **Stage D built the pricer; Phase 2 still has to build everything that holds stock.** There is no availability function, no booking function, no allocation or hold in `unit_blocks`, no overbooking switch and no booking rules (notice, cut-off, minimum days) on the platform today. `quote()` has no extras step, there is no coupon table, and nothing produces a snapshot.
2. **The riskiest part goes first:** one database function, `reserve()`, that takes the product locks, then the unit locks, picks the best-fitting units and writes the blocks, with race tests through the staff path and the online path. Everything else in the phase sits on it.
3. **Orders are Phase 3, so a booking needs somewhere to live now.** Recommended: one stock-side table, `reservations` ("N units of one product at one place for one window"), which Phase 3's order lines point at. It is the first question in §10 because the rest of the database design follows from it.
4. **`quote()` changes twice, both small:** the included-quantity step for extras (step 4, left open by D2), and a snapshot function beside it. Coupons and the returning-customer discount need no change to the pricer's arithmetic: they are decided before it and passed in as the discounts it already takes.
5. **Six migrations, eleven build stages, one PR each** (§7). Nothing reaches staging or live without Mark's word.
6. **Two findings in today's code** that Phase 2 must fix: the block guard sorts two unit locks by UUID while `lock_units()` sorts by hash key (§4), and `@mango/core`'s Bangkok-only time and baht-only money helpers are still there (§2.6).

## 1. What is already done, and what is still to build

| Phase 2 item (spec and accept list) | Already built | Still to build |
| --- | --- | --- |
| Price structures | Price lists (amounts, multipliers), quick entry, flat fee, fixed, free, month rule, long-stay rate: D1, D4, D5 | Nothing |
| Rules (season, weekend) | Season date ranges, up or down, all or chosen products: D2, D4, D6 | Nothing. Weekday and weekend rules are not built (decided, Q14); stage 11 takes "weekend" out of the spec's accept line |
| VAT | Tax profiles, inclusive or on top, once per invoice and rate: D2, D4, D6 | The line's share of the invoice VAT, for the snapshot (§5.4) |
| Deposits | Four shop modes, per-vehicle amounts, order and customer overrides as pricer inputs: D2, D6 | Nothing in the pricer. The override columns come with orders (3) and customers (3 and 4) |
| `quote()` | Steps 1 to 3 and 5 to 8; continuation, swap and early-return maths: D2, D3 | Step 4, included quantity (§5.2); the snapshot (§5.4) |
| Extras | Nothing. `product_extras` was moved out of stage D (§9.13 item 7) | Table, save function, pricer step, screens (§5.2) |
| Coupons | The "Accept coupons" switch and the pricer's discount step with `coupons_off`: D2, D6 | Coupon tables, the rules that decide whether one applies, redemption counting, screens, the returning-customer discount (§5.3) |
| Availability function | Pure helpers only: `listingCap`, `listingOffer`, `noticeHours` (stage C). `availability.ts` in `@mango/core` is the marketplace's pool rule, kept until 3M | The platform's rule from §2.1 of the redesign, as a database function and its read (§3) |
| Booking path and locks | `lock_product_stock()` (`1a02`) and `lock_units()` (`1a01`), used by the gear stock functions; the exclusion constraint on `unit_blocks` | `reserve()` and its siblings; allocations and holds; best-fit pick; shortage; hold expiry (§3, §4) |
| Exclusion constraint | `unit_blocks_no_overlap`, since Phase 1a | Nothing. "A booking that overlaps a downtime block is refused" becomes a test through `reserve()` |
| Overbooking | Nothing: `allow_overbooking` is in the spec's data model and in no migration | The switch and the shortage rule (§3.4) |
| Booking rules | Opening hours and closures per location (1a); the listing's lead time (C) | Minimum notice, cut-off, minimum days, shop default buffers; one function that answers "bookable" (§3.6) |
| 50+ pricing unit tests | 290 tests in `@mango/core`, most of them pricing | A named accept suite that maps each accept line to tests (§9.1) |
| Daylight-saving tenant | `rental-days`, `rental-price` and `zoned` are tested in America/New_York; the seed has a New York shop (big-fleet, USD) | Availability, booking rules and the booking races run in that shop too |
| Zero-decimal currency tenant | Price lists tested in JPY and KWD; the seed has Saigon (VND) | Coupons, extras and the snapshot run in a zero-decimal shop too |
| Totals never fall as days rise | Refused on save and held by a test across month ends, leap years and both New York clock changes (D1) | The same property with seasons, extras and each discount in play (§9.1). "Both pricing modes" in the accept line is out of date: the per-day mode was dropped (change request 48) |
| "Before Phase 2" list in PROGRESS | Sorted unit locks in the stock functions | Who-did-it columns set in the database, two non-atomic pairs, two audit gaps, catalog copy drift (§3.8) |
| Thailand hard-codes marked P2 | `zoned.ts`, `currency.ts`, currency-neutral `price-list.ts` | `time.ts`, `money.ts` and two lines of `availability.ts` (§2.6) |

## 2. Design choices this plan rests on

Each is either a recorded decision or a question in §10.

### 2.1 A booking is a reservation until orders exist

Phase 2 must prove "two parallel bookings for the last unit give exactly one success", and the shortage rule needs something to count ("reserved lines that have fewer units than their quantity"). Both need a row that is not a unit block. Recommended (Q1): a **`reservations`** table on the stock side.

- One row is **N units of one product at one location for one window**, with a channel, a mode and a state.
- Rows made in one call share a `booking_id`, so a booking of a scooter and two helmets is three rows that succeed or fail together.
- It holds no money and no customer. Phase 3's order line (or rental, §9.19 of the redesign) points at its reservation; billing stays on the order side and stock on this side. Extending a rental lengthens the reservation; a swap ends one and opens another.
- `unit_blocks.reservation_id` replaces the `order_line_id` the redesign planned for Phase 3.

Why not thin `orders` and `order_lines` now: Phase 3's shape is not settled (an order holds rentals, a rental holds billed periods, each period is a line), and a block belongs to the rental's whole time on a bike, not to one billed month. A stock-side table means the same thing whichever way Phase 3 goes.

### 2.2 Units are assigned at once, so "available" means one unit free for the whole window

The review decision gives every reserved booking a real unit block at once. So the availability function counts **units with no block anywhere in the widened window**, which can be lower than the marketplace's pool answer (contract §4.3: quantity minus the busiest moment). Recommended (Q2): accept the stricter answer, with no automatic re-packing in Phase 2; 3M's before-and-after search check must expect it, as it must for the notice rule.

### 2.3 The database checks stock; `@mango/core` decides everything else

- **Stock is decided in SQL**, inside the transaction that holds the locks. It is counting rows, not money.
- **Bookable** (opening hours, closures, notice, cut-off, minimum days) **and price** are decided in `@mango/core` on the server, before `reserve()` is called. These do not race: no other booking can change a shop's opening hours.
- Online callers never reach `reserve()` directly: it is called with the service role by the server (the booking page in Phase 8, `marketplace_api` at 3M) after the rules pass. Staff call it as themselves.
- **One server entry point for online channels** (Mark, 16 Nov 2026). A single server-only module, `bookOnline()` in `apps/platform/lib`, is the only code that calls `reserve()` for the channels `booking_page`, `marketplace` and `api`. It calls `offer()` first, which runs `bookable()`, and goes on to `reserve()` only when the answer is bookable and available. Stage 3 builds it and the test that proves no booking-page or marketplace path can reach `reserve()` without passing `bookable()` (§9.1).
- So there is one implementation of each rule, not an SQL copy and a TypeScript copy to keep equal. (Q5.)

### 2.4 Discounts are decided before the pricer

As §9.8 of the redesign set out: whether a coupon applies, and whether the customer is a returning one, is worked out by a pure function in `@mango/core` (`decideDiscounts`), which hands `quote()` the list of discounts it already knows how to apply. `quote()`'s arithmetic for discounts does not change.

### 2.5 What Phase 2 cannot have yet

No customer table exists until Phase 3, and no completed rental exists to make a customer "returning". Phase 2 stores the settings and builds and tests the rules with the facts passed in, the way stage D built the deposit overrides. "Uses per customer" and "returning customer" start working on real data in Phase 3 with no change to the pricer or the coupon tables.

### 2.6 Time zone and currency in `@mango/core`

The spec and the PROGRESS inventory say the Bangkok-only helpers take a time-zone argument in Phase 2. Every new function here takes the **location's** time zone and the shop's currency exponent as arguments. `time.ts` and `money.ts` keep their marketplace-facing names as thin wrappers that pass `Asia/Bangkok` and THB, so the marketplace's numbers and its 202 tests do not move; the two Bangkok lines in `availability.ts` stay with the pool rule that is retired at 3M. A test pins that the wrappers and the generic functions agree.

## 3. Tables, functions and RPCs

All in the `platform` schema. Every table: `tenant_id`, parents referenced by `(tenant_id, id)`, RLS in the set form, grants written on purpose (`service_role` too), `set_updated_at`, audit, and a fixture row per tenant in the isolation tests. Every function starts with `revoke all ... from public, anon`. Nobody signed in writes any of these tables directly.

### 3.1 `reservations` (new)

```text
reservations
  id, tenant_id
  booking_id        uuid      rows made in one call share it; Phase 3's order takes it over
  parent_id         a gear or service row's vehicle row (an extra), else empty
  product_id, product_type    composite key to products, as units has
  location_id       pickup place; the return place is the same until multi-location
  starts_at, ends_at          the rental itself (timestamptz)
  block_period      tstzrange the rental widened by the buffers in force when it was made
  quantity          int > 0
  shortage          int >= 0  units still not assigned (overbooking only); 0 otherwise
  channel           'walk_in' | 'phone' | 'booking_page' | 'marketplace' | 'api'
  mode              'staff' | 'instant' | 'request' | 'now'
  state             'held' | 'reserved' | 'out' | 'returned' | 'cancelled' | 'expired'
  hold_expires_at   held only
  created_by        set in the database from auth.uid(); empty for the service role
```

- `held` and `reserved` are written in Phase 2. `out` and `returned` are in the check so the overdue rule (§3.5) can be tested with a hand-set row; Phase 3 and 5 write them.
- A service has a reservation row and no blocks. An item for sale has no reservation: it is sold, not reserved (Phase 3 writes its stock movement).
- The buffers are copied in at booking. A later change to a product's buffers does not move existing blocks.
- `unit_blocks` gains `reservation_id` (composite key, `on delete restrict`), required when `kind` is `allocation` or `hold` and empty for `downtime`. `unit_blocks.created_by` stops being client-settable (PROGRESS, "Before Phase 2").

### 3.2 `reserve()`: the booking function

`platform.reserve(p_tenant_id, p_request jsonb) returns jsonb`. Security definer; it checks the caller itself with `platform_private.booking_roles('reserve')` or the service role.

Request: the channel, the mode, hold or reserve, and lines: product, location, start, end, quantity, optional parent line, optional unit ids (the staff path, vehicles and tracked gear only), and from stage 8 an optional coupon with the discount amount the quote gave.

What it does, in this order (the lock order is §4):

1. Checks the caller, the shop, that each product is active and of a type that can be reserved, that each named unit belongs to its line's product and location, and that quantities are sane.
2. Takes the product-and-location locks for every line.
3. Releases this shop's expired holds on those products (deletes their blocks, sets `expired`), so a hold that ran out a second ago never refuses a booking.
4. For each line with stock: finds the free units (§3.3), picks them (§3.4), takes their unit locks, checks again under the locks.
5. Online channels on a listed product: checks the Moto Mangos cap and mode (`listingCap`'s rule: `instant_units + request_units` less Moto Mangos reservations in the window, "Ride today" left out) with the product's row and listing row locked.
6. Checks and counts the coupon (§5.3).
7. Inserts the reservation rows, then the blocks (`hold` or `allocation`), in sorted unit order. The exclusion constraint has the last word.
8. Writes one audit event (`reserve`) naming the booking, the lines and the units.

It answers `{ok: true, booking_id, lines: [{reservation_id, unit_ids, shortage}]}` or `{ok: false, reason, line}` with `reason` one of `unavailable`, `unit_taken` (a named unit is busy), `cap_reached`, `coupon_used_up`, `coupon_not_valid`, `not_allowed`. A refusal writes nothing: all lines or none.

**Staff path and online path are the same function.** Staff may name units; the online path never does (it books the product). Both take the same locks in the same order, which is what makes one of two parallel bookings for the last unit fail cleanly whichever paths they came through.

Siblings, same locks, same role check:

| Function | What | Who |
| --- | --- | --- |
| `confirm_hold(booking_id)` | `held` → `reserved`; blocks `hold` → `allocation`. Refused once expired | Whoever made the hold's channel: staff, or the service role |
| `cancel_reservation(booking_id or reservation_id)` | Deletes blocks that have not started, ends ones that have; state `cancelled`; gives back the coupon use | Owner, manager, staff; service role |
| `assign_units(reservation_id, unit_ids?)` | Fills a shortage, or moves a not-yet-collected reservation to other units (staff's swap before pickup) | Owner, manager, staff |
| `release_expired_holds()` | The sweep; also run inside `reserve()`. Scheduled with `pg_cron` where it is available, as the renewal job is | Database job |

### 3.3 The availability rule, and its read

One private function holds §2.1 of the redesign and is used by both the read and `reserve()`:

`platform_private.free_units(product, location, block_period)` returns the units that are

1. of that product at that location with `status = 'active'`;
2. with no `unit_blocks` row of any kind overlapping the widened window;
3. not held by a reservation in state `out` whose end has passed (§3.5).

`platform.availability(p_tenant_id, p_items jsonb)` is the read: for each `{product, location, start, end}` it answers `stock`, `free`, `shortage_demand`, `available = max(0, free − shortage_demand)`, and for a listed product the Moto Mangos figures (`mm_held`, and the instant and request counts in the window) that `listingOffer` needs. It runs as the caller under RLS, takes no lock and does no arithmetic on money. A service is always available while its product is active; an item for sale answers on-hand stock from the ledger.

The window is widened by the product's own buffers, else the shop's default buffers (§3.6), else none; general products have none. Blocks are stored widened and requests are widened too, so the gap between two rentals of one unit is the first one's "after" plus the second one's "before" (Q3).

### 3.4 Best-fit pick, and the shortage rule

- **Named units** (staff): each must be in the free set, or the answer is `unit_taken`.
- **Otherwise best fit:** from the free units, take the one whose previous block ends closest before this window starts; ties go to the one whose next block starts soonest after it ends, then to the lower lock key. A unit with no earlier block sorts last. This keeps long gaps whole. For nameless gear the same rule runs; staff never see which rows.
- **Too few free, overbooking off** (the default): `unavailable`, nothing written.
- **Too few free, overbooking on:** the staff path saves the reservation with the units it could get and `shortage = quantity − units`. Online channels never create a shortage (Q4).
- **Shortage demand** in `availability()`: for a product and location, the largest total of `shortage` over reservations (`held`, `reserved`) overlapping at any one moment of the window. It is subtracted from `free`, so a later booking cannot take a unit a short reservation is waiting for. `assign_units` fills a shortage when a unit frees up; Phase 3's screens call it and show the flag.
- **No re-packing** in Phase 2 (§2.3 of the redesign, "build the simple pick first"). The fragmentation test in §9.2 measures whether gear needs it.

### 3.5 A bike still out past its end keeps blocking

Review decision. A unit whose reservation is `out` and past its end is not free for any new booking until it is checked in, whatever the window. Bookings already made on it for later dates stay as they are; Phase 3's today board flags them for staff to move. No block is stretched by a job. Phase 2 builds and tests the rule with a hand-set state (nothing can be `out` until Phase 3). (Q6.)

### 3.6 Booking rules

New columns, all nullable ("not set" means no rule):

| Where | Columns | From |
| --- | --- | --- |
| `locations` | `min_notice_hours`, `booking_cutoff_minutes`, `min_days_advance`, `min_days_walkin` | MAPPING §1 |
| `products` | `min_days_advance`, `min_days_walkin` (vehicles; empty = the location's) | MAPPING §4 |
| `tenants` | `buffer_before_minutes`, `buffer_after_minutes` (the shop default; a product's own wins), `allow_overbooking` (default off), `hold_minutes` (default 15, 5 to 60) | MAPPING §1; spec data model; review decision |

`platform.booking_inputs(p_tenant_id, p_location_id, p_product_ids)` is one read, under RLS, of everything the rules need: the location's time zone, hours, closures and rules, the products' buffers and minimum days, and each listing's settings.

In `@mango/core`, new `booking-rules`:

- `bookable(rules, start, end, channel, now)` answers `ok` or one of the contract's reasons (`outside_hours`, `too_short`, `too_soon`), in the location's time zone with no fixed offset. It reuses `closures.ts`, `noticeHours` and `zoned.ts`.
- Notice per channel as §9.10 of the redesign: Moto Mangos advance bookings take the stricter of shop and listing; "Ride today" none; the shop's own booking page the shop's notice; staff none (decided, §9.13 item 8 (a)).
- `offer(inputs, availability, pricing, request)` composes bookable, available (with the Moto Mangos cap and mode from `listingOffer`) and `quote()` into one answer, so no caller can show a price for something it can't book.

Not in Phase 2: `inclusions_default`, `inclusions_override` and `deposit_methods` (MAPPING lists them for Phase 2). Nothing on the platform reads them before 3M and Phase 7. (Q13.)

### 3.7 Extras and coupons

Their tables are in §5.2 and §5.3 with the pricing they feed.

### 3.8 The "Before Phase 2" list from the Phase 1a review

One small migration and PR (stage 10), unless Mark would rather keep them apart (Q15):

- `unit_renewals.recorded_by` set in the database from `auth.uid()` (`unit_blocks.created_by` is done in stage 1).
- A renewal and its cost, and a location's opening hours (delete then upsert), each become one function.
- Changes to `platform_admins` are audited; a tenant can't be hard-deleted while it has audit rows.
- A product's copy of its catalog entry: this plan leaves it as it is, because since decision 19 the copy is shown only on the Moto Mangos review form. Say if it should follow the entry.
- `pg_cron` on live: already on the go-live checklist; the hold sweep is added to it.

### 3.9 Every migration, in order

Names follow the repo rule (`<timestamp>_platform_<what>.sql`); timestamps are given when each is written. No earlier migration is touched.

| # | Name | Stage | What it does |
| --- | --- | --- | --- |
| 1 | `platform_reservations` | 1 | `reservations`; `unit_blocks.reservation_id` and its kind check; `created_by` from `auth.uid()`; `unit_blocks_guard` re-created (two unit locks in key order, §4); `booking_roles()`; `free_units()`; `reserve()`, `cancel_reservation()`; the stock functions that test "no booking holds it" re-checked against the new column |
| 2 | `platform_availability` | 2 | `tenants.allow_overbooking`, `hold_minutes`; `availability()`; `reserve()` re-created with holds, hold release and the shortage rule; `confirm_hold()`, `assign_units()`, `release_expired_holds()` and its schedule; the overdue rule |
| 3 | `platform_booking_rules` | 3 | The rule columns on `locations`, `products` and `tenants`; `save_booking_rules()`; `booking_inputs()`; `reserve()` re-created with the Moto Mangos cap check |
| 4 | `platform_product_extras` | 5 | `product_extras`; `save_product_extras()`; `pricing_inputs()` re-created to return each vehicle's extras |
| 5 | `platform_coupons` | 8 | `coupons`, `coupon_products`, `coupon_redemptions`; the returning-customer columns on `pricing_settings`; `save_coupon()`; `save_pricing_settings()` and `pricing_inputs()` re-created for the new settings; `coupon_inputs()`; `reserve()` and `cancel_reservation()` re-created to count and give back a use; the currency lock counts a fixed-amount coupon |
| 6 | `platform_review_followups` | 10 | §3.8 |

Functions re-created in a later migration are found in the database (`pg_get_functiondef`), not by reading migrations, as stages A and D4 did. The quote snapshot needs no migration in Phase 2 (§5.4).

## 4. Lock order

One order for every writer. To be written into the root `CLAUDE.md` when stage 1 merges.

1. **Product-and-location advisory locks** (namespace `1a02`), for every (product, location) the call touches, **sorted by the lock's own key** (`hashtext(product || ':' || location)`). `lock_product_stock()` does this for one product; `reserve()` needs it across products, so stage 1 adds `lock_products_stock(pairs)` that sorts the whole set once.
2. **Unit advisory locks** (namespace `1a01`), **sorted by the lock's own key** (`hashtext(unit_id)`), through `lock_units()`. Sorted by key, not by UUID: two ids whose hashes order differently from their UUIDs could otherwise cross.
3. **Rows**, always after the advisory locks: the product's row (`for share`), then its listing's row (`for share`), in product-id order (as built in stage 3: every product row first, then, for a Moto Mangos booking only, the listings' rows `for no key update`, so two bookings of one product for two places take turns at the cap); then coupon rows in id order (`for update`); then `reservations`; then `unit_blocks`. This is the existing "product's row, then listing's row" rule with coupons and reservations added after it. A pricing row, a price list and a tax profile are never locked by a booking: it reads prices before the transaction.

Who takes what:

| Writer | Product locks | Unit locks | Rows |
| --- | --- | --- | --- |
| `reserve()` | All lines, sorted | The picked units, sorted | Product, listing (online), coupon, then inserts |
| `confirm_hold`, `cancel_reservation`, `assign_units` | The booking's products, sorted; read again under the lock, `try_again` if a move changed them meanwhile | Its units (and the new ones), sorted | Coupon (cancel), reservations, blocks |
| Gear stock functions (stage B, the rework) | One product | Its units, sorted | Unchanged |
| A downtime write; a unit sold, retired or marked lost | None | One unit, by the trigger | Unchanged. One lock can't form a cycle |
| A unit put into repair or back to active | None | None | The unit's row (no key column, so a booking's key-share lock on it does not conflict), then the product's row. It checks nothing a booking writes, so the lock would change no outcome (PROGRESS, stage 2) |
| `move_unit()`: a unit to another product or place, its bookings with it (the owner, 16 Nov 2026) | Where it is, where it goes and whatever its bookings name, sorted | The unit | The unit's row without waiting (`try_again` if it is held: a direct update holds the row and waits for the unit's lock), the products in id order `for no key update`, the reservations (they take the new product and place; a row for several units is split), blocks, then the unit's own row |
| A direct change of a unit's product or place | None | One unit, by the trigger | Refused while a booking that has not ended names where the unit was (`unit_has_bookings`); otherwise the unit's row, then the product's row |
| Deleting a unit | None | One unit, **without waiting** (`unit_busy` if it is held) | The unit's row first (Postgres locks it before the trigger runs), which is why it can't wait for the lock; then the product's row |
| The hold sweep (`release_expired_holds`, and inside `reserve()` and `assign_units()`) | The holds' products, sorted | None | Reservations, then blocks (deletes only), in the rows phase; then the redemption's `released_at`. No coupon row (as built in stage 8: inside `reserve()` that call's own coupon row is already held, and a second could not be taken in id order) |
| A vehicle leaving (`units_clamp_product_counts`) | None | One unit | Product row, then listing row: unchanged |
| `save_coupon` | None | None | The coupon's row (`for update`), then its product links in product-id order (as built in stage 8: a new link takes its product's row `for key share`, by the foreign key; 6-second lock timeout) |
| `save_product_extras` | None | None | The vehicle product's row `for no key update` (the shop's row for the "every vehicle" list), then the extra products' rows `for key share` in id order, then its extra links in extra-id order (as built in stage 5: the extras' product rows come before the links, because deleting a product locks its row and then its links) |
| Phase 3: Extend, Swap, Early return | Both products, sorted | Both units, sorted | The order, its lines in id order, reservations, blocks (§9.19 of the redesign) |

**The pick under the locks.** `reserve()` holds the product lock, so no other booking of that product is picking. A downtime write holds only a unit lock, so it can still land on a unit between the pick and the insert. So: pick, lock the picked units in key order, read the free set again; if a picked unit is no longer free, undo the attempt and pick again without it, at most three times, then answer `unavailable`. Each attempt runs in its own sub-transaction so its unit locks are released before the next and the sorted order holds on every attempt. Stage 1's first test must show that a rolled-back sub-transaction does release its transaction-level advisory locks; if it does not, the fallback is to lock every candidate unit of the product in key order before picking, with a ceiling on how many.

**Found while reading: `unit_blocks_guard` orders two unit locks by UUID** (`least(old.unit_id, new.unit_id)`, then `greatest`), in the path where a block is moved from one unit to another, while `lock_units()` orders by hash key. No path moves a block between units today except a hand-edited downtime row, so nothing has crossed. `assign_units` will move allocations, so migration 1 re-creates the guard to order by key. Until a transaction's locks are already held by `lock_units()`, the trigger's own lock is a re-entrant no-op.

**The backstop.** Postgres detects a deadlock and cancels one side; every function here answers that as a clean refusal the caller may retry once. The race tests assert no deadlock is ever reported for the paths above.

## 5. Pricing work left

### 5.1 What does not change

The eight-step order, one rounding per step, `bigint` minor units, VAT once per invoice and rate, deposits outside the total, "can't be priced" instead of zero, one call per invoice, and the lint rule and database tests that keep `quote()` the only pricer.

### 5.2 Gear and services offered with a vehicle

```text
product_extras
  id, tenant_id
  product_id          the vehicle product; empty = offered with every vehicle
  extra_product_id    a gear or service product (type copied by composite key and checked)
  included_quantity   int >= 0   free with each vehicle
  max_quantity        int > 0, or empty for no limit; never below included_quantity.
                      The most per vehicle: for a booking, max_quantity × the vehicles
                      it is offered with, as included_quantity is counted (Mark, 17 Nov 2026)
  sort_position
  one row per (product or "every vehicle", extra)
```

- Replaces the spec's `extras` table and, at 3M, the legacy `shop_extras` and `shop_extra_models`.
- When a vehicle has its own row for an extra and the shop has an "every vehicle" row for the same extra, the vehicle's own row wins.
- An extra with no price yet can be linked, shows "No price yet", and is not offered until it has one.
- Everyone in the shop reads it (it holds no amount; a mechanic preparing a bike should know two helmets go with it). Owners and managers write, through `save_product_extras(product, extras[])`, which replaces a vehicle's whole list in one call.

**How `quote()` prices an extra (step 4).** A line may name a parent line and an included quantity:

```text
included         = included_quantity × the parent vehicle line's quantity
charged quantity = max(0, quantity − included)
list price       = unit price × charged quantity          (step 3 on the charged quantity)
```

- The extra's dates default to its parent's; its unit price comes from its own way of pricing (a helmet per day, a service fixed or free).
- Example: a scooter that includes 2 helmets, 3 helmets taken at ฿50 a day for 7 days: 1 charged, ฿350. Two scooters, 5 helmets: 4 included, 1 charged.
- The included units are on the line as "included", not as a discount: they are in no discount total and reduce no VAT base beyond not being charged.
- From there the line is like any other: seasons if it is priced by time and a season covers it, discounts, its own tax rate, no deposit.
- The quoted line gains `includedQuantity` and `chargedQuantity`. A line with no parent behaves exactly as today, and a test pins every D2 figure unchanged.
- Gear extras hold stock: `reserve()` blocks every unit handed over, included ones too. Services hold none.
- `max_quantity` is **per vehicle** ("up to N per bike"; Mark, 17 Nov 2026): a booking may take up to `max_quantity` × the number of vehicles the extra is offered with, exactly like the included quantity. Above that it is refused for online channels; staff are not bound by it. Stored since stage 5; enforced with the online channels in stage 6 or 11.
- The contract's `extras[]` shape (rental or time) is derived at 3M as §3.5 of the redesign says; the contract also needs extras availability then (§5.3 item 7 of the redesign).

### 5.3 Coupons and the returning-customer discount

```text
coupons
  id, tenant_id, currency
  code                 unique in the shop, compared in upper case with spaces removed
  name                 the shop's own note
  kind                 'percent' | 'fixed'
  percent_bp           1..10000            percent
  amount               bigint > 0          fixed, off the order
  all_products         boolean; else the rows of coupon_products
  valid_from, valid_to           calendar days at the shop: when the booking is made. Either may be empty
  pickup_from, pickup_to         optional: the rental must start in this range
  min_days             optional
  min_spend            optional, bigint
  max_uses             optional: in total
  max_uses_per_customer          optional
  channels             any of staff, booking page, Moto Mangos
  with_returning_discount        boolean: may be combined with the automatic discount
  active, archived_at

coupon_products        tenant_id, coupon_id, product_id
coupon_redemptions     tenant_id, coupon_id, booking_id, customer_id (empty until Phase 3),
                       amount, redeemed_at, released_at
```

Every setting is the vendor's. Nothing is preset.

**Deciding whether it applies** is `decideDiscounts()` in `@mango/core`: given the coupon's settings, the lines, the booking moment, the channel, the uses so far and what is known of the customer, it answers the discounts to pass to `quote()`, or why the code was refused (`unknown`, `not_active`, `too_early`, `expired`, `wrong_dates`, `too_short`, `below_minimum`, `not_these_products`, `wrong_channel`, `used_up`, `customer_used_up`, `coupons_off`).

**How it reduces the price**

- A **percentage** coupon is taken on each eligible line's price after seasons.
- A **fixed** coupon is an amount off the eligible lines together, shared out over them in proportion to the satang (the pricer's existing split), so each tax-rate group loses its exact share. It never takes more than those lines come to; the rest of it is not carried anywhere.
- **A coupon never reduces the deposit, and the total can't go below zero** (Mark, 16 Nov 2026). A fixed coupon larger than its lines takes them to zero and no further; a per-vehicle or fixed-per-order deposit is the same with or without the coupon, and no coupon amount is ever set against a deposit. (A percentage-of-order deposit is still a percentage of the total after discounts, as decided in stage D: the coupon changes the total it is taken on, never the deposit itself.) Both are tests in stage 7.
- "Which products" means which lines it applies to: all, or the chosen products. A coupon for chosen scooters does not reduce the helmets beside them.
- One coupon per booking.

**Counting uses.** `reserve()` takes the coupon's row for update, counts the redemptions not released, refuses `coupon_used_up` at the limit, and writes the redemption in the same transaction as the booking. `cancel_reservation` and an expired hold give the use back. So two bookings racing for a coupon's last use give one success. The amount stored is the one the quote gave.

**The switch.** "Accept coupons" (D6) stays the one switch: off, no code is accepted on any channel, enforced in the pricer as today; coupons can still be created and edited while it is off. The "You will be able to create coupons in a later update" line goes.

**The automatic returning-customer discount.** Three settings on `pricing_settings`, written through `save_pricing_settings`: on or off (off to start), a percentage, and how many completed rentals at this shop make a customer "returning" (default 1). It is a discount with source `returning_customer`, which the pricer already knows; it is not stopped by the coupons switch. It applies to rental lines (vehicles and gear priced by time), not to items for sale or services (Q8). Who is returning comes from orders in Phase 3; until then the fact is an input, and "Check a price" has a "Returning customer" tick.

**Order of everything, and VAT**

| Step | What | Taken on |
| --- | --- | --- |
| 5 | Seasons | The list price |
| 6a | Returning-customer discount | The price after seasons |
| 6b | Coupon | What 6a left |
| 6c | Staff discount (Phase 3: the price staff charge for a period) | What 6b left |
| 7 | VAT | What is left, by rate group. Every discount reduces the VAT base |
| 8 | Deposit | Beside the price; a percentage deposit is of the total after discounts, tax included |

- The pricer applies discounts in the order given, each on what the one before left (D2). `decideDiscounts` fixes that order.
- **A coupon and the returning-customer discount do not stack unless the coupon says so.** When they do not, the customer gets whichever takes more off, worked out by pricing both ways inside `@mango/core` (Q7).
- The staff discount always applies last and is never blocked by either.
- Worked example, prices include 7% VAT: a ฿3,000 month, 10% returning discount, then a ฿200 coupon that allows stacking: 3,000 − 300 − 200 = ฿2,500; VAT is 2,500 × 7 ÷ 107 = ฿163.55. Without stacking the customer gets the ฿300, the larger: ฿2,700, VAT ฿176.64.

**Legacy promotions** (MAPPING §2: "mapped in detail when Phase 2 is prepared"). `public.promotions` has a kind (percent or amount), a value, minimum days, a date range, active, and all or chosen models, with no code. No promotion exists. At 3M a promotion with dates maps to a season when it is a percentage with no minimum days, and otherwise to an automatic (code-less) discount, which this plan does not build. If a shop creates one before 3M, that is the moment to decide; nothing is built for it now.

### 5.4 The quote snapshot

Stored by Phase 3; defined, built and tested now. `snapshotQuote(input, context)` in `@mango/core` prices one invoice and turns it into plain data (amounts as strings of digits, like `pricing_inputs`). It calls `quote()` on the input itself, so a snapshot can never hold one invoice's prices beside another's figures (Mark, 17 Nov 2026; it took the quote as a third argument before). `readSnapshot()` reads it back, and `readSnapshotLine()` reads one stored line on its own. An order never calls `quote()` on stored prices again and never re-reads a profile, a price list, a season or a coupon.

**On every line**

| Field | Notes |
| --- | --- |
| `version` | The snapshot's version, on each line too: an order line keeps its line alone |
| `currency` | With the exponent it was priced at |
| Product | Id, name and type as they were. (For a Moto Mangos booking Phase 3 also keeps the list entry's make, model and years: §5.7 of the redesign) |
| Dates | Start, end, the rental's original pickup if it is a continuation, the location's time zone, the charged periods and their unit |
| `quantity`, `included_quantity`, `charged_quantity` | §5.2. `included_quantity` is the line's free units, never more than its quantity |
| `included_per_vehicle` | An extra's allowance as it was priced: how many came free with each vehicle. Empty for a line with no parent. With the parent line's id, it is what adding a unit later is worked out from |
| `unit_price` and how it was worked out | The pricer's `basis` |
| `list_price` | Unit price × charged quantity |
| The prices it was worked out from | The way of pricing as passed in: the list's 30 totals, hourly price, long-stay rate, or the flat fee. A swap takes its shares from these (§9.14 item 12 of the redesign) |
| Each season adjustment | Rule id, name, percentage, periods inside and in all, amount |
| `season_price` | |
| Each discount | Id, source, the coupon's id and code if it is one, its kind and value, the amount taken from this line |
| `amount` | What the line comes to |
| `taxable`, `tax_rate_bp`, `tax_profile_id`, `tax_profile_name` | The id is kept for reference only; nothing reads the profile through it |
| `tax_inclusive` | The shop's style when it was priced |
| `tax_amount` | **The line's share of its rate group's VAT** (below) |
| `deposit` | Per-vehicle mode: this line's deposit. Other modes: empty, the deposit is on the invoice |

**On the invoice:** the totals `quote()` returns; one entry per rate (rate, profile names, base, net, VAT, gross, style); the non-taxable part; credits; every discount the invoice was priced with (id, source, the coupon's id and code, its kind and value, all lines or the lines it was aimed at, and what it took in total, one that took 0 included); the deposit with its mode, number and whether it came from the order, the customer or the shop; `priced_at`; a `version`.

**The line's tax amount.** Mark's note of 15 Nov asks for a tax amount on every line; decision 27 says VAT is worked out once per invoice and a line has none of its own. Both hold if the line stores its **share**: the group's VAT split over its lines in proportion to their amounts, leftover minor units to the largest remainders, so the shares add up to the invoice VAT exactly. The invoice's figure stays the one of record; the share is for per-bike reports, as decision 27 (8) has it. (Q9.)

**Phase 3's columns, fixed now.** On each order line: `list_price`, `season_total`, `discount_total`, `amount`, `tax_rate_bp`, `tax_profile_id`, `tax_profile_name`, `tax_inclusive`, `tax_amount`, `deposit`, `currency`, and `snapshot jsonb` holding the whole line as above, its `version` with it. On each invoice: its totals, its rate groups and `snapshot jsonb`. Phase 3's save function checks the snapshot's shape and that its lines add up to its totals (addition and comparison only, so the "no pricing function multiplies, divides or rounds" test still holds). That check is written with the columns in Phase 3; Phase 2 ships the TypeScript and its tests.

**Tests that make "no pricer change in Phase 3" true:** every pinned figure of D2 and D3 (a first booking, an extension, a swap with a credit, a cheaper bike, an early return) is snapshotted, turned to JSON, read back and compared to the satang; each snapshot's line tax shares add up to its VAT lines; a snapshot read back after the profile is renamed, re-rated and archived, the list repriced, the season deleted and the coupon archived is unchanged; an older `version` still reads.

## 6. RLS, and who may do what

Enforced in the database by RLS and by `platform_private.booking_roles(action)` (new) beside `pricing_roles`, `gear_roles` and `listing_roles`, each with its copy in `apps/platform/lib` and a database test that compares the two. "No" means the database refuses or returns no row, not that a screen hides a button.

| Action | Owner | Manager | Staff | Mechanic | Driver |
| --- | --- | --- | --- | --- | --- |
| See availability (free counts) and reservations (dates, product, units; no money) | Yes | Yes | Yes | Yes | Yes |
| See allocation and hold blocks on a unit | Yes | Yes | Yes | Yes | Yes |
| Make a hold or a reservation; confirm a hold | Yes | Yes | Yes | No | No |
| Name the units on a reservation; move it to other units; fill a shortage | Yes | Yes | Yes | No | No |
| Cancel a reservation | Yes | Yes | Yes | No | No |
| Create a shortage (only while overbooking is on) | Yes | Yes | Yes | No | No |
| Switch overbooking on or off; hold length; shop default buffers | Yes | Yes | No | No | No |
| Booking rules of a location (notice, cut-off, minimum days) | Yes | Yes | No | No | No |
| See which extras go with a vehicle | Yes | Yes | Yes | Yes | Yes |
| Change a vehicle's extras | Yes | Yes | No | No | No |
| See prices, "Check a price", coupons and their uses | Yes | Yes | Yes | No | No |
| Apply a coupon code to a booking | Yes | Yes | Yes | No | No |
| Create, change, switch off or archive a coupon | Yes | Yes | No | No | No |
| Returning-customer discount settings | Yes | Yes | No | No | No |
| Downtime, unit status, gear problems | As today | As today | As today | As today | No |

Policies, table by table:

| Table | Select | Insert, update, delete |
| --- | --- | --- |
| `reservations` | Every member of the shop | Nobody directly; the functions of §3.2 |
| `unit_blocks` | Every member (as today) | `downtime` rows by owner, manager, staff, mechanic (as today); `allocation` and `hold` rows by nobody directly. The existing policies already limit direct writes to `downtime`; a test holds it |
| `product_extras` | Every member | Nobody directly; `save_product_extras` (owner, manager) |
| `coupons`, `coupon_products`, `coupon_redemptions` | Owner, manager, staff (`pricing_roles('read')`) | Nobody directly; `save_coupon` (owner, manager); redemptions only by `reserve()` and `cancel_reservation()` |
| New columns on `locations`, `products`, `tenants` | As those tables today | `save_booking_rules` (owner, manager) |

- **Online callers** have no membership. `reserve()` and `confirm_hold()` accept the service role for the channels `booking_page`, `marketplace` and `api` only, and a signed-in member for `walk_in` and `phone` only. A signed-out visitor and a signed-in Moto Mangos customer can execute none of them.
- **Security-definer functions** each get their own cross-tenant test: a member of shop A naming shop B's product, unit, location, coupon or booking is answered exactly like "no such thing".
- A reservation carries no price, so mechanics and drivers reading it see nothing `product_pricing` hides.
- Who made a reservation is set in the database, never sent by the browser.

## 7. Screens

Orders, the order editor and the calendar are Phase 3. Phase 2's screens are settings, and one read-only screen so the engine can be clicked through.

| Screen | Address | Who | What |
| --- | --- | --- | --- |
| **Check availability and price** | `/[tenant]/new-order` (the tab that is a placeholder today) | Owner, manager, staff. Mechanic and driver: counts only, no prices | Pick a location, pickup and return. Each product: "3 of 8 free", its price for those dates from `quote()`, and why not when it can't be booked (closed, too soon, too short). Tap a vehicle: its extras with included quantities, a coupon code box, a "Returning customer" tick, and the full breakdown (list price, seasons, each discount, VAT lines, total, deposit). Read-only: nothing is reserved. Phase 3 continues this screen into the order |
| **Extras tab** on a vehicle's page | `/[tenant]/products/[id]?tab=extras` | Owner and manager edit; staff, mechanic and driver read | The gear and services offered with it: add from the shop's gear and services, included quantity, "Most per vehicle", order. A line for what comes from "every vehicle" |
| **Settings › Extras** | `/[tenant]/settings/extras` | Owner, manager | The extras offered with every vehicle |
| **Settings › Coupons** | `/[tenant]/settings/coupons` | Owner, manager (staff read a list from the price check only) | The list with uses ("12 of 50"), New coupon, edit, switch off, archive. The form: code, percentage or fixed amount, all or chosen products, valid dates, pickup dates, minimum days, minimum spend, total uses, uses per customer, channels, "can be combined with the returning-customer discount". A note when "Accept coupons" is off, with a link |
| **Settings › Pricing and tax** | existing | Owner, manager | A new card: returning-customer discount (on or off, percentage, completed rentals needed). The coupons switch loses its "later update" line |
| **Settings › Booking rules** | `/[tenant]/settings/booking-rules` | Owner, manager | Per location: minimum notice, cut-off before closing, minimum days (advance, walk-in). For the shop: default buffers before and after, hold length, "Allow overbooking" with a plain explanation of the shortage it creates |
| **Pricing tab › Check a price** | existing | As today | Gains extras, the coupon code and the returning-customer tick, from the same component as the first screen |
| **Unit page** | existing | Every member | The block list shows bookings and holds beside downtime, read-only ("Booked 3 to 5 Jan") |
| **Moto Mangos tab** | existing | Owner, manager | Under the lead time: a line when the shop's notice is the stricter one ("Bookings need 24 hours: your shop's minimum notice") |

- Every screen works at 375 px; English and Thai keys are added together; the new Thai lines go on `docs/platform/thai-review-products.md` for Korn.
- History: a vehicle's extras changes and a coupon's changes read in the buttons' words, one action one line, as §5.9 and §9.12 of the redesign set the style.
- The demo seed gets reservations, a hold, a shortage (in a shop with overbooking on), extras and two coupons, so the first screen shows real reductions.

## 8. Build stages

One PR each, riskiest first. Each stage ends with typecheck, lint, unit, database and browser tests green in CI and a PROGRESS entry. A migration is applied locally only until Mark says otherwise.

| # | Stage | Scope | Migration | Why here |
| --- | --- | --- | --- | --- |
| 1 | **Booking core** | `reservations`, `reserve()`, `cancel_reservation()`, `free_units()`, best-fit pick, the guard's lock order, `booking_roles`. Staff path and online path. No overbooking, no holds, no cap yet | 1 | The locks are where a mistake double-books a bike. Everything later is re-created on top of this |
| 2 | **Shortage, holds and the availability read** | Overbooking and the shortage rule; holds, confirm and expiry; `assign_units`; the overdue rule; `availability()` | 2 | The second-riskiest: it changes what "free" means |
| 3 | **Booking rules and `offer()`** | The rule columns and `booking_inputs()`; `booking-rules` and `offer()` in `@mango/core`; the one server entry point for online channels, `bookOnline()`, with its test (§2.3); the Moto Mangos cap inside `reserve()`; `time.ts` and `money.ts` made generic behind their old names | 3 | Time zones and daylight saving. Wrong answers here refuse real bookings |
| 4 | **Pricer: included quantity and the snapshot** (`@mango/core` only) | Step 4; `snapshotQuote` and `readSnapshot`; the line's tax share; the Phase 3 column list confirmed | None | Fixes the shape Phase 3 depends on before more is built on it |
| 5 | **Extras: database** | `product_extras`, `save_product_extras`, `pricing_inputs` with extras, the adapter in `lib/pricing-inputs.ts` | 4 | |
| 6 | **Extras: screens** | The Extras tab, Settings › Extras, History lines, Check a price with extras | None | |
| 7 | **Coupons: the rules** (`@mango/core` only) | `decideDiscounts`: every coupon setting, the returning-customer discount, stacking and "the larger one"; tests that a coupon never reduces the deposit and the total never goes below zero | None | Money rules as pure functions with tests, before any table |
| 8 | **Coupons: database** | The three tables, the settings columns, `save_coupon`, `coupon_inputs`, redemption inside `reserve()`, giving a use back | 5 | The last change to `reserve()` |
| 9 | **Coupons: screens** | Settings › Coupons, the returning-customer card, Check a price with a code | None | |
| 10 | **Review follow-ups** | §3.8 | 6 | Small and independent; can move earlier if a stage is waiting on Mark |
| 11 | **Check availability and price, Booking rules, wrap-up** | The read-only New order screen, Settings › Booking rules, bookings on the unit page, the Moto Mangos notice line, the demo seed, the accept suite and click-through list, root `CLAUDE.md` lock order, PROGRESS; the spec's Phase 2 accept line updated (drop "weekend" and "both pricing modes", §12); staging on Mark's word | None | Puts every earlier stage on a screen Mark can try on his phone |

Stages 4 and 7 touch no database and can be reviewed while an earlier database stage waits for an answer. Not in Phase 2: orders, customers, payments, the order editor, check-out, charge rules (after Phase 3, before 3M), `marketplace_api`, the booking page, weekday rules, re-packing.

## 9. Test plan

### 9.1 Unit (`@mango/core` and `apps/platform/lib`)

- **A named accept suite**, `phase-2-accept.test.ts`, one block per accept line, so the list can be read off the test names:
  - 50 or more pricing tests: list prices at every length, seasons, VAT included and on top, each deposit mode, extras, each coupon kind, the returning-customer discount. No weekend rules: they are not built (Q14).
  - **Totals never fall as days rise:** for every length from 1 hour to 400 days and every start date over two years, across month ends, a leap year and both clock changes, with a season, an extra with included units, a percentage coupon, a fixed coupon and the returning-customer discount each in play. One known edge to settle in the test, not paper over: a season that covers only the later days of a longer rental and lowers them can make the longer rental cheaper; that is the season doing its job, and the property is asserted on the list price and on each discount step separately.
  - **A daylight-saving tenant** (America/New_York): days and months across both clock changes; a season that starts on the clock-change day; notice, cut-off and opening hours on the short and the long day; a hold that expires across the change.
  - **A zero-decimal tenant** (VND or JPY): a percentage coupon, a fixed coupon split over three lines, a season, VAT both ways and the snapshot, with no fraction anywhere.
- **Step 4:** included quantity with one and several vehicles, more included than taken, an extra priced each way, a free service, a line with no parent unchanged, every D2 and D3 pinned figure unchanged.
- **`decideDiscounts`:** each refusal reason; the code compared in any case and spacing; valid-from and valid-to at the shop's midnight on either side, in a daylight-saving zone; pickup range; minimum days and spend at the boundary; chosen products; channels; the last use; stacking allowed and not; the larger of the two; the switch off.
- **A coupon and the deposit (stage 7):** in each of the four deposit modes, a per-vehicle and a fixed-per-order deposit are the same amount with and without a coupon, percentage or fixed; no discount line is ever set against the deposit; a percentage-of-order deposit moves only because the total it is a percentage of moved.
- **The total never goes below zero (stage 7):** a fixed coupon larger than its lines, alone and stacked with the returning-customer discount and a staff discount, on one line and split over several, in a two-decimal and a zero-decimal currency: every line amount, every tax base and the total are zero or more, and VAT is never negative.
- **Online channels can't skip `bookable()` (stage 3):** `bookOnline()` asked for a closed day, too little notice or too short a rental answers the reason and `reserve()` is never called (asserted on a spy and on an unchanged database); a static test over `apps/` fails if any file but `bookOnline()`'s names `reserve` with an online channel, or imports the service-role booking call; and the database test that a signed-out visitor and a signed-in Moto Mangos customer can't execute `reserve()` at all (§9.2).
- **The snapshot:** the tests listed in §5.4.
- **`bookable` and `offer`:** every reason, each channel's notice rule, the stricter of shop and listing both ways round, closures that repeat over New Year, "Ride today" skipping notice, a product with no price answering "can't be priced" and never zero.
- **The wrappers:** `time.ts` and `money.ts` give the marketplace the same answers as before, to the baht and the minute.
- The role table in `lib` equals the database's.

### 9.2 Database (Vitest against local Supabase)

- **The accept races, each run many rounds:** two parallel bookings for the last unit give exactly one success and one `unavailable`, with nothing half-written, for staff against staff, online against online, and staff against online; the same with one side naming the unit.
- **In the style of the twelve-writer test:** twelve bookings for the last helmet; two bookings each wanting 2 of the same 3 helmets (one succeeds, or both get a clear refusal, never a deadlock); two multi-product bookings naming the same two products in opposite orders; a booking against a downtime write on the unit it picked; a booking against that unit being sold, retired or marked lost; a booking against lowering a gear quantity; a booking against a gear problem report; two bookings for a listing's last offered unit under the cap; two bookings for a coupon's last use; a hold expiring while it is being confirmed; `assign_units` against a new booking for the same unit.
- **A booking that overlaps a downtime block is refused** (accept line), by the pick and, when the unit is named, as `unit_taken`; and by the constraint itself when a block is written by hand as the service role.
- **Availability:** stock, free and available against hand-made blocks; buffers widening both sides; a unit in maintenance, retired, sold or lost is not stock; shortage demand at the busiest moment; an overdue unit; a service; an item for sale; another location's units not counted; the Moto Mangos figures.
- **Best fit:** the unit whose last block ends closest before is chosen; long gaps stay whole; and a fragmentation measure for gear (random bookings on 20 helmets: how often "one free at every moment" is refused), to decide whether re-packing is needed.
- **Overbooking:** off refuses; on saves a shortage on the staff path and refuses online; a later booking can't take the unit a shortage is waiting for; `assign_units` fills it.
- **Lock order:** while a booking holds its product lock, a second waits (polled from `pg_stat_activity`, not slept); no function holds a unit lock before its product lock; the guard orders two units by key; no deadlock is reported in any race above.
- **Roles and isolation:** every action in §6 by every role, by the function and by hand on the table; another shop's five roles, a stranger, a Moto Mangos customer and a signed-out visitor; a fixture row per tenant for every new table; `default-grants.test.ts` for every new table and function.
- **Extras and coupons:** what each save function refuses; an extra must be gear or a service and its parent a vehicle; a coupon's shape checks; a redemption given back on cancel and on expiry; the currency lock.
- **One pricer:** real rows priced through `pricing_inputs`, `coupon_inputs`, the adapter and `quote()`; no new function multiplies, divides or rounds.
- **In a New York shop and a dong shop:** the races and the availability tests run there too, not only in BSR.
- **Migration test:** a database at today's `main` with the three seeded shops and D7's BSR prices takes the six migrations; products, units, blocks, pricing rows and audit rows are counted before and after, and every re-created function is called once.

### 9.3 Browser (Playwright, 375 px and 1280 px)

- Check availability and price: dates, free counts that fall after a seeded booking, a closed day, extras with included units, a coupon accepted and one refused with its reason, the returning-customer tick, the breakdown equal to the unit tests' figures; as staff, mechanic and driver.
- Extras tab and Settings › Extras; Settings › Coupons through create, use, switch off and archive; the returning-customer card; Booking rules; the unit page's bookings; Thai at phone width.
- Tests that change a shop's settings take turns and put them back, as D6's do.

### 9.4 Not truly testable in Phase 2

- "Uses per customer" and "returning customer" on real data: no customer or completed rental exists until Phase 3. Tested with the facts passed in.
- The states `out` and `returned`, and so the overdue rule, on a real pickup: hand-set rows only.
- The online path from a real page: there is no booking page (Phase 8) or `marketplace_api` (3M). It is exercised by calling `reserve()` with the service role.
- A race test shows a race is closed for the timings it hit, as the Phase 1a review noted.
- Server response time per page is recorded in PROGRESS for the new screens, on the deploy preview.

## 10. Questions for Mark

**Answered, 16 Nov 2026: Mark accepts every recommendation below, and all of §11.** Three come with an addition:

| # | Addition |
| --- | --- |
| **Q5** | Online channels reach `reserve()` only through one server entry point that calls `offer()` first. Stage 3 adds a test proving no booking-page or marketplace path can call `reserve()` without passing `bookable()` (§2.3, §9.1) |
| **Q11** | A coupon never reduces the deposit, and the total can't go below zero. Both are tests in stage 7 (§5.3, §9.1) |
| **Q14** | Weekday and weekend rules are not built. Stage 11 updates the spec's Phase 2 accept line: drop "weekend" and "both pricing modes" (§8, §12) |

The table is kept as it was asked; the "Recommended" column is now the decision.

| # | Question | Options | Recommended | Needed by |
| --- | --- | --- | --- | --- |
| **1** | **What does a booking write before orders exist?** | (a) A stock-side `reservations` table that Phase 3's order lines point at. (b) Thin `orders` and `order_lines` now, filled out in Phase 3. (c) Unit blocks only, with shortage and the Moto Mangos cap left to Phase 3 | **(a).** It means the same whichever way Phase 3 shapes rentals and billed periods, and (c) can't meet the shortage rule | Stage 1 |
| **2** | **Assigned units or a pool** (§5.3 item 1 of the redesign). With real units, a product can have one free at every moment and no single unit free for the whole rental | (a) Report the stricter answer; no re-packing. (b) Re-pack not-yet-collected bookings automatically | **(a) now**, measure fragmentation in stage 2, and re-pack nameless gear only if the numbers ask for it. 3M's search check must expect fewer free units than the pool rule in rare cases | Stage 1 |
| **3** | **Buffers between two rentals:** the gap is the first one's "after" plus the second one's "before". A scooter with 1 hour before and 2 hours after, returned 10:00: next pickup 13:00 | Confirm, or use the larger of the two | **Confirm** as designed | Stage 1 |
| **4** | **Who can overbook?** | (a) Staff only; online channels never create a shortage. (b) Every channel | **(a)**, shop-wide switch, off by default; a per-product limit later | Stage 2 |
| **5** | **Where are hours, closures, notice and minimum days enforced?** | (a) In `@mango/core` on the server, before `reserve()`; the database checks stock only. (b) Again in SQL inside `reserve()` | **(a).** One implementation; online callers can't reach `reserve()` except through the server | Stage 3 |
| **6** | **A bike still out past its end** | (a) Not offered to any new booking until checked in; later bookings on it stay and are flagged in Phase 3. (b) Blocks only a set time past its end | **(a)** | Stage 2 |
| **7** | **Coupon with the returning-customer discount** | (a) Not combined unless the coupon says so; otherwise the customer gets the larger. (b) Always both. (c) Never both, coupon wins | **(a)**, in the order seasons, returning, coupon, staff discount | Stage 7 |
| **8** | **What the returning-customer discount applies to, and who is "returning"** | Lines: rentals only, or everything. Returning: 1 completed rental at this shop, or the shop's own number | **Rental lines only** (vehicles and gear by time); **the shop's own number, default 1**; a percentage only | Stage 7 |
| **9** | **The tax amount on each line** | (a) The line's share of the invoice's VAT, adding up exactly; the invoice's figure is the one of record. (b) No line amount, as decision 27 reads | **(a)**: it gives your 15 Nov note and decision 27 both | Stage 4 |
| **10** | **A coupon's dates** | (a) "Valid" is when the booking is made, with an optional second range for the pickup date. (b) Pickup date only | **(a)** | Stage 7 |
| **11** | **A fixed coupon larger than what it applies to** | (a) Takes those lines to zero; the rest is lost. (b) Refused | **(a)** | Stage 7 |
| **12** | **Hold length** | A shop setting, 5 to 60 minutes, default 15 | **Default 15**, as the review decision's "10 to 15" | Stage 2 |
| **13** | **"What's included" defaults and deposit methods** (MAPPING lists them for Phase 2) | Build the columns now, or with what first reads them | **Later:** inclusions at 3M, deposit methods with payments (Phase 7) | Stage 3 |
| **14** | **Weekday or weekend price rules** (in the Phase 2 accept line; never asked for since, and BSR uses none) | Build now, or not | **Not now.** Seasons cover date ranges; say if a weekend rate is wanted | Stage 7 |
| **15** | **The Phase 1a review's "Before Phase 2" items** (§3.8) | One small PR inside Phase 2, or separately | **Inside Phase 2, stage 10** | Stage 10 |
| **16** | **Extras limits for staff** | `max_quantity` binds online only, or staff too | **Online only** | Stage 5 |
| **17** | **Staging** | Each migration to staging as its PR merges (as D4 and D6), or all six together at the end | **As each merges**, on your word each time, with the read-only counts before and after | Stage 1 |

## 11. Decided in this plan without asking (accepted by Mark, 16 Nov 2026)

- `reserve()` is all or nothing: one line that can't be booked refuses the whole call.
- A hold and a reservation use the same blocks; confirming changes the kind, not the row.
- Expired holds are released inside `reserve()` as well as by the scheduled sweep.
- A request-mode Moto Mangos booking that the shop has not accepted holds no unit; it counts against the request count only. Accepting it runs the allocation. (For 3M; the state is not written in Phase 2.)
- Buffers are copied onto a reservation when it is made.
- Best-fit ties go to the unit whose next block starts soonest after, then the lower lock key.
- Included extras hold stock like charged ones.
- A vehicle's own extras row beats the "every vehicle" row for the same extra.
- Everyone in a shop may read which extras go with a vehicle; coupons are read like prices (owner, manager, staff).
- A coupon code is unique in a shop, compared in upper case with spaces removed. One coupon per booking.
- Coupons can be created while "Accept coupons" is off; none is accepted until it is on.
- The coupon's amount is stored on its redemption as the quote gave it; the database does not recompute it.
- The snapshot is plain data with a version, amounts as strings of digits, and needs no migration in Phase 2.
- The read-only "Check availability and price" screen takes the New order tab; Phase 3 builds the order on it.
- Mechanics and drivers see free counts and bookings (dates, product, unit) with no money.
- `time.ts` and `money.ts` keep their names as wrappers for the marketplace until 3M.

## 12. Doc edits this plan will need (owner keeps the spec)

- `docs/platform/SPEC.md`: **Phase 2's accept line, changed in stage 11 on Mark's instruction** (drop "weekend" from the pricing tests and "in both pricing modes" from the never-falls check). The rest stays the owner's to work in: Data model (`allocations` → `reservations` and `unit_blocks`; `extras` → `product_extras`; `coupons` with its tables; the booking-rule columns on locations); the snapshot's field list under Pricing.
- Root `CLAUDE.md`: the lock order of §4, once stage 1 merges. `apps/platform/CLAUDE.md` still says the constraint is "on allocations/downtime".
- `docs/INTEGRATION.md`, at 3M, not now: free units by assigned unit (§4.3), the stricter notice (§4.6), extras availability, `discount` in `getQuote` from coupons.
- `docs/platform/MAPPING.md`: `shop_extras` → gear and service products plus `product_extras`; promotions as §5.3; the booking-rule columns marked built; inclusions and deposit methods moved to their later phases if Q13 is accepted.
- `docs/PROGRESS.md`: an entry per stage, and a line for this plan.
- Plan §7: Settings › Extras is readable by staff (History owner/manager only). Mark's decision, built in stage 6; §7's table still lists Settings › Extras for owners and managers alone.
- Plan §5.3 (this file), as built in stage 8: the code is stored normalised (a to z made A to Z, spaces and invisible characters removed, nothing else changed) and must be A to Z and 0 to 9 only; it is unique in the shop among coupons that are **not archived**, so an archived code can be used again; a redemption's `amount` may be 0; the currency lock counts a coupon with a fixed amount **or a minimum spend**; `reserve()`'s coupon is `{coupon_id, amount, customer_id}`.
- Plan §5.3 (this file): `coupons` gains `with_season_discount boolean` (default true), "Can be used on season discounts" (Mark, 18 Nov 2026; built into `decideDiscounts` in stage 7). When false, a line a season made cheaper is not eligible for the coupon; a season surcharge never rules a line out; with no eligible line left the code is refused as `not_these_products`. §5.3's table and "Deciding whether it applies" still lack it; stage 8 adds the column and stage 9 the form's tick. Also for §5.3: minimum spend is measured on the coupon's own lines, after seasons and before any discount (Mark, 18 Nov 2026).
