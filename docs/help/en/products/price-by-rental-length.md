---
title: Set prices by rental length
summary: Give a vehicle or gear a total price for every rental length from 1 to 30 days, using quick entry, and adjust any day by hand.
roles: [owner, manager]
keywords: [price, rental price, daily price, weekly price, monthly price, hourly price, price table, tiered pricing, rate, 1 day, 7 days, 30 days, ราคา, ราคาเช่า, ราคารายวัน, ราคารายสัปดาห์, ราคารายเดือน, ตั้งราคา, ตารางราคา]
screens: [/[tenant]/products/[id]]
updated: 2026-11-26
---

# Set prices by rental length

"By rental length" gives a **total** for each length from 1 to 30 days; longer rentals are priced by the month (see [Set a long-stay daily rate](long-stay-rate.md)). It is the usual way to price a vehicle. Rental gear can use it too.

Who can do this: owners and managers. Staff can see prices but not change them ("You can see these prices but not change them."). Mechanics and drivers don't see prices.

## Steps

1. Open the product and go to its **Pricing** tab.
2. Under **How it is priced**, choose **By rental length**.
3. Under **By rental length**, choose **Set this product's own prices**. (To share one set of prices across several products, see [Use a shared price list on a product](use-a-price-list.md).)
4. In **Quick price entry**, type the prices you know: **Hourly**, **Daily (1 day)**, **Weekly (7 days)**, **2 weeks (14 days)**, **3 weeks (21 days)** and **Monthly (30 days)**. Daily and monthly are required. Each is the **total** for that length, not a per-day rate.
5. The days between fill in at equal steps, rounded to the shop's rounding step (see [Set the rounding step](../pricing-settings/rounding-step.md)). If every day should cost the same, type **Daily** and press **Same price every day**: it fills the other boxes with the daily price times their days, and clears any day you typed by hand.
6. Check **Price for each length** (on a phone, press **Show all days** first). Each day says whether it came **from quick entry**, was **filled in**, or was typed **by hand**. Type over a filled-in day to change it; **Reset** puts it back. A day from quick entry is changed in its quick-entry box.
7. Press **Save prices**.

The first time the shop saves any price, you are asked to confirm the currency: "Saving fixes the shop's currency as {currency}, and it can't be changed after that. Save?"

### Example

A Honda Click 125 with **Daily** ฿250, **Weekly** ฿1,500 and **Monthly** ฿5,000, in a shop with a ฿10 rounding step. Days 2 to 6 rise in equal steps from ฿250 to ฿1,500 and are rounded to the nearest ฿10: 2 days fill in as ฿460, 3 days as ฿670.

With **Same price every day** and **Daily** ฿250, the boxes become ฿1,750 (7 days), ฿3,500 (14 days), ฿5,250 (21 days) and ฿7,500 (30 days).

## How rentals are charged

- A rental of up to 30 days costs the total for its number of days.
- With an **Hourly** price, a rental under one day is charged by the hour (every started hour), but never more than the 1-day price ("held to the 1-day price"). For example, with ฿60 an hour and ฿250 a day: 3 hours cost ฿180, and 5 hours cost ฿250, not ฿300.
- Seasons can raise or lower the price for the days inside them. The **Seasons** card on the Pricing tab lists them. See [Set a seasonal price](../seasons/set-a-seasonal-price.md).
- Try a rental on the same tab: [Check a price](check-a-price.md).

## Common problems

With **Set this product's own prices**, **Save prices** stays greyed out until the prices are ready: daily and monthly filled in, every day valid, and no day cheaper than the day before. Meanwhile the form shows what is missing:

- **"Daily and monthly are both needed."** Shown under the empty one once you have typed the other.
- **"Enter an amount above 0, such as 300 or 1,300.50. Use a dot for decimals; a comma only between thousands (1,000). No spaces."** A quick-entry box isn't a valid amount, or is 0: use a dot for decimals and no spaces.
- A red box titled **"A longer rental can't cost less"**, with a line for each problem day: "{day} days cost less than {before} days. Raise it, or lower the days before it. Equal prices are fine." Raise that day, or lower the days before it.
- **"A day typed by hand isn't a valid price. Use a dot for decimals; a comma only between thousands (1,000). No spaces."** Fix the day you typed.

When saving:

- **"A price can't be 0. To charge nothing, choose Free."** The long-stay daily rate can't be 0; leave it blank to use the monthly price ÷ 30.
- **"Enter an amount such as 200 or 1,234.50. Use a dot for decimals; a comma only between thousands (1,000). No spaces, and no more decimal places than the currency has."** The long-stay daily rate isn't a valid amount: use a dot for decimals and no spaces.
- **"You can't make that change."** Only owners and managers can change prices.
- **"Couldn't save. Please try again."** Reload the page and try again.

For how to type numbers, see [Typing amounts, percentages and other numbers](../general/typing-numbers.md).
