# B2 browser test: the four new exercise types

The B2 exercise types `reformulation`, `register-shift`, `error-correction` and `connector-choice` are graded by lib/check-answer.ts and pass test:checker, but they haven't been tried in a browser. Run `npm run dev`, open each lesson at `/lessons/b2/<slug>`, and try the exercises below. Exercise numbers are the order on the page (ex001 is the first).

## What to check on every typed exercise

For each exercise, type these five answers in turn:

1. **Correct:** the first listed answer exactly. Expect "correct" and the score to go up once.
2. **Wrong:** change one word. Expect "wrong", the expected answer shown, and no score.
3. **No accents:** the right answer without accents (*a ete* for *a été*). Expect the "right except for a missing accent" message. Where the exercise has strictAccents, expect it not to count as fully correct.
4. **No capitals:** the right answer in lowercase. Expect "correct".
5. **Curly apostrophe:** type *l’exposition* with a curly apostrophe (’). Expect "correct".

Also check that the English feedback (the explanation) appears after you answer, that the score at the end counts each exercise once, and that a second correct answer listed in `answers` is accepted too.

## Reformulation

| Lesson (slug) | Exercise | What it tests |
|---|---|---|
| registers | ex009 | *Paul vient-il ?*: a hyphen and a question mark in the answer. |
| tout | ex009 | Two accepted answers (*Les invités sont tous venus*, *Ils sont tous venus*). |
| science-and-research | ex010 | The passive, with strictAccents (*a été*), and two word orders. |

## Register-shift

| Lesson (slug) | Exercise | What it tests |
|---|---|---|
| colloquial-french | ex008 | Three accepted answers, two sentences in one answer, and strictAccents (*où*). |
| registers | ex008 | An answer with a dropped *ne* (*Je bosse pas demain*), which should be accepted. |
| describing-a-work-of-art | ex006 | Three accepted answers, including *C'est un tableau saisissant* (apostrophe). |

## Error-correction

| Lesson (slug) | Exercise | What it tests |
|---|---|---|
| false-friends | ex010 | strictAccents on *à*: typing *assiste a la reunion* should not count as fully correct. |
| tout | ex010 | A one-word change inside a long sentence (*toutes* → *tous*). |
| arts-and-literature | ex011 | A word replacement (*comédien* → *humoriste*). |

## Connector-choice

| Lesson (slug) | Exercise | What to check |
|---|---|---|
| tout | ex007 | The chosen option fills the ___ gap at the start of the sentence (*En tout cas, nous commencerons…*). |
| debating | ex005 | An option that ends with a colon (*Permettez-moi de vous contredire :*): check the spacing once it's in the gap. |
| registers | ex005 | *Aussi* fills a gap before an inversion (*Aussi sommes-nous arrivés…*); check the capital stays. |

For connector-choice, also check that the options are buttons, not a text box, that a wrong choice shows the right one, and that the filled sentence reads correctly once the gap is filled.

## Reorder with a repeated word

| Lesson (slug) | Exercise | What to check |
|---|---|---|
| review-what-might-have-been | ex016 | The chip *a* appears twice. Tap each one: both should move, separately, and the sentence *Ma vie a basculé il y a dix ans* should be accepted whichever *a* you place first. |

## Report

For each exercise, note: lesson, exercise number, which of the five inputs behaved unexpectedly, and what the page showed.
