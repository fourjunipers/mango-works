# Phase 3 plan: orders and calendar

19 Nov 2026. **Draft for an independent Fable critique. Plan only: no code, no migration, nothing applied anywhere.** Written from `main` at `b9e0b33` (PR 50 merged; 66 migrations in the repo, staging at 66 of 66, live at 53 of 53). PR 51 (Phase 2 stage 10, migration `20261119000100_platform_review_followups`) is open and Phase 2 stage 11 is not built; this plan assumes both merge first (§0).

Read for this: `docs/platform/SPEC.md` (Data model, Orders and calendar, Staff app, Check-out and check-in, Long-term rentals, Payments, Built for any country, Review decisions, Products redesign and pricing, Build plan), `docs/INTEGRATION.md`, `docs/phase-2-plan.md`, `docs/products-redesign.md` §9.13, §9.17 to §9.19, `docs/PROGRESS.md` (every Phase 2 stage, its "For Phase 3" notes, and stage 10's "Found, not fixed" on PR 51's branch), the root `CLAUDE.md` lock order, and every platform migration from `20261109000100` to `20261118000100`.

## Summary

1. **Phase 2 built the stock side; Phase 3 builds the order around it.** `reservations` already holds "N units of one product at one place for one window", with holds, shortage, the overdue rule, the Moto Mangos cap and coupon uses, raced more than 1,000 rounds with no deadlock. Recommended (Q1): **keep it, and put orders on top of it** rather than replace it. `reservations.booking_id` becomes the order's id.
2. **An order holds rentals; a rental holds billed periods; each period is one order line** (§9.19 of the redesign, as already designed). A rental is one vehicle (always quantity 1, Q2) or one gear line, for one customer, over time. A swap ends one reservation and starts another inside the same rental.
3. **One stored status per rental and per order**, the order's derived from its rentals (mixed when they differ), every change written to `audit_events` by the function that makes it. Reverts are their own functions with their own role.
4. **Eight migrations, twelve build stages**, riskiest first (§8). The first stage fixes the "two bikes swapping models" deadlock found in stage 10, and states **one global lock order** that every Phase 3 function follows (§4). Six stages are Fable's (locks, RLS, money, availability), a seventh is Fable for its migration only; five are screens, reads or plumbing on Opus.
5. **Payments stay Phase 7, but their attachment points are fixed now:** a **charge** (one `quote()` call, one snapshot) is what a payment pays and what Phase 6 turns into a tax invoice; Phase 3 records cash and transfer against it in an append-only ledger (§6.4).
6. **The marketplace switch (3M) is designed here, built after** (§7). One real tension found: the Phase 2 rule that online bookings reach `reserve()` only through `bookOnline()` in `apps/platform/lib` can't hold for the marketplace app, which may not import from another app. Q15.

## 0. Starting point and dependencies

| What | State on 19 Nov 2026 | Phase 3 needs |
| --- | --- | --- |
| `reservations`, `reserve()`, `confirm_hold()`, `cancel_reservation()`, `assign_units()`, `move_unit()`, the hold sweep, `availability()`, `booking_inputs()` | Built, stages 1 to 3 and 8 | Unchanged in meaning; wrapped by order functions (§3.3) |
| `unit_blocks` and `unit_blocks_no_overlap` | Since Phase 1a; `reservation_id` since stage 1 | Unchanged. No `order_line_id` (Q1, §2.4) |
| Quote snapshot (`snapshotQuote`, `readSnapshot`, Phase 3's column list) | Built, stage 4, `@mango/core` only | Stored for the first time (§3.2) |
| Rental-period maths (`extensionPrice`, `swapAmounts`, `settleSwap`, `earlyReturn`, `carryDiscount`, `continuationPrice`) | Built, stage D3 | Called by stage 6's screens and stored by its functions |
| Coupons, `decideDiscounts`, `coupon_uses()`, redemptions | Built, stages 7 to 9 | `customer_id` sent for real; coupon swap on a held booking (§5) |
| `notification_outbox` (renewal kinds only, nothing sends) | Since Phase 1a | The sender, new kinds, the jobs (stage 9) |
| Stage 10 (PR 51): migration 6, the number rule, gates in tests | Open | Merged before stage 1. Its migration's functions are the bodies stage 1 reads |
| Stage 11: the read-only New order screen, Settings › Booking rules, demo seed | Not built | Merged before stage 8, which continues that screen into the order |

Nothing in Phase 3 starts before PR 51 merges: stage 1 re-creates trigger bodies and must read them from a database at `main` with migration 6 applied.

## 1. Scope

### 1.1 What Phase 3 delivers

From the spec's Phase 3 line, the review decisions and the notes carried to it:

- **Orders:** the order editor (New order and the order page), rentals, billed periods, extras and items for sale as lines, the status workflow with revert, allocations through the existing reservations, unit assignment and the shortage flag.
- **Views:** today board (the Dashboard's four tabs filled with orders), the order list with filters, the unit timeline (Gantt, drag to reassign or extend), the month calendar, and the Orders tab search.
- **Rental changes:** extend, swap a unit mid-rental, early return, overdue returns, and long rentals billed month to month, each period its own line.
- **The basic customer record** (review decision): name, contacts, nationality, language, notes. Phase 4 adds KYC.
- **The payments ledger with cash and transfer recording** (review decision), append-only and provider-neutral.
- **Jobs, the outbox sender and email** (review decision): end-of-rental email, the overdue alert schedule, and the renewal reminders queued since Phase 1a, sent by email.
- **Audit:** every order and rental status change, every price override and every revert, with who, when, from and to.
- **Carried notes** (§5): "Uses per customer" back on the coupon form and enforced; coupon swap on a held booking; the stage 10 deadlock; "Remove for good" for vehicles with bookings; retire instead of delete for a reserved service.

**Spec accept line:** full new → returned lifecycle in Playwright; drag-extend re-prices; an overlap is refused with a clear message. §9 adds the rest.

### 1.2 What Phase 3 leaves to later phases

| Phase | Left there | What Phase 3 leaves ready |
| --- | --- | --- |
| **1b** Fleet care | Maintenance jobs, service schedules, odometer log and alerts, keys, GPS, the full unit timeline (services, costs, renewals beside orders), profit per vehicle | The unit timeline component (stage 11) takes more row kinds; rental revenue per unit is readable from order lines (one line per vehicle period, Q2) |
| **4** Customers and KYC | Passport, licence and IDP with expiry, blacklist, privacy notice, document storage, access logging, retention purge, customer merge | `customers` exists with no document column; pickup runs through one check function (`pickup_blockers()`, §3.5) that Phase 4 adds "licence expired" to |
| **5** Check-out and check-in | QR scan flow, odometer and fuel, photos, damage diagram, signature and agreement PDF, comparison at return, damage charges | Pickup and return are one-tap state changes in Phase 3; `pickup_blockers()` gains "no signed agreement" and "no check-out inspection"; return keeps the return time Phase 5's inspection will record |
| **6** Documents and messages | Numbered tax invoices, receipts, credit notes, PDFs, LINE, template editor, the addendum for extensions and swaps | Each **charge** (§3.2) carries the frozen snapshot a document is made from; the outbox sender takes a LINE channel without a schema change |
| **7** Payments | Stripe Connect, cards, PromptPay, holds, saved cards, scheduled charges, payment links, refunds to a card, webhooks, `payment_accounts`, `webhook_events` | `payments` already has `provider` and `provider_ref`; balances, deposits and refunds are read off the ledger the same way; §6.4 lists the exact columns Phase 7 fills |
| **8** Online booking | The booking page, delivery, documents upload, the first real caller of `bookOnline()` | `bookOnline()` creates an order (stage 3) |
| **9** Long-term rentals | Open-ended rentals, recurring auto-charge, renewal reminders to customers, traffic fines | Month periods as lines with `due_at` (§6.3); an open-ended rental is a rental whose next period is added by an extension |
| **10** Reports | Sales history, cash close, utilisation, outstanding balances report | The ledger and lines are what they read; nothing to change |
| **11** SaaS | Custom roles, multi-location transfers (return to another place), platform admin | Return place = pickup place in Phase 3; `location_in` exists on the rental, constrained equal to `location_out` |
| **3M** Marketplace switch | `marketplace_api`, request mode, markets, the fee record, baht to minor units, dropping legacy tables | §7 |

Not in Phase 3 at all: charge rules (pickup-day, return-day, skipped weekdays: after Phase 3, before 3M), weekday price rules (not built, Phase 2 Q14), re-packing of gear units (Phase 2 Q2), the "every Nth period free" coupon kind (it needs period billing, which Phase 3 builds; the kind itself is a later decision).

## 2. From reservations and holds to orders

### 2.1 One model or two

Phase 2 deliberately kept stock and money apart: a reservation holds no price and no customer. Three ways to go on:

| Option | What it means | Cost |
| --- | --- | --- |
| **(a) Orders on top** (recommended, Q1) | New `orders`, `rentals`, `order_lines`, `order_charges`. A rental points at the reservation(s) that hold its stock. `reserve()` and its siblings keep their meaning and their tests | Two layers to keep in step; every order function also writes reservations, inside one transaction |
| (b) Fold reservations into order lines | One table that is both a billed line and a stock claim | Rewrites every Phase 2 function and its 1,000+ race rounds; a billed period and a block are not the same span (a block covers the rental's whole time on a bike, a line one month) |
| (c) Orders with no rental layer, lines point straight at reservations | Fewer tables | A swap needs a chain of reservations with nothing naming "this customer's bike for this stay"; the order page, mixed status and the Gantt must rebuild it each time |

**Recommendation (a).** The redesign already says "an order holds rentals, a rental holds billed periods" (§9.19), and Phase 2's §2.1 chose reservations precisely so Phase 3's shape could sit on top.

### 2.2 The shape

```text
orders            one per customer booking; status, channel, customer, totals cached
└─ rentals        one vehicle (quantity 1) or one gear line, for its own dates
   ├─ reservations   the stock: one, or several in a row after swaps (rental_id)
   │  └─ unit_blocks    allocation / hold per unit (unchanged)
   └─ order_lines    billed periods, extras, credits (rental_id), each in one charge
order_lines       also: items for sale and fees with no rental
order_charges     one quote() call: the snapshot, totals, rate groups; what is paid
payments          append-only ledger against the order (and a charge)
```

- **`booking_id` = `orders.id`.** A booking made by `reserve()` today has a random `booking_id`; from stage 2 every call goes through an order function that passes the order's id. Coupon redemptions already key on `booking_id`, so they become the order's with no change.
- **A vehicle rental is always one vehicle** (Q2). Two scooters for a week are two rentals in one order. This settles PROGRESS's "a vehicle line of more than one unit" note: a swap, an early return and a per-bike report never divide a line. The New order screen keeps a quantity stepper and makes N rentals.
- **A gear rental keeps a quantity** (3 helmets). Gear is returned whole in Phase 3; a part return splits the reservation as `move_unit()` already does (stage 5).
- **Extras with a vehicle** are their own rentals with `parent_rental_id`, matching `reservations.parent_id`. Their periods follow the parent's: extending a scooter extends its helmets in the same call.
- **Services** have a rental and a reservation and no block (as Phase 2). **Items for sale** have a line and no rental; their stock moves in `stock_movements` (§3.4).

### 2.3 The status machine

Two levels, both stored, both audited:

**Rental status:** `draft` (no stock), `held`, `reserved`, `out`, `returned`, `canceled`. It moves with its current reservation's state (`held`, `reserved`, `out`, `returned`, `cancelled`, `expired`) except where noted; a rental with no reservation is `draft`.

**Order status**, derived from its non-canceled rentals by one SQL function and stored (for filters and audit):

| Order status | When |
| --- | --- |
| `new` | Being made: at least one rental `held`, none `reserved` or later. The staff New order flow and an online checkout in progress |
| `draft` | Saved, holds nothing: every rental `draft`. Spec: "draft holds nothing" |
| `reserved` | Every rental `reserved` |
| `picked_up` | Every rental `out` |
| `returned` | Every rental `returned` |
| `mixed` | Rentals in more than one of `reserved`, `out`, `returned` (partial pickup or return) |
| `archived` | Set from `returned` when the balance is 0 and no deposit is held (Q12) |
| `canceled` | Every rental canceled, or the order canceled whole |

An order with only items for sale has no rentals: it goes `draft` or `reserved` → `picked_up` ("handed over") → `archived`, with no `returned` step. The derivation reads its sale lines' hand-over instead of rentals (stage 3 tests it).

**Transitions** (each is one function; who may call it is §3.9):

| From → to | Function | Rule |
| --- | --- | --- |
| (none) → `new` | `create_order` with hold | Holds expire after `tenants.hold_minutes` |
| (none) or `draft` → `reserved` | `create_order` / `reserve_order` | Through the reserve core: availability, cap, coupon, shortage |
| `new` → `reserved` | `confirm_order` | Wraps `confirm_hold()`; refused once expired |
| `new` → (hold ran out) | the expiry job (§3.6) | Staff order → `draft` (lines kept, stock gone); online order → `canceled` with reason `expired` (Q5) |
| `reserved` → `out` (rental) | `pick_up` | `pickup_blockers()` empty (§3.5): a unit on every vehicle rental, no shortage, a customer. Phases 4 and 5 add theirs |
| `out` → `returned` (rental) | `return_rental` | Records the return time; the block's end moves (§2.6) |
| `reserved`/`new`/`draft` → `canceled` | `cancel_order` / `cancel_rental` | `cancelled_by` (customer, shop), `no_show` when pickup time has passed; coupon use given back when nothing is left |
| `returned` → `archived` | `archive_order` and the nightly job | Q12 |
| **Reverts** | | |
| `out` → `reserved` | `revert_pickup` | Block unchanged; sale items' stock put back |
| `returned` → `out` | `revert_return` | The block's end goes back to the rental's end plus buffer; refused `unit_taken` if the unit was booked in the freed time since |
| `reserved` → `draft` | `unreserve_order` | Blocks released; lines and prices kept |
| `canceled` → `draft` | `restore_order` | Lines kept; no stock until reserved again |
| `archived` → `returned` | `unarchive_order` | |

No revert crosses two steps (`returned` → `reserved` is two reverts, each audited). `picked_up` can never go straight to `canceled`: a bike that left must come back.

### 2.4 Allocations and the exclusion constraint

- **No new lock table and no new constraint.** Every unit claim is still a `unit_blocks` row of kind `allocation` or `hold` with a `reservation_id`; `unit_blocks_no_overlap` has the last word.
- **No `order_line_id` on blocks.** The redesign planned one; Phase 2 replaced it with `reservation_id` (Phase 2 plan §2.1). A block spans the rental's whole time on one bike; billed periods are money and change without moving a block. This plan keeps that.
- **Nothing but the order functions writes an allocation or a hold.** `reserve()`, `confirm_hold()`, `cancel_reservation()` and `assign_units()` lose their grant to `authenticated` (Q10) and become the internal core the order functions call, so no reservation exists without an order. `move_unit()` keeps its grant (it changes a unit, not an order) and moves rentals' reservations as today.

### 2.5 Unit assignment

- **Assigned at once** (review decision, built): the reserve core picks best fit. Staff can name units in New order.
- **Changed before pickup** through `assign_units()` (existing): from the order page ("Change vehicle") and by dragging a bar to another row on the Gantt.
- **Confirmed at pickup:** Phase 3 shows the plate and asks staff to confirm it is the bike handed over; picking a different free unit of the same product at that moment is an `assign_units()` call in the same transaction as `pick_up` (Phase 5 replaces this with the QR scan).
- **Changed mid-rental** only by a swap (§6.2), never by `assign_units()` (it refuses a rental that is `out`, as today).

### 2.6 Shortages, overbooking and bookings at risk

- **Shortage** is Phase 2's: with "Allow overbooking" on, staff can save a rental short of units; `shortage_demand` keeps later bookings off the units it waits for; `assign_units()` fills it. Phase 3 shows it on the order, the list filter, the today board and the Gantt (an "unassigned" lane per product).
- **At risk** (spec's extended shortage, decided 11 Nov): a reserved rental whose unit has since gone into maintenance, been marked lost, or is still out on an overdue rental. Nothing writes this; a read (`bookings_at_risk()`) finds them. **No automatic moves** (Q9): staff reassign. Selling or retiring a unit with future blocks is still refused by `units_guard`.
- **Overdue rentals keep blocking** (Phase 2 §3.5): the unit is not free for any new booking until it is returned. Phase 3 adds the Late tab, the alert schedule (§3.6) and "at risk" on the next booking.
- **A late return can't fail.** Returning an overdue bike sets the block's end to the later of its booked end and the return time plus the after-buffer, **clipped at the start of the unit's next block** so the exclusion constraint never refuses a return; the clipped buffer is shown on the next booking as "at risk: turnaround short" (Q7).
- **Overbooking stays staff-only** (Phase 2 Q4); online channels never create a shortage.

## 3. Data model

All in the `platform` schema. Every table: `tenant_id`, parents by `(tenant_id, id)`, RLS in the set form through the `my_tenant_ids()` helpers (root `CLAUDE.md`, "Not tied to Supabase"), grants written on purpose (`service_role` too), `set_updated_at`, audit, a fixture row per tenant in the isolation tests. Every function starts with `revoke all ... from public, anon`. **Nobody signed in writes any of these tables directly**: functions only.

### 3.1 Customers (basic)

```text
customers
  id, tenant_id
  full_name            text, 1..200
  phone                text, E.164 when given ("+66812345678"); free text kept beside it if not parseable
  email                citext
  line_id              text
  nationality          ISO 3166-1 alpha-2, optional
  language             BCP 47, optional (the language their messages go in; else the shop's)
  notes                text
  marketplace_account_id   uuid, optional, unique per tenant: the Moto Mangos account (3M)
  completed_rentals    int, kept by return_rental / revert_return (for the returning discount)
  archived_at
```

- Owner, manager and staff read and write (through `save_customer()`). Mechanic and driver: none in Phase 3 (Phase 8 gives drivers their deliveries' contacts).
- Phone and email are **never copied into audit snapshots** (review decision, "before Phase 4"): the audit trigger records `changed` for them. Stage 2 builds that exclusion, not Phase 4, because Phase 3 is when they first exist.
- No documents, no blacklist, no deposit waiver: Phase 4.

### 3.2 Orders, rentals, lines and charges

```text
orders
  id (= reservations.booking_id), tenant_id
  number               bigint, per tenant, from order_counters (gaps allowed, Q11)
  code                 6 characters, no 0/O/1/I, unique per tenant (INTEGRATION §3.12)
  customer_id          optional while new or draft; required to pick up (§3.5) and for any online order
  status               new | draft | reserved | picked_up | returned | mixed | archived | canceled
  channel              walk_in | phone | booking_page | marketplace | api
  mode                 staff | instant | request | now  (as reservations)
  request_status       pending | accepted | declined | expired  (3M; null otherwise)
  cancelled_by         customer | shop | system, null
  cancel_reason        text
  no_show              boolean
  location_id          the pickup place (one place per order in Phase 3)
  starts_at, ends_at   cached: earliest rental start, latest rental end
  currency             the shop's, copied
  -- cached sums, kept by the functions that write lines, charges and payments
  total, paid, refunded, balance, deposit_due, deposit_held      bigint minor units
  has_shortage, at_risk     maintained flags for the list filter (at_risk refreshed by the board read)
  notes                internal
  created_by           auth.uid() in the database
  archived_at, canceled_at
rentals
  id, tenant_id, order_id
  parent_rental_id     an extra's vehicle rental
  product_id, product_type
  quantity             1 for vehicles (check), 1..1000 for gear and services
  location_out, location_in   equal in Phase 3 (check)
  starts_at, ends_at   the rental as booked; extended by extensions
  status               draft | held | reserved | out | returned | canceled
  picked_up_at, returned_at, picked_up_by, returned_by
  current_reservation_id
reservations (existing) gains
  rental_id            (tenant_id, rental_id) → rentals, required for every row written from stage 2
order_charges
  id, tenant_id, order_id
  kind                 booking | extension | swap | early_return | adjustment | late_return
  currency, priced_at
  subtotal, discount_total, tax_total, total, deposit     bigint
  rate_groups          jsonb (rate, profile names, base, net, VAT, gross, style)
  snapshot             jsonb (Phase 2 §5.4 invoice snapshot, versioned)
  due_at               when it should be paid (pickup, or the period's start; Phase 7's scheduled charge reads it)
  status               open | settled | void
order_lines
  id, tenant_id, order_id, charge_id, rental_id (null for sale items and fees)
  kind                 period | extra | sale_item | fee | credit | manual
  product_id, product_type
  period_start, period_end      for period and extra lines
  quantity, included_quantity, charged_quantity
  -- Phase 2 §5.4 "Phase 3's columns, fixed now"
  list_price, season_total, discount_total, amount,
  tax_rate_bp, tax_profile_id, tax_profile_name, tax_inclusive, tax_amount,
  deposit, currency, snapshot jsonb
  override_reason, override_by     when staff changed the charged price
  note                 the line's own text ("1 Jan to 1 Feb 2027 · Honda Click 125i · 1กข 1234")
  position             the stored order of the charge's lines (never re-sorted: PROGRESS stage 4)
order_counters
  tenant_id primary key, next_number
```

- **One charge is one `quote()` call** and one stored snapshot. The first booking is one charge; each extension, swap, early return or late return is its own. A charge is what a payment pays (§6.4), what Phase 6 issues a tax invoice from (decision 27: one invoice per payment), and never changes after it is stored, except `status`.
- **The save check** (Phase 2 §5.4): the charge function checks the snapshot's shape and that its lines add up to its totals, by addition and comparison only, plus the cross-field checks `readSnapshot()` leaves to Phase 3 (PROGRESS stage 4: currency and exponent match, parent line on the invoice, `end` after `start`, unique ids, bounded `percent_bp` and basis counts). The "no pricing function multiplies, divides or rounds" test still holds.
- **Lines are never re-priced.** An extension adds a charge; a swap closes a period (its `period_end` moves; its amounts don't) and adds one.
- **A draft order** stores lines and a charge too (so the customer can be told a price), with charge `status = void` until reserved; reserving re-quotes if the draft is older than its prices (`priced_at` older than the last pricing change for those products; §11.1).

### 3.3 The order functions

All `security definer`, role checked inside with `booking_roles(action)`, `lock_timeout = '6s'`, answering `{ok, ...}` or `{ok: false, reason}` and writing nothing on refusal. The **reserve core** is today's `reserve()` body moved to `platform_private.reserve_core(tenant, request)`, which takes the order and rental ids from its caller; `platform.reserve()` stays as a thin wrapper for the tests of stages 1 to 8 and loses its `authenticated` grant (Q10).

| Function | Does | Migration |
| --- | --- | --- |
| `create_order(tenant, order)` | Customer (existing or new), rentals, lines and charge from the client's quote, then the reserve core in `hold`, `reserve` or `draft` mode; coupon with `customer_id` | 2 |
| `save_order(tenant, order_id, changes)` | Draft or new: customer, notes, rentals added or removed, dates, quantities, the coupon (§5.2), the charge replaced | 4 |
| `reserve_order` / `confirm_order` / `unreserve_order` | Draft → reserved; new → reserved; reserved → draft | 2, 4 |
| `cancel_order`, `cancel_rental`, `restore_order` | §2.3 | 2, 4 |
| `pick_up(tenant, order_id, rentals[], unit_confirmations)` | Rentals → out; sale items handed over; `pickup_blockers()` checked under the locks | 3 |
| `return_rental(tenant, order_id, rentals[], returned_at, late_charge?)` | Rentals → returned; block end per §2.6; `completed_rentals` + 1 once the order's last vehicle is back | 3 |
| `revert_pickup`, `revert_return`, `archive_order`, `unarchive_order` | §2.3 | 3 |
| `change_rental_dates(tenant, rental_id, start, end)` | Before pickup: re-reserves the same units if free, else picks again; new charge or replaced draft charge | 4 |
| `extend_rental`, `swap_rental_unit`, `return_early` | §6 | 5 |
| `record_payment`, `record_refund`, `record_deposit` | §6.4 | 6 |
| `save_customer` | §3.1 | 2 |
| `bookings_at_risk`, `today_board`, `order_list` | Reads, run as the caller under RLS | 3, 7 |

### 3.4 Items for sale

A `sale_item` line takes stock when the order is **handed over** (pick_up), as a `stock_movements` row `sold`, and puts it back (`returned`) on `revert_pickup` or a refund of the line. The `stock_movements_guard` trigger takes the product-and-location advisory lock inside the insert, so **every order function that writes a movement takes that lock in step 1 with the rest** (otherwise a trigger would take an advisory lock after row locks: §4). Reserving a sale item holds nothing (Phase 2 §3.1: an item for sale is sold, not reserved); stock can therefore run out between booking and hand-over, and `pick_up` refuses `stock_below_zero` with the line named.

### 3.5 What pickup checks

`platform_private.pickup_blockers(order, rentals)` returns a list, empty to go:

- a vehicle rental with no unit, or any shortage;
- a unit that is not `active` (in repair, lost);
- a unit still out on another rental (overdue);
- the order has no customer;
- Phase 4 adds: licence or passport expired, licence class; Phase 5: no signed agreement, no check-out inspection.

Staff see each blocker in words. None can be overridden in Phase 3; Phase 4 will define a manager override for document expiry (spec: "unless a manager overrides with a reason").

### 3.6 Jobs, outbox and email

- `notification_outbox.kind` gains `end_of_rental`, `overdue_staff`, `overdue_customer`, `order_confirmed`, `order_canceled`; `channel` (`email`; `line` in Phase 6) and `recipient` columns. Rows still hold facts, never text; the sender words them per language.
- **Settings** (owner, manager): `overdue_alert_days int[]` (default `{1,3,15,30}`, spec), `overdue_customer_days int[]` (default empty: optional), `end_of_rental_email boolean` (default on). On `tenants`.
- **Jobs**, one entry point each, run every few minutes: `queue_due_messages()` (end of rental, overdue thresholds crossed, renewal reminders as today), `close_expired_new_orders()` (§2.3), `archive_settled_orders()` (nightly, Q12). Each is idempotent through the outbox's `(tenant_id, dedupe_key)` and takes order rows `for no key update skip locked` only.
- **The sender** is a server-side job in `apps/platform` (Netlify scheduled function), reading `queued` rows, sending through Resend, marking `sent`/`failed` with a retry count. It never runs in the database. Using `pg_cron` only to queue (as the hold sweep does) and an app-side sender keeps the Neon move (root `CLAUDE.md`) to "replace the cron trigger".
- The overdue alert lists the customer's phone and the plate; the GPS tracker ID is added in Phase 1b when trackers exist. The "follow-up task" is the Late tab item itself, with a "Contacted" note and who added it; it leaves the tab when the bike is back.

### 3.7 Columns elsewhere

- `pricing_settings`: the swap and early-return settings of §9.19 (options offered, default option, "keep the customer's discount" default, allowed outcomes for a cheaper bike or unused time: credit, refund, no charge).
- `units.removed_at` (Remove for good, PROGRESS 12 Nov): a removed vehicle is never shown or bookable, keeps its row for past orders, frees its plate. Every unit read and the free-units rule leave removed ones out. Stage 12 (§11.1).
- `products`: none. A reserved service can't be deleted; the app offers Retire instead (PROGRESS stage 1).

### 3.8 Every migration, in order

Names follow the repo rule; timestamps when written. Re-created functions are their bodies read from the database (`pg_get_functiondef`) behind an MD5 guard, as stages 8 and 10 did.

| # | Name | Stage | What it does |
| --- | --- | --- | --- |
| 1 | `platform_product_lock_order` | 1 | `units_product_not_retired` takes the old and new product rows together, in id order, `for no key update`, so `units_clamp_product_counts`'s later lock on the old row is re-entrant; `review_catalog_request` locks its products before its catalog entry (§4.3) |
| 2 | `platform_orders` | 2 | `customers`, `orders`, `rentals`, `order_charges`, `order_lines`, `order_counters`; `reservations.rental_id`; `reserve_core()`; `create_order`, `reserve_order`, `confirm_order`, `cancel_order`, `save_customer`; `booking_roles` gains order actions; coupon redemption takes the real `customer_id`; `reserve()` and siblings revoked from `authenticated`; audit excludes customer contact fields |
| 3 | `platform_order_status` | 3 | `pick_up`, `return_rental`, the reverts, `archive_order`, `pickup_blockers`, `bookings_at_risk`, `today_board`; stock movements for sale items; `completed_rentals` |
| 4 | `platform_order_edits` | 4 | `save_order`, `change_rental_dates`, `unreserve_order`, `cancel_rental`, `restore_order`, the coupon swap on a held booking (§5.2), price override columns and check |
| 5 | `platform_rental_changes` | 5 | `extend_rental`, `swap_rental_unit`, `return_early`; the swap settings on `pricing_settings`; credit lines; month periods |
| 6 | `platform_payments_ledger` | 6 | `payments` (append-only), `record_payment`, `record_refund`, `record_deposit`, the cached balance; the currency lock counts payments |
| 7 | `platform_order_jobs` | 9 | Outbox kinds and columns, overdue settings, `queue_due_messages`, `close_expired_new_orders`, `archive_settled_orders`, their schedules |
| 8 | `platform_remove_for_good` | 12 | `units.removed_at`, the reads and the free-units rule re-created, `remove_unit_for_good()` |

Item for 3M, not Phase 3: `marketplace_api` schema, markets, the fee record, request mode (§7).

### 3.9 Who may do what, and RLS

Enforced in the database by RLS and by `platform_private.booking_roles(action)` (new actions beside today's `read`, `reserve`, `cancel`, `confirm`, `assign`), with its copy in `apps/platform/lib/booking-permissions.ts` and the test that compares them.

| Action | Owner | Manager | Staff | Mechanic | Driver |
| --- | --- | --- | --- | --- | --- |
| See reservations and blocks (dates, product, unit; no money, no customer) | Yes | Yes | Yes | Yes | Yes |
| See orders, rentals, customers (contacts) | Yes | Yes | Yes | No | No (Phase 8: its own deliveries) |
| See lines, charges, payments, balances | Yes | Yes | Yes | No | No |
| Create, edit, reserve, confirm, cancel an order; customers | Yes | Yes | Yes | No | No |
| Pick up, return, extend, swap, return early | Yes | Yes | Yes | No | No |
| Change a charged price (with a reason) | Yes | Yes | Yes (Q6) | No | No |
| Revert a status; archive and unarchive | Yes | Yes | No (Q6) | No | No |
| Record a payment or a cash deposit | Yes | Yes | Yes | No | No |
| Record a refund or a deposit returned | Yes | Yes | No (Q6) | No | No |
| Settings › Orders (alerts, swap options, archive days) | Yes | Yes | No | No | No |

| Table | Select | Write |
| --- | --- | --- |
| `customers`, `orders`, `rentals` | `booking_roles('order_read')` | Functions only |
| `order_lines`, `order_charges`, `payments`, `payment_allocations` | `pricing_roles('read')` (owner, manager, staff) | Functions only; `payments` refuses update and delete by trigger for every role |
| `order_counters` | Nobody signed in | Functions only |
| `reservations`, `unit_blocks` | As today (every member) | As today |

- The Today board and the Gantt read through `security definer` functions that return, for mechanics and drivers, the booking's dates and unit with no customer and no money (each with its own cross-tenant test).
- The service role may call the order functions only for `booking_page`, `marketplace` and `api`; a signed-in member only for `walk_in` and `phone` (as `reserve()` today).
- Every new table ships with a fixture row per tenant and the cross-tenant read, insert, update and delete tests; `default-grants.test.ts` covers every new table and function.

## 4. Lock order

### 4.1 The swap deadlock (stage 10, PR 51, "Found, not fixed")

Moving bike A from product X to Y: `units_product_not_retired` (before trigger) locks the **new** product Y `for share`; then `units_clamp_product_counts` (after trigger) locks the **old** product X `for no key update`. Bike B moving Y → X takes X shared, then Y. The two moves deadlock when they interleave. Phase 3 makes this worse if left: the order functions add product row locks to many more transactions.

**Fix (stage 1):** the before trigger, when the product changes, locks **both** product rows, `old` and `new`, **in id order, `for no key update`** (the strongest either trigger needs), so the after trigger's lock is already held. The test moves to a gate (both sessions released at the same instant) and must fail against the old triggers and pass against the new, with Postgres' deadlock count unchanged.

**The rule it becomes, for every Phase 3 function:** a transaction takes **all the product rows it will need at once, in id order, at the strongest strength it will need**. Raising a row's lock later (share → no key update) is how this deadlock happened; it is banned, and stage 1 adds a test helper that fails a race test if `pg_locks` ever shows a transaction waiting to upgrade a product row lock.

### 4.2 One global order for Phase 3

Every function or trigger that takes more than one lock takes them in this order. Each class is taken in its own sort order; a function skips classes it doesn't need, but never goes back to an earlier class.

1. **Product-and-location advisory locks** (`1a02`), sorted by key, for every product the call touches: its rentals' products, the old and new product of a swap, extras' products, and **items for sale it moves stock for**.
2. **Unit advisory locks** (`1a01`), sorted by key: every unit whose blocks it writes or reads to decide.
3. **Rows**, always after every advisory lock, in this class order:
   1. **unit rows**, `for key share`, in id order (anything stronger: `nowait`, answering `try_again`; root `CLAUDE.md`);
   2. **product rows**, in id order, at the strongest strength the transaction needs (§4.1);
   3. **listing rows** (Moto Mangos), in product-id order, `for no key update`;
   4. **coupon rows**, in id order, `for update` (a coupon swap takes both, §5.2);
   5. **customer rows**, in id order, `for no key update` (only when a function changes a customer: `completed_rentals`, a marketplace customer upsert);
   6. **order rows**, in id order, `for no key update`;
   7. **rental rows** of those orders, in id order;
   8. **reservations**, then **unit_blocks** (as today);
   9. **charges, lines, payments, coupon redemptions, stock movements, outbox rows** — inserts and updates of rows that belong to an order already locked in 6;
   10. **`order_counters`**, last (a new order's number), so a transaction holding it waits for nothing.

The hold sweep and the order jobs fit inside this: the sweep takes product locks, then reservations and blocks (it touches no order row); `close_expired_new_orders` and `archive_settled_orders` take only order rows (class 6), `skip locked`.

Root `CLAUDE.md`'s "Lock order" section is rewritten to this list in stage 2, with the existing notes (unit delete, guards, listings, coupons, timeouts) kept beneath it.

### 4.3 Who takes what

| Writer | 1 Product locks | 2 Unit locks | 3 Rows |
| --- | --- | --- | --- |
| `create_order`, `reserve_order`, `confirm_order` | All rentals' products, sorted | Picked/named units | units, products `for share`, listings (MM), coupon, customer (new: insert only), orders (insert), rentals, reservations, blocks, lines, charge, redemption, counter |
| `save_order`, `change_rental_dates` | Old and new products, sorted | Old and new units | units, products, coupons (both, §5.2), order, rentals, reservations, blocks, lines, charge, redemptions |
| `cancel_order`, `cancel_rental`, `unreserve_order` | The order's products | Its units | coupon, order, rentals, reservations, blocks, redemption |
| `pick_up` | Its products **and its sale items'** | Units confirmed or changed at pickup | units, products, order, rentals, reservations, blocks (if a unit changes), stock movements |
| `return_rental`, `revert_return` | Its products | Its units | units, customer (`completed_rentals`), order, rentals, reservations, blocks |
| `revert_pickup` | Its products and sale items' | None | order, rentals, reservations, stock movements |
| `extend_rental` | The rental's product and its extras' | Its units | units, products, order, rentals, reservations, blocks (period lengthened), lines, charge |
| `swap_rental_unit` | Old and new products, sorted | Old and new unit, sorted | units, products, order, rental, reservations (old closed, new inserted), blocks (old shortened, new inserted), lines, charge |
| `return_early` | The rental's product (and extras') | Its units | units, order, rental, reservations, blocks (shortened), lines, charge, customer |
| `record_payment` / `refund` / `deposit` | None | None | order, payments |
| `assign_units` (existing, now called for orders) | As today | As today | as today, then order (flags) |
| `move_unit` (existing) | As today | As today | as today; it never locks an order row (rentals keep their ids; only reservations move) |
| Unit status, delete, downtime (existing) | As today | As today | As today |
| `units_product_not_retired` + `units_clamp_product_counts` (after stage 1) | None | One unit (the guard) | unit row, both products in id order `for no key update`, listing |
| `review_catalog_request` (after stage 1) | None | None | its products in id order, then the catalog entry (was: entry first; PROGRESS 14 Nov) |
| Jobs | None | None | order rows `skip locked`; outbox inserts |

### 4.4 Backstops

- `lock_timeout = '6s'` on every function that waits for these locks; callers answer `try_again` for `55P03`, `57014` and `40P01` (`lib/try-again.ts`).
- Every race test reads `pg_stat_database.deadlocks` before and after and fails on any increase (as stages 1 to 10).
- A database test lists every `platform` function that calls `pg_advisory_xact_lock` or `for update`/`for share`/`for no key update` and fails on one not in a reviewed list, so a new writer can't appear without a lock-order review.

## 5. Notes carried from Phase 2

### 5.1 "Uses per customer"

- `max_uses_per_customer` is counted under the coupon's row by `coupon_uses()` already; from stage 2 every order function sends the order's `customer_id` (staff: the chosen customer; online: the server-side customer, never the browser's: PROGRESS stage 8, "For Phase 8").
- `decideDiscounts()` gets `usesByCustomer` and `completedRentals` from a server read of the customer, not from the form.
- **A coupon on a new or draft order with no customer yet**: a per-customer limit can't be judged, so the code is refused `customer_needed` until a customer is chosen (new refusal reason, stage 2, `@mango/core` and SQL).
- The **coupon form** gets "Uses per customer" back in stage 12, and the returning-customer discount runs on `customers.completed_rentals` (a rental "completed" = returned, not canceled; counted per order, Phase 2 Q8: the shop's number, default 1).
- `coupon_redemptions.customer_id` gains its foreign key to `customers` (on delete set null).

### 5.2 Swapping the coupon on a held booking

A staff member changes the code on a `new` (held) or `draft` order, or removes it, or the customer is changed (which changes the per-customer count):

1. Prices are worked out first, outside the transaction (`decideDiscounts`, `quote()`), as every booking.
2. Under the order's product locks (step 1), **both coupon rows, old and new, `for update`, in id order** (class 3.4).
3. **The old use is given back first** (`released_at`), then the new coupon's uses are counted under its row and its redemption written. Giving back first lets a coupon be swapped for itself (a changed amount) and keeps "a use is only ever added under the coupon's row".
4. The order's charge is replaced (draft) or a new booking charge is stored and the old voided (`new`).
5. A refused new coupon (`coupon_used_up`, `coupon_not_valid`, `customer_needed`) leaves the old use and the old charge exactly as they were.

Tests: swap A → B while another booking takes B's last use (one succeeds); swap A → B against a booking swapping B → A (no deadlock: both take A and B in id order); swap to the same coupon; a hold that expires during the swap (refused `hold_expired`, nothing changed).

### 5.3 The other Phase 3 notes in PROGRESS

| Note (PROGRESS stage) | Plan |
| --- | --- |
| A held booking whose coupon was archived since is priced again as `not_active` (8) | A `new` order keeps its stored charge until saved again; saving re-decides and the archived coupon is refused with words: "This coupon was switched off since". Draft the same |
| A stacking coupon with a credit throws `credit_exceeds_base` (8, 10) | Credits appear in Phase 3 (swaps). `decideDiscounts` gets a third way: with stacking on and a credit, price with the credit first and cap the coupon at what is left; if still refused, the coupon is not applied (`applied: false`, `because: "credit_covers_it"`). Core change, stage 5 (Fable) |
| An extension judged on the rental's own pickup and length (7) | `decideDiscounts` reads `rentalStart ?? span.start` and days from the original pickup (Mark's lean, to confirm: Q13) |
| A refund's credit note needs VAT figures of its own (4) | `@mango/core` gains `refundVat(charge, amount)`: VAT on the refunded amount by rate group, rounded once. Stored on the refund's ledger row and charge. Stage 5 (Fable). Phase 6 prints it |
| An early return's outcome is stored when it happens, never recomputed (4) | `order_charges` of kind `early_return` stores the return time, the period's list price, used and unused parts, money carried and the outcome |
| Lines never re-sorted; tax shares never recomputed (4) | `order_lines.position`; no function updates amounts after insert (a test) |
| Cross-field checks `readSnapshot()` doesn't make (4) | In the charge save check (§3.2) |
| `pricing_inputs()` lacked tax profile id and product name (4) | Check after stage 5 of Phase 2 re-created it; if still missing, the order's caller reads them (stage 2) |
| An extra's reservation does not follow its vehicle to another place (2, 5) | Phase 3 orders have one place; `move_unit` to another place moves the vehicle's reservation and **the order page flags the extras left behind** (at risk). Moving them is a Phase 11 transfer |
| An overdue rental stays on the old product after `move_unit` (2) | Kept; the Gantt draws the overdue bar on the unit's row wherever it is |
| A product that was ever reserved can't be deleted; offer Retire for services (1) | Stage 12, screen only |
| Deleting a vehicle that has bookings: "Remove for good" (12 Nov) | Migration 8, stage 12 |
| An order from Moto Mangos stores how it was made (C) | `orders.mode` (already on reservations) |
| Moto Mangos category and type of a multi-category model (12 Nov) | 3M (§7) |
| Every Nth period free (7) | Not built; period billing makes it possible later |
| A booking cancelled in part keeps the coupon and its stored amount (8) | `cancel_rental` re-quotes what is left as an adjustment charge (credit) when the coupon's lines change; the redemption amount is updated in the same transaction under the coupon row |
| Two bikes swapping models deadlock (10, PR 51) | Stage 1 (§4.1) |
| `review_catalog_request` vs a product delete can deadlock (14 Nov) | Stage 1 (§4.3) |
| Channel picker in Check a price (9, 10) | Stage 11 of Phase 2; New order has the channel built in (staff: walk-in or phone) |

## 6. Rental changes, long rentals, and where payments attach

All the money is worked out in `@mango/core` before the transaction (as every price); the database function checks lines add up and stores them. Each change is one function and one transaction: it either changes the stock, the lines and the charge together, or nothing.

### 6.1 Extend

`extend_rental(rental, new_end, charge)`: the same unit (and extras' units) must be free from the old end to the new end plus buffer. The block's period is updated in place (`unit_blocks_guard` takes the unit lock; the exclusion constraint checks). New charge `extension` with one period line per vehicle and extra, priced by `extensionPrice` with "keep the last period's discount" (decision 26/28). Refused `unit_taken` with the conflicting booking's number, so staff can swap instead (the screen offers it).

Drag-extend on the Gantt calls the same function after a confirm sheet that shows the new price (accept test: "drag-extend re-prices").

### 6.2 Swap a unit mid-rental

`swap_rental_unit(rental, new_unit, at, option, charge)`, on a rental that is `out` (§9.19 of the redesign): old reservation closed at `at` (state `returned`, block shortened to `at` + after-buffer, clipped as §2.6), new reservation for the new unit to the rental's end, old period line's `period_end` set to `at`, new period line plus the credit line, all in one charge `swap`. Pricing options (remainder, prorated, no charge, manual with reason) and the cheaper-bike outcome (credit, refund, no charge) come from `pricing_settings`. The deposit difference is shown as a top-up or release, never moved (decision 28). A swap whose new unit is taken leaves the old bike held and nothing changed.

Before pickup a "swap" is just `assign_units()` (no money).

### 6.3 Early return, late return and month-to-month rentals

- **Early return** = a swap to nothing: block shortened, period closed, charge `early_return` with the unused part as credit, refund or nothing (shop settings). A refund is a ledger row (§6.4) with its VAT from `refundVat`.
- **Late return** (Q8): `return_rental` after `ends_at` offers "Charge the extra time", default on: an extension charge from the old end to the return time (`extensionPrice`), which staff may waive with a reason (the charge is then stored at 0 with the reason, so the waiver is audited).
- **Month-to-month** (redesign §9.18): a rental over 30 days is split at booking into periods date to date from the pickup: one line per month, the last line the leftover days. Each line is priced as a continuation (`rentalStart` = pickup), which telescopes: the periods add up to the whole rental's price to the minor unit (a test). **Each period is its own charge** (Q3), with `due_at` = the period's start, so each month is invoiced and paid on its own. Extras follow the same periods.
- **Open-ended** rentals are Phase 9; in Phase 3 a long rental has an end and is extended a period at a time.

### 6.4 The ledger and where Phase 7 attaches

```text
payments  (append-only: no update, no delete, a correction is a new row)
  id, tenant_id, order_id, charge_id (optional: a payment may cover several, see below)
  kind        payment | refund | deposit_in | deposit_out | deposit_capture
  method      cash | transfer | card_manual | other      (Phase 7 adds card, promptpay)
  amount      bigint > 0, currency
  vat_amount  for a refund: from refundVat (credit note in Phase 6)
  provider, provider_ref     null for offline; Phase 7: 'stripe', the PaymentIntent / Refund id
  receipt_ref               a stored file (transfer slip), through the storage module
  received_at, recorded_by, note
payment_allocations
  payment_id, charge_id, amount     which charges a payment paid (one payment, many charges)
```

- **Balance** = Σ open charges' totals − Σ payments allocated + Σ refunds, cached on `orders` by the functions that write either.
- **Deposits** are outside revenue (spec): `deposit_in`/`deposit_out` rows, `orders.deposit_held` cached.
- Who: owner, manager, staff record payments and cash deposits; refunds owner and manager (Q6).
- **Phase 7 attaches here, and nowhere else:** `payment_accounts` (new table), `webhook_events` (unique on provider + event id), `scheduled_charges(order_charge_id, due_at, …)` reading `order_charges.due_at`, card holds as `deposit_in` with `provider_ref` and a capture-before time, refunds to a card as `refund` rows written after the provider confirms. The order page's "Take payment" button opens a cash/transfer form in Phase 3 and gains card and PromptPay in Phase 7, against the same charge.
- **The marketplace booking fee** is not a platform payment: it lives on the marketplace's own Stripe account and its own fee record (§7).
- The currency lock (`tenants_lock_currency`) counts payments and charges.

## 7. The marketplace switch after Phase 3 (3M)

Built in 3M, designed here so Phase 3 leaves room. 3M gets its own plan.

### 7.1 What `marketplace_api` must expose

A schema of `security definer` functions, executable by `service_role` only (the marketplace server), returning **only locations of tenants with `marketplace_listed` and `marketplace_approved`** and listed products on approved catalog entries. One function per adapter call (INTEGRATION §3):

| Function | Returns |
| --- | --- |
| `get_shop(slug or id)`, `list_featured_shops(ids)` | §3.3, §3.4: from tenant + location (hours, closures, coordinates, place id); no contacts |
| `get_catalog_model(slug)` | §3.5, from `vehicle_catalog` |
| `search_offers(query)` | §3.6: one row per listing; free units by **assigned units** (Phase 2 Q2, stricter than the pool rule), the stricter notice, minor units + currency |
| `get_listing`, `get_availability`, `get_quote` | §3.7 to §3.9, through `booking_inputs`, `availability`, `pricing_inputs` (the price itself from `quote()` in TypeScript, Q15) |
| `get_shop_signals(ids)` | Response and cancellation rates from orders with `channel = marketplace` (`request_status`, `cancelled_by`) |
| `create_booking(request)` | §7.2 |
| `get_booking(id)`, `list_customer_bookings(account)`, `cancel_booking(id, by, reason)` | From `orders` by `marketplace_account_id`; status mapped to INTEGRATION §5 through `request_status`, `cancelled_by`, `no_show` |
| Events | `marketplace_events` outbox (one database: no webhook needed): `booking.accepted`, `.declined`, `.expired`, `.cancelled`, `.picked_up`, `.returned`, `.no_show`, written by the order functions when `channel = marketplace` |

The marketplace's own tables (fee record, markets, reviews, referrals) stay marketplace-owned (INTEGRATION §1). The **fee record** is `public.marketplace_fees` keyed by `order_id` (no foreign key into `platform` the marketplace can't read), status by `fee-lifecycle.ts`.

### 7.2 The order insert for `channel = marketplace`

`marketplace_api.create_booking()` calls the same `create_order` core as staff, with `channel = marketplace` and `mode` instant, request or now, in one transaction, in the §4.2 order: product-and-location locks → unit locks → unit rows → product rows → **listing rows `for no key update`** (the cap: `instant_units + request_units` less Moto Mangos rentals in the window) → coupon → **customer row** (upsert by `(tenant, marketplace_account_id)`) → order insert → rentals → reservations → blocks → lines and charge → `marketplace_events` row → `order_counters`. Refusals: `unavailable`, `cap_reached`, `price_changed` (with the new quote), `outside_hours`, `too_short`, `too_soon` (INTEGRATION §3.12).

**Request mode** (Phase 2 §11): the order is `new` with `request_status = pending`, holds **no unit**, and counts against `request_units` under the listing row. Accepting runs the reserve core (and can still be refused `unavailable`, which declines the request). It needs its own reservation state and migration: 3M.

### 7.3 What Phase 3 must not get in the way of

- `orders.channel`, `mode`, `request_status`, `cancelled_by`, `no_show` and `customers.marketplace_account_id` exist from migration 2.
- `bookOnline()` creates an order from stage 2, so the online path is exercised end to end before 3M.
- Q15 is answered before 3M starts.

## 8. Build stages

One PR each, riskiest first. Each ends with typecheck, lint, unit, database and browser tests green in CI and a PROGRESS entry. Migrations local only until Mark says otherwise; staging as each merges, on his word (Phase 2 Q17). **Fable** = touches locks, RLS, money or availability; built on Fable. **Opus** = screens or plumbing over functions already tested.

| # | Stage | Migration | Risk | Model | Accept tests |
| --- | --- | --- | --- | --- | --- |
| 1 | **Lock order fix** and the Phase 3 lock list in root `CLAUDE.md` (draft) | 1 | Locks | **Fable** | Two bikes swapping products at the same instant on a gate: fails on today's triggers, passes after, 0 deadlocks, 30 rounds × 3 shops; catalog review against a product delete, 0 deadlocks; the lock-upgrade detector; the reviewed-writers list test |
| 2 | **Orders core** (database) | 2 | Locks, RLS, money, availability | **Fable** | Every booking writes an order; the accept races of Phase 2 re-run through `create_order` (staff/online/both, last unit, last coupon use, cap); `reserve()` not executable by `authenticated`; isolation for 5 new tables (5 roles × 2 shops + stranger + MM customer + anon); charge save check refuses a snapshot that doesn't add up (20 cases); per-customer limit enforced with a real customer, under a race; customer contacts never in audit; numbering race (50 parallel orders: no duplicate number or code) |
| 3 | **Status machine** (database) | 3 | Availability, locks | **Fable** | Every transition and revert, each role; pickup blocked by each blocker; late return clipped at the next block, never refused; revert-return refused `unit_taken` when re-booked; sale item stock out at pickup and back on revert; `completed_rentals` exact under parallel returns; overdue unit not free; at-risk read finds repair, lost, overdue; races: pickup vs `assign_units`, return vs a new booking of the freed time, revert-return vs that booking |
| 4 | **Order edits and coupon swap** (database) | 4 | Locks, money | **Fable** | §5.2's four races; date change keeps the same units when free, repicks when not, refuses all-or-nothing; cancel part keeps the right coupon amount; price override needs a reason and the role; draft re-quote when prices changed |
| 5 | **Rental changes** (database + `@mango/core`) | 5 | Locks, money, availability | **Fable** | The redesign's tests: two swaps onto the last free bike; swap vs a new booking of the same bike; swap vs extension of the same rental; swap whose new bike is taken leaves all as it was; extend vs a booking of the following days; early return vs a booking of the freed time; every D3 pinned figure stored and read back to the satang; month periods telescope to the whole price (1 to 400 days, New York and VND shops); `refundVat` by rate group; stacking coupon with a credit no longer throws |
| 6 | **Payments ledger** (database) | 6 | Money, RLS | **Fable** | Append-only (update, delete, truncate refused even for the service role's direct writes); balance equals the sum of rows after any interleaving of 20 parallel payments and a cancel; refunds by owner/manager only; deposits outside revenue; currency lock |
| 7 | **Reads for the screens**: `order_list` filters, `today_board`, Gantt and calendar reads | None (functions in 3) or a small one | RLS | Opus, Fable review of the RLS tests | Each read under each role returns exactly the rows the table policies allow; list filters (status, payment status, shortage, at risk, overdue, channel, dates, text search on number, customer, phone, plate) against a seeded set; response time recorded |
| 8 | **New order and the order page** | None | — | Opus | Playwright, 375 and 1280 px: **full new → reserved → picked up → returned → archived**; an overlap refused with the words "This vehicle is booked from … (order #…)"; coupon with a per-customer limit; hold expiry message; Thai at phone width |
| 9 | **Jobs, outbox and email** | 7 | Idempotency | Opus, Fable check of the job SQL | Each job twice in a row writes each message once; overdue thresholds 1/3/15/30 in a DST shop; end-of-rental email to the customer in their language; renewal reminders sent; sender retries and marks failed; no customer email when the address is empty |
| 10 | **Today board and order list** | None | — | Opus | Playwright: four Dashboard tabs show pickups, returns, overdue and at-risk with counts; Late highlighted; Orders tab search by plate and phone; filters and a saved last view; mechanic and driver see no money |
| 11 | **Unit timeline (Gantt), month calendar, drag** | None | Availability (drag calls stage 4–5 functions, already tested) | Opus | Playwright desktop: drag a bar to another unit (reassign), drag its end (extend, **re-priced**, confirm sheet shows the new price), a drag onto a taken slot refused with words; month calendar counts; phone: read-only timeline that scrolls |
| 12 | **Remove for good, coupons for customers, wrap-up** | 8 | Availability (the free-units rule changes) | **Fable** for migration 8 and its tests; Opus for the rest | A removed vehicle is in no read, no availability, no pick, and its past orders still show it; its plate can be reused; "Uses per customer" on the form; returning discount from real rentals; demo seed with orders in every status; accept suite named per spec line; help articles (Fable checks the payments and refund articles); spec and INTEGRATION edits (§12); click-through list; staging on Mark's word |

Stages 6 and 9 touch tables no other stage writes and can be built beside 3 to 5 if a stage waits on Mark. Stage 7 can start once stage 3 merges.

## 9. Screens

| Screen | Address | First | Who | What |
| --- | --- | --- | --- | --- |
| **New order** | `/[tenant]/new-order` (stage 11's screen continued) | **Phone** | Owner, manager, staff | Dates and place → available products with prices (as stage 11) → pick vehicles (quantity makes N rentals; name a unit optional) and extras → customer (search by name, phone; or add: name, phone, email, nationality, language) → coupon, staff price change with reason → summary: lines, VAT, total, deposit → **Hold** (while the customer decides), **Save as draft** or **Reserve**. Hold shows a countdown |
| **Order page** | `/[tenant]/orders/[id]` | **Both** (phone: one column, actions in a bottom sheet; desktop: lines left, side panel right) | Owner, manager, staff | Header: number, code, status, channel, customer. Rentals with unit, dates, status, at-risk/shortage flags. Lines grouped by charge. Balance, payments, deposit. Actions by status: Pick up, Return, Extend, Swap vehicle, Return early, Change vehicle, Change dates, Cancel, Take payment, Record deposit, Revert (manager), Archive. History (audit) at the bottom |
| **Today board** | `/[tenant]/dashboard` (the four tabs) | **Phone** | Everyone (mechanic and driver: no money, no customer contact) | Today, Tomorrow, Upcoming: pickups, returns, at-risk bookings, renewals; Late: overdue rentals, missed pickups, unpaid orders past due, overdue renewals. Counts per tab; Late highlighted; each item opens the order or the vehicle |
| **Orders tab / order list** | `/[tenant]/orders` | **Both** (phone: cards with quick filters; desktop: a table) | Owner, manager, staff | One search box (number, code, customer, phone, plate). Quick filters: today, upcoming, out now, overdue, unpaid. Full filters: status (incl. mixed), payment status, shortage, at risk, channel, place, dates. Last view remembered. Export is Phase 10 |
| **Unit timeline (Gantt)** | `/[tenant]/calendar?view=timeline` | **Desktop** (phone: read-only, horizontal scroll, no drag) | Owner, manager, staff edit; everyone reads (no money) | One row per unit grouped by product, an "unassigned" lane per product for shortages; bars for allocations, holds, downtime; overdue bars extend to now in red; drag to reassign (`assign_units`) or extend (`extend_rental`) with a confirm sheet; day, week and month scales |
| **Month calendar** | `/[tenant]/calendar?view=month` | **Desktop** (phone: a day list under a month strip) | Everyone | Per day: pickups and returns counts; tap a day for its list |
| **Customer** (basic) | `/[tenant]/customers/[id]` | Both | Owner, manager, staff | Contact fields, notes, order history, completed rentals. KYC comes in Phase 4 |
| **Settings › Orders** | `/[tenant]/settings/orders` | Desktop | Owner, manager | Overdue alert days (staff, customer), end-of-rental email, swap and early-return options, archive after N days |
| **Settings › Coupons** | existing | — | Owner, manager | "Uses per customer" back |

- Every screen works at 375 px; English and Thai keys together; new Thai lines on `docs/platform/thai-review-products.md` (or a new `thai-review-orders.md`) for Korn.
- **No new dependency for the Gantt** without asking (root `CLAUDE.md`): recommended to draw it with CSS grid and pointer events (§11.1).
- The Booqable reference's order page layout is compared before stage 8 (spec: "to compare when Phase 3 is prepared").

## 10. Tests with true concurrency

Database tests against local Supabase, in the three seeded shops (Bangkok THB, New York USD with DST, Saigon VND), with **gates** (advisory locks held by a holder session, PR 51) and never `pg_sleep`, each race many rounds, each asserting exact outcomes, nothing half-written and Postgres' deadlock count unchanged:

1. Two staff create orders for the last unit; staff vs online; online vs online (Phase 2's races, through orders).
2. Two orders racing for a coupon's last use, and for a customer's last per-customer use (same customer, two staff).
3. Coupon swaps: A → B vs B → A; A → B vs a booking taking B's last use; swap during hold expiry.
4. Swap mid-rental onto the last free unit, two at once; swap vs a new booking; swap vs extension of the same rental; swap whose new unit is taken at the last moment.
5. Extend vs a booking of the following days; drag-extend vs drag-reassign of the same bar.
6. Return (early, on time, late) vs a booking of the freed time; revert-return vs that booking.
7. Pickup vs `assign_units` on the same rental; pickup vs a mechanic putting the unit into repair.
8. Cancel vs confirm of the same held order; cancel vs the hold sweep; cancel part vs payment.
9. Payments: 20 parallel cash payments and a refund on one order; balance exact.
10. Numbering: 50 orders at once in one shop.
11. Two bikes swapping products (stage 1); catalog review vs product delete.
12. `move_unit` of a rented vehicle vs extend of its rental; vs return.
13. The jobs (`close_expired_new_orders`, `archive_settled_orders`, `queue_due_messages`) running beside 1, 6 and 8.

**Not truly testable in Phase 3:** a race test only proves the timings it hit; the email sender against real Resend (a fake transport in CI, one real send by hand on staging); a phone over a poor connection (Phase 5); the marketplace path (3M); payment providers (Phase 7).

## 11. Open decisions for Mark

| # | Question | Options | Recommended | Needed by |
| --- | --- | --- | --- | --- |
| **1** | **One model or two for orders and reservations** | (a) Orders, rentals, lines and charges on top of the existing reservations. (b) Fold reservations into order lines. (c) No rental layer | **(a)**: keeps Phase 2's tested locks; matches §9.19's "order → rentals → periods" | Stage 2 |
| **2** | **A vehicle rental is always one vehicle** | (a) One rental per vehicle; quantity only for gear. (b) A line may hold N vehicles, split by `@mango/core` when needed | **(a)**: no division on a swap, early return or per-bike report | Stage 2 |
| **3** | **What one charge (future invoice) covers on a long rental** | (a) One charge per month period, each paid and invoiced on its own. (b) One charge for the whole booking | **(a)**, confirmed with Korn: paying three months at once then gives three tax invoices, or one invoice whose VAT is the sum of three | Stage 5 |
| **4** | **Future periods of a fixed long rental** | (a) Priced at booking, frozen. (b) Priced when each is reached | **(a)**: the customer is quoted the whole stay; open-ended rentals (Phase 9) add periods by extension | Stage 5 |
| **5** | **When a hold runs out** | (a) Staff order → draft (lines kept); online → canceled `expired`. (b) Both canceled | **(a)** | Stage 2 |
| **6** | **Who may revert a status, refund, and override a price** | Owner and manager only; or staff too | **Revert and refund: owner and manager. Price override: staff too, with a reason, audited.** Custom roles in Phase 11 | Stage 3 |
| **7** | **A late return whose after-buffer would hit the next booking** | (a) Clip the buffer at the next block and flag that booking. (b) Refuse the return until the next booking moves | **(a)**: a return must never fail | Stage 3 |
| **8** | **Charging for a late return** | (a) Offered at return, on by default, waivable with a reason. (b) Manual only | **(a)** | Stage 3 |
| **9** | **A booked unit goes into repair or is lost** | (a) Keep the allocation, flag "at risk", staff reassign. (b) Unassign automatically into a shortage | **(a)**: no silent changes to a customer's booking | Stage 3 |
| **10** | **`reserve()` and siblings after Phase 3** | (a) Revoked from signed-in users; only order functions call them. (b) Left callable | **(a)**: no booking without an order | Stage 2 |
| **11** | **Order numbers** | (a) Per-shop counter, gaps allowed (a rolled-back order skips one). (b) Gapless | **(a)**: order numbers are not tax documents; Phase 6's invoice numbers are gapless | Stage 2 |
| **12** | **Archiving** | (a) Automatic N days (default 7) after return when the balance is 0 and no deposit is held, plus by hand. (b) By hand only | **(a)** | Stage 3 |
| **13** | **Coupons on extensions** | (a) Judged on the rental's own pickup and length (your lean in stage 7). (b) On the new period alone | **(a)** | Stage 5 |
| **14** | **Credit still unused when a rental ends** (redesign §9.13 item 12) | (a) Stays on the order; it can't be archived until staff refund it or write it off. (b) Lapses automatically | **(a)** | Stage 5 |
| **15** | **How the marketplace reaches the booking rules at 3M.** Phase 2 put `bookOnline()` (the only online path to `reserve()`) in `apps/platform/lib`; the marketplace may not import from another app | (a) Move `bookOnline()` and the server reads into a server-only package (`packages/booking`) used by both apps. (b) The platform app serves an HTTP endpoint the marketplace calls. (c) Port `bookable()` to SQL inside `marketplace_api.create_booking` | **(a)**: one implementation, no network hop, matches Phase 2 Q5 | Before 3M (stage 2 keeps `bookOnline()` easy to move) |
| **16** | **Order emails' sender** until the platform has a name and domain | (a) A neutral Mango Works sending address with the shop's name and reply-to the shop. (b) Wait for the domain | **(a)** | Stage 9 |

### 11.1 Decided in this plan without asking (say if any is wrong)

- A charge is never edited after it is stored, except its status; corrections are new charges.
- `bookOnline()` creates an order from stage 2; online orders need a customer before `reserve`.
- A draft keeps its stored prices; reserving a draft whose `priced_at` is older than a pricing change for its products re-quotes and shows the difference.
- The Gantt is built without a new dependency (CSS grid, pointer events).
- Return place equals pickup place in Phase 3.
- Payment allocation to charges is explicit (`payment_allocations`); an unallocated payment is a credit on the order.
- "Remove for good" is built in stage 11 on the owner's word (PROGRESS 12 Nov proposal).
- Customer contact fields are kept out of audit snapshots from stage 2.
- `order_counters` is the last lock any transaction takes.

## 12. Risks

| Risk | Why | Mitigation |
| --- | --- | --- |
| **Deadlocks between the new order rows and the old row classes** | Every order function adds row locks (customers, orders, rentals, charges) to transactions that already take four classes | One global order (§4.2), the reviewed-writers test, the lock-upgrade detector, every race reading the deadlock count |
| **Two layers out of step** (order status vs reservation states) | A function that changes one and forgets the other | Order status is derived by one SQL function called at the end of every order function; a test helper checks the invariant after every race round |
| **A late return blocked by the constraint** | The return's buffer overlaps the next booking | §2.6 clipping, tested in the race list |
| **Money drift between charges, lines and the ledger** | Cached sums | The cache is written only in the functions that write the source rows; a nightly check (and a test after every race) recomputes and compares |
| **Month periods not adding up** | Rounding per period | Continuation pricing telescopes; a property test over 1 to 400 days in three currencies and a DST zone |
| **Refund VAT** | New pricer work in Phase 3 (PROGRESS stage 4) | `refundVat` in `@mango/core`, Fable, tested in inclusive and exclusive shops |
| **Scope**: twelve stages | Screens are large (Gantt, order page) | Database stages first; screens on Opus once the functions are fixed; stage 11 can ship read-only first and add drag after |
| **The Neon move after Phase 3** | `pg_cron`, `auth.uid()` defaults, storage | The sender runs in the app; jobs only queue; "Not tied to Supabase" rules for every new file |
| **Marketplace path design (Q15)** | Found here; touches a Phase 2 decision | Decided before 3M; stage 2 keeps `bookOnline()` free of app-only imports |
| **Thai wording volume** | Orders add many lines | One review list per stage for Korn |

## 13. Doc edits this plan will need (owner keeps the spec)

- `docs/platform/SPEC.md`: Data model (`orders`, `rentals`, `order_lines`, `order_charges`, `payments`, `payment_allocations`, `customers` basic; `allocations` row replaced by `reservations` + `unit_blocks`); Orders and calendar (the status table of §2.3); Phase 3's accept line extended with §8's.
- Root `CLAUDE.md`: the lock order of §4.2 (stage 2); `apps/platform/CLAUDE.md` still says "on allocations/downtime".
- `docs/INTEGRATION.md`: at 3M, §7 here.
- `docs/PROGRESS.md`: an entry per stage, and a line for this plan.
