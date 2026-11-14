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
  2. Write the plan in docs/plans/b2/ (overview.md and unit-1.md to unit-8.md: every lesson's scope, structures, prerequisites, and what's avoided or labelled) and wait for its review and approval (docs/b2-plan-review.md).
  3. Before each unit, check its plan file against the current syllabus order and wait for approval.
  4. Write one unit per prompt.
  5. After each unit, also run npm run check:words and npm run check:structures, fix every hit, and append the reply to docs/b2-writing-log.md under "Unit N". Before that, self-check every reformulation, translate and error-correction exercise: "could a learner using only taught material give a valid answer that isn't listed?" If so, add it or pin the cue.

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
  - Length: 60 to 100 words in Units 1 to 4, and 100 to 150 in Units 5 to 8, following the unit the lesson sits in now in docs/syllabus.md (the audit reads it from there).
  - The audit leaves it out of the teaching text but counts it in the whole lesson.
- **Exercise instructions** are in French, from this fixed list of *vous* forms: Complétez, Choisissez, Indiquez, Reformulez, Transformez, Corrigez, Remettez dans l'ordre, Conjuguez, Accordez, Mettez au… (à la…, aux…), Répondez, Rédigez, Traduisez, Trouvez.
  - The instructions may also use: la phrase, le mot, le verbe, la forme, le sens, la bonne réponse, le connecteur, l'erreur, le registre, soutenu, familier, courant, le temps, le texte.
  - b2-nuancing-opinions introduces the list in a callout with English glosses. After that, check:words treats these words as known in every B2 lesson.
  - Feedback and explanations stay in English.
  - The list is also in scripts/b2-lists.ts (INSTRUCTION_VERBS and INSTRUCTION_NOUNS); keep the two in step.
- **Lengths.**
  - Teaching text: 800 to 1,100 words (1,200 for grammar). The whole lesson stays under 1,800.
  - Vocab: 15 to 30 entries (12 to 30 in grammar lessons), not counting glossary entries. Review lessons keep 3 to 8 new words.
  - Exercises: 14 to 16, with at least 3 production tasks (translate, reformulation, register-shift or error-correction), 1 reorder and 1 reformulation.
  - Dialogues: 10 to 14 lines.
  - Communication and culture lessons each have one longer text of 150 to 250 French words, counted in the longer-text sections (B1's averaged 89, so this is the next step up).
- **New exercise types:** `reformulation`, `register-shift` and `error-correction` are typed answers. `connector-choice` picks from `options` to fill a ___ gap in the prompt. All four are graded by lib/check-answer.ts against `answers`, and the validator rejects them below B2.
  - There's no free open writing: writing tasks keep the B1 model-answer pattern.
- **Accepted answers.** For every reformulation, translate and error-correction exercise, either list every valid answer that uses only structures and words taught so far, or pin the cue so that only one answer is valid. Valid answers include:
  - word-order variants
  - other taught connectors that the English cue allows
  - the lesson's own alternative structures
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
- **Claims.**
  - Check every "you know X from lesson Y" sentence against lesson Y's vocab or text before you write it. If Y doesn't teach X, or teaches it with another meaning, fix the link or the sentence.
  - Make no "always" or "never" claim unless it holds across all B2 lessons, including later ones (for example, *si* takes the conditionnel in indirect questions, so the rule is "no conditionnel after *si* meaning 'if'"). Otherwise, limit the claim to this lesson's uses.
- **Fixed phrases.** check:words works word by word, so a phrase made of known words but never taught as a phrase passes it (*de nouveau*, *d'ici là*, *avoir lieu*, *avoir du mal à*, *une fois que*). Check by hand for such phrases in the teaching text, dialogues, exercises and glossaries. Define each one at first use, or replace it with taught French.
- **Participle agreement.** Agreement of the past participle with a preceding direct object is taught at A2 (a2-pronouns-in-passe-compose, a2-relative-qui-que-ou, a2-reflexive-passe-compose). Use it freely in B2 dialogues, texts and exercises, and list the accepted variants.
- **Self-audit.**
  - An example or table that contrasts two moods or tenses must use verbs whose forms differ in the two (not *qui explique*, which is the same in both moods).
  - Check every dialogue line and example against each rule the lesson states (mood, repeated preposition, agreement, same subject). A line may not break the lesson's own rule.
  - Every vocab entry is used in a complete French sentence in the text (an Example, a dialogue or longer-text line, the En résumé), the dialogue or an exercise. Naming it or glossing it inside an English sentence doesn't count. audit:content checks this for B2 ("B2 vocab entry not used in a complete sentence").
  - A paragraph exercise must make sense as one coherent text.
  - A rule of thumb in a grammar lesson is called one, and isn't stated as a rule, when the lesson's own list has exceptions.
  - A model text keeps one narrative tense per paragraph (for example the passé simple or the historical present, not both).
  - State a grammar rule by its real test, not an approximation (for example "same subject", not "the same person benefits").
  - Tips and rules don't say "always", "never", "almost always" or "most common" unless the lesson's own examples agree.
  - An example that illustrates a mood contrast uses a verb whose forms differ between the moods (not *donnent*, *reste* or *invites*).
  - A distractor must be wrong in its sentence, and a rule tested in an exercise must be explained in that lesson or an earlier one.
- **Structures.**
  - The teaching text, exercises and En résumé are strict.
  - A longer text may use at most 2 untaught structures. Each one is glossed in an English line inside the same section that starts with `Note:` and names the form in italics, for example "Note: *qu'il soit parti* is the past subjunctive, taught later in B2." check:structures counts these against the cap.
- **Respellings:** every vocab entry has `pron`, using the same key as now.
- **Passé simple** is for recognition only. Its recognition section is in b2-arts-and-literature.
  - Don't use it before b2-arts-and-literature.
  - After that, use it only in literary and historical texts and in recognition exercises, never in an answer the learner has to type.
- **Register.**
  - Spoken features (dropped *ne*, *on* for *nous*, *ça* for *cela*) are labelled as spoken, and kept out of exercise answers before b2-registers and b2-colloquial-french.
  - Regional variants (Belgium, Switzerland, Québec, Africa) appear only when labelled.
  - The tu and vous rules continue.
- **Facts:** uncertain facts go in docs/review-needed.md. Give no legal or official figures.
- **Sensitive topics:** immigration, decolonization and the Algerian war, attacks on the satirical press, and ethnic slang.
  - Give neutral facts only, with no figures.
  - The press lesson doesn't mention the attacks.
  - The slang lesson has no ethnic terms.
  - List every such sentence in docs/review-needed.md.

## C1 conventions
C1 inherits every B2 convention unless it's changed here. Plans are in docs/plans/c1/; the coverage map of what A1 to B2 already teach is docs/c1-coverage.md (built by scripts/c1-lists.ts).
- **Teaching language.**
  - Grammar rules and nuance are still explained in English: a C1 learner reads French well, but a rule misunderstood in French is a rule learned wrong.
  - Short French glosses inside the English are allowed (*le passé simple, temps du récit*), but the English sentence must make sense without them.
  - Every French example, dialogue line and longer text keeps an English translation. The one exception: a line that only repeats an example already translated earlier in the same lesson.
- **Lengths.**
  - Teaching text: 900 to 1,200 words (1,300 for grammar). The whole lesson stays under 2,100.
  - Vocab: 15 to 30 entries (12 to 30 in grammar lessons), not counting glossary entries. Review lessons keep 3 to 8 new words.
  - Exercises: 15 to 18, with at least 4 production tasks, 1 reorder and 1 reformulation.
  - Dialogues: 12 to 16 lines.
  - En résumé (grammar and vocabulary lessons): 120 to 180 words in every unit.
  - Longer texts (communication, culture and review lessons): 250 to 400 French words, with a glossary.
- **Exercise types.** The B2 types stay: multiple-choice, fill-in, translate, reorder, reformulation, register-shift, error-correction and connector-choice. No new type is added, because lib/check-answer.ts can only grade a fixed list of answers; open writing keeps the model-answer pattern.
- **Instructions.** The B2 list stays. Add only **Résumez** (summarize) and **Justifiez** (give the reason), for synthesis and essay tasks graded by model answer, and add them to INSTRUCTION_VERBS in scripts/b2-lists.ts at the same time.
- **Literary tenses.**
  - Passé simple: production is allowed from c1-passe-simple on, in narrative writing only (a story, a historical account). Not in dialogue or an everyday register.
  - Passé antérieur: production in narrative writing from its lesson.
  - Imparfait and plus-que-parfait du subjonctif: recognition, plus light production in formal writing only, from c1-imperfect-subjunctive. No typed answer may require them; where they're possible, the present or passé subjunctive is also accepted.
- **Exam practice.** Practice lessons in the style of the DALF C1 name no timings, task formats, scoring or rules of the exam: "a short exposé from a short document", "a synthesis of two documents". Any statement about the exam goes in docs/review-needed.md.
- **Register labels.** Every example that isn't standard French carries a label in its translation: (literary), (formal), (familiar), (slang) or (spoken). Slang stays out of typed answers unless the instruction asks for it.
- **Sensitive topics.** The B2 rules continue: neutral facts only, no figures, no invented quotes, no named living politicians, and every such sentence in docs/review-needed.md.
  - Contested history (the colonial period, the Algerian war, Vichy): state what happened in neutral words and dates, present historians' debates as debates, and give no verdict.
  - Religion and laïcité: explain the 1905 law and how laïcité is applied as institutions, not as opinions; don't rank or judge beliefs.
  - Immigration and identity: describe policies and facts, never groups; no ethnic slang.
- **Authors, works and quotations.**
  - Name authors and works only when you are sure of the facts (title, date, author).
  - Quote only authors on a named safe list: authors who died before 1900 (for example Molière, Racine, Voltaire, Hugo, Baudelaire, Flaubert). Keep each quotation under 15 words. Why a list rather than a rule: French law adds wartime and "mort pour la France" extensions to the usual term, and terms differ by country.
  - All translations of quotations are our own.
  - For any later author, don't quote: paraphrase the idea, or write an original pastiche "in the style of" and label it as invented.
  - Longer literary texts are original pastiches, labelled as such, never copies or close paraphrases.
- **No repeats.** A C1 lesson recaps earlier material in 2 or 3 sentences with a LessonLink to the lesson that first taught it (see docs/c1-coverage.md), then teaches only what's new. Every "you know X from Y" claim is checked against lesson Y before it's written.
- **C1 checklist** (the B2 self-audit rules, plus the defects that recurred in B2):
  - Accepted answers: list every valid answer built from taught material, or pin the cue; include oe/œ and *Elle est* / *C'est* variants.
  - Mood and tense contrasts use verbs whose forms differ (not *donnent*, *reste*, *change*).
  - Cues are pinned (an infinitive, a structure) wherever more than one answer would be valid.
  - Vocab ids follow display order, and every entry is used in a complete French sentence.
  - Fixed phrases made of known words are taught or glossed at first use.
  - No "always", "never", "most common" or "almost always" unless the lesson's own examples agree; a rule of thumb is called one.
  - Rules are stated by their real test (same subject, completion), not an approximation.
  - Distractors are wrong in their sentence, and every rule tested in an exercise is explained in that lesson or an earlier one.
  - A model text keeps one narrative tense per paragraph, and every dialogue obeys the lesson's own rules.
  - Before finishing a unit, run check:words, check:structures, audit:content, test:b2-exercises (extended to C1), scripts/b2-links-ids.ts (extended to C1) and check:c1-links.
  - Forward links: a LessonLink or `related` entry to a lesson that isn't written yet is plain text, listed in docs/c1-forward-links.md (lesson, text, target), and restored when the target is written. `npm run check:c1-links` fails on a link to a missing lesson.
  - Cross-lesson consistency: when a construction (such as *à peine*) appears in more than one C1 lesson, grep all C1 lessons and make the statements agree.
  - Rule words: every "every", "only", "always", "never" and "the others" in teaching text and exercise explanations is true for the lesson's own tables and examples.
  - Distractors: for each one, ask "would a careful writer accept it in this sentence?" If yes, change the sentence or pin the cue.
  - Recap claims: run scripts/c1-find.ts before any "you know X from Y", and record the lesson id in the log.
  - En résumé opens with its own subject, never *Cette* or *Ces* pointing outside it. Every vocab entry, grammar terms included, appears in at least one complete French sentence.
  - The log gives teaching-text, whole-lesson and En résumé word counts for every lesson.
  - Meaning claims ("the same", "the opposite") in dialogues and notes: translate both sentences and check the claim before writing it.
  - Answer keys: every fill-in, reformulation and translate key includes the variants the lesson's own examples use (with or without an optional *ne*, *le* or *pas*, *on* or *nous*).
  - Grammar terms in vocab appear in a complete French sentence, not only inside English.
  - An exercise sentence that can mean two things gets context or a pinned cue.
  - When describing a verb's meanings (*devoir*, *pouvoir*, *falloir*), write "the meanings that matter here" unless all meanings are listed.
  - A form the lesson marks as formal-only or literary is never the only accepted answer, unless the instruction asks for that register.
  - Every example given to illustrate a rule shows that rule, gloss included: read each example against the sentence before it.
  - Use French grammar terms as French grammar uses them (*le sujet* is the grammatical subject; *le thème* is the topic). Check any heuristic (size, gender, frequency) against every example given for it.
  - A model text obeys every limit and rule its own lesson states, and a section that describes the model ("How the text uses the unit") matches it exactly. Count before writing the claim.
  - For each typed key, search the lesson (and earlier lessons of the same unit) for other phrasings of the same meaning, and accept each one or pin the wording in the prompt.
  - A model text follows the method its own lesson or unit teaches (by idea, every view with its source, the plan announced), not only its grammar.
  - In choice exercises, every option fits the blank's form (article, elision, agreement), so that only meaning decides; and no distractor is a valid answer.
  - When a dialogue and a model text describe the same event, every fact (dates, reasons, who said what, the outcome) matches; check each one.
  - Before calling a common form wrong, check whether it's only less formal. If it is, label the register ("formal: *former un recours*; everyday: *faire un recours*") instead of marking it as an error.
  - Before stating a fact about a work (its structure, where a moral or a line comes, a date), check it against the work and against any quotation the lesson itself uses.
  - When a character summarizes or quotes another character, the summary matches what was said; when a later dialogue comments on a model text, every comment is true of that text.
  - A model letter shows the full layout from c1-formal-correspondence (sender, place and date, objet, salutation, closing) unless the lesson labels it as an extract.
  - A claim about a proportion of speakers, users or the population follows the no-figures rule: rephrase it without the proportion, or add it to docs/review-needed.md.

@AGENTS.md
