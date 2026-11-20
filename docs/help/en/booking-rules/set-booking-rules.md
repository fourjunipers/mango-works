---
title: Set your booking rules
summary: Choose how far ahead online bookings must be made, the shortest rental, the time kept free around a rental, how long a booking is held while someone pays, and whether staff can overbook.
keywords: [booking rules, minimum notice, notice, lead time, cut-off, minimum days, minimum rental, shortest rental, buffer, time between rentals, hold, overbooking, overbook, shortage, กฎการจอง, แจ้งล่วงหน้า, จำนวนวันขั้นต่ำ, เวลาว่าง, จองเกิน]
screens: [/[tenant]/settings/booking-rules]
updated: 2026-11-20
---

# Set your booking rules

**Booking rules** decide what can be booked: how far ahead, how short, the time kept free around each rental, how long a booking is held while the customer pays, and whether staff can take a booking when every vehicle is gone. The rules are checked on every booking, and the [New order price check](../orders/price-check.md) shows them at work.

Who can do this: owners and managers. Everyone else is answered "Page not found".

## Steps

1. Open **Shop settings** and choose the **Booking rules** section.
2. Under **The whole shop** (these apply at every location):
   - **Allow overbooking**: on, staff can still save a booking when every vehicle is taken. It is saved as a shortage, waiting for a vehicle, and you must find one before pickup. Bookings made online are never overbooked.
   - **Hold length (minutes)**: how long a booking keeps its vehicle while the customer pays, 5 to 60 minutes.
   - **Time free before (hours)** and **Time free after (hours)**: time kept free around each rental, for vehicles that have no time of their own. Blank is none; up to 168 hours.
3. For each location (one location: **Your location**; several: **Location: name**). Blank is no rule:
   - **Minimum notice (hours)**: how long before pickup an online booking must be made, 0 to 720. Bookings staff make in the app need no notice.
   - **Cut-off before closing (minutes)**: for "Ride today" on Moto Mangos, no new same-day booking this long before you close, 0 to 1,440.
   - **Minimum days, booked ahead**: the shortest rental for a booking made before the day, 1 to 365.
   - **Minimum days, walk-in**: the shortest rental for a customer at the counter, or "Ride today", 1 to 365.
4. Under **Vehicles**, give a vehicle its own **Booked ahead (days)** and **Walk-in (days)** if it needs them. They are used in place of its location's. Blank uses the location's rule.
5. Press **Save**. **Saved** appears.

Numbers are whole, except the hours of time free, which take a dot for decimals (0.5 is half an hour).

On Moto Mangos, a vehicle's lead time and your minimum notice both count: the longer one applies. The vehicle's Moto Mangos tab says "Bookings need N hours: your shop's minimum notice." when yours is the longer.

## Common problems

- **"Enter a hold length from 5 to 60 minutes."** The hold can't be blank.
- **"Enter whole hours from 0 to 720, or leave it blank."** Minimum notice.
- **"Enter whole minutes from 0 to 1,440, or leave it blank."** Cut-off.
- **"Enter whole days from 1 to 365, or leave it blank."** Minimum days, for a location or a vehicle.
- **"Enter the hours as a number, like 2 or 0.5 (168 at most). Use a dot for decimals; a comma only separates thousands, so 0,5 is not read as a half."** Time free before or after.
- **"Someone is saving a booking right now, so nothing was saved. Please save again."** Press **Save** again.
- **"One of these vehicles no longer exists. Reload the page."** / **"This location is no longer here. Reload the page."** Reload and save again.
- **"These rules couldn't be saved as they were sent. Reload the page and try again."**
- **"Only an owner or a manager can change the booking rules."**
- **"Couldn't save. Please try again."**
