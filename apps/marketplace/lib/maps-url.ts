/**
 * A shop's "open in Google Maps" link. The shop types it and customers click
 * it, so only an https address on a short list of Google Maps hosts is kept;
 * anything else (another site, javascript:, a Google redirect address) is
 * dropped.
 *
 * The database has the same rule as a trigger on shops.maps_url
 * (check_shop_links(), 20261120000100): a shop owner can write that column
 * without this code. The two are held together by one table of cases,
 * lib/maps-url.cases.ts, which both test suites run. Change one and the
 * other, and add the case there.
 *
 * The rule, read from the text itself and not from what a URL parser makes
 * of it (a parser folds "/maps/../url" to "/url" and is forgiving about
 * "https:\\host"):
 *   - at most 500 characters, no white space, control character or backslash;
 *   - "https://", then a host that is exactly one on the list (so no user
 *     part, no port, no upper case), then a path;
 *   - the path (up to "?" or "#") holds no "..", and no "%2e" or "%2E";
 *   - on the Google hosts the path is /maps or starts with /maps/ (never
 *     /url, Google's redirect); on goo.gl it starts with /maps/; on
 *     maps.app.goo.gl it is anything.
 *
 * Two more kinds of link that shops paste from Google are kept, each in one
 * narrow form, matched against the whole text (same length and character
 * checks first):
 *   - a g.co short share link: "https://g.co/kgs/" and one name of letters,
 *     digits, "_" and "-", with nothing after it (no further path, no query,
 *     no fragment);
 *   - a classic business-listing link: "https://", then maps.google.com,
 *     www.google.com or google.com, no path (or "/" alone), then "?cid=" and
 *     1 to 25 digits, with no other parameter and no fragment.
 *
 * The list names hosts one by one. A new country's Google domain is added
 * here and in the trigger when a market opens there; no pattern stands in
 * for "any country".
 */

/** Hosts that serve Maps under /maps beside other things. */
const GOOGLE_HOSTS: readonly string[] = [
  "www.google.com",
  "google.com",
  "maps.google.com",
  "www.google.co.th",
  "google.co.th",
  "maps.google.co.th",
];

const MAX_LENGTH = 500;
const UNSAFE = /[\s\p{Cc}\\]/u;
/** https://, the host (everything up to the first "/", "?" or "#"), the path. */
const PARTS = /^https:\/\/([^/?#]+)(\/[^?#]*)/;
const DOTS = /\.\.|%2e/i;
/** The whole of a g.co short share link. */
const SHORT_LINK = /^https:\/\/g\.co\/kgs\/[A-Za-z0-9_-]+$/;
/** The whole of a business-listing link: no path, cid alone. */
const LISTING_LINK =
  /^https:\/\/(maps\.google\.com|www\.google\.com|google\.com)\/?\?cid=[0-9]{1,25}$/;

export function safeMapsUrl(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_LENGTH || UNSAFE.test(value)) return null;
  if (SHORT_LINK.test(value) || LISTING_LINK.test(value)) return value;
  const parts = PARTS.exec(value);
  if (!parts) return null;
  const [, host, path] = parts;
  if (DOTS.test(path)) return null;
  if (host === "maps.app.goo.gl") return value;
  if (host === "goo.gl") return path.startsWith("/maps/") ? value : null;
  if (!GOOGLE_HOSTS.includes(host)) return null;
  return path === "/maps" || path.startsWith("/maps/") ? value : null;
}
