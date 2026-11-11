# B2 plan overview: cross-unit checks (second pass)

The unit plans are docs/plans/b2/unit-1.md to unit-8.md: 59 lessons, in the order of docs/syllabus.md. Lessons are named by id.
- The decisions of the first review are in docs/b2-plan-review.md; all are applied.
- New questions are in docs/b2-plan-review-2.md.

The checks below were re-run with a script on the new order. It reads:
- every plan block: number, unit, type, "Structures used", prerequisites, vocab entries, size estimate and En résumé range
- docs/syllabus.md
- every A1 to B1 vocab entry (from docs/all-data.md)

The overlap table was rechecked by hand.

## Changes since the first plan

- **New order (decisions 2 to 4):**
  - b2-logical-connectors moved into Unit 1, after b2-concession-opposition. Review 2, decision 1, then put b2-idioms-everyday between them, so Unit 1 runs b2-nuancing-opinions, b2-social-issues, b2-subjunctive-conjunctions, b2-concession-opposition, b2-idioms-everyday, b2-logical-connectors, b2-purpose-expressions, b2-review-nuance.
  - b2-nominalisation moved into Unit 3, just before b2-summarizing-an-article. Its plan is rewritten for news and politics vocabulary instead of science.
  - Unit 2 now runs b2-conditionnel-passe, b2-si-plus-que-parfait, b2-mixed-conditionals, b2-futur-anterieur, b2-subjonctif-passe, b2-regret-and-reproach, b2-review-what-might-have-been.
  - Unit sizes: Unit 1 has 8 lessons, Unit 3 has 10 and Unit 6 has 5.
- **Syllabus and outline:** docs/syllabus.md and docs/b2-outline.md now use the new order. They also have:
  - the prerequisite changes from the first overview, plus b1-ce-qui-ce-que for b2-relative-prepositions
  - fixed review prerequisites:
    - b2-review-nuance lists b2-logical-connectors, which implies b2-concession-opposition
    - b2-review-what-might-have-been drops b2-subjonctif-passe, which b2-regret-and-reproach implies
  - scope text updated for the trims and additions below
  - no unit renamed
- **Trims and additions:**
  - **Decision 8:** the time-word shifts moved from b2-reported-speech-past to b2-reporting-verbs. *Laisser* + infinitive is a short section in b2-faire-causatif and is practised in b2-review-work.
  - **Decision 14:**
    - *soit… soit* and *ou bien* go in a table outside the teaching count in b2-logical-connectors
    - *le fait que* + subjunctive goes in b2-certainty-and-probability
    - *à* + infinitive (*maison à vendre*, *facile à faire*) goes in b2-alternatives-to-passive
    - None of the three takes its lesson over a limit (see the sizes below).
  - **b2-regret-and-reproach:** it now uses *je regrette que* + subjonctif passé directly, so the fixed-phrase label for it is gone. *Regretter d'avoir* is still a labelled fixed phrase, because b2-infinitif-passe comes later.
  - *En somme* is now defined in b2-logical-connectors and recapped in b2-summarizing-an-article.
  - *La hausse* and *la baisse* are now defined in b2-nominalisation.
  - **Participle agreement (after the Unit 2 batch review):** agreement with a preceding direct object is taught at A2 (a2-pronouns-in-passe-compose, a2-relative-qui-que-ou, a2-reflexive-passe-compose) and may be used freely in B2. b2-review-pronouns adds a short agreement checklist (about 120 to 150 words, 3 examples and the ex4 error-correction), which keeps it at about 1,000 teaching words and 1,650 in all, within the review limits.
- **Limits (decisions 1, 17 and 19):**
  - Longer texts are 150 to 250 French words.
  - Grammar lessons need at least 12 vocab entries.
  - b2-reported-speech-past now plans 12.
  - The long communication lessons are re-estimated with the shorter texts.
- **Tooling:**
  - **scripts/b2-lists.ts:** has the plans' cognate allowlist and the 7 new-meaning entries.
  - **audit:content:**
    - uses the grammar minimum of 12
    - checks the 150 to 250-word longer text
    - reads unit numbers and orders from the syllabus
  - **check:structures:**
    - maps *pour que* to b2-purpose-expressions
    - adds the concessive relatives, the extended connectors and *le fait que*
    - stops mapping *il semble que* to b2-certainty-and-probability, because b2-nuancing-opinions teaches it
    - fixes patterns that start with an accented letter (for example *étais*, *étant donné que*, *à moins que*), which never matched before
  - **test:content:** checks the B2 syllabus order (orders, units, prerequisites, cycles).

## 1. Structures used before they're taught

Script result: no "Structures used" entry and no prerequisite points to a lesson that comes later.

The labelled fixed phrases that remain:

| Lesson | Uses | Taught in | Resolution |
|---|---|---|---|
| b2-regret-and-reproach | *regretter d'avoir* + participle | b2-infinitif-passe | labelled fixed phrase |
| b2-regret-and-reproach | *je m'en veux de* | b2-idiomatic-y-en | labelled fixed phrase |
| b2-regret-and-reproach | *Ça ne se reproduira pas* | b2-alternatives-to-passive | labelled fixed phrase |
| b2-culture-french-history, b2-culture-francophone-africa | the passé simple in texts | b2-arts-and-literature | comes after it; listed as a prerequisite of b2-culture-french-history |

## 2. Planned words used before they're defined

Script result: none. The one hit is a false positive: b2-relative-lequel uses *près de* in the A1 sense ("near", taught in a1-prepositions-of-place). b2-presenting-data's entry is the new meaning "nearly".

No recap points to a lesson that now comes later.

The 7 entries that keep an A1 to B1 `fr` are all marked NEW_MEANINGS in the plans and listed in scripts/b2-lists.ts: *un bilan*, *un entretien*, *le marché*, *près de*, *un état des lieux*, *quoi*, *trop*. The registers entry is now planned as *aussi + inversion*, a different `fr`.

## 3. Prerequisite cycles and counts

- **Cycles:** none.
- **Counts over 6:** none (b2-review-final has 10, and final reviews are exempt).
- **Plan files against the syllabus:** all 59 lessons match on number, unit, type and prerequisites.

## 4. Lesson sizes against the limits

Script result: every lesson is within the limits (teaching text, whole lesson, vocab, exercise count, En résumé range for its unit, and a longer text where one is needed).

Closest to a limit:
- b2-logical-connectors, b2-nominalisation and b2-participles-and-gerund: about 1,150 teaching words (grammar limit 1,200)
- b2-certainty-and-probability: about 1,120, after adding *le fait que*
- b2-alternatives-to-passive: about 1,100, after adding *à* + infinitive
- b2-arts-and-literature and b2-registers: at the vocabulary and communication limit of 1,100
- b2-formal-report, b2-argumentative-essay and b2-debating: whole lesson about 1,700 (cap 1,800)

## 5. Overlaps

Every overlap in the first overview is resolved in the plans: each is a recap with a LessonLink, a cut, or the owner is named. The table lists only what changed or still needs watching.

| B2 lesson | Overlaps with | Status |
|---|---|---|
| b2-nominalisation | b2-politics-and-society (*réforme*, *démission*, *abstention*) | They're recapped as examples of the pattern, not re-entered |
| b2-nominalisation | b2-reporting-verbs (*annoncer*, *affirmer*) | It teaches none of their nouns as entries |
| b2-nominalisation | b2-summarizing-an-article (*la hausse*, *la baisse*) | Defined in b2-nominalisation, recapped in the summary lesson |
| b2-logical-connectors | b2-concession-opposition | b2-concession-opposition owns opposition (*en revanche*); b2-logical-connectors owns addition, explanation and consequence |
| b2-logical-connectors | b2-summarizing-an-article (*en somme*) | Defined in b2-logical-connectors |
| b2-reported-speech-past | b2-reporting-verbs (time words) | The time words moved to b2-reporting-verbs |
| b2-alternatives-to-passive | b2-faire-causatif (*se faire*) | b2-faire-causatif owns it |
| b2-presenting-data | b2-arts-and-literature (*un tableau*) | A deliberate new meaning; informational |

None of the moves created a new overlap with A1 to B1.

## 6. B2 grammar inventory

Every item listed in the first overview is now placed. The three that were missing are now in their lessons:
- *soit… soit* in b2-logical-connectors
- *le fait que* + subjunctive in b2-certainty-and-probability
- *à* + infinitive in b2-alternatives-to-passive

The imperfect and pluperfect subjunctive (recognition only) are still left for C1.

## 7. New problems

See docs/b2-plan-review-2.md:
- Unit 1 had four grammar lessons in a row: resolved by moving b2-idioms-everyday (review 2, decision 1).
- Unit 3 has 10 lessons.
- b1-making-a-complaint uses *c'est-à-dire* without a vocab entry.
