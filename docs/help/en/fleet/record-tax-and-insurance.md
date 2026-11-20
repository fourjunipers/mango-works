---
title: Record road tax, insurance or an inspection
summary: Add a renewal record to a vehicle so its road tax, insurance or inspection expiry shows and reminders work.
keywords: [road tax, insurance, compulsory insurance, voluntary insurance, inspection, renewal, expiry, policy number, receipt, tax disc, ภาษีรถ, ภาษีและประกัน, พ.ร.บ., ประกันภาคบังคับ, ประกันภาคสมัครใจ, ตรวจสภาพรถ, ต่อภาษี]
screens: [/[tenant]/fleet/units/[id], /[tenant]/dashboard]
updated: 2026-11-20
---

# Record road tax, insurance or an inspection

Each vehicle's page has a **Tax and insurance** section. It shows when the road tax, insurance (compulsory and voluntary) and inspection expire. "The dates come from the latest record of each kind", so a renewal is recorded as a new record and the old ones stay in the history.

Who can do this: everyone except drivers. Only owners and managers can see or type the **Cost**, and only they can delete a record.

## Steps

1. Open the vehicle's page and scroll to **Tax and insurance**.
2. Under **Add or renew**, choose the **Kind**: **Road tax**, **Insurance (compulsory)**, **Insurance (voluntary)** or **Inspection**.
3. Fill in **Provider**, **Policy or receipt number** and **Start date** if you have them.
4. Owners and managers: type the **Cost** (in your shop's currency) if you want to keep what the renewal cost. Staff and mechanics don't see this box.
5. Fill in the **Expiry date** (required).
6. Press **Add record**.

The record and its cost are saved together in one step: either both are saved or neither is, so a renewal never ends up without the cost you typed. The system also notes who recorded it.

Each kind now shows its expiry, with "Expires in N days", "Expires today" or "Expired N days ago". Tap the record count (for example "All 3 records") to see the history. Each record there shows its provider, its number and, to owners and managers, its cost.

The dashboard reminds you before each expiry: see [Set tax and insurance reminders](../shop-settings/tax-and-insurance-reminders.md).

## Delete a record

Owners and managers: open the history, press **Delete** on the record and confirm "Delete this record?". The expiry then comes from the latest record left.

## Common problems

- The browser won't send the form without an **Expiry date**. If a date still gets through empty or wrong, the screen shows **"Enter a real date."** Check the start and expiry dates.
- **"The end must be after the start."** The expiry date is before the start date.
- **"Enter an amount such as 200 or 1,234.50. Use a dot for decimals; a comma only between thousands (1,000). No spaces, and no more decimal places than the currency has."** The **Cost** isn't a valid amount. Nothing is saved: fix the cost and press **Add record** again. See [Typing amounts, percentages and other numbers](../general/typing-numbers.md).
- **"This record couldn’t be saved. Check its type, its dates and its cost."** Choose the kind again and check both dates and the cost, then try again. Nothing was saved.
- **"This unit is no longer here. Reload the page."** The vehicle was deleted meanwhile.
- **"Couldn't save. Please try again."** Reload the page and try again.
