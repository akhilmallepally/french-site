-- supabase/tests/access-over-time.sql
-- Access over time (docs/plans/subscription.md, rollout step 3): public.has_access() (0010) through
-- a subscription's life, with an injected clock (has_access's p_now; the app never sends one, so in
-- production the database's own clock decides). Each status change is written the way the payment
-- webhook (lib/payments/webhook.ts) writes it; test:webhook covers the events that lead to them.
-- The checks run as the authenticated role with each learner's own claims, as the app's session
-- client does. Run by npm run test:sql (PGlite) after the migrations; it also runs in the Supabase
-- SQL editor after 0001 to 0011. One transaction ending in ROLLBACK: it leaves nothing behind.
--
-- Output: one "PASS: ..." notice per check; any other outcome stops with "FAIL: ...". The last
-- notice is "PASS: ALL ACCESS-OVER-TIME CHECKS PASSED".
--
-- The clock starts at T = 2027-03-01 12:00 UTC (after the founding offer, when yearly plans sell).
-- Learners (all made up, example.invalid):
--   L1 lifetime only        L2 one subscription, its whole life     L3 refunded
--   L4 disputed, won, lost  L5 lifetime plus a subscription          L6 two subscriptions
--   L7 nothing at all

begin;

create schema access_test;

-- T plus an offset: the injected clock.
create function access_test.t(offset_by interval) returns timestamptz language sql immutable as $$
  select '2027-03-01T12:00:00Z'::timestamptz + offset_by;
$$;

-- has_access(product, T + offset) for learner uid, as that learner, expected true or false.
create function access_test.expect(label text, uid uuid, offset_by interval, expected boolean, product text default 'lessons')
returns void language plpgsql security invoker as $$
declare
  got boolean;
begin
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  got := public.has_access(product, access_test.t(offset_by));
  if got is distinct from expected then
    raise exception 'FAIL: % (T + %) has_access was %, expected %', label, offset_by, got, expected;
  end if;
  raise notice 'PASS: % (T + %) -> %', label, offset_by, got;
end;
$$;

-- The learner's own rows in a table, read as that learner (under RLS).
create function access_test.expect_own_rows(label text, uid uuid, tbl text, n int)
returns void language plpgsql security invoker as $$
declare
  got int;
begin
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute format('select count(*) from public.%I', tbl) into got;
  if got <> n then
    raise exception 'FAIL: % read % %s rows, expected %', label, got, tbl, n;
  end if;
  raise notice 'PASS: % -> % % rows', label, got, tbl;
end;
$$;

grant usage on schema access_test to authenticated;
grant execute on all functions in schema access_test to authenticated;

-- ===================================================================== learners (as postgres)
insert into auth.users (id, email, aud, role)
select ('a0000000-0000-4000-8000-00000000000' || n)::uuid, 'access-test-' || n || '@example.invalid', 'authenticated', 'authenticated'
  from generate_series(1, 7) as n;

-- L1 and L5 bought lifetime access.
insert into public.purchases (user_id, product, status, provider, provider_order_id, amount, currency)
values ('a0000000-0000-4000-8000-000000000001', 'lessons', 'active', 'dodo', 'pay_access_l1', 800, 'usd'),
       ('a0000000-0000-4000-8000-000000000005', 'lessons', 'active', 'dodo', 'pay_access_l5', 800, 'usd');

-- Subscriptions as subscription.active writes them: active, the period end a year on.
insert into public.subscriptions (user_id, product, provider, provider_subscription_id, provider_customer_id, status, current_period_end, last_event_at)
values ('a0000000-0000-4000-8000-000000000002', 'lessons', 'dodo', 'sub_access_l2', 'cus_l2', 'active', access_test.t('365 days'), access_test.t('0 seconds')),
       ('a0000000-0000-4000-8000-000000000003', 'lessons', 'dodo', 'sub_access_l3', 'cus_l3', 'active', access_test.t('365 days'), access_test.t('0 seconds')),
       ('a0000000-0000-4000-8000-000000000004', 'lessons', 'dodo', 'sub_access_l4', 'cus_l4', 'active', access_test.t('365 days'), access_test.t('0 seconds')),
       ('a0000000-0000-4000-8000-000000000005', 'lessons', 'dodo', 'sub_access_l5', 'cus_l5', 'active', access_test.t('365 days'), access_test.t('0 seconds')),
       ('a0000000-0000-4000-8000-000000000006', 'lessons', 'dodo', 'sub_access_l6a', 'cus_l6', 'active', access_test.t('100 days'), access_test.t('0 seconds')),
       ('a0000000-0000-4000-8000-000000000006', 'lessons', 'dodo', 'sub_access_l6b', 'cus_l6', 'active', access_test.t('365 days'), access_test.t('0 seconds'));
-- Their first payments (payment.succeeded with a subscription_id).
insert into public.subscription_payments (subscription_id, user_id, provider_payment_id, charge_type, status, amount)
select s.id, s.user_id, 'pay_' || s.provider_subscription_id, 'new', 'succeeded', 1200 from public.subscriptions as s
 where s.provider_subscription_id like 'sub_access_%';

-- L2's progress and review cards, written before anything happens to the subscription.
insert into public.lesson_progress (user_id, lesson_id, status, best_score, best_total, last_run_at, completed_at)
values ('a0000000-0000-4000-8000-000000000002', 'b1-access-lesson', 'completed', 9, 10, now() - interval '1 day', now() - interval '1 day');
insert into public.review_cards (user_id, card_id, lesson_id, box, due_at, last_reviewed_at, review_count)
values ('a0000000-0000-4000-8000-000000000002', 'b1-access-lesson-v001', 'b1-access-lesson', 2, now() + interval '3 days', now() - interval '1 day', 2),
       ('a0000000-0000-4000-8000-000000000002', 'a1-access-lesson-v001', 'a1-access-lesson', 1, now() + interval '1 day', now() - interval '1 day', 1);

-- ===================================================================== L1: lifetime only
set local role authenticated;
select access_test.expect('L1 lifetime, now', 'a0000000-0000-4000-8000-000000000001', '0 seconds', true);
select access_test.expect('L1 lifetime, ten years on', 'a0000000-0000-4000-8000-000000000001', '3650 days', true);
select access_test.expect('L1 lifetime, another product', 'a0000000-0000-4000-8000-000000000001', '0 seconds', false, 'pro');
select access_test.expect('L7 nothing at all', 'a0000000-0000-4000-8000-000000000007', '0 seconds', false);
reset role;

-- ===================================================================== L2: active, then the grace
set local role authenticated;
select access_test.expect('L2 active, the day it starts', 'a0000000-0000-4000-8000-000000000002', '0 seconds', true);
select access_test.expect('L2 active, a second before the period end', 'a0000000-0000-4000-8000-000000000002', '365 days - 1 second', true);
select access_test.expect('L2 active, 6 days 23 hours after the period end (grace)', 'a0000000-0000-4000-8000-000000000002', '371 days 23 hours', true);
select access_test.expect('L2 active, exactly 7 days after the period end (grace over)', 'a0000000-0000-4000-8000-000000000002', '372 days', false);
select access_test.expect('L2 active, a month after the period end', 'a0000000-0000-4000-8000-000000000002', '395 days', false);
select access_test.expect('L2''s subscription gives L7 nothing', 'a0000000-0000-4000-8000-000000000007', '0 seconds', false);
reset role;

-- Renewed (subscription.renewed): still active, the period end a year later.
update public.subscriptions set status = 'active', cancelled_at = null, current_period_end = access_test.t('730 days'), last_event_at = access_test.t('365 days')
 where provider_subscription_id = 'sub_access_l2';
set local role authenticated;
select access_test.expect('L2 renewed, 8 days after the old period end', 'a0000000-0000-4000-8000-000000000002', '373 days', true);
select access_test.expect('L2 renewed, a second before the new period end', 'a0000000-0000-4000-8000-000000000002', '730 days - 1 second', true);
select access_test.expect('L2 renewed, 7 days after the new period end', 'a0000000-0000-4000-8000-000000000002', '737 days', false);
reset role;

-- The next renewal fails (subscription.past_due): the same 7-day grace past the period end.
update public.subscriptions set status = 'past_due', last_event_at = access_test.t('730 days') where provider_subscription_id = 'sub_access_l2';
set local role authenticated;
select access_test.expect('L2 past_due, at the period end', 'a0000000-0000-4000-8000-000000000002', '730 days', true);
select access_test.expect('L2 past_due, 3 days into the grace', 'a0000000-0000-4000-8000-000000000002', '733 days', true);
select access_test.expect('L2 past_due, a second before the grace ends', 'a0000000-0000-4000-8000-000000000002', '737 days - 1 second', true);
select access_test.expect('L2 past_due, after the grace', 'a0000000-0000-4000-8000-000000000002', '737 days 1 second', false);
reset role;

-- The grace runs out (subscription.on_hold): no access at once, even at a time inside the period.
update public.subscriptions set status = 'on_hold', last_event_at = access_test.t('737 days') where provider_subscription_id = 'sub_access_l2';
set local role authenticated;
select access_test.expect('L2 on_hold, inside the old period', 'a0000000-0000-4000-8000-000000000002', '700 days', false);
select access_test.expect('L2 on_hold, after the grace', 'a0000000-0000-4000-8000-000000000002', '740 days', false);
select access_test.expect_own_rows('L2 on hold keeps the progress', 'a0000000-0000-4000-8000-000000000002', 'lesson_progress', 1);
select access_test.expect_own_rows('L2 on hold keeps the review cards', 'a0000000-0000-4000-8000-000000000002', 'review_cards', 2);
reset role;

-- A new card pays (subscription.renewed after on hold): access is back, from the new period.
update public.subscriptions set status = 'active', cancelled_at = null, current_period_end = access_test.t('1105 days'), last_event_at = access_test.t('740 days')
 where provider_subscription_id = 'sub_access_l2';
insert into public.subscription_payments (subscription_id, user_id, provider_payment_id, charge_type, status, amount)
select s.id, s.user_id, 'pay_access_l2_renewal', 'renewal', 'succeeded', 1200 from public.subscriptions as s where s.provider_subscription_id = 'sub_access_l2';
set local role authenticated;
select access_test.expect('L2 back after paying', 'a0000000-0000-4000-8000-000000000002', '740 days', true);
select access_test.expect_own_rows('L2 back: the same progress', 'a0000000-0000-4000-8000-000000000002', 'lesson_progress', 1);
select access_test.expect_own_rows('L2 back: the same review cards', 'a0000000-0000-4000-8000-000000000002', 'review_cards', 2);
reset role;

-- Cancelled at the period end (subscription.cancelled after cancel_at_next_billing_date): access to
-- the end of the paid year, and no grace after it.
update public.subscriptions set status = 'cancelled', cancel_at_period_end = true, cancelled_at = access_test.t('800 days'), last_event_at = access_test.t('800 days')
 where provider_subscription_id = 'sub_access_l2';
set local role authenticated;
select access_test.expect('L2 cancelled at the period end, the day after cancelling', 'a0000000-0000-4000-8000-000000000002', '801 days', true);
select access_test.expect('L2 cancelled at the period end, a second before it', 'a0000000-0000-4000-8000-000000000002', '1105 days - 1 second', true);
select access_test.expect('L2 cancelled at the period end, at the period end', 'a0000000-0000-4000-8000-000000000002', '1105 days', false);
select access_test.expect('L2 cancelled at the period end, 3 days after (no grace)', 'a0000000-0000-4000-8000-000000000002', '1108 days', false);
reset role;

-- Expired (subscription.expired): no access.
update public.subscriptions set status = 'expired', last_event_at = access_test.t('1105 days') where provider_subscription_id = 'sub_access_l2';
set local role authenticated;
select access_test.expect('L2 expired, a time inside the old period', 'a0000000-0000-4000-8000-000000000002', '1000 days', false);
select access_test.expect('L2 expired, after the period', 'a0000000-0000-4000-8000-000000000002', '1110 days', false);
select access_test.expect_own_rows('L2 expired keeps the progress', 'a0000000-0000-4000-8000-000000000002', 'lesson_progress', 1);
select access_test.expect_own_rows('L2 expired keeps the review cards', 'a0000000-0000-4000-8000-000000000002', 'review_cards', 2);
reset role;

-- ===================================================================== L3: refunded
-- refund.succeeded for the subscription's payment: the payment and the subscription are refunded.
update public.subscription_payments set status = 'refunded', refunded_at = access_test.t('10 days') where provider_payment_id = 'pay_sub_access_l3';
update public.subscriptions set status = 'refunded', last_event_at = access_test.t('10 days') where provider_subscription_id = 'sub_access_l3';
set local role authenticated;
select access_test.expect('L3 refunded, at once (inside the period)', 'a0000000-0000-4000-8000-000000000003', '10 days', false);
select access_test.expect('L3 refunded, inside the grace window too', 'a0000000-0000-4000-8000-000000000003', '368 days', false);
reset role;

-- ===================================================================== L4: disputed, won, lost
update public.subscription_payments set status = 'disputed' where provider_payment_id = 'pay_sub_access_l4';
update public.subscriptions set status = 'disputed', last_event_at = access_test.t('20 days') where provider_subscription_id = 'sub_access_l4';
set local role authenticated;
select access_test.expect('L4 disputed (dispute.opened)', 'a0000000-0000-4000-8000-000000000004', '20 days', false);
reset role;
-- dispute.won: the payment stands, the subscription is active again.
update public.subscription_payments set status = 'succeeded' where provider_payment_id = 'pay_sub_access_l4';
update public.subscriptions set status = 'active', cancelled_at = null, last_event_at = access_test.t('40 days') where provider_subscription_id = 'sub_access_l4';
set local role authenticated;
select access_test.expect('L4 dispute won: access back', 'a0000000-0000-4000-8000-000000000004', '40 days', true);
select access_test.expect('L4 dispute won: the usual grace after the period end', 'a0000000-0000-4000-8000-000000000004', '371 days', true);
reset role;
-- A second dispute, lost (dispute.lost changes nothing: it stays disputed).
update public.subscription_payments set status = 'disputed' where provider_payment_id = 'pay_sub_access_l4';
update public.subscriptions set status = 'disputed', last_event_at = access_test.t('60 days') where provider_subscription_id = 'sub_access_l4';
set local role authenticated;
select access_test.expect('L4 disputed again, then lost', 'a0000000-0000-4000-8000-000000000004', '90 days', false);
reset role;

-- ===================================================================== L5: lifetime plus a subscription
update public.subscriptions set status = 'expired', last_event_at = access_test.t('365 days') where provider_subscription_id = 'sub_access_l5';
set local role authenticated;
select access_test.expect('L5 subscription expired, lifetime stays', 'a0000000-0000-4000-8000-000000000005', '400 days', true);
reset role;
update public.subscriptions set status = 'refunded' where provider_subscription_id = 'sub_access_l5';
set local role authenticated;
select access_test.expect('L5 subscription refunded, lifetime stays', 'a0000000-0000-4000-8000-000000000005', '400 days', true);
reset role;
update public.subscriptions set status = 'active', current_period_end = access_test.t('730 days') where provider_subscription_id = 'sub_access_l5';
update public.purchases set status = 'refunded', refunded_at = access_test.t('400 days') where provider_order_id = 'pay_access_l5';
set local role authenticated;
select access_test.expect('L5 lifetime refunded, the subscription still counts', 'a0000000-0000-4000-8000-000000000005', '400 days', true);
select access_test.expect('L5 lifetime refunded, after the subscription and its grace', 'a0000000-0000-4000-8000-000000000005', '737 days', false);
reset role;

-- ===================================================================== L6: two subscriptions (two tabs)
set local role authenticated;
select access_test.expect('L6 two active, after the first one''s period and grace', 'a0000000-0000-4000-8000-000000000006', '200 days', true);
reset role;
-- The duplicate is refunded: only that one ends.
update public.subscription_payments set status = 'refunded', refunded_at = access_test.t('5 days') where provider_payment_id = 'pay_sub_access_l6b';
update public.subscriptions set status = 'refunded', last_event_at = access_test.t('5 days') where provider_subscription_id = 'sub_access_l6b';
set local role authenticated;
select access_test.expect('L6 duplicate refunded, the other still counts', 'a0000000-0000-4000-8000-000000000006', '50 days', true);
select access_test.expect('L6 duplicate refunded, after the other''s period and grace', 'a0000000-0000-4000-8000-000000000006', '107 days', false);
reset role;
-- The remaining one is cancelled at its period end.
update public.subscriptions set status = 'cancelled', cancel_at_period_end = true, cancelled_at = access_test.t('60 days') where provider_subscription_id = 'sub_access_l6a';
set local role authenticated;
select access_test.expect('L6 the other cancelled at the period end, before it', 'a0000000-0000-4000-8000-000000000006', '99 days', true);
select access_test.expect('L6 the other cancelled at the period end, after it', 'a0000000-0000-4000-8000-000000000006', '100 days', false);
reset role;

do $$
begin
  raise notice 'PASS: ALL ACCESS-OVER-TIME CHECKS PASSED';
end;
$$;

rollback;
