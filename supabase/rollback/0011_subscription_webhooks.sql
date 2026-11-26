-- rollback/0011_subscription_webhooks.sql
-- Undoes migration 0011: removes subscriptions.last_event_at and puts back 0007's checks on
-- unmatched_payment_events. It fails if any unmatched row uses the subscription event types or the
-- 'subscription_unknown' reason: handle and delete those rows first (by hand, after reading them).

begin;

alter table public.unmatched_payment_events drop constraint if exists unmatched_payment_events_event_type_check;
alter table public.unmatched_payment_events add constraint unmatched_payment_events_event_type_check
  check (event_type in ('order_paid', 'order_refunded', 'order_disputed'));

alter table public.unmatched_payment_events drop constraint if exists unmatched_payment_events_reason_check;
alter table public.unmatched_payment_events add constraint unmatched_payment_events_reason_check
  check (reason in (
    'no_matching_user', 'invalid_metadata_signature', 'unknown_product', 'invalid_amount',
    'invalid_currency', 'invalid_data', 'refund_unknown_order', 'dispute_unknown_order',
    'paid_after_refund_or_dispute'));

alter table if exists public.subscriptions drop column if exists last_event_at;

commit;
