/**
 * The platform findings of the 19 Nov 2026 security audit
 * (20261120000200_platform_security_audit.sql). Each test here failed on the
 * schema as it stood before that migration, except the ones marked "still".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/lib/roles";
import {
  createTenant,
  createUser,
  deleteTenant,
  deleteUser,
  serviceClient,
  sql,
  sqlAs,
  sqlBackground,
  type Db,
  type TestTenant,
  type TestUser,
} from "./helpers";

let shop: TestTenant;
let other: TestTenant;
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
const db = (role: Role, tenant: TestTenant = shop): Db =>
  tenant.members[role].db;

async function gear(quantity: number, name: string): Promise<string> {
  const { data, error } = await db("owner").rpc("create_general_product", {
    p_tenant_id: shop.id,
    p_type: "gear",
    p_name: `${name} ${tag}`,
    p_track_units: false,
    p_quantities: [{ location_id: shop.locationId, quantity }],
  });
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  [shop, other] = await Promise.all([
    createTenant("audit-shop"),
    createTenant("audit-other"),
  ]);
}, 120_000);

afterAll(async () => {
  await deleteTenant(shop);
  await deleteTenant(other);
}, 120_000);

describe("M5: the audit log can't be changed", () => {
  const rows = () =>
    sql(
      `select count(*) from platform.audit_events where tenant_id = '${shop.id}';`,
    ).out;

  it("the server's role reads it and adds to it, and holds nothing else; signed-in users only read", () => {
    const grants = sql(`
      select r || ' ' || coalesce(string_agg(p, ',' order by p)
        filter (where has_table_privilege(r, 'platform.audit_events', p)), 'none')
      from unnest(array['anon', 'authenticated', 'service_role']) r,
           unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p
      group by r order by r;
    `).out.split("\n");
    expect(grants).toEqual([
      "anon none",
      "authenticated select",
      "service_role insert,select",
    ]);
  });

  it("the server's role can't update or delete a row", async () => {
    const before = rows();
    expect(Number(before)).toBeGreaterThan(0);
    const updated = await service
      .from("audit_events")
      .update({ action: "edited" })
      .eq("tenant_id", shop.id);
    expect(updated.error?.code).toBe("42501");
    const deleted = await service
      .from("audit_events")
      .delete()
      .eq("tenant_id", shop.id);
    expect(deleted.error?.code).toBe("42501");
    expect(rows()).toBe(before);
    expect(
      sql(
        `select count(*) from platform.audit_events where tenant_id = '${shop.id}' and action = 'edited';`,
      ).out,
    ).toBe("0");
  });

  it("nor can the table's owner: update, delete and truncate are refused by the table itself", () => {
    const before = rows();
    for (const statement of [
      `update platform.audit_events set action = 'edited' where tenant_id = '${shop.id}';`,
      `update platform.audit_events set actor = null, after = '{}' where tenant_id = '${shop.id}';`,
      `delete from platform.audit_events where tenant_id = '${shop.id}';`,
      "truncate platform.audit_events;",
      "truncate platform.tenants cascade;",
    ])
      // Rolled back whatever happens: on a database without the rule these
      // statements would go through.
      expect(
        sql(`begin; ${statement} rollback;`).failed,
        statement,
      ).toContain("audit_events_are_kept");
    expect(rows()).toBe(before);
  });

  it("a shop with audit rows can't be deleted, so its log can't go with it", async () => {
    const before = rows();
    expect(Number(before)).toBeGreaterThan(0);
    // Two rules refuse it, and the first to see it answers: the audit log's
    // key to its shop is "on delete restrict" (20261119000100), and behind
    // it this migration's trigger refuses deleting the rows themselves
    // (shown with the key out of the way in the test above, by delete and
    // by truncate ... cascade).
    const tried = sql(
      `begin; delete from platform.tenants where id = '${shop.id}'; rollback;`,
    );
    expect(tried.failed).toMatch(
      /audit_events_tenant_id_fkey|audit_events_are_kept/,
    );
    expect(
      sql(`select count(*) from platform.tenants where id = '${shop.id}';`).out,
    ).toBe("1");
    expect(rows()).toBe(before);
    // The server's key gets the same answer.
    const { error } = await service.from("tenants").delete().eq("id", shop.id);
    expect(error?.code).toBe("23503");
    expect(rows()).toBe(before);
  });

  it("still: a user who is named in the log can be deleted, and only their name goes from the row", async () => {
    const temp: TestUser = await createUser("audit-actor");
    const added = await service
      .from("memberships")
      .insert({ tenant_id: other.id, user_id: temp.id, role: "manager" });
    expect(added.error).toBeNull();
    // Something of theirs in the log.
    const { error } = await temp.db.rpc("create_general_product", {
      p_tenant_id: other.id,
      p_type: "gear",
      p_name: `Lock ${tag}`,
      p_track_units: false,
      p_quantities: [{ location_id: other.locationId, quantity: 1 }],
    });
    expect(error).toBeNull();
    const mine = () =>
      sql(
        `select count(*) from platform.audit_events where actor = '${temp.id}';`,
      ).out;
    // The rows there are now (the account's removal adds one of its own).
    const last = sql("select max(id) from platform.audit_events;").out;
    const total = () =>
      sql(
        `select count(*) from platform.audit_events where tenant_id = '${other.id}' and id <= ${last};`,
      ).out;
    expect(Number(mine())).toBeGreaterThan(0);
    const before = total();
    await deleteUser(temp);
    expect(
      sql(`select count(*) from auth.users where id = '${temp.id}';`).out,
    ).toBe("0");
    expect(mine()).toBe("0");
    expect(total()).toBe(before);
  });

  it("no role but the owner may truncate any platform table", () => {
    expect(
      sql(`
        select c.relname || ' ' || r
        from pg_class c, unnest(array['anon', 'authenticated', 'service_role']) r
        where c.relnamespace = 'platform'::regnamespace and c.relkind = 'r'
          and has_table_privilege(r, c.oid, 'truncate')
        order by 1;
      `).out,
    ).toBe("");
    expect(
      sql(
        "begin; set local role service_role; truncate platform.stock_movements; rollback;",
      ).failed,
    ).toContain("permission denied");
  });

  it("the four link tables are audited: insert, update and delete", () => {
    const triggers = sql(`
      select c.relname || ' ' || t.tgname || ' ' || encode(t.tgargs, 'escape')
        || ' ' || (t.tgtype & 28)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgfoid = 'platform_private.audit_row'::regproc
        and c.relname in ('price_template_days', 'price_rule_products',
          'coupon_products', 'product_extras')
      order by 1;
    `).out.split("\n");
    // 28 = insert (4) + delete (8) + update (16).
    expect(triggers).toEqual([
      "coupon_products coupon_products_audit coupon_id\\000 28",
      "price_rule_products price_rule_products_audit rule_id\\000 28",
      "price_template_days price_template_days_audit template_id\\000 28",
      "product_extras product_extras_audit  28",
    ]);
  });

  it("a row written to one of them straight in the table leaves a record", async () => {
    const helmet = await gear(2, "Audited helmet");
    const added = sql(`
      insert into platform.product_extras (tenant_id, extra_product_id, extra_product_type)
      values ('${shop.id}', '${helmet}', 'gear') returning id;
    `);
    expect(added.failed).toBe("");
    const id = added.out.split("\n")[0];
    sql(`update platform.product_extras set included_quantity = 1 where id = '${id}';`);
    sql(`delete from platform.product_extras where id = '${id}';`);
    const { data } = await service
      .from("audit_events")
      .select("action")
      .eq("entity", "product_extras")
      .eq("entity_id", id)
      .order("id");
    expect(data?.map((r) => r.action)).toEqual(["insert", "update", "delete"]);
  });
});

describe("a caller who will be refused takes no lock first", () => {
  let product: string;
  let template: string;
  let outsider: TestUser;

  beforeAll(async () => {
    product = await gear(1, "Locked lamp");
    const made = sql(`
      insert into platform.price_templates (tenant_id, name, currency, kind)
      values ('${shop.id}', 'Audit list ${tag}', '${shop.currency}', 'amounts')
      returning id;
    `);
    if (made.failed) throw new Error(made.failed);
    template = made.out.split("\n")[0];
    outsider = other.members.owner;
  });

  /**
   * Holds the row's lock for three seconds in another session, and times the
   * call made meanwhile. A call that asks for the lock before it checks the
   * caller waits those three seconds; one that checks first answers at once.
   */
  async function refusedWhileLocked(
    table: "products" | "price_templates",
    id: string,
    call: () => PromiseLike<{ error: { code?: string } | null }>,
  ) {
    const holder = sqlBackground(`
      begin;
      select 1 from platform.${table} where id = '${id}' for update;
      select pg_sleep(3);
      commit;
    `);
    // Give the holder time to take the lock.
    await new Promise((done) => setTimeout(done, 700));
    const started = Date.now();
    const { error } = await call();
    const took = Date.now() - started;
    await holder;
    return { code: error?.code, took };
  }

  const cases: [string, () => PromiseLike<{ error: { code?: string } | null }>][] =
    [
      [
        "save_listing(), someone from another shop",
        () =>
          outsider.db.rpc("save_listing", {
            p_product_id: product,
            p_settings: { enabled: true },
          }),
      ],
      [
        "save_listing(), a driver of the shop",
        () =>
          db("driver").rpc("save_listing", {
            p_product_id: product,
            p_settings: { enabled: true },
          }),
      ],
      [
        "save_product_pricing(), someone from another shop",
        () =>
          outsider.db.rpc("save_product_pricing", {
            p_product_id: product,
            p_settings: { taxable: true },
          }),
      ],
      [
        "save_product_pricing(), a staff member of the shop",
        () =>
          db("staff").rpc("save_product_pricing", {
            p_product_id: product,
            p_settings: { taxable: true },
          }),
      ],
      [
        "submit_product_to_catalog(), someone from another shop",
        () =>
          outsider.db.rpc("submit_product_to_catalog", {
            p_product_id: product,
            p_type: "city_scooter",
            p_year: 2024,
          }),
      ],
      [
        "submit_product_to_catalog(), a staff member of the shop",
        () =>
          db("staff").rpc("submit_product_to_catalog", {
            p_product_id: product,
            p_type: "city_scooter",
            p_year: 2024,
          }),
      ],
    ];

  it.each(cases)("%s", async (_name, call) => {
    const answer = await refusedWhileLocked("products", product, call);
    expect(answer.code).toBe("42501");
    expect(answer.took).toBeLessThan(1500);
  });

  it.each([
    ["someone from another shop", () => outsider.db],
    ["a staff member of the shop", () => db("staff")],
  ])("delete_price_template(), %s", async (_name, client) => {
    const answer = await refusedWhileLocked("price_templates", template, () =>
      client().rpc("delete_price_template", { p_template_id: template }),
    );
    expect(answer.code).toBe("42501");
    expect(answer.took).toBeLessThan(1500);
  });

  it("still: an owner's save waits for the row and then goes through", async () => {
    const answer = await refusedWhileLocked("price_templates", template, () =>
      db("owner").rpc("delete_price_template", { p_template_id: template }),
    );
    expect(answer.code).toBeUndefined();
    expect(answer.took).toBeGreaterThan(1500);
  });
});

describe("a location and a product never change shop", () => {
  it.each(["locations", "products"])("%s.tenant_id is fixed", async (table) => {
    if (table === "products") await gear(1, "Fixed bell");
    const moved = sql(`
      update platform.${table} set tenant_id = '${other.id}'
      where id = (select id from platform.${table} where tenant_id = '${shop.id}' limit 1);
    `);
    expect(moved.failed).toContain("tenant_is_fixed");
    // The same value is not a change.
    const same = sql(
      `update platform.${table} set tenant_id = tenant_id where tenant_id = '${shop.id}';`,
    );
    expect(same.failed).toBe("");
  });
});

describe("a lost unit of rental gear: who edits its problem line by writing the table", () => {
  it("staff may (they may mark a unit lost); a mechanic may not, as in update_unit_problem(); a unit in repair is still a mechanic's to edit", async () => {
    const helmet = await gear(3, "Audit helmet");
    for (const kind of ["lost", "repair"]) {
      const { error } = await db("staff").rpc("report_gear_problem", {
        p_product_id: helmet,
        p_location_id: shop.locationId,
        p_kind: kind,
        p_quantity: 1,
      });
      expect(error).toBeNull();
    }
    const { data: units } = await service
      .from("units")
      .select("id, status, unit_blocks(kind)")
      .eq("product_id", helmet);
    const lost = units!.find((u) => u.status === "lost")!;
    const repair = units!.find(
      (u) => u.status !== "lost" && u.unit_blocks.length > 0,
    )!;
    const write = (role: Role, id: string, notes: string) =>
      db(role).from("units").update({ problem_notes: notes }).eq("id", id);

    // The function already says no to a mechanic for a lost unit.
    const viaFunction = await db("mechanic").rpc("update_unit_problem", {
      p_unit_id: lost.id,
      p_happened_on: "2026-11-01",
      p_notes: "mechanic, through the function",
    });
    expect(viaFunction.error?.code).toBe("42501");

    const mechanic = await write("mechanic", lost.id, "mechanic, direct");
    expect(mechanic.error?.code).toBe("42501");
    const dates = await db("mechanic")
      .from("units")
      .update({ problem_on: "2026-01-01" })
      .eq("id", lost.id);
    expect(dates.error?.code).toBe("42501");
    // A driver changes no unit at all (the table's own policy): no row.
    const driver = await write("driver", lost.id, "driver, direct").select(
      "id",
    );
    expect(driver.data).toEqual([]);

    expect((await write("staff", lost.id, "staff, direct")).error).toBeNull();
    expect(
      (await write("mechanic", repair.id, "mechanic, repair")).error,
    ).toBeNull();
    const { data: after } = await service
      .from("units")
      .select("id, problem_notes")
      .in("id", [lost.id, repair.id]);
    expect(Object.fromEntries(after!.map((u) => [u.id, u.problem_notes]))).toEqual(
      { [lost.id]: "staff, direct", [repair.id]: "mechanic, repair" },
    );
  });
});

describe("deleting a user account never leaves a shop without an owner", () => {
  it("the only owner's account can't be deleted; a second owner's can; nor can the membership row go by itself", async () => {
    const lonely = await createTenant("audit-lonely");
    try {
      const owner = lonely.members.owner;
      const refused = await service.auth.admin.deleteUser(owner.id);
      expect(refused.error).not.toBeNull();
      expect(
        sql(`
          select count(*) from platform.memberships
          where tenant_id = '${lonely.id}' and role = 'owner';
        `).out,
      ).toBe("1");
      const direct = await service
        .from("memberships")
        .delete()
        .eq("id", owner.membershipId);
      expect(direct.error?.message).toContain("A shop needs at least one owner");

      // With a second owner, the first can go.
      const second = await createUser("audit-second-owner");
      const added = await service
        .from("memberships")
        .insert({ tenant_id: lonely.id, user_id: second.id, role: "owner" });
      expect(added.error).toBeNull();
      const gone = await service.auth.admin.deleteUser(owner.id);
      expect(gone.error).toBeNull();
      // ...and now the second is the last.
      const last = await service.auth.admin.deleteUser(second.id);
      expect(last.error).not.toBeNull();
      lonely.members.owner = { ...second, membershipId: "" };
    } finally {
      await deleteTenant(lonely);
    }
  }, 60_000);

  it("still: a manager's account is deleted like any other", async () => {
    const temp = await createUser("audit-temp-manager");
    await service
      .from("memberships")
      .insert({ tenant_id: other.id, user_id: temp.id, role: "manager" });
    const { error } = await service.auth.admin.deleteUser(temp.id);
    expect(error).toBeNull();
  });

  it("still: remove_member() and set_member_role() answer as before for the last owner", async () => {
    const removed = await db("owner").rpc("remove_member", {
      p_membership_id: shop.members.owner.membershipId,
    });
    expect(removed.error?.message).toContain("A shop needs at least one owner");
    const moved = sqlAs(
      shop.members.owner.id,
      `select platform.remove_member('${shop.members.driver.membershipId}');`,
    );
    expect(moved.failed).toBe("");
  });
});
