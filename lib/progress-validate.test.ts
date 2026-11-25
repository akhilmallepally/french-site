// syncProgressAction input validation, against the committed content index.
// Run: npm run test:progress
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { checkSyncTime, MAX_ITEMS, MAX_PAYLOAD_BYTES, validateSyncPayload, type ProgressIndexData } from "./progress-validate.ts";

// Tests may read the file; the action imports it as a module instead.
const INDEX: ProgressIndexData = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", "progress-index.json"), "utf8"));
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const USER = "11111111-1111-4111-8111-111111111111";

const attempt = (over: Record<string, unknown> = {}) => ({
  key: "e1",
  kind: "attempt",
  lessonId: "a2-review-work",
  exerciseId: "a2-review-work-ex001",
  result: "correct",
  attemptedAt: iso(NOW - 1000),
  addAttempts: 1,
  addCorrect: 1,
  ...over,
});
const run = (over: Record<string, unknown> = {}) => ({ key: "r1", kind: "run", lessonId: "b1-review-work", score: 9, total: 14, runAt: iso(NOW), ...over });
const writing = (over: Record<string, unknown> = {}) => ({
  key: "w1",
  kind: "writing",
  lessonId: "c2-review-form",
  exerciseId: "c2-review-form-ex017",
  checked: [2, 0, 2],
  doneAt: iso(NOW),
  ...over,
});
const importLesson = (over: Record<string, unknown> = {}) => ({
  key: "l1",
  kind: "import-lesson",
  lessonId: "a1-review-final",
  bestScore: 11,
  bestTotal: 12,
  lastRunAt: iso(NOW - 5000),
  completedAt: iso(NOW - 9000),
  ...over,
});
const importExercise = (over: Record<string, unknown> = {}) => ({
  key: "x1",
  kind: "import-exercise",
  lessonId: "b2-review-pronouns",
  exerciseId: "b2-review-pronouns-ex002",
  lastResult: "incorrect",
  lastAttemptedAt: iso(NOW - 1),
  attempts: 3,
  correct: 2,
  ...over,
});

const check = (items: unknown[], expectedUserId: unknown = USER) => validateSyncPayload({ expectedUserId, items }, INDEX, NOW);
/** The code for one entry, or "ok" if it passed. */
function codeOf(item: Record<string, unknown>): string {
  const r = check([item]);
  if (!r.ok) return `payload:${r.code}`;
  return r.rejected[0]?.code ?? "ok";
}

describe("valid entries", () => {
  test("all five kinds pass, rebuilt from their own fields; ticks deduplicated and sorted", () => {
    const r = check([attempt(), run(), writing(), importLesson(), importExercise()]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.rejected, []);
    assert.equal(r.valid.length, 5);
    assert.deepEqual(r.valid.find((i) => i.kind === "writing"), { ...writing(), checked: [0, 2] });
  });
});

describe("ids", () => {
  test("lessons sharing a slug are told apart by id: an exercise from the other lesson is wrong_lesson", () => {
    assert.equal(codeOf(attempt({ lessonId: "b1-review-work", exerciseId: "a2-review-work-ex001" })), "wrong_lesson");
    assert.equal(codeOf(attempt({ lessonId: "b2-review-pronouns", exerciseId: "a2-review-pronouns-ex001" })), "wrong_lesson");
    assert.equal(codeOf(attempt({ lessonId: "c2-review-final", exerciseId: "c2-review-final-ex001" })), "ok");
  });

  test("a slug alone is not a lesson id", () => {
    assert.equal(codeOf(run({ lessonId: "review-work" })), "unknown_id");
  });

  test("unknown lesson, exercise and writing-task ids", () => {
    assert.equal(codeOf(run({ lessonId: "a1-no-such-lesson" })), "unknown_id");
    assert.equal(codeOf(attempt({ exerciseId: "a2-review-work-ex999" })), "unknown_id");
    assert.equal(codeOf(writing({ exerciseId: "c2-review-form-ex099" })), "unknown_id");
  });

  test("a writing task sent as an attempt, and a graded exercise sent as writing, are wrong_kind", () => {
    assert.equal(codeOf(attempt({ lessonId: "c2-review-form", exerciseId: "c2-review-form-ex017" })), "wrong_kind");
    assert.equal(codeOf(writing({ exerciseId: "c2-review-form-ex001" })), "wrong_kind");
  });

  test("malformed ids", () => {
    assert.equal(codeOf(run({ lessonId: "A1-Greetings" })), "bad_id");
    assert.equal(codeOf(run({ lessonId: 42 })), "bad_id");
    assert.equal(codeOf(run({ lessonId: "a".repeat(121) })), "bad_id");
    assert.equal(codeOf(attempt({ exerciseId: "a2-review-work-v001" })), "bad_id");
  });
});

describe("scores and counts", () => {
  test("run totals: 0 and 1,001 rejected, 1 and 1,000 accepted", () => {
    assert.equal(codeOf(run({ score: 0, total: 0 })), "bad_score");
    assert.equal(codeOf(run({ score: 0, total: 1 })), "ok");
    assert.equal(codeOf(run({ score: 1000, total: 1000 })), "ok");
    assert.equal(codeOf(run({ score: 1, total: 1001 })), "bad_score");
  });

  test("scores must be whole numbers no bigger than the total", () => {
    assert.equal(codeOf(run({ score: 15, total: 14 })), "bad_score");
    assert.equal(codeOf(run({ score: 8.5 })), "bad_score");
    assert.equal(codeOf(run({ score: -1 })), "bad_score");
    assert.equal(codeOf(run({ score: "9" })), "bad_score");
    assert.equal(codeOf(run({ score: Number.NaN })), "bad_score");
    assert.equal(codeOf(importLesson({ bestScore: 13 })), "bad_score");
  });

  test("attempt counts agree with the result", () => {
    assert.equal(codeOf(attempt({ addAttempts: 0, addCorrect: 0 })), "bad_count");
    assert.equal(codeOf(attempt({ addAttempts: 1001, addCorrect: 1 })), "bad_count");
    assert.equal(codeOf(attempt({ addAttempts: 1000, addCorrect: 1 })), "ok");
    assert.equal(codeOf(attempt({ addCorrect: 0 })), "bad_count", "a correct last answer needs a correct count");
    assert.equal(codeOf(attempt({ result: "incorrect", addCorrect: 1 })), "bad_count", "an incorrect single answer can't be correct");
    assert.equal(codeOf(attempt({ result: "maybe" })), "bad_result");
    assert.equal(codeOf(importExercise({ attempts: 100_001 })), "bad_count");
    assert.equal(codeOf(importExercise({ attempts: 100_000, correct: 5 })), "ok");
  });

  test("writing ticks: whole numbers 0 to 9, at most 10", () => {
    assert.equal(codeOf(writing({ checked: [] })), "ok");
    assert.equal(codeOf(writing({ checked: [10] })), "bad_checked");
    assert.equal(codeOf(writing({ checked: [1.5] })), "bad_checked");
    assert.equal(codeOf(writing({ checked: "0,1" })), "bad_checked");
    assert.equal(codeOf(writing({ checked: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0] })), "bad_checked");
  });
});

describe("times", () => {
  test("up to exactly 24 hours ahead; never clamped", () => {
    assert.equal(codeOf(run({ runAt: iso(NOW + 86_400_000) })), "ok");
    assert.equal(codeOf(run({ runAt: iso(NOW + 86_400_001) })), "future_time");
    assert.equal(codeOf(run({ runAt: iso(NOW - 400 * 86_400_000) })), "ok");
    assert.equal(codeOf(importLesson({ completedAt: iso(NOW + 86_400_001) })), "future_time");
  });

  test("NaN, unparseable, impossible and over-precise times", () => {
    assert.equal(codeOf(run({ runAt: Number.NaN })), "bad_time");
    assert.equal(codeOf(run({ runAt: "yesterday" })), "bad_time");
    assert.equal(codeOf(run({ runAt: "2026-02-30T10:00:00.000Z" })), "bad_time");
    assert.equal(codeOf(run({ runAt: "2026-11-25T24:00:00.000Z" })), "bad_time");
    assert.equal(codeOf(run({ runAt: "2026-11-25T10:00:00.0001Z" })), "bad_time", "more than millisecond precision");
    assert.equal(codeOf(run({ runAt: "2026-11-25T10:00:00.123456Z" })), "bad_time");
    assert.equal(codeOf(run({ runAt: "2026-11-25T10:00:00" })), "bad_time", "no time zone");
    assert.equal(checkSyncTime("2026-11-25T11:00:00.5+01:00", NOW), "ok", "an offset and fewer digits are fine");
    assert.equal(codeOf(importLesson({ completedAt: "soon" })), "bad_time");
    assert.equal(codeOf(importLesson({ completedAt: null })), "ok", "null means no completion");
  });
});

describe("the whole payload", () => {
  test("writing text anywhere rejects the whole call, and nothing is valid", () => {
    for (const field of ["text", "draft", "content"]) {
      assert.deepEqual(check([run(), writing({ [field]: "Mon texte." })]), { ok: false, code: "unexpected_field" });
    }
    assert.deepEqual(check([attempt({ answer: "suis" })]), { ok: false, code: "unexpected_field" }, "no typed answers either");
    assert.deepEqual(check([{ key: "k", kind: "writing-v2", text: "Mon texte." }]), { ok: false, code: "unexpected_field" }, "not under an unknown kind either");
    assert.deepEqual(validateSyncPayload({ expectedUserId: USER, items: [run()], userId: "x" }, INDEX, NOW), { ok: false, code: "unexpected_field" });
  });

  test("row and byte caps", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => run({ key: `r${i}` }));
    assert.equal(check(many(MAX_ITEMS)).ok, true);
    assert.deepEqual(check(many(MAX_ITEMS + 1)), { ok: false, code: "too_many_items" });
    assert.deepEqual(check([run({ key: "k".repeat(200) })]).ok, true);
    const big = Array.from({ length: 150 }, (_, i) => run({ key: `${"k".repeat(190)}${i}` , lessonId: "a".repeat(120) }));
    assert.ok(JSON.stringify(big).length < MAX_PAYLOAD_BYTES, "150 long keys still fit");
    const huge = { expectedUserId: USER, items: [run({ key: "k" }), ...Array.from({ length: 199 }, (_, i) => ({ key: `z${i}`, kind: "nope", pad: "p".repeat(800) }))] };
    assert.deepEqual(validateSyncPayload(huge, INDEX, NOW), { ok: false, code: "too_large" });
  });

  test("bad shapes", () => {
    assert.deepEqual(validateSyncPayload(null, INDEX, NOW), { ok: false, code: "bad_payload" });
    assert.deepEqual(check([]), { ok: false, code: "bad_payload" }, "no entries");
    assert.deepEqual(check([run()], ""), { ok: false, code: "bad_payload" }, "no expected user");
    assert.deepEqual(check([run({ key: "" })]), { ok: false, code: "bad_payload" });
    assert.deepEqual(check([run({ key: "k".repeat(201) })]), { ok: false, code: "bad_payload" });
    assert.deepEqual(check([run(), run()]), { ok: false, code: "duplicate_key" });
    assert.deepEqual(check(["run"]), { ok: false, code: "bad_payload" });
  });

  test("a bad entry is rejected on its own and the others stay valid (the plan's per-entry rule)", () => {
    const r = check([run(), attempt({ exerciseId: "a2-review-work-ex999" }), { key: "k", kind: "teleport" }, { key: "m", kind: "run", lessonId: "a1-greetings" }]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.valid.map((i) => i.key), ["r1"]);
    assert.deepEqual(r.rejected, [
      { key: "e1", code: "unknown_id" },
      { key: "k", code: "bad_kind" },
      { key: "m", code: "bad_item" },
    ]);
  });
});
