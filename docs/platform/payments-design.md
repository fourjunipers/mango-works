# Payments design: Phase 7 and the Moto Mangos fee

**Draft 1, 19 Nov 2026.** Design only: no code, no migration, nothing applied anywhere. Written from `main` at `d458717` and `docs/phase-3-plan.md` draft 2 on `platform/phase-3-plan-draft` (`f996c4e`).

Read for this: `docs/platform/SPEC.md`, `docs/marketplace/SPEC.md`, `docs/INTEGRATION.md` (the copies on the Phase 3 plan branch, which carry the corrected fee wording), `docs/phase-3-plan.md` §6 and §7 and decisions 1 to 32, `docs/PROGRESS.md`, `apps/marketplace/lib/fees.ts` and `fee-lifecycle.ts`.

**How provider facts are marked.** Every statement about Stripe, PromptPay or Omise was checked against the provider's own pages on 19 Nov 2026 and carries a source key such as [S22]; the keys are listed in §13. **Unclear** means the provider's pages do not say, or contradict each other; those points are collected in §11.3 as questions to send to the provider. Nothing here was tested against a live or test account.

## Summary

1. **Shops are paid by direct charges on their own Stripe account**, created through Stripe-hosted onboarding with the Standard-equivalent settings (Stripe carries losses, the shop pays Stripe's fees, the shop has the full Stripe Dashboard). This matches Stripe's answers of 10 Nov 2026 and is the only Connect shape Stripe's Thailand page lists [S1].
2. **The Moto Mangos fee is a separate charge on Mango Works' own Stripe account**, never an application fee. Stripe's Thailand page marks the application fee "Not applicable" for a Thai platform with Thai shops [S1], an application fee must be smaller than a charge made on the shop's account [S10], and fee-only booking makes no charge on the shop's account at all. Mango Works is the merchant of record for the fee; the shop is the merchant of record for the rental.
3. **Three provider limits shape the design:**
   - Thai Stripe accounts take **Visa and Mastercard only** (no Amex, JCB or UnionPay) [S24].
   - **PromptPay cannot be saved, held or charged later**; it has no dispute process; its refund is asynchronous and can wait on the customer; one QR can be paid twice [S22][S23].
   - **A card hold does not always last 7 days.** Visa gives a merchant-initiated authorization 4 days 18 hours; 7 days is for a customer-initiated one [S28]. The design never assumes a length: it reads the hold's own `capture_before`.
4. **One risk must be cleared with Stripe before Phase 7 starts.** "Transportation services" is a restricted business in Thailand and is on Stripe's list of industries it cannot support through Connect in Thailand "for some connected accounts" [S2][S3]. Vehicle rental is not named either way. §11.3 question 1.
5. **Money states live in two places.** What is still in motion (an intent waiting for the customer, a refund the bank has not confirmed) lives in mutable provider tables. The Phase 3 ledger stays append-only and gets a row only when the provider confirms money moved. A later reversal (a refund that failed, a chargeback) is a new row that points at the row it undoes.
6. **Webhooks are a prompt, not the truth.** Each event is verified, stored once, and answered at once. A worker then fetches the object from the provider and brings our records to match it, so events may arrive twice, late or out of order. A daily job compares the provider's list with the ledger.
7. **A tax finding goes against a settled decision and needs Korn before Phase 3's ledger is built.** The Revenue Department's order Por.73/2541 reads as putting a security deposit on a rental of movable property inside VAT when it is received, with a credit note when it is returned [T18]. The decision is "no VAT on a deposit until kept". This design keeps the decision and makes the question Korn's first (§6.1, K3).
8. **Phase 3's plan needs nine changes now**, while it is on paper (§10). The three that matter most: the "no overpayment" rule must bind staff entry only, because money a provider has already taken cannot be refused; a refund must name the payment it refunds, not only the charges; and a Moto Mangos order needs a line for the fee paid online, or its balance never reaches zero.
9. **Vendor billing keeps its own invoices and ledger** and uses Stripe only to collect (card, PromptPay QR). Stripe has no bank transfer method in Thailand [S36], so the manual "mark paid with a slip" route is required, not optional.
10. **Omise is a weaker fallback than assumed**: it adds JCB, Amex and UnionPay, but it cannot refund PromptPay, may not allow a saved card to be charged without the customer, promises no webhook retries, and has no confirmed way for a platform to act for a shop (§1.4).
11. **Phase 7 is ten stages** (§9); seven are Fable builds. Phase 8 adds the public checkout on top.

## 1. What the providers allow (checked 19 Nov 2026)

### 1.1 Stripe Connect for a Thai platform

| Point | Finding | Source |
| --- | --- | --- |
| Charge types | Stripe's Thailand page lists direct charges only. Separate charges and transfers are not supported; top-ups of the platform balance are not supported. Destination charges are not mentioned (**unclear**) | [S1] |
| Thai platform, Thai shop | Cards and PromptPay supported by direct charge. The application-fee column reads "Not applicable" (**unclear** what that means; Stripe's written answer of 10 Nov 2026, recorded in the spec, is that a Thai platform cannot take one) | [S1] |
| Thai platform, shop abroad | Cards only, and only when the platform takes no application fee | [S1] |
| Shops abroad | Stripe's requirements helper lists 43 countries a Thai platform can connect; Vietnam is not one | [S47] |
| Vietnam | Not a Stripe country; a Vietnamese shop cannot open a Stripe account to take payments | [S21][S4] |
| Account model | "Standard", "Express" and "Custom" are legacy names; Stripe recommends controller properties, and points new platforms to Accounts v2. Whether Accounts v2 is open to Thai platforms is **unclear** | [S4][S5][S6] |
| Standard-equivalent settings | Losses: Stripe. Fees paid by: the account. Requirements collected by: Stripe. Dashboard: full. A full Dashboard cannot be combined with platform-paid fees or platform loss liability | [S5] |
| Express and Custom | Thai platforms cannot self-serve Express accounts (contact sales) | [S41] |
| Restricted businesses | "Hotels, tour operators and transportation services" need extra review in Thailand; the Connect list says some connected accounts in those industries cannot be supported. Vehicle rental is not named. "Vehicle sales" is prohibited | [S2][S3] |
| Onboarding | Create the account, then an Account Link (single use, expires in minutes, never emailed). The return address proves nothing: check `details_submitted` and `charges_enabled` by `account.updated` or by fetching the account. API-only onboarding cannot do Thailand's selfie check | [S7][S1] |
| OAuth | "Isn't recommended for new Connect platforms"; it is the only way to connect an account that already exists | [S8] |
| What a Thai account needs | Individual, sole proprietor, partnership or company; Thai address and phone; a website, app link or social profile; a Thai bank account in THB. Thai ID card, or a passport for a foreigner; a DBD affidavit under 6 months old for a company | [S39] |
| Merchant of record | For a direct charge it is the connected account. Stripe adds that the site, checkout, receipt and statement descriptor must all show the same seller | [S15][S38] |
| Refunds and disputes | Both are debited from the shop's balance. A refund waits if the balance is short and fails after 45 days. The shop pays the dispute fee. The platform can refund and answer disputes with the `Stripe-Account` header | [S11][S12][S13] |
| Fees in Thailand | Domestic card 3.65% + ฿10; international card 4.75% + ฿10 (+2% with currency conversion); PromptPay 1.65%, and ฿10 per PromptPay refund; ฿500 per dispute received. Fees on a refunded payment are not returned. No Connect fee to the platform when Stripe sets the shop's pricing | [S19][S20][S30] |
| Payouts | Thai accounts: funds arrive 7 business days after a payment; THB only | [S37] |

### 1.2 Cards

| Point | Finding | Source |
| --- | --- | --- |
| Brands | Visa and Mastercard only on Thai accounts | [S24] |
| Saving a card | SetupIntent, or `setup_future_usage` on a payment. A saved card charged later is a merchant-initiated transaction and needs the customer's recorded agreement: permission, timing, how the amount is set, the cancellation policy | [S25][S26] |
| Charging later | A PaymentIntent with `off_session` and `confirm`. If the bank wants authentication the call fails with `authentication_required` and the intent returns to `requires_payment_method`; the customer is brought back to confirm the same intent on-session | [S25][S27] |
| 3-D Secure | Stripe triggers it when a rule or the issuer asks; it cannot be switched off by API. Stripe documents no Thailand mandate (**unclear**); an issuer can still ask for it on any payment. Included in Thai pricing | [S40][S43][S19] |
| Retries | Stripe will not retry `lost_card`, `stolen_card`, `pickup_card`, `incorrect_number`, `authentication_required` and the revocation codes. Each decline carries an `advice_code` (`do_not_try_again`, `try_again_later`, `confirm_card_data`). Visa forbids more than 15 retries of one payment in 30 days. Stripe's own advice is inconsistent: at most eight on one page, four on another | [S27][S31] |
| Hold length (online) | Visa: 7 days customer-initiated, 5 days (exactly 4 days 18 hours) merchant-initiated. Mastercard: 7 days. The deadline for one hold is `payment_method_details.card.capture_before` on its charge | [S28] |
| Hold end | Capture the full amount, or less with `amount_to_capture` (the rest is released; one capture only); cancel to release at no cost; at expiry the intent becomes `canceled` and `charge.expired` fires | [S28][S30][S45] |
| Longer holds | Extended authorization: up to 30 days for vehicle rental on Visa and for every category on Mastercard, but only on IC+ pricing. Whether IC+ is offered to Thai accounts is **unclear** | [S29] |
| Refunds | Full or partial, several times, to the original card only; 5 to 10 business days to appear. No time limit is documented (**unclear**). A refund can fail (`refund.failed`), and the shop must then repay another way | [S30] |
| Disputes | A cardholder usually has 120 days, longer for a future-dated service. Response window "usually 7 to 21 days"; the real deadline is `evidence_details.due_by`. One submission only | [S18] |
| One card, two accounts | A card saved on the platform's account can be cloned to a connected account for a direct charge; only cards can be cloned. Not confirmed for Thai platforms (**unclear**) | [S14] |

### 1.3 PromptPay on Stripe

| Point | Finding | Source |
| --- | --- | --- |
| Who | Thai Stripe accounts only; THB only | [S22] |
| Amount | 10 THB to 999,999.99 THB (the support FAQ says 2 million: **unclear**) | [S22][S23] |
| How | The customer scans a QR in a Thai bank app. Confirmation is immediate: `payment_intent.succeeded` | [S22] |
| QR lifetime | **Unclear**: no expiry is documented and the QR object has no expiry field | [S22] |
| Twice on one QR | Possible. Stripe tries to refund the customer; otherwise the money lands in the account's balance and the shop refunds it outside Stripe | [S22][S23] |
| Save, hold, charge later | None: no SetupIntent, no `setup_future_usage`, no manual capture | [S22][S44] |
| Refund | Full or partial, asynchronous (`refund.updated`, `refund.failed`). In one documented flow Stripe emails the customer for bank details and the refund waits in `requires_action`, failing if they never answer. Which flow applies to a plain QR payment is **unclear** | [S22][S30] |
| Disputes | None | [S22] |
| Statement text | Fixed: the payer sees Stripe's name, not the shop's | [S22][S23] |
| Connect | Supported for a Thai platform's Thai shops by direct charge | [S1][S22] |
| Invoices | On a Stripe invoice only with "send invoice" collection; the customer pays each invoice by QR | [S22][S35] |

### 1.4 Omise (Opn Payments) and Vietnam

**Omise** (the Opn Payments name was dropped in March 2025; the pages are at docs.omise.co) [O1].

| Point | Finding | Source |
| --- | --- | --- |
| Card brands | Visa, Mastercard, JCB, Amex, UnionPay; "up to 3.65%" + 7% VAT | [O2] |
| Card entry | Omise.js turns the card into a single-use token in the browser; the server sees only the token | [O3] |
| Saved cards | A customer record holds cards; a charge can name the customer and card with no token | [O4][O5] |
| Charging without the customer | **Not on an account with 3-D Secure on.** 3-D Secure is an account-wide setting that Omise's risk team makes mandatory "for certain business types"; on such an account "merchants cannot process fully automatic/recurring payments". Whether a rental shop's account would be one is **unclear** | [O6][O7] |
| Holds | `capture: false`. The hold length "depends on the country"; only Japan's is stated. An older help page says 7 days. Thailand: **unclear**. One partial capture, for accounts contracted with Omise Thailand; the rest is released | [O8][O9] |
| PromptPay | THB 20 to THB 150,000. The QR expires after 24 hours by default and can be made shorter. Completion by `charge.complete` | [O10] |
| PromptPay refund | **None**: "PromptPay charges cannot be voided or refunded through Omise" | [O10] |
| Card refund | Full or partial, fewer than 15 per charge, within 365 days; not after a dispute | [O11] |
| Disputes | Amount deducted at once; 7 days to respond | [O12] |
| Webhooks | Signed now (`Omise-Signature`, HMAC-SHA256, with a timestamp header). **No promise of retries**: Omise recommends polling its Events API for anything missed. Ordering not addressed | [O13] |
| Idempotency | No idempotency header found. A charge's `ref_id` can be used once per account; what a repeat returns is **unclear** | [O5] |
| A platform acting for shops | "Account chaining" exists in the API reference (a chain key per sub-merchant, treated like a secret key), but its guide pages are gone and its availability in Thailand is **unclear**. Transfers and recipients pay out from the platform's own balance, which would mean holding shop money. Otherwise each shop gives its own public and secret key; the secret key cannot be limited in scope | [O14][O15][O16] |

What this means for the fallback: Omise would add JCB, Amex and UnionPay, but may not be able to charge a saved card later, cannot refund PromptPay, and has no confirmed way for a platform to act for a shop without holding that shop's all-powerful key. It is a fallback for taking payment at the desk and by link, not a like-for-like replacement.

**Vietnam.** Stripe does not serve Vietnamese businesses [S21]. No provider is chosen here. What the official pages of the candidates show is how much a Vietnam provider may lack:

| Provider | Confirmed from its own pages | Source |
| --- | --- | --- |
| payOS | Bank QR (VietQR) only: no cards, no saved method, no hold, no refund call. Webhook signed with HMAC-SHA256 | [V1] |
| ZaloPay | Cards and bank cards; a saved card may still ask the customer for a one-time code; holds for its wallet only; refunds asynchronous | [V2] |
| MoMo | Card payment, saved tokens, a hold option and a refund call appear in its reference; the pages could not be opened in full, so details are **unclear** | [V3] |
| Xendit (Vietnam) | Cards with saved-card charging, holds and partial refunds; no bank QR listed; webhooks carry a fixed token, not a signature | [V4] |
| dLocal (Vietnam) | Cards with refunds and recurring; bank QR through VNPAY and others; domestic Napas cards cannot recur | [V5] |
| VNPAY, OnePay, 9Pay, Payoo | Official pages not reachable or not read: **unclear** | |

So the interface must be able to say, per account: no cards at all; no refund through the provider; full refunds only; no holds; a saved card that still needs the customer; webhooks with no signature. §2.3 has a capability for each.

**Thailand, other fallbacks.** Xendit lists Thai cards (with saved-card charging and holds) and PromptPay (refundable only for some banks, within 30 days) [V6]. 2C2P lists Visa, Mastercard, Amex, JCB and UnionPay for Thailand; PromptPay is not confirmed on the page read [V7]. Neither is designed for here.

## 2. The provider interface

### 2.1 Where it lives

A new server-only package, `packages/payments` (`@mango/payments`), holds the interface, the adapters and a fake provider for tests. Both apps use it: the platform for shop payments and vendor billing, the marketplace for the fee. It gets database access from `@mango/db` and imports no app code. The provider SDKs (`stripe`, later Omise's) are dependencies of this package only; ESLint refuses them anywhere else. (Adding `stripe` is a new dependency: asked for when stage 2 starts.)

Three accounts use the same interface:

| Use | Whose provider account | Charge shape |
| --- | --- | --- |
| A shop's payments | The shop's own | Stripe: direct charge with the `Stripe-Account` header. Omise: the shop's own keys |
| The Moto Mangos fee | Mango Works' | A plain charge on its own account |
| Vendor billing | Mango Works' | A plain charge on its own account |

### 2.2 The interface

An adapter is created **for one account** and cannot be called without one, so no call can reach a provider without naming whose money it is.

```text
provider(accountRef) →
  capabilities()                      what this account can do today (§2.3)
  onboarding.start() / status()       a link to the provider's own onboarding; the account's state
  customers.ensure(customer)          the provider's customer record for one of ours
  methods.save.start(customer, consent)        → client handoff (card form)
  methods.list(customer) / detach(method)
  payments.create({amount, currency, methods, capture: now | hold,
                   saveForLater, customer, statementSuffix, metadata, idempotencyKey})
                                      → client handoff (card form, QR, hosted page)
  payments.chargeSaved({amount, currency, customer, method, capture, idempotencyKey})
                                      → paid | held | action_needed | declined(code, retryable)
  payments.capture(ref, amount?) / release(ref)
  payments.get(ref)                   the provider's current state, normalised (§2.4)
  refunds.create({paymentRef, amount, reason, idempotencyKey}) / refunds.get(ref)
  disputes.get(ref)
  webhooks.verify(rawBody, headers)   → a verified event, or a refusal
  reconcile.list(since, cursor)       payments, refunds and disputes, page by page
```

- **Amounts** are integer minor units with a currency code, as everywhere. The adapter converts at the provider boundary and nowhere else.
- **Every write takes an idempotency key** made by the caller from our own row id (§5.5), never a random value at call time.
- **Card data never passes through the interface.** A "client handoff" is an opaque value the browser gives to the provider's own script (a client secret, a hosted address, a QR image address).
- **Errors are normalised**: `declined` with the provider's code, our own class (`retryable`, `needs_customer`, `stop`), and the provider's advice code where there is one.

### 2.3 Capabilities

Features switch on what the account can do, never on the provider's name (spec, Review decisions). `capabilities()` reads the stored row in `payment_accounts`, refreshed by the account webhook and by the daily job.

| Capability | Stripe, Thai shop | Meaning when absent |
| --- | --- | --- |
| `charges_enabled` | From the account | No online payment offered at all; staff see why |
| `card` | Yes (Visa, Mastercard) | |
| `promptpay` | Yes, THB | |
| `save_card` | Yes | Pay-later and monthly auto-charge are not offered; payment requests by link instead |
| `hold` | Cards | Deposit by card is charge-and-refund only |
| `hold_max` | Read per hold | A provider that states a fixed length reports it here |
| `partial_capture` | Yes, once | A kept part of a hold is capture-all then refund the rest |
| `partial_refund` | Yes | Full refunds only |
| `refund` (per method) | Cards and PromptPay | The refund is made outside the provider (cash or transfer) and recorded by staff, as Phase 3 records one. Omise's PromptPay is the known case |
| `refund_async` | PromptPay | The refund screen warns it may take days and may fail |
| `charge_saved_without_customer` | Yes | A saved card only spares typing; every charge is a link the customer confirms. Scheduled charges become scheduled payment requests |
| `webhook_retries` | Yes, up to 3 days | The reconciliation job runs hourly for that account, not daily |
| `idempotent_calls` | Yes | Before any retry the adapter looks the object up by our own reference and never creates blind |
| `disputes` | Cards | |
| `qr_expiry` | Not stated | We run our own clock on a shown QR (§3.3) |
| `signed_webhooks` | Yes | The event is treated only as a prompt to fetch (§5.2), which is the rule anyway |
| `platform_fee` | No (Thailand) | Never offered |

### 2.4 One state model

Every provider's payment is mapped to one of: `awaiting_customer`, `processing`, `held`, `paid`, `failed`, `canceled`, `expired`. A refund is `pending`, `needs_customer`, `done`, `failed` or `canceled`. A dispute is `warning`, `open`, `won` or `lost`, with `funds_withdrawn` and `funds_returned` as separate facts. The adapters do the mapping; nothing outside the package reads a provider's own status words.

### 2.5 How the three providers fit

| | Stripe | Omise | A Vietnam provider |
| --- | --- | --- | --- |
| Account | Connected account id; no secret stored | A chain key if Omise confirms account chaining for Thailand; otherwise the shop's own public and secret key, stored encrypted (§8.2) | Expected: the shop's own merchant keys, stored encrypted |
| Capabilities | §2.3 | Five card brands, holds with one partial capture, signed webhooks; **no** PromptPay refund, **no** webhook retries, **no** idempotency header, and possibly no charge without the customer (§1.4) | Expected: bank QR first; cards, saved cards, holds and refunds each only if that provider's pages confirm it |
| When built | Phase 7 | Only when a Thai shop cannot use Stripe (§11.1 decision 12) | When the Vietnam market is prepared; chosen then, against the same contract tests |

**Contract tests.** One test suite runs against every adapter and the fake: pay, pay twice with one key, hold and capture part, release, refund in part, a refund that fails, a decline of each class, a webhook with a bad signature, the same event twice. An adapter that lacks a capability must refuse the call with `not_supported`, and the suite checks that too.

## 3. Shop payments

### 3.1 The account and onboarding

- **Account shape:** created by the platform with controller properties equal to Standard (losses Stripe, fees paid by the account, requirements collected by Stripe, full Dashboard) [S5], on the Accounts v1 API until Stripe confirms Accounts v2 for Thai platforms (§11.3 question 6). The shop is merchant of record, pays Stripe's fees and dispute fees, and can open its own Stripe Dashboard.
- **Onboarding:** Settings › Payments › "Connect Stripe" (owner only). The server creates the account (country and business type from the tenant, never assumed Thai), stores its id, and sends the owner to a fresh Account Link. On return the page fetches the account and shows one of: finish the form, under review, ready, or what Stripe still needs (`requirements.currently_due`, with the deadline). `account.updated` keeps this current [S7][S9].
- **An existing Stripe account** (BSR has one, connected to Booqable) is **not** connected. The owner makes a second account under the same Stripe login through our link; connecting an existing one would need OAuth, which Stripe no longer recommends and which shares our data with the shop's other platforms [S8]. §11.1 decision 1.
- **Disconnecting:** an account we created cannot be disconnected by the shop alone [S42]. We handle `account.application.deauthorized` anyway: the account is marked disconnected, online payment switches off, scheduled charges stop with a staff alert, and nothing else changes.
- **Stored** in `platform.payment_accounts`: tenant, provider, the account id, livemode, capabilities, requirements due and their deadline, default currency, statement descriptor, connected by and when. No secret for Stripe.
- **One live account per tenant and provider.** A tenant's currency must equal the account's settlement currency before card or QR payment switches on.

### 3.2 Card payment now

Used by "Take payment" on the order page, a payment link, and (Phase 8) checkout.

1. The server works out the amount from the order's open charges; the browser never sends one.
2. It writes a `provider_payments` row (§5.4) for that amount and those charges, then creates the provider payment with that row's id as the idempotency key.
3. The customer pays in the provider's card form (Stripe's Payment Element, loaded from Stripe). 3-D Secure, when asked for, happens there.
4. On `paid`, the worker (§5.3) writes the ledger `payment` row, method `card`, with the allocation to those charges and the VAT that `paymentVat()` works out, exactly as a cash payment does in Phase 3. The tax invoice follows the payment (Phase 6).

**Payment links** are an address with an unguessable token for one `provider_payments` request, sent by email or LINE, showing the shop, the order and the amount, and expiring with the request. The amount is re-read from the order when the page opens; a link for a charge that has since been voided or paid shows that instead of a form.

**Down payments:** a payment request for part of a charge (a percentage or an amount). It is an ordinary payment allocated to that charge; the charge is settled when its allocations reach its total (Phase 3 §6.4).

### 3.3 PromptPay

- The same flow with a QR in place of the card form. Staff show it on their screen; a link shows it on the customer's phone.
- **We run our own clock**, because Stripe documents no QR lifetime [S22]. A shown QR is good for the request's own time (15 minutes at the desk; a payment link's own expiry; the hold's remaining time at checkout). When that runs out we cancel the provider payment. Whether a cancelled intent's QR can still be paid is **unclear** (§11.3 question 4), so the rule below covers it.
- **Money that arrives is always recorded** (§10 change 1): a second payment on one QR, a payment after its request expired, a payment on an order since cancelled. It becomes a `payment` row; whatever no open charge needs stays unallocated as the customer's credit, and staff get a "money received that the order did not need" item to refund it.
- **PromptPay never holds a deposit and is never saved.** A deposit by PromptPay is charge-and-refund.
- **Refunds** are asynchronous (§3.7).

### 3.4 Saved cards

- A card is saved on **the shop's account**, as a provider customer per `(tenant, customer)`. Table `customer_payment_methods`: tenant, customer, payment account, provider customer and method references, brand, last four, expiry, status, and the **consent record** (the text version shown, when, by whom, from which channel and address, what it allowed: the amount or how it is worked out, when it will be charged, the cancellation terms) [S26].
- Saved with authentication at the time (SetupIntent, or as part of a first payment), so later charges have the best chance of passing without the customer [S25].
- Staff can remove a card; a customer can remove theirs from a link. A removed card cancels its scheduled charges with a staff alert.
- If the card network changes the card's brand, a new agreement is needed before another charge without the customer [S26]: the method is marked `needs_consent` and its scheduled charges become "action needed".

### 3.5 Scheduled charges

"Reserve now, charge a set time before pickup" and, in Phase 9, the monthly charges of a long rental. Phase 3 leaves `order_charges.due_at` and says `scheduled_charges(order_charge_id, due_at)` attaches here.

```text
scheduled_charges
  id, tenant_id, order_id, order_charge_id, payment_method_id
  due_at            the charge's due_at less the shop's charge-before time, in the shop's time zone
  status            scheduled | running | paid | action_needed | failed | canceled
  attempts, next_attempt_at, last_code, last_advice, provider_payment_id
  deadline_at       when an unpaid charge makes the order "unpaid past due"
```

**The runner** (hourly, and on demand):

1. Claims due rows `for update skip locked`, sets `running`.
2. Re-reads the order under the order row lock: still booked, the charge still open, and **the amount is what is open on that charge now**, not what was planned. Nothing open: the row is `paid` (settled another way) or `canceled`.
3. Calls `chargeSaved` with the key `scheduled_charge id : attempt number`.
4. Outcomes:

| Result | What happens |
| --- | --- |
| Paid | Ledger row through the worker; `paid`; the customer's receipt and tax invoice follow the payment |
| Authentication needed | `action_needed`: the customer gets a link that confirms the **same** provider payment on-session [S25]; staff get a Late item. No more automatic attempts on this card |
| Retryable decline (`try_again_later`, issuer unavailable, processing error, insufficient funds) | `scheduled` again with `next_attempt_at`: +12 hours, +24, +48. **At most four attempts** in all, and never past the deadline [S27][S31] |
| Stop (`do_not_try_again`, lost, stolen, revoked, card data wrong, expired) | `failed`: the customer gets a link to pay with another card or PromptPay; staff get a Late item |
| The call timed out or the answer is unknown | Stays `running`; the same key is sent again by the next run, so the provider answers with the first result [S17]; the worker's fetch settles it either way |

5. **The deadline.** Each shop sets how long an unpaid booking is kept after its first failed charge (default 24 hours, never past pickup). At the deadline the order shows "unpaid past due" on the Late tab (the item Phase 3 leaves for Phase 7). Whether it is then cancelled automatically is the shop's setting, off by default for a shop's own bookings.

- A booking made inside the charge-before window is charged at booking, on-session.
- Cancelling an order, removing the card or paying another way cancels the scheduled rows in the same transaction.
- Two runners cannot charge twice: the claim is a row lock, and the provider key is the row and attempt.
- A declined card's real reason is never shown to the customer for `fraudulent`, `lost_card`, `stolen_card` and the like; they see a general "card declined" [S27].

### 3.6 Deposits by card

The shop's deposit mode (none, percentage, per product, fixed) sets the amount; this is how a card takes it. Staff choose **authorize** or **charge** per payment, with the shop's default.

**Authorize (a hold)**

- Taken **with the customer present**, at pickup, in the card form (staff device, or a link on the customer's phone). A customer-initiated hold gets the longer window; a hold taken from a saved card without the customer can be 4 days 18 hours on Visa [S28]. §11.1 decision 7.
- We store the hold's own `capture_before` and never work a length out ourselves.
- **Offered only when the rental fits:** the rental's end, plus a margin (default 24 hours, for the check-in and a damage decision), must fall before the shortest window the card could get. For a hold taken with the customer that is 7 days less the margin: rentals of up to about 6 days. Anything longer is charge-and-refund, as the settled decision says. A rental extended past its hold gets a staff item "the hold ends before the return": capture it now as a charged deposit, or let it go.
- **At-expiry action** (shop default, changeable per order): release, or capture. A job runs it **6 hours before `capture_before`**; staff can capture or release by hand at any time before.
- **Capture** takes all or part once; the rest is released by the provider [S28]. **Release** cancels the hold at no cost.
- If the hold ends on its own (`charge.expired`), it is recorded as released, with a staff alert when the order still wanted it.
- **Longer holds** (30 days for vehicle rental) need Stripe's IC+ pricing on the shop's account [S29]; not designed in until Stripe says Thai shops can have it (§11.3 question 3). If it comes, only `capture_before` changes; nothing here does.

**Charge** (and every PromptPay deposit, and every long rental): a payment now, refunded at return in whole or in part. The shop is told in Settings that a refunded card deposit costs Stripe's fee on the original payment [S19][S30].

**In the ledger** (kinds from Phase 3 §6.4):

| Event | Rows |
| --- | --- |
| Hold placed | `deposit_hold`, method `card`, the provider reference; **no money has moved** |
| Hold captured in part for damage | `deposit_capture` (the part kept, the money arriving now) + `payment`, method `deposit`, pointing at it, allocated to the damage charge with its own VAT and tax invoice; `deposit_release` for the rest |
| Hold released or expired | `deposit_release` for the whole |
| Deposit charged | `deposit_in`, method `card` or `promptpay` |
| Charged deposit returned | `deposit_out` once the provider confirms the refund; a kept part is `deposit_capture` + `payment` as above |
| Cash deposit | Unchanged from Phase 3 |

Two rules follow, both for Phase 3 to write down now (§10 change 4): a hold's rows always satisfy hold = captures + releases, and "deposit held" as money counts `deposit_in` less `deposit_out` and captures of charged deposits only; card holds are shown beside it, never inside it.

### 3.7 Refunds

- **Who:** as Phase 3: owner and manager; staff when `staff_can_refund` is on. The same check, in the database, before any provider call.
- **To what:** a provider refund goes back to the payment it came from and cannot exceed it [S30]. So a refund **names the payment** as well as the charges it reverses (§10 change 2). The screen offers each card or PromptPay payment with what is still refundable on it; cash and transfer refunds stay as Phase 3 has them.
- **Two steps.** The decision is written first as a `refund_requests` row (who, why, which payment, which charges, how much). The provider refund is created with that row's id as the key. The ledger `refund` row, with its reversing allocations and the VAT its credit note prints, is written **when the provider says the refund is done**, not before.
- **States shown on the order:** requested, with the bank, waiting for the customer (PromptPay, when Stripe is asking them for bank details), done, failed.
- **A refund that fails** before it was done: the request is `failed`, nothing is in the ledger, staff are told to repay another way (cash or transfer, recorded as Phase 3 records them). **A refund that fails after it was recorded** (rare; Stripe returns the money to the shop's balance [S30]): a `reversal` row pointing at the refund row (§10 change 3), and Phase 6 must decide what cancels the credit note already issued (§11.2 K5).
- **A short balance:** a card refund waits while the shop's Stripe balance cannot cover it and fails after 45 days [S11]; the request shows "waiting for funds in your Stripe balance".
- **Cost:** Stripe keeps its fee on the original payment; a PromptPay refund costs ฿10 more [S19]. The refund screen says so.
- **Cancellation fee** (Phase 3 decision 18 left it here): a shop setting, "keep X% or a fixed amount when the customer cancels less than N hours before pickup", default: no refund after 72 hours, full refund before. Kept money is a charge of its own (`order_charges.kind`, §10 change 8) so it has a tax invoice like any other income.

### 3.8 Disputes

- Cards only; PromptPay has none [S22].
- A dispute on a direct charge is the shop's: Stripe debits the shop's balance for the amount and the ฿500 fee, and the shop answers it [S12][S19].
- **Phase 7 does three things.** It records the dispute (`provider_disputes`: payment, amount, reason, state, respond-by). It alerts owner and manager at once, with the deadline from `evidence_details.due_by` and a link to the dispute in the shop's own Stripe Dashboard. And it writes the ledger: a `chargeback` row when the funds are withdrawn (the order's balance goes back up by that amount; the shop pursues the customer or writes it off) and a `reversal` of it when a won dispute returns them (§10 change 3).
- **Answering inside the app is later** (§11.1 decision 10). The platform already holds what wins a rental dispute (the signed agreement, check-out and check-in photos, the damage record, the customer's ID check), so an evidence pack is a natural later feature.
- No refund is possible on a payment while its dispute is open [S18]; the refund screen says so.
- The dispute fee is the shop's cost and is not in the order's ledger.

### 3.9 What staff and customers see

- **Stripe's own receipt emails are off**; our messages carry the receipt and the tax invoice (Phase 6). `receipt_email` is never passed [S33]. §11.1 decision 13.
- **On the card statement:** the shop's own descriptor, with the order code as the suffix (`BSR* K7Q4AB`) [S32]. PromptPay shows Stripe's name and cannot be changed [S22]; the confirmation message names the shop.
- **Settings › Payments:** connection state, what Stripe still needs, methods on or off, charge-before time, the unpaid deadline, deposit default (authorize or charge) and at-expiry action, the cancellation fee, and a plain statement of Stripe's fees and that refunds do not return them.

### 3.10 Mapping to Phase 3's ledger

| Provider fact | Ledger (`platform.payments`) | Allocation |
| --- | --- | --- |
| Card or PromptPay payment succeeded | `payment`, method `card` / `promptpay`, provider and reference, `received_at` = the provider's time of payment | To the charges the request named, oldest due first; what no open charge needs stays unallocated (credit) |
| Refund confirmed | `refund`, naming the payment and the charges | Negative allocations, as Phase 3 |
| Refund failed after being recorded | `reversal` → the refund row | The refund's allocations reversed again |
| Hold placed / released / expired | `deposit_hold` / `deposit_release` | None |
| Hold captured | `deposit_capture` + `payment` (method `deposit`) | The payment to the charge it pays |
| Deposit charged / returned | `deposit_in` / `deposit_out` | None |
| Dispute: funds withdrawn | `chargeback` → the payment row | That payment's allocations reversed; the charges read unsettled |
| Dispute won: funds returned | `reversal` → the chargeback row | Restored |
| Dispute opened, evidence sent, closed with no money moved | No ledger row (`provider_disputes` only) | |
| Payment failed, canceled, expired | No ledger row (`provider_payments` only) | |
| Stripe's fee on a payment | Not in the order's ledger: `provider_payments.fee`, for reports and profit (Phase 10) | |

## 4. The Moto Mangos fee

### 4.1 Who sells what

| | The fee | The rental |
| --- | --- | --- |
| Seller (merchant of record) | Mango Works Co., Ltd., trading as Moto Mangos | The shop |
| Paid | Online, to Mango Works' Stripe account | At the shop, by the shop's own means (cash, transfer, or the shop's Stripe through the platform) |
| On the statement | Moto Mangos' descriptor | The shop's, if by card |
| Document | A receipt from Mango Works (decision 26, pending Korn) | The shop's tax invoice or receipt for what the shop is paid |
| Refund decided by | Moto Mangos' rules | The shop's |
| Dispute falls on | Mango Works | The shop |

Stripe decides merchant of record by what the customer sees [S38], so the Moto Mangos checkout, the receipt and the statement descriptor all name Moto Mangos for the fee, and the checkout says in plain words: "You pay ฿288 to Moto Mangos now. You pay ฿2,592 to [Shop] at pickup."

### 4.2 A separate charge, not an application fee

| | Separate charge on Mango Works' account | Application fee through Connect |
| --- | --- | --- |
| Thailand | A plain charge on our own account: nothing special | "Not applicable" on Stripe's Thailand page; Stripe's written answer says no [S1] |
| Needs a charge on the shop's account | No | Yes, larger than the fee [S10]; fee-only booking makes none |
| Needs the shop to have Stripe | No | Yes |
| Shops abroad | Works wherever Mango Works can charge | Refused for a Thai platform [S1] |

**Decided by the facts: a separate charge.** This is also what the spec's Review decisions and INTEGRATION §6.4 already say. The later "full online payment" mode (the rest charged to the shop's account at the same checkout) would be two charges, fee and rental, on two accounts from one card; that needs card cloning [S14], which is not confirmed for Thai platforms. It stays out of Phase 7 and Phase 8 (§11.3 question 5).

**Which Stripe account.** Mango Works is one company and could use one Stripe account for everything. Recommended: **two accounts under the one company**: "Mango Works" (the Connect platform and vendor billing) and "Moto Mangos" (the fee). Renters then see one brand on the checkout, receipt and statement, as Stripe's merchant-of-record rule asks, and consumer disputes on the fee never touch the standing of the account the shops' payments depend on. Whether Stripe Thailand allows a second account for the same company is to be confirmed (§11.3 question 7; §11.1 decision 2).

### 4.3 The fee record

Marketplace-owned (`public.marketplace_fees`, keyed by order id; Phase 3 §7.3), fixed at booking: base, whether VAT is inside the base, fee, currency, the plan (`charge_at`), status, the provider payment and refund references, the receipt number. The status values are those of `fee-lifecycle.ts`: `awaiting_shop`, `scheduled`, `due`, `paid`, `refunded`, `kept`, `not_charged`.

The fee is worked out by the marketplace from the base `create_booking` returns; the amount is never taken from the browser, and never passed into the platform.

### 4.4 When it is charged

| Booking | Card | PromptPay |
| --- | --- | --- |
| Pickup more than 72 hours away | Card saved at booking on Moto Mangos' account, with consent to one charge of the stated fee at the stated time; charged without the customer at the charge time | **Paid at booking** (PromptPay cannot be saved [S22]) |
| Pickup within 72 hours, or a walk-in | Paid at booking | Paid at booking |
| Request booking | Card saved at booking; nothing charged until the shop accepts; then as above (at once if inside 72 hours) | The customer pays when the shop accepts: a payment link, good until the earlier of 24 hours and the charge time |

- **"72 hours"**: the code today counts 3 calendar days at the pickup's clock time in the shop's time zone (`fee-lifecycle.ts`, owner decision 9 Nov 2026). In Thailand the two are the same instant. In a country with daylight saving they differ by an hour twice a year. §11.1 decision 4.
- **The scheduled charge** uses the same runner design as §3.5, on Moto Mangos' account, with the marketplace SPEC's policy: retry after 12 hours; email the customer to update the card; **unpaid 2 days before pickup: the booking is cancelled** (`cancelled_unpaid`) and the shop told. Authentication needed: the customer gets a link to confirm the same payment.
- **Timing against the shop.** A card booking is not `paid` until the charge succeeds, 72 hours before pickup. The shop sees "confirmed, fee due [date]" until then and "paid, collect ฿X at pickup" after.
- **A PromptPay payment at booking with a hold on the vehicle**: the QR is shown for the hold's remaining time. If the money arrives after the hold ran out and the vehicle is gone, the fee is refunded in full automatically and the customer told.

### 4.5 Refunds and cancellation

| Event | Card, not yet charged | Already paid (PromptPay at booking; any booking inside 72 hours) |
| --- | --- | --- |
| Customer cancels more than 72 hours before pickup | The scheduled charge is cancelled; the saved card is removed; nothing to refund | Full refund |
| Customer cancels within 72 hours; no-show | (Already charged) | Fee kept |
| Shop declines, lets a request expire, or cancels | Cancelled, nothing charged | Full refund |
| Fee unpaid at the deadline | Booking cancelled; nothing charged | |

- Refunds follow §3.7's two steps on the fee record: requested, then `refunded` when the provider confirms.
- **What a refund costs Mango Works:** Stripe keeps its fee on the original payment, and a PromptPay refund costs ฿10 more [S19]. On a ฿50 fee paid by PromptPay that is about ฿11 lost per refund; on a card fee of ฿288, about ฿20. This only arises for fees paid at booking, which is why the checkout puts the card first for a pickup more than 72 hours away: a card is not charged until the free-cancellation time has passed. §11.1 decision 5.
- A PromptPay refund may wait on the customer's bank details [S22]; the booking page shows "refund on its way" with what the customer must do.
- A referral earning is reversed when its fee is refunded (marketplace SPEC, unchanged).
- A dispute on the fee is Mango Works' own: recorded on the fee record, answered from Moto Mangos' Stripe Dashboard.

### 4.6 The receipt

Sent by email when the fee is paid: Moto Mangos and Mango Works Co., Ltd. with its address and tax ID; the receipt number (its own gapless series, §6.2); the date; the customer's name; "Booking fee, booking K7Q4AB, [shop], [dates]"; the amount and currency; the method and last four digits; and a line that the rental itself is paid to the shop. A refund sends a refund note that names the receipt. Whether this may be a plain receipt, and what changes once Mango Works is VAT-registered, is Korn's (§11.2 K1).

### 4.7 The fee inside the shop's order

The renter's ฿2,880 booking is ฿288 to Moto Mangos and ฿2,592 to the shop. The platform's order for it must say so, or its balance stays ฿288 short for ever, it never reads as settled, and Phase 3's auto-archive never runs.

Recommended (§10 change 5, §11.1 decision 6): the order's `booking` charge carries **a line of its own kind, `marketplace_fee`, negative, for the fee**, written by `create_booking` from the fee the marketplace reports, fixed like the fee. The shop's charge total is then what the shop collects, and the shop's tax invoice is for what the shop is paid. The other way to do it (the shop's sale is the full ฿2,880 and Moto Mangos "collected" ฿288 of it as the shop's commission) would make Mango Works bill every shop a commission and contradict "Moto Mangos takes only the customer's booking fee". Which of the two the shop's VAT follows is Korn's (§11.2 K2), and matters most for a shop that adds VAT on top.

## 5. Webhooks and idempotency

### 5.1 Endpoints

| Endpoint | App | Receives | Secret |
| --- | --- | --- | --- |
| `/api/webhooks/stripe/connect` | Platform | Events of connected accounts (each has a top-level `account`) [S15] | Its own |
| `/api/webhooks/stripe/account` | Platform | Mango Works' own account: vendor billing | Its own |
| `/api/webhooks/stripe` | Marketplace | Moto Mangos' account: the fee | Its own |

Each endpoint is registered for the event types it handles and no others.

| Subject | Events |
| --- | --- |
| Account | `account.updated`, `account.application.deauthorized` |
| Payment | `payment_intent.succeeded`, `.payment_failed`, `.canceled`, `.requires_action`, `.amount_capturable_updated`; `charge.captured`, `charge.expired` |
| Saved card | `setup_intent.succeeded`, `setup_intent.setup_failed`, `payment_method.automatically_updated`, `payment_method.detached` |
| Refund | `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded` |
| Dispute | `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated` |
| Payout (information only) | `payout.failed` |

### 5.2 Intake

1. Read the **raw body**; verify the signature with the endpoint's secret (HMAC-SHA256 over timestamp and body, constant-time compare, 5-minute tolerance) [S16]. A bad signature answers 400 and stores nothing.
2. **Live or test:** a production endpoint also receives test events for Connect [S15]. An event whose `livemode` does not match the environment is refused.
3. Insert into the store, `on conflict do nothing` on `(provider, event_id)`.
4. Answer 200 at once. No business logic runs in the request [S16].

For a provider whose webhooks carry no signature, steps 1 and 2 cannot prove the sender, so the event is only ever a prompt: the worker fetches the object from the provider with our own credentials before believing anything. That is the worker's rule for every provider in any case.

### 5.3 The store and the worker

```text
platform.webhook_events          (no tenant can read it; service role only)
  id, provider, event_id         unique (provider, event_id)
  endpoint, account_ref          whose event; resolved to payment_account_id and tenant_id when known
  type, livemode, object_type, object_ref
  payload jsonb, received_at
  status      received | done | skipped | failed
  attempts, last_error, processed_at
```

The worker runs straight after intake and again from a job every minute for anything left `received` or `failed`.

1. Claim a row (`for update skip locked`).
2. Resolve the account. An event for an account we do not know is `skipped`.
3. **Fetch the object from the provider** as that account. The event's own payload is not used for money.
4. Take the object's lock: `provider_payments` (or `refund_requests`, `provider_disputes`) row by provider reference, `for update`. This is what makes two events for one object take turns.
5. **Bring our records to the fetched state** (§5.4): update the provider row; if the state means money moved and the ledger has no row for it yet, write it. Every step is "make it so", so running it twice changes nothing.
6. Mark `done`. On an error: `failed`, with a retry later; after 10 attempts a platform alert.

**Ordering.** Stripe does not deliver in order and may deliver twice, and may make two events for one change [S16]. Because step 3 reads the object's present state, an old event arriving late simply finds everything already done.

**Replay.** Any stored event can be run again by id (a platform-admin action, audited); it goes through the same worker. If our endpoint was down, Stripe retries for up to three days [S16]; past that, the reconciliation job (§5.6) finds what was missed.

### 5.4 Provider records (mutable) beside the ledger (append-only)

```text
provider_payments    one per payment we asked a provider for
  id, tenant_id (null for Mango Works' own), payment_account_id, order_id
  purpose       payment | deposit_hold | deposit_charge | fee | vendor_invoice
  charges jsonb which order charges it is for, and how much each
  amount, currency, method, provider, provider_ref (unique per provider)
  state         §2.4's words
  capture_before, amount_captured, fee, card brand / last four
  requested_by, expires_at, link token hash
refund_requests      one per refund decided: payment, charges, amount, reason, who, state, provider_ref
provider_disputes    one per dispute: payment, amount, reason, state, respond_by, funds withdrawn / returned
```

These rows change as the provider's state changes. They never hold a balance and nothing sums them for money: the ledger is the only place money is counted.

### 5.5 Idempotency

| Where | How |
| --- | --- |
| Our calls to the provider | The `Idempotency-Key` header is our own row id (and attempt number for a scheduled charge). Stripe keeps a key at least 24 hours and returns the first answer, even an error [S17]. A retry after that window fetches the object by its stored reference first and never creates again blind |
| Events in | Unique `(provider, event_id)` in the store |
| The ledger | A unique index on `(provider, provider_ref, kind)` for provider rows (§10 change 6): the same provider payment can never produce two `payment` rows, whichever of the worker, the page's own return call, or the reconciliation job gets there first |
| Staff and API calls to us | Phase 3's `idempotency_key` on `record_payment` and `record_refund`, unchanged |
| Tax document numbers | Taken in the same transaction as the ledger row (§6.2), so a row written once is numbered once |

### 5.6 Reconciliation

A daily job per payment account, and Mango Works' own accounts:

1. Lists the provider's payments, refunds and disputes since the last run (with an overlap of two days), page by page.
2. For each, runs the worker's step 4 to 5. Anything it has to change is logged as "missed by webhooks".
3. Compares totals per day and method: provider payments confirmed, less refunds, against the ledger's provider rows. A difference opens a `reconciliation_issues` row (account, day, what differs), shown to the platform admin and, for a shop's account, to the owner.
4. Looks the other way too: a ledger provider row whose provider object cannot be found, or is in a state that contradicts it, is an issue, never auto-corrected.
5. Refreshes the account's capabilities and requirements.

It also sweeps for what is stuck: a `provider_payments` row `processing` for more than 15 minutes, a `scheduled_charges` row `running` for more than an hour, a refund `pending` past 10 business days.

## 6. Tax documents

Printing and numbering are Phase 6's. This section fixes what each payment must carry so that Phase 6 can print it, and what Thai law asks for. Sources marked [T…] are the Revenue Department's own pages unless marked secondary; they were read through a tool that summarises, so **Korn checks every rule here before Phase 6 builds on it** (§11.2).

### 6.1 What Thai law asks for

| Rule | Finding | Source |
| --- | --- | --- |
| When | For a service, VAT is due when payment is received (or earlier, when a tax invoice is issued or the service is used); for part payments, at each payment. The seller issues a tax invoice at that moment. This is the settled "every payment gets its own tax invoice" | [T1][T2] |
| Full tax invoice | The words "tax invoice" (ใบกำกับภาษี), prominent; seller's name, address and tax ID; **"head office" or the branch number**, as on the seller's VAT certificate; buyer's name and address; serial number (and book, if any); description, quantity and value; the VAT shown separately; the date | [T3][T4] |
| Buyer's tax ID and branch | Only when the buyer must have a tax ID; the buyer's branch only when the buyer is VAT-registered. Nothing is said about foreign tourists | [T4] |
| Language and money | Thai or English; amounts in baht. Another language or currency needs approval | [T5] |
| Receipt and tax invoice together | Allowed: a tax invoice that shows payment received serves as the receipt (ใบเสร็จรับเงิน/ใบกำกับภาษี) | [T5][T6] |
| Abbreviated tax invoice | For retail and small services to many people; no buyer details; the price must say VAT is included; a full one whenever the buyer asks. Rental is not among the examples: **unclear** whether a rental shop may use it | [T7][T8] |
| Credit note | Allowed for listed reasons, among them: a price reduced because the service fell short, **an advance, deposit or reservation money returned**, and a service contract cancelled because no service was given. It must show the original tax invoice's number and date, the original value, the right value, the difference and the VAT on it, and the reason. Issued in the month of the event (the next month if need be). One note may cite several invoices. A clerical mistake is **not** a credit note: it is cancel-and-reissue | [T9][T10] |
| Cancel and reissue | The wrong invoice is marked cancelled and kept; a new one gets a **new number and the original's date**, with a note that it replaces number so-and-so | [T5][T11] |
| Numbering | The law says "serial number". No text found that says the series must have no gaps (**unclear**); receipts run in order through the calendar year. Practice: one unbroken series per document kind, never reused, a cancelled number kept as cancelled | [T3][T12] |
| Not VAT-registered | Must not issue a tax invoice or credit note (and owes the VAT shown if it does); issues a receipt only | [T3] |
| Receipt | Issued at once on every payment: issuer's tax ID and name, book and number, date, amount, what was sold. Copies kept 5 years | [T6] |
| VAT rate | 7% until 30 Sep 2027 by decree (secondary sources); the statute's rate is 10%. Registration above ฿1.8 million a year | [T13][T14] |
| Keeping | Tax invoices and reports at least 5 years | [T15] |
| Electronic documents | A tax invoice sent as a file needs one of the Revenue Department's electronic schemes (e-Tax Invoice & e-Receipt, or "by Time Stamp" for smaller businesses). Whether a plain PDF sent by email counts without them is **unclear**, and probably not | [T16][T17] |
| **Deposits** | Departmental Order Por.73/2541 puts an advance, **security deposit**, earnest money or reservation money for rental of anything other than land and buildings **inside VAT when it is received**, with a credit note when it is returned. The only exceptions it makes are container deposits and deposits on rented land and buildings | [T18] |
| Withholding | A company paying rent for a vehicle withholds 5%; for a service 3%; for advertising 2%; when the contract is ฿1,000 or more. The payer gives a certificate (50 Tawi) | [T19][T20] |

**The deposit finding goes against a settled decision** ("deposits carry no VAT until kept", and the Products redesign's "deposits are never taxed"). This design does not reopen the decision; it records that the Revenue Department's own order reads the other way for a deposit a VAT-registered shop is **paid** (cash, transfer, a charged card), that no ruling was found for vehicle rental in particular, and that a card **hold**, where no money is received, is not addressed by the order at all. It is Korn's first question (K3), and it should be answered before Phase 3's ledger stage is built, because it decides whether a `deposit_in` row carries VAT and a tax invoice (§10 change 9).

### 6.2 Numbering

- **One series per shop, per document kind, per issuing establishment** (head office or a branch; one today): tax invoice (or receipt/tax invoice), credit note, and for a shop that is not VAT-registered, receipt. Mango Works has its own series for vendor billing, and Moto Mangos' fee receipt its own. Order numbers are a separate series with gaps (Phase 3 decision 11).
- **No gaps, by construction.** A `document_counters` row per (tenant, kind, establishment, year or none). The number is taken under that row's lock **in the same transaction that writes the ledger row and the document row**, and it is the last lock the transaction takes (as Phase 3 does for order numbers). A transaction that fails takes no number. Nothing ever deletes or renumbers a document.
- **Format** is the shop's setting (prefix, year, width: `INV-2026-00042`); the stored value is the integer and the series.
- **When** a provider payment is confirmed by the worker, the number is taken then. The document's date is the payment's `received_at` (the provider's time, in the shop's time zone), not the time the webhook was processed. Numbers are therefore in order of recording; dates can be seconds apart from that order. Whether that is acceptable is K7.
- **A voided document keeps its number**, marked cancelled, with a pointer to what replaced it. A replacement takes a new number and the original's date [T5].
- Tests: 50 payments at once give 50 consecutive numbers; a failed payment transaction leaves no hole; two branches never share a series.

### 6.3 What each payment row must carry

Phase 3 already stores, on the payment: the amount, currency, method, `received_at`, and the net and VAT per rate group worked out once on the payment's total (`paymentVat`). For the document, each payment must also be able to give:

| Data | From | Note |
| --- | --- | --- |
| The seller as it was that day: legal name, address, tax ID, head office or branch number, VAT-registered or not | Copied into the document row when it is made | A shop's later change of address must not change an old invoice |
| The buyer: name and address; tax ID and branch when a business | The order's customer, copied the same way | Phase 3's customer record has no address or tax ID. Phase 6 adds them (or Phase 4); a company customer must be able to give them before paying |
| What was paid for | The lines of the charges the payment is allocated to | For a part payment: the charge and "part payment" with the amount |
| Rate groups: rate, net, VAT, gross | `payments.rate_groups` | Shown once at the bottom (decision 27) |
| Method, and for a card the brand and last four | The payment and `provider_payments` | |
| Whether prices included VAT | The charge's snapshot | |
| For a credit note: the original document's number and date, the original value, the right value, the difference and its VAT, the reason | The refund's `refund_of_payment_id` (§10 change 2) and its reversing allocations | This is why a refund must name its payment |
| Language | The shop's document language (Thai or English); amounts in the shop's currency | Baht for a Thai shop [T5] |

**Rows that get no tax invoice:** a card hold placed or released (no money); a payment by a shop that is not VAT-registered (a receipt instead); and, as decided, a deposit received, pending K3.

**Other countries.** Everything above is the Thai tax profile. The document kinds, the required fields and the numbering rule belong to the country tax profile the spec already names; no code may assume them.

## 7. Vendor billing (Mango Works as the seller)

Mango Works bills shops for subscriptions and Featured placement. Here Mango Works is the merchant and the shop is the customer; none of this touches a shop's own ledger.

### 7.1 What Stripe offers in Thailand

| Route | Available | Source |
| --- | --- | --- |
| Card, saved and charged each month | Yes (Visa, Mastercard) | [S35][S24] |
| PromptPay QR | Yes, one QR per invoice; cannot be saved or charged automatically | [S22][S35] |
| Bank transfer through Stripe | **No**: Thailand and THB are not on the list | [S36] |

So the settled "manual mark paid with a slip" route is the only way to take a bank transfer, and PromptPay subscribers pay each month by hand.

### 7.2 The record is ours; Stripe only collects

Recommended (§11.1 decision 11): Mango Works keeps its own invoices, payments and credits, and uses plain Stripe payments (a saved card, a PromptPay QR) to collect. Stripe Billing is not used. Reasons: the Thai tax invoice and its numbering must be ours whatever collects the money; a payment net of 3% withholding, a slip-backed transfer and prepaid credits are all outside what a Stripe subscription models; and Stripe Billing adds 0.7% of billed volume [S19]. The spec's Tech stack line ("Stripe Billing for SaaS subscriptions") would change.

```text
platform_billing.*          owned by Mango Works; a shop's owner reads its own rows; only platform finance writes
  plans, subscriptions      tenant, plan, period, status (trial | active | past_due | paused | canceled), next_invoice_at
  invoices                  tenant, number, period, lines, net, VAT, total, currency, due_at, status (open | paid | void)
  invoice_payments          append-only: invoice, method (card | promptpay | transfer), amount received,
                            withholding amount and certificate file, slip file, received_at, recorded_by, provider_ref
  credit_ledger             append-only: tenant, top_up | boost_spend | refund | adjustment, amount, balance after
  documents                 tax invoices and credit notes, numbered per §6.2 in Mango Works' own series
```

### 7.3 Flows

- **Monthly subscription.** The invoice is made on the renewal date. A shop with a saved card is charged (the §3.5 runner, on Mango Works' account); others get the invoice by email with a PromptPay QR for the amount and the invoice reference, and the bank details for a transfer.
- **PromptPay.** Paying the QR marks the invoice paid automatically through the webhook.
- **Bank transfer.** Finance opens the invoice, enters the amount, date and bank reference, attaches the slip, and marks it paid. Every manual entry records who made it.
- **Withholding.** A business vendor ticks "we withhold tax" on the invoice page. The amount to pay, and the QR, drop by the withholding (3% of the net, before VAT; rate per §11.2 K10); the payment is recorded as amount received plus amount withheld, and the invoice is paid when the two reach its total. The certificate is uploaded then or chased later; an invoice paid net with no certificate after 30 days is listed for finance. Offered only to vendors recorded as businesses with a tax ID.
- **Prepaid credits for boosts.** A top-up is a payment (QR, card or transfer) that adds to the credit ledger; a boost spends it when it starts; a boost is refused when the balance is short. Whether the tax invoice belongs to the top-up or to each boost is Korn's (§11.2 K11).
- **Tax documents.** Every vendor payment gets a tax invoice from Mango Works; a refund gets a credit note; same numbering rules as §6.2, in Mango Works' own series.
- **Grace.** An invoice unpaid at `due_at` makes the subscription `past_due`; reminders at 3 and 7 days; after the grace period (default 14 days) it is `paused`: **paid features only** are switched off (the modules above the free Marketplace plan, Featured placement). Bookings, the calendar, the staff app and taking payments never stop. Paying the invoice restores everything at once.
- **Refunds and disputes** on vendor payments follow §3.7 and §3.8 on Mango Works' own account.

## 8. Security and compliance

### 8.1 Card data (PCI)

- Card numbers are entered only into the provider's own fields: Stripe's Payment Element or Checkout, loaded from `js.stripe.com` and never bundled or self-hosted [S34]. No card number, expiry or CVC reaches our servers, logs, database, error reports or support chat. Brand, last four and expiry month are the only card details stored [S34].
- That keeps Mango Works, and each shop, at the lightest self-assessment (Stripe's guide maps Checkout and Elements to SAQ A [S48]; the Payment Element is not named on the pages read: **unclear**, §11.3 question 8). Mango Works completes its own attestation each year in the Stripe Dashboard; each shop does its own.
- No screen has a "type the card number for the customer" field. Staff taking a card at the desk hand the customer the form, on the shop's device or by link.
- Error reporting (Sentry) scrubs request bodies on payment routes; the support chat already masks card-like numbers.

### 8.2 Keys and secrets

| Secret | Where |
| --- | --- |
| Mango Works' Stripe secret keys (one per Stripe account), test and live | The host's environment variables, per app and per environment. Never in the repo, never in a `NEXT_PUBLIC_` variable, never logged. Live keys only in the live environment |
| Webhook signing secrets | The same, one per endpoint |
| A shop's Stripe account | Only its account id is stored. There is no shop secret: the platform's key acts for the account |
| A shop's keys for a provider with no platform model (§1.4) | Encrypted in the application before storage (AES-256-GCM, a fresh nonce per value, the key id beside it), with the master key in the environment and a documented rotation. In a table no signed-in role can read; decrypted only inside `@mango/payments`. Not Supabase Vault, so the move to Neon does not touch it |
| Publishable keys | Public by design |

- Where the provider offers restricted keys, the platform uses one limited to what the adapter calls.
- Rotation: Stripe keeps a rolled webhook secret valid for a time [S16]; the runbook rolls one secret at a time and checks intake before the next.

### 8.3 Webhook trust

Signature on the raw body, 5-minute tolerance, live/test match, and then the fetch-before-believe rule (§5.2, §5.3). The endpoints accept POST only, are excluded from session handling, and are rate-limited.

### 8.4 Tenant isolation

- **The account is never chosen by the browser.** Every provider call starts from the tenant the server has already authorised, looks up that tenant's `payment_accounts` row, and builds the adapter from it.
- **An event's account decides its tenant**, by lookup in `payment_accounts`. Order ids and tenant ids in a provider object's metadata are hints for humans; the worker checks that the object's account and the order's tenant agree, and refuses when they do not.
- **RLS:** `payment_accounts` (no secret columns), `customer_payment_methods`, `provider_payments`, `refund_requests`, `provider_disputes`, `scheduled_charges`: read by owner, manager and staff of that tenant through the `my_tenant_ids()` helpers, written by functions only. `webhook_events`, `reconciliation_issues` and the encrypted-credential table: no signed-in role at all. Each new table ships its fixture row per tenant and its cross-tenant tests; each new function starts with `revoke all … from public, anon`.
- **Roles:** connecting or disconnecting an account is owner-only. Refunds follow `staff_can_refund`. Mechanics and drivers see no payment data.
- **Payment links** carry a random token (stored hashed), show only what the payer needs (shop, order code, amount), and expire.
- **Audit:** connecting an account, every refund request, every capture and release, every manual vendor payment and every webhook replay write an audit event with who did it. Customer contact details stay out of audit snapshots, as now.
- **Money moved by a job** (a scheduled charge, an at-expiry capture) is recorded with the job as the actor and the setting that authorised it.

### 8.5 Abuse

- Amounts are always worked out on the server from the order.
- A card-testing guard on public payment pages: attempts per link and per address are limited, and Stripe's own Radar rules stay on.
- A customer's saved card can be charged only for an order of that customer, for an open charge, by a function that checks both.

## 9. Phase 7 in stages, and what Phase 8 adds

One PR each. Stripe test mode only; migrations local until Mark says otherwise. **Fable build** for anything that moves or counts money, takes locks or decides isolation; **Opus + Fable check** for screens.

| # | Stage | Model | Accept tests |
| --- | --- | --- | --- |
| 1 | **Tables and ledger additions**: `payment_accounts`, `customer_payment_methods`, `provider_payments`, `refund_requests`, `provider_disputes`, `scheduled_charges`, `webhook_events`, `reconciliation_issues`; the ledger's provider index and any Phase 3 change not yet in (§10) | Fable build | Isolation for every table (5 roles × 2 shops, stranger, Moto Mangos customer, anon); `default-grants`; no signed-in role reads `webhook_events`; one live account per tenant and provider; a second ledger row for one provider reference and kind is refused |
| 2 | **`@mango/payments`**: the interface, the fake provider, the Stripe adapter, the contract suite | Fable build | The contract suite passes on the fake and on Stripe test mode; a call with no account cannot be made (type and run time); ESLint refuses `stripe` outside the package; an unsupported capability answers `not_supported` |
| 3 | **Connect onboarding and Settings › Payments** | Opus + Fable check | In test mode: create, leave half-way, return, finish; `account.updated` turns card and PromptPay on; requirements due are shown with their deadline; a non-owner cannot connect; deauthorization switches online payment off and stops scheduled charges; 375 px, English and Thai |
| 4 | **Webhook intake, store, worker, replay, reconciliation** | Fable build | Bad signature: 400, nothing stored; a test event on a live-configured endpoint refused; every event sent twice: one effect; a full payment's events in every order: the same end state; an event for an unknown account skipped; replay by id changes nothing; with webhooks switched off, the daily job alone brings the ledger level and logs what it found; a ledger row with no provider object raises an issue |
| 5 | **Pay now**: card and PromptPay on the order page, payment links, down payments | Fable build (server), Opus + Fable check (screens) | Test cards: plain success, 3-D Secure passed, 3-D Secure failed, declined. PromptPay test payment. Ledger row, allocation and `paymentVat` equal to the same payment recorded as cash; two browser tabs paying one request: one payment; a payment arriving after the order is cancelled, and a second payment on one QR, each become credit with a staff item; link expiry; amount re-read when a charge changed |
| 6 | **Refunds** | Fable build | Full and partial card refunds; a refund over what is left on the payment refused; the ledger row appears only when the provider confirms; a PromptPay refund waiting on the customer shows so; a refund that fails before and after it was recorded (the `reversal` row); `staff_can_refund` off refuses in the database before any provider call; the refund's VAT is that of what it reverses |
| 7 | **Saved cards and scheduled charges** | Fable build | Consent stored with its text version; charge at the due time in a daylight-saving shop; the amount is what is open at run time; authentication-needed card: `action_needed`, link confirms the same payment; retryable decline: attempts at +12, +24, +48 hours and no fifth; a stop code: no retry; two runners, one charge; order cancelled between claim and charge: no charge; unknown answer then the same key: one payment; the deadline puts the order on the Late tab |
| 8 | **Deposits by card**: authorize or charge, capture, release, at-expiry job | Fable build | `capture_before` stored from the charge; hold refused for a rental that does not fit and charge offered instead; capture part: `deposit_capture` + `payment` + `deposit_release` add up to the hold; release; expiry event recorded as a release; the job acts 6 hours before the deadline and only once; an extended rental raises the "hold ends before return" item; "deposit held" excludes holds |
| 9 | **Disputes, cancellation fee, wrap-up**: dispute records and alerts, the `chargeback` and `reversal` rows, the cancellation-fee setting, help articles (Fable checks them), the demo seed, doc edits | Opus + Fable check; ledger rows Fable | A test dispute: alert with the deadline, balance up by the amount; won: restored; refund refused while a dispute is open; the cancellation fee kept as its own charge with VAT |
| 10 | **The Moto Mangos fee rails** (no checkout yet): the fee record's charge, schedule, retry, deadline, refund, receipt, on Moto Mangos' account, behind the marketplace's fee functions | Fable build | Every row of §4.4 and §4.5 against `fee-lifecycle.ts`, in THB and a zero-decimal currency, in a daylight-saving zone; fee never taken from the browser; a refund reverses the referral earning; receipt numbers gapless under 50 parallel payments |

Order: 1 → 2 → 3 and 4 (either first) → 5 → 6 → 7 and 8 (either first) → 9; 10 needs 2, 4 and 6 and the 3M switch.

**The spec's accept line** ("pay, scheduled charge incl. 3-D Secure failure, hold, partial capture, refund; webhook replay is safe") is covered by stages 4 to 8.

**Not truly testable in Phase 7:** real bank behaviour (a live PromptPay refund asking the customer for details; a real issuer's 3-D Secure; how long a released hold stays on a statement); a real dispute; Stripe's review of a real Thai rental shop's account. One live-mode payment, hold, capture and refund of a small amount on BSR's account is done by hand before Gate A.

**Not in Phase 7:** vendor billing (built with Phase 11's plans, on these rails), Featured placement billing (when ranking is built), monthly auto-charge for long rentals (Phase 9, the stage 7 runner with a new schedule), traffic-fine charges (Phase 9), the Omise adapter and any Vietnam provider (on demand), answering disputes in the app, Tap to Pay.

### What Phase 8 (online booking) adds

- **The public checkout** on the booking page: pay now, pay later (card saved, charged before pickup) or pay at pickup, per the shop's settings and the account's capabilities; a down payment at booking.
- **Paying inside a hold.** A checkout holds the vehicle (Phase 3's `new` order) while the customer pays; payment success confirms the order through the worker, not the browser's return. Money that arrives after the hold ran out: reserve again if the vehicle is still free, otherwise refund in full automatically and tell the customer. This is the one automatic refund in the system, and it needs the QR clock of §3.3.
- **Wallets** (Apple Pay, Google Pay) through the same card form, with the domain registered per connected account.
- **The Moto Mangos checkout** on stage 10's rails: card saved or PromptPay paid, the two-seller wording of §4.1, the `fees.ts` changes Phase 3 §7.3 lists.
- **Deposit choice shown to the renter** before booking: what is held or charged, and when it comes back.
- **Conversions:** the "fee paid" and "booking paid" events sent from the server when the ledger row is written.
- **Guards** for a public page: rate limits, bot checks if needed, no account required to pay a link.

## 10. Changes for Phase 3's plan now

Phase 3's ledger is append-only and its first migration has not been written. These are cheaper on paper than as corrections to rows that can never be edited. Section numbers are `docs/phase-3-plan.md` draft 2.

| # | Change | Why | Where |
| --- | --- | --- | --- |
| 1 | **"No overpayment" binds staff entry only.** The refusal moves from the ledger's core into the staff-facing `record_payment`. A core that the system calls records any amount a provider confirms; what no open charge needs stays **unallocated** on the payment and counts as the customer's credit. A provider payment is recorded whatever the order's status (cancelled, archived: it is un-archived and flagged) | Money a provider has taken cannot be refused. A PromptPay QR can be paid twice; a link can be paid after the order changed [S22] | §6.4 "three rules"; stage 3 tests |
| 2 | **A refund names the payment it refunds**: `payments.refund_of_payment_id` (required for a refund to a card or QR; optional for cash), with refunds on one payment never exceeding it. It still names the charges it reverses | A provider refunds a payment, not a charge [S30]. And a credit note must cite the tax invoice it corrects, which is the payment's (§6) | §6.4 `payments`; `record_refund` |
| 3 | **Reversal rows**: a column `reverses_payment_id` (unique) and two more kinds, `reversal` and `chargeback`. A `reversal` undoes the row it points at (a refund or deposit return the bank later failed; a chargeback that was won) and its allocations. A `chargeback` takes a payment back: the balance rises and its charges read unsettled. The balance formula gains both | The ledger cannot be edited, and providers do reverse things after the fact [S30][S18] | §6.4 kinds and "Balance ="; §2.3 (archive needs no open chargeback) |
| 4 | **A card hold is not money.** Write down: `deposit_hold` and `deposit_release` never enter the balance or "deposit held"; a hold's rows satisfy hold = captures + releases; "deposit held" = `deposit_in` − `deposit_out` − captures of charged deposits. `deposit_capture` gets a nullable `deposit_payment_id` pointing at the `deposit_in` or `deposit_hold` it draws on | Phase 3 creates the kinds for Phase 7 without saying how they count; a cash-close or report built in between would count holds as cash | §6.4 |
| 5 | **A Moto Mangos order shows the fee paid online**: `order_lines.kind` gains `marketplace_fee` (a negative line in the `booking` charge, written by `create_booking`, fixed at booking, removed with a cancellation). Decision 6 below; VAT treatment with Korn (K2) | Otherwise every marketplace order is short by the fee for ever, never settled, never auto-archived | §3.2 `order_lines.kind`; §7.2, §7.3 |
| 6 | **Provider rows are unique and need no staff member**: a unique index on `(provider, provider_ref, kind)` where `provider` is set; `recorded_by` nullable with a `source` column (`staff`, `provider`, `job`); `received_at` passed in by the caller (the provider's time of payment, which dates the tax invoice), never defaulted to now for a provider row | Webhooks, the page's return call and the reconciliation job can all try to record one payment; none of them is a signed-in member | §6.4 `payments`; S6 |
| 7 | **The system can call the ledger cores.** `record_payment`, `record_refund` and `record_deposit` are split like the order functions: a `platform_private` core (callable by the service role for a provider-confirmed row, with no `staff_may` check and no overpayment refusal) and the staff wrapper that checks role, setting and overpayment | Phase 7's worker has no member to act as; today's plan checks `staff_can_refund` inside the one function | §3.3 table; §3.9 |
| 8 | **Leave room in two lists**: `payments.method` accepts `card` and `promptpay` from the start (unused until Phase 7), and `order_charges.kind` gains `cancellation_fee`. Optional, for the same reason: a `withholding` payment kind (a company customer that pays a shop net of withholding tax settles its charge with a certificate, not money; rate with Korn, K10) | Each is a check-constraint change on a table that cannot be rewritten; cheaper to name now | §3.2, §6.4 |

| 9 | **Do not build "a deposit has no VAT" into the table.** Keep `rate_groups` allowed (nullable) on `deposit_in` and `deposit_out` rows, and keep the "no tax invoice for a deposit" rule in one function, until Korn answers K3. If the answer is that a paid deposit is taxed on receipt, `deposit_in` gets a tax invoice and `deposit_out` a credit note, and nothing already written needs to change | Por.73/2541 [T18] reads against the settled rule; rows written without VAT can never be given it | §6.4; stage 3 |

Two notes that need no change, only care: `order_charges.due_at` is all scheduled charges need (§3.5); and Phase 3's rule that a tax invoice follows each payment holds for provider payments as written, with the one open point of an unallocated remainder (K4).

## 11. Open decisions

### 11.1 For Mark

Each with options and a recommendation.

1. **Connecting a shop that already has a Stripe account** (BSR's is tied to Booqable). (a) A new account under the shop's Stripe login, made through our onboarding link. (b) OAuth to the existing account. **Recommend (a):** OAuth is no longer recommended by Stripe for new platforms and shares the data we create with the shop's other platforms [S8]; the cost is filling Stripe's form once more.
2. **One Stripe account for Mango Works, or two.** (a) One for everything. (b) "Mango Works" (Connect platform, vendor billing) and "Moto Mangos" (the fee). **Recommend (b)**, if Stripe allows it (question 7): one brand on the renter's checkout, receipt and statement, and consumer disputes kept away from the platform account.
3. **Visa and Mastercard only.** Thai Stripe accounts cannot take Amex, JCB or UnionPay [S24], which some Japanese, Chinese and American renters carry. (a) Accept for Phase 7 and watch BSR's declined and abandoned payments. (b) Bring a second provider forward (Omise lists all five brands [O2], with the limits in §1.4). **Recommend (a).**
4. **"72 hours" or "3 calendar days at the pickup's clock time".** The code and the 9 Nov decision say calendar days; this brief says 72 hours. The same in Thailand; an hour apart twice a year where clocks change. **Recommend calendar days** (it matches the shop's own charge-before setting, in days, and "the same time, three days earlier" is what a customer expects), written to customers as "3 days before pickup".
5. **A fee paid by PromptPay at booking and cancelled in time.** (a) Refund it (costs about ฿11 on a ฿50 fee, and may wait on the customer's bank details). (b) Give Moto Mangos credit for a later booking. **Recommend (a)**, and put the card first at checkout for pickups more than 72 hours away, since a card is charged only after free cancellation has ended.
6. **The fee inside the shop's order.** (a) A negative `marketplace_fee` line: the shop's sale is what the shop collects. (b) A "paid to Moto Mangos" payment: the shop's sale is the full price and Moto Mangos kept a commission. **Recommend (a)**, subject to Korn (K2). It decides §10 change 5.
7. **When a card deposit hold is taken.** (a) Only with the customer present, at pickup. (b) Also from a saved card before pickup. **Recommend (a):** it gets the longer window and the customer sees it happen; (b) can be 4 days 18 hours on Visa [S28]. With (a), a hold is offered for rentals of up to about 6 days and anything longer is charge-and-refund.
8. **What a hold does when it reaches its end with no decision.** (a) Release. (b) Capture. **Recommend (a) as the default**, changeable per shop and per order as already decided: taking a customer's money by default, with a fee if it is then returned, should be a choice.
9. **Scheduled charge retries.** **Recommend:** the first attempt, then +12, +24 and +48 hours (four in all), none after a stop code or a request for authentication, none past the deadline; the shop sets the deadline (default 24 hours after the first failure) and whether the booking is then cancelled (default: no, flagged). Moto Mangos' fee keeps its own rule (retry at 12 hours, cancel 2 days before pickup).
10. **Disputes in Phase 7.** (a) Record, alert, link to the shop's Stripe Dashboard. (b) Also submit evidence from the app. **Recommend (a) now**, (b) after Phase 5 exists.
11. **Vendor billing.** (a) Our own invoices and ledger, Stripe to collect. (b) Stripe Billing as the record. **Recommend (a)** (§7.2); it changes one line of the spec's Tech stack.
12. **Omise.** Build only when a Thai shop cannot use Stripe, or when card-brand cover (decision 3) is shown to cost bookings. **Recommend: not in Phase 7**; the interface and contract tests are what Phase 7 owes it.
13. **Stripe's own receipt emails: off**, ours only. **Recommend off**, so a customer gets one message with the tax invoice.
14. **Money a provider took that the order did not need** (a second QR payment, a payment after cancellation). (a) Keep as credit with a staff item to refund. (b) Refund automatically. **Recommend (a)** for shop orders, since each refund costs the shop a fee and staff may prefer to apply it; **automatic refund only** for an online checkout whose hold ran out (Phase 8) and for the Moto Mangos fee.
15. **The cancellation fee setting.** **Recommend:** default as the settled rule (free until 72 hours before pickup, nothing back after), with a shop able to set a percentage or amount kept and its own cut-off; Moto Mangos bookings always use Moto Mangos' rule for the fee and the shop's for the rental.
16. **The Stripe risk check.** Send §11.3's questions before Phase 7 is scheduled. **Recommend treating question 1 as a gate:** if Stripe will not support rental shops through Connect in Thailand, Phase 7's first provider changes.

### 11.2 For Korn (tax)

- **K1. The Moto Mangos fee document** (Phase 3 decision 26). While Mango Works is not VAT-registered a receipt is all it may issue [T3]. Once registered, the law asks for a tax invoice for every service [T1], with the abbreviated form only for retail-type businesses [T7][T8]. Is a plain receipt right now, and what must the fee document become on registration: a full receipt/tax invoice, or an abbreviated one?
- **K2. A shop's VAT on a Moto Mangos booking.** The renter pays 10% to Moto Mangos and 90% to the shop. Is the shop's taxable sale the 90% it receives, or the full price with the 10% as a commission it paid? For a shop that adds VAT on top, on which amount is the VAT worked out, and is the fee's base (the price before VAT) still right?
- **K3. Deposits and VAT.** Por.73/2541 reads as: a security deposit on a rental of movable property is inside VAT when received, with a credit note on return [T18]. (a) Does that apply to a refundable damage deposit on a short vehicle rental, in cash or by a charged card? (b) Is a card hold, where no money is received, outside VAT until it is captured? (c) Is money kept from a deposit for damage, a late return or a fine a taxable service, or compensation outside VAT? This decides whether "deposits carry no VAT until kept" can stand.
- **K4. Money received that no charge needs** (an overpayment, a second QR payment, the credit left when an order is cancelled): is a tax invoice due on receipt as an advance, and a credit note when it is refunded?
- **K5. Reversals.** A refund recorded and credit-noted that the bank later fails; a chargeback lost: which document corrects each, a debit note or a cancel-and-reissue?
- **K6. A cancellation fee kept by the shop:** a taxable service with its own tax invoice, or compensation?
- **K7. Numbering.** Is one unbroken series per kind and branch right; may the date printed (when the money was received) differ by seconds or minutes from number order; how is a cancelled number shown in the output tax report?
- **K8. The short form.** May a rental shop serving walk-in tourists issue abbreviated tax invoices, and with what approval? What buyer details are needed on a full one for a foreign tourist with no Thai address?
- **K9. Sending documents.** Is a PDF by email or LINE a valid tax invoice without enrolling in e-Tax Invoice & e-Receipt or the Time Stamp scheme? If not, which scheme should shops, and Mango Works, enrol in, and what must the platform produce for it?
- **K10. Withholding.** (a) A company renting a vehicle from a shop withholds 5% [T19]: confirm, and that the base excludes VAT. (b) A shop that is a company paying Mango Works: 3% on the subscription; is Featured placement advertising at 2% or a service at 3%? (c) Is the reduced rate for e-Withholding in force for 2026 and 2027?
- **K11. Prepaid boost credits:** is the tax invoice due at the top-up, or as each boost is used?
- **K12. Who issues.** The platform makes each shop's tax documents with the shop's own name, tax ID and series. Is anything needed for software to issue on a shop's behalf (an agent's authority, a notice to the Revenue Department)?
- **K13. Earlier questions still open** from the spec: the tax invoice fields the platform needs (Open decisions), and the Thai wording.

### 11.3 For the providers

To send to Stripe in writing; each is a point its pages leave unclear.

1. **Is short-term vehicle rental (motorbikes, cars) supported for connected accounts of a Thai platform**, with the Standard-equivalent settings and direct charges? "Transportation services" is restricted and on the Connect-in-Thailand list [S2][S3].
2. "Not applicable" in the application-fee column for a Thai platform with Thai accounts [S1]: confirm that no application fee can be taken. (We design for none.)
3. Can a Thai connected account have IC+ pricing, and with it extended authorization (30 days for vehicle rental)? [S29]
4. PromptPay: how long does a QR stay payable; does cancelling the PaymentIntent stop it; does an unpaid one ever emit a failure event; which refund flow applies to a normal QR payment and how long has the customer to answer; is the maximum 999,999.99 or 2,000,000 THB? [S22][S23]
5. Can a Thai platform clone a card saved on its own account to a Thai connected account for a direct charge? [S14]
6. Is Accounts v2 available to Thai platforms, or should controller properties on v1 be used? [S6]
7. May one Thai company hold two Stripe accounts (two brands), one of them a Connect platform?
8. Which self-assessment applies with the Payment Element? [S48]
9. Is there a time limit for refunding a card payment? [S30]
10. Is VAT added to Stripe's Thai fees, and how are they invoiced to a shop?

To send to Omise only if decision 12 brings it forward: is account chaining available in Thailand, and what may a chain key do; would a vehicle rental shop's account have 3-D Secure forced on, and can a saved card then be charged without the customer; how long does a hold last in Thailand; what does a repeated `ref_id` return; are webhooks ever retried [O5][O6][O8][O13][O14].

## 12. Doc edits this design will need

Not made in this PR; the owner keeps the specs.

- `docs/platform/SPEC.md`: Tech stack (Payments row, if decision 11 is accepted); Data model (`payments`, `scheduled_charges`, the new tables); Payments (Visa and Mastercard only; hold length read from the hold; PromptPay limits); Review decisions (the "about 7 days" wording).
- `docs/marketplace/SPEC.md`: PromptPay pays at booking for every booking (it still says a link is sent 3 days before); "3 days" against "72 hours" per decision 4.
- `apps/marketplace/CLAUDE.md`: it still says the fee is taken "via Stripe Connect as an application fee"; the fee is a separate charge on Moto Mangos' own account.
- `docs/INTEGRATION.md`: §3.12 `payment` (the later `full` mode is two charges, not an application fee); §5 (PromptPay requests).
- `docs/phase-3-plan.md`: §10 above.
- Root `CLAUDE.md`: when Phase 7 is built, where the ledger cores sit in the lock order (they take only the order row, as `record_payment` does today).

## 13. Sources

All read on 19 Nov 2026.

| Key | Page |
| --- | --- |
| S1 | https://support.stripe.com/questions/stripe-thailand-support-for-marketplaces |
| S2 | https://support.stripe.com/questions/businesses-stripe-cant-support-via-connect-in-thailand |
| S3 | https://stripe.com/en-th/legal/restricted-businesses |
| S4 | https://docs.stripe.com/connect/accounts |
| S5 | https://docs.stripe.com/connect/migrate-to-controller-properties |
| S6 | https://docs.stripe.com/connect/accounts-v2 |
| S7 | https://docs.stripe.com/connect/standard-accounts |
| S8 | https://docs.stripe.com/connect/oauth-standard-accounts |
| S9 | https://docs.stripe.com/connect/handling-api-verification |
| S10 | https://docs.stripe.com/connect/direct-charges |
| S11 | https://docs.stripe.com/connect/charges |
| S12 | https://docs.stripe.com/connect/disputes |
| S13 | https://docs.stripe.com/connect/saas/tasks/refunds-disputes |
| S14 | https://docs.stripe.com/connect/direct-charges-multiple-accounts |
| S15 | https://docs.stripe.com/connect/webhooks |
| S16 | https://docs.stripe.com/webhooks |
| S17 | https://docs.stripe.com/api/idempotent_requests |
| S18 | https://docs.stripe.com/disputes/how-disputes-work |
| S19 | https://stripe.com/en-th/pricing |
| S20 | https://stripe.com/en-th/connect/pricing |
| S21 | https://stripe.com/global |
| S22 | https://docs.stripe.com/payments/promptpay |
| S23 | https://support.stripe.com/questions/promptpay-faq |
| S24 | https://support.stripe.com/questions/supported-payment-methods-currencies-and-businesses-for-stripe-accounts-in-thailand |
| S25 | https://docs.stripe.com/payments/save-and-reuse |
| S26 | https://docs.stripe.com/payments/cits-and-mits |
| S27 | https://docs.stripe.com/declines/card and https://docs.stripe.com/declines/codes |
| S28 | https://docs.stripe.com/payments/place-a-hold-on-a-payment-method |
| S29 | https://docs.stripe.com/payments/extended-authorization |
| S30 | https://docs.stripe.com/refunds |
| S31 | https://support.stripe.com/questions/payment-blocked-due-to-excessive-retries |
| S32 | https://docs.stripe.com/connect/statement-descriptors |
| S33 | https://docs.stripe.com/receipts |
| S34 | https://docs.stripe.com/security/guide |
| S35 | https://docs.stripe.com/invoicing/payment-methods |
| S36 | https://docs.stripe.com/payments/bank-transfers |
| S37 | https://support.stripe.com/questions/payout-schedule-and-currency-for-stripe-accounts-in-thailand |
| S38 | https://docs.stripe.com/connect/merchant-of-record |
| S39 | https://support.stripe.com/questions/what-information-is-required-to-open-a-stripe-account-in-thailand |
| S40 | https://docs.stripe.com/payments/3d-secure/authentication-flow |
| S41 | https://docs.stripe.com/connect/express-accounts |
| S42 | https://docs.stripe.com/connect/platform-controls-for-stripe-dashboard-accounts |
| S43 | https://docs.stripe.com/strong-customer-authentication |
| S44 | https://docs.stripe.com/payments/payment-methods/payment-method-support |
| S45 | https://docs.stripe.com/api/events/types |
| S46 | https://docs.stripe.com/connect/cross-border-payouts |
| S47 | https://docs.stripe.com/connect/required-verification-information (the country lists behind this page) |
| S48 | https://stripe.com/guides/pci-compliance |
| O1 | https://omise.co/en/post/omise-unveils-bold-rebranding-and-ai-powered-innovations |
| O2 | https://www.omise.co/pricing/thailand |
| O3 | https://docs.omise.co/collecting-card-information |
| O4 | https://docs.omise.co/customers-api |
| O5 | https://docs.omise.co/charges-api |
| O6 | https://docs.omise.co/3d-secure and https://docs.omise.co/fraud-protection |
| O7 | https://docs.omise.co/charge-schedules-api |
| O8 | https://docs.omise.co/capture |
| O9 | https://docs.omise.co/does-omise-support-authorize-and-hold-only |
| O10 | https://docs.omise.co/promptpay |
| O11 | https://docs.omise.co/refunds-api |
| O12 | https://docs.omise.co/disputes |
| O13 | https://docs.omise.co/api-webhooks |
| O14 | https://docs.omise.co/api-authentication |
| O15 | https://docs.omise.co/account-api |
| O16 | https://docs.omise.co/transfers-api |
| V1 | https://payos.vn/docs/api/ |
| V2 | http://docs.zalopay.vn/docs/guides/payment-acceptance/authorize-payment/intro/ and http://docs.zalopay.vn/docs/guides/payment-acceptance/tokenization/card-token/ |
| V3 | https://developers.momo.vn/v3/docs/payment/api/credit/onetime/ (seen as search extracts only) |
| V4 | https://docs.xendit.co/docs/clone-cards.md and https://docs.xendit.co/docs/handling-webhooks.md |
| V5 | https://docs.dlocal.com/docs/vietnam.md |
| V6 | https://docs.xendit.co/docs/th-credit-card.md and https://docs.xendit.co/docs/qr-promptpay |
| V7 | https://2c2p.com/countries/thailand/ |
| T1 | Revenue Code s.78/1, s.86: https://www.rd.go.th/english/37719.html and https://www.rd.go.th/english/37741.html |
| T2 | Revenue Department, VAT summary: https://www.rd.go.th/english/6043.html |
| T3 | Revenue Code s.86/4, 86/13: https://www.rd.go.th/english/37741.html |
| T4 | Director-General Notification on VAT No. 196: https://www.rd.go.th/48232.html |
| T5 | Departmental Order Por.86/2542: https://www.rd.go.th/3568.html |
| T6 | Revenue Code s.105, 105 bis: https://www.rd.go.th/5203.html |
| T7 | Revenue Code s.86/6: https://www.rd.go.th/english/37741.html |
| T8 | Notification on VAT No. 32: https://www.rd.go.th/3402.html |
| T9 | Revenue Code s.82/10, 86/10: https://www.rd.go.th/english/37732.html |
| T10 | Departmental Order Por.80/2542: https://www.rd.go.th/3574.html |
| T11 | Ruling กค 0706/พ./1312: https://www.rd.go.th/24480.html |
| T12 | Notification on Stamp Duty No. 23: https://www.rd.go.th/3439.html |
| T13 | Secondary: https://taxsummaries.pwc.com/thailand/corporate/other-taxes and https://www.forvismazars.com/th/en/insights/doing-business-in-thailand/tax/thailand-maintains-7-vat-rate-for-another-year |
| T14 | Revenue Code s.80: https://www.rd.go.th/english/37732.html |
| T15 | Revenue Code s.87, 87/3: https://www.rd.go.th/english/37747.html |
| T16 | Revenue Department, electronic tax invoice rules (index): https://www.rd.go.th/60046.html and https://www.rd.go.th/27659.html |
| T17 | Secondary (ETDA): https://www.etda.or.th/en/Our-Service/Digital-Trusted-services-Infrastructure/TEDA/ETAX.aspx |
| T18 | Departmental Order Por.73/2541: https://www.rd.go.th/3580.html |
| T19 | Departmental Order Tor Por 4/2528: https://www.rd.go.th/3479.html; rulings https://www.rd.go.th/42163.html and https://www.rd.go.th/28765.html |
| T20 | Notification on Income Tax No. 100 (the certificate): https://www.rd.go.th/2914.html |
