# C1 plan: overview

Status: all eight units are written: 57 of 57 lessons. Units 1 to 7 have been reviewed as whole units, and Unit 8 is ready for its unit review. Rules: CLAUDE.md, "C1 conventions" (on top of the B2 conventions). Coverage of A1 to B2: docs/c1-coverage.md, checked with `node --experimental-strip-types scripts/c1-find.ts "phrase"`. Lesson numbers follow docs/syllabus.md.

## Shape

57 lessons in 8 units, with exactly one review at the end of each unit (the last unit ends with its review and the final review).

| Unit | Title | Lessons | Count | Plan file |
|---|---|---|---|---|
| 1 | Literary French | 1 to 8 | 8 | unit-1.md |
| 2 | Style and emphasis | 9 to 17 | 9 | unit-2.md |
| 3 | Academic writing | 18 to 25 | 8 | unit-3.md |
| 4 | Debate and rhetoric | 26 to 32 | 7 | unit-4.md |
| 5 | Professional mastery | 33 to 38 | 6 | unit-5.md |
| 6 | Ideas and society | 39 to 44 | 6 | unit-6.md |
| 7 | Living the language | 45 to 50 | 6 | unit-7.md |
| 8 | Towards DALF C1 | 51 to 57 | 7 | unit-8.md |

**Vocab in the plans.** Each lesson's "key vocab" lists headline items only. The writer fills the lesson to the minimum (12 entries in grammar lessons, 15 elsewhere) with words used in complete sentences. Items marked "(recap)" are taught earlier and are not new words. Review lessons have 3 to 8 truly new words.

## Writing order

1. Unit 2 (clear grammar rules; mostly easier), then Unit 1 lessons 1 to 4 (the literary and narrative tenses).
2. Unit 3 (it now holds concession and hypothesis and formal relatives, which Units 4 and 8 use) and Unit 5.
3. Unit 4 and Unit 7.
4. Unit 1 lessons 5 to 8 and Unit 6 (literature, ideas and culture; the quotation and fact rules make these harder).
5. Unit 8 last, because its practice lessons and reviews draw on everything.

Before writing, extend the B2 checks to C1: test:b2-exercises and scripts/b2-links-ids.ts, the C1 rows in audit:content (lengths, résumé 120 to 180, long texts 250 to 400), the C1 structure rules in check:structures (imparfait du subjonctif, passé antérieur, passé surcomposé), and scripts/scan-alexandrines.ts for the poetry lesson.

## Decisions taken

- **Writing and review by unit:** each unit is now written and reviewed as a whole, with docs/review/c1-unit-N.txt as its review file.

- **8 units**, with these moves from the first plan: c1-future-in-the-past to Unit 1; c1-tricky-prepositions to Unit 2; c1-formal-relatives-and-apposition and c1-concession-and-hypothesis to Unit 3, so the debate and essay lessons can use them.
- **Hedging:** B2 already teaches the rumour conditionnel and hedging (b2-conditionnel-passe, b2-nuancing-opinions, b2-persuasion-and-hedging). What's new (*à en croire*, *selon toute vraisemblance*, *sous réserve de*) is too little for a lesson, so c1-conditionnel-journalistique is merged into c1-advanced-connectors ("Advanced connectors and academic hedging"). Total: 57 lessons.
- **The imparfait du subjonctif** is never required in a typed answer; where it's possible, the present or passé subjunctive is also accepted.
- **Quotations** come only from the named safe list in CLAUDE.md (authors who died before 1900), under 15 words, in our own translations. Later authors are paraphrased or pastiched, and labelled.
- **DALF practice** names no timings, task formats or scoring: "a short exposé from a short document", "a synthesis of two documents".

## Still open

- **Overlap to recap, not re-teach** (check each with c1-find.ts while writing):
  - c1-passe-simple: the recognition section of b2-arts-and-literature.
  - c1-stylistic-inversion: b2-registers.
  - c1-ne-expletif: b2-subjunctive-conjunctions and b1-subjonctif-wishes-emotions.
  - c1-dislocation-and-fronting: b2-mise-en-relief and b2-colloquial-french.
  - c1-synthesis and c1-dissertation: b2-summarizing-an-article and b2-argumentative-essay.
  - c1-future-in-the-past: b2-reported-speech-past.
  - c1-leading-a-meeting and c1-formal-correspondence: b2-meetings-and-calls and b1-formal-email.
- **Poetry:** decided in Prompt 36. scripts/scan-alexandrines.ts (`npm run check:alexandrines`) verifies every line of the original poem in c1-culture-french-poetry and the four quoted lines (Racine, Hugo, Baudelaire, Verlaine), so the lesson uses a classical poem: two quatrains of alexandrines with alternating rhymes. A native speaker still reviews it (docs/review-needed.md).
- **Facts for a native speaker:** docs/review-needed.md, "C1 plan".
