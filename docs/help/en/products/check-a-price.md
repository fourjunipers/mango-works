---
title: Check a price
summary: Price a sample rental of a product, with seasons, extras, a coupon and the returning-customer discount, before or after saving.
roles: [owner, manager, staff]
keywords: [check price, quote, price calculator, how much, test price, sample rental, breakdown, total, VAT, ตรวจสอบราคา, คำนวณราคา, ราคาเท่าไร, ใบเสนอราคา]
screens: [/[tenant]/products/[id]]
updated: 2026-11-26
---

# Check a price

**Check a price** sits at the bottom of every product's **Pricing** tab. It prices a sample rental with the prices on screen, saved or not ("Prices a sample rental with the prices on screen, saved or not."), using the same pricing as bookings, so Check a price and Save always agree. Nothing is booked and no coupon use is counted.

Here a coupon is judged as for a booking at the counter. To try one for your booking page or Moto Mangos, use the [Price check](../price-check/price-check.md), which prices the saved prices the same way.

Who can use it: owners, managers and staff. Mechanics and drivers have no Pricing tab.

## Steps

1. Open the product's **Pricing** tab and scroll to **Check a price**.
2. Under **Sample rental by**, choose **Number of days** or **Dates**.
3. Set the **Pickup** (it starts tomorrow at 10:00) and either **Days** (1 to 1,000) or **Return**.
4. Set **How many** (1 to 99).
5. Optional, for a vehicle with extras: under **Extras taken with it**, type how many of each extra go with the rental (0 to 99). An extra with some included free says "N included with each".
6. Optional: type a **Coupon code** and press **Apply**. Press **Remove the code** to take it off.
7. Optional: tick **Returning customer** to see the returning-customer discount. The line under it says what the shop gives, for example "10% off rentals for a customer with 3 completed rentals here."

The **Price breakdown** shows:

- **List price**, with how it was worked out, for example "7 days from the price list", "3 hours at ฿60" or "2 weeks".
- Each season, as "Season: {name}" with the number of days inside it.
- Each extra, as "{name} × {count}", with "N of them included" when some are free.
- **Returning-customer discount** and "Coupon {code}", when they apply.
- The tax, as "Includes VAT 7%" (prices include tax) or "VAT 7%" (tax added on top).
- **Total**.
- **Deposit** ("Taken beside the total; never taxed.").

## Common problems

- **"Fill in the prices to check one."** The product has no price yet, or the prices on screen aren't complete: for example no method is chosen, daily or monthly is missing, or no price list is chosen.
- **"This rental can't be priced. Check the dates and the quantity."** For example, the return is before the pickup, or **Days** or **How many** is empty or not a whole number.
- **"The shop’s returning-customer discount is off (Settings › Pricing and tax)."** See [Set up the returning-customer discount](../pricing-settings/returning-customer-discount.md).
- **"The code couldn’t be checked. Please try again."** Press **Apply** again.
- A coupon that isn't applied says why: see [Why a coupon wasn't applied](../coupons/coupon-not-applied.md).
