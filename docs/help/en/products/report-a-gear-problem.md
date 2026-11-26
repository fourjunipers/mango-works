---
title: Report a problem with rental gear
summary: Mark gear as in repair, lost, or damaged for good, so it stops showing as available.
roles: [owner, manager, staff, mechanic]
keywords: [rental gear, report a problem, in repair, lost, damaged, broken, missing, remove from stock, write off, helmet, ของหาย, ซ่อม, เสียหาย, อุปกรณ์]
screens: [/[tenant]/products/[id]]
updated: 2026-11-26
---

# Report a problem with rental gear

When a helmet is being repaired, goes missing or is broken beyond repair, report it on the gear product's **Details** tab. The unit then stops counting as available. Each report is kept in the product's History: see [Read a product's History](product-history.md).

Only units that are in use and free can be reported. A unit that is booked for later is refused.

Who can do this: what you can choose under **What happened** depends on your role.

| Choice | Owner, manager | Staff | Mechanic | Driver |
| --- | --- | --- | --- | --- |
| **In repair** | yes | yes | yes | no |
| **Lost** | yes | yes | no | no |
| **Damaged for good** | yes | no | no | no |

Drivers don't see **Report a problem**.

## Steps

1. Open **Products**, open the gear product, and find **Report a problem** on the **Details** tab. When the shop has more than one location, use the one under the right location's name.
2. Press **Report a problem**. A form opens. The button is greyed out, with "No unit is in use and free right now, so there is nothing to report.", when nothing is free.
3. Under **What happened**, choose:
   - **In repair**: being cleaned or repaired. Still counted in stock, but not available to rent until it is back in use.
   - **Lost**: missing. Not counted in stock and not available. It can be marked found later.
   - **Damaged for good**: can't be repaired. Removed from this product for good.
4. For counted gear, type **How many** (it starts at 1, and says how many are in use and free, for example "6 in use and free."). For gear tracked unit by unit, choose **Which unit**, for example "Helmet 3".
5. Check **Date it happened** (today by default; it can't be in the future). For **In repair** you can also set **Expected back (optional)**. These dates are for information only and don't affect stock.
6. Optional: **Notes (optional)**, up to 500 characters.
7. Press **Mark in repair**, **Mark lost** or **Remove from stock** (the button changes with your choice). **Remove from stock** asks you to confirm, because it can't be undone: "Remove from stock? This cannot be undone. The unit is removed from this product for good and can’t be marked found again. The History keeps a record."

A unit marked in repair or lost then shows under **Out of service**. A unit removed from stock is gone from the product. See [Handle gear that is out of service](gear-out-of-service.md).

## Common problems

- **"Enter a whole number."** **How many** must be a whole number from 1 to 1,000.
- **"Only N in use and free. The rest are booked or already out of service."** You asked for more than are free. Lower the number.
- **"This unit is booked or already out of service."** Choose another unit.
- **"Required."** Choose a unit under **Which unit**.
- **"This unit is no longer here. Reload the page."** Someone changed it since you opened the page.
- **"Choose today or an earlier date."** **Date it happened** can't be in the future.
- **"Choose the date it happened or a later one."** **Expected back (optional)** can't be before the date it happened.
- **"Keep the notes to 500 characters."** Shorten the notes.
- **"Enter a real date."** Fix the date.
- **"You can't make that change."** Your role can't report that kind of problem (see the table).
- **"Couldn't save. Please try again."** Reload the page and try again.
