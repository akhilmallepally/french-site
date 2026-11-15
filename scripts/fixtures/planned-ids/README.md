Fixture for scripts/test-validate-content.ts. Not real content.

- `syllabus.md` plans four lessons. `a1-planned` has no file.
- `uses-planned.mdx` points at `a1-planned` through `related` and `<LessonLink>`: allowed.
- `bad-prereq.mdx` lists `a1-planned` as a prerequisite: rejected (prerequisites must be written).
- `not-in-syllabus.mdx` points at an id that is neither written nor planned: rejected everywhere.
- `<LessonLink text="…">`: `uses-planned.mdx` passes with it; `not-in-syllabus.mdx` still fails on a bad id and on empty text.
- Reorder exercises: `uses-planned.mdx` has a valid one; `bad-reorder.mdx` has one whose answer uses different words and one with an empty word list.
- C2 writing tasks: `c2/writing-task.mdx` has a valid one next to a graded exercise; `c2/bad-writing-task.mdx` breaks each field rule and has two tasks; `a1/writing-task-too-early.mdx` uses the type below C2.
- C2 "Source text" sections: `c2/writing-task.mdx` has a valid one; `c2/bad-source-text.mdx` has two (one without a translation, one without French lines); `a1/source-text-too-early.mdx` uses one below C2.
