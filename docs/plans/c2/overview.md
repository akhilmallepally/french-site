# C2 plan: overview

Status: **plan approved (Prompts 41 and 42); conventions in CLAUDE.md since Prompt 42.** Unit 1 written in Prompt 42. The writing-task type and the C2 checks are built (Prompt 41).

## Open questions

None at present.

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

## C2 conventions

Moved to CLAUDE.md ("C2 conventions") in Prompt 42, with three more checklist additions (mechanical constraints checked by script; contraction vs synthesis; established words).

## Writing order

1. **Unit 1, then Unit 2.** The grammar and lexis that every later unit uses, with clear rules: a safe start for the extended checks.
2. **Unit 4, then Unit 5.** Reading before writing: the commentary and the style analysis feed the essay, the version and the revision lessons. Unit 5 uses the writing-task type (decided in Prompt 41).
3. **Unit 3 and Unit 6.** Specialized registers and mediation draw on Units 1, 2, 4 and 5; their facts are general.
4. **Unit 7.** The highest factual risk (dates, attributions, quotations, colonial history): write it after the checklist has been used on six units.
5. **Unit 8 last,** because its reviews draw on everything.

Each unit follows the C1 cycle: write the unit, run every check, fix, generate docs/review/c2-unit-N.txt, then fix after review before the next unit.

## Checks extended to C2 (Prompt 41)

All pass with zero C2 lessons, and no A1 to C1 result changed.

- **validate:content** (lib/lessons.ts): the `writing-task` type, C2 only, with `prompt`, `model`, a 3-to-6-item `checklist`, an optional `wordTarget` [min, max] and no `answers`; at most one per lesson. Covered by fixtures in scripts/fixtures/planned-ids/lessons/c2/ and test:content.
- **test:b2-exercises:** reads C2 lessons too; writing tasks are skipped.
- **scripts/b2-links-ids.ts:** reads C2 lessons and C2 syllabus rows.
- **audit:content:** C2 rows with the CLAUDE.md lengths, the source-text rule, and the writing-task rule.
- **validate:content, source texts (Prompt 42):** a `## Source text: …` section is allowed at C2 only, at most one per lesson, and must have French text lines and an English translation (fixtures c2/bad-source-text.mdx and a1/source-text-too-early.mdx).
- **wrapup:c2, lipograms (Prompt 42):** a lesson tagged `lipogram` names its missing letter and no French line of the lipogram section may contain it.
- **check:structures:** in C2 lessons, no typed answer may contain the imparfait or plus-que-parfait du subjonctif or a passé simple in the first or second person plural.
- **check:words:** the C2 instruction verbs (Commentez, Contractez, Analysez).
- **check:c2-links** (scripts/c2-links.ts) with docs/c2-forward-links.md.
- **wrapup:c2** (scripts/c2-wrapup.ts, judgement calls in scripts/c2-wrapup-judgements.md), writing docs/c2-wrapup.md.
- **test:checker** now also runs lib/word-count.test.ts and a test that writing tasks are never graded.
- **scripts/c2-find.ts and scripts/c2-lists.ts** for every recap claim; **scripts/scan-alexandrines.ts** for any verse.

## Decisions taken

- **Size and units (Prompt 41):** 46 lessons in 8 units, as planned; Unit 6 (mediation and negotiation) stays.
- **Writing (Prompt 41): option C.** Keyed sub-steps teach the method (choose the problématique, order the plan, pick the transition). On top, at most one `writing-task` per lesson: ungraded, with a model and a self-check list, outside the exercise and production counts. Built in Prompt 41: lib/types.ts, the validator (lib/lessons.ts), components/writing-task.tsx, lib/word-count.ts, lib/writing-draft.ts and the progress store.
- **Translations (Prompt 41):** every longer text keeps a full English translation. Translations of text sections count outside the length limits (see "Lengths").
- **Recognition only (Prompt 41):** Old French, the literary concordance of the subjunctive, and traditional vs 1990 spellings (keys accept both spellings).
- **Source-text heading (Prompt 42):** accepted: a text to comment on or contract goes under `## Source text: …`, and the validator checks it.
- **Full public-domain source texts (Prompt 44):** allowed for a commentary: one complete text by a safe-list author, at most 600 words, copied from Wikisource or Gallica, with our own translation (see CLAUDE.md). c2-commentaire-de-texte uses Baudelaire's « Le Port ».
- **Word-count convention (Prompt 45):** the common classroom convention (hyphens and apostrophes separate words, *aujourd'hui* = 1, a number = 1), in lib/word-count.ts and CLAUDE.md; conventions vary, and lessons say so.
- **No exam practice (Prompt 41):** C2 has no exam-practice lessons, and no lesson names an exam.
- **One review per unit and a final review**, as at C1.
- **No re-teaching:** each lesson starts from docs/c2-coverage.md and c2-find, and recaps in two or three sentences.
- **Facts first:** every date, law, attribution and claim the plan relies on is in docs/review-needed.md under "C2 plan", marked "to verify", before the unit is written.
