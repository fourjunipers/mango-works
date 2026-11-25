/**
 * A booking's lines on their way to platform.create_order() and its answer
 * on the way back (./order-lines.ts): one rental per bike.
 */
import { describe, expect, it } from "vitest";
import {
  askedLineOf,
  foldOrderLines,
  orderLinesOf,
  type AskedLine,
  type MadeLine,
} from "./order-lines";

const SCOOTER = "scooter";
const HELMET = "helmet";
const PLACE = "place";
const start = new Date("2031-01-01T03:00:00Z");
const end = new Date("2031-01-03T03:00:00Z");

const isVehicle = (productId: string) => productId === SCOOTER;

const asked = (over: Partial<AskedLine> = {}): AskedLine => ({
  productId: SCOOTER,
  locationId: PLACE,
  start,
  end,
  quantity: 1,
  ...over,
});

/** A line as create_order() takes it. */
const sentLine = (over: Record<string, unknown> = {}) => ({
  product_id: SCOOTER,
  location_id: PLACE,
  starts_at: "2031-01-01T03:00:00.000Z",
  ends_at: "2031-01-03T03:00:00.000Z",
  quantity: 1,
  ...over,
});

const rental = (n: number, over: Partial<MadeLine> = {}): MadeLine => ({
  rental_id: `n-${n}`,
  reservation_id: `r-${n}`,
  unit_ids: [`u-${n}`],
  shortage: 0,
  ...over,
});

describe("orderLinesOf(): the lines create_order() takes", () => {
  it("one bike is one line, under the database's names, with no parent and no units unless given", () => {
    expect(orderLinesOf([asked()], isVehicle)).toEqual({
      lines: [sentLine()],
      first: [0],
      count: [1],
    });
    expect(orderLinesOf([], isVehicle)).toEqual({
      lines: [],
      first: [],
      count: [],
    });
  });

  it("N bikes become N lines of one", () => {
    const sent = orderLinesOf([asked({ quantity: 3 })], isVehicle);
    expect(sent.lines).toEqual([sentLine(), sentLine(), sentLine()]);
    expect(sent.first).toEqual([0]);
    expect(sent.count).toEqual([3]);
  });

  it("gear keeps its quantity, and so does every line when nothing is a vehicle", () => {
    const helmets = asked({ productId: HELMET, quantity: 4 });
    expect(orderLinesOf([helmets], isVehicle)).toEqual({
      lines: [sentLine({ product_id: HELMET, quantity: 4 })],
      first: [0],
      count: [1],
    });
    expect(orderLinesOf([asked({ quantity: 3 })], () => false).lines).toEqual([
      sentLine({ quantity: 3 }),
    ]);
  });

  it("an extra's parent is remapped to its vehicle line's first bike", () => {
    const sent = orderLinesOf(
      [
        asked({ quantity: 2 }),
        asked({ productId: HELMET, quantity: 2, parent: 0 }),
        asked({ quantity: 3 }),
        asked({ productId: HELMET, quantity: 1, parent: 2 }),
      ],
      isVehicle,
    );
    expect(sent.first).toEqual([0, 2, 3, 6]);
    expect(sent.count).toEqual([2, 1, 3, 1]);
    expect(sent.lines).toEqual([
      sentLine(),
      sentLine(),
      sentLine({ product_id: HELMET, quantity: 2, parent: 0 }),
      sentLine(),
      sentLine(),
      sentLine(),
      sentLine({ product_id: HELMET, quantity: 1, parent: 3 }),
    ]);
    // The first line's own index is a parent too: 0 is not "no parent".
    expect(sent.lines[2]).toHaveProperty("parent", 0);
    expect(sent.lines[0]).not.toHaveProperty("parent");
  });

  it("named units go one per bike, in the order they were named", () => {
    const sent = orderLinesOf(
      [asked({ quantity: 3, unitIds: ["a", "b", "c"] })],
      isVehicle,
    );
    expect(sent.lines).toEqual([
      sentLine({ unit_ids: ["a"] }),
      sentLine({ unit_ids: ["b"] }),
      sentLine({ unit_ids: ["c"] }),
    ]);
    expect(sent.count).toEqual([3]);
    // One bike, and gear tracked unit by unit: the list as it is, a copy.
    const named = ["a", "b"];
    const whole = orderLinesOf(
      [
        asked({ unitIds: ["a"] }),
        asked({ productId: HELMET, quantity: 2, unitIds: named }),
      ],
      isVehicle,
    );
    expect(whole.lines).toEqual([
      sentLine({ unit_ids: ["a"] }),
      sentLine({ product_id: HELMET, quantity: 2, unit_ids: ["a", "b"] }),
    ]);
    expect(whole.lines[1].unit_ids).not.toBe(named);
  });

  it("units named but not one per bike: the line is sent whole, for the database to refuse", () => {
    for (const unitIds of [["a", "b"], ["a", "b", "c", "d"], []]) {
      const sent = orderLinesOf(
        [
          asked({ quantity: 3, unitIds }),
          asked({ productId: HELMET, parent: 0 }),
        ],
        isVehicle,
      );
      expect(sent, JSON.stringify(unitIds)).toEqual({
        lines: [
          sentLine({ quantity: 3, unit_ids: unitIds }),
          sentLine({ product_id: HELMET, parent: 0 }),
        ],
        first: [0, 1],
        count: [1, 1],
      });
    }
  });
});

describe("foldOrderLines(): the answer, one entry per line asked for", () => {
  it("a line sent as it was is its one rental", () => {
    const sent = orderLinesOf(
      [asked(), asked({ productId: HELMET, quantity: 2, parent: 0 })],
      isVehicle,
    );
    expect(
      foldOrderLines(
        [rental(1), rental(2, { unit_ids: [], shortage: 2 })],
        sent,
      ),
    ).toEqual([
      {
        reservationId: "r-1",
        rentalIds: ["n-1"],
        unitIds: ["u-1"],
        shortage: 0,
      },
      { reservationId: "r-2", rentalIds: ["n-2"], unitIds: [], shortage: 2 },
    ]);
  });

  it("a line sent as N bikes: its first reservation, every rental, the units one after another, and the shortages added up", () => {
    const sent = orderLinesOf(
      [
        asked({ quantity: 3 }),
        asked({ productId: HELMET, quantity: 2, parent: 0 }),
        asked({ quantity: 2 }),
      ],
      isVehicle,
    );
    expect(
      foldOrderLines(
        [
          rental(1),
          rental(2, { unit_ids: [], shortage: 1 }),
          rental(3, { unit_ids: [], shortage: 1 }),
          rental(4, { unit_ids: ["h-1", "h-2"] }),
          rental(5),
          rental(6),
        ],
        sent,
      ),
    ).toEqual([
      {
        reservationId: "r-1",
        rentalIds: ["n-1", "n-2", "n-3"],
        unitIds: ["u-1"],
        shortage: 2,
      },
      {
        reservationId: "r-4",
        rentalIds: ["n-4"],
        unitIds: ["h-1", "h-2"],
        shortage: 0,
      },
      {
        reservationId: "r-5",
        rentalIds: ["n-5", "n-6"],
        unitIds: ["u-5", "u-6"],
        shortage: 0,
      },
    ]);
  });

  it("a draft's rentals have no reservation yet", () => {
    expect(
      foldOrderLines(
        [
          rental(1, { reservation_id: null, unit_ids: [] }),
          rental(2, { reservation_id: null, unit_ids: [] }),
        ],
        { first: [0], count: [2] },
      ),
    ).toEqual([
      {
        reservationId: null,
        rentalIds: ["n-1", "n-2"],
        unitIds: [],
        shortage: 0,
      },
    ]);
  });
});

describe("askedLineOf(): the line a refusal names, as the caller numbered it", () => {
  it("any bike of a line sent as N maps back to that line; later lines to their own", () => {
    const sent = orderLinesOf(
      [
        asked({ quantity: 2 }),
        asked({ productId: HELMET, quantity: 2, parent: 0 }),
        asked({ quantity: 3 }),
      ],
      isVehicle,
    );
    // Sent: bikes 0 and 1, the helmets 2, bikes 3 to 5.
    expect([0, 1, 2, 3, 4, 5].map((at) => askedLineOf(at, sent))).toEqual([
      0, 0, 1, 2, 2, 2,
    ]);
  });

  it("lines sent as they were keep their numbers; a refusal that names no line names none", () => {
    const sent = orderLinesOf([asked(), asked(), asked()], () => false);
    expect([0, 1, 2].map((at) => askedLineOf(at, sent))).toEqual([0, 1, 2]);
    expect(askedLineOf(null, sent)).toBeNull();
    expect(askedLineOf(undefined, sent)).toBeNull();
  });
});
