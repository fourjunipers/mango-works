-- Security audit of 19 Nov 2026: the marketplace's part (public schema).
--
-- Touches the public schema only, and nothing the platform migration beside
-- it (20261120000200) needs, so it can go to the live database by itself.
-- No earlier migration is touched. No row is changed or deleted.
--
--  1. The functions re-created here are as main left them (guard).
--  2. M1: nobody adds a shop member by writing the table.
--  3. The search functions answer for live shops only; longest_walkin()
--     looks no further than 90 days.
--  4. A shop's map link is an https Google Maps address; photos are paths
--     inside the shop's own folder (or our placeholders).
--  5. Two owners removing each other at once: one stays.

-- 1. The functions are as main left them -------------------------------------------------------

do $guard$
declare
  v_expected constant jsonb := jsonb_build_object(
    'public.rental_price(uuid,integer)', 'ba1e06726ffc43458ed33035e832286a',
    'public.model_offer(uuid,timestamptz,timestamptz)', 'e8f3dafc1acab6e9a55b472bbb190aa8',
    'public.longest_walkin(uuid,timestamptz,integer)', '52314f48207c2b8fa90ab473c6724eb8',
    'public.shop_stats(uuid)', 'aedfef6c19e6e59f1ee0601f4170523c',
    'public.protect_last_owner()', '6ff483db2a7d884e371aa60bd9896061'
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

-- 2. M1: shop members are added by two functions and nothing else ------------------------------
-- "Owners add team members" let an owner insert a membership row for any
-- user id with any role: a stranger made "staff" (whose profile the owner
-- could then read as a teammate's), or a second owner. Members are added
-- only by create_shop() (its caller, as owner) and accept_shop_invite() (its
-- caller, as staff); both run with their owner's rights and need no grant.

drop policy "Owners add team members" on public.shop_members;
revoke insert on public.shop_members from anon, authenticated;

-- 3. The search functions answer for live shops only -------------------------------------------
-- rental_price(), model_offer(), longest_walkin() and shop_stats() run with
-- their owner's rights and anyone may call them, so they answered for any
-- shop or model id: a draft or suspended shop's prices, stock and booking
-- rates. They now answer when the shop is live, or the caller is a member of
-- it, or the caller is the server (the service role, or a job inside the
-- database). Anyone else gets what an unknown id gets: no price, no row,
-- zero days.

create function public.shop_numbers_readable(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- auth.role() is null for a job inside the database.
    coalesce((select auth.role()), 'service_role') = 'service_role'
    or public.is_shop_live(p_shop_id)
    or public.is_shop_member(p_shop_id);
$$;

-- Called only from the functions below, which run as their owner.
revoke all on function public.shop_numbers_readable(uuid) from public, anon, authenticated;

create function public.model_numbers_readable(p_bike_model_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bike_models bm
    where bm.id = p_bike_model_id and public.shop_numbers_readable(bm.shop_id)
  );
$$;

revoke all on function public.model_numbers_readable(uuid) from public, anon, authenticated;

-- As 20261107000200 left it, plus the first branch.
create or replace function public.rental_price(p_bike_model_id uuid, p_days int)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_days is null or p_days < 1 then null
    when not public.model_numbers_readable(p_bike_model_id) then null
    when p_days <= 30 then
      (select total from public.price_days where bike_model_id = p_bike_model_id and day = p_days)
    else
      (select floor((total::bigint * p_days + 15) / 30)::int
       from public.price_days where bike_model_id = p_bike_model_id and day = 30)
  end;
$$;

-- As 20261107000200 left it, plus one condition on the model's row: with no
-- row there, the function answers with no row.
create or replace function public.model_offer(
  p_bike_model_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns table (free int, mode text)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select bm.qty, bm.instant_qty, bm.request_qty,
      make_interval(hours => coalesce(bm.buffer_before_h, s.buffer_before_h)) as bb,
      make_interval(hours => coalesce(bm.buffer_after_h, s.buffer_after_h)) as ba
    from public.bike_models bm
    join public.shops s on s.id = bm.shop_id
    where bm.id = p_bike_model_id
      and public.shop_numbers_readable(s.id)
  ),
  w as (select m.*, p_start - m.bb as ws, p_end + m.ba as we from m),
  held as (
    select b.start_at - w.bb as s, b.end_at + w.ba as e, b.mode
    from public.bookings b, w
    where b.bike_model_id = p_bike_model_id
      and b.status in ('confirmed_unpaid', 'paid', 'picked_up')
      and b.start_at - w.bb < w.we
      and b.end_at + w.ba > w.ws
  ),
  pts as (
    select w.ws as p from w
    union select h.s from held h, w where h.s > w.ws and h.s < w.we
    union select h.e from held h, w where h.e > w.ws and h.e < w.we
    union
    select (d at time zone 'Asia/Bangkok')
    from w,
      generate_series(
        date_trunc('day', w.ws at time zone 'Asia/Bangkok') + interval '1 day',
        w.we at time zone 'Asia/Bangkok',
        interval '1 day'
      ) as d
    where (d at time zone 'Asia/Bangkok') < w.we
  ),
  counts as (
    select
      (select count(*) from held h where h.s <= pts.p and pts.p < h.e) as used,
      (select count(*) from held h where h.s <= pts.p and pts.p < h.e and h.mode = 'instant') as inst,
      (select count(*) from held h where h.s <= pts.p and pts.p < h.e and h.mode = 'request') as req,
      public.units_in_repair(p_bike_model_id, (pts.p at time zone 'Asia/Bangkok')::date) as rep
    from pts
  ),
  peak as (
    select coalesce(max(used + rep), 0) as used, coalesce(max(inst), 0) as inst,
      coalesce(max(req), 0) as req
    from counts
  )
  select greatest(w.qty - peak.used, 0)::int,
    case
      when w.qty - peak.used > 0 and peak.inst < w.instant_qty then 'instant'
      when w.qty - peak.used > 0 and peak.req < w.request_qty then 'request'
    end
  from w, peak;
$$;

-- The longest walk-in rental in whole days from p_start, up to p_max_days
-- and never past 90: each day looked at is one call of model_offer(), and
-- the number asked for came from the caller with no ceiling (100000 ran
-- until the statement timeout). A model the caller may not read, or one
-- that does not exist, is 0 days: before, a missing answer from
-- model_offer() was read as "free" and the count ran to the limit.
create or replace function public.longest_walkin(
  p_bike_model_id uuid,
  p_start timestamptz,
  p_max_days int default 90
)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  days int := 0;
  max_days constant int := least(coalesce(p_max_days, 90), 90);
begin
  if not public.model_numbers_readable(p_bike_model_id) then
    return 0;
  end if;
  while days < max_days loop
    if coalesce((select o.free from public.model_offer(
          p_bike_model_id, p_start, p_start + make_interval(days => days + 1)) o), 0) < 1 then
      exit;
    end if;
    days := days + 1;
  end loop;
  return days;
end;
$$;

-- As 20261107000200 left it, plus the last line: no row for a shop the
-- caller may not read.
create or replace function public.shop_stats(p_shop_id uuid)
returns table (
  rating numeric, review_count int, response_rate numeric, cancellation_rate numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select round(avg(r.rating), 2) from public.reviews r
      where r.shop_id = p_shop_id and not r.hidden),
    (select count(*)::int from public.reviews r
      where r.shop_id = p_shop_id and not r.hidden),
    (select case when count(*) = 0 then null
        else count(*) filter (where b.status <> 'expired')::numeric / count(*) end
      from public.bookings b
      where b.shop_id = p_shop_id and b.mode = 'request' and b.status <> 'pending_vendor'),
    (select case when count(*) = 0 then null
        else count(*) filter (where b.status = 'cancelled_vendor')::numeric / count(*) end
      from public.bookings b
      where b.shop_id = p_shop_id
        and b.status in ('confirmed_unpaid', 'paid', 'picked_up', 'returned',
          'cancelled_customer', 'cancelled_vendor', 'cancelled_unpaid', 'no_show'))
  where public.shop_numbers_readable(p_shop_id);
$$;

-- 4. Map links and photos ----------------------------------------------------------------------
-- A shop owner may write shops.maps_url and the two photos columns straight
-- through the API, past the app's own checks. Customers click the link and
-- their browsers load the photos, so:
--   * maps_url is an https address on Google Maps' own hosts
--     (maps.app.goo.gl, goo.gl/maps, g.co/kgs, maps.google.*, google.*/maps),
--     with no port, user part, space, control character or backslash. The
--     same rule as lib/maps-url.ts in the marketplace.
--   * a photo is a path, never an address: one of our own placeholders
--     (/images/<file>), or a file in the row's own folder of the bucket,
--     <shop id>/<file> for a shop and <shop id>/<model id>/<file> for a model.
--
-- A trigger and not a check constraint, on purpose: it looks only at a value
-- that is being written and is not what the row already holds. A row saved
-- before today with something else in it can still have its other columns
-- changed (a constraint, even "not valid", would refuse every update of such
-- a row). Raised with a check's error code, 23514.

create function public.check_shop_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_folder text;
  v_photo text;
begin
  if tg_table_name = 'shops' then
    if new.maps_url is not null
      and (tg_op = 'INSERT' or new.maps_url is distinct from old.maps_url)
      and (
        length(new.maps_url) > 500
        or new.maps_url ~ '[[:space:][:cntrl:]\\]'
        or new.maps_url !~ (
          '^https://('
          || 'maps\.app\.goo\.gl/'
          || '|goo\.gl/maps/'
          || '|g\.co/kgs/'
          || '|maps\.google\.(com|co\.[a-z]{2}|com\.[a-z]{2})/'
          || '|(www\.)?google\.(com|co\.[a-z]{2}|com\.[a-z]{2})/maps(/|\?|$)'
          || ')'
        )
      )
    then
      raise exception 'maps_url must be an https Google Maps link' using errcode = '23514';
    end if;
    v_folder := new.id::text || '/';
  else
    v_folder := new.shop_id::text || '/' || new.id::text || '/';
  end if;

  if tg_op = 'INSERT' or new.photos is distinct from old.photos then
    foreach v_photo in array new.photos loop
      -- Null, or neither a placeholder nor a file in the row's own folder.
      if v_photo is null
        or not (
          (v_photo ~ '^/images(/[A-Za-z0-9][A-Za-z0-9._-]*)+$' and position('..' in v_photo) = 0)
          or (
            left(v_photo, length(v_folder)) = v_folder
            and substr(v_photo, length(v_folder) + 1) ~ '^[^/\\[:cntrl:]]{1,200}$'
            and substr(v_photo, length(v_folder) + 1) not in ('.', '..')
          )
        )
      then
        raise exception 'photos must be files in the shop''s own folder' using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

-- A trigger function: nobody calls it.
revoke all on function public.check_shop_links() from public, anon, authenticated;

create trigger shops_check_links
before insert or update of maps_url, photos on public.shops
for each row execute function public.check_shop_links();

create trigger bike_models_check_photos
before insert or update of photos on public.bike_models
for each row execute function public.check_shop_links();

-- 5. The last owner, when two leave at once ----------------------------------------------------
-- protect_last_owner() read the other owners and then let the delete go on.
-- Two owners removing each other in the same instant each saw the other
-- still there, and both deletes went through: a shop with no owner. Removals
-- of a shop's owners now take turns on the shop's row, and each reads the
-- team again once it has it.
--
-- "for no key update": strong enough to make two of these take turns, and it
-- does not wait for (or hold up) a booking or anything else that only points
-- at the shop. When the whole shop is being deleted its row is already gone
-- and its members go with it, as before.

create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'owner' then
    return old;
  end if;
  perform 1 from public.shops where id = old.shop_id for no key update;
  if found
    and not exists (
      select 1 from public.shop_members
      where shop_id = old.shop_id and role = 'owner' and user_id <> old.user_id
    )
  then
    raise exception 'a shop must keep at least one owner' using errcode = '23514';
  end if;
  return old;
end;
$$;
