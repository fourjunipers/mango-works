/**
 * A shop's "open in Google Maps" link. The shop types it and customers click
 * it, so only an https address on Google Maps' own hosts is kept; anything
 * else (another site, javascript:, a Google redirect address) is dropped.
 *
 * The database has the same rule as a check on shops.maps_url
 * (20261120000100): a shop owner can write that column without this code.
 */

/** google.com, google.co.th, google.com.au, with or without www. or maps. */
const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:com|co\.[a-z]{2}|com\.[a-z]{2})$/;

export function safeMapsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password)
    return null;
  // The parser is forgiving ("https:\\host", control characters); the
  // stored text must already be the address it reads.
  if (!value.startsWith(`https://${url.host}/`)) return null;
  const host = url.hostname;
  const path = url.pathname;
  // Share links: maps.app.goo.gl/<code>, goo.gl/maps/<code>, g.co/kgs/<code>.
  if (host === "maps.app.goo.gl") return value;
  if (host === "goo.gl") return path.startsWith("/maps/") ? value : null;
  if (host === "g.co") return path.startsWith("/kgs/") ? value : null;
  if (!GOOGLE_HOST.test(host)) return null;
  // maps.google.* serves only Maps; on google.* the path must be Maps'.
  if (host.startsWith("maps.")) return value;
  return path === "/maps" || path.startsWith("/maps/") ? value : null;
}
