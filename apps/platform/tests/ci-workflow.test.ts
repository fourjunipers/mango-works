import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The CI workflows (security audit, 19 Nov 2026): the token they run with
 * only reads the repository, and every action is pinned to a commit. A tag
 * such as v4 can be moved to other code; a commit can't.
 */
const folder = fileURLToPath(
  new URL("../../../.github/workflows/", import.meta.url),
);
const workflows = readdirSync(folder)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(folder + name, "utf8") }));

describe("GitHub workflows", () => {
  it("there is at least one", () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  it.each(workflows)("$name: the token only reads", ({ text }) => {
    expect(text).toMatch(/^permissions:\n {2}contents: read\n(?! {2}\S)/m);
    expect(text).not.toMatch(/^\s*permissions:\s*write-all/m);
    expect(text).not.toMatch(/:\s*write\s*$/m);
  });

  it.each(workflows)("$name: every action is pinned to a commit", ({ text }) => {
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses)
      expect(action, action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  });
});
