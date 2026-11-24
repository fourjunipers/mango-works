-- PR 57 staging push: read-only checks. Run the WHOLE file before the push and
-- again after it (psql -X -f pr57-staging-checks.sql > before.txt / after.txt),
-- then diff the two outputs. Nothing here writes: it runs in a read-only
-- transaction and ends with rollback.
--
-- Written by the independent review of PR 57; brought into the branch with
-- the review's fixes (section 3b follows the allow-list map-link rule,
-- section 6 lists the leftover TRUNCATE, REFERENCES and TRIGGER grants).
-- Section 3b was then brought in line with the trigger as merged (length in
-- code points; white space and control characters by code point, U+FEFF
-- among them) and the whole file run again the same way.
-- Tried on a fresh local database (reset to 20261119000100 plus the seed,
-- then the two migrations): the two outputs differed only as listed at the
-- bottom.
--
-- Sections 1-3 say whether the push is safe to start (PRE).
-- Sections 4-9 must differ between the two runs ONLY as listed at the bottom.
-- Section 10 (row counts) must not differ at all, apart from rows written by
-- anyone using staging between the two runs.

\pset pager off
\pset null '(null)'
begin transaction read only;

\echo
\echo ===== 1. Migrations applied (PRE: top is 20261119000100, 67 rows. POST: 20261120000200, 69 rows)
select count(*) as applied, max(version) as latest from supabase_migrations.schema_migrations;
select version, name from supabase_migrations.schema_migrations order by version desc limit 3;

\echo
\echo ===== 2. The md5 guard (PRE: every row "ok": if one is not, the migration stops and changes nothing)
\echo =====    (POST: the "after" column is what the PR description lists for the five platform functions)
with expected (fn, md5_main) as (values
  ('public.rental_price(uuid,integer)', 'ba1e06726ffc43458ed33035e832286a'),
  ('public.model_offer(uuid,timestamptz,timestamptz)', 'e8f3dafc1acab6e9a55b472bbb190aa8'),
  ('public.longest_walkin(uuid,timestamptz,integer)', '52314f48207c2b8fa90ab473c6724eb8'),
  ('public.shop_stats(uuid)', 'aedfef6c19e6e59f1ee0601f4170523c'),
  ('public.protect_last_owner()', '6ff483db2a7d884e371aa60bd9896061'),
  ('platform.save_listing(uuid,jsonb)', '1f5e5ac5fe92d0d7a4facf2ea1230cfc'),
  ('platform.save_product_pricing(uuid,jsonb)', '5e219d230c2981fd397353399bccd261'),
  ('platform.delete_price_template(uuid)', '5bd3763de4ff775e12e4b40e9ccf4477'),
  ('platform.submit_product_to_catalog(uuid,public.bike_type,integer,text,text,text,integer,public.transmission)', 'd23b15e11893b605218a02df82b6bba5'),
  ('platform_private.units_guard()', '9ecef4280ebf4c019a053d3addd14df4')
)
select e.fn, md5(p.prosrc) as md5_now,
  case when md5(p.prosrc) = e.md5_main then 'ok (main''s body)' else 'DIFFERENT from main' end as pre_check
from expected e left join pg_proc p on p.oid = to_regprocedure(e.fn)
order by 1;

\echo
\echo ===== 3. Things the migrations create or drop without "if exists" (PRE: all false except the policy, which is true)
select
  exists (select 1 from pg_policy where polrelid = 'public.shop_members'::regclass and polname = 'Owners add team members') as policy_to_drop_exists,
  to_regprocedure('public.shop_numbers_readable(uuid)') is not null as f1,
  to_regprocedure('public.model_numbers_readable(uuid)') is not null as f2,
  to_regprocedure('public.check_shop_links()') is not null as f3,
  to_regprocedure('platform_private.audit_events_keep()') is not null as f4,
  to_regprocedure('platform_private.tenant_is_fixed()') is not null as f5,
  to_regprocedure('platform_private.memberships_keep_an_owner()') is not null as f6,
  exists (select 1 from pg_trigger where not tgisinternal and tgname in (
    'shops_check_links', 'bike_models_check_photos', 'audit_events_keep_rows', 'audit_events_keep_all',
    'price_template_days_audit', 'price_rule_products_audit', 'coupon_products_audit', 'product_extras_audit',
    'locations_tenant_is_fixed', 'products_tenant_is_fixed', 'price_templates_tenant_is_fixed',
    'memberships_keep_an_owner')) as any_new_trigger_name_taken;

\echo
\echo ===== 3b. Rows the new rules would refuse the next time they are edited (PRE: ideally none. Not a blocker:
\echo =====     the migration does not check existing rows, but a later save of that column fails with 23514)
\echo =====     The map-link rule is check_shop_links() as the PR now has it: https, a host that is exactly one of
\echo =====     the eight on the list, the path under /maps (goo.gl: /maps/; maps.app.goo.gl: any), and no two dots,
\echo =====     no %2e and no backslash in the path. Also kept, each matched whole: a g.co short share link
\echo =====     (https://g.co/kgs/ and one name of letters, digits, _ and -) and a business-listing link
\echo =====     (maps.google.com, www.google.com or google.com, no path, ?cid= and 1 to 25 digits, nothing else).
\echo =====     So a link on g.co outside that form, on maps.google.com outside /maps with anything but cid alone,
\echo =====     or on a Google domain of another country is listed here.
\echo =====     Copied from the trigger in 20261120000100, not paraphrased: at most 500 characters counted in code
\echo =====     points (char_length), and no white space, control character or backslash anywhere, the characters
\echo =====     listed by code point as the trigger lists them (U+0001 to U+0020, U+007F to U+00A0, U+1680,
\echo =====     U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, the byte-order mark U+FEFF), not by
\echo =====     [[:space:]] and [[:cntrl:]], which follow the locale of the database and do not hold U+FEFF.
select 'shops.maps_url' as what, s.id::text, left(s.maps_url, 80) as value
from public.shops s
left join lateral regexp_match(s.maps_url, '^https://([^/?#]+)(/[^?#]*)') as m on true
where s.maps_url is not null and (
  char_length(s.maps_url) > 500
  or s.maps_url ~ '[\u0001- \u007f-   -     　﻿\\]'
  or not (
    s.maps_url ~ '^https://g\.co/kgs/[A-Za-z0-9_-]+$'
    or s.maps_url ~ '^https://(maps\.google\.com|www\.google\.com|google\.com)/?\?cid=[0-9]{1,25}$'
    or coalesce(m[2] !~* '\.\.|%2e' and case
         when m[1] = 'maps.app.goo.gl' then true
         when m[1] = 'goo.gl' then left(m[2], 6) = '/maps/'
         when m[1] in ('www.google.com', 'google.com', 'maps.google.com',
                       'www.google.co.th', 'google.co.th', 'maps.google.co.th')
           then m[2] = '/maps' or left(m[2], 6) = '/maps/'
         else false end, false)))
union all
select 'shops.photos', s.id::text, left(p, 80)
from public.shops s, unnest(s.photos) p
where p is null or not (
  (p ~ '^/images(/[A-Za-z0-9][A-Za-z0-9._-]*)+$' and position('..' in p) = 0)
  or (left(p, 37) = s.id::text || '/' and substr(p, 38) ~ '^[^/\\[:cntrl:]]{1,200}$' and substr(p, 38) not in ('.', '..')))
union all
select 'bike_models.photos', m.id::text, left(p, 80)
from public.bike_models m, unnest(m.photos) p
where p is null or not (
  (p ~ '^/images(/[A-Za-z0-9][A-Za-z0-9._-]*)+$' and position('..' in p) = 0)
  or (left(p, 74) = m.shop_id::text || '/' || m.id::text || '/' and substr(p, 75) ~ '^[^/\\[:cntrl:]]{1,200}$' and substr(p, 75) not in ('.', '..')));

\echo
\echo ===== 3c. Shops with no owner, or exactly one (PRE and POST the same. After the push a sole owner
\echo =====     membership row, and so their user account, can no longer be deleted)
select 'platform' as side, count(*) filter (where owners = 0) as no_owner, count(*) filter (where owners = 1) as one_owner, count(*) as shops
from (select t.id, (select count(*) from platform.memberships m where m.tenant_id = t.id and m.role = 'owner') as owners from platform.tenants t) x
union all
select 'marketplace', count(*) filter (where owners = 0), count(*) filter (where owners = 1), count(*)
from (select s.id, (select count(*) from public.shop_members m where m.shop_id = s.id and m.role = 'owner') as owners from public.shops s) x;

\echo
\echo ===== 4. Functions: owner, definer or invoker, search_path, who may execute
select p.oid::regprocedure as fn, pg_get_userbyid(p.proowner) as owner,
  case when p.prosecdef then 'definer' else 'invoker' end as security,
  coalesce(array_to_string(p.proconfig, ' | '), 'NOT PINNED') as config,
  coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ',' order by 1)
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE'), '') as execute_to,
  md5(p.prosrc) as md5
from pg_proc p
where p.oid in (
  to_regprocedure('public.rental_price(uuid,integer)'),
  to_regprocedure('public.model_offer(uuid,timestamptz,timestamptz)'),
  to_regprocedure('public.longest_walkin(uuid,timestamptz,integer)'),
  to_regprocedure('public.shop_stats(uuid)'),
  to_regprocedure('public.protect_last_owner()'),
  to_regprocedure('public.shop_numbers_readable(uuid)'),
  to_regprocedure('public.model_numbers_readable(uuid)'),
  to_regprocedure('public.check_shop_links()'),
  to_regprocedure('platform.save_listing(uuid,jsonb)'),
  to_regprocedure('platform.save_product_pricing(uuid,jsonb)'),
  to_regprocedure('platform.delete_price_template(uuid)'),
  to_regprocedure('platform.submit_product_to_catalog(uuid,public.bike_type,integer,text,text,text,integer,public.transmission)'),
  to_regprocedure('platform_private.units_guard()'),
  to_regprocedure('platform_private.audit_events_keep()'),
  to_regprocedure('platform_private.tenant_is_fixed()'),
  to_regprocedure('platform_private.memberships_keep_an_owner()'))
order by 1;

\echo
\echo ===== 4b. Every other function in public, platform, platform_private: one fingerprint (must NOT change)
select n.nspname, count(*) as functions,
  md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || p.prosecdef::text || coalesce(p.proconfig::text, '') || coalesce(p.proacl::text, ''), ';' order by p.oid::regprocedure::text)) as fingerprint
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'platform', 'platform_private')
  and p.proname not in ('rental_price', 'model_offer', 'longest_walkin', 'shop_stats', 'protect_last_owner',
    'shop_numbers_readable', 'model_numbers_readable', 'check_shop_links', 'save_listing', 'save_product_pricing',
    'delete_price_template', 'submit_product_to_catalog', 'units_guard', 'audit_events_keep', 'tenant_is_fixed',
    'memberships_keep_an_owner')
group by 1 order by 1;

\echo
\echo ===== 5. Policies: the full list for the tables the PR is about, a fingerprint for every table
select c.oid::regclass as tbl, pol.polname, pol.polcmd as cmd, pol.polpermissive as permissive,
  (select string_agg(case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end, ',') from unnest(pol.polroles) r) as roles,
  pg_get_expr(pol.polqual, pol.polrelid) as using_, pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
from pg_policy pol join pg_class c on c.oid = pol.polrelid
where c.oid in ('public.shop_members'::regclass, 'public.bookings'::regclass, 'public.shops'::regclass,
  'public.bike_models'::regclass, 'platform.audit_events'::regclass, 'platform.memberships'::regclass)
order by 1, 2;

select n.nspname, count(*) as policies,
  md5(string_agg(c.relname || pol.polname || pol.polcmd::text || pol.polroles::text || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), ';' order by c.relname, pol.polname)) as fingerprint
from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'platform') group by 1 order by 1;

select n.nspname, count(*) as tables, count(*) filter (where not c.relrowsecurity) as rls_off
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'platform') and c.relkind in ('r', 'p') group by 1 order by 1;

\echo
\echo ===== 6. Grants on the tables the PR is about
select table_schema || '.' || table_name as tbl, grantee, string_agg(privilege_type, ',' order by privilege_type) as table_privileges
from information_schema.table_privileges
where (table_schema, table_name) in (('public', 'shop_members'), ('public', 'bookings'), ('platform', 'audit_events'), ('platform', 'memberships'))
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
group by 1, 2 order by 1, 2;

\echo ----- bookings: columns each role may read (POST: 28 for anon and authenticated, neither Stripe column)
select grantee, count(*) as readable_columns,
  bool_or(column_name in ('stripe_customer_id', 'stripe_payment_method_id')) as reads_a_stripe_id
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'bookings' and privilege_type = 'SELECT'
  and grantee in ('anon', 'authenticated', 'service_role')
group by 1 order by 1;

\echo ----- TRUNCATE on platform tables, by role (POST: no rows)
select grantee, count(*) as platform_tables_it_may_truncate
from information_schema.table_privileges
where table_schema = 'platform' and privilege_type = 'TRUNCATE' and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
group by 1 order by 1;

\echo ----- TRUNCATE, REFERENCES and TRIGGER on public tables, held by anon or authenticated
\echo ----- (PRE: each role holds each of the three, locally on all 24 public tables. POST: no rows)
select grantee, privilege_type, count(*) as public_tables,
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')) as of_tables
from information_schema.table_privileges
where table_schema = 'public' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  and grantee in ('PUBLIC', 'anon', 'authenticated')
group by 1, 2 order by 1, 2;

\echo ----- The same, table by table (PRE: one row per table and role. POST: no rows)
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as leftover
from information_schema.table_privileges
where table_schema = 'public' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  and grantee in ('PUBLIC', 'anon', 'authenticated')
group by 1, 2 order by 1, 2;

\echo ----- The three for service_role on public tables (must NOT change: the PR leaves that role alone there)
select grantee, privilege_type, count(*) as public_tables
from information_schema.table_privileges
where table_schema = 'public' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  and grantee = 'service_role'
group by 1, 2 order by 1, 2;

\echo ----- Every other table grant in public and platform: one fingerprint per schema (must NOT change).
\echo ----- Left out of it, because they are listed above and do change: TRUNCATE on platform tables, the three
\echo ----- leftover privileges of anon and authenticated on public tables, and the three tables of section 6.
select table_schema, count(*) as grants,
  md5(string_agg(table_name || grantee || privilege_type, ';' order by table_name, grantee, privilege_type)) as fingerprint
from information_schema.table_privileges
where table_schema in ('public', 'platform') and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  and not (table_schema = 'platform' and privilege_type = 'TRUNCATE')
  and not (table_schema = 'public' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
           and grantee in ('anon', 'authenticated'))
  and (table_schema, table_name) not in (('public', 'shop_members'), ('public', 'bookings'), ('platform', 'audit_events'))
group by 1 order by 1;

\echo
\echo ===== 7. Triggers on the tables the PR touches
select c.oid::regclass as tbl, t.tgname, pg_get_triggerdef(t.oid) as def
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal and c.oid in (
  'public.shops'::regclass, 'public.bike_models'::regclass, 'public.shop_members'::regclass,
  'platform.audit_events'::regclass, 'platform.memberships'::regclass, 'platform.locations'::regclass,
  'platform.products'::regclass, 'platform.price_templates'::regclass, 'platform.price_template_days'::regclass,
  'platform.price_rule_products'::regclass, 'platform.coupon_products'::regclass, 'platform.product_extras'::regclass,
  'platform.units'::regclass)
order by 1, 2;

select n.nspname, count(*) as triggers from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname in ('public', 'platform') group by 1 order by 1;

\echo
\echo ===== 8. The demo data, by name (must not change)
select code, active, archived_at is not null as archived, currency,
  (select count(*) from platform.coupon_redemptions r where r.coupon_id = c.id) as redemptions
from platform.coupons c where code in ('WELCOME10', 'MOTO200') order by 1;
select state, count(*) from platform.reservations group by 1 order by 1;
select kind, count(*) from platform.unit_blocks group by 1 order by 1;
select count(*) as product_extras, count(*) filter (where offered) as offered from platform.product_extras;
select status, count(*) from public.bike_catalog group by 1 order by 1;
select count(*) as listings, count(*) filter (where enabled) as enabled from platform.product_listings;
select status, count(*) from public.shops group by 1 order by 1;

\echo
\echo ===== 9. The audit log (must not change: no row is written, changed or removed by the migrations)
select count(*) as audit_rows, max(id) as highest_id, min(at) as oldest, max(at) as newest,
  count(*) filter (where actor is null) as no_actor from platform.audit_events;
select entity, count(*) from platform.audit_events group by 1 order by 1;

\echo
\echo ===== 10. Row counts, every table in public and platform, and auth.users (must not change)
select format('select %L as tbl, count(*) from %s', c.oid::regclass, c.oid::regclass) as q
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and (n.nspname in ('public', 'platform') or c.oid = 'auth.users'::regclass)
order by c.oid::regclass::text
\gexec

rollback;

-- EXPECTED DIFFERENCES between the "before" and the "after" output, and no others:
--  1. Two more migrations; latest 20261120000200.
--  2. md5_now changes on all ten rows (pre_check then reads "DIFFERENT from main": that is right afterwards).
--  3. policy_to_drop_exists true -> false; f1..f6 and any_new_trigger_name_taken false -> true.
--  4. Six new functions appear; the ten re-created ones get a new md5. owner, security and config must be
--     the same before and after for those ten (all "definer", "search_path=\"\""). The six new ones:
--     check_shop_links, audit_events_keep, tenant_is_fixed are "invoker" (triggers); the other three "definer".
--     execute_to for the six new ones must not list PUBLIC, anon or authenticated.
--     4b fingerprints unchanged.
--  5. public.shop_members loses "Owners add team members" and nothing else. Policy count for public drops by 1,
--     platform's fingerprint is unchanged. rls_off unchanged.
--  6. shop_members: anon and authenticated lose INSERT, and REFERENCES, TRIGGER, TRUNCATE (they keep DELETE
--     and SELECT; neither holds UPDATE on the table, before or after).
--     bookings: anon and authenticated lose table-level SELECT, and REFERENCES, TRIGGER, TRUNCATE;
--     readable_columns 30 -> 28, reads_a_stripe_id true -> false.
--     audit_events: service_role keeps INSERT,SELECT only (authenticated keeps SELECT, as before).
--     memberships: service_role loses TRUNCATE and nothing else.
--     TRUNCATE on platform tables: service_role on every table before, no rows after.
--     TRUNCATE, REFERENCES, TRIGGER on public tables for anon and authenticated: six rows before (each role,
--     each privilege; locally on all 24 public tables), no rows after; the table-by-table list (locally 48
--     rows) empties with it.
--     service_role's three on public tables: unchanged.
--     The last fingerprint (every other grant) is unchanged, for both schemas.
--  7. Twelve new triggers (2 public, 10 platform); none removed or redefined.
--  8-10. No difference.
--  Sections 3b and 3c are not on this list: each reads the same before and after (they look at stored rows,
--  which the migrations do not change).
