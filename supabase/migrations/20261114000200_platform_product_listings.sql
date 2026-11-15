-- Products, stage C, the database part: Moto Mangos listings in their own
-- table (docs/products-redesign.md §1.4, §2.6; owner's answers of 14 Nov 2026).
--
-- Builds on the migrations before it, none of which is touched.
--
-- Until now a product carried its Moto Mangos settings itself: the switch
-- (marketplace_listed), the three counts (instant_units, request_units,
-- ready_now) and ready_updated_at. They move to platform.product_listings,
-- one row per product that is or once was listed, with one new setting, the
-- lead time in plain hours.
--
-- 1. The table, read by every member of the shop. Nobody signed in writes it
--    directly: every change goes through a function that locks the product's
--    row first (5 below). RLS on, grants written on purpose.
-- 2. The data: a row for every product that is listed, has a count above
--    zero, or has a ready-updated time. Then the five columns are dropped.
-- 3. products_vehicle_fields_check is re-created: dropping a column drops
--    every check that names it, and this one holds the whole "a general
--    product has no vehicle details" rule.
-- 4. The guard on the new table, and the listing_on / listing_off events.
-- 5. platform.save_listing(): the one way a shop changes a listing, with
--    platform_private.listing_roles() saying which role may change what.
-- 6. The five functions that named the old columns, re-created (the list is
--    from the database: every function whose body names one of them):
--    products_guard, products_retire_guard, units_clamp_product_counts,
--    review_catalog_request, disconnect_listing.
--
-- Lock order, everywhere: the product's row, then its listing's row. The
-- product's row is the one lock every writer of a listing takes first (a
-- shop saving, a vehicle leaving, a retire, a review, a disconnect), so they
-- run one after the other and none can wait on another in a circle.
--
-- The units-to-offer cap is not stored: it is instant_units + request_units,
-- and Moto Mangos bookings are counted against it from orders (Phase 3).
-- Nothing in the marketplace reads this table until Phase 3M.

-- 1. The table ------------------------------------------------------------------------------

create table platform.product_listings (
  product_id uuid primary key,
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  -- Always 'vehicle': with the key below, only a vehicle can have a listing.
  product_type text not null default 'vehicle'
    constraint product_listings_product_type_check check (product_type = 'vehicle'),
  -- The on and off switch.
  enabled boolean not null default false,
  -- Units offered for advance booking: confirmed at once, or by request.
  instant_units integer not null default 0
    constraint product_listings_instant_units_check check (instant_units >= 0),
  request_units integer not null default 0
    constraint product_listings_request_units_check check (request_units >= 0),
  -- Hours between a booking and its pickup. Null: none of its own. The
  -- stricter of this and the shop's minimum notice applies (@mango/core
  -- listing). A plain duration: no time zone.
  lead_time_hours integer
    constraint product_listings_lead_time_hours_check check (lead_time_hours between 0 and 720),
  -- Vehicles standing ready for a walk-in ("Ride today"), and when the shop
  -- last said so.
  ready_now integer not null default 0
    constraint product_listings_ready_now_check check (ready_now >= 0),
  ready_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, product_id, product_type)
    references platform.products (tenant_id, id, type) on delete cascade
);

create index product_listings_tenant_idx on platform.product_listings (tenant_id);

alter table platform.product_listings enable row level security;

-- Members read. No insert, update or delete for a signed-in person: a
-- listing is changed through platform.save_listing() and the functions
-- below, which take the product's lock first.
grant select on platform.product_listings to authenticated;
grant select, insert, update, delete on platform.product_listings to service_role;

create policy "Members read product listings"
on platform.product_listings for select to authenticated
using (tenant_id = any ((select platform_private.my_tenant_ids())::uuid[]));

-- 2. The data -------------------------------------------------------------------------------
-- Before the guard and the audit trigger exist: this is the same settings
-- in a new place, not a change anyone made.

insert into platform.product_listings (
  product_id, tenant_id, enabled, instant_units, request_units, ready_now,
  ready_updated_at, created_at, updated_at
)
select p.id, p.tenant_id, p.marketplace_listed, p.instant_units, p.request_units, p.ready_now,
  p.ready_updated_at, p.created_at, p.updated_at
from platform.products p
where p.type = 'vehicle'
  and (
    p.marketplace_listed
    or p.instant_units > 0
    or p.request_units > 0
    or p.ready_now > 0
    or p.ready_updated_at is not null
  );

-- 3. The columns go; the vehicle-fields rule is put back ------------------------------------
-- Dropped by name first, so nothing disappears unnoticed with the columns.

alter table platform.products
  drop constraint products_vehicle_fields_check,
  drop constraint products_instant_units_check,
  drop constraint products_request_units_check,
  drop constraint products_ready_now_check;

alter table platform.products
  drop column marketplace_listed,
  drop column instant_units,
  drop column request_units,
  drop column ready_now,
  drop column ready_updated_at;

-- As in 20261113000200, without the listing columns. That a general product
-- has no listing is now the key on product_listings (vehicles only).
alter table platform.products
  add constraint products_vehicle_fields_check check (
    case
      when type = 'vehicle' then
        vehicle_type is not null
        -- Both or neither: a make with no model matches nothing.
        and (make is null) = (model is null)
      else
        make is null and model is null and vehicle_type is null
        and cc is null and transmission is null and catalog_id is null
        and min_age is null and licence_class is null
        and catalog_approved_at is null and catalog_rejected_at is null
        and catalog_reject_reason is null
    end
  );

-- 4. The guard on a listing -----------------------------------------------------------------
-- The rules that were in products_guard and products_retire_guard:
--   * on only while the product is on an approved list entry (not_listable)
--     and not retired (model_retired);
--   * instant + request, and ready_now, never above the product's active
--     vehicles (more_units_than_active).
-- It takes the product's lock itself, so the rules hold whoever writes
-- (the service role included) and a vehicle leaving at this instant is
-- counted before or after, never half.

create function platform_private.product_listings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_active int;
begin
  if tg_op = 'UPDATE' and (
    new.product_id <> old.product_id or new.tenant_id <> old.tenant_id
  ) then
    raise exception 'listing_product_fixed' using errcode = 'P0001';
  end if;

  select p.id, p.tenant_id, p.catalog_id, p.retired_at into v_product
  from platform.products p
  where p.id = new.product_id
  for no key update;
  if not found then
    -- The foreign key says so in its own words.
    return new;
  end if;

  if new.enabled then
    if v_product.catalog_id is null or not exists (
      select 1 from public.bike_catalog where id = v_product.catalog_id and status = 'approved'
    ) then
      raise exception 'not_listable' using errcode = 'P0001';
    end if;
    if v_product.retired_at is not null then
      -- Still retired: restore it before listing it.
      raise exception 'model_retired' using errcode = 'P0001';
    end if;
  end if;

  if new.instant_units + new.request_units > 0 or new.ready_now > 0 then
    select count(*) into v_active from platform.units
    where tenant_id = v_product.tenant_id and product_id = v_product.id and status = 'active';
    if new.instant_units + new.request_units > v_active or new.ready_now > v_active then
      raise exception 'more_units_than_active' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function platform_private.product_listings_guard() from public, anon, authenticated;

create trigger product_listings_guard
before insert or update on platform.product_listings
for each row execute function platform_private.product_listings_guard();

create trigger product_listings_set_updated_at
before update on platform.product_listings
for each row execute function platform_private.set_updated_at();

create trigger product_listings_audit
after insert or update or delete on platform.product_listings
for each row execute function platform_private.audit_row('product_id');

-- The switch going on or off is an event of its own on the product,
-- whoever or whatever flipped it: a save, an approval, a rejection, a
-- retire, a disconnect.
create function platform_private.product_listings_switch_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was boolean := case when tg_op = 'UPDATE' then old.enabled else false end;
begin
  if new.enabled is distinct from v_was then
    insert into platform.audit_events (tenant_id, entity, entity_id, action, actor, before, after)
    values (
      new.tenant_id, 'products', new.product_id::text,
      case when new.enabled then 'listing_on' else 'listing_off' end,
      (select auth.uid()),
      jsonb_build_object('enabled', v_was),
      jsonb_build_object('enabled', new.enabled)
    );
  end if;
  return null;
end;
$$;

revoke all on function platform_private.product_listings_switch_event() from public, anon, authenticated;

create trigger product_listings_switch_event
after insert or update of enabled on platform.product_listings
for each row execute function platform_private.product_listings_switch_event();

-- 5. Who may change what, and the one function a shop changes a listing with ----------------

-- The one place that says which role may do which listing action:
--   settings   the switch, instant and request units, the lead time
--   walk_ins   the walk-ins count (ready_now)
-- Owners and managers only for now (owner, 14 Nov 2026). Letting staff set
-- the walk-ins count later is one word in this function.
create function platform_private.listing_roles(p_action text)
returns platform.platform_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_action
    when 'settings' then '{owner,manager}'::platform.platform_role[]
    when 'walk_ins' then '{owner,manager}'::platform.platform_role[]
  end;
$$;

revoke all on function platform_private.listing_roles(text) from public, anon;
grant execute on function platform_private.listing_roles(text) to authenticated;

-- Switches a product's listing off and sets its counts to zero, for
-- disconnect_listing() (which runs as the caller, and a caller can't write
-- the table). The lead time is the shop's setting and stays. The caller
-- holds the product's lock already. Answers with the row as it was.
create function platform_private.listing_clear(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_was platform.product_listings;
begin
  select tenant_id into v_tenant
  from platform.products where id = p_product_id for no key update;
  if v_tenant is null
    or not platform_private.has_role(v_tenant, platform_private.listing_roles('settings'))
  then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  select * into v_was from platform.product_listings where product_id = p_product_id;
  if v_was.product_id is not null then
    update platform.product_listings
    set enabled = false, instant_units = 0, request_units = 0, ready_now = 0
    where product_id = p_product_id;
  end if;
  return jsonb_build_object(
    'enabled', coalesce(v_was.enabled, false),
    'instant_units', coalesce(v_was.instant_units, 0),
    'request_units', coalesce(v_was.request_units, 0),
    'ready_now', coalesce(v_was.ready_now, 0)
  );
end;
$$;

revoke all on function platform_private.listing_clear(uuid) from public, anon;
grant execute on function platform_private.listing_clear(uuid) to authenticated;

-- Changes a product's listing. p_settings names only what is to change:
--   {"enabled": true, "instant_units": 2, "request_units": 0,
--    "ready_now": 1, "lead_time_hours": 24}
-- A lead time of null means "none of its own". Anything not named stays as
-- it is. A product that was never listed gets its row here, unless what is
-- saved is all "off, zero, none": then there is still nothing to keep.
-- ready_updated_at is set here, never sent: whenever a walk-ins count above
-- zero is saved.
--
-- Runs with its owner's rights, because nobody signed in may write the
-- table; so it checks the caller itself, per setting, with listing_roles().
-- The product's row is locked first, then the listing's.
create function platform.save_listing(p_product_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_row platform.product_listings;
  v_exists boolean;
  v_key text;
  v_count int;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'invalid_listing' using errcode = '22023';
  end if;

  select p.id, p.tenant_id, p.type into v_product
  from platform.products p
  where p.id = p_product_id
  for no key update;
  -- Not found, or not this person's shop: the same answer.
  if v_product.id is null or not platform_private.is_member(v_product.tenant_id) then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;

  for v_key in select jsonb_object_keys(p_settings) loop
    if v_key not in ('enabled', 'instant_units', 'request_units', 'ready_now', 'lead_time_hours') then
      raise exception 'invalid_listing' using errcode = '22023';
    end if;
    if not platform_private.has_role(
      v_product.tenant_id,
      platform_private.listing_roles(case when v_key = 'ready_now' then 'walk_ins' else 'settings' end)
    ) then
      raise exception 'only_owner_or_manager' using errcode = '42501';
    end if;
  end loop;

  if v_product.type <> 'vehicle' then
    -- Moto Mangos lists vehicles only.
    raise exception 'not_listable' using errcode = 'P0001';
  end if;

  select * into v_row from platform.product_listings where product_id = p_product_id for update;
  v_exists := found;
  if not v_exists then
    v_row.product_id := p_product_id;
    v_row.tenant_id := v_product.tenant_id;
    v_row.enabled := false;
    v_row.instant_units := 0;
    v_row.request_units := 0;
    v_row.ready_now := 0;
    v_row.lead_time_hours := null;
    v_row.ready_updated_at := null;
  end if;

  if p_settings ? 'enabled' then
    if jsonb_typeof(p_settings -> 'enabled') <> 'boolean' then
      raise exception 'invalid_listing' using errcode = '22023';
    end if;
    v_row.enabled := (p_settings ->> 'enabled')::boolean;
  end if;
  foreach v_key in array array['instant_units', 'request_units', 'ready_now', 'lead_time_hours'] loop
    if p_settings ? v_key then
      if v_key = 'lead_time_hours' and jsonb_typeof(p_settings -> v_key) = 'null' then
        v_row.lead_time_hours := null;
        continue;
      end if;
      if jsonb_typeof(p_settings -> v_key) <> 'number'
        or (p_settings ->> v_key) !~ '^[0-9]{1,6}$'
      then
        raise exception 'invalid_listing' using errcode = '22023';
      end if;
      v_count := (p_settings ->> v_key)::int;
      case v_key
        when 'instant_units' then v_row.instant_units := v_count;
        when 'request_units' then v_row.request_units := v_count;
        when 'ready_now' then
          v_row.ready_now := v_count;
          if v_count > 0 then
            v_row.ready_updated_at := now();
          end if;
        else v_row.lead_time_hours := v_count;
      end case;
    end if;
  end loop;

  if v_exists then
    update platform.product_listings
    set enabled = v_row.enabled,
        instant_units = v_row.instant_units,
        request_units = v_row.request_units,
        ready_now = v_row.ready_now,
        lead_time_hours = v_row.lead_time_hours,
        ready_updated_at = v_row.ready_updated_at
    where product_id = p_product_id;
  elsif v_row.enabled
    or v_row.instant_units > 0 or v_row.request_units > 0 or v_row.ready_now > 0
    or v_row.lead_time_hours is not null
  then
    insert into platform.product_listings (
      product_id, tenant_id, enabled, instant_units, request_units, ready_now,
      lead_time_hours, ready_updated_at
    )
    values (
      v_row.product_id, v_row.tenant_id, v_row.enabled, v_row.instant_units, v_row.request_units,
      v_row.ready_now, v_row.lead_time_hours, v_row.ready_updated_at
    );
  end if;

  return jsonb_build_object(
    'enabled', v_row.enabled,
    'instant_units', v_row.instant_units,
    'request_units', v_row.request_units,
    'ready_now', v_row.ready_now,
    'lead_time_hours', v_row.lead_time_hours,
    'ready_updated_at', v_row.ready_updated_at
  );
end;
$$;

revoke all on function platform.save_listing(uuid, jsonb) from public, anon;
grant execute on function platform.save_listing(uuid, jsonb) to authenticated;

-- 6. The functions that named the old columns -----------------------------------------------

-- products_guard: the listing rules left for the guard on the listing. What
-- stays here is the other side of "listed needs an approved entry": a
-- product whose listing is on can't be taken off its entry, or put on one
-- that isn't approved, without the listing going off first.
create or replace function platform_private.products_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry record;
begin
  if new.catalog_id is not null then
    if tg_op = 'INSERT' or new.catalog_id is distinct from old.catalog_id then
      select c.make, c.model, c.vehicle_type, c.cc, c.transmission, c.status, c.requested_by_tenant_id
      into v_entry
      from public.bike_catalog c
      where c.id = new.catalog_id;
      -- An approved entry, or this shop's own submission while it waits.
      if not found or not (
        v_entry.status = 'approved'
        or (v_entry.status = 'requested' and v_entry.requested_by_tenant_id = new.tenant_id)
      ) then
        raise exception 'catalog_entry_not_usable' using errcode = 'P0001';
      end if;
      new.make := v_entry.make;
      new.model := v_entry.model;
      new.vehicle_type := v_entry.vehicle_type;
      new.cc := v_entry.cc;
      new.transmission := v_entry.transmission;
    else
      -- Still linked to the same entry: its description isn't edited here.
      new.make := old.make;
      new.model := old.model;
      new.vehicle_type := old.vehicle_type;
      new.cc := old.cc;
      new.transmission := old.transmission;
    end if;
  end if;

  -- This row is locked by the statement that fired the trigger, so the
  -- listing can't be switched on behind it (save_listing waits for it).
  if tg_op = 'UPDATE'
    and new.catalog_id is distinct from old.catalog_id
    and exists (
      select 1 from platform.product_listings l where l.product_id = new.id and l.enabled
    )
    and (
      new.catalog_id is null
      or not exists (
        select 1 from public.bike_catalog where id = new.catalog_id and status = 'approved'
      )
    )
  then
    raise exception 'not_listable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- products_retire_guard: retiring takes the product off Moto Mangos. The
-- product's row is the one being written (locked); the listing comes second.
create or replace function platform_private.products_retire_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.retired_at is null then
    return new;
  end if;
  if tg_op = 'INSERT' or old.retired_at is null then
    -- Being retired now.
    if exists (
      select 1 from platform.units u
      where u.product_id = new.id and u.status not in ('sold', 'retired')
    ) then
      raise exception 'model_has_active_units' using errcode = 'P0001';
    end if;
    update platform.product_listings
    set enabled = false, instant_units = 0, request_units = 0, ready_now = 0
    where product_id = new.id
      and (enabled or instant_units > 0 or request_units > 0 or ready_now > 0);
  end if;
  -- Still retired and switched on again: refused by the listing's guard
  -- (model_retired).
  return new;
end;
$$;

-- units_clamp_product_counts: as before, on the listing. The product's lock
-- first, as before; then the listing.
create or replace function platform_private.units_clamp_product_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model record;
  v_listing record;
  v_active int;
  v_instant int;
  v_request int;
  v_ready int;
begin
  -- Only when a bike stops counting for old.product_id.
  if tg_op = 'UPDATE' and not (
    old.status = 'active' and (new.status <> 'active' or new.product_id <> old.product_id)
  ) then
    return null;
  end if;
  if tg_op = 'DELETE' and old.status <> 'active' then
    return null;
  end if;

  -- Lock the model first, so two bikes leaving at once count one after the
  -- other and a listing being saved right now is seen (or sees this). Not a
  -- full row lock: that would wait for bikes arriving on this model.
  select id, tenant_id into v_model
  from platform.products
  where id = old.product_id
  for no key update;
  -- Gone already: the model or the whole tenant is being deleted.
  if not found or not exists (select 1 from platform.tenants where id = v_model.tenant_id) then
    return null;
  end if;

  select instant_units, request_units, ready_now into v_listing
  from platform.product_listings
  where product_id = v_model.id
  for update;
  -- Never listed: nothing to keep within the fleet.
  if not found then
    return null;
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
    return null;
  end if;

  update platform.product_listings
  set instant_units = v_instant, request_units = v_request, ready_now = v_ready
  where product_id = v_model.id;

  insert into platform.audit_events (tenant_id, entity, entity_id, action, actor, before, after)
  values (
    v_model.tenant_id, 'products', v_model.id::text, 'clamp_booking_counts', (select auth.uid()),
    jsonb_build_object(
      'instant_units', v_listing.instant_units,
      'request_units', v_listing.request_units,
      'ready_now', v_listing.ready_now
    ),
    jsonb_build_object(
      'instant_units', v_instant,
      'request_units', v_request,
      'ready_now', v_ready,
      'active_units', v_active,
      'because_unit', old.id,
      'unit_change', case
        when tg_op = 'DELETE' then 'deleted'
        when new.product_id <> old.product_id then 'moved to another model'
        else 'status ' || old.status || ' -> ' || new.status
      end
    )
  );
  return null;
end;
$$;

-- review_catalog_request: as before, with the switch on the listing. Every
-- product on the request is locked first, in id order; then its listing.
-- Approving and merging switch the listing on, which is what the shop asked
-- for by sending the request; a product the shop has retired meanwhile is
-- left off (before, the retire rule refused the whole review).
create or replace function platform.review_catalog_request(
  p_catalog_id uuid,
  p_approve boolean,
  p_notes text default null::text,
  p_merge_into uuid default null::uuid,
  p_year_from integer default null::integer,
  p_year_to integer default null::integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
  v_model record;
  v_target_slug text;
  v_decision text;
  v_kept jsonb := '[]';
  v_moved uuid[];
  v_notes text := nullif(btrim(p_notes), '');
begin
  if not platform_private.is_platform_admin() then
    raise exception 'Only platform admins can review catalog entries'
      using errcode = '42501';
  end if;
  select id, make, model, request_note, requested_by_tenant_id into v_request
  from public.bike_catalog
  where id = p_catalog_id
    and status = 'requested'
    and requested_by_tenant_id is not null
  for update;
  if not found then
    raise exception 'Catalog request not found' using errcode = 'P0002';
  end if;

  -- The products first, then (below) their listings.
  perform 1
  from platform.products m
  where m.catalog_id = p_catalog_id
  order by m.id
  for no key update;

  if p_merge_into is not null then
    select slug into v_target_slug
    from public.bike_catalog
    where id = p_merge_into and status = 'approved';
    if v_target_slug is null then
      raise exception 'merge_target_not_approved' using errcode = 'P0001';
    end if;
    v_decision := 'merge';
    -- The shop asked for it to be listed; the target is approved.
    select coalesce(array_agg(m.id order by m.id), '{}') into v_moved
    from platform.products m
    where m.catalog_id = p_catalog_id;
    update platform.products
    set catalog_id = p_merge_into, catalog_approved_at = now()
    where id = any (v_moved);
    insert into platform.product_listings (product_id, tenant_id, enabled)
    select m.id, m.tenant_id, true
    from platform.products m
    where m.id = any (v_moved) and m.retired_at is null
    order by m.id
    on conflict (product_id) do update set enabled = true;
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
    -- What the shop is told, on its own model.
    update platform.products
    set catalog_approved_at = now()
    where catalog_id = p_catalog_id;
    -- ...and listed, which is what the shop asked for by sending it.
    insert into platform.product_listings (product_id, tenant_id, enabled)
    select m.id, m.tenant_id, true
    from platform.products m
    where m.catalog_id = p_catalog_id and m.retired_at is null
    order by m.id
    on conflict (product_id) do update set enabled = true;
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
$$;

revoke all on function platform.review_catalog_request(uuid, boolean, text, uuid, integer, integer) from public, anon;
grant execute on function platform.review_catalog_request(uuid, boolean, text, uuid, integer, integer) to authenticated;

-- disconnect_listing: as before. The listing goes off and to zero first
-- (the product's row is already locked), then the entry is cleared.
create or replace function platform.disconnect_listing(p_product_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_product platform.products;
  v_listing jsonb;
  v_upcoming integer;
begin
  select * into v_product from platform.products where id = p_product_id for update;
  if v_product.id is null or not platform_private.has_role(v_product.tenant_id, '{owner,manager}') then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  if v_product.catalog_id is null then
    raise exception 'not_on_list' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.bike_catalog where id = v_product.catalog_id and status = 'requested'
  ) then
    raise exception 'request_pending' using errcode = 'P0001';
  end if;

  v_listing := platform_private.listing_clear(p_product_id);
  update platform.products
  set catalog_id = null, make = null, model = null, cc = null, transmission = null
  where id = p_product_id;
  v_upcoming := platform_private.upcoming_bookings(p_product_id);
  perform platform_private.audit(
    v_product.tenant_id, 'products', p_product_id::text, 'listing_disconnect',
    jsonb_build_object(
      'catalog_id', v_product.catalog_id, 'make', v_product.make, 'model', v_product.model,
      'marketplace_listed', v_listing -> 'enabled',
      'instant_units', v_listing -> 'instant_units',
      'request_units', v_listing -> 'request_units',
      'ready_now', v_listing -> 'ready_now'),
    jsonb_build_object('upcoming_bookings', v_upcoming));
  return jsonb_build_object('upcoming_bookings', v_upcoming);
end;
$$;

revoke all on function platform.disconnect_listing(uuid) from public, anon;
grant execute on function platform.disconnect_listing(uuid) to authenticated;
