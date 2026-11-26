-- 0012_subscription_price.sql
-- The yearly subscription's price (docs/plans/subscription.md, rollout step 4):
-- pricing_settings.subscription_price_cents, 1200 ($12 a year) for 'lessons'. The pricing card, the
-- paywall and the sign-in panel show it after the switch, and checkout compares the page's price with
-- it (and with the payment provider's own product price) before creating a subscription checkout.
-- Like the other prices, it's read by everyone (the existing pricing_settings policy) and changed only
-- from the dashboard or a migration (no app role can write pricing_settings).
--
-- Safe to run more than once: it never overwrites a price that's already set. Run after 0001 to
-- 0011, and before deploying the code that sells the yearly plan (until it runs, that code shows
-- "New plan coming soon" after the switch). One transaction: nothing changes if it stops.

begin;

do $$
begin
  if pg_catalog.to_regclass('public.pricing_settings') is null then
    raise exception 'public.pricing_settings is missing: run migration 0005 first';
  end if;
end;
$$;

alter table public.pricing_settings add column if not exists subscription_price_cents integer;

comment on column public.pricing_settings.subscription_price_cents is
  'The yearly subscription price in cents (1200 = $12 a year). Must match the payment provider''s yearly product, or checkout refuses.';

alter table public.pricing_settings drop constraint if exists pricing_settings_subscription_price_check;
alter table public.pricing_settings add constraint pricing_settings_subscription_price_check
  check (subscription_price_cents is null or subscription_price_cents > 0);

update public.pricing_settings
   set subscription_price_cents = 1200
 where product = 'lessons'
   and subscription_price_cents is null;

commit;
