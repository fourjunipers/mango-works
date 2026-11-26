/**
 * No default grants to the Data API roles (migration 20261112000100).
 *
 * Live has "Automatically expose new tables" turned off, so a table created
 * in `public` is closed until a migration grants it. These tests keep local
 * and CI the same, and fail when a table is reachable over the API without a
 * grant written in a migration.
 *
 * Adding a table? Grant on purpose in the same migration, e.g.
 *   grant select on public.thing to anon, authenticated;
 * Adding a function? `revoke all on function ... from public, anon;` then
 * grant execute to the roles that should call it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sql } from "./helpers";

const migrationsDir = fileURLToPath(
  new URL("../../../../supabase/migrations", import.meta.url),
);

/**
 * Tables from before the switch (the first 27 migrations, 8 Nov 2026 and
 * earlier). They got their access from the old defaults, narrowed by explicit
 * revokes. This list is closed: never add to it.
 */
const legacyPublicTables = [
  "bike_catalog",
  "bike_model_downtime",
  "bike_model_policies",
  "bike_models",
  "booking_events",
  "bookings",
  "delivery_zones",
  "price_days",
  "profiles",
  "promotion_models",
  "promotions",
  "ranking_settings",
  "reviews",
  "shop_closures",
  "shop_contacts",
  "shop_extra_models",
  "shop_extras",
  "shop_hours",
  "shop_invites",
  "shop_members",
  "shop_policies",
  "shops",
  "stations",
].map((table) => `public.${table}`);

/**
 * Marketplace functions from before the switch that anyone may execute
 * (Postgres' own default; their bodies and RLS do the guarding). Closed list.
 */
const legacyPublicFunctions = [
  "bike_catalog_set_slug",
  "bike_model_shop_id",
  "booking_set_currency",
  "can_use_catalog",
  "fill_review_from_booking",
  "flag_bike_model_edit",
  "flag_model_child_edit",
  "flag_shop_edit",
  "handle_line_identity",
  "handle_new_user",
  "handle_user_email_change",
  "is_admin",
  "is_bike_model_public",
  "is_catalog_approved",
  "is_shop_closed_on",
  "is_shop_live",
  "is_shop_member",
  "is_shop_owner",
  "longest_walkin",
  "model_offer",
  "promotion_shop_id",
  "protect_last_owner",
  "reject_booking_event_change",
  "rental_days",
  "rental_price",
  "repair_conflicts",
  "search_offers",
  "set_updated_at",
  "shop_coordinates",
  "shop_extra_shop_id",
  "shop_open_at",
  "shop_stats",
  "slugify",
  "station_list",
  "try_uuid",
].map((name) => `public.${name}`);

/** psql's command tags (BEGIN, CREATE TABLE…), which aren't result rows. */
const commandTag =
  /^(BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|CREATE [A-Z ]+|DROP [A-Z ]+)$/;

function lines(statement: string): string[] {
  const { out, failed } = sql(statement);
  expect(failed).toBe("");
  return out.split("\n").filter((line) => line && !commandTag.test(line));
}

/**
 * Created in public by the first platform migrations, granted there, then
 * moved with "alter table ... set schema platform" (20261110000100). Their
 * grants are written under the old name.
 */
const movedFromPublic = ["platform.tenants", "platform.memberships"];

/** Every migration, comments removed, as one lower-case string. */
function migrationsText(): string {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(`${migrationsDir}/${file}`, "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "")
    .toLowerCase();
}

/** True when some migration grants on this table to anon or authenticated. */
export function hasExplicitGrant(migrations: string, table: string): boolean {
  const name = table.replace(".", "\\.");
  return new RegExp(
    `\\bgrant\\b[^;]*\\bon\\b[^;]*\\b${name}\\b[^;]*\\bto\\b[^;]*\\b(anon|authenticated)\\b`,
  ).test(migrations);
}

describe("default grants", () => {
  it("postgres' defaults in public and platform give the API roles nothing, except service_role in platform", () => {
    const rows = lines(`
      select n.nspname || ' ' || d.defaclobjtype::text || ' ' || pg_get_userbyid(a.grantee)
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
      cross join lateral aclexplode(d.defaclacl) a
      where pg_get_userbyid(d.defaclrole) = 'postgres'
        and n.nspname in ('public', 'platform')
        and a.grantee <> 0
        and pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role')
      group by 1 order by 1;
    `);
    expect(rows).toEqual([
      "platform S service_role",
      "platform f service_role",
      "platform r service_role",
    ]);
  });

  it("a new table or sequence is closed to anon, authenticated and (in public) service_role until it is granted", () => {
    const rows = lines(`
      begin;
      create table public.zz_grant_probe (id serial primary key);
      create table platform.zz_grant_probe (id serial primary key);
      select format('%s %s tables:%s sequences:%s', s, r,
        has_table_privilege(r, s || '.zz_grant_probe',
          'select, insert, update, delete, truncate, references, trigger'),
        has_sequence_privilege(r, s || '.zz_grant_probe_id_seq', 'usage, select, update'))
      from unnest(array['public', 'platform']) s,
           unnest(array['anon', 'authenticated', 'service_role']) r
      order by s, r;
      rollback;
    `);
    expect(rows).toEqual([
      "platform anon tables:f sequences:f",
      "platform authenticated tables:f sequences:f",
      "platform service_role tables:t sequences:t",
      "public anon tables:f sequences:f",
      "public authenticated tables:f sequences:f",
      "public service_role tables:f sequences:f",
    ]);
  });

  it("an explicit grant is what opens a new table", () => {
    const rows = lines(`
      begin;
      create table public.zz_grant_probe (id int);
      grant select on public.zz_grant_probe to anon;
      select has_table_privilege('anon', 'public.zz_grant_probe', 'select')::text
        || ' ' || has_table_privilege('anon', 'public.zz_grant_probe', 'insert')::text
        || ' ' || has_table_privilege('authenticated', 'public.zz_grant_probe', 'select')::text;
      rollback;
    `);
    expect(rows).toEqual(["true false false"]);
  });
});

describe("every table the API roles can reach was granted on purpose", () => {
  it("tables in public and platform reachable by anon or authenticated have a grant in a migration", () => {
    const reachable = lines(`
      select n.nspname || '.' || c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'platform')
        and c.relkind in ('r', 'v', 'm', 'p', 'f')
        and not exists (select 1 from pg_depend d
                        where d.objid = c.oid and d.deptype = 'e')
        and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
          or has_table_privilege('authenticated', c.oid, 'select, insert, update, delete, truncate, references, trigger')
          or has_any_column_privilege('anon', c.oid, 'select, insert, update, references')
          or has_any_column_privilege('authenticated', c.oid, 'select, insert, update, references'))
      order by 1;
    `);
    // Sanity: the query sees the tables it should.
    expect(reachable).toContain("public.shops");
    expect(reachable).toContain("platform.units");

    const migrations = migrationsText();
    const withoutGrant = reachable.filter(
      (table) =>
        !legacyPublicTables.includes(table) &&
        !hasExplicitGrant(migrations, table) &&
        !(
          movedFromPublic.includes(table) &&
          hasExplicitGrant(migrations, table.replace("platform.", "public."))
        ),
    );
    expect(
      withoutGrant,
      "Reachable by anon or authenticated with no grant in a migration. Add `grant ... on <table> to ...` to the migration that creates it.",
    ).toEqual([]);
  });

  it("the grant finder reads real statements and ignores look-alikes", () => {
    const text = `
      grant select on public.vehicle_types to anon, authenticated;
      grant select (id, name) on platform.tenants to authenticated;
      revoke select on public.hidden from anon;
      grant all on public.internal to service_role;
      create table public.later (id int); grant usage on schema x to anon;
    `;
    expect(hasExplicitGrant(text, "public.vehicle_types")).toBe(true);
    expect(hasExplicitGrant(text, "platform.tenants")).toBe(true);
    expect(hasExplicitGrant(text, "public.hidden")).toBe(false);
    expect(hasExplicitGrant(text, "public.internal")).toBe(false);
    expect(hasExplicitGrant(text, "public.later")).toBe(false);
  });

  it("no function in public or platform is open to everyone, apart from the marketplace's from before the switch", () => {
    const open = lines(`
      select distinct n.nspname || '.' || p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'platform')
        and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.deptype = 'e')
        and (p.proacl is null or exists (
          select 1 from aclexplode(p.proacl) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
      order by 1;
    `);
    expect(
      open.filter((name) => !legacyPublicFunctions.includes(name)),
      "Executable by PUBLIC (so by anon). Add `revoke all on function ... from public, anon;` and grant execute on purpose.",
    ).toEqual([]);
  });
});

/**
 * Products, stage B (20261113000300): one new table and its functions. What
 * each role may do is written here in full, so a later migration that widens
 * it fails this test.
 */
describe("products stage B: the stock ledger and the stock functions", () => {
  it("stock_movements: members read and add, nobody changes or removes, signed-out visitors get nothing", () => {
    const rows = lines(`
      select r || ' ' || coalesce(string_agg(p, ',' order by p)
        filter (where has_table_privilege(r, 'platform.stock_movements', p)), 'none')
      from unnest(array['anon', 'authenticated']) r,
           unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
      group by r order by r;
    `);
    expect(rows).toEqual(["anon none", "authenticated insert,select"]);
    expect(hasExplicitGrant(migrationsText(), "platform.stock_movements")).toBe(
      true,
    );
  });

  it("every stage B function is closed to signed-out visitors and to PUBLIC; members call the ones meant for them", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in (
          'set_stock_quantity', 'mark_units_damaged', 'mark_units_repaired',
          'mark_units_lost', 'resolve_lost_units', 'create_general_product',
          'move_product', 'reset_product_order',
          'change_listing_entry', 'disconnect_listing',
          'lock_product_stock', 'lock_units', 'stock_product', 'upcoming_bookings',
          'units_gear_fields', 'units_label_guard', 'products_tracking_guard',
          'products_sort_bottom', 'products_stock_guard', 'stock_movements_guard')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, PUBLIC
      "platform.change_listing_entry false true false",
      "platform.create_general_product false true false",
      "platform.disconnect_listing false true false",
      // mark_units_damaged, mark_units_repaired, mark_units_lost and
      // resolve_lost_units were dropped by the stock rework (below).
      "platform.move_product false true false",
      "platform.reset_product_order false true false",
      "platform.set_stock_quantity false true false",
      // Helpers the functions above call as the member.
      "platform_private.lock_product_stock false true false",
      "platform_private.lock_units false true false",
      // Trigger functions: nobody calls them.
      "platform_private.products_sort_bottom false false false",
      "platform_private.products_stock_guard false false false",
      "platform_private.products_tracking_guard false false false",
      "platform_private.stock_movements_guard false false false",
      "platform_private.stock_product false true false",
      "platform_private.units_gear_fields false false false",
      "platform_private.units_label_guard false false false",
      "platform_private.upcoming_bookings false true false",
    ]);
  });
});

/**
 * Rental gear, the stock rework (20261114000100): no new table; three
 * functions in place of stage B's four, the counts again, and three helpers.
 */
describe("gear stock rework: the functions", () => {
  it("every one is closed to signed-out visitors and to PUBLIC; members call them", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in (
          'report_gear_problem', 'update_unit_problem', 'resolve_unit_problem',
          'product_stock', 'gear_roles', 'gear_unit_state', 'location_today',
          'mark_units_damaged', 'mark_units_repaired', 'mark_units_lost',
          'resolve_lost_units')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, PUBLIC
      "platform.product_stock false true false",
      "platform.report_gear_problem false true false",
      "platform.resolve_unit_problem false true false",
      "platform.update_unit_problem false true false",
      // Helpers the functions above call as the member.
      "platform_private.gear_roles false true false",
      "platform_private.gear_unit_state false true false",
      "platform_private.location_today false true false",
    ]);
  });
});

/**
 * Products, stage C (20261114000200): Moto Mangos listings in their own
 * table. Members read it; nobody signed in writes it directly (a listing is
 * changed through save_listing(), which locks the product's row first).
 */
describe("products stage C: product_listings and its functions", () => {
  it("product_listings: members read, nobody signed in writes, signed-out visitors get nothing; the service role is granted on purpose", () => {
    const rows = lines(`
      select r || ' ' || coalesce(string_agg(p, ',' order by p)
        filter (where has_table_privilege(r, 'platform.product_listings', p)), 'none')
      from unnest(array['anon', 'authenticated']) r,
           unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
      group by r order by r;
    `);
    expect(rows).toEqual(["anon none", "authenticated select"]);
    const migrations = migrationsText();
    expect(hasExplicitGrant(migrations, "platform.product_listings")).toBe(
      true,
    );
    expect(migrations).toMatch(
      /grant select, insert, update, delete on platform\.product_listings to service_role/,
    );
  });

  it("row level security is on, with one policy: members read their own shop's", () => {
    const rows = lines(`
      select c.relrowsecurity::text from pg_class c
      where c.oid = 'platform.product_listings'::regclass;
      select polname || ' ' || polcmd::text || ' ' || polroles::regrole[]::text
      from pg_policy where polrelid = 'platform.product_listings'::regclass order by 1;
    `);
    expect(rows).toEqual([
      "true",
      "Members read product listings r {authenticated}",
    ]);
  });

  it("every stage C function is closed to signed-out visitors and to PUBLIC; members call the ones meant for them", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in (
          'save_listing', 'listing_roles', 'listing_clear',
          'product_listings_guard', 'product_listings_switch_event',
          'review_catalog_request', 'disconnect_listing', 'products_retire_guard')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, PUBLIC
      "platform.disconnect_listing false true false",
      "platform.review_catalog_request false true false",
      "platform.save_listing false true false",
      // Helpers the functions above call as the member.
      "platform_private.listing_clear false true false",
      "platform_private.listing_roles false true false",
      // Trigger functions: nobody calls them.
      "platform_private.product_listings_guard false false false",
      "platform_private.product_listings_switch_event false false false",
      "platform_private.products_retire_guard false false false",
    ]);
  });

  it("the functions that run with their owner's rights pin their search path", () => {
    const rows = lines(`
      select p.proname || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in ('save_listing', 'listing_clear', 'product_listings_guard',
          'product_listings_switch_event')
      order by 1;
    `);
    expect(rows).toEqual([
      'listing_clear true search_path=""',
      'product_listings_guard true search_path=""',
      'product_listings_switch_event true search_path=""',
      'save_listing true search_path=""',
    ]);
  });
});

/**
 * Phase 2, stage 1 (20261116000100): reservations, the booking functions and
 * unit_blocks.created_by. Members read a reservation; nobody signed in
 * writes one directly (reserve() and cancel_reservation() did; since Phase 3
 * stage 2b, 20261125000100, create_order() and cancel_order() do, and the
 * lists below name those: the four Phase 2 functions are dropped).
 */
describe("booking core: reservations and its functions", () => {
  it("reservations: members read, nobody signed in writes, signed-out visitors get nothing; the service role is granted on purpose", () => {
    const rows = lines(`
      select r || ' ' || coalesce(string_agg(p, ',' order by p)
        filter (where has_table_privilege(r, 'platform.reservations', p)), 'none')
      from unnest(array['anon', 'authenticated']) r,
           unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
      group by r order by r;
    `);
    expect(rows).toEqual(["anon none", "authenticated select"]);
    const migrations = migrationsText();
    expect(hasExplicitGrant(migrations, "platform.reservations")).toBe(true);
    expect(migrations).toMatch(
      /grant select, insert, update, delete on platform\.reservations to service_role/,
    );
  });

  it("row level security is on, with one policy: members read their own shop's", () => {
    const rows = lines(`
      select c.relrowsecurity::text from pg_class c
      where c.oid = 'platform.reservations'::regclass;
      select polname || ' ' || polcmd::text || ' ' || polroles::regrole[]::text
      from pg_policy where polrelid = 'platform.reservations'::regclass order by 1;
    `);
    expect(rows).toEqual([
      "true",
      "Members read reservations r {authenticated}",
    ]);
  });

  it("unit_blocks: a signed-in person may change a block's unit, period and note, and no other column", () => {
    const rows = lines(`
      select has_table_privilege('authenticated', 'platform.unit_blocks', 'update')::text;
      select string_agg(a.attname, ',' order by a.attname)
      from pg_attribute a
      where a.attrelid = 'platform.unit_blocks'::regclass and a.attnum > 0
        and not a.attisdropped
        and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update');
      select has_table_privilege('authenticated', 'platform.unit_blocks', 'select, insert, delete')::text;
    `);
    expect(rows).toEqual(["false", "note,period,unit_id", "true"]);
  });

  it("every function is closed to signed-out visitors and to PUBLIC; members and the service role call the two booking functions", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || has_function_privilege('service_role', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in (
          'create_order', 'cancel_order', 'booking_roles', 'free_units',
          'lock_products_stock', 'json_time', 'unit_blocks_guard')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, service_role, PUBLIC
      // Phase 2's cancel_reservation() and reserve(), as orders.
      "platform.cancel_order false true true false",
      "platform.create_order false true true false",
      // Read by the reservations policy, and by the availability read,
      // which runs as its caller: a member, or the server (stage 2).
      "platform_private.booking_roles false true true false",
      "platform_private.free_units false true true false",
      "platform_private.json_time false true true false",
      // Called only inside the booking functions, as their owner.
      "platform_private.lock_products_stock false false false false",
      // A trigger function: nobody calls it.
      "platform_private.unit_blocks_guard false false false false",
    ]);
  });

  it("the functions that run with their owner's rights pin their search path", () => {
    const rows = lines(`
      select p.proname || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in ('create_order', 'cancel_order', 'unit_blocks_guard',
          'booking_roles', 'free_units', 'lock_products_stock', 'json_time')
      order by 1;
    `);
    expect(rows).toEqual([
      'booking_roles false search_path=""',
      'cancel_order true search_path="",lock_timeout=6s',
      'create_order true search_path="",lock_timeout=6s',
      'free_units false search_path=""',
      'json_time false search_path=""',
      'lock_products_stock false search_path=""',
      'unit_blocks_guard true search_path=""',
    ]);
  });
});

/**
 * Phase 2, stage 2 (20261116000200): holds, the shortage rule, the
 * availability read and the sweep. No new table; two columns on tenants.
 */
describe("availability: the stage 2 functions and the shop's two settings", () => {
  it("each function is granted on purpose, closed to signed-out visitors and to PUBLIC, with its search path pinned", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || has_function_privilege('service_role', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
        || ' | ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in (
          'confirm_order', 'assign_order_units', 'availability', 'release_expired_holds',
          'expire_holds', 'hold_expiry', 'shortage_demand', 'marketplace_peaks',
          'units_busy_on_delete', 'json_uuid', 'move_unit', 'units_guard')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, service_role, PUBLIC | runs as owner, config
      // Staff's alone: the server never names units. (The lock timeout on
      // this one, confirm_hold and move_unit is stage 5's.) Since Phase 3
      // stage 2b these two are assign_order_units() and confirm_order().
      'platform.assign_order_units false true false false | true search_path="",lock_timeout=6s',
      // The read runs as its caller, under RLS.
      'platform.availability false true true false | false search_path=""',
      'platform.confirm_order false true true false | true search_path="",lock_timeout=6s',
      // A booked unit's change of product or place: owners and managers
      // (checked inside), and the server.
      'platform.move_unit false true true false | true search_path="",lock_timeout=6s',
      // The sweep: the server's and the job's.
      'platform.release_expired_holds false false true false | true search_path=""',
      // Called only inside the booking functions, as their owner.
      'platform_private.expire_holds false false false false | true search_path=""',
      'platform_private.hold_expiry false false false false | false search_path=""',
      // What the read calls as its caller.
      'platform_private.json_uuid false true true false | false search_path=""',
      'platform_private.marketplace_peaks false true true false | false search_path=""',
      'platform_private.release_expired_holds false false false false | true search_path=""',
      'platform_private.shortage_demand false true true false | false search_path=""',
      // A trigger function: nobody calls it.
      'platform_private.units_busy_on_delete false false false false | false search_path=""',
      'platform_private.units_guard false false false false | true search_path=""',
    ]);
  });

  it("what the service role can execute in platform_private is exactly this list, each granted to it by name; PUBLIC can execute nothing there", () => {
    const rows = lines(`
      select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'platform_private'
        and has_function_privilege('service_role', p.oid, 'execute')
      order by 1;
    `);
    expect(rows).toEqual([
      // Who is calling (Phase 3 stage 1): the server's own calls ask too.
      "platform_private.app_role()",
      "platform_private.app_uid()",
      // The availability read, which runs as its caller.
      "platform_private.booking_roles(text)",
      // Behind coupon_inputs(), which runs as its caller (stage 8).
      "platform_private.coupon_uses(uuid,uuid,uuid)",
      "platform_private.free_units(uuid,uuid,tstzrange)",
      "platform_private.json_time(jsonb,text,text)",
      "platform_private.json_uuid(jsonb,text,text)",
      "platform_private.marketplace_peaks(uuid,tstzrange)",
      // In an index on units and products, so every writer evaluates it.
      "platform_private.norm(text)",
      // The coupon code as stored, for coupon_inputs() (stage 8).
      "platform_private.normalize_coupon_code(text)",
      // Behind platform.queue_renewal_notifications(), since Phase 1a.
      "platform_private.queue_renewal_notifications(timestamp with time zone)",
      "platform_private.shortage_demand(uuid,uuid,tstzrange)",
    ]);
    expect(
      lines(`
        select count(*)::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'platform_private'
          and coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null);
      `),
    ).toEqual(["0"]);
    // Every one of them was granted to the service role by name.
    expect(
      lines(`
        select count(*)::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'platform_private'
          and has_function_privilege('service_role', p.oid, 'execute')
          and not coalesce((select bool_or(a.grantee = 'service_role'::regrole)
            from aclexplode(p.proacl) a), false);
      `),
    ).toEqual(["0"]);
  });

  it("the server may look into platform_private for the read; signed-out visitors may not", () => {
    expect(
      lines(`
        select has_schema_privilege('service_role', 'platform_private', 'usage')::text
          || ' ' || has_schema_privilege('anon', 'platform_private', 'usage')::text;
      `),
    ).toEqual(["true false"]);
  });

  it("no signed-in person can write allow_overbooking, hold_minutes or the default buffers directly (save_booking_rules() is the way, since stage 3)", () => {
    const rows = lines(`
      select string_agg(a.attname, ',' order by a.attname)
      from pg_attribute a
      where a.attrelid = 'platform.tenants'::regclass and a.attnum > 0
        and not a.attisdropped
        and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update');
    `);
    expect(rows).toEqual([
      "country,currency,distance_unit,locale,name,renewal_digest_day,renewal_reminder_days",
    ]);
  });

  it("the block audit is three triggers with a condition each, and a unit delete has its trigger", () => {
    const rows = lines(`
      select tgname || ' ' || (pg_get_triggerdef(oid) like '%WHEN%')::text
      from pg_trigger
      where tgrelid in ('platform.units'::regclass, 'platform.unit_blocks'::regclass)
        and not tgisinternal and (tgname like 'unit_blocks_audit%' or tgname like '%busy%')
      order by 1;
    `);
    expect(rows).toEqual([
      "unit_blocks_audit_delete true",
      "unit_blocks_audit_insert true",
      "unit_blocks_audit_update true",
      "units_busy_on_delete false",
    ]);
  });
});

/**
 * Phase 2, stage 3 (20261116000300): booking rules and the Moto Mangos cap.
 * No new table; rule columns on locations, products and tenants.
 */
describe("booking rules: the stage 3 functions and columns", () => {
  it("each function is granted on purpose, closed to signed-out visitors and to PUBLIC, with its search path pinned", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || has_function_privilege('service_role', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
        || ' | ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in (
          'save_booking_rules', 'booking_inputs', 'json_int_between',
          'booking_roles', 'create_order', 'availability')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, service_role, PUBLIC | runs as owner, config
      // Re-created in stage 3, grants restated: the read runs as its caller.
      'platform.availability false true true false | false search_path=""',
      // The rules' read: every member, and the server; as its caller, under RLS.
      'platform.booking_inputs false true true false | false search_path=""',
      // reserve() was re-created in stage 3, grants restated; it is
      // create_order() since Phase 3 stage 2b, with the same grants.
      'platform.create_order false true true false | true search_path="",lock_timeout=6s',
      // Owners and managers (checked inside). Not the server's.
      'platform.save_booking_rules false true false false | true search_path=""',
      'platform_private.booking_roles false true true false | false search_path=""',
      // Called only inside save_booking_rules(), as its owner.
      'platform_private.json_int_between false false false false | false search_path=""',
    ]);
  });

  it("the new columns are readable as their tables are, and not by signed-out visitors", () => {
    const rows = lines(`
      select c.relname || '.' || a.attname || ' '
        || has_column_privilege('anon', a.attrelid, a.attnum, 'select') || ' '
        || has_column_privilege('authenticated', a.attrelid, a.attnum, 'select') || ' '
        || has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      where a.attrelid in (
          'platform.tenants'::regclass, 'platform.locations'::regclass,
          'platform.products'::regclass)
        and a.attname in (
          'min_notice_hours', 'booking_cutoff_minutes', 'min_days_advance',
          'min_days_walkin', 'buffer_before_minutes', 'buffer_after_minutes',
          'allow_overbooking', 'hold_minutes')
      order by 1;
    `);
    expect(rows).toEqual([
      // column, anon reads, a signed-in person reads, a signed-in person writes
      // A location's and a product's rows are written under their own
      // policies (owners and managers), as every other column of theirs is.
      "locations.booking_cutoff_minutes false true true",
      "locations.min_days_advance false true true",
      "locations.min_days_walkin false true true",
      "locations.min_notice_hours false true true",
      "products.buffer_after_minutes false true true",
      "products.buffer_before_minutes false true true",
      "products.min_days_advance false true true",
      "products.min_days_walkin false true true",
      // The shop's own settings: through save_booking_rules() only.
      "tenants.allow_overbooking false true false",
      "tenants.buffer_after_minutes false true false",
      "tenants.buffer_before_minutes false true false",
      "tenants.hold_minutes false true false",
    ]);
  });
});

/**
 * Phase 2, stage 5 (20261117000100): product_extras, save_product_extras(),
 * pricing_inputs() re-created, and the lock timeout on the four booking
 * functions that did not have one.
 */
describe("extras: product_extras and the stage 5 functions", () => {
  it("product_extras: members read, nobody signed in writes, signed-out visitors get nothing; the service role is granted on purpose", () => {
    const rows = lines(`
      select r || ' ' || coalesce(string_agg(p, ',' order by p)
        filter (where has_table_privilege(r, 'platform.product_extras', p)), 'none')
      from unnest(array['anon', 'authenticated']) r,
           unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
      group by r order by r;
    `);
    expect(rows).toEqual(["anon none", "authenticated select"]);
    const migrations = migrationsText();
    expect(hasExplicitGrant(migrations, "platform.product_extras")).toBe(true);
    expect(migrations).toMatch(
      /grant select, insert, update, delete on platform\.product_extras to service_role/,
    );
  });

  it("row level security is on, with one policy: members read their own shop's, through the helper and not auth.uid()", () => {
    const rows = lines(`
      select c.relrowsecurity::text from pg_class c
      where c.oid = 'platform.product_extras'::regclass;
      select polname || ' ' || polcmd::text || ' ' || polroles::regrole[]::text
        || ' ' || (pg_get_expr(polqual, polrelid) like '%my_tenant_ids%')::text
        || ' ' || (pg_get_expr(polqual, polrelid) like '%auth.uid%')::text
      from pg_policy where polrelid = 'platform.product_extras'::regclass order by 1;
    `);
    expect(rows).toEqual([
      "true",
      "Members read product extras r {authenticated} true false",
    ]);
  });

  it("each function is granted on purpose, closed to signed-out visitors and to PUBLIC, with its search path pinned; the five booking functions and save_product_extras() (stage 6) each have the 6-second lock timeout", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || has_function_privilege('service_role', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
        || ' | ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in (
          'save_product_extras', 'extras_roles', 'pricing_inputs', 'create_order',
          'confirm_order', 'cancel_order', 'assign_order_units', 'move_unit')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, service_role, PUBLIC | runs as owner, config
      // The five booking functions, four of them under their order names
      // since Phase 3 stage 2b (assign_units, cancel_reservation,
      // confirm_hold and reserve are dropped).
      // Owner, manager and staff; not the server's (as stage 2 left it).
      'platform.assign_order_units false true false false | true search_path="",lock_timeout=6s',
      'platform.cancel_order false true true false | true search_path="",lock_timeout=6s',
      'platform.confirm_order false true true false | true search_path="",lock_timeout=6s',
      'platform.create_order false true true false | true search_path="",lock_timeout=6s',
      'platform.move_unit false true true false | true search_path="",lock_timeout=6s',
      // Re-created in stage 5, grants restated: the read runs as its caller.
      'platform.pricing_inputs false true true false | false search_path=""',
      // Owners and managers (checked inside). Not the server's. Its
      // 6-second lock timeout came with stage 6 (20261117000200).
      'platform.save_product_extras false true false false | true search_path="",lock_timeout=6s',
      // Read by the product_extras policy and by save_product_extras().
      'platform_private.extras_roles false true false false | false search_path=""',
    ]);
  });
});

/**
 * Phase 2, stage 8 (20261118000100): coupons, coupon_products and
 * coupon_redemptions; save_coupon(), coupon_inputs() and their helpers; and
 * the seven functions re-created with a coupon in them.
 */
describe("coupons: the three tables and the stage 8 functions", () => {
  const tables = ["coupons", "coupon_products", "coupon_redemptions"];

  it("owners, managers and staff read (the policy decides who); nobody signed in writes; signed-out visitors get nothing; the service role is granted on purpose", () => {
    const migrations = migrationsText();
    for (const table of tables) {
      const rows = lines(`
        select r || ' ' || coalesce(string_agg(p, ',' order by p)
          filter (where has_table_privilege(r, 'platform.${table}', p)), 'none')
        from unnest(array['anon', 'authenticated']) r,
             unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
        group by r order by r;
      `);
      expect(rows, table).toEqual(["anon none", "authenticated select"]);
      expect(hasExplicitGrant(migrations, `platform.${table}`), table).toBe(
        true,
      );
      expect(migrations, table).toMatch(
        new RegExp(
          `grant select, insert, update, delete on platform\\.${table} to service_role`,
        ),
      );
    }
  });

  it("row level security is on, with one policy each: owners, managers and staff of the shop read, through pricing_roles('read') and the helper, not auth.uid()", () => {
    const rows = lines(`
      select c.relname || ' ' || c.relrowsecurity::text
      from pg_class c
      where c.oid in ('platform.coupons'::regclass, 'platform.coupon_products'::regclass,
        'platform.coupon_redemptions'::regclass)
      order by 1;
      select polrelid::regclass || ' | ' || polname || ' ' || polcmd::text || ' '
        || polroles::regrole[]::text
        || ' ' || (pg_get_expr(polqual, polrelid) like '%my_tenant_ids(platform_private.pricing_roles(''read''%')::text
        || ' ' || (pg_get_expr(polqual, polrelid) like '%auth.uid%')::text
      from pg_policy
      where polrelid in ('platform.coupons'::regclass, 'platform.coupon_products'::regclass,
        'platform.coupon_redemptions'::regclass)
      order by 1;
    `);
    expect(rows).toEqual([
      "coupon_products true",
      "coupon_redemptions true",
      "coupons true",
      "platform.coupon_products | Owners, managers and staff read coupon products r {authenticated} true false",
      "platform.coupon_redemptions | Owners, managers and staff read coupon uses r {authenticated} true false",
      "platform.coupons | Owners, managers and staff read coupons r {authenticated} true false",
    ]);
  });

  it("each function is granted on purpose, closed to signed-out visitors and to PUBLIC, with its search path pinned; save_coupon() is not the server's and has the 6-second lock timeout, as create_order() and cancel_order() (Phase 2's reserve() and cancel_reservation()) have", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || has_function_privilege('service_role', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
        || ' | ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in (
          'save_coupon', 'coupon_inputs', 'coupon_uses', 'release_coupon_use',
          'normalize_coupon_code', 'json_day', 'create_order', 'cancel_order',
          'confirm_order',
          'expire_holds', 'release_expired_holds', 'save_pricing_settings',
          'pricing_inputs', 'currency_locked', 'tenants_lock_currency')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, service_role, PUBLIC | runs as owner, config
      // The three that take the coupon's row: cancel_order(),
      // confirm_order() and create_order() since Phase 3 stage 2b; grants
      // and timeout as Phase 2's three had.
      'platform.cancel_order false true true false | true search_path="",lock_timeout=6s',
      'platform.confirm_order false true true false | true search_path="",lock_timeout=6s',
      // The read: as its caller, so RLS decides. Members and the server.
      'platform.coupon_inputs false true true false | false search_path=""',
      'platform.create_order false true true false | true search_path="",lock_timeout=6s',
      'platform.currency_locked false true true false | true search_path=""',
      'platform.pricing_inputs false true true false | false search_path=""',
      // The scheduled sweep: the server's and the database job's. No lock
      // timeout, on purpose (root CLAUDE.md).
      'platform.release_expired_holds false false true false | true search_path=""',
      // Owners and managers (checked inside). Not the server's.
      'platform.save_coupon false true false false | true search_path="",lock_timeout=6s',
      'platform.save_pricing_settings false true true false | true search_path=""',
      // Called by coupon_inputs() as its caller, and by the booking core.
      'platform_private.coupon_uses false true true false | false search_path=""',
      // Nobody's but the functions that run as their owner.
      'platform_private.expire_holds false false false false | true search_path=""',
      'platform_private.json_day false false false false | false search_path=""',
      'platform_private.normalize_coupon_code false true true false | false search_path=""',
      'platform_private.release_coupon_use false false false false | false search_path=""',
      'platform_private.release_expired_holds false false false false | true search_path=""',
      'platform_private.tenants_lock_currency false false false false | true search_path=""',
    ]);
  });
});

describe("review follow-ups: the stage 10 table and functions", () => {
  it("platform_admin_events: the service role reads and nothing else; nobody signed in has any grant; signed-out visitors get nothing", () => {
    const rows = lines(`
      select r || ' ' || coalesce(string_agg(p, ',' order by p)
        filter (where has_table_privilege(r, 'platform.platform_admin_events', p)), 'none')
      from unnest(array['anon', 'authenticated', 'service_role']) r,
           unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
      group by r order by r;
    `);
    expect(rows).toEqual([
      "anon none",
      "authenticated none",
      "service_role select",
    ]);
    const migrations = migrationsText();
    expect(migrations).toMatch(
      /grant select on platform\.platform_admin_events to service_role/,
    );
    expect(migrations).not.toMatch(
      /grant [a-z, ]*(insert|update|delete)[a-z, ]* on platform\.platform_admin_events/,
    );
  });

  it("row level security is on, with one policy that lets nobody signed in read; a change or removal is stopped by the table's own triggers", () => {
    const rows = lines(`
      select c.relname || ' ' || c.relrowsecurity::text
      from pg_class c where c.oid = 'platform.platform_admin_events'::regclass;
      select polname || ' ' || polcmd::text || ' ' || polroles::regrole[]::text
        || ' ' || pg_get_expr(polqual, polrelid)
      from pg_policy where polrelid = 'platform.platform_admin_events'::regclass;
      select t.tgname || ' ' || t.tgfoid::regproc::text
      from pg_trigger t
      where t.tgrelid in ('platform.platform_admin_events'::regclass,
        'platform.platform_admins'::regclass, 'platform.unit_renewals'::regclass)
        and not t.tgisinternal
      order by 1;
    `);
    expect(rows).toEqual([
      "platform_admin_events true",
      "No signed-in user reads admin events r {authenticated} false",
      "platform_admin_events_keep_all platform_private.platform_admin_events_keep",
      "platform_admin_events_keep_rows platform_private.platform_admin_events_keep",
      "platform_admins_audit platform_private.platform_admins_audit",
      "platform_admins_no_truncate platform_private.platform_admins_no_truncate",
      "unit_renewals_audit platform_private.audit_row",
      "unit_renewals_set_recorded_by platform_private.unit_renewals_set_recorded_by",
      "unit_renewals_set_updated_at platform_private.set_updated_at",
    ]);
  });

  it("each function is granted on purpose, closed to signed-out visitors and to PUBLIC, with its search path pinned; the two saves are members' calls, not the server's", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || has_function_privilege('service_role', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
        || ' | ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in (
          'record_renewal', 'save_location_hours', 'coupon_inputs_by_id',
          'unit_renewals_set_recorded_by', 'platform_admins_audit',
          'platform_admin_events_keep', 'platform_admins_no_truncate',
          'normalize_coupon_code',
          'tenants_lock_currency', 'currency_locked')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, service_role, PUBLIC | runs as owner, config
      // The list read: as its caller, so RLS decides. Members and the server.
      'platform.coupon_inputs_by_id false true true false | false search_path=""',
      // Re-created to count any coupon use; grants as before.
      'platform.currency_locked false true true false | true search_path=""',
      // As its caller: the tables' own policies decide. A member's call.
      'platform.record_renewal false true false false | false search_path=""',
      // As its caller; waits for the location's row, so it has the timeout.
      'platform.save_location_hours false true false false | false search_path="",lock_timeout=6s',
      // Re-created to fold full-width letters and digits; grants as before.
      'platform_private.normalize_coupon_code false true true false | false search_path=""',
      // Trigger functions: nobody calls them.
      'platform_private.platform_admin_events_keep false false false false | false search_path=""',
      'platform_private.platform_admins_audit false false false false | true search_path=""',
      'platform_private.platform_admins_no_truncate false false false false | false search_path=""',
      'platform_private.tenants_lock_currency false false false false | true search_path=""',
      'platform_private.unit_renewals_set_recorded_by false false false false | true search_path=""',
    ]);
  });

  it("the audit log's foreign key to its shop is on delete restrict", () => {
    expect(
      lines(`
        select pg_get_constraintdef(oid) from pg_constraint
        where conrelid = 'platform.audit_events'::regclass
          and conname = 'audit_events_tenant_id_fkey';
      `),
    ).toEqual([
      "FOREIGN KEY (tenant_id) REFERENCES platform.tenants(id) ON DELETE RESTRICT",
    ]);
  });
});

/**
 * Phase 3, stage 2a (20261124000100): customers, orders, rentals,
 * order_charges, order_lines and order_counters; save_customer(),
 * save_staff_permissions() and staff_may(); the shop's order settings.
 * Nobody signed in writes any of the six tables.
 */
describe("orders, stage 2a: the six tables, their functions and the shop's order settings", () => {
  const readable = [
    "customers",
    "orders",
    "rentals",
    "order_charges",
    "order_lines",
  ];

  it("members read five of them (the policy decides who) and write none; the order counter is granted to nobody signed in; signed-out visitors get nothing; the service role is granted on purpose, without truncate", () => {
    const migrations = migrationsText();
    for (const table of [...readable, "order_counters"]) {
      const rows = lines(`
        select r || ' ' || coalesce(string_agg(p, ',' order by p)
          filter (where has_table_privilege(r, 'platform.${table}', p)), 'none')
        from unnest(array['anon', 'authenticated', 'service_role']) r,
             unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
        group by r order by r;
      `);
      expect(rows, table).toEqual([
        "anon none",
        table === "order_counters"
          ? "authenticated none"
          : "authenticated select",
        "service_role delete,insert,references,select,trigger,update",
      ]);
      expect(migrations, table).toMatch(
        new RegExp(
          `grant select, insert, update, delete on platform\\.${table} to service_role`,
        ),
      );
    }
    for (const table of readable)
      expect(hasExplicitGrant(migrations, `platform.${table}`), table).toBe(
        true,
      );
    expect(hasExplicitGrant(migrations, "platform.order_counters")).toBe(false);
  });

  it("row level security is on, with one policy each, through the helpers and not auth.uid(): orders, rentals and customers by booking_roles('orders'), charges and lines by pricing_roles('read'), the counter for nobody", () => {
    const rows = lines(`
      select c.relname || ' ' || c.relrowsecurity::text
      from pg_class c
      where c.relnamespace = 'platform'::regnamespace
        and c.relname in ('customers', 'orders', 'rentals', 'order_charges',
          'order_lines', 'order_counters')
      order by 1;
      select polrelid::regclass || ' | ' || polname || ' ' || polcmd::text || ' '
        || polroles::regrole[]::text
        || ' ' || case
          when pg_get_expr(polqual, polrelid) like '%my_tenant_ids(platform_private.booking_roles(''orders''%' then 'orders'
          when pg_get_expr(polqual, polrelid) like '%my_tenant_ids(platform_private.pricing_roles(''read''%' then 'prices'
          else pg_get_expr(polqual, polrelid) end
        || ' ' || (pg_get_expr(polqual, polrelid) like '%auth.%')::text
      from pg_policy
      where polrelid in ('platform.customers'::regclass, 'platform.orders'::regclass,
        'platform.rentals'::regclass, 'platform.order_charges'::regclass,
        'platform.order_lines'::regclass, 'platform.order_counters'::regclass)
      order by 1;
    `);
    expect(rows).toEqual([
      "customers true",
      "order_charges true",
      "order_counters true",
      "order_lines true",
      "orders true",
      "rentals true",
      "platform.customers | Owners, managers and staff read customers r {authenticated} orders false",
      "platform.order_charges | Owners, managers and staff read order charges r {authenticated} prices false",
      "platform.order_counters | No signed-in user reads order counters r {authenticated} false false",
      "platform.order_lines | Owners, managers and staff read order lines r {authenticated} prices false",
      "platform.orders | Owners, managers and staff read orders r {authenticated} orders false",
      "platform.rentals | Owners, managers and staff read rentals r {authenticated} orders false",
    ]);
  });

  it("each function is granted on purpose, closed to signed-out visitors and to PUBLIC, with its search path pinned; the two saves are members' calls, not the server's, and have the 6-second lock timeout; move_unit() is as stage 1 left it", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || has_function_privilege('service_role', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
        || ' | ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('platform', 'platform_private')
        and p.proname in (
          'save_customer', 'save_staff_permissions', 'staff_may', 'customers_audit',
          'tenants_add_order_counter', 'booking_roles', 'move_unit')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, service_role, PUBLIC | runs as owner, config
      // Re-created to copy rental_id on a split; grants and timeout as before.
      'platform.move_unit false true true false | true search_path="",lock_timeout=6s',
      // Owners, managers and staff (checked inside). Not the server's.
      'platform.save_customer false true false false | true search_path="",lock_timeout=6s',
      // Owners and managers (checked inside). Not the server's.
      'platform.save_staff_permissions false true false false | true search_path="",lock_timeout=6s',
      // Re-created with the order actions; grants as before.
      'platform_private.booking_roles false true true false | false search_path=""',
      // Trigger functions: nobody calls them.
      'platform_private.customers_audit false false false false | true search_path=""',
      // Asked by the order functions as the member. Not the server's.
      'platform_private.staff_may false true false false | true search_path=""',
      'platform_private.tenants_add_order_counter false false false false | true search_path=""',
    ]);
  });

  it("each table keeps its updated_at and is audited; a customer by its own trigger, which keeps contacts out; the counter by neither", () => {
    const rows = lines(`
      select c.relname || ' ' || t.tgname || ' ' || t.tgfoid::regproc::text
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relnamespace = 'platform'::regnamespace
        and c.relname in ('customers', 'orders', 'rentals', 'order_charges',
          'order_lines', 'order_counters')
        and not t.tgisinternal
      order by 1;
      select t.tgname || ' ' || t.tgfoid::regproc::text
      from pg_trigger t
      where t.tgrelid = 'platform.tenants'::regclass and t.tgname like '%order%';
    `);
    expect(rows).toEqual([
      "customers customers_audit platform_private.customers_audit",
      "customers customers_set_updated_at platform_private.set_updated_at",
      "order_charges order_charges_audit platform_private.audit_row",
      "order_charges order_charges_set_updated_at platform_private.set_updated_at",
      "order_lines order_lines_audit platform_private.audit_row",
      "order_lines order_lines_set_updated_at platform_private.set_updated_at",
      "orders orders_audit platform_private.audit_row",
      // Stage 2b (20261125000100): no order is committed without its number.
      "orders orders_require_number platform_private.orders_require_number",
      "orders orders_set_updated_at platform_private.set_updated_at",
      "rentals rentals_audit platform_private.audit_row",
      "rentals rentals_set_updated_at platform_private.set_updated_at",
      "tenants_add_order_counter platform_private.tenants_add_order_counter",
    ]);
  });

  it("the six staff permissions and the time step are read as the shop's row is, and written by no signed-in person directly", () => {
    const rows = lines(`
      select a.attname || ' '
        || has_column_privilege('anon', a.attrelid, a.attnum, 'select') || ' '
        || has_column_privilege('authenticated', a.attrelid, a.attnum, 'select') || ' '
        || has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')
      from pg_attribute a
      where a.attrelid = 'platform.tenants'::regclass
        and (a.attname like 'staff_can_%' or a.attname = 'time_step_minutes')
      order by 1;
    `);
    expect(rows).toEqual([
      // column, anon reads, a signed-in person reads, a signed-in person writes
      "staff_can_change_price false true false",
      "staff_can_edit_return_time false true false",
      "staff_can_refund false true false",
      "staff_can_revert false true false",
      "staff_can_waive_late_charge false true false",
      "staff_can_write_off_credit false true false",
      "time_step_minutes false true false",
    ]);
  });
});

/**
 * Phase 3, stage 2b (20261125000100): the order core. No new table. Phase
 * 2's reserve(), confirm_hold(), cancel_reservation() and assign_units() are
 * dropped; the six order functions take their place, over cores and helpers
 * in platform_private that nobody signed in can call.
 */
describe("orders, stage 2b: the order functions, their cores and helpers", () => {
  it("the six order functions are members' and the server's (assign_order_units() members' alone), closed to signed-out visitors and to PUBLIC, run as their owner with the search path pinned and the 6-second lock timeout; currency_locked() is as stage 8 left it", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || has_function_privilege('service_role', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
        || ' | ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'platform'
        and p.proname in (
          'create_order', 'hold_order', 'reserve_order', 'confirm_order',
          'cancel_order', 'assign_order_units', 'currency_locked')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, service_role, PUBLIC | runs as owner, config
      // Staff's alone: the server never names units (as assign_units() was).
      'platform.assign_order_units false true false false | true search_path="",lock_timeout=6s',
      'platform.cancel_order false true true false | true search_path="",lock_timeout=6s',
      'platform.confirm_order false true true false | true search_path="",lock_timeout=6s',
      'platform.create_order false true true false | true search_path="",lock_timeout=6s',
      // Re-created to know about orders; grants as before, no lock timeout.
      'platform.currency_locked false true true false | true search_path=""',
      'platform.hold_order false true true false | true search_path="",lock_timeout=6s',
      'platform.reserve_order false true true false | true search_path="",lock_timeout=6s',
    ]);
  });

  it("the cores and helpers in platform_private are granted to nobody: not to a signed-in person, a signed-out visitor, the server or PUBLIC; the four cores have the 6-second lock timeout", () => {
    const rows = lines(`
      select n.nspname || '.' || p.proname || ' '
        || has_function_privilege('anon', p.oid, 'execute') || ' '
        || has_function_privilege('authenticated', p.oid, 'execute') || ' '
        || has_function_privilege('service_role', p.oid, 'execute') || ' '
        || coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), p.proacl is null)
        || ' | ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'platform_private'
        and p.proname in (
          'reserve_core', 'confirm_hold', 'cancel_reservation', 'assign_units',
          'settle_order_hold', 'reserve_existing', 'order_caller', 'order_answer',
          'order_code', 'store_charges', 'json_int', 'orders_require_number')
      order by 1;
    `);
    expect(rows).toEqual([
      // name, anon, authenticated, service_role, PUBLIC | runs as owner, config
      // The cores behind the order functions: Phase 2's functions of the
      // same names, moved here and taking the order's row.
      'platform_private.assign_units false false false false | true search_path="",lock_timeout=6s',
      'platform_private.cancel_reservation false false false false | true search_path="",lock_timeout=6s',
      'platform_private.confirm_hold false false false false | true search_path="",lock_timeout=6s',
      // Helpers, called only inside the order functions, as their owner.
      'platform_private.json_int false false false false | false search_path=""',
      'platform_private.order_answer false false false false | true search_path=""',
      'platform_private.order_caller false false false false | true search_path=""',
      'platform_private.order_code false false false false | false search_path=""',
      // A trigger function: nobody calls it.
      'platform_private.orders_require_number false false false false | true search_path=""',
      'platform_private.reserve_core false false false false | true search_path="",lock_timeout=6s',
      // Run inside hold_order() and reserve_order(), under their timeout.
      'platform_private.reserve_existing false false false false | true search_path=""',
      'platform_private.settle_order_hold false false false false | true search_path=""',
      'platform_private.store_charges false false false false | true search_path=""',
    ]);
  });

  it("Phase 2's four booking functions are gone from the platform schema, under any signature", () => {
    expect(
      lines(`
        select count(*) from pg_proc p
        where p.pronamespace = 'platform'::regnamespace
          and p.proname in ('reserve', 'confirm_hold', 'cancel_reservation', 'assign_units');
      `),
    ).toEqual(["0"]);
  });

  it("no order is committed without its number: the trigger is a constraint trigger, checked at commit", () => {
    expect(
      lines(`
        select t.tgname || ' ' || t.tgrelid::regclass || ' ' || t.tgfoid::regproc
          || ' ' || t.tgdeferrable || ' ' || t.tginitdeferred
        from pg_trigger t where t.tgname = 'orders_require_number';
      `),
    ).toEqual([
      "orders_require_number platform.orders platform_private.orders_require_number true true",
    ]);
  });
});
