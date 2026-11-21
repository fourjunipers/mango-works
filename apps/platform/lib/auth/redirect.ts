/** Any address resolved against this origin must still be on it. */
const BASE = "http://x";

/**
 * Control characters (browsers drop tab, line feed and carriage return from
 * an address before reading it, so "/\t/host" is "//host") and backslashes
 * (browsers read "\" as "/").
 */
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

/**
 * Two leading slashes, written with "/" or "\" in any mix, with or without
 * white space before them: a scheme-relative address, which names another
 * host. It is refused by its first characters, before the origin check,
 * because that check cannot see it when the host named is the very one the
 * check resolves against ("//x", "//evil.example@x/").
 */
const SCHEME_RELATIVE = /^\s*[/\\]{2}/;

/**
 * Only same-site paths are allowed as post-login destinations, so a crafted
 * `next` parameter can't send the user to another site.
 *
 * The value is read the way a browser reads it (the URL parser), not by its
 * first characters alone: it is kept only when it starts with one "/" (not
 * two), holds no control character or backslash, and resolves to the same
 * origin it was resolved against.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/",
): string {
  if (
    !next ||
    !next.startsWith("/") ||
    SCHEME_RELATIVE.test(next) ||
    UNSAFE.test(next)
  )
    return fallback;
  try {
    if (new URL(next, BASE).origin !== BASE) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
