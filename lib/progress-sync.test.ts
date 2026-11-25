// syncProgressAction's logic with a fake database: what reaches apply_progress, and the reply.
// Run: npm run test:progress
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { rowsToProgress, runSync, toIsoMs, type ProgressDb, type RowKeys, type Rows } from "./progress-sync.ts";
import type { ProgressIndexData, SyncItem } from "./progress-validate.ts";

const INDEX: ProgressIndexData = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", "progress-index.json"), "utf8"));
const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const USER = "11111111-1111-4111-8111-111111111111";

const run = { key: "r1", kind: "run", lessonId: "a2-review-work", score: 10, total: 12, runAt: "2026-11-25T11:59:00.000Z" };
const attempt = {
  key: "e1",
  kind: "attempt",
  lessonId: "b1-review-work",
  exerciseId: "b1-review-work-ex003",
  result: "correct",
  attemptedAt: "2026-11-25T11:58:00.000Z",
  addAttempts: 1,
  addCorrect: 1,
};

/** Records every call; apply answers "all applied" unless told otherwise. */
function fakeDb(opts: { reply?: (items: SyncItem[]) => unknown; rows?: Rows } = {}) {
  const calls: { apply: SyncItem[][]; read: RowKeys[] } = { apply: [], read: [] };
  const db: ProgressDb = {
    async apply(items) {
      calls.apply.push(items);
      return opts.reply ? opts.reply(items) : { applied: items.map((i) => i.key), rejected: [] };
    },
    async read(keys) {
      calls.read.push(keys);
      return opts.rows ?? { lessons: [], exercises: [], writing: [] };
    },
  };
  return { db, calls };
}
const ctx = (db: ProgressDb, userId = USER) => ({ userId, index: INDEX, nowMs: NOW, db });

describe("runSync", () => {
  test("a whole-payload rejection writes nothing and reads nothing", async () => {
    const { db, calls } = fakeDb();
    const reply = await runSync({ expectedUserId: USER, items: [run, { ...attempt, text: "Mon texte." }] }, ctx(db));
    assert.deepEqual(reply, { status: "invalid", code: "unexpected_field" });
    assert.deepEqual(calls, { apply: [], read: [] });
  });

  test("another user's payload is refused before validation or writing", async () => {
    const { db, calls } = fakeDb();
    assert.deepEqual(await runSync({ expectedUserId: "someone-else", items: [run] }, ctx(db)), { status: "wrong-user" });
    assert.equal(calls.apply.length, 0);
  });

  test("rejected entries never reach apply_progress; the rest go in order", async () => {
    const { db, calls } = fakeDb();
    const bad = { ...attempt, key: "e2", lessonId: "a2-review-work" }; // exercise from the other "review-work"
    const reply = await runSync({ expectedUserId: USER, items: [attempt, bad, run] }, ctx(db));
    assert.equal(reply.status, "ok");
    assert.deepEqual(calls.apply[0].map((i) => i.key), ["e1", "r1"]);
    assert.deepEqual(calls.read[0], { lessons: ["a2-review-work"], exercises: ["b1-review-work-ex003"], writing: [] });
    if (reply.status === "ok") assert.deepEqual(reply.rejected, [{ key: "e2", code: "wrong_lesson" }]);
  });

  test("returns the stored rows for the keys sent, times as millisecond ISO", async () => {
    const { db } = fakeDb({
      reply: () => ({ applied: ["r1"], rejected: [{ key: "e1", code: "cap_reached" }] }),
      rows: {
        lessons: [{ lesson_id: "a2-review-work", best_score: 11, best_total: 12, last_run_at: "2026-11-25T11:59:00+00:00", completed_at: "2026-11-20T08:00:00.5+00:00" }],
        exercises: [],
        writing: [],
      },
    });
    const reply = await runSync({ expectedUserId: USER, items: [attempt, run] }, ctx(db));
    assert.deepEqual(reply, {
      status: "ok",
      applied: ["r1"],
      rejected: [{ key: "e1", code: "cap_reached" }],
      rows: {
        exercises: {},
        lessons: { "a2-review-work": { bestScore: 11, bestTotal: 12, lastCompletedAt: "2026-11-25T11:59:00.000Z", completedAt: "2026-11-20T08:00:00.500Z" } },
        writingTasks: {},
      },
    });
  });

  test("a malformed apply_progress reply, or one naming keys never sent, is 'unavailable'", async () => {
    for (const bad of [null, "ok", { applied: "r1", rejected: [] }, { applied: ["zzz"], rejected: [] }, { applied: [], rejected: [{ key: "r1" }] }]) {
      const { db, calls } = fakeDb({ reply: () => bad });
      assert.deepEqual(await runSync({ expectedUserId: USER, items: [run] }, ctx(db)), { status: "unavailable" });
      assert.equal(calls.read.length, 0);
    }
  });

  test("only invalid entries: no database call at all", async () => {
    const { db, calls } = fakeDb();
    const reply = await runSync({ expectedUserId: USER, items: [{ ...run, total: 0 }] }, ctx(db));
    assert.deepEqual(reply, { status: "ok", applied: [], rejected: [{ key: "r1", code: "bad_score" }], rows: { exercises: {}, lessons: {}, writingTasks: {} } });
    assert.deepEqual(calls, { apply: [], read: [] });
  });

  test("database errors propagate, so the action answers 'unavailable'", async () => {
    const db: ProgressDb = {
      apply: async () => {
        throw Object.assign(new Error("boom"), { code: "PGRST000" });
      },
      read: async () => ({ lessons: [], exercises: [], writing: [] }),
    };
    await assert.rejects(runSync({ expectedUserId: USER, items: [run] }, ctx(db)));
  });
});

describe("rows", () => {
  test("rowsToProgress maps columns and sorts ticks; toIsoMs refuses garbage", () => {
    const data = rowsToProgress({
      lessons: [],
      exercises: [{ exercise_id: "x", attempts: 3, correct_count: 1, last_result: "incorrect", last_attempt_at: "2026-11-25T10:00:00Z" }],
      writing: [{ exercise_id: "w", done: true, checked: [3, 1], done_at: "2026-11-25T10:00:00.120+00:00" }],
    });
    assert.deepEqual(data.exercises.x, { attempts: 3, correct: 1, lastResult: "incorrect", lastAttemptedAt: "2026-11-25T10:00:00.000Z" });
    assert.deepEqual(data.writingTasks!.w, { done: true, checked: [1, 3], doneAt: "2026-11-25T10:00:00.120Z" });
    assert.throws(() => toIsoMs("not a time"));
  });
});
