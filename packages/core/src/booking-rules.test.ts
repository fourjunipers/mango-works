import { describe, expect, it } from "vitest";
import {
  bookable,
  cutoffInstant,
  isOpenAt,
  minDaysFor,
  noticeFor,
  offer,
  rulesFor,
  type BookingHow,
  type BookingRules,
  type LineAvailability,
  type LocationRules,
  type OfferInputs,
  type OfferRequest,
  type ProductRules,
} from "./booking-rules";
import type { Pricing } from "./rental-price";
import type { QuoteInput } from "./quote";

const NEW_YORK = "America/New_York";
const BANGKOK = "Asia/Bangkok";

/** An instant, written in UTC so no test leans on the code under test. */
const utc = (iso: string) => new Date(`${iso}:00Z`);
const HOUR = 3_600_000;
const plus = (instant: Date, hours: number) =>
  new Date(instant.getTime() + hours * HOUR);

const everyDay = (open = "09:00", close = "18:00") =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open, close }));

const rules = (over: Partial<BookingRules> = {}): BookingRules => ({
  timeZone: NEW_YORK,
  hours: everyDay(),
  closures: [],
  minNoticeHours: null,
  leadTimeHours: null,
  bookingCutoffMinutes: null,
  minDaysAdvance: null,
  minDaysWalkin: null,
  ...over,
});

const bookingPage: BookingHow = { channel: "booking_page", mode: "instant" };
const api: BookingHow = { channel: "api", mode: "instant" };
const motoMangos: BookingHow = { channel: "marketplace", mode: "instant" };
const motoMangosRequest: BookingHow = {
  channel: "marketplace",
  mode: "request",
};
const rideToday: BookingHow = { channel: "marketplace", mode: "now" };
const counter: BookingHow = { channel: "walk_in", mode: "staff" };
const phone: BookingHow = { channel: "phone", mode: "staff" };

// A plain week in June 2026, New York on daylight time (UTC-4).
// Monday 15 June 2026, 10:00 at the shop = 14:00 UTC.
const monday10 = utc("2026-06-15T14:00");
const wednesday10 = utc("2026-06-17T14:00");
const longAgo = utc("2026-01-05T15:00");

const reason = (answer: ReturnType<typeof bookable>) =>
  answer.ok ? "ok" : answer.reason;

describe("bookable(): every reason", () => {
  it("ok: inside the hours, on no closure, long enough, with enough notice", () => {
    expect(
      bookable(
        rules({ minNoticeHours: 24, minDaysAdvance: 2 }),
        monday10,
        wednesday10,
        bookingPage,
        plus(monday10, -24),
      ),
    ).toEqual({ ok: true });
  });

  it("outside_hours: the pickup before opening or after closing; both ends of the day count as open", () => {
    const at = (iso: string) =>
      bookable(rules(), utc(iso), wednesday10, bookingPage, longAgo);
    // 09:00 and 18:00 at the shop (13:00 and 22:00 UTC) are open.
    expect(at("2026-06-15T13:00")).toEqual({ ok: true });
    expect(at("2026-06-15T22:00")).toEqual({ ok: true });
    expect(at("2026-06-15T12:59")).toEqual({
      ok: false,
      reason: "outside_hours",
      at: "pickup",
    });
    expect(at("2026-06-15T22:01")).toEqual({
      ok: false,
      reason: "outside_hours",
      at: "pickup",
    });
  });

  it("outside_hours: the return outside the hours", () => {
    expect(
      bookable(
        rules(),
        monday10,
        utc("2026-06-17T22:01"),
        bookingPage,
        longAgo,
      ),
    ).toEqual({ ok: false, reason: "outside_hours", at: "return" });
    expect(
      bookable(
        rules(),
        monday10,
        utc("2026-06-17T22:00"),
        bookingPage,
        longAgo,
      ),
    ).toEqual({ ok: true });
  });

  it("outside_hours: a weekday the location left out of its hours is closed", () => {
    const closedSundays = rules({
      hours: everyDay().filter((h) => h.weekday !== 0),
    });
    // Sunday 14 June 2026, 10:00 at the shop.
    const sunday10 = utc("2026-06-14T14:00");
    expect(
      reason(
        bookable(closedSundays, sunday10, wednesday10, bookingPage, longAgo),
      ),
    ).toBe("outside_hours");
    expect(
      bookable(
        closedSundays,
        monday10,
        utc("2026-06-21T14:00"),
        bookingPage,
        longAgo,
      ),
    ).toEqual({ ok: false, reason: "outside_hours", at: "return" });
  });

  it("for staff, a location that has saved no hours has no hours rule, but its closures still count", () => {
    const noHours = rules({ hours: [] });
    const threeAm = utc("2026-06-15T07:00");
    for (const how of [counter, phone]) {
      expect(bookable(noHours, threeAm, wednesday10, how, longAgo)).toEqual({
        ok: true,
      });
    }
    const closed = rules({
      hours: [],
      closures: [
        {
          start_date: "2026-06-15",
          end_date: "2026-06-15",
          repeats_yearly: false,
        },
      ],
    });
    expect(bookable(closed, threeAm, wednesday10, counter, longAgo)).toEqual({
      ok: false,
      reason: "outside_hours",
      at: "pickup",
    });
  });

  it("online, a location that has saved no hours can't be booked at all: outside_hours, on every online channel and at any time of day", () => {
    const noHours = rules({ hours: [] });
    for (const how of [bookingPage, api, motoMangos, motoMangosRequest]) {
      for (const pickup of [monday10, utc("2026-06-15T07:00")]) {
        expect(
          bookable(noHours, pickup, wednesday10, how, longAgo),
          how.channel,
        ).toEqual({ ok: false, reason: "outside_hours", at: "no_hours" });
      }
    }
    expect(
      bookable(noHours, monday10, wednesday10, rideToday, monday10),
    ).toEqual({ ok: false, reason: "outside_hours", at: "no_hours" });
    // It comes before every other rule.
    const strict = rules({
      hours: [],
      minNoticeHours: 720,
      minDaysAdvance: 30,
    });
    expect(
      reason(bookable(strict, monday10, wednesday10, bookingPage, monday10)),
    ).toBe("outside_hours");
    // One weekday saved is hours saved: the other days are closed, not unknown.
    const mondays = rules({
      hours: [{ weekday: 1, open: "09:00", close: "18:00" }],
    });
    expect(
      bookable(
        mondays,
        monday10,
        utc("2026-06-22T14:00"),
        bookingPage,
        longAgo,
      ),
    ).toEqual({ ok: true });
    expect(
      bookable(mondays, monday10, wednesday10, bookingPage, longAgo),
    ).toEqual({ ok: false, reason: "outside_hours", at: "return" });
  });

  it("outside_hours: a closure on the pickup date or on the return date", () => {
    const closed = (date: string) =>
      rules({
        closures: [{ start_date: date, end_date: date, repeats_yearly: false }],
      });
    expect(
      bookable(
        closed("2026-06-15"),
        monday10,
        wednesday10,
        bookingPage,
        longAgo,
      ),
    ).toEqual({ ok: false, reason: "outside_hours", at: "pickup" });
    expect(
      bookable(
        closed("2026-06-17"),
        monday10,
        wednesday10,
        bookingPage,
        longAgo,
      ),
    ).toEqual({ ok: false, reason: "outside_hours", at: "return" });
    // A closure between the two is no obstacle: the shop is shut, the bike is out.
    expect(
      bookable(
        closed("2026-06-16"),
        monday10,
        wednesday10,
        bookingPage,
        longAgo,
      ),
    ).toEqual({ ok: true });
  });

  it("a closure that repeats every year, over New Year, in the location's dates", () => {
    const newYear = rules({
      hours: [],
      closures: [
        {
          start_date: "2025-12-30",
          end_date: "2026-01-02",
          repeats_yearly: true,
        },
      ],
    });
    // New York is UTC-5 in winter: midnight there is 05:00 UTC.
    const open = (iso: string) => isOpenAt(newYear, utc(iso));
    expect(open("2027-12-30T04:59")).toBe(true); // 29 Dec, 23:59
    expect(open("2027-12-30T05:00")).toBe(false); // 30 Dec, 00:00
    expect(open("2028-01-01T17:00")).toBe(false); // 1 Jan, the next year's part
    expect(open("2028-01-03T04:59")).toBe(false); // 2 Jan, 23:59
    expect(open("2028-01-03T05:00")).toBe(true); // 3 Jan, 00:00
    expect(open("2029-12-31T17:00")).toBe(false);
    // Before its first year it is not a closure yet.
    expect(open("2024-12-31T17:00")).toBe(true);
  });

  it("too_short: fewer rental days than the minimum; every started 24 hours is a day", () => {
    const three = rules({ minDaysAdvance: 3 });
    expect(
      bookable(three, monday10, wednesday10, bookingPage, longAgo),
    ).toEqual({
      ok: false,
      reason: "too_short",
      days: 2,
      minDays: 3,
    });
    // Two days and one minute is three days.
    expect(
      bookable(three, monday10, utc("2026-06-17T14:01"), bookingPage, longAgo),
    ).toEqual({ ok: true });
    expect(
      bookable(three, monday10, utc("2026-06-18T14:00"), bookingPage, longAgo),
    ).toEqual({ ok: true });
  });

  it("too_soon: the pickup is sooner than the notice after now, to the minute", () => {
    const day = rules({ minNoticeHours: 24 });
    const now = plus(monday10, -24);
    expect(bookable(day, monday10, wednesday10, bookingPage, now)).toEqual({
      ok: true,
    });
    const oneMinuteLate = new Date(now.getTime() + 60_000);
    expect(
      bookable(day, monday10, wednesday10, bookingPage, oneMinuteLate),
    ).toEqual({
      ok: false,
      reason: "too_soon",
      earliestPickup: new Date(monday10.getTime() + 60_000),
    });
  });

  it("the first rule that refuses is the answer: hours, then minimum days, then notice", () => {
    const strict = rules({ minNoticeHours: 48, minDaysAdvance: 5 });
    const now = plus(monday10, -1);
    const sixAm = utc("2026-06-15T10:00");
    expect(reason(bookable(strict, sixAm, wednesday10, bookingPage, now))).toBe(
      "outside_hours",
    );
    expect(
      reason(bookable(strict, monday10, wednesday10, bookingPage, now)),
    ).toBe("too_short");
    expect(
      reason(
        bookable(strict, monday10, utc("2026-06-22T14:00"), bookingPage, now),
      ),
    ).toBe("too_soon");
  });

  it("a return that is not after the pickup is an error, not an answer", () => {
    expect(() =>
      bookable(rules(), monday10, monday10, bookingPage, longAgo),
    ).toThrow(RangeError);
    expect(() =>
      bookable(rules(), wednesday10, monday10, bookingPage, longAgo),
    ).toThrow(RangeError);
  });
});

describe("notice, channel by channel", () => {
  const now = plus(monday10, -20);
  const check = (r: BookingRules, how: BookingHow) =>
    reason(bookable(r, monday10, wednesday10, how, now));

  it("Moto Mangos, advance: the stricter of the shop's notice and the listing's lead time, either way round", () => {
    // The pickup is 20 hours away.
    const shopStricter = rules({ minNoticeHours: 24, leadTimeHours: 12 });
    const listingStricter = rules({ minNoticeHours: 12, leadTimeHours: 24 });
    const bothFit = rules({ minNoticeHours: 12, leadTimeHours: 20 });
    expect(noticeFor(shopStricter, motoMangos)).toBe(24);
    expect(noticeFor(listingStricter, motoMangos)).toBe(24);
    expect(check(shopStricter, motoMangos)).toBe("too_soon");
    expect(check(listingStricter, motoMangos)).toBe("too_soon");
    expect(check(bothFit, motoMangos)).toBe("ok");
    // A booking that would wait for the shop's OK is an advance booking too.
    expect(check(shopStricter, motoMangosRequest)).toBe("too_soon");
    // Only one of them set.
    expect(noticeFor(rules({ leadTimeHours: 6 }), motoMangos)).toBe(6);
    expect(noticeFor(rules({ minNoticeHours: 6 }), motoMangos)).toBe(6);
    expect(noticeFor(rules(), motoMangos)).toBe(0);
  });

  it('Moto Mangos, "Ride today": none', () => {
    const strict = rules({ minNoticeHours: 24, leadTimeHours: 48 });
    expect(noticeFor(strict, rideToday)).toBeNull();
    // Booked at the counter's opening hour, riding away at once.
    expect(
      bookable(strict, monday10, wednesday10, rideToday, monday10),
    ).toEqual({
      ok: true,
    });
  });

  it("the shop's own booking page: the shop's notice only; the listing's lead time is Moto Mangos' business", () => {
    const listingStricter = rules({ minNoticeHours: 12, leadTimeHours: 48 });
    expect(noticeFor(listingStricter, bookingPage)).toBe(12);
    expect(check(listingStricter, bookingPage)).toBe("ok");
    expect(check(listingStricter, motoMangos)).toBe("too_soon");
    expect(check(rules({ minNoticeHours: 24 }), bookingPage)).toBe("too_soon");
    // The API is the shop's own channel too.
    expect(noticeFor(listingStricter, api)).toBe(12);
    expect(check(rules({ minNoticeHours: 24 }), api)).toBe("too_soon");
    expect(check(rules({ leadTimeHours: 48 }), api)).toBe("ok");
  });

  it("staff, at the counter or on the phone: none, even for a pickup that has begun", () => {
    const strict = rules({ minNoticeHours: 72, leadTimeHours: 72 });
    expect(noticeFor(strict, counter)).toBeNull();
    expect(noticeFor(strict, phone)).toBeNull();
    expect(check(strict, counter)).toBe("ok");
    expect(check(strict, phone)).toBe("ok");
    const afterPickup = plus(monday10, 1);
    expect(
      bookable(strict, monday10, wednesday10, counter, afterPickup),
    ).toEqual({
      ok: true,
    });
  });

  it("an online advance booking can't start in the past, with no notice set at all", () => {
    const afterPickup = plus(monday10, 1);
    for (const how of [bookingPage, api, motoMangos]) {
      expect(
        reason(bookable(rules(), monday10, wednesday10, how, afterPickup)),
      ).toBe("too_soon");
    }
  });
});

/**
 * "Ride today" skips the notice and the Moto Mangos cap. So it must be what
 * it says: a Moto Mangos booking for a pickup that is now. Five probes after
 * the review of PR 38; each was answered "ok" before.
 */
describe("Ride today is for Moto Mangos alone, and for a pickup that is now", () => {
  const strict = rules({ minNoticeHours: 48, leadTimeHours: 72 });
  const nextMonday10 = utc("2026-06-22T14:00");
  const nextWednesday10 = utc("2026-06-24T14:00");
  const minutes = (instant: Date, n: number) =>
    new Date(instant.getTime() + n * 60_000);

  it("probe 1: the shop's own booking page can't call a booking Ride today to skip its notice", () => {
    expect(() =>
      bookable(
        strict,
        monday10,
        wednesday10,
        { channel: "booking_page", mode: "now" },
        plus(monday10, -1),
      ),
    ).toThrow(RangeError);
    // As itself it is bound by the notice.
    expect(
      reason(
        bookable(
          strict,
          monday10,
          wednesday10,
          bookingPage,
          plus(monday10, -1),
        ),
      ),
    ).toBe("too_soon");
  });

  it("probe 2: nor can the API, nor a staff channel; and no online channel books in mode staff", () => {
    for (const how of [
      { channel: "api", mode: "now" },
      { channel: "walk_in", mode: "now" },
      { channel: "phone", mode: "now" },
      { channel: "walk_in", mode: "instant" },
      { channel: "phone", mode: "request" },
      { channel: "booking_page", mode: "staff" },
      { channel: "marketplace", mode: "staff" },
      { channel: "api", mode: "staff" },
    ] as BookingHow[]) {
      expect(
        () => bookable(strict, monday10, wednesday10, how, monday10),
        how.channel + " " + how.mode,
      ).toThrow(RangeError);
    }
  });

  it("probe 3: Moto Mangos Ride today for a pickup next week is not_now, where it used to skip 72 hours of lead time", () => {
    // Made at the shop on Monday at 10:00, for the Monday after.
    expect(
      bookable(strict, nextMonday10, nextWednesday10, rideToday, monday10),
    ).toEqual({
      ok: false,
      reason: "not_now",
      earliest: minutes(monday10, -15),
      latest: minutes(monday10, 15),
    });
    // The same booking as what it is, an advance booking, is fine.
    expect(
      bookable(strict, nextMonday10, nextWednesday10, motoMangos, monday10),
    ).toEqual({ ok: true });
    // And an advance booking for an hour from now is too soon.
    expect(
      reason(
        bookable(strict, plus(monday10, 1), wednesday10, motoMangos, monday10),
      ),
    ).toBe("too_soon");
  });

  it("probe 4: nor for later today, nor for a pickup that has long begun: 15 minutes either side of now, to the minute", () => {
    const ride = (pickup: Date) =>
      reason(bookable(strict, pickup, wednesday10, rideToday, monday10));
    expect(ride(plus(monday10, 4))).toBe("not_now");
    expect(ride(minutes(monday10, 16))).toBe("not_now");
    expect(ride(minutes(monday10, 15))).toBe("ok");
    expect(ride(monday10)).toBe("ok");
    expect(ride(minutes(monday10, -15))).toBe("ok");
    expect(ride(minutes(monday10, -16))).toBe("not_now");
    // 16 minutes before opening, the pickup a minute before: now is outside the hours.
    const early = utc("2026-06-15T12:44");
    expect(
      bookable(strict, utc("2026-06-15T12:59"), wednesday10, rideToday, early),
    ).toEqual({ ok: false, reason: "outside_hours", at: "now" });
  });

  it("probe 5: through offer(), with the cap full: a real walk-in is offered, a walk-in for next week is not, and the shop's page can't ask at all", () => {
    const full = listed({ held: 3, instant: 2, request: 1 });
    const ask = (how: BookingHow, start: Date, end: Date) =>
      offer(
        ...scene([{ id: "a", start, end }], {
          how,
          now: monday10,
          marketplace: [full],
        }),
      );
    expect(refusal(ask(rideToday, monday10, wednesday10))).toBe("ok");
    expect(refusal(ask(rideToday, nextMonday10, nextWednesday10))).toBe(
      "not_now @ a",
    );
    // As an advance booking it meets the cap.
    expect(refusal(ask(motoMangos, nextMonday10, nextWednesday10))).toBe(
      "cap_reached @ a",
    );
    expect(() =>
      ask({ channel: "booking_page", mode: "now" }, monday10, wednesday10),
    ).toThrow(RangeError);
  });
});

describe("minimum days, channel by channel", () => {
  const twoKinds = rules({ minDaysAdvance: 3, minDaysWalkin: 1 });

  it('the walk-in minimum for "Ride today" and for the counter; the advance minimum for everything else', () => {
    expect(minDaysFor(twoKinds, rideToday)).toBe(1);
    expect(minDaysFor(twoKinds, counter)).toBe(1);
    expect(minDaysFor(twoKinds, phone)).toBe(3);
    expect(minDaysFor(twoKinds, bookingPage)).toBe(3);
    expect(minDaysFor(twoKinds, api)).toBe(3);
    expect(minDaysFor(twoKinds, motoMangos)).toBe(3);
    expect(minDaysFor(twoKinds, motoMangosRequest)).toBe(3);
    // Two days: enough for a walk-in, too short in advance.
    const answer = (how: BookingHow) =>
      reason(
        bookable(twoKinds, monday10, wednesday10, how, plus(monday10, -1)),
      );
    expect(
      reason(bookable(twoKinds, monday10, wednesday10, rideToday, monday10)),
    ).toBe("ok");
    expect(answer(counter)).toBe("ok");
    expect(answer(phone)).toBe("too_short");
    expect(answer(bookingPage)).toBe("too_short");
    expect(answer(motoMangos)).toBe("too_short");
  });

  it("a product's own minimum wins; an empty one is the location's", () => {
    const location: LocationRules = {
      timeZone: NEW_YORK,
      hours: everyDay(),
      closures: [],
      minNoticeHours: 6,
      bookingCutoffMinutes: 30,
      minDaysAdvance: 2,
      minDaysWalkin: 1,
    };
    const product = (over: Partial<ProductRules>): ProductRules => ({
      productId: "p",
      type: "vehicle",
      minDaysAdvance: null,
      minDaysWalkin: null,
      listing: null,
      ...over,
    });
    expect(rulesFor(location, product({}))).toMatchObject({
      minDaysAdvance: 2,
      minDaysWalkin: 1,
      minNoticeHours: 6,
      leadTimeHours: null,
      bookingCutoffMinutes: 30,
    });
    expect(
      rulesFor(
        location,
        product({
          minDaysAdvance: 7,
          listing: {
            enabled: true,
            instantUnits: 1,
            requestUnits: 0,
            leadTimeHours: 12,
          },
        }),
      ),
    ).toMatchObject({ minDaysAdvance: 7, minDaysWalkin: 1, leadTimeHours: 12 });
  });
});

/**
 * New York, 2026. The clocks go forward on Sunday 8 March (02:00 EST becomes
 * 03:00 EDT: a 23-hour day) and back on Sunday 1 November (02:00 EDT becomes
 * 01:00 EST: a 25-hour day). EST is UTC-5, EDT is UTC-4.
 */
describe("New York, across both clock changes: no fixed offset", () => {
  it("opening hours: the same UTC time is inside the hours one day and outside them the next", () => {
    const shop = rules();
    // 13:30 UTC: 08:30 on Saturday 7 March (EST), 09:30 on Sunday 8 March (EDT).
    expect(isOpenAt(shop, utc("2026-03-07T13:30"))).toBe(false);
    expect(isOpenAt(shop, utc("2026-03-08T13:30"))).toBe(true);
    // 13:30 UTC: 09:30 on Saturday 31 October (EDT), 08:30 on Sunday 1 November (EST).
    expect(isOpenAt(shop, utc("2026-10-31T13:30"))).toBe(true);
    expect(isOpenAt(shop, utc("2026-11-01T13:30"))).toBe(false);
    // Closing time, 18:00, on each change day: 22:00 UTC in March, 23:00 in November.
    expect(isOpenAt(shop, utc("2026-03-08T22:00"))).toBe(true);
    expect(isOpenAt(shop, utc("2026-03-08T22:01"))).toBe(false);
    expect(isOpenAt(shop, utc("2026-11-01T23:00"))).toBe(true);
    expect(isOpenAt(shop, utc("2026-11-01T23:01"))).toBe(false);
  });

  it("opening hours through the night of the change: the hour that is skipped, and the hour that happens twice", () => {
    const nights = rules({ hours: everyDay("00:00", "04:00") });
    // March: 01:59 EST is 06:59 UTC; one minute later it is 03:00 EDT.
    expect(isOpenAt(nights, utc("2026-03-08T06:59"))).toBe(true);
    expect(isOpenAt(nights, utc("2026-03-08T07:00"))).toBe(true); // 03:00
    expect(isOpenAt(nights, utc("2026-03-08T08:00"))).toBe(true); // 04:00
    expect(isOpenAt(nights, utc("2026-03-08T08:01"))).toBe(false); // 04:01
    // November: 01:30 happens at 05:30 UTC (EDT) and again at 06:30 UTC (EST).
    expect(isOpenAt(nights, utc("2026-11-01T05:30"))).toBe(true);
    expect(isOpenAt(nights, utc("2026-11-01T06:30"))).toBe(true);
    expect(isOpenAt(nights, utc("2026-11-01T09:00"))).toBe(true); // 04:00 EST
    expect(isOpenAt(nights, utc("2026-11-01T09:01"))).toBe(false);
    // With a fixed -4 the shop would have shut an hour early that night.
    expect(isOpenAt(nights, utc("2026-11-01T08:30"))).toBe(true); // 03:30 EST
  });

  it("closures: a closed date is 23 hours long in March and 25 in November, midnight to midnight on the shop's clock", () => {
    const closedOn = (date: string) =>
      rules({
        hours: [],
        closures: [{ start_date: date, end_date: date, repeats_yearly: false }],
      });
    const march = closedOn("2026-03-08");
    expect(isOpenAt(march, utc("2026-03-08T04:59"))).toBe(true); // 7 Mar 23:59 EST
    expect(isOpenAt(march, utc("2026-03-08T05:00"))).toBe(false); // 8 Mar 00:00 EST
    expect(isOpenAt(march, utc("2026-03-09T03:59"))).toBe(false); // 8 Mar 23:59 EDT
    expect(isOpenAt(march, utc("2026-03-09T04:00"))).toBe(true); // 9 Mar 00:00 EDT
    const november = closedOn("2026-11-01");
    expect(isOpenAt(november, utc("2026-11-01T03:59"))).toBe(true); // 31 Oct 23:59 EDT
    expect(isOpenAt(november, utc("2026-11-01T04:00"))).toBe(false); // 1 Nov 00:00 EDT
    expect(isOpenAt(november, utc("2026-11-02T04:59"))).toBe(false); // 1 Nov 23:59 EST
    expect(isOpenAt(november, utc("2026-11-02T05:00"))).toBe(true); // 2 Nov 00:00 EST
    // A booking whose pickup falls in that last hour of the long day is refused.
    expect(
      bookable(
        november,
        utc("2026-11-02T04:30"),
        utc("2026-11-04T15:00"),
        counter,
        longAgo,
      ),
    ).toEqual({ ok: false, reason: "outside_hours", at: "pickup" });
  });

  it('the cut-off for "Ride today": two hours before an 18:00 closing is 16:00 on the shop\'s clock, on both change days', () => {
    const shop = rules({ bookingCutoffMinutes: 120 });
    const ride = (nowIso: string, backIso: string) => {
      const now = utc(nowIso);
      return bookable(shop, now, utc(backIso), rideToday, now);
    };
    // March: 16:00 EDT is 20:00 UTC.
    expect(cutoffInstant(shop, utc("2026-03-08T15:00"))).toEqual(
      utc("2026-03-08T20:00"),
    );
    expect(ride("2026-03-08T20:00", "2026-03-10T20:00")).toEqual({ ok: true });
    expect(ride("2026-03-08T20:01", "2026-03-10T20:00")).toEqual({
      ok: false,
      reason: "outside_hours",
      at: "cutoff",
    });
    // November: 16:00 EST is 21:00 UTC.
    expect(cutoffInstant(shop, utc("2026-11-01T15:00"))).toEqual(
      utc("2026-11-01T21:00"),
    );
    expect(ride("2026-11-01T21:00", "2026-11-03T21:00")).toEqual({ ok: true });
    expect(ride("2026-11-01T21:01", "2026-11-03T21:00")).toEqual({
      ok: false,
      reason: "outside_hours",
      at: "cutoff",
    });
    // Before opening, or after closing, there is no riding away today.
    expect(ride("2026-11-01T13:59", "2026-11-03T21:00")).toEqual({
      ok: false,
      reason: "outside_hours",
      at: "now",
    });
  });

  it("the cut-off is real minutes before closing, through the night of the change", () => {
    const nights = rules({
      hours: everyDay("00:00", "03:00"),
      bookingCutoffMinutes: 90,
    });
    // November: closing at 03:00 EST is 08:00 UTC; 90 real minutes earlier is
    // 06:30 UTC, the second 01:30. At the first 01:45 (05:45 UTC) the clock
    // reads later than 01:30, yet closing is still two and a quarter hours away.
    expect(cutoffInstant(nights, utc("2026-11-01T05:00"))).toEqual(
      utc("2026-11-01T06:30"),
    );
    const back = utc("2026-11-03T07:00"); // 02:00 EST on the 3rd
    const at = (iso: string) =>
      bookable(nights, utc(iso), back, rideToday, utc(iso));
    expect(at("2026-11-01T05:45")).toEqual({ ok: true });
    expect(at("2026-11-01T06:30")).toEqual({ ok: true });
    expect(at("2026-11-01T06:31")).toEqual({
      ok: false,
      reason: "outside_hours",
      at: "cutoff",
    });
    // March: closing at 03:00 EDT is 07:00 UTC, one minute after 01:59 EST.
    // 90 real minutes earlier is 05:30 UTC, which the shop's clock shows as
    // 00:30, not 01:30.
    expect(cutoffInstant(nights, utc("2026-03-08T05:10"))).toEqual(
      utc("2026-03-08T05:30"),
    );
    const marchBack = utc("2026-03-10T06:00"); // 02:00 EDT on the 10th
    const march = (iso: string) =>
      bookable(nights, utc(iso), marchBack, rideToday, utc(iso));
    expect(march("2026-03-08T05:30")).toEqual({ ok: true });
    expect(march("2026-03-08T05:31")).toEqual({
      ok: false,
      reason: "outside_hours",
      at: "cutoff",
    });
  });

  it("minimum days are days on the shop's clock: 10:00 to 10:00 is one day across either change", () => {
    const two = rules({ minDaysAdvance: 2 });
    const days = (fromIso: string, toIso: string) =>
      bookable(two, utc(fromIso), utc(toIso), bookingPage, longAgo);
    // March. Saturday 10:00 EST (15:00 UTC) to Sunday 10:00 EDT (14:00 UTC):
    // 23 hours gone by, one day.
    expect(days("2026-03-07T15:00", "2026-03-08T14:00")).toEqual({
      ok: false,
      reason: "too_short",
      days: 1,
      minDays: 2,
    });
    // To Sunday 10:30: 23 and a half hours gone by, but a second day has begun.
    expect(days("2026-03-07T15:00", "2026-03-08T14:30")).toEqual({ ok: true });
    // To Monday 10:00: 47 hours gone by, two days.
    expect(days("2026-03-07T15:00", "2026-03-09T14:00")).toEqual({ ok: true });
    // November. Saturday 10:00 EDT (14:00 UTC) to Sunday 10:00 EST (15:00
    // UTC): 25 hours gone by, still one day.
    expect(days("2026-10-31T14:00", "2026-11-01T15:00")).toEqual({
      ok: false,
      reason: "too_short",
      days: 1,
      minDays: 2,
    });
    // To Monday 10:00: 49 hours gone by, two days, not three.
    const three = rules({ minDaysAdvance: 3 });
    expect(
      bookable(
        three,
        utc("2026-10-31T14:00"),
        utc("2026-11-02T15:00"),
        bookingPage,
        longAgo,
      ),
    ).toEqual({ ok: false, reason: "too_short", days: 2, minDays: 3 });
  });

  it("notice is real hours: 24 hours' notice is not met by the same time on the clock after a 23-hour day", () => {
    const day = rules({ minNoticeHours: 24 });
    // Now: Saturday 7 March, 12:00 EST (17:00 UTC).
    const now = utc("2026-03-07T17:00");
    const back = utc("2026-03-10T16:00");
    // Sunday 12:00 EDT (16:00 UTC) is 23 hours away.
    expect(
      bookable(day, utc("2026-03-08T16:00"), back, bookingPage, now),
    ).toEqual({
      ok: false,
      reason: "too_soon",
      earliestPickup: utc("2026-03-08T17:00"),
    });
    expect(
      bookable(day, utc("2026-03-08T17:00"), back, bookingPage, now),
    ).toEqual({
      ok: true,
    });
    // November. Now: Saturday 31 October, 12:00 EDT (16:00 UTC). Sunday
    // 11:00 EST (16:00 UTC) is already 24 hours away.
    const autumn = utc("2026-10-31T16:00");
    const autumnBack = utc("2026-11-03T16:00");
    expect(
      bookable(day, utc("2026-11-01T16:00"), autumnBack, bookingPage, autumn),
    ).toEqual({ ok: true });
    expect(
      reason(
        bookable(day, utc("2026-11-01T15:59"), autumnBack, bookingPage, autumn),
      ),
    ).toBe("too_soon");
  });
});

/** Bangkok is UTC+7 all year. */
describe("Bangkok", () => {
  const songkran = {
    start_date: "2026-04-13",
    end_date: "2026-04-15",
    repeats_yearly: true,
  };
  const shop = (over: Partial<BookingRules> = {}) =>
    rules({
      timeZone: BANGKOK,
      hours: [
        ...[1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          open: "10:00:00",
          close: "18:00:00",
        })),
        { weekday: 6, open: "11:00:00", close: "16:00:00" },
      ],
      closures: [songkran],
      ...over,
    });

  it("opening hours on the Bangkok weekday, not the UTC one", () => {
    // Friday 22:00 UTC is Saturday 05:00 in Bangkok; Saturday 04:00 UTC is 11:00.
    expect(isOpenAt(shop(), utc("2026-06-05T22:00"))).toBe(false);
    expect(isOpenAt(shop(), utc("2026-06-06T04:00"))).toBe(true); // Sat 11:00
    expect(isOpenAt(shop(), utc("2026-06-06T09:00"))).toBe(true); // Sat 16:00
    expect(isOpenAt(shop(), utc("2026-06-06T09:01"))).toBe(false);
    // Saturday 20:00 UTC is Sunday 03:00 in Bangkok: no hours on Sundays.
    expect(isOpenAt(shop(), utc("2026-06-07T04:00"))).toBe(false); // Sun 11:00
    expect(isOpenAt(shop(), utc("2026-06-08T03:00"))).toBe(true); // Mon 10:00
    expect(isOpenAt(shop(), utc("2026-06-08T02:59"))).toBe(false);
  });

  it("closures: Songkran every year, by the Bangkok date", () => {
    const open = (iso: string) => isOpenAt(shop({ hours: [] }), utc(iso));
    expect(open("2026-04-12T16:59")).toBe(true); // 12 Apr 23:59
    expect(open("2026-04-12T17:00")).toBe(false); // 13 Apr 00:00
    expect(open("2026-04-15T16:59")).toBe(false); // 15 Apr 23:59
    expect(open("2026-04-15T17:00")).toBe(true); // 16 Apr 00:00
    expect(open("2031-04-14T05:00")).toBe(false);
    expect(
      bookable(
        shop(),
        utc("2026-04-10T04:00"), // Fri 11:00
        utc("2026-04-14T04:00"), // Tue 11:00, closed for Songkran
        bookingPage,
        longAgo,
      ),
    ).toEqual({ ok: false, reason: "outside_hours", at: "return" });
  });

  it('the cut-off for "Ride today": an hour before the day\'s own closing time', () => {
    const cut = shop({ bookingCutoffMinutes: 60 });
    // Friday closes 18:00 (11:00 UTC); Saturday closes 16:00 (09:00 UTC).
    expect(cutoffInstant(cut, utc("2026-06-05T04:00"))).toEqual(
      utc("2026-06-05T10:00"),
    );
    expect(cutoffInstant(cut, utc("2026-06-06T05:00"))).toEqual(
      utc("2026-06-06T08:00"),
    );
    const ride = (iso: string) =>
      bookable(cut, utc(iso), utc("2026-06-09T05:00"), rideToday, utc(iso));
    expect(ride("2026-06-06T08:00")).toEqual({ ok: true });
    expect(ride("2026-06-06T08:01")).toEqual({
      ok: false,
      reason: "outside_hours",
      at: "cutoff",
    });
    // No cut-off set: open until closing.
    expect(cutoffInstant(shop(), utc("2026-06-06T05:00"))).toBeNull();
    expect(
      bookable(
        shop(),
        utc("2026-06-06T09:00"),
        utc("2026-06-09T05:00"),
        rideToday,
        utc("2026-06-06T09:00"),
      ),
    ).toEqual({ ok: true });
    // A day with no hours has no closing time to count back from.
    expect(cutoffInstant(cut, utc("2026-06-07T05:00"))).toBeNull();
  });

  it("minimum days, walk-in and advance", () => {
    const mins = shop({ minDaysAdvance: 3, minDaysWalkin: 2 });
    const friday11 = utc("2026-06-05T04:00");
    const monday11 = utc("2026-06-08T04:00");
    const tuesday11 = utc("2026-06-09T04:00");
    expect(bookable(mins, friday11, monday11, bookingPage, longAgo)).toEqual({
      ok: true,
    });
    expect(
      bookable(mins, monday11, utc("2026-06-10T04:00"), bookingPage, longAgo),
    ).toEqual({ ok: false, reason: "too_short", days: 2, minDays: 3 });
    expect(bookable(mins, monday11, tuesday11, rideToday, monday11)).toEqual({
      ok: false,
      reason: "too_short",
      days: 1,
      minDays: 2,
    });
    expect(
      bookable(mins, monday11, utc("2026-06-10T04:00"), rideToday, monday11),
    ).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------- offer

const daily = (amount: number): Pricing => ({
  method: "per_period",
  amount: BigInt(amount),
  period: "day",
});

const location: LocationRules = {
  timeZone: NEW_YORK,
  hours: everyDay(),
  closures: [],
  minNoticeHours: null,
  bookingCutoffMinutes: null,
  minDaysAdvance: null,
  minDaysWalkin: null,
};

const scooter = (over: Partial<ProductRules> = {}): ProductRules => ({
  productId: "scooter",
  type: "vehicle",
  minDaysAdvance: null,
  minDaysWalkin: null,
  listing: null,
  ...over,
});

type LineSpec = {
  id: string;
  productId?: string;
  start?: Date;
  end?: Date;
  quantity?: number;
  pricing?: Pricing | null;
};

/** offer()'s four arguments for some lines, priced at 300.00 a day unless said. */
function scene(
  specs: LineSpec[],
  o: {
    how?: BookingHow;
    now?: Date;
    products?: ProductRules[];
    available?: (number | null)[];
    marketplace?: LineAvailability["marketplace"][];
    location?: Partial<LocationRules>;
  } = {},
): [OfferInputs, LineAvailability[], QuoteInput, OfferRequest] {
  const how = o.how ?? bookingPage;
  const lines = specs.map((spec) => ({
    id: spec.id,
    productId: spec.productId ?? "scooter",
    start: spec.start ?? monday10,
    end: spec.end ?? wednesday10,
    quantity: spec.quantity ?? 1,
  }));
  const pricing: QuoteInput = {
    taxInclusive: true,
    couponsEnabled: false,
    deposit: { shop: { mode: "none" } },
    lines: lines.map((line, i) => ({
      id: line.id,
      productId: line.productId,
      pricing:
        specs[i].pricing === undefined ? daily(30000) : specs[i].pricing!,
      quantity: line.quantity,
      span: { start: line.start, end: line.end, timeZone: NEW_YORK },
      taxRateBp: null,
      vehicle: true,
    })),
  };
  return [
    {
      location: { ...location, ...o.location },
      products: o.products ?? [scooter()],
    },
    lines.map((line, i) => ({
      productId: line.productId,
      available: o.available ? o.available[i] : 5,
      marketplace: o.marketplace ? o.marketplace[i] : null,
    })),
    pricing,
    { ...how, now: o.now ?? longAgo, lines },
  ];
}

const listed = (
  over: Partial<NonNullable<LineAvailability["marketplace"]>> = {},
) => ({
  enabled: true,
  instantUnits: 2,
  requestUnits: 1,
  held: 0,
  instant: 0,
  request: 0,
  ...over,
});

const refusal = (answer: ReturnType<typeof offer>) =>
  answer.ok ? "ok" : `${answer.reason} @ ${answer.lineId}`;

describe("offer(): bookable, then available, then the price", () => {
  it("everything passes: the mode, what is free, and the price from quote()", () => {
    const answer = offer(...scene([{ id: "a", quantity: 2 }]));
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.mode).toBe("instant");
    expect(answer.lines).toEqual([{ id: "a", mode: "instant", available: 5 }]);
    // Two scooters, two days, 300.00 a day.
    expect(answer.quote.totals.total).toBe(BigInt(120000));
    expect(answer.quote.lines[0].listPrice).toBe(BigInt(120000));
  });

  it("each bookable() reason is passed on with its line and its detail, and no price", () => {
    const closed = offer(
      ...scene([{ id: "a" }, { id: "b", start: utc("2026-06-15T10:00") }]),
    );
    expect(closed).toEqual({
      ok: false,
      reason: "outside_hours",
      lineId: "b",
      bookable: { ok: false, reason: "outside_hours", at: "pickup" },
    });
    const short = offer(
      ...scene([{ id: "a" }], { location: { minDaysAdvance: 4 } }),
    );
    expect(short).toEqual({
      ok: false,
      reason: "too_short",
      lineId: "a",
      bookable: { ok: false, reason: "too_short", days: 2, minDays: 4 },
    });
    const soon = offer(
      ...scene([{ id: "a" }], {
        location: { minNoticeHours: 24 },
        now: plus(monday10, -2),
      }),
    );
    expect(soon).toMatchObject({ ok: false, reason: "too_soon", lineId: "a" });
    for (const answer of [closed, short, soon]) {
      expect("quote" in answer).toBe(false);
    }
  });

  it("the rules are asked before stock and before the price: a closed day with nothing free and no price answers outside_hours", () => {
    expect(
      refusal(
        offer(
          ...scene(
            [{ id: "a", start: utc("2026-06-15T10:00"), pricing: null }],
            { available: [0] },
          ),
        ),
      ),
    ).toBe("outside_hours @ a");
    // Open, nothing free, no price: unavailable comes before the price.
    expect(
      refusal(
        offer(...scene([{ id: "a", pricing: null }], { available: [0] })),
      ),
    ).toBe("unavailable @ a");
  });

  it("a product's own minimum days are used for its line", () => {
    const products = [scooter({ minDaysAdvance: 5 })];
    expect(refusal(offer(...scene([{ id: "a" }], { products })))).toBe(
      "too_short @ a",
    );
  });

  it("unavailable: fewer free than wanted; lines of one product over the same days share what is free", () => {
    expect(
      refusal(offer(...scene([{ id: "a", quantity: 3 }], { available: [2] }))),
    ).toBe("unavailable @ a");
    expect(
      refusal(offer(...scene([{ id: "a", quantity: 2 }], { available: [2] }))),
    ).toBe("ok");
    // One free: the second line can't have it too.
    expect(
      refusal(
        offer(...scene([{ id: "a" }, { id: "b" }], { available: [1, 1] })),
      ),
    ).toBe("unavailable @ b");
    // Unless it wants it for other days.
    expect(
      refusal(
        offer(
          ...scene(
            [
              { id: "a" },
              {
                id: "b",
                start: utc("2026-06-18T14:00"),
                end: utc("2026-06-19T14:00"),
              },
            ],
            { available: [1, 1] },
          ),
        ),
      ),
    ).toBe("ok");
  });

  it("a service has nothing to count", () => {
    const products = [
      scooter(),
      { ...scooter(), productId: "delivery", type: "service" as const },
    ];
    const answer = offer(
      ...scene(
        [
          { id: "a" },
          {
            id: "b",
            productId: "delivery",
            quantity: 40,
            pricing: { method: "fixed", amount: BigInt(5000) },
          },
        ],
        { products, available: [1, null] },
      ),
    );
    expect(refusal(answer)).toBe("ok");
    if (answer.ok) expect(answer.lines[1].available).toBeNull();
  });

  it("a product with no price can't be priced: the answer says so and carries no price at all, never zero", () => {
    const answer = offer(
      ...scene(
        [{ id: "a" }, { id: "b", pricing: null }, { id: "c", pricing: null }],
        {
          available: [5, 5, 5],
        },
      ),
    );
    expect(answer).toEqual({
      ok: false,
      reason: "cant_be_priced",
      lineId: "b",
      unpriced: ["b", "c"],
    });
    expect("quote" in answer).toBe(false);
    expect(JSON.stringify(answer)).not.toMatch(/total|amount|price"/);
    // A product that is free of charge is a different thing: it has a
    // price, and the price is nothing.
    const free = offer(...scene([{ id: "a", pricing: { method: "free" } }]));
    expect(free.ok).toBe(true);
    if (free.ok) expect(free.quote.totals.total).toBe(BigInt(0));
  });

  it("the lines to price must be the lines asked for", () => {
    const [inputs, availability, pricing, request] = scene([{ id: "a" }]);
    const other = {
      ...pricing,
      lines: [{ ...pricing.lines[0], quantity: 2 }],
    };
    expect(() => offer(inputs, availability, other, request)).toThrow(
      RangeError,
    );
    expect(() =>
      offer(inputs, availability, { ...pricing, lines: [] }, request),
    ).toThrow(RangeError);
    expect(() => offer(inputs, [], pricing, request)).toThrow(RangeError);
  });
});

describe("offer(): Moto Mangos, the listing's cap and mode", () => {
  const mm = (
    marketplace: LineAvailability["marketplace"],
    o: {
      quantity?: number;
      available?: number;
      how?: BookingHow;
      now?: Date;
    } = {},
  ) =>
    offer(
      ...scene([{ id: "a", quantity: o.quantity ?? 1 }], {
        how: o.how ?? motoMangos,
        now: o.now,
        available: [o.available ?? 5],
        marketplace: [marketplace],
      }),
    );

  it("a vehicle with no listing, or with its listing switched off: not_listed", () => {
    expect(refusal(mm(null))).toBe("not_listed @ a");
    expect(refusal(mm(listed({ enabled: false })))).toBe("not_listed @ a");
    expect(refusal(mm(null, { how: rideToday, now: monday10 }))).toBe(
      "not_listed @ a",
    );
    // The shop's own booking page does not need a listing.
    expect(refusal(mm(null, { how: bookingPage }))).toBe("ok");
  });

  it("Instant while Instant units are left, then Request, then cap_reached", () => {
    const first = mm(listed());
    expect(first.ok && first.mode).toBe("instant");
    const instantFull = mm(listed({ held: 2, instant: 2 }));
    expect(instantFull.ok && instantFull.mode).toBe("request");
    expect(instantFull.ok && instantFull.lines[0].mode).toBe("request");
    expect(refusal(mm(listed({ held: 3, instant: 2, request: 1 })))).toBe(
      "cap_reached @ a",
    );
    // The cap is what Moto Mangos may have out at once, however many are free.
    expect(
      refusal(
        mm(listed({ held: 3, instant: 2, request: 1 }), { available: 50 }),
      ),
    ).toBe("cap_reached @ a");
  });

  it("a booking of several: all of them must fit one mode", () => {
    const two = mm(listed(), { quantity: 2 });
    expect(two.ok && two.mode).toBe("instant");
    // One Instant unit left, two wanted: not Instant; one Request unit: not that either.
    expect(refusal(mm(listed({ held: 1, instant: 1 }), { quantity: 2 }))).toBe(
      "cap_reached @ a",
    );
    const request = mm(
      listed({ instantUnits: 1, requestUnits: 2, held: 1, instant: 1 }),
      { quantity: 2 },
    );
    expect(request.ok && request.mode).toBe("request");
  });

  it("the shop's real availability still binds: unavailable before the cap is asked", () => {
    expect(refusal(mm(listed(), { available: 0 }))).toBe("unavailable @ a");
    expect(refusal(mm(listed(), { quantity: 2, available: 1 }))).toBe(
      "unavailable @ a",
    );
  });

  it('"Ride today" skips the cap and the notice: with the cap full it is still offered', () => {
    const full = listed({ held: 3, instant: 2, request: 1 });
    const products = [
      scooter({
        listing: {
          enabled: true,
          instantUnits: 2,
          requestUnits: 1,
          leadTimeHours: 48,
        },
      }),
    ];
    const ride = (available: number) =>
      offer(
        ...scene([{ id: "a" }], {
          how: rideToday,
          now: monday10,
          products,
          location: { minNoticeHours: 24 },
          available: [available],
          marketplace: [full],
        }),
      );
    const answer = ride(5);
    expect(answer.ok && answer.mode).toBe("now");
    expect(answer.ok && answer.lines[0].mode).toBe("now");
    expect(refusal(ride(0))).toBe("unavailable @ a");
  });

  it("gear booked with the scooter has no listing and no cap", () => {
    const products = [
      scooter({
        listing: {
          enabled: true,
          instantUnits: 2,
          requestUnits: 1,
          leadTimeHours: null,
        },
      }),
      { ...scooter(), productId: "helmet", type: "gear" as const },
    ];
    const answer = offer(
      ...scene([{ id: "a" }, { id: "b", productId: "helmet", quantity: 2 }], {
        how: motoMangos,
        products,
        available: [5, 2],
        marketplace: [listed(), null],
      }),
    );
    expect(refusal(answer)).toBe("ok");
    // But gear runs out like anything else.
    expect(
      refusal(
        offer(
          ...scene(
            [{ id: "a" }, { id: "b", productId: "helmet", quantity: 3 }],
            {
              how: motoMangos,
              products,
              available: [5, 2],
              marketplace: [listed(), null],
            },
          ),
        ),
      ),
    ).toBe("unavailable @ b");
  });

  it("an extra's included units are free in the offer's price, and still counted against stock", () => {
    // Stage 4: the pricing argument says which line is an extra of which.
    const products = [
      scooter(),
      { ...scooter(), productId: "helmet", type: "gear" as const },
    ];
    const withHelmets = (taken: number, free: number) => {
      const [inputs, availability, pricing, request] = scene(
        [
          { id: "a" },
          {
            id: "b",
            productId: "helmet",
            quantity: taken,
            pricing: daily(5000),
          },
        ],
        { products, available: [5, free] },
      );
      return offer(
        inputs,
        availability,
        {
          ...pricing,
          lines: [
            pricing.lines[0],
            {
              ...pricing.lines[1],
              vehicle: false,
              extraOf: { lineId: "a", includedQuantity: 2 },
            },
          ],
        },
        request,
      );
    };
    // Two days: the scooter 600.00; 3 helmets, 2 included, 1 charged: 100.00.
    const answer = withHelmets(3, 3);
    expect(refusal(answer)).toBe("ok");
    if (answer.ok) {
      expect(answer.quote.lines[1]).toMatchObject({
        quantity: 3,
        includedQuantity: 2,
        chargedQuantity: 1,
        listPrice: BigInt(10000),
      });
      expect(answer.quote.totals.total).toBe(BigInt(70000));
    }
    // Included helmets are real helmets: all three must be free.
    expect(refusal(withHelmets(3, 2))).toBe("unavailable @ b");
  });

  it("the listing's lead time binds a Moto Mangos booking and not the shop's own page", () => {
    const products = [
      scooter({
        listing: {
          enabled: true,
          instantUnits: 2,
          requestUnits: 0,
          leadTimeHours: 48,
        },
      }),
    ];
    const now = plus(monday10, -24);
    const args = (how: BookingHow) =>
      scene([{ id: "a" }], {
        how,
        now,
        products,
        location: { minNoticeHours: 12 },
        marketplace: [listed()],
      });
    expect(refusal(offer(...args(motoMangos)))).toBe("too_soon @ a");
    expect(refusal(offer(...args(bookingPage)))).toBe("ok");
  });
});
