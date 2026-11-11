# Parlons: French learning site
- Goal: text-only French site for English speakers, A1 to C1 (C2 later). Lessons, vocab and exercises exist for A1 and A2 and B1 to C1 are being written. Later phases: Supabase auth, progress storage, spaced repetition, streaks, progress dashboard.
- Stack: Next.js (App Router, TypeScript, Tailwind v4, no src/ directory). Lessons are MDX files in content/lessons/, parsed with gray-matter and rendered with next-mdx-remote/rsc plus remark-gfm. Later: Supabase (auth + Postgres), deployed on Vercel.
- All file reading lives in lib/lessons.ts so we can swap to a DB/CMS later without touching pages.
- Exercise and vocab items must have stable IDs that never change once published.
- Lessons live in content/lessons/<level>/<slug>.mdx (a1…c2) and are served at /lessons/<level>/<slug>. Frontmatter: id, title, description, level, unit, order (within the level, across units), type, tags, prerequisites, related. Lesson `id`s are permanent and independent of the filename; link between lessons with `<LessonLink id="…" />`, never a hard-coded URL. If a slug changes, add a redirect in next.config.ts.
- Backlinks ("Builds on this"), same-topic suggestions and prev/next are computed in lib/lessons.ts, never hand-written.
- `npm run validate:content` (scripts/validate-content.ts) checks frontmatter and links; it runs automatically before `npm run build`.
- `npm run audit:content` (scripts/audit-content.ts) regenerates docs/all-data.md and docs/audit-report.md. It never fails; read the summary table it prints.
- Optional frontmatter `vocab` (id, fr, pron, en, group?, note?) is shown with `<VocabTable />` or `<VocabTable group="…" />`. `exercises` (id, type: multiple-choice | fill-in | translate | reorder, prompt, options?, words?, answers, explanation) follow the Lesson writing rules below. Vocab and exercise ids are unique site-wide (`<lesson-id>-v001`, `<lesson-id>-ex001`). Pronunciation respellings go only in `pron`.
- docs/syllabus.md is the plan for every lesson (ids, units, prerequisites). Keep new lessons consistent with it.
- Prefer simple code. Don't add dependencies without telling me why.
- I'm on Windows (PowerShell). Use commands that work there.

## Workflow
- Before writing any lesson in a new unit, write the plan to docs/<level>-<unit>-plan.md and wait for approval.
- After every batch, run npm run validate:content, npm run test:content, npm run test:checker, npm run audit:content and npm run build, fix errors, and report only real changes, not known non-defects (duplicate vocab across lessons, accent pairs like la/là). List what changed per file. Never commit.
- When a lesson's scope changes, update docs/syllabus.md in the same batch and tell me.
- B2 steps, in order:
  1. The B2 conventions below, and the checks behind them, come first.
  2. Write docs/b2-plan-overview.md (every lesson's scope, structures, prerequisites, and what's avoided or labelled) and wait for its review and approval.
  3. Before each unit, write docs/b2-unit-NN-plan.md and wait for approval.
  4. Write one unit per prompt.
  5. After each unit, also run npm run check:words and npm run check:structures, fix every hit, and append the reply to docs/b2-writing-log.md under "Unit N".

## Lesson style
- Open with one sentence: "By the end of this lesson you'll…". End with "## What's next", linking the next lesson with <LessonLink>.
- Write in the second person, friendly and direct, in short plain sentences. British spelling with -ize (neighbour, practise, organize). No em dashes.
- In running text, French is in italics with the English in brackets straight after it: *J'ai envie de sortir* (I feel like going out). Bold marks the key form being taught or contrasted.
- Explain a rule in one or two sentences, then show it. Put each standalone model sentence in an <Example>, and put a <VocabTable group="…"> right after the heading or sentence that introduces its words.
- When a word or rule was taught earlier, say so and link it: "You've already seen *avoir envie de* in <LessonLink …>".
- Keep sections short, with plain headings. Most lessons have an "En français" dialogue of about four lines with translations. Grammar lessons often end with a one-place summary ("The whole list"); culture lessons give each fact a short paragraph led by the bold French name.
- Callouts go near the end, before "What's next". The warning names one specific learner mistake and gives the correct form in bold. The tip gives one concrete habit or strategy.

## Lesson writing rules

### Vocab and links
- Every French word used in an example, dialogue or exercise must be defined in a vocab entry of that lesson or of an earlier lesson in course order (any level). Define it at first use. Before finishing a lesson, list any word that isn't defined.
- One vocab entry per concept. Don't create two entries for the same meaning (for example, alternate word orders of the same question go in one entry).
- "You know X from the lesson on Y" and similar links must point to a lesson that actually teaches X in its vocab or text. Never credit a review lesson for a word it only recycles. Never write "from the review of … and the lessons before it".
- Use <LessonLink text="..."> when the lesson title wouldn't read naturally inside the sentence.
- Every entry in a review lesson's new-words table must appear in its model, its task or an exercise.
- Don't use a verb form or structure before its lesson (for example the conditional) except as a labelled fixed phrase. List any such phrase in docs/review-needed.md.

### Dialogues
- Each line must be answerable by the next speaker, roles stay consistent, and tu or vous stays consistent within a dialogue.

### Exercises
- Exercise types in use: multiple-choice, fill-in, translate, reorder.
- Exercise answers: list only genuinely different phrasings. Do NOT list accent-less spelling variants, or variants that differ only in capitals, final punctuation or apostrophe style. The answer checker (lib/check-answer.ts) normalizes accents, capitals, punctuation and apostrophes when comparing, and tells the learner when an answer was right except for a missing accent (it doesn't silently accept it, because accents can change meaning: ou/où, a/à, sur/sûr).
- Set strictAccents: true when an accepted answer contains a word whose unaccented spelling is a different word or verb form a learner could plausibly confuse (a/à, ou/où, parle/parlé, mange/mangé, aime/aimé, passe/passé). la/là, du/dû, des/dès and sur/sûr may stay false.
- Don't write fill-in or translate exercises whose answer depends on capital letters. Use multiple-choice for those.
- When the answer depends on the speaker's gender, say so in the prompt, for example "(a woman speaking)". Never leave an exercise with two valid answers that differ by gender unless both are accepted.
- Exercises must stand alone. Don't refer to "the model text" unless the sentence is quoted in the prompt.
- Distractors in multiple-choice must be clearly wrong, never a grammatical alternative.

### Lesson structure
- Every lesson has at least 450 words of teaching text, a warning callout, a tip callout and at least one reorder exercise (alphabet and pure-recognition lessons excepted).
- Vary the tip callouts across lessons. Don't repeat an idea an earlier lesson already used.
- Prerequisites: list a lesson only when this lesson directly uses something it teaches and no other listed prerequisite already implies it. Prefer one nearby anchor lesson over several far ones. Aim for about four, and never more than six (final reviews excepted).
- When a lesson is used as the format reference for other tools, use content/lessons/a1/etre-present.mdx (a1-etre-present) as the model.

### Pronunciation respellings
Key, checked against every `pron` field in content/lessons:
- Syllables are separated by hyphens, words by spaces. The stressed syllable is in capitals (bohn-ZHOOR, uhn tay-lay-FONN). One-syllable entries on their own are lowercase (leer, deer), as are short unstressed items (luh, kess-kuh).
- Vowels: ah = a; ay = é, -er, -ez; eh = è, ê, ai, ei at the end of a syllable (PLEH, feh-TAY); before a consonant in the same syllable, write plain e (BEL, suh-MEN, FET, eel PREN); ehr = -ère, -erre, -aire, and er before a consonant (fehr, dehr-NYEHR, pehr-SONN); ee = i, y; oh = o, au, eau (o before a consonant in the same syllable: dor-MEER, LOMM); oo = ou; ew = u; uh = eu, e (schwa), with uhr for -eur; wah = oi; wee = ui (kwee-ZEEN).
- Nasals: an = in, ain, ein, -ien (koh-PAN, LYAN); ahn = an, en, am, em; ohn = on, om; uhn = un.
- Non-nasal on and om are onn and omm (bonn, LOMM). For a non-nasal an, the n starts the next syllable (ah-NAY). There is no "ahnn".
- Consonants: zh = j, and g before e or i; sh = ch; ny = gn (es-pah-NYOL, lahl-MAH-nyuh); k = c, qu; ss = soft s, ç.
- y marks the glide: inside a word before a vowel (ray-vay-YOHN, mwah-YEN), and as its own final syllable for -ille and -eil (fah-MEE-y, foh-TUH-y).
- A final -uh shows a mute e that's heard after a consonant cluster (LEE-vruh, MAH-nyuh). Otherwise a final e isn't shown (suh-MEN).
- Liaison moves the consonant onto the next word (lay-zahn-FAHN, uh-nah-par-tuh-MAHN).
- English loanwords keep their English sounds (sahnd-WEECH, luh JEEN, wee-KEND).
- c'est is "seh" (c'était is "say-TEH"). Endings in -ère, -erre and -aire use "-TEHR" style, never "-TAIR". The only exception is the letter R in a1-alphabet-and-accents ("air").

### Review
- Add every claim a fluent speaker should confirm, and anything else uncertain, to docs/review-needed.md under the lesson id, with the exact sentence. Group entries by lesson, and order them from riskiest (grammar claims) to simplest (facts).

## B1 conventions
These apply to B1 only. Where they differ from the general rules, they win.
- Teaching text is in English. Every French example, dialogue line and exercise sentence has an English translation. Exercise prompts are in English at B1. The final B1 review includes a callout that teaches the French instruction words (Complétez, Choisissez, Mettez dans l'ordre, Traduisez).
- Teaching text is 600 to 800 words (grammar lessons may reach 900). It's counted by `npm run audit:content` as everything rendered except vocab tables, the "En français" dialogue and any longer-text section (a section made mostly of French text lines); callouts count wherever they are. The whole lesson stays under 1300 words. Vocab has 12 to 25 entries, except in review lessons, which have 3 to 8 new words, all used in the model, the task or an exercise. Dialogues have 8 to 10 lines.
- Every communication lesson includes one longer realistic text (an email, a message thread or a short article) with a full translation.
- 12 to 14 exercises per lesson, with at least two production tasks (translate, rewrite or write out a short paragraph) and at least one reorder.
- Use only structures taught in A1, A2 or earlier B1 lessons in course order. Labelled fixed phrases are allowed, and each one goes in docs/review-needed.md. Mark formal and informal registers in examples.
- Cultural claims (facts, dates, customs) go in docs/review-needed.md with the exact sentence.
- Bullet points in teaching-text sections start with English, because lines starting with French italics are counted as dialogue or longer text.

## B2 conventions
B2 inherits every B1 rule unless it's overridden here. They apply to B2 lessons only.
- **Teaching text** is in English.
  - The first time a French term appears in B2, it's in italics with its English; after that, the French alone is fine.
  - Every French example in the teaching text is translated.
  - Teaching bullets still start with English.
- **En résumé.** Every grammar and vocabulary lesson ends with a `## En résumé` section, just before "What's next". Review, communication and culture lessons don't have one.
  - It's a recap in plain French prose (no italics, no translation) that only restates what the English taught, with no new information.
  - It uses only words and structures from earlier lessons or from this lesson.
  - Length: 60 to 100 words in Units 1 to 4, and 100 to 150 in Units 5 to 8.
  - The audit leaves it out of the teaching text but counts it in the whole lesson.
- **Exercise instructions** are in French, from this fixed list of *vous* forms: Complétez, Choisissez, Indiquez, Reformulez, Transformez, Corrigez, Remettez dans l'ordre, Conjuguez, Accordez, Mettez au… (à la…, aux…), Répondez, Rédigez, Traduisez, Trouvez.
  - The instructions may also use: la phrase, le mot, le verbe, la forme, la bonne réponse, le connecteur, l'erreur, le registre, soutenu, familier, courant, le temps, le texte.
  - b2-nuancing-opinions (lesson 1) introduces the list in a callout with English glosses. After that, check:words treats these words as known in every B2 lesson.
  - Feedback and explanations stay in English.
  - The list is also in scripts/b2-lists.ts (INSTRUCTION_VERBS and INSTRUCTION_NOUNS); keep the two in step.
- **Lengths.**
  - Teaching text: 800 to 1,100 words (1,200 for grammar). The whole lesson stays under 1,800.
  - Vocab: 15 to 30 entries, not counting glossary entries. Review lessons keep 3 to 8 new words.
  - Exercises: 14 to 16, with at least 3 production tasks (translate, reformulation, register-shift or error-correction), 1 reorder and 1 reformulation.
  - Dialogues: 10 to 14 lines.
  - Communication and culture lessons each have one longer text. Its word range isn't set yet: the planned 250 to 400 words wasn't applied, because B1 longer texts average 89 French words (see docs/b2-writing-log.md).
- **New exercise types:** `reformulation`, `register-shift` and `error-correction` are typed answers. `connector-choice` picks from `options` to fill a ___ gap in the prompt. All four are graded by lib/check-answer.ts against `answers`, and the validator rejects them below B2.
  - There's no free open writing: writing tasks keep the B1 model-answer pattern.
- **Longer texts are original.**
  - They may imitate real formats (an article, an opinion piece, a formal letter, a forum post, an interview).
  - They never copy or paraphrase a real article, and they never invent quotes from real people.
  - A glossary covers every word that isn't in an earlier vocab entry, except allowlisted cognates. Glossary entries are vocab entries with `group: "glossary"`, shown with `<VocabTable group="glossary" />` right after the text, and each one must be used in a longer text.
- **Vocabulary.**
  - Transparent cognates (such as *la démocratie*) in the COGNATES list in scripts/b2-lists.ts need no entry. False friends never go on that list: they always get a vocab entry or a gloss.
  - A B2 vocab entry may not repeat an A1 to B1 entry, unless it's a new meaning listed in NEW_MEANINGS (scripts/b2-lists.ts) with the reason. The audit reports any other repeat as an error.
- **No repeats.**
  - A B2 lesson recaps earlier material in at most 2 or 3 sentences, with a LessonLink to the lesson that taught it, then teaches only what's new.
  - No French example sentence or tip is copied from an earlier level (the audit checks identical sentences and tip texts).
- **Structures.**
  - The teaching text, exercises and En résumé are strict.
  - A longer text may use at most 2 untaught structures. Each one is glossed in an English line inside the same section that starts with `Note:` and names the form in italics, for example "Note: *qu'il soit parti* is the past subjunctive, taught later in B2." check:structures counts these against the cap.
- **Respellings:** every vocab entry has `pron`, using the same key as now.
- **Passé simple** is for recognition only. Its recognition section is in lesson 46 (b2-arts-and-literature).
  - Don't use it before lesson 46.
  - After that, use it only in literary and historical texts and in recognition exercises, never in an answer the learner has to type.
- **Register.**
  - Spoken features (dropped *ne*, *on* for *nous*, *ça* for *cela*) are labelled as spoken, and kept out of exercise answers before lessons 53 and 54 (b2-registers, b2-colloquial-french).
  - Regional variants (Belgium, Switzerland, Québec, Africa) appear only when labelled.
  - The tu and vous rules continue.
- **Facts:** uncertain facts go in docs/review-needed.md. Give no legal or official figures.

@AGENTS.md
