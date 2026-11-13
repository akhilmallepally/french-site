-- 0004_activity.sql
-- touch_last_active(): stamps the caller's profile with the current time. The app can call it
-- later with supabase.rpc('touch_last_active'). It is security invoker, so it runs with the
-- caller's own rights and RLS: it can only update the caller's row, and anon can't execute it.
-- Safe to run more than once. Run after 0001 and 0003.

create or replace function public.touch_last_active()
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.profiles
     set last_active_at = pg_catalog.now()
   where id = (select auth.uid());
$$;

revoke all on function public.touch_last_active() from public, anon;
grant execute on function public.touch_last_active() to authenticated;
