# Progress feature: plan

Status: plan approved with amendments (Prompt 54). Rollout step 1 (migration 0006) is written but not yet run in Supabase.

## Decisions (owner, Prompt 54)

1. **The db branch is already on master.** `origin/db` (88575a3) was merged as PR #2 (68e2d9f); there's nothing to merge or rebuild. Migrations: as per the owner's step 0 results. **Those results were not filled in yet** (the Prompt 54 template still had blanks), so 0006 checks its own preconditions: it stops, changing nothing, if 0001 to 0003 haven't run or if `lesson_scores` has rows.
2. **Drop `lesson_scores`** (0006 drops it only if it's empty).
3. **Writes only through `apply_progress`.** Direct insert and update are revoked from authenticated (section 5).
4. **Dashboard order as proposed:** Continue, per level and unit, started but not finished, review lessons to revisit (section 9).
5. **Last lesson practised**, not last opened: no write per page view.
6. **Anonymous progress after sign-out, as proposed:** the browser's anonymous progress stays as it was, and the signed-in user's cache is cleared on sign-out (pending answers are kept). Plus the import-owner rule: the browser's signed-out progress is imported only into the first account that signs in on that browser (section 8).
7. **Import notice:** one line on the dashboard, shown once.

Amendments in Prompt 54: import owner (section 8); runs accept any total from 1 to 1,000 (sections 7, 10); no clamping of times and a 24-hour rule (sections 5, 7); at most two outbox entries per key, one in flight and frozen (section 6); one Web Lock around every read-modify-write (section 6); "server action not found" and malformed replies are whole-call failures (section 6); the writing-task finding (section 3); execute grants on `apply_progress` (section 5).

## 1. Preflight findings

- `git status`: clean. Branch: master. `git fetch` done.
- `git log master..origin/db`: empty. `origin/db..master`: 25 commits (C1, C2, payments, SEO). `git diff master...origin/db --stat`: empty, because the db branch is an ancestor of master.
- Clean apply: yes, trivially. `git merge-base --is-ancestor origin/db master` succeeds and `git merge-tree` reports no conflicts.

What the db commit added (all still on master; payments later added 0005 and extended the RLS test):

| Item | Content |
|---|---|
| `0001_profiles.sql` | `profiles` (id → auth.users, display_name ≤ 200, avatar_url ≤ 2048, created_at, updated_at, last_active_at); `set_updated_at()` trigger function; `handle_new_user()` sign-up trigger (security definer, `search_path = ''`); backfill for existing users. |
| `0002_progress.sql` | `lesson_progress` PK (user_id, lesson_id): status `in_progress`/`completed`, best_score, best_total > 0, last_run_at, completed_at, updated_at; checks best_score ≤ best_total and "completed ⇔ completed_at set". `exercise_results` PK (user_id, exercise_id): lesson_id, correct, attempts, correct_count, last_result (`correct`, `correct-accents`, `incorrect`), updated_at; checks correct_count ≤ attempts and correct = (last_result ≠ incorrect); index (user_id, lesson_id). `lesson_scores` (identity id, user_id, lesson_id, score, total, created_at; index (user_id, lesson_id)). `saved_vocab` PK (user_id, vocab_id). Length checks on every id. `updated_at` triggers. |
| `0003_rls.sql` | RLS enabled and forced on all five tables; all grants revoked from public, anon, authenticated, then granted back: profiles select + update of 3 columns; lesson_progress and exercise_results select/insert/update/delete; lesson_scores and saved_vocab select/insert/delete. Every policy is `to authenticated` with `(select auth.uid()) = user_id` in USING and WITH CHECK. |
| `0004_activity.sql` | `touch_last_active()`, security invoker, authenticated only. Not called by the app. |
| `rollback/rollback_all.sql` | Drops everything (now 0001 to 0005). Deletes all user data. |
| `tests/rls.sql` | One transaction ending in rollback: two fake users, own-row CRUD, cross-user refusal, anon refusal, cascade on user delete. |
| `proxy.ts` | Refreshes the Supabase session cookie on every request (`getClaims()`). With no env vars or an auth error it logs and lets the request through; it never grants access. |
| `lib/supabase/env.ts`, `client.ts`, `server.ts` | Return null when `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is missing, so "not configured" means "signed out" everywhere. |
| `lib/auth.ts` | `getCurrentUser()` via `getUser()`, fails closed (null) on missing config, client error or unreachable auth server. |
| `scripts/test-no-supabase-env.mjs` | Builds and runs the app with empty Supabase vars and checks pages still work. |

No app code reads or writes the progress tables yet. The **fail-safe proxy does nothing for progress**: it only keeps the session cookie fresh and fails open for page requests. Offline and outage handling for progress has to be built (section 6).

## 2. Current state (localStorage)

Code: `lib/progress.ts` exports the `ProgressStore` interface and `progressStore`, a single `LocalProgressStore`. All methods are async.

Keys:

- `parlons-progress-v1`: all progress, one JSON object.
- `parlons-writing-draft-v1:<exercise-id>`: the text of a C2 writing task (lib/writing-draft.ts). Never part of progress, never sent anywhere. This plan does not touch it.

Shape of `parlons-progress-v1` (`ProgressData`):

```json
{
  "exercises": {
    "a1-etre-present-ex003": { "attempts": 2, "correct": 1, "lastResult": "correct-accents", "lastAttemptedAt": "2026-11-20T09:14:03.120Z" }
  },
  "lessons": {
    "a1-etre-present": { "bestScore": 11, "bestTotal": 12, "lastCompletedAt": "2026-11-20T09:16:40.002Z" }
  },
  "writingTasks": {
    "c2-some-lesson-ex016": { "done": true, "checked": [0, 2, 3], "doneAt": "2026-11-21T18:02:11.500Z" }
  }
}
```

`writingTasks` is optional (older saves lack it). "Completed" is `bestScore / bestTotal ≥ 0.8` (`isCompleted`). The local store doesn't record *when* a lesson was first completed, only the last full run.

Components that depend on it:

| Component | Calls |
|---|---|
| `components/exercise-player.tsx` | `getLessonProgress(lessonId)` on mount; `recordAttempt(exerciseId, status)` after each check; `recordRun(lessonId, score, total)` at the end of a full run (not a retry). |
| `components/writing-task.tsx` | `getWritingTask(exerciseId)` on mount; `recordWritingTask(exerciseId, checked)` on "Mark as done". Takes no text, by design. |
| `components/progress-status.tsx` | `getAll()`: `LessonStatus` (each lesson row on `/lessons/[level]`) and `LevelCompletion` (each level card on `/lessons`). Every row calls `getAll()` separately. |

`reset()` exists but nothing calls it. No component reads `exercises` from `getAll()`, and nothing displays attempts or correct counts.

Content today (counted from content/lessons): 326 lessons, 4,620 graded exercises, 25 writing tasks (C2 only, checklists of at most 6 items). Average lesson id 20.7 characters, exercise id 26.7. Every exercise id starts with `<lesson-id>-ex` (0 exceptions), which lets the store derive the lesson id (section 6).

## 3. Data model

Kept from the db branch: `profiles`, `lesson_progress`, `exercise_results`, `saved_vocab` (unused, kept for spaced repetition later).

Changes in `supabase/migrations/0006_progress_sync.sql` (written in Prompt 54, one transaction, safe to re-run; undo with `supabase/rollback/0006_progress_sync.sql`):

1. **New table `writing_task_progress`**, with no text column:

   | Column | Type | Notes |
   |---|---|---|
   | user_id | uuid not null | → auth.users on delete cascade |
   | exercise_id | text not null | length 1 to 160 |
   | lesson_id | text not null | length 1 to 120 |
   | done | boolean not null default true | `check (done)`: a row exists only once marked done |
   | checked | smallint[] not null default '{}' | `check (cardinality(checked) <= 10 and checked <@ '{0,1,2,3,4,5,6,7,8,9}')` |
   | done_at | timestamptz not null | when it was marked done |
   | updated_at | timestamptz not null default now() | trigger |

   PK (user_id, exercise_id). RLS enabled and forced, with two policies, read own and delete own. There's no insert or update policy and no such grant, so RLS denies any write that doesn't come through `apply_progress`.

   **Writing-task finding (Prompt 54).** `components/writing-task.tsx` has no way to un-mark a task: there's only "Mark as done", which stays enabled, and no control sets `done` back to false. The checkboxes stay editable after marking done, but a change is saved only when the learner presses "Mark as done" again, which calls `recordWritingTask` with a new `doneAt`. So the model keeps `check (done)`: a row exists only once the task is done, and changed ticks are a new record with a later `done_at`, which replaces the old one whole. Ticks changed without pressing "Mark as done" are not saved (as today: a reload shows the last saved ticks).

2. **`exercise_results`:** add `last_attempt_at timestamptz not null default now()`, the client time of the latest counted attempt; rows that already exist take their `updated_at`. It makes retries idempotent and stops a late, older answer from overwriting a newer one (section 7). Drop `exercise_results_user_lesson_idx`: nothing queries one lesson's results, and reads by user use the primary key's first column. This saves about a quarter of the table's size.
3. **Drop `lesson_scores`** (decision 2). 0006 checks the table first and stops with an error, changing nothing, if it has any rows.
4. **Write path through one function** (decision 3): revoke insert and update on `lesson_progress`, `exercise_results` and `writing_task_progress` from authenticated; keep select and delete. Add `public.apply_progress(p_items jsonb) returns jsonb` (sections 5 and 7).

What each exercise type stores:

| Exercise type | Stored |
|---|---|
| multiple-choice, fill-in, translate, reorder, reformulation, register-shift, error-correction, connector-choice | One `exercise_results` row: attempts, correct_count, last_result (`correct`, `correct-accents`, `incorrect`), correct, last_attempt_at. Never the learner's typed text or chosen option. |
| writing-task (C2) | One `writing_task_progress` row: done, the ticked checklist indices, done_at. Never the text (C2 privacy rule). Never in `exercise_results` or the lesson score. |
| A full run of a lesson | One `lesson_progress` row: best score and total, last run, status and first completion. |

## 4. Storage budget (Supabase free plan, 500 MB)

One row per user per exercise, one per user per lesson, one per user per writing task; latest or best values only, no history. Estimates use Postgres's layout (24-byte row header, 4-byte line pointer, 8-byte alignment), the average id lengths above, B-tree leaves about 75% full, and ×1.3 for dead row versions left by updates until autovacuum and for page overhead.

| Table | Heap per row | PK index per row | With ×1.3 |
|---|---|---|---|
| exercise_results (after 0006) | ~132 B | ~75 B | **~270 B** |
| exercise_results (as now, with the second index and without last_attempt_at) | ~124 B | ~150 B (two indexes) | ~355 B |
| lesson_progress | ~116 B | ~70 B | **~250 B** |
| writing_task_progress | ~156 B | ~80 B | **~310 B** |

Per user:

- **20 lessons** (A1, about 12 exercises each, so 240 exercises): 240 × 270 + 20 × 250 ≈ **70 KB**.
- **All of A1 to C2** (4,620 exercises, 326 lessons, 25 writing tasks): 4,620 × 270 + 326 × 250 + 25 × 310 ≈ **1.35 MB**.

Users in 400 MB (leaving about 100 MB for Supabase's own schemas, auth, profiles and purchases; measure that baseline before launch):

- if every user had done 20 lessons: about **5,700 users**;
- if every user had finished everything: about **290 users**.

A real mix sits in between, close to the first figure, since most learners do few lessons. If the database passes 300 MB, the next levers are: shorten `last_result` to a smallint code, drop `exercise_results.lesson_id` (it's derivable from the id prefix), or delete rows of accounts inactive for a long time (an owner decision).

How to check the real size later:

- Dashboard: the project's **Usage** page, "Database Size" (the prompt names Settings → Usage → Database Size; the exact menu may move).
- SQL Editor:

  ```sql
  select pg_size_pretty(pg_database_size(current_database()));
  select c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) as total
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by pg_total_relation_size(c.oid) desc;
  select pg_total_relation_size('public.exercise_results') / nullif(count(*), 0) as bytes_per_row
    from public.exercise_results;
  ```

## 5. Security

- **RLS on every table**, enabled and forced, `to authenticated`, `(select auth.uid()) = user_id` in USING and WITH CHECK (unchanged from 0003; the same for the new table). anon gets nothing.
- **No service-role key in the browser.** Progress never uses the service role at all: server actions use the user's own session client (`lib/supabase/server.ts`), so RLS applies. `SUPABASE_SERVICE_ROLE_KEY` stays server-only, for the payment webhook. Only the two `NEXT_PUBLIC_` values reach the browser, which is how Supabase is designed.
- **Writes through `apply_progress(p_items jsonb)` only.** `security definer`, `set search_path = ''`, every name schema-qualified. It takes the user id from `auth.uid()` (raises if null) and never from its input; a `userId` in an entry is ignored. Because it runs as the owner (which bypasses RLS), every statement inside filters by that id explicitly. Per item it checks: id lengths and formats (`^[a-z0-9]+(-[a-z0-9]+)*$` for lessons, exactly `<lesson-id>-ex<digits>` for exercises), result values, counts that agree with the result, 1 ≤ total ≤ 1,000 and 0 ≤ score ≤ total, ISO times. It **rejects an entry more than 24 hours ahead of server time** and stores every other time exactly as sent, with no clamping anywhere: clamping would give a resent entry a new time, and it would be counted twice. It caps rows per user (6,000 exercise results, 600 lessons, 200 writing tasks), checked only when inserting a new row. The caps are constants in the function; validate:content warns when content reaches 80% of a cap. Anyone calling the function directly (bypassing the server action) can only write well-formed rows to their own account, up to the cap.
- **Who may execute it.** Postgres grants execute on a new function to PUBLIC by default, and Supabase's default privileges also grant it to anon, authenticated and service_role. 0006 revokes it from all of them, then grants execute to authenticated only. A service-role call would fail anyway, because it has no `auth.uid()`.
- **Server actions check the session** with `getCurrentUser()` (lib/auth.ts, `getUser()`, which verifies the token with the auth server), never `getSession()` or a client-sent id. They validate every id against the content index on the server (`lib/lessons.ts`), so normal writes only ever name real exercises. Per the Next.js server-actions guide, actions are public POST endpoints: each one authenticates, validates and returns only a small status object, never database rows beyond the user's own progress.
- **Privacy:** no writing text in any table, payload, action or log. Actions log only error codes, never inputs. app/privacy/page.tsx currently says progress is stored only in the browser; it must be updated in the same step as the store (step 4 of the rollout).

## 6. The store

`lib/progress.ts` keeps the `ProgressStore` interface and the `progressStore` export, so the three components don't change. `progressStore` becomes a small facade:

- **Signed out, Supabase not configured, or `NEXT_PUBLIC_PROGRESS_SYNC` not `on`:** `LocalProgressStore`, exactly as today (key `parlons-progress-v1`).
- **Signed in:** `SupabaseProgressStore` for that user id. The facade reads the user id from the browser client's local session (`getSession()`, no network, so it works offline) and listens to `onAuthStateChange`. This only chooses where to cache; the server re-checks the user on every write.

`SupabaseProgressStore(userId)` keeps two localStorage entries per user:

- **Cache** `parlons-progress-v1:u:<userId>`: the last server snapshot with pending changes applied (same `ProgressData` shape).
- **Outbox** `parlons-progress-outbox-v1:<userId>`: changes not yet confirmed by the server. Each key (an exercise, a lesson or a writing task) holds **at most two entries**: the one in flight, which is frozen, and one pending. So the outbox is bounded by twice the content size, about 1.2 MB at worst.

Exact behaviour:

1. **Write** (`recordAttempt`, `recordRun`, `recordWritingTask`): under the outbox lock (point 5), update the cache and the key's *pending* entry, and resolve with the same value the local store would return. The UI never waits for the network. Then schedule a flush. The lesson id is derived from the exercise id prefix (validate:content enforces it from step 2).
   - A pending attempt holds `{ result, attemptedAt, addAttempts, addCorrect }`. A second answer to the same exercise before a flush adds to the pending counts and takes the newer result and time.
   - A pending run is merged with a new run by the same best-of rule as the server.
   - A pending writing record is replaced by the newer one.
   - **A sent entry is never merged with a new answer.** While a key's entry is in flight, a new answer goes into its pending entry.
2. **Flush:** one flusher per browser at a time. It holds the Web Lock `parlons-progress-flush` (requested with `ifAvailable`, so other tabs skip instead of queueing) for the whole flush. Under the outbox lock it marks up to 200 entries as in flight: every key's existing in-flight entry first, then pending entries for keys with nothing in flight, in the order they were written. Then it releases the outbox lock and calls `syncProgressAction`. `apply_progress` processes entries in the order sent. Because the browser releases a lock when its tab closes, any in-flight entries found by the next holder of `parlons-progress-flush` belong to a flusher that has gone, and they're sent again. Resending is harmless (section 7). Triggers: after each write (debounced 1 s), on page load, on `online`, on `visibilitychange` to visible, and on a retry timer (30 s, doubling to 5 min).
3. **Result per entry**, applied under the outbox lock:
   - *applied* (including a no-op, such as a resent entry): remove the in-flight entry; the key's pending entry, if any, becomes the next to send. The cache takes the server's record for that key from the reply's `rows` (the server wins on ties), with any pending entry re-applied on top (section 7, "As built in step 3").
   - *rejected* (unknown id, bad shape, `future_time`, `cap_reached`): remove it and keep the cache value. Log the key and code to the console only. A rejection is per entry: only a reply listing the entry under `rejected` counts as one.
   - *whole call failed* (network error, timeout, Supabase down, `unavailable`, `signed-out`): keep both entries per key, in flight then pending, and send both next time, in that order. Retry with backoff.
   - *"Failed to find Server Action"* (the page was loaded before a deploy, so its action id no longer exists), or any reply that isn't a status object (`{ status: … }` with the fields section 7 lists): a whole-call failure, so everything is kept, and **no more retries until the next page load**, which loads the new build. Never treated as a rejection.
   - *wrong-user* (the server session is another user): keep everything for this user, stop flushing, and switch the facade to the session's user.
4. **Reads** (`getAll`, `getLessonProgress`, `getWritingTask`): from the cache at once. Once per page load, and on visibility after 5 minutes, fetch `getProgressAction()`, replace the cache with the server snapshot, then re-apply the outbox on top. All callers share one in-flight fetch, which also fixes the many separate `getAll()` calls on a level page. If the fetch fails, the cache stays as it is. On a new device that's offline, the user sees empty progress until the first fetch works; nothing on the server is overwritten, because every write is an increment or a "best of".
5. **Tabs.** Every read-modify-write of the cache, the outbox or the import keys (section 8) runs under one Web Lock, `parlons-progress-outbox`. Inside the lock the code re-reads localStorage, so it never writes back a copy another tab has since changed. The lock is held only for the synchronous read, change and write, never across a network call. Where the Web Locks API is missing (browsers from before 2022), there's no lock, and two tabs writing in the same few milliseconds can overwrite each other's change. What can be lost then: one tab's update to the cache, or to the outbox, made between another tab's read and write. That's at most the latest answer in one tab, or one import key. Duplicate sends are harmless, because every entry is idempotent.
6. **Sign-out:** the facade switches to the local store. That user's cache is deleted; their outbox is kept if it isn't empty and flushes the next time the same user signs in on this browser. Nothing is ever lost because the network or Supabase is down.
7. `reset()`: deletes the user's cache and outbox and calls `resetProgressAction`. No UI calls it yet.

**As built in step 4 (Prompt 60).** The code is in lib/progress-store.ts (store and facade), lib/progress-outbox.ts (pure outbox), lib/progress-core.ts (types, local store, shared update rules) and lib/progress-wiring.ts (the Supabase session and actions, loaded only when sync is on). Where it differs from, or adds to, the text above:

- Pending runs are kept as one merged lesson record and sent as an `import-lesson` entry, so a passing run followed by a failing one keeps the earlier completion date.
- The first read on a page waits up to 3 s for the shared server snapshot, then falls back to the cache.
- Rejected entries are kept in `parlons-progress-rejected-v1:<userId>` (the newest 500, with their code, ids, counts and times, never text). They're laid back over every snapshot so the learner's record stays visible, and never sent again.
- While backing off, a new write doesn't bring the next send forward.
- On sign-out, or when another account signs in, every other account's cache is removed, not only the previous user's. Outboxes stay.
- Next.js 16 reports a stale action as 409 "Server Action unavailable.", which counts as "action not found".

Known limit (by design): when two devices answer the same exercise, an attempt made offline on one device and synced after a newer attempt from the other device is ignored, both its count and its result. The newer result is the right one to keep; only the attempt count is low, and nothing displays it.

`LocalProgressStore` gets one addition: an optional `completedAt` on `LessonProgress`, set the first time a run reaches the pass mark, so later imports know the real first completion date.

## 7. Server actions

File: `app/actions/progress.ts` (`"use server"`). Each one starts with `getCurrentUser()`; null means `{ status: "signed-out" }`. Each takes `expectedUserId` and returns `{ status: "wrong-user" }` if it differs from the session user (a safety check only; the id written is always the session's). Supabase errors return `{ status: "unavailable" }`.

| Action | Input | Validation | Writes |
|---|---|---|---|
| `getProgressAction(expectedUserId)` | user id | session | Nothing. Reads the user's three tables (RLS) and returns `ProgressData`. |
| `syncProgressAction({ expectedUserId, items })` | 1 to 200 items, each `attempt`, `run`, `writing`, `import-exercise` or `import-lesson` | exercise and writing ids exist in the content index and belong to their lesson; attempts only for graded exercises, writing only for writing tasks; result in the enum; a run needs a **known lesson id**, 1 ≤ total ≤ 1,000 and 0 ≤ score ≤ total (not checked against the lesson's current exercise count, so a run finished on a page loaded before a deploy is never lost); attempt counts 1 to 1,000 (imported counts 1 to 100,000), agreeing with the result (an accepted last answer means at least one correct); `checked` integers 0 to 9, deduplicated and sorted; times valid ISO with a time zone, **stored as sent, never clamped**, and rejected if more than 24 hours ahead of server time | One `apply_progress` call with the valid items, in the order received. Returns `{ status: "ok", applied: keys[], rejected: { key, code }[] }`: the action's own rejections plus those from `apply_progress`. |
| `resetProgressAction({ expectedUserId, confirm: "reset" })` | literal confirm | session | Deletes the user's rows in the three tables (delete grants kept). |

Entry shapes (the client's `key` is echoed back; the same shapes are documented at the top of `apply_progress` in 0006):

| kind | fields |
|---|---|
| `attempt` | `lessonId`, `exerciseId`, `result`, `attemptedAt`, `addAttempts`, `addCorrect` |
| `import-exercise` | `lessonId`, `exerciseId`, `lastResult`, `lastAttemptedAt`, `attempts`, `correct` |
| `run` | `lessonId`, `score`, `total`, `runAt` |
| `import-lesson` | `lessonId`, `bestScore`, `bestTotal`, `lastRunAt`, `completedAt` (optional) |
| `writing` | `lessonId`, `exerciseId`, `checked`, `doneAt` (never any text) |

**As built in step 3 (Prompt 59).** `app/actions/progress.ts` wires `lib/progress-sync.ts` (`runSync`, tested with a fake database) and `lib/progress-validate.ts` (pure) to Supabase. Ids are checked against `lib/generated/progress-index.json`, imported as a module, so validation reads no files. `getCurrentUser` moved to `lib/current-user.ts` so the actions don't import `lib/lessons.ts`.

- **Two levels of rejection.**
  - *Whole payload* (`{ status: "invalid", code }`; nothing is written or read): not an object, no `expectedUserId`, no entries, more than 200 entries (`too_many_items`), more than 128 KiB (`too_large`), a missing or over-long key, a repeated key (`duplicate_key`), or any field an entry's kind doesn't define (`unexpected_field`). So writing text, or a typed answer, can never be stored. Step 4 treats `invalid` as a bug: log the code, keep the outbox, and don't retry until the next page load.
  - *Per entry* (as above; the rest of the call goes ahead): adds `unknown_id`, `wrong_lesson` (the exercise belongs to another lesson, for example the other `review-work`) and `wrong_kind` (a writing task sent as an attempt, or the reverse) to apply_progress's codes. Times must be real dates with at most millisecond precision (stricter than apply_progress).
- **Reply:** `{ status: "ok", applied: key[], rejected: { key, code }[], rows: ProgressData }`. `rows` holds the server's stored record, read back in the same request after `apply_progress`, for every lesson, exercise and writing task that a valid entry names. Times are millisecond ISO strings (`2026-11-20T09:14:03.120Z`). A record with no row (for example `cap_reached` on a new one) is absent. If the read-back fails, the reply is `unavailable` and the client resends, which is harmless.
- **Step 4 rule:** after an `ok` reply, the cache replaces each record in `rows` with the server's version, and the server wins on ties. Then it re-applies the pending outbox entries for those keys on top.

`apply_progress` repeats the format, range and 24-hour checks (it can be called directly) and adds the per-user caps. Its rejection codes: `bad_item`, `bad_kind`, `bad_time`, `future_time`, `bad_id`, `bad_count`, `bad_result`, `bad_score`, `bad_checked`, `cap_reached`, `invalid` (a value that can't be parsed or breaks a table check).

Idempotency inside `apply_progress` (so a double click, a retry or a duplicate import changes nothing):

- **attempt**: `insert … on conflict (user_id, exercise_id) do update` only `where excluded.last_attempt_at > exercise_results.last_attempt_at`. A resent entry has the same `attemptedAt` (times are never clamped, so it stays the same), so it's a no-op; an older one arriving late is ignored. The update adds `addAttempts` and `addCorrect` and sets last_result, correct and last_attempt_at. This is why the outbox sends a key's in-flight entry before its pending one: the pending one is newer, and sent first it would make the in-flight one look old.
- **run** and **import-lesson**: best of the two by ratio, compared with integers (`new_score * old_total > old_score * new_total`), a tie keeps the stored row; `last_run_at` = the later; `completed_at` = the earlier completion; `status` follows the merged best. Running it twice gives the same row.
- **writing**: the record with the later `done_at` wins whole; an equal `done_at` is a no-op.
- **import-exercise**: attempts = max, correct_count = max, last_result and last_attempt_at from the newer side. Max, not sum, so it's idempotent.

A double click on "Mark as done" or "Check" is already harmless: each produces one outbox entry, and a repeat writes the same values.

## 8. Importing localStorage

- **Import owner.** The signed-out progress in a browser belongs to one account: the **first account that signs in on that browser**. The key `parlons-progress-import-owner-v1` holds that user id. It's set once, under the outbox lock, the first time any account signs in while the key is absent, and it's never changed by a later sign-in.
  - The owner gets the import, and later signed-out work in that browser is re-imported only into the owner's account.
  - Any other account signing in on the same browser gets no import and sees only its own progress.
  - Signing out never clears the owner key.
- **When:** in the browser, when the facade sees signed-in user U, U is the import owner (or the key was absent and has just been set to U), and the anonymous store (`parlons-progress-v1`) has any record newer than the marker `parlons-progress-imported-v1` (absent before the first import). So it runs on the owner's first sign-in, and again only if there's newer signed-out work.
- **How:** turn the anonymous data into `import-exercise`, `import-lesson` and `writing` entries in U's outbox, then set the marker to the newest timestamp imported, all under the outbox lock. The usual flush sends them (about 25 calls for a learner who has done everything), with the same retry and fallback. The import never runs twice for the same data: the marker stops it, and if it ran twice anyway (two tabs, a crash before the marker was written), every merge rule is idempotent.
- **Merge rules** (the server applies them in `apply_progress`):
  - **Lessons:** keep the best score (higher ratio; on a tie, the server's row). Keep the **earliest completion date**: local `completedAt` when present, otherwise local `lastCompletedAt` if the local best passes (the last run is the best date the old format has). Keep the latest `last_run_at`. Why: progress never goes backwards, and nothing a learner achieved on either side is lost.
  - **Exercises:** max of attempts and of correct counts; the newer answer's result and time. Why: nothing shows these counts yet, and max is safe to repeat; a sum would double-count after a retry.
  - **Writing tasks:** the later "done" wins, with its ticks. Why: the ticks describe the text checked last; a union would mix two drafts.
  - Ids no longer in the content are dropped by the server and not retried.
- **Anonymous data is left in place** (decision 6), so it isn't lost if the import fails, and a signed-out visitor on that device still sees it.
- **What the user sees:** nothing blocking and no choice to make, because the merge loses nothing. Lesson badges update as soon as the entries are applied locally. Once the import entries are confirmed, the dashboard shows one line, once: "We added the progress saved in this browser to your account." (decision 7). An account that isn't the import owner never sees it.

## 9. Dashboard

- **Route:** `/progress` (`app/progress/page.tsx`), linked as "Progress" in the header next to "Lessons". The server part renders the lesson catalogue (levels, units, ids, titles, types and URLs from lib/lessons.ts; metadata only, already public on the level pages). A client component reads `progressStore.getAll()` and fills it in, so the page needs no cookies at render time and works with `cacheComponents`. The figures come from a pure function, `lib/progress-summary.ts`, which is unit tested.
- **What it shows**, first version (decision 4):
  1. **Continue:** the last lesson practised (latest answer or run), with a link.
  2. **Per level:** completed / total, with a bar; each level opens to its units with completed / total per unit.
  3. **Started, not finished:** lessons with at least one answer or run but not completed, most recent first, at most 10.
  4. **Review lessons to revisit:** review lessons attempted but not completed, and review lessons whose unit's other lessons are all completed but which haven't been run.
  5. C2 only: writing tasks marked done, out of 25.
- **Signed out:** the same page from this browser's progress, with one line: "Your progress is saved in this browser only. Sign in to keep it across devices." and the sign-in button. With Supabase not configured, the same.
- Ids in progress that aren't in the catalogue are ignored.

## 10. Content changes

- **A lesson id or exercise id removed or renamed** (ids are meant to be permanent, but it may happen): its rows become orphans. The dashboard and badges ignore ids not in the content; the server rejects new writes for them; outbox entries for them are dropped as "rejected". Nothing is deleted automatically. A manual SQL query in docs/db-setup.md lists orphan ids, and deleting them is the owner's call.
- **A slug changes:** no effect; progress is keyed by id.
- **An exercise's answers change:** stored results stay as they were graded; nothing is re-graded.
- **A lesson gains or loses exercises:** the stored best keeps its own total ("Best 11 / 12" even if the lesson now has 14), and "completed" uses the stored ratio. A learner who reruns it gets the new total. The server doesn't compare a run's total with the lesson's current exercise count: any known lesson id with 1 ≤ total ≤ 1,000 and 0 ≤ score ≤ total is accepted, so a run finished on a page loaded before a deploy is never lost.
- **An exercise changes type** to or from writing-task: the server rejects writes of the wrong kind; old rows are ignored.
- Nothing in this path throws on unknown or orphan data: unknown ids are skipped, malformed cache or outbox JSON is discarded (outbox entries are validated on read), as the local store already does.

## 11. Tests and checks

- **Unit tests** (node --test, like `test:checker`), in a new `npm run test:progress`:
  - `lib/progress-merge.test.ts`: every merge rule, the ratio comparison (including 4/5 against 8/10), ties, earliest completion, the writing rule, and idempotency (merging the same input twice gives the same result).
  - `lib/progress-outbox.test.ts`:
    - answers coalesce into the pending entry, never into the in-flight one;
    - at most two entries per key;
    - "applied" removes the in-flight entry and promotes the pending one;
    - after a whole-call failure, both are sent next time, in flight first;
    - a per-entry rejection removes only that entry;
    - "Failed to find Server Action" and a malformed reply keep everything and pause retries until reload;
    - in-flight entries left by a closed tab are resent;
    - the size bound, and a corrupted outbox.
  - `lib/progress-store.test.ts`: `SupabaseProgressStore` with a fake `localStorage` (a Map), a fake lock (a queue) and a fake sync function: offline writes, a retry after failure, sign-out keeps the outbox, wrong-user. Two simulated tabs interleaving writes under the lock lose nothing.
  - `lib/progress-import.test.ts`: the import-owner rule.
    - The first account to sign in becomes the owner and gets the import.
    - The owner signs out, works signed out, and signs in again: only the new work is re-imported.
    - A second account signing in on the same browser gets no import and sees only its own progress, and the owner key stays unchanged.
    - Two tabs signing in at once set the owner once.
  - `lib/progress-summary.test.ts`: dashboard figures, including orphan ids.
  - A privacy test: a serialized writing entry has exactly the keys `kind, exerciseId, lessonId, checked, doneAt`.
  - Validation of action inputs, as a pure function (`lib/progress-validate.ts`), tested without Supabase.
- **SQL** (`supabase/tests/rls.sql`, extended in Prompt 54):
  - RLS forced on `writing_task_progress`; `lesson_scores` and the old index are gone.
  - Direct insert and update are refused for authenticated; anon is refused execute on `apply_progress`, which is security definer with an empty search_path, and PUBLIC can't execute it.
  - `apply_progress` writes only the caller's rows, even when an entry names the other user.
  - It ignores a resent attempt and an older attempt, stores a time 23 hours ahead as sent, and rejects one 25 hours ahead.
  - The best-of, earliest-completion and later-writing merges hold, and both import kinds are idempotent.
  - The caps refuse new rows and still update existing ones (seeded user C).
  - `writing_task_progress` has exactly the expected columns, with no text column but the ids.
  - Cross-user reads return 0 rows, and deleting a user cascades.
- **Manual checklist** (in docs/db-setup.md): two Google accounts in two browsers; answer offline (DevTools → offline), go back online, check the rows; a preview deployment with a wrong Supabase URL still saves locally; sign out and in again; import with existing local progress; Security Advisor shows nothing new.
- **validate:content** gains two checks: exercise ids start with `<lesson-id>-ex`, and a warning at 80% of the database caps.
- **Staying green:** `test:no-supabase-env` and `test:gating` must keep passing (no config means the local store). Server code is marked `server-only` and kept out of client imports. After every step: validate:content, test:content, test:checker, test:progress, build.

## 12. Rollout

Each step is one prompt, ending with the checks and a commit point (the owner commits).

0. **Owner, before anything:** in the SQL Editor run `select table_name from information_schema.tables where table_schema = 'public' order by 1;` and confirm `profiles`, `lesson_progress`, `exercise_results`, `lesson_scores`, `saved_vocab`, `purchases`, `pricing_settings` exist; run `supabase/tests/rls.sql`.
1. **Migration 0006** (table, column, index, grants, `apply_progress`, drop `lesson_scores`), its rollback, the RLS test, docs/db-setup.md, and `rollback_all.sql` updated. No app change. Owner runs 0006 and the test in Supabase. *Commit.* Written in Prompt 54; not yet run anywhere (no local Postgres was available).
2. **Content index and merge rules:** exercise index in lib/lessons.ts (built in `load()`), the two validate:content checks, `lib/progress-merge.ts`, `completedAt` in the local store, unit tests. *Commit.*
3. **Server actions:** `app/actions/progress.ts` and `lib/progress-validate.ts`, with tests. Not called by the UI yet. *Commit.*
4. **The store:** `SupabaseProgressStore`, outbox, facade, shared read cache, behind `NEXT_PUBLIC_PROGRESS_SYNC=on`; privacy page text. *Commit.*
5. **Import on sign-in** and the one-time notice. *Commit.*
6. **Dashboard** `/progress`, `lib/progress-summary.ts`, header link. *Commit.*
7. **Wrap-up:** run the manual checklist on a preview deployment, measure the database size, update docs/project-state.md. *Commit.*

**Vercel:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (already set); new `NEXT_PUBLIC_PROGRESS_SYNC=on` (Preview first, then Production; it's inlined at build, so changing it needs a redeploy). `SUPABASE_SERVICE_ROLE_KEY` is unchanged and not used by progress. **Supabase:** run 0006 in the SQL Editor, then the RLS test and the Security Advisor.

**Rollback:**

- App: set `NEXT_PUBLIC_PROGRESS_SYNC` to anything but `on` and redeploy, or revert the step's commit. Everyone falls back to the local store; outboxes stay in browsers and flush when sync is back on.
- Database: `supabase/rollback/0006_progress_sync.sql` restores the grants and the index, drops `apply_progress` and `writing_task_progress` (deleting writing-task records only), and recreates an empty `lesson_scores`. Never run `rollback_all.sql` for this: it deletes purchases too.
