Fixture for scripts/test-validate-content.ts. Not real content.

- `syllabus.md` plans four lessons. `a1-planned` has no file.
- `uses-planned.mdx` points at `a1-planned` through `related` and `<LessonLink>`: allowed.
- `bad-prereq.mdx` lists `a1-planned` as a prerequisite: rejected (prerequisites must be written).
- `not-in-syllabus.mdx` points at an id that is neither written nor planned: rejected everywhere.
- `<LessonLink text="…">`: `uses-planned.mdx` passes with it; `not-in-syllabus.mdx` still fails on a bad id and on empty text.
