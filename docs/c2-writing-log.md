# C2 writing log

## C2 plan

- **C1 fixes (Prompt 40):**
  - c1-leading-a-meeting's Madame Morel is now Madame Blanchard (the name isn't used elsewhere; *Roux* was taken in b2-debating). This change is already in commit c2d4126.
  - scripts/c1-wrapup.ts now quotes Examples as "fr (en)", LessonLinks by their text, and Callout titles. That leaves 0 empty date rows and 0 "from ," quotes; mechanical failures stay at 0.
- **Coverage:** scripts/c2-lists.ts writes docs/c2-coverage.md, grouped by grammar, vocabulary areas, text types, registers, culture topics, C1 quotations, connectors and fixed phrases (A1 to C1, 280 lessons). scripts/c2-find.ts searches A1 to C1. One planned point was dropped as already taught: the subjunctive after superlatives (b2-subjunctive-relative-clauses).
- **Plan** (docs/plans/c2/overview.md and unit-1.md to unit-8.md): 46 lessons in 8 units (grammar 6, vocabulary 10, communication 15, culture 6, review 9).
  - 1. Precision in form (7)
  - 2. Words with precision (6)
  - 3. Specialized French (5)
  - 4. Reading between the lines (6)
  - 5. Writing at length and translating (6)
  - 6. Mediation and negotiation (5)
  - 7. The language and its literatures (6)
  - 8. Range and mastery (5)
- **Writing order:** Units 1 and 2 (rules and lexis everything uses); Units 4 then 5 (reading before writing; Unit 5 waits for the writing-task decision); Units 3 and 6; Unit 7 (highest factual risk, after the checklist has been used on six units); Unit 8 last.
- **Open questions:**
  - The lesson count and the unit split.
  - Whether Mediation and negotiation is its own unit.
  - Open writing: option C recommended (keyed sub-steps plus an ungraded `writing-task` with a model, a word count and a self-check list); site changes are listed, no code written.
  - Full translations of longer texts.
  - The recognition-only items (Old French, the literary concordance, 1990 spellings).
  - No exam practice at C2.
- **Draft C2 conventions** are in the overview, not yet in CLAUDE.md: teaching text 1,000–1,300 (1,400 grammar); lesson under 2,400; 15–18 exercises with 5 production tasks; longer texts 300–500; résumé 150–200; three new instruction verbs; three checklist additions.
- **Checks to extend before writing:** validate:content (C2, writing-task), test:b2-exercises, b2-links-ids, audit:content C2 rows, check:structures C2 rules, check:words C2 lists, a C2 links check with docs/c2-forward-links.md, and scripts/c2-wrapup.ts.
- **Facts:** every date, law and attribution the plan relies on is in docs/review-needed.md under "C2 plan", marked to verify. docs/syllabus.md has the 46 rows marked "Planned" and a C2 size row.
- **Checks:** validate OK; test:content OK; check:words 110; check:c1-links 0 failures; c1-wrapup 0 mechanical failures; build OK. No lesson file changed in this prompt.

## C2 setup

- **Checklist count:** the C1 checklist in CLAUDE.md has **42** rules, not 30. The extra 12 are the 17 bullets that were in the checklist before the numbered rules began (the user's numbering started at 7, so 6 of them were counted), plus the component-spacing rule added in Prompt 39; the numbered rules 7 to 30 make 24. 17 + 24 + 1 = 42. The overview now says so.
- **Old French:** quote the original for recognition, with our own modern French translation and our own English translation (under 15 words, one quotation per source per lesson). Overview, unit-7.md (lessons 36 and 37) and review-needed updated; "modernized spelling" is gone.
- **Lengths:** counted as audit:content counts C1 (teaching text without vocab tables, dialogue, text sections or résumé; longer text = French lines of text sections; glossaries outside the vocab limits), with one C2 change: the whole lesson leaves out the English translations of text sections. A text to comment on or contract goes in a section headed "Source text…" (at most 600 words, no dialogue in that lesson). Limits: teaching 1,000–1,300 (1,400 grammar), whole under 2,600, longer text 300–500, résumé 150–200. Arithmetic: 1,300 teaching + 600 source text + 500 model text = 2,400 ≤ 2,600.
- **Decisions taken:** 46 lessons in 8 units, Unit 6 kept; option C for writing; full English translations kept, outside the limits; recognition only for Old French, the literary concordance and 1990 vs traditional spellings (keys accept both); no exam-practice lesson, no lesson names an exam; conventions stay a draft in the overview. Open questions left: the word-count convention and the "Source text" heading.
- **writing-task (C2 only):** prompt, model, checklist of 3–6 items, optional wordTarget [min, max], at most one per lesson, no answers. Validator in lib/lessons.ts; component components/writing-task.tsx (labelled textarea, live word count, "Show the model", checklist, "Mark as done", aria-live status). lib/check-answer skips it and the score ignores it.
- **Privacy:** the text is a localStorage draft for that exercise only (lib/writing-draft.ts), never sent to a server or server action, never logged, never in progress. Progress stores only done and ticked items (lib/progress.ts); docs/db-setup.md plans a Supabase table with no text column. Written in CLAUDE.md under the exercise types.
- **Word count** (lib/word-count.ts, 6 tests): elisions count separately (*l'homme* = 2) except *aujourd'hui*, *quelqu'un* and similar; hyphenated compounds count as one (*c'est-à-dire* = 2); a figure with thousands spaces or a decimal comma is one word; punctuation isn't counted. In review-needed "C2 plan", to verify.
- **Checks extended to C2:** validate:content (+ fixtures in scripts/fixtures/planned-ids/lessons/c2 and a1), test:b2-exercises (writing tasks skipped), b2-links-ids, audit:content C2 rows, check:structures (no imparfait or plus-que-parfait du subjonctif or 1st/2nd plural passé simple in C2 typed answers), check:words (Commentez, Contractez, Analysez), check:c2-links with docs/c2-forward-links.md, wrapup:c2 (scripts/c2-wrapup.ts). All pass with zero C2 lessons.
- **Review file:** docs/review/c2-plan.txt (overview, unit-1 to unit-8, the "C2 plan" items).
- **Checks:** validate OK (280 lessons); test:content OK; test:checker 36/36 (**baseline 29 → 36**: 6 word-count tests and 1 writing-task test); test:b2-exercises 1034, 0 failures; audit summary unchanged (73/4/6); check:words 110; check:structures 0; check:c1-links 0; check:c2-links 0; check:alexandrines OK; b2-links-ids 116, 0; c1-wrapup and wrapup:c2 0 mechanical failures; build OK. No lesson file changed.

## Unit 1

- **Plan fixes (A):** unit-1 (*s'arroger*; *cent* before *mille*, *million*/*milliard* as nouns, the inventory in words); unit-2 (*amener / apporter* dropped: c2-find finds no lesson for *amener*; *écrasement* to verify or drop; *logiciel*, *ordinateur* as long-established coinages); unit-3 (*bénigne*, *maligne*); unit-4 (source text pending the owner's decision); unit-5 (contraction in the author's voice vs c1-synthesis); unit-7 (Louise Labé with the debate attributed, or another poet; the lipogram checked by script); unit-8 (verse through scan-alexandrines or prose); review-needed (*c'est-à-dire* = 4?; word count stays open until Unit 5). The "Source text" heading is accepted: validate:content now allows one per lesson, at C2 only, with French lines and a translation (2 new fixtures). wrapup:c2 now checks lipograms, lists counts per lesson, and reports forward links as pending.
- **Conventions (B):** moved from the overview into CLAUDE.md ("C2 conventions"), plus three checklist additions (mechanical constraints by script; contraction vs synthesis; established words). The overview keeps a pointer. C2 is no longer marked "Coming later" on the site (lib/lessons.ts).
- **Lessons (teaching / whole / résumé words; graded exercises, production):**
  - c2-agreement-pronominal-verbs 1,346 / 1,867 / 163; 17, 8
  - c2-agreement-with-infinitives 1,152 / 1,744 / 167; 18, 8
  - c2-tout-quelque-meme 1,038 / 1,589 / 159; 18, 8
  - c2-agreement-colours-compounds-numbers 1,126 / 1,510 / 153; 18, 7
  - c2-concordance-in-writing 1,232 / 1,806 / 164; 18, 9
  - c2-ellipsis-and-nominal-style 1,146 / 1,608 / 151; 17, 10
  - c2-review-form 1,031 / 1,657 / none; 16, 10, plus 1 writing task. Source text 343 words, with 10 errors; corrected text 345.
- **Hyphens:** lib/check-answer.ts treats hyphens as punctuation, so *vingt et un* = *vingt-et-un* and *porte monnaie* = *porte-monnaie*. Traditional and 1990 hyphenation are both accepted with no extra keys. A typed answer can't test hyphens (an unhyphenated *quatre vingt deux* is also accepted), so hyphenation is tested by multiple choice only (lesson 4, ex003 and ex004). Different spellings (*porte-monnaie / porte-monnaies*, *laissées / laissé*, *mangé / mangées* after *en*) are listed as separate keys.
- **Not sure about:** *en* + participle ("agreement is also found"); *après que* + subjunctive labelled as common but avoided in careful writing; *se plaire* invariable in every meaning; *une toute autre* called wrong in careful writing; the 1990 plural of verb + noun compounds; *ambigüe*; "the imparfait is never wrong in a past report". All are in review-needed ("C2 lessons"), with the reviewed Unit 1 facts marked "verified (Prompt 42 review)".
- **Checks:** validate 287 lessons; test:content OK; test:checker 36/36; test:b2-exercises 1,082, 0 failures; b2-links-ids 123, 0; audit 73/4/6 (unchanged); check:words 110; check:structures 0; check:c1-links 0; check:c2-links 7 lessons, 0; check:alexandrines OK; wrapup:c2 0 mechanical failures (1 forward link pending: c2-review-form → c2-paronyms); build OK. Bundle: docs/review/c2-unit-1.txt; plan bundle regenerated.
