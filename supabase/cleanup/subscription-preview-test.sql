-- supabase/cleanup/subscription-preview-test.sql
-- After the subscription preview test (docs/plans/subscription.md, section 10): removes the SECOND
-- test account's subscriptions and subscription payments, and nothing else. Its progress, review
-- cards and account stay (delete the user in Authentication to remove those too). The lifetime test
-- account (gmailprogresstest@gmail.com) is never touched. Paste the whole file into the Supabase SQL
-- editor and click Run; the last result shows 0 and 0.

begin;

delete from public.subscription_payments
 where user_id in (select u.id from auth.users as u where lower(u.email) = lower('gmailprogresstest+subscription@gmail.com'));

delete from public.subscriptions
 where user_id in (select u.id from auth.users as u where lower(u.email) = lower('gmailprogresstest+subscription@gmail.com'));

commit;

select
  (select count(*) from public.subscriptions as s join auth.users as u on u.id = s.user_id
    where lower(u.email) = lower('gmailprogresstest+subscription@gmail.com')) as subscriptions_left,
  (select count(*) from public.subscription_payments as p join auth.users as u on u.id = p.user_id
    where lower(u.email) = lower('gmailprogresstest+subscription@gmail.com')) as payments_left;
