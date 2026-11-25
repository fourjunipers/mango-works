-- Phase 3, stage 2b: the order core (docs/phase-3-plan.md §2, §3.3, §3.8 row
-- 3, §4.2, §5.1).
--
-- Builds on 20261124000100_platform_orders. No earlier migration is touched.
--
--  0. The three booking tables are locked first, with a 10-second limit.
--  1. The functions replaced here are as main left them (guard).
--  2. Reservations with no rental are looked for again and cleared, with
--     their blocks and coupon uses, as migration 2 cleared them (S7). THIS
--     DELETES ROWS. On live the count must be 0 before this is pushed, or
--     the push stops (docs/PROGRESS.md). Then reservations.rental_id is
--     required, and a reservation's rental is one of its own order's.
--  3. rentals.position; a coupon use's customer is a customer; the value
--     lists of orders.cancelled_by and cancel_reason; no order is committed
--     without its number.
--  4. Helpers: the order's code, its answer, settling a hold that has run
--     out, storing charges.
--  5. platform_private.reserve_core(): reserve() written for orders.
--  6. The cores confirm_hold(), cancel_reservation() and assign_units(), now
--     in platform_private and taking the order's row.
--  7. platform.reserve(), confirm_hold(), cancel_reservation() and
--     assign_units() are dropped. Every booking is an order (decision 10).
--  8. The order functions: create_order(), hold_order(), reserve_order(),
--     confirm_order(), cancel_order(), assign_order_units().
--  9. currency_locked() knows about orders.
--
-- Who is calling: everything here reads the caller through
-- platform_private.app_uid() and app_role() (decision 43).
--
-- Lock order (plan §4.2; root CLAUDE.md). Every function here takes
--   1. product-and-location advisory locks, sorted, from the order's
--      reservations plus the products the call adds;
--   2. unit advisory locks, sorted;
--   3. rows: the order's row (`for no key update`), unit rows (`for key
--      share`), product rows (`for share`), listing rows (Moto Mangos),
--      the coupon's row, the new order and its rentals, reservations,
--      blocks, charges, lines, the redemption, and last of all the shop's
--      counter row and the new order's number.
-- A function that picks units does so in attempts, each a sub-transaction:
-- the order's row is taken inside the attempt, after that attempt's unit
-- locks, so no transaction ever waits for a unit lock while it holds an
-- order's row.

-- 0. The booking tables, locked first -----------------------------------------------------------
-- As migration 2 (20261124000100): in a booking's own order, 10 seconds at
-- most, inside one DO block (the CLI sends a migration as one transaction
-- without a BEGIN of its own, so a top-level LOCK TABLE is refused and a
-- top-level SET LOCAL would not apply).

do $$
begin
  perform set_config('lock_timeout', '10s', true);
  lock table platform.reservations, platform.unit_blocks, platform.coupon_redemptions
    in access exclusive mode;
end
$$;

-- 1. The functions are as main left them -------------------------------------------------------

do $guard$
declare
  v_expected constant jsonb := jsonb_build_object(
    'platform.reserve(uuid,jsonb)', 'e0ca7239cb2f8e2fabc9f3ae3dd717b7',
    'platform.confirm_hold(uuid,uuid)', 'fb5aa3c61e7d12ddf0e76f93feaf082b',
    'platform.cancel_reservation(uuid,uuid,uuid)', '858f50b095813dcacbce1694941dbd4f',
    'platform.assign_units(uuid,uuid,uuid[])', '8e3813d7e69d7500eeee281bcb149c96',
    'platform.currency_locked(uuid)', 'fe3d2da0bfa911d3e0fe25d71a2d60d6'
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

-- 2. No reservation without a rental ------------------------------------------------------------
-- Migration 2 cleared Phase 2's bookings, but platform.reserve() lived on
-- until this migration, so a database that took bookings in between (the
-- seed, a test, staging) has reservations with no rental again. They are
-- cleared the same way: their allocation and hold blocks, then the coupon
-- uses of bookings that are no order, then the reservations. Downtime
-- blocks are not touched. On live the count must be 0 before the push.
--
-- The block between the two markers is run again by
-- apps/platform/tests/db/order-core.test.ts, inside a transaction it rolls
-- back.

-- recheck:begin
do $recheck$
declare
  v_reservations bigint;
  v_blocks bigint;
  v_redemptions bigint;
  v_kept_blocks bigint;
  v_kept_after bigint;
begin
  select count(*) into v_reservations from platform.reservations where rental_id is null;
  select count(*) into v_blocks
  from platform.unit_blocks b
  where b.reservation_id in (select r.id from platform.reservations r where r.rental_id is null);
  select count(*) into v_redemptions
  from platform.coupon_redemptions x
  where not exists (
    select 1 from platform.orders o where o.tenant_id = x.tenant_id and o.id = x.booking_id
  );
  select count(*) into v_kept_blocks from platform.unit_blocks where reservation_id is null;
  raise notice
    'platform_order_core, before: % reservations with no rental, % of their blocks, % coupon redemptions of no order (% other blocks stay)',
    v_reservations, v_blocks, v_redemptions, v_kept_blocks;

  delete from platform.unit_blocks b
  where b.reservation_id in (select r.id from platform.reservations r where r.rental_id is null);
  delete from platform.coupon_redemptions x
  where not exists (
    select 1 from platform.orders o where o.tenant_id = x.tenant_id and o.id = x.booking_id
  );
  -- An extra's row before its vehicle's is no matter: the key from a row to
  -- its parent is checked at the end of the statement.
  delete from platform.reservations where rental_id is null;

  select count(*) into v_reservations from platform.reservations where rental_id is null;
  select count(*) into v_redemptions
  from platform.coupon_redemptions x
  where not exists (
    select 1 from platform.orders o where o.tenant_id = x.tenant_id and o.id = x.booking_id
  );
  select count(*) into v_kept_after from platform.unit_blocks where reservation_id is null;
  if v_reservations <> 0 or v_redemptions <> 0 then
    raise exception 'platform_order_core: % reservations with no rental, % redemptions of no order left',
      v_reservations, v_redemptions;
  end if;
  if v_kept_after <> v_kept_blocks then
    raise exception 'platform_order_core: % other blocks before, % after',
      v_kept_blocks, v_kept_after;
  end if;
  raise notice
    'platform_order_core, after: 0 reservations with no rental, 0 coupon redemptions of no order (% other blocks stay)',
    v_kept_after;
end;
$recheck$;
-- recheck:end

alter table platform.reservations
  alter column rental_id set not null;

-- A reservation's rental is a rental of its own order: booking_id is the
-- order's id (plan §2.2). move_unit() copies both to a split row.
alter table platform.reservations
  add constraint reservations_order_rental_fkey
    foreign key (tenant_id, booking_id, rental_id)
    references platform.rentals (tenant_id, order_id, id);

-- 3. Columns and checks -------------------------------------------------------------------------

-- Where the rental stands in its order: the line it was booked as. Never
-- re-sorted, like a line's position. The table is empty until now.
alter table platform.rentals
  add column position integer not null
    constraint rentals_position_check check (position >= 0);

create index rentals_order_idx on platform.rentals (tenant_id, order_id, position);

-- Whose use it is: the order's customer (plan §5.1).
alter table platform.coupon_redemptions
  add constraint coupon_redemptions_customer_fkey
    foreign key (tenant_id, customer_id) references platform.customers (tenant_id, id);

create index coupon_redemptions_customer_idx
  on platform.coupon_redemptions (tenant_id, customer_id)
  where customer_id is not null;

-- Who cancelled, and why. cancel_order() is their first writer. 'system'
-- with 'expired' is an online hold that ran out (decision 5). Anything
-- longer than a word goes in the order's notes. request_status gets its
-- list at 3M.
alter table platform.orders
  add constraint orders_cancelled_by_check
    check (cancelled_by in ('customer', 'shop', 'system')),
  add constraint orders_cancel_reason_check
    check (cancel_reason in ('expired', 'customer_request', 'shop_request', 'no_show', 'other'));

-- No order is committed without its number. The number is written last in
-- the transaction that makes the order (plan §4.2, class 3.10), so the
-- check waits for the commit.
create function platform_private.orders_require_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1 from platform.orders o where o.id = new.id and o.number is null
  ) then
    raise exception 'order_without_number' using errcode = '23514';
  end if;
  return null;
end;
$function$;
revoke all on function platform_private.orders_require_number() from public, anon, authenticated;

create constraint trigger orders_require_number
after insert or update of number on platform.orders
deferrable initially deferred
for each row execute function platform_private.orders_require_number();

-- 4. Helpers ------------------------------------------------------------------------------------

-- What the customer quotes: 6 characters, no 0, O, 1 or I. Unique per shop
-- by the table's key; the function that inserts tries another on a clash.
create function platform_private.order_code()
returns text
language sql
volatile
set search_path = ''
as $function$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::integer, 1), '')
  from generate_series(1, 6);
$function$;
revoke all on function platform_private.order_code() from public, anon, authenticated;

-- Reads a whole number, negative or not, from p -> p_key. Null when the key
-- is absent or JSON null.
create function platform_private.json_int(p jsonb, p_key text, p_error text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_text text;
begin
  if not (p ? p_key) or jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  v_text := p ->> p_key;
  if jsonb_typeof(p -> p_key) not in ('number', 'string') or v_text !~ '^-?[0-9]{1,18}$' then
    raise exception '%', p_error using errcode = '22023';
  end if;
  return v_text::bigint;
end;
$function$;
revoke all on function platform_private.json_int(jsonb, text, text) from public, anon, authenticated;

-- What an order function answers when it has done its work: the order, and
-- per rental (in the order they were booked) its live reservation, the
-- units that reservation holds and how many it is short. A draft's rentals
-- have no reservation. Read after the order's number is written.
create function platform_private.order_answer(p_tenant_id uuid, p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'ok', true,
    'order_id', o.id,
    'number', o.number,
    'code', o.code,
    'status', o.status,
    'lines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'rental_id', n.id,
          'reservation_id', live.id,
          'unit_ids', coalesce((
            select jsonb_agg(b.unit_id order by hashtext(b.unit_id::text), b.unit_id)
            from platform.unit_blocks b
            where b.reservation_id = live.id
          ), '[]'::jsonb),
          'shortage', coalesce(live.shortage, 0))
        order by n.position)
      from platform.rentals n
      left join lateral (
        select r.id, r.shortage
        from platform.reservations r
        where r.rental_id = n.id and r.state in ('held', 'reserved', 'out')
        order by r.created_at desc, r.id
        limit 1
      ) live on true
      where n.tenant_id = o.tenant_id and n.order_id = o.id
    ), '[]'::jsonb))
    || case when o.status = 'new'
      then jsonb_build_object('hold_expires_at', o.hold_expires_at) else '{}'::jsonb end
  from platform.orders o
  where o.id = p_order_id and o.tenant_id = p_tenant_id;
$function$;
revoke all on function platform_private.order_answer(uuid, uuid) from public, anon, authenticated;

-- Settles a hold that has run out (plan §2.3, §3.3 step 4; decision 5): a
-- 'new' order whose hold_expires_at has passed at p_now. Its still-held
-- reservations are released as the sweep releases them (blocks deleted,
-- rows 'expired', the coupon's use given back), then a staff order becomes
-- a draft with its rentals and lines kept, and an online order is canceled
-- with the reason 'expired'. True when it settled something.
--
-- The caller holds the product-and-location locks of the order's
-- reservations and the order's row. No unit lock is taken, as for the
-- sweep: a hold that has run out only loses blocks, in the rows phase,
-- under the product lock every writer of those blocks holds. No coupon row
-- either: a use given back without it can only make a count read high for a
-- moment.
create function platform_private.settle_order_hold(
  p_tenant_id uuid,
  p_order_id uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order record;
  v_held uuid[];
  v_online boolean;
begin
  select o.status, o.hold_expires_at, o.channel into v_order
  from platform.orders o
  where o.id = p_order_id and o.tenant_id = p_tenant_id;
  if not found or v_order.status <> 'new' or v_order.hold_expires_at > p_now then
    return false;
  end if;

  perform 1 from platform.reservations r
  where r.tenant_id = p_tenant_id and r.booking_id = p_order_id and r.state = 'held'
  order by r.id
  for update;
  select coalesce(array_agg(r.id order by r.id), '{}') into v_held
  from platform.reservations r
  where r.tenant_id = p_tenant_id and r.booking_id = p_order_id and r.state = 'held';

  if cardinality(v_held) > 0 then
    perform platform_private.audit(
      p_tenant_id, 'bookings', p_order_id::text, 'expire', null,
      jsonb_build_object(
        'reservation_ids', to_jsonb(v_held),
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
          from unnest(v_held) i(id)
        )));
    delete from platform.unit_blocks b where b.reservation_id = any (v_held);
    update platform.reservations r set state = 'expired' where r.id = any (v_held);
  end if;
  perform platform_private.release_coupon_use(p_tenant_id, p_order_id);

  v_online := v_order.channel in ('booking_page', 'marketplace', 'api');
  if v_online then
    update platform.rentals n set status = 'canceled'
    where n.tenant_id = p_tenant_id and n.order_id = p_order_id and n.status <> 'canceled';
    update platform.order_charges c set status = 'void'
    where c.tenant_id = p_tenant_id and c.order_id = p_order_id and c.status = 'open';
    update platform.orders o
    set status = 'canceled', hold_expires_at = null, cancelled_by = 'system',
      cancel_reason = 'expired', canceled_at = p_now
    where o.id = p_order_id;
  else
    update platform.rentals n set status = 'draft'
    where n.tenant_id = p_tenant_id and n.order_id = p_order_id and n.status = 'booked';
    update platform.orders o
    set status = 'draft', hold_expires_at = null
    where o.id = p_order_id;
  end if;

  perform platform_private.audit(
    p_tenant_id, 'bookings', p_order_id::text, 'hold_expired', null,
    jsonb_build_object(
      'status', case when v_online then 'canceled' else 'draft' end,
      'hold_expires_at', v_order.hold_expires_at));
  return true;
end;
$function$;
revoke all on function platform_private.settle_order_hold(uuid, uuid, timestamptz)
  from public, anon, authenticated;

-- Checks an order's charges and, with p_store, stores them with their
-- lines. One charge is one quote() call (plan §3.2): the amounts were
-- worked out in @mango/core before the transaction, and the database only
-- adds and compares (phase 2 plan §5.4):
--   * the rate groups' VAT adds up to the charge's tax_total, and each
--     group's gross is its net plus its VAT;
--   * the groups' gross, plus what is not taxable, is the charge's total;
--   * the lines' VAT adds up to the charge's tax_total, and the lines'
--     deposits to no more than the charge's;
--   * where the snapshot carries totals and a deposit, they are the
--     charge's.
-- Anything else is invalid_charge (22023): it could not have come from our
-- own code.
--
-- p_charges: [ { "kind": "booking" | "period", "priced_at", "due_at",
--     "total", "tax_total", "deposit", "rate_groups": [ { "vat", "net",
--     "gross", ... } ], "snapshot": { ... },
--     "lines": [ { "rental": index of the request's line (empty for an item
--       for sale or a fee), "kind", "product_id", "product_type",
--       "period_start", "period_end", "quantity", "included_quantity",
--       "charged_quantity", "list_price", "season_total", "discount_total",
--       "amount", "tax_rate_bp", "tax_profile_id", "tax_profile_name",
--       "tax_inclusive", "tax_amount", "deposit", "snapshot", "note" } ] } ]
-- Amounts are whole numbers of minor units, as numbers or strings of digits.
create function platform_private.store_charges(
  p_tenant_id uuid,
  p_order_id uuid,
  p_currency text,
  p_charges jsonb,
  p_rental_ids uuid[],
  p_line_count integer,
  p_store boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_charge jsonb;
  v_line jsonb;
  v_group jsonb;
  v_key text;
  v_snapshot jsonb;
  v_kind text;
  v_priced timestamptz;
  v_due timestamptz;
  v_total bigint;
  v_tax bigint;
  v_deposit bigint;
  v_non_taxable bigint;
  v_vat bigint;
  v_net bigint;
  v_gross bigint;
  v_sum_vat bigint;
  v_sum_gross bigint;
  v_sum_line_tax bigint;
  v_sum_line_deposit bigint;
  v_charge_id uuid;
  v_position integer := 0;
  v_rental bigint;
  v_line_kind text;
  v_product_id uuid;
  v_product_type text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_quantity bigint;
  v_amount bigint;
  v_line_tax bigint;
  v_line_deposit bigint;
  v_rate bigint;
  v_bookings integer := 0;
  v_i integer;
  v_j integer;
begin
  if p_charges is null or jsonb_typeof(p_charges) = 'null' then
    return;
  end if;
  if jsonb_typeof(p_charges) <> 'array' or jsonb_array_length(p_charges) > 60 then
    raise exception 'invalid_charge' using errcode = '22023';
  end if;

  for v_i in 0..jsonb_array_length(p_charges) - 1 loop
    v_charge := p_charges -> v_i;
    if jsonb_typeof(v_charge) <> 'object' then
      raise exception 'invalid_charge' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_charge) loop
      if v_key not in (
        'kind', 'priced_at', 'due_at', 'total', 'tax_total', 'deposit', 'rate_groups',
        'snapshot', 'lines'
      ) then
        raise exception 'invalid_charge' using errcode = '22023';
      end if;
    end loop;

    v_kind := v_charge ->> 'kind';
    v_priced := platform_private.json_time(v_charge, 'priced_at', 'invalid_charge');
    v_due := platform_private.json_time(v_charge, 'due_at', 'invalid_charge');
    v_total := platform_private.json_whole(v_charge, 'total', 'invalid_charge');
    v_tax := platform_private.json_whole(v_charge, 'tax_total', 'invalid_charge');
    v_deposit := coalesce(platform_private.json_whole(v_charge, 'deposit', 'invalid_charge'), 0);
    v_snapshot := v_charge -> 'snapshot';
    if jsonb_typeof(v_charge -> 'kind') is distinct from 'string'
      or v_kind not in ('booking', 'period')
      or v_priced is null or v_total is null or v_tax is null
      or jsonb_typeof(v_snapshot) is distinct from 'object'
      or jsonb_typeof(coalesce(v_charge -> 'rate_groups', '[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(v_charge -> 'lines', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(v_charge -> 'lines', '[]'::jsonb)) > 400
    then
      raise exception 'invalid_charge' using errcode = '22023';
    end if;
    if v_kind = 'booking' then
      v_bookings := v_bookings + 1;
      if v_bookings > 1 then
        raise exception 'invalid_charge' using errcode = '22023';
      end if;
    end if;

    -- The rate groups add up to the totals.
    v_sum_vat := 0;
    v_sum_gross := 0;
    for v_group in select e.value from jsonb_array_elements(
      coalesce(v_charge -> 'rate_groups', '[]'::jsonb)) e
    loop
      if jsonb_typeof(v_group) <> 'object' then
        raise exception 'invalid_charge' using errcode = '22023';
      end if;
      v_vat := platform_private.json_whole(v_group, 'vat', 'invalid_charge');
      v_net := platform_private.json_whole(v_group, 'net', 'invalid_charge');
      v_gross := platform_private.json_whole(v_group, 'gross', 'invalid_charge');
      if v_vat is null or v_net is null or v_gross is null or v_gross <> v_net + v_vat then
        raise exception 'invalid_charge' using errcode = '22023';
      end if;
      v_sum_vat := v_sum_vat + v_vat;
      v_sum_gross := v_sum_gross + v_gross;
    end loop;
    v_non_taxable := coalesce(
      platform_private.json_whole(v_snapshot, 'non_taxable', 'invalid_charge'), 0);
    if v_sum_vat <> v_tax or v_sum_gross + v_non_taxable <> v_total then
      raise exception 'invalid_charge' using errcode = '22023';
    end if;
    -- Where the snapshot says what the invoice came to, it is this.
    if jsonb_typeof(v_snapshot -> 'totals') = 'object' and (
      platform_private.json_whole(v_snapshot -> 'totals', 'total', 'invalid_charge')
        is distinct from v_total
      or platform_private.json_whole(v_snapshot -> 'totals', 'vat', 'invalid_charge')
        is distinct from v_tax
    ) then
      raise exception 'invalid_charge' using errcode = '22023';
    end if;
    if jsonb_typeof(v_snapshot -> 'deposit') = 'object'
      and platform_private.json_whole(v_snapshot -> 'deposit', 'amount', 'invalid_charge')
        is distinct from v_deposit
    then
      raise exception 'invalid_charge' using errcode = '22023';
    end if;

    if p_store then
      insert into platform.order_charges (
        tenant_id, order_id, kind, currency, priced_at, due_at, total, tax_total, deposit,
        rate_groups, snapshot
      )
      values (
        p_tenant_id, p_order_id, v_kind, p_currency, v_priced, v_due, v_total, v_tax, v_deposit,
        coalesce(v_charge -> 'rate_groups', '[]'::jsonb), v_snapshot
      )
      returning id into v_charge_id;
    end if;

    v_sum_line_tax := 0;
    v_sum_line_deposit := 0;
    for v_j in 0..jsonb_array_length(coalesce(v_charge -> 'lines', '[]'::jsonb)) - 1 loop
      v_line := v_charge -> 'lines' -> v_j;
      if jsonb_typeof(v_line) <> 'object' then
        raise exception 'invalid_charge' using errcode = '22023';
      end if;
      for v_key in select jsonb_object_keys(v_line) loop
        if v_key not in (
          'rental', 'kind', 'product_id', 'product_type', 'period_start', 'period_end',
          'quantity', 'included_quantity', 'charged_quantity', 'list_price', 'season_total',
          'discount_total', 'amount', 'tax_rate_bp', 'tax_profile_id', 'tax_profile_name',
          'tax_inclusive', 'tax_amount', 'deposit', 'snapshot', 'note'
        ) then
          raise exception 'invalid_charge' using errcode = '22023';
        end if;
      end loop;
      v_line_kind := v_line ->> 'kind';
      v_rental := platform_private.json_whole(v_line, 'rental', 'invalid_charge');
      v_product_id := platform_private.json_uuid(v_line, 'product_id', 'invalid_charge');
      v_product_type := v_line ->> 'product_type';
      v_period_start := platform_private.json_time(v_line, 'period_start', 'invalid_charge');
      v_period_end := platform_private.json_time(v_line, 'period_end', 'invalid_charge');
      v_quantity := coalesce(platform_private.json_whole(v_line, 'quantity', 'invalid_charge'), 1);
      v_amount := platform_private.json_whole(v_line, 'amount', 'invalid_charge');
      v_line_tax := coalesce(platform_private.json_whole(v_line, 'tax_amount', 'invalid_charge'), 0);
      v_line_deposit := coalesce(platform_private.json_whole(v_line, 'deposit', 'invalid_charge'), 0);
      v_rate := platform_private.json_whole(v_line, 'tax_rate_bp', 'invalid_charge');
      if jsonb_typeof(v_line -> 'kind') is distinct from 'string'
        or v_line_kind not in ('period', 'extra', 'sale_item', 'fee', 'manual')
        or v_amount is null
        or v_quantity not between 1 and 100000
        or (v_rental is not null and v_rental >= p_line_count)
        or (v_line_kind in ('period', 'extra') and v_rental is null)
        or (v_product_id is null) <> (v_product_type is null)
        or (v_product_type is not null
          and v_product_type not in ('vehicle', 'gear', 'service', 'sale_item'))
        or (v_period_start is not null and v_period_end is not null
          and v_period_end <= v_period_start)
        or (v_rate is not null and v_rate > 10000)
        or (v_line ? 'tax_inclusive'
          and jsonb_typeof(v_line -> 'tax_inclusive') not in ('boolean', 'null'))
        or (v_line ? 'snapshot' and jsonb_typeof(v_line -> 'snapshot') not in ('object', 'null'))
        or (v_line ? 'tax_profile_name'
          and jsonb_typeof(v_line -> 'tax_profile_name') not in ('string', 'null'))
        or (v_line ? 'note' and jsonb_typeof(v_line -> 'note') not in ('string', 'null'))
      then
        raise exception 'invalid_charge' using errcode = '22023';
      end if;
      v_sum_line_tax := v_sum_line_tax + v_line_tax;
      v_sum_line_deposit := v_sum_line_deposit + v_line_deposit;

      if p_store then
        insert into platform.order_lines (
          tenant_id, order_id, charge_id, rental_id, kind, product_id, product_type,
          period_start, period_end, quantity, included_quantity, charged_quantity,
          list_price, season_total, discount_total, amount, tax_rate_bp, tax_profile_id,
          tax_profile_name, tax_inclusive, tax_amount, deposit, currency, snapshot, note,
          position
        )
        values (
          p_tenant_id, p_order_id, v_charge_id,
          case when v_rental is not null then p_rental_ids[v_rental + 1] end,
          v_line_kind, v_product_id, v_product_type, v_period_start, v_period_end,
          v_quantity,
          platform_private.json_whole(v_line, 'included_quantity', 'invalid_charge'),
          platform_private.json_whole(v_line, 'charged_quantity', 'invalid_charge'),
          platform_private.json_whole(v_line, 'list_price', 'invalid_charge'),
          platform_private.json_int(v_line, 'season_total', 'invalid_charge'),
          platform_private.json_whole(v_line, 'discount_total', 'invalid_charge'),
          v_amount, v_rate,
          platform_private.json_uuid(v_line, 'tax_profile_id', 'invalid_charge'),
          v_line ->> 'tax_profile_name',
          (v_line ->> 'tax_inclusive')::boolean,
          v_line_tax, v_line_deposit, p_currency,
          case when jsonb_typeof(v_line -> 'snapshot') = 'object' then v_line -> 'snapshot' end,
          v_line ->> 'note',
          v_position
        );
      else
        -- The same reads, so a dry run refuses what storing would.
        perform platform_private.json_whole(v_line, 'included_quantity', 'invalid_charge'),
          platform_private.json_whole(v_line, 'charged_quantity', 'invalid_charge'),
          platform_private.json_whole(v_line, 'list_price', 'invalid_charge'),
          platform_private.json_int(v_line, 'season_total', 'invalid_charge'),
          platform_private.json_whole(v_line, 'discount_total', 'invalid_charge'),
          platform_private.json_uuid(v_line, 'tax_profile_id', 'invalid_charge');
      end if;
      v_position := v_position + 1;
    end loop;
    if v_sum_line_tax <> v_tax or v_sum_line_deposit > v_deposit then
      raise exception 'invalid_charge' using errcode = '22023';
    end if;
  end loop;
end;
$function$;
revoke all on function platform_private.store_charges(uuid, uuid, text, jsonb, uuid[], integer, boolean)
  from public, anon, authenticated;

-- 5. reserve_core() -----------------------------------------------------------------------------
-- The one way an order takes stock, for staff and for online channels
-- alike. Phase 2's reserve() written for orders (M1): it takes the order
-- and its rentals, and writes them inside the lock order. All lines or none.
--
-- p_order
--   a new order:  { "channel", "mode", "customer_id", "notes",
--                   "idempotency_key" }
--   one there is: { "id" }   (a draft, or a hold that has run out: held or
--                             reserved again)
-- p_rentals: one line per rental, in the order's own order
--   [ { "product_id", "location_id", "starts_at", "ends_at", "quantity",
--       "parent":    index of an earlier vehicle line (an extra),
--       "unit_ids":  the units to take (staff only),
--       "rental_id": the rental it is, for an order there is } ]
--   A vehicle line is one vehicle (decision 2): its quantity is 1, and so
--   many bikes are so many lines. Gear and services keep a quantity. At
--   most 200 lines (plan §2.2).
-- p_request
--   { "action": "hold" | "reserve" | "draft",
--     "coupon": { "coupon_id", "amount" },
--     "charges": [ ... ]   (store_charges(), a new order only) }
--
-- Answers order_answer(), or { "ok": false, "reason", "line" } with nothing
-- written (but a hold that had run out stays settled), with reason
--   not_allowed, not_found, unavailable, unit_taken, not_listed,
--   cap_reached, coupon_not_valid, coupon_used_up, try_again as reserve()
--   answered them, and
--   unit_twice       one unit named on two lines whose rental times overlap
--                    or touch (the owner, 25 Nov 2026: a bike is never on
--                    an order twice at the same time; another period of
--                    the same bike is fine, and the pick follows the same
--                    rule). "Touch": one line starts the moment the other
--                    ends, which is one rental written twice;
--   customer_needed  a coupon with a limit per customer, on an order with
--                    no customer (plan §5.1);
--   not_draft        the order there is can't be held or reserved now.
-- A request that could not have come from our own code raises, as before:
-- invalid_request, invalid_charge, product_not_found, location_not_found,
-- unit_not_found, not_reservable, customer_not_found.
--
-- A draft takes no stock, so no advisory lock and no coupon use: it checks
-- the request and writes the order, its rentals and its charges.
--
-- The exception handler of an attempt treats as "a unit was taken, pick
-- again" only an exclusion violation and a failure of the block's own key
-- to its unit (unit_blocks_tenant_id_unit_id_fkey). Any other foreign-key
-- failure (the order, a rental, the customer, a product) is raised.
--
-- Idempotency (S6): a new order may carry a key. A repeat of the call
-- answers the order the first one made, as it stands now, with
-- "repeat": true, and writes nothing.

create function platform_private.reserve_core(
  p_tenant_id uuid,
  p_order jsonb,
  p_rentals jsonb,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  c_attempts constant integer := 3;
  v_service boolean := platform_private.app_role() is not distinct from 'service_role';
  v_staff boolean;
  v_channel text;
  v_mode text;
  v_online boolean;
  v_action text;
  v_key text;
  v_count integer;
  v_line jsonb;
  v_product record;
  v_i integer;
  v_parent bigint;
  v_id uuid;
  v_quantity bigint;
  v_units uuid[];
  -- The order.
  v_order_id uuid;
  v_existing boolean;
  v_found record;
  v_status text;
  v_customer_id uuid;
  v_notes text;
  v_idem uuid;
  v_repeat boolean := false;
  v_code text;
  v_tries integer;
  v_number bigint;
  -- One entry per line, in the order sent.
  v_rental_ids uuid[] := '{}';
  v_product_ids uuid[] := '{}';
  v_location_ids uuid[] := '{}';
  v_types text[] := '{}';
  v_starts timestamptz[] := '{}';
  v_ends timestamptz[] := '{}';
  v_periods tstzrange[] := '{}';
  v_quantities integer[] := '{}';
  v_parents integer[] := '{}';
  -- The pairs to lock: the lines', and for an order there is, those its
  -- live reservations name.
  v_lock_products uuid[];
  v_lock_locations uuid[];
  v_live_ids uuid[] := '{}';
  v_live_products uuid[] := '{}';
  v_live_locations uuid[] := '{}';
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
  -- A refusal met inside an attempt: the attempt is undone, then answered.
  v_refusal jsonb;
  v_reservation_ids uuid[];
  v_constraint text;
  -- A hold, and when it runs out.
  v_hold boolean;
  v_draft boolean;
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
  -- The coupon: which one, and what the quote says it took.
  v_coupon_id uuid;
  v_coupon_amount bigint;
  v_currency text;
  v_coupon record;
  v_uses record;
begin
  -- 1. The caller, then the request -------------------------------------
  v_staff := platform_private.has_role(p_tenant_id, platform_private.booking_roles('reserve'));
  if not v_service and not v_staff then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed', 'line', null);
  end if;

  if p_order is null or jsonb_typeof(p_order) <> 'object'
    or p_request is null or jsonb_typeof(p_request) <> 'object'
  then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_order) loop
    if v_key not in ('id', 'channel', 'mode', 'customer_id', 'notes', 'idempotency_key') then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
  end loop;
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key not in ('action', 'coupon', 'charges') then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
  end loop;
  v_action := p_request ->> 'action';
  if jsonb_typeof(p_request -> 'action') is distinct from 'string'
    or v_action not in ('hold', 'reserve', 'draft')
  then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_hold := v_action = 'hold';
  v_draft := v_action = 'draft';

  v_order_id := platform_private.json_uuid(p_order, 'id', 'invalid_request');
  v_existing := v_order_id is not null;
  if v_existing then
    -- Only its id: what the order is, is read from its row.
    if (select count(*) from jsonb_object_keys(p_order)) <> 1 or v_draft
      or (p_request ? 'charges' and jsonb_typeof(p_request -> 'charges') <> 'null')
    then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    -- Not found, or another shop's: the same answer.
    select o.channel, o.mode, o.customer_id, o.status, o.hold_expires_at into v_found
    from platform.orders o
    where o.id = v_order_id and o.tenant_id = p_tenant_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found', 'line', null);
    end if;
    v_channel := v_found.channel;
    v_mode := v_found.mode;
    v_customer_id := v_found.customer_id;
  else
    v_order_id := gen_random_uuid();
    v_channel := p_order ->> 'channel';
    v_mode := p_order ->> 'mode';
    if jsonb_typeof(p_order -> 'channel') is distinct from 'string'
      or v_channel not in ('walk_in', 'phone', 'booking_page', 'marketplace', 'api')
      or jsonb_typeof(p_order -> 'mode') is distinct from 'string'
    then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
  end if;
  v_online := v_channel in ('booking_page', 'marketplace', 'api');

  -- Online channels are the server's (the service role); the counter and
  -- the phone are a signed-in member's. Neither may use the other's.
  if (v_online and not v_service) or (not v_online and not v_staff) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed', 'line', null);
  end if;

  -- Only a draft is held or reserved, or a hold that has run out (settled
  -- below, under the order's row). Anything else is told so now, before
  -- the pick could trip over the order's own units; the same is checked
  -- again under the row.
  if v_existing then
    if not (
      v_found.status = 'draft'
      or (v_found.status = 'new' and v_found.hold_expires_at <= clock_timestamp())
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_draft', 'line', null);
    end if;
  end if;

  if not v_existing then
    -- A request-mode booking holds no unit until the shop accepts it (3M).
    if (v_online and v_mode not in ('instant', 'now')) or (not v_online and v_mode <> 'staff') then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    -- "Ride today" is Moto Mangos' alone.
    if v_mode = 'now' and v_channel <> 'marketplace' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;

    -- A repeat of a call already answered: the order it made.
    v_idem := platform_private.json_uuid(p_order, 'idempotency_key', 'invalid_request');
    if v_idem is not null then
      select o.id into v_id
      from platform.orders o
      where o.tenant_id = p_tenant_id and o.idempotency_key = v_idem;
      if found then
        return platform_private.order_answer(p_tenant_id, v_id)
          || jsonb_build_object('repeat', true);
      end if;
    end if;

    -- Not found, archived, or another shop's: the same answer.
    v_customer_id := platform_private.json_uuid(p_order, 'customer_id', 'invalid_request');
    if v_customer_id is not null and not exists (
      select 1 from platform.customers c
      where c.id = v_customer_id and c.tenant_id = p_tenant_id and c.archived_at is null
    ) then
      raise exception 'customer_not_found' using errcode = 'P0001';
    end if;

    if p_order ? 'notes' and jsonb_typeof(p_order -> 'notes') <> 'null' then
      v_notes := p_order ->> 'notes';
      if jsonb_typeof(p_order -> 'notes') <> 'string' or length(v_notes) not between 1 and 4000 then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
    end if;
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

  if jsonb_typeof(p_rentals) is distinct from 'array'
    or jsonb_array_length(p_rentals) not between 1 and 200
  then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_rentals);

  for v_i in 1..v_count loop
    v_line := p_rentals -> (v_i - 1);
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_line) loop
      if v_key not in (
        'product_id', 'location_id', 'starts_at', 'ends_at', 'quantity', 'parent', 'unit_ids',
        'rental_id'
      ) then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
    end loop;

    v_rental_ids[v_i] := platform_private.json_uuid(v_line, 'rental_id', 'invalid_request');
    if (v_rental_ids[v_i] is not null) <> v_existing then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
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
    -- A vehicle rental is one vehicle (decision 2): one line per bike.
    if v_product.type = 'vehicle' and v_quantity <> 1 then
      raise exception 'invalid_request' using errcode = '22023';
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
      if v_online or v_draft or v_product.tracking <> 'unit'
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
      -- The same unit on an earlier line whose rental time overlaps or
      -- touches this one's: a bike is never on an order twice at the same
      -- time. Another period of the same unit is fine.
      if exists (
        select 1
        from unnest(v_named_unit, v_named_line) t(u, line)
        where t.u = any (v_units)
          and tstzrange(v_starts[t.line], v_ends[t.line], '[]')
            && tstzrange(v_starts[v_i], v_ends[v_i], '[]')
      ) then
        return jsonb_build_object('ok', false, 'reason', 'unit_twice', 'line', v_i - 1);
      end if;
      v_named_unit := v_named_unit || v_units;
      v_named_line := v_named_line || array_fill(v_i, array[cardinality(v_units)]);
    end if;
  end loop;

  -- The coupon, as decideDiscounts() and the quote left it: which one, and
  -- what it took. One per order. Whose use it is, is the order's customer.
  if p_request ? 'coupon' and jsonb_typeof(p_request -> 'coupon') <> 'null' then
    if jsonb_typeof(p_request -> 'coupon') <> 'object' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(p_request -> 'coupon') loop
      if v_key not in ('coupon_id', 'amount') then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
    end loop;
    v_coupon_id := platform_private.json_uuid(p_request -> 'coupon', 'coupon_id', 'invalid_request');
    v_coupon_amount := platform_private.json_whole(p_request -> 'coupon', 'amount', 'invalid_request');
    -- A coupon that takes nothing is not applied and is not a use; and
    -- the api channel takes no coupon yet.
    if v_coupon_id is null or v_coupon_amount is null or v_coupon_amount < 1
      or v_channel = 'api'
    then
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

  -- The charges, checked before any lock; stored with the order.
  perform platform_private.store_charges(
    p_tenant_id, v_order_id, v_currency, p_request -> 'charges', null, v_count, false);

  -- 2. The product-and-location locks, sorted once ----------------------
  -- Every line's, and for an order there is, those its live reservations
  -- name (a hold that has run out is released under them). A draft takes
  -- no stock and no lock.
  if not v_draft then
    v_lock_products := v_product_ids;
    v_lock_locations := v_location_ids;
    if v_existing then
      select coalesce(array_agg(r.id), '{}'), coalesce(array_agg(r.product_id), '{}'),
        coalesce(array_agg(r.location_id), '{}')
      into v_live_ids, v_live_products, v_live_locations
      from platform.reservations r
      where r.tenant_id = p_tenant_id and r.booking_id = v_order_id
        and r.state in ('held', 'reserved', 'out');
      v_lock_products := v_lock_products || v_live_products;
      v_lock_locations := v_lock_locations || v_live_locations;
    end if;
    perform platform_private.lock_products_stock(v_lock_products, v_lock_locations);

    -- The locks were chosen from what the rows named a moment ago. A unit
    -- moved meanwhile (move_unit), or a reservation added: not the right
    -- locks.
    if v_existing and exists (
      select 1 from platform.reservations r
      where r.tenant_id = p_tenant_id and r.booking_id = v_order_id
        and r.state in ('held', 'reserved', 'out')
        and not exists (
          select 1 from unnest(v_live_ids, v_live_products, v_live_locations)
            t(id, product_id, location_id)
          where t.id = r.id and t.product_id = r.product_id and t.location_id = r.location_id
        )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'try_again', 'line', null);
    end if;

    -- The same call sent twice at once: the second waited for these locks
    -- behind the first, and answers what the first made.
    if v_idem is not null then
      select o.id into v_id
      from platform.orders o
      where o.tenant_id = p_tenant_id and o.idempotency_key = v_idem;
      if found then
        return platform_private.order_answer(p_tenant_id, v_id)
          || jsonb_build_object('repeat', true);
      end if;
    end if;
  end if;

  -- 4. Pick, lock the picked units, read again --------------------------
  -- No other booking of these products is picking now. A downtime write or
  -- a unit leaving the fleet holds only its unit's lock, so it can still
  -- land between the pick and the lock. Each attempt is a sub-transaction:
  -- when a picked unit turns out taken, undoing the attempt gives its unit
  -- locks back, and the next attempt takes its own in key order again.
  --
  -- A refusal met inside an attempt is noted and raised (RSV03), so the
  -- attempt is undone whole; it is answered after the loop.
  for v_attempt in 1..c_attempts loop
    v_pick_line := '{}';
    v_pick_unit := '{}';
    v_pick_period := '{}';
    v_stale := '{}';
    v_short := array_fill(0, array[v_count]);
    begin
      -- Named units first, so no other line's pick takes one of them.
      for v_i in 1..v_count loop
        exit when v_draft;
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
        ) then
          v_refusal := jsonb_build_object('ok', false, 'reason', 'unit_taken', 'line', v_i - 1);
          raise exception 'refused' using errcode = 'RSV03';
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
            v_refusal := jsonb_build_object('ok', false, 'reason', 'unavailable', 'line', v_i - 1);
            raise exception 'refused' using errcode = 'RSV03';
          end if;
        end if;
        v_pick_unit := v_pick_unit || v_units;
        v_pick_line := v_pick_line || array_fill(v_i, array[cardinality(v_units)]);
        v_pick_period := v_pick_period || array_fill(v_periods[v_i], array[cardinality(v_units)]);
      end loop;

      -- Then best fit: the unit whose previous block ends closest before
      -- this window; then the one whose next block starts soonest after;
      -- then the lower lock key. A unit with no earlier block sorts last,
      -- so long gaps stay whole. A unit this order already takes for a
      -- rental time that overlaps or touches this line's is not picked
      -- again.
      for v_i in 1..v_count loop
        exit when v_draft;
        continue when v_types[v_i] = 'service' or v_i = any (v_named_line);
        -- What is free, less what short reservations are waiting for: the
        -- ones saved already, and this call's own earlier lines.
        select count(*) into v_free
        from platform_private.free_units(
          v_product_ids[v_i], v_location_ids[v_i], v_periods[v_i]) f(id)
        where f.id <> all (v_exclude)
          and not exists (
            select 1 from unnest(v_pick_unit, v_pick_period, v_pick_line) t(u, period, line)
            where t.u = f.id and (
              t.period && v_periods[v_i]
              or tstzrange(v_starts[t.line], v_ends[t.line], '[]')
                && tstzrange(v_starts[v_i], v_ends[v_i], '[]'))
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
              select 1 from unnest(v_pick_unit, v_pick_period, v_pick_line) t(u, period, line)
              where t.u = f.id and (
                t.period && v_periods[v_i]
                or tstzrange(v_starts[t.line], v_ends[t.line], '[]')
                  && tstzrange(v_starts[v_i], v_ends[v_i], '[]'))
            )
          order by before.ends desc nulls last, after.starts asc nulls last,
            hashtext(f.id::text), f.id
          limit least(v_quantities[v_i], greatest(v_free - v_demand, 0))
        ) x;
        if cardinality(v_units) < v_quantities[v_i] then
          if not v_overbook then
            v_refusal := jsonb_build_object('ok', false, 'reason', 'unavailable', 'line', v_i - 1);
            raise exception 'refused' using errcode = 'RSV03';
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

      -- Rows. First the order's own row, for an order there is (plan §4.2,
      -- class 3.1): the order functions' turnstile. Taken here, after this
      -- attempt's unit locks, never before them.
      if v_existing then
        perform 1 from platform.orders o where o.id = v_order_id for no key update;
        -- A hold that has run out is settled first, by the clock, with
        -- every lock held; then this call carries on from the draft.
        perform platform_private.settle_order_hold(p_tenant_id, v_order_id, clock_timestamp());
        select o.status into v_status from platform.orders o where o.id = v_order_id;
        if v_status <> 'draft' then
          v_refusal := jsonb_build_object('ok', false, 'reason', 'not_draft', 'line', null);
          raise exception 'refused' using errcode = 'RSV03';
        end if;
        -- Read again: the rentals are the ones the locks were chosen for.
        if exists (
          select 1 from platform.rentals n
          where n.tenant_id = p_tenant_id and n.order_id = v_order_id and n.status = 'draft'
            and not exists (
              select 1
              from unnest(v_rental_ids, v_product_ids, v_location_ids, v_starts, v_ends, v_quantities)
                t(id, product_id, location_id, starts_at, ends_at, quantity)
              where t.id = n.id and t.product_id = n.product_id
                and t.location_id = n.location_id and t.starts_at = n.starts_at
                and t.ends_at = n.ends_at and t.quantity = n.quantity
            )
        ) or exists (
          select 1 from unnest(v_rental_ids) t(id)
          where not exists (
            select 1 from platform.rentals n
            where n.id = t.id and n.tenant_id = p_tenant_id and n.order_id = v_order_id
              and n.status = 'draft'
          )
        ) or exists (
          select 1 from platform.reservations r
          where r.tenant_id = p_tenant_id and r.booking_id = v_order_id
            and r.state in ('held', 'reserved', 'out')
        ) then
          v_refusal := jsonb_build_object('ok', false, 'reason', 'try_again', 'line', null);
          raise exception 'refused' using errcode = 'RSV03';
        end if;
      end if;

      -- Then the picked units' rows, in id order, before any other row
      -- lock. Deleting a unit takes no advisory lock: it locks the unit's
      -- row and then the product's. A booking that held the product's row
      -- first and met the unit's row at its block insert could wait on such
      -- a delete while the delete waits on it. Here the booking holds no
      -- product row yet, so it only waits; a unit deleted meanwhile is gone
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
          v_refusal := jsonb_build_object('ok', false, 'reason', 'unit_taken', 'line', v_i - 1);
          raise exception 'refused' using errcode = 'RSV03';
        end if;
        v_refused_line := coalesce(v_refused_line, v_i);
        v_stale := v_stale || v_units;
      end loop;
      if cardinality(v_stale) > 0 then
        -- Plain variables keep their values when the attempt is undone.
        v_exclude := v_exclude || v_stale;
        raise exception 'pick_again' using errcode = 'RSV01';
      end if;

      -- The products' rows in id order. None was retired meanwhile.
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
      if v_channel = 'marketplace' and not v_draft then
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
            v_refusal := jsonb_build_object('ok', false, 'reason', 'not_listed', 'line', v_i - 1);
            raise exception 'refused' using errcode = 'RSV03';
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
            v_refusal := jsonb_build_object('ok', false, 'reason', 'cap_reached', 'line', v_i - 1);
            raise exception 'refused' using errcode = 'RSV03';
          end if;
        end loop;
      end if;

      -- 6. The coupon's row, after the products' and the listings' rows
      -- and before the order, its rentals, any reservation or block. The
      -- rules ran before this transaction (decideDiscounts); what a save or
      -- another booking can have changed since is read again here, under
      -- the lock: switched off, archived, another currency, the shop's
      -- "Accept coupons" switch, and the uses, in total and by this
      -- order's customer. Two bookings after a coupon's last use take
      -- turns at this row, and the second counts the first's redemption.
      if v_coupon_id is not null and not v_draft then
        select c.active, c.archived_at, c.currency, c.kind, c.amount,
          c.max_uses, c.max_uses_per_customer
        into v_coupon
        from platform.coupons c
        where c.id = v_coupon_id and c.tenant_id = p_tenant_id
        for update;
        if not found or not v_coupon.active or v_coupon.archived_at is not null
          or v_coupon.currency is distinct from v_currency
          or (v_coupon.kind = 'fixed' and v_coupon_amount > v_coupon.amount)
          -- "Accept coupons" off, or never saved: no code on any channel.
          -- A plain read: a booking never locks a pricing row.
          or not coalesce((
            select s.coupons_enabled from platform.pricing_settings s
            where s.tenant_id = p_tenant_id
          ), false)
        then
          v_refusal := jsonb_build_object('ok', false, 'reason', 'coupon_not_valid', 'line', null);
          raise exception 'refused' using errcode = 'RSV03';
        end if;
        -- A limit per customer needs a customer to count (plan §5.1).
        if v_coupon.max_uses_per_customer is not null and v_customer_id is null then
          v_refusal := jsonb_build_object('ok', false, 'reason', 'customer_needed', 'line', null);
          raise exception 'refused' using errcode = 'RSV03';
        end if;
        -- The uses, when the coupon has a limit to hold them to. A hold
        -- that has run out holds no use, swept yet or not.
        if v_coupon.max_uses is not null or v_coupon.max_uses_per_customer is not null then
          select u.total, u.customer into v_uses
          from platform_private.coupon_uses(v_coupon_id, v_customer_id, null) u;
          if v_uses.total >= v_coupon.max_uses
            or v_uses.customer >= v_coupon.max_uses_per_customer
          then
            v_refusal := jsonb_build_object('ok', false, 'reason', 'coupon_used_up', 'line', null);
            raise exception 'refused' using errcode = 'RSV03';
          end if;
        end if;
      end if;

      -- 3. Holds that have run out on these products are released. The
      -- pick did not count them; their blocks must be gone before the
      -- constraint sees the new ones.
      if not v_draft then
        perform platform_private.expire_holds(p_tenant_id, v_product_ids, v_location_ids, now());
      end if;

      -- 7. The order and its rentals (plan §4.2, class 3.7): after the
      -- coupon's row, before the reservations. A new order has no number
      -- yet; it is written last of all.
      if v_existing then
        update platform.orders o
        set status = case when v_hold then 'new' else 'booked' end,
          hold_expires_at = v_expires
        where o.id = v_order_id;
        update platform.rentals n set status = 'booked'
        where n.id = any (v_rental_ids);
      else
        v_tries := 0;
        loop
          v_code := platform_private.order_code();
          insert into platform.orders (
            id, tenant_id, code, customer_id, status, hold_expires_at, channel, mode,
            currency, idempotency_key, notes
          )
          values (
            v_order_id, p_tenant_id, v_code, v_customer_id,
            case when v_draft then 'draft' when v_hold then 'new' else 'booked' end,
            v_expires, v_channel, v_mode, v_currency, v_idem, v_notes
          )
          on conflict do nothing;
          exit when found;
          -- The key is taken: the same call, answered already.
          if v_idem is not null and exists (
            select 1 from platform.orders o
            where o.tenant_id = p_tenant_id and o.idempotency_key = v_idem
          ) then
            raise exception 'repeat' using errcode = 'RSV02';
          end if;
          -- Else the code was: another one.
          v_tries := v_tries + 1;
          if v_tries >= 20 then
            raise exception 'order_code_clash' using errcode = 'P0001';
          end if;
        end loop;

        for v_i in 1..v_count loop
          insert into platform.rentals (
            tenant_id, order_id, parent_rental_id, product_id, product_type, location_id,
            quantity, starts_at, ends_at, status, position
          )
          values (
            p_tenant_id, v_order_id,
            case when v_parents[v_i] > 0 then v_rental_ids[v_parents[v_i]] end,
            v_product_ids[v_i], v_types[v_i], v_location_ids[v_i], v_quantities[v_i],
            v_starts[v_i], v_ends[v_i], case when v_draft then 'draft' else 'booked' end,
            v_i - 1
          )
          returning id into v_id;
          v_rental_ids[v_i] := v_id;
        end loop;
      end if;

      -- 8. The reservations, each with its rental, then the blocks in
      -- sorted unit order. The exclusion constraint has the last word.
      v_reservation_ids := '{}';
      if not v_draft then
        for v_i in 1..v_count loop
          insert into platform.reservations (
            tenant_id, booking_id, rental_id, parent_id, product_id, product_type, location_id,
            starts_at, ends_at, block_period, quantity, shortage, channel, mode, state,
            hold_expires_at
          )
          values (
            p_tenant_id, v_order_id, v_rental_ids[v_i],
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
      end if;

      -- 9. The charges and their lines; then the coupon's use, with the
      -- order's customer. The amounts are the quote's; the database does
      -- not work them out.
      if not v_existing then
        perform platform_private.store_charges(
          p_tenant_id, v_order_id, v_currency, p_request -> 'charges', v_rental_ids, v_count,
          true);
      end if;
      if v_coupon_id is not null and not v_draft then
        insert into platform.coupon_redemptions (
          tenant_id, coupon_id, booking_id, customer_id, amount
        )
        values (p_tenant_id, v_coupon_id, v_order_id, v_customer_id, v_coupon_amount);
      end if;

      v_done := true;
    exception
      when sqlstate 'RSV01' then
        null;
      when sqlstate 'RSV02' then
        v_repeat := true;
      when sqlstate 'RSV03' then
        null;
      when exclusion_violation or foreign_key_violation then
        -- Only a unit that was reached without its lock (deleted, or a
        -- block written past the guard) is "taken, pick again": the
        -- exclusion constraint, or the block's own key to its unit. Any
        -- other key that fails (the order, a rental, the customer, a
        -- product) is a fault, and is raised as it is.
        get stacked diagnostics v_constraint = constraint_name;
        if sqlstate = '23503'
          and v_constraint is distinct from 'unit_blocks_tenant_id_unit_id_fkey'
        then
          raise;
        end if;
        -- Nothing of this attempt is kept. The units that are taken now
        -- are left out of the next attempt, and a line that named one is
        -- answered unit_taken there.
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
    exit when v_done or v_repeat or v_refusal is not null;
  end loop;

  if v_repeat then
    select o.id into v_id
    from platform.orders o
    where o.tenant_id = p_tenant_id and o.idempotency_key = v_idem;
    return platform_private.order_answer(p_tenant_id, v_id) || jsonb_build_object('repeat', true);
  end if;

  if not v_done then
    -- Refused, with the attempt undone. A hold that had run out stays
    -- settled all the same (plan §3.3): the order's row, with no unit lock
    -- held now, then the settlement.
    if v_existing then
      perform 1 from platform.orders o where o.id = v_order_id for no key update;
      perform platform_private.settle_order_hold(p_tenant_id, v_order_id, clock_timestamp());
    end if;
    return coalesce(v_refusal, jsonb_build_object(
      'ok', false, 'reason', 'unavailable', 'line', coalesce(v_refused_line, 1) - 1));
  end if;

  -- 10. One audit event for the booking.
  perform platform_private.audit(
    p_tenant_id, 'bookings', v_order_id::text, case when v_draft then 'draft' else 'reserve' end,
    null,
    jsonb_build_object(
      'channel', v_channel,
      'mode', v_mode,
      'hold', v_hold,
      'hold_expires_at', v_expires,
      'lines', (
        select jsonb_agg(
          jsonb_build_object(
            'rental_id', v_rental_ids[l.i],
            'reservation_id', v_reservation_ids[l.i],
            'unit_ids', coalesce((
              select jsonb_agg(t.u order by hashtext(t.u::text), t.u)
              from unnest(v_pick_unit, v_pick_line) t(u, line)
              where t.line = l.i
            ), '[]'::jsonb),
            'shortage', v_short[l.i],
            'product_id', v_product_ids[l.i],
            'location_id', v_location_ids[l.i],
            'starts_at', v_starts[l.i],
            'ends_at', v_ends[l.i],
            'quantity', v_quantities[l.i])
          order by l.i)
        from generate_series(1, v_count) l(i)
      ))
      || case when v_coupon_id is null or v_draft then '{}'::jsonb else jsonb_build_object(
        'coupon', jsonb_build_object(
          'coupon_id', v_coupon_id, 'amount', v_coupon_amount::text)) end);

  -- 11. Last of all (plan §4.2, class 3.10): the shop's counter, then the
  -- new order's own row, which this transaction inserted and nobody else
  -- can be waiting on.
  if not v_existing then
    update platform.order_counters c
    set next_number = c.next_number + 1
    where c.tenant_id = p_tenant_id
    returning c.next_number - 1 into v_number;
    update platform.orders o set number = v_number where o.id = v_order_id;
  end if;

  return platform_private.order_answer(p_tenant_id, v_order_id);
exception
  when deadlock_detected then
    return jsonb_build_object('ok', false, 'reason', 'try_again', 'line', null);
end;
$function$;

revoke all on function platform_private.reserve_core(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
alter function platform_private.reserve_core(uuid, jsonb, jsonb, jsonb) set lock_timeout = '6s';

-- 6. The cores ----------------------------------------------------------------------------------
-- Phase 2's confirm_hold(), cancel_reservation() and assign_units(), moved
-- to platform_private and written for orders. Nobody signed in can call
-- them: the order functions (8) are their only callers, and check who is
-- calling first. Each follows one pattern (plan §3.3):
--   1. read the order's live reservations, unlocked;
--   2. take the product-and-location locks they name, then read again
--      (try_again if a row names another product or place now), then the
--      unit locks of their blocks;
--   3. take the order's row, `for no key update`;
--   4. settle a hold that has run out, by the clock, with every lock held.
--      The settlement is kept whatever the call then answers: a refusal is
--      returned, never raised;
--   5. read again under the order's row, then write.

-- confirm_hold(): a held order becomes booked. It reads the order's LIVE
-- reservations only (M5): a draft that was held, ran out, and is held again
-- has old rows in 'expired' beside the new ones, and they no longer count.
--
-- Answers { ok, order_id, reservation_ids } or { ok: false, reason }:
--   not_found; try_again; hold_expired (the hold had run out: it is settled
--   now, and stays so); not_held (nothing to confirm).
-- An order that is booked already is answered ok, with no rows.
create function platform_private.confirm_hold(p_tenant_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order record;
  v_status text;
  v_ids uuid[];
  v_product_ids uuid[];
  v_location_ids uuid[];
  v_held uuid[];
begin
  if p_order_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  -- Not found, or another shop's: the same answer.
  select o.channel into v_order
  from platform.orders o
  where o.id = p_order_id and o.tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select coalesce(array_agg(r.id), '{}'), coalesce(array_agg(r.product_id), '{}'),
    coalesce(array_agg(r.location_id), '{}')
  into v_ids, v_product_ids, v_location_ids
  from platform.reservations r
  where r.tenant_id = p_tenant_id and r.booking_id = p_order_id
    and r.state in ('held', 'reserved', 'out');

  -- Product locks, then unit locks, then rows.
  perform platform_private.lock_products_stock(v_product_ids, v_location_ids);
  -- A unit moved meanwhile (move_unit): a row names another product or
  -- place now, or the order has a new row. Not the right locks.
  if exists (
    select 1 from platform.reservations r
    where r.tenant_id = p_tenant_id and r.booking_id = p_order_id
      and r.state in ('held', 'reserved', 'out')
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

  -- The order's row, first of the rows.
  perform 1 from platform.orders o where o.id = p_order_id for no key update;
  -- A Moto Mangos hold: the products' rows, then their listings' rows, as
  -- reserve_core() takes them, before any reservation row. The cap is
  -- counted under the listing's row, so a confirm and a new booking take
  -- turns there.
  if v_order.channel = 'marketplace' then
    perform 1 from platform.products p
    where p.id = any (v_product_ids)
    order by p.id
    for share;
    perform 1 from platform.product_listings l
    where l.product_id = any (v_product_ids)
    order by l.product_id
    for no key update;
  end if;
  -- The coupon's row, before the reservations. A hold whose time has run
  -- out holds no use (coupon_uses()), so a booking may have taken it;
  -- confirming the hold then would add a use. A use is only ever added
  -- under the coupon's row: a confirm and a booking after the same coupon
  -- take turns here.
  perform 1 from platform.coupons c
  where c.id in (
    select x.coupon_id from platform.coupon_redemptions x
    where x.tenant_id = p_tenant_id and x.booking_id = p_order_id
      and x.released_at is null
  )
  order by c.id
  for update;
  perform 1 from platform.reservations r
  where r.id = any (v_ids)
  order by r.id
  for update;

  -- The hold's expiry is judged now, by the clock, with every lock held:
  -- not when this call began, which may be before a wait for one of them.
  -- A hold that has run out is settled, and that is kept.
  if platform_private.settle_order_hold(p_tenant_id, p_order_id, clock_timestamp()) then
    return jsonb_build_object('ok', false, 'reason', 'hold_expired');
  end if;

  select o.status into v_status from platform.orders o where o.id = p_order_id;
  if v_status = 'booked' then
    return jsonb_build_object('ok', true, 'order_id', p_order_id, 'reservation_ids', '[]'::jsonb);
  end if;
  if v_status <> 'new' then
    -- Settled before this call: a hold that ran out and holds nothing now.
    if not exists (
      select 1 from platform.reservations r
      where r.tenant_id = p_tenant_id and r.booking_id = p_order_id
        and r.state in ('held', 'reserved', 'out')
    ) and exists (
      select 1 from platform.reservations r
      where r.tenant_id = p_tenant_id and r.booking_id = p_order_id and r.state = 'expired'
    ) and not exists (
      select 1 from platform.reservations r
      where r.tenant_id = p_tenant_id and r.booking_id = p_order_id and r.state = 'cancelled'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'hold_expired');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_held');
  end if;
  -- Read again, under the order's row: the rows the locks were chosen for.
  if exists (
    select 1 from platform.reservations r
    where r.tenant_id = p_tenant_id and r.booking_id = p_order_id
      and r.state in ('held', 'reserved', 'out') and r.id <> all (v_ids)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
  end if;

  select coalesce(array_agg(r.id order by r.id), '{}') into v_held
  from platform.reservations r
  where r.id = any (v_ids) and r.state = 'held';

  update platform.unit_blocks b set kind = 'allocation'
  where b.reservation_id = any (v_held);
  update platform.reservations r
  set state = 'reserved', hold_expires_at = null
  where r.id = any (v_held);
  update platform.orders o
  set status = 'booked', hold_expires_at = null
  where o.id = p_order_id;

  perform platform_private.audit(
    p_tenant_id, 'bookings', p_order_id::text, 'confirm', null,
    jsonb_build_object('reservation_ids', to_jsonb(v_held)));

  return jsonb_build_object(
    'ok', true, 'order_id', p_order_id, 'reservation_ids', to_jsonb(v_held));
exception
  when deadlock_detected then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
end;
$function$;

revoke all on function platform_private.confirm_hold(uuid, uuid) from public, anon, authenticated;
alter function platform_private.confirm_hold(uuid, uuid) set lock_timeout = '6s';

-- cancel_reservation(): the whole order (p_reservation_id empty), or one of
-- its reservations with the extras booked with it. The whole order: its
-- held and reserved rows are cancelled, its rentals and the order are
-- 'canceled' with who and why, its open charges are void (payments and the
-- credit they leave arrive with the ledger, migration 4), and the coupon's
-- use is given back under the coupon's row. A draft, which holds nothing,
-- is cancelled the same way. One reservation: only its stock is given
-- back, and its rental is 'canceled' when nothing of it is left
-- (cancel_rental(), migration 6, is its order function; until then only
-- the tests reach this).
--
-- A hold that has run out is settled first, and the cancel carries on from
-- what that left.
--
-- Answers { ok, order_id, reservation_ids } or { ok: false, reason }:
--   not_found; try_again; not_cancellable (something is out or returned, or
--   the order is archived).
-- An order that is canceled already is answered ok, with no rows.
create function platform_private.cancel_reservation(
  p_tenant_id uuid,
  p_order_id uuid,
  p_reservation_id uuid,
  p_cancelled_by text,
  p_cancel_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_whole boolean := p_reservation_id is null;
  v_status text;
  v_ids uuid[];
  v_product_ids uuid[];
  v_location_ids uuid[];
  v_cancelled uuid[];
  v_lines jsonb;
begin
  if p_order_id is null
    or p_cancelled_by is null or p_cancelled_by not in ('customer', 'shop', 'system')
    or p_cancel_reason is null
    or p_cancel_reason not in ('expired', 'customer_request', 'shop_request', 'no_show', 'other')
  then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  -- Not found, or another shop's: the same answer.
  if not exists (
    select 1 from platform.orders o where o.id = p_order_id and o.tenant_id = p_tenant_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select coalesce(array_agg(r.id), '{}'), coalesce(array_agg(r.product_id), '{}'),
    coalesce(array_agg(r.location_id), '{}')
  into v_ids, v_product_ids, v_location_ids
  from platform.reservations r
  where r.tenant_id = p_tenant_id and r.booking_id = p_order_id
    and (v_whole or r.id = p_reservation_id or r.parent_id = p_reservation_id);
  if not v_whole and cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Product locks, then unit locks, then rows.
  perform platform_private.lock_products_stock(v_product_ids, v_location_ids);
  -- The locks were chosen from what the rows named a moment ago. If a unit
  -- was moved meanwhile (move_unit) a row names another product or place
  -- now, or the order has a new row: these are not the right locks.
  if exists (
    select 1 from platform.reservations r
    where r.tenant_id = p_tenant_id and r.booking_id = p_order_id
      and (v_whole or r.id = p_reservation_id or r.parent_id = p_reservation_id)
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

  -- The order's row, first of the rows.
  perform 1 from platform.orders o where o.id = p_order_id for no key update;
  -- The coupon's row, before the reservations: the use is given back
  -- under it.
  perform 1 from platform.coupons c
  where c.id in (
    select x.coupon_id from platform.coupon_redemptions x
    where x.tenant_id = p_tenant_id and x.booking_id = p_order_id
      and x.released_at is null
  )
  order by c.id
  for update;
  perform 1 from platform.reservations r
  where r.id = any (v_ids)
  order by r.id
  for update;

  -- A hold that has run out is settled first; the cancel carries on.
  perform platform_private.settle_order_hold(p_tenant_id, p_order_id, clock_timestamp());

  select o.status into v_status from platform.orders o where o.id = p_order_id;
  if v_status = 'archived' then
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
  end if;
  if v_whole and v_status = 'canceled' then
    return jsonb_build_object('ok', true, 'order_id', p_order_id, 'reservation_ids', '[]'::jsonb);
  end if;
  -- Read again, under the order's row.
  if exists (
    select 1 from platform.reservations r
    where r.tenant_id = p_tenant_id and r.booking_id = p_order_id
      and (v_whole or r.id = p_reservation_id or r.parent_id = p_reservation_id)
      and r.id <> all (v_ids)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
  end if;
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
    perform platform_private.release_coupon_use(p_tenant_id, p_order_id);
  end if;

  if v_whole then
    update platform.rentals n set status = 'canceled'
    where n.tenant_id = p_tenant_id and n.order_id = p_order_id and n.status <> 'canceled';
    update platform.order_charges c set status = 'void'
    where c.tenant_id = p_tenant_id and c.order_id = p_order_id and c.status = 'open';
    update platform.orders o
    set status = 'canceled', hold_expires_at = null, cancelled_by = p_cancelled_by,
      cancel_reason = p_cancel_reason, no_show = (p_cancel_reason = 'no_show'),
      canceled_at = now()
    where o.id = p_order_id;
  else
    -- A rental with nothing live left.
    update platform.rentals n set status = 'canceled'
    where n.tenant_id = p_tenant_id and n.order_id = p_order_id
      and n.id in (select r.rental_id from platform.reservations r where r.id = any (v_cancelled))
      and not exists (
        select 1 from platform.reservations r
        where r.rental_id = n.id and r.state in ('held', 'reserved', 'out')
      );
  end if;

  if v_whole or cardinality(v_cancelled) > 0 then
    perform platform_private.audit(
      p_tenant_id, 'bookings', p_order_id::text, 'cancel', null,
      jsonb_build_object('reservation_ids', to_jsonb(v_cancelled), 'lines', v_lines)
      || case when v_whole then jsonb_build_object(
        'cancelled_by', p_cancelled_by, 'cancel_reason', p_cancel_reason)
        else '{}'::jsonb end);
  end if;

  return jsonb_build_object(
    'ok', true, 'order_id', p_order_id, 'reservation_ids', to_jsonb(v_cancelled));
exception
  when deadlock_detected then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
end;
$function$;

revoke all on function platform_private.cancel_reservation(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
alter function platform_private.cancel_reservation(uuid, uuid, uuid, text, text)
  set lock_timeout = '6s';

-- assign_units(): fill a reservation's shortage (no units named), or set
-- the units it holds, before pickup. As Phase 2's, with the order's row
-- taken in each attempt after that attempt's unit locks, and:
--   hold_expired  the order's hold had run out: it is settled now, and
--                 stays so;
--   unit_twice    a named unit is already on this order for a rental
--                 time that overlaps or touches this reservation's (the
--                 owner, 25 Nov 2026). A fill never picks such a unit.
create function platform_private.assign_units(
  p_tenant_id uuid,
  p_order_id uuid,
  p_reservation_id uuid,
  p_unit_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  c_attempts constant integer := 3;
  v_named boolean := p_unit_ids is not null;
  v_r platform.reservations%rowtype;
  v_status text;
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
  v_constraint text;
begin
  if p_order_id is null or p_reservation_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Not found, another order's, or another shop's: the same answer.
  select * into v_r
  from platform.reservations r
  where r.tenant_id = p_tenant_id and r.id = p_reservation_id and r.booking_id = p_order_id;
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
      else
        -- Best fit, the rule reserve_core() picks by. Never a unit this
        -- order already takes for a time that overlaps or touches.
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
            and not exists (
              select 1
              from platform.unit_blocks b
              join platform.reservations o on o.id = b.reservation_id
              where b.unit_id = f.id and o.booking_id = v_r.booking_id and o.id <> v_r.id
                and tstzrange(o.starts_at, o.ends_at, '[]')
                  && tstzrange(v_r.starts_at, v_r.ends_at, '[]')
            )
          order by before.ends desc nulls last, after.starts asc nulls last,
            hashtext(f.id::text), f.id
          limit v_r.shortage
        ) x;
      end if;

      -- 2. The unit locks: the ones it has and the ones it takes, together,
      -- in key order.
      perform platform_private.lock_units(v_current || v_add);

      -- 3. Rows. The order's row first, after this attempt's unit locks. A
      -- hold that has run out is settled, and that is kept: the answer is
      -- returned from inside the attempt, which keeps its writes.
      perform 1 from platform.orders o where o.id = p_order_id for no key update;
      if platform_private.settle_order_hold(p_tenant_id, p_order_id, clock_timestamp()) then
        return jsonb_build_object('ok', false, 'reason', 'hold_expired');
      end if;
      select o.status into v_status from platform.orders o where o.id = p_order_id;
      select * into v_r from platform.reservations r where r.id = p_reservation_id;
      if v_status not in ('new', 'booked') or v_r.state not in ('held', 'reserved') then
        return jsonb_build_object('ok', false, 'reason', 'not_assignable');
      end if;

      if v_named then
        -- On this order already, for a time that overlaps or touches.
        if exists (
          select 1
          from platform.unit_blocks b
          join platform.reservations o on o.id = b.reservation_id
          where b.unit_id = any (v_add) and o.booking_id = v_r.booking_id and o.id <> v_r.id
            and tstzrange(o.starts_at, o.ends_at, '[]')
              && tstzrange(v_r.starts_at, v_r.ends_at, '[]')
        ) then
          return jsonb_build_object('ok', false, 'reason', 'unit_twice');
        end if;
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
      elsif v_r.shortage > 0 and cardinality(v_add) = 0 then
        return jsonb_build_object('ok', false, 'reason', 'unavailable');
      end if;

      -- Then the new units' rows, in id order, as reserve_core().
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

      -- The reservation, then its blocks.
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
        -- Only a unit reached without its lock is "taken, pick again"; any
        -- other key that fails is raised (as reserve_core()).
        get stacked diagnostics v_constraint = constraint_name;
        if sqlstate = '23503'
          and v_constraint is distinct from 'unit_blocks_tenant_id_unit_id_fkey'
        then
          raise;
        end if;
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
        'rental_id', v_r.rental_id,
        'added', to_jsonb(v_add),
        'removed', to_jsonb(v_drop),
        'unit_ids', to_jsonb(v_after),
        'shortage', v_r.quantity - cardinality(v_after)));
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_r.booking_id,
    'rental_id', v_r.rental_id,
    'reservation_id', v_r.id,
    'unit_ids', to_jsonb(v_after),
    'added', to_jsonb(v_add),
    'removed', to_jsonb(v_drop),
    'shortage', v_r.quantity - cardinality(v_after));
exception
  when deadlock_detected then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
end;
$function$;

revoke all on function platform_private.assign_units(uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;
alter function platform_private.assign_units(uuid, uuid, uuid, uuid[]) set lock_timeout = '6s';

-- 7. Phase 2's entry points are gone ------------------------------------------------------------
-- Every booking is an order (decision 10): nothing reserves, confirms,
-- cancels or assigns except through the order functions below.

drop function platform.reserve(uuid, jsonb);
drop function platform.confirm_hold(uuid, uuid);
drop function platform.cancel_reservation(uuid, uuid, uuid);
drop function platform.assign_units(uuid, uuid, uuid[]);

-- 8. The order functions ------------------------------------------------------------------------
-- Who may call what (plan §3.9). Making, holding, reserving and confirming
-- follow the channel, as Phase 2 did: the service role for booking_page,
-- marketplace and api orders only; a signed-in owner, manager or staff
-- member for walk_in and phone orders only. Cancelling is the server's and
-- a member's for any order of the shop, as Phase 2's cancel was: the shop
-- cancels a web booking at the counter. Naming units is a member's. Each
-- has the 6-second lock timeout; its caller answers try_again for 55P03,
-- 57014 and 40P01 (packages/booking/src/try-again.ts).

-- create_order(): a new order with its rentals and charges, held, reserved
-- or saved as a draft, through reserve_core().
--
-- p_order: { "channel", "mode", "action": "hold" | "reserve" | "draft",
--            "customer_id", "notes", "idempotency_key",
--            "lines": [ ... ], "coupon": { ... }, "charges": [ ... ] }
-- (lines, coupon and charges as reserve_core() reads them).
create function platform.create_order(p_tenant_id uuid, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text;
begin
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_order) loop
    if v_key not in (
      'channel', 'mode', 'action', 'customer_id', 'notes', 'idempotency_key', 'lines',
      'coupon', 'charges'
    ) then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
  end loop;
  return platform_private.reserve_core(
    p_tenant_id,
    p_order - 'action' - 'lines' - 'coupon' - 'charges',
    p_order -> 'lines',
    jsonb_strip_nulls(jsonb_build_object(
      'action', p_order -> 'action',
      'coupon', p_order -> 'coupon',
      'charges', p_order -> 'charges')));
end;
$function$;

revoke all on function platform.create_order(uuid, jsonb) from public, anon;
grant execute on function platform.create_order(uuid, jsonb) to authenticated, service_role;
alter function platform.create_order(uuid, jsonb) set lock_timeout = '6s';

-- A draft held (hold_order) or reserved (reserve_order): its rentals as
-- they were saved, through reserve_core(). Also a hold that has run out and
-- not been settled yet: it is settled, and held or reserved again from the
-- draft that leaves (decision 22). p_request may carry the coupon, as
-- create_order's: a draft holds no use, and a hold that ran out gave its
-- use back.
create function platform_private.reserve_existing(
  p_tenant_id uuid,
  p_order_id uuid,
  p_action text,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text;
  v_rentals jsonb;
begin
  if p_order_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_request is not null and jsonb_typeof(p_request) <> 'null' then
    if jsonb_typeof(p_request) <> 'object' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(p_request) loop
      if v_key <> 'coupon' then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- The rentals as booked, in their own order. Read unlocked: reserve_core()
  -- reads them again under the order's row and answers try_again if they
  -- changed.
  select jsonb_agg(
    jsonb_build_object(
      'rental_id', n.id,
      'product_id', n.product_id,
      'location_id', n.location_id,
      'starts_at', to_char(n.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'ends_at', to_char(n.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'quantity', n.quantity)
    || case when n.parent_rental_id is null then '{}'::jsonb else jsonb_build_object(
      'parent', (
        select count(*)
        from platform.rentals m
        join platform.rentals parent on parent.id = n.parent_rental_id
        where m.tenant_id = n.tenant_id and m.order_id = n.order_id
          and m.status <> 'canceled' and m.position < parent.position
      )) end
    order by n.position)
  into v_rentals
  from platform.rentals n
  where n.tenant_id = p_tenant_id and n.order_id = p_order_id and n.status <> 'canceled';

  if v_rentals is null then
    -- No such order, or another shop's; or an order with nothing to take.
    if not exists (
      select 1 from platform.orders o where o.id = p_order_id and o.tenant_id = p_tenant_id
    ) then
      -- reserve_core() answers not_allowed before not_found, as for any order.
      return platform_private.reserve_core(
        p_tenant_id, jsonb_build_object('id', p_order_id),
        '[{}]'::jsonb, jsonb_build_object('action', p_action));
    end if;
    if not platform_private.has_role(p_tenant_id, platform_private.booking_roles('reserve'))
      and platform_private.app_role() is distinct from 'service_role'
    then
      return jsonb_build_object('ok', false, 'reason', 'not_allowed', 'line', null);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_reserve', 'line', null);
  end if;

  return platform_private.reserve_core(
    p_tenant_id,
    jsonb_build_object('id', p_order_id),
    v_rentals,
    jsonb_strip_nulls(jsonb_build_object(
      'action', p_action,
      'coupon', case when p_request is null then null else p_request -> 'coupon' end)));
end;
$function$;

revoke all on function platform_private.reserve_existing(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

create function platform.hold_order(
  p_tenant_id uuid,
  p_order_id uuid,
  p_request jsonb default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select platform_private.reserve_existing(p_tenant_id, p_order_id, 'hold', p_request);
$function$;

revoke all on function platform.hold_order(uuid, uuid, jsonb) from public, anon;
grant execute on function platform.hold_order(uuid, uuid, jsonb) to authenticated, service_role;
alter function platform.hold_order(uuid, uuid, jsonb) set lock_timeout = '6s';

create function platform.reserve_order(
  p_tenant_id uuid,
  p_order_id uuid,
  p_request jsonb default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select platform_private.reserve_existing(p_tenant_id, p_order_id, 'reserve', p_request);
$function$;

revoke all on function platform.reserve_order(uuid, uuid, jsonb) from public, anon;
grant execute on function platform.reserve_order(uuid, uuid, jsonb) to authenticated, service_role;
alter function platform.reserve_order(uuid, uuid, jsonb) set lock_timeout = '6s';

-- Whether the caller may work on this order. p_rule:
--   'channel'  the server for an online order, a member with the action's
--              role for a counter or phone order (confirm);
--   'any'      the server, or a member with the action's role (cancel);
--   'members'  a member with the action's role only (assign).
-- 'not_found' for no such order or another shop's, but only once the caller
-- is known to be someone who may ask.
create function platform_private.order_caller(
  p_tenant_id uuid,
  p_order_id uuid,
  p_action text,
  p_rule text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_service boolean := platform_private.app_role() is not distinct from 'service_role';
  v_staff boolean := platform_private.has_role(
    p_tenant_id, platform_private.booking_roles(p_action));
  v_channel text;
  v_online boolean;
begin
  if not v_staff and (p_rule = 'members' or not v_service) then
    return 'not_allowed';
  end if;
  if p_order_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select o.channel into v_channel
  from platform.orders o
  where o.id = p_order_id and o.tenant_id = p_tenant_id;
  if not found then
    return 'not_found';
  end if;
  if p_rule <> 'channel' then
    return 'ok';
  end if;
  v_online := v_channel in ('booking_page', 'marketplace', 'api');
  if (v_online and not v_service) or (not v_online and not v_staff) then
    return 'not_allowed';
  end if;
  return 'ok';
end;
$function$;

revoke all on function platform_private.order_caller(uuid, uuid, text, text)
  from public, anon, authenticated;

-- confirm_order(): a held order becomes booked.
create function platform.confirm_order(p_tenant_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller text := platform_private.order_caller(p_tenant_id, p_order_id, 'confirm', 'channel');
begin
  if v_caller <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v_caller);
  end if;
  return platform_private.confirm_hold(p_tenant_id, p_order_id);
end;
$function$;

revoke all on function platform.confirm_order(uuid, uuid) from public, anon;
grant execute on function platform.confirm_order(uuid, uuid) to authenticated, service_role;
alter function platform.confirm_order(uuid, uuid) set lock_timeout = '6s';

-- cancel_order(): a new, draft or booked order with nothing out becomes
-- canceled. Who cancelled and why: for a member 'shop' and 'shop_request'
-- unless said; for the server 'customer' and 'customer_request' unless
-- said. 'system' and 'expired' are the database's own (a hold that ran
-- out), and can't be sent.
create function platform.cancel_order(
  p_tenant_id uuid,
  p_order_id uuid,
  p_cancelled_by text default null,
  p_cancel_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller text := platform_private.order_caller(p_tenant_id, p_order_id, 'cancel', 'any');
  v_by text;
  v_reason text;
begin
  if v_caller <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v_caller);
  end if;
  v_by := coalesce(p_cancelled_by,
    case when platform_private.app_role() is not distinct from 'service_role'
      then 'customer' else 'shop' end);
  v_reason := coalesce(p_cancel_reason,
    case when v_by = 'customer' then 'customer_request' else 'shop_request' end);
  if v_by not in ('customer', 'shop')
    or v_reason not in ('customer_request', 'shop_request', 'no_show', 'other')
  then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  return platform_private.cancel_reservation(p_tenant_id, p_order_id, null, v_by, v_reason);
end;
$function$;

revoke all on function platform.cancel_order(uuid, uuid, text, text) from public, anon;
grant execute on function platform.cancel_order(uuid, uuid, text, text)
  to authenticated, service_role;
alter function platform.cancel_order(uuid, uuid, text, text) set lock_timeout = '6s';

-- assign_order_units(): before pickup, fill a rental's shortage (no units
-- named) or set the units it holds. A member's, on any order of the shop.
-- The rental's one live reservation is the row; a rental with none (a
-- draft, a canceled one, a service) or with several (gear whose row
-- move_unit() split) is not_assignable.
create function platform.assign_order_units(
  p_tenant_id uuid,
  p_order_id uuid,
  p_rental_id uuid,
  p_unit_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller text := platform_private.order_caller(p_tenant_id, p_order_id, 'assign', 'members');
  v_ids uuid[];
begin
  if v_caller <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v_caller);
  end if;
  if p_rental_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from platform.rentals n
    where n.id = p_rental_id and n.tenant_id = p_tenant_id and n.order_id = p_order_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select coalesce(array_agg(r.id), '{}') into v_ids
  from platform.reservations r
  where r.tenant_id = p_tenant_id and r.booking_id = p_order_id and r.rental_id = p_rental_id
    and r.state in ('held', 'reserved', 'out');
  if cardinality(v_ids) <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'not_assignable');
  end if;
  return platform_private.assign_units(p_tenant_id, p_order_id, v_ids[1], p_unit_ids);
end;
$function$;

revoke all on function platform.assign_order_units(uuid, uuid, uuid, uuid[])
  from public, anon, service_role;
grant execute on function platform.assign_order_units(uuid, uuid, uuid, uuid[]) to authenticated;
alter function platform.assign_order_units(uuid, uuid, uuid, uuid[]) set lock_timeout = '6s';

-- 9. The currency lock knows about orders -------------------------------------------------------
-- A shop with an order can't change its currency: the orders' own key to
-- the shop's currency refuses it (S8, 23503). This read is what Settings
-- shows before anyone tries, so it must say the same. As it stood
-- (20261119000100), plus orders.

create or replace function platform.currency_locked(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
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
    or exists (select 1 from platform.coupon_redemptions where tenant_id = p_tenant_id)
    or exists (select 1 from platform.orders where tenant_id = p_tenant_id)
  );
$function$;

revoke all on function platform.currency_locked(uuid) from public, anon;
grant execute on function platform.currency_locked(uuid) to authenticated, service_role;
