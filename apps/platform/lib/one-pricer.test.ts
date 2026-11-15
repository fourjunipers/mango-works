/**
 * The guard against a second pricing path (docs/products-redesign.md §9.9):
 * the lint rule in eslint.config.mjs refuses multiplying, dividing or taking
 * a remainder of money anywhere in this app. This holds the rule itself: it
 * must catch the ways a price could be worked out here, and let through
 * what is not pricing.
 */
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({
  cwd: fileURLToPath(new URL("..", import.meta.url)),
});

async function refused(code: string, filePath = "lib/probe.ts") {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter((message) => message.ruleId === "no-restricted-syntax")
    .map((message) => message.message);
}

describe("one pricer: no money arithmetic in the app", () => {
  it("refuses multiplying, dividing and remainders of an amount", async () => {
    const cases = [
      "export const a = (price: number, days: number) => price * days;",
      "export const b = (days: number, price: number) => days * price;",
      "export const c = (row: { deposit: number }) => row.deposit / 100;",
      "export const d = (total: number, rate: number) => (total * rate) / 10700;",
      "export const e = (subtotal: number) => subtotal % 10;",
      "export const f = (vat: number) => vat ** 2;",
      "export function g(discount: number) { discount *= 2; return discount; }",
      "export const h = (line: { taxAmount: bigint }) => line.taxAmount * 2n;",
    ];
    for (const code of cases) {
      expect((await refused(code)).length, code).toBeGreaterThan(0);
    }
  }, 60_000);

  it("refuses it in a page and in a component too", async () => {
    const code = "export const x = (price: number) => price * 7;";
    expect(await refused(code, "app/[tenant]/products/probe.ts")).toHaveLength(1);
    expect(await refused(code, "components/probe.ts")).toHaveLength(1);
  }, 60_000);

  it("lets through adding, comparing and anything that is not money", async () => {
    const cases = [
      "export const a = (price: number, fee: number) => price + fee;",
      "export const b = (price: number, limit: number) => price > limit;",
      "export const c = (hours: number) => hours * 60;",
      "export const d = (count: number, pageSize: number) => count / pageSize;",
    ];
    for (const code of cases) {
      expect(await refused(code), code).toEqual([]);
    }
  }, 60_000);

  it("leaves lib/money.ts alone: it turns minor units into a string to show", async () => {
    expect(
      await refused(
        "export const show = (amount: number) => amount / 100;",
        "lib/money.ts",
      ),
    ).toEqual([]);
  }, 60_000);
});
