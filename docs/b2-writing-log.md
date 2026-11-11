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
