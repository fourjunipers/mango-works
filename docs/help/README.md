# Help articles

Plain-language help for shops using the platform (`apps/platform`). The support assistant searches these first and will later write an AI answer from them (docs/platform/SPEC.md › Support assistant and support chat). They are written so search alone answers most questions.

English only for now (`en/`). Thai (`th/`, same paths) comes after Korn's review.

## Index

### Signing in and your device (`en/account`)

- [Sign in to your shop](en/account/sign-in.md)
- [Switch shop and set up this device](en/account/switch-shop-and-device.md)

### Team (`en/team`)

- [Change a team member's role](en/team/change-a-role.md)
- [Remove someone from the team](en/team/remove-someone.md)

### Locations and opening hours (`en/locations`)

- [Add a location](en/locations/add-a-location.md) (also: delete one)
- [Set opening hours](en/locations/set-opening-hours.md)
- [Add a closure (holiday or day off)](en/locations/add-a-closure.md)
- [Change a location's time zone](en/locations/change-time-zone.md)

### Shop settings (`en/shop-settings`)

- [Change your shop's name, country, currency and formats](en/shop-settings/shop-details.md)
- [Set tax and insurance reminders](en/shop-settings/tax-and-insurance-reminders.md)

### Fleet (`en/fleet`)

- [Add a vehicle to your fleet](en/fleet/add-a-vehicle.md)
- [Import vehicles from a CSV file](en/fleet/import-vehicles-csv.md)
- [Find a vehicle in your fleet](en/fleet/find-a-vehicle.md)
- [Change a vehicle's details or move it to another location](en/fleet/edit-a-vehicle.md)
- [Update a vehicle's odometer](en/fleet/update-odometer.md)
- [Take a vehicle off the road (maintenance or retire)](en/fleet/change-status.md)
- [Mark a vehicle as sold](en/fleet/mark-as-sold.md)
- [Block a vehicle for dates (downtime)](en/fleet/block-with-downtime.md)
- [Record road tax, insurance or an inspection](en/fleet/record-tax-and-insurance.md)
- [Print QR stickers for your vehicles](en/fleet/print-qr-stickers.md)
- [Delete a vehicle](en/fleet/delete-a-vehicle.md)

### Products and prices (`en/products`)

- [Create a vehicle product (what you rent out)](en/products/create-a-vehicle-product.md): kinds and categories
- [Add rental gear, a service or an item for sale](en/products/create-gear-or-service.md)
- [Delete or restore a product](en/products/delete-or-restore-a-product.md)
- [Set prices by rental length](en/products/price-by-rental-length.md): quick entry, the 30-day table
- [Set a long-stay daily rate (rentals over a month)](en/products/long-stay-rate.md)
- [Use a shared price list on a product](en/products/use-a-price-list.md)
- [Set a flat fee, fixed price or free](en/products/flat-fixed-or-free-price.md)
- [Set a deposit on a vehicle](en/products/vehicle-deposit.md)
- [Choose the tax on a product](en/products/product-tax.md)
- [Offer extras with a vehicle](en/products/offer-extras-with-a-vehicle.md)
- [Check a price](en/products/check-a-price.md)

### Pricing and tax settings (`en/pricing-settings`)

- [Set the rounding step](en/pricing-settings/rounding-step.md)
- [Choose whether prices include tax](en/pricing-settings/tax-inclusive-or-added.md)
- [Add, change or remove a tax profile](en/pricing-settings/tax-profiles.md)
- [Choose how the shop takes deposits](en/pricing-settings/deposit.md)
- [Switch coupons on or off for the shop](en/pricing-settings/accept-coupons.md)
- [Set up the returning-customer discount](en/pricing-settings/returning-customer-discount.md)
- [Offer extras with every vehicle](en/pricing-settings/extras-for-every-vehicle.md)

### Seasons (`en/seasons`)

- [Set a seasonal price](en/seasons/set-a-seasonal-price.md)
- [Change, switch off or delete a season](en/seasons/switch-off-or-delete-a-season.md)

### Price lists (`en/price-lists`)

- [Create a price list](en/price-lists/create-a-price-list.md)
- [Change or delete a price list](en/price-lists/change-or-delete-a-price-list.md)

### Coupons (`en/coupons`)

- [Create a coupon](en/coupons/create-a-coupon.md)
- [Change, switch off or archive a coupon](en/coupons/switch-off-or-archive-a-coupon.md)
- [Why a coupon wasn't applied](en/coupons/coupon-not-applied.md)

### Not covered yet

Screens that are on `main` but have no article yet: the Moto Mangos tab on a product, rental gear stock (the Stock tab, Report a problem, Out of service), a product's History tab, and the platform admin's catalog requests. Screens that are still placeholders (Dashboard items beyond tax and insurance, Orders, New order, Maintenance's due list) get articles when their phase builds them. Booking rules (notice, cut-off, minimum days) are in the database but have no screen yet.

## Article format

One task per article, in `docs/help/<language>/<area>/<slug>.md`. Each starts with front matter:

```yaml
---
title: Create a coupon                 # the task, as a shop would say it
summary: One sentence saying what the article helps with.
keywords: [coupon, discount code, คูปอง, โค้ดส่วนลด]   # likely search words, English and Thai script
screens: [/[tenant]/settings/coupons]  # the route paths (apps/platform/app) it covers
updated: 2026-11-19                    # the date the article was last checked against the screen
---
```

Then:

1. A heading the same as the title, and a short paragraph on what the screen is for.
2. **Who can do this**: the roles, as the code allows them (`apps/platform/lib/roles.ts`, `pricing-permissions.ts`, `extras-permissions.ts`).
3. **Steps**: short numbered steps. Button and field names in bold, spelled exactly as in `apps/platform/messages/en.json`.
4. **Common problems**: every refusal message the screen can show, quoted exactly from `en.json` in bold, with what to do about it. Placeholders stay as `{name}` or `N`.

Write what the screen does today, from the code and the message files. Where the spec says something different, the article follows the screen (and the difference is raised with the owner, not written up as fact). No hard-coded country, currency or time zone: say "your currency", and give Thai examples only as examples.

## Keeping articles current

- **Every PR that changes a screen updates its article** in the same PR: labels, steps, refusal messages, who can do it, and the `updated` date. A new screen ships with its articles (SPEC: "Each phase ships its articles with its code").
- To find the articles for a screen, search the `screens:` lines for its route, or search `docs/help` for the message key's English text.
- A PR that changes `en.json` checks that every quote in `docs/help` that used the old text is changed too.
- Work that changes articles but isn't merged yet is listed in [PENDING.md](PENDING.md). When it merges, update the articles and remove its entry.
- Thai articles mirror the English paths under `th/` and are updated in the same PR once they exist.
