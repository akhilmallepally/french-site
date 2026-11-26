-- 0011_subscription_webhooks.sql
-- What the subscription webhooks need (docs/plans/subscription.md, rollout step 2):
-- - subscriptions.last_event_at: the provider's timestamp of the last event applied to the row, so
--   an older event arriving late (out of order) is ignored instead of undoing a newer one.
-- - unmatched_payment_events accepts the subscription events too ('subscription_event' and
--   'subscription_payment'), with one new reason ('subscription_unknown': a payment for a
--   subscription we haven't seen).
--
-- Safe to run more than once. Run after 0001 to 0010. One transaction: nothing changes if it stops.

begin;

do $$
begin
  if pg_catalog.to_regclass('public.subscriptions') is null then
    raise exception 'public.subscriptions is missing: run migration 0010 first';
  end if;
  if pg_catalog.to_regclass('public.unmatched_payment_events') is null then
    raise exception 'public.unmatched_payment_events is missing: run migration 0007 first';
  end if;
end;
$$;

alter table public.subscriptions add column if not exists last_event_at timestamptz;

comment on column public.subscriptions.last_event_at is
  'The provider''s timestamp of the last webhook event applied; an older event is ignored.';

alter table public.unmatched_payment_events drop constraint if exists unmatched_payment_events_event_type_check;
alter table public.unmatched_payment_events add constraint unmatched_payment_events_event_type_check
  check (event_type in ('order_paid', 'order_refunded', 'order_disputed', 'subscription_event', 'subscription_payment'));

alter table public.unmatched_payment_events drop constraint if exists unmatched_payment_events_reason_check;
alter table public.unmatched_payment_events add constraint unmatched_payment_events_reason_check
  check (reason in (
    'no_matching_user', 'invalid_metadata_signature', 'unknown_product', 'invalid_amount',
    'invalid_currency', 'invalid_data', 'refund_unknown_order', 'dispute_unknown_order',
    'paid_after_refund_or_dispute', 'subscription_unknown'));

commit;
