-- supabase/tests/rls.sql
-- Proves the RLS rules (0003, 0005) and the progress write path (0006) on every table and every
-- operation. Run it in the Supabase SQL editor (or psql) AFTER migrations 0001 to 0006. It runs in
-- one transaction that ends in ROLLBACK, so it leaves nothing behind: no users, no rows, no test
-- schema.
--
-- Output: one "PASS: ..." notice per expected outcome. Any unexpected outcome stops the script
-- with "FAIL: ...". If it reaches the end you'll see "PASS: ALL RLS CHECKS PASSED".
--
-- User A = 11111111-1111-4111-8111-111111111111, user B = 22222222-2222-4222-8222-222222222222,
-- user C = 33333333-3333-4333-8333-333333333333 (caps and import, no purchase).

begin;

-- ===================================================================== helpers (rolled back)
create schema rls_test;

-- Runs stmt and expects it to fail with SQLSTATE state (42501 = permission denied or an RLS
-- WITH CHECK violation; 23514 = check constraint).
create function rls_test.expect_error(label text, stmt text, state text default '42501')
returns void language plpgsql security invoker as $$
declare
  allowed boolean := false;
begin
  begin
    execute stmt;
    allowed := true;
  exception when others then
    if sqlstate <> state then
      raise exception 'FAIL: % raised "%" (%), expected %', label, sqlerrm, sqlstate, state;
    end if;
    raise notice 'PASS: % -> refused (%)', label, sqlstate;
  end;
  if allowed then
    raise exception 'FAIL: % was allowed', label;
  end if;
end;
$$;

-- Runs a SELECT and expects exactly n rows.
create function rls_test.expect_rows(label text, stmt text, n int)
returns void language plpgsql security invoker as $$
declare
  got int;
begin
  execute format('select count(*) from (%s) as q', stmt) into got;
  if got <> n then
    raise exception 'FAIL: % returned % rows, expected %', label, got, n;
  end if;
  raise notice 'PASS: % -> % rows', label, got;
end;
$$;

-- Runs an INSERT, UPDATE or DELETE and expects it to touch exactly n rows.
create function rls_test.expect_affected(label text, stmt text, n int)
returns void language plpgsql security invoker as $$
declare
  got int;
begin
  execute stmt;
  get diagnostics got = row_count;
  if got <> n then
    raise exception 'FAIL: % affected % rows, expected %', label, got, n;
  end if;
  raise notice 'PASS: % -> % rows affected', label, got;
end;
$$;

-- Anon: a SELECT must return no rows or be refused.
create function rls_test.expect_nothing(label text, stmt text)
returns void language plpgsql security invoker as $$
declare
  got int;
begin
  begin
    execute format('select count(*) from (%s) as q', stmt) into got;
  exception when insufficient_privilege then
    raise notice 'PASS: % -> refused (42501)', label;
    return;
  end;
  if got <> 0 then
    raise exception 'FAIL: % returned % rows', label, got;
  end if;
  raise notice 'PASS: % -> 0 rows', label;
end;
$$;

-- Calls apply_progress(items) as the current user and expects n_applied applied entries and
-- exactly these rejection codes, in order.
create function rls_test.expect_apply(label text, items jsonb, n_applied int, codes text[] default '{}')
returns void language plpgsql security invoker as $$
declare
  res jsonb := public.apply_progress(items);
  got_codes text[];
begin
  select coalesce(array_agg(t.r ->> 'code' order by t.o), '{}')
    into got_codes
    from jsonb_array_elements(res -> 'rejected') with ordinality as t (r, o);
  if jsonb_array_length(res -> 'applied') <> n_applied or got_codes <> codes then
    raise exception 'FAIL: % returned %, expected % applied and rejected %', label, res, n_applied, codes;
  end if;
  raise notice 'PASS: % -> % applied, rejected %', label, n_applied, codes;
end;
$$;

-- An ISO time relative to the transaction's now(), as the client sends it.
create function rls_test.ts(offset_by interval) returns text language sql stable as $$
  select to_char((now() + offset_by) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

-- Entry builders (the shapes apply_progress documents).
create function rls_test.attempt(k text, lesson text, ex text, result text, at interval, n int default 1, c int default null)
returns jsonb language sql stable as $$
  select jsonb_build_object('key', k, 'kind', 'attempt', 'lessonId', lesson, 'exerciseId', ex, 'result', result,
    'attemptedAt', rls_test.ts(at), 'addAttempts', n,
    'addCorrect', coalesce(c, case when result = 'incorrect' then 0 else 1 end));
$$;

create function rls_test.run(k text, lesson text, score int, total int, at interval)
returns jsonb language sql stable as $$
  select jsonb_build_object('key', k, 'kind', 'run', 'lessonId', lesson, 'score', score, 'total', total, 'runAt', rls_test.ts(at));
$$;

create function rls_test.writing(k text, lesson text, ex text, checked int[], at interval)
returns jsonb language sql stable as $$
  select jsonb_build_object('key', k, 'kind', 'writing', 'lessonId', lesson, 'exerciseId', ex,
    'checked', to_jsonb(checked), 'doneAt', rls_test.ts(at));
$$;

create function rls_test.me() returns uuid language plpgsql security invoker as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'FAIL: no auth.uid() for this step'; end if;
  return uid;
end;
$$;

create function rls_test.other() returns uuid language sql security invoker as $$
  select case when rls_test.me() = '11111111-1111-4111-8111-111111111111'::uuid
              then '22222222-2222-4222-8222-222222222222'::uuid
              else '11111111-1111-4111-8111-111111111111'::uuid end;
$$;

-- As the signed-in user: write, read and check their own rows in every table, and what they may
-- not do to their own rows. Leaves 1 lesson_progress, 2 exercise_results, 1 writing_task_progress
-- and 1 saved_vocab row.
create function rls_test.own_rows() returns void language plpgsql security invoker as $$
declare
  me text := rls_test.me()::text;
  other text := rls_test.other()::text;
  who text := case when me like '1%' then 'user A' else 'user B' end;
  l text := 'rls-test-lesson';
begin
  -- profiles (created by the sign-up trigger)
  perform rls_test.expect_rows(who || ' reads own profile', format('select 1 from public.profiles where id = %L', me), 1);
  perform rls_test.expect_rows(who || ' sees only own profile (unfiltered select)', 'select 1 from public.profiles', 1);
  perform rls_test.expect_affected(who || ' updates own display_name', format('update public.profiles set display_name = %L where id = %L', 'Renamed ' || right(who, 1), me), 1);
  perform rls_test.expect_rows(who || ' sees the new display_name', format('select 1 from public.profiles where id = %L and display_name = %L', me, 'Renamed ' || right(who, 1)), 1);
  perform rls_test.expect_error(who || ' changes own profile id', format('update public.profiles set id = %L where id = %L', other, me));
  perform rls_test.expect_error(who || ' changes own created_at', format('update public.profiles set created_at = now() where id = %L', me));
  perform rls_test.expect_error(who || ' inserts a profile', format('insert into public.profiles (id) values (%L)', me));
  perform rls_test.expect_error(who || ' deletes own profile', format('delete from public.profiles where id = %L', me));
  perform rls_test.expect_rows(who || ' last_active_at empty before touch', format('select 1 from public.profiles where id = %L and last_active_at is null', me), 1);
  perform public.touch_last_active();
  perform rls_test.expect_rows(who || ' touch_last_active() stamps own profile', format('select 1 from public.profiles where id = %L and last_active_at is not null', me), 1);

  -- Direct writes to the progress tables are refused: writes go only through apply_progress().
  perform rls_test.expect_error(who || ' inserts lesson_progress directly', format('insert into public.lesson_progress (user_id, lesson_id, best_score, best_total) values (%L, %L, 3, 5)', me, l));
  perform rls_test.expect_error(who || ' inserts exercise_results directly', format('insert into public.exercise_results (user_id, lesson_id, exercise_id, correct, attempts, correct_count, last_result) values (%L, %L, %L, false, 1, 0, %L)', me, l, l || '-ex001', 'incorrect'));
  perform rls_test.expect_error(who || ' inserts writing_task_progress directly', format('insert into public.writing_task_progress (user_id, exercise_id, lesson_id, done_at) values (%L, %L, %L, now())', me, l || '-ex016', l));

  -- Entries that can never succeed are rejected, and write nothing.
  perform rls_test.expect_apply(who || ' bad entries', jsonb_build_array(
      rls_test.run('x1', l, 6, 5, '-1 hour'),
      rls_test.run('x2', l, 0, 0, '-1 hour'),
      rls_test.run('x3', l, 1, 1001, '-1 hour'),
      rls_test.run('x4', 'Bad Lesson', 1, 5, '-1 hour'),
      rls_test.attempt('x5', l, l || '-ex001', 'great', '-1 hour'),
      rls_test.attempt('x6', l, 'other-lesson-ex001', 'correct', '-1 hour'),
      rls_test.attempt('x7', l, l || '-ex001', 'correct', '25 hours'),
      jsonb_build_object('key', 'x8', 'kind', 'attempt', 'lessonId', l, 'exerciseId', l || '-ex001', 'result', 'correct',
                         'attemptedAt', 'not-a-date', 'addAttempts', 1, 'addCorrect', 1),
      jsonb_build_object('key', 'x9', 'kind', 'delete-everything'),
      rls_test.writing('x10', l, l || '-ex016', array[10], '-1 hour'),
      rls_test.attempt('x11', l, l || '-ex001', 'correct', '-1 hour', 1, 2)
    ), 0,
    array['bad_score', 'bad_score', 'bad_score', 'bad_id', 'bad_result', 'bad_id', 'future_time', 'bad_time', 'bad_kind', 'bad_checked', 'bad_count']);
  perform rls_test.expect_rows(who || ' rejected entries wrote nothing', format(
    'select 1 from public.exercise_results where user_id = %1$L union all select 1 from public.lesson_progress where user_id = %1$L union all select 1 from public.writing_task_progress where user_id = %1$L', me), 0);

  -- lesson_progress: best by ratio, latest run, earliest completion; resending changes nothing.
  perform rls_test.expect_apply(who || ' run 3/5', jsonb_build_array(rls_test.run('r1', l, 3, 5, '-1 hour')), 1);
  perform rls_test.expect_rows(who || ' reads own lesson_progress 3/5 in progress', format('select 1 from public.lesson_progress where user_id = %L and best_score = 3 and best_total = 5 and status = %L and completed_at is null', me, 'in_progress'), 1);
  perform rls_test.expect_apply(who || ' resends run 3/5', jsonb_build_array(rls_test.run('r1', l, 3, 5, '-1 hour')), 1);
  perform rls_test.expect_apply(who || ' run 4/5, newer', jsonb_build_array(rls_test.run('r2', l, 4, 5, '-30 minutes')), 1);
  perform rls_test.expect_rows(who || ' 4/5 completes the lesson', format('select 1 from public.lesson_progress where user_id = %L and best_score = 4 and status = %L and completed_at = now() - interval %L and last_run_at = now() - interval %L', me, 'completed', '30 minutes', '30 minutes'), 1);
  perform rls_test.expect_apply(who || ' older run 5/5 arrives late', jsonb_build_array(rls_test.run('r3', l, 5, 5, '-2 hours')), 1);
  perform rls_test.expect_rows(who || ' keeps 5/5, the earliest completion and the latest run', format('select 1 from public.lesson_progress where user_id = %L and best_score = 5 and best_total = 5 and completed_at = now() - interval %L and last_run_at = now() - interval %L', me, '2 hours', '30 minutes'), 1);
  perform rls_test.expect_apply(who || ' import of a worse lesson result', jsonb_build_array(jsonb_build_object(
      'key', 'i1', 'kind', 'import-lesson', 'lessonId', l, 'bestScore', 2, 'bestTotal', 5, 'lastRunAt', rls_test.ts('-3 hours'))), 1);
  perform rls_test.expect_rows(who || ' import of a worse result changes nothing', format('select 1 from public.lesson_progress where user_id = %L and best_score = 5 and completed_at = now() - interval %L and last_run_at = now() - interval %L', me, '2 hours', '30 minutes'), 1);
  perform rls_test.expect_error(who || ' updates own lesson_progress directly', format('update public.lesson_progress set best_score = 0 where user_id = %L', me));

  -- exercise_results: a resent attempt and an older attempt are not counted.
  perform rls_test.expect_apply(who || ' attempt, incorrect', jsonb_build_array(rls_test.attempt('a1', l, l || '-ex001', 'incorrect', '-1 hour')), 1);
  perform rls_test.expect_rows(who || ' reads own exercise_results', format('select 1 from public.exercise_results where user_id = %L and attempts = 1 and correct_count = 0 and last_result = %L and not correct', me, 'incorrect'), 1);
  perform rls_test.expect_apply(who || ' resends the same attempt', jsonb_build_array(rls_test.attempt('a1', l, l || '-ex001', 'incorrect', '-1 hour')), 1);
  perform rls_test.expect_rows(who || ' resent attempt not counted', format('select 1 from public.exercise_results where user_id = %L and attempts = 1', me), 1);
  perform rls_test.expect_apply(who || ' older attempt arrives late', jsonb_build_array(rls_test.attempt('a0', l, l || '-ex001', 'correct', '-2 hours')), 1);
  perform rls_test.expect_rows(who || ' older attempt ignored', format('select 1 from public.exercise_results where user_id = %L and attempts = 1 and last_result = %L', me, 'incorrect'), 1);
  perform rls_test.expect_apply(who || ' newer attempt', jsonb_build_array(rls_test.attempt('a2', l, l || '-ex001', 'correct', '-30 minutes')), 1);
  perform rls_test.expect_rows(who || ' newer attempt counted', format('select 1 from public.exercise_results where user_id = %L and attempts = 2 and correct_count = 1 and last_result = %L and correct and last_attempt_at = now() - interval %L', me, 'correct', '30 minutes'), 1);
  perform rls_test.expect_apply(who || ' attempt 23 hours ahead', jsonb_build_array(rls_test.attempt('a3', l, l || '-ex002', 'correct-accents', '23 hours')), 1);
  perform rls_test.expect_rows(who || ' time stored as sent, not clamped', format('select 1 from public.exercise_results where user_id = %L and exercise_id = %L and last_attempt_at = now() + interval %L', me, l || '-ex002', '23 hours'), 1);
  perform rls_test.expect_error(who || ' updates own exercise_results directly', format('update public.exercise_results set attempts = 9 where user_id = %L', me));

  -- writing_task_progress: the later "done" wins whole; ticks are deduplicated and sorted.
  perform rls_test.expect_apply(who || ' marks a writing task done', jsonb_build_array(rls_test.writing('w1', l, l || '-ex016', array[2, 0, 2], '-1 hour')), 1);
  perform rls_test.expect_rows(who || ' reads own writing_task_progress', format('select 1 from public.writing_task_progress where user_id = %L and done and checked = %L::smallint[]', me, '{0,2}'), 1);
  perform rls_test.expect_apply(who || ' resends and sends an older writing record', jsonb_build_array(
      rls_test.writing('w1', l, l || '-ex016', array[2, 0, 2], '-1 hour'),
      rls_test.writing('w0', l, l || '-ex016', array[1], '-2 hours')), 2);
  perform rls_test.expect_rows(who || ' writing record unchanged', format('select 1 from public.writing_task_progress where user_id = %L and checked = %L::smallint[]', me, '{0,2}'), 1);
  perform rls_test.expect_apply(who || ' changes the ticks and marks done again', jsonb_build_array(rls_test.writing('w2', l, l || '-ex016', array[3, 1], '-30 minutes')), 1);
  perform rls_test.expect_rows(who || ' newer writing record wins', format('select 1 from public.writing_task_progress where user_id = %L and checked = %L::smallint[] and done_at = now() - interval %L', me, '{1,3}', '30 minutes'), 1);
  perform rls_test.expect_rows(who || ' sees only own writing_task_progress (unfiltered select)', 'select 1 from public.writing_task_progress', 1);
  perform rls_test.expect_error(who || ' updates own writing_task_progress directly', format('update public.writing_task_progress set checked = %L where user_id = %L', '{}', me));

  -- saved_vocab (save or unsave, never edit)
  perform rls_test.expect_affected(who || ' inserts own saved_vocab', format('insert into public.saved_vocab (user_id, vocab_id, lesson_id) values (%L, %L, %L)', me, l || '-v001', l), 1);
  perform rls_test.expect_rows(who || ' reads own saved_vocab', format('select 1 from public.saved_vocab where user_id = %L', me), 1);
  perform rls_test.expect_error(who || ' updates own saved_vocab', format('update public.saved_vocab set saved_at = now() where user_id = %L', me));

  -- purchases (read own, no insert, update, or delete for authenticated)
  perform rls_test.expect_rows(who || ' reads own purchase', format('select 1 from public.purchases where user_id = %L', me), 1);
  perform rls_test.expect_rows(who || ' sees only own purchase (unfiltered select)', 'select 1 from public.purchases', 1);
  perform rls_test.expect_error(who || ' inserts own purchase', format('insert into public.purchases (user_id, product, status, provider, provider_order_id, amount) values (%L, %L, %L, %L, %L, 800)', me, 'lessons', 'active', 'dodo', 'ord_fake_' || me));
  perform rls_test.expect_error(who || ' updates own purchase', format('update public.purchases set status = %L where user_id = %L', 'refunded', me));
  perform rls_test.expect_error(who || ' deletes own purchase', format('delete from public.purchases where user_id = %L', me));

  -- pricing_settings (read active, no insert, update, or delete)
  perform rls_test.expect_rows(who || ' reads pricing_settings', 'select 1 from public.pricing_settings where product = ''lessons'' and founder_price_cents = 800 and standard_price_cents = 1200', 1);
  perform rls_test.expect_error(who || ' inserts pricing_settings', 'insert into public.pricing_settings (product, founder_price_cents, standard_price_cents, founder_cap) values (''pro'', 1500, 2000, 50)');
  perform rls_test.expect_error(who || ' updates pricing_settings', 'update public.pricing_settings set founder_price_cents = 100 where product = ''lessons''');
  perform rls_test.expect_error(who || ' deletes pricing_settings', 'delete from public.pricing_settings where product = ''lessons''');

  -- get_founder_spots_left() (100 founder_cap - 2 seeded purchases = 98)
  perform rls_test.expect_rows(who || ' calls get_founder_spots_left()', 'select 1 where public.get_founder_spots_left(''lessons'') = 98', 1);
end;
$$;

-- As the signed-in user: try to read, update, delete and insert the other user's rows, and try to
-- make apply_progress() write for the other user. Leaves one more lesson_progress row
-- ('rls-test-only-mine') for the caller.
create function rls_test.other_rows() returns void language plpgsql security invoker as $$
declare
  me text := rls_test.me()::text;
  other text := rls_test.other()::text;
  who text := case when me like '1%' then 'user A' else 'user B' end;
  t text;
begin
  -- profiles
  perform rls_test.expect_rows(who || ' reads other profile', format('select 1 from public.profiles where id = %L', other), 0);
  perform rls_test.expect_affected(who || ' updates other profile', format('update public.profiles set display_name = %L where id = %L', 'hacked', other), 0);
  perform rls_test.expect_error(who || ' deletes other profile', format('delete from public.profiles where id = %L', other));
  perform rls_test.expect_error(who || ' inserts a profile for the other id', format('insert into public.profiles (id) values (%L)', other));

  -- the progress tables: read 0 rows, update refused (no grant), delete 0 rows
  foreach t in array array['lesson_progress', 'exercise_results', 'writing_task_progress', 'saved_vocab'] loop
    perform rls_test.expect_rows(who || ' reads other ' || t, format('select 1 from public.%I where user_id = %L', t, other), 0);
    perform rls_test.expect_rows(who || ' unfiltered ' || t || ' shows own rows only', format('select 1 from public.%I where user_id <> %L', t, me), 0);
    perform rls_test.expect_error(who || ' updates other ' || t, format('update public.%I set lesson_id = %L where user_id = %L', t, 'hacked', other));
    perform rls_test.expect_affected(who || ' deletes other ' || t, format('delete from public.%I where user_id = %L', t, other), 0);
  end loop;
  perform rls_test.expect_error(who || ' inserts lesson_progress for the other id', format('insert into public.lesson_progress (user_id, lesson_id, best_score, best_total) values (%L, %L, 1, 5)', other, 'rls-test-other'));
  perform rls_test.expect_error(who || ' inserts exercise_results for the other id', format('insert into public.exercise_results (user_id, lesson_id, exercise_id, correct, attempts, correct_count, last_result) values (%L, %L, %L, true, 1, 1, %L)', other, 'rls-test-other', 'rls-test-other-ex001', 'correct'));
  perform rls_test.expect_error(who || ' inserts writing_task_progress for the other id', format('insert into public.writing_task_progress (user_id, exercise_id, lesson_id, done_at) values (%L, %L, %L, now())', other, 'rls-test-other-ex001', 'rls-test-other'));
  perform rls_test.expect_error(who || ' inserts saved_vocab for the other id', format('insert into public.saved_vocab (user_id, vocab_id, lesson_id) values (%L, %L, %L)', other, 'rls-test-other-v001', 'rls-test-other'));

  -- apply_progress() takes the user from auth.uid(): a user id in the entry is ignored.
  perform rls_test.expect_apply(who || ' sends an entry naming the other user', jsonb_build_array(
      rls_test.run('o1', 'rls-test-only-mine', 1, 5, '-1 hour') || jsonb_build_object('userId', other, 'user_id', other)), 1);
  perform rls_test.expect_rows(who || ' the entry was written for the caller', format('select 1 from public.lesson_progress where user_id = %L and lesson_id = %L', me, 'rls-test-only-mine'), 1);

  -- purchases
  perform rls_test.expect_rows(who || ' reads other purchases', format('select 1 from public.purchases where user_id = %L', other), 0);
  perform rls_test.expect_rows(who || ' unfiltered purchases shows own rows only', format('select 1 from public.purchases where user_id <> %L', me), 0);
  perform rls_test.expect_error(who || ' updates other purchases', format('update public.purchases set status = %L where user_id = %L', 'refunded', other));
  perform rls_test.expect_error(who || ' deletes other purchases', format('delete from public.purchases where user_id = %L', other));
  perform rls_test.expect_error(who || ' inserts purchases for the other id', format('insert into public.purchases (user_id, product, status, provider, provider_order_id, amount) values (%L, %L, %L, %L, %L, 800)', other, 'lessons', 'active', 'dodo', 'ord_hack_' || me));
end;
$$;

-- As the signed-in user: delete their own progress rows (the counts own_rows and other_rows left).
create function rls_test.delete_own() returns void language plpgsql security invoker as $$
declare
  me text := rls_test.me()::text;
  who text := case when me like '1%' then 'user A' else 'user B' end;
  tables text[] := array['lesson_progress', 'exercise_results', 'writing_task_progress', 'saved_vocab'];
  counts int[] := array[2, 2, 1, 1];
begin
  for i in 1 .. array_length(tables, 1) loop
    perform rls_test.expect_affected(who || ' deletes own ' || tables[i], format('delete from public.%I where user_id = %L', tables[i], me), counts[i]);
    perform rls_test.expect_rows(who || ' own ' || tables[i] || ' is empty after delete', format('select 1 from public.%I where user_id = %L', tables[i], me), 0);
  end loop;
end;
$$;

-- As user C, who has (seeded) reached every cap: new rows are refused, existing rows still
-- update; and the import merge rules.
create function rls_test.user_c() returns void language plpgsql security invoker as $$
declare
  me text := rls_test.me()::text;
begin
  perform rls_test.expect_apply('user C at the cap: a new exercise', jsonb_build_array(rls_test.attempt('c1', 'cap-lesson', 'cap-lesson-ex6001', 'correct', '-1 hour')), 0, array['cap_reached']);
  perform rls_test.expect_apply('user C at the cap: an existing exercise', jsonb_build_array(rls_test.attempt('c2', 'cap-lesson', 'cap-lesson-ex1', 'correct', '-1 hour')), 1);
  perform rls_test.expect_rows('user C existing exercise updated at the cap', format('select 1 from public.exercise_results where user_id = %L and exercise_id = %L and attempts = 2', me, 'cap-lesson-ex1'), 1);
  perform rls_test.expect_apply('user C at the cap: a new lesson', jsonb_build_array(rls_test.run('c3', 'cap-lesson-601', 1, 5, '-1 hour')), 0, array['cap_reached']);
  perform rls_test.expect_apply('user C at the cap: an existing lesson', jsonb_build_array(rls_test.run('c4', 'cap-lesson-1', 4, 5, '-1 hour')), 1);
  perform rls_test.expect_apply('user C at the cap: a new writing task', jsonb_build_array(rls_test.writing('c5', 'cap-lesson', 'cap-lesson-ex201', array[0], '-1 hour')), 0, array['cap_reached']);
  perform rls_test.expect_apply('user C at the cap: an existing writing task', jsonb_build_array(rls_test.writing('c6', 'cap-lesson', 'cap-lesson-ex1', array[0], '-1 hour')), 1);
  perform rls_test.expect_rows('user C row counts stay at the caps', format(
    'select 1 where (select count(*) from public.exercise_results where user_id = %1$L) = 6000 and (select count(*) from public.lesson_progress where user_id = %1$L) = 600 and (select count(*) from public.writing_task_progress where user_id = %1$L) = 200', me), 1);

  -- import-exercise: the larger counts, the newer side's result; twice gives the same row.
  for i in 1 .. 2 loop
    perform rls_test.expect_apply('user C imports an older exercise record (' || i || ')', jsonb_build_array(jsonb_build_object(
        'key', 'ie', 'kind', 'import-exercise', 'lessonId', 'cap-lesson', 'exerciseId', 'cap-lesson-ex2',
        'attempts', 5, 'correct', 3, 'lastResult', 'correct-accents', 'lastAttemptedAt', rls_test.ts('-2 days'))), 1);
    perform rls_test.expect_rows('user C import keeps max counts and the newer result (' || i || ')', format(
      'select 1 from public.exercise_results where user_id = %L and exercise_id = %L and attempts = 5 and correct_count = 3 and last_result = %L and last_attempt_at = now() - interval %L',
      me, 'cap-lesson-ex2', 'incorrect', '1 day'), 1);
  end loop;

  -- import-lesson: a better score with an earlier completion; twice gives the same row.
  for i in 1 .. 2 loop
    perform rls_test.expect_apply('user C imports an older, better lesson record (' || i || ')', jsonb_build_array(jsonb_build_object(
        'key', 'il', 'kind', 'import-lesson', 'lessonId', 'cap-lesson-2', 'bestScore', 4, 'bestTotal', 5,
        'lastRunAt', rls_test.ts('-3 days'), 'completedAt', rls_test.ts('-4 days'))), 1);
    perform rls_test.expect_rows('user C import keeps the best, the earliest completion, the latest run (' || i || ')', format(
      'select 1 from public.lesson_progress where user_id = %L and lesson_id = %L and best_score = 4 and status = %L and completed_at = now() - interval %L and last_run_at = now() - interval %L',
      me, 'cap-lesson-2', 'completed', '4 days', '1 day'), 1);
  end loop;
end;
$$;

-- As anon: nothing is readable or writable.
create function rls_test.anon_nothing() returns void language plpgsql security invoker as $$
declare
  t text;
begin
  foreach t in array array['profiles', 'lesson_progress', 'exercise_results', 'writing_task_progress', 'saved_vocab'] loop
    perform rls_test.expect_nothing('anon select ' || t, format('select 1 from public.%I', t));
    perform rls_test.expect_error('anon delete ' || t, format('delete from public.%I', t));
  end loop;
  perform rls_test.expect_error('anon update profiles', 'update public.profiles set display_name = null');
  perform rls_test.expect_error('anon update lesson_progress', 'update public.lesson_progress set best_score = 0');
  perform rls_test.expect_error('anon update exercise_results', 'update public.exercise_results set attempts = 0');
  perform rls_test.expect_error('anon update writing_task_progress', 'update public.writing_task_progress set checked = ''{}''');
  perform rls_test.expect_error('anon update saved_vocab', 'update public.saved_vocab set saved_at = now()');
  perform rls_test.expect_error('anon insert profiles', $q$insert into public.profiles (id) values ('11111111-1111-4111-8111-111111111111')$q$);
  perform rls_test.expect_error('anon insert lesson_progress', $q$insert into public.lesson_progress (user_id, lesson_id, best_score, best_total) values ('11111111-1111-4111-8111-111111111111', 'x', 1, 5)$q$);
  perform rls_test.expect_error('anon insert exercise_results', $q$insert into public.exercise_results (user_id, lesson_id, exercise_id, correct, attempts, correct_count, last_result) values ('11111111-1111-4111-8111-111111111111', 'x', 'x-ex001', true, 1, 1, 'correct')$q$);
  perform rls_test.expect_error('anon insert writing_task_progress', $q$insert into public.writing_task_progress (user_id, exercise_id, lesson_id, done_at) values ('11111111-1111-4111-8111-111111111111', 'x-ex001', 'x', now())$q$);
  perform rls_test.expect_error('anon insert saved_vocab', $q$insert into public.saved_vocab (user_id, vocab_id, lesson_id) values ('11111111-1111-4111-8111-111111111111', 'x-v001', 'x')$q$);
  perform rls_test.expect_error('anon calls touch_last_active()', 'select public.touch_last_active()');
  perform rls_test.expect_error('anon calls apply_progress()', $q$select public.apply_progress('[]'::jsonb)$q$);

  -- purchases: anon has no access
  perform rls_test.expect_nothing('anon select purchases', 'select 1 from public.purchases');
  perform rls_test.expect_error('anon insert purchases', $q$insert into public.purchases (user_id, product, status, provider, provider_order_id, amount) values ('11111111-1111-4111-8111-111111111111', 'lessons', 'active', 'dodo', 'ord_anon', 800)$q$);
  perform rls_test.expect_error('anon update purchases', 'update public.purchases set status = ''refunded''');
  perform rls_test.expect_error('anon delete purchases', 'delete from public.purchases');

  -- pricing_settings: anon can read active rows, cannot write
  perform rls_test.expect_rows('anon select pricing_settings', 'select 1 from public.pricing_settings where product = ''lessons'' and founder_price_cents = 800 and standard_price_cents = 1200', 1);
  perform rls_test.expect_error('anon insert pricing_settings', 'insert into public.pricing_settings (product, founder_price_cents, standard_price_cents, founder_cap) values (''pro'', 1500, 2000, 50)');
  perform rls_test.expect_error('anon update pricing_settings', 'update public.pricing_settings set founder_price_cents = 100 where product = ''lessons''');
  perform rls_test.expect_error('anon delete pricing_settings', 'delete from public.pricing_settings where product = ''lessons''');

  -- get_founder_spots_left(): anon can call and receives the calculated count (98)
  perform rls_test.expect_rows('anon calls get_founder_spots_left()', 'select 1 where public.get_founder_spots_left(''lessons'') = 98', 1);
end;
$$;

grant usage on schema rls_test to authenticated, anon;
grant execute on all functions in schema rls_test to authenticated, anon;

-- ===================================================================== setup (as postgres)
do $$
declare
  t text;
  rls boolean;
  forced boolean;
  cols text[];
  text_cols text[];
begin
  -- Every table has RLS enabled and forced.
  foreach t in array array['profiles', 'lesson_progress', 'exercise_results', 'writing_task_progress', 'saved_vocab', 'purchases', 'pricing_settings'] loop
    select c.relrowsecurity, c.relforcerowsecurity into rls, forced
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = t;
    if rls is not true or forced is not true then
      raise exception 'FAIL: public.% has RLS enabled=% forced=%', t, rls, forced;
    end if;
    raise notice 'PASS: public.% has RLS enabled and forced', t;
  end loop;

  -- No policy is open to anon or public, and none is "using (true)" on user-scoped tables.
  if exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename in ('profiles', 'lesson_progress', 'exercise_results', 'writing_task_progress', 'saved_vocab', 'purchases')
       and (roles <> '{authenticated}'::name[] or qual = 'true' or with_check = 'true')
  ) then
    raise exception 'FAIL: a policy is not limited to authenticated, or uses true';
  end if;
  raise notice 'PASS: every policy on user-scoped tables is "to authenticated" and none uses true';

  -- pricing_settings: readable by authenticated and anon, but must not use "true".
  if exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename = 'pricing_settings'
       and (qual = 'true' or with_check = 'true')
  ) then
    raise exception 'FAIL: pricing_settings policy uses true';
  end if;
  raise notice 'PASS: pricing_settings policy does not use true';

  -- The sign-up trigger writes under forced RLS, so its owner must bypass RLS (Supabase's
  -- postgres role does). If this fails, sign-ups would fail too.
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = 'public.handle_new_user()'::regprocedure and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'FAIL: the owner of public.handle_new_user() does not bypass RLS';
  end if;
  raise notice 'PASS: handle_new_user() owner bypasses RLS';

  -- 0006: lesson_scores and the (user_id, lesson_id) index are gone.
  if pg_catalog.to_regclass('public.lesson_scores') is not null then
    raise exception 'FAIL: public.lesson_scores still exists';
  end if;
  if pg_catalog.to_regclass('public.exercise_results_user_lesson_idx') is not null then
    raise exception 'FAIL: exercise_results_user_lesson_idx still exists';
  end if;
  raise notice 'PASS: lesson_scores and exercise_results_user_lesson_idx are dropped';

  -- 0006: writing_task_progress has exactly these columns, and no text column but the two ids.
  select array_agg(column_name::text order by column_name) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'writing_task_progress';
  if cols is distinct from array['checked', 'done', 'done_at', 'exercise_id', 'lesson_id', 'updated_at', 'user_id'] then
    raise exception 'FAIL: writing_task_progress columns are %', cols;
  end if;
  select array_agg(column_name::text order by column_name) into text_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'writing_task_progress'
     and data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'bytea', 'USER-DEFINED');
  if text_cols is distinct from array['exercise_id', 'lesson_id'] then
    raise exception 'FAIL: writing_task_progress has text-like columns %', text_cols;
  end if;
  raise notice 'PASS: writing_task_progress has no column that could hold the learner''s text';

  -- 0006: authenticated may only read and delete the progress tables.
  foreach t in array array['lesson_progress', 'exercise_results', 'writing_task_progress'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or not has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       or not has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception 'FAIL: authenticated has the wrong privileges on public.%', t;
    end if;
  end loop;
  raise notice 'PASS: authenticated can select and delete, not insert or update, the progress tables';

  -- 0006: apply_progress is security definer with an empty search_path, owned by a role that
  -- bypasses RLS, and executable by authenticated only (not PUBLIC, not anon).
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = 'public.apply_progress(jsonb)'::regprocedure
       and p.prosecdef
       and 'search_path=""' = any (p.proconfig)
       and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'FAIL: apply_progress() is not security definer with search_path '''' and an RLS-bypassing owner';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'public.apply_progress(jsonb)'::regprocedure and a.grantee = 0
  ) or (select p.proacl is null from pg_catalog.pg_proc p where p.oid = 'public.apply_progress(jsonb)'::regprocedure) then
    raise exception 'FAIL: PUBLIC can execute apply_progress()';
  end if;
  if has_function_privilege('anon', 'public.apply_progress(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.apply_progress(jsonb)', 'EXECUTE') then
    raise exception 'FAIL: apply_progress() execute is not authenticated-only';
  end if;
  raise notice 'PASS: apply_progress() is security definer, search_path empty, authenticated-only';
end;
$$;

insert into auth.users (id, email, aud, role, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', 'rls-test-a@example.invalid', 'authenticated', 'authenticated',
   '{"full_name": "Test User A", "avatar_url": "https://example.invalid/a.png"}'),
  ('22222222-2222-4222-8222-222222222222', 'rls-test-b@example.invalid', 'authenticated', 'authenticated',
   '{"full_name": "Test User B"}'),
  ('33333333-3333-4333-8333-333333333333', 'rls-test-c@example.invalid', 'authenticated', 'authenticated',
   '{"full_name": "Test User C"}');

do $$
begin
  if not exists (select 1 from public.profiles
                  where id = '11111111-1111-4111-8111-111111111111'
                    and display_name = 'Test User A' and avatar_url = 'https://example.invalid/a.png') then
    raise exception 'FAIL: the sign-up trigger did not create profile A from the metadata';
  end if;
  if not exists (select 1 from public.profiles
                  where id = '22222222-2222-4222-8222-222222222222'
                    and display_name = 'Test User B' and avatar_url is null) then
    raise exception 'FAIL: the sign-up trigger did not create profile B from the metadata';
  end if;
  raise notice 'PASS: the sign-up trigger created both profiles from raw_user_meta_data';
end;
$$;

-- Seed initial test purchases for user A and user B (simulating the webhook service role).
insert into public.purchases (user_id, product, status, provider, provider_order_id, amount, currency)
values
  ('11111111-1111-4111-8111-111111111111', 'lessons', 'active', 'dodo', 'ord_test_a_001', 800, 'usd'),
  ('22222222-2222-4222-8222-222222222222', 'lessons', 'active', 'dodo', 'ord_test_b_001', 800, 'usd');

-- Seed user C at every cap (as postgres, which bypasses RLS and grants).
insert into public.exercise_results (user_id, lesson_id, exercise_id, correct, attempts, correct_count, last_result, last_attempt_at)
select '33333333-3333-4333-8333-333333333333', 'cap-lesson', 'cap-lesson-ex' || g, false, 1, 0, 'incorrect', now() - interval '1 day'
  from generate_series(1, 6000) as g;
insert into public.lesson_progress (user_id, lesson_id, status, best_score, best_total, last_run_at, completed_at)
select '33333333-3333-4333-8333-333333333333', 'cap-lesson-' || g, 'in_progress', 1, 5, now() - interval '1 day', null
  from generate_series(1, 600) as g;
insert into public.writing_task_progress (user_id, exercise_id, lesson_id, done, checked, done_at)
select '33333333-3333-4333-8333-333333333333', 'cap-lesson-ex' || g, 'cap-lesson', true, '{}', now() - interval '1 day'
  from generate_series(1, 200) as g;

-- ===================================================================== user A: own rows
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select rls_test.own_rows();
reset role;

-- touch_last_active() by A left B untouched.
do $$
begin
  if exists (select 1 from public.profiles where id = '22222222-2222-4222-8222-222222222222' and last_active_at is not null) then
    raise exception 'FAIL: touch_last_active() by A changed B';
  end if;
  raise notice 'PASS: touch_last_active() by A did not touch B';
end;
$$;

-- ===================================================================== user B: own rows
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select rls_test.own_rows();
reset role;

-- ===================================================================== cross-user attempts
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select rls_test.other_rows();
reset role;

-- A's entry naming B was written only for A.
do $$
begin
  if (select count(*) from public.lesson_progress where lesson_id = 'rls-test-only-mine') <> 1
     or not exists (select 1 from public.lesson_progress
                     where lesson_id = 'rls-test-only-mine' and user_id = '11111111-1111-4111-8111-111111111111') then
    raise exception 'FAIL: apply_progress() by A wrote a row that is not A''s';
  end if;
  raise notice 'PASS: apply_progress() by A wrote only A''s row';
end;
$$;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select rls_test.other_rows();
reset role;

-- Both users' data survived the other's attempts.
do $$
declare
  u uuid;
begin
  foreach u in array array['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']::uuid[] loop
    if not exists (select 1 from public.profiles where id = u and display_name like 'Renamed %') then
      raise exception 'FAIL: profile % was changed by the other user', u;
    end if;
    if (select count(*) from public.lesson_progress where user_id = u and lesson_id = 'rls-test-lesson' and best_score = 5 and best_total = 5) <> 1
       or (select count(*) from public.exercise_results where user_id = u and exercise_id = 'rls-test-lesson-ex001' and attempts = 2) <> 1
       or (select count(*) from public.writing_task_progress where user_id = u and checked = '{1,3}'::smallint[]) <> 1
       or (select count(*) from public.saved_vocab where user_id = u) <> 1
       or (select count(*) from public.purchases where user_id = u and status = 'active') <> 1 then
      raise exception 'FAIL: progress or purchase rows of % were changed by the other user', u;
    end if;
  end loop;
  raise notice 'PASS: neither user changed the other''s rows';
end;
$$;

-- ===================================================================== user C: caps and import
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select rls_test.user_c();
reset role;

-- ===================================================================== anon
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select rls_test.anon_nothing();
reset role;

-- ===================================================================== each user deletes own rows
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select rls_test.delete_own();
reset role;

do $$
begin
  if (select count(*) from public.lesson_progress where user_id = '22222222-2222-4222-8222-222222222222') <> 2 then
    raise exception 'FAIL: A''s delete removed B''s rows';
  end if;
  raise notice 'PASS: A''s deletes left B''s rows in place';
end;
$$;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select rls_test.delete_own();
reset role;

-- ===================================================================== account deletion cascades
-- A writes progress again, then the account is deleted (as Supabase does from the dashboard).
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select rls_test.expect_apply('user A writes progress again', jsonb_build_array(
  rls_test.run('d1', 'rls-test-lesson', 1, 5, '-1 hour'),
  rls_test.attempt('d2', 'rls-test-lesson', 'rls-test-lesson-ex001', 'correct', '-1 hour'),
  rls_test.writing('d3', 'rls-test-lesson', 'rls-test-lesson-ex016', array[0], '-1 hour')), 3);
insert into public.saved_vocab (user_id, vocab_id, lesson_id) values ('11111111-1111-4111-8111-111111111111', 'rls-test-lesson-v001', 'rls-test-lesson');
reset role;

delete from auth.users where id in ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');

do $$
declare
  u uuid;
begin
  foreach u in array array['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333']::uuid[] loop
    if exists (select 1 from public.profiles where id = u)
       or exists (select 1 from public.lesson_progress where user_id = u)
       or exists (select 1 from public.exercise_results where user_id = u)
       or exists (select 1 from public.writing_task_progress where user_id = u)
       or exists (select 1 from public.saved_vocab where user_id = u)
       or exists (select 1 from public.purchases where user_id = u) then
      raise exception 'FAIL: deleting user % left rows behind', u;
    end if;
  end loop;
  if not exists (select 1 from public.profiles where id = '22222222-2222-4222-8222-222222222222') then
    raise exception 'FAIL: deleting user A removed B''s profile';
  end if;
  if not exists (select 1 from public.purchases where user_id = '22222222-2222-4222-8222-222222222222') then
    raise exception 'FAIL: deleting user A removed B''s purchase';
  end if;
  if public.get_founder_spots_left('lessons') <> 99 then
    raise exception 'FAIL: get_founder_spots_left() did not reflect cascaded deletion (got %, expected 99)', public.get_founder_spots_left('lessons');
  end if;
  raise notice 'PASS: deleting users A and C cascaded to the profile, progress, writing tasks and purchases, and left B alone';
  raise notice 'PASS: ALL RLS CHECKS PASSED';
end;
$$;

rollback;
