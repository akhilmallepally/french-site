-- rollback/0013_cancel_no_grace.sql
-- Restores 0010's has_access(), which gives every active or past_due subscription the 7-day grace,
-- including one set to cancel at the period end (the bug 0013 fixed). Deletes no rows.

begin;

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
                (s.status in ('active', 'past_due') and p_now < s.current_period_end + interval '7 days')
                or (s.status = 'cancelled' and s.cancel_at_period_end and p_now < s.current_period_end)
              )
         );
$$;

revoke all on function public.has_access(text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.has_access(text, timestamptz) to authenticated;

commit;
