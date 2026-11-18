/**
 * Phase 2 stage 9: the coupon screens' pure parts. The coupon form's
 * validation and payload (lib/coupon-form.ts), the words for every refusal
 * (lib/coupon-words.ts) in both languages, the History lines
 * (lib/coupon-history.ts), the returning-customer card
 * (lib/pricing-settings.ts) and "Check a price" with extras, a code and the
 * returning-customer tick (lib/pricing-preview.ts' checkPrice()).
 */
import { describe, expect, it } from "vitest";
import { COUPON_CODE_CASES } from "@mango/core/coupon-code.cases";
import en from "../messages/en.json";
import th from "../messages/th.json";
import {
  codePreview,
  couponDraft,
  couponPayload,
  couponSaveError,
  couponStatus,
  couponUsesText,
  emptyCouponDraft,
  type CouponDraft,
  type CouponRecord,
} from "./coupon-form";
import { COUPON_SAVE_REASONS } from "./coupon-save";
import { couponHistory } from "./coupon-history";
import {
  bookingRefusalKey,
  bookingRefusals,
  couponRefusals,
  dayText,
  notAppliedKey,
  refusalKey,
  refusalWords,
} from "./coupon-words";
import type { CouponInputs, CouponRow } from "./coupons";
import type { AuditRow } from "./history";
import { emptyBoxes, type PricingContext } from "./pricing-form";
import type { PricingInputs, ProductPricingRow } from "./pricing-inputs";
import { checkPrice, draftRow, sampleSpan } from "./pricing-preview";
import { settingsDraft, settingsPayload } from "./pricing-settings";

const n = (value: number) => BigInt(value);

// ------------------------------------------------------------ the form

const draft = (change: Partial<CouponDraft> = {}): CouponDraft => ({
  ...emptyCouponDraft(),
  code: "summer 10",
  percent: "10",
  channels: ["staff"],
  ...change,
});

describe("the coupon form: what is checked before saving", () => {
  it("a new coupon starts as the database does: percentage, all products, season discounts on, no stacking, no channel", () => {
    expect(emptyCouponDraft()).toMatchObject({
      kind: "percent",
      allProducts: true,
      withSeasonDiscount: true,
      withReturningDiscount: false,
      channels: [],
    });
  });

  it("a full payload: the code as stored, the percentage in basis points, blanks as null, no uses per customer", () => {
    const result = couponPayload(draft(), "THB");
    expect(result).toEqual({
      ok: true,
      payload: {
        code: "SUMMER10",
        name: "",
        kind: "percent",
        percent_bp: 1000,
        amount: null,
        all_products: true,
        valid_from: null,
        valid_to: null,
        pickup_from: null,
        pickup_to: null,
        min_days: null,
        min_spend: null,
        max_uses: null,
        channels: ["staff"],
        with_returning_discount: false,
        with_season_discount: true,
      },
    });
    expect(result.ok && "max_uses_per_customer" in result.payload).toBe(false);
  });

  it("a fixed amount and a minimum spend in the shop's currency and exponent: THB ×100, JPY ×1", () => {
    const thb = couponPayload(
      draft({ kind: "fixed", amount: "200.50", minSpend: "1,000" }),
      "THB",
    );
    expect(thb.ok && [thb.payload.amount, thb.payload.min_spend]).toEqual([
      "20050",
      "100000",
    ]);
    const jpy = couponPayload(
      draft({ kind: "fixed", amount: "500", minSpend: "3000" }),
      "JPY",
    );
    expect(jpy.ok && [jpy.payload.amount, jpy.payload.min_spend]).toEqual([
      "500",
      "3000",
    ]);
    // Yen has no minor unit: a decimal is refused.
    expect(couponPayload(draft({ kind: "fixed", amount: "5.5" }), "JPY")).toEqual(
      { ok: false, errors: { amount: "invalidMoney" } },
    );
    // A percentage coupon sends no amount, a fixed one no percentage.
    const fixed = couponPayload(draft({ kind: "fixed", amount: "1" }), "THB");
    expect(fixed.ok && fixed.payload.percent_bp).toBeNull();
  });

  it("every other setting: chosen products, both date ranges, minimum days, total uses, channels and the two ticks", () => {
    const result = couponPayload(
      draft({
        id: undefined,
        allProducts: false,
        productIds: ["b", "a", "b"],
        validFrom: "2027-01-01",
        validTo: "2027-01-31",
        pickupFrom: "2027-02-01",
        pickupTo: "2027-02-28",
        minDays: "3",
        maxUses: "50",
        channels: ["marketplace", "staff", "booking_page"],
        withReturningDiscount: true,
        withSeasonDiscount: false,
      } as Partial<CouponDraft>),
      "THB",
      "id-1",
    );
    expect(result.ok && result.payload).toMatchObject({
      id: "id-1",
      all_products: false,
      product_ids: ["b", "a"],
      valid_from: "2027-01-01",
      valid_to: "2027-01-31",
      pickup_from: "2027-02-01",
      pickup_to: "2027-02-28",
      min_days: 3,
      max_uses: 50,
      channels: ["staff", "booking_page", "marketplace"],
      with_returning_discount: true,
      with_season_discount: false,
    });
  });

  it("each mistake on its own box, in words the form shows", () => {
    const cases: [Partial<CouponDraft>, Record<string, string>][] = [
      [{ code: "" }, { code: "required" }],
      [{ code: "   " }, { code: "required" }],
      [{ code: "ส่วนลด" }, { code: "couponInvalidCode" }],
      [{ code: "ＡＢＣ" }, { code: "couponInvalidCode" }],
      [{ code: "SUMMER-10" }, { code: "couponInvalidCode" }],
      [{ code: "A".repeat(41) }, { code: "couponInvalidCode" }],
      [{ name: "x".repeat(121) }, { name: "tooLong" }],
      [{ percent: "" }, { percent: "required" }],
      [{ percent: "abc" }, { percent: "invalidPercent" }],
      [{ percent: "0" }, { percent: "percentZero" }],
      [{ percent: "100.01" }, { percent: "couponPercentTooLarge" }],
      [{ kind: "fixed", amount: "" }, { amount: "required" }],
      [{ kind: "fixed", amount: "0" }, { amount: "couponAmountZero" }],
      [{ kind: "fixed", amount: "1.234" }, { amount: "invalidMoney" }],
      [{ allProducts: false, productIds: [] }, { products: "couponNoProducts" }],
      [{ validFrom: "2027-02-30" }, { validFrom: "invalidDate" }],
      [
        { validFrom: "2027-02-01", validTo: "2027-01-31" },
        { validTo: "couponDatesOrder" },
      ],
      [
        { pickupFrom: "2027-02-01", pickupTo: "2027-01-31" },
        { pickupTo: "couponDatesOrder" },
      ],
      [{ minDays: "0" }, { minDays: "couponMinDaysRange" }],
      [{ minDays: "1001" }, { minDays: "couponMinDaysRange" }],
      [{ minDays: "2.5" }, { minDays: "couponMinDaysRange" }],
      [{ minSpend: "0" }, { minSpend: "couponAmountZero" }],
      [{ minSpend: "x" }, { minSpend: "invalidMoney" }],
      [{ maxUses: "0" }, { maxUses: "couponMaxUsesRange" }],
      [{ maxUses: "2000000001" }, { maxUses: "couponMaxUsesRange" }],
      [{ channels: [] }, { channels: "couponNoChannels" }],
    ];
    for (const [change, errors] of cases)
      expect(couponPayload(draft(change), "THB"), JSON.stringify(change)).toEqual(
        { ok: false, errors },
      );
    // At the edges: 100%, 1,000 days, the same first and last day.
    expect(
      couponPayload(
        draft({
          percent: "100",
          minDays: "1000",
          validFrom: "2027-01-01",
          validTo: "2027-01-01",
          maxUses: "2000000000",
        }),
        "THB",
      ).ok,
    ).toBe(true);
  });

  it("the code is shown as it will be stored, and said to be impossible, by the same rule the database uses", () => {
    expect(codePreview("")).toBeNull();
    expect(codePreview("  ")).toBeNull();
    expect(codePreview("summer 10")).toEqual({ stored: "SUMMER10", ok: true });
    expect(codePreview("ทดสอบ")).toEqual({ stored: "ทดสอบ", ok: false });
    // The shared cases of stage 8: whatever the database stores, the form
    // accepts; whatever it refuses, the form refuses.
    for (const c of COUPON_CODE_CASES) {
      const preview = codePreview(c.typed);
      if (!c.accepted) {
        if (preview) expect(preview.ok, c.what).toBe(false);
      } else {
        expect(preview, c.what).toEqual({ stored: c.normalized, ok: true });
      }
    }
  });

  it("a saved coupon back on the form, and saved again unchanged", () => {
    const row: CouponRecord = {
      id: "c1",
      code: "SAVE200",
      name: "Flyer",
      currency: "THB",
      kind: "fixed",
      percent_bp: null,
      amount: "20000",
      all_products: false,
      product_ids: ["p1"],
      valid_from: "2027-01-01",
      valid_to: null,
      pickup_from: null,
      pickup_to: "2027-03-01",
      min_days: 2,
      min_spend: "150050",
      max_uses: 50,
      channels: ["booking_page", "staff"],
      with_returning_discount: true,
      with_season_discount: false,
      active: true,
      archived_at: null,
    };
    const shown = couponDraft(row);
    expect(shown).toMatchObject({
      amount: "200.00",
      minSpend: "1500.50",
      minDays: "2",
      maxUses: "50",
      channels: ["staff", "booking_page"],
    });
    const again = couponPayload(shown, "THB", "c1");
    expect(again.ok && again.payload).toMatchObject({
      code: "SAVE200",
      amount: "20000",
      min_spend: "150050",
      product_ids: ["p1"],
      valid_to: null,
      pickup_to: "2027-03-01",
    });
    expect(
      couponDraft({ ...row, kind: "percent", percent_bp: 1250, amount: null })
        .percent,
    ).toBe("12.5");
  });

  it("every refusal of save_coupon() has a place and words; a code refusal sits under the code box", () => {
    for (const reason of [...COUPON_SAVE_REASONS, "try_again" as const]) {
      const { field, key } = couponSaveError(reason);
      expect(field, reason).toBe(
        reason === "invalid_code" || reason === "code_taken" ? "code" : "form",
      );
      expect(en.FormErrors, reason).toHaveProperty(key);
      expect(th.FormErrors, reason).toHaveProperty(key);
    }
    expect(couponSaveError("try_again").key).toBe("couponTryAgain");
    expect(en.FormErrors.couponTryAgain).toMatch(/save again/);
    // invalid_code says which characters, and that Thai and full-width can't.
    expect(en.FormErrors.couponInvalidCode).toMatch(/A to Z/);
    expect(en.FormErrors.couponInvalidCode).toMatch(/0 to 9/);
    expect(en.FormErrors.couponInvalidCode).toMatch(/Thai letters/);
    expect(en.FormErrors.couponInvalidCode).toMatch(/full-width/);
    // code_taken names the clash.
    expect(en.FormErrors.couponCodeTaken).toContain("{code}");
    expect(en.FormErrors.couponCodeTakenBy).toContain("{name}");
  });

  it("the list's state and uses: on, off, archived; 12 of 50, 12, or not known", () => {
    expect(couponStatus({ active: true, archived_at: null })).toBe("on");
    expect(couponStatus({ active: false, archived_at: null })).toBe("off");
    expect(couponStatus({ active: true, archived_at: "2027-01-01" })).toBe(
      "archived",
    );
    expect(couponUsesText(12, 50)).toEqual({ kind: "ofLimit", used: 12, limit: 50 });
    expect(couponUsesText(12, null)).toEqual({ kind: "noLimit", used: 12 });
    expect(couponUsesText(null, 50)).toEqual({ kind: "unknown" });
  });
});

// ------------------------------------------------------------- the words

describe("the words for every coupon answer", () => {
  it("every decideDiscounts() refusal has a sentence, in both languages", () => {
    expect(couponRefusals).toHaveLength(12);
    expect(new Set(Object.keys(refusalKey))).toEqual(new Set(couponRefusals));
    for (const reason of couponRefusals) {
      const key = refusalKey[reason] as keyof typeof en.Pricing.coupon.refused;
      expect(en.Pricing.coupon.refused[key], reason).toMatch(/^Not applied/);
      expect(th.Pricing.coupon.refused[key], reason).toBeTruthy();
    }
    for (const because of ["takes_nothing", "returning_discount_is_better"] as const) {
      const key = notAppliedKey(because) as keyof typeof en.Pricing.coupon.notApplied;
      expect(en.Pricing.coupon.notApplied[key]).toMatch(/not applied/);
      expect(th.Pricing.coupon.notApplied[key]).toBeTruthy();
    }
    expect(en.Pricing.coupon.notApplied.returningIsLarger).toMatch(
      /the larger discount applies/,
    );
    expect(en.Pricing.coupon.appliedInstead).toMatch(/the larger discount applies/);
  });

  it("a refusal names what the coupon itself set: its days, its pickup dates, its minimum", () => {
    const coupon = {
      validFrom: "2027-01-01",
      validTo: "2027-01-31",
      pickupFrom: "2027-02-01",
      pickupTo: null,
      minDays: 3,
      minSpend: n(100000),
    };
    expect(refusalWords("too_early", coupon)).toEqual({
      key: "tooEarly",
      values: { from: "2027-01-01" },
    });
    expect(refusalWords("expired", coupon).values).toEqual({ to: "2027-01-31" });
    expect(refusalWords("wrong_dates", coupon)).toEqual({
      key: "wrongDatesFrom",
      values: { from: "2027-02-01" },
    });
    expect(
      refusalWords("wrong_dates", { ...coupon, pickupTo: "2027-02-28" }).key,
    ).toBe("wrongDatesBetween");
    expect(
      refusalWords("wrong_dates", { ...coupon, pickupFrom: null, pickupTo: "2027-02-28" }).key,
    ).toBe("wrongDatesUntil");
    expect(refusalWords("too_short", coupon).values).toEqual({ days: 3 });
    expect(refusalWords("below_minimum", coupon).values).toEqual({
      amount: n(100000),
    });
    expect(refusalWords("unknown", null)).toEqual({ key: "unknown", values: {} });
    for (const key of ["wrongDatesBetween", "wrongDatesFrom", "wrongDatesUntil"] as const) {
      expect(en.Pricing.coupon.refused[key]).toBeTruthy();
      expect(th.Pricing.coupon.refused[key]).toBeTruthy();
    }
  });

  it("reserve() and confirm_hold(): hold_expired, coupon_not_valid and coupon_used_up have shared words", () => {
    expect(bookingRefusals).toEqual(["hold_expired", "coupon_not_valid", "coupon_used_up"]);
    for (const reason of bookingRefusals) {
      expect(bookingRefusalKey(reason)).toBe(reason);
      expect(en.FormErrors[reason]).toBeTruthy();
      expect(th.FormErrors[reason]).toBeTruthy();
    }
    expect(en.FormErrors.hold_expired).toBe(
      "This hold has run out; make the booking again.",
    );
    expect(en.FormErrors.coupon_not_valid).toBe(
      "This coupon can’t be used right now; send it again.",
    );
    expect(bookingRefusalKey("no_stock")).toBeNull();
  });

  it("a coupon's day in the viewer's locale, without a time zone moving it", () => {
    expect(dayText("2027-01-01", "en-GB")).toBe("1 Jan 2027");
    expect(dayText("2027-12-31", "en-US")).toBe("Dec 31, 2027");
    expect(dayText("not a day", "en")).toBe("not a day");
  });

  it("every new string is in both languages, with the same placeholders", () => {
    const flat = (o: object, prefix = ""): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "string"
          ? [[prefix + k, v] as [string, string]]
          : flat(v as object, `${prefix}${k}.`),
      );
    const holes = (text: string) =>
      [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
    const groups: [object, object][] = [
      [en.Settings.coupons, th.Settings.coupons],
      [en.Settings.pricing.returning, th.Settings.pricing.returning],
      [en.Pricing.coupon, th.Pricing.coupon],
      [en.Pricing.check, th.Pricing.check],
      [en.FormErrors, th.FormErrors],
    ];
    for (const [english, thai] of groups) {
      const theirs = new Map(flat(thai));
      expect([...theirs.keys()].sort()).toEqual(flat(english).map(([k]) => k).sort());
      for (const [key, text] of flat(english))
        expect(holes(theirs.get(key) ?? ""), key).toEqual(holes(text));
    }
    expect(en.Settings.nav.coupons).toBe("Coupons");
    expect(th.Settings.nav.coupons).toBe("คูปอง");
    // The "later update" line is gone from the coupons switch.
    expect(en.Settings.pricing.coupons).not.toHaveProperty("later");
    expect(th.Settings.pricing.coupons).not.toHaveProperty("later");
    expect(JSON.stringify(en)).not.toContain("in a later update");
    // "Uses per customer" is not promised anywhere yet.
    expect(JSON.stringify(en.Settings.coupons).toLowerCase()).not.toContain(
      "per customer",
    );
  });
});

// ------------------------------------------------------------- History

const audit = (
  id: number,
  at: string,
  action: string,
  before: unknown,
  after: unknown,
  entity_id = "c1",
): AuditRow => ({ id, entity: "coupons", entity_id, action, actor: "u1", before, after, at });

describe("coupon History: the buttons' words, one action a line", () => {
  const created = {
    code: "SUMMER10",
    kind: "percent",
    percent_bp: 1000,
    amount: null,
    all_products: false,
    active: true,
    archived_at: null,
  };
  const rows: AuditRow[] = [
    audit(1, "2027-01-01T00:00:00Z", "insert", null, created),
    audit(2, "2027-01-01T00:00:00Z", "coupon_change", { products: [] }, { products: ["a", "b"] }),
    audit(3, "2027-01-02T00:00:00Z", "update", { active: true }, { active: false }),
    audit(4, "2027-01-03T00:00:00Z", "update", { active: false }, { active: true }),
    audit(
      5,
      "2027-01-04T00:00:00Z",
      "update",
      { kind: "percent", percent_bp: 1000, amount: null, max_uses: null, name: "" },
      { kind: "fixed", percent_bp: null, amount: 20000, max_uses: 50, name: "Flyer" },
    ),
    audit(6, "2027-01-05T00:00:00Z", "coupon_change", { products: ["a", "b"] }, { products: ["a"] }),
    audit(7, "2027-01-06T00:00:00Z", "update", { code: "SUMMER10" }, { code: "SUMMER11" }),
    audit(8, "2027-01-07T00:00:00Z", "update", { archived_at: null }, { archived_at: "2027-01-07T00:00:00Z" }),
    // Another table's rows are not this History's.
    { ...audit(9, "2027-01-08T00:00:00Z", "insert", null, {}), entity: "coupon_redemptions" },
  ];

  it("created with its value and chosen products, switched off and on, changed, archived: newest first", () => {
    const lines = couponHistory(rows);
    expect(lines.map((l) => [l.code, l.change.kind])).toEqual([
      ["SUMMER11", "archived"],
      ["SUMMER11", "codeChanged"],
      ["SUMMER10", "chosenProducts"],
      ["SUMMER10", "renamed"],
      ["SUMMER10", "valueChanged"],
      ["SUMMER10", "maxUses"],
      ["SUMMER10", "switchedOn"],
      ["SUMMER10", "switchedOff"],
      ["SUMMER10", "created"],
    ]);
    expect(lines.at(-1)!.change).toEqual({
      kind: "created",
      value: { kind: "percent", bp: 1000 },
      allProducts: false,
      products: 2,
    });
    expect(lines.find((l) => l.change.kind === "valueChanged")!.change).toEqual({
      kind: "valueChanged",
      from: { kind: "percent", bp: 1000 },
      to: { kind: "fixed", amount: "20000" },
    });
    expect(lines.find((l) => l.change.kind === "codeChanged")!.change).toEqual({
      kind: "codeChanged",
      from: "SUMMER10",
      to: "SUMMER11",
    });
  });

  it("every other setting gets its own line; brought back; all products again", () => {
    const lines = couponHistory([
      audit(1, "2027-01-01T00:00:00Z", "insert", null, { ...created, all_products: true }),
      audit(
        2,
        "2027-01-02T00:00:00Z",
        "update",
        {},
        {
          valid_from: "2027-02-01",
          pickup_to: "2027-03-01",
          min_days: 3,
          min_spend: 100000,
          channels: ["staff"],
          with_returning_discount: true,
          with_season_discount: false,
        },
      ),
      audit(3, "2027-01-03T00:00:00Z", "update", { archived_at: "x" }, { archived_at: null }),
      audit(4, "2027-01-04T00:00:00Z", "update", { all_products: false }, { all_products: true }),
    ]);
    expect(lines.map((l) => l.change)).toEqual([
      { kind: "allProducts" },
      { kind: "restored" },
      { kind: "validDates", from: "2027-02-01", to: null },
      { kind: "pickupDates", from: null, to: "2027-03-01" },
      { kind: "minDays", to: 3 },
      { kind: "minSpend", to: "100000" },
      { kind: "channels", to: ["staff"] },
      { kind: "withReturning", on: true },
      { kind: "withSeason", on: false },
      {
        kind: "created",
        value: { kind: "percent", bp: 1000 },
        allProducts: true,
        products: 0,
      },
    ]);
  });

  it("each kind of line has words in both languages", () => {
    const keys = [
      "created", "createdChosen", "switchedOn", "switchedOff", "archived",
      "restored", "allProducts", "chosenProducts", "codeChanged", "renamed",
      "nameCleared", "valueChanged", "validDates", "pickupDates", "minDays",
      "minDaysCleared", "minSpend", "minSpendCleared", "maxUses",
      "maxUsesCleared", "channels", "channelsNone", "withReturningOn",
      "withReturningOff", "withSeasonOn", "withSeasonOff",
    ] as const;
    for (const key of keys) {
      expect(en.Settings.coupons.history[key], key).toContain("{who}");
      expect(th.Settings.coupons.history[key], key).toContain("{who}");
    }
  });
});

// ------------------------------------------------ the returning-customer card

describe("Settings › Pricing and tax: the returning-customer card", () => {
  const base = {
    ...settingsDraft(null, "THB"),
  };

  it("off to start, 1 rental needed; saved with the shop's other settings", () => {
    expect(base).toMatchObject({
      returningEnabled: false,
      returningPercent: "",
      returningRentals: "1",
    });
    const off = settingsPayload(base, "THB", []);
    expect(off.ok && off.payload).toMatchObject({
      returning_enabled: false,
      returning_percent_bp: null,
      returning_rentals_needed: 1,
    });
    const on = settingsPayload(
      { ...base, returningEnabled: true, returningPercent: "12.5", returningRentals: "2" },
      "THB",
      [],
    );
    expect(on.ok && on.payload).toMatchObject({
      returning_enabled: true,
      returning_percent_bp: 1250,
      returning_rentals_needed: 2,
    });
  });

  it("what is refused: on with no percentage, 0%, over 100%, 0 or 1,001 rentals", () => {
    const cases: [Partial<typeof base>, Record<string, string>][] = [
      [{ returningEnabled: true }, { returningPercent: "returningPercentRequired" }],
      [{ returningPercent: "0" }, { returningPercent: "percentZero" }],
      [{ returningPercent: "101" }, { returningPercent: "couponPercentTooLarge" }],
      [{ returningPercent: "x" }, { returningPercent: "invalidPercent" }],
      [{ returningRentals: "0" }, { returningRentals: "returningRentalsRange" }],
      [{ returningRentals: "1001" }, { returningRentals: "returningRentalsRange" }],
      [{ returningRentals: "" }, { returningRentals: "returningRentalsRange" }],
    ];
    for (const [change, errors] of cases)
      expect(settingsPayload({ ...base, ...change }, "THB", []), JSON.stringify(change)).toEqual(
        { ok: false, errors },
      );
  });

  it("a saved setting comes back on the form", () => {
    expect(
      settingsDraft(
        {
          currency: "THB",
          rounding_step: null,
          tax_inclusive: true,
          coupons_enabled: true,
          deposit_mode: "none",
          deposit_percent_bp: null,
          deposit_amount: null,
          default_tax_profile_id: null,
          returning_enabled: true,
          returning_percent_bp: 1000,
          returning_rentals_needed: 3,
        },
        "THB",
      ),
    ).toMatchObject({
      returningEnabled: true,
      returningPercent: "10",
      returningRentals: "3",
    });
  });
});

// ----------------------------------------------------------- Check a price

const zone = "Asia/Bangkok";
const ctx: PricingContext = {
  type: "vehicle",
  currency: "THB",
  step: n(1000),
  sharedKinds: new Map(),
  showDeposit: false,
  showTax: true,
};
/** ฿300 a day, own list; VAT 7% included. */
const vehicle = draftRow(
  "scooter",
  {
    method: "tiered",
    flatAmount: "",
    flatPeriod: "day",
    fixedAmount: "",
    source: "own",
    sharedId: "",
    baseAmount: "",
    list: {
      boxes: { ...emptyBoxes(), daily: "300", twoWeeks: "2100", monthly: "3000" },
      manual: {},
    },
    longStay: "100",
    deposit: "",
    tax: "default",
    replacement: "",
  },
  ctx,
  [],
  { profiles: [{ id: "vat", name: "VAT 7%", rate_bp: 700 }], defaultId: "vat" },
)!;
/** A helmet at ฿50 a day, one free with each scooter. */
const helmet: ProductPricingRow = {
  product_id: "helmet",
  product_name: "Helmet",
  product_type: "gear",
  currency: "THB",
  pricing_method: "per_period",
  price_amount: "5000",
  price_period: "day",
  base_amount: null,
  long_stay_day: null,
  deposit: null,
  replacement_price: null,
  taxable: true,
  tax_rate_bp: 700,
  tax_profile_id: "vat",
  tax_profile_name: "VAT 7%",
  template: null,
};
const inputs = (settings: Partial<NonNullable<PricingInputs["settings"]>> = {}): PricingInputs => ({
  settings: {
    currency: "THB",
    rounding_step: "1000",
    tax_inclusive: true,
    coupons_enabled: true,
    deposit_mode: "none",
    deposit_percent_bp: null,
    deposit_amount: null,
    default_tax_profile_id: "vat",
    returning_enabled: true,
    returning_percent_bp: 1000,
    returning_rentals_needed: 2,
    ...settings,
  },
  products: [helmet],
  seasons: [],
  extras: [
    {
      product_id: "scooter",
      extra_product_id: "helmet",
      extra_product_type: "gear",
      included_quantity: 1,
      max_quantity: null,
      sort_position: 0,
      every_vehicle: false,
    },
  ],
});
const coupon = (change: Partial<CouponRow> = {}, uses = 0): CouponInputs => ({
  coupon: {
    id: "c1",
    code: "SAVE",
    name: "",
    currency: "THB",
    kind: "percent",
    percent_bp: 2000,
    amount: null,
    all_products: true,
    product_ids: [],
    valid_from: null,
    valid_to: null,
    pickup_from: null,
    pickup_to: null,
    min_days: null,
    min_spend: null,
    max_uses: null,
    max_uses_per_customer: null,
    channels: ["staff"],
    with_returning_discount: false,
    with_season_discount: true,
    active: true,
    archived: false,
    ...change,
  },
  uses: { total: uses, customer: 0 },
});
const oneDay = {
  ...sampleSpan({ by: "days", pickup: "2027-01-01T10:00", days: 1 }, zone)!,
  quantity: 1,
  timeZone: zone,
};
const now = new Date("2026-12-01T00:00:00Z");

describe("Check a price: extras, a coupon code and the returning-customer tick", () => {
  it("no code, no tick: as before, the list price and VAT", () => {
    const checked = checkPrice({ inputs: inputs(), row: vehicle, sample: oneDay, now })!;
    expect(checked.quote.totals.total).toBe(n(30000));
    expect(checked.discounts).toEqual([]);
    expect(checked.decision).toMatchObject({ outcome: "decided", coupon: null });
  });

  it("extras taken with the vehicle: two helmets, one included", () => {
    const checked = checkPrice({
      inputs: inputs(),
      row: vehicle,
      sample: oneDay,
      extras: [{ productId: "helmet", quantity: 2 }],
      now,
    })!;
    const line = checked.quote.lines.find((l) => l.productId === "helmet")!;
    expect(line).toMatchObject({ quantity: 2, includedQuantity: 1, seasonPrice: n(5000) });
    expect(checked.quote.totals.total).toBe(n(35000));
    // 0 helmets: no line.
    expect(
      checkPrice({
        inputs: inputs(),
        row: vehicle,
        sample: oneDay,
        extras: [{ productId: "helmet", quantity: 0 }],
        now,
      })!.quote.lines,
    ).toHaveLength(1);
  });

  it("a good code: the coupon's row with its code and what it took", () => {
    const checked = checkPrice({
      inputs: inputs(),
      row: vehicle,
      sample: oneDay,
      code: "save",
      coupon: coupon(),
      now,
    })!;
    expect(checked.discounts).toEqual([
      { kind: "coupon", id: "coupon:c1", code: "SAVE", amount: n(6000) },
    ]);
    expect(checked.quote.totals.total).toBe(n(24000));
    expect(checked.couponBeatReturning).toBe(false);
  });

  it("the tick alone: the returning-customer discount on the rental", () => {
    const checked = checkPrice({
      inputs: inputs(),
      row: vehicle,
      sample: oneDay,
      returning: true,
      now,
    })!;
    expect(checked.discounts).toEqual([
      { kind: "returning", id: "returning_customer", amount: n(3000) },
    ]);
    // Off in the shop: the tick changes nothing.
    expect(
      checkPrice({
        inputs: inputs({ returning_enabled: false }),
        row: vehicle,
        sample: oneDay,
        returning: true,
        now,
      })!.discounts,
    ).toEqual([]);
  });

  it("they don't stack and the coupon takes more: the coupon applies, and the screen can say it won", () => {
    const checked = checkPrice({
      inputs: inputs(),
      row: vehicle,
      sample: oneDay,
      code: "SAVE",
      coupon: coupon(),
      returning: true,
      now,
    })!;
    expect(checked.discounts.map((d) => d.kind)).toEqual(["coupon"]);
    expect(checked.couponBeatReturning).toBe(true);
  });

  it("they don't stack and the returning discount is larger: the coupon is not applied, and why", () => {
    const checked = checkPrice({
      inputs: inputs(),
      row: vehicle,
      sample: oneDay,
      code: "SAVE",
      coupon: coupon({ kind: "fixed", percent_bp: null, amount: "2000" }),
      returning: true,
      now,
    })!;
    expect(checked.discounts).toEqual([
      { kind: "returning", id: "returning_customer", amount: n(3000) },
    ]);
    expect(checked.decision).toMatchObject({
      outcome: "decided",
      coupon: { applied: false, because: "returning_discount_is_better" },
    });
    expect(checked.couponBeatReturning).toBe(false);
  });

  it("a coupon that stacks: both rows, the returning-customer discount first", () => {
    const checked = checkPrice({
      inputs: inputs(),
      row: vehicle,
      sample: oneDay,
      code: "SAVE",
      coupon: coupon({ kind: "fixed", percent_bp: null, amount: "5000", with_returning_discount: true }),
      returning: true,
      now,
    })!;
    expect(checked.discounts).toEqual([
      { kind: "returning", id: "returning_customer", amount: n(3000) },
      { kind: "coupon", id: "coupon:c1", code: "SAVE", amount: n(5000) },
    ]);
    expect(checked.quote.totals.total).toBe(n(22000));
  });

  it("a coupon that would take ฿0 is not applied", () => {
    const free = { ...vehicle, pricing_method: "free" as const, template: null };
    const checked = checkPrice({
      inputs: inputs(),
      row: free,
      sample: oneDay,
      code: "SAVE",
      coupon: coupon(),
      now,
    })!;
    expect(checked.decision).toMatchObject({
      outcome: "decided",
      coupon: { applied: false, because: "takes_nothing" },
    });
    expect(checked.discounts).toEqual([]);
  });

  it("each refusal comes back with its reason and the price without the code", () => {
    const cases: [CouponInputs | null, Partial<NonNullable<PricingInputs["settings"]>>, string][] = [
      [null, {}, "unknown"],
      [coupon(), { coupons_enabled: false }, "coupons_off"],
      [coupon({ active: false }), {}, "not_active"],
      [coupon({ archived: true }), {}, "not_active"],
      [coupon({ channels: ["booking_page"] }), {}, "wrong_channel"],
      [coupon({ valid_from: "2027-01-01" }), {}, "too_early"],
      [coupon({ valid_to: "2026-11-30" }), {}, "expired"],
      [coupon({ max_uses: 3 }, 3), {}, "used_up"],
      [coupon({ all_products: false, product_ids: ["other"] }), {}, "not_these_products"],
      [coupon({ pickup_from: "2027-02-01" }), {}, "wrong_dates"],
      [coupon({ min_days: 3 }), {}, "too_short"],
      [coupon({ min_spend: "50000" }), {}, "below_minimum"],
    ];
    for (const [read, settings, reason] of cases) {
      const checked = checkPrice({
        inputs: inputs(settings),
        row: vehicle,
        sample: oneDay,
        code: "SAVE",
        coupon: read,
        now,
      })!;
      expect(checked.decision, reason).toMatchObject({ outcome: "refused", reason });
      expect(checked.quote.totals.total, reason).toBe(n(30000));
    }
  });

  it("nothing to price: no row, a return before the pickup, no quantity", () => {
    expect(checkPrice({ inputs: inputs(), row: null, sample: oneDay, now })).toBeNull();
    expect(
      checkPrice({ inputs: inputs(), row: vehicle, sample: { ...oneDay, end: oneDay.start }, now }),
    ).toBeNull();
    expect(
      checkPrice({ inputs: inputs(), row: vehicle, sample: { ...oneDay, quantity: 0 }, now }),
    ).toBeNull();
  });
});
