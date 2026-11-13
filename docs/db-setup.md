# Database setup: tables and RLS

This sets up the Supabase tables for profiles and learner progress, protected by row level security (RLS). The SQL is in `supabase/`. Nothing in the app reads or writes these tables yet: see "Not done yet" at the end.

**None of this SQL has been run yet.** It was written without connecting to any database. Run it yourself, in order, and run the RLS test before relying on it.

## 1. Run the migrations

In the Supabase dashboard, open **SQL Editor**, then **New query**. For each file below, paste the whole file, click **Run**, and check that it says "Success" before moving on.

1. `supabase/migrations/0001_profiles.sql`: the `profiles` table, the sign-up trigger, the shared `updated_at` trigger, and a profile for every user who already signed in.
2. `supabase/migrations/0002_progress.sql`: `lesson_progress`, `exercise_results`, `lesson_scores` and `saved_vocab`.
3. `supabase/migrations/0003_rls.sql`: RLS on, privileges and policies.
4. `supabase/migrations/0004_activity.sql`: the `touch_last_active()` function.

Each file is safe to run again (`create table if not exists`, `create or replace function`, `drop ... if exists` before each trigger and policy). Running them again doesn't change data. One exception: if you change a column in a file after the table exists, `create table if not exists` won't apply it. Write a new numbered migration for that.

Run 0003 straight after 0002. Until it runs, the new tables have Supabase's default grants and no RLS.

## 2. Run the RLS test

1. In the SQL Editor, open a new query, paste the whole of `supabase/tests/rls.sql`, and click **Run**.
2. It runs in one transaction that ends in `rollback`, so it leaves nothing behind: no test users, no rows, no test schema.

**Expected output:**

- **Success:** the run completes with no error. The last notice is `PASS: ALL RLS CHECKS PASSED`.
- **Failure:** the run stops with an error that starts with `FAIL:` and names the check, for example `FAIL: user A reads other lesson_progress returned 1 rows, expected 0`. Nothing is kept, because the transaction never commits.

Each check also raises a notice such as `PASS: user B inserts lesson_progress for the other id -> refused (42501)`. The SQL Editor may not show notices. To see the full list, run the file with `psql` against the database (`psql "<connection string>" -f supabase/tests/rls.sql`); otherwise, reaching the end without a `FAIL:` error is the pass.

**What it covers:**

- Every table has RLS enabled and forced; every policy is `to authenticated`; none uses `true`.
- The owner of the sign-up trigger function bypasses RLS (needed because RLS is forced; Supabase's `postgres` role does).
- Two fake users are created in `auth.users`, and the trigger creates both profiles from `raw_user_meta_data`.
- As each user: insert, read, update and delete their own rows in every table; the check constraints; no changing `id`, `created_at` or `user_id`; no insert or delete on `profiles`; no update on `lesson_scores` or `saved_vocab`; `touch_last_active()` stamps only their own profile.
- As each user, against the other user's id: read (0 rows), update (0 rows), delete (0 rows or refused) and insert (refused) in every table. Afterwards, both users' rows are checked unchanged.
- As `anon`: every select is refused or returns 0 rows; every insert, update and delete is refused; `touch_last_active()` is refused.
- Deleting a user in `auth.users` removes their profile and every progress row, and leaves the other user alone.

## 3. Check "RLS enabled" in the dashboard

1. Open **Table Editor** and pick the `public` schema.
2. Open each of `profiles`, `lesson_progress`, `exercise_results`, `lesson_scores` and `saved_vocab`. None should show the "RLS disabled" or "Unrestricted" warning.
3. Open **Authentication**, then **Policies**. Each table lists its policies, all for the `authenticated` role: `profiles` has read and update; `lesson_progress` and `exercise_results` have read, insert, update and delete; `lesson_scores` and `saved_vocab` have read, insert and delete.

## 4. Run the Security Advisor

After the migrations, open **Advisors**, then **Security Advisor**, and click **Refresh** (or "Rerun linter").

- There should be no error for these tables (no "RLS disabled in public", no "Policy exists RLS disabled").
- The three functions set `search_path = ''`, so "Function search path mutable" shouldn't appear for them.
- Fix or note anything it reports about these objects before building on them. Warnings about Auth settings (for example leaked password protection) aren't from these migrations.

## 5. What the tables store and why

The tables mirror `lib/progress.ts`, so a later `SupabaseProgressStore` can implement the same `ProgressStore` interface. Every progress row has `user_id` (references `auth.users`, `on delete cascade`). Ids are the site's permanent content ids, never titles or slugs. Every text id has a length check.

| Table | One row per | Columns | Why |
|---|---|---|---|
| `profiles` | user | `id`, `display_name`, `avatar_url`, `created_at`, `updated_at`, `last_active_at` | Name and picture from Google, and "last active" for streaks later. Created by the sign-up trigger. |
| `lesson_progress` | user and lesson | `lesson_id`, `status` (`in_progress` or `completed`), `best_score`, `best_total`, `last_run_at`, `completed_at`, `updated_at` | `LessonProgress` in lib/progress.ts: `bestScore`, `bestTotal` and `lastCompletedAt` (= `last_run_at`). `status` and `completed_at` record when `isCompleted()` first became true. |
| `exercise_results` | user and exercise | `lesson_id`, `exercise_id`, `correct`, `attempts`, `correct_count`, `last_result`, `updated_at` | `ExerciseProgress`: `attempts`, `correct` (a count, = `correct_count`), `lastResult` (`correct`, `correct-accents` or `incorrect`) and `lastAttemptedAt` (= `updated_at`). `correct` is true when the last answer was accepted. `lesson_id` lets a lesson's results be read in one query. |
| `lesson_scores` | finished full run | `id`, `lesson_id`, `score`, `total`, `created_at` | Every `recordRun`, append-only, so history isn't lost when only the best is kept. |
| `saved_vocab` | user and vocab entry | `vocab_id`, `lesson_id`, `saved_at` | Words saved for review (for spaced repetition later). Not used by the app yet. |

**Privileges.** `anon` and `public` have none. `authenticated` has:

- `profiles`: select, and update of `display_name`, `avatar_url` and `last_active_at` only. No insert (the trigger creates the row) and no delete (deleting the user cascades).
- `lesson_progress`, `exercise_results`: select, insert, update, delete.
- `lesson_scores`, `saved_vocab`: select, insert, delete (no update: runs are append-only, and a word is saved or unsaved).

Every policy compares `(select auth.uid())` with `user_id` (`id` for profiles) in both USING and WITH CHECK, so a user can neither see another user's rows nor write or move a row to another id. RLS is also forced, so the table owner is subject to it; roles with BYPASSRLS (Supabase's `postgres` and service role) are not.

**`touch_last_active()`** sets the caller's `last_active_at` to now. It is security invoker, so it runs with the caller's rights and RLS. Only `authenticated` can execute it. The app doesn't call it yet.

## 6. How deleting an account removes the data

Delete the user in **Authentication**, then **Users** (or through the Admin API). Every table references `auth.users(id)` with `on delete cascade`, so Postgres deletes the user's profile and every row in `lesson_progress`, `exercise_results`, `lesson_scores` and `saved_vocab` in the same statement. The RLS test checks this. Nothing else holds user data.

## 7. Undo

`supabase/rollback/rollback_all.sql` drops everything the migrations create, in dependency order. **It deletes every profile and all learner progress, with no undo.** It leaves `auth.users` alone.

## 8. Not done yet

- **The progress store.** `lib/progress.ts` still uses localStorage only. A `SupabaseProgressStore` behind the same interface comes next. Note: `recordAttempt(exerciseId, result)` doesn't receive the lesson id, which `exercise_results.lesson_id` needs; the store will need it passed in (ExercisePlayer has it).
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
