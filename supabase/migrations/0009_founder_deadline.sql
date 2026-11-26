-- 0009_founder_deadline.sql
-- The founding offer's deadline (Pricing v2, step 1; docs/progress-log.md, Prompt 76).
-- The founder price ($8 once, lifetime access) is on offer only while founder spots remain AND
-- now() < founder_ends_at. The app works that out on every request, never from a cache.
--
-- The deadline is one moment for everyone: 2026-12-31 23:59 Asia/Bangkok = 2026-12-31T16:59:00Z.
-- It can be changed only deliberately, by a migration: a trigger refuses any change to
-- founder_ends_at unless the transaction first runs
--   select set_config('app.allow_founder_deadline_change', 'on', true);
-- (this file does that for its own update). A dashboard edit without it fails.
--
-- Safe to run more than once. Run after 0001 to 0008. One transaction: nothing changes if it stops.

begin;

-- Preconditions: the pricing table from 0005.
do $$
begin
  if pg_catalog.to_regclass('public.pricing_settings') is null then
    raise exception 'public.pricing_settings is missing: run migration 0005 first';
  end if;
end;
$$;

-- ---------- 1. The column ----------
alter table public.pricing_settings add column if not exists founder_ends_at timestamptz;

comment on column public.pricing_settings.founder_ends_at is
  'When the founding offer ends, for everyone (the founder price is live only while spots remain and now() is before this). Change only by a migration.';

-- ---------- 2. The guard (a deliberate change only) ----------
create or replace function public.guard_founder_deadline()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.founder_ends_at is distinct from old.founder_ends_at
     and coalesce(pg_catalog.current_setting('app.allow_founder_deadline_change', true), '') <> 'on' then
    raise exception 'founder_ends_at can only be changed by a migration (set app.allow_founder_deadline_change first)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_founder_deadline() from public, anon, authenticated, service_role;

drop trigger if exists pricing_settings_guard_founder_deadline on public.pricing_settings;
create trigger pricing_settings_guard_founder_deadline
  before update on public.pricing_settings
  for each row execute function public.guard_founder_deadline();

-- ---------- 3. The deadline ----------
select pg_catalog.set_config('app.allow_founder_deadline_change', 'on', true);

update public.pricing_settings
   set founder_ends_at = '2026-12-31T16:59:00Z'
 where founder_ends_at is null
    or founder_ends_at <> '2026-12-31T16:59:00Z';

alter table public.pricing_settings alter column founder_ends_at set not null;

-- New rows (another product later) must say when their founder offer ends.
alter table public.pricing_settings alter column founder_ends_at drop default;

-- ---------- 4. Check ----------
do $$
begin
  if not exists (
    select 1 from public.pricing_settings
     where product = 'lessons' and founder_ends_at = '2026-12-31T16:59:00Z'
  ) then
    raise exception 'the lessons row has no founder_ends_at of 2026-12-31T16:59:00Z (is there a lessons row?)';
  end if;
end;
$$;

commit;
