// The synced store, the outbox and the facade, with the fakes in lib/progress-test-fakes.ts.
// Run: npm run test:progress
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { LocalProgressStore, STORAGE_KEY, type ProgressData } from "./progress-core.ts";
import { BATCH_MAX_ITEMS, toWire, type Outbox } from "./progress-outbox.ts";
import { cacheKey, createProgressStore, isActionNotFound, outboxKey, rejectedKey, RETRY_FIRST_MS, SupabaseProgressStore, type Wiring } from "./progress-store.ts";
import { MAX_PAYLOAD_BYTES } from "./progress-validate.ts";
import { A, B, ex, facadeWorld, FakeStorage, outboxOf, settle, storeFor, world } from "./progress-test-fakes.ts";

// ---------- Tests ----------

describe("writes are local first", () => {
  test("a write resolves with the local store's value, before any network call", async () => {
    const w = world();
    const store = storeFor(w);
    const local = new LocalProgressStore();
    const got = await store.recordRun("a1-greetings", 9, 10);
    assert.deepEqual(Object.keys(got).sort(), ["bestScore", "bestTotal", "completedAt", "lastCompletedAt"]);
    assert.equal(got.bestScore, 9);
    assert.equal(w.server.calls.length, 0, "nothing sent yet");
    assert.deepEqual(Object.keys(outboxOf(w).slots), ["l:a1-greetings"]);
    void local;
    await w.clock.advance(1000);
    assert.equal(w.server.calls.length, 1, "sent after the 1 s debounce");
    assert.equal(w.storage.getItem(outboxKey(A)), null, "outbox emptied");
    assert.equal(w.server.rows(A).lessons[0].best_score, 9);
  });

  test("every outbox, cache and rejection-log change runs under the outbox lock", async () => {
    const w = world();
    w.storage.onSet = (k) => {
      if (k.startsWith("parlons-progress-")) assert.ok(w.locks!.held.has("parlons-progress-outbox"), `${k} changed outside the lock`);
    };
    const store = storeFor(w);
    w.server.rejectKeys.set(`e:${ex(1)}`, "cap_reached");
    await store.recordAttempt(ex(0), "correct");
    await store.recordAttempt(ex(1), "incorrect");
    await store.recordWritingTask("c2-review-form-ex017", [1, 0]);
    await w.clock.advance(1000);
    await store.getAll();
    assert.equal(w.server.calls.length, 1);
  });
});

describe("in flight and pending", () => {
  test("an answer while a send is in flight goes to pending, never into the frozen entry", async () => {
    const w = world();
    const store = storeFor(w);
    await store.recordAttempt(ex(0), "incorrect");
    w.server.behaviour = "block";
    const flushing = store.flush();
    await settle();
    await store.recordAttempt(ex(0), "correct");
    await store.recordAttempt(ex(0), "correct");
    const slot = outboxOf(w).slots[`e:${ex(0)}`];
    assert.equal(slot.inFlight?.kind === "attempt" && slot.inFlight.addAttempts, 1, "in flight unchanged");
    assert.equal(slot.pending?.kind === "attempt" && slot.pending.addAttempts, 2, "two answers folded into pending");
    w.server.release();
    await flushing;
    await settle();
    assert.equal(w.server.calls.length, 2, "in flight first, then pending in the next call");
    const row = w.server.rows(A).exercises[0];
    assert.deepEqual([row.attempts, row.correct_count, row.last_result], [3, 2, "correct"]);
    assert.equal(w.storage.getItem(outboxKey(A)), null);
  });

  test("an in-flight entry left by a closed tab is sent again first", async () => {
    const w = world();
    const outbox: Outbox = {
      v: 1,
      userId: A,
      seq: 2,
      slots: {
        [`e:${ex(5)}`]: { pending: { kind: "attempt", seq: 1, lessonId: ex(5).replace(/-ex\d+$/, ""), exerciseId: ex(5), result: "correct", attemptedAt: new Date(w.clock.now - 5000).toISOString(), addAttempts: 1, addCorrect: 1 } },
        [`e:${ex(6)}`]: { inFlight: { kind: "attempt", seq: 2, lessonId: ex(6).replace(/-ex\d+$/, ""), exerciseId: ex(6), result: "incorrect", attemptedAt: new Date(w.clock.now - 9000).toISOString(), addAttempts: 1, addCorrect: 0 } },
      },
    };
    w.storage.setItem(outboxKey(A), JSON.stringify(outbox));
    await storeFor(w).flush();
    assert.deepEqual(w.server.calls[0].items.map((i) => i.key), [`e:${ex(6)}`, `e:${ex(5)}`]);
  });
});

describe("batches", () => {
  test("a big history goes out in calls of at most 200 entries and 128 KiB", async () => {
    const w = world();
    const store = storeFor(w);
    for (let i = 0; i < 450; i++) await store.recordAttempt(ex(i), i % 3 ? "correct" : "incorrect");
    await store.flush();
    assert.deepEqual(w.server.calls.map((c) => c.items.length), [200, 200, 50]);
    for (const c of w.server.calls) assert.ok(new TextEncoder().encode(JSON.stringify(c)).length <= MAX_PAYLOAD_BYTES);
    assert.equal(new Set(w.server.sentKeys()).size, 450, "each entry sent exactly once");
    assert.equal(w.server.rows(A).exercises.length, 450);
    assert.equal(BATCH_MAX_ITEMS, 200);
  });
});

describe("the server wins", () => {
  test("after ok, the cache takes the server's rows, with pending entries on top", async () => {
    const w = world();
    // Another device already stored a better run and a later completion.
    w.server.rows(A).lessons.push({ lesson_id: "a1-greetings", best_score: 10, best_total: 10, last_run_at: "2026-11-25T13:00:00.000Z", completed_at: "2026-11-01T09:00:00.000Z" });
    const store = storeFor(w);
    await store.recordRun("a1-greetings", 6, 10);
    assert.equal((await store.getLessonProgress("a1-greetings"))?.bestScore, 6, "the first read answers from the cache at once");
    await settle();
    assert.equal((await store.getLessonProgress("a1-greetings"))?.bestScore, 10, "then the page's server snapshot brings the server's row");
    await store.flush();
    const cached = await store.getLessonProgress("a1-greetings");
    assert.deepEqual(cached, { bestScore: 10, bestTotal: 10, lastCompletedAt: "2026-11-25T13:00:00.000Z", completedAt: "2026-11-01T09:00:00.000Z" });
  });
});

describe("rejections", () => {
  test("a rejected entry leaves the outbox, is logged with its code, never retried; local data stays", async () => {
    const w = world();
    const store = storeFor(w);
    w.server.rejectKeys.set(`e:${ex(1)}`, "cap_reached");
    await store.recordAttempt(ex(0), "correct");
    await store.recordAttempt(ex(1), "correct");
    await store.recordAttempt("a1-greetings-ex999", "correct"); // not in the content: unknown_id
    await store.flush();
    assert.equal(w.storage.getItem(outboxKey(A)), null);
    const log = JSON.parse(w.storage.getItem(rejectedKey(A))!);
    assert.equal(log.userId, A);
    assert.deepEqual(log.items.map((i: { key: string; code: string }) => [i.key, i.code]).sort(), [
      [`e:${ex(1)}`, "cap_reached"],
      ["e:a1-greetings-ex999", "unknown_id"],
    ]);
    const all = await store.getAll();
    assert.equal(all.exercises[ex(1)].attempts, 1, "the learner's local record is kept");
    await w.clock.advance(10 * 60_000);
    assert.equal(w.server.calls.length, 1, "no retry");
  });
});

describe("failures and retries", () => {
  for (const behaviour of ["network", "unavailable"] as const) {
    test(`${behaviour}: everything is kept and retried with backoff (30 s, 60 s, ...)`, async () => {
      const w = world();
      const store = storeFor(w);
      await store.recordAttempt(ex(0), "correct");
      w.server.behaviour = behaviour;
      await w.clock.advance(1000);
      assert.equal(w.server.calls.length, 1);
      assert.ok(outboxOf(w).slots[`e:${ex(0)}`].inFlight, "kept in flight");
      assert.deepEqual(w.clock.pending().filter((ms) => ms > 3000), [RETRY_FIRST_MS]);
      await store.recordAttempt(ex(0), "incorrect"); // a new answer meanwhile: pending
      await w.clock.advance(RETRY_FIRST_MS);
      assert.equal(w.server.calls.length, 2);
      assert.deepEqual(w.clock.pending().filter((ms) => ms > 3000), [2 * RETRY_FIRST_MS], "backoff doubles");
      w.server.behaviour = "ok";
      await w.clock.advance(2 * RETRY_FIRST_MS);
      const last = w.server.calls.slice(-2);
      assert.equal(last[0].items[0].kind === "attempt" && last[0].items[0].result, "correct", "the in-flight entry goes first");
      assert.equal(last[1].items[0].kind === "attempt" && last[1].items[0].result, "incorrect");
      assert.equal(w.storage.getItem(outboxKey(A)), null);
      assert.equal(w.server.rows(A).exercises[0].attempts, 2);
    });
  }

  test("isActionNotFound knows Next.js 16's 409 message and the older one, and not a network error", () => {
    assert.equal(isActionNotFound(new Error("Server Action unavailable.")), true);
    assert.equal(isActionNotFound(new Error('Failed to find Server Action "7f3a".')), true);
    assert.equal(isActionNotFound(new TypeError("fetch failed")), false);
  });

  test("'Server action not found' keeps everything and pauses until the next page load", async () => {
    const w = world();
    const store = storeFor(w);
    await store.recordAttempt(ex(0), "correct");
    w.server.behaviour = "not-found";
    await w.clock.advance(1000);
    assert.match(store.pausedReason ?? "", /server action not found/);
    assert.ok(outboxOf(w).slots[`e:${ex(0)}`]);
    await w.clock.advance(30 * 60_000);
    assert.equal(w.server.calls.length, 1, "no retries on this page");
    w.server.behaviour = "ok";
    await storeFor(w).flush(); // the next page load
    assert.equal(w.storage.getItem(outboxKey(A)), null);
  });

  test("a malformed reply or an 'invalid' payload also pauses, keeping the outbox", async () => {
    for (const behaviour of ["malformed", "invalid"] as const) {
      const w = world();
      const store = storeFor(w);
      await store.recordAttempt(ex(0), "correct");
      w.server.behaviour = behaviour;
      await store.flush();
      assert.ok(store.pausedReason);
      assert.ok(outboxOf(w).slots[`e:${ex(0)}`]);
    }
  });
});

describe("tabs", () => {
  test("two tabs never send the same entry twice, and lose nothing", async () => {
    const w = world();
    const tab1 = storeFor(w);
    const tab2 = storeFor(w);
    await Promise.all([tab1.recordAttempt(ex(0), "correct"), tab2.recordAttempt(ex(1), "correct"), tab1.recordAttempt(ex(0), "incorrect"), tab2.recordRun("a1-greetings", 8, 10)]);
    w.server.behaviour = "block";
    const f1 = tab1.flush();
    await settle();
    const f2 = tab2.flush(); // the flush lock is taken: tab 2 skips and looks again later
    await settle();
    assert.equal(w.server.calls.length, 1);
    w.server.release();
    await Promise.all([f1, f2]);
    await w.clock.advance(5000);
    const keys = w.server.sentKeys();
    assert.equal(keys.length, new Set(keys).size, "no entry sent twice");
    assert.equal(w.server.rows(A).exercises.find((e) => e.exercise_id === ex(0))!.attempts, 2);
    assert.equal(w.server.rows(A).lessons[0].best_score, 8);
  });

  test("without Web Locks there is no lock (the plan's fallback): writes still land, sends may repeat harmlessly", async () => {
    const w = world({ locks: false });
    const tab1 = storeFor(w);
    const tab2 = storeFor(w);
    await tab1.recordAttempt(ex(0), "correct");
    await tab2.recordAttempt(ex(1), "correct");
    await Promise.all([tab1.flush(), tab2.flush()]);
    await settle();
    assert.equal(w.server.rows(A).exercises.length, 2);
    for (const e of w.server.rows(A).exercises) assert.equal(e.attempts, 1, "a repeated send is a no-op on the server");
  });
});

// The local store uses the global localStorage: point it at a fake per test.
let globalStorage: FakeStorage;
beforeEach(() => {
  globalStorage = new FakeStorage();
  (globalThis as { localStorage?: unknown }).localStorage = globalStorage;
});

describe("accounts", () => {
  test("switching accounts: nothing of A is shown or sent under B; A's unsent work waits for A", async () => {
    const f = facadeWorld(A);
    f.w.server.behaviour = "unavailable"; // A's answer can't be sent yet
    await f.facade.recordAttempt(ex(0), "correct");
    await f.w.clock.advance(1000);
    assert.equal(JSON.parse(f.w.storage.getItem(cacheKey(A))!).userId, A, "the cache carries the user id");
    assert.equal(outboxOf(f.w, A).userId, A, "the outbox carries the user id");

    await f.switchTo(B);
    assert.equal(f.w.storage.getItem(cacheKey(A)), null, "A's synced copy is gone");
    assert.ok(f.w.storage.getItem(outboxKey(A)), "A's unsent answer is kept");
    assert.deepEqual((await f.facade.getAll()).exercises, {}, "B sees nothing of A");
    f.w.server.behaviour = "ok";
    await f.facade.recordAttempt(ex(1), "correct");
    await f.w.clock.advance(RETRY_FIRST_MS * 4);
    assert.ok(f.w.server.calls.every((c) => c.items.every((i) => !(i.kind === "attempt" && i.exerciseId === ex(0))) || c.expectedUserId === A), "A's entry never goes out as B");
    assert.deepEqual(f.w.server.rows(B).exercises.map((e) => e.exercise_id), [ex(1)]);
    assert.deepEqual(f.w.server.rows(A).exercises, []);

    await f.switchTo(A);
    await f.w.clock.advance(1000);
    assert.deepEqual(f.w.server.rows(A).exercises.map((e) => e.exercise_id), [ex(0)], "A's answer is sent once A is back");
    assert.equal(f.w.storage.getItem(outboxKey(A)), null);
  });

  test("an outbox under A's key that names another user is ignored", async () => {
    const w = world();
    w.storage.setItem(outboxKey(A), JSON.stringify({ v: 1, userId: B, seq: 1, slots: { [`e:${ex(0)}`]: { pending: toWireLike() } } }));
    await storeFor(w).flush();
    assert.equal(w.server.calls.length, 0);
  });

  test("sign-out: the local store answers again, every synced copy is removed, outboxes stay", async () => {
    const f = facadeWorld(A);
    globalStorage.setItem(STORAGE_KEY, JSON.stringify({ exercises: {}, lessons: { "a1-greetings": { bestScore: 2, bestTotal: 10, lastCompletedAt: "2026-11-01T00:00:00.000Z" } } }));
    await f.facade.recordRun("a2-review-work", 12, 12);
    f.w.storage.setItem(cacheKey("cccccccc-0000-4000-8000-00000000000c"), JSON.stringify({ userId: "c", data: { exercises: {}, lessons: { x: {} } } }));
    f.w.server.behaviour = "unavailable";
    await f.facade.recordAttempt(ex(0), "correct");
    await f.switchTo(null);
    assert.ok(![...f.w.storage.map.keys()].some((k) => k.startsWith("parlons-progress-v1:u:")), "no synced copy left for the next person");
    assert.ok(f.w.storage.getItem(outboxKey(A)), "A's unsent work is kept for A's next sign-in");
    const shown = await f.facade.getAll();
    assert.deepEqual(Object.keys(shown.lessons), ["a1-greetings"], "only this browser's signed-out progress");
    assert.ok(await f.facade.currentStore() instanceof LocalProgressStore);
  });

  test("a wrong-user reply stops sending and follows the browser's session", async () => {
    const f = facadeWorld(A);
    await f.facade.recordAttempt(ex(0), "correct");
    f.w.server.sessionUser = B; // the server's session is B's, the browser still says A
    await f.w.clock.advance(1000);
    const store = (await f.facade.currentStore()) as SupabaseProgressStore;
    assert.equal(store.userId, A);
    const sent = f.w.server.calls.length;
    await f.w.clock.advance(10 * 60_000);
    assert.equal(f.w.server.calls.length, sent, "stopped");
    assert.deepEqual(f.w.server.rows(B).exercises, [], "nothing written under B");
  });
});

describe("flag off: exactly as before", () => {
  const ops = async (store: { recordAttempt: Function; recordRun: Function; recordWritingTask: Function; getAll: Function }) => {
    await store.recordAttempt("a1-greetings-ex001", "correct");
    await store.recordRun("a1-greetings", 9, 10);
    await store.recordWritingTask("c2-review-form-ex017", [2, 1]);
    return store.getAll();
  };

  test("anything but 'on', or no Supabase config: the plain local store, no wiring loaded, no fetch", async () => {
    let loads = 0;
    let fetches = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetches++;
      throw new Error("no network allowed");
    }) as typeof fetch;
    try {
      for (const [flag, configured] of [[undefined, true], ["off", true], ["true", true], ["ON", true], ["1", true], ["on", false]] as const) {
        const store = createProgressStore({ flag, supabaseConfigured: configured, loadWiring: async () => (loads++, {} as Wiring) });
        assert.ok(store instanceof LocalProgressStore, `flag ${flag}, configured ${configured}`);
        await ops(store);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(loads, 0);
    assert.equal(fetches, 0);
  });

  test("sync on but signed out: same data as the local store, nothing sent, no synced keys", async () => {
    const f = facadeWorld(null);
    const viaFacade = await ops(f.facade);
    const facadeSaved = globalStorage.getItem(STORAGE_KEY);
    globalStorage.map.clear();
    const viaLocal = await ops(new LocalProgressStore());
    const strip = (d: ProgressData) => JSON.parse(JSON.stringify(d).replace(/"\d{4}-\d\d-\d\dT[^"]+"/g, '"T"'));
    assert.deepEqual(strip(viaFacade), strip(viaLocal));
    assert.ok(facadeSaved);
    assert.equal(f.w.server.calls.length + f.w.server.gets, 0);
    assert.equal(f.w.storage.map.size, 0, "no cache or outbox written");
  });

  test("lib/progress.ts with no flag in the environment exports the local store", async () => {
    assert.equal(process.env.NEXT_PUBLIC_PROGRESS_SYNC, undefined);
    const { progressStore } = await import("./progress.ts");
    assert.ok(progressStore instanceof LocalProgressStore);
  });
});

describe("privacy", () => {
  test("a writing entry carries exactly key, kind, ids, ticks and time", () => {
    const wire = toWire("w:c2-review-form-ex017", { kind: "writing", seq: 1, lessonId: "c2-review-form", exerciseId: "c2-review-form-ex017", checked: [0, 2], doneAt: "2026-11-25T12:00:00.000Z" });
    assert.deepEqual(Object.keys(wire).sort(), ["checked", "doneAt", "exerciseId", "key", "kind", "lessonId"]);
  });
});

function toWireLike() {
  return { kind: "attempt", seq: 1, lessonId: ex(0).replace(/-ex\d+$/, ""), exerciseId: ex(0), result: "correct", attemptedAt: "2026-11-25T11:00:00.000Z", addAttempts: 1, addCorrect: 1 };
}
