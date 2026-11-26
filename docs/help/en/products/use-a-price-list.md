---
title: Use a shared price list on a product
summary: Put a product on one of the shop's shared price lists, so it follows that list's prices, optionally times a base price.
roles: [owner, manager]
keywords: [price list, shared prices, same price, price group, base price, multiplier, ตารางราคา, ใช้ตารางราคา, ราคาฐาน]
screens: [/[tenant]/products/[id], /[tenant]/settings/price-lists]
updated: 2026-11-26
---

# Use a shared price list on a product

A shared price list is one set of prices for several products. Change it once, and every product on it follows. Create lists first: [Create a price list](../price-lists/create-a-price-list.md).

A list holds either **Amounts** (the price for each length, in money) or **Multipliers of a base price** (each product on it sets its own base price, which the list multiplies).

Who can do this: owners and managers. Staff can see which list a product is on but not change it.

## Steps

1. Open the product's **Pricing** tab.
2. Under **How it is priced**, choose **By rental length**.
3. Choose **Use a shared price list**.
4. Choose the list under **Price list**. Each list shows its kind, for example "300–3000 · Amounts". (**Manage price lists** opens Settings › Price lists.)
5. If the list holds multipliers, type this product's **Base price**. Each day's price is this base price × the day's multiplier. **Prices for this product** shows the result.
6. Press **Save prices**.

For example, on a multipliers list where 7 days is ×6, a Honda Click 125 with a base price of ฿250 costs ฿1,500 for 7 days.

To go back to its own prices, choose **Set this product's own prices** and save.

The long-stay daily rate, deposit and tax stay on the product: see [Set a long-stay daily rate](long-stay-rate.md).

## Common problems

- **"There are no shared price lists yet."** Create one in Settings › Price lists.
- **"Required."** Under **Price list**: no list is chosen. Under **Base price**: the list holds multipliers and needs this product's base price.
- **"Enter an amount such as 200 or 1,234.50. Use a dot for decimals; a comma only between thousands (1,000). No spaces, and no more decimal places than the currency has."** The base price isn't a valid amount: use a dot for decimals and no spaces.
- **"A price can't be 0. To charge nothing, choose Free."** The base price can't be 0.
- **"You can't make that change."** Only owners and managers can change prices.
- **"Couldn't save. Please try again."** Reload the page and try again.

For how to type numbers, see [Typing amounts, percentages and other numbers](../general/typing-numbers.md).
