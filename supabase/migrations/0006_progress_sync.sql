-- 0006_progress_sync.sql
-- Progress sync (docs/plans/progress.md, sections 3, 5 and 7). One transaction: if any check
-- fails, nothing is changed.
--   * writing_task_progress: C2 writing tasks, "done" and the ticked checklist items only. It has
--     NO text column, by design: the learner's text never leaves the browser (C2 privacy rule).
--   * exercise_results.last_attempt_at: the client time of the latest counted attempt. It makes a
--     resent entry a no-op and stops an older answer from overwriting a newer one.
--   * drops exercise_results_user_lesson_idx (nothing reads one lesson's results; reads by user use
--     the primary key) and lesson_scores (run history; the plan keeps no history). lesson_scores is
--     dropped only if it is empty: otherwise the migration stops with an error.
--   * the signed-in user can no longer insert or update progress rows directly. Every write goes
--     through public.apply_progress(jsonb), which checks ids, values, times and per-user caps.
--     select and delete stay granted (reads, and "reset my progress").
-- Run after 0001 to 0005. Safe to run more than once.

begin;

-- ---------- 0. Preconditions ----------
do $$
begin
  if pg_catalog.to_regclass('public.lesson_progress') is null
     or pg_catalog.to_regclass('public.exercise_results') is null
     or pg_catalog.to_regprocedure('public.set_updated_at()') is null then
    raise exception '0006: run migrations 0001 to 0003 first (lesson_progress, exercise_results or set_updated_at() is missing). Nothing was changed.';
  end if;

  -- Nested so the inner query is only parsed when the table exists (a re-run after the drop).
  if pg_catalog.to_regclass('public.lesson_scores') is not null then
    if exists (select 1 from public.lesson_scores) then
      raise exception '0006: public.lesson_scores is not empty (% rows). Export it and decide what to keep before dropping it. Nothing was changed.',
        (select pg_catalog.count(*) from public.lesson_scores);
    end if;
  end if;
end;
$$;

-- ---------- 1. Drop lesson_scores (empty, checked above) ----------
-- Its policies, index and identity sequence go with it.
drop table if exists public.lesson_scores;

-- ---------- 2. exercise_results ----------
alter table public.exercise_results add column if not exists last_attempt_at timestamptz;
-- Rows written before this migration (none are expected) take their last update time.
update public.exercise_results set last_attempt_at = updated_at where last_attempt_at is null;
alter table public.exercise_results alter column last_attempt_at set default pg_catalog.now();
alter table public.exercise_results alter column last_attempt_at set not null;

drop index if exists public.exercise_results_user_lesson_idx;

-- ---------- 3. writing_task_progress ----------
create table if not exists public.writing_task_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id text not null check (char_length(exercise_id) between 1 and 160),
  lesson_id text not null check (char_length(lesson_id) between 1 and 120),
  -- A row exists only once the task is marked done; the learner can't un-mark it (writing-task.tsx).
  done boolean not null default true check (done),
  checked smallint[] not null default '{}'
    check (pg_catalog.cardinality(checked) <= 10 and checked <@ '{0,1,2,3,4,5,6,7,8,9}'::smallint[]),
  done_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

comment on table public.writing_task_progress is
  'C2 writing tasks: done and the ticked checklist indices only. No text column, by design: the learner''s text stays in the browser.';

drop trigger if exists writing_task_progress_set_updated_at on public.writing_task_progress;
create trigger writing_task_progress_set_updated_at
  before update on public.writing_task_progress
  for each row execute function public.set_updated_at();

alter table public.writing_task_progress enable row level security;
alter table public.writing_task_progress force row level security;

-- Read and delete own rows. No insert or update policy and no such grants: writes go only
-- through apply_progress(), and RLS denies anything else by default.
drop policy if exists "writing_task_progress: read own" on public.writing_task_progress;
create policy "writing_task_progress: read own" on public.writing_task_progress
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "writing_task_progress: delete own" on public.writing_task_progress;
create policy "writing_task_progress: delete own" on public.writing_task_progress
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- 4. Privileges on the progress tables ----------
revoke all on table public.writing_task_progress from public, anon, authenticated;
grant select, delete on table public.writing_task_progress to authenticated;

revoke insert, update on table public.lesson_progress, public.exercise_results from public, anon, authenticated;
-- select and delete on lesson_progress and exercise_results stay as granted in 0003.

-- ---------- 5. apply_progress(p_items jsonb) ----------
-- Applies up to 200 progress entries for the caller, in order, and returns
--   {"applied": ["key", ...], "rejected": [{"key": "...", "code": "..."}, ...]}.
-- "applied" includes no-ops (a resent or older entry): the client removes those from its outbox.
-- "rejected" entries can never succeed and are not retried.
--
-- Entry shapes (times are ISO 8601 with a time zone, as sent; never clamped):
--   {"key", "kind": "attempt",         "lessonId", "exerciseId", "result", "attemptedAt", "addAttempts", "addCorrect"}
--   {"key", "kind": "import-exercise", "lessonId", "exerciseId", "lastResult", "lastAttemptedAt", "attempts", "correct"}
--   {"key", "kind": "run",             "lessonId", "score", "total", "runAt"}
--   {"key", "kind": "import-lesson",   "lessonId", "bestScore", "bestTotal", "lastRunAt", "completedAt" (optional)}
--   {"key", "kind": "writing",         "lessonId", "exerciseId", "checked", "doneAt"}
--
-- security definer: the caller has no insert or update grant. The function runs as its owner,
-- which bypasses RLS, so the user id comes only from auth.uid() (never from the input) and every
-- statement filters on it explicitly. search_path is empty and every name is schema-qualified.
create or replace function public.apply_progress(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_items constant int := 200;
  c_cap_exercises constant int := 6000;
  c_cap_lessons constant int := 600;
  c_cap_writing constant int := 200;
  c_max_ahead constant interval := interval '24 hours';
  c_lesson_re constant text := '^[a-z0-9]+(-[a-z0-9]+)*$';
  c_time_re constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';

  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_applied jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  -- Rows the caller already has, counted once per call when first needed.
  v_n_exercises int;
  v_n_lessons int;
  v_n_writing int;

  v_item jsonb;
  v_ord bigint;
  v_key text;
  v_kind text;
  v_code text;
  v_time_text text;
  v_time timestamptz;
  v_lesson text;
  v_exercise text;
  v_result text;
  v_attempts int;
  v_correct int;
  v_score int;
  v_total int;
  v_completed timestamptz;
  v_checked smallint[];
  v_is_new boolean;
begin
  if v_uid is null then
    raise exception 'apply_progress: not signed in' using errcode = '42501';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'apply_progress: p_items must be a JSON array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_items) > c_max_items then
    raise exception 'apply_progress: at most % entries per call', c_max_items using errcode = '22023';
  end if;

  for v_item, v_ord in
    select e.value, e.ordinality
      from pg_catalog.jsonb_array_elements(p_items) with ordinality as e (value, ordinality)
     order by e.ordinality
  loop
    v_key := coalesce(pg_catalog.left(v_item ->> 'key', 200), v_ord::text);
    v_code := null;
    v_time := null;
    v_lesson := null;
    v_exercise := null;
    v_completed := null;
    v_is_new := false;

    begin
      v_kind := v_item ->> 'kind';

      -- Shape and kind.
      if pg_catalog.jsonb_typeof(v_item) is distinct from 'object' then
        v_code := 'bad_item';
      elsif v_kind is null or v_kind not in ('attempt', 'import-exercise', 'run', 'import-lesson', 'writing') then
        v_code := 'bad_kind';
      end if;

      -- The entry's time: ISO format, stored as sent, rejected if more than 24 hours ahead.
      if v_code is null then
        v_time_text := case v_kind
          when 'attempt' then v_item ->> 'attemptedAt'
          when 'import-exercise' then v_item ->> 'lastAttemptedAt'
          when 'run' then v_item ->> 'runAt'
          when 'import-lesson' then v_item ->> 'lastRunAt'
          when 'writing' then v_item ->> 'doneAt'
        end;
        if v_time_text is null or v_time_text !~ c_time_re then
          v_code := 'bad_time';
        else
          v_time := v_time_text::timestamptz;
          if v_time > v_now + c_max_ahead then
            v_code := 'future_time';
          end if;
        end if;
      end if;

      -- Lesson id.
      if v_code is null then
        v_lesson := v_item ->> 'lessonId';
        if v_lesson is null or pg_catalog.char_length(v_lesson) not between 1 and 120 or v_lesson !~ c_lesson_re then
          v_code := 'bad_id';
        end if;
      end if;

      -- Exercise id: exactly <lesson-id>-ex<digits>.
      if v_code is null and v_kind in ('attempt', 'import-exercise', 'writing') then
        v_exercise := v_item ->> 'exerciseId';
        if v_exercise is null
           or pg_catalog.char_length(v_exercise) > 160
           or pg_catalog.left(v_exercise, pg_catalog.char_length(v_lesson) + 3) <> v_lesson || '-ex'
           or pg_catalog.substr(v_exercise, pg_catalog.char_length(v_lesson) + 4) !~ '^[0-9]{1,6}$' then
          v_code := 'bad_id';
        end if;
      end if;

      -- ===== attempt and import-exercise =====
      if v_code is null and v_kind in ('attempt', 'import-exercise') then
        if v_kind = 'attempt' then
          v_result := v_item ->> 'result';
          v_attempts := (v_item ->> 'addAttempts')::int;
          v_correct := (v_item ->> 'addCorrect')::int;
          if v_attempts is null or v_attempts not between 1 and 1000 then
            v_code := 'bad_count';
          end if;
        else
          v_result := v_item ->> 'lastResult';
          v_attempts := (v_item ->> 'attempts')::int;
          v_correct := (v_item ->> 'correct')::int;
          if v_attempts is null or v_attempts not between 1 and 100000 then
            v_code := 'bad_count';
          end if;
        end if;

        if v_code is null and (v_result is null or v_result not in ('correct', 'correct-accents', 'incorrect')) then
          v_code := 'bad_result';
        end if;
        -- The counts must agree with the last result: an accepted last answer counts as correct.
        if v_code is null and (
             v_correct is null or v_correct not between 0 and v_attempts
             or (v_result <> 'incorrect' and v_correct < 1)
             or (v_result = 'incorrect' and v_correct > v_attempts - 1)) then
          v_code := 'bad_count';
        end if;

        if v_code is null then
          perform 1 from public.exercise_results as er
            where er.user_id = v_uid and er.exercise_id = v_exercise
            for update;
          v_is_new := not found;
          if v_is_new then
            if v_n_exercises is null then
              select pg_catalog.count(*) into v_n_exercises from public.exercise_results as er where er.user_id = v_uid;
            end if;
            if v_n_exercises >= c_cap_exercises then
              v_code := 'cap_reached';
            end if;
          end if;
        end if;

        if v_code is null and v_kind = 'attempt' then
          -- Counted once: a resent entry has the same time and an older one an earlier time, so
          -- neither passes the WHERE clause.
          insert into public.exercise_results as er
            (user_id, lesson_id, exercise_id, correct, attempts, correct_count, last_result, last_attempt_at)
          values
            (v_uid, v_lesson, v_exercise, v_result <> 'incorrect', v_attempts, v_correct, v_result, v_time)
          on conflict (user_id, exercise_id) do update set
            attempts = er.attempts + excluded.attempts,
            correct_count = er.correct_count + excluded.correct_count,
            correct = excluded.correct,
            last_result = excluded.last_result,
            last_attempt_at = excluded.last_attempt_at
          where er.user_id = v_uid
            and excluded.last_attempt_at > er.last_attempt_at;
        elsif v_code is null then
          -- Import: the larger counts, and the newer side's result. Idempotent.
          insert into public.exercise_results as er
            (user_id, lesson_id, exercise_id, correct, attempts, correct_count, last_result, last_attempt_at)
          values
            (v_uid, v_lesson, v_exercise, v_result <> 'incorrect', v_attempts, v_correct, v_result, v_time)
          on conflict (user_id, exercise_id) do update set
            attempts = greatest(er.attempts, excluded.attempts),
            correct_count = greatest(er.correct_count, excluded.correct_count),
            correct = case when excluded.last_attempt_at > er.last_attempt_at then excluded.correct else er.correct end,
            last_result = case when excluded.last_attempt_at > er.last_attempt_at then excluded.last_result else er.last_result end,
            last_attempt_at = greatest(er.last_attempt_at, excluded.last_attempt_at)
          where er.user_id = v_uid
            and (excluded.attempts > er.attempts
                 or excluded.correct_count > er.correct_count
                 or excluded.last_attempt_at > er.last_attempt_at);
        end if;

        if v_code is null and v_is_new then
          v_n_exercises := v_n_exercises + 1;
        end if;
      end if;

      -- ===== run and import-lesson =====
      if v_code is null and v_kind in ('run', 'import-lesson') then
        if v_kind = 'run' then
          v_score := (v_item ->> 'score')::int;
          v_total := (v_item ->> 'total')::int;
        else
          v_score := (v_item ->> 'bestScore')::int;
          v_total := (v_item ->> 'bestTotal')::int;
        end if;
        if v_total is null or v_score is null or v_total not between 1 and 1000 or v_score not between 0 and v_total then
          v_code := 'bad_score';
        end if;

        -- Completed means score / total >= 0.8 (isCompleted in lib/progress.ts), in integers.
        if v_code is null and v_score * 5 >= v_total * 4 then
          v_completed := v_time;
          if v_kind = 'import-lesson' and v_item ->> 'completedAt' is not null then
            if v_item ->> 'completedAt' !~ c_time_re then
              v_code := 'bad_time';
            else
              v_completed := (v_item ->> 'completedAt')::timestamptz;
              if v_completed > v_now + c_max_ahead then
                v_code := 'future_time';
              end if;
            end if;
          end if;
        end if;

        if v_code is null then
          perform 1 from public.lesson_progress as lp
            where lp.user_id = v_uid and lp.lesson_id = v_lesson
            for update;
          v_is_new := not found;
          if v_is_new then
            if v_n_lessons is null then
              select pg_catalog.count(*) into v_n_lessons from public.lesson_progress as lp where lp.user_id = v_uid;
            end if;
            if v_n_lessons >= c_cap_lessons then
              v_code := 'cap_reached';
            end if;
          end if;
        end if;

        if v_code is null then
          -- Best by ratio (cross-multiplied; a tie keeps the stored row), the later run, the
          -- earlier completion. Idempotent.
          insert into public.lesson_progress as lp
            (user_id, lesson_id, status, best_score, best_total, last_run_at, completed_at)
          values
            (v_uid, v_lesson, case when v_completed is null then 'in_progress' else 'completed' end,
             v_score, v_total, v_time, v_completed)
          on conflict (user_id, lesson_id) do update set
            best_score = case when excluded.best_score::bigint * lp.best_total > lp.best_score::bigint * excluded.best_total
                              then excluded.best_score else lp.best_score end,
            best_total = case when excluded.best_score::bigint * lp.best_total > lp.best_score::bigint * excluded.best_total
                              then excluded.best_total else lp.best_total end,
            last_run_at = greatest(lp.last_run_at, excluded.last_run_at),
            completed_at = least(lp.completed_at, excluded.completed_at),
            status = case when coalesce(lp.completed_at, excluded.completed_at) is null then 'in_progress' else 'completed' end
          where lp.user_id = v_uid
            and (excluded.best_score::bigint * lp.best_total > lp.best_score::bigint * excluded.best_total
                 or excluded.last_run_at > lp.last_run_at
                 or (excluded.completed_at is not null
                     and (lp.completed_at is null or excluded.completed_at < lp.completed_at)));

          if v_is_new then
            v_n_lessons := v_n_lessons + 1;
          end if;
        end if;
      end if;

      -- ===== writing =====
      if v_code is null and v_kind = 'writing' then
        if pg_catalog.jsonb_typeof(v_item -> 'checked') is distinct from 'array'
           or pg_catalog.jsonb_array_length(v_item -> 'checked') > 10 then
          v_code := 'bad_checked';
        else
          select coalesce(pg_catalog.array_agg(distinct x.v order by x.v), '{}'::smallint[])
            into v_checked
            from (select t.value::smallint as v
                    from pg_catalog.jsonb_array_elements_text(v_item -> 'checked') as t (value)) as x;
          if exists (select 1 from pg_catalog.unnest(v_checked) as u (v) where u.v < 0 or u.v > 9) then
            v_code := 'bad_checked';
          end if;
        end if;

        if v_code is null then
          perform 1 from public.writing_task_progress as w
            where w.user_id = v_uid and w.exercise_id = v_exercise
            for update;
          v_is_new := not found;
          if v_is_new then
            if v_n_writing is null then
              select pg_catalog.count(*) into v_n_writing from public.writing_task_progress as w where w.user_id = v_uid;
            end if;
            if v_n_writing >= c_cap_writing then
              v_code := 'cap_reached';
            end if;
          end if;
        end if;

        if v_code is null then
          -- The later "done" wins whole, with its ticks; an equal time is a no-op.
          insert into public.writing_task_progress as w
            (user_id, exercise_id, lesson_id, done, checked, done_at)
          values
            (v_uid, v_exercise, v_lesson, true, v_checked, v_time)
          on conflict (user_id, exercise_id) do update set
            checked = excluded.checked,
            done_at = excluded.done_at,
            done = true
          where w.user_id = v_uid
            and excluded.done_at > w.done_at;

          if v_is_new then
            v_n_writing := v_n_writing + 1;
          end if;
        end if;
      end if;

    exception
      -- A value that can't be parsed (a number or date out of range, a non-integer) or that
      -- breaks a table check: reject this entry only. Its changes are rolled back.
      when data_exception or integrity_constraint_violation then
        v_code := 'invalid';
    end;

    if v_code is null then
      v_applied := v_applied || pg_catalog.to_jsonb(v_key);
    else
      v_rejected := v_rejected || pg_catalog.jsonb_build_object('key', v_key, 'code', v_code);
    end if;
  end loop;

  return pg_catalog.jsonb_build_object('applied', v_applied, 'rejected', v_rejected);
end;
$$;

comment on function public.apply_progress(jsonb) is
  'The only write path for lesson_progress, exercise_results and writing_task_progress. See docs/plans/progress.md section 7.';

-- ---------- 6. Who may call it ----------
-- Postgres grants execute on new functions to PUBLIC, and Supabase's default privileges grant it
-- to anon, authenticated and service_role. Remove all of them, then allow authenticated only.
-- (A service-role call would fail anyway: it has no auth.uid().)
revoke all on function public.apply_progress(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.apply_progress(jsonb) to authenticated;

commit;
