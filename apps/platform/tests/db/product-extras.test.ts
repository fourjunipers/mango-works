/**
 * Phase 2, stage 5: extras in the database (migration 20261117000100;
 * docs/phase-2-plan.md §5.2, §6, §9.2).
 *
 * product_extras and what it refuses; save_product_extras() by every role
 * and shop against shop; a vehicle's own row winning over the "every
 * vehicle" row; pricing_inputs() with extras, the product name and the tax
 * profile in force; quote() fed by the adapter giving stage 4's pinned
 * figures; the lock order (a save against a booking and a move_unit(), held
 * in place and as a race, with no deadlock); and the lock timeout on
 * confirm_hold(), cancel_reservation(), assign_units() and move_unit(),
 * through the API. The race runs in three shops: Bangkok (THB), New York
 * (USD, daylight saving) and Saigon (VND).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { quote } from "@mango/core/quote";
import { readSnapshot, snapshotQuote } from "@mango/core/quote-snapshot";
import { extrasActions, extrasRoles } from "@/lib/extras-permissions";
import {
  extrasOf,
  pricingRowOf,
  quoteInputFor,
  seasonsFor,
  snapshotContextFor,
  type PricingInputs,
} from "@/lib/pricing-inputs";
import { roles, type Role } from "@/lib/roles";
import {
  assignUnits,
  cancelReservation,
  confirmHold,
  moveUnit,
  reserveAsStaff,
  type StaffDb,
} from "@/lib/staff-booking";
import {
  anonClient,
  createTenant,
  createUser,
  deleteTenant,
  deleteUser,
  serviceClient,
  sql,
  sqlBackground,
  type Db,
  type TestTenant,
  type TestUser,
} from "./helpers";

let shop: TestTenant;
let rival: TestTenant;
let newYork: TestTenant;
let saigon: TestTenant;
let outsider: TestUser;
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let counter = 0;
const name = (what: string) => `${what} ${tag} ${++counter}`;

/** How many times the race is run, in each shop. */
const ROUNDS = 10;
/** Race rounds run by this file, for the report. */
let raceRounds = 0;
let deadlocksBefore: number;

const db = (role: Role, tenant: TestTenant = shop): Db =>
  tenant.members[role].db;
const staffDb = (role: Role, tenant: TestTenant = shop) =>
  db(role, tenant) as unknown as StaffDb;

const MADE_UP = "00000000-0000-4000-8000-00000000abcd";

/** A moment far ahead: day `d` at `h` o'clock UTC. Every test has its own products. */
const at = (d: number, h = 0) =>
  new Date(Date.UTC(2033, 0, 1) + d * 86_400_000 + h * 3_600_000);

type Extra = {
  extra_product_id: string;
  included_quantity?: number;
  max_quantity?: number | null;
};
type Failure = { code?: string; message?: string } | null;

/** save_product_extras(); `vehicle` null is the "every vehicle" list. */
const save = (
  client: Db,
  tenant: TestTenant,
  vehicleId: string | null,
  extras: unknown,
): Promise<{ data: Extra[] | null; error: Failure }> =>
  Promise.resolve(
    client.rpc("save_product_extras", {
      p_tenant_id: tenant.id,
      p_product_id: vehicleId,
      p_extras: extras,
    } as never),
  ) as Promise<{ data: Extra[] | null; error: Failure }>;

/** A vehicle product with `count` units, made with the service role. */
async function vehicle(count: number, tenant: TestTenant = shop) {
  const product = await service
    .from("products")
    .insert({
      tenant_id: tenant.id,
      name: name("Scooter"),
      vehicle_type: "motorbike",
    })
    .select("id, name")
    .single()
    .throwOnError();
  const units = count
    ? await service
        .from("units")
        .insert(
          Array.from({ length: count }, () => ({
            tenant_id: tenant.id,
            product_id: product.data!.id,
            location_id: tenant.locationId,
            plate: `EX-${tag}-${++counter}`,
          })),
        )
        .select("id")
        .throwOnError()
    : { data: [] as { id: string }[] };
  return {
    id: product.data!.id,
    name: product.data!.name,
    units: units.data!.map((u) => u.id),
  };
}

/** Rental gear, a service or an item for sale, made as the owner. */
async function general(
  type: "gear" | "service" | "sale_item",
  quantity = 0,
  tenant: TestTenant = shop,
) {
  const label = name(type);
  const { data, error } = await db("owner", tenant).rpc(
    "create_general_product",
    {
      p_tenant_id: tenant.id,
      p_type: type,
      p_name: label,
      p_track_units: false,
      p_quantities:
        type === "service"
          ? []
          : [{ location_id: tenant.locationId, quantity }],
    },
  );
  if (error) throw error;
  return { id: data as string, name: label };
}

const rowsOf = async (tenant: TestTenant, vehicleId: string | null) => {
  const query = service
    .from("product_extras")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("sort_position");
  const { data } = await (
    vehicleId ? query.eq("product_id", vehicleId) : query.is("product_id", null)
  ).throwOnError();
  return data!;
};

const allRows = async (tenant: TestTenant) =>
  JSON.stringify(
    (
      await service
        .from("product_extras")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("id")
        .throwOnError()
    ).data,
  );

const events = async (tenant: TestTenant) =>
  (
    await service
      .from("audit_events")
      .select("entity_id, action, before, after, actor")
      .eq("tenant_id", tenant.id)
      .eq("entity", "product_extras")
      .order("id")
      .throwOnError()
  ).data!;

const inputs = async (
  client: Db,
  tenant: TestTenant,
  productIds: string[],
): Promise<PricingInputs> => {
  const { data, error } = await client.rpc("pricing_inputs", {
    p_tenant_id: tenant.id,
    p_product_ids: productIds,
  });
  if (error) throw error;
  return data as unknown as PricingInputs;
};

const price = async (
  productId: string,
  settings: Record<string, unknown>,
  tenant: TestTenant = shop,
) => {
  const { error } = await db("owner", tenant).rpc("save_product_pricing", {
    p_product_id: productId,
    p_settings: settings as never,
  });
  if (error) throw error;
};

type Line = {
  product_id: string;
  starts_at: Date;
  ends_at: Date;
  quantity?: number;
  parent?: number;
  unit_ids?: string[];
};
type Booked = {
  ok: true;
  booking_id: string;
  lines: { reservation_id: string; unit_ids: string[]; shortage: number }[];
};
type Answer = Booked | { ok: false; reason: string; line?: number | null };
type Result = { data: Answer | null; error: Failure };

const request = (
  tenant: TestTenant,
  channel: string,
  mode: string,
  lines: Line[],
  hold = false,
) => ({
  p_tenant_id: tenant.id,
  p_request: {
    channel,
    mode,
    ...(hold ? { hold: true } : {}),
    lines: lines.map((line) => ({
      ...line,
      location_id: tenant.locationId,
      starts_at: line.starts_at.toISOString(),
      ends_at: line.ends_at.toISOString(),
      quantity: line.quantity ?? 1,
    })),
  },
});

const staffBook = (
  lines: Line[],
  o: { tenant?: TestTenant; hold?: boolean; role?: Role } = {},
): Promise<Result> =>
  Promise.resolve(
    db(o.role ?? "staff", o.tenant ?? shop).rpc(
      "reserve",
      request(o.tenant ?? shop, "walk_in", "staff", lines, !!o.hold),
    ),
  ) as Promise<Result>;

const pageBook = (lines: Line[], tenant: TestTenant = shop): Promise<Result> =>
  Promise.resolve(
    service.rpc("reserve", request(tenant, "booking_page", "instant", lines)),
  ) as Promise<Result>;

const booked = (result: Result): Booked => {
  expect(result.error, result.error?.message).toBeNull();
  expect(result.data, JSON.stringify(result.data)).toMatchObject({ ok: true });
  return result.data as Booked;
};

/** Everything a booking writes in a shop, and every unit's place, as text. */
const written = (tenant: TestTenant) =>
  sql(`
    select (select count(*) from platform.reservations where tenant_id = '${tenant.id}')
      || ' reservations, '
      || (select coalesce(string_agg(state, ',' order by id), '') from platform.reservations where tenant_id = '${tenant.id}')
      || ' | ' || (select coalesce(string_agg(kind || ':' || unit_id, ',' order by id), '') from platform.unit_blocks where tenant_id = '${tenant.id}')
      || ' | ' || (select coalesce(string_agg(product_id::text, ',' order by id), '') from platform.units where tenant_id = '${tenant.id}')
      || ' | ' || (select count(*) from platform.audit_events where tenant_id = '${tenant.id}' and entity = 'bookings');
  `).out;

/** A background session that acts as a signed-in member, or as the server. */
const actingAs = (userId: string | null) =>
  userId
    ? `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: "authenticated" })}', true); set local role authenticated;`
    : `select set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role;`;

/** Waits until another session is running a statement carrying `marker`. */
async function holding(
  marker: string,
  session?: Promise<{ out: string; failed: string }>,
) {
  let ended: { out: string; failed: string } | undefined;
  void session?.then((result) => (ended = result));
  for (let i = 0; i < 100; i++) {
    if (ended)
      throw new Error(
        `The session ended before ${marker}: ${ended.failed || ended.out}`,
      );
    const { out } = sql(
      `select count(*) from pg_stat_activity where state = 'active' and query like '%${marker}%' and pid <> pg_backend_pid();`,
    );
    if (out === "1") return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`No session reached ${marker}`);
}

/** Polls `statement` until it answers something other than an empty string. */
async function until(statement: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const { out, failed } = sql(statement);
    expect(failed).toBe("");
    if (out) return out;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Never true: ${statement}`);
}

/**
 * The session running `needle` is waiting for a row (not an advisory lock):
 * answers the advisory locks it holds while it waits, by namespace.
 */
const waitingForRow = (needle: string) =>
  until(`
    select 'waiting for a row; product locks: ' || (
      select count(*) from pg_locks u
      where u.pid = w.pid and u.locktype = 'advisory' and u.classid = x'1a02'::int
    ) || ', unit locks: ' || (
      select count(*) from pg_locks u
      where u.pid = w.pid and u.locktype = 'advisory' and u.classid = x'1a01'::int
    )
    from pg_locks w
    join pg_stat_activity a on a.pid = w.pid
    where not w.granted and w.locktype in ('transactionid', 'tuple')
      and a.query like '%${needle}%' and a.pid <> pg_backend_pid()
    limit 1;
  `);

const deadlocks = () =>
  Number(
    sql(
      `select pg_stat_force_next_flush(); select deadlocks from pg_stat_database where datname = current_database();`,
    )
      .out.split("\n")
      .pop(),
  );

const noDeadlock = (results: { data?: unknown; error: Failure }[]) => {
  for (const result of results) {
    expect(result.error?.code, result.error?.message).not.toBe("40P01");
    expect(result.error?.message ?? "").not.toMatch(/deadlock/i);
    const data = result.data as { ok?: boolean; reason?: string } | null;
    if (data && data.ok === false) expect(data.reason).not.toBe("try_again");
  }
};

beforeAll(async () => {
  deadlocksBefore = deadlocks();
  [shop, rival, newYork, saigon, outsider] = await Promise.all([
    createTenant("extras-bkk", {
      country: "TH",
      currency: "THB",
      locale: "th-TH",
      timezone: "Asia/Bangkok",
    }),
    createTenant("extras-rival", {
      country: "TH",
      currency: "THB",
      locale: "th-TH",
      timezone: "Asia/Bangkok",
    }),
    createTenant("extras-nyc", {
      country: "US",
      currency: "USD",
      locale: "en-US",
      timezone: "America/New_York",
    }),
    createTenant("extras-sgn"),
    createUser("extras-outsider"),
  ]);
}, 180_000);

afterAll(async () => {
  console.log(`product-extras.test.ts: ${raceRounds} race rounds`);
  await Promise.all([
    deleteTenant(shop),
    deleteTenant(rival),
    deleteTenant(newYork),
    deleteTenant(saigon),
    deleteUser(outsider),
  ]);
}, 120_000);

describe("who may read and change a vehicle's extras", () => {
  it("the database's role table is the app's copy of it", () => {
    for (const action of [...extrasActions, "anything_else"]) {
      const { out } = sql(
        `select array_to_string(platform_private.extras_roles('${action}'), ',');`,
      );
      const inApp = extrasActions.includes(action as never)
        ? extrasRoles(action as (typeof extrasActions)[number])
        : [];
      expect(out.split(",").filter(Boolean).sort(), action).toEqual(
        [...inApp].sort(),
      );
    }
  });

  it("save_product_extras(): owners and managers save; staff, mechanics and drivers are refused and nothing is written", async () => {
    const scooter = await vehicle(0);
    const helmet = await general("gear", 3);
    for (const role of roles) {
      const before = await allRows(shop);
      const answer = await save(db(role), shop, scooter.id, [
        { extra_product_id: helmet.id, included_quantity: 1 },
      ]);
      const everyVehicle = await save(db(role), shop, null, []);
      if (extrasRoles("write").includes(role)) {
        expect(answer.error, role).toBeNull();
        expect(answer.data, role).toEqual([
          {
            extra_product_id: helmet.id,
            included_quantity: 1,
            max_quantity: null,
          },
        ]);
        expect(everyVehicle.error, role).toBeNull();
        await save(db(role), shop, scooter.id, []);
      } else {
        for (const refused of [answer, everyVehicle]) {
          expect(refused.error?.code, role).toBe("42501");
          expect(refused.error?.message, role).toBe("only_owner_or_manager");
        }
      }
      expect(await allRows(shop), role).toBe(before);
    }
  }, 60_000);

  it("another shop's five roles, a stranger, a signed-out visitor and the server are all refused, and the shop's lists are as they were", async () => {
    const scooter = await vehicle(0);
    const helmet = await general("gear", 3);
    await save(db("owner"), shop, scooter.id, [
      { extra_product_id: helmet.id, included_quantity: 2 },
    ]);
    const before = await allRows(shop);
    const callers: [string, Db][] = [
      ...roles.map((role): [string, Db] => [`rival ${role}`, db(role, rival)]),
      ["stranger", outsider.db],
      ["signed-out visitor", anonClient()],
      ["server", service],
    ];
    for (const [who, client] of callers) {
      for (const target of [scooter.id, null]) {
        const answer = await save(client, shop, target, []);
        expect(answer.error?.code, who).toBe("42501");
        expect(answer.data, who).toBeNull();
      }
    }
    expect(await allRows(shop)).toBe(before);
  }, 60_000);

  it("another shop's vehicle or extra is answered exactly like a made-up id, and that shop's rows are untouched", async () => {
    const mine = await vehicle(0);
    const myHelmet = await general("gear", 3);
    const theirs = await vehicle(0, rival);
    const theirHelmet = await general("gear", 3, rival);
    await save(db("owner", rival), rival, theirs.id, [
      { extra_product_id: theirHelmet.id, included_quantity: 1 },
    ]);
    const before = await allRows(rival);
    const one = (id: string) => [{ extra_product_id: id }];

    const theirVehicle = await save(
      db("owner"),
      shop,
      theirs.id,
      one(myHelmet.id),
    );
    const madeUpVehicle = await save(
      db("owner"),
      shop,
      MADE_UP,
      one(myHelmet.id),
    );
    expect(theirVehicle.error?.message).toBe("product_not_found");
    expect(theirVehicle.error).toEqual(madeUpVehicle.error);

    const theirExtra = await save(
      db("owner"),
      shop,
      mine.id,
      one(theirHelmet.id),
    );
    const madeUpExtra = await save(db("owner"), shop, mine.id, one(MADE_UP));
    expect(theirExtra.error?.message).toBe("extra_not_found");
    expect(theirExtra.error).toEqual(madeUpExtra.error);
    // The same in the "every vehicle" list.
    const everyVehicle = await save(
      db("owner"),
      shop,
      null,
      one(theirHelmet.id),
    );
    expect(everyVehicle.error).toEqual(madeUpExtra.error);

    // Naming the other shop itself: not a member of it.
    const asThem = await save(db("owner"), rival, theirs.id, []);
    expect(asThem.error?.message).toBe("only_owner_or_manager");
    expect(await allRows(rival)).toBe(before);
    expect(await rowsOf(shop, mine.id)).toEqual([]);
  }, 60_000);

  it("every member reads the shop's extras; nobody outside it does; nobody signed in writes the table directly", async () => {
    const scooter = await vehicle(0);
    const helmet = await general("gear", 3);
    await save(db("owner"), shop, scooter.id, [
      { extra_product_id: helmet.id, included_quantity: 2, max_quantity: 4 },
    ]);
    const [row] = await rowsOf(shop, scooter.id);
    const read = (client: Db) =>
      client.from("product_extras").select("id").eq("id", row.id);
    for (const role of roles) {
      expect((await read(db(role))).data, role).toEqual([{ id: row.id }]);
      expect((await read(db(role, rival))).data, `rival ${role}`).toEqual([]);
    }
    expect((await read(outsider.db)).data).toEqual([]);
    expect((await read(anonClient())).error?.code).toBe("42501");

    const before = await allRows(shop);
    for (const role of roles) {
      const client = db(role);
      const tries = await Promise.all([
        client.from("product_extras").insert({
          tenant_id: shop.id,
          extra_product_id: helmet.id,
          extra_product_type: "gear",
        }),
        client
          .from("product_extras")
          .update({ included_quantity: 9 })
          .eq("id", row.id),
        client.from("product_extras").delete().eq("id", row.id),
      ]);
      for (const attempt of tries) {
        expect(attempt.error?.code, role).toBe("42501");
      }
    }
    expect(await allRows(shop)).toBe(before);
  }, 60_000);
});

describe("save_product_extras(): the whole list in one call", () => {
  it("writes the list in the order given, keeps the rows that stay, removes the rest, and records one event per change", async () => {
    const scooter = await vehicle(0);
    const [helmet, lock, delivery] = await Promise.all([
      general("gear", 5),
      general("gear", 5),
      general("service"),
    ]);
    const first = await save(db("owner"), shop, scooter.id, [
      { extra_product_id: helmet.id, included_quantity: 2, max_quantity: 4 },
      { extra_product_id: delivery.id },
    ]);
    expect(first.error).toBeNull();
    const rows = await rowsOf(shop, scooter.id);
    expect(
      rows.map((r) => [
        r.extra_product_id,
        r.extra_product_type,
        r.included_quantity,
        r.max_quantity,
        r.sort_position,
        r.product_type,
      ]),
    ).toEqual([
      [helmet.id, "gear", 2, 4, 0, "vehicle"],
      [delivery.id, "service", 0, null, 1, "vehicle"],
    ]);

    // The same list again: nothing changes and nothing is recorded.
    const stamp = rows.map((r) => r.updated_at);
    await save(db("manager"), shop, scooter.id, [
      { extra_product_id: helmet.id, included_quantity: 2, max_quantity: 4 },
      {
        extra_product_id: delivery.id,
        included_quantity: 0,
        max_quantity: null,
      },
    ]);
    expect((await rowsOf(shop, scooter.id)).map((r) => r.updated_at)).toEqual(
      stamp,
    );

    // The delivery goes, a lock comes first, the helmet's allowance changes.
    const second = await save(db("manager"), shop, scooter.id, [
      { extra_product_id: lock.id, included_quantity: 1 },
      { extra_product_id: helmet.id, included_quantity: 1, max_quantity: null },
    ]);
    expect(second.data).toEqual([
      { extra_product_id: lock.id, included_quantity: 1, max_quantity: null },
      { extra_product_id: helmet.id, included_quantity: 1, max_quantity: null },
    ]);
    const after = await rowsOf(shop, scooter.id);
    expect(after.map((r) => r.extra_product_id)).toEqual([lock.id, helmet.id]);
    // The helmet's row is the same row.
    expect(after[1].id).toBe(rows[0].id);

    const mine = (await events(shop)).filter(
      (event) => event.entity_id === scooter.id,
    );
    expect(mine.map((event) => [event.action, event.actor])).toEqual([
      ["extras_change", shop.members.owner.id],
      ["extras_change", shop.members.manager.id],
    ]);
    expect(mine[1].before).toEqual({ extras: first.data });
    expect(mine[1].after).toEqual({ extras: second.data });

    // An empty list clears it.
    expect((await save(db("owner"), shop, scooter.id, [])).data).toEqual([]);
    expect(await rowsOf(shop, scooter.id)).toEqual([]);
  }, 60_000);

  it('the "every vehicle" list is saved the same way and is a list of its own', async () => {
    const scooter = await vehicle(0, rival);
    const helmet = await general("gear", 5, rival);
    const delivery = await general("service", 0, rival);
    await save(db("owner", rival), rival, scooter.id, [
      { extra_product_id: helmet.id, included_quantity: 2 },
    ]);
    const shopWide = await save(db("owner", rival), rival, null, [
      { extra_product_id: delivery.id },
      { extra_product_id: helmet.id, included_quantity: 1, max_quantity: 2 },
    ]);
    expect(shopWide.error).toBeNull();
    expect(
      (await rowsOf(rival, null)).map((r) => [
        r.extra_product_id,
        r.included_quantity,
        r.max_quantity,
      ]),
    ).toEqual([
      [delivery.id, 0, null],
      [helmet.id, 1, 2],
    ]);
    // The vehicle's own list is as it was.
    expect(
      (await rowsOf(rival, scooter.id)).map((r) => r.included_quantity),
    ).toEqual([2]);
    const last = (await events(rival)).pop()!;
    expect(last.entity_id).toBe("every_vehicle");
    await save(db("owner", rival), rival, null, []);
    expect(await rowsOf(rival, null)).toEqual([]);
    expect(
      (await rowsOf(rival, scooter.id)).map((r) => r.included_quantity),
    ).toEqual([2]);
    await save(db("owner", rival), rival, scooter.id, []);
  }, 60_000);

  it("refuses a most per vehicle below the included quantity, an extra of the wrong type, a parent that is not a vehicle, and every malformed list; all or nothing", async () => {
    const scooter = await vehicle(0);
    const other = await vehicle(0);
    const [helmet, delivery, oil] = await Promise.all([
      general("gear", 5),
      general("service"),
      general("sale_item", 5),
    ]);
    await save(db("owner"), shop, scooter.id, [
      { extra_product_id: helmet.id, included_quantity: 1 },
    ]);
    const before = await allRows(shop);
    const good = { extra_product_id: delivery.id };
    const cases: [string, string | null, unknown, string][] = [
      [
        "most below included",
        scooter.id,
        [
          {
            extra_product_id: helmet.id,
            included_quantity: 3,
            max_quantity: 2,
          },
        ],
        "invalid_extras",
      ],
      [
        "most of 0",
        scooter.id,
        [{ extra_product_id: helmet.id, max_quantity: 0 }],
        "invalid_extras",
      ],
      [
        "negative included",
        scooter.id,
        [{ extra_product_id: helmet.id, included_quantity: -1 }],
        "invalid_extras",
      ],
      [
        "included not whole",
        scooter.id,
        [{ extra_product_id: helmet.id, included_quantity: 1.5 }],
        "invalid_extras",
      ],
      [
        "included as text",
        scooter.id,
        [{ extra_product_id: helmet.id, included_quantity: "2" }],
        "invalid_extras",
      ],
      [
        "included over 1000",
        scooter.id,
        [{ extra_product_id: helmet.id, included_quantity: 1001 }],
        "invalid_extras",
      ],
      [
        "an unknown key",
        scooter.id,
        [{ extra_product_id: helmet.id, price: 1 }],
        "invalid_extras",
      ],
      [
        "no extra named",
        scooter.id,
        [{ included_quantity: 1 }],
        "invalid_extras",
      ],
      [
        "not a uuid",
        scooter.id,
        [{ extra_product_id: "helmet" }],
        "invalid_extras",
      ],
      ["the same extra twice", scooter.id, [good, good], "invalid_extras"],
      [
        "not a list",
        scooter.id,
        { extra_product_id: helmet.id },
        "invalid_extras",
      ],
      ["a list of text", scooter.id, [helmet.id], "invalid_extras"],
      [
        "more than 100",
        scooter.id,
        Array.from({ length: 101 }, () => good),
        "invalid_extras",
      ],
      // The wrong type: a vehicle, or an item for sale, as an extra.
      [
        "a vehicle as an extra",
        scooter.id,
        [{ extra_product_id: other.id }],
        "not_an_extra",
      ],
      [
        "itself as an extra",
        scooter.id,
        [{ extra_product_id: scooter.id }],
        "not_an_extra",
      ],
      [
        "an item for sale as an extra",
        scooter.id,
        [{ extra_product_id: oil.id }],
        "not_an_extra",
      ],
      [
        "an item for sale, every vehicle",
        null,
        [{ extra_product_id: oil.id }],
        "not_an_extra",
      ],
      // The parent must be a vehicle.
      ["gear as the parent", helmet.id, [good], "not_a_vehicle"],
      [
        "a service as the parent",
        delivery.id,
        [{ extra_product_id: helmet.id }],
        "not_a_vehicle",
      ],
      // One bad row refuses the good ones beside it.
      [
        "a good row and a bad one",
        scooter.id,
        [good, { extra_product_id: other.id }],
        "not_an_extra",
      ],
    ];
    for (const [what, target, list, message] of cases) {
      const answer = await save(db("owner"), shop, target, list);
      expect(answer.error?.message, what).toBe(message);
      expect(answer.data, what).toBeNull();
    }
    expect(await allRows(shop)).toBe(before);
  }, 60_000);

  it("the table itself holds the same rules, for a row written by hand as the server", async () => {
    const scooter = await vehicle(0);
    const other = await vehicle(0);
    const helmet = await general("gear", 5);
    const delivery = await general("service");
    const row = {
      tenant_id: shop.id,
      product_id: scooter.id,
      extra_product_id: helmet.id,
      extra_product_type: "gear",
    };
    const insert = async (more: Record<string, unknown>) => {
      const { error } = await service
        .from("product_extras")
        .insert({ ...row, ...more } as never);
      return `${error?.code} ${/"([a-z_]+)"[^"]*$/.exec(error?.message ?? "")?.[1]}`;
    };
    expect(await insert({ included_quantity: 3, max_quantity: 2 })).toBe(
      "23514 product_extras_max_not_below_included_check",
    );
    expect(await insert({ max_quantity: 0 })).toBe(
      "23514 product_extras_max_quantity_check",
    );
    expect(await insert({ included_quantity: -1 })).toBe(
      "23514 product_extras_included_quantity_check",
    );
    // A vehicle can't be an extra: not by its type, and not by lying about it.
    expect(
      await insert({
        extra_product_id: other.id,
        extra_product_type: "vehicle",
      }),
    ).toBe("23514 product_extras_extra_product_type_check");
    expect(await insert({ extra_product_id: other.id })).toBe(
      "23503 product_extras_tenant_id_extra_product_id_extra_product_ty_fkey",
    );
    expect(await insert({ extra_product_type: "service" })).toBe(
      "23503 product_extras_tenant_id_extra_product_id_extra_product_ty_fkey",
    );
    // The parent is a vehicle, of this shop.
    expect(await insert({ product_id: delivery.id })).toBe(
      "23503 product_extras_tenant_id_product_id_product_type_fkey",
    );
    expect(await insert({ product_type: "gear" })).toBe(
      "23514 product_extras_product_type_check",
    );
    const theirs = await vehicle(0, rival);
    expect(await insert({ product_id: theirs.id })).toBe(
      "23503 product_extras_tenant_id_product_id_product_type_fkey",
    );
    // One row per (vehicle or "every vehicle", extra).
    expect(await insert({})).toBe("undefined undefined");
    expect(await insert({})).toBe("23505 product_extras_one_per_extra_key");
    expect(await insert({ product_id: null })).toBe("undefined undefined");
    expect(await insert({ product_id: null })).toBe(
      "23505 product_extras_one_per_extra_key",
    );
    await service
      .from("product_extras")
      .delete()
      .eq("extra_product_id", helmet.id)
      .throwOnError();
  }, 60_000);

  it("a product that is deleted takes its links with it, as the vehicle or as the extra", async () => {
    const scooter = await vehicle(0);
    const helmet = await general("gear", 0);
    const delivery = await general("service");
    await save(db("owner"), shop, scooter.id, [
      { extra_product_id: helmet.id },
      { extra_product_id: delivery.id },
    ]);
    await save(db("owner"), shop, null, [{ extra_product_id: delivery.id }]);
    await service
      .from("products")
      .delete()
      .eq("id", delivery.id)
      .throwOnError();
    expect(
      (await rowsOf(shop, scooter.id)).map((r) => r.extra_product_id),
    ).toEqual([helmet.id]);
    expect(await rowsOf(shop, null)).toEqual([]);
    await service.from("products").delete().eq("id", scooter.id).throwOnError();
    const left = await service
      .from("product_extras")
      .select("id")
      .eq("extra_product_id", helmet.id)
      .throwOnError();
    expect(left.data).toEqual([]);
  }, 60_000);
});

describe("pricing_inputs() with extras, and quote() fed by the adapter", () => {
  let tenant: TestTenant;
  let scooter: { id: string; name: string };
  let tourer: { id: string; name: string };
  let helmet: { id: string; name: string };
  let delivery: { id: string; name: string };
  let cover: { id: string; name: string };
  let lock: { id: string; name: string };
  let vat: string;
  let insurance: string;
  const owner = () => db("owner", tenant);

  const bkk = (date: string) => new Date(`${date}T10:00:00+07:00`);
  /** A week: 7 rental days. */
  const week = {
    start: bkk("2027-11-01"),
    end: bkk("2027-11-08"),
    timeZone: "Asia/Bangkok",
  };

  beforeAll(async () => {
    tenant = await createTenant("extras-priced", {
      country: "TH",
      currency: "THB",
      locale: "th-TH",
      timezone: "Asia/Bangkok",
    });
    [scooter, tourer] = await Promise.all([
      vehicle(0, tenant),
      vehicle(0, tenant),
    ]);
    // The lock has no stock, so a test below can retire it.
    [helmet, delivery, cover, lock] = await Promise.all([
      general("gear", 10, tenant),
      general("service", 0, tenant),
      general("gear", 10, tenant),
      general("gear", 0, tenant),
    ]);
    const profile = async (label: string, rate: number) => {
      const { data, error } = await owner().rpc("save_tax_profile", {
        p_tenant_id: tenant.id,
        p_profile: { name: label, rate_bp: rate },
      });
      if (error) throw error;
      return data as unknown as string;
    };
    vat = await profile("VAT 7%", 700);
    insurance = await profile("Insurance", 0);
    await owner()
      .rpc("save_pricing_settings", {
        p_tenant_id: tenant.id,
        p_settings: { tax_inclusive: true, default_tax_profile_id: vat },
      })
      .throwOnError();
    // ฿200 a day; a week is ฿1,400 (stage 4's scooter).
    const perDay = (amount: number) => ({
      pricing_method: "per_period",
      price_amount: amount,
      price_period: "day",
    });
    await price(scooter.id, perDay(20_000), tenant);
    await price(tourer.id, perDay(50_000), tenant);
    // ฿50 a day, on the shop's default profile.
    await price(helmet.id, perDay(5_000), tenant);
    // Its own profile, not the default.
    await price(
      delivery.id,
      {
        pricing_method: "fixed",
        price_amount: 10_000,
        tax_profile_id: insurance,
      },
      tenant,
    );
    // Not taxable. The lock has no price yet.
    await price(cover.id, { ...perDay(3_000), taxable: false }, tenant);

    // With every vehicle: 1 helmet free, and a delivery. With the scooter:
    // 2 helmets free (its own row wins) and a lock.
    await save(owner(), tenant, null, [
      { extra_product_id: helmet.id, included_quantity: 1, max_quantity: 2 },
      { extra_product_id: delivery.id },
    ]);
    await save(owner(), tenant, scooter.id, [
      { extra_product_id: helmet.id, included_quantity: 2, max_quantity: 4 },
      { extra_product_id: lock.id, included_quantity: 1 },
    ]);
  }, 180_000);

  afterAll(async () => {
    await deleteTenant(tenant);
  });

  it("a vehicle's own row wins over the \"every vehicle\" row for the same extra; the rest of the shop's list still comes with it", async () => {
    const got = await inputs(owner(), tenant, [scooter.id, tourer.id]);
    expect(extrasOf(got, scooter.id)).toEqual([
      // Its own rows first, in their order.
      {
        product_id: scooter.id,
        extra_product_id: helmet.id,
        extra_product_type: "gear",
        included_quantity: 2,
        max_quantity: 4,
        sort_position: 0,
        every_vehicle: false,
      },
      {
        product_id: scooter.id,
        extra_product_id: lock.id,
        extra_product_type: "gear",
        included_quantity: 1,
        max_quantity: null,
        sort_position: 1,
        every_vehicle: false,
      },
      // From the shop's list: the delivery. Its helmet row lost.
      {
        product_id: scooter.id,
        extra_product_id: delivery.id,
        extra_product_type: "service",
        included_quantity: 0,
        max_quantity: null,
        sort_position: 1,
        every_vehicle: true,
      },
    ]);
    // A vehicle with no rows of its own gets the shop's list as it is.
    expect(
      extrasOf(got, tourer.id).map((row) => [
        row.extra_product_id,
        row.included_quantity,
        row.max_quantity,
        row.every_vehicle,
      ]),
    ).toEqual([
      [helmet.id, 1, 2, true],
      [delivery.id, 0, null, true],
    ]);
    expect(got.extras).toHaveLength(5);
  });

  it("returns the extras' own prices beside the vehicle asked for, each product's name, and the id of the tax profile in force", async () => {
    const got = await inputs(owner(), tenant, [scooter.id]);
    const byId = new Map(got.products.map((row) => [row.product_id, row]));
    // The lock has no price yet: it is offered (listed) and has no row.
    expect([...byId.keys()].sort()).toEqual(
      [scooter.id, helmet.id, delivery.id].sort(),
    );
    // On the shop's default profile: the default's id, not an empty column.
    expect(byId.get(scooter.id)).toMatchObject({
      product_name: scooter.name,
      product_type: "vehicle",
      tax_rate_bp: 700,
      tax_profile_id: vat,
      tax_profile_name: "VAT 7%",
    });
    expect(byId.get(helmet.id)).toMatchObject({
      product_name: helmet.name,
      tax_profile_id: vat,
    });
    // Its own profile: that one.
    expect(byId.get(delivery.id)).toMatchObject({
      product_name: delivery.name,
      product_type: "service",
      tax_rate_bp: 0,
      tax_profile_id: insurance,
      tax_profile_name: "Insurance",
    });
    const stored = await service
      .from("product_pricing")
      .select("product_id, tax_profile_id")
      .in("product_id", [scooter.id, delivery.id])
      .throwOnError();
    expect(
      Object.fromEntries(
        stored.data!.map((row) => [row.product_id, row.tax_profile_id]),
      ),
    ).toEqual({ [scooter.id]: null, [delivery.id]: insurance });
    // Not taxable: no rate, no profile.
    const [plain] = (await inputs(owner(), tenant, [cover.id])).products;
    expect(plain).toMatchObject({
      product_name: cover.name,
      taxable: false,
      tax_rate_bp: null,
      tax_profile_id: null,
      tax_profile_name: null,
    });
  });

  it("asked about gear or a service alone it returns no extras; a retired extra is not offered; an extra that is not a vehicle's is not there", async () => {
    expect(
      (await inputs(owner(), tenant, [helmet.id, delivery.id])).extras,
    ).toEqual([]);
    expect((await inputs(owner(), tenant, [])).extras).toEqual([]);
    await service
      .from("products")
      .update({ retired_at: new Date().toISOString() })
      .eq("id", lock.id)
      .throwOnError();
    const got = await inputs(owner(), tenant, [scooter.id]);
    expect(
      extrasOf(got, scooter.id).map((row) => row.extra_product_id),
    ).toEqual([helmet.id, delivery.id]);
    await service
      .from("products")
      .update({ retired_at: null })
      .eq("id", lock.id)
      .throwOnError();
  });

  it("by role: staff get what the owner gets; a mechanic and a driver get the extras and no price; the server reads it; another shop's member gets nothing", async () => {
    const asOwner = await inputs(owner(), tenant, [scooter.id]);
    for (const role of ["manager", "staff"] as const) {
      expect(
        await inputs(db(role, tenant), tenant, [scooter.id]),
        role,
      ).toEqual(asOwner);
    }
    for (const role of ["mechanic", "driver"] as const) {
      const got = await inputs(db(role, tenant), tenant, [scooter.id]);
      expect(got.extras, role).toEqual(asOwner.extras);
      expect(got.settings, role).toBeNull();
      expect(got.products, role).toEqual([]);
      expect(got.seasons, role).toEqual([]);
    }
    expect(await inputs(service, tenant, [scooter.id])).toEqual(asOwner);
    for (const client of [db("owner", rival), outsider.db]) {
      expect(await inputs(client, tenant, [scooter.id])).toEqual({
        settings: null,
        products: [],
        seasons: [],
        extras: [],
      });
    }
    const signedOut = await anonClient().rpc("pricing_inputs", {
      p_tenant_id: tenant.id,
      p_product_ids: [scooter.id],
    });
    expect(signedOut.error?.code).toBe("42501");
  });

  it("stage 4's pinned figures from real rows: 2 helmets included, 3 taken at ฿50 a day for 7 days is 1 charged, ฿350; two scooters and 5 helmets is 4 included, 1 charged", async () => {
    const got = await inputs(owner(), tenant, [scooter.id]);
    // The helmets name the scooter's line and have no dates of their own.
    const price1 = quote(
      quoteInputFor(got, [
        { id: "scooter", productId: scooter.id, quantity: 1, span: week },
        { id: "helmet", productId: helmet.id, quantity: 3, extraOf: "scooter" },
      ]),
    );
    if (!price1.ok) throw new Error("expected a price");
    expect(price1.lines[1]).toMatchObject({
      parentLineId: "scooter",
      quantity: 3,
      includedQuantity: 2,
      chargedQuantity: 1,
      listPrice: BigInt(35_000),
    });
    // The helmet took the scooter's dates: 7 days at ฿50.
    expect(price1.lines[1].unit.amount).toBe(BigInt(35_000));
    expect(price1.lines[0].listPrice).toBe(BigInt(140_000));
    expect(price1.totals.total).toBe(BigInt(175_000));
    // Prices include 7%: 175,000 × 7 ÷ 107.
    expect(price1.totals.vat).toBe(BigInt(11_449));

    const price2 = quote(
      quoteInputFor(got, [
        { id: "scooter", productId: scooter.id, quantity: 2, span: week },
        { id: "helmet", productId: helmet.id, quantity: 5, extraOf: "scooter" },
      ]),
    );
    if (!price2.ok) throw new Error("expected a price");
    expect(price2.lines[1]).toMatchObject({
      includedQuantity: 4,
      chargedQuantity: 1,
      listPrice: BigInt(35_000),
    });
    expect(price2.totals.total).toBe(BigInt(315_000));

    // Two scooters and 3 helmets: all 3 are free (4 would have been).
    const price3 = quote(
      quoteInputFor(got, [
        { id: "scooter", productId: scooter.id, quantity: 2, span: week },
        { id: "helmet", productId: helmet.id, quantity: 3, extraOf: "scooter" },
      ]),
    );
    if (!price3.ok) throw new Error("expected a price");
    expect(price3.lines[1]).toMatchObject({
      includedQuantity: 3,
      chargedQuantity: 0,
      listPrice: BigInt(0),
    });
    expect(price3.totals.total).toBe(BigInt(280_000));
  });

  it('the shop\'s "every vehicle" allowance prices a vehicle with no rows of its own; an extra with its own dates is priced on them; one that is not offered with the vehicle has nothing free', async () => {
    const got = await inputs(owner(), tenant, [tourer.id, cover.id]);
    const priced = quote(
      quoteInputFor(got, [
        { id: "tourer", productId: tourer.id, quantity: 1, span: week },
        // 1 free with every vehicle: 2 charged, 7 days at ฿50.
        { id: "helmet", productId: helmet.id, quantity: 3, extraOf: "tourer" },
        // Three of the seven days.
        {
          id: "late",
          productId: cover.id,
          quantity: 2,
          extraOf: "tourer",
          span: { ...week, end: bkk("2027-11-04") },
        },
        {
          id: "delivery",
          productId: delivery.id,
          quantity: 1,
          extraOf: "tourer",
        },
      ]),
    );
    if (!priced.ok) throw new Error("expected a price");
    expect(
      priced.lines.map((line) => [
        line.id,
        line.includedQuantity,
        line.chargedQuantity,
        line.listPrice,
      ]),
    ).toEqual([
      ["tourer", 0, 1, BigInt(350_000)],
      ["helmet", 1, 2, BigInt(70_000)],
      // Not offered with it: nothing free. 2 × 3 days × ฿30.
      ["late", 0, 2, BigInt(18_000)],
      ["delivery", 0, 1, BigInt(10_000)],
    ]);
    expect(priced.totals.total).toBe(BigInt(448_000));
  });

  it("a priced extra whose id sorts before the vehicle's comes first in the read: the vehicle's row is found by id, and a season for the extra alone is not one of the vehicle's (review of PR 43)", async () => {
    // An id that sorts before any random one, and a vehicle priced by
    // rental length, as a Moto Mangos listing needs.
    const firstId = `00000000-0000-4000-8000-${tag.padEnd(12, "0")}`.replace(
      /[^0-9a-f-]/g,
      "0",
    );
    await service
      .from("products")
      .insert({
        id: firstId,
        tenant_id: tenant.id,
        type: "service",
        tracking: "none",
        name: name("Airport pickup"),
      })
      .throwOnError();
    await price(
      firstId,
      { pricing_method: "fixed", price_amount: 30_000 },
      tenant,
    );
    const bike = await vehicle(0, tenant);
    await price(
      bike.id,
      {
        pricing_method: "tiered",
        own_list: {
          days: Array.from({ length: 30 }, (_, i) => ({
            day: i + 1,
            value: 20_000 * (i + 1),
            source: "manual",
          })),
        },
      },
      tenant,
    );
    await save(owner(), tenant, bike.id, [{ extra_product_id: firstId }]);
    const rule = async (label: string, productIds: string[] | null) => {
      const { error } = await owner().rpc("save_price_rule", {
        p_tenant_id: tenant.id,
        p_rule: {
          name: label,
          starts_on: "2028-01-01",
          ends_on: "2028-01-31",
          adjust_bp: 1000,
          ...(productIds
            ? { product_ids: productIds }
            : { all_products: true }),
        } as never,
      });
      if (error) throw error;
    };
    await rule("Pickups only", [firstId]);
    await rule("This bike", [bike.id]);
    await rule("Everything", null);

    const got = await inputs(owner(), tenant, [bike.id]);
    // The first row is the extra's, and it is not priced by rental length.
    // (The shop's "every vehicle" helmet and delivery are in the read too.)
    const ids = got.products.map((row) => row.product_id);
    expect(ids[0]).toBe(firstId);
    expect(ids.indexOf(bike.id)).toBeGreaterThan(0);
    expect(got.products[0].pricing_method).toBe("fixed");
    expect(pricingRowOf(got, bike.id)?.pricing_method).toBe("tiered");
    // All three seasons come back (the extra's is needed to price it)...
    expect(got.seasons.map((s) => s.name).sort()).toEqual([
      "Everything",
      "Pickups only",
      "This bike",
    ]);
    // ...and the bike's own are two of them.
    expect(
      seasonsFor(got, bike.id)
        .map((s) => s.name)
        .sort(),
    ).toEqual(["Everything", "This bike"]);
    await service
      .from("price_rules")
      .delete()
      .eq("tenant_id", tenant.id)
      .throwOnError();
    await service.from("products").delete().eq("id", firstId).throwOnError();
  }, 60_000);

  it("the snapshot is made from the same rows: the product's name, the profile in force by id and name, and the allowance per vehicle", async () => {
    const got = await inputs(owner(), tenant, [scooter.id]);
    const lines = [
      { id: "scooter", productId: scooter.id, quantity: 1, span: week },
      { id: "helmet", productId: helmet.id, quantity: 3, extraOf: "scooter" },
      {
        id: "delivery",
        productId: delivery.id,
        quantity: 1,
        extraOf: "scooter",
      },
    ];
    const stored = snapshotQuote(
      quoteInputFor(got, lines),
      snapshotContextFor(got, lines, {
        pricedAt: new Date("2027-10-01T03:00:00Z"),
      }),
    );
    const text = JSON.parse(JSON.stringify(stored)) as {
      lines: Record<string, unknown>[];
    };
    expect(
      text.lines.map((line) => [
        line.product_name,
        line.product_type,
        line.tax_profile_id,
        line.tax_profile_name,
        line.included_per_vehicle,
        line.amount,
      ]),
    ).toEqual([
      [scooter.name, "vehicle", vat, "VAT 7%", null, "140000"],
      [helmet.name, "gear", vat, "VAT 7%", 2, "35000"],
      [delivery.name, "service", insurance, "Insurance", 0, "10000"],
    ]);
    const back = readSnapshot(text);
    expect(back.currency).toBe("THB");
    expect(back.exponent).toBe(2);
    expect(back.totals.total).toBe(BigInt(185_000));
  });
});

describe("the lock order: a save against a booking and a move", () => {
  /** A scooter with units, helmets, a second product to move to, and a list. */
  async function scene(tenant: TestTenant = shop) {
    const scooter = await vehicle(2, tenant);
    const other = await vehicle(0, tenant);
    const helmet = await general("gear", 6, tenant);
    const delivery = await general("service", 0, tenant);
    await save(db("owner", tenant), tenant, scooter.id, [
      { extra_product_id: helmet.id, included_quantity: 1 },
    ]);
    const lines = (day: number): Line[] => [
      { product_id: scooter.id, starts_at: at(day), ends_at: at(day + 2) },
      {
        product_id: helmet.id,
        starts_at: at(day),
        ends_at: at(day + 2),
        quantity: 2,
        parent: 0,
      },
    ];
    const list = [
      { extra_product_id: helmet.id, included_quantity: 2, max_quantity: 4 },
      { extra_product_id: delivery.id },
    ];
    return { scooter, other, helmet, delivery, lines, list };
  }

  it("a booking of the scooter and its helmets, written and not yet saved: the save waits for the scooter's row holding no advisory lock, then goes through", async () => {
    const s = await scene();
    const marker = `extras-booking-held-${tag}`;
    const call = request(shop, "walk_in", "staff", s.lines(1));
    const booking = sqlBackground(`
      begin;
      ${actingAs(shop.members.staff.id)}
      select platform.reserve('${call.p_tenant_id}', '${JSON.stringify(call.p_request)}'::jsonb) ->> 'ok';
      select pg_sleep(3) /* ${marker} */;
      commit;
    `);
    await holding(marker, booking);
    const saving = save(db("owner"), shop, s.scooter.id, s.list);
    expect(await waitingForRow("save_product_extras")).toBe(
      "waiting for a row; product locks: 0, unit locks: 0",
    );
    const done = await booking;
    expect(done.failed).toBe("");
    expect(done.out).toContain("true");
    const saved = await saving;
    noDeadlock([saved]);
    expect(saved.data).toHaveLength(2);
    expect(deadlocks()).toBe(deadlocksBefore);
  }, 60_000);

  it("a save written and not yet saved: a booking of that scooter waits at the scooter's row with its product and unit locks in hand, then goes through", async () => {
    const s = await scene();
    const marker = `extras-save-held-${tag}`;
    const saving = sqlBackground(`
      begin;
      ${actingAs(shop.members.owner.id)}
      select jsonb_array_length(platform.save_product_extras(
        '${shop.id}', '${s.scooter.id}', '${JSON.stringify(s.list)}'::jsonb));
      select pg_sleep(3) /* ${marker} */;
      commit;
    `);
    await holding(marker, saving);
    const booking = staffBook(s.lines(1));
    const seen = await waitingForRow("reserve");
    expect(seen).toMatch(
      /^waiting for a row; product locks: 2, unit locks: [1-9]\d*$/,
    );
    const done = await saving;
    expect(done.failed).toBe("");
    expect(done.out).toContain("2");
    const result = await booking;
    noDeadlock([result]);
    expect(booked(result).lines.map((line) => line.unit_ids.length)).toEqual([
      1, 2,
    ]);
    expect(deadlocks()).toBe(deadlocksBefore);
  }, 60_000);

  it("a move_unit() of one of the scooter's units, written and not yet saved: the save waits for the scooter's row, and the other way round the move waits for it", async () => {
    const s = await scene();
    booked(await staffBook(s.lines(1)));
    const [unit] = (
      await service
        .from("unit_blocks")
        .select("unit_id, unit:units!inner(product_id)")
        .eq("unit.product_id", s.scooter.id)
        .throwOnError()
    ).data!.map((block) => block.unit_id);
    const marker = `extras-move-held-${tag}`;
    const moving = sqlBackground(`
      begin;
      ${actingAs(shop.members.manager.id)}
      select platform.move_unit('${shop.id}', '${unit}', '${s.other.id}', '${shop.locationId}') ->> 'ok';
      select pg_sleep(3) /* ${marker} */;
      commit;
    `);
    await holding(marker, moving);
    const saving = save(db("owner"), shop, s.scooter.id, s.list);
    expect(await waitingForRow("save_product_extras")).toBe(
      "waiting for a row; product locks: 0, unit locks: 0",
    );
    const moved = await moving;
    expect(moved.failed).toBe("");
    expect(moved.out).toContain("true");
    noDeadlock([await saving]);

    // The other way round: the save first, the move back behind it.
    const marker2 = `extras-save-held-move-${tag}`;
    const held = sqlBackground(`
      begin;
      ${actingAs(shop.members.owner.id)}
      select jsonb_array_length(platform.save_product_extras(
        '${shop.id}', '${s.scooter.id}', '[]'::jsonb));
      select pg_sleep(3) /* ${marker2} */;
      commit;
    `);
    await holding(marker2, held);
    const back = Promise.resolve(
      db("manager").rpc("move_unit", {
        p_tenant_id: shop.id,
        p_unit_id: unit,
        p_product_id: s.scooter.id,
        p_location_id: shop.locationId,
      }),
    );
    expect(await waitingForRow("move_unit")).toMatch(
      /^waiting for a row; product locks: [1-9]\d*, unit locks: 1$/,
    );
    expect((await held).failed).toBe("");
    const answer = await back;
    noDeadlock([answer as never]);
    expect(answer.data).toMatchObject({ ok: true, bookings: 1 });
    expect(deadlocks()).toBe(deadlocksBefore);
  }, 60_000);

  for (const [where, tenantOf] of [
    ["Bangkok", () => shop],
    ["New York", () => newYork],
    ["Saigon", () => saigon],
  ] as const) {
    it(`${where}: a save of the scooter's list, a save of the shop's list, two bookings, a move and the read, all at once, ${ROUNDS} rounds: every call answers cleanly and no deadlock`, async () => {
      const tenant = tenantOf();
      for (let round = 0; round < ROUNDS; round++) {
        const s = await scene(tenant);
        const shopWide = [
          { extra_product_id: s.delivery.id, included_quantity: 1 },
        ];
        const [savedOwn, savedShop, counter, online, moved, read] =
          await Promise.all([
            save(db("owner", tenant), tenant, s.scooter.id, s.list),
            save(db("manager", tenant), tenant, null, shopWide),
            staffBook(s.lines(1), { tenant }),
            pageBook(s.lines(1), tenant),
            Promise.resolve(
              db("manager", tenant).rpc("move_unit", {
                p_tenant_id: tenant.id,
                p_unit_id: s.scooter.units[round % 2],
                p_product_id: s.other.id,
                p_location_id: tenant.locationId,
              }),
            ),
            Promise.resolve(
              db("staff", tenant).rpc("pricing_inputs", {
                p_tenant_id: tenant.id,
                p_product_ids: [s.scooter.id, s.other.id],
              }),
            ),
          ]);
        raceRounds++;
        noDeadlock([
          savedOwn,
          savedShop,
          counter,
          online,
          moved as never,
          read as never,
        ]);
        for (const result of [savedOwn, savedShop, moved, read]) {
          expect(result.error, result.error?.message).toBeNull();
        }
        expect(moved.data).toMatchObject({ ok: true });
        // Both lists are exactly what was sent, whichever order they landed in.
        expect(savedOwn.data).toEqual(
          s.list.map((row) => ({
            included_quantity: 0,
            max_quantity: null,
            ...row,
          })),
        );
        expect(
          (await rowsOf(tenant, s.scooter.id)).map((r) => r.extra_product_id),
        ).toEqual(s.list.map((row) => row.extra_product_id));
        expect(
          (await rowsOf(tenant, null)).map((r) => [
            r.extra_product_id,
            r.included_quantity,
          ]),
        ).toEqual([[s.delivery.id, 1]]);
        // Two scooters, one of them moving away: each booking is whole or
        // refused, and at least one got its scooter and both helmets.
        const outcomes = [counter, online].map((result) => {
          expect(result.error, result.error?.message).toBeNull();
          return result.data!.ok ? "ok" : result.data!.reason;
        });
        expect(outcomes).toContain("ok");
        for (const out of outcomes)
          expect(["ok", "unavailable"]).toContain(out);
        const blocks = (
          await service
            .from("unit_blocks")
            .select("reservation_id")
            .eq("tenant_id", tenant.id)
            .not("reservation_id", "is", null)
            .throwOnError()
        ).data!.length;
        expect(blocks % 3).toBe(0);
        await save(db("owner", tenant), tenant, null, []);
      }
      expect(deadlocks()).toBe(deadlocksBefore);
    }, 240_000);
  }
});

describe("a lock that can't be had in time, through the API: each function gives up after its own 6 seconds with 55P03, before the API's 8-second limit, and the staff path answers try_again with nothing written", () => {
  /** Someone holds this product's lock for longer than anyone should wait. */
  const lockHeld = async (productId: string, marker: string) => {
    const holder = sqlBackground(`
      begin;
      select platform_private.lock_products_stock(
        array['${productId}']::uuid[], array['${shop.locationId}']::uuid[]);
      select pg_sleep(9) /* ${marker} */;
      commit;
    `);
    await holding(marker, holder);
    // Wrapped: returning the promise itself would wait for the 9 seconds.
    return { done: holder };
  };

  /**
   * The same call twice, at once, both through the API as signed-in staff:
   * what the database itself says, and what the staff path makes of it.
   */
  async function timedOut(
    productId: string,
    what: string,
    raw: (() => PromiseLike<{ data: unknown; error: Failure }>) | null,
    wrapped: (() => Promise<{ ok: boolean; reason?: string }>) | null,
  ) {
    const before = written(shop);
    const holder = await lockHeld(productId, `lock-timeout-${what}-${tag}`);
    const started = Date.now();
    const [direct, answer] = await Promise.all([raw?.(), wrapped?.()]);
    const waited = Date.now() - started;
    // lock_not_available, not the statement timeout (57014).
    if (direct) {
      expect(direct.error?.code, what).toBe("55P03");
      expect(direct.error?.message, what).toMatch(/lock timeout/);
      expect(direct.data, what).toBeNull();
    }
    if (answer) {
      expect(answer, what).toEqual({ ok: false, reason: "try_again" });
    }
    // After the function's 6 seconds, and before the API's 8.
    expect(waited, what).toBeGreaterThan(5_500);
    expect(waited, what).toBeLessThan(8_000);
    expect(written(shop), what).toBe(before);
    expect((await holder.done).failed).toBe("");
  }

  const oneDay = (bike: { id: string }, day: number): Line[] => [
    { product_id: bike.id, starts_at: at(day), ends_at: at(day + 1) },
  ];

  it("confirm_hold()", async () => {
    const bike = await vehicle(1);
    const hold = booked(await staffBook(oneDay(bike, 1), { hold: true }));
    const args = { p_tenant_id: shop.id, p_booking_id: hold.booking_id };
    await timedOut(
      bike.id,
      "confirm_hold",
      () => db("staff").rpc("confirm_hold", args),
      () => confirmHold(staffDb("manager"), shop.id, hold.booking_id),
    );
    // Sent again once the lock is free, it goes through.
    expect(
      await confirmHold(staffDb("staff"), shop.id, hold.booking_id),
    ).toMatchObject({ ok: true });
  }, 60_000);

  it("cancel_reservation()", async () => {
    const bike = await vehicle(1);
    const made = booked(await staffBook(oneDay(bike, 1)));
    await timedOut(
      bike.id,
      "cancel_reservation",
      () =>
        db("staff").rpc("cancel_reservation", {
          p_tenant_id: shop.id,
          p_booking_id: made.booking_id,
        }),
      () =>
        cancelReservation(staffDb("manager"), shop.id, {
          reservationId: made.lines[0].reservation_id,
        }),
    );
    expect(
      await cancelReservation(staffDb("staff"), shop.id, {
        bookingId: made.booking_id,
      }),
    ).toMatchObject({ ok: true });
  }, 60_000);

  it("assign_units()", async () => {
    const bike = await vehicle(2);
    const made = booked(await staffBook(oneDay(bike, 1)));
    const reservation = made.lines[0].reservation_id;
    const spare = bike.units.filter(
      (unit) => !made.lines[0].unit_ids.includes(unit),
    );
    await timedOut(
      bike.id,
      "assign_units",
      () =>
        db("staff").rpc("assign_units", {
          p_tenant_id: shop.id,
          p_reservation_id: reservation,
          p_unit_ids: spare,
        }),
      () => assignUnits(staffDb("manager"), shop.id, reservation, spare),
    );
    expect(
      await assignUnits(staffDb("staff"), shop.id, reservation, spare),
    ).toMatchObject({ ok: true });
  }, 60_000);

  it("move_unit()", async () => {
    const bike = await vehicle(1);
    const other = await vehicle(0);
    booked(await staffBook(oneDay(bike, 1)));
    const [unit] = bike.units;
    const to = { productId: other.id, locationId: shop.locationId };
    // One call at a time here. move_unit() takes two product locks (where
    // the unit is, where it goes): two moves of one unit sent at once would
    // also wait for each other, and two waits of under 6 seconds can add up
    // to the API's 8 (57014, which the staff path answers the same way).
    // The lock of the product it is on, held: what the database says.
    await timedOut(
      bike.id,
      "move_unit",
      () =>
        db("manager").rpc("move_unit", {
          p_tenant_id: shop.id,
          p_unit_id: unit,
          p_product_id: other.id,
          p_location_id: shop.locationId,
        }),
      null,
    );
    // The lock of the product it goes to, held: what the staff path says.
    await timedOut(other.id, "move_unit-destination", null, () =>
      moveUnit(staffDb("owner"), shop.id, { unitId: unit, ...to }),
    );
    expect(
      await moveUnit(staffDb("manager"), shop.id, { unitId: unit, ...to }),
    ).toMatchObject({ ok: true, bookings: 1 });
  }, 90_000);

  it("reserve() from the counter: the staff path answers try_again for it too", async () => {
    const bike = await vehicle(1);
    const line = {
      productId: bike.id,
      locationId: shop.locationId,
      start: at(1),
      end: at(2),
      quantity: 1,
    };
    await timedOut(
      bike.id,
      "reserve",
      () => staffBook(oneDay(bike, 1)),
      () =>
        reserveAsStaff(staffDb("staff"), shop.id, {
          channel: "walk_in",
          lines: [line],
        }),
    );
    expect(
      await reserveAsStaff(staffDb("staff"), shop.id, {
        channel: "phone",
        lines: [line],
      }),
    ).toMatchObject({ ok: true });
  }, 60_000);
});

describe("after every test in this file", () => {
  it("Postgres counted no deadlock", () => {
    expect(deadlocks()).toBe(deadlocksBefore);
  });
});
