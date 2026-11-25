// Run: npm run test:progress
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyExerciseImport,
  applyLesson,
  applyWriting,
  checkTime,
  isValidRun,
  lessonFromImport,
  lessonFromRun,
  MAX_AHEAD_MS,
  mergeExercises,
  mergeLessons,
  mergeProgress,
  mergeWriting,
  passes,
} from "./progress-merge.ts";
import type { ExerciseProgress, LessonProgress, ProgressData, WritingTaskProgress } from "./progress.ts";

const T = (n: number) => new Date(Date.UTC(2026, 10, 20, 9, 0, n)).toISOString(); // n seconds after a fixed time

const L = (bestScore: number, bestTotal: number, last: number, completed?: number): LessonProgress => ({
  bestScore,
  bestTotal,
  lastCompletedAt: T(last),
  ...(completed === undefined ? {} : { completedAt: T(completed) }),
});
const E = (attempts: number, correct: number, lastResult: ExerciseProgress["lastResult"], at: number): ExerciseProgress => ({
  attempts,
  correct,
  lastResult,
  lastAttemptedAt: T(at),
});
const W = (checked: number[], at: number): WritingTaskProgress => ({ done: true, checked, doneAt: T(at) });

// Samples chosen to hit every branch: ratio ties with different totals, equal times, missing completedAt.
const lessons = [L(4, 5, 10, 10), L(8, 10, 5), L(8, 10, 20, 3), L(3, 10, 30), L(10, 10, 1, 1), L(4, 5, 10)];
const exercises = [E(3, 1, "incorrect", 10), E(1, 1, "correct", 10), E(5, 4, "correct-accents", 2), E(2, 0, "incorrect", 40)];
const writings = [W([0, 2], 10), W([1], 10), W([0, 1, 2], 5), W([], 30)];

function laws<T>(name: string, samples: T[], merge: (a: T, b: T) => T) {
  test(`${name}: idempotent, commutative, associative`, () => {
    for (const a of samples) {
      assert.deepEqual(merge(a, a), a, "merge(a, a) = a");
      for (const b of samples) {
        assert.deepEqual(merge(a, b), merge(b, a), "merge(a, b) = merge(b, a)");
        for (const c of samples) assert.deepEqual(merge(merge(a, b), c), merge(a, merge(b, c)), "associative");
      }
    }
  });
}

describe("merge laws", () => {
  laws("lessons", lessons, mergeLessons);
  laws("exercises", exercises, mergeExercises);
  laws("writing", writings, mergeWriting);

  const snapshots: ProgressData[] = [
    { exercises: {}, lessons: {} },
    { exercises: { x: exercises[0] }, lessons: { l: lessons[0] } },
    { exercises: { x: exercises[1], y: exercises[2] }, lessons: { l: lessons[1], m: lessons[3] }, writingTasks: { w: writings[0] } },
    { exercises: { y: exercises[3] }, lessons: { m: lessons[4] }, writingTasks: { w: writings[1], v: writings[2] } },
  ];
  laws("whole snapshots", snapshots, mergeProgress);
});

describe("lessons", () => {
  test("best score by ratio, compared in integers (4/5 equals 8/10)", () => {
    assert.deepEqual(mergeLessons(L(3, 10, 1), L(7, 10, 2)), L(7, 10, 2));
    // Tie: the merge picks the larger total whichever side it's on; the server keeps its stored row.
    assert.equal(mergeLessons(L(4, 5, 1), L(8, 10, 1)).bestTotal, 10);
    assert.equal(mergeLessons(L(8, 10, 1), L(4, 5, 1)).bestTotal, 10);
    assert.equal(applyLesson(L(4, 5, 1), L(8, 10, 1)).bestTotal, 5);
    assert.equal(applyLesson(L(8, 10, 1), L(4, 5, 1)).bestTotal, 10);
  });

  test("a score going down never lowers the best, but the last run time moves on", () => {
    const merged = applyLesson(L(9, 10, 5, 5), lessonFromRun(2, 10, T(50)));
    assert.deepEqual(merged, L(9, 10, 50, 5));
  });

  test("an earlier completedAt replaces a later one; a later one never does", () => {
    assert.equal(mergeLessons(L(9, 10, 50, 40), L(8, 10, 20, 7)).completedAt, T(7));
    assert.equal(applyLesson(L(9, 10, 50, 7), L(10, 10, 60, 40)).completedAt, T(7));
    assert.equal(applyLesson(L(9, 10, 50, 40), L(8, 10, 20, 7)).completedAt, T(7));
  });

  test("missing completedAt on either side", () => {
    assert.equal(mergeLessons(L(9, 10, 5), L(9, 10, 6, 6)).completedAt, T(6));
    assert.equal("completedAt" in mergeLessons(L(1, 10, 5), L(2, 10, 6)), false, "no completion is invented");
  });

  test("a run is completed at its own time only if it passes (score / total >= 0.8)", () => {
    assert.equal(lessonFromRun(8, 10, T(1)).completedAt, T(1));
    assert.equal(lessonFromRun(4, 5, T(1)).completedAt, T(1));
    assert.equal("completedAt" in lessonFromRun(7, 10, T(1)), false);
    assert.equal(passes(799, 1000), false);
    assert.equal(passes(800, 1000), true);
  });

  test("import: completedAt when present, else the last run if the best passes, else none", () => {
    assert.equal(lessonFromImport(L(9, 10, 50, 3)).completedAt, T(3));
    assert.equal(lessonFromImport(L(9, 10, 50)).completedAt, T(50));
    assert.equal("completedAt" in lessonFromImport(L(5, 10, 50, 3)), false, "a stray completedAt on a failing best is ignored, as in 0006");
  });

  test("applying the same entry twice changes nothing (idempotent like apply_progress)", () => {
    const entry = lessonFromRun(9, 10, T(9));
    const once = applyLesson(L(5, 10, 3), entry);
    assert.deepEqual(applyLesson(once, entry), once);
  });
});

describe("exercises (import-exercise)", () => {
  test("max of each count, result and time from the newer side", () => {
    assert.deepEqual(mergeExercises(E(5, 1, "incorrect", 20), E(2, 2, "correct", 10)), E(5, 2, "incorrect", 20));
    assert.deepEqual(applyExerciseImport(E(5, 1, "incorrect", 20), E(2, 2, "correct", 10)), E(5, 2, "incorrect", 20));
  });

  test("equal times: the merge picks the higher result; the server keeps its stored result", () => {
    assert.equal(mergeExercises(E(1, 0, "incorrect", 10), E(1, 1, "correct", 10)).lastResult, "correct");
    assert.equal(mergeExercises(E(1, 1, "correct", 10), E(1, 0, "incorrect", 10)).lastResult, "correct");
    assert.equal(applyExerciseImport(E(1, 0, "incorrect", 10), E(1, 1, "correct", 10)).lastResult, "incorrect");
  });

  test("missing on one side copies the other", () => {
    assert.deepEqual(applyExerciseImport(undefined, E(2, 1, "correct", 3)), E(2, 1, "correct", 3));
    assert.deepEqual(mergeProgress({ exercises: { a: E(2, 1, "correct", 3) }, lessons: {} }, { exercises: {}, lessons: {} }).exercises.a, E(2, 1, "correct", 3));
  });
});

describe("writing tasks", () => {
  test("the later doneAt wins whole, ticks included", () => {
    assert.deepEqual(mergeWriting(W([0, 1, 2], 5), W([1], 9)), W([1], 9));
    assert.deepEqual(applyWriting(W([1], 9), W([0, 1, 2], 5)), W([1], 9));
  });

  test("ties: the merge picks the greater tick list on either side; the server keeps its stored record", () => {
    assert.deepEqual(mergeWriting(W([0, 2], 10), W([1], 10)), W([1], 10));
    assert.deepEqual(mergeWriting(W([1], 10), W([0, 2], 10)), W([1], 10));
    assert.deepEqual(mergeWriting(W([0, 1], 10), W([0], 10)), W([0, 1], 10));
    assert.deepEqual(applyWriting(W([0, 2], 10), W([1], 10)), W([0, 2], 10));
  });

  test("snapshots without writingTasks stay without it", () => {
    assert.equal("writingTasks" in mergeProgress({ exercises: {}, lessons: {} }, { exercises: {}, lessons: {} }), false);
  });
});

describe("runs and times", () => {
  test("run bounds: whole numbers, 1 <= total <= 1000, 0 <= score <= total", () => {
    assert.equal(isValidRun(0, 0), false, "total 0");
    assert.equal(isValidRun(0, 1), true, "total 1, score 0");
    assert.equal(isValidRun(1, 1), true);
    assert.equal(isValidRun(1000, 1000), true, "total 1,000");
    assert.equal(isValidRun(1, 1001), false, "total 1,001");
    assert.equal(isValidRun(2, 1), false, "score above total");
    assert.equal(isValidRun(-1, 5), false, "negative score");
    assert.equal(isValidRun(1.5, 5), false, "non-integer score");
    assert.equal(isValidRun(1, 5.5), false, "non-integer total");
    assert.equal(isValidRun("3", 5), false, "a string isn't a number");
    assert.equal(isValidRun(Number.NaN, 5), false);
  });

  test("times: accepted up to exactly 24 hours ahead, never clamped", () => {
    const now = Date.UTC(2026, 10, 25, 12, 0, 0);
    const at = (ms: number) => new Date(ms).toISOString();
    assert.equal(MAX_AHEAD_MS, 86_400_000);
    assert.equal(checkTime(at(now + MAX_AHEAD_MS), now), "ok", "exactly +24h");
    assert.equal(checkTime(at(now + MAX_AHEAD_MS + 1), now), "future_time", "+24h + 1 ms");
    assert.equal(checkTime(at(now - 365 * MAX_AHEAD_MS), now), "ok", "past times are fine");
    assert.equal(checkTime("2026-11-25T14:00:00+02:00", now), "ok", "a time zone offset");
    assert.equal(checkTime("2026-11-25T12:00:00", now), "bad_time", "no time zone");
    assert.equal(checkTime("2026-11-25", now), "bad_time");
    assert.equal(checkTime("not a time", now), "bad_time");
    assert.equal(checkTime(12345, now), "bad_time");
  });
});
