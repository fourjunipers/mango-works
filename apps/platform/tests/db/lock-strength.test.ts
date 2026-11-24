/**
 * "Never raise a lock level later" (docs/phase-3-plan.md §4.1, §4.4).
 *
 * A transaction takes all its product rows at once, at the strongest
 * strength it needs. pg_locks does not list granted row locks, so this is
 * checked statically: every function body in the `platform` and
 * `platform_private` schemas is read, and a function fails when it locks
 * `platform.products` rows in two different strengths (which includes a
 * weaker one before a stronger one), unless it is on the reviewed list
 * below, with its reason.
 *
 * What it reads: explicit locking clauses (`for key share`, `for share`,
 * `for no key update`, `for update`) in a statement that reads
 * platform.products. Not the locks an UPDATE, a DELETE or a foreign key
 * takes by itself.
 */
import { describe, expect, it } from "vitest";
import { sql } from "./helpers";

type Reviewed = {
  /** The strengths it takes, weakest first, as this test finds them. */
  strengths: string[];
  reason: string;
  /** Not in the database yet: the stage that creates it. */
  arrives?: string;
};

/** Reviewed exceptions. Add one only with its reason, after a review. */
const REVIEWED: Record<string, Reviewed> = {
  // The plan's first entry (§4.1, re-check 15). The function arrives in
  // stage 6 (migration 7); the entry is kept here so that stage finds it.
  "platform.swap_rental_unit": {
    strengths: ["share", "no key update"],
    reason:
      "The old product's row `for no key update` when the old vehicle goes into repair, the new product's `for share`: two rows in two strengths by design, both taken at once in id order and never raised.",
    arrives: "Phase 3 stage 6",
  },
  // Found by this test on main (Phase 2 stage 5). Reviewed with stage 1.
  "platform.save_product_extras": {
    strengths: ["key share", "no key update"],
    reason:
      "The vehicle's row `for no key update`, then the extra products' rows `for key share` in id order (root CLAUDE.md, lock order): different rows, the stronger one first and one row only, and no row's lock is raised. A booking takes product rows `for share`, which `for key share` does not wait for.",
  },
};

const ORDER = ["key share", "share", "no key update", "update"];

/** The strengths in which `body` locks platform.products rows. */
function productLocks(body: string): string[] {
  const found = new Set<string>();
  const code = body
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  for (const statement of code.split(";")) {
    const table =
      /\bplatform\.products\b(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/.exec(
        statement,
      );
    if (!table) continue;
    const reserved = new Set([
      "where",
      "order",
      "for",
      "join",
      "on",
      "set",
      "group",
      "limit",
      "left",
      "inner",
      "cross",
      "using",
      "union",
      "returning",
    ]);
    const alias = table[1] && !reserved.has(table[1]) ? table[1] : null;
    const clause =
      /\bfor (no key update|key share|update|share)\b(?: of ([a-z_][a-z0-9_.]*(?:\s*,\s*[a-z_][a-z0-9_.]*)*))?/g;
    for (const match of statement.matchAll(clause)) {
      const of = match[2]?.split(",").map((name) => name.trim());
      // `for update of r`: only when products is one of the tables named.
      if (of && !of.some((n) => n === alias || n === "products")) continue;
      found.add(match[1]!);
    }
  }
  return ORDER.filter((strength) => found.has(strength));
}

function functions(): { name: string; body: string }[] {
  const { out, failed } = sql(`
    select json_agg(json_build_object(
      'name', n.nspname || '.' || p.proname, 'body', p.prosrc))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('platform', 'platform_private') and p.prokind in ('f', 'p');
  `);
  expect(failed).toBe("");
  return JSON.parse(out);
}

describe("product row locks: one strength per function, or a reviewed reason", () => {
  it("the reader finds what it should in SQL it is shown", () => {
    expect(
      productLocks(`
        -- for update is only a comment here
        perform 1 from platform.products p where p.id = any (v_ids) order by p.id for share;
      `),
    ).toEqual(["share"]);
    expect(
      productLocks(`
        select 1 from platform.products where id = a for no key update;
        select 1 from platform.products m where m.id = b FOR KEY SHARE;
      `),
    ).toEqual(["key share", "no key update"]);
    // Another table's rows are locked, products only read.
    expect(
      productLocks(`
        select r.* from platform.reservations r
        join platform.products p on p.id = r.product_id
        for update of r;
      `),
    ).toEqual([]);
    expect(
      productLocks(`
        select 1 from platform.products p join platform.units u on u.product_id = p.id
        for update of p;
      `),
    ).toEqual(["update"]);
    expect(
      productLocks("select 1 from platform.product_listings for update;"),
    ).toEqual([]);
  });

  it("no function takes product rows in two strengths, except the reviewed ones; no reviewed line is stale", () => {
    const all = functions();
    const locking = all
      .map(({ name, body }) => ({ name, strengths: productLocks(body) }))
      .filter(({ strengths }) => strengths.length > 0);
    // The reader reaches the functions it must: these are known lockers.
    for (const name of [
      "platform.reserve",
      "platform.move_unit",
      "platform.review_catalog_request",
      "platform_private.units_counts_after_update",
      "platform_private.units_counts_after_delete",
      "platform_private.units_product_not_retired",
    ])
      expect(
        locking.map((f) => f.name),
        name,
      ).toContain(name);

    const mixed = locking.filter(({ strengths }) => strengths.length > 1);
    expect(
      mixed.filter(({ name }) => !(name in REVIEWED)).map((f) => f.name),
      "a function locks platform.products rows in two strengths",
    ).toEqual([]);

    for (const [name, reviewed] of Object.entries(REVIEWED)) {
      expect(reviewed.reason.length, name).toBeGreaterThan(40);
      const exists = all.some((f) => f.name === name);
      if (reviewed.arrives) {
        // Not built yet. Once it is, this line must describe it: drop
        // `arrives` in that stage.
        expect(exists, `${name} exists now: remove "arrives"`).toBe(false);
        continue;
      }
      expect(exists, `${name} is on the reviewed list but is gone`).toBe(true);
      expect(
        locking.find((f) => f.name === name)?.strengths,
        `${name}: the reviewed strengths`,
      ).toEqual(reviewed.strengths);
    }
  });

  it("move_unit() and the two counts triggers take product rows `for no key update`, in id order, in one statement", () => {
    for (const name of [
      "platform.move_unit",
      "platform_private.units_counts_after_update",
      "platform_private.units_counts_after_delete",
    ]) {
      const raw = sql(
        `select prosrc from pg_proc where oid = '${name}'::regproc;`,
      ).out;
      const body = raw.replace(/\s+/g, " ");
      expect(body, name).toMatch(
        /from platform\.products p where p\.id (in \([^)]*\)|= any \(v_ids\)) order by p\.id for no key update/,
      );
      expect(productLocks(raw), name).toEqual(["no key update"]);
    }
  });
});
