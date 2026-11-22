-- rollback/0006_progress_sync.sql
-- Undoes migration 0006 and returns the progress tables to their 0002/0003 state.
-- WARNING: this deletes every writing-task record (writing_task_progress) and the
-- exercise_results.last_attempt_at column. lesson_progress and exercise_results rows are kept.
-- lesson_scores comes back empty (its old rows were never kept: 0006 only drops it when empty).
-- After this, signed-in users can again insert and update their progress rows directly.

begin;

drop function if exists public.apply_progress(jsonb);
drop table if exists public.writing_task_progress;

alter table public.exercise_results drop column if exists last_attempt_at;
create index if not exists exercise_results_user_lesson_idx
  on public.exercise_results (user_id, lesson_id);

grant insert, update on table public.lesson_progress, public.exercise_results to authenticated;

-- lesson_scores, as in 0002 and 0003.
create table if not exists public.lesson_scores (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null check (char_length(lesson_id) between 1 and 120),
  score int not null,
  total int not null,
  created_at timestamptz not null default now(),
  check (total > 0),
  check (score between 0 and total)
);

create index if not exists lesson_scores_user_lesson_idx
  on public.lesson_scores (user_id, lesson_id);

alter table public.lesson_scores enable row level security;
alter table public.lesson_scores force row level security;

revoke all on table public.lesson_scores from public, anon, authenticated;
revoke all on sequence public.lesson_scores_id_seq from public, anon, authenticated;
grant select, insert, delete on table public.lesson_scores to authenticated;

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

commit;
