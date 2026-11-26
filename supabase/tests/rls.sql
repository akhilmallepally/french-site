-- supabase/tests/rls.sql
-- Proves the RLS rules (0003, 0005), the progress write path (0006), the service-role grants
-- (0007), the daily-review write path (0008), the founder deadline (0009) and the subscriptions with
-- their entitlement (0010) on every table and every operation. Run it in the Supabase SQL editor (or
-- psql) AFTER migrations 0001 to 0010. It runs in
-- one transaction that ends in ROLLBACK, so it leaves nothing behind: no users, no rows, no test
-- schema.
--
-- Output: one "PASS: ..." notice per expected outcome. Any unexpected outcome stops the script
-- with "FAIL: ...". If it reaches the end you'll see "PASS: ALL RLS CHECKS PASSED".
--
-- User A = 11111111-1111-4111-8111-111111111111, user B = 22222222-2222-4222-8222-222222222222,
-- user C = 33333333-3333-4333-8333-333333333333 (caps and import, no purchase),
-- user D = 44444444-4444-4444-8444-444444444444 (a yearly subscription, no lifetime purchase).

begin;

-- ===================================================================== helpers (rolled back)
create schema rls_test;

-- The real values before anything is seeded (as postgres), so the checks don't depend on real
-- purchases or prices: founder spots left and the 'lessons' pricing row. A missing pricing row
-- gives nulls and is_active false.
create table rls_test.baseline as
select public.get_founder_spots_left('lessons') as spots_left,
       ps.founder_price_cents,
       ps.standard_price_cents,
       coalesce(ps.is_active, false) as is_active
  from (select 1) as one
  left join public.pricing_settings as ps on ps.product = 'lessons';

-- Founder spots expected after `taken` more active purchases at or below the founder price.
create function rls_test.spots_expected(taken int) returns int language sql stable as $$
  select greatest(0, b.spots_left - taken) from rls_test.baseline as b;
$$;

-- The 'lessons' pricing row as it was, read the way a user or anon reads it (1 row if active).
create function rls_test.pricing_query() returns text language sql stable as $$
  select format('select 1 from public.pricing_settings where product = %L and founder_price_cents = %s and standard_price_cents = %s',
                'lessons', coalesce(b.founder_price_cents::text, 'null'), coalesce(b.standard_price_cents::text, 'null'))
    from rls_test.baseline as b;
$$;

create function rls_test.pricing_rows() returns int language sql stable as $$
  select case when b.is_active then 1 else 0 end from rls_test.baseline as b;
$$;

-- A purchase amount that counts as a founder purchase, and one that doesn't.
create function rls_test.founder_amount() returns int language sql stable as $$
  select coalesce(b.founder_price_cents, 800) from rls_test.baseline as b;
$$;

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
  perform rls_test.expect_rows(who || ' reads pricing_settings (as before the test)', rls_test.pricing_query(), rls_test.pricing_rows());
  perform rls_test.expect_error(who || ' inserts pricing_settings', 'insert into public.pricing_settings (product, founder_price_cents, standard_price_cents, founder_cap) values (''pro'', 1500, 2000, 50)');
  perform rls_test.expect_error(who || ' updates pricing_settings', 'update public.pricing_settings set founder_price_cents = 100 where product = ''lessons''');
  perform rls_test.expect_error(who || ' deletes pricing_settings', 'delete from public.pricing_settings where product = ''lessons''');

  -- get_founder_spots_left(): the real value before the test, minus the 2 seeded purchases
  perform rls_test.expect_rows(who || ' calls get_founder_spots_left()', 'select 1 where public.get_founder_spots_left(''lessons'') = rls_test.spots_expected(2)', 1);

  -- 0007: the webhook's objects are out of reach.
  perform rls_test.expect_error(who || ' reads unmatched_payment_events', 'select 1 from public.unmatched_payment_events');
  perform rls_test.expect_error(who || ' calls find_user_id_by_email()', 'select public.find_user_id_by_email(''rls-test-b@example.invalid'')');
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
  perform rls_test.expect_error('anon reads unmatched_payment_events', 'select 1 from public.unmatched_payment_events');
  perform rls_test.expect_error('anon inserts unmatched_payment_events', $q$insert into public.unmatched_payment_events (provider, provider_order_id, event_type, reason) values ('dodo', 'x', 'order_paid', 'no_matching_user')$q$);
  perform rls_test.expect_error('anon calls find_user_id_by_email()', $q$select public.find_user_id_by_email('rls-test-a@example.invalid')$q$);

  -- purchases: anon has no access
  perform rls_test.expect_nothing('anon select purchases', 'select 1 from public.purchases');
  perform rls_test.expect_error('anon insert purchases', $q$insert into public.purchases (user_id, product, status, provider, provider_order_id, amount) values ('11111111-1111-4111-8111-111111111111', 'lessons', 'active', 'dodo', 'ord_anon', 800)$q$);
  perform rls_test.expect_error('anon update purchases', 'update public.purchases set status = ''refunded''');
  perform rls_test.expect_error('anon delete purchases', 'delete from public.purchases');

  -- pricing_settings: anon can read active rows, cannot write
  perform rls_test.expect_rows('anon select pricing_settings (as before the test)', rls_test.pricing_query(), rls_test.pricing_rows());
  perform rls_test.expect_rows('anon reads the founder deadline (0009)', 'select 1 from public.pricing_settings where product = ''lessons'' and founder_ends_at is not null', rls_test.pricing_rows());
  perform rls_test.expect_error('anon updates the founder deadline', 'update public.pricing_settings set founder_ends_at = now() + interval ''1 year'' where product = ''lessons''');
  perform rls_test.expect_error('anon insert pricing_settings', 'insert into public.pricing_settings (product, founder_price_cents, standard_price_cents, founder_cap) values (''pro'', 1500, 2000, 50)');
  perform rls_test.expect_error('anon update pricing_settings', 'update public.pricing_settings set founder_price_cents = 100 where product = ''lessons''');
  perform rls_test.expect_error('anon delete pricing_settings', 'delete from public.pricing_settings where product = ''lessons''');

  -- get_founder_spots_left(): anon can call it; the real value minus the 2 seeded purchases
  perform rls_test.expect_rows('anon calls get_founder_spots_left()', 'select 1 where public.get_founder_spots_left(''lessons'') = rls_test.spots_expected(2)', 1);
end;
$$;

-- As service_role (the payment webhook's client): exactly select, insert and update on purchases,
-- select and insert on unmatched_payment_events, and find_user_id_by_email(); nothing else.
create function rls_test.service_role_checks() returns void language plpgsql security invoker as $$
declare
  b text := '22222222-2222-4222-8222-222222222222';
begin
  -- purchases (amount above the real founder price, so get_founder_spots_left() is unaffected)
  perform rls_test.expect_affected('service_role inserts a purchase', format('insert into public.purchases (user_id, product, status, provider, provider_order_id, amount) values (%L, %L, %L, %L, %L, %s)', b, 'lessons', 'active', 'dodo', 'ord_test_srv_001', rls_test.founder_amount() + 1), 1);
  perform rls_test.expect_rows('service_role reads the purchase by provider_order_id', 'select 1 from public.purchases where provider_order_id = ''ord_test_srv_001''', 1);
  perform rls_test.expect_error('service_role inserts the same provider_order_id again', format('insert into public.purchases (user_id, product, status, provider, provider_order_id, amount) values (%L, %L, %L, %L, %L, %s)', b, 'lessons', 'active', 'dodo', 'ord_test_srv_001', rls_test.founder_amount() + 1), '23505');
  perform rls_test.expect_affected('service_role marks the purchase refunded', 'update public.purchases set status = ''refunded'', refunded_at = now() where provider_order_id = ''ord_test_srv_001''', 1);
  perform rls_test.expect_error('service_role deletes a purchase', 'delete from public.purchases where provider_order_id = ''ord_test_srv_001''');

  -- unmatched_payment_events
  perform rls_test.expect_affected('service_role records an unmatched event', 'insert into public.unmatched_payment_events (provider, provider_order_id, event_type, event_id, reason) values (''dodo'', ''pay_test_unmatched'', ''order_paid'', ''msg_test_1'', ''no_matching_user'')', 1);
  perform rls_test.expect_error('service_role records the same event again', 'insert into public.unmatched_payment_events (provider, provider_order_id, event_type, event_id, reason) values (''dodo'', ''pay_test_unmatched'', ''order_paid'', ''msg_test_2'', ''no_matching_user'')', '23505');
  perform rls_test.expect_rows('service_role reads unmatched events', 'select 1 from public.unmatched_payment_events where provider_order_id = ''pay_test_unmatched''', 1);
  perform rls_test.expect_error('service_role updates an unmatched event', 'update public.unmatched_payment_events set resolved_at = now()');
  perform rls_test.expect_error('service_role deletes an unmatched event', 'delete from public.unmatched_payment_events');

  -- find_user_id_by_email(): case and surrounding spaces ignored; unknown email gives null
  perform rls_test.expect_rows('service_role finds user B by email in another case', format('select 1 where public.find_user_id_by_email(%L) = %L::uuid', '  RLS-Test-B@Example.INVALID ', b), 1);
  perform rls_test.expect_rows('service_role gets null for an unknown email', 'select 1 where public.find_user_id_by_email(''nobody@example.invalid'') is null', 1);

  -- nothing else
  perform rls_test.expect_error('service_role reads profiles', 'select 1 from public.profiles');
  perform rls_test.expect_error('service_role reads lesson_progress', 'select 1 from public.lesson_progress');
  perform rls_test.expect_error('service_role reads exercise_results', 'select 1 from public.exercise_results');
  perform rls_test.expect_error('service_role reads writing_task_progress', 'select 1 from public.writing_task_progress');
  perform rls_test.expect_error('service_role updates pricing_settings', 'update public.pricing_settings set founder_cap = 0');
  perform rls_test.expect_error('service_role calls apply_progress()', 'select public.apply_progress(''[]''::jsonb)');
  perform rls_test.expect_error('service_role calls get_founder_spots_left()', 'select public.get_founder_spots_left(''lessons'')');
end;
$$;

-- ---------- daily review (0008) ----------
-- Calls apply_review(items) as the current user and expects n_applied applied entries and exactly
-- these rejection codes, in order.
create function rls_test.expect_review(label text, items jsonb, n_applied int, codes text[] default '{}')
returns void language plpgsql security invoker as $$
declare
  res jsonb := public.apply_review(items);
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

-- A card state entry (the shape apply_review documents). reviewed null means a new card (box 0).
create function rls_test.card(k text, card text, lesson text, box int, due interval, reviewed interval, reviews int default 0, lapses int default 0)
returns jsonb language sql stable as $$
  select jsonb_build_object('key', k, 'cardId', card, 'lessonId', lesson, 'box', box, 'dueAt', rls_test.ts(due),
    'lastReviewedAt', case when reviewed is null then null else to_jsonb(rls_test.ts(reviewed)) end,
    'reviews', reviews, 'lapses', lapses);
$$;

-- As the signed-in user: the write path, the merge rules and own reads. Leaves 2 cards.
create function rls_test.review_own() returns void language plpgsql security invoker as $$
declare
  me uuid := rls_test.me();
  who text := case when me = '11111111-1111-4111-8111-111111111111'::uuid then 'user A' else 'user B' end;
  l text := 'rls-test-lesson';
  c1 text := 'rls-test-lesson-v001';
  c2 text := 'rls-test-lesson-v002';
begin
  perform rls_test.expect_error(who || ' inserts review_cards directly', format('insert into public.review_cards (user_id, card_id, lesson_id, box, due_at) values (%L, %L, %L, 0, now())', me, c1, l));
  perform rls_test.expect_review(who || ' bad review entries', jsonb_build_array(
    rls_test.card('x1', 'other-lesson-v001', l, 1, '1 day', '-1 hour', 1),
    rls_test.card('x2', c1, l, 6, '1 day', '-1 hour', 1),
    rls_test.card('x3', c1, l, 1, '1 day', '-1 hour', 1, 2),
    rls_test.card('x4', c1, l, 0, '1 hour', null, 1),
    rls_test.card('x5', c1, l, 1, '1 day', null, 1),
    rls_test.card('x6', c1, l, 1, '1 day', '25 hours', 1),
    rls_test.card('x7', c1, l, 1, '500 days', '-1 hour', 1),
    '"not an object"'::jsonb), 0,
    array['bad_id', 'bad_box', 'bad_count', 'bad_count', 'bad_time', 'future_time', 'future_time', 'bad_item']);
  perform rls_test.expect_rows(who || ' rejected review entries wrote nothing', format('select 1 from public.review_cards where user_id = %L', me), 0);
  perform rls_test.expect_review(who || ' adds a new card (box 0)', jsonb_build_array(rls_test.card('n1', c1, l, 0, '0 hours', null)), 1);
  perform rls_test.expect_rows(who || ' reads the new card', format('select 1 from public.review_cards where user_id = %L and card_id = %L and box = 0 and last_reviewed_at is null and review_count = 0', me, c1), 1);
  perform rls_test.expect_review(who || ' first review (box 1)', jsonb_build_array(rls_test.card('r1', c1, l, 1, '1 day', '-1 hour', 1)), 1);
  perform rls_test.expect_review(who || ' resends the same review', jsonb_build_array(rls_test.card('r1', c1, l, 1, '1 day', '-1 hour', 1)), 1);
  perform rls_test.expect_rows(who || ' resend changed nothing', format('select 1 from public.review_cards where user_id = %L and card_id = %L and box = 1 and review_count = 1 and last_reviewed_at = now() - interval %L', me, c1, '1 hour'), 1);
  perform rls_test.expect_review(who || ' an older state arrives late, with more reviews', jsonb_build_array(rls_test.card('r0', c1, l, 3, '7 days', '-2 hours', 5, 1)), 1);
  perform rls_test.expect_rows(who || ' keeps the later state, counts take the max', format('select 1 from public.review_cards where user_id = %L and card_id = %L and box = 1 and last_reviewed_at = now() - interval %L and review_count = 5 and lapse_count = 1', me, c1, '1 hour'), 1);
  perform rls_test.expect_review(who || ' a tie on last_reviewed_at', jsonb_build_array(rls_test.card('t1', c1, l, 4, '16 days', '-1 hour', 5, 1)), 1);
  perform rls_test.expect_rows(who || ' a tie keeps the stored state', format('select 1 from public.review_cards where user_id = %L and card_id = %L and box = 1', me, c1), 1);
  perform rls_test.expect_review(who || ' an unreviewed entry against a reviewed card', jsonb_build_array(rls_test.card('n2', c1, l, 0, '0 hours', null)), 1);
  perform rls_test.expect_rows(who || ' the reviewed card is kept', format('select 1 from public.review_cards where user_id = %L and card_id = %L and box = 1', me, c1), 1);
  perform rls_test.expect_review(who || ' a newer review (box 2)', jsonb_build_array(rls_test.card('r2', c1, l, 2, '3 days', '-30 minutes', 6, 1)), 1);
  perform rls_test.expect_rows(who || ' the newer review wins', format('select 1 from public.review_cards where user_id = %L and card_id = %L and box = 2 and review_count = 6 and due_at = now() + interval %L', me, c1, '3 days'), 1);
  perform rls_test.expect_review(who || ' a review 23 hours ahead', jsonb_build_array(rls_test.card('f1', c2, l, 1, '2 days', '23 hours', 1)), 1);
  perform rls_test.expect_rows(who || ' time stored as sent, not clamped', format('select 1 from public.review_cards where user_id = %L and card_id = %L and last_reviewed_at = now() + interval %L', me, c2, '23 hours'), 1);
  perform rls_test.expect_error(who || ' updates own review_cards directly', format('update public.review_cards set box = 5 where user_id = %L', me));
  perform rls_test.expect_rows(who || ' sees only own cards (unfiltered select)', 'select 1 from public.review_cards', 2);
end;
$$;

-- As the signed-in user, against the other user's cards.
create function rls_test.review_other() returns void language plpgsql security invoker as $$
declare
  me uuid := rls_test.me();
  other uuid := rls_test.other();
  who text := case when me = '11111111-1111-4111-8111-111111111111'::uuid then 'user A' else 'user B' end;
begin
  perform rls_test.expect_rows(who || ' reads the other user''s cards', format('select 1 from public.review_cards where user_id = %L', other), 0);
  perform rls_test.expect_affected(who || ' deletes the other user''s cards', format('delete from public.review_cards where user_id = %L', other), 0);
  perform rls_test.expect_error(who || ' inserts a card for the other user', format('insert into public.review_cards (user_id, card_id, lesson_id, box, due_at) values (%L, %L, %L, 0, now())', other, 'rls-test-other-v001', 'rls-test-other'));
  -- An entry naming the other user is written for the caller only (the id comes from auth.uid()).
  perform rls_test.expect_review(who || ' names the other user in an entry', jsonb_build_array(
    rls_test.card('o1', 'rls-test-only-mine-v001', 'rls-test-only-mine', 0, '0 hours', null) || jsonb_build_object('userId', other)), 1);
end;
$$;

-- User C, at the cap (6,000 cards seeded below): a new card is refused, an existing one updates.
create function rls_test.review_cap() returns void language plpgsql security invoker as $$
begin
  perform rls_test.expect_review('user C adds a card at the cap', jsonb_build_array(rls_test.card('c1', 'cap-lesson-v9999', 'cap-lesson', 0, '0 hours', null)), 0, array['cap_reached']);
  perform rls_test.expect_review('user C reviews an existing card at the cap', jsonb_build_array(rls_test.card('c2', 'cap-lesson-v1', 'cap-lesson', 1, '1 day', '-1 hour', 1)), 1);
  perform rls_test.expect_rows('user C still has 6,000 cards, the reviewed one updated', 'select 1 from public.review_cards where card_id = ''cap-lesson-v1'' and box = 1', 1);
end;
$$;

-- ---------- subscriptions (0010) ----------
-- has_access() for the current user at now() + offset, expected true or false.
create function rls_test.expect_access(label text, offset_by interval, expected boolean, product text default 'lessons')
returns void language plpgsql security invoker as $$
declare
  got boolean := public.has_access(product, now() + offset_by);
begin
  if got is distinct from expected then
    raise exception 'FAIL: % has_access was %, expected %', label, got, expected;
  end if;
  raise notice 'PASS: % -> has_access %', label, got;
end;
$$;

-- As user D (one subscription row, set up as postgres): own reads, and no writes of any kind.
create function rls_test.subscriptions_own() returns void language plpgsql security invoker as $$
declare
  me text := rls_test.me()::text;
begin
  perform rls_test.expect_rows('user D reads own subscription', format('select 1 from public.subscriptions where user_id = %L', me), 1);
  perform rls_test.expect_rows('user D reads own subscription payment', format('select 1 from public.subscription_payments where user_id = %L', me), 1);
  perform rls_test.expect_rows('user D sees only own subscriptions (unfiltered select)', 'select 1 from public.subscriptions', 1);
  perform rls_test.expect_rows('user D sees only own subscription payments (unfiltered select)', 'select 1 from public.subscription_payments', 1);
  perform rls_test.expect_error('user D inserts a subscription', format('insert into public.subscriptions (user_id, product, provider, provider_subscription_id, status, current_period_end) values (%L, %L, %L, %L, %L, now() + interval %L)', me, 'lessons', 'dodo', 'sub_forged', 'active', '1 year'));
  perform rls_test.expect_error('user D extends own subscription', format('update public.subscriptions set current_period_end = now() + interval %L where user_id = %L', '10 years', me));
  perform rls_test.expect_error('user D deletes own subscription', format('delete from public.subscriptions where user_id = %L', me));
  perform rls_test.expect_error('user D inserts a subscription payment', format('insert into public.subscription_payments (subscription_id, user_id, provider_payment_id, charge_type, status, amount) values (1, %L, %L, %L, %L, 0)', me, 'pay_forged', 'new', 'succeeded'));
  perform rls_test.expect_error('user D updates own subscription payment', format('update public.subscription_payments set status = %L where user_id = %L', 'refunded', me));
end;
$$;

grant usage on schema rls_test to authenticated, anon, service_role;
grant execute on all functions in schema rls_test to authenticated, anon, service_role;
grant select on rls_test.baseline to authenticated, anon, service_role;

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
  if pg_catalog.to_regclass('public.review_cards') is null then
    raise exception 'FAIL: public.review_cards is missing: run migration 0008 first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pricing_settings' and column_name = 'founder_ends_at') then
    raise exception 'FAIL: pricing_settings.founder_ends_at is missing: run migration 0009 first';
  end if;
  if pg_catalog.to_regclass('public.subscriptions') is null or pg_catalog.to_regprocedure('public.has_access(text, timestamp with time zone)') is null then
    raise exception 'FAIL: public.subscriptions or has_access() is missing: run migration 0010 first';
  end if;
  foreach t in array array['profiles', 'lesson_progress', 'exercise_results', 'writing_task_progress', 'saved_vocab', 'purchases', 'pricing_settings', 'unmatched_payment_events', 'review_cards', 'subscriptions', 'subscription_payments'] loop
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
       and tablename in ('profiles', 'lesson_progress', 'exercise_results', 'writing_task_progress', 'saved_vocab', 'purchases', 'subscriptions', 'subscription_payments')
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

  -- 0008: apply_review() has the same properties.
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = 'public.apply_review(jsonb)'::regprocedure
       and p.prosecdef and 'search_path=""' = any (p.proconfig)
       and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'FAIL: apply_review() is not security definer with search_path '''' and an RLS-bypassing owner';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'public.apply_review(jsonb)'::regprocedure and a.grantee = 0
  ) or (select p.proacl is null from pg_catalog.pg_proc p where p.oid = 'public.apply_review(jsonb)'::regprocedure) then
    raise exception 'FAIL: PUBLIC can execute apply_review()';
  end if;
  if has_function_privilege('anon', 'public.apply_review(jsonb)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.apply_review(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.apply_review(jsonb)', 'EXECUTE') then
    raise exception 'FAIL: apply_review() execute is not authenticated-only';
  end if;
  raise notice 'PASS: apply_review() is security definer, search_path empty, authenticated-only';

  -- 0010: has_access() is security invoker (it reads only the caller's rows, by RLS), with an empty
  -- search_path, executable by authenticated only (not PUBLIC, anon or service_role).
  if not exists (
    select 1 from pg_catalog.pg_proc p
     where p.oid = 'public.has_access(text, timestamp with time zone)'::regprocedure
       and not p.prosecdef and 'search_path=""' = any (p.proconfig)
  ) then
    raise exception 'FAIL: has_access() is not security invoker with search_path ''''';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'public.has_access(text, timestamp with time zone)'::regprocedure and a.grantee = 0
  ) or (select p.proacl is null from pg_catalog.pg_proc p where p.oid = 'public.has_access(text, timestamp with time zone)'::regprocedure) then
    raise exception 'FAIL: PUBLIC can execute has_access()';
  end if;
  if has_function_privilege('anon', 'public.has_access(text, timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.has_access(text, timestamp with time zone)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.has_access(text, timestamp with time zone)', 'EXECUTE') then
    raise exception 'FAIL: has_access() execute is not authenticated-only';
  end if;
  raise notice 'PASS: has_access() is security invoker, search_path empty, authenticated-only';

  -- 0007: exact table privileges in public for service_role, authenticated and anon.
  -- Expected: service_role only what the payment webhook uses; authenticated and anon as in
  -- 0003, 0005 and 0006; nobody but service_role on unmatched_payment_events.
  declare
    rel record;
    role_name text;
    priv text;
    has_it boolean;
    expected text[];
  begin
    for rel in
      select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
    loop
      foreach role_name in array array['service_role', 'authenticated', 'anon'] loop
        -- service_role is checked on every public table (0007 revokes it from all of them);
        -- authenticated and anon only on the tables these migrations manage.
        continue when role_name <> 'service_role' and rel.relname not in (
          'profiles', 'lesson_progress', 'exercise_results', 'writing_task_progress', 'saved_vocab',
          'purchases', 'pricing_settings', 'unmatched_payment_events', 'review_cards', 'subscriptions', 'subscription_payments');
        expected := case role_name || ':' || rel.relname
          when 'service_role:purchases' then array['SELECT', 'INSERT', 'UPDATE']
          when 'service_role:unmatched_payment_events' then array['SELECT', 'INSERT']
          when 'service_role:subscriptions' then array['SELECT', 'INSERT', 'UPDATE']
          when 'service_role:subscription_payments' then array['SELECT', 'INSERT', 'UPDATE']
          when 'authenticated:subscriptions' then array['SELECT']
          when 'authenticated:subscription_payments' then array['SELECT']
          when 'authenticated:profiles' then array['SELECT']  -- plus column-level UPDATE, checked below
          when 'authenticated:lesson_progress' then array['SELECT', 'DELETE']
          when 'authenticated:exercise_results' then array['SELECT', 'DELETE']
          when 'authenticated:writing_task_progress' then array['SELECT', 'DELETE']
          when 'authenticated:saved_vocab' then array['SELECT', 'INSERT', 'DELETE']
          when 'authenticated:review_cards' then array['SELECT', 'DELETE']
          when 'authenticated:purchases' then array['SELECT']
          when 'authenticated:pricing_settings' then array['SELECT']
          when 'anon:pricing_settings' then array['SELECT']
          else array[]::text[]
        end;
        foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
          has_it := has_table_privilege(role_name, 'public.' || pg_catalog.quote_ident(rel.relname), priv);
          if has_it <> (priv = any (expected)) then
            raise exception 'FAIL: % on public.%: % is %, expected %', role_name, rel.relname, priv, has_it, not has_it;
          end if;
        end loop;
      end loop;
    end loop;
  end;
  if not has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE') then
    raise exception 'FAIL: authenticated column privileges on profiles changed';
  end if;
  raise notice 'PASS: service_role, authenticated and anon have exactly the expected table privileges';

  -- 0007: functions in public that service_role can execute, checked against an explicit list.
  --   Allowed by name: find_user_id_by_email(text), the only function the service-role client
  --     calls (lib/payments/webhook.ts).
  --   Kept by rule (reported, not failed):
  --     * trigger and event-trigger functions: Postgres refuses to call them directly, and firing
  --       a trigger doesn't check EXECUTE;
  --     * functions that belong to an extension: their grants are the extension's, and revoking
  --       them can break it.
  --   Anything else fails, naming the function and why service_role can run it (PUBLIC, a direct
  --   grant, or membership of another role).
  declare
    f record;
    allowed regprocedure[] := array['public.find_user_id_by_email(text)'::regprocedure];
    service_oid oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = 'service_role');
    unexpected text[] := '{}';
    kept text[] := '{}';
    why text;
  begin
    for f in
      select p.oid, p.oid::regprocedure::text as name, p.prorettype, p.proacl,
             exists (select 1 from pg_catalog.pg_depend d
                      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') as from_extension
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
         and has_function_privilege('service_role', p.oid, 'EXECUTE')
       order by 2
    loop
      continue when f.oid = any (allowed::oid[]);
      why := case
        when f.proacl is null then 'PUBLIC (default ACL)'
        when exists (select 1 from pg_catalog.aclexplode(f.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') then 'PUBLIC grant'
        when exists (select 1 from pg_catalog.aclexplode(f.proacl) a where a.grantee = service_oid and a.privilege_type = 'EXECUTE') then 'direct grant to service_role'
        else 'membership of another role'
      end;
      if f.prorettype in ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype) then
        kept := kept || (f.name || ' [trigger function; ' || why || ']');
      elsif f.from_extension then
        kept := kept || (f.name || ' [extension function; ' || why || ']');
      else
        unexpected := unexpected || (f.name || ' [' || why || ']');
      end if;
    end loop;

    if cardinality(kept) > 0 then
      raise notice 'NOTE: service_role can execute these public functions, kept by rule: %', array_to_string(kept, '; ');
    end if;
    if cardinality(unexpected) > 0 then
      raise exception 'FAIL: service_role can execute public functions outside the allowed list: %', array_to_string(unexpected, '; ');
    end if;
  end;
  if not has_function_privilege('service_role', 'public.find_user_id_by_email(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.find_user_id_by_email(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.find_user_id_by_email(text)', 'EXECUTE') then
    raise exception 'FAIL: find_user_id_by_email() execute is not service_role-only';
  end if;
  -- PUBLIC explicitly: no grant to grantee 0, and an explicit ACL (a null ACL means PUBLIC may execute).
  if exists (
    select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'public.find_user_id_by_email(text)'::regprocedure and a.grantee = 0
  ) or (select p.proacl is null from pg_catalog.pg_proc p where p.oid = 'public.find_user_id_by_email(text)'::regprocedure) then
    raise exception 'FAIL: PUBLIC can execute find_user_id_by_email()';
  end if;
  -- Only the owner and service_role hold execute on it.
  if exists (
    select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'public.find_user_id_by_email(text)'::regprocedure
       and a.privilege_type = 'EXECUTE'
       and a.grantee <> p.proowner
       and a.grantee <> (select r.oid from pg_catalog.pg_roles r where r.rolname = 'service_role')
  ) then
    raise exception 'FAIL: a role other than its owner and service_role holds execute on find_user_id_by_email()';
  end if;
  if not has_function_privilege('authenticated', 'public.touch_last_active()', 'EXECUTE')
     or has_function_privilege('anon', 'public.touch_last_active()', 'EXECUTE')
     or not has_function_privilege('anon', 'public.get_founder_spots_left(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_founder_spots_left(text)', 'EXECUTE') then
    raise exception 'FAIL: anon or authenticated function privileges changed';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = 'public.find_user_id_by_email(text)'::regprocedure
       and p.prosecdef and 'search_path=""' = any (p.proconfig)
  ) then
    raise exception 'FAIL: find_user_id_by_email() is not security definer with search_path ''''';
  end if;
  raise notice 'PASS: function privileges: service_role only find_user_id_by_email() (plus trigger and extension functions); anon and authenticated unchanged';
end;
$$;

-- ===================================================================== founder deadline (0009, as postgres)
do $$
begin
  -- The deadline: one moment for everyone, not null.
  if (select founder_ends_at from public.pricing_settings where product = 'lessons') is distinct from '2026-12-31T16:59:00Z'::timestamptz then
    raise exception 'FAIL: the lessons founder_ends_at is not 2026-12-31T16:59:00Z';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'pricing_settings' and column_name = 'founder_ends_at' and is_nullable = 'YES') then
    raise exception 'FAIL: founder_ends_at is nullable';
  end if;
  raise notice 'PASS: founder_ends_at is set to 2026-12-31T16:59:00Z and not null';

  -- The guard: security invoker, empty search_path, executable by nobody but its owner.
  if not exists (
    select 1 from pg_catalog.pg_proc p
     where p.oid = 'public.guard_founder_deadline()'::regprocedure
       and not p.prosecdef and 'search_path=""' = any (p.proconfig)
  ) then
    raise exception 'FAIL: guard_founder_deadline() is not security invoker with search_path ''''';
  end if;
  if has_function_privilege('anon', 'public.guard_founder_deadline()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_founder_deadline()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.guard_founder_deadline()', 'EXECUTE') then
    raise exception 'FAIL: guard_founder_deadline() is executable by anon, authenticated or service_role';
  end if;
  raise notice 'PASS: guard_founder_deadline() is security invoker, search_path empty, not executable by app roles';
end;
$$;

-- A change without the migration setting is refused; with it, it goes through (rolled back at the end).
select rls_test.expect_error('postgres changes founder_ends_at without the migration setting',
  'update public.pricing_settings set founder_ends_at = founder_ends_at + interval ''1 day'' where product = ''lessons''', '23514');
do $$
begin
  if (select pg_catalog.current_setting('app.allow_founder_deadline_change', true)) = 'on' then
    raise exception 'FAIL: app.allow_founder_deadline_change is already on in this session';
  end if;
  begin
    perform pg_catalog.set_config('app.allow_founder_deadline_change', 'on', true);
    update public.pricing_settings set founder_ends_at = founder_ends_at + interval '1 day' where product = 'lessons';
    if (select founder_ends_at from public.pricing_settings where product = 'lessons') <> '2027-01-01T16:59:00Z'::timestamptz then
      raise exception 'FAIL: the deliberate change did not apply';
    end if;
    raise exception 'undo' using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'undo' then raise; end if;
  end;
  perform pg_catalog.set_config('app.allow_founder_deadline_change', '', true);
  if (select founder_ends_at from public.pricing_settings where product = 'lessons') <> '2026-12-31T16:59:00Z'::timestamptz then
    raise exception 'FAIL: the deliberate change was not undone';
  end if;
  raise notice 'PASS: founder_ends_at changes only with app.allow_founder_deadline_change (a migration)';
end;
$$;

insert into auth.users (id, email, aud, role, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', 'rls-test-a@example.invalid', 'authenticated', 'authenticated',
   '{"full_name": "Test User A", "avatar_url": "https://example.invalid/a.png"}'),
  ('22222222-2222-4222-8222-222222222222', 'rls-test-b@example.invalid', 'authenticated', 'authenticated',
   '{"full_name": "Test User B"}'),
  ('33333333-3333-4333-8333-333333333333', 'rls-test-c@example.invalid', 'authenticated', 'authenticated',
   '{"full_name": "Test User C"}'),
  ('44444444-4444-4444-8444-444444444444', 'rls-test-d@example.invalid', 'authenticated', 'authenticated',
   '{"full_name": "Test User D"}');

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

-- Seed initial test purchases for user A and user B (simulating the webhook service role), at the
-- real founder price, so each one takes a founder spot.
insert into public.purchases (user_id, product, status, provider, provider_order_id, amount, currency)
values
  ('11111111-1111-4111-8111-111111111111', 'lessons', 'active', 'dodo', 'ord_test_a_001', rls_test.founder_amount(), 'usd'),
  ('22222222-2222-4222-8222-222222222222', 'lessons', 'active', 'dodo', 'ord_test_b_001', rls_test.founder_amount(), 'usd');

-- Seed user C at every cap (as postgres, which bypasses RLS and grants), review cards included.
insert into public.review_cards (user_id, card_id, lesson_id, box, due_at, last_reviewed_at, review_count)
select '33333333-3333-4333-8333-333333333333', 'cap-lesson-v' || g, 'cap-lesson', 1, now() + interval '1 day', now() - interval '1 day', 1
  from generate_series(1, 6000) as g;
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

-- ===================================================================== service_role (payment webhook)
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select rls_test.service_role_checks();
reset role;

-- ===================================================================== daily review (0008)
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select rls_test.review_own();
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select rls_test.review_own();
select rls_test.review_other();
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select rls_test.review_other();
reset role;

do $$
begin
  if (select count(*) from public.review_cards where card_id = 'rls-test-only-mine-v001') <> 2
     or exists (select 1 from public.review_cards where card_id = 'rls-test-only-mine-v001'
                 and user_id not in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')) then
    raise exception 'FAIL: apply_review() wrote a card for someone other than the caller';
  end if;
  if (select count(*) from public.review_cards where user_id = '11111111-1111-4111-8111-111111111111') <> 3
     or (select count(*) from public.review_cards where user_id = '22222222-2222-4222-8222-222222222222') <> 3 then
    raise exception 'FAIL: one user''s review checks changed the other''s cards';
  end if;
  raise notice 'PASS: each user''s cards were written only for that user, and neither touched the other''s';
end;
$$;

select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select rls_test.review_cap();
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select rls_test.expect_nothing('anon reads review_cards', 'select 1 from public.review_cards');
select rls_test.expect_error('anon inserts review_cards', 'insert into public.review_cards (user_id, card_id, lesson_id, box, due_at) values (''11111111-1111-4111-8111-111111111111'', ''x-v001'', ''x'', 0, now())');
select rls_test.expect_error('anon calls apply_review()', 'select public.apply_review(''[]''::jsonb)');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select rls_test.expect_error('service_role reads review_cards', 'select 1 from public.review_cards');
select rls_test.expect_error('service_role inserts review_cards', 'insert into public.review_cards (user_id, card_id, lesson_id, box, due_at) values (''11111111-1111-4111-8111-111111111111'', ''x-v001'', ''x'', 0, now())');
select rls_test.expect_error('service_role calls apply_review()', 'select public.apply_review(''[]''::jsonb)');
reset role;

-- A deletes own cards; B's stay.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select rls_test.expect_affected('user A deletes own review cards', 'delete from public.review_cards', 3);
reset role;
do $$
begin
  if (select count(*) from public.review_cards where user_id = '22222222-2222-4222-8222-222222222222') <> 3 then
    raise exception 'FAIL: A''s delete removed B''s review cards';
  end if;
  raise notice 'PASS: A''s review-card delete left B''s cards in place';
end;
$$;

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

-- ===================================================================== subscriptions (0010)
-- User D: one yearly subscription, its first payment. Seeded as postgres (as the webhook would).
insert into public.subscriptions (user_id, product, provider, provider_subscription_id, provider_customer_id, status, current_period_end)
values ('44444444-4444-4444-8444-444444444444', 'lessons', 'dodo', 'sub_test_d_1', 'cus_test_d', 'active', now() + interval '30 days');
insert into public.subscription_payments (subscription_id, user_id, provider_payment_id, charge_type, status, amount)
select s.id, s.user_id, 'pay_test_d_1', 'new', 'succeeded', 1200 from public.subscriptions as s where s.provider_subscription_id = 'sub_test_d_1';

-- The table's own rule: a cancelled subscription says when.
select rls_test.expect_error('a cancelled subscription without cancelled_at',
  'update public.subscriptions set status = ''cancelled'' where provider_subscription_id = ''sub_test_d_1''', '23514');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
set local role authenticated;
select rls_test.subscriptions_own();
-- Active: access until the period end plus the 7-day grace.
select rls_test.expect_access('active, now', '0 seconds', true);
select rls_test.expect_access('active, 6 days after the period end (in the grace)', '36 days', true);
select rls_test.expect_access('active, 8 days after the period end (past the grace)', '38 days', false);
select rls_test.expect_access('another product', '0 seconds', false, 'pro');
reset role;

-- Past due (a failed renewal): the same grace.
update public.subscriptions set status = 'past_due' where provider_subscription_id = 'sub_test_d_1';
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
set local role authenticated;
select rls_test.expect_access('past_due, now', '0 seconds', true);
select rls_test.expect_access('past_due, 6 days after the period end', '36 days', true);
select rls_test.expect_access('past_due, 8 days after the period end', '38 days', false);
reset role;

-- On hold (the grace ran out): no access, even inside the period.
update public.subscriptions set status = 'on_hold' where provider_subscription_id = 'sub_test_d_1';
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
set local role authenticated;
select rls_test.expect_access('on_hold, now', '0 seconds', false);
reset role;

-- Cancelled at the period end: access to the end of the paid year, no grace after it.
update public.subscriptions set status = 'cancelled', cancelled_at = now(), cancel_at_period_end = true where provider_subscription_id = 'sub_test_d_1';
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
set local role authenticated;
select rls_test.expect_access('cancelled at the period end, now', '0 seconds', true);
select rls_test.expect_access('cancelled at the period end, a day before it', '29 days', true);
select rls_test.expect_access('cancelled at the period end, a day after it (no grace)', '31 days', false);
reset role;

-- Cancelled at once, refunded, disputed, expired: no access.
update public.subscriptions set cancel_at_period_end = false where provider_subscription_id = 'sub_test_d_1';
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
set local role authenticated;
select rls_test.expect_access('cancelled at once', '0 seconds', false);
reset role;
do $$
declare
  st text;
begin
  foreach st in array array['refunded', 'disputed', 'expired'] loop
    update public.subscriptions set status = st, cancelled_at = null where provider_subscription_id = 'sub_test_d_1';
    perform pg_catalog.set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
    if public.has_access('lessons', now()) then
      raise exception 'FAIL: a % subscription gives access', st;
    end if;
    raise notice 'PASS: % -> has_access false', st;
  end loop;
end;
$$;

-- A duplicate (a second subscription, as after a double charge): any one entitling row is enough.
insert into public.subscriptions (user_id, product, provider, provider_subscription_id, status, current_period_end)
values ('44444444-4444-4444-8444-444444444444', 'lessons', 'dodo', 'sub_test_d_2', 'active', now() + interval '365 days');
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
set local role authenticated;
select rls_test.expect_access('a refunded subscription plus an active one', '0 seconds', true);
reset role;

-- Lifetime purchases still count, and nobody sees anyone else's access.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select rls_test.expect_access('user B (a lifetime purchase)', '0 seconds', true);
select rls_test.expect_access('user B, years later', '3650 days', true);
select rls_test.expect_rows('user B reads D''s subscriptions', 'select 1 from public.subscriptions', 0);
select rls_test.expect_rows('user B reads D''s subscription payments', 'select 1 from public.subscription_payments', 0);
reset role;

-- anon: nothing; service_role (the webhook): select, insert, update, never delete.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select rls_test.expect_nothing('anon reads subscriptions', 'select 1 from public.subscriptions');
select rls_test.expect_nothing('anon reads subscription_payments', 'select 1 from public.subscription_payments');
select rls_test.expect_error('anon calls has_access()', 'select public.has_access(''lessons'', now())');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select rls_test.expect_affected('service_role inserts a subscription', 'insert into public.subscriptions (user_id, product, provider, provider_subscription_id, status, current_period_end) values (''44444444-4444-4444-8444-444444444444'', ''lessons'', ''dodo'', ''sub_test_srv_1'', ''active'', now() + interval ''1 year'')', 1);
select rls_test.expect_affected('service_role renews it', 'update public.subscriptions set current_period_end = current_period_end + interval ''1 year'' where provider_subscription_id = ''sub_test_srv_1''', 1);
select rls_test.expect_error('service_role inserts the same subscription id again', 'insert into public.subscriptions (user_id, product, provider, provider_subscription_id, status, current_period_end) values (''44444444-4444-4444-8444-444444444444'', ''lessons'', ''dodo'', ''sub_test_srv_1'', ''active'', now())', '23505');
select rls_test.expect_affected('service_role records a payment', 'insert into public.subscription_payments (subscription_id, user_id, provider_payment_id, charge_type, status, amount) select id, user_id, ''pay_test_srv_1'', ''renewal'', ''succeeded'', 1200 from public.subscriptions where provider_subscription_id = ''sub_test_srv_1''', 1);
select rls_test.expect_affected('service_role marks the payment refunded', 'update public.subscription_payments set status = ''refunded'', refunded_at = now() where provider_payment_id = ''pay_test_srv_1''', 1);
select rls_test.expect_error('service_role deletes a subscription', 'delete from public.subscriptions where provider_subscription_id = ''sub_test_srv_1''');
select rls_test.expect_error('service_role deletes a subscription payment', 'delete from public.subscription_payments where provider_payment_id = ''pay_test_srv_1''');
select rls_test.expect_error('service_role calls has_access()', 'select public.has_access(''lessons'', now())');
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

delete from auth.users where id in ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444');

do $$
declare
  u uuid;
begin
  foreach u in array array['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']::uuid[] loop
    if exists (select 1 from public.profiles where id = u)
       or exists (select 1 from public.lesson_progress where user_id = u)
       or exists (select 1 from public.exercise_results where user_id = u)
       or exists (select 1 from public.writing_task_progress where user_id = u)
       or exists (select 1 from public.saved_vocab where user_id = u)
       or exists (select 1 from public.review_cards where user_id = u)
       or exists (select 1 from public.subscriptions where user_id = u)
       or exists (select 1 from public.subscription_payments where user_id = u)
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
  if public.get_founder_spots_left('lessons') <> rls_test.spots_expected(1) then
    raise exception 'FAIL: get_founder_spots_left() did not reflect cascaded deletion (got %, expected %)',
      public.get_founder_spots_left('lessons'), rls_test.spots_expected(1);
  end if;
  raise notice 'PASS: deleting users A, C and D cascaded to the profile, progress, writing tasks, review cards, subscriptions and purchases, and left B alone';
  raise notice 'PASS: ALL RLS CHECKS PASSED';
end;
$$;

rollback;
