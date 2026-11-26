---
title: Take a vehicle off the road (maintenance or retire)
summary: Set a vehicle to Active, Maintenance or Retired, and what each status does to bookings.
keywords: [status, maintenance, repair, off road, out of service, retire, restore, unavailable, active, สถานะ, ซ่อมบำรุง, ปลดระวาง, งดให้เช่า, ซ่อม]
screens: [/[tenant]/fleet/units/[id]]
updated: 2026-11-26
---

# Take a vehicle off the road (maintenance or retire)

Each vehicle has one status. Scheduled downtime for set dates is separate: see [Block a vehicle for dates (downtime)](block-with-downtime.md).

| Status | What it does |
| --- | --- |
| **Active** | Can be rented. |
| **Maintenance** | Can't be rented until it is set back to Active. For planned dates, add downtime instead. |
| **Retired** | Out of the fleet for good. Can't be rented; its history is kept. |
| **Sold** | Sold. Can't be rented. See [Mark a vehicle as sold](mark-as-sold.md). |

Who can do this: staff and mechanics switch between **Active** and **Maintenance**. Owners and managers can also retire, restore and sell. On a sold or retired vehicle, staff and mechanics see the choices greyed out: only an owner or manager can change it.

## Steps

1. Open the vehicle's page.
2. Under **Status**, choose the new status.
3. Save. Choosing **Retired** asks you to confirm "Retire this vehicle? It leaves the fleet list and can't be rented or booked. Its history is kept, and you can restore it later."

## Bring a retired vehicle back

1. Open **Fleet**, set **Show** to **Sold and retired** in the filters, and open the vehicle.
2. Press **Restore**. It comes back as Active.

## Common problems

- **"This vehicle still has a block that ends in the future. End or remove it first."** Retiring or selling needs its future downtime or bookings cleared first. End or remove the downtime under **Downtime**.
- **"Only an owner or manager can change that."** Staff and mechanics can only switch between Active and Maintenance. For example, setting a sold or retired vehicle back to Active needs an owner or manager.
- **"Couldn't save. Please try again."** Reload the page and try again.
