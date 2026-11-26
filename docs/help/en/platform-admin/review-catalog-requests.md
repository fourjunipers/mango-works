---
title: Review Moto Mangos catalog requests
summary: For platform admins: approve, reject or merge the bike models that shops have asked to add to the Moto Mangos list.
roles: [platform-admin]
keywords: [catalog requests, platform admin, approve, reject, merge, Moto Mangos, bike catalog, model years, review, อนุมัติ, ปฏิเสธ, รวมรายการ, ผู้ดูแลแพลตฟอร์ม]
screens: [/admin/catalog]
updated: 2026-11-26
---

# Review Moto Mangos catalog requests

When a shop's bike isn't on the Moto Mangos list, the shop sends its details for review: see [Connect a motorbike to Moto Mangos](../products/connect-a-bike-to-moto-mangos.md). Those requests land on **Catalog requests**, at `/admin/catalog`, for Mango Works staff to review. This is not part of a shop's own screens.

## Who can do this

Platform admins only (people listed as platform admins by Mango Works). A shop owner, manager or anyone else who opens the page is told it isn't found. If you are not signed in, you are taken to sign in first and come back here.

How to get there: a platform admin who is in no shop goes straight to **Catalog requests** after signing in. One who is also in a shop sees **Platform admin: catalog requests** under **Choose a shop**. The page has its own **Sign out** button.

The page says: "Models shops want on Moto Mangos that match no entry. Approve to add it to the list for every shop, or merge it into the entry it really is." With nothing to review it says "No requests waiting."

## What a request shows

The bike's name, its engine size, type and transmission, and "Requested by" the shop. If the shop left a note for the reviewer, it is shown in quotes.

## Steps: approve

1. Open **Catalog requests**.
2. Under **Model years this entry covers**, set the **First model year** and **Last model year**. They start as the one year of the shop's own bike ("The shop’s own bike is a {year}. Set the range of years before you approve."), and are left like that if you don't change them.
3. Optional: type a **Review note**.
4. Press **Approve**.

The model joins the list for every shop. Every product waiting on it is marked approved and connected to the entry. Approving does not list it: the shop switches its Moto Mangos listing on itself. The shop's private note and name are removed from the entry.

## Steps: reject

1. Optional but kind: type a **Review note**. "If you reject, the shop sees this note on its model."
2. Press **Reject**.

The shop's product goes back to being its own model, unlisted, and the shop sees the note and can fix the details and send it again. If, while waiting, the shop added the same make and model again as its own, that product can't be given back: the page then says "Rejected. One model stays linked to the rejected entry, unlisted: while waiting, the shop added the same make and model again as its own, and it can't have two." (or "# models stay").

## Steps: merge into an existing entry

Use this when the request is a bike already on the list under another spelling.

1. Under **It is the same bike as**, choose the list entry. The closest matches to the request come first, then every other entry.
2. Press **Merge**.

Every product waiting on the request moves to the chosen entry and is marked approved. Merging does not list it: the shop switches its Moto Mangos listing on itself. The request is closed, and its review note records which entry it was merged into.

## Common problems

- **"That didn't work. Please try again."** The decision wasn't saved. Reload the page and try again; the request may already have been reviewed by someone else, in which case it is gone from the list.
- **Merge is greyed out.** There are no approved entries to merge into yet.
- A page that says it isn't found: your account is not a platform admin.
