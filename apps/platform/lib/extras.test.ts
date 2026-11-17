/**
 * The Extras screens' pure parts (Phase 2 stage 6): lib/extras.ts (what is
 * typed to save_product_extras()'s list, refusals to messages),
 * lib/extras-history.ts (History lines from extras_change events),
 * lib/extras-save.ts (the save path, on a stand-in database) and the
 * labels, in English and Thai. The database checks everything again
 * (tests/db/product-extras.test.ts).
 */
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import th from "../messages/th.json";
import {
  draftsOf,
  EXTRAS_PER_LIST,
  extrasErrorKey,
  extrasErrors,
  extrasPayload,
  readExtrasForm,
  shopWideState,
  type SavedExtra,
} from "./extras";
import {
  extrasChanges,
  extrasHistory,
  extrasLines,
  extrasNamed,
  type ExtrasLine,
} from "./extras-history";
import { saveExtrasList, type ExtrasDb } from "./extras-save";
import type { AuditRow } from "./history";

const HELMET = "44444444-4444-4444-8444-444444444444";
const RAIN = "55555555-5555-4555-8555-555555555555";
const DELIVERY = "66666666-6666-4666-8666-666666666666";
const SCOOTER = "33333333-3333-4333-8333-333333333333";
const TENANT = "11111111-1111-4111-8111-111111111111";

const draft = (extraProductId: string, included = "0", most = "") => ({
  extraProductId,
  included,
  most,
});

describe("lib/extras.ts: the boxes as typed", () => {
  it("an empty included box is 0 and an empty most is no limit; whole numbers 0 to 1000 and 1 to 1000", () => {
    expect(extrasErrors([draft(HELMET, "", ""), draft(RAIN, "2", "4")])).toEqual(
      [],
    );
    expect(
      extrasPayload({
        lines: [draft(HELMET, "", ""), draft(RAIN, " 2 ", "4")],
        notOffered: [],
      }),
    ).toEqual([
      { extra_product_id: HELMET, included_quantity: 0, max_quantity: null },
      { extra_product_id: RAIN, included_quantity: 2, max_quantity: 4 },
    ]);
    expect(extrasErrors([draft(HELMET, "1000", "1000")])).toEqual([]);
  });

  it("not a whole number, too many, a most of 0, or a most below the included quantity: the line and the box are named, and nothing is sent", () => {
    const lines = [
      draft(HELMET, "1.5"),
      draft(RAIN, "-1"),
      draft(DELIVERY, "1001"),
      draft(HELMET, "0", "0"),
      draft(RAIN, "0", "abc"),
      draft(DELIVERY, "3", "2"),
    ];
    expect(extrasErrors(lines)).toEqual([
      { line: 0, field: "included", key: "invalidNumber" },
      { line: 1, field: "included", key: "invalidNumber" },
      { line: 2, field: "included", key: "invalidNumber" },
      { line: 3, field: "most", key: "invalidNumber" },
      { line: 4, field: "most", key: "invalidNumber" },
      { line: 5, field: "most", key: "extrasMostBelowIncluded" },
    ]);
    expect(extrasPayload({ lines, notOffered: [] })).toBeNull();
    // A bad included box doesn't also blame the most.
    expect(extrasErrors([draft(HELMET, "x", "1")])).toEqual([
      { line: 0, field: "included", key: "invalidNumber" },
    ]);
  });

  it("an opt-out is a line of its own with offered false, after the vehicle's lines; one the vehicle sets itself is not sent twice", () => {
    expect(
      extrasPayload({
        lines: [draft(HELMET, "2", "4")],
        notOffered: [RAIN, HELMET, RAIN],
      }),
    ).toEqual([
      { extra_product_id: HELMET, included_quantity: 2, max_quantity: 4 },
      {
        extra_product_id: RAIN,
        included_quantity: 0,
        max_quantity: null,
        offered: false,
      },
    ]);
  });

  it("readExtrasForm() takes only the editor's shape: ids, strings, no repeats, at most 100", () => {
    const ok = JSON.stringify({ lines: [draft(HELMET, "1", "")], notOffered: [RAIN] });
    expect(readExtrasForm(ok)).toEqual({
      lines: [draft(HELMET, "1", "")],
      notOffered: [RAIN],
    });
    for (const bad of [
      "not json",
      "[]",
      "null",
      JSON.stringify({ lines: [] }),
      JSON.stringify({ lines: [{ extraProductId: "x", included: "", most: "" }], notOffered: [] }),
      JSON.stringify({ lines: [{ extraProductId: HELMET, included: 1, most: "" }], notOffered: [] }),
      JSON.stringify({ lines: [draft(HELMET), draft(HELMET)], notOffered: [] }),
      JSON.stringify({ lines: [], notOffered: ["x"] }),
      JSON.stringify({
        lines: [],
        notOffered: Array.from({ length: EXTRAS_PER_LIST + 1 }, () => RAIN),
      }),
    ])
      expect(readExtrasForm(bad), bad).toBeNull();
  });

  it("draftsOf() shows a saved list in its order, its opt-outs apart; shopWideState() says how a shop-wide extra stands", () => {
    const rows: SavedExtra[] = [
      { extra_product_id: RAIN, included_quantity: 0, max_quantity: null, offered: true, sort_position: 1 },
      { extra_product_id: HELMET, included_quantity: 2, max_quantity: 4, offered: true, sort_position: 0 },
      { extra_product_id: DELIVERY, included_quantity: 0, max_quantity: null, offered: false, sort_position: 2 },
    ];
    expect(draftsOf(rows)).toEqual({
      lines: [draft(HELMET, "2", "4"), draft(RAIN, "0", "")],
      notOffered: [DELIVERY],
    });
    expect(shopWideState(HELMET, rows)).toBe("own");
    expect(shopWideState(DELIVERY, rows)).toBe("notOffered");
    expect(shopWideState(SCOOTER, rows)).toBe("offered");
  });

  it("extrasErrorKey(): each refusal of save_product_extras() in words; a lock not had in time is try again", () => {
    const cases: [{ code?: string; message?: string } | null, string][] = [
      [{ code: "55P03", message: "canceling statement due to lock timeout" }, "extrasTryAgain"],
      [{ code: "57014", message: "canceling statement due to statement timeout" }, "extrasTryAgain"],
      [{ code: "42501", message: "only_owner_or_manager" }, "extrasOnlyOwnerOrManager"],
      [{ code: "42501", message: "permission denied for function" }, "extrasOnlyOwnerOrManager"],
      [{ code: "22023", message: "invalid_extras" }, "extrasInvalid"],
      [{ message: "product_not_found" }, "extrasProductNotFound"],
      [{ message: "not_a_vehicle" }, "extrasProductNotFound"],
      [{ message: "extra_not_found" }, "extrasExtraNotFound"],
      [{ message: "not_an_extra" }, "extrasExtraNotFound"],
      [{ code: "XX000", message: "something else" }, "saveFailed"],
      [null, "saveFailed"],
    ];
    for (const [error, key] of cases)
      expect(extrasErrorKey(error), JSON.stringify(error)).toBe(key);
  });
});

/** A stand-in for a signed-in member's client: answers as told, remembers. */
function saver(error: { code?: string; message: string } | null = null) {
  const calls: Record<string, unknown>[] = [];
  const db: ExtrasDb = {
    rpc(_fn, args) {
      calls.push(args);
      return Promise.resolve({ data: error ? null : [], error });
    },
  };
  return { db, calls };
}

describe("lib/extras-save.ts: the save path", () => {
  const form = (lines = [draft(HELMET, "2", "4")], notOffered: string[] = []) =>
    JSON.stringify({ lines, notOffered });

  it("sends the vehicle's list, its opt-outs included, to save_product_extras()", async () => {
    const s = saver();
    expect(
      await saveExtrasList(s.db, TENANT, SCOOTER, form(undefined, [RAIN])),
    ).toEqual({ ok: true });
    expect(s.calls).toEqual([
      {
        p_tenant_id: TENANT,
        p_product_id: SCOOTER,
        p_extras: [
          { extra_product_id: HELMET, included_quantity: 2, max_quantity: 4 },
          { extra_product_id: RAIN, included_quantity: 0, max_quantity: null, offered: false },
        ],
      },
    ]);
  });

  it("the shop's list goes with no vehicle and can't opt out of anything", async () => {
    const s = saver();
    expect(await saveExtrasList(s.db, TENANT, null, form())).toEqual({ ok: true });
    expect(s.calls[0].p_product_id).toBeNull();
    const refused = saver();
    expect(
      await saveExtrasList(refused.db, TENANT, null, form([], [RAIN])),
    ).toEqual({ ok: false, errors: { form: "extrasInvalid" } });
    expect(refused.calls).toEqual([]);
  });

  it("a wrong line is named on its box and nothing is sent; a form that isn't the editor's is refused", async () => {
    const s = saver();
    expect(
      await saveExtrasList(s.db, TENANT, SCOOTER, form([draft(HELMET, "3", "2")])),
    ).toEqual({
      ok: false,
      errors: { form: "extrasCheckLines", "most-0": "extrasMostBelowIncluded" },
    });
    expect(await saveExtrasList(s.db, TENANT, SCOOTER, "{")).toEqual({
      ok: false,
      errors: { form: "extrasInvalid" },
    });
    expect(s.calls).toEqual([]);
  });

  it("the database's answer in words: staff are told only an owner or a manager can; a lock not had in time is try again", async () => {
    const staff = saver({
      code: "42501",
      message: "only_owner_or_manager",
    });
    expect(await saveExtrasList(staff.db, TENANT, SCOOTER, form())).toEqual({
      ok: false,
      errors: { form: "extrasOnlyOwnerOrManager" },
    });
    expect(en.FormErrors.extrasOnlyOwnerOrManager).toBe(
      "Only an owner or a manager can change extras.",
    );
    for (const code of ["55P03", "57014"]) {
      const busy = saver({ code, message: "canceling statement" });
      expect(await saveExtrasList(busy.db, TENANT, SCOOTER, form())).toEqual({
        ok: false,
        errors: { form: "extrasTryAgain" },
      });
    }
  });
});

const line = (
  extra: string,
  included = 0,
  most: number | null = null,
  offered = true,
): ExtrasLine => ({ extra, included, most, offered });

describe("lib/extras-history.ts: one action, one line", () => {
  it("reads an event's list; one written before stage 6 has no offered and every line was offered", () => {
    expect(
      extrasLines({
        extras: [
          { extra_product_id: HELMET, included_quantity: 2, max_quantity: 4 },
          { extra_product_id: RAIN, included_quantity: 0, max_quantity: null, offered: false },
          { nothing: true },
        ],
      }),
    ).toEqual([line(HELMET, 2, 4), line(RAIN, 0, null, false)]);
    expect(extrasLines(null)).toEqual([]);
    expect(extrasLines({ extras: "no" })).toEqual([]);
  });

  it("added, removed, changed, not offered, offered again and a new order", () => {
    expect(extrasChanges([], [line(HELMET, 2, 4)])).toEqual([
      { kind: "added", extra: HELMET, included: 2, most: 4 },
    ]);
    expect(extrasChanges([line(HELMET)], [])).toEqual([
      { kind: "removed", extra: HELMET },
    ]);
    expect(extrasChanges([line(HELMET, 1, null)], [line(HELMET, 2, 3)])).toEqual([
      {
        kind: "changed",
        extra: HELMET,
        included: { from: 1, to: 2 },
        most: { from: null, to: 3 },
      },
    ]);
    expect(extrasChanges([], [line(RAIN, 0, null, false)])).toEqual([
      { kind: "notOffered", extra: RAIN },
    ]);
    expect(extrasChanges([line(RAIN, 0, null, false)], [])).toEqual([
      { kind: "offeredAgain", extra: RAIN },
    ]);
    // An opt-out replaced by a line of its own is that line added.
    expect(
      extrasChanges([line(RAIN, 0, null, false)], [line(RAIN, 1, 2)]),
    ).toEqual([{ kind: "added", extra: RAIN, included: 1, most: 2 }]);
    expect(
      extrasChanges([line(HELMET), line(RAIN)], [line(RAIN), line(HELMET)]),
    ).toEqual([{ kind: "reordered" }]);
    // The same list: nothing to say.
    expect(extrasChanges([line(HELMET, 1, 2)], [line(HELMET, 1, 2)])).toEqual([]);
  });

  it("extrasHistory() keeps extras_change events that changed something; extrasNamed() lists each product once", () => {
    const row = (id: number, before: unknown, after: unknown): AuditRow => ({
      id,
      entity: "product_extras",
      entity_id: SCOOTER,
      action: "extras_change",
      actor: null,
      before,
      after,
      at: "2026-11-17T10:00:00Z",
    });
    const entries = extrasHistory([
      row(1, { extras: [] }, { extras: [{ extra_product_id: HELMET, included_quantity: 1, max_quantity: null }] }),
      row(2, { extras: [] }, { extras: [] }),
      { ...row(3, null, null), entity: "products", action: "update" },
      row(4, { extras: [{ extra_product_id: HELMET }] }, { extras: [{ extra_product_id: HELMET }, { extra_product_id: RAIN, offered: false }] }),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual([1, 4]);
    expect(extrasNamed(entries)).toEqual([HELMET, RAIN]);
  });
});

/** Every key of a messages object, as dotted paths. */
const keysOf = (value: object, prefix = ""): string[] =>
  Object.entries(value).flatMap(([key, inner]) =>
    inner && typeof inner === "object"
      ? keysOf(inner as object, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

describe("the labels", () => {
  it('"Most per vehicle", never "most per booking", in English; สูงสุดต่อคัน in Thai', () => {
    expect(en.Products.extras.most).toBe("Most per vehicle");
    expect(th.Products.extras.most).toBe("สูงสุดต่อคัน");
    expect(en.Products.extras.mostCount).toBe("Most per vehicle: {count}");
    expect(th.Products.extras.mostCount).toBe("สูงสุดต่อคัน: {count}");
    expect(en.Products.extras.notOffered).toBe("Not offered for this vehicle");
    expect(th.Products.extras.notOffered).toBe("ไม่เสนอสำหรับรถรุ่นนี้");
    const all = JSON.stringify(en).toLowerCase();
    expect(all).not.toContain("most per booking");
  });

  it("every extras string is in both languages, with the same placeholders", () => {
    const groups: [object, object][] = [
      [en.Products.extras, th.Products.extras],
      [en.Products.history.extras, th.Products.history.extras],
      [en.Settings.extras, th.Settings.extras],
    ];
    for (const [english, thai] of groups) {
      expect(keysOf(thai)).toEqual(keysOf(english));
    }
    const pick = (o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith("extras")));
    expect(Object.keys(pick(th.FormErrors))).toEqual(Object.keys(pick(en.FormErrors)));
    const holes = (text: string) => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
    const flat = (o: object, prefix = ""): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "string" ? [[prefix + k, v] as [string, string]] : flat(v as object, `${prefix}${k}.`),
      );
    const thai = new Map(flat({ x: th.Products.extras, h: th.Products.history.extras }));
    for (const [key, text] of flat({ x: en.Products.extras, h: en.Products.history.extras }))
      expect(holes(thai.get(key) ?? ""), key).toEqual(holes(text));
    expect(en.Settings.nav.extras).toBe("Extras");
    expect(th.Settings.nav.extras).toBe("ของเสริม");
    expect(en.Products.tabs.extras).toBe("Extras");
    expect(th.Products.tabs.extras).toBe("ของเสริม");
  });
});
