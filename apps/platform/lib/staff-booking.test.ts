import { describe, expect, it } from "vitest";
import { canExtras, extrasRoles } from "./extras-permissions";
import { roles } from "./roles";
import {
  assignUnits,
  cancelReservation,
  confirmHold,
  moveUnit,
  reserveAsStaff,
  type StaffDb,
} from "./staff-booking";
import { isTryAgain, TRY_AGAIN_CODES } from "./try-again";

type Reply = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

/** A client that answers every call the same way and remembers the calls. */
function fake(reply: Reply) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: StaffDb = {
    rpc(fn, args) {
      calls.push({ fn, args });
      return Promise.resolve(reply);
    },
  };
  return { db, calls };
}

const T = "tenant";
const line = {
  productId: "p",
  locationId: "l",
  start: new Date("2031-01-01T03:00:00Z"),
  end: new Date("2031-01-03T03:00:00Z"),
  quantity: 1,
};

/** Each staff call, by the function it reaches. */
const everyCall: [string, (db: StaffDb) => Promise<unknown>][] = [
  [
    "reserve",
    (db) => reserveAsStaff(db, T, { channel: "walk_in", lines: [line] }),
  ],
  ["confirm_hold", (db) => confirmHold(db, T, "b")],
  ["cancel_reservation", (db) => cancelReservation(db, T, { bookingId: "b" })],
  ["assign_units", (db) => assignUnits(db, T, "r", ["u"])],
  [
    "move_unit",
    (db) => moveUnit(db, T, { unitId: "u", productId: "p", locationId: "l" }),
  ],
];

describe("the staff paths: a lock that could not be had in time", () => {
  it("is 55P03 (the function's own lock timeout) or 57014 (the API's statement timeout), and nothing else", () => {
    expect(TRY_AGAIN_CODES).toEqual(["55P03", "57014"]);
    expect(isTryAgain({ code: "55P03", message: "lock timeout" })).toBe(true);
    expect(isTryAgain({ code: "57014", message: "statement timeout" })).toBe(
      true,
    );
    for (const code of ["40P01", "42501", "P0001", "22023", "23P01", undefined])
      expect(isTryAgain({ code, message: "x" }), String(code)).toBe(false);
    expect(isTryAgain(null)).toBe(false);
  });

  for (const [fn, call] of everyCall) {
    it(`${fn}: both codes are answered try_again, any other error is thrown, and an answer is passed on as it is`, async () => {
      for (const code of TRY_AGAIN_CODES) {
        const { db, calls } = fake({
          data: null,
          error: { code, message: "canceling statement due to lock timeout" },
        });
        expect(await call(db), code).toEqual({ ok: false, reason: "try_again" });
        // One call: it is the caller's choice to send it again.
        expect(calls.map((c) => c.fn)).toEqual([fn]);
      }
      const denied = fake({
        data: null,
        error: { code: "42501", message: "permission denied" },
      });
      await expect(call(denied.db)).rejects.toMatchObject({
        message: "permission denied",
        code: "42501",
      });
      const refusal = { ok: false, reason: "unavailable", line: 0 };
      expect(await call(fake({ data: refusal, error: null }).db)).toEqual(
        refusal,
      );
      const fine = { ok: true, booking_id: "b" };
      expect(await call(fake({ data: fine, error: null }).db)).toEqual(fine);
    });
  }

  it("reserveAsStaff() sends a staff booking on a staff channel, with the units named when there are any", async () => {
    const { db, calls } = fake({ data: { ok: true }, error: null });
    await reserveAsStaff(db, T, {
      channel: "phone",
      hold: true,
      lines: [
        { ...line, unitIds: ["u1"] },
        { ...line, productId: "helmet", quantity: 2, parent: 0 },
      ],
    });
    expect(calls[0].args).toEqual({
      p_tenant_id: T,
      p_request: {
        channel: "phone",
        mode: "staff",
        hold: true,
        lines: [
          {
            product_id: "p",
            location_id: "l",
            starts_at: "2031-01-01T03:00:00.000Z",
            ends_at: "2031-01-03T03:00:00.000Z",
            quantity: 1,
            unit_ids: ["u1"],
          },
          {
            product_id: "helmet",
            location_id: "l",
            starts_at: "2031-01-01T03:00:00.000Z",
            ends_at: "2031-01-03T03:00:00.000Z",
            quantity: 2,
            parent: 0,
          },
        ],
      },
    });
  });

  it("cancelReservation() names the booking or one row, never both; assignUnits() with no units fills a shortage", async () => {
    const { db, calls } = fake({ data: { ok: true }, error: null });
    await cancelReservation(db, T, { bookingId: "b" });
    await cancelReservation(db, T, { reservationId: "r" });
    await assignUnits(db, T, "r");
    expect(calls.map((c) => c.args)).toEqual([
      { p_tenant_id: T, p_booking_id: "b" },
      { p_tenant_id: T, p_reservation_id: "r" },
      { p_tenant_id: T, p_reservation_id: "r" },
    ]);
  });
});

describe("who may change a vehicle's extras", () => {
  it("everyone in the shop reads; owners and managers write", () => {
    expect(extrasRoles("read")).toEqual(roles);
    expect(roles.filter((role) => canExtras(role, "write"))).toEqual([
      "owner",
      "manager",
    ]);
  });
});
