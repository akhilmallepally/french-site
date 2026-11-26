-- rollback/0012_subscription_price.sql
-- Undoes 0012: removes pricing_settings.subscription_price_cents and its check. The yearly plan then
-- shows "New plan coming soon" after the switch (the app reads the column only when it exists).
-- Deletes no rows.

begin;

alter table public.pricing_settings drop constraint if exists pricing_settings_subscription_price_check;
alter table public.pricing_settings drop column if exists subscription_price_cents;

commit;
