// The synced review store and its facade: local-first writes, the outbox, batching, the server
// winning, rejections, retries, the 409 pause, the timeout, tabs, accounts, sign-out, session
// expiry, the flag both ways, import and the shared claim, and flag-off parity.
// Run: npm run test:review
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { IMPORT_OWNER_KEY, type Wiring } from "./progress-store.ts";
import { cardKey, REVIEW_IMPORTED_MARKER_KEY, reviewCacheKey, reviewOutboxKey, reviewRejectedKey } from "./review-outbox.ts";
import { calendarFor, type CardState } from "./review-scheduler.ts";
import { LocalReviewStore, parseReviewData, REVIEW_KEY, reviewLocalKey } from "./review-store.ts";
import { createReviewStore, ReviewSyncFacade, SupabaseReviewStore } from "./review-sync-store.ts";
import { A, B, FREE_IDS, PAID_IDS, reviewFacadeWorld, reviewOutboxOf, reviewStoreFor, reviewWorld, settle } from "./review-test-fakes.ts";

const CAL = calendarFor("Europe/Paris");
const [C1, C2, C3] = FREE_IDS;

/** Adds cards and answers the first one, as a session would. */
async function practise(store: { addCards: Function; recordAnswer: Function }, now: number, ids = [C1, C2]) {
  await store.addCards(ids, now);
  return store.recordAnswer(ids[0], "knew", now + 1000, CAL);
}

describe("synced review store: local first and the outbox", () => {
  test("writes land locally before any network call, and are sent after the debounce", async () => {
    const w = reviewWorld();
    w.server.behaviour = "block";
    const s = reviewStoreFor(w);
    const after = await practise(s, w.clock.now);
    assert.equal(after.box, 1);
    assert.equal(w.server.calls.length, 0, "nothing sent yet");
    assert.equal((await s.getAll()).cards[C1].box, 1, "the cache shows it at once");
    assert.deepEqual(Object.keys(reviewOutboxOf(w).slots).sort(), [cardKey(C1), cardKey(C2)].sort());
    await w.clock.advance(1000);
    assert.equal(w.server.calls.length, 1);
    w.server.release();
    await settle();
    assert.equal(w.storage.getItem(reviewOutboxKey(A)), null, "the outbox empties once confirmed");
    assert.equal(w.server.of(A).get(C1)?.box, 1);
  });

  test("an answer while a send is in flight goes to pending; the in-flight entry is frozen", async () => {
    const w = reviewWorld();
    const s = reviewStoreFor(w);
    await s.addCards([C1], w.clock.now);
    w.server.behaviour = "block";
    await w.clock.advance(1000);
    await s.recordAnswer(C1, "knew", w.clock.now, CAL);
    const slot = reviewOutboxOf(w).slots[cardKey(C1)];
    assert.equal(slot.inFlight?.state.box, 0, "the sent state is unchanged");
    assert.equal(slot.pending?.state.box, 1);
    w.server.release();
    await settle();
    await w.clock.advance(1000);
    assert.equal(w.server.calls.length, 2);
    assert.equal(w.server.of(A).get(C1)?.box, 1);
    assert.equal(w.storage.getItem(reviewOutboxKey(A)), null);
  });

  test("a big deck goes out in calls of at most 200 entries and 120 KiB, and an in-flight entry left by a closed tab is sent first", async () => {
    const w = reviewWorld();
    const s = reviewStoreFor(w);
    await s.addCards(FREE_IDS.slice(0, 450), w.clock.now);
    w.server.behaviour = "network";
    await w.clock.advance(1000);
    assert.equal(w.server.calls.length, 1);
    w.server.behaviour = "ok";
    const second = reviewStoreFor(w); // a new page load: the in-flight 200 go first
    await second.flush();
    assert.deepEqual(w.server.calls.map((c) => c.items.length), [200, 200, 200, 50]);
    assert.deepEqual(w.server.calls[1].items.map((i) => i.key), w.server.calls[0].items.map((i) => i.key));
    for (const c of w.server.calls) assert.ok(new TextEncoder().encode(JSON.stringify(c)).length <= 120 * 1024);
    assert.equal(w.server.of(A).size, 450);
  });

  test("the server wins: its rows replace the cache, with pending entries on top", async () => {
    const w = reviewWorld();
    const later: CardState = { box: 4, dueAt: new Date(w.clock.now + 16 * 86400_000).toISOString(), lastReviewedAt: new Date(w.clock.now + 5000).toISOString(), reviews: 7, lapses: 1 };
    w.server.of(A).set(C1, later); // another device answered later
    const s = reviewStoreFor(w);
    await practise(s, w.clock.now);
    await w.clock.advance(1000);
    assert.deepEqual((await s.getAll()).cards[C1], later);
  });

  test("a rejected entry leaves the outbox, is logged with its code, never retried, and stays visible", async () => {
    const w = reviewWorld();
    w.server.rejectKeys.set(cardKey(C2), "cap_reached");
    const s = reviewStoreFor(w);
    await practise(s, w.clock.now);
    await w.clock.advance(1000);
    assert.deepEqual(JSON.parse(w.storage.getItem(reviewRejectedKey(A))!).items.map((r: { key: string; code: string }) => [r.key, r.code]), [[cardKey(C2), "cap_reached"]]);
    assert.ok(w.warnings.some((m) => m.includes("cap_reached")));
    await w.clock.advance(10 * 60_000);
    assert.equal(w.server.sentKeys().filter((k) => k === cardKey(C2)).length, 1, "not sent again");
    await s.ensureSnapshot(true);
    assert.ok((await s.getAll()).cards[C2], "a server snapshot doesn't hide it");
    assert.ok(!JSON.stringify(w.storage.map.get(reviewRejectedKey(A))).match(/"(fr|en)"/), "ids, boxes, times and counts only");
  });

  test("a paid card without access is rejected (no_access) and the free ones go ahead", async () => {
    const w = reviewWorld();
    const s = reviewStoreFor(w);
    await s.addCards([C1, PAID_IDS[0]], w.clock.now);
    await w.clock.advance(1000);
    assert.deepEqual([...w.server.of(A).keys()], [C1]);
    assert.match(w.storage.getItem(reviewRejectedKey(A))!, /no_access/);
  });

  for (const behaviour of ["network", "unavailable"] as const) {
    test(`${behaviour}: everything is kept and retried with backoff (30 s, 60 s, ...)`, async () => {
      const w = reviewWorld();
      w.server.behaviour = behaviour;
      const s = reviewStoreFor(w);
      await practise(s, w.clock.now);
      await w.clock.advance(1000);
      assert.equal(w.server.calls.length, 1);
      assert.deepEqual(w.clock.pending(), [30_000]);
      await w.clock.advance(30_000);
      assert.deepEqual(w.clock.pending(), [60_000]);
      w.server.behaviour = "ok";
      await w.clock.advance(60_000);
      assert.equal(w.server.of(A).size, 2);
      assert.equal(w.storage.getItem(reviewOutboxKey(A)), null);
    });
  }

  test("a call that never answers times out after 25 s and is retried", async () => {
    const w = reviewWorld();
    w.server.behaviour = "hang";
    const s = reviewStoreFor(w);
    await practise(s, w.clock.now);
    await w.clock.advance(1000);
    await w.clock.advance(25_000);
    assert.deepEqual(w.clock.pending(), [30_000], "counted as a network failure");
    w.server.behaviour = "ok";
    await w.clock.advance(30_000);
    assert.equal(w.server.of(A).size, 2);
  });

  for (const [behaviour, reason] of [["not-found", /server action not found/], ["malformed", /malformed/], ["invalid", /invalid payload/]] as const) {
    test(`${behaviour}: sending pauses until the next page load, keeping the outbox`, async () => {
      const w = reviewWorld();
      w.server.behaviour = behaviour;
      const s = reviewStoreFor(w);
      await practise(s, w.clock.now);
      await w.clock.advance(1000);
      assert.match(s.pausedReason ?? "", reason);
      await w.clock.advance(10 * 60_000);
      assert.equal(w.server.calls.length, 1);
      assert.equal(Object.keys(reviewOutboxOf(w).slots).length, 2);
    });
  }

  test("two tabs never send the same entry twice, and lose nothing", async () => {
    const w = reviewWorld();
    const t1 = reviewStoreFor(w);
    const t2 = reviewStoreFor(w);
    await Promise.all([t1.addCards([C1, C2], w.clock.now), t2.addCards([C2, C3], w.clock.now)]);
    w.server.behaviour = "block";
    const f1 = t1.flush();
    const f2 = t2.flush();
    await settle();
    w.server.release();
    await Promise.all([f1, f2]);
    await w.clock.advance(5000);
    assert.deepEqual(w.server.sentKeys().sort(), [C1, C2, C3].map(cardKey).sort());
    assert.equal(w.server.of(A).size, 3);
  });
});

describe("review facade: accounts, sign-out, session expiry", () => {
  test("the first load never waits on the network: reads answer while the wiring is still loading", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const w = reviewWorld();
    await new LocalReviewStore(() => null, () => w.storage).addCards([C1], w.clock.now);
    const f = reviewFacadeWorld(null, w, { holdWiring: hold });
    const early = await f.facade.getAll();
    assert.deepEqual(Object.keys(early.cards), [C1], "the signed-out cards, at once");
    release();
    await settle();
  });

  test("switching accounts: nothing of A is shown or sent under B; A's unsent work waits for A", async () => {
    const f = reviewFacadeWorld(A);
    await practise(f.facade, f.w.clock.now);
    f.w.server.behaviour = "network";
    await f.w.clock.advance(1000);
    await f.switchTo(B);
    assert.deepEqual((await f.facade.getAll()).cards, {}, "B sees none of A's cards");
    assert.equal(f.w.storage.getItem(reviewCacheKey(A)), null, "A's synced copy is gone from this browser");
    assert.ok(f.w.storage.getItem(reviewOutboxKey(A)), "A's unsent outbox stays, for A only");
    f.w.server.behaviour = "ok";
    await f.w.clock.advance(60_000);
    assert.equal(f.w.server.of(B).size, 0);
    await f.switchTo(A);
    await f.w.clock.advance(1000);
    assert.equal(f.w.server.of(A).size, 2, "sent when A signs in again");
  });

  test("sign-out: the local store answers again; the synced copy is removed", async () => {
    const f = reviewFacadeWorld(A);
    await practise(f.facade, f.w.clock.now);
    await f.w.clock.advance(1000);
    await f.switchTo(null);
    assert.deepEqual((await f.facade.getAll()).cards, {});
    assert.equal([...f.w.storage.map.keys()].filter((k) => k.startsWith("parlons-review-v1:u:")).length, 0);
  });

  test("an expired session: early reads don't show the account; a 'signed-out' reply checked with the auth server is a sign-out", async () => {
    const f = reviewFacadeWorld(A);
    await practise(f.facade, f.w.clock.now);
    await f.w.clock.advance(1000);
    // Reload with the cookie expired: the hinted account isn't trusted.
    f.w.cookieUser = null;
    const reload = reviewFacadeWorld(A, f.w, { holdWiring: new Promise(() => {}) });
    f.w.cookieUser = null;
    assert.deepEqual((await reload.facade.getAll()).cards, {}, "nothing of A without a valid session");
    // The server says signed-out and the auth server agrees.
    f.w.server.sessionUser = null;
    f.setVerify(async () => null);
    await f.facade.addCards([C3], f.w.clock.now);
    await f.w.clock.advance(1000);
    await settle();
    assert.equal(f.w.storage.getItem(reviewCacheKey(A)), null, "handled as a sign-out");
    assert.ok(f.w.storage.getItem(reviewOutboxKey(A)), "the unsent card waits for A");
  });

  test("a wrong-user reply stops sending and follows the browser's session", async () => {
    const f = reviewFacadeWorld(A);
    await f.facade.addCards([C1], f.w.clock.now);
    f.w.server.sessionUser = B; // the cookie changed under us
    await f.w.clock.advance(1000);
    assert.equal(f.w.server.of(B).size, 0);
    assert.equal(f.w.server.of(A).size, 0);
  });
});

describe("import and the shared claim", () => {
  test("signed-out cards go to the account owning the progress import claim, once; others never get them", async () => {
    const w = reviewWorld();
    await new LocalReviewStore(() => null, () => w.storage).addCards([C1, C2], w.clock.now);
    const f = reviewFacadeWorld(A, w);
    await f.facade.getAll();
    await f.w.clock.advance(1000);
    assert.equal(w.storage.getItem(IMPORT_OWNER_KEY), A, "the same claim key as progress");
    assert.deepEqual([...w.server.of(A).keys()].sort(), [C1, C2].sort());
    await f.switchTo(B);
    await f.w.clock.advance(1000);
    assert.equal(w.server.of(B).size, 0, "B never gets this browser's signed-out cards");
    assert.ok(parseReviewData(w.storage.getItem(REVIEW_KEY), null).cards[C1], "the signed-out cards stay");
  });

  test("a claim progress already made is reused, never a second one", async () => {
    const w = reviewWorld();
    w.storage.setItem(IMPORT_OWNER_KEY, B);
    await new LocalReviewStore(() => null, () => w.storage).addCards([C1], w.clock.now);
    const a = reviewStoreFor(w, A);
    assert.equal(await a.importAnonymous(), 0);
    assert.equal(w.storage.getItem(IMPORT_OWNER_KEY), B);
    const b = reviewStoreFor(w, B);
    assert.equal(await b.importAnonymous(), 1);
    assert.equal([...w.storage.map.keys()].filter((k) => /owner|claim/.test(k)).length, 1);
  });

  test("an interrupted import resumes from the outbox and is never sent twice; later changes are imported", async () => {
    const w = reviewWorld();
    const signedOut = new LocalReviewStore(() => null, () => w.storage);
    await signedOut.addCards([C1, C2], w.clock.now);
    w.server.behaviour = "network";
    const s = reviewStoreFor(w);
    assert.equal(await s.importAnonymous(), 2);
    await w.clock.advance(1000);
    assert.ok(w.storage.getItem(REVIEW_IMPORTED_MARKER_KEY));
    // The tab closes; a new page load imports nothing new and sends what was queued.
    w.server.behaviour = "ok";
    const again = reviewStoreFor(w);
    assert.equal(await again.importAnonymous(), 0);
    await again.flush();
    const sent = w.server.sentKeys().filter((_, i) => i >= 2); // after the failed call
    assert.deepEqual(sent.sort(), [C1, C2].map(cardKey).sort());
    assert.equal(await again.importAnonymous(), 0);
    // A newer signed-out answer is imported.
    w.clock.now += 5000;
    await signedOut.recordAnswer(C1, "knew", w.clock.now, CAL);
    assert.equal(await again.importAnonymous(), 1);
  });

  test("an account's own local cards always go to it, whatever the claim says, and its local key goes", async () => {
    const w = reviewWorld();
    w.storage.setItem(IMPORT_OWNER_KEY, B);
    w.cookieUser = A;
    await practise(new LocalReviewStore(() => w.cookieUser, () => w.storage), w.clock.now);
    const s = reviewStoreFor(w, A);
    assert.equal(await s.importLocal(), 2);
    assert.equal(w.storage.getItem(reviewLocalKey(A)), null);
    await s.flush();
    assert.equal(w.server.of(A).get(C1)?.box, 1);
    assert.equal((await s.getAll()).today?.newIds.length, 1, "the day's log comes too");
  });
});

describe("the flag, both ways", () => {
  test("off → on: answers made signed in with sync off reach the account when it's switched on", async () => {
    const w = reviewWorld();
    w.cookieUser = A;
    const off = createLocalStoreFor(w);
    await practise(off, w.clock.now);
    const f = reviewFacadeWorld(A, w);
    await f.facade.getAll();
    await f.w.clock.advance(1000);
    assert.equal(w.server.of(A).get(C1)?.box, 1);
    assert.equal((await f.facade.getAll()).cards[C1].box, 1);
  });

  test("on → off: cards answered with sync on still show, to that account only", async () => {
    const f = reviewFacadeWorld(A);
    await practise(f.facade, f.w.clock.now);
    f.w.server.behaviour = "network";
    await f.facade.recordAnswer(C2, "not-yet", f.w.clock.now + 2000, CAL); // unsent
    const off = createLocalStoreFor(f.w);
    const seen = await off.getAll();
    assert.equal(seen.cards[C1].box, 1, "from the synced copy");
    assert.equal(seen.cards[C2].box, 1, "from the unsent outbox");
    f.w.cookieUser = B;
    assert.deepEqual((await off.getAll()).cards, {}, "another account sees none of it");
    f.w.cookieUser = null;
    assert.deepEqual((await off.getAll()).cards, {}, "nor does a signed-out visitor");
  });

  test("anything but 'on', or no Supabase config: the browser-only store, no wiring loaded, no fetch", async () => {
    let loads = 0;
    let fetches = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetches++;
      throw new Error("no network allowed");
    }) as typeof fetch;
    try {
      for (const [flag, configured] of [[undefined, true], ["off", true], ["true", true], ["ON", true], ["on", false]] as const) {
        const store = createReviewStore({ flag, supabaseConfigured: configured, loadWiring: async () => (loads++, {} as never) });
        assert.ok(store instanceof LocalReviewStore, `flag ${flag}, configured ${configured}`);
        await store.getAll();
      }
      assert.ok(createReviewStore({ flag: "on", supabaseConfigured: true, loadWiring: async () => ({}) as never }) instanceof ReviewSyncFacade);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(loads, 0);
    assert.equal(fetches, 0);
  });

  test("sync on but signed out: the same data as the browser-only store, nothing sent, no synced keys", async () => {
    const f = reviewFacadeWorld(null);
    await practise(f.facade, f.w.clock.now);
    const viaFacade = f.w.storage.getItem(REVIEW_KEY);
    const w2 = reviewWorld();
    await practise(new LocalReviewStore(() => null, () => w2.storage), w2.clock.now);
    assert.equal(viaFacade, w2.storage.getItem(REVIEW_KEY));
    assert.equal(f.w.server.calls.length + f.w.server.gets, 0);
    assert.deepEqual([...f.w.storage.map.keys()], [REVIEW_KEY]);
  });

  test("lib/review.ts with no flag in the environment exports the browser-only store", async () => {
    assert.equal(process.env.NEXT_PUBLIC_REVIEW_SYNC, undefined);
    const { reviewStore } = await import("./review.ts");
    assert.ok(reviewStore instanceof LocalReviewStore);
  });

  test("the synced store's types line up with the progress wiring's auth", () => {
    const auth: Wiring["auth"] = { getUserId: async () => null, verifyUserId: async () => null, onChange: () => {} };
    assert.ok(new SupabaseReviewStore(A, { sync: async () => ({}), get: async () => ({}), reset: async () => ({}) }, reviewWorld().env) && auth);
  });
});

function createLocalStoreFor(w: ReturnType<typeof reviewWorld>) {
  return new LocalReviewStore(() => w.cookieUser, () => w.storage);
}
