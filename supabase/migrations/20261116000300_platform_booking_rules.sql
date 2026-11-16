-- Phase 2, stage 3: booking rules and the Moto Mangos cap
-- (docs/phase-2-plan.md §2.3, §3.6, §4, §8 stage 3; the owner's answers in
-- §10, Q5 with its addition).
--
-- Builds on the migrations before it, none of which is touched.
--
--  1. The rule columns, all nullable ("not set" is no rule):
--     locations  min_notice_hours, booking_cutoff_minutes, min_days_advance,
--                min_days_walkin;
--     products   min_days_advance, min_days_walkin (vehicles; empty = the
--                location's);
--     tenants    buffer_before_minutes, buffer_after_minutes (the shop's
--                default; a product's own wins).
--  2. platform_private.booking_roles() re-created: 'rules'.
--  3. platform.save_booking_rules(): owners and managers. The first writer
--     of allow_overbooking, hold_minutes and the shop's default buffers.
--  4. platform.booking_inputs(): one read of everything the rules need.
--  5. platform.reserve() re-created: the shop's default buffers, and the
--     Moto Mangos cap check under the listing's row.
--  6. platform.availability() re-created: the shop's default buffers.
--
-- The database still checks stock only. Opening hours, closures, notice,
-- the cut-off and minimum days are decided once, in @mango/core
-- (bookable()), on the server before reserve() is called: no other booking
-- can change a shop's opening hours, so they do not race. The Moto Mangos
-- cap does race (two bookings for its last place), so it is checked here,
-- under a lock.
--
-- Re-created functions are their bodies from the database
-- (pg_get_functiondef) with the changes named above each, and their grants
-- restated.
--
-- Lock order, for every writer (root CLAUDE.md), unchanged:
--   1. product-and-location advisory locks (namespace 1a02), sorted by key;
--   2. unit advisory locks (namespace 1a01), sorted by key;
--   3. rows: unit rows (for key share) in id order, the products' rows (for
--      share) in product-id order, then their listings' rows in product-id
--      order, then reservations, then unit_blocks.
-- The listing's row comes after the product's row, as save_listing() and a
-- vehicle leaving take them.

-- 1. The rule columns ---------------------------------------------------------------------------
-- A location's own rules. Hours of notice are a plain duration, as a
-- listing's lead time is (0 to 720). The cut-off is minutes before closing.

alter table platform.locations
  add column min_notice_hours integer
    constraint locations_min_notice_hours_check check (min_notice_hours between 0 and 720),
  add column booking_cutoff_minutes integer
    constraint locations_booking_cutoff_minutes_check
      check (booking_cutoff_minutes between 0 and 1440),
  add column min_days_advance integer
    constraint locations_min_days_advance_check check (min_days_advance between 1 and 365),
  add column min_days_walkin integer
    constraint locations_min_days_walkin_check check (min_days_walkin between 1 and 365);

-- A vehicle's own minimum days. Gear, services and items for sale have none.
alter table platform.products
  add column min_days_advance integer
    constraint products_min_days_advance_check check (min_days_advance between 1 and 365),
  add column min_days_walkin integer
    constraint products_min_days_walkin_check check (min_days_walkin between 1 and 365),
  add constraint products_min_days_vehicle_check
    check (type = 'vehicle' or (min_days_advance is null and min_days_walkin is null));

-- The shop's default buffers, for a vehicle that has none of its own. The
-- same range as a product's (up to a week). platform.tenants has column
-- grants, so no signed-in person can write these, allow_overbooking or
-- hold_minutes directly: save_booking_rules() below is the way.
alter table platform.tenants
  add column buffer_before_minutes integer
    constraint tenants_buffer_before_minutes_check
      check (buffer_before_minutes between 0 and 10080),
  add column buffer_after_minutes integer
    constraint tenants_buffer_after_minutes_check
      check (buffer_after_minutes between 0 and 10080);

-- 2. Who may do what ----------------------------------------------------------------------------
-- As it stood (20261116000200), plus 'rules': the booking rules of a
-- location, a vehicle's minimum days, the shop's default buffers, the hold
-- length and the overbooking switch (plan §6).
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
    when 'rules' then '{owner,manager}'
    else '{}'
  end)::platform.platform_role[];
$$;

revoke all on function platform_private.booking_roles(text) from public, anon;
grant execute on function platform_private.booking_roles(text) to authenticated, service_role;

-- 3. save_booking_rules() -----------------------------------------------------------------------
-- A whole number between two bounds from a JSON object, or null when the
-- key holds null. Anything else raises p_error.

create function platform_private.json_int_between(
  p jsonb,
  p_key text,
  p_min integer,
  p_max integer,
  p_error text
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := p ->> p_key;
begin
  if jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_key) is distinct from 'number' or v_text !~ '^[0-9]{1,6}$'
    or v_text::integer not between p_min and p_max
  then
    raise exception '%', p_error using errcode = '22023';
  end if;
  return v_text::integer;
end;
$$;

revoke all on function platform_private.json_int_between(jsonb, text, integer, integer, text)
  from public, anon, authenticated;

-- p_rules: {
--   "shop": { "allow_overbooking": true | false,
--             "hold_minutes": 5..60,
--             "buffer_before_minutes": 0..10080 | null,
--             "buffer_after_minutes": 0..10080 | null },
--   "locations": [ { "id",
--             "min_notice_hours": 0..720 | null,
--             "booking_cutoff_minutes": 0..1440 | null,
--             "min_days_advance": 1..365 | null,
--             "min_days_walkin": 1..365 | null } ],
--   "products": [ { "id",                       vehicles only
--             "min_days_advance": 1..365 | null,
--             "min_days_walkin": 1..365 | null } ]
-- }
-- Every part and every key is optional: only what is named changes, and
-- null clears a rule. Owners and managers of the shop; anyone else, another
-- shop's owner included, is answered only_owner_or_manager. Another shop's
-- location or product is answered exactly like one that does not exist.
-- All or nothing. Each row it changes is audited by its table's trigger.
--
-- It takes no advisory lock and checks nothing a booking writes. Rows, in
-- this order: the shop's row, the locations' rows in id order, the
-- products' rows in id order. A booking share-locks products' rows in id
-- order too and never waits for a shop's or a location's row in a
-- conflicting strength, so neither can wait on the other in a circle.
-- Buffers are copied onto a reservation when it is made: changing the
-- default moves no existing block.

create function platform.save_booking_rules(p_tenant_id uuid, p_rules jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_shop jsonb;
  v_item jsonb;
  v_id uuid;
  v_location_ids uuid[] := '{}';
  v_product_ids uuid[] := '{}';
begin
  if not platform_private.has_role(p_tenant_id, platform_private.booking_roles('rules')) then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    raise exception 'invalid_rules' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_rules) loop
    if v_key not in ('shop', 'locations', 'products') then
      raise exception 'invalid_rules' using errcode = '22023';
    end if;
  end loop;

  -- The shop ------------------------------------------------------------
  if p_rules ? 'shop' then
    v_shop := p_rules -> 'shop';
    if jsonb_typeof(v_shop) <> 'object' then
      raise exception 'invalid_rules' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_shop) loop
      if v_key not in (
        'allow_overbooking', 'hold_minutes', 'buffer_before_minutes', 'buffer_after_minutes'
      ) then
        raise exception 'invalid_rules' using errcode = '22023';
      end if;
    end loop;
    if (v_shop ? 'allow_overbooking' and jsonb_typeof(v_shop -> 'allow_overbooking') <> 'boolean')
      or (v_shop ? 'hold_minutes' and jsonb_typeof(v_shop -> 'hold_minutes') = 'null')
    then
      raise exception 'invalid_rules' using errcode = '22023';
    end if;
    update platform.tenants t
    set allow_overbooking = case when v_shop ? 'allow_overbooking'
          then (v_shop ->> 'allow_overbooking')::boolean else t.allow_overbooking end,
        hold_minutes = case when v_shop ? 'hold_minutes'
          then platform_private.json_int_between(v_shop, 'hold_minutes', 5, 60, 'invalid_rules')
          else t.hold_minutes end,
        buffer_before_minutes = case when v_shop ? 'buffer_before_minutes'
          then platform_private.json_int_between(
            v_shop, 'buffer_before_minutes', 0, 10080, 'invalid_rules')
          else t.buffer_before_minutes end,
        buffer_after_minutes = case when v_shop ? 'buffer_after_minutes'
          then platform_private.json_int_between(
            v_shop, 'buffer_after_minutes', 0, 10080, 'invalid_rules')
          else t.buffer_after_minutes end
    where t.id = p_tenant_id;
  end if;

  -- The locations -------------------------------------------------------
  if p_rules ? 'locations' then
    if jsonb_typeof(p_rules -> 'locations') <> 'array'
      or jsonb_array_length(p_rules -> 'locations') > 200
    then
      raise exception 'invalid_rules' using errcode = '22023';
    end if;
    for v_item in select e.value from jsonb_array_elements(p_rules -> 'locations') e loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid_rules' using errcode = '22023';
      end if;
      for v_key in select jsonb_object_keys(v_item) loop
        if v_key not in (
          'id', 'min_notice_hours', 'booking_cutoff_minutes', 'min_days_advance', 'min_days_walkin'
        ) then
          raise exception 'invalid_rules' using errcode = '22023';
        end if;
      end loop;
      v_id := platform_private.json_uuid(v_item, 'id', 'invalid_rules');
      if v_id is null or v_id = any (v_location_ids) then
        raise exception 'invalid_rules' using errcode = '22023';
      end if;
      v_location_ids := v_location_ids || v_id;
    end loop;
    perform 1 from platform.locations l
    where l.tenant_id = p_tenant_id and l.id = any (v_location_ids)
    order by l.id
    for no key update;
    -- Not found, or another shop's: the same answer.
    if exists (
      select 1 from unnest(v_location_ids) i
      where not exists (
        select 1 from platform.locations l where l.id = i and l.tenant_id = p_tenant_id
      )
    ) then
      raise exception 'location_not_found' using errcode = 'P0001';
    end if;
    for v_item in select e.value from jsonb_array_elements(p_rules -> 'locations') e loop
      update platform.locations l
      set min_notice_hours = case when v_item ? 'min_notice_hours'
            then platform_private.json_int_between(
              v_item, 'min_notice_hours', 0, 720, 'invalid_rules')
            else l.min_notice_hours end,
          booking_cutoff_minutes = case when v_item ? 'booking_cutoff_minutes'
            then platform_private.json_int_between(
              v_item, 'booking_cutoff_minutes', 0, 1440, 'invalid_rules')
            else l.booking_cutoff_minutes end,
          min_days_advance = case when v_item ? 'min_days_advance'
            then platform_private.json_int_between(
              v_item, 'min_days_advance', 1, 365, 'invalid_rules')
            else l.min_days_advance end,
          min_days_walkin = case when v_item ? 'min_days_walkin'
            then platform_private.json_int_between(
              v_item, 'min_days_walkin', 1, 365, 'invalid_rules')
            else l.min_days_walkin end
      where l.id = (v_item ->> 'id')::uuid and l.tenant_id = p_tenant_id;
    end loop;
  end if;

  -- The products (vehicles) ---------------------------------------------
  if p_rules ? 'products' then
    if jsonb_typeof(p_rules -> 'products') <> 'array'
      or jsonb_array_length(p_rules -> 'products') > 500
    then
      raise exception 'invalid_rules' using errcode = '22023';
    end if;
    for v_item in select e.value from jsonb_array_elements(p_rules -> 'products') e loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'invalid_rules' using errcode = '22023';
      end if;
      for v_key in select jsonb_object_keys(v_item) loop
        if v_key not in ('id', 'min_days_advance', 'min_days_walkin') then
          raise exception 'invalid_rules' using errcode = '22023';
        end if;
      end loop;
      v_id := platform_private.json_uuid(v_item, 'id', 'invalid_rules');
      if v_id is null or v_id = any (v_product_ids) then
        raise exception 'invalid_rules' using errcode = '22023';
      end if;
      v_product_ids := v_product_ids || v_id;
    end loop;
    perform 1 from platform.products p
    where p.tenant_id = p_tenant_id and p.id = any (v_product_ids)
    order by p.id
    for no key update;
    -- Not found, retired, or another shop's: the same answer.
    if exists (
      select 1 from unnest(v_product_ids) i
      where not exists (
        select 1 from platform.products p
        where p.id = i and p.tenant_id = p_tenant_id and p.retired_at is null
      )
    ) then
      raise exception 'product_not_found' using errcode = 'P0001';
    end if;
    -- Only a vehicle has minimum days of its own.
    if exists (
      select 1 from platform.products p
      where p.id = any (v_product_ids) and p.type <> 'vehicle'
    ) then
      raise exception 'not_a_vehicle' using errcode = 'P0001';
    end if;
    for v_item in select e.value from jsonb_array_elements(p_rules -> 'products') e loop
      update platform.products p
      set min_days_advance = case when v_item ? 'min_days_advance'
            then platform_private.json_int_between(
              v_item, 'min_days_advance', 1, 365, 'invalid_rules')
            else p.min_days_advance end,
          min_days_walkin = case when v_item ? 'min_days_walkin'
            then platform_private.json_int_between(
              v_item, 'min_days_walkin', 1, 365, 'invalid_rules')
            else p.min_days_walkin end
      where p.id = (v_item ->> 'id')::uuid and p.tenant_id = p_tenant_id;
    end loop;
  end if;

  -- What is in force now, for what was named.
  return jsonb_build_object(
    'shop', (
      select jsonb_build_object(
        'allow_overbooking', t.allow_overbooking,
        'hold_minutes', t.hold_minutes,
        'buffer_before_minutes', t.buffer_before_minutes,
        'buffer_after_minutes', t.buffer_after_minutes)
      from platform.tenants t
      where t.id = p_tenant_id
    ),
    'locations', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'min_notice_hours', l.min_notice_hours,
          'booking_cutoff_minutes', l.booking_cutoff_minutes,
          'min_days_advance', l.min_days_advance,
          'min_days_walkin', l.min_days_walkin)
        order by l.id), '[]'::jsonb)
      from platform.locations l
      where l.tenant_id = p_tenant_id and l.id = any (v_location_ids)
    ),
    'products', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'min_days_advance', p.min_days_advance,
          'min_days_walkin', p.min_days_walkin)
        order by p.id), '[]'::jsonb)
      from platform.products p
      where p.tenant_id = p_tenant_id and p.id = any (v_product_ids)
    ));
end;
$$;

-- A signed-in owner's or manager's alone: the server has no shop of its own
-- to set rules for (the seed writes the columns with its table grants).
revoke all on function platform.save_booking_rules(uuid, jsonb)
  from public, anon, service_role;
grant execute on function platform.save_booking_rules(uuid, jsonb) to authenticated;

-- 4. booking_inputs(): the read -----------------------------------------------------------------
-- Everything bookable() and offer() in @mango/core need for some products at
-- one location, in one call:
--   { "shop":     { "currency", "allow_overbooking", "hold_minutes",
--                   "buffer_before_minutes", "buffer_after_minutes" },
--     "location": { "id", "timezone",
--                   "min_notice_hours", "booking_cutoff_minutes",
--                   "min_days_advance", "min_days_walkin",
--                   "hours":    [ { "weekday" 0 = Sunday, "open", "close" } ],
--                   "closures": [ { "start_date", "end_date", "repeats_yearly" } ] },
--     "products": [ { "product_id", "type",
--                     "buffer_before_minutes", "buffer_after_minutes"
--                                         the ones in force: the product's
--                                         own, else for a vehicle the shop's,
--                     "min_days_advance", "min_days_walkin"   the product's own,
--                     "listing": null | { "enabled", "instant_units",
--                       "request_units", "lead_time_hours", "ready_now" } } ] }
-- in the order the products were sent. Times of day are the location's wall
-- clock ("09:00:00"); nothing here is turned into an instant, so nothing
-- assumes an offset.
--
-- It runs as the caller under RLS, takes no lock and holds no money. Every
-- member of the shop, and the service role (the server, for online
-- channels). Another shop's product or place is answered exactly like one
-- that does not exist: product_not_found, location_not_found.

create function platform.booking_inputs(
  p_tenant_id uuid,
  p_location_id uuid,
  p_product_ids uuid[]
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    if not platform_private.has_role(p_tenant_id, platform_private.booking_roles('read')) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
  end if;
  if p_location_id is null or p_product_ids is null
    or cardinality(p_product_ids) not between 1 and 200
    or array_position(p_product_ids, null) is not null
    or cardinality(p_product_ids) <> (select count(distinct i) from unnest(p_product_ids) i)
  then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from platform.locations l
    where l.id = p_location_id and l.tenant_id = p_tenant_id
  ) then
    raise exception 'location_not_found' using errcode = 'P0001';
  end if;
  -- Not found, retired, or another shop's: the same answer.
  if exists (
    select 1 from unnest(p_product_ids) i
    where not exists (
      select 1 from platform.products p
      where p.id = i and p.tenant_id = p_tenant_id and p.retired_at is null
    )
  ) then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'shop', (
      select jsonb_build_object(
        'currency', t.currency,
        'allow_overbooking', t.allow_overbooking,
        'hold_minutes', t.hold_minutes,
        'buffer_before_minutes', t.buffer_before_minutes,
        'buffer_after_minutes', t.buffer_after_minutes)
      from platform.tenants t
      where t.id = p_tenant_id
    ),
    'location', (
      select jsonb_build_object(
        'id', l.id,
        'timezone', l.timezone,
        'min_notice_hours', l.min_notice_hours,
        'booking_cutoff_minutes', l.booking_cutoff_minutes,
        'min_days_advance', l.min_days_advance,
        'min_days_walkin', l.min_days_walkin,
        'hours', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'weekday', h.weekday,
              'open', to_char(h.open, 'HH24:MI:SS'),
              'close', to_char(h.close, 'HH24:MI:SS'))
            order by h.weekday), '[]'::jsonb)
          from platform.location_hours h
          where h.location_id = l.id
        ),
        'closures', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'start_date', c.start_date,
              'end_date', c.end_date,
              'repeats_yearly', c.repeats_yearly)
            order by c.start_date, c.id), '[]'::jsonb)
          from platform.location_closures c
          where c.location_id = l.id
        ))
      from platform.locations l
      where l.id = p_location_id and l.tenant_id = p_tenant_id
    ),
    'products', (
      select jsonb_agg(
        jsonb_build_object(
          'product_id', p.id,
          'type', p.type,
          'buffer_before_minutes', coalesce(
            p.buffer_before_minutes,
            case when p.type = 'vehicle' then t.buffer_before_minutes end),
          'buffer_after_minutes', coalesce(
            p.buffer_after_minutes,
            case when p.type = 'vehicle' then t.buffer_after_minutes end),
          'min_days_advance', p.min_days_advance,
          'min_days_walkin', p.min_days_walkin,
          'listing', case when g.product_id is not null then jsonb_build_object(
            'enabled', g.enabled,
            'instant_units', g.instant_units,
            'request_units', g.request_units,
            'lead_time_hours', g.lead_time_hours,
            'ready_now', g.ready_now) end)
        order by i.ord)
      from unnest(p_product_ids) with ordinality i(id, ord)
      join platform.products p on p.id = i.id and p.tenant_id = p_tenant_id
      join platform.tenants t on t.id = p.tenant_id
      left join platform.product_listings g on g.product_id = p.id
    ));
end;
$$;

revoke all on function platform.booking_inputs(uuid, uuid, uuid[]) from public, anon;
grant execute on function platform.booking_inputs(uuid, uuid, uuid[])
  to authenticated, service_role;

-- 5. reserve() ----------------------------------------------------------------------------------
-- As it stood (20261116000200), plus:
--   * the window of a vehicle that has no buffer of its own is widened by
--     the shop's default buffers (each side on its own: a product's "before"
--     with the shop's "after" is possible);
--   * the Moto Mangos cap (plan §3.2 step 5), for channel 'marketplace'. In
--     the rows phase, after the products' rows: the listings' rows of the
--     booking's products, in product-id order, in a strength that makes two
--     Moto Mangos bookings of one product take turns even when they are for
--     two places (their product-and-location locks differ then). Under it:
--       - a vehicle whose listing is off or missing answers 'not_listed';
--       - an advance booking (mode 'instant') must fit the units to offer,
--         instant_units + request_units, and the Instant units, counting the
--         Moto Mangos advance bookings that hold a vehicle of the product in
--         the window and this call's own earlier lines: else 'cap_reached';
--       - "Ride today" (mode 'now') uses real availability only and is not
--         counted against the cap, by this check or by later ones.
--     Gear and services booked with the vehicle have no listing and no cap.
--     A refusal writes nothing.
--
-- Two new answers: { ok: false, reason: 'not_listed' | 'cap_reached', line }.
-- The request and the answer are otherwise unchanged.

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
  -- The shop's default buffers, for a vehicle with none of its own.
  v_shop_before integer;
  v_shop_after integer;
  -- The Moto Mangos cap.
  v_listing record;
  v_peaks record;
  v_own integer;
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
  select t.allow_overbooking and not v_online, t.hold_minutes,
    t.buffer_before_minutes, t.buffer_after_minutes
  into v_overbook, v_hold_minutes, v_shop_before, v_shop_after
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

    -- The window, widened by the product's own buffers, else for a vehicle
    -- the shop's default buffers, else not at all.
    v_periods[v_i] := tstzrange(
      v_starts[v_i] - make_interval(mins => coalesce(
        v_product.buffer_before_minutes,
        case when v_product.type = 'vehicle' then v_shop_before end, 0)),
      v_ends[v_i] + make_interval(mins => coalesce(
        v_product.buffer_after_minutes,
        case when v_product.type = 'vehicle' then v_shop_after end, 0)),
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

      -- 5. Moto Mangos: the listings' rows, after the products' rows, in
      -- product-id order; then the cap. Two bookings of one product for two
      -- places hold different product-and-location locks, so this row is
      -- what makes them take turns: the second counts the first's rows.
      if v_channel = 'marketplace' then
        perform 1 from platform.product_listings l
        where l.product_id = any (v_product_ids)
        order by l.product_id
        for no key update;
        for v_i in 1..v_count loop
          continue when v_types[v_i] <> 'vehicle';
          select l.enabled, l.instant_units, l.request_units into v_listing
          from platform.product_listings l
          where l.product_id = v_product_ids[v_i] and l.tenant_id = p_tenant_id;
          if not found or not v_listing.enabled then
            return jsonb_build_object('ok', false, 'reason', 'not_listed', 'line', v_i - 1);
          end if;
          -- "Ride today" is not counted against the cap.
          continue when v_mode = 'now';
          select k.held, k.instant into v_peaks
          from platform_private.marketplace_peaks(v_product_ids[v_i], v_periods[v_i]) k;
          -- This call's own earlier lines for the same product.
          select coalesce(sum(v_quantities[j]), 0)::integer into v_own
          from generate_series(1, v_i - 1) j
          where v_product_ids[j] = v_product_ids[v_i]
            and v_periods[j] && v_periods[v_i];
          if v_peaks.held + v_own + v_quantities[v_i]
              > v_listing.instant_units + v_listing.request_units
            or v_peaks.instant + v_own + v_quantities[v_i] > v_listing.instant_units
          then
            return jsonb_build_object('ok', false, 'reason', 'cap_reached', 'line', v_i - 1);
          end if;
        end loop;
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

-- 6. availability() ----------------------------------------------------------------------------
-- As it stood (20261116000200), plus: the window of a vehicle that has no
-- buffer of its own is widened by the shop's default buffers, exactly as
-- reserve() widens it. The request and the answer are unchanged.

create or replace function platform.availability(p_tenant_id uuid, p_items jsonb)
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
    -- The buffers in force: the product's own, else for a vehicle the shop's.
    select p.id, p.type,
      coalesce(p.buffer_before_minutes,
        case when p.type = 'vehicle' then t.buffer_before_minutes end) as buffer_before_minutes,
      coalesce(p.buffer_after_minutes,
        case when p.type = 'vehicle' then t.buffer_after_minutes end) as buffer_after_minutes
    into v_product
    from platform.products p
    join platform.tenants t on t.id = p.tenant_id
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
