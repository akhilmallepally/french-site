-- 0005_payments.sql
-- Rolls back migration 0005: drops get_founder_spots_left(), purchases, and pricing_settings.
-- WARNING: This deletes all purchase and payment entitlement records.

begin;

drop function if exists public.get_founder_spots_left(text);
drop table if exists public.purchases;
drop table if exists public.pricing_settings;

commit;
