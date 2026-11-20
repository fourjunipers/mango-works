---
title: Review Moto Mangos catalog requests
summary: For platform admins: approve, reject or merge the bike models that shops have asked to add to the Moto Mangos list.
keywords: [catalog requests, platform admin, approve, reject, merge, Moto Mangos, bike catalog, model years, review, อนุมัติ, ปฏิเสธ, รวมรายการ, ผู้ดูแลแพลตฟอร์ม]
screens: [/admin/catalog]
updated: 2026-11-20
---

# Review Moto Mangos catalog requests

When a shop's bike isn't on the Moto Mangos list, the shop sends its details for review: see [Connect a motorbike to Moto Mangos](../products/connect-a-bike-to-moto-mangos.md). Those requests land on **Catalog requests**, at `/admin/catalog`, for Mango Works staff to review. This is not part of a shop's own screens.

Who can do this: platform admins only (people listed as platform admins by Mango Works). A shop owner, manager or anyone else who opens the page is told it isn't found. If you are not signed in, you are taken to sign in first and come back here.

The page says: "Models shops want on Moto Mangos that match no entry. Approve to add it to the list for every shop, or merge it into the entry it really is." With nothing to review it says "No requests waiting."

## What a request shows

The bike's name, its engine size, type and transmission, and "Requested by" the shop. If the shop left a note for the reviewer, it is shown in quotes.

## Steps: approve

1. Open **Catalog requests**.
2. Under **Model years this entry covers**, set the **First model year** and **Last model year**. They start as the one year of the shop's own bike ("The shop’s own bike is a {year}. Set the range of years before you approve."), and are left like that if you don't change them.
3. Optional: type a **Review note**.
4. Press **Approve**.

The model joins the list for every shop. Every product waiting on it is marked approved and its listing is switched on. (This changes with the next platform update: approving will connect the product only, and the shop switches its listing on itself.) The shop's private note and name are removed from the entry.

## Steps: reject

1. Optional but kind: type a **Review note**. "If you reject, the shop sees this note on its model."
2. Press **Reject**.

The shop's product goes back to being its own model, unlisted, and the shop sees the note and can fix the details and send it again. If, while waiting, the shop added the same make and model again as its own, that product can't be given back: the page then says "Rejected. One model stays linked to the rejected entry, unlisted: while waiting, the shop added the same make and model again as its own, and it can't have two." (or "# models stay").

## Steps: merge into an existing entry

Use this when the request is a bike already on the list under another spelling.

1. Under **It is the same bike as**, choose the list entry. The closest matches ("Did you mean") come first.
2. Press **Merge**.

Every product waiting on the request moves to the chosen entry, is marked approved and is listed (until the next platform update, which leaves the listing for the shop to switch on). The request is closed, and its review note records which entry it was merged into.

## Common problems

- **"That didn't work. Please try again."** The decision wasn't saved. Reload the page and try again; the request may already have been reviewed by someone else, in which case it is gone from the list.
- **Merge is greyed out.** There are no approved entries to merge into yet.
- A page that says it isn't found: your account is not a platform admin.
