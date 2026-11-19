-- Security audit of 19 Nov 2026: the platform's part (platform schema).
--
-- Builds on 20261118000100_platform_coupons, and applies after
-- 20261119000100_platform_review_followups whether or not that one is
-- there: nothing here needs it, and nothing here touches what it creates.
-- The marketplace's part is 20261120000100 and stands by itself. No earlier
-- migration is touched.
--
--  1. The functions re-created here are as main left them (guard).
--  2. M5: nobody changes or removes an audit row; nobody but the owner
--     truncates a platform table; four more tables are audited.
--  3. A location, a product and a price list never change shop.
--  4. Four functions check the caller before they lock anything.
--  5. A lost unit's problem line: the same role rule by direct update as in
--     update_unit_problem().
--  6. A shop's last owner can't go by a row delete (so not by deleting
--     that user's account either).

-- 1. The functions are as main left them -------------------------------------------------------

do $guard$
declare
  v_expected constant jsonb := jsonb_build_object(
    'platform.save_listing(uuid,jsonb)', '1f5e5ac5fe92d0d7a4facf2ea1230cfc',
    'platform.save_product_pricing(uuid,jsonb)', '5e219d230c2981fd397353399bccd261',
    'platform.delete_price_template(uuid)', '5bd3763de4ff775e12e4b40e9ccf4477',
    'platform.submit_product_to_catalog(uuid,public.bike_type,integer,text,text,text,integer,public.transmission)',
      'd23b15e11893b605218a02df82b6bba5',
    'platform_private.units_guard()', '9ecef4280ebf4c019a053d3addd14df4'
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

-- 2. M5: the audit log ----------------------------------------------------------------------------
-- "No one updates or deletes them" (20261110000200) was true of signed-in
-- users only. The service role held every privilege on the table, so the
-- server's key could rewrite or empty the log, and TRUNCATE (which fires no
-- row trigger and writes no audit row) was granted on every platform table.
--
-- Now: the service role reads the log and may add to it, nothing else; and
-- the table itself refuses update, delete and truncate, whoever asks, its
-- owner included (the pattern of platform_admin_events, 20261119000100).
--
-- One change to a row is let through: its actor emptied, and nothing else
-- touched. That is what deleting a user's account does to the rows that
-- name them (the column's "on delete set null"); without it no user who
-- ever changed anything could be deleted.
--
-- A shop that has audit rows can therefore not be hard-deleted: the delete
-- would take its log with it (the log's key to the shop is "on delete
-- cascade" on main; 20261119000100 makes it "restrict", which says the same
-- thing sooner). Every shop has an audit row from the moment it is created.
-- Closing a shop for good, and how long audit rows are kept, are Phase 4 and
-- Phase 11 (docs/PROGRESS.md); whatever does that will be a deliberate act
-- of the database's owner, with these triggers switched off for it.

revoke update, delete, truncate, references, trigger
  on platform.audit_events from public, anon, authenticated, service_role;

create function platform_private.audit_events_keep()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- An account was deleted: the row keeps everything but who.
    if old.actor is not null and new.actor is null
      and (to_jsonb(new) - 'actor') = (to_jsonb(old) - 'actor')
    then
      return new;
    end if;
  end if;
  raise exception 'audit_events_are_kept' using errcode = '42501';
end;
$$;

-- A trigger function: nobody calls it.
revoke all on function platform_private.audit_events_keep()
  from public, anon, authenticated;

create trigger audit_events_keep_rows
before update or delete on platform.audit_events
for each row execute function platform_private.audit_events_keep();
create trigger audit_events_keep_all
before truncate on platform.audit_events
for each statement execute function platform_private.audit_events_keep();

-- TRUNCATE on every platform table: from every role that had it. The tables'
-- owner keeps it, as an owner must; nothing in either app truncates.
-- apps/platform/tests/db/security-audit.test.ts fails if a later table
-- grants it again.
do $truncate$
declare
  v_table regclass;
begin
  for v_table in
    select c.oid::regclass
    from pg_class c
    where c.relnamespace = 'platform'::regnamespace and c.relkind in ('r', 'p')
  loop
    execute format(
      'revoke truncate on %s from public, anon, authenticated, service_role', v_table);
  end loop;
end;
$truncate$;

-- Four tables that had no audit trigger. Their rows are written by
-- functions that record a summary of the save (write_template_days,
-- save_price_rule, save_coupon, save_product_extras); a row written any
-- other way (the service role, a later function) left no record. Each row
-- change is now recorded as well, under the table's own name, so the
-- screens that read the summaries (they ask for 'price_templates',
-- 'price_rules', 'coupons', and 'product_extras' by product) see what they
-- saw before. The id recorded for a link row is its parent's.
create trigger price_template_days_audit
after insert or update or delete on platform.price_template_days
for each row execute function platform_private.audit_row('template_id');

create trigger price_rule_products_audit
after insert or update or delete on platform.price_rule_products
for each row execute function platform_private.audit_row('rule_id');

create trigger coupon_products_audit
after insert or update or delete on platform.coupon_products
for each row execute function platform_private.audit_row('coupon_id');

create trigger product_extras_audit
after insert or update or delete on platform.product_extras
for each row execute function platform_private.audit_row();

-- 3. A row never changes shop ---------------------------------------------------------------------
-- Nothing changes the tenant_id of a location, a product or a price list
-- today, and other keys happened to refuse most ways of trying. Now it is a
-- rule of the table: the functions in section 4 read a row's shop, check the
-- caller against it, and only then lock the row, which is sound only if the
-- shop can't change in between.

create function platform_private.tenant_is_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_is_fixed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function platform_private.tenant_is_fixed()
  from public, anon, authenticated;

create trigger locations_tenant_is_fixed
before update of tenant_id on platform.locations
for each row execute function platform_private.tenant_is_fixed();

create trigger products_tenant_is_fixed
before update of tenant_id on platform.products
for each row execute function platform_private.tenant_is_fixed();

create trigger price_templates_tenant_is_fixed
before update of tenant_id on platform.price_templates
for each row execute function platform_private.tenant_is_fixed();

-- 4. The caller is checked before anything is locked ----------------------------------------------
-- save_listing(), save_product_pricing(), delete_price_template() and
-- submit_product_to_catalog() took the row's lock first and asked who was
-- calling second. Anyone signed in, from any shop, could make a shop's own
-- saves (and its bookings, which read that row "for share") wait on a row
-- they had no right to touch, for as long as their call ran, and repeat it.
--
-- Each now reads the row without a lock, checks the caller, and only then
-- takes the same lock as before and reads the row again. Everything after
-- that point is as main had it, line for line. The lock order (CLAUDE.md)
-- is unchanged: the same locks, in the same order, taken by fewer callers.
--
-- Each body below is main's (from the database, md5 in the guard above)
-- with only that change.

create or replace function platform.save_listing(p_product_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  where p.id = p_product_id;
  -- Read without a lock: someone who is about to be refused must not be
  -- able to hold up the shop's own saves by asking.
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

  -- The caller may: now the product's row, then the listing's. A product
  -- never changes shop (products_tenant_is_fixed), so what was checked
  -- above still holds; it may have been deleted meanwhile.
  select p.id, p.tenant_id, p.type into v_product
  from platform.products p
  where p.id = p_product_id
  for no key update;
  if v_product.id is null then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;

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
$function$;

create or replace function platform.save_product_pricing(p_product_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product record;
  v_row platform.product_pricing;
  v_template platform.price_templates;
  v_exists boolean;
  v_key text;
  v_currency text;
  v_own uuid;
  v_shared uuid;
  v_hourly bigint;
  v_old_method text;
  v_profile uuid;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'invalid_pricing' using errcode = '22023';
  end if;

  select p.id, p.tenant_id, p.type, p.name into v_product
  from platform.products p
  where p.id = p_product_id;
  -- Read without a lock: someone who is about to be refused must not be
  -- able to hold up the shop's own saves by asking.
  -- Not found, or not this person's shop, or not their role: the same answer.
  if v_product.id is null
    or not platform_private.has_role(v_product.tenant_id, platform_private.pricing_roles('write'))
  then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  -- The caller may: now the product's row. A product never changes shop
  -- (products_tenant_is_fixed), so what was checked above still holds; it
  -- may have been deleted meanwhile.
  select p.id, p.tenant_id, p.type, p.name into v_product
  from platform.products p
  where p.id = p_product_id
  for no key update;
  if v_product.id is null then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;

  for v_key in select jsonb_object_keys(p_settings) loop
    if v_key not in (
      'pricing_method', 'price_amount', 'price_period', 'price_template_id', 'own_list',
      'base_amount', 'long_stay_day', 'deposit', 'taxable', 'tax_profile_id', 'replacement_price'
    ) then
      raise exception 'invalid_pricing' using errcode = '22023';
    end if;
  end loop;
  if p_settings ? 'own_list' and p_settings ? 'price_template_id' then
    raise exception 'invalid_pricing' using errcode = '22023';
  end if;

  select currency into v_currency from platform.tenants where id = v_product.tenant_id;
  select id into v_own from platform.price_templates where product_id = p_product_id;

  -- The price list's row, before the pricing row.
  if p_settings ? 'own_list' then
    if jsonb_typeof(p_settings -> 'own_list') <> 'object' then
      raise exception 'invalid_pricing' using errcode = '22023';
    end if;
    perform platform_private.check_template_days(p_settings -> 'own_list' -> 'days');
    v_hourly := platform_private.json_whole(p_settings -> 'own_list', 'hourly', 'invalid_price_list');
    if v_hourly = 0 then
      raise exception 'invalid_price_list' using errcode = '22023';
    end if;
    if v_own is null then
      insert into platform.price_templates (tenant_id, name, currency, product_id, kind, hourly)
      values (v_product.tenant_id, v_product.name, v_currency, p_product_id, 'amounts', v_hourly)
      returning id into v_own;
    else
      perform 1 from platform.price_templates where id = v_own for update;
      update platform.price_templates set hourly = v_hourly where id = v_own;
    end if;
    perform platform_private.write_template_days(
      v_own, v_product.tenant_id, p_settings -> 'own_list' -> 'days'
    );
  elsif p_settings ? 'price_template_id' then
    v_shared := platform_private.json_uuid(p_settings, 'price_template_id', 'invalid_pricing');
    if v_shared is not null then
      select * into v_template from platform.price_templates
      where id = v_shared and tenant_id = v_product.tenant_id and product_id is null
      for key share;
      if not found then
        raise exception 'invalid_price_list' using errcode = '22023';
      end if;
    end if;
  end if;

  -- The tax profile's row, after the list's and before the pricing row: a
  -- profile named here can't be archived until this save is done
  -- (save_tax_profile takes it for update before it looks for products).
  if p_settings ? 'tax_profile_id' then
    v_profile := platform_private.json_uuid(p_settings, 'tax_profile_id', 'invalid_pricing');
    if v_profile is not null then
      perform 1 from platform.tax_profiles
      where id = v_profile and tenant_id = v_product.tenant_id and archived_at is null
      for share;
      if not found then
        raise exception 'invalid_tax_profile' using errcode = 'P0001';
      end if;
    end if;
  end if;

  select * into v_row from platform.product_pricing where product_id = p_product_id for update;
  v_exists := found;
  if not v_exists then
    v_row.product_id := p_product_id;
    v_row.tenant_id := v_product.tenant_id;
    v_row.product_type := v_product.type;
    v_row.currency := v_currency;
    v_row.taxable := true;
  end if;
  v_old_method := v_row.pricing_method;

  if p_settings ? 'pricing_method' then
    if jsonb_typeof(p_settings -> 'pricing_method') = 'null' then
      v_row.pricing_method := null;
    elsif jsonb_typeof(p_settings -> 'pricing_method') <> 'string'
      or (p_settings ->> 'pricing_method') not in ('tiered', 'per_period', 'fixed', 'free')
    then
      raise exception 'invalid_pricing' using errcode = '22023';
    else
      v_row.pricing_method := p_settings ->> 'pricing_method';
    end if;
  end if;
  -- Which way of pricing each type may use: said here in words, and held by
  -- product_pricing_method_by_type_check whoever writes.
  if v_row.pricing_method is not null and not (
    case v_product.type
      when 'vehicle' then v_row.pricing_method in ('tiered', 'per_period')
      when 'gear' then v_row.pricing_method in ('tiered', 'per_period', 'fixed')
      when 'service' then v_row.pricing_method in ('per_period', 'fixed', 'free')
      when 'sale_item' then v_row.pricing_method = 'fixed'
      else false
    end
  ) then
    raise exception 'pricing_method_not_allowed' using errcode = 'P0001';
  end if;

  if p_settings ? 'price_amount' then
    v_row.price_amount := platform_private.json_whole(p_settings, 'price_amount', 'invalid_pricing');
  end if;
  if p_settings ? 'price_period' then
    if jsonb_typeof(p_settings -> 'price_period') = 'null' then
      v_row.price_period := null;
    elsif jsonb_typeof(p_settings -> 'price_period') <> 'string'
      or (p_settings ->> 'price_period') not in ('hour', 'day', 'week', 'month')
    then
      raise exception 'invalid_pricing' using errcode = '22023';
    else
      v_row.price_period := p_settings ->> 'price_period';
    end if;
  end if;
  if p_settings ? 'base_amount' then
    v_row.base_amount := platform_private.json_whole(p_settings, 'base_amount', 'invalid_pricing');
  end if;
  if p_settings ? 'long_stay_day' then
    v_row.long_stay_day := platform_private.json_whole(p_settings, 'long_stay_day', 'invalid_pricing');
  end if;
  if p_settings ? 'deposit' then
    v_row.deposit := platform_private.json_whole(p_settings, 'deposit', 'invalid_pricing');
    if v_row.deposit is not null and v_product.type <> 'vehicle' then
      raise exception 'deposit_vehicles_only' using errcode = 'P0001';
    end if;
  end if;
  if p_settings ? 'replacement_price' then
    v_row.replacement_price :=
      platform_private.json_whole(p_settings, 'replacement_price', 'invalid_pricing');
    if v_row.replacement_price is not null and v_product.type <> 'gear' then
      raise exception 'replacement_gear_only' using errcode = 'P0001';
    end if;
  end if;
  -- A price of zero is refused: nothing is charged only by choosing "free".
  if v_row.price_amount = 0 or v_row.base_amount = 0 or v_row.long_stay_day = 0
    or v_row.replacement_price = 0
  then
    raise exception 'price_zero' using errcode = 'P0001';
  end if;
  if p_settings ? 'taxable' then
    if jsonb_typeof(p_settings -> 'taxable') <> 'boolean' then
      raise exception 'invalid_pricing' using errcode = '22023';
    end if;
    v_row.taxable := (p_settings ->> 'taxable')::boolean;
  end if;
  if p_settings ? 'tax_profile_id' then
    -- Checked and locked above.
    v_row.tax_profile_id := v_profile;
  end if;

  if p_settings ? 'own_list' then
    v_row.price_template_id := v_own;
    v_row.template_kind := 'amounts';
  elsif p_settings ? 'price_template_id' then
    v_row.price_template_id := v_shared;
    v_row.template_kind := v_template.kind;
  end if;

  -- Only the columns of the method in force are kept.
  if v_row.pricing_method is distinct from 'tiered' then
    v_row.price_template_id := null;
    v_row.template_kind := null;
    v_row.long_stay_day := null;
  end if;
  if v_row.pricing_method is distinct from 'per_period' then
    v_row.price_period := null;
  end if;
  if v_row.pricing_method is null or v_row.pricing_method not in ('per_period', 'fixed') then
    v_row.price_amount := null;
  end if;
  if v_row.template_kind is distinct from 'multipliers' then
    v_row.base_amount := null;
  end if;
  if not v_row.taxable then
    v_row.tax_profile_id := null;
  end if;
  -- What is missing for the method chosen, in words instead of a check's name.
  if v_row.pricing_method = 'tiered' and v_row.price_template_id is null then
    raise exception 'price_list_required' using errcode = 'P0001';
  end if;
  if v_row.pricing_method in ('per_period', 'fixed') and v_row.price_amount is null
    or v_row.pricing_method = 'per_period' and v_row.price_period is null
  then
    raise exception 'price_required' using errcode = 'P0001';
  end if;
  if v_row.template_kind = 'multipliers' and v_row.base_amount is null then
    raise exception 'base_price_required' using errcode = 'P0001';
  end if;

  if v_exists then
    update platform.product_pricing
    set pricing_method = v_row.pricing_method,
        price_amount = v_row.price_amount,
        price_period = v_row.price_period,
        price_template_id = v_row.price_template_id,
        template_kind = v_row.template_kind,
        base_amount = v_row.base_amount,
        long_stay_day = v_row.long_stay_day,
        deposit = v_row.deposit,
        taxable = v_row.taxable,
        tax_profile_id = v_row.tax_profile_id,
        replacement_price = v_row.replacement_price
    where product_id = p_product_id
    returning * into v_row;
  else
    insert into platform.product_pricing (
      product_id, tenant_id, product_type, currency, pricing_method, price_amount, price_period,
      price_template_id, template_kind, base_amount, long_stay_day, deposit, taxable,
      tax_profile_id, replacement_price
    )
    values (
      v_row.product_id, v_row.tenant_id, v_row.product_type, v_row.currency, v_row.pricing_method,
      v_row.price_amount, v_row.price_period, v_row.price_template_id, v_row.template_kind,
      v_row.base_amount, v_row.long_stay_day, v_row.deposit, v_row.taxable, v_row.tax_profile_id,
      v_row.replacement_price
    )
    returning * into v_row;
  end if;

  -- Its own list, no longer the one it is priced from: gone.
  if v_own is not null and v_row.price_template_id is distinct from v_own then
    delete from platform.price_templates where id = v_own;
  end if;

  -- How it is priced changing is an event of its own on the product.
  if v_row.pricing_method is distinct from v_old_method then
    perform platform_private.audit(
      v_row.tenant_id, 'products', p_product_id::text, 'pricing_change',
      jsonb_build_object('pricing_method', v_old_method),
      jsonb_build_object('pricing_method', v_row.pricing_method)
    );
  end if;
  return to_jsonb(v_row);
end;
$function$;

create or replace function platform.delete_price_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row platform.price_templates;
begin
  select * into v_row from platform.price_templates
  where id = p_template_id and product_id is null;
  -- Read without a lock: someone who is about to be refused must not be
  -- able to hold up the shop's own saves by asking.
  if not found or not platform_private.has_role(v_row.tenant_id, platform_private.pricing_roles('write')) then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  -- The caller may: now the list's row. A price list never changes shop
  -- (price_templates_tenant_is_fixed), so what was checked above still holds; it
  -- may have been deleted meanwhile.
  select * into v_row from platform.price_templates
  where id = p_template_id and product_id is null
  for update;
  if not found then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  if exists (select 1 from platform.product_pricing where price_template_id = p_template_id) then
    raise exception 'price_list_in_use' using errcode = 'P0001';
  end if;
  delete from platform.price_templates where id = p_template_id;
end;
$function$;

create or replace function platform.submit_product_to_catalog(
  p_product_id uuid,
  p_type public.bike_type,
  p_year integer default null,
  p_note text default null,
  p_make text default null,
  p_model text default null,
  p_cc integer default null,
  p_transmission public.transmission default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_model platform.products;
  v_id uuid;
begin
  -- Read without a lock: someone who is about to be refused must not be
  -- able to hold up the shop's own saves by asking.
  select * into v_model from platform.products where id = p_product_id;
  -- Same answer for "no such product" and "not your shop".
  if v_model.id is null or not platform_private.has_role(v_model.tenant_id, '{owner,manager}') then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  -- The caller may: now the product's row. A product never changes shop
  -- (products_tenant_is_fixed), so what was checked above still holds; it
  -- may have been deleted meanwhile.
  select * into v_model from platform.products where id = p_product_id for update;
  if v_model.id is null then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  if v_model.catalog_id is not null then
    raise exception 'already_linked' using errcode = 'P0001';
  end if;
  if v_model.vehicle_type <> 'motorbike' then
    raise exception 'only_motorbikes' using errcode = 'P0001';
  end if;

  v_model.make := coalesce(nullif(btrim(p_make), ''), v_model.make);
  v_model.model := coalesce(nullif(btrim(p_model), ''), v_model.model);
  v_model.cc := coalesce(p_cc, v_model.cc);
  v_model.transmission := coalesce(p_transmission, v_model.transmission);
  -- Moto Mangos search filters by all four.
  if v_model.make is null or v_model.model is null
    or v_model.cc is null or v_model.transmission is null
    or p_year is null
  then
    raise exception 'specs_required' using errcode = 'P0001';
  end if;

  insert into public.bike_catalog (
    make, model, year_from, year_to, type, transmission, cc, vehicle_type,
    request_note, status, requested_by_tenant_id
  )
  values (
    btrim(v_model.make), btrim(v_model.model), p_year, p_year, p_type,
    v_model.transmission, v_model.cc, v_model.vehicle_type,
    nullif(btrim(p_note), ''), 'requested', v_model.tenant_id
  )
  returning id into v_id;

  -- On its own request now; products_guard copies the description from it.
  update platform.products
  set catalog_id = v_id,
      make = v_model.make,
      model = v_model.model,
      cc = v_model.cc,
      transmission = v_model.transmission
  where id = p_product_id;
  perform platform_private.audit(v_model.tenant_id, 'bike_catalog', v_id::text, 'submit',
    null, jsonb_build_object('product_id', p_product_id, 'make', v_model.make, 'model', v_model.model, 'year', p_year));
  return v_id;
end;
$function$;

-- 5. A lost unit's problem line ---------------------------------------------------------------------
-- units_guard let anyone below manager change problem_on, expected_back and
-- problem_notes on any gear unit by a direct update. update_unit_problem()
-- has a rule: a unit in repair is edited by whoever may put it in repair
-- (owners, managers, staff, mechanics), a lost one by whoever may mark it
-- lost (owners, managers, staff). A mechanic could do by direct update what
-- the function refuses. units_guard as main had it, plus that one check.

create or replace function platform_private.units_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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
$function$;

-- 6. A shop's last owner stays --------------------------------------------------------------------
-- remove_member() and set_member_role() refuse to leave a shop without an
-- owner. A row delete did not: deleting the only owner's user account took
-- their membership with it (memberships.user_id is "on delete cascade"),
-- and the service role could delete or demote the row directly. The table
-- now refuses it itself, with the functions' own words.
--
-- So the only owner's account can't be deleted until someone else is made
-- an owner. Who that should be when an owner asks for their account to be
-- erased is part of closing a shop (Phase 11, docs/PROGRESS.md).
--
-- It takes the shop's row ("for no key update", so two of these take
-- turns, and a team change through the functions, which hold that row "for
-- update", is waited out by neither): without waiting. Postgres locks the
-- membership's row before this trigger runs, and the functions lock the
-- shop's row before the membership's, so waiting here would be the other
-- order. If a team change holds the row at that moment this is refused
-- with 55P03 and can be sent again. When the whole shop is being deleted
-- its row is already gone and its memberships go with it.

create function platform_private.memberships_keep_an_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'owner' or (tg_op = 'UPDATE' and new.role = 'owner') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  perform 1 from platform.tenants where id = old.tenant_id for no key update nowait;
  if found and not exists (
    select 1 from platform.memberships
    where tenant_id = old.tenant_id and role = 'owner' and id <> old.id
  ) then
    raise exception 'A shop needs at least one owner' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function platform_private.memberships_keep_an_owner()
  from public, anon, authenticated;

create trigger memberships_keep_an_owner
before delete or update of role on platform.memberships
for each row execute function platform_private.memberships_keep_an_owner();
