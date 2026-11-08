# Parlons: French learning site
- Goal: text-only French site for A1 beginners. Later phases: Supabase auth, exercises, spaced repetition, streaks, progress dashboard.
- Stack: Next.js (App Router, TypeScript, Tailwind v4, no src/ directory). Lessons are MDX files in content/lessons/, parsed with gray-matter and rendered with next-mdx-remote/rsc plus remark-gfm. Later: Supabase (auth + Postgres), deployed on Vercel.
- All file reading lives in lib/lessons.ts so we can swap to a DB/CMS later without touching pages.
- Exercise and vocab items must have stable IDs that never change once published.
- Lessons live in content/lessons/<level>/<slug>.mdx (a1…c2) and are served at /lessons/<level>/<slug>. Frontmatter: id, title, description, level, unit, order (within the level, across units), type, tags, prerequisites, related. Lesson `id`s are permanent and independent of the filename; link between lessons with `<LessonLink id="…" />`, never a hard-coded URL. If a slug changes, add a redirect in next.config.ts.
- Backlinks ("Builds on this"), same-topic suggestions and prev/next are computed in lib/lessons.ts, never hand-written.
- `npm run validate:content` (scripts/validate-content.ts) checks frontmatter and links; it runs automatically before `npm run build`.
- docs/syllabus.md is the plan for every lesson (ids, units, prerequisites). Keep new lessons consistent with it.
- Prefer simple code. Don't add dependencies without telling me why.
- Run `npm run build` to verify changes before saying you're done.
- I'm on Windows (PowerShell). Use commands that work there.

@AGENTS.md
