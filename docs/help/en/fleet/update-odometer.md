---
title: Update a vehicle's odometer
summary: Type in the current odometer reading of a vehicle, in km or miles.
roles: [owner, manager, staff, mechanic]
keywords: [odometer, mileage, km, kilometres, miles, reading, meter, เลขไมล์, ระยะทาง, กิโลเมตร, อัปเดตเลขไมล์]
screens: [/[tenant]/fleet/units/[id], /[tenant]/maintenance]
updated: 2026-11-26
---

# Update a vehicle's odometer

Who can do this: owners, managers, staff and mechanics. Drivers see the reading but can't change it.

## Steps

1. Find the vehicle: on **Fleet**, or on the **Maintenance** tab type the plate, frame or engine number, or press **Scan QR** and point the camera at its sticker (see [Scan a vehicle's QR sticker](scan-a-qr-sticker.md)).
2. On the vehicle's page:
   - Owners and managers: change **Odometer (km)** under **Details** and press **Save**.
   - Staff and mechanics: type the reading in **Odometer (km)** under **Odometer** and press **Save**.
3. If the new reading is lower than the current one, confirm "Are you sure? This is lower than the current reading ({current} {unit})." Everyone who can update the odometer can do this; the change is recorded with who made it.

The reading is in the shop's distance unit: km or miles, set under **Distances** in **Shop settings**. With miles, the box says **Odometer (mi)**.

Staff and mechanics can't change the odometer of a vehicle that has been sold or retired: its page only shows the last reading.

## Common problems

- **"Enter a distance, such as 12345."** Type a plain number with no units or spaces. Use a dot for decimals (12345.5, one decimal place at most); a comma is accepted only between thousands, so 12,345 is fine and 12,5 is refused. For how to type numbers, see [Typing amounts, percentages and other numbers](../general/typing-numbers.md).
- **"No vehicle matches “{query}”."** On Maintenance, check the plate, frame or engine number. Use **Scan QR** if the sticker is on the vehicle.
- **"That code isn't one of your vehicle stickers. Keep the camera on a sticker."** The scanner read another QR code. Point it at the vehicle's own sticker.
- **"The camera is blocked for this site. Allow it in the browser's site settings, then try again."** Allow camera access for the platform in your browser.
- **"This browser can't use the camera here. Use your phone's camera app instead: it opens the same sticker."** Open your phone's camera app and scan the sticker there.
- **"The camera couldn't be opened. Close other apps using it and try again."**
- **"This vehicle was changed by someone else while this form was open. Reload the page to see the latest, then make your change again."** Owners and managers: someone saved this vehicle after you opened it. Reload and type the reading again.
- **"Couldn't save. Please try again."** Reload the page and try again.
