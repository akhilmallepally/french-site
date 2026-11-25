// The local review store: per-user keys, no card text, legacy and broken states, and its size.
// Run: npm run test:review
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { A, B, FakeStorage } from "./progress-test-fakes.ts";
import { STORAGE_KEY } from "./progress-core.ts";
import { calendarFor, type CardState } from "./review-scheduler.ts";
import { LocalReviewStore, parseReviewData, REVIEW_KEY, reviewLocalKey, serializeReviewData } from "./review-store.ts";

const CAL = calendarFor("Europe/Paris");
const NOW = Date.parse("2026-11-26T10:00:00Z");
const C1 = "a1-greetings-v001";
const C2 = "a1-greetings-v002";

function setup(user: string | null = null) {
  const storage = new FakeStorage();
  const who = { user };
  const store = new LocalReviewStore(() => who.user, () => storage);
  return { storage, who, store };
}

describe("local review store", () => {
  test("signed out: cards under the signed-out key", async () => {
    const { storage, store } = setup();
    await store.addCards([C1, C2], NOW);
    assert.deepEqual(Object.keys((await store.getAll()).cards), [C1, C2]);
    const after = await store.recordAnswer(C1, "knew", NOW + 1000, CAL);
    assert.equal(after?.box, 1);
    assert.deepEqual([...storage.map.keys()], [REVIEW_KEY]);
    assert.deepEqual((await store.getAll()).today, { day: "2026-11-26", newIds: [C1], reviewIds: [] });
    assert.equal(await store.recordAnswer("a1-greetings-v099", "knew", NOW, CAL), null, "a card not in the deck");
  });

  test("signed in: writes go to the account's own key; reads add the signed-out cards; others never see them", async () => {
    const { storage, who, store } = setup();
    await store.addCards([C1], NOW);
    who.user = A;
    await store.addCards([C1, C2], NOW);
    await store.recordAnswer(C1, "knew", NOW + 1000, CAL);
    assert.deepEqual(Object.keys(parseReviewData(storage.getItem(reviewLocalKey(A)), A).cards).sort(), [C1, C2], "the answer and the new card under A");
    assert.equal(parseReviewData(storage.getItem(REVIEW_KEY), null).cards[C1].box, 0, "the signed-out copy is untouched");
    assert.equal((await store.getAll()).cards[C1].box, 1, "A sees the newer state");
    who.user = B;
    assert.deepEqual(Object.keys((await store.getAll()).cards), [C1], "B sees only the signed-out cards, not A's");
    who.user = null;
    assert.deepEqual(Object.keys((await store.getAll()).cards), [C1], "signed out again: A's cards are hidden");
    // A's key copied under B's name is refused (the owner is inside the value).
    storage.setItem(reviewLocalKey(B), storage.getItem(reviewLocalKey(A))!);
    assert.deepEqual(parseReviewData(storage.getItem(reviewLocalKey(B)), B).cards, {});
  });

  test("never stores card text", async () => {
    const { storage, store } = setup();
    await store.addCards([C1], NOW);
    await store.recordAnswer(C1, "not-yet", NOW, CAL);
    const free = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", "review-cards-free.json"), "utf8")).cards;
    const c = free.find((x: { id: string }) => x.id === C1);
    const saved = storage.getItem(REVIEW_KEY)!;
    assert.ok(!saved.includes(c.fr) && !saved.includes(c.en) && !saved.includes(c.pron));
    assert.match(saved, /^\{"v":1,"lessons":\{"a1-greetings":\{"v001":\[1,\d+,\d+,1,0\]\}\},"today":/);
  });

  test("legacy, empty and broken states load cleanly", async () => {
    for (const text of [null, "", "not json", "null", "[]", '{"v":2,"lessons":{}}', '{"v":1}', '{"v":1,"lessons":[]}', '{"v":1,"userId":"x","lessons":{}}']) {
      assert.deepEqual(parseReviewData(text, null), { cards: {} }, String(text));
    }
    const mixed = JSON.stringify({
      v: 1,
      lessons: {
        "a1-x": { v001: [1, NOW, NOW - 1, 1, 0], v002: [9, NOW, NOW, 1, 0], v003: [0, NOW, 5, 0, 0], v004: [2, NOW, NOW, 1, 2], v005: "x", bad: [1, NOW, NOW, 1, 0] },
        "Bad Lesson": { v001: [1, NOW, NOW, 1, 0] },
      },
      today: { day: "2026-11-26", newIds: ["a1-x-v001", 3], reviewIds: "x" },
    });
    assert.deepEqual(parseReviewData(mixed, null), {
      cards: { "a1-x-v001": { box: 1, dueAt: new Date(NOW).toISOString(), lastReviewedAt: new Date(NOW - 1).toISOString(), reviews: 1, lapses: 0 } },
      today: { day: "2026-11-26", newIds: ["a1-x-v001"], reviewIds: [] },
    }, "bad entries are dropped one by one");
    // Storage that throws, or none at all.
    const throwing = new LocalReviewStore(() => null, () => { throw new Error("blocked"); });
    assert.deepEqual(await throwing.getAll(), { cards: {} });
    await throwing.addCards([C1], NOW);
    const full = new FakeStorage();
    full.onSet = () => { throw new Error("QuotaExceededError"); };
    const store = new LocalReviewStore(() => null, () => full);
    await store.addCards([C1], NOW);
    assert.deepEqual(await store.getAll(), { cards: {} }, "a full storage just doesn't save");
  });

  test("round-trips exactly, and the size with every card", () => {
    const index = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", "review-card-ids.json"), "utf8"));
    const ids = Object.entries(index.lessons as Record<string, { cards: string[] }>).flatMap(([lesson, l]) => l.cards.map((s) => `${lesson}-${s}`));
    assert.equal(ids.length, 4817);
    const cards: Record<string, CardState> = {};
    for (const id of ids) cards[id] = { box: 5, dueAt: "2027-01-01T23:00:00.000Z", lastReviewedAt: "2026-11-26T10:00:00.123Z", reviews: 123, lapses: 12 };
    const data = { cards, today: { day: "2026-11-26", newIds: ids.slice(0, 10), reviewIds: ids.slice(10, 70) } };
    const text = serializeReviewData(data, A);
    assert.deepEqual(parseReviewData(text, A), data);
    assert.equal(serializeReviewData(parseReviewData(text, A), A), text);
    console.log(`  review store, every card (worst case): ${text.length} characters (${(text.length / 1024).toFixed(0)} KiB)`);
    assert.ok(text.length < 300 * 1024, "well inside a 5 MB localStorage quota");
    assert.notEqual(REVIEW_KEY as string, STORAGE_KEY as string, "its own key, never the progress key");
  });
});
