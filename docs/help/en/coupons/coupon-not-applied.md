---
title: Why a coupon wasn't applied
summary: What each "Not applied" message means when you try a coupon code, and how to fix it.
roles: [owner, manager, staff]
keywords: [coupon not working, code not applied, invalid coupon, coupon expired, coupon used up, discount not working, คูปองใช้ไม่ได้, โค้ดใช้ไม่ได้, คูปองหมดอายุ, ส่วนลดไม่ขึ้น]
screens: [/[tenant]/products/[id], /[tenant]/new-order, /[tenant]/settings/coupons]
updated: 2026-11-26
---

# Why a coupon wasn't applied

Who can do this: owners, managers and staff can try a code in **Check a price**, on a product's Pricing tab (as a booking at the counter) or on the **Price check** tab (for the channel chosen there). Only owners and managers can change coupons. Mechanics and drivers see no prices, so no coupons.

When you type a code in **Check a price** and press **Apply**, you see "Coupon {code} applied." or a message saying why not. Trying a code never uses it up. Orders with coupons come in a later update; the same rules will apply there.

## Messages and what to do

- **"Not applied: the shop doesn’t accept coupons. Switch on “Accept coupons” in Settings › Pricing and tax."** See [Switch coupons on or off for the shop](../pricing-settings/accept-coupons.md).
- **"Not applied: no coupon has this code."** Check the spelling. Codes are letters and numbers only; spaces are ignored, and full-width letters and numbers (such as Ａ or ０) are read as plain ones.
- **"Not applied: this coupon is switched off or archived."** Switch it on in Settings › Coupons, or bring it back. See [Change, switch off or archive a coupon](switch-off-or-archive-a-coupon.md).
- **"Not applied: this coupon can’t be used by staff."** Shown in **Check a price** and under **The counter** in the Price check. Tick **By staff, at the counter or on the phone** under **Where it can be used** if staff should be able to use it.
- **"Not applied: this coupon can’t be used on your booking page."** / **"Not applied: this coupon can’t be used on Moto Mangos."** Shown by the [Price check](../price-check/price-check.md) when you try a coupon for that channel. Tick that channel under **Where it can be used** if it should work there.
- **"Not applied: this coupon can be used from {from}."** Its valid dates haven't started. The valid dates are the days the booking is made, so today counts, not the pickup.
- **"Not applied: this coupon could be used until {to}."** Its valid dates have passed.
- **"Not applied: this coupon has been used as many times as it allows."** Raise **Total uses**, or leave it empty for no limit.
- **"Not applied: this coupon isn’t for these products, or it can’t be used on a season discount."** Check its **Products**, and **Can be used on season discounts**.
- **"Not applied: the pickup isn’t inside this coupon’s pickup dates."**, or "Not applied: the pickup must be from {from} to {to}." (or "on or after {from}", "on or before {to}"). Change the pickup, or the coupon's **Pickup dates**.
- **"Not applied: the rental must be at least N days."** See **Minimum days**. For example, SONGKRAN10 with a minimum of 3 days is refused for a 2-day rental.
- **"Not applied: this coupon’s products must come to at least {amount} after seasonal prices."** See **Minimum spend**.
- **"Coupon {code} not applied: there is nothing left for it to take off."** Other discounts already brought its lines to zero.
- **"Coupon {code} not applied: it can’t be combined with the returning-customer discount, and the larger discount applies. The returning-customer discount takes off at least as much. The code isn’t used up."** The customer still gets the returning-customer discount.
- **"Coupon {code} applied. It can’t be combined with the returning-customer discount, and the larger discount applies: the coupon takes more off."** Not a problem: the coupon replaced the returning-customer discount.
- **"The code couldn’t be checked. Please try again."** A connection problem. Press **Apply** again.
