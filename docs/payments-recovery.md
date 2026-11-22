# Payments: recovering a webhook

What to do when a purchase didn't unlock B1 to C2: resend the payment event from Dodo, then check that the purchase row and the access appeared. All SQL below runs in the Supabase **SQL Editor** (as the project owner, which bypasses RLS).

## Before anything: is 0007 in?

The webhook's service-role client needs the grants in `supabase/migrations/0007_service_role_grants.sql`. Without them every delivery fails with HTTP 500 and "permission denied for table purchases" (as on 19 and 20 Nov). Check:

```sql
select has_table_privilege('service_role', 'public.purchases', 'INSERT') as can_insert,
       to_regclass('public.unmatched_payment_events') is not null as has_0007;
```

Both should be `true`. If not, run 0007 (docs/db-setup.md, section 1), then `supabase/tests/rls.sql`.

## What the webhook does with each event

- **payment.succeeded**
  - **Resend:** if a purchase with this payment id already exists, nothing changes. A resend never creates a second row and never turns a refunded or disputed purchase back to active.
  - **Matching the buyer:** first by the user id in the checkout metadata (its signature is checked when present). If that's missing, malformed, wrongly signed or names a deleted account, it falls back to the buyer's email, compared without regard to case. A match creates an `active` purchase, and access starts at once.
  - **No match:** the event is recorded in `public.unmatched_payment_events` and the webhook answers 200, so Dodo stops retrying. You then grant access by hand (below).
  - **Data that can't be stored** (an unknown product, a bad amount or currency, a value the database refuses): recorded the same way, with its reason.
- **refund.succeeded** (and payment.refunded)
  - **Refund policy:** B1 to C2 purchases are final and non-refundable, because A1 and A2 are free to try first (see /refund). A refund happens only when you issue one by hand in Dodo for the exceptions /refund names, such as a duplicate charge.
  - The purchase becomes `refunded` with `refunded_at` set, and access ends. Any refund does this, partial or full, but only for that payment: refunding a duplicate charge leaves the other purchase active.
  - If the refund arrives before the payment event, it records a refunded row (when the metadata names a user) or an unmatched event (`refund_unknown_order`). Either way, the later payment event grants nothing.
- **dispute.opened**
  - The purchase becomes `disputed` and access is suspended (only `active` grants access). A purchase already refunded stays refunded.
  - Nothing restores access when a dispute is won: no other dispute event is handled. Restore it by hand (step 5).
  - A dispute for an unknown order is recorded as `dispute_unknown_order`.
- **The webhook answers 500 only for errors worth retrying:** a connection problem, a Supabase outage, or a configuration error such as a missing grant. Dodo then retries. A bad signature or a stale timestamp gets 401.

## 1. Find the payment

You need the **payment id** (it starts with `pay_`). It's on the payment in the Dodo dashboard (Payments, or Transactions), and it's the purchase's `provider_order_id`.

Check whether the webhook already recorded it:

```sql
select id, user_id, status, amount, currency, created_at, refunded_at
  from public.purchases where provider_order_id = 'pay_XXXX';

select provider_order_id, event_type, event_id, reason, received_at, resolved_at
  from public.unmatched_payment_events where provider_order_id = 'pay_XXXX';
```

- A purchase row with status `active`: the purchase is fine. If the learner still can't open B1, they're probably signed in with another Google account; see step 3.
- A row in `unmatched_payment_events`: the webhook ran but couldn't match the buyer. Don't resend; it would be recorded again as the same row. Go to step 4.
- Neither: the event never got through (for example the 500s of 19 and 20 Nov). Resend it (step 2).

The webhook's logs are in **Vercel → the project → Logs**; filter on `[payments:webhook]` or `[payments:route]`. They name the order id, the outcome and the reason, never an email.

## 2. Resend the event from Dodo

1. In the Dodo dashboard, open the **Developer** (or **Webhooks**) section and the webhook endpoint for this site (`…/api/webhooks/payments`).
2. Find the delivery for the payment, the `payment.succeeded` event with this payment id. Failed deliveries show their HTTP status (500 for the November failures).
3. Use **Resend** (or **Retry**) on that delivery. Menu names in Dodo may differ slightly; the action resends the same event to the endpoint.
4. The new delivery should show **200**. Its response body says what happened, for example `{"received":true,"outcome":"granted"}`, `"idempotent_no_op"` (already recorded) or `"unmatched_recorded"` with a `reason`.
5. A 401 means the signature or timestamp was refused. Check that `PAYMENTS_WEBHOOK_SECRET` in Vercel matches the endpoint's secret in Dodo. A 500 means a retryable error; the Vercel logs give the cause.

## 3. Check the purchase and the access

```sql
-- The purchase row: one row, status active.
select p.id, p.status, p.product, p.amount, p.created_at, u.email
  from public.purchases p join auth.users u on u.id = p.user_id
 where p.provider_order_id = 'pay_XXXX';

-- The same test the site uses for access (lib/purchases.ts: hasActiveEntitlement).
select exists (
  select 1 from public.purchases
   where user_id = '<user id>' and product = 'lessons' and status = 'active'
) as has_access;
```

Then sign in on the site with the buyer's Google account (or ask the buyer to). A B1 lesson should open, and `/pricing` should say you already have access. If the row is right but the page still shows the paywall, sign out and in again so the session is fresh.

## 4. Grant access by hand (unmatched events)

1. Find the buyer's email in Dodo from the payment id. Find their account in **Authentication → Users**; they must have signed in at least once.
2. Insert the purchase with the real amount and currency from Dodo:

   ```sql
   insert into public.purchases (user_id, product, status, provider, provider_order_id, amount, currency)
   values ('<user id>', 'lessons', 'active', 'dodo', 'pay_XXXX', 800, 'usd');

   update public.unmatched_payment_events
      set resolved_at = now()
    where provider_order_id = 'pay_XXXX' and resolved_at is null;
   ```

3. Run the checks in step 3.

For `paid_after_refund_or_dispute`, check in Dodo whether the payment was really refunded or disputed before granting anything. For `refund_unknown_order` and `dispute_unknown_order` with no later payment, there's nothing to revoke; mark them resolved.

To see everything still open:

```sql
select provider_order_id, event_type, reason, event_id, received_at
  from public.unmatched_payment_events
 where resolved_at is null
 order by received_at desc;
```

## 5. Restore access after a dispute is won

The webhook suspends access when a dispute opens (`status = 'disputed'`) and does nothing when it closes. When Dodo shows the dispute as won (decided in your favour), set the purchase back to active:

```sql
update public.purchases
   set status = 'active'
 where provider_order_id = 'pay_XXXX'
   and status = 'disputed';
```

It should report `UPDATE 1`. Then run the checks in step 3. Access returns at the learner's next page load. If the dispute is lost, leave the row as `disputed`: access stays suspended. If Dodo also reports it as a refund, the refund event sets it to `refunded`.
