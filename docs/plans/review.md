# Daily review: plan

Status: decisions recorded (Prompt 69, section 9). Rollout step 1, migration 0008, is written (supabase/migrations/0008_review_cards.sql) but not yet run in Supabase. No app code or content has changed.

Goal: a `/review` page with a short daily session of spaced-repetition vocabulary cards, which turns the home "Daily review" card into a link. v1 stays simple.

## 0. Audit (facts, 26 November 2026)

- **saved_vocab is unused.**
  - No app, component or lib code reads or writes it, and no UI lets learners save words. It appears only in 0002 (the table), 0003 (RLS) and supabase/tests/rls.sql.
  - Columns: `user_id` (→ auth.users, on delete cascade), `vocab_id` (1 to 160 characters), `lesson_id` (1 to 120 characters) and `saved_at`. The primary key is `(user_id, vocab_id)`.
  - RLS is enabled and forced, with three policies: read own, insert own and delete own. There's no update policy and no update grant, so a row can be saved or unsaved, never edited. 0006 didn't touch it, so authenticated users can still insert and delete their own rows directly.
- **Vocab is frontmatter, not markdown tables.**
  - Each lesson has a `vocab:` list of `{ id, fr, pron, en, group?, note? }`, rendered by `<VocabTable />` or `<VocabTable group="…" />` (components/mdx.tsx).
  - `fr` carries the article, so it carries the gender: 2,319 entries start with le/la/l'/les/un/une/des, and 190 start with an elided `l'`, which hides the gender.
  - 756 `fr` values hold variants or pairs ("la pertinence / pertinent"). `en` is short (median 18 characters, 90th percentile 37) and often has several glosses ("hello / good day").
  - 832 entries have a `note`. There are no example sentences per item: examples live in the lesson text.
- **Counts:**
  - 5,228 items: A1 805, A2 663, B1 868, B2 1,028, C1 902, C2 962.
  - 373 of them are B2 to C2 glossary entries (`group: "glossary"`, reading aids for longer texts).
  - That leaves 4,855 card candidates: A1 805, A2 663, B1 868, B2 985, C1 824, C2 710.
  - 81 candidates repeat a French entry from an earlier lesson (4,774 distinct). A lesson has a median of 15 candidates and at most 38.
- **Stable ids already exist.** Every item has an explicit id `<lesson-id>-v001`, written in the frontmatter (not derived from position). validate:content already checks the format and uniqueness site-wide (check 9), so no content change is needed for ids. What's missing is a guard that a published id is never removed or renamed: section 7.

## 1. Card source

**Recommendation: automatic, from lessons the learner has practised.**
- A lesson's non-glossary vocab joins the learner's deck once they've answered at least one of its exercises or finished a run. Opening a lesson isn't enough, because learners skim.
- New cards are introduced in course order (lesson order, then vocab order), at most 10 a day (section 3).
- Repeated words follow decision 3 (section 9): 4,855 eligible entries make 4,817 cards.
- Alternatives:
  - *Manual* (a "save" button on vocab rows, into saved_vocab): more control, but a new UI on every vocab table, and learners rarely curate. Better as a v2 addition ("star a word to see it sooner").
  - *Both*: the most flexible, and twice the work in v1.

## 2. Card format

**Recommendation: French → English, self-graded.**
- The front shows `fr`, with `pron` underneath.
- "Show answer" reveals `en`, plus the `note` if there is one.
- The learner then presses "I knew it" or "Not yet".
- **Gender is shown, not tested:** the article in `fr` shows it. For the 190 `l'` entries the gender isn't visible, which is acceptable for v1 (open question 4).
- Alternatives:
  - *English → French* is harder and a better test of recall, but `en` often has several glosses and `fr` has variants, so it needs care. v2, as a second side of the same card.
  - *Typed answers* (with the existing answer checker): honest, but the variants and pairs ("a / b") make strict checking frustrating. v2 at the earliest, for single-word items.

## 3. Scheduling

**Recommendation: Leitner, 5 boxes**, with intervals of 1, 3, 7, 16 and 35 days.
- "I knew it" moves the card up one box (box 5 stays in 5). "Not yet" moves it back to box 1, and it comes back once more at the end of the same session.
- A card is due when `due_on ≤ today`, in the learner's local date.
- **Daily limits:**
  - 10 new cards a day.
  - At most 60 reviews a day, most overdue first; the rest wait until tomorrow.
  - A session is 20 cards (about 5 to 8 minutes at 15 to 20 seconds a card), with an "Another 20" button while cards are due.
- Alternatives:
  - *SM-2* adapts the intervals per card (ease factors), but it needs a 4-button grade and has tuning pitfalls.
  - *FSRS* schedules best, but it's a model with parameters and the most to explain and test.
  - Leitner is easy to reason about, test and explain. The state stored per card is the same either way (box or interval, due date, last review), so a later switch is a data migration, not a redesign.

## 4. Access

- **Free levels (A1, A2):** for everyone, signed in or not.
- **Paid levels (B1 to C2):** only with access. That's the same entitlement check as the lessons: at least one active purchase.
  - Card text (`fr`, `en`, `note`) for paid lessons is sent only to learners with access, by a server action that checks the session and entitlement.
  - A learner without access can't add paid lessons to their deck anyway, since they can't practise them.
  - If access ends (refund, dispute), paid cards are hidden and not scheduled; nothing is deleted.
- **Signed out:** cards live in the browser (localStorage), and no login is needed. They follow the progress import rules when the learner signs in (section 5).

## 5. Storage and sync

**Recommendation: a new table, `review_cards`, written only through an `apply_review()` security-definer function, reusing the progress sync design.** That means the same outbox, facade, `NEXT_PUBLIC_PROGRESS_SYNC` flag and import rules (docs/plans/progress.md, sections 6 to 8).

- **Table (as built in 0008):** `review_cards (user_id uuid, card_id text, lesson_id text, box smallint 0–5 (0 = added, not yet reviewed), due_at timestamptz, last_reviewed_at timestamptz (null only in box 0), review_count int, lapse_count int, created_at timestamptz)`.
  - The primary key is `(user_id, card_id)`.
  - A check keeps `lesson_id` equal to the card id's prefix.
  - The cap is 6,000 cards per user (4,817 cards today, plus about a 25% margin).
  - The text below was written before 0008; where they differ, 0008 wins.
  - Primary key `(user_id, vocab_id)`.
  - There's no lesson_id: it's the prefix of the vocab id, which validate:content already guarantees.
  - RLS: read own and delete own only, with no insert or update grant.
- **apply_review(p_items jsonb):**
  - The user id comes only from `auth.uid()`.
  - It checks the id format (`<lesson-id>-v<digits>`), box 1 to 5, counts 0 to 10,000, and times (ISO, rejected if more than 24 hours ahead, never clamped).
  - It caps each user at 6,000 cards.
  - It merges idempotently: the record with the later `last_reviewed_at` wins whole, and an equal time keeps the stored row, as for writing tasks in 0006. A resent entry is a no-op.
  - The server action also checks every id against a server-side vocab index, and refuses paid-level ids without access.
- **Client:**
  - A `review` key namespace (`r:<vocabId>`) in the same outbox, sent by the same flusher, in batches of 200 entries and 120 KiB at most.
  - The cache is in `parlons-progress-v1:u:<userId>` under a new `reviewCards` field, or in a sibling key.
  - Signed-out cards live in the anonymous store, and signed-in cards made in local mode go under the account (`local:<userId>`), exactly as for progress.
  - The import claim applies.
- **Why not saved_vocab:** it has no scheduling columns and no update grant, and it was meant for "save a word". Keep it for a v2 manual source.
- **Size estimate:** about 230 B per card row. That's about 100 B of heap and 75 B of primary-key index, ×1.3 for dead rows, worked out the same way as docs/plans/progress.md section 4.

  | Learner | Cards | Size |
  |---|---|---|
  | Typical (20 lessons × about 15 cards) | 300 | ~69 KB |
  | A daily learner after a year (at most 10 new a day) | up to 3,650 | up to ~840 KB |
  | Everything | 4,855 | ~1.1 MB |

  **1,000 users:**
  - Typical (300 cards each): about 69 MB of cards, plus about 70 MB of progress (about 70 KB each at 20 lessons), plus the 13 MB used now: about 152 MB of the free plan's 500 MB.
  - The worst case (1,000 users with every card) would be about 1.1 GB. The 10-a-day limit makes that take over a year of daily use, and the 6,000-card cap bounds one account. The database-size SQL (progress.md 13.4) gets a `review_cards` row, and the owner checks it monthly.
- **Alternatives:**
  - *Store review state inside saved_vocab:* needs new columns, an update path and a new write function anyway, and mixes two meanings.
  - *localStorage only, no sync:* the simplest, but cards wouldn't follow the learner across devices, unlike the rest of their progress.

## 6. Pages and UI

- **/review empty state:** "Practise a lesson to add its words to your review.", with a link to /practice (decision 7).
- **/review:**
  - A static shell, with client-side state from the review store, read at once from local data. The server's copy updates it in place, as on /progress.
  - **Header:** "N cards due today", or "All done for today, come back tomorrow" with the next due date.
  - **Session:** one card at a time, in a fixed-size card (no layout shift), with "Show answer", then "Not yet" and "I knew it", and a progress bar such as "7 / 20".
  - **Summary:** knew / not yet, the cards learned (box 3 or higher), the next session's due count, and links back to /progress and /practice.
  - **Card text:** free cards come from a static per-level JSON (A1 and A2 vocab is already public on their lesson pages). Paid cards come from a server action that checks access. Text already fetched is cached locally per user.
- **Home:** the "Daily review" card links to /review, styled like the "Clear lessons" and "Practice" cards ("Ten minutes a day with the words from your lessons."). No count on the home page, which stays static.
- **/progress:** one line at the top: "12 cards due today → Review" (client-side, a reserved height).
- **Keyboard:**
  - Space or Enter shows the answer.
  - 1 or J means "Not yet"; 2 or K means "I knew it".
  - Focus stays on the card, and the buttons are real buttons with visible focus.
  - Each new card is announced through a polite live region.
- **Mobile:** large buttons at the bottom of the card (thumb reach), and the card height fixed per breakpoint.
- **Out of scope for v1:** audio, English → French, typed answers, manual saving, streaks.

## 7. Content checks (validate:content)

- Vocab ids keep today's format and site-wide uniqueness.
- **New, stability:** a committed `lib/generated/vocab-ids.json` (ids in course order, ids only, built like progress-index.json). validate:content fails if a published id disappears or moves to another lesson, and prints the regenerate command. Adding ids is fine.
- **New:** `fr`, `en` and `pron` are present and non-empty (fr and en are already required by the parser, so the check is cheap). ids are at most 160 characters (the database limit). The card-eligibility rule (not `group: "glossary"`) is counted, and the totals are printed: 4,855 today.
- **New, warning only:** an `l'` entry with no gender `note` (190 today), listed for an optional content pass (open question 4).

## 8. Rollout (one prompt each, as for progress)

1. **Migration 0008:** `review_cards`, `apply_review()`, RLS and grants, rollback, rls.sql extended (own rows only, caps, idempotency, the 24-hour rule), db-setup.md. The owner runs it.
2. **Content ids and validation:** vocab-ids.json, the stability and eligibility checks, a server-only vocab index for card text, the per-level free card JSON, and tests.
3. **Scheduler and local store:** pure Leitner (lib/review-scheduler.ts) with tests (box moves, due dates in the local date, daily limits, ordering), and the local review store behind an interface like `ProgressStore`, with legacy-safe storage.
4. **Sync:** the review entries in the outbox, the `syncReviewAction` and `getReviewAction` server actions (access-checked card text), the facade reuse, the import and local-attribution rules, tests, and check-progress-db extended.
5. **Pages:** /review (session, summary, keyboard, mobile, no layout shift), the home card link, the due line on /progress, gating checks (paid card text never sent without access), and HTTP checks.
6. **Wrap-up:**
   - test:progress-e2e gets a session (review, refresh, sync row, second device).
   - test:prod-smoke gets a session plus cleanup.
   - The preview checklist and size SQL get `review_cards`.
   - docs/project-state.md is updated.

## 9. Decisions (owner, Prompt 69)

1. **Source:** v1 cards are automatic only, from the vocab of lessons the learner has practised (at least one answered exercise or a finished run). Manual saving (saved_vocab) comes later.
2. **Glossary:** the 373 glossary reading aids (`group: "glossary"`) are excluded.
3. **Repeated words:** entries become one card only when both the French and the English match after normalising. Otherwise they stay separate cards. 38 entries merge today, giving 4,817 cards.
   - **Normalising:** Unicode NFC, lower case, curly apostrophes become `'`, the characters `. , ; : ! ? … " « » ( ) [ ]` become spaces, runs of spaces become one, and both ends are trimmed. Accents, hyphens and apostrophes are kept, because they change meaning.
   - **Card id:** the vocab id of the earliest matching entry in course order when the card is first published. It's recorded in a committed card map (rollout step 2) and never changes after that.
     - A later matching entry joins the existing card.
     - If an edit makes entries stop matching, the existing card keeps its id, and the entry that split off becomes its own card under its own vocab id.
     - A card id is always a real vocab id, so its lesson is the id's prefix, which 0008 checks.
4. **Gender:** none for the 190 `l'` entries in v1. Gender notes are a later content task, with native review.
5. **Limits:** 10 new cards a day, at most 60 reviews a day, 20 cards per session, and a "Do another 20" button while more cards are due.
6. **Format:** French → English only, self-graded ("I knew it" / "Not yet"). "Not yet" sends the card back to box 1. The Leitner intervals are 1, 3, 7, 16 and 35 days.
7. **Empty state on /review:** "Practise a lesson to add its words to your review.", with a link to /practice.
