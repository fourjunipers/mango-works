import "server-only";
import {
  callerKey,
  createPlaces,
  createRateLimit,
  PLACES_ERROR_STATUS,
  PlacesError,
} from "./places";

/** One Places client and cache per server instance. */
export const places = createPlaces({
  apiKey: process.env.GOOGLE_PLACES_SERVER_KEY,
});

/** Place search shows only when the server key is set. */
export const placeSearchEnabled = () => !!process.env.GOOGLE_PLACES_SERVER_KEY;

const limited = createRateLimit(60);

/**
 * One budget per caller for every route that spends Google Places money
 * (place search, a place's location, a shop's Google reviews). In memory,
 * so per server instance: see createRateLimit.
 */
export function overLimit(request: Request) {
  return !limited(callerKey(request.headers));
}

/** JSON error the search form reads: `{ error: "limit" | … }`. */
export function placesErrorResponse(e: unknown) {
  const kind = e instanceof PlacesError ? e.kind : "unavailable";
  return Response.json(
    { error: kind },
    {
      status: PLACES_ERROR_STATUS[kind],
      headers: { "Cache-Control": "no-store" },
    },
  );
}

/** Too many requests from one caller: the form falls back as for a quota. */
export const rateLimited = () => placesErrorResponse(new PlacesError("limit"));
