/**
 * Who is calling (docs/phase-3-plan.md §3.11, decision 43; migration
 * 20261123000100_platform_unit_lock_rules).
 *
 * platform_private.app_uid() and app_role() are the platform's own "who is
 * calling" functions: they read the request's claims, so the move to Neon
 * changes nothing in them and nothing in whatever calls them. New and
 * re-created code calls them; older code still reads auth.uid() and
 * auth.role() directly, and this file pins every such use, by name and by
 * count. THE COUNT CAN ONLY GO DOWN:
 *
 *  - a use that is not on the list fails (call app_uid() or app_role());
 *  - a line on the list that is no longer true fails too, so the list is
 *    shortened in the same PR that converts a function.
 *
 * Read: every function body, column default and policy in the `platform`
 * and `platform_private` schemas. app_uid() and app_role() are not on the
 * list: they do not call auth.* at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, deleteTenant, sql, type TestTenant } from "./helpers";

/** `kind name: auth.uid() uses, auth.role() uses`. */
const PINNED = [
  // Functions (19)
  "function platform.availability(p_tenant_id uuid, p_items jsonb): uid 0, role 1",
  "function platform.booking_inputs(p_tenant_id uuid, p_location_id uuid, p_product_ids uuid[]): uid 0, role 1",
  "function platform.cancel_reservation(p_tenant_id uuid, p_booking_id uuid, p_reservation_id uuid): uid 0, role 1",
  "function platform.confirm_hold(p_tenant_id uuid, p_booking_id uuid): uid 0, role 1",
  "function platform.reserve(p_tenant_id uuid, p_request jsonb): uid 0, role 1",
  "function platform_private.assert_can_change(p_membership platform.memberships, p_new_role platform.platform_role): uid 1, role 0",
  "function platform_private.audit(p_tenant_id uuid, p_entity text, p_entity_id text, p_action text, p_before jsonb, p_after jsonb): uid 1, role 2",
  "function platform_private.audit_row(): uid 1, role 0",
  "function platform_private.check_timezone(): uid 1, role 0",
  "function platform_private.has_role(p_tenant_id uuid, p_roles platform.platform_role[]): uid 1, role 0",
  "function platform_private.is_member(p_tenant_id uuid): uid 1, role 0",
  "function platform_private.is_platform_admin(): uid 1, role 0",
  "function platform_private.my_role(p_tenant_id uuid): uid 1, role 0",
  "function platform_private.my_tenant_ids(p_roles platform.platform_role[]): uid 1, role 0",
  "function platform_private.platform_admins_audit(): uid 1, role 0",
  "function platform_private.product_listings_switch_event(): uid 1, role 0",
  "function platform_private.stock_movements_guard(): uid 1, role 0",
  "function platform_private.unit_blocks_guard(): uid 1, role 0",
  "function platform_private.unit_renewals_set_recorded_by(): uid 2, role 0",
  // Column defaults (4)
  "default platform.reservations.created_by: uid 1, role 0",
  "default platform.stock_movements.created_by: uid 1, role 0",
  "default platform.unit_blocks.created_by: uid 1, role 0",
  "default platform.unit_renewals.recorded_by: uid 1, role 0",
  // Policies (1)
  'policy platform.platform_admins "Admins read their own row": uid 1, role 0',
].sort();

const UID = String.raw`auth\.uid\s*\(`;
const ROLE = String.raw`auth\.role\s*\(`;
const uses = (text: string) =>
  `'uid ' || (select count(*) from regexp_matches(${text}, '${UID}', 'g')) || ', role ' || (select count(*) from regexp_matches(${text}, '${ROLE}', 'g'))`;

function found(): string[] {
  const { out, failed } = sql(`
    select 'function ' || n.nspname || '.' || p.proname || '(' ||
        pg_get_function_identity_arguments(p.oid) || '): ' ||
        ${uses("pg_get_functiondef(p.oid)")}
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('platform', 'platform_private')
      and p.prokind in ('f', 'p')
      and pg_get_functiondef(p.oid) ~ 'auth\\.(uid|role)\\s*\\('
    union all
    select 'default ' || c.relnamespace::regnamespace || '.' || c.relname || '.' ||
        a.attname || ': ' || ${uses("pg_get_expr(d.adbin, d.adrelid)")}
    from pg_attrdef d
    join pg_class c on c.oid = d.adrelid
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where c.relnamespace in ('platform'::regnamespace, 'platform_private'::regnamespace)
      and pg_get_expr(d.adbin, d.adrelid) ~ 'auth\\.(uid|role)\\s*\\('
    union all
    select 'policy ' || schemaname || '.' || tablename || ' "' || policyname || '": ' ||
        ${uses("coalesce(qual, '') || ' ' || coalesce(with_check, '')")}
    from pg_policies
    where schemaname in ('platform', 'platform_private')
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'auth\\.(uid|role)\\s*\\(';
  `);
  expect(failed).toBe("");
  return out.split("\n").filter(Boolean).sort();
}

describe("direct auth.uid() and auth.role() uses are pinned; the count only goes down", () => {
  it("no use outside the pinned list (new code calls platform_private.app_uid() or app_role())", () => {
    const pinned = new Set(PINNED);
    expect(found().filter((line) => !pinned.has(line))).toEqual([]);
  });

  it("no stale line on the pinned list (a converted function is taken off it in the same PR)", () => {
    const now = new Set(found());
    expect(PINNED.filter((line) => !now.has(line))).toEqual([]);
  });

  it("the list is 24 lines: 19 functions, 4 column defaults, 1 policy", () => {
    expect(PINNED).toHaveLength(24);
    expect(new Set(PINNED).size).toBe(24);
    const count = (kind: string) =>
      PINNED.filter((line) => line.startsWith(`${kind} `)).length;
    expect([count("function"), count("default"), count("policy")]).toEqual([
      19, 4, 1,
    ]);
  });

  it("what stage 1 re-created reads the caller through app_uid() and app_role(), and auth.* nowhere", () => {
    for (const [name, helper] of [
      ["platform_private.units_guard", "platform_private.app_uid()"],
      ["platform.move_unit", "platform_private.app_role()"],
      ["platform_private.clamp_product_counts", "platform_private.app_uid()"],
    ] as const) {
      const body = sql(`select pg_get_functiondef('${name}'::regproc);`).out;
      expect(body, name).toContain(helper);
      expect(body, name).not.toMatch(/auth\./);
    }
    for (const name of [
      "platform_private.app_uid",
      "platform_private.app_role",
      "platform_private.units_counts_after_update",
      "platform_private.units_counts_after_delete",
      "platform_private.lock_units",
      "platform_private.holds_unit_lock",
      "platform.review_catalog_request",
    ])
      expect(
        sql(`select pg_get_functiondef('${name}'::regproc);`).out,
        name,
      ).not.toMatch(/auth\./);
  });
});

describe("stage 2a (20261124000100_platform_orders): nothing new reads auth.*, and nothing points at auth.users", () => {
  it("what it created or re-created reads the caller through app_uid() and app_role()", () => {
    for (const [name, helper] of [
      ["platform.move_unit", "platform_private.app_role()"],
      ["platform_private.customers_audit", "platform_private.app_uid()"],
      ["platform_private.staff_may", "platform_private.app_uid()"],
    ] as const) {
      const body = sql(`select pg_get_functiondef('${name}'::regproc);`).out;
      expect(body, name).toContain(helper);
      expect(body, name).not.toMatch(/auth\./);
    }
    for (const name of [
      "platform.save_customer",
      "platform.save_staff_permissions",
      "platform_private.tenants_add_order_counter",
      "platform_private.booking_roles",
    ])
      expect(
        sql(`select pg_get_functiondef('${name}'::regproc);`).out,
        name,
      ).not.toMatch(/auth\./);
  });

  it("the two created_by defaults are app_uid(); no column of the six tables has a key to auth.users", () => {
    const defaults = sql(`
      select c.relname || '.' || a.attname || ' ' || pg_get_expr(d.adbin, d.adrelid)
      from pg_attrdef d
      join pg_class c on c.oid = d.adrelid
      join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where c.oid in ('platform.customers'::regclass, 'platform.orders'::regclass)
        and a.attname = 'created_by'
      order by 1;
    `);
    expect(defaults.failed).toBe("");
    expect(defaults.out.split("\n")).toEqual([
      "customers.created_by platform_private.app_uid()",
      "orders.created_by platform_private.app_uid()",
    ]);
    const keys = sql(`
      select count(*)
      from pg_constraint k
      join pg_class f on f.oid = k.confrelid
      where k.contype = 'f'
        and f.relnamespace = 'auth'::regnamespace
        and k.conrelid in (
          'platform.customers'::regclass, 'platform.orders'::regclass,
          'platform.rentals'::regclass, 'platform.order_charges'::regclass,
          'platform.order_lines'::regclass, 'platform.order_counters'::regclass);
    `);
    expect(keys.failed).toBe("");
    expect(keys.out).toBe("0");
  });
});

describe("app_uid() and app_role()", () => {
  let shop: TestTenant;
  beforeAll(async () => {
    shop = await createTenant("callers");
  }, 60_000);
  afterAll(async () => {
    await deleteTenant(shop);
  });

  /** What the four functions answer under `claims`, as `role` (or the owner). */
  const read = (claims: string | null, role?: string) => {
    const { out, failed } = sql(
      [
        "begin;",
        claims === null
          ? ""
          : `select set_config('request.jwt.claims', '${claims}', true);`,
        role ? `set local role ${role};` : "",
        `select coalesce(platform_private.app_uid()::text, 'null') || ' | ' ||
           coalesce((select auth.uid())::text, 'null') || ' | ' ||
           coalesce(platform_private.app_role(), 'null') || ' | ' ||
           coalesce((select auth.role()), 'null');`,
        "commit;",
      ].join("\n"),
    );
    expect(failed).toBe("");
    const [appUid, authUid, appRole, authRole] = out
      .split("\n")
      .find((line) => line.includes(" | "))!
      .split(" | ");
    return { appUid, authUid, appRole, authRole };
  };

  it("answer what auth.uid() and auth.role() answer for anon, a signed-in owner and staff, the service role and no request", () => {
    const owner = shop.members.owner.id;
    const staff = shop.members.staff.id;
    const cases: [string, string | null, string | undefined, string, string][] =
      [
        // anon may not execute them: read as the database's owner, with
        // anon's claims.
        ["anon", '{"role":"anon"}', undefined, "null", "anon"],
        [
          "owner",
          JSON.stringify({ sub: owner, role: "authenticated" }),
          "authenticated",
          owner,
          "authenticated",
        ],
        [
          "staff",
          JSON.stringify({ sub: staff, role: "authenticated" }),
          "authenticated",
          staff,
          "authenticated",
        ],
        [
          "service role",
          '{"role":"service_role"}',
          "service_role",
          "null",
          "service_role",
        ],
        // pg_cron, a migration, a console: nobody, and no role guessed.
        ["no request", null, undefined, "null", "null"],
        ["empty claims", "", undefined, "null", "null"],
      ];
    for (const [what, claims, role, uid, roleName] of cases) {
      const got = read(claims, role);
      expect(got.appUid, what).toBe(uid);
      expect(got.appRole, what).toBe(roleName);
      expect(got.appUid, what).toBe(got.authUid);
      expect(got.appRole, what).toBe(got.authRole);
    }
  });

  it("read the claims only: the older request.jwt.claim.sub and .role settings, which nothing sets, are not read", () => {
    // auth.uid() and auth.role() on Supabase still read these first. The
    // API (PostgREST) and the tests set request.jwt.claims only, so the two
    // pairs agree for every real caller; this is the one place they differ.
    const { out, failed } = sql(`
      begin;
      select set_config('request.jwt.claim.sub', '${shop.members.owner.id}', true);
      select set_config('request.jwt.claim.role', 'authenticated', true);
      select coalesce(platform_private.app_uid()::text, 'null') || ' ' ||
        coalesce(platform_private.app_role(), 'null');
      commit;
    `);
    expect(failed).toBe("");
    expect(out.split("\n")).toContain("null null");
  });

  it("are stable, with an empty search path, and executable by authenticated and service_role only", () => {
    for (const name of ["app_uid", "app_role"]) {
      const { out, failed } = sql(`
        select p.provolatile::text || ' ' || (select l.lanname from pg_language l where l.oid = p.prolang) || ' ' ||
          array_to_string(p.proconfig, ',') || ' ' ||
          has_function_privilege('anon', p.oid, 'execute')::text || ' ' ||
          has_function_privilege('authenticated', p.oid, 'execute')::text || ' ' ||
          has_function_privilege('service_role', p.oid, 'execute')::text || ' ' ||
          -- "public" has no entry of its own in the list of grants.
          (select count(*) from aclexplode(p.proacl) a where a.grantee = 0) || ' ' ||
          (select string_agg(a.grantee::regrole::text, ',' order by 1)
             from aclexplode(p.proacl) a
             where a.grantee <> p.proowner) || ' ' ||
          pg_get_function_result(p.oid)
        from pg_proc p
        where p.oid = 'platform_private.${name}'::regproc;
      `);
      expect(failed, name).toBe("");
      expect(out, name).toBe(
        `s sql search_path="" false true true 0 authenticated,service_role ${name === "app_uid" ? "uuid" : "text"}`,
      );
    }
    // anon is refused outright.
    const anon = sql(`
      begin;
      set local role anon;
      select platform_private.app_uid();
      commit;
    `);
    expect(anon.failed).toMatch(/permission denied/);
  });
});
