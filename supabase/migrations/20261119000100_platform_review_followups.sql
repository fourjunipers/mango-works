-- Phase 2, stage 10: review follow-ups (docs/phase-2-plan.md §3.8, and the
-- items PROGRESS carried from the reviews of PR 48 and PR 50).
--
-- Builds on 20261118000100_platform_coupons. No earlier migration is
-- touched.
--
--  1. The three functions re-created here are as main left them (guard).
--  2. unit_renewals.recorded_by is always the caller, set in the database.
--  3. record_renewal(): a renewal and its cost in one transaction.
--  4. save_location_hours(): a location's week replaced as one set.
--  5. platform_admin_events: every change to platform_admins is recorded.
--  6. A tenant with audit rows can't be hard-deleted.
--  7. coupon_inputs_by_id(): coupons and their uses for a list of ids.
--  8. normalize_coupon_code() folds full-width letters and digits.
--  9. The currency lock counts any coupon redemption.

-- 1. The functions are as main left them -------------------------------------------------------

do $guard$
declare
  v_expected constant jsonb := jsonb_build_object(
    'platform_private.normalize_coupon_code(text)', '0c22d99415a8af26793ad5141654c439',
    'platform_private.tenants_lock_currency()', '4325072baf78a6ffd19b702f56444ac4',
    'platform.currency_locked(uuid)', 'af9db486f48ae6f358e731dfff476c6c'
  );
  v_name text;
  v_md5 text;
begin
  for v_name in select jsonb_object_keys(v_expected) loop
    select md5(p.prosrc) into v_md5
    from pg_proc p
    where p.oid = v_name::regprocedure;
    if v_md5 is distinct from v_expected ->> v_name then
      raise exception '% is not the body main has (md5 %, expected %)',
        v_name, v_md5, v_expected ->> v_name;
    end if;
  end loop;
end;
$guard$;

-- 2. Who recorded a renewal --------------------------------------------------------------------
-- recorded_by is the signed-in caller, whatever the client sends. A caller
-- with no user (the service role, a job) is refused: a renewal is always
-- somebody's record. Afterwards the column can't be changed, except to
-- empty when that user's account is deleted (the foreign key's "set null").

create function platform_private.unit_renewals_set_recorded_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is null then
      raise exception 'recorded_by_required' using errcode = '42501';
    end if;
    new.recorded_by := (select auth.uid());
  elsif new.recorded_by is distinct from old.recorded_by then
    if new.recorded_by is null
      and not exists (select 1 from auth.users u where u.id = old.recorded_by)
    then
      return new;
    end if;
    new.recorded_by := old.recorded_by;
  end if;
  return new;
end;
$$;

revoke all on function platform_private.unit_renewals_set_recorded_by()
  from public, anon, authenticated;

create trigger unit_renewals_set_recorded_by
before insert or update on platform.unit_renewals
for each row execute function platform_private.unit_renewals_set_recorded_by();

-- 3. A renewal and its cost, together ----------------------------------------------------------
-- p_renewal: {"unit_id", "kind", "expires_at", and optionally "provider",
-- "reference_no", "starts_at", "cost"}. "cost" is a string of digits in the
-- shop's minor units; absent or null saves no cost.
--
-- Runs as its caller, so the tables' own policies decide and this function
-- adds no rule of its own: owners, managers, staff and mechanics record a
-- renewal; a cost is for owners and managers. The two checks below say the
-- same thing in words before the policies would refuse it without any.
--
-- Answers {"id"}. Raises: not_allowed, only_owner_or_manager (42501);
-- invalid_renewal (22023); unit_not_found (P0001). Either part failing
-- leaves nothing saved.

create function platform.record_renewal(p_tenant_id uuid, p_renewal jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_key text;
  v_unit_id uuid;
  v_id uuid;
  v_cost bigint;
begin
  if p_tenant_id is null or p_renewal is null or jsonb_typeof(p_renewal) <> 'object' then
    raise exception 'invalid_renewal' using errcode = '22023';
  end if;
  if not platform_private.has_role(
    p_tenant_id, '{owner,manager,staff,mechanic}'::platform.platform_role[]
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  for v_key in select jsonb_object_keys(p_renewal) loop
    if v_key not in (
      'unit_id', 'kind', 'provider', 'reference_no', 'starts_at', 'expires_at', 'cost'
    ) then
      raise exception 'invalid_renewal' using errcode = '22023';
    end if;
  end loop;
  if exists (
      select 1
      from unnest(array['unit_id', 'kind', 'provider', 'reference_no', 'starts_at',
        'expires_at', 'cost']) k
      where jsonb_typeof(p_renewal -> k) not in ('string', 'null')
    )
    or coalesce(p_renewal ->> 'unit_id', '')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (p_renewal ->> 'kind') is null
    or coalesce(p_renewal ->> 'expires_at', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or (p_renewal ->> 'starts_at') is not null
      and (p_renewal ->> 'starts_at') !~ '^\d{4}-\d{2}-\d{2}$'
    or (p_renewal ->> 'cost') is not null and (p_renewal ->> 'cost') !~ '^\d{1,18}$'
  then
    raise exception 'invalid_renewal' using errcode = '22023';
  end if;
  if (p_renewal ->> 'cost') is not null
    and not platform_private.has_role(
      p_tenant_id, '{owner,manager}'::platform.platform_role[]
    )
  then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  v_unit_id := (p_renewal ->> 'unit_id')::uuid;
  v_cost := (p_renewal ->> 'cost')::bigint;

  begin
    insert into platform.unit_renewals (
      tenant_id, unit_id, kind, provider, reference_no, starts_at, expires_at
    )
    values (
      p_tenant_id, v_unit_id, p_renewal ->> 'kind',
      nullif(p_renewal ->> 'provider', ''), nullif(p_renewal ->> 'reference_no', ''),
      (p_renewal ->> 'starts_at')::date, (p_renewal ->> 'expires_at')::date
    )
    returning id into v_id;
  exception
    when foreign_key_violation then
      raise exception 'unit_not_found' using errcode = 'P0001';
    when check_violation or datetime_field_overflow or invalid_datetime_format then
      raise exception 'invalid_renewal' using errcode = '22023';
  end;

  if v_cost is not null then
    insert into platform.unit_renewal_costs (tenant_id, renewal_id, currency, cost)
    select p_tenant_id, v_id, t.currency, v_cost
    from platform.tenants t
    where t.id = p_tenant_id;
    if not found then
      raise exception 'invalid_renewal' using errcode = '22023';
    end if;
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

-- A member's call (checked inside, and by the tables' policies). Not the
-- server's: a renewal needs a signed-in user to be recorded by.
revoke all on function platform.record_renewal(uuid, jsonb) from public, anon, service_role;
grant execute on function platform.record_renewal(uuid, jsonb) to authenticated;

-- 4. A location's opening hours, as one set ----------------------------------------------------
-- p_hours: an array of {"weekday" (0 = Sunday to 6), "open", "close"}, the
-- times as "HH:MM" on the location's own clock. A weekday not named is
-- closed. The whole array is checked before anything is written, so a bad
-- row leaves the week as it was.
--
-- A day that does not change is not rewritten (no audit row for it); the
-- days no longer named are deleted, the rest inserted or updated. All in
-- this one call's transaction, under the location's row, so two saves take
-- turns and the week is never a mix of both.
--
-- Runs as its caller: the table's policies (owners and managers) decide.
-- Raises: only_owner_or_manager (42501); invalid_hours (22023);
-- location_not_found (P0001). Locks: the location's row (for no key
-- update), then its hours.

create function platform.save_location_hours(
  p_tenant_id uuid,
  p_location_id uuid,
  p_hours jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if p_tenant_id is null or p_location_id is null
    or p_hours is null or jsonb_typeof(p_hours) <> 'array'
  then
    raise exception 'invalid_hours' using errcode = '22023';
  end if;
  if not platform_private.has_role(
    p_tenant_id, '{owner,manager}'::platform.platform_role[]
  ) then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  if jsonb_array_length(p_hours) > 7
    or exists (
      select 1 from jsonb_array_elements(p_hours) e
      where case
          when jsonb_typeof(e) = 'object'
            then (select count(*) from jsonb_object_keys(e)) <> 3
          else true
        end
        or jsonb_typeof(e -> 'weekday') is distinct from 'number'
        or (e ->> 'weekday') !~ '^[0-6]$'
        or jsonb_typeof(e -> 'open') is distinct from 'string'
        or jsonb_typeof(e -> 'close') is distinct from 'string'
        or (e ->> 'open') !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
        or (e ->> 'close') !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
    )
  then
    raise exception 'invalid_hours' using errcode = '22023';
  end if;
  if exists (
      select 1 from jsonb_array_elements(p_hours) e
      where (e ->> 'close')::time <= (e ->> 'open')::time
    )
    or (select count(distinct e ->> 'weekday') from jsonb_array_elements(p_hours) e)
      <> jsonb_array_length(p_hours)
  then
    raise exception 'invalid_hours' using errcode = '22023';
  end if;

  -- Not found, or another shop's: the same answer.
  perform 1 from platform.locations l
  where l.id = p_location_id and l.tenant_id = p_tenant_id
  for no key update;
  if not found then
    raise exception 'location_not_found' using errcode = 'P0001';
  end if;

  delete from platform.location_hours h
  where h.tenant_id = p_tenant_id and h.location_id = p_location_id
    and not exists (
      select 1 from jsonb_array_elements(p_hours) e
      where (e ->> 'weekday')::smallint = h.weekday
    );

  insert into platform.location_hours as h (tenant_id, location_id, weekday, open, close)
  select p_tenant_id, p_location_id, (e ->> 'weekday')::smallint,
    (e ->> 'open')::time, (e ->> 'close')::time
  from jsonb_array_elements(p_hours) e
  order by (e ->> 'weekday')::smallint
  on conflict (location_id, weekday) do update
    set open = excluded.open, close = excluded.close
    where h.open is distinct from excluded.open or h.close is distinct from excluded.close;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('weekday', h.weekday, 'open', h.open, 'close', h.close)
        order by h.weekday
      ),
      '[]'::jsonb
    )
    from platform.location_hours h
    where h.tenant_id = p_tenant_id and h.location_id = p_location_id
  );
end;
$$;

-- Owners and managers (checked inside, and by the table's policies). Not
-- the server's.
revoke all on function platform.save_location_hours(uuid, uuid, jsonb)
  from public, anon, service_role;
grant execute on function platform.save_location_hours(uuid, uuid, jsonb) to authenticated;
-- It waits for the location's row behind another save of the same week.
alter function platform.save_location_hours(uuid, uuid, jsonb) set lock_timeout = '6s';

-- 5. Changes to platform_admins are recorded ---------------------------------------------------
-- platform_admins has no tenant, so its changes can't go in audit_events
-- (whose rows belong to a shop and are read by that shop). They get a table
-- of their own. Written only by the trigger below; read only by the
-- service role; nobody updates or deletes a row, by grant or otherwise.
--
-- actor: the signed-in user, empty for the service role (rows are added
-- with the service role). db_role: the database role the caller ran as
-- (service_role through the API, postgres from a console).

create table platform.platform_admin_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- No foreign key: a row here is never changed, not even when a user goes.
  actor uuid,
  db_role text not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  -- The platform_admins row the change was to.
  user_id uuid not null,
  old_row jsonb,
  new_row jsonb
);

create index platform_admin_events_user_idx on platform.platform_admin_events (user_id, at desc);

alter table platform.platform_admin_events enable row level security;
revoke all on platform.platform_admin_events from public, anon, authenticated, service_role;
grant select on platform.platform_admin_events to service_role;

-- Every platform table has a policy, so that none is left to what "RLS on,
-- no policy" happens to mean. This one says it in words: nobody signed in
-- reads these rows (and they have no grant to try). The service role is
-- not subject to RLS.
create policy "No signed-in user reads admin events"
on platform.platform_admin_events for select to authenticated
using (false);

create function platform_private.platform_admins_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := nullif(current_setting('role', true), 'none');
begin
  insert into platform.platform_admin_events (actor, db_role, operation, user_id, old_row, new_row)
  values (
    (select auth.uid()),
    coalesce(nullif(v_role, ''), session_user::text),
    lower(tg_op),
    case when tg_op = 'DELETE' then old.user_id else new.user_id end,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end;
$$;

revoke all on function platform_private.platform_admins_audit()
  from public, anon, authenticated;

create trigger platform_admins_audit
after insert or update or delete on platform.platform_admins
for each row execute function platform_private.platform_admins_audit();

create function platform_private.platform_admin_events_keep()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform_admin_events_are_kept' using errcode = '42501';
end;
$$;

revoke all on function platform_private.platform_admin_events_keep()
  from public, anon, authenticated;

create trigger platform_admin_events_keep_rows
before update or delete on platform.platform_admin_events
for each row execute function platform_private.platform_admin_events_keep();
create trigger platform_admin_events_keep_all
before truncate on platform.platform_admin_events
for each statement execute function platform_private.platform_admin_events_keep();

-- 6. A tenant with audit rows stays ------------------------------------------------------------
-- The audit log went with its tenant (on delete cascade). Now a tenant
-- can't be hard-deleted while it has audit rows, and every tenant has one
-- from the moment it is created. Closing a shop for good is a deliberate
-- act still to be designed (PROGRESS, Phase 11).

alter table platform.audit_events
  drop constraint audit_events_tenant_id_fkey,
  add constraint audit_events_tenant_id_fkey
    foreign key (tenant_id) references platform.tenants (id) on delete restrict;

-- 7. Coupons by id, with their uses ------------------------------------------------------------
-- What coupon_inputs() answers for one code, for a list of coupon ids in
-- one call: {"<coupon id>": {"coupon": {...}, "uses": {"total",
-- "customer"}}}. An id that is not this shop's coupon, or that the caller
-- may not read, is simply absent. For lists (Settings › Coupons): an
-- archived coupon whose code a newer coupon has taken is found by its own
-- id, with its own uses.
--
-- Runs as its caller, so RLS decides, as for coupon_inputs().

create function platform.coupon_inputs_by_id(
  p_tenant_id uuid,
  p_coupon_ids uuid[],
  p_customer_id uuid default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(
      c.id::text,
      jsonb_build_object(
        'coupon', jsonb_build_object(
          'id', c.id,
          'code', c.code,
          'name', c.name,
          'currency', c.currency,
          'kind', c.kind,
          'percent_bp', c.percent_bp,
          'amount', c.amount::text,
          'all_products', c.all_products,
          'product_ids', (
            select coalesce(jsonb_agg(l.product_id order by l.product_id), '[]'::jsonb)
            from platform.coupon_products l
            where l.coupon_id = c.id
          ),
          'valid_from', c.valid_from,
          'valid_to', c.valid_to,
          'pickup_from', c.pickup_from,
          'pickup_to', c.pickup_to,
          'min_days', c.min_days,
          'min_spend', c.min_spend::text,
          'max_uses', c.max_uses,
          'max_uses_per_customer', c.max_uses_per_customer,
          'channels', to_jsonb(c.channels),
          'with_returning_discount', c.with_returning_discount,
          'with_season_discount', c.with_season_discount,
          'active', c.active,
          'archived', c.archived_at is not null
        ),
        'uses', (
          select jsonb_build_object('total', u.total, 'customer', u.customer)
          from platform_private.coupon_uses(c.id, p_customer_id, null) u
        )
      )
    ),
    '{}'::jsonb
  )
  from platform.coupons c
  where c.tenant_id = p_tenant_id
    and c.id = any (p_coupon_ids);
$$;

revoke all on function platform.coupon_inputs_by_id(uuid, uuid[], uuid) from public, anon;
grant execute on function platform.coupon_inputs_by_id(uuid, uuid[], uuid)
  to authenticated, service_role;

-- 8. The code's normaliser folds full-width letters and digits ---------------------------------
-- A code as it is stored and compared. Three steps, and nothing else:
--   1. every space and invisible character in the list below is removed;
--   2. the 26 letters a to z become A to Z;
--   3. the full-width forms an input method types become the plain ones:
--      U+FF21 to U+FF3A and U+FF41 to U+FF5A become A to Z, and U+FF10 to
--      U+FF19 become 0 to 9.
-- All three are one fixed list in one translate(): no Unicode case mapping
-- and no locale (ß stays ß), so @mango/core gives the same answer,
-- character for character (normalizeCouponCode in discounts.ts; the shared
-- cases are in coupon-code.cases.ts and a database test runs them through
-- both).
--
-- The characters removed: tab, line feed, vertical tab, form feed, carriage
-- return, space, no-break space, U+1680, U+2000 to U+200A, line and
-- paragraph separator, U+202F, U+205F, the ideographic space, the byte
-- order mark, and the zero-width space, non-joiner, joiner and word joiner.

create or replace function platform_private.normalize_coupon_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
    p_code,
    'abcdefghijklmnopqrstuvwxyz'
      || U&'\FF21\FF22\FF23\FF24\FF25\FF26\FF27\FF28\FF29\FF2A\FF2B\FF2C\FF2D'
      || U&'\FF2E\FF2F\FF30\FF31\FF32\FF33\FF34\FF35\FF36\FF37\FF38\FF39\FF3A'
      || U&'\FF41\FF42\FF43\FF44\FF45\FF46\FF47\FF48\FF49\FF4A\FF4B\FF4C\FF4D'
      || U&'\FF4E\FF4F\FF50\FF51\FF52\FF53\FF54\FF55\FF56\FF57\FF58\FF59\FF5A'
      || U&'\FF10\FF11\FF12\FF13\FF14\FF15\FF16\FF17\FF18\FF19'
      || U&'\0009\000A\000B\000C\000D\0020\00A0\1680'
      || U&'\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A'
      || U&'\2028\2029\202F\205F\3000\FEFF\200B\200C\200D\2060',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      || '0123456789'
  );
$$;

revoke all on function platform_private.normalize_coupon_code(text) from public, anon;
grant execute on function platform_private.normalize_coupon_code(text)
  to authenticated, service_role;

-- Nothing stored may move with it. Whatever the catalog says depends on the
-- function (an index on an expression, a constraint, a generated column) is
-- rebuilt or refused here; then every stored code must read the same under
-- the new function, and no two live coupons of a shop may share a
-- normalised code. Any of that failing stops the migration with nothing
-- changed.
do $check$
declare
  v_function constant oid := 'platform_private.normalize_coupon_code(text)'::regprocedure;
  v_index regclass;
  v_reindexed integer := 0;
  v_other integer;
  v_changed integer;
  v_duplicates integer;
begin
  for v_index in
    select distinct d.objid::regclass
    from pg_depend d
    join pg_class c on c.oid = d.objid and c.relkind = 'i'
    where d.classid = 'pg_class'::regclass
      and d.refclassid = 'pg_proc'::regclass and d.refobjid = v_function
  loop
    execute format('reindex index %s', v_index);
    v_reindexed := v_reindexed + 1;
  end loop;

  -- A constraint, a generated column's default, a view or a policy that
  -- names the function would hold values worked out the old way.
  select count(*) into v_other
  from pg_depend d
  where d.refclassid = 'pg_proc'::regclass and d.refobjid = v_function
    and d.deptype <> 'i'
    and not (
      d.classid = 'pg_class'::regclass
      and exists (select 1 from pg_class c where c.oid = d.objid and c.relkind = 'i')
    );
  if v_other > 0 then
    raise exception 'normalize_coupon_code: % other object(s) depend on it; check them first',
      v_other;
  end if;

  select count(*) into v_changed
  from platform.coupons c
  where platform_private.normalize_coupon_code(c.code) is distinct from c.code;
  if v_changed > 0 then
    raise exception 'normalize_coupon_code: % stored code(s) would change', v_changed;
  end if;

  select count(*) into v_duplicates
  from (
    select 1
    from platform.coupons c
    where c.archived_at is null
    group by c.tenant_id, platform_private.normalize_coupon_code(c.code)
    having count(*) > 1
  ) d;
  if v_duplicates > 0 then
    raise exception 'normalize_coupon_code: % live code(s) would be duplicates', v_duplicates;
  end if;

  raise notice
    'normalize_coupon_code: % index(es) rebuilt, % other dependents, % stored codes changed, % duplicates',
    v_reindexed, v_other, v_changed, v_duplicates;
end;
$check$;

-- 9. The currency lock counts any redemption ---------------------------------------------------
-- A shop's currency is fixed once any amount is stored in it. A coupon
-- counts when it holds one (a fixed amount, or a minimum spend), and so
-- does any use of any coupon: coupon_redemptions.amount is what the coupon
-- took off, in the currency of the day, with no currency column of its
-- own. A use that was given back keeps its row and its amount, so it counts
-- too.

create or replace function platform_private.tenants_lock_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from platform.product_pricing where tenant_id = new.id)
    or exists (select 1 from platform.price_templates where tenant_id = new.id)
    or exists (select 1 from platform.pricing_settings where tenant_id = new.id)
    or exists (select 1 from platform.unit_financials where tenant_id = new.id)
    or exists (select 1 from platform.unit_renewal_costs where tenant_id = new.id)
    or exists (
      select 1 from platform.coupons
      where tenant_id = new.id and (kind = 'fixed' or min_spend is not null)
    )
    or exists (select 1 from platform.coupon_redemptions where tenant_id = new.id)
  then
    raise exception 'currency_locked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function platform.currency_locked(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select platform_private.is_member(p_tenant_id) and (
    exists (select 1 from platform.product_pricing where tenant_id = p_tenant_id)
    or exists (select 1 from platform.price_templates where tenant_id = p_tenant_id)
    or exists (select 1 from platform.pricing_settings where tenant_id = p_tenant_id)
    or exists (select 1 from platform.unit_financials where tenant_id = p_tenant_id)
    or exists (select 1 from platform.unit_renewal_costs where tenant_id = p_tenant_id)
    or exists (
      select 1 from platform.coupons
      where tenant_id = p_tenant_id and (kind = 'fixed' or min_spend is not null)
    )
    or exists (select 1 from platform.coupon_redemptions where tenant_id = p_tenant_id)
  );
$$;

revoke all on function platform.currency_locked(uuid) from public, anon;
grant execute on function platform.currency_locked(uuid) to authenticated, service_role;
