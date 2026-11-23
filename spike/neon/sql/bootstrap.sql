-- Neon spike bootstrap: what the 67 migrations expect Supabase to have made already.
-- Idempotent. Run as neondb_owner over the direct connection, AFTER the Data API is enabled
-- (so anything the Data API or pg_session_jwt made is left as it is and only the gaps are filled).

-- 1. The three Supabase roles. `authenticated` may already exist (the Data API makes it).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- 2. Schemas and extensions Supabase supplies.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists storage;

-- 3. Users. Once the Data API is enabled, schema `auth` belongs to cloud_admin and we may not create
--    anything in it (finding). So the spike keeps its stand-in for auth.users, auth.identities and
--    auth.role() in its own schema, and the loader points the migrations at it in memory.
--    auth.uid() and auth.jwt() are Neon's own (pg_session_jwt) and are used as they are.
create schema if not exists spike_auth;
create table if not exists spike_auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists spike_auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references spike_auth.users (id) on delete cascade,
  provider text not null,
  provider_id text not null,
  created_at timestamptz not null default now()
);

-- 4. "Who is calling" and "which role is calling". Findings behind this:
--    - the Data API sets the transaction setting request.jwt.claims from the checked token, as PostgREST does;
--    - Neon's auth.uid() / auth.jwt() are not usable by our roles: schema auth grants them nothing and we
--      cannot grant it, and called from a security definer function they answer null through the Data API;
--    - Neon has no auth.role() at all.
--    So both are read from request.jwt.claims, exactly as Supabase's own auth.uid() and auth.role() do.
create or replace function spike_auth.uid() returns uuid language sql stable set search_path = '' as
  $b$select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid$b$;
create or replace function spike_auth.role() returns text language sql stable set search_path = '' as
  $b$select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'$b$;
grant execute on function spike_auth.uid() to anon, authenticated, service_role, anonymous;
grant usage on schema spike_auth to anon, authenticated, service_role, anonymous;
grant execute on function spike_auth.role() to anon, authenticated, service_role, anonymous;

-- 5. storage: just enough for the photo-bucket migration to apply. Not used by the spike.
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as
  $$select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]$$;

-- 6. Supabase's defaults that the early (marketplace) migrations rely on: the three roles may use
--    schema public, and new objects in public are granted to them (RLS does the protecting).
--    Migration 20261112000100 takes the table/sequence/function defaults away again, as on Supabase.
grant usage on schema public, extensions, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to service_role;
grant select, insert, delete on storage.objects to authenticated;

-- 7. Supabase's database search_path.
do $$ begin execute format('alter database %I set search_path = "$user", public, extensions', current_database()); end $$;

-- 8. The spike's own record of what it applied.
create schema if not exists spike;
create table if not exists spike.migrations (name text primary key, applied_at timestamptz not null default now());
