-- 0005_payments.sql
-- Purchases, pricing settings, and founder spots counter for lifetime access.
-- Safe to run more than once. Run after 0001 (set_updated_at).

-- ---------- 1. Purchases table ----------
-- Stores entitlements and order history. One row per completed purchase.
-- Writes happen strictly from the server webhook handler via the service role key.
create table if not exists public.purchases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  product text not null check (product in ('lessons', 'pro', 'max')),
  status text not null check (status in ('active', 'refunded', 'disputed')),
  provider text not null check (provider in ('dodo', 'lemonsqueezy')),
  provider_order_id text not null,
  amount int not null check (amount >= 0),
  currency text not null default 'usd' check (char_length(currency) = 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  refunded_at timestamptz,
  constraint purchases_provider_order_unique unique (provider_order_id),
  constraint purchases_refund_status_check check (
    (status = 'refunded') = (refunded_at is not null)
  )
);

comment on table public.purchases is 'Entitlements and purchase records. Writes occur strictly via service role from webhooks.';

create index if not exists purchases_user_product_status_idx
  on public.purchases (user_id, product, status);

create index if not exists purchases_product_status_amount_idx
  on public.purchases (product, status, amount);

drop trigger if exists purchases_set_updated_at on public.purchases;
create trigger purchases_set_updated_at
  before update on public.purchases
  for each row execute function public.set_updated_at();

-- ---------- 2. Pricing settings table ----------
-- Pricing plans and founder caps editable directly in Supabase without a redeployment.
create table if not exists public.pricing_settings (
  product text primary key check (product in ('lessons', 'pro', 'max')),
  currency text not null default 'usd' check (char_length(currency) = 3),
  founder_price_cents int not null check (founder_price_cents > 0),
  standard_price_cents int not null check (standard_price_cents > 0),
  founder_cap int not null check (founder_cap >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pricing_settings is 'Pricing plans and founder caps editable from Supabase dashboard.';

drop trigger if exists pricing_settings_set_updated_at on public.pricing_settings;
create trigger pricing_settings_set_updated_at
  before update on public.pricing_settings
  for each row execute function public.set_updated_at();

-- Seed initial configuration: $8 (800 cents) founder price for first 100 buyers, then $12 (1200 cents).
insert into public.pricing_settings (
  product, currency, founder_price_cents, standard_price_cents, founder_cap, is_active
) values (
  'lessons', 'usd', 800, 1200, 100, true
) on conflict (product) do nothing;

-- ---------- 3. Founder spots counter function ----------
-- Security definer: allows anon and authenticated users to check how many founder spots remain
-- without exposing individual purchase records or customer counts.
create or replace function public.get_founder_spots_left(p_product text default 'lessons')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap int;
  v_founder_price int;
  v_taken bigint;
begin
  select ps.founder_cap, ps.founder_price_cents
    into v_cap, v_founder_price
    from public.pricing_settings as ps
   where ps.product = p_product
     and ps.is_active = true;

  if not found then
    return 0;
  end if;

  select count(*)
    into v_taken
    from public.purchases as p
   where p.product = p_product
     and p.status = 'active'
     and p.amount <= v_founder_price;

  return case when v_cap - v_taken::int > 0 then v_cap - v_taken::int else 0 end;
end;
$$;

-- ---------- 4. Enable and force RLS ----------
alter table public.purchases enable row level security;
alter table public.purchases force row level security;
alter table public.pricing_settings enable row level security;
alter table public.pricing_settings force row level security;

-- ---------- 5. Privileges and Policies ----------
-- Start with no privileges for public, anon, and authenticated.
revoke all on table public.purchases, public.pricing_settings from public, anon, authenticated;
revoke all on sequence public.purchases_id_seq from public, anon, authenticated;
revoke all on function public.get_founder_spots_left(text) from public;

-- purchases: authenticated users can only SELECT their own purchases.
-- NO insert, update, or delete privileges for authenticated or anon.
grant select on table public.purchases to authenticated;

drop policy if exists "purchases: read own" on public.purchases;
create policy "purchases: read own" on public.purchases
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- pricing_settings: authenticated and anon can view active pricing tiers.
grant select on table public.pricing_settings to authenticated, anon;

drop policy if exists "pricing_settings: read active" on public.pricing_settings;
create policy "pricing_settings: read active" on public.pricing_settings
  for select to authenticated, anon
  using (is_active = true);

-- get_founder_spots_left(): callable by anyone to render real-time spots on paywalls and /pricing.
grant execute on function public.get_founder_spots_left(text) to authenticated, anon;
