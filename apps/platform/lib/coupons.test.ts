/**
 * The coupon's way from the database to decideDiscounts(), quote() and
 * reserve() (lib/coupons.ts, lib/staff-booking.ts, lib/coupon-save.ts).
 * tests/db/coupons.test.ts holds the same against real rows.
 */
import { describe, expect, it } from "vitest";
import { quote } from "@mango/core/quote";
import type { BookingInputs } from "./booking-inputs";
import {
  codeGiven,
  couponFoundOf,
  couponOutcomeOf,
  couponRequestOf,
  couponUseOf,
  decideFor,
  readCoupon,
  returningCustomerOf,
  type CouponInputs,
} from "./coupons";
import {
  COUPON_SAVE_REASONS,
  saveCoupon,
  type CouponSaveDb,
} from "./coupon-save";
import { quoteInputFor, type PricingInputs } from "./pricing-inputs";
import { bookAsStaff, reserveAsStaff, type StaffDb } from "./staff-booking";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PLACE = "22222222-2222-4222-8222-222222222222";
const SCOOTER = "33333333-3333-4333-8333-333333333333";
const HELMET = "66666666-6666-4666-8666-666666666666";
const COUPON = "44444444-4444-4444-8444-444444444444";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";

const start = new Date("2026-06-15T03:00:00Z");
const end = new Date("2026-06-17T03:00:00Z");
const now = new Date("2026-06-01T03:00:00Z");

const product = (
  id: string,
  type: "vehicle" | "gear",
  amount: string | null,
): PricingInputs["products"][number] => ({
  product_id: id,
  product_name: type,
  product_type: type,
  currency: "THB",
  pricing_method: amount === null ? null : "per_period",
  price_amount: amount,
  price_period: amount === null ? null : "day",
  base_amount: null,
  long_stay_day: null,
  deposit: null,
  replacement_price: null,
  taxable: false,
  tax_rate_bp: null,
  tax_profile_id: null,
  tax_profile_name: null,
  template: null,
});

/** A scooter at ฿300.00 a day and a helmet at ฿50.00 a day; coupons on. */
const pricing = (
  settings: Partial<NonNullable<PricingInputs["settings"]>> = {},
  scooter: string | null = "30000",
): PricingInputs => ({
  settings: {
    currency: "THB",
    rounding_step: null,
    tax_inclusive: true,
    coupons_enabled: true,
    deposit_mode: "none",
    deposit_percent_bp: null,
    deposit_amount: null,
    default_tax_profile_id: null,
    returning_enabled: false,
    returning_percent_bp: null,
    returning_rentals_needed: 1,
    ...settings,
  },
  products: [product(SCOOTER, "vehicle", scooter), product(HELMET, "gear", "5000")],
  seasons: [],
  extras: [],
});

const row = (
  over: Partial<NonNullable<CouponInputs["coupon"]>> = {},
  uses = { total: 0, customer: 0 },
): CouponInputs => ({
  coupon: {
    id: COUPON,
    code: "SAVE200",
    name: "Two hundred off",
    currency: "THB",
    kind: "fixed",
    percent_bp: null,
    amount: "20000",
    all_products: false,
    product_ids: [SCOOTER],
    valid_from: "2026-01-01",
    valid_to: null,
    pickup_from: null,
    pickup_to: null,
    min_days: null,
    min_spend: "50000",
    max_uses: 3,
    max_uses_per_customer: 1,
    channels: ["staff", "booking_page"],
    with_returning_discount: true,
    with_season_discount: true,
    active: true,
    archived: false,
    ...over,
  },
  uses,
});

const invoice = (inputs: PricingInputs) =>
  quoteInputFor(inputs, [
    {
      id: "0",
      productId: SCOOTER,
      quantity: 1,
      span: { start, end, timeZone: "Asia/Bangkok" },
    },
    {
      id: "1",
      productId: HELMET,
      quantity: 2,
      span: { start, end, timeZone: "Asia/Bangkok" },
    },
  ]);

const ask = (
  inputs: PricingInputs,
  more: Partial<Parameters<typeof decideFor>[0]> = {},
) =>
  decideFor({
    pricing: inputs,
    quote: invoice(inputs),
    now,
    timeZone: "Asia/Bangkok",
    channel: "walk_in",
    ...more,
  });

describe("from platform.coupon_inputs() to decideDiscounts()", () => {
  it("couponFoundOf(): every setting under its name, amounts as bigint, and the uses", () => {
    expect(couponFoundOf(row({}, { total: 2, customer: 1 }))).toEqual({
      settings: {
        id: COUPON,
        code: "SAVE200",
        currency: "THB",
        kind: "fixed",
        percentBp: null,
        amount: BigInt(20000),
        allProducts: false,
        productIds: [SCOOTER],
        validFrom: "2026-01-01",
        validTo: null,
        pickupFrom: null,
        pickupTo: null,
        minDays: null,
        minSpend: BigInt(50000),
        maxUses: 3,
        maxUsesPerCustomer: 1,
        channels: ["staff", "booking_page"],
        withReturningDiscount: true,
        withSeasonDiscount: true,
        active: true,
        archived: false,
      },
      uses: { total: 2, customer: 1 },
    });
    expect(couponFoundOf({ coupon: null, uses: null })).toBeNull();
    expect(couponFoundOf(null)).toBeNull();
    // An amount that is not a string of digits is not money.
    expect(() => couponFoundOf(row({ amount: "200.00" }))).toThrow(RangeError);
  });

  it("returningCustomerOf(): the three settings; never saved, or no percentage, is off", () => {
    expect(returningCustomerOf(null)).toBeNull();
    expect(returningCustomerOf(pricing().settings)).toBeNull();
    expect(
      returningCustomerOf(
        pricing({
          returning_enabled: true,
          returning_percent_bp: 1000,
          returning_rentals_needed: 3,
        }).settings,
      ),
    ).toEqual({ enabled: true, percentBp: 1000, completedRentalsNeeded: 3 });
    // A read from before stage 8 has none of the three.
    const old = { ...pricing().settings! };
    delete old.returning_enabled;
    delete old.returning_percent_bp;
    delete old.returning_rentals_needed;
    expect(returningCustomerOf(old)).toBeNull();
  });

  it("codeGiven(): something must be left of it once spaces and invisible characters are gone", () => {
    expect(codeGiven("save200")).toBe(true);
    for (const empty of [undefined, null, "", "   ", "\u00a0\u200b\t"]) {
      expect(codeGiven(empty), JSON.stringify(empty)).toBe(false);
    }
  });

  it("readCoupon(): one call, the code as typed; the booking priced again and the customer are passed; an error is thrown with its code", async () => {
    const calls: Record<string, unknown>[] = [];
    const answer = row();
    const db = {
      rpc(_fn: "coupon_inputs", args: Record<string, unknown>) {
        calls.push(args);
        return Promise.resolve({ data: answer, error: null });
      },
    };
    expect(await readCoupon(db, TENANT, " save 200 ")).toBe(answer);
    await readCoupon(db, TENANT, "x", { bookingId: "b", customerId: CUSTOMER });
    expect(calls).toEqual([
      {
        p_tenant_id: TENANT,
        p_code: " save 200 ",
        p_booking_id: null,
        p_customer_id: null,
      },
      {
        p_tenant_id: TENANT,
        p_code: "x",
        p_booking_id: "b",
        p_customer_id: CUSTOMER,
      },
    ]);
    await expect(
      readCoupon(
        {
          rpc: () =>
            Promise.resolve({
              data: null,
              error: { code: "57014", message: "timeout" },
            }),
        },
        TENANT,
        "x",
      ),
    ).rejects.toMatchObject({ code: "57014" });
  });
});

describe("a code that could not be a coupon's is never sent to the database", () => {
  const nul = `SAVE${String.fromCharCode(0)}10`;
  const surrogate = `SAVE${String.fromCharCode(0xd83c)}10`;
  const never = {
    rpc(): never {
      throw new Error("coupon_inputs() was called");
    },
  };

  it("readCoupon(): a NUL, a lone surrogate, a hyphen, a sharp s, 41 letters: no call, and no coupon", async () => {
    for (const typed of [
      nul,
      surrogate,
      "summer-10",
      `stra${String.fromCharCode(0xdf)}e`,
      "a".repeat(41),
    ]) {
      expect(
        await readCoupon(never, TENANT, typed, { bookingId: "b" }),
        JSON.stringify(typed),
      ).toEqual({ coupon: null, uses: null });
    }
  });

  it("decideFor() then answers unknown for it, and the price is the one without a code", async () => {
    const inputs = pricing();
    for (const typed of [nul, surrogate]) {
      const decided = ask(inputs, {
        code: typed,
        coupon: await readCoupon(never, TENANT, typed),
      });
      expect(decided.decision).toMatchObject({
        outcome: "refused",
        reason: "unknown",
      });
    }
  });

  it("bookAsStaff(): the booking is refused with coupon_refused, unknown; nothing is read for the code and nothing is reserved", async () => {
    for (const typed of [nul, surrogate]) {
      const s = staffDb({});
      expect(
        await bookAsStaff(s.db, TENANT, counter({ couponCode: typed })),
      ).toEqual({ ok: false, reason: "coupon_refused", coupon: "unknown" });
      expect(s.called().sort()).toEqual(["booking_inputs", "pricing_inputs"]);
    }
  });
});

describe("decideFor() and what reserve() is handed", () => {
  it("a coupon for the scooter alone: taken on its line, and the use is what the quote says it took", () => {
    const inputs = pricing();
    const decided = ask(inputs, { code: "save 200", coupon: row() });
    expect(decided.decision.outcome).toBe("decided");
    const priced = quote(decided.quote);
    if (!priced.ok) throw new Error("not priced");
    // ฿600 for the scooter less ฿200; the helmets (2 × 2 days × ฿50) as they are.
    expect(priced.lines.map((line) => line.amount)).toEqual([
      BigInt(40000),
      BigInt(20000),
    ]);
    const use = couponUseOf(decided.decision, priced);
    expect(use).toEqual({ couponId: COUPON, amount: BigInt(20000) });
    expect(couponRequestOf(use!)).toEqual({
      coupon_id: COUPON,
      amount: "20000",
    });
    expect(
      couponRequestOf(couponUseOf(decided.decision, priced, CUSTOMER)!),
    ).toEqual({ coupon_id: COUPON, amount: "20000", customer_id: CUSTOMER });
    expect(couponOutcomeOf(decided.decision)).toMatchObject({
      applied: true,
      code: "SAVE200",
    });
  });

  it("the amount is added up from the quote's lines by the coupon's discount id: a percentage over two lines beside the returning-customer discount", () => {
    const inputs = pricing({
      returning_enabled: true,
      returning_percent_bp: 1000,
    });
    const decided = ask(inputs, {
      code: "SAVE200",
      coupon: row({
        kind: "percent",
        percent_bp: 2000,
        amount: null,
        all_products: true,
        product_ids: [],
        min_spend: null,
      }),
      completedRentals: 1,
    });
    const priced = quote(decided.quote);
    if (!priced.ok) throw new Error("not priced");
    // 10% returning first: ฿540 and ฿180 left; then 20%: ฿108 and ฿36.
    expect(couponUseOf(decided.decision, priced)!.amount).toBe(BigInt(14400));
    expect(priced.totals.discount).toBe(BigInt(8000 + 14400));
  });

  it("refused: the reason, the price without the code, and no use", () => {
    const inputs = pricing();
    const decided = ask(inputs, {
      code: "SAVE200",
      coupon: row({}, { total: 3, customer: 0 }),
    });
    expect(decided.decision).toMatchObject({
      outcome: "refused",
      reason: "used_up",
    });
    const priced = quote(decided.quote);
    if (!priced.ok) throw new Error("not priced");
    expect(priced.totals.discount).toBe(BigInt(0));
    expect(couponUseOf(decided.decision, priced)).toBeNull();
    expect(couponOutcomeOf(decided.decision)).toBeNull();
    // A code the shop does not have.
    expect(
      ask(inputs, { code: "NOPE", coupon: { coupon: null, uses: null } })
        .decision,
    ).toMatchObject({ outcome: "refused", reason: "unknown" });
  });

  it("not applied (it would take nothing, or the returning discount is better): no use to write", () => {
    // The scooter is free with the 100% returning discount it stacks on.
    const inputs = pricing({
      returning_enabled: true,
      returning_percent_bp: 10000,
    });
    const decided = ask(inputs, {
      code: "SAVE200",
      coupon: row({ min_spend: null }),
      completedRentals: 1,
    });
    expect(couponOutcomeOf(decided.decision)).toMatchObject({
      applied: false,
      because: "takes_nothing",
    });
    const priced = quote(decided.quote);
    if (!priced.ok) throw new Error("not priced");
    expect(couponUseOf(decided.decision, priced)).toBeNull();
  });

  it("no code: decided with no coupon; a line with no price is left for quote() to name", () => {
    const decided = ask(pricing());
    expect(decided.decision).toMatchObject({ outcome: "decided", coupon: null });
    const unpriced = pricing({}, null);
    const stuck = ask(unpriced, { code: "SAVE200", coupon: row() });
    expect(stuck.decision.outcome).toBe("cant_price");
    expect(stuck.quote).toEqual(invoice(unpriced));
  });
});

// ------------------------------------------------------------- staff path

type Reply = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

const bookingInputs = {
  location: { id: PLACE, timezone: "Asia/Bangkok" },
} as unknown as BookingInputs;

function staffDb(scene: {
  pricing?: PricingInputs;
  coupon?: CouponInputs;
  reserve?: Reply;
}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: StaffDb = {
    rpc(fn, args) {
      calls.push({ fn, args });
      const answers: Record<string, Reply> = {
        booking_inputs: { data: bookingInputs, error: null },
        pricing_inputs: { data: scene.pricing ?? pricing(), error: null },
        coupon_inputs: {
          data: scene.coupon ?? { coupon: null, uses: null },
          error: null,
        },
        reserve: scene.reserve ?? {
          data: {
            ok: true,
            booking_id: "b-1",
            lines: [{ reservation_id: "r-1", unit_ids: ["u-1"], shortage: 0 }],
          },
          error: null,
        },
      };
      return Promise.resolve(answers[fn]);
    },
  };
  const called = () => calls.map((call) => call.fn);
  return { db, calls, called };
}

const counter = (over: Partial<Parameters<typeof bookAsStaff>[2]> = {}) => ({
  channel: "walk_in" as const,
  locationId: PLACE,
  lines: [{ productId: SCOOTER, start, end, quantity: 1 }],
  now,
  ...over,
});

describe("bookAsStaff(): a counter booking with a coupon", () => {
  it("a good code: decided, priced by quote(), and reserve() is handed the coupon with what it took, as the member", async () => {
    const s = staffDb({ coupon: row() });
    const answer = await bookAsStaff(
      s.db,
      TENANT,
      counter({ couponCode: "save200", customerId: CUSTOMER }),
    );
    expect(s.called().at(-1)).toBe("reserve");
    expect(s.called().slice(0, -1).sort()).toEqual([
      "booking_inputs",
      "coupon_inputs",
      "pricing_inputs",
    ]);
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.quote.totals.total).toBe(BigInt(40000));
    expect(answer.coupon).toMatchObject({ applied: true, couponId: COUPON });
    expect(s.calls.at(-1)!.args).toEqual({
      p_tenant_id: TENANT,
      p_request: {
        channel: "walk_in",
        mode: "staff",
        hold: false,
        lines: [
          {
            product_id: SCOOTER,
            location_id: PLACE,
            starts_at: start.toISOString(),
            ends_at: end.toISOString(),
            quantity: 1,
          },
        ],
        coupon: { coupon_id: COUPON, amount: "20000", customer_id: CUSTOMER },
      },
    });
  });

  it("no code: the coupon is never read and reserve() is sent none; a staff discount still prices", async () => {
    const s = staffDb({});
    const answer = await bookAsStaff(
      s.db,
      TENANT,
      counter({
        discounts: [
          { id: "staff", source: "staff", lines: "all", amount: BigInt(10000) },
        ],
      }),
    );
    expect(s.called()).not.toContain("coupon_inputs");
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.coupon).toBeNull();
    expect(answer.quote.totals.total).toBe(BigInt(50000));
    expect(s.calls.at(-1)!.args.p_request).not.toHaveProperty("coupon");
  });

  it("a refused code books nothing and says why; a product with no price books nothing", async () => {
    const refused = staffDb({ coupon: row({ channels: ["booking_page"] }) });
    expect(
      await bookAsStaff(refused.db, TENANT, counter({ couponCode: "SAVE200" })),
    ).toEqual({ ok: false, reason: "coupon_refused", coupon: "wrong_channel" });
    expect(refused.called()).not.toContain("reserve");

    const unpriced = staffDb({ pricing: pricing({}, null) });
    expect(await bookAsStaff(unpriced.db, TENANT, counter())).toEqual({
      ok: false,
      reason: "cant_be_priced",
      line: 0,
    });
    expect(unpriced.called()).not.toContain("reserve");
  });

  it("what reserve() answers is passed on: used up or changed under the lock, and a lock not had in time is try_again", async () => {
    for (const reason of ["coupon_used_up", "coupon_not_valid"]) {
      const s = staffDb({
        coupon: row(),
        reserve: { data: { ok: false, reason, line: null }, error: null },
      });
      expect(
        await bookAsStaff(s.db, TENANT, counter({ couponCode: "SAVE200" })),
      ).toEqual({ ok: false, reason, line: null });
    }
    for (const code of ["55P03", "57014"]) {
      const s = staffDb({
        coupon: row(),
        reserve: { data: null, error: { code, message: "timeout" } },
      });
      expect(
        await bookAsStaff(s.db, TENANT, counter({ couponCode: "SAVE200" })),
      ).toEqual({ ok: false, reason: "try_again" });
    }
  });

  it("reserveAsStaff() sends a coupon only when it is given one", async () => {
    const s = staffDb({});
    const line = { productId: SCOOTER, locationId: PLACE, start, end, quantity: 1 };
    await reserveAsStaff(s.db, TENANT, { channel: "phone", lines: [line] });
    await reserveAsStaff(s.db, TENANT, {
      channel: "phone",
      lines: [line],
      coupon: null,
    });
    await reserveAsStaff(s.db, TENANT, {
      channel: "phone",
      lines: [line],
      coupon: { couponId: COUPON, amount: BigInt(1) },
    });
    const sent = s.calls.map(
      (call) => (call.args.p_request as { coupon?: unknown }).coupon,
    );
    expect(sent).toEqual([
      undefined,
      undefined,
      { coupon_id: COUPON, amount: "1" },
    ]);
  });
});

// ------------------------------------------------------------ save_coupon

describe("saveCoupon(): the answers of platform.save_coupon()", () => {
  const db = (reply: Reply) => {
    const calls: unknown[] = [];
    const client: CouponSaveDb = {
      rpc(fn, args) {
        calls.push([fn, args]);
        return Promise.resolve(reply);
      },
    };
    return { client, calls };
  };

  it("saved: the coupon as the database answers it, sent under the database's names", async () => {
    const saved = { id: COUPON, code: "SUMMER10", product_ids: [] };
    const s = db({ data: saved, error: null });
    expect(
      await saveCoupon(s.client, TENANT, {
        code: "summer 10",
        kind: "percent",
        percent_bp: 1000,
      }),
    ).toEqual({ ok: true, coupon: saved });
    expect(s.calls).toEqual([
      [
        "save_coupon",
        {
          p_tenant_id: TENANT,
          p_coupon: { code: "summer 10", kind: "percent", percent_bp: 1000 },
        },
      ],
    ]);
  });

  it("a lock that could not be had in time (55P03), a statement the API ended (57014), or a deadlock Postgres broke (40P01), is try_again: nothing was written", async () => {
    for (const code of ["55P03", "57014", "40P01"]) {
      expect(
        await saveCoupon(
          db({ data: null, error: { code, message: "canceling statement" } })
            .client,
          TENANT,
          { id: COUPON, active: false },
        ),
      ).toEqual({ ok: false, reason: "try_again" });
    }
  });

  it("each refusal the database names is an answer; anything else is thrown with its code", async () => {
    expect(COUPON_SAVE_REASONS).toEqual([
      "only_owner_or_manager",
      "invalid_coupon",
      "invalid_code",
      "code_taken",
      "coupon_not_found",
      "product_not_found",
    ]);
    for (const reason of COUPON_SAVE_REASONS) {
      expect(
        await saveCoupon(
          db({ data: null, error: { code: "P0001", message: reason } }).client,
          TENANT,
          {},
        ),
      ).toEqual({ ok: false, reason });
    }
    await expect(
      saveCoupon(
        db({ data: null, error: { code: "23514", message: "check" } }).client,
        TENANT,
        {},
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
