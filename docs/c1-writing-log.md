# C1 writing log

## C1 plan

- Planning only: no lesson file was written, and B2 is unchanged.
- CLAUDE.md "C1 conventions": the main changes from B2 are:
  - English for rules; translations kept except for in-lesson repeats.
  - Teaching text 900 to 1,200 words (1,300 for grammar), whole lesson under 2,100; 15 to 18 exercises with 4 production tasks; dialogues 12 to 16 lines; En résumé 120 to 180 words; longer texts 250 to 400 words.
  - No new exercise types; two new instruction verbs (*Résumez*, *Justifiez*).
  - Passé simple and passé antérieur produced in narrative only; the imparfait and plus-que-parfait du subjonctif for recognition, never required in a typed answer.
  - Five register labels; rules for contested history, religion and laïcité.
  - Public-domain quotations only, under 15 words.
  - The C1 checklist (the B2 self-audit rules and recurring defects).
- Coverage map: scripts/c1-lists.ts writes docs/c1-coverage.md (35 tense lessons, 96 grammar lessons, 53 connectors, 121 fixed phrases from A1 to B2).
- Plan: docs/plans/c1/overview.md and unit-1.md to unit-8.md, 58 lessons. Units 1 to 7 keep the syllabus ids. Unit 7 gains c1-review-living, and a new Unit 8 "Towards DALF C1" adds concession and hypothesis, formal relatives and apposition, euphemism and synonyms, spoken discourse markers, laïcité and institutions, two practice lessons, a unit review and the final review (moved to 58). docs/syllabus.md is updated to match.
- c1-passe-simple is planned in detail (forms for all persons, irregular stems, use, model sentences, exercises), so b2-review-final's pointer is covered.
- Open questions (in the overview): Unit 8 or folding it in; nine B2 overlaps to recap rather than re-teach; production of the imparfait du subjonctif; quotations versus pastiche; the DALF practice line.
- docs/review-needed.md: new "C1 plan" section (12 items). docs/project-state.md: C1 is "planning done, writing not started", with the writing order.
- Checks: validate:content OK, test:content OK, build OK.

## C1 plan fixes

- Already fixed before this prompt: none.
- Corrections:
  - c1-passe-anterieur: the spoken equivalent is the passé composé or surcomposé, and the exercise chooses the tense by the main verb.
  - c1-passe-simple: adds full paradigms (*être, avoir, faire, venir/tenir, voir*) and 14 recognition verbs; "not in everyday speech or in modern dialogue" here and in CLAUDE.md; new narrative vocab (*le récit, s'écrier, se mettre à, à l'aube*) replaces the non-word.
  - The overview explains key vocab versus the minimum, and each thin review got one new word (*la sobriété, un fil conducteur, captiver, un courant de pensée*).
  - Poetry: syllables checked by scripts/scan-alexandrines.ts, or free verse.
  - CLAUDE.md: a named quotation safe list (authors who died before 1900, own translations), and an "Exam practice" rule with no timings or scoring. The literature, philosophy, Enlightenment and cinema lessons are updated; unit-8 drops "ten-minute".
  - *euphémiser* moved to c1-euphemism-and-synonyms; the dissertation's problématique is a rule of thumb; c1-subjunctive-nuances keeps only questions, *que* + subjunctive first, and meaning-changing moods.
  - The inverted hypothesis lists *Fût-il* and *Serait-il*, both literary.
- Merge: c1-conditionnel-journalistique folded into c1-advanced-connectors ("Advanced connectors and academic hedging"); 57 lessons.
- Order: future-in-the-past moved to Unit 1, tricky-prepositions to Unit 2, formal-relatives and concession-and-hypothesis to Unit 3. One review per unit; units of 8, 9, 8, 7, 6, 6, 6, 7. Overview, links, writing order, docs/syllabus.md and docs/project-state.md updated.
- Verify claims, with scripts/c1-find.ts (new):
  - True: *de crainte que*, *aussitôt que*, *au cas où* + conditionnel, *la problématique*, *sobre*, *convaincant*, *la concordance des temps*, *la conjoncture*, *un héritage*, *au cours duquel*, *soutenu*, *le narrateur*, *le lendemain*, *à ce moment-là*, *or*, *en revanche*, negative *penser/croire que*; *après que* and *porter plainte* are in lesson text.
  - Not taught, now new vocab: *par contre*, *s'écrier*, *se mettre à*, *à l'aube*, *le récit*, *à en croire*, *selon toute vraisemblance*, *sous réserve de*, and *penser/croire* in questions.
- docs/c1-coverage.md now says the map is incomplete and to check with c1-find.ts. review-needed.md "C1 plan" gained 5 items, with 2 rewritten and 1 removed (*porter plainte*, verified). docs/review/c1-plan.txt regenerated.
- Checks: validate:content OK, build OK.

## Pilot batch

- **Lessons** (teaching / whole / résumé words; vocab; exercises, with production tasks; dialogue lines):
  - c1-passe-simple: 971 / 1,515 / 137; 13 vocab; 16 exercises (6 production); 12 lines.
  - c1-passe-anterieur: 1,013 / 1,623 / 139; 13 vocab; 18 exercises (7 production); 12 lines.
  - c1-stylistic-inversion: 1,103 / 1,516 / 138; 13 vocab; 18 exercises (8 production); 12 lines.
- **Step 1, tool changes:**
  - audit-content.ts runs the B2 checks on C1 with the C1 limits, and adds passé simple stems for *mettre* and *taire*.
  - check-words.ts has a C1 passé simple lemmatizer (regular endings plus a list of irregular forms).
  - check-structures.ts has two new rules: the passé antérieur and the imparfait du subjonctif.
  - b2-lists.ts gains *Résumez* and *Justifiez*.
  - test:b2-exercises and b2-links-ids now also cover C1.
- **What didn't fit:**
  - "What's next" points to planned lessons (c1-future-in-the-past, c1-ne-expletif). Both are in ALLOWED_MISSING and noted in project-state.
  - *aussitôt* is already taught in b1-time-connectors, so it was dropped from the vocab and linked instead.
  - A2 teaches *encore* as "still", so the new entry is *encore + inversion*.
  - An incise (*s'écria-t-elle*) was removed from c1-passe-simple, because incises are taught in lesson 9.
  - The audit rows still say "B2" but now check C1 too.
  - *dès* answers get strictAccents because the audit flags them.
- **Step 4:** the LessonLink to c1-passe-simple in b2-review-final is restored.
- **Checks:** all pass. check:words is still 110, check:structures is 0, test:b2-exercises shows 340 exercises with 0 failures, and b2-links-ids shows 62 lessons with 0 failures.

## Batch 2

- **Word counts** (teaching / whole / résumé; vocab; exercises):
  - Pilot after fixes: passe-simple 1,154 / 1,698 / 137 (13 vocab, 18 exercises); passe-anterieur 1,061 / 1,673 / 141 (13, 18); stylistic-inversion 1,103 / 1,516 / 138 (13, 18).
  - New lessons: future-in-the-past 948 / 1,563 / 127 (12 vocab, 18 exercises); ne-expletif 1,002 / 1,415 / 136 (12, 18); literary-negation 913 / 1,264 / 132 (14, 18).
- **Pilot fixes:**
  - Done: venir/tenir (-inrent); spelling changes plus *fallut*, *dut* and *plut*, with ex017 and ex018 and wrong-form checks; ex008 (pleuvait); the *à peine* wording; ex009 and ex007; forward links; the résumé opener.
  - Already done: *une incise* is used in a full sentence in the En résumé.
- **Recap claims checked with c1-find:**
  - All pilot claims are true.
  - New lessons found that *le ne explétif* (b1-subjonctif-wishes-emotions, b2-subjunctive-conjunctions), *de peur que* and *éviter que* (b2-purpose-expressions) are already taught, and so are *allait* + infinitive and the conditionnel passé (b2-reported-speech-past). These are recaps, not new vocab.
- **Conventions and tools:**
  - The C1 checklist gains 7 rules.
  - docs/c1-forward-links.md and scripts/c1-links.ts (`npm run check:c1-links`) are new.
  - test:b2-exercises now also checks C1 fill-in and translate answers.
- **What didn't fit:**
  - ne-expletif and literary-negation were under 900 teaching words; teaching sections were added.
  - Syllabus prerequisites were widened: b2-purpose-expressions for ne-expletif, b2-registers for literary-negation.
  - 2 forward links are pending.
  - check:words needed the name Paul instead of Jules.
- **Checks:** all pass. check:words is still 110, check:structures is 0, test:b2-exercises shows 404 checks with 0 failures, and b2-links-ids shows 65 lessons with 0 failures.

## Batch 3

- **Preflight:** tree clean on `db`; master has the B2 fixes and wrap-up (Prompts 21–25) and the auth merge; `db` (tables, RLS, proxy) is one commit ahead and not merged. Plans, overview and syllabus rows all count 57 lessons; only the syllabus Size table was stale (49), now 57 with totals updated.
- **New lessons** (teaching / whole / résumé; vocab; exercises, production; dialogue lines): imperfect-subjunctive 1,225 / 1,674 / 144, 17 vocab, 17 ex (7), 14 lines; dislocation-and-fronting 1,271 / 1,681 / 144, 15, 18 (8), 14; adverb-placement 1,030 / 1,501 / 145, 17, 17 (7), 14; tricky-prepositions 1,075 / 1,618 / 151, 18, 18 (7), 14.
- **Batch-2 fixes:** none was already done. All of A1 to A6 applied: ne-expletif dialogue, ex006, à moins que example, glisser example, tip; future-in-the-past devoir meanings, "usually", ex007 context, two new term sentences; literary-negation sans… ni, cesser/oser/pouvoir/savoir, "all but one"; review-needed items.
- **Recap claims (c1-find):** true: *de crainte que* (b2-purpose-expressions), *c'était nul* (a2-talking-about-your-weekend, now linked), epistemic *devoir* (b2-certainty-and-probability), *la concordance des temps* (b2-reported-speech-past), c'est… qui/que and repeated subject, *aussi* + inversion (b2-registers), *apparemment*, *heureusement*, *franchement*, *manquer de*, *rêver de*, *tenir à*, *penser à*, *tu me manques*, de/par passive, country rules.
- **False or partial:** b2-mise-en-relief already teaches basic dislocation, so it's a recap and the lesson goes deeper; B2's concordance is indicative only (B2 says the subjunctive ignores the main verb), so the subjunctive sequence is taught as new; *il fallait que*, *même* = even, *croire à/en*, *rêver à*, *tenir de* and islands were untaught and are new vocab.
- **Tools:** check-words learns regular imparfait du subjonctif endings (C1) and 7 English option words. CLAUDE.md C1 checklist gains rules 7–12.
- **Didn't fit:** prerequisites changed for dislocation, adverb-placement and tricky-prepositions (syllabus updated; adverb scope "bien" replaced by "aussi"); ex014 (imperfect-subjunctive) types a passé simple, allowed in C1 narrative; 3 new forward links (concession-and-hypothesis, reading-literary-narrative, precise-verbs).
- **Checks against baselines:** check:words 110 (unchanged), check:structures 0, audit summary identical to the committed report, validate and test:content OK, test:checker 29/29, test:b2-exercises 455 checked 0 failures, b2-links-ids 69 lessons 0 failures, check:c1-links 0 failures (both pending links restored), build OK.

## Batch 4

- **Branch:** master (batch 3 uncommitted on it). **Batch-3 fixes already done:** none; A1 to A8 all applied (*le thème* for the topic, the *seulement* gloss, ex010 one sentence, island rule by article, *croire* + thing, the imparfait du subjonctif plural and conditionnel claims, "typed answer", ex003 in « » because prompts render as plain text, the antecedent, *il reste deux questions*, the table label, the résumé *Seulement*, ex001 *beaucoup apprécié*). *l'examen* dropped (a2-culture-french-school-system teaches *un examen*). *quant à* (b2-mise-en-relief), *toujours est-il que* (c1-stylistic-inversion) and *jouer à / de* (a1-hobbies-and-sports) are verified. The 3 forward links were listed.
- **New lessons** (teaching / whole / résumé; vocab; exercises, with production; dialogue lines): precise-verbs 1,023 / 1,439 / 123; 24 vocab; 18 (9); 14 lines. collocations 954 / 1,372 / 126; 18; 17 (7); 14 lines. review-style 1,076 / 1,926; 4 new words plus 3 glossary; 18 (9); a 256-word editorial.
- **Recap claims (c1-find):** true: *souligner*, *affirmer* (b2-reporting-verbs), *mettre en œuvre* (b2-formal-report), *mener une étude*, *une hypothèse*, *tirer une conclusion* (b2-science-and-research), *avoir lieu* (b2-nuancing-opinions), *provoquer* (b1-cause-and-consequence), *prendre une décision* (b1-review-hypotheses vocab), *porter plainte* (b1-making-a-complaint text), *sobre* (b2-describing-a-work-of-art).
- **False or changed:** *consacrer*, *signaler* and *un éditorial* are already taught, so they're not new vocab. *établir* is taught only as *se rétablir*. *la mise en valeur*, *effectuer*, *disposer de*, *susciter*, *émettre*, *relever un défi* and *grièvement* are new.
- **Tools:** check-words learns *-assions / -issions* endings, the names Saint and Aubin, and 6 more English option words. CLAUDE.md C1 checklist gains rules 13 and 14.
- **Didn't fit:** dislocation went over 1,300 after the fixes and was trimmed to 1,284. A review's teaching text must reach 900, so two teaching sections were added. Bold label + colon + italic bullets count as dialogue lines; the colon moved outside the bold. Syllabus prerequisites widened for precise-verbs and collocations. New forward link: review-style → c1-participle-clauses. Restored: tricky-prepositions → precise-verbs.
- **Checks against baselines:** check:words 110 (unchanged), check:structures 0, audit summary identical to the committed report (73 / 4 / 6 informational), validate and test:content OK, test:checker 29/29, test:b2-exercises 501 checked 0 failures, b2-links-ids 72 lessons 0 failures, check:c1-links 0 failures, build OK.
