-- Stage D6: a tax profile in use can't be archived (docs/products-redesign.md
-- §9.15 D6, "a profile in use can't be deleted"; reviewed by Fable, 15 Nov 2026).
--
-- Three functions of 20261115000100 are replaced, each a minimal change of
-- its body there; nothing else in them changes, nor any table.
--
-- 1. save_tax_profile refuses to archive a profile that any product's pricing
--    names (tax_profile_in_use), retired products included, as well as the
--    shop's default (tax_profile_is_default, as before). Only a profile going
--    from not archived to archived is refused: renaming an archived profile
--    still works, and a rate change is still allowed. It takes the profile's
--    row for update first, then reads; it locks no settings or pricing row.
-- 2. save_product_pricing takes the profile it names for share, after the
--    price list's row and before the pricing row. Lock order: the product,
--    the price list, the tax profile, the pricing row.
-- 3. save_pricing_settings takes the default profile it names for share,
--    after the settings row.
--
-- So an archive and a save that names the profile never both pass: whichever
-- locks the profile's row first goes first, and the other sees its result.

-- 1. A profile in use is not archived ----------------------------------------

create or replace function platform.save_tax_profile(p_tenant_id uuid, p_profile jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row platform.tax_profiles;
  v_id uuid;
  v_key text;
  v_rate bigint;
begin
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'invalid_tax_profile' using errcode = '22023';
  end if;
  if not platform_private.has_role(p_tenant_id, platform_private.pricing_roles('write')) then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  for v_key in select jsonb_object_keys(p_profile) loop
    if v_key not in ('id', 'name', 'rate_bp', 'archived') then
      raise exception 'invalid_tax_profile' using errcode = '22023';
    end if;
  end loop;
  if p_profile ? 'name' and jsonb_typeof(p_profile -> 'name') <> 'string'
    or p_profile ? 'archived' and jsonb_typeof(p_profile -> 'archived') <> 'boolean'
  then
    raise exception 'invalid_tax_profile' using errcode = '22023';
  end if;
  v_rate := platform_private.json_whole(p_profile, 'rate_bp', 'invalid_tax_profile');
  if v_rate > 10000 then
    raise exception 'invalid_tax_profile' using errcode = '22023';
  end if;
  v_id := platform_private.json_uuid(p_profile, 'id', 'invalid_tax_profile');

  if v_id is null then
    if not (p_profile ? 'name') or v_rate is null then
      raise exception 'invalid_tax_profile' using errcode = '22023';
    end if;
    insert into platform.tax_profiles (tenant_id, name, rate_bp, archived_at)
    values (
      p_tenant_id, btrim(p_profile ->> 'name'), v_rate::int,
      case when coalesce((p_profile ->> 'archived')::boolean, false) then now() end
    )
    returning id into v_id;
    return v_id;
  end if;

  select * into v_row from platform.tax_profiles
  where id = v_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'invalid_tax_profile' using errcode = '22023';
  end if;
  -- Archiving (not yet archived, now to be): refused while any product's
  -- pricing names it, retired products included, or while it is the shop's
  -- default. Plain reads: the profile's row is held for update, and every
  -- writer that names a profile takes it for share first, so neither can
  -- change under this check. No settings or pricing row is locked here.
  if v_row.archived_at is null
    and p_profile ? 'archived' and (p_profile ->> 'archived')::boolean
  then
    if exists (
      select 1 from platform.product_pricing
      where tenant_id = p_tenant_id and tax_profile_id = v_id
    ) then
      raise exception 'tax_profile_in_use' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from platform.pricing_settings
      where tenant_id = p_tenant_id and default_tax_profile_id = v_id
    ) then
      raise exception 'tax_profile_is_default' using errcode = 'P0001';
    end if;
  end if;
  update platform.tax_profiles
  set name = case when p_profile ? 'name' then btrim(p_profile ->> 'name') else name end,
      rate_bp = coalesce(v_rate::int, rate_bp),
      archived_at = case
        when not (p_profile ? 'archived') then archived_at
        when (p_profile ->> 'archived')::boolean then coalesce(archived_at, now())
        else null
      end
  where id = v_id;
  return v_id;
end;
$$;

revoke all on function platform.save_tax_profile(uuid, jsonb) from public, anon;
grant execute on function platform.save_tax_profile(uuid, jsonb) to authenticated;

-- 2. A product's pricing locks the profile it names --------------------------

create or replace function platform.save_product_pricing(p_product_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  where p.id = p_product_id
  for no key update;
  -- Not found, or not this person's shop, or not their role: the same answer.
  if v_product.id is null
    or not platform_private.has_role(v_product.tenant_id, platform_private.pricing_roles('write'))
  then
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
$$;

revoke all on function platform.save_product_pricing(uuid, jsonb) from public, anon;
grant execute on function platform.save_product_pricing(uuid, jsonb) to authenticated;

-- 3. The shop's default locks the profile it names ---------------------------

create or replace function platform.save_pricing_settings(p_tenant_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row platform.pricing_settings;
  v_currency text;
  v_key text;
  v_profile uuid;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'invalid_pricing' using errcode = '22023';
  end if;
  if not platform_private.has_role(p_tenant_id, platform_private.pricing_roles('write')) then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  for v_key in select jsonb_object_keys(p_settings) loop
    if v_key not in (
      'rounding_step', 'tax_inclusive', 'default_tax_profile_id', 'deposit_mode',
      'deposit_percent_bp', 'deposit_amount', 'coupons_enabled'
    ) then
      raise exception 'invalid_pricing' using errcode = '22023';
    end if;
  end loop;

  select currency into v_currency from platform.tenants where id = p_tenant_id;
  -- Two first saves at once: one makes the row, both then wait their turn.
  insert into platform.pricing_settings (tenant_id, currency)
  values (p_tenant_id, v_currency)
  on conflict (tenant_id) do nothing;
  select * into v_row from platform.pricing_settings where tenant_id = p_tenant_id for update;

  if p_settings ? 'rounding_step' then
    v_row.rounding_step := platform_private.json_whole(p_settings, 'rounding_step', 'invalid_pricing');
  end if;
  if p_settings ? 'tax_inclusive' then
    if jsonb_typeof(p_settings -> 'tax_inclusive') <> 'boolean' then
      raise exception 'invalid_pricing' using errcode = '22023';
    end if;
    v_row.tax_inclusive := (p_settings ->> 'tax_inclusive')::boolean;
  end if;
  if p_settings ? 'coupons_enabled' then
    if jsonb_typeof(p_settings -> 'coupons_enabled') <> 'boolean' then
      raise exception 'invalid_pricing' using errcode = '22023';
    end if;
    v_row.coupons_enabled := (p_settings ->> 'coupons_enabled')::boolean;
  end if;
  if p_settings ? 'default_tax_profile_id' then
    v_profile := platform_private.json_uuid(p_settings, 'default_tax_profile_id', 'invalid_pricing');
    -- The settings row is held; then the profile, so it can't be archived
    -- until this save is done.
    if v_profile is not null then
      perform 1 from platform.tax_profiles
      where id = v_profile and tenant_id = p_tenant_id and archived_at is null
      for share;
      if not found then
        raise exception 'invalid_tax_profile' using errcode = 'P0001';
      end if;
    end if;
    v_row.default_tax_profile_id := v_profile;
  end if;
  if p_settings ? 'deposit_mode' then
    if jsonb_typeof(p_settings -> 'deposit_mode') <> 'string'
      or (p_settings ->> 'deposit_mode')
        not in ('none', 'percent_of_order', 'fixed_per_order', 'per_product')
    then
      raise exception 'invalid_pricing' using errcode = '22023';
    end if;
    v_row.deposit_mode := p_settings ->> 'deposit_mode';
  end if;
  if p_settings ? 'deposit_percent_bp' then
    v_row.deposit_percent_bp :=
      platform_private.json_whole(p_settings, 'deposit_percent_bp', 'invalid_pricing');
  end if;
  if p_settings ? 'deposit_amount' then
    v_row.deposit_amount := platform_private.json_whole(p_settings, 'deposit_amount', 'invalid_pricing');
  end if;

  -- Only the numbers of the choice in force are kept.
  if v_row.deposit_mode <> 'percent_of_order' then
    v_row.deposit_percent_bp := null;
  end if;
  if v_row.deposit_mode not in ('fixed_per_order', 'per_product') then
    v_row.deposit_amount := null;
  end if;
  if v_row.deposit_mode = 'percent_of_order' and v_row.deposit_percent_bp is null
    or v_row.deposit_mode = 'fixed_per_order' and v_row.deposit_amount is null
  then
    raise exception 'deposit_number_required' using errcode = 'P0001';
  end if;

  update platform.pricing_settings
  set rounding_step = v_row.rounding_step,
      tax_inclusive = v_row.tax_inclusive,
      default_tax_profile_id = v_row.default_tax_profile_id,
      deposit_mode = v_row.deposit_mode,
      deposit_percent_bp = v_row.deposit_percent_bp,
      deposit_amount = v_row.deposit_amount,
      coupons_enabled = v_row.coupons_enabled
  where tenant_id = p_tenant_id
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function platform.save_pricing_settings(uuid, jsonb) from public, anon;
grant execute on function platform.save_pricing_settings(uuid, jsonb) to authenticated;
