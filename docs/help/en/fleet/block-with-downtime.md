---
title: Block a vehicle for dates (downtime)
summary: Stop a vehicle being booked for a set time, for example while it is at the garage, and end the block early if needed.
roles: [owner, manager, staff, mechanic]
keywords: [downtime, block, unavailable, garage, service, repair dates, hold, block dates, ช่วงงดให้เช่า, งดให้เช่า, ปิดรถ, ซ่อม]
screens: [/[tenant]/fleet/units/[id]]
updated: 2026-11-26
---

# Block a vehicle for dates (downtime)

**Downtime** "Blocks this vehicle from bookings." Times are in the time zone of the vehicle's location, shown on the screen (for example "Times are Asia/Bangkok time.").

Who can do this: owners, managers, staff and mechanics. Drivers see the downtime but can't add or end it.

## Steps

1. Open the vehicle's page and scroll to **Downtime**.
2. Fill in **From** ("Leave blank to start now.") and **Until** ("Leave blank to block it until someone ends it.").
3. Add a **Reason** if you like, such as "Brake service at the garage".
4. Press **Add downtime**.

The block appears in the list as "Downtime: {reason}" with its dates. An open-ended one says "until ended". With nothing planned, the section says "No downtime now or planned."

A sold or retired vehicle has no **Add downtime** form: it can't be blocked.

## End or remove downtime

- **End now** stops a block that has started.
- **Remove** deletes a block that hasn't started yet.

Past blocks are listed under **Earlier blocks**. Bookings have their own section: see [See a vehicle's bookings](bookings-on-a-vehicle.md).

## Common problems

- **"Enter a real date."** Check **From** and **Until**.
- **"This vehicle is already blocked for part of that time. Pick other times, or end the other block first."** It overlaps a booking or another block. Choose other times.
- **"This vehicle has been sold or retired, so it can't be blocked."**
- **"The end must be after the start."** **Until** is before **From**.
- **"That downtime was already ended or removed by someone else. This is the vehicle as it is now."** Nothing to do: the page now shows the current blocks.
- **"Couldn't save. Please try again."** Reload the page and try again.
