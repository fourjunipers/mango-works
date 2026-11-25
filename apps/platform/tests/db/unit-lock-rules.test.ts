/**
 * Phase 3, stage 1: unit lock rules (docs/phase-3-plan.md §4.1, §8 stage 1;
 * migration 20261123000100_platform_unit_lock_rules).
 *
 *  - A unit's product changes only through move_unit(), one unit per
 *    transaction. Two opposite moves take turns; nothing deadlocks.
 *  - A statement that changes or deletes units takes every product row it
 *    affects once, in id order (two statement-level triggers).
 *  - One unit per transaction to sold, retired or lost, unless the
 *    transaction already holds every such unit's lock (lock_units()).
 *  - Lost at any time.
 *  - review_catalog_request() takes products before the catalog entry, and
 *    leaves the Moto Mangos listing as it is.
 *
 * The races are real sessions held at one gate and released at the same
 * instant, in three shops at once: Bangkok (THB), New York (USD, daylight
 * saving) and Saigon (VND). Postgres's own count of detected deadlocks is
 * read before and after each. The "crossing" tests place the two sessions
 * exactly where the old triggers deadlocked; they fail on main's triggers.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  allocationFor,
  closedGate,
  createOrder,
  orderSql,
  createTenant,
  createUser,
  deleteTenant,
  deleteUser,
  forceListing,
  GATE_TIMEOUTS,
  holding,
  hours,
  listingOf,
  period,
  removeCatalogEntry,
  seenWaitingForLock,
  serviceClient,
  setListing,
  sql,
  sqlBackground,
  type TestTenant,
  type TestUser,
} from "./helpers";
import { atMostOne, exactlyOne } from "@mango/db/rows";

vi.setConfig(GATE_TIMEOUTS);

const ROUNDS = 30;
/** A test of ROUNDS rounds: each round opens several database sessions. */
const RACE_TIMEOUT = 600_000;

let bangkok: TestTenant;
let newYork: TestTenant;
let saigon: TestTenant;
let admin: TestUser;
const catalogIds: string[] = [];
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let counter = 0;
let deadlocksBefore: number;

const everyShop = (): [string, TestTenant][] => [
  ["Bangkok", bangkok],
  ["New York", newYork],
  ["Saigon", saigon],
];

const deadlocks = () =>
  Number(
    sql(
      `select pg_stat_force_next_flush(); select deadlocks from pg_stat_database where datname = current_database();`,
    )
      .out.split("\n")
      .pop(),
  );

/**
 * The count once every session that has just gone idle has handed in its
 * numbers (the server's own statistics interval: being late can only hide a
 * deadlock, never invent one).
 */
async function deadlocksReported() {
  await new Promise((r) => setTimeout(r, 1200));
  return deadlocks();
}

/** A session acting as a signed-in member, or (null) as the server. */
const actingAs = (userId: string | null) =>
  userId
    ? `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: "authenticated" })}', true); set local role authenticated;`
    : `select set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role;`;

type Session = {
  /** A member's id, null for the server, undefined for the database's owner. */
  as?: string | null;
  sql: string;
};
type Ended = { out: string; failed: string; last: string };

/** What the statements printed, without psql's own lines (BEGIN, SET, ...). */
const answers = (out: string) =>
  out
    .split("\n")
    .filter(
      (line) =>
        line !== "" &&
        !/^(BEGIN|COMMIT|ROLLBACK|SET|UPDATE \d+|DELETE \d+|INSERT \d+ \d+)$/.test(
          line,
        ),
    );

/**
 * Runs each session in a transaction of its own, all of them held at one
 * gate until every one is there, then released at the same instant.
 */
async function sameInstant(sessions: Session[]): Promise<Ended[]> {
  const gate = await closedGate();
  const runs = sessions.map((session) => {
    const marker = `at-gate-${tag}-${++counter}`;
    const run = sqlBackground(
      [
        "begin;",
        gate.wait(marker),
        session.as === undefined ? "" : actingAs(session.as),
        session.sql,
        "commit;",
      ].join("\n"),
    );
    return { marker, run };
  });
  await Promise.all(runs.map(({ marker, run }) => holding(marker, run)));
  await gate.open();
  return (await Promise.all(runs.map(({ run }) => run))).map((r) => ({
    ...r,
    last: answers(r.out).pop() ?? "",
  }));
}

const noDeadlock = (results: Ended[], what: string) => {
  for (const r of results) expect(r.failed, what).not.toMatch(/deadlock/i);
};

async function vehicle(tenant: TestTenant, units: number, locationId?: string) {
  const product = await exactlyOne(
    service
      .from("products")
      .insert({
        tenant_id: tenant.id,
        name: `Lock rules ${tag} ${++counter}`,
        vehicle_type: "motorbike",
      })
      .select("id")
      .throwOnError(),
  );
  const id = product.data!.id as string;
  const unitIds: string[] = [];
  for (let i = 0; i < units; i++)
    unitIds.push(await addUnit(tenant, id, locationId));
  return { id, units: unitIds };
}

async function addUnit(
  tenant: TestTenant,
  productId: string,
  locationId?: string,
  id?: string,
) {
  const unit = await exactlyOne(
    service
      .from("units")
      .insert({
        ...(id ? { id } : {}),
        tenant_id: tenant.id,
        product_id: productId,
        location_id: locationId ?? tenant.locationId,
        plate: `LR-${tag}-${++counter}`,
      })
      .select("id")
      .throwOnError(),
  );
  return unit.data!.id as string;
}

async function branchOf(tenant: TestTenant) {
  const { data, error } = await exactlyOne(
    service
      .from("locations")
      .insert({
        tenant_id: tenant.id,
        name: `Branch ${tag} ${++counter}`,
        timezone: "Asia/Bangkok",
      })
      .select("id"),
  );
  if (error) throw error;
  return data.id as string;
}

const unitRows = async (ids: string[]) =>
  (
    await service
      .from("units")
      .select("id, product_id, location_id, status")
      .in("id", ids)
      .throwOnError()
  ).data!;
const unitRow = async (id: string) => (await unitRows([id]))[0]!;

const moveSql = (
  tenant: TestTenant,
  unit: string,
  product: string,
  location: string,
  /** The form's `updated_at`: an old one is answered `stale`. */
  expectedUpdatedAt?: string,
) =>
  `select platform.move_unit('${tenant.id}', '${unit}', '${product}', '${location}', null, ${expectedUpdatedAt ? `'${expectedUpdatedAt}'` : "null"});`;

/** Day `d` at 03:00 UTC, far ahead: every round books its own days. */
const at = (d: number) => new Date(Date.UTC(2033, 0, 1) + d * 86_400_000);

const reserveSql = (
  tenant: TestTenant,
  products: string[],
  from: Date,
  to: Date,
) =>
  // create_order() since Phase 3 stage 2b (reserve() is gone): one bike of
  // each product, so the request needs no line split.
  `select ${orderSql(tenant.id, {
    channel: "walk_in",
    mode: "staff",
    lines: products.map((product_id) => ({
      product_id,
      location_id: tenant.locationId,
      starts_at: from.toISOString(),
      ends_at: to.toISOString(),
      quantity: 1,
    })),
  })};`;

beforeAll(async () => {
  deadlocksBefore = deadlocks();
  [bangkok, newYork, saigon, admin] = await Promise.all([
    createTenant("locks-bkk", {
      country: "TH",
      currency: "THB",
      locale: "th-TH",
      timezone: "Asia/Bangkok",
    }),
    createTenant("locks-nyc", {
      country: "US",
      currency: "USD",
      locale: "en-US",
      timezone: "America/New_York",
    }),
    createTenant("locks-sgn"),
    createUser("locks-admin"),
  ]);
  await service.from("platform_admins").insert({ user_id: admin.id });
}, 180_000);

afterAll(async () => {
  await Promise.all([bangkok, newYork, saigon].map(deleteTenant));
  await deleteUser(admin);
  for (const id of catalogIds) await removeCatalogEntry(id);
}, 180_000);

describe("a unit's product changes only through move_unit()", () => {
  it(
    `two opposite moves at one place, released at the same instant: both finish, no deadlock (${ROUNDS} rounds, three shops)`,
    async () => {
      const before = deadlocks();
      const scenes = [];
      for (const [where, tenant] of everyShop()) {
        const x = await vehicle(tenant, 1);
        const y = await vehicle(tenant, 1);
        scenes.push({ where, tenant, x, y });
      }
      for (let round = 0; round < ROUNDS; round++) {
        // Bike A is on X in even rounds and on Y in odd ones; B the other.
        const [toA, toB] = round % 2 === 0 ? ["y", "x"] : ["x", "y"];
        const results = await sameInstant(
          scenes.flatMap(({ tenant, x, y }) => {
            const product = { x: x.id, y: y.id } as Record<string, string>;
            return [
              {
                as: tenant.members.owner.id,
                sql: moveSql(
                  tenant,
                  x.units[0]!,
                  product[toA!]!,
                  tenant.locationId,
                ),
              },
              {
                as: tenant.members.manager.id,
                sql: moveSql(
                  tenant,
                  y.units[0]!,
                  product[toB!]!,
                  tenant.locationId,
                ),
              },
            ];
          }),
        );
        noDeadlock(results, `round ${round}`);
        for (const r of results) {
          expect(r.failed, `round ${round}`).toBe("");
          expect(JSON.parse(r.last).ok, `round ${round}: ${r.last}`).toBe(true);
        }
      }
      // ROUNDS is even: every bike is back where it began.
      for (const { where, x, y } of scenes) {
        expect((await unitRow(x.units[0]!)).product_id, where).toBe(x.id);
        expect((await unitRow(y.units[0]!)).product_id, where).toBe(y.id);
      }
      expect(await deadlocksReported()).toBe(before);
    },
    RACE_TIMEOUT,
  );

  it(
    `two opposite moves at two places (no product-and-location lock in common): they take turns at the product rows, no deadlock (${ROUNDS} rounds, three shops)`,
    async () => {
      const before = deadlocks();
      const scenes = [];
      for (const [where, tenant] of everyShop()) {
        const branch = await branchOf(tenant);
        const x = await vehicle(tenant, 1);
        const y = await vehicle(tenant, 1, branch);
        scenes.push({ where, tenant, branch, x, y });
      }
      for (let round = 0; round < ROUNDS; round++) {
        const [toA, toB] = round % 2 === 0 ? ["y", "x"] : ["x", "y"];
        const results = await sameInstant(
          scenes.flatMap(({ tenant, branch, x, y }) => {
            const product = { x: x.id, y: y.id } as Record<string, string>;
            return [
              // A stays at the main place, B at the branch: the two calls
              // share no advisory lock.
              {
                as: tenant.members.owner.id,
                sql: moveSql(
                  tenant,
                  x.units[0]!,
                  product[toA!]!,
                  tenant.locationId,
                ),
              },
              {
                as: tenant.members.manager.id,
                sql: moveSql(tenant, y.units[0]!, product[toB!]!, branch),
              },
            ];
          }),
        );
        noDeadlock(results, `round ${round}`);
        for (const r of results) {
          expect(r.failed, `round ${round}`).toBe("");
          expect(JSON.parse(r.last).ok, `round ${round}: ${r.last}`).toBe(true);
        }
      }
      for (const { where, x, y } of scenes) {
        expect((await unitRow(x.units[0]!)).product_id, where).toBe(x.id);
        expect((await unitRow(y.units[0]!)).product_id, where).toBe(y.id);
      }
      expect(await deadlocksReported()).toBe(before);
    },
    RACE_TIMEOUT,
  );

  it("a direct product change is refused for the owner, the manager, the service role and the database's owner, with or without bookings; nothing changes", async () => {
    for (const [where, tenant] of everyShop()) {
      const a = await vehicle(tenant, 1);
      const b = await vehicle(tenant, 0);
      const [unit] = a.units;

      const owner = await tenant.members.owner.db
        .from("units")
        .update({ product_id: b.id })
        .eq("id", unit!)
        .select("id");
      expect(owner.error?.message, where).toBe("use_move_unit");

      const manager = await tenant.members.manager.db
        .from("units")
        .update({ product_id: b.id })
        .eq("id", unit!)
        .select("id");
      expect(manager.error?.message, where).toBe("use_move_unit");

      const server = await service
        .from("units")
        .update({ product_id: b.id, colour: "Red" })
        .eq("id", unit!)
        .select("id");
      expect(server.error?.message, where).toBe("use_move_unit");

      const direct = sql(
        `update platform.units set product_id = '${b.id}' where id = '${unit}';`,
      );
      expect(direct.failed, where).toContain("use_move_unit");

      // Someone who may not edit the unit at all hears that first.
      const staff = await tenant.members.staff.db
        .from("units")
        .update({ product_id: b.id })
        .eq("id", unit!)
        .select("id");
      expect(staff.error?.message, where).toBe("only_owner_or_manager");

      expect(await unitRow(unit!), where).toMatchObject({ product_id: a.id });

      // The same change through move_unit() is taken; a place change alone
      // is still a plain update.
      const moved = await tenant.members.owner.db.rpc("move_unit", {
        p_tenant_id: tenant.id,
        p_unit_id: unit!,
        p_product_id: b.id,
        p_location_id: tenant.locationId,
      });
      expect(moved.error, where).toBeNull();
      expect((moved.data as { ok: boolean }).ok, where).toBe(true);
      const branch = await branchOf(tenant);
      const place = await tenant.members.owner.db
        .from("units")
        .update({ location_id: branch })
        .eq("id", unit!)
        .select("id");
      expect(place.error, where).toBeNull();
      expect(await unitRow(unit!), where).toMatchObject({
        product_id: b.id,
        location_id: branch,
      });
    }
  });

  it("after a move_unit() in the same transaction a direct product change is refused (the moved unit and another one), and so is a second move_unit(); everything is undone", async () => {
    for (const [where, tenant] of everyShop()) {
      const a = await vehicle(tenant, 2);
      const b = await vehicle(tenant, 0);
      const c = await vehicle(tenant, 0);
      const [one, two] = a.units;
      const move = (unit: string, product: string) =>
        moveSql(tenant, unit, product, tenant.locationId);

      for (const [what, then, reason] of [
        [
          "the moved unit again",
          `update platform.units set product_id = '${c.id}' where id = '${one}';`,
          "use_move_unit",
        ],
        [
          "another unit",
          `update platform.units set product_id = '${b.id}' where id = '${two}';`,
          "use_move_unit",
        ],
        ["a second move_unit()", move(two!, b.id), "one_move_per_transaction"],
        [
          "a second move_unit() of the same unit",
          move(one!, c.id),
          "one_move_per_transaction",
        ],
      ] as const) {
        const run = sql(
          ["begin;", actingAs(null), move(one!, b.id), then, "commit;"].join(
            "\n",
          ),
        );
        expect(run.failed, `${where}: ${what}`).toContain(reason);
        // The first move went with it.
        for (const row of await unitRows([one!, two!]))
          expect(row.product_id, `${where}: ${what}`).toBe(a.id);
      }

      // The marker does not outlive its transaction: the next one moves.
      const next = sql(
        ["begin;", actingAs(null), move(one!, b.id), "commit;"].join("\n"),
      );
      expect(next.failed, where).toBe("");
      expect(JSON.parse(answers(next.out).pop()!).ok, where).toBe(true);
      expect((await unitRow(one!)).product_id, where).toBe(b.id);
    }
  });

  it("whatever the first move_unit() answered (nothing to do, stale, bookings changed), a second one in the same transaction is refused: the first one's locks are still held", async () => {
    for (const [where, tenant] of everyShop()) {
      const a = await vehicle(tenant, 2);
      const b = await vehicle(tenant, 0);
      const [one, two] = a.units;
      const firsts: [string, string, object][] = [
        [
          "nothing to do (it is there already)",
          moveSql(tenant, one!, a.id, tenant.locationId),
          { ok: true, bookings: 0 },
        ],
        [
          "stale (an old form)",
          moveSql(
            tenant,
            one!,
            b.id,
            tenant.locationId,
            "2000-01-01T00:00:00Z",
          ),
          { ok: false, reason: "stale" },
        ],
        [
          "bookings changed (the person was warned of one, there is none)",
          `select platform.move_unit('${tenant.id}', '${one}', '${b.id}', '${tenant.locationId}', 1);`,
          { ok: false, reason: "bookings_changed" },
        ],
      ];
      for (const [what, first, answer] of firsts) {
        // By itself the first call answers as expected, and writes nothing.
        const alone = sql(
          ["begin;", actingAs(null), first, "commit;"].join("\n"),
        );
        expect(alone.failed, `${where}: ${what}`).toBe("");
        expect(
          JSON.parse(answers(alone.out).pop()!),
          `${where}: ${what}`,
        ).toMatchObject(answer);
        // Followed by a second call, of the same unit or of another: refused.
        for (const second of [
          moveSql(tenant, one!, b.id, tenant.locationId),
          moveSql(tenant, two!, b.id, tenant.locationId),
        ]) {
          const run = sql(
            ["begin;", actingAs(null), first, second, "commit;"].join("\n"),
          );
          expect(run.failed, `${where}: ${what}`).toContain(
            "one_move_per_transaction",
          );
        }
        // And so is a direct product change after it.
        const direct = sql(
          [
            "begin;",
            actingAs(null),
            first,
            `update platform.units set product_id = '${b.id}' where id = '${two}';`,
            "commit;",
          ].join("\n"),
        );
        expect(direct.failed, `${where}: ${what}`).toContain("use_move_unit");
        for (const row of await unitRows([one!, two!]))
          expect(row.product_id, `${where}: ${what}`).toBe(a.id);
      }
      // Someone who may not move units is answered before the check, with
      // no lock taken: nothing is closed to whoever calls next.
      const stranger = sql(
        [
          "begin;",
          actingAs(tenant.members.staff.id),
          moveSql(tenant, one!, b.id, tenant.locationId),
          moveSql(tenant, one!, b.id, tenant.locationId),
          "commit;",
        ].join("\n"),
      );
      expect(stranger.failed, where).toBe("");
      expect(JSON.parse(answers(stranger.out).pop()!), where).toEqual({
        ok: false,
        reason: "not_allowed",
      });
    }
  });

  it("the first move_unit() answered try_again (another session holds the unit's row): a second one in the same transaction is refused all the same", async () => {
    for (const [where, tenant] of everyShop()) {
      const a = await vehicle(tenant, 2);
      const b = await vehicle(tenant, 0);
      const [one, two] = a.units;
      const move = (unit: string) =>
        moveSql(tenant, unit, b.id, tenant.locationId);

      // Another session holds the unit's row for update, as someone saving
      // the unit's form does, and stays there until the gate opens.
      const gate = await closedGate();
      const marker = `row-held-${tag}-${++counter}`;
      const holder = sqlBackground(
        [
          "begin;",
          `select 1 from platform.units where id = '${one}' for update;`,
          gate.wait(marker),
          "commit;",
        ].join("\n"),
      );
      await holding(marker, holder);

      // By itself: try_again, at once. move_unit() asks for the row without
      // waiting, and has its advisory locks by then.
      const alone = await sqlBackground(
        ["begin;", actingAs(null), move(one!), "commit;"].join("\n"),
      );
      expect(alone.failed, where).toBe("");
      expect(JSON.parse(answers(alone.out).pop()!), where).toEqual({
        ok: false,
        reason: "try_again",
      });

      // Followed by a second call in the same transaction, of the same unit
      // or of another: refused, because the first one's locks are still held.
      for (const second of [move(one!), move(two!)]) {
        const run = await sqlBackground(
          ["begin;", actingAs(null), move(one!), second, "commit;"].join("\n"),
        );
        expect(run.failed, where).toContain("one_move_per_transaction");
      }
      // And so is a direct product change after it.
      const direct = await sqlBackground(
        [
          "begin;",
          actingAs(null),
          move(one!),
          `update platform.units set product_id = '${b.id}' where id = '${two}';`,
          "commit;",
        ].join("\n"),
      );
      expect(direct.failed, where).toContain("use_move_unit");

      await gate.open();
      expect((await holder).failed, where).toBe("");
      for (const row of await unitRows([one!, two!]))
        expect(row.product_id, where).toBe(a.id);

      // With the row free again, the same call moves the unit.
      const next = await sqlBackground(
        ["begin;", actingAs(null), move(one!), "commit;"].join("\n"),
      );
      expect(next.failed, where).toBe("");
      expect(JSON.parse(answers(next.out).pop()!).ok, where).toBe(true);
      expect((await unitRow(one!)).product_id, where).toBe(b.id);
    }
  });
});

describe("a statement that changes or deletes units takes its product rows once, in id order", () => {
  /**
   * Run before a statement over several units, in its own transaction: the
   * planner then reads the units by their key, in id order. Without it the
   * order follows the plan the planner happens to pick and, for a scan of
   * the table's pages, where each row happens to lie, which depends on the
   * free room earlier tests left behind: on one database Y's unit came
   * first, on another X's (the review of PR 70). A plan the planner may
   * choose anyway, made certain; the order is still read back and asserted
   * before every crossing and every round.
   */
  const BY_KEY =
    "set local enable_seqscan = off; set local enable_bitmapscan = off;";

  /** The statement's own `where`, Y's unit named first. */
  const bothUnits = (unitX: string, unitY: string) =>
    `where id in ('${unitY}', '${unitX}')`;

  /**
   * The order in which a statement with that `where` reads the two units,
   * run as `as` would run it (a member's id; undefined: the database's
   * owner), read by the key (BY_KEY). Asked of the database, not assumed.
   */
  function scanOrder(unitX: string, unitY: string, as?: string): string[] {
    const { out, failed } = sql(
      [
        "begin;",
        as === undefined ? "" : actingAs(as),
        BY_KEY,
        `select 'unit ' || id from platform.units ${bothUnits(unitX, unitY)};`,
        "commit;",
      ].join("\n"),
    );
    expect(failed).toBe("");
    return out
      .split("\n")
      .filter((line) => line.startsWith("unit "))
      .map((line) => line.slice(5));
  }

  /**
   * One unit of X and one of Y at the branch, such that a statement over
   * the two reads **Y's unit first**: the old row trigger then took Y's
   * product row before X's, against a booking's X before Y. Built, the
   * order read back, and built again another way (which is inserted first,
   * which has the lower id) until it is so.
   */
  async function yFirstPair(
    tenant: TestTenant,
    x: { id: string },
    y: { id: string },
    branch: string,
    as?: string,
  ) {
    const tried: string[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      const [low, high] = [randomUUID(), randomUUID()].sort();
      const yLow = attempt % 2 === 0;
      const yInsertedFirst = attempt % 4 < 2;
      const make = (product: string, id: string) =>
        addUnit(tenant, product, branch, id);
      let unitX: string;
      let unitY: string;
      if (yInsertedFirst) {
        unitY = await make(y.id, yLow ? low! : high!);
        unitX = await make(x.id, yLow ? high! : low!);
      } else {
        unitX = await make(x.id, yLow ? high! : low!);
        unitY = await make(y.id, yLow ? low! : high!);
      }
      const order = scanOrder(unitX, unitY, as);
      if (order.length === 2 && order[0] === unitY) return { unitX, unitY };
      tried.push(
        `${yLow ? "Y lower id" : "Y higher id"}, ${yInsertedFirst ? "Y inserted first" : "Y inserted second"}: ${order[0] === unitX ? "X first" : order.join(",")}`,
      );
      await service
        .from("units")
        .delete()
        .in("id", [unitX, unitY])
        .throwOnError();
    }
    throw new Error(`No pair of units is read Y's first: ${tried.join("; ")}`);
  }

  /** Two products X < Y (by id) and a pair of units read Y's first. */
  async function crossingScene(tenant: TestTenant, as?: string) {
    const [x, y] = [await vehicle(tenant, 2), await vehicle(tenant, 2)].sort(
      (a, b) => (a.id < b.id ? -1 : 1),
    );
    const branch = await branchOf(tenant);
    return {
      x: x!,
      y: y!,
      branch,
      ...(await yFirstPair(tenant, x!, y!, branch, as)),
    };
  }

  /**
   * The crossing the old row trigger lost. A session stands where a booking
   * of X and Y stands between its two product rows: X held `for share`, Y
   * not yet. The statement then takes its product rows; the session asks
   * for Y.
   *
   * Old trigger: the statement took Y (its first row's product), then
   * waited for X; the session asked for Y: a deadlock. Now the statement
   * asks for X first and waits there with no product row in hand.
   */
  async function crossing(
    what: string,
    statement: (unitX: string, unitY: string) => string,
    waitingText: string,
  ) {
    for (const [where, tenant] of everyShop()) {
      const before = deadlocks();
      const { x, y, unitX, unitY } = await crossingScene(tenant);
      // The crossing is only one if the statement reads Y's unit first.
      expect(x.id < y.id, where).toBe(true);
      expect(scanOrder(unitX, unitY), where).toEqual([unitY, unitX]);
      const marker = `booking-between-rows-${tag}-${++counter}`;
      const gate = await closedGate();
      const booking = sqlBackground(`
        begin;
        select 1 from platform.products where id = '${x.id}' for share;
        ${gate.wait(marker)}
        select 1 from platform.products where id = '${y.id}' for share;
        commit;
      `);
      await holding(marker, booking);
      const change = sqlBackground(
        `begin;\n${BY_KEY}\n${statement(unitX, unitY)}\ncommit;`,
      );
      await seenWaitingForLock(waitingText);
      await gate.open();
      const results = await Promise.all([booking, change]);
      for (const r of results) {
        expect(r.failed, `${where}: ${what}`).not.toMatch(/deadlock/i);
        expect(r.failed, `${where}: ${what}`).toBe("");
      }
      expect(await deadlocksReported(), `${where}: ${what}`).toBe(before);
    }
  }

  it("crossing: a two-unit change to maintenance (Y's unit first) against a booking of X and Y that holds X and asks for Y: one waits, both finish, no deadlock", async () => {
    await crossing(
      "status change",
      (unitX, unitY) =>
        `update platform.units set status = 'maintenance' ${bothUnits(unitX, unitY)};`,
      "set status = 'maintenance'",
    );
  }, 180_000);

  it("crossing: a two-product unit delete (Y's unit first) against the same booking: one waits, both finish, no deadlock", async () => {
    await crossing(
      "delete",
      (unitX, unitY) =>
        `delete from platform.units ${bothUnits(unitX, unitY)};`,
      "delete from platform.units",
    );
  }, 180_000);

  // ---------------------------------------------------------------- the races
  // The same crossing against a real create_order() of both products, both
  // sides released at the same instant. With two units the old trigger's
  // window (Y's product row taken, X's not yet asked for) is a few
  // microseconds, and a race almost never lands in it. So the statement
  // here is over MANY of Y's units and then one of X's, on products with a
  // listing to clamp: the old row trigger did a product's whole clamp for
  // each of Y's rows before it reached X's, with Y's product row in hand
  // all that time.

  /** Y's units in a race's statement, all read before X's one unit. */
  const MANY = 40;

  const unitsWhere = (ids: string[]) =>
    `where id in (${ids.map((id) => `'${id}'`).join(", ")})`;

  /** The order in which a statement with that `where` reads the units. */
  function readOrder(ids: string[], as?: string): string[] {
    const { out, failed } = sql(
      [
        "begin;",
        as === undefined ? "" : actingAs(as),
        BY_KEY,
        `select 'unit ' || id from platform.units ${unitsWhere(ids)};`,
        "commit;",
      ].join("\n"),
    );
    expect(failed).toBe("");
    return out
      .split("\n")
      .filter((line) => line.startsWith("unit "))
      .map((line) => line.slice(5));
  }

  type RaceUnits = { unitX: string; unitYs: string[]; all: string[] };

  /**
   * MANY units of Y and one of X at the branch, such that a statement over
   * all of them reads **X's unit last**. Built, the order read back as `as`
   * would read it, and built again another way until it is so.
   */
  async function manyYThenX(
    tenant: TestTenant,
    x: { id: string },
    y: { id: string },
    branch: string,
    as: string | undefined,
  ): Promise<RaceUnits> {
    const tried: string[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const ids = Array.from({ length: MANY + 1 }, () => randomUUID()).sort();
      const xHighest = attempt % 2 === 0;
      const xInsertedLast = attempt % 4 < 2;
      const unitX = xHighest ? ids.pop()! : ids.shift()!;
      const row = (id: string, product: string) => ({
        id,
        tenant_id: tenant.id,
        product_id: product,
        location_id: branch,
        plate: `LR-${tag}-${++counter}`,
      });
      const units = service.from("units");
      if (!xInsertedLast) await units.insert(row(unitX, x.id)).throwOnError();
      await service
        .from("units")
        .insert(ids.map((id) => row(id, y.id)))
        .throwOnError();
      if (xInsertedLast)
        await service.from("units").insert(row(unitX, x.id)).throwOnError();
      const all = [...ids, unitX];
      const order = readOrder(all, as);
      if (order.length === all.length && order[order.length - 1] === unitX)
        return { unitX, unitYs: ids, all };
      tried.push(
        `${xHighest ? "X highest id" : "X lowest id"}, ${xInsertedLast ? "X inserted last" : "X inserted first"}: X read at ${order.indexOf(unitX) + 1} of ${order.length}`,
      );
      await service.from("units").delete().in("id", all).throwOnError();
    }
    throw new Error(`X's unit is never read last: ${tried.join("; ")}`);
  }

  type RaceScene = RaceUnits & {
    where: string;
    tenant: TestTenant;
    x: { id: string; units: string[] };
    y: { id: string; units: string[] };
    branch: string;
  };

  async function raceScene(
    where: string,
    tenant: TestTenant,
    as: string | undefined,
  ): Promise<RaceScene> {
    const [x, y] = [await vehicle(tenant, 2), await vehicle(tenant, 2)].sort(
      (a, b) => (a.id < b.id ? -1 : 1),
    );
    const branch = await branchOf(tenant);
    return {
      where,
      tenant,
      x: x!,
      y: y!,
      branch,
      ...(await manyYThenX(tenant, x!, y!, branch, as)),
    };
  }

  /** Both products offer every unit they have: each unit leaving is a clamp. */
  async function listEverything(scene: RaceScene) {
    for (const [product, count] of [
      [scene.x.id, scene.x.units.length + 1],
      [scene.y.id, scene.y.units.length + scene.unitYs.length],
    ] as const)
      await forceListing(scene.tenant.id, product, {
        instant_units: count,
        ready_now: count,
      }).throwOnError();
  }

  /** Before a round: X's unit is read last, as `as` reads them. */
  function readXLast(scene: RaceScene, as: string | undefined, round: number) {
    const order = readOrder(scene.all, as);
    expect(order, `${scene.where} round ${round}`).toHaveLength(MANY + 1);
    expect(order[order.length - 1], `${scene.where} round ${round}`).toBe(
      scene.unitX,
    );
  }

  it(
    `a change to maintenance of ${MANY} units of Y and then one of X against a real booking of both products, released at the same instant: both finish, no deadlock (${ROUNDS} rounds, three shops)`,
    async () => {
      const before = deadlocks();
      const scenes: RaceScene[] = [];
      for (const [where, tenant] of everyShop())
        scenes.push(await raceScene(where, tenant, undefined));
      for (let round = 0; round < ROUNDS; round++) {
        for (const scene of scenes) {
          // The statement runs as the database's owner: with a member's
          // policy in the plan the units can be read by product instead
          // of by key, X's first. The locks are the triggers', whoever asks.
          const as = undefined;
          // An update writes a new row version, which can lie elsewhere:
          // the units are made again whenever the last round moved X's
          // away from the end.
          const order = readOrder(scene.all, as);
          if (order[order.length - 1] !== scene.unitX) {
            await service
              .from("units")
              .delete()
              .in("id", scene.all)
              .throwOnError();
            Object.assign(
              scene,
              await manyYThenX(
                scene.tenant,
                scene.x,
                scene.y,
                scene.branch,
                as,
              ),
            );
          }
          readXLast(scene, as, round);
          await listEverything(scene);
        }
        const results = await sameInstant(
          scenes.flatMap(({ tenant, x, y, all }) => [
            {
              as: tenant.members.staff.id,
              sql: reserveSql(
                tenant,
                [x.id, y.id],
                at(round * 2),
                at(round * 2 + 1),
              ),
            },
            {
              sql: `${BY_KEY} update platform.units set status = 'maintenance' ${unitsWhere(all)};`,
            },
          ]),
        );
        noDeadlock(results, `round ${round}`);
        results.forEach((r, i) => {
          expect(r.failed, `round ${round}`).toBe("");
          if (i % 2 === 0)
            expect(JSON.parse(r.last).ok, `round ${round}: ${r.last}`).toBe(
              true,
            );
        });
        // Back in use for the next round (no unit leaves a product: no lock).
        for (const { all } of scenes)
          await service
            .from("units")
            .update({ status: "active" })
            .in("id", all)
            .throwOnError();
      }
      expect(await deadlocksReported()).toBe(before);
    },
    RACE_TIMEOUT,
  );

  it(
    `a delete of ${MANY} units of Y and then one of X against a real booking of both products, released at the same instant: both finish, no deadlock (${ROUNDS} rounds, three shops)`,
    async () => {
      const before = deadlocks();
      const scenes: RaceScene[] = [];
      for (const [where, tenant] of everyShop())
        scenes.push(await raceScene(where, tenant, undefined));
      for (let round = 0; round < ROUNDS; round++) {
        for (const scene of scenes) {
          readXLast(scene, undefined, round);
          await listEverything(scene);
        }
        const results = await sameInstant(
          scenes.flatMap(({ tenant, x, y, all }) => [
            {
              as: tenant.members.staff.id,
              sql: reserveSql(
                tenant,
                [x.id, y.id],
                at(100 + round * 2),
                at(100 + round * 2 + 1),
              ),
            },
            {
              sql: `${BY_KEY} delete from platform.units ${unitsWhere(all)};`,
            },
          ]),
        );
        noDeadlock(results, `round ${round}`);
        results.forEach((r, i) => {
          expect(r.failed, `round ${round}`).toBe("");
          if (i % 2 === 0)
            expect(JSON.parse(r.last).ok, `round ${round}: ${r.last}`).toBe(
              true,
            );
        });
        // As many again to delete next round, X's read last again.
        for (const scene of scenes) {
          expect(await unitRows(scene.all)).toEqual([]);
          Object.assign(
            scene,
            await manyYThenX(
              scene.tenant,
              scene.x,
              scene.y,
              scene.branch,
              undefined,
            ),
          );
        }
      }
      expect(await deadlocksReported()).toBe(before);
    },
    RACE_TIMEOUT,
  );

  it("the two triggers are statement-level, the row trigger is gone, units_busy_on_delete is still per row", () => {
    const { out, failed } = sql(`
      select tgname || ' ' ||
        case when tgtype & 1 = 1 then 'row' else 'statement' end || ' ' ||
        coalesce(tgoldtable, '-') || ' ' || coalesce(tgnewtable, '-')
      from pg_trigger
      where tgrelid = 'platform.units'::regclass and not tgisinternal
        and (tgname like 'units_counts%' or tgname like 'units_clamp%'
          or tgname = 'units_busy_on_delete')
      order by tgname;
    `);
    expect(failed).toBe("");
    expect(out.split("\n")).toEqual([
      "units_busy_on_delete row - -",
      "units_counts_after_delete statement o -",
      "units_counts_after_update statement o n",
    ]);
  });

  it("one statement over two products clamps each listing once and says which units left", async () => {
    const tenant = bangkok;
    const x = await vehicle(tenant, 3);
    const y = await vehicle(tenant, 2);
    for (const p of [x, y])
      await forceListing(tenant.id, p.id, {
        instant_units: p.units.length,
        ready_now: p.units.length,
      }).throwOnError();
    const leaving = [x.units[0]!, x.units[1]!, y.units[0]!];
    const { error } = await tenant.members.mechanic.db
      .from("units")
      .update({ status: "maintenance" })
      .in("id", leaving)
      .select("id");
    expect(error).toBeNull();
    expect(await listingOf(x.id)).toMatchObject({
      instant_units: 1,
      ready_now: 1,
    });
    expect(await listingOf(y.id)).toMatchObject({
      instant_units: 1,
      ready_now: 1,
    });
    const events = await service
      .from("audit_events")
      .select("entity_id, actor, after")
      .eq("action", "clamp_booking_counts")
      .in("entity_id", [x.id, y.id])
      .throwOnError();
    expect(events.data).toHaveLength(2);
    const of = (id: string) =>
      events.data!.find((e) => e.entity_id === id)! as {
        actor: string;
        after: Record<string, unknown>;
      };
    expect(of(x.id).actor).toBe(tenant.members.mechanic.id);
    expect(of(x.id).after).toMatchObject({
      active_units: 1,
      because_unit: [x.units[0], x.units[1]].sort()[0],
      because_units: [x.units[0], x.units[1]].sort(),
      unit_change: "status active -> maintenance",
    });
    expect(of(y.id).after).toMatchObject({
      active_units: 1,
      because_unit: y.units[0],
      unit_change: "status active -> maintenance",
    });
    expect(of(y.id).after).not.toHaveProperty("because_units");

    // A delete over both: clamped again, once each.
    const gone = await tenant.members.owner.db
      .from("units")
      .delete()
      .in("id", [x.units[2]!, y.units[1]!])
      .select("id");
    expect(gone.error).toBeNull();
    expect(await listingOf(x.id)).toMatchObject({ instant_units: 0 });
    expect(await listingOf(y.id)).toMatchObject({ instant_units: 0 });
  });
});

describe("one unit per transaction to sold, retired or lost, unless every such unit's lock is held already", () => {
  it("a unit's lock key comes from one place: lock_units() takes the lock holds_unit_lock() looks for, and it is the lock the older triggers take", () => {
    const unit = randomUUID();
    const { out, failed } = sql(`
      begin;
      select platform_private.unit_lock_class() = x'1a01'::int
        and platform_private.unit_lock_key('${unit}') = hashtext('${unit}');
      select platform_private.holds_unit_lock('${unit}');
      select platform_private.lock_units(array['${unit}']::uuid[]);
      select platform_private.holds_unit_lock('${unit}');
      select platform_private.holds_unit_lock('${randomUUID()}');
      -- The transaction-level lock units_busy_on_delete would ask for: held.
      select count(*) from pg_locks
      where locktype = 'advisory' and pid = pg_backend_pid() and granted;
      commit;
      select platform_private.holds_unit_lock('${unit}');
    `);
    expect(failed).toBe("");
    expect(answers(out)).toEqual(["t", "f", "t", "f", "1", "f"]);
    // lock_units() itself names no class and no hash: only the two helpers.
    const body = sql(
      `select prosrc from pg_proc where oid = 'platform_private.lock_units'::regproc;`,
    ).out;
    expect(body).toContain("platform_private.unit_lock_key(");
    expect(body).toContain("platform_private.unit_lock_class()");
    expect(body).not.toMatch(/hashtext|1a01/);
  });

  it("a plain two-unit update to sold, retired or lost is refused, for the owner, the service role and the database's owner; nothing changes", async () => {
    for (const [where, tenant] of everyShop()) {
      const bike = await vehicle(tenant, 2);
      for (const status of ["sold", "retired", "lost"] as const) {
        const owner = await tenant.members.owner.db
          .from("units")
          .update({ status })
          .in("id", bike.units)
          .select("id");
        expect(owner.error?.message, `${where} ${status}`).toBe(
          "one_unit_status_change",
        );
        const server = await service
          .from("units")
          .update({ status })
          .in("id", bike.units)
          .select("id");
        expect(server.error?.message, `${where} ${status}`).toBe(
          "one_unit_status_change",
        );
        // Two statements in one transaction: the same.
        const direct = sql(`
          begin;
          update platform.units set status = '${status}' where id = '${bike.units[0]}';
          update platform.units set status = '${status}' where id = '${bike.units[1]}';
          commit;
        `);
        expect(direct.failed, `${where} ${status}`).toContain(
          "one_unit_status_change",
        );
        for (const row of await unitRows(bike.units))
          expect(row.status, `${where} ${status}`).toBe("active");
      }
      // One at a time, each in its own transaction, as the app does.
      for (const unit of bike.units) {
        const one = await tenant.members.owner.db
          .from("units")
          .update({ status: "retired" })
          .eq("id", unit)
          .select("id");
        expect(one.error, where).toBeNull();
      }
      // Many units into repair and back in one statement: no rule against it.
      const more = await vehicle(tenant, 3);
      for (const status of ["maintenance", "active"]) {
        const many = await tenant.members.mechanic.db
          .from("units")
          .update({ status })
          .in("id", more.units)
          .select("id");
        expect(many.error, where).toBeNull();
        expect(many.data, where).toHaveLength(3);
      }
    }
  });

  it("a two-unit update where the transaction holds only one of the two locks is refused, whichever it holds; with both held through lock_units() it is taken", async () => {
    for (const [where, tenant] of everyShop()) {
      const bike = await vehicle(tenant, 2);
      const both = bike.units.map((u) => `'${u}'`).join(", ");
      for (const status of ["sold", "retired", "lost"] as const) {
        for (const held of bike.units) {
          const run = sql(`
            begin;
            select platform_private.lock_units(array['${held}']::uuid[]);
            update platform.units set status = '${status}' where id in (${both});
            commit;
          `);
          expect(run.failed, `${where} ${status}`).toContain(
            "one_unit_status_change",
          );
          // The held one first, then the other in a statement of its own.
          const other = bike.units.find((u) => u !== held)!;
          const inTurn = sql(`
            begin;
            select platform_private.lock_units(array['${held}']::uuid[]);
            update platform.units set status = '${status}' where id = '${held}';
            update platform.units set status = '${status}' where id = '${other}';
            commit;
          `);
          expect(inTurn.failed, `${where} ${status}`).toContain(
            "one_unit_status_change",
          );
          // The other first (its lock taken by the guard), then the held one.
          const reversed = sql(`
            begin;
            select platform_private.lock_units(array['${held}']::uuid[]);
            update platform.units set status = '${status}' where id = '${other}';
            update platform.units set status = '${status}' where id = '${held}';
            commit;
          `);
          expect(reversed.failed, `${where} ${status}`).toContain(
            "one_unit_status_change",
          );
        }
        for (const row of await unitRows(bike.units))
          expect(row.status, `${where} ${status}`).toBe("active");
      }
      const locked = sql(`
        begin;
        select platform_private.lock_units(array[${both}]::uuid[]);
        update platform.units set status = 'retired' where id in (${both});
        commit;
      `);
      expect(locked.failed, where).toBe("");
      for (const row of await unitRows(bike.units))
        expect(row.status, where).toBe("retired");
    }
  });

  it("report_gear_problem() marks several units lost and writes several off, and set_stock_quantity() retires several, in one call each", async () => {
    for (const [where, tenant] of everyShop()) {
      const owner = tenant.members.owner.db;
      const created = await owner.rpc("create_general_product", {
        p_tenant_id: tenant.id,
        p_type: "gear",
        p_name: `Helmet ${tag} ${++counter}`,
        p_track_units: false,
        p_quantities: [{ location_id: tenant.locationId, quantity: 9 }],
      });
      expect(created.error, where).toBeNull();
      const helmet = created.data as string;
      const all = (
        await service
          .from("units")
          .select("id")
          .eq("product_id", helmet)
          .order("id")
          .throwOnError()
      ).data!.map((u) => u.id as string);
      // Every one has been out before: with a booking on record a unit
      // that leaves is retired (an update of its row), not deleted.
      for (const unit of all)
        await service
          .from("unit_blocks")
          .insert(await allocationFor(tenant.id, unit, hours(-50), hours(-40)))
          .throwOnError();

      // Three lost in one call: one update of three rows to lost.
      const lost = await owner.rpc("report_gear_problem", {
        p_product_id: helmet,
        p_location_id: tenant.locationId,
        p_kind: "lost",
        p_quantity: 3,
      });
      expect(lost.error, where).toBeNull();
      // Two written off in one call: one update of two rows to retired.
      const damaged = await owner.rpc("report_gear_problem", {
        p_product_id: helmet,
        p_location_id: tenant.locationId,
        p_kind: "damaged",
        p_quantity: 2,
      });
      expect(damaged.error, where).toBeNull();
      // Four left, set to one: three retired in one call.
      const fewer = await owner.rpc("set_stock_quantity", {
        p_product_id: helmet,
        p_location_id: tenant.locationId,
        p_quantity: 1,
      });
      expect(fewer.error, where).toBeNull();

      const rows = (
        await service
          .from("units")
          .select("id, status")
          .eq("product_id", helmet)
          .throwOnError()
      ).data!;
      const count = (status: string) =>
        rows.filter((r) => r.status === status).length;
      expect(rows, where).toHaveLength(9);
      expect([count("lost"), count("retired"), count("active")], where).toEqual(
        [3, 5, 1],
      );
    }
  });

  it(
    `report_gear_problem() against set_stock_quantity() on the same units of one product, released at the same instant: both finish, no deadlock (${ROUNDS} rounds, three shops)`,
    async () => {
      const before = deadlocks();
      for (let round = 0; round < ROUNDS; round++) {
        const kind = round % 2 === 0 ? "lost" : "damaged";
        const scenes = [];
        for (const [where, tenant] of everyShop()) {
          const created = await tenant.members.owner.db.rpc(
            "create_general_product",
            {
              p_tenant_id: tenant.id,
              p_type: "gear",
              p_name: `Race helmet ${tag} ${++counter}`,
              p_track_units: false,
              p_quantities: [{ location_id: tenant.locationId, quantity: 8 }],
            },
          );
          expect(created.error, where).toBeNull();
          const helmet = created.data as string;
          // Every unit has a booking on record, so a unit that leaves is
          // retired (an update), never deleted.
          const units = (
            await service
              .from("units")
              .select("id")
              .eq("product_id", helmet)
              .throwOnError()
          ).data!;
          for (const unit of units)
            await service
              .from("unit_blocks")
              .insert(
                await allocationFor(
                  tenant.id,
                  unit.id as string,
                  hours(-50),
                  hours(-40),
                ),
              )
              .throwOnError();
          scenes.push({ where, tenant, helmet });
        }
        const results = await sameInstant(
          scenes.flatMap(({ tenant, helmet }) => [
            {
              as: tenant.members.owner.id,
              sql: `select platform.report_gear_problem('${helmet}', '${tenant.locationId}', '${kind}', 3);`,
            },
            {
              as: tenant.members.manager.id,
              sql: `select platform.set_stock_quantity('${helmet}', '${tenant.locationId}', 4);`,
            },
          ]),
        );
        noDeadlock(results, `round ${round}`);
        for (const r of results) expect(r.failed, `round ${round}`).toBe("");
        for (const { where, helmet } of scenes) {
          const rows = (
            await service
              .from("units")
              .select("status")
              .eq("product_id", helmet)
              .throwOnError()
          ).data!;
          const count = (status: string) =>
            rows.filter((r) => r.status === status).length;
          // Nothing deleted, nothing half-done.
          expect(rows, `${where} round ${round}`).toHaveLength(8);
          if (kind === "lost") {
            expect(count("lost"), `${where} round ${round}`).toBe(3);
            // The count was set to 4 before the three were lost (1 left),
            // or after (4 left).
            expect([1, 4], `${where} round ${round}`).toContain(
              count("active"),
            );
          } else {
            expect([1, 4], `${where} round ${round}`).toContain(
              count("active"),
            );
            expect(count("retired"), `${where} round ${round}`).toBe(
              8 - count("active"),
            );
          }
        }
      }
      expect(await deadlocksReported()).toBe(before);
    },
    RACE_TIMEOUT,
  );
});

describe("lost at any time (decision 19)", () => {
  it("a unit that is out, with a booking ahead, is marked lost: the rental stays open, its future blocks are kept, downtime from now on is cleared", async () => {
    for (const [where, tenant] of everyShop()) {
      const bike = await vehicle(tenant, 1);
      const [unit] = bike.units;
      // Out since two hours ago, back in five.
      const outNow = await allocationFor(tenant.id, unit!, hours(-2), hours(5));
      await service.from("unit_blocks").insert(outNow).throwOnError();
      await service
        .from("reservations")
        .update({ state: "out" })
        .eq("id", outNow.reservation_id!)
        .throwOnError();
      // A booking ahead, through create_order().
      const ahead = await createOrder(tenant.members.staff.db, tenant.id, {
        channel: "walk_in",
        mode: "staff",
        lines: [
          {
            product_id: bike.id,
            location_id: tenant.locationId,
            starts_at: hours(48).toISOString(),
            ends_at: hours(72).toISOString(),
            quantity: 1,
          },
        ],
      });
      expect(ahead.error, where).toBeNull();
      expect((ahead.data as { ok: boolean }).ok, where).toBe(true);
      // A service booked for next week.
      await tenant.members.mechanic.db
        .from("unit_blocks")
        .insert({
          tenant_id: tenant.id,
          unit_id: unit!,
          kind: "downtime",
          period: period(hours(200), hours(210)),
        })
        .throwOnError();

      const blocks = async () =>
        (
          await service
            .from("unit_blocks")
            .select("kind, period, reservation_id")
            .eq("unit_id", unit!)
            .order("period")
            .throwOnError()
        ).data!;
      const before = await blocks();
      expect(
        before.map((b) => b.kind),
        where,
      ).toEqual(["allocation", "allocation", "downtime"]);

      // Staff may mark a unit lost.
      const lost = await tenant.members.staff.db
        .from("units")
        .update({ status: "lost" })
        .eq("id", unit!)
        .select("status");
      expect(lost.error, where).toBeNull();
      expect(lost.data, where).toEqual([{ status: "lost" }]);

      // Both bookings' blocks exactly as they were; the service is gone.
      expect(await blocks(), where).toEqual(before.slice(0, 2));
      const states = (
        await service
          .from("reservations")
          .select("state")
          .in(
            "id",
            before.slice(0, 2).map((b) => b.reservation_id!),
          )
          .throwOnError()
      ).data!.map((r) => r.state);
      expect(states.sort(), where).toEqual(["out", "reserved"]);

      // Selling or retiring is still refused while blocks lie ahead.
      const other = await vehicle(tenant, 1);
      await service
        .from("unit_blocks")
        .insert(
          await allocationFor(tenant.id, other.units[0]!, hours(48), hours(72)),
        )
        .throwOnError();
      for (const status of ["sold", "retired"]) {
        const refused = await tenant.members.owner.db
          .from("units")
          .update({ status })
          .eq("id", other.units[0]!)
          .select("id");
        expect(refused.error?.message, `${where} ${status}`).toBe(
          "unit_has_future_blocks",
        );
      }
    }
  });
});

describe("review_catalog_request(): products before the catalog entry; the listing is left alone", () => {
  async function requested(tenant: TestTenant) {
    const product = await vehicle(tenant, 1);
    const { data, error } = await tenant.members.owner.db.rpc(
      "submit_product_to_catalog",
      {
        p_product_id: product.id,
        p_year: 2024,
        p_type: "city_scooter",
        p_note: "Please add",
        p_make: "Lockmake",
        p_model: `LM ${tag} ${++counter}`,
        p_cc: 125,
        p_transmission: "automatic",
      },
    );
    if (error) throw error;
    catalogIds.push(data as string);
    return { product, entry: data as string };
  }

  const reviewSql = (entry: string, approve: boolean, mergeInto?: string) =>
    `select platform.review_catalog_request('${entry}', ${approve}, null, ${mergeInto ? `'${mergeInto}'` : "null"});`;

  it("crossing: a product being deleted has its row and asks for the entry while a review is under way: one waits, no deadlock", async () => {
    for (const [where, tenant] of everyShop()) {
      const before = deadlocks();
      const { product, entry } = await requested(tenant);
      await service.from("units").delete().eq("product_id", product.id);
      // Someone holds the product's row for a moment (a booking, say).
      const marker = `holds-product-${tag}-${++counter}`;
      const gate = await closedGate();
      const holder = sqlBackground(`
        begin;
        select 1 from platform.products where id = '${product.id}' for share;
        ${gate.wait(marker)}
        commit;
      `);
      await holding(marker, holder);
      // The delete queues for the row first; the review arrives second.
      const removal = sqlBackground(
        `begin;\n${actingAs(tenant.members.owner.id)}\ndelete from platform.products where id = '${product.id}';\ncommit;`,
      );
      await seenWaitingForLock("delete from platform.products");
      const review = sqlBackground(
        `begin;\n${actingAs(admin.id)}\n${reviewSql(entry, true)}\ncommit;`,
      );
      await seenWaitingForLock("review_catalog_request");
      await gate.open();
      const [held, removed, reviewed] = await Promise.all([
        holder,
        removal,
        review,
      ]);
      expect(held.failed, where).toBe("");
      expect(removed.failed, where).toBe("");
      // The product went first, and its request with it.
      expect(reviewed.failed, where).not.toMatch(/deadlock/i);
      expect(reviewed.failed, where).toContain("Catalog request not found");
      expect(await deadlocksReported(), where).toBe(before);
    }
  }, 180_000);

  it(
    `a review against the product's delete, released at the same instant: no deadlock (${ROUNDS} rounds, three shops)`,
    async () => {
      const before = deadlocks();
      for (let round = 0; round < ROUNDS; round++) {
        const scenes = [];
        for (const [where, tenant] of everyShop()) {
          const scene = await requested(tenant);
          await service
            .from("units")
            .delete()
            .eq("product_id", scene.product.id);
          scenes.push({ where, tenant, ...scene });
        }
        const results = await sameInstant(
          scenes.flatMap(({ tenant, product, entry }) => [
            { as: admin.id, sql: reviewSql(entry, round % 2 === 0) },
            {
              as: tenant.members.owner.id,
              sql: `delete from platform.products where id = '${product.id}';`,
            },
          ]),
        );
        noDeadlock(results, `round ${round}`);
        results.forEach((r, i) => {
          // The delete always goes through; the review does, or finds the
          // request withdrawn.
          if (i % 2 === 1) expect(r.failed, `round ${round}`).toBe("");
          else if (r.failed)
            expect(r.failed, `round ${round}`).toContain(
              "Catalog request not found",
            );
        });
        for (const { where, product } of scenes) {
          const left = await service
            .from("products")
            .select("id")
            .eq("id", product.id);
          expect(left.data, `${where} round ${round}`).toEqual([]);
        }
      }
      expect(await deadlocksReported()).toBe(before);
    },
    RACE_TIMEOUT,
  );

  it("a product linked to the entry between the review's two steps: try_again with nothing written; sent again, both products are approved and no listing is touched", async () => {
    for (const [where, tenant] of everyShop()) {
      const before = deadlocks();
      const { product, entry } = await requested(tenant);
      const late = await vehicle(tenant, 1);
      const state = async () => ({
        products: (
          await service
            .from("products")
            .select("id, catalog_id, catalog_approved_at")
            .in("id", [product.id, late.id])
            .order("id")
            .throwOnError()
        ).data!,
        entry: (
          await exactlyOne(
            service
              .schema("public")
              .from("bike_catalog")
              .select("status, reviewed_at")
              .eq("id", entry)
              .throwOnError(),
          )
        ).data!,
        listings: (
          await service
            .from("product_listings")
            .select("product_id")
            .in("product_id", [product.id, late.id])
            .throwOnError()
        ).data!,
        events: (
          await service
            .from("audit_events")
            .select("id", { count: "exact", head: true })
            .eq("entity", "bike_catalog")
            .eq("entity_id", entry)
            .in("action", ["approve", "merge", "reject"])
            .throwOnError()
        ).count,
      });

      // A second product is linked to the entry, written and not yet saved.
      const marker = `links-second-product-${tag}-${++counter}`;
      const gate = await closedGate();
      const linking = sqlBackground(`
        begin;
        update platform.products set catalog_id = '${entry}' where id = '${late.id}';
        ${gate.wait(marker)}
        commit;
      `);
      await holding(marker, linking);
      // The review locks the one product it can see, then waits for the
      // entry (the link's foreign key holds it).
      const review = sqlBackground(
        `begin;\n${actingAs(admin.id)}\n${reviewSql(entry, true)}\ncommit;`,
      );
      await seenWaitingForLock("review_catalog_request");
      await gate.open();
      expect((await linking).failed, where).toBe("");
      const first = await review;
      expect(first.failed, where).not.toMatch(/deadlock/i);
      expect(first.failed, where).toContain("try_again");
      // Nothing written: the second product is linked (its own doing), no
      // product is approved, the entry still waits, no review event.
      const after = await state();
      expect(
        after.products.map((p) => p.catalog_id),
        where,
      ).toEqual([entry, entry]);
      expect(
        after.products.map((p) => p.catalog_approved_at),
        where,
      ).toEqual([null, null]);
      expect(after.entry, where).toEqual({
        status: "requested",
        reviewed_at: null,
      });
      expect(after.listings, where).toEqual([]);
      expect(after.events, where).toBe(0);

      // Sent again: both products approved, and still no listing.
      const second = await admin.db.rpc("review_catalog_request", {
        p_catalog_id: entry,
        p_approve: true,
      });
      expect(second.error, where).toBeNull();
      const done = await state();
      expect(done.entry.status, where).toBe("approved");
      expect(
        done.products.every((p) => p.catalog_approved_at !== null),
        where,
      ).toBe(true);
      expect(done.listings, where).toEqual([]);
      expect(done.events, where).toBe(1);
      expect(await deadlocksReported(), where).toBe(before);
    }
  }, 180_000);

  it("review_catalog_request() gives up on a lock after 6 seconds, like every function that waits for these rows", () => {
    const { out, failed } = sql(
      `select array_to_string(proconfig, ',') from pg_proc where oid = 'platform.review_catalog_request'::regproc;`,
    );
    expect(failed).toBe("");
    expect(out.split(",")).toContain("lock_timeout=6s");
    expect(out.split(",")).toContain('search_path=""');
    // And move_unit(), as before.
    expect(
      sql(
        `select array_to_string(proconfig, ',') from pg_proc where oid = 'platform.move_unit'::regproc;`,
      ).out.split(","),
    ).toContain("lock_timeout=6s");
  });

  it("approve and merge connect the product and leave its listing off; a listing that exists keeps its values; the shop then switches it on with save_listing()", async () => {
    const tenant = bangkok;
    const owner = tenant.members.owner.db;
    const row = async (productId: string) =>
      (
        await atMostOne(
          service
            .from("product_listings")
            .select(
              "enabled, instant_units, request_units, ready_now, updated_at",
            )
            .eq("product_id", productId)
            .throwOnError(),
        )
      ).data;
    const approved = async (productId: string) =>
      (
        await exactlyOne(
          service
            .from("products")
            .select("catalog_id, catalog_approved_at")
            .eq("id", productId)
            .throwOnError(),
        )
      ).data!;

    // Approve, no listing yet: none is made.
    const fresh = await requested(tenant);
    const first = await admin.db.rpc("review_catalog_request", {
      p_catalog_id: fresh.entry,
      p_approve: true,
    });
    expect(first.error).toBeNull();
    expect(await row(fresh.product.id)).toBeNull();
    expect(await approved(fresh.product.id)).toMatchObject({
      catalog_id: fresh.entry,
    });
    expect(
      (await approved(fresh.product.id)).catalog_approved_at,
    ).not.toBeNull();

    // Approve, with a listing the shop prepared (off): untouched.
    const prepared = await requested(tenant);
    await forceListing(tenant.id, prepared.product.id, {
      marketplace_listed: false,
      instant_units: 1,
      ready_now: 1,
    }).throwOnError();
    const before = await row(prepared.product.id);
    expect(before).toMatchObject({ enabled: false, instant_units: 1 });
    const second = await admin.db.rpc("review_catalog_request", {
      p_catalog_id: prepared.entry,
      p_approve: true,
    });
    expect(second.error).toBeNull();
    expect(await row(prepared.product.id)).toEqual(before);

    // Merge into the entry just approved: connected, listing as it was
    // (none for one product, off for the other).
    const mergedBare = await requested(tenant);
    const mergedPrepared = await requested(tenant);
    await forceListing(tenant.id, mergedPrepared.product.id, {
      marketplace_listed: false,
      instant_units: 1,
    }).throwOnError();
    const preparedBefore = await row(mergedPrepared.product.id);
    for (const scene of [mergedBare, mergedPrepared]) {
      const merged = await admin.db.rpc("review_catalog_request", {
        p_catalog_id: scene.entry,
        p_approve: false,
        p_merge_into: fresh.entry,
      });
      expect(merged.error).toBeNull();
      expect((merged.data as { decision: string }).decision).toBe("merge");
      expect(await approved(scene.product.id)).toMatchObject({
        catalog_id: fresh.entry,
      });
    }
    expect(await row(mergedBare.product.id)).toBeNull();
    expect(await row(mergedPrepared.product.id)).toEqual(preparedBefore);

    // A listing that is on stays on through an approval of another request
    // for the same product's entry: the function writes no listing at all.
    const body = sql(
      `select prosrc from pg_proc where proname = 'review_catalog_request' and pronamespace = 'platform'::regnamespace;`,
    ).out;
    expect(body).not.toMatch(/insert\s+into\s+platform\.product_listings/i);
    expect(body).not.toMatch(/enabled\s*=\s*true/i);

    // The shop switches each on itself, as for any connected vehicle.
    for (const scene of [fresh, prepared, mergedBare, mergedPrepared]) {
      const on = await setListing(owner, scene.product.id, {
        marketplace_listed: true,
      });
      expect(on.error).toBeNull();
      expect((await listingOf(scene.product.id)).marketplace_listed).toBe(true);
    }
    // And a later review of another request leaves a listing that is on, on.
    const again = await requested(tenant);
    const third = await admin.db.rpc("review_catalog_request", {
      p_catalog_id: again.entry,
      p_approve: false,
      p_merge_into: fresh.entry,
    });
    expect(third.error).toBeNull();
    expect((await listingOf(fresh.product.id)).marketplace_listed).toBe(true);
  });
});

describe("the whole file", () => {
  it("the database's own count of detected deadlocks did not move during this file", async () => {
    expect(await deadlocksReported()).toBe(deadlocksBefore);
  });
});
