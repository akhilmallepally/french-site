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
