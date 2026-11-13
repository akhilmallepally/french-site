-- supabase/tests/rls.sql
-- Proves the RLS rules in 0003 on every table and every operation. Run it in the Supabase SQL
-- editor (or psql) AFTER the four migrations. It runs in one transaction that ends in ROLLBACK,
-- so it leaves nothing behind: no users, no rows, no test schema.
--
-- Output: one "PASS: ..." notice per expected outcome. Any unexpected outcome stops the script
-- with "FAIL: ...". If it reaches the end you'll see "PASS: ALL RLS CHECKS PASSED".
--
-- User A = 11111111-1111-4111-8111-111111111111, user B = 22222222-2222-4222-8222-222222222222.

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

-- As the signed-in user: insert, read and update their own rows in every table, and check
-- what they may not do to their own rows.
create function rls_test.own_rows() returns void language plpgsql security invoker as $$
declare
  me text := rls_test.me()::text;
  other text := rls_test.other()::text;
  who text := case when me like '1%' then 'user A' else 'user B' end;
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

  -- lesson_progress
  perform rls_test.expect_affected(who || ' inserts own lesson_progress', format('insert into public.lesson_progress (user_id, lesson_id, best_score, best_total) values (%L, %L, 3, 5)', me, 'rls-test-lesson'), 1);
  perform rls_test.expect_rows(who || ' reads own lesson_progress', format('select 1 from public.lesson_progress where user_id = %L', me), 1);
  perform rls_test.expect_affected(who || ' updates own lesson_progress', format('update public.lesson_progress set best_score = 4, status = %L, completed_at = now() where user_id = %L', 'completed', me), 1);
  perform rls_test.expect_error(who || ' moves own lesson_progress to the other user', format('update public.lesson_progress set user_id = %L where user_id = %L', other, me));
  perform rls_test.expect_error(who || ' lesson_progress best_score above best_total', format('update public.lesson_progress set best_score = 9 where user_id = %L', me), '23514');

  -- exercise_results
  perform rls_test.expect_affected(who || ' inserts own exercise_results', format('insert into public.exercise_results (user_id, lesson_id, exercise_id, correct, attempts, correct_count, last_result) values (%L, %L, %L, false, 1, 0, %L)', me, 'rls-test-lesson', 'rls-test-lesson-ex001', 'incorrect'), 1);
  perform rls_test.expect_rows(who || ' reads own exercise_results', format('select 1 from public.exercise_results where user_id = %L', me), 1);
  perform rls_test.expect_affected(who || ' updates own exercise_results', format('update public.exercise_results set correct = true, attempts = 2, correct_count = 1, last_result = %L where user_id = %L', 'correct', me), 1);
  perform rls_test.expect_error(who || ' moves own exercise_results to the other user', format('update public.exercise_results set user_id = %L where user_id = %L', other, me));
  perform rls_test.expect_error(who || ' exercise_results negative attempts', format('update public.exercise_results set attempts = -1, correct_count = 0 where user_id = %L', me), '23514');

  -- lesson_scores (append-only)
  perform rls_test.expect_affected(who || ' inserts own lesson_scores', format('insert into public.lesson_scores (user_id, lesson_id, score, total) values (%L, %L, 3, 5)', me, 'rls-test-lesson'), 1);
  perform rls_test.expect_rows(who || ' reads own lesson_scores', format('select 1 from public.lesson_scores where user_id = %L', me), 1);
  perform rls_test.expect_error(who || ' updates own lesson_scores (append-only)', format('update public.lesson_scores set score = 5 where user_id = %L', me));
  perform rls_test.expect_error(who || ' lesson_scores score above total', format('insert into public.lesson_scores (user_id, lesson_id, score, total) values (%L, %L, 6, 5)', me, 'rls-test-lesson'), '23514');
  perform rls_test.expect_error(who || ' lesson_scores empty lesson_id', format('insert into public.lesson_scores (user_id, lesson_id, score, total) values (%L, %L, 1, 5)', me, ''), '23514');

  -- saved_vocab (save or unsave, never edit)
  perform rls_test.expect_affected(who || ' inserts own saved_vocab', format('insert into public.saved_vocab (user_id, vocab_id, lesson_id) values (%L, %L, %L)', me, 'rls-test-lesson-v001', 'rls-test-lesson'), 1);
  perform rls_test.expect_rows(who || ' reads own saved_vocab', format('select 1 from public.saved_vocab where user_id = %L', me), 1);
  perform rls_test.expect_error(who || ' updates own saved_vocab', format('update public.saved_vocab set saved_at = now() where user_id = %L', me));
end;
$$;

-- As the signed-in user: try to read, update, delete and insert the other user's rows.
create function rls_test.other_rows() returns void language plpgsql security invoker as $$
declare
  me text := rls_test.me()::text;
  other text := rls_test.other()::text;
  who text := case when me like '1%' then 'user A' else 'user B' end;
begin
  -- profiles
  perform rls_test.expect_rows(who || ' reads other profile', format('select 1 from public.profiles where id = %L', other), 0);
  perform rls_test.expect_affected(who || ' updates other profile', format('update public.profiles set display_name = %L where id = %L', 'hacked', other), 0);
  perform rls_test.expect_error(who || ' deletes other profile', format('delete from public.profiles where id = %L', other));
  perform rls_test.expect_error(who || ' inserts a profile for the other id', format('insert into public.profiles (id) values (%L)', other));

  -- the four progress tables
  perform rls_test.expect_rows(who || ' reads other lesson_progress', format('select 1 from public.lesson_progress where user_id = %L', other), 0);
  perform rls_test.expect_rows(who || ' unfiltered lesson_progress shows own rows only', format('select 1 from public.lesson_progress where user_id <> %L', me), 0);
  perform rls_test.expect_affected(who || ' updates other lesson_progress', format('update public.lesson_progress set best_score = 0 where user_id = %L', other), 0);
  perform rls_test.expect_affected(who || ' deletes other lesson_progress', format('delete from public.lesson_progress where user_id = %L', other), 0);
  perform rls_test.expect_error(who || ' inserts lesson_progress for the other id', format('insert into public.lesson_progress (user_id, lesson_id, best_score, best_total) values (%L, %L, 1, 5)', other, 'rls-test-other'));

  perform rls_test.expect_rows(who || ' reads other exercise_results', format('select 1 from public.exercise_results where user_id = %L', other), 0);
  perform rls_test.expect_rows(who || ' unfiltered exercise_results shows own rows only', format('select 1 from public.exercise_results where user_id <> %L', me), 0);
  perform rls_test.expect_affected(who || ' updates other exercise_results', format('update public.exercise_results set attempts = 0, correct_count = 0 where user_id = %L', other), 0);
  perform rls_test.expect_affected(who || ' deletes other exercise_results', format('delete from public.exercise_results where user_id = %L', other), 0);
  perform rls_test.expect_error(who || ' inserts exercise_results for the other id', format('insert into public.exercise_results (user_id, lesson_id, exercise_id, correct, attempts, correct_count, last_result) values (%L, %L, %L, true, 1, 1, %L)', other, 'rls-test-other', 'rls-test-other-ex001', 'correct'));

  perform rls_test.expect_rows(who || ' reads other lesson_scores', format('select 1 from public.lesson_scores where user_id = %L', other), 0);
  perform rls_test.expect_rows(who || ' unfiltered lesson_scores shows own rows only', format('select 1 from public.lesson_scores where user_id <> %L', me), 0);
  perform rls_test.expect_error(who || ' updates other lesson_scores', format('update public.lesson_scores set score = 0 where user_id = %L', other));
  perform rls_test.expect_affected(who || ' deletes other lesson_scores', format('delete from public.lesson_scores where user_id = %L', other), 0);
  perform rls_test.expect_error(who || ' inserts lesson_scores for the other id', format('insert into public.lesson_scores (user_id, lesson_id, score, total) values (%L, %L, 1, 5)', other, 'rls-test-other'));

  perform rls_test.expect_rows(who || ' reads other saved_vocab', format('select 1 from public.saved_vocab where user_id = %L', other), 0);
  perform rls_test.expect_rows(who || ' unfiltered saved_vocab shows own rows only', format('select 1 from public.saved_vocab where user_id <> %L', me), 0);
  perform rls_test.expect_error(who || ' updates other saved_vocab', format('update public.saved_vocab set saved_at = now() where user_id = %L', other));
  perform rls_test.expect_affected(who || ' deletes other saved_vocab', format('delete from public.saved_vocab where user_id = %L', other), 0);
  perform rls_test.expect_error(who || ' inserts saved_vocab for the other id', format('insert into public.saved_vocab (user_id, vocab_id, lesson_id) values (%L, %L, %L)', other, 'rls-test-other-v001', 'rls-test-other'));
end;
$$;

-- As the signed-in user: delete their own progress rows.
create function rls_test.delete_own() returns void language plpgsql security invoker as $$
declare
  me text := rls_test.me()::text;
  who text := case when me like '1%' then 'user A' else 'user B' end;
  t text;
begin
  foreach t in array array['lesson_progress', 'exercise_results', 'lesson_scores', 'saved_vocab'] loop
    perform rls_test.expect_affected(who || ' deletes own ' || t, format('delete from public.%I where user_id = %L', t, me), 1);
    perform rls_test.expect_rows(who || ' own ' || t || ' is empty after delete', format('select 1 from public.%I where user_id = %L', t, me), 0);
  end loop;
end;
$$;

-- As anon: nothing is readable or writable.
create function rls_test.anon_nothing() returns void language plpgsql security invoker as $$
declare
  t text;
begin
  foreach t in array array['profiles', 'lesson_progress', 'exercise_results', 'lesson_scores', 'saved_vocab'] loop
    perform rls_test.expect_nothing('anon select ' || t, format('select 1 from public.%I', t));
    perform rls_test.expect_error('anon delete ' || t, format('delete from public.%I', t));
  end loop;
  perform rls_test.expect_error('anon update profiles', 'update public.profiles set display_name = null');
  perform rls_test.expect_error('anon update lesson_progress', 'update public.lesson_progress set best_score = 0');
  perform rls_test.expect_error('anon update exercise_results', 'update public.exercise_results set attempts = 0');
  perform rls_test.expect_error('anon update lesson_scores', 'update public.lesson_scores set score = 0');
  perform rls_test.expect_error('anon update saved_vocab', 'update public.saved_vocab set saved_at = now()');
  perform rls_test.expect_error('anon insert profiles', $q$insert into public.profiles (id) values ('11111111-1111-4111-8111-111111111111')$q$);
  perform rls_test.expect_error('anon insert lesson_progress', $q$insert into public.lesson_progress (user_id, lesson_id, best_score, best_total) values ('11111111-1111-4111-8111-111111111111', 'x', 1, 5)$q$);
  perform rls_test.expect_error('anon insert exercise_results', $q$insert into public.exercise_results (user_id, lesson_id, exercise_id, correct, attempts, correct_count, last_result) values ('11111111-1111-4111-8111-111111111111', 'x', 'x-ex001', true, 1, 1, 'correct')$q$);
  perform rls_test.expect_error('anon insert lesson_scores', $q$insert into public.lesson_scores (user_id, lesson_id, score, total) values ('11111111-1111-4111-8111-111111111111', 'x', 1, 5)$q$);
  perform rls_test.expect_error('anon insert saved_vocab', $q$insert into public.saved_vocab (user_id, vocab_id, lesson_id) values ('11111111-1111-4111-8111-111111111111', 'x-v001', 'x')$q$);
  perform rls_test.expect_error('anon calls touch_last_active()', 'select public.touch_last_active()');
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
begin
  -- Every table has RLS enabled and forced.
  foreach t in array array['profiles', 'lesson_progress', 'exercise_results', 'lesson_scores', 'saved_vocab'] loop
    select c.relrowsecurity, c.relforcerowsecurity into rls, forced
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = t;
    if rls is not true or forced is not true then
      raise exception 'FAIL: public.% has RLS enabled=% forced=%', t, rls, forced;
    end if;
    raise notice 'PASS: public.% has RLS enabled and forced', t;
  end loop;

  -- No policy is open to anon or public, and none is "using (true)".
  if exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename in ('profiles', 'lesson_progress', 'exercise_results', 'lesson_scores', 'saved_vocab')
       and (roles <> '{authenticated}'::name[] or qual = 'true' or with_check = 'true')
  ) then
    raise exception 'FAIL: a policy is not limited to authenticated, or uses true';
  end if;
  raise notice 'PASS: every policy is "to authenticated" and none uses true';

  -- The sign-up trigger writes under forced RLS, so its owner must bypass RLS (Supabase's
  -- postgres role does). If this fails, sign-ups would fail too.
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = 'public.handle_new_user()'::regprocedure and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'FAIL: the owner of public.handle_new_user() does not bypass RLS';
  end if;
  raise notice 'PASS: handle_new_user() owner bypasses RLS';
end;
$$;

insert into auth.users (id, email, aud, role, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', 'rls-test-a@example.invalid', 'authenticated', 'authenticated',
   '{"full_name": "Test User A", "avatar_url": "https://example.invalid/a.png"}'),
  ('22222222-2222-4222-8222-222222222222', 'rls-test-b@example.invalid', 'authenticated', 'authenticated',
   '{"full_name": "Test User B"}');

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
    if (select count(*) from public.lesson_progress where user_id = u and best_score = 4) <> 1
       or (select count(*) from public.exercise_results where user_id = u and attempts = 2) <> 1
       or (select count(*) from public.lesson_scores where user_id = u and score = 3) <> 1
       or (select count(*) from public.saved_vocab where user_id = u) <> 1 then
      raise exception 'FAIL: progress rows of % were changed by the other user', u;
    end if;
  end loop;
  raise notice 'PASS: neither user changed the other''s rows';
end;
$$;

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
  if (select count(*) from public.lesson_progress where user_id = '22222222-2222-4222-8222-222222222222') <> 1 then
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
insert into public.lesson_progress (user_id, lesson_id, best_score, best_total) values ('11111111-1111-4111-8111-111111111111', 'rls-test-lesson', 1, 5);
insert into public.exercise_results (user_id, lesson_id, exercise_id, correct, attempts, correct_count, last_result) values ('11111111-1111-4111-8111-111111111111', 'rls-test-lesson', 'rls-test-lesson-ex001', true, 1, 1, 'correct');
insert into public.lesson_scores (user_id, lesson_id, score, total) values ('11111111-1111-4111-8111-111111111111', 'rls-test-lesson', 1, 5);
insert into public.saved_vocab (user_id, vocab_id, lesson_id) values ('11111111-1111-4111-8111-111111111111', 'rls-test-lesson-v001', 'rls-test-lesson');
reset role;

delete from auth.users where id = '11111111-1111-4111-8111-111111111111';

do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
begin
  if exists (select 1 from public.profiles where id = a)
     or exists (select 1 from public.lesson_progress where user_id = a)
     or exists (select 1 from public.exercise_results where user_id = a)
     or exists (select 1 from public.lesson_scores where user_id = a)
     or exists (select 1 from public.saved_vocab where user_id = a) then
    raise exception 'FAIL: deleting user A left rows behind';
  end if;
  if not exists (select 1 from public.profiles where id = '22222222-2222-4222-8222-222222222222') then
    raise exception 'FAIL: deleting user A removed B''s profile';
  end if;
  raise notice 'PASS: deleting user A cascaded to the profile and every progress table, and left B alone';
  raise notice 'PASS: ALL RLS CHECKS PASSED';
end;
$$;

rollback;
