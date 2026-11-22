-- rollback/0007_service_role_grants.sql
-- Undoes migration 0007: drops unmatched_payment_events (and every recorded event in it) and
-- find_user_id_by_email(), and removes service_role's privileges on purchases.
-- WARNING: after this, the payment webhook fails again with "permission denied for table
-- purchases" (HTTP 500 on every attempt) unless the project's default privileges grant it.
-- Export public.unmatched_payment_events first if it holds anything unresolved.

begin;

drop function if exists public.find_user_id_by_email(text);
drop table if exists public.unmatched_payment_events;

revoke select, insert, update on table public.purchases from service_role;

commit;
