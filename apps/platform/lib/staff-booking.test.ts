import { describe, expect, it } from "vitest";
import { canExtras, extrasRoles } from "./extras-permissions";
import { roles } from "./roles";
import {
  assignUnits,
  cancelReservation,
  confirmHold,
  moveUnit,
  reserveAsStaff,
  reserveDraft,
  type StaffDb,
} from "./staff-booking";
import {
  isOrderTryAgain,
  isTryAgain,
  ORDER_TRY_AGAIN_CODES,
  TRY_AGAIN_CODES,
} from "./try-again";

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

/** An order as the database answers it: one entry of `lines` per rental. */
const made = (rentals: number, more: Record<string, unknown> = {}) => ({
  ok: true,
  order_id: "b",
  number: 7,
  code: "ABCDEF",
  status: "booked",
  ...more,
  lines: Array.from({ length: rentals }, (_, index) => ({
    rental_id: `n-${index + 1}`,
    reservation_id: `r-${index + 1}`,
    unit_ids: [`u-${index + 1}`],
    shortage: 0,
  })),
});

/** The same order as the staff paths answer it: one entry per line asked for. */
const folded = {
  ok: true,
  booking_id: "b",
  number: 7,
  code: "ABCDEF",
  status: "booked",
  lines: [
    {
      reservation_id: "r-1",
      rental_ids: ["n-1"],
      unit_ids: ["u-1"],
      shortage: 0,
    },
  ],
};

/** What confirm_order(), cancel_order() and assign_order_units() answer. */
const done = { ok: true, order_id: "b", status: "booked" };

type EveryCall = {
  /** The database function it reaches. */
  fn: string;
  call: (db: StaffDb) => Promise<unknown>;
  /** The database's ok answer, and what the staff path makes of it. */
  answer: unknown;
  passedOn: unknown;
};

/** Each staff call, by the function it reaches. */
const everyCall: EveryCall[] = [
  {
    fn: "create_order",
    call: (db) => reserveAsStaff(db, T, { channel: "walk_in", lines: [line] }),
    answer: made(1),
    passedOn: folded,
  },
  {
    fn: "hold_order",
    call: (db) => reserveDraft(db, T, "b", { hold: true }),
    answer: made(1),
    passedOn: folded,
  },
  {
    fn: "reserve_order",
    call: (db) => reserveDraft(db, T, "b"),
    answer: made(1),
    passedOn: folded,
  },
  {
    fn: "confirm_order",
    call: (db) => confirmHold(db, T, "b"),
    answer: done,
    passedOn: { ...done, booking_id: "b" },
  },
  {
    fn: "cancel_order",
    call: (db) => cancelReservation(db, T, { bookingId: "b" }),
    answer: done,
    passedOn: { ...done, booking_id: "b" },
  },
  {
    fn: "assign_order_units",
    call: (db) => assignUnits(db, T, { bookingId: "b", rentalId: "n" }, ["u"]),
    answer: done,
    passedOn: { ...done, booking_id: "b" },
  },
  {
    fn: "move_unit",
    call: (db) =>
      moveUnit(db, T, { unitId: "u", productId: "p", locationId: "l" }),
    answer: { ok: true, moved: 2 },
    passedOn: { ok: true, moved: 2 },
  },
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

  it("for an order call it is also 40P01 (a deadlock Postgres broke that reached the caller), and nothing else", () => {
    expect(ORDER_TRY_AGAIN_CODES).toEqual(["55P03", "57014", "40P01"]);
    for (const code of ORDER_TRY_AGAIN_CODES)
      expect(isOrderTryAgain({ code, message: "x" }), code).toBe(true);
    for (const code of ["42501", "P0001", "22023", "23P01", undefined])
      expect(isOrderTryAgain({ code, message: "x" }), String(code)).toBe(false);
    expect(isOrderTryAgain(null)).toBe(false);
    // The two-code list is as it was: 40P01 is the order calls' alone.
    expect(isTryAgain({ code: "40P01", message: "deadlock detected" })).toBe(
      false,
    );
  });

  for (const { fn, call, answer, passedOn } of everyCall) {
    it(`${fn}: all three codes are answered try_again, any other error is thrown, a refusal is passed on as it is, and an answer names the booking`, async () => {
      for (const code of ["55P03", "57014", "40P01"]) {
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
      const refusal = { ok: false, reason: "unavailable" };
      expect(await call(fake({ data: refusal, error: null }).db)).toEqual(
        refusal,
      );
      expect(await call(fake({ data: answer, error: null }).db)).toEqual(
        passedOn,
      );
    });
  }

  it("reserveAsStaff() sends a staff order on a staff channel, with the units named when there are any", async () => {
    const { db, calls } = fake({ data: made(2), error: null });
    await reserveAsStaff(db, T, {
      channel: "phone",
      hold: true,
      lines: [
        { ...line, unitIds: ["u1"] },
        { ...line, productId: "helmet", quantity: 2, parent: 0 },
      ],
    });
    expect(calls.map((c) => c.fn)).toEqual(["create_order"]);
    expect(calls[0].args).toEqual({
      p_tenant_id: T,
      p_order: {
        channel: "phone",
        mode: "staff",
        action: "hold",
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

  it("reserveAsStaff(): hold, reserve or draft is the order's action; the customer, the notes and the idempotency key go only when given; its lines go as they are", async () => {
    const { db, calls } = fake({ data: made(1), error: null });
    await reserveAsStaff(db, T, { channel: "walk_in", lines: [line] });
    await reserveAsStaff(db, T, {
      channel: "walk_in",
      draft: true,
      customerId: "c",
      notes: "Calls back at five",
      idempotencyKey: "k",
      // No price is worked out here, so nothing says this is a vehicle:
      // the line is one rental, whatever its quantity.
      lines: [{ ...line, quantity: 3 }],
    });
    await reserveAsStaff(db, T, {
      channel: "walk_in",
      customerId: null,
      notes: "",
      lines: [line],
    });
    const sent = calls.map((c) => c.args.p_order as Record<string, unknown>);
    expect(sent[0]).toEqual({
      channel: "walk_in",
      mode: "staff",
      action: "reserve",
      lines: [expect.objectContaining({ product_id: "p", quantity: 1 })],
    });
    expect(sent[1]).toEqual({
      channel: "walk_in",
      mode: "staff",
      action: "draft",
      customer_id: "c",
      notes: "Calls back at five",
      idempotency_key: "k",
      lines: [expect.objectContaining({ product_id: "p", quantity: 3 })],
    });
    expect(Object.keys(sent[2]).sort()).toEqual([
      "action",
      "channel",
      "lines",
      "mode",
    ]);
  });

  it("reserveAsStaff() answers the order under the booking's names, one entry per line asked for; a refusal names the caller's line", async () => {
    const held = fake({
      data: {
        ...made(2, {
          status: "new",
          hold_expires_at: "2031-01-01T00:15:00Z",
          repeat: true,
        }),
        lines: [
          { rental_id: "n-1", reservation_id: "r-1", unit_ids: [], shortage: 1 },
          { rental_id: "n-2", reservation_id: null, unit_ids: [], shortage: 0 },
        ],
      },
      error: null,
    });
    expect(
      await reserveAsStaff(held.db, T, {
        channel: "phone",
        hold: true,
        lines: [line, { ...line, productId: "helmet", quantity: 2, parent: 0 }],
      }),
    ).toEqual({
      ok: true,
      booking_id: "b",
      number: 7,
      code: "ABCDEF",
      status: "new",
      hold_expires_at: "2031-01-01T00:15:00Z",
      repeat: true,
      lines: [
        { reservation_id: "r-1", rental_ids: ["n-1"], unit_ids: [], shortage: 1 },
        { reservation_id: null, rental_ids: ["n-2"], unit_ids: [], shortage: 0 },
      ],
    });
    for (const at of [1, null]) {
      const refused = fake({
        data: { ok: false, reason: "unavailable", line: at },
        error: null,
      });
      expect(
        await reserveAsStaff(refused.db, T, {
          channel: "phone",
          lines: [line, { ...line, productId: "helmet", parent: 0 }],
        }),
      ).toEqual({ ok: false, reason: "unavailable", line: at });
    }
  });

  it("reserveDraft() holds with hold_order() and reserves with reserve_order(); the coupon goes in p_request, only when there is one", async () => {
    const { db, calls } = fake({ data: made(2), error: null });
    const coupon = { couponId: "k", amount: BigInt(20000) };
    await reserveDraft(db, T, "b");
    await reserveDraft(db, T, "b", { hold: false, coupon: null });
    await reserveDraft(db, T, "b", { hold: true });
    await reserveDraft(db, T, "b", { hold: true, coupon });
    const answer = await reserveDraft(db, T, "b", { coupon });
    expect(calls).toEqual([
      { fn: "reserve_order", args: { p_tenant_id: T, p_order_id: "b" } },
      { fn: "reserve_order", args: { p_tenant_id: T, p_order_id: "b" } },
      { fn: "hold_order", args: { p_tenant_id: T, p_order_id: "b" } },
      {
        fn: "hold_order",
        args: {
          p_tenant_id: T,
          p_order_id: "b",
          p_request: { coupon: { coupon_id: "k", amount: "20000" } },
        },
      },
      {
        fn: "reserve_order",
        args: {
          p_tenant_id: T,
          p_order_id: "b",
          p_request: { coupon: { coupon_id: "k", amount: "20000" } },
        },
      },
    ]);
    // Its rentals as they were saved: each its own line.
    expect(answer).toEqual({
      ...folded,
      lines: [
        folded.lines[0],
        {
          reservation_id: "r-2",
          rental_ids: ["n-2"],
          unit_ids: ["u-2"],
          shortage: 0,
        },
      ],
    });
  });

  it("confirmHold() names the order; cancelReservation() names the order and may say who and why; assignUnits() names the order and the rental, and with no units fills a shortage", async () => {
    const { db, calls } = fake({ data: done, error: null });
    await confirmHold(db, T, "b");
    await cancelReservation(db, T, { bookingId: "b" });
    await cancelReservation(db, T, {
      bookingId: "b",
      cancelledBy: "customer",
      reason: "no_show",
    });
    await assignUnits(db, T, { bookingId: "b", rentalId: "n" });
    await assignUnits(db, T, { bookingId: "b", rentalId: "n" }, ["u1", "u2"]);
    // An empty list is sent as it is: it is not "no units named".
    await assignUnits(db, T, { bookingId: "b", rentalId: "n" }, []);
    expect(calls).toEqual([
      { fn: "confirm_order", args: { p_tenant_id: T, p_order_id: "b" } },
      { fn: "cancel_order", args: { p_tenant_id: T, p_order_id: "b" } },
      {
        fn: "cancel_order",
        args: {
          p_tenant_id: T,
          p_order_id: "b",
          p_cancelled_by: "customer",
          p_cancel_reason: "no_show",
        },
      },
      {
        fn: "assign_order_units",
        args: { p_tenant_id: T, p_order_id: "b", p_rental_id: "n" },
      },
      {
        fn: "assign_order_units",
        args: {
          p_tenant_id: T,
          p_order_id: "b",
          p_rental_id: "n",
          p_unit_ids: ["u1", "u2"],
        },
      },
      {
        fn: "assign_order_units",
        args: {
          p_tenant_id: T,
          p_order_id: "b",
          p_rental_id: "n",
          p_unit_ids: [],
        },
      },
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
