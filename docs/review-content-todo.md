# Daily review: content follow-ups

Content tasks found while building the daily review (docs/plans/review.md). None has been done yet. Each one changes lesson vocab, so it needs the usual checks and a native-speaker review before it's published.

## 1. Gender notes for the `l'` words (decision 4)

- **The problem:** a review card shows the French with its article, which shows the gender. An elided *l'* hides it: *l'arbre* (m.), *l'eau* (f.). The card can't tell the learner which it is.
- **How many:**
  - 190 vocab entries start with *l'* (the plan's audit, glossary entries included).
  - As review cards: 189 (A1 36, A2 16, B1 19, B2 23, C1 60, C2 35). 141 of them have no `note` at all.
- **What to add:** a short gender note on each entry, in the vocab `note` field, which the card shows with the answer. For example "masculine (un arbre)" or "feminine (une eau)". An entry that already has a note gets the gender added to it.
- **Rules:**
  - A note is text only, so card ids don't change and validate:content's published-id check stays green.
  - The card catalogue must be rebuilt afterwards (`npm run build:review-cards`). The totals don't change.
  - Words whose gender varies (*l'enfant*, either gender by the person; *l'après-midi*, both accepted) get the note that fits the lesson's use; list them for the reviewer.
- **Review:** every gender is a claim a fluent speaker should confirm. Add the batch to the native-review lists (docs/c1-review-items.md, docs/c2-review-items.md and their B1 and B2 equivalents) under each lesson id.
- **To list them:** cards whose `fr` starts with *l'* (straight or curly apostrophe), in lib/generated/review-cards-free.json and review-cards-paid.json.
