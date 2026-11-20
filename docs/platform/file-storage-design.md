# Shop file storage (Google Drive): design

**Draft 2, 20 Nov 2026, for a Fable critique.** Design only: no code, no migration, no test, nothing applied anywhere, no Google Cloud project created. Draft 1 put fourteen decisions to Mark; **he decided all fourteen as recommended on 20 Nov 2026** (§12). §15 lists what changed.

**Mark's decision (19 Nov 2026, Phase 1b plan decision 10):** private files are not stored on the platform. Each shop connects its own Google Drive; the platform keeps only a link (the Drive file id). One module serves every file feature. A shop with no connected Drive can't attach files; everything else works.

Written from `main` at `9622342`, and these branches as they stood on 20 Nov 2026: `platform/phase-1b-plan` (`ac8a615`: §7, the outline and its seven questions, and the SPEC lines it corrected), `docs/neon-move-plan` (`a3f84f9`: stage 6, files to R2, and the "do not start using" list), `docs/payments-design` (`10a8c87`: §6 tax documents, §7 vendor billing, §8.2 secrets) and `platform/phase-3-plan-draft` (§3.9 roles). Also read: the root and platform `CLAUDE.md`, `docs/platform/SPEC.md` (Customers and KYC with its PDPA points, Check-out and check-in, Documents and messages, Data model, Review decisions), `docs/PROGRESS.md` ("What does not follow the four rules yet"), `supabase/migrations/20261104000600_storage.sql` and the four marketplace files that call `.storage`.

**How Google facts are marked.** Every statement about Google Drive, OAuth or Google's verification was checked against Google's own pages on **20 Nov 2026** and carries a key such as [D1] or [G5], listed in §14. Most wording was read through a page summariser, so quotes are close to the page but not guaranteed word for word. **Unclear** means Google's pages do not say; each such point is a check for the spike (stage 1).

## Summary

1. **Two kinds of file, two homes.** Private files (identity documents, inspection and damage photos, signed agreements, receipts, renewal documents, tax-invoice PDFs) go to the shop's Drive. Public listing images (Moto Mangos shop and bike photos, catalog stock photos, a shop's logo) stay platform-hosted, because the public site serves them to anyone (§1).
2. **The Neon plan's stage 6 gets smaller.** It moves only the three public photo buckets to R2. There is no private bucket, no presigned address for a passport, and its "medium risk for Phase 4 documents" goes away (§1.3).
3. **The scope is `drive.file`, which Google lists as non-sensitive** [G1]. For an app using only non-sensitive scopes, Google's verification is **not mandatory** [G2]; brand verification (2 to 3 business days by Google's estimate [G5]) is needed only to show our name and logo on the consent screen. It needs a public homepage on a verified domain and a privacy policy [G3], so **the platform's product name and domain must be chosen first** (decision 10).
4. **The owner connects one Google account per shop.** Its refresh token is encrypted in the app (AES-256-GCM, master key in the environment, the same pattern as payments §8.2), kept in a table no signed-in role can read, and decrypted only inside the storage module (§2).
5. **Uploads go from the browser straight to Drive** through a resumable session our server opens with the shop's token and hands to the browser for that one file; the token itself never leaves the server. Photos are shrunk in the browser first (2048 px, location data removed). Drive's pages do not say whether a browser may send to a session address (CORS); the spike must prove it, and a server relay is the fallback (§3).
6. **Viewing goes through our server**, which checks the role, writes the access log in the same database call, and streams the file. Grids show a small preview file that the browser makes and stores beside the full one, so a phone at the counter loads 20 KB images, not 600 KB ones (§4).
7. **The platform deletes for good, never to the bin.** `files.delete` skips the trash and works with `drive.file` on files the user owns [D7]. The platform can't empty the shop's bin (that needs the full `drive` scope [D9]); files a person bins by hand are removed by Google after 30 days [D8] (§7).
8. **Every failure is a state the screens show**: Drive disconnected or refused, file missing, file in the Drive bin, Drive full, Google slow. The links are never removed by a failure; reconnecting the same account brings everything back (§6).
9. **Mango Works pays Google nothing today.** Standard Drive API use has no charge [D2]. Google says charges for going **over** quota are planned "later in 2026" with at least 90 days' notice [D2]; our expected use is far under quota (§10). The shop pays Google if its own Drive fills past its free 15 GB [D5].
10. **Eight stages: a Fable spike, four Fable builds (tokens, uploads, viewing, deletion), three Opus with a Fable check**, between 1b and Phase 4: 0 → 1a → 2 → 3 → Neon move → 3M → 1b → **file storage** → 4 (§11).
11. **Fourteen decisions, all decided by Mark on 20 Nov 2026** (§12). The ones that shape the design: a check-out without a connected Drive completes without photos, with a clear warning on the check-out screen that no photos will be kept (decision 6); tax-invoice data is the record and the PDF is regenerated (decision 8); Mango Works' own files go to Mango Works' own Drive (decision 9); Mango Works staff never open shop files, and support asks the shop for a screenshot instead (decision 12).

## 1. What lives where

### 1.1 Private files: the shop's Drive

| File | Phase | Belongs to | Notes |
| --- | --- | --- | --- |
| Maintenance job receipt | 1b, fields added by this stage | `maintenance_jobs` | Photo or PDF |
| Renewal document (insurance, tax, inspection) | 1b, fields added by this stage | `unit_renewals` | Photo or PDF |
| Purchase and sale receipts of a vehicle | 1a fields, file added later | `unit_financials` | SPEC Vehicle record › Ownership |
| Passport, licence, IDP, visa (front, back) | 4 | `customer_documents` | Identity documents: the strictest kind (§4.2, §7) |
| Check-out and check-in photos, damage-mark photos | 5 | `inspections` | Up to about 10 a rental |
| Customer signature image | 5 | `inspections` | See decision 6 for keeping the signature as data |
| Signed agreement PDF | 5, 6 | `documents` | Its hash stays on the platform (SPEC: "signer, time, device and hash") |
| Invoice, tax invoice/receipt, credit note PDFs | 6 | `documents` | 5-year keeping rule; see decision 8 |
| Payment slip, receipt photo for cash or transfer | 3 fields, file added later | `payments` | |
| Cash paid out receipt | 10 | `cash_expenses` | |
| Traffic fine notice photo | later | fines | |

### 1.2 Public files: platform-hosted

| File | Where today | After the Neon move |
| --- | --- | --- |
| Shop photos (Moto Mangos) | Supabase Storage, public bucket `shop-photos` | R2, public, on a custom domain |
| Model (bike) photos | `model-photos` | R2 |
| Catalog stock photos | `catalog-photos` | R2 |
| Shop logo for documents and the booking page | Not built | R2, with the others |

These are shown to anyone on the public sites, need a fast CDN, and carry no personal data. Keeping them in a shop's Drive would make the public site depend on every shop's Google token. They stay platform-hosted, as Mark's decision says.

**A rule for the boundary:** a file is public only if the public site shows it to someone who is not signed in. Anything else is private and goes to the shop's Drive. A photo of a damaged bike is private even though it shows only a bike: it belongs to a rental and a customer.

### 1.3 How the Neon plan's stage 6 changes

The Neon plan's stage 6 ("Files": rule 2's module, R2 buckets, the six storage policies as server-side checks, a copy script) assumed Phase 4 documents would sit in a private R2 bucket behind presigned addresses. With this decision:

- **Stage 6 moves only the three public buckets.** No private bucket is made, so presigned addresses for private files are not needed. Its risk line "Medium for Phase 4 documents" goes.
- **Stage 6 still builds rule 2's module**, with one backend, the public store. This design adds the second, the private store (§9), so the module is built once with room for both. If the file storage stage were ever built before the Neon move (it is not, in the current order), it would create the module itself and stage 6 would add R2 to it.
- **The cost table in the Neon plan §5** counted "50 GB of files with documents" for 50 shops on R2. Only public photos remain, well under R2's free 10 GB at that size.
- **Point-in-time recovery does not cover private files** (Neon plan §7.4 already says R2 is outside it). Neither does anything of ours: the shop's Drive is the only copy. §6.6 says what that means.
- **The "do not start using" list** already forbids policies on `storage.objects` and Vault; this design uses neither.

The edits to `docs/platform/neon-move-plan.md` are listed exactly in §13.3, for the consolidation pass.

## 2. Connecting a Drive

### 2.1 Scope

**`https://www.googleapis.com/auth/drive.file` only.** Google defines it as files created or opened with the app, or shared with it through the Picker [G1], and lists it among the **non-sensitive** scopes, which "only require basic OAuth App Verification" [G1]. The platform can't see anything else in the shop's Drive. Nothing in this design needs a wider scope; two things it would like are refused to `drive.file` and are designed around:

- Emptying the bin needs the full `drive` scope [D9] (§7.3).
- The hidden app-data folder needs `drive.appdata` [D17], and the user can't see its files; we want the shop to see its own files, so we don't use it.

Sign-in with Google (Better Auth, after the Neon move) asks only for name and email. The Drive connection is a **separate consent**, asked on the Settings screen, never added to sign-in, so a staff member who signs in with Google never grants Drive access by accident.

### 2.2 Google's verification

| Point | What Google says | Source |
| --- | --- | --- |
| Is verification required? | For non-sensitive scopes only, "it is not mandatory for your app to complete the app verification process" | [G2] |
| What brand verification is for | Showing the app's name and logo on the consent screen | [G2] |
| What brand verification needs | A public homepage on a verified domain that describes the app (a sign-in page alone does not count); a privacy policy on the same domain, linked from the homepage and the consent screen; every authorised domain verified in Search Console at the top private domain | [G3][G4] |
| How long | Automated checks in minutes; manual review 2 to 3 business days. Publish within 7 days or the status becomes "Need to re-verify" | [G4][G5] |
| Sensitive or restricted (not needed here) | Sensitive about 10 business days; restricted about 6 weeks plus a CASA security assessment, revalidated every year | [G5][G6] |
| The 100-user cap and the "unverified app" screen | Stated for apps using sensitive or restricted scopes. Whether a non-sensitive-only app ever sees either: **not stated**; implied not | [G5][G7] |
| "Testing" publishing status | Refresh tokens expire after 7 days for an External app in Testing | [G8] |
| Data rules that bind us | Google API Services User Data Policy: a privacy policy that fully documents our handling; minimum scopes; Limited Use (user-facing features only, no transfer, **no human reading** without the user's affirmative agreement or a narrow exception, no ads); secure in transit and at rest | [G13] |

**What this means for us**

- **Two Google Cloud projects**: one for local and staging, one for live. Both set to **In production**, not Testing, or every staging connection dies after 7 days [G8]. Verification is not mandatory for either [G2]; brand verification is for live.
- **Brand verification needs the product's name, a domain, a homepage and a privacy policy.** The platform has no name yet (root `CLAUDE.md`, Names). Until it does, the consent screen can't carry a verified brand. Decision 10.
- **Lead time:** 2 to 3 business days by Google's estimate, plus the time to put up the homepage and privacy policy and verify the domain. Start it with stage 2, so it is done long before the first shop connects.
- **Limited Use and "no human reading":** Mango Works staff (support, platform admins) never open a shop's files. Nothing in the platform gives them a way to (§4.2, decision 12); when support needs to see a file, it asks the shop for a screenshot. The privacy policy says so.
- **Drive API quota:** projects created on or after 1 May 2026 get the new unit-based quotas [D2] (§10).

### 2.3 One connection per shop, and who may touch it

- **One active connection per tenant**, not per location. All of a shop's files go to one Drive account, whatever location they come from.
- **Only the owner connects, reconnects or disconnects** (decision 2), as for a payment account (payments design §8.4). The screen says which Google account is connected (its email), when, by whom, and its state.
- **Advice on the screen:** use a Google account that belongs to the business, not a staff member's personal one, with 2-step verification on; anyone who can sign in to that account sees every file, outside our access log (§7.2).
- **A Google Workspace account can be blocked by its admin.** An admin can mark an app Blocked or restrict Drive to trusted apps, and untrusted apps' tokens are then revoked [G10]; the refresh call fails with `admin_policy_enforced` [G8]. The connect screen shows a plain message for this ("Your Google Workspace admin has blocked this app") and the help article says what the admin must allow.
- **Granular consent:** Google lets a user untick scopes on the consent screen; the app must read the granted scopes from the token response [G9]. With one scope, an unticked `drive.file` means no connection: the screen says "Google Drive access was not granted" and saves nothing.
- **Changing to another Google account** (decision 3). With `drive.file`, a new account can't see files the old account holds. Files linked to the old account stay linked to it (each link names its connection) and can't be opened until that account is reconnected. So a switch needs the owner to type the old account's email to confirm, and the screen offers the copy described in decision 3.
- **Shared drives** (Workspace): Drive needs `supportsAllDrives=true` for apps that handle them [D16]; whether a `drive.file` app may create files in a shared drive is **unclear** [D16]. The first build writes to the connected account's own My Drive only (decision 14).

### 2.4 The flow

1. The owner presses **Connect Google Drive** in Settings › File storage. Our server builds the authorisation request: `drive.file`, `access_type=offline` (a refresh token for use when the owner is not present), `prompt=consent` [G9], and a `state` value tied to the tenant, the owner's session and a nonce, kept server-side for 10 minutes.
2. Google sends the owner back to our callback with a code. The server checks `state`, exchanges the code, checks the granted scopes [G9], reads the account's stable id and email, and creates the shop's root folder (§5).
3. The server writes the connection (§2.5) and an audit event, and the screen shows "Connected to …".

**Disconnect** revokes the token at Google (`https://oauth2.googleapis.com/revoke` [G9]), deletes the encrypted token, keeps the connection row as `disconnected` (the links still name it) and writes an audit event. It deletes nothing in the Drive; the screen says so.

### 2.5 Where the token lives, and who can read it

```text
platform_private.storage_connections     no grant to anon or authenticated; service path only
  id, tenant_id, provider ('google_drive'),
  account_id (Google's stable id), account_email,
  root_folder_id, folder_ids jsonb (kind and month → folder id),
  state (active | revoked | disconnected | blocked_by_admin | error),
  granted_scopes, connected_by, connected_at, disconnected_at,
  last_ok_at, last_error_code, last_error_at,
  token_ciphertext, token_nonce, token_key_id        -- refresh token only
  unique (tenant_id) where state <> 'disconnected'

platform.storage_connection_status       a view or security-definer read for owner and manager:
                                         provider, account_email, state, connected_at, last_ok_at; never the token
```

- **Encrypted in the app before it is written**: AES-256-GCM, a fresh nonce per value, the key's id beside it, the master key in each environment's variables. Exactly the pattern of payments §8.2, so one small helper serves both; whichever stage comes first builds it. Not Supabase Vault (on the "do not start using" list), so the Neon move does not touch it.
- **Only the refresh token is stored.** Access tokens (an hour) are kept in the server's memory for the life of a request and never written.
- **Read only on the server's service path** (the same one payments uses for webhooks and jobs), and only after the caller's own database call has said yes (§4.1). No signed-in role can select the table; `default-grants.test.ts` and a cross-tenant test prove it.
- **Rotation of the master key:** a new key id is added, a job re-encrypts every row, the old key is removed after. Written in the runbook with the payments one.
- **Rotation of the refresh token itself** is Google's: if a refresh call returns a new refresh token, it replaces the stored one in the same request.
- **Keeping it alive.** A refresh token unused for six months stops working [G8]. A daily health check (§6.1) uses every active connection, so a quiet shop's token never lapses.
- **The 100-token limit:** Google keeps at most 100 refresh tokens per Google account per OAuth client and silently drops the oldest [G8]. Each reconnect makes a new one; only a shop that reconnects 100 times on one account would meet it. If several shops share one Google account (a group of shops), each connect is one of those 100: the screen does not stop it, the help article mentions it.
- **Cross-Account Protection (RISC)** lets Google tell us when a user's tokens are revoked; it is optional [G11]. Not in the first build: the health check and the first failed call find a revoked token within a day. Worth adding later (§9).

## 3. Uploads

### 3.1 In the browser, before anything is sent

- **Photos are re-encoded in the browser**: longest edge 2048 px, JPEG or WebP around quality 0.8, which keeps a passport readable and lands most photos at 300 to 700 KB. This also **strips EXIF, including the GPS position** a phone writes into a photo, which is personal data we have no reason to keep. The marketplace's `photo-picker.tsx` already resizes this way; its resize step moves into the shared module.
- **A preview** (longest edge 320 px, about 15 to 25 KB) is made from the same image in the same step (§4.3).
- **PDFs are sent as they are**, up to 20 MB. Other types are refused. Accepted types per kind are a list in the module.
- **iPhone HEIC photos:** whether every browser we support can decode them for re-encoding is a check for stage 3, not assumed.
- A SHA-256 of the final bytes is worked out in the browser and sent with the "done" call (§3.3), so the server can check that what Drive holds is what was meant.

### 3.2 Direct to Drive, or through our server

Drive offers simple and multipart uploads up to 5 MB, and **resumable** uploads for larger files or poor networks [D1]. A resumable session address stays valid for a week; an interrupted upload asks Drive how many bytes arrived (`Content-Range: */<total>`, answered `308` with a `Range` header) and sends the rest; chunks are multiples of 256 KB [D1].

| | **A. Browser to Drive, session opened by our server** (decided) | B. Browser to our server, server to Drive (the fallback) |
| --- | --- | --- |
| Token | Stays on the server. The browser gets only one session address, good for one file | Stays on the server |
| Bytes through our functions | None | All of them: every photo crosses our function host twice (in and out) |
| Poor signal at check-out | Resumes where it stopped, for up to a week [D1] | A function call that drops loses the upload; we'd have to build chunking ourselves |
| Function limits | Not met | Request size and run-time limits of the function host apply (Netlify's not checked for this draft) |
| Cost to Mango Works | None | Function bandwidth and run time for every byte |
| Unknowns | Drive's pages **do not say** whether a browser may send to a session address across origins (CORS), nor say outright that the address needs no token on later requests. Their samples send the token only on the request that opens the session [D1]. Google Cloud Storage, a different product, documents both: the address works without further authentication, and CORS works when the opening request carries an `Origin` header [D3] | None; the plainest to build |
| What a leaked session address allows | Writing that one file, for a week | Nothing |

**Decided (decision 1): A, with B as the fallback** if the spike shows Drive refuses the browser. The spike's test: open a session server-side with an `Origin` header, upload from a browser on another origin, interrupt it, resume it.

### 3.3 The upload, step by step

1. **The browser asks** our server: "a file of kind K, for record R, n bytes, type T." The server checks, as the caller, that this person may attach kind K to record R (§4.2), that the shop's connection is `active`, and that the type and size are allowed.
2. **The server writes a `files` row in state `uploading`** with a random upload token, then opens a resumable session at Drive with the shop's token: the name (§5), the parent folder, and `appProperties` carrying our file id and the upload token. `appProperties` are private to our app [D10] (up to 30 per app per file, 124 bytes per key and value [D12]). It returns the session address to the browser. The same is done for the preview.
3. **The browser sends the bytes** to the session address and gets back Drive's file id.
4. **The browser calls "done"** with the Drive file ids and its hash. The server reads each file's metadata from Drive and accepts it only if its `appProperties` carry this row's id and upload token, its size matches, and its parent is the shop's folder. Then the row becomes `ready` with the Drive ids, and the link on record R is written in the same transaction. A file whose check fails is deleted in Drive and the row is marked `failed`.
5. **Rows left in `uploading`** for more than 8 days (the session's week, plus a day) are swept by a job: any Drive file carrying their token is deleted, then the row.

So the browser can never attach a Drive file it did not upload through us, and never one from another shop: the link is written by the server, from metadata it read with the shop's own token.

### 3.4 Failures and retries

| What happens | What the platform does |
| --- | --- |
| Signal drops mid-upload | The browser keeps the file and the session address and resumes [D1]; the field shows "Uploading, 3 of 5" |
| Session expired (404 on resume) [D1] | Ask the server for a new session and start over; the user sees nothing unless that fails too |
| Drive answers 429 or 403 rate limit | Truncated exponential backoff, about 2^n seconds plus up to 1 s of jitter, capped at 32 to 64 s, as Google advises [D2][D4] |
| Drive full (`storageQuotaExceeded`, 403) [D4] | Stop; the field says "The shop's Google Drive is full"; the owner gets a Dashboard item (§6) |
| Connection revoked during the upload | The field says "Google Drive is disconnected"; the file stays queued on the device |
| The user closes the page | Phase 5's check-out queue (IndexedDB) keeps photos and sessions and resumes on the next visit; elsewhere the form warns before leaving |

**Check-out on poor signal (Phase 5's accept test).** The check-out step completes with photos queued, not sent: the inspection row is written at once, each photo is a `files` row in `uploading`, and the order shows "3 photos still uploading" until they land. A week of resumable sessions covers any realistic gap.

## 4. Viewing

### 4.1 The path

The browser never gets a Drive address it could pass on. It asks our server for `/files/<our id>` (or `/files/<our id>/preview`):

1. The server calls `platform.open_file(file_id, purpose)` **as the caller**. This security-definer function checks the tenant and the role for that file's kind (§4.2), **writes the access-log row** (§7.2) for kinds that are logged, and returns the connection id and the Drive file id. No yes, no log; no log, no file.
2. The server gets an access token from the stored refresh token (on the service path) and streams `files.get?alt=media` [D11] back to the browser, passing on `Range` for large PDFs [D11].
3. Headers: `Cache-Control: private, no-store` for identity documents; `private, max-age=300` for previews of other kinds (decision 13). Never a shared cache.

Two things Google offers are not used for this:

- **`webViewLink` and `webContentLink`** [D11] open the file at Google, which needs the viewer to have access to the file in Drive. Staff don't, and shouldn't.
- **`thumbnailLink`** is short-lived ("on the order of hours") [D10]; whether it needs the owner's sign-in is **unclear**. Handing it to a browser would put a Google address for a passport thumbnail in staff browsers' history. We make our own previews instead (§4.3).

### 4.2 Who may see and attach each kind

Proposed, following Phase 3 §3.9 and Phase 1b decision 9. Each is checked in `open_file()` and in the upload's first step, not only in the UI.

| Kind | Owner | Manager | Staff | Mechanic | Driver | Logged |
| --- | --- | --- | --- | --- | --- | --- |
| Passport, licence, IDP, visa | Yes | Yes | Yes (Phase 4 may put this behind a staff permission, "see document images") | No | No | Every view |
| Inspection and damage photos | Yes | Yes | Yes | Bike photos yes, the customer's signature no | No | Every view |
| Signed agreement, invoices, tax invoices, credit notes | Yes | Yes | Yes | No | No | Every view |
| Payment slips, cash receipts | Yes | Yes | Yes | No | No | No |
| Job receipts | Yes | Yes | With "staff can enter and see job costs" | Yes | No | No |
| Renewal documents, vehicle purchase and sale receipts | Yes (purchase and sale: owner and manager only, like `unit_financials`) | Yes | Renewals yes | Renewals yes | No | No |
| Mango Works staff, platform admins, support | **Never**, for every kind and by any route (decision 12; Limited Use [G13]). When support needs to see a file, it asks the shop for a screenshot | | | | | |

### 4.3 Previews and speed at the counter

- **Our own preview file** (320 px, made in the browser at upload, §3.1) is stored in the same Drive folder beside the full file, and the `files` row keeps both ids. Lists and grids load previews; tapping opens the full file.
- **Why not Drive's thumbnails:** see §4.1. Drive can also take a custom thumbnail as base64 in `contentHints.thumbnail` [D10], but reading it back is through `thumbnailLink` again.
- **A PDF's preview** is a first-page image made in the browser where it can be (stage 3 checks the library choice; that would be a new dependency, so it is asked first); otherwise a type icon.
- **Speed.** Every view is: our function → one database call → Google token refresh (cached for the hour) → Drive download → back. Until the functions move to Singapore (Neon plan stage 11) they run in US East, so each image crosses the Pacific twice. The spike measures a preview and a 600 KB photo, from US East and from Singapore, on a phone on 4G. **Target at the counter, functions in Singapore: a grid of 10 previews under 1.5 s, a full photo under 1 s.** If Drive's own latency makes that impossible, the fallback is a short private cache in the browser (never on our side, which would be storing the file).
- **No server-side cache of file content anywhere** (that would be storing files on the platform).

## 5. Folders and names in the shop's Drive

```text
My Drive/
  <Product name> files – <Shop name>/          root, made at connect; its id is kept
    Customer documents/2026-11/
    Inspections/2026-11/
    Agreements and invoices/2026-11/
    Payments/2026-11/
    Vehicles/2026-11/                          job receipts, renewal documents, purchase and sale
```

- **Folders are made by the platform** (`application/vnd.google-apps.folder` [D14]) on first use of a kind and month, and their ids kept on the connection. A folder holds up to 500,000 items [D14]; monthly folders stay far below.
- **Ids, not names, are what count.** If the shop renames or moves a folder in its Drive, the ids are unchanged and nothing breaks. If it deletes one, the files go to the bin with it (§6.3), and a new folder is made on the next upload.
- **Whether `drive.file` lets the app see the folders it created after a rename or move by the user:** Google's pages say nothing about folders specifically [D14][D15]; checked in the spike.
- **File names carry no personal data** (decision 4): `passport-front_ORD-2026-00042_7f3a.jpg`, `checkout-left_ORD-2026-00042_b21c.jpg`, `receipt_job-1187_d9e0.pdf`, `tax-invoice_INV-2026-00042.pdf`. The order or document number lets the shop find a file by hand; the short suffix keeps names unique. A customer's name in a file name would sit in Drive's search and in every Google notification, and stay there after the platform deletes its link.
- **`appProperties`** on each file carry our file id, the tenant id, the kind and the record id [D10], so a lost link can be found again by search (`appProperties has { key='…' and value='…' }` [D13]) and a file can be matched to its row in a check-up job.
- **Previews** sit beside their file, named `…_preview.jpg`.

## 6. When things go wrong

### 6.1 Finding out

- **On every call.** Each Drive call's error is mapped to a connection state or a file state (below), and the connection's `last_ok_at` or `last_error_*` is updated.
- **A daily health check per active connection**: refresh the token and read the root folder's metadata. This keeps the token from lapsing after six months unused [G8] and finds a revoked token within a day even in a quiet shop. Jobs only queue, as the platform's rule is: a `pg_cron` job queues the checks; an app-side worker makes the calls (the Neon plan's "do not start using" list).
- **Drive space.** Whether `about.get` (storage quota) can be read with `drive.file` alone is **unclear** on the pages read; the spike checks it. If it can, the health check warns the owner at 90% full; if not, the first `storageQuotaExceeded` is the warning.

### 6.2 The states and what each shows

| Cause | Google's answer | Connection or file state | What staff see on a file field | What the owner gets |
| --- | --- | --- | --- | --- |
| Owner revoked access in their Google account, password or admin change, token expired | `invalid_grant` on refresh [G8][G9] | Connection `revoked` | "Google Drive is disconnected. Ask the owner to reconnect it in Settings." Existing files show their name, kind and date with a "can't open" mark; nothing is attached | A Dashboard item at once; an email (Phase 3's outbox) |
| Workspace admin blocked the app | `admin_policy_enforced` [G8] | `blocked_by_admin` | As above, "blocked by your Google Workspace admin" | Dashboard item with what the admin must allow [G10] |
| Access token expired | 401 `authError` [D4] | None: refresh and retry once | Nothing | Nothing |
| File deleted for good in Drive | 404 `notFound` [D4] | File `missing` | "This file was deleted from Google Drive" | Listed under Settings › File storage › Problems |
| File in Drive's bin | Read succeeds with `trashed` true | File `in_bin` | Opens, with "In Google Drive's bin: restore it there or it will be deleted after 30 days" [D8] | Listed under Problems |
| File moved out of reach (e.g. to another owner) | 403 `insufficientFilePermissions` or `appNotAuthorizedToFile` [D4] | File `no_access` | "The platform can no longer open this file" | Listed under Problems |
| Drive full | 403 `storageQuotaExceeded` [D4] | Connection `active`, flag `full` | Uploads refused: "The shop's Google Drive is full" | Dashboard item; help link to free space or buy storage [D5][D6] |
| Rate limits | 403 or 429 [D2][D4] | None | Retried with backoff (§3.4); after the cap, "Google Drive is busy, try again" | Nothing, unless repeated: a note in the platform's own error reports |
| Google unreachable | Network error, 5xx | None | "Couldn't reach Google Drive, try again" | Nothing |

- **Links are never removed by a failure.** Only a deletion the platform makes (§7) clears a link.
- **Reconnecting the same Google account** restores every link at once: the file ids are the same. The connect flow checks the account id: same account, the old connection row becomes active again with the new token; a different account goes through decision 3.
- **The order and pickup screens don't stop on a missing file** except where a later phase makes a file a condition (Phase 4: a valid document on file; Phase 5: a completed inspection). Those phases decide what a missing file means for them; decision 6 covers the no-Drive case.

### 6.3 The shop's own actions in Drive

The help article tells the shop plainly: the files in that folder are its records. Renaming or moving them is safe. Deleting them breaks the link and the platform can't bring them back. Sharing the folder with others shows them every passport. Files it bins by hand are deleted by Google after 30 days [D8].

### 6.4 A missing file, found again

If a link is `missing` but a file with that row's `appProperties` exists (a shop restored a copy, say), the Problems list offers "Find it again", which searches by `appProperties` [D13] and relinks only a file whose properties match the row exactly.

### 6.5 Leaving the platform

The shop already owns every file. Its data export (later) lists each file's Drive id and name beside its record, so the files can be matched without us.

### 6.6 No backup on our side

The shop's Drive is the only copy. A shop that deletes its Google account loses its files, and the platform can't help. Settings › File storage says so in one line. This is the cost of Mark's decision, and the SPEC already lists it among the trade-offs.

## 7. PDPA

The shop is the data controller; its Drive is where the files sit; Mango Works processes them for the shop. SPEC's PDPA points 3 to 6 apply as follows.

### 7.1 Retention and automatic deletion (point 4)

- **Each `files` row carries `delete_after`**, set by the rule for its kind when its owning record closes. Identity documents: the shop's `document_retention_months` after the rental closes (default 12), held while a damage or fine case is open (Phase 4 owns the rule; this stage builds the machine). Tax documents: **not** by this rule, see decision 8 (5 years by Thai law, payments §6.1 [T15]).
- **The deletion job** (queued by `pg_cron`, run app-side) deletes each due file **for good** with `files.delete`, which skips the bin and is allowed with `drive.file` for files the user owns [D7]; then the preview; then clears the link and marks the row `deleted` (the row stays, with no Drive id, as proof of deletion: kind, record, when, by the job).
- **If the connection is not active** when a deletion falls due, nothing can be deleted. The file is listed as **"deletion overdue"** for the owner (Dashboard and Problems), with two ways out: reconnect (the job then runs), or "I deleted it in Drive myself", which records who said so and clears the link.
- **The bin:** we never bin, so nothing of ours waits there. The platform can't empty the bin (`emptyTrash` needs the full `drive` scope [D9]); the help article says files the shop bins by hand are removed by Google after 30 days [D8].
- **Files the platform can't reach** (`no_access`, moved to someone else) can't be deleted by it either: listed as "deletion overdue" the same way.

### 7.2 The access log (point 3)

```text
platform.file_access_log     append-only (update, delete, truncate refused by trigger for every role)
  tenant_id, file_id, kind, user_id, action (view | preview | download | delete | export), purpose, at
```

- Written inside `open_file()` (§4.1), so a view that was not logged can't happen.
- Read by owner and manager only, like `audit_events`; on the customer page (Phase 4), "who viewed this document and when".
- It has its own retention, like audit rows (SPEC, Review decisions › Audit), longer than the files it describes.
- **What it can't see:** anyone who opens the files in Google Drive directly with the shop's Google account. Google's own activity view shows that account, not which person. The help article and the connect screen say so; it is why the account should be the business's, with few people holding its password.

### 7.3 A customer's request (point 5)

- **A copy:** the customer page offers "Export this customer's data", which builds a ZIP on the fly from the records and the Drive files, streamed to the owner's browser, never stored. Logged as `export`.
- **Deletion:** the same job as §7.1, run now for every file of that customer that no legal hold keeps (an open fine or damage case, a tax document). What is kept and why is shown before the owner confirms.
- With the connection down, both wait, as in §7.1.

### 7.4 What the Thai lawyer needs to see (1b §7, question 7)

A one-page note for the privacy review before Phase 4 goes live: where the files sit (the shop's own Google account, Google's servers, region not chosen by us); that Mango Works staff can't open them; the scope and what it lets us see; the access log and what it misses; deletion through the API and the bin; and the shop's own duties (account security, not sharing the folder, a breach checklist). Also the question whether the shop's agreement with Google, and ours with each shop, need anything for files held by a foreign provider.

## 8. A shop with no Drive connected

| Area | Without a connection |
| --- | --- |
| Every file field | Shown, disabled, with "Connect Google Drive in Settings to attach files" (owner sees a link to Settings; others see "ask the owner") |
| Maintenance jobs, renewals (1b) | Saved in full; the reference number and notes carry what the receipt would |
| Customer documents (Phase 4) | Number, country, expiry and who checked them are recorded; the expiry rule that blocks a pickup works on the expiry date, not on an image (decision 7) |
| Check-out and check-in (Phase 5) | Completes without photos (decision 6). Odometer, fuel, damage marks on the diagram and their notes work. **The check-out screen shows a clear warning before the photo step, and again where the hand-over is confirmed: "Google Drive is not connected, so no photos will be kept for this rental."** The inspection is recorded as done without photos, and the order shows "No photos kept (Drive not connected)" |
| Signed agreement (Phase 5, 6) | Decision 6: kept as data (rendered text, signature strokes, hash) so a pickup can still be signed; the PDF is made only when a Drive is connected |
| Invoices and tax invoices (Phase 6) | Decision 8: made from data, sent by email and LINE, regenerated on request; a Drive copy only when connected |
| Bookings, payments, calendar, fleet, reports | Unaffected |
| Public listing photos | Unaffected (platform-hosted) |

A shop that later connects a Drive starts attaching from then on; nothing is back-filled.

## 9. Later providers behind the same interface

The module is the only code that talks to any store (root `CLAUDE.md`, rule 2). Its private side is one interface with one adapter per provider, chosen by the connection's `provider`:

```text
connect(tenant, returnUrl) → authorisation address        finishConnect(code, state) → connection
health(connection) → state                                 disconnect(connection)
ensureFolder(connection, kind, month) → folder id
startUpload(connection, file row, name, folder, size, type) → session for the browser
confirmUpload(connection, file row, provider ids, hash) → ok | refused
stream(connection, provider id, range?) → bytes            remove(connection, provider id)
findByTag(connection, our file id) → provider id?          errors → one shared list of states (§6.2)
```

- **What the rest of the platform sees** is only our `files` rows and `open_file()`: no provider ids, no provider names in any screen code, no provider error text.
- **OneDrive and Dropbox** (and S3-compatible storage a shop owns) would each need: an OAuth flow with a narrow, app-only scope, resumable upload sessions a browser can use, permanent delete, private per-app tags (for `findByTag`), and stable file ids. **Not checked in this draft**; each needs its own check against its provider's pages before it is promised.
- **Countries.** Google limits its business services in Crimea, Cuba, the so-called DPR and LPR, Iran, North Korea and Syria [G14]. Its page does not mention mainland China, and no official Google page found says Drive is unavailable there [G14]; it is widely blocked in practice, which is the kind of market where a second provider would be needed. Not needed for Thailand or the markets named so far; the interface keeps the door open.
- **Also later:** RISC [G11] for immediate notice of a revoked token; the Google Picker [G12], if shops ask to attach files already in their Drive (it works with `drive.file` by giving the app access to the files the user picks [G1][G12]); push notifications of changes, which list `drive.file` among their scopes [D18], though which changes a `drive.file` app sees is **not documented**.

## 10. Cost

### 10.1 What Google charges

- **Drive API:** "All standard use of the Google Drive API is available at no additional cost" [D2]. Quotas for projects created on or after 1 May 2026: 1,000,000 units a minute per project, 325,000 a minute per user per project, 400,000,000 a day per project (not raisable); a read costs 5 units, a list 100, a create or edit 50, a download 200 [D2]. Egress is free up to 1 TB a day per project [D2]. **Google says going over quota "is planned to incur charges" later in 2026, with at least 90 days' notice** [D2]. Our design stays under quota rather than paying for more.
- **OAuth and brand verification:** no fee is stated on the pages read [G2][G4]. (CASA assessments for restricted scopes have their own costs [G6]; not our case.)
- **Storage:** the shop's. A free Google account has 15 GB shared across Gmail, Drive and Photos [D5]; only files the account owns count [D6]; when full, nothing new can be uploaded [D6].

### 10.2 Our use, estimated

Per rental: about 10 photos at 500 KB and 10 previews at 20 KB, two document images, an agreement and an invoice PDF: about **5.5 MB** stored, about 26 Drive calls to upload (open, send, check, for each file and preview), about 30 downloads to view.

| Size | Rentals a year | Shop's Drive a year | Our quota use at a busy minute |
| --- | --- | --- | --- |
| BSR | about 3,000 | about 16 GB in year one; steady at about 16 GB with 12-month deletion of photos (needs a paid Google plan, or a shorter photo rule) | A grid of 20 previews: 4,000 units (1.2% of the per-user minute) |
| 50 shops | 50,000 | about 5.5 GB for an average shop of 1,000 rentals | 50 shops each opening a grid in the same minute: 200,000 units (20% of the project minute) |
| 500 shops | 500,000 | as above | Previews must stay cached in the browser (§4.3); measured before that size, with an eye on the project minute |

**The BSR line matters:** at 5.5 MB a rental, a busy shop outgrows Google's free 15 GB within a year. The shop pays Google (a Google One or Workspace plan), not Mango Works. Settings › File storage says this before connecting, with the estimate for the shop's own volume.

### 10.3 What Mango Works pays

Nothing to Google. Our own costs are on the function host: every **view** streams through our functions (§4.1), so viewing bandwidth and run time are ours; uploads are not (§3.2, option A). Netlify's bandwidth and function prices were not checked for this draft; the spike measures bytes per rental viewed and the stage writes the monthly figure into PROGRESS.

## 11. Stages

**Where it sits:** 0 → 1a → 2 → 3 → Neon move → 3M → 1b → **file storage** → 4. After 1b, because 1b's receipt and renewal fields are its first users; after the Neon move, because the move's stage 6 builds the module's public side and its "who is calling" functions and service path exist; before Phase 4, which can't store a passport without it. Stages 1 and 2's paperwork (Google Cloud projects, the homepage and privacy policy, brand verification) can start any time once decision 10 is made.

**Fable build** = built on Fable (OAuth, tokens, access control, deletion). **Opus + Fable check** = built on Opus, checked by Fable before merge.

| # | Stage | Migration | Model | Done when |
| --- | --- | --- | --- | --- |
| 1 | **Spike**: two Google Cloud projects (dev, live) in production status; a throwaway Next.js route on staging; a test Google account | None | Fable | A yes or no, with numbers, on each unclear point: browser upload to a server-opened session across origins, resumed after a cut [D1][D3]; whether the session address needs a token after opening; whether `drive.file` sees folders it made after the user renames and moves them; `about.get` with `drive.file`; a file in a Workspace shared drive; HEIC in each target browser; latency of a preview and a 600 KB photo from US East and Singapore on 4G; quota units used per rental. Mark says go |
| 2 | **Connection and tokens**: `storage_connections`, the encryption helper (shared with payments if that is not built yet), connect, callback, disconnect, reconnect, switch account, the status read, the daily health check, audit events. Brand verification submitted for live | 1 | Fable build | Owner only, by policy and by function; a manager, staff, mechanic, driver, another shop's owner and a stranger refused; the token table unreadable by every signed-in role (and in `default-grants.test.ts`); `state` replayed, expired or from another session refused; a refused scope saves nothing; `invalid_grant` turns the connection `revoked` and raises the Dashboard item; reconnecting the same account reactivates the row; another account needs the typed email; the token never appears in a log, an error report or a response (a test greps captured output); key rotation re-encrypts every row |
| 3 | **Files, uploads, the module's private side**: `files` table, `open_file()`, upload start and confirm, the sweep of abandoned uploads, the browser compressor and preview, the resumable client with retries | 2 | Fable build | Isolation for `files` (5 roles × 2 shops, stranger, Moto Mangos customer, anon); every row of §4.2 for upload; a Drive file not opened by us, from another shop, with a wrong token, size or folder refused at confirm; an upload cut at 50% and resumed; an expired session restarted; `storageQuotaExceeded` and 429 handled as §3.4 (against a fake Drive in unit tests, the real one in one manual run); EXIF and GPS gone from every stored photo; ESLint refuses Drive calls outside the module |
| 4 | **Viewing and the access log**: the file route, streaming with `Range`, cache headers, `file_access_log` | 3 | Fable build | Every row of §4.2 for viewing, by function, not only by screen; a logged kind can't be read without a log row (a test makes the log insert fail and gets no file); the log refuses update and delete for every role and the service role; no Drive address in any response; identity documents sent `no-store`; previews and photos timed against §4.3's target and recorded |
| 5 | **Failure states and problems**: the state mapping of §6.2, the Problems list, Dashboard items, "Find it again" | None or small | Opus + Fable check | Each row of §6.2 shown on a file field and in Problems (against a fake Drive); reconnect clears every connection-level state; "Find it again" relinks only an exact match |
| 6 | **Deletion machinery**: `delete_after`, the deletion job, "deletion overdue", "I deleted it myself", customer export and deletion as functions (Phase 4 adds the rules and the screens on the customer page) | 4 | Fable build | A due file deleted in Drive for good, then its preview, then its link, row kept as proof; never binned; a disconnected shop's due file listed, not lost; a held file (open case) not deleted; run twice, deletes once; export streams and stores nothing (a test checks no file lands on disk or in the database) |
| 7 | **Screens**: Settings › File storage (connect, state, account, Problems, the storage estimate); the shared file field (attach, progress, queued, states, preview grid, full view); 1b's "Log a job" receipt and "Record a renewal" document; the purchase and sale receipts on the vehicle page | None | Opus + Fable check | Playwright at 375 and 1280 px against a fake Drive: connect and disconnect by role; attach a receipt to a job on a phone; a queued upload finishing after a reload; every state of §6.2 on the field; no-Drive notes (§8) by role; Thai at phone width |
| 8 | **Help, privacy text, wrap-up**: help articles (connecting, what the shop owns, Workspace admins, Drive full, the bin, what the access log can't see); the privacy-policy section for Google's Limited Use; the lawyer's note (§7.4); doc edits (§13); demo seed with a fake connection and files in each state | None | Opus + Fable check (Fable checks the privacy and deletion wording) | Articles in English and Thai; the privacy page live on the verified domain; PROGRESS updated |

Order: 1, then 2, then 3; 4 and 6 need 3; 5 needs 3 and 4; 7 needs 4 and 5; 8 last. Stage 6 can run beside 5 and 7.

**Not truly testable here:** Google's own behaviour at scale and its future charges; a real Workspace admin block (tested with a fake answer, and once by hand if a Workspace account is available); RISC (not built).

## 12. Decisions (Mark, 20 Nov 2026)

**All fourteen decided as recommended in draft 1, on 20 Nov 2026.** The options considered are kept for the record.

| # | Decision | Decided | Options considered |
| --- | --- | --- | --- |
| 1 | **How bytes reach Drive** | **Browser to Drive, through a resumable session our server opens.** Through our server only as the fallback, if the spike shows Drive refuses the browser. No bytes through our functions; resume on poor signal for a week; no function size limits | (a) Browser to Drive through a session our server opens; (b) through our server |
| 2 | **Who connects, reconnects and disconnects** | **The owner only**, like payment accounts. A manager sees the state and is told to ask the owner | (a) Owner only; (b) owner and manager |
| 3 | **Switching to another Google account** | **Allowed after the owner types the old account's email.** Old files stay unreadable until that account is reconnected. A "copy my files to the new account" job is a later stage, built if a shop needs it | (a) Typed confirmation, old files unreadable; (b) the same plus a copy job now; (c) not allowed, disconnect only |
| 4 | **Personal data in Drive file and folder names** | **None.** Order or document numbers only (§5) | (a) None; (b) the customer's name in the file name |
| 5 | **Previews** | **Our own small preview file per photo**, made in the browser and stored beside it (§4.3) | (a) Our own preview; (b) Drive's `thumbnailLink`; (c) none |
| 6 | **Check-out without a connected Drive** | **The check-out completes without photos, with a clear warning on the check-out screen that no photos will be kept** (§8: before the photo step and again where the hand-over is confirmed; the order then shows "No photos kept"). The signed agreement is kept as data (rendered text, signature strokes, hash); its PDF is made only when a Drive is connected | (a) Completes without photos, agreement as data; (b) a Drive required before the first check-out; (c) the signed PDF as the one file the platform keeps |
| 7 | **Phase 4 for a shop that won't connect a Drive** (1b §7, question 6) | **Allowed**: document number, country, expiry and who checked it, with no images. The expiry rule works on dates | (a) Allowed without images; (b) Drive required for Phase 4's KYC |
| 8 | **Tax-invoice and receipt PDFs** (kept 5 years by Thai law, payments §6.1 [T15]) | **The document's data is the record**, frozen at issue and kept 5 years on the platform; the PDF is regenerated identically on request; a copy goes to the shop's Drive when one is connected and is never deleted by the PDPA job. Revisited if Korn's answer to K9 says an e-Tax scheme requires the issued file itself to be kept | (a) Data is the record, PDF regenerated; (b) the PDF in Drive as the only copy |
| 9 | **Mango Works' own files** (vendor billing: transfer slips, withholding certificates; payments §7) | **Mango Works' own Google Drive, through the same module**, as a platform connection. Never a shop's Drive, never a private bucket | (a) Mango Works' Drive through the module; (b) a private bucket on the platform; (c) kept by hand outside the platform |
| 10 | **The name and domain on Google's consent screen** | **Choose the platform's product name and domain before stage 2** if the name is close; otherwise launch as Mango Works on a Mango Works domain and verify the new brand later. Brand verification needs the homepage and privacy policy on a verified domain [G3] | (a) Name first; (b) Mango Works now, rebrand later |
| 11 | **Google client library** | **Plain `fetch`** against the documented endpoints inside the module. No new dependency | (a) Plain `fetch`; (b) Google's `googleapis` package |
| 12 | **Mango Works staff and support access to shop files** | **Never, by any route.** No screen, role, function or support tool lets Mango Works staff or platform admins open a shop's file. **When support needs to see a file, it asks the shop for a screenshot.** The privacy policy says so (Limited Use [G13]) | (a) None; (b) a time-limited grant the owner switches on per case |
| 13 | **Caching when viewing** | **`no-store` for identity documents; 5 minutes, private, for previews and other photos.** Never a shared cache, never a cache on our side | (a) As decided; (b) `no-store` for everything |
| 14 | **Workspace shared drives** | **Not in the first build**: the connected account's My Drive only. The spike checks whether a `drive.file` app can write to a shared drive [D16]; a later stage can add it | (a) Not now; (b) supported from the start |

## 13. Doc edits for the consolidation pass

**Not made in this PR.** PRs 54 (Phase 1b plan, with its SPEC corrections), 55 (Neon move plan) and 56 (payments design) merge as a batch; these edits are applied in one consolidation pass after that, to the merged files on `main`. Each edit names the file, the exact text to find (as it stands on that PR's branch, at the commit named) and the exact text to put in its place. Where two batch PRs touch the same line, the anchor is a part both versions share.

### 13.1 `docs/platform/SPEC.md` (its Drive lines come from PR 54, `platform/phase-1b-plan` at `ac8a615`)

1. **Tech stack, the File storage row.** Find:
   `| File storage | The shop's own connected Google Drive; the platform keeps only a link (file id) per file, behind one storage module (decided 19 Nov 2026) | Passports, licences, damage photos, signed PDFs, receipts. No files are stored on the platform |`
   Replace with:
   `| File storage | Private files: the shop's own connected Google Drive; the platform keeps only a link (file id) per file, behind one storage module (decided 19 Nov 2026; design decided 20 Nov 2026 in docs/platform/file-storage-design.md). Public listing images (shop, model and catalog photos, logos) stay on the platform's own store | Passports, licences, damage photos, signed PDFs, receipts. No private file is stored on the platform |`
2. **Data model, the `tenants` row.** Find `line\_channel, google\_drive\_folder (the shop's connected Drive), charge\_before\_days` and replace with `line\_channel, charge\_before\_days` (the connection moves to `storage_connections`, edit 9).
3. **Data model, the `unit_renewals` row.** Find `file (a link to the shop's Drive, added with the file storage stage)` and replace with `file\_id (→ files, added with the file storage stage)`.
4. **Data model, the `maintenance_jobs` row.** Find `done\_by (staff or garage), receipt\_file, notes` and replace with `done\_by (staff or garage), receipt\_file\_id (→ files), notes`.
5. **Data model, the `customer_documents` row.** Find `file\_front\_ref, file\_back\_ref (links to files in the shop's Drive)` and replace with `file\_front\_id, file\_back\_id (→ files)`.
6. **Data model, the `inspections` row.** Find `fuel\_level, photos, damage\_marks (JSON on diagram), notes, signed\_by\_customer, signature\_file, at` and replace with `fuel\_level, photos (→ files; none when no Drive is connected), damage\_marks (JSON on diagram), notes, signed\_by\_customer, at`.
7. **Data model, the `documents` row.** Find `| documents | order\_id, kind (contract, addendum, invoice, receipt, credit\_note), number, pdf, signed\_at, sent\_at | Numbered per tenant per kind |` and replace with `| documents | order\_id, kind (contract, addendum, invoice, receipt, credit\_note), number, content\_snapshot, signature\_strokes, hash, pdf\_file\_id (→ files; made only when a Drive is connected), signed\_at, sent\_at | Numbered per tenant per kind. The data is the record (kept 5 years for tax documents); the PDF is regenerated from it on request |`.
8. **Data model, the `cash_expenses` row.** Find `description, receipt\_file, paid\_by` and replace with `description, receipt\_file\_id (→ files), paid\_by`.
9. **Data model, three new rows**, added directly after the `customer_documents` row:
   `| storage\_connections | tenant\_id, provider, account\_id, account\_email, root\_folder\_id, folder\_ids, state, granted\_scopes, connected\_by, connected\_at, last\_ok\_at, last\_error, encrypted refresh token | One active per shop; owner connects; token readable by no signed-in role (file-storage-design §2.5) |`
   `| files | tenant\_id, connection\_id, provider\_file\_id, preview\_file\_id, kind, owner record, name, mime, size, sha256, state, created\_by, delete\_after, deleted\_at | A link to one file in the shop's Drive; no path or URL stored |`
   `| file\_access\_log | tenant\_id, file\_id, kind, user\_id, action, purpose, at | Append-only; written in the same call that opens the file |`
10. **Check-out and check-in, step 4.** Find `4. Take guided photos: front, back, left, right, dash; extra photos optional.` and replace with `4. Take guided photos: front, back, left, right, dash; extra photos optional. Without a connected Google Drive the check-out completes without photos, and the screen warns clearly, before this step and again where the hand-over is confirmed, that no photos will be kept (decided 20 Nov 2026).`
11. **Check-out and check-in, step 7.** Find `7. Customer reviews and signs the contract on screen. The PDF is generated, stored, then emailed or sent by LINE.` and replace with `7. Customer reviews and signs the contract on screen. The signed agreement is kept as data (its text, the signature strokes and a hash); the PDF is made from it, stored in the shop's Drive when one is connected, then emailed or sent by LINE.`
12. **Customers and KYC › Document storage, the "One module" bullet.** Find `` (outline in `docs/phase-1b-plan.md` §7; its design is still to be written). `` and replace with `` (design: `docs/platform/file-storage-design.md`, decided 20 Nov 2026). ``
13. **Customers and KYC › Document storage, two new bullets**, added directly after the "Trade-offs to know" bullet:
    `- **Public images stay on the platform.** Shop, model and catalog photos and logos are shown on the public sites and stay on the platform's own store. Everything else is a private file in the shop's Drive.`
    `- **Mango Works never opens a shop's files** (decided 20 Nov 2026). No screen, role or support tool reaches them; when support needs to see a file, it asks the shop for a screenshot.`
14. **Documents and messages, the invoice bullet.** Find `- Invoice, tax invoice/receipt and credit note, numbered per tenant (e.g. INV-2026-00042). Templates per tenant: logo, colours, terms, custom fields.` and replace with `- Invoice, tax invoice/receipt and credit note, numbered per tenant (e.g. INV-2026-00042). Templates per tenant: logo, colours, terms, custom fields. Each document's data is frozen at issue and kept 5 years on the platform; its PDF is regenerated identically on request, with a copy in the shop's Drive when one is connected (decided 20 Nov 2026).`
15. **Review decisions › Build order.** In the line that starts `**Build order.**`, find `1b → 4 onward` and replace with `1b → file storage → 4 onward` (the anchor is the same on `main` and on PR 55's version, which adds the Neon move earlier in the line).
16. **Build plan, Phase 4.** Find `documents stored in the shop's connected Google Drive (the file storage stage comes first)` and replace with `documents stored in the shop's connected Google Drive (the file storage stage, docs/platform/file-storage-design.md, comes first; a shop without a Drive records document numbers and expiry without images)`.
17. **Change log**, a new row at the top with the next free number (PR 54 and PR 55 both add a row numbered 49; the consolidation pass numbers them in merge order first):
    `| <next> | File storage design decided: private files in the shop's Drive through one module; owner connects; uploads straight to Drive; viewing through the server with an access log; check-out without a Drive completes without photos, with a warning; agreements and tax documents kept as data with the PDF regenerated; Mango Works never opens shop files | Decision | Tech stack; Data model; Check-out; Customers › Document storage; Documents; Build order | Before 4 |`

### 13.2 `docs/phase-1b-plan.md` (PR 54, `platform/phase-1b-plan` at `ac8a615`)

1. **Summary, point 8.** Find `outlined in §7 and still to be designed.` and replace with `` outlined in §7 and designed in `docs/platform/file-storage-design.md` (decided 20 Nov 2026). ``
2. **§6.2, open point 1.** Find `1. **The design of "Shop file storage (Google Drive)"** (§7): its own Fable design, later, before Phase 4.` and replace with `` 1. ~~**The design of "Shop file storage (Google Drive)"** (§7): its own Fable design, later, before Phase 4.~~ Designed in `docs/platform/file-storage-design.md`; Mark decided its fourteen points on 20 Nov 2026. ``
3. **§7, first paragraph.** Find `**Not part of Phase 1b. Its own stage, before Phase 4, with its own Fable design to be written later.** This outline only fixes what Mark decided (decision 10) and what the design must answer.` and replace with `` **Not part of Phase 1b. Its own stage, before Phase 4.** Its design is `docs/platform/file-storage-design.md` (decided 20 Nov 2026), which replaces the shape below wherever they differ. The seven questions are answered there: 1 in §2.2, 2 in §2.5, 3 in §3, 4 in §2.3, 5 in §9, 6 by decision 7, 7 in §7.4. ``

### 13.3 `docs/platform/neon-move-plan.md` (PR 55, `docs/neon-move-plan` at `a3f84f9`)

§1 to §6 are the assessment, kept as written; only the plan changes.

1. **§7.5, stage 6's row.** Find `| 6 | **Files**: rule 2's module; R2 buckets; the six storage policies become server-side checks that hand out upload addresses; a copy script that can be run again |` and replace with `` | 6 | **Files, public photos only**: rule 2's module, built with room for the private store of `docs/platform/file-storage-design.md` (the shop's Drive, added by that stage); R2 for the three public photo buckets; the six storage policies become server-side checks that hand out upload addresses; a copy script that can be run again. No private bucket: private files never go to R2 | ``. The row's other cells stay.
2. **§7.5, a note after the line `Stages 3 to 7 can overlap once stage 2 is merged; 4 needs 3. Stage 8 needs all of 2 to 7.`**, as its own paragraph: `` **Files after the decision of 19 Nov 2026** (private files in each shop's Google Drive, designed in `docs/platform/file-storage-design.md`): only public photos move to R2, so §2's "Medium for Phase 4 documents" and §5's "50 GB of files with documents" no longer apply; at 50 shops the public photos stay inside R2's free 10 GB. Private files are outside the restore window as well as outside R2: the shop's Drive is their only copy. ``

### 13.4 `docs/platform/payments-design.md` (PR 56, `docs/payments-design` at `10a8c87`)

1. **§8.2, the row "A shop's keys for a provider with no platform model".** Find `` decrypted only inside `@mango/payments`. Not Supabase Vault, so the move to Neon does not touch it | `` and replace with `` decrypted only inside `@mango/payments`. Not Supabase Vault, so the move to Neon does not touch it. The same encryption helper keeps each shop's Google Drive refresh token (`docs/platform/file-storage-design.md` §2.5); whichever stage comes first builds it | ``
2. **§7.2, the `invoice_payments` line in the code block.** Find (28 leading spaces) `withholding amount and certificate file, slip file, received_at, recorded_by, provider_ref` and replace with `withholding amount and certificate file id, slip file id (both in Mango Works' own Drive), received_at, recorded_by, provider_ref`; then add one line directly after the code block: `` Slips and withholding certificates are Mango Works' records, kept in Mango Works' own Google Drive through the storage module (`docs/platform/file-storage-design.md`, decision 9), never in a shop's Drive. ``

### 13.5 Root `CLAUDE.md` (the line is the same on `main` and on PR 55's branch)

1. **"Not tied to Supabase", rule 2.** Find `` - **File storage sits behind one module.** Uploading, deleting and making the address of a stored file go through that module and nothing else calls `.storage`. `` and replace with `` - **File storage sits behind one module.** Uploading, deleting, viewing and making the address of a stored file go through that module, and nothing else calls `.storage` or a file provider's API. Public images live on the platform's own store; every private file lives in the shop's connected provider (Google Drive today), with only a link kept (`docs/platform/file-storage-design.md`). Mango Works staff never open a shop's files. ``

### 13.6 Already in this PR

- `docs/PROGRESS.md`: the entry for this design (updated with Mark's decisions). Later, an entry per stage.

## 14. Sources

All read on **20 Nov 2026**.

**Google OAuth and verification**

- [G1] Drive API scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- [G2] When verification is needed: https://support.google.com/cloud/answer/13463073
- [G3] Brand verification requirements: https://support.google.com/cloud/answer/13464321
- [G4] Brand verification, timing and publishing: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- [G5] Verification FAQ (review times, 100-user cap): https://support.google.com/cloud/answer/13463817
- [G6] Restricted scopes and CASA: https://support.google.com/cloud/answer/13465431
- [G7] The unverified app screen: https://support.google.com/cloud/answer/7454865
- [G8] Using OAuth 2.0 (refresh token expiration, Testing status, 100-token limit): https://developers.google.com/identity/protocols/oauth2 . Note: the Tag Manager API's own pages give 25 tokens per client and account; this design follows the general page
- [G9] OAuth 2.0 for web server apps (offline access, `prompt`, granular consent, revoking, `invalid_grant`): https://developers.google.com/identity/protocols/oauth2/web-server
- [G10] Workspace admin control of third-party app access: https://knowledge.workspace.google.com/admin/apps/control-which-apps-access-google-workspace-data (redirected from support.google.com/a/answer/7281227)
- [G11] Cross-Account Protection (RISC): https://developers.google.com/identity/protocols/risc
- [G12] Google Picker overview: https://developers.google.com/workspace/drive/picker/guides/overview
- [G13] Google API Services User Data Policy: https://developers.google.com/terms/api-services-user-data-policy
- [G14] Countries where Google Workspace is available: https://knowledge.workspace.google.com/admin/support/troubleshooting/countries-or-regions-where-google-workspace-is-available

**Google Drive API**

- [D1] Upload file data (simple, multipart, resumable; one-week sessions; resuming; 256 KB chunks): https://developers.google.com/workspace/drive/api/guides/manage-uploads
- [D2] Usage limits (quota units, costs per call, charges planned, 5 TB file limit, 750 GB a day, backoff): https://developers.google.com/workspace/drive/api/guides/limits
- [D3] Google **Cloud Storage** resumable uploads (CORS, session address as authorisation; a different product, cited only to frame the spike): https://docs.cloud.google.com/storage/docs/performing-resumable-uploads
- [D4] Resolve errors (`authError`, `storageQuotaExceeded`, `insufficientFilePermissions`, `appNotAuthorizedToFile`, `notFound`, rate limits): https://developers.google.com/workspace/drive/api/guides/handle-errors
- [D5] Google One, 15 GB free: https://support.google.com/googleone/answer/9312312
- [D6] Drive storage full; only owned files count: https://support.google.com/drive/answer/6374270
- [D7] `files.delete` (permanent, skips the bin; `drive.file` allowed): https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete
- [D8] Trash and delete; bin emptied after 30 days: https://developers.google.com/workspace/drive/api/guides/delete
- [D9] `files.emptyTrash` (full `drive` scope only): https://developers.google.com/workspace/drive/api/reference/rest/v3/files/emptyTrash
- [D10] Files resource (`thumbnailLink`, `hasThumbnail`, `contentHints`, `appProperties`): https://developers.google.com/workspace/drive/api/reference/rest/v3/files
- [D11] Download and export files (`alt=media`, `Range`, `webContentLink`, `webViewLink`): https://developers.google.com/workspace/drive/api/guides/manage-downloads
- [D12] Custom file properties (limits): https://developers.google.com/workspace/drive/api/guides/properties
- [D13] Search for files (`appProperties has`): https://developers.google.com/workspace/drive/api/guides/search-files
- [D14] Folders (create, 500,000 items, 100 levels): https://developers.google.com/workspace/drive/api/guides/folder
- [D15] OAuth 2.0 scopes list (`drive.file` wording): https://developers.google.com/identity/protocols/oauth2/scopes
- [D16] Shared drives support (`supportsAllDrives`): https://developers.google.com/workspace/drive/api/guides/enable-shareddrives
- [D17] App data folder (`drive.appdata`): https://developers.google.com/workspace/drive/api/guides/appdata
- [D18] Push notifications (`files.watch`, `changes.watch`): https://developers.google.com/workspace/drive/api/guides/push

**Other:** [T15] is the payments design's source for the 5-year keeping rule for tax invoices (`docs/platform/payments-design.md` §13, branch `docs/payments-design`).

**Not checked, and said so above (still true in draft 2):** whether a browser may upload to a Drive session address across origins; whether `thumbnailLink` needs sign-in; `about.get` under `drive.file`; folders under `drive.file` after a user moves them; shared drives under `drive.file`; which changes a `drive.file` app is notified of; Netlify's function limits and bandwidth prices; OneDrive, Dropbox and any other provider; whether brand verification has a fee (none stated).

## 15. Changes since draft 1

| What | Change | Where |
| --- | --- | --- |
| Status | Draft 2: Mark decided all fourteen points as recommended, 20 Nov 2026. Still for a Fable critique | Header, Summary 11 |
| Decisions | §12 rewritten as decided, with the date, each decision in full and the options considered kept | §12 |
| Decision 6 | The check-out screen warns clearly, before the photo step and where the hand-over is confirmed, that no photos will be kept; the order shows "No photos kept (Drive not connected)". The warning is Phase 5's to build; it is in SPEC edit 13.1.10 so the Phase 5 plan picks it up | §8, §12, §13.1 |
| Decision 12 | Mango Works staff never open shop files, by any route; support asks the shop for a screenshot | §2.2, §4.2, §12, §13.1, §13.5 |
| Decision 1 | Browser to Drive is decided; through our server is the fallback | §3.2 |
| Doc edits | §13 rewritten as an exact list for one consolidation pass after PRs 54, 55 and 56 merge: each edit names the file, the branch commit, the text to find and the text to put in its place. Every "find" text was checked to occur exactly once in its file on that branch, and the Build order and `CLAUDE.md` anchors also on PR 55's versions. None of these edits is made in this PR | §13 |
