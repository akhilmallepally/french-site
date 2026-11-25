// Prompt 64: practice never disappears when the sync flag changes or sync can't run; the cookie
// reader against cookies written by the real @supabase/ssr; unit names on /progress.
// Run: npm run test:progress
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { createBrowserClient } from "@supabase/ssr";
import { LocalProgressStore, STORAGE_KEY } from "./progress-core.ts";
import { importExerciseKey, parseOutbox, queueImport, emptyOutbox } from "./progress-outbox.ts";
import { ACTION_TIMEOUT_MS, BrowserLocalStore, cacheKey, IMPORT_OWNER_KEY, localKey, outboxKey, SupabaseProgressStore } from "./progress-store.ts";
import { summarize, type CatalogueLesson } from "./progress-summary.ts";
import { storedSessionUserId } from "./supabase-session-cookie.ts";
import { A, B, ex, facadeWorld, FakeStorage, settle, world } from "./progress-test-fakes.ts";

/** A browser-only store (flag off) whose session cookie says `who()`. */
function browserLocal(storage: FakeStorage, who: () => string | null) {
  (globalThis as { localStorage?: unknown }).localStorage = storage; // the signed-out store uses it too
  return new BrowserLocalStore(who, () => storage);
}

describe("flag off, signed in: practice belongs to the account", () => {
  test("signed in, writes go to the account's own key, not the shared signed-out store; both show", async () => {
    const storage = new FakeStorage();
    let who: string | null = null;
    const store = browserLocal(storage, () => who);
    await store.recordRun("a1-greetings", 7, 10); // signed out
    who = A;
    await store.recordRun("a1-alphabet-and-accents", 5, 11); // signed in
    await store.recordAttempt("a1-alphabet-and-accents-ex001", "correct");
    const anonymous = JSON.parse(storage.getItem(STORAGE_KEY)!);
    assert.deepEqual(Object.keys(anonymous.lessons), ["a1-greetings"], "the signed-out store holds only signed-out practice");
    assert.equal(JSON.parse(storage.getItem(localKey(A))!).userId, A);
    const seen = await store.getAll();
    assert.deepEqual(Object.keys(seen.lessons).sort(), ["a1-alphabet-and-accents", "a1-greetings"]);
    assert.equal((await store.getLessonProgress("a1-alphabet-and-accents"))?.bestScore, 5, "the lesson page finds it after a refresh");
    who = null; // signed out: the next visitor sees only signed-out progress
    assert.deepEqual(Object.keys((await store.getAll()).lessons), ["a1-greetings"]);
    who = B;
    assert.equal((await store.getAll()).lessons["a1-alphabet-and-accents"], undefined, "another account never sees it");
  });

  test("flag on, then off: the account's synced copy and unsent changes still show to that account", async () => {
    const f = facadeWorld(A);
    (globalThis as { localStorage?: unknown }).localStorage = f.w.storage;
    f.w.server.behaviour = "unavailable"; // one answer stays unsent
    await f.facade.recordRun("a1-alphabet-and-accents", 5, 11);
    f.w.server.behaviour = "ok";
    await f.w.clock.advance(RETRY());
    await f.facade.recordAttempt(ex(3), "correct");
    f.w.server.behaviour = "unavailable";
    await f.w.clock.advance(1000);
    assert.ok(f.w.storage.getItem(cacheKey(A)) && f.w.storage.getItem(outboxKey(A)));
    // The flag goes off (a new build): the browser-only store answers.
    const off = browserLocal(f.w.storage, () => A);
    assert.equal((await off.getLessonProgress("a1-alphabet-and-accents"))?.bestScore, 5, "synced practice still shows");
    assert.ok((await off.getAll()).exercises[ex(3)], "unsent practice still shows");
    assert.equal((await browserLocal(f.w.storage, () => null).getAll()).lessons["a1-alphabet-and-accents"], undefined, "not to a signed-out visitor");
  });

  test("flag back on: the account's local practice is sent to it whatever the import claim, and to nobody else", async () => {
    const w = world();
    (globalThis as { localStorage?: unknown }).localStorage = w.storage;
    w.storage.setItem(IMPORT_OWNER_KEY, B); // this browser's signed-out progress belongs to B
    const off = browserLocal(w.storage, () => A);
    await off.recordRun("a1-alphabet-and-accents", 5, 11); // A practises with the flag off
    await off.recordAttempt("a1-alphabet-and-accents-ex002", "correct");
    const on = facadeWorld(A, w);
    assert.equal((await on.facade.getLessonProgress("a1-alphabet-and-accents"))?.bestScore, 5, "shows at once with the flag on");
    await w.clock.advance(1000);
    assert.equal(w.server.rows(A).lessons[0]?.best_score, 5, "sent to A");
    assert.equal(w.server.rows(A).exercises.length, 1);
    assert.equal(w.storage.getItem(localKey(A)), null, "the local key is cleared once queued");
    assert.deepEqual(w.server.rows(B), { lessons: [], exercises: [], writing: [] }, "B (the claim owner) receives none of A's practice");
    await on.switchTo(null);
    await on.switchTo(B);
    await w.clock.advance(1000);
    assert.deepEqual(w.server.rows(B).lessons, []);
  });

  test("the facade's own fallback (sync can't start) keeps signed-in practice for the account", async () => {
    const w = world();
    w.cookieUser = A;
    (globalThis as { localStorage?: unknown }).localStorage = w.storage;
    const { SyncFacade } = await import("./progress-store.ts");
    const broken = new SyncFacade(async () => {
      throw new Error("chunk failed to load");
    }, () => w.env);
    await broken.recordRun("a1-alphabet-and-accents", 6, 11);
    assert.equal((await broken.getLessonProgress("a1-alphabet-and-accents"))?.bestScore, 6, "visible after the fallback write");
    assert.ok(w.storage.getItem(localKey(A)), "kept for A, to send when sync works");
    assert.equal(JSON.parse(w.storage.getItem(STORAGE_KEY) ?? '{"lessons":{}}').lessons["a1-alphabet-and-accents"], undefined);
  });
});

describe("sending never hangs", () => {
  test("an action that never answers times out, releases the flush lock and is retried", async () => {
    const w = world();
    const actions = w.server.actionsFor(w.clock);
    let hang = true;
    const store = new SupabaseProgressStore(A, { ...actions, sync: (input) => (hang ? new Promise(() => {}) : actions.sync(input)) }, w.env);
    await store.recordAttempt(ex(0), "correct");
    await w.clock.advance(1000);
    assert.ok(w.locks!.held.has("parlons-progress-flush"), "held while the call is pending");
    hang = false;
    await w.clock.advance(ACTION_TIMEOUT_MS);
    assert.equal(w.locks!.held.has("parlons-progress-flush"), false, "released after the timeout");
    await w.clock.advance(60_000);
    assert.equal(w.storage.getItem(outboxKey(A)), null, "sent on the retry");
    assert.equal(w.server.rows(A).exercises.length, 1);
  });
});

describe("importing lessons never passed", () => {
  test("a lesson with no completedAt (score under 80%) is imported, not skipped", () => {
    const { keys } = queueImport(emptyOutbox(A), { exercises: {}, lessons: { "a1-alphabet-and-accents": { bestScore: 5, bestTotal: 11, lastCompletedAt: "2026-11-26T09:00:00.000Z" } } }, -Infinity);
    assert.deepEqual(keys, ["il:a1-alphabet-and-accents"]);
  });
});

describe("imports from two sources merge", () => {
  test("the same exercise queued twice keeps the best of both (max counts, newer result)", () => {
    const one = queueImport(emptyOutbox(A), { exercises: { [ex(0)]: { attempts: 5, correct: 1, lastResult: "incorrect", lastAttemptedAt: "2026-11-20T09:00:00.000Z" } }, lessons: {} }, -Infinity);
    const two = queueImport(one.outbox, { exercises: { [ex(0)]: { attempts: 2, correct: 2, lastResult: "correct", lastAttemptedAt: "2026-11-21T09:00:00.000Z" } }, lessons: {} }, -Infinity);
    const slot = parseOutbox(JSON.stringify(two.outbox), A).slots[importExerciseKey(ex(0))];
    assert.equal(slot.pending?.kind, "import-exercise");
    if (slot.pending?.kind !== "import-exercise") return;
    assert.deepEqual(slot.pending.record, { attempts: 5, correct: 2, lastResult: "correct", lastAttemptedAt: "2026-11-21T09:00:00.000Z" });
  });
});

describe("the cookie reader against cookies written by @supabase/ssr itself", () => {
  /** Writes a session through the real library's storage and returns the cookies as document.cookie shows them. */
  async function realCookies(tokenLength: number) {
    const url = "https://abcdefghijklmnop.supabase.co";
    const jar = new Map<string, string>();
    const client = createBrowserClient(url, "sb_publishable_test", {
      isSingleton: false,
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cs) => cs.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
      },
    });
    const session = {
      access_token: `aaa.${"x".repeat(tokenLength)}.ccc`,
      refresh_token: "r",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: A, aud: "authenticated", app_metadata: {}, user_metadata: { full_name: "Test Learner" }, created_at: new Date().toISOString() },
    };
    // Private, but it's what a sign-in calls to store the session: the real cookie format, no network.
    await (client.auth as unknown as { _saveSession(s: unknown): Promise<void> })._saveSession(session);
    return { url, names: [...jar.keys()], header: [...jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; "), values: [...jar.values()] };
  }

  test("a single base64- cookie", async () => {
    const c = await realCookies(10);
    assert.deepEqual(c.names, ["sb-abcdefghijklmnop-auth-token"]);
    assert.ok(c.values[0].startsWith("base64-"));
    assert.equal(storedSessionUserId(c.header, c.url, Date.now()), A);
  });

  test("a long session split into .0 and .1 chunks", async () => {
    const c = await realCookies(4000);
    assert.deepEqual(c.names, ["sb-abcdefghijklmnop-auth-token.0", "sb-abcdefghijklmnop-auth-token.1"]);
    assert.equal(storedSessionUserId(c.header, c.url, Date.now()), A);
    assert.equal(storedSessionUserId(c.header, c.url, Date.now() + 2 * 3600_000), null, "expired an hour later");
  });
});

describe("/progress unit names", () => {
  test("every unit of every level has a non-empty name", () => {
    const index = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", "progress-index.json"), "utf8")) as {
      lessons: Record<string, { slug: string; level: string; unit: string; writingTask?: string }>;
    };
    const catalogue: CatalogueLesson[] = Object.entries(index.lessons).map(([id, l]) => ({ id, title: id, href: `/lessons/${l.level.toLowerCase()}/${l.slug}`, level: l.level, unit: l.unit, type: "grammar", free: false }));
    const { levels } = summarize(catalogue, { exercises: {}, lessons: {} });
    assert.deepEqual(levels.map((l) => l.level), ["A1", "A2", "B1", "B2", "C1", "C2"]);
    for (const l of levels) {
      assert.ok(l.units.length > 0, `${l.level} has units`);
      for (const u of l.units) assert.ok(u.name.trim().length > 0, `${l.level} has a unit with no name`);
    }
  });
});

const RETRY = () => 30_000;
void LocalProgressStore;
void settle;
