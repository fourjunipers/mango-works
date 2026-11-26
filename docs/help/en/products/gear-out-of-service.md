---
title: Handle gear that is out of service
summary: Put repaired gear back in use, mark lost gear as found, remove it from stock for good, or edit the details of a problem.
roles: [owner, manager, staff, mechanic]
keywords: [rental gear, out of service, back in use, found, remove from stock, edit, in repair, lost, write off, ซ่อมเสร็จ, เจอแล้ว, ตัดออกจากสต็อก]
screens: [/[tenant]/products/[id]]
updated: 2026-11-26
---

# Handle gear that is out of service

The **Out of service** card on a rental gear product's **Details** tab lists the units that are in repair or lost, in repair first and the longest out at the top. Each line shows its status, the date it happened and, for gear in repair, the date it is expected back, plus any notes. Gear tracked unit by unit shows each unit's name. It says "Nothing is out of service." when the list is empty.

Who can do this: owners, managers, staff and mechanics. Which buttons you see on a line depends on your role:

| Button | Where | Who |
| --- | --- | --- |
| **Back in use** | gear in repair | owner, manager, staff, mechanic |
| **Found, back in use** | lost gear | owner, manager |
| **Edit** | gear in repair | owner, manager, staff, mechanic |
| **Edit** | lost gear | owner, manager, staff |
| **Remove from stock** | either | owner, manager |

Drivers see the list but no buttons. For a lost unit, everyone except owners and managers sees "An owner or manager marks it found or removes it from stock."

For gear tracked unit by unit, each button also names the unit, for example **Back in use: Helmet 3**.

## Steps

1. Open **Products**, open the gear product, and find the unit under **Out of service**.
2. Press the button you need.
   - **Back in use** and **Found, back in use** put the unit back in stock and available.
   - **Edit** opens **Edit details**: change **Date it happened**, **Expected back (optional)** (gear in repair only) and **Notes (optional)**, then press **Save**. These dates are for information only and don't change stock.
   - **Remove from stock** asks you to confirm: "Remove from stock? This cannot be undone. The unit is removed from this product for good and can’t be marked found again. The History keeps a record."

Every change is recorded in [the product's History](product-history.md).

## Common problems

- **"This unit is no longer in repair. Reload the page."** Someone already changed it.
- **"This unit is no longer marked lost. Reload the page."** Someone already changed it.
- **"This unit is no longer out of service. Reload the page."** Someone already changed it.
- **"This unit is no longer here. Reload the page."** The unit was removed from stock.
- **"Choose today or an earlier date."**, **"Choose the date it happened or a later one."**, **"Enter a real date."** and **"Keep the notes to 500 characters."** Fix the field named in the message and save again.
- **"You can't make that change."** Your role can't use that button (see the table).
- **"Couldn't save. Please try again."** Reload the page and try again.
