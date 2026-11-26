# Phase 3 plan: orders and calendar

**Draft 2, 19 Nov 2026.** Plan only: no code, no migration, nothing applied anywhere. Draft 1 (`45dd93f`) was critiqued by Fable ("needs a second draft"); this draft applies every item of that critique and Mark's 25 decisions of 19 Nov 2026, then his answers to draft 2's open points (decisions 23 replaced, 26 to 32, same day), the ledger changes from the payments design (PR 56 §10, decisions 33 to 42), our own caller functions ahead of the planned move to Neon (decision 43), and Fable's re-check of draft 2 ("fix these first", 16 plan-text fixes; the design stands). §14 lists each change and where it went.

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
| **11** | Custom roles, transfers (return elsewhere), platform admin, **custom information fields on an order, if shops ask** (§9.1) | Return place = pickup place |
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
| `booked` returned → `archived` | `archive_order`, the nightly job | Decision 12; never with an open chargeback (decision 35) |
| **Reverts** (setting `staff_can_revert`, default off) | | |
| out → reserved | `revert_pickup` | Sale items' stock put back |
| returned → out | `revert_return` | **Voids that return's late or early charge; refused if money is allocated to it** (S5); block end restored, refused `unit_taken` if re-booked. Intended difference from `cancel_order`, which **does** void a charge with money on it and turns that money into a credit: a cancel ends the order and leaves the customer's money visible as a credit, while a revert undoes one step and must not quietly move money that a tax invoice already shows against that charge |
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
- Phone and email are never copied into audit snapshots (recorded as `changed`). **As built (stage 2a): the LINE id too**, since it is a contact like the other two; the customer's own audit trigger (`customers_audit`) does it, so a direct write by the server is covered as well. The name, nationality, language and notes are recorded as any column is.
- Owner, manager, staff read and write (through `save_customer`); mechanics and drivers none.
- **As built (stage 2a):** `created_by`, `created_at` and `updated_at` are there too. `phone` is stored as E.164 when `save_customer` is handed an international number (`+…` or `00…`), else as typed: reading a national number needs the country, which is the form's to supply (no phone library in the database).

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
                  | cancellation_fee (allowed now, written from Phase 7: decision 41)
  currency (FK as orders), priced_at, due_at
  total, tax_total, deposit, rate_groups jsonb, snapshot jsonb
  status          open | void          ("settled" is derived: its allocations equal its total, M7)
order_lines
  id, tenant_id, order_id, charge_id, rental_id
  kind            period | extra | sale_item | fee | credit | manual | marketplace_fee (negative; written at 3M: decision 38)
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
- **As built (stage 2a, migration `20261124000100_platform_orders`), where it differs from the lists above and why:**
  - **The "who" columns are plain ids, with no foreign key to `auth.users`** (`created_by`, `picked_up_by`, `returned_by`, `override_by`): root `CLAUDE.md` forbids a new key to the `auth` schema ahead of the Neon move. They get a key once the platform has its own users table.
  - **`order_lines.currency` has the same foreign key to the shop's currency** as `orders` and `order_charges` (no cascade): one more holder of the currency, never fewer.
  - **A line's charge and rental, and an extra's parent rental, must belong to the line's (or the extra's) own order**: the keys are `(tenant_id, order_id, id)`.
  - **`orders.mode`** takes the reservations' list (`staff`, `instant`, `request`, `now`). **`request_status`, `cancelled_by` and `cancel_reason` are free text for now**: the plan and the spec name no values, so each list is fixed by the stage that first writes the column (`cancel_order` in migration 3; requests at 3M).
  - **`orders.number` may be empty** until migration 3 adds the deferred check (§4.2): the number is written last.
  - **`order_counters`** gets its row from a trigger when a shop is made (and for every shop there is, in the migration); it has no `updated_at` and no audit, since it changes with every order and the order's own event carries the number. Nobody signed in has any grant on it.
  - **`order_lines.tax_profile_id` is a plain id** (a snapshot, with the profile's name beside it), so a tax profile can still be deleted when nothing prices from it.

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
4. **Settle a run-out hold**: if `status = new` and `hold_expires_at` has passed by `clock_timestamp()`, apply decision 5 now (releasing still-held reservations, which the advisory locks already cover). **The settlement is kept, whatever happens next** (item 7 of the re-check):
   - Functions that need the hold (`confirm_order`, `assign_order_units` and `save_order` on a `new` order, `swap_order_coupon` on a `new` order) commit the settlement and **return** `{ok: false, reason: 'hold_expired'}`. The refusal is returned, not raised, so nothing rolls the settlement back.
   - Functions that don't need the hold (`hold_order`, `reserve_order`, `cancel_order`, `cancel_rental`, `unreserve_order`, `restore_order`, `save_order` on what is now a draft) carry on from the settled state in the same transaction.
5. **Read again.** If the products, places, units or rentals differ from step 1, answer `try_again` (returned, not raised) with nothing written beyond step 4's settlement (as `cancel_reservation` does today).
6. Write nothing until `reserve_core` (or the inner core it calls) answers ok. The work after step 5 runs in an **inner block** (a savepoint): any inner refusal is raised there (a `P0001` with the reason), caught by that block, and answered `{ok: false, reason}` with that block's writes undone and step 4's settlement kept.

`lock_timeout = '6s'` on each; callers answer `try_again` for `55P03`, `57014`, `40P01`.

| Function | Does | Migration |
| --- | --- | --- |
| `create_order(tenant, order)` | New order, rentals, lines, charge(s), through `reserve_core` in hold, reserve or draft mode. **Idempotency key** (S6): a repeat answers the first result | 3 |
| `hold_order`, `reserve_order`, `confirm_order` | §2.3. The `confirm_hold` core is re-created **in migration 3, with `hold_order`**: it reads live reservations only (M5), so re-holding a draft and confirming works from the first day. `reservations.hold_expires_at` is always copied from `orders.hold_expires_at` | 3 |
| `unreserve_order` | §2.3 | 6 |
| `cancel_order`, `cancel_rental`, `restore_order` | §2.3; a paid charge gets a `difference` charge (S5) | 3, 6 |
| `assign_order_units(order, rental, units)` | Named wrapper around the `assign_units` core (M4): before pickup, fill a shortage or change the unit | 3 |
| `pick_up`, `return_rental`, `revert_pickup`, `revert_return`, `archive_order`, `unarchive_order` | §2.3 | 5 |
| `save_order`, `change_rental_dates` | Draft/new edits; dates before pickup; a paid charge gets a `difference` charge (S5) | 6 |
| `add_to_order(order, rentals)` | Gear or another vehicle added to a booked order, reserved or picked up, through `reserve_core`; its own charge, kind `addition` (M6, decision 20) | 6 |
| `extend_rental`, `swap_rental_unit`, `return_early`, `edit_return_time` | §6 | 7 |
| `record_payment`, `record_refund`, `record_deposit` (staff wrappers) and their `platform_private` cores; `write_off_credit` | §6.4. The cores take provider and system rows (no `staff_may`, no overpayment refusal); the wrappers check role, setting and overpayment (decision 40). Idempotency keys on staff payments and refunds (S6); provider rows unique on `(provider, provider_ref, kind)` | 4 |
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
| 1 | `platform_unit_lock_rules` (`20261123000100`, built) | 1 | `platform_private.app_uid()` and `app_role()`, **reading the request's claims** (§3.11, decision 43); `units_guard`: a product change only inside `move_unit()` (the transaction-local marker of §4.1), one sold/retired/lost change per transaction **unless every such unit's lock is already held** (§4.1), lost at any time; `move_unit()` re-created to set and clear the marker and refuse a second call; `units_clamp_product_counts` replaced by **two statement-level triggers** (update, delete) that lock every affected product row in id order once (§4.1); `review_catalog_request` locks products before its catalog entry, **and no longer switches a Moto Mangos listing on: approve and merge set `catalog_id` and `catalog_approved_at` only** (Mark, 20 Nov 2026; added to this migration 23 Nov 2026); the unit lock's key in one place (`unit_lock_class()`, `unit_lock_key()`, `holds_unit_lock()`; `lock_units()` re-created to use them) |
| 2 | `platform_orders` (`20261124000100`, built) | 2a | Clears Phase 2 reservations, their allocation and hold blocks, and coupon redemptions (S7, decision 24); `customers`, `orders`, `rentals`, `order_charges`, `order_lines`, `order_counters`; `reservations.rental_id` (nullable); **`move_unit()` re-created to copy `rental_id` on a split** (M2); staff permission columns and `staff_may()`; RLS; `save_customer`, `save_staff_permissions`. The kind lists already allow `cancellation_fee` on charges and `marketplace_fee` on lines (decisions 38, 41). **As built:** also `tenants.time_step_minutes` (§9.1), `booking_roles()` re-created with the actions `orders` and `order_settings` (§3.9), and the `citext` extension for `customers.email`. **Not in it:** a function that changes the time step (the column is there, default 15; **its writer goes in migration 9**, the owner, 24 Nov 2026), and §3.6's other shop settings (grace minutes, archive days, alert days), which this row never listed |
| 3 | `platform_order_core` | 2b | **Checks again for reservations with no `rental_id`, and clears them (with their blocks and redemptions) as migration 2 did, before** `reservations.rental_id` is set not null (S7; on live the count must be 0 or the migration stops); `reserve_core`; `create_order`, `hold_order`, `reserve_order`, `confirm_order`, `cancel_order`, `assign_order_units`; `confirm_hold` (live reservations only), `cancel_reservation`, `assign_units` moved to private cores; **`platform.reserve()` dropped**; coupon redemption `customer_id` foreign key; the deferred check that every order has its number (§4.2). **Added 24 Nov 2026 (review of PR 77 and the owner's decisions):** the value lists of `orders.cancelled_by` and `cancel_reason`, which `cancel_order` first writes here (`request_status` gets its list at 3M); **`currency_locked()` and the Settings action learn about orders in the same PR that adds `create_order`** (a shop with an order is otherwise refused by the bare foreign key, `23503`); ~~the constraint for "a specific unit can be on an order only once" (the owner's decision, 19 Nov 2026), when rentals gain a unit~~ **Clarified by the owner, 25 Nov 2026: "a unit on an order only once" means not twice at the same time.** Extensions, a long rental's monthly periods and a swap back to the first bike may all put the same unit on the order again, so there is **no new table constraint and no `rentals.unit_id`** (M2 stands; the no-overlap exclusion constraint on `unit_blocks` already keeps a unit off two bookings at once). Instead `reserve_core` / `create_order` and the `assign_units` core **refuse a request that puts the same unit on two lines of one order whose rental times overlap or touch** (`unit_twice`, not `unit_taken`), and the automatic pick follows the same rule; another period of the same unit on the order is allowed. **As built (stage 2b), also:** the migration is `20261125000100_platform_order_core`; `rentals.position` (the line a rental was booked as, for the answer and the idempotent repeat); `reservations (tenant_id, booking_id, rental_id)` keyed to `rentals (tenant_id, order_id, id)`, so a reservation's rental is one of its own order's; helpers `settle_order_hold`, `order_answer`, `store_charges`, `reserve_existing`, `order_caller`; one line per vehicle (a vehicle line with a quantity above 1 is `invalid_request`); `cancelled_by` is `customer`, `shop` or `system` and `cancel_reason` is `expired`, `customer_request`, `shop_request`, `no_show` or `other` |
| 4 | `platform_payments_ledger` | 3 | `payments`, `payment_allocations` (both append-only), with every kind, method and column of §6.4 (decisions 33 to 42: `refunds_payment_id`, `reverses_payment_id`, `deposit_source_id`, `capture_id`, `source`, nullable `recorded_by`, the provider unique index, `rate_groups` on deposit rows); `tenants.deposit_vat_mode` and `deposit_needs_tax_invoice()`; the cores and staff wrappers of `record_payment`, `record_refund`, `record_deposit`; `write_off_credit` |
| 5 | `platform_order_status` | 4 | `pick_up`, `return_rental` (late charge), reverts, archive, `pickup_blockers`, `order_state`, stock movements; `unit_blocks_guard` re-created so the return path can lengthen a **lost** unit's out block (§6.3) |
| 6 | `platform_order_edits` | 5 | `save_order`, `change_rental_dates`, `add_to_order`, `unreserve_order`, `cancel_rental`, `restore_order`, coupon swap (`swap_order_coupon`) |
| 7 | `platform_rental_changes` | 6 | `extend_rental`, `swap_rental_unit`, `return_early`, `edit_return_time`; swap settings |
| 8 | `platform_order_reads` | 7 | `order_list`, `today_board`, `timeline`, `order_history`, `bookings_at_risk`, `completed_rentals` |
| 9 | `platform_order_jobs` | 8 | Outbox kinds and columns, alert settings, the three jobs and their schedules; **the function that changes `tenants.time_step_minutes`, with the other order settings, before stage 10** (the owner, 24 Nov 2026) |

### 3.9 Who may do what, and RLS

`booking_roles(action)` gains order actions; **`staff_may(tenant, permission)`** (§3.10) is checked inside each affected function, not only in the UI. **As built (stage 2a):** two actions, `orders` (owner, manager, staff: see and work with orders, rentals and customers) and `order_settings` (owner, manager: archive, unarchive, Settings › Orders, the staff permissions); `apps/platform/lib/booking-permissions.ts` is their copy.

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

`platform_private.staff_may(tenant, permission)` is true for owners and managers always, and for staff when the setting is on. Every function in §3.9 calls it. **As built (stage 2a):** the permission is the setting's name without `staff_can_` (`change_price`, `waive_late_charge`, `edit_return_time`, `revert`, `refund`, `write_off_credit`); an unknown one raises `invalid_permission` rather than answering no; mechanics, drivers, non-members and a call with nobody signed in are answered no; the service role has no grant on it (the cores never ask it). **When staff can't refund, an early return by staff leaves a credit** for a manager to refund. Screen: Settings › Orders (stage 10).

### 3.11 Who is calling (decision 43)

Mark has decided to **move from Supabase to Neon after Phase 3**, before 3M and before BSR goes live, with a spike first as a go/no-go and live on an always-on compute (19 Nov 2026; `docs/platform/neon-move-plan.md`, branch `docs/neon-move-plan`). Sign-in then moves to Better Auth. **`app_uid()` and `app_role()` exist so that move changes one function body each, not every function**: Phase 3 reads the caller only through them.

- **Two functions in `platform_private`, created in stage 1 (migration 1):**
  - **They read the request's claims directly, not `auth.uid()` and `auth.role()`** (Mark, 23 Nov 2026, replacing "`select auth.uid()`" here): the same body works on Supabase now and on Neon later, where the claims arrive in the same setting.
  - `platform_private.app_uid()` returns `uuid`: `(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid`.
  - `platform_private.app_role()` returns `text`: the same claims' `->> 'role'`. Both return null when there is no request (pg_cron, a migration, a console) and do **not** guess a role for that case; each caller that needs a default states its own, as the audit function does today.
  - **Against Supabase's own pair** (checked in stage 1): `auth.uid()` and `auth.role()` still read the older settings `request.jwt.claim.sub` and `request.jwt.claim.role` first, then the claims. Nothing sets the older ones (PostgREST v16 sets `request.jwt.claims` only, and so do the tests), so the fallback is not copied; `caller-functions.test.ts` holds the two pairs equal for anon, a signed-in owner and staff, the service role and no request.
  - Both `language sql stable`, `set search_path = ''`; `revoke all … from public, anon`, then `grant execute … to authenticated, service_role`.
  - Names: `neon-move-plan.md` §5 names none (its §6.3 gives `caller_id()` and `caller_is_service()` only as examples), so the fallback names are used. `app_role() = 'service_role'` covers the second example.
- **Every new or re-created function, trigger, column default and policy in Phase 3 calls them** instead of `auth.uid()` or `auth.role()` directly: `created_by` and `recorded_by` defaults, every `booking_roles`/`staff_may` check, the service-role checks of the order and ledger functions, `order_history`, the cores. Policies keep going through the `my_tenant_ids()`-style helpers (root `CLAUDE.md`); those helpers are converted only when a stage re-creates them.
- **No sweeping rewrite.** Existing Phase 2 code (and older) is converted only when a stage already re-creates that function for its own reasons (for example `units_guard`, `move_unit()`, `unit_blocks_guard`, `confirm_hold`, the counts triggers).
- **A static test pins what is left.** `tests/db/caller-functions.test.ts` reads every function body (`pg_get_functiondef`), column default (`pg_attrdef`) and policy (`pg_policies`) in the `platform` and `platform_private` schemas and lists each direct `auth.uid()` and `auth.role()` use by name. It fails when a use appears that is not on its pinned list, and when the pinned list names one that no longer exists (so the list is shortened in the same PR that converts it). **The count can only go down.** The two functions themselves no longer call `auth.*`, so nothing is exempt. **Pinned after stage 1: 24 lines (19 functions, 4 column defaults, 1 policy).**
- No lock is taken by either function; §4 is unchanged.

## 4. Lock order

### 4.1 The stage 10 deadlock and the multi-row crossing (S1)

**Two bikes swapping products.** Today `units_product_not_retired` locks the new product `for share` and `units_clamp_product_counts` then the old `for no key update`; two moves in opposite directions deadlock. **Fix: a vehicle's product changes only through `move_unit()`, one unit per transaction**; `units_guard` refuses a product change made any other way (for the service role too).

- **The marker** (item 2 of the re-check). `move_unit()` sets a transaction-local setting, `platform.moving_unit`, to the unit's id just before it updates the unit, and sets it to `done` straight after. `units_guard` allows a product change only while the marker equals that row's id, so a later direct product change in the same transaction is still refused. `move_unit()` refuses to start when the marker is already set: **a second `move_unit()` in the same transaction is refused**, `one_move_per_transaction`. **Whatever the first call answered** (review of PR 70, 24 Nov 2026): the marker is set to `started` straight after that check, before anything that can answer early (`stale`, `try_again`, `bookings_changed`, nothing to do), because each of those answers leaves the call's locks held; the handler that turns a broken deadlock into `try_again` sets it again, since its rollback undid it. Only `not_allowed`, answered before the check with no lock taken, leaves the transaction open to another call.
- **Two opposite moves at the same place** serialise on their product-and-location advisory locks before either touches a row. **At different places** (A moves X→Y at place P, B moves Y→X at place Q) the advisory locks differ, but both then take both product rows **in id order, `for no key update`**, so they serialise on the product rows; still safe, because neither holds a product row while waiting for the other in reverse order (item 16).
- Gate tests: two `move_unit()` calls in opposite directions released at the same instant, once at one place and once at two places: one waits, both finish, 0 deadlocks; a direct `update units set product_id` is refused; a second `move_unit()` in one transaction is refused; a direct product change after a `move_unit()` in the same transaction is refused.

**A multi-row status change against a two-product booking.** `units_clamp_product_counts` is today a row trigger, `after update of status, product_id or delete … for each row` (`20261111001200_platform_clamp_booking_counts.sql:94`, renamed in `20261113000200`): an `update` of several units of products X and Y locks their product rows `for no key update` in whatever order the rows come, while a booking of X and Y holds `for share` on both in id order. **Rule: a statement that changes or deletes units locks every product row it affects once, in id order, before any row's counts are touched.**

- **Two statement-level triggers replace the row trigger** (item 1). A statement trigger with transition tables can carry neither a column list nor two events, so: `units_counts_after_update` (`after update … referencing old table as o new table as n for each statement`, no column list; it finds the units that stopped counting for a product by joining `o` to `n` on id: was active, now not active or on another product) and `units_counts_after_delete` (`after delete … referencing old table as o for each statement`). Each locks the `distinct` old product ids sorted, `for no key update`, then clamps each product and its listing.
- **Why a second trigger for delete, not "delete stays per row":** owners and managers can delete units directly through the table's policy, and nothing stops one statement naming units of two products; the stock functions happen to delete one product's units, but the rule must not depend on the caller. The per-row `units_busy_on_delete` before trigger is unchanged (it takes each unit's lock without waiting).
- **Sold, retired and lost: one unit per transaction, unless the transaction already holds every such unit's lock (as `lock_units()` takes them)** (item 16; the exception is Mark's, 23 Nov 2026). `units_guard` takes each such unit's lock in row order, so two such statements could cross. `units_guard` refuses a second unit changing to sold, retired or lost in one transaction (`one_unit_status_change`), checked **before** it takes the second unit's lock, using a transaction-local marker like `move_unit()`'s (`platform.unit_status_change`: the one unit whose lock the guard took itself, or `held` while every unit so far was held already; the two never mix).
  - **Why the exception.** Draft 2 said "the app changes these one unit at a time already". Not so for gear: `report_gear_problem()` marks several units lost, or writes several off (retired), in one call, and `set_stock_quantity()` retires several. Both take the product-and-location lock and then **all** their units' locks, sorted, through `lock_units()` before they update, so the guard asks for no lock it does not have and nothing can cross. **They are the only two users of this path.**
  - **What the guard checks, exactly:** that this transaction already holds the unit's lock. It cannot see how the lock was taken, so it does not check that the locks were taken sorted: that is the caller's part. **Only functions that take all their units' locks through `lock_units()` are meant to use this path**, and it is not reachable through PostgREST: no API call can take a unit lock and then update units in the same transaction except by calling one of those functions.
  - **How the guard knows.** `platform_private.holds_unit_lock(unit)` looks in `pg_locks` for this backend's granted advisory lock with the unit's key. The key (class `1a01`, `hashtext` of the id) comes from `unit_lock_class()` and `unit_lock_key()`, which `lock_units()` uses too, so the lock taken and the lock looked for can't drift. `pg_locks` can't tell a session-level lock from a transaction-level one: every unit lock is transaction-level (checked: `lock_units()`, both guards and `units_busy_on_delete`), and must stay so.
  - Tests: a two-unit `update … set status` to sold, retired or lost is refused with nothing changed; the same with only one of the two locks held, whichever; with both held it is taken; both gear functions still change several units in one call; `report_gear_problem()` against `set_stock_quantity()` on the same units, 30 rounds, 0 deadlocks.
- Gate test: a two-unit status change to maintenance (Y's unit first in the statement) against a booking of X and Y: one waits for the other, 0 deadlocks; fails on today's trigger. A two-product unit delete against the same booking: the same.

**"Never raise a lock level later"**: a transaction takes all its product rows at once, at the strongest strength it needs. `pg_locks` does not list granted row locks, so this is checked **statically**: a test reads every `platform`/`platform_private` function body (`pg_get_functiondef`) and fails when one function takes a `products` row lock in two different strengths, or a weaker one before a stronger one, **except for functions on a reviewed exception list**, each with its reason (item 15). The list starts with `swap_rental_unit`: it takes the old product's row `for no key update` when the old vehicle goes into repair and the new product's `for share`, two rows in two strengths by design, both taken at once in id order and never raised (it arrives in stage 6; the entry is kept in `lock-strength.test.ts` from stage 1). **Stage 1 found a second:** `save_product_extras` (Phase 2) takes the vehicle's row `for no key update` and then the extra products' rows `for key share`: different rows, the stronger one first, none raised; reviewed and listed with that reason. Where a race test needs to see held row locks it uses `pgrowlocks` if the local stack has the extension (Postgres contrib; enabled in the test database only).

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
   7. **insert of a new order** (its `number` still empty); **rental rows** (insert, or in id order for an existing order);
   8. **reservations**, then **unit_blocks**;
   9. **charges, lines, payments, allocations, redemptions, stock movements, outbox rows**;
   10. **`order_counters`**, last: the shop's counter row `for update`, then an **update of the new order's own row** to write its `number` (item 6). Updating a row the transaction itself inserted waits for nothing, so the counter stays the last lock any transaction takes. A deferred constraint trigger refuses a commit that leaves an order without a number.

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
| `record_payment`, `record_refund`, `record_deposit` (wrappers and cores), `write_off_credit` | None | None | order, payments, allocations. A duplicate provider row waits on the order row, then is answered idempotently: no new wait |
| `move_unit()` (re-created) | Where it is, goes, and its bookings name | The unit | unit row `nowait`, products `for no key update` in id order, reservations (copy `rental_id` on split), blocks, unit's own row. **No order or rental row** |
| Unit status change (one or many units to repair or active; **one unit per transaction** to sold, retired or lost, **or several whose locks the transaction already holds** (the guard checks that they are held, not that they were taken sorted; only `lock_units()` callers are meant to use this, and it is not reachable through PostgREST): `report_gear_problem()`, `set_stock_quantity()`, which take the product-and-location lock, then `lock_units()` over all their units) | The two gear functions: their product | Sold, retired, lost: that one unit; the gear functions: all theirs, sorted, before the update | unit rows, then **every affected product row once, in id order** (statement trigger), listing rows |
| Unit delete (one or many) | None | Each unit, without waiting (as today) | unit rows, then every affected product row once, in id order (statement trigger), listing rows |
| Downtime | As today | As today | As today |
| `review_catalog_request` | None | None | products in id order `for no key update`, then the catalog entry; on reject, listings. A product linked in between: `try_again`, nothing written. `lock_timeout = '6s'` (§4.4) |
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
| Refund VAT | A refund's credit note carries the VAT of the allocations it reverses (§6.4), stage 3 |
| Early-return outcome stored, never recomputed | `early_return` charge with its inputs in the snapshot |
| Lines never re-sorted | `order_lines.position`; no function updates amounts |
| An extra left behind when `move_unit` moves its vehicle to another place | At risk on the order; transfers are Phase 11 |
| A reserved service can't be deleted: offer Retire | Stage 12, screen only |
| "Remove for good" | **Moved to Phase 1b** (scope) |
| `write_template_days`: write only the day rows that changed, to cut audit volume | Follow-up from PR 57's review (21 Nov 2026), not in a stage yet. Today it deletes and re-inserts every day row, and since PR 57 audits `price_template_days`, each price list save writes about two audit rows per day row (about 60 for a 30-day list), unchanged days included |
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
- **A late return of a vehicle marked lost while out must succeed** (decisions 7 and 19; item 4). Today `unit_blocks_guard` (`20261116000100_platform_reservations.sql`, around line 205) refuses any block that covers more time than before on a unit that is sold, retired or lost. Migration 5 re-creates it with one exception: **the return path** (`return_rental`, which sets a transaction-local marker naming the reservation) may lengthen **that rental's existing `out` allocation** on a `lost` unit to the return time plus buffer. Every other lengthening on a sold, retired or lost unit stays refused, including by the same transaction outside that marker. Test: a scooter marked lost while out, found and returned two days late: the return succeeds, the block ends at the return time, the late charge is offered; extending the same rental or writing a new block on the unit is still refused `unit_not_in_fleet`.
- **Editing the recorded return time** (`edit_return_time`, decision 7): with a reason and an audit event, subject to `staff_can_edit_return_time`, until the order is archived, never in the future. It recalculates the late charge. If no money is allocated to the old late charge it is voided and replaced; if money is, **the difference is a new `difference` charge or a credit**, never an edit to a paid charge. It never moves a block (the time is in the past).
- **A difference function** (S5): `chargeDifference(old charge snapshot, new quote)` in `@mango/core`, used by `edit_return_time`, `change_rental_dates` and `cancel_rental` when a charge has money against it: a `difference` charge for the change, negative when it is a credit. Stage 5 core work.
- **Month-to-month** (decisions 3, 4, 17): a rental over 30 days is split at booking into date-to-date periods from the pickup; each is a continuation line priced at booking prices and frozen, and each period is its own charge with `due_at` at its start. The periods add up to the whole rental's price to the minor unit. **Across those charges** (M8, decision 17):
  - a **fixed coupon**, **flat-fee extras** and the **deposit** go on the first charge;
  - a **percentage coupon** applies to every period of the booked length (not to extensions);
  - **minimum spend** is judged on the whole booked rental;
  - time-priced extras follow each month's charge, and flat-fee extras go on the first charge only (decision 30).
  Core task, stage 6: `planBookedCharges(booking)`, which runs `decideDiscounts` once on the whole booked rental and returns the per-charge quote inputs (coupon placement, deposit on the first), with a test that the redemption amount equals the sum of the coupon's amounts over the charges.

### 6.4 The ledger and where Phase 7 attaches (M7, S8, decisions 14, 18, 25, 33 to 42)

```text
payments            append-only
  id, tenant_id, order_id
  kind        payment | refund | withholding | reversal | chargeback | credit_write_off
              | deposit_in | deposit_out | deposit_hold | deposit_release | deposit_capture
  method      cash | transfer | card | promptpay | deposit | other
              (card and promptpay accepted from the start, written from Phase 7: decision 41)
  amount      bigint > 0
  currency    FK (tenant_id, currency) → tenants (id, currency), no cascade
  refunds_payment_id     a refund: the payment it refunds (required for card and PromptPay; optional for cash) (decision 34)
  reverses_payment_id    a reversal: the refund, deposit return or chargeback it undoes;
                         a chargeback: the payment it takes back; unique (decision 35)
  deposit_source_id      a deposit_capture, deposit_release or deposit_out: the deposit_in or deposit_hold it draws on (decision 36)
  capture_id             a payment with method deposit: its deposit_capture row
  provider, provider_ref     null for staff entry; Phase 7 fills them
  source      staff | provider | system   (decision 39)
  recorded_by nullable: set for source = staff, empty for provider and system rows
  received_at passed in by the caller: for a provider row, the provider's time of payment
              (it dates the tax invoice); never defaulted to now for one
  idempotency_key            unique per tenant (S6) for staff payments and refunds
  receipt_ref, note
  rate_groups jsonb          per rate group: rate, gross, net, VAT, worked out once on this row's total (paymentVat);
                             allowed (nullable) on deposit_in and deposit_out too (decision 42)
  unique (provider, provider_ref, kind) where provider is not null
payment_allocations append-only
  id, tenant_id, payment_id, charge_id
  amount      bigint: > 0 for a payment or withholding; < 0 for a refund's or chargeback's reversing allocation
  rate_groups jsonb          per rate group: the gross this charge received (or gave back)
```

**Tax invoices and VAT**

- **Every payment received gets its own tax invoice** (decision 25; printed in Phase 6). **Its VAT is worked out once, on the payment's total, per rate group, and shown once at the bottom (total, then net and VAT)**, not summed charge by charge (decision 27). Rounding is half up to the smallest currency unit. This holds for shops whose prices include VAT and shops that add it.
- **`paymentVat(payment, allocations)`** in `@mango/core`: from the charges the payment is allocated to, it adds up the gross the payment puts into each rate group, then per group works out VAT once on that gross (rate ÷ (100 + rate) of it, half up) and net = gross − VAT. It is the same formula for both tax styles, because a payment is always a gross amount: for a shop that adds VAT on top, the charge's gross already includes the VAT added. The result is stored on the `payments` row.
- **Allocations** still record what each charge received (its gross per rate group, the payment's amount split over the charge's groups in proportion to their gross, the charge's last allocation taking the rounding remainder so a charge's allocations add up exactly to its total). They decide when a charge is settled; they are not where invoice VAT comes from. A charge's own VAT (its snapshot) and the VAT on the invoices that paid it can differ by a minor unit per group; the invoices are the documents of record.
- **VAT on deposits is a shop setting** (decision 42): `tenants.deposit_vat_mode`, either `on_receipt` (a `deposit_in` gets a tax invoice with its VAT in `rate_groups`, and a `deposit_out` a credit note) or `none` (no VAT on deposits). **Default `none`, pending Korn's answer to K3**; the setting is not shown to shops before then. Whether a deposit row needs a tax invoice is decided in **one function**, `platform_private.deposit_needs_tax_invoice(row)`, which every writer and Phase 6 call. Rows written under either mode never need changing.

**The rules, decided now because the rows are append-only**

- **Overpayment** (re-check item 8, narrowed by decision 33). The **staff wrapper** of `record_payment` refuses an amount larger than what is open on the order, `overpayment`; staff give change in cash. **Money a provider has already taken is always recorded**, by the core, whatever the order's status: what no open charge needs stays unallocated on the payment and is the customer's credit (a PromptPay QR can be paid twice; a link can be paid after the order changed). An archived order that receives a provider payment is unarchived and flagged; a cancelled one keeps its status and shows the credit.
- **A refund names the payment it refunds** (decision 34): `refunds_payment_id`, and refunds against one payment never exceed it. It also **writes negative allocations** against the charges it refunds, so a refunded charge no longer reads as settled. Its **credit note** (Phase 6) **cites that payment's tax invoice** and carries the VAT of what it reverses (`paymentVat` on the refund's own allocations, once on its total per rate group). A refund of credit that no charge holds (money left on voided charges, or a provider overpayment) names the payment that created the credit, and its credit note carries that payment's VAT share.
- **Reversals and chargebacks** (decision 35). A `reversal` undoes the row it points at (`reverses_payment_id`, unique): a refund or a deposit return the bank later failed, or a chargeback the shop won; the allocations of what it undoes are reversed again. A `chargeback` takes a payment back in a dispute: it points at the payment, reverses that payment's allocations, and the order's balance rises. An order with an open chargeback can't be archived.
- **A kept deposit becomes a payment.** A `deposit_capture` (pointing at the `deposit_in` or `deposit_hold` it draws on) plus a `payment`, method `deposit`, `capture_id` pointing at it, allocated to the charge it pays, **with its own tax invoice and VAT**, the same as any payment.
- **A card hold is not money** (decision 36). `deposit_hold` and `deposit_release` never enter the balance or "deposit held". A hold's rows always satisfy **hold = captures + releases**. **Deposit held** (money) = `deposit_in` − `deposit_out` − captures drawn on a `deposit_in`; holds are shown beside it, never inside it.
- **Withholding** (decision 41): a company customer that pays net of withholding tax settles the withheld part with a `withholding` row (the certificate, not money), allocated to the charge like a payment. Its rate and documents are Korn's (K10); Phase 3 only allows the kind.

**Balance**

- **Balance = total of non-void charges − payments − withholdings + refunds + credit write-offs + chargebacks − the reversals of refunds and chargebacks, whatever the allocation.** A reversal of a deposit return changes the deposit held, not the balance. **A charge is settled when its allocations (payments and withholdings, less reversals) equal its total.**
- **Deposits are never part of the balance or of "amount owed"** (decision 37). No deposit row of any kind enters it; a kept deposit enters only as its `payment` row.
- **Credits:** a negative balance. Cancelling an order with payments voids its charges and leaves the payments as credit (decision 18). A credit stays until refunded (`staff_can_refund`) or written off (`staff_can_write_off_credit`), and blocks archiving (decisions 12, 14).
- **The currency** is held by the foreign keys on `orders`, `order_charges` and `payments` (no cascade: a currency change is refused while any exists), not by `tenants_lock_currency()`'s unlocked `exists` (S8).

**The deposit on an order** (decision 37; Mark's Booqable problem, where staff saw the deposit as owed every month)

- **A deposit is required once per rental, never per month period.** It is fixed from the first charge of a booking (the `booking` charge's snapshot `deposit`; `planBookedCharges` puts it there, §6.3); `period`, `extension` and every later charge carry no deposit, so a long multi-month rental never asks for it again. A per-order deposit mode is once per order.
- **The shop chooses hold or charge**, and the platform **never converts one into the other**: a hold that ends is released or expires; it is not turned into a charge, and a charged deposit is not turned into a hold.
- **The order shows the deposit's own status**, read from its rows: *held [date]*, then *released [date]* or *expired [date]*; or *charged [date]*, then *refunded [date]* or *kept [date]* (in part: "kept ฿x, refunded ฿y"). A released or expired hold never shows as outstanding. The deposit line sits apart from the balance and from "amount owed"; the only thing it can show as due is a deposit **required and not yet taken** before pickup.

**Who can write, and from where** (decision 40)

- `record_payment`, `record_refund` and `record_deposit` are split like the order functions: a **`platform_private` core** that records a row and its allocations (callable by the service role for a provider-confirmed row, with **no `staff_may` check and no overpayment refusal**), and the **staff wrapper** (`platform.record_payment` and so on) that checks role, the setting (`staff_can_refund`) and overpayment, then calls the core with `source = staff`.
- **Provider rows are unique** on `(provider, provider_ref, kind)`. A webhook, the page's return call and the reconciliation job can each try to record one payment; the core takes the order row first (class 3.1), so the second waits there, then finds the row and answers it (idempotent), never a duplicate.

**The Moto Mangos fee on the order** (decision 38): a Moto Mangos order's `booking` charge carries a **negative `marketplace_fee` line** for the fee the renter paid online, written by `create_booking` (3M) from the fee the marketplace reports, fixed like the fee, voided with the charge on a cancellation. The shop's charge total is then what the shop collects, so the order settles and auto-archives. Its VAT treatment is Korn's (K2).

**Phase 7 attaches here:** `payment_accounts`, `webhook_events`, `provider_payments` and `provider_disputes` beside the ledger, `scheduled_charges(order_charge_id, due_at)`, card payments and holds through the cores above with `provider_ref`, card refunds as `refund` rows after the provider confirms, chargebacks and reversals, the payment deadline, and the cancellation fee as an `order_charges` row of kind `cancellation_fee` (decision 41).

## 7. The marketplace switch (3M)

Designed here, built in 3M with its own plan.

### 7.1 `marketplace_api`

`security definer` functions in a `marketplace_api` schema, **executable by `service_role` only** (decision 15), returning only listed and approved shops: `get_shop`, `list_featured_shops`, `get_catalog_model`, `search_offers` (assigned-unit availability, the stricter notice, minor units and currency), `get_listing`, `get_availability`, `get_quote` (inputs; the price from `quote()`), `get_shop_signals` (from orders with `channel = marketplace`), `create_booking`, `get_booking`, `list_customer_bookings`, `cancel_booking`, and a `marketplace_events` outbox (`booking.accepted`, `.declined`, `.expired`, `.cancelled`, `.picked_up`, `.returned`, `.no_show`).

**The booking rules** stay in TypeScript: `bookOnline()` moves to a **shared server-only package** (decision 15), used by the platform's booking page and the marketplace server. The static test that no file calls the booking entry with an online channel except that package covers **both apps**.

### 7.2 The order insert for `channel = marketplace`

`create_booking` → `create_order` with `channel = marketplace`, in the §4.2 order: product-and-location locks → unit locks → unit rows → products → **listing rows** (the cap) → coupon → **customer upsert** by `(tenant, marketplace_account_id)` → order insert → rentals → reservations → blocks → charges and lines (the `booking` charge with its negative `marketplace_fee` line, decision 38) → `marketplace_events` → counter. Request mode: `status = requested`, no unit held, counted against `request_units` under the listing row; accepting runs `reserve_core`.

### 7.3 The fee record (decision 23, replaced 19 Nov 2026; decision 26)

The fee record is marketplace-owned (`public.marketplace_fees`, keyed by order id) and **fixed at booking**.

- **Base: everything booked through Moto Mangos at booking, for the whole booked length** (a 90-day booking pays on all 90 days; no 30-day cap): the rental after any discounts or coupons, plus paid extras (phone holder, insurance or cover, and so on) and delivery.
- **Never the security deposit.**
- **VAT:** the base is what the renter sees: including VAT for a shop whose prices include it; before VAT for a shop that adds it on top.
- **Fee:** 10% of the base, **rounded to the nearest whole unit of the currency, half up**; at least the market currency's minimum (฿50 for THB); **never more than its base** (decision 32).
- **Extensions and further months** arranged with the shop afterwards are outside Moto Mangos and carry no fee. Moto Mangos never tracks or charges recurring monthly rentals. **Charges created after booking are outside the fee**; the booked months of a 90-day booking (its `booking` and `period` charges made at booking) are inside it.
- **Receipt:** Moto Mangos's own fee gets a standard receipt from Mango Works, not a tax invoice (decision 26). **Confirm with Korn before Phase 8.**
- `create_booking` returns the base it used (rental after discounts, extras, delivery, and whether VAT is inside); the marketplace works the fee out from that and stores both. **The marketplace never passes a fee in** (INTEGRATION §3.12, corrected).

**`apps/marketplace/lib/fees.ts` against this, Phase 8 code changes** (not changed here):

| `fees.ts` today | Change needed |
| --- | --- |
| `bookingFee(rentalAfterPromotion, …)`: the base is the rental after promotion only; "extras never count" | The base adds paid extras and delivery |
| No VAT input | Take the base as shown to the renter (gross with VAT included; before VAT when added on top) |
| `feeRoundingUnit` lets a market round to a multiple (e.g. ฿10) | Nearest whole unit only (decision 23); drop the setting or fix it at 1 |
| `min(…, rentalAfterPromotion)`: the fee is never more than the rental | Kept, on the whole base (decision 32) |
| `priceBreakdown`: due at shop = rental after promotion − fee + extras; no delivery line | Due at shop = base − fee (+ delivery when paid at handover); the breakdown gains a delivery line, and the fee line includes extras and delivery |
| Minimum per market currency; half-up rounding; integers in minor units | Already as decided |

## 8. Build stages

One PR each. Migrations local only until Mark says otherwise; staging as each merges, on his word. **Fable build** = built on Fable (locks, RLS, money, availability, job SQL). **Opus + Fable check** or **review** = built on Opus, reviewed by Fable before merge (the security-definer reads of stage 7 are reviewed, decision 31).

| # | Stage | Migration | Model | Accept tests |
| --- | --- | --- | --- | --- |
| 1 | **Unit lock rules** | 1 | Fable build | §4.1's gate tests: two opposite `move_unit()` calls at one place and at two places, 0 deadlocks, 30 rounds × 3 shops; direct product change refused, also after a `move_unit()` in the same transaction; a second `move_unit()` in one transaction refused; two-unit status change and two-product unit delete vs a two-product booking, 0 deadlocks (fail on today's trigger); a two-unit change to sold, retired or lost refused with nothing changed; lost while out and with future bookings succeeds and **its future blocks are kept** (the at-risk read arrives in stage 7); catalog review vs product delete: 0 deadlocks; the static lock-strength test with its exception list; **`app_uid()` and `app_role()` exist, are stable with an empty search path, and are executable by `authenticated` and `service_role` only (not `anon`, not `public`); `caller-functions.test.ts` passes with today's direct `auth.uid()` and `auth.role()` uses pinned, less those stage 1's re-created functions converted**. **added 23 Nov 2026: the lock-held exception's tests (§4.1); approve and merge leave the listing off, an existing listing unchanged, and the shop then switches it on with `save_listing()`**. **Tests that change a unit's product directly, ported to `move_unit()` or rewritten** (item 3; line numbers on PR 51's branch): `availability.test.ts` around 3326, 3334, 3345 and 3748 (direct updates by the owner: ported); 3583 (a set-up step with `session_replication_role = replica`, which skips triggers: rewritten to build the state through `move_unit()`); `product-listings.test.ts:521` (moves a listing's product, refused `listing_product_fixed`: checked still to hold, rewritten if it relied on a unit move); `review-fixes.test.ts:700` (ported); `recheck-followups.test.ts:244`, **the swap test itself, which becomes a true-concurrency gate test of two opposite `move_unit()` calls and must pass** |
| 2a | **Orders: tables, RLS, customers, settings** | 2 | Fable build | **Migration 2 deletes every Phase 2 reservation, its allocation and hold blocks, and every coupon redemption, on staging and locally; the seed is rerun after it.** On live the count before the push must be 0, or the push stops. Isolation for every new table (5 roles × 2 shops, stranger, MM customer, anon); `staff_may` for each setting and role; **the date-and-time picker time step among the shop order settings, default 15 minutes, only the listed steps accepted** (§9.1); customer contacts never in audit; `move_unit` split copies `rental_id`; currency FK refuses a currency change |
| 2b | **The core and the test port** | 3 | Fable build | `reserve_core` with orders and rentals; `platform.reserve()` gone; **Phase 2's database tests (`reservations`, `availability`, `booking-rules`, `coupons`, `product-extras` races and checks) ported to `create_order`, with the same rounds and outcomes; `staff-booking.ts` and `book-online.ts` call `create_order`; `bookOnline()` moved to the shared package**; a non-unit FK failure raised, never `unit_taken`; any inner refusal leaves nothing written; idempotent `create_order`; 200-line booking timed, 201 refused; per-customer coupon limit under a race; numbering: 50 parallel orders, no duplicate number or code, every order numbered at commit; **a draft held again and confirmed** (the live-reservations `confirm_hold` core is in this migration); a run-out hold settled and kept when the call then answers `hold_expired`; migration 3's re-check finds no reservation without a rental before `not null` |
| 3 | **Payments ledger** | 4 | Fable build | Append-only for every role; balance exact after 20 parallel payments, a refund and a cancel in any order; `paymentVat` works VAT once on each payment's total per rate group, half up (inclusive and on top, THB, USD, VND), and a payment covering three month charges gives one VAT figure per group, not a sum of three; a charge's allocations add up exactly to its total; idempotent payment and refund; refund and write-off per setting; deposits outside the balance; **an overpayment refused**; a refund's reversing allocations make its charge unsettled and its VAT is that of what it reverses; a kept cash deposit becomes a `deposit_capture` plus a `payment` allocated to the charge, the balance and the deposit held each falling by the amount; **the overpayment refusal binds the staff wrapper only: the core records a provider row larger than the balance and leaves the excess as credit, on an archived order too (unarchived and flagged)**; a refund names its payment and never exceeds it; a `reversal` of a refund and a `chargeback` and its `reversal` move the balance and settled state as §6.4 says; holds and releases never touch the balance or deposit held, and hold = captures + releases holds after any sequence; a provider row recorded twice at once (webhook and return call) gives one row; a provider row's `received_at` is the time passed in; a staff wrapper call without `staff_can_refund` is refused while the core called as the service role is not; `deposit_needs_tax_invoice()` in both modes; a three-month rental asks for its deposit on the first charge only |
| 4 | **Status machine** | 5 | Fable build | Every transition and revert by each role and setting; derived state for every mix; pickup blockers; late return clipped, never refused; late charge after 60 minutes' grace, waivable per setting; revert-return voids its charge and is refused with money allocated, while `cancel_order` voids a paid charge into a credit; **a late return of a vehicle marked lost while out succeeds, and any other lengthening on it is refused**; sale stock out and back; held-order expiry settled first by every function |
| 5 | **Order edits, add to order, coupon swap** | 6 | Fable build | §5.2 races; `add_to_order` on reserved and picked-up orders; date change keeps units when free; `chargeDifference` core (stage task) on a paid charge; repeat hold then confirm; **gate test: `save_order` adding a rental against `pick_up` of the same order** (one waits, the other `try_again` or both clean) |
| 6 | **Rental changes and long rentals** | 7 | Fable build | Redesign's swap tests; swap refused on an overdue rental; breakdown swap into repair; extend vs a booking of the next days; **gate test: `extend_rental` against `move_unit()` of its unit** (`try_again` or clean, never a half move); early return vs a booking of the freed time; `edit_return_time` with and without money against the late charge; month periods telescope; `planBookedCharges` (decision 17) and the redemption sum; stacking coupon with a credit |
| 7 | **Reads** | 8 | Opus build + Fable review (decision 31); the review covers role leakage in the security-definer reads and the at-risk rule | `bookings_at_risk` (repair, lost, overdue, clipped turnaround); the order's deposit status read (held, released, expired, charged, refunded, kept, with dates; never in the balance or amount owed: decision 37); `order_list` filters (status, payment status, shortage, at risk, overdue, channel, dates, search by number, customer, phone, plate) per role; `today_board` writes nothing; `order_history` for staff without audit access; **a product's other orders over given dates** (the order page's hover card, §9.1); cross-tenant test per read; response times |
| 8 | **Jobs, outbox and email** | 9 | Fable build (job SQL); sender Opus + Fable check | Each job twice writes once; the close job touches only orders the sweep already expired, `skip locked`; overdue 1/3/15/30 in a DST shop shown on the Dashboard; **with sending off, nothing reaches the transport** and every message is queued; against the fake transport with the switch on: end-of-rental email in the customer's language, renewal reminders, retry and failure, old messages expired rather than sent |
| 9 | **New order and the order page** (design input: §9.1) | None | Opus + Fable check | Invoice-style layout per §9.1, channel a read-only badge, per-line dates with "apply to all", **every date-and-time picker stepped by the shop's time step** (from stage 2a), the hover card from stage 7's read; Playwright 375 and 1280 px: **full new → reserved → picked up → returned → archived**; an overlap refused "This vehicle is booked from … (order #…)"; add to order; hold expiry; **a deposit released or expired never shows as owed, and a three-month rental's order page asks for the deposit once**; Thai at phone width |
| 10 | **Today board, order list, Settings › Orders** (time-step setting: §9.1) | None | Opus + Fable check | The time step (stored since stage 2a) changed in Settings › Orders and followed by every picker; four tabs with counts, Late highlighted; search by plate and phone; the six staff permissions switch screens and are refused by the database when off |
| 11 | **Gantt and month calendar** | None | Opus + Fable check | Drag to reassign; drag-extend **re-prices** with a confirmation; drag onto a taken slot refused in words; phone read-only |
| 12 | **Customer coupons and wrap-up** | None | Opus + Fable check | "Uses per customer" on the form; returning discount from real orders; Retire offered for a reserved service; demo seed in every status; accept suite named per spec line; help articles (Fable checks payments and refunds); doc edits (§13); staging on Mark's word |

Stage 3 must precede stage 4 (reverts check allocations). Stage 7 can start once 4 merges; stages 9 to 11 need 7.

## 9. Screens

| Screen | Address | First | Who | What |
| --- | --- | --- | --- | --- |
| **New order** | `/[tenant]/new-order` (Phase 2 stage 11's screen continued) | Phone | Owner, manager, staff | Dates and place → products with prices → vehicles (quantity makes that many rentals; name a unit optional) and extras → customer (search or add) → coupon, price change with a reason (setting) → summary (long rentals: a line per month, what is due when) → Hold, Save as draft, Reserve |
| **Order page** | `/[tenant]/orders/[id]` | Both | Owner, manager, staff | Rentals with unit, dates, derived status, shortage and at-risk flags; charges with their lines; balance, payments, credit; **the deposit on its own line with its own status and dates (held, then released or expired; charged, then refunded or kept), never in the amount owed** (decision 37); actions by status (Pick up, Return, Edit return time, Extend, Swap, Return early, Add, Change vehicle, Change dates, Cancel, Take payment, Refund, Write off, Revert, Archive), each shown only when allowed; **History from `order_history`** |
| **Today board** | Dashboard | Phone | Everyone (mechanic, driver: no money or contacts) | Today, Tomorrow, Upcoming, Late with counts; Late highlighted; at-risk bookings |
| **Orders / list** | `/[tenant]/orders` | Both | Owner, manager, staff | Search; quick filters; full filters (§8 stage 7) |
| **Unit timeline** | `/[tenant]/calendar?view=timeline` | Desktop (phone read-only) | Edit: owner, manager, staff; read: everyone | Rows per unit, unassigned lane, overdue bars to now; drag to reassign or extend |
| **Month calendar** | `/[tenant]/calendar?view=month` | Desktop (phone: day list) | Everyone | Pickups and returns per day |
| **Customer** | `/[tenant]/customers/[id]` | Both | Owner, manager, staff | Contacts, notes, orders, completed rentals |
| **Settings › Orders** | `/[tenant]/settings/orders` | Desktop | Owner, manager | Alert days, end-of-rental email, grace minutes, archive days, swap options, **the six staff permissions**, **the date-and-time picker time step** (§9.1) |

375 px for every staff screen; English and Thai together; Thai lines on a review list for Korn; no new dependency for the Gantt.

New order, the order page and Settings › Orders follow §9.1.

### 9.1 Order screen design input (20 Nov 2026)

Input for stage 9 (New order and the order page) and stage 10 (Settings › Orders). Where this and the New order row above differ, this wins: the screen is one invoice-style order, not a step-by-step form.

#### Mark's feedback on Phase 2 stage 11's price check

- He expected an **invoice-style order screen like Booqable's**: the customer top left; products added by searching, line by line; payment details on the right or at the bottom.
- **The channel picker confused him.** Staff orders are counter orders, so in a real order the channel is a **read-only badge**, not a choice.
- **The Price check screen stays after Phase 3** as a quick-quote tool: no document, nothing saved (decided 20 Nov 2026). It will likely be redesigned once Mark has used it more.

#### Booqable's order page as BSR uses it today: the layout to follow

| Area | What it holds |
| --- | --- |
| **Header** | Order number, status badge, the main action for the status (**Pick up** / **Return**) and a **"…" menu** for the rest |
| **Top left** | **Customer card**; custom information fields below it |
| **Top right** | Pickup or delivery, billing address, dates |
| **Lines** | A **"Search to add products"** bar; a line table: drag handle, product and the line's status, stock assignment chip, available count, quantity, charge (price-structure picker and edit), line total, remove; a **hover card** with the product's other orders; **"Add custom line"** |
| **Totals, bottom right** | Subtotal, add discount, add coupon, total incl. VAT, VAT, total excl. VAT, security deposit |
| **Right sidebar** | Email; documents (contract, quote, packing slip); invoices; payments (paid and due, **New payment**, the payment list with each method); tags; notes; activity log |

#### Our differences (decided by Mark, 20 Nov 2026)

1. **Dates on each vehicle line** (one rental per vehicle, decision 2). The first line's dates are the default for each new line, with **"apply to all"**.
2. **Each vehicle line names its unit (plate)** once one is assigned.
3. **Long rentals as real month-period lines** (decision 3, §6.3): no unpriced vehicle line with a "Rental Dates" line beside it, which is how BSR works around it in Booqable today.
4. **The deposit has its own status** (held, then released or expired; charged, then refunded or kept), shown with its dates and **never in the amount owed** (decision 37). In the totals it is not added to the total.
5. **The channel is a read-only badge.**
6. **At phone width the same sections stack** (header, customer, dates and place, lines, totals, then the sidebar's sections), in that order.

#### Mapping to this plan

- **Header actions** are the order page's actions by status (§9 table): the main one shown, the rest in "…", each only when allowed.
- **Sidebar, Phase 3:** payments (Take payment, Refund, Write off; credit and balance), notes, and the activity log from `order_history`. **Later phases** (§1.2): email (Phase 6, sending is off in Phase 3, decision 28), documents and invoices (Phase 6; the contract with Phase 5's agreement), delivery (Phase 8).
- **Search to add** lists products with their price and free count for the line's dates; a vehicle makes one rental per quantity (decision 2), gear keeps a quantity.
- **Hover card** reads the product's other orders over the line's dates; that read is one of stage 7's reads (decided 20 Nov 2026).
- **No order tags**: the channel badge replaces BSR's only Booqable tag, WEBSHOP. **Custom information fields are deferred to Phase 11**, if shops ask (both decided 20 Nov 2026).

#### Time step for date-and-time pickers (new shop setting, decided 20 Nov 2026)

- One shop setting sets the step of **every date-and-time picker**: the order screens, the booking page and Settings › Booking rules. Choices: **1, 5, 10, 15 or 30 minutes, or 1 hour**.
- **Default 15 minutes**; each shop can change it (decided 20 Nov 2026).
- **Stage 2a's migration adds it**, with the other shop order settings; no extra migration. So **stage 9's pickers read it from day one**; **Settings › Orders** (stage 10) is where a shop changes it; the **booking page** uses it in Phase 8.

### 9.2 Order screen decisions from the prototype (Mark, 26 Nov 2026)

**The reference for stage 9 is the clickable prototype, [`docs/design/order-screen-prototype.html`](design/order-screen-prototype.html)** (sample data, nothing saved; [`docs/design/README.md`](design/README.md) describes it). It follows §9.1 and the decisions below. Where it and §9.1 differ, it and this section win for stage 9. Mark is happy with the design for now (26 Nov 2026).

#### Mark's answers to the prototype's questions

One line each: the decision, then what the prototype does. **⚑** marks an answer that changes or extends an earlier decision (below).

1. **⚑ Swap on a period not yet paid: allowed.** The customer owes for the time used on the old bike plus the rest of the period on the new one. *Prototype:* the old period's unused part is credited whether paid or not, and the dialog says so.
2. **An extension is due when its added period starts;** the customer may pay early or late. *Prototype:* the `extension` charge's `due_at` is the old end ("due later" until then).
3. **Deposit hold or charge:** the shop's setting is the default and **staff can change it at pickup** for that rental. Decision 37 still holds: the platform never converts one into the other. *Prototype:* a choice in the Pick up dialog, warning when a hold would outlast a card hold (about 7 days).
4. **⚑ Credit stays on the account and comes off any future balance automatically.** *Prototype:* credit pays the oldest open charge first, shown as "Paid from credit".
5. **Deposit top-up after a swap to a dearer bike:** staff take the difference, so the deposit reaches the new bike's amount (never charged silently, §6.2). *Prototype:* "Take top-up" on the deposit, blocking nothing.
6. **VAT on the order page:** the order's VAT, once at the bottom (total, net, VAT). *Prototype:* as said; each payment's own VAT in the payments list.
7. **A customer is required to reserve;** a draft or a hold needs none. *Prototype:* Reserve refuses without one.
8. **The reason for a staff price change is optional,** with a list to pick from. *Prototype:* "No reason" by default, then Returning customer, Long stay, Price match, Vehicle has a fault, Other.
9. **⚑ Cancel: staff choose who cancelled (customer or shop), apart from the reason; no-show can be picked at any time,** including before the pickup time (a customer may say they aren't coming). *Prototype:* Cancel needs a reason and "Cancelled by"; Cancel order is greyed out while a vehicle is out, Cancel rental stays on reserved lines.
10. **Header action with one vehicle out and one reserved:** the main button names the vehicle ("Pick up Yamaha NMAX 155"); each line keeps its own buttons. *Prototype:* as said.
11. **Charge names** ("Booking", "Month 2", "Swap 26 Nov", "Month 3" for an extension of a monthly rental) are fine, also on invoices. *Prototype:* as said.
12. **English and Thai: one language at a time, with a switch,** not side by side. *Prototype:* English only; the switch is not drawn.

#### Layout (decided 26 Nov 2026)

- **Pickup and return are the most prominent thing on each vehicle line and in the header:** a clear "Pickup" or "Return" label over a larger, bold date and time; the first column of the line table and, at 375 px, the first thing on each line. The header shows the order's pickup and return (with several vehicles, the first pickup and the last return).
- **Location, who made the order and the channel sit in one quiet metadata line** under the header dates (smaller, lighter). On New order the pickup and return places are chosen there. No separate "Pickup and return" card.
- **Paid, due now, due later and credit are shown once, in Payments.** The totals show total, net and VAT only.
- **The deposit is one line in the totals** (never added to them); **its status lives in the Security deposit card.**

#### Answers that change or extend earlier decisions

These sections are **not edited here**; each must be updated by the stage named.

- **⚑ 1, swap on an unpaid period** (affects **§6.2** and the swap rule in [products-redesign.md](products-redesign.md) §9.19). Mark's rule: the old period's **unused part is the amount charged × the unused share of its list price, credited whether or not it was paid**, so the customer owes the time used on the old bike plus the new bike's remainder, the same total as if they had paid first (tab b: ฿2,750 either way). §9.19's "paid remainder = the amount actually paid × the unused share" counted only money received. **§6.2 (and the `swapAmounts` / `settleSwap` inputs in `@mango/core`) must be updated when stage 6 (rental changes) is built.** Early return (a swap to nothing) was not asked; stage 6 settles whether it follows the same rule.
- **⚑ 4, credit used automatically** (changes **decision 14**, "credit stays until refunded or written off", and **§6.4**'s "Credits"). New rule: **credit on an order is applied to its next open charges, oldest due first, without staff action;** refund and write-off stay for credit nothing is due against. **§6.4 and decision 14 must be updated when stage 3 (payments ledger) is built.** **Money-rule change: flagged for the Fable design check at stage 3** (how an applied credit is recorded in the append-only ledger, which charges it settles, and the tax invoice of the charge it pays: per products-redesign decision 27, a credit reduces the VAT base of the new invoice).
- **⚑ 9, who cancelled** (extends migration 3's value lists, **§3.8** row 3, **not edited here**). It fits the lists migration 3 fixes: `cancelled_by` **customer, shop, system**, where **system** is written only for an expired hold and **never picked by staff**; `cancel_reason` **expired, customer_request, shop_request, no_show, other**. Staff pick `cancelled_by` (customer or shop) separately from the reason; **`no_show` may be picked at any time, including before the pickup time.**

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
| 32 | The Moto Mangos fee is never more than its base (decided 19 Nov 2026; was an open point of the fee check). Written into SPEC, INTEGRATION and the marketplace SPEC | §7.3; `docs/platform/SPEC.md`, `docs/INTEGRATION.md`, `docs/marketplace/SPEC.md` |
| 33 | The "no overpayment" refusal binds staff entry only; money a provider has taken is always recorded and any excess is credit | §6.4, stage 3 |
| 34 | A refund names the payment it refunds (`refunds_payment_id`) as well as reversing allocations against the charges; its credit note cites that payment's tax invoice | §6.4, stage 3 |
| 35 | `reverses_payment_id` and the kinds `reversal` and `chargeback`, for a refund the bank later fails and for disputes | §6.4, §2.3, stage 3 |
| 36 | A card hold is not money: `deposit_hold` and `deposit_release` stay outside the balance and "deposit held"; a hold always equals its captures plus releases | §6.4, stage 3 |
| 37 | Deposits are never part of the balance or amount owed; required once per rental, never per month period; the order shows the deposit's own status with dates; the shop chooses hold or charge and the platform never converts one to the other | §6.4, §9, stages 3, 7, 9 |
| 38 | A Moto Mangos order carries a negative `marketplace_fee` line for the fee paid online, so it settles and can auto-archive | §3.2, §6.4, §7.3 |
| 39 | Provider-sourced rows: unique on `(provider, provider_ref, kind)`; `recorded_by` nullable with `source` (staff, provider, system); `received_at` passed in as the provider's time | §6.4, stage 3 |
| 40 | `record_payment`, `record_refund` and `record_deposit` split into a private core the system can call and a staff wrapper | §3.3, §6.4, stage 3 |
| 41 | Room in the lists: `card` and `promptpay` in `payments.method`; `cancellation_fee` in `order_charges.kind`; a `withholding` payment kind | §3.2, §6.4 |
| 42 | VAT on deposits is a shop setting: on receipt with a credit note on return, or none (pending Korn K3); `rate_groups` allowed on deposit rows; the tax-invoice rule in one function | §6.4, stage 3 |
| 43 | Ahead of the planned move to Neon and Better Auth after Phase 3, Phase 3 adds `platform_private.app_uid()` and `app_role()` in stage 1, so the move changes one function body, not every function; **they read `request.jwt.claims` directly, not `auth.uid()` and `auth.role()` (Mark, 23 Nov 2026), so they already work on both**; every new or re-created function, default and policy calls them instead of `auth.uid()` or `auth.role()`; older code converted only when a stage re-creates it; a static test pins the remaining direct uses so the count only goes down | §3.11, §3.8, §8 stage 1, §12 |

### 11.2 Open points

1. **Moto Mangos fee receipt** (decision 26): a standard receipt from Mango Works, not a tax invoice. **Confirm with Korn before Phase 8.**
2. **For Korn, from the payments design (PR 56)**, none of which blocks Phase 3 because the columns and kinds already allow either answer: K2, the VAT treatment of the `marketplace_fee` line (decision 38); K3, VAT on deposits (decision 42; default `none` until answered); K10, the withholding rate and documents (decision 41).
3. **A clash to settle in the payments design, not here:** PR 56 §3.6 offers staff, when a rental is extended past its card hold, to "capture it now as a charged deposit". Decision 37 says the platform never converts a hold into a charge. Phase 3 follows decision 37; PR 56 should drop that option (release the hold and take a new deposit, or let it go) or Mark should say otherwise.

4. ~~From the order screen design input (§9.1)~~ **Closed, 20 Nov 2026 (Mark):** the time step defaults to 15 minutes, shops can change it, and stage 2a's migration adds it with the other shop order settings, so stage 9's pickers read it from day one; the hover card's "other orders" read joins stage 7; no order tags (the channel badge replaces WEBSHOP); custom information fields deferred to Phase 11, if shops ask. Written into §9.1, §1.2 and stages 2a, 7, 9 and 10.

Draft 2's other open points (the VAT on a payment, one invoice for several month charges, the sending domain, overbooked vehicles, extras on long rentals) are settled by decisions 27 to 30, and the fee's ceiling by decision 32, with no Korn check left on them.

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
| **The planned move to Neon after Phase 3** (before 3M and BSR's go-live; `docs/platform/neon-move-plan.md`, branch `docs/neon-move-plan`) | **A spike first, as a go/no-go**, checking latency, cold start, the RLS bypass role, Data API timeouts, Better Auth with LINE sign-in and pg_cron; live then runs on an always-on compute. Phase 3 keeps the move small: the caller is read only through `app_uid()` and `app_role()` (decision 43) and a static test keeps direct `auth.uid()` and `auth.role()` uses from rising; jobs only queue and the sender is app-side; the root `CLAUDE.md` "Not tied to Supabase" rules bind every stage |

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
| **S9** | Stage 2 split into 2a and 2b; ledger before status machine; job SQL a Fable build; **reads an Opus build with a Fable review (decision 31), the review covering role leakage in the security-definer reads and the at-risk rule**; numbering fixed (nine migrations, thirteen stages) | §3.8, §8 |
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
| **Decision 32** | Fee never more than its base; moved from §11.2 to the decisions; added to SPEC, INTEGRATION and the marketplace SPEC | §7.3, §11.1, §11.2 |
| **Re-check 1** (counts trigger) | Two statement-level triggers (update, delete) replace the row trigger; delete gets its own because owners can delete units of several products in one statement | §4.1, §3.8 |
| **Re-check 2** (`move_unit` marker) | Transaction-local marker naming the unit, set to `done` after its update; a second call refused; a later direct product change refused | §4.1, §3.8 |
| **Re-check 3** (stage 1 tests) | The direct product-change tests listed, ported or rewritten; the swap test becomes a gate test that must pass; "future bookings at risk" reworded to "its future blocks are kept" | §8 stage 1 |
| **Re-check 4** (lost and late) | `unit_blocks_guard` lets the return path lengthen a lost unit's out block; every other lengthening refused; test | §6.3, §3.8 (migration 5), §8 stage 4 |
| **Re-check 5** (repeat holds) | The live-reservations `confirm_hold` core moves to migration 3 with `hold_order`; `reservations.hold_expires_at` copied from the order; the later re-creation removed | §3.3, §3.8, §8 stage 2b |
| **Re-check 6** (order number) | Order inserted first without a number; the number written by an update of its own row after `order_counters`, taken last; deferred check | §4.2, §3.8 |
| **Re-check 7** (settling a run-out hold) | The settlement is kept; the refusal is returned, not raised; the functions on each side named; later work in an inner block | §3.3 |
| **Re-check 8** (ledger) | No overpayment; refunds write reversing allocations and carry the VAT of what they reverse; a kept deposit becomes a `deposit_capture` plus a `payment` allocated to the charge | §6.4, §5.3, §8 stage 3 |
| **Re-check 9** | Decision 32 | above |
| **Re-check 10** (fee wording) | "Charges created after booking are outside the fee"; the booked months of a 90-day booking are inside it | §7.3 |
| **Re-check 11** (S5) | `revert_return` refuses to void a paid charge while `cancel_order` voids it into a credit, and why that is intended | §2.3, §8 stage 4 |
| **Re-check 12** (S7) | Migration 3 checks and clears again before `rental_id` is set not null | §3.8, §8 stage 2b |
| **Re-check 13** | §14's S9 line corrected | §14 |
| **Re-check 14** (fee docs) | VAT basis added to SPEC and INTEGRATION; INTEGRATION §3.12: the marketplace works the fee out from what `create_booking` returns and passes no fee in | §7.3; `docs/platform/SPEC.md`, `docs/INTEGRATION.md` |
| **Re-check 15** | Reviewed exception list for the static lock-strength test, starting with `swap_rental_unit` | §4.1 |
| **Re-check 16** | Opposite moves at different places serialise on product rows in id order; multi-unit sold, retired or lost unsupported, refused before the second unit's lock, with a test | §4.1, §4.3 |
| **Decision 33** (overpayment) | Refusal in the staff wrapper only; provider money always recorded, excess as credit, archived order unarchived and flagged | §6.4, §8 stage 3 |
| **Decision 34** (refund names its payment) | `refunds_payment_id`, never more than that payment; credit note cites its tax invoice | §6.4, §8 stage 3 |
| **Decision 35** (reversals, chargebacks) | `reverses_payment_id`; kinds `reversal`, `chargeback`; balance formula; no archiving with an open chargeback | §6.4, §2.3, §8 stage 3 |
| **Decision 36** (a hold is not money) | Holds and releases outside the balance and deposit held; hold = captures + releases; `deposit_source_id` | §6.4, §8 stage 3 |
| **Decision 37** (deposits) | Never in balance or amount owed; once per rental; own status with dates; hold or charge, never converted | §6.4, §9, §8 stages 3, 7, 9, §11.2 item 3 |
| **Decision 38** (Moto Mangos fee line) | Negative `marketplace_fee` line on the booking charge; kind allowed from migration 2, written at 3M | §3.2, §3.8, §6.4 |
| **Decision 39** (provider rows) | Unique `(provider, provider_ref, kind)`; `source`; nullable `recorded_by`; `received_at` passed in | §6.4, §8 stage 3 |
| **Decision 40** (cores and wrappers) | Ledger functions split like the order functions | §3.3, §4.3, §6.4 |
| **Decision 41** (room in the lists) | `card`, `promptpay`, `cancellation_fee`, `withholding` | §3.2, §3.8, §6.4 |
| **Decision 42** (VAT on deposits) | `deposit_vat_mode` setting, default `none` pending K3; `rate_groups` on deposit rows; `deposit_needs_tax_invoice()` | §6.4, §3.8, §8 stage 3 |
| Lock order and stages (decisions 33 to 42) | No new lock class: every ledger write takes the order row (3.1) then rows of class 3.9; provider duplicates serialise on the order row. All land in stage 3 / migration 4, except the two kind values in migration 2 (stage 2a), the deposit status read (stage 7) and its screen (stage 9); writers of `marketplace_fee` (3M) and of card, PromptPay, chargebacks and `cancellation_fee` (Phase 7) come later | §3.8, §4.3, §8 |
| **Decision 43** (who is calling) | `app_uid()` and `app_role()` in `platform_private`, created in stage 1 (migration 1), so the move to Neon and Better Auth after Phase 3 changes one function body, not every function; used by all new and re-created Phase 3 code; no sweeping rewrite; `caller-functions.test.ts` pins the remaining direct uses. Names: the fallback, since `neon-move-plan.md` §5 names none. No lock impact. **Corrected 19 Nov 2026:** first written as "stays on Supabase"; Mark has decided to move to Neon after Phase 3 | §3.11, §3.8, §8 stage 1, §11.1, §12 |
| **Stage 1, 23 Nov 2026** (who is calling) | `app_uid()` and `app_role()` read `request.jwt.claims` directly (Mark's decision), in place of `select auth.uid()` and `select auth.role()`; Supabase's older-settings fallback found and not copied, since nothing sets those settings | §3.11, §3.8, §11.1 (43) |
| **Stage 1, 23 Nov 2026** (listing) | `review_catalog_request()` no longer switches a Moto Mangos listing on (Mark, 20 Nov 2026); added to migration 1 | §3.8, §4.3, §8 stage 1 |
| **Stage 1, 23 Nov 2026** (gear) | "One unit per transaction to sold, retired or lost" gains its exception: unless the transaction already holds every such unit's lock (as `lock_units()` takes them). `report_gear_problem()` and `set_stock_quantity()` are its users; the unit lock's key in one place (Mark's decision and conditions) | §4.1, §4.3, §3.8 |
| **Stage 1, 23 Nov 2026** (static test) | `save_product_extras` joins `swap_rental_unit` on the reviewed list of the lock-strength test | §4.1 |
| **Review of PR 77 and the owner's decisions, 24 Nov 2026** | Migration 3 gains: the value lists of `cancelled_by` and `cancel_reason`; `currency_locked()` and the Settings action knowing about orders, with `create_order`; the "a unit on an order only once" constraint. Migration 9 gains the time step's writer, with the other order settings, before stage 10. Migration 2 locks the three booking tables first, 10 seconds at most | §3.8 |
| **Stage 2a, 24 Nov 2026** (as built) | Who-columns are plain ids (no key to `auth.users`); the LINE id kept out of the audit with phone and email; `order_lines.currency` keyed to the shop's currency too; a line's charge and rental keyed to its own order; `request_status`, `cancelled_by`, `cancel_reason` left without value lists until first written; `order_counters` made by trigger, unaudited; `booking_roles()` gains `orders` and `order_settings`; `staff_may()`'s permission names; `tenants.time_step_minutes` stored with no writer yet | §3.1, §3.2, §3.8, §3.9, §3.10 |
| **Stage 1, review of PR 70, 24 Nov 2026** | The `move_unit()` marker is set straight after the `one_move_per_transaction` check, so a second call is refused whatever the first answered; `review_catalog_request()` gets `lock_timeout = '6s'`; the wording of the lock-held exception corrected (the guard checks that the locks are held, not that they were taken sorted; `lock_units()` callers only; not reachable through PostgREST) | §4.1, §4.3 |
| **Owner's clarification, 25 Nov 2026** (a unit on an order) | "A specific unit can be on an order only once" means **not twice at the same time**: extensions, monthly periods and swap-backs may reuse the unit. No new table constraint and no `rentals.unit_id` (M2 stands). `reserve_core` / `create_order` and the assign core refuse the same unit on two lines of one order whose rental times overlap or touch (`unit_twice`); the pick follows the rule; another period is allowed. Tests: twice in one call with overlapping (and touching) times refused; back-to-back periods of one order allowed; an overlap across orders still refused by the exclusion constraint | §3.8 row 3 |
| **Stage 2b, 25 Nov 2026** (as built: where the order's row is taken) | §3.3's pattern says "advisory locks 1 and 2, then the order's row, then settle". A function that **picks** units (holding or reserving a draft; filling a shortage) only knows its unit locks after the pick, and a retry needs them given back. So `reserve_core` and the `assign_units` core take the order's row **inside each attempt (a sub-transaction), after that attempt's unit locks**: §4.2's order holds exactly (1, 2, then 3.1). The settlement of a run-out hold happens there; because a refusal undoes the attempt, `reserve_core` takes the order's row once more after the loop, with no unit lock held, and settles again before it answers, so the settlement is still kept. `confirm_hold` and `cancel_reservation` pick nothing and follow §3.3 as written | §3.3, §4.2 |
| **Stage 2b, 25 Nov 2026** (as built: the order functions) | **One line per vehicle**: a vehicle line with a quantity above 1 is `invalid_request`; callers send N lines (the plan's 200-line reasoning already counted this way). `bookOnline()` and `bookAsStaff()` still take a line for N bikes, price it as one quote line and send N rentals; its one billed line names the first rental. **Charges are optional in `create_order`** and, when sent, checked by addition and comparison only (rate groups against totals, lines' VAT against the charge's, the snapshot's totals against the columns); kinds `booking` and `period`. **A draft holds no coupon use**, so `hold_order` and `reserve_order` take the coupon again in an optional `p_request`. **`create_order` takes a `customer_id` of a customer there is**; making a customer inside the call (class 3.6) is left to the stage that needs it (`save_customer` first, today). **The idempotent repeat answers the order as it stands now**, marked `repeat`, rebuilt from its rows (hence `rentals.position`). **Who may cancel:** the server for any order; a member with the cancel role for any order of the shop except a Moto Mangos one (the owner's decision, next row). §3.9's "members for walk_in and phone only" is kept for making, holding, reserving and confirming. **One reservation of an order** can be cancelled only through the private core until `cancel_rental` (migration 6). **`hold_order` on an order that is not a draft** answers `not_draft`. **Callers answer `try_again` for `40P01` as well** (`isOrderTryAgain`). The audit events keep Phase 2's entity `bookings` (with the order's id), beside the row events of `orders` and `rentals` | §3.3, §3.8, §3.9, §5.1 |
| **Stage 2b, 25 Nov 2026** (the shared package) | `bookOnline()` and what it reads (`booking-inputs`, `pricing-inputs`, `coupons`, `try-again`) moved to `packages/booking` (`@mango/booking`, decision 15), with `charges` and `order-lines`; `apps/platform/lib` keeps re-exports. The static test walks both apps and every package from there | §8 row 2b |
| **Owner's decision, 25 Nov 2026** (who may cancel) | **Shop members may cancel any order of their own shop except Moto Mangos (`marketplace`) orders, whose cancellation rules come at 3M.** `cancel_order` answers a member `not_allowed` for an order whose channel is `marketplace`; the server's path is unchanged (it cancels any order). Members still cancel `walk_in`, `phone`, `booking_page` and `api` orders. Test in `order-core.test.ts`, shown to fail with the channel condition removed | §3.3, §3.9 |
| **Owner's answers, 25 Nov 2026** (stage 2b's open points) | **The 200-line cap stays** for now; revisit at stage 5 (with `add_to_order`, which reuses the pick). **One line per vehicle stays**: `create_order` refuses a vehicle line with a quantity above 1. **The lists stand as built**: `cancelled_by` is `customer`, `shop` or `system`; `cancel_reason` is `expired`, `customer_request`, `shop_request`, `no_show` or `other`; `request_status` has no list until 3M. **The reading of "touching" stands**: for the same unit on one order, a line that starts the moment another ends is `unit_twice`; a period that starts after the turnaround is allowed | §2.2, §3.2, §3.8 row 3 |
