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

### Layout change: dates first (Mark, 26 Nov 2026)

Hierarchy and layout only; behaviour and the data shown are unchanged.

- **Pickup and return are the strongest thing on each vehicle line and in the header**, on every tab. Each has a clear "Pickup" or "Return" label over a larger, bold date and time. They are the first column of the line table and, at phone width, the first thing on each line, side by side. The header shows the order's pickup and return (with several vehicles, the first pickup and the last return).
- **Location, who made the order and the channel are one quiet metadata line** under the header dates, in smaller, lighter text. On New order the pickup and return places are chosen in that line. The separate "Pickup and return" card is gone.
- **Less repeated:** the order page's totals show the total, net and VAT only; paid, due now, due later and credit are in Payments, now with "Paid" too. The deposit in the totals is one quiet line (its status stays in the Security deposit card). A period line names the bike and plate only when they differ from the rental's (after a swap). Long footnotes are shortened or removed.

### Mark's answers (26 Nov 2026)

The plan did not settle these; Mark answered them on the prototype. Where an answer changes the Phase 3 plan, the plan needs the edit before stage 9 (the owner keeps the plan).

| # | Question | Answer | In the prototype |
| --- | --- | --- | --- |
| 1 | A swap on a period not paid yet | **Allowed. The customer owes for the time used on the old bike and the rest of the period on the new one.** The old period's unused part comes off whether or not it was paid, so the customer pays the same total either way (tab b's example: ฿2,750 paid or unpaid). Generalises §9.19's "paid remainder", which counts only money paid | Done: the swap credits the unused part of what was charged and says so when the period is unpaid |
| 2 | When an extension is due | **When the added period starts.** The customer may pay early or late | Already so |
| 3 | Deposit: hold on card or charge | **A shop setting is the default; staff can change it at pickup.** (A card hold lapses after about 7 days) | Already so, with a warning on rentals over 7 days |
| 4 | Credit on an order with a charge still due | **Credit stays on the account and comes off any future balance automatically.** Changes decision 14 ("credit stays until refunded or written off"): credit is now also used by the next charge | Done: credit pays the oldest open charge first ("Paid from credit") |
| 5 | Deposit top-up after a swap to a dearer bike | **Staff take the difference, so the deposit reaches the higher amount** | Already so ("Take top-up") |
| 6 | VAT on the order page | **The order's VAT**, once at the bottom | Already so |
| 7 | Reserve without a customer | **A customer is required to reserve** | Already so |
| 8 | Reason for a staff price change | **Optional, with a list to pick from** | Done: "No reason" by default, then the list |
| 9 | Cancel: who cancelled, and when a no-show can be marked | **Staff choose who cancelled (customer or shop), apart from the reason. A no-show can be marked any time:** customers may say they aren't coming before the pickup time | Done: Cancel asks for the reason and "Cancelled by"; No-show at any time |
| 10 | Header action with one bike out and one reserved | **"Pick up Yamaha NMAX 155"**, naming the bike | Already so |
| 11 | Charge names (Booking, Month 2, Swap 26 Nov) | **Fine** | Already so |
| 12 | English and Thai | **One language at a time, with a switch** | English only; the switch is not drawn |

No questions left open from this prototype.
