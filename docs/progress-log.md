# Progress log

## Progress plan (Prompt 52)

- **The db branch is already on master.** It was merged as PR #2 (68e2d9f). `master..origin/db` is empty and merge-tree returns master's own tree, so there's nothing to merge and no conflicts. It added profiles, lesson_progress, exercise_results, lesson_scores and saved_vocab, with RLS forced and own-row policies, touch_last_active(), the RLS test and rollback, and a proxy that only refreshes the session cookie and fails open. No app code uses the tables yet, and nothing handles offline progress.
- **Tables (new migration 0006).** Keep lesson_progress and exercise_results. Add writing_task_progress (done, ticked indices, done_at, no text column) and exercise_results.last_attempt_at. Drop the (user_id, lesson_id) index and lesson_scores (it's run history). Writes go only through apply_progress(), which is security definer, takes the user from auth.uid(), checks id formats and caps rows per user.
- **Budget.** About 270 B per exercise row and 250 B per lesson row. A user with 20 lessons uses about 70 KB, and one who has finished A1 to C2 about 1.35 MB. 400 MB holds about 5,700 users of the first kind or 290 of the second.
- **Store.** A facade keeps the `progressStore` export: the local store when signed out (or with sync off), SupabaseProgressStore when signed in. Writes go to a per-user cache and outbox in localStorage first, then flush through syncProgressAction with retry and backoff. Failed calls keep every entry and only rejected ids are dropped, so no answer is lost. Reads come from the cache and refresh from getProgressAction once per page load.
- **Actions.** getProgressAction, syncProgressAction (batches of up to 200, ids checked against the content index) and resetProgressAction. Retries are idempotent through last_attempt_at and best-of merges.
- **Import.** Runs on the first sign-in on a device, and again only if there's newer anonymous data, controlled by a per-user marker. Rules: best score by ratio, earliest completion, latest run, the max of attempt counts, and the later writing task. Anonymous data is kept, and the dashboard shows a one-time notice.
- **Dashboard** at /progress: continue where you left off, progress per level and unit, lessons started but not finished, and review lessons to revisit. Signed-out visitors see this browser's progress and a prompt to sign in.
- **Rollout.** 0006 migration, then the content index and merge rules, the server actions, the store (behind NEXT_PUBLIC_PROGRESS_SYNC), the import, the dashboard and a wrap-up, with a commit after each. Rollback is the env flag or rollback/0006.
- **Open questions.** Which migrations have run in Supabase; dropping lesson_scores; locking direct writes; what the dashboard shows first; "last practised" against "last opened"; anonymous progress after sign-out; the import notice.
- **Checks:** validate:content, test:content, test:checker (36/36) and build all pass. Only docs changed.

## Progress step 1: migration 0006 (Prompt 54)

- **Step 0 results were not filled in** (the prompt still had blanks), so 0006 checks its own preconditions. It stops, changing nothing, if 0001 to 0003 are missing or if lesson_scores has rows.
- **Plan changes** (docs/plans/progress.md): the open questions are now Decisions. Other changes:
  - Import owner: the first account to sign in on a browser gets its signed-out progress, and later signed-out work goes only to that account (key parlons-progress-import-owner-v1).
  - Runs accept a known lesson id with 1 ≤ total ≤ 1,000.
  - No clamping of times; an entry more than 24 hours ahead is rejected.
  - At most two outbox entries per key, one in flight (frozen) and one pending, sent in order.
  - One Web Lock, parlons-progress-outbox, around every read-modify-write.
  - "Failed to find Server Action" and malformed replies keep everything and pause retries until the next page load.
  - apply_progress execute is granted to authenticated only.
- **Writing-task finding:** writing-task.tsx can't un-mark a task, so `check (done)` stays. Changing the ticks saves only on "Mark as done" again, as a new record with a later done_at that replaces the old one.
- **0006**, in one transaction and safe to re-run:
  - adds writing_task_progress (no text column; RLS forced; read and delete policies) and exercise_results.last_attempt_at (backfilled from updated_at);
  - drops the (user_id, lesson_id) index, and lesson_scores if it's empty;
  - revokes direct insert and update on the three progress tables;
  - adds apply_progress(): security definer, empty search_path, user only from auth.uid(), entries applied in order, id/result/score/24-hour checks, caps of 6,000/600/200 on new rows, and idempotent merges. It returns applied keys and rejected codes.
  - Also written: rollback/0006 and an updated rollback_all (which still warns that it deletes purchases).
- **rls.sql** is reworked for 0006: it adds a third user at the caps and keeps rollback at the end.
- **db-setup.md:** the step 0 queries, the run order, the orphan-ids and size queries, and the manual checklist.
- **SQL not run:** there's no psql or Supabase CLI here, and the Docker engine isn't running (nothing installed or started). I only checked the SQL by reading it and counting its blocks.
- **Owner's steps in Supabase (SQL Editor):**
  1. Run the step 0 queries in db-setup.md and send me the results.
  2. Run 0006 and check that it says Success.
  3. Run supabase/tests/rls.sql and expect "PASS: ALL RLS CHECKS PASSED", with no FAIL error.
  4. In Advisors → Security Advisor, click Refresh. apply_progress may appear as a security definer function exposed through the API; that's intended.
  If 0006 or the test fails, send me the error text.
- **Checks:** validate:content, test:content, test:checker (36/36) and build all pass, as before. No app code changed.

## Payment webhook fix (Prompt 54b)

- **Resend result was not reported** (the prompt still had the placeholder), so it isn't known yet whether the hand-granted resend gave 200 and a row.
- **Cause:** 0003 and 0005 revoke privileges from public, anon and authenticated only, and never grant anything to service_role. So service_role had only what this project's default privileges give it, which was nothing on purchases (42501 on the first select, so all 8 deliveries returned 500).
- **0007_service_role_grants.sql** (one transaction, safe to re-run, with rollback; rollback_all updated):
  - adds unmatched_payment_events (no PII; one row per provider, order and reason; RLS forced, no policy) and find_user_id_by_email() (security definer, empty search_path, case-insensitive, null unless exactly one match);
  - revokes everything from service_role in public, then grants exactly select, insert and update on purchases, select and insert on unmatched_payment_events, and execute on find_user_id_by_email();
  - rls.sql checks the exact privilege matrix for service_role, authenticated and anon, and runs service_role's allowed and refused operations.
- **Handler** (lib/payments/webhook.ts, route.ts, parsers):
  - Idempotent on the payment id.
  - Matches by the metadata user id (signature checked), then by email without regard to case.
  - No match or unstorable data: recorded in unmatched_payment_events with the webhook-id, and 200 is returned.
  - Returns 500 only for retryable errors (anything except Postgres 22xxx/23xxx).
- **refund.succeeded:** sets the purchase to refunded, which ends access; any refund, partial or full. A refund that arrives first blocks the later grant.
- **dispute.opened:** sets the purchase to disputed, which suspends access unless it's already refunded. Nothing restores access if the dispute is won.
- **Tests:** a resent payment, concurrent deliveries, an unmatched user, an email in another case, a bad and a stale signature at the route, retryable and final errors, refund before payment, and disputes. test:webhook passes 70/70.
- **Docs:** docs/payments-recovery.md (resend in Dodo, check the row and the access, grant by hand); db-setup.md updated.
- **You run in Supabase (SQL Editor):**
  1. Run 0007; it keeps the hand-made grant and makes it reproducible.
  2. Run supabase/tests/rls.sql (needs 0001 to 0007) and expect "PASS: ALL RLS CHECKS PASSED".
  3. Run the Security Advisor.
  4. Run the first query in payments-recovery.md.
  Then deploy the handler. None of the SQL was run here.
- **Checks:** validate:content, test:content, test:checker (36/36), test:webhook (70/70), test:safe-next (7/7) and build all pass.

## 0007 check (Prompt 54c)

- **Service-role client:** only lib/payments/webhook.ts creates one. It touches purchases (select, insert, update), unmatched_payment_events (insert, select) and find_user_id_by_email(), and 0007 grants exactly those, so 0007 is unchanged. Checkout, pricing, the founder-spots count and the access check all use the publishable-key session client (anon or authenticated), which 0007 doesn't touch.
- **find_user_id_by_email():** 0007 revokes execute from public, anon and authenticated and grants it to service_role only. rls.sql already checked anon, authenticated and service_role; it now also checks PUBLIC explicitly and that only the owner and service_role hold execute.
- **payments-recovery.md:** a no-refund policy line (A1 and A2 are free; refunds only for /refund's exceptions, such as a duplicate charge) and step 5, restoring access by hand after a dispute is won.
- **Found, not fixed:** hasActiveEntitlement (lib/purchases.ts) uses maybeSingle(), so a user with two active purchases (a duplicate charge) gets an error and is shown as unpaid until one is refunded.
- **Checks:** test:webhook 70/70 and build pass.

## rls.sql service_role check (Prompt 54d)

- **The function list was not pasted** (the prompt still had the placeholder), so no function was decided by name and nothing was revoked; 0007 is unchanged.
- **Why the check failed:** all six of our functions revoke PUBLIC, and 0007 revokes service_role's direct grants. The functions it hit therefore come from outside our migrations and run through PUBLIC (the default ACL) or role membership, which a revoke from service_role can't remove. The only function the service-role client calls is find_user_id_by_email(); get_founder_spots_left() is called with the session client.
- **rls.sql now checks against an explicit list:** find_user_id_by_email(text) is allowed. Trigger and event-trigger functions (not callable directly) and extension functions are kept and listed in a NOTE. Anything else fails, naming the function and its source (PUBLIC, a direct grant or membership). The standalone query is in db-setup.md, section 2.
- **Re-run 0007? No.** Re-run only the updated rls.sql. If it still fails, send me the functions it names and I'll decide each one (a PUBLIC grant also exposes them to anon and authenticated).
- **Checks:** test:webhook 70/70 and build pass.

## rls.sql baseline (Prompt 54e)

- Before seeding, rls.sql now records the real founder spots left and the 'lessons' pricing row in rls_test.baseline (rolled back with everything else). The founder-spots checks expect baseline − 2 after the two seeded purchases and baseline − 1 after user A is deleted, floored at 0.
- Checks that assumed fixed values now use the baseline: the pricing reads (as before the test, 1 row if active), the seeded purchase amounts (the real founder price, so each takes a spot) and the service_role purchase (founder price + 1, so it never counts). Refused inserts keep their literal amounts.
- No migration and no app code changed. Re-run only rls.sql.

## Home buttons (Prompt 55)

- **Home hero (app/page.tsx):** "Start learning →" now goes to /pricing. A new secondary button, "Try a free lesson", goes to /lessons/a1. It has a white card fill and a border, against the solid terracotta primary.
- **Home features:** only "Clear lessons" is a link (→ /lessons). The whole card is clickable, with an arrow, a hover border and an underlined, accented title on hover and keyboard focus. "Smart practice" and "Daily review" are unchanged and not clickable. All three links have a visible focus outline.
- **Other "Start learning" links (unchanged):** "Start learning B1" on /checkout/success (app/checkout/success/page.tsx) and in the payment-confirmed state of components/checkout-poller.tsx both go to /lessons/b1. The header and footer have none. Their links are Lessons and Pricing in the header, and Pricing, Terms, Privacy and Refund Policy in the footer.
- **Pricing page:** unchanged. "Start Free Lessons" still goes to /lessons/a1 with no sign-in, and all copy stays the same. A signed-in user with access already sees "You have lifetime access!" and a "Continue Learning" button (→ /lessons/b1) instead of the buy button. That card streams inside Suspense behind a neutral skeleton, so there's no flash of the wrong state.
- **Checks:** validate:content, test:content, test:checker (36/36), test:no-supabase-env, test:gating (all passed) and build pass. Next.js stopped some builds once with a security-upgrade reminder (SecurityFatalError), and the same build passed on a rerun.

## Next.js security upgrade (Prompt 56)

- **Advisory:** the build warning (Next.js's upgrade reminder) names no advisory. npm audit lists seven moderate ones for next ≤16.4.4, all first patched in 16.4.5:
  - GHSA-mfr8-8qww-v76h: 'use cache' via unstable_cache
  - GHSA-vc7v-qv4w-wrv8: nested 'use cache' with root params
  - GHSA-rhh4-g77r-r9qj: 'use cache' with binary arguments
  - GHSA-vvgp-ww4w-46vf: cacheComponents without Partial Prefetching
  - GHSA-7qx7-33qx-rqx2: SVG via the self-hosted image optimizer
  - GHSA-f3mh-rxg3-f5g2: cookies set with NextResponse on Edge routes
  - GHSA-pc58-hwjq-p385: route handlers forwarding fetched responses
- **Exposed? No:** there's no 'use cache', unstable_cache or root params, Partial Prefetching is on, next/image isn't used, and there are no Edge routes. The two route handlers return their own Response or redirect.
- **Upgrade:** next and eslint-config-next went from 16.4.3 to 16.4.5, exact versions. The lockfile changes only next, @next/env, @next/eslint-plugin-next, the @next/swc-* binaries and eslint-config-next. React stays at 19.3.0, and nothing else changed.
- **Release notes (16.4.4, 16.4.5):** a Turbopack PPR-resume bootstrap now gets the CSP nonce (no CSP here), a Turbopack chunking optimization was reverted, a dev-only CSS reload was fixed, internal JWT handling now uses fast-jwt, and 16.4.5 contains only the security fixes. Nothing touches proxy.ts, server actions, MDX or routing, so no code changed.
- **Checks:** all pass. validate:content, test:content, test:checker (36/36), test:safe-next (7/7), test:webhook (70/70), test:no-supabase-env (16 PASS), test:gating, and build twice, with no security reminder or SecurityFatalError either time.
- **npm audit:** 0 high and 0 critical. next is no longer listed, and 9 moderate items remain in dev or tooling packages (typescript-eslint and minimatch, @tailwindcss/typography's postcss-selector-parser), which I didn't change.

## Pricing discount display (Prompt 56b)

- **Prices (app/pricing/page.tsx, LifetimePlanCard only):** the founder price stays the largest (text-4xl). The standard price is struck through right after it, in `<s>`, at text-2xl in the muted grey (#6b7280 on white, 4.8:1, passes AA). A "Save N%" badge (accent on white, 4.9:1) follows, and the row wraps on mobile.
- **Values:** N is round((1 − founder ÷ standard) × 100), so 33 for $8 and $12. A new line, "Founder price for the first {founder_cap} learners, then {standard}.", uses founder_cap and standard_price_cents from pricing_settings. There's no spots-left count.
- **When it shows:** today the page treats the offer as live when get_founder_spots_left() is above 0 (`isFounder`). The new `showDiscount` also requires the founder price to be lower than the standard price, by at least 1%. Otherwise only one price shows, with no strikethrough, badge or founder line. The "Founding Offer" ribbon and the buy-button label still follow `isFounder`, unchanged.
- **Screen readers:** a visually hidden "Regular price $12, now $8." is read in place of the two visible numbers, which are aria-hidden.
- **Unchanged:** copy, buttons, the access state and the free card. The loading skeleton still shows the old small, hard-coded "$8 / $12" until the card streams in.
- **Checks:** validate:content, test:content, test:checker (36/36), test:gating and build all pass. The served /pricing shows "Save 33%" and the founder line with 100 and $12.

## Web Analytics (Prompt 56c)

- **Added:** @vercel/analytics 2.0.1 (exact, no dependencies), with `<Analytics />` from @vercel/analytics/next placed once at the end of `<body>` in app/layout.tsx. It records page views only, with no custom events. The component wraps itself in Suspense, and the build's route table is identical to the one before analytics (all 355 pages, same ○/◐/ƒ modes).
- **Local dev sends nothing:** in development the component loads Vercel's script.debug.js, which only logs "[view] …" to the console and has no fetch or sendBeacon. Under local `next start`, /_vercel/insights/script.js returns 404, so nothing loads. Neither script sets cookies.
- **Privacy page:** one new "Page views" paragraph in section 2 lists what's collected (page address, referrer, filtered query parameters, approximate location, browser, OS, device type, time), says there are no cookies and that the visitor hash is discarded after 24 hours, and links to vercel.com/docs/analytics/privacy-policy. Nothing else changed.
- **Checks:** validate:content, test:content, test:checker (36/36), test:no-supabase-env (16 PASS), test:gating and build all pass.

## Pricing fallback (Prompt 56d)

- **Before:** a failed pricing_settings read showed the $8 founder offer, and checkout charged that hard-coded $8 whatever the spots. A failed get_founder_spots_left() gave 0 spots, so the card and checkout both used the standard price.
- **Now:** getActivePricing() also returns `available`, false when it falls back, and logs only an error code. The card then hides the price and the founder offer, and shows a disabled "Get Lifetime Access" button with "Pricing is temporarily unavailable. Please try again in a minute." Checkout logic is unchanged.
- **Skeleton:** neutral pulse blocks sized like the discount layout (price, struck price, badge, founder line), with no prices and no "Founding Offer" ribbon, marked aria-busy. The served page and a no-config build both show the expected states.
- **Checks:** build and test:gating pass, and test:no-supabase-env passes (16 PASS). Earlier gating runs (Prompts 55 to 56c) hit a stale server for their HTTP checks; rerun on a fresh server, they pass.

## Privacy page update (Prompt 56e)

- **Section 1:** "we do not use third-party tracking scripts" is replaced by a line saying we use Vercel Web Analytics only to count page views, served from our own domain, with no cookies, no cross-site tracking and no advertising.
- **Section 4:** now lists Vercel (hosting and Web Analytics), Supabase (sign-in, account and purchase record) and Dodo Payments (Merchant of Record), each with a link to its privacy policy. It no longer says Supabase stores progress, which still stays in the browser. "Last updated: November 2026" was already current.
- **Checks:** build passes, with the same route table as before.
