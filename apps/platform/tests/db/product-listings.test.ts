/**
 * Products, stage C, the database part (20261114000200): Moto Mangos
 * listings in their own table, platform.product_listings.
 *
 * What is held here: the rules that moved with the columns, the one function
 * a shop changes a listing with, who may call it, what the table lets anyone
 * do directly, the lead time, the on and off events, the lock order (the
 * product's row, then the listing's) and the races around it; and that the
 * vehicle-fields rule on products survived the columns being dropped.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { roles, type Role } from "@/lib/roles";
import {
  anonClient,
  createCatalogEntry,
  createTenant,
  createUser,
  deleteTenant,
  deleteUser,
  forceListing,
  listingOf,
  removeCatalogEntry,
  serviceClient,
  setListing,
  sql,
  sqlBackground,
  type TestTenant,
  type TestUser,
} from "./helpers";

let shop: TestTenant;
let other: TestTenant;
let admin: TestUser;
let presetA: string;
let presetB: string;
const extraCatalog: string[] = [];
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let counter = 0;
const db = (role: Role) => shop.members[role].db;

/** A motorbike product; on the approved entry `catalogId` unless null. */
async function addProduct(
  catalogId: string | null = presetA,
  tenant: TestTenant = shop,
): Promise<string> {
  const { data, error } = await service
    .from("products")
    .insert({
      tenant_id: tenant.id,
      name: `Listing ${tag} ${++counter}`,
      vehicle_type: "motorbike",
      catalog_id: catalogId,
      ...(catalogId
        ? {}
        : {
            make: "Listmake",
            model: `LM ${tag} ${counter}`,
            cc: 125,
            transmission: "automatic" as const,
          }),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function addUnit(productId: string, status = "active"): Promise<string> {
  const { data, error } = await service
    .from("units")
    .insert({
      tenant_id: shop.id,
      product_id: productId,
      location_id: shop.locationId,
      plate: `LS-${tag}-${++counter}`,
      status,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** A product with `units` active vehicles, on an approved entry. */
async function addListable(units = 2) {
  const id = await addProduct();
  const unitIds: string[] = [];
  for (let i = 0; i < units; i++) unitIds.push(await addUnit(id));
  return { id, unitIds };
}

const row = async (productId: string) =>
  (
    await service
      .from("product_listings")
      .select("*")
      .eq("product_id", productId)
      .maybeSingle()
  ).data;

const events = async (productId: string, actions: string[]) =>
  (
    await service
      .from("audit_events")
      .select("entity, action, actor, before, after")
      .eq("entity_id", productId)
      .in("action", actions)
      .order("id")
  ).data!;

async function submit(productId: string): Promise<string> {
  const { data, error } = await db("owner").rpc("submit_product_to_catalog", {
    p_product_id: productId,
    p_year: 2024,
    p_type: "city_scooter",
    p_note: "Please add",
  });
  if (error) throw error;
  extraCatalog.push(data);
  return data;
}

const review = (catalogId: string, approve: boolean, mergeInto?: string) =>
  admin.db.rpc("review_catalog_request", {
    p_catalog_id: catalogId,
    p_approve: approve,
    p_merge_into: mergeInto,
  });

const retire = (productId: string, on = true) =>
  db("owner")
    .from("products")
    .update({ retired_at: on ? new Date().toISOString() : null })
    .eq("id", productId)
    .select("id");

/** Waits until a background session is sitting on its marker. */
async function holding(marker: string) {
  for (let i = 0; i < 100; i++) {
    const { out } = sql(
      `select count(*) from pg_stat_activity where state = 'active' and query like '%${marker}%' and pid <> pg_backend_pid();`,
    );
    if (out === "1") return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`No session reached ${marker}`);
}

const noDeadlock = (
  results: { error: { code?: string; message?: string } | null }[],
) => {
  for (const { error } of results) {
    expect(error?.code, error?.message).not.toBe("40P01");
    expect(error?.message ?? "").not.toMatch(/deadlock/i);
  }
};

beforeAll(async () => {
  [shop, other, admin, presetA, presetB] = await Promise.all([
    createTenant("listing-a"),
    createTenant("listing-b"),
    createUser("listing-admin"),
    createCatalogEntry("listing-a"),
    createCatalogEntry("listing-b"),
  ]);
  await service.from("platform_admins").insert({ user_id: admin.id });
}, 120_000);

afterAll(async () => {
  await Promise.all([deleteTenant(shop), deleteTenant(other)]);
  await deleteUser(admin);
  for (const id of [presetA, presetB, ...extraCatalog])
    await removeCatalogEntry(id);
});

describe("the columns are gone from products; the vehicle-fields rule is still there", () => {
  it("products has none of the five columns", () => {
    const { out } = sql(`
      select count(*) from information_schema.columns
      where table_schema = 'platform' and table_name = 'products'
        and column_name in ('marketplace_listed', 'instant_units', 'request_units', 'ready_now', 'ready_updated_at');
    `);
    expect(out).toBe("0");
  });

  it("still refuses a helmet with a make, and every other vehicle detail on a general product", async () => {
    const general = (extra: object) =>
      service.from("products").insert({
        tenant_id: shop.id,
        type: "gear",
        tracking: "bulk",
        name: `Helmet ${tag} ${++counter}`,
        ...extra,
      });
    for (const extra of [
      { make: "Shoei", model: "NXR" },
      { make: "Shoei" },
      { model: "NXR" },
      { vehicle_type: "motorbike" },
      { cc: 50 },
      { transmission: "automatic" },
      { min_age: 18 },
      { licence_class: "A" },
      { catalog_approved_at: new Date().toISOString() },
      { catalog_rejected_at: new Date().toISOString() },
      {
        catalog_rejected_at: new Date().toISOString(),
        catalog_reject_reason: "No",
      },
    ]) {
      const { error } = await general(extra);
      expect(error?.message, JSON.stringify(extra)).toContain(
        "products_vehicle_fields_check",
      );
    }
    // The same helmet with none of them is fine.
    expect((await general({})).error).toBeNull();
  });

  it("still asks a vehicle for its kind, and for a make and model together", async () => {
    const vehicle = (extra: object) =>
      service.from("products").insert({
        tenant_id: shop.id,
        name: `Vehicle ${tag} ${++counter}`,
        vehicle_type: "motorbike",
        ...extra,
      });
    for (const broken of [
      { vehicle_type: null },
      { make: "Honda" },
      { model: "PCX" },
    ])
      expect(
        (await vehicle(broken)).error?.message,
        JSON.stringify(broken),
      ).toContain("products_vehicle_fields_check");
    expect((await vehicle({})).error).toBeNull();
  });

  it("the constraint is there by name, with the whole rule", () => {
    const { out } = sql(`
      select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'platform.products'::regclass and conname = 'products_vehicle_fields_check';
    `);
    for (const column of [
      "vehicle_type",
      "make",
      "model",
      "cc",
      "transmission",
      "catalog_id",
      "min_age",
      "licence_class",
      "catalog_approved_at",
      "catalog_rejected_at",
      "catalog_reject_reason",
    ])
      expect(out, column).toContain(column);
  });

  it("only a vehicle can have a listing, even for the service role", async () => {
    const { data: helmet } = await service
      .from("products")
      .insert({
        tenant_id: shop.id,
        type: "gear",
        tracking: "bulk",
        name: `Listed helmet ${tag}`,
      })
      .select("id")
      .single();
    const plain = await forceListing(shop.id, helmet!.id, {});
    expect(plain.error?.code).toBe("23503");
    const forged = await service.from("product_listings").insert({
      tenant_id: shop.id,
      product_id: helmet!.id,
      product_type: "gear",
    });
    expect(forged.error?.message).toContain(
      "product_listings_product_type_check",
    );
    const asOwner = await setListing(db("owner"), helmet!.id, {
      lead_time_hours: 2,
    });
    expect(asOwner.error?.message).toBe("not_listable");
  });
});

describe("save_listing: the rules that moved with the columns", () => {
  it("a product that was never listed has no row, and saving 'off, zero, none' doesn't make one", async () => {
    const { id } = await addListable();
    expect(await row(id)).toBeNull();
    const { data, error } = await setListing(db("owner"), id, {
      marketplace_listed: false,
      instant_units: 0,
      request_units: 0,
      ready_now: 0,
      lead_time_hours: null,
    });
    expect(error).toBeNull();
    expect(data).toEqual({
      enabled: false,
      instant_units: 0,
      request_units: 0,
      ready_now: 0,
      lead_time_hours: null,
      ready_updated_at: null,
    });
    expect(await row(id)).toBeNull();
  });

  it("the first real setting makes the row; only what is named changes after that", async () => {
    const { id } = await addListable(3);
    const first = await setListing(db("manager"), id, {
      marketplace_listed: true,
      instant_units: 2,
      request_units: 1,
    });
    expect(first.error).toBeNull();
    expect(await row(id)).toMatchObject({
      tenant_id: shop.id,
      product_type: "vehicle",
      enabled: true,
      instant_units: 2,
      request_units: 1,
      ready_now: 0,
      lead_time_hours: null,
      ready_updated_at: null,
    });
    expect(
      (await setListing(db("owner"), id, { lead_time_hours: 24 })).error,
    ).toBeNull();
    expect(
      (await setListing(db("owner"), id, { marketplace_listed: false })).error,
    ).toBeNull();
    // Switched off, the quantities and the lead time stay.
    expect(await row(id)).toMatchObject({
      enabled: false,
      instant_units: 2,
      request_units: 1,
      lead_time_hours: 24,
    });
  });

  it("on only on an approved list entry", async () => {
    const own = await addProduct(null);
    expect(
      (await setListing(db("owner"), own, { marketplace_listed: true })).error
        ?.message,
    ).toBe("not_listable");
    // Waiting for review: still not.
    await service
      .from("products")
      .update({ categories: ["scooter"] })
      .eq("id", own);
    const entry = await submit(own);
    expect(
      (await setListing(db("owner"), own, { marketplace_listed: true })).error
        ?.message,
    ).toBe("not_listable");
    // The service role is held to the same rule by the table's guard.
    expect(
      (await forceListing(shop.id, own, { marketplace_listed: true })).error
        ?.message,
    ).toBe("not_listable");
    expect((await review(entry, false)).error).toBeNull();
    expect((await listingOf(own)).marketplace_listed).toBe(false);
  });

  it("a product whose listing is on can't be taken off its entry behind the listing's back", async () => {
    const { id } = await addListable();
    await setListing(db("owner"), id, {
      marketplace_listed: true,
    }).throwOnError();
    const off = await db("owner")
      .from("products")
      .update({ catalog_id: null })
      .eq("id", id)
      .select("id");
    expect(off.error?.message).toBe("not_listable");
    // To another approved entry is fine (what Change model does).
    const moved = await db("owner")
      .from("products")
      .update({ catalog_id: presetB })
      .eq("id", id)
      .select("id");
    expect(moved.error).toBeNull();
    // Off first, and it can go.
    await setListing(db("owner"), id, {
      marketplace_listed: false,
    }).throwOnError();
    const gone = await db("owner")
      .from("products")
      .update({ catalog_id: null })
      .eq("id", id)
      .select("id");
    expect(gone.error).toBeNull();
  });

  it("instant plus request, and walk-ins, never above the active vehicles", async () => {
    const { id, unitIds } = await addListable(2);
    await addUnit(id, "maintenance");
    const set = (values: Parameters<typeof setListing>[2]) =>
      setListing(db("owner"), id, values);
    expect(
      (await set({ instant_units: 1, request_units: 1 })).error,
    ).toBeNull();
    expect((await set({ instant_units: 2 })).error?.message).toBe(
      "more_units_than_active",
    );
    expect((await set({ request_units: 2 })).error?.message).toBe(
      "more_units_than_active",
    );
    expect((await set({ ready_now: 2 })).error).toBeNull();
    expect((await set({ ready_now: 3 })).error?.message).toBe(
      "more_units_than_active",
    );
    // A refused save changed nothing.
    expect(await listingOf(id)).toEqual({
      marketplace_listed: false,
      instant_units: 1,
      request_units: 1,
      ready_now: 2,
    });
    // The service role is held to the same rule.
    expect(
      (await forceListing(shop.id, id, { instant_units: 5 })).error?.message,
    ).toBe("more_units_than_active");
    // A vehicle leaves: the counts follow it down, request units first.
    await db("mechanic")
      .from("units")
      .update({ status: "maintenance" })
      .eq("id", unitIds[0]);
    expect(await listingOf(id)).toEqual({
      marketplace_listed: false,
      instant_units: 1,
      request_units: 0,
      ready_now: 1,
    });
    const clamp = await events(id, ["clamp_booking_counts"]);
    expect(clamp).toMatchObject([
      {
        entity: "products",
        actor: shop.members.mechanic.id,
        before: { instant_units: 1, request_units: 1, ready_now: 2 },
        after: { instant_units: 1, request_units: 0, ready_now: 1 },
      },
    ]);
  });

  it("a vehicle leaving a product that was never listed changes nothing and makes no row", async () => {
    const { id, unitIds } = await addListable(1);
    await service.from("units").update({ status: "sold" }).eq("id", unitIds[0]);
    expect(await row(id)).toBeNull();
    expect(await events(id, ["clamp_booking_counts"])).toEqual([]);
  });

  it("retiring switches the listing off and zeroes it; it can't go on again until the product is restored", async () => {
    const { id, unitIds } = await addListable(1);
    await setListing(db("owner"), id, {
      marketplace_listed: true,
      instant_units: 1,
      ready_now: 1,
      lead_time_hours: 6,
    }).throwOnError();
    await service
      .from("units")
      .update({ status: "retired" })
      .eq("id", unitIds[0]);
    expect((await retire(id)).error).toBeNull();
    expect(await row(id)).toMatchObject({
      enabled: false,
      instant_units: 0,
      request_units: 0,
      ready_now: 0,
      // The shop's own setting stays.
      lead_time_hours: 6,
    });
    expect(
      (await setListing(db("owner"), id, { marketplace_listed: true })).error
        ?.message,
    ).toBe("model_retired");
    expect(
      (await forceListing(shop.id, id, { marketplace_listed: true })).error
        ?.message,
    ).toBe("model_retired");
    expect((await retire(id, false)).error).toBeNull();
    expect(
      (await setListing(db("owner"), id, { marketplace_listed: true })).error,
    ).toBeNull();
  });

  it("retiring a product that was never listed makes no row", async () => {
    const id = await addProduct();
    expect((await retire(id)).error).toBeNull();
    expect(await row(id)).toBeNull();
  });

  it("deleting the product takes its listing with it", async () => {
    const id = await addProduct();
    await setListing(db("owner"), id, { lead_time_hours: 3 }).throwOnError();
    expect(await row(id)).not.toBeNull();
    const gone = await db("owner")
      .from("products")
      .delete()
      .eq("id", id)
      .select("id");
    expect(gone.data).toHaveLength(1);
    expect(await row(id)).toBeNull();
  });

  it("a listing can't be moved to another product or another shop", async () => {
    const { id } = await addListable(1);
    const elsewhere = await addProduct();
    await setListing(db("owner"), id, { lead_time_hours: 3 }).throwOnError();
    const moved = await service
      .from("product_listings")
      .update({ product_id: elsewhere })
      .eq("product_id", id)
      .select("product_id");
    expect(moved.error?.message).toBe("listing_product_fixed");
    const theirs = await addProduct(presetA, other);
    const crossed = await service.from("product_listings").insert({
      tenant_id: shop.id,
      product_id: theirs,
    });
    expect(crossed.error?.code).toBe("23503");
  });
});

describe("lead time and what save_listing accepts", () => {
  it("plain hours from 0 to 720; null means none of its own", async () => {
    const id = await addProduct();
    const lead = (value: unknown) =>
      db("owner").rpc("save_listing", {
        p_product_id: id,
        p_settings: { lead_time_hours: value } as never,
      });
    for (const hours of [0, 1, 24, 720]) {
      expect((await lead(hours)).error, String(hours)).toBeNull();
      expect((await row(id))?.lead_time_hours).toBe(hours);
    }
    expect((await lead(721)).error?.message).toContain(
      "product_listings_lead_time_hours_check",
    );
    for (const bad of [-1, 1.5, "24", true, [24]])
      expect((await lead(bad)).error?.code, JSON.stringify(bad)).toBe("22023");
    expect((await row(id))?.lead_time_hours).toBe(720);
    expect((await lead(null)).error).toBeNull();
    expect((await row(id))?.lead_time_hours).toBeNull();
  });

  it("refuses a setting it doesn't know, a count that isn't a whole number, and anything that isn't a list of settings", async () => {
    const { id } = await addListable(1);
    const save = (settings: unknown) =>
      db("owner").rpc("save_listing", {
        p_product_id: id,
        p_settings: settings as never,
      });
    for (const bad of [
      { ready_updated_at: "2020-01-01T00:00:00Z" },
      { tenant_id: other.id },
      { product_id: id },
      { instant_units: -1 },
      { instant_units: 0.5 },
      { request_units: "1" },
      { ready_now: null },
      { enabled: "yes" },
      { enabled: null },
      [],
      "on",
      7,
    ])
      expect((await save(bad)).error?.code, JSON.stringify(bad)).toBe("22023");
    expect(await row(id)).toBeNull();
  });

  it("sets the ready-updated time itself, whenever a walk-ins count above zero is saved", async () => {
    const { id } = await addListable(2);
    const before = Date.now() - 5_000;
    await setListing(db("owner"), id, { instant_units: 1 }).throwOnError();
    expect((await row(id))?.ready_updated_at).toBeNull();
    await setListing(db("owner"), id, { ready_now: 1 }).throwOnError();
    const first = (await row(id))!.ready_updated_at!;
    expect(Date.parse(first)).toBeGreaterThan(before);
    // The same count confirmed again is news too: "still one ready".
    await new Promise((r) => setTimeout(r, 20));
    await setListing(db("owner"), id, { ready_now: 1 }).throwOnError();
    const second = (await row(id))!.ready_updated_at!;
    expect(Date.parse(second)).toBeGreaterThan(Date.parse(first));
    // Zero, or another setting, leaves it.
    await setListing(db("owner"), id, {
      ready_now: 0,
      lead_time_hours: 2,
    }).throwOnError();
    expect((await row(id))!.ready_updated_at).toBe(second);
  });
});

describe("who may do what", () => {
  it("the one table of roles: owners and managers, for the settings and for the walk-ins count", () => {
    const { out, failed } = sql(`
      select platform_private.listing_roles('settings')::text
        || ' ' || platform_private.listing_roles('walk_ins')::text
        || ' ' || coalesce(platform_private.listing_roles('anything else')::text, 'null');
    `);
    expect(failed).toBe("");
    expect(out).toBe("{owner,manager} {owner,manager} null");
  });

  it("owners and managers save every setting; staff, mechanics and drivers none, the walk-ins count included", async () => {
    const { id } = await addListable(2);
    const settings = [
      { marketplace_listed: true },
      { instant_units: 1 },
      { request_units: 1 },
      { ready_now: 1 },
      { lead_time_hours: 12 },
    ];
    for (const role of ["staff", "mechanic", "driver"] as const)
      for (const values of settings) {
        const { error } = await setListing(db(role), id, values);
        expect(error?.code, `${role} ${JSON.stringify(values)}`).toBe("42501");
        expect(error?.message).toBe("only_owner_or_manager");
      }
    expect(await row(id)).toBeNull();
    for (const role of ["owner", "manager"] as const)
      for (const values of settings)
        expect(
          (await setListing(db(role), id, values)).error,
          `${role} ${JSON.stringify(values)}`,
        ).toBeNull();
    expect(await row(id)).toMatchObject({
      enabled: true,
      instant_units: 1,
      request_units: 1,
      ready_now: 1,
      lead_time_hours: 12,
    });
  });

  it("every member reads the shop's listings; nobody writes the table directly, the owner included", async () => {
    const { id } = await addListable(1);
    const spare = await addProduct();
    await setListing(db("owner"), id, {
      marketplace_listed: true,
      instant_units: 1,
    }).throwOnError();
    const before = await row(id);
    for (const role of roles) {
      const read = await db(role)
        .from("product_listings")
        .select("product_id, enabled")
        .eq("product_id", id);
      expect(read.data, `${role} reading`).toEqual([
        { product_id: id, enabled: true },
      ]);
      const inserted = await db(role)
        .from("product_listings")
        .insert({ tenant_id: shop.id, product_id: spare })
        .select("product_id");
      expect(inserted.error?.code, `${role} inserting`).toBe("42501");
      const updated = await db(role)
        .from("product_listings")
        .update({ instant_units: 0, enabled: false })
        .eq("product_id", id)
        .select("product_id");
      expect(updated.error?.code, `${role} updating`).toBe("42501");
      const deleted = await db(role)
        .from("product_listings")
        .delete()
        .eq("product_id", id)
        .select("product_id");
      expect(deleted.error?.code, `${role} deleting`).toBe("42501");
    }
    expect(await row(id)).toEqual(before);
    expect(await row(spare)).toBeNull();
  });

  it("another shop's people, an outsider and a signed-out visitor read nothing and change nothing", async () => {
    const { id } = await addListable(1);
    await setListing(db("owner"), id, { lead_time_hours: 5 }).throwOnError();
    const before = await row(id);
    const outsider = await createUser("listing-outsider");
    const callers = [
      ...roles.map((role) => ({
        who: `other shop's ${role}`,
        db: other.members[role].db,
      })),
      { who: "an outsider", db: outsider.db },
      { who: "a signed-out visitor", db: anonClient() },
    ];
    for (const { who, db: caller } of callers) {
      const read = await caller
        .from("product_listings")
        .select("product_id")
        .eq("product_id", id);
      expect(read.data ?? [], `${who} reading`).toEqual([]);
      const saved = await caller.rpc("save_listing", {
        p_product_id: id,
        p_settings: { lead_time_hours: 99 },
      });
      expect(saved.error?.code, `${who} saving`).toBe("42501");
      const disconnected = await caller.rpc("disconnect_listing", {
        p_product_id: id,
      });
      expect(disconnected.error?.code, `${who} disconnecting`).toBe("42501");
    }
    expect(await row(id)).toEqual(before);
    await deleteUser(outsider);
  });

  it("the helper behind Disconnect checks the caller itself", async () => {
    const { id } = await addListable(1);
    await setListing(db("owner"), id, {
      marketplace_listed: true,
      instant_units: 1,
    }).throwOnError();
    for (const user of [shop.members.staff, other.members.owner]) {
      const claims = JSON.stringify({ sub: user.id, role: "authenticated" });
      const { failed } = sql(`
        begin;
        select set_config('request.jwt.claims', '${claims}', true);
        set local role authenticated;
        select platform_private.listing_clear('${id}');
        commit;
      `);
      expect(failed).toContain("only_owner_or_manager");
    }
    expect(await listingOf(id)).toMatchObject({
      marketplace_listed: true,
      instant_units: 1,
    });
  });
});

describe("the switch going on or off is an event on the product", () => {
  const switches = (id: string) => events(id, ["listing_on", "listing_off"]);

  it("a shop's save: on, then off, each once, by whoever did it; other settings write none", async () => {
    const { id } = await addListable(1);
    await setListing(db("owner"), id, { instant_units: 1 }).throwOnError();
    expect(await switches(id)).toEqual([]);
    await setListing(db("manager"), id, {
      marketplace_listed: true,
    }).throwOnError();
    // Saved on again: nothing changed, nothing recorded.
    await setListing(db("owner"), id, {
      marketplace_listed: true,
      lead_time_hours: 4,
    }).throwOnError();
    await setListing(db("owner"), id, {
      marketplace_listed: false,
    }).throwOnError();
    expect(await switches(id)).toEqual([
      {
        entity: "products",
        action: "listing_on",
        actor: shop.members.manager.id,
        before: { enabled: false },
        after: { enabled: true },
      },
      {
        entity: "products",
        action: "listing_off",
        actor: shop.members.owner.id,
        before: { enabled: true },
        after: { enabled: false },
      },
    ]);
    // The row's own changes are in the audit trail too, under its table.
    const { data: rows } = await service
      .from("audit_events")
      .select("action")
      .eq("entity", "product_listings")
      .eq("entity_id", id)
      .order("id");
    expect(rows!.map((r) => r.action)).toEqual([
      "insert",
      "update",
      "update",
      "update",
    ]);
  });

  it("first listed in one go: the row is made already on", async () => {
    const { id } = await addListable(1);
    await setListing(db("owner"), id, {
      marketplace_listed: true,
      instant_units: 1,
    }).throwOnError();
    expect((await switches(id)).map((e) => e.action)).toEqual(["listing_on"]);
  });

  it("an approval switches it on (the reviewer's doing); a merge too", async () => {
    const approved = await addProduct(null);
    const merged = await addProduct(null);
    await service
      .from("products")
      .update({ categories: ["scooter"] })
      .in("id", [approved, merged]);
    expect((await review(await submit(approved), true)).error).toBeNull();
    expect(
      (await review(await submit(merged), false, presetB)).error,
    ).toBeNull();
    for (const id of [approved, merged]) {
      expect((await listingOf(id)).marketplace_listed).toBe(true);
      expect(await switches(id)).toMatchObject([
        { action: "listing_on", actor: admin.id },
      ]);
    }
  });

  it("retiring and disconnecting switch it off", async () => {
    const retired = await addProduct();
    const disconnected = (await addListable(1)).id;
    for (const id of [retired, disconnected])
      await setListing(db("owner"), id, {
        marketplace_listed: true,
      }).throwOnError();
    expect((await retire(retired)).error).toBeNull();
    const { error } = await db("manager").rpc("disconnect_listing", {
      p_product_id: disconnected,
    });
    expect(error).toBeNull();
    expect((await switches(retired)).map((e) => e.action)).toEqual([
      "listing_on",
      "listing_off",
    ]);
    expect(await switches(disconnected)).toMatchObject([
      { action: "listing_on" },
      { action: "listing_off", actor: shop.members.manager.id },
    ]);
  });
});

describe("Change model and Disconnect on the new table", () => {
  it("Change model keeps the switch and every setting", async () => {
    const { id } = await addListable(2);
    await setListing(db("owner"), id, {
      marketplace_listed: true,
      instant_units: 1,
      request_units: 1,
      ready_now: 1,
      lead_time_hours: 8,
    }).throwOnError();
    const before = await row(id);
    const { error } = await db("owner").rpc("change_listing_entry", {
      p_product_id: id,
      p_catalog_id: presetB,
    });
    expect(error).toBeNull();
    expect(await row(id)).toEqual(before);
  });

  it("Disconnect switches off, zeroes the counts, keeps the lead time, and records what was there", async () => {
    const { id } = await addListable(2);
    await setListing(db("owner"), id, {
      marketplace_listed: true,
      instant_units: 1,
      request_units: 1,
      ready_now: 2,
      lead_time_hours: 8,
    }).throwOnError();
    const { error } = await db("owner").rpc("disconnect_listing", {
      p_product_id: id,
    });
    expect(error).toBeNull();
    expect(await row(id)).toMatchObject({
      enabled: false,
      instant_units: 0,
      request_units: 0,
      ready_now: 0,
      lead_time_hours: 8,
    });
    const audit = await events(id, ["listing_disconnect"]);
    expect(audit).toMatchObject([
      {
        actor: shop.members.owner.id,
        before: {
          catalog_id: presetA,
          marketplace_listed: true,
          instant_units: 1,
          request_units: 1,
          ready_now: 2,
        },
      },
    ]);
  });

  it("Disconnect on a product that was never listed clears the entry and makes no row", async () => {
    const id = await addProduct();
    const { error } = await db("owner").rpc("disconnect_listing", {
      p_product_id: id,
    });
    expect(error).toBeNull();
    expect(await row(id)).toBeNull();
    const audit = await events(id, ["listing_disconnect"]);
    expect(audit[0].before).toMatchObject({
      marketplace_listed: false,
      instant_units: 0,
    });
  });
});

describe("a review and a retired product", () => {
  it("approving a request whose product was retired meanwhile goes through, and leaves that product off", async () => {
    const id = await addProduct(null);
    await service
      .from("products")
      .update({ categories: ["scooter"] })
      .eq("id", id);
    const entry = await submit(id);
    expect((await retire(id)).error).toBeNull();
    expect((await review(entry, true)).error).toBeNull();
    expect((await listingOf(id)).marketplace_listed).toBe(false);
    const { data } = await service
      .from("products")
      .select("catalog_id, catalog_approved_at, retired_at")
      .eq("id", id)
      .single();
    expect(data!.catalog_id).toBe(entry);
    expect(data!.catalog_approved_at).not.toBeNull();
    expect(data!.retired_at).not.toBeNull();
  });
});

describe("lock order: the product's row, then the listing's", () => {
  it("save_listing waits for whoever holds the product's row", async () => {
    const { id } = await addListable(1);
    const marker = `hold-product-${tag}`;
    const first = sqlBackground(`
      begin;
      select 1 from platform.products where id = '${id}' for no key update;
      select pg_sleep(1.5) /* ${marker} */;
      commit;
    `);
    await holding(marker);
    const started = Date.now();
    const { error } = await setListing(db("owner"), id, { instant_units: 1 });
    expect(error).toBeNull();
    expect(Date.now() - started).toBeGreaterThan(700);
    expect((await first).failed).toBe("");
  });

  it("a writer that has the product's row is never made to wait by the listing's row alone: the listing is only ever locked under the product's lock", async () => {
    // Every path that writes a listing, each run while another session
    // holds the product's row. None may get as far as the listing's row:
    // while the holder sleeps, nobody else holds a lock on the listing.
    const { id, unitIds } = await addListable(2);
    await setListing(db("owner"), id, {
      marketplace_listed: true,
      instant_units: 2,
      ready_now: 2,
    }).throwOnError();
    const marker = `hold-order-${tag}`;
    const holder = sqlBackground(`
      begin;
      select 1 from platform.products where id = '${id}' for no key update;
      select pg_sleep(2) /* ${marker} */;
      commit;
    `);
    await holding(marker);
    const writers = [
      setListing(db("owner"), id, { instant_units: 1 }),
      db("mechanic")
        .from("units")
        .update({ status: "maintenance" })
        .eq("id", unitIds[0])
        .select("id"),
      db("manager").rpc("change_listing_entry", {
        p_product_id: id,
        p_catalog_id: presetB,
      }),
    ];
    await new Promise((r) => setTimeout(r, 600));
    const { out } = sql(`
      select count(*) from pg_locks l
      join pg_stat_activity a on a.pid = l.pid
      where l.relation = 'platform.product_listings'::regclass
        and l.mode in ('RowExclusiveLock', 'RowShareLock')
        and a.pid <> pg_backend_pid();
    `);
    expect(out).toBe("0");
    const results = await Promise.all(writers);
    expect((await holder).failed).toBe("");
    noDeadlock(results);
    for (const { error } of results) expect(error).toBeNull();
    // One vehicle is left active: whatever order they ran in, the counts fit.
    const after = await listingOf(id);
    expect(after.instant_units + after.request_units).toBeLessThanOrEqual(1);
    expect(after.ready_now).toBeLessThanOrEqual(1);
  }, 30_000);
});

describe("races", () => {
  it("raising the counts while a vehicle is sold: never more offered than there are", async () => {
    for (let round = 0; round < 8; round++) {
      const { id, unitIds } = await addListable(2);
      const results = await Promise.all([
        setListing(db(round % 2 ? "owner" : "manager"), id, {
          instant_units: 1,
          request_units: 1,
          ready_now: 2,
        }),
        db("owner")
          .from("units")
          .update({ status: "sold" })
          .eq("id", unitIds[0])
          .select("id"),
      ]);
      noDeadlock(results);
      expect(results[1].error, `round ${round}`).toBeNull();
      // The save came first (then the counts followed the vehicle down), or
      // second (and was refused in words a person can read).
      if (results[0].error)
        expect(results[0].error.message, `round ${round}`).toBe(
          "more_units_than_active",
        );
      const after = await listingOf(id);
      expect(
        after.instant_units + after.request_units,
        `round ${round}`,
      ).toBeLessThanOrEqual(1);
      expect(after.ready_now, `round ${round}`).toBeLessThanOrEqual(1);
      if (!results[0].error)
        expect(after, `round ${round}`).toEqual({
          marketplace_listed: false,
          instant_units: 1,
          request_units: 0,
          ready_now: 1,
        });
    }
  }, 90_000);

  it("an approval while the shop retires the product: both go through, and it ends retired and off", async () => {
    for (let round = 0; round < 6; round++) {
      const id = await addProduct(null);
      await service
        .from("products")
        .update({ categories: ["scooter"] })
        .eq("id", id);
      const entry = await submit(id);
      const results = await Promise.all([review(entry, true), retire(id)]);
      noDeadlock(results);
      expect(results[0].error, `round ${round}: review`).toBeNull();
      expect(results[1].error, `round ${round}: retire`).toBeNull();
      expect((await listingOf(id)).marketplace_listed, `round ${round}`).toBe(
        false,
      );
      const { data } = await service
        .from("products")
        .select("retired_at, catalog_approved_at")
        .eq("id", id)
        .single();
      expect(data!.retired_at, `round ${round}`).not.toBeNull();
      expect(data!.catalog_approved_at, `round ${round}`).not.toBeNull();
    }
  }, 90_000);

  it("the switch going on while Disconnect runs: never on without a list entry", async () => {
    for (let round = 0; round < 8; round++) {
      const { id } = await addListable(1);
      await setListing(db("owner"), id, { instant_units: 1 }).throwOnError();
      const results = await Promise.all([
        setListing(db("manager"), id, { marketplace_listed: true }),
        db("owner").rpc("disconnect_listing", { p_product_id: id }),
      ]);
      noDeadlock(results);
      expect(results[1].error, `round ${round}: disconnect`).toBeNull();
      // Switched on first (then disconnected), or second (not listable).
      if (results[0].error)
        expect(results[0].error.message, `round ${round}`).toBe("not_listable");
      const { data } = await service
        .from("products")
        .select("catalog_id")
        .eq("id", id)
        .single();
      expect(data!.catalog_id, `round ${round}`).toBeNull();
      expect(await listingOf(id), `round ${round}`).toEqual({
        marketplace_listed: false,
        instant_units: 0,
        request_units: 0,
        ready_now: 0,
      });
    }
  }, 90_000);

  it("two saves at once on one listing: both land, neither undoes the other", async () => {
    for (let round = 0; round < 6; round++) {
      const { id } = await addListable(2);
      await setListing(db("owner"), id, { request_units: 1 }).throwOnError();
      const results = await Promise.all([
        setListing(db("owner"), id, { instant_units: 1 }),
        setListing(db("manager"), id, { ready_now: 2 }),
        setListing(db("owner"), id, { lead_time_hours: 12 }),
        setListing(db("manager"), id, { marketplace_listed: true }),
      ]);
      noDeadlock(results);
      for (const { error } of results)
        expect(error, `round ${round}`).toBeNull();
      expect(await row(id), `round ${round}`).toMatchObject({
        enabled: true,
        instant_units: 1,
        request_units: 1,
        ready_now: 2,
        lead_time_hours: 12,
      });
    }
  }, 90_000);

  it("twelve first saves at once on a product that was never listed: one row, twelve answers, no error", async () => {
    const { id } = await addListable(3);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        setListing(db(i % 2 ? "owner" : "manager"), id, {
          lead_time_hours: i + 1,
          ...(i % 3 === 0 ? { instant_units: 1 } : {}),
        }),
      ),
    );
    noDeadlock(results);
    for (const { error } of results) expect(error).toBeNull();
    const { data } = await service
      .from("product_listings")
      .select("product_id, instant_units, lead_time_hours")
      .eq("product_id", id);
    expect(data).toHaveLength(1);
    expect(data![0].instant_units).toBe(1);
    expect(data![0].lead_time_hours).toBeGreaterThanOrEqual(1);
    expect(data![0].lead_time_hours).toBeLessThanOrEqual(12);
    // The row was made once and changed eleven times.
    const { data: audit } = await service
      .from("audit_events")
      .select("action")
      .eq("entity", "product_listings")
      .eq("entity_id", id);
    expect(audit!.filter((a) => a.action === "insert")).toHaveLength(1);
  }, 60_000);

  it("a save, a vehicle leaving, a Change model and a retire attempt all at once: no deadlock, and the rules hold", async () => {
    for (let round = 0; round < 6; round++) {
      const { id, unitIds } = await addListable(2);
      await setListing(db("owner"), id, {
        marketplace_listed: true,
        instant_units: 1,
      }).throwOnError();
      const results = await Promise.all([
        setListing(db("manager"), id, { instant_units: 2, ready_now: 2 }),
        db("staff")
          .from("units")
          .update({ status: "maintenance" })
          .eq("id", unitIds[round % 2])
          .select("id"),
        db("owner").rpc("change_listing_entry", {
          p_product_id: id,
          p_catalog_id: presetB,
        }),
        // Refused (it has vehicles in the fleet), but it takes the lock.
        retire(id),
        setListing(db("owner"), id, { marketplace_listed: false }),
      ]);
      noDeadlock(results);
      expect(results[1].error, `round ${round}`).toBeNull();
      expect(results[2].error, `round ${round}`).toBeNull();
      expect(results[3].error?.message, `round ${round}`).toContain(
        "model_has_active_units",
      );
      const after = await listingOf(id);
      expect(
        after.instant_units + after.request_units,
        `round ${round}`,
      ).toBeLessThanOrEqual(1);
      expect(after.ready_now, `round ${round}`).toBeLessThanOrEqual(1);
      expect(after.marketplace_listed, `round ${round}`).toBe(false);
    }
  }, 90_000);
});
