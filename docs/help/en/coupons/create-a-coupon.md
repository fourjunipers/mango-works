---
title: Create a coupon
summary: Make a discount code with a percentage or fixed amount off, and optionally limit its products, dates, rental length, spend, uses and where it can be used.
roles: [owner, manager]
keywords: [coupon, discount code, promo code, voucher, promotion, percentage off, money off, flyer code, คูปอง, โค้ดส่วนลด, รหัสส่วนลด, โปรโมชั่น, ส่วนลด]
screens: [/[tenant]/settings/coupons, /[tenant]/settings/coupons/new]
updated: 2026-11-26
---

# Create a coupon

A coupon is a code a customer gives for a discount. Each one says how much it takes off, on what, and when. Only the code and the discount are needed; leave any other box empty for no limit.

The shop must also accept coupons: see [Switch coupons on or off for the shop](../pricing-settings/accept-coupons.md).

Who can do this: owners and managers. Staff can try a code in **Check a price** and the **Price check**, but can't open Settings › Coupons.

## An example

SONGKRAN10: 10% off motorbikes, for pickups from 10 to 20 April, for rentals of at least 3 days, at the counter and on your booking page. A scooter rented for 3 days at 900 baht gets 90 baht off and costs 810 baht.

## Steps

1. Open **Shop settings** and choose **Coupons**.
2. Press **New coupon**.
3. Type the **Code**: what the customer types. Letters A to Z and numbers 0 to 9, up to 40. Spaces are taken out, small letters are made capitals and full-width letters and numbers (such as Ａ or ０) are read as the plain ones; the form shows "Saved as {code}". Thai letters can't be used.
4. Optional: **Name (for the shop)**, your own note such as "Songkran flyer". Customers don't see it.
5. Under **Discount**, choose the **Kind**:
   - **Percentage**: type the **Percentage off**, such as 10 or 12.5. It is taken off each of the coupon's lines after seasonal prices.
   - **Fixed amount**: type the **Amount off**. It comes off the coupon's lines together, never more than they come to, and never off a deposit. For example, 200 baht off two scooters that come to 1,800 baht leaves 1,600 baht.
6. Under **Products**, choose **All products** or **Chosen products** (use **Find a product** and tick them). A coupon for chosen scooters does not reduce the helmets beside them.
7. Optional limits:
   - **Valid dates** (**First day**, **Last day**): the days a booking can be made with it, on the shop's calendar.
   - **Pickup dates** (**Pickup from**, **Pickup until**): the rental must start between these days.
   - **Minimum days**: the rental must be at least this many days.
   - **Minimum spend**: counts only this coupon's own lines, after seasonal prices and before any discount.
   - **Total uses**: how many bookings can use it, in all. A cancelled booking gives its use back.
8. Under **Where it can be used**, tick at least one (none is ticked at first): **By staff, at the counter or on the phone**, **On the shop’s booking page**, **On Moto Mangos**.
9. Under **With other discounts**:
   - **Can be combined with the returning-customer discount** (unticked at first). Off: a returning customer gets whichever of the two takes more off. On: the returning-customer discount comes off first, then the coupon comes off what is left.
   - **Can be used on season discounts** (ticked at first). Off: the coupon takes nothing off a rental that a season has already made cheaper. A season that raised the price never stops a coupon.
10. Press **Create coupon**. You see "Coupon created." The coupon starts **On**.

For example, a returning customer with 10% off and SONGKRAN10 on a 900 baht rental:

- Combined: 900 − 90 = 810, then 10% of 810 = 81 off, so 729 baht.
- Not combined: both take 90 off, so the returning-customer discount is used and the code isn't used up. The customer pays 810 baht.

For how to type numbers, see [Typing amounts, percentages and other numbers](../general/typing-numbers.md).

Try it in **Check a price** on a product's Pricing tab, or on the **Price check** tab: see [Check a price](../products/check-a-price.md). Bookings and orders that use coupons come in a later update.

## Common problems

- **"Required."** The code or the discount is missing.
- **"Too long."** Shorten the name.
- **"This code can’t be saved: use only the letters A to Z and the numbers 0 to 9. Thai letters can’t be used."** Shown while you type. Remove any Thai letters, symbols or other characters from the code.
- **"Use only the letters A to Z and the numbers 0 to 9, up to 40 of them. Spaces are taken out, and full-width letters and numbers (such as Ａ or ０) are read as A or 0. Thai letters can’t be used in a code."** The code has a character that isn't a letter or number, or is longer than 40.
- **"Another coupon already uses the code {code}. Archive it first, or choose another code."** Or **"The coupon “{name}” already uses the code {code}. Archive it first, or choose another code."** Two live coupons can't share a code.
- **"Enter a percentage such as 10 or 12.5. Use a dot for decimals, not a comma."** Write 12.5, not 12,5.
- **"Enter a percentage above 0."** / **"At most 100%."**
- **"Enter an amount such as 200 or 1,234.50. Use a dot for decimals; a comma only between thousands (1,000). No spaces, and no more decimal places than the currency has."** This is shown for **Amount off** and **Minimum spend**. Write 1,234.50 or 1234.50, not 1 234,50.
- **"Enter an amount above 0."** / **"That amount is too long: 18 digits at most."**
- **"Choose at least one product, or All products."**
- **"Enter a real date."**
- **"The last day is before the first."**
- **"Enter a whole number of days from 1 to 1,000, or leave it empty."** **Minimum days** takes whole numbers only, with no decimal point.
- **"Enter a whole number from 1, or leave it empty for no limit."** **Total uses** takes whole numbers only.
- **"Choose at least one place this code can be used."**
- **"One of the chosen products no longer exists. Reload the page and choose again."**
- **"Check the coupon’s details and save again."**
- **"Someone is making a booking with this coupon right now, so nothing was saved. Please save again."** Nothing was changed. Press **Create coupon** or **Save coupon** again.
- **"Only an owner or a manager can change coupons."**
