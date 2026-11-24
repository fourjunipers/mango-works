-- PR 70 staging push (Phase 3, stage 1: 20261123000100_platform_unit_lock_rules).
-- Laid out as pr57-staging-checks.sql is. Run the WHOLE file before the push and
-- again after it, then diff the two outputs:
--
--   psql -X -f pr70-staging-checks.sql            > before.txt
--   psql -X -v smoke=1 -f pr70-staging-checks.sql > after.txt
--
-- Sections 1-10 write nothing: they run in a read-only transaction that ends
-- with rollback. Section 11 (the smoke test) runs only with -v smoke=1, AFTER
-- the push: it tries two refused updates inside a transaction of its own that
-- ends with rollback, and then reads the units again to show nothing stayed.
--
-- Sections 1-5 say whether the push is safe to start (PRE).
-- Sections 6-7 must differ between the two runs ONLY as listed at the bottom.
-- Sections 8-10 (counts, the audit log, rows) must not differ at all, apart
-- from rows written by anyone using staging between the two runs.

\pset pager off
\pset null '(null)'
begin transaction read only;

\echo
\echo ===== 1. Migrations applied (PRE: 69 rows, latest 20261120000200. POST: 70 rows, latest 20261123000100)
select count(*) as applied, max(version) as latest,
  count(*) filter (where version = '20261123000100') as has_20261123000100
from supabase_migrations.schema_migrations;
select version, name from supabase_migrations.schema_migrations order by version desc limit 3;

\echo
\echo ===== 2. The md5 guard (PRE: every row "ok": if one is not, the migration stops and changes nothing)
\echo =====    The same five functions and the same md5(prosrc) that the guard in the migration reads.
\echo =====    (POST: units_clamp_product_counts is gone, md5 "(null)"; the other four read "DIFFERENT from main",
\echo =====    which is right afterwards: their new md5 is listed in section 6)
with expected (fn, md5_main) as (values
  ('platform.move_unit(uuid,uuid,uuid,uuid,integer,timestamp with time zone,jsonb)', '978f6a1f228428dfe7c5b28dd9feda8f'),
  ('platform_private.units_guard()', 'c58ae1d2ab6f913ac4d294fec4d2a3de'),
  ('platform_private.units_clamp_product_counts()', '9bd013e273b42dfcc1d7eb537cab03ec'),
  ('platform.review_catalog_request(uuid,boolean,text,uuid,integer,integer)', 'b0ebe8f4af475c3e90dafe30774e319a'),
  ('platform_private.lock_units(uuid[])', '4578d95218eefac728e33cf8eb34adbb')
)
select e.fn, md5(p.prosrc) as md5_now,
  case when md5(p.prosrc) = e.md5_main then 'ok (main''s body)' else 'DIFFERENT from main' end as pre_check
from expected e left join pg_proc p on p.oid = to_regprocedure(e.fn)
order by 1;

\echo
\echo ===== 3. Things the migration creates without "or replace" (PRE: all eight functions and both triggers false)
\echo =====    and what it drops without "if exists" (PRE: both true). POST: the other way round.
select
  to_regprocedure('platform_private.app_uid()') is not null as app_uid,
  to_regprocedure('platform_private.app_role()') is not null as app_role,
  to_regprocedure('platform_private.unit_lock_class()') is not null as unit_lock_class,
  to_regprocedure('platform_private.unit_lock_key(uuid)') is not null as unit_lock_key,
  to_regprocedure('platform_private.holds_unit_lock(uuid)') is not null as holds_unit_lock,
  to_regprocedure('platform_private.clamp_product_counts(uuid,uuid[],text)') is not null as clamp_product_counts,
  to_regprocedure('platform_private.units_counts_after_update()') is not null as fn_after_update,
  to_regprocedure('platform_private.units_counts_after_delete()') is not null as fn_after_delete;
select
  exists (select 1 from pg_trigger where tgrelid = 'platform.units'::regclass and not tgisinternal
          and tgname = 'units_counts_after_update') as trg_after_update,
  exists (select 1 from pg_trigger where tgrelid = 'platform.units'::regclass and not tgisinternal
          and tgname = 'units_counts_after_delete') as trg_after_delete,
  exists (select 1 from pg_trigger where tgrelid = 'platform.units'::regclass and not tgisinternal
          and tgname = 'units_clamp_product_counts') as old_row_trigger_exists,
  to_regprocedure('platform_private.units_clamp_product_counts()') is not null as old_function_exists;
\echo ----- Anything else that depends on the function the migration drops (PRE: no rows, or the drop fails)
select d.classid::regclass as kind, d.objid, d.deptype
from pg_depend d
where d.refobjid = to_regprocedure('platform_private.units_clamp_product_counts()')
  and not (d.classid = 'pg_trigger'::regclass and d.objid in (
    select oid from pg_trigger where tgrelid = 'platform.units'::regclass and tgname = 'units_clamp_product_counts'));

\echo
\echo ===== 4. Units whose stored product is of another type than the unit (PRE and POST: 0. Not a blocker)
select count(*) as units_on_a_product_of_another_type
from platform.units u join platform.products p on p.id = u.product_id
where p.type <> u.product_type;

\echo
\echo ===== 5. Nothing in the way (PRE: no rows in the first two; the third lists only this session)
\echo =====    The push takes an ACCESS EXCLUSIVE lock on platform.units (drop and create trigger) and replaces
\echo =====    functions; a session holding a lock on these tables, or a unit or product advisory lock, would make it wait.
\echo ----- Locks other sessions hold or wait for on the tables the push touches
select l.pid, c.oid::regclass as tbl, l.mode, l.granted, a.usename, a.application_name, a.state,
  now() - a.xact_start as in_transaction_for
from pg_locks l
join pg_class c on c.oid = l.relation
left join pg_stat_activity a on a.pid = l.pid
where l.locktype = 'relation' and l.pid <> pg_backend_pid() and l.database = (select oid from pg_database where datname = current_database())
  and c.oid in ('platform.units'::regclass, 'platform.products'::regclass, 'platform.product_listings'::regclass,
    'platform.unit_blocks'::regclass, 'platform.reservations'::regclass, 'public.bike_catalog'::regclass)
order by 1, 2;
\echo ----- Advisory locks held by anyone (the unit locks are class 6657 = x1a01, product-and-location 6658 = x1a02)
select l.pid, l.classid, l.objid, l.objsubid, l.mode, l.granted, a.usename, a.application_name
from pg_locks l left join pg_stat_activity a on a.pid = l.pid
where l.locktype = 'advisory' and l.pid <> pg_backend_pid()
order by 1, 2, 3;
\echo ----- Sessions in a transaction or running something (this one is the row marked "me")
select a.pid, a.usename, a.application_name, a.state, a.wait_event_type,
  now() - a.xact_start as in_transaction_for, a.pid = pg_backend_pid() as me
from pg_stat_activity a
where a.datname = current_database() and a.backend_type = 'client backend'
  and (a.state <> 'idle' or a.xact_start is not null)
order by a.xact_start nulls last;

\echo
\echo ===== 6. Functions: owner, definer or invoker, volatility, settings, who may execute
\echo =====    (PRE: five rows: the four the push re-creates and the old trigger function. POST: see the bottom)
select p.oid::regprocedure as fn, pg_get_userbyid(p.proowner) as owner,
  case when p.prosecdef then 'definer' else 'invoker' end as security,
  case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end as volatility,
  coalesce(array_to_string(p.proconfig, ' | '), 'NOT PINNED') as config,
  coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ',' order by 1)
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE'), '') as execute_to,
  has_function_privilege('anon', p.oid, 'execute') as anon_may,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_may,
  has_function_privilege('service_role', p.oid, 'execute') as service_role_may,
  md5(p.prosrc) as md5
from pg_proc p
where p.oid in (
  to_regprocedure('platform.move_unit(uuid,uuid,uuid,uuid,integer,timestamp with time zone,jsonb)'),
  to_regprocedure('platform.review_catalog_request(uuid,boolean,text,uuid,integer,integer)'),
  to_regprocedure('platform_private.units_guard()'),
  to_regprocedure('platform_private.lock_units(uuid[])'),
  to_regprocedure('platform_private.units_clamp_product_counts()'),
  to_regprocedure('platform_private.app_uid()'),
  to_regprocedure('platform_private.app_role()'),
  to_regprocedure('platform_private.unit_lock_class()'),
  to_regprocedure('platform_private.unit_lock_key(uuid)'),
  to_regprocedure('platform_private.holds_unit_lock(uuid)'),
  to_regprocedure('platform_private.clamp_product_counts(uuid,uuid[],text)'),
  to_regprocedure('platform_private.units_counts_after_update()'),
  to_regprocedure('platform_private.units_counts_after_delete()'))
order by 1;

\echo
\echo ===== 6b. Every other function in public, platform, platform_private: one fingerprint (must NOT change)
select n.nspname, count(*) as functions,
  md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || p.prosecdef::text || coalesce(p.proconfig::text, '') || coalesce(p.proacl::text, ''), ';' order by p.oid::regprocedure::text)) as fingerprint
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'platform', 'platform_private')
  and p.proname not in ('move_unit', 'review_catalog_request', 'units_guard', 'lock_units',
    'units_clamp_product_counts', 'app_uid', 'app_role', 'unit_lock_class', 'unit_lock_key', 'holds_unit_lock',
    'clamp_product_counts', 'units_counts_after_update', 'units_counts_after_delete')
group by 1 order by 1;

\echo
\echo ===== 7. Triggers on platform.units, and on the tables the re-created functions serve
select c.oid::regclass as tbl, t.tgname, t.tgenabled as enabled, pg_get_triggerdef(t.oid) as def
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal and c.oid = 'platform.units'::regclass
order by 1, 2;

select n.nspname, count(*) as triggers from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname in ('public', 'platform') group by 1 order by 1;

\echo
\echo ===== 7b. Policies and table grants in public and platform: fingerprints (must NOT change: the push touches neither)
select n.nspname, count(*) as policies,
  md5(string_agg(c.relname || pol.polname || pol.polcmd::text || pol.polroles::text || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), ';' order by c.relname, pol.polname)) as fingerprint
from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'platform') group by 1 order by 1;
select table_schema, count(*) as grants,
  md5(string_agg(table_name || grantee || privilege_type, ';' order by table_name, grantee, privilege_type)) as fingerprint
from information_schema.table_privileges
where table_schema in ('public', 'platform') and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
group by 1 order by 1;

\echo
\echo ===== 8. Baseline counts (must NOT change: the migration creates no table and changes no row)
\echo ----- Tables, by schema (the PR 57 push recorded 91 tables: platform, public, auth and storage together)
select n.nspname, count(*) as tables
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in ('platform', 'platform_private', 'public', 'auth', 'storage')
group by 1 order by 1;
\echo ----- Units by status, with one fingerprint over every unit (id, product, place, status, updated time)
select status, count(*) from platform.units group by 1 order by 1;
select count(*) as units,
  md5(string_agg(id::text || product_id::text || location_id::text || status::text || updated_at::text, ';' order by id)) as fingerprint
from platform.units;
\echo ----- Products, by type and retired or not, with a fingerprint
select type, retired_at is not null as retired, count(*) from platform.products group by 1, 2 order by 1, 2;
select count(*) as products,
  md5(string_agg(id::text || coalesce(catalog_id::text, '') || coalesce(catalog_approved_at::text, '') || updated_at::text, ';' order by id)) as fingerprint
from platform.products;
\echo ----- Moto Mangos listings, by enabled, with a fingerprint
select enabled, count(*), sum(instant_units) as instant_units, sum(request_units) as request_units, sum(ready_now) as ready_now
from platform.product_listings group by 1 order by 1;
select count(*) as listings, count(*) filter (where enabled) as enabled,
  md5(string_agg(product_id::text || enabled::text || instant_units::text || request_units::text || ready_now::text, ';' order by product_id)) as fingerprint
from platform.product_listings;
\echo ----- The catalog, by status
select status, count(*) from public.bike_catalog group by 1 order by 1;
\echo ----- Reservations and blocks
select state, count(*) as reservations, sum(quantity) as units_asked from platform.reservations group by 1 order by 1;
select kind, count(*) from platform.unit_blocks group by 1 order by 1;
\echo ----- The bookings of the demo seed: by shop, reservations and the bookings they belong to
select t.slug, count(r.id) as reservations, count(distinct r.booking_id) as bookings,
  count(*) filter (where r.shortage > 0) as with_a_shortage,
  (select count(*) from platform.unit_blocks b join platform.reservations r2 on r2.id = b.reservation_id where r2.tenant_id = t.id) as blocks
from platform.tenants t left join platform.reservations r on r.tenant_id = t.id
group by t.id, t.slug order by 1;
select code, active, archived_at is not null as archived, currency,
  (select count(*) from platform.coupon_redemptions r where r.coupon_id = c.id) as redemptions
from platform.coupons c order by 1;
select count(*) as marketplace_bookings from public.bookings;

\echo
\echo ===== 9. The audit log (must NOT change: the migration writes no row, and the smoke test is rolled back)
select count(*) as audit_rows, max(id) as highest_id, max(at) as newest from platform.audit_events;

\echo
\echo ===== 10. Row counts: every table in platform, public, auth and storage, then one total over the four
\echo =====     (public and platform must NOT change. auth and storage belong to Supabase: a sign-in on staging
\echo =====     between the two runs adds session rows there. The PR 57 push recorded 4,487 rows in the 91 tables)
\pset tuples_only on
select format('select %L as tbl, count(*) from %s', c.oid::regclass, c.oid::regclass) as q
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in ('platform', 'platform_private', 'public', 'auth', 'storage')
order by c.oid::regclass::text
\gexec
\pset tuples_only off
\echo ----- The newest rows in the auth tables that grow with a sign-in (to tell a sign-in from anything else)
select (select max(created_at) from auth.sessions) as newest_session,
  (select max(created_at) from auth.refresh_tokens) as newest_refresh_token,
  (select max(created_at) from auth.audit_log_entries) as newest_auth_log,
  (select max(created_at) from auth.users) as newest_user;

select format('select %s as tables, (%s) as total_rows', count(*),
  string_agg(format('(select count(*) from %s)', c.oid::regclass), ' + ' order by c.oid::regclass::text)) as q
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in ('platform', 'platform_private', 'public', 'auth', 'storage')
\gexec

rollback;

-- 11. Smoke test. POST only: psql -v smoke=1. Nothing stays: one transaction, rolled back.
\if :{?smoke}
\echo
\echo ===== 11. Smoke test as the service role, inside begin ... rollback (POST only)
\echo =====     Each refused statement is undone to a savepoint, so the next one runs. Expected: two ERROR lines,
\echo =====     "use_move_unit" and "one_unit_status_change", and the "still" column after each one true.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
-- A vehicle and another product of its shop and type; two active units with no block at all.
select u.id as unit_a, u.product_id as product_a, p2.id as product_b
from platform.units u
join platform.products p2 on p2.tenant_id = u.tenant_id and p2.type = u.product_type
  and p2.id <> u.product_id and p2.retired_at is null
where u.status = 'active' and u.product_type = 'vehicle'
order by u.id, p2.id limit 1
\gset
select min(u.id::text) as unit_1, max(u.id::text) as unit_2, count(*) as picked
from (
  select u.id from platform.units u
  where u.status = 'active' and u.product_type = 'vehicle'
    and not exists (select 1 from platform.unit_blocks b where b.unit_id = u.id)
  order by u.id limit 2) u
\gset
select :'unit_a' <> '' as found_a_unit_and_another_product, :picked = 2 as found_two_free_units;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true) as claims;
select current_user, platform_private.app_role() as app_role, platform_private.app_uid() as app_uid;

\echo ----- 11a. A direct change of the product of a unit (expected: ERROR use_move_unit)
savepoint a;
update platform.units set product_id = :'product_b' where id = :'unit_a';
rollback to savepoint a;
select product_id = :'product_a' as still_on_its_product from platform.units where id = :'unit_a';

\echo ----- 11b. Two units to retired in one statement (expected: ERROR one_unit_status_change)
savepoint b;
update platform.units set status = 'retired' where id in (:'unit_1', :'unit_2');
rollback to savepoint b;
select count(*) filter (where status = 'active') = 2 as both_still_active
from platform.units where id in (:'unit_1', :'unit_2');

reset role;
rollback;

\echo ----- 11c. After the rollback: the same two lines as section 8 and section 9. They must read the same
\echo -----      as they do higher up in this output.
select count(*) as units,
  md5(string_agg(id::text || product_id::text || location_id::text || status::text || updated_at::text, ';' order by id)) as fingerprint
from platform.units;
select count(*) as audit_rows, max(id) as highest_id, max(at) as newest from platform.audit_events;
select status, count(*) from platform.units group by 1 order by 1;
\endif

-- EXPECTED DIFFERENCES between the "before" and the "after" output, and no others:
--  1. One more migration: 70 rows, latest 20261123000100, has_20261123000100 0 -> 1.
--  2. units_clamp_product_counts: md5_now "(null)" (dropped). The other four: a new md5, "DIFFERENT from main".
--  3. The eight functions and the two triggers false -> true; old_row_trigger_exists and old_function_exists
--     true -> false.
--  6. units_clamp_product_counts leaves. Eight functions appear. The four re-created ones keep owner, security
--     and execute_to, and get a new md5; review_catalog_request's config gains lock_timeout=6s (move_unit had it).
--       app_uid, app_role: invoker, stable, search_path="", execute to authenticated and service_role
--         (and the owner); anon_may false.
--       unit_lock_class, unit_lock_key: invoker, immutable, search_path="", execute to authenticated;
--         anon_may and service_role_may false.
--       holds_unit_lock: invoker, volatile, search_path="", execute to authenticated; anon_may false.
--       clamp_product_counts, units_counts_after_update, units_counts_after_delete: definer, search_path="",
--         execute to the owner only (as units_guard and the old trigger function read in the "before" output).
--     No row lists PUBLIC, and anon_may is false on every row.
--     6b fingerprints unchanged.
--  7. platform.units: units_clamp_product_counts leaves; units_counts_after_update and units_counts_after_delete
--     arrive (FOR EACH STATEMENT, with transition tables). The other eight are unchanged. Trigger count for
--     platform +1, public unchanged. 7b unchanged.
--  4, 5, 8, 9, 10: no difference (5 lists whoever is connected at that moment, so the pid of "me" differs).
--  11 is in the "after" output only.
--
-- Run on staging on 24 Nov 2026 (before at 13:55 UTC, push at 13:57, after at 13:59): the diff held exactly
-- the list above. No psql on the machine, so it ran through the one in the Supabase Postgres image, the file
-- on standard input: docker run --rm -i -e STAGING_DB_URL --entrypoint sh <image> -c 'psql -X "$STAGING_DB_URL" -f -'
