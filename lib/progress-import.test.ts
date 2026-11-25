// Importing this browser's signed-out progress at sign-in (docs/plans/progress.md, section 8), the
// one-time notice, and the non-blocking first load. Fakes: lib/progress-test-fakes.ts.
// Run: npm run test:progress
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { LocalProgressStore, STORAGE_KEY, type ProgressData } from "./progress-core.ts";
import { IMPORT_NOTICE, IMPORT_NOTICE_PARTIAL, IMPORT_OWNER_KEY, IMPORTED_MARKER_KEY, outboxKey, type SupabaseProgressStore } from "./progress-store.ts";
import { MAX_PAYLOAD_BYTES } from "./progress-validate.ts";
import { A, ALL_EXERCISES, B, facadeWorld, settle, world, type World } from "./progress-test-fakes.ts";

const T = (s: number) => new Date(Date.UTC(2026, 10, 20, 9, 0, s)).toISOString();

/** Signed-out progress as LocalProgressStore saves it, in the same storage the synced store reads. */
function anonymous(w: World, data: ProgressData) {
  (globalThis as { localStorage?: unknown }).localStorage = w.storage; // one storage, as in the browser
  w.storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const sample = (): ProgressData => ({
  exercises: {
    "a2-review-work-ex001": { attempts: 3, correct: 2, lastResult: "correct", lastAttemptedAt: T(1) },
    "b1-review-work-ex002": { attempts: 1, correct: 0, lastResult: "incorrect", lastAttemptedAt: T(2) },
  },
  lessons: { "a2-review-work": { bestScore: 11, bestTotal: 12, lastCompletedAt: T(3), completedAt: T(0) } },
  writingTasks: { "c2-review-form-ex017": { done: true, checked: [0, 2], doneAt: T(4) } },
});

describe("claiming", () => {
  test("the first account to sign in claims the browser's signed-out progress; a second account gets nothing", async () => {
    const f = facadeWorld(null);
    anonymous(f.w, sample());
    await f.facade.getAll(); // page load, signed out
    assert.equal(f.w.storage.getItem(IMPORT_OWNER_KEY), null, "nobody claims it while signed out");

    await f.switchTo(A);
    await f.w.clock.advance(1000);
    assert.equal(f.w.storage.getItem(IMPORT_OWNER_KEY), A);
    const rowsA = f.w.server.rows(A);
    assert.equal(rowsA.exercises.length, 2);
    assert.equal(rowsA.lessons[0].best_score, 11);
    assert.equal(rowsA.lessons[0].completed_at, T(0), "earliest completion kept");
    assert.deepEqual(rowsA.writing[0].checked, [0, 2]);

    await f.switchTo(null);
    await f.switchTo(B);
    await f.w.clock.advance(5000);
    assert.equal(f.w.storage.getItem(IMPORT_OWNER_KEY), A, "the claim never changes");
    assert.deepEqual(f.w.server.rows(B), { lessons: [], exercises: [], writing: [] }, "B receives nothing");
    assert.ok(f.w.server.calls.filter((c) => c.expectedUserId === B).every((c) => c.items.every((i) => !i.key.startsWith("i"))), "no import entry ever sent as B");
    assert.equal(await f.facade.importNotice(), null, "B never sees the notice");
  });

  test("someone already signed in imports on the first page load with sync on (no sign-in event)", async () => {
    const f = facadeWorld(A);
    anonymous(f.w, sample());
    await f.facade.getAll(); // the first page load: the facade starts already signed in
    await f.w.clock.advance(1000);
    assert.equal(f.w.storage.getItem(IMPORT_OWNER_KEY), A);
    assert.equal(f.w.server.rows(A).exercises.length, 2);
  });

  test("the claim is set once even when two tabs sign in at the same time", async () => {
    const w = world();
    anonymous(w, sample());
    const tab1 = facadeWorld(A, w);
    const tab2 = facadeWorld(A, w);
    await Promise.all([tab1.facade.getAll(), tab2.facade.getAll()]);
    await w.clock.advance(5000);
    const keys = w.server.calls.flatMap((c) => c.items.map((i) => i.key)).filter((k) => k.startsWith("i"));
    assert.equal(keys.length, new Set(keys).size, "each import entry sent once");
    assert.equal(keys.length, 4);
  });
});

describe("what's imported and how", () => {
  test("merge rules: max of the counts, best score, earliest completion, later writing record", async () => {
    const w = world();
    // The account already has progress from another device.
    w.server.rows(A).exercises.push({ exercise_id: "a2-review-work-ex001", attempts: 5, correct_count: 1, last_result: "incorrect", last_attempt_at: T(9) });
    w.server.rows(A).lessons.push({ lesson_id: "a2-review-work", best_score: 12, best_total: 12, last_run_at: T(9), completed_at: T(5) });
    w.server.rows(A).writing.push({ exercise_id: "c2-review-form-ex017", done: true, checked: [1], done_at: T(9) });
    anonymous(w, sample());
    const f = facadeWorld(A, w);
    await f.facade.getAll();
    await w.clock.advance(1000);
    const ex = w.server.rows(A).exercises.find((e) => e.exercise_id === "a2-review-work-ex001")!;
    assert.deepEqual([ex.attempts, ex.correct_count, ex.last_result], [5, 2, "incorrect"], "max counts; the newer result (the server's)");
    const lesson = w.server.rows(A).lessons[0];
    assert.deepEqual([lesson.best_score, lesson.completed_at], [12, T(0)], "best 12/12 kept; earlier completion from this browser");
    assert.deepEqual(w.server.rows(A).writing[0].checked, [1], "the later writing record (the server's) wins");
  });

  test("writing text is never sent: only ids, ticks and the time", async () => {
    const w = world();
    anonymous(w, sample());
    w.storage.setItem("parlons-writing-draft-v1:c2-review-form-ex017", "Mon brouillon secret.");
    const f = facadeWorld(A, w);
    await f.facade.getAll();
    await w.clock.advance(1000);
    const sent = JSON.stringify(w.server.calls);
    assert.equal(sent.includes("brouillon"), false);
    const writing = w.server.calls.flatMap((c) => c.items).find((i) => i.kind === "writing")!;
    assert.deepEqual(Object.keys(writing).sort(), ["checked", "doneAt", "exerciseId", "key", "kind", "lessonId"]);
  });

  test("a big history goes out in batches of at most 200 entries and 128 KiB", async () => {
    const w = world();
    const data: ProgressData = { exercises: {}, lessons: {} };
    for (let i = 0; i < 450; i++) data.exercises[ALL_EXERCISES[i]] = { attempts: 2, correct: 1, lastResult: "correct", lastAttemptedAt: T(i % 50) };
    anonymous(w, data);
    const f = facadeWorld(A, w);
    await f.facade.getAll();
    await w.clock.advance(1000);
    assert.deepEqual(w.server.calls.map((c) => c.items.length), [200, 200, 50]);
    for (const c of w.server.calls) assert.ok(new TextEncoder().encode(JSON.stringify(c)).length <= MAX_PAYLOAD_BYTES);
    assert.equal(w.server.rows(A).exercises.length, 450);
  });

  test("partial rejection: the rest still imports, nothing local is deleted, and the notice says so", async () => {
    const w = world();
    const data = sample();
    data.exercises["a1-old-lesson-ex001"] = { attempts: 1, correct: 1, lastResult: "correct", lastAttemptedAt: T(6) }; // removed from the content
    anonymous(w, data);
    const before = w.storage.getItem(STORAGE_KEY);
    const f = facadeWorld(A, w);
    await f.facade.getAll();
    await w.clock.advance(1000);
    assert.equal(w.server.rows(A).exercises.length, 2, "the two known exercises imported");
    assert.equal(w.storage.getItem(STORAGE_KEY), before, "the signed-out data is untouched");
    assert.deepEqual(await f.facade.importNotice(), { text: IMPORT_NOTICE_PARTIAL });
  });
});

describe("resuming and duplicates", () => {
  test("a closed tab or a failed send resumes from the outbox; the import is never queued twice", async () => {
    const w = world();
    anonymous(w, sample());
    w.server.behaviour = "network";
    const first = facadeWorld(A, w);
    await first.facade.getAll();
    await w.clock.advance(1000);
    assert.ok(w.storage.getItem(outboxKey(A)), "kept after the failure");
    assert.ok(w.storage.getItem(IMPORTED_MARKER_KEY), "the marker was written with the entries");
    const store = (await first.facade.currentStore()) as SupabaseProgressStore;
    store.stop(); // the tab closes

    w.server.behaviour = "ok";
    const second = facadeWorld(A, w); // the next page load
    await second.facade.getAll();
    await w.clock.advance(1000);
    assert.equal(w.storage.getItem(outboxKey(A)), null);
    const store2 = (await second.facade.currentStore()) as SupabaseProgressStore;
    assert.equal(await store2.importAnonymous(), 0, "nothing new to import");
    const rows = w.server.rows(A);
    assert.equal(rows.exercises.find((e) => e.exercise_id === "a2-review-work-ex001")!.attempts, 3, "counts not doubled by the resend");
    const applied = w.server.calls.filter((c) => c.items.length).length;
    assert.ok(applied >= 2, "sent once on the failed load, once on the next");
  });

  test("later signed-out work is re-imported into the owner only, and only what's new", async () => {
    const w = world();
    anonymous(w, sample());
    const f = facadeWorld(A, w);
    await f.facade.getAll();
    await w.clock.advance(1000);
    const sentBefore = w.server.calls.flatMap((c) => c.items).length;
    await f.switchTo(null);
    const local = new LocalProgressStore();
    await local.recordAttempt("a1-greetings-ex001", "correct"); // signed-out work, later
    await f.switchTo(A);
    await w.clock.advance(1000);
    const newItems = w.server.calls.flatMap((c) => c.items).slice(sentBefore);
    assert.deepEqual(newItems.map((i) => i.key), ["ie:a1-greetings-ex001"]);
  });
});

describe("after the import", () => {
  test("the signed-out data stays as it was, and a later signed-out visitor never sees the account's progress", async () => {
    const w = world();
    w.server.rows(A).lessons.push({ lesson_id: "b2-review-work", best_score: 16, best_total: 16, last_run_at: T(9), completed_at: T(9) });
    anonymous(w, sample());
    const before = w.storage.getItem(STORAGE_KEY);
    const f = facadeWorld(A, w);
    assert.ok((await f.facade.getAll()) !== null);
    await w.clock.advance(1000);
    assert.ok((await f.facade.getAll()).lessons["b2-review-work"], "signed in: the account's own progress shows");
    await f.switchTo(null);
    const shown = await f.facade.getAll();
    assert.equal(w.storage.getItem(STORAGE_KEY), before, "left in place (the plan, decision 6)");
    assert.deepEqual(Object.keys(shown.lessons), ["a2-review-work"], "only this browser's signed-out progress");
  });
});

describe("the notice", () => {
  test("shown once after a confirmed import, in the plan's words", async () => {
    const f = facadeWorld(A);
    anonymous(f.w, sample());
    f.w.server.behaviour = "block"; // the import's send is in flight, not yet confirmed
    await f.facade.getAll();
    await settle();
    assert.equal(await f.facade.importNotice(), null, "not before the server confirms");
    f.w.server.release();
    await f.w.clock.advance(1000);
    assert.deepEqual(await f.facade.importNotice(), { text: IMPORT_NOTICE });
    assert.equal(IMPORT_NOTICE, "We added the progress saved in this browser to your account.");
    await f.facade.markImportNoticeShown();
    assert.equal(await f.facade.importNotice(), null, "never again");
  });

  test("never shown for an empty import, or with sync off", async () => {
    const f = facadeWorld(A);
    anonymous(f.w, { exercises: {}, lessons: {} });
    await f.facade.getAll();
    await f.w.clock.advance(1000);
    assert.equal(await f.facade.importNotice(), null);
    assert.equal(await new LocalProgressStore().importNotice(), null);
  });

  test("the notice is on /progress only: role=status, a Dismiss button, Esc closes it, marked shown once", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components", "progress-dashboard.tsx"), "utf8");
    assert.match(src, /role="status"/);
    assert.match(src, /onClick=\{\(\) => setNoticeOpen\(false\)\}/);
    assert.match(src, /e\.key === "Escape"/);
    assert.match(src, /markImportNoticeShown\(\)/);
    const layout = fs.readFileSync(path.join(process.cwd(), "app", "layout.tsx"), "utf8");
    assert.doesNotMatch(layout, /ImportNotice/, "no notice on other pages");
    assert.equal(fs.existsSync(path.join(process.cwd(), "components", "progress-import-notice.tsx")), false);
  });
});

describe("re-import after a session ends", () => {
  test("the session expires, the learner practises signed out, signs back in: the new practice is imported; another account gets nothing", async () => {
    const w = world();
    anonymous(w, sample());
    const day1 = facadeWorld(A, w);
    await day1.facade.getAll();
    await w.clock.advance(1000);
    const firstImport = w.server.calls.flatMap((c) => c.items).length;

    // Next page load: the session has expired, so the browser is signed out.
    const day2 = facadeWorld(null, w);
    w.server.sessionUser = null;
    await day2.facade.getAll();
    await settle();
    await day2.facade.recordAttempt("a1-greetings-ex002", "correct"); // signed-out practice
    await day2.facade.recordRun("a1-greetings", 9, 10);
    assert.ok(new LocalProgressStore() && JSON.parse(w.storage.getItem(STORAGE_KEY)!).lessons["a1-greetings"], "saved in the signed-out store");

    // Another account signs in on this browser first: it gets nothing.
    await day2.switchTo(B);
    await w.clock.advance(1000);
    assert.deepEqual(w.server.rows(B).exercises, []);
    assert.deepEqual(w.server.rows(B).lessons, []);
    await day2.switchTo(null);

    // The claiming account signs back in: only the new practice goes up.
    await day2.switchTo(A);
    await w.clock.advance(1000);
    const newItems = w.server.calls.filter((c) => c.expectedUserId === A).flatMap((c) => c.items).slice(firstImport);
    assert.deepEqual(newItems.map((i) => i.key).sort(), ["ie:a1-greetings-ex002", "il:a1-greetings"]);
    assert.equal(w.server.rows(A).lessons.find((l) => l.lesson_id === "a1-greetings")!.best_score, 9);
    assert.equal(w.storage.getItem(IMPORT_OWNER_KEY), A);
  });

  test("a page load while already signed in also picks up signed-out practice made in between", async () => {
    const w = world();
    anonymous(w, sample());
    const first = facadeWorld(A, w);
    await first.facade.getAll();
    await w.clock.advance(1000);
    // Practice saved signed out in another way (e.g. a tab that never signed in), then a reload while signed in.
    const data = JSON.parse(w.storage.getItem(STORAGE_KEY)!);
    data.exercises["a1-greetings-ex003"] = { attempts: 1, correct: 1, lastResult: "correct", lastAttemptedAt: new Date(w.clock.now).toISOString() };
    w.storage.setItem(STORAGE_KEY, JSON.stringify(data));
    const reload = facadeWorld(A, w);
    await reload.facade.getAll();
    await w.clock.advance(1000);
    assert.ok(w.server.rows(A).exercises.some((e) => e.exercise_id === "a1-greetings-ex003"));
  });
});

describe("reads before the facade is ready", () => {
  test("while the wiring chunk is still loading, reads answer from the last user's cache or the signed-out store", async () => {
    const w = world();
    anonymous(w, sample());
    const signedIn = facadeWorld(A, w);
    await signedIn.facade.getAll();
    await w.clock.advance(1000);
    // A new page whose wiring never finishes loading:
    const { SyncFacade } = await import("./progress-store.ts");
    const stuck = new SyncFacade(() => new Promise(() => {}), () => w.env, new LocalProgressStore());
    const all = await stuck.getAll();
    assert.ok(all.lessons["a2-review-work"], "the hinted account's cached progress, at once");
    assert.equal(await stuck.mode(), "account");
    w.storage.removeItem("parlons-progress-last-user-v1");
    const stuck2 = new SyncFacade(() => new Promise(() => {}), () => w.env, new LocalProgressStore());
    assert.deepEqual(Object.keys((await stuck2.getAll()).lessons), ["a2-review-work"], "no hint: the signed-out store");
    assert.equal(await stuck2.mode(), "browser-signed-out");
  });

  test("the lesson-list badge slot is always rendered at full size", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components", "progress-status.tsx"), "utf8");
    assert.match(src, /<span className="inline-flex h-5 min-w-\[10\.5rem\] items-center">\s*\{lesson &&/);
  });
});

describe("first load never waits for the network", () => {
  test("with the server read stuck, every read answers at once from local data", async () => {
    const w = world();
    w.server.hangGets = true;
    anonymous(w, sample());
    const f = facadeWorld(A, w);
    await f.facade.recordRun("b1-review-work", 9, 14);
    let done = 0;
    const reads = [f.facade.getAll(), f.facade.getLessonProgress("b1-review-work"), f.facade.getWritingTask("c2-review-form-ex017")].map((p) => p.then((v) => (done++, v)));
    await settle();
    assert.equal(done, 3, "all three reads resolved while getProgressAction is still pending");
    const [all, lesson] = await Promise.all(reads);
    assert.equal((lesson as { bestScore: number }).bestScore, 9);
    assert.ok((all as ProgressData).lessons["a2-review-work"], "imported signed-out progress shows at once");
    assert.equal(w.server.gets, 1, "one shared server read, still pending");
  });

  test("subscribers hear when the server's copy lands", async () => {
    const w = world();
    w.server.rows(A).lessons.push({ lesson_id: "c1-review-final", best_score: 9, best_total: 10, last_run_at: T(9), completed_at: T(9) });
    const release = w.server.holdGets();
    const f = facadeWorld(A, w);
    let heard = 0;
    f.facade.subscribe(() => heard++);
    const first = await f.facade.getAll();
    heard = 0;
    release();
    assert.equal(first.lessons["c1-review-final"], undefined, "not there on the first, immediate read");
    await settle();
    assert.ok(heard > 0);
    assert.equal((await f.facade.getAll()).lessons["c1-review-final"].bestScore, 9);
  });

  test("the lesson player and the writing task start without waiting for a store read", () => {
    const player = fs.readFileSync(path.join(process.cwd(), "components", "exercise-player.tsx"), "utf8");
    const runEffect = player.slice(player.indexOf("useEffect(() => {\n    setRun"), player.indexOf("}, [exercises]);"));
    assert.ok(runEffect.includes("createRun(exercises, 1, \"full\")") && !runEffect.includes("progressStore"), "the run starts in its own effect, not after a read");
    assert.match(player, /min-h-5 basis-full[^"]*sm:basis-auto/, "the best-score line keeps its space");
    const writing = fs.readFileSync(path.join(process.cwd(), "components", "writing-task.tsx"), "utf8");
    const draftEffect = writing.slice(writing.indexOf("useEffect(() => {\n    setText(loadDraft"), writing.indexOf("}, [exercise.id]);"));
    assert.ok(draftEffect.includes("setLoaded(true)") && !draftEffect.includes("progressStore"), "the draft loads without a store read");
  });
});
