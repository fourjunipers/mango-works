---
title: Import vehicles from a CSV file
summary: Add many vehicles at once from a spreadsheet saved as CSV, creating any missing products on the way.
keywords: [import, CSV, spreadsheet, Excel, bulk upload, many vehicles, template, นำเข้า CSV, นำเข้ารถ, ไฟล์ CSV, สเปรดชีต]
screens: [/[tenant]/fleet/import]
updated: 2026-11-19
---

# Import vehicles from a CSV file

One row per vehicle. The whole file is checked first: if any row has a problem, nothing is saved.

Who can do this: owners and managers.

## Steps

1. Open **Fleet** and press **Import CSV**.
2. Press **Download a template** and fill it in, one vehicle per row. The columns are:
   - **product** (required): the product's name, exactly as on your Products page. A name you don't have yet creates the product.
   - **vehicle_type**: motorbike, car, atv, boat or other. Blank means motorbike. Only used when the row creates a new product.
   - **category**: required for a new motorbike or car. For several, separate them with a semicolon, like "adventure; touring". The page lists the choices under **Categories**.
   - **year**: the vehicle's own year.
   - **plate**: leave blank for a vehicle without one yet.
   - **frame_number**, **engine_number**, **colour**
   - **odometer**: in your shop's distance unit.
   - **location**: a location's name.
   - **purchase_date** (YYYY-MM-DD), **purchase_price** (in your currency), **purchased_from**
3. Save the spreadsheet as CSV.
4. Choose it under **CSV file**, or paste the rows into **Or paste the rows here**.
5. Press **Check and import**.

When it works you see, for example, "Imported 20 vehicles and 2 new products." Press **See the fleet**.

There is no make, model, engine size or transmission column: put the make, model and years in the product's name or description if you want them.

## Common problems

If anything is wrong you see "N problems found. Nothing was imported." and a table with the **Line**, **Column**, **Problem** and **Value**. Fix those rows and import again. The problems are:

- **"That file is too big (limit 1 MB)."** Split it into smaller files.
- **"Choose a file or paste the rows."**
- **"The file is empty."** / **"The file has a header but no vehicles."**
- **"A file can hold at most 1,000 vehicles."** Split the file.
- **"A quote opened on this line is never closed."** A cell has an unmatched quote mark.
- **"This column appears twice."** / **"This column isn't one of the import columns."** / **"The file needs this column."** Check the header row against the template.
- **"Required."** / **"Too long."**
- **"This plate appears on an earlier line."** The same plate is in the file twice.
- **"A vehicle in your fleet already has this plate."** The vehicle is already in your fleet; remove the row.
- **"Not a date in YYYY-MM-DD form."** Write dates like 2025-03-31.
- **"Not a number."** / **"Not an amount in your currency."** / **"Not a year, such as 2024."**
- **"No location has this name."** Use a name from your Locations page.
- **"Use motorbike, car, atv, boat or other."** Check **vehicle_type**.
- **"This isn't one of the categories for that kind of vehicle."** Use a category listed under **Categories** for that kind.
- **"A new motorbike or car needs a “category”."**
- **"The file passed the checks but couldn't be saved. Nothing was imported."** Try again; if it keeps happening, ask for help.
