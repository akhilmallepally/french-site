// The progress index: deterministic, and validate:content catches a stale committed copy.
// Run: npm run test:progress
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { buildProgressIndex, parseLesson, readLessonSources, serializeProgressIndex, type Lesson } from "../lib/lessons.ts";
import { progressIndexProblem, progressIndexText } from "./build-progress-index.ts";
import { validateContent } from "./validate-content.ts";

const fixture = path.join(process.cwd(), "scripts", "fixtures", "progress-index");
const lessonsDir = path.join(fixture, "lessons");
const syllabus = path.join(fixture, "syllabus.md");
const committed = path.join(fixture, "progress-index.json");
const totals = { lessons: 3, exercises: 4, writingTasks: 1 };

/** A throwaway copy of the fixture lessons, with `edit` applied to one file's text. */
function changedCopy(file: string, edit: (text: string) => string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "progress-index-"));
  fs.cpSync(lessonsDir, dir, { recursive: true });
  const target = path.join(dir, file);
  const before = fs.readFileSync(target, "utf8");
  const after = edit(before);
  assert.notEqual(after, before, "the edit must change the fixture");
  fs.writeFileSync(target, after);
  return dir;
}

describe("progress index", () => {
  test("is deterministic: same content, byte-identical text", () => {
    assert.equal(progressIndexText(lessonsDir), progressIndexText(lessonsDir));
    const lessons = readLessonSources(lessonsDir).map((s) => parseLesson(s).lesson!) as Lesson[];
    const forward = serializeProgressIndex(buildProgressIndex(lessons));
    const reversed = serializeProgressIndex(buildProgressIndex([...lessons].reverse()));
    assert.equal(reversed, forward, "the order lessons are read in doesn't matter");
    assert.ok(forward.endsWith("}\n") && !forward.includes("\r"), "LF line ends and one trailing newline");
  });

  test("keys by lesson id, keeps exercise order, and lists the writing task separately", () => {
    const index = JSON.parse(progressIndexText(lessonsDir));
    assert.deepEqual(index.totals, totals);
    assert.deepEqual(Object.keys(index.lessons), ["a1-first", "a1-second", "c2-writing"]);
    assert.deepEqual(index.lessons["a1-first"], { slug: "first", level: "A1", unit: "Unit one", exercises: ["a1-first-ex001", "a1-first-ex002"] });
    assert.deepEqual(index.lessons["c2-writing"].exercises, ["c2-writing-ex001"]);
    assert.equal(index.lessons["c2-writing"].writingTask, "c2-writing-ex002");
  });

  test("the committed fixture index matches, also with CRLF line ends", () => {
    assert.equal(progressIndexProblem(lessonsDir, committed), null);
    const crlf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "progress-index-")), "index.json");
    fs.writeFileSync(crlf, fs.readFileSync(committed, "utf8").replace(/\n/g, "\r\n"));
    assert.equal(progressIndexProblem(lessonsDir, crlf), null);
    const result = validateContent(lessonsDir, syllabus, { progressIndexFile: committed, expectedTotals: totals });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.totals, totals);
  });

  test("a renamed exercise id makes the committed index stale", () => {
    const dir = changedCopy(path.join("a1", "first.mdx"), (t) => t.replace('"a1-first-ex002"', '"a1-first-ex003"'));
    const problem = progressIndexProblem(dir, committed);
    assert.match(problem ?? "", /out of date with the lessons\. Run: npm run build:progress-index/);
    const { errors } = validateContent(dir, syllabus, { progressIndexFile: committed });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /out of date/);
  });

  test("reordered exercises and a moved unit also make it stale", () => {
    const swapped = changedCopy(path.join("a1", "first.mdx"), (t) =>
      t.replace('"a1-first-ex001"', '"TMP"').replace('"a1-first-ex002"', '"a1-first-ex001"').replace('"TMP"', '"a1-first-ex002"'),
    );
    assert.notEqual(progressIndexProblem(swapped, committed), null);
    const unit = changedCopy(path.join("a1", "second.mdx"), (t) => t.replace('unit: "Unit two"', 'unit: "Unit one"'));
    assert.notEqual(progressIndexProblem(unit, committed), null);
  });

  test("a missing index file is reported with the command", () => {
    assert.match(progressIndexProblem(lessonsDir, path.join(fixture, "nope.json")) ?? "", /is missing\. Run: npm run build:progress-index/);
  });

  test("different totals fail with a clear message", () => {
    const { errors } = validateContent(lessonsDir, syllabus, { expectedTotals: { lessons: 3, exercises: 5, writingTasks: 1 } });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^totals changed: 3 lessons, 4 graded exercises, 1 writing tasks \(expected 3, 5, 1\)/);
  });

  test("an exercise id without its lesson's -ex prefix is an error", () => {
    const dir = changedCopy(path.join("a1", "second.mdx"), (t) => t.replace('"a1-second-ex001"', '"a1-first-ex009"'));
    const { errors } = validateContent(dir, syllabus);
    assert.ok(errors.some((e) => e.includes('exercise id "a1-first-ex009" must be "a1-second-ex" plus digits')), errors.join("\n"));
  });

  test("an id used twice anywhere in the site is an error (writing tasks included)", () => {
    const dir = changedCopy(path.join("c2", "writing.mdx"), (t) => t.replace('"c2-writing-ex002"', '"c2-writing-ex001"'));
    const { errors } = validateContent(dir, syllabus);
    assert.ok(errors.some((e) => e.includes('exercise id "c2-writing-ex001" is already used')), errors.join("\n"));
  });
});
