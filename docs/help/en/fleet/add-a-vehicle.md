---
title: Add a vehicle to your fleet
summary: Add one real vehicle, with its plate, frame number, year and location, under a product you already have.
roles: [owner, manager]
keywords: [add vehicle, add bike, add motorbike, new bike, inventory, plate, registration, frame number, chassis number, VIN, engine number, fleet, เพิ่มรถ, ทะเบียน, เลขตัวถัง, เลขเครื่อง, รถทั้งหมด, เพิ่มมอเตอร์ไซค์]
screens: [/[tenant]/fleet, /[tenant]/fleet/units/new, /[tenant]/products/[id]]
updated: 2026-11-26
---

# Add a vehicle to your fleet

A **product** is what you rent out, such as "Honda Click 125". A **vehicle** is one real bike or car of that product, with its own plate. Add the product first ([Create a vehicle product](../products/create-a-vehicle-product.md)), then add each vehicle to it.

Who can do this: owners and managers. Staff, mechanics and drivers don't see the **Add vehicle** button.

## Steps

1. On **Fleet**, open the product's line and press **Add vehicle** under its vehicles, or press **Add vehicle** on the product's **Units** tab. Either way the product is already chosen. (A retired product has no **Add vehicle** button: restore it first.)
2. Check the **Product**. Only your own products are listed. If it isn't there, press **Product not here? Add it first**, fill in the product and press **Save and add a vehicle**: you come back here.
3. Fill in what you know:
   - **Year**: the year of this vehicle, such as 2024.
   - **Odometer (km)**, or **Odometer (mi)** if your shop uses miles. It starts at 0: type the current reading.
   - **Plate**, such as "1กข 1234 Chiang Mai". A new vehicle not registered yet: tick **Plate pending (not registered yet)** instead. Its page then says "This vehicle has no plate yet. Staff are warned before check-out." (Check-out comes in a later update.)
   - **Colour**, **Frame (chassis) number**, **Engine number**.
   - **Location**: where the vehicle is kept. Your first location is chosen to start with.
   - **Notes**: anything else worth knowing.
4. Press **Save**. The vehicle's page opens.

To add many vehicles at once, use [Import vehicles from a CSV file](import-vehicles-csv.md).

## Common problems

- **"Enter the plate, or tick “Plate pending”."** Every vehicle needs a plate or the Plate pending tick.
- **"Another vehicle in this shop already has that plate."** Plates are unique in the shop. Check you aren't adding the same vehicle twice; search for the plate on **Fleet**.
- **"Add a product first. Then come back to add the vehicles you have of it."** The shop has no vehicle products yet (or only retired ones). Press **New product** and create one first.
- **"Required."** under **Product**: choose a product.
- **"Enter a year, such as 2024."** Type the four-digit year, with no decimal point or comma.
- **"Enter a distance, such as 12345."** Type the odometer as a number, without units or spaces: 12345 or 12,345, with a dot for a decimal (12345.5). A comma anywhere else, such as 12,5, is refused. See [Typing amounts, percentages and other numbers](../general/typing-numbers.md).
- **"This product is retired. Restore it first."** Open the product and press **Restore product**.
- **"Couldn't save. Please try again."** Reload the page and try again.
