import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import th from "../messages/th.json";
import { dropTarget, moveInList, moveTarget } from "./general-products";

/**
 * Dragging to reorder (design §5.8): where a dropped line goes, what the
 * list shows meanwhile, and that both agree with the database's
 * move_product ("put this product just before or after that one").
 */

/** What move_product does to the shop's whole order. */
function saved(
  order: readonly string[],
  id: string,
  move: { target: string; place: "before" | "after" },
) {
  const rest = order.filter((other) => other !== id);
  const at = rest.indexOf(move.target) + (move.place === "after" ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

describe("a drop", () => {
  const shown = ["a", "b", "c", "d", "e"];

  it("on a line further down goes just after it", () => {
    expect(dropTarget(shown, "a", "c")).toEqual({
      target: "c",
      place: "after",
    });
    expect(moveInList(shown, "a", "c")).toEqual(["b", "c", "a", "d", "e"]);
    expect(dropTarget(shown, "a", "e")).toEqual({
      target: "e",
      place: "after",
    });
    expect(moveInList(shown, "a", "e")).toEqual(["b", "c", "d", "e", "a"]);
  });

  it("on a line further up goes just before it", () => {
    expect(dropTarget(shown, "d", "b")).toEqual({
      target: "b",
      place: "before",
    });
    expect(moveInList(shown, "d", "b")).toEqual(["a", "d", "b", "c", "e"]);
    expect(dropTarget(shown, "e", "a")).toEqual({
      target: "a",
      place: "before",
    });
    expect(moveInList(shown, "e", "a")).toEqual(["e", "a", "b", "c", "d"]);
  });

  it("where it was, or on something that isn't a line, changes nothing", () => {
    expect(dropTarget(shown, "c", "c")).toBeNull();
    expect(dropTarget(shown, "c", "nowhere")).toBeNull();
    expect(dropTarget(shown, "nowhere", "c")).toBeNull();
    expect(moveInList(shown, "c", "c")).toEqual(shown);
    expect(moveInList(shown, "c", "nowhere")).toEqual(shown);
    expect(moveInList(shown, "nowhere", "c")).toEqual(shown);
  });

  it("leaves the list it was given as it was", () => {
    const before = [...shown];
    moveInList(shown, "a", "e");
    expect(shown).toEqual(before);
  });

  it("one line up or down is what the arrows do", () => {
    for (const [at, id] of shown.entries()) {
      if (at > 0)
        expect(dropTarget(shown, id, shown[at - 1])).toEqual(
          moveTarget(shown, id, "up"),
        );
      if (at < shown.length - 1)
        expect(dropTarget(shown, id, shown[at + 1])).toEqual(
          moveTarget(shown, id, "down"),
        );
    }
  });

  it("every drop on a whole list: the saved order is the order shown", () => {
    for (const id of shown)
      for (const over of shown) {
        const move = dropTarget(shown, id, over);
        if (!move) continue;
        expect(saved(shown, id, move), `${id} on ${over}`).toEqual(
          moveInList(shown, id, over),
        );
      }
  });

  it("every drop on Fleet, which hides general products: the vehicles end up as shown, and the general products keep their order", () => {
    // The shop's one order; g1 to g3 are general products Fleet doesn't show.
    const whole = ["g1", "a", "b", "g2", "c", "d", "g3", "e"];
    const vehicles = whole.filter((id) => !id.startsWith("g"));
    for (const id of vehicles)
      for (const over of vehicles) {
        const move = dropTarget(vehicles, id, over);
        if (!move) continue;
        const after = saved(whole, id, move);
        expect(
          after.filter((other) => !other.startsWith("g")),
          `${id} on ${over}`,
        ).toEqual(moveInList(vehicles, id, over));
        expect(after.filter((other) => other.startsWith("g"))).toEqual([
          "g1",
          "g2",
          "g3",
        ]);
        expect([...after].sort()).toEqual([...whole].sort());
      }
  });

  it("a general product dragged on the Products list moves among the vehicles", () => {
    const whole = ["a", "b", "helmet", "c"];
    const move = dropTarget(whole, "helmet", "a")!;
    expect(saved(whole, "helmet", move)).toEqual(["helmet", "a", "b", "c"]);
    // Fleet then shows the same vehicles in the same order.
    expect(
      saved(whole, "helmet", move).filter((id) => id !== "helmet"),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("wording for dragging", () => {
  const placeholders = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

  it("is there in English and Thai, with the same names, places and totals", () => {
    const keys = Object.keys(en.Lists.drag) as (keyof typeof en.Lists.drag)[];
    expect(Object.keys(th.Lists.drag)).toEqual(keys);
    for (const key of keys) {
      expect(th.Lists.drag[key].trim()).not.toBe("");
      expect(placeholders(th.Lists.drag[key]), key).toEqual(
        placeholders(en.Lists.drag[key]),
      );
    }
    for (const key of ["pickedUp", "movedTo", "dropped", "cancelled"] as const)
      expect(placeholders(en.Lists.drag[key])).toEqual([
        "name",
        "position",
        "total",
      ]);
  });
});
