---
title: Switch a bike on or off Moto Mangos and set how many are offered
summary: Use the Listing part of a bike's Moto Mangos tab to turn the listing on or off and to set instant units, request units, walk-ins and lead time.
keywords: [Moto Mangos, listing, switch, instant units, request units, walk-ins, lead time, advance booking, instant approval, offering, รายการ, จองล่วงหน้า, เปิด, ปิด]
screens: [/[tenant]/products/[id]]
updated: 2026-11-20
---

# Switch a bike on or off Moto Mangos and set how many are offered

The **Listing** part, at the bottom of a motorbike's **Moto Mangos** tab, decides whether the bike is offered on Moto Mangos and how many of its vehicles are offered for each kind of booking. It works once the product is connected to a model: see [Connect a motorbike to Moto Mangos](connect-a-bike-to-moto-mangos.md). Until then it is greyed out, with the line "You can switch this on once a model is selected from the list above, or your request is approved."

The page also says: "Listing takes effect when Moto Mangos starts reading from this system."

Who can do this: owners and managers.

## Switch the listing on or off

1. Open the product's **Moto Mangos** tab.
2. Press the **List this product on Moto Mangos** switch.
3. It saves as soon as you press it: there is no Save button. The line under it says "On. The switch saves as soon as you press it." or "Off. The switch saves as soon as you press it."

When Moto Mangos approves a new model you sent, the listing is switched on for you.

A bike with no price by rental length is never offered. The tab warns "No price by rental length yet: it won't be offered on Moto Mangos. Set one on the Pricing tab." See [Set prices by rental length](price-by-rental-length.md).

## Set how many are offered

1. Under **Set bike quantities per booking type**, fill in:
   - **Instant units**: future bookings that receive instant approval.
   - **Request units**: future bookings that require your approval.
   - **Walk-ins**: bookings that are ready for immediate pickup today (this overrides the lead time).
2. Optional: **Lead time (hours)**: how many hours ahead a booking must be made, from 0 to 720. Leave it empty for none. Your shop's minimum notice also counts, and the longer of the two applies: when your notice is the longer, the tab says "Bookings need N hours: your shop's minimum notice." (see [Set your booking rules](../booking-rules/set-booking-rules.md)).
3. A line under the counts shows what you are offering, for example "Offering 3 of 8 bikes for advance booking". The 8 is the product's active vehicles: vehicles in maintenance, sold or retired don't count.
4. Press **Save**. Only what you changed is saved.

## Common problems

- **"Total units listed on Moto Mangos can not exceed the number of units in your inventory"** **Instant units** plus **Request units** is more than the product's active vehicles. Lower them, or put a vehicle back on the road. **Save** stays greyed out until it is put right.
- **"Walk-ins can not exceed the number of units in your inventory"** **Walk-ins** is more than the active vehicles. Lower it.
- **"Enter a whole number in range."** A count must be a whole number from 0 to 9,999. Empty counts as 0.
- **"Enter whole hours from 0 to 720, or leave it empty."** Fix the **Lead time (hours)**.
- **"Only a model on the Moto Mangos list can be listed there."** The switch only works once the product is on an approved model.
- **"This product is retired. Restore it first."** A retired product can't be listed.
- **"Only an owner or manager can change that."** or **"You can't make that change."** Ask an owner or manager.
- **"Couldn't save. Please try again."** Reload the page and try again.
