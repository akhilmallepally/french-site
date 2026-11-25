// Shared browsers: an expired or invalid session is treated like a sign-out, and before the session
// is known only a stored, unexpired session for the same user unlocks that user's synced copy.
// Run: npm run test:progress
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LocalProgressStore, STORAGE_KEY } from "./progress-core.ts";
import { cacheKey, LAST_USER_KEY, outboxKey, SupabaseProgressStore, SyncFacade } from "./progress-store.ts";
import { storedSessionUserId } from "./supabase-session-cookie.ts";
import { A, B, ex, facadeWorld, settle, world, type World } from "./progress-test-fakes.ts";

const URL_ = "https://abcdefgh.supabase.co";
const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const session = (id: string, expiresInS: number) => JSON.stringify({ access_token: "x", refresh_token: "y", expires_at: Math.floor(NOW / 1000) + expiresInS, user: { id } });
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("storedSessionUserId (the Supabase auth cookie, read synchronously)", () => {
  test("a plain, a base64 and a chunked cookie", () => {
    assert.equal(storedSessionUserId(`sb-abcdefgh-auth-token=${encodeURIComponent(session(A, 600))}`, URL_, NOW), A);
    const encoded = `base64-${b64url(session(A, 600))}`;
    assert.equal(storedSessionUserId(`other=1; sb-abcdefgh-auth-token=${encoded}`, URL_, NOW), A);
    const [one, two] = [encoded.slice(0, 40), encoded.slice(40)];
    assert.equal(storedSessionUserId(`sb-abcdefgh-auth-token.0=${one}; sb-abcdefgh-auth-token.1=${two}`, URL_, NOW), A);
  });

  test("expired, another project's, missing or unreadable: nobody", () => {
    assert.equal(storedSessionUserId(`sb-abcdefgh-auth-token=base64-${b64url(session(A, -1))}`, URL_, NOW), null, "expired");
    assert.equal(storedSessionUserId(`sb-zzzzzzzz-auth-token=base64-${b64url(session(A, 600))}`, URL_, NOW), null, "another project");
    assert.equal(storedSessionUserId("", URL_, NOW), null);
    assert.equal(storedSessionUserId("sb-abcdefgh-auth-token=base64-%%%", URL_, NOW), null);
    assert.equal(storedSessionUserId(`sb-abcdefgh-auth-token=base64-${b64url(session(A, 600))}`, undefined, NOW), null, "no Supabase URL");
  });
});

/** A uses the site, with sync on, and leaves a synced copy and an unsent answer behind. */
async function aWasHere(): Promise<World> {
  const w = world();
  (globalThis as { localStorage?: unknown }).localStorage = w.storage;
  w.storage.setItem(STORAGE_KEY, JSON.stringify({ exercises: {}, lessons: {} }));
  w.server.rows(A).lessons.push({ lesson_id: "b2-review-work", best_score: 16, best_total: 16, last_run_at: "2026-11-20T09:00:00.000Z", completed_at: "2026-11-20T09:00:00.000Z" });
  const a = facadeWorld(A, w);
  await a.facade.getAll();
  await w.clock.advance(1000);
  w.server.behaviour = "unavailable"; // A's last answer never makes it
  await a.facade.recordAttempt(ex(0), "correct");
  await w.clock.advance(1000);
  assert.ok(w.storage.getItem(cacheKey(A)), "A's synced copy is in the browser");
  assert.ok(w.storage.getItem(outboxKey(A)), "and an unsent answer");
  ((await a.facade.currentStore()) as SupabaseProgressStore).stop(); // A closes the tab
  w.server.behaviour = "ok";
  return w;
}

describe("A's session expires; B opens the site signed out", () => {
  test("B never sees A's progress, not even before the session is known", async () => {
    const w = await aWasHere();
    w.cookieUser = null; // A's session expired; B has none
    const stuck = new SyncFacade(() => new Promise(() => {}), () => w.env, new LocalProgressStore());
    assert.equal((await stuck.getAll()).lessons["b2-review-work"], undefined, "before the session is known: signed-out progress only");
    assert.equal(await stuck.mode(), "browser-signed-out");

    const b = facadeWorld(null, w); // the session is read: nobody
    const shown = await b.facade.getAll();
    await settle();
    assert.equal(shown.lessons["b2-review-work"], undefined);
    assert.equal((await b.facade.getAll()).lessons["b2-review-work"], undefined);
    assert.equal(w.storage.getItem(cacheKey(A)), null, "A's synced copy is deleted, as at sign-out");
    assert.equal(w.storage.getItem(LAST_USER_KEY), null);
    assert.ok(w.storage.getItem(outboxKey(A)), "A's unsent answer stays");
    assert.ok(w.server.calls.every((c) => c.expectedUserId === A), "nothing went out under anyone else");
  });

  test("B with a session of their own never sees A's copy before B's session is read", async () => {
    const w = await aWasHere();
    w.cookieUser = B;
    const stuck = new SyncFacade(() => new Promise(() => {}), () => w.env, new LocalProgressStore());
    assert.equal((await stuck.getAll()).lessons["b2-review-work"], undefined);
  });

  test("A comes back: A's unsent answer is sent under A, and only A", async () => {
    const w = await aWasHere();
    w.cookieUser = null;
    const b = facadeWorld(null, w);
    await b.facade.getAll();
    await settle();
    const before = w.server.calls.length;
    await b.switchTo(A);
    await w.clock.advance(1000);
    const sent = w.server.calls.slice(before);
    assert.ok(sent.some((c) => c.items.some((i) => i.key === `e:${ex(0)}`)));
    assert.ok(sent.every((c) => c.expectedUserId === A));
    assert.equal(w.storage.getItem(outboxKey(A)), null);
    assert.equal(w.server.rows(A).exercises.find((e) => e.exercise_id === ex(0))?.attempts, 1);
  });
});

describe("the server says signed-out mid-session", () => {
  test("the auth server confirms the session is gone: handled like a sign-out", async () => {
    const w = world();
    (globalThis as { localStorage?: unknown }).localStorage = w.storage;
    const a = facadeWorld(A, w);
    await a.facade.getAll();
    await w.clock.advance(1000);
    a.setVerify(async () => null); // getUser: the session is invalid
    w.server.sessionUser = null; // the actions answer "signed-out"
    await a.facade.recordAttempt(ex(1), "correct");
    await w.clock.advance(1000);
    assert.equal(w.storage.getItem(cacheKey(A)), null, "A's synced copy is deleted");
    assert.ok(w.storage.getItem(outboxKey(A)), "the unsent answer stays for A");
    assert.ok((await a.facade.currentStore()) instanceof LocalProgressStore, "signed-out progress answers now");
  });

  test("the auth server can't be reached: nothing is deleted, the send is retried", async () => {
    const w = world();
    (globalThis as { localStorage?: unknown }).localStorage = w.storage;
    const a = facadeWorld(A, w);
    await a.facade.getAll();
    await w.clock.advance(1000);
    a.setVerify(async () => {
      throw new TypeError("fetch failed");
    });
    w.server.sessionUser = null;
    await a.facade.recordAttempt(ex(1), "correct");
    await w.clock.advance(1000);
    assert.ok(w.storage.getItem(cacheKey(A)), "kept");
    assert.ok(((await a.facade.currentStore()) as SupabaseProgressStore).userId === A);
    w.server.sessionUser = A; // the session comes back (a token refresh)
    await w.clock.advance(60_000);
    assert.equal(w.storage.getItem(outboxKey(A)), null, "sent once the session works again");
  });

  test("an explicit sign-out behaves as before", async () => {
    const w = world();
    (globalThis as { localStorage?: unknown }).localStorage = w.storage;
    const a = facadeWorld(A, w);
    await a.facade.getAll();
    await a.switchTo(null);
    assert.equal(w.storage.getItem(cacheKey(A)), null);
    assert.ok((await a.facade.currentStore()) instanceof LocalProgressStore);
  });
});
