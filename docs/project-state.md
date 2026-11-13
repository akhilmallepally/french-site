# Project state (as of 13 November 2026)

## 1. The site, the stack and the scripts
Parlons is a free, text-only site that teaches French to English speakers from A1 to C1 (C2 later), through lessons with vocab tables, dialogues and exercises. It's built with Next.js 16 (App Router, TypeScript, Tailwind v4, no src/). Lessons are MDX files in content/lessons/<level>/<slug>.mdx, parsed with gray-matter and rendered with next-mdx-remote/rsc. All file reading goes through lib/lessons.ts. Supabase (auth, progress, spaced repetition) comes later. The folder is c:\Users\akhil\Documents\french-site and the repo is github.com/akhilmallepally/french-site. To deploy, commit to master and push; the live site on Vercel builds from master (confirm the Vercel settings if unsure). Read CLAUDE.md first: it holds every writing rule.

| Script | What it checks |
|---|---|
| validate:content | Frontmatter, unique ids, prerequisites and LessonLink targets. Runs before every build. |
| test:content | Tests for the validator itself (planned ids are allowed in related and LessonLink, but not in prerequisites). |
| test:checker | Tests for lib/check-answer.ts, which normalizes accents, capitals, punctuation and apostrophes, and flags a missing accent. |
| audit:content | Rewrites docs/all-data.md and docs/audit-report.md. Checks length, callouts, prerequisites, strictAccents, answers against their options and reorder chips, tips with the same title, and stale "Coming soon" links. It never fails: read the summary table. |
| check:words | Lists French words in examples, dialogues and exercises with no vocab entry in this or an earlier lesson. You can filter it by level or lesson id. |
| check:structures | B1 and B2 (B2 rules added for every B2 grammar point). Lists grammar used before the lesson that teaches it: subjunctive, conditionnel, plus-que-parfait, gérondif, passive, double pronouns, dont, ce qui/que, lequel, ne… que and ni… ni, demonstrative and possessive pronouns, reported speech. |
| build | next build (after validate:content). |
| scripts/b2-wrapup.ts | One-off B2 cross-level audit (run with `node --experimental-strip-types scripts/b2-wrapup.ts`): link targets, forward links, vocab and sentence repeats, "you know X" claims, per-unit statistics and limits. Writes docs/b2-wrapup.md. |

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
- **B2 has no fluent-speaker check yet.** docs/b2-reviewer-brief.md lists 229 items (85 High), and docs/review/b2-unit-1.txt to b2-unit-8.txt hold the lesson files for the reviewer.
- **The four new B2 exercise types aren't browser-tested.** docs/b2-browser-test.md lists 12 exercises to try.
- **The B1 review is still pending** (docs/reviewer-brief.md has no answers recorded).
- **B1 fixes from the live-page review:** done locally on 10 November and passing every check, but **not committed or pushed**.
  - conditionnel stems
  - subjonctif-irregular warning, dialogue line and *falloir* sentence
  - double-pronoun rule
  - formal-email *suite à*
  - plus-que-parfait *auparavant* sentence
- **docs/batch-review.md** (vocab and exercises of 10 B1 lessons): written and untracked, still waiting to be reviewed.
- **13 B1 grammar lessons not yet read on the live site:** open.
- **docs/reviewer-brief.md** (402 claims for a native speaker): written, with edits not yet committed. It has no answers recorded yet.
- **Phone check and learner tests:** no record in the repo. Treat as not started.

## 6. Status
- **Levels written:** A1 (49 lessons), A2 (56), B1 (59) and B2 (59 lessons in 8 units) are written. B2 is planned in docs/plans/b2/ and logged in docs/b2-writing-log.md. C1 isn't started.
- **C1 link to restore:** b2-review-final ends with plain text about the passé simple; once c1-passe-simple exists, turn it back into a LessonLink.
- **Next stage:** write the C1 conventions in CLAUDE.md (and the checks behind them), then plan C1 unit by unit, as for B2.
- **Last commit:** e7db04a, "Write B2 Unit 8" (local). Check `git status` for what has been pushed.
- **Not committed:** the B2 wrap-up (scripts/b2-wrapup.ts, docs/b2-wrapup.md, docs/b2-reviewer-brief.md, docs/b2-browser-test.md, docs/review/, and four small claim fixes).

## 7. How work is split
- **The assistant** writes the prompts, reviews the live pages and the exported data (all-data.md, batch-review.md), and decides what to fix.
- **Claude Code** writes and edits the files, runs every check, and reports. It never commits; the owner commits and pushes.
