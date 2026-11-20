import { describe, expect, it } from "vitest";
import type { AvailabilityRow, BookingInputs } from "./booking-inputs";
import {
  answersFor,
  howFor,
  readPriceCheck,
  spanOf,
  type PriceCheckChannel,
} from "./new-order";

const LOC = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const BIKE = "20000000-0000-4000-8000-000000000001";
const HELMET = "20000000-0000-4000-8000-000000000002";
const DELIVERY = "20000000-0000-4000-8000-000000000003";
const zone = "America/New_York";

const inputs = (
  change: {
    notice?: number | null;
    minAdvance?: number | null;
    minWalkin?: number | null;
    overbooking?: boolean;
    listed?: boolean;
  } = {},
): BookingInputs => ({
  shop: {
    currency: "USD",
    allow_overbooking: change.overbooking ?? false,
    hold_minutes: 15,
    buffer_before_minutes: null,
    buffer_after_minutes: null,
  },
  location: {
    id: LOC,
    timezone: zone,
    min_notice_hours: change.notice ?? null,
    booking_cutoff_minutes: null,
    min_days_advance: change.minAdvance ?? null,
    min_days_walkin: change.minWalkin ?? null,
    // Open every day, 08:00 to 20:00.
    hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      open: "08:00:00",
      close: "20:00:00",
    })),
    closures: [],
  },
  products: [
    {
      product_id: BIKE,
      type: "vehicle",
      buffer_before_minutes: null,
      buffer_after_minutes: null,
      min_days_advance: null,
      min_days_walkin: null,
      listing: change.listed
        ? {
            enabled: true,
            instant_units: 2,
            request_units: 0,
            lead_time_hours: null,
            ready_now: 0,
          }
        : null,
    },
    {
      product_id: HELMET,
      type: "gear",
      buffer_before_minutes: null,
      buffer_after_minutes: null,
      min_days_advance: null,
      min_days_walkin: null,
      listing: null,
    },
    {
      product_id: DELIVERY,
      type: "service",
      buffer_before_minutes: null,
      buffer_after_minutes: null,
      min_days_advance: null,
      min_days_walkin: null,
      listing: null,
    },
  ],
});

const row = (
  product_id: string,
  type: AvailabilityRow["type"],
  available: number | null,
  stock: number | null,
  listed = false,
): AvailabilityRow => ({
  product_id,
  location_id: LOC,
  type,
  stock,
  free: available,
  shortage_demand: 0,
  available,
  unlimited: available === null,
  marketplace:
    type === "vehicle"
      ? {
          enabled: listed,
          instant_units: 2,
          request_units: 0,
          mm_held: 0,
          mm_instant: 0,
          mm_request: 0,
        }
      : null,
});

// Friday 2 July 2027, 09:00 in New York.
const now = new Date("2027-07-02T13:00:00Z");
const span = (pickupUtc: string, days: number) => {
  const start = new Date(pickupUtc);
  return { start, end: new Date(start.getTime() + days * 86_400_000) };
};

describe("Price check: the channel and the booking it stands for", () => {
  it("the counter books as staff; the booking page and Moto Mangos book ahead", () => {
    expect(howFor("walk_in")).toEqual({ channel: "walk_in", mode: "staff" });
    expect(howFor("booking_page")).toEqual({
      channel: "booking_page",
      mode: "instant",
    });
    expect(howFor("marketplace")).toEqual({
      channel: "marketplace",
      mode: "instant",
    });
  });
});

describe("Price check: the search", () => {
  const locations = [
    { id: LOC, timezone: zone },
    { id: OTHER, timezone: "Asia/Ho_Chi_Minh" },
  ];

  it("defaults: the first location, tomorrow 10:00 to the day after, at the counter", () => {
    // 23:30 on 1 July in New York is already 2 July in UTC.
    const late = new Date("2027-07-02T03:30:00Z");
    expect(readPriceCheck({}, locations, late)).toEqual({
      locationId: LOC,
      pickup: "2027-07-02T10:00",
      dropoff: "2027-07-03T10:00",
      channel: "walk_in",
      productId: null,
    });
  });

  it("reads what was asked, and ignores anything it does not know", () => {
    expect(
      readPriceCheck(
        {
          location: OTHER,
          pickup: "2027-08-01T09:30",
          return: "2027-08-04T09:30",
          channel: "marketplace",
          product: BIKE,
        },
        locations,
        now,
      ),
    ).toMatchObject({
      locationId: OTHER,
      pickup: "2027-08-01T09:30",
      dropoff: "2027-08-04T09:30",
      channel: "marketplace",
      productId: BIKE,
    });
    expect(
      readPriceCheck(
        {
          location: "elsewhere",
          pickup: "tomorrow",
          channel: "api",
          product: "x; drop",
        },
        locations,
        now,
      ),
    ).toMatchObject({
      locationId: LOC,
      pickup: "2027-07-03T10:00",
      channel: "walk_in",
      productId: null,
    });
    expect(readPriceCheck({}, [], now)).toBeNull();
  });

  it("the span is read on the location's clock, across a clock change, and a return before the pickup is refused", () => {
    const asked = readPriceCheck(
      { pickup: "2027-03-13T10:00", return: "2027-03-15T10:00" },
      [{ id: LOC, timezone: zone }],
      now,
    )!;
    const answer = spanOf(asked, zone);
    expect(answer).not.toBe("invalid");
    if (answer === "invalid") return;
    // 10:00 EST is 15:00 UTC; 10:00 EDT, after the clocks go forward, 14:00 UTC.
    expect(answer.start.toISOString()).toBe("2027-03-13T15:00:00.000Z");
    expect(answer.end.toISOString()).toBe("2027-03-15T14:00:00.000Z");
    expect(spanOf({ ...asked, dropoff: asked.pickup }, zone)).toBe("invalid");
  });
});

describe("Price check: each product's answer", () => {
  const rows = [
    row(BIKE, "vehicle", 3, 8),
    row(HELMET, "gear", 0, 20),
    row(DELIVERY, "service", null, null),
  ];
  const at = (
    channel: PriceCheckChannel,
    change: Parameters<typeof inputs>[0] = {},
    when = span("2027-07-02T16:00:00Z", 2),
    given = rows,
  ) => answersFor(inputs(change), given, when, channel, now);

  it("counts: free of stock, nothing for a service", () => {
    const [bike, helmet, delivery] = at("walk_in");
    expect(bike).toEqual({
      productId: BIKE,
      available: 3,
      stock: 8,
      refused: null,
    });
    expect(helmet.refused).toEqual({
      ok: false,
      reason: "none_free",
      overbooking: false,
    });
    expect(delivery).toMatchObject({
      available: null,
      stock: null,
      refused: null,
    });
  });

  it("the shop's notice binds online bookings, never the counter", () => {
    // Pickup at 12:00 the same day: three hours away, notice 24 hours.
    expect(at("walk_in", { notice: 24 })[0].refused).toBeNull();
    const online = at("booking_page", { notice: 24 })[0].refused;
    expect(online).toMatchObject({ ok: false, reason: "too_soon" });
    expect(
      online &&
        "earliestPickup" in online &&
        online.earliestPickup.toISOString(),
    ).toBe("2027-07-03T13:00:00.000Z");
  });

  it("minimum days: the walk-in rule at the counter, the advance rule online", () => {
    expect(at("walk_in", { minWalkin: 3, minAdvance: 1 })[0].refused).toEqual({
      ok: false,
      reason: "too_short",
      days: 2,
      minDays: 3,
    });
    expect(
      at("booking_page", { minWalkin: 3, minAdvance: 1 })[0].refused,
    ).toBeNull();
  });

  it("closed at the pickup or the return", () => {
    // 21:00 New York: after closing.
    expect(
      at("walk_in", {}, span("2027-07-03T01:00:00Z", 1))[0].refused,
    ).toMatchObject({ reason: "outside_hours", at: "pickup" });
  });

  it("Moto Mangos books listed vehicles only; gear is judged as anywhere", () => {
    expect(at("marketplace")[0].refused).toEqual({
      ok: false,
      reason: "not_listed",
    });
    const listed = [row(BIKE, "vehicle", 3, 8, true), ...rows.slice(1)];
    expect(
      at("marketplace", { listed: true }, undefined, listed)[0].refused,
    ).toBeNull();
  });

  it("Moto Mangos books within the listing's units: when its bookings have used them up, the cap is reached", () => {
    const listed = (held: number, instant: number, request: number) => ({
      ...row(BIKE, "vehicle", 3, 8, true),
      marketplace: {
        enabled: true,
        instant_units: 2,
        request_units: 1,
        mm_held: held,
        mm_instant: instant,
        mm_request: request,
      },
    });
    const at = (r: AvailabilityRow) =>
      answersFor(
        inputs({ listed: true }),
        [r],
        span("2027-07-02T16:00:00Z", 2),
        "marketplace",
        now,
      )[0].refused;
    // Three listed (2 instant, 1 request), none used: offered.
    expect(at(listed(0, 0, 0))).toBeNull();
    // Two instant used, the request place free: still offered (as a request).
    expect(at(listed(2, 2, 0))).toBeNull();
    // All three used, though the shop has 3 bikes free: the cap is reached.
    expect(at(listed(3, 2, 1))).toEqual({ ok: false, reason: "cap_reached" });
    // The counter and the booking page are not bound by Moto Mangos' cap.
    expect(
      answersFor(
        inputs({ listed: true }),
        [listed(3, 2, 1)],
        span("2027-07-02T16:00:00Z", 2),
        "walk_in",
        now,
      )[0].refused,
    ).toBeNull();
  });

  it("none free: with overbooking on, the counter could save a shortage; online never", () => {
    expect(at("walk_in", { overbooking: true })[1].refused).toEqual({
      ok: false,
      reason: "none_free",
      overbooking: true,
    });
    expect(at("booking_page", { overbooking: true })[1].refused).toEqual({
      ok: false,
      reason: "none_free",
      overbooking: false,
    });
  });
});
