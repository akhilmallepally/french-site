-- rollback_all.sql
-- WARNING: THIS DELETES USER DATA. It drops every table, policy, trigger and function created by
-- supabase/migrations/0001 to 0007, including all profiles, learner progress, writing-task records,
-- purchases, unmatched payment events, and pricing. To undo only the progress sync, use rollback/0006_progress_sync.sql instead.
-- It does not touch auth.users: accounts stay, but lose their profile, progress, and entitlements.
-- There is no undo. Export anything you need first.

begin;

-- Service-role grants and unmatched payment events (0007)
drop function if exists public.find_user_id_by_email(text);
drop table if exists public.unmatched_payment_events;

-- Payments (0005)
drop function if exists public.get_founder_spots_left(text);
drop table if exists public.purchases;
drop table if exists public.pricing_settings;

drop function if exists public.touch_last_active();

-- Progress sync (0006)
drop function if exists public.apply_progress(jsonb);
drop table if exists public.writing_task_progress;

-- Progress tables first (policies and triggers are dropped with their tables). lesson_scores is
-- gone after 0006; "if exists" covers a database where 0006 never ran.
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
