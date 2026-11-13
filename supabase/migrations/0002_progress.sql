-- 0002_progress.sql
-- Learner progress, mirroring lib/progress.ts (ProgressStore) so a SupabaseProgressStore can
-- implement the same interface. Every row belongs to one auth user and is deleted with them.
-- Ids are the site's stable content ids (lesson ids, <lesson-id>-ex001, <lesson-id>-v001).
-- Safe to run more than once. Run 0001 first (it defines public.set_updated_at()).

-- One row per lesson the learner has run in full. Mirrors LessonProgress:
--   bestScore -> best_score, bestTotal -> best_total, lastCompletedAt -> last_run_at.
-- status is 'completed' once the best run reaches the pass mark in lib/progress.ts (isCompleted);
-- completed_at is when that first happened.
create table if not exists public.lesson_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null check (char_length(lesson_id) between 1 and 120),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  best_score int not null check (best_score >= 0),
  best_total int not null check (best_total > 0),
  last_run_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id),
  check (best_score <= best_total),
  check ((status = 'completed') = (completed_at is not null))
);

-- One row per exercise the learner has answered. Mirrors ExerciseProgress:
--   attempts -> attempts, correct (a count) -> correct_count, lastResult -> last_result,
--   lastAttemptedAt -> updated_at. correct is true when the last answer was accepted.
create table if not exists public.exercise_results (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null check (char_length(lesson_id) between 1 and 120),
  exercise_id text not null check (char_length(exercise_id) between 1 and 160),
  correct boolean not null,
  attempts int not null default 0 check (attempts >= 0),
  correct_count int not null default 0 check (correct_count >= 0),
  last_result text not null check (last_result in ('correct', 'correct-accents', 'incorrect')),
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id),
  check (correct_count <= attempts),
  check (correct = (last_result <> 'incorrect'))
);

create index if not exists exercise_results_user_lesson_idx
  on public.exercise_results (user_id, lesson_id);

-- Every finished full run (recordRun), append-only. lesson_progress keeps the best of these.
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

-- Vocab entries the learner has saved for review.
create table if not exists public.saved_vocab (
  user_id uuid not null references auth.users (id) on delete cascade,
  vocab_id text not null check (char_length(vocab_id) between 1 and 160),
  lesson_id text not null check (char_length(lesson_id) between 1 and 120),
  saved_at timestamptz not null default now(),
  primary key (user_id, vocab_id)
);

drop trigger if exists lesson_progress_set_updated_at on public.lesson_progress;
create trigger lesson_progress_set_updated_at
  before update on public.lesson_progress
  for each row execute function public.set_updated_at();

drop trigger if exists exercise_results_set_updated_at on public.exercise_results;
create trigger exercise_results_set_updated_at
  before update on public.exercise_results
  for each row execute function public.set_updated_at();
