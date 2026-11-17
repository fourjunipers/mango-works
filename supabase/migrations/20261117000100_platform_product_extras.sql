-- Phase 2, stage 5: extras in the database (docs/phase-2-plan.md §5.2, §6,
-- §8 stage 5; the owner's answers in §10, Q16).
--
-- Builds on the migrations before it, none of which is touched.
--
--  1. platform_private.extras_roles(): who may read and who may change the
--     gear and services offered with a vehicle.
--  2. platform.product_extras: a gear or service product offered with one
--     vehicle product, or with every vehicle (product_id empty). It holds no
--     amount. RLS on, grants written on purpose.
--  3. platform.save_product_extras(): owners and managers. Replaces one
--     vehicle's whole list, or the "every vehicle" list, in one call.
--  4. platform.pricing_inputs() re-created: each vehicle's extras, each
--     product's name, and the id of the tax profile in force.
--  5. confirm_hold(), cancel_reservation(), assign_units() and move_unit()
--     get reserve()'s lock timeout.
--
-- A vehicle's own row for an extra wins over the "every vehicle" row for
-- the same extra (plan §11). That rule is in one place, the read (4).
--
-- Lock order (root CLAUDE.md). save_product_extras() takes no advisory lock
-- and only rows:
--   the vehicle product's row (for no key update), or the shop's row for
--   the "every vehicle" list; then the extra products' rows (for key share)
--   in id order; then the list's own rows in extra-id order.
-- A booking takes product rows for share and never a product_extras row, so
-- the two can only take turns at the vehicle's row. The extra products'
-- rows are taken before the links because deleting a product locks its row
-- and then, by the cascade, its links.

-- 1. Who may do what ----------------------------------------------------------------------------
-- The real rule. apps/platform/lib/extras-permissions.ts is its copy, and a
-- database test compares the two.

create function platform_private.extras_roles(p_action text)
returns platform.platform_role[]
language sql
immutable
set search_path = ''
as $$
  select (case p_action
    when 'read' then '{owner,manager,staff,mechanic,driver}'
    when 'write' then '{owner,manager}'
    else '{}'
  end)::platform.platform_role[];
$$;

revoke all on function platform_private.extras_roles(text) from public, anon;
grant execute on function platform_private.extras_roles(text) to authenticated;

-- 2. product_extras -----------------------------------------------------------------------------

create table platform.product_extras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  -- The vehicle product. Empty: offered with every vehicle of the shop.
  product_id uuid,
  product_type text not null default 'vehicle'
    constraint product_extras_product_type_check check (product_type = 'vehicle'),
  -- What is offered with it: gear or a service, never a vehicle or an item
  -- for sale. The type is copied by the key below, so it can't drift.
  extra_product_id uuid not null,
  extra_product_type text not null
    constraint product_extras_extra_product_type_check
    check (extra_product_type in ('gear', 'service')),
  -- Free with each vehicle.
  included_quantity integer not null default 0
    constraint product_extras_included_quantity_check
    check (included_quantity between 0 and 1000),
  -- The most per vehicle ("up to N per bike"). Empty: no limit. For a
  -- booking the most is max_quantity x the number of vehicles it is offered
  -- with, exactly as the included quantity is counted. It binds online
  -- channels only; staff are not bound by it (Q16). Not enforced yet.
  max_quantity integer
    constraint product_extras_max_quantity_check check (max_quantity between 1 and 1000),
  sort_position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_extras_tenant_id_id_key unique (tenant_id, id),
  constraint product_extras_max_not_below_included_check
    check (max_quantity is null or max_quantity >= included_quantity),
  -- One row per (vehicle or "every vehicle", extra).
  constraint product_extras_one_per_extra_key
    unique nulls not distinct (tenant_id, extra_product_id, product_id),
  foreign key (tenant_id, product_id, product_type)
    references platform.products (tenant_id, id, type) on delete cascade,
  foreign key (tenant_id, extra_product_id, extra_product_type)
    references platform.products (tenant_id, id, type) on delete cascade
);

create index product_extras_product_idx on platform.product_extras (tenant_id, product_id);

alter table platform.product_extras enable row level security;

-- Every member reads (it holds no amount: a mechanic preparing a bike should
-- know two helmets go with it). No insert, update or delete for a signed-in
-- person: save_product_extras() below.
grant select on platform.product_extras to authenticated;
grant select, insert, update, delete on platform.product_extras to service_role;

create policy "Members read product extras"
on platform.product_extras for select to authenticated
using (
  tenant_id = any (
    (select platform_private.my_tenant_ids(platform_private.extras_roles('read')))::uuid[]
  )
);

create trigger product_extras_set_updated_at
before update on platform.product_extras
for each row execute function platform_private.set_updated_at();

-- 3. save_product_extras() ----------------------------------------------------------------------
-- p_product_id: a vehicle product, or null for the list offered with every
-- vehicle. p_extras: the whole list, in the order to show it:
--   [{"extra_product_id": uuid, "included_quantity": 0, "max_quantity": null}]
-- Rows that are no longer named go; rows that stay keep their id. All of it
-- or none of it. One audit event when the list changed.
--
-- Raises: only_owner_or_manager (42501); invalid_extras (22023);
-- product_not_found, extra_not_found (P0001: another shop's product is
-- answered exactly like a made-up id); not_a_vehicle, not_an_extra (22023).

create function platform.save_product_extras(
  p_tenant_id uuid,
  p_product_id uuid,
  p_extras jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_ids uuid[];
  v_found integer;
  v_before jsonb;
  v_after jsonb;
begin
  if p_tenant_id is null or p_extras is null or jsonb_typeof(p_extras) <> 'array'
    or jsonb_array_length(p_extras) > 100
  then
    raise exception 'invalid_extras' using errcode = '22023';
  end if;
  if not platform_private.has_role(p_tenant_id, platform_private.extras_roles('write')) then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_extras) e
    where jsonb_typeof(e) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(e) k
        where k not in ('extra_product_id', 'included_quantity', 'max_quantity')
      )
      or jsonb_typeof(e -> 'extra_product_id') is distinct from 'string'
      or (e ->> 'extra_product_id')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or e ? 'included_quantity' and (
        jsonb_typeof(e -> 'included_quantity') <> 'number'
        or (e ->> 'included_quantity') !~ '^[0-9]{1,4}$'
      )
      or e ? 'max_quantity' and jsonb_typeof(e -> 'max_quantity') <> 'null' and (
        jsonb_typeof(e -> 'max_quantity') <> 'number'
        or (e ->> 'max_quantity') !~ '^[0-9]{1,4}$'
      )
  ) then
    raise exception 'invalid_extras' using errcode = '22023';
  end if;
  -- The values, before any lock: the table's checks say the same.
  if exists (
    select 1
    from jsonb_array_elements(p_extras) e,
      lateral (
        select coalesce((e ->> 'included_quantity')::int, 0) as included,
          (e ->> 'max_quantity')::int as most
      ) q
    where q.included > 1000
      or q.most is not null and (q.most < 1 or q.most > 1000 or q.most < q.included)
  ) then
    raise exception 'invalid_extras' using errcode = '22023';
  end if;
  select array_agg(id order by id), count(*)
  into v_ids, v_found
  from (
    select distinct (e ->> 'extra_product_id')::uuid as id
    from jsonb_array_elements(p_extras) e
  ) d;
  v_ids := coalesce(v_ids, '{}');
  -- The same extra twice in one list.
  if v_found <> jsonb_array_length(p_extras) then
    raise exception 'invalid_extras' using errcode = '22023';
  end if;

  -- Rows, in the one order: the vehicle's row (or the shop's, for the
  -- "every vehicle" list), the extras' product rows, then the links.
  if p_product_id is not null then
    select p.type into v_type
    from platform.products p
    where p.id = p_product_id and p.tenant_id = p_tenant_id
    for no key update;
    if not found then
      raise exception 'product_not_found' using errcode = 'P0001';
    end if;
    if v_type <> 'vehicle' then
      raise exception 'not_a_vehicle' using errcode = '22023';
    end if;
  else
    perform 1 from platform.tenants t where t.id = p_tenant_id for no key update;
  end if;

  select count(*) into v_found
  from (
    select p.id
    from platform.products p
    where p.tenant_id = p_tenant_id and p.id = any (v_ids)
    order by p.id
    for key share
  ) locked;
  if v_found <> cardinality(v_ids) then
    raise exception 'extra_not_found' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from platform.products p
    where p.id = any (v_ids) and p.type not in ('gear', 'service')
  ) then
    raise exception 'not_an_extra' using errcode = '22023';
  end if;

  perform 1
  from platform.product_extras x
  where x.tenant_id = p_tenant_id and x.product_id is not distinct from p_product_id
  order by x.extra_product_id
  for update;

  select coalesce(jsonb_agg(jsonb_build_object(
    'extra_product_id', x.extra_product_id,
    'included_quantity', x.included_quantity,
    'max_quantity', x.max_quantity
  ) order by x.sort_position, x.extra_product_id), '[]'::jsonb)
  into v_before
  from platform.product_extras x
  where x.tenant_id = p_tenant_id and x.product_id is not distinct from p_product_id;

  delete from platform.product_extras x
  where x.tenant_id = p_tenant_id
    and x.product_id is not distinct from p_product_id
    and x.extra_product_id <> all (v_ids);

  update platform.product_extras x
  set included_quantity = n.included,
      max_quantity = n.most,
      sort_position = n.position
  from (
    select (e ->> 'extra_product_id')::uuid as extra_id,
      coalesce((e ->> 'included_quantity')::int, 0) as included,
      (e ->> 'max_quantity')::int as most,
      (o - 1)::int as position
    from jsonb_array_elements(p_extras) with ordinality as l(e, o)
  ) n
  where x.tenant_id = p_tenant_id
    and x.product_id is not distinct from p_product_id
    and x.extra_product_id = n.extra_id
    and (x.included_quantity, x.max_quantity, x.sort_position)
      is distinct from (n.included, n.most, n.position);

  insert into platform.product_extras (
    tenant_id, product_id, extra_product_id, extra_product_type,
    included_quantity, max_quantity, sort_position
  )
  select p_tenant_id, p_product_id, p.id, p.type,
    coalesce((e ->> 'included_quantity')::int, 0), (e ->> 'max_quantity')::int, (o - 1)::int
  from jsonb_array_elements(p_extras) with ordinality as l(e, o)
  join platform.products p on p.id = (e ->> 'extra_product_id')::uuid
  where not exists (
    select 1 from platform.product_extras x
    where x.tenant_id = p_tenant_id
      and x.product_id is not distinct from p_product_id
      and x.extra_product_id = p.id
  )
  order by p.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'extra_product_id', x.extra_product_id,
    'included_quantity', x.included_quantity,
    'max_quantity', x.max_quantity
  ) order by x.sort_position, x.extra_product_id), '[]'::jsonb)
  into v_after
  from platform.product_extras x
  where x.tenant_id = p_tenant_id and x.product_id is not distinct from p_product_id;

  if v_after is distinct from v_before then
    perform platform_private.audit(
      p_tenant_id, 'product_extras', coalesce(p_product_id::text, 'every_vehicle'),
      'extras_change',
      jsonb_build_object('extras', v_before),
      jsonb_build_object('extras', v_after)
    );
  end if;
  return v_after;
end;
$$;

-- Not the server's: a signed-in owner or manager only.
revoke all on function platform.save_product_extras(uuid, uuid, jsonb)
  from public, anon, service_role;
grant execute on function platform.save_product_extras(uuid, uuid, jsonb) to authenticated;

-- 4. pricing_inputs() re-created ----------------------------------------------------------------
-- Its body from the database (pg_get_functiondef), with:
--   - "extras": for each vehicle named, the gear and services offered with
--     it. A vehicle's own row wins over the "every vehicle" row for the same
--     extra. A retired extra is not offered. Any member reads it (RLS on
--     product_extras), so a mechanic gets extras and still no prices;
--   - the extras' own pricing rows and seasons beside the ones asked for
--     (v.ids), so one call prices a vehicle with what goes with it;
--   - on each product: product_name, and tax_profile_id, the profile in
--     force (the product's own, else the shop's default), the same row the
--     rate and the name come from. The quote snapshot keeps both.
-- Still no arithmetic.

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
        x.product_id is not null
        or not exists (
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
        'default_tax_profile_id', s.default_tax_profile_id
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

-- 5. Lock timeouts ------------------------------------------------------------------------------
-- As reserve() since stage 3: a wait for a lock gives up after 6 seconds
-- with 55P03 (lock_not_available), before the API's 8-second statement
-- timeout can end the call with 57014. Nothing is written; the caller
-- answers "try again". The setting is on the function, so the bodies and
-- the grants are as they were: nothing is re-created.

alter function platform.confirm_hold(uuid, uuid) set lock_timeout = '6s';
alter function platform.cancel_reservation(uuid, uuid, uuid) set lock_timeout = '6s';
alter function platform.assign_units(uuid, uuid, uuid[]) set lock_timeout = '6s';
alter function platform.move_unit(uuid, uuid, uuid, uuid, integer, timestamptz, jsonb)
  set lock_timeout = '6s';
