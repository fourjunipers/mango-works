-- PR 77 staging push (Phase 3, stage 2a: 20261124000100_platform_orders).
-- Laid out as pr70-staging-checks.sql is. Run the WHOLE file before the push and
-- again after it, then compare the two outputs:
--
--   PGOPTIONS="-c default_transaction_read_only=on" psql -X -f pr77-staging-checks.sql            > before.txt
--   PGOPTIONS="-c default_transaction_read_only=on" psql -X -v post=1 -f pr77-staging-checks.sql  > after.txt
--
-- Everything here reads: the session is read-only (PGOPTIONS) and the one
-- transaction ends with rollback. Section 7 runs only with -v post=1: it reads
-- the tables the migration creates, which do not exist before.
--
-- No psql on the machine: it runs through the one in the Supabase Postgres image,
-- the file on standard input:
--   docker run --rm -i -e STAGING_DB_URL -e PGOPTIONS="-c default_transaction_read_only=on" \
--     --entrypoint sh <image> -c 'psql -X "$STAGING_DB_URL" -f -' < pr77-staging-checks.sql
--
-- THE MIGRATION DELETES ROWS (its section 2): every reservation, every unit block
-- that names a reservation (allocation and hold), every coupon redemption.
-- Downtime and transfer blocks with no reservation stay. Each deleted reservation
-- and redemption writes one audit event (audit_row() on delete); allocation and
-- hold blocks are not audited (unit_blocks_audit_delete skips those kinds).

\pset pager off
\pset null '(null)'
begin transaction read only;

\echo
\echo ===== 1. Migrations applied (PRE: 70 rows, latest 20261123000100. POST: 71 rows, latest 20261124000100)
select count(*) as applied, max(version) as latest,
  count(*) filter (where version = '20261124000100') as has_20261124000100
from supabase_migrations.schema_migrations;

\echo
\echo ===== 2. The md5 guard (PRE: both "ok", or the migration stops and changes nothing.
\echo =====    POST: booking_roles is re-created, so "DIFFERENT"; move_unit likewise)
with expected (fn, md5_main) as (values
  ('platform.move_unit(uuid,uuid,uuid,uuid,integer,timestamp with time zone,jsonb)', 'e443cea895955be67be169e601d9af97'),
  ('platform_private.booking_roles(text)', '51a20ff232361556194f28d3a7b0d45b')
)
select e.fn, md5(p.prosrc) as md5_now,
  case when md5(p.prosrc) = e.md5_main then 'ok (main''s body)' else 'DIFFERENT from main' end as check
from expected e left join pg_proc p on p.oid = to_regprocedure(e.fn)
order by 1;

\echo
\echo ===== 3. What the migration creates (PRE: all false. POST: all true)
select
  to_regclass('platform.customers') is not null as customers,
  to_regclass('platform.orders') is not null as orders,
  to_regclass('platform.rentals') is not null as rentals,
  to_regclass('platform.order_charges') is not null as order_charges,
  to_regclass('platform.order_lines') is not null as order_lines,
  to_regclass('platform.order_counters') is not null as order_counters,
  exists (select 1 from information_schema.columns where table_schema = 'platform'
          and table_name = 'reservations' and column_name = 'rental_id') as reservations_rental_id,
  exists (select 1 from information_schema.columns where table_schema = 'platform'
          and table_name = 'tenants' and column_name = 'time_step_minutes') as tenants_time_step,
  to_regprocedure('platform_private.staff_may(uuid,text)') is not null as staff_may,
  to_regprocedure('platform.save_customer(uuid,jsonb)') is not null as save_customer,
  to_regprocedure('platform.save_staff_permissions(uuid,jsonb)') is not null as save_staff_permissions;

\echo
\echo ===== 4. Nothing in the way (PRE: no rows in the first two; the third lists only this session)
\echo =====    The push locks reservations, unit_blocks and coupon_redemptions ACCESS EXCLUSIVE, waiting 10 s at most.
select l.pid, c.oid::regclass as tbl, l.mode, l.granted, a.usename, a.application_name, a.state,
  now() - a.xact_start as in_transaction_for
from pg_locks l
join pg_class c on c.oid = l.relation
left join pg_stat_activity a on a.pid = l.pid
where l.locktype = 'relation' and l.pid <> pg_backend_pid()
  and l.database = (select oid from pg_database where datname = current_database())
  and c.oid in ('platform.reservations'::regclass, 'platform.unit_blocks'::regclass,
    'platform.coupon_redemptions'::regclass, 'platform.tenants'::regclass, 'platform.units'::regclass)
order by 1, 2;
select l.pid, l.classid, l.objid, l.mode, l.granted, a.usename, a.application_name
from pg_locks l left join pg_stat_activity a on a.pid = l.pid
where l.locktype = 'advisory' and l.pid <> pg_backend_pid()
order by 1, 2, 3;
select a.pid, a.usename, a.application_name, a.state, now() - a.xact_start as in_transaction_for,
  a.pid = pg_backend_pid() as me
from pg_stat_activity a
where a.datname = current_database() and a.backend_type = 'client backend'
  and (a.state <> 'idle' or a.xact_start is not null)
order by a.xact_start nulls last;

\echo
\echo ===== 5. Bookings, per shop (POST: every reservation, allocation, hold and redemption count 0;
\echo =====    downtime and transfer exactly as before)
\echo ----- Reservations by state
select t.slug, r.state, count(*) as reservations
from platform.reservations r join platform.tenants t on t.id = r.tenant_id
group by 1, 2 order by 1, 2;
select count(*) as reservations_total from platform.reservations;
\echo ----- Unit blocks by kind, and whether they name a reservation
select t.slug, b.kind, b.reservation_id is not null as names_a_reservation, count(*) as blocks
from platform.unit_blocks b join platform.tenants t on t.id = b.tenant_id
group by 1, 2, 3 order by 1, 2, 3;
select kind, count(*) as blocks from platform.unit_blocks group by 1 order by 1;
\echo ----- Coupon redemptions (given back or not)
select t.slug, count(*) as redemptions, count(*) filter (where r.released_at is not null) as given_back
from platform.coupon_redemptions r join platform.tenants t on t.id = r.tenant_id
group by 1 order by 1;
select count(*) as redemptions_total from platform.coupon_redemptions;
\echo ----- Audit events the clearing will write (PRE): one per reservation, one per redemption,
\echo -----   one per block that names a reservation and is not an allocation or a hold (expected 0)
select
  (select count(*) from platform.reservations) as reservation_events,
  (select count(*) from platform.coupon_redemptions) as redemption_events,
  (select count(*) from platform.unit_blocks where reservation_id is not null
     and kind not in ('allocation', 'hold')) as audited_block_events,
  (select count(*) from platform.reservations) + (select count(*) from platform.coupon_redemptions)
  + (select count(*) from platform.unit_blocks where reservation_id is not null
     and kind not in ('allocation', 'hold')) as expected_new_audit_events;

\echo
\echo ===== 6. What must NOT change (POST: every number as PRE, audit events up by exactly the number in 5)
select t.slug,
  (select count(*) from platform.memberships m where m.tenant_id = t.id) as members,
  (select count(*) from platform.locations l where l.tenant_id = t.id) as locations,
  (select count(*) from platform.products p where p.tenant_id = t.id) as products,
  (select count(*) from platform.units u where u.tenant_id = t.id) as units,
  (select count(*) from platform.product_pricing x where x.tenant_id = t.id) as product_pricing,
  (select count(*) from platform.price_templates x where x.tenant_id = t.id) as price_templates,
  (select count(*) from platform.price_rules x where x.tenant_id = t.id) as price_rules,
  (select count(*) from platform.coupons c where c.tenant_id = t.id) as coupons,
  (select count(*) from platform.audit_events e where e.tenant_id = t.id) as audit_events
from platform.tenants t order by 1;
select
  (select count(*) from platform.tenants) as tenants,
  (select count(*) from platform.memberships) as members,
  (select count(*) from platform.locations) as locations,
  (select count(*) from platform.products) as products,
  (select count(*) from platform.units) as units,
  (select count(*) from platform.product_pricing) as product_pricing,
  (select count(*) from platform.price_templates) as price_templates,
  (select count(*) from platform.price_template_days) as price_template_days,
  (select count(*) from platform.price_rules) as price_rules,
  (select count(*) from platform.coupons) as coupons,
  (select count(*) from platform.coupon_products) as coupon_products;
select count(*) as audit_events, max(id) as highest_id, max(at) as newest from platform.audit_events;
\echo ----- Audit events by entity and action, newest first (POST: the new ones are reservations and
\echo -----   coupon_redemptions "delete" only)
select entity, action, count(*) as events, max(at) as newest
from platform.audit_events group by 1, 2 order by newest desc limit 8;

-- 7. The new tables. POST only: psql -v post=1.
\if :{?post}
\echo
\echo ===== 7. The new tables (POST): RLS on all six, no grant to anon or PUBLIC, one counter per shop
select c.oid::regclass as tbl, c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
  has_table_privilege('anon', c.oid, 'select') as anon_select,
  has_table_privilege('anon', c.oid, 'insert') as anon_insert,
  has_table_privilege('anon', c.oid, 'update') as anon_update,
  has_table_privilege('anon', c.oid, 'delete') as anon_delete
from pg_class c
where c.oid in ('platform.customers'::regclass, 'platform.orders'::regclass, 'platform.rentals'::regclass,
  'platform.order_charges'::regclass, 'platform.order_lines'::regclass, 'platform.order_counters'::regclass)
order by 1;
\echo ----- Every grant on the six tables, to anyone (expected: no anon, no PUBLIC)
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.table_privileges
where table_schema = 'platform'
  and table_name in ('customers', 'orders', 'rentals', 'order_charges', 'order_lines', 'order_counters')
group by 1, 2 order by 1, 2;
\echo ----- Order counters: one per shop, each at 1 (expected: tenants = counters = matched, missing 0)
select
  (select count(*) from platform.tenants) as tenants,
  (select count(*) from platform.order_counters) as counters,
  (select count(*) from platform.tenants t join platform.order_counters o on o.tenant_id = t.id) as matched,
  (select count(*) from platform.tenants t where not exists
     (select 1 from platform.order_counters o where o.tenant_id = t.id)) as missing,
  (select count(*) from platform.order_counters where next_number <> 1) as not_at_one;
\echo ----- The new tables hold no rows yet
select
  (select count(*) from platform.customers) as customers,
  (select count(*) from platform.orders) as orders,
  (select count(*) from platform.rentals) as rentals,
  (select count(*) from platform.order_charges) as order_charges,
  (select count(*) from platform.order_lines) as order_lines;
\endif

rollback;

-- EXPECTED DIFFERENCES between before and after, and no others:
--  1. 71 rows, latest 20261124000100, has_20261124000100 0 -> 1.
--  2. Both functions re-created: "DIFFERENT from main" (move_unit e443cea8... and booking_roles 51a20ff2... before).
--  3. Every column false -> true.
--  5. Reservations 0; allocation and hold blocks 0; no block names a reservation; redemptions 0.
--     Downtime and transfer blocks per shop exactly as before.
--  6. Every count as before, except audit_events: up by expected_new_audit_events of the PRE run
--     (the per-shop audit_events column up by that shop's reservations + redemptions).
--  7. POST only: six tables, rls_enabled true, anon false everywhere, no PUBLIC or anon grant;
--     one order counter per shop, all at 1; the five other new tables empty.
