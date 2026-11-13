# C1 plan: overview

Status: plan only. No C1 lesson file is written. Rules: CLAUDE.md, "C1 conventions" (on top of the B2 conventions). Coverage of A1 to B2: docs/c1-coverage.md. Lesson numbers follow docs/syllabus.md.

## Shape

58 lessons in 8 units. Units 1 to 7 follow the existing syllabus; Unit 7 gains its own review, and a new Unit 8 adds the points the syllabus lacked (concession and hypothesis at C1, formal relatives and apposition, euphemism and synonyms, spoken discourse markers, laïcité and the institutions) plus DALF-style practice and the final review.

| Unit | Title | Lessons | Count | Plan file |
|---|---|---|---|---|
| 1 | Literary French | 1 to 7 | 7 | unit-1.md |
| 2 | Style and emphasis | 8 to 15 | 8 | unit-2.md |
| 3 | Academic writing | 16 to 22 | 7 | unit-3.md |
| 4 | Debate and rhetoric | 23 to 29 | 7 | unit-4.md |
| 5 | Professional mastery | 30 to 36 | 7 | unit-5.md |
| 6 | Ideas and society | 37 to 43 | 7 | unit-6.md |
| 7 | Living the language | 44 to 49 | 6 | unit-7.md |
| 8 | Towards DALF C1 | 50 to 58 | 9 | unit-8.md |

Each lesson block gives: title, id, type, teaching points, 3 to 6 key vocab items, main exercise types, back-links to A1 to B2, sensitive-topic flags, and "easier" or "harder" to write.

## Writing order

1. Unit 2 (mostly grammar with clear rules; easier) and Unit 1 lessons 1 to 3 (grammar).
2. Unit 3 and Unit 5 (academic and professional; the models exist in B2).
3. Unit 4 and Unit 7 (rhetoric, idioms, register).
4. Unit 1 lessons 4 to 7 and Unit 6 (literature, ideas and culture; the copyright and fact rules make these harder).
5. Unit 8 last, because its practice lessons and reviews draw on everything.

C1-specific checks to add before writing: extend test:b2-exercises and scripts/b2-links-ids.ts to C1, add C1 rows to audit:content (lengths, résumé 120 to 180, long texts 250 to 400), and add the C1 structure rules (imparfait du subjonctif, passé antérieur) to check:structures.

## Open questions

- **Unit count and order.** The syllabus had 7 units and 49 lessons; this plan adds Unit 8 and c1-review-living, and moves c1-review-final to 58. Keep this, or fold Unit 8 into Units 3 and 4?
- **Overlap with B2, to recap rather than re-teach:**
  - c1-passe-simple builds on the recognition section of b2-arts-and-literature (production is the new part).
  - c1-stylistic-inversion overlaps b2-registers (inversion after *peut-être*, *aussi*, complex inversion).
  - c1-ne-expletif overlaps b2-subjunctive-conjunctions (*avant que… ne*).
  - c1-dislocation-and-fronting overlaps b2-mise-en-relief and b2-colloquial-french (the repeated subject).
  - c1-conditionnel-journalistique overlaps b2-conditionnel-passe (the rumour conditionnel).
  - c1-synthesis and c1-dissertation overlap b2-summarizing-an-article and b2-argumentative-essay.
  - c1-future-in-the-past overlaps b2-reported-speech-past.
  - c1-leading-a-meeting and c1-formal-correspondence overlap b2-meetings-and-calls and b1-formal-email.
- **Imparfait du subjonctif production.** "Light production in formal writing": should any typed answer ever require it? The conventions say no.
- **Literature quotations.** Only public-domain authors may be quoted, under 15 words. Is that enough for the canon and poetry lessons, or should those use only original pastiches?
- **DALF practice.** The two practice lessons imitate task types without claiming exam rules or scores. Is that the right line?
- **Facts for a native speaker:** listed in docs/review-needed.md under "C1 plan".
