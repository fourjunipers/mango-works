---
title: Set prices by rental length
summary: Give a vehicle or gear a total price for every rental length from 1 to 30 days, using quick entry, and adjust any day by hand.
keywords: [price, rental price, daily price, weekly price, monthly price, hourly price, price table, tiered pricing, rate, 1 day, 7 days, 30 days, ราคา, ราคาเช่า, ราคารายวัน, ราคารายสัปดาห์, ราคารายเดือน, ตั้งราคา, ตารางราคา]
screens: [/[tenant]/products/[id]]
updated: 2026-11-19
---

# Set prices by rental length

"By rental length" gives a **total** for each length from 1 to 30 days; longer rentals are priced by the month (see [Set a long-stay daily rate](long-stay-rate.md)). It is the usual way to price a vehicle. Gear can use it too.

Who can do this: owners and managers. Staff can see prices but not change them ("You can see these prices but not change them."). Mechanics and drivers don't see prices.

## Steps

1. Open the product and go to its **Pricing** tab.
2. Under **How it is priced**, choose **By rental length**.
3. Under **By rental length**, choose **Set this product's own prices**. (To share one set of prices across several products, see [Use a shared price list on a product](use-a-price-list.md).)
4. In **Quick price entry**, type the prices you know: **Hourly**, **Daily (1 day)**, **Weekly (7 days)**, **2 weeks (14 days)**, **3 weeks (21 days)** and **Monthly (30 days)**. Daily and monthly are required. Each is the **total** for that length, not a per-day rate.
5. The days between fill in at equal steps, rounded to the shop's rounding step (see [Set the rounding step](../pricing-settings/rounding-step.md)). If every day should cost the same, type **Daily** and press **Same price every day**: it fills the other boxes with the daily price times their days.
6. Press **Show all days** to see **Price for each length**. Each day says whether it came **from quick entry**, was **filled in**, or was typed **by hand**. Type over any day to change it; **Reset** puts it back.
7. Press **Save prices**.

The first time the shop saves any price, you are asked to confirm the currency: "Saving fixes the shop's currency as {currency}, and it can't be changed after that. Save?"

## How rentals are charged

- A rental of up to 30 days costs the total for its number of days.
- With an **Hourly** price, a short rental is charged by the hour, but never more than the 1-day price ("held to the 1-day price").
- Seasons can raise or lower the price for the days inside them. The **Seasons** card on the Pricing tab lists them. See [Set a seasonal price](../seasons/set-a-seasonal-price.md).
- Try a rental on the same tab: [Check a price](check-a-price.md).

## Common problems

- **"A longer rental can't cost less"** with "{day} days cost less than {before} days. Raise it, or lower the days before it. Equal prices are fine." A total that falls as days rise is refused. Fix the day marked in red.
- **"A longer rental can't cost less than a shorter one. Equal prices are fine."** The same rule, shown when saving.
- **"Daily and monthly are both needed."** Fill in both.
- **"Fill in daily and monthly, and fix the days marked in red, before saving."**
- **"Enter an amount above 0, such as 300 or 300.50."** A quick-entry box isn't a valid amount.
- **"A day typed by hand isn't a valid price."** Fix the day you typed.
- **"A price list needs all 30 days."** Every day must have a price.
- **"A price can't be 0. To charge nothing, choose Free."** Free is offered for services and extras only.
- **"The currency can't change once prices have been saved in it."**
- **"Only an owner or manager can change that."**
- **"Couldn't save. Please try again."** Reload the page and try again.
