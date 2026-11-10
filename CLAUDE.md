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
- Teaching text is 600 to 800 words (grammar lessons may reach 900). Vocab has 12 to 25 entries. Dialogues have 8 to 10 lines.
- Every communication lesson includes one longer realistic text (an email, a message thread or a short article) with a full translation.
- 12 to 14 exercises per lesson, with at least two production tasks (translate, rewrite or write out a short paragraph) and at least one reorder.
- Use only structures taught in A1, A2 or earlier B1 lessons in course order. Labelled fixed phrases are allowed, and each one goes in docs/review-needed.md. Mark formal and informal registers in examples.
- Cultural claims (facts, dates, customs) go in docs/review-needed.md with the exact sentence.

@AGENTS.md
