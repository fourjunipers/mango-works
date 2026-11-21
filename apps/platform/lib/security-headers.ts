/**
 * Response headers sent with every page and route (next.config.ts).
 *
 * Enforced:
 * - `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options:
 *   DENY`: no other site can show these pages in a frame (clickjacking).
 *   This one directive is all the enforced policy holds, so it cannot stop
 *   anything from loading.
 * - `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
 *   `Strict-Transport-Security` (one year, this host only: no
 *   includeSubDomains and no preload until the owner decides that for the
 *   whole domain).
 *
 * Report-only, for now: the full policy below. A browser reports what it
 * would have blocked in its console and blocks nothing. It has no nonces, so
 * inline scripts are allowed ('unsafe-inline'): Next.js writes inline scripts
 * into every page, and nonces would make every page render per request.
 * Tightening that, and enforcing the policy, come after it has run clean on
 * staging.
 */

export type Header = { key: string; value: string };

type Options = {
  /** NEXT_PUBLIC_SUPABASE_URL: the API, sign-in and stored files. */
  supabaseUrl: string | undefined;
  /** `next dev` needs eval for its error overlay and fast refresh. */
  development?: boolean;
};

function origins(supabaseUrl: string | undefined) {
  try {
    const url = new URL(supabaseUrl ?? "");
    const ws = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
    return { http: url.origin, ws };
  } catch {
    return null;
  }
}

/** Error reports (instrumentation-client.ts), when a DSN is set. */
const SENTRY = "https://*.sentry.io";

export function contentSecurityPolicy({
  supabaseUrl,
  development = false,
}: Options): string {
  const supabase = origins(supabaseUrl);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    // blob: and data: are the QR codes and the camera frames of the scanner.
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      ...(supabase ? [supabase.http] : []),
    ],
    "media-src": ["'self'", "blob:"],
    "font-src": ["'self'"],
    "connect-src": [
      "'self'",
      ...(supabase ? [supabase.http, supabase.ws] : []),
      SENTRY,
    ],
    // The service worker (public/sw.js).
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function securityHeaders(options: Options): Header[] {
  return [
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    {
      key: "Content-Security-Policy-Report-Only",
      value: contentSecurityPolicy(options),
    },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=31536000" },
  ];
}
