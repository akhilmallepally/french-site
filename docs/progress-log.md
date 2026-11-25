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

## Checkout uses the real price (Prompt 56f)

- **One source:** lib/pricing-offer.ts (getPriceOffer, runCheckout) drives the pricing card, the lesson paywall, the signed-out lesson panel and createCheckoutAction. ActivePricing no longer has priceCents or isFounder, and the fallback prices are 0 with `available: false`.
- **Checkout:** when pricing is unavailable it creates no checkout and returns `pricing-unavailable` with "Pricing is temporarily unavailable. Please try again in a minute." Otherwise it charges the founder price while spots remain and the standard price after. It also refuses (`price-changed`) if the price on the page no longer matches, for example when the last founder spot went before the click. The learner then sees "The price has just changed to $12. Please check the updated price and try again.", and the button calls router.refresh(), so the new price and label appear in place without a reload. The next click charges the new price. A `pricing-unavailable` refusal also refreshes, which swaps in the disabled button and its message.
- **Paywall and sign-in panel:** the paywall uses the shared PriceRow (founder price, struck standard price, badge, founder line, or the standard price alone) and the same disabled button and message. The sign-in panel shows the live price or none. No hard-coded prices are left: public/llms.txt now reads "A founding price for early learners, then the standard price; see https://frenchproperly.com/pricing".
- **Test:** new `npm run test:checkout` (lib/pricing-offer.test.ts, 10/10). A pricing read failure calls the provider zero times, founder and standard states charge 800 and 1200, live prices are passed through, and a mismatched page price is refused.
- **Checks:** run on a fresh server after stopping orphans, all pass. test:gating, test:webhook (70/70), test:no-supabase-env (16 PASS), tsc and build, with an unchanged route table.

## Home and header links to /pricing (Prompt 57)

- **Changed:** the "Clear lessons" card (app/page.tsx) and the header "Lessons" link (app/layout.tsx) now go to /pricing. The label, component and styles are unchanged. The header has no active-link style, so nothing else needed changing.
- **Left as they are:** /lessons links in the level-page and lesson-page breadcrumbs (app/lessons/[level]/page.tsx, app/lessons/[level]/[slug]/page.tsx) and the "browse lessons" link in components/checkout-poller.tsx. Also unchanged: the /lessons/a1 links ("Try a free lesson", "Start Free Lessons"), the /lessons/b1 links after purchase (checkout success, checkout poller, the already-entitled redirect, "Continue Learning"), level and lesson links built in lib/lessons.ts, sitemap.ts and public/llms.txt.
- **Sitemap, llms.txt, metadata:** none describes the header link. llms.txt's "Lessons Directory" entry points at /lessons itself, which still works, so nothing changed.
- **Checks:** validate:content, test:safe-next (7/7), build (route table unchanged) and test:gating pass, on a fresh server after stopping orphans. /lessons, /lessons/a1 and a free A1 lesson return 200.

## Progress step 2: content index, validation, merge logic, completedAt (Prompt 57)

- **Content index:** lib/lessons.ts builds it in load() (`getProgressIndex()`, per the plan; step 3 validates against this). scripts/build-progress-index.ts (`npm run build:progress-index`) writes the committed copy, lib/generated/progress-index.json: 232,218 bytes, byte-identical across runs. Nothing imports it, so it's in no bundle. It's keyed by lesson id, not slug (8 slugs repeat across levels), with exercises in file order and the C2 writing task listed separately.
- **validate:content:** exercise ids must be `<lesson-id>-ex` plus 3 digits (this was a warning before), lesson ids are at most 120 characters and exercise ids at most 160 (0006's limits), and ids stay unique site-wide (as before, writing tasks included). It also fails on a stale or missing index, printing the command, and fails unless the totals are 326 lessons, 4,620 graded exercises and 25 writing tasks (EXPECTED_TOTALS). It warns at 80% of 0006's per-user caps. No id is positional: every exercise and writing-task id is an explicit, required frontmatter field, and the player records by id.
- **lib/progress-merge.ts:** `apply*` functions match apply_progress rule by rule, including "a tie keeps the stored row". `merge*` functions apply the same rules symmetrically (commutative, associative, idempotent), with fixed tie-breaks: larger total on a ratio tie, higher result on an equal attempt time, greater tick list on an equal doneAt. Those ties are the only places they differ from 0006. Times are accepted up to exactly +24 h, never clamped. Runs must be whole numbers with 1 ≤ total ≤ 1,000 and 0 ≤ score ≤ total. JavaScript compares times to the millisecond, Postgres to the microsecond.
- **completedAt (lib/progress.ts):** optional, set by the first passing run and never moved later. Legacy saves load unchanged, with nothing invented on load. On a legacy lesson's next run, if its best already passed, its previous last-run time is kept as completedAt (the plan's import rule) before that time is overwritten. Best-score behaviour is unchanged.
- **Tests and checks:** new `npm run test:progress` (35/35): merge laws, ties, run bounds and times, legacy local data, index determinism and staleness, using the new fixture scripts/fixtures/progress-index. All pass: validate:content, test:content, test:checker (36), test:progress (35), test:checkout (10), test:safe-next (7), test:webhook (70), test:no-supabase-env (16 PASS), tsc and build (route table unchanged), and test:gating on a fresh server.

## Progress step 3: server actions and validation (Prompt 59)

- **Lesson-key audit:** no bug, so no migration. Since progress was added (3ea1635), the local store, the player (`lessonId={lesson.id}`, from `meta.id`), the level list (`LessonStatus lessonId={l.id}`), the level cards (`lessonIds`) and 0006 (`lesson_id`, with exercise ids prefixed by it) have all used the permanent lesson id, never a slug. The colliding slugs are review-final (6 lessons), review-work (3) and review-pronouns (2). Tests cover them: distinct ids with non-overlapping exercise ids, separate local records, `wrong_lesson` for an exercise sent under the other lesson of the same slug, and no slug passed as a lesson id anywhere in app/ or components/.
- **Actions:** app/actions/progress.ts (get, sync, reset) runs on lib/progress-sync.ts (`runSync`, injectable database) and lib/progress-validate.ts (pure). The user always comes from the session; with no Supabase config every action answers `signed-out`. Ids are checked against lib/generated/progress-index.json, imported as a module. `getCurrentUser` moved to lib/current-user.ts (lib/auth.ts re-exports it) so neither action imports lib/lessons.ts. A test walks the import graph: the progress action reaches only 8 local files, with no fs and no `getProgressIndex()`, and checkout is clean too.
- **Rejections:** the whole payload is rejected (`invalid`, nothing written) for over 200 entries or 128 KiB, a bad or duplicate key, or any field outside its kind's list, which covers writing text and typed answers, even under an unknown kind. Bad entries are rejected one by one, per the plan: unknown or wrong-lesson ids, the wrong kind, totals outside 1 to 1,000, scores that aren't whole numbers or exceed the total, NaN, impossible or over-millisecond times, and times more than 24 h ahead (never clamped). Valid entries still go ahead.
- **Return contract:** `{ status: "ok", applied, rejected, rows }`. `rows` are the server's stored records for every record the valid entries name, read back in the same request, with millisecond ISO times. If the read fails, the reply is `unavailable`. Whole-user reads page through 1,000 rows at a time. docs/plans/progress.md (sections 6 and 7) now says that in step 4 the cache takes these rows, and the server wins on ties.
- **Checks:** all pass. validate:content, test:content, test:checker (36), test:progress (67), test:checkout (10), test:safe-next (7), test:webhook (70), tsc, test:no-supabase-env (16 PASS), build (route table unchanged; the index is in no client chunk), and test:gating on a fresh server.

## Progress step 4: store, outbox, facade, flag, privacy page (Prompt 60)

- **Store and facade:** `progressStore` (lib/progress.ts) is the plain LocalProgressStore unless NEXT_PUBLIC_PROGRESS_SYNC is exactly `on` and Supabase is configured. Then a facade loads lib/progress-wiring.ts (the Supabase session and the actions) on first use and uses SupabaseProgressStore (lib/progress-store.ts) for a signed-in user, or the local store when signed out. Writes go to a per-user cache and outbox under the Web Lock `parlons-progress-outbox`. Each key has at most one frozen in-flight entry and one pending entry. Sends hold `parlons-progress-flush` (ifAvailable), so only one tab sends. Without Web Locks there's no lock (the plan's fallback): a repeated send is a no-op on the server. The pure outbox is in lib/progress-outbox.ts; types, the local store and the shared update rules moved to lib/progress-core.ts.
- **Batches and replies:** at most 200 entries and 120 KiB per call (under the action's 128 KiB), so 450 answers go out as 200 + 200 + 50. On `ok`, applied and rejected entries leave the outbox, and the cache takes the server's rows with pending entries on top. Rejected entries are logged per user with their code and kept for display, never resent. Network errors, `unavailable` and `signed-out` back off from 30 s, doubling to 5 min. "Server Action unavailable." (Next 16's stale-action 409), a malformed reply or `invalid` pause sending until the next page load, as the plan says.
- **Accounts:** the cache, outbox and rejection log are keyed by user id and carry it inside. On sign-out, or when another account signs in, the local store answers again and every synced cache is deleted. A non-empty outbox is kept and sent only when that same account signs in again, so the next person on a shared browser sees only the browser's signed-out progress. A `wrong-user` reply stops sending. Importing signed-out progress is left for step 5.
- **Privacy page:** the Supabase line now covers learning progress for signed-in learners (scores, completion and attempt times, writing-task status, never the writing text). The Learning Progress line in section 2 also changed, because the plan (section 5) requires it in this step.
- **Real database:** `npm run check:progress-db` (scripts/check-progress-db.ts) uses a dedicated test account. In PowerShell, set `$env:PROGRESS_TEST_EMAIL` and `$env:PROGRESS_TEST_PASSWORD` (the URL and key come from .env.local; the account needs a password sign-in). It runs the validator and runSync through lib/progress-db.ts, the same queries the action uses, and checks applied rows, rejections, idempotency, apply_progress's own 25-hour rejection, text and wrong-user refusals and the whole-user read. It stops if the account already has rows (unless `-- --reuse`). Not run here. Delete its rows afterwards in the Supabase SQL editor, with the test email in all three lines:

  ```sql
  -- Test account only. If the email matches no user, nothing is deleted.
  delete from public.exercise_results      where user_id = (select id from auth.users where email = 'progress-test@example.com');
  delete from public.lesson_progress       where user_id = (select id from auth.users where email = 'progress-test@example.com');
  delete from public.writing_task_progress where user_id = (select id from auth.users where email = 'progress-test@example.com');
  ```
- **Checks:** all pass. validate:content, test:content, test:checker (36), test:progress (89, covering the outbox, locks, batching, server wins, rejections, retries, action not found, tabs, accounts, sign-out and flag-off parity with no fetch), test:checkout (10), test:safe-next (7), test:webhook (70), tsc, test:no-supabase-env (19 PASS, including all three actions refusing cleanly), build (route table unchanged), and test:gating on a fresh server (all three actions refuse a signed-out caller).

## Progress step 5: import on sign-in, the notice, the first-load fix (Prompt 61)

- **First load:** with sync on, four things waited for the server read (up to 3 s):
  - SupabaseProgressStore's reads, which held getAll, getLessonProgress and getWritingTask.
  - ExercisePlayer, which created the exercise run only after getLessonProgress resolved, so the exercises didn't render until then.
  - WritingTask, which restored the local draft only after getWritingTask.
  - The lesson-list and level-card badges, through getAll.

  Now reads answer from the cache at once, and a new `subscribe()` on every store tells readers when the server's copy, an import or an account switch lands. The player starts its run in its own effect, the draft loads at once, and the badges and best score refresh on change. The player's best-score line always reserves its height, and the level cards already did. The lesson-list badge still sits inline after the title, so on narrow screens it can push the description down when it first appears, as it does today with local data.
- **Import (plan section 8):**
  - The first account that signs in on a browser, or is already signed in on the first page load with sync on, is recorded in `parlons-progress-import-owner-v1`. It's set once and never changed, and only that account ever imports.
  - Records newer than the marker `parlons-progress-imported-v1` go into the outbox as import-exercise, import-lesson and writing entries, under their own keys (ie:, il:, iw:). They're written together with the marker under the outbox lock, then sent by the usual batches (200 entries and 120 KiB at most).
  - The server merges by the existing rules. A closed tab or failed send resumes from the outbox, nothing is queued twice, and writing text is never read or sent.
  - Rejected entries are logged and kept, and the rest still import.
- **Signed-out data after import:** left in place, as the plan says (decision 6). A later signed-out visitor sees only that browser's signed-out progress, never the account's (the account's synced copy is deleted at sign-out). Later signed-out work goes only to the owner, and only what's new.
- **Notice:** "We added the progress saved in this browser to your account." (the plan's wording). It's shown once, only after at least one import entry is confirmed, and never for an empty import or with sync off. If some entries were refused, it adds "A few items couldn't be added." It's a fixed line at the bottom of the page (components/progress-import-notice.tsx in the root layout, since there's no dashboard yet), with role="status", a Dismiss button and Esc, so it shifts nothing.
- **Tests and checks:** the fakes moved to lib/progress-test-fakes.ts, and the new lib/progress-import.test.ts covers claiming, first load signed in, two tabs, merge rules, no text, batches, partial rejection, resuming, re-import, sign-out, the notice and the non-blocking first load. All pass: validate:content, test:content, test:checker (36), test:progress (105), test:checkout (10), test:safe-next (7), test:webhook (70), tsc, test:no-supabase-env (19 PASS), build (route table unchanged), and test:gating on a fresh server.

## Progress step 6: /progress dashboard, header link, step 5 fixes (Prompt 62)

- **Re-import:** on every selection of the claiming account, whether a sign-in event or a page load while signed in, signed-out records newer than the marker go into that account's outbox, through the same batches and merge rules. Practice after an expired session or a sign-out is therefore imported when that account comes back. Other accounts never get it. Tests cover an expired session, signed-out practice, another account signing in first (nothing for it), the owner back (only the new practice), and a reload while signed in. Also fixed: the facade now listens for auth changes before reading the session, so a sign-in during start-up isn't missed. Until the session is known, reads answer from the last user's cache (`parlons-progress-last-user-v1`) or the signed-out store, never waiting on the wiring chunk.
- **Notice:** moved onto /progress (components/progress-dashboard.tsx), as the plan says. The bottom line on other pages and components/progress-import-notice.tsx are gone. It's still shown once, only after a confirmed import of at least one item, with role="status", Dismiss and Esc.
- **Lesson-list badge:** its slot is always rendered, `h-5 min-w-[10.5rem]` (the widest badge, "✓ Completed · 16 / 16"), so nothing shifts when it fills in, on narrow screens too.
- **/progress:** prerendered and noindex; the sitemap lists routes explicitly, so it isn't in it; llms.txt is unchanged.
  - The server builds a slim catalogue from lib/lessons.ts (id, title, link, level, unit, type, free, writing-task id), not the content index.
  - The page shows Continue, each level (with a bar, opening to its units), "Started, not finished" (up to 10), review lessons to revisit, and C2 writing tasks (status only). The figures come from lib/progress-summary.ts, which is pure and tested.
  - Signed out with sync on, it adds the plan's line, "Your progress is saved in this browser only. Sign in to keep it across devices.", with a Sign in button. With sync off or no Supabase config, it shows local progress with no invitation, because signing in wouldn't save it. That differs from the plan, which says "the same".
  - With no progress, an empty state links to /lessons/a1. Until the first read, a quiet placeholder of the same rhythm shows. Paid lessons link to their usual pages (sign-in or paywall).
  - JS: the page's own chunks are 29.4 KB raw (8.7 KB gzip). Everything the page loads, layout and framework entries included, is 311.6 KB raw (84.0 KB gzip). The index is in no client chunk.
- **Header:** "Progress" (→ /progress) between Lessons and Pricing on every page, with the same link style. The link group wraps on narrow screens.
- **Checks:** all pass. validate:content, test:content, test:checker (36), test:progress (116), test:checkout (10), test:safe-next (7), test:webhook (70), tsc, test:no-supabase-env (21 PASS: /progress 200 and noindex with no config), build (one new static route, /progress), and test:gating on a fresh server (/progress 200, noindex, no gated content). The plan's step 7 checklist gains "on a preview deployment with the network slowed in Chrome, exercises appear at once".

## Progress step 7 prep: session-expiry privacy fix, checklist, database size, project state (Prompt 63)

- **Privacy fix:**
  - An expired or invalid session is now handled exactly like a sign-out. When the browser's session reads as nobody, the account's synced copy is deleted; when an action or read answers `signed-out`, the facade asks the auth server (`getUser()`, new `verifyUserId` in lib/progress-wiring.ts), and if it confirms the session is gone, the same happens. If the auth server can't be reached, nothing is deleted and the send retries. Either way, the account's unsent outbox stays and is sent only under that account.
  - Before the session is known, the last user's synced copy shows only if the Supabase auth cookie holds an unexpired session for that same user. The new lib/supabase-session-cookie.ts reads it synchronously, handling chunks and the `base64-` encoding, as checked in @supabase/ssr 0.12. Otherwise signed-out progress shows.
  - Tests (lib/progress-session.test.ts, 8): the cookie reader; A's session expires and B opens the site signed out, or with B's own session, and never sees A's progress, even before the session is known; A comes back and A's unsent answer goes out under A only; a server `signed-out` confirmed by the auth server, and an unreachable auth server; an explicit sign-out as before.
- **Header:** the "Progress" link was already on every page. There's one header markup for all screen sizes with no hiding classes, and the group wraps on narrow screens. test:gating now checks it on 8 kinds of page.
- **Checklist and SQL:** docs/plans/progress.md section 13 has the numbered preview checklist (16 steps with expected results, including how to simulate session expiry), the Preview environment variables and Supabase redirect URLs (13.1), clean-up (13.3) and the table-size SQL (13.4). Step 7 in the rollout now points to it.
- **docs/project-state.md:** progress is done, pending the preview checklist; the flag stays off in Production until it passes; the storage estimates; next comes Smart practice, Daily review, the home cards and the sign-in prompt.
- **Checks:** all pass. validate:content, test:content, test:checker (36), test:progress (124), test:checkout (10), test:safe-next (7), test:webhook (70), tsc, test:no-supabase-env (21 PASS), build, and test:gating on a fresh server.

## Fix: practice lost across the sync flag, never sent; unit names (Prompt 64)

- **Reproduced in Chromium** (Playwright, `next start`, the test account's real @supabase/ssr cookies).
  - With the committed code, a steady flag-on browser works: the facade picked the synced store; Local Storage held the cache, the claim and the last-user hint; the sync action answered `ok` with rows; Supabase got the rows; the score survived a refresh.
  - Production's own actions, called directly as the test account, also worked. The cookie reader handled the real cookies (single, `.0`/`.1` chunks, `base64-`, URL-encoded).
  - The symptoms appeared only across a change of store:
    - Practising on a flag-on build, then refreshing on a flag-off build: the score was gone.
    - Practising signed in on a flag-off build, in a browser whose import claim belonged to another account, then switching the flag on: the score was gone and Supabase had 0 rows.
- **Root causes:**
  1. Signed-in practice saved by the browser-only store went into the shared signed-out store. That happens on a build without the flag, or on a tab loaded before the flag-on deploy was live. It was then imported only into the browser's claim owner, so for any other account it was never sent and never shown.
  2. With the flag off, the local store ignored the account's synced copy and outbox, so practice saved while the flag was on disappeared after a refresh.
  3. Found while fixing: queueImport computed `Math.max(lastCompletedAt, completedAt)`, which is NaN for a lesson never passed, so every unpassed lesson was skipped in every import (signed-out imports included).
- **Fixes:**
  - The new `BrowserLocalStore` is the flag-off store and the facade's fallback. It reads the session from the auth cookie, with no network. With a valid session for U, writes go to `parlons-progress-v1:local:<U>`, and reads show the signed-out progress plus U's local practice, synced copy and unsent outbox.
  - The synced store imports U's local key into U on selection, whatever the claim (`importLocal`).
  - Queued imports now merge instead of replacing.
  - The NaN is fixed.
  - Action calls time out after 25 s, so a call that never answers can't hold the flush lock.
- **Data from while the flag was on:** it stays in the browser (the account's cache and outbox) and on the server. With the flag off it still shows to that account's valid session and to nobody else. When the flag is back on, the outbox flushes and the account's local practice is imported. This follows the plan's rollback note (section 12), which now says so.
- **Blank unit names:** not reproduced. The data and render are complete for all six levels on production (signed out, flag off) and locally (signed in, flag on, direct load and client navigation), checked in Chromium.
  - The new unit test (every unit of every level named) and the e2e test (unit names on /progress, signed in) both pass. If it happens again, a screenshot and the browser's extensions (a translator, for example) would help.
- **Real-browser test:** `npm run test:progress-e2e` needs `PROGRESS_TEST_EMAIL` and `PROGRESS_TEST_PASSWORD` in .env.local, plus a password sign-in on that account.
  - It builds with the flag on, starts `next start` on port 3200, signs in, does a full run, refreshes (score kept), checks /progress (the lesson and all unit names), checks the Supabase row, signs out (hidden) and back in (back).
  - It leaves a flag-on build in `.next`, so run `npm run build` afterwards.
  - It's required in the plan's section 13 before the flag goes on in Production.
  - It adds the dev dependency @playwright/test 1.65.1 (Chromium only), with playwright.config.ts and e2e/progress.spec.ts. Playwright's output folders are git-ignored.
- **Tests:** lib/progress-local.test.ts (10): signed-in local writes, flag on to off, flag off to on whatever the claim, the facade fallback, the action timeout, unpassed lessons imported, merged imports, the cookie reader against cookies written by @supabase/ssr itself (single and chunked), and unit names.
- **Checks:** all pass. validate:content, test:content, test:checker (36), test:progress (134), test:progress-e2e (1, real Chromium and Supabase), test:checkout (10), test:safe-next (7), test:webhook (70), tsc, test:no-supabase-env (21 PASS), build, and test:gating on a fresh server.
- **Cleanup:** these runs left test rows for the test account. In the Supabase SQL editor, with the test email in all three lines:

  ```sql
  -- Test account only. If the email matches no user, nothing is deleted.
  delete from public.exercise_results      where user_id = (select id from auth.users where email = 'progress-test@example.com');
  delete from public.lesson_progress       where user_id = (select id from auth.users where email = 'progress-test@example.com');
  delete from public.writing_task_progress where user_id = (select id from auth.users where email = 'progress-test@example.com');
  ```

## Production smoke test of progress sync (Prompt 65)

- **New:** e2e/production-smoke.spec.ts, playwright.prod.config.ts (Chromium against https://frenchproperly.com, no local server) and `npm run test:prod-smoke` (credentials from .env.local). The local e2e config now ignores the smoke spec. No app code changed.
- **What the test does:** signs in as the test account, deletes its own rows first (own-row delete policy, never the service role), then runs the seven steps. It logs console errors, failed requests and every server-action response.
- **Result (26 November 2026): FAIL at step 4.**
  - 1 PASS: signed in, answered the set, "Best score 3 / 11" (a partial score).
  - 2 PASS: the score survived a refresh.
  - 3 PASS: /progress lists the lesson under "Started, not finished", and every level shows its unit names (A1 6, A2 8, B1 9, B2 8, C1 8, C2 8).
  - 4 FAIL: no exercise rows for the lesson after 30 s. No server action was called at all: the run's network log has no `Next-Action` request (only two aborted prefetches).
  - 5 to 7: not run (the test stops at the first failure).
- **Cause, seen in the deployed JavaScript:** the progress module was compiled with the flag set to `"no"` (`flag:"no"`), so `progressStore` is the browser-only store and nothing is synced. The bundle has the Prompt 64 code (`parlons-progress-v1:local:`), so it's the latest code but built without the flag on. Steps 2 and 3 passed because that store now keeps the signed-in learner's practice under the account. Production Vercel's `NEXT_PUBLIC_PROGRESS_SYNC` must be exactly `on` when the build runs (it's inlined at build), so redeploy after setting it, without reusing the previous build.
- **Cleanup:** nothing to remove on the server. The pre-run own-row delete cleared earlier test rows, and this run wrote none. The browser data lived in throwaway contexts.

## /practice hub of review lessons, home Practice card, clickable units on /progress (Prompt 66)

- **/practice** (app/practice/page.tsx, components/practice-levels.tsx, lib/practice.ts): an index of the 49 existing review lessons, with no new exercises.
  - Review lessons are found by the content's own `type: review`. A level's review is the review lesson that is the level's last lesson in course order; it goes at the end of the level as "<level> level review". Every other review lesson is its unit's review.
  - It's grouped by level, then unit, in /lessons order. Each entry shows the title, the exercise count and the learner's best (or "Not started"), and links to `<lesson>#practice`.
  - Units with no unit review show "No review for this unit yet": A1 Getting around, A2 Everyday interactions, B1 Food, culture and wrap-up, and B2 Registers and debate (each ends with its level review instead).
  - Levels are collapsible `<details>`. Paid levels show a "Lifetime access" lock for learners without access; it's a small Suspense slot with an access check, the same size either way, so the page is a partial prerender. Scores come from progressStore after mount, into fixed-width slots.
  - It uses the slim list; the content index is in no client chunk. JS: 29.8 KB raw (9.2 KB gzip) for the page's own chunks, 312 KB (84.5 KB) with layout and framework entries.
  - It's indexable, in the sitemap, and has one line in llms.txt.
- **Anchors:**
  - Levels are `#a1` … `#c2`, units `#<level>-<unit slug>` (for example `#a1-getting-started`), and level reviews `#<level>-level-review`.
  - Lessons have `#practice` (the exercise section, which already existed) and `#writing-task` (C2).
  - lib/hash-target.ts opens any closed `<details>`, scrolls the target to the top (`scroll-mt-6`; the header isn't sticky) and moves focus (the unit heading, or the "Practice" heading). It runs on a full load, after client-side navigation, and on a same-page hash change, with short retries for streamed content.
  - Checked at 1280 px and 375 px: the target sits 24 px from the top with focus on its heading.
  - A paid lesson's `#practice` shows the usual sign-in or paywall panel, with no exercises.
- **Home:** the "Smart practice" card is now "Practice" ("Every unit review in one place, with your best score."), and the whole card links to /practice, like "Clear lessons". "Daily review" is unchanged.
- **/progress:** unit names and level codes link to their /practice sections. Continue, "Started, not finished" and review links go to `#practice`; writing tasks go to `#writing-task`. A "Practice" link sits at the top. Scores are unchanged.
- **Header:** unchanged. At 375 px the three links and "Sign in" already wrap onto a second line (nav 88 px tall), so a fourth link wouldn't fit comfortably on mobile without a menu.
- **Tests:**
  - lib/practice.test.ts (6): all 49 review lessons listed once and nothing else, level reviews last, every unit named and present in order, unique anchors, exercise counts and links.
  - test:gating: /practice 200 with no paid content, every review linking to its own page, the lock shown signed out, indexable.
  - test:no-supabase-env: /practice 200.
  - test:progress-e2e: from /progress, "Getting started" opens /practice at the unit (open, in view, focused), and its review lands on the exercises (in view, focused).
  - The e2e and smoke specs now find unit names whether they're links or text.
- **Checks:** all pass. validate:content, test:content, test:checker (36), test:progress (140), test:progress-e2e (then npm run build), tsc, build (new ◐ /practice), test:no-supabase-env (22 PASS), test:gating on a fresh server, test:webhook (70), test:checkout (10), test:safe-next (7).

## Pricing: lifetime price as fast as the free card; duplicate-charge access fix; /practice wording (Prompt 67)

- **Measured cause:**
  - The free card is prerendered. The lifetime card waited, in a Suspense, on four Supabase calls in a row: getUser, then pricing_settings, then get_founder_spots_left, then the entitlement check.
  - Vercel runs the functions in **iad1** (Washington; `x-vercel-id: hkg1::iad1::…`). The Supabase database is in **ap-northeast-2** (Seoul; its address is in AWS's ap-northeast-2 ranges). Every call crossed the Pacific.
  - From here, each call took about 150 ms warm and 150–420 ms cold. Before the change, the lifetime card arrived at 3.4 s cold and 1.2–1.9 s warm on production, and 765 ms cold and 317 ms warm on local `next start`.
- **Caching:**
  - New lib/shared-pricing.ts. `getSharedPricing` is a `use cache` function, cached for all visitors with `cacheLife({ stale: 60, revalidate: 60, expire: 300 })` and tagged `pricing`. It reads pricing_settings and the founder spots in parallel with a cookie-free anon client (lib/pricing-source.ts).
  - It's filled while the page prerenders, so the price, the struck price, "Save 33%", the founder line and the ribbon are in the static shell with the free card. /pricing now builds as ◐ with a 1 m revalidate and 5 m expire.
  - On a failure the function returns `{ ok: false }` with `cacheLife` expire 0, which Next.js leaves out of the prerender and its default handler never stores. So a failure is never cached and the "temporarily unavailable" state is computed per request. (A throw from `use cache` during prerender fails the build, as the no-config test showed, so it never throws.)
- **Invalidation:** the payments webhook route calls `revalidateTag("pricing", { expire: 0 })` after a `granted`, `revoked`, `revoked_out_of_order` or `disputed` outcome.
- **Per-visitor slots:** on /pricing only the button streams: a sign-in link, the buy button, or "You have lifetime access". Its slot is reserved at `min-h-[6.75rem]`.
  - `getCurrentUser` answers null at once when no `sb-…-auth-token` cookie exists, so signed-out visitors make no auth or entitlement call.
  - The user and the shared price are read in parallel.
  - The lesson gate uses the shared price too (entitlement and price in parallel). The gated body itself still waits on the access check, which decides what to show.
  - The /practice locks stream on their own, with the list in the first pass.
  - Checkout still reads the live price and refuses with price-changed; a test confirms a cached old price can't be charged.
- **After:**
  - Local `next start`: the lifetime price arrives in the same chunk as the free card, at 7–16 ms warm and 155 ms on the first request after start. The signed-out slot follows at 21–35 ms.
  - Production: not measured, since it isn't deployed. With the price in the prerendered shell, it should arrive with the free card (about 0.12 s warm).
  - Further gain for signed-in visitors: set the Vercel function region to icn1 (Seoul), next to Supabase, under Project → Settings → Functions.
- **Entitlement:** lib/entitlement.ts `hasActivePurchase` uses `.eq("status", "active").limit(1)`, so at least one active purchase means access. Refunded and disputed stay excluded, and errors fail closed. lib/purchases.ts `hasActiveEntitlement` uses it. Tests cover one active, two active, active plus refunded, all refunded, disputed, another user's purchase, and an error.
- **/practice:** the four units with no review (A1 Getting around, A2 Everyday interactions, B1 Food, culture and wrap-up, B2 Registers and debate) now say "Covered by the <Level> level review", a same-page link to `#<level>-level-review` that opens, scrolls to and focuses that review.
- **Tests:**
  - lib/pricing-cache.test.ts, in test:checkout (23 with the existing ones): a stale cached price is refused; the loader reads in parallel and throws on each failure; which outcomes invalidate; the route wires the invalidation; the entitlement cases.
  - test:gating: the price is in the first pass before any streamed part, the signed-out slot is the sign-in link, the /practice list comes first, and the paid lesson's sign-in panel shows the shared price.
  - test:no-supabase-env: /practice shows the new wording.
  - test:webhook: its module hook now resolves `next/cache`.
- **Checks:** all pass. validate:content, test:content, test:checker (36), test:progress (140), tsc, build, test:no-supabase-env (22 PASS), test:gating on a fresh server, test:webhook (70), test:checkout (23), test:safe-next (7). test:progress-e2e and test:prod-smoke were not run, as asked.

## Daily review plan (Prompt 68), plan only

- **New:** docs/plans/review.md. No code, migration or content changed.
- **Audit:**
  - saved_vocab is unused by any code or UI. It has user_id, vocab_id, lesson_id and saved_at, with primary key (user_id, vocab_id), and RLS that allows reading, inserting and deleting your own rows, with no update.
  - Vocab lives in lesson frontmatter (`{ id, fr, pron, en, group?, note? }`), rendered by `<VocabTable>`. Gender comes from the article in `fr`, except 190 `l'` entries. 756 entries hold variants.
  - 5,228 items (A1 805, A2 663, B1 868, B2 1,028, C1 902, C2 962). Without the 373 glossary entries, 4,855 are card candidates, 81 of them repeats of an earlier French entry.
  - The ids are already explicit (`<lesson-id>-v001`), unique and validated. Only a "never removed or renamed" check is missing.
- **Recommendations:**
  1. Cards come automatically from lessons the learner has practised.
  2. French → English, self-graded, with gender shown and not tested.
  3. Leitner, 5 boxes (1, 3, 7, 16, 35 days), 10 new cards a day, at most 60 reviews a day, 20-card sessions.
  4. A1 and A2 for everyone; paid levels with access only, with card text sent only after an access check; signed-out cards stay in the browser.
  5. A new `review_cards` table plus `apply_review()` (later review wins whole, a 6,000-card cap), reusing the progress outbox, facade, flag and import rules. saved_vocab is kept for a v2 manual source.
- **Size:** about 230 B per card, about 69 KB for a typical learner and about 1.1 MB for one with every card. 1,000 typical users come to about 152 MB in total (cards, progress, and the 13 MB used now) of 500 MB.
- **Rollout:** 6 steps: migration, content ids and validation, scheduler and local store, sync, pages, and the wrap-up with e2e and prod smoke.
- **Open questions:** 6, in the plan's section 9.
- **Checks:** validate:content and build pass (nothing else changed).

## Daily review step 1: decisions and migration 0008 (Prompt 69)

- **Decisions** (docs/plans/review.md section 9, which replaces the open questions):
  - Automatic cards from practised lessons only. Glossary entries excluded. No gender for the 190 `l'` entries.
  - 10 new cards a day, at most 60 reviews a day, 20-card sessions plus "Do another 20".
  - French → English, self-graded, with "Not yet" back to box 1 and intervals of 1, 3, 7, 16 and 35 days.
  - The /review empty state links to /practice.
- **Card id for repeats:** entries become one card only when both the French and the English match after normalising (NFC, lower case, curly apostrophes made straight, `. , ; : ! ? … " « » ( ) [ ]` made spaces, spaces collapsed, accents, hyphens and apostrophes kept). The card id is the vocab id of the earliest matching entry in course order at first publication, frozen in a committed card map (step 2). 38 entries merge, so 4,855 eligible entries make 4,817 cards.
- **0008_review_cards.sql** (one transaction, safe to re-run):
  - Table `review_cards (user_id, card_id, lesson_id, box 0–5, due_at, last_reviewed_at, review_count, lapse_count, created_at)`, with primary key `(user_id, card_id)`. Checks: the card-id format, lesson_id equal to the card id's prefix, box 0 if and only if never reviewed, and lapses ≤ reviews.
  - RLS is forced, with read-own and delete-own policies. Everything is revoked from public, anon, authenticated and service_role, then select and delete are granted to authenticated.
  - `apply_review(jsonb)`: security definer, empty search_path, the user only from `auth.uid()`, execute for authenticated only, at most 200 entries per call.
    - It checks ids, box, counts, and times: lastReviewedAt at most 24 h ahead, never clamped; dueAt within 24 h for box 0 and 400 days otherwise.
    - The cap is 6,000 cards per user, checked on insert.
    - Merge: the later last_reviewed_at wins whole; a tie, or an unreviewed entry against a stored card, keeps the stored state; the counts take the max.
    - It returns applied keys and rejected codes (bad_item, bad_id, bad_box, bad_count, bad_time, future_time, cap_reached, invalid).
- **Rollback:** supabase/rollback/0008_review_cards.sql, and rollback_all.sql now covers 0001 to 0008.
- **rls.sql** now needs 0001 to 0008. It checks:
  - apply_review's properties and that review_cards is in the exact privilege list (authenticated: SELECT and DELETE; anon and service_role: nothing);
  - direct insert and update refused for each user; the bad-entry codes; box 0, the first review, a resend, an older state, a tie, an unreviewed entry, a newer review, and 23 h ahead stored as sent;
  - the cross-user read, delete and insert refused, and an entry naming the other user written for the caller only;
  - user C at 6,000 cards (a new card refused, an existing one updated); anon and service_role refused on the table and the function;
  - own-row delete, and the cascade on account deletion. It ends in ROLLBACK.
- **docs/db-setup.md:** the 0008 step and order, the owner's SQL-editor steps (run 0008, then rls.sql, then the Security Advisor), a review_cards size query, and the undo.
- **Checks:** validate:content and build pass (no app or content change). The SQL hasn't been run here, since there's no local Postgres.

## Daily review step 2: card catalogue, id stability and content checks (Prompt 70)

- **Catalogue:** `npm run build:review-cards` (scripts/build-review-cards.ts, plain Node, works in PowerShell) builds the cards with lib/review-catalogue.ts.
  - Glossary entries are excluded. Entries merge only when the French and the English both match after the plan's normalising.
  - The card id is a card id already published among the matching entries, otherwise the earliest entry's vocab id in course order.
  - Each card has: id, lessonId, level, fr, en, the optional pron, group and note, and vocabIds.
  - Totals: 5,228 vocab items, 4,855 eligible, 4,817 cards. Two runs give byte-identical files.
- **Files** (lib/generated/):
  - review-cards-free.json: A1 and A2, 1,430 cards, 310 KiB. It may be bundled later.
  - review-cards-paid.json: B1 to C2, 3,387 cards, 791 KiB. It's imported only by lib/review-cards-server.ts, which starts with `import "server-only"`. Nothing calls it yet.
  - review-published-ids.json: every vocab id and card id, by lesson, in course order.
- **Id stability:**
  - A published card id stays put when an earlier or a later lesson adds a matching entry; the new entry joins the card.
  - If an edit makes two published cards match, both are kept.
  - An entry that stops matching becomes its own card, and the old card keeps its id.
  - The build script stops and writes nothing if a published id disappeared or moved.
- **validate:content (check 13):** it fails on any of these, printing what changed or the command to run:
  - card ids that aren't unique, or break 0008's format or lesson-prefix rule;
  - fr or en missing, or an empty string;
  - more cards than 0008's cap;
  - stale files (it prints `npm run build:review-cards`);
  - a published vocab id or card id that's gone, has moved lesson, or is no longer a card;
  - changed totals: to change them deliberately, update EXPECTED_REVIEW_TOTALS in scripts/validate-content.ts and rebuild.
  - The 160-character id limit now covers vocab ids too, and the check prints a "Review:" totals line.
- **test:review** (scripts/review-cards.test.ts, scripts/review-bundle.test.ts, fixture scripts/fixtures/review-cards), 15 tests:
  - determinism; glossary exclusion; the merge rule (same French, different English stays separate; case, punctuation and curly apostrophes match);
  - stable ids for an earlier or later matching entry; published-id protection (removed, made glossary, moved); stale files; totals; the free/paid split;
  - only lib/review-cards-server.ts imports the paid file, and nothing review-related is in public/;
  - the client-bundle walk.
- **Client-bundle test:** it walks .next/static and public/ for paid card text: string literals in JS (JSON inside a literal and \u escapes included), and whole words elsewhere. Text that's also a free card's is skipped.
  - A card counts as leaked when its French (2 or more words) or its English (3 or more words) appears, or both its sides appear. Single words such as "online", "or" and "large" matched code and CSS, and "an account" matched llms.txt, so they don't count alone.
  - Coverage: 3,155 paid cards detectable from one side, 225 only as a pair, 7 not at all (both sides are free text or the same single word).
  - A planted-leak self-test passes. Result: no paid card text found.
- **0008:** after the owner's fix at line 196, I checked the rollbacks and rls.sql for a CASE inside an IF or ELSIF condition. There are none: every other CASE is in an assignment, a declaration or a SELECT.
- **docs/plans/review.md:** status updated, with a note under step 2 on the names as built (one free file for A1 and A2, not one per level).
- **Checks:** all pass.
  - validate:content, test:content, test:checker (36), test:review (15), test:progress (140), tsc and build (357/357).
  - test:no-supabase-env, test:gating (on a fresh build and server), test:webhook (70), test:checkout (23) and test:safe-next (7).

## Daily review step 3: scheduler and local store (Prompt 71)

- **lib/review-scheduler.ts** (pure):
  - **Leitner:** boxes with intervals of 1, 3, 7, 16 and 35 days. "I knew it" moves the card up one box (box 5 stays at 5). "Not yet" sends it to box 1 and counts a lapse.
  - **Choices where the plan was silent:**
    - A new card (box 0) goes to box 1 on either first answer.
    - A new card's first "Not yet" isn't a lapse.
    - A "Not yet" card comes back once at the end of the session (plan section 3). The repeat doesn't change its schedule or count towards the limits.
  - **Days:** the device time zone's calendar days (Intl, `calendarFor`).
    - Due means dueAt falls on or before the end of today.
    - The next due time is the start of the local day `interval` days on, by calendar, so it holds across daylight-saving changes and in zones where midnight is skipped.
  - **Limits:** 10 new and 60 reviews per local day, counted as distinct cards in a daily log. Cards from an earlier batch that haven't been answered yet count too.
  - **Sessions:** `buildSession` gives up to 20 cards: due cards first (oldest due first, then course order), then new cards in course order. Calling it again with the earlier batches excluded is "Do another 20".
  - **Deck:** `deckAdditions` adds the cards of practised lessons (an answered exercise or a finished run), including the cards their entries joined in other lessons.
    - Paid cards are added only with access, and `cardAllowed` keeps them out of every session without access, even when their state exists.
    - The data is the new lib/generated/review-card-ids.json (ids and levels by lesson, no text, 52 KB), built by build:review-cards and checked by validate:content as the fourth review file.
  - **Merge:** `applyReview` is apply_review's rule. `mergeReview` (commutative, associative and idempotent) differs only on an exact tie of lastReviewedAt: the higher box wins, then the later dueAt. Neither validates (the server's checks stay in 0008), times are compared in milliseconds, and lesson_id and created_at aren't client state.
  - **Clock:**
    - Review times are never more than 24 hours ahead of the device's clock.
    - If the clock went backwards since the last answer, the review time is 1 ms after the stored one, so the answer still wins.
    - A clock more than 24 hours fast will be rejected by 0008 (future_time) in step 4. Up to 24 hours fast is accepted and can win over correct answers for that long.
    - A slow clock makes due cards come up early and can lose a merge.
- **lib/review-store.ts:** a `ReviewStore` interface and `LocalReviewStore`.
  - Signed out, cards go under `parlons-review-v1`. Signed in (a valid session from the cookie, no network), they go under `parlons-review-v1:local:<userId>`, with the owner inside the value. Reads merge in the signed-out cards, as progress does.
  - The store keeps ids, boxes, times and counts only, packed as `[box, dueMs, lastMs, reviews, lapses]` per card, grouped by lesson. No card text.
  - Legacy, empty, wrong-owner and broken values load as empty, and bad entries are dropped one by one. Blocked or full storage doesn't throw.
- **Sizes in localStorage:**
  - Every card, at worst: 232,115 characters (227 KiB).
  - Progress for everything practised: about 646 KiB.
  - About 873 KiB together, or about 1.5 MB if a signed-in learner also has the synced progress cache. That's well inside the usual 5 MB.
- **Import-graph test** (scripts/review-imports.test.ts):
  - It walks every "use client" module in app/, components/ and lib/ and everything they import (static, re-export, dynamic and require; type-only imports skipped; the walk stops at "use server" actions).
  - It fails if review-cards-paid.json, review-cards-free.json or lib/review-cards-server.ts is reachable. A planted-graph self-test passes.
  - Result: 8 client entries, 27 client modules, none of the three reached.
  - The step 2 text-search test now skips test files.
- **docs/plans/review.md:** the status line, section 10 (as built in step 3) and section 11 (the rules for later steps: only the session's card text is fetched; the import graph is the guarantee and the build text scan is the backup; the text action checks access and takes at most 20 ids).
- **test:no-supabase-env** now rebuilds a normal build when it finishes, so test:gating runs straight after it.
- **test:review:** 38 tests in 5 files: scheduler, store, catalogue, import graph and bundle scan.
- **Checks:** all pass.
  - validate:content, test:content, test:checker (36), test:review (38), test:progress (140), tsc and build (357/357).
  - test:no-supabase-env (it ends with the normal rebuild), test:gating (on a fresh server, straight after it), test:webhook (70), test:checkout (23) and test:safe-next (7).
