-- rollback/0010_subscriptions.sql
-- Undoes migration 0010. WARNING: this deletes every subscription and subscription payment record
-- (the yearly plan's data). Lifetime purchases, progress and accounts are untouched. Nothing in the
-- app reads these tables before rollout step 3.

begin;

drop function if exists public.has_access(text, timestamptz);
drop table if exists public.subscription_payments; -- its policies, indexes and trigger go with it
drop table if exists public.subscriptions;

commit;
