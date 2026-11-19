# Phase 3 plan: orders and calendar

**Draft 2, 19 Nov 2026.** Plan only: no code, no migration, nothing applied anywhere. Draft 1 (`45dd93f`) was critiqued by Fable ("needs a second draft"); this draft applies every item of that critique and Mark's 25 decisions of 19 Nov 2026, and then his answers to draft 2's open points (decisions 23 replaced, 26 to 31, same day). §14 lists each change and where it went.

Written from `main` at `b9e0b33` (PR 50 merged; 66 migrations, staging at 66 of 66, live at 53 of 53) **and PR 51's branch** `platform/phase-2-stage-10-review-followups` at `2474a6e` (migration 6, `20261119000100_platform_review_followups`). Every schema statement below is about the database as it will be after migration 6. Phase 2 stage 11 (the read-only New order screen, Settings › Booking rules, the seed) is assumed merged before stage 9 here.

Read for this: `docs/platform/SPEC.md`, `docs/INTEGRATION.md`, `docs/marketplace/SPEC.md` (booking fee), `docs/phase-2-plan.md`, `docs/products-redesign.md` §9.13 and §9.17 to §9.19, `docs/PROGRESS.md` (every "For Phase 3" note, and PR 51's stage 10 entry), the root `CLAUDE.md` lock order, every platform migration to `20261119000100`, `apps/platform/lib/book-online.ts`, `staff-booking.ts`, `apps/marketplace/lib/fees.ts`.

## Summary

1. **Orders sit on top of Phase 2's reservations** (decision 1). An order holds rentals; a rental is exactly one vehicle or one gear line; its stock is the reservations carrying its `rental_id`; its money is billed-period lines grouped into charges. `reservations.booking_id` is the order's id.
2. **`reserve()` is replaced, not wrapped.** A new `reserve_core` takes the order and its rentals as arguments and inserts them inside the lock order (after the coupon row, before the reservations). `platform.reserve()` is dropped; Phase 2's tests and both server callers move to `create_order` (stage 2b).
3. **Every order function re-reads under its locks** (read unlocked, take advisory locks, lock the order row, read again, `try_again` if anything moved) and **settles a run-out hold first**. One hold expiry per order.
4. **Status:** intent is stored (`new`, `draft`, `requested`, `booked`, `archived`, `canceled`); reserved, picked up, returned and mixed are derived from the live reservations. Nothing that is only a read writes.
5. **Money:** a charge is one `quote()` call; every payment gets its own tax invoice, whose VAT `paymentVat()` works out once on the payment's total per rate group (decisions 25, 27). Allocations record what each charge received, append-only. Balance is independent of allocation.
6. **Staff permissions are shop settings** checked in the database (decision 6).
7. **Thirteen stages, nine migrations** (§8). Stage 1 fixes the stage 10 deadlock by making `move_unit()` the only way a vehicle changes product and by removing the multi-row status crossing. The payments ledger comes before the status machine. Eight stages are Fable builds; five are Opus with a Fable check or review.
8. **Emails are switched off in Phase 3** (decision 28): end-of-rental and overdue alerts go to the Dashboard; sending turns on in Phase 6 with a verified domain.
9. **The Moto Mangos fee base is settled** (decision 23, replaced): 10% of everything booked through Moto Mangos (rental after discounts, paid extras, delivery; never the deposit), for the whole booked length. SPEC, INTEGRATION and the marketplace SPEC are corrected in this PR; `fees.ts` needs Phase 8 changes (§7.3). One point is left: whether the fee's receipt (not a tax invoice) is right, to confirm with Korn before Phase 8 (§11.2).

## 0. Starting point and dependencies

| What | State (main + PR 51) | Phase 3 |
| --- | --- | --- |
| `reservations`, `free_units`, `shortage_demand`, the hold sweep, `availability()`, `booking_inputs()` | Built (stages 1 to 3, 8) | Kept. `reservations` gains `rental_id` |
| `platform.reserve()` | Public, granted to `authenticated` and `service_role`; 50-line cap; its exception block catches every `foreign_key_violation` as a taken unit | **Dropped** (stage 2b). Its logic becomes `platform_private.reserve_core` (§3.3) |
| `confirm_hold()`, `cancel_reservation()`, `assign_units()` | Public | Re-created as private cores; order wrappers are the only callers (§3.3) |
| `move_unit()` | Public; moves reservations, splits a multi-unit row | Re-created in migration 2 to copy `rental_id` on a split |
| `units_guard` | Lost refused while non-downtime future blocks exist; product change refused while bookings name the old one | Stage 1: product change only through `move_unit()`; lost allowed at any time (decision 19) |
| `units_product_not_retired` (before row) / `units_clamp_product_counts` (after row) | Lock the new product `for share`, then the old `for no key update`: the stage 10 deadlock | Stage 1 (§4.1) |
| `tenants_lock_currency()` | Unlocked `exists` checks on seven tables, incl. any redemption (migration 6) | New money tables hold the currency by foreign key instead (S8, §3.2) |
| `notification_outbox` | Renewal kinds; nothing sends | Stage 8 |
| Quote snapshot, rental-period maths, `decideDiscounts` | `@mango/core` | Stored; extended in stages 5 and 6 |
| `bookOnline()` (`apps/platform/lib`) and `staff-booking.ts` | Call `reserve()` | Move to `create_order` (2b); `bookOnline()` moves to a shared server-only package (decision 15) |
| Phase 2 rows on staging and in the seed | Reservations, blocks and redemptions with no order | **Cleared by migration 2, then reseeded** (decision 24, §8 stage 2a) |

## 1. Scope

### 1.1 Phase 3 delivers

- **Orders:** New order and the order page; rentals, billed periods, extras and items for sale; the status workflow with revert; unit assignment through the existing reservations; shortage and at-risk flags (computed); adding to a booked order (decision 20).
- **Views:** today board (Dashboard tabs), order list with filters, Orders tab search, unit timeline (Gantt, drag to reassign or extend), month calendar, the order's own History.
- **Rental changes:** extend, swap mid-rental, early return, late return with grace and charge, editing a recorded return time, month-to-month long rentals with each period its own line and charge.
- **The basic customer record**, the **payments ledger** (cash, transfer, cash deposits, credits and write-offs), **jobs, outbox and the email sender** (end of rental, overdue alerts, renewal reminders).
- **Staff permission settings** (decision 6).
- **Carried notes** (§5).

Spec accept line: full new → returned lifecycle in Playwright; drag-extend re-prices; an overlap is refused with a clear message. §8 adds each stage's.

### 1.2 Left to later phases

| Phase | Left there | Ready from Phase 3 |
| --- | --- | --- |
| **1b** | Maintenance, service schedules, odometer, keys, GPS, full unit timeline, profit per vehicle, **"Remove for good"** (moved from Phase 3, scope note) | Revenue per unit from period lines (one vehicle per rental); the timeline component takes more row kinds |
| **4** | KYC documents, blacklist, privacy notice, retention, customer merge, manager override of expired documents | `pickup_blockers()` (§3.5) takes new reasons |
| **5** | QR check-out and check-in, inspections, signature, damage charges | `pickup_blockers()` gains "no agreement" and "no inspection"; the recorded return time is what Phase 5's check-in records |
| **6** | Tax invoices (one per payment, **gapless numbering separate from order numbers**, decision 11), credit notes, PDFs, LINE, **order confirmed and order canceled emails**, the verified sending domain (decision 16), and **switching email sending on** (decision 28) | Each payment already carries the net and VAT its invoice prints (§6.4); the outbox already holds every message Phase 3 queued (§3.6) |
| **7** | Stripe, cards, PromptPay, card holds, scheduled charges, payment links, refunds to a card, webhooks, **the payment deadline that makes an order "unpaid past due"**, a shop cancellation-fee setting (decision 18) | Ledger kinds `deposit_hold` and `deposit_release` exist; `order_charges.due_at`; `provider` and `provider_ref` |
| **8** | Booking page, delivery, documents upload | `create_order` for `booking_page`; the shared booking package |
| **9** | Open-ended rentals, recurring charges, renewal reminders to customers, **traffic fines** (matched on a rental's `picked_up_at` and recorded `returned_at`) | Month periods with `due_at` |
| **10** | Reports, cash close | Ledger and lines |
| **11** | Custom roles, transfers (return elsewhere), platform admin | Return place = pickup place |
| **3M** | `marketplace_api`, request mode, markets, the fee record, minor units in the marketplace, legacy tables | §7 |

Not in Phase 3: charge rules (after Phase 3, before 3M), weekday rules, gear re-packing, the "every Nth period free" coupon kind, part returns of a gear rental.

## 2. From reservations and holds to orders

### 2.1 One model on top of the other (decision 1)

Orders, rentals, lines and charges sit on top of `reservations`, which keep their meaning: stock, no money, no customer. Phase 2's database tests are **ported** to the new entry point (`create_order`) rather than kept against a function that no longer exists (stage 2b).

### 2.2 The shape

```text
orders              one booking: intent status, customer, channel, one hold expiry
└─ rentals          exactly one vehicle (one unit, one plate), or one gear line with a quantity
   ├─ reservations  its stock: those with its rental_id in held, reserved or out are "live"
   │  └─ unit_blocks   allocation / hold (unchanged)
   └─ order_lines   billed periods and their extras
order_lines         also items for sale, fees, credits, differences
order_charges       one quote() call: snapshot, rate groups, totals, due_at
payments            append-only ledger
payment_allocations append-only: how much of a payment went to which charge, with net and VAT per rate group
```

- **Decision 2:** an order holds any number of vehicles, each its own rental. A vehicle rental is exactly one specific vehicle; the same unit is never on two overlapping bookings (the exclusion constraint). Only gear has a quantity.
- **Decision 29 (overbooking accepted):** with overbooking on, a vehicle rental may wait for its unit (`shortage = 1` on its reservation), shown as a shortage until a unit is assigned; a rental is still never more than one unit.
- **A rental's live reservations** are those with its `rental_id` in `held`, `reserved` or `out` (M2). There is no `current_reservation_id`. A swap leaves the old reservation `returned` and adds a new live one; `move_unit()` splitting a gear row copies `rental_id` to the new row.
- **`rentals.product_id` and `location_id` are "as booked"**: the draft's intent and what the customer booked. While a rental has live reservations, the product and place it is actually on are **derived** from them (`move_unit()` can change them). No order or rental column caches a place; `orders.location_id` is dropped (M2).
- **Order functions take their advisory locks from the order's reservations, never from `rentals`** (M2).
- **Extras with a vehicle** are rentals with `parent_rental_id`; their periods follow the vehicle's.
- **A gear rental is returned whole.** Returning part of one (2 of 3 helmets) is not offered in Phase 3; staff return it all and add a new rental for what stays out.
- **Services** have a rental and a reservation and no block. **Items for sale** have a line and no rental (§3.4).
- **Line cap:** `reserve_core` accepts **200 lines** (Phase 2 had 50). Reason: decision 2 allows group bookings; 40 vehicles, each with up to 3 extra lines, is 160 lines, plus items for sale and fees. A database test books 200 lines in one call and records its time; a 201st is `invalid_request`.

### 2.3 The status machine

**Stored on `orders.status`, the intent (S3):**

| Stored | Meaning |
| --- | --- |
| `new` | Being made; holds stock until `orders.hold_expires_at` |
| `draft` | Saved; holds nothing |
| `requested` | A Moto Mangos request waiting for the shop (3M; no stock held) |
| `booked` | Stock taken; what the customer sees is derived (below) |
| `archived` | Closed |
| `canceled` | With `cancelled_by`, `cancel_reason`, `no_show` |

**Derived, never stored**, for a `booked` order, from the live (and returned) reservations of its non-canceled rentals and its sale lines: `reserved` (nothing out yet), `picked_up` (everything out or handed over), `returned` (everything back), `mixed` (more than one of those). One SQL function, `platform_private.order_state(order)`, used by every read and every function that needs it.

**Rental intent** is stored the same way: `draft`, `booked`, `canceled`; its stage (`held`, `reserved`, `out`, `returned`) is its reservations'. `picked_up_at` and the recorded `returned_at` are stored on the rental.

**Transitions** (each one function; §3.9 says who):

| From → to | Function | Rule |
| --- | --- | --- |
| — → `new` | `create_order(…, hold)` | `hold_expires_at` = now + `tenants.hold_minutes` |
| — or `draft` → `booked` | `create_order` / `reserve_order` | Through `reserve_core` |
| `draft` → `new` | `hold_order` | A draft can be held again (decision 22); new expiry |
| `new` → `booked` | `confirm_order` | Re-created `confirm_hold` core reads live reservations only (M5) |
| `new`, hold run out | settled by **every order function first**, and by the close job | Staff order → `draft` (lines kept); online order → `canceled`, reason `expired` (decision 5) |
| `booked`: rental reserved → out | `pick_up` | `pickup_blockers()` empty |
| `booked`: rental out → returned | `return_rental` | Recorded return time; block end (§2.6); late charge after grace (§6.3) |
| `new`, `draft`, `booked` with nothing out → `canceled` | `cancel_order`, `cancel_rental` | Payments recorded become a credit; refunds per setting (decision 18) |
| `booked` returned → `archived` | `archive_order`, the nightly job | Decision 12 |
| **Reverts** (setting `staff_can_revert`, default off) | | |
| out → reserved | `revert_pickup` | Sale items' stock put back |
| returned → out | `revert_return` | **Voids that return's late or early charge; refused if money is allocated to it** (S5); block end restored, refused `unit_taken` if re-booked |
| `booked` (nothing out) → `draft` | `unreserve_order` | Blocks released, lines kept |
| `canceled` → `draft` | `restore_order` | |
| `archived` → `booked` | `unarchive_order` | |

### 2.4 Allocations and the exclusion constraint

Unchanged: every unit claim is a `unit_blocks` row of kind `allocation` or `hold` with a `reservation_id`; `unit_blocks_no_overlap` has the last word. No `order_line_id` on blocks: a block spans the rental's time on one bike, a line one billed period. Nothing but `reserve_core` and the order functions writes an allocation or a hold.

### 2.5 Unit assignment

Assigned at once by `reserve_core` (best fit) or named by staff. Changed before pickup by `assign_order_units` (§3.3, wrapping the `assign_units` core), from the order page or by dragging on the Gantt. Confirmed at pickup (Phase 5 adds the QR scan). Changed mid-rental only by a swap.

### 2.6 Shortage, at risk, overdue

- **Shortage** and **at risk** are **computed in the reads** (M4); no order column holds them. At risk = a reserved rental whose unit is in repair or lost, or still out on an overdue rental, or whose turnaround was clipped (below).
- **A unit going into repair** keeps its bookings, flagged at risk; staff reassign (decision 9).
- **A unit marked lost** (decision 19): allowed at any time, including while out and with future bookings. An out rental on it stays open for staff to close with charges; future bookings on it are at risk; downtime after now is cleared as today. `units_guard` loses its `unit_has_future_blocks` refusal for `lost` (S4, stage 1).
- **A late return never fails** (decision 7): the block's end becomes the later of its booked end and the return moment plus the after-buffer, **clipped at the start of the unit's next block**; the next booking is then at risk ("turnaround short").
- Overbooking stays staff-only (Phase 2 Q4).

## 3. Data model

All in `platform`. Every table: `tenant_id`, parents by `(tenant_id, id)`, RLS in the set form through the `my_tenant_ids()` helpers, grants on purpose (`service_role` too), `set_updated_at`, audit, a fixture row per tenant, `default-grants.test.ts`. Every function: `revoke all ... from public, anon`. Nobody signed in writes these tables directly.

### 3.1 Customers

```text
customers
  id, tenant_id, full_name, phone (E.164 when parseable), email (citext), line_id,
  nationality (ISO 3166-1 alpha-2), language (BCP 47), notes,
  marketplace_account_id (unique per tenant, 3M), archived_at
```

- **Completed rentals are derived** (S2): `platform_private.completed_rentals(customer)` counts the customer's non-canceled orders with at least one returned vehicle rental. Nothing stores it; returns and reverts lock no customer row.
- Phone and email are never copied into audit snapshots (recorded as `changed`).
- Owner, manager, staff read and write (through `save_customer`); mechanics and drivers none.

### 3.2 Orders, rentals, charges, lines

```text
orders
  id (= reservations.booking_id), tenant_id
  number          bigint per tenant from order_counters (gaps allowed; decision 11)
  code            6 characters, no 0/O/1/I, unique per tenant
  customer_id
  status          new | draft | requested | booked | archived | canceled   (intent, §2.3)
  hold_expires_at one per order (M5)
  channel, mode, request_status, cancelled_by, cancel_reason, no_show
  currency        foreign key (tenant_id, currency) → tenants (id, currency), no cascade (S8)
  idempotency_key uuid, unique per tenant when set (S6)
  notes, created_by, created_at, archived_at, canceled_at
rentals
  id, tenant_id, order_id, parent_rental_id
  product_id, product_type, location_id      as booked (§2.2)
  quantity        1 for a vehicle (check); 1..1000 for gear
  starts_at, ends_at      as booked; extended by extensions
  status          draft | booked | canceled  (intent)
  picked_up_at, picked_up_by
  returned_at     the recorded return time (decision 7); returned_by
  return_edits    via audit (each edit: old, new, reason, who)
reservations (existing) + rental_id   required from migration 3
order_charges
  id, tenant_id, order_id
  kind            booking | period | extension | addition | swap | early_return | late_return | difference
  currency (FK as orders), priced_at, due_at
  total, tax_total, deposit, rate_groups jsonb, snapshot jsonb
  status          open | void          ("settled" is derived: its allocations equal its total, M7)
order_lines
  id, tenant_id, order_id, charge_id, rental_id
  kind            period | extra | sale_item | fee | credit | manual
  product_id, product_type, period_start, period_end      (snapshot: never changed)
  closed_at       when a swap or early return closed the period (minor: its own column)
  quantity, included_quantity, charged_quantity,
  list_price, season_total, discount_total, amount, tax_rate_bp, tax_profile_id,
  tax_profile_name, tax_inclusive, tax_amount, deposit, currency, snapshot jsonb
  override_reason, override_by, note, position
order_counters    tenant_id, next_number
```

- **One charge is one `quote()` call**; stored once, never edited except `status = void`. Corrections are new charges (`difference`).
- **The charge save check** (Phase 2 §5.4): shape, lines add up to totals, plus the cross-field checks `readSnapshot()` leaves to Phase 3; addition and comparison only.
- **Long rentals** (decisions 3, 4, 17): a rental over 30 days gets one `period` charge per month period, priced at booking and frozen, each with `due_at` = its period's start; the first is `booking` (§6.3).

### 3.3 The core and the order functions

**`platform_private.reserve_core(tenant, order jsonb, rentals jsonb, request jsonb)`** (M1). Not today's body moved: it is written for orders.

1. Checks as `reserve()` did (caller, products, units, quantities, ≤ 200 lines).
2. Advisory locks (classes 1, 2), unit rows, product rows, listing rows, coupon row: as today.
3. **Inserts (or, for an existing order, updates under the already-held row) the order and its rentals, after the coupon row and before the reservations.**
4. Reservations with `rental_id`, blocks, redemption with the real `customer_id`, audit.
5. Its exception handler catches `exclusion_violation` and only the **unit** foreign keys (`unit_blocks_tenant_id_unit_id_fkey`, by `CONSTRAINT_NAME` from `GET STACKED DIAGNOSTICS`) as "unit taken, pick again"; any other foreign-key failure (order, rental, customer, product) is raised, never retried as `unit_taken`.

**Every order function** (M1, M3, M5) follows one pattern:

1. Read the order's live reservations **unlocked**: their products, places, units, and the order's rental ids.
2. Take lock classes 1–2 from those reservations (plus any new products or units the call adds).
3. Lock the order row (`for no key update`).
4. **Settle a run-out hold**: if `status = new` and `hold_expires_at` has passed by `clock_timestamp()`, apply decision 5 now (releasing still-held reservations, which the advisory locks already cover).
5. **Read again.** If the products, places, units or rentals differ from step 1, answer `try_again` with nothing written (as `cancel_reservation` does today).
6. Write nothing until `reserve_core` (or the inner core it calls) answers ok. **Any inner refusal is raised** (a `P0001` with the reason), caught by the function's outermost block, and answered `{ok: false, reason}` with every write undone.

`lock_timeout = '6s'` on each; callers answer `try_again` for `55P03`, `57014`, `40P01`.

| Function | Does | Migration |
| --- | --- | --- |
| `create_order(tenant, order)` | New order, rentals, lines, charge(s), through `reserve_core` in hold, reserve or draft mode. **Idempotency key** (S6): a repeat answers the first result | 3 |
| `hold_order`, `reserve_order`, `confirm_order`, `unreserve_order` | §2.3. `confirm_order` uses the re-created `confirm_hold` core, which reads live reservations only (M5) | 3, 6 |
| `cancel_order`, `cancel_rental`, `restore_order` | §2.3; a paid charge gets a `difference` charge (S5) | 3, 6 |
| `assign_order_units(order, rental, units)` | Named wrapper around the `assign_units` core (M4): before pickup, fill a shortage or change the unit | 3 |
| `pick_up`, `return_rental`, `revert_pickup`, `revert_return`, `archive_order`, `unarchive_order` | §2.3 | 5 |
| `save_order`, `change_rental_dates` | Draft/new edits; dates before pickup; a paid charge gets a `difference` charge (S5) | 6 |
| `add_to_order(order, rentals)` | Gear or another vehicle added to a booked order, reserved or picked up, through `reserve_core`; its own charge, kind `addition` (M6, decision 20) | 6 |
| `extend_rental`, `swap_rental_unit`, `return_early`, `edit_return_time` | §6 | 7 |
| `record_payment`, `record_refund`, `record_deposit`, `write_off_credit` | §6.4. Idempotency keys on payment and refund (S6) | 4 |
| `save_customer`, `save_staff_permissions` | §3.1, §3.10 | 2 |
| Reads: `order_list`, `today_board`, `timeline`, `order_history`, `bookings_at_risk` | Security definer, write nothing (M4, S10) | 8 |

`platform.reserve()` is **dropped** in migration 3 (M1, decision 10). `confirm_hold`, `cancel_reservation` and `assign_units` become `platform_private` cores with no grant to `authenticated`.

### 3.4 Items for sale

A `sale_item` line takes stock at hand-over (`pick_up`) as a `stock_movements` row `sold`, and puts it back on `revert_pickup`. `stock_movements_guard` takes the product-and-location advisory lock inside the insert, so every function that writes a movement takes it in class 1 first. Stock can run out between booking and hand-over; `pick_up` then answers `stock_below_zero` with the line.

### 3.5 Pickup blockers

`pickup_blockers(order, rentals)`: a vehicle rental with no unit or a shortage; a unit not active; a unit still out on another rental; no customer. Phases 4 and 5 add theirs. No override in Phase 3.

### 3.6 Jobs and outbox

- `notification_outbox.kind` gains `end_of_rental`, `overdue_staff`, `overdue_customer`, with `channel` and `recipient`. **Order confirmed and order canceled emails are Phase 6** (minor). Rows hold facts, not text.
- Settings on `tenants`: `overdue_alert_days int[]` (default `{1,3,15,30}`), `overdue_customer_days int[]` (empty), `end_of_rental_email` (on), `late_return_grace_minutes` (60, decision 21), `archive_after_days` (7, decision 12).
- Jobs (migration 9): `queue_due_messages()` (inserts outbox rows only; one runner), `close_expired_holds_on_orders()` (M4: acts **only on `new` orders whose reservations the sweep has already expired**; order row first `for no key update skip locked`, then its rentals; no reservation or block touched), `archive_settled_orders()` (order row `skip locked`; decision 12's conditions).
- **Phase 3 ships with emails switched off** (decision 28). End-of-rental and overdue alerts go to the Dashboard (the Late tab and the day's items) only. The outbox still records every message as `queued` with a `held: sending off` reason, so nothing is lost; the sender (an `apps/platform` scheduled function through Resend, with retries) is built and tested against a fake transport, behind a shop-independent switch that stays off until Phase 6 verifies the sending domain (decision 16). Turning it on must not flood customers with old messages: messages queued while sending was off are marked `expired` unless still due.
- The Late tab's "unpaid past due" item waits for Phase 7's payment deadline (minor).

### 3.7 Columns elsewhere

- `pricing_settings`: swap and early-return options (§9.19 of the redesign).
- `tenants`: §3.6's settings and §3.10's staff permissions.
- `units`: none in Phase 3. "Remove for good" moved to Phase 1b.

### 3.8 Migrations, in order

Names follow the repo rule; timestamps when written. Re-created functions are read from the database behind an MD5 guard, as migrations 5 and 6 did.

| # | Name | Stage | What |
| --- | --- | --- | --- |
| 1 | `platform_unit_lock_rules` | 1 | `units_guard`: a product change only inside `move_unit()` (a transaction setting it marks), lost at any time; `units_clamp_product_counts` becomes a **statement-level** trigger that locks every affected product row in id order once (§4.1); `review_catalog_request` locks products before its catalog entry |
| 2 | `platform_orders` | 2a | Clears Phase 2 reservations, their allocation and hold blocks, and coupon redemptions (S7, decision 24); `customers`, `orders`, `rentals`, `order_charges`, `order_lines`, `order_counters`; `reservations.rental_id` (nullable); **`move_unit()` re-created to copy `rental_id` on a split** (M2); staff permission columns and `staff_may()`; RLS; `save_customer`, `save_staff_permissions` |
| 3 | `platform_order_core` | 2b | `reserve_core`; `reservations.rental_id` not null; `create_order`, `hold_order`, `reserve_order`, `confirm_order`, `cancel_order`, `assign_order_units`; `confirm_hold`, `cancel_reservation`, `assign_units` moved to private cores; **`platform.reserve()` dropped**; coupon redemption `customer_id` foreign key |
| 4 | `platform_payments_ledger` | 3 | `payments`, `payment_allocations` (both append-only), `record_payment`, `record_refund`, `record_deposit`, `write_off_credit` |
| 5 | `platform_order_status` | 4 | `pick_up`, `return_rental` (late charge), reverts, archive, `pickup_blockers`, `order_state`, stock movements |
| 6 | `platform_order_edits` | 5 | `save_order`, `change_rental_dates`, `add_to_order`, `unreserve_order`, `cancel_rental`, `restore_order`, coupon swap, `confirm_hold` core re-created for repeat holds |
| 7 | `platform_rental_changes` | 6 | `extend_rental`, `swap_rental_unit`, `return_early`, `edit_return_time`; swap settings |
| 8 | `platform_order_reads` | 7 | `order_list`, `today_board`, `timeline`, `order_history`, `bookings_at_risk`, `completed_rentals` |
| 9 | `platform_order_jobs` | 8 | Outbox kinds and columns, alert settings, the three jobs and their schedules |

### 3.9 Who may do what, and RLS

`booking_roles(action)` gains order actions; **`staff_may(tenant, permission)`** (§3.10) is checked inside each affected function, not only in the UI.

| Action | Owner | Manager | Staff | Mechanic | Driver |
| --- | --- | --- | --- | --- | --- |
| See reservations, blocks (no money, no customer) | Yes | Yes | Yes | Yes | Yes |
| See orders, rentals, customers | Yes | Yes | Yes | No | No |
| See lines, charges, payments | Yes | Yes | Yes | No | No |
| Create, edit, reserve, cancel, add to an order; pick up, return, extend, swap, return early | Yes | Yes | Yes | No | No |
| Change a price (with a reason) | Yes | Yes | Setting, on | No | No |
| Waive a late-return charge (with a reason) | Yes | Yes | Setting, on | No | No |
| Edit a recorded return time | Yes | Yes | Setting, on | No | No |
| Revert a status | Yes | Yes | Setting, off | No | No |
| Record a refund | Yes | Yes | Setting, off | No | No |
| Write off a credit | Yes | Yes | Setting, off | No | No |
| Record a payment or cash deposit | Yes | Yes | Yes | No | No |
| Archive, unarchive; Settings › Orders and staff permissions | Yes | Yes | No | No | No |

| Table | Select | Write |
| --- | --- | --- |
| `customers`, `orders`, `rentals` | Owner, manager, staff | Functions only |
| `order_lines`, `order_charges`, `payments`, `payment_allocations` | `pricing_roles('read')` | Functions only; `payments` and `payment_allocations` refuse update, delete and truncate by trigger, for every role |
| `order_counters` | Nobody signed in | Functions only |
| `reservations`, `unit_blocks` | As today | As today |

- **History** (S10): staff can't read `audit_events` (owner and manager only), so `order_history(order)` returns the order's own events (status changes, price overrides with reasons, return-time edits, payments) to owner, manager and staff, with no customer contact fields in them.
- The Today board and timeline return dates and units with no customer and no money to mechanics and drivers. Each security-definer read gets its own cross-tenant test.
- The service role calls order functions for `booking_page`, `marketplace`, `api` only; members for `walk_in`, `phone` only.

### 3.10 Staff permission settings (decision 6)

Six booleans on `tenants`, written by `save_staff_permissions` (owner, manager), each change audited:

| Setting | Default |
| --- | --- |
| `staff_can_change_price` (always with a reason) | On |
| `staff_can_waive_late_charge` (with a reason) | On |
| `staff_can_edit_return_time` (with a reason) | On |
| `staff_can_revert` | Off |
| `staff_can_refund` | Off |
| `staff_can_write_off_credit` | Off |

`platform_private.staff_may(tenant, permission)` is true for owners and managers always, and for staff when the setting is on. Every function in §3.9 calls it. **When staff can't refund, an early return by staff leaves a credit** for a manager to refund. Screen: Settings › Orders (stage 10).

## 4. Lock order

### 4.1 The stage 10 deadlock and the multi-row crossing (S1)

**Two bikes swapping products.** Today `units_product_not_retired` locks the new product `for share` and `units_clamp_product_counts` then the old `for no key update`; two moves in opposite directions deadlock. **Fix: a vehicle's product changes only through `move_unit()`, one unit per transaction**; `units_guard` refuses a product change made any other way (for the service role too). `move_unit()` already takes both products' advisory locks sorted, then both product rows in id order `for no key update`, so two moves between the same products serialise on their advisory locks before either touches a row. Gate test: two `move_unit()` calls in opposite directions released at the same instant: one waits, both finish, 0 deadlocks; and a direct `update units set product_id` is refused.

**A multi-row status change against a two-product booking.** `units_clamp_product_counts` is a row trigger: an `update` of several units of products X and Y locks their product rows `for no key update` in whatever order the rows come, while a booking of X and Y holds `for share` on both in id order. **Rule: a statement that changes units locks every product row it affects once, in id order, before any row's counts are touched.** The trigger becomes statement-level (`after update ... referencing old table`), locking `distinct product_id` sorted, then clamping. Gate test: a two-unit status change (Y's unit first in the statement) against a booking of X and Y: one waits for the other, 0 deadlocks; fails on today's trigger.

**"Never raise a lock level later"**: a transaction takes all its product rows at once, at the strongest strength it needs. `pg_locks` does not list granted row locks, so this is checked **statically**: a test reads every `platform`/`platform_private` function body (`pg_get_functiondef`) and fails when one function takes a `products` row lock in two different strengths, or a weaker one before a stronger one. Where a race test needs to see held row locks it uses `pgrowlocks` if the local stack has the extension (it ships with Postgres contrib; enabled in the test database only).

### 4.2 The global order

Every function or trigger that takes more than one lock takes them in this order, each class in its own sort order, never returning to an earlier class:

1. **Product-and-location advisory locks** (`1a02`), sorted by key: from the order's **reservations** (M2), plus new products the call adds, plus items for sale it moves stock for.
2. **Unit advisory locks** (`1a01`), sorted by key.
3. **Rows:**
   1. **the order row(s)**, `for no key update`, in id order (an existing order: M3);
   2. **unit rows**, `for key share`, in id order (stronger only `nowait`);
   3. **product rows**, in id order, all at once at the strongest strength needed;
   4. **listing rows**, product-id order, `for no key update` (Moto Mangos);
   5. **coupon rows**, in id order, `for update` (both, on a coupon swap);
   6. **customer rows**, only to insert or upsert one (a new order's customer; a marketplace upsert), never otherwise;
   7. **insert of a new order; rental rows** (insert, or in id order for an existing order);
   8. **reservations**, then **unit_blocks**;
   9. **charges, lines, payments, allocations, redemptions, stock movements, outbox rows**;
   10. **`order_counters`**, last.

Why the order row comes straight after the advisory locks: it is the order functions' serialisation point (M3), and nothing that holds a unit, product, listing, coupon or customer row ever waits for an order row. `move_unit()`, a unit delete, a status change, a downtime write, `save_coupon`, `save_listing`, `save_product_extras` and the hold sweep take no order row. `record_payment` takes only an order row.

### 4.3 Who takes what

| Writer | 1 | 2 | 3 (rows, in §4.2 order) |
| --- | --- | --- | --- |
| `create_order` | All its products, sorted | Picked / named units | units, products `for share`, listings (MM), coupon, customer (insert/upsert), order insert, rentals insert, reservations, blocks, charges, lines, redemption, counter |
| `hold_order`, `reserve_order`, `confirm_order`, `add_to_order` | From reservations + new products | Old and new units | order, units, products, listings (MM), coupon, rentals, reservations, blocks, charges, lines, redemption |
| `save_order`, `change_rental_dates` | From reservations + new | Old and new units | order, units, products, coupons (both, id order), rentals, reservations, blocks, charges, lines, redemptions |
| `cancel_order`, `cancel_rental`, `unreserve_order`, `restore_order` | From reservations | Its units | order, coupon, rentals, reservations, blocks, charges (void, difference), redemption |
| `assign_order_units` | From reservations | Old and new units | order, units, products `for share`, reservations, blocks |
| `pick_up`, `revert_pickup` | From reservations + sale items | Units confirmed or changed | order, units, products, rentals, reservations, blocks (if a unit changes), stock movements |
| `return_rental`, `revert_return` | From reservations | Its units | order, units, rentals, reservations, blocks, charges, lines |
| `extend_rental` | From reservations (rental + extras) | Its units | order, units, products, rentals, reservations, blocks, charges, lines |
| `swap_rental_unit` | Old and new products, sorted | Old and new unit, sorted | order, units (old unit `nowait` if put into repair), products (old `for no key update` if into repair, else `for share`), rentals, reservations, blocks, charges, lines |
| `return_early` | From reservations | Its units | order, units, rentals, reservations, blocks, charges, lines |
| `edit_return_time`, `archive_order`, `unarchive_order` | None | None | order, rentals, charges, lines |
| `record_payment`, `record_refund`, `record_deposit`, `write_off_credit` | None | None | order, payments, allocations |
| `move_unit()` (re-created) | Where it is, goes, and its bookings name | The unit | unit row `nowait`, products `for no key update` in id order, reservations (copy `rental_id` on split), blocks, unit's own row. **No order or rental row** |
| Unit status change (one or many units) | None | Sold, retired, lost: each unit | unit rows, then **every affected product row once, in id order** (statement trigger), listing rows |
| Unit delete, downtime | As today | As today | As today |
| `review_catalog_request` | None | None | products in id order, then the catalog entry |
| Hold sweep | Expired holds' products, sorted | None | reservations, blocks, redemption (unchanged; no order row) |
| `close_expired_holds_on_orders` | None | None | order rows `skip locked` (only orders whose reservations are already expired), then their rentals |
| `archive_settled_orders` | None | None | order rows `skip locked` |
| `queue_due_messages` | None | None | outbox inserts only (one runner at a time) |

### 4.4 Backstops

`lock_timeout = '6s'` on every waiting function; every race reads the deadlock count before and after; the static lock-strength test of §4.1; a test that lists every function taking advisory or row locks and fails on one not in a reviewed list.

## 5. Notes carried from Phase 2

### 5.1 "Uses per customer"

- Every order function passes the order's real `customer_id` to the coupon check; `max_uses_per_customer` is enforced under the coupon row from stage 2b. Online callers get the customer from the server, never the browser.
- A coupon with a per-customer limit on an order with no customer yet is refused `customer_needed`.
- "Uses per customer" returns to the coupon form in stage 12. The returning-customer discount reads `completed_rentals()` (§3.1).
- `coupon_redemptions.customer_id` gets its foreign key to `customers` (migration 3).

### 5.2 Swapping the coupon on a held booking

On a `new` or `draft` order: prices worked out first; then, in the §4.2 order, the order row, then **both coupon rows, old and new, `for update`, in id order**; **the old use is given back first**, then the new coupon's uses counted under its row and its redemption written; the charge replaced (draft) or the old voided and a new `booking` charge stored (`new`). A refusal leaves the old use and charge as they were. Tests: A → B against B → A; A → B against a booking taking B's last use; swap to the same coupon; swap while the hold runs out.

### 5.3 Other notes

| Note | Plan |
| --- | --- |
| A held booking whose coupon was archived since | Kept until saved again; re-deciding refuses it with words |
| Stacking coupon with a credit throws `credit_exceeds_base` | `decideDiscounts` caps the coupon at what the credit leaves; not applied if nothing is left. Stage 6 core work |
| An extension judged on the rental's own pickup and length | Decision 13: judged on the original pickup and length; an extension takes **no new use** and is not re-judged on dates; with decision 17, a percentage coupon does not apply to extensions at all |
| Refund VAT | `refundVat()` in `@mango/core`, stage 3 |
| Early-return outcome stored, never recomputed | `early_return` charge with its inputs in the snapshot |
| Lines never re-sorted | `order_lines.position`; no function updates amounts |
| An extra left behind when `move_unit` moves its vehicle to another place | At risk on the order; transfers are Phase 11 |
| A reserved service can't be deleted: offer Retire | Stage 12, screen only |
| "Remove for good" | **Moved to Phase 1b** (scope) |
| The stage 10 deadlock; catalog review vs product delete | Stage 1 |
| A booking cancelled in part keeps the coupon and amount | `cancel_rental` re-decides on what is left and stores a `difference` charge; the redemption amount is updated under the coupon row |

## 6. Rental changes, long rentals, money

Every amount is worked out in `@mango/core` before the transaction; the function checks lines add up and stores them.

### 6.1 Extend

Same unit (and extras' units) free to the new end plus buffer; block lengthened in place; `extension` charge with one period line per vehicle and extra (`extensionPrice`, "keep the last period's discount"). No coupon (decisions 13, 17). Refused `unit_taken` naming the booking in the way. Drag-extend calls it after a price confirmation.

### 6.2 Swap mid-rental

On a rental that is out and **not overdue** (an overdue rental is refused `rental_overdue`: return it first). Old reservation `returned` at the swap time, block shortened (clipped as §2.6), old line's `closed_at` set (its `period_end` snapshot stays), new reservation (same `rental_id`), new period line and credit line in one `swap` charge. **"Put the old vehicle into repair"** is offered for a breakdown swap and done in the same transaction (unit row `nowait`, its product row `for no key update` taken in class 3.3). Deposit difference shown, never moved.

### 6.3 Early return, late return, return-time edits, long rentals

- **Early return:** block shortened, `closed_at` set, `early_return` charge with the unused part as credit, refund or nothing per shop settings; staff without `staff_can_refund` leave a credit.
- **Late return** (decisions 7, 8, 21): if the recorded return time is past `ends_at` + `late_return_grace_minutes` (default 60), a `late_return` charge is offered, on by default, from `ends_at` to the recorded time (`extensionPrice`); waiving needs `staff_can_waive_late_charge` and a reason (stored as a 0 charge with the reason).
- **Editing the recorded return time** (`edit_return_time`, decision 7): with a reason and an audit event, subject to `staff_can_edit_return_time`, until the order is archived, never in the future. It recalculates the late charge. If no money is allocated to the old late charge it is voided and replaced; if money is, **the difference is a new `difference` charge or a credit**, never an edit to a paid charge. It never moves a block (the time is in the past).
- **A difference function** (S5): `chargeDifference(old charge snapshot, new quote)` in `@mango/core`, used by `edit_return_time`, `change_rental_dates` and `cancel_rental` when a charge has money against it: a `difference` charge for the change, negative when it is a credit. Stage 5 core work.
- **Month-to-month** (decisions 3, 4, 17): a rental over 30 days is split at booking into date-to-date periods from the pickup; each is a continuation line priced at booking prices and frozen, and each period is its own charge with `due_at` at its start. The periods add up to the whole rental's price to the minor unit. **Across those charges** (M8, decision 17):
  - a **fixed coupon**, **flat-fee extras** and the **deposit** go on the first charge;
  - a **percentage coupon** applies to every period of the booked length (not to extensions);
  - **minimum spend** is judged on the whole booked rental;
  - time-priced extras follow each month's charge, and flat-fee extras go on the first charge only (decision 30).
  Core task, stage 6: `planBookedCharges(booking)`, which runs `decideDiscounts` once on the whole booked rental and returns the per-charge quote inputs (coupon placement, deposit on the first), with a test that the redemption amount equals the sum of the coupon's amounts over the charges.

### 6.4 The ledger and where Phase 7 attaches (M7, S8, decisions 14, 18, 25)

```text
payments            append-only
  id, tenant_id, order_id
  kind        payment | refund | deposit_in | deposit_out | deposit_hold | deposit_release
              | deposit_capture | credit_write_off
  method      cash | transfer | other        (Phase 7: card, promptpay)
  amount      bigint > 0
  currency    FK (tenant_id, currency) → tenants (id, currency), no cascade
  provider, provider_ref     null offline; Phase 7 fills them
  idempotency_key            unique per tenant (S6) for payment and refund
  receipt_ref, received_at, recorded_by, note
  rate_groups jsonb          per rate group: rate, gross, net, VAT, worked out once on this payment's total (paymentVat)
payment_allocations append-only
  id, tenant_id, payment_id, charge_id, amount
  rate_groups jsonb          per rate group: the gross this charge received from the payment
```

- **Every payment received gets its own tax invoice** (decision 25; printed in Phase 6). **Its VAT is worked out once, on the payment's total, per rate group, and shown once at the bottom (total, then net and VAT)**, not summed charge by charge (decision 27). Rounding is half up to the smallest currency unit. This holds for shops whose prices include VAT and shops that add it.
- **`paymentVat(payment, allocations)`** in `@mango/core`: from the charges the payment is allocated to, it adds up the gross the payment puts into each rate group, then per group works out VAT once on that gross (rate ÷ (100 + rate) of it, half up) and net = gross − VAT. It is the same formula for both tax styles, because a payment is always a gross amount: for a shop that adds VAT on top, the charge's gross already includes the VAT added. The result is stored on the `payments` row.
- **Allocations** still record what each charge received (its gross per rate group, the payment's amount split over the charge's groups in proportion to their gross, the charge's last allocation taking the rounding remainder so a charge's allocations add up exactly to its total). They decide when a charge is settled; they are not where invoice VAT comes from. A charge's own VAT (its snapshot) and the VAT on the invoices that paid it can differ by a minor unit per group; the invoices are the documents of record.
- **Balance = total of non-void charges − payments + refunds (+ credit write-offs), whatever the allocation. A charge is settled when its allocations equal its total.** Deposits are outside it.
- **Credits:** a negative balance. Cancelling an order with payments voids its charges and leaves the payments as credit (decision 18). A credit stays until refunded (`staff_can_refund`) or written off (`staff_can_write_off_credit`), and blocks archiving (decisions 12, 14).
- **The currency** is held by the foreign keys on `orders`, `order_charges` and `payments` (no cascade: a currency change is refused while any exists), not by `tenants_lock_currency()`'s unlocked `exists` (S8).
- **Phase 7 attaches here:** `payment_accounts`, `webhook_events`, `scheduled_charges(order_charge_id, due_at)`, card holds as `deposit_hold`/`deposit_release`/`deposit_capture` with `provider_ref`, card refunds as `refund` rows after the provider confirms, and the payment deadline. A shop cancellation fee (decision 18) is Phase 7.

## 7. The marketplace switch (3M)

Designed here, built in 3M with its own plan.

### 7.1 `marketplace_api`

`security definer` functions in a `marketplace_api` schema, **executable by `service_role` only** (decision 15), returning only listed and approved shops: `get_shop`, `list_featured_shops`, `get_catalog_model`, `search_offers` (assigned-unit availability, the stricter notice, minor units and currency), `get_listing`, `get_availability`, `get_quote` (inputs; the price from `quote()`), `get_shop_signals` (from orders with `channel = marketplace`), `create_booking`, `get_booking`, `list_customer_bookings`, `cancel_booking`, and a `marketplace_events` outbox (`booking.accepted`, `.declined`, `.expired`, `.cancelled`, `.picked_up`, `.returned`, `.no_show`).

**The booking rules** stay in TypeScript: `bookOnline()` moves to a **shared server-only package** (decision 15), used by the platform's booking page and the marketplace server. The static test that no file calls the booking entry with an online channel except that package covers **both apps**.

### 7.2 The order insert for `channel = marketplace`

`create_booking` → `create_order` with `channel = marketplace`, in the §4.2 order: product-and-location locks → unit locks → unit rows → products → **listing rows** (the cap) → coupon → **customer upsert** by `(tenant, marketplace_account_id)` → order insert → rentals → reservations → blocks → charges and lines → `marketplace_events` → counter. Request mode: `status = requested`, no unit held, counted against `request_units` under the listing row; accepting runs `reserve_core`.

### 7.3 The fee record (decision 23, replaced 19 Nov 2026; decision 26)

The fee record is marketplace-owned (`public.marketplace_fees`, keyed by order id) and **fixed at booking**.

- **Base: everything booked through Moto Mangos at booking, for the whole booked length** (a 90-day booking pays on all 90 days; no 30-day cap): the rental after any discounts or coupons, plus paid extras (phone holder, insurance or cover, and so on) and delivery.
- **Never the security deposit.**
- **VAT:** the base is what the renter sees: including VAT for a shop whose prices include it; before VAT for a shop that adds it on top.
- **Fee:** 10% of the base, **rounded to the nearest whole unit of the currency, half up**; at least the market currency's minimum (฿50 for THB).
- **Extensions and further months** arranged with the shop afterwards are outside Moto Mangos and carry no fee. Moto Mangos never tracks or charges recurring monthly rentals; an order's later `extension` and `period` charges are invisible to the fee.
- **Receipt:** Moto Mangos's own fee gets a standard receipt from Mango Works, not a tax invoice (decision 26). **Confirm with Korn before Phase 8.**
- `create_booking` returns the base it used (rental after discounts, extras, delivery, and whether VAT is inside), so the marketplace computes the fee from the platform's figures and stores both.

**`apps/marketplace/lib/fees.ts` against this, Phase 8 code changes** (not changed here):

| `fees.ts` today | Change needed |
| --- | --- |
| `bookingFee(rentalAfterPromotion, …)`: the base is the rental after promotion only; "extras never count" | The base adds paid extras and delivery |
| No VAT input | Take the base as shown to the renter (gross with VAT included; before VAT when added on top) |
| `feeRoundingUnit` lets a market round to a multiple (e.g. ฿10) | Nearest whole unit only (decision 23); drop the setting or fix it at 1 |
| `min(…, rentalAfterPromotion)`: the fee is never more than the rental | Not in decision 23. With the minimum, a very small booking would pay a fee above its base unless this cap stays: keep the cap (now on the whole base) unless Mark says otherwise |
| `priceBreakdown`: due at shop = rental after promotion − fee + extras; no delivery line | Due at shop = base − fee (+ delivery when paid at handover); the breakdown gains a delivery line, and the fee line includes extras and delivery |
| Minimum per market currency; half-up rounding; integers in minor units | Already as decided |

## 8. Build stages

One PR each. Migrations local only until Mark says otherwise; staging as each merges, on his word. **Fable build** = built on Fable (locks, RLS, money, availability, job SQL). **Opus + Fable check** or **review** = built on Opus, reviewed by Fable before merge (the security-definer reads of stage 7 are reviewed, decision 31).

| # | Stage | Migration | Model | Accept tests |
| --- | --- | --- | --- | --- |
| 1 | **Unit lock rules** | 1 | Fable build | Two opposite `move_unit()` calls on a gate: 0 deadlocks, 30 rounds × 3 shops; direct product change refused; two-unit status change vs two-product booking on a gate: 0 deadlocks (fails on today's trigger); lost while out and with future bookings succeeds, future bookings at risk; catalog review vs product delete: 0 deadlocks; the static lock-strength test |
| 2a | **Orders: tables, RLS, customers, settings** | 2 | Fable build | **Migration 2 deletes every Phase 2 reservation, its allocation and hold blocks, and every coupon redemption, on staging and locally; the seed is rerun after it.** On live the count before the push must be 0, or the push stops. Isolation for every new table (5 roles × 2 shops, stranger, MM customer, anon); `staff_may` for each setting and role; customer contacts never in audit; `move_unit` split copies `rental_id`; currency FK refuses a currency change |
| 2b | **The core and the test port** | 3 | Fable build | `reserve_core` with orders and rentals; `platform.reserve()` gone; **Phase 2's database tests (`reservations`, `availability`, `booking-rules`, `coupons`, `product-extras` races and checks) ported to `create_order`, with the same rounds and outcomes; `staff-booking.ts` and `book-online.ts` call `create_order`; `bookOnline()` moved to the shared package**; a non-unit FK failure raised, never `unit_taken`; any inner refusal leaves nothing written; idempotent `create_order`; 200-line booking timed, 201 refused; per-customer coupon limit under a race; numbering: 50 parallel orders, no duplicate number or code |
| 3 | **Payments ledger** | 4 | Fable build | Append-only for every role; balance exact after 20 parallel payments, a refund and a cancel in any order; `paymentVat` works VAT once on each payment's total per rate group, half up (inclusive and on top, THB, USD, VND), and a payment covering three month charges gives one VAT figure per group, not a sum of three; a charge's allocations add up exactly to its total; idempotent payment and refund; refund and write-off per setting; deposits outside the balance |
| 4 | **Status machine** | 5 | Fable build | Every transition and revert by each role and setting; derived state for every mix; pickup blockers; late return clipped, never refused; late charge after 60 minutes' grace, waivable per setting; revert-return voids its charge and is refused with money allocated; sale stock out and back; held-order expiry settled first by every function |
| 5 | **Order edits, add to order, coupon swap** | 6 | Fable build | §5.2 races; `add_to_order` on reserved and picked-up orders; date change keeps units when free; `chargeDifference` core (stage task) on a paid charge; repeat hold then confirm; **gate test: `save_order` adding a rental against `pick_up` of the same order** (one waits, the other `try_again` or both clean) |
| 6 | **Rental changes and long rentals** | 7 | Fable build | Redesign's swap tests; swap refused on an overdue rental; breakdown swap into repair; extend vs a booking of the next days; **gate test: `extend_rental` against `move_unit()` of its unit** (`try_again` or clean, never a half move); early return vs a booking of the freed time; `edit_return_time` with and without money against the late charge; month periods telescope; `planBookedCharges` (decision 17) and the redemption sum; stacking coupon with a credit |
| 7 | **Reads** | 8 | Opus build + Fable review (decision 31) | `order_list` filters (status, payment status, shortage, at risk, overdue, channel, dates, search by number, customer, phone, plate) per role; `today_board` writes nothing; `order_history` for staff without audit access; cross-tenant test per read; response times |
| 8 | **Jobs, outbox and email** | 9 | Fable build (job SQL); sender Opus + Fable check | Each job twice writes once; the close job touches only orders the sweep already expired, `skip locked`; overdue 1/3/15/30 in a DST shop shown on the Dashboard; **with sending off, nothing reaches the transport** and every message is queued; against the fake transport with the switch on: end-of-rental email in the customer's language, renewal reminders, retry and failure, old messages expired rather than sent |
| 9 | **New order and the order page** | None | Opus + Fable check | Playwright 375 and 1280 px: **full new → reserved → picked up → returned → archived**; an overlap refused "This vehicle is booked from … (order #…)"; add to order; hold expiry; Thai at phone width |
| 10 | **Today board, order list, Settings › Orders** | None | Opus + Fable check | Four tabs with counts, Late highlighted; search by plate and phone; the six staff permissions switch screens and are refused by the database when off |
| 11 | **Gantt and month calendar** | None | Opus + Fable check | Drag to reassign; drag-extend **re-prices** with a confirmation; drag onto a taken slot refused in words; phone read-only |
| 12 | **Customer coupons and wrap-up** | None | Opus + Fable check | "Uses per customer" on the form; returning discount from real orders; Retire offered for a reserved service; demo seed in every status; accept suite named per spec line; help articles (Fable checks payments and refunds); doc edits (§13); staging on Mark's word |

Stage 3 must precede stage 4 (reverts check allocations). Stage 7 can start once 4 merges; stages 9 to 11 need 7.

## 9. Screens

| Screen | Address | First | Who | What |
| --- | --- | --- | --- | --- |
| **New order** | `/[tenant]/new-order` (Phase 2 stage 11's screen continued) | Phone | Owner, manager, staff | Dates and place → products with prices → vehicles (quantity makes that many rentals; name a unit optional) and extras → customer (search or add) → coupon, price change with a reason (setting) → summary (long rentals: a line per month, what is due when) → Hold, Save as draft, Reserve |
| **Order page** | `/[tenant]/orders/[id]` | Both | Owner, manager, staff | Rentals with unit, dates, derived status, shortage and at-risk flags; charges with their lines; balance, payments, credit, deposit; actions by status (Pick up, Return, Edit return time, Extend, Swap, Return early, Add, Change vehicle, Change dates, Cancel, Take payment, Refund, Write off, Revert, Archive), each shown only when allowed; **History from `order_history`** |
| **Today board** | Dashboard | Phone | Everyone (mechanic, driver: no money or contacts) | Today, Tomorrow, Upcoming, Late with counts; Late highlighted; at-risk bookings |
| **Orders / list** | `/[tenant]/orders` | Both | Owner, manager, staff | Search; quick filters; full filters (§8 stage 7) |
| **Unit timeline** | `/[tenant]/calendar?view=timeline` | Desktop (phone read-only) | Edit: owner, manager, staff; read: everyone | Rows per unit, unassigned lane, overdue bars to now; drag to reassign or extend |
| **Month calendar** | `/[tenant]/calendar?view=month` | Desktop (phone: day list) | Everyone | Pickups and returns per day |
| **Customer** | `/[tenant]/customers/[id]` | Both | Owner, manager, staff | Contacts, notes, orders, completed rentals |
| **Settings › Orders** | `/[tenant]/settings/orders` | Desktop | Owner, manager | Alert days, end-of-rental email, grace minutes, archive days, swap options, **the six staff permissions** |

375 px for every staff screen; English and Thai together; Thai lines on a review list for Korn; no new dependency for the Gantt.

## 10. Tests with true concurrency

On gates (never `pg_sleep`), in Bangkok THB, New York USD (DST) and Saigon VND, many rounds, exact outcomes, nothing half-written, deadlock count unchanged:

1. Phase 2's races, ported to `create_order` (staff/online/both; last unit, last coupon use, cap).
2. Last per-customer coupon use, same customer, two staff.
3. Coupon swaps (§5.2).
4. **`extend_rental` vs `move_unit()`** of the same unit (M3).
5. **`save_order` adding a rental vs `pick_up`** of the same order (M3).
6. Swap onto the last free unit, two at once; swap vs new booking; swap vs extension.
7. Return (early, late) vs a booking of the freed time; revert-return vs that booking.
8. Pickup vs `assign_order_units`; pickup vs the unit put into repair; lost while out.
9. Cancel vs confirm; any order function vs the hold sweep at the expiry instant (settled once).
10. 20 parallel payments, a refund and a cancel on one order.
11. 50 orders at once (numbering).
12. Opposite `move_unit()` calls; a two-unit status change vs a two-product booking; catalog review vs product delete.
13. The three jobs beside 1, 7 and 9.

Not truly testable: race tests prove the timings they hit; real Resend sends (one by hand on staging); poor connections (Phase 5); the marketplace path (3M); card payments (Phase 7).

## 11. Decisions and open points

### 11.1 Mark's decisions, 19 Nov 2026

| # | Decision | Where |
| --- | --- | --- |
| 1 | Orders sit on top of reservations; Phase 2 tests are ported | §2.1, stage 2b |
| 2 | Any number of vehicles per order, each its own rental; a rental is exactly one unit; only gear has a quantity; line cap raised (200) | §2.2 |
| 3 | One charge per month period of a long rental; the tax invoice follows each payment | §3.2, §6.3, §6.4 |
| 4 | Future periods priced at booking and frozen | §6.3 |
| 5 | Hold runs out: staff order → draft, online → canceled | §2.3 |
| 6 | Staff permissions are shop settings, checked in the database | §3.9, §3.10, stage 10 |
| 7 | A late return clips the next buffer and flags it; recorded return time, editable with reason and audit until archived; a paid charge is never edited | §2.6, §6.3 |
| 8 | Late charge offered at return, on by default, waivable with a reason, after the grace | §6.3 |
| 9 | Unit into repair: booking stays, at risk, staff reassign | §2.6 |
| 10 | No direct `reserve()`; every booking is an order | §3.3 |
| 11 | Per-shop order counter with gaps; tax invoice numbers are a separate gapless sequence (Phase 6) | §3.2, §1.2 |
| 12 | Auto-archive 7 days after return when settled, with no credit and no open future charge; by hand too | §3.6 |
| 13 | Coupons on extensions judged on the original pickup and length; no new use; not re-judged on dates | §5.3, §6.1 |
| 14 | Credit stays until refunded or written off; write-off per setting, in the ledger stage | §6.4, stage 3 |
| 15 | `bookOnline()` to a shared server-only package; `marketplace_api` service-role only; static test over both apps | §7.1, stage 2b |
| 16 | Neutral Mango Works sender, reply-to the shop; needs a verified sending domain (Phase 6) | §3.6 |
| 17 | Long-rental charges: fixed coupon, flat-fee extras and deposit on the first; percentage coupon on every booked period, not extensions; minimum spend on the whole booked rental | §6.3 |
| 18 | Cancelling with payments leaves a credit; refunds per setting; cancellation fee in Phase 7 | §6.4 |
| 19 | Lost at any time; an out rental stays open; future bookings at risk | §2.6, stage 1 |
| 20 | `add_to_order` for reserved and picked-up orders | §3.3, stage 5 |
| 21 | Late-return grace: shop setting, default 60 minutes | §3.6, §6.3 |
| 22 | A draft can be held again; one hold expiry per order | §2.3 |
| 23 | **Replaced, 19 Nov 2026.** Moto Mangos fee: 10% of everything booked through Moto Mangos at booking, for the whole booked length (no 30-day cap): the rental after discounts or coupons, plus paid extras and delivery; never the deposit; extensions and later months arranged with the shop carry no fee and are never tracked; the base is what the renter sees (with VAT when prices include it, before VAT when it is added on top); a minimum per currency (฿50 for THB); rounded to the nearest whole unit, half up; fixed at booking. SPEC, INTEGRATION and the marketplace SPEC corrected; `fees.ts` changes listed for Phase 8 | §7.3, §13 |
| 24 | Phase 2 reservations and redemptions cleared on staging and in the seed at migration 2 | stage 2a |
| 25 | Every payment gets its own tax invoice | §6.4 |
| 26 | Moto Mangos's own fee gets a standard receipt from Mango Works, not a tax invoice. **Confirm with Korn before Phase 8** | §7.3, §11.2 |
| 27 | A payment's tax invoice works VAT out once on the payment's total, per rate group, shown once at the bottom (total, net, VAT); not summed charge by charge; half up to the smallest unit; for both tax styles. Allocations still record what each charge received | §6.4, stage 3 |
| 28 | Phase 3 ships with emails switched off; end-of-rental and overdue alerts on the Dashboard only; sending turns on in Phase 6 once a domain is verified | §3.6, §1.2, stage 8 |
| 29 | Overbooking accepted: a vehicle rental may wait for its unit, shown as a shortage; never more than one unit | §2.2 |
| 30 | Long rentals: time-priced extras follow each month's charge; flat-fee extras on the first charge only | §6.3 |
| 31 | Stage 7 (reads) is an Opus build with a Fable review | §8 |

### 11.2 Open points

1. **Moto Mangos fee receipt** (decision 26): a standard receipt from Mango Works, not a tax invoice. **Confirm with Korn before Phase 8.**
2. **The fee's ceiling** (found checking `fees.ts`): today the fee is never more than the rental. Decision 23 does not say; with a ฿50 minimum, a booking whose whole base is under ฿50 would otherwise pay more in fee than it costs. §7.3 keeps the ceiling (now on the whole base) for Phase 8 unless Mark says otherwise.

Draft 2's other open points (the VAT on a payment, one invoice for several month charges, the sending domain, overbooked vehicles, extras on long rentals) are settled by decisions 27 to 30, with no Korn check left on them.

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Deadlocks from the new row classes | §4.2, the static and reviewed-writers tests, deadlock count in every race |
| Stale reads between the unlocked read and the locks | The re-read and `try_again` (M3), with gate tests |
| Intent and derived state disagreeing | One `order_state()`; an invariant check after every race round |
| Money drift | No cached balance; balance and settled status are computed from charges, payments and allocations |
| A charge's VAT and its paying invoices' VAT differing by a minor unit | Expected (decision 27: VAT is worked on each payment's total); the invoices are the documents of record; a test pins the difference to at most one minor unit per rate group per payment |
| Porting Phase 2's tests loses coverage | Same files, same rounds, same outcomes, counted before and after in stage 2b |
| Clearing Phase 2 rows (decision 24) | Staging and seed only; live must count 0 before the push |
| Scope: thirteen stages | Database first; screens on Opus with Fable checks |
| The Neon move after Phase 3 | Jobs only queue; the sender is app-side |

## 13. Doc edits this plan will need (owner keeps the spec)

- `docs/platform/SPEC.md`: Data model (orders, rentals, charges, lines, payments, allocations, customers; `allocations` → `reservations` + `unit_blocks`); Orders and calendar (§2.3's statuses); Phase 3 accept line; "Remove for good" under Phase 1b. **Done in this PR:** the Moto Mangos fee wording (Product scope item 4 and the market table).
- Root `CLAUDE.md`: §4.2's lock order (stage 2b); `apps/platform/CLAUDE.md`'s "allocations/downtime".
- `docs/INTEGRATION.md`: at 3M, §7. **Done in this PR:** the fee base (§1, §3.9, §3.12).
- `docs/marketplace/SPEC.md`: **done in this PR:** the fee base (extras, delivery, checkout order, receipt).
- `docs/PROGRESS.md`: an entry per stage.

## 14. Changes since draft 1

| Item | Change | Section |
| --- | --- | --- |
| **M1** | `reserve_core` written for orders: takes order and rentals, inserts them after the coupon row; unit-only FK handler; nothing written before ok, inner refusals raised; `reserve()` dropped; tests and both callers ported in 2b; cap 50 → 200 with reason | §2.2, §3.3, §3.8, §8 (2b) |
| **M2** | No `current_reservation_id`; live reservations by `rental_id`; `move_unit()` copies `rental_id`; rental product and place "as booked", live ones derived; `orders.location_id` dropped; advisory locks from reservations | §2.2, §3.2, §3.8, §4.2, §4.3 |
| **M3** | Read unlocked, advisory, order row, read again, `try_again`; gate tests extend vs `move_unit`, `save_order` vs `pick_up` | §3.3, §8 (5, 6), §10 |
| **M4** | `has_shortage`, `at_risk` dropped, computed in reads; `today_board` writes nothing; close job only after the sweep, order row first `skip locked`; `assign_order_units` wrapper; §4.3 follows §4.2 | §2.6, §3.3, §3.6, §4.3 |
| **M5** | One `hold_expires_at` per order; run-out hold settled first; draft held again; `confirm_hold` core reads live reservations | §2.3, §3.3 |
| **M6** | `add_to_order`, charge kind `addition`, stage 5 | §3.3, §8 |
| **M7** | Tax invoice per payment; append-only `payment_allocations` with `paymentVat`; new balance formula; settled derived | §6.4, stage 3 |
| **M8** | Coupons, extras, deposit across month charges; `planBookedCharges` in stage 6 | §6.3 |
| **S1** | Product change only via `move_unit()`; statement-level counts trigger; gate tests; static lock-strength check (not `pg_locks`) | §4.1, stage 1 |
| **S2** | `completed_rentals` derived; no customer lock on returns or reverts | §3.1, §4.3 |
| **S3** | Intent stored; reserved, picked up, returned, mixed derived | §2.3 |
| **S4** | Lost at any time; `units_guard` rule changed | §2.6, stage 1 |
| **S5** | `revert_return` voids its charge, refused with money; `chargeDifference` in stage 5 | §2.3, §6.3 |
| **S6** | Idempotency keys on `create_order`, `record_payment`, `record_refund` | §3.2, §6.4 |
| **S7** | Migration 2 clears Phase 2 rows on staging and in the seed, then reseeds | stage 2a |
| **S8** | `deposit_hold`, `deposit_release` now; currency by foreign key | §6.4, §3.2 |
| **S9** | Stage 2 split into 2a and 2b; ledger before status machine; reads and job SQL Fable builds; numbering fixed (nine migrations, thirteen stages) | §3.8, §8 |
| **S10** | `order_history` read | §3.9, §9 |
| Minor | Swap refused when overdue; breakdown swap into repair; `closed_at` column; gear return wording; fines on `picked_up_at`/`returned_at`; confirmed and canceled emails to Phase 6; "unpaid past due" waits for Phase 7 | §6.2, §3.2, §2.2, §1.2, §3.6 |
| Scope | "Remove for good" moved to Phase 1b (migration and stage removed) | §1.2, §3.7, PROGRESS |
| Decisions 1–25 | Written in; draft 1's 16 questions replaced | §11.1 |
| **Decision 23 replaced** (19 Nov 2026) | Fee on everything booked through Moto Mangos for the whole booked length, deposit never, VAT as the renter sees it, per-currency minimum, whole-unit half-up rounding, fixed at booking; `fees.ts` differences listed for Phase 8; SPEC, INTEGRATION and the marketplace SPEC corrected | §7.3, §11.1, §13; `docs/platform/SPEC.md`, `docs/INTEGRATION.md`, `docs/marketplace/SPEC.md` |
| **Decision 26** | Fee receipt, not a tax invoice; confirm with Korn before Phase 8 | §7.3, §11.2 |
| **Decision 27** | Invoice VAT once on each payment's total per rate group; `paymentVat()` and the allocation rule rewritten; "pending Korn" marks removed | §6.4, §8 stage 3, §12 |
| **Decision 28** | Emails switched off in Phase 3; Dashboard alerts only; sending on in Phase 6 | §3.6, §1.2, §8 stage 8 |
| **Decision 29** | Overbooked vehicle rentals accepted | §2.2 |
| **Decision 30** | Time-priced extras per month charge; flat-fee extras on the first only | §6.3 |
| **Decision 31** | Stage 7 an Opus build with a Fable review | §8, Summary |
