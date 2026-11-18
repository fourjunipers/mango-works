-- Phase 2, stage 8: coupons in the database (docs/phase-2-plan.md §3.2, §4,
-- §5.3, §6, §8 stage 8, with the §12 edits; docs/PROGRESS.md, stage 7, "For
-- stage 8"). Migration 5 of the plan.
--
-- Builds on 20261117000200_platform_extras_opt_out. No earlier migration is
-- touched.
--
--  1. A guard: the seven functions re-created below must still have the
--     bodies main gave them (MD5 of the stored source). A database whose
--     copy has drifted stops here, with nothing changed.
--  2. The code's one normaliser, platform_private.normalize_coupon_code():
--     the same rule as @mango/core's normalizeCouponCode.
--  3. Tables: coupons, coupon_products, coupon_redemptions. RLS, grants,
--     updated_at, audit.
--  4. The returning-customer settings on pricing_settings.
--  5. save_pricing_settings() and pricing_inputs() re-created to carry them.
--  6. save_coupon(): owners and managers. 6-second lock timeout.
--  7. coupon_uses() and coupon_inputs(): the one read decideDiscounts needs.
--  8. reserve() re-created: the coupon's row, its recheck under the lock,
--     and the redemption. cancel_reservation() and the hold sweep
--     (expire_holds()) re-created: the use is given back.
--  9. The currency lock counts a coupon that holds an amount of money.
--
-- Lock order (root CLAUDE.md; plan §4). Coupon rows are rows, so they come
-- after every advisory lock:
--
--   reserve()             product-and-location locks; unit locks; unit rows;
--                         product rows; listing rows (Moto Mangos); THE
--                         COUPON'S ROW (for update); then the sweep's
--                         reservations and blocks; then the inserts.
--   cancel_reservation()  product-and-location locks; unit locks; THE
--                         COUPON'S ROW (for update); reservations; blocks;
--                         the redemption.
--   the hold sweep        as before: reservations, then blocks. It sets
--                         released_at on the redemption and takes NO coupon
--                         row: the sweep inside reserve() runs with that
--                         call's own coupon row already held, and a second
--                         coupon row there could not be taken in id order.
--                         It does not need one: a use is only ever ADDED
--                         under the coupon's row; one given back without it
--                         can only make a count read high for a moment.
--   save_coupon()         no advisory lock. The coupon's row (for update),
--                         then its product links in product-id order. A new
--                         link takes its product's row for key share (the
--                         foreign key), which a booking's "for share" does
--                         not block.

-- 1. The functions are as main left them -------------------------------------------------------

do $guard$
declare
  v_expected constant jsonb := jsonb_build_object(
    'platform.reserve(uuid, jsonb)', 'd38413ff072b5db4bd0470dd16d05532',
    'platform.cancel_reservation(uuid, uuid, uuid)', 'd9d027600fd6ac40db35b9a4fb6d784e',
    'platform_private.expire_holds(uuid, uuid[], uuid[], timestamptz)',
      '93e204f23400cf8292e3d45e323a94be',
    'platform.save_pricing_settings(uuid, jsonb)', 'dbd61712f2c4d2b00c99fffd861244e5',
    'platform.pricing_inputs(uuid, uuid[])', '2753d9bdbb7712ebefe027b68e8978b3',
    'platform_private.tenants_lock_currency()', '4b545b4c94e3d10b1172745cfd33f7fe',
    'platform.currency_locked(uuid)', '20c8317efa611bd2ecc721fdde56e7ba'
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

-- 2. The code's one normaliser -----------------------------------------------------------------
-- A code as it is stored and compared. Two steps, and nothing else:
--   1. every space and invisible character in the list below is removed;
--   2. the 26 letters a to z become A to Z.
-- No other character is changed: no Unicode case mapping (ß stays ß, it
-- does not become SS) and no folding of full-width letters, so the answer
-- does not depend on the database's locale and @mango/core gives the same
-- one, character for character (normalizeCouponCode in discounts.ts; the
-- shared cases are in coupon-code.cases.ts and a database test runs them
-- through both).
--
-- The characters removed: tab, line feed, vertical tab, form feed, carriage
-- return, space, no-break space, U+1680, U+2000 to U+200A, line and
-- paragraph separator, U+202F, U+205F, the ideographic space, the byte
-- order mark, and the zero-width space, non-joiner, joiner and word joiner.
--
-- save_coupon() accepts only A to Z and 0 to 9 after this, so a code with
-- any other character can never be saved, and one typed with such a
-- character finds no coupon.

create function platform_private.normalize_coupon_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
    p_code,
    'abcdefghijklmnopqrstuvwxyz'
      || U&'\0009\000A\000B\000C\000D\0020\00A0\1680'
      || U&'\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A'
      || U&'\2028\2029\202F\205F\3000\FEFF\200B\200C\200D\2060',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  );
$$;

revoke all on function platform_private.normalize_coupon_code(text) from public, anon;
-- coupon_inputs() runs as its caller.
grant execute on function platform_private.normalize_coupon_code(text)
  to authenticated, service_role;

-- 3. The tables --------------------------------------------------------------------------------
-- Every setting is the shop's; nothing is preset (plan §5.3).

create table platform.coupons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  -- The shop's currency. A coupon that holds an amount of money (a fixed
  -- amount, or a minimum spend) locks it (9 below); one that holds none
  -- follows the shop if its currency is changed.
  currency text not null,
  -- Normalised (2 above): compared by equality.
  code text not null
    constraint coupons_code_check check (code ~ '^[A-Z0-9]{1,40}$'),
  -- The shop's own note.
  name text not null default ''
    constraint coupons_name_check check (length(name) <= 120),
  kind text not null
    constraint coupons_kind_check check (kind in ('percent', 'fixed')),
  percent_bp integer
    constraint coupons_percent_bp_check check (percent_bp between 1 and 10000),
  -- Minor units, off the coupon's lines together.
  amount bigint
    constraint coupons_amount_check check (amount > 0),
  -- True: every product. False: the rows of coupon_products.
  all_products boolean not null default true,
  -- Calendar days at the location, both included: when the booking is made.
  valid_from date,
  valid_to date,
  -- Calendar days at the location, both included: the rental must start here.
  pickup_from date,
  pickup_to date,
  min_days integer
    constraint coupons_min_days_check check (min_days between 1 and 1000),
  -- Minor units: what the coupon's own lines must come to after seasons.
  min_spend bigint
    constraint coupons_min_spend_check check (min_spend > 0),
  max_uses integer
    constraint coupons_max_uses_check check (max_uses >= 1),
  max_uses_per_customer integer
    constraint coupons_max_uses_per_customer_check check (max_uses_per_customer >= 1),
  -- Staff covers the counter and the phone. No api: it takes no coupon yet.
  channels text[] not null default '{}'
    constraint coupons_channels_check check (
      channels <@ array['staff', 'booking_page', 'marketplace']
      and array_position(channels, null) is null
    ),
  -- May be combined with the automatic returning-customer discount.
  with_returning_discount boolean not null default false,
  -- "Can be used on season discounts" (the owner, 18 Nov 2026). False: a
  -- line a season made cheaper is not one of the coupon's lines.
  with_season_discount boolean not null default true,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint coupons_currency_fkey
    foreign key (tenant_id, currency) references platform.tenants (id, currency)
    on update cascade,
  constraint coupons_kind_fields_check check (
    case kind
      when 'percent' then percent_bp is not null and amount is null
      else amount is not null and percent_bp is null
    end
  ),
  constraint coupons_valid_dates_check check (valid_to >= valid_from),
  constraint coupons_pickup_dates_check check (pickup_to >= pickup_from)
);

-- One live coupon per code in a shop. An archived coupon gives its code
-- back: a new coupon may take it, and the lookup (coupon_inputs) finds the
-- live one first, else the one archived last.
create unique index coupons_code_key
  on platform.coupons (tenant_id, code) where archived_at is null;
create index coupons_tenant_code_idx on platform.coupons (tenant_id, code);

comment on column platform.coupons.code is
  'Stored as platform_private.normalize_coupon_code() gives it: A to Z and 0 to 9 only. Unique in the shop among coupons that are not archived.';

create table platform.coupon_products (
  coupon_id uuid not null,
  product_id uuid not null,
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  primary key (coupon_id, product_id),
  foreign key (tenant_id, coupon_id)
    references platform.coupons (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id)
    references platform.products (tenant_id, id) on delete cascade
);

create index coupon_products_product_idx on platform.coupon_products (product_id);
create index coupon_products_tenant_idx on platform.coupon_products (tenant_id);

-- One use of a coupon by one booking. Written by reserve() under the
-- coupon's row; given back (released_at) by cancel_reservation() and by the
-- hold sweep. The amount is what the quote said the coupon took: the
-- database never works it out.
create table platform.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  coupon_id uuid not null,
  -- reservations.booking_id; Phase 3's order takes it over.
  booking_id uuid not null,
  -- Empty until customers exist (Phase 3).
  customer_id uuid,
  amount bigint not null
    constraint coupon_redemptions_amount_check check (amount >= 0),
  redeemed_at timestamptz not null default now(),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- No action, not restrict: a shop deleted whole takes both.
  foreign key (tenant_id, coupon_id) references platform.coupons (tenant_id, id)
);

-- One coupon per booking.
create unique index coupon_redemptions_booking_key
  on platform.coupon_redemptions (booking_id) where released_at is null;
create index coupon_redemptions_coupon_idx
  on platform.coupon_redemptions (coupon_id) where released_at is null;
create index coupon_redemptions_tenant_idx on platform.coupon_redemptions (tenant_id);

-- Coupons are read like prices (plan §6, §11): owners, managers and staff.
-- Nobody signed in writes any of the three: save_coupon() for the first
-- two; reserve(), cancel_reservation() and the hold sweep for the third.
alter table platform.coupons enable row level security;
alter table platform.coupon_products enable row level security;
alter table platform.coupon_redemptions enable row level security;

grant select on platform.coupons to authenticated;
grant select on platform.coupon_products to authenticated;
grant select on platform.coupon_redemptions to authenticated;

grant select, insert, update, delete on platform.coupons to service_role;
grant select, insert, update, delete on platform.coupon_products to service_role;
grant select, insert, update, delete on platform.coupon_redemptions to service_role;

create policy "Owners, managers and staff read coupons"
on platform.coupons for select to authenticated
using (tenant_id = any ((select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]));

create policy "Owners, managers and staff read coupon products"
on platform.coupon_products for select to authenticated
using (tenant_id = any ((select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]));

create policy "Owners, managers and staff read coupon uses"
on platform.coupon_redemptions for select to authenticated
using (tenant_id = any ((select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]));

create trigger coupons_set_updated_at
before update on platform.coupons
for each row execute function platform_private.set_updated_at();
create trigger coupon_redemptions_set_updated_at
before update on platform.coupon_redemptions
for each row execute function platform_private.set_updated_at();

-- Every change to a coupon and every use is recorded with who made it. A
-- coupon's product links are one named event (coupon_change) written by
-- save_coupon(), as a season's are.
create trigger coupons_audit
after insert or update or delete on platform.coupons
for each row execute function platform_private.audit_row();
create trigger coupon_redemptions_audit
after insert or update or delete on platform.coupon_redemptions
for each row execute function platform_private.audit_row();

-- 4. The returning-customer discount's settings ------------------------------------------------
-- Off to start. A percentage, and how many completed rentals at this shop
-- make a customer "returning" (plan §5.3, Q8). Who is returning comes from
-- orders in Phase 3; until then it is an input to decideDiscounts.

alter table platform.pricing_settings
  add column returning_enabled boolean not null default false,
  add column returning_percent_bp integer
    constraint pricing_settings_returning_percent_bp_check
    check (returning_percent_bp between 1 and 10000),
  add column returning_rentals_needed integer not null default 1
    constraint pricing_settings_returning_rentals_needed_check
    check (returning_rentals_needed between 1 and 1000),
  add constraint pricing_settings_returning_percent_required_check
    check (not returning_enabled or returning_percent_bp is not null);

-- 5. save_pricing_settings() and pricing_inputs() re-created -----------------------------------
-- save_pricing_settings(): as in 20261115000100, with three more names:
--   {"returning_enabled": true, "returning_percent_bp": 1000,
--    "returning_rentals_needed": 1}
-- The percentage is 1 to 10000 and the rentals 1 to 1000 (invalid_pricing
-- otherwise). Switched on with no percentage: returning_percent_required.
-- Its grants are as they were.

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
      'deposit_percent_bp', 'deposit_amount', 'coupons_enabled',
      'returning_enabled', 'returning_percent_bp', 'returning_rentals_needed'
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

  -- The automatic returning-customer discount.
  if p_settings ? 'returning_enabled' then
    if jsonb_typeof(p_settings -> 'returning_enabled') <> 'boolean' then
      raise exception 'invalid_pricing' using errcode = '22023';
    end if;
    v_row.returning_enabled := (p_settings ->> 'returning_enabled')::boolean;
  end if;
  if p_settings ? 'returning_percent_bp' then
    v_row.returning_percent_bp :=
      platform_private.json_whole(p_settings, 'returning_percent_bp', 'invalid_pricing');
    if v_row.returning_percent_bp not between 1 and 10000 then
      raise exception 'invalid_pricing' using errcode = '22023';
    end if;
  end if;
  if p_settings ? 'returning_rentals_needed' then
    v_row.returning_rentals_needed :=
      platform_private.json_whole(p_settings, 'returning_rentals_needed', 'invalid_pricing');
    if v_row.returning_rentals_needed is null
      or v_row.returning_rentals_needed not between 1 and 1000
    then
      raise exception 'invalid_pricing' using errcode = '22023';
    end if;
  end if;
  if v_row.returning_enabled and v_row.returning_percent_bp is null then
    raise exception 'returning_percent_required' using errcode = 'P0001';
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
      coupons_enabled = v_row.coupons_enabled,
      returning_enabled = v_row.returning_enabled,
      returning_percent_bp = v_row.returning_percent_bp,
      returning_rentals_needed = v_row.returning_rentals_needed
  where tenant_id = p_tenant_id
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function platform.save_pricing_settings(uuid, jsonb) from public, anon;
grant execute on function platform.save_pricing_settings(uuid, jsonb)
  to authenticated, service_role;

-- pricing_inputs(): as in 20261117000200, with the three settings in
-- "settings". Runs as its caller, as before.

create or replace function platform.pricing_inputs(p_tenant_id uuid, p_product_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  with extras as (
    select v.id as product_id, x.extra_product_id, x.extra_product_type,
      x.included_quantity, x.max_quantity, x.sort_position,
      x.product_id is null as every_vehicle
    from platform.products v
    join platform.product_extras x
      on x.tenant_id = v.tenant_id and (x.product_id = v.id or x.product_id is null)
    join platform.products e on e.id = x.extra_product_id
    where v.tenant_id = p_tenant_id
      and v.id = any (p_product_ids)
      and v.type = 'vehicle'
      and e.retired_at is null
      and (
        -- The vehicle's own row, unless it says "not offered".
        (x.product_id is not null and x.offered)
        -- The "every vehicle" row, unless the vehicle has its own row for
        -- that extra (which wins, an opted-out one too).
        or x.product_id is null and not exists (
          select 1 from platform.product_extras own
          where own.tenant_id = x.tenant_id
            and own.product_id = v.id
            and own.extra_product_id = x.extra_product_id
        )
      )
  ),
  v as (
    select coalesce(p_product_ids, '{}')
      || array(select distinct extra_product_id from extras) as ids
  )
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
        'default_tax_profile_id', s.default_tax_profile_id,
        -- The automatic returning-customer discount (decideDiscounts).
        'returning_enabled', s.returning_enabled,
        'returning_percent_bp', s.returning_percent_bp,
        'returning_rentals_needed', s.returning_rentals_needed
      )
      from platform.pricing_settings s
      where s.tenant_id = p_tenant_id
    ),
    'products', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'product_id', pp.product_id,
          'product_name', pr.name,
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
          'tax_profile_id', case when pp.taxable then tp.id end,
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
      join platform.products pr on pr.id = pp.product_id
      left join platform.price_templates t on t.id = pp.price_template_id
      left join platform.pricing_settings s on s.tenant_id = pp.tenant_id
      left join platform.tax_profiles tp
        on tp.id = coalesce(pp.tax_profile_id, s.default_tax_profile_id)
      where pp.tenant_id = p_tenant_id
        and pp.product_id = any ((select ids from v)::uuid[])
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
            where l.rule_id = r.id and l.product_id = any ((select ids from v)::uuid[])
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
            where l.rule_id = r.id and l.product_id = any ((select ids from v)::uuid[])
          )
        )
    ),
    'extras', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'product_id', x.product_id,
          'extra_product_id', x.extra_product_id,
          'extra_product_type', x.extra_product_type,
          'included_quantity', x.included_quantity,
          'max_quantity', x.max_quantity,
          'sort_position', x.sort_position,
          'every_vehicle', x.every_vehicle
        )
        order by x.product_id, x.every_vehicle, x.sort_position, x.extra_product_id
      ), '[]'::jsonb)
      from extras x
    )
  );
$$;

revoke all on function platform.pricing_inputs(uuid, uuid[]) from public, anon;
grant execute on function platform.pricing_inputs(uuid, uuid[]) to authenticated, service_role;

-- 6. save_coupon() -----------------------------------------------------------------------------
-- Reads a calendar day from p -> p_key. Null when the key is absent or JSON
-- null. A day that is not on the calendar (30 Feb) is refused.
create function platform_private.json_day(p jsonb, p_key text, p_error text)
returns date
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
  if jsonb_typeof(p -> p_key) <> 'string' or v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception '%', p_error using errcode = '22023';
  end if;
  begin
    return v_text::date;
  exception
    when others then
      raise exception '%', p_error using errcode = '22023';
  end;
end;
$$;

revoke all on function platform_private.json_day(jsonb, text, text) from public, anon, authenticated;

-- Adds or changes a coupon. p_coupon names only what is to change:
--   {"id": "…" (to change one), "code": "summer 10", "name": "Summer",
--    "kind": "percent" | "fixed", "percent_bp": 1000, "amount": 20000,
--    "all_products": false, "product_ids": ["…"],
--    "valid_from": "2027-06-01" | null, "valid_to": …,
--    "pickup_from": …, "pickup_to": …, "min_days": 3 | null,
--    "min_spend": 100000 | null, "max_uses": 50 | null,
--    "max_uses_per_customer": 1 | null,
--    "channels": ["staff", "booking_page", "marketplace"],
--    "with_returning_discount": false, "with_season_discount": true,
--    "active": true, "archived": false}
-- A new coupon needs a code and a kind with its number. product_ids, when
-- named, replaces the whole list; a coupon for chosen products needs one.
-- Only the number of the kind in force is kept. "archived": true archives;
-- false brings it back (code_taken if a live coupon has its code by then).
--
-- The code is normalised, must then be A to Z and 0 to 9 only (1 to 40),
-- and is unique in the shop among coupons that are not archived.
--
-- Answers the saved coupon with its product_ids.
-- Raises: only_owner_or_manager (42501); invalid_coupon, invalid_code
-- (22023); coupon_not_found, product_not_found, code_taken (P0001: another
-- shop's coupon or product is answered exactly like a made-up id); 55P03
-- when a lock can't be had in 6 seconds.
--
-- Locks: the coupon's row (for update), then its product links in
-- product-id order. No advisory lock.

create function platform.save_coupon(p_tenant_id uuid, p_coupon jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row platform.coupons;
  v_id uuid;
  v_key text;
  v_whole bigint;
  v_products uuid[];
  v_before jsonb;
  v_after jsonb;
begin
  if p_tenant_id is null or p_coupon is null or jsonb_typeof(p_coupon) <> 'object' then
    raise exception 'invalid_coupon' using errcode = '22023';
  end if;
  if not platform_private.has_role(p_tenant_id, platform_private.pricing_roles('write')) then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  for v_key in select jsonb_object_keys(p_coupon) loop
    if v_key not in (
      'id', 'code', 'name', 'kind', 'percent_bp', 'amount', 'all_products', 'product_ids',
      'valid_from', 'valid_to', 'pickup_from', 'pickup_to', 'min_days', 'min_spend',
      'max_uses', 'max_uses_per_customer', 'channels', 'with_returning_discount',
      'with_season_discount', 'active', 'archived'
    ) then
      raise exception 'invalid_coupon' using errcode = '22023';
    end if;
  end loop;
  if p_coupon ? 'code' and jsonb_typeof(p_coupon -> 'code') <> 'string'
    or p_coupon ? 'name' and jsonb_typeof(p_coupon -> 'name') <> 'string'
    or p_coupon ? 'kind' and (
      jsonb_typeof(p_coupon -> 'kind') <> 'string'
      or (p_coupon ->> 'kind') not in ('percent', 'fixed')
    )
    or exists (
      select 1
      from unnest(array[
        'all_products', 'with_returning_discount', 'with_season_discount', 'active', 'archived'
      ]) k
      where p_coupon ? k and jsonb_typeof(p_coupon -> k) <> 'boolean'
    )
    or p_coupon ? 'channels' and (
      jsonb_typeof(p_coupon -> 'channels') <> 'array'
      or exists (
        select 1 from jsonb_array_elements(p_coupon -> 'channels') e
        where jsonb_typeof(e) <> 'string'
          or (e #>> '{}') not in ('staff', 'booking_page', 'marketplace')
      )
    )
    or p_coupon ? 'product_ids' and (
      jsonb_typeof(p_coupon -> 'product_ids') <> 'array'
      or jsonb_array_length(p_coupon -> 'product_ids') > 500
      or exists (
        select 1 from jsonb_array_elements(p_coupon -> 'product_ids') e
        where jsonb_typeof(e) <> 'string'
          or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    )
  then
    raise exception 'invalid_coupon' using errcode = '22023';
  end if;
  v_id := platform_private.json_uuid(p_coupon, 'id', 'invalid_coupon');

  if v_id is null then
    if not (p_coupon ? 'code' and p_coupon ? 'kind') then
      raise exception 'invalid_coupon' using errcode = '22023';
    end if;
    v_row.tenant_id := p_tenant_id;
    select t.currency into v_row.currency from platform.tenants t where t.id = p_tenant_id;
    v_row.name := '';
    v_row.all_products := true;
    v_row.channels := '{}';
    v_row.with_returning_discount := false;
    v_row.with_season_discount := true;
    v_row.active := true;
  else
    -- Not found, or another shop's: the same answer.
    select * into v_row from platform.coupons
    where id = v_id and tenant_id = p_tenant_id
    for update;
    if not found then
      raise exception 'coupon_not_found' using errcode = 'P0001';
    end if;
    -- Then its product links, in product-id order.
    perform 1 from platform.coupon_products l
    where l.coupon_id = v_id
    order by l.product_id
    for update;
  end if;

  -- What is named replaces what was there.
  if p_coupon ? 'code' then
    v_row.code := platform_private.normalize_coupon_code(p_coupon ->> 'code');
  end if;
  if v_row.code is null or v_row.code !~ '^[A-Z0-9]{1,40}$' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  if p_coupon ? 'name' then
    v_row.name := btrim(p_coupon ->> 'name');
    if length(v_row.name) > 120 then
      raise exception 'invalid_coupon' using errcode = '22023';
    end if;
  end if;
  if p_coupon ? 'kind' then
    v_row.kind := p_coupon ->> 'kind';
  end if;
  if p_coupon ? 'percent_bp' then
    v_row.percent_bp := platform_private.json_whole(p_coupon, 'percent_bp', 'invalid_coupon');
  end if;
  if p_coupon ? 'amount' then
    v_row.amount := platform_private.json_whole(p_coupon, 'amount', 'invalid_coupon');
  end if;
  -- Only the number of the kind in force is kept.
  if v_row.kind = 'percent' then
    v_row.amount := null;
    if v_row.percent_bp is null or v_row.percent_bp not between 1 and 10000 then
      raise exception 'invalid_coupon' using errcode = '22023';
    end if;
  else
    v_row.percent_bp := null;
    if v_row.amount is null or v_row.amount < 1 then
      raise exception 'invalid_coupon' using errcode = '22023';
    end if;
  end if;
  if p_coupon ? 'all_products' then
    v_row.all_products := (p_coupon ->> 'all_products')::boolean;
  end if;
  if p_coupon ? 'valid_from' then
    v_row.valid_from := platform_private.json_day(p_coupon, 'valid_from', 'invalid_coupon');
  end if;
  if p_coupon ? 'valid_to' then
    v_row.valid_to := platform_private.json_day(p_coupon, 'valid_to', 'invalid_coupon');
  end if;
  if p_coupon ? 'pickup_from' then
    v_row.pickup_from := platform_private.json_day(p_coupon, 'pickup_from', 'invalid_coupon');
  end if;
  if p_coupon ? 'pickup_to' then
    v_row.pickup_to := platform_private.json_day(p_coupon, 'pickup_to', 'invalid_coupon');
  end if;
  if v_row.valid_to < v_row.valid_from or v_row.pickup_to < v_row.pickup_from then
    raise exception 'invalid_coupon' using errcode = '22023';
  end if;
  if p_coupon ? 'min_days' then
    v_whole := platform_private.json_whole(p_coupon, 'min_days', 'invalid_coupon');
    if v_whole not between 1 and 1000 then
      raise exception 'invalid_coupon' using errcode = '22023';
    end if;
    v_row.min_days := v_whole;
  end if;
  if p_coupon ? 'min_spend' then
    v_row.min_spend := platform_private.json_whole(p_coupon, 'min_spend', 'invalid_coupon');
    if v_row.min_spend < 1 then
      raise exception 'invalid_coupon' using errcode = '22023';
    end if;
  end if;
  if p_coupon ? 'max_uses' then
    v_whole := platform_private.json_whole(p_coupon, 'max_uses', 'invalid_coupon');
    if v_whole not between 1 and 2000000000 then
      raise exception 'invalid_coupon' using errcode = '22023';
    end if;
    v_row.max_uses := v_whole;
  end if;
  if p_coupon ? 'max_uses_per_customer' then
    v_whole := platform_private.json_whole(p_coupon, 'max_uses_per_customer', 'invalid_coupon');
    if v_whole not between 1 and 2000000000 then
      raise exception 'invalid_coupon' using errcode = '22023';
    end if;
    v_row.max_uses_per_customer := v_whole;
  end if;
  if p_coupon ? 'channels' then
    select coalesce(array_agg(distinct e #>> '{}' order by e #>> '{}'), '{}')
    into v_row.channels
    from jsonb_array_elements(p_coupon -> 'channels') e;
  end if;
  if p_coupon ? 'with_returning_discount' then
    v_row.with_returning_discount := (p_coupon ->> 'with_returning_discount')::boolean;
  end if;
  if p_coupon ? 'with_season_discount' then
    v_row.with_season_discount := (p_coupon ->> 'with_season_discount')::boolean;
  end if;
  if p_coupon ? 'active' then
    v_row.active := (p_coupon ->> 'active')::boolean;
  end if;
  if p_coupon ? 'archived' then
    v_row.archived_at := case
      when (p_coupon ->> 'archived')::boolean then coalesce(v_row.archived_at, now())
    end;
  end if;

  -- The products it names, before anything is written. Not found, or
  -- another shop's: the same answer.
  if p_coupon ? 'product_ids' then
    select coalesce(array_agg(distinct (e #>> '{}')::uuid), '{}') into v_products
    from jsonb_array_elements(p_coupon -> 'product_ids') e;
    if exists (
      select 1 from unnest(v_products) i
      where not exists (
        select 1 from platform.products p where p.id = i and p.tenant_id = p_tenant_id
      )
    ) then
      raise exception 'product_not_found' using errcode = 'P0001';
    end if;
  end if;

  -- The row. Two live coupons can't share a code: the index says so, for
  -- two saves at the same instant too.
  begin
    if v_id is null then
      insert into platform.coupons (
        tenant_id, currency, code, name, kind, percent_bp, amount, all_products,
        valid_from, valid_to, pickup_from, pickup_to, min_days, min_spend, max_uses,
        max_uses_per_customer, channels, with_returning_discount, with_season_discount,
        active, archived_at
      )
      values (
        v_row.tenant_id, v_row.currency, v_row.code, v_row.name, v_row.kind, v_row.percent_bp,
        v_row.amount, v_row.all_products, v_row.valid_from, v_row.valid_to, v_row.pickup_from,
        v_row.pickup_to, v_row.min_days, v_row.min_spend, v_row.max_uses,
        v_row.max_uses_per_customer, v_row.channels, v_row.with_returning_discount,
        v_row.with_season_discount, v_row.active, v_row.archived_at
      )
      returning * into v_row;
      v_id := v_row.id;
    else
      update platform.coupons
      set code = v_row.code,
          name = v_row.name,
          kind = v_row.kind,
          percent_bp = v_row.percent_bp,
          amount = v_row.amount,
          all_products = v_row.all_products,
          valid_from = v_row.valid_from,
          valid_to = v_row.valid_to,
          pickup_from = v_row.pickup_from,
          pickup_to = v_row.pickup_to,
          min_days = v_row.min_days,
          min_spend = v_row.min_spend,
          max_uses = v_row.max_uses,
          max_uses_per_customer = v_row.max_uses_per_customer,
          channels = v_row.channels,
          with_returning_discount = v_row.with_returning_discount,
          with_season_discount = v_row.with_season_discount,
          active = v_row.active,
          archived_at = v_row.archived_at
      where id = v_id
      returning * into v_row;
    end if;
  exception
    when unique_violation then
      raise exception 'code_taken' using errcode = 'P0001';
  end;

  -- Its product links, in product-id order: the ones no longer named go,
  -- the new ones are added, the rest are left as they are. A coupon for
  -- every product names none.
  select coalesce(jsonb_agg(l.product_id order by l.product_id), '[]'::jsonb) into v_before
  from platform.coupon_products l
  where l.coupon_id = v_id;
  if v_row.all_products then
    delete from platform.coupon_products where coupon_id = v_id;
  elsif p_coupon ? 'product_ids' then
    delete from platform.coupon_products
    where coupon_id = v_id and product_id <> all (v_products);
    begin
      insert into platform.coupon_products (coupon_id, product_id, tenant_id)
      select v_id, i, p_tenant_id
      from unnest(v_products) i
      where not exists (
        select 1 from platform.coupon_products l where l.coupon_id = v_id and l.product_id = i
      )
      order by i;
    exception
      -- Deleted since it was looked up.
      when foreign_key_violation then
        raise exception 'product_not_found' using errcode = 'P0001';
    end;
  end if;
  select coalesce(jsonb_agg(l.product_id order by l.product_id), '[]'::jsonb) into v_after
  from platform.coupon_products l
  where l.coupon_id = v_id;
  -- A coupon for chosen products with none chosen could never be used.
  if not v_row.all_products and v_after = '[]'::jsonb then
    raise exception 'invalid_coupon' using errcode = '22023';
  end if;
  if v_after is distinct from v_before then
    perform platform_private.audit(
      p_tenant_id, 'coupons', v_id::text, 'coupon_change',
      jsonb_build_object('products', v_before),
      jsonb_build_object('products', v_after)
    );
  end if;

  return to_jsonb(v_row) || jsonb_build_object('product_ids', v_after);
end;
$$;

-- Owners and managers (checked inside). Not the server's.
revoke all on function platform.save_coupon(uuid, jsonb) from public, anon, service_role;
grant execute on function platform.save_coupon(uuid, jsonb) to authenticated;
-- It waits for the coupon's row behind a booking that holds it. Shorter
-- than the API's 8-second statement timeout, as the booking functions have:
-- a wait that runs out raises 55P03 with nothing written, and the caller
-- (apps/platform/lib/coupon-save.ts) answers "try again".
alter function platform.save_coupon(uuid, jsonb) set lock_timeout = '6s';

-- 7. The read decideDiscounts needs ------------------------------------------------------------
-- A coupon's uses that have not been given back: in total, and by one
-- customer (0 when none is named).
--
-- p_except_booking_id: that booking's own use is left out, so a held
-- booking priced again is not refused as used_up by the very use it holds.
--
-- A hold that has run out holds no use, swept or not: it can no longer be
-- confirmed (confirm_hold refuses it), so its use is as good as given back
-- before the sweep gets to it.
--
-- Runs as its caller: under RLS for a member, with the owner's rights
-- inside reserve().
create function platform_private.coupon_uses(
  p_coupon_id uuid,
  p_customer_id uuid,
  p_except_booking_id uuid
)
returns table (total integer, customer integer)
language sql
stable
set search_path = ''
as $$
  select count(*)::integer,
    (count(*) filter (where p_customer_id is not null and x.customer_id = p_customer_id))::integer
  from platform.coupon_redemptions x
  where x.coupon_id = p_coupon_id
    and x.released_at is null
    and x.booking_id is distinct from p_except_booking_id
    and not (
      exists (
        select 1 from platform.reservations r
        where r.tenant_id = x.tenant_id and r.booking_id = x.booking_id
          and r.state = 'held' and r.hold_expires_at <= now()
      )
      and not exists (
        select 1 from platform.reservations r
        where r.tenant_id = x.tenant_id and r.booking_id = x.booking_id
          and (
            r.state in ('reserved', 'out', 'returned')
            or r.state = 'held' and r.hold_expires_at > now()
          )
      )
    );
$$;

revoke all on function platform_private.coupon_uses(uuid, uuid, uuid) from public, anon;
grant execute on function platform_private.coupon_uses(uuid, uuid, uuid)
  to authenticated, service_role;

-- Everything decideDiscounts() needs about one code, in one read: the
-- coupon it finds (its settings and its product ids) and its uses so far.
-- The returning-customer settings come with pricing_inputs().
--
-- The code is normalised and compared by equality. A live coupon is found
-- first; else the one archived last, so an archived code answers
-- "not_active" and not "unknown". No coupon: {"coupon": null, "uses": null}.
--
-- Runs as its caller, so RLS decides: owners, managers and staff, and the
-- server. A mechanic, a driver, another shop's member and a stranger find
-- no coupon; another shop's code looks exactly like no such code. Amounts
-- are strings of digits, like pricing_inputs().
create function platform.coupon_inputs(
  p_tenant_id uuid,
  p_code text,
  p_booking_id uuid default null,
  p_customer_id uuid default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with found as (
    select c.*
    from platform.coupons c
    where c.tenant_id = p_tenant_id
      and c.code = platform_private.normalize_coupon_code(p_code)
    order by (c.archived_at is null) desc, c.archived_at desc, c.id
    limit 1
  )
  select jsonb_build_object(
    'coupon', (
      select jsonb_build_object(
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
      )
      from found c
    ),
    'uses', (
      select jsonb_build_object('total', u.total, 'customer', u.customer)
      from found c, platform_private.coupon_uses(c.id, p_customer_id, p_booking_id) u
    )
  );
$$;

revoke all on function platform.coupon_inputs(uuid, text, uuid, uuid) from public, anon;
grant execute on function platform.coupon_inputs(uuid, text, uuid, uuid)
  to authenticated, service_role;

-- 8. The booking functions ---------------------------------------------------------------------
-- A booking's use of its coupon is given back once nothing of the booking
-- is left: every row cancelled or expired. A booking cancelled in part
-- keeps it. Called by cancel_reservation() and the hold sweep, each with
-- the booking's reservation rows locked.
create function platform_private.release_coupon_use(p_tenant_id uuid, p_booking_id uuid)
returns void
language sql
set search_path = ''
as $$
  update platform.coupon_redemptions x
  set released_at = now()
  where x.tenant_id = p_tenant_id
    and x.booking_id = p_booking_id
    and x.released_at is null
    and not exists (
      select 1 from platform.reservations r
      where r.tenant_id = p_tenant_id and r.booking_id = p_booking_id
        and r.state not in ('cancelled', 'expired')
    );
$$;

revoke all on function platform_private.release_coupon_use(uuid, uuid)
  from public, anon, authenticated;

-- reserve(): as in 20261116000300, with the coupon. The request may carry
--   "coupon": {"coupon_id": uuid, "amount": "20000", "customer_id": uuid | null}
-- the coupon decideDiscounts() applied and what the quote says it took (the
-- quote's lines added up by discountId). A coupon that was not applied is
-- not sent, and writes no redemption.
--
-- The rules ran before the transaction. Under the coupon's row, taken for
-- update after the products' and the listings' rows, what can have changed
-- since is checked again: switched off, archived, another currency than the
-- shop's, a fixed coupon taking more than its amount (coupon_not_valid),
-- and the uses, in total and by this customer (coupon_used_up). No such
-- coupon, or another shop's, is coupon_not_valid too, before any lock. The
-- redemption is written with the reservations, so a refusal writes nothing.
-- Every other check, lock and answer is as it was; so are the grants and
-- the 6-second lock timeout.

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
  -- The coupon: which one, what the quote says it took, and whose use it is.
  v_coupon_id uuid;
  v_coupon_amount bigint;
  v_customer_id uuid;
  v_currency text;
  v_coupon record;
  v_uses record;
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
    if v_key not in ('channel', 'mode', 'hold', 'lines', 'coupon') then
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
  -- "Ride today" is Moto Mangos' alone.
  if v_mode = 'now' and v_channel <> 'marketplace' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- The shop's settings. Only a signed-in member's booking can be saved
  -- short; an online channel never creates a shortage.
  select t.allow_overbooking and not v_online, t.hold_minutes,
    t.buffer_before_minutes, t.buffer_after_minutes, t.currency
  into v_overbook, v_hold_minutes, v_shop_before, v_shop_after, v_currency
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

  -- The coupon, as decideDiscounts() and the quote left it: which one, and
  -- what it took. One per booking.
  if p_request ? 'coupon' and jsonb_typeof(p_request -> 'coupon') <> 'null' then
    if jsonb_typeof(p_request -> 'coupon') <> 'object' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(p_request -> 'coupon') loop
      if v_key not in ('coupon_id', 'amount', 'customer_id') then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
    end loop;
    v_coupon_id := platform_private.json_uuid(p_request -> 'coupon', 'coupon_id', 'invalid_request');
    v_coupon_amount := platform_private.json_whole(p_request -> 'coupon', 'amount', 'invalid_request');
    v_customer_id := platform_private.json_uuid(p_request -> 'coupon', 'customer_id', 'invalid_request');
    if v_coupon_id is null or v_coupon_amount is null then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    -- No such coupon, or another shop's: the same answer, before any lock.
    if not exists (
      select 1 from platform.coupons c
      where c.id = v_coupon_id and c.tenant_id = p_tenant_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'coupon_not_valid', 'line', null);
    end if;
  end if;

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

      -- 6. The coupon's row, after the products' and the listings' rows
      -- and before any reservation or block. The rules ran before this
      -- transaction (decideDiscounts); what a save or another booking can
      -- have changed since is read again here, under the lock: switched
      -- off, archived, another currency, and the uses. Two bookings after a
      -- coupon's last use take turns at this row, and the second counts
      -- the first's redemption.
      if v_coupon_id is not null then
        select c.active, c.archived_at, c.currency, c.kind, c.amount,
          c.max_uses, c.max_uses_per_customer
        into v_coupon
        from platform.coupons c
        where c.id = v_coupon_id and c.tenant_id = p_tenant_id
        for update;
        if not found or not v_coupon.active or v_coupon.archived_at is not null
          or v_coupon.currency is distinct from v_currency
          or (v_coupon.kind = 'fixed' and v_coupon_amount > v_coupon.amount)
        then
          return jsonb_build_object('ok', false, 'reason', 'coupon_not_valid', 'line', null);
        end if;
        -- A hold that has run out holds no use, swept yet or not.
        select u.total, u.customer into v_uses
        from platform_private.coupon_uses(v_coupon_id, v_customer_id, null) u;
        if v_uses.total >= v_coupon.max_uses
          or (v_customer_id is not null and v_uses.customer >= v_coupon.max_uses_per_customer)
        then
          return jsonb_build_object('ok', false, 'reason', 'coupon_used_up', 'line', null);
        end if;
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

      -- The coupon's use, in the same transaction as the booking. The
      -- amount is the quote's; the database does not work it out.
      if v_coupon_id is not null then
        insert into platform.coupon_redemptions (
          tenant_id, coupon_id, booking_id, customer_id, amount
        )
        values (p_tenant_id, v_coupon_id, v_booking_id, v_customer_id, v_coupon_amount);
      end if;

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
      ))
      || case when v_coupon_id is null then '{}'::jsonb else jsonb_build_object(
        'coupon', jsonb_build_object(
          'coupon_id', v_coupon_id, 'amount', v_coupon_amount::text)) end);

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'lines', v_answer)
    || case when v_hold then jsonb_build_object('hold_expires_at', v_expires) else '{}'::jsonb end;
exception
  when deadlock_detected then
    return jsonb_build_object('ok', false, 'reason', 'try_again', 'line', null);
end;
$$;

revoke all on function platform.reserve(uuid, jsonb) from public, anon;
grant execute on function platform.reserve(uuid, jsonb) to authenticated, service_role;
alter function platform.reserve(uuid, jsonb) set lock_timeout = '6s';

-- cancel_reservation(): as in 20261116000200, giving the coupon's use back.
-- The coupon's row is taken for update after the advisory locks and before
-- the reservations, so a booking waiting for that coupon's last use counts
-- after the use is back.

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

  -- The coupon's row, after the advisory locks and before the
  -- reservations: the use is given back under it.
  perform 1 from platform.coupons c
  where c.id in (
    select x.coupon_id from platform.coupon_redemptions x
    where x.tenant_id = p_tenant_id and x.booking_id = v_booking_id
      and x.released_at is null
  )
  order by c.id
  for update;

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
    -- The coupon's use is given back once nothing of the booking is left.
    perform platform_private.release_coupon_use(p_tenant_id, v_booking_id);

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
alter function platform.cancel_reservation(uuid, uuid, uuid) set lock_timeout = '6s';

-- The hold sweep: expire_holds() is what release_expired_holds(), reserve()
-- and assign_units() all run. As in 20261116000200, giving the use back. It
-- takes no coupon row (see the lock order at the top).

create or replace function platform_private.expire_holds(
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
    -- The coupon's use is given back once nothing of the booking is left.
    perform platform_private.release_coupon_use(v_booking.tenant_id, v_booking.booking_id);
    v_count := v_count + cardinality(v_booking.ids);
  end loop;
  return v_count;
end;
$$;

revoke all on function platform_private.expire_holds(uuid, uuid[], uuid[], timestamptz)
  from public, anon, authenticated, service_role;

-- 9. The currency lock -------------------------------------------------------------------------
-- A shop's currency is fixed once any amount is stored in it. A coupon
-- counts when it holds one: a fixed amount, or a minimum spend. A
-- percentage coupon with no minimum spend holds none, and follows the shop
-- (coupons_currency_fkey, on update cascade).

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
  );
$$;

revoke all on function platform.currency_locked(uuid) from public, anon;
grant execute on function platform.currency_locked(uuid) to authenticated, service_role;
