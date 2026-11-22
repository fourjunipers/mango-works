# Shop file storage (Google Drive): design

**Draft 3, 21 Nov 2026.** Design only: no code, no migration, no test, nothing applied anywhere, no Google Cloud project created. Draft 1 put fourteen decisions to Mark, decided as recommended on 20 Nov 2026. Draft 2 went to an independent Fable critique; Mark answered its open points on **21 Nov 2026** (decisions 15 to 22) and every point of the critique is applied here. §15 lists what changed since draft 2.

**Mark's decision (19 Nov 2026, Phase 1b plan decision 10; SPEC decision 49):** private files are not stored on the platform. Each shop connects its own Google Drive; the platform keeps only a link (the Drive file id). One module serves every file feature. A shop with no connected Drive can't attach files; everything else works.

Written from `main` at `48f0f43` (which now holds PR 52, the Phase 3 plan, `docs/phase-3-plan.md`; PR 54, the Phase 1b plan with its SPEC corrections, `docs/phase-1b-plan.md`; and PR 55, the Neon move plan, `docs/platform/neon-move-plan.md`) and from `docs/payments-design` at **`7227f3d`** (PR 56, **not merged** on 21 Nov 2026: §6 tax documents, §7 vendor billing, §8.2 secrets). Also read: the root and platform `CLAUDE.md`, `docs/platform/SPEC.md` (Tech stack, Customers and KYC with its PDPA points, Check-out and check-in, Documents and messages, Data model, Review decisions), `docs/PROGRESS.md` ("What does not follow the four rules yet"), `supabase/migrations/20261104000600_storage.sql` and the four marketplace files that call `.storage`.

**How outside facts are marked.** Every statement about Google Drive, OAuth or Google's verification was checked against Google's own pages on **20 Nov 2026** and carries a key such as [D1] or [G5], listed in §14. Most wording was read through a page summariser, so quotes are close to the page but not guaranteed word for word. Facts added in draft 3 from the critique (Netlify's limits, the RISC and Limited Use scope points, the PDPC case) are marked **"to confirm"** where we have not yet checked them on our own account or against the source. **Unclear** means the provider's pages do not say; each such point is a check for the Drive spike (§11.2).

## Summary

1. **Two kinds of file, two homes.** Private files (identity documents, inspection and damage photos, signed agreements, receipts, renewal documents, tax-invoice PDFs) go to the shop's Drive. Public listing images (Moto Mangos shop and bike photos, catalog stock photos, a shop's logo) stay platform-hosted, because the public site serves them to anyone (§1).
2. **The Neon plan's stage 6 already moves only the three public photo buckets** to R2 (its row on `main` says so). There is no private bucket and no presigned address for a passport (§1.3).
3. **The scopes are `openid email` and `drive.file`, all non-sensitive** [G1] (decision 15). For an app using only non-sensitive scopes, Google's verification is **not mandatory** [G2], but **brand verification is required by us before the first real shop connects**: without it the consent screen shows only our domain, not our name and logo. It needs a public homepage on a verified domain and a privacy policy [G3]. The live Google Cloud project is created now under Mango Works and its project and OAuth client id are never changed, even if the brand is renamed (decision 20).
4. **The owner connects one Google account per shop.** Its refresh token is encrypted in the app (AES-256-GCM with the tenant and connection bound in as authenticated data, master key in the platform's environment only), kept in a table no signed-in role can read, and decrypted only inside the storage module (§2).
5. **Uploads go from the browser straight to Drive** through a resumable session our server opens with the shop's token. The server keeps the session address too, asks Drive itself for progress and for the finished file, and trusts nothing the browser reports. Photos are shrunk in the browser first (2048 px, location data removed); every file is capped at **10 MB** (decision 18). Whether a browser may send to a session address across origins is unproven; the spike decides, and a server relay in chunks under 4.5 MB is the fallback (§3).
6. **Viewing goes through our server**, which checks the role, writes the access log in the same database call, and streams the file with our own content type and locked-down headers. Inspections show **one contact-sheet image** instead of ten previews; non-identity previews are cached privately in the browser for a day; identity documents are never cached (decision 17, §4).
7. **The platform deletes for good, never to the bin.** `files.delete` skips the trash and works with `drive.file` on files the user owns [D7]. The platform can't empty the shop's bin (that needs the full `drive` scope [D9]); files a person bins by hand are removed by Google after 30 days [D8] (§7).
8. **Every failure is a state the screens show**: Drive disconnected or refused, file missing, file in the Drive bin, file restricted by Google, Drive full, Google slow. Links are never removed by a failure. **Whether reconnecting the same account restores access to old files is unproven** and is the spike's first check; Disconnect therefore deletes only our token and does not revoke at Google until the spike says yes (decision 16, §6).
9. **Quota is not "far under".** At 200 shops × 50 rentals a day, draft 2's design uses about **142 million units a day** (against the 400 million a day at which Google plans to start charging, a billing threshold rather than a cap) and a busy minute of about **1.2 million units**, over the 1 million per-project minute. Views are about 85% of it. With the contact sheet and the browser cache the busy minute falls to about **0.4 million** (§10.2).
10. **Mango Works pays Google nothing today.** Standard Drive API use has no charge [D2]; charges for going over quota are planned "later in 2026" with at least 90 days' notice [D2]. The shop pays Google if its own Drive fills past its free 15 GB, which also stops its Gmail [D5][D6].
11. **The customer's own upload entry** (documents sent before arrival, no sign-in) is designed here (§3.5): a signed link for one document record, with size and count caps, an expiry and rate limits. Phase 4 builds it (decision 21).
12. **Mango Works is the shop's processor.** It signs a written processing agreement with each shop (PDPA s.40), keeps a breach runbook, and Mango Works staff never open shop files (decision 12, now our own promise, not a Google rule). The Thai lawyer sees the PDPA note **before stage 6** (deletion) is built (decision 22, §7).
13. **Eight stages: a Fable spike, four Fable builds (tokens, uploads, viewing, deletion), three Opus with a Fable check**, between 1b and Phase 4: 0 → 1a → 2 → 3 → Neon move → 3M → 1b → **file storage** → 4 (§11).
14. **Twenty-two decisions** (§12): fourteen of 20 Nov 2026 (6 and 12 reworded on 21 Nov) and eight of 21 Nov 2026. The signed agreement PDF is **always generated**, stored only when a Drive is connected, and sent to the customer only when staff choose "Send agreement" (decision 6).

## 1. What lives where

### 1.1 Private files: the shop's Drive

Every file names its owner: an **owner kind** and an **owner id** on the `files` row (§3.3). No owning table carries a file column, so a file can be added to a record that can't be updated, such as an append-only payment, and Phase 3 and the Neon move need no change for it.

| File | Phase | Owner kind | Notes |
| --- | --- | --- | --- |
| Maintenance job receipt | 1b, file added by this stage | `maintenance_job` | Photo or PDF |
| Renewal document (insurance, tax, inspection) | 1b, file added by this stage | `unit_renewal` | Photo or PDF |
| Purchase and sale receipts of a vehicle | 1a fields, file added later | `unit_financial` | SPEC Vehicle record › Ownership |
| Passport, licence, IDP, visa (front, back) | 4 | `customer_document` | Identity documents: the strictest kind (§4.2, §7). Also sent by the customer through §3.5 |
| Check-out and check-in photos, damage-mark photos, the contact sheet | 5 | `inspection` | Up to about 10 photos a rental, plus one contact sheet per inspection (§4.3) |
| Customer signature image | 5 | `inspection` | The signature is also kept as strokes in the agreement's data (decision 6, §7.1) |
| Signed agreement PDF | 5, 6 | `document` | Always generated; stored only when a Drive is connected (decision 6). Its hash stays on the platform |
| Invoice, tax invoice/receipt, credit note PDFs | 6 | `document` | 5-year keeping rule; see decision 8 |
| Payment slip, receipt photo for cash or transfer | 3 records, file added later | `payment` | Phase 3's `payments` is append-only (Phase 3 plan); the file points at the payment, never the reverse |
| Cash paid out receipt | 10 | `cash_expense` | |
| Traffic fine notice photo | later | `fine` | |
| Mango Works' vendor-billing slips and withholding certificates | payments §7 | `vendor_invoice_payment` | Mango Works' own Drive (decision 9, §2.5) |

### 1.2 Public files: platform-hosted

| File | Where today | After the Neon move |
| --- | --- | --- |
| Shop photos (Moto Mangos) | Supabase Storage, public bucket `shop-photos` | R2, public, on a custom domain |
| Model (bike) photos | `model-photos` | R2 |
| Catalog stock photos | `catalog-photos` | R2 |
| Shop logo for documents and the booking page | Not built | R2, with the others |

These are shown to anyone on the public sites, need a fast CDN, and carry no personal data. Keeping them in a shop's Drive would make the public site depend on every shop's Google token. They stay platform-hosted, as Mark's decision says.

**A rule for the boundary:** a file is public only if the public site shows it to someone who is not signed in. Anything else is private and goes to the shop's Drive. A photo of a damaged bike is private even though it shows only a bike: it belongs to a rental and a customer.

### 1.3 The Neon plan's stage 6

The Neon plan on `main` already reflects decision 49: stage 6 is "Public listing images to R2", with no private bucket. What this design adds:

- **Stage 6 builds rule 2's module** with one backend, the public store. This design adds the second, the private store (§9). If the file storage stage were ever built before the Neon move (it is not, in the current order), it would create the module itself and stage 6 would add R2 to it.
- **The cost table in the Neon plan §5** still counts "50 GB of files with documents" for 50 shops, and its §2 storage row still mentions "private documents by presigned address". Only public photos remain, well under R2's free 10 GB at that size. §13.3 has the one note to add.
- **Point-in-time recovery does not cover private files**, and neither does anything of ours: the shop's Drive is the only copy (§6.6).
- **The "do not start using" list** forbids policies on `storage.objects` and Vault; this design uses neither.

## 2. Connecting a Drive

### 2.1 Scopes

**`openid`, `email` and `https://www.googleapis.com/auth/drive.file`** (decision 15). `drive.file` covers files created or opened with the app, or shared with it through the Picker [G1], and Google lists it among the **non-sensitive** scopes [G1]; `openid` and `email` are non-sensitive sign-in scopes. `openid email` gives us the account's stable id (`sub`) and email in the ID token, so the connection knows which account it is without reading anything in the Drive. The platform can't see anything else in the shop's Drive. Two things it would like are refused to `drive.file` and are designed around:

- Emptying the bin needs the full `drive` scope [D9] (§7.1).
- The hidden app-data folder needs `drive.appdata` [D17], and the user can't see its files; we want the shop to see its own files, so we don't use it.

Sign-in with Google (Better Auth, after the Neon move) asks only for name and email. The Drive connection is a **separate consent**, asked on the Settings screen, never added to sign-in, so a staff member who signs in with Google never grants Drive access by accident.

### 2.2 Google's verification

| Point | What Google says | Source |
| --- | --- | --- |
| Is verification required? | For non-sensitive scopes only, "it is not mandatory for your app to complete the app verification process" | [G2] |
| What brand verification is for | Showing the app's name and logo on the consent screen. Without it, the screen shows our domain only | [G2] |
| What brand verification needs | A public homepage on a verified domain that describes the app (a sign-in page alone does not count); a privacy policy on the same domain, linked from the homepage and the consent screen; every authorised domain verified in Search Console at the top private domain | [G3][G4] |
| How long | Automated checks in minutes; manual review 2 to 3 business days. Publish within 7 days or the status becomes "Need to re-verify" | [G4][G5] |
| Sensitive or restricted (not needed here) | Sensitive about 10 business days; restricted about 6 weeks plus a CASA security assessment, revalidated every year | [G5][G6] |
| The 100-user cap and the "unverified app" screen | Stated for apps using sensitive or restricted scopes. Whether a non-sensitive-only app ever sees either: **not stated**; implied not | [G5][G7] |
| "Testing" publishing status | Refresh tokens expire after 7 days for an External app in Testing | [G8] |
| Data rules | Google API Services User Data Policy: a privacy policy that fully documents our handling; minimum scopes; secure in transit and at rest. Its **Limited Use** requirements (no human reading, no transfer, no ads) apply to **sensitive and restricted** scopes; `drive.file`, `openid` and `email` are neither (to confirm on the policy page at stage 8) | [G13] |

**What this means for us**

- **Two Google Cloud projects**: one for local and staging, one for live. Both set to **In production**, not Testing, or every staging connection dies after 7 days [G8].
- **The live project is created now, under Mango Works** (decision 20; Mark creates it, separately from this PR). Its project and OAuth client id are **never changed**, including if the brand is renamed under decision 10's "rebrand later": `drive.file` access belongs to the app, so a new client could lose every shop's files. Whether a second client id **in the same project** can read the first client's files is a spike check (§11.2); until it is answered, no second client is made in the live project.
- **Brand verification is required before the first real shop connects.** Verification is not mandatory to Google [G2], but a consent screen showing only a bare domain is not something we ask a shop owner to trust. It needs a name, a domain, a homepage and a privacy policy (decision 10). Start it with stage 2.
- **Lead time:** 2 to 3 business days by Google's estimate, plus the time to put up the homepage and privacy policy and verify the domain.
- **Mango Works staff never open a shop's files** (decision 12). This is **our own promise** to shops and a duty that follows from being their processor under the PDPA (§7), not something Google's Limited Use requires of a `drive.file` app. Nothing in the platform gives Mango Works staff a way to open a file (§4.2); when support needs to see one, it asks the shop for a screenshot. The privacy policy says so.
- **Drive API quota:** projects created on or after 1 May 2026 get the new unit-based quotas [D2] (§10).

### 2.3 One connection per shop, and who may touch it

- **One active connection per tenant**, not per location. All of a shop's files go to one Drive account, whatever location they come from.
- **Only the owner connects, reconnects or disconnects** (decision 2), as for a payment account (payments design §8.4). The screen says which Google account is connected (its email), when, by whom, and its state.
- **Advice on the screen:** use a Google account that belongs to the business, not a staff member's personal one, with 2-step verification on; anyone who can sign in to that account sees every file, outside our access log (§7.2). A personal account must be signed in to now and then (§6.6).
- **A Google Workspace account can be blocked by its admin.** An admin can mark an app Blocked or restrict Drive to trusted apps, and untrusted apps' tokens are then revoked [G10]; the refresh call fails with `admin_policy_enforced` [G8]. The connect screen shows a plain message ("Your Google Workspace admin has blocked this app") and the help article says what the admin must allow. **A Workspace domain with Drive access restricted to trusted apps may refuse the connection outright**, as may an account enrolled in Google's **Advanced Protection Program**, which limits third-party access to Drive (to confirm in the spike); both are in the help article list (stage 8).
- **Time-limited grants.** Google can let a user grant access for a limited time; the token response then carries `refresh_token_expires_in` (to confirm in the spike, §11.2). The connection stores the expiry, and the owner gets a Dashboard item seven days before it, and on the day: "Google Drive access ends on …; reconnect and choose to keep access".
- **Granular consent:** Google lets a user untick scopes on the consent screen; the app must read the granted scopes from the token response [G9]. An unticked `drive.file` means no connection: the screen says "Google Drive access was not granted" and saves nothing.
- **Changing to another Google account** (decision 3). With `drive.file`, a new account can't see files the old account holds. Files linked to the old account stay linked to it (each file names its connection) and can't be opened until that account is reconnected, **if reconnecting restores access at all** (unproven, §11.2). So a switch needs the owner to type the old account's email to confirm, and the screen offers the copy described in decision 3.
- **Shared drives** (Workspace): Drive needs `supportsAllDrives=true` for apps that handle them [D16]; whether a `drive.file` app may create files in a shared drive is **unclear** [D16]. The first build writes to the connected account's own My Drive only (decision 14).

### 2.4 The flow

1. The owner presses **Connect Google Drive** in Settings › File storage. Our server builds the authorisation request: `openid email drive.file`, `access_type=offline` (a refresh token for use when the owner is not present), `prompt=consent` [G9], and a `state` value tied to the tenant, the owner's session and a nonce, kept server-side for 10 minutes.
2. Google sends the owner back to our callback with a code. The server checks `state`, exchanges the code, checks the granted scopes [G9], and reads **the account's stable id and email from the ID token** (`openid email`), cross-checked against `about.get`'s `user` (email and permission id). It reads `refresh_token_expires_in` if present (§2.3), then creates the shop's root folder (§5).
3. The server writes the connection (§2.5) and an audit event, and the screen shows "Connected to …".

**Reconnecting the same account** (same `sub`): the old connection row becomes active again with the new token, and its files' links are tried again. Whether Google gives the app back access to the files it made before a revoke is **unproven**; the spike's first check (§11.2). If it does not, those files show "can't open" (§6.2) and the screen says why.

**Disconnect** (decision 16). **Until the spike shows that reconnecting the same account restores access to old files, Disconnect deletes our encrypted token only and does not revoke at Google.** It keeps the connection row as `disconnected` (the files still name it), writes an audit event, and deletes nothing in the Drive. The screen says: "The platform will stop using this Google account. Your files stay in your Drive. If you also remove the app's access in your Google account, the platform may never be able to open these files again, even after reconnecting." If the spike shows a reconnect restores access, Disconnect also revokes at Google (`https://oauth2.googleapis.com/revoke` [G9]) and the warning is shortened.

### 2.5 Where the token lives, and who can read it

```text
platform_private.storage_connections     no grant to anon or authenticated; service path only
  id, scope ('tenant' | 'platform'), tenant_id (null only when scope = 'platform'),
  provider ('google_drive'),
  account_id (the ID token's sub), account_email,
  root_folder_id, folder_ids jsonb (kind and month → folder id), folders_checked_at,
  state (active | revoked | disconnected | blocked_by_admin | error), full boolean,
  granted_scopes, grant_expires_at (from refresh_token_expires_in, if any),
  connected_by, connected_at, disconnected_at,
  last_ok_at, last_error_code, last_error_at,
  token_ciphertext, token_nonce, token_key_id        -- refresh token only
  unique (tenant_id, id)                             -- for the files' composite key
  unique (tenant_id) where scope = 'tenant' and state <> 'disconnected'
  unique (scope) where scope = 'platform' and state <> 'disconnected'
  check ((scope = 'platform') = (tenant_id is null))

platform.storage_connection_status       a security-definer read for owner and manager:
                                         provider, account_email, state, full, grant_expires_at,
                                         connected_at, last_ok_at; never the token
```

- **Encrypted in the app before it is written**: AES-256-GCM, a fresh nonce per value, the key's id beside it, and **the tenant id (or `platform`) and the connection id bound in as authenticated data**, so a ciphertext copied to another row or another shop fails to decrypt. The same pattern as payments §8.2, so one small helper serves both; whichever stage comes first builds it. Not Supabase Vault (on the "do not start using" list), so the Neon move does not touch it.
- **The master key lives only in the platform app's environment.** The marketplace site (Moto Mangos, its own Netlify site) never gets it, and the module refuses to start a token call without it.
- **Only the refresh token is stored.** Access tokens (an hour) are kept in the server's memory for the life of a request and never written.
- **Read only on the server's service path** (the same one payments uses for webhooks and jobs), and only after the caller's own database call has said yes (§4.1). No signed-in role can select the table; `default-grants.test.ts` and a cross-tenant test prove it.
- **A file's connection must belong to its tenant.** `files (tenant_id, connection_id)` references `storage_connections (tenant_id, id)`. **Mango Works' own connection** (decision 9) has `scope = 'platform'` and no tenant; its files have no tenant either and an owner kind from the platform list (`vendor_invoice_payment`). Because a foreign key with a null column is not checked, a trigger on `files` checks the null-tenant case: a file with no tenant must name the platform connection and a platform owner kind, and a file with a tenant must name a tenant connection.
- **Rotation of the master key:** a new key id is added, a job re-encrypts every row, the old key is removed after. Written in the runbook with the payments one.
- **Rotation of the refresh token itself** is Google's: if a refresh call returns a new refresh token, it replaces the stored one in the same request.
- **Keeping it alive.** A refresh token unused for six months stops working [G8]. A daily health check (§6.1) uses every active connection, so a quiet shop's token never lapses.
- **The 100-token limit:** Google keeps at most 100 refresh tokens per Google account per OAuth client and silently drops the oldest [G8]. Each reconnect makes a new one; only a shop that reconnects 100 times on one account would meet it. If several shops share one Google account (a group of shops), each connect is one of those 100: the screen does not stop it, the help article mentions it.
- **Cross-Account Protection (RISC) is dropped** from the design. RISC sends nothing for a grant that holds only `drive.file`, nor for Workspace accounts (to confirm on [G11]); adding `openid email` could bring account-level events (account disabled, sessions revoked) for consumer accounts, but that is not documented for our case and would never cover Workspace shops. The daily health check and the first failed call find a revoked token within a day for every kind of account.

### 2.6 Alternatives considered

| Alternative | Verdict | Why |
| --- | --- | --- |
| **The shop shares a folder with our service account**, which writes into it | Rejected | Files a service account makes are owned by the service account, so they would sit in Mango Works' storage, not the shop's, which breaks Mark's decision. It works only in a Workspace shared drive, which most small shops don't have |
| **A browser-only token** (each staff browser signs in to the shop's Google account and talks to Drive directly) | Rejected | Every staff member would need the shop's Google sign-in, which the access log can't see and which is exactly what §2.3 tells the shop not to do |
| **`openid email`** for a stable account id | Adopted | Decision 15 |
| **One contact sheet per inspection** instead of ten previews | Adopted | Decision 17, §4.3, §10.2 |
| **The Google Picker** for an existing folder or a shared drive | Kept for later (§9) | Lets the shop give the app a folder it already has, including one in a shared drive. It is also the real answer to **"the owner leaves"**: a new owner's account can pick the old folder, if the old owner shared it with them, without a copy job |

## 3. Uploads

### 3.1 In the browser, before anything is sent

- **Photos are re-encoded in the browser**: longest edge 2048 px, JPEG or WebP around quality 0.8, which keeps a passport readable and lands most photos at 300 to 700 KB. This also **strips EXIF, including the GPS position** a phone writes into a photo, which is personal data we have no reason to keep. The marketplace's `photo-picker.tsx` already resizes this way; its resize step moves into the shared module.
- **A preview** (longest edge 320 px, about 15 to 25 KB) is made in the same step for each identity document and receipt. Inspection photos get **one contact sheet per inspection** instead (§4.3).
- **Every file is capped at 10 MB** (decision 18), PDFs and everything else. Other types than the module's list per kind are refused.
- **iPhone HEIC photos:** whether every browser we support can decode them for re-encoding is a check for stage 3, not assumed.
- **A SHA-256 of the final bytes** is worked out in the browser and sent with the "start" call (§3.3). The server stores it and compares it with the checksum Drive reports for the finished file.
- **A client key per photo**, a random id made when the photo is taken, is sent with "start"; `unique (tenant_id, client_key)` on `files` means a retried "start" returns the same row and session, never a duplicate.

### 3.2 Direct to Drive, or through our server

Drive offers simple and multipart uploads up to 5 MB, and **resumable** uploads for larger files or poor networks [D1]. A resumable session address stays valid for a week; an interrupted upload asks Drive how many bytes arrived (`Content-Range: */<total>`, answered `308` with a `Range` header) and sends the rest; chunks are multiples of 256 KB [D1].

**Netlify's function limits** (from Netlify's current docs as reported by the critique; **to confirm on our account** in the spike): 60 s per synchronous function; about 6 MB for a buffered request or response, and about **4.5 MB for a binary request body** (base64 overhead); **20 MB for a streamed response**; 30 s for a scheduled function.

| | **A. Browser to Drive, session opened by our server** (decided) | B. Browser to our server, server to Drive (the fallback) |
| --- | --- | --- |
| Token | Stays on the server. The browser gets only one session address, good for one file | Stays on the server |
| Bytes through our functions | None | All of them, in chunks **under 4.5 MB** (4 MB = 16 × 256 KB), each chunk one function call that forwards it to the session |
| Poor signal at check-out | Resumes where it stopped, for up to a week [D1] | Resumes per chunk: a dropped call loses at most one chunk |
| Function limits | Not met | 4.5 MB request body and 60 s per call; a 10 MB file is three calls |
| Cost to Mango Works | None | Function bandwidth and run time for every byte |
| Unknowns | Drive's pages **do not say** whether a browser may send to a session address across origins (CORS), whether the browser can read the `Range` and `Location` answers (preflight included), nor say outright that the address needs no token on later requests. Their samples send the token only on the request that opens the session [D1]. Google Cloud Storage, a different product, documents both [D3] | None; the plainest to build |
| What a leaked session address allows | Writing that one file, for a week | Nothing |

**Decided (decision 1): A, with B as the fallback** if the spike shows Drive refuses the browser (§11.2).

### 3.3 The upload, step by step

```text
platform.files       RLS by tenant; the session address and upload token are service-only columns
  id, tenant_id (null for Mango Works' own files), connection_id,
  owner_kind, owner_id, slot (e.g. 'front', 'back', 'left', 'receipt'),
  client_key, provider_file_id, preview_file_id,
  name, mime (from our allow-list), size, sha256,
  state (uploading | ready | failed | never_arrived | missing | in_bin | no_access | flagged | deleted),
  source ('staff' | 'customer_link'), created_by, created_at,
  delete_after, deleted_at, deleted_by
  foreign key (tenant_id, connection_id) → storage_connections (tenant_id, id)
  unique (tenant_id, client_key)
```

1. **The browser asks** our server: "a file of kind K, for owner (kind, id) and slot S, n bytes, type T, hash H, client key C." The server checks, as the caller, that this person may attach kind K to that owner (§4.2), that the shop's connection is `active` and not `full`, that the type is on the list and the size is at most 10 MB.
2. **The server writes a `files` row in state `uploading`** with a random upload token, then opens a resumable session at Drive with the shop's token: the name (§5), the parent folder (checked not binned, §6.2), and `appProperties` carrying our file id and the upload token [D10] (up to 30 per app per file; **124 bytes for a key and its value together** [D12]). It **stores the session address on the row** (a service-only column) and returns it to the browser. The same is done for the preview.
3. **The browser sends the bytes** to the session address. It does not report a Drive file id; anything it says about progress is for its own progress bar only.
4. **The browser calls "done"** with our file id only. The server **asks Drive itself** about the stored session (`Content-Range: bytes */<total>`): a `308` means not finished; a finished session answers with the file's metadata, including its id. The server then reads that file's metadata and accepts it only if its `appProperties` carry this row's id and upload token, its size matches, its parent is the shop's folder, and **Drive's `sha256Checksum` equals the hash stored in step 1** (the field's name and presence on upload are spike checks; if Drive does not give it, the size and `appProperties` checks stand alone and the stage says so). Then the row becomes `ready` with the Drive ids, the session address is cleared, and the owner's record sees the file in the same transaction. A file whose check fails is deleted in Drive and the row is marked `failed`.
5. **Rows left in `uploading`** for more than 8 days (the session's week, plus a day) are swept by a job: any Drive file carrying their token is deleted, and the row is **marked `never_arrived` and kept**, never deleted. The order (or job, renewal, document) shows "2 photos never uploaded", so nobody believes there are photos that never came.

So nothing the browser reports is trusted: the file id, the size and the checksum are read from Drive by the server with the shop's own token, and the browser can never attach a Drive file it did not upload through us, or one from another shop.

### 3.4 Failures and retries

| What happens | What the platform does |
| --- | --- |
| Signal drops mid-upload | The browser keeps the file and the session address and resumes [D1]; the field shows "Uploading, 3 of 5" |
| Session expired (404 on resume) [D1] | Ask the server for a new session (same client key, same row) and start over; the user sees nothing unless that fails too |
| Drive answers 429 or 403 rate limit | Truncated exponential backoff, about 2^n seconds plus up to 1 s of jitter, capped at 32 to 64 s, as Google advises [D2][D4] |
| Drive full (`storageQuotaExceeded`, 403) [D4] | Stop; the field says "The shop's Google Drive is full"; the owner gets a Dashboard item (§6) |
| Connection revoked during the upload | The field says "Google Drive is disconnected"; the file stays queued on the device |
| The user closes the page | Phase 5's check-out queue (IndexedDB) keeps photos and sessions and resumes on the next visit; elsewhere the form warns before leaving |

**Photos waiting on the device.** Queued photos sit in the browser's IndexedDB **for up to a week**, on what is often a **shared counter phone**. The queue belongs to the signed-in user: signing out with photos still queued warns first ("3 photos haven't been sent; signing out deletes them from this phone") and then clears them. **iPhones can clear a site's storage after days without use and do no background upload**: photos send only while the page is open. The check-out screen says "Keep this page open until the photos are sent", the order shows "3 photos waiting on <device name>", and after 8 days unsent they become `never_arrived` (§3.3).

**Check-out on poor signal (Phase 5's accept test).** The check-out step completes with photos queued, not sent: the inspection row is written at once, each photo is a `files` row in `uploading`, and the order shows "3 photos still uploading" until they land.

### 3.5 The customer's own upload entry (decision 21; Phase 4 builds it)

SPEC (Customers and KYC) says online booking collects documents "at checkout or by a pre-arrival link". The customer has no role on the platform, so this is the one way into a shop's Drive that is not a signed-in user.

- **A signed link for one record.** Staff (or the booking flow) create a link for **one `customer_documents` record** (say, "passport for order ORD-2026-00042"). The link carries a random token of 256 bits; only its SHA-256 is stored, with the tenant, the record, the slots allowed (front, back), the expiry and the counts. A link never names a second record.
- **Caps:** at most the slots of that record (two files), each at most 10 MB, images or PDF only; at most 5 upload starts per link in all (retries included).
- **Expiry:** the earlier of 7 days and the order's pickup time; used up when every slot holds a `ready` file. Staff can cancel a link.
- **Rate limits:** per link (5 starts) and per network address (20 starts an hour across all links), refused with a plain "Too many tries, ask the shop for a new link".
- **The path:** the link page calls `platform.start_customer_upload(token, slot, size, type, hash, client_key)`, a security-definer function granted to the anonymous role that checks the token's hash, expiry, caps and the shop's connection, and writes the `files` row with `source = 'customer_link'` and `created_by` null. The upload then runs as §3.3, with the shop's token, into the shop's Customer documents folder.
- **What the customer sees:** "Received" per slot, never the file again, never any other file. The link opens nothing.
- **Staff check every customer-sent file** before it counts as checked (Phase 4's "who checked them"); the file's source shows on the customer page.
- **No Drive connected:** the link page says "Bring your documents to the shop" and offers no upload.
- **Logged:** each start and each finished file, with the link id, in the audit events; a view by staff is logged as any other (§7.2).

## 4. Viewing

### 4.1 The path

The browser never gets a Drive address it could pass on. It asks our server for `/files/<our id>` (or `/files/<our id>/preview`):

1. The server calls `platform.open_file(file_id, purpose)` **as the caller**. This security-definer function checks the tenant and the role for that file's kind (§4.2), **writes the access-log row** (§7.2) for kinds that are logged, and returns the connection id, the Drive file id and our stored `mime`. No yes, no log; no log, no file.
2. The server gets an access token from the stored refresh token (on the service path). For a **full view** it first reads the file's metadata (`trashed`, size; 5 units), because a download (`alt=media`) carries no `trashed` flag [D11] and the bin state (§6.2) needs it. Then it streams `files.get?alt=media` [D11] back to the browser, passing on `Range` for large PDFs [D11]. A file is at most 10 MB, inside Netlify's 20 MB streamed response (§3.2). Previews and contact sheets skip the metadata read.
3. **Headers**, every response:
   - `Content-Type` **from our own allow-list**, by the row's `mime` (chosen at upload from the kind's list), **never Drive's** `mimeType`.
   - `X-Content-Type-Options: nosniff`.
   - `Content-Disposition: inline; filename="<our file name>"` for viewing, `attachment` for a download.
   - `Content-Security-Policy: sandbox; default-src 'none'`, so a file that is not what it claims can run nothing on our origin (whether browsers' built-in PDF viewers work under `sandbox` is checked in stage 4; if not, PDFs are sent as `attachment`).
   - `Cache-Control: private, no-store` for identity documents and their previews; `private, max-age=86400` for previews and contact sheets of other kinds (decision 17); `private, no-store` for every full file. Never a shared cache.

Two things Google offers are not used for this:

- **`webViewLink` and `webContentLink`** [D11] open the file at Google, which needs the viewer to have access to the file in Drive. Staff don't, and shouldn't.
- **`thumbnailLink`** is short-lived ("on the order of hours") [D10]; whether it needs the owner's sign-in is **unclear**. Handing it to a browser would put a Google address for a passport thumbnail in staff browsers' history. We make our own previews instead (§4.3).

### 4.2 Who may see and attach each kind

Following Phase 3 §3.9 and Phase 1b decision 9. Each is checked in `open_file()` and in the upload's first step, not only in the UI.

| Kind | Owner | Manager | Staff | Mechanic | Driver | Logged |
| --- | --- | --- | --- | --- | --- | --- |
| Passport, licence, IDP, visa | Yes | Yes | Yes (Phase 4 may put this behind a staff permission, "see document images") | No | No | Every view |
| Inspection and damage photos, contact sheets | Yes | Yes | Yes | Bike photos yes, the customer's signature no | No | Every view |
| Signed agreement, invoices, tax invoices, credit notes | Yes | Yes | Yes | No | No | Every view |
| Payment slips, cash receipts | Yes | Yes | Yes | No | No | No |
| Job receipts | Yes | Yes | With "staff can enter and see job costs" | Yes | No | No |
| Renewal documents, vehicle purchase and sale receipts | Yes (purchase and sale: owner and manager only, like `unit_financials`) | Yes | Renewals yes | Renewals yes | No | No |
| **The customer, through §3.5** | Uploads to the one record its link names; sees nothing | | | | | Each upload, in audit events |
| Mango Works staff, platform admins, support | **Never**, for every kind and by any route (decision 12: our own promise and a PDPA processor duty). When support needs to see a file, it asks the shop for a screenshot | | | | | |

### 4.3 Previews, contact sheets and speed at the counter

- **One contact sheet per inspection** (decision 17). When an inspection's photos are taken, the browser draws one image of them all as small tiles (about 960 px wide, 60 to 100 KB) and uploads it as one file with owner kind `inspection`. The order's inspection panel loads that single image; tapping a tile opens that photo in full. A photo added later redraws the sheet (the old one is deleted in Drive).
- **Previews** (320 px, made in the browser at upload, §3.1) remain for identity documents and receipts, stored beside the full file; the `files` row keeps both ids.
- **Caching:** non-identity previews and contact sheets are cached privately in the browser for a day; identity documents and their previews are `no-store` (§4.1).
- **Why not Drive's thumbnails:** see §4.1. Drive can also take a custom thumbnail in `contentHints.thumbnail` [D10], but reading it back is through `thumbnailLink` again.
- **A PDF's preview** is a first-page image made in the browser where it can be (stage 3 checks the library choice; that would be a new dependency, so it is asked first); otherwise a type icon.
- **Speed.** Every view is: our function → one database call → Google token refresh (cached for the hour) → Drive download → back. **Until go-live the functions run in US East** (they move to Singapore at go-live, Neon plan stage 11), so each image crosses the Pacific twice. The spike measures a contact sheet and a 600 KB photo, from US East and from Singapore, on a phone on 4G. **Target at the counter, functions in Singapore: an inspection's contact sheet under 1 s, a full photo under 1 s.**
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
- **Ids, not names, are what count.** If the shop renames or moves a folder in its Drive, the ids are unchanged and nothing breaks. If it deletes one, the files go to the bin with it (§6.2), and a new folder is made on the next upload.
- **Whether `drive.file` lets the app see the folders it created after a rename or move by the user:** Google's pages say nothing about folders specifically [D14][D15]; checked in the spike.
- **File names carry no personal data** (decision 4): `passport-front_ORD-2026-00042_7f3a.jpg`, `checkout-left_ORD-2026-00042_b21c.jpg`, `checkout-sheet_ORD-2026-00042_a91d.jpg`, `receipt_job-1187_d9e0.pdf`, `tax-invoice_INV-2026-00042.pdf`. The order or document number lets the shop find a file by hand; the short suffix keeps names unique.
- **`appProperties`** on each file carry our file id, the tenant id, the owner kind and the owner id [D10], each short enough for the 124-byte limit on a key and value together [D12], so a lost link can be found again by search (`appProperties has { key='…' and value='…' }` [D13]).
- **Previews** sit beside their file, named `…_preview.jpg`.

## 6. When things go wrong

### 6.1 Finding out

- **On every call.** Each Drive call's error is mapped to a connection state or a file state (below), and the connection's `last_ok_at` or `last_error_*` is updated.
- **A daily health check per active connection**: refresh the token, read the root folder's metadata and the stored folders' `trashed` flags. This keeps the token from lapsing after six months unused [G8], finds a revoked token within a day even in a quiet shop, and warns of a `grant_expires_at` coming (§2.3).
- **Batches inside a scheduled function's 30 s.** A `pg_cron` job only queues work (the platform's rule; the Neon plan's "do not start using" list). The scheduled worker takes a batch it can finish in about 20 s (connections for the health check, due files for deletion, §7.1), marks each done, and leaves the rest for the next run; the run repeats every few minutes until the queue is empty.
- **Drive space.** Whether `about.get` (storage quota) can be read with `drive.file` alone is **unclear**; the spike checks it. If it can, the health check warns the owner at 90% full; if not, the first `storageQuotaExceeded` is the warning.

### 6.2 The states and what each shows

| Cause | Google's answer | Connection or file state | What staff see on a file field | What the owner gets |
| --- | --- | --- | --- | --- |
| Owner removed the app's access in their Google account, an admin change, or the token expired (six months unused, or a time-limited grant ran out) | `invalid_grant` on refresh [G8][G9] | Connection `revoked` | "Google Drive is disconnected. Ask the owner to reconnect it in Settings." Existing files show their name, kind and date with a "can't open" mark; nothing is attached | A Dashboard item at once; an email (Phase 3's outbox) |
| Workspace admin blocked the app | `admin_policy_enforced` [G8] | `blocked_by_admin` | As above, "blocked by your Google Workspace admin" | Dashboard item with what the admin must allow [G10] |
| Access token expired | 401 `authError` [D4] | None: refresh and retry once | Nothing | Nothing |
| File deleted for good in Drive | 404 `notFound` [D4] | File `missing` | "This file was deleted from Google Drive" | Listed under Settings › File storage › Problems |
| File in Drive's bin | Seen only on a **metadata read** (`trashed` true); a download does not say | File `in_bin` | Opens, with "In Google Drive's bin: restore it there or it will be deleted after 30 days" [D8] | Listed under Problems |
| A stored folder in the bin | Metadata read, before an upload into it and in the health check | None: a new folder is made and its id stored | Nothing | Nothing |
| File moved out of reach (e.g. to another owner) | 403 `insufficientFilePermissions` or `appNotAuthorizedToFile` [D4] | File `no_access` | "The platform can no longer open this file" | Listed under Problems |
| File restricted by Google as abusive | 403 `cannotDownloadAbusiveFile` (to confirm in the spike) | File `flagged` | "Google has restricted this file" | Listed under Problems |
| Drive full | 403 `storageQuotaExceeded` [D4] | Connection `active`, `full` | Uploads refused: "The shop's Google Drive is full" | Dashboard item: the shop's **Gmail stops too** on a free account (§6.6); help link to free space or buy storage [D5][D6] |
| Rate limits | 403 or 429 [D2][D4] | None | Retried with backoff (§3.4); after the cap, "Google Drive is busy, try again" | Nothing, unless repeated: a note in the platform's own error reports |
| Google unreachable | Network error, 5xx | None | "Couldn't reach Google Drive, try again" | Nothing |

- **A password change does not revoke a `drive.file` token**: Google revokes tokens on a password change only for Gmail scopes (to confirm on [G8]). A shop that changes its Google password to shut someone out must also remove the app's access, or that person keeps nothing from us but keeps their own sign-in to the Drive.
- **Links are never removed by a failure.** Only a deletion the platform makes (§7) clears a link.
- **Reconnecting the same Google account** reactivates the old connection row with the new token (§2.4). **Whether the old files open again is unproven** (§11.2): if they don't, they stay `no_access` and the Problems list explains it. A different account goes through decision 3.
- **The order and pickup screens don't stop on a missing file** except where a later phase makes a file a condition (Phase 4: a valid document on file; Phase 5: a completed inspection). Those phases decide what a missing file means for them; decision 6 covers the no-Drive case.

### 6.3 The shop's own actions in Drive

The help article tells the shop plainly: the files in that folder are its records. Renaming or moving them is safe. Deleting them breaks the link and the platform can't bring them back. Sharing the folder with others shows them every passport. Files it bins by hand are deleted by Google after 30 days [D8].

### 6.4 A missing file, found again

If a link is `missing` but a file with that row's `appProperties` exists (a shop restored a copy, say), the Problems list offers "Find it again", which searches by `appProperties` [D13] and relinks only a file whose properties match the row exactly.

### 6.5 Leaving the platform

The shop already owns every file. Its data export (later) lists each file's Drive id and name beside its record, so the files can be matched without us.

### 6.6 No backup on our side, and the shop's Google account

- **The shop's Drive is the only copy.** A shop that deletes its Google account loses its files, and the platform can't help. Settings › File storage says so in one line.
- **A full Drive stops the shop's Gmail too.** A free Google account's 15 GB is shared by Gmail, Drive and Photos [D5]; when full, it can't receive email either. The storage estimate (§10.2) says so before connecting.
- **Google may delete a personal account unused for two years**, and use only through our API may not count as use (to confirm against Google's inactive-account policy before stage 8). The help article tells the owner to sign in to that account at least once a year; a Workspace account is not affected.

This is the cost of Mark's decision, and the SPEC already lists it among the trade-offs.

## 7. PDPA

The shop is the data controller; its Drive is where the files sit; **Mango Works processes them for the shop**. SPEC's PDPA points 3 to 6 apply as follows.

### 7.1 Retention and automatic deletion (point 4)

- **Each `files` row carries `delete_after`**, set by the rule for its kind when its owning record closes. Identity documents: the shop's `document_retention_months` after the rental closes (default 12), held while a damage or fine case is open (Phase 4 owns the rule; this stage builds the machine). Tax documents: **not** by this rule, see decision 8 (5 years by Thai law, payments §6.1 [T15]).
- **Agreement data and signature strokes** (decision 6) are personal data kept on the platform, not in the Drive, so they need their own rule, which draft 2 lacked. Proposed: the rendered text and the signature strokes are kept for the shop's **`agreement_retention_months` after the rental closes** (default 24, **to be confirmed by the lawyer**, §7.5), held while a damage, fine or payment case on that order is open; then the text and strokes are erased and only the hash, signer name, time and device stay, as proof that a signed agreement existed. A Drive copy of the PDF gets the same `delete_after`.
- **The deletion job** (queued by `pg_cron`, run app-side in batches, §6.1) deletes each due file **for good** with `files.delete`, which skips the bin and is allowed with `drive.file` for files the user owns [D7]; then the preview; then clears the link and marks the row `deleted` (the row stays, with no Drive id, as proof of deletion: kind, owner, when, by the job).
- **If the connection is not active** when a deletion falls due, nothing can be deleted. The file is listed as **"deletion overdue"** for the owner (Dashboard and Problems), with two ways out: reconnect (the job then runs), or "I deleted it in Drive myself", which records who said so and clears the link.
- **The bin:** we never bin, so nothing of ours waits there. The platform can't empty the bin (`emptyTrash` needs the full `drive` scope [D9]); the help article says files the shop bins by hand are removed by Google after 30 days [D8].
- **Files the platform can't reach** (`no_access`, `flagged`) can't be deleted by it either: listed as "deletion overdue" the same way.

### 7.2 The access log (point 3)

```text
platform.file_access_log     append-only (update, delete, truncate refused by trigger for every role)
  tenant_id, file_id, kind, user_id, action (view | preview | download | delete | export), purpose, at
```

- Written inside `open_file()` (§4.1), so a view that was not logged can't happen.
- Read by owner and manager only, like `audit_events`; on the customer page (Phase 4), "who viewed this document and when".
- It has its own retention, like audit rows (SPEC, Review decisions › Audit), longer than the files it describes.
- **What it can't see:** anyone who opens the files in Google Drive directly with the shop's Google account. Google's own activity view shows that account, not which person. The help article and the connect screen say so.

### 7.3 A customer's request (point 5)

- **A copy:** the customer page offers "Export this customer's data". The **browser** builds it: it fetches the customer's records as JSON and each file through the ordinary `/files/<id>` route, one request per file, each logged with action `export`, and saves them **one by one with a manifest** (a list of each file's name, kind and record). A ZIP built in the browser would need a new library, so it is asked first; the export is **never** built or streamed through one function, which would meet Netlify's limits (§3.2) and would hold the files on our side.
- **Deletion:** the same job as §7.1, run now for every file of that customer that no legal hold keeps (an open fine or damage case, a tax document). What is kept and why is shown before the owner confirms.
- With the connection down, both wait, as in §7.1.

### 7.4 Mango Works' duties as processor

- **A written processing agreement with each shop** (PDPA s.40): what we process, on the shop's instructions only, our security measures, sub-processors (our function host and database host; Google is the shop's own provider, see §7.5), help with the customer's requests, deletion at the end, and telling the shop of a breach without delay. Accepted by the owner when connecting a Drive; its text is the lawyer's (§7.5).
- **A breach runbook**, written in stage 2 with the master-key rotation. A leaked refresh token or a leaked **master key** means telling **every shop** whose tokens it protects, rotating the key, and revoking at Google every token that may have leaked. The PDPC fined a processor THB 3 million in August 2025 for not telling its controller of a breach (as reported in the critique; **source to be added** to the lawyer's note before it goes out).
- **Where files pass through:** every view streams through our functions (§4.1). **Until go-live those run in the US region**; they move to Singapore at go-live (Neon plan stage 11). The lawyer's note says so.

### 7.5 What the Thai lawyer needs to see (1b §7, question 7), before stage 6

**The lawyer sees this note before file storage stage 6 (deletion) is built** (decision 22), not only before Phase 4 goes live. A one-page note: where the files sit (the shop's own Google account, Google's servers, region not chosen by us); that Mango Works staff can't open them; the scopes and what they let us see; the access log and what it misses; deletion through the API and the bin; the customer upload entry (§3.5); the shop's own duties (account security, not sharing the folder, a breach checklist); and our processor duties (§7.4). The questions:

1. Do we stay a **pure processor** while we hold the shop's token and run deletion on a schedule?
2. Is **Google the shop's processor or our sub-processor**?
3. Are Drive storage and our US (until go-live) and Singapore streaming **cross-border transfers**, and on what basis? Thailand has no adequacy list.
4. The **retention period and legal basis for ID copies** (`document_retention_months`, default 12), and for agreement data and signature strokes (default 24, §7.1).
5. The **contents of the shop agreement** (§7.4).

## 8. A shop with no Drive connected

| Area | Without a connection |
| --- | --- |
| Every file field | Shown, disabled, with "Connect Google Drive in Settings to attach files" (owner sees a link to Settings; others see "ask the owner") |
| Maintenance jobs, renewals (1b) | Saved in full; the reference number and notes carry what the receipt would |
| Customer documents (Phase 4) | Number, country, expiry and who checked them are recorded; the expiry rule that blocks a pickup works on the expiry date, not on an image (decision 7). The customer link offers no upload (§3.5) |
| Check-out and check-in (Phase 5) | Completes without photos. Odometer, fuel, damage marks on the diagram and their notes work. **The check-out screen shows a clear warning before the photo step, and again where the hand-over is confirmed: "Google Drive is not connected, so no photos will be kept for this rental."** The inspection is recorded as done without photos, and the order shows "No photos kept (Drive not connected)" |
| Signed agreement (Phase 5, 6) | Decision 6: kept as data (rendered text, signature strokes, hash). **The PDF is always generated** from that data, connected or not. Staff can send it to the customer with **"Send agreement"** on the order (email), only when they choose to, never automatically. It is **stored only when a Drive is connected**; otherwise it is made again from the data each time it is sent or opened |
| Invoices and tax invoices (Phase 6) | Decision 8: made from data, sent by email and LINE, regenerated on request; a Drive copy only when connected |
| Bookings, payments, calendar, fleet, reports | Unaffected |
| Public listing photos | Unaffected (platform-hosted) |

A shop that later connects a Drive starts attaching from then on; nothing is back-filled.

## 9. Later providers behind the same interface

The module is the only code that talks to any store (root `CLAUDE.md`, rule 2). Its private side is one interface with one adapter per provider, chosen by the connection's `provider`:

```text
connect(owner, returnUrl) → authorisation address         finishConnect(code, state) → connection
health(connection) → state                                 disconnect(connection)
ensureFolder(connection, kind, month) → folder id
startUpload(connection, file row, name, folder, size, type) → session for the browser
confirmUpload(connection, file row) → ok | refused        (reads the provider, trusts no browser report)
stream(connection, provider id, range?) → bytes            remove(connection, provider id)
findByTag(connection, our file id) → provider id?          errors → one shared list of states (§6.2)
```

- **What the rest of the platform sees** is only our `files` rows and `open_file()`: no provider ids, no provider names in any screen code, no provider error text.
- **OneDrive and Dropbox** (and S3-compatible storage a shop owns) would each need: an OAuth flow with a narrow, app-only scope, resumable upload sessions a browser can use, permanent delete, private per-app tags (for `findByTag`), and stable file ids. **Not checked**; each needs its own check against its provider's pages before it is promised.
- **Countries.** Google limits its business services in Crimea, Cuba, the so-called DPR and LPR, Iran, North Korea and Syria [G14]. Its page does not mention mainland China, and no official Google page found says Drive is unavailable there [G14]; it is widely blocked in practice, which is the kind of market where a second provider would be needed. Not needed for Thailand or the markets named so far.
- **Also later:** the Google Picker [G12], for an existing folder, a shared drive, or a new owner taking over the old owner's folder (§2.6); it works with `drive.file` by giving the app access to the files the user picks [G1][G12]. Push notifications of changes list `drive.file` among their scopes [D18], though which changes a `drive.file` app sees is **not documented**. RISC is not planned (§2.5).

## 10. Cost and quota

### 10.1 What Google charges

- **Drive API:** "All standard use of the Google Drive API is available at no additional cost" [D2]. Quotas for projects created on or after 1 May 2026: 1,000,000 units a minute per project, 325,000 a minute per user per project; a read costs 5 units, a list 100, a create or edit 50, a download 200 [D2]. **400,000,000 units a day per project is the point past which Google plans to charge, a billing threshold rather than a cap** [D2]; charges are planned "later in 2026" with at least 90 days' notice [D2]. Egress is free up to 1 TB a day per project [D2].
- **OAuth and brand verification:** no fee is stated on the pages read [G2][G4].
- **Storage:** the shop's. A free Google account has 15 GB shared across Gmail, Drive and Photos [D5]; only files the account owns count [D6]; when full, nothing new can be uploaded and Gmail stops receiving [D6].

### 10.2 Our use, estimated

Per rental, stored: about 10 photos at 500 KB, one contact sheet per inspection (two, about 100 KB each), two document images with previews, an agreement and an invoice PDF: about **5.5 MB**.

**At 200 shops × 50 rentals a day (10,000 rentals a day), draft 2's design:**

| Measure | Figure | Against |
| --- | --- | --- |
| Units a day | **about 142 million** (about 14,200 a rental) | 400 million a day, the billing threshold [D2] |
| Units in a busy minute | **about 1.2 million**, assuming 10% of the day's use falls in one hour and the busiest minute of that hour is 5 times its average | **1 million a minute per project** [D2]: over |
| Share from views | **about 85%**, at 200 units a download (grids of ten previews, opened several times a rental, plus full views) | |
| One busy shop (50 rentals a day) | under 10% of its per-user minute (about 6,000 of 325,000) | 325,000 a minute per user [D2] |

**The fix (decision 17):** one contact sheet per inspection instead of ten previews, and a day's private browser cache for non-identity previews and sheets (§4.1, §4.3). Assuming each rental's inspection panel is opened about five times and about ten photos are opened in full, view downloads fall from about 60 a rental to about 15, and uploads from about 26 calls to about 17. Recomputed: about **4,700 units a rental**, about **47 million a day**, and a busy minute of about **0.4 million**, 40% of the project minute. The split of views is our model, not a measurement; the spike measures units per rental (§11.2), and the stage records the real figure in PROGRESS. At 500 shops the busy minute would again near the limit: measured before that size, with an eye on the project minute.

| Size | Rentals a year | Shop's Drive a year |
| --- | --- | --- |
| BSR | about 3,000 | about 16 GB in year one; steady at about 16 GB with 12-month deletion of photos (needs a paid Google plan, or a shorter photo rule) |
| Average shop | about 1,000 | about 5.5 GB |

**The BSR line matters:** at 5.5 MB a rental, a busy shop outgrows Google's free 15 GB within a year, and a full free account stops its Gmail too (§6.6). The shop pays Google (a Google One or Workspace plan), not Mango Works. Settings › File storage says this before connecting, with the estimate for the shop's own volume.

### 10.3 What Mango Works pays

Nothing to Google. Our own costs are on the function host: every **view** streams through our functions (§4.1), so viewing bandwidth and run time are ours; uploads are not (§3.2, option A). Each view stays inside Netlify's limits (a file is at most 10 MB, under the 20 MB streamed response, and a stream well under 60 s; to confirm on our account). Netlify's bandwidth and function prices were not checked; the spike measures bytes per rental viewed and the stage writes the monthly figure into PROGRESS.

## 11. Stages

**Where it sits:** 0 → 1a → 2 → 3 → Neon move → 3M → 1b → **file storage** → 4. After 1b, because 1b's receipt and renewal fields are its first users; after the Neon move, because the move's stage 6 builds the module's public side and its "who is calling" functions and service path exist; before Phase 4, which can't store a passport without it. The paperwork (the live Google Cloud project, created now by Mark, decision 20; the homepage and privacy policy; brand verification) can start any time.

**Fable build** = built on Fable (OAuth, tokens, access control, deletion). **Opus + Fable check** = built on Opus, checked by Fable before merge.

### 11.1 The stages

| # | Stage | Migration | Model | Done when |
| --- | --- | --- | --- | --- |
| 1 | **The Drive spike** (§11.2): a dev Google Cloud project in production status, the live one (decision 20); a throwaway Next.js route on staging; a test Google account | None | Fable | A yes or no, with numbers, on every point of §11.2. Mark says go |
| 2 | **Connection and tokens**: `storage_connections` (tenant and platform scope), the encryption helper with authenticated data (shared with payments if that is not built yet), connect, callback, disconnect (token only, per decision 16 and the spike), reconnect, switch account, grant expiry, the status read, the daily health check in batches, audit events, the breach runbook. Brand verification submitted for live | 1 | Fable build | Owner only, by policy and by function; a manager, staff, mechanic, driver, another shop's owner and a stranger refused; the token table unreadable by every signed-in role (and in `default-grants.test.ts`); a ciphertext moved to another row or tenant fails to decrypt; `state` replayed, expired or from another session refused; a refused scope saves nothing; `invalid_grant` turns the connection `revoked` and raises the Dashboard item; a time-limited grant raises its warning; reconnecting the same account reactivates the row; another account needs the typed email; the master key absent from the marketplace site's variables; the token never appears in a log, an error report or a response (a test greps captured output); key rotation re-encrypts every row |
| 3 | **Files, uploads, the module's private side**: `files` table with owner kind and id and the composite key, `open_file()`, upload start and confirm (server-side progress and checksum), the sweep to `never_arrived`, the browser compressor, previews and contact sheet, the resumable client with retries and client keys | 2 | Fable build | Isolation for `files` (5 roles × 2 shops, stranger, Moto Mangos customer, anon); a file naming another tenant's connection refused by the key; every row of §4.2 for upload; a Drive file not opened by us, from another shop, with a wrong token, size, folder or checksum refused at confirm; a browser-reported id ignored; a retried start with the same client key makes no second row; an upload cut at 50% and resumed; an expired session restarted; an 11 MB file refused; an abandoned upload becomes `never_arrived` and stays; `storageQuotaExceeded` and 429 handled as §3.4 (against a fake Drive in unit tests, the real one in one manual run); EXIF and GPS gone from every stored photo; ESLint refuses Drive calls outside the module |
| 4 | **Viewing and the access log**: the file route, streaming with `Range`, the metadata read for full views, content type and security headers, cache headers, `file_access_log` | 3 | Fable build | Every row of §4.2 for viewing, by function, not only by screen; a logged kind can't be read without a log row (a test makes the log insert fail and gets no file); the log refuses update and delete for every role and the service role; no Drive address in any response; every response carries our content type, `nosniff`, a `Content-Disposition` and the sandbox CSP, whatever Drive says the type is; identity documents `no-store`, other previews a day; contact sheets and photos timed against §4.3's target and recorded |
| 5 | **Failure states and problems**: the state mapping of §6.2 (bin by metadata, binned folders, flagged files), the Problems list, Dashboard items, "Find it again" | None or small | Opus + Fable check | Each row of §6.2 shown on a file field and in Problems (against a fake Drive); reconnect clears every connection-level state; "Find it again" relinks only an exact match |
| 6 | **Deletion machinery**: `delete_after`, the agreement-data rule, the deletion job in batches, "deletion overdue", "I deleted it myself", customer export (browser-built) and deletion as functions (Phase 4 adds the rules and the screens on the customer page). **Not started until the lawyer has seen §7.5** (decision 22) | 4 | Fable build | A due file deleted in Drive for good, then its preview, then its link, row kept as proof; never binned; agreement text and strokes erased at their date, hash kept; a disconnected shop's due file listed, not lost; a held file (open case) not deleted; run twice, deletes once; a batch stops inside 30 s and the next run carries on; export logs each file and stores nothing on our side |
| 7 | **Screens**: Settings › File storage (connect, state, account, Problems, the storage estimate, the disconnect warning, the processing agreement); the shared file field (attach, progress, queued on this device, never uploaded, states, contact sheet, full view); 1b's "Log a job" receipt and "Record a renewal" document; the purchase and sale receipts on the vehicle page | None | Opus + Fable check | Playwright at 375 and 1280 px against a fake Drive: connect and disconnect by role; attach a receipt to a job on a phone; a queued upload finishing after a reload; sign-out with queued photos warns; every state of §6.2 on the field; no-Drive notes (§8) by role; Thai at phone width |
| 8 | **Help, privacy text, wrap-up**: help articles (connecting, what the shop owns, Workspace admins and trusted-app restrictions, Advanced Protection, time-limited access, Drive full and Gmail, the bin, signing in to a personal account yearly, what the access log can't see, what a password change does not do); the privacy-policy section (our own promise that Mango Works staff never open files); the lawyer's note (§7.5, already seen before stage 6); doc edits (§13); demo seed with a fake connection and files in each state | None | Opus + Fable check (Fable checks the privacy and deletion wording) | Articles in English and Thai; the privacy page live on the verified domain; PROGRESS updated |

Order: 1, then 2, then 3; 4 and 6 need 3; 5 needs 3 and 4; 7 needs 4 and 5; 8 last. Stage 6 can run beside 5 and 7, once the lawyer has seen §7.5. The customer upload entry (§3.5) is built in Phase 4 on top of stages 3 and 4.

**Not truly testable here:** Google's own behaviour at scale and its future charges; a real Workspace admin block (tested with a fake answer, and once by hand if a Workspace account is available).

### 11.2 The Drive spike

Run at the **start of the file storage build** (stage 1), not now. Each point ends in a yes or no with numbers, written into PROGRESS.

1. **Revoke, then reconnect the same account, and read an old file.** Decides Disconnect (decision 16), reconnect (§2.4, §6.2) and decision 3.
2. **A second OAuth client id in the same Google Cloud project** reading the files the first client made. Decides how firmly decision 20 binds (§2.2).
3. **`sha256Checksum`** (or whichever field Drive uses) returned for an uploaded file, and its value against the browser's hash (§3.3).
4. **Browser upload to a server-opened session across origins** [D1][D3]: open with an `Origin` header, upload from a browser on our origin, interrupt, resume. Whether the browser can read the `Range` and `Location` answers across origins, **preflight included**. Whether the address needs a token after opening. Decides A or B (decision 1).
5. **`refresh_token_expires_in`**: whether Google offers a time-limited grant for our scopes, what the response carries, and what happens at the end (§2.3).
6. Whether `drive.file` sees folders it made after the user renames and moves them, and after they are binned and restored (§5, §6.2).
7. `about.get` with `drive.file` (account and storage quota, §2.4, §6.1).
8. A file in a Workspace shared drive (decision 14); an account under Advanced Protection and a domain restricted to trusted apps, if test accounts can be had (§2.3).
9. The answer for a file Google restricts as abusive (§6.2), if one can be produced safely; otherwise from the error reference.
10. HEIC in each target browser (§3.1).
11. Netlify's limits on our account: function time, buffered and binary request size, streamed response size, scheduled function time (§3.2).
12. Latency of a contact sheet and a 600 KB photo from US East and Singapore on 4G (§4.3); quota units used per rental (§10.2).

## 12. Decisions

**Decisions 1 to 14: Mark, 20 Nov 2026**, all as recommended in draft 1. **Decisions 6 and 12 were reworded on 21 Nov 2026** (decision 6 by Mark's answer 5; decision 12 after the critique showed Limited Use does not bind `drive.file`). **Decisions 15 to 22: Mark, 21 Nov 2026**, answering the Fable critique of draft 2. The options considered are kept for the record.

| # | Decision | Decided | Options considered |
| --- | --- | --- | --- |
| 1 | **How bytes reach Drive** | **Browser to Drive, through a resumable session our server opens.** Through our server only as the fallback, in chunks under 4.5 MB, if the spike shows Drive refuses the browser | (a) Browser to Drive through a session our server opens; (b) through our server |
| 2 | **Who connects, reconnects and disconnects** | **The owner only**, like payment accounts. A manager sees the state and is told to ask the owner | (a) Owner only; (b) owner and manager |
| 3 | **Switching to another Google account** | **Allowed after the owner types the old account's email.** Old files stay unreadable until that account is reconnected (whether a reconnect restores them is a spike check). A "copy my files to the new account" job is a later stage, built if a shop needs it | (a) Typed confirmation, old files unreadable; (b) the same plus a copy job now; (c) not allowed, disconnect only |
| 4 | **Personal data in Drive file and folder names** | **None.** Order or document numbers only (§5) | (a) None; (b) the customer's name in the file name |
| 5 | **Previews** | **Our own small preview file**, made in the browser and stored beside the full file (§4.3); for inspections, one contact sheet (decision 17) | (a) Our own preview; (b) Drive's `thumbnailLink`; (c) none |
| 6 | **Check-out without a connected Drive** (reworded 21 Nov 2026) | **The check-out completes without photos, with a clear warning on the check-out screen that no photos will be kept** (§8: before the photo step and again where the hand-over is confirmed; the order then shows "No photos kept"). The signed agreement is kept as data (rendered text, signature strokes, hash). **Its PDF is always generated, whether or not a Drive is connected, so staff always have the option to send it to the customer: a "Send agreement" action on the order (email), sent only when staff choose it, never automatically. The PDF is stored only when a Drive is connected** | (a) Completes without photos, agreement as data; (b) a Drive required before the first check-out; (c) the signed PDF as the one file the platform keeps |
| 7 | **Phase 4 for a shop that won't connect a Drive** (1b §7, question 6) | **Allowed**: document number, country, expiry and who checked it, with no images. The expiry rule works on dates | (a) Allowed without images; (b) Drive required for Phase 4's KYC |
| 8 | **Tax-invoice and receipt PDFs** (kept 5 years by Thai law, payments §6.1 [T15]) | **The document's data is the record**, frozen at issue and kept 5 years on the platform; the PDF is regenerated identically on request; a copy goes to the shop's Drive when one is connected and is never deleted by the PDPA job. Revisited if Korn's answer to K9 says an e-Tax scheme requires the issued file itself to be kept | (a) Data is the record, PDF regenerated; (b) the PDF in Drive as the only copy |
| 9 | **Mango Works' own files** (vendor billing: transfer slips, withholding certificates; payments §7) | **Mango Works' own Google Drive, through the same module**, as a platform connection (§2.5: `scope = 'platform'`, no tenant). Never a shop's Drive, never a private bucket | (a) Mango Works' Drive through the module; (b) a private bucket on the platform; (c) kept by hand outside the platform |
| 10 | **The name and domain on Google's consent screen** | **Choose the platform's product name and domain before stage 2** if the name is close; otherwise launch as Mango Works on a Mango Works domain and verify the new brand later. Brand verification needs the homepage and privacy policy on a verified domain [G3], and is done before the first real shop (§2.2). Decision 20 fixes the project and client id under either | (a) Name first; (b) Mango Works now, rebrand later |
| 11 | **Google client library** | **Plain `fetch`** against the documented endpoints inside the module. No new dependency | (a) Plain `fetch`; (b) Google's `googleapis` package |
| 12 | **Mango Works staff and support access to shop files** (reworded 21 Nov 2026) | **Never, by any route.** No screen, role, function or support tool lets Mango Works staff or platform admins open a shop's file. **When support needs to see a file, it asks the shop for a screenshot.** This is **our own promise** to shops and a duty of Mango Works as the shop's processor under the PDPA (§7.4); Google's Limited Use rules do not require it of a `drive.file` app. The privacy policy and the processing agreement say so | (a) None; (b) a time-limited grant the owner switches on per case |
| 13 | **Caching when viewing** | **`no-store` for identity documents; private browser caching for previews and contact sheets of other kinds** (a day since decision 17). Never a shared cache, never a cache on our side | (a) As decided; (b) `no-store` for everything |
| 14 | **Workspace shared drives** | **Not in the first build**: the connected account's My Drive only. The spike checks whether a `drive.file` app can write to a shared drive [D16]; a later stage can add it | (a) Not now; (b) supported from the start |
| 15 | **Scopes** (21 Nov 2026) | **Add `openid email` to the Drive consent**, for a stable account id. All three scopes are non-sensitive (§2.1) | (a) Add `openid email`; (b) `drive.file` only, account read from `about.get` |
| 16 | **What Disconnect does at Google** (21 Nov 2026) | **Disconnect revokes at Google only if the Drive spike shows that reconnecting the same account restores access to old files.** Until then it deletes our token only and warns that files may become unreachable if access is removed at Google (§2.4) | (a) Token only until the spike says yes; (b) always revoke; (c) never revoke |
| 17 | **Previews and caching** (21 Nov 2026) | **One contact-sheet preview per inspection instead of ten. Non-identity previews cached privately in the browser for a day; identity documents stay `no-store`** (§4.1, §4.3, §10.2) | (a) As decided; (b) ten previews, five minutes' cache |
| 18 | **File size cap** (21 Nov 2026) | **10 MB for every file, PDFs included** (§3.1), inside Netlify's limits (§3.2) | (a) 10 MB; (b) 20 MB for PDFs |
| 19 | **Sending the signed agreement** (21 Nov 2026) | Recorded in decision 6 as reworded: the PDF is always generated; "Send agreement" on the order, by email, only when staff choose; stored only when a Drive is connected (§8) | |
| 20 | **The live Google Cloud project** (21 Nov 2026) | **Created now under Mango Works** (Mark does it, separately). The brand may be renamed later, but **the project and the OAuth client id are never changed**, including under decision 10's "rebrand later" (§2.2) | (a) Now, under Mango Works, never changed; (b) wait for the product name |
| 21 | **The customer's own upload entry** (21 Nov 2026) | **Designed in this doc now** (§3.5): a signed link, one record per link, size and count caps, expiry, rate limits. **Phase 4 builds it** | (a) Designed now, Phase 4 builds; (b) left to Phase 4's own design |
| 22 | **When the lawyer sees the PDPA note** (21 Nov 2026) | **Before file storage stage 6 (deletion)**, not just before Phase 4 goes live (§7.5) | (a) Before stage 6; (b) before Phase 4 goes live |

## 13. Doc edits for the consolidation pass

**Not made in this PR.** PRs 52, 54 and 55 have merged into `main`; **PR 56 (payments design) has not** (still open on 21 Nov 2026, branch at `7227f3d`). These edits are applied in one consolidation pass once PR 56 merges, to the files on `main`. Each edit names the file, the exact text to find and the exact text to put in its place. The `SPEC.md`, `phase-1b-plan.md`, `neon-move-plan.md` and `CLAUDE.md` anchors were checked to occur exactly once on `main` at `48f0f43`; the `payments-design.md` anchors on `docs/payments-design` at `7227f3d`.

**Applied on 21 Nov 2026** (branch `docs/file-storage-consolidation`, from `main` at `ce0b686`, PRs 56 and 61 merged): all 27 edits in §13.1 to §13.5, each find-text checked to occur exactly once first; none skipped. §13.1 edit 17 took decision number 52 (still the next free one). §13.4 was applied to `payments-design.md` as merged on `main`; its find-texts were unchanged from `7227f3d`. Commits: `1da1100` (SPEC.md), `35a0a81` (phase-1b-plan.md), `5c6cae5` (neon-move-plan.md), `f9b9c5a` (payments-design.md), `c5fc7d8` (CLAUDE.md).

### 13.1 `docs/platform/SPEC.md` (on `main`)

1. **Tech stack, the File storage row.** Find `per file (decision 49, 19 Nov 2026).` and replace with `per file (decision 49, 19 Nov 2026; design: docs/platform/file-storage-design.md, decided 20 and 21 Nov 2026).` The rest of the row stays as it is on `main`.
2. **Data model, the `tenants` row.** Find `line\_channel, google\_drive\_folder (the shop's connected Drive), charge\_before\_days` and replace with `line\_channel, charge\_before\_days` (the connection moves to `storage_connections`, edit 9).
3. **Data model, the `unit_renewals` row.** Find `file (a link to the shop's Drive, added with the file storage stage)` and replace with `files (rows in files naming this renewal as owner kind and id; file storage stage)`.
4. **Data model, the `maintenance_jobs` row.** Find `done\_by (staff or garage), receipt\_file, notes` and replace with `done\_by (staff or garage), notes (the receipt is a row in files naming this job as owner kind and id)`.
5. **Data model, the `customer_documents` row.** Find `file\_front\_ref, file\_back\_ref (links to files in the shop's Drive)` and replace with `images (rows in files naming this document as owner kind and id, slots front and back; each file's delete\_after is set by the shop's document\_retention\_months after the rental closes, held while a case is open)`.
6. **Data model, the `inspections` row.** Find `fuel\_level, photos, damage\_marks (JSON on diagram), notes, signed\_by\_customer, signature\_file, at` and replace with `fuel\_level, photos (→ files; none when no Drive is connected), damage\_marks (JSON on diagram), notes, signed\_by\_customer, at`.
7. **Data model, the `documents` row.** Find `| documents | order\_id, kind (contract, addendum, invoice, receipt, credit\_note), number, pdf, signed\_at, sent\_at | Numbered per tenant per kind |` and replace with `| documents | order\_id, kind (contract, addendum, invoice, receipt, credit\_note), number, content\_snapshot, signature\_strokes, hash, signed\_at, sent\_at (the PDF, when stored, is a row in files naming this document as owner kind and id) | Numbered per tenant per kind. The data is the record; the PDF is regenerated from it on request. Tax documents are kept 5 years. A signed agreement's text and signature strokes are kept for the shop's agreement\_retention\_months after the rental closes (held while a case is open), then erased, keeping the hash, signer, time and device (file-storage-design §7.1) |`.
8. **Data model, the `cash_expenses` row.** Find `description, receipt\_file, paid\_by` and replace with `description, paid\_by (the receipt is a row in files naming this expense as owner kind and id)`.
9. **Data model, three new rows**, added directly after the `customer_documents` row:
   `| storage\_connections | scope (tenant or platform), tenant\_id, provider, account\_id, account\_email, root\_folder\_id, folder\_ids, state, granted\_scopes, grant\_expires\_at, connected\_by, connected\_at, last\_ok\_at, last\_error, encrypted refresh token | One active per shop, plus Mango Works' own; owner connects; token readable by no signed-in role (file-storage-design §2.5) |`
   `| files | tenant\_id, connection\_id, owner\_kind, owner\_id, slot, client\_key, provider\_file\_id, preview\_file\_id, name, mime, size, sha256, state, source, created\_by, delete\_after, deleted\_at | A link to one file in the shop's Drive; names its owner, so no owning table carries a file column; no path or URL stored |`
   `| file\_access\_log | tenant\_id, file\_id, kind, user\_id, action, purpose, at | Append-only; written in the same call that opens the file |`
10. **Check-out and check-in, step 4.** Find `4. Take guided photos: front, back, left, right, dash; extra photos optional.` and replace with `4. Take guided photos: front, back, left, right, dash; extra photos optional. Without a connected Google Drive the check-out completes without photos, and the screen warns clearly, before this step and again where the hand-over is confirmed, that no photos will be kept (decided 20 Nov 2026).`
11. **Check-out and check-in, step 7.** Find `7. Customer reviews and signs the contract on screen. The PDF is generated, stored, then emailed or sent by LINE.` and replace with `7. Customer reviews and signs the contract on screen. The signed agreement is kept as data (its text, the signature strokes and a hash), and its PDF is always generated, whether or not a Drive is connected. Staff can send it to the customer with "Send agreement" on the order (email), only when they choose to, never automatically. The PDF is stored only when the shop's Drive is connected (decided 21 Nov 2026).`
12. **Customers and KYC › Document storage, the "One module" bullet.** Find `` (outline in `docs/phase-1b-plan.md` §7; its design is still to be written). `` and replace with `` (design: `docs/platform/file-storage-design.md`, decided 20 and 21 Nov 2026). ``
13. **Customers and KYC › Document storage, two new bullets**, added directly after the "Trade-offs to know" bullet:
    `- **Public images stay on the platform.** Shop, model and catalog photos and logos are shown on the public sites and stay on the platform's own store. Everything else is a private file in the shop's Drive.`
    `- **Mango Works never opens a shop's files** (decided 20 Nov 2026). No screen, role or support tool reaches them; when support needs to see a file, it asks the shop for a screenshot.`
14. **Documents and messages, the invoice bullet.** Find `- Invoice, tax invoice/receipt and credit note, numbered per tenant (e.g. INV-2026-00042). Templates per tenant: logo, colours, terms, custom fields.` and replace with `- Invoice, tax invoice/receipt and credit note, numbered per tenant (e.g. INV-2026-00042). Templates per tenant: logo, colours, terms, custom fields. Each document's data is frozen at issue and kept 5 years on the platform; its PDF is regenerated identically on request, with a copy in the shop's Drive when one is connected (decided 20 Nov 2026).`
15. **Review decisions › Build order.** In the line that starts `**Build order.**`, find `1b → 4 onward` and replace with `1b → file storage → 4 onward`.
16. **Build plan, Phase 4.** Find `documents stored in the shop's connected Google Drive (the file storage stage comes first)` and replace with `documents stored in the shop's connected Google Drive (the file storage stage, docs/platform/file-storage-design.md, comes first; a shop without a Drive records document numbers and expiry without images)`.
17. **Change log**, a new row at the top with the next free decision number (**52** on `main` at `48f0f43`; check again at the time, since PR 56 or another PR may add one first):
    `| 52 | File storage design decided: private files in the shop's Drive through one module, each file naming its owner; owner connects (openid email and drive.file); uploads straight to Drive, checked by the server; viewing through the server with an access log and locked-down headers; one contact sheet per inspection; 10 MB cap; check-out without a Drive completes without photos, with a warning; the signed agreement PDF always generated, sent only when staff choose, stored only with a Drive; tax documents kept as data with the PDF regenerated; a customer upload link for documents before arrival; Mango Works never opens shop files | Decision | Tech stack; Data model; Check-out; Customers › Document storage; Documents; Build order | Before 4 |`
18. **Documents and messages, the signed record bullet.** Find `- **Signed record:** the signed PDF is locked and stored with time, signer name, device and a tamper-check fingerprint, then emailed (and sent by LINE) to the customer.` and replace with `- **Signed record:** the signed agreement is kept as data (its text, the signature strokes, the time, signer name, device and a tamper-check fingerprint). Its PDF is always generated from that data and stored in the shop's Drive when one is connected; staff send it to the customer with "Send agreement" (email) only when they choose to, never automatically (decided 21 Nov 2026).` The bullet's last sentence (`Extensions and unit swaps produce a signed addendum.`) stays.
19. **Customers and KYC, the online booking line.** Find `- Online booking collects documents at checkout or by a pre-arrival link.` and replace with `- Online booking collects documents at checkout or by a pre-arrival link: a signed link for one document record, with size and count caps, an expiry and rate limits, writing into the shop's Drive; staff check every file it brings (file-storage-design §3.5; built in Phase 4).`

### 13.2 `docs/phase-1b-plan.md` (on `main`)

1. **Summary, point 8.** Find `outlined in §7 and still to be designed.` and replace with `` outlined in §7 and designed in `docs/platform/file-storage-design.md` (decided 20 and 21 Nov 2026). ``
2. **§6.2, open point 1.** Find `1. **The design of "Shop file storage (Google Drive)"** (§7): its own Fable design, later, before Phase 4.` and replace with `` 1. ~~**The design of "Shop file storage (Google Drive)"** (§7): its own Fable design, later, before Phase 4.~~ Designed in `docs/platform/file-storage-design.md`; Mark decided its points on 20 and 21 Nov 2026. ``
3. **§7, first paragraph.** Find `**Not part of Phase 1b. Its own stage, before Phase 4, with its own Fable design to be written later.** This outline only fixes what Mark decided (decision 10) and what the design must answer.` and replace with `` **Not part of Phase 1b. Its own stage, before Phase 4.** Its design is `docs/platform/file-storage-design.md` (decided 20 and 21 Nov 2026), which replaces the shape below wherever they differ. The seven questions are answered there: 1 in §2.2, 2 in §2.5, 3 in §3, 4 in §2.3, 5 in §9, 6 by decision 7, 7 in §7.5. ``

### 13.3 `docs/platform/neon-move-plan.md` (on `main`)

Draft 2's edit 1 (stage 6's row) is dropped: the row on `main` already says public images only.

1. **§7.5, a note after the line `Stages 3 to 7 can overlap once stage 2 is merged; 4 needs 3. Stage 8 needs all of 2 to 7.`**, as its own paragraph: `` **Files after decision 49** (private files in each shop's Google Drive, designed in `docs/platform/file-storage-design.md`): only public photos move to R2, so §2's "private documents by presigned address" and §5's "50 GB of files with documents" no longer apply; at 50 shops the public photos stay inside R2's free 10 GB. Private files are outside the restore window as well as outside R2: the shop's Drive is their only copy. ``

### 13.4 `docs/platform/payments-design.md` (PR 56, `docs/payments-design` at `7227f3d`)

1. **§8.2, the row "A shop's keys for a provider with no platform model".** Find `` decrypted only inside `@mango/payments`. Not Supabase Vault, so the move to Neon does not touch it | `` and replace with `` decrypted only inside `@mango/payments`. Not Supabase Vault, so the move to Neon does not touch it. The same encryption helper keeps each shop's Google Drive refresh token (`docs/platform/file-storage-design.md` §2.5); whichever stage comes first builds it | ``
2. **§7.2, the `invoice_payments` line in the code block.** Find (28 leading spaces) `withholding amount and certificate file, slip file, received_at, recorded_by, provider_ref` and replace with `withholding amount, received_at, recorded_by, provider_ref (the slip and the withholding certificate are rows in files naming this payment as owner kind and id, in Mango Works' own Drive)`; then add one line directly after the code block: `` Slips and withholding certificates are Mango Works' records, kept in Mango Works' own Google Drive through the storage module (`docs/platform/file-storage-design.md`, decision 9), never in a shop's Drive. ``

### 13.5 Root `CLAUDE.md` (on `main`)

1. **"Not tied to Supabase", rule 2.** Find `` - **File storage sits behind one module.** Uploading, deleting and making the address of a stored file go through that module and nothing else calls `.storage`. `` and replace with `` - **File storage sits behind one module.** Uploading, deleting, viewing and making the address of a stored file go through that module, and nothing else calls `.storage` or a file provider's API. Public images live on the platform's own store; every private file lives in the shop's connected provider (Google Drive today), with only a link kept (`docs/platform/file-storage-design.md`). Mango Works staff never open a shop's files. ``

### 13.6 Already in this PR

- `docs/PROGRESS.md`: the entry for this design. Later, an entry per stage.

## 14. Sources

Google's pages were read on **20 Nov 2026**. Points added in draft 3 that rest on the critique and are not yet checked by us are marked "to confirm" in the text: Netlify's function limits; Limited Use applying only to sensitive and restricted scopes [G13]; RISC's coverage [G11]; a password change revoking only Gmail-scope tokens [G8]; `refresh_token_expires_in`; Advanced Protection; `cannotDownloadAbusiveFile`; Google's inactive-account policy; the PDPC's August 2025 fine on a processor.

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
- [G13] Google API Services User Data Policy (Limited Use): https://developers.google.com/terms/api-services-user-data-policy
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
- [D12] Custom file properties (limits: 124 bytes for a key and value together): https://developers.google.com/workspace/drive/api/guides/properties
- [D13] Search for files (`appProperties has`): https://developers.google.com/workspace/drive/api/guides/search-files
- [D14] Folders (create, 500,000 items, 100 levels): https://developers.google.com/workspace/drive/api/guides/folder
- [D15] OAuth 2.0 scopes list (`drive.file` wording): https://developers.google.com/identity/protocols/oauth2/scopes
- [D16] Shared drives support (`supportsAllDrives`): https://developers.google.com/workspace/drive/api/guides/enable-shareddrives
- [D17] App data folder (`drive.appdata`): https://developers.google.com/workspace/drive/api/guides/appdata
- [D18] Push notifications (`files.watch`, `changes.watch`): https://developers.google.com/workspace/drive/api/guides/push

**Other:** [T15] is the payments design's source for the 5-year keeping rule for tax invoices (`docs/platform/payments-design.md` §13, branch `docs/payments-design`).

**Not checked, and said so above:** everything in §11.2; Netlify's bandwidth prices; OneDrive, Dropbox and any other provider; whether brand verification has a fee (none stated).

## 15. Changes since draft 2

Draft 2's changes since draft 1 (the fourteen decisions written in, the check-out warning, decision 12, §13 as an exact list) are all kept.

| What | Change | Where |
| --- | --- | --- |
| Status and header | Draft 3; written from `main` at `48f0f43` (PRs 52, 54, 55 merged) and `docs/payments-design` at `7227f3d` (PR 56 open) | Header |
| Decisions | Eight new decisions of 21 Nov 2026 (15 to 22); decisions 6 and 12 reworded; 1, 3, 5, 9, 10, 13 gain cross-references | §12 |
| Reconnect | "Reconnecting restores every link" marked unproven; spike check 1; Disconnect deletes our token only until the spike says yes (decision 16) | §2.4, §6.2, decision 3, §11.2 |
| Scopes | `openid email` added (decision 15); account id and email from the ID token and `about.get` | §2.1, §2.4 |
| Netlify limits | Draft 2's unchecked figures replaced by Netlify's current ones, to confirm on our account; 10 MB cap (decision 18); the export built in the browser from logged downloads; fallback B in chunks under 4.5 MB | §3.2, §4.1, §7.3, §10.3 |
| Serving from our origin | Our own content type, `nosniff`, `Content-Disposition`, sandbox CSP | §4.1 |
| Upload trust | The server keeps the session address and asks Drive for progress and the finished file; Drive's checksum compared with the browser's hash; client keys stop duplicates; the sweep marks `never_arrived` and keeps the row | §3.1, §3.3 |
| Limited Use | Applies to sensitive and restricted scopes only; decision 12 kept as our own promise and a processor duty | §2.2, §4.2, decision 12, stage 8 |
| Quota | "Far under quota" replaced by figures at 200 shops × 50 rentals a day: 142M a day, a busy minute of 1.2M over the 1M limit; with the contact sheet and browser cache, about 0.4M | Summary 9, §10.2 |
| Agreement | Always generated; "Send agreement" when staff choose; stored only with a Drive; a retention rule for its text and strokes | §1.1, §7.1, §8, decision 6 |
| Customer upload entry | Designed (decision 21) | §3.5, §4.2 |
| Processor duties | Processing agreement, breach runbook, US functions until go-live; the lawyer's list, seen before stage 6 (decision 22) | §7.4, §7.5 |
| Brand verification | Required before the first real shop; the live project created now and never changed (decision 20) | §2.2 |
| RISC | Dropped, with why | §2.5, §9 |
| Token table | Authenticated data in the encryption; master key off the marketplace site; composite key; platform scope for Mango Works' connection | §2.5 |
| Grants and blocked accounts | `refresh_token_expires_in`; Advanced Protection and trusted-app restrictions | §2.3, stage 8 |
| Jobs | Health check and deletion in batches inside 30 s | §6.1 |
| States | Bin state needs a metadata read; binned folders; `flagged` files; a password change does not revoke | §4.1, §6.2 |
| Device queue | A week on a shared phone; iPhone storage and no background upload | §3.4 |
| The shop's account | A full Drive stops Gmail; inactive personal accounts | §6.6, §10.2 |
| Owners | Every file names its owner kind and id; no file column on owning tables (Phase 3's append-only payments) | §1.1, §3.3, §13.1 |
| Alternatives | New section | §2.6 |
| Drive spike | New section, run at the start of the build | §11.2 |
| Nits | 400M a day is a billing threshold; `appProperties` 124 bytes for key and value together | §10.1, §3.3, §5 |
| Doc edits | Rewritten against `main`: SPEC edit 1 a short replace; edits 3, 4, 5, 7, 8, 9, 11, 17 changed; new edits 18 and 19; Neon edit 1 dropped; payments at `7227f3d`. Not applied: PR 56 has not merged | §13 |
