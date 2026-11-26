import { describe, expect, it } from "vitest";
import {
  formatMinor,
  minorDecimal,
  multiplierText,
  parseMinorUnits,
  parseMultiplier,
} from "./money";
import {
  computeList,
  daysPayload,
  draftFromSaved,
  emptyBoxes,
  listNameError,
  methodsFor,
  pricingPayload,
  readListDraft,
  readPricingDraft,
  sameAsSaved,
  sameAsSavedDraft,
  sameEveryDayDraft,
  suggestedSampleBase,
  suggestedStep,
  taxChoice,
  withBox,
  type ListDraft,
  type PricingContext,
  type PricingDraft,
} from "./pricing-form";

const THB = "THB";
const step = BigInt(1000); // ฿10
const n = (value: number) => BigInt(value);

const boxes = (values: Partial<ListDraft["boxes"]>): ListDraft => ({
  boxes: { ...emptyBoxes(), ...values },
  manual: {},
});

describe("money as text, digit by digit", () => {
  it("parses amounts in the currency's minor units", () => {
    expect(parseMinorUnits("300", THB)).toBe(n(30000));
    expect(parseMinorUnits("1,400.50", THB)).toBe(n(140050));
    expect(parseMinorUnits("", THB)).toBeNull();
    expect(parseMinorUnits("3.333", THB)).toBe("invalid");
    expect(parseMinorUnits("-5", THB)).toBe("invalid");
    expect(parseMinorUnits("1200", "JPY")).toBe(n(1200));
    expect(parseMinorUnits("12.5", "JPY")).toBe("invalid");
    // Beyond a float's safe range, every digit kept.
    expect(parseMinorUnits("90071992547409.93", THB)).toBe(
      BigInt("9007199254740993"),
    );
  });

  it("writes amounts back without arithmetic", () => {
    expect(minorDecimal(n(11666), THB)).toBe("116.66");
    expect(minorDecimal("5", THB)).toBe("0.05");
    expect(minorDecimal(n(1200), "JPY")).toBe("1200");
    expect(formatMinor(n(140000), "USD", "en")).toBe("$1,400");
    expect(formatMinor(n(11666), "USD", "en")).toBe("$116.66");
  });

  it("formats an amount of any size with every digit", () => {
    // 15 digits: formatted as a number, exactly.
    expect(formatMinor("999999999999999", "USD", "en")).toBe(
      "$9,999,999,999,999.99",
    );
    expect(formatMinor("5", "USD", "en")).toBe("$0.05");
    expect(formatMinor("0", "USD", "en")).toBe("$0");
    // Past a number's exact range: formatted from its digits.
    expect(formatMinor("9007199254740993", "USD", "en")).toBe(
      "$90,071,992,547,409.93",
    );
    expect(formatMinor("12345678901234567890", "JPY", "en")).toBe(
      "¥12,345,678,901,234,567,890",
    );
  });

  it("reads multipliers in millionths (decision 29)", () => {
    expect(parseMultiplier("1.1666")).toBe(n(1166600));
    expect(parseMultiplier("×3")).toBe(n(3000000));
    expect(parseMultiplier("1.1234567")).toBe("invalid");
    expect(multiplierText(n(1166600))).toBe("1.1666");
    expect(multiplierText(n(3000000))).toBe("3");
    expect(multiplierText(n(500))).toBe("0.0005");
  });
});

describe("ways of pricing per type (decision 29)", () => {
  it("offers only what the database allows", () => {
    expect(methodsFor.vehicle).toEqual(["tiered", "per_period"]);
    expect(methodsFor.gear).toEqual(["tiered", "per_period", "fixed"]);
    expect(methodsFor.service).toEqual(["per_period", "fixed", "free"]);
    expect(methodsFor.sale_item).toEqual(["fixed"]);
  });

  it("suggests a rounding step per currency, never one for every shop", () => {
    expect(suggestedStep("THB")).toBe(n(1000));
    expect(suggestedStep("JPY")).toBe(n(1));
    expect(suggestedStep("USD")).toBe(n(100));
  });
});

describe("quick entry and the 30 days (§9.4)", () => {
  it("fills days 1–30 in equal steps between the boxes", () => {
    const list = computeList(
      boxes({ daily: "300", weekly: "1400", monthly: "3000" }),
      "amounts",
      THB,
      step,
    );
    expect(list.ok).toBe(true);
    expect(list.days).toHaveLength(30);
    expect(list.days[0]).toEqual({ day: 1, value: n(30000), source: "anchor" });
    expect(list.days[6]).toEqual({
      day: 7,
      value: n(140000),
      source: "anchor",
    });
    expect(list.days[29].value).toBe(n(300000));
    // Day 2 to 6 rise from ฿300 to ฿1,400 in equal steps, to ฿10.
    expect(list.days.slice(1, 6).map((d) => d.value)).toEqual(
      [48000, 67000, 85000, 103000, 122000].map(n),
    );
    expect(list.days[1].source).toBe("filled");
  });

  it("needs daily and monthly", () => {
    const list = computeList(boxes({ weekly: "1400" }), "amounts", THB, step);
    expect(list.ok).toBe(false);
    expect(list.boxErrors).toEqual({ daily: "required", monthly: "required" });
    // What is known still shows.
    expect(list.days[6].value).toBe(n(140000));
    expect(list.days[0].value).toBeNull();
  });

  it("refuses an amount that is not one, and 0", () => {
    const list = computeList(
      boxes({ daily: "lots", monthly: "0" }),
      "amounts",
      THB,
      step,
    );
    expect(list.boxErrors).toEqual({ daily: "invalid", monthly: "invalid" });
  });

  it("keeps a day typed by hand, and a box refills only filled days", () => {
    const draft = boxes({ daily: "300", weekly: "1400", monthly: "3000" });
    draft.manual = { 10: "1800" };
    const list = computeList(draft, "amounts", THB, step);
    expect(list.days[9]).toEqual({
      day: 10,
      value: n(180000),
      source: "manual",
    });
    const raised = computeList(
      { ...draft, boxes: { ...draft.boxes, weekly: "1500" } },
      "amounts",
      THB,
      step,
    );
    expect(raised.days[9].value).toBe(n(180000));
    expect(raised.days[2].value).not.toBe(list.days[2].value);
  });

  it("refuses a falling total, and allows equal neighbours", () => {
    const equal = boxes({ daily: "300", monthly: "3000" });
    equal.manual = { 2: "300" };
    expect(computeList(equal, "amounts", THB, step).ok).toBe(true);

    const falls = boxes({ daily: "300", monthly: "3000" });
    falls.manual = { 5: "100" };
    const list = computeList(falls, "amounts", THB, step);
    expect(list.ok).toBe(false);
    expect(list.problems).toEqual([{ kind: "falls", day: 5 }]);
    expect(() => daysPayload(list)).toThrow();
  });

  it("lets a box win over a day typed by hand on the same day", () => {
    const draft = boxes({ daily: "300", weekly: "1500", monthly: "3000" });
    draft.manual = { 7: "1400" };
    const list = computeList(draft, "amounts", THB, step);
    expect(list.days[6]).toEqual({
      day: 7,
      value: n(150000),
      source: "anchor",
    });
  });

  it("marks a day typed by hand that isn't a price", () => {
    const draft = boxes({ daily: "300", monthly: "3000" });
    draft.manual = { 4: "abc" };
    const list = computeList(draft, "amounts", THB, step);
    expect(list.ok).toBe(false);
    expect(list.days[3].invalid).toBe(true);
  });

  it("fills a multipliers list to four decimal places", () => {
    const list = computeList(
      boxes({ daily: "3", monthly: "30" }),
      "multipliers",
      THB,
      n(100),
    );
    expect(list.ok).toBe(true);
    expect(list.days[0].value).toBe(n(3000000));
    expect(list.days[29].value).toBe(n(30000000));
    for (const d of list.days) expect(d.value! % n(100)).toBe(n(0));
  });

  it("'Same price every day' fills the boxes and clears days by hand", () => {
    const draft = boxes({ daily: "250" });
    draft.manual = { 3: "999" };
    const next = sameEveryDayDraft(draft, "amounts", THB)!;
    expect(next.boxes).toMatchObject({
      daily: "250.00",
      weekly: "1750.00",
      twoWeeks: "3500.00",
      threeWeeks: "5250.00",
      monthly: "7500.00",
    });
    expect(next.manual).toEqual({});
    expect(sameEveryDayDraft(boxes({}), "amounts", THB)).toBeNull();
  });

  it("sends the 30 days with how each got its value", () => {
    const list = computeList(
      boxes({ hourly: "80", daily: "300", monthly: "3000" }),
      "amounts",
      THB,
      step,
    );
    const days = daysPayload(list);
    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({ day: 1, value: "30000", source: "anchor" });
    expect(days[1].source).toBe("filled");
    expect(list.hourly).toBe(n(8000));
  });
});

describe("back from a saved list", () => {
  const saved = Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    value: String((i + 1) * 10000),
    source: (i === 0 || i === 6 || i === 29
      ? "anchor"
      : i === 9
        ? "manual"
        : "filled") as "anchor" | "manual" | "filled",
  }));

  it("puts entered days in their boxes and keeps days by hand", () => {
    const draft = draftFromSaved(saved, "8000", "amounts", THB);
    expect(draft.boxes).toEqual({
      hourly: "80.00",
      daily: "100.00",
      weekly: "700.00",
      twoWeeks: "",
      threeWeeks: "",
      monthly: "3000.00",
    });
    expect(draft.manual).toEqual({ 10: "1000.00" });
  });

  it("keeps every day of a list loaded as it was (§9.11)", () => {
    const loaded = saved.map((d) => ({ ...d, source: "manual" as const }));
    const draft = draftFromSaved(loaded, null, "amounts", THB);
    expect(draft.boxes.daily).toBe("100.00");
    expect(draft.boxes.monthly).toBe("3000.00");
    expect(draft.boxes.weekly).toBe("");
    // Every day but 1 and 30 stays as loaded.
    expect(Object.keys(draft.manual)).toHaveLength(28);
    const list = computeList(draft, "amounts", THB, step);
    expect(list.days.map((d) => d.value)).toEqual(
      saved.map((d) => BigInt(d.value)),
    );
  });

  it("reads a multipliers list back as multipliers", () => {
    const draft = draftFromSaved(
      [{ day: 1, value: "1166600", source: "anchor" }],
      null,
      "multipliers",
      THB,
    );
    expect(draft.boxes.daily).toBe("1.1666");
  });
});

describe("what save_product_pricing is sent", () => {
  const ctx: PricingContext = {
    type: "vehicle",
    currency: THB,
    step,
    sharedKinds: new Map([
      ["list-a", "amounts"],
      ["list-m", "multipliers"],
    ]),
    showDeposit: true,
    showTax: false,
  };
  const draft = (change: Partial<PricingDraft>): PricingDraft => ({
    method: null,
    flatAmount: "",
    flatPeriod: "day",
    fixedAmount: "",
    source: "own",
    sharedId: "",
    baseAmount: "",
    list: boxes({}),
    longStay: "",
    deposit: "",
    tax: "default",
    replacement: "",
    ...change,
  });

  it("a flat fee: the amount and the period, as digits", () => {
    expect(
      pricingPayload(
        draft({ method: "per_period", flatAmount: "250", flatPeriod: "week" }),
        ctx,
      ),
    ).toEqual({
      ok: true,
      payload: {
        pricing_method: "per_period",
        price_amount: "25000",
        price_period: "week",
        deposit: null,
      },
    });
  });

  it("its own prices: the 30 days and the long-stay rate", () => {
    const result = pricingPayload(
      draft({
        method: "tiered",
        list: boxes({ daily: "300", monthly: "3000" }),
        longStay: "100",
        deposit: "2000",
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ownList = result.payload.own_list as { days: unknown[] };
    expect(ownList.days).toHaveLength(30);
    expect(result.payload.long_stay_day).toBe("10000");
    expect(result.payload.deposit).toBe("200000");
  });

  it("a shared multipliers list needs a base price", () => {
    expect(
      pricingPayload(
        draft({ method: "tiered", source: "shared", sharedId: "list-m" }),
        ctx,
      ),
    ).toEqual({ ok: false, errors: { baseAmount: "required" } });
    const ok = pricingPayload(
      draft({
        method: "tiered",
        source: "shared",
        sharedId: "list-m",
        baseAmount: "100",
      }),
      ctx,
    );
    expect(ok).toMatchObject({
      ok: true,
      payload: { price_template_id: "list-m", base_amount: "10000" },
    });
    const amounts = pricingPayload(
      draft({ method: "tiered", source: "shared", sharedId: "list-a" }),
      ctx,
    );
    expect(amounts.ok && "base_amount" in amounts.payload).toBe(false);
  });

  it("refuses a list that falls, a zero price and a way the type can't use", () => {
    const falling = draft({
      method: "tiered",
      list: { ...boxes({ daily: "300", monthly: "3000" }), manual: { 5: "1" } },
    });
    expect(pricingPayload(falling, ctx)).toEqual({
      ok: false,
      errors: { list: "listNotReady" },
    });
    expect(
      pricingPayload(draft({ method: "per_period", flatAmount: "0" }), ctx),
    ).toEqual({ ok: false, errors: { flatAmount: "priceZero" } });
    expect(
      pricingPayload(draft({ method: "fixed", fixedAmount: "1" }), ctx),
    ).toEqual({
      ok: false,
      errors: { method: "methodNotAllowed" },
    });
  });

  it("a deposit of 0 means no deposit for this one", () => {
    const result = pricingPayload(draft({ deposit: "0" }), ctx);
    expect(result).toEqual({ ok: true, payload: { deposit: "0" } });
  });

  it("tax and the replacement value only where they are on the form", () => {
    const gear: PricingContext = {
      ...ctx,
      type: "gear",
      showDeposit: false,
      showTax: true,
    };
    expect(
      pricingPayload(
        draft({
          method: "fixed",
          fixedAmount: "150",
          tax: "none",
          replacement: "1500",
        }),
        gear,
      ),
    ).toEqual({
      ok: true,
      payload: {
        pricing_method: "fixed",
        price_amount: "15000",
        taxable: false,
        tax_profile_id: null,
        replacement_price: "150000",
      },
    });
    const profile = pricingPayload(draft({ tax: "vat-7" }), gear);
    expect(profile).toMatchObject({
      payload: { taxable: true, tax_profile_id: "vat-7" },
    });
    // A replacement value of 0 is refused with its own message: "choose
    // Free" doesn't fit a replacement value.
    expect(
      pricingPayload(
        draft({ method: "fixed", fixedAmount: "150", replacement: "0" }),
        gear,
      ),
    ).toEqual({ ok: false, errors: { replacement: "replacementZero" } });
  });

  it("reads a saved tax choice", () => {
    expect(taxChoice({ taxable: false, tax_profile_id: null })).toBe("none");
    expect(taxChoice({ taxable: true, tax_profile_id: null })).toBe("default");
    expect(taxChoice({ taxable: true, tax_profile_id: "p" })).toBe("p");
  });

  it("a list's name: 1 to 120 characters", () => {
    expect(listNameError("  ")).toBe("required");
    expect(listNameError("x".repeat(121))).toBe("tooLong");
    expect(listNameError("300–3000")).toBeNull();
  });
});

describe("a saved list reads as it is stored (filled days are not filled again)", () => {
  // Saved with a ฿10 step: daily, weekly, 2 weeks and monthly entered.
  const first = computeList(
    boxes({ daily: "300", weekly: "1400", twoWeeks: "2100", monthly: "3000" }),
    "amounts",
    THB,
    step,
  );
  const saved = daysPayload(first);
  const savedList = { hourly: null, days: saved };
  const values = saved.map((d) => BigInt(d.value));
  // The shop has since chosen another step: ฿500.
  const newStep = BigInt(50000);
  const read = () => draftFromSaved(saved, null, "amounts", THB);
  const totals = (draft: ListDraft) =>
    computeList(draft, "amounts", THB, newStep).days.map((d) => d.value);

  it("shows every day as stored, whatever the rounding step is now", () => {
    const draft = read();
    expect(Object.keys(draft.stored ?? {})).toHaveLength(26);
    const list = computeList(draft, "amounts", THB, newStep);
    expect(list.ok).toBe(true);
    expect(list.days.map((d) => d.value)).toEqual(values);
    expect(list.days.map((d) => d.source)).toEqual(saved.map((d) => d.source));
    // Without the stored values the new step would move them.
    expect(totals({ ...draft, stored: undefined })).not.toEqual(values);
  });

  it("a changed box fills in only the days between the boxes around it", () => {
    const draft = withBox(read(), "weekly", "1500");
    const after = totals(draft);
    // Days 2–6 and 8–13 are filled in again, to the step of today.
    expect(Object.keys(draft.stored ?? {}).map(Number)).toEqual([
      15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    ]);
    expect(after[6]).toBe(n(150000));
    expect(after.slice(1, 6)).not.toEqual(values.slice(1, 6));
    // Days 15–29 are beyond the next box: as stored.
    expect(after.slice(13)).toEqual(values.slice(13));
    expect(after[0]).toBe(values[0]);
  });

  it("the first and the last box reach only as far as the next box", () => {
    expect(
      Object.keys(withBox(read(), "daily", "310").stored ?? {}).map(Number)[0],
    ).toBe(8);
    expect(
      Object.keys(withBox(read(), "monthly", "3100").stored ?? {})
        .map(Number)
        .at(-1),
    ).toBe(13);
  });

  it("a box cleared, or a new one typed, fills in its own stretch again", () => {
    // Weekly cleared: days 2–13 run straight from daily to 2 weeks.
    const cleared = withBox(read(), "weekly", "");
    expect(Object.keys(cleared.stored ?? {}).map(Number)[0]).toBe(15);
    // 3 weeks typed: only days 15–29 are filled in again.
    const typed = withBox(read(), "threeWeeks", "2600");
    expect(Object.keys(typed.stored ?? {}).map(Number)).toEqual([
      2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13,
    ]);
    expect(totals(typed).slice(0, 14)).toEqual(values.slice(0, 14));
  });

  it("the hourly box, and a box left as it was, fill nothing in again", () => {
    expect(totals(withBox(read(), "hourly", "80"))).toEqual(values);
    expect(totals(withBox(read(), "weekly", "1400.00"))).toEqual(values);
  });

  it("a day typed by hand leaves the other days as stored; Reset brings it back", () => {
    const draft = read();
    const typed = { ...draft, manual: { 10: "1700" } };
    const after = totals(typed);
    expect(after[9]).toBe(n(170000));
    expect(after.filter((_, i) => i !== 9)).toEqual(
      values.filter((_, i) => i !== 9),
    );
    expect(totals({ ...typed, manual: {} })).toEqual(values);
  });

  it("'Same price every day' starts the list again", () => {
    expect(sameEveryDayDraft(read(), "amounts", THB)?.stored).toBeUndefined();
  });

  it("ignores a stored value that is not an amount", () => {
    const draft = { ...read(), stored: { 2: "abc", 3: "0", 4: "-5" } };
    const list = computeList(draft, "amounts", THB, step);
    expect(list.days.slice(1, 4).map((d) => d.value)).toEqual(
      values.slice(1, 4),
    );
  });

  it("knows the list on the form from the saved one", () => {
    const same = computeList(read(), "amounts", THB, newStep);
    expect(sameAsSaved(same, savedList)).toBe(true);
    expect(sameAsSaved(same, null)).toBe(false);
    expect(sameAsSaved(same, { hourly: "8000", days: saved })).toBe(false);
    const moved = computeList(
      withBox(read(), "weekly", "1500"),
      "amounts",
      THB,
      newStep,
    );
    expect(sameAsSaved(moved, savedList)).toBe(false);
    // The same amount, but typed by hand now: not the same list.
    const byHand = computeList(
      { ...read(), manual: { 10: minorDecimal(values[9], THB) } },
      "amounts",
      THB,
      newStep,
    );
    expect(byHand.days.map((d) => d.value)).toEqual(values);
    expect(sameAsSaved(byHand, savedList)).toBe(false);
  });

  it("a save that leaves the prices alone sends no days (the deposit alone)", () => {
    const ctx: PricingContext = {
      type: "vehicle",
      currency: THB,
      step: newStep,
      sharedKinds: new Map(),
      showDeposit: true,
      showTax: false,
      savedOwn: savedList,
    };
    const draft: PricingDraft = {
      method: "tiered",
      flatAmount: "",
      flatPeriod: "day",
      fixedAmount: "",
      source: "own",
      sharedId: "",
      baseAmount: "",
      list: read(),
      longStay: "",
      deposit: "2500",
      tax: "default",
      replacement: "",
    };
    const kept = pricingPayload(draft, ctx);
    expect(kept.ok && kept.payload).toEqual({
      pricing_method: "tiered",
      long_stay_day: null,
      deposit: "250000",
    });
    // A price changed: the 30 days go, the untouched ones as stored.
    const changed = pricingPayload(
      { ...draft, list: withBox(read(), "threeWeeks", "2600") },
      { ...ctx, step },
    );
    const sent = changed.ok
      ? (changed.payload.own_list as { days: { value: string }[] }).days
      : [];
    expect(sent).toHaveLength(30);
    expect(sent.slice(0, 14).map((d) => d.value)).toEqual(
      saved.slice(0, 14).map((d) => d.value),
    );
    // With no saved list to compare with, the days always go.
    const first = pricingPayload(draft, { ...ctx, savedOwn: null });
    expect(first.ok && "own_list" in first.payload).toBe(true);
  });
});

describe('Check a price says "saved or not" only when the form differs from what is saved', () => {
  const ctx: PricingContext = {
    type: "vehicle",
    currency: THB,
    step,
    sharedKinds: new Map([["list-m", "multipliers"]]),
    showDeposit: true,
    showTax: false,
  };
  const draft = (change: Partial<PricingDraft>): PricingDraft => ({
    method: "per_period",
    flatAmount: "300",
    flatPeriod: "day",
    fixedAmount: "",
    source: "own",
    sharedId: "",
    baseAmount: "",
    list: boxes({}),
    longStay: "",
    deposit: "2000",
    tax: "default",
    replacement: "",
    ...change,
  });

  it("what was typed is the same as how it reads back", () => {
    // Typed "300" and "2000"; read back "300.00" and "2000.00".
    const readBack = draft({ flatAmount: "300.00", deposit: "2000.00" });
    expect(sameAsSavedDraft(draft({}), readBack, ctx)).toBe(true);
    expect(sameAsSavedDraft(draft({ deposit: "2,000" }), readBack, ctx)).toBe(
      true,
    );
  });

  it("a different amount, period or way of pricing is a change", () => {
    const saved = draft({ flatAmount: "300.00", deposit: "2000.00" });
    expect(sameAsSavedDraft(draft({ flatAmount: "301" }), saved, ctx)).toBe(
      false,
    );
    expect(sameAsSavedDraft(draft({ flatPeriod: "week" }), saved, ctx)).toBe(
      false,
    );
    expect(sameAsSavedDraft(draft({ deposit: "" }), saved, ctx)).toBe(false);
    expect(
      sameAsSavedDraft(
        draft({ method: "fixed", fixedAmount: "300" }),
        saved,
        ctx,
      ),
    ).toBe(false);
  });

  it("a list typed in the boxes is the list read back with its filled days", () => {
    const typed = boxes({ daily: "300", weekly: "1400", monthly: "3000" });
    const stored = daysPayload(computeList(typed, "amounts", THB, step));
    const readBack = draftFromSaved(stored, null, "amounts", THB);
    expect(readBack.stored).toBeDefined();
    const tiered = (list: ListDraft) =>
      draft({ method: "tiered", flatAmount: "", list, longStay: "100" });
    expect(sameAsSavedDraft(tiered(typed), tiered(readBack), ctx)).toBe(true);
    // A box changed after the read: not the saved list any more.
    expect(
      sameAsSavedDraft(
        tiered(withBox(readBack, "weekly", "1500")),
        tiered(readBack),
        ctx,
      ),
    ).toBe(false);
  });

  it("a form that can't be saved yet is a change, unless untouched", () => {
    const saved = draft({});
    expect(sameAsSavedDraft(draft({ flatAmount: "abc" }), saved, ctx)).toBe(
      false,
    );
    const broken = draft({ flatAmount: "" });
    expect(sameAsSavedDraft(broken, broken, ctx)).toBe(true);
  });
});

describe("reading a posted draft", () => {
  const list = { boxes: emptyBoxes(), manual: { 3: "350" } };
  const draft = {
    method: "tiered",
    flatAmount: "",
    flatPeriod: "day",
    fixedAmount: "",
    source: "own",
    sharedId: "",
    baseAmount: "",
    list,
    longStay: "",
    deposit: "",
    tax: "default",
    replacement: "",
  };
  it("accepts what the form sends", () => {
    expect(readListDraft(list)).toEqual(list);
    expect(readPricingDraft(draft)).toEqual(draft);
  });
  it("refuses a hand-made draft instead of throwing", () => {
    expect(readListDraft({ ...list, manual: { 31: "1" } })).toBeNull();
    expect(readListDraft({ ...list, stored: { 2: 100 } })).toBeNull();
    expect(readListDraft({ manual: {} })).toBeNull();
    expect(readPricingDraft({ ...draft, list: undefined })).toBeNull();
    expect(readPricingDraft({ ...draft, method: "cheap" })).toBeNull();
    expect(readPricingDraft({ ...draft, deposit: 5 })).toBeNull();
    expect(readPricingDraft(null)).toBeNull();
    expect(readPricingDraft([])).toBeNull();
  });
});

describe("suggestedStep", () => {
  it("comes from the per-currency table", () => {
    expect(suggestedStep("THB")).toBe(BigInt(1000));
    expect(suggestedStep("VND")).toBe(BigInt(1));
    expect(suggestedStep("USD")).toBe(BigInt(100));
    expect(suggestedSampleBase("THB")).toBe("100");
    expect(suggestedSampleBase("VND")).toBe("10");
  });
});
