# Database setup: tables and RLS

This sets up the Supabase tables for profiles, learner progress and payments, protected by row level security (RLS). The SQL is in `supabase/`. The app reads and writes `purchases` and `pricing_settings` (payments). It doesn't use the progress tables yet: see "Not done yet" at the end and docs/plans/progress.md.

**0009 (the founding offer's deadline) must run before the Pricing v2 code is deployed:** the app reads `pricing_settings.founder_ends_at`, and without it pricing shows as unavailable and checkout refuses. Steps: "Founder deadline (0009)" under section 1.

**0008 (daily review) has not been run anywhere yet:** run it with the steps in "Daily review (0008)" under section 1.

**0006 has not been run anywhere yet.** It was written without connecting to any database (no local Postgres or Supabase CLI was available). Run it yourself, in the order below, and run the RLS test before relying on it.

## 0. Check what has already run (step 0)

In the Supabase dashboard, open **SQL Editor**, then **New query**, and run each query on its own:

```sql
-- Which tables exist in public?
select table_name from information_schema.tables
 where table_schema = 'public' order by 1;

-- Is lesson_scores empty? (0006 drops it only if it is.)
select count(*) from public.lesson_scores;

-- RLS enabled and forced on every table?
select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' order by 1;

-- Is 0006 already in? (true = yes)
select to_regprocedure('public.apply_progress(jsonb)') is not null as has_0006;

-- Is 0008 already in? (true = yes)
select to_regprocedure('public.apply_review(jsonb)') is not null as has_0008;

-- Is 0009 already in? (true = yes)
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pricing_settings' and column_name = 'founder_ends_at') as has_0009;

-- Is 0010 already in? (true = yes)
select to_regclass('public.subscriptions') is not null as has_0010;

-- Is 0011 already in? (true = yes)
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'last_event_at') as has_0011;
```

Expected before 0006: `exercise_results`, `lesson_progress`, `lesson_scores`, `pricing_settings`, `profiles`, `purchases` and `saved_vocab`; `lesson_scores` count 0; `true` and `true` for every table. If a table is missing, run the migrations it belongs to (section 1) first.

## 1. Run the migrations

In the SQL Editor, for each file below, paste the whole file, click **Run**, and check that it says "Success" before moving on.

1. `supabase/migrations/0001_profiles.sql`: the `profiles` table, the sign-up trigger, the shared `updated_at` trigger, and a profile for every user who already signed in.
2. `supabase/migrations/0002_progress.sql`: `lesson_progress`, `exercise_results`, `lesson_scores` and `saved_vocab`.
3. `supabase/migrations/0003_rls.sql`: RLS on, privileges and policies for profile and progress tables.
4. `supabase/migrations/0004_activity.sql`: the `touch_last_active()` function.
5. `supabase/migrations/0005_payments.sql`: `purchases`, `pricing_settings`, `get_founder_spots_left()`, and their RLS policies.
6. `supabase/migrations/0006_progress_sync.sql`: `writing_task_progress`, `exercise_results.last_attempt_at`, drops `lesson_scores` (only if empty) and the `(user_id, lesson_id)` index, revokes direct insert and update on the progress tables, and adds `apply_progress()`, the only write path for progress.
7. `supabase/migrations/0007_service_role_grants.sql`: what the payment webhook's service-role client needs, and nothing else.
   - It adds `unmatched_payment_events` and `find_user_id_by_email()`.
   - It revokes everything from service_role in `public`, then grants select, insert and update on `purchases`, select and insert on `unmatched_payment_events`, and execute on `find_user_id_by_email()`.
   - Run it after 0005; it doesn't need 0006.
   - Why it exists: 0003 and 0005 never grant anything to service_role, so it had only what the project's default privileges gave it, which was nothing on `purchases`. The webhook failed with 42501 until the grant was added by hand.
   - Recovery steps are in docs/payments-recovery.md.
8. `supabase/migrations/0008_review_cards.sql`: the daily review (docs/plans/review.md).
   - It adds `review_cards` (one Leitner card state per user and card: box, due time, last review, review and lapse counts, no card text) with RLS forced and read-own and delete-own policies.
   - It adds `apply_review()`, the only write path. It's security definer, takes the user only from `auth.uid()`, can be executed by authenticated only, and caps each user at 6,000 cards.
   - Direct insert and update are revoked from anon, authenticated and service_role.
   - Run it after 0001 to 0007.

**Daily review (0008), your steps in the Supabase SQL editor:**

1. Paste the whole of `supabase/migrations/0008_review_cards.sql`, click **Run**, and check it says "Success". It runs in one transaction and changes nothing if it stops.
2. Paste the whole of `supabase/tests/rls.sql` (it now needs 0001 to 0008), click **Run**, and check that the last notice is "PASS: ALL RLS CHECKS PASSED". It ends in ROLLBACK and leaves nothing behind.
3. Open **Advisors**, then **Security Advisor**, click **Refresh**, and check nothing new appears for `review_cards` or `apply_review` (section 4).
4. Optional: run the size query in section 7 to see `review_cards` (empty until the review store ships).
5. Optional, from PowerShell in the project folder: `npm run check:review-db`.
   - It signs in as the test account in .env.local (PROGRESS_TEST_EMAIL and PROGRESS_TEST_PASSWORD) and runs the review actions' real path against your database: read-back, rejections, idempotency, the access rule, and the 6,000-card cap.
   - It deletes the account's review cards at the end with the account's own delete policy.
   - It stops if the account already has review cards; add `-- --reuse` to run anyway, or `-- --skip-cap` to leave out the cap check (about 30 calls).

9. `supabase/migrations/0009_founder_deadline.sql`: the founding offer's deadline (Pricing v2, step 1).
   - It adds `pricing_settings.founder_ends_at` (not null) and sets it to `2026-12-31T16:59:00Z` (23:59 on 31 December 2026 in Bangkok) for every row.
   - The founder price is live only while spots remain and `now()` is before it. The app works that out on every request and at checkout.
   - A trigger (`guard_founder_deadline`) refuses any later change to `founder_ends_at` unless the transaction first runs `select set_config('app.allow_founder_deadline_change', 'on', true);`. A dashboard edit fails; a new migration does that on purpose.
   - Run it after 0005.

10. `supabase/migrations/0010_subscriptions.sql`: the yearly subscription's data (docs/plans/subscription.md, step 1). Nothing in the app uses it until step 3.
    - It adds `subscriptions` and `subscription_payments`, with RLS forced. Learners read their own rows; the webhook (service_role) has select, insert and update, no delete.
    - It adds `has_access(product, at)`, the entitlement: a lifetime purchase, an active or past_due subscription until its period end plus 7 days, or one cancelled at the period end until that end.
    - Run it after 0001 to 0009.

11. `supabase/migrations/0011_subscription_webhooks.sql`: what the subscription webhooks need (docs/plans/subscription.md, step 2).
    - It adds `subscriptions.last_event_at`, so an older event arriving late never undoes a newer one.
    - It lets `unmatched_payment_events` record the subscription events (`subscription_event`, `subscription_payment`, and the reason `subscription_unknown`).
    - Run it after 0010, and before the subscription webhook code is deployed.

**Subscription webhooks (0011), your steps in the Supabase SQL editor:**

1. Paste the whole of `supabase/migrations/0011_subscription_webhooks.sql`, click **Run**, and check it says "Success".
2. Paste the whole of `supabase/tests/rls.sql` (it now needs 0001 to 0011), click **Run**, and check that the last notice is "PASS: ALL RLS CHECKS PASSED".
3. Undo: `supabase/rollback/0011_subscription_webhooks.sql`.

`npm run test:sql` runs every migration twice in real Postgres (PGlite), then rls.sql, then supabase/tests/access-over-time.sql (has_access() through a subscription's life, with an injected clock), then rollback_all.sql and every migration again. Every SQL file you're asked to run has passed it. access-over-time.sql also runs in the SQL editor, but you don't need to run it.

**Subscriptions (0010), your steps in the Supabase SQL editor:**

1. Paste the whole of `supabase/migrations/0010_subscriptions.sql`, click **Run**, and check it says "Success". It runs in one transaction.
2. Paste the whole of `supabase/tests/rls.sql` (it now needs 0001 to 0010), click **Run**, and check that the last notice is "PASS: ALL RLS CHECKS PASSED". It ends in ROLLBACK and leaves nothing behind.
3. Open **Advisors**, then **Security Advisor**, click **Refresh**, and check nothing new appears for `subscriptions`, `subscription_payments` or `has_access`.
4. Undo: `supabase/rollback/0010_subscriptions.sql` (it deletes every subscription record; nothing uses them before step 3).

Both files were run end to end in real Postgres (PGlite) before you got them, with 0001 to 0010 each run twice, then rls.sql (402 checks).

**Founder deadline (0009), your steps in the Supabase SQL editor:**

1. Paste the whole of `supabase/migrations/0009_founder_deadline.sql`, click **Run**, and check it says "Success". It runs in one transaction and changes nothing if it stops.
2. Paste the whole of `supabase/tests/rls.sql` (it now needs 0001 to 0009), click **Run**, and check that the last notice is "PASS: ALL RLS CHECKS PASSED". It ends in ROLLBACK and leaves nothing behind.
3. Open **Advisors**, then **Security Advisor**, click **Refresh**, and check nothing new appears for `guard_founder_deadline`.
4. Then deploy the Pricing v2 code. Before 0009, the deployed code shows pricing as unavailable.
5. Undo: `supabase/rollback/0009_founder_deadline.sql` (it drops the column and the guard; the app then shows pricing as unavailable until 0009 runs again).

**Test accounts (lifetime access without a founder spot):** the daily review is for learners with access, so the e2e and production smoke tests need the test account (PROGRESS_TEST_EMAIL in .env.local) to have access.
- A founder spot is an active `lessons` purchase whose amount is at most the founder price (`get_founder_spots_left`). This grant's amount is one cent above it, so it never takes a spot, as in `supabase/tests/rls.sql`.
- It's a manual record, not revenue. Its `provider_order_id` starts with `manual-test-access-`, so it's easy to find and leave out of reports.
- Run it in the SQL editor of the project the tests use, replacing the email:

```sql
-- Grant the test account lifetime access without using a founder spot. Safe to run twice.
insert into public.purchases (user_id, product, status, provider, provider_order_id, amount, currency)
select u.id, 'lessons', 'active', 'dodo', 'manual-test-access-' || u.id::text, ps.founder_price_cents + 1, ps.currency
  from auth.users as u
  join public.pricing_settings as ps on ps.product = 'lessons'
 where lower(u.email) = lower('TEST-ACCOUNT-EMAIL')
on conflict (provider_order_id) do nothing;

-- Check: one row here, status active, amount one cent above the founder price; and the founder spots
-- are the same as before. No row means the email didn't match an account (compare with PROGRESS_TEST_EMAIL).
select p.status, p.amount, p.provider_order_id
  from public.purchases as p join auth.users as u on u.id = p.user_id
 where lower(u.email) = lower('TEST-ACCOUNT-EMAIL');
select public.get_founder_spots_left('lessons') as founder_spots_left;
```

To take the access away again:

```sql
delete from public.purchases where provider_order_id like 'manual-test-access-%'
   and user_id = (select id from auth.users where lower(email) = lower('TEST-ACCOUNT-EMAIL'));
```

Each file is safe to run again (`create table if not exists`, `create or replace function`, `drop ... if exists` before each trigger and policy). Running them again doesn't change data. One exception: if you change a column in a file after the table exists, `create table if not exists` won't apply it. Write a new numbered migration for that.

Run 0003 straight after 0002. Run 0005 after 0001 (which provides `set_updated_at()`). Until migrations run, new tables have Supabase's default grants and no RLS.

**0006 runs in one transaction.** It stops with an error, changing nothing, if:

- 0001 to 0003 haven't run, or
- `lesson_scores` has any rows ("0006: public.lesson_scores is not empty (N rows)…"). Nothing writes to it, so this shouldn't happen. If it does, export the rows and tell me before going further.

**Order for 0006:** run 0006, then `supabase/tests/rls.sql` (section 2), then the Security Advisor (section 4).

## 2. Run the RLS test

1. In the SQL Editor, open a new query, paste the whole of `supabase/tests/rls.sql`, and click **Run**. It needs 0001 to 0008 (it stops at once with "run migration 0008 first" if `review_cards` is missing).
2. It runs in one transaction that ends in `rollback`, so it leaves nothing behind: no test users, no rows, no test schema. It seeds about 6,800 rows for one test user to check the caps; they're rolled back too.

**Expected output:**

- **Success:** the run completes with no error. The last notice is `PASS: ALL RLS CHECKS PASSED`.
- **Failure:** the run stops with an error that starts with `FAIL:` and names the check, for example `FAIL: user A reads other lesson_progress returned 1 rows, expected 0`. Nothing is kept, because the transaction never commits.

Each check also raises a notice such as `PASS: user B inserts lesson_progress for the other id -> refused (42501)`. The SQL Editor may not show notices. To see the full list, run the file with `psql` against the database (`psql "<connection string>" -f supabase/tests/rls.sql`); otherwise, reaching the end without a `FAIL:` error is the pass.

**What it covers:**

- **Structure.**
  - Every table has RLS enabled and forced; every policy on user-scoped tables is `to authenticated`, and none uses `true`.
  - The owners of the sign-up trigger function and of `apply_progress()` bypass RLS.
  - `apply_progress()` is security definer with an empty search_path; PUBLIC and anon can't execute it, and authenticated can.
  - `lesson_scores` and `exercise_results_user_lesson_idx` are gone.
  - `writing_task_progress` has exactly its seven columns, and no text-like column but the two ids.
  - Authenticated can select and delete the three progress tables, but not insert or update them.
- **Two fake users** in `auth.users`; the trigger creates both profiles from `raw_user_meta_data`.
- **As each user, own rows:**
  - Direct inserts into the progress tables are refused, and so are direct updates.
  - Bad entries are rejected with their codes and write nothing: score above total, total 0 or 1,001, a bad lesson id, an exercise from another lesson, a bad result, 25 hours ahead, a malformed time, an unknown kind, a tick index of 10, counts that disagree with the result.
  - Runs: best by ratio, the earliest completion, the latest run; a resent run and a worse import change nothing.
  - Attempts: a resent attempt and an older attempt aren't counted; a newer one is. A time 23 hours ahead is stored exactly as sent.
  - Writing tasks: ticks are deduplicated and sorted, an older record is ignored, and a newer one wins whole.
  - `saved_vocab`, `purchases`, `pricing_settings`, `touch_last_active()` and `get_founder_spots_left()` as before.
- **As each user, against the other user's id:**
  - Read gives 0 rows, update is refused, delete touches 0 rows, and insert is refused, in every user table.
  - An `apply_progress()` entry naming the other user is written for the caller only.
  - Afterwards, both users' rows are checked unchanged.
- **A third user at every cap** (6,000 exercises, 600 lessons, 200 writing tasks):
  - New rows are refused with `cap_reached`, and existing rows still update.
  - `import-exercise` keeps the larger counts and the newer result; `import-lesson` keeps the best, the earliest completion and the latest run. Both are idempotent.
- **As `anon`:** progress tables and `purchases` are refused or return 0 rows; every insert, update and delete is refused; `touch_last_active()` and `apply_progress()` are refused; `pricing_settings` can be read; `get_founder_spots_left()` can be called.
- **Exact privileges (0007).**
  - The test checks every table privilege in `public`: service_role on every table, authenticated and anon on the tables these migrations manage. Each must match exactly what's granted.
  - service_role can execute only `find_user_id_by_email()`, which is security definer with an empty search_path. anon and authenticated can't execute it, and their other function rights are unchanged.
- **As `service_role`:**
  - It inserts, reads and updates a purchase; a duplicate payment id is refused (23505), and so is a delete.
  - It records and reads an unmatched event; a duplicate is refused (23505), and so are updates and deletes.
  - It finds a user by email in another case, with spaces around it, and gets null for an unknown email.
  - It can't read profiles or progress, update pricing, or call `apply_progress()` or `get_founder_spots_left()`.
  - Users and anon can't read `unmatched_payment_events` or call `find_user_id_by_email()`.
- **Deleting a user** in `auth.users` removes their profile, every progress row (writing tasks included), and their `purchases`, and leaves the other user alone.

**If the service_role function check fails**, the error names each function and why service_role can run it. To see the full list on its own:

```sql
select p.oid::regprocedure as function,
       pg_get_function_result(p.oid) as returns,
       case when p.proacl is null then 'PUBLIC (default ACL)'
            when exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') then 'PUBLIC grant'
            when exists (select 1 from aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee
                          where r.rolname = 'service_role' and a.privilege_type = 'EXECUTE') then 'direct grant'
            else 'membership of another role' end as why,
       e.extname as extension
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
  left join pg_extension e on e.oid = d.refobjid
 where n.nspname = 'public' and p.prokind = 'f'
   and has_function_privilege('service_role', p.oid, 'EXECUTE')
 order by 1;
```

Trigger and event-trigger functions, and functions that belong to an extension, are allowed by the test. Anything else needs a decision: what calls it, and whether to revoke PUBLIC. A PUBLIC grant also lets anon and authenticated call it.

## 3. Check "RLS enabled" in the dashboard

1. Open **Table Editor** and pick the `public` schema.
2. Open each of `profiles`, `lesson_progress`, `exercise_results`, `writing_task_progress`, `saved_vocab`, `purchases` and `pricing_settings`. None should show the "RLS disabled" or "Unrestricted" warning.
3. Open **Authentication**, then **Policies**. Each table lists its policies:
   - `profiles`: read and update for `authenticated`.
   - `lesson_progress` and `exercise_results`: read, insert, update and delete for `authenticated`. The insert and update policies stay, but there's no insert or update grant since 0006, so they're unused.
   - `writing_task_progress`: read and delete for `authenticated`.
   - `saved_vocab`: read, insert and delete for `authenticated`.
   - `purchases`: read for `authenticated`.
   - `pricing_settings`: read for `authenticated` and `anon`.

## 4. Run the Security Advisor

After the migrations, open **Advisors**, then **Security Advisor**, and click **Refresh** (or "Rerun linter").

- There should be no error for these tables (no "RLS disabled in public", no "Policy exists RLS disabled").
- The six functions (`set_updated_at`, `handle_new_user`, `touch_last_active`, `get_founder_spots_left`, `apply_progress`, `apply_review`) set `search_path = ''`, so "Function search path mutable" shouldn't appear for them.
- `apply_progress` and `apply_review` are `security definer` and callable by signed-in users. The advisor may list it as a security definer function exposed through the API; that's intended. It takes the user only from `auth.uid()` and checks every entry.
- Fix or note anything it reports about these objects before building on them. Warnings about Auth settings (for example leaked password protection) aren't from these migrations.

## 5. What the tables store and why

The progress tables mirror `lib/progress.ts`, so a later `SupabaseProgressStore` can implement the same `ProgressStore` interface. Every progress and purchase row has `user_id` (references `auth.users`, `on delete cascade`). Ids are the site's permanent content ids, never titles or slugs. Every text id has a length check.

| Table | One row per | Columns | Why |
|---|---|---|---|
| `profiles` | user | `id`, `display_name`, `avatar_url`, `created_at`, `updated_at`, `last_active_at` | Name and picture from Google, and "last active" for streaks later. Created by the sign-up trigger. |
| `lesson_progress` | user and lesson | `lesson_id`, `status` (`in_progress` or `completed`), `best_score`, `best_total`, `last_run_at`, `completed_at`, `updated_at` | `LessonProgress` in lib/progress.ts: `bestScore`, `bestTotal` and `lastCompletedAt` (= `last_run_at`). `status` and `completed_at` record when the best run first reached the pass mark (score / total ≥ 0.8). |
| `exercise_results` | user and exercise | `lesson_id`, `exercise_id`, `correct`, `attempts`, `correct_count`, `last_result`, `last_attempt_at`, `updated_at` | `ExerciseProgress`: `attempts`, `correct` (a count, = `correct_count`), `lastResult` (`correct`, `correct-accents` or `incorrect`) and `lastAttemptedAt` (= `last_attempt_at`, the client's time of the latest counted attempt). `correct` is true when the last answer was accepted. |
| `writing_task_progress` | user and C2 writing task | `exercise_id`, `lesson_id`, `done`, `checked`, `done_at`, `updated_at` | "Done" and the ticked checklist indices (0 to 9). **No text column, by design**: the learner's text stays in the browser (lib/writing-draft.ts). A row exists only once the task is marked done; the app has no way to un-mark it. |
| `saved_vocab` | user and vocab entry | `vocab_id`, `lesson_id`, `saved_at` | Words saved for review (for spaced repetition later). Not used by the app yet. |
| `purchases` | purchase | `id`, `user_id`, `product`, `status`, `provider`, `provider_order_id`, `amount`, `currency`, `created_at`, `updated_at`, `refunded_at` | Lifetime entitlements and payment order history. Written strictly by server webhooks via service role key. |
| `pricing_settings` | product | `product`, `currency`, `founder_price_cents`, `standard_price_cents`, `founder_cap`, `is_active`, `created_at`, `updated_at` | Editable pricing plans and founder caps without redeploying (seeded with $8 founder, $12 standard, cap 100). |
| `unmatched_payment_events` | provider, order and reason | `id`, `provider`, `provider_order_id`, `event_type`, `event_id`, `reason`, `product`, `amount`, `currency`, `received_at`, `resolved_at` | Payment, refund or dispute events the webhook couldn't apply (no matching user, bad data, refund before payment). One row per (provider, order, reason), so a resend adds nothing. No email, name or user id. RLS forced with no policy; only service_role (insert, select) and the owner reach it. Set `resolved_at` once handled (docs/payments-recovery.md). |

`lesson_scores` (append-only run history) was dropped by 0006: the plan keeps no history, to stay within the free plan's storage.

**Privileges.** `anon` and `public` have none by default. `authenticated` has:

- `profiles`: select, and update of `display_name`, `avatar_url` and `last_active_at` only. No insert (the trigger creates the row) and no delete (deleting the user cascades).
- `lesson_progress`, `exercise_results`, `writing_task_progress`: select and delete only. Writes go through `apply_progress()`.
- `saved_vocab`: select, insert, delete (no update: a word is saved or unsaved).
- `purchases`: select only. No insert, update, or delete (writes happen only via the webhook using the service role).
- `pricing_settings`: select only (`anon` also has select). No insert, update, or delete.
- `unmatched_payment_events`: nothing.

`service_role` (0007; the payment webhook only) has select, insert and update on `purchases`, select and insert on `unmatched_payment_events`, execute on `find_user_id_by_email()`, and nothing else in `public`. It bypasses RLS, as on every Supabase project.

**`find_user_id_by_email(p_email)`** returns the id of the one auth user whose email matches, ignoring case and surrounding spaces. It returns null when no user matches, or when more than one does. It is `security definer` with `set search_path = ''`, and only service_role can execute it.

Every policy on user-scoped tables compares `(select auth.uid())` with `user_id` (`id` for profiles), in USING and, where there is one, WITH CHECK. A user can neither see another user's rows nor write or move a row to another id. RLS is also forced, so the table owner is subject to it; roles with BYPASSRLS (Supabase's `postgres` and service role) are not.

**`apply_progress(p_items jsonb)`** applies up to 200 entries for the caller, in order, and returns `{"applied": [keys], "rejected": [{"key", "code"}]}`. The entry shapes, checks, caps and merge rules are documented at the top of the function in 0006 and in docs/plans/progress.md, section 7. It is `security definer` with `set search_path = ''`. It takes the user only from `auth.uid()` and filters every statement on it. Only `authenticated` can execute it (execute is revoked from PUBLIC, `anon` and `service_role`).

**`touch_last_active()`** sets the caller's `last_active_at` to now. It is security invoker, so it runs with the caller's rights and RLS. Only `authenticated` can execute it. The app doesn't call it yet.

**`get_founder_spots_left(p_product)`** returns `greatest(0, founder_cap - count(*))` of active purchases at or below `founder_price_cents` for active products. It is `security definer` with `set search_path = ''`, so `authenticated` and `anon` can read remaining spots for the paywall and `/pricing` without exposing individual purchase records.

## 6. How deleting an account removes the data

Delete the user in **Authentication**, then **Users** (or through the Admin API). Every user table references `auth.users(id)` with `on delete cascade`, so Postgres deletes the user's profile, every progress row, and all `purchases` in the same statement. The RLS test checks this. Nothing else holds user data.

## 7. Orphan ids and size

Ids are permanent, but if a lesson or exercise is ever removed, its rows stay and the app ignores them. To list progress rows whose ids are no longer in the content, export the current ids first (`npm run audit:content` lists every lesson and exercise id in docs/all-data.md), then compare:

```sql
-- Lesson and exercise ids with stored progress, and how many users each has.
select 'lesson' as kind, lesson_id as id, count(*) as users from public.lesson_progress group by lesson_id
union all
select 'exercise', exercise_id, count(*) from public.exercise_results group by exercise_id
union all
select 'writing', exercise_id, count(*) from public.writing_task_progress group by exercise_id
order by kind, id;
```

Paste the current ids into a `values` list to find the orphans directly, for example `select lesson_id from public.lesson_progress except select * from (values ('a1-etre-present'), …) as v(id);`. Deleting orphans is the owner's call; nothing deletes them automatically.

Database size (free plan: 500 MB): the project's **Usage** page shows "Database Size"; in SQL:

```sql
select pg_size_pretty(pg_database_size(current_database()));
select c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) as total
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by pg_total_relation_size(c.oid) desc;
```

Progress and the daily review together: rows, size with indexes, and the average per learner, for each table:

```sql
select t.table_name,
       t.row_count,
       t.learners,
       pg_size_pretty(pg_total_relation_size(('public.' || t.table_name)::regclass)) as total_with_indexes,
       pg_size_pretty(pg_total_relation_size(('public.' || t.table_name)::regclass) / nullif(t.learners, 0)) as average_per_learner
  from (
    select 'exercise_results' as table_name, count(*) as row_count, count(distinct user_id) as learners from public.exercise_results
    union all select 'lesson_progress', count(*), count(distinct user_id) from public.lesson_progress
    union all select 'writing_task_progress', count(*), count(distinct user_id) from public.writing_task_progress
    union all select 'review_cards', count(*), count(distinct user_id) from public.review_cards
  ) as t
 order by pg_total_relation_size(('public.' || t.table_name)::regclass) desc;
```

Compare with the estimates: about 270 B per exercise row, 250 B per lesson row, 310 B per writing-task row (docs/plans/progress.md, section 4) and 230 B per review card (docs/plans/review.md, section 5).

The daily-review cards (0008) alone: rows, users, size with indexes, and the average per user with cards:

```sql
select count(*) as card_rows,
       count(distinct user_id) as users_with_cards,
       pg_size_pretty(pg_total_relation_size('public.review_cards')) as total_with_indexes,
       pg_size_pretty(pg_indexes_size('public.review_cards')) as indexes_only,
       pg_size_pretty(pg_total_relation_size('public.review_cards') / nullif(count(distinct user_id), 0)) as average_per_user
  from public.review_cards;
```

## 8. Manual checklist (after the store ships, rollout step 7)

1. Two Google accounts in two browsers: each sees only its own progress on `/lessons` and `/progress`.
2. DevTools → Network → Offline: answer three questions and finish a run, then go back online. The rows appear in **Table Editor** (`exercise_results`, `lesson_progress`) with the times of the answers, not of the sync.
3. A preview deployment with a wrong Supabase URL: answers still save locally and the app doesn't crash.
4. Sign out and in again: nothing is lost, and nothing is counted twice.
5. With signed-out progress in a browser, sign in with account A: it's imported. Sign out, sign in with account B on the same browser: B gets no import and sees only its own progress.
6. A C2 writing task marked done: `writing_task_progress` holds only the ticked indices and the time, never the text.
7. Security Advisor: nothing new.

## 9. Undo

- `supabase/rollback/0008_review_cards.sql`: drops `apply_review()` and `review_cards`, **deleting every learner's daily-review card states**. Nothing else is touched.
- `supabase/rollback/0007_service_role_grants.sql`: drops `unmatched_payment_events` (export unresolved rows first) and `find_user_id_by_email()`, and revokes service_role's privileges on `purchases`. **After it, the webhook fails with 42501 again**, unless the project's default privileges grant them.
- `supabase/rollback/0006_progress_sync.sql`: drops `apply_progress()`, `writing_task_progress` (deleting writing-task records) and `exercise_results.last_attempt_at`; restores the index and the direct insert and update grants; recreates an empty `lesson_scores`. `lesson_progress` and `exercise_results` rows are kept.
- `supabase/rollback/0005_payments.sql`: drops `get_founder_spots_left()`, `purchases`, and `pricing_settings`.
- `supabase/rollback/rollback_all.sql`: drops everything the migrations create (0001 to 0008), in dependency order. **It deletes every profile, all learner progress, all review cards, and all purchases, with no undo.** It leaves `auth.users` alone. Never use it to undo only the progress sync.

## 10. Not done yet

- **The progress store.** `lib/progress.ts` still uses localStorage only. A `SupabaseProgressStore` behind the same interface comes next (docs/plans/progress.md, rollout steps 2 to 4). `recordAttempt(exerciseId, result)` doesn't receive the lesson id; the store derives it from the exercise id prefix (`<lesson-id>-ex…`), which validate:content will enforce.
- **Server actions** for writes, which re-read the user on the server and never trust a client-sent id.
- **A progress dashboard** page.
- **Importing localStorage progress** on first sign-in.
- **Saved vocab** UI, spaced repetition and streaks.
- **Calling `touch_last_active()`.**

## Fail-safe without Supabase config

If `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is missing or empty:

- `proxy.ts` skips the session refresh and logs one warning.
- `getCurrentUser()` returns null (it also returns null on a client or network error), so gated lessons show the sign-in panel and none of their content.
- The header shows "Sign in"; the callback sends you to the sign-in error page.

`npm run test:no-supabase-env` proves this: it builds and starts the app with both variables empty (`.env.local` untouched) and checks `/`, an A1 lesson, a B1 lesson (HTML and RSC), `/sign-in`, the callback and the server log. It leaves a no-config build in `.next`, so run `npm run build` afterwards.
