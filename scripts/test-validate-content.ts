// Runs the validator against fixtures and checks it reports exactly the expected problems.
// Run: npm run test:content
import assert from "node:assert/strict";
import path from "node:path";
import { checkSyllabusOrder, validateContent } from "./validate-content.ts";

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
  // B2 exercise types: rejected below B2 (b2-new-types.mdx uses all four correctly and produces nothing).
  'a1/b2-type-too-early.mdx: exercises[0] (a1-b2-type-too-early-ex001): "reformulation" exercises are only allowed from B2 on',
  'b2/bad-connector.mdx: exercises[0] (b2-bad-connector-ex001): connector-choice needs "options" with at least 2 choices',
  'b2/bad-connector.mdx: exercises[0] (b2-bad-connector-ex001): connector-choice prompts must mark the gap with ___',
  'b2/bad-connector.mdx: exercises[1] (b2-bad-connector-ex002): "options" is only allowed on multiple-choice and connector-choice exercises',
].sort());
assert.deepEqual(warnings, []);

// Syllabus order: the fixture breaks every rule once; the real B2 order must be clean
// (it was re-planned after docs/b2-plan-review.md).
assert.deepEqual(checkSyllabusOrder(path.join(process.cwd(), "scripts", "fixtures", "syllabus-order", "syllabus.md"), ["b2"]), [
  "b2-first: prerequisite b2-third comes later",
  "b2-third: order 4, expected 3 (orders must run 1..N in table order)",
  "b2-third: prerequisite b2-nowhere isn't in the syllabus",
  "b2-fourth: prerequisite b2-third comes later",
  "b2-fourth: prerequisite b2-third comes later",
  "b2-fourth: 7 prerequisites (max 6)",
  'b2-fifth: unit "One" is split by another unit',
  "prerequisite cycle: b2-first -> b2-third -> b2-second -> b2-first",
]);
assert.deepEqual(checkSyllabusOrder(path.join(process.cwd(), "docs", "syllabus.md"), ["b2"]), []);

console.log("Validator tests passed: planned ids allowed in related/LessonLink, rejected in prerequisites; B2 exercise types checked; B2 syllabus order consistent.");
