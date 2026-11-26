/**
 * Phase 2's accept line: the two clauses only a real database can prove
 * (docs/phase-2-plan.md §9.2; the pricing clauses are in
 * packages/core/src/phase-2-accept.test.ts):
 *
 *   a concurrency test where two parallel bookings for the last unit
 *   results in one success, through the staff path and the online
 *   model-level path; a booking that overlaps a downtime block is refused.
 *
 * One block per clause, named as the line names them, so the list can be
 * read off the test names (tests/phase-2-accept-suites.test.ts checks the
 * names). This file is the end-to-end race: real sessions, at the same
 * moment, through create_order() itself (Phase 2's reserve(); since Phase 3
 * stage 2b every booking is an order). That the two really overlapped, and
 * which lock made the second wait, is proven in reservations.test.ts
 * (sessions held at gates, the waits read from pg_stat_activity, many
 * rounds in three shops, and every other writer). This is the short
 * version that maps one-to-one onto the line.
 *
 * Staff book as a signed-in member (walk-in, phone); online books with the
 * service role on the shop's booking page or the API, model-level (no unit
 * named), as bookOnline() does.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/lib/roles";
import {
  type BookingAnswer,
  type BookingResult,
  createOrder,
  createTenant,
  type Db,
  deleteTenant,
  period,
  serviceClient,
  type TestTenant,
} from "./helpers";
import { exactlyOne } from "@mango/db/rows";

let shop: TestTenant;
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let counter = 0;
const ROUNDS = 8;

const db = (role: Role): Db => shop.members[role].db;
/** Day `d` at `h` o'clock UTC, far ahead. Every test has its own products. */
const at = (d: number, h = 3) =>
  new Date(Date.UTC(2032, 0, 1) + d * 86_400_000 + h * 3_600_000);

type Line = { product_id: string; starts_at: Date; ends_at: Date };
type Answer = BookingAnswer;
type Result = BookingResult;

const request = (channel: string, mode: string, lines: Line[]) => ({
  p_tenant_id: shop.id,
  p_request: {
    channel,
    mode,
    lines: lines.map((l) => ({
      product_id: l.product_id,
      location_id: shop.locationId,
      starts_at: l.starts_at.toISOString(),
      ends_at: l.ends_at.toISOString(),
      quantity: 1,
    })),
  },
});
const staff = (
  role: Role,
  lines: Line[],
  channel = "walk_in",
): Promise<Result> =>
  createOrder(db(role), shop.id, request(channel, "staff", lines).p_request);
const online = (lines: Line[], channel = "booking_page"): Promise<Result> =>
  createOrder(service, shop.id, request(channel, "instant", lines).p_request);

/** A vehicle product with `count` units at the shop's location (fixtures). */
async function vehicle(count: number) {
  const product = await exactlyOne(
    service
      .from("products")
      .insert({
        tenant_id: shop.id,
        name: `Accept scooter ${tag} ${++counter}`,
        vehicle_type: "motorbike",
      })
      .select("id")
      .throwOnError(),
  );
  const units = await service
    .from("units")
    .insert(
      Array.from({ length: count }, () => ({
        tenant_id: shop.id,
        product_id: product.data!.id,
        location_id: shop.locationId,
        plate: `AC-${tag}-${++counter}`,
      })),
    )
    .select("id")
    .throwOnError();
  return { id: product.data!.id, units: units.data!.map((u) => u.id) };
}

/** The product's reservations and allocation blocks, read by the service role. */
async function written(productId: string) {
  const [rows, blocks] = await Promise.all([
    service
      .from("reservations")
      .select("id, state, shortage")
      .eq("product_id", productId)
      .throwOnError(),
    service
      .from("unit_blocks")
      .select("unit_id, reservation_id, period")
      .eq("kind", "allocation")
      .in(
        "reservation_id",
        (
          await service
            .from("reservations")
            .select("id")
            .eq("product_id", productId)
            .throwOnError()
        ).data!.map((r) => r.id),
      )
      .throwOnError(),
  ]);
  return { rows: rows.data!, blocks: blocks.data! };
}

beforeAll(async () => {
  shop = await createTenant("accept", {
    country: "TH",
    currency: "THB",
    locale: "th-TH",
    timezone: "Asia/Bangkok",
  });
}, 60_000);

afterAll(async () => {
  await deleteTenant(shop);
});

describe("Phase 2 accept: two parallel bookings for the last unit give one success", () => {
  async function race(
    what: string,
    sides: (line: Line) => [Promise<Result>, Promise<Result>],
  ) {
    const bike = await vehicle(2);
    for (let round = 0; round < ROUNDS; round++) {
      const line = {
        product_id: bike.id,
        starts_at: at(round * 2),
        ends_at: at(round * 2 + 1),
      };
      // One of the two is taken first: the race is for the last one.
      const first = await staff("owner", [line]);
      expect(first.data?.ok, `${what}, round ${round}: the first`).toBe(true);

      const results = await Promise.all(sides(line));
      for (const r of results)
        expect(r.error, `${what}, round ${round}`).toBeNull();
      const wins = results.filter((r) => r.data?.ok);
      expect(wins, `${what}, round ${round}`).toHaveLength(1);
      const loser = results.find((r) => !r.data?.ok)!.data as Extract<
        Answer,
        { ok: false }
      >;
      expect(loser.reason, `${what}, round ${round}`).toBe("unavailable");
    }
    // Nothing half-written: two reservations a round, each with its one
    // block, no unit booked twice for the same time, no shortage.
    const { rows, blocks } = await written(bike.id);
    expect(rows).toHaveLength(ROUNDS * 2);
    expect(blocks).toHaveLength(ROUNDS * 2);
    expect(new Set(blocks.map((b) => b.reservation_id)).size).toBe(ROUNDS * 2);
    expect(new Set(blocks.map((b) => `${b.unit_id} ${b.period}`)).size).toBe(
      ROUNDS * 2,
    );
    expect(rows.every((r) => r.state === "reserved" && r.shortage === 0)).toBe(
      true,
    );
  }

  it("two parallel bookings for the last unit: one success, staff against staff", async () => {
    await race("staff v staff", (line) => [
      staff("staff", [line]),
      staff("manager", [line], "phone"),
    ]);
  }, 120_000);

  it("two parallel bookings for the last unit: one success, online against online", async () => {
    await race("online v online", (line) => [
      online([line], "booking_page"),
      online([line], "api"),
    ]);
  }, 120_000);

  it("two parallel bookings for the last unit: one success, staff against online", async () => {
    await race("staff v online", (line) => [
      staff("staff", [line]),
      online([line]),
    ]);
  }, 120_000);
});

describe("Phase 2 accept: a booking that overlaps a downtime block is refused", () => {
  it("a booking that overlaps a downtime block is refused, staff and online, and nothing is written", async () => {
    const bike = await vehicle(1);
    const down = await exactlyOne(
      db("mechanic")
        .from("unit_blocks")
        .insert({
          tenant_id: shop.id,
          unit_id: bike.units[0],
          kind: "downtime",
          period: period(at(40), at(42)),
        })
        .select("id"),
    );
    expect(down.error).toBeNull();

    for (const [from, to] of [
      [at(39), at(41)], // ends inside
      [at(40), at(42)], // the same span
      [at(41), at(43)], // starts inside
      [at(39), at(43)], // around it
    ]) {
      const line = { product_id: bike.id, starts_at: from, ends_at: to };
      expect((await staff("staff", [line])).data).toEqual({
        ok: false,
        reason: "unavailable",
        line: 0,
      });
      expect((await online([line])).data).toEqual({
        ok: false,
        reason: "unavailable",
        line: 0,
      });
    }
    expect((await written(bike.id)).rows).toEqual([]);

    // Right after the downtime ends, it can be booked.
    const after = await staff("staff", [
      { product_id: bike.id, starts_at: at(42), ends_at: at(43) },
    ]);
    expect(after.data?.ok).toBe(true);
  });
});
