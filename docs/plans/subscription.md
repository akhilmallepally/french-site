# Subscription plan (Pricing v2, Part B)

Status: step 1 (0010) has run in Supabase. Step 2 (the subscription webhooks, with 0011) is built (Prompt 78); 0011 waits for the owner to run it. Steps 3 to 6 are next. The owner's decisions are in section 8.

Decisions already made (owner, Prompt 76):
- The founding offer ($8 once, lifetime access) ends at 2026-12-31T16:59:00Z (23:59 in Bangkok), or earlier when the 100 founder spots are gone.
- After that, new buyers get only a subscription: $12 a year, renewing yearly until cancelled.
- Lifetime holders keep access forever. A1 and A2 stay free. The daily review is for learners with access.

**The subscription must ship before the founding offer ends.** Part A switches the pricing card to "New plan coming soon" with checkout off at the deadline, or as soon as the spots run out. 99 spots were left on 26 November 2026, so the switch could come earlier than 31 December. Until the subscription exists, nobody can buy anything after the switch.

## 1. What Dodo offers (docs.dodopayments.com, read 26 November 2026)

Sources:
- https://docs.dodopayments.com/features/subscription
- https://docs.dodopayments.com/api-reference/checkout-sessions/create.md
- https://docs.dodopayments.com/api-reference/customers/create-customer-portal-session.md
- https://docs.dodopayments.com/api-reference/subscriptions/patch-subscriptions.md
- https://docs.dodopayments.com/developer-resources/webhooks/intents/webhook-events-guide.md
- https://docs.dodopayments.com/features/recovery/payment-retries.md
- https://docs.dodopayments.com/features/communication-preferences.md
- https://docs.dodopayments.com/miscellaneous/testing-process.md

**The product:** a subscription product with a recurring price. Its fields:
- `price: 1200`, `payment_frequency_count: 1`, `payment_frequency_interval: "Year"`.
- `subscription_period_count: 20`, `subscription_period_interval: "Year"`. The period sets when a subscription expires, not how often it charges. Dodo recommends 20 years, its maximum, for "renews until cancelled". A period equal to the frequency would charge once and expire.
- No trial (`trial_period_days: 0`).

**The price per checkout can't be overridden** for a subscription product: `product_cart[].amount` is for pay-what-you-want one-time products only.
- So the yearly price lives in Dodo's product.
- Our `pricing_settings` gets a matching `subscription_price_cents`, used for display and the price-changed check. Step 2 checks the two agree.
- Editing the product's price changes only new subscriptions ("existing subscriptions are never repriced").

**Checkout:** `POST /checkouts` (checkout sessions; `POST /subscriptions` is deprecated).
- The same call we use now: `product_cart: [{ product_id, quantity: 1 }]`, `customer: { email }`, `metadata` (our signed `user_id`, `product`, `metadata_signature`) and `return_url`.
- It returns `session_id` and `checkout_url`. Sessions expire after 24 hours by default.
- On return, the redirect URL gets `subscription_id` and `status`.

**Customer portal:** `POST /customers/{customer_id}/customer-portal/session`.
- Options: `send_email` and `return_url`. It returns `{ link }`, valid for 24 hours.
- In the portal, customers can "Cancel at next billing date" or "Cancel now", both allowed by default and switchable in the dashboard.
- Through the API, `PATCH /subscriptions/{id}` with `cancel_at_next_billing_date: true` cancels at period end, and `status: "cancelled"` cancels at once.

**Webhook events** (Standard Webhooks: headers `webhook-id`, `webhook-signature` (`v1,<base64>` HMAC-SHA256) and `webhook-timestamp`; the signing secret starts `whsec_`; up to 8 delivery attempts):
- Envelope: `{ business_id, type, timestamp, data }`, where `data.payload_type` is `Subscription`, `Payment`, `Refund` or `Dispute`.
- Subscription events: `subscription.active`, `subscription.updated`, `subscription.past_due`, `subscription.on_hold`, `subscription.paused`, `subscription.unpaused`, `subscription.renewed` (has `payment_id`), `subscription.plan_changed`, `subscription.update_payment_method`, `subscription.cancelled`, `subscription.failed` (only when creation fails) and `subscription.expired`.
- Payment events: `payment.succeeded`, `payment.failed`, `payment.processing` and `payment.cancelled`. The Payment object has `subscription_id` and `charge_type` (`new`, `renewal`, `plan_change`, `on_demand`).
- Refunds: `refund.succeeded` and `refund.failed`. Disputes: `dispute.opened`, `.challenged`, `.accepted`, `.cancelled`, `.expired`, `.won` and `.lost`.
- Subscription fields (from the API object; the webhook page didn't render its schema, see open question 1): `subscription_id`, `status`, `product_id`, `customer { customer_id, email, name }`, `metadata`, `next_billing_date`, `previous_billing_date`, `cancel_at_next_billing_date`, `cancelled_at`, `expires_at`, `recurring_pre_tax_amount`, `currency`, `payment_frequency_interval` and `_count`.
- Status values: `pending`, `active`, `on_hold`, `paused`, `cancelled`, `failed`, `expired` and `past_due`.

**Failed renewals:**
- With no grace period, a failed renewal goes to `on_hold` and access should end.
- With Dodo's "Subscription Grace Period" on (1 to 30 days, default 3), it's `past_due` first (`subscription.past_due`, with `past_due_ends_at`), then `on_hold` or cancelled.
- Payment Retries (off by default) retry soft declines on a schedule within a recovery window.
- A successful retry or a new card brings the subscription back to `active` (`subscription.active`).

**Emails from Dodo** (on by default): receipts (Payment Succeeded), Upcoming Renewal Reminder (7 days before), Subscription Set to Cancel, Subscription Cancelled, Refund Successful and Plan Changed. Payment Failed and Subscription Renewal Failed are off by default and can be switched on. We send no emails ourselves.

**Test mode:**
- Hosts: `test.dodopayments.com`, and test keys `dodo_test_…`.
- Cards (06/32, CVV 123): 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined, and 4000 0000 0000 0341 succeeds at checkout and fails at renewal.
- To trigger a renewal sooner, `PATCH /subscriptions/{id}` with a near `next_billing_date`.

## 2. Events we need, and what each does

| Event | Our action |
|---|---|
| `subscription.active` | Upsert the subscription: status `active`, `current_period_end = next_billing_date`, the user from our signed metadata (else the email, as now). Also handles a recovery from `on_hold`. |
| `subscription.renewed` | `current_period_end = next_billing_date`, status `active`. |
| `subscription.updated` | Copy `cancel_at_next_billing_date` and `next_billing_date` (a cancellation set or undone). |
| `subscription.past_due` | Status `past_due`. Access continues until the grace ends. |
| `subscription.on_hold` | Status `on_hold`: access ends, the rows stay. |
| `subscription.cancelled` | Status `cancelled`, `cancelled_at`. Access runs to `current_period_end` when it was set to cancel at the period end; it ends at once for an immediate cancel. |
| `subscription.expired` | Status `expired`: access ends. |
| `payment.succeeded` with `subscription_id` | Record the payment against the subscription (for duplicate detection and refunds). A `payment.succeeded` without one stays the one-time lifetime flow. |
| `payment.failed` | Log only (the subscription events change access). |
| `refund.succeeded` | For a subscription payment, end access at once (status `refunded`). Lifetime refunds stay as now. |
| `dispute.opened` | As now: access ends while disputed. `dispute.won` restores it; `dispute.lost` keeps it ended. |
| `subscription.failed`, `subscription.paused`, `subscription.unpaused`, `subscription.plan_changed`, `subscription.update_payment_method` | Logged and ignored (we offer one plan and no pausing). |

Unknown events keep being answered 2xx and recorded as ignored, as now.

## 3. Data

A new table, `subscriptions` (migration 0010), rather than more columns on `purchases`, because a subscription changes over time while a purchase doesn't:
- Columns:
  - `id`, `user_id` (→ auth.users, cascade), `product`
  - `provider` and `provider_subscription_id` (unique)
  - `provider_customer_id` (for the portal link)
  - `status` (`active`, `past_due`, `on_hold`, `cancelled`, `expired`, `refunded`, `disputed`)
  - `current_period_end` (timestamptz), `cancel_at_period_end` (bool), `cancelled_at`
  - `created_at`, `updated_at`
- `subscription_payments (provider_payment_id unique, subscription id, amount, status)`, for refunds and duplicate charges.
- **RLS, as for purchases:** a learner reads their own rows. Only the webhook's service role writes, through 0007-style exact grants. rls.sql is extended.
- **Entitlement** (one function, used by every access check: lessons, review, the banner, checkout's "already has access"). Access when either holds:
  - an active lifetime purchase (as now: at least one, duplicates fine); or
  - a subscription with status `active` or `past_due` and `now < current_period_end + 7 days` (the grace, recommendation below); or
  - a `cancelled` subscription that was set to cancel at the period end and `now < current_period_end`.
- **Duplicate-charge safety (as Prompt 67):**
  - Any one entitling row is enough.
  - A second subscription by the same learner (two tabs) is allowed to exist, and the refund path ends only the refunded one.
  - Checkout refuses to start a subscription for a learner who already has access (as now for lifetime).
- **The grace period, a recommendation:** turn on Dodo's subscription grace period at 7 days and Payment Retries (standard schedule). Our entitlement adds the same 7 days past `current_period_end`, so a late webhook or a retry in progress never locks a paying learner out early. After that, `on_hold` or `expired` ends access.

## 4. Rules

- **Cancelling** keeps access to the end of the paid period. We recommend switching off "Allow Immediate Cancellation" in the portal, so a cancellation always runs to the period end. It matches the no-refund policy.
- **A refund** (the existing exceptions only: duplicate charges or where the law requires) ends access at once.
- **A failed renewal** gets the 7-day grace, then access ends. Paying (a retry or a new card) brings it back, and the review cards and progress are untouched throughout.
- **Lifetime holders never see a subscription offer:** the pricing card shows "You have lifetime access", and checkout refuses.
- **Founder offer and subscription never overlap:** before the switch, only the founder offer can be bought; after it, only the subscription. The switch is the same rule as now (`spots > 0 AND now < founder_ends_at`), worked out per request.

## 5. UI

- **Pricing card after the switch:**
  - The ended founding offer becomes "Yearly access".
  - "$12 a year", with "Renews yearly until you cancel. Cancel any time; access runs to the end of the paid year."
  - What's included: B1–C2, future lessons, and the daily review.
  - The button: "Subscribe for $12 a year".
  - The countdown and banner disappear (Part A already does this).
- **Paywall and sign-in panel:** the same price line and button.
- **Manage subscription:** a small "Your access" box on /progress for subscribers, with the renewal or end date and a "Manage subscription" button.
  - The button calls a server action that creates a portal session (`send_email: false`, `return_url: /progress`) and redirects to its `link`.
  - Lifetime holders see "Lifetime access" with no button.
- **Emails:** Dodo's defaults (receipt, renewal reminder 7 days before, cancellation notices). Switch on "Subscription Renewal Failed" so learners hear about a failed card.

## 6. Pages

- **Terms:** a "Yearly subscription" section.
  - The price, and that it renews automatically each year until cancelled.
  - How to cancel (Manage subscription, or the link in Dodo's emails) and what cancelling does (access to the end of the paid year).
  - Failed payments (the 7-day grace, then access pauses until payment).
  - Price changes apply to new subscriptions only, and existing ones aren't repriced without notice.
  - Lifetime access stays as now.
- **Refund policy:** subscription payments follow the same "final" rule with the same exceptions, a refund ends access at once, and cancellation is not a refund.
- **Privacy:** that we store the subscription's status, period end and the provider's customer and subscription ids (no card data), and that Dodo sends the emails.
- **Auto-renewal disclosure** next to the subscribe button: "Renews automatically at $12 a year until you cancel." The renewal reminder email is Dodo's.

## 7. Rollout (one prompt each, finishing by 20 December 2026, well before the deadline)

1. **Migration 0010:** `subscriptions` and `subscription_payments` with RLS, exact grants, the entitlement function, the rollback and rls.sql. The owner runs it.
   - **As built (Prompt 77):** supabase/migrations/0010_subscriptions.sql.
     - `subscriptions` columns: provider ids (unique), status, `current_period_end`, `cancel_at_period_end`, `cancelled_at` (required when cancelled).
     - `subscription_payments` columns: `provider_payment_id` (unique), `charge_type` new or renewal, status, amount, `refunded_at`.
     - RLS forced: learners read their own rows; service_role (the webhook) has select, insert and update, no delete; anon has nothing.
     - `has_access(p_product, p_now)`: security invoker, empty search_path, authenticated only. It's true for an active lifetime purchase, an active or past_due subscription until `current_period_end` + 7 days, or a cancelled-at-period-end one until `current_period_end`. `p_now` lets tests move the clock.
     - Also supabase/rollback/0010_subscriptions.sql, rollback_all (0001 to 0010), and rls.sql (402 checks in all, user D's states over time included).
     - The whole chain (0001 to 0010, each run twice, then rls.sql) passes in real Postgres (PGlite) with Supabase's auth schema and roles stood in. Running it found that 0005's seed failed on a re-run after 0009; the seed now inserts only when the row is missing.
2. **Dodo setup and webhooks:**
   - **As built (Prompt 78):**
     - **Dodo setup (owner, test mode):** product `pdt_0NsnLuCUBOY030rpuYJ9l` ($12/year). Grace period 7 days, then On Hold. Immediate cancellation off, multiple subscriptions off, retries on with a 7-day window, customer emails set.
     - **Shapes confirmed** from Dodo's "Send example" payloads for all 13 events. They're committed with emails replaced in scripts/fixtures/dodo-webhook-examples.json; dodopayments.txt itself is git-ignored.
       - Refunds and disputes carry only `payment_id`, so they're matched through `subscription_payments`.
       - A dispute's `amount` is a string and a refund's a number (neither is used).
       - The example `subscription.renewed` has no `payment_id`, and `past_due` adds `past_due_ends_at`. Payments have no `charge_type`, so "new" or "renewal" comes from the payments already recorded.
       - They're generic samples (monthly, empty metadata). Real yearly ones with our signed metadata come in step 6.
     - **Migration 0011:** `subscriptions.last_event_at` (an older event never undoes a newer one), and `unmatched_payment_events` accepts `subscription_event` and `subscription_payment` and the reason `subscription_unknown`.
     - **Parser** (lib/payments/dodo.ts): the 7 subscription events, `payment.succeeded` with a `subscription_id` (a subscription charge; without one it stays the lifetime flow), `dispute.won`, `dispute.lost` (access stays ended) and `payment.failed` (logged only). The 5 unused subscription events are ignored.
     - **Processor** (lib/payments/webhook.ts):
       - Upserts keyed on the subscription id, with the product checked against `PAYMENTS_YEARLY_PRODUCT_ID` and the buyer from the signed metadata, else the email.
       - A refunded or disputed subscription is never undone by its own events.
       - Payments are recorded once, "new" then "renewal". A payment before its subscription is retried (HTTP 500).
       - Refunds and disputes of subscription charges end access at once; `dispute.won` restores a subscription or a lifetime purchase; a refund that arrived first is honoured.
     - **Tests:** test:webhook covers each example event, idempotency, out-of-order events and the refund and dispute paths.
   - Owner, in test mode: create the $12/year product (20-year period, no trial), set the grace period (7 days), switch on retries, switch off immediate cancellation.
   - Code: parse and handle the events in section 2. test:webhook covers each event and its payload (checked against the dashboard's "Send example" and a real test-mode delivery), idempotency, out-of-order events and the refund path.
3. **Entitlement over time:** every access check uses the new entitlement. Tests with an injected clock: active, renewed, past_due inside and after the grace, cancelled at period end before and after, refunded, disputed and won, lifetime plus subscription, and duplicate subscriptions.
4. **The switch:** the pricing card, paywall and sign-in panel after the deadline (and after the spots run out). Checkout creates the subscription checkout, with a price-changed check against `subscription_price_cents`. Tests use an injected clock across the deadline: an open page switches, and $8 is refused while $12/year is offered.
5. **Manage subscription and pages:** the /progress box, the portal action, and the terms, refund and privacy updates.
6. **Test-mode end to end, then production:**
   - test:progress-e2e buys a subscription in Dodo's test mode (4242 card), sees access, cancels at period end, and runs a failed renewal with the 0341 card via a near `next_billing_date`.
   - The production smoke plan: a real $12 purchase by the owner on a test account, the portal, then a refund through the dashboard. It's run by the owner, not by Claude.

## 8. Decisions (owner, Prompt 77)

1. **Webhook payloads:** confirm them from Dodo's test mode before step 2 is written (steps below).
2. **Grace period** for a failed renewal: 7 days.
3. **Cancellation** always runs to the end of the paid year; no "cancel now" (it fits the no-refund policy). Switch off "Allow Immediate Cancellation" in the portal settings.
4. **Price display:** $12 per year, shown the way $8 is shown today. If Dodo adds tax at checkout, add "plus tax where applicable" next to it.
5. **Ship by 20 December 2026**, whatever the spots do.

### Confirming the payloads in Dodo's test mode (owner's steps)

1. In the Dodo dashboard, switch to **Test mode** (the toggle at the top).
2. **Products → Create product:**
   - Name "French Properly, yearly", type **Subscription**, price **$12.00**.
   - **Repeat payment every 1 Year**, **Subscription period 20 Years**, trial **0** days.
   - Save, and copy the product id (`pdt_…`).
3. **Settings → Subscriptions:** switch on **Subscription Grace Period**, **7** days, with "on hold" after it. **Settings → Customer portal:** switch off **Allow Immediate Cancellation**, and keep "Cancel at next billing date" on.
4. **Developers → Webhooks → Add endpoint** (in test mode). Point it at a deployment of this site that has these environment variables:
   - `PAYMENTS_API_KEY`: a **test** key (`dodo_test_…`)
   - `PAYMENTS_WEBHOOK_SECRET`: the endpoint's signing secret (`whsec_…`)
   - `PAYMENTS_CAPTURE_PAYLOADS=on`
   - Use a Vercel Preview with its own test keys, never Production. If Vercel's Deployment Protection is on for Previews, add a protection bypass for automation, or the webhook can't reach the route.
   - The URL is `https://<preview>/api/webhooks/payments`.
   - Subscribe it to every `subscription.*`, `payment.*`, `refund.*` and `dispute.*` event.
5. **Send events:**
   - Use **Send example** on the endpoint for each event type.
   - Then do a real test purchase of the yearly product with card 4242 4242 4242 4242 (06/32, CVV 123).
   - Cancel it in the customer portal (cancel at the next billing date).
   - Then make a second subscription with card 4000 0000 0000 0341 and move its `next_billing_date` close (PATCH /subscriptions/{id}, a time ending in Z), to get a failed renewal, `past_due` and `on_hold`.
   - Refund one test payment from the dashboard.
6. **Read the payloads:**
   - With the flag on and a test key, the route logs the **shape** of each **verified** payload as one line starting `[payments:capture]` (lib/payments/capture.ts), after the signature check and never with a live key.
   - **What's logged (Prompt 78):** the event type, the ids (with their values), status-like values, and every other field's name and type. Emails, names, phone numbers, addresses, card holder, tax ids and free text appear only as `[masked]`.
   - Only server configuration turns it on (the flag AND a `dodo_test_` key); nothing in a payload can.
   - **It's temporary:** the capture is removed once the payloads are confirmed, in rollout step 3 at the latest.
   - In Vercel: the Preview deployment → **Logs** → filter "payments:capture". Copy the lines into a file for step 2. Test-mode payloads hold only test customers' details.
7. Switch `PAYMENTS_CAPTURE_PAYLOADS` off again (unset it) when done.

## 9. The open questions (answered in section 8)

1. **Webhook payloads:** the subscription and payment webhook schemas didn't render in Dodo's docs. In step 2 we confirm them with "Send example" and a test-mode delivery. Is the dashboard available for that?
2. **Grace period:** 7 days, as recommended? (Dodo allows 1 to 30, default 3.)
3. **Immediate cancellation:** switch it off in the portal (cancel at period end only)?
4. **Tax:** show "$12 a year" with tax added at checkout (as now for $8), or tax-inclusive?
5. **The spots running out before 31 December:** the subscription would have to be live by then too. Ship it by 20 December regardless, so either switch is covered?
