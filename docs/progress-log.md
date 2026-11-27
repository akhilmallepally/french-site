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

## Daily review step 4: server actions, sync, import, and the daily-limit fix (Prompt 72)

- **A. Daily limits:** the limits (10 new, 60 reviews) count only cards answered that local day.
  - Cards drawn into a session and not answered don't count.
  - The day's log keeps the drawn cards (`drawn`, written by the new `recordDrawn`), and `buildSession` offers the drawn, unanswered ones first, in their order, then due cards, then new ones.
  - The old test that counted pending cards was replaced, and a test for a reopened /review was added.
- **B. Server actions** (app/actions/review.ts: `getReviewAction`, `syncReviewAction`, `resetReviewAction`; the core is in lib/review-sync.ts and the queries in lib/review-db.ts):
  - The user comes from the session; without Supabase config the actions answer `signed-out`.
  - Validation uses lib/generated/review-card-ids.json, imported as a module.
  - **Payload, rejected whole:** bad shape, 0 or more than 200 entries, more than 128 KiB, a key that isn't `r:…`, a duplicate key, or any field outside the eight allowed (so card text or a user id is refused).
  - **Per entry:** `bad_item`, `bad_id`, `unknown_id`, `wrong_lesson`, `bad_box`, `bad_count`, `bad_time` (at most millisecond precision), `future_time` (lastReviewedAt more than 24 h ahead; dueAt as in 0008) and `no_access`.
  - **Paid cards:** access is checked at most once per call, and only when a paid card is involved. Writes without access are rejected per entry (`no_access`); reads leave paid cards out, and unknown stored ids too.
  - **Reply:** `{ status, applied, rejected, rows }`, with rows read back in the same request and millisecond ISO times.
  - `isFreeLevel` moved to the new lib/free-levels.ts (lib/lessons.ts re-exports it), so neither the action nor the client store imports lib/lessons.ts.
- **C. Synced store** (lib/review-sync-store.ts, `SupabaseReviewStore` and `ReviewSyncFacade`; the pure outbox and keys are in lib/review-outbox.ts):
  - The flag is `NEXT_PUBLIC_REVIEW_SYNC=on`, separate from progress and off by default, exported from lib/review.ts. lib/review-wiring.ts reuses the progress auth wiring.
  - **Reused from progress:** `browserEnv`, the timings (1 s debounce, 30 s to 5 min backoff, 25 s timeout), `isActionNotFound` (the 409 pause) and the import-claim key.
  - **Outbox:** one key per card (`r:<cardId>`), holding whole states, so resends and imports merge with `mergeReview`. One in-flight and one pending entry, Web Locks for the outbox and the flush, batches of at most 200 entries and 120 KiB. The server's rows win, with pending entries on top.
  - **Rejections:** logged, kept for display and never resent. A malformed reply or an invalid payload pauses sending.
  - **Accounts:** per-user cache, outbox and rejection keys. Early reads trust the last account only while the cookie holds its unexpired session. Other accounts' caches are swept on every switch. A `signed-out` reply is checked with the auth server and handled as a sign-out (the cache goes, the unsent outbox stays for that account). A `wrong-user` reply stops sending.
  - **Flag off:** `LocalReviewStore`, now also showing the signed-in account's synced cache and unsent outbox.
  - **Import:** signed-out cards go to the owner of the progress import claim (`parlons-progress-import-owner-v1`, the same key, set by the first account if it's unset; never a second claim). They're queued with the `parlons-review-imported-v1` marker under the lock, so an interrupted import resumes and nothing is queued twice. An account's own local key always goes to that account and is then removed.
  - The first load never waits: reads answer from the trusted cache or the local store while the wiring loads.
- **D. check:review-db** (scripts/check-review-db.ts): the test account from .env.local, through runReviewSync and runReviewGet with the real access check and lib/review-db.ts.
  - It checks read-back, an unknown id, a 25 h future time (validator and apply_review), card text refused whole, another user, a paid card without access (forced off if the account has access), idempotency, an older state, the whole-user read, and the 6,000 cap (filled with made-up ids through apply_review; an update still works at the cap).
  - It deletes the account's cards at the end with its own delete policy. Not run here.
- **HTTP:** test:gating and test:no-supabase-env check the review actions refuse a signed-out caller. That check passes trivially for now: no page loads the actions yet, so they aren't in the build's manifest. It becomes real in step 5.
- **test:review** (77 tests):
  - review-sync: validation, `no_access`, the contract, `cap_reached`, a malformed database reply.
  - review-sync-store: local first, the frozen in-flight entry, batching, the server winning, rejections, `no_access`, backoff, the 25 s timeout, the 409, malformed and invalid pauses, two tabs.
  - Facade and flag: the first load, accounts, sign-out, session expiry, wrong-user, the import claim and its reuse, resuming, local-key import, the flag both ways, no wiring or fetch with the flag off, signed-out parity, lib/review.ts off by default.
  - The import-graph test also proves the review action loads no `fs`, no lib/lessons.ts and no card text, and that lib/review.ts as client code reaches neither card text nor lib/lessons.ts.
- **Docs:** docs/plans/review.md (status line and section 12) and docs/db-setup.md (how to run check:review-db).
- **Checks:** all pass.
  - validate:content, test:content, test:checker (36), test:review (77), test:progress (140), tsc and build (357/357).
  - test:no-supabase-env (ending with the normal rebuild), test:gating (on a fresh server), test:webhook (70), test:checkout (23) and test:safe-next (7).

## Daily review step 5: /review, card text, home card, the /progress line, real-browser test (Prompt 73)

- **0. Verification:** the "access forced off" path in check:review-db can't be reached by a request.
  - Both review actions build the access check only from the session (`accessFor(s.supabase, s.userId)`), and the text action only from `getCurrentUser`.
  - No action argument, header, query or request-time environment read changes it. A payload field such as `hasAccess` rejects the call (`unexpected_field`).
  - The forced-off function exists only in the script, as its own injected dependency. Nothing was removed. lib/review-text.test.ts pins the action sources and the payload refusal.
- **1. Card text:** `getCardTextAction` (app/actions/review-text.ts; the core is lib/review-text.ts).
  - It takes up to 40 unique card ids and returns `{ status: "ok", cards: { id: { fr, en, pron?, group?, note? } }, access }`.
  - Free cards come back for anyone, also with no Supabase config. Paid cards come back only after one access check per call, which fails closed; otherwise they're left out.
  - It's the only reader of lib/review-cards-server.ts, so app/actions/review.ts stays free of card text.
  - /review fetches a batch's text in one call before its first card, and again for "Do another 20". The text is kept in memory only.
- **2. /review** (app/review/page.tsx, static, noindex, not in the sitemap; components/review-session.tsx; the pure logic is in lib/review-session.ts):
  - The header shows "N due today · M new cards left today". The card has the French, the pronunciation and the group; "Show answer" reveals the English and the note in a space that's always kept.
  - Space or Enter shows the answer, then 1 (Not yet) or 2 (I knew it). The buttons are 56 px tall. "7 / 20" is shown, with a polite live region, and the card is focused after each step.
  - A "Not yet" card is repeated once at the end. The summary shows reviewed, known and the next due day, then "Do another 20" or "All done for today" with a link to /practice. The empty state uses the plan's text.
  - Offline or a failed fetch shows "Couldn't load your cards. Check your connection and try again." with Retry. Answers are already saved locally.
  - Signed out with sync on, a sign-in line appears below the card.
  - **Paid cards:** the batch is built as if the learner had access, and the text reply's `access` decides. Without access the batch is rebuilt from stored free cards, so no paid card is shown or its text returned.
  - The access answer is remembered per user in `parlons-review-access-v1`, for counts only.
- **3. Home:** the "Daily review" card links to /review ("A few minutes a day to keep the words you've learned."); the old text promised more.
- **4. /progress:** a "Daily review:" line at the top, linking to /review ("N cards due today", "No cards due today", or nothing before any lesson is practised). It's read in the same pass as progress, so nothing shifts.
- **Privacy page:** it now says the daily review keeps card states (word, box, due time, counts) locally and, signed in, in Supabase.
- **5. HTTP checks are now real:**
  - test:gating: sync, get and reset refuse a signed-out caller. Card text gives a signed-out caller free text, never paid text (`access:false`), and refuses 41 ids. /review is noindex, holds no card text, and isn't in the sitemap.
  - test:no-supabase-env: the review actions are in the build and refuse; free card text works and paid text doesn't come back; /review renders.
- **6. Real-browser test:** e2e/review.spec.ts, with the shared sign-in and run helpers moved to e2e/helpers.ts. test:progress-e2e builds with both flags on.
  - Signed in: practise A1 "alphabet and accents"; /review shows "1 / 10" and "0 due today · 10 new cards left today". Answer four (one "Not yet", so "5 / 11"), refresh: "1 / 6", the counts right, and none of the answered cards.
  - Finish: "6 cards reviewed, 6 known.", "All done for today", "Next cards due tomorrow." Ten rows have box ≥ 1 in Supabase. /progress says "No cards due today". After signing out, /review shows the empty state and the sign-in line.
  - Cleanup deletes review_cards and the progress rows with the account's own delete policies, and checks 0 are left.
  - **Without access** (signed out, whatever the account has): a seeded paid card never appears ("1 / 1", the free card only), and its text is in neither the page nor any action reply. At 375 px there's no sideways scroll and the card keeps its size and position when the answer is shown.
  - **Offline** (action calls fail): the message and Retry appear, the earlier answer is kept, and after Retry the remaining card shows.
- **JS** (gzip, beyond the home page's): /review 23 KiB, mostly the 52 KB id index. /progress grows by the same index and the review store (24 KiB beyond home now).
- **test:review** (90 tests): it adds lib/review-text.test.ts (free, paid with and without access, the check failing, 40 ids, bad input, no config, the access verification) and lib/review-session.test.ts (counts, the /progress line, the empty and done states, the provisional batch, reveal and grade with the repeat, the keys, the summary, the next due day). The import-graph test now also proves the text action reads the card files on the server only.
- **Checks:** all pass.
  - validate:content, test:content, test:checker (36), test:review (90, on the flag-on and the normal build), test:progress (140), test:progress-e2e (4 of 4, then `npm run build`), tsc and build (358/358).
  - test:no-supabase-env, test:gating (on a fresh server), test:webhook (70), test:checkout (23) and test:safe-next (7).

## Daily review step 6: wrap-up, production smoke test, docs (Prompt 74)

- **test:prod-smoke** (e2e/production-smoke.spec.ts): the progress part and a new review part now run in order (serial). The review part prints PASS or FAIL per step:
  - **R0:** reads the value the live build inlined for NEXT_PUBLIC_REVIEW_SYNC from /review's JavaScript (the createReviewStore call whose loadWiring loads createReviewWiring). Unless it's exactly "on", it fails at once with "Review sync is not on in production; set it to exactly on and redeploy without the build cache."
    - Checked on local builds only: a normal build reads as the unset property, and a build with the flag on reads `"on"`.
  - **R1:** practise A1 "greetings" (8 cards, none shared), open /review, answer 3, refresh: it resumes at "1 / 5", with "0 due today · 5 new cards left today" and none of the answered cards.
  - **R2:** finish; "5 cards reviewed, 5 known.", and 8 rows with box ≥ 1, read through the account's own session.
  - **R3:** a second browser context shows the same /progress "Daily review" line as device 1 (it would offer the 8 cards as new if the rows hadn't synced), and "All done for today" on /review.
  - **R4:** sign out on device 1; /review shows the empty state and the sign-in line.
  - **R5:** delete the account's review_cards and progress rows with its own delete policies, and check 0 are left. On a failure it prints the cleanup SQL for all four tables.
  - Not run here: the owner runs it after turning the flag on.
- **docs/plans/review.md:** the status line (steps 1 to 5 done, step 6 pending the owner's production run), each rollout step marked, and section 14 (the smoke test, and what's deliberately out of v1: manual saving, English → French and typed answers, gender for the `l'` words, audio, streaks and a synced daily log).
- **docs/project-state.md:** a Daily review entry in the status (what's built, the tests, the flag off in Production until test:prod-smoke passes, access, the storage estimate, what's next), and the next-steps lines updated.
- **docs/db-setup.md:** section 7 has a combined size query for the three progress tables and review_cards (rows, learners, size with indexes, average per learner), with the estimates to compare against, next to the existing review_cards query.
- **Content follow-up, recorded, not done:** the new docs/review-content-todo.md lists gender notes for the `l'` words: 190 vocab entries, 189 cards (A1 36, A2 16, B1 19, B2 23, C1 60, C2 35), 141 of them with no note. It covers what to add, the rules (text only, rebuild the catalogue), and native review of every gender.
- **No app code changed.**
- **Checks:** validate:content, test:review (90), tsc and build (358/358) pass.

## Fix the review flag check in test:prod-smoke (Prompt 75)

- **Cause:** R0 looked for the inlined NEXT_PUBLIC_REVIEW_SYNC value in /review's JavaScript. Production's bundle didn't match the pattern, which only had to hold for the two local builds it was checked on, so R0 failed although review sync was on: the same run showed `getReviewAction` answering `{"status":"ok","cards":{}}` on both devices.
- **New R0 (behavioural):** signed in as the test account, it opens /review and waits up to 10 s for a server action reply (a POST with a `Next-Action` header) whose body has `"status":"ok","cards":{`. That's `getReviewAction`, which the review store calls only when sync is on; with the flag off it makes no network calls.
  - If no such reply arrives, R0 fails with the same message: "Review sync is not on in production; set it to exactly on and redeploy without the build cache."
  - It runs before anything is written. The bundle-reading helper (`liveReviewFlag`) is removed.
- **Progress:** unchanged. The progress part never read the bundle's text; it checks behaviour (the rows on the server, the second device).
- **No app code changed.** test:prod-smoke wasn't run here.
- **Checks:** tsc passes, and `npx playwright test --list --config playwright.prod.config.ts` lists both tests ("progress sync on the live site", "daily review on the live site").

## Pricing v2, step 1: founding deadline, countdown, banner, paid-only daily review; the subscription plan (Prompt 76)

**Part A: built.**
- **Migration 0009** (supabase/migrations/0009_founder_deadline.sql, with its rollback; rollback_all now covers 0001 to 0009):
  - It adds `pricing_settings.founder_ends_at` (not null), set to 2026-12-31T16:59:00Z.
  - A trigger, `guard_founder_deadline`, refuses any change unless the transaction sets `app.allow_founder_deadline_change` (only a migration does).
  - rls.sql needs 0009. It checks the value, the not-null, the guard's properties, a refused change, a deliberate change (undone), and that anon reads the column but can't change it.
  - The owner fixed 0009 before running it: `pg_catalog.coalesce` isn't valid, because COALESCE, GREATEST, LEAST and NULLIF are SQL syntax, not functions. The owner then ran 0009 and rls.sql (all passed) and the test-account grant.
  - **SQL checks:** every migration, rollback, rls.sql and the db-setup.md SQL parse with the real Postgres parser (libpg_query in the scratchpad, not a project dependency), and a planted CASE-in-IF bug is caught. The new `npm run check:sql` (no dependencies) flags schema-qualified COALESCE, GREATEST, LEAST or NULLIF; 24 SQL sources are clean.
- **The deadline, enforced on the server:**
  - lib/pricing-offer.ts has three states: `founder` (spots > 0 AND now < founder_ends_at), `ended` (`deadline` or `sold-out`) and `unavailable`. The old "standard lifetime price" state is gone.
  - Every decision takes an explicit time. The 60-second shared cache holds the numbers, the spots, the deadline and when it was read (`readAtMs`), never the "is it live" answer.
  - **Checkout** (`runCheckout(…, Date.now())`) refuses $8 after the deadline, or once the spots are gone, with `price-changed` and "The founding offer has ended. A new plan is coming soon.", even from a page opened before. Tested with an injected clock (1 ms before and after, after the deadline whatever the spots, and the spots running out first).
  - **Pages:** lesson access and the pricing button slot use the request's time (after `connection()`). The prerendered price uses `readAtMs`, and the browser re-checks on its own clock.
  - A missing or bad deadline fails closed: pricing shows as unavailable (seen at build before 0009: code 42703).
  - The struck-through "$12 regular price" and "Save 33%" are removed: there's no lifetime price after the offer to compare with.
- **Countdown** (components/founder-offer.tsx; the clock hook is components/use-founder-clock.ts):
  - "Founding offer ends in 12 days 4 hours" (hours and minutes in the last 24 hours), plus "Ends 31 Dec, 23:59 Bangkok time". The server renders it in Bangkok time, then the browser switches to the visitor's zone and city ("17:59 Paris time").
  - The spots line reads "Founder price for the first 100 learners."
  - It updates each minute and exactly at the deadline, with no hydration mismatch (the first browser render uses the server's time).
  - Screen readers get one static sentence ("The founding offer ends on 31 December 2026 at 23:59 Bangkok time."); the ticking text is aria-hidden, with no live region.
  - At zero on an open page it switches to "The founding offer has ended. New plan coming soon." with a disabled button, and the page no longer offers $8.
  - The FAQ, the card's bullet, the paywall and the sign-in panel ("$8 founding price until 31 December 2026") are updated. llms.txt states the 31 December 2026 end, with no price numbers.
- **Reminder banner** (components/founder-banner.tsx, founder-banner-slot.tsx, lib/founder-banner.ts):
  - A slim region at the top of every page: "Founding offer: $8 for lifetime access, ends in 12 days. See pricing →" with a Dismiss button.
  - It shows only while the offer is live, never on /pricing or /checkout, and never for learners with access.
  - It's rendered on the server from the cached price only, so pages stay prerendered. They now revalidate each minute with the price.
  - An inline pre-paint script hides it before first paint when it's dismissed (3 days) or for a learner remembered to have access (with a session cookie), so nothing shifts. It's back in the last 48 hours even if dismissed.
  - The access check (`getAccessAction`, new app/actions/access.ts) runs in the background, only with a session cookie, so signed-out visitors make no call. The answer is remembered in `parlons-access-v1`, shared with the review and /progress.
  - Fixed during the browser test: the banner's clock ticks once a minute, so a fresh dismissal was "ahead" of it and ignored by the wrong-clock guard. Dismissals up to a day ahead now count.
- **Daily review for paid learners only:**
  - `syncReviewAction`, `getReviewAction` and `getCardTextAction` require access for every card, free-level ones included. Writes are rejected per entry as `no_access`, and reads and text return nothing (`cards: {}`). Stored rows are untouched and come back after a purchase.
  - /review checks access at request time in a streamed slot. Without access it shows "Daily review is part of lifetime access: a few minutes a day to keep the words you've learned.", the price with its countdown, "See pricing", and (signed out) "Already have access? Sign in". No deck is built and no text is fetched; cards in the browser stay, hidden.
  - The session's "Sign in to keep your review" line is removed.
  - The home card keeps its /review link, with a "Lifetime access" label.
  - The /progress line shows only for learners with access (the remembered answer, so it never appears late).
- **Test account:** docs/db-setup.md has the "Test accounts" SQL. It's a purchase one cent above the founder price, so it never takes a founder spot (as in rls.sql), with `provider_order_id` 'manual-test-access-…', plus a check query and the undo. Emails are compared case-insensitively. Verified: the test account's own session reads one active purchase (801), and the founder spots stay at 99.
- **e2e and the smoke test:**
  - review.spec.ts runs as a paid learner (it stops at once without access) and adds an offline-and-Retry step mid-session. A free-learner test checks the explanation, no card text in the page or any reply, and the browser's cards untouched.
  - The new pricing.spec.ts uses Playwright's fake clock: the open-page switch at the deadline, the visitor's zone, the static screen-reader sentence, and the banner (shown, not on /pricing, Dismiss by keyboard, 3 days, the last 48 hours), all with no hydration errors.
  - e2e/helpers.ts `doFullRun` (and the smoke test's copy) now waits for hydration before the first click. A click before hydration was lost, which timed out the progress spec.
  - test:prod-smoke: R0 first checks the test account has access; R4 expects the explanation; the new R4b checks a free learner in a fresh browser.
- **Pages:** the terms ("3. Lifetime Access") and refund pages state the deadline (31 December 2026, 23:59 Bangkok time, or earlier once the founder places are taken; the same for everyone; existing lifetime access kept). No subscription wording yet.

**Part B: plan only** (docs/plans/subscription.md):
- Dodo's subscription product, checkout, customer portal, events and payloads (with source URLs).
- The events we need and what each does.
- The data: a `subscriptions` table, and entitlement = lifetime OR active within the period plus a 7-day grace.
- The rules, the UI, the pages, and 6 rollout steps finishing by 20 December 2026.
- 5 open questions.
- **The subscription must ship before the founding offer ends.** At the deadline, or as soon as the spots run out, nothing can be bought until it exists.

**Checks:** all pass.
- validate:content, test:content, test:checker (36), test:review (90), test:progress (140), test:progress-e2e (6 of 6, then `npm run build`), tsc and build (358/358).
- test:no-supabase-env, test:gating (on a fresh server: the countdown, the banner, the review lock and no card text without access), test:webhook (73, including a payment confirmed after the deadline still being granted), test:checkout (31), test:safe-next (7) and check:sql.

## Subscription step 1 (migration 0010), static pages again, the yearly comparison line (Prompt 77)

**Follow-up 1: pages static again.**
- **Cause:** in Prompt 76 the banner was a server component in the root layout that read the shared price (a 60 s cache), so every page took that cache's life and revalidated each minute on the server (ISR, not a client refresh).
- **Route table:**
  - Before Prompt 76 (built from the commit before it in a temporary worktree, now removed): only `/pricing` had "1m 5m"; `/`, `/lessons`, `/lessons/a1`, `/lessons/a1/greetings`, `/progress`, `/privacy`, `/refund`, `/terms` and `/review` were plain ○.
  - After Prompt 76: every page had "1m 5m".
  - Now: the same as before Prompt 76 (only `/pricing` 1m 5m), plus `/api/founder-offer` (ƒ). `/review` stays ◐ for its access gate from Prompt 76.
- **The fix:** the banner reads no data on the server.
  - It renders from fixed facts in lib/founder-constants.ts (the deadline, $8, $12) with no clock ("…until 31 December 2026").
  - An inline pre-paint script in the layout hides it at once after the deadline, when dismissed (3 days, except the last 48 hours), when the offer was found sold out within the last hour, or for a learner remembered to have access.
  - In the browser it adds the countdown and fetches the new `/api/founder-offer` (ƒ, decided per request, `s-maxage=60`, no cookies) in the background. "ended" hides it and is remembered; different prices correct the text.
  - components/founder-banner-slot.tsx is removed.
- **Tests:**
  - test:gating checks every prerendered route has no revalidate except `/pricing`, and every lesson route is static.
  - It also checks that `/api/founder-offer` is cacheable and agrees with the constants (so a price change in the database fails it).
  - pricing.spec.ts adds a test where the offer ended early: hidden, and hidden before paint on the next page.

**Follow-up 2:** "From 1 January: $12 per year." under the founder price on the pricing card and paywall (PriceRow, from `standard_price_cents`) and in the banner, shown only while the founder offer is live. The pricing placeholder got a matching line.

**Step 1 of docs/plans/subscription.md** (supabase/migrations/0010_subscriptions.sql):
- `subscriptions`: provider ids (unique), status (active, past_due, on_hold, cancelled, expired, refunded, disputed), `current_period_end`, `cancel_at_period_end`, `cancelled_at` (required when cancelled).
- `subscription_payments`: `provider_payment_id` (unique), `charge_type` new or renewal, status, amount, `refunded_at`.
- Both have RLS forced. Learners read their own rows. service_role (the webhook, which bypasses RLS) has select, insert and update, with no delete; anon has nothing.
- `has_access(p_product, p_now)`: security invoker, empty search_path, authenticated only. It's true for an active lifetime purchase, an active or past_due subscription until `current_period_end` + 7 days, or one cancelled at the period end until `current_period_end`.
- Also: the rollback, rollback_all (0001 to 0010), db-setup.md (steps and the has_0010 check), and the plan's status and decisions.
- **rls.sql** adds user D, with one subscription changed between groups and `has_access` called as D at injected times:
  - active and past_due inside and outside the 7-day grace; on_hold; cancelled at the period end before and after it; cancelled at once; refunded, disputed and expired;
  - a refunded plus an active duplicate; another product; user B's lifetime access years later;
  - D's own reads and refused writes; B and anon reading nothing; service_role's insert, renew, unique id, payment and refund, with delete refused; the `cancelled_at` check; the cascade on account deletion.
- **Real Postgres run:** with Supabase's auth schema and roles stood in, 0001 to 0010, each run twice, then rls.sql (402 PASS notices, nothing left behind) pass in PGlite (real Postgres, WebAssembly, in the scratchpad, not a project dependency).
  - It found a real bug: since 0009 made `founder_ends_at` not null, re-running 0005 failed, because its `insert … on conflict do nothing` builds the row first. 0005's seed now inserts only when the row is missing.
  - Everything also passes check:sql and the libpg_query parse.

**Decisions recorded** (docs/plans/subscription.md, section 8):
- Payloads confirmed from Dodo's test mode, with the owner's dashboard steps.
- A 7-day grace; cancel at period end only; $12 shown like $8, with "plus tax where applicable" if Dodo adds tax; ship by 20 December.
- Payload capture: lib/payments/capture.ts. After the signature check, the webhook route logs the verified body as `[payments:capture] …` (one line, 20 KB at most), only when `PAYMENTS_CAPTURE_PAYLOADS=on` AND the key is `dodo_test_…`.
- test:webhook (81) covers the flag, a live key, a bad signature, trimming, and a verified test payload.

**SQL for the owner:** 0010, then rls.sql, then the Security Advisor (docs/db-setup.md). Not needed for the app yet: nothing reads 0010 before step 3.

**Checks:** all pass.
- validate:content, test:content, test:checker (36), test:review (90), test:progress (140), test:progress-e2e (7 of 7, then `npm run build`), tsc and build (359/359).
- test:no-supabase-env, test:gating (on a fresh server), test:webhook (81), test:checkout (31), test:safe-next (7) and check:sql (26 sources).

## Subscription step 2 (webhooks, migration 0011), test:sql, shape-only payload logging (Prompt 78)

**test:sql** (new; PGlite 0.6.0, a dev dependency the owner asked for): Postgres in WebAssembly with Supabase stand-ins (roles, auth.users, auth.uid()). It applies 0001 to 0011 in order, twice, runs supabase/tests/rls.sql (406 PASS checks, nothing left in auth.users), then rollback_all.sql, checks no table is left, and applies every migration again. It fails on any error, and check:sql now runs it.

**Payload logging** (lib/payments/capture.ts): only server configuration turns it on (`PAYMENTS_CAPTURE_PAYLOADS=on` AND a `dodo_test_` key), after the signature check; nothing in a payload can. It logs only the shape: the event type, ids, status-like values, and every other field's name and type. Emails, names, phones, addresses, card holder, tax ids and free text are `[masked]`. Tested (5.11). The plan says it's removed once the payloads are confirmed, in step 3 at the latest.

**Step 2** (docs/plans/subscription.md, "As built"):
- Payload shapes confirmed from Dodo's 13 "Send example" payloads (dodopayments.txt, git-ignored; committed with emails replaced as scripts/fixtures/dodo-webhook-examples.json).
- 0011: `subscriptions.last_event_at`, and the unmatched-event checks accept subscription events. It has a rollback, and rls.sql has 0011 checks.
- lib/payments/dodo.ts: the 7 subscription events, subscription charges (payment.succeeded with a subscription_id), dispute.won and dispute.lost; payment.failed is logged only.
- lib/payments/webhook.ts:
  - subscriptions are upserted (product checked against `PAYMENTS_YEARLY_PRODUCT_ID`, user from the signed metadata, else the email);
  - older events never undo newer ones, and refunded or disputed are sticky;
  - payments are recorded once, new then renewal, and retried if the subscription isn't known yet;
  - refunds and disputes of a subscription charge are matched through subscription_payments;
  - dispute.won restores access; a refund that arrived first is honoured.
- lib/payments/types.ts and config.ts; pricing-source.ts treats "restored" as price-changing.
- The five decisions are unchanged.
- The owner's Dodo test product (pdt_0NsnLuCUBOY030rpuYJ9l) and its settings are recorded in the plan.
- docs/db-setup.md: the 0011 steps and a has_0011 check.

**Test fix:** lib/progress-import.test.ts and lib/progress-local.test.ts: two tests failed because the date passed the fake clock's fixed start (25 November 2026). The signed-out store stamps practice with the real Date, so the fake server refused it as future_time. Those two tests now pin Date to the fake clock (node:test mock timers). The app code is unchanged.

**SQL for the owner:** 0011, then rls.sql, then the Security Advisor.

**Checks:** all pass.
- validate:content, test:content, test:checker (36), test:review (90), test:progress (140), test:progress-e2e (7 of 7, then `npm run build`), tsc and build.
- test:no-supabase-env, test:gating (on a fresh server), test:webhook (126), test:checkout (31), test:safe-next (7), check:sql and test:sql.

## Subscription step 3 (entitlement over time), the payload capture removed (Prompt 79)

**One helper:** `hasActiveEntitlement(userId, product)` in lib/purchases.ts is the only access check.
- It calls `has_access()` (0010) with the session's own client, through `checkAccess` in lib/entitlement.ts, and sends no time (the database clock decides).
- It's cached once per request and product (React `cache()`), and fails closed.
- The old purchases-only check (`hasActivePurchase`) is gone.
- Call sites:
  - Changed: app/actions/review.ts and app/actions/review-text.ts (they used the old check directly); scripts/check-review-db.ts.
  - Now through has_access, unchanged in shape: lib/auth.ts (lesson gating, the paywall and sign-in panel), app/pricing/page.tsx, app/review/page.tsx, app/practice/page.tsx (only its comment changed), app/actions/access.ts (the banner), app/actions/checkout.ts (the "already has access" check and the poll), app/checkout/success/page.tsx.
  - /api/founder-offer stays shared and makes no access call.
- The streaming slots are unchanged.

**Time cases** (injected clock):
- supabase/tests/access-over-time.sql (in test:sql, 47 checks): lifetime only; active; renewed; past_due inside and after the 7-day grace (exact boundaries); on_hold; back after paying; cancelled at the period end, before, at and after it; expired; refunded; disputed, won, then lost; lifetime plus a subscription; two subscriptions. Progress and review cards are kept throughout.
- lib/access-over-time.test.ts (in test:sql): the app's `checkAccess` against the real `has_access()` in PGlite. When access lapses, the review loses paid cards, their text and paid writes at once, the stored cards stay, and renewal brings them back.
- lib/access.test.ts (in test:checkout): `checkAccess` fails closed and sends only the product; the call sites are exactly the list above; nothing else reads purchases or subscriptions for access; the request cache; no access call without a session user.
- scripts/sql-harness.mjs: the shared PGlite setup.

**UI:** the /progress due line re-renders when a server answer changes the remembered access (lib/review-access.ts, `onAccessChange`).

**Capture removed:**
- lib/payments/capture.ts and the route's env check are gone. Test 5.11 now checks it's gone and that a verified test-mode payload is never logged, even with the old flag set.
- The plan says so (rollout steps 3 and 6, setup step 4).

**.gitignore:** the file in the project root is named `dodopayments.txt`, not `dodo-payloads.txt`. Both names are ignored (`git check-ignore` confirms).

**Test fix:** lib/review-text.test.ts's wiring check now expects the new helper.

**SQL for the owner:** none.

**Checks:** all pass.
- validate:content, test:content, test:checker (36), test:review (90), test:progress (140), test:progress-e2e (7 of 7, then `npm run build`), tsc and build.
- test:no-supabase-env, test:gating (on a fresh server), test:webhook (117), test:checkout (33), test:safe-next (7).
- check:sql and test:sql (11 migrations twice, rls.sql 406, access-over-time.sql 48, the app-side time test 8).

## Subscription step 4 (the switch and subscription checkout), failing safely on an access error (Prompt 80)

**Failing safely:** `hasActiveEntitlement` (lib/purchases.ts) answers "yes", "no" or "unknown" (any error; lib/entitlement.ts `checkAccess`).
- Checkout refuses on unknown, before reading the price: "We couldn't confirm your access. Please try again in a minute."
- Lessons (lib/auth.ts, components/lesson-body.tsx), /review, the /practice locks and the pricing slot show "Couldn't check your access" with Retry (components/access-unknown.tsx), never the paywall or paid content.
- The banner stays hidden on unknown and doesn't remember it (`accessHidesBanner`).
- The review actions answer "unavailable". **Bug fixed:** `once()` in lib/review-sync.ts turned a failed check into "no access", which rejected entries as no_access and dropped them from the outbox. The card-text action answers "unavailable" too.

**The switch** (lib/pricing-offer.ts), decided per request:
- The offers: "founder" while spots remain and before the deadline; then "yearly" when `PAYMENTS_YEARLY_PRODUCT_ID` is set and `subscription_price_cents` is valid; otherwise "ended" ("New plan coming soon").
- The founder offer carries the yearly terms, and `offerPhase` and `OfferSwitch` switch an open page at the deadline.
- After the switch:
  - The pricing card: "Yearly Access", "$12 a year · plus tax where applicable", the renewal terms, Daily review in the list, and "Subscribe for $12 a year" with "Renews automatically at $12 a year until you cancel."
  - The paywall, sign-in panel, pricing header and FAQ, /review lock and /practice lock labels match.
  - The countdown, banner and "From 1 January" line are gone; /api/founder-offer says "ended".

**Tax:** the checkout code never sets tax; Dodo adds it unless the product's price is tax-inclusive. `TAX_ADDED_AT_CHECKOUT` is true, so "plus tax where applicable" shows next to $12. The owner confirms the product setting.

**Subscription checkout:**
- lib/payments/dodo.ts: the yearly product with no amount (its own price), and the same signed metadata, return URL and email. `getProductPrice` reads GET /products/{id}; `parseProductPrice`.
- `runCheckout` refuses: the founder price after the switch; the yearly plan before it; "coming soon" with no product; a page price different from `subscription_price_cents`; a provider product whose price, currency or yearly interval differs, can't be read, or whose check fails.
- The action also refuses unknown access and existing access, with wording that names it.
- `getActivePricing` now uses the same `loadPricing` as the shared price. It selects `*` so it works before 0012.

**0012** (`pricing_settings.subscription_price_cents`, 1200): its rollback, rollback_all, rls.sql checks (1200 for lessons, anon reads but can't write, 0 refused) and the db-setup steps.

**Wording** (lib/access-wording.ts, `getAccessDetails`):
- Lifetime holders: "You have lifetime access!".
- Subscribers: "Your access renews on <date>", "Your access ends on <date>", or "Payment problem: update your card" (links to /progress).
- Used on the pricing slot, checkout's refusal and the success page. The poller's line is neutral.

**Tests:**
- lib/subscription-switch.test.ts (new, test:checkout): the switch at the deadline and when the spots run out first, an open page crossing it, missing env, before 0012, $8 refused after, $12/year charged, the price-changed paths, the founder checkout never asking the provider, the banner on unknown, and the wording for each status.
- lib/access.test.ts: the three answers, and every gate handling unknown first.
- lib/review-text.test.ts: a failed check fails the sync and the read.
- lib/pricing-cache.test.ts: the yearly price read.
- test:webhook 5d: Dodo's yearly and founder payloads, the product price read, and refusal without the env.
- e2e/pricing.spec.ts: the deadline test asserts the yearly or coming-soon branch, whichever the page declares (`data-switches-to`). The e2e build sets a placeholder `PAYMENTS_YEARLY_PRODUCT_ID`, but until 0012 runs it takes the coming-soon branch.

**SQL for the owner:** 0012, then rls.sql. Run 0012 before relying on the yearly plan; until then the site shows "coming soon" after the switch.

**Left for step 5:** the home page's "Lifetime access" label, the pricing metadata description and refund FAQ, and the terms, refund and privacy pages.

**Checks:** all pass.
- validate:content, test:content, test:checker (36), test:review (91), test:progress (140), test:progress-e2e (7 of 7, then `npm run build`), tsc and build.
- test:no-supabase-env, test:gating (on a fresh server), test:webhook (128), test:checkout (59), test:safe-next (7).
- check:sql and test:sql (12 migrations twice, rls.sql 410, access-over-time.sql 48, the app-side time test 8).

## Subscription step 5 (Manage subscription and the pages), step 4 leftovers (Prompt 81)

**Tax (owner's decision):** the $8 lifetime price keeps no tax note; the $12 yearly price keeps "plus tax where applicable". No change was needed.

**"Your access" box** (components/access-box.tsx, `accessBox` in lib/access-wording.ts), at the top of /progress in its own Suspense slot. /progress is now ◐; the dashboard is unchanged.
- Lifetime: "Lifetime access", with no button.
- Subscription: "Yearly access: renews on <date>", "Yearly access: ends on <date>" (cancelled at the period end), or "Payment problem: update your card by <grace end>" (past_due; period end + 7 days), each with Manage subscription.
- No access: nothing. Unknown: "Couldn't check your access" with Retry.
- The step 4 "Payment problem" links now go to /progress#your-access.

**Manage subscription** (app/actions/subscription.ts, lib/portal.ts, `createPortalSession` in lib/payments/dodo.ts, `readOwnSubscriptions` in lib/purchases.ts):
- The action takes no input. The customer id comes from the learner's own subscription rows (session client, RLS).
- The portal session uses `send_email` false and `return_url` /progress. The link must be https.
- It's rate-limited to 5 per learner per 10 minutes, at least 3 s apart, in memory per instance.
- Any failure gives "Couldn't open subscription settings. Please try again."
- Logs carry error codes only.

**Pages:**
- Home: "Included with paid access".
- Pricing: the description and FAQ cover both phases; the refund FAQ matches the policy.
- llms.txt: both plans, the yearly plan from 1 January 2027, and no price numbers.
- Terms: section 4 "Yearly Subscription" (the later sections renumbered) and the cancellation note in section 7.
- Refund: "Yearly Subscription Payments", and a refund ending a subscription at once.
- Privacy: the subscription status, period end, and Dodo's customer and subscription ids; Dodo's receipts, renewal emails and portal.
- "Last updated: 27 November 2026" on all three.

**For a lawyer's eye:**
- Terms section 4: "A change to the subscription price applies only to new subscriptions."
- Terms section 4: the 7-day grace and "your access pauses until the payment is made".
- Refund policy: "Yearly subscription payments, the first one and each renewal, are final and non-refundable once access is unlocked" (consumer withdrawal rights for digital content and subscriptions differ by country).
- Refund policy: "a refunded payment ends that subscription's access at once, even if part of the paid year is left".
- Terms and privacy: that the Merchant of Record's emails carry a cancel link and send renewal reminders. These are Dodo's behaviour; confirm in step 6.
- Auto-renewal disclosure rules (some places require specific consent or reminder wording).

**Tests:**
- lib/manage-subscription.test.ts (new, test:checkout): the box for lifetime, active, cancelled at the period end, past_due, none, unknown and unreadable rows; the portal action (own customer id only, which customer, no subscription or no id, read, provider and link errors, signed out, the rate limit); the page texts.
- lib/access.test.ts: `getAccessDetails` callers now include the box.
- test:webhook 5e: the Dodo portal request (path, encoded id, key, `send_email`, `return_url`) and its failures.
- e2e/progress.spec.ts: the test account (lifetime) sees "Lifetime access" and no Manage subscription button.
- e2e/review.spec.ts: the home label's new text.

**SQL or steps for the owner:** none.

**Checks:** all pass.
- validate:content, test:content, test:checker (36), test:review (91), test:progress (140), test:progress-e2e (7 of 7, then `npm run build`), tsc and build.
- test:no-supabase-env, test:gating (on a fresh server), test:webhook (132), test:checkout (79), test:safe-next (7).
- check:sql and test:sql (unchanged: 12 migrations, rls.sql 410, access-over-time.sql 48, 8).

## Subscription step 6: the test-mode run on a Vercel Preview, and the live checklist (Prompt 82)

**Owner's decisions:** "A change to the subscription price applies only to new subscriptions." stays; no lawyer review for now; no other wording changes.

**The override** (lib/test-switch.ts): `PAYMENTS_TEST_SWITCH=after` forces "after the switch" (yearly only).
- It's honoured only with a `dodo_test_` `PAYMENTS_API_KEY` and a `VERCEL_ENV` other than `production`.
- It's applied by the server's two price reads (lib/shared-pricing.ts, `getActivePricing`) through `forceAfterSwitch` in `PricingInput`. So pages, checkout and /api/founder-offer never offer or charge the founder price on the preview.
- lib/test-switch.test.ts (test:checkout) checks:
  - it never turns on in Production, with a live key, with no key, or with another value;
  - $8 is refused and $12 charged while it's on;
  - only those two reads apply it, from `process.env`, and no browser code imports it.

**The preview test:** `npm run test:subscription-preview -- <phase>` (scripts/test-subscription-preview.mjs, e2e/subscription-preview.spec.ts, playwright.preview.config.ts).
- The runner refuses to start unless the URL is an https `*.vercel.app`, the account isn't the lifetime one, and the preview's /api/founder-offer says the founding offer is off. For past-due, `DODO_TEST_API_KEY` must start with `dodo_test_`.
- The phases: subscribe, cancel, refund, past-due, on-hold.
- Automated: the pages, the account's own rows through its own session (RLS), `has_access()` including its clock, and the TEST API `PATCH next_billing_date`.
- Manual (the terminal says what to do and waits): the card form (autofilled if Dodo uses standard fields), the portal cancel, the dashboard refund, and one Inspector Resume.
- The main Playwright config ignores the new spec.
- The setup clicks, expected results and clean-up list are in docs/plans/subscription.md section 10.

**Clean-up SQL:** supabase/cleanup/subscription-preview-test.sql removes only the second test account's subscriptions and payments (`gmailprogresstest+subscription@gmail.com`). test:sql now seeds two accounts and proves it leaves the lifetime account and the progress alone.

**Going live:** docs/plans/subscription.md section 11.
- `npm run check:live-subscription` (scripts/check-live-subscription.mjs, checks in scripts/live-subscription-checks.mjs, tested by scripts/live-subscription-checks.test.mjs in test:checkout) is GET-only.
- It reads the live product's price, currency, yearly interval, 20-year period, trial and tax setting, plus the public `subscription_price_cents`.
- It refuses a test key and prints PASS or FAIL. The grace, cancellation and email settings are marked "check by hand".
- It wasn't run here (no live key on this machine).

**SQL or steps for the owner:** section 10 (setup, then the five phases, then the clean-up); section 11 when going live.

**Checks:** all pass.
- validate:content, test:content, test:checker (36), test:review (91), test:progress (140), test:progress-e2e (7 of 7, then `npm run build`), tsc and build.
  - The first test:progress-e2e run failed once in review.spec.ts: 0 of 10 review cards had synced to Supabase within 20 s. The re-run passed 7 of 7. Nothing in this prompt touches the review sync.
- test:no-supabase-env, test:gating (on a fresh server), test:webhook (132), test:checkout (92), test:safe-next (7).
- check:sql and test:sql (12 migrations, rls.sql 410, access-over-time.sql 48, the clean-up, 8).

## Fix from the preview test: no grace after a cancellation (Prompt 83)

**Cause (confirmed):** after "Cancel at next billing date", Dodo keeps the subscription `active` with `cancel_at_next_billing_date` true until the period ends. 0010's `has_access()` gave every `active` or `past_due` subscription the 7-day grace, so access ran 7 days past a cancelled year. The cancel phase caught it at e2e/subscription-preview.spec.ts:200.

**Fix:** supabase/migrations/0013_cancel_no_grace.sql replaces `has_access()`.
- Set to cancel (`cancel_at_period_end`), whatever the status (`active`, `past_due` or `cancelled`): access until `current_period_end` exactly.
- Not set to cancel: `active` or `past_due` keep the 7-day grace (failed renewals).
- Grants are unchanged. There's a rollback (supabase/rollback/0013_cancel_no_grace.sql), and rollback_all mentions it.

**rls.sql** (now needs 0001 to 0013; it checks that 0013 is in):
- active and set to cancel: a day before the period end, a day after and 6 days after;
- past_due and set to cancel: before and after;
- resuming (the flag cleared): the grace is back at 6 days, gone at 8.

access-over-time.sql gained the same case in Dodo's own order (active with the flag): 51 checks.

**Webhook:** `subscription.updated` already sets `cancel_at_period_end` from `cancel_at_next_billing_date`, and clears it when the learner resumes. test:webhook now covers resume, then cancel again.

**Display:** `describeAccess` (lib/access-wording.ts) and the portal's `pickCustomerId` (lib/portal.ts) follow the same rule, so /progress shows "Yearly access: ends on <date>" for an active subscription set to cancel (tested for active, past_due and cancelled).

**Preview test:** the cancel phase is re-runnable. If the subscription is already set to cancel, it skips the portal and only checks.

**SQL for the owner, in order:** 0013, then rls.sql.

**Checks:** all pass: test:sql and check:sql (13 migrations twice, rls.sql 417, access-over-time.sql 51, the clean-up, 8), test:webhook (134), test:checkout (93), tsc and build.

## Fixes from the preview test: immediate cancels, final refunds, cancelling in Dodo after a refund (Prompt 84)

**The second test account now** (read through its own session, RLS):
- `sub_0Nss69ljwgEeTx1pucrzA` is `refunded`, `cancel_at_period_end` false, `cancelled_at` null.
- Its one payment (1200, "new") is `refunded`.
- `has_access()` is false.
- The refunded status held when Dodo's immediate `subscription.cancelled` arrived, so the account never got access back, and no correction is needed.

**Fixes** (lib/payments/webhook.ts, lib/payments/dodo.ts, lib/payments/types.ts, the webhook route):
- **`subscription.cancelled`** is decided from the event, never from the stored flag.
  - Period end: `cancel_at_next_billing_date` is true, or `cancelled_at` is within a day of the period end. Access runs to `current_period_end`.
  - Otherwise it's immediate: access ends at `cancelled_at`, and `cancel_at_period_end` is cleared.
  - The "clearly before the period end" test applies only when Dodo's flag is false. A cancellation flagged for the period end always keeps the paid year, as the terms promise.
- **Final states:** a refunded or disputed subscription takes nothing from later subscription events; they only note their time (the 0011 ordering still applies). Only `dispute.won` restores it.
- **`dispute.lost`** is parsed now (`order_dispute_lost`). It marks the payment and the subscription disputed if they weren't.
- **Cancelling in Dodo:**
  - On a refund or a lost dispute of a subscription payment, the webhook writes a pending row in `provider_cancellations`.
  - After the 200 (Next's `after()`), it calls `PATCH /subscriptions/{id}` with status `cancelled`.
  - It's idempotent: one row per subscription, and nothing is sent once it's done. "Already cancelled or expired" counts as done.
  - A failure records `attempts` and a short `last_error`. A resent refund retries, and Dodo's own `subscription.cancelled` or `expired` marks it done.
  - docs/payments-recovery.md section 6 has the manual step.
- **0014** (`provider_cancellations`): RLS forced, the service role can select, insert and update (no delete), learners and anon get nothing, and rows cascade with their subscription.
  - There's a rollback, and rollback_all drops the table.
  - rls.sql (needs 0001 to 0014) adds the grants, writes, duplicate and reason checks, and the cascade.
- **check:sql:** it scans docs/db-setup.md's SQL blocks again. The file now has CRLF line endings, which the pattern missed: 28 sources were scanned instead of 36.

**Tests:**
- test:webhook 5f: an immediate cancel clears the flag; a period-end cancel by the flag or by time; refund then cancelled, updated, active and expired all leave it refunded; a resent refund doesn't cancel again; a failed cancel is recorded, the reply is unchanged, and the next delivery retries; Dodo's cancelled marks it done; with `defer`, the cancel runs after the reply; dispute lost then cancelled; dispute lost out of order; dispute won doesn't cancel in Dodo; Dodo's PATCH, "already" and error code.
- access-over-time.sql L8 checks `has_access()` for each state: immediate cancel, period-end cancel before and after, refunded with or without the flag, disputed with the flag, dispute won.

**Live key:** it must be allowed to update subscriptions (`PATCH /subscriptions/{id}`), not only to create checkouts and read products.

**SQL for the owner, in order:** 0014, then rls.sql.

**Checks:** all pass.
- test:sql and check:sql (36 sources, 14 migrations twice, rls.sql 427, access-over-time.sql 58, the clean-up, 8).
- test:webhook (155), test:checkout (93), test:gating (on a fresh server), tsc and build.
