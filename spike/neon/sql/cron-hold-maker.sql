-- Row 7, Launch only: give the minute sweep real work during the 24 hours.
-- Every 5 minutes this makes one online hold on the spike shop (as the service role, through platform.reserve()
-- itself), each on its own product and day so holds never compete. The hold runs out after the shop's
-- hold_minutes, and the minute sweep (the job under test) must then release it under the product lock.
-- :tenant and :location are filled in by scripts/cron-hold-maker.mjs.
create or replace function spike.make_hold() returns jsonb
language plpgsql
set search_path = ''
as $f$
declare
  v_n bigint := floor(extract(epoch from clock_timestamp()) / 300)::bigint;
  v_product uuid;
  v_start timestamptz;
  v_result jsonb;
begin
  select p.id into v_product
  from platform.products p
  where p.tenant_id = '__TENANT__'::uuid and p.type = 'vehicle'
  order by p.name
  offset (v_n % 12) limit 1;
  -- A different day for every run: 400 days ahead, plus one day per run of the day.
  v_start := date_trunc('day', clock_timestamp()) + interval '400 days' + ((v_n % 288) * interval '1 day') + interval '3 hours';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_result := platform.reserve(
    '__TENANT__'::uuid,
    jsonb_build_object(
      'channel', 'booking_page', 'mode', 'instant', 'hold', true,
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'location_id', '__LOCATION__'::uuid,
        'starts_at', v_start, 'ends_at', v_start + interval '8 hours', 'quantity', 1))));
  insert into spike.hold_log (result) values (v_result);
  return v_result;
end
$f$;

create table if not exists spike.hold_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  result jsonb not null
);
