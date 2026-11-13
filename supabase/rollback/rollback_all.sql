-- rollback_all.sql
-- WARNING: THIS DELETES USER DATA. It drops every table, policy, trigger and function created by
-- supabase/migrations/0001 to 0004, including all profiles and all learner progress. It does not
-- touch auth.users: accounts stay, but lose their profile and progress. There is no undo.
-- Export anything you need first.

begin;

drop function if exists public.touch_last_active();

-- Progress tables first (policies and triggers are dropped with their tables).
drop table if exists public.saved_vocab;
drop table if exists public.lesson_scores;
drop table if exists public.exercise_results;
drop table if exists public.lesson_progress;

-- Then the sign-up trigger, its function and profiles.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.profiles;

-- Last, the shared updated_at function (no table uses it any more).
drop function if exists public.set_updated_at();

commit;
