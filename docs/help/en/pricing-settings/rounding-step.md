---
title: Set the rounding step
summary: Choose the step that quick price entry rounds filled-in days to, such as 10 or 50.
roles: [owner, manager]
keywords: [rounding, round prices, round to 10, round to 50, nice numbers, การปัดเศษ, ปัดราคา, ปัดเศษ]
screens: [/[tenant]/settings/pricing]
updated: 2026-11-26
---

# Set the rounding step

When quick price entry fills in the days between your prices, it rounds them to the shop's rounding step. Prices already saved never change. The prices you type yourself are never rounded.

For example, you type **Daily (1 day)** 300 baht and **Weekly (7 days)** 1,750 baht. Day 2 works out at 541.67 baht. With a step of 10 it is filled in as 540; with a step of 50, as 550. Halves round up.

Who can do this: owners and managers.

## Steps

1. Open **Shop settings** and choose **Pricing and tax**.
2. Under **Rounding**, type the **Rounding step**, for example 10. Leave it blank to use the default for your currency (the help text shows it: "Blank uses 10." in baht).
3. Press **Save pricing settings**. **Saved** appears.

Changing it only affects days filled in from now on. It is used on a product's own prices and on shared price lists of amounts.

The first time the shop saves **Pricing and tax**, you are asked: "Saving fixes the shop's currency as {currency}, and it can't be changed after that. Save?"

## Common problems

- **"Enter an amount such as 200 or 1,234.50. Use a dot for decimals; a comma only between thousands (1,000). No spaces, and no more decimal places than the currency has."** Type the step with a dot for decimals and no spaces.
- **"A price can't be 0. To charge nothing, choose Free."** The step can't be 0. Leave it blank to use your currency's default.
- **"Couldn't save. Please try again."** Reload the page and try again.

For how to type numbers, see [Typing amounts, percentages and other numbers](../general/typing-numbers.md).
