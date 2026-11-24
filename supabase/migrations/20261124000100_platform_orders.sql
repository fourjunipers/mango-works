-- Phase 3, stage 2a: orders: tables, RLS, customers, settings
-- (docs/phase-3-plan.md §3.1, §3.2, §3.8 row 2, §3.9, §3.10, §9.1).
--
-- Builds on 20261123000100_platform_unit_lock_rules. No earlier migration is
-- touched.
--
--  1. The functions re-created here are as main left them (guard).
--  2. Phase 2's bookings are cleared: every reservation, its allocation and
--     hold blocks, and every coupon redemption (S7, decision 24). THIS
--     DELETES ROWS. Local and staging only hold demo and test bookings. On
--     live the three counts must be 0 before this is pushed, or the push
--     stops (docs/PROGRESS.md).
--  3. booking_roles() gains the order actions.
--  4. customers, with an audit that never holds a contact.
--  5. orders, rentals, order_charges, order_lines, order_counters.
--  6. reservations.rental_id (nullable until migration 3).
--  7. move_unit() re-created: a split row keeps its rental (M2).
--  8. The shop's order settings: six staff permissions and the time step of
--     every date-and-time picker; staff_may().
--  9. save_customer() and save_staff_permissions().
--
-- Nobody signed in writes any of the six tables directly: the functions do
-- (two here, the order functions from migration 3 on).
--
-- Who is calling: everything created or re-created here reads the caller
-- through platform_private.app_uid() and app_role() (decision 43), never
-- auth.uid() or auth.role(). No column points at auth.users (root CLAUDE.md,
-- "Not tied to Supabase"): the "who" columns are plain ids.
--
-- Lock order: nothing here adds a lock class or a writer of more than one
-- lock. save_customer() takes one customer row (`for no key update`, so an
-- order's foreign key to it never waits); save_staff_permissions() takes the
-- shop's row. move_unit() takes what it took. The order rows' place in the
-- order (plan §4.2) starts with migration 3, which adds their first writer.

-- 1. The functions are as main left them -------------------------------------------------------

do $guard$
declare
  v_expected constant jsonb := jsonb_build_object(
    'platform.move_unit(uuid,uuid,uuid,uuid,integer,timestamp with time zone,jsonb)',
      'e443cea895955be67be169e601d9af97',
    'platform_private.booking_roles(text)', '51a20ff232361556194f28d3a7b0d45b'
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

-- 2. Phase 2's bookings are cleared ------------------------------------------------------------
-- A Phase 2 reservation has no order and no rental, and from migration 3 a
-- reservation must have one. So every reservation goes, with the allocation
-- and hold blocks that belong to it and every coupon use (a use names a
-- booking that no longer exists; a use given back keeps its row, and goes
-- too). Downtime blocks, coupons, products, units and prices are not
-- touched. Each deleted reservation and coupon use leaves its audit event,
-- as any delete does (a booking's blocks are not audited row by row).
--
-- The foreign keys set the order: blocks before the reservations they name.
-- That is the opposite of a booking's own order (reservations, then blocks),
-- and the `alter table` in 6 takes reservations whole anyway: a booking in
-- flight at that moment can cross this migration, and Postgres then breaks
-- one of the two with nothing written (a booking answers try_again; the
-- migration is sent again). Push it while nobody is booking.
--
-- The block between the two markers is run again by
-- apps/platform/tests/db/orders.test.ts, inside a transaction it rolls back.

-- clear:begin
do $clear$
declare
  v_reservations bigint;
  v_blocks bigint;
  v_redemptions bigint;
  v_kept_blocks bigint;
  v_kept_after bigint;
begin
  select count(*) into v_reservations from platform.reservations;
  select count(*) into v_blocks from platform.unit_blocks where reservation_id is not null;
  select count(*) into v_redemptions from platform.coupon_redemptions;
  select count(*) into v_kept_blocks from platform.unit_blocks where reservation_id is null;
  raise notice
    'platform_orders, before: % reservations, % allocation and hold blocks, % coupon redemptions (% other blocks stay)',
    v_reservations, v_blocks, v_redemptions, v_kept_blocks;

  delete from platform.unit_blocks where reservation_id is not null;
  delete from platform.coupon_redemptions;
  delete from platform.reservations;

  select count(*) into v_reservations from platform.reservations;
  select count(*) into v_blocks from platform.unit_blocks where reservation_id is not null;
  select count(*) into v_redemptions from platform.coupon_redemptions;
  select count(*) into v_kept_after from platform.unit_blocks where reservation_id is null;
  if v_reservations <> 0 or v_blocks <> 0 or v_redemptions <> 0 then
    raise exception 'platform_orders: % reservations, % blocks, % redemptions left',
      v_reservations, v_blocks, v_redemptions;
  end if;
  if v_kept_after <> v_kept_blocks then
    raise exception 'platform_orders: % other blocks before, % after',
      v_kept_blocks, v_kept_after;
  end if;
  raise notice
    'platform_orders, after: 0 reservations, 0 allocation and hold blocks, 0 coupon redemptions (% other blocks stay)',
    v_kept_after;
end;
$clear$;
-- clear:end

-- 3. Who may do what -----------------------------------------------------------------------------
-- As it stood (20261116000300), plus two order actions (plan §3.9):
--   'orders'          see and work with orders, rentals and customers;
--   'order_settings'  archive and unarchive; Settings › Orders; the staff
--                     permissions.
-- Lines, charges and payments are read like prices: pricing_roles('read').
-- apps/platform/lib/booking-permissions.ts is its copy. Grants as they were.

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
    when 'orders' then '{owner,manager,staff}'
    when 'order_settings' then '{owner,manager}'
    else '{}'
  end)::platform.platform_role[];
$$;

revoke all on function platform_private.booking_roles(text) from public, anon;
grant execute on function platform_private.booking_roles(text) to authenticated, service_role;

-- 4. customers -----------------------------------------------------------------------------------
-- The basic customer record (plan §3.1). Documents, the blacklist, merging
-- and retention are Phase 4. Completed rentals are worked out from orders
-- (stage 7), never stored here.
--
-- citext: a standard Postgres extension, on Supabase's list and on Neon's.

create extension if not exists citext with schema extensions;

create table platform.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  full_name text not null
    constraint customers_full_name_check
    check (full_name = btrim(full_name) and length(full_name) between 1 and 200),
  -- E.164 (+66812345678) when save_customer() could read it as one, else as
  -- typed. Free-form on purpose: any country.
  phone text
    constraint customers_phone_check
    check (phone = btrim(phone) and length(phone) between 1 and 40),
  email extensions.citext
    constraint customers_email_check
    check (length(email::text) <= 320 and email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  line_id text
    constraint customers_line_id_check
    check (line_id = btrim(line_id) and length(line_id) between 1 and 100),
  -- ISO 3166-1 alpha-2.
  nationality text
    constraint customers_nationality_check check (nationality ~ '^[A-Z]{2}$'),
  -- BCP 47 (en, th, zh-Hant, pt-BR).
  language text
    constraint customers_language_check
    check (language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$' and length(language) <= 35),
  notes text
    constraint customers_notes_check check (length(notes) between 1 and 4000),
  -- The renter's Moto Mangos account (3M). One customer per account in a shop.
  marketplace_account_id uuid,
  archived_at timestamptz,
  -- Who added them: a plain id (no key to the sign-in provider's tables).
  -- Empty for the service role.
  created_by uuid default platform_private.app_uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_tenant_id_id_key unique (tenant_id, id)
);

create unique index customers_marketplace_account_key
  on platform.customers (tenant_id, marketplace_account_id)
  where marketplace_account_id is not null;
create index customers_phone_idx on platform.customers (tenant_id, phone)
  where phone is not null;
create index customers_email_idx on platform.customers (tenant_id, email)
  where email is not null;

alter table platform.customers enable row level security;

grant select on platform.customers to authenticated;
grant select, insert, update, delete on platform.customers to service_role;
revoke truncate on platform.customers from public, anon, authenticated, service_role;

create policy "Owners, managers and staff read customers"
on platform.customers for select to authenticated
using (
  tenant_id = any (
    (select platform_private.my_tenant_ids(platform_private.booking_roles('orders')))::uuid[]
  )
);

create trigger customers_set_updated_at
before update on platform.customers
for each row execute function platform_private.set_updated_at();

-- A customer's audit: as audit_row() writes any row's, except that a phone
-- number, an email address and a LINE id are never copied into it. The
-- event says that one was set or changed ("changed"), never what it was or
-- is (plan §3.1; the owner's rule that personal data stays out of
-- snapshots).
create function platform_private.customers_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contacts constant text[] := array['phone', 'email', 'line_id'];
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_tenant uuid := (v_row ->> 'tenant_id')::uuid;
  v_before jsonb;
  v_after jsonb;
  v_key text;
begin
  -- The whole tenant is being deleted: its audit rows go with it.
  if not exists (select 1 from platform.tenants where id = v_tenant) then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, n.value), jsonb_object_agg(n.key, v_old -> n.key)
    into v_after, v_before
    from jsonb_each(v_new) n
    where n.key <> 'updated_at' and n.value is distinct from v_old -> n.key;
    if v_after is null then
      return null;
    end if;
  else
    v_before := v_old;
    v_after := v_new;
  end if;

  -- A contact that holds a value is written as "changed"; an empty one stays
  -- empty, so "added", "changed" and "removed" can still be told apart.
  foreach v_key in array v_contacts loop
    if jsonb_typeof(v_before -> v_key) is distinct from 'null' and v_before ? v_key then
      v_before := jsonb_set(v_before, array[v_key], '"changed"'::jsonb);
    end if;
    if jsonb_typeof(v_after -> v_key) is distinct from 'null' and v_after ? v_key then
      v_after := jsonb_set(v_after, array[v_key], '"changed"'::jsonb);
    end if;
  end loop;

  insert into platform.audit_events (tenant_id, entity, entity_id, action, actor, before, after)
  values (
    v_tenant, tg_table_name, v_row ->> 'id', lower(tg_op),
    (select platform_private.app_uid()), v_before, v_after);
  return null;
end;
$function$;
revoke all on function platform_private.customers_audit() from public, anon;

create trigger customers_audit
after insert or update or delete on platform.customers
for each row execute function platform_private.customers_audit();

-- 5. orders, rentals, charges, lines, the counter -----------------------------------------------
-- The shape of plan §2.2 and §3.2. Their writers arrive with migration 3
-- (reserve_core, create_order): until then the tables are empty.

-- One booking. `status` is the intent (plan §2.3); reserved, picked up,
-- returned and mixed are worked out from its rentals' reservations.
create table platform.orders (
  -- reservations.booking_id of its reservations.
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  -- Per shop, from order_counters, gaps allowed (decision 11). Written last
  -- in the transaction that makes the order (plan §4.2), so empty for a
  -- moment; migration 3 adds the check that no order is committed without one.
  number bigint
    constraint orders_number_check check (number >= 1),
  -- What the customer quotes: 6 characters, no 0, O, 1 or I.
  code text not null
    constraint orders_code_check check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  customer_id uuid,
  status text not null
    constraint orders_status_check
    check (status in ('new', 'draft', 'requested', 'booked', 'archived', 'canceled')),
  -- One hold expiry per order (M5).
  hold_expires_at timestamptz,
  channel text not null
    constraint orders_channel_check
    check (channel in ('walk_in', 'phone', 'booking_page', 'marketplace', 'api')),
  mode text not null
    constraint orders_mode_check
    check (mode in ('staff', 'instant', 'request', 'now')),
  -- How the order reads to Moto Mangos (docs/INTEGRATION.md §5). Their
  -- values are fixed by the stages that first write them (cancel_order in
  -- migration 3; requests at 3M).
  request_status text,
  cancelled_by text,
  cancel_reason text,
  no_show boolean not null default false,
  -- The shop's currency. No cascade: a shop with an order can't change its
  -- currency (S8).
  currency text not null,
  -- A repeat of the call that made the order answers the first result (S6).
  idempotency_key uuid,
  notes text
    constraint orders_notes_check check (length(notes) between 1 and 4000),
  -- Who made it: a plain id. Empty for the service role.
  created_by uuid default platform_private.app_uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  canceled_at timestamptz,
  constraint orders_tenant_id_id_key unique (tenant_id, id),
  constraint orders_number_key unique (tenant_id, number),
  constraint orders_code_key unique (tenant_id, code),
  constraint orders_hold_check check (status <> 'new' or hold_expires_at is not null),
  constraint orders_customer_fkey
    foreign key (tenant_id, customer_id) references platform.customers (tenant_id, id),
  constraint orders_currency_fkey
    foreign key (tenant_id, currency) references platform.tenants (id, currency)
);

create unique index orders_idempotency_key
  on platform.orders (tenant_id, idempotency_key) where idempotency_key is not null;
create index orders_status_idx on platform.orders (tenant_id, status);
create index orders_customer_idx on platform.orders (tenant_id, customer_id)
  where customer_id is not null;

-- Exactly one vehicle, or one gear or service line with a quantity. Its
-- stock is the reservations that carry its id; its stage (held, reserved,
-- out, returned) is theirs. Product and place are "as booked": while it has
-- live reservations, where it really is comes from them (move_unit() can
-- change that).
create table platform.rentals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  order_id uuid not null,
  -- An extra booked with a vehicle: its vehicle's rental.
  parent_rental_id uuid,
  product_id uuid not null,
  product_type text not null
    constraint rentals_product_type_check
    check (product_type in ('vehicle', 'gear', 'service')),
  location_id uuid not null,
  quantity integer not null
    constraint rentals_quantity_check check (quantity between 1 and 1000),
  -- As booked; an extension moves ends_at.
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- The intent, as an order's status is.
  status text not null
    constraint rentals_status_check check (status in ('draft', 'booked', 'canceled')),
  picked_up_at timestamptz,
  picked_up_by uuid,
  -- The recorded return time (decision 7). Each edit of it is an audit event.
  returned_at timestamptz,
  returned_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rentals_tenant_id_id_key unique (tenant_id, id),
  -- For the keys of lines: a line's rental is one of its own order's.
  constraint rentals_tenant_id_order_id_id_key unique (tenant_id, order_id, id),
  constraint rentals_times_check check (ends_at > starts_at),
  -- A vehicle rental is one vehicle (decision 2).
  constraint rentals_vehicle_quantity_check check (product_type <> 'vehicle' or quantity = 1),
  constraint rentals_parent_check check (parent_rental_id is null or product_type <> 'vehicle'),
  constraint rentals_order_fkey
    foreign key (tenant_id, order_id) references platform.orders (tenant_id, id),
  -- The parent is a rental of the same order.
  constraint rentals_parent_fkey
    foreign key (tenant_id, order_id, parent_rental_id)
    references platform.rentals (tenant_id, order_id, id),
  constraint rentals_product_fkey
    foreign key (tenant_id, product_id, product_type)
    references platform.products (tenant_id, id, type),
  constraint rentals_location_fkey
    foreign key (tenant_id, location_id) references platform.locations (tenant_id, id)
);

create index rentals_parent_idx on platform.rentals (parent_rental_id)
  where parent_rental_id is not null;
create index rentals_product_idx on platform.rentals (tenant_id, product_id, location_id);

-- One quote() call: stored once, then only ever voided. A correction is a
-- new charge ('difference'). "Settled" is worked out from the payments
-- allocated to it (migration 4), never stored. A total may be negative: a
-- difference that is a credit.
create table platform.order_charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  order_id uuid not null,
  -- cancellation_fee is allowed now and written from Phase 7 (decision 41).
  kind text not null
    constraint order_charges_kind_check
    check (kind in (
      'booking', 'period', 'extension', 'addition', 'swap', 'early_return',
      'late_return', 'difference', 'cancellation_fee')),
  -- As orders.currency: no cascade.
  currency text not null,
  priced_at timestamptz not null,
  due_at timestamptz,
  -- Minor units.
  total bigint not null,
  tax_total bigint not null,
  deposit bigint not null default 0
    constraint order_charges_deposit_check check (deposit >= 0),
  -- Per tax rate: what the charge comes to in it.
  rate_groups jsonb not null default '[]'::jsonb
    constraint order_charges_rate_groups_check check (jsonb_typeof(rate_groups) = 'array'),
  -- The quote as it was made.
  snapshot jsonb not null
    constraint order_charges_snapshot_check check (jsonb_typeof(snapshot) = 'object'),
  status text not null default 'open'
    constraint order_charges_status_check check (status in ('open', 'void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_charges_tenant_id_id_key unique (tenant_id, id),
  -- For the keys of lines: a line's charge is one of its own order's.
  constraint order_charges_tenant_id_order_id_id_key unique (tenant_id, order_id, id),
  constraint order_charges_order_fkey
    foreign key (tenant_id, order_id) references platform.orders (tenant_id, id),
  constraint order_charges_currency_fkey
    foreign key (tenant_id, currency) references platform.tenants (id, currency)
);

create index order_charges_due_idx on platform.order_charges (tenant_id, due_at)
  where due_at is not null and status = 'open';

-- A billed period of a rental, an extra's part of it, an item for sale, a
-- fee, a credit. What was charged is a snapshot: the product's name, tax
-- profile and prices as they were, never read again from their tables (so
-- tax_profile_id is a plain id). No function updates an amount.
create table platform.order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id) on delete cascade,
  order_id uuid not null,
  charge_id uuid not null,
  -- Empty for an item for sale, a fee, a credit.
  rental_id uuid,
  -- marketplace_fee is negative and written at 3M (decision 38).
  kind text not null
    constraint order_lines_kind_check
    check (kind in (
      'period', 'extra', 'sale_item', 'fee', 'credit', 'manual', 'marketplace_fee')),
  product_id uuid,
  product_type text
    constraint order_lines_product_type_check
    check (product_type in ('vehicle', 'gear', 'service', 'sale_item')),
  period_start timestamptz,
  period_end timestamptz,
  -- When a swap or an early return closed the period; period_end stays.
  closed_at timestamptz,
  quantity integer not null default 1
    constraint order_lines_quantity_check check (quantity between 1 and 100000),
  included_quantity integer
    constraint order_lines_included_quantity_check check (included_quantity >= 0),
  charged_quantity integer
    constraint order_lines_charged_quantity_check check (charged_quantity >= 0),
  -- Minor units, all of them.
  list_price bigint,
  season_total bigint,
  discount_total bigint,
  amount bigint not null,
  tax_rate_bp integer
    constraint order_lines_tax_rate_bp_check check (tax_rate_bp between 0 and 10000),
  tax_profile_id uuid,
  tax_profile_name text,
  tax_inclusive boolean,
  tax_amount bigint not null default 0,
  deposit bigint not null default 0
    constraint order_lines_deposit_check check (deposit >= 0),
  currency text not null,
  snapshot jsonb
    constraint order_lines_snapshot_check check (jsonb_typeof(snapshot) = 'object'),
  -- A price changed by hand: always with a reason, and who (a plain id).
  override_reason text,
  override_by uuid,
  note text,
  -- Where the line stands in its order. Lines are never re-sorted.
  position integer not null
    constraint order_lines_position_check check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_lines_tenant_id_id_key unique (tenant_id, id),
  constraint order_lines_product_check check ((product_id is null) = (product_type is null)),
  constraint order_lines_period_check check (period_end > period_start),
  constraint order_lines_override_check
    check (override_by is null or coalesce(length(btrim(override_reason)), 0) > 0),
  constraint order_lines_order_fkey
    foreign key (tenant_id, order_id) references platform.orders (tenant_id, id),
  constraint order_lines_charge_fkey
    foreign key (tenant_id, order_id, charge_id)
    references platform.order_charges (tenant_id, order_id, id),
  constraint order_lines_rental_fkey
    foreign key (tenant_id, order_id, rental_id)
    references platform.rentals (tenant_id, order_id, id),
  constraint order_lines_product_fkey
    foreign key (tenant_id, product_id, product_type)
    references platform.products (tenant_id, id, type),
  constraint order_lines_currency_fkey
    foreign key (tenant_id, currency) references platform.tenants (id, currency)
);

create index order_lines_order_idx on platform.order_lines (tenant_id, order_id, position);
create index order_lines_charge_idx on platform.order_lines (charge_id);
create index order_lines_rental_idx on platform.order_lines (rental_id)
  where rental_id is not null;

-- The next order number of a shop. One row per shop, made with the shop;
-- taken `for update` last of all by the transaction that makes an order
-- (plan §4.2, class 3.10). Not audited: it changes with every order, and
-- the order's own event says its number.
create table platform.order_counters (
  tenant_id uuid primary key references platform.tenants (id) on delete cascade,
  next_number bigint not null default 1
    constraint order_counters_next_number_check check (next_number >= 1)
);

insert into platform.order_counters (tenant_id)
select t.id from platform.tenants t;

create function platform_private.tenants_add_order_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into platform.order_counters (tenant_id) values (new.id);
  return null;
end;
$function$;
revoke all on function platform_private.tenants_add_order_counter() from public, anon;

create trigger tenants_add_order_counter
after insert on platform.tenants
for each row execute function platform_private.tenants_add_order_counter();

alter table platform.orders enable row level security;
alter table platform.rentals enable row level security;
alter table platform.order_charges enable row level security;
alter table platform.order_lines enable row level security;
alter table platform.order_counters enable row level security;

-- Read by the roles of plan §3.9; written by nobody signed in. The counter
-- is nobody's to read: no grant at all, and a policy that says so.
grant select on platform.orders to authenticated;
grant select on platform.rentals to authenticated;
grant select on platform.order_charges to authenticated;
grant select on platform.order_lines to authenticated;

grant select, insert, update, delete on platform.orders to service_role;
grant select, insert, update, delete on platform.rentals to service_role;
grant select, insert, update, delete on platform.order_charges to service_role;
grant select, insert, update, delete on platform.order_lines to service_role;
grant select, insert, update, delete on platform.order_counters to service_role;

revoke truncate on platform.orders, platform.rentals, platform.order_charges,
  platform.order_lines, platform.order_counters
  from public, anon, authenticated, service_role;

create policy "Owners, managers and staff read orders"
on platform.orders for select to authenticated
using (
  tenant_id = any (
    (select platform_private.my_tenant_ids(platform_private.booking_roles('orders')))::uuid[]
  )
);

create policy "Owners, managers and staff read rentals"
on platform.rentals for select to authenticated
using (
  tenant_id = any (
    (select platform_private.my_tenant_ids(platform_private.booking_roles('orders')))::uuid[]
  )
);

create policy "Owners, managers and staff read order charges"
on platform.order_charges for select to authenticated
using (
  tenant_id = any (
    (select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]
  )
);

create policy "Owners, managers and staff read order lines"
on platform.order_lines for select to authenticated
using (
  tenant_id = any (
    (select platform_private.my_tenant_ids(platform_private.pricing_roles('read')))::uuid[]
  )
);

create policy "No signed-in user reads order counters"
on platform.order_counters for select to authenticated
using (false);

create trigger orders_set_updated_at
before update on platform.orders
for each row execute function platform_private.set_updated_at();
create trigger rentals_set_updated_at
before update on platform.rentals
for each row execute function platform_private.set_updated_at();
create trigger order_charges_set_updated_at
before update on platform.order_charges
for each row execute function platform_private.set_updated_at();
create trigger order_lines_set_updated_at
before update on platform.order_lines
for each row execute function platform_private.set_updated_at();

-- Every change is recorded with who made it. None of the four holds a
-- customer's contacts.
create trigger orders_audit
after insert or update or delete on platform.orders
for each row execute function platform_private.audit_row();
create trigger rentals_audit
after insert or update or delete on platform.rentals
for each row execute function platform_private.audit_row();
create trigger order_charges_audit
after insert or update or delete on platform.order_charges
for each row execute function platform_private.audit_row();
create trigger order_lines_audit
after insert or update or delete on platform.order_lines
for each row execute function platform_private.audit_row();

-- 6. reservations.rental_id ----------------------------------------------------------------------
-- A rental's stock is the reservations that carry its id; those in held,
-- reserved or out are "live" (M2). Empty for a reservation made by Phase
-- 2's reserve(), which still exists until migration 3: that migration
-- clears such rows again and then requires the column.

alter table platform.reservations
  add column rental_id uuid,
  add constraint reservations_rental_fkey
    foreign key (tenant_id, rental_id) references platform.rentals (tenant_id, id);

create index reservations_rental_idx on platform.reservations (rental_id)
  where rental_id is not null;

-- 7. move_unit() ---------------------------------------------------------------------------------
-- Stage 1's body (20261123000100), with one change: when a row for several
-- units is split, the moved unit's new row carries the same rental_id (M2),
-- so the rental's live reservations are still all of its stock. Everything
-- else is as it was, the marker rules included: 'started' straight after
-- the one_move_per_transaction check, the unit's id around its update,
-- 'done' after it, and set again in the deadlock handler.

create or replace function platform.move_unit(
  p_tenant_id uuid,
  p_unit_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_expected_bookings integer default null,
  p_expected_updated_at timestamp with time zone default null,
  p_details jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '6s'
as $function$
declare
  v_key text;
  v_unit platform.units%rowtype;
  v_from_product uuid;
  v_from_location uuid;
  v_product_ids uuid[];
  v_location_ids uuid[];
  v_r platform.reservations%rowtype;
  v_new_id uuid;
  v_moved uuid[] := '{}';
  v_booking record;
  v_bookings integer;
  v_updated_at timestamptz;
begin
  if (select platform_private.app_role()) is distinct from 'service_role'
    and not platform_private.has_role(
      p_tenant_id, '{owner,manager}'::platform.platform_role[])
  then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  -- One call per transaction, whatever the first one answered: the marker
  -- is 'started', then the unit being moved, then 'done'.
  if nullif(current_setting('platform.moving_unit', true), '') is not null then
    raise exception 'one_move_per_transaction' using errcode = 'P0001';
  end if;
  perform set_config('platform.moving_unit', 'started', true);
  if p_unit_id is null or p_product_id is null or p_location_id is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_details is not null then
    if jsonb_typeof(p_details) <> 'object' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(p_details) loop
      if v_key not in (
        'plate', 'plate_pending', 'frame_number', 'engine_number', 'colour',
        'model_year', 'notes', 'current_odometer_km'
      ) then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- Not found, or another shop's: the same answer.
  select * into v_unit
  from platform.units u
  where u.id = p_unit_id and u.tenant_id = p_tenant_id;
  if not found then
    raise exception 'unit_not_found' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from platform.products p
    where p.id = p_product_id and p.tenant_id = p_tenant_id and p.retired_at is null
  ) then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;
  -- A scooter can't become a helmet.
  if not exists (
    select 1 from platform.products p
    where p.id = p_product_id and p.type = v_unit.product_type
  ) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from platform.locations l
    where l.id = p_location_id and l.tenant_id = p_tenant_id
  ) then
    raise exception 'location_not_found' using errcode = 'P0001';
  end if;

  -- 1. Product-and-location locks: where it is, where it goes, and whatever
  -- its bookings name, sorted once.
  select array_agg(x.product_id), array_agg(x.location_id)
  into v_product_ids, v_location_ids
  from (
    select v_unit.product_id as product_id, v_unit.location_id as location_id
    union
    select p_product_id, p_location_id
    union
    select r.product_id, r.location_id
    from platform.unit_blocks b
    join platform.reservations r on r.id = b.reservation_id
    where b.unit_id = p_unit_id
  ) x;
  perform platform_private.lock_products_stock(v_product_ids, v_location_ids);

  -- 2. The unit's lock.
  perform platform_private.lock_units(array[p_unit_id]);

  -- 3. Rows: the unit, without waiting, then the products in id order.
  begin
    select * into v_unit
    from platform.units u
    where u.id = p_unit_id
    for no key update nowait;
  exception
    when lock_not_available then
      return jsonb_build_object('ok', false, 'reason', 'try_again');
  end;
  if v_unit.id is null or not exists (
    select 1 from platform.units u where u.id = p_unit_id
  ) then
    raise exception 'unit_not_found' using errcode = 'P0001';
  end if;
  if p_expected_updated_at is not null and v_unit.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;
  v_from_product := v_unit.product_id;
  v_from_location := v_unit.location_id;

  -- Both products at once, in id order, at the strongest strength this
  -- transaction needs: the unit's triggers below ask for nothing stronger.
  perform 1 from platform.products p
  where p.id in (v_from_product, p_product_id)
  order by p.id
  for no key update;
  if not exists (
    select 1 from platform.products p
    where p.id = p_product_id and p.tenant_id = p_tenant_id and p.retired_at is null
  ) then
    raise exception 'product_not_found' using errcode = 'P0001';
  end if;

  -- Under the locks. The unit was somewhere else when the locks were chosen,
  -- or one of its bookings names a product that was not locked: start again.
  if exists (
      select 1
      from (
        select v_from_product as product_id, v_from_location as location_id
        union
        select r.product_id, r.location_id
        from platform.unit_blocks b
        join platform.reservations r on r.id = b.reservation_id
        where b.unit_id = p_unit_id
      ) needed
      where not exists (
        select 1 from unnest(v_product_ids, v_location_ids) t(product_id, location_id)
        where t.product_id = needed.product_id and t.location_id = needed.location_id
      )
    )
  then
    return jsonb_build_object('ok', false, 'reason', 'try_again');
  end if;

  -- The bookings the person was warned about: the ones that hold this unit
  -- from now on.
  select count(distinct r.booking_id) into v_bookings
  from platform.reservations r
  where r.state in ('held', 'reserved', 'out')
    and exists (
      select 1 from platform.unit_blocks b
      where b.reservation_id = r.id and b.unit_id = p_unit_id
        and (upper_inf(b.period) or upper(b.period) > now())
    );
  if p_expected_bookings is not null and v_bookings <> p_expected_bookings then
    return jsonb_build_object(
      'ok', false, 'reason', 'bookings_changed', 'bookings', v_bookings);
  end if;

  -- Where it already is: no booking moves, and with no details to save
  -- there is nothing to write.
  if v_from_product = p_product_id and v_from_location = p_location_id then
    v_bookings := 0;
    if p_details is null or p_details = '{}'::jsonb then
      return jsonb_build_object(
        'ok', true, 'unit_id', p_unit_id, 'bookings', 0,
        'reservation_ids', '[]'::jsonb, 'updated_at', v_unit.updated_at);
    end if;
  end if;

  -- The reservations follow, in id order.
  for v_r in
    select r.*
    from platform.reservations r
    where r.state in ('held', 'reserved', 'out')
      and (r.product_id <> p_product_id or r.location_id <> p_location_id)
      and exists (
        select 1 from platform.unit_blocks b
        where b.reservation_id = r.id and b.unit_id = p_unit_id
          and (upper_inf(b.period) or upper(b.period) > now())
      )
    order by r.id
    for update of r
  loop
    if v_r.quantity = 1 then
      update platform.reservations r
      set product_id = p_product_id, location_id = p_location_id
      where r.id = v_r.id;
      v_new_id := v_r.id;
    else
      -- A row for several units: this unit's part becomes a row of its own,
      -- in the same booking and the same rental.
      insert into platform.reservations (
        tenant_id, booking_id, parent_id, product_id, product_type, location_id,
        starts_at, ends_at, block_period, quantity, shortage, channel, mode, state,
        hold_expires_at, created_by, rental_id
      )
      values (
        v_r.tenant_id, v_r.booking_id, v_r.parent_id, p_product_id, v_r.product_type,
        p_location_id, v_r.starts_at, v_r.ends_at, v_r.block_period, 1, 0,
        v_r.channel, v_r.mode, v_r.state, v_r.hold_expires_at, v_r.created_by,
        v_r.rental_id
      )
      returning id into v_new_id;
      update platform.unit_blocks b
      set reservation_id = v_new_id
      where b.reservation_id = v_r.id and b.unit_id = p_unit_id;
      update platform.reservations r
      set quantity = r.quantity - 1
      where r.id = v_r.id;
    end if;
    v_moved := v_moved || v_new_id;
  end loop;

  -- The unit itself, with the rest of the form in the same statement. Its
  -- guard finds every booking already where it is going, and lets the
  -- product change through for this unit only, between the two lines that
  -- set the marker. Anything this refuses (a plate another vehicle has,
  -- say) undoes the whole call.
  perform set_config('platform.moving_unit', p_unit_id::text, true);
  update platform.units u
  set product_id = p_product_id,
    location_id = p_location_id,
    plate = case when p_details ? 'plate' then p_details ->> 'plate' else u.plate end,
    plate_pending = case when p_details ? 'plate_pending'
      then (p_details ->> 'plate_pending')::boolean else u.plate_pending end,
    frame_number = case when p_details ? 'frame_number'
      then p_details ->> 'frame_number' else u.frame_number end,
    engine_number = case when p_details ? 'engine_number'
      then p_details ->> 'engine_number' else u.engine_number end,
    colour = case when p_details ? 'colour' then p_details ->> 'colour' else u.colour end,
    model_year = case when p_details ? 'model_year'
      then (p_details ->> 'model_year')::integer else u.model_year end,
    notes = case when p_details ? 'notes' then p_details ->> 'notes' else u.notes end,
    current_odometer_km = case when p_details ? 'current_odometer_km'
      then (p_details ->> 'current_odometer_km')::numeric else u.current_odometer_km end
  where u.id = p_unit_id
  returning u.updated_at into v_updated_at;
  perform set_config('platform.moving_unit', 'done', true);

  -- One event per booking.
  for v_booking in
    select r.booking_id, array_agg(r.id order by r.id) as ids
    from platform.reservations r
    where r.id = any (v_moved)
    group by r.booking_id
    order by r.booking_id
  loop
    perform platform_private.audit(
      p_tenant_id, 'bookings', v_booking.booking_id::text, 'move', null,
      jsonb_build_object(
        'unit_id', p_unit_id,
        'reservation_ids', to_jsonb(v_booking.ids),
        'from', jsonb_build_object(
          'product_id', v_from_product, 'location_id', v_from_location),
        'to', jsonb_build_object(
          'product_id', p_product_id, 'location_id', p_location_id)));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'unit_id', p_unit_id,
    'bookings', v_bookings,
    'reservation_ids', to_jsonb(v_moved),
    'updated_at', v_updated_at);
exception
  when deadlock_detected then
    -- Everything this call did is undone, the marker with it: set it again,
    -- so that this answer too closes the transaction to a second call.
    perform set_config('platform.moving_unit', 'done', true);
    return jsonb_build_object('ok', false, 'reason', 'try_again');
end;
$function$;

-- 8. The shop's order settings -------------------------------------------------------------------
-- Six staff permissions (decision 6, plan §3.10) and the time step of every
-- date-and-time picker (plan §9.1). platform.tenants has column grants, so
-- every member reads them and nobody signed in writes them directly:
-- save_staff_permissions() below writes the six; the time step is changed
-- in Settings › Orders (stage 10), by the function that screen gets.

alter table platform.tenants
  add column staff_can_change_price boolean not null default true,
  add column staff_can_waive_late_charge boolean not null default true,
  add column staff_can_edit_return_time boolean not null default true,
  add column staff_can_revert boolean not null default false,
  add column staff_can_refund boolean not null default false,
  add column staff_can_write_off_credit boolean not null default false,
  -- 1, 5, 10, 15 or 30 minutes, or 1 hour.
  add column time_step_minutes integer not null default 15
    constraint tenants_time_step_minutes_check
    check (time_step_minutes in (1, 5, 10, 15, 30, 60));

-- True for an owner or a manager of the shop, always; for staff when the
-- shop's setting is on; false for anyone else. Every order function that
-- plan §3.9 marks "Setting" asks it, inside the database. p_permission is
-- the setting's name without "staff_can_"; an unknown one is an error, not
-- a "no".
create function platform_private.staff_may(p_tenant_id uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_role platform.platform_role;
  v_on boolean;
begin
  if p_permission is null or p_permission not in (
    'change_price', 'waive_late_charge', 'edit_return_time', 'revert', 'refund',
    'write_off_credit'
  ) then
    raise exception 'invalid_permission' using errcode = '22023';
  end if;
  if (select platform_private.app_uid()) is null then
    return false;
  end if;
  v_role := platform_private.my_role(p_tenant_id);
  if v_role in ('owner', 'manager') then
    return true;
  end if;
  if v_role is distinct from 'staff' then
    return false;
  end if;
  select case p_permission
      when 'change_price' then t.staff_can_change_price
      when 'waive_late_charge' then t.staff_can_waive_late_charge
      when 'edit_return_time' then t.staff_can_edit_return_time
      when 'revert' then t.staff_can_revert
      when 'refund' then t.staff_can_refund
      when 'write_off_credit' then t.staff_can_write_off_credit
    end
  into v_on
  from platform.tenants t
  where t.id = p_tenant_id;
  return coalesce(v_on, false);
end;
$function$;
revoke all on function platform_private.staff_may(uuid, text) from public, anon;
grant execute on function platform_private.staff_may(uuid, text) to authenticated;

-- 9. save_customer() and save_staff_permissions() ------------------------------------------------

-- p_customer: {
--   "id":          an existing customer's, to change it; absent to add one
--   "full_name":   1..200 characters (needed for a new customer)
--   "phone":       free-form, 40 at most; stored as E.164 when it reads as
--                  an international number ("+66 81 234 5678", "0066…")
--   "email", "line_id", "notes"
--   "nationality": two letters (ISO 3166-1)
--   "language":    BCP 47
--   "archived":    true | false
--   "expected_updated_at": the form's copy; an older one is answered stale
-- }
-- Only what is named changes; null or "" clears a field (never the name).
-- Owners, managers and staff of the shop (role_not_allowed otherwise).
-- Another shop's customer is answered exactly like one that does not exist
-- (customer_not_found). The Moto Mangos account is never set here.
--
-- One row, `for no key update`: an order's foreign key to the customer takes
-- it `for key share`, which this does not block and does not wait for.
create function platform.save_customer(p_tenant_id uuid, p_customer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '6s'
as $function$
declare
  v_key text;
  v_text text;
  v_squeezed text;
  v_id uuid;
  v_row platform.customers%rowtype;
  v_full_name text;
  v_phone text;
  v_email text;
  v_line_id text;
  v_nationality text;
  v_language text;
  v_notes text;
  v_created boolean := false;
begin
  if not platform_private.has_role(p_tenant_id, platform_private.booking_roles('orders')) then
    raise exception 'role_not_allowed' using errcode = '42501';
  end if;
  if p_customer is null or jsonb_typeof(p_customer) <> 'object' then
    raise exception 'invalid_customer' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_customer) loop
    if v_key not in (
      'id', 'full_name', 'phone', 'email', 'line_id', 'nationality', 'language',
      'notes', 'archived', 'expected_updated_at'
    ) then
      raise exception 'invalid_customer' using errcode = '22023';
    end if;
    if v_key = 'archived' then
      if jsonb_typeof(p_customer -> v_key) <> 'boolean' then
        raise exception 'invalid_customer' using errcode = '22023';
      end if;
    elsif v_key in ('id', 'expected_updated_at') then
      if jsonb_typeof(p_customer -> v_key) <> 'string' then
        raise exception 'invalid_customer' using errcode = '22023';
      end if;
    elsif jsonb_typeof(p_customer -> v_key) not in ('string', 'null') then
      raise exception 'invalid_customer' using errcode = '22023';
    end if;
  end loop;

  if p_customer ? 'id' then
    if p_customer ->> 'id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'invalid_customer' using errcode = '22023';
    end if;
    v_id := (p_customer ->> 'id')::uuid;
  end if;

  -- Each field as it will be stored.
  v_full_name := nullif(btrim(p_customer ->> 'full_name'), '');
  if (p_customer ? 'full_name' or v_id is null)
    and (v_full_name is null or length(v_full_name) > 200)
  then
    raise exception 'invalid_customer' using errcode = '22023';
  end if;

  v_text := nullif(btrim(p_customer ->> 'phone'), '');
  if v_text is not null then
    -- Spaces, brackets, dots and dashes are how people write a number.
    v_squeezed := regexp_replace(v_text, '[[:space:]().-]', '', 'g');
    if v_squeezed ~ '^00[1-9][0-9]{6,14}$' then
      v_squeezed := '+' || substr(v_squeezed, 3);
    end if;
    if v_squeezed ~ '^\+[1-9][0-9]{6,14}$' then
      v_phone := v_squeezed;
    elsif length(v_text) <= 40 then
      v_phone := v_text;
    else
      raise exception 'invalid_customer' using errcode = '22023';
    end if;
  end if;

  v_email := nullif(btrim(p_customer ->> 'email'), '');
  if v_email is not null and (
    length(v_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ) then
    raise exception 'invalid_customer' using errcode = '22023';
  end if;

  v_line_id := nullif(btrim(p_customer ->> 'line_id'), '');
  if length(v_line_id) > 100 then
    raise exception 'invalid_customer' using errcode = '22023';
  end if;

  v_nationality := upper(nullif(btrim(p_customer ->> 'nationality'), ''));
  if v_nationality is not null and v_nationality !~ '^[A-Z]{2}$' then
    raise exception 'invalid_customer' using errcode = '22023';
  end if;

  v_language := nullif(btrim(p_customer ->> 'language'), '');
  if v_language is not null and (
    length(v_language) > 35 or v_language !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$'
  ) then
    raise exception 'invalid_customer' using errcode = '22023';
  end if;

  v_notes := nullif(p_customer ->> 'notes', '');
  if length(v_notes) > 4000 then
    raise exception 'invalid_customer' using errcode = '22023';
  end if;

  if v_id is null then
    insert into platform.customers (
      tenant_id, full_name, phone, email, line_id, nationality, language, notes,
      archived_at
    )
    values (
      p_tenant_id, v_full_name, v_phone, v_email, v_line_id, v_nationality, v_language,
      v_notes,
      case when (p_customer ->> 'archived')::boolean then now() end
    )
    returning * into v_row;
    v_created := true;
  else
    -- Not found, or another shop's: the same answer.
    select * into v_row
    from platform.customers c
    where c.id = v_id and c.tenant_id = p_tenant_id
    for no key update;
    if not found then
      raise exception 'customer_not_found' using errcode = 'P0001';
    end if;
    if p_customer ? 'expected_updated_at'
      and v_row.updated_at <> (p_customer ->> 'expected_updated_at')::timestamptz
    then
      return jsonb_build_object('ok', false, 'reason', 'stale');
    end if;
    update platform.customers c
    set full_name = case when p_customer ? 'full_name' then v_full_name else c.full_name end,
      phone = case when p_customer ? 'phone' then v_phone else c.phone end,
      email = case when p_customer ? 'email' then v_email::extensions.citext else c.email end,
      line_id = case when p_customer ? 'line_id' then v_line_id else c.line_id end,
      nationality = case when p_customer ? 'nationality' then v_nationality else c.nationality end,
      language = case when p_customer ? 'language' then v_language else c.language end,
      notes = case when p_customer ? 'notes' then v_notes else c.notes end,
      archived_at = case
        when not (p_customer ? 'archived') then c.archived_at
        when (p_customer ->> 'archived')::boolean then coalesce(c.archived_at, now())
        else null
      end
    where c.id = v_id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_row.id, 'created', v_created, 'updated_at', v_row.updated_at);
end;
$function$;
revoke all on function platform.save_customer(uuid, jsonb) from public, anon, service_role;
grant execute on function platform.save_customer(uuid, jsonb) to authenticated;

-- p_permissions: any of the six settings by name, each true or false:
--   { "staff_can_change_price": true, "staff_can_refund": false, … }
-- Only what is named changes. Owners and managers of the shop; anyone else,
-- another shop's owner included, is answered only_owner_or_manager. The
-- shop's row is audited by its own trigger: each change is an event with
-- who made it, and a save that changes nothing writes none.
create function platform.save_staff_permissions(p_tenant_id uuid, p_permissions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '6s'
as $function$
declare
  v_key text;
  v_saved jsonb;
begin
  if not platform_private.has_role(
    p_tenant_id, platform_private.booking_roles('order_settings'))
  then
    raise exception 'only_owner_or_manager' using errcode = '42501';
  end if;
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
    raise exception 'invalid_permissions' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_permissions) loop
    if v_key not in (
      'staff_can_change_price', 'staff_can_waive_late_charge',
      'staff_can_edit_return_time', 'staff_can_revert', 'staff_can_refund',
      'staff_can_write_off_credit'
    ) or jsonb_typeof(p_permissions -> v_key) <> 'boolean' then
      raise exception 'invalid_permissions' using errcode = '22023';
    end if;
  end loop;

  update platform.tenants t
  set staff_can_change_price = coalesce(
        (p_permissions ->> 'staff_can_change_price')::boolean, t.staff_can_change_price),
      staff_can_waive_late_charge = coalesce(
        (p_permissions ->> 'staff_can_waive_late_charge')::boolean,
        t.staff_can_waive_late_charge),
      staff_can_edit_return_time = coalesce(
        (p_permissions ->> 'staff_can_edit_return_time')::boolean,
        t.staff_can_edit_return_time),
      staff_can_revert = coalesce(
        (p_permissions ->> 'staff_can_revert')::boolean, t.staff_can_revert),
      staff_can_refund = coalesce(
        (p_permissions ->> 'staff_can_refund')::boolean, t.staff_can_refund),
      staff_can_write_off_credit = coalesce(
        (p_permissions ->> 'staff_can_write_off_credit')::boolean,
        t.staff_can_write_off_credit)
  where t.id = p_tenant_id
  returning jsonb_build_object(
    'staff_can_change_price', t.staff_can_change_price,
    'staff_can_waive_late_charge', t.staff_can_waive_late_charge,
    'staff_can_edit_return_time', t.staff_can_edit_return_time,
    'staff_can_revert', t.staff_can_revert,
    'staff_can_refund', t.staff_can_refund,
    'staff_can_write_off_credit', t.staff_can_write_off_credit)
  into v_saved;

  return jsonb_build_object('ok', true, 'permissions', v_saved);
end;
$function$;
revoke all on function platform.save_staff_permissions(uuid, jsonb)
  from public, anon, service_role;
grant execute on function platform.save_staff_permissions(uuid, jsonb) to authenticated;
