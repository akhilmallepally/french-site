-- rollback/0008_review_cards.sql
-- Undoes migration 0008. WARNING: this deletes every learner's daily-review card states
-- (review_cards). Lessons, progress, purchases and accounts are untouched.

begin;

drop function if exists public.apply_review(jsonb);
drop table if exists public.review_cards; -- its policies go with it

commit;
