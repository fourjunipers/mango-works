# Design prototypes

Clickable mock-ups for Mark's feedback before a stage is built. Each is one self-contained HTML file: no external requests, no framework, sample data only, nothing saved. They are not part of either app and nothing imports them.

## Order screen prototype (26 Nov 2026)

[`order-screen-prototype.html`](order-screen-prototype.html), for Phase 3 stage 9 (New order and the order page), built from [phase-3-plan.md](../phase-3-plan.md) §9 and §9.1, §2.2 to §2.3, §6, and the swap rules in [products-redesign.md](../products-redesign.md) §9.19. Styled with the staff app's tokens (`apps/platform/app/globals.css`) and shell (sidebar on wide screens, header and bottom tab bar on phones).

Tabs:

- **a. New order**: invoice layout. Customer top left (search or add), pickup and return place top right, "Search to add products", each vehicle line with its own pickup and return (15-minute steps) and unit, extras under their vehicle, items for sale and services as lines, a custom line, a staff price change with a reason, a coupon, totals with VAT once at the bottom (total, then net and VAT, VAT included), payment on the right, the deposit apart from the total. A vehicle over 30 days splits into month lines, each with its own due date.
- **b. Saved order**: #1042, one vehicle out and one reserved. Status, channel badge, Pick up and Return, Extend rental, Swap bike (with the shop's four swap options and the cheaper-bike choices), Cancel order and Cancel rental with the reason list, Take payment, Refund, charges, deposit status, history. Reserving on tab a replaces this sample with the new order.
- **c. Long rental**: #1031, a monthly PCX rental: month 1 paid, month 2 due today, the deposit charged once. Extend adds month 3.
- **d. Phone (375 px)**: tabs a and b in the staff app at phone width; the same sections stack in the §9.1 order.

The swap on tab b reproduces Mark's example from §9.19 to the baht: ฿250 keeping the customer's discount, ฿550 without.

Not prototyped: return early and late returns (the dialogs say so), unit timeline, the hover card's other orders (a tooltip on the free count stands in), add to order on a saved order, Thai labels.

### Open questions for Mark

The plan does not settle these. The prototype's answer is a guess, named in each.

1. **A swap on a period that is not paid yet.** The swap credit is "the money actually paid × the unused share" (§9.19), so on an unpaid period (tab c, month 2 due today) the credit is ฿0: the customer owes the old period's whole charge and the new bike's remainder on top. Should the unpaid charge be reduced instead (a `difference` charge), or should a swap be refused until the period is paid? *Prototype: charges both.*
2. **When an extension is due.** §6.1 makes an `extension` charge but gives it no due date. Due at once, or when the added period starts? *Prototype: when it starts (12 Dec on tab b), so it shows as "due later".*
3. **Hold or charge: shop only, or per rental?** Decision 37 has the shop choose. A card hold usually expires after about 7 days, so a 30-day rental on a hold loses its deposit halfway (the spec's table says hold for short rentals, charge for long ones). May staff switch at pickup, or does the shop set a rule by length? *Prototype: the shop's choice is the default and staff can switch at pickup, with a warning over 7 days.*
4. **Credit on an order with a charge still due.** After a rental is canceled or a swap gives a credit, does the credit pay the next charge by itself, or does staff apply it? *Prototype: it lowers the balance, but the charge still reads "due" until a payment is recorded.*
5. **The deposit top-up after a swap** to a bike with a higher deposit (§9.19: shown, never charged silently). Who takes it and when, and does an untaken top-up block anything? For a card hold, is it a second hold? *Prototype: a "Take top-up" button on the deposit, blocking nothing.*
6. **VAT shown on the order page.** VAT is worked out once per payment (decision 27), so the order's VAT and the sum of its invoices' VAT can differ by a satang. Show the order's own VAT, the invoices' sum, or no VAT on the order page at all? *Prototype: the order's VAT once at the bottom, and each payment's VAT in the payments list.*
7. **Reserve without a customer.** Can a counter order be reserved with no customer (a walk-in, name added at pickup)? *Prototype: a customer is required to reserve; a draft or hold needs none.*
8. **The reason list for a staff price change** (§9 "price change with a reason (setting)"). Is a reason always required, and what is BSR's list? *Prototype: Returning customer, Long stay, Price match, Vehicle has a fault, Other.*
9. **Cancel reasons and who canceled.** The brief's list is customer request, shop request, no-show, other; migration 3 fixes `cancel_reason` and `cancelled_by`. Is `cancelled_by` read from the reason (customer request → customer), or asked separately? May "no-show" be picked before the pickup time has passed? *Prototype: reason only; no-show allowed any time before pickup; Cancel order is greyed out while a vehicle is out, Cancel rental stays on reserved lines.*
10. **The main header action with mixed rentals.** With one bike out and one reserved, the header shows "Pick up Yamaha NMAX 155" and each line keeps its own buttons. Right, or should the header read "Pick up" and ask which?
11. **Charge names.** The order page lists charges as "Booking", "Month 2", "Swap 26 Nov", "Month 3" (an extension of a monthly rental). These names reach the customer's invoices in Phase 6. Good enough?
12. **English and Thai together** (§9). Side by side on every label, or one language at a time with a switch? *Prototype: English only.*
