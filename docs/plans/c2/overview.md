# C2 plan: overview

Status: **plan only, awaiting review.** No lesson files exist. The conventions below are a draft for CLAUDE.md, not yet in it.

## Open questions (please decide before writing)

1. **Size.** 46 lessons in 8 units (7, 6, 5, 6, 6, 5, 6, 5), with one review per unit and a final review. The brief asked for 45 to 55. More lessons would mean thinner units: is 46 right, or should Unit 3 (specialized French) or Unit 7 (literatures) grow?
2. **Units.** Is "Mediation and negotiation" (Unit 6) worth its own unit on a text-only site? The alternative is to fold mediation into Unit 5 and negotiation into Unit 3, and give Unit 7 a lesson on the history of the press or on theatre.
3. **Open writing (the main question).** C2 is mostly long writing: commentary, contraction, essay, version and thème. Typed keys can't grade these fairly. Options:
   - **A. A `writing-task` exercise type, ungraded** (recommended). The learner writes in a text box; the site shows a word count, then a model answer and a self-check list ("Did you keep the author's order?", "Is every view attributed?"); the learner ticks the list and marks the task done. Nothing is scored. Needs in the site code:
     - a new type in the exercise schema and in scripts/validate-content.ts, allowed at C2 only, with fields `prompt`, `model`, `checklist` (3 to 6 items), optional `wordTarget` (a range);
     - a component that renders a textarea, a live word count (counting the French way, so the rule must be written once), "Show the model" and the checklist;
     - lib/check-answer.ts skips it; the progress store records "completed" and the ticked items, not a score; the lesson score ignores it;
     - test:b2-exercises skips it; audit:content checks that each one has a model and a checklist, and counts it outside the production quota.
   - **B. Keyed sub-steps only.** Break each long task into gradable steps (choose the problématique, order the plan, pick the best transition, fill the missing link word) and give no free writing. Fair, but it never makes the learner write a long text.
   - **C. Both** (recommended in practice): keyed sub-steps for the method, plus one writing task per lesson at most.
4. **Translations at C2.** Should longer texts still carry a full English translation, or a summary only? A full translation keeps the course consistent and helps the reviewer; a summary would leave room for longer French texts. The draft below keeps full translations.
5. **Recognition-only material.** Old and Middle French (Unit 7), the literary concordance of the subjunctive (Unit 1, lesson 5) and the traditional vs 1990 spellings (Units 1 and 2) are planned as recognition only, with both spellings accepted in keys. Agree?
6. **Exam practice.** C1 ended with DALF C1 practice. C2 has no exam-practice lessons: the skills (commentary, contraction, essay, mediation) are taught for their own sake, and no lesson names any exam. Is that right, or should Unit 8 include practice?

## Shape

46 lessons in 8 units. Types: grammar 6, vocabulary 10, communication 15, culture 6, review 9.

| Unit | Title | Lessons | Count | Plan file |
|---|---|---|---|---|
| 1 | Precision in form | 1 to 7 | 7 | unit-1.md |
| 2 | Words with precision | 8 to 13 | 6 | unit-2.md |
| 3 | Specialized French | 14 to 18 | 5 | unit-3.md |
| 4 | Reading between the lines | 19 to 24 | 6 | unit-4.md |
| 5 | Writing at length and translating | 25 to 30 | 6 | unit-5.md |
| 6 | Mediation and negotiation | 31 to 35 | 5 | unit-6.md |
| 7 | The language and its literatures | 36 to 41 | 6 | unit-7.md |
| 8 | Range and mastery | 42 to 46 | 5 | unit-8.md |

C2 is about precision, nuance and range, not new basic grammar. Each lesson recaps what earlier levels taught (docs/c2-coverage.md, scripts/c2-find.ts) and teaches only the C2 layer.

## What was chosen, dropped or kept for recognition

- **Grammar (Unit 1):** pronominal-verb agreement, participles before an infinitive (*fait*, *laissé*, verbs of perception, *en*), *tout / quelque / même*, colour and compound agreement with numbers, the full concordance, ellipsis and the nominal style.
  - **Dropped as already taught:** the subjunctive in relative clauses and after superlatives (b2-subjunctive-relative-clauses covers *le meilleur film que j'aie vu*). It's recapped where useful, not re-taught.
  - **Recognition only:** the literary concordance with the imperfect subjunctive.
- **Lexis (Unit 2):** paronyms, polysemy, word formation, advanced false friends, anglicisms and official terms. Specialized registers have their own unit (3): legal, medical, scientific, administrative.
- **Reading and writing (Units 4 and 5):** implicit meaning, argument analysis, the commentaire de texte, style analysis, press genres; the contraction, the long essay, version, thème, revising your style.
- **Speaking skills in writing (Unit 6):** mediation, negotiation, a structured oral argument, interviews, all through written scripts and exchanges.
- **Culture (Unit 7):** the history of French, literature before the classics, literature since 1900 (paraphrase only), francophone literatures, wordplay.
  - **Recognition only:** Old French.
  - **Dropped:** a separate theatre lesson (the canon and the commentary cover it) and a separate press-history lesson (press genres covers what a reader needs).
- **Range (Unit 8):** pastiche, idioms at C2, deliberate register breaks, the unit review and the final review.

## Draft: C2 conventions (for CLAUDE.md, after review)

C2 inherits every C1 convention unless it's changed here.

- **Teaching language.** Rules and nuance stay in English. Every French example, dialogue line and longer text keeps an English translation (see open question 4).
- **Lengths.**
  - Teaching text: 1,000 to 1,300 words (1,400 for grammar). The whole lesson stays under 2,400.
  - Vocab: 15 to 30 entries (12 to 30 in grammar lessons), not counting glossary entries. Review lessons keep 3 to 8 new words.
  - Exercises: 15 to 18, with at least 5 production tasks, 1 reorder and 1 reformulation, plus at most 1 writing task (if option A or C is chosen), which doesn't count as production.
  - Dialogues: 12 to 16 lines, where the lesson has one (many C2 lessons work on texts instead).
  - Longer texts (communication, culture and review lessons): 300 to 500 French words, with a glossary. A text given to be commented or contracted may reach 600, in its own section.
  - En résumé (grammar and vocabulary lessons): 150 to 200 words.
- **Exercise types.** The C1 types stay. A `writing-task` type is proposed (open question 3); nothing else is added.
- **Instructions.** The C1 list stays. Add only **Commentez** (comment on), **Contractez** (reduce a text) and **Analysez** (analyse), and add them to INSTRUCTION_VERBS in scripts/b2-lists.ts at the same time.
- **Spelling.** Where the 1990 rectifications allow a second spelling, keys accept both, and the teaching text shows both once.
- **Translation exercises (version and thème).** Sentence-level only for typed keys, with every valid variant listed; longer passages are writing tasks.
- **Quotations.** The C1 safe list stays (authors who died before 1900, under 15 words, our own translations). Anonymous medieval texts count as safe; quote them in modernized spelling with the original shown for recognition.
- **The C1 checklist** (all 42 rules, in five groups) applies in full. Three C2 additions:
  - A modernized or rectified spelling is checked against a dictionary before it's accepted or rejected.
  - For a version or thème key, translate the accepted answer back and check that it keeps the meaning (the meaning rule applies in both directions).
  - Specialized texts (legal, medical, scientific, administrative) are invented and labelled; they give no advice and no real figures.

## Writing order

1. **Unit 1, then Unit 2.** The grammar and lexis that every later unit uses, with clear rules: a safe start for the extended checks.
2. **Unit 4, then Unit 5.** Reading before writing: the commentary and the style analysis feed the essay, the version and the revision lessons. Unit 5 waits for the writing-task decision.
3. **Unit 3 and Unit 6.** Specialized registers and mediation draw on Units 1, 2, 4 and 5; their facts are general.
4. **Unit 7.** The highest factual risk (dates, attributions, quotations, colonial history): write it after the checklist has been used on six units.
5. **Unit 8 last,** because its reviews draw on everything.

Each unit follows the C1 cycle: write the unit, run every check, fix, generate docs/review/c2-unit-N.txt, then fix after review before the next unit.

## Checks to extend before writing

- **validate:content:** C2 level folder (already in lib/lessons.ts LEVELS), the `writing-task` type if adopted, and C2-only instruction verbs.
- **test:b2-exercises:** extend to C2 (and skip writing tasks).
- **scripts/b2-links-ids.ts:** extend to C2 (link targets, vocab id order, unit against the syllabus).
- **audit:content:** C2 rows (lengths, résumé 150 to 200, longer texts 300 to 500, the exercise mix with 5 production tasks, writing tasks with a model and a checklist).
- **check:structures:** C2 rules (no imparfait du subjonctif or passé simple first and second person plural in a typed answer; the literary concordance only in recognition exercises).
- **check:words:** C2 lists (instruction verbs, the cognate list) and the B2_ENGLISH list for English prompts.
- **A C2 links check** on the model of check:c1-links, with docs/c2-forward-links.md.
- **scripts/c2-wrapup.ts** on the model of scripts/c1-wrapup.ts (links, claims, repeats, quotations, dates, invented names, limits).
- **scripts/c2-find.ts and scripts/c2-lists.ts** (written in Prompt 40) for every recap claim.
- **scripts/scan-alexandrines.ts** for any verse.

## Decisions taken

- **One review per unit and a final review**, as at C1.
- **No re-teaching:** each lesson starts from docs/c2-coverage.md and c2-find, and recaps in two or three sentences.
- **Facts first:** every date, law, attribution and claim the plan relies on is in docs/review-needed.md under "C2 plan", marked "to verify", before the unit is written.
