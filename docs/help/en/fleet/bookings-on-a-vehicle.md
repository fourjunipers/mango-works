---
title: See a vehicle's bookings
summary: On a vehicle's page, see the bookings it is set aside for, held, booked, out or returned, with their dates.
roles: [owner, manager, staff, mechanic, driver]
keywords: [vehicle bookings, who has this bike, is this bike booked, when is it free, hold, held, booked, out, overdue, returned, reservation, การจอง, รถถูกจอง, จองแล้ว, คืนแล้ว, เลยกำหนด]
screens: [/[tenant]/fleet/units/[id]]
updated: 2026-11-26
---

# See a vehicle's bookings

A vehicle's page has a **Bookings** section: "The bookings this vehicle is set aside for." Times are on the clock of the vehicle's location. It is read-only. Bookings are made and changed from orders, which come in a later update.

Who can do this: everyone in the shop (owners, managers, staff, mechanics and drivers). No prices are shown here.

## Steps

1. Open **Fleet** and tap the vehicle (or scan its sticker: see [Scan a vehicle's QR sticker](scan-a-qr-sticker.md)).
2. Find **Bookings**. Each booking shows what it is, and its dates as "{from} to {to}":
   - **"Held until …, while the customer pays"** (or **"Held while the customer pays"**): a booking being paid for. It keeps the vehicle until then, for the shop's hold length (see [Set your booking rules](../booking-rules/set-booking-rules.md)).
   - **"Booked"**: a confirmed booking.
   - **"Out with the customer"**: picked up.
   - **"Out and overdue: still blocked until it comes back"**: past its return. The vehicle stays blocked until it is back.
3. Open **Earlier bookings** to see the last 5 that are over:
   - **"Returned"**: the vehicle came back.
   - **"Hold ran out"**: the customer didn't pay in time. It holds nothing, and goes from the list within a minute.
   - **"Booked"**: a booking whose dates have passed.

**"No bookings now or coming up."** means nothing is booked on this vehicle.

Downtime has its own section under it: see [Block a vehicle for dates (downtime)](block-with-downtime.md).

## Common problems

- A hold reads "Hold ran out", then disappears: the customer didn't pay in time.
- Pickup and return aren't recorded on the platform yet, so "Out" and "Returned" appear once check-out and check-in arrive in a later update.
