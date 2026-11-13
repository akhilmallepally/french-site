-- 0001_profiles.sql
-- One profile row per auth user, created by a trigger on sign-up and deleted with the user.
-- Safe to run more than once.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 200),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_active_at timestamptz
);

comment on table public.profiles is 'One row per auth user. Created by public.handle_new_user(); deleted by cascade.';

-- Shared updated_at trigger function (also used by the tables in 0002).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Creates the profile from the Google metadata. security definer because it runs as the auth
-- service, which has no rights on public.profiles; search_path is empty and every name is
-- schema-qualified so nothing can be shadowed. Values are trimmed to the column limits so a long
-- name can never block a sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    pg_catalog.left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 200),
    pg_catalog.left(new.raw_user_meta_data ->> 'avatar_url', 2048)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger functions are never called directly.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Users who signed in before this migration get a profile too.
insert into public.profiles (id, display_name, avatar_url)
select
  u.id,
  pg_catalog.left(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'), 200),
  pg_catalog.left(u.raw_user_meta_data ->> 'avatar_url', 2048)
from auth.users as u
on conflict (id) do nothing;
