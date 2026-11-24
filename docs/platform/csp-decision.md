# CSP: does `script-src` need `'unsafe-eval'` or `'wasm-unsafe-eval'`?

Decision record for Mark, 24 Nov 2026. Covers both apps. The policy itself is not changed by this document.

## The short answer

| App | `'unsafe-eval'` in production | `'wasm-unsafe-eval'` in production | In `next dev` |
| --- | --- | --- | --- |
| Platform | **Leave out** | **Leave out** | `'unsafe-eval'` (as today) |
| Marketplace | **Leave out**, once the deploy preview with the real Google key reports nothing | **Leave out** | `'unsafe-eval'` (as today) |

Nothing either app ships to the browser needs to build code from text or run WebAssembly. The one place that tries (zod, in the platform) checks first and works without it. This is already what the code does: `'unsafe-eval'` is added only when `NODE_ENV` is `development`, and `'wasm-unsafe-eval'` is in neither policy.

## 1. What the report-only policy holds today

Both apps send the same set of headers (`lib/security-headers.ts`, called from `next.config.ts` › `headers()`). Enforced: `Content-Security-Policy: frame-ancestors 'none'` only, plus `X-Frame-Options`, `nosniff`, `Referrer-Policy` and HSTS. Everything else is in `Content-Security-Policy-Report-Only`.

**Platform** (`apps/platform/lib/security-headers.ts`)

| Directive | Values |
| --- | --- |
| `default-src` | `'self'` |
| `script-src` | `'self' 'unsafe-inline'`, plus `'unsafe-eval'` in development only |
| `style-src` | `'self' 'unsafe-inline'` |
| `img-src` | `'self' data: blob:` and the Supabase origin |
| `media-src` | `'self' blob:` |
| `font-src` | `'self'` |
| `connect-src` | `'self'`, the Supabase origin (https and wss), `https://*.sentry.io` |
| `worker-src` | `'self' blob:` |
| `manifest-src` | `'self'` |
| `frame-src` | `'none'` |
| `object-src` | `'none'` |
| `base-uri`, `form-action` | `'self'` |
| `frame-ancestors` | `'none'` |

**Marketplace** (`apps/marketplace/lib/security-headers.ts`)

| Directive | Values |
| --- | --- |
| `default-src` | `'self'` |
| `script-src` | `'self' 'unsafe-inline'`, `'unsafe-eval'` in development only, `https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com blob:` |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` |
| `img-src` | `'self' data: blob:`, the Supabase origin, the five Google domains |
| `font-src` | `'self' https://fonts.gstatic.com` |
| `connect-src` | `'self'`, Supabase (https and wss), the five Google domains, `data: blob:` |
| `worker-src` | `'self' blob:` |
| `frame-src` | `https://*.google.com` |
| `object-src` | `'none'` |
| `base-uri`, `form-action` | `'self'` |
| `frame-ancestors` | `'none'` |

Neither has `report-uri` or `report-to`: violations show only in the visitor's browser console.

## 2. Does any production code path need eval or WebAssembly?

### How it was checked

Both apps were built for production (`next build`, Next.js 16.4.5, Turbopack) from `origin/main` at `4901c0d`, with placeholder environment values and a dummy Sentry DSN so that Sentry's browser code is in the bundle. Every `.js` file the browser can load (`.next/static`, 55 files in the marketplace, 69 in the platform) was searched for `eval(`, `new Function(`, `Function("…")`, the Function constructor taken into a variable (`=Function`), `WebAssembly` and `.wasm`. Each hit was traced to its package. Files under `.next/server` were not counted: the CSP applies only in the browser.

### What was found

| Hit | Where | Package | Runs in the browser in normal use? |
| --- | --- | --- | --- |
| `Function("return this")()` and `Aa=Function … Aa.bind` | `0cz1d0mv5g_q7.js`, both apps | core-js, inside Next.js's `polyfillFiles` | **No.** Next.js loads this file only with `nomodule`, so only browsers too old for ES modules fetch it. Even there, the `Function(…)` is the last fallback after `globalThis`, `window` and `self`, which every such browser has. |
| `Function("")` inside `try/catch` (zod's `allowsEval` probe) | `2gsh2yebcgc7h.js`, platform only | zod 4.6.7 | **Yes, but optional.** Runs the first time a form validates with a zod object schema. If the browser refuses, the `catch` returns `false`. |
| `compile(){let e=Function; … return new e(…)}` (zod's JIT) | same chunk | zod 4.6.7 | **Only if the probe above succeeded.** With eval refused, zod validates the normal way, with the same result. |
| `WebAssembly.Exception` (`instanceof` and `[object WebAssembly.Exception]`) | `05y-crrvtsg--.js`, `0xs6c_tavu5i6.js`, platform only | `@sentry/nextjs` (166 and 70 mentions of "sentry" in those chunks) | **Yes, but it compiles nothing.** Sentry checks whether a thrown error is a WebAssembly exception, to name it in a report. Reading the `WebAssembly` object is not blocked by any CSP; only compiling or instantiating a module is. |

Nothing else: no `eval(`, no string `setTimeout`, no `.wasm` file, no `WebAssembly.compile`/`instantiate` in either app. The marketplace browser bundle has no zod and no Sentry.

How zod reaches the platform's browser bundle: `lib/fleet.ts`, `lib/general-products.ts`, `lib/listing-settings.ts` and `lib/tenant-settings.ts` import zod and are imported by client components (`fleet/unit-forms.tsx`, `products/moto-mangos-forms.tsx`, `products/gear-stock.tsx`, `products/general-forms.tsx`, `components/fleet/drag-rows.tsx`, `settings/settings-form.tsx`). That matches the 20 Nov check in `docs/PROGRESS.md` (M6), which saw zod's probe as the only report, on a product, New product and a vehicle.

zod's own source says what to do about the probe (`node_modules/zod/v4/core/util.js`, `allowsEval`): under `jitless` it skips the probe, because "strict CSPs report the caught `new Function` as a `securitypolicyviolation` even though the throw is swallowed". So `z.config({ jitless: true })`, run once in the browser before any schema is used, makes the platform report nothing and costs only zod's JIT speed-up on large forms (not noticeable at these sizes).

### Third-party scripts the apps load

What the code loads in the browser, from a search of both apps (`<Script`, `next/script`, `document.createElement("script")`, and each provider's name):

| Third party | App | How it is loaded | Their published CSP needs | eval / wasm? |
| --- | --- | --- | --- | --- |
| Google Maps JavaScript API (`maps`, `marker`, `places` libraries; Advanced Markers with a map ID) | Marketplace | `lib/google-maps.ts` adds `https://maps.googleapis.com/maps/api/js?…&loading=async` | [Google's CSP guide](https://developers.google.com/maps/documentation/javascript/content-security-policy) recommends a nonce-based strict CSP and gives an allowlist sample. **The sample `script-src` contains `'unsafe-eval'`, with no reason given and without saying it is required.** It lists `blob:` in `worker-src` and `connect-src`, Google domains in `img-src`, `connect-src`, `frame-src *.google.com`, `fonts.googleapis.com`/`fonts.gstatic.com`. | Not seen to need it (see below); not proven with a real key |
| Sentry browser SDK | Platform | Bundled (`instrumentation-client.ts`), off without `NEXT_PUBLIC_SENTRY_DSN` | [Sentry's Next.js guide](https://docs.sentry.io/platforms/javascript/guides/nextjs/) and its [security-policy reporting page](https://docs.sentry.io/platforms/javascript/guides/nextjs/security-policy-reporting.md) say nothing about eval; they ask for `sentry.io` in `connect-src`. | No (bundle scan above) |
| Stripe.js / Elements / Checkout | Neither yet (Phase 4) | — | [Stripe's security guide](https://docs.stripe.com/security/guide#content-security-policy) lists `script-src` (`js.stripe.com`, `*.js.stripe.com`, `checkout.stripe.com`), `connect-src` (`api.stripe.com`), `frame-src` (`js.stripe.com`, `*.js.stripe.com`, `hooks.stripe.com`, `checkout.stripe.com`), `img-src *.stripe.com`. **No `'unsafe-eval'` or `'wasm-unsafe-eval'`.** | No |
| Google, LINE, Apple sign-in | Both | Supabase `signInWithOAuth()`: a full-page navigation to Supabase, then the provider. No provider script on our pages. | Not applicable: navigation is not covered by `script-src`, and it is not a form post, so `form-action` does not apply either. | No |
| LINE share | Marketplace (vendor team invite) | A plain link to `line.me/R/share` | Not applicable | No |
| Google Fonts (Geist) | Platform | `next/font/google`, downloaded at build time and served from our own origin | Covered by `font-src 'self'` | No |
| Analytics | Neither | — | — | — |

On Google Maps: the 20 Nov run in `docs/PROGRESS.md` loaded Google's loader on a placeholder key and saw no reports, but the placeholder key stops Google before a map, the Advanced Markers or the Places widget is drawn. Google's sample having `'unsafe-eval'` is a reason to look, not proof of need. It is settled by one check on the deploy preview with the real key (below).

## 3. Development only

The [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy) says `'unsafe-eval'` is required in development "because React uses `eval`" (React's debugging of server stacks) and "is not required for production". Its own examples add it only when `NODE_ENV` is `development`.

Both apps already do exactly that: `next.config.ts` passes `development: process.env.NODE_ENV === "development"`, and `contentSecurityPolicy()` adds `'unsafe-eval'` only then. `next build` and `next start` run with `NODE_ENV=production`, and so do Vercel's preview and production deployments, so every deployed copy gets the production policy. No change is needed here. Neither dev nor production uses WebAssembly.

## 4. Recommendation

**Platform: leave out both, and keep them out.**
- `'unsafe-eval'`: nothing needs it. Set `z.config({ jitless: true })` in the browser (for example at the top of `instrumentation-client.ts`, which runs before the app) before the policy is enforced, so zod's probe stops showing as a violation.
- `'wasm-unsafe-eval'`: nothing needs it. Sentry only reads the name `WebAssembly`.

**Marketplace: leave out both, after one check.**
- `'unsafe-eval'`: nothing in our bundle needs it. Before enforcing, open on the Vercel deploy preview with the real Maps key and map ID: search with a map, a shop's map, and the vendor map picker with a Places search. If the console shows no `unsafe-eval` report, leave it out. If Google's script does report one, add `'unsafe-eval'` to the marketplace's production `script-src` only, and note why next to it.
- `'wasm-unsafe-eval'`: nothing needs it. Same check covers it.

**Do not add `'unsafe-eval'` "to be safe"** to either app: it would let any injected string become code (see risks).

## 5. What else must change before the policy is enforced

1. **A report endpoint.** Today a violation only reaches the visitor's console, so a real break after enforcing would go unseen. Add both `report-uri` and `report-to` (MDN marks [`report-uri`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/report-uri) deprecated but says to send both until [`report-to`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/report-to) is everywhere), with a `Reporting-Endpoints` header. The platform already has Sentry: its security endpoint (`https://o<org>.ingest.sentry.io/api/<project>/security/?sentry_key=<public key>`, Project Settings › Security Headers) is the least work; the marketplace would need its own Sentry project or a small route of our own. Run report-only with reporting on for a week or two on live before enforcing.
2. **Nonces, to drop `'unsafe-inline'` from `script-src`.** Without them, an enforced policy still lets any injected inline script run, which is most of what a CSP is for. Next.js adds a per-request nonce from the proxy (middleware) to its own scripts, but only on pages rendered per request.
   - Platform: almost every route is already dynamic (`ƒ` in the build), and it has no `cacheComponents`, so nonces fit. The inline theme script in `app/layout.tsx` (`followSystemTheme`) must take the nonce.
   - Marketplace: it uses `cacheComponents` and partial prerendering; the Next.js guide says "Partial Prerendering (PPR) is incompatible with nonce-based CSP". The choices are giving up static/partial prerendering on the pages that need it, Next.js's experimental hash-based CSP (`experimental.sri`, App Router, build-time scripts only), or keeping `'unsafe-inline'` there. That is a separate decision.
   - With nonces, add `'strict-dynamic'` so a trusted script can load others; Google's guide says the Google domains then need not be listed in `script-src`.
3. **zod `jitless`** in the platform's browser code (above).
4. **The marketplace Maps check** with the real key (above).
5. **Phase 4 adds Stripe**: its domains in `script-src`, `connect-src`, `frame-src` and `img-src` as Stripe lists them, in the same change that adds Stripe.js.
6. **`style-src 'unsafe-inline'`** stays: Next.js and the UI library set inline styles, and Google Maps sets styles too. Far lower risk than inline scripts.

## 6. The risk of each choice, in plain words

**Leaving `'unsafe-eval'` out (recommended).**
If we are wrong, a feature that builds code from text stops working once the policy is enforced. Here that is at worst zod running a little slower in the platform (it already falls back), or, on the marketplace, part of Google Maps failing if Google's script turns out to need it. The deploy-preview check and a reporting endpoint during the report-only weeks are how we would see it before customers do.

**Putting `'unsafe-eval'` in.**
Nothing visible breaks, but if an attacker ever gets text of theirs into the page (a shop name, a note, a URL parameter that slips through), any script that passes it to `eval`, `new Function` or a string `setTimeout` runs it as code with the visitor's session. It also stops some of the protection nonces would give. Worth it only if a library we cannot replace needs it, and then only on the app that loads that library.

**Leaving `'wasm-unsafe-eval'` out (recommended).**
If we later add a library that uses WebAssembly (an image or barcode decoder, a PDF tool), it fails to start under the enforced policy until it is added. The report endpoint shows it at once, and the fix is one word for that app.

**Putting `'wasm-unsafe-eval'` in.**
Smaller risk than `'unsafe-eval'`: it lets the page compile WebAssembly, not run JavaScript from text. But nothing uses it today, so it would be an open door with no one going through it.
