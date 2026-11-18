# Payments Plan: Lifetime Access & Paywall Architecture

This document plans the payment infrastructure for **French Properly**. It introduces one-time payment for lifetime access to intermediate and advanced content (B1 to C2 and all future levels), while keeping introductory levels (A1 and A2) free and prerendered.

---

## 1. Requirements & Core Principles

- **Access model:** Free A1/A2 (prerendered, no cookies, no sign-in required). Gated B1, B2, C1, C2, and all future levels (require Google sign-in AND a server-verified `'lessons'` entitlement).
- **Pricing:** Lifetime access for a single one-time payment. Founder price of **$8** for the first 100 paid buyers, then standard price of **$12**.
- **Dynamic settings:** Price, currency, founder cap, and post-founder price live in Supabase, editable in the dashboard without code changes or redeployments. Paywall shows the real number of founder spots remaining.
- **Refund policy:** 7-day full money-back guarantee. Webhook automatically revokes access on refund.
- **Provider neutrality:** Merchant of Record (MoR) provider (Dodo Payments or Lemon Squeezy). All provider-specific logic is encapsulated behind a minimal, swappable interface.
- **Future products:** Extensible architecture supporting future products (`pro`, `max`, etc.) without schema or route redesign.
- **Security & privacy:**
  - Zero-trust server validation: client never dictates price, product, or user ID.
  - Server-only service keys (`SUPABASE_SERVICE_ROLE_KEY`, `PAYMENTS_WEBHOOK_SECRET`) never exposed to client or `NEXT_PUBLIC_` variables.
  - Leak guard preserved: `LessonMeta` remains untouched without body, vocab, or exercises.
  - Webhooks enforce raw body cryptographic signature verification and idempotency.
  - Privacy-preserving logging: no personal data (PII) or payment card details in logs.

---

## 2. Database Schema & Migration 0005

Migration `supabase/migrations/0005_payments.sql` creates two tables in the `public` schema with Row Level Security (RLS) enabled and forced.

### 2.1 Table: `public.purchases`
Stores entitlements and order history.
```sql
create table if not exists public.purchases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  product text not null check (product in ('lessons', 'pro', 'max')),
  status text not null check (status in ('active', 'refunded', 'disputed')),
  provider text not null check (provider in ('dodo', 'lemonsqueezy')),
  provider_order_id text not null,
  amount int not null check (amount >= 0),
  currency text not null default 'usd' check (char_length(currency) = 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  refunded_at timestamptz,
  constraint purchases_provider_order_unique unique (provider_order_id),
  constraint purchases_refund_status_check check (
    (status = 'refunded') = (refunded_at is not null)
  )
);

create index if not exists purchases_user_product_status_idx
  on public.purchases (user_id, product, status);

create index if not exists purchases_product_status_amount_idx
  on public.purchases (product, status, amount);

drop trigger if exists purchases_set_updated_at on public.purchases;
create trigger purchases_set_updated_at
  before update on public.purchases
  for each row execute function public.set_updated_at();
```

### 2.2 Table: `public.pricing_settings`
Stores pricing tiers and founder caps editable from the Supabase dashboard.
```sql
create table if not exists public.pricing_settings (
  product text primary key check (product in ('lessons', 'pro', 'max')),
  currency text not null default 'usd' check (char_length(currency) = 3),
  founder_price_cents int not null check (founder_price_cents > 0),
  standard_price_cents int not null check (standard_price_cents > 0),
  founder_cap int not null check (founder_cap >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists pricing_settings_set_updated_at on public.pricing_settings;
create trigger pricing_settings_set_updated_at
  before update on public.pricing_settings
  for each row execute function public.set_updated_at();

-- Seed initial configuration
insert into public.pricing_settings (
  product, currency, founder_price_cents, standard_price_cents, founder_cap
) values (
  'lessons', 'usd', 800, 1200, 100
) on conflict (product) do nothing;
```

### 2.3 Row Level Security (RLS) & Privileges
- **Force and enable RLS:**
  ```sql
  alter table public.purchases enable row level security;
  alter table public.purchases force row level security;
  alter table public.pricing_settings enable row level security;
  alter table public.pricing_settings force row level security;
  ```
- **Privilege model:**
  - Revoke all privileges from `public`, `anon`, and `authenticated`.
  - `authenticated` users can only `SELECT` their own purchases:
    ```sql
    grant select on table public.purchases to authenticated;
    create policy "purchases: read own" on public.purchases
      for select to authenticated
      using ((select auth.uid()) = user_id);
    ```
  - **No `INSERT`, `UPDATE`, or `DELETE` for `authenticated` or `anon`.**
  - `authenticated` and `anon` can `SELECT` active pricing:
    ```sql
    grant select on table public.pricing_settings to authenticated, anon;
    create policy "pricing_settings: read active" on public.pricing_settings
      for select to authenticated, anon
      using (is_active = true);
    ```
  - **Writes to `purchases` occur exclusively through the server-side webhook handler** using the Supabase Service Role client (`SUPABASE_SERVICE_ROLE_KEY`), which possesses `BYPASSRLS`.

### 2.4 Rollback Script (`supabase/rollback/0005_payments.sql`)
```sql
begin;
drop table if exists public.purchases;
drop table if exists public.pricing_settings;
commit;
```
Also update `supabase/rollback/rollback_all.sql` to drop `purchases` and `pricing_settings` before `profiles`.

### 2.5 RLS Test Suite Extensions (`supabase/tests/rls.sql`)
Add test assertions inside the existing transaction:
1. User A inserts own purchase -> **refused (42501)**.
2. User A updates or deletes own purchase -> **refused (42501)**.
3. User A queries purchases -> sees only rows where `user_id = A`.
4. User A attempts to read User B's purchase -> returns 0 rows.
5. Anon attempts to read, insert, update, or delete purchases -> refused or 0 rows.
6. Anon and authenticated can read `pricing_settings`.
7. Anon and authenticated cannot insert, update, or delete `pricing_settings` -> refused (42501).
8. Cascade deletion: deleting User A from `auth.users` deletes all associated `purchases` rows.

---

## 3. Provider Abstraction Layer

Both Dodo Payments and Lemon Squeezy act as Merchant of Record (handling global sales tax, VAT, and merchant liability). To avoid vendor lock-in, all provider code is isolated behind a common interface in `lib/payments/`.

### 3.1 Interface Definition (`lib/payments/types.ts`)
```ts
export type CheckoutParams = {
  userId: string;
  userEmail: string;
  product: 'lessons' | 'pro' | 'max';
  priceCents: number;
  currency: string;
  redirectUrl: string;
  metadata: Record<string, string>;
};

export type WebhookEventResult =
  | { type: 'order_paid'; orderId: string; userId: string; product: string; amountCents: number; currency: string }
  | { type: 'order_refunded'; orderId: string; userId: string; product: string }
  | { type: 'ignored'; reason: string };

export interface PaymentProvider {
  name: 'dodo' | 'lemonsqueezy';
  createCheckout(params: CheckoutParams): Promise<{ checkoutUrl: string }>;
  verifyWebhookSignature(rawBody: string, headers: Headers): Promise<boolean>;
  parseWebhookEvent(rawBody: string): Promise<WebhookEventResult>;
}
```

### 3.2 Implementations
- `lib/payments/dodo.ts`: Uses Dodo Payments API and HMAC webhook verification header (`webhook-signature`).
- `lib/payments/lemonsqueezy.ts`: Uses Lemon Squeezy API and HMAC-SHA256 signature header (`x-signature`).
- `lib/payments/provider.ts`: Factory selecting the active provider based on `PAYMENTS_PROVIDER`.

---

## 4. Checkout Server Action (`app/actions/checkout.ts`)

Invoked when a user clicks "Buy lifetime access".

### 4.1 Execution Sequence
1. **Authenticate caller on the server:**
   - Call `getCurrentUser()` (`lib/auth.ts`).
   - If not signed in: throw error or return `{ redirect: "/sign-in?next=/pricing" }`. Never initiate checkout for an anonymous user.
2. **Prevent duplicate purchase:**
   - Query `purchases` table for active entitlement:
     ```sql
     select id from public.purchases
      where user_id = :userId and product = 'lessons' and status = 'active'
     ```
   - If already active: return `{ error: "already_entitled", redirectUrl: "/lessons/b1" }`.
3. **Determine price securely on the server:**
   - Query `pricing_settings` for `'lessons'`.
   - Count active founder purchases:
     ```sql
     select count(*) from public.purchases
      where product = 'lessons' and status = 'active' and amount <= :founder_price_cents
     ```
   - If `count < founder_cap`:
     - Select `founder_price_cents` ($8.00).
   - Else:
     - Select `standard_price_cents` ($12.00).
   - **The client is never allowed to specify the price, currency, or user ID.**
4. **Sign metadata:**
   - Include `{ userId: user.id, product: 'lessons' }`.
   - Attach HMAC signature `hash_hmac('sha256', userId + ':' + product, PAYMENTS_WEBHOOK_SECRET)` so metadata tampering is provably impossible.
5. **Create checkout session:**
   - Call `provider.createCheckout(...)`.
   - Set success redirect to `/checkout/success?product=lessons`.
6. **Return checkout URL:** Redirect visitor to the hosted MoR payment page.

---

## 5. Founder Cap & Race Condition Strategy

- **Cap definition:** 100 spots at $5.
- **Live count:**
  - Real-time spots remaining: `max(0, founder_cap - active_founder_count)`.
  - Displayed on the paywall and `/pricing` page ("N spots left").
- **Race condition at buyer #100:**
  - If two learners (Buyer 100 and Buyer 101) initiate checkout simultaneously when 1 spot remains, both receive a checkout URL for $5.
  - Buyer 100 completes payment -> count reaches 100. Spots left becomes 0.
  - Buyer 101 completes payment seconds later with their valid $5 checkout session.
  - **Handling rule:** **Honour the purchase, do not refund.**
  - **Rationale:** The customer acted in good faith on an offered price. Digital access has zero marginal distribution cost. Rejecting or refunding a paying customer causes friction and disputes.
  - Once the webhook records order 100, any new checkout sessions generated by the Server Action will strictly resolve to $12.

---

## 6. Webhook Route Handler (`app/api/webhooks/payments/route.ts`)

A Next.js Route Handler listening on `POST /api/webhooks/payments`.

### 6.1 Requirements
1. **Raw body extraction:** Read raw text via `await request.text()` before any JSON parsing to guarantee valid cryptographic signature checking.
2. **Signature verification:** Validate signature using `crypto.timingSafeEqual` with `PAYMENTS_WEBHOOK_SECRET`. On mismatch, respond immediately with `401 Unauthorized`.
3. **Idempotency:**
   - Use `provider_order_id` with `unique` constraint in `purchases`.
   - Check if `provider_order_id` already exists.
   - If event was already processed, return `200 OK` with `{ received: true, duplicate: true }`.
4. **Lifecycle handling:**
   - **`order_paid`:**
     - Verify metadata signature (`userId`, `product`).
     - Insert row into `public.purchases`:
       `status = 'active'`, `amount`, `currency`, `provider`, `provider_order_id`.
   - **`order_refunded`:**
     - Update row in `public.purchases`:
       `status = 'refunded'`, `refunded_at = now()` where `provider_order_id = :orderId`.
   - **`order_disputed`:**
     - Update row: `status = 'disputed'`, `updated_at = now()`.
   - **Unknown / unhandled events:**
     - Log event type and return `200 OK` (so provider does not retry indefinitely).
5. **Privacy & logging:**
   - Only log structured events: `{ event: type, orderId, product, timestamp }`.
   - **Do not log PII:** Never log customer names, emails, card brands, or IP addresses.
6. **Execution context:** Uses server-only Supabase client with `SUPABASE_SERVICE_ROLE_KEY`.

---

## 7. Gating & Access Control Architecture

Content security relies on `lib/auth.ts`, `lib/lessons.ts`, and `components/lesson-body.tsx`.

### 7.1 Access States
For any lesson, there are three distinct states:
1. **Free level (A1, A2):** Open to everyone. Prerendered at build time. No cookie read. Handled via `grantFreeAccess(meta)`.
2. **Gated level (B1 to C2), Signed Out:** No user session. Visitor sees the lesson shell (title, description, breadcrumbs, prerequisites) and `<SignInPanel />`. **No teaching body, vocab, or exercises are rendered or sent over the network.**
3. **Gated level (B1 to C2), Signed In Unpaid:** User session exists, but no active `'lessons'` row in `purchases`. Visitor sees the lesson shell and `<PaywallPanel />`. **Zero lesson content or exercise answers are loaded.**
4. **Gated level (B1 to C2), Paid:** Active entitlement verified on the server. `grantLessonAccess` returns `LessonAccess`, and `<LessonBody />` renders full MDX, vocab tables, and interactive exercises.

### 7.2 Updated `grantLessonAccess` in `lib/auth.ts`
```ts
export type LessonAccessResult =
  | { status: "granted"; access: LessonAccess }
  | { status: "signed-out" }
  | { status: "unpaid"; spotsLeft: number };

export async function checkLessonAccess(meta: LessonMeta): Promise<LessonAccessResult> {
  if (isFreeLevel(meta.level)) {
    return { status: "granted", access: grantFreeAccess(meta) };
  }
  const user = await getCurrentUser();
  if (!user) return { status: "signed-out" };

  const hasAccess = await hasActiveEntitlement(user.id, "lessons");
  if (hasAccess) {
    return { status: "granted", access: { grant: "lesson-access", lessonId: meta.id } };
  }

  const spotsLeft = await getFounderSpotsLeft();
  return { status: "unpaid", spotsLeft };
}
```

### 7.3 Unpaid Paywall Copy & UI
When `status === "unpaid"`, `components/paywall-panel.tsx` renders:
> **"You've finished the free levels. Bravo ! We hope A1 and A2 were useful. B1 to C1 is a one-time payment, with all future lessons included. Founding price: $8 for the first 100 learners (N left)."**

Accompanied by:
- A prominent "Get Lifetime Access" button that invokes `createCheckoutAction('lessons')`.
- Trust badges: 7-day money-back guarantee, one-time payment (no subscription), secure checkout.

### 7.4 Compile-Time & Runtime Leak Guard
- `LessonMeta` remains `NoBody`:
  ```ts
  type NoBody = { content?: never; body?: never; vocab?: never; exercises?: never };
  ```
- `lib/lessons.typetest.ts` continues to enforce that `LessonMeta` can never carry body or exercises.
- Body and exercises are loaded exclusively inside `loadLessonFull(access)`, which strictly requires `{ grant: "lesson-access" }`.

---

## 8. Post-Payment & Late Webhook Handling

- **Success page:** `/checkout/success` (Server Component with Client polling fallback).
- **Happy path:** Webhook arrives before user redirects to success page. User lands on `/checkout/success`, server checks `hasActiveEntitlement()`, sees active row, displays congratulations, and offers "Start learning B1" button.
- **Late webhook edge case (webhook takes 2-5 seconds):**
  - If user lands on `/checkout/success` before the webhook finishes writing to Supabase:
  - Page detects `hasActiveEntitlement() === false`.
  - Renders a lightweight polling component:
    - Displays: *"Confirming your payment... This usually takes just a few seconds."*
    - Polls a Server Action `checkEntitlementStatus('lessons')` every 1,500ms (up to 10 iterations / 15 seconds).
    - As soon as the webhook commits the purchase, the poll resolves to `true` and the page transitions immediately to the active state.
    - If 15 seconds elapse without confirmation: displays fallback message: *"Payment received! We're finishing your account setup. Refresh in a moment or visit your lessons."* with a direct link to `/lessons`.

---

## 9. New Public Pages & Navigation Updates

### 9.1 Pages
1. `/pricing`:
   - Full curriculum comparison: Free (A1-A2) vs Lifetime Access (B1-C2).
   - Clear value propositions: one-time fee, all future levels included, 7-day refund guarantee, no recurring subscriptions.
   - Dynamic pricing card showing current price ($8 Founder vs $12 Standard) and remaining founder spots.
   - FAQ section answering common questions on billing, access duration, and refund process.
2. `/terms`:
   - Terms of Service specifying one-time license grant for personal educational use.
   - Merchant of Record payment terms.
   - Account sharing policies and fair usage.
3. `/refund`:
   - Transparent 7-day full refund policy.
   - Instructions on requesting a refund via self-serve MoR customer portal link or by emailing support with order ID.
   - Explains that refund automatically revokes B1+ lesson access.

### 9.2 Navigation & Layout
- **Header (`app/layout.tsx`):**
  - Add `Pricing` link between `Lessons` and the `AuthButton`:
    `French Properly.` | `Lessons` | `Pricing` | `[User / Sign in]`
- **Footer (`app/layout.tsx`):**
  - Add footer links to `Pricing`, `Terms of Service`, and `Refund Policy`.

---

## 10. Verification & Testing Strategy

### 10.1 Automated Gating Tests (`scripts/test-gating.mjs`)
Extend the existing test runner to verify:
- Signed-out visitors on all B1+ lessons continue to leak **zero** markers or exercise answers across HTML, RSC payload, router prefetch, and segment prefetch.
- Confirm `<SignInPanel />` text is present in HTML for signed-out visitors.
- Confirm new routes (`/pricing`, `/terms`, `/refund`) return `200 OK` and leak no lesson content.

### 10.2 Webhook Unit & Idempotency Tests (`scripts/test-webhook.mjs`)
Automated mock test suite:
1. **Signature verification:**
   - Valid signature with correct secret -> 200 OK.
   - Tampered body -> 401 Unauthorized.
   - Wrong secret / forged signature -> 401 Unauthorized.
   - Missing signature header -> 401 Unauthorized.
2. **Idempotency:**
   - Replay same `order_paid` event twice -> second returns 200 OK without creating duplicate rows or erroring.
3. **Refund revocation:**
   - Replay `order_refunded` event -> updates purchase status to `refunded`. Gating check immediately switches user back to paywall.
4. **Unknown events:**
   - Send arbitrary event (`customer.subscription.created`) -> returns 200 OK and logs ignore reason.

### 10.3 Fail-Closed Environment Tests (`scripts/test-no-supabase-env.mjs`)
- Verify that if `SUPABASE_SERVICE_ROLE_KEY` or `PAYMENTS_WEBHOOK_SECRET` is unset:
  - Checkout Server Action safely rejects without crashing.
  - Webhook route safely returns 500 / 401 without crashing or granting unauthorized access.
  - Gated lessons remain locked.

### 10.4 Manual Sandbox Checklist
- [ ] Signed-out: navigate to B1 lesson -> Sign-in panel displays.
- [ ] Sign in with test Google account without purchase -> Paywall panel displays with founder price and live remaining spots.
- [ ] Click "Get Lifetime Access" -> redirects to provider sandbox checkout with $8 price and prefilled email.
- [ ] Complete test payment with sandbox card -> redirected to `/checkout/success`.
- [ ] Success page confirms activation -> navigate to B1 lesson -> full lesson, vocab, and exercises display.
- [ ] Trigger test refund in provider dashboard -> webhook receives refund event -> user session immediately reverts to paywall panel on B1 lesson.
- [ ] Header shows "Pricing" and works on mobile viewports (~375px).

---

## 11. Environment Variables & Dashboard Configuration

### 11.1 Environment Variables (Names Only)
- `NEXT_PUBLIC_SUPABASE_URL` (existing)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (existing)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; **never** `NEXT_PUBLIC_`)
- `PAYMENTS_PROVIDER` (`dodo` or `lemonsqueezy`)
- `PAYMENTS_API_KEY` (server-only)
- `PAYMENTS_WEBHOOK_SECRET` (server-only)
- `PAYMENTS_PRODUCT_ID` (server-only)
- `NEXT_PUBLIC_SITE_URL` (canonical URL for checkout redirects)

### 11.2 Dashboard Steps
1. **Supabase Dashboard:**
   - SQL Editor: Run `supabase/migrations/0005_payments.sql`.
   - SQL Editor: Run `supabase/tests/rls.sql` to verify RLS passes.
   - Advisors: Run Security Advisor to confirm RLS is active on `purchases` and `pricing_settings`.
   - Settings > API: Copy `service_role` secret key into Vercel environment variables.
2. **Provider Dashboard (Dodo Payments / Lemon Squeezy):**
   - Create product: "French Properly Lifetime Access".
   - Set up Webhook URL: `https://<production-domain>/api/webhooks/payments`.
   - Select events: `order.paid` / `payment.succeeded`, `order.refunded` / `payment.refunded`.
   - Copy Webhook Signing Secret into `PAYMENTS_WEBHOOK_SECRET`.
   - Copy Secret API Key into `PAYMENTS_API_KEY`.
3. **Vercel Dashboard:**
   - Add new environment variables for Production, Preview, and Development.

---

## 12. Pre-Launch Mandatory Gates

Before processing real payments:
1. **Make GitHub repository private:**
   - The repository is currently public. Gated lesson text and answers could be read from git history.
   - Go to GitHub Repository > Settings > Danger Zone > Change visibility to **Private**.
   - Verify Vercel deployment credentials still connect to the private repo.
2. **Perform end-to-end sandbox purchase and refund:**
   - Complete at least one successful sandbox purchase and verify lesson access unlocks.
   - Issue a refund in sandbox and verify access locks immediately.

---

## 13. Implementation Phases & File Map

### Phase 1: Database & Migration
- `supabase/migrations/0005_payments.sql` (purchases, pricing_settings, RLS policies)
- `supabase/rollback/0005_payments.sql` (rollback script)
- `supabase/rollback/rollback_all.sql` (updated combined rollback)
- `supabase/tests/rls.sql` (RLS test coverage)
- `docs/db-setup.md` (documentation update)

### Phase 2: Payment Provider Abstraction
- `lib/payments/types.ts` (provider interface & event definitions)
- `lib/payments/dodo.ts` (Dodo Payments adapter)
- `lib/payments/lemonsqueezy.ts` (Lemon Squeezy adapter)
- `lib/payments/provider.ts` (adapter registry & factory)
- `lib/payments/config.ts` (environment validation)

### Phase 3: Webhook Route & Processing
- `app/api/webhooks/payments/route.ts` (Next.js POST Route Handler)
- `lib/payments/webhook.ts` (idempotent DB writes using service role)
- `scripts/test-payments-webhook.mjs` (signature and idempotency unit tests)

### Phase 4: Gating Logic & Paywall UI
- `lib/auth.ts` (extended `checkLessonAccess` with 3 states)
- `lib/purchases.ts` (server queries for entitlements and founder spots)
- `components/lesson-body.tsx` (updated `GatedLessonBody` switching)
- `components/paywall-panel.tsx` (paywall UI with required copy)

### Phase 5: Checkout Action & Success Flow
- `app/actions/checkout.ts` (Server Action creating checkout sessions)
- `app/checkout/success/page.tsx` (success page with delayed webhook polling)
- `components/checkout-button.tsx` (client trigger with loading state)

### Phase 6: Public Pages & Header Navigation
- `app/pricing/page.tsx` (pricing page with founder counter)
- `app/terms/page.tsx` (terms of service)
- `app/refund/page.tsx` (7-day refund policy)
- `app/layout.tsx` (header & footer navigation updates)

### Phase 7: Automated Tests & Pre-Launch Verification
- `scripts/test-gating.mjs` (extend gating tests for paywall & new pages)
- `scripts/test-no-supabase-env.mjs` (ensure fail-closed without secret keys)
- Make GitHub repo private
- Conduct sandbox purchase and refund

---

## 14. Open Questions

1. **Provider Preference:** Which provider (Dodo Payments or Lemon Squeezy) should be activated first for sandbox verification?
2. **Late Webhook Experience:** Is the proposed 1.5s automatic polling on `/checkout/success` preferred, or would you prefer a simple manual "Refresh status" button?
3. **Multi-Currency:** Should `pricing_settings` support multiple explicit currency rows (e.g. EUR, GBP) upfront in Supabase, or rely on the MoR provider's dynamic currency conversion from USD?
