-- Products, stage D4: where prices live (docs/products-redesign.md §9.2;
-- owner's decisions 24 to 28 and the database-stage answers of 15 Nov 2026).
--
-- Builds on the migrations before it, none of which is touched.
--
-- 1. Seven tables: pricing_settings, tax_profiles, price_templates,
--    price_template_days, product_pricing, price_rules, price_rule_products.
--    RLS on; grants written on purpose. Owners, managers and staff read;
--    mechanics and drivers get no row from any of them. Nobody signed in
--    writes them directly.
-- 2. The deposit moves from products to product_pricing, and a shop that has
--    deposits on products is set to "per product". Then the two columns go
--    and products_general_fields_check is put back without them.
-- 3. Guards, updated_at and audit.
-- 4. platform_private.pricing_roles(): who may read and who may write.
-- 5. The save functions, the only way a shop changes a price:
--    save_pricing_settings, save_tax_profile, save_price_template,
--    delete_price_template, save_product_pricing, save_price_rule.
-- 6. platform.pricing_inputs(): the one read that feeds quote() in
--    @mango/core. It returns rows and does no arithmetic.
-- 7. The currency lock counts every amount in the new tables.
--
-- **The database stores and checks; it does not calculate.** No function
-- here multiplies, divides or rounds money. Every price is worked out by
-- quote() in @mango/core.
--
-- Lock order, added to the existing one (advisory 1a02 product-and-location,
-- then 1a01 units; the product's row, then its listing's row):
--   save_product_pricing   the product's row, then the price list's row,
--                          then the pricing row
--   save_price_template    the list's row, then its day rows
--   save_price_rule        the rule's row, then its product links in
--                          product-id order
-- A pricing row is never locked before its product's row, and no product's
-- row is taken while a list's or a rule's is held.
--
-- Not here, by the owner's decision: charge rules, swap settings and the
-- extras table. Each gets its own migration later.

-- 1. The tables -----------------------------------------------------------------------------

-- A shop's own tax profiles: a name and a rate. One of them may be the
-- shop's default (pricing_settings). A profile in use is archived, not deleted.
create table platform.tax_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  name text not null
    constraint tax_profiles_name_check check (length(btrim(name)) between 1 and 80),
  -- Basis points: 7% is 700.
  rate_bp integer not null
    constraint tax_profiles_rate_bp_check check (rate_bp between 0 and 10000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create unique index tax_profiles_name_idx
  on platform.tax_profiles (tenant_id, lower(btrim(name)));

-- One row per shop, made the first time a pricing setting is saved. A shop
-- with no row charges no tax, takes no deposit and accepts no coupons.
create table platform.pricing_settings (
  tenant_id uuid primary key references platform.tenants (id) on delete cascade,
  currency text not null,
  -- Minor units. Quick entry rounds the days it fills in to this (THB ฿10 is
  -- 1000). Null: not chosen yet; the app suggests one for the currency.
  rounding_step bigint
    constraint pricing_settings_rounding_step_check check (rounding_step > 0),
  -- True: the prices the shop types include tax. False: tax is added on top.
  tax_inclusive boolean not null default true,
  -- Null: the shop charges no tax.
  default_tax_profile_id uuid,
  deposit_mode text not null default 'none'
    constraint pricing_settings_deposit_mode_check
    check (deposit_mode in ('none', 'percent_of_order', 'fixed_per_order', 'per_product')),
  deposit_percent_bp integer
    constraint pricing_settings_deposit_percent_bp_check
    check (deposit_percent_bp between 1 and 100000),
  -- fixed_per_order: the amount. per_product: for a vehicle with none of its own.
  deposit_amount bigint
    constraint pricing_settings_deposit_amount_check check (deposit_amount >= 0),
  -- "Accept coupons". Off to start; nothing makes a coupon until Phase 2.
  coupons_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, currency) references platform.tenants (id, currency),
  foreign key (tenant_id, default_tax_profile_id) references platform.tax_profiles (tenant_id, id),
  constraint pricing_settings_deposit_fields_check check (
    case deposit_mode
      when 'none' then deposit_percent_bp is null and deposit_amount is null
      when 'percent_of_order' then deposit_percent_bp is not null and deposit_amount is null
      when 'fixed_per_order' then deposit_percent_bp is null and deposit_amount is not null
      else deposit_percent_bp is null
    end
  )
);

-- A price list: a value for each of days 1 to 30 and, optionally, an hourly
-- one. Two kinds, as Booqable has them:
--   amounts      the values are money, in minor units
--   multipliers  the values are multipliers of a base price that each product
--                on the list sets, in millionths (1.1666 is 1166600)
-- product_id null: a shared list. Filled: that one product's own prices,
-- always amounts, deleted with it.
create table platform.price_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  name text not null
    constraint price_templates_name_check check (length(btrim(name)) between 1 and 120),
  currency text not null,
  product_id uuid,
  kind text not null
    constraint price_templates_kind_check check (kind in ('amounts', 'multipliers')),
  hourly bigint
    constraint price_templates_hourly_check check (hourly > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- So a pricing row can carry the kind of the list it is on (below).
  unique (tenant_id, id, kind),
  foreign key (tenant_id, currency) references platform.tenants (id, currency),
  foreign key (tenant_id, product_id) references platform.products (tenant_id, id) on delete cascade,
  constraint price_templates_own_list_check check (product_id is null or kind = 'amounts')
);

-- One own list per product; a shared list's name is unique in the shop.
create unique index price_templates_product_idx
  on platform.price_templates (product_id) where product_id is not null;
create unique index price_templates_name_idx
  on platform.price_templates (tenant_id, lower(btrim(name))) where product_id is null;
create index price_templates_tenant_idx on platform.price_templates (tenant_id);

create table platform.price_template_days (
  template_id uuid not null,
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  day smallint not null
    constraint price_template_days_day_check check (day between 1 and 30),
  value bigint not null
    constraint price_template_days_value_check check (value > 0),
  -- anchor: typed in quick entry. filled: worked out between two of those.
  -- manual: set by hand, or loaded from another system.
  source text not null
    constraint price_template_days_source_check check (source in ('anchor', 'filled', 'manual')),
  primary key (template_id, day),
  foreign key (tenant_id, template_id)
    references platform.price_templates (tenant_id, id) on delete cascade
);

create index price_template_days_tenant_idx on platform.price_template_days (tenant_id);

-- One row per product that has a price, a deposit, a tax setting or a
-- replacement value. A product with no row, or with no method, has no price.
create table platform.product_pricing (
  product_id uuid primary key,
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  -- Copied by the key below, so the checks can use the product's type.
  product_type text not null,
  currency text not null,
  pricing_method text
    constraint product_pricing_method_check
    check (pricing_method in ('tiered', 'per_period', 'fixed', 'free')),
  -- per_period: for each started period. fixed: once.
  price_amount bigint
    constraint product_pricing_price_amount_check check (price_amount > 0),
  price_period text
    constraint product_pricing_price_period_check
    check (price_period in ('hour', 'day', 'week', 'month')),
  -- tiered: the list, and its kind copied by the key below.
  price_template_id uuid,
  template_kind text,
  -- tiered on a multipliers list: this product's base price.
  base_amount bigint
    constraint product_pricing_base_amount_check check (base_amount > 0),
  -- tiered: each leftover day after whole months. Null: the monthly price ÷ 30.
  long_stay_day bigint
    constraint product_pricing_long_stay_day_check check (long_stay_day > 0),
  -- Per unit; used when the shop's deposit_mode is per_product. Vehicles only.
  deposit bigint
    constraint product_pricing_deposit_check check (deposit >= 0),
  taxable boolean not null default true,
  -- Null: the shop's default profile.
  tax_profile_id uuid,
  -- What a lost one costs the customer. Gear only.
  replacement_price bigint
    constraint product_pricing_replacement_price_check check (replacement_price > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, product_id, product_type)
    references platform.products (tenant_id, id, type) on delete cascade,
  foreign key (tenant_id, currency) references platform.tenants (id, currency),
  -- No action, not restrict: a product deleted with its own list takes both
  -- rows in one statement, and the check runs at its end.
  foreign key (tenant_id, price_template_id, template_kind)
    references platform.price_templates (tenant_id, id, kind),
  foreign key (tenant_id, tax_profile_id) references platform.tax_profiles (tenant_id, id),
  -- Which way of pricing each type of product may use (owner, 15 Nov 2026).
  constraint product_pricing_method_by_type_check check (
    pricing_method is null
    or case product_type
      when 'vehicle' then pricing_method in ('tiered', 'per_period')
      when 'gear' then pricing_method in ('tiered', 'per_period', 'fixed')
      when 'service' then pricing_method in ('per_period', 'fixed', 'free')
      when 'sale_item' then pricing_method = 'fixed'
      else false
    end
  ),
  -- The method decides which price columns are filled.
  constraint product_pricing_method_fields_check check (
    case pricing_method
      when 'tiered' then
        price_template_id is not null and price_amount is null and price_period is null
      when 'per_period' then
        price_amount is not null and price_period is not null and price_template_id is null
      when 'fixed' then
        price_amount is not null and price_period is null and price_template_id is null
      else
        price_amount is null and price_period is null and price_template_id is null
    end
  ),
  constraint product_pricing_template_fields_check check (
    (price_template_id is null) = (template_kind is null)
    and (base_amount is not null) = (template_kind is not distinct from 'multipliers')
    and (long_stay_day is null or pricing_method is not distinct from 'tiered')
  ),
  constraint product_pricing_deposit_vehicle_check
    check (deposit is null or product_type = 'vehicle'),
  constraint product_pricing_replacement_gear_check
    check (replacement_price is null or product_type = 'gear'),
  constraint product_pricing_tax_fields_check
    check (taxable or tax_profile_id is null)
);

create index product_pricing_tenant_idx on platform.product_pricing (tenant_id);
create index product_pricing_template_idx
  on platform.product_pricing (price_template_id) where price_template_id is not null;

-- A season: a date range, every year or one year, a percentage up or down,
-- for every product or for the ones named in price_rule_products. Dates are
-- calendar days at the location.
create table platform.price_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  name text not null
    constraint price_rules_name_check check (length(btrim(name)) between 1 and 120),
  starts_on date not null,
  ends_on date not null,
  -- True: the same days every year; the years in the dates are not used, and
  -- a range such as 15 Dec to 15 Jan wraps over the new year.
  repeats_yearly boolean not null default false,
  -- Basis points: -2000 is 20% off, 1000 is 10% more.
  adjust_bp integer not null
    constraint price_rules_adjust_bp_check
    check (adjust_bp between -9999 and 100000 and adjust_bp <> 0),
  all_products boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint price_rules_dates_check check (repeats_yearly or ends_on >= starts_on)
);

create index price_rules_tenant_idx on platform.price_rules (tenant_id);

create table platform.price_rule_products (
  rule_id uuid not null,
  product_id uuid not null,
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  primary key (rule_id, product_id),
  foreign key (tenant_id, rule_id) references platform.price_rules (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references platform.products (tenant_id, id) on delete cascade
);

create index price_rule_products_product_idx on platform.price_rule_products (product_id);
create index price_rule_products_tenant_idx on platform.price_rule_products (tenant_id);

-- 4 (early, the policies need it). Who may do what with prices -------------------------------
-- The one place that says it (decision 12): owners, managers and staff see
-- prices; owners and managers change them; mechanics and drivers see none.
-- lib/pricing-permissions.ts in the app holds the same table, and a database
-- test compares the two.
create function platform_private.pricing_roles(p_action text)
returns platform.platform_role[]
language sql
immutable
set search_path = ''
as $$
  select case p_action
    when 'read' then '{owner,manager,staff}'::platform.platform_role[]
    when 'write' then '{owner,manager}'::platform.platform_role[]
  end;
$$;

revoke all on function platform_private.pricing_roles(text) from public, anon;
grant execute on function platform_private.pricing_roles(text) to authenticated;

-- RLS and grants. Read only for a signed-in person, and only for the roles
-- that may see prices: no insert, update or delete grant and no policy for
-- them. Every change goes through the functions in 5.
alter table platform.tax_profiles enable row level security;
alter table platform.pricing_settings enable row level security;
alter table platform.price_templates enable row level security;
alter table platform.price_template_days enable row level security;
alter table platform.product_pricing enable row level security;
alter table platform.price_rules enable row level security;
alter table platform.price_rule_products enable row level security;

grant select on platform.tax_profiles to authenticated;
grant select on platform.pricing_settings to authenticated;
grant select on platform.price_templates to authenticated;
grant select on platform.price_template_days to authenticated;
grant select on platform.product_pricing to authenticated;
grant select on platform.price_rules to authenticated;
grant select on platform.price_rule_products to authenticated;

grant select, insert, update, delete on platform.tax_profiles to service_role;
grant select, insert, update, delete on platform.pricing_settings to service_role;
grant select, insert, update, delete on platform.price_templates to service_role;
grant select, insert, update, delete on platform.price_template_days to service_role;
grant select, insert, update, delete on platform.product_pricing to service_role;
grant select, insert, update, delete on platform.price_rules to service_role;
grant select, insert, update, delete on platform.price_rule_products to service_role;

create policy "Owners, managers and staff read tax profiles"
on platform.tax_profiles for select to authenticated
using (tenant_id = any ((select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]));

create policy "Owners, managers and staff read pricing settings"
on platform.pricing_settings for select to authenticated
using (tenant_id = any ((select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]));

create policy "Owners, managers and staff read price lists"
on platform.price_templates for select to authenticated
using (tenant_id = any ((select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]));

create policy "Owners, managers and staff read price list days"
on platform.price_template_days for select to authenticated
using (tenant_id = any ((select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]));

create policy "Owners, managers and staff read product pricing"
on platform.product_pricing for select to authenticated
using (tenant_id = any ((select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]));

create policy "Owners, managers and staff read seasons"
on platform.price_rules for select to authenticated
using (tenant_id = any ((select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]));

create policy "Owners, managers and staff read season products"
on platform.price_rule_products for select to authenticated
using (tenant_id = any ((select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]));

-- 2. The deposit moves ----------------------------------------------------------------------
-- Before the audit triggers exist: this is the same amounts in a new place,
-- not a change anyone made. Only a vehicle can have a deposit
-- (products_general_fields_check), so every row moved is a vehicle's.

insert into platform.product_pricing (product_id, tenant_id, product_type, currency, deposit)
select p.id, p.tenant_id, p.type, p.deposit_currency, p.deposit
from platform.products p
where p.deposit is not null;

-- A shop that has deposits on products keeps working as it did: per
-- product. Every other shop starts on "none" (no row is "none").
insert into platform.pricing_settings (tenant_id, currency, deposit_mode)
select distinct p.tenant_id, t.currency, 'per_product'
from platform.products p
join platform.tenants t on t.id = p.tenant_id
where p.deposit is not null;

-- Dropped by name first, so nothing disappears unnoticed with the columns.
alter table platform.products
  drop constraint products_general_fields_check,
  drop constraint products_tenant_id_deposit_currency_fkey,
  drop constraint products_deposit_check,
  drop constraint products_check;

alter table platform.products
  drop column deposit,
  drop column deposit_currency;

-- As in 20261113000300, without the deposit: a general product stores no
-- buffers. That it has no deposit is now product_pricing_deposit_vehicle_check.
alter table platform.products
  add constraint products_general_fields_check check (
    type = 'vehicle'
    or (buffer_before_minutes is null and buffer_after_minutes is null)
  );

-- 3. Guards, updated_at and audit -----------------------------------------------------------

-- A list has all 30 days and no value lower than the day before it. Equal
-- values on neighbouring days are allowed (owner, 15 Nov 2026). Checked at
-- the end of the transaction, so the rule holds whoever writes the rows, the
-- service role included, and a save may replace all 30 in any order.
create function platform_private.price_template_days_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template uuid;
  v_count int;
  v_falls boolean;
begin
  if tg_op = 'DELETE' then
    v_template := old.template_id;
  else
    v_template := new.template_id;
  end if;
  -- The list itself is gone: so are its days.
  if not exists (select 1 from platform.price_templates where id = v_template) then
    return null;
  end if;
  select count(*), coalesce(bool_or(s.value < s.previous), false)
  into v_count, v_falls
  from (
    select d.value, lag(d.value) over (order by d.day) as previous
    from platform.price_template_days d
    where d.template_id = v_template
  ) s;
  if v_count <> 30 then
    raise exception 'price_list_incomplete' using errcode = 'P0001';
  end if;
  if v_falls then
    raise exception 'price_list_falls' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

revoke all on function platform_private.price_template_days_complete() from public, anon, authenticated;

create constraint trigger price_template_days_complete
after insert or update or delete on platform.price_template_days
deferrable initially deferred
for each row execute function platform_private.price_template_days_complete();

create trigger tax_profiles_set_updated_at
before update on platform.tax_profiles
for each row execute function platform_private.set_updated_at();
create trigger pricing_settings_set_updated_at
before update on platform.pricing_settings
for each row execute function platform_private.set_updated_at();
create trigger price_templates_set_updated_at
before update on platform.price_templates
for each row execute function platform_private.set_updated_at();
create trigger product_pricing_set_updated_at
before update on platform.product_pricing
for each row execute function platform_private.set_updated_at();
create trigger price_rules_set_updated_at
before update on platform.price_rules
for each row execute function platform_private.set_updated_at();

-- Every row change is recorded with who made it. The 30 days of a list and a
-- season's product links are recorded as one named event each, by the
-- functions that write them (template_change, price_rule_change), so a save
-- is one line in the History and not thirty.
create trigger tax_profiles_audit
after insert or update or delete on platform.tax_profiles
for each row execute function platform_private.audit_row();
create trigger pricing_settings_audit
after insert or update or delete on platform.pricing_settings
for each row execute function platform_private.audit_row('tenant_id');
create trigger price_templates_audit
after insert or update or delete on platform.price_templates
for each row execute function platform_private.audit_row();
create trigger product_pricing_audit
after insert or update or delete on platform.product_pricing
for each row execute function platform_private.audit_row('product_id');
create trigger price_rules_audit
after insert or update or delete on platform.price_rules
for each row execute function platform_private.audit_row();

-- 5. The save functions ---------------------------------------------------------------------
-- Each runs with its owner's rights, because nobody signed in may write the
-- tables; so each checks the caller itself with pricing_roles('write'). Each
-- takes a JSON object naming only what is to change, and refuses a name it
-- doesn't know. Amounts are whole numbers of minor units, sent as a JSON
-- number or as a string of digits (a string is safe at any size).

-- Reads a non-negative whole number from p -> p_key. Null when the key is
-- absent or JSON null.
create function platform_private.json_whole(p jsonb, p_key text, p_error text)
returns bigint
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
  if jsonb_typeof(p -> p_key) not in ('number', 'string') or v_text !~ '^[0-9]{1,18}$' then
    raise exception '%', p_error using errcode = '22023';
  end if;
  return v_text::bigint;
end;
$$;

revoke all on function platform_private.json_whole(jsonb, text, text) from public, anon, authenticated;

-- Reads a uuid from p -> p_key. Null when the key is absent or JSON null.
create function platform_private.json_uuid(p jsonb, p_key text, p_error text)
returns uuid
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
    or v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    raise exception '%', p_error using errcode = '22023';
  end if;
  return v_text::uuid;
end;
$$;

revoke all on function platform_private.json_uuid(jsonb, text, text) from public, anon, authenticated;

-- The shop's pricing settings. p_settings names only what is to change:
--   {"rounding_step": 1000, "tax_inclusive": true,
--    "default_tax_profile_id": "…" | null,
--    "deposit_mode": "per_product", "deposit_percent_bp": 3000,
--    "deposit_amount": 200000 | null, "coupons_enabled": false}
-- The numbers that don't belong to the deposit choice in force are cleared.
create function platform.save_pricing_settings(p_tenant_id uuid, p_settings jsonb)
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
    if v_profile is not null and not exists (
      select 1 from platform.tax_profiles
      where id = v_profile and tenant_id = p_tenant_id and archived_at is null
    ) then
      raise exception 'invalid_tax_profile' using errcode = 'P0001';
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

-- Adds or changes a tax profile:
--   {"id": "…" (to change one), "name": "VAT 7%", "rate_bp": 700, "archived": false}
-- A profile is archived, never deleted here: old invoices name it. The
-- shop's default profile can't be archived.
create function platform.save_tax_profile(p_tenant_id uuid, p_profile jsonb)
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
  if p_profile ? 'archived' and (p_profile ->> 'archived')::boolean and exists (
    select 1 from platform.pricing_settings
    where tenant_id = p_tenant_id and default_tax_profile_id = v_id
  ) then
    raise exception 'tax_profile_is_default' using errcode = 'P0001';
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

-- The 30 days of a list, as sent: an array of 30 objects in day order,
--   [{"day": 1, "value": 30000, "source": "anchor"}, …, {"day": 30, …}]
-- Refuses anything else, a value that is not above zero, and a value lower
-- than the day before it. Equal values are allowed.
create function platform_private.check_template_days(p_days jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day jsonb;
  v_index int := 0;
  v_value bigint;
  v_previous bigint := 0;
begin
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) <> 30 then
    raise exception 'price_list_incomplete' using errcode = 'P0001';
  end if;
  for v_day in select * from jsonb_array_elements(p_days) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_day) <> 'object'
      or jsonb_typeof(v_day -> 'day') <> 'number'
      or (v_day ->> 'day') <> v_index::text
      or coalesce(v_day ->> 'source', '') not in ('anchor', 'filled', 'manual')
    then
      raise exception 'invalid_price_list' using errcode = '22023';
    end if;
    v_value := platform_private.json_whole(v_day, 'value', 'invalid_price_list');
    if v_value is null or v_value <= 0 then
      raise exception 'invalid_price_list' using errcode = '22023';
    end if;
    if v_value < v_previous then
      raise exception 'price_list_falls' using errcode = 'P0001';
    end if;
    v_previous := v_value;
  end loop;
end;
$$;

revoke all on function platform_private.check_template_days(jsonb) from public, anon, authenticated;

-- Replaces a list's 30 days and records the change as one event,
-- template_change, with the days that changed and the products on the list.
-- The caller holds the list's row lock and has checked p_days.
create function platform_private.write_template_days(
  p_template_id uuid,
  p_tenant_id uuid,
  p_days jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  select coalesce(jsonb_object_agg(d.day::text, d.value::text), '{}'::jsonb) into v_old
  from platform.price_template_days d
  where d.template_id = p_template_id;
  select jsonb_object_agg(e ->> 'day', e ->> 'value') into v_new
  from jsonb_array_elements(p_days) e;

  delete from platform.price_template_days where template_id = p_template_id;
  insert into platform.price_template_days (template_id, tenant_id, day, value, source)
  select p_template_id, p_tenant_id, (e ->> 'day')::smallint, (e ->> 'value')::bigint, e ->> 'source'
  from jsonb_array_elements(p_days) e
  order by (e ->> 'day')::smallint;

  select jsonb_object_agg(k, v_new -> k), jsonb_object_agg(k, v_old -> k)
  into v_after, v_before
  from jsonb_object_keys(v_new) k
  where v_new -> k is distinct from v_old -> k;
  if v_after is not null then
    perform platform_private.audit(
      p_tenant_id, 'price_templates', p_template_id::text, 'template_change',
      jsonb_build_object('days', v_before),
      jsonb_build_object(
        'days', v_after,
        'products', (
          select coalesce(jsonb_agg(pp.product_id order by pp.product_id), '[]'::jsonb)
          from platform.product_pricing pp
          where pp.price_template_id = p_template_id
        )
      )
    );
  end if;
end;
$$;

revoke all on function platform_private.write_template_days(uuid, uuid, jsonb)
  from public, anon, authenticated;

-- Adds or changes a shared price list:
--   {"id": "…" (to change one), "name": "350–3500", "kind": "multipliers",
--    "hourly": 80000 | null, "days": [30 days]}
-- A new list needs a name, a kind and its 30 days. A list's kind can't be
-- changed afterwards. One product's own prices are saved with the product
-- (save_product_pricing), not here.
create function platform.save_price_template(p_tenant_id uuid, p_template jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row platform.price_templates;
  v_id uuid;
  v_key text;
  v_hourly bigint;
begin
  if p_template is null or jsonb_typeof(p_template) <> 'object' then
    raise exception 'invalid_price_list' using errcode = '22023';
  end if;
  if not platform_private.has_role(p_tenant_id, platform_private.pricing_roles('write')) then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  for v_key in select jsonb_object_keys(p_template) loop
    if v_key not in ('id', 'name', 'kind', 'hourly', 'days') then
      raise exception 'invalid_price_list' using errcode = '22023';
    end if;
  end loop;
  if p_template ? 'name' and jsonb_typeof(p_template -> 'name') <> 'string'
    or p_template ? 'kind' and (
      jsonb_typeof(p_template -> 'kind') <> 'string'
      or (p_template ->> 'kind') not in ('amounts', 'multipliers')
    )
  then
    raise exception 'invalid_price_list' using errcode = '22023';
  end if;
  v_hourly := platform_private.json_whole(p_template, 'hourly', 'invalid_price_list');
  if v_hourly = 0 then
    raise exception 'invalid_price_list' using errcode = '22023';
  end if;
  v_id := platform_private.json_uuid(p_template, 'id', 'invalid_price_list');
  if p_template ? 'days' then
    perform platform_private.check_template_days(p_template -> 'days');
  end if;

  if v_id is null then
    if not (p_template ? 'name' and p_template ? 'kind' and p_template ? 'days') then
      raise exception 'invalid_price_list' using errcode = '22023';
    end if;
    insert into platform.price_templates (tenant_id, name, currency, kind, hourly)
    select p_tenant_id, btrim(p_template ->> 'name'), t.currency, p_template ->> 'kind', v_hourly
    from platform.tenants t
    where t.id = p_tenant_id
    returning id into v_id;
    perform platform_private.write_template_days(v_id, p_tenant_id, p_template -> 'days');
    return v_id;
  end if;

  select * into v_row from platform.price_templates
  where id = v_id and tenant_id = p_tenant_id and product_id is null
  for update;
  if not found then
    raise exception 'invalid_price_list' using errcode = '22023';
  end if;
  if p_template ? 'kind' and (p_template ->> 'kind') <> v_row.kind then
    raise exception 'price_list_kind_fixed' using errcode = 'P0001';
  end if;
  update platform.price_templates
  set name = case when p_template ? 'name' then btrim(p_template ->> 'name') else name end,
      hourly = case when p_template ? 'hourly' then v_hourly else hourly end
  where id = v_id;
  if p_template ? 'days' then
    perform platform_private.write_template_days(v_id, p_tenant_id, p_template -> 'days');
  end if;
  return v_id;
end;
$$;

revoke all on function platform.save_price_template(uuid, jsonb) from public, anon;
grant execute on function platform.save_price_template(uuid, jsonb) to authenticated;

-- Deletes a shared price list. Refused while a product is on it.
create function platform.delete_price_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row platform.price_templates;
begin
  select * into v_row from platform.price_templates
  where id = p_template_id and product_id is null
  for update;
  if not found or not platform_private.has_role(v_row.tenant_id, platform_private.pricing_roles('write')) then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  if exists (select 1 from platform.product_pricing where price_template_id = p_template_id) then
    raise exception 'price_list_in_use' using errcode = 'P0001';
  end if;
  delete from platform.price_templates where id = p_template_id;
end;
$$;

revoke all on function platform.delete_price_template(uuid) from public, anon;
grant execute on function platform.delete_price_template(uuid) to authenticated;

-- A product's pricing. p_settings names only what is to change:
--   {"pricing_method": "tiered" | "per_period" | "fixed" | "free" | null,
--    "price_amount": 20000, "price_period": "day",
--    "price_template_id": "…"            a shared list, or
--    "own_list": {"hourly": 8000 | null, "days": [30 days]}   its own prices,
--    "base_amount": 10000, "long_stay_day": 11666,
--    "deposit": 200000, "taxable": true, "tax_profile_id": "…" | null,
--    "replacement_price": 150000}
-- The columns that don't belong to the method in force are cleared, and an
-- own list the product no longer uses is deleted.
--
-- Locks: the product's row, then the price list's row, then the pricing row.
create function platform.save_product_pricing(p_product_id uuid, p_settings jsonb)
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
    v_profile := platform_private.json_uuid(p_settings, 'tax_profile_id', 'invalid_pricing');
    if v_profile is not null and not exists (
      select 1 from platform.tax_profiles
      where id = v_profile and tenant_id = v_product.tenant_id and archived_at is null
    ) then
      raise exception 'invalid_tax_profile' using errcode = 'P0001';
    end if;
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

-- Adds, changes or deletes a season:
--   {"id": "…" (to change one), "name": "Low season",
--    "starts_on": "2027-04-01", "ends_on": "2027-09-30", "repeats_yearly": true,
--    "adjust_bp": -2000, "all_products": false, "active": true,
--    "product_ids": ["…", "…"], "delete": true}
-- A new season needs a name, both dates and a percentage. product_ids, when
-- named, replaces the whole list of products.
--
-- Locks: the rule's row, then its product links in product-id order. It
-- locks no product.
create function platform.save_price_rule(p_tenant_id uuid, p_rule jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row platform.price_rules;
  v_id uuid;
  v_key text;
  v_before jsonb;
  v_after jsonb;
begin
  if p_rule is null or jsonb_typeof(p_rule) <> 'object' then
    raise exception 'invalid_season' using errcode = '22023';
  end if;
  if not platform_private.has_role(p_tenant_id, platform_private.pricing_roles('write')) then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  for v_key in select jsonb_object_keys(p_rule) loop
    if v_key not in (
      'id', 'name', 'starts_on', 'ends_on', 'repeats_yearly', 'adjust_bp', 'all_products',
      'active', 'product_ids', 'delete'
    ) then
      raise exception 'invalid_season' using errcode = '22023';
    end if;
  end loop;
  if p_rule ? 'name' and jsonb_typeof(p_rule -> 'name') <> 'string'
    or p_rule ? 'starts_on' and (p_rule ->> 'starts_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_rule ? 'ends_on' and (p_rule ->> 'ends_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_rule ? 'repeats_yearly' and jsonb_typeof(p_rule -> 'repeats_yearly') <> 'boolean'
    or p_rule ? 'all_products' and jsonb_typeof(p_rule -> 'all_products') <> 'boolean'
    or p_rule ? 'active' and jsonb_typeof(p_rule -> 'active') <> 'boolean'
    or p_rule ? 'delete' and jsonb_typeof(p_rule -> 'delete') <> 'boolean'
    or p_rule ? 'adjust_bp' and (
      jsonb_typeof(p_rule -> 'adjust_bp') <> 'number'
      or (p_rule ->> 'adjust_bp') !~ '^-?[0-9]{1,6}$'
    )
    or p_rule ? 'product_ids' and (
      jsonb_typeof(p_rule -> 'product_ids') <> 'array'
      or exists (
        select 1 from jsonb_array_elements(p_rule -> 'product_ids') e
        where jsonb_typeof(e) <> 'string'
          or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    )
  then
    raise exception 'invalid_season' using errcode = '22023';
  end if;
  v_id := platform_private.json_uuid(p_rule, 'id', 'invalid_season');

  if v_id is null then
    if not (p_rule ? 'name' and p_rule ? 'starts_on' and p_rule ? 'ends_on' and p_rule ? 'adjust_bp')
      or coalesce((p_rule ->> 'delete')::boolean, false)
    then
      raise exception 'invalid_season' using errcode = '22023';
    end if;
    insert into platform.price_rules (
      tenant_id, name, starts_on, ends_on, repeats_yearly, adjust_bp, all_products, active
    )
    values (
      p_tenant_id, btrim(p_rule ->> 'name'), (p_rule ->> 'starts_on')::date,
      (p_rule ->> 'ends_on')::date, coalesce((p_rule ->> 'repeats_yearly')::boolean, false),
      (p_rule ->> 'adjust_bp')::int, coalesce((p_rule ->> 'all_products')::boolean, false),
      coalesce((p_rule ->> 'active')::boolean, true)
    )
    returning * into v_row;
    v_id := v_row.id;
  else
    select * into v_row from platform.price_rules
    where id = v_id and tenant_id = p_tenant_id
    for update;
    if not found then
      raise exception 'invalid_season' using errcode = '22023';
    end if;
    if coalesce((p_rule ->> 'delete')::boolean, false) then
      delete from platform.price_rules where id = v_id;
      return v_id;
    end if;
    update platform.price_rules
    set name = case when p_rule ? 'name' then btrim(p_rule ->> 'name') else name end,
        starts_on = coalesce((p_rule ->> 'starts_on')::date, starts_on),
        ends_on = coalesce((p_rule ->> 'ends_on')::date, ends_on),
        repeats_yearly = coalesce((p_rule ->> 'repeats_yearly')::boolean, repeats_yearly),
        adjust_bp = coalesce((p_rule ->> 'adjust_bp')::int, adjust_bp),
        all_products = coalesce((p_rule ->> 'all_products')::boolean, all_products),
        active = coalesce((p_rule ->> 'active')::boolean, active)
    where id = v_id
    returning * into v_row;
  end if;

  -- The products it names: the whole list replaced, in product-id order. A
  -- season for every product names none.
  if p_rule ? 'product_ids' or v_row.all_products then
    select coalesce(jsonb_agg(l.product_id order by l.product_id), '[]'::jsonb) into v_before
    from platform.price_rule_products l
    where l.rule_id = v_id;
    delete from platform.price_rule_products where rule_id = v_id;
    if not v_row.all_products then
      insert into platform.price_rule_products (rule_id, product_id, tenant_id)
      select distinct v_id, (e #>> '{}')::uuid, p_tenant_id
      from jsonb_array_elements(coalesce(p_rule -> 'product_ids', '[]'::jsonb)) e
      order by 2;
    end if;
    select coalesce(jsonb_agg(l.product_id order by l.product_id), '[]'::jsonb) into v_after
    from platform.price_rule_products l
    where l.rule_id = v_id;
    if v_after is distinct from v_before then
      perform platform_private.audit(
        p_tenant_id, 'price_rules', v_id::text, 'price_rule_change',
        jsonb_build_object('products', v_before),
        jsonb_build_object('products', v_after)
      );
    end if;
  end if;
  return v_id;
end;
$$;

revoke all on function platform.save_price_rule(uuid, jsonb) from public, anon;
grant execute on function platform.save_price_rule(uuid, jsonb) to authenticated;

-- 6. The one read that feeds quote() --------------------------------------------------------
-- Everything @mango/core's quote() needs to price these products, as rows:
-- the shop's settings, each product's pricing with its price list and its
-- tax rate, and the seasons that name them. It does no arithmetic.
--
-- Runs as the caller, so RLS decides: a mechanic or a driver gets no
-- settings, no products and no seasons. Amounts are sent as strings of
-- digits, so nothing is lost on the way to JavaScript.
create function platform.pricing_inputs(p_tenant_id uuid, p_product_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'settings', (
      select jsonb_build_object(
        'currency', s.currency,
        'rounding_step', s.rounding_step::text,
        'tax_inclusive', s.tax_inclusive,
        'coupons_enabled', s.coupons_enabled,
        'deposit_mode', s.deposit_mode,
        'deposit_percent_bp', s.deposit_percent_bp,
        'deposit_amount', s.deposit_amount::text,
        'default_tax_profile_id', s.default_tax_profile_id
      )
      from platform.pricing_settings s
      where s.tenant_id = p_tenant_id
    ),
    'products', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'product_id', pp.product_id,
          'product_type', pp.product_type,
          'currency', pp.currency,
          'pricing_method', pp.pricing_method,
          'price_amount', pp.price_amount::text,
          'price_period', pp.price_period,
          'base_amount', pp.base_amount::text,
          'long_stay_day', pp.long_stay_day::text,
          'deposit', pp.deposit::text,
          'replacement_price', pp.replacement_price::text,
          'taxable', pp.taxable,
          -- The rate in force: the product's own profile, else the shop's
          -- default. Null: not taxable, or the shop charges no tax.
          'tax_rate_bp', case when pp.taxable then tp.rate_bp end,
          'tax_profile_name', case when pp.taxable then tp.name end,
          'template', case when t.id is not null then jsonb_build_object(
            'id', t.id,
            'name', t.name,
            'kind', t.kind,
            'shared', t.product_id is null,
            'hourly', t.hourly::text,
            'days', (
              select coalesce(jsonb_agg(d.value::text order by d.day), '[]'::jsonb)
              from platform.price_template_days d
              where d.template_id = t.id
            )
          ) end
        )
        order by pp.product_id
      ), '[]'::jsonb)
      from platform.product_pricing pp
      left join platform.price_templates t on t.id = pp.price_template_id
      left join platform.pricing_settings s on s.tenant_id = pp.tenant_id
      left join platform.tax_profiles tp
        on tp.id = coalesce(pp.tax_profile_id, s.default_tax_profile_id)
      where pp.tenant_id = p_tenant_id
        and pp.product_id = any (p_product_ids)
    ),
    'seasons', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'starts_on', r.starts_on,
          'ends_on', r.ends_on,
          'repeats_yearly', r.repeats_yearly,
          'adjust_bp', r.adjust_bp,
          'all_products', r.all_products,
          'product_ids', (
            select coalesce(jsonb_agg(l.product_id order by l.product_id), '[]'::jsonb)
            from platform.price_rule_products l
            where l.rule_id = r.id and l.product_id = any (p_product_ids)
          )
        )
        order by r.starts_on, r.id
      ), '[]'::jsonb)
      from platform.price_rules r
      where r.tenant_id = p_tenant_id
        and r.active
        and (
          r.all_products
          or exists (
            select 1 from platform.price_rule_products l
            where l.rule_id = r.id and l.product_id = any (p_product_ids)
          )
        )
    )
  );
$$;

revoke all on function platform.pricing_inputs(uuid, uuid[]) from public, anon;
grant execute on function platform.pricing_inputs(uuid, uuid[]) to authenticated;

-- 7. The currency lock ----------------------------------------------------------------------
-- A shop's currency is fixed once any amount is stored in it. The deposit on
-- products is gone; every amount in the new tables counts.

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
  );
$$;
