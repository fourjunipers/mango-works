import { describe, expect, it } from "vitest";
import { safeMapsUrl } from "../maps-url";
import { KEPT_MAPS_URLS, REFUSED_MAPS_URLS } from "../maps-url.cases";
import { shopProfileSchema } from "./vendor";

const parse = (maps_url: string) =>
  shopProfileSchema.safeParse({ name: "BSR Bike Shop", maps_url });

// The same rows run against the database's trigger in
// tests/db/security-audit.test.ts.
describe("a shop's Google Maps link", () => {
  it.each(KEPT_MAPS_URLS)("keeps %s", (url) => {
    expect(safeMapsUrl(url)).toBe(url);
    expect(parse(url).success).toBe(true);
  });

  it.each(REFUSED_MAPS_URLS)("refuses %s", (url) => {
    expect(safeMapsUrl(url)).toBeNull();
    // The form never saves it as typed. (Its address check first drops
    // white space around the value and tabs inside it; what is left is
    // either refused or a link the rule keeps.)
    const form = parse(url);
    const saved = form.success ? form.data.maps_url : undefined;
    if (saved !== undefined) {
      expect(saved).not.toBe(url);
      expect(safeMapsUrl(saved)).toBe(saved);
    }
  });

  it("refuses nothing, and a link longer than 500 characters", () => {
    expect(safeMapsUrl(null)).toBeNull();
    expect(safeMapsUrl(undefined)).toBeNull();
    expect(safeMapsUrl("")).toBeNull();
    const long = "https://www.google.com/maps/place/" + "a".repeat(467);
    expect(long.length).toBe(501);
    expect(safeMapsUrl(long)).toBeNull();
    expect(safeMapsUrl(long.slice(0, 500))).toBe(long.slice(0, 500));
  });
});
