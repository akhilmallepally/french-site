# Project state (as of 14 November 2026)

## 1. The site, the stack and the scripts
Parlons is a free, text-only site that teaches French to English speakers from A1 to C1 (C2 later), through lessons with vocab tables, dialogues and exercises. It's built with Next.js 16 (App Router, TypeScript, Tailwind v4, no src/). Lessons are MDX files in content/lessons/<level>/<slug>.mdx, parsed with gray-matter and rendered with next-mdx-remote/rsc. All file reading goes through lib/lessons.ts. Google sign-in through Supabase gates B1 and above: A1 and A2 are free, and other levels show their lesson body only after a server-side getUser() check (docs/auth-setup.md); tables and RLS are written in supabase/ (docs/db-setup.md) but not run yet. Saving progress to Supabase and spaced repetition come later. The folder is c:\Users\akhil\Documents\french-site and the repo is github.com/akhilmallepally/french-site. To deploy, commit to master and push; the live site on Vercel builds from master (confirm the Vercel settings if unsure). Read CLAUDE.md first: it holds every writing rule.

| Script | What it checks |
|---|---|
| validate:content | Frontmatter, unique ids, prerequisites and LessonLink targets. Runs before every build. |
| test:content | Tests for the validator itself (planned ids are allowed in related and LessonLink, but not in prerequisites). |
| test:checker | Tests for lib/check-answer.ts, which normalizes accents, capitals, punctuation and apostrophes, and flags a missing accent. |
| audit:content | Rewrites docs/all-data.md and docs/audit-report.md. Checks length, callouts, prerequisites, strictAccents, answers against their options and reorder chips, tips with the same title, and stale "Coming soon" links. It never fails: read the summary table. |
| check:words | Lists French words in examples, dialogues and exercises with no vocab entry in this or an earlier lesson. You can filter it by level or lesson id. |
| check:structures | B1 and B2 (B2 rules added for every B2 grammar point). Lists grammar used before the lesson that teaches it: subjunctive, conditionnel, plus-que-parfait, gérondif, passive, double pronouns, dont, ce qui/que, lequel, ne… que and ni… ni, demonstrative and possessive pronouns, reported speech. |
| build | next build (after validate:content). |
| test:b2-exercises | scripts/b2-exercise-check.ts: every accepted answer of the B2 reformulation, register-shift, error-correction, connector-choice and reorder exercises passes lib/check-answer.ts, and the starting sentence or wrong options do not (316 exercises, 0 failures). |
| scripts/b2-links-ids.ts | B2 LessonLink targets exist, vocab ids follow display order, and each lesson's unit matches the syllabus (run with `node --experimental-strip-types scripts/b2-links-ids.ts`). |
| scripts/b2-wrapup.ts | One-off B2 cross-level audit (run with `node --experimental-strip-types scripts/b2-wrapup.ts`): link targets, forward links, vocab and sentence repeats, "you know X" claims, per-unit statistics and limits. Writes docs/b2-wrapup.md. |
| scripts/c1-wrapup.ts | C1 cross-level audit (run with `node --experimental-strip-types scripts/c1-wrapup.ts`): links, prerequisites and syllabus order, "you know X" claims, vocab, sentence and callout-title repeats, quotations, every date, recurring invented names, per-unit statistics and limits. Writes docs/c1-wrapup.md. |
| check:c1-links | C1 LessonLink and related targets exist, and no row of docs/c1-forward-links.md points to a lesson that now exists. |
| check:alexandrines | scripts/scan-alexandrines.ts: counts the syllables of the original poem in c1-culture-french-poetry with the classical rules (mute e, diaeresis list, caesura); `--test` checks known lines. |

audit:content also has B2 rows: lengths, En résumé, the exercise mix, A1 to B1 vocab repeats (NEW_MEANINGS), copied sentences and tips, the passé simple, dropped *ne* before lesson 53, longer-text length, and vocab used in a complete sentence. check:words has B2 lists in scripts/b2-lists.ts (COGNATES, NEW_MEANINGS, the instruction words).

## 2. Decisions and why
- **B1 conventions** (in CLAUDE.md):
  - Teaching text is in English, and every French line is translated.
  - Teaching text is 600 to 800 words (900 for grammar), and the whole lesson stays under 1300.
  - Each lesson has 12 to 25 vocab entries, 12 to 14 exercises (at least two production tasks and one reorder) and 8 to 10 dialogue lines.
  - Each communication lesson has one longer text.
  - Why: B1 learners need enough reading per lesson and real practice, without the lessons becoming walls of text.
- **Review lessons** add only 3 to 8 new words, all used in the model, the task or an exercise. Why: reviews are for recycling, and the earlier reviews had grown big new word lists.
- **Teaching-text counting** (scripts/lesson-text.ts) counts everything except vocab tables, the "En français" dialogue and longer-text sections (sections where at least 60% of lines are French text lines). Callouts always count. That's why teaching bullets must start with English.
- **Lessons 21 and 22 swap.** Irregular subjunctives now come before the necessity lesson. Why: the necessity lesson needed every verb, including the irregular ones. Lesson 20 uses *il faut que* only as a frame.
- **b1-formal-email moved to Unit 8** (lesson 51), just before the complaint lesson (52). Why: the complaint and the Unit 8 review are written as formal emails.
- **Respellings** follow the key in CLAUDE.md:
  - hyphenated syllables, with the stressed syllable in capitals (lowercase for one-syllable entries)
  - fixed vowel codes (ay, eh, ehr, uh, ew), nasals an/ahn/ohn/uhn, non-nasal onn/omm
  - liaison moves the consonant to the next word, and *c'est* = seh
  - respellings go in `pron` only

- **B2 conventions** (in CLAUDE.md, "B2 conventions" and "Self-audit"):
  - Teaching text 800 to 1,100 words (1,200 for grammar), whole lesson under 1,800; 15 to 30 vocab (12 to 30 in grammar, 3 to 8 in reviews); 14 to 16 exercises with 3 production, 1 reorder and 1 reformulation; dialogues of 10 to 14 lines; longer texts of 150 to 250 French words with a glossary.
  - Exercise instructions in French from a fixed list; four new typed or choice exercise types (reformulation, register-shift, error-correction, connector-choice).
  - Grammar and vocabulary lessons end with an En résumé in plain French (60 to 100 words in Units 1 to 4, 100 to 150 in Units 5 to 8).
  - Answer coverage: every valid answer from taught material, or a pinned cue. Claims verified against the linked lesson; no always/never claims; fixed phrases glossed.
  - Self-audit: contrasts use differing forms; dialogues obey the lesson's own rules; every vocab entry is used in a complete sentence; one narrative tense per paragraph; rules of thumb are called so.
  - Spoken features in typed answers only from lessons 53 and 54, and only when the instruction asks; the passé simple is recognition only.
  - Why: B2 learners need precision and nuance, and the earlier units showed which defects recur.

## 3. Recurring defects and what now prevents them
- **Word used before it's defined:** check:words, and the rule to define a word at first use.
- **Grammar used before its lesson:** check:structures, plus labelled fixed phrases listed in docs/review-needed.md.
- **Missing strictAccents on a/à, ou/où and parle/parlé:** the two strictAccents checks in audit:content.
- **Answers that differ only by accents, capitals or punctuation:** the audit check, and the checker's normalization.
- **A multiple-choice answer not among its options, or reorder chips that don't match the answer:** audit:content.
- **Teaching text too short or too long, or French-led bullets miscounted as text:** the length check in audit:content and the bullet rule in CLAUDE.md.
- **LessonLinks that credit the wrong lesson or a review:** the CLAUDE.md link rule (manual check).
- **Too many prerequisites, or implied ones:** the more-than-six check in audit:content and the prerequisite rule.
- **Repeated tips:** the same-title check in audit:content. Repeated ideas are a manual check: compare with earlier tips.
- **Gender-dependent answers, distractors that are grammatical alternatives, dialogue lines the next speaker can't answer, mixed tu/vous:** CLAUDE.md rules (manual).
- **Uncertain facts and legal amounts:** facts go in docs/review-needed.md, and the plans leave legal figures out.

## 4. Known non-defects (don't re-report)
- **Duplicate vocab across lessons:** about 65 cases, informational only. Some are deliberate new meanings: *un bouchon*, *une pièce*, *un billet*, *le dîner*.
- **Accent pairs like la/là, du/dû, des/dès, sur/sûr:** strictAccents can stay false for these.
- **The check:words A1/A2 backlog:** 110 words (46 in A1, 64 in A2). B1 is at 0.
- **Audit false positives:**
  - "No reorder exercise" (6): the alphabet and recognition lessons are exempt.
  - "More than five accepted answers" (2): deliberate.
- **check:structures and check:words are heuristics:** irregular forms go in their IGNORE and NOT_* lists.

- **B2 audit rows:** b2-purpose-expressions ex014 has 6 accepted answers (deliberate). The b2-wrapup judgement calls are listed at the top of docs/b2-wrapup.md.

## 5. Open items
- **B2 browser test:** docs/b2-browser-test.md (the four new exercise types, the repeated-word reorder, one lesson per unit at phone width). Not run yet.
- **C1 native-speaker review:** docs/c1-reviewer-brief.md and docs/c1-review-items.md (309 items, 22 possibly resolved), with the lessons in docs/review/c1-unit-1.txt to c1-unit-8.txt. Not started.
- **B2 native-speaker review:** docs/b2-reviewer-brief.md and docs/b2-review-items.md (253 items, 59 possibly resolved), with the lessons in docs/review/b2-unit-1.txt to b2-unit-8.txt. Not started.
- **C1 forward links:** none remain; docs/c1-forward-links.md keeps the history, and `npm run check:c1-links` fails on any link to a missing lesson.
- **B1 review still pending:** docs/reviewer-brief.md has no answers recorded, and 13 B1 grammar lessons are still unread on the live site.
- **Phone check and learner tests:** not started.

## 6. Status
- **Auth:**
  - Done: gating, the sign-in page, a safe `next` redirect, and the header states.
  - Proven by `npm run test:gating` (124 gated lessons, 0 leaks in HTML, RSC, prefetch, segments, `.next/static` and the prerendered files) and `npm run test:safe-next`.
  - Manual steps (private repo, Supabase and Google URLs, Vercel env vars) and the known limits are in docs/auth-setup.md.
  - Merged to master (PR #1).
- **Database (branch `db`, uncommitted; auth prompt 3):**
  - Written, not yet run: `supabase/migrations/0001` to `0004` (profiles with a sign-up trigger; lesson_progress, exercise_results, lesson_scores, saved_vocab mirroring lib/progress.ts; RLS enabled and forced, own-rows-only policies, no anon access; `touch_last_active()`), `supabase/tests/rls.sql` (every table and operation, two users and anon, ends in rollback) and `supabase/rollback/rollback_all.sql` (deletes user data).
  - How to run them, the expected test output, the dashboard checks and what each table stores: docs/db-setup.md.
  - Fail-safe: with the Supabase variables missing, proxy.ts skips the refresh and warns once, `getCurrentUser()` returns null on missing config or any error (fail closed), and the header shows "Sign in". Proven by `npm run test:no-supabase-env` (it leaves a no-config build in `.next`; rebuild afterwards).
  - Next: run the SQL and the RLS test in Supabase, then the SupabaseProgressStore, server actions, the dashboard and the localStorage import.
- **Levels written:** A1 (49 lessons), A2 (56), B1 (59), B2 (59) and C1 (57).
- **C1:** written, wrapped up, awaiting native review. Eight units, 57 lessons (8, 9, 8, 7, 6, 6, 6, 7), written unit by unit in Prompts 28 to 38 and wrapped up in Prompt 39. Conventions and the grouped C1 checklist in CLAUDE.md; plans in docs/plans/c1/; coverage map docs/c1-coverage.md; history in docs/c1-writing-log.md. Wrap-up: `node --experimental-strip-types scripts/c1-wrapup.ts` writes docs/c1-wrapup.md (judgement calls at the top, from scripts/c1-wrapup-judgements.md; mechanical failures 0). Native review: docs/c1-reviewer-brief.md and docs/c1-review-items.md (309 items, 22 possibly resolved), lessons in docs/review/c1-unit-1.txt to c1-unit-8.txt. Verse: scripts/scan-alexandrines.ts (`npm run check:alexandrines`).
- **B2 units:** 1 Nuance and society (lessons 1 to 8), 2 What might have been (9 to 15), 3 News and reporting (16 to 25), 4 Precision with pronouns (26 to 31), 5 Work and the economy (32 to 40), 6 Science and health (41 to 45), 7 Culture and the arts (46 to 52), 8 Registers and debate (53 to 59). Plans in docs/plans/b2/, history in docs/b2-writing-log.md.
- **Baselines:** check:words 110 (the A1/A2 backlog; B1, B2 and C1 at 0), check:structures 0, test:checker 29 tests, test:b2-exercises (B2 and C1) 0 failures, b2-links-ids 0 failures, check:c1-links 0 failures, check:alexandrines 8/8, c1-wrapup 0 mechanical failures. The audit's informational rows: 73 shared vocab texts, 4 exercises with more than five answers, 6 lessons without a reorder (all A1/A2).
- **Last commit:** check `git log`; the B2 review fixes and the wrap-up (Prompts 21 to 25) are not committed.
- **C2:** planned in Prompt 40 (docs/plans/c2/overview.md, 46 lessons in 8 units; open questions at the top, including the writing-task question); coverage in docs/c2-coverage.md (scripts/c2-lists.ts, scripts/c2-find.ts); log in docs/c2-writing-log.md. Not yet approved.
- **Next steps, in order:** (1) the C1 native-speaker review (docs/c1-reviewer-brief.md); (2) the B2 native-speaker review; (3) the B1 review, including the 13 unread B1 grammar lessons; (4) phone and learner tests; (5) C2 planning.

## 7. How work is split
- **The assistant** writes the prompts, reviews the live pages and the exported data (all-data.md, batch-review.md), and decides what to fix.
- **Claude Code** writes and edits the files, runs every check, and reports. It never commits; the owner commits and pushes.
