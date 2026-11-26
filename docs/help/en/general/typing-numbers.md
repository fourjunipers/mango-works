---
title: Typing amounts, percentages and other numbers
summary: How to type a price, a percentage, hours, an odometer reading or a count so the platform reads it the way you meant, and what to do when it is refused.
roles: [owner, manager, staff, mechanic, driver]
keywords: [number, amount, price, decimal, decimal point, comma, thousands separator, space, "12,5", "0,5", invalid amount, enter an amount, enter a percentage, ตัวเลข, จุดทศนิยม, ลูกน้ำ, ใส่จำนวนเงิน]
screens: [/[tenant]/products, /[tenant]/settings/pricing, /[tenant]/settings/coupons, /[tenant]/fleet]
updated: 2026-11-26
---

# Typing amounts, percentages and other numbers

Every box that takes a number follows one rule, on every screen: prices and deposits, percentages and tax rates, multipliers, buffer hours, odometer readings, whole numbers such as a quantity or a number of days, and years.

The rule is the same whatever country or language the shop uses, so the same text can never mean two different amounts on two screens.

## Who can do this

Everyone. Which number boxes you see depends on your role: for example, mechanics type odometer readings, and only owners and managers type prices.

## The rule

- **A dot is the decimal point.** Type 12.5, not 12,5.
- **A comma is allowed only between thousands**, in groups of three digits: 1,400 or 1,234.50. You can also leave it out: 1400.
- **No spaces.** "1 400" is refused.
- **Nothing else mixed in**: no letters, no currency symbol, no plus or minus sign. (A percentage may end with %.)

Some examples:

| You type | Read as |
| --- | --- |
| 1400 | 1400 |
| 1,400 | 1400 |
| 1,234.50 | 1234.50 |
| 12.5 | 12.5 |
| 12,5 | refused: a comma only goes between thousands |
| 0,5 | refused |
| 1 400 | refused: no spaces |
| 1_400 | refused |

## Which boxes take decimals

- **Amounts** (prices, deposits, Cost, coupon amounts): as many decimal places as your currency has. A currency with no cents, such as the Japanese yen, takes none.
- **Percentages and tax rates**: up to two decimal places, such as 12.5.
- **Multipliers** on a price list: decimals are fine, such as 1.1666.
- **Buffer hours** on a vehicle product: decimals are fine, up to a week. Half an hour is 0.5, not 0,5.
- **Odometer readings**: one decimal place at most, such as 12,345.5.
- **Whole numbers** (a quantity, a number of days or uses, a minimum age): no decimal point at all. 5.0 is refused.
- **Years**: four digits and nothing else, such as 2024. "2,024" and "02024" are refused.

## When a number is refused

The box shows a message that says what it wants, for example **"Enter an amount such as 200 or 1,234.50. Use a dot for decimals; a comma only between thousands (1,000). No spaces, and no more decimal places than the currency has."** or **"Enter a percentage such as 10 or 12.5. Use a dot for decimals, not a comma."** Nothing is saved until every box is right, and the first box with a problem is selected for you.

The usual causes are a comma used as the decimal point (12,5), a space inside the number (1 400), or a currency symbol or unit typed in the box. Retype the number using the table above.

Each task's own article lists the messages its screen can show.
