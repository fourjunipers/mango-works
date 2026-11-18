/**
 * Phase 2, stage 1: the booking core (migration 20261116000100;
 * docs/phase-2-plan.md §3.1 to §3.4, §4, §9.2).
 *
 * reserve() and cancel_reservation() through the staff path (a signed-in
 * member) and the online path (the service role): what they write, what
 * they refuse, who may call them, shop against shop, and the races. The
 * races run in three shops: Bangkok (THB), New York (USD, daylight saving)
 * and Saigon (VND).
 *
 * The first test is the one the design rests on: a rolled-back
 * sub-transaction gives back its transaction-level advisory locks.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookingActions, bookingRoles } from "@/lib/booking-permissions";
import { roles, type Role } from "@/lib/roles";
import {
  anonClient,
  closedGate,
  createTenant,
  createUser,
  deleteTenant,
  deleteUser,
  period,
  serviceClient,
  sql,
  sqlAs,
  sqlBackground,
  type Db,
  type Gate,
  type TestTenant,
  type TestUser,
} from "./helpers";

let shop: TestTenant;
let newYork: TestTenant;
let saigon: TestTenant;
let outsider: TestUser;
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let counter = 0;
const name = (what: string) => `${what} ${tag} ${++counter}`;

/** How many times each two-sided race is run, in each shop. */
const ROUNDS = 20;
/** Detected deadlocks in this database before the first test. */
let deadlocksBefore: number;

const db = (role: Role, tenant: TestTenant = shop): Db =>
  tenant.members[role].db;

/** A moment far ahead: day `d` at `h` o'clock UTC. Every test has its own products. */
const at = (d: number, h = 0) =>
  new Date(Date.UTC(2031, 0, 1) + d * 86_400_000 + h * 3_600_000);

type Line = {
  product_id: string;
  location_id?: string;
  starts_at: Date | string;
  ends_at: Date | string;
  quantity?: number;
  parent?: number;
  unit_ids?: string[];
};
type Answer =
  | {
      ok: true;
      booking_id: string;
      lines: { reservation_id: string; unit_ids: string[]; shortage: number }[];
    }
  | { ok: false; reason: string; line: number | null };
type Result = {
  data: Answer | null;
  error: { code?: string; message?: string } | null;
};

const iso = (when: Date | string) =>
  typeof when === "string" ? when : when.toISOString();

function request(
  tenant: TestTenant,
  channel: string,
  mode: string,
  lines: Line[],
) {
  return {
    p_tenant_id: tenant.id,
    p_request: {
      channel,
      mode,
      lines: lines.map((line) => ({
        ...line,
        location_id: line.location_id ?? tenant.locationId,
        starts_at: iso(line.starts_at),
        ends_at: iso(line.ends_at),
        quantity: line.quantity ?? 1,
      })),
    },
  };
}

/** The staff path: a signed-in member at the counter. */
const staffBook = (
  role: Role,
  lines: Line[],
  tenant: TestTenant = shop,
  channel = "walk_in",
): Promise<Result> =>
  Promise.resolve(
    db(role, tenant).rpc("reserve", request(tenant, channel, "staff", lines)),
  ) as Promise<Result>;

/** The online path: the server, with the service role. */
const onlineBook = (
  lines: Line[],
  tenant: TestTenant = shop,
  channel = "booking_page",
  mode = "instant",
): Promise<Result> =>
  Promise.resolve(
    service.rpc("reserve", request(tenant, channel, mode, lines)),
  ) as Promise<Result>;

type CancelAnswer =
  | { ok: true; booking_id: string; reservation_ids: string[] }
  | { ok: false; reason: string };
const cancel = (
  client: Db,
  tenant: TestTenant,
  ids: { booking?: string; reservation?: string },
) =>
  Promise.resolve(
    client.rpc("cancel_reservation", {
      p_tenant_id: tenant.id,
      p_booking_id: ids.booking,
      p_reservation_id: ids.reservation,
    }),
  ) as Promise<{
    data: CancelAnswer | null;
    error: { code?: string; message?: string } | null;
  }>;

/** A vehicle product with `count` units, made with the service role. */
async function vehicle(
  count: number,
  options: { tenant?: TestTenant; before?: number; after?: number } = {},
) {
  const tenant = options.tenant ?? shop;
  const product = await service
    .from("products")
    .insert({
      tenant_id: tenant.id,
      name: name("Scooter"),
      vehicle_type: "motorbike",
      buffer_before_minutes: options.before ?? null,
      buffer_after_minutes: options.after ?? null,
    })
    .select("id")
    .single();
  if (product.error) throw product.error;
  const units = await service
    .from("units")
    .insert(
      Array.from({ length: count }, () => ({
        tenant_id: tenant.id,
        product_id: product.data.id,
        location_id: tenant.locationId,
        plate: `BK-${tag}-${++counter}`,
      })),
    )
    .select("id");
  if (units.error) throw units.error;
  return { id: product.data.id, units: units.data.map((u) => u.id) };
}

/** Rental gear, a service or an item for sale, made as the owner. */
async function general(
  type: "gear" | "service" | "sale_item",
  quantity = 0,
  options: { tenant?: TestTenant; track?: boolean } = {},
) {
  const tenant = options.tenant ?? shop;
  const { data, error } = await db("owner", tenant).rpc(
    "create_general_product",
    {
      p_tenant_id: tenant.id,
      p_type: type,
      p_name: name(type),
      p_track_units: options.track ?? false,
      p_quantities:
        type === "service"
          ? []
          : [{ location_id: tenant.locationId, quantity }],
    },
  );
  if (error) throw error;
  const units = await service
    .from("units")
    .select("id")
    .eq("product_id", data)
    .order("id");
  return { id: data as string, units: (units.data ?? []).map((u) => u.id) };
}

const reservationsOf = async (productId: string) =>
  (
    await service
      .from("reservations")
      .select("*")
      .eq("product_id", productId)
      .order("created_at")
      .order("id")
      .throwOnError()
  ).data!;

const blocksOf = async (productId: string) =>
  (
    await service
      .from("unit_blocks")
      .select(
        "id, unit_id, kind, period, reservation_id, created_by, unit:units!inner(product_id)",
      )
      .eq("unit.product_id", productId)
      .order("id")
      .throwOnError()
  ).data!;

/** Everything a booking writes in a shop, counted. */
async function written(tenant: TestTenant = shop) {
  const head = { count: "exact", head: true } as const;
  const [reservations, blocks, events] = await Promise.all([
    service.from("reservations").select("*", head).eq("tenant_id", tenant.id),
    service
      .from("unit_blocks")
      .select("*", head)
      .eq("tenant_id", tenant.id)
      .neq("kind", "downtime"),
    service
      .from("audit_events")
      .select("*", head)
      .eq("tenant_id", tenant.id)
      .eq("entity", "bookings"),
  ]);
  for (const { error } of [reservations, blocks, events]) {
    if (error) throw error;
  }
  return {
    reservations: reservations.count ?? 0,
    blocks: blocks.count ?? 0,
    events: events.count ?? 0,
  };
}

/** No call was ended by Postgres to break a deadlock, caught or not. */
const noDeadlock = (results: Result[] | { error: Result["error"] }[]) => {
  for (const result of results) {
    expect(result.error?.code, result.error?.message).not.toBe("40P01");
    expect(result.error?.message ?? "").not.toMatch(/deadlock/i);
    const data = (result as Result).data;
    if (data && data.ok === false) expect(data.reason).not.toBe("try_again");
  }
};

/** "ok" or the refusal's reason; a raised error fails the test. */
const outcome = (result: Result) => {
  expect(result.error, result.error?.message).toBeNull();
  return result.data!.ok ? "ok" : result.data!.reason;
};

/** Waits until another session is running a statement carrying `marker`. */
async function holding(
  marker: string,
  session?: Promise<{ out: string; failed: string }>,
) {
  // If the session that should be holding ends first, say why at once.
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

const deadlocks = () =>
  Number(
    sql(
      `select pg_stat_force_next_flush(); select deadlocks from pg_stat_database where datname = current_database();`,
    )
      .out.split("\n")
      .pop(),
  );

beforeAll(async () => {
  deadlocksBefore = deadlocks();
  [shop, newYork, saigon, outsider] = await Promise.all([
    createTenant("book-bkk", {
      country: "TH",
      currency: "THB",
      locale: "th-TH",
      timezone: "Asia/Bangkok",
    }),
    createTenant("book-nyc", {
      country: "US",
      currency: "USD",
      locale: "en-US",
      timezone: "America/New_York",
    }),
    createTenant("book-sgn"),
    createUser("book-outsider"),
  ]);
}, 120_000);

afterAll(async () => {
  await Promise.all([
    deleteTenant(shop),
    deleteTenant(newYork),
    deleteTenant(saigon),
    deleteUser(outsider),
  ]);
});

describe("first: what the pick-again design rests on", () => {
  it("a rolled-back sub-transaction gives back its transaction-level advisory locks, and keeps the ones taken before it", async () => {
    const space = 770_000 + Math.floor(Math.random() * 1000);
    const marker = `subxact-${tag}`;
    const gate = await closedGate();
    // Session A stays inside one transaction the whole time.
    const a = sqlBackground(`
      begin;
      select pg_advisory_xact_lock(${space}, 1);
      savepoint attempt;
      select pg_advisory_xact_lock(${space}, 2);
      select pg_advisory_xact_lock(${space}, 1);
      rollback to savepoint attempt;
      do $$ begin
        begin
          perform pg_advisory_xact_lock(${space}, 3);
          raise exception 'undo this attempt';
        exception when others then null;
        end;
      end $$;
      do $$ begin
        begin
          perform pg_advisory_xact_lock(${space}, 4);
        exception when others then null;
        end;
      end $$;
      select 'held:' || coalesce(string_agg(objid::text, ',' order by objid), '')
      from pg_locks
      where locktype = 'advisory' and classid = ${space} and granted
        and pid = pg_backend_pid();
      -- Stays open, at its gate, until session B has looked.
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    // Session B, while A's transaction is still open.
    const b = sql(`
      begin;
      select pg_try_advisory_xact_lock(${space}, 1)::text
        || ' ' || pg_try_advisory_xact_lock(${space}, 2)::text
        || ' ' || pg_try_advisory_xact_lock(${space}, 3)::text
        || ' ' || pg_try_advisory_xact_lock(${space}, 4)::text;
      commit;
    `);
    // B has looked: A may go on.
    await gate.open();
    expect(b.failed).toBe("");
    // 1: taken before the savepoint, and again inside it: still A's.
    // 2: taken inside a savepoint that was rolled back: free.
    // 3: taken inside a PL/pgSQL block that raised: free.
    // 4: taken inside a PL/pgSQL block that finished: still A's.
    expect(b.out.split("\n")).toContain("false true true false");
    const done = await a;
    expect(done.failed).toBe("");
    expect(done.out.split("\n")).toContain("held:1,4");
  });
});

describe("who may book", () => {
  it("is one table, the same in the database and in the app", () => {
    for (const action of bookingActions) {
      const { out } = sql(
        `select array_to_string(platform_private.booking_roles('${action}'), ',');`,
      );
      expect(out, action).toBe(bookingRoles(action).join(","));
    }
    expect(
      sql(
        `select cardinality(platform_private.booking_roles('nonsense'))::text;`,
      ).out,
    ).toBe("0");
  });

  it("owners, managers and staff book and cancel; mechanics and drivers are refused, and nothing is written for them", async () => {
    const bike = await vehicle(1);
    let day = 0;
    for (const role of roles) {
      const line = {
        product_id: bike.id,
        starts_at: at(day),
        ends_at: at(day + 1),
      };
      day += 2;
      const before = await written();
      const booked = await staffBook(role, [line]);
      expect(booked.error, role).toBeNull();
      if (!bookingRoles("reserve").includes(role)) {
        expect(booked.data, role).toEqual({
          ok: false,
          reason: "not_allowed",
          line: null,
        });
        expect(await written(), role).toEqual(before);
        continue;
      }
      expect(booked.data!.ok, role).toBe(true);
      const bookingId = (booked.data as { booking_id: string }).booking_id;

      // Cancelling: the same three roles. The others are refused first.
      for (const canceller of roles) {
        if (bookingRoles("cancel").includes(canceller)) continue;
        const refused = await cancel(db(canceller), shop, {
          booking: bookingId,
        });
        expect(refused.data, `${canceller} cancelling`).toEqual({
          ok: false,
          reason: "not_allowed",
        });
      }
      const cancelled = await cancel(db(role), shop, { booking: bookingId });
      expect(cancelled.data, role).toMatchObject({ ok: true });
    }
    expect((await reservationsOf(bike.id)).map((r) => r.state)).toEqual([
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
  });

  it("every role reads the shop's reservations and their blocks; nobody writes either by hand", async () => {
    const bike = await vehicle(2);
    const booked = await staffBook("staff", [
      { product_id: bike.id, starts_at: at(0), ends_at: at(1) },
    ]);
    expect(outcome(booked)).toBe("ok");
    const [row] = await reservationsOf(bike.id);
    const [block] = await blocksOf(bike.id);
    const freeUnit = bike.units.find((u) => u !== block.unit_id)!;

    for (const role of roles) {
      const seen = await db(role)
        .from("reservations")
        .select("id, state")
        .eq("id", row.id);
      expect(seen.data, role).toEqual([{ id: row.id, state: "reserved" }]);
      const seenBlock = await db(role)
        .from("unit_blocks")
        .select("id, kind, reservation_id")
        .eq("id", block.id);
      expect(seenBlock.data, role).toEqual([
        { id: block.id, kind: "allocation", reservation_id: row.id },
      ]);

      // By hand on the tables: refused for everyone, the owner included.
      const added = await db(role)
        .from("reservations")
        .insert({
          tenant_id: shop.id,
          booking_id: randomUUID(),
          product_id: bike.id,
          product_type: "vehicle",
          location_id: shop.locationId,
          starts_at: at(4).toISOString(),
          ends_at: at(5).toISOString(),
          block_period: period(at(4), at(5)),
          quantity: 1,
          channel: "walk_in",
          mode: "staff",
          state: "reserved",
        })
        .select("id");
      expect(added.error?.code, `${role} insert`).toBe("42501");
      const changed = await db(role)
        .from("reservations")
        .update({ state: "cancelled" })
        .eq("id", row.id)
        .select("id");
      expect(changed.error?.code, `${role} update`).toBe("42501");
      const removed = await db(role)
        .from("reservations")
        .delete()
        .eq("id", row.id)
        .select("id");
      expect(removed.error?.code, `${role} delete`).toBe("42501");

      // An allocation or a hold can't be written, moved, stretched or
      // removed by hand either.
      for (const kind of ["allocation", "hold"]) {
        const forged = await db(role)
          .from("unit_blocks")
          .insert({
            tenant_id: shop.id,
            unit_id: freeUnit,
            kind,
            period: period(at(0), at(1)),
            reservation_id: row.id,
          })
          .select("id");
        expect(forged.error?.code, `${role} ${kind}`).toBe("42501");
      }
      const moved = await db(role)
        .from("unit_blocks")
        .update({ unit_id: freeUnit })
        .eq("id", block.id)
        .select("id");
      expect(moved.data ?? [], `${role} moving a booking`).toEqual([]);
      const gone = await db(role)
        .from("unit_blocks")
        .delete()
        .eq("id", block.id)
        .select("id");
      expect(gone.data ?? [], `${role} deleting a booking`).toEqual([]);
    }
    expect(await reservationsOf(bike.id)).toEqual([row]);
    expect(await blocksOf(bike.id)).toEqual([block]);
  });

  it("the counter is a member's and online is the server's: neither may use the other's channel", async () => {
    const bike = await vehicle(1);
    const line = { product_id: bike.id, starts_at: at(0), ends_at: at(1) };
    const before = await written();
    for (const channel of ["booking_page", "marketplace", "api"]) {
      // A signed-in member, even the owner, can't book as an online channel.
      const member = await db("owner").rpc(
        "reserve",
        request(shop, channel, "instant", [line]),
      );
      expect(member.data, channel).toEqual({
        ok: false,
        reason: "not_allowed",
        line: null,
      });
    }
    for (const channel of ["walk_in", "phone"]) {
      const server = await service.rpc(
        "reserve",
        request(shop, channel, "staff", [line]),
      );
      expect(server.data, channel).toEqual({
        ok: false,
        reason: "not_allowed",
        line: null,
      });
    }
    expect(await written()).toEqual(before);

    // Each on its own side.
    expect(outcome(await staffBook("staff", [line], shop, "phone"))).toBe("ok");
    for (const [i, channel] of [
      "booking_page",
      "marketplace",
      "api",
    ].entries()) {
      const mode = i === 1 ? "now" : "instant";
      const ok = await onlineBook(
        [{ product_id: bike.id, starts_at: at(2 + i), ends_at: at(3 + i) }],
        shop,
        channel,
        mode,
      );
      // Since stage 3 a Moto Mangos booking needs the vehicle's listing
      // switched on. The server is let through to that check (it is not
      // answered not_allowed); tests/db/booking-rules.test.ts books a
      // listed vehicle through this channel.
      expect(outcome(ok), channel).toBe(
        channel === "marketplace" ? "not_listed" : "ok",
      );
    }
    expect(
      (await reservationsOf(bike.id)).map((r) => `${r.channel} ${r.mode}`),
    ).toEqual(["phone staff", "booking_page instant", "api instant"]);
  });

  it("a signed-in person with no membership is refused; a signed-out visitor can't call either function", async () => {
    const bike = await vehicle(1);
    const args = request(shop, "walk_in", "staff", [
      { product_id: bike.id, starts_at: at(0), ends_at: at(1) },
    ]);
    const before = await written();
    const stranger = await outsider.db.rpc("reserve", args);
    expect(stranger.data).toEqual({
      ok: false,
      reason: "not_allowed",
      line: null,
    });
    const strangerCancel = await cancel(outsider.db, shop, {
      booking: randomUUID(),
    });
    expect(strangerCancel.data).toEqual({ ok: false, reason: "not_allowed" });

    const anon = anonClient();
    const visitor = await anon.rpc("reserve", args);
    expect(visitor.error).not.toBeNull();
    expect(visitor.data).toBeNull();
    const visitorCancel = await anon.rpc("cancel_reservation", {
      p_tenant_id: shop.id,
      p_booking_id: randomUUID(),
    });
    expect(visitorCancel.error).not.toBeNull();
    expect(await written()).toEqual(before);

    // The helpers behind them are not the public's to call.
    for (const call of [
      `select platform_private.lock_products_stock(array['${bike.id}']::uuid[], array['${shop.locationId}']::uuid[])`,
      `select platform_private.hold_expiry(now(), 15)`,
      `select platform_private.expire_holds('${shop.id}', array['${bike.id}']::uuid[], array['${shop.locationId}']::uuid[], now())`,
      `select platform_private.release_expired_holds()`,
    ]) {
      expect(sqlAs(shop.members.owner.id, `${call};`).failed).toMatch(
        /permission denied/,
      );
    }
  });
});

describe("reserve(): what a booking writes", () => {
  it("staff: one reservation, one block on a real unit, who made it, and one audit event", async () => {
    const bike = await vehicle(2);
    const before = await written();
    const result = await staffBook("staff", [
      { product_id: bike.id, starts_at: at(3, 9), ends_at: at(5, 9) },
    ]);
    expect(result.error).toBeNull();
    const answer = result.data as Extract<Answer, { ok: true }>;
    expect(answer.ok).toBe(true);
    expect(answer.lines).toHaveLength(1);
    expect(answer.lines[0].shortage).toBe(0);
    expect(answer.lines[0].unit_ids).toHaveLength(1);
    expect(bike.units).toContain(answer.lines[0].unit_ids[0]);

    const rows = await reservationsOf(bike.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: answer.lines[0].reservation_id,
      tenant_id: shop.id,
      booking_id: answer.booking_id,
      parent_id: null,
      product_type: "vehicle",
      location_id: shop.locationId,
      quantity: 1,
      shortage: 0,
      channel: "walk_in",
      mode: "staff",
      state: "reserved",
      hold_expires_at: null,
      created_by: shop.members.staff.id,
    });
    expect(Date.parse(rows[0].starts_at)).toBe(at(3, 9).getTime());
    expect(Date.parse(rows[0].ends_at)).toBe(at(5, 9).getTime());

    const blocks = await blocksOf(bike.id);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      unit_id: answer.lines[0].unit_ids[0],
      kind: "allocation",
      reservation_id: rows[0].id,
      created_by: shop.members.staff.id,
    });
    expect(
      sql(
        `select (period = block_period)::text from platform.unit_blocks b join platform.reservations r on r.id = b.reservation_id where b.id = '${blocks[0].id}';`,
      ).out,
    ).toBe("true");

    expect(await written()).toEqual({
      reservations: before.reservations + 1,
      blocks: before.blocks + 1,
      events: before.events + 1,
    });
    const { data: events } = await service
      .from("audit_events")
      .select("entity, action, actor, after")
      .eq("entity_id", answer.booking_id);
    expect(events).toEqual([
      {
        entity: "bookings",
        action: "reserve",
        actor: shop.members.staff.id,
        after: {
          channel: "walk_in",
          mode: "staff",
          hold: false,
          hold_expires_at: null,
          lines: [
            {
              reservation_id: rows[0].id,
              unit_ids: answer.lines[0].unit_ids,
              shortage: 0,
              product_id: bike.id,
              location_id: shop.locationId,
              starts_at: expect.any(String),
              ends_at: expect.any(String),
              quantity: 1,
            },
          ],
        },
      },
    ]);
  });

  it("online: the same rows, made by nobody signed in", async () => {
    const bike = await vehicle(1);
    const result = await onlineBook([
      { product_id: bike.id, starts_at: at(3), ends_at: at(5) },
    ]);
    expect(outcome(result)).toBe("ok");
    const [row] = await reservationsOf(bike.id);
    expect(row).toMatchObject({
      channel: "booking_page",
      mode: "instant",
      state: "reserved",
      created_by: null,
    });
    const [block] = await blocksOf(bike.id);
    expect(block).toMatchObject({
      kind: "allocation",
      reservation_id: row.id,
      created_by: null,
    });
  });

  it("the window is widened by the product's buffers, so the gap between two rentals is the first one's after plus the second one's before", async () => {
    // One hour before, two hours after. Returned 10:00: next pickup 13:00.
    const bike = await vehicle(1, { before: 60, after: 120 });
    const first = await staffBook("owner", [
      { product_id: bike.id, starts_at: at(1, 10), ends_at: at(2, 10) },
    ]);
    expect(outcome(first)).toBe("ok");
    const [row] = await reservationsOf(bike.id);
    expect(
      sql(
        `select lower(block_period) = '${at(1, 9).toISOString()}' and upper(block_period) = '${at(2, 12).toISOString()}' from platform.reservations where id = '${row.id}';`,
      ).out,
    ).toBe("t");

    const tooSoon = await onlineBook([
      {
        product_id: bike.id,
        starts_at: new Date(at(2, 13).getTime() - 60_000),
        ends_at: at(3, 10),
      },
    ]);
    expect(tooSoon.data).toEqual({ ok: false, reason: "unavailable", line: 0 });
    const onTime = await onlineBook([
      { product_id: bike.id, starts_at: at(2, 13), ends_at: at(3, 10) },
    ]);
    expect(outcome(onTime)).toBe("ok");
    // And before the first one: must be back three hours before its pickup.
    const before = await staffBook("staff", [
      { product_id: bike.id, starts_at: at(0, 10), ends_at: at(1, 7) },
    ]);
    expect(outcome(before)).toBe("ok");
    expect(await blocksOf(bike.id)).toHaveLength(3);
  });

  it("best fit: the unit whose last block ends closest before the window, then the one whose next block starts soonest, and a unit with no earlier block last", async () => {
    const bike = await vehicle(4);
    const [a, b, c, d] = bike.units;
    const book = async (unit: string, from: Date, to: Date) =>
      expect(
        outcome(
          await staffBook("owner", [
            {
              product_id: bike.id,
              starts_at: from,
              ends_at: to,
              unit_ids: [unit],
            },
          ]),
        ),
      ).toBe("ok");
    // Before day 10: a ends day 4, b ends day 8, c ends day 8, d nothing.
    await book(a, at(3), at(4));
    await book(b, at(7), at(8));
    await book(c, at(7), at(8));
    // After day 11: b is next out on day 20, c on day 14.
    await book(b, at(20), at(21));
    await book(c, at(14), at(15));

    const pick = async () => {
      const result = await onlineBook([
        { product_id: bike.id, starts_at: at(10), ends_at: at(11) },
      ]);
      expect(outcome(result)).toBe("ok");
      return (result.data as Extract<Answer, { ok: true }>).lines[0]
        .unit_ids[0];
    };
    // b and c both ended closest (day 8); c's next block is sooner.
    expect(await pick()).toBe(c);
    expect(await pick()).toBe(b);
    expect(await pick()).toBe(a);
    // The one with no earlier block is kept whole until last.
    expect(await pick()).toBe(d);
    const none = await onlineBook([
      { product_id: bike.id, starts_at: at(10), ends_at: at(11) },
    ]);
    expect(none.data).toEqual({ ok: false, reason: "unavailable", line: 0 });
  });

  it("gear by the quantity: one block for every unit handed over", async () => {
    const helmet = await general("gear", 5);
    const three = await staffBook("staff", [
      { product_id: helmet.id, starts_at: at(1), ends_at: at(3), quantity: 3 },
    ]);
    expect(outcome(three)).toBe("ok");
    const taken = (three.data as Extract<Answer, { ok: true }>).lines[0]
      .unit_ids;
    expect(new Set(taken).size).toBe(3);
    expect(await blocksOf(helmet.id)).toHaveLength(3);

    const before = await written();
    const tooMany = await onlineBook([
      { product_id: helmet.id, starts_at: at(2), ends_at: at(4), quantity: 3 },
    ]);
    expect(tooMany.data).toEqual({ ok: false, reason: "unavailable", line: 0 });
    expect(await written()).toEqual(before);

    const two = await onlineBook([
      { product_id: helmet.id, starts_at: at(2), ends_at: at(4), quantity: 2 },
    ]);
    expect(outcome(two)).toBe("ok");
    const rest = (two.data as Extract<Answer, { ok: true }>).lines[0].unit_ids;
    expect(rest.filter((u) => taken.includes(u))).toEqual([]);
    // Free again once the first three are back.
    const later = await onlineBook([
      { product_id: helmet.id, starts_at: at(4), ends_at: at(5), quantity: 5 },
    ]);
    expect(outcome(later)).toBe("ok");
  });

  it("a service has a reservation and no block; an item for sale and a retired product can't be reserved", async () => {
    const delivery = await general("service");
    const bike = await vehicle(1);
    const booked = await staffBook("staff", [
      { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
      {
        product_id: delivery.id,
        starts_at: at(1),
        ends_at: at(2),
        quantity: 2,
        parent: 0,
      },
    ]);
    expect(outcome(booked)).toBe("ok");
    const answer = booked.data as Extract<Answer, { ok: true }>;
    expect(answer.lines[1].unit_ids).toEqual([]);
    const [serviceRow] = await reservationsOf(delivery.id);
    expect(serviceRow).toMatchObject({
      product_type: "service",
      quantity: 2,
      parent_id: answer.lines[0].reservation_id,
      booking_id: answer.booking_id,
    });
    expect(await blocksOf(delivery.id)).toEqual([]);

    const before = await written();
    const oil = await general("sale_item", 10);
    const sold = await staffBook("owner", [
      { product_id: oil.id, starts_at: at(1), ends_at: at(2) },
    ]);
    expect(sold.error?.message).toBe("not_reservable");

    const old = await vehicle(0);
    await service
      .from("products")
      .update({ retired_at: new Date().toISOString() })
      .eq("id", old.id)
      .throwOnError();
    const retired = await staffBook("owner", [
      { product_id: old.id, starts_at: at(1), ends_at: at(2) },
    ]);
    expect(retired.error?.message).toBe("product_not_found");
    expect(await written()).toEqual(before);
  });

  it("named units are the ones taken; a busy, parked or other product's unit is refused", async () => {
    const bike = await vehicle(3);
    const [a, b, c] = bike.units;
    const named = await staffBook("staff", [
      {
        product_id: bike.id,
        starts_at: at(1),
        ends_at: at(2),
        quantity: 2,
        unit_ids: [c, a],
      },
    ]);
    expect(outcome(named)).toBe("ok");
    expect(
      [
        ...(named.data as Extract<Answer, { ok: true }>).lines[0].unit_ids,
      ].sort(),
    ).toEqual([a, c].sort());

    const before = await written();
    const busy = await staffBook("staff", [
      {
        product_id: bike.id,
        starts_at: at(1, 12),
        ends_at: at(3),
        unit_ids: [a],
      },
    ]);
    expect(busy.data).toEqual({ ok: false, reason: "unit_taken", line: 0 });

    await service
      .from("units")
      .update({ status: "maintenance" })
      .eq("id", b)
      .throwOnError();
    const parked = await staffBook("staff", [
      { product_id: bike.id, starts_at: at(5), ends_at: at(6), unit_ids: [b] },
    ]);
    expect(parked.data).toEqual({ ok: false, reason: "unit_taken", line: 0 });
    // And it is not picked for a booking that names none.
    const none = await onlineBook([
      { product_id: bike.id, starts_at: at(1, 12), ends_at: at(3) },
    ]);
    expect(none.data).toEqual({ ok: false, reason: "unavailable", line: 0 });

    const otherBike = await vehicle(1);
    const wrongProduct = await staffBook("staff", [
      {
        product_id: bike.id,
        starts_at: at(5),
        ends_at: at(6),
        unit_ids: [otherBike.units[0]],
      },
    ]);
    expect(wrongProduct.error?.message).toBe("unit_not_found");
    expect(await written()).toEqual(before);
  });

  it("two lines for one product never share a unit, and a named unit is not picked for another line", async () => {
    const bike = await vehicle(2);
    const [a, b] = bike.units;
    const both = await staffBook("staff", [
      { product_id: bike.id, starts_at: at(1), ends_at: at(3) },
      { product_id: bike.id, starts_at: at(2), ends_at: at(4), unit_ids: [a] },
    ]);
    expect(outcome(both)).toBe("ok");
    const lines = (both.data as Extract<Answer, { ok: true }>).lines;
    expect(lines[0].unit_ids).toEqual([b]);
    expect(lines[1].unit_ids).toEqual([a]);

    // Three overlapping lines want three units; there are two.
    const before = await written();
    const tooMany = await staffBook("staff", [
      { product_id: bike.id, starts_at: at(10), ends_at: at(12) },
      { product_id: bike.id, starts_at: at(11), ends_at: at(13) },
      { product_id: bike.id, starts_at: at(11), ends_at: at(12) },
    ]);
    expect(tooMany.data).toEqual({ ok: false, reason: "unavailable", line: 2 });
    expect(await written()).toEqual(before);
    // Lines that don't overlap can share one.
    const inTurn = await staffBook("staff", [
      { product_id: bike.id, starts_at: at(10), ends_at: at(11), quantity: 2 },
      { product_id: bike.id, starts_at: at(11), ends_at: at(12), quantity: 2 },
    ]);
    expect(outcome(inTurn)).toBe("ok");
  });

  it("refuses a request that could not have come from our own code", async () => {
    const bike = await vehicle(1);
    const helmet = await general("gear", 2);
    const good = { product_id: bike.id, starts_at: at(1), ends_at: at(2) };
    const base = request(shop, "walk_in", "staff", [good]);
    const line = base.p_request.lines[0];
    const before = await written();
    const bad: [string, unknown][] = [
      ["not an object", []],
      ["no lines", { ...base.p_request, lines: [] }],
      ["an unknown key", { ...base.p_request, coupon: "TEN" }],
      ["an unknown channel", { ...base.p_request, channel: "fax" }],
      [
        "a member booking in an online mode",
        { ...base.p_request, mode: "instant" },
      ],
      [
        "an unknown line key",
        { ...base.p_request, lines: [{ ...line, price: 1 }] },
      ],
      [
        "no product",
        { ...base.p_request, lines: [{ ...line, product_id: null }] },
      ],
      [
        "a product that is not an id",
        { ...base.p_request, lines: [{ ...line, product_id: "x" }] },
      ],
      [
        "quantity zero",
        { ...base.p_request, lines: [{ ...line, quantity: 0 }] },
      ],
      [
        "quantity 1001",
        { ...base.p_request, lines: [{ ...line, quantity: 1001 }] },
      ],
      [
        "a fraction",
        { ...base.p_request, lines: [{ ...line, quantity: 1.5 }] },
      ],
      [
        "an end before the start",
        { ...base.p_request, lines: [{ ...line, ends_at: line.starts_at }] },
      ],
      [
        "a time with no offset",
        {
          ...base.p_request,
          lines: [{ ...line, starts_at: "2031-01-02T00:00:00" }],
        },
      ],
      [
        "a date that does not exist",
        {
          ...base.p_request,
          lines: [{ ...line, starts_at: "2031-02-30T00:00:00Z" }],
        },
      ],
      [
        "more units named than wanted",
        {
          ...base.p_request,
          lines: [{ ...line, unit_ids: [bike.units[0], randomUUID()] }],
        },
      ],
      [
        "the same unit twice",
        {
          ...base.p_request,
          lines: [
            { ...line, quantity: 2, unit_ids: [bike.units[0], bike.units[0]] },
          ],
        },
      ],
      [
        "a parent that is itself",
        { ...base.p_request, lines: [{ ...line, parent: 0 }] },
      ],
      [
        "a vehicle as an extra",
        { ...base.p_request, lines: [line, { ...line, parent: 0 }] },
      ],
      [
        "an extra of an extra",
        {
          ...base.p_request,
          lines: [
            line,
            { ...line, product_id: helmet.id, parent: 0 },
            { ...line, product_id: helmet.id, parent: 1 },
          ],
        },
      ],
      [
        "units named on gear that is not tracked one by one",
        {
          ...base.p_request,
          lines: [
            { ...line, product_id: helmet.id, unit_ids: [helmet.units[0]] },
          ],
        },
      ],
    ];
    for (const [what, p_request] of bad) {
      const { data, error } = await db("owner").rpc("reserve", {
        p_tenant_id: shop.id,
        p_request: p_request as never,
      });
      expect(data, what).toBeNull();
      expect(error?.message, what).toBe("invalid_request");
    }
    // Online never names a unit, and a request-mode booking holds none yet.
    for (const [what, p_request] of [
      [
        "online naming a unit",
        {
          channel: "api",
          mode: "instant",
          lines: [{ ...line, unit_ids: [bike.units[0]] }],
        },
      ],
      [
        "request mode",
        { channel: "marketplace", mode: "request", lines: [line] },
      ],
      [
        "online in staff mode",
        { channel: "marketplace", mode: "staff", lines: [line] },
      ],
    ] as const) {
      const { error } = await service.rpc("reserve", {
        p_tenant_id: shop.id,
        p_request: p_request as never,
      });
      expect(error?.message, what).toBe("invalid_request");
    }
    expect(await written()).toEqual(before);
  });

  it("tracked gear can be named unit by unit", async () => {
    const jacket = await general("gear", 2, { track: true });
    const named = await staffBook("staff", [
      {
        product_id: jacket.id,
        starts_at: at(1),
        ends_at: at(2),
        unit_ids: [jacket.units[1]],
      },
    ]);
    expect(outcome(named)).toBe("ok");
    expect((await blocksOf(jacket.id)).map((b) => b.unit_id)).toEqual([
      jacket.units[1],
    ]);
  });
});

describe("a booking that overlaps a downtime block is refused", () => {
  it("by the pick, by name, and by the constraint itself when a block is written by hand", async () => {
    const bike = await vehicle(1);
    const [unit] = bike.units;
    const down = await db("mechanic")
      .from("unit_blocks")
      .insert({
        tenant_id: shop.id,
        unit_id: unit,
        kind: "downtime",
        period: period(at(5), at(7)),
      })
      .select("id")
      .single();
    expect(down.error).toBeNull();
    const before = await written();

    for (const [from, to] of [
      [at(4), at(6)],
      [at(5), at(7)],
      [at(6), at(8)],
      [at(4), at(8)],
      [at(5, 12), at(6)],
    ]) {
      const product = { product_id: bike.id, starts_at: from, ends_at: to };
      expect((await staffBook("staff", [product])).data).toEqual({
        ok: false,
        reason: "unavailable",
        line: 0,
      });
      expect((await onlineBook([product])).data).toEqual({
        ok: false,
        reason: "unavailable",
        line: 0,
      });
      expect(
        (await staffBook("staff", [{ ...product, unit_ids: [unit] }])).data,
      ).toEqual({ ok: false, reason: "unit_taken", line: 0 });
    }
    expect(await written()).toEqual(before);

    // The constraint has the last word, whoever writes: a reservation made
    // by hand with the service role still can't put a block there.
    const reservation = await service
      .from("reservations")
      .insert({
        tenant_id: shop.id,
        booking_id: randomUUID(),
        product_id: bike.id,
        product_type: "vehicle",
        location_id: shop.locationId,
        starts_at: at(6).toISOString(),
        ends_at: at(8).toISOString(),
        block_period: period(at(6), at(8)),
        quantity: 1,
        channel: "api",
        mode: "instant",
        state: "reserved",
      })
      .select("id")
      .single();
    expect(reservation.error).toBeNull();
    const byHand = await service.from("unit_blocks").insert({
      tenant_id: shop.id,
      unit_id: unit,
      kind: "allocation",
      period: period(at(6), at(8)),
      reservation_id: reservation.data!.id,
    });
    expect(byHand.error?.code).toBe("23P01");

    // Right up to the downtime, and right after it, is fine.
    expect(
      outcome(
        await onlineBook([
          { product_id: bike.id, starts_at: at(4), ends_at: at(5) },
        ]),
      ),
    ).toBe("ok");
    expect(
      outcome(
        await staffBook("staff", [
          {
            product_id: bike.id,
            starts_at: at(7),
            ends_at: at(8),
            unit_ids: [unit],
          },
        ]),
      ),
    ).toBe("ok");
  });

  it("an allocation or a hold must belong to a reservation, and downtime to none", async () => {
    const bike = await vehicle(1);
    const [unit] = bike.units;
    for (const kind of ["allocation", "hold"]) {
      const bare = await service.from("unit_blocks").insert({
        tenant_id: shop.id,
        unit_id: unit,
        kind,
        period: period(at(1), at(2)),
      });
      expect(bare.error?.message, kind).toContain(
        "unit_blocks_reservation_check",
      );
    }
    const booked = await onlineBook([
      { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
    ]);
    const reservationId = (booked.data as Extract<Answer, { ok: true }>)
      .lines[0].reservation_id;
    const down = await service.from("unit_blocks").insert({
      tenant_id: shop.id,
      unit_id: unit,
      kind: "downtime",
      period: period(at(3), at(4)),
      reservation_id: reservationId,
    });
    expect(down.error?.message).toContain("unit_blocks_reservation_check");
    // A reservation can't be deleted from under its block.
    const removed = await service
      .from("reservations")
      .delete()
      .eq("id", reservationId);
    expect(removed.error?.code).toBe("23503");
  });
});

describe("all lines or none", () => {
  it("one line that can't be booked refuses the whole call, wherever it stands, and nothing is written", async () => {
    const bike = await vehicle(1);
    const helmet = await general("gear", 2);
    const delivery = await general("service");
    const full = await vehicle(1);
    expect(
      outcome(
        await onlineBook([
          { product_id: full.id, starts_at: at(0), ends_at: at(9) },
        ]),
      ),
    ).toBe("ok");

    const good: Line[] = [
      { product_id: bike.id, starts_at: at(1), ends_at: at(3) },
      {
        product_id: helmet.id,
        starts_at: at(1),
        ends_at: at(3),
        quantity: 2,
        parent: 0,
      },
      { product_id: delivery.id, starts_at: at(1), ends_at: at(3), parent: 0 },
    ];
    const blocked: Line = {
      product_id: full.id,
      starts_at: at(1),
      ends_at: at(3),
    };
    const before = await written();
    for (const position of [0, 1, 3]) {
      // The extras' parent is the first vehicle line, wherever that now is.
      const shift = position === 0 ? 1 : 0;
      const lines = good.map((line) =>
        line.parent === undefined ? line : { ...line, parent: shift },
      );
      lines.splice(position, 0, blocked);
      for (const book of [
        () => staffBook("staff", lines),
        () => onlineBook(lines),
      ]) {
        const result = await book();
        expect(result.data, `blocked line at ${position}`).toEqual({
          ok: false,
          reason: "unavailable",
          line: position,
        });
      }
    }
    // A named unit that is taken, as the last of four lines.
    const taken = await staffBook("staff", [
      ...good,
      { ...blocked, unit_ids: [full.units[0]] },
    ]);
    expect(taken.data).toEqual({ ok: false, reason: "unit_taken", line: 3 });
    // One helmet too many.
    const short = await staffBook("staff", [
      good[0],
      { ...good[1], quantity: 3 },
      good[2],
    ]);
    expect(short.data).toEqual({ ok: false, reason: "unavailable", line: 1 });
    expect(await written()).toEqual(before);
    expect(await blocksOf(bike.id)).toEqual([]);
    expect(await blocksOf(helmet.id)).toEqual([]);
    expect(await reservationsOf(delivery.id)).toEqual([]);

    // The same lines without the blocked one: all three, under one booking.
    const whole = await staffBook("staff", good);
    expect(outcome(whole)).toBe("ok");
    const answer = whole.data as Extract<Answer, { ok: true }>;
    expect(answer.lines.map((l) => l.unit_ids.length)).toEqual([1, 2, 0]);
    expect(await written()).toEqual({
      reservations: before.reservations + 3,
      blocks: before.blocks + 3,
      events: before.events + 1,
    });
    const rows = [
      ...(await reservationsOf(bike.id)),
      ...(await reservationsOf(helmet.id)),
      ...(await reservationsOf(delivery.id)),
    ];
    expect(new Set(rows.map((r) => r.booking_id))).toEqual(
      new Set([answer.booking_id]),
    );
    expect(rows.map((r) => r.parent_id)).toEqual([
      null,
      answer.lines[0].reservation_id,
      answer.lines[0].reservation_id,
    ]);
  });
});

describe("cancel_reservation()", () => {
  it("a booking that has not started: its blocks go, its rows say cancelled, and the unit can be booked again", async () => {
    const bike = await vehicle(1);
    const helmet = await general("gear", 2);
    const lines: Line[] = [
      { product_id: bike.id, starts_at: at(1), ends_at: at(3) },
      {
        product_id: helmet.id,
        starts_at: at(1),
        ends_at: at(3),
        quantity: 2,
        parent: 0,
      },
    ];
    const booked = await onlineBook(lines);
    const answer = booked.data as Extract<Answer, { ok: true }>;
    const before = await written();

    // The server cancels an online booking; staff could too.
    const cancelled = await cancel(service, shop, {
      booking: answer.booking_id,
    });
    expect(cancelled.error).toBeNull();
    expect(cancelled.data).toEqual({
      ok: true,
      booking_id: answer.booking_id,
      reservation_ids: answer.lines.map((l) => l.reservation_id).sort(),
    });
    expect(await blocksOf(bike.id)).toEqual([]);
    expect(await blocksOf(helmet.id)).toEqual([]);
    expect((await reservationsOf(bike.id)).map((r) => r.state)).toEqual([
      "cancelled",
    ]);
    expect((await reservationsOf(helmet.id)).map((r) => r.state)).toEqual([
      "cancelled",
    ]);
    expect(await written()).toEqual({
      reservations: before.reservations,
      blocks: before.blocks - 3,
      events: before.events + 1,
    });
    const { data: events } = await service
      .from("audit_events")
      .select("action, actor, after")
      .eq("entity_id", answer.booking_id)
      .eq("action", "cancel");
    expect(events).toEqual([
      {
        action: "cancel",
        actor: null,
        after: {
          reservation_ids: answer.lines.map((l) => l.reservation_id).sort(),
          lines: [...answer.lines]
            .sort((x, y) => x.reservation_id.localeCompare(y.reservation_id))
            .map((l) => ({
              reservation_id: l.reservation_id,
              unit_ids: l.unit_ids,
            })),
        },
      },
    ]);

    // Again: nothing left to cancel, and no second event.
    const again = await cancel(db("staff"), shop, {
      booking: answer.booking_id,
    });
    expect(again.data).toEqual({
      ok: true,
      booking_id: answer.booking_id,
      reservation_ids: [],
    });
    expect((await written()).events).toBe(before.events + 1);
    expect(outcome(await staffBook("staff", lines))).toBe("ok");
  });

  it("one row by its id takes its extras with it and leaves the rest of the booking", async () => {
    const bike = await vehicle(2);
    const helmet = await general("gear", 2);
    const booked = await staffBook("manager", [
      { product_id: bike.id, starts_at: at(1), ends_at: at(3) },
      { product_id: helmet.id, starts_at: at(1), ends_at: at(3), parent: 0 },
      { product_id: bike.id, starts_at: at(1), ends_at: at(3) },
      { product_id: helmet.id, starts_at: at(1), ends_at: at(3), parent: 2 },
    ]);
    const answer = booked.data as Extract<Answer, { ok: true }>;
    const cancelled = await cancel(db("manager"), shop, {
      reservation: answer.lines[0].reservation_id,
    });
    expect(cancelled.data).toEqual({
      ok: true,
      booking_id: answer.booking_id,
      reservation_ids: [
        answer.lines[0].reservation_id,
        answer.lines[1].reservation_id,
      ].sort(),
    });
    const states = new Map(
      [
        ...(await reservationsOf(bike.id)),
        ...(await reservationsOf(helmet.id)),
      ].map((r) => [r.id, r.state]),
    );
    expect(answer.lines.map((l) => states.get(l.reservation_id))).toEqual([
      "cancelled",
      "cancelled",
      "reserved",
      "reserved",
    ]);
    expect((await blocksOf(bike.id)).map((b) => b.reservation_id)).toEqual([
      answer.lines[2].reservation_id,
    ]);
    expect((await blocksOf(helmet.id)).map((b) => b.reservation_id)).toEqual([
      answer.lines[3].reservation_id,
    ]);
  });

  it("a booking that has started: its block is ended now and kept; one already collected can't be cancelled", async () => {
    const bike = await vehicle(2);
    const started = await staffBook("staff", [
      {
        product_id: bike.id,
        starts_at: new Date(Date.now() - 3_600_000),
        ends_at: new Date(Date.now() + 86_400_000),
      },
    ]);
    const first = started.data as Extract<Answer, { ok: true }>;
    expect(first.ok).toBe(true);
    const out = await staffBook("staff", [
      {
        product_id: bike.id,
        starts_at: new Date(Date.now() - 3_600_000),
        ends_at: new Date(Date.now() + 86_400_000),
      },
    ]);
    const second = out.data as Extract<Answer, { ok: true }>;
    // Nothing writes 'out' until Phase 3: set by hand.
    await service
      .from("reservations")
      .update({ state: "out" })
      .eq("id", second.lines[0].reservation_id)
      .throwOnError();

    const refused = await cancel(db("owner"), shop, {
      booking: second.booking_id,
    });
    expect(refused.data).toEqual({ ok: false, reason: "not_cancellable" });

    const cancelled = await cancel(db("owner"), shop, {
      booking: first.booking_id,
    });
    expect(cancelled.data).toMatchObject({ ok: true });
    const blocks = await blocksOf(bike.id);
    expect(blocks).toHaveLength(2);
    expect(
      sql(
        `select string_agg((upper(b.period) <= now())::text, ',' order by (b.reservation_id = '${first.lines[0].reservation_id}') desc) from platform.unit_blocks b where b.reservation_id in ('${first.lines[0].reservation_id}', '${second.lines[0].reservation_id}');`,
      ).out,
    ).toBe("true,false");
    // The unit that came back early can go out again from now.
    const again = await staffBook("staff", [
      {
        product_id: bike.id,
        starts_at: new Date(Date.now() + 60_000),
        ends_at: new Date(Date.now() + 86_400_000),
      },
    ]);
    expect(outcome(again)).toBe("ok");
  });

  it("needs exactly one of a booking and a row", async () => {
    for (const ids of [
      {},
      { booking: randomUUID(), reservation: randomUUID() },
    ]) {
      const { error } = await cancel(db("owner"), shop, ids);
      expect(error?.message).toBe("invalid_request");
    }
  });
});

describe("shop against shop: another shop's thing is answered exactly like one that does not exist", () => {
  it("reserve(): another shop, its product, its place and its unit", async () => {
    const mine = await vehicle(1);
    const theirs = await vehicle(1, { tenant: saigon });
    const theirHelmet = await general("gear", 1, {
      tenant: saigon,
      track: true,
    });
    const window = { starts_at: at(1), ends_at: at(2) };
    const before = [await written(shop), await written(saigon)];

    // Booking in a shop you are not in: every role, and the stranger.
    for (const role of roles) {
      const result = await db(role).rpc(
        "reserve",
        request(saigon, "walk_in", "staff", [
          { product_id: theirs.id, ...window },
        ]),
      );
      expect(result.data, role).toEqual({
        ok: false,
        reason: "not_allowed",
        line: null,
      });
    }

    // In your own shop, naming their product, place or unit. Each is tried
    // beside the same call with an id that does not exist.
    const cases: [string, Line, Line][] = [
      [
        "product_not_found",
        { product_id: theirs.id, ...window },
        { product_id: randomUUID(), ...window },
      ],
      [
        "product_not_found",
        { product_id: theirHelmet.id, ...window },
        { product_id: randomUUID(), ...window },
      ],
      [
        "location_not_found",
        { product_id: mine.id, location_id: saigon.locationId, ...window },
        { product_id: mine.id, location_id: randomUUID(), ...window },
      ],
      [
        "unit_not_found",
        { product_id: mine.id, unit_ids: [theirs.units[0]], ...window },
        { product_id: mine.id, unit_ids: [randomUUID()], ...window },
      ],
    ];
    for (const [message, foreign, missing] of cases) {
      for (const role of bookingRoles("reserve")) {
        const a = await staffBook(role, [foreign]);
        const b = await staffBook(role, [missing]);
        expect(a.data, message).toBeNull();
        expect(
          { code: a.error?.code, message: a.error?.message },
          `${role}: ${message}`,
        ).toEqual({ code: b.error?.code, message: b.error?.message });
        expect(a.error?.message, role).toBe(message);
      }
      // The server, booking for this shop, can't reach into the other.
      if (!foreign.unit_ids) {
        const online = await onlineBook([foreign]);
        expect(online.error?.message, `online: ${message}`).toBe(message);
      }
    }
    // As the second line of a booking whose first line is fine.
    const mixed = await staffBook("owner", [
      { product_id: mine.id, ...window },
      { product_id: theirs.id, ...window },
    ]);
    expect(mixed.error?.message).toBe("product_not_found");

    expect([await written(shop), await written(saigon)]).toEqual(before);
    expect(await blocksOf(mine.id)).toEqual([]);
    expect(await blocksOf(theirs.id)).toEqual([]);
  });

  it("cancel_reservation(): another shop's booking and row", async () => {
    const theirs = await vehicle(1, { tenant: saigon });
    const booked = await staffBook(
      "owner",
      [{ product_id: theirs.id, starts_at: at(1), ends_at: at(2) }],
      saigon,
    );
    const answer = booked.data as Extract<Answer, { ok: true }>;
    expect(answer.ok).toBe(true);
    const before = await written(saigon);
    const [row] = await reservationsOf(theirs.id);

    for (const role of roles) {
      // Saying it is the other shop: refused as someone who isn't in it.
      for (const ids of [
        { booking: answer.booking_id },
        { reservation: answer.lines[0].reservation_id },
      ]) {
        const direct = await cancel(db(role), saigon, ids);
        expect(direct.data, role).toEqual({ ok: false, reason: "not_allowed" });
      }
      if (!bookingRoles("cancel").includes(role)) continue;
      // Saying it is your own shop: no such booking, as for a made-up id.
      for (const [foreign, missing] of [
        [{ booking: answer.booking_id }, { booking: randomUUID() }],
        [
          { reservation: answer.lines[0].reservation_id },
          { reservation: randomUUID() },
        ],
      ]) {
        const a = await cancel(db(role), shop, foreign);
        const b = await cancel(db(role), shop, missing);
        expect(a.data, role).toEqual({ ok: false, reason: "not_found" });
        expect(a, role).toEqual(b);
      }
    }
    // The server too, when it names the wrong shop.
    const server = await cancel(service, shop, { booking: answer.booking_id });
    expect(server.data).toEqual({ ok: false, reason: "not_found" });

    expect(await written(saigon)).toEqual(before);
    expect(await reservationsOf(theirs.id)).toEqual([row]);
    expect(await blocksOf(theirs.id)).toHaveLength(1);
  });

  it("free_units(): another shop's product has no units to see, as the caller", async () => {
    const mine = await vehicle(2);
    const theirs = await vehicle(2, { tenant: saigon });
    const count = (userId: string, product: string, location: string) =>
      sqlAs(
        userId,
        `select count(*) from platform_private.free_units('${product}', '${location}', tstzrange('${at(1).toISOString()}', '${at(2).toISOString()}'));`,
      );
    for (const role of roles) {
      const own = count(shop.members[role].id, mine.id, shop.locationId);
      expect(own.failed, role).toBe("");
      expect(own.out.split("\n")).toContain("2");
      const foreign = count(
        shop.members[role].id,
        theirs.id,
        saigon.locationId,
      );
      expect(foreign.failed, role).toBe("");
      expect(foreign.out.split("\n")).toContain("0");
      const missing = count(shop.members[role].id, randomUUID(), randomUUID());
      expect(foreign.out).toBe(missing.out);
    }
    expect(
      count(outsider.id, mine.id, shop.locationId).out.split("\n"),
    ).toContain("0");
  });

  it("reservations: no member of one shop reads another's, by id or at all", async () => {
    const theirs = await vehicle(1, { tenant: saigon });
    await staffBook(
      "staff",
      [{ product_id: theirs.id, starts_at: at(1), ends_at: at(2) }],
      saigon,
    );
    const [row] = await reservationsOf(theirs.id);
    for (const role of roles) {
      const byId = await db(role)
        .from("reservations")
        .select("id")
        .eq("id", row.id);
      expect(byId.data, role).toEqual([]);
      const any = await db(role)
        .from("reservations")
        .select("tenant_id")
        .eq("tenant_id", saigon.id);
      expect(any.data, role).toEqual([]);
    }
    expect((await outsider.db.from("reservations").select("id")).data).toEqual(
      [],
    );
    expect(
      (await anonClient().from("reservations").select("id")).error,
    ).not.toBeNull();
  });
});

describe("unit_blocks.created_by is set in the database", () => {
  it("what a browser sends is overwritten, it can't be changed afterwards, and the service role leaves it empty", async () => {
    const bike = await vehicle(1);
    const [unit] = bike.units;
    const forged = await db("mechanic")
      .from("unit_blocks")
      .insert({
        tenant_id: shop.id,
        unit_id: unit,
        kind: "downtime",
        period: period(at(1), at(2)),
        created_by: shop.members.owner.id,
      })
      .select("id, created_by")
      .single();
    expect(forged.error).toBeNull();
    expect(forged.data!.created_by).toBe(shop.members.mechanic.id);

    for (const role of roles) {
      const changed = await db(role)
        .from("unit_blocks")
        .update({ created_by: shop.members[role].id })
        .eq("id", forged.data!.id)
        .select("id");
      expect(changed.error?.code, role).toBe("42501");
      const kind = await db(role)
        .from("unit_blocks")
        .update({ kind: "allocation" })
        .eq("id", forged.data!.id)
        .select("id");
      expect(kind.error?.code, role).toBe("42501");
    }
    // What the screens do change still works: the period and the note.
    const ended = await db("mechanic")
      .from("unit_blocks")
      .update({ period: period(at(1), at(1, 12)), note: "Done early" })
      .eq("id", forged.data!.id)
      .select("created_by, note");
    expect(ended.error).toBeNull();
    expect(ended.data).toEqual([
      { created_by: shop.members.mechanic.id, note: "Done early" },
    ]);

    const byServer = await service
      .from("unit_blocks")
      .insert({
        tenant_id: shop.id,
        unit_id: unit,
        kind: "downtime",
        period: period(at(3), at(4)),
        created_by: shop.members.owner.id,
      })
      .select("created_by")
      .single();
    expect(byServer.data!.created_by).toBeNull();
  });
});

describe("lock order", () => {
  it("while one booking holds a product's lock a second one waits, holding no unit lock", async () => {
    const bike = await vehicle(2);
    const marker = `hold-product-${tag}`;
    const gate = await closedGate();
    const holder = sqlBackground(`
      begin;
      select platform_private.lock_products_stock(
        array['${bike.id}']::uuid[], array['${shop.locationId}']::uuid[]);
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    const call = staffBook("staff", [
      { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
    ]);
    // The second booking is waiting on the product lock (namespace 1a02),
    // and has taken no unit lock (namespace 1a01) ahead of it. One
    // statement, so both are read at the same moment.
    const seen = await until(`
      select 'waiting, unit locks: ' || (
        select count(*) from pg_locks u
        where u.pid = w.pid and u.locktype = 'advisory' and u.classid = x'1a01'::int
      )
      from pg_locks w
      join pg_stat_activity a on a.pid = w.pid
      where w.locktype = 'advisory' and w.classid = x'1a02'::int and not w.granted
        and a.query like '%reserve%' and a.pid <> pg_backend_pid()
      limit 1;
    `);
    await gate.open();
    expect(seen).toBe("waiting, unit locks: 0");
    expect((await holder).failed).toBe("");
    expect(outcome(await call)).toBe("ok");
  }, 60_000);

  it("lock_products_stock takes a whole booking's pairs in the order of the locks' own keys, whatever order they come in", async () => {
    const pairs = Array.from({ length: 6 }, () => [randomUUID(), randomUUID()]);
    const values = pairs.map(([p, l]) => `('${p}', '${l}')`).join(",");
    // The keys lock_product_stock() would make, in lock order (signed).
    const keys = sql(`
      select string_agg((k::bigint & 4294967295)::text, ',' order by k)
      from (select distinct hashtext(p || ':' || l) k from (values ${values}) v(p, l)) x;
    `).out.split(",");
    expect(keys).toHaveLength(6);
    const last = keys[keys.length - 1];

    for (const order of [pairs, [...pairs].reverse()]) {
      // Someone holds the key that is last in lock order.
      const marker = `hold-last-key-${tag}-${++counter}`;
      const gate = await closedGate();
      const holder = sqlBackground(`
        begin;
        select pg_advisory_xact_lock(x'1a02'::int, (${last}::bigint - case when ${last} > 2147483647 then 4294967296 else 0 end)::int);
        ${gate.wait(marker)}
        commit;
      `);
      await holding(marker);
      const taker = sqlBackground(`
        begin;
        select platform_private.lock_products_stock(
          array[${order.map(([p]) => `'${p}'`).join(",")}]::uuid[],
          array[${order.map(([, l]) => `'${l}'`).join(",")}]::uuid[]);
        commit;
      `);
      // It waits on the last key with every earlier one already in hand.
      // One statement, so both are read at the same moment.
      const inHand = await until(`
        select (
          select string_agg(g.objid::text, ',' order by g.objid) from pg_locks g
          where g.pid = w.pid and g.locktype = 'advisory' and g.granted
            and g.classid = x'1a02'::int
        )
        from pg_locks w
        where w.locktype = 'advisory' and w.classid = x'1a02'::int and not w.granted
          and w.objid::bigint = ${last}
        limit 1;
      `);
      await gate.open();
      expect(inHand.split(",").sort()).toEqual(keys.slice(0, 5).sort());
      expect((await holder).failed).toBe("");
      expect((await taker).failed).toBe("");
    }
  }, 60_000);

  it("a block moved from one unit to another takes the two unit locks in key order, not in id order", async () => {
    // Two units whose ids and lock keys sort opposite ways.
    const bike = await vehicle(8);
    const pair = sql(`
      select a.id || ' ' || b.id
      from platform.units a, platform.units b
      where a.product_id = '${bike.id}' and b.product_id = '${bike.id}'
        and a.id < b.id and hashtext(a.id::text) > hashtext(b.id::text)
      limit 1;
    `).out;
    expect(pair, "no such pair among 8 units").not.toBe("");
    const [lowId, highId] = pair.split(" ");
    // By key, highId comes first. By id, lowId would.
    const block = await service
      .from("unit_blocks")
      .insert({
        tenant_id: shop.id,
        unit_id: lowId,
        kind: "downtime",
        period: period(at(1), at(2)),
      })
      .select("id")
      .single();
    expect(block.error).toBeNull();

    // Someone holds the lock that is second in key order.
    const marker = `hold-unit-${tag}`;
    const gate = await closedGate();
    const holder = sqlBackground(`
      begin;
      select pg_advisory_xact_lock(x'1a01'::int, hashtext('${lowId}'));
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    const move = Promise.resolve(
      service
        .from("unit_blocks")
        .update({ unit_id: highId })
        .eq("id", block.data!.id)
        .select("unit_id"),
    );
    // The mover already holds the first-by-key lock while it waits for the
    // second. In id order it would be waiting with nothing in hand. One
    // statement, so both are read at the same moment.
    const seen = await until(`
      select 'waiting, first lock in hand: ' || (
        select count(*) from pg_locks g
        where g.pid = w.pid and g.locktype = 'advisory' and g.granted
          and g.classid = x'1a01'::int
          and g.objid::bigint = (hashtext('${highId}')::bigint & 4294967295)
      )
      from pg_locks w
      where w.locktype = 'advisory' and w.classid = x'1a01'::int and not w.granted
        and w.objid::bigint = (hashtext('${lowId}')::bigint & 4294967295)
      limit 1;
    `);
    await gate.open();
    expect(seen).toBe("waiting, first lock in hand: 1");
    expect((await holder).failed).toBe("");
    const moved = await move;
    expect(moved.error).toBeNull();
    expect(moved.data).toEqual([{ unit_id: highId }]);
  }, 60_000);
  it("a unit that is taken between the pick and its lock is left out, and the booking picks again", async () => {
    // Two units. The first is the best fit: its last block ends just before
    // the window, the other has none.
    const bike = await vehicle(2);
    const [bestFit, spare] = bike.units;
    expect(
      outcome(
        await staffBook("owner", [
          {
            product_id: bike.id,
            starts_at: at(1),
            ends_at: at(2),
            unit_ids: [bestFit],
          },
        ]),
      ),
    ).toBe("ok");
    // A mechanic's downtime on the best fit, written but not yet saved:
    // the booking can't see it when it picks.
    const marker = `hold-downtime-${tag}`;
    const gate = await closedGate();
    const holder = sqlBackground(`
      begin;
      insert into platform.unit_blocks (tenant_id, unit_id, kind, period)
      values ('${shop.id}', '${bestFit}', 'downtime',
        tstzrange('${at(3).toISOString()}', '${at(5).toISOString()}'));
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    const call = onlineBook([
      { product_id: bike.id, starts_at: at(3), ends_at: at(4) },
    ]);
    // It picked the best fit and waits for that unit's lock, with its
    // product lock in hand.
    const seen = await until(`
      select 'waiting for the unit, product locks: ' || (
        select count(*) from pg_locks g
        where g.pid = w.pid and g.locktype = 'advisory' and g.granted
          and g.classid = x'1a02'::int
      )
      from pg_locks w
      where w.locktype = 'advisory' and w.classid = x'1a01'::int and not w.granted
        and w.objid::bigint = (hashtext('${bestFit}')::bigint & 4294967295)
      limit 1;
    `);
    await gate.open();
    expect(seen).toBe("waiting for the unit, product locks: 1");
    expect((await holder).failed).toBe("");
    // The downtime landed first. The booking read again under the lock,
    // undid that attempt and took the other unit.
    const result = await call;
    expect(outcome(result)).toBe("ok");
    expect(
      (result.data as Extract<Answer, { ok: true }>).lines[0].unit_ids,
    ).toEqual([spare]);
    const blocks = await blocksOf(bike.id);
    expect(
      blocks
        .map((b) => `${b.kind} ${b.unit_id === bestFit ? "best" : "spare"}`)
        .sort(),
    ).toEqual(["allocation best", "allocation spare", "downtime best"]);
    expect(await reservationsOf(bike.id)).toHaveLength(2);
  }, 60_000);

  it("with one unit, the same booking is refused once the downtime lands, and writes nothing", async () => {
    const bike = await vehicle(1);
    const before = await written();
    const marker = `hold-only-unit-${tag}`;
    const gate = await closedGate();
    const holder = sqlBackground(`
      begin;
      insert into platform.unit_blocks (tenant_id, unit_id, kind, period)
      values ('${shop.id}', '${bike.units[0]}', 'downtime',
        tstzrange('${at(3).toISOString()}', '${at(5).toISOString()}'));
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    let answered = false;
    const call = staffBook("staff", [
      { product_id: bike.id, starts_at: at(3), ends_at: at(4) },
    ]).then((answer) => {
      answered = true;
      return answer;
    });
    // It waits for the unit's lock, and has not answered while the downtime
    // is not yet saved.
    await until(`
      select 'waiting' from pg_locks w
      where w.locktype = 'advisory' and w.classid = x'1a01'::int and not w.granted
        and w.objid::bigint = (hashtext('${bike.units[0]}')::bigint & 4294967295)
      limit 1;
    `);
    const answeredEarly = answered;
    await gate.open();
    expect(answeredEarly, "answered before the downtime landed").toBe(false);
    const result = await call;
    expect((await holder).failed).toBe("");
    expect(result.data).toEqual({ ok: false, reason: "unavailable", line: 0 });
    expect(await written()).toEqual(before);
  }, 60_000);
  it("the picked unit's row is locked before the product's row: with the unit's row held by someone, the booking waits there and the product's row is still free", async () => {
    const bike = await vehicle(1);
    // Session 1 holds the unit's row and nothing else (no unit lock): a
    // delete or a key change that has got that far.
    const marker = `holds-unit-row-${tag}`;
    const gate = await closedGate();
    const holder = sqlBackground(`
      begin;
      select 1 from platform.units where id = '${bike.units[0]}' for update;
      ${gate.wait(marker)}
      commit;
    `);
    await holding(marker);
    // Session 2, the booking: it picks the unit, takes its lock, and stops
    // at its row.
    const call = onlineBook([
      { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
    ]);
    const seen = await until(`
      select 'waiting for a row, unit locks: ' || (
        select count(*) from pg_locks g
        where g.pid = a.pid and g.locktype = 'advisory' and g.granted
          and g.classid = x'1a01'::int
      )
      from pg_stat_activity a
      join pg_locks w on w.pid = a.pid and not w.granted
        and w.locktype in ('transactionid', 'tuple')
      where a.query like '%reserve%' and a.pid <> pg_backend_pid()
      limit 1;
    `);
    // Session 3 takes the product's row without waiting. It can: the
    // booking has not locked it yet. A booking that locked the product's
    // row first and met the unit's row at its block insert would be holding
    // it here, and this would fail with "could not obtain lock".
    const third = sql(`
      begin;
      select 'got the product row' from platform.products
      where id = '${bike.id}' for update nowait;
      commit;
    `);
    await gate.open();
    expect(seen).toBe("waiting for a row, unit locks: 1");
    expect(third.failed).toBe("");
    expect(third.out).toContain("got the product row");
    expect((await holder).failed).toBe("");
    const result = await call;
    noDeadlock([result]);
    expect(outcome(result)).toBe("ok");
  }, 60_000);

  it("a unit being deleted, stalled behind someone's edit of its product, against a booking that picked that unit: no deadlock, and the booking takes another unit or is refused", async () => {
    for (const units of [2, 1]) {
      const bike = await vehicle(units);
      // No block on either unit, so the pick goes by the lower lock key.
      const picked = sql(
        `select id from platform.units where product_id = '${bike.id}' order by hashtext(id::text), id limit 1;`,
      ).out;
      const before = deadlocks();

      // Session 1: someone is editing the product and has not saved yet.
      const editMarker = `edit-product-${tag}-${units}`;
      const gate = await closedGate();
      const editor = sqlBackground(`
        begin;
        update platform.products set description = 'Being edited' where id = '${bike.id}';
        ${gate.wait(editMarker)}
        commit;
      `);
      await holding(editMarker);
      // Session 2: the unit is deleted. Its row is gone (not yet for
      // anyone else), and the delete now waits for the product's row,
      // which a unit leaving always locks.
      const deleteMarker = `delete-unit-${tag}-${units}`;
      const deleter = sqlBackground(
        `delete from platform.units where id = '${picked}' /* ${deleteMarker} */;`,
      );
      await until(`
        select 'waiting' from pg_stat_activity
        where wait_event_type = 'Lock' and query like '%${deleteMarker}%'
          and pid <> pg_backend_pid()
        limit 1;
      `);
      // Session 3: a booking, which picks that unit: it can still see it.
      const call = onlineBook([
        { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
      ]);
      // It waits for the delete, having locked no row and written nothing
      // (no transaction id yet): it holds nothing the delete could come to
      // wait for. Since 20261116000200 a unit delete takes the unit's lock
      // (without waiting for it), so the booking now meets the delete one
      // step earlier, at the unit's lock, where stage 1 met it at the
      // unit's row.
      const seen = await until(`
        select 'waiting for the delete, nothing locked or written: ' || (a.backend_xid is null)
        from pg_locks w
        join pg_stat_activity a on a.pid = w.pid
        join pg_locks h on h.locktype = 'advisory' and h.classid = w.classid
          and h.objid = w.objid and h.granted
        join pg_stat_activity d on d.pid = h.pid
        where w.locktype = 'advisory' and w.classid = x'1a01'::int and not w.granted
          and w.objid::bigint = (hashtext('${picked}')::bigint & 4294967295)
          and a.query like '%reserve%' and d.query like '%${deleteMarker}%'
        limit 1;
      `);
      // The edit is saved: the delete goes on, and then the booking.
      await gate.open();
      expect(seen, `${units} units`).toBe(
        "waiting for the delete, nothing locked or written: true",
      );

      const [edited, deleted, result] = await Promise.all([
        editor,
        deleter,
        call,
      ]);
      expect(edited.failed).toBe("");
      // The delete went through: the booking never stood in its way.
      expect(deleted.failed).toBe("");
      noDeadlock([result]);
      await new Promise((r) => setTimeout(r, 1200));
      expect(deadlocks(), `${units} units`).toBe(before);

      const left = bike.units.filter((u) => u !== picked);
      if (units === 2) {
        // It read again once the unit was gone, and took the other one.
        expect(outcome(result)).toBe("ok");
        expect(
          (result.data as Extract<Answer, { ok: true }>).lines[0].unit_ids,
        ).toEqual(left);
      } else {
        expect(result.data).toEqual({
          ok: false,
          reason: "unavailable",
          line: 0,
        });
        expect(await reservationsOf(bike.id)).toEqual([]);
      }
      const { data: remaining } = await service
        .from("units")
        .select("id")
        .eq("product_id", bike.id);
      expect(remaining!.map((u) => u.id)).toEqual(left);
    }
  }, 120_000);
});

/** A background session that acts as a signed-in member, or as the server. */
const actingAs = (userId: string | null) =>
  userId
    ? `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: "authenticated" })}', true); set local role authenticated;`
    : `select set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role;`;

/** A whole booking made in a background session and held there, not yet saved. */
function bookingHeld(
  userId: string | null,
  call: ReturnType<typeof request>,
  marker: string,
  gate: Gate,
) {
  return sqlBackground(`
    begin;
    ${actingAs(userId)}
    select platform.reserve('${call.p_tenant_id}', '${JSON.stringify(call.p_request)}'::jsonb) ->> 'ok';
    ${gate.wait(marker)}
    commit;
  `);
}

describe("one side held in place, the other seen waiting", () => {
  it("the named-unit race: while a booking that names the unit is not yet saved, a second one waits for the product's lock with no unit lock, then is refused", async () => {
    const line = (bike: { id: string }) => ({
      product_id: bike.id,
      starts_at: at(1),
      ends_at: at(2),
    });
    const cases: {
      what: string;
      first: (bike: {
        id: string;
        units: string[];
      }) => [string | null, ReturnType<typeof request>];
      second: (bike: { id: string; units: string[] }) => Promise<Result>;
      refusal: string;
    }[] = [
      {
        what: "staff naming the unit, then staff naming the same unit",
        first: (bike) => [
          shop.members.staff.id,
          request(shop, "walk_in", "staff", [
            { ...line(bike), unit_ids: bike.units },
          ]),
        ],
        second: (bike) =>
          staffBook("owner", [{ ...line(bike), unit_ids: bike.units }]),
        refusal: "unit_taken",
      },
      {
        what: "staff naming the unit, then an online booking naming none",
        first: (bike) => [
          shop.members.staff.id,
          request(shop, "phone", "staff", [
            { ...line(bike), unit_ids: bike.units },
          ]),
        ],
        second: (bike) => onlineBook([line(bike)]),
        refusal: "unavailable",
      },
      {
        what: "an online booking naming none, then staff naming the unit",
        first: (bike) => [
          null,
          request(shop, "booking_page", "instant", [line(bike)]),
        ],
        second: (bike) =>
          staffBook("staff", [{ ...line(bike), unit_ids: bike.units }]),
        refusal: "unit_taken",
      },
    ];
    for (const [index, c] of cases.entries()) {
      const bike = await vehicle(1);
      const marker = `named-held-${tag}-${index}`;
      const [user, call] = c.first(bike);
      const gate = await closedGate();
      const first = bookingHeld(user, call, marker, gate);
      await holding(marker, first);
      const second = c.second(bike);
      // One statement, so both are read at the same moment.
      const seen = await until(`
        select 'waiting, unit locks: ' || (
          select count(*) from pg_locks u
          where u.pid = w.pid and u.locktype = 'advisory' and u.classid = x'1a01'::int
        )
        from pg_locks w
        join pg_stat_activity a on a.pid = w.pid
        where w.locktype = 'advisory' and w.classid = x'1a02'::int and not w.granted
          and a.query like '%reserve%' and a.query not like '%${marker}%'
          and a.pid <> pg_backend_pid()
        limit 1;
      `);
      await gate.open();
      expect(seen, c.what).toBe("waiting, unit locks: 0");
      const saved = await first;
      expect(saved.failed, c.what).toBe("");
      expect(saved.out, c.what).toContain("true");
      const result = await second;
      noDeadlock([result]);
      expect(result.data, c.what).toEqual({
        ok: false,
        reason: c.refusal,
        line: 0,
      });
      expect(await reservationsOf(bike.id), c.what).toHaveLength(1);
      expect(await blocksOf(bike.id), c.what).toHaveLength(1);
    }
  }, 90_000);

  for (const status of ["sold", "retired", "lost"] as const) {
    it(`the unit being ${status}, not yet saved: the booking that picked it waits for the unit's lock with its product lock in hand, reads again, and is refused`, async () => {
      const bike = await vehicle(1);
      const marker = `leaving-${status}-${tag}`;
      const gate = await closedGate();
      const leaving = sqlBackground(`
        begin;
        update platform.units set status = '${status}' where id = '${bike.units[0]}';
        ${gate.wait(marker)}
        commit;
      `);
      await holding(marker, leaving);
      // The booking still sees the unit in use, and picks it.
      const call = onlineBook([
        { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
      ]);
      const seen = await until(`
        select 'waiting for the unit, product locks: ' || (
          select count(*) from pg_locks g
          where g.pid = w.pid and g.locktype = 'advisory' and g.granted
            and g.classid = x'1a02'::int
        )
        from pg_locks w
        where w.locktype = 'advisory' and w.classid = x'1a01'::int and not w.granted
          and w.objid::bigint = (hashtext('${bike.units[0]}')::bigint & 4294967295)
        limit 1;
      `);
      await gate.open();
      expect(seen).toBe("waiting for the unit, product locks: 1");
      expect((await leaving).failed).toBe("");
      const result = await call;
      noDeadlock([result]);
      expect(result.data).toEqual({
        ok: false,
        reason: "unavailable",
        line: 0,
      });
      const { data: unit } = await service
        .from("units")
        .select("status")
        .eq("id", bike.units[0])
        .single();
      expect(unit!.status).toBe(status);
      expect(await blocksOf(bike.id)).toEqual([]);
      expect(await reservationsOf(bike.id)).toEqual([]);
    }, 60_000);

    it(`a booking written, not yet saved: marking its unit ${status} waits for the unit's lock, then is refused because the unit is booked`, async () => {
      const bike = await vehicle(1);
      const marker = `booked-before-${status}-${tag}`;
      const gate = await closedGate();
      const booking = bookingHeld(
        null,
        request(shop, "booking_page", "instant", [
          { product_id: bike.id, starts_at: at(1), ends_at: at(2) },
        ]),
        marker,
        gate,
      );
      await holding(marker, booking);
      const leaving = Promise.resolve(
        db("owner")
          .from("units")
          .update({ status })
          .eq("id", bike.units[0])
          .select("status"),
      );
      // It has the unit's row (no key column changes, so the booking's own
      // lock on that row does not stop it) and waits for the unit's lock.
      const seen = await until(`
        select 'waiting for the unit lock held by the booking: ' || (h.pid is not null)
        from pg_locks w
        left join pg_locks h on h.locktype = 'advisory' and h.classid = w.classid
          and h.objid = w.objid and h.granted
        where w.locktype = 'advisory' and w.classid = x'1a01'::int and not w.granted
          and w.objid::bigint = (hashtext('${bike.units[0]}')::bigint & 4294967295)
        limit 1;
      `);
      await gate.open();
      expect(seen).toBe("waiting for the unit lock held by the booking: true");
      const saved = await booking;
      expect(saved.failed).toBe("");
      expect(saved.out).toContain("true");
      const left = await leaving;
      noDeadlock([left]);
      expect(left.error?.message).toBe("unit_has_future_blocks");
      const { data: unit } = await service
        .from("units")
        .select("status")
        .eq("id", bike.units[0])
        .single();
      expect(unit!.status).toBe("active");
      expect(await blocksOf(bike.id)).toHaveLength(1);
    }, 60_000);
  }
});

/** The places every race runs in. */
const everyShop = (): [string, TestTenant][] => [
  ["Bangkok", shop],
  ["New York", newYork],
  ["Saigon", saigon],
];

describe("races for the last unit: exactly one booking wins, nothing is half-written, no deadlock", () => {
  /**
   * A product with two units. Each round has its own day: one unit is
   * booked first, then the two sides go for the last one at the same moment.
   */
  async function lastUnitRace(
    tenant: TestTenant,
    what: string,
    sides: (line: Line, lastUnit: string) => [Promise<Result>, Promise<Result>],
    loserReasons: string[],
  ) {
    const bike = await vehicle(2, { tenant });
    const before = await written(tenant);
    for (let round = 0; round < ROUNDS; round++) {
      const line: Line = {
        product_id: bike.id,
        starts_at: at(round * 2, 3),
        ends_at: at(round * 2 + 1, 3),
      };
      const first = await staffBook("owner", [line], tenant);
      expect(outcome(first), `${what}, round ${round}: first unit`).toBe("ok");
      const firstUnit = (first.data as Extract<Answer, { ok: true }>).lines[0]
        .unit_ids[0];
      const lastUnit = bike.units.find((u) => u !== firstUnit)!;

      const results = await Promise.all(sides(line, lastUnit));
      noDeadlock(results);
      const outcomes = results.map(outcome);
      expect(
        outcomes.filter((o) => o === "ok"),
        `${what}, round ${round}: ${outcomes.join(" / ")}`,
      ).toHaveLength(1);
      const loser = results.find((r) => !r.data!.ok)!.data as Extract<
        Answer,
        { ok: false }
      >;
      expect(loserReasons, `${what}, round ${round}`).toContain(loser.reason);
      expect(loser.line).toBe(0);
      const winner = results.find((r) => r.data!.ok)!.data as Extract<
        Answer,
        { ok: true }
      >;
      expect(winner.lines[0].unit_ids).toEqual([lastUnit]);
    }

    // Nothing half-written: per round, the first booking and the winner,
    // each with one reservation, one block and one event. Nothing else.
    expect(await written(tenant), what).toEqual({
      reservations: before.reservations + ROUNDS * 2,
      blocks: before.blocks + ROUNDS * 2,
      events: before.events + ROUNDS * 2,
    });
    const rows = await reservationsOf(bike.id);
    const blocks = await blocksOf(bike.id);
    expect(rows).toHaveLength(ROUNDS * 2);
    expect(blocks).toHaveLength(ROUNDS * 2);
    // Every reservation has exactly its one block, and no unit is double-booked.
    expect(blocks.map((b) => b.reservation_id).sort()).toEqual(
      rows.map((r) => r.id).sort(),
    );
    expect(new Set(blocks.map((b) => `${b.unit_id} ${b.period}`)).size).toBe(
      ROUNDS * 2,
    );
    expect(rows.every((r) => r.state === "reserved" && r.shortage === 0)).toBe(
      true,
    );
  }

  for (const [where, tenantOf] of [
    ["Bangkok", () => shop],
    ["New York", () => newYork],
    ["Saigon", () => saigon],
  ] as const) {
    describe(where, () => {
      it(`staff against staff, ${ROUNDS} rounds`, async () => {
        const t = tenantOf();
        await lastUnitRace(
          t,
          "staff v staff",
          (line) => [
            staffBook("staff", [line], t),
            staffBook("manager", [line], t, "phone"),
          ],
          ["unavailable"],
        );
      }, 180_000);

      it(`online against online, ${ROUNDS} rounds`, async () => {
        const t = tenantOf();
        await lastUnitRace(
          t,
          "online v online",
          (line) => [
            onlineBook([line], t, "booking_page"),
            onlineBook([line], t, "api"),
          ],
          ["unavailable"],
        );
      }, 180_000);

      it(`staff against online, ${ROUNDS} rounds`, async () => {
        const t = tenantOf();
        await lastUnitRace(
          t,
          "staff v online",
          // Whoever is sent first alternates.
          (line) =>
            Number(new Date(iso(line.starts_at))) % 172_800_000 === 10_800_000
              ? [staffBook("staff", [line], t), onlineBook([line], t)]
              : [onlineBook([line], t), staffBook("staff", [line], t)],
          ["unavailable"],
        );
      }, 180_000);

      it(`staff naming the unit against staff naming none, ${ROUNDS} rounds`, async () => {
        const t = tenantOf();
        await lastUnitRace(
          t,
          "named v staff",
          (line, lastUnit) => [
            staffBook("owner", [{ ...line, unit_ids: [lastUnit] }], t),
            staffBook("staff", [line], t),
          ],
          ["unavailable", "unit_taken"],
        );
      }, 180_000);

      it(`staff naming the unit against online, ${ROUNDS} rounds`, async () => {
        const t = tenantOf();
        await lastUnitRace(
          t,
          "named v online",
          (line, lastUnit) => [
            onlineBook([line], t, "api"),
            staffBook("staff", [{ ...line, unit_ids: [lastUnit] }], t),
          ],
          ["unavailable", "unit_taken"],
        );
      }, 180_000);

      it(`both naming the same unit, ${ROUNDS} rounds`, async () => {
        const t = tenantOf();
        await lastUnitRace(
          t,
          "named v named",
          (line, lastUnit) => [
            staffBook("owner", [{ ...line, unit_ids: [lastUnit] }], t),
            staffBook("staff", [{ ...line, unit_ids: [lastUnit] }], t),
          ],
          ["unit_taken"],
        );
      }, 180_000);
    });
  }
});

describe("more races, in every shop", () => {
  it("twelve bookings at once for the last helmet: one wins", async () => {
    for (const [where, tenant] of everyShop()) {
      const helmet = await general("gear", 2, { tenant });
      for (let round = 0; round < 5; round++) {
        const line: Line = {
          product_id: helmet.id,
          starts_at: at(round * 2),
          ends_at: at(round * 2 + 1),
        };
        expect(outcome(await onlineBook([line], tenant))).toBe("ok");
        const racers = ["owner", "manager", "staff"] as const;
        const results = await Promise.all([
          ...[...racers, ...racers].map((role) =>
            staffBook(role, [line], tenant),
          ),
          ...Array.from({ length: 6 }, () => onlineBook([line], tenant)),
        ]);
        noDeadlock(results);
        expect(results.map(outcome).sort(), `${where}, round ${round}`).toEqual(
          ["ok", ...Array<string>(11).fill("unavailable")],
        );
      }
      expect(await reservationsOf(helmet.id)).toHaveLength(10);
      expect(await blocksOf(helmet.id)).toHaveLength(10);
    }
  }, 180_000);

  it("two bookings each wanting 2 of the same 3 helmets: one gets its two, the other a clear refusal", async () => {
    for (const [where, tenant] of everyShop()) {
      const helmet = await general("gear", 3, { tenant });
      for (let round = 0; round < 10; round++) {
        const line: Line = {
          product_id: helmet.id,
          starts_at: at(round * 2),
          ends_at: at(round * 2 + 1),
          quantity: 2,
        };
        const results = await Promise.all([
          staffBook("staff", [line], tenant),
          onlineBook([line], tenant),
        ]);
        noDeadlock(results);
        expect(results.map(outcome).sort(), `${where}, round ${round}`).toEqual(
          ["ok", "unavailable"],
        );
      }
      // Two blocks a round, never three or four.
      expect(await blocksOf(helmet.id)).toHaveLength(20);
      expect(await reservationsOf(helmet.id)).toHaveLength(10);
    }
  }, 180_000);

  it("two bookings naming the same two products in opposite orders: one whole booking, no deadlock", async () => {
    for (const [where, tenant] of everyShop()) {
      const bike = await vehicle(1, { tenant });
      const helmet = await general("gear", 1, { tenant });
      for (let round = 0; round < 15; round++) {
        const window = { starts_at: at(round * 2), ends_at: at(round * 2 + 1) };
        const bikeLine = { product_id: bike.id, ...window };
        const helmetLine = { product_id: helmet.id, ...window };
        const results = await Promise.all([
          staffBook("staff", [bikeLine, helmetLine], tenant),
          onlineBook([helmetLine, bikeLine], tenant),
        ]);
        noDeadlock(results);
        expect(results.map(outcome).sort(), `${where}, round ${round}`).toEqual(
          ["ok", "unavailable"],
        );
      }
      // The winner has both, every round; the loser has neither.
      const rows = [
        ...(await reservationsOf(bike.id)),
        ...(await reservationsOf(helmet.id)),
      ];
      expect(rows).toHaveLength(30);
      expect(new Set(rows.map((r) => r.booking_id)).size).toBe(15);
      expect(await blocksOf(bike.id)).toHaveLength(15);
      expect(await blocksOf(helmet.id)).toHaveLength(15);
    }
  }, 180_000);

  it("a booking against a downtime written on the unit it picks: one of the two, never both", async () => {
    for (const [where, tenant] of everyShop()) {
      const bike = await vehicle(1, { tenant });
      let bookings = 0;
      for (let round = 0; round < 15; round++) {
        const window = [at(round * 2), at(round * 2 + 1)] as const;
        const [booked, down] = await Promise.all([
          round % 2
            ? staffBook(
                "staff",
                [
                  {
                    product_id: bike.id,
                    starts_at: window[0],
                    ends_at: window[1],
                  },
                ],
                tenant,
              )
            : onlineBook(
                [
                  {
                    product_id: bike.id,
                    starts_at: window[0],
                    ends_at: window[1],
                  },
                ],
                tenant,
              ),
          db("mechanic", tenant)
            .from("unit_blocks")
            .insert({
              tenant_id: tenant.id,
              unit_id: bike.units[0],
              kind: "downtime",
              period: period(window[0], window[1]),
            }),
        ]);
        noDeadlock([booked, down]);
        const pair = `${outcome(booked)} / ${down.error?.code ?? "ok"}`;
        expect(
          ["ok / 23P01", "unavailable / ok"],
          `${where}, round ${round}`,
        ).toContain(pair);
        if (pair.startsWith("ok")) bookings++;
      }
      // What the database holds is what the answers said: an allocation
      // for every booking that answered ok, a downtime for every other
      // round, and no reservation without its block.
      const kinds = (await blocksOf(bike.id)).map((b) => b.kind);
      expect(
        kinds.filter((k) => k === "allocation"),
        `${where}: bookings that answered ok`,
      ).toHaveLength(bookings);
      expect(
        kinds.filter((k) => k === "downtime"),
        `${where}: downtime that was saved`,
      ).toHaveLength(15 - bookings);
      expect(await reservationsOf(bike.id), where).toHaveLength(bookings);
      // One block a round, whoever won.
      const { count } = await service
        .from("unit_blocks")
        .select("*", { count: "exact", head: true })
        .eq("unit_id", bike.units[0]);
      expect(count).toBe(15);
      expect(await reservationsOf(bike.id)).toHaveLength(
        (await blocksOf(bike.id)).filter((b) => b.kind === "allocation").length,
      );
    }
  }, 180_000);

  it("a booking against its unit being sold, retired or marked lost: the unit is booked or gone, never both", async () => {
    for (const [where, tenant] of everyShop()) {
      for (const status of ["sold", "retired", "lost"] as const) {
        for (let round = 0; round < 6; round++) {
          const bike = await vehicle(1, { tenant });
          const [booked, left] = await Promise.all([
            round % 2
              ? staffBook(
                  "staff",
                  [{ product_id: bike.id, starts_at: at(1), ends_at: at(2) }],
                  tenant,
                )
              : onlineBook(
                  [{ product_id: bike.id, starts_at: at(1), ends_at: at(2) }],
                  tenant,
                ),
            db("owner", tenant)
              .from("units")
              .update({ status })
              .eq("id", bike.units[0])
              .select("status"),
          ]);
          noDeadlock([booked, left]);
          const pair = `${outcome(booked)} / ${left.error?.message ?? "ok"}`;
          expect(
            ["ok / unit_has_future_blocks", "unavailable / ok"],
            `${where}, ${status}, round ${round}`,
          ).toContain(pair);
          const { data: unit } = await service
            .from("units")
            .select("status")
            .eq("id", bike.units[0])
            .single();
          const blocks = await blocksOf(bike.id);
          expect(`${unit!.status} ${blocks.length}`).toBe(
            pair.startsWith("ok") ? "active 1" : `${status} 0`,
          );
        }
      }
    }
  }, 240_000);

  it("a booking for all the helmets against the quantity being lowered, and against a problem report: one of the two", async () => {
    for (const [where, tenant] of everyShop()) {
      for (let round = 0; round < 8; round++) {
        const helmet = await general("gear", 3, { tenant });
        const line: Line = {
          product_id: helmet.id,
          starts_at: at(1),
          ends_at: at(2),
          quantity: 3,
        };
        const lowering = round % 2 === 0;
        const [booked, stock] = await Promise.all([
          round % 4 < 2
            ? staffBook("staff", [line], tenant)
            : onlineBook([line], tenant),
          lowering
            ? db("owner", tenant).rpc("set_stock_quantity", {
                p_product_id: helmet.id,
                p_location_id: tenant.locationId,
                p_quantity: 2,
              })
            : db("mechanic", tenant).rpc("report_gear_problem", {
                p_product_id: helmet.id,
                p_location_id: tenant.locationId,
                p_kind: "repair",
                p_quantity: 1,
              }),
        ]);
        noDeadlock([booked, stock]);
        const pair = `${outcome(booked)} / ${stock.error?.message ?? "ok"}`;
        expect(
          lowering
            ? ["ok / units_blocked", "unavailable / ok"]
            : ["ok / not_enough_free", "unavailable / ok"],
          `${where}, round ${round}`,
        ).toContain(pair);
        // Every block the booking wrote is on a unit that is still in use.
        const { data: units } = await service
          .from("units")
          .select("id, status")
          .eq("product_id", helmet.id);
        const active = new Set(
          units!.filter((u) => u.status === "active").map((u) => u.id),
        );
        const allocations = (await blocksOf(helmet.id)).filter(
          (b) => b.kind === "allocation",
        );
        expect(allocations).toHaveLength(pair.startsWith("ok") ? 3 : 0);
        expect(allocations.every((b) => active.has(b.unit_id))).toBe(true);
      }
    }
  }, 240_000);

  it("a cancel against a new booking for the same unit: the unit ends up with one booking or none, never two", async () => {
    for (const [where, tenant] of everyShop()) {
      const bike = await vehicle(1, { tenant });
      for (let round = 0; round < 10; round++) {
        const line: Line = {
          product_id: bike.id,
          starts_at: at(round * 2),
          ends_at: at(round * 2 + 1),
        };
        const first = await staffBook("staff", [line], tenant);
        const bookingId = (first.data as Extract<Answer, { ok: true }>)
          .booking_id;
        const [cancelled, booked] = await Promise.all([
          cancel(db("manager", tenant), tenant, { booking: bookingId }),
          onlineBook([line], tenant),
        ]);
        noDeadlock([{ error: cancelled.error }, booked]);
        expect(cancelled.data, `${where}, round ${round}`).toMatchObject({
          ok: true,
        });
        // Booked after the cancel, or refused because it came before it.
        expect(["ok", "unavailable"]).toContain(outcome(booked));
        const live = (await blocksOf(bike.id)).filter((b) =>
          String(b.period).includes(iso(line.starts_at).slice(0, 10)),
        );
        expect(live).toHaveLength(outcome(booked) === "ok" ? 1 : 0);
      }
    }
  }, 180_000);
});

describe("last: Postgres reported no deadlock", () => {
  it("the database's own count of detected deadlocks did not move during this file", async () => {
    // Counted by Postgres whether or not a function caught it.
    await new Promise((r) => setTimeout(r, 1200));
    expect(deadlocks()).toBe(deadlocksBefore);
  });
});
