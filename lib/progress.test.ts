// The local store with a fake localStorage: legacy data without completedAt, and completedAt rules.
// Run: npm run test:progress
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}
const storage = new FakeStorage();
(globalThis as { localStorage?: unknown }).localStorage = storage;

const { progressStore } = await import("./progress.ts");
const KEY = "parlons-progress-v1";

// Saved by the store before completedAt existed (the shape in docs/plans/progress.md, section 2).
const legacy = {
  exercises: { "a1-etre-present-ex003": { attempts: 2, correct: 1, lastResult: "correct-accents", lastAttemptedAt: "2026-11-20T09:14:03.120Z" } },
  lessons: {
    "a1-etre-present": { bestScore: 11, bestTotal: 12, lastCompletedAt: "2026-11-20T09:16:40.002Z" },
    "a1-greetings": { bestScore: 3, bestTotal: 10, lastCompletedAt: "2026-11-19T08:00:00.000Z" },
  },
};

beforeEach(() => storage.map.clear());

describe("local store: legacy data", () => {
  test("loads without errors or changes, and invents no completedAt", async () => {
    storage.setItem(KEY, JSON.stringify(legacy));
    assert.deepEqual(await progressStore.getAll(), legacy);
    assert.deepEqual(await progressStore.getLessonProgress("a1-etre-present"), legacy.lessons["a1-etre-present"]);
    assert.equal(await progressStore.getWritingTask("c2-x-ex001"), null, "no writingTasks in old saves");
    assert.equal(storage.getItem(KEY), JSON.stringify(legacy), "reading writes nothing back");
  });

  test("a new answer keeps every legacy record", async () => {
    storage.setItem(KEY, JSON.stringify(legacy));
    await progressStore.recordAttempt("a1-greetings-ex001", "correct");
    const all = await progressStore.getAll();
    assert.deepEqual(all.lessons, legacy.lessons);
    assert.deepEqual(all.exercises["a1-etre-present-ex003"], legacy.exercises["a1-etre-present-ex003"]);
    assert.equal(all.exercises["a1-greetings-ex001"].attempts, 1);
  });

  test("a legacy lesson that already passed keeps its last run as the completion date on the next run", async () => {
    storage.setItem(KEY, JSON.stringify(legacy));
    const after = await progressStore.recordRun("a1-etre-present", 5, 12);
    assert.equal(after.completedAt, "2026-11-20T09:16:40.002Z");
    assert.equal(after.bestScore, 11, "the best is unchanged");
    assert.notEqual(after.lastCompletedAt, "2026-11-20T09:16:40.002Z", "the last run moved on");
  });

  test("a legacy lesson that never passed gets completedAt only from a passing run", async () => {
    storage.setItem(KEY, JSON.stringify(legacy));
    const failed = await progressStore.recordRun("a1-greetings", 5, 10);
    assert.equal("completedAt" in failed, false);
    const passed = await progressStore.recordRun("a1-greetings", 9, 10);
    assert.equal(passed.completedAt, passed.lastCompletedAt);
  });

  test("corrupted data still starts empty", async () => {
    storage.setItem(KEY, "{not json");
    assert.deepEqual(await progressStore.getAll(), { exercises: {}, lessons: {} });
  });
});

describe("local store: completedAt", () => {
  test("set by the first passing run and never moved later", async () => {
    const first = await progressStore.recordRun("b1-x", 4, 5);
    assert.ok(first.completedAt);
    await new Promise((r) => setTimeout(r, 5));
    const second = await progressStore.recordRun("b1-x", 5, 5);
    assert.equal(second.completedAt, first.completedAt, "a later, better run doesn't move it");
    assert.equal(second.bestScore, 5);
    const third = await progressStore.recordRun("b1-x", 0, 5);
    assert.equal(third.completedAt, first.completedAt, "a failing run doesn't clear it");
  });

  test("best score behaviour is unchanged (strictly higher ratio replaces, a tie keeps the old best)", async () => {
    await progressStore.recordRun("b1-y", 4, 5);
    assert.equal((await progressStore.recordRun("b1-y", 8, 10)).bestTotal, 5, "4/5 and 8/10 tie: old best kept");
    assert.equal((await progressStore.recordRun("b1-y", 9, 10)).bestScore, 9);
    assert.equal((await progressStore.recordRun("b1-y", 1, 10)).bestScore, 9, "a lower score never replaces the best");
  });
});
