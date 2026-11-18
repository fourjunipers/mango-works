/**
 * Phase 2, stage 6: the extras screens' database side (migration
 * 20261117000200_platform_extras_opt_out, lib/extras-save.ts and
 * lib/book-online.ts).
 *
 * - The save path by role: lib/extras-save.ts as each signed-in member.
 *   Owners and managers save; staff, mechanics and drivers get
 *   only_owner_or_manager, worded "Only an owner or a manager can change
 *   extras.", and nothing is written.
 * - "Not offered for this vehicle": a vehicle's own row with offered false
 *   wins over the "every vehicle" row and takes the extra out of
 *   pricing_inputs() for that vehicle alone; nothing comes free with it.
 * - save_product_extras()'s 6-second lock timeout, through the API: it
 *   gives up with 55P03 before the API's 8 seconds and the save path
 *   answers "try again".
 * - The most per vehicle: bookOnline() refuses an extra above max_quantity
 *   × its vehicle line's quantity, for every online channel, and writes
 *   nothing; a staff booking of the same is taken (plan Q16).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { quote } from "@mango/core/quote";
import { bookOnline, type OnlineDb } from "@/lib/book-online";
import { extrasHistory, extrasNamed } from "@/lib/extras-history";
import { productNames } from "@/lib/extras-names";
import { saveExtrasList, type ExtrasDb } from "@/lib/extras-save";
import { exactAuditRows, type AuditRowText } from "@/lib/history";
import {
  extrasOf,
  quoteInputFor,
  type PricingInputs,
} from "@/lib/pricing-inputs";
import { roles, type Role } from "@/lib/roles";
import { reserveAsStaff, type StaffDb } from "@/lib/staff-booking";
import {
  closedGate,
  createTenant,
  deleteTenant,
  serviceClient,
  sql,
  sqlBackground,
  type Db,
  type TestTenant,
} from "./helpers";

let shop: TestTenant;
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let counter = 0;
const name = (what: string) => `${what} ${tag} ${++counter}`;

const db = (role: Role): Db => shop.members[role].db;
const asExtrasDb = (role: Role) => db(role) as unknown as ExtrasDb;

/** Day `d` at `h` o'clock UTC, far ahead. Bangkok is UTC+7: 04:00 is 11:00. */
const at = (d: number, h = 4) =>
  new Date(Date.UTC(2034, 0, 1) + d * 86_400_000 + h * 3_600_000);

async function vehicle(count: number) {
  const product = await service
    .from("products")
    .insert({
      tenant_id: shop.id,
      name: name("Scooter"),
      vehicle_type: "motorbike",
    })
    .select("id")
    .single()
    .throwOnError();
  await service
    .from("units")
    .insert(
      Array.from({ length: count }, () => ({
        tenant_id: shop.id,
        product_id: product.data!.id,
        location_id: shop.locationId,
        plate: `XS-${tag}-${++counter}`,
      })),
    )
    .throwOnError();
  return product.data!.id;
}

async function gear(quantity: number) {
  const { data, error } = await db("owner").rpc("create_general_product", {
    p_tenant_id: shop.id,
    p_type: "gear",
    p_name: name("Helmet"),
    p_track_units: false,
    p_quantities: [{ location_id: shop.locationId, quantity }],
  });
  if (error) throw error;
  return data as string;
}

async function priceByDay(productId: string, amount: number) {
  const { error } = await db("owner").rpc("save_product_pricing", {
    p_product_id: productId,
    p_settings: {
      pricing_method: "per_period",
      price_amount: amount,
      price_period: "day",
    } as never,
  });
  if (error) throw error;
}

const form = (
  lines: { extraProductId: string; included: string; most: string }[],
  notOffered: string[] = [],
) => JSON.stringify({ lines, notOffered });

const rowsOf = async (vehicleId: string | null) => {
  const query = service
    .from("product_extras")
    .select("extra_product_id, included_quantity, max_quantity, offered")
    .eq("tenant_id", shop.id)
    .order("sort_position");
  return (
    await (
      vehicleId
        ? query.eq("product_id", vehicleId)
        : query.is("product_id", null)
    ).throwOnError()
  ).data!;
};

const inputsFor = async (role: Role, ids: string[]) => {
  const { data, error } = await db(role).rpc("pricing_inputs", {
    p_tenant_id: shop.id,
    p_product_ids: ids,
  });
  if (error) throw error;
  return data as unknown as PricingInputs;
};

/** Everything a booking writes in the shop, as text. */
const written = () =>
  sql(`
    select (select count(*) from platform.reservations where tenant_id = '${shop.id}')
      || ' | ' || (select count(*) from platform.unit_blocks where tenant_id = '${shop.id}')
      || ' | ' || (select count(*) from platform.audit_events where tenant_id = '${shop.id}' and entity = 'bookings');
  `).out;

beforeAll(async () => {
  shop = await createTenant("extras-screens", {
    country: "TH",
    currency: "THB",
    locale: "th-TH",
    timezone: "Asia/Bangkok",
  });
  // Open 08:00 to 20:00 every day, so the rules don't stand in the way.
  await service
    .from("location_hours")
    .insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        tenant_id: shop.id,
        location_id: shop.locationId,
        weekday,
        open: "08:00",
        close: "20:00",
      })),
    )
    .throwOnError();
}, 120_000);

afterAll(async () => {
  await deleteTenant(shop);
}, 60_000);

describe("the save path (lib/extras-save.ts) as each signed-in member", () => {
  it("owners and managers save; staff, mechanics and drivers are told only an owner or a manager can, and nothing is written", async () => {
    const bike = await vehicle(1);
    const helmet = await gear(5);
    for (const role of roles) {
      const before = JSON.stringify(await rowsOf(bike));
      const included = String(roles.indexOf(role) + 1);
      const answer = await saveExtrasList(
        asExtrasDb(role),
        shop.id,
        bike,
        form([{ extraProductId: helmet, included, most: "" }]),
      );
      if (role === "owner" || role === "manager") {
        expect(answer, role).toEqual({ ok: true });
        expect(await rowsOf(bike), role).toEqual([
          {
            extra_product_id: helmet,
            included_quantity: Number(included),
            max_quantity: null,
            offered: true,
          },
        ]);
      } else {
        expect(answer, role).toEqual({
          ok: false,
          errors: { form: "extrasOnlyOwnerOrManager" },
        });
        expect(JSON.stringify(await rowsOf(bike)), role).toBe(before);
      }
    }
    // The same for the shop's "every vehicle" list.
    for (const role of ["staff", "mechanic", "driver"] as const)
      expect(
        await saveExtrasList(asExtrasDb(role), shop.id, null, form([])),
        role,
      ).toEqual({ ok: false, errors: { form: "extrasOnlyOwnerOrManager" } });
  });
});

describe('"Not offered for this vehicle" in pricing_inputs()', () => {
  it("an opt-out wins over the shop's row for that vehicle alone; the rest of the shop's list still comes; nothing comes free with it", async () => {
    const [scooter, other, helmet, rain] = await Promise.all([
      vehicle(1),
      vehicle(1),
      gear(10),
      gear(10),
    ]);
    await Promise.all([
      priceByDay(scooter, 30_000),
      priceByDay(other, 30_000),
      priceByDay(helmet, 5_000),
      priceByDay(rain, 2_000),
    ]);
    expect(
      await saveExtrasList(
        asExtrasDb("owner"),
        shop.id,
        null,
        form([
          { extraProductId: helmet, included: "2", most: "3" },
          { extraProductId: rain, included: "0", most: "" },
        ]),
      ),
    ).toEqual({ ok: true });
    expect(
      await saveExtrasList(
        asExtrasDb("manager"),
        shop.id,
        scooter,
        form([], [helmet]),
      ),
    ).toEqual({ ok: true });
    expect(await rowsOf(scooter)).toEqual([
      {
        extra_product_id: helmet,
        included_quantity: 0,
        max_quantity: null,
        offered: false,
      },
    ]);

    for (const role of ["owner", "staff", "mechanic"] as const) {
      const read = await inputsFor(role, [scooter, other]);
      const ids = (vehicleId: string) =>
        extrasOf(read, vehicleId)
          .map((row) => row.extra_product_id)
          .sort();
      expect(ids(scooter), role).toEqual([rain]);
      expect(ids(other), role).toEqual([helmet, rain].sort());
    }

    // Priced as the scooter's extra, every helmet is charged.
    // Asked about with the helmet, as bookOnline() asks about every line.
    const read = await inputsFor("owner", [scooter, helmet]);
    const span = { start: at(1), end: at(2), timeZone: "Asia/Bangkok" };
    const priced = quote(
      quoteInputFor(read, [
        { id: "0", productId: scooter, quantity: 1, span },
        { id: "1", productId: helmet, quantity: 2, extraOf: "0" },
      ]),
    );
    if (!priced.ok) throw new Error(JSON.stringify(priced));
    expect(priced.lines[1].includedQuantity).toBe(0);
    expect(priced.lines[1].chargedQuantity).toBe(2);

    // Switched back on: the shop's row again.
    expect(
      await saveExtrasList(asExtrasDb("owner"), shop.id, scooter, form([])),
    ).toEqual({ ok: true });
    expect(
      extrasOf(await inputsFor("owner", [scooter]), scooter)
        .map((row) => row.extra_product_id)
        .sort(),
    ).toEqual([helmet, rain].sort());
  });
});

describe("save_product_extras()'s lock timeout, through the API", () => {
  it("someone holds the vehicle's row: the save gives up after its own 6 seconds with 55P03, before the API's 8; the save path says try again; nothing is written; sent again once the row is free, it goes through", async () => {
    const bike = await vehicle(1);
    const helmet = await gear(3);
    const marker = `extras-lock-${tag}`;
    // Held at a gate through two waits of 6 seconds, one after the other.
    // Two saves sent at the same instant would queue on the row: the
    // second's wait starts again behind the first's and can reach the API's
    // 8 seconds (57014), which the save path answers "try again" as well.
    const gate = await closedGate();
    const holder = sqlBackground(`
      begin;
      select id from platform.products where id = '${bike}' for update;
      ${gate.wait(marker)}
      commit;
    `);
    for (let i = 0; i < 100; i++) {
      const { out } = sql(
        `select count(*) from pg_stat_activity where state = 'active' and query like '%${marker}%' and pid <> pg_backend_pid();`,
      );
      if (out === "1") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const list = [{ extraProductId: helmet, included: "1", most: "2" }];
    const timed = async <T>(call: () => PromiseLike<T>) => {
      const started = Date.now();
      const value = await call();
      return { value, waited: Date.now() - started };
    };
    const direct = await timed(() =>
      db("owner").rpc("save_product_extras", {
        p_tenant_id: shop.id,
        p_product_id: bike,
        p_extras: [
          { extra_product_id: helmet, included_quantity: 1, max_quantity: 2 },
        ],
      } as never),
    );
    const answer = await timed(() =>
      saveExtrasList(asExtrasDb("manager"), shop.id, bike, form(list)),
    );
    expect(direct.value.error?.code).toBe("55P03");
    expect(direct.value.error?.message).toMatch(/lock timeout/);
    expect(answer.value).toEqual({
      ok: false,
      errors: { form: "extrasTryAgain" },
    });
    // After the function's 6 seconds, and before the API's 8.
    for (const { waited } of [direct, answer]) {
      expect(waited).toBeGreaterThan(5_500);
      expect(waited).toBeLessThan(8_000);
    }
    expect(await rowsOf(bike)).toEqual([]);
    await gate.open();
    expect((await holder).failed).toBe("");

    expect(
      await saveExtrasList(asExtrasDb("manager"), shop.id, bike, form(list)),
    ).toEqual({ ok: true });
  }, 60_000);
});

describe("the most per vehicle: online bookings are bound, staff bookings are not (plan Q16)", () => {
  let scooter: string;
  let helmet: string;
  const server = service as unknown as OnlineDb;

  beforeAll(async () => {
    scooter = await vehicle(3);
    helmet = await gear(30);
    await Promise.all([priceByDay(scooter, 30_000), priceByDay(helmet, 5_000)]);
    // 1 included, most 2 per vehicle.
    expect(
      await saveExtrasList(
        asExtrasDb("owner"),
        shop.id,
        scooter,
        form([{ extraProductId: helmet, included: "1", most: "2" }]),
      ),
    ).toEqual({ ok: true });
  }, 60_000);

  const lines = (day: number, scooters: number, helmets: number) => [
    {
      productId: scooter,
      start: at(day),
      end: at(day + 2),
      quantity: scooters,
    },
    {
      productId: helmet,
      start: at(day),
      end: at(day + 2),
      quantity: helmets,
      parent: 0,
    },
  ];

  it("online, above the most: refused on the helmet's line for the booking page, Moto Mangos and the API, and nothing is written", async () => {
    const before = written();
    for (const channel of ["booking_page", "marketplace", "api"] as const) {
      for (const [scooters, helmets] of [
        [1, 3],
        [2, 5],
      ]) {
        const answer = await bookOnline(
          {
            tenantId: shop.id,
            locationId: shop.locationId,
            channel,
            mode: "instant",
            lines: lines(10, scooters, helmets),
          },
          { db: server },
        );
        expect(answer, `${channel} ${scooters}/${helmets}`).toEqual({
          ok: false,
          reason: "over_most_per_vehicle",
          line: 1,
        });
      }
    }
    expect(written()).toBe(before);
  });

  it("online, at the most: two scooters with four helmets are booked", async () => {
    const answer = await bookOnline(
      {
        tenantId: shop.id,
        locationId: shop.locationId,
        channel: "booking_page",
        mode: "instant",
        lines: lines(20, 2, 4),
      },
      { db: server },
    );
    if (!answer.ok) throw new Error(answer.reason);
    // 2 free with two scooters, 2 charged.
    expect(answer.quote.lines[1].includedQuantity).toBe(2);
    expect(answer.quote.lines[1].chargedQuantity).toBe(2);
  });

  it("staff at the counter book above the most: one scooter with five helmets is taken", async () => {
    const answer = await reserveAsStaff(
      db("staff") as unknown as StaffDb,
      shop.id,
      {
        channel: "walk_in",
        lines: lines(30, 1, 5).map((line) => ({
          ...line,
          locationId: shop.locationId,
        })),
      },
    );
    expect(answer).toMatchObject({ ok: true });
    const reserved = await service
      .from("reservations")
      .select("quantity")
      .eq("tenant_id", shop.id)
      .eq("product_id", helmet)
      .order("created_at")
      .throwOnError();
    expect(reserved.data!.map((row) => row.quantity)).toContain(5);
  });

  // The same extra on a line of its own, with no parent (review of PR 45).
  const own = (day: number, quantity: number, productId = helmet) => ({
    productId,
    start: at(day),
    end: at(day + 2),
    quantity,
  });
  const vehicleLine = (day: number, productId = scooter, quantity = 1) => ({
    productId,
    start: at(day),
    end: at(day + 2),
    quantity,
  });
  const online = (lines: Parameters<typeof bookOnline>[0]["lines"]) =>
    bookOnline(
      {
        tenantId: shop.id,
        locationId: shop.locationId,
        channel: "booking_page",
        mode: "instant",
        lines,
      },
      { db: server },
    );

  it("online, the helmets on a line of their own: counted with the attached ones and refused above the most, on that line, with nothing written", async () => {
    const before = written();
    // 1 scooter, a most of 2: 3 helmets with no parent.
    expect(await online([vehicleLine(40), own(40, 3)])).toEqual({
      ok: false,
      reason: "over_most_per_vehicle",
      line: 1,
    });
    // 2 attached and 1 on its own: 3 in all.
    expect(
      await online([vehicleLine(40), { ...own(40, 2), parent: 0 }, own(40, 1)]),
    ).toEqual({ ok: false, reason: "over_most_per_vehicle", line: 2 });
    for (const channel of ["marketplace", "api"] as const)
      expect(
        await bookOnline(
          {
            tenantId: shop.id,
            locationId: shop.locationId,
            channel,
            mode: "instant",
            lines: [vehicleLine(40), own(40, 3)],
          },
          { db: server },
        ),
        channel,
      ).toMatchObject({ ok: false, reason: "over_most_per_vehicle", line: 1 });
    expect(written()).toBe(before);
  });

  it("online, the helmets on a line of their own within the most: booked", async () => {
    const answer = await online([vehicleLine(50), own(50, 2)]);
    expect(answer).toMatchObject({ ok: true });
  });

  it("online, an extra the vehicle opted out of or that has no limit: a line of its own is not bound", async () => {
    const [noLimit, optedOut, rain] = await Promise.all([
      vehicle(1),
      vehicle(1),
      gear(30),
    ]);
    await Promise.all([
      priceByDay(noLimit, 30_000),
      priceByDay(optedOut, 30_000),
      priceByDay(rain, 2_000),
    ]);
    // The shop offers rain gear with every vehicle, at most 1; one vehicle
    // takes it with no limit, the other opts out.
    const save = (vehicleId: string | null, f: string) =>
      saveExtrasList(asExtrasDb("owner"), shop.id, vehicleId, f);
    expect(
      await save(
        null,
        form([{ extraProductId: rain, included: "0", most: "1" }]),
      ),
    ).toEqual({ ok: true });
    try {
      expect(
        await save(
          noLimit,
          form([{ extraProductId: rain, included: "0", most: "" }]),
        ),
      ).toEqual({ ok: true });
      expect(await save(optedOut, form([], [rain]))).toEqual({ ok: true });
      for (const [what, bike] of [
        ["no limit", noLimit],
        ["opted out", optedOut],
      ] as const) {
        const answer = await online([vehicleLine(60, bike), own(60, 9, rain)]);
        expect(answer, what).toMatchObject({ ok: true });
      }
    } finally {
      expect(await save(null, form([]))).toEqual({ ok: true });
    }
  });

  it("staff at the counter book the helmets on a line of their own above the most: taken", async () => {
    const answer = await reserveAsStaff(
      db("staff") as unknown as StaffDb,
      shop.id,
      {
        channel: "walk_in",
        lines: [vehicleLine(70), own(70, 5)].map((line) => ({
          ...line,
          locationId: shop.locationId,
        })),
      },
    );
    expect(answer).toMatchObject({ ok: true });
  });
});

describe("History names an extra that has since been deleted", () => {
  it("saved on a vehicle's list, then the product deleted: the vehicle's History line still carries its name, from the product's delete event", async () => {
    const bike = await vehicle(1);
    // No stock, so it can be deleted.
    const gone = await gear(0);
    const { data: named } = await service
      .from("products")
      .select("name")
      .eq("id", gone)
      .single()
      .throwOnError();
    expect(
      await saveExtrasList(
        asExtrasDb("owner"),
        shop.id,
        bike,
        form([{ extraProductId: gone, included: "1", most: "2" }]),
      ),
    ).toEqual({ ok: true });
    const removed = await db("owner")
      .from("products")
      .delete()
      .eq("tenant_id", shop.id)
      .eq("id", gone)
      .select("id");
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
    // Its link went with it.
    expect(await rowsOf(bike)).toEqual([]);

    // The vehicle's History, read as the owner, as the History tab reads it.
    const { data, error } = await db("owner")
      .from("audit_events")
      .select(
        "id, entity, entity_id, action, actor, before::text, after::text, at",
      )
      .eq("tenant_id", shop.id)
      .eq("entity", "product_extras")
      .eq("entity_id", bike);
    if (error) throw error;
    const entries = extrasHistory(
      exactAuditRows(data as unknown as AuditRowText[]),
    );
    expect(entries.map((entry) => entry.changes)).toEqual([
      [{ kind: "added", extra: gone, included: 1, most: 2 }],
    ]);
    const names = await productNames(
      db("owner"),
      shop.id,
      extrasNamed(entries),
    );
    expect(names.get(gone)).toEqual({ name: named!.name, deleted: true });
  });
});
