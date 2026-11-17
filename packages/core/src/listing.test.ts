import { describe, expect, it } from "vitest";
import {
  earliestPickup,
  hasEnoughNotice,
  listingCap,
  listingOffer,
  listingOfferFromPeaks,
  noticeHours,
  type ListingBooking,
  type ListingSettings,
} from "./listing";

// Instants in UTC: nothing here depends on a time zone.
const at = (day: number, hour = 10) =>
  new Date(Date.UTC(2026, 10, day, hour, 0, 0));
const booking = (
  from: number,
  to: number,
  kind: ListingBooking["kind"] = "instant",
): ListingBooking => ({ start: at(from), end: at(to), kind });
const listing = (over: Partial<ListingSettings> = {}): ListingSettings => ({
  enabled: true,
  instantUnits: 2,
  requestUnits: 1,
  ...over,
});
const offer = (
  settings: ListingSettings,
  available: number,
  bookings: ListingBooking[],
  from = 10,
  to = 13,
) =>
  listingOffer({ settings, available, bookings, start: at(from), end: at(to) });

describe("lead time: the stricter of shop notice and listing lead time", () => {
  it("takes the listing's when it is longer", () => {
    expect(noticeHours(12, 24)).toBe(24);
  });

  it("takes the shop's when it is longer", () => {
    expect(noticeHours(48, 24)).toBe(48);
  });

  it("uses the shop's notice for a listing with no lead time of its own", () => {
    expect(noticeHours(24, null)).toBe(24);
  });

  it("uses the listing's when the shop has no notice (Stage C: none stored yet)", () => {
    expect(noticeHours(null, 6)).toBe(6);
    expect(noticeHours(undefined, 6)).toBe(6);
  });

  it("is zero with neither, and zero is a real answer", () => {
    expect(noticeHours(null, null)).toBe(0);
    expect(noticeHours(0, 0)).toBe(0);
    expect(noticeHours(0, 3)).toBe(3);
  });

  it("refuses a negative number of hours", () => {
    expect(() => noticeHours(-1, 2)).toThrow(RangeError);
    expect(() => noticeHours(2, Number.NaN)).toThrow(RangeError);
  });

  it("is plain hours from now, with no time zone", () => {
    const now = new Date("2026-03-28T22:30:00Z");
    // 24 hours later by the clock that counts hours, whatever a wall clock
    // does that night (Europe changes its clocks on 29 Mar 2026).
    expect(earliestPickup(now, 12, 24).toISOString()).toBe(
      "2026-03-29T22:30:00.000Z",
    );
  });

  it("allows a pickup exactly at the notice and refuses one a minute before", () => {
    const now = at(1, 9);
    expect(hasEnoughNotice(now, at(2, 9), 24, null)).toBe(true);
    expect(
      hasEnoughNotice(now, new Date(at(2, 9).getTime() - 60_000), 24, null),
    ).toBe(false);
    // The shop's 24 hours pass, the listing's 48 don't: too soon.
    expect(hasEnoughNotice(now, at(2, 9), 24, 48)).toBe(false);
    expect(hasEnoughNotice(now, at(3, 9), 24, 48)).toBe(true);
  });
});

describe("units to offer: the cap counts Moto Mangos bookings only", () => {
  it("the cap is instant plus request units", () => {
    expect(listingCap(listing({ instantUnits: 2, requestUnits: 1 }))).toBe(3);
  });

  it("offer 3 of my 8: three free of the cap while the shop has plenty", () => {
    expect(offer(listing(), 8, [])).toEqual({
      offered: 3,
      mode: "instant",
      held: 0,
    });
  });

  it("each Moto Mangos booking in the window uses one of the cap", () => {
    expect(offer(listing(), 7, [booking(9, 12)]).offered).toBe(2);
    expect(
      offer(listing(), 5, [booking(9, 12), booking(11, 14), booking(12, 15)])
        .offered,
    ).toBe(1);
  });

  it("offers nothing once the cap is out through Moto Mangos, whatever the shop has free", () => {
    const three = [booking(9, 14), booking(9, 14), booking(9, 14, "request")];
    expect(offer(listing(), 5, three)).toEqual({
      offered: 0,
      mode: null,
      held: 3,
    });
  });

  it("offers fewer when the shop itself is nearly full", () => {
    // A walk-in or direct booking is not in `bookings`: it only lowers
    // what is available.
    expect(offer(listing(), 1, []).offered).toBe(1);
    expect(offer(listing(), 0, [])).toEqual({
      offered: 0,
      mode: null,
      held: 0,
    });
  });

  it("a Ride today booking does not count against the cap", () => {
    const o = offer(listing(), 6, [
      booking(9, 14, "now"),
      booking(9, 14, "now"),
    ]);
    expect(o).toEqual({ offered: 3, mode: "instant", held: 0 });
  });

  it("counts the busiest moment, not every booking that touches the window", () => {
    // Two bookings one after the other hold one vehicle between them.
    expect(offer(listing(), 8, [booking(9, 11), booking(11, 14)]).held).toBe(1);
    // A booking that ends as the window starts, or starts as it ends, is outside.
    expect(offer(listing(), 8, [booking(8, 10), booking(13, 15)]).held).toBe(0);
  });

  it("a listing switched off offers nothing", () => {
    expect(offer(listing({ enabled: false }), 8, [])).toEqual({
      offered: 0,
      mode: null,
      held: 0,
    });
  });

  it("refuses a window that ends before it starts", () => {
    expect(() => offer(listing(), 8, [], 13, 10)).toThrow(RangeError);
  });
});

describe("Instant or Request (docs/INTEGRATION.md §4.4)", () => {
  it("Instant while Instant bookings are fewer than the Instant units", () => {
    expect(offer(listing(), 8, [booking(9, 12, "instant")]).mode).toBe(
      "instant",
    );
  });

  it("else Request while Request bookings are fewer than the Request units", () => {
    const full = [booking(9, 12, "instant"), booking(9, 12, "instant")];
    expect(offer(listing(), 8, full).mode).toBe("request");
  });

  it("else not bookable in advance", () => {
    const full = [
      booking(9, 12, "instant"),
      booking(9, 12, "instant"),
      booking(9, 12, "request"),
    ];
    expect(offer(listing(), 8, full).mode).toBeNull();
  });

  it("a Request booking leaves the Instant units Instant", () => {
    expect(offer(listing(), 8, [booking(9, 12, "request")]).mode).toBe(
      "instant",
    );
  });

  it("all by request: no Instant units", () => {
    const s = listing({ instantUnits: 0, requestUnits: 2 });
    expect(offer(s, 8, []).mode).toBe("request");
    expect(offer(s, 8, [booking(9, 12, "request")]).mode).toBe("request");
    expect(
      offer(s, 8, [booking(9, 12, "request"), booking(9, 12, "request")]).mode,
    ).toBeNull();
  });

  it("no mode without a free vehicle, even with Instant units left", () => {
    expect(offer(listing(), 0, []).mode).toBeNull();
  });

  it("walk-ins only: no Instant or Request units means nothing in advance", () => {
    const s = listing({ instantUnits: 0, requestUnits: 0 });
    expect(offer(s, 8, [])).toEqual({ offered: 0, mode: null, held: 0 });
  });

  it("bookings outside the window don't use up a mode", () => {
    const earlier = [booking(1, 3, "instant"), booking(1, 3, "instant")];
    expect(offer(listing(), 8, earlier).mode).toBe("instant");
  });
});

describe("the offer from counts already taken (the database's availability read)", () => {
  const peaks = (held: number, instant: number, request: number) => ({
    held,
    instant,
    request,
  });

  it("is the same answer listingOffer gives from the bookings themselves", () => {
    const cases: ListingBooking[][] = [
      [],
      [booking(9, 12)],
      [booking(9, 12), booking(11, 14)],
      [booking(9, 12), booking(11, 14), booking(9, 12, "request")],
      [booking(9, 12, "now"), booking(9, 12, "now"), booking(9, 12, "now")],
    ];
    const counted = [
      peaks(0, 0, 0),
      peaks(1, 1, 0),
      peaks(2, 2, 0),
      peaks(3, 2, 1),
      peaks(0, 0, 0),
    ];
    cases.forEach((bookings, i) => {
      for (const available of [0, 1, 8]) {
        expect(
          listingOfferFromPeaks({
            settings: listing(),
            available,
            peaks: counted[i],
          }),
          `case ${i}, ${available} free`,
        ).toEqual(offer(listing(), available, bookings));
      }
    });
  });

  it("several vehicles in one booking must all fit the mode", () => {
    const two = (p: ReturnType<typeof peaks>, settings = listing()) =>
      listingOfferFromPeaks({ settings, available: 8, peaks: p, quantity: 2 });
    expect(two(peaks(0, 0, 0)).mode).toBe("instant");
    // One Instant unit left and one Request unit: two fit neither.
    expect(two(peaks(1, 1, 0)).mode).toBeNull();
    expect(
      two(peaks(1, 1, 0), listing({ instantUnits: 1, requestUnits: 2 })).mode,
    ).toBe("request");
    // Two wanted, one offered.
    expect(two(peaks(2, 2, 0))).toEqual({ offered: 1, mode: null, held: 2 });
  });

  it("a listing that is off offers nothing; a quantity below one is refused", () => {
    expect(
      listingOfferFromPeaks({
        settings: listing({ enabled: false }),
        available: 8,
        peaks: peaks(0, 0, 0),
      }),
    ).toEqual({ offered: 0, mode: null, held: 0 });
    expect(() =>
      listingOfferFromPeaks({
        settings: listing(),
        available: 8,
        peaks: peaks(0, 0, 0),
        quantity: 0,
      }),
    ).toThrow(RangeError);
  });
});
