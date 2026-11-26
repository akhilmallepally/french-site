-- 0010_subscriptions.sql
-- The yearly subscription's data (docs/plans/subscription.md, rollout step 1): subscriptions,
-- subscription_payments, and the entitlement function. Nothing in the app uses them yet: step 2 adds
-- the webhook writes, step 3 switches every access check to has_access().
--
-- Access (has_access) = an active lifetime purchase, OR a subscription that is
--   * active or past_due, with now < current_period_end + 7 days (the grace for a failed renewal);
--   * or cancelled at the period end (cancel_at_period_end), with now < current_period_end.
-- A refunded or disputed subscription, one on hold, or an expired one gives no access. Duplicate rows
-- are fine: any one entitling row is enough.
--
-- Writes come only from the payments webhook (service_role): select, insert and update, no delete,
-- as for purchases (0007). Learners read their own rows. RLS is forced.
--
-- Safe to run more than once. Run after 0001 to 0009. One transaction: nothing changes if it stops.

begin;

-- Preconditions: the purchases table (0005) and set_updated_at (0001).
do $$
begin
  if pg_catalog.to_regclass('public.purchases') is null then
    raise exception 'public.purchases is missing: run migration 0005 first';
  end if;
  if pg_catalog.to_regprocedure('public.set_updated_at()') is null then
    raise exception 'public.set_updated_at() is missing: run migration 0001 first';
  end if;
end;
$$;

-- ---------- 1. subscriptions ----------
create table if not exists public.subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  product text not null check (product in ('lessons', 'pro', 'max')),
  provider text not null check (provider in ('dodo', 'lemonsqueezy')),
  provider_subscription_id text not null check (char_length(provider_subscription_id) between 1 and 200),
  provider_customer_id text check (provider_customer_id is null or char_length(provider_customer_id) between 1 and 200),
  status text not null check (status in ('active', 'past_due', 'on_hold', 'cancelled', 'expired', 'refunded', 'disputed')),
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_provider_subscription_unique unique (provider_subscription_id),
  -- A cancelled subscription says when; one set to cancel at the period end may have it already.
  constraint subscriptions_cancelled_check check (status <> 'cancelled' or cancelled_at is not null)
);

comment on table public.subscriptions is 'Yearly subscriptions, one row per provider subscription. Written only by the payments webhook (service role).';

create index if not exists subscriptions_user_product_status_idx
  on public.subscriptions (user_id, product, status);

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------- 2. subscription_payments ----------
-- Every charge of a subscription (the first and each renewal), for refunds and duplicate charges.
create table if not exists public.subscription_payments (
  id bigint generated always as identity primary key,
  subscription_id bigint not null references public.subscriptions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_payment_id text not null check (char_length(provider_payment_id) between 1 and 200),
  charge_type text not null check (charge_type in ('new', 'renewal')),
  status text not null check (status in ('succeeded', 'refunded', 'disputed')),
  amount int not null check (amount >= 0),
  currency text not null default 'usd' check (char_length(currency) = 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  refunded_at timestamptz,
  constraint subscription_payments_provider_payment_unique unique (provider_payment_id),
  constraint subscription_payments_refund_check check ((status = 'refunded') = (refunded_at is not null))
);

comment on table public.subscription_payments is 'Charges of a subscription. Written only by the payments webhook (service role).';

create index if not exists subscription_payments_subscription_idx
  on public.subscription_payments (subscription_id);
create index if not exists subscription_payments_user_idx
  on public.subscription_payments (user_id);

drop trigger if exists subscription_payments_set_updated_at on public.subscription_payments;
create trigger subscription_payments_set_updated_at
  before update on public.subscription_payments
  for each row execute function public.set_updated_at();

-- ---------- 3. RLS (forced) and grants ----------
alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;
alter table public.subscription_payments enable row level security;
alter table public.subscription_payments force row level security;

revoke all on table public.subscriptions, public.subscription_payments from public, anon, authenticated, service_role;
revoke all on sequence public.subscriptions_id_seq, public.subscription_payments_id_seq from public, anon, authenticated, service_role;

-- Learners read their own rows; nothing else.
grant select on table public.subscriptions, public.subscription_payments to authenticated;

drop policy if exists "subscriptions: read own" on public.subscriptions;
create policy "subscriptions: read own" on public.subscriptions
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "subscription_payments: read own" on public.subscription_payments;
create policy "subscription_payments: read own" on public.subscription_payments
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- The payments webhook (service_role, which bypasses RLS as for purchases): select, insert and
-- update, no delete (as purchases, 0007). No policy is needed for it.
grant select, insert, update on table public.subscriptions, public.subscription_payments to service_role;
grant usage on sequence public.subscriptions_id_seq, public.subscription_payments_id_seq to service_role;

-- ---------- 4. The entitlement ----------
-- The caller's own access (auth.uid()), at p_now (now() unless a test passes a time). Security
-- invoker: it reads only what the caller may read (their own purchases and subscriptions, by RLS).
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
