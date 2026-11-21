# Phase 1b plan: fleet care

**Draft 2, 19 Nov 2026.** Plan only: no code, no migration, no test, nothing applied anywhere. Draft 1 put fifteen questions to Mark; he answered all of them the same day. This draft writes each answer in (§6) and §10 lists what changed.

Written from `main` at `d458717` (PR 53 merged; 66 migrations), **PR 51's branch** `platform/phase-2-stage-10-review-followups` at `c2e7a0b` (migration `20261119000100_platform_review_followups`: `record_renewal()` and the `recorded_by` trigger) and **the Phase 3 plan, draft 2**, on `platform/phase-3-plan-draft` at `f996c4e`. Phase 1b is built after Phase 3 and 3M (build order 0 → 1a → 2 → 3 → 3M → 1b), so every schema statement below is about the database **as it will be after Phase 3's nine migrations**. Where Phase 3 changes while it is built, §2.7 and §5 say which parts of this plan move with it.

Read for this: the root `CLAUDE.md`, `apps/platform/CLAUDE.md`, `docs/platform/SPEC.md` (Staff app, Fleet, Vehicle record, Data model, Review decisions), `docs/PROGRESS.md` (every Phase 1b note), `docs/phase-3-plan.md` (§1.2, §2.6, §3.5, §3.6, §3.10, §4), `docs/phase-2-plan.md`, `docs/INTEGRATION.md`, every platform migration to `20261119000100`, and the screens and `lib` files named in §1.2.

## Summary

1. **Part of the spec's Phase 1b is already built.** Renewal records, their costs, reminder settings, the hourly reminder queue, dashboard renewal items, downtime blocks, the notes column and one current odometer value exist. §1.2 lists each.
2. **Ten new tables, eight migrations, eleven stages** (§2, §5). Seven stages are Fable builds (locks, RLS, money, the pickup rule); four are Opus with a Fable check or review.
3. **What is due is worked out when it is read, never stored** (decision 1, §3). An hourly job only queues the messages and follow-ups that must happen once. Estimated cost of the read: under 10 ms for 150 vehicles, under 100 ms for 2,000; the stage measures both.
4. **Only a task the shop marks "block when overdue" blocks a pickup**, with an override by an owner, a manager, or staff when the shop allows it (decisions 4, 6; §2.5). Bookings on such a vehicle are tagged **"Service due"**. Availability never depends on service state.
5. **Expired tax, insurance and inspection never block a pickup** (decision 5). They are reminders: the Dashboard, the bike card, the vehicle page, and a warning at check-out.
6. **Every odometer change goes through one function and lands in the log** (§2.2). A lower reading is confirmed, flagged as a correction and audited.
7. **An open job can hold a downtime block** (§2.3). The job points at the block, so the writes run in Phase 3's lock order with no exception.
8. **No files are stored on the platform** (decision 10). Receipt and renewal-document photos are out of 1b. They arrive with a new, separate stage before Phase 4, **Shop file storage (Google Drive)**, outlined in §7 and designed in `docs/platform/file-storage-design.md` (decided 20 and 21 Nov 2026).
9. **"Remove for good" is a new unit status, `removed`**, reached through one function that follows the rule for sold, retired and lost (decision 15, §2.6). The row and all its records stay, hidden; the plate is free to reuse; a product whose vehicles are all removed can be removed too.
10. **Profit per vehicle:** 1b builds every cost, the days owned and rented, and revenue as billed on Phase 3's period lines. The paid basis and card fees wait for Phase 7; the fleet-wide report for Phase 10 (§2.8).

## 1. Scope, and what is already built

### 1.1 Phase 1b delivers

| Area | What |
| --- | --- |
| Odometer | A readings log (check-out, check-in, manual, service, first reading); current odometer and average km per day kept from it; a lower reading confirmed and audited |
| Maintenance log | Jobs with date, odometer, tasks, parts and labour cost, done by (in-house or garage), notes; an open job can block the vehicle. **The receipt photo waits for the file storage stage** (§7) |
| Service schedules | A template per product, an override per vehicle; each task every N km and/or N days or calendar months, whichever comes first; warn thresholds; optional block when overdue; an optional "last done" per vehicle and task |
| What is due | Due soon, due, overdue: on the vehicle, the bike card, the fleet-wide list, the Dashboard and at check-out |
| Keys and GPS | Key numbers and spares per key type; the tracker's brand and model, IMEI, SIM, where it is fitted, dates, notes |
| Renewals, the rest | Edit and remove on screen, the "renew in this order" steps, the status on the bike card, and a warning at check-out. **No pickup block; the document photo waits for the file storage stage** |
| Cost tracking | A shop setting for maintenance costs; an optional standard cost per task |
| Messages and follow-ups | Service messages queued in the outbox (nothing sends until Phase 6); a staff follow-up when a time-based task comes due on a vehicle out on rental |
| Vehicle notes | On the bike card and in the Fleet and Maintenance searches |
| Remove for good | Moved here from Phase 3 |
| Unit timeline | Orders, readings, jobs, renewals, downtime, status changes and costs on one history |
| Profit per vehicle | Costs in full; revenue as billed (§2.8) |

Spec accept lines that are Phase 1b's (from the Build plan's Phase 1): an odometer reading that crosses the oil interval raises a service-due alert; a maintenance job blocks the unit. §5 adds each stage's.

### 1.2 Already built (confirmed in the migrations and the app)

| Spec item | State today | Phase 1b |
| --- | --- | --- |
| `units.notes` (2,000 characters) | Column since `20261110000500`; on the Details form (owner, manager) and the vehicle page; audited | Bike card and searches only. No migration |
| `units.current_odometer_km` | One value, `numeric(9,1)`, always km. Anyone but a driver updates it directly; `units_guard` lets staff and mechanics change it; `move_unit()` writes it from the Details form | Becomes the latest reading; written only through the odometer function (§2.2) |
| Lower odometer reading | No refusal; the app asks "Are you sure?"; the audit row records it (follow-ups, 11 Nov) | Kept, moved into the function |
| `units.avg_daily_km` | Not built | Stage 1 |
| `units.keys` (spec: a list on the unit) | Not built | A table, `unit_keys` (§2.4) |
| `unit_renewals`, `unit_renewal_costs` | Built: road tax, compulsory insurance, voluntary insurance, inspection; provider, reference, start, expiry; cost in its own owner-and-manager table. PR 51: `recorded_by` set in the database, `record_renewal()` saves a renewal and its cost together | `update_renewal()`. No fifth kind (decision 12). The document photo comes with file storage (§7) |
| Reminder settings | `tenants.renewal_reminder_days` (default 45, 30, 14, 7), `renewal_digest_day` | Kept. Screen moves under Settings › Fleet care |
| `notification_outbox`, `queue_renewal_notifications()` | Built, hourly by `pg_cron`; reminder, expired and digest rows, each once; nothing sends. Phase 3 stage 8 adds `channel`, `recipient` and the sender (switched off) | New service kinds (§3.3) |
| Dashboard | `renewal` items live; `servicesDue` and `overdueMaintenance` sections are placeholders | Filled |
| Downtime | `unit_blocks` kind `downtime`, written directly by owner, manager, staff, mechanic; the unit lock taken in `unit_blocks_guard`; cleared when a unit is deleted or marked lost | A job can own one (§2.3) |
| Status active, maintenance, retired, sold, lost | Built; `free_units()` counts `active` only | Adds `removed` (§2.6) |
| Maintenance tab | Search by plate or frame number, QR scan, the list of vehicles in maintenance; "due" is a placeholder; a result opens the full vehicle page | Bike card, actions, due list |
| Fleet search | In memory over `getFleet()`: product name, plate, frame and engine number (`lib/fleet-list.ts`, `matchesUnit`) | Adds notes |
| `maintenance_jobs`, `service_schedules`, `odometer_readings`, `gps_trackers` | Not built | §2 |
| `tenants.track_maintenance_costs` | Not built | Stage 2 |
| File storage | Nothing in the platform uploads a file; no storage module exists | Stays so in 1b (decision 10, §7) |
| Delete vehicle | Real delete; refused by the foreign key once any booking block exists; "Retire instead" offered | "Remove for good" beside it (§2.6) |
| Distance unit | `tenants.distance_unit` (km or mi); stored km (`lib/distance.ts`) | Intervals and thresholds use it |

### 1.3 Not in Phase 1b

- **Any file:** receipt photos and renewal documents (§7, the file storage stage, before Phase 4).
- **Sending** by email or LINE (Phase 6). §3.3 says how it attaches.
- **QR check-out and check-in, inspections** (Phase 5). §2.2 gives them the odometer entry point.
- **Traffic fines, recurring long-rental billing** (Phase 9); **fleet-wide profit and cost reports** (Phase 10).
- **Gear.** Service schedules, jobs, keys and trackers are for vehicles. Gear keeps its "in repair" record from the products redesign.

## 2. Data model

All in `platform`. Every table: `tenant_id`, parents by `(tenant_id, id)`, RLS in the set form through `my_tenant_ids()`, grants on purpose (`service_role` too), `set_updated_at`, audit, a fixture row per tenant in the isolation harness, `default-grants.test.ts`. Every function: `revoke all ... from public, anon`. Money is `bigint` minor units with the shop's currency held by a foreign key to `tenants (id, currency)` with no cascade (Phase 3's rule S8), not by another `exists` in `tenants_lock_currency()`. Distances are km. A "day" is the calendar date at the vehicle's location (`platform_private.location_today()`), never a fixed offset.

### 2.1 Tables

```text
odometer_readings          append-only
  id, tenant_id, unit_id
  km              numeric(9,1) >= 0
  source          first | check_out | check_in | manual | service
  at              timestamptz (when it was read; a job's date for a job entered later)
  is_correction   true for a confirmed lower reading
  superseded_by   the correction that replaced it, if any
  job_id, rental_id          what it came from (rental_id filled from Phase 5)
  recorded_by     set in the database; note

service_tasks              the shop's own list of tasks
  id, tenant_id
  code            oil | tyre_front | tyre_rear | brakes | belt | battery
                  | gps_battery | smart_key_battery | null for the shop's own
  name            for the shop's own tasks (a built-in task is named by the app, per language)
  standard_cost   bigint, optional; currency (FK)
  position, archived_at

service_schedules          one row per task, on a product or on one vehicle
  id, tenant_id, task_id
  product_id | unit_id       exactly one
  enabled         false on a vehicle row = "not for this vehicle"
  every_km        numeric, optional
  every_days | every_months  at most one; with every_km, at least one of the three (decision 2)
  warn_km, warn_days         optional; shop defaults otherwise
  blocks_when_overdue        boolean
  starts_on, starts_km       where the count begins for a vehicle with no job for this task
  unique (product_id, task_id), unique (unit_id, task_id)

maintenance_jobs
  id, tenant_id, unit_id (never changes)
  status          open | done | void
  is_history      true for a "last done" entry (decision 3): a date and km, nothing else
  opened_at, done_on (date at the vehicle's location), closed_at
  odometer_km     at the job
  done_by_kind    in_house | garage ; done_by_user | garage_name
  notes
  block_id        its downtime block, if it holds one; set null when the block goes
  rental_id       the rental the vehicle was out on (a service visit, Phase 9)
  created_by, voided_by, void_reason

maintenance_job_tasks
  tenant_id, job_id, task_id, note
  unit_id, done_on           copied from the job when it is closed (the due read's index)
  standard_cost   the task's standard cost on the day the job was closed (a copy), currency

maintenance_job_costs      one row per job, only when the shop tracks costs
  job_id, tenant_id, currency (FK), parts_cost, labour_cost

unit_keys
  tenant_id, unit_id, key_type, number, spares (0..20), note
  unique (unit_id, key_type)

gps_trackers
  id, tenant_id, unit_id, brand_model, device_id (IMEI), sim_number,
  install_location, installed_on, removed_on, notes
  one tracker in place per vehicle (unique where removed_on is null)

follow_ups                 staff tasks the job creates (§3.3)
  id, tenant_id, kind (service_on_rental), unit_id, task_id, rental_id, due_on,
  status open | done | dismissed, closed_by, note, dedupe_key (unique per shop)

pickup_overrides           "hand it over anyway" for an overdue blocking service (§2.5)
  id, tenant_id, rental_id, unit_id, blocker (service_overdue), task_id, counted_from_job_id,
  reason (required), created_by, created_at
```

Changes to existing tables:

| Table | Change |
| --- | --- |
| `units` | `avg_daily_km numeric(6,1)`; status gains `removed`; `removed_at`, `removed_by`; `units_plate_idx` and `units_label_idx` leave removed units out |
| `products` | `removed_at`; `products_name_idx` leaves removed products out |
| `unit_renewals` | None in 1b (no new kind; the document link comes with §7) |
| `tenants` | `track_maintenance_costs` (on), `service_warn_km` (300), `service_warn_days` (7), `service_alert_roles` (default staff, mechanic, owner; decision 14), written only through `save_fleet_care_settings()`. Two more staff permissions beside Phase 3's six, **`staff_can_override_service_block`** and **`staff_can_see_job_costs`**, both off by default, written through Phase 3's `save_staff_permissions()` (decisions 6, 9) |
| `notification_outbox` | Kinds `service_due_soon`, `service_due`, `service_overdue`, `service_follow_up` |

Two differences from the spec's data model, both for the lock order: keys are a table, not a list on `units` (a list would rewrite the unit's row, with its audit row and its `updated_at`, for every spare key counted); and a job points at its block (`maintenance_jobs.block_id`) rather than `downtime.maintenance_job_id` (§2.3).

**No file column anywhere in 1b.** `maintenance_jobs` has no receipt field and `unit_renewals` gains none; the file storage stage adds the links (§7).

### 2.2 The odometer log

- **One writer.** `platform_private.write_odometer(unit, km, source, at, job, rental, confirm_lower)` updates the unit's row and inserts the reading. `platform.record_odometer()` is its public wrapper for a typed reading. `units_guard` refuses a change to `current_odometer_km` made any other way, using a transaction-local marker as Phase 3's `move_unit()` rule does. `move_unit()` is re-created so the Details form's odometer goes through the writer; `import_fleet()` and adding a vehicle write a `first` reading through an insert trigger. A migration step gives every existing vehicle a `first` reading at its current value.
- **A lower reading.** Without `confirm_lower` the answer is `{ok: false, reason: 'lower_reading', current}` and nothing is written. Confirmed, it is saved with `is_correction`, every earlier reading above it is marked `superseded_by`, and an audit event records who, from what, to what. No role is refused. (SPEC's Vehicle record line that asked for a manager override is corrected in this PR.)
- **A reading dated before the latest** (a job entered a day late) is saved in the log and does not move the current odometer.
- **Average km per day** (decision 13): worked out per vehicle from its own readings: km between the first and last readings of the last 60 days that are not superseded, divided by the days between them; empty until two readings are at least 7 days apart. Written by the same update. **Shown on the vehicle page as an estimate, and used for nothing else:** no hint, alert, follow-up or due state reads it.
- **Each reading is checked against the schedule:** the writer returns the vehicle's tasks that are now due soon, due or overdue (the read of §3.1), so the screen tells staff on the spot.
- **Where Phase 5 attaches:** check-out and check-in call `write_odometer` from inside `pick_up` and `return_rental`, with the rental's id. The lock rule for that is in §2.7.

### 2.3 Jobs and the downtime link

| Function | Does |
| --- | --- |
| `open_job(unit, job)` | A job in progress. Options: hold the vehicle (a downtime block from now, open-ended or to an expected date) and set status to maintenance |
| `save_job(job)` | Edits an open job: tasks, notes, costs, expected date |
| `close_job(job, odometer, done_on, …)` | Writes the reading (source `service`), copies each task's standard cost, ends its block now, offers "back to active" |
| `log_job(unit, job)` | A finished job in one call (the common case on a phone): open and close together, no block |
| `set_last_done(unit, task, done_on, km)` | The optional "last done" (decision 3): a `done` job marked `is_history`, with no cost and no reading written. Owner, manager, mechanic. Saving it again for the same vehicle and task replaces it |
| `void_job(job, reason)` | Owner or manager. The job stays in the log, marked void; its block is ended; its costs stop counting |

- **Next due comes from the latest `done` job with that task**, a "last done" entry included. A void job never counts.
- **A job with a block refuses a start that overlaps a booking** (`unit_taken`, naming the booking, from the exclusion constraint). Staff then reassign the booking or log the job without a hold. Jobs never move bookings.
- **Costs** (decisions 7, 8, 9):
  - Saved only when `track_maintenance_costs` is on. **Switched off, the fields are hidden and rows already saved are kept**, unseen and left out of profit; they return when it is switched on again.
  - **A job's cost is what was typed, or its standard costs, never both.** If parts or labour was typed on the job, that is its cost. If neither was typed, its cost is the sum of the standard costs copied onto its tasks at closing. Nothing is counted twice. The form says which will apply.
  - **Who enters and sees them:** owners, managers and mechanics; staff when `staff_can_see_job_costs` is on; drivers never. The `maintenance_job_costs` policies ask one helper, `platform_private.job_cost_tenant_ids()`, which returns the caller's shops where the caller is an owner, manager or mechanic, or is staff with the setting on. Standard costs on `service_tasks` follow the same rule.

### 2.4 Schedules, keys, trackers

- **Effective schedule for a vehicle and task:** its own row if there is one (`enabled = false` switches the task off for that vehicle), otherwise its product's row. One function, `platform_private.effective_schedule()`, is the only place this is decided.
- **Intervals** (decision 2): every N km, and/or every N days or every N calendar months. A 12-month task falls on the same date each year; a month-end date moves to the last day of a shorter month.
- **Where the count starts** (decision 3). For a vehicle with no job for the task: the day the schedule was saved and that day's odometer (`starts_on`, `starts_km`, filled when a template is saved and when a vehicle joins a product that has one). So a shop that sets up 150 vehicles does not find 900 tasks overdue on day one. A shop that knows better enters "last done" (date and km) for that vehicle and task, and the count runs from there instead.
- **Built-in tasks** are seeded per shop with a `code` and no name; the app names them per language. A shop adds its own, renames nothing built-in, and archives what it does not use.
- **Key types** are a list per vehicle kind in `apps/platform/lib/vehicle-kinds.ts` (motorbike: ignition, side case left, side case right, top box, lock; car: ignition, spare, remote), plus `other` with a note. Stored as text codes, so a new kind needs no migration.
- **Who sees key numbers, the IMEI and the SIM** (decision 11): everyone except drivers. The `unit_keys` and `gps_trackers` select policies name owner, manager, staff and mechanic.
- **Tracker battery and smart-key battery** are ordinary service tasks (`gps_battery`, `smart_key_battery`), as the spec says.

### 2.5 The service block at pickup, and renewals as reminders

**Decided (4, 5, 6):** only a task the shop has marked "block when overdue" can block a pickup. Expired tax, insurance and inspection never do. Availability never depends on service state.

Phase 3 builds `platform_private.pickup_blockers(order, rentals)` in its migration 5 (stage 4) and says "Phases 4 and 5 add theirs. No override in Phase 3." **This is exactly where Phase 1b attaches:**

1. `pickup_blockers()` is re-created (from the database, behind an MD5 guard) to return one more reason, **`service_overdue`**, for a vehicle rental whose unit has a task that is overdue and whose effective schedule has `blocks_when_overdue`. It carries the task and the job the count runs from. An overdue task without the mark is never a blocker.
2. **The override.** `platform.override_pickup_blocker(rental, task, reason)` writes a `pickup_overrides` row and an order History event. Allowed for owners and managers always, and for staff when `staff_can_override_service_block` is on: the function asks Phase 3's `platform_private.staff_may(tenant, permission)`, the same check its six permissions use, and the switch sits with them on Settings › Orders. `pickup_blockers()` leaves out a blocker that has an override for the same rental, task and counted-from job. A later job starts a new count, so an old override never covers a new lapse.
3. `pick_up()` itself is not re-created: it already refuses while `pickup_blockers()` is not empty.
4. **The "Service due" tag.** A reserved rental whose vehicle has an overdue blocking task is tagged **"Service due"** on the order, the order list, the Today board and the timeline. It is its own tag with its own words; it is not "at risk", and Phase 3's `bookings_at_risk` is not changed. One read, `platform.rentals_service_due(tenant)`, returns the rentals and their tasks; the order list gains a "Service due" filter.
5. **Warnings at check-out, never blockers:**
   - a task that is due soon, due or overdue and not marked to block ("oil change due in 120 km");
   - a time-based task that comes due before the rental ends;
   - **a renewal that has expired, or expires before the rental ends** ("Compulsory insurance expired 3 days ago", "Road tax expires during this rental"), so staff know the tax or insurance is due.
   One read, `platform.unit_care_warnings(unit, period)`, feeds the pickup step, the bike card and the vehicle page.

**What a service block does not do:** it does not change `free_units()`, the pick, the listing counts or any existing booking. A vehicle with an overdue blocking task can still be booked and assigned; it cannot be handed over without the job or an override with a reason.

**Renewals** stay exactly what Phase 1a built plus the warning above: Dashboard items from the shop's first reminder day, Late once expired, the hourly reminder queue, and the expiry dates on the bike card and the vehicle page, highlighted when due or expired. Nothing about a renewal is ever checked by `pickup_blockers()`. SPEC's "Expired units are blocked from new pickups unless a manager overrides with a reason" is corrected in this PR.

### 2.6 Remove for good

The owner's ask (12 Nov 2026): a shop can remove any vehicle for good while past sales history stays. **Decided (15): the vehicle and all its records stay, hidden; a product whose vehicles are all removed can be removed too.**

- **`platform.remove_unit(unit, expected_updated_at)`**, owner and manager. Refused while the unit has any block that has not ended (`unit_has_future_blocks`: move or finish its bookings first), exactly as selling and retiring are.
- **Effects, in one transaction:** status `removed`, `removed_at`, `removed_by`; its ended downtime stays as history; its tracker is marked removed; its open jobs are voided and its open follow-ups dismissed; its QR token stops resolving; its plate and label are free for another vehicle (the unique indexes leave removed rows out). **Nothing is erased:** the row, its past reservations and blocks, its readings, jobs, renewals, keys and money stay for past orders and for Phase 10's reports.
- **Never shown again, never restorable from the app.** `units_guard` refuses every later change to a removed unit, for every role and the service role. `unit_blocks_guard` treats `removed` as it treats sold, retired and lost.
- **Leaving removed vehicles out.** New code names the statuses it wants (`active`, `maintenance`), never the ones it does not. Existing readers that name what they exclude are re-created: `queue_renewal_notifications()` (`not in ('sold', 'retired')`); `product_stock()` and `gear_unit_state()` are checked the same way. A view, `platform.fleet_units` (security invoker), is what the app's fleet reads use; a static test fails if a file outside `lib/fleet-data.ts` and the order reads selects from `units` directly.
- **"Delete vehicle" stays** for a vehicle that has never been booked (it erases everything, as today). When a delete is refused, the page offers "Retire instead" and "Remove for good", and says what each keeps.
- **The product.** Today a product with any vehicle left cannot be deleted; with removed vehicles that would be forever. `platform.remove_product(product)` marks a product removed when every vehicle it has is removed (or it has none but has reservations on record). It is hidden everywhere, its name is free to reuse, and its listing is cleared first.

### 2.7 Lock order

Phase 1b adds no advisory-lock class and no new order. Every function fits Phase 3's single global order (`docs/phase-3-plan.md` §4.2): product-and-location locks, then unit locks, then rows in the order 3.1 to 3.10.

**New row classes, inside 3.9.** Phase 3's 3.9 is "charges, lines, payments, allocations, redemptions, stock movements, outbox rows". Phase 1b's rows go in the same class, after them and before the outbox: **care rows** (`maintenance_jobs`, then its tasks and costs, `odometer_readings`, `service_schedules`, `unit_keys`, `gps_trackers`, `unit_renewals`), then `follow_ups`, then `pickup_overrides`, then outbox rows. `order_counters` (3.10) stays last and no Phase 1b function touches it.

**Five rules.**

1. **A job's writes are serialised by its vehicle's advisory lock, not by the job's row.** A job's `unit_id` never changes, so the function reads it unlocked, takes the unit lock (class 2) and reads the job again. Two saves of one job take turns at the unit lock.
2. **The job points at the block, so the block is written first.** Order inside `open_job` and `close_job`: unit lock → the unit's row (odometer, status) → product and listing rows (only if the status changes, taken by Phase 3's statement-level counts trigger) → the block (3.8) → the job and its rows, the reading (3.9). With the link the other way round the job's row (3.9) would have to exist before its block (3.8).
3. **A function that holds a unit's lock takes that unit's row without waiting.** The root `CLAUDE.md` rule: a direct update of a unit locks the row and then, in `units_guard`, the unit's lock; anything that holds the lock and waits for the row can cross it. So `open_job`, `close_job`, `void_job` and `remove_unit` ask for the row `for no key update nowait` and answer `try_again`. **The same holds for Phase 5:** `pick_up` and `return_rental` hold the unit's lock when they call `write_odometer`, so inside them the unit's row is taken at 3.2 `for no key update nowait` (not `for key share`) when the call carries a reading.
4. **A typed odometer reading takes no advisory lock.** `record_odometer()` checks nothing a booking writes and changes no key column, the same reasoning that lets a unit go into repair with no lock. It waits for the unit's row in the ordinary way, then inserts its reading. Holding no unit lock, it is on the safe side of rule 3.
5. **`remove_unit` is a fourth member of "sold, retired, lost":** one unit per transaction (Phase 3's `one_unit_status_change` marker), the unit's lock, then the row, then the products and listing rows through the statement trigger.

**Who takes what** (columns as Phase 3 §4.3):

| Writer | 1 | 2 | 3 (rows, in §4.2 order) |
| --- | --- | --- | --- |
| `record_odometer` | None | None | unit row, reading |
| `log_job` (no block, no status change), `set_last_done` | None | None | unit row (the reading, `log_job` only), job, tasks, costs, reading |
| `open_job`, `close_job`, `void_job`, `save_job` when it moves the block's end | None | The job's unit | unit row `nowait`; products and listing rows if the status changes; the block; job, tasks, costs, reading; follow-ups closed |
| `save_job` otherwise | None | The job's unit | job, tasks, costs |
| `save_service_schedule` (a product's template or a vehicle's override) | None | None | the product's row `for key share` (the foreign key), then its schedule rows in task-id order |
| `save_service_task`, `save_fleet_care_settings`, `save_staff_permissions` | None | None | the task's or the shop's own row |
| `save_unit_keys`, `save_gps_tracker`, `record_renewal`, `update_renewal` | None | None | their own rows (the unit's row `for key share` by the foreign key) |
| `override_pickup_blocker` | None | None | the order row `for no key update` (3.1), then the override. As `record_payment`: an order row and nothing else |
| `remove_unit` | None | That unit | unit row `nowait`; products and listing rows; the tracker, open jobs, follow-ups |
| `remove_product` | Its places, sorted | None | the product's row `for no key update`, its listing's row, its `product_extras` and coupon links as a product delete takes them |
| `queue_service_notifications`, `queue_follow_ups` | None | None | outbox and follow-up inserts only; one runner at a time; `on conflict do nothing` |
| The due read, `rentals_service_due`, `unit_care_warnings`, the timeline, profit, `pickup_blockers()` | None | None | Nothing: reads take no lock and write nothing |

Each waiting function has `lock_timeout = '6s'`; its caller answers `try_again` for `55P03`, `57014` and `40P01` through `apps/platform/lib/try-again.ts`. Each is added to Phase 3's reviewed list of lock-taking functions and passes its static lock-strength test.

**What moves with Phase 3.** This plan re-creates five things Phase 3 writes: `units_guard` and `move_unit()` (its migrations 1 and 2), `staff_may()` and `save_staff_permissions()` (2), and `pickup_blockers()` (5). Each re-creation reads the body from the database behind an MD5 guard, so a late Phase 3 change stops the 1b migration instead of being overwritten. If Phase 3 changes §4.2's classes, the table above is rewritten before stage 1.

### 2.8 Timeline and profit

- **`platform.unit_timeline(unit, before, limit)`**: one read, newest first, keyset pages of 50. Row kinds: rental (picked up, returned, with the order's number), reading, job, renewal, downtime, status change, removed. Mechanics and drivers get rentals with no customer and no money; costs are empty for roles that may not read them. Status changes come from the unit's own audit rows, returned without exposing the audit table (as Phase 3's `order_history` does).
- **`platform.unit_profit(unit)`**, owner and manager:

| Figure | Phase 1b | Waits |
| --- | --- | --- |
| Purchase and sale price | Yes (`unit_financials`) | |
| Tax and insurance cost | Yes (`unit_renewal_costs`) | |
| Maintenance cost | Yes: for each `done` job, what was typed, or its copied standard costs when nothing was typed (§2.3); left out when tracking is off | |
| Days owned, days rented, days idle | Yes, from purchase date and the unit's ended and running `out` reservations | |
| Cost per km, revenue per day owned | Yes | |
| Rental revenue | **As billed:** the vehicle's own period lines on non-void charges of non-canceled rentals, late-return and extension lines included, net of the line's discount; extras and items for sale are not a vehicle's revenue | **As paid** (the spec's "by payment date"), card fees and card refunds: Phase 7 |
| Fleet-wide profit report, utilisation, export | | Phase 10 |

The page labels revenue "billed" until Phase 7. A swap splits a rental's lines by period, and each line belongs to the vehicle whose reservation was live in that period.

### 2.9 Who may do what, and RLS

| Action | Owner | Manager | Staff | Mechanic | Driver |
| --- | --- | --- | --- | --- | --- |
| Read schedules, due states, jobs, readings | Yes | Yes | Yes | Yes | No |
| Record an odometer reading; log, open, edit, close a job | Yes | Yes | Yes | Yes | No |
| Enter and see a job's parts and labour cost, and standard costs | Yes | Yes | Setting, off | Yes | No |
| Set "last done" | Yes | Yes | No | Yes | No |
| Void a job | Yes | Yes | No | No | No |
| Edit schedules, tasks, standard costs, Settings › Fleet care | Yes | Yes | No | No | No |
| Read key numbers and tracker details | Yes | Yes | Yes | Yes | No |
| Edit keys and tracker | Yes | Yes | No | Yes | No |
| Record a renewal | Yes | Yes | Yes | Yes | No |
| Renewal cost, purchase and sale, profit | Yes | Yes | No | No | No |
| Override an overdue blocking service at pickup (with a reason) | Yes | Yes | Setting, off | No | No |
| Close or dismiss a follow-up | Yes | Yes | Yes | No | No |
| Remove for good (vehicle, product) | Yes | Yes | No | No | No |

One function, `platform_private.care_roles(action)`, mirrored by `apps/platform/lib/care-permissions.ts` with a test that holds the two together, as `booking_roles` and `gear_roles` are. The two settings are checked in the database (`staff_may`), not only on the screen. Tables are read through policies in the set form and written **only through functions**: no new table has a direct write grant.

### 2.10 Migrations, in order

| # | Name | Stage | What |
| --- | --- | --- | --- |
| 1 | `platform_odometer_log` | 1 | `odometer_readings`; `units.avg_daily_km`; `write_odometer`, `record_odometer`; `units_guard` and `move_unit()` re-created; first readings for existing vehicles |
| 2 | `platform_service_schedules` | 2 | `service_tasks` (seeded for every shop and by `create_tenant()`), `service_schedules`, `effective_schedule`, `service_due`; the fleet-care settings and `save_fleet_care_settings()`; the two staff permissions, with `staff_may()` and `save_staff_permissions()` re-created |
| 3 | `platform_maintenance_jobs` | 3 | `maintenance_jobs`, its tasks and costs; `job_cost_tenant_ids()`; the six job functions |
| 4 | `platform_keys_trackers` | 4 | `unit_keys`, `gps_trackers`; `update_renewal()` |
| 5 | `platform_service_pickup_block` | 5 | `pickup_overrides`, `override_pickup_blocker()`; `pickup_blockers()` re-created with `service_overdue`; `rentals_service_due`, `unit_care_warnings` |
| 6 | `platform_care_jobs` | 6 | Outbox kinds; `follow_ups`; `queue_service_notifications()`, `queue_follow_ups()` and their schedules |
| 7 | `platform_remove_for_good` | 7 | Status `removed`, the columns and indexes, `remove_unit()`, `remove_product()`, the guards, `fleet_units`, the re-created readers |
| 8 | `platform_care_reads` | 8 | `unit_timeline`, `unit_profit`, `fleet_care_summary` (the Fleet list's "next service due") |

## 3. Working out what is due

### 3.1 The rule

For a vehicle (status active or maintenance) and each task of its effective schedule:

- **Counted from:** the latest `done` job with that task, a "last done" entry included (its `done_on` and `odometer_km`); with none, the schedule row's `starts_on` and `starts_km`.
- **Due at:** counted-from km + `every_km`; counted-from date + `every_days` or `every_months` (calendar months). Whichever comes first decides.
- **State:** `overdue` once past either; `due` on the day or at the km; `due_soon` within `warn_km` or `warn_days` (the row's, else the shop's defaults); otherwise fine. Today is the calendar date at the vehicle's location.
- **A vehicle out on rental:** its odometer cannot be read, so km-based states stay as they were at check-out and the row is marked "out, odometer as of pickup"; time-based states keep running.
- **Real readings and dates only.** The average km per day is never an input (decision 13).

This is one pure function in `@mango/core` (`serviceState(schedule, countedFrom, odometer, today)`) with unit tests, and one SQL function with the same cases run through both, as the coupon-code normaliser is tested.

### 3.2 On read, not on a schedule (decision 1)

**`platform.service_due(tenant, unit_ids default all)`** computes the states when asked. Nothing stores a due flag.

- **Why not a stored state kept by `pg_cron`:** a time-based task becomes due at midnight at the vehicle's location with no write anywhere. A stored flag is wrong until the next run, differs by time zone, and needs every writer (a job, a reading, a schedule edit, a moved vehicle, a changed warn threshold) to refresh it under a lock. The renewals in Phase 1a are read the same way: the dashboard computes; the hourly job only queues messages.
- **What does need a schedule:** things that must happen exactly once when a state is reached (a message, a follow-up). §3.3.

**Cost at fleet scale** (estimates, to be replaced by measured numbers in stage 2):

| Fleet | Pairs (vehicles × about 6 tasks) | Work | Expected |
| --- | --- | --- | --- |
| BSR, about 60 vehicles | 360 | One index lookup per pair on `maintenance_job_tasks (unit_id, task_id, done_on desc)` plus the unit and schedule rows | A few ms |
| Big Fleet Demo, 150 | 900 | Same | Under 10 ms |
| 2,000 vehicles | 12,000 | Same | Under 100 ms |

- The index carries `unit_id` and `done_on` on the job-task row (copied from the job when it is closed) so the lookup never visits the job.
- Callers that need one vehicle (the bike card, the reading's on-the-spot answer, `pickup_blockers()`) pass its id: 6 lookups.
- The Dashboard and the due list call it once per page load for the whole shop; the Fleet list's "next service due" sort uses `fleet_care_summary`, the same read reduced to one row per vehicle.
- **Accept test, stage 2:** the read for 150 and for 2,000 seeded vehicles, each with 6 tasks and 40 jobs, recorded in PROGRESS. **Fallback if 2,000 vehicles takes over 150 ms:** a `unit_service_state` table holding only "counted from" per vehicle and task (never the state itself), written by `close_job`, `set_last_done` and `void_job`. The date and odometer comparison stays on read.

### 3.3 The hourly job

Two functions, run from the schedule Phase 3's `queue_due_messages()` uses (one runner; if that function exists they are called from it rather than given a second cron entry):

- **`queue_service_notifications()`**: for each vehicle and task whose state is due soon, due or overdue, one outbox row per state per cycle. Dedupe key: `service:<unit>:<task>:<counted-from job or 'start'>:<state>`. A new job starts a new cycle, so the next oil change is announced again; the same one never twice.
- **`queue_follow_ups()`**: for each vehicle with a reservation `out`, each **time-based** task that is due soon, due or overdue: one `follow_ups` row, kind `service_on_rental`, with the rental. Owners, managers and staff see it on the Dashboard with the order (they can read the customer); a mechanic sees "out on rental until …" with no customer. Logging a job with that task closes it; staff can mark it done ("arranged for Tuesday") or dismiss it with a note.
- Rows hold facts, not text, as the renewal rows do.
- **How Phase 6 attaches** (decision 14): Phase 3's sender (switched off until Phase 6 verifies a sending domain) already reads the outbox by kind, with `channel` and `recipient`. Phase 6 adds the service kinds' templates in each language and a LINE transport. Recipients are worked out at send time from `tenants.service_alert_roles`: **staff, mechanics and owners by default; managers off by default and can be added** on Settings › Fleet care. Rows queued while sending is off are marked expired unless still due, by Phase 3's own rule, so switching on does not flood anyone. Until then the Dashboard and the Maintenance tab are where a due task is seen.
- **Cost:** one `service_due` pass over all shops per hour plus inserts that mostly conflict and do nothing. At 50 shops of 150 vehicles that is 45,000 pairs, well under a second.
- **`pg_cron` and the planned move to Neon:** each job is a plain SQL function the service role can call (`platform.queue_…()`), scheduled by `pg_cron` where the extension is there and skipped where it is not, as the two existing jobs are. If the database has moved by the time 1b is built, the same functions are called from an app-side scheduled function instead; nothing in them changes.

## 4. Screens

Every staff screen works at 375 px; English and Thai keys together; Thai lines go on Korn's review list. Distances show in the shop's unit; money through `Intl.NumberFormat` with the shop's currency; dates in the location's time zone. No new dependency. **No screen in 1b has a file field**; where a receipt or document photo will go, nothing is shown until the file storage stage adds it.

### 4.1 Vehicle page (`/[tenant]/fleet/units/[id]`)

Desktop: two columns, the sections below in a left-hand list with the open one on the right. Phone: one column of collapsible sections, the same order.

| Section | Who | What |
| --- | --- | --- |
| Details, Status, Downtime, QR sticker | As today | Notes stay here. The odometer field goes through the log |
| **Service** | All but drivers; edit: owner, manager | Each task with its state ("Oil: due in 120 km or 9 days") and what it is counted from. "Last done" per task (date and km). "Use this vehicle's own schedule" opens the override per task |
| **Maintenance log** | All but drivers | Jobs newest first: date, odometer, tasks, done by, cost (by role and setting), notes. "Log a job", "Start a job" (with the hold option), "Void" (owner, manager) |
| **Odometer log** | All but drivers | Readings with source, who and when; corrections marked. **Average km per day, labelled an estimate** (the only place it appears) |
| **Keys** | All but drivers | A row per key type: number, spares |
| **GPS tracker** | All but drivers | The tracker in place; "Replace" keeps the old one in history |
| **Tax and insurance** | As today; cost: owner, manager | As built, plus Edit, the expired and expiring highlights, and "Renew in this order": inspection where the shop uses it, compulsory insurance, road tax |
| **Timeline** | Everyone, by role (§2.8) | One scrolling history with a filter by kind; "Load more" |
| **Profit** | Owner, manager | §2.8's figures, revenue labelled "billed" |
| Purchase and sale | Owner, manager | As today |
| Delete vehicle / Remove for good | Owner, manager | "Remove for good" asks for the plate to be typed and says that everything is kept but hidden |

### 4.2 Staff app: Maintenance tab

- **Search** as today (plate, frame number, QR), now also matching notes. A result opens the **bike card**, not the full page.
- **Bike card** (`/[tenant]/maintenance/units/[id]`, phone first; also where a scanned sticker lands for a mechanic): plate, product, status, odometer; tasks due, worst first; **tax and insurance status, with a clear line when one is expired or about to expire**; key numbers and tracker; notes; whether it is out on rental and until when. Four large buttons: **Update odometer**, **Log a job**, **Record a renewal**, **In / out of maintenance**. "Open full page" for owners and managers.
- **Log a job** (one screen on a phone): tasks as tick boxes with the due ones ticked, odometer (pre-filled, with the lower-reading confirmation), date (today), done by, costs (by role and setting, with the line "leave empty to use the standard cost"), notes. On desktop the same form in a side panel.
- **Due list** below the search: every vehicle with something due soon, due or overdue, one line per vehicle with its tasks, overdue first, then by date or km left. Filters: state, task, location. Vehicles out on rental are marked.

### 4.3 Fleet-wide due list (`/[tenant]/maintenance/due`)

Desktop first, the same data as a table: vehicle, product, location, task, state, counted from, due at (km and date), km and days left, last job. Sort by any column; filter by state, task, product, location; a "Blocks pickup" filter; print. Phone: the Maintenance tab's list. The Fleet list gains the "next service due" sort and a small due marker on each vehicle line.

### 4.4 Dashboard, orders and pickup

- **Today, Tomorrow, Upcoming → "Services due":** one item per vehicle. A time-based task shows on its date; a km-based one that is due or due soon shows under Today. Follow-ups for vehicles out on rental show here for owners, managers and staff.
- **Late → "Overdue maintenance":** vehicles with an overdue task, blocking ones marked.
- **Renewals** as today (Upcoming from the first reminder day, Late once expired). Counts on the tabs include the new items.
- **Orders:** the **"Service due"** tag on a booking whose vehicle has an overdue blocking task, with a filter in the order list.
- **At pickup** (Phase 3's order page): a blocking overdue service stops the hand-over, with "Override" (reason required) for whoever may. Below it, warnings that never stop it: services due, and **"Insurance expired" / "Road tax expires during this rental"**.

### 4.5 Settings

| Screen | Who | What |
| --- | --- | --- |
| **Settings › Fleet care** (`/[tenant]/settings/fleet-care`), desktop first | Owner, manager | Service tasks (add, archive, order, standard cost each); "Track maintenance costs"; default warn thresholds; renewal reminder days and digest day (moved from shop settings); who is told about services due (staff, mechanics, owners ticked; managers not) |
| **Settings › Orders** (Phase 3's screen) | Owner, manager | Two more staff permissions: "Staff can override a service block at pickup" and "Staff can enter and see job costs", both off |
| **Product page › Service schedule** tab (vehicles only) | Owner, manager | The template: per task, every N km and/or N days or months, warn, block when overdue; "Copy from another product"; how many vehicles use their own schedule |
| Products list, product delete | Owner, manager | "Remove product" where §2.6 allows it |

## 5. Stages

One PR each. Migrations local only until Mark says otherwise; staging as each merges, on his word; live only from `main`. **Fable build** = built on Fable (locks, RLS, money, the pickup rule, job SQL). **Opus + Fable check** or **review** = built on Opus, checked by Fable before merge.

| # | Stage | Migration | Model | Accept tests |
| --- | --- | --- | --- | --- |
| 1 | **Odometer log** | 1 | Fable build (re-creates `units_guard` and `move_unit()`) | Isolation for `odometer_readings` (5 roles × 2 shops, stranger, Moto Mangos customer, anon); a direct update of `current_odometer_km` refused for every role and the service role; the Details form's odometer lands in the log through `move_unit()`; a lower reading refused without confirmation, saved with it, earlier higher readings superseded, one audit event; a past-dated reading does not move the current value; average km per day over DST and with fewer than two readings; every existing vehicle has a first reading after the migration, counts and checksums of `units` otherwise unchanged; **gate tests: `record_odometer` against a booking of the same unit, against `move_unit()`, and against the unit being sold: 0 deadlocks, 30 rounds × 3 shops**; an odometer write locks no product row (the counts trigger) |
| 2 | **Service tasks, schedules, the due read, settings** | 2 | Fable build | Isolation for both tables; every shop has the eight built-in tasks, a new shop too; a vehicle row overrides and can switch a task off; `serviceState` in `@mango/core` and `service_due` in SQL agree on a shared case file (km first, date first, days and calendar months, a month-end date, warn thresholds, a shop in a DST zone, miles shown and km stored); **"an odometer reading that crosses the oil interval raises a service-due alert"** (the spec's line); a template saved today leaves no task overdue; **the average km per day changes no state** (a test sets it wildly and compares); `service_due` timed at 150 and 2,000 vehicles and recorded; fleet-care settings saved only by owner and manager; the two new staff permissions default off, saved only by owner and manager, audited, and Phase 3's six unchanged |
| 3 | **Maintenance jobs, costs, the downtime link** | 3 | Fable build | Isolation for the three tables; **"a maintenance job blocks the unit"**: a booking over an open job's hold is refused, by pick and by name; a hold over a booking is refused `unit_taken`; closing ends the block at now and next due moves; "last done" moves the count and writes no reading and no cost; a void job no longer counts and its block ends; **costs: a mechanic enters and reads them; staff are refused with the setting off and allowed with it on, by policy and by function; a driver never**; with tracking off the fields are refused and saved rows stay, uncounted; **a job with typed costs counts only those, a job with none counts its copied standard costs, never both**; standard cost copied at close and unchanged by a later edit; currency change refused once a cost exists; **gate tests: `open_job` with a hold against a booking of the same unit; `close_job` against a direct status change of the unit; two `save_job` calls on one job; `open_job` against the unit being sold: one waits or answers `try_again`, 0 deadlocks**; the reviewed lock list and the static lock-strength test pass |
| 4 | **Keys and trackers** | 4 | Fable build (RLS; small) | Isolation for `unit_keys` and `gps_trackers`; owner, manager, staff and mechanic read them, a driver reads neither; one tracker in place per vehicle, a replaced one kept; `update_renewal` keeps `recorded_by` and saves the renewal and its cost together |
| 5 | **Service block at pickup, override, warnings** | 5 | Fable build | `pick_up` refused for an overdue task marked to block, and **not** refused for an overdue task without the mark; **not refused for any expired renewal, of any kind** (a test per kind); the override: owner and manager always, staff only with the setting on, mechanic and driver never, an empty reason refused; an override stops covering once a later job's count is overdue; `rentals_service_due` tags the right rentals and nothing else; `unit_care_warnings` returns expired and expiring renewals and due tasks, with "today" at the unit's location in a DST shop; **`free_units()`, `availability()` and the pick give the same answers with and without an overdue blocking task**; every Phase 3 pickup test unchanged; **gate test: `override_pickup_blocker` against `pick_up` of the same order** |
| 6 | **Service messages and follow-ups** | 6 | Fable build (job SQL) | Each job run twice writes once; one message per state per cycle, a new cycle after a job; a follow-up only for a time-based task on a vehicle that is out, closed by the job, dismissed with a note; with sending off nothing reaches the transport; recipients follow `service_alert_roles` (default staff, mechanic, owner; a manager only when added); a mechanic's read of a follow-up has no customer; the jobs beside stages 1 and 3's races, 0 deadlocks; time for 50 shops × 150 vehicles recorded |
| 7 | **Remove for good** | 7 | Fable build | Refused with a block that has not ended; the plate and label reusable at once; the QR token dead; **every record still there afterwards** (readings, jobs, renewals, keys, money, past reservations: counted before and after); no later change to the row by any role or the service role; no new block on it; left out of `free_units`, stock counts, listing counts, stickers, the renewal queue, the due read, the Dashboard and every fleet read (one test per reader); a past order still shows its plate; a two-unit removal in one transaction refused; `remove_product` only when every vehicle is removed, name reusable, listing cleared; **gate tests: `remove_unit` against a booking picking that unit, against `move_unit()`, against `open_job`: 0 deadlocks**; the static test that only the listed files read `units` directly |
| 8 | **Timeline and profit reads** | 8 | Opus build + Fable review (role leakage in the security-definer reads; the revenue and cost rules) | Timeline pages in order with no gap or repeat across a page edge; mechanic and driver rows carry no customer and no money; job costs in the timeline follow the role and the staff setting; profit to the minor unit against a hand-worked vehicle (purchase, three renewals, four jobs: typed costs, standard costs only, tracking off, void; a swap mid-rental, a late return, a canceled rental, a void charge), in THB, USD and VND; cross-tenant test per read; response times |
| 9 | **Vehicle page** | None | Opus + Fable check | Playwright at 375 and 1280 px: every section of §4.1 by role; override a schedule for one vehicle; set "last done"; log a job; replace a tracker; the average shown only in the Odometer log; remove for good with the typed plate; no file field anywhere; Thai at phone width |
| 10 | **Staff app: bike card, log a job, due list, Dashboard** | None | Opus + Fable check | A mechanic scans a sticker, lands on the card, updates the odometer, is told "oil change due", logs the job, and the task leaves the due list and the Dashboard, in under a minute at 375 px; the card shows an expired insurance line; notes shown on the card and found by both searches; the lower-reading confirmation; the due list with 150 vehicles |
| 11 | **Settings, product schedule tab, order-page pieces, wrap-up** | None | Opus + Fable check | Settings › Fleet care and the product tab by role; the two staff permissions on Settings › Orders switch the screens and are refused by the database when off; cost tracking off hides every cost field; on the order page the "Service due" tag, the override and the renewal warning; the Fleet list's "next service due" sort; demo seed with tasks in every state, a job in progress, an expired renewal, a blocking overdue task and a removed vehicle; help articles (Fable checks the cost and profit ones); doc edits (§9); staging on Mark's word |

Order: 1 before 2 (the read needs the odometer) and 3 (a job writes a reading); 5 needs 2, 3 and Phase 3's stages 2a and 4; 6 needs 2 and Phase 3's stage 8; 7 stands alone after Phase 3's stage 1; 8 needs 1 to 4 and 7; the screens need 8.

**True-concurrency tests** are on gates (never `pg_sleep`), in Bangkok THB, New York USD (DST) and Saigon VND, many rounds, exact outcomes, nothing half-written, Postgres' deadlock count unchanged, as Phases 2 and 3 do.

**Not truly testable in Phase 1b:** that `pg_cron` fires each hour (the functions are tested directly); LINE and email delivery (Phase 6); the odometer written from check-out and check-in (Phase 5: tested here by calling `write_odometer` inside a transaction that holds the locks `pick_up` will hold).

## 6. Decisions

### 6.1 Mark's decisions, 19 Nov 2026

| # | Decision | Where |
| --- | --- | --- |
| 1 | What is due is worked out on read; an hourly job only for messages and follow-ups | §3.2, §3.3 |
| 2 | Intervals in days or calendar months (a battery every 12 months), and/or km | §2.1, §2.4, §3.1 |
| 3 | Counting starts the day the schedule is saved, at that day's odometer, with an optional "last done" entry (date and km) per vehicle and task | §2.3, §2.4, §3.1 |
| 4 | The label users see is "Service due", not "at risk". Only tasks marked "block when overdue" block a pickup, with an override. Overdue service never removes a vehicle from new bookings; availability never depends on service state | §2.5, §4.4, stage 5 |
| 5 | Expired renewals (insurance, road tax, inspection) never block a pickup. Reminders only: the Dashboard, the bike card, the vehicle page, and a warning at check-out. SPEC corrected | §2.5, §4, stage 5; `docs/platform/SPEC.md` |
| 6 | A service block can be overridden by owners and managers, and by staff when a staff permission is on (default off), in Phase 3's staff-permissions pattern | §2.1, §2.5, §2.9, stages 2, 5, 11 |
| 7 | A task's standard cost is used only when no parts or labour cost is typed, so nothing is counted twice | §2.3, §2.8, stages 3, 8 |
| 8 | Cost tracking switched off: saved costs are kept, hidden | §2.3, stage 3 |
| 9 | Job costs: owners, managers and mechanics enter and see them; staff when "staff can enter and see job costs" is on (default off); drivers never | §2.3, §2.9, stages 2, 3 |
| 10 | No files stored on the platform. The storage module leaves 1b. Receipt and renewal-document fields wait for a new, separate stage before Phase 4, "Shop file storage (Google Drive)". SPEC corrected; the 10 Nov decision to defer the Drive option is reversed | §7, §1.3; `docs/platform/SPEC.md`, `docs/PROGRESS.md` |
| 11 | Key numbers, IMEI and SIM: visible to everyone except drivers | §2.4, §2.9, stage 4 |
| 12 | No "registration" renewal kind. SPEC's kind list corrected to the built table | §1.2; `docs/platform/SPEC.md` |
| 13 | Average km per day: per vehicle from its own readings, shown on the vehicle page as an estimate only. No hints, alerts or follow-ups from it | §2.2, §3.1, §4.1, stage 2 |
| 14 | Messages about services due (once sending is on in Phase 6): a shop setting, defaulting to staff, mechanics and owners; managers off by default and can be added | §2.1, §3.3, §4.5, stage 6 |
| 15 | Remove for good: the vehicle and all its records stay but are hidden; a product whose vehicles are all removed can be removed too | §2.6, stage 7 |
| — | A lower odometer reading needs confirmation and is audited, not a manager override. SPEC's stale line corrected | §2.2; `docs/platform/SPEC.md` |

### 6.2 Open points

1. ~~**The design of "Shop file storage (Google Drive)"** (§7): its own Fable design, later, before Phase 4.~~ Designed in `docs/platform/file-storage-design.md`; Mark decided its points on 20 and 21 Nov 2026.

### 6.3 Decided in this plan without asking (say if any should change)

- Keys are a table, and a job points at its block; both differ from the spec's data model (§2.1).
- Every odometer change goes through one function; the Details form keeps its odometer field.
- A reading dated before the latest is logged and does not move the current odometer.
- Average km per day: the last 60 days, at least two readings 7 days apart.
- Default warn thresholds 300 km and 7 days (the spec's example), per shop, overridable per task.
- "Last done" is stored as a job marked as history, so there is one rule for where a count starts. Owners, managers and mechanics set it.
- A job with a hold never moves a booking; it is refused and staff choose.
- A void job stays in the log; jobs are never deleted except with their vehicle.
- An override covers one rental and one lapse, not the vehicle from then on.
- The "Service due" tag is for an overdue task marked to block; other due tasks show as warnings at pickup and on the due list, not as a tag on bookings.
- A staff member with job costs switched on also sees standard costs; with it off, neither.
- Revenue per vehicle is its own period lines; extras are not counted to a vehicle.
- One Dashboard item per vehicle, not per task.
- The bike card is its own phone-first page; the full vehicle page stays the admin view.
- Gear gets none of this.
- "Then daily once expired" (spec, renewal reminders) stays one `expired` row plus the Dashboard's Late tab; whether LINE repeats daily is Phase 6's choice.

## 7. Shop file storage (Google Drive): outline of a separate stage

**Not part of Phase 1b. Its own stage, before Phase 4.** Its design is `docs/platform/file-storage-design.md` (decided 20 and 21 Nov 2026), which replaces the shape below wherever they differ. The seven questions are answered there: 1 in §2.2, 2 in §2.5, 3 in §3, 4 in §2.3, 5 in §9, 6 by decision 7, 7 in §7.5.

**Decided**

- The platform stores no files. Each shop connects its own Google Drive; every file lives there.
- The platform keeps **only a link per file**: the Drive file id, with what it belongs to.
- **One module** serves every file: 1b's job receipts and renewal documents, Phase 4's passports and licences, Phase 5's inspection photos (and, by the same route, signed agreements and payment receipts). It is the single storage module the root `CLAUDE.md` requires; nothing else talks to Drive.
- **A shop without a connected Drive can't attach files.** File fields are hidden or disabled with a note ("Connect Google Drive in Settings to attach files"). Everything else works.

**Shape (to be confirmed by the design)**

| Topic | Outline |
| --- | --- |
| Connecting | An owner connects a Google account on a Settings screen. The platform asks for the narrowest scope, **`drive.file`**: it can see and change only files and folders it created itself, never the rest of the shop's Drive |
| Where files go | One folder the platform creates in that Drive, with sub-folders by kind. Files are never shared by link; they stay private to the account |
| The link | A `files` table: tenant, Drive file id, kind (receipt, renewal document, passport, licence, inspection photo, …), what it belongs to, name, size, type, who added it, when, `delete_after`. `maintenance_jobs` and `unit_renewals` point at it; no path or URL is stored |
| Uploading and viewing | Through the platform's server, which checks the caller's role first; viewing is logged for the kinds Phase 4 requires. The shop's Drive token is a secret kept server-side, readable by no signed-in role |
| Access revoked, account changed, file deleted in Drive | The links stay; the files can't be opened. Every file field shows "Google Drive is disconnected" (or "file missing" for one deleted in Drive) and owners get a Dashboard item. Reconnecting the same account restores access; nothing in the platform is lost because nothing was stored here. Connecting a different account starts a new folder and leaves old links unreadable: the design must say whether that is allowed without a warning step |
| PDPA retention and deletion | The shop is the controller and its Drive is where the personal data sits. The retention job (Phase 4) deletes the file **in the Drive** through the API, then clears the link; `drive.file` allows deleting files the platform created. If the Drive is disconnected when a deletion falls due, the job can't act: the file is listed as "deletion overdue" for the owner until it is reconnected or the owner confirms it was deleted by hand. A customer's request for a copy or for deletion runs the same way. Files in the Drive's own bin are the shop's to empty; the design must say what the platform tells the shop about that |
| Leaving the platform | The shop already owns every file |

**Questions the design must answer**

1. Google's review requirements for an app using `drive.file`, and how long it takes.
2. Where the Drive token is kept (it is a credential, and the database may move to Neon) and how it is rotated.
3. Uploads on a poor connection (Phase 5 queues photos): direct to Drive with a short-lived upload session, or through the platform's server.
4. Who in the shop may connect, reconnect or disconnect; what a second location or a second Google account means.
5. Countries where Google Drive is not usable, given "built for any country": whether a second provider sits behind the same module later.
6. Whether Phase 4 can go live for a shop that refuses to connect a Drive (it could record document numbers and expiry without images).
7. What the Thai lawyer's privacy review needs to see about files held in the shop's own Drive.

**Effect on Phase 1b:** none on its stages. When the storage stage is built it adds a receipt link to `maintenance_jobs` and a document link to `unit_renewals`, and the file fields on "Log a job" and "Record a renewal".

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| **Phase 3 is not built yet**, and this plan re-creates five of its objects and sits on its lock order | Every re-creation behind an MD5 guard; §2.7's table rewritten before stage 1 if §4.2 has changed; stages 1, 4 and 7 depend only on Phase 3's stage 1 |
| A new deadlock from holding a unit's lock and waiting for its row | Rule 3 of §2.7 (`nowait`, `try_again`), the gate tests of stages 1, 3 and 7, the deadlock count in every race, Phase 3's static tests |
| Phase 5 writes the odometer inside `pick_up` and `return_rental` and gets the row strength wrong | Written here (§2.2, §2.7 rule 3) and tested in stage 1 inside a transaction holding those locks; to be carried into the Phase 5 plan |
| The due read is slower than estimated | Measured in stage 2 at 150 and 2,000 vehicles; the fallback table stores only "counted from" |
| A shop is flooded with due items on day one | The count starts when the schedule is saved (decision 3); one Dashboard item per vehicle; messages stay off until Phase 6 |
| A vehicle goes out with expired insurance because nothing stops it (decision 5) | The reminders from the shop's first reminder day, the Late tab, the bike card, and the warning on the pickup step itself; a test that the warning is on the screen where the hand-over is confirmed |
| A service block stops a busy desk | Only tasks the shop marks; the "Service due" tag days ahead; an override with a reason; the shop can let staff override |
| A removed vehicle still appears somewhere | New code names the statuses it wants; one test per existing reader; the `fleet_units` view and the static test |
| "Remove for good" pressed by mistake | Owner and manager only; the plate typed to confirm; nothing is erased, so support can restore it by hand |
| Costs drift after the fact | Standard cost copied at close; typed or standard, never both; a void job is marked, not deleted; revenue from frozen lines |
| A job logged without a typed cost by mistake counts only the standard cost | The form says so under the cost fields; the job can be edited by whoever may see costs |
| Odometer corrections bend the average | Superseded readings are left out; the average drives nothing (decision 13) |
| Receipts and renewal documents have nowhere to go until the storage stage | Stated on no screen as a missing feature; the notes field and the reference number carry what is needed meanwhile; the stage is placed before Phase 4 |
| The Drive stage is larger than it looks (Google's review, tokens, revoked access, PDPA deletion) | Its own Fable design before any build (§7); Phase 4 depends on it and can't start without it |
| `pg_cron` after the move to Neon | Jobs are plain functions callable by the service role; the scheduler is replaceable (§3.3) |
| Scope: eleven stages | Database first, each stage usable alone; screens on Opus with Fable checks; stages 8 and 11 can slip without blocking BSR's daily use |
| Thai wording for about 200 new lines | Keys added in both languages; the list goes to Korn |

## 9. Doc edits

**Done in this PR** (`docs/platform/SPEC.md`, on Mark's word, 19 Nov 2026):

- Renewal reminders: expired renewals never block a pickup; they are reminders and a check-out warning (decision 5).
- Vehicle record › Odometer log: a lower reading needs confirmation and is audited, not a manager override.
- Data model: `unit_renewals` kinds are the four built ones, no `registration` (decision 12).
- File storage: no files on the platform; files live in the shop's connected Google Drive and the platform keeps a link (decision 10). Changed in Tech stack, the Data model's `tenants` and `customer_documents` rows, Customers and KYC › document storage and PDPA point 6, Review decisions › Hosting and data, the Build plan's Phase 4 line and the change log.

**Still to do, with the stages:**

- `docs/platform/SPEC.md`: Data model: `units.keys` → `unit_keys`; `downtime.maintenance_job_id` → `maintenance_jobs.block_id`; `service_schedules.every_months`; status `removed`; `pickup_overrides`, `follow_ups`. Vehicle record: standard cost used only when nothing is typed; service alerts' default recipients; "Service due". Fleet: "Remove for good" under Phase 1b. Build plan: the file storage stage before Phase 4.
- Root `CLAUDE.md`, Lock order: §2.7's five rules and the care rows' place in class 3.9 (with stage 1).
- `docs/phase-3-plan.md`: its §3.10 gains two staff permissions when 1b's stage 2 is built; a note for the Phase 5 plan on the odometer write (§2.7 rule 3).
- `docs/help`: articles for the new screens with stages 9 to 11; the existing "delete a vehicle" article gains "Remove for good".
- `docs/PROGRESS.md`: an entry per stage.

## 10. Changes since draft 1

| Decision | Change | Section |
| --- | --- | --- |
| 1, 2, 3, 8, 11, 15 | As draft 1 recommended; written as decided. "Last done" is now its own function and a marked job | §2.3, §2.4, §2.6, §3 |
| 4 | "Service due" tag through its own read; `bookings_at_risk` no longer re-created | §2.5, §4.4, stage 5 |
| 5 | Renewal blockers removed: no `renewal_expired` reason, no `renewal_block_kinds` setting; renewals are warnings at check-out. Stage 5 shrinks to the service block | §2.1, §2.5, §2.10, stage 5 |
| 6 | Override by staff behind `staff_can_override_service_block`; `staff_may()` and `save_staff_permissions()` re-created in migration 2 | §2.1, §2.5, §2.9 |
| 7 | Standard cost only when nothing is typed (draft 1 recommended adding both) | §2.3, §2.8 |
| 9 | Mechanics always, staff behind `staff_can_see_job_costs` (draft 1 recommended staff always) | §2.3, §2.9 |
| 10 | Storage module, receipt photo and renewal photo removed from 1b; migration 4 loses `file_path` and the `record_renewal()` re-creation; the Drive stage outlined | §1, §2.1, §2.10, §4, §7, stages 3, 4 |
| 12 | No `registration` kind | §1.2 |
| 13 | "About N days" estimates removed from the Service section, the bike card and the due list; the average appears only in the Odometer log | §2.2, §3.1, §4 |
| 14 | Default recipients staff, mechanics, owners; managers off | §2.1, §3.3, §4.5 |
