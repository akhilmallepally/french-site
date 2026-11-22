-- 0007_service_role_grants.sql
-- Gives the payment webhook's service-role client exactly the privileges it needs, and nothing
-- else. Why: 0003 and 0005 revoke privileges from public, anon and authenticated only; they never
-- grant anything to service_role, so service_role had whatever this project's default privileges
-- give it, and here that was nothing on purchases ("permission denied for table purchases", 42501,
-- 19 to 20 Nov). The live webhook failed on every attempt until the grant was added by hand.
--
-- The service-role client is used only by lib/payments/webhook.ts. It touches:
--   public.purchases                  select (idempotency check), insert (grant), update (refund, dispute)
--   public.unmatched_payment_events   insert (a payment, refund or dispute it couldn't match),
--                                     select (does a refund or dispute already exist for this order?)
--   public.find_user_id_by_email()    execute (the fallback when the checkout metadata has no usable user id)
-- The two last objects are created here. service_role keeps BYPASSRLS, as on every Supabase project.
--
-- Safe to run more than once. One transaction. Run after 0005 (0006 is not required).

begin;

do $$
begin
  if pg_catalog.to_regclass('public.purchases') is null then
    raise exception '0007: run 0005_payments.sql first (public.purchases is missing). Nothing was changed.';
  end if;
end;
$$;

-- ---------- 1. Events the webhook couldn't apply ----------
-- One row per (provider, order, reason): a resent event finds its row and adds nothing. No email,
-- no name, no user id: the order id is enough to find the buyer in the provider's dashboard.
create table if not exists public.unmatched_payment_events (
  id bigint generated always as identity primary key,
  provider text not null check (char_length(provider) between 1 and 40),
  provider_order_id text not null check (char_length(provider_order_id) between 1 and 200),
  event_type text not null check (event_type in ('order_paid', 'order_refunded', 'order_disputed')),
  event_id text check (event_id is null or char_length(event_id) <= 200),
  reason text not null check (reason in (
    'no_matching_user', 'invalid_metadata_signature', 'unknown_product', 'invalid_amount',
    'invalid_currency', 'invalid_data', 'refund_unknown_order', 'dispute_unknown_order',
    'paid_after_refund_or_dispute')),
  product text check (product is null or char_length(product) <= 40),
  amount bigint,
  currency text check (currency is null or char_length(currency) <= 10),
  received_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint unmatched_payment_events_unique unique (provider, provider_order_id, reason)
);

comment on table public.unmatched_payment_events is
  'Payment webhook events that could not be applied (no matching user, bad data, refund before payment). Read in the Table Editor; set resolved_at once handled. No personal data.';

-- RLS on and forced, with no policy: anon and authenticated can't reach it even if granted.
alter table public.unmatched_payment_events enable row level security;
alter table public.unmatched_payment_events force row level security;

-- ---------- 2. Email lookup for the fallback match ----------
-- Returns the id of the one auth user whose email matches, ignoring case and surrounding spaces,
-- or null when none or more than one match. security definer because service_role can't read
-- auth.users through the API; search_path is empty and every name is schema-qualified.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when pg_catalog.count(*) = 1 then (pg_catalog.array_agg(u.id))[1] end
    from auth.users as u
   where p_email is not null
     and pg_catalog.btrim(p_email) <> ''
     and pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(p_email));
$$;

-- ---------- 3. service_role: start from nothing in public, then grant exactly what's needed ----------
do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
  loop
    if r.relkind = 'S' then
      execute pg_catalog.format('revoke all on sequence public.%I from service_role', r.relname);
    else
      execute pg_catalog.format('revoke all on table public.%I from service_role', r.relname);
    end if;
  end loop;

  for r in
    select p.oid::regprocedure as fn
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute pg_catalog.format('revoke all on function %s from service_role', r.fn);
  end loop;
end;
$$;

grant usage on schema public to service_role;
grant select, insert, update on table public.purchases to service_role;
grant select, insert on table public.unmatched_payment_events to service_role;
grant execute on function public.find_user_id_by_email(text) to service_role;
-- No sequence grant: inserting into an identity column needs no privilege on its sequence.

-- anon and authenticated: no access to the new objects (and nothing else changes for them).
revoke all on table public.unmatched_payment_events from public, anon, authenticated;
revoke all on sequence public.unmatched_payment_events_id_seq from public, anon, authenticated;
revoke all on function public.find_user_id_by_email(text) from public, anon, authenticated;

commit;
