-- Phase 2, stage 6: what the extras screens need from the database
-- (docs/phase-2-plan.md §5.2, §7, §8 stage 6; the owner's answers of
-- 17 Nov 2026 in docs/PROGRESS.md, stage 5, "Carried to stage 6").
--
-- Builds on 20261117000100_platform_product_extras, which is not touched.
--
--  1. A guard: the two functions re-created below must still have the
--     bodies 20261117000100 gave them (MD5 of the stored source). A
--     database whose copy has drifted stops here, with nothing changed.
--  2. product_extras.offered: a vehicle's own row can say "Not offered for
--     this vehicle" for an extra the shop offers with every vehicle.
--  3. save_product_extras() re-created: takes "offered". Its checks, its
--     answers and its lock order are as they were.
--  4. save_product_extras() gets the booking functions' lock timeout.
--  5. pricing_inputs() re-created: an extra a vehicle opted out of is not
--     offered with that vehicle.
--
-- Lock order (root CLAUDE.md), unchanged: save_product_extras() takes no
-- advisory lock and only rows: the vehicle product's row (for no key
-- update), or the shop's row for the "every vehicle" list; then the extra
-- products' rows (for key share) in id order; then the list's own rows in
-- extra-id order.

-- 1. The functions are as 20261117000100 left them ---------------------------------------------

do $guard$
declare
  v_pricing text;
  v_save text;
begin
  select md5(p.prosrc) into v_pricing
  from pg_proc p
  where p.oid = 'platform.pricing_inputs(uuid, uuid[])'::regprocedure;
  select md5(p.prosrc) into v_save
  from pg_proc p
  where p.oid = 'platform.save_product_extras(uuid, uuid, jsonb)'::regprocedure;
  if v_pricing is distinct from '6c662a4feb4c79b71402c1cb1c1b7d65' then
    raise exception 'pricing_inputs() is not the body of 20261117000100 (md5 %)', v_pricing;
  end if;
  if v_save is distinct from 'd52de86503606ffd856097c5028e6ef1' then
    raise exception 'save_product_extras() is not the body of 20261117000100 (md5 %)', v_save;
  end if;
end;
$guard$;

-- 2. "Not offered for this vehicle" -------------------------------------------------------------
-- A vehicle's own row with offered = false: the extra is not offered with
-- that vehicle, even when the shop offers it with every vehicle. Like any
-- own row it wins over the "every vehicle" row for the same extra. Only a
-- vehicle's row can say it, and it carries no quantity.

alter table platform.product_extras
  add column offered boolean not null default true;

alter table platform.product_extras
  add constraint product_extras_not_offered_check
  check (
    offered
    or product_id is not null and included_quantity = 0 and max_quantity is null
  );

comment on column platform.product_extras.offered is
  'False: "Not offered for this vehicle". Only on a vehicle''s own row, with no quantity; it wins over the "every vehicle" row for the same extra.';

-- 3. save_product_extras() re-created -----------------------------------------------------------
-- As in 20261117000100, with "offered" in each element:
--   [{"extra_product_id": uuid, "included_quantity": 0, "max_quantity": null,
--     "offered": true}]
-- "offered" may be left out (true). false: only on a vehicle's list, and
-- with no included quantity and no most (invalid_extras otherwise). The
-- audit event's lists carry it.
--
-- Raises: only_owner_or_manager (42501); invalid_extras (22023);
-- product_not_found, extra_not_found (P0001: another shop's product is
-- answered exactly like a made-up id); not_a_vehicle, not_an_extra (22023);
-- 55P03 when a lock can't be had in 6 seconds (4 below).

create or replace function platform.save_product_extras(
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
        where k not in ('extra_product_id', 'included_quantity', 'max_quantity', 'offered')
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
      or e ? 'offered' and jsonb_typeof(e -> 'offered') <> 'boolean'
  ) then
    raise exception 'invalid_extras' using errcode = '22023';
  end if;
  -- The values, before any lock: the table's checks say the same.
  if exists (
    select 1
    from jsonb_array_elements(p_extras) e,
      lateral (
        select coalesce((e ->> 'included_quantity')::int, 0) as included,
          (e ->> 'max_quantity')::int as most,
          coalesce((e ->> 'offered')::boolean, true) as offered
      ) q
    where q.included > 1000
      or q.most is not null and (q.most < 1 or q.most > 1000 or q.most < q.included)
      -- "Not offered" is a vehicle's, and carries no quantity.
      or not q.offered and (p_product_id is null or q.included > 0 or q.most is not null)
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
    'max_quantity', x.max_quantity,
    'offered', x.offered
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
      offered = n.offered,
      sort_position = n.position
  from (
    select (e ->> 'extra_product_id')::uuid as extra_id,
      coalesce((e ->> 'included_quantity')::int, 0) as included,
      (e ->> 'max_quantity')::int as most,
      coalesce((e ->> 'offered')::boolean, true) as offered,
      (o - 1)::int as position
    from jsonb_array_elements(p_extras) with ordinality as l(e, o)
  ) n
  where x.tenant_id = p_tenant_id
    and x.product_id is not distinct from p_product_id
    and x.extra_product_id = n.extra_id
    and (x.included_quantity, x.max_quantity, x.offered, x.sort_position)
      is distinct from (n.included, n.most, n.offered, n.position);

  insert into platform.product_extras (
    tenant_id, product_id, extra_product_id, extra_product_type,
    included_quantity, max_quantity, offered, sort_position
  )
  select p_tenant_id, p_product_id, p.id, p.type,
    coalesce((e ->> 'included_quantity')::int, 0), (e ->> 'max_quantity')::int,
    coalesce((e ->> 'offered')::boolean, true), (o - 1)::int
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
    'max_quantity', x.max_quantity,
    'offered', x.offered
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

-- Restated: a signed-in owner or manager only, not the server's.
revoke all on function platform.save_product_extras(uuid, uuid, jsonb)
  from public, anon, service_role;
grant execute on function platform.save_product_extras(uuid, uuid, jsonb) to authenticated;

-- 4. Lock timeout -------------------------------------------------------------------------------
-- As the booking functions (20261117000100, 5): a save that waits for the
-- vehicle's row behind a booking gives up after 6 seconds with 55P03,
-- before the API's 8-second statement timeout can end it with 57014.
-- Nothing is written; the Extras screens answer "try again"
-- (lib/try-again.ts). Set after the re-create above, which would otherwise
-- clear it.

alter function platform.save_product_extras(uuid, uuid, jsonb) set lock_timeout = '6s';

-- 5. pricing_inputs() re-created ----------------------------------------------------------------
-- The body 20261117000100 gave it (checked in 1), with one change in the
-- extras: a vehicle's own row with offered = false is not offered, and
-- still keeps the "every vehicle" row for that extra from that vehicle.
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
