// Runs the validator against fixtures and checks it reports exactly the expected problems.
// Run: npm run test:content
import assert from "node:assert/strict";
import path from "node:path";
import { validateContent } from "./validate-content.ts";

const fixture = path.join(process.cwd(), "scripts", "fixtures", "planned-ids");
const { errors, warnings } = validateContent(path.join(fixture, "lessons"), path.join(fixture, "syllabus.md"));

// A planned id (in the syllabus, no file) is fine in `related` and <LessonLink>, so
// uses-planned.mdx produces nothing. It is rejected in `prerequisites`, and an id
// that isn't in the syllabus is rejected everywhere.
// The optional text prop doesn't change any of that: the id is still checked.
assert.deepEqual([...errors].sort(), [
  `a1/bad-reorder.mdx: exercises[0] (a1-bad-reorder-ex001): answer "Nous sommes là" doesn't use exactly the words in "words"`,
  'a1/bad-reorder.mdx: exercises[1] (a1-bad-reorder-ex002): reorder needs a non-empty "words" list',
  'a1/bad-prereq.mdx: prerequisite "a1-planned" is planned in the syllabus but not written yet. Prerequisites must be written lessons.',
  'a1/not-in-syllabus.mdx: <LessonLink id="a1-nowhere"> points to an unknown lesson (no file, and not in the syllabus)',
  'a1/not-in-syllabus.mdx: <LessonLink id="a1-nowhere-text"> points to an unknown lesson (no file, and not in the syllabus)',
  'a1/not-in-syllabus.mdx: <LessonLink id="a1-written"> has an empty text prop',
  'a1/not-in-syllabus.mdx: related references unknown lesson id "a1-nowhere" (no file, and not in the syllabus)',
].sort());
assert.deepEqual(warnings, []);

console.log("Validator tests passed: planned ids allowed in related/LessonLink, rejected in prerequisites.");
