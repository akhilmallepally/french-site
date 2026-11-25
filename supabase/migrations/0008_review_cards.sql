-- 0008_review_cards.sql
-- Daily review (docs/plans/review.md, sections 3 and 5): one row per user per vocabulary card,
-- holding its Leitner state. One transaction: if any check fails, nothing is changed.
--   * review_cards: box (0 = added, not yet reviewed; 1 to 5 = Leitner boxes), when it's due, when
--     it was last reviewed, and how many reviews and lapses ("Not yet") it has had. No card text:
--     the words come from the lesson content, by card id.
--   * The signed-in user can read and delete their own rows, and nothing else. Every write goes
--     through public.apply_review(jsonb), which checks ids, values and times, caps rows per user,
--     and merges idempotently. anon, authenticated and service_role have no direct insert or update.
-- Run after 0001 to 0007. Safe to run more than once.

begin;

-- ---------- 0. Preconditions ----------
do $$
begin
  if pg_catalog.to_regclass('auth.users') is null or pg_catalog.to_regprocedure('auth.uid()') is null then
    raise exception '0008: auth.users or auth.uid() is missing (is this a Supabase project?). Nothing was changed.';
  end if;
end;
$$;

-- ---------- 1. review_cards ----------
create table if not exists public.review_cards (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The card id is a vocab id: the earliest lesson's id for a word that repeats (review.md, decision 3).
  card_id text not null check (char_length(card_id) between 1 and 160 and card_id ~ '^[a-z0-9]+(-[a-z0-9]+)*-v[0-9]{1,6}$'),
  lesson_id text not null check (char_length(lesson_id) between 1 and 120),
  box smallint not null check (box between 0 and 5),
  due_at timestamptz not null,
  last_reviewed_at timestamptz,
  review_count integer not null default 0 check (review_count between 0 and 100000),
  lapse_count integer not null default 0 check (lapse_count between 0 and review_count),
  created_at timestamptz not null default now(),
  primary key (user_id, card_id),
  -- The lesson is the card id's prefix.
  constraint review_cards_lesson_prefix check (pg_catalog.left(card_id, pg_catalog.char_length(lesson_id) + 2) = lesson_id || '-v'),
  -- Box 0 is a card added but never reviewed; every other box has a last review.
  constraint review_cards_new_card check ((box = 0) = (last_reviewed_at is null) and (box <> 0 or review_count = 0))
);

comment on table public.review_cards is
  'Daily review: one Leitner card state per user and vocab card. Written only through apply_review(). No card text.';

alter table public.review_cards enable row level security;
alter table public.review_cards force row level security;

-- Read and delete own rows. No insert or update policy and no such grants: writes go only
-- through apply_review(), and RLS denies anything else by default.
drop policy if exists "review_cards: read own" on public.review_cards;
create policy "review_cards: read own" on public.review_cards
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "review_cards: delete own" on public.review_cards;
create policy "review_cards: delete own" on public.review_cards
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- 2. Privileges ----------
-- Supabase's default privileges grant new tables to anon, authenticated and service_role: take
-- them all back, then give authenticated read and delete only.
revoke all on table public.review_cards from public, anon, authenticated, service_role;
grant select, delete on table public.review_cards to authenticated;

-- ---------- 3. apply_review(p_items jsonb) ----------
-- Applies up to 200 card states for the caller, in order, and returns
--   {"applied": ["key", ...], "rejected": [{"key": "...", "code": "..."}, ...]}.
-- "applied" includes no-ops (a resent or older state): the client removes those from its outbox.
-- "rejected" entries can never succeed and are not retried.
--
-- Entry shape (times are ISO 8601 with a time zone, as sent; never clamped):
--   {"key", "cardId", "lessonId", "box", "dueAt", "lastReviewedAt" (null only when box is 0),
--    "reviews", "lapses"}
--
-- Checks: ids (card id <lesson-id>-v<digits>, and its prefix is lessonId); box 0 to 5; box 0 if
-- and only if lastReviewedAt is null, with 0 reviews; reviews 0 to 100,000 and lapses 0 to
-- reviews; lastReviewedAt no more than 24 hours ahead; dueAt within 24 hours for a new card and
-- within 400 days otherwise (the longest interval is 35 days); at most 6,000 cards per user,
-- checked only when inserting a new card.
--
-- Merge (idempotent; running an entry twice changes nothing): the state with the later
-- last_reviewed_at wins whole (box, due_at, last_reviewed_at); an equal time, or an unreviewed
-- entry (box 0) against a stored card, keeps the stored state; review_count and lapse_count take
-- the larger of the two.
--
-- security definer: the caller has no insert or update grant. The function runs as its owner,
-- which bypasses RLS, so the user id comes only from auth.uid() (never from the input) and every
-- statement filters on it explicitly. search_path is empty and every name is schema-qualified.
create or replace function public.apply_review(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_items constant int := 200;
  c_cap_cards constant int := 6000;
  c_max_ahead constant interval := interval '24 hours';
  c_max_due constant interval := interval '400 days';
  c_lesson_re constant text := '^[a-z0-9]+(-[a-z0-9]+)*$';
  c_time_re constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';

  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_applied jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_n_cards int; -- the caller's cards, counted once per call when first needed

  v_item jsonb;
  v_ord bigint;
  v_key text;
  v_code text;
  v_card text;
  v_lesson text;
  v_box int;
  v_due timestamptz;
  v_reviewed timestamptz;
  v_reviews int;
  v_lapses int;
  v_is_new boolean;
begin
  if v_uid is null then
    raise exception 'apply_review: not signed in' using errcode = '42501';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'apply_review: p_items must be a JSON array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_items) > c_max_items then
    raise exception 'apply_review: at most % entries per call', c_max_items using errcode = '22023';
  end if;

  for v_item, v_ord in
    select e.value, e.ordinality
      from pg_catalog.jsonb_array_elements(p_items) with ordinality as e (value, ordinality)
     order by e.ordinality
  loop
    v_key := coalesce(pg_catalog.left(v_item ->> 'key', 200), v_ord::text);
    v_code := null;
    v_reviewed := null;
    v_is_new := false;

    begin
      if pg_catalog.jsonb_typeof(v_item) is distinct from 'object' then
        v_code := 'bad_item';
      end if;

      -- Ids: a lesson id, and a card id that is that lesson's -v<digits>.
      if v_code is null then
        v_lesson := v_item ->> 'lessonId';
        v_card := v_item ->> 'cardId';
        if v_lesson is null or pg_catalog.char_length(v_lesson) not between 1 and 120 or v_lesson !~ c_lesson_re
           or v_card is null or pg_catalog.char_length(v_card) > 160
           or pg_catalog.left(v_card, pg_catalog.char_length(v_lesson) + 2) <> v_lesson || '-v'
           or pg_catalog.substr(v_card, pg_catalog.char_length(v_lesson) + 3) !~ '^[0-9]{1,6}$' then
          v_code := 'bad_id';
        end if;
      end if;

      -- Box and counts.
      if v_code is null then
        if pg_catalog.jsonb_typeof(v_item -> 'box') is distinct from 'number' then
          v_code := 'bad_box';
        else
          v_box := (v_item ->> 'box')::int;
          if v_box not between 0 and 5 then v_code := 'bad_box'; end if;
        end if;
      end if;
      if v_code is null then
        v_reviews := (v_item ->> 'reviews')::int;
        v_lapses := (v_item ->> 'lapses')::int;
        if v_reviews is null or v_lapses is null or v_reviews not between 0 and 100000 or v_lapses not between 0 and v_reviews
           or (v_box = 0 and v_reviews <> 0) then
          v_code := 'bad_count';
        end if;
      end if;

      -- Times: lastReviewedAt (null only for a new card) at most 24 hours ahead; dueAt bounded.
      if v_code is null then
        if v_box = 0 then
          if v_item -> 'lastReviewedAt' is not null and pg_catalog.jsonb_typeof(v_item -> 'lastReviewedAt') <> 'null' then
            v_code := 'bad_time';
          end if;
        elsif (v_item ->> 'lastReviewedAt') is null or (v_item ->> 'lastReviewedAt') !~ c_time_re then
          v_code := 'bad_time';
        else
          v_reviewed := (v_item ->> 'lastReviewedAt')::timestamptz;
          if v_reviewed > v_now + c_max_ahead then v_code := 'future_time'; end if;
        end if;
      end if;
      if v_code is null then
        if (v_item ->> 'dueAt') is null or (v_item ->> 'dueAt') !~ c_time_re then
          v_code := 'bad_time';
        else
          v_due := (v_item ->> 'dueAt')::timestamptz;
          if v_due > v_now + (case when v_box = 0 then c_max_ahead else c_max_due end) then v_code := 'future_time'; end if;        end if;
      end if;

      -- The per-user cap, checked only for a new card.
      if v_code is null then
        perform 1 from public.review_cards as rc
          where rc.user_id = v_uid and rc.card_id = v_card
          for update;
        v_is_new := not found;
        if v_is_new then
          if v_n_cards is null then
            select pg_catalog.count(*) into v_n_cards from public.review_cards as rc where rc.user_id = v_uid;
          end if;
          if v_n_cards >= c_cap_cards then v_code := 'cap_reached'; end if;
        end if;
      end if;

      if v_code is null then
        insert into public.review_cards as rc
          (user_id, card_id, lesson_id, box, due_at, last_reviewed_at, review_count, lapse_count)
        values
          (v_uid, v_card, v_lesson, v_box, v_due, v_reviewed, v_reviews, v_lapses)
        on conflict (user_id, card_id) do update set
          -- The later review wins whole; a tie or an unreviewed entry keeps the stored state.
          box = case when excluded.last_reviewed_at > rc.last_reviewed_at or (rc.last_reviewed_at is null and excluded.last_reviewed_at is not null)
                     then excluded.box else rc.box end,
          due_at = case when excluded.last_reviewed_at > rc.last_reviewed_at or (rc.last_reviewed_at is null and excluded.last_reviewed_at is not null)
                        then excluded.due_at else rc.due_at end,
          last_reviewed_at = case when excluded.last_reviewed_at > rc.last_reviewed_at or (rc.last_reviewed_at is null and excluded.last_reviewed_at is not null)
                                  then excluded.last_reviewed_at else rc.last_reviewed_at end,
          review_count = greatest(rc.review_count, excluded.review_count),
          lapse_count = greatest(rc.lapse_count, excluded.lapse_count)
        where rc.user_id = v_uid
          and (excluded.last_reviewed_at > rc.last_reviewed_at
               or (rc.last_reviewed_at is null and excluded.last_reviewed_at is not null)
               or excluded.review_count > rc.review_count
               or excluded.lapse_count > rc.lapse_count);

        if v_is_new then
          v_n_cards := v_n_cards + 1;
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

comment on function public.apply_review(jsonb) is
  'The only write path for review_cards. See docs/plans/review.md, section 5.';

-- ---------- 4. Who may call it ----------
-- Postgres grants execute on new functions to PUBLIC, and Supabase's default privileges grant it
-- to anon, authenticated and service_role. Remove all of them, then allow authenticated only.
revoke all on function public.apply_review(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.apply_review(jsonb) to authenticated;

commit;
