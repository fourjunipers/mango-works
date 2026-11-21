/**
 * Phase 2's accept line is proved by two suites (docs/phase-2-plan.md §9):
 * packages/core/src/phase-2-accept.test.ts (pricing, on @mango/core alone)
 * and tests/db/phase-2-accept.test.ts (the race and downtime, on a real
 * database). This reads both and checks that between them every clause of
 * the line has its named block, so neither can lose one unnoticed. It reads
 * the files only: a package never imports from an app, so the check sits
 * here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const core = read("../../../packages/core/src/phase-2-accept.test.ts");
const database = read("./db/phase-2-accept.test.ts");
const spec = read("../../../docs/platform/SPEC.md");

describe("Phase 2's accept line has a named block for every clause", () => {
  const suites = { core, database };
  it.each([
    [
      "core",
      "Phase 2 accept: 50+ unit tests on pricing (tiers, season, VAT inclusive and on top)",
    ],
    [
      "database",
      "Phase 2 accept: two parallel bookings for the last unit give one success",
    ],
    [
      "database",
      "two parallel bookings for the last unit: one success, staff against staff",
    ],
    [
      "database",
      "two parallel bookings for the last unit: one success, online against online",
    ],
    [
      "database",
      "two parallel bookings for the last unit: one success, staff against online",
    ],
    [
      "database",
      "Phase 2 accept: a booking that overlaps a downtime block is refused",
    ],
    ["core", "Phase 2 accept: the total never falls as days rise"],
    ["core", "Phase 2 accept: a tenant in a daylight-saving time zone"],
    ["core", "Phase 2 accept: a tenant in a zero-decimal currency"],
  ] as const)("the %s suite has: %s", (which, name) => {
    expect(suites[which]).toContain(name);
  });

  it("the spec's accept line is the one these suites prove: no weekend rules, no pricing modes", () => {
    const line = spec
      .split("\n")
      .find((l) => l.includes("Accept: 50+ unit tests on pricing"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/weekend/i);
    expect(line).not.toMatch(/pricing modes/i);
    expect(line).toMatch(/daylight-saving/);
    expect(line).toMatch(/zero-decimal/);
  });
});
