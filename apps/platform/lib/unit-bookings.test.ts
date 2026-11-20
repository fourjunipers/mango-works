import { describe, expect, it } from "vitest";
import { splitUnitBookings, statusOf, type UnitBooking } from "./unit-bookings";

const now = new Date("2027-01-10T12:00:00Z");
const at = (iso: string) => new Date(iso);
const booking = (
  id: string,
  state: UnitBooking["state"],
  start: string,
  end: string,
  holdExpiresAt: string | null = null,
): UnitBooking => ({
  reservationId: id,
  bookingId: `b-${id}`,
  state,
  channel: "walk_in",
  start: at(start),
  end: at(end),
  holdExpiresAt: holdExpiresAt ? at(holdExpiresAt) : null,
});

describe("bookings on a unit's page", () => {
  it("says what each state is, and an unreturned unit past its end is overdue", () => {
    expect(
      statusOf(
        booking(
          "h",
          "held",
          "2027-01-12T03:00:00Z",
          "2027-01-14T03:00:00Z",
          "2027-01-10T12:30:00Z",
        ),
        now,
      ),
    ).toEqual({ kind: "held", until: at("2027-01-10T12:30:00Z") });
    // Past its expiry and not swept yet: it ran out.
    expect(
      statusOf(
        booking(
          "x",
          "held",
          "2027-01-12T03:00:00Z",
          "2027-01-14T03:00:00Z",
          "2027-01-10T11:59:59Z",
        ),
        now,
      ),
    ).toEqual({ kind: "ranOut" });
    expect(
      statusOf(
        booking(
          "r",
          "reserved",
          "2027-01-12T03:00:00Z",
          "2027-01-14T03:00:00Z",
        ),
        now,
      ),
    ).toEqual({ kind: "booked" });
    expect(
      statusOf(
        booking("o", "out", "2027-01-09T03:00:00Z", "2027-01-11T03:00:00Z"),
        now,
      ),
    ).toEqual({ kind: "out" });
    expect(
      statusOf(
        booking("d", "out", "2027-01-05T03:00:00Z", "2027-01-08T03:00:00Z"),
        now,
      ),
    ).toEqual({ kind: "overdue" });
    expect(
      statusOf(
        booking(
          "x",
          "returned",
          "2027-01-01T03:00:00Z",
          "2027-01-03T03:00:00Z",
        ),
        now,
      ),
    ).toEqual({ kind: "returned" });
  });

  it("splits now-and-coming (soonest first) from over (latest first, five at most)", () => {
    const list = [
      booking(
        "later",
        "reserved",
        "2027-01-20T03:00:00Z",
        "2027-01-22T03:00:00Z",
      ),
      booking(
        "soon",
        "reserved",
        "2027-01-11T03:00:00Z",
        "2027-01-12T03:00:00Z",
      ),
      booking(
        "hold",
        "held",
        "2027-01-15T03:00:00Z",
        "2027-01-16T03:00:00Z",
        "2027-01-10T12:30:00Z",
      ),
      booking(
        "ranOut",
        "held",
        "2027-01-15T03:00:00Z",
        "2027-01-16T03:00:00Z",
        "2027-01-10T11:00:00Z",
      ),
      booking("overdue", "out", "2027-01-05T03:00:00Z", "2027-01-08T03:00:00Z"),
      booking(
        "back",
        "returned",
        "2027-01-01T03:00:00Z",
        "2027-01-03T03:00:00Z",
      ),
      booking(
        "ended",
        "reserved",
        "2027-01-04T03:00:00Z",
        "2027-01-06T03:00:00Z",
      ),
    ];
    const { current, past } = splitUnitBookings(list, now);
    expect(current.map((b) => b.reservationId)).toEqual([
      "overdue",
      "soon",
      "hold",
      "later",
    ]);
    expect(past.map((b) => b.reservationId)).toEqual([
      "ranOut",
      "ended",
      "back",
    ]);
    const many = Array.from({ length: 8 }, (_, i) =>
      booking(
        `r${i}`,
        "returned",
        `2026-12-0${i + 1}T03:00:00Z`,
        `2026-12-0${i + 2}T03:00:00Z`,
      ),
    );
    expect(
      splitUnitBookings(many, now).past.map((b) => b.reservationId),
    ).toEqual(["r7", "r6", "r5", "r4", "r3"]);
  });
});
