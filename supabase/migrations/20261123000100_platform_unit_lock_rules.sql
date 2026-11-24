-- Phase 3, stage 1: unit lock rules (docs/phase-3-plan.md §3.8 row 1, §3.11, §4).
--
-- Builds on 20261120000200_platform_security_audit. No earlier migration is
-- touched. No table is created and no row is changed.
--
--  1. The functions re-created here are as main left them (guard).
--  2. Who is calling: platform_private.app_uid() and app_role() (decision 43).
--  3. One expression for a unit's lock key, used by lock_units() and by the
--     new "does this transaction hold it" check.
--  4. units_guard: a product changes only inside move_unit(); one unit per
--     transaction to sold, retired or lost, unless its lock is held already;
--     lost at any time (decision 19).
--  5. move_unit(): the marker, and no second call in one transaction.
--  6. The counts trigger, once per statement (two triggers: update, delete).
--  7. review_catalog_request(): products before the catalog entry, and it no
--     longer switches a Moto Mangos listing on.
--
-- Lock order: nothing here adds a lock class. What changes is the order in
-- which two existing writers take rows they already took:
--   - a statement that changes or deletes units takes every product row it
--     affects once, in id order, `for no key update`, then each listing row
--     in product-id order (it took them row by row, in the statement's order);
--   - review_catalog_request() takes its product rows in id order and then
--     the catalog entry (it took the entry first, while deleting a product
--     takes the product's row and then the entry).

-- 1. The functions are as main left them -------------------------------------------------------

do $guard$
declare
  v_expected constant jsonb := jsonb_build_object(
    'platform.move_unit(uuid,uuid,uuid,uuid,integer,timestamp with time zone,jsonb)',
      '978f6a1f228428dfe7c5b28dd9feda8f',
    'platform_private.units_guard()', 'c58ae1d2ab6f913ac4d294fec4d2a3de',
    'platform_private.units_clamp_product_counts()', '9bd013e273b42dfcc1d7eb537cab03ec',
    'platform.review_catalog_request(uuid,boolean,text,uuid,integer,integer)',
      'b0ebe8f4af475c3e90dafe30774e319a',
    'platform_private.lock_units(uuid[])', '4578d95218eefac728e33cf8eb34adbb'
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

-- 2. Who is calling -------------------------------------------------------------------------------
-- The caller's id and role, read from the request's claims and from nowhere
-- else (the owner's decision, 23 Nov 2026, in place of "select auth.uid()"):
-- the same body works on Supabase today and on Neon after the move, where
-- the claims arrive in the same setting. With no request (pg_cron, a
-- migration, a console) both answer null and guess nothing; a caller that
-- needs a default states its own.
--
-- auth.uid() and auth.role() on Supabase still read the older settings
-- request.jwt.claim.sub and request.jwt.claim.role first. Nothing sets them:
-- PostgREST (v16 here) sets request.jwt.claims only, and so do the tests. So
-- the two pairs agree for every caller there is; caller-functions.test.ts
-- holds them to it.

create function platform_private.app_uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
revoke all on function platform_private.app_uid() from public, anon;
grant execute on function platform_private.app_uid() to authenticated, service_role;

create function platform_private.app_role()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
revoke all on function platform_private.app_role() from public, anon;
grant execute on function platform_private.app_role() to authenticated, service_role;

-- 3. A unit's lock, in one place ------------------------------------------------------------------
-- The unit advisory lock is (class 1a01, hashtext of the unit's id), always
-- for the transaction (pg_advisory_xact_lock): no function, trigger or
-- script takes it for the session. pg_locks can't tell the two apart, so
-- holds_unit_lock() below is only right while that stays true.
--
-- lock_units() and holds_unit_lock() read the class and the key from the
-- two functions here, so the lock taken and the lock looked for can't drift.
-- Granted as lock_units() is (to authenticated, not to the service role):
-- they are only ever reached from functions that run as their owner.

create function platform_private.unit_lock_class()
returns integer
language sql
immutable
set search_path = ''
as $$
  select x'1a01'::int
$$;
revoke all on function platform_private.unit_lock_class() from public, anon;
grant execute on function platform_private.unit_lock_class() to authenticated;

create function platform_private.unit_lock_key(p_unit_id uuid)
returns integer
language sql
immutable
set search_path = ''
as $$
  select hashtext(p_unit_id::text)
$$;
revoke all on function platform_private.unit_lock_key(uuid) from public, anon;
grant execute on function platform_private.unit_lock_key(uuid) to authenticated;

-- True when this transaction already holds the unit's lock. Two units whose
-- keys collide share one lock, so the answer is about the lock, as it
-- should be. Volatile: it changes inside a statement.
create function platform_private.holds_unit_lock(p_unit_id uuid)
returns boolean
language sql
volatile
set search_path = ''
as $$
  select exists (
    select 1
    from pg_catalog.pg_locks l
    where l.locktype = 'advisory'
      and l.granted
      and l.pid = pg_catalog.pg_backend_pid()
      and l.database = (
        select d.oid from pg_catalog.pg_database d
        where d.datname = pg_catalog.current_database())
      -- A two-key advisory lock: the keys as unsigned 32-bit numbers.
      and l.classid = (platform_private.unit_lock_class()::bigint & 4294967295)::oid
      and l.objid = (platform_private.unit_lock_key(p_unit_id)::bigint & 4294967295)::oid
      and l.objsubid = 2
      and l.mode = 'ExclusiveLock'
  )
$$;
revoke all on function platform_private.holds_unit_lock(uuid) from public, anon;
grant execute on function platform_private.holds_unit_lock(uuid) to authenticated;

-- As main's, with the class and the key from the two functions above.
create or replace function platform_private.lock_units(p_unit_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_key integer;
begin
  for v_key in
    select distinct platform_private.unit_lock_key(u)
    from unnest(p_unit_ids) u
    order by 1
  loop
    perform pg_advisory_xact_lock(platform_private.unit_lock_class(), v_key);
  end loop;
end;
$function$;

-- 4. units_guard ----------------------------------------------------------------------------------
-- Main's body (20261120000200) with four changes:
--
--  a. A product change is allowed only inside move_unit(), for the unit it
--     names: the transaction-local setting platform.moving_unit holds that
--     unit's id while move_unit() updates it, and 'done' afterwards. Any
--     other product change is refused (use_move_unit), for the service role
--     and the database's owner too, and so is one made after a move_unit()
--     in the same transaction. This is a lock-order rule, not a permission:
--     a session that can run SQL of its own can set the marker.
--  b. One unit per transaction to sold, retired or lost
--     (one_unit_status_change), because this trigger takes each such unit's
--     lock in the statement's row order, and two statements could cross.
--     Checked before the second unit's lock is asked for. The exception:
--     this transaction already holds every such unit's lock, as
--     lock_units() takes them before an update (the owner, 23 Nov 2026).
--     The guard checks that the locks are held; it cannot see that they
--     were taken sorted, which is the caller's part. Only functions that
--     take all their units' locks through lock_units() are meant to use
--     this path, and it is not reachable through PostgREST. That is how
--     report_gear_problem() and set_stock_quantity() change several gear
--     units in one call, and they are the only users of that path. The
--     marker platform.unit_status_change is the one unit whose lock this
--     trigger took itself, or 'held' while every unit so far was held
--     already; the two never mix in one transaction.
--  c. Lost at any time (decision 19): no unit_has_future_blocks for lost.
--     A rental that is out stays open, future bookings keep their blocks,
--     downtime from now on is cleared as before.
--  d. The caller is read through app_uid().

create or replace function platform_private.units_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role platform.platform_role;
  v_free text[] := array['current_odometer_km', 'status', 'updated_at'];
  v_changed text;
begin
  if new.product_type = 'gear' then
    v_free := v_free || array['problem_on', 'expected_back', 'problem_notes'];
  end if;

  if (select platform_private.app_uid()) is not null then
    v_role := platform_private.my_role(new.tenant_id);
    if v_role is null or v_role not in ('owner', 'manager') then
      -- A lost unit's problem line (the day, the notes) is for whoever may
      -- mark a unit lost: the rule update_unit_problem() has. A mechanic
      -- edits the line of a unit in repair, not of a lost one.
      if new.product_type = 'gear' and old.status = 'lost'
        and (v_role is null or v_role <> all (platform_private.gear_roles('mark_lost')))
        and (new.problem_on, new.expected_back, new.problem_notes)
          is distinct from (old.problem_on, old.expected_back, old.problem_notes)
      then
        raise exception 'role_not_allowed' using errcode = '42501';
      end if;
      if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
        raise exception 'only_owner_or_manager' using errcode = '42501';
      end if;
      if new.status is distinct from old.status then
        if old.status in ('active', 'maintenance') and new.status in ('active', 'maintenance') then
          null;
        elsif old.status in ('active', 'maintenance') and new.status = 'lost' then
          if v_role is distinct from 'staff' then
            raise exception 'role_not_allowed' using errcode = '42501';
          end if;
        else
          raise exception 'only_owner_or_manager' using errcode = '42501';
        end if;
      end if;
    end if;
  end if;

  -- Another product: only inside move_unit(), and only for the unit it is
  -- moving right now. Before any lock is asked for.
  if new.product_id <> old.product_id
    and nullif(current_setting('platform.moving_unit', true), '')
      is distinct from new.id::text
  then
    raise exception 'use_move_unit' using errcode = 'P0001';
  end if;

  -- Sold, retired or lost: one unit per transaction, unless the transaction
  -- holds every such unit's lock already. Before this unit's lock is asked
  -- for, so a refused statement has taken no second lock.
  if (new.status in ('sold', 'retired') and old.status not in ('sold', 'retired'))
    or (new.status = 'lost' and old.status <> 'lost')
  then
    v_changed := nullif(current_setting('platform.unit_status_change', true), '');
    if platform_private.holds_unit_lock(new.id) then
      -- Held already. Fine beside other held units, and for the one unit
      -- this trigger locked itself a moment ago; not beside another one.
      if v_changed is null then
        perform set_config('platform.unit_status_change', 'held', true);
      elsif v_changed not in ('held', new.id::text) then
        raise exception 'one_unit_status_change' using errcode = 'P0001';
      end if;
    else
      if v_changed is not null then
        raise exception 'one_unit_status_change' using errcode = 'P0001';
      end if;
      perform set_config('platform.unit_status_change', new.id::text, true);
    end if;
  end if;

  -- Selling or retiring: its future blocks must be moved or ended first.
  if new.status in ('sold', 'retired') and old.status not in ('sold', 'retired') then
    -- Wait for anyone writing this bike's blocks right now (same lock as
    -- unit_blocks_guard), so the check below sees what they saved.
    perform pg_advisory_xact_lock(
      platform_private.unit_lock_class(), platform_private.unit_lock_key(new.id));
    if exists (
      select 1 from platform.unit_blocks b
      where b.unit_id = new.id and (upper_inf(b.period) or upper(b.period) > now())
    ) then
      raise exception 'unit_has_future_blocks' using errcode = 'P0001';
    end if;
  end if;

  -- Lost, at any time: while it is out, and with bookings ahead. Its
  -- bookings keep their blocks (they are at risk; staff move them); its
  -- downtime from now on is cleared.
  if new.status = 'lost' and old.status <> 'lost' then
    perform pg_advisory_xact_lock(
      platform_private.unit_lock_class(), platform_private.unit_lock_key(new.id));
    delete from platform.unit_blocks b
    where b.unit_id = new.id and b.kind = 'downtime' and lower(b.period) >= now();
    update platform.unit_blocks b
    set period = tstzrange(lower(b.period), now(), '[)')
    where b.unit_id = new.id and b.kind = 'downtime'
      and (upper_inf(b.period) or upper(b.period) > now());
    new.expected_back := null;
  end if;

  -- Another product or another place: its bookings must be there already.
  -- move_unit() takes them there first; a place change made any other way
  -- is refused while a booking still names where the unit was. It reads the
  -- unit's blocks, so it waits for anyone writing them (the same lock).
  if new.product_id <> old.product_id or new.location_id <> old.location_id then
    perform pg_advisory_xact_lock(
      platform_private.unit_lock_class(), platform_private.unit_lock_key(new.id));
    if exists (
      select 1
      from platform.unit_blocks b
      join platform.reservations r on r.id = b.reservation_id
      where b.unit_id = new.id
        and (upper_inf(b.period) or upper(b.period) > now())
        and r.state in ('held', 'reserved', 'out')
        and (r.product_id <> new.product_id or r.location_id <> new.location_id)
    ) then
      raise exception 'unit_has_bookings' using errcode = 'P0001';
    end if;
  end if;

  if old.status = 'lost' and new.status <> 'lost' then
    new.problem_on := null;
    new.expected_back := null;
    new.problem_notes := null;
  end if;
  return new;
end;
$function$;

-- 5. move_unit() ----------------------------------------------------------------------------------
-- Main's body (20261116000200) with three changes:
--
--  a. It refuses to start when this transaction has called move_unit()
--     already (one_move_per_transaction): one call per transaction, so that
--     two moves can only meet at locks each takes once, in order. The marker
--     platform.moving_unit is set to 'started' straight after that check,
--     before anything that can answer early (stale, try_again,
--     bookings_changed, nothing to do), because each of those answers leaves
--     the call's locks held: a second call would take a second batch.
--     Whatever the first call answered, a second one is refused. (A caller
--     who may not move units at all is answered not_allowed before the
--     check, with no lock taken and no marker set.)
--  b. It sets platform.moving_unit to the unit's id just before it updates
--     the unit and to 'done' straight after: the unit's guard lets a
--     product change through only in between.
--  c. The caller's role is read through app_role().
--
-- The product rows were already taken in id order, `for no key update`,
-- both at once: two opposite moves at one place take turns at their
-- product-and-location locks, and at two places at the product rows.

create or replace function platform.move_unit(
  p_tenant_id uuid,
  p_unit_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_expected_bookings integer default null,
  p_expected_updated_at timestamp with time zone default null,
  p_details jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '6s'
as $function$
declare
  v_key text;
  v_unit platform.units%rowtype;
  v_from_product uuid;
  v_from_location uuid;
  v_product_ids uuid[];
  v_location_ids uuid[];
  v_r platform.reservations%rowtype;
  v_new_id uuid;
  v_moved uuid[] := '{}';
  v_booking record;
  v_bookings integer;
  v_updated_at timestamptz;
begin
  if (select platform_private.app_role()) is distinct from 'service_role'
    and not platform_private.has_role(
      p_tenant_id, '{owner,manager}'::platform.platform_role[])
  then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  -- One call per transaction, whatever the first one answered: the marker
  -- is 'started', then the unit being moved, then 'done'.
  if nullif(current_setting('platform.moving_unit', true), '') is not null then
    raise exception 'one_move_per_transaction' using errcode = 'P0001';
  end if;
  perform set_config('platform.moving_unit', 'started', true);
  if p_unit_id is null or p_product_id is null or p_location_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_details is not null then
    if jsonb_typeof(p_details) <> 'object' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(p_details) loop
      if v_key not in (
        'plate', 'plate_pending', 'frame_number', 'engine_number', 'colour',
        'model_year', 'notes', 'current_odometer_km'
      ) then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- Not found, or another shop's: the same answer.
  select * into v_unit
  from platform.units u
  where u.id = p_unit_id and u.tenant_id = p_tenant_id;
  if not found then
    raise exception 'unit_not_found' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from platform.products p
    where p.id = p_product_id and p.tenant_id = p_tenant_id and p.retired_at is null
  ) then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;
  -- A scooter can't become a helmet.
  if not exists (
    select 1 from platform.products p
    where p.id = p_product_id and p.type = v_unit.product_type
  ) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from platform.locations l
    where l.id = p_location_id and l.tenant_id = p_tenant_id
  ) then
    raise exception 'location_not_found' using errcode = 'P0001';
  end if;

  -- 1. Product-and-location locks: where it is, where it goes, and whatever
  -- its bookings name, sorted once.
  select array_agg(x.product_id), array_agg(x.location_id)
  into v_product_ids, v_location_ids
  from (
    select v_unit.product_id as product_id, v_unit.location_id as location_id
    union
    select p_product_id, p_location_id
    union
    select r.product_id, r.location_id
    from platform.unit_blocks b
    join platform.reservations r on r.id = b.reservation_id
    where b.unit_id = p_unit_id
  ) x;
  perform platform_private.lock_products_stock(v_product_ids, v_location_ids);

  -- 2. The unit's lock.
  perform platform_private.lock_units(array[p_unit_id]);

  -- 3. Rows: the unit, without waiting, then the products in id order.
  begin
    select * into v_unit
    from platform.units u
    where u.id = p_unit_id
    for no key update nowait;
  exception
    when lock_not_available then
      return jsonb_build_object('ok', false, 'reason', 'try_again');
  end;
  if v_unit.id is null or not exists (
    select 1 from platform.units u where u.id = p_unit_id
  ) then
    raise exception 'unit_not_found' using errcode = 'P0001';
  end if;
  if p_expected_updated_at is not null and v_unit.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;
  v_from_product := v_unit.product_id;
  v_from_location := v_unit.location_id;

  -- Both products at once, in id order, at the strongest strength this
  -- transaction needs: the unit's triggers below ask for nothing stronger.
  perform 1 from platform.products p
  where p.id in (v_from_product, p_product_id)
  order by p.id
  for no key update;
  if not exists (
    select 1 from platform.products p
    where p.id = p_product_id and p.tenant_id = p_tenant_id and p.retired_at is null
  ) then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;

  -- Under the locks. The unit was somewhere else when the locks were chosen,
  -- or one of its bookings names a product that was not locked: start again.
  if exists (
      select 1
      from (
        select v_from_product as product_id, v_from_location as location_id
        union
        select r.product_id, r.location_id
        from platform.unit_blocks b
        join platform.reservations r on r.id = b.reservation_id
        where b.unit_id = p_unit_id
      ) needed
      where not exists (
        select 1 from unnest(v_product_ids, v_location_ids) t(product_id, location_id)
        where t.product_id = needed.product_id and t.location_id = needed.location_id
      )
    )
  then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
  end if;

  -- The bookings the person was warned about: the ones that hold this unit
  -- from now on.
  select count(distinct r.booking_id) into v_bookings
  from platform.reservations r
  where r.state in ('held', 'reserved', 'out')
    and exists (
      select 1 from platform.unit_blocks b
      where b.reservation_id = r.id and b.unit_id = p_unit_id
        and (upper_inf(b.period) or upper(b.period) > now())
    );
  if p_expected_bookings is not null and v_bookings <> p_expected_bookings then
    return jsonb_build_object(
      'ok', false, 'reason', 'bookings_changed', 'bookings', v_bookings);
  end if;

  -- Where it already is: no booking moves, and with no details to save
  -- there is nothing to write.
  if v_from_product = p_product_id and v_from_location = p_location_id then
    v_bookings := 0;
    if p_details is null or p_details = '{}'::jsonb then
      return jsonb_build_object(
        'ok', true, 'unit_id', p_unit_id, 'bookings', 0,
        'reservation_ids', '[]'::jsonb, 'updated_at', v_unit.updated_at);
    end if;
  end if;

  -- The reservations follow, in id order.
  for v_r in
    select r.*
    from platform.reservations r
    where r.state in ('held', 'reserved', 'out')
      and (r.product_id <> p_product_id or r.location_id <> p_location_id)
      and exists (
        select 1 from platform.unit_blocks b
        where b.reservation_id = r.id and b.unit_id = p_unit_id
          and (upper_inf(b.period) or upper(b.period) > now())
      )
    order by r.id
    for update of r
  loop
    if v_r.quantity = 1 then
      update platform.reservations r
      set product_id = p_product_id, location_id = p_location_id
      where r.id = v_r.id;
      v_new_id := v_r.id;
    else
      -- A row for several units: this unit's part becomes a row of its own.
      insert into platform.reservations (
        tenant_id, booking_id, parent_id, product_id, product_type, location_id,
        starts_at, ends_at, block_period, quantity, shortage, channel, mode, state,
        hold_expires_at, created_by
      )
      values (
        v_r.tenant_id, v_r.booking_id, v_r.parent_id, p_product_id, v_r.product_type,
        p_location_id, v_r.starts_at, v_r.ends_at, v_r.block_period, 1, 0,
        v_r.channel, v_r.mode, v_r.state, v_r.hold_expires_at, v_r.created_by
      )
      returning id into v_new_id;
      update platform.unit_blocks b
      set reservation_id = v_new_id
      where b.reservation_id = v_r.id and b.unit_id = p_unit_id;
      update platform.reservations r
      set quantity = r.quantity - 1
      where r.id = v_r.id;
    end if;
    v_moved := v_moved || v_new_id;
  end loop;

  -- The unit itself, with the rest of the form in the same statement. Its
  -- guard finds every booking already where it is going, and lets the
  -- product change through for this unit only, between the two lines that
  -- set the marker. Anything this refuses (a plate another vehicle has,
  -- say) undoes the whole call.
  perform set_config('platform.moving_unit', p_unit_id::text, true);
  update platform.units u
  set product_id = p_product_id,
    location_id = p_location_id,
    plate = case when p_details ? 'plate' then p_details ->> 'plate' else u.plate end,
    plate_pending = case when p_details ? 'plate_pending'
      then (p_details ->> 'plate_pending')::boolean else u.plate_pending end,
    frame_number = case when p_details ? 'frame_number'
      then p_details ->> 'frame_number' else u.frame_number end,
    engine_number = case when p_details ? 'engine_number'
      then p_details ->> 'engine_number' else u.engine_number end,
    colour = case when p_details ? 'colour' then p_details ->> 'colour' else u.colour end,
    model_year = case when p_details ? 'model_year'
      then (p_details ->> 'model_year')::integer else u.model_year end,
    notes = case when p_details ? 'notes' then p_details ->> 'notes' else u.notes end,
    current_odometer_km = case when p_details ? 'current_odometer_km'
      then (p_details ->> 'current_odometer_km')::numeric else u.current_odometer_km end
  where u.id = p_unit_id
  returning u.updated_at into v_updated_at;
  perform set_config('platform.moving_unit', 'done', true);

  -- One event per booking.
  for v_booking in
    select r.booking_id, array_agg(r.id order by r.id) as ids
    from platform.reservations r
    where r.id = any (v_moved)
    group by r.booking_id
    order by r.booking_id
  loop
    perform platform_private.audit(
      p_tenant_id, 'bookings', v_booking.booking_id::text, 'move', null,
      jsonb_build_object(
        'unit_id', p_unit_id,
        'reservation_ids', to_jsonb(v_booking.ids),
        'from', jsonb_build_object(
          'product_id', v_from_product, 'location_id', v_from_location),
        'to', jsonb_build_object(
          'product_id', p_product_id, 'location_id', p_location_id)));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'unit_id', p_unit_id,
    'bookings', v_bookings,
    'reservation_ids', to_jsonb(v_moved),
    'updated_at', v_updated_at);
exception
  when deadlock_detected then
    -- Everything this call did is undone, the marker with it: set it again,
    -- so that this answer too closes the transaction to a second call.
    perform set_config('platform.moving_unit', 'done', true);
    return jsonb_build_object('ok', false, 'reason', 'try_again');
end;
$function$;

-- 6. The counts trigger, once per statement ------------------------------------------------------
-- units_clamp_product_counts was a row trigger: one statement that changed
-- or deleted units of two products took their product rows `for no key
-- update` in whatever order its rows came, while a booking of the two holds
-- them `for share` in id order. Now a statement takes every product row it
-- affects once, in id order, before any product's counts are touched.
--
-- A statement trigger with transition tables can carry neither a column
-- list nor two events, so there are two: one for update, one for delete.
-- units_busy_on_delete stays as it is, per row.

drop trigger units_clamp_product_counts on platform.units;
drop function platform_private.units_clamp_product_counts();

-- One product's listing kept within its fleet, as the row trigger did. The
-- caller holds the product's row. p_units: the units that stopped counting
-- for it in this statement; p_change: what happened to them.
create function platform_private.clamp_product_counts(
  p_product_id uuid,
  p_units uuid[],
  p_change text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_model record;
  v_listing record;
  v_active int;
  v_instant int;
  v_request int;
  v_ready int;
begin
  select id, tenant_id into v_model
  from platform.products
  where id = p_product_id;
  -- Gone already: the model or the whole tenant is being deleted.
  if not found or not exists (select 1 from platform.tenants where id = v_model.tenant_id) then
    return;
  end if;

  select instant_units, request_units, ready_now into v_listing
  from platform.product_listings
  where product_id = v_model.id
  for update;
  -- Never listed: nothing to keep within the fleet.
  if not found then
    return;
  end if;

  select count(*) into v_active
  from platform.units
  where tenant_id = v_model.tenant_id and product_id = v_model.id and status = 'active';

  v_instant := least(v_listing.instant_units, v_active);
  v_request := least(v_listing.request_units, v_active - v_instant);
  v_ready := least(v_listing.ready_now, v_active);
  if v_instant = v_listing.instant_units
    and v_request = v_listing.request_units
    and v_ready = v_listing.ready_now
  then
    return;
  end if;

  update platform.product_listings
  set instant_units = v_instant, request_units = v_request, ready_now = v_ready
  where product_id = v_model.id;

  insert into platform.audit_events (tenant_id, entity, entity_id, action, actor, before, after)
  values (
    v_model.tenant_id, 'products', v_model.id::text, 'clamp_booking_counts',
    (select platform_private.app_uid()),
    jsonb_build_object(
      'instant_units', v_listing.instant_units,
      'request_units', v_listing.request_units,
      'ready_now', v_listing.ready_now
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'instant_units', v_instant,
      'request_units', v_request,
      'ready_now', v_ready,
      'active_units', v_active,
      'because_unit', p_units[1],
      -- Several in one statement: all of them, the first above as before.
      'because_units', case when cardinality(p_units) > 1 then to_jsonb(p_units) end,
      'unit_change', p_change
    ))
  );
end;
$function$;
revoke all on function platform_private.clamp_product_counts(uuid, uuid[], text) from public, anon;

create function platform_private.units_counts_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ids uuid[];
  v_product record;
begin
  -- The products a unit stopped counting for: it was active, and now it is
  -- not, or it is on another product.
  select array_agg(distinct o.product_id) into v_ids
  from o
  join n on n.id = o.id
  where o.status = 'active'
    and (n.status <> 'active' or n.product_id <> o.product_id);
  if v_ids is null then
    return null;
  end if;

  -- Every one of them once, in id order, before any counts are touched. Not
  -- a full row lock: that would wait for units arriving on these products.
  perform 1
  from platform.products p
  where p.id = any (v_ids)
  order by p.id
  for no key update;

  -- Then each product and its listing, in the same order.
  for v_product in
    select x.product_id,
      array_agg(x.id order by x.id) as units,
      case when count(distinct x.change) = 1 then min(x.change) else 'several changes' end
        as change
    from (
      select o.product_id, o.id,
        case
          when n.product_id <> o.product_id then 'moved to another model'
          else 'status ' || o.status || ' -> ' || n.status
        end as change
      from o
      join n on n.id = o.id
      where o.status = 'active'
        and (n.status <> 'active' or n.product_id <> o.product_id)
    ) x
    group by x.product_id
    order by x.product_id
  loop
    perform platform_private.clamp_product_counts(
      v_product.product_id, v_product.units, v_product.change);
  end loop;
  return null;
end;
$function$;
revoke all on function platform_private.units_counts_after_update() from public, anon;

create function platform_private.units_counts_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ids uuid[];
  v_product record;
begin
  select array_agg(distinct o.product_id) into v_ids
  from o
  where o.status = 'active';
  if v_ids is null then
    return null;
  end if;

  perform 1
  from platform.products p
  where p.id = any (v_ids)
  order by p.id
  for no key update;

  for v_product in
    select o.product_id, array_agg(o.id order by o.id) as units
    from o
    where o.status = 'active'
    group by o.product_id
    order by o.product_id
  loop
    perform platform_private.clamp_product_counts(
      v_product.product_id, v_product.units, 'deleted');
  end loop;
  return null;
end;
$function$;
revoke all on function platform_private.units_counts_after_delete() from public, anon;

create trigger units_counts_after_update
after update on platform.units
referencing old table as o new table as n
for each statement execute function platform_private.units_counts_after_update();

create trigger units_counts_after_delete
after delete on platform.units
referencing old table as o
for each statement execute function platform_private.units_counts_after_delete();

-- 7. review_catalog_request() ---------------------------------------------------------------------
-- Main's body (20261114000200) with three changes:
--
--  c. `lock_timeout = '6s'`, as every function that waits for these rows
--     has (plan 4.4): a wait that runs out raises 55P03 with nothing written.
--  a. Lock order. It took the catalog entry and then its products; deleting
--     a product takes the product's row and then, in
--     products_withdraw_request, the entry. Now: the products in id order,
--     `for no key update`, then the entry. A product linked to the entry
--     between the two steps is seen under the entry's lock (nothing can be
--     linked once it is held: the link's foreign key waits for it), and the
--     call asks to be sent again (try_again) rather than lock it late.
--  b. Approve and merge set catalog_id and catalog_approved_at only. They
--     no longer create or switch on a Moto Mangos listing (the owner, 20 Nov
--     2026): the shop switches it on itself with save_listing(), as for any
--     connected vehicle. A listing that exists keeps its `enabled` value.
--     Reject still switches a listing off.

create or replace function platform.review_catalog_request(
  p_catalog_id uuid,
  p_approve boolean,
  p_notes text default null,
  p_merge_into uuid default null,
  p_year_from integer default null,
  p_year_to integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '6s'
as $function$
declare
  v_request record;
  v_model record;
  v_target_slug text;
  v_decision text;
  v_kept jsonb := '[]';
  v_locked uuid[];
  v_moved uuid[];
  v_notes text := nullif(btrim(p_notes), '');
begin
  if not platform_private.is_platform_admin() then
    raise exception 'Only platform admins can review catalog entries'
      using errcode = '42501';
  end if;

  -- The products first, in id order; then the entry; then (below) listings.
  select coalesce(array_agg(s.id), '{}') into v_locked
  from (
    select m.id
    from platform.products m
    where m.catalog_id = p_catalog_id
    order by m.id
    for no key update
  ) s;

  select id, make, model, request_note, requested_by_tenant_id into v_request
  from public.bike_catalog
  where id = p_catalog_id
    and status = 'requested'
    and requested_by_tenant_id is not null
  for update;
  if not found then
    raise exception 'Catalog request not found' using errcode = 'P0002';
  end if;

  -- A product linked since the products were locked: not locked, so not
  -- touched. Nothing was written; the call can be sent again.
  if exists (
    select 1 from platform.products m
    where m.catalog_id = p_catalog_id and m.id <> all (v_locked)
  ) then
    raise exception 'try_again' using errcode = 'P0001';
  end if;

  if p_merge_into is not null then
    select slug into v_target_slug
    from public.bike_catalog
    where id = p_merge_into and status = 'approved';
    if v_target_slug is null then
      raise exception 'merge_target_not_approved' using errcode = 'P0001';
    end if;
    v_decision := 'merge';
    -- Connected to the approved entry. The listing is the shop's to switch on.
    select coalesce(array_agg(m.id order by m.id), '{}') into v_moved
    from platform.products m
    where m.catalog_id = p_catalog_id;
    update platform.products
    set catalog_id = p_merge_into, catalog_approved_at = now()
    where id = any (v_moved);
    update public.bike_catalog
    set status = 'rejected',
        review_notes = concat_ws(' ', v_notes, 'Merged into ' || v_target_slug || '.'),
        reviewed_at = now()
    where id = p_catalog_id;
  elsif p_approve then
    v_decision := 'approve';
    update public.bike_catalog
    set status = 'approved',
        review_notes = v_notes,
        reviewed_at = now(),
        -- The model years the entry covers are the reviewer's to set (owner,
        -- 13 Nov 2026). A request arrives with the one year of the shop's
        -- own bike as both ends; left alone, that stands.
        year_from = coalesce(p_year_from, year_from),
        year_to = coalesce(p_year_to, year_to),
        -- The entry is public from here on.
        request_note = null,
        requested_by_tenant_id = null
    where id = p_catalog_id;
    -- What the shop is told, on its own model. The listing is the shop's to
    -- switch on.
    update platform.products
    set catalog_approved_at = now()
    where catalog_id = p_catalog_id;
  else
    v_decision := 'reject';
    for v_model in
      select m.id, m.tenant_id, m.name, m.make, m.model
      from platform.products m
      where m.catalog_id = p_catalog_id
      order by m.created_at, m.id
    loop
      -- Off Moto Mangos either way (a request was never on it; this keeps
      -- the rule in one place if that ever changes).
      update platform.product_listings
      set enabled = false
      where product_id = v_model.id and enabled;
      if exists (
        select 1 from platform.products o
        where o.tenant_id = v_model.tenant_id
          and o.catalog_id is null
          and o.id <> v_model.id
          and platform_private.norm(o.make) = platform_private.norm(v_model.make)
          and platform_private.norm(o.model) = platform_private.norm(v_model.model)
      ) then
        -- The shop already has this make and model as its own: giving this
        -- one back too would make two. It stays linked, unlisted.
        v_kept := v_kept || jsonb_build_object('product_id', v_model.id, 'name', v_model.name);
        update platform.products
        set catalog_rejected_at = now(), catalog_reject_reason = v_notes
        where id = v_model.id;
      else
        update platform.products
        set catalog_id = null,
            -- What the shop is told, on its own model.
            catalog_rejected_at = now(), catalog_reject_reason = v_notes
        where id = v_model.id;
      end if;
    end loop;
    update public.bike_catalog
    set status = 'rejected', review_notes = v_notes, reviewed_at = now()
    where id = p_catalog_id;
  end if;

  perform platform_private.audit(
    v_request.requested_by_tenant_id, 'bike_catalog', p_catalog_id::text, v_decision,
    jsonb_strip_nulls(jsonb_build_object(
      'status', 'requested',
      'request_note', v_request.request_note
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'make', v_request.make,
      'model', v_request.model,
      'notes', v_notes,
      'merged_into', v_target_slug,
      'kept_linked', case when jsonb_array_length(v_kept) > 0 then v_kept end
    ))
  );

  return jsonb_build_object('decision', v_decision, 'kept_linked', v_kept);
end;
$function$;
