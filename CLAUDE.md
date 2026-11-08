# Parlons: French learning site
- Goal: text-only French site for A1 beginners. Later phases: Supabase auth, exercises, spaced repetition, streaks, progress dashboard.
- Stack: Next.js (App Router, TypeScript, Tailwind v4, no src/ directory). Lessons are MDX files in content/lessons/, parsed with gray-matter and rendered with next-mdx-remote/rsc plus remark-gfm. Later: Supabase (auth + Postgres), deployed on Vercel.
- All file reading lives in lib/lessons.ts so we can swap to a DB/CMS later without touching pages.
- Exercise and vocab items must have stable IDs that never change once published.
- Lessons live in content/lessons/<level>/<slug>.mdx (a1…c2) and are served at /lessons/<level>/<slug>. Frontmatter: id, title, description, level, unit, order (within the level, across units), type, tags, prerequisites, related. Lesson `id`s are permanent and independent of the filename; link between lessons with `<LessonLink id="…" />`, never a hard-coded URL. If a slug changes, add a redirect in next.config.ts.
- Backlinks ("Builds on this"), same-topic suggestions and prev/next are computed in lib/lessons.ts, never hand-written.
- `npm run validate:content` (scripts/validate-content.ts) checks frontmatter and links; it runs automatically before `npm run build`.
- Optional frontmatter `vocab` (id, fr, pron, en, group?, note?) is shown with `<VocabTable />` or `<VocabTable group="…" />`. `exercises` (id, type: multiple-choice | fill-in | translate | reorder, prompt, options?, words?, answers, explanation) follow the Lesson writing rules below. Vocab and exercise ids are unique site-wide (`<lesson-id>-v001`, `<lesson-id>-ex001`). Pronunciation respellings go only in `pron`.
- docs/syllabus.md is the plan for every lesson (ids, units, prerequisites). Keep new lessons consistent with it.
- Prefer simple code. Don't add dependencies without telling me why.
- Run `npm run build` to verify changes before saying you're done.
- I'm on Windows (PowerShell). Use commands that work there.

## Lesson writing rules
- Exercise answers: list only genuinely different phrasings. Do NOT list accent-less spelling variants, or variants that differ only in capitals, final punctuation or apostrophe style. The future answer checker will normalize accents, capitals, punctuation and apostrophes when comparing, and will tell the learner when an answer was right except for a missing accent (it won't silently accept it, because accents can change meaning: ou/où, a/à, sur/sûr).
- Exercise types in use: multiple-choice, fill-in, translate, reorder.
- Don't write fill-in or translate exercises whose answer depends on capital letters. Use multiple-choice for those.
- Use <LessonLink text="..."> when the lesson title wouldn't read naturally inside the sentence.
- One vocab entry per concept. Don't create two entries for the same meaning (for example, alternate word orders of the same question go in one entry).
- Vary the tip callouts across lessons. Don't repeat an idea an earlier lesson already used.
- Anything uncertain goes into docs/review-needed.md.
- When a lesson is used as the format reference for other tools, use content/lessons/a1/etre-present.mdx (a1-etre-present) as the model. The first lessons predate vocab and exercises.

@AGENTS.md
