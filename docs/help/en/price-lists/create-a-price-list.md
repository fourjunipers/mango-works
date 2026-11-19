---
title: Create a price list
summary: Make a shared list of prices for 1 to 30 days, as amounts or as multipliers of a base price, for several products to use.
keywords: [price list, shared price list, rate card, price table, multiplier, base price, ตารางราคา, สร้างตารางราคา, ราคากลาง, ตัวคูณ]
screens: [/[tenant]/settings/price-lists, /[tenant]/settings/price-lists/new]
updated: 2026-11-19
---

# Create a price list

A shared price list holds a total for each length from 1 to 30 days. Each product on a list follows it. Use one when several products cost the same, for example all your 125 cc scooters.

Who can do this: owners and managers.

## Steps

1. Open **Shop settings** and choose **Price lists**.
2. Press **New price list**.
3. Type a **Name**, for example "300–3000". Names are unique in the shop.
4. Choose **What does it hold?** This can't be changed later:
   - **Amounts**: the price for each length, in money.
   - **Multipliers of a base price**: each product on it sets its own base price, which the list multiplies.
5. Fill in the prices with quick entry, the same way as on a product: **Daily (1 day)** and **Monthly (30 days)** are required, the days between fill in, and any day can be typed by hand. For multipliers, type numbers such as 3 or 1.1666, and use **Sample base price** to see what they come to.
6. Press **Create price list**. It stays greyed out until you have chosen what the list holds and the prices are ready: daily and monthly filled in, every day valid, and no day cheaper than the day before.
7. If this is the first price the shop saves, confirm "Saving fixes the shop's currency as {currency}, and it can't be changed after that. Save?"

Then put products on it: [Use a shared price list on a product](../products/use-a-price-list.md).

## Common problems

While **Create price list** is greyed out, the form shows what is missing:

- **"Daily and monthly are both needed."** Shown under the empty one once you have typed the other.
- **"Enter an amount above 0, such as 300 or 300.50."** (a list of amounts) or **"Enter a multiplier above 0, such as 3 or 1.1666."** (a list of multipliers): a quick-entry box isn't a valid number.
- A red box titled **"A longer rental can't cost less"**, with a line for each problem day: "{day} days cost less than {before} days. Raise it, or lower the days before it. Equal prices are fine." Raise that day, or lower the days before it.
- **"A day typed by hand isn't a valid price."** Fix the day you typed.

When saving:

- **"The shop already has a price list with this name."** Choose another name.
- **"Couldn't save. Please try again."** Reload the page and try again.
