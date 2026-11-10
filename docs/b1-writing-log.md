# B1 writing log

Summaries of each B1 writing batch, as reported at the end of the batch.

## Unit 4

**Lessons written:** all seven Unit 4 lessons (orders 20–26):
- b1-subjonctif-formation
- b1-subjonctif-irregular
- b1-subjonctif-necessity
- b1-subjonctif-wishes-emotions
- b1-subjunctive-vs-infinitive
- b1-expressing-doubt-certainty
- b1-review-subjunctive

None existed before this batch, and the plan matched docs/syllabus.md.

**Checks:** validate:content (131 lessons), test:content, test:checker (29/29) and build all pass. audit:content raises no new flags, and check:words finds 0 undefined words in B1.

**Every lesson:**
- 12–15 vocab entries (6 in the review, all used)
- 13–14 exercises, each with 2–3 production tasks and a reorder
- a new warning and tip
- 25 claims added to docs/review-needed.md
- no new fixed phrases

**Decisions the plan didn't cover:**
- **Structures that crept in early, rewritten:**
  - *chacun* (lesson 39)
  - *être obligé de* (lesson 52)
  - *une offre* (lesson 27)
  - a double pronoun, *tu me le demandes* (lesson 30)
- **Undefined words, reworded:** *passeport*, *patron*, *attention*, *quoi* and *ensemble* (which is defined only in lesson 24).
- **Distractors:** in lesson 25, *viendra* after *je ne suis pas sûr que* was dropped as a distractor, because informal French accepts it.
- **Lesson length:** five lessons came in under 600 words of teaching text. I added a present-versus-subjunctive table (21), *je suis désolé que* (23), a "Polite doubt" section (25), and short notes in 24 and 26.
- **check:words:** it now ignores a few irregular forms (*nourrisse*, *envoies*, *préviens*) and more English answer options.

**Unresolved:**
- The A1/A2 backlog in check:words is still 111 words.
- List items that start with French italics count as text lines, so teaching-text sections should start their bullet points with English.

## Unit 5

**Lessons written:** all eight Unit 5 lessons (orders 27–34):
- b1-careers-and-job-hunting
- b1-cover-letter
- b1-job-interview
- b1-double-object-pronouns
- b1-possessive-pronouns
- b1-demonstrative-pronouns
- b1-culture-work-life
- b1-review-work

None existed before this batch, and the plan matched docs/syllabus.md.

**Checks:** validate:content (139 lessons), test:content, test:checker (29/29) and build all pass. audit:content raises no new flags, and check:words finds 0 undefined words in B1.

**Every lesson:**
- 12–25 vocab entries (6 in the review, all used)
- 13–14 exercises, each with at least two production tasks and a reorder
- a new warning and tip
- dialogues with consistent *tu* or *vous*

**Fixed phrases** (listed in docs/review-needed.md with about 30 claims, culture facts included): the full closing formula *Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées* (lessons 28 and 34) and *Veuillez agréer…*.

**Decisions the plan didn't cover:**
- **Added vocab:**
  - *envoyer*, *une équipe* and *un client / une cliente*, added to lesson 27 (now 25 entries) because the whole unit needs them and nothing earlier defined them
  - *une question*, added to lesson 29
- **Lesson 31:** its dialogue had used *celle de* and *celui de* (lesson 32), so I rewrote those lines.
- **Words and structures, reworded:**
  - lesson 33's *plusieurs* (lesson 39)
  - *tout le monde*
  - about twenty undefined words, such as *réceptionniste* (now *serveur*), *camping*, *tiroir*, *exigeante* and *perfectionniste*
- **Teaching text:** five lessons were short. I added:
  - a job-search section (27)
  - a formal-versus-friendly table (28)
  - a phrase table and a grammar walk-through (34)
  - short notes in 31 and 32
- **strictAccents:** set on three exercises.

**Unresolved:** the A1/A2 backlog in check:words is now 110 words.

## Unit 6

- **Lessons written (35–41):** media-and-news, technology-and-internet, reported-speech-present, gerondif, indefinite-pronouns, interrogative-lequel, review-media. None existed before this run, and the plan matched the syllabus.
- **All checks pass:** check:words (0 undefined in B1), validate, test:content, test:checker (29/29), audit (no Unit 6 hits) and build.
- **Decisions the plan didn't cover:**
  - Vocab added at first use:
    - *la radio* (35)
    - *internet* and *un mail* (36)
    - *tout le monde* (39), with its singular verb
  - Words I reworded around instead of defining: *élection*, *pollution*, *immobilier*, *podcast* in lesson 36, *carnet*, *accident*, *poche*, *chinois*, *centaines*, *partout*, *se promener*.
  - The review model uses *en rentrant chez elle* for its gérondif. It avoids *grâce à* and the passive, because both come later.
  - Added *Rex* to the IGNORE list in scripts/check-words.ts.
  - Headline style (*Le musée fermé dimanche*) is logged as a fixed phrase.
- **Unresolved, for a French speaker:**
  - docs/review-needed.md now has entries for all seven lessons.
  - The riskiest claims:
    - the *aucun* agreement rules
    - *quelque chose de* + adjective
    - the conditional reading of *en partant tôt*
    - "*Chacun son goût*" versus *À chacun son goût*
    - the *contrôler* versus *vérifier* warning

## Unit 7

- **Lessons written (42–47):** environment, cause-and-consequence, passive-voice-intro, presenting-an-argument, culture-french-republic, review-society.
  - None of these lessons existed before this run.
  - The plan matched the syllabus on every id, order, type and prerequisite.
- **All checks pass:** check:words (0 undefined in B1), validate:content, test:content, test:checker (29/29), audit:content (no Unit 7 hits) and build.
- **Decisions the plan didn't cover:**
  - Vocab added:
    - *une canicule* and *la chaleur* (43)
    - *le président / la présidente* (44), which no lesson defined yet and lesson 46 needs
    - *un buste*, *représenter*, *une loi*, *une religion*, *la Révolution française* and *le conseil municipal* (46)
  - The plan says citizens elect the mayor. The lesson says the town council chooses the mayor, which is how it works in France.
  - Lesson 44 got a dialogue the plan didn't ask for. It uses only the present and passé composé passive, so the pluperfect passive was removed.
  - *La cantine* was already taught in A2, so the review stays at its 6 planned words.
  - Undefined words were reworded rather than defined, for example *légumes*, *nourriture*, *jeter*, *lumière*, *électricité*, *agréable*, *surtout* and *mur*.
  - scripts/check-words.ts: added the *agissons* forms to the IGNORE list, and "firstly" and "three" to the English list.
- **Unresolved, for a French speaker:**
  - docs/review-needed.md has entries for all six lessons.
  - The riskiest are:
    - *il est vrai que* + indicative
    - *car* never starting a sentence
    - the passive agreement rules
    - the dates and election facts in lesson 46

## Unit 8

- **Lessons written (48–54):** housing-and-renting, money-and-banking, ne-que-ni-ni, formal-email, making-a-complaint, travel-problems, review-home-money-problems.
  - None existed before this run.
  - The plan matched the syllabus on every id, order, type and prerequisite.
- **All checks pass:** check:words (0 undefined in B1), validate, test:content, test:checker (29/29), audit (no Unit 8 hits) and build.
- **Decisions the plan didn't cover:**
  - All vocab lists match the plans exactly.
  - Undefined words were reworded instead of defined: *électrique*, *université*, *il me reste*, *s'inscrire*, *chef*, *voisins*, *régler*, *départ*, *gratuit*, *recevoir*, *réception*, *pourtant* and others.
  - The formal-email tip first repeated the cover-letter "template" tip, so I replaced it with a new one, "The ten-second test".
  - The deposit amount is a plain figure in the dialogue, so no legal rule is stated. Lesson 53 states no compensation rules.
  - *Je n'ai ni le temps ni l'argent* is accepted alongside the article-less answer.
  - scripts/check-words.ts: added the irregular forms of *se plaindre* to the IGNORE list.
- **Unresolved, for a French speaker:**
  - docs/review-needed.md has entries for all seven lessons, plus the *veuillez* fixed phrases.
  - The riskiest are:
    - the article rules after *ne… que* and *ni*
    - the plural verb after *ni Paul ni Marie*
    - *Cordialement* versus *Je vous prie d'agréer* in emails
    - *plainte* versus *réclamation*
