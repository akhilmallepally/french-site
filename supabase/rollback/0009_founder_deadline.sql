-- rollback/0009_founder_deadline.sql
-- Undoes migration 0009: removes the founding offer's deadline (founder_ends_at) and its guard.
-- The app then can't read pricing (it selects founder_ends_at), so pricing shows as unavailable and
-- checkout refuses until 0009 is run again or the app is rolled back too. No purchases are touched.

begin;

drop trigger if exists pricing_settings_guard_founder_deadline on public.pricing_settings;
drop function if exists public.guard_founder_deadline();
alter table if exists public.pricing_settings drop column if exists founder_ends_at;

commit;
