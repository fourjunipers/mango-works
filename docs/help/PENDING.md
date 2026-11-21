# Pending article updates

Changes waiting on unmerged work. When the PR merges, update the articles listed, set their `updated` date, and delete the entry here.

## Next platform migration: catalog approval leaves the listing off (Mark, 20 Nov 2026)

Today `platform.review_catalog_request()` switches a model's Moto Mangos listing on when a request is approved or merged (`docs/PROGRESS.md`, "Next platform migration"). When the migration that stops it lands:

- `en/platform-admin/review-catalog-requests.md` (approve and merge): approving or merging connects the product only; the shop switches its listing on itself. Remove the "(This changes with the next platform update…)" notes.
- `en/products/connect-a-bike-to-moto-mangos.md` (step 6): not "listed automatically"; the shop switches the listing on from the Moto Mangos tab, as any connected bike ([Switch a bike on or off Moto Mangos](en/products/moto-mangos-listing.md)).
- Set their `updated` dates and delete this entry.
