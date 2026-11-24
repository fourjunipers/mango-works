/**
 * Phase 2, stage 10: the review follow-ups of migration
 * 20261119000100_platform_review_followups (docs/phase-2-plan.md §3.8).
 *
 *  - unit_renewals.recorded_by is always the signed-in caller.
 *  - record_renewal(): a renewal and its cost, together or not at all.
 *  - save_location_hours(): a location's week replaced as one set.
 *  - platform_admin_events: every change to platform_admins is recorded.
 *  - A tenant with audit rows can't be hard-deleted.
 *
 * The coupon items of the same migration (coupon_inputs_by_id(), the
 * full-width fold, the currency lock) are in coupons.test.ts, with the
 * helpers that make bookings.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCatalogEntry,
  createTenant,
  createUser,
  deleteTenant,
  deleteUser,
  modelSpec,
  removeCatalogEntry,
  serviceClient,
  sql,
  type TestTenant,
  type TestUser,
} from "./helpers";
import { exactlyOne } from "@mango/db/rows";

const service = serviceClient();
const thailand = {
  country: "TH",
  currency: "THB",
  locale: "th-TH",
  timezone: "Asia/Bangkok",
};

let shop: TestTenant;
let other: TestTenant;
let catalogId: string;
let unitId: string;
let otherUnitId: string;
let plate = 0;

async function addUnit(tenant: TestTenant): Promise<string> {
  const product = await exactlyOne(
    service
      .from("products")
      .insert({
        tenant_id: tenant.id,
        catalog_id: catalogId,
        ...modelSpec,
        name: `Followups model ${++plate}`,
      })
      .select("id"),
  );
  if (product.error) throw product.error;
  const unit = await exactlyOne(
    service
      .from("units")
      .insert({
        tenant_id: tenant.id,
        product_id: product.data.id,
        location_id: tenant.locationId,
        plate: `RF-${plate}`,
      })
      .select("id"),
  );
  if (unit.error) throw unit.error;
  return unit.data.id;
}

const renewalsOf = async (unit: string) => {
  const { data, error } = await service
    .from("unit_renewals")
    .select("id, kind, expires_at, recorded_by, provider")
    .eq("unit_id", unit)
    .order("created_at");
  if (error) throw error;
  return data;
};

const costsOf = async (tenant: TestTenant) => {
  const { data, error } = await service
    .from("unit_renewal_costs")
    .select("renewal_id, cost, currency")
    .eq("tenant_id", tenant.id);
  if (error) throw error;
  return data;
};

beforeAll(async () => {
  catalogId = await createCatalogEntry("followups");
  [shop, other] = await Promise.all([
    createTenant("followups-a", thailand),
    createTenant("followups-b"),
  ]);
  [unitId, otherUnitId] = await Promise.all([addUnit(shop), addUnit(other)]);
}, 120_000);

afterAll(async () => {
  await Promise.all([deleteTenant(shop), deleteTenant(other)]);
  await removeCatalogEntry(catalogId);
}, 60_000);

// ------------------------------------------------------------- recorded_by

describe("unit_renewals.recorded_by is set in the database from the caller", () => {
  const row = (more: object = {}) => ({
    tenant_id: shop.id,
    unit_id: unitId,
    kind: "road_tax",
    expires_at: "2027-03-31",
    ...more,
  });

  it("a recorded_by sent by the client is overwritten with the caller's own id", async () => {
    const { data, error } = await exactlyOne(
      shop.members.mechanic.db
        .from("unit_renewals")
        .insert(row({ recorded_by: shop.members.owner.id }))
        .select("id, recorded_by"),
    );
    expect(error).toBeNull();
    expect(data?.recorded_by).toBe(shop.members.mechanic.id);

    // Left out, or sent as null: the caller all the same.
    for (const more of [{}, { recorded_by: null }]) {
      const added = await exactlyOne(
        shop.members.staff.db
          .from("unit_renewals")
          .insert(row(more))
          .select("recorded_by"),
      );
      expect(added.error).toBeNull();
      expect(added.data?.recorded_by).toBe(shop.members.staff.id);
    }
  });

  it("a caller with no user is refused: the service role, and the database's own superuser", async () => {
    const before = (await renewalsOf(unitId)).length;
    const byService = await service.from("unit_renewals").insert(row());
    expect(byService.error?.message).toBe("recorded_by_required");
    expect(byService.error?.code).toBe("42501");
    // Naming a user does not help: there is still no caller.
    const named = await service
      .from("unit_renewals")
      .insert(row({ recorded_by: shop.members.owner.id }));
    expect(named.error?.message).toBe("recorded_by_required");
    const bySuperuser = sql(
      `insert into platform.unit_renewals (tenant_id, unit_id, kind, expires_at, recorded_by)
       values ('${shop.id}', '${unitId}', 'road_tax', '2027-03-31', '${shop.members.owner.id}');`,
    );
    expect(bySuperuser.failed).toContain("recorded_by_required");
    expect((await renewalsOf(unitId)).length).toBe(before);
  });

  it("it can't be changed afterwards, by its own shop or by the service role", async () => {
    const added = await exactlyOne(
      shop.members.mechanic.db.from("unit_renewals").insert(row()).select("id"),
    );
    expect(added.error).toBeNull();
    const id = added.data!.id;
    const read = async () =>
      (
        await exactlyOne(
          service
            .from("unit_renewals")
            .select("recorded_by, provider")
            .eq("id", id),
        )
      ).data;

    // The rest of the update is saved; recorded_by stays.
    const byOwner = await shop.members.owner.db
      .from("unit_renewals")
      .update({ recorded_by: shop.members.owner.id, provider: "Changed" })
      .eq("id", id);
    expect(byOwner.error).toBeNull();
    expect(await read()).toEqual({
      recorded_by: shop.members.mechanic.id,
      provider: "Changed",
    });
    for (const value of [shop.members.manager.id, null]) {
      const byService = await service
        .from("unit_renewals")
        .update({ recorded_by: value })
        .eq("id", id);
      expect(byService.error).toBeNull();
      expect((await read())?.recorded_by).toBe(shop.members.mechanic.id);
    }
  });

  it("it is emptied when that user's account is deleted, and only then", async () => {
    const temp: TestUser = await createUser("followups-temp");
    const member = await service
      .from("memberships")
      .insert({ tenant_id: shop.id, user_id: temp.id, role: "staff" });
    expect(member.error).toBeNull();
    const added = await exactlyOne(
      temp.db
        .from("unit_renewals")
        .insert(row({ kind: "inspection" }))
        .select("id, recorded_by"),
    );
    expect(added.error).toBeNull();
    expect(added.data?.recorded_by).toBe(temp.id);
    await deleteUser(temp);
    const after = await exactlyOne(
      service
        .from("unit_renewals")
        .select("recorded_by")
        .eq("id", added.data!.id),
    );
    expect(after.error).toBeNull();
    expect(after.data?.recorded_by).toBeNull();
  });
});

// ---------------------------------------------------------- record_renewal

describe("record_renewal(): a renewal and its cost in one transaction", () => {
  const renewal = (more: object = {}) => ({
    unit_id: unitId,
    kind: "compulsory_insurance",
    provider: "Test insurer",
    reference_no: "P-10",
    starts_at: "2026-04-01",
    expires_at: "2027-03-31",
    ...more,
  });
  const record = (
    who: TestUser,
    p_renewal: object,
    tenant: TestTenant = shop,
  ) =>
    who.db.rpc("record_renewal", {
      p_tenant_id: tenant.id,
      p_renewal: p_renewal as never,
    });
  const idOf = (data: unknown) => (data as { id: string } | null)?.id;

  it("an owner saves both: the renewal with recorded_by, and the cost in the shop's currency", async () => {
    const { data, error } = await record(
      shop.members.owner,
      renewal({ cost: "64500" }),
    );
    expect(error).toBeNull();
    const id = idOf(data)!;
    const saved = await exactlyOne(
      service
        .from("unit_renewals")
        .select(
          "tenant_id, unit_id, kind, provider, reference_no, starts_at, expires_at, recorded_by",
        )
        .eq("id", id),
    );
    expect(saved.data).toEqual({
      tenant_id: shop.id,
      unit_id: unitId,
      kind: "compulsory_insurance",
      provider: "Test insurer",
      reference_no: "P-10",
      starts_at: "2026-04-01",
      expires_at: "2027-03-31",
      recorded_by: shop.members.owner.id,
    });
    expect((await costsOf(shop)).filter((c) => c.renewal_id === id)).toEqual([
      { renewal_id: id, cost: 64_500, currency: "THB" },
    ]);
  });

  it("the cost rule is the tables' own: every role, by the function and by hand, agrees", async () => {
    // What the policies of unit_renewals and unit_renewal_costs allow.
    const mayRecord = ["owner", "manager", "staff", "mechanic"];
    const maySetCost = ["owner", "manager"];
    for (const role of [
      "owner",
      "manager",
      "staff",
      "mechanic",
      "driver",
    ] as const) {
      const who = shop.members[role];
      // By hand, on the tables.
      const byHand = await exactlyOne(
        who.db
          .from("unit_renewals")
          .insert({
            tenant_id: shop.id,
            unit_id: unitId,
            kind: "inspection",
            expires_at: "2027-05-31",
          })
          .select("id"),
      );
      expect(byHand.error === null, `${role} by hand`).toBe(
        mayRecord.includes(role),
      );
      if (byHand.data) {
        const cost = await who.db.from("unit_renewal_costs").insert({
          tenant_id: shop.id,
          renewal_id: byHand.data.id,
          currency: "THB",
          cost: 100,
        });
        expect(cost.error === null, `${role} cost by hand`).toBe(
          maySetCost.includes(role),
        );
      }
      // By the function: the same answers.
      const plain = await record(who, renewal({ kind: "inspection" }));
      expect(plain.error === null, `${role} record_renewal`).toBe(
        mayRecord.includes(role),
      );
      if (!mayRecord.includes(role)) {
        expect(plain.error?.message, role).toBe("not_allowed");
        expect(plain.error?.code, role).toBe("42501");
      }
      const before = (await renewalsOf(unitId)).length;
      const withCost = await record(
        who,
        renewal({ kind: "inspection", cost: "100" }),
      );
      expect(
        withCost.error === null,
        `${role} record_renewal with a cost`,
      ).toBe(maySetCost.includes(role));
      if (!maySetCost.includes(role)) {
        expect(withCost.error?.message, role).toBe(
          mayRecord.includes(role) ? "only_owner_or_manager" : "not_allowed",
        );
        // Refused for the cost: the renewal is not saved either.
        expect((await renewalsOf(unitId)).length, role).toBe(before);
      }
    }
  });

  it("the renewal part fails: nothing is saved, no cost either", async () => {
    const renewals = (await renewalsOf(unitId)).length;
    const costs = (await costsOf(shop)).length;
    const cases: [string, object, string][] = [
      [
        "a kind that does not exist",
        { kind: "mot", cost: "100" },
        "invalid_renewal",
      ],
      [
        "expiry before the start",
        { starts_at: "2027-01-01", expires_at: "2026-01-01", cost: "100" },
        "invalid_renewal",
      ],
      [
        "a date that is not one",
        { expires_at: "2027-02-30", cost: "100" },
        "invalid_renewal",
      ],
      ["a cost that is not digits", { cost: "12.50" }, "invalid_renewal"],
      ["a cost as a number", { cost: 100 }, "invalid_renewal"],
      // Digits are 0 to 9 only: other scripts' digits get the function's own
      // refusal, not a cast error from further in.
      [
        "a cost in full-width digits",
        { cost: "\uFF11\uFF12" },
        "invalid_renewal",
      ],
      [
        "a cost in Arabic-Indic digits",
        { cost: "\u0661\u0662" },
        "invalid_renewal",
      ],
      [
        "a date in full-width digits",
        { expires_at: "\uFF12\uFF10\uFF12\uFF17-\uFF10\uFF11-\uFF10\uFF11" },
        "invalid_renewal",
      ],
      [
        "a setting it does not know",
        { recorded_by: shop.members.manager.id },
        "invalid_renewal",
      ],
      ["no unit", { unit_id: null }, "invalid_renewal"],
      [
        "a unit that does not exist",
        { unit_id: "00000000-0000-4000-8000-000000000000", cost: "100" },
        "unit_not_found",
      ],
      [
        "another shop's unit",
        { unit_id: otherUnitId, cost: "100" },
        "unit_not_found",
      ],
    ];
    for (const [what, more, message] of cases) {
      const { error } = await record(shop.members.owner, renewal(more));
      expect(error?.message, what).toBe(message);
    }
    expect((await renewalsOf(unitId)).length).toBe(renewals);
    expect((await renewalsOf(otherUnitId)).length).toBe(0);
    expect((await costsOf(shop)).length).toBe(costs);
  });

  it("the cost part fails after the renewal was written: the renewal is not saved", async () => {
    // A trigger that refuses one marked cost, so the second insert of the
    // function fails with the first already done. Removed again below.
    const marked = "424242424242";
    const made = sql(`
      create function platform_private.test_refuse_marked_cost() returns trigger
      language plpgsql as $$
      begin
        if new.cost = ${marked} then
          raise exception 'test_cost_refused' using errcode = 'P0001';
        end if;
        return new;
      end;
      $$;
      create trigger test_refuse_marked_cost before insert on platform.unit_renewal_costs
      for each row execute function platform_private.test_refuse_marked_cost();
    `);
    expect(made.failed).toBe("");
    try {
      const renewals = (await renewalsOf(unitId)).length;
      const costs = (await costsOf(shop)).length;
      const audits = async () =>
        (
          await service
            .from("audit_events")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", shop.id)
            .in("entity", ["unit_renewals", "unit_renewal_costs"])
        ).count;
      const auditsBefore = await audits();
      const refused = await record(
        shop.members.owner,
        renewal({ kind: "road_tax", cost: marked }),
      );
      expect(refused.error?.message).toBe("test_cost_refused");
      expect((await renewalsOf(unitId)).length).toBe(renewals);
      expect((await costsOf(shop)).length).toBe(costs);
      expect(await audits()).toBe(auditsBefore);
      // The same call with another cost goes through: the trigger was the
      // only thing in its way.
      const fine = await record(
        shop.members.owner,
        renewal({ kind: "road_tax", cost: "100" }),
      );
      expect(fine.error).toBeNull();
      expect((await renewalsOf(unitId)).length).toBe(renewals + 1);
      expect((await costsOf(shop)).length).toBe(costs + 1);
    } finally {
      const dropped = sql(`
        drop trigger test_refuse_marked_cost on platform.unit_renewal_costs;
        drop function platform_private.test_refuse_marked_cost();
      `);
      expect(dropped.failed).toBe("");
    }
  });

  it("another shop's members are refused, whichever shop they name; a stranger and a signed-out visitor too", async () => {
    const before = (await renewalsOf(unitId)).length;
    const costs = (await costsOf(shop)).length;
    // Naming this shop: not a member of it.
    for (const role of ["owner", "manager", "staff"] as const) {
      const { error } = await record(
        other.members[role],
        renewal({ cost: "100" }),
      );
      expect(error?.message, role).toBe("not_allowed");
    }
    // Naming their own shop, with this shop's unit: no such unit there.
    const own = await record(other.members.owner, renewal(), other);
    expect(own.error?.message).toBe("unit_not_found");
    const stranger = await createUser("followups-stranger");
    try {
      expect((await record(stranger, renewal())).error?.message).toBe(
        "not_allowed",
      );
    } finally {
      await deleteUser(stranger);
    }
    // The service role is not a caller of it at all.
    const byService = await service.rpc("record_renewal", {
      p_tenant_id: shop.id,
      p_renewal: renewal() as never,
    });
    expect(byService.error?.code).toBe("42501");
    expect((await renewalsOf(unitId)).length).toBe(before);
    expect((await costsOf(shop)).length).toBe(costs);
  });
});

// ----------------------------------------------------- save_location_hours

describe("save_location_hours(): a location's week as one atomic set", () => {
  type Hours = { weekday: number; open: string; close: string };
  const save = (
    who: TestUser,
    hours: unknown,
    tenant = shop,
    location = shop.locationId,
  ) =>
    who.db.rpc("save_location_hours", {
      p_tenant_id: tenant.id,
      p_location_id: location,
      p_hours: hours as never,
    });
  const stored = async (location = shop.locationId): Promise<Hours[]> => {
    const { data, error } = await service
      .from("location_hours")
      .select("weekday, open, close")
      .eq("location_id", location)
      .order("weekday");
    if (error) throw error;
    return data;
  };
  const day = (weekday: number, open = "09:00", close = "18:00"): Hours => ({
    weekday,
    open,
    close,
  });
  const asStored = (hours: Hours[]) =>
    hours.map((h) => ({
      weekday: h.weekday,
      open: `${h.open}:00`,
      close: `${h.close}:00`,
    }));
  const week = [1, 2, 3, 4, 5].map((d) => day(d));

  it("saves the week, answers it, and replaces it whole: days not named are closed", async () => {
    const first = await save(shop.members.owner, week);
    expect(first.error).toBeNull();
    expect(first.data).toEqual(asStored(week));
    expect(await stored()).toEqual(asStored(week));

    // A new week: Monday goes, Saturday comes, Friday closes earlier.
    const next = [
      day(2),
      day(3),
      day(4),
      day(5, "09:00", "16:30"),
      day(6, "10:00", "14:00"),
    ];
    const second = await save(shop.members.manager, next);
    expect(second.error).toBeNull();
    expect(await stored()).toEqual(asStored(next));

    // Closed all week.
    expect((await save(shop.members.owner, [])).error).toBeNull();
    expect(await stored()).toEqual([]);
    expect((await save(shop.members.owner, week)).error).toBeNull();
  });

  it("a bad row leaves the old hours intact, wherever it is in the list", async () => {
    expect((await save(shop.members.owner, week)).error).toBeNull();
    const good = [day(0, "10:00", "15:00"), day(6, "10:00", "15:00")];
    const bad: [string, unknown][] = [
      ["closes before it opens", [...good, day(3, "18:00", "09:00")]],
      ["closes when it opens", [...good, day(3, "09:00", "09:00")]],
      ["weekday 7", [...good, day(7)]],
      ["weekday -1", [...good, day(-1)]],
      [
        "weekday 1.5",
        [...good, { weekday: 1.5, open: "09:00", close: "18:00" }],
      ],
      [
        "weekday as text",
        [...good, { weekday: "3", open: "09:00", close: "18:00" }],
      ],
      ["the same weekday twice", [...good, day(3), day(3, "10:00", "11:00")]],
      ["a time that is not one", [...good, day(3, "25:00", "26:00")]],
      ["a time as words", [...good, day(3, "nine", "six")]],
      // Digits are 0 to 9 only: the function's own refusal, not a cast error.
      ["a time in full-width digits", [...good, day(3, "0\uFF19:00", "18:00")]],
      [
        "a close in Arabic-Indic digits",
        [...good, day(3, "09:00", "1\u0668:00")],
      ],
      ["no close", [...good, { weekday: 3, open: "09:00" }]],
      [
        "a setting it does not know",
        [...good, { ...day(3), tenant_id: other.id }],
      ],
      ["a row that is not an object", [...good, "monday"]],
      ["the bad row first", [day(3, "18:00", "09:00"), ...good]],
      ["eight rows", [0, 1, 2, 3, 4, 5, 6, 0].map((d) => day(d))],
      ["not a list", { weekday: 1, open: "09:00", close: "18:00" }],
      ["null", null],
    ];
    for (const [what, hours] of bad) {
      const { error } = await save(shop.members.owner, hours);
      expect(error?.message, what).toBe("invalid_hours");
      expect(await stored(), what).toEqual(asStored(week));
    }
  });

  it("a day that does not change is not rewritten: saving the same week again writes no audit row", async () => {
    expect((await save(shop.members.owner, week)).error).toBeNull();
    const audits = async () =>
      (
        await service
          .from("audit_events")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", shop.id)
          .eq("entity", "location_hours")
      ).count ?? 0;
    const before = await audits();
    expect((await save(shop.members.owner, week)).error).toBeNull();
    expect(await audits()).toBe(before);
    // One day's close changes: one row changes.
    const changed = week.map((h) =>
      h.weekday === 3 ? day(3, "09:00", "20:00") : h,
    );
    expect((await save(shop.members.owner, changed)).error).toBeNull();
    expect(await audits()).toBe(before + 1);
    expect((await save(shop.members.owner, week)).error).toBeNull();
  });

  it("only owners and managers; another shop's owner is refused and the hours stay", async () => {
    expect((await save(shop.members.owner, week)).error).toBeNull();
    for (const role of ["staff", "mechanic", "driver"] as const) {
      const { error } = await save(shop.members[role], []);
      expect(error?.message, role).toBe("only_owner_or_manager");
      expect(error?.code, role).toBe("42501");
    }
    // Another shop's owner and manager, naming this shop.
    for (const role of ["owner", "manager"] as const) {
      const { error } = await save(other.members[role], []);
      expect(error?.message, role).toBe("only_owner_or_manager");
    }
    // Naming their own shop with this shop's location: no such location.
    const crossed = await save(other.members.owner, [], other, shop.locationId);
    expect(crossed.error?.message).toBe("location_not_found");
    // And this shop's owner can't write another shop's location.
    const reverse = await save(
      shop.members.owner,
      week,
      shop,
      other.locationId,
    );
    expect(reverse.error?.message).toBe("location_not_found");
    const byService = await service.rpc("save_location_hours", {
      p_tenant_id: shop.id,
      p_location_id: shop.locationId,
      p_hours: [] as never,
    });
    expect(byService.error?.code).toBe("42501");
    expect(await stored()).toEqual(asStored(week));
    expect(await stored(other.locationId)).toEqual([]);
  });

  it("two saves of one location at once: the week is one of the two, never a mix", async () => {
    const a = [day(0), day(1), day(2)];
    const b = [day(4, "08:00", "12:00"), day(5, "08:00", "12:00")];
    for (let round = 0; round < 10; round++) {
      const [first, second] = await Promise.all([
        save(shop.members.owner, a),
        save(shop.members.manager, b),
      ]);
      expect(first.error, `round ${round}`).toBeNull();
      expect(second.error, `round ${round}`).toBeNull();
      const now = JSON.stringify(await stored());
      expect(
        [JSON.stringify(asStored(a)), JSON.stringify(asStored(b))],
        `round ${round}`,
      ).toContain(now);
    }
    expect((await save(shop.members.owner, week)).error).toBeNull();
  }, 60_000);
});

// --------------------------------------------------- platform_admin_events

describe("every change to platform_admins is recorded", () => {
  type Event = {
    id: number;
    at: string;
    actor: string | null;
    db_role: string;
    operation: string;
    user_id: string;
    old_row: Record<string, unknown> | null;
    new_row: Record<string, unknown> | null;
  };
  const eventsOf = async (userId: string): Promise<Event[]> => {
    const { data, error } = await service
      .from("platform_admin_events")
      .select("id, at, actor, db_role, operation, user_id, old_row, new_row")
      .eq("user_id", userId)
      .order("id");
    if (error) throw error;
    return data as Event[];
  };

  it("an insert, an update and a delete each write one row: who, what before and after, and when", async () => {
    const admin = await createUser("followups-admin");
    try {
      const started = Date.now();
      const added = await service
        .from("platform_admins")
        .insert({ user_id: admin.id, note: "first" });
      expect(added.error).toBeNull();
      // An update, made from a console with a signed-in user's claims: the
      // actor is that user, the role the console's.
      const updated = sql(`
        begin;
        select set_config('request.jwt.claims', '{"sub": "${shop.members.owner.id}"}', true);
        update platform.platform_admins set note = 'second' where user_id = '${admin.id}';
        commit;
      `);
      expect(updated.failed).toBe("");
      const removed = sql(
        `delete from platform.platform_admins where user_id = '${admin.id}';`,
      );
      expect(removed.failed).toBe("");

      const events = await eventsOf(admin.id);
      expect(events.map((e) => e.operation)).toEqual([
        "insert",
        "update",
        "delete",
      ]);
      const [insert, update, del] = events;
      expect(insert).toMatchObject({
        actor: null,
        db_role: "service_role",
        user_id: admin.id,
        old_row: null,
      });
      expect(insert.new_row).toMatchObject({
        user_id: admin.id,
        note: "first",
      });
      expect(update).toMatchObject({
        actor: shop.members.owner.id,
        db_role: "postgres",
      });
      expect(update.old_row).toMatchObject({
        user_id: admin.id,
        note: "first",
      });
      expect(update.new_row).toMatchObject({
        user_id: admin.id,
        note: "second",
      });
      expect(del).toMatchObject({
        actor: null,
        db_role: "postgres",
        new_row: null,
      });
      expect(del.old_row).toMatchObject({ user_id: admin.id, note: "second" });
      for (const event of events) {
        const at = Date.parse(event.at);
        expect(at).toBeGreaterThan(started - 60_000);
        expect(at).toBeLessThan(Date.now() + 60_000);
      }
    } finally {
      await deleteUser(admin);
    }
  });

  it("an admin whose account is deleted leaves a delete row, and the rows outlive the user", async () => {
    const admin = await createUser("followups-admin-gone");
    const added = await service
      .from("platform_admins")
      .insert({ user_id: admin.id });
    expect(added.error).toBeNull();
    await deleteUser(admin);
    const events = await eventsOf(admin.id);
    expect(events.map((e) => e.operation)).toEqual(["insert", "delete"]);
    expect(events[1].old_row).toMatchObject({ user_id: admin.id });
  });

  it("the service role reads the rows and nothing else; nobody signed in reads them; no one changes or removes one", async () => {
    const admin = await createUser("followups-admin-kept");
    try {
      await service.from("platform_admins").insert({ user_id: admin.id });
      const [event] = await eventsOf(admin.id);
      expect(event.operation).toBe("insert");

      // The service role: select only.
      const insert = await service.from("platform_admin_events").insert({
        db_role: "x",
        operation: "insert",
        user_id: admin.id,
      } as never);
      expect(insert.error?.code).toBe("42501");
      const update = await service
        .from("platform_admin_events")
        .update({ db_role: "changed" } as never)
        .eq("id", event.id);
      expect(update.error?.code).toBe("42501");
      const del = await service
        .from("platform_admin_events")
        .delete()
        .eq("id", event.id);
      expect(del.error?.code).toBe("42501");

      // Signed in (a shop's owner, and the admin themself): no access.
      for (const who of [shop.members.owner, admin]) {
        const read = await who.db.from("platform_admin_events").select("id");
        expect(read.error?.code).toBe("42501");
      }

      // No grant to anyone to change a row, and none to write one.
      const grants = sql(`
        select grantee || ':' || string_agg(privilege_type, ',' order by privilege_type)
        from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'platform_admin_events'
          and grantee not in ('postgres', 'supabase_admin')
        group by grantee order by grantee;
      `);
      expect(grants.out).toBe("service_role:SELECT");

      // Even the database's superuser is stopped by the table itself.
      for (const statement of [
        `update platform.platform_admin_events set db_role = 'changed' where id = ${event.id};`,
        `delete from platform.platform_admin_events where id = ${event.id};`,
        `truncate platform.platform_admin_events;`,
      ]) {
        expect(sql(statement).failed, statement).toContain(
          "platform_admin_events_are_kept",
        );
      }
      expect(await eventsOf(admin.id)).toHaveLength(1);
    } finally {
      await deleteUser(admin);
    }
  });

  it("platform_admins can't be truncated, which would empty it with nothing recorded: not by the service role, not by the database's superuser", async () => {
    const admin = await createUser("rf-admin-truncate");
    try {
      await service
        .from("platform_admins")
        .insert({ user_id: admin.id })
        .throwOnError();
      const admins = () =>
        sql(`select count(*) from platform.platform_admins;`).out;
      const before = admins();
      expect(Number(before)).toBeGreaterThan(0);
      const events = (await eventsOf(admin.id)).length;

      // The service role has no grant to try.
      const asService = sql(`
        begin;
        set local role service_role;
        truncate platform.platform_admins;
        commit;
      `);
      expect(asService.failed).toContain(
        "permission denied for table platform_admins",
      );
      // The owner of the table is stopped by the table itself.
      for (const statement of [
        `truncate platform.platform_admins;`,
        `truncate platform.platform_admins cascade;`,
      ]) {
        expect(sql(statement).failed, statement).toContain(
          "platform_admins_are_not_truncated",
        );
      }
      expect(admins()).toBe(before);
      expect(await eventsOf(admin.id)).toHaveLength(events);
      // Nobody but the owner holds the grant.
      expect(
        sql(`
          select coalesce(string_agg(grantee, ',' order by grantee), 'nobody')
          from information_schema.role_table_grants
          where table_schema = 'platform' and table_name = 'platform_admins'
            and privilege_type = 'TRUNCATE' and grantee <> 'postgres';
        `).out,
      ).toBe("nobody");
    } finally {
      await deleteUser(admin);
    }
  });
});

// ------------------------------------------- a tenant with audit rows stays

describe("a tenant can't be hard-deleted while it has audit rows", () => {
  it("every tenant has one from the start, so the service role's delete is refused and nothing goes", async () => {
    const doomed = await createTenant("followups-doomed", thailand);
    try {
      const audits = async () =>
        (
          await service
            .from("audit_events")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", doomed.id)
        ).count ?? 0;
      const before = await audits();
      expect(before).toBeGreaterThan(0);
      const members = async () =>
        (
          await service
            .from("memberships")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", doomed.id)
        ).count;

      const refused = await service
        .from("tenants")
        .delete()
        .eq("id", doomed.id)
        .select("id");
      expect(refused.error?.code).toBe("23503");
      expect(refused.error?.message).toContain("audit_events_tenant_id_fkey");
      // The superuser too: the foreign key is the rule, not a grant.
      const bySuperuser = sql(
        `delete from platform.tenants where id = '${doomed.id}';`,
      );
      expect(bySuperuser.failed).toContain("audit_events_tenant_id_fkey");

      const still = await service
        .from("tenants")
        .select("id")
        .eq("id", doomed.id);
      expect(still.data).toHaveLength(1);
      expect(await members()).toBe(5);
      expect(await audits()).toBe(before);

      const rule = sql(`
        select confdeltype from pg_constraint
        where conrelid = 'platform.audit_events'::regclass
          and conname = 'audit_events_tenant_id_fkey';
      `);
      // r = restrict.
      expect(rule.out).toBe("r");
    } finally {
      // The tests' own way out: audit rows first, as the superuser.
      await deleteTenant(doomed);
    }
    const gone = await service.from("tenants").select("id").eq("id", doomed.id);
    expect(gone.data).toEqual([]);
  }, 60_000);
});
