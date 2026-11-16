-- Phase 2, stage 1: the booking core (docs/phase-2-plan.md §2.1, §3.1 to §3.4,
-- §4, §8 stage 1; the owner's answers in §10).
--
-- Builds on the migrations before it, none of which is touched.
--
-- 1. platform.reservations: "N units of one product at one place for one
--    window". The stock side of a booking until orders exist (Phase 3). It
--    holds no money and no customer. RLS on, grants written on purpose.
-- 2. platform.unit_blocks.reservation_id: an allocation or a hold belongs to
--    a reservation; downtime (and a transfer) to none.
-- 3. unit_blocks.created_by is set in the database from auth.uid() and can
--    no longer be sent or changed by a signed-in person.
-- 4. platform_private.unit_blocks_guard re-created: a block moved from one
--    unit to another takes the two unit locks in key order (lock_units), not
--    in UUID order. Its body is today's, read from the database, with that
--    one change and the created_by line.
-- 5. platform_private.booking_roles(): who may read, reserve and cancel.
-- 6. platform_private.lock_products_stock(): the product-and-location locks
--    of a whole booking, sorted once.
-- 7. platform_private.free_units(): the availability rule.
-- 8. platform.reserve() and platform.cancel_reservation().
--
-- Not in this stage: holds and their expiry, overbooking and the shortage
-- rule, the overdue rule, the availability read (stage 2); the Moto Mangos
-- cap (stage 3); coupons (stage 8).
--
-- Lock order, for every writer (§4):
--   1. product-and-location advisory locks (namespace 1a02), sorted by key;
--   2. unit advisory locks (namespace 1a01), sorted by key;
--   3. rows: the product's row (for share), in product-id order, then
--      reservations, then unit_blocks.
--
-- The stock functions that ask "does a booking hold this unit" were read
-- again against the new column (set_stock_quantity, report_gear_problem,
-- resolve_unit_problem, product_stock, gear_unit_state, upcoming_bookings,
-- units_guard, units_clear_downtime). Each asks by the block's kind or
-- period, never by who made it, so none changes.

-- 1. reservations ---------------------------------------------------------------------------

create table platform.reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  -- Rows made in one call share it. Phase 3's order takes it over.
  booking_id uuid not null,
  -- A gear or service row offered with a vehicle: its vehicle row.
  parent_id uuid,
  product_id uuid not null,
  product_type text not null
    constraint reservations_product_type_check
    check (product_type in ('vehicle', 'gear', 'service')),
  -- The pickup place. The return place is the same until multi-location.
  location_id uuid not null,
  -- The rental itself.
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- The rental widened by the buffers in force when it was made. A later
  -- change to a product's buffers does not move it.
  block_period tstzrange not null,
  quantity integer not null
    constraint reservations_quantity_check check (quantity between 1 and 1000),
  -- Units still not assigned (overbooking only, stage 2).
  shortage integer not null default 0,
  channel text not null
    constraint reservations_channel_check
    check (channel in ('walk_in', 'phone', 'booking_page', 'marketplace', 'api')),
  mode text not null
    constraint reservations_mode_check
    check (mode in ('staff', 'instant', 'request', 'now')),
  -- 'held' and 'reserved' are written in Phase 2; 'out' and 'returned' by
  -- Phases 3 and 5.
  state text not null
    constraint reservations_state_check
    check (state in ('held', 'reserved', 'out', 'returned', 'cancelled', 'expired')),
  hold_expires_at timestamptz,
  -- Who made it: set here, never sent. Empty for the service role.
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_tenant_id_id_key unique (tenant_id, id),
  constraint reservations_times_check check (ends_at > starts_at),
  constraint reservations_block_period_check check (
    not isempty(block_period)
    and lower_inc(block_period) and not upper_inc(block_period)
    and block_period @> tstzrange(starts_at, ends_at, '[)')
  ),
  constraint reservations_shortage_check check (shortage between 0 and quantity),
  constraint reservations_hold_check check (
    (state <> 'held' or hold_expires_at is not null)
    and (hold_expires_at is null or state in ('held', 'expired'))
  ),
  constraint reservations_parent_check check (parent_id is null or product_type <> 'vehicle'),
  foreign key (tenant_id, product_id, product_type)
    references platform.products (tenant_id, id, type),
  foreign key (tenant_id, location_id)
    references platform.locations (tenant_id, id),
  foreign key (tenant_id, parent_id)
    references platform.reservations (tenant_id, id)
);

create index reservations_booking_idx on platform.reservations (tenant_id, booking_id);
create index reservations_product_idx
  on platform.reservations (tenant_id, product_id, location_id);
create index reservations_parent_idx on platform.reservations (parent_id)
  where parent_id is not null;

alter table platform.reservations enable row level security;

-- Every member reads (dates, product, units; a reservation holds no money).
-- No insert, update or delete for a signed-in person: a booking is made and
-- changed through the functions below, which take the locks first.
grant select on platform.reservations to authenticated;
grant select, insert, update, delete on platform.reservations to service_role;

create trigger reservations_set_updated_at
before update on platform.reservations
for each row execute function platform_private.set_updated_at();

create trigger reservations_audit
after insert or update or delete on platform.reservations
for each row execute function platform_private.audit_row();

-- 5. Who may do what (before the policy that reads it) --------------------------------------
-- The real rule. apps/platform/lib/booking-permissions.ts is its copy, and a
-- database test compares the two.

create function platform_private.booking_roles(p_action text)
returns platform.platform_role[]
language sql
immutable
set search_path = ''
as $$
  select (case p_action
    when 'read' then '{owner,manager,staff,mechanic,driver}'
    when 'reserve' then '{owner,manager,staff}'
    when 'cancel' then '{owner,manager,staff}'
    else '{}'
  end)::platform.platform_role[];
$$;

revoke all on function platform_private.booking_roles(text) from public, anon;
grant execute on function platform_private.booking_roles(text) to authenticated;

create policy "Members read reservations"
on platform.reservations for select to authenticated
using (
  tenant_id = any (
    (select platform_private.my_tenant_ids(platform_private.booking_roles('read')))::uuid[]
  )
);

-- 2. unit_blocks.reservation_id -------------------------------------------------------------
-- No action rather than "restrict": a reservation can't be deleted while a
-- block points at it, and a whole tenant can still be deleted in one
-- statement (restrict would refuse before the blocks are gone).

alter table platform.unit_blocks
  add column reservation_id uuid,
  add constraint unit_blocks_tenant_id_reservation_id_fkey
    foreign key (tenant_id, reservation_id)
    references platform.reservations (tenant_id, id),
  add constraint unit_blocks_reservation_check
    check ((kind in ('allocation', 'hold')) = (reservation_id is not null));

create index unit_blocks_reservation_idx on platform.unit_blocks (reservation_id)
  where reservation_id is not null;

-- 3. created_by can't be sent or changed ----------------------------------------------------
-- The guard (4) writes it on insert. A signed-in person may change a
-- downtime block's unit, period and note, and nothing else.

revoke update on platform.unit_blocks from authenticated;
grant update (unit_id, period, note) on platform.unit_blocks to authenticated;

-- 4. The block guard ------------------------------------------------------------------------
-- Today's body from the database (pg_get_functiondef), with two changes:
--   * a block moved to another unit takes both unit locks through
--     lock_units(), which orders by the lock's own key (hashtext of the id).
--     It ordered by UUID, which can cross with every other taker of two
--     unit locks;
--   * created_by is whoever is signed in.

create or replace function platform_private.unit_blocks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved boolean := tg_op = 'UPDATE' and new.unit_id <> old.unit_id;
begin
  if tg_op = 'INSERT' then
    -- Whoever is signed in, never what was sent. Empty for the service role.
    new.created_by := (select auth.uid());
  end if;

  -- Namespace 1a01 keeps this apart from any other advisory lock.
  if v_moved then
    -- Two bikes: always in the order of the locks' own keys, as everywhere.
    perform platform_private.lock_units(array[old.unit_id, new.unit_id]);
  else
    perform pg_advisory_xact_lock(x'1a01'::int, hashtext(new.unit_id::text));
  end if;

  -- A new block, a block moved to another bike, or a period that now covers
  -- time it didn't before: the bike must be in the fleet. Shortening a block
  -- (ending it) stays possible on any bike.
  if (tg_op = 'INSERT' or v_moved or not new.period <@ old.period)
    and exists (
      select 1 from platform.units
      where id = new.unit_id and status in ('sold', 'retired', 'lost')
    )
  then
    raise exception 'unit_not_in_fleet' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- A trigger function: nobody calls it.
revoke all on function platform_private.unit_blocks_guard() from public, anon, authenticated;

-- 6. The locks of a whole booking -----------------------------------------------------------
-- lock_product_stock() sorts one product's places. A booking can name
-- several products, so this sorts every (product, place) pair once, by the
-- same key. p_product_ids[i] goes with p_location_ids[i].

create function platform_private.lock_products_stock(
  p_product_ids uuid[],
  p_location_ids uuid[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_key integer;
begin
  for v_key in
    select distinct hashtext(t.product_id::text || ':' || t.location_id::text)
    from unnest(p_product_ids, p_location_ids) t(product_id, location_id)
    where t.product_id is not null and t.location_id is not null
    order by 1
  loop
    perform pg_advisory_xact_lock(x'1a02'::int, v_key);
  end loop;
end;
$$;

-- Called only by the booking functions, which run as their owner.
revoke all on function platform_private.lock_products_stock(uuid[], uuid[])
  from public, anon, authenticated;

-- 7. The availability rule ------------------------------------------------------------------
-- The units of a product at a place that are free for the whole of a
-- (widened) window: in use, with no block of any kind overlapping it. Runs
-- as the caller. The overdue rule (a unit still out past its end) joins it
-- in stage 2.

create function platform_private.free_units(
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
    );
$$;

revoke all on function platform_private.free_units(uuid, uuid, tstzrange) from public, anon;
grant execute on function platform_private.free_units(uuid, uuid, tstzrange) to authenticated;

-- A time in a request: text with its offset written out, so nothing depends
-- on the session's time zone.

create function platform_private.json_time(p jsonb, p_key text, p_error text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  if not (p ? p_key) or jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  v_text := p ->> p_key;
  if jsonb_typeof(p -> p_key) <> 'string'
    or v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  then
    raise exception '%', p_error using errcode = '22023';
  end if;
  begin
    return v_text::timestamptz;
  exception when others then
    raise exception '%', p_error using errcode = '22023';
  end;
end;
$$;

revoke all on function platform_private.json_time(jsonb, text, text)
  from public, anon, authenticated;

-- 8. reserve() ------------------------------------------------------------------------------
-- The one way a booking takes stock, for staff and for online channels
-- alike. All lines or none.
--
-- p_request:
--   { "channel": "walk_in" | "phone" | "booking_page" | "marketplace" | "api",
--     "mode":    "staff" | "instant" | "now",
--     "lines": [ { "product_id", "location_id", "starts_at", "ends_at",
--                  "quantity",
--                  "parent":   index of an earlier vehicle line (optional),
--                  "unit_ids": the units to take (staff only, optional) } ] }
--
-- Answers
--   { "ok": true, "booking_id", "lines": [ { "reservation_id", "unit_ids",
--     "shortage" } ] }
-- or { "ok": false, "reason", "line" } and nothing written, with reason
--   not_allowed  the caller may not book through this channel in this shop;
--   unavailable  too few units free for the whole window;
--   unit_taken   a named unit is not free;
--   try_again    Postgres ended this call to break a deadlock (never seen in
--                the tests; the caller may send it once more).
-- A request that could not have come from our own code (a missing field, a
-- product, place or unit that is not this shop's) raises instead:
-- invalid_request, product_not_found, location_not_found, unit_not_found,
-- not_reservable. Another shop's thing is answered exactly like one that
-- does not exist.

create function platform.reserve(p_tenant_id uuid, p_request jsonb)
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
    if v_key not in ('channel', 'mode', 'lines') then
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

  -- Online channels are the server's (the service role); the counter and
  -- the phone are a signed-in member's. Neither may use the other's.
  if (v_online and not v_service) or (not v_online and not v_staff) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed', 'line', null);
  end if;
  -- A request-mode booking holds no unit until the shop accepts it (3M).
  if (v_online and v_mode not in ('instant', 'now')) or (not v_online and v_mode <> 'staff') then
    raise exception 'invalid_request' using errcode = '22023';
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
    begin
      -- Named units first, so no other line's pick takes one of them.
      for v_i in 1..v_count loop
        select coalesce(array_agg(u), '{}') into v_units
        from unnest(v_named_unit, v_named_line) n(u, line)
        where n.line = v_i;
        continue when cardinality(v_units) = 0;
        if exists (
          select 1 from unnest(v_units) n
          where n not in (
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
          limit v_quantities[v_i]
        ) x;
        if cardinality(v_units) < v_quantities[v_i] then
          return jsonb_build_object('ok', false, 'reason', 'unavailable', 'line', v_i - 1);
        end if;
        v_pick_unit := v_pick_unit || v_units;
        v_pick_line := v_pick_line || array_fill(v_i, array[cardinality(v_units)]);
        v_pick_period := v_pick_period || array_fill(v_periods[v_i], array[cardinality(v_units)]);
      end loop;

      -- The unit locks of every line together, in key order.
      perform platform_private.lock_units(v_pick_unit);

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

      -- 7. The reservations, then the blocks in sorted unit order. The
      -- exclusion constraint has the last word.
      v_reservation_ids := '{}';
      for v_i in 1..v_count loop
        insert into platform.reservations (
          tenant_id, booking_id, parent_id, product_id, product_type, location_id,
          starts_at, ends_at, block_period, quantity, shortage, channel, mode, state
        )
        values (
          p_tenant_id, v_booking_id,
          case when v_parents[v_i] > 0 then v_reservation_ids[v_parents[v_i]] end,
          v_product_ids[v_i], v_types[v_i], v_location_ids[v_i],
          v_starts[v_i], v_ends[v_i], v_periods[v_i], v_quantities[v_i], 0,
          v_channel, v_mode, 'reserved'
        )
        returning id into v_id;
        v_reservation_ids[v_i] := v_id;
      end loop;

      insert into platform.unit_blocks (tenant_id, unit_id, kind, period, reservation_id)
      select p_tenant_id, t.u, 'allocation', t.period, v_reservation_ids[t.line]
      from unnest(v_pick_unit, v_pick_period, v_pick_line) t(u, period, line)
      order by hashtext(t.u::text), t.u;

      v_done := true;
    exception
      when sqlstate 'RSV01' then
        null;
      when exclusion_violation or foreign_key_violation then
        -- Something reached a unit without its lock (a unit deleted, a block
        -- written past the guard). Nothing of this attempt is kept.
        v_refused_line := coalesce(v_refused_line, 1);
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
      'shortage', 0
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
      'lines', (
        select jsonb_agg(
          (v_answer -> (l.i - 1)) - 'shortage' || jsonb_build_object(
            'product_id', v_product_ids[l.i],
            'location_id', v_location_ids[l.i],
            'starts_at', v_starts[l.i],
            'ends_at', v_ends[l.i],
            'quantity', v_quantities[l.i])
          order by l.i)
        from generate_series(1, v_count) l(i)
      )));

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'lines', v_answer);
exception
  when deadlock_detected then
    return jsonb_build_object('ok', false, 'reason', 'try_again', 'line', null);
end;
$$;

revoke all on function platform.reserve(uuid, jsonb) from public, anon;
grant execute on function platform.reserve(uuid, jsonb) to authenticated, service_role;

-- cancel_reservation() ----------------------------------------------------------------------
-- A whole booking (p_booking_id) or one of its rows (p_reservation_id, and
-- the extras that came with it). Blocks that have not started are deleted;
-- one that has started is ended now. The same locks in the same order as
-- reserve().
--
-- Answers { "ok": true, "booking_id", "reservation_ids": [...] } (the rows
-- cancelled by this call; none when it was cancelled already) or
-- { "ok": false, "reason" } with reason not_allowed, not_found (also another
-- shop's), not_cancellable (already collected or returned) or try_again.

create function platform.cancel_reservation(
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
      jsonb_build_object('reservation_ids', to_jsonb(v_cancelled)));
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
