-- 0014_provider_cancellations.sql
-- Fix from the preview test (Prompt 84): a refund (or a lost dispute) of a subscription payment
-- ends access here at once, but Dodo doesn't cancel the subscription by itself, so it would renew
-- (and Dodo blocks a new subscription for that customer). The payments webhook now cancels it in
-- Dodo too, after replying 200. This table records each such cancellation so a failure is never lost:
--   - a row is written (pending) when the refund or lost dispute is applied;
--   - done_at is set when Dodo confirms (the call succeeds, or Dodo's own subscription.cancelled or
--     subscription.expired arrives);
--   - attempts and last_error (a short code, never a message) record failures; a later delivery of
--     the refund retries, and docs/payments-recovery.md has the manual step.
-- RLS forced; only the webhook's service role reads, inserts and updates it (no delete); learners
-- and anon can't see it. Rows go when their subscription goes (on delete cascade).
--
-- Safe to run more than once. Run after 0001 to 0013. One transaction: nothing changes if it stops.

begin;

do $$
begin
  if pg_catalog.to_regclass('public.subscriptions') is null then
    raise exception 'public.subscriptions is missing: run migration 0010 first';
  end if;
end;
$$;

create table if not exists public.provider_cancellations (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('dodo', 'lemonsqueezy')),
  provider_subscription_id text not null check (char_length(provider_subscription_id) between 1 and 200),
  subscription_id bigint not null references public.subscriptions (id) on delete cascade,
  reason text not null check (reason in ('refunded', 'dispute_lost')),
  requested_at timestamptz not null default now(),
  done_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or char_length(last_error) between 1 and 100),
  updated_at timestamptz not null default now(),
  constraint provider_cancellations_subscription_unique unique (provider, provider_subscription_id)
);

comment on table public.provider_cancellations is
  'Subscriptions the payments webhook cancels in the provider after a refund or lost dispute (done_at null = still to do).';

alter table public.provider_cancellations enable row level security;
alter table public.provider_cancellations force row level security;

revoke all on table public.provider_cancellations from public, anon, authenticated, service_role;
revoke all on sequence public.provider_cancellations_id_seq from public, anon, authenticated, service_role;
grant select, insert, update on table public.provider_cancellations to service_role;
grant usage on sequence public.provider_cancellations_id_seq to service_role;

commit;
