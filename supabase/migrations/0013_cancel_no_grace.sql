-- 0013_cancel_no_grace.sql
-- Fix from the preview test (Prompt 83): a subscription set to cancel at the period end gets NO
-- grace. Dodo keeps a subscription "active" (with cancel_at_next_billing_date true) until its period
-- ends, and 0010's has_access() gave every active or past_due subscription the 7-day grace, so access
-- ran 7 days past the end of a cancelled year. The grace is only for failed renewals.
--
-- has_access() after this migration, for the caller (auth.uid()) and the product, at p_now:
--   - an active lifetime purchase; or
--   - a subscription NOT set to cancel (cancel_at_period_end false), active or past_due, while
--     p_now < current_period_end + 7 days (the grace for a failed renewal); or
--   - a subscription set to cancel at the period end (cancel_at_period_end true), active, past_due
--     or cancelled, while p_now < current_period_end exactly.
-- Un-cancelling (the learner resumes; subscription.updated clears the flag) brings the grace back.
-- Everything else is unchanged: security invoker, empty search_path, executable by authenticated only.
--
-- Safe to run more than once. Run after 0001 to 0012. One transaction: nothing changes if it stops.

begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.has_access(text, timestamp with time zone)') is null then
    raise exception 'public.has_access() is missing: run migration 0010 first';
  end if;
end;
$$;

create or replace function public.has_access(p_product text default 'lessons', p_now timestamptz default now())
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
           select 1 from public.purchases as p
            where p.user_id = (select auth.uid()) and p.product = p_product and p.status = 'active'
         )
      or exists (
           select 1 from public.subscriptions as s
            where s.user_id = (select auth.uid()) and s.product = p_product
              and (
                (not s.cancel_at_period_end and s.status in ('active', 'past_due') and p_now < s.current_period_end + interval '7 days')
                or (s.cancel_at_period_end and s.status in ('active', 'past_due', 'cancelled') and p_now < s.current_period_end)
              )
         );
$$;

revoke all on function public.has_access(text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.has_access(text, timestamptz) to authenticated;

commit;
