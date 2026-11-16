# Reviewer brief: Parlons, level C2

## What Parlons is

Parlons is a free, text-only website that teaches French to English speakers, from beginner (A1) to mastery (C2). Each lesson explains one point in English, gives French examples with translations, often has a dialogue or a longer original text, and ends with exercises that the site marks automatically. C2 is the last level: 46 lessons in 8 units, ending with a final review. No C2 lesson prepares for an exam or describes one.

## What C2 covers

| Unit | Lessons | Subject |
|---|---|---|
| 1. Precision in form | 1 to 7 | Agreement of the past participle (pronominal verbs, infinitives), *tout*, *quelque*, *même*, colours, compounds and numbers, the concordance of tenses in writing, ellipsis and the nominal style |
| 2. Words with precision | 8 to 13 | Paronyms, polysemy, word formation, advanced false friends, anglicisms and official terms |
| 3. Specialized French | 14 to 18 | Legal, medical, scientific and administrative French, and how to restate each plainly |
| 4. Reading between the lines | 19 to 24 | Implicit meaning, argument analysis, the commentaire de texte (on Baudelaire's « Le Port »), stylistic analysis, the press |
| 5. Writing at length and translating | 25 to 30 | The contraction de texte, the long essay, version (French to English), thème (English to French), revising your style |
| 6. Mediation and negotiation | 31 to 35 | Relaying a text, negotiating by email, a structured oral argument, interviews |
| 7. The language and its literatures | 36 to 41 | The history of French, literature before 1600 and since 1900, francophone literatures, wordplay |
| 8. Range and mastery | 42 to 46 | Pastiche and parody, idioms, deliberate register breaks, the final review |

## The C2 rules, in brief

- Rules and nuance are explained in English; every French example, dialogue line and longer text has an English translation.
- Grammar and vocabulary lessons end with *En résumé*, a short recap in plain French.
- Exercise instructions are in French (*Complétez*, *Reformulez*, *Commentez*…); feedback is in English. Each lesson may have one ungraded writing task with a model answer and a checklist.
- Lessons use only words and grammar taught earlier in the course. Anything that isn't standard French is labelled: (literary), (formal), (familiar), (slang) or (spoken).
- Where both a traditional spelling and a 1990 rectified spelling are correct, both are accepted and shown once ("the 1990 spelling rectifications, recommended rather than compulsory").
- Quotations come only from authors who died before 1900, or from anonymous medieval texts, are under 15 words, are copied from Wikisource, and are translated by us. Old and Middle French appear for recognition only, with our own modern French and English translations. Later authors are paraphrased. All other texts (letters, articles, a lease, a medicine leaflet, a study, stories, a lipogram, pastiches) are original and labelled as invented.
- Specialized texts give no legal or medical advice and no real figures. Sensitive topics (colonial history, francophone identities, language policy) present positions with their sources, and no verdict.

## How to read a bundle

- `docs/review/c2-unit-1.txt` to `c2-unit-8.txt`: every lesson of each unit, in course order, each starting with `===== content/lessons/c2/<file>.mdx =====`.
- In each lesson, the frontmatter comes first: `vocab` (`fr` is the French, `pron` a respelling for English speakers, `en` the gloss, `group: "glossary"` for words glossed under a longer text) and `exercises` (`prompt`, `options`, `answers` = every answer the site accepts, `strictAccents` = an answer with a missing accent is marked wrong). Then comes the lesson text.
- The site ignores capitals, punctuation and apostrophe style when marking, so the answer lists don't repeat those variants. It does not treat other spellings as equal, so every valid wording must be listed.

## What to check first

1. **Agreements and spellings (Unit 1).** Participle agreements with pronominal verbs and infinitives, *tout* before an adjective, colour adjectives, *vingt* and *cent*, and every place where both the traditional and the 1990 spelling are accepted. Is each form correct, and is each "both accepted" true in that exact sentence?
2. **Translation keys in both directions (Unit 5).** For *version*, are the English answers natural, with British and American variants where both are normal? For *thème* and all French translation items, would the site wrongly reject a valid answer, or accept one that changes the meaning?
3. **Register labels, idioms and their strength (Units 2, 6 and 8).** Are "familiar", "formal" and "literary" right? Do the idioms of c2-idiomatic-precision mean what the glosses say, at the strength the lesson gives them? Are the claims about English twins and false twins right?
4. **Specialized French (Unit 3).** Are the legal, medical, scientific and administrative terms used as professionals use them (*le bailleur*, *la posologie*, *les effets indésirables*, *un groupe témoin*, *une pièce justificative*, *P.J.*)? The texts are invented: check the language, not the procedures.
5. **History and literature facts (Unit 7).** Dates, works, attributions and the wording of the quotations. Each quotation's source is listed in docs/c2-wrapup.md.
6. **Naturalness everywhere.** Would a native speaker say or write each dialogue line and model text, in its register?

## How to report

For each item in docs/c2-review-items.md, and for anything else you notice, reply with one line: `lesson id, unit, type, item number: OK` or `change to "…"` or `remove`. For example: `c2-legal-french, Unit 3, Language 3: OK`.

Items marked *(possibly resolved)* quote wording that a later fix may have changed: glance at the lesson first, then answer "OK" if the current wording is fine.

## Where else to look

- `docs/c2-review-items.md`: every item to check, grouped by unit and by type (Language, Culture and register, Facts, Sensitive), numbered within each group, duplicates removed.
- `docs/c2-wrapup.md`: the editor's cross-lesson audit (quotations with their sources, every date, recurring invented names and places, claims about English, per-unit figures). You don't need to review it, but its quotation and date lists are a quick way to check facts.

## Items by unit

| Unit | Language | Culture and register | Facts | Sensitive |
|---|---|---|---|---|
| 1. Precision in form | 23 | 4 | 4 | 0 |
| 2. Words with precision | 20 | 7 | 3 | 1 |
| 3. Specialized French | 16 | 3 | 5 | 0 |
| 4. Reading between the lines | 15 | 0 | 7 | 2 |
| 5. Writing at length and translating | 15 | 2 | 3 | 0 |
| 6. Mediation and negotiation | 10 | 5 | 5 | 1 |
| 7. The language and its literatures | 3 | 3 | 8 | 2 |
| 8. Range and mastery | 2 | 9 | 3 | 0 |
| Whole level and plan | 1 | 0 | 1 | 0 |

The Language items in Units 1 to 3 come first: a wrong rule there would mislead every learner. Then the Sensitive items, the quotations and dates of Unit 7, and the translation keys of Unit 5.

Thank you: even a partial review, one unit at a time, is very useful.
