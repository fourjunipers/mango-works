-- Phase 2, stage 2: shortage, holds and the availability read
-- (docs/phase-2-plan.md §3.2 to §3.5, §4, §8 stage 2; the owner's answers in
-- §10; the review of PR 36).
--
-- Builds on the migrations before it, none of which is touched.
--
--  1. platform.tenants.allow_overbooking (off) and hold_minutes (15, 5 to 60).
--     No signed-in person can write either yet: the Booking rules screen and
--     save_booking_rules() are stage 3's.
--  2. platform_private.booking_roles() re-created: 'confirm' and 'assign'.
--  3. Allocation and hold blocks are no longer audited row by row (the
--     booking's own events name the units). Downtime and transfers still are.
--  4. A unit can't be deleted while something holds its lock (unit_busy).
--  5. platform_private.free_units() re-created: a hold that has run out holds
--     nothing; a unit still out past its end is not free (§3.5).
--  6. platform_private.shortage_demand(): units that short reservations are
--     still waiting for.
--  7. platform_private.hold_expiry() and expire_holds(): when a hold runs
--     out, and what releasing it does.
--  8. platform.reserve() re-created: holds, hold release and the shortage
--     rule (staff only; online channels never create a shortage).
--  9. platform.cancel_reservation() re-created: the cancel event names the
--     units.
-- 10. platform.confirm_hold(), platform.assign_units().
-- 11. platform.release_expired_holds() and its schedule (every minute).
-- 12. platform.availability(): the read.
-- 13. platform.move_unit(), and platform_private.units_guard() re-created: a
--     unit that has bookings changes its product or place only through the
--     function, which moves the bookings with it.
-- 14. PUBLIC loses execute on the older platform_private functions (with 7,
--     where the service role is let into that schema).
--
-- Re-created functions are their bodies from the database
-- (pg_get_functiondef) with the changes named above each, and their grants
-- restated.
--
-- Lock order, for every writer (root CLAUDE.md), unchanged:
--   1. product-and-location advisory locks (namespace 1a02), sorted by key;
--   2. unit advisory locks (namespace 1a01), sorted by key;
--   3. rows: unit rows (for key share) in id order, the product's row (for
--      share) in product-id order, then reservations, then unit_blocks.
--
-- Releasing a hold only deletes blocks, and it happens under the product
-- lock that every writer of that reservation's blocks holds, in the rows
-- phase. It takes no unit lock: a second batch of unit locks, or a block row
-- deleted before the unit rows are locked, would each open a cycle.

-- 1. The shop's settings ------------------------------------------------------------------------
-- platform.tenants has column grants (name, country, currency, locale,
-- distance_unit), so these two are readable by every member and writable by
-- the service role only, until stage 3 gives owners and managers a function.

alter table platform.tenants
  add column allow_overbooking boolean not null default false,
  add column hold_minutes integer not null default 15
    constraint tenants_hold_minutes_check check (hold_minutes between 5 and 60);

-- 2. Who may do what ----------------------------------------------------------------------------
-- As it stood (20261116000100), plus 'confirm' and 'assign'.
-- apps/platform/lib/booking-permissions.ts is its copy.

create or replace function platform_private.booking_roles(p_action text)
returns platform.platform_role[]
language sql
immutable
set search_path = ''
as $$
  select (case p_action
    when 'read' then '{owner,manager,staff,mechanic,driver}'
    when 'reserve' then '{owner,manager,staff}'
    when 'cancel' then '{owner,manager,staff}'
    when 'confirm' then '{owner,manager,staff}'
    when 'assign' then '{owner,manager,staff}'
    else '{}'
  end)::platform.platform_role[];
$$;

revoke all on function platform_private.booking_roles(text) from public, anon;
grant execute on function platform_private.booking_roles(text) to authenticated, service_role;

-- 3. Audit: a booking's blocks are in the booking's own events ----------------------------------
-- A five-helmet booking wrote seven audit rows: its reservation, five
-- blocks and the 'reserve' event, which already names the five units. The
-- block rows go. A trigger's WHEN can't read OLD on insert or NEW on delete,
-- so the one trigger becomes three. Downtime and transfers are audited as
-- before; so is every reservation row.

drop trigger unit_blocks_audit on platform.unit_blocks;

create trigger unit_blocks_audit_insert
after insert on platform.unit_blocks
for each row when (new.kind not in ('allocation', 'hold'))
execute function platform_private.audit_row();

create trigger unit_blocks_audit_update
after update on platform.unit_blocks
for each row when (
  old.kind not in ('allocation', 'hold') or new.kind not in ('allocation', 'hold')
)
execute function platform_private.audit_row();

create trigger unit_blocks_audit_delete
after delete on platform.unit_blocks
for each row when (old.kind not in ('allocation', 'hold'))
execute function platform_private.audit_row();

-- 4. Deleting a unit takes its lock, without waiting --------------------------------------------
-- A delete of several units in one statement locks their rows in whatever
-- order it finds them, and could cross a booking that picked two of them.
--
-- The trigger can't wait for the lock. Postgres locks the row before a
-- "before delete" trigger runs, so a delete that waited here would hold the
-- unit's row and wait for its advisory lock, while a booking holds the
-- advisory lock and waits for the row: the opposite of the lock order, and a
-- deadlock every time (tried, on a scratch table). So it asks once. If
-- anything is writing this unit's bookings or downtime at this moment the
-- delete is refused with unit_busy and can be sent again; it has waited for
-- nothing, so it can be part of no cycle.
--
-- The stock functions that delete units hold these locks already
-- (lock_units), and asking again inside the same transaction succeeds.
-- Named to fire before units_clear_downtime.

create function platform_private.units_busy_on_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not pg_try_advisory_xact_lock(x'1a01'::int, hashtext(old.id::text)) then
    raise exception 'unit_busy' using errcode = '55P03';
  end if;
  return old;
end;
$$;

revoke all on function platform_private.units_busy_on_delete() from public, anon, authenticated;

create trigger units_busy_on_delete
before delete on platform.units
for each row execute function platform_private.units_busy_on_delete();

-- 5. The availability rule ----------------------------------------------------------------------
-- As it stood (20261116000100), plus:
--   * a hold that has run out holds nothing, whether or not the sweep has
--     removed its block yet, so a hold that ran out a second ago never
--     refuses a booking and never lowers the free count;
--   * the overdue rule (§3.5): a unit whose reservation is 'out' and past
--     its end is not free for any window until it is checked in.

create or replace function platform_private.free_units(
  p_product_id uuid,
  p_location_id uuid,
  p_period tstzrange
)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select u.id
  from platform.units u
  where u.product_id = p_product_id
    and u.location_id = p_location_id
    and u.status = 'active'
    and not exists (
      select 1 from platform.unit_blocks b
      where b.unit_id = u.id and b.period && p_period
        and not (
          b.kind = 'hold'
          and exists (
            select 1 from platform.reservations r
            where r.id = b.reservation_id
              and r.state = 'held' and r.hold_expires_at <= now()
          )
        )
    )
    and not exists (
      select 1
      from platform.unit_blocks b
      join platform.reservations r on r.id = b.reservation_id
      where b.unit_id = u.id and r.state = 'out' and r.ends_at < now()
    );
$$;

revoke all on function platform_private.free_units(uuid, uuid, tstzrange) from public, anon;
grant execute on function platform_private.free_units(uuid, uuid, tstzrange)
  to authenticated, service_role;

-- 6. Shortage demand ----------------------------------------------------------------------------
-- With overbooking on, staff can save a reservation for more units than are
-- free; what is missing is its shortage. Those units are owed: the largest
-- total owed at any one moment of the window is taken off what is free, so a
-- later booking can't take a unit a short reservation is waiting for. The
-- total can only rise where a short reservation starts, so those moments
-- (and the window's own start) are the only ones looked at.

create function platform_private.shortage_demand(
  p_product_id uuid,
  p_location_id uuid,
  p_period tstzrange
)
returns integer
language sql
stable
set search_path = ''
as $$
  with short as (
    select r.block_period, r.shortage
    from platform.reservations r
    where r.product_id = p_product_id
      and r.location_id = p_location_id
      and r.shortage > 0
      and (r.state = 'reserved' or (r.state = 'held' and r.hold_expires_at > now()))
      and r.block_period && p_period
  )
  select coalesce(max((
    select sum(o.shortage)
    from short o
    where o.block_period @> greatest(lower(s.block_period), lower(p_period))
  )), 0)::integer
  from short s;
$$;

revoke all on function platform_private.shortage_demand(uuid, uuid, tstzrange) from public, anon;
grant execute on function platform_private.shortage_demand(uuid, uuid, tstzrange)
  to authenticated, service_role;

-- 7. Holds: when one runs out, and what releasing it does ---------------------------------------
-- A number of minutes after a moment. Minutes on a timestamptz are elapsed
-- time, whatever the session's or the shop's time zone and whatever the
-- clocks do in between (a test holds this across both New York changes).

create function platform_private.hold_expiry(p_from timestamptz, p_minutes integer)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select p_from + make_interval(mins => p_minutes);
$$;

revoke all on function platform_private.hold_expiry(timestamptz, integer)
  from public, anon, authenticated;

-- Releases the holds that had run out at p_now on the given (product, place)
-- pairs: their blocks are deleted and their rows say 'expired'. The caller
-- holds the product locks of those pairs, and is past every other lock it
-- will take. One 'expire' event for each booking it releases rows of: a
-- booking whose rows are on different products can be released in two
-- calls, and then has two, each naming its rows. Answers how many rows.
-- p_tenant_id null: every shop (the job).
--
-- A hold is on these pairs when its reservation names one, or when one of
-- its blocks is on a unit that is there now, whatever its reservation names
-- (move_unit() keeps the two the same; this covers a unit that got there
-- any other way). Such a hold is not under a lock the caller holds, so its
-- rows are locked first, in id order, and read again before anything goes:
-- reservations, then blocks, as cancel_reservation() takes them.

create function platform_private.expire_holds(
  p_tenant_id uuid,
  p_product_ids uuid[],
  p_location_ids uuid[],
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking record;
  v_count integer := 0;
begin
  for v_booking in
    select r.tenant_id, r.booking_id, array_agg(r.id order by r.id) as ids
    from platform.reservations r
    where r.state = 'held'
      and r.hold_expires_at <= p_now
      and (p_tenant_id is null or r.tenant_id = p_tenant_id)
      and (
        exists (
          select 1 from unnest(p_product_ids, p_location_ids) t(product_id, location_id)
          where t.product_id = r.product_id and t.location_id = r.location_id
        )
        or exists (
          select 1
          from platform.unit_blocks b
          join platform.units u on u.id = b.unit_id
          join unnest(p_product_ids, p_location_ids) t(product_id, location_id)
            on t.product_id = u.product_id and t.location_id = u.location_id
          where b.reservation_id = r.id
        )
      )
    group by r.tenant_id, r.booking_id
    order by r.booking_id
  loop
    perform 1 from platform.reservations r
    where r.id = any (v_booking.ids)
    order by r.id
    for update;
    select coalesce(array_agg(r.id order by r.id), '{}') into v_booking.ids
    from platform.reservations r
    where r.id = any (v_booking.ids)
      and r.state = 'held' and r.hold_expires_at <= p_now;
    continue when cardinality(v_booking.ids) = 0;

    perform platform_private.audit(
      v_booking.tenant_id, 'bookings', v_booking.booking_id::text, 'expire', null,
      jsonb_build_object(
        'reservation_ids', to_jsonb(v_booking.ids),
        'lines', (
          select jsonb_agg(
            jsonb_build_object(
              'reservation_id', i.id,
              'unit_ids', coalesce((
                select jsonb_agg(b.unit_id order by hashtext(b.unit_id::text), b.unit_id)
                from platform.unit_blocks b
                where b.reservation_id = i.id
              ), '[]'::jsonb))
            order by i.id)
          from unnest(v_booking.ids) i(id)
        )));
    delete from platform.unit_blocks b where b.reservation_id = any (v_booking.ids);
    update platform.reservations r set state = 'expired' where r.id = any (v_booking.ids);
    v_count := v_count + cardinality(v_booking.ids);
  end loop;
  return v_count;
end;
$$;

revoke all on function platform_private.expire_holds(uuid, uuid[], uuid[], timestamptz)
  from public, anon, authenticated;

-- availability() runs as whoever calls it, and the server calls it with the
-- service role for the online channels. So the service role may look into
-- this schema, and both callers may use the two parsers, which only read
-- their argument.
--
-- Until now the schema itself kept the service role out, so it did not
-- matter that fourteen older functions here were executable by PUBLIC (the
-- trigger functions and the first helpers, from before "revoke all from
-- public" was the rule). With the schema open they would all be the service
-- role's to call. PUBLIC loses them. Signed-in members keep, by their own
-- grants, the ones policies and functions call as them; nobody calls a
-- trigger function. What the service role can execute here is exactly what
-- is granted to it by name, and a test lists it.
revoke execute on function
  platform_private.audit_row(),
  platform_private.audit(uuid, text, text, text, jsonb, jsonb),
  platform_private.can_use_catalog(uuid, uuid),
  platform_private.check_timezone(),
  platform_private.is_platform_admin(),
  platform_private.locations_keep_default(),
  platform_private.my_role(uuid),
  platform_private.my_tenant_ids(platform.platform_role[]),
  platform_private.norm(text),
  platform_private.products_guard(),
  platform_private.set_updated_at(),
  platform_private.tenants_lock_currency(),
  platform_private.tenants_need_location(),
  platform_private.units_clamp_product_counts()
from public;
grant execute on function
  platform_private.audit(uuid, text, text, text, jsonb, jsonb),
  platform_private.can_use_catalog(uuid, uuid),
  platform_private.is_platform_admin(),
  platform_private.my_role(uuid),
  platform_private.my_tenant_ids(platform.platform_role[]),
  platform_private.norm(text)
to authenticated;

grant usage on schema platform_private to service_role;
grant execute on function platform_private.json_uuid(jsonb, text, text)
  to authenticated, service_role;
grant execute on function platform_private.json_time(jsonb, text, text)
  to authenticated, service_role;

-- 8. reserve() ----------------------------------------------------------------------------------
-- As it stood (20261116000100), plus:
--   * "hold": true in the request makes a hold: the rows are 'held' with
--     hold_expires_at (the shop's hold_minutes from now) and the blocks are
--     of kind 'hold'. confirm_hold() turns it into a reservation;
--   * the shortage rule. Shortage demand is taken off what is free. When a
--     line still can't get all its units: with the shop's allow_overbooking
--     on, a signed-in member's booking is saved with the units it could get
--     and shortage = the rest; otherwise 'unavailable', as before. Online
--     channels never create a shortage. A line that names its units never
--     does either: a named unit that is free but owed to a shortage answers
--     'unavailable';
--   * holds that have run out on these products are released before the
--     new rows are written, in the rows phase (see the header);
--   * after an exclusion or foreign-key violation the units that are now
--     taken join v_exclude, so the next attempt can't pick them again and a
--     line that named one answers 'unit_taken';
--   * the answer and the 'reserve' event carry each line's shortage, and a
--     hold's expiry.
--
-- p_request gains  "hold": true | false  (optional).
-- The answer gains "hold_expires_at" when it is a hold.

create or replace function platform.reserve(p_tenant_id uuid, p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_attempts constant integer := 3;
  v_service boolean := (select auth.role()) is not distinct from 'service_role';
  v_staff boolean;
  v_channel text;
  v_mode text;
  v_online boolean;
  v_key text;
  v_count integer;
  v_line jsonb;
  v_product record;
  v_i integer;
  v_parent bigint;
  v_id uuid;
  v_quantity bigint;
  v_units uuid[];
  -- One entry per line, in the order sent.
  v_product_ids uuid[] := '{}';
  v_location_ids uuid[] := '{}';
  v_types text[] := '{}';
  v_starts timestamptz[] := '{}';
  v_ends timestamptz[] := '{}';
  v_periods tstzrange[] := '{}';
  v_quantities integer[] := '{}';
  v_parents integer[] := '{}';
  -- The named units of every line, flat: v_named_unit[k] is named by line
  -- v_named_line[k].
  v_named_line integer[] := '{}';
  v_named_unit uuid[] := '{}';
  -- The units picked in one attempt, flat, the same way.
  v_pick_line integer[];
  v_pick_unit uuid[];
  v_pick_period tstzrange[];
  -- Picked, then found taken once their locks were held: left out next time.
  v_exclude uuid[] := '{}';
  v_stale uuid[];
  v_attempt integer;
  v_done boolean := false;
  v_refused_line integer;
  v_booking_id uuid := gen_random_uuid();
  v_reservation_ids uuid[];
  v_answer jsonb;
  -- A hold, and when it runs out.
  v_hold boolean := false;
  v_hold_minutes integer;
  v_expires timestamptz;
  -- The shortage rule: may this call save a line short, and by how much.
  v_overbook boolean := false;
  v_short integer[];
  v_free integer;
  v_demand integer;
begin
  -- 1. The caller, then the request -------------------------------------
  v_staff := platform_private.has_role(p_tenant_id, platform_private.booking_roles('reserve'));
  if not v_service and not v_staff then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed', 'line', null);
  end if;

  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key not in ('channel', 'mode', 'hold', 'lines') then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
  end loop;
  v_channel := p_request ->> 'channel';
  v_mode := p_request ->> 'mode';
  if jsonb_typeof(p_request -> 'channel') is distinct from 'string'
    or v_channel not in ('walk_in', 'phone', 'booking_page', 'marketplace', 'api')
    or jsonb_typeof(p_request -> 'mode') is distinct from 'string'
  then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_online := v_channel in ('booking_page', 'marketplace', 'api');
  if p_request ? 'hold' and jsonb_typeof(p_request -> 'hold') <> 'null' then
    if jsonb_typeof(p_request -> 'hold') <> 'boolean' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    v_hold := (p_request ->> 'hold')::boolean;
  end if;

  -- Online channels are the server's (the service role); the counter and
  -- the phone are a signed-in member's. Neither may use the other's.
  if (v_online and not v_service) or (not v_online and not v_staff) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed', 'line', null);
  end if;
  -- A request-mode booking holds no unit until the shop accepts it (3M).
  if (v_online and v_mode not in ('instant', 'now')) or (not v_online and v_mode <> 'staff') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- The shop's settings. Only a signed-in member's booking can be saved
  -- short; an online channel never creates a shortage.
  select t.allow_overbooking and not v_online, t.hold_minutes
  into v_overbook, v_hold_minutes
  from platform.tenants t
  where t.id = p_tenant_id;
  v_overbook := coalesce(v_overbook, false);
  if v_hold then
    v_expires := platform_private.hold_expiry(now(), v_hold_minutes);
  end if;

  if jsonb_typeof(p_request -> 'lines') is distinct from 'array'
    or jsonb_array_length(p_request -> 'lines') not between 1 and 50
  then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_request -> 'lines');

  for v_i in 1..v_count loop
    v_line := p_request -> 'lines' -> (v_i - 1);
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_line) loop
      if v_key not in (
        'product_id', 'location_id', 'starts_at', 'ends_at', 'quantity', 'parent', 'unit_ids'
      ) then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
    end loop;

    v_product_ids[v_i] := platform_private.json_uuid(v_line, 'product_id', 'invalid_request');
    v_location_ids[v_i] := platform_private.json_uuid(v_line, 'location_id', 'invalid_request');
    v_starts[v_i] := platform_private.json_time(v_line, 'starts_at', 'invalid_request');
    v_ends[v_i] := platform_private.json_time(v_line, 'ends_at', 'invalid_request');
    v_quantity := platform_private.json_whole(v_line, 'quantity', 'invalid_request');
    if v_product_ids[v_i] is null or v_location_ids[v_i] is null
      or v_starts[v_i] is null or v_ends[v_i] is null or v_ends[v_i] <= v_starts[v_i]
      or v_quantity is null or v_quantity not between 1 and 1000
    then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    v_quantities[v_i] := v_quantity;

    -- Not found, retired, or another shop's: the same answer.
    select p.id, p.type, p.tracking, p.buffer_before_minutes, p.buffer_after_minutes
    into v_product
    from platform.products p
    where p.id = v_product_ids[v_i] and p.tenant_id = p_tenant_id and p.retired_at is null;
    if not found then
      raise exception 'product_not_found' using errcode = 'P0001';
    end if;
    -- An item for sale is sold, not reserved.
    if v_product.type not in ('vehicle', 'gear', 'service') then
      raise exception 'not_reservable' using errcode = 'P0001';
    end if;
    v_types[v_i] := v_product.type;
    if not exists (
      select 1 from platform.locations l
      where l.id = v_location_ids[v_i] and l.tenant_id = p_tenant_id
    ) then
      raise exception 'location_not_found' using errcode = 'P0001';
    end if;

    -- The window, widened by the product's own buffers (vehicles only; the
    -- shop's default buffers join in stage 3).
    v_periods[v_i] := tstzrange(
      v_starts[v_i] - make_interval(mins => coalesce(v_product.buffer_before_minutes, 0)),
      v_ends[v_i] + make_interval(mins => coalesce(v_product.buffer_after_minutes, 0)),
      '[)');

    -- An extra: gear or a service, with an earlier vehicle line.
    v_parents[v_i] := 0;
    if v_line ? 'parent' and jsonb_typeof(v_line -> 'parent') <> 'null' then
      v_parent := platform_private.json_whole(v_line, 'parent', 'invalid_request') + 1;
      if v_parent >= v_i or v_product.type = 'vehicle' then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
      v_parents[v_i] := v_parent;
      if v_types[v_parents[v_i]] <> 'vehicle' then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
    end if;

    -- Named units: staff only, and only where a unit is a thing with a
    -- name (a vehicle, or gear tracked unit by unit). One per unit wanted.
    if v_line ? 'unit_ids' and jsonb_typeof(v_line -> 'unit_ids') <> 'null' then
      if v_online or v_product.tracking <> 'unit'
        or jsonb_typeof(v_line -> 'unit_ids') <> 'array'
        or jsonb_array_length(v_line -> 'unit_ids') <> v_quantity
      then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
      select array_agg(distinct platform_private.json_uuid(
        jsonb_build_object('id', e.value), 'id', 'invalid_request'))
      into v_units
      from jsonb_array_elements(v_line -> 'unit_ids') e;
      if cardinality(v_units) <> v_quantity or array_position(v_units, null) is not null then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
      -- Not this product's at this place, or another shop's: the same answer.
      if exists (
        select 1 from unnest(v_units) n
        where not exists (
          select 1 from platform.units u
          where u.id = n and u.tenant_id = p_tenant_id
            and u.product_id = v_product_ids[v_i] and u.location_id = v_location_ids[v_i]
        )
      ) then
        raise exception 'unit_not_found' using errcode = 'P0001';
      end if;
      v_named_unit := v_named_unit || v_units;
      v_named_line := v_named_line || array_fill(v_i, array[cardinality(v_units)]);
    end if;
  end loop;

  -- 2. The product-and-location locks of every line, sorted once --------
  perform platform_private.lock_products_stock(v_product_ids, v_location_ids);

  -- 4. Pick, lock the picked units, read again --------------------------
  -- No other booking of these products is picking now. A downtime write or
  -- a unit leaving the fleet holds only its unit's lock, so it can still
  -- land between the pick and the lock. Each attempt is a sub-transaction:
  -- when a picked unit turns out taken, undoing the attempt gives its unit
  -- locks back, and the next attempt takes its own in key order again.
  for v_attempt in 1..c_attempts loop
    v_pick_line := '{}';
    v_pick_unit := '{}';
    v_pick_period := '{}';
    v_stale := '{}';
    v_short := array_fill(0, array[v_count]);
    begin
      -- Named units first, so no other line's pick takes one of them.
      for v_i in 1..v_count loop
        select coalesce(array_agg(u), '{}') into v_units
        from unnest(v_named_unit, v_named_line) n(u, line)
        where n.line = v_i;
        continue when cardinality(v_units) = 0;
        if exists (
          select 1 from unnest(v_units) n
          where n = any (v_exclude)
            or n not in (
              select platform_private.free_units(
                v_product_ids[v_i], v_location_ids[v_i], v_periods[v_i])
            )
            or exists (
              select 1 from unnest(v_pick_unit, v_pick_period) t(u, period)
              where t.u = n and t.period && v_periods[v_i]
            )
        ) then
          return jsonb_build_object('ok', false, 'reason', 'unit_taken', 'line', v_i - 1);
        end if;
        -- Free, but owed to a reservation that is short: not this line's.
        v_demand := platform_private.shortage_demand(
          v_product_ids[v_i], v_location_ids[v_i], v_periods[v_i]);
        if v_demand > 0 then
          select count(*) into v_free
          from platform_private.free_units(
            v_product_ids[v_i], v_location_ids[v_i], v_periods[v_i]) f(id)
          where f.id <> all (v_exclude)
            and not exists (
              select 1 from unnest(v_pick_unit, v_pick_period) t(u, period)
              where t.u = f.id and t.period && v_periods[v_i]
            );
          if cardinality(v_units) > v_free - v_demand then
            return jsonb_build_object('ok', false, 'reason', 'unavailable', 'line', v_i - 1);
          end if;
        end if;
        v_pick_unit := v_pick_unit || v_units;
        v_pick_line := v_pick_line || array_fill(v_i, array[cardinality(v_units)]);
        v_pick_period := v_pick_period || array_fill(v_periods[v_i], array[cardinality(v_units)]);
      end loop;

      -- Then best fit: the unit whose previous block ends closest before
      -- this window; then the one whose next block starts soonest after;
      -- then the lower lock key. A unit with no earlier block sorts last,
      -- so long gaps stay whole.
      for v_i in 1..v_count loop
        continue when v_types[v_i] = 'service' or v_i = any (v_named_line);
        -- What is free, less what short reservations are waiting for: the
        -- ones saved already, and this call's own earlier lines.
        select count(*) into v_free
        from platform_private.free_units(
          v_product_ids[v_i], v_location_ids[v_i], v_periods[v_i]) f(id)
        where f.id <> all (v_exclude)
          and not exists (
            select 1 from unnest(v_pick_unit, v_pick_period) t(u, period)
            where t.u = f.id and t.period && v_periods[v_i]
          );
        v_demand := platform_private.shortage_demand(
            v_product_ids[v_i], v_location_ids[v_i], v_periods[v_i])
          + coalesce((
            select sum(v_short[j])
            from generate_series(1, v_count) j
            where j <> v_i
              and v_product_ids[j] = v_product_ids[v_i]
              and v_location_ids[j] = v_location_ids[v_i]
              and v_periods[j] && v_periods[v_i]
          ), 0);
        select coalesce(array_agg(x.id), '{}') into v_units
        from (
          select f.id
          from platform_private.free_units(
            v_product_ids[v_i], v_location_ids[v_i], v_periods[v_i]) f(id)
          left join lateral (
            select max(upper(b.period)) as ends
            from platform.unit_blocks b
            where b.unit_id = f.id and upper(b.period) <= lower(v_periods[v_i])
          ) before on true
          left join lateral (
            select min(lower(b.period)) as starts
            from platform.unit_blocks b
            where b.unit_id = f.id and lower(b.period) >= upper(v_periods[v_i])
          ) after on true
          where f.id <> all (v_exclude)
            and not exists (
              select 1 from unnest(v_pick_unit, v_pick_period) t(u, period)
              where t.u = f.id and t.period && v_periods[v_i]
            )
          order by before.ends desc nulls last, after.starts asc nulls last,
            hashtext(f.id::text), f.id
          limit least(v_quantities[v_i], greatest(v_free - v_demand, 0))
        ) x;
        if cardinality(v_units) < v_quantities[v_i] then
          if not v_overbook then
            return jsonb_build_object('ok', false, 'reason', 'unavailable', 'line', v_i - 1);
          end if;
          -- Overbooking: saved with the units it could get.
          v_short[v_i] := v_quantities[v_i] - cardinality(v_units);
        end if;
        v_pick_unit := v_pick_unit || v_units;
        v_pick_line := v_pick_line || array_fill(v_i, array[cardinality(v_units)]);
        v_pick_period := v_pick_period || array_fill(v_periods[v_i], array[cardinality(v_units)]);
      end loop;

      -- The unit locks of every line together, in key order.
      perform platform_private.lock_units(v_pick_unit);

      -- Then the picked units' rows, in id order, before any other row
      -- lock. Deleting a unit takes no advisory lock: it locks the unit's
      -- row and then the product's. A booking that held the product's row
      -- first and met the unit's row at its block insert could wait on such
      -- a delete while the delete waits on it. Here the booking holds no
      -- row lock yet, so it only waits; a unit deleted meanwhile is gone
      -- from the read below, and the booking picks again without it.
      perform 1 from platform.units u
      where u.id = any (v_pick_unit)
      order by u.id
      for key share;

      -- Under the locks: is each one still free?
      for v_i in 1..v_count loop
        select coalesce(array_agg(t.u), '{}') into v_units
        from unnest(v_pick_unit, v_pick_line) t(u, line)
        where t.line = v_i
          and t.u not in (
            select platform_private.free_units(
              v_product_ids[v_i], v_location_ids[v_i], v_periods[v_i])
          );
        continue when cardinality(v_units) = 0;
        if v_i = any (v_named_line) then
          return jsonb_build_object('ok', false, 'reason', 'unit_taken', 'line', v_i - 1);
        end if;
        v_refused_line := coalesce(v_refused_line, v_i);
        v_stale := v_stale || v_units;
      end loop;
      if cardinality(v_stale) > 0 then
        -- Plain variables keep their values when the attempt is undone.
        v_exclude := v_exclude || v_stale;
        raise exception 'pick_again' using errcode = 'RSV01';
      end if;

      -- Rows, after every advisory lock: the products' rows in id order.
      -- None was retired meanwhile.
      perform 1 from platform.products p
      where p.id = any (v_product_ids)
      order by p.id
      for share;
      if exists (
        select 1 from unnest(v_product_ids) i
        where not exists (
          select 1 from platform.products p
          where p.id = i and p.tenant_id = p_tenant_id and p.retired_at is null
        )
      ) then
        raise exception 'product_not_found' using errcode = 'P0001';
      end if;

      -- 3. Holds that have run out on these products are released. The
      -- pick did not count them; their blocks must be gone before the
      -- constraint sees the new ones.
      perform platform_private.expire_holds(p_tenant_id, v_product_ids, v_location_ids, now());

      -- 7. The reservations, then the blocks in sorted unit order. The
      -- exclusion constraint has the last word.
      v_reservation_ids := '{}';
      for v_i in 1..v_count loop
        insert into platform.reservations (
          tenant_id, booking_id, parent_id, product_id, product_type, location_id,
          starts_at, ends_at, block_period, quantity, shortage, channel, mode, state,
          hold_expires_at
        )
        values (
          p_tenant_id, v_booking_id,
          case when v_parents[v_i] > 0 then v_reservation_ids[v_parents[v_i]] end,
          v_product_ids[v_i], v_types[v_i], v_location_ids[v_i],
          v_starts[v_i], v_ends[v_i], v_periods[v_i], v_quantities[v_i], v_short[v_i],
          v_channel, v_mode, case when v_hold then 'held' else 'reserved' end,
          v_expires
        )
        returning id into v_id;
        v_reservation_ids[v_i] := v_id;
      end loop;

      insert into platform.unit_blocks (tenant_id, unit_id, kind, period, reservation_id)
      select p_tenant_id, t.u, case when v_hold then 'hold' else 'allocation' end,
        t.period, v_reservation_ids[t.line]
      from unnest(v_pick_unit, v_pick_period, v_pick_line) t(u, period, line)
      order by hashtext(t.u::text), t.u;

      v_done := true;
    exception
      when sqlstate 'RSV01' then
        null;
      when exclusion_violation or foreign_key_violation then
        -- Something reached a unit without its lock (a unit deleted, a block
        -- written past the guard). Nothing of this attempt is kept. The
        -- units that are taken now are left out of the next attempt, and a
        -- line that named one is answered unit_taken there.
        v_refused_line := coalesce(v_refused_line, 1);
        select coalesce(array_agg(distinct t.u), '{}') into v_stale
        from unnest(v_pick_unit, v_pick_period) t(u, period)
        where not exists (select 1 from platform.units u where u.id = t.u)
          or exists (
            select 1 from platform.unit_blocks b
            where b.unit_id = t.u and b.period && t.period
          );
        v_exclude := v_exclude || v_stale;
    end;
    exit when v_done;
  end loop;

  if not v_done then
    return jsonb_build_object(
      'ok', false, 'reason', 'unavailable', 'line', coalesce(v_refused_line, 1) - 1);
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'reservation_id', v_reservation_ids[l.i],
      'unit_ids', coalesce((
        select jsonb_agg(t.u order by hashtext(t.u::text), t.u)
        from unnest(v_pick_unit, v_pick_line) t(u, line)
        where t.line = l.i
      ), '[]'::jsonb),
      'shortage', v_short[l.i]
    )
    order by l.i
  )
  into v_answer
  from generate_series(1, v_count) l(i);

  -- 8. One audit event for the booking.
  perform platform_private.audit(
    p_tenant_id, 'bookings', v_booking_id::text, 'reserve', null,
    jsonb_build_object(
      'channel', v_channel,
      'mode', v_mode,
      'hold', v_hold,
      'hold_expires_at', v_expires,
      'lines', (
        select jsonb_agg(
          (v_answer -> (l.i - 1)) || jsonb_build_object(
            'product_id', v_product_ids[l.i],
            'location_id', v_location_ids[l.i],
            'starts_at', v_starts[l.i],
            'ends_at', v_ends[l.i],
            'quantity', v_quantities[l.i])
          order by l.i)
        from generate_series(1, v_count) l(i)
      )));

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'lines', v_answer)
    || case when v_hold then jsonb_build_object('hold_expires_at', v_expires) else '{}'::jsonb end;
exception
  when deadlock_detected then
    return jsonb_build_object('ok', false, 'reason', 'try_again', 'line', null);
end;
$$;

revoke all on function platform.reserve(uuid, jsonb) from public, anon;
grant execute on function platform.reserve(uuid, jsonb) to authenticated, service_role;

-- 9. cancel_reservation() -----------------------------------------------------------------------
-- As it stood (20261116000100), plus: the 'cancel' event names the units
-- each cancelled row held, now that their blocks are not audited row by row.

create or replace function platform.cancel_reservation(
  p_tenant_id uuid,
  p_booking_id uuid default null,
  p_reservation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_booking_id uuid;
  v_product_ids uuid[];
  v_location_ids uuid[];
  v_cancelled uuid[];
  v_lines jsonb;
begin
  if (select auth.role()) is distinct from 'service_role'
    and not platform_private.has_role(p_tenant_id, platform_private.booking_roles('cancel'))
  then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if (p_booking_id is null) = (p_reservation_id is null) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Not found, or another shop's: the same answer.
  select array_agg(r.id), min(r.booking_id::text)::uuid,
    array_agg(r.product_id), array_agg(r.location_id)
  into v_ids, v_booking_id, v_product_ids, v_location_ids
  from platform.reservations r
  where r.tenant_id = p_tenant_id
    and (
      r.booking_id = p_booking_id
      or r.id = p_reservation_id
      or r.parent_id = p_reservation_id
    );
  if v_ids is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Product locks, then unit locks, then rows.
  perform platform_private.lock_products_stock(v_product_ids, v_location_ids);
  -- The locks were chosen from what the rows named a moment ago. If a unit
  -- was moved meanwhile (move_unit) a row names another product or place
  -- now, or the booking has a new row: these are not the right locks.
  if exists (
    select 1 from platform.reservations r
    where r.tenant_id = p_tenant_id
      and (
        r.booking_id = p_booking_id
        or r.id = p_reservation_id
        or r.parent_id = p_reservation_id
      )
      and not exists (
        select 1 from unnest(v_ids, v_product_ids, v_location_ids) t(id, product_id, location_id)
        where t.id = r.id and t.product_id = r.product_id and t.location_id = r.location_id
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
  end if;
  perform platform_private.lock_units(array(
    select b.unit_id from platform.unit_blocks b where b.reservation_id = any (v_ids)
  ));

  perform 1 from platform.reservations r
  where r.id = any (v_ids)
  order by r.id
  for update;
  if exists (
    select 1 from platform.reservations r
    where r.id = any (v_ids) and r.state in ('out', 'returned')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
  end if;

  select coalesce(array_agg(r.id order by r.id), '{}') into v_cancelled
  from platform.reservations r
  where r.id = any (v_ids) and r.state in ('held', 'reserved');

  if cardinality(v_cancelled) > 0 then
    -- The units each row held, before its blocks go.
    select jsonb_agg(
      jsonb_build_object(
        'reservation_id', i.id,
        'unit_ids', coalesce((
          select jsonb_agg(b.unit_id order by hashtext(b.unit_id::text), b.unit_id)
          from platform.unit_blocks b
          where b.reservation_id = i.id
        ), '[]'::jsonb))
      order by i.id)
    into v_lines
    from unnest(v_cancelled) i(id);

    delete from platform.unit_blocks b
    where b.reservation_id = any (v_cancelled) and lower(b.period) >= now();
    update platform.unit_blocks b
    set period = tstzrange(lower(b.period), now(), '[)')
    where b.reservation_id = any (v_cancelled)
      and (upper_inf(b.period) or upper(b.period) > now());
    update platform.reservations r
    set state = 'cancelled', hold_expires_at = null
    where r.id = any (v_cancelled);

    perform platform_private.audit(
      p_tenant_id, 'bookings', v_booking_id::text, 'cancel', null,
      jsonb_build_object('reservation_ids', to_jsonb(v_cancelled), 'lines', v_lines));
  end if;

  return jsonb_build_object(
    'ok', true, 'booking_id', v_booking_id, 'reservation_ids', to_jsonb(v_cancelled));
exception
  when deadlock_detected then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
end;
$$;

revoke all on function platform.cancel_reservation(uuid, uuid, uuid) from public, anon;
grant execute on function platform.cancel_reservation(uuid, uuid, uuid)
  to authenticated, service_role;

-- 10. confirm_hold() ----------------------------------------------------------------------------
-- 'held' becomes 'reserved' and the blocks of kind 'hold' become
-- allocations: the same rows, the same units. A hold is confirmed by whoever
-- could have made it: a signed-in owner, manager or staff member for the
-- counter and the phone, the service role for the online channels. The same
-- locks in the same order as reserve().
--
-- Answers { "ok": true, "booking_id", "reservation_ids": [...] } (the rows
-- confirmed by this call; none when it was confirmed already) or
-- { "ok": false, "reason" } with reason not_allowed, not_found (also another
-- shop's), hold_expired (it ran out, released yet or not), not_held (a
-- booking that is cancelled, collected or returned) or try_again.

create function platform.confirm_hold(p_tenant_id uuid, p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service boolean := (select auth.role()) is not distinct from 'service_role';
  v_staff boolean;
  v_online boolean;
  v_ids uuid[];
  v_product_ids uuid[];
  v_location_ids uuid[];
  v_held uuid[];
begin
  v_staff := platform_private.has_role(p_tenant_id, platform_private.booking_roles('confirm'));
  if not v_service and not v_staff then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if p_booking_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Not found, or another shop's: the same answer.
  select array_agg(r.id), array_agg(r.product_id), array_agg(r.location_id),
    bool_or(r.channel in ('booking_page', 'marketplace', 'api'))
  into v_ids, v_product_ids, v_location_ids, v_online
  from platform.reservations r
  where r.tenant_id = p_tenant_id and r.booking_id = p_booking_id;
  if v_ids is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Online holds are the server's; the counter's are a member's.
  if (v_online and not v_service) or (not v_online and not v_staff) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  -- Product locks, then unit locks, then rows.
  perform platform_private.lock_products_stock(v_product_ids, v_location_ids);
  -- A unit moved meanwhile (move_unit): a row names another product or
  -- place now, or the booking has a new row. Not the right locks.
  if exists (
    select 1 from platform.reservations r
    where r.tenant_id = p_tenant_id and r.booking_id = p_booking_id
      and not exists (
        select 1 from unnest(v_ids, v_product_ids, v_location_ids) t(id, product_id, location_id)
        where t.id = r.id and t.product_id = r.product_id and t.location_id = r.location_id
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
  end if;
  perform platform_private.lock_units(array(
    select b.unit_id from platform.unit_blocks b where b.reservation_id = any (v_ids)
  ));
  perform 1 from platform.reservations r
  where r.id = any (v_ids)
  order by r.id
  for update;

  -- Under the locks: the sweep or a booking may have released it meanwhile.
  if exists (
    select 1 from platform.reservations r
    where r.id = any (v_ids)
      and (r.state = 'expired' or (r.state = 'held' and r.hold_expires_at <= now()))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'hold_expired');
  end if;

  select coalesce(array_agg(r.id order by r.id), '{}') into v_held
  from platform.reservations r
  where r.id = any (v_ids) and r.state = 'held';

  if cardinality(v_held) = 0 then
    if not exists (
      select 1 from platform.reservations r where r.id = any (v_ids) and r.state = 'reserved'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_held');
    end if;
  else
    update platform.unit_blocks b set kind = 'allocation'
    where b.reservation_id = any (v_held);
    update platform.reservations r
    set state = 'reserved', hold_expires_at = null
    where r.id = any (v_held);

    perform platform_private.audit(
      p_tenant_id, 'bookings', p_booking_id::text, 'confirm', null,
      jsonb_build_object('reservation_ids', to_jsonb(v_held)));
  end if;

  return jsonb_build_object(
    'ok', true, 'booking_id', p_booking_id, 'reservation_ids', to_jsonb(v_held));
exception
  when deadlock_detected then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
end;
$$;

revoke all on function platform.confirm_hold(uuid, uuid) from public, anon;
grant execute on function platform.confirm_hold(uuid, uuid) to authenticated, service_role;

-- assign_units() --------------------------------------------------------------------------------
-- For a reservation that has not been collected ('held' or 'reserved'):
--   * p_unit_ids left out: fills its shortage with the best-fitting free
--     units, as many as there are, up to the shortage;
--   * p_unit_ids given: the units it should hold from now on. Ones it has
--     and are not named are given back, named ones it lacks are taken. Never
--     fewer than it holds now, never more than its quantity. This is staff's
--     swap before pickup, and filling a shortage with a chosen unit.
-- Owner, manager and staff; not the service role. The same locks in the
-- same order as reserve(), and the same pick, lock, read again.
--
-- Answers { "ok": true, "reservation_id", "unit_ids", "added", "removed",
-- "shortage" } or { "ok": false, "reason" } with reason not_allowed,
-- not_found (also another shop's), not_assignable (cancelled, expired,
-- collected, returned, or a service), unit_taken (a named unit is not
-- free), unavailable (a shortage and no unit free) or try_again. A request
-- our own code could not have sent raises invalid_request or unit_not_found.

create function platform.assign_units(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_unit_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_attempts constant integer := 3;
  v_named boolean := p_unit_ids is not null;
  v_r platform.reservations%rowtype;
  v_wanted uuid[];
  v_current uuid[];
  v_add uuid[] := '{}';
  v_drop uuid[] := '{}';
  v_exclude uuid[] := '{}';
  v_stale uuid[];
  v_attempt integer;
  v_done boolean := false;
  v_after uuid[];
  v_locked_product uuid;
  v_locked_location uuid;
begin
  if not platform_private.has_role(p_tenant_id, platform_private.booking_roles('assign')) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if p_reservation_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Not found, or another shop's: the same answer.
  select * into v_r
  from platform.reservations r
  where r.tenant_id = p_tenant_id and r.id = p_reservation_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_r.product_type = 'service' then
    return jsonb_build_object('ok', false, 'reason', 'not_assignable');
  end if;

  if v_named then
    select coalesce(array_agg(distinct u), '{}') into v_wanted from unnest(p_unit_ids) u;
    if array_position(p_unit_ids, null) is not null
      or cardinality(v_wanted) <> cardinality(p_unit_ids)
      or cardinality(v_wanted) > v_r.quantity
      or not exists (
        select 1 from platform.products p where p.id = v_r.product_id and p.tracking = 'unit'
      )
    then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    -- Not this product's at this place, or another shop's: the same answer.
    if exists (
      select 1 from unnest(v_wanted) n
      where not exists (
        select 1 from platform.units u
        where u.id = n and u.tenant_id = p_tenant_id
          and u.product_id = v_r.product_id and u.location_id = v_r.location_id
      )
    ) then
      raise exception 'unit_not_found' using errcode = 'P0001';
    end if;
  end if;

  -- 1. The product-and-location lock.
  v_locked_product := v_r.product_id;
  v_locked_location := v_r.location_id;
  perform platform_private.lock_products_stock(
    array[v_locked_product], array[v_locked_location]);

  for v_attempt in 1..c_attempts loop
    begin
      -- Under the product lock nothing else writes this reservation.
      select * into v_r from platform.reservations r where r.id = p_reservation_id;
      -- Its unit was moved meanwhile (move_unit): it is another product's
      -- or place's row now, and this is not its lock.
      if v_r.product_id <> v_locked_product or v_r.location_id <> v_locked_location then
        return jsonb_build_object('ok', false, 'reason', 'try_again');
      end if;
      if v_r.state not in ('held', 'reserved')
        or (v_r.state = 'held' and v_r.hold_expires_at <= now())
      then
        return jsonb_build_object('ok', false, 'reason', 'not_assignable');
      end if;
      select coalesce(array_agg(b.unit_id), '{}') into v_current
      from platform.unit_blocks b
      where b.reservation_id = v_r.id;

      if v_named then
        if cardinality(v_wanted) < cardinality(v_current) then
          raise exception 'invalid_request' using errcode = '22023';
        end if;
        select coalesce(array_agg(u), '{}') into v_add
        from unnest(v_wanted) u where u <> all (v_current);
        select coalesce(array_agg(u), '{}') into v_drop
        from unnest(v_current) u where u <> all (v_wanted);
        if exists (
          select 1 from unnest(v_add) n
          where n = any (v_exclude)
            or n not in (
              select platform_private.free_units(
                v_r.product_id, v_r.location_id, v_r.block_period)
            )
        ) then
          return jsonb_build_object('ok', false, 'reason', 'unit_taken');
        end if;
      else
        -- Best fit, the rule reserve() picks by.
        select coalesce(array_agg(x.id), '{}') into v_add
        from (
          select f.id
          from platform_private.free_units(
            v_r.product_id, v_r.location_id, v_r.block_period) f(id)
          left join lateral (
            select max(upper(b.period)) as ends
            from platform.unit_blocks b
            where b.unit_id = f.id and upper(b.period) <= lower(v_r.block_period)
          ) before on true
          left join lateral (
            select min(lower(b.period)) as starts
            from platform.unit_blocks b
            where b.unit_id = f.id and lower(b.period) >= upper(v_r.block_period)
          ) after on true
          where f.id <> all (v_exclude)
          order by before.ends desc nulls last, after.starts asc nulls last,
            hashtext(f.id::text), f.id
          limit v_r.shortage
        ) x;
        if v_r.shortage > 0 and cardinality(v_add) = 0 then
          return jsonb_build_object('ok', false, 'reason', 'unavailable');
        end if;
      end if;

      -- 2. The unit locks: the ones it has and the ones it takes, together,
      -- in key order. Then the new units' rows, in id order, as reserve().
      perform platform_private.lock_units(v_current || v_add);
      perform 1 from platform.units u
      where u.id = any (v_add)
      order by u.id
      for key share;

      -- Under the locks: is each new one still free?
      select coalesce(array_agg(u), '{}') into v_stale
      from unnest(v_add) u
      where u not in (
        select platform_private.free_units(v_r.product_id, v_r.location_id, v_r.block_period)
      );
      if cardinality(v_stale) > 0 then
        if v_named then
          return jsonb_build_object('ok', false, 'reason', 'unit_taken');
        end if;
        v_exclude := v_exclude || v_stale;
        raise exception 'pick_again' using errcode = 'RSV01';
      end if;

      -- 3. Rows: the reservation, then its blocks.
      perform 1 from platform.reservations r where r.id = v_r.id for update;
      perform platform_private.expire_holds(
        p_tenant_id, array[v_r.product_id], array[v_r.location_id], now());

      delete from platform.unit_blocks b
      where b.reservation_id = v_r.id and b.unit_id = any (v_drop);
      insert into platform.unit_blocks (tenant_id, unit_id, kind, period, reservation_id)
      select p_tenant_id, u, case when v_r.state = 'held' then 'hold' else 'allocation' end,
        v_r.block_period, v_r.id
      from unnest(v_add) u
      order by hashtext(u::text), u;

      select coalesce(array_agg(b.unit_id order by hashtext(b.unit_id::text), b.unit_id), '{}')
      into v_after
      from platform.unit_blocks b
      where b.reservation_id = v_r.id;
      update platform.reservations r
      set shortage = r.quantity - cardinality(v_after)
      where r.id = v_r.id;

      v_done := true;
    exception
      when sqlstate 'RSV01' then
        null;
      when exclusion_violation or foreign_key_violation then
        select coalesce(array_agg(u), '{}') into v_stale
        from unnest(v_add) u
        where not exists (select 1 from platform.units x where x.id = u)
          or exists (
            select 1 from platform.unit_blocks b
            where b.unit_id = u and b.period && v_r.block_period
          );
        v_exclude := v_exclude || v_stale;
    end;
    exit when v_done;
  end loop;

  if not v_done then
    return jsonb_build_object(
      'ok', false, 'reason', case when v_named then 'unit_taken' else 'unavailable' end);
  end if;

  if cardinality(v_add) > 0 or cardinality(v_drop) > 0 then
    perform platform_private.audit(
      p_tenant_id, 'bookings', v_r.booking_id::text, 'assign', null,
      jsonb_build_object(
        'reservation_id', v_r.id,
        'added', to_jsonb(v_add),
        'removed', to_jsonb(v_drop),
        'unit_ids', to_jsonb(v_after),
        'shortage', v_r.quantity - cardinality(v_after)));
  end if;

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_r.id,
    'unit_ids', to_jsonb(v_after),
    'added', to_jsonb(v_add),
    'removed', to_jsonb(v_drop),
    'shortage', v_r.quantity - cardinality(v_after));
exception
  when deadlock_detected then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
end;
$$;

revoke all on function platform.assign_units(uuid, uuid, uuid[])
  from public, anon, service_role;
grant execute on function platform.assign_units(uuid, uuid, uuid[]) to authenticated;

-- 11. The sweep ---------------------------------------------------------------------------------
-- Releases every hold that has run out, in every shop: the product locks of
-- all of them, sorted once, then the rows. reserve() and assign_units() do
-- the same for the products they touch, and no read counts a hold that has
-- run out, so the job only tidies up; a run that Postgres ends to break a
-- deadlock leaves it to the next one. p_now and p_tenant_id are for tests.

create function platform_private.release_expired_holds(
  p_now timestamptz default now(),
  p_tenant_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_ids uuid[];
  v_location_ids uuid[];
begin
  select array_agg(x.product_id), array_agg(x.location_id)
  into v_product_ids, v_location_ids
  from (
    select distinct r.product_id, r.location_id
    from platform.reservations r
    where r.state = 'held' and r.hold_expires_at <= p_now
      and (p_tenant_id is null or r.tenant_id = p_tenant_id)
  ) x;
  if v_product_ids is null then
    return 0;
  end if;
  perform platform_private.lock_products_stock(v_product_ids, v_location_ids);
  return platform_private.expire_holds(p_tenant_id, v_product_ids, v_location_ids, p_now);
exception
  when deadlock_detected then
    return 0;
end;
$$;

revoke all on function platform_private.release_expired_holds(timestamptz, uuid)
  from public, anon, authenticated;

create function platform.release_expired_holds()
returns integer
language sql
security definer
set search_path = ''
as $$
  select platform_private.release_expired_holds();
$$;

revoke all on function platform.release_expired_holds() from public, anon, authenticated;
grant execute on function platform.release_expired_holds() to service_role;

-- Every minute with Supabase Cron (pg_cron), as the renewal job is. Where
-- the extension is not available nothing is lost but tidiness: bookings and
-- reads already leave out a hold that has run out.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'platform-release-expired-holds',
      '* * * * *',
      'select platform_private.release_expired_holds()'
    );
  else
    raise notice 'pg_cron is not available: expired holds are released by the next booking, not on a schedule';
  end if;
end;
$$;

-- 12. availability(): the read ------------------------------------------------------------------
-- The most Moto Mangos advance bookings holding a unit of a product at any
-- one moment of a window, and the most of each kind: what listingOffer() in
-- @mango/core needs. "Ride today" (mode 'now') does not count against the
-- cap. Runs as the caller.

create function platform_private.marketplace_peaks(p_product_id uuid, p_period tstzrange)
returns table (held integer, instant integer, request integer)
language sql
stable
set search_path = ''
as $$
  with mm as (
    select r.block_period, r.mode, r.quantity
    from platform.reservations r
    where r.product_id = p_product_id
      and r.channel = 'marketplace'
      and r.mode in ('instant', 'request')
      and (r.state in ('reserved', 'out')
        or (r.state = 'held' and r.hold_expires_at > now()))
      and r.block_period && p_period
  ),
  points as (
    select lower(p_period) as t
    union
    select lower(m.block_period) from mm m where lower(m.block_period) > lower(p_period)
  ),
  at_point as (
    select p.t,
      coalesce(sum(m.quantity) filter (where m.mode = 'instant'), 0) as instant,
      coalesce(sum(m.quantity) filter (where m.mode = 'request'), 0) as request
    from points p
    left join mm m on m.block_period @> p.t
    group by p.t
  )
  select coalesce(max(a.instant + a.request), 0)::integer,
    coalesce(max(a.instant), 0)::integer,
    coalesce(max(a.request), 0)::integer
  from at_point a;
$$;

revoke all on function platform_private.marketplace_peaks(uuid, tstzrange) from public, anon;
grant execute on function platform_private.marketplace_peaks(uuid, tstzrange)
  to authenticated, service_role;

-- p_items: [ { "product_id", "location_id", "starts_at", "ends_at" } ]
-- Answers one object per item, in the order sent:
--   { "product_id", "location_id", "type",
--     "stock"            units in use at that place (not in repair, sold,
--                        retired or lost); an item for sale: what the ledger
--                        has on hand;
--     "free"             of those, free for the whole window (widened by the
--                        product's buffers, as reserve() widens it);
--     "shortage_demand"  units owed to reservations that are short;
--     "available"        max(0, free - shortage_demand);
--     "unlimited"        true for a service: nothing to count, the numbers
--                        are null;
--     "marketplace"      null, or for a product with a listing
--                        { "enabled", "instant_units", "request_units",
--                          "mm_held", "mm_instant", "mm_request" } }
-- It runs as the caller under RLS, takes no lock and touches no money.
-- Every member of the shop, and the service role (the server, for online
-- channels). Another shop's product or place is answered exactly like one
-- that does not exist: product_not_found, location_not_found.

create function platform.availability(p_tenant_id uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_key text;
  v_i integer;
  v_product record;
  v_product_id uuid;
  v_location_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_period tstzrange;
  v_stock integer;
  v_free integer;
  v_demand integer;
  v_listing jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    if not platform_private.has_role(p_tenant_id, platform_private.booking_roles('read')) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 200
  then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  for v_i in 0..jsonb_array_length(p_items) - 1 loop
    v_item := p_items -> v_i;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_item) loop
      if v_key not in ('product_id', 'location_id', 'starts_at', 'ends_at') then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
    end loop;
    v_product_id := platform_private.json_uuid(v_item, 'product_id', 'invalid_request');
    v_location_id := platform_private.json_uuid(v_item, 'location_id', 'invalid_request');
    v_start := platform_private.json_time(v_item, 'starts_at', 'invalid_request');
    v_end := platform_private.json_time(v_item, 'ends_at', 'invalid_request');
    if v_product_id is null or v_location_id is null
      or v_start is null or v_end is null or v_end <= v_start
    then
      raise exception 'invalid_request' using errcode = '22023';
    end if;

    -- Not found, retired, or another shop's: the same answer.
    select p.id, p.type, p.buffer_before_minutes, p.buffer_after_minutes
    into v_product
    from platform.products p
    where p.id = v_product_id and p.tenant_id = p_tenant_id and p.retired_at is null;
    if not found then
      raise exception 'product_not_found' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from platform.locations l
      where l.id = v_location_id and l.tenant_id = p_tenant_id
    ) then
      raise exception 'location_not_found' using errcode = 'P0001';
    end if;

    -- The window as reserve() widens it.
    v_period := tstzrange(
      v_start - make_interval(mins => coalesce(v_product.buffer_before_minutes, 0)),
      v_end + make_interval(mins => coalesce(v_product.buffer_after_minutes, 0)),
      '[)');

    v_stock := null;
    v_free := null;
    v_demand := 0;
    if v_product.type = 'sale_item' then
      -- Sold, not reserved: what the ledger has on hand.
      select coalesce(sum(m.quantity), 0)::integer into v_stock
      from platform.stock_movements m
      where m.product_id = v_product_id and m.location_id = v_location_id;
      v_free := v_stock;
    elsif v_product.type <> 'service' then
      select count(*)::integer into v_stock
      from platform.units u
      where u.product_id = v_product_id and u.location_id = v_location_id
        and u.status = 'active';
      select count(*)::integer into v_free
      from platform_private.free_units(v_product_id, v_location_id, v_period);
      v_demand := platform_private.shortage_demand(v_product_id, v_location_id, v_period);
    end if;

    select jsonb_build_object(
      'enabled', l.enabled,
      'instant_units', l.instant_units,
      'request_units', l.request_units,
      'mm_held', k.held,
      'mm_instant', k.instant,
      'mm_request', k.request)
    into v_listing
    from platform.product_listings l
    cross join lateral platform_private.marketplace_peaks(l.product_id, v_period) k
    where l.product_id = v_product_id;
    if not found then
      v_listing := null;
    end if;

    v_out := v_out || jsonb_build_object(
      'product_id', v_product_id,
      'location_id', v_location_id,
      'type', v_product.type,
      'stock', v_stock,
      'free', v_free,
      'shortage_demand', v_demand,
      'available', case when v_free is not null then greatest(v_free - v_demand, 0) end,
      'unlimited', v_product.type = 'service',
      'marketplace', v_listing);
  end loop;
  return v_out;
end;
$$;

revoke all on function platform.availability(uuid, jsonb) from public, anon;
grant execute on function platform.availability(uuid, jsonb) to authenticated, service_role;

-- 13. Moving a unit that has bookings -----------------------------------------------------------
-- units_guard as it stood (20261114000100, from the database), plus one
-- check: a unit can't change its product or its place while a booking that
-- has not ended names where it was.

create or replace function platform_private.units_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role platform.platform_role;
  v_free text[] := array['current_odometer_km', 'status', 'updated_at'];
begin
  if new.product_type = 'gear' then
    v_free := v_free || array['problem_on', 'expected_back', 'problem_notes'];
  end if;

  if (select auth.uid()) is not null then
    v_role := platform_private.my_role(new.tenant_id);
    if v_role is null or v_role not in ('owner', 'manager') then
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

  -- Selling or retiring: its future blocks must be moved or ended first.
  if new.status in ('sold', 'retired') and old.status not in ('sold', 'retired') then
    -- Wait for anyone writing this bike's blocks right now (same lock as
    -- unit_blocks_guard), so the check below sees what they saved.
    perform pg_advisory_xact_lock(x'1a01'::int, hashtext(new.id::text));
    if exists (
      select 1 from platform.unit_blocks b
      where b.unit_id = new.id and (upper_inf(b.period) or upper(b.period) > now())
    ) then
      raise exception 'unit_has_future_blocks' using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'lost' and old.status <> 'lost' then
    perform pg_advisory_xact_lock(x'1a01'::int, hashtext(new.id::text));
    if exists (
      select 1 from platform.unit_blocks b
      where b.unit_id = new.id
        and b.kind <> 'downtime'
        and (upper_inf(b.period) or upper(b.period) > now())
    ) then
      raise exception 'unit_has_future_blocks' using errcode = 'P0001';
    end if;
    delete from platform.unit_blocks b
    where b.unit_id = new.id and b.kind = 'downtime' and lower(b.period) >= now();
    update platform.unit_blocks b
    set period = tstzrange(lower(b.period), now(), '[)')
    where b.unit_id = new.id and b.kind = 'downtime'
      and (upper_inf(b.period) or upper(b.period) > now());
    new.expected_back := null;
  end if;

  -- Another product or another place: its bookings must be there already.
  -- move_unit() takes them there first; a change made any other way is
  -- refused while a booking still names where the unit was. It reads the
  -- unit's blocks, so it waits for anyone writing them (the same lock).
  if new.product_id <> old.product_id or new.location_id <> old.location_id then
    perform pg_advisory_xact_lock(x'1a01'::int, hashtext(new.id::text));
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
$$;

-- A trigger function: nobody calls it.
revoke all on function platform_private.units_guard() from public, anon, authenticated;

-- move_unit() -----------------------------------------------------------------------------------
-- The one way a unit that has bookings changes its product or its place
-- (the owner, 16 Nov 2026: a move stays allowed, and the bookings move with
-- the unit). Every reservation that is 'held', 'reserved' or 'out' and has a
-- block on the unit that has not ended takes the new product and place. A
-- row for several units is split: the moved unit's part becomes a row of its
-- own for one unit, with the same booking id. One 'move' event per booking.
-- The price does not move: Phase 3's order line keeps what was sold.
--
-- Locks, in the one order: the product-and-location locks of where the unit
-- is, where it goes and whatever its bookings name, sorted once; the unit's
-- lock; then rows: the unit, the two products, the reservations, the blocks.
--
-- Two places where it must not wait in the usual way:
--   * the unit's row is taken without waiting. A direct update of a unit
--     (its status, its product) locks the row first and the unit's lock
--     second, in the unit's guard; this function holds the lock by then. If
--     it waited for the row, each would wait for the other. It asks once
--     and answers try_again.
--   * the products' rows are taken "for no key update", the strength the
--     unit's own update needs at the end (the trigger that keeps a listing's
--     counts within the fleet). Taken "for share" first, two moves of units
--     of one product at two places would each hold share and each wait to
--     raise it.
--
-- p_details: the rest of the vehicle's Details form (plate, plate_pending,
-- frame_number, engine_number, colour, model_year, notes,
-- current_odometer_km), written by the same update that moves the unit, so
-- the form's save is one call: all of it or none of it.
--
-- p_expected_bookings: how many upcoming bookings the person was warned
-- about. If the unit has a different number now, nothing moves
-- (bookings_changed) and the screen asks again.
-- p_expected_updated_at: the unit as the form loaded it (stale otherwise).
--
-- Answers { "ok": true, "unit_id", "bookings", "reservation_ids",
-- "updated_at" } or { "ok": false, "reason" } with reason not_allowed,
-- bookings_changed, stale or try_again (someone is changing the unit, or
-- one of its bookings, at this moment). A request our own code could not
-- have sent raises invalid_request, unit_not_found, product_not_found or
-- location_not_found; another shop's is answered like one that does not
-- exist. Owner and manager, as for every other change to a unit's details;
-- and the service role.

create function platform.move_unit(
  p_tenant_id uuid,
  p_unit_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_expected_bookings integer default null,
  p_expected_updated_at timestamptz default null,
  p_details jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if (select auth.role()) is distinct from 'service_role'
    and not platform_private.has_role(
      p_tenant_id, '{owner,manager}'::platform.platform_role[])
  then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
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
  -- guard finds every booking already where it is going. Anything this
  -- refuses (a plate another vehicle has, say) undoes the whole call.
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
    return jsonb_build_object('ok', false, 'reason', 'try_again');
end;
$$;

revoke all on function
  platform.move_unit(uuid, uuid, uuid, uuid, integer, timestamptz, jsonb)
  from public, anon;
grant execute on function
  platform.move_unit(uuid, uuid, uuid, uuid, integer, timestamptz, jsonb)
  to authenticated, service_role;
