# Moto Mangos switch (3M): open points, options and recommendations

**Written 26 Nov 2026, from `main` at `466adb6` (PR 82 merged; 71 migrations), with PR 79 (Phase 3 stage 2b, open, head of `refs/pull/79/head` as fetched) read for what it changes. Docs only: nothing was run, built or tested, and no database, provider or console was opened.** This prepares the design review of 3M. **Nothing here is decided.** Every decision already in `docs/platform/SPEC.md`, `docs/phase-3-plan.md`, `docs/platform/payments-design.md`, `docs/INTEGRATION.md` and `docs/platform/neon-move-plan.md` stands as written; each point below is a proposal for Mark.

**Read for this:** `docs/phase-3-plan.md` §1.2 (its 3M row; §8 has no 3M row, because 3M gets its own plan, §7), §2.3, §3.2, §7 and §11; `docs/platform/SPEC.md` (Product scope item 4, Built for any country › Moto Mangos, ranking and vendor billing, Data model › orders, Online booking, Review decisions › 3M and "When the renter pays"); `docs/platform/payments-design.md` §4 and §11.1; `docs/INTEGRATION.md`; `docs/marketplace/SPEC.md` (booking modes, payments and cancellation, vendor terms, referral program); `docs/platform/MAPPING.md`; `docs/platform/neon-move-plan.md` §7 and §8a; `apps/marketplace` (`lib/data/*`, `lib/fees.ts`, `lib/fee-lifecycle.ts`, `lib/flags.ts`, `lib/hidden-areas.ts`, the customer, account and admin routes); every migration that names `marketplace`, `product_listings`, `request` or the legacy `public` tables; PR 79's description and its migration `20261125000100_platform_order_core.sql`.

**Facts and inferences.** A statement with a file reference is documented fact. **Anything marked *(inference)* is my reading** and has not been checked. "PR 79" means the open stage 2b branch: its behaviour is not on `main` yet.

**3M comes after the Neon move** (neon-move-plan decision 1: Phase 3 → the move → 3M → 1b). Each point has a **Neon** line saying whether the move changes the answer.

## Summary

| # | Point | Recommended | Confidence |
| --- | --- | --- | --- |
| 1 | Request-to-book: statuses, accept, decline, timeouts | (a) `request_status` pending → accepted / declined / expired; expiry fixed at creation; accept runs `reserve_core` on the `requested` order | Medium |
| 2 | Do pending requests count against the cap and the dates? | (a) A `requested` reservation with no block, counted by `marketplace_peaks()` only | Medium |
| 3 | Who may cancel a Moto Mangos order, and when | (b) Customer through Moto Mangos; shop with a reason from a list, always counted as the shop's; no-show by the shop after pickup time; system for unpaid fee, expiry | Medium |
| 4 | The fee on each kind of cancellation | (a) `fee-lifecycle.ts` as it stands, driven by `cancelled_by` + `cancel_reason`; two reasons added | High |
| 5 | How the fee amount reaches the order's negative line | (c) The shared booking package works out base and fee from one quote, on the server; the database checks the fee against the rule it is given | Medium |
| 6 **[added]** | The fee record and the order in one transaction | (a) `create_booking` writes the fee record in the same transaction | Medium |
| 7 | How Moto Mangos orders show in the shop's order list | (b) Channel badge, Requests tab with a countdown, fee status pushed to the order | Medium |
| 8 **[added]** | The status the renter sees (`get_booking`) | (a) One SQL mapping function, tested against every row of INTEGRATION §5 | High |
| 9 **[added]** | Shop edits to a Moto Mangos order after booking | (a) Allowed, fee untouched; date changes and price overrides upward refused before pickup | Low |
| 10 | Rate parity | (a) One price for every channel, by construction; upward overrides on Moto Mangos orders refused | Medium |
| 11 | The per-shop booking link | Ask Mark what is meant; lean (a) a stable Moto Mangos shop link, fee applies | Low |
| 12 | Featured placement and ranking hooks | (a) Hooks only: signals from orders, a marketplace-owned boost table; billing later | High |
| 13 | Referral: Thailand only, per-country switch | (a) A switch on `markets`, passed down; attribution kept on the fee record, not on the order | Medium |
| 14 | Country, currency and market per shop | (a) A shop is listed only where its currency equals its market's | High |
| 15 | What moves from the old marketplace tables, what is retired | (b) Count first; move only what has rows; keep catalog, profiles, stations, reviews (re-keyed); drop the rest after the switch | Medium |
| 16 **[added]** | The 3M accept test "search results identical before and after" | (a) Identical except a written list of intended differences | High |
| 17 **[added]** | The checkout hold and paying the fee at booking | (a) Hold for the shop's hold minutes; PromptPay QR within the hold; late money refunded | Medium |
| 18 **[added]** | "One unpaid booking for overlapping dates" across shops | (b) Checked before the booking, re-checked after, with no new lock | Low |
| 19 **[added]** | The customer record each shop gets | (a) Upsert by account; contact fields refreshed, the shop's own fields kept; email optional | Medium |
| 20 **[added]** | How `marketplace_events` reach the marketplace | (a) An outbox drained by an app-side job; no `pg_net` | High |
| 21 **[added]** | The contract's types are behind the decisions | (a) Correct `lib/data/types.ts` and INTEGRATION in 3M's first PR | High |

---

## 1. Request-to-book: statuses, accept, decline, timeouts

**Question.** What values does `orders.request_status` take, which transitions are allowed, how does the shop accept or decline, and when does a request run out?

**Already settled.**
- `orders.status` has `requested` for "a Moto Mangos request waiting for the shop (3M; no stock held)" (phase-3-plan §2.3). `request_status` is free text "until 3M" (§3.2 as built; `20261124000100_platform_orders.sql:342`); PR 79 keeps it without a list (its §14 row "Owner's answers, 25 Nov 2026").
- The SPEC's data model already names the values: **`request_status (pending, accepted, declined, expired)`** (SPEC › Data model, orders row).
- Request mode: `status = requested`, no unit held, counted against `request_units` under the listing row; **accepting runs `reserve_core`** (§7.2).
- PR 79's `create_order` refuses `mode = request` for now: "A request-mode booking holds no unit until the shop accepts it (3M)" (`20261125000100_platform_order_core.sql`, around line 896). Its `reserve_existing` path accepts only a `draft` (or a run-out `new`) order (`not_draft`), so accepting a `requested` order needs that check widened.
- Reply window: "at most 4 hours, counted in opening hours" (SPEC › Online booking; INTEGRATION §4.4; marketplace decisions: a request made while closed starts counting at the next opening). The marketplace SPEC still says "default 2 hours" (booking modes table). MAPPING maps the legacy `request_window_min` to `locations.request_reply_minutes` (MAPPING §1), **a column no migration has created yet** (git grep).
- Delivery "always needs vendor acceptance, even for Instant models" (marketplace SPEC, booking modes; INTEGRATION §6.6). Delivery is Phase 8 for the platform.
- Payments: a request saves the card and charges nothing until the shop accepts; PromptPay pays by a link sent on accept (payments-design §4.4).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **`request_status`: `pending` → `accepted` / `declined` / `expired`, set only by functions.** `create_booking` (mode `request`) writes `status = requested`, `request_status = pending` and **`request_expires_at`, worked out once at creation** in the location's opening hours (closures and hours as they are then). `accept_request(order)`: under the §4.2 order, runs `reserve_core` on the existing order (as for a draft); ok → `status = booked`, `request_status = accepted`, event `booking.accepted`; no unit → answers `unavailable`, nothing written, and the shop is offered Decline. `decline_request(order, reason)`: `status = canceled`, `cancelled_by = shop`, `request_status = declined`. A job expires pending requests past `request_expires_at`: `canceled`, `cancelled_by = system`, `cancel_reason = expired`, `request_status = expired` | One new column and two functions; a stored deadline is simple to test and to show as a countdown. A closure added after the request does not move its deadline *(inference: acceptable, since the window is at most 4 hours)*. Needs `request_reply_minutes` on `locations` (MAPPING) |
| (b) | Same statuses, **deadline worked out on every read** from the hours as they are now | Always current, but the countdown can jump, the expiry job needs the same opening-hours maths in SQL, and two readers can disagree |
| (c) | **No platform statuses for requests:** the marketplace keeps the request until the shop accepts in a marketplace screen, then calls `create_booking` instant | No new platform work, but the shop then works in two apps, the request cap (point 2) can't be counted under the listing row, and the SPEC's "one platform" (Product scope item 1) is broken |

**Recommendation: (a).** It matches the values the SPEC already names and the plan's "accepting runs `reserve_core`". One rule to add: **the deadline is never after the pickup time** (a request for a pickup in 90 minutes runs out at pickup at the latest) *(inference: the docs do not say)*. Refusing requests whose lead time is shorter than the reply window is not recommended: it would hide same-day requests, and the earlier deadline already covers them.

**Neon.** The expiry job is pg_cron on both stacks (neon-move-plan decision; stage 7 calls `cron.database_name`). No change to the answer.

**Prove before deciding.** The opening-hours deadline as a pure `@mango/core` function with a DST location and a request made while closed; `accept_request` against an instant booking of the last unit (one wins, the other answers cleanly, 0 deadlocks); accept after expiry refused; the expiry job and an accept at the same instant (one wins).

## 2. Do pending requests count against the cap and the dates?

**Question.** A `requested` order holds no unit. Does it count against `request_units`, and against the dates a second customer can request?

**Already settled.** Requests are "counted against `request_units` under the listing row" (§7.2). But `platform_private.marketplace_peaks()` counts **reservations** with `channel = 'marketplace'` only (`20261116000200_platform_availability.sql:1460` onwards), and a `requested` order has none, so today a pending request would count against nothing. "Dates already full from bookings can't be requested" (INTEGRATION §4.4). INTEGRATION §4.3 already foresees "later also pending delivery requests on Instant units".

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **A reservation in a new state `requested`, with no block**, written by `create_booking` under the listing row. `marketplace_peaks()` counts it for the cap; `availability()`'s free count ignores it (no block). Accept turns it into a held/reserved reservation with a block; decline or expiry sets it `cancelled` / `expired` | The cap holds under the listing row, as for instant bookings; the shop's direct sales are never blocked by a request. Needs the reservation state list widened and every reader of reservations checked for the new state *(inference: `free_units`, `shortage_demand` and the hold sweep must skip it)* |
| (b) | **A real hold block for the reply window** | Accept can never fail for want of a unit. But a request blocks the shop's own walk-ins and phone bookings for up to 4 hours, which a request unit was meant not to do |
| (c) | **Count nothing**; the first accept wins | Simplest. A shop with 1 request unit can get 10 requests for the same day and must decline 9; the response-rate signal (point 12) punishes it for that |

**Recommendation: (a).** **Lock order:** writing a `requested` reservation is a class 3.8 row after the listing row, as §7.2 already orders it; no new lock class.

**Neon.** No change.

**Prove before deciding.** Two requests for the last request unit at once: one `cap_reached`; a request does not lower `availability()`'s free count; the hold sweep and `free_units` ignore `requested` rows.

## 3. Who may cancel a Moto Mangos order, and when

**Question.** Who may cancel a `marketplace` order (customer, shop member, system), up to when, and through which function?

**Already settled.**
- **PR 79 (owner, 25 Nov 2026):** the server may cancel any order; a shop member may cancel any order of their own shop **except a Moto Mangos one, "whose cancellation rules come at 3M"**; `cancel_order` answers `not_allowed` (`20261125000100_platform_order_core.sql`, around line 2565; test in `order-core.test.ts`).
- PR 79's lists: `cancelled_by` customer / shop / system; `cancel_reason` expired / customer_request / shop_request / no_show / other.
- The marketplace SPEC already lets the vendor cancel: "Vendor cancels or declines after confirming: Full refund; counts against vendor ranking" (Payments and cancellation), and the vendor bookings screen has "cancel" (Vendor dashboard). The cancellation rate counts "the share the shop cancelled" (INTEGRATION §3.10).
- The customer cancels in My bookings (marketplace SPEC); the adapter needs `cancelBooking(id, by, reason)` (INTEGRATION §3.13); `cancel_booking` is in `marketplace_api` (§7.1).
- One fixed platform-wide rule for Moto Mangos; a shop's own cancellation-fee setting never applies (payments-design decision 14).
- A cancel needs "nothing out" (§2.3): after pickup, the order is returned, not canceled.

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Customer and system only.** A shop that can't honour a booking asks Moto Mangos support | Protects renters and the ranking signal; but the SPEC already lets the vendor cancel, and support becomes the bottleneck for every breakdown |
| (b) | **Customer through `cancel_booking` until pickup; a shop member (cancel role) through `cancel_order` until pickup, with a reason from a list, always recorded `cancelled_by = shop`; no-show marked by the shop only after the pickup time; system for an unpaid fee, an expired hold or request.** A customer who phones the shop to cancel is sent to My bookings, or the shop's cancel is still counted as the shop's | Matches the SPEC; one rule per actor; the shop can't turn its own cancel into the customer's (which would keep the fee) by picking a reason. Shops may complain that a customer's phone cancel counts against them *(inference)* |
| (c) | As (b), but a shop may record **"at the customer's request"**, which the customer confirms in Moto Mangos within a time limit; unconfirmed, it counts as the shop's | Fair to shops; one more flow, a message and a timer |

**Recommendation: (b)**, with (c) as a later addition if shops ask. Also: **no-show only from the pickup time plus the shop's late-return grace** (decision 21's 60 minutes) *(inference: the docs give no no-show grace)*; a shop cancel and a decline both send `booking.cancelled` / `.declined` with `by = shop`.

**Neon.** No change.

**Prove before deciding.** A member's cancel of a Moto Mangos order succeeds only with a listed reason and records `shop`; a no-show before the pickup time is refused; `cancel_booking` by another account's id refused; the customer's cancel and the shop's pick-up at the same instant (one wins, `try_again` or clean).

## 4. The fee on each kind of cancellation

**Question.** For each way a Moto Mangos order ends early, what happens to the fee, and what must the order record so the marketplace can tell?

**Already settled.** `apps/marketplace/lib/fee-lifecycle.ts` (`feeWhenEnded`) and payments-design §4.4–4.5:

| Event | Card, not yet charged | Already paid (PromptPay at booking; any booking inside the 72-hour cut-off) |
| --- | --- | --- |
| Customer cancels before the cut-off | Charge cancelled, nothing to refund | Full refund |
| Customer cancels after the cut-off; no-show | (already charged) | Kept |
| Shop declines, request expires, shop cancels | Nothing charged | Full refund |
| Fee unpaid at the deadline (2 days before pickup) | Booking cancelled (`cancelled_unpaid`) | — |

"72 hours" is **3 calendar days at the pickup's clock time in the shop's time zone** (payments-design decision 3; `fee-lifecycle.ts` `CHARGE_LEAD_DAYS`). PromptPay pays at booking (payments-design decision 4; the marketplace SPEC's "link sent 3 days before" is a listed doc edit, payments-design §12). The order's `booking` charge, with its negative `marketplace_fee` line, is voided on a cancellation (decision 38).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Keep `feeWhenEnded` as it is; the platform reports, the marketplace decides.** The order records `cancelled_by` and `cancel_reason`; `booking.cancelled` carries both and the cancel time. Add two reasons to PR 79's list: **`fee_unpaid`** (system, the `cancelled_unpaid` case) and **`declined`** (shop, a request) *(inference: `shop_request` reads as "the shop asked", and a decline is not a cancel of a confirmed booking)* | Uses tested code; one place decides money. The 72-hour test is the cancel time against the pickup, so the event must carry the platform's cancel time, not the time the marketplace received it |
| (b) | The platform works out the fee outcome and sends it | Moves a marketplace rule into the platform (SPEC Product scope item 4: fee rules stay marketplace-only) |

**Recommendation: (a).** One nuance to settle: on a **no-show** the order is `canceled` with `no_show = true` (§3.2), and its booking charge with the negative line is voided; the fee is kept on the marketplace side. Nothing is owed to the shop, which is right for a no-show *(inference)*.

**Neon.** No change.

**Prove before deciding.** Every row of the table above end to end through the events (payments-design stage 10 accept tests already list these against `fee-lifecycle.ts`); a cancel one minute either side of the cut-off in a DST time zone.

## 5. How the fee amount reaches the order's negative line

**Question.** Decision 38 has `create_booking` write a negative `marketplace_fee` line "from the fee the marketplace reports". INTEGRATION §3.12 says "**the fee is not passed in**: `createBooking` returns the fee base it used, and the marketplace works the fee out". How do both hold?

**Already settled.** The fee rule: 10% of the base; the base is the rental after discounts plus paid extras and delivery, never the deposit, for the whole booked length (a long rental's `booking` and `period` charges made at booking); with VAT when prices include it, before VAT when added on top; half up to a whole unit; at least the currency's minimum (฿50); never more than the base; fixed at booking (§7.3, decisions 23 and 32). `fees.ts` needs the Phase 8 changes listed in §7.3. In PR 79 the charges are worked out in TypeScript by the shared booking package (`@mango/booking`, decision 15) on the server, then passed into `create_order`, which checks them "by addition and comparison only" (PR 79 §14). The marketplace server runs that same package.

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Two calls.** `create_booking` writes the order without the line and returns the base; the marketplace then calls `set_marketplace_fee(order, fee)` to add the line | Follows §3.12 literally. But a charge is "stored once, never edited except void" (§3.2), so the line would need a second charge or an edit; and a crash between the two calls leaves an order that never settles |
| (b) | **The platform works the fee out in SQL** from the base and a market rule it reads | One call. But the fee rule and the market minimum are marketplace-owned (INTEGRATION §1), and a second copy of the rule in SQL is what the SPEC retires at 3M for pricing (Review decisions › Pricing) |
| (c) | **One call; the fee worked out on the server by the shared package from the same quote, never from the browser.** `bookOnline()` for `channel = marketplace` builds the booking charge, works out the base, calls `bookingFee()` (moved from `apps/marketplace/lib/fees.ts` into `@mango/core` or `@mango/booking`) with the market's rule, adds the negative line, and passes the charge and the rule (`rate_bp`, `minimum`, `currency`) to `create_booking`. The database checks, by addition and comparison only, that the line equals the rule applied to the base. `create_booking` returns base and fee | One transaction, one rule in one place, and the check stops a wrong fee reaching the shop's order. It reads §3.12's "not passed in" as "not from the browser and not chosen by the caller", which **Mark must confirm** |

**Recommendation: (c)**, and correct INTEGRATION §3.12's wording to match if Mark agrees. *(Inference: §3.12 was written when the marketplace called the platform across an API; with one database and one shared server package the intent, "the platform's base, the marketplace's rule, nothing from the browser", is kept.)*

**Neon.** No change: the package runs in the marketplace's Netlify functions and calls through the service path (neon-move-plan §8a point 7).

**Prove before deciding.** The fee as a pure function: 100% coupon (base 0, fee 0), base under ฿500 (minimum ฿50, but never above the base), a 90-day rental (all booked months in), VAT inclusive and on top, a JPY shop (exponent 0); `create_booking` refuses a line that does not match the rule; the booking charge total equals what the shop collects.

## 6. The fee record and the order in one transaction [added]

**Question.** The fee record (`public.marketplace_fees`, marketplace-owned, keyed by order id, §7.3; payments-design §4.3) and the order are written by different owners. Can one exist without the other?

**Already settled.** One database (SPEC › Repository and database). The fee record is "fixed at booking". Nothing says which call writes it.

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **`create_booking` inserts the fee record in the same transaction**, from the values of point 5, as its last write before the counter (§4.2 class 3.9) | Never one without the other. A platform-run function writes a marketplace-owned table: an ownership exception to record in INTEGRATION §1 |
| (b) | The marketplace writes the fee record after `create_booking` answers, idempotent by order id; a repair job finds orders with no fee record | Ownership stays clean; a gap of seconds to hours in which the shop sees a booking whose fee does not exist; the repair job must also handle a fee charged with no order |
| (c) | The fee record is written first (status `pending_order`), then the order | A fee with no order if the booking is refused, to clean up |

**Recommendation: (a).** The fee record is part of what a Moto Mangos booking is. **Lock order:** an insert of a new row, after the charges and lines, before the counter; no new lock class.

**Neon.** No change.

**Prove before deciding.** A refused booking writes neither; an idempotent repeat of `create_booking` answers the same fee record; a grant test that only the `create_booking` owner can insert.

## 7. How Moto Mangos orders show in the shop's order list

**Question.** What does a shop see and do with a Moto Mangos order in its order list and on the order page?

**Already settled.** The channel is a read-only badge on the order page (§9.1, stage 9); the order list filters by channel (§8 stage 7). Fee states "are owned by the marketplace … and reported to Mango Works" (INTEGRATION §5). The SPEC's data model lists `orders.marketplace_fee_status` (SPEC › Data model), which stage 2a did not build. The shop sees "confirmed, fee due [date]" until the charge and "paid, collect ฿X at pickup" after (payments-design §4.4). Byklo's shop view is "a list of new requests to accept or decline" (SPEC › Competitor reference). The vendor notice lists what to collect, extras included (marketplace SPEC). Contacts are shown to the customer "only after a booking is confirmed" (INTEGRATION §3.4).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Badge only**; requests and fee status are seen in Moto Mangos | Nothing to build, but the shop works in two places and can't see whether to collect the full amount |
| (b) | **Badge; a Requests tab on the Today board with a countdown and Accept / Decline; the fee status shown from `orders.marketplace_fee_status`, which the marketplace sets through a `marketplace_api` function on every fee change; "collect" = the booking charge after the negative line** | One place for the shop; follows the SPEC's column and INTEGRATION §5's "reported to Mango Works". One more column and one setter, and the two can drift if a fee change is not reported *(the marketplace's reconciliation, payments-design §5.6, covers it)* |
| (c) | As (b), but the platform **reads** `public.marketplace_fees` through a security-definer read instead of a copied column | No copy to drift; the platform's reads then depend on a marketplace table's shape |

**Recommendation: (b).** Also: the customer's phone and email are visible to the shop on a pending request *(inference: the shop needs them to answer questions before accepting; the marketplace SPEC's vendor booking detail shows "customer name, contact")*. Search by booking code (the 6-character `orders.code`) is already in §8 stage 7.

**Neon.** No change.

**Prove before deciding.** The fee status setter refuses a non-marketplace order and an unknown value; a staff member sees the Requests tab, a mechanic does not (§3.9).

## 8. The status the renter sees (`get_booking`) [added]

**Question.** INTEGRATION §5's eleven statuses must be worked out from the platform's order. Where, and from what?

**Already settled.** "Mango Works maps its own order states to these statuses through `request_status`, `cancelled_by` and `no_show`" (INTEGRATION §5). The platform derives reserved, picked up, returned from reservations (`order_state()`, §2.3). `paid` and `cancelled_unpaid` are fee states (marketplace-owned).

**Options.** (a) **One SQL function in `marketplace_api`** mapping (status, request_status, cancelled_by, cancel_reason, no_show, `order_state()`, the fee status of point 7) to the eleven values, used by `get_booking` and `list_customer_bookings`. (b) The mapping in TypeScript in the adapter, from raw fields. (c) Store the marketplace status on the order.

**Recommendation: (a)**: one place, testable against the table; (c) would be a second stored status beside the intent (S3).

**Neon.** No change.

**Prove before deciding.** One test per arrow of INTEGRATION §5.

## 9. Shop edits to a Moto Mangos order after booking [added]

**Question.** Phase 3 gives shops `save_order`, `change_rental_dates`, `add_to_order`, `extend_rental`, `swap_rental_unit`, price overrides. Which apply to a Moto Mangos order, and what happens to the fee?

**Already settled.** The fee is fixed at booking; "charges created after booking are outside the fee"; extensions and further months arranged with the shop carry no fee (§7.3). Renewals and extensions are handled at the shop, off-platform (marketplace SPEC). PR 79 blocks only `cancel_order` for members on Moto Mangos orders.

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Allowed after pickup (extend, swap, add, return early), fee untouched. Before pickup, refused for date changes and upward price overrides** on a Moto Mangos order; the customer cancels and books again for other dates | The fee stays honest (a fee on 10 days for a booking shortened to 2 would exceed what the customer agreed); parity holds at the counter (point 10) |
| (b) | Everything allowed, fee untouched | Simple; a shop can shorten a booking and the fee stays on the longer one, or raise the price the renter saw |
| (c) | Date changes allowed, the fee re-worked | Contradicts "fixed at booking" |

**Recommendation: (a)**, low confidence: it needs Mark's view on whether a renter may ask the shop to move dates.

**Neon.** No change.

**Prove before deciding.** Each order function on a Moto Mangos order before and after pickup, by role; the fee record unchanged after every allowed edit.

## 10. Rate parity

**Question.** Must the Moto Mangos price equal the shop's own price, and how is "never charge app customers more at the counter" enforced?

**Already settled.** Vendor term 2: "Price parity: never charge app customers more at the counter than the app shows" (marketplace SPEC › Vendor terms). The renter pays the base in total: the fee online and base − fee at the shop (payments-design §4.7's ฿2,880 = ฿288 + ฿2,592), so **the shop receives less on a Moto Mangos order than on a direct one** *(inference from the worked example)*. `quote()` is the only pricer (SPEC Review decisions › Pricing); there is no channel-specific price list (`product_pricing`, price lists). Coupons can be limited to channels, including `booking_page` only (`20261118000100_platform_coupons.sql:169`).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **One price for every channel, by construction.** `get_quote` is `quote()` with the shop's own price list; the counter's "collect" is the platform's number; **upward price overrides on a Moto Mangos order refused** (point 9); channel-limited coupons allowed both ways | Parity at the counter is enforced, not trusted. Shops may push renters to book direct for a booking-page-only coupon, which the rule allows *(Mark's call)* |
| (b) | A **Moto Mangos price list** per shop (a mark-up to cover the fee) | Shops recover the fee; Moto Mangos looks dearer than the shop's own page, which hurts conversion and the brand |
| (c) | (a), plus **no coupon may be limited to `booking_page` alone** for a listed shop (Moto Mangos never dearer than direct) | Strongest parity; limits the shop's own marketing |

**Recommendation: (a).** Strict "never dearer than direct" (c) is a commercial choice for Mark.

**Neon.** No change.

**Prove before deciding.** `get_quote` and the booking page's quote for the same product, dates and extras give the same total; a staff override upward on a Moto Mangos order refused, downward allowed with a reason.

## 11. The per-shop booking link

**Question.** What is "the per-shop booking link"?

**Already settled.** **I found no definition in the docs or code** (git grep for "booking link", "shop link", "share link" and similar). Related facts: the platform's own hosted booking page per shop, commission-free, is Phase 8 (SPEC › Online booking; Product scope item 4 "direct bookings stay commission-free"); Moto Mangos shop pages are `/shops/[slug]` today and become `/bangkok/…`-style paths with markets (SPEC › Built for any country: "one domain with paths"); slugs must stay stable (INTEGRATION §2; MAPPING: a tenant keeps the shop's slug).

**Options** *(each is my reading of what the term could mean)*.

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **A stable Moto Mangos link for each shop** (`/<market>/shops/<slug>`, with redirects from today's `/shops/<slug>`) that the shop can share or print as a QR; bookings through it are ordinary Moto Mangos bookings and pay the fee | Little to build; links survive the market paths |
| (b) | The same link, but **bookings arriving through it pay no fee** (the shop brought the renter) | Rewards shops for bringing renters; needs attribution that can't be gamed (a cookie, the `ref` parameter) and a fee rule exception |
| (c) | The link **sends the renter to the shop's own booking page** (Phase 8) | Commission-free, but that is the booking page's own link, not Moto Mangos'; not available until Phase 8 |

**Recommendation: ask Mark which is meant.** If the answer is (a), it is small and belongs in 3M; (b) changes the fee rule and needs a decision like decision 23.

**Neon.** No change.

**Prove before deciding.** Nothing until the meaning is settled; for (a), old shop paths redirect to the market path.

## 12. Featured placement and ranking hooks

**Question.** What must 3M build so the ranking and paid placement of SPEC › "Moto Mangos ranking and vendor billing" can be added later?

**Already settled.** Ranking is marketplace-owned (INTEGRATION §1). Three layers: quality score (free), Featured placement (paid, labelled, limited per area, minimum quality score, start and end dates, paid in advance), connected-shop bonus; "designed now, built once Bangkok has several competing shops" (SPEC). `listFeaturedShops` and `getShopSignals` are in `marketplace_api` (§7.1); signals come "from orders with `channel = marketplace`" and only the response and cancellation rates are the platform's (INTEGRATION §3.10, decision 2 of §6). `boost_level` moves to a marketplace-owned table keyed by tenant id (MAPPING §1).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Hooks only.** `get_shop_signals` returns response rate, cancellation rate and their counts (and median reply minutes, cheap once `request_expires_at` and the accept time are stored); a marketplace-owned **`shop_boosts`** (tenant id, area or market, start, end, label) replaces `boost_level`, read by `list_featured_shops` and the existing weights; billing, the quality threshold and the reason log come with vendor billing | Small; the signals are right from day one, so a history exists when ranking is built |
| (b) | Build the three layers and vendor billing in 3M | Large; Bangkok has one shop (BSR) at launch |
| (c) | No boost at all until billing exists | Loses today's admin "featured" control on the home page |

**Recommendation: (a).** The connected-shop bonus has no meaning after 3M, since every listed shop is on the platform *(inference)*; drop it from the design or redefine it.

**Neon.** No change.

**Prove before deciding.** Signals from seeded orders (accepted, declined, expired, shop-cancelled, customer-cancelled) equal INTEGRATION §3.10's definitions; a shop with no requests answers `null`, not 0.

## 13. Referral: Thailand only, per-country switch

**Question.** Where does the referral switch live, and where is a booking's referral recorded?

**Already settled.** On in Thailand at 50% of the fee, off elsewhere until local rules are checked; on or off per market; off means no partner QR codes and no new earnings, while earnings already made are paid; settings pass down from country to city (SPEC › Built for any country; marketplace decisions). The program itself is marketplace Phase 5b and not built (`docs/marketplace/BUILD_PLAN.md`; PROGRESS notes `referralCode` passes through with no rules). `createBooking` passes `referralCode`, which "Mango Works only stores" (INTEGRATION §3.12). Earnings are reversed when the fee is refunded (payments-design §4.5).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **`markets.referrals_enabled` (nullable, inherited from the parent)** in the marketplace-owned `markets` table created at 3M; **the referral code and partner kept on the fee record**, and `referralCode` dropped from `create_booking` | Referral data stays with the money it shares; the platform holds nothing it never reads. Changes the contract (INTEGRATION §3.12), so Mark must agree |
| (b) | The switch on `markets`; the code stored on the order as INTEGRATION says | Follows the contract; a marketplace field on a platform table the platform never uses |
| (c) | Leave referrals out of 3M entirely | Nothing to build; but `markets` gets a column later and bookings made meanwhile lose attribution |

**Recommendation: (a).**

**Neon.** No change.

**Prove before deciding.** The pass-down rule as a pure function (Thailand on, Bangkok unset → on; Vietnam off); a refunded fee reverses its earning (Phase 5b).

## 14. Country, currency and market per shop

**Question.** How do a shop's country, currency and time zone meet the market it is listed in?

**Already settled.** `tenants.country`, `currency`, `timezone` (`20261109000100_platform_tenants.sql`); each location has its own time zone (`20261110000300_platform_locations.sql`); `locations.market_id` is nullable "until the marketplace's `markets` table arrives at 3M; then set from the address" (MAPPING §1). A market has a currency, time zone, languages, fee minimum and area; a shop belongs to the market its address falls in (SPEC › Built for any country). Money moves to minor units at 3M (×10^exponent, MAPPING rules). The fee minimum is per currency (decision 23). Stripe does not serve Vietnamese businesses (SPEC › Built for any country); the fee is charged on Mango Works' own Stripe account (payments-design §4.2).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **A shop is listed only where its currency equals its market's**; checked when the listing is switched on and when `market_id` is set; search returns one market's shops in that currency; the location's time zone runs the booking rules, the market's the display | No conversion anywhere; a clear refusal for the rare mismatch |
| (b) | Allow a mismatch and convert for display | Exchange rates, and a fee in a currency the renter did not see |
| (c) | A currency per listing | Contradicts one currency per shop (`currency_locked()`) |

**Recommendation: (a).** Before a non-Thai market goes live, check that Mango Works' Stripe account can charge the fee in that currency *(inference: needed for Vietnam; payments-design §1.4 discusses Omise)*.

**Neon.** No change. (`markets` is a new marketplace table created after the move, so it goes into one schema history only: neon-move-plan §8a point 11.)

**Prove before deciding.** A THB shop in a JPY market cannot be listed; minor-unit search prices equal today's whole-baht prices ×100 on the seed.

## 15. What moves from the old marketplace tables, and what is retired

**Question.** At 3M, which legacy `public` tables keep their data, which are mapped into the platform, and which are dropped?

**Already settled.** MAPPING maps every legacy column (shops → tenants + default location, keeping UUID and slug; `bike_models` → products keeping the UUID as `listingId`; downtime → `unit_blocks`; prices → price structures; bookings → orders at 3M). `bike_catalog` stays the one catalog (MAPPING §3). "The legacy Bike-Booking shop tables are dropped after the switch" (SPEC Product scope item 5); the SPEC says Bike-Booking "has no shops or bookings yet" (Repository and database › Why). The temporary adapter reads `shops`, `shop_hours`, `shop_closures`, `shop_policies`, `bike_catalog`, `bike_models`, `bike_model_policies`, `bike_model_downtime`, `price_days`, `shop_extras`, `reviews`, `ranking_settings`, `stations` and the SQL functions `search_offers`, `model_offer`, `longest_walkin`, `rental_days`, `rental_price`, `shop_stats`, `shop_coordinates`, `station_list` (INTEGRATION §7). `reviews` references `public.bookings` and `public.shops` (`20261024000600_bookings.sql:81-84`). Vendor screens are hidden, not deleted (`apps/marketplace/lib/hidden-areas.ts`).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **Migrate everything per MAPPING**, then drop | Complete; much SQL for tables that may hold only test rows |
| (b) | **Count rows on live first; migrate only tables with real rows; keep `bike_catalog`, `profiles`, `stations`, `ranking_settings` (→ `shop_boosts`, point 12) and `reviews` (re-keyed to `tenants.id` and `orders.id`, which keep the same UUIDs per MAPPING); drop the rest** (shops and children, `bike_models` and children, `price_days`, `promotions`, `promotion_models`, `delivery_zones`, `bookings`, `booking_events`, `shop_members`, `shop_invites`, the legacy SQL functions) **with the vendor screens and `current-db.ts`, in a separate PR after the adapter switch is live** | Work in proportion to the data; the drop is reversible until it lands. Depends on the count |
| (c) | Keep the legacy tables read-only for a few months, then drop | Safest; leaves two shapes of shop data, and the hidden vendor code, in the repo meanwhile |

**Recommendation: (b).** The `public.memberships`, `vehicle_types` and `storage` photo buckets need the same check *(inference: not in INTEGRATION §7's list)*.

**Neon.** **Changes the order.** The legacy tables are still read until the adapter switch, so they go into the Neon baseline and are dropped by a 3M migration on Neon. The `shop-photos` and `model-photos` buckets move to R2 in the Neon move (neon-move-plan stage 6); 3M only stops using them. `public.shop_numbers_readable()` is re-pointed in the baseline (neon-move-plan §8a point 6).

**Prove before deciding.** Row counts of every legacy table on live (read-only query); reviews re-keyed keep their shop and booking; search on the seed reads nothing from a legacy table after the switch (a grant revoke test).

## 16. The 3M accept test "search results identical before and after" [added]

**Question.** SPEC Review decisions: "Accept: search results identical before and after on a seeded dataset." Several rules change on purpose at 3M. What does "identical" mean?

**Already settled.** Intended changes: availability by assigned units, not a pool (§7.1 `search_offers` "assigned-unit availability"; INTEGRATION §4.3 describes the pool); **over 30 days priced month to month plus a long-stay daily rate** (SPEC change request 48) instead of the 30-day price ÷ 30 (INTEGRATION §4.2); **the stricter of the listing's lead time and the shop's notice** instead of the model's replacing the shop's (MAPPING §4 `notice_h`); minor units and a currency.

**Options.** (a) **Identical except a written list of intended differences**, each with a seeded example that shows the new answer. (b) Identical, with the seed avoiding every changed rule. (c) Drop the test.

**Recommendation: (a)**: (b) would hide exactly the changes a reviewer should see.

**Neon.** No change.

**Prove before deciding.** The list itself, agreed before the 3M plan.

## 17. The checkout hold and paying the fee at booking [added]

**Question.** An instant Moto Mangos booking is an online order. How long is the vehicle held while the renter saves a card or pays by PromptPay, and what if the money arrives late?

**Already settled.** An online order runs out to `canceled`, reason `expired` (decision 5); `tenants.hold_minutes` sets the hold (§2.3). "A PromptPay payment at booking with a hold on the vehicle: the QR is shown for the hold's remaining time. If the money arrives after the hold ran out and the vehicle is gone, the fee is refunded in full automatically" (payments-design §4.4). Card bookings save the card with consent (SPEC "When the renter pays").

**Options.** (a) **`create_booking` with `action = hold`; `confirm_order` when the card is saved or the PromptPay payment confirmed; the shop's `hold_minutes`; a late payment refunded.** (b) Book first (reserved), cancel if payment fails. (c) A fixed Moto Mangos hold time, not the shop's.

**Recommendation: (a)**, possibly with (c)'s fixed hold *(inference: a renter on Moto Mangos should see the same hold at every shop; Mark's call)*.

**Neon.** No change; the confirm runs through the service path.

**Prove before deciding.** Hold, confirm after expiry (`hold_expired`, settled and kept, PR 79); a late PromptPay webhook leads to a refund, not a booking.

## 18. "One unpaid booking for overlapping dates" across shops [added]

**Question.** The marketplace SPEC's abuse guard: "A customer can hold only one unpaid booking for overlapping dates." Bookings at two shops share no lock. Where is it enforced?

**Already settled.** The rule (marketplace SPEC › Payments, abuse guard). The lock order has no customer-wide or account-wide lock; a new lock order "is a deadlock waiting to happen: ask first" (root `CLAUDE.md`).

**Options.**

| | Option | Cost and risk |
| --- | --- | --- |
| (a) | **An advisory lock on the account id before class 1** | Exact; a new lock class at the top of the global order, which needs Mark's approval and a review of every booking path |
| (b) | **Checked before `create_booking` and re-checked after it**; a second booking found after is cancelled at once with nothing charged | No lock change; a race leaves a booking for seconds |
| (c) | Not enforced in 3M | The fee is charged before pickup anyway; abuse costs shops a held unit |

**Recommendation: (b)**, low confidence; (a) only if Mark wants it exact.

**Neon.** No change.

**Prove before deciding.** Two bookings for overlapping dates at two shops at once: at most one stays.

## 19. The customer record each shop gets [added]

**Question.** `create_booking` upserts a customer "by `(tenant, marketplace_account_id)`" (§7.2). Which fields does a later booking overwrite, and what if the account has no email?

**Already settled.** `customers.marketplace_account_id`, unique per tenant (`20261124000100_platform_orders.sql:210-222`); contacts kept out of the audit (§3.1). PR 79's `create_order` takes an existing customer id and "does not make one"; making a customer inside the call (class 3.6) "is left to the stage that needs it" (PR 79 §14). The booking sends name, email, phone, nationality, LINE id (INTEGRATION §3.12). A LINE-only account may have no email (neon-move-plan §8a point 4).

**Options.** (a) **Upsert: name, phone, email, LINE id, nationality, language refreshed from the latest booking; the shop's notes and archive flag kept; email optional**, asked at checkout for the receipt. (b) Insert once, never overwrite. (c) Always overwrite everything.

**Recommendation: (a).** The privacy notice already says booking details go to the shop (apps/marketplace CLAUDE.md).

**Neon.** **Changes the key.** `marketplace_account_id` points at the user of the users table chosen in neon-move-plan §8a point 4 (recommended `public.users`), not `auth.users`; as a plain id (no foreign key), as stage 2a did for "who" columns, it needs no change *(inference)*.

**Prove before deciding.** Two bookings at one shop by one account give one customer; a booking at a second shop gives a second; an upsert under a race (class 3.6, two bookings at once) gives one row.

## 20. How `marketplace_events` reach the marketplace [added]

**Question.** §7.1 names a `marketplace_events` outbox; INTEGRATION §3.13 says a signed webhook. Who sends it?

**Already settled.** Phase 3's own outbox only queues; sending is app-side (§3.6). The neon-move-plan's "do not start using" list includes `pg_net` (§6.3 Addition B). Both apps share one database.

**Options.** (a) **The outbox is drained by an app-side job** (a Netlify scheduled function or the marketplace's cron route) that reads rows in order, acts, and marks them done; no webhook between the two apps. (b) A signed HTTP webhook from the platform app. (c) Database triggers calling the marketplace with `pg_net`.

**Recommendation: (a)**: on one database the "webhook" is just a table read; (c) is ruled out by the Neon list.

**Neon.** Supports (a); rules out (c).

**Prove before deciding.** An event processed twice acts once; events for one order are handled in order.

## 21. The contract's types are behind the decisions [added]

**Question.** `apps/marketplace/lib/data/types.ts` is the "source of truth for the types" (INTEGRATION header), but it predates decisions 23, 32 and the fee base.

**Already settled.** `NewBooking.payment` still carries `fee` and `currency: "THB"` (`types.ts:234`); `Booking` has `fee` and `dueAtShop` and no `feeBase` (`types.ts:254`); INTEGRATION §3.12 says the fee is not passed in and the output has `feeBase`. INTEGRATION §2 still states whole baht and Asia/Bangkok, "until that adapter switch". `fees.ts` changes are listed for Phase 8 (§7.3). The marketplace CLAUDE.md still describes the fee as "10% of the rental after promotions … via Stripe Connect as an application fee", which payments-design §4.2 replaced.

**Options.** (a) **Correct the types, INTEGRATION §2–§5 and the marketplace CLAUDE.md in 3M's first PR**, before any code calls `marketplace_api`. (b) Correct each as code touches it.

**Recommendation: (a)**: the types are the contract.

**Neon.** No change.

**Prove before deciding.** Typecheck of the adapter against the corrected types.
