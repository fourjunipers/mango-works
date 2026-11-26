---
title: Delete a vehicle
summary: Permanently delete a vehicle added by mistake, or retire it instead when it has bookings.
roles: [owner, manager]
keywords: [delete vehicle, remove bike, added by mistake, duplicate vehicle, retire instead, vehicle busy, try again, ลบรถ, ปลดระวาง]
screens: [/[tenant]/fleet/units/[id]]
updated: 2026-11-26
---

# Delete a vehicle

Deleting is for a vehicle added by mistake. A vehicle you no longer rent out should be retired or marked sold, which keeps its history: see [Take a vehicle off the road](change-status.md) and [Mark a vehicle as sold](mark-as-sold.md).

Who can do this: owners and managers. Other roles don't see **Delete vehicle**.

## Steps

1. Open the vehicle's page and scroll to the very bottom.
2. Press **Delete vehicle**.
3. Confirm "Delete this vehicle for good? This is permanent and can't be undone. Its purchase and sale details, tax and insurance records, downtime and odometer history are erased with it."

The **Fleet** list opens, without the vehicle.

## Common problems

- **"This vehicle is on bookings, so it can't be deleted: past orders need it. You can retire it instead: it leaves the fleet list and can't be rented, and its history is kept."** Any booking, past or future, keeps the vehicle. Press **Retire instead** next to the message and confirm. (The button shows only for an Active or Maintenance vehicle; a sold or retired one is already out of the fleet.) If the vehicle still has a future booking, retiring is refused too, with "This vehicle still has a block that ends in the future. End or remove it first."
- **"Someone is saving a booking or a block on this one right now. Please try again."** Nothing was deleted. Wait a moment and press **Delete vehicle** again.
- **"Couldn't save. Please try again."** Reload the page and try again.
