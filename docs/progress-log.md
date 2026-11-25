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
