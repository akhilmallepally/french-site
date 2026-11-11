# B2 writing log

## B2 setup (conventions and checks)

- **B1 longer texts are too short for the planned B2 range, so I didn't apply it.**
  - The longer texts in the 13 B1 communication lessons average 89 French words, ranging from 45 to 141.
  - That's outside 250 to 400, so CLAUDE.md requires one longer text per communication and culture lesson but leaves its length to decide.
- **CLAUDE.md:**
  - New "B2 conventions" section: En résumé, the 14 French instruction verbs plus instruction nouns, lengths and the exercise mix, the 4 new exercise types, glossary and `Note:` formats, cognate and new-meaning allowlists, passé simple, register and facts.
  - The Workflow section now has the B2 steps.
- **lib/types.ts, lib/lessons.ts and components/exercise-player.tsx:**
  - New exercise types: `reformulation`, `register-shift` and `error-correction` are typed answers; `connector-choice` picks from options to fill a ___ gap.
  - The validator rejects these four types below B2. The player renders them.
- **scripts/lesson-text.ts:** "En résumé" is a text section, out of the teaching-text count but counted in the whole lesson. There are new helpers for its text and for `Note:` lines.
- **scripts/b2-lists.ts (new):** the instruction words, the cognate allowlist, NEW_MEANINGS (empty), a passé simple finder and a dropped-*ne* test.
- **audit:content:** 7 new B2 rows:
  - lengths
  - En résumé (presence, words per unit, position)
  - the vocab, exercise and dialogue mix, and a longer text in communication and culture lessons
  - repeated A1 to B1 vocab (an error)
  - French sentences and tips copied from an earlier level
  - passé simple before lesson 46 or in typed answers
  - dropped *ne* in answers before lesson 53
- **check:words:** from B2, it also checks En résumé text and whole French prompts, treats cognates and instruction words as known, and flags glossary entries that no longer text uses.
- **check:structures:**
  - 21 B2 rules, mapped to outline lessons through the syllabus.
  - It counts distinct Note-glossed forms in longer texts against the cap of 2.
  - Its summary line now reads "in B1 and later".
- **test:content:** 3 new fixtures cover the new types below B2, a connector-choice with no gap or options, and a valid B2 lesson using all four types.
- **Checks:**
  - All pass: check:words, check:structures, audit:content, validate:content, test:content, test:checker (29/29), lint and build.
  - The A1 to B1 output is identical to a baseline from the committed scripts. The only differences are the 7 new B2 audit rows (all 0) and the reworded check:structures summary.
  - I checked the B2 rules on a temporary probe lesson, then deleted it.
- **Not done:**
  - These can't be detected: *on* for *nous*, *ça* for *cela*, italics plus English on a term's first use, the 2-to-3-sentence recap limit, nominalisation, adjective position and *tout*.
  - The new exercise types haven't been tried in a browser.

## B2 plan

- **Files:**
  - docs/plans/b2/unit-1.md to unit-8.md: all 59 lessons. Each has its goal, prior coverage, structures, vocab, dialogue, text, En résumé, exercise list, prerequisites, LessonLinks, review items and size.
  - docs/plans/b2/overview.md: the cross-unit checks.
  - docs/b2-plan-review.md: 19 decisions.
- **Checks:**
  - A script checked the planned vocab against all A1 to B1 entries.
    - 32 planned "new" words were already taught. They're now recaps.
    - 7 are kept as new meanings for NEW_MEANINGS.
    - *un compromis* is replaced by *un juste milieu*.
  - The same script found no prerequisite cycles and no lesson over 6 prerequisites.
  - Every vocab count is within the limits.
  - Every early use of a structure is tied to a decision or a labelled fixed phrase.
- **Biggest risks:**
  - Nominal style and logical connectors are needed before their lessons (decisions 2 and 3). Accepting both renumbers lessons 5 to 45.
  - Unit 2's order (decision 4).
  - The longer-text length is still open (decision 1). It drives the 1,800-word cap for 21, 37, 44 and 57.
  - Five lessons sit at the 1,200-word grammar limit (decision 8).
  - Sensitive topics (decision 16).
  - About 60 cognates and 7 new meanings still need adding to scripts/b2-lists.ts.
- **Not done:**
  - Every "check before writing" item was resolved against the A1 to B1 vocab. One B1 gap turned up: b1-making-a-complaint uses *c'est-à-dire* with no vocab entry, so b2-logical-connectors now defines it.
  - The 250 to 400-word longer-text range wasn't applied (decision 1).
  - docs/syllabus.md isn't changed yet; that waits for decisions 2 to 4 and 18.

## B2 plan, second pass (decisions applied)

- **Order:** the syllabus and the B2 outline use the new order. Unit 1 has 8 lessons, Unit 3 has 10 and Unit 6 has 5, with no unit renamed.
  - b2-logical-connectors follows b2-concession-opposition.
  - b2-nominalisation precedes b2-summarizing-an-article and is re-planned for news and politics vocabulary. It doesn't overlap b2-politics-and-society or b2-reporting-verbs.
  - Unit 2 is reordered, ending with b2-regret-and-reproach.
  - Every prerequisite change is applied, plus b1-ce-qui-ce-que for b2-relative-prepositions. The two review lessons' prerequisites are fixed.
- **Plans:**
  - Every plan block is renumbered and in its new unit file, with the conditional "if decision…" text resolved.
  - The trims from decision 8 and the additions from decision 14 are in, all within their limits.
  - The subjonctif-passé fixed-phrase note is gone from b2-regret-and-reproach. docs/review-needed.md has no B2 entries yet, so nothing there changed.
- **CLAUDE.md:**
  - longer texts are 150 to 250 words
  - grammar lessons need 12 or more vocab entries
  - En résumé follows the lesson's current unit
  - there's a sensitive-topics rule
  - the Workflow points to docs/plans/b2
  - lessons are named by id
- **Scripts:**
  - **scripts/b2-lists.ts:** the plans' cognates and the 7 new meanings.
  - **audit:content:** the grammar vocab minimum and the longer-text check.
  - **check:structures:**
    - pour que, the concessive relatives, the extended connectors and *le fait que* are mapped to their lessons
    - *il semble que* is no longer mapped to b2-certainty-and-probability (b2-nuancing-opinions teaches it)
    - accent-initial patterns now match (they never did before)
  - **test:content:** a B2 syllabus-order check, with a fixture.
- **Checks:**
  - Re-run on the new order, every check is clean: no structure or word used early, no cycles, nothing over 6 prerequisites, all 59 plans match the syllabus, and all sizes are within the limits.
  - validate:content, test:content, test:checker (29/29), audit:content, check:words, check:structures, lint and build all pass.
  - The A1 to B1 output is identical to the baseline, apart from the new B2 audit rows.
- **New problems:** 3, in docs/b2-plan-review-2.md:
  - four grammar lessons in a row in Unit 1
  - Unit 3 has 10 lessons
  - B1's *c'est-à-dire* gap
- **Not done:** check:structures can't detect *à* + infinitive with a passive sense.
