// The /progress figures. Run: npm run test:progress
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProgressData } from "./progress-core.ts";
import { summarize, type CatalogueLesson } from "./progress-summary.ts";

const L = (id: string, level: string, unit: string, type = "grammar", extra: Partial<CatalogueLesson> = {}): CatalogueLesson => ({
  id,
  title: id,
  href: `/lessons/${level.toLowerCase()}/${id.slice(3)}`,
  level,
  unit,
  type,
  free: level === "A1" || level === "A2",
  ...extra,
});

const catalogue = [
  L("a1-one", "A1", "U1"),
  L("a1-two", "A1", "U1"),
  L("a1-review-u1", "A1", "U1", "review"),
  L("a1-three", "A1", "U2"),
  L("b1-paid", "B1", "U1"),
  L("b1-review-paid", "B1", "U1", "review"),
  L("c2-essay", "C2", "U1", "communication", { writingTask: "c2-essay-ex017" }),
  L("c2-other", "C2", "U1", "grammar", { writingTask: "c2-other-ex016" }),
];
const T = (s: number) => new Date(Date.UTC(2026, 10, 20, 9, 0, s)).toISOString();
const run = (bestScore: number, bestTotal: number, at: number) => ({ bestScore, bestTotal, lastCompletedAt: T(at) });
const answer = (at: number) => ({ attempts: 1, correct: 1, lastResult: "correct" as const, lastAttemptedAt: T(at) });

describe("summarize", () => {
  test("empty state: nothing practised, or only unknown ids", () => {
    assert.equal(summarize(catalogue, { exercises: {}, lessons: {} }).empty, true);
    const orphans: ProgressData = { exercises: { "a1-gone-ex001": answer(5) }, lessons: { "a1-gone": run(9, 10, 5) } };
    const s = summarize(catalogue, orphans);
    assert.equal(s.empty, true, "removed lessons are ignored");
    assert.equal(s.continueWith, null);
    assert.equal(s.levels[0].completed, 0);
  });

  test("continue: the latest answer, run or writing task, whichever is newest", () => {
    const data: ProgressData = {
      exercises: { "a1-two-ex003": answer(30) },
      lessons: { "a1-one": run(9, 10, 20) },
      writingTasks: { "c2-essay-ex017": { done: true, checked: [], doneAt: T(40) } },
    };
    assert.equal(summarize(catalogue, data).continueWith?.lesson.id, "c2-essay");
    delete data.writingTasks;
    assert.equal(summarize(catalogue, data).continueWith?.lesson.id, "a1-two", "an answer counts as practice");
  });

  test("per level and unit, completed means score / total >= 0.8", () => {
    const data: ProgressData = { exercises: {}, lessons: { "a1-one": run(8, 10, 1), "a1-two": run(7, 10, 2), "a1-three": run(5, 5, 3) } };
    const [a1, b1, c2] = summarize(catalogue, data).levels;
    assert.deepEqual(a1, { level: "A1", completed: 2, total: 4, units: [{ name: "U1", completed: 1, total: 3 }, { name: "U2", completed: 1, total: 1 }] });
    assert.deepEqual([b1.level, b1.total, c2.level, c2.total], ["B1", 2, "C2", 2]);
  });

  test("started but not finished: most recent first, completed ones left out, at most 10", () => {
    const data: ProgressData = {
      exercises: { "a1-three-ex001": answer(50), "a1-one-ex002": answer(10) },
      lessons: { "a1-two": run(9, 10, 40), "a1-one": run(1, 10, 20) },
    };
    assert.deepEqual(summarize(catalogue, data).started.map((s) => [s.lesson.id, s.at]), [
      ["a1-three", T(50)],
      ["a1-one", T(20)],
    ]);
    const many: ProgressData = { exercises: {}, lessons: {} };
    const big = Array.from({ length: 14 }, (_, i) => L(`a2-l${i}`, "A2", "U"));
    big.forEach((l, i) => (many.exercises[`${l.id}-ex001`] = answer(i)));
    assert.equal(summarize(big, many).started.length, 10);
  });

  test("review lessons: unfinished ones, and unrun ones whose unit is otherwise completed", () => {
    const unitDone: ProgressData = { exercises: {}, lessons: { "a1-one": run(10, 10, 1), "a1-two": run(9, 10, 2) } };
    assert.deepEqual(summarize(catalogue, unitDone).review.map((r) => [r.lesson.id, r.reason]), [["a1-review-u1", "unit-done"]]);
    const unfinished: ProgressData = { exercises: { "a1-review-u1-ex002": answer(3) }, lessons: {} };
    assert.deepEqual(summarize(catalogue, unfinished).review.map((r) => [r.lesson.id, r.reason]), [["a1-review-u1", "unfinished"]]);
    const finished: ProgressData = { exercises: {}, lessons: { ...unitDone.lessons, "a1-review-u1": run(10, 10, 3) } };
    assert.deepEqual(summarize(catalogue, finished).review, []);
  });

  test("writing tasks: done or not, out of the C2 total, with no text anywhere", () => {
    const data: ProgressData = { exercises: {}, lessons: {}, writingTasks: { "c2-essay-ex017": { done: true, checked: [0, 1], doneAt: T(9) } } };
    const { writing } = summarize(catalogue, data);
    assert.deepEqual([writing.done, writing.total], [1, 2]);
    assert.deepEqual(writing.tasks.map((t) => [t.lesson.id, t.done]), [["c2-essay", true], ["c2-other", false]]);
    assert.equal(JSON.stringify(writing).includes("checked"), false, "only the status, not even the ticks");
  });

  test("paid lessons stay in the figures and link to their usual page (sign-in or paywall)", () => {
    const data: ProgressData = { exercises: { "b1-paid-ex001": answer(9) }, lessons: {} };
    const s = summarize(catalogue, data);
    assert.equal(s.continueWith?.lesson.href, "/lessons/b1/paid");
    assert.equal(s.continueWith?.lesson.free, false);
    assert.equal(s.levels.find((l) => l.level === "B1")!.total, 2);
  });
});
