-- 0003_rls.sql
-- Row level security: a signed-in user can reach only their own rows; anon reaches nothing.
-- Safe to run more than once. Run after 0001 and 0002.
--
-- Rules:
--   * RLS is enabled AND forced on every table (forced: the table owner is subject to it too;
--     roles with BYPASSRLS, such as Supabase's service role, still bypass it).
--   * anon and public get no privileges at all; authenticated gets only what the app needs.
--   * Every policy is "to authenticated" and compares (select auth.uid()) with the row's owner
--     in USING (which rows you can see or touch) and WITH CHECK (what a row may look like after
--     an insert or update), so a user can't write or move a row to another user's id.

-- ---------- Enable and force RLS ----------
alter table public.profiles          enable row level security;
alter table public.profiles          force row level security;
alter table public.lesson_progress   enable row level security;
alter table public.lesson_progress   force row level security;
alter table public.exercise_results  enable row level security;
alter table public.exercise_results  force row level security;
alter table public.lesson_scores     enable row level security;
alter table public.lesson_scores     force row level security;
alter table public.saved_vocab       enable row level security;
alter table public.saved_vocab       force row level security;

-- ---------- Privileges ----------
-- Supabase grants everything on new public tables to anon and authenticated by default; start
-- from nothing and grant back only what's needed.
revoke all on table
  public.profiles, public.lesson_progress, public.exercise_results, public.lesson_scores, public.saved_vocab
  from public, anon, authenticated;
revoke all on sequence public.lesson_scores_id_seq from public, anon, authenticated;

-- profiles: read your row; change only the editable columns (never id or created_at).
-- No insert (the sign-up trigger creates the row) and no delete (deleting the user cascades).
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url, last_active_at) on table public.profiles to authenticated;

-- Progress that is updated in place.
grant select, insert, update, delete on table public.lesson_progress to authenticated;
grant select, insert, update, delete on table public.exercise_results to authenticated;

-- Append-only runs: no update. Delete is for "reset my progress".
grant select, insert, delete on table public.lesson_scores to authenticated;

-- Saved vocab is saved or unsaved, never edited.
grant select, insert, delete on table public.saved_vocab to authenticated;

-- ---------- profiles ----------
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------- lesson_progress ----------
drop policy if exists "lesson_progress: read own" on public.lesson_progress;
create policy "lesson_progress: read own" on public.lesson_progress
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "lesson_progress: insert own" on public.lesson_progress;
create policy "lesson_progress: insert own" on public.lesson_progress
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "lesson_progress: update own" on public.lesson_progress;
create policy "lesson_progress: update own" on public.lesson_progress
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "lesson_progress: delete own" on public.lesson_progress;
create policy "lesson_progress: delete own" on public.lesson_progress
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- exercise_results ----------
drop policy if exists "exercise_results: read own" on public.exercise_results;
create policy "exercise_results: read own" on public.exercise_results
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "exercise_results: insert own" on public.exercise_results;
create policy "exercise_results: insert own" on public.exercise_results
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "exercise_results: update own" on public.exercise_results;
create policy "exercise_results: update own" on public.exercise_results
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "exercise_results: delete own" on public.exercise_results;
create policy "exercise_results: delete own" on public.exercise_results
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- lesson_scores (no update policy: there is no update grant) ----------
drop policy if exists "lesson_scores: read own" on public.lesson_scores;
create policy "lesson_scores: read own" on public.lesson_scores
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "lesson_scores: insert own" on public.lesson_scores;
create policy "lesson_scores: insert own" on public.lesson_scores
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "lesson_scores: delete own" on public.lesson_scores;
create policy "lesson_scores: delete own" on public.lesson_scores
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- saved_vocab (no update policy: there is no update grant) ----------
drop policy if exists "saved_vocab: read own" on public.saved_vocab;
create policy "saved_vocab: read own" on public.saved_vocab
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "saved_vocab: insert own" on public.saved_vocab;
create policy "saved_vocab: insert own" on public.saved_vocab
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "saved_vocab: delete own" on public.saved_vocab;
create policy "saved_vocab: delete own" on public.saved_vocab
  for delete to authenticated
  using ((select auth.uid()) = user_id);
