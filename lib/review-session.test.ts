// The /review page logic: today's counts, the /progress line, the empty state, the provisional
// session (paid cards only with access), the view and its keys, and the summary.
// Run: npm run test:review
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ReviewIdIndex } from "./review-catalogue.ts";
import { answer, buildSession, calendarFor, deckIndex, logAnswer, newCard, type CardState } from "./review-scheduler.ts";
import { dueLine, formatDay, gradeCard, keyAction, nextDueDay, progressLabel, provisionalSession, reveal, startView, summaryOf, todayCounts, type View } from "./review-session.ts";

const CAL = calendarFor("Europe/Paris");
const NOW = Date.parse("2026-11-26T10:00:00Z");
const n3 = (i: number) => `v${String(i).padStart(3, "0")}`;
const IDX = deckIndex({
  lessons: {
    "a1-x": { level: "A1", cards: Array.from({ length: 15 }, (_, i) => n3(i + 1)) },
    "b1-z": { level: "B1", cards: Array.from({ length: 5 }, (_, i) => n3(i + 1)) },
  },
} as ReviewIdIndex);
const due = (box = 2): CardState => ({ box, dueAt: "2026-11-25T00:00:00.000Z", lastReviewedAt: "2026-11-20T10:00:00.000Z", reviews: 2, lapses: 0 });

describe("today's counts and the /progress line", () => {
  test("due reviews and new cards left, within the limits, counting cards practised lessons will add", () => {
    const cards: Record<string, CardState> = { "a1-x-v001": due(), "a1-x-v002": due(), "a1-x-v003": newCard(NOW), "b1-z-v001": due() };
    const c = todayCounts({ index: IDX, cards, practised: new Set(["a1-x"]), hasAccess: false, nowMs: NOW, cal: CAL, log: undefined });
    assert.deepEqual(c, { due: 2, newLeft: 10, total: 12 }, "the paid card isn't counted without access; 13 new capped at 10");
    const withAccess = todayCounts({ index: IDX, cards, practised: new Set(["a1-x", "b1-z"]), hasAccess: true, nowMs: NOW, cal: CAL, log: { day: "2026-11-26", newIds: ["a", "b", "c", "d", "e", "f", "g", "h"], reviewIds: [] } });
    assert.deepEqual(withAccess, { due: 3, newLeft: 2, total: 5 });
    assert.equal(dueLine(c, new Set(["a1-x"])), "12 cards due today");
    assert.equal(dueLine({ due: 1, newLeft: 0, total: 1 }, new Set(["a1-x"])), "1 card due today");
    assert.equal(dueLine({ due: 0, newLeft: 0, total: 0 }, new Set(["a1-x"])), "No cards due today");
    assert.equal(dueLine({ due: 0, newLeft: 0, total: 0 }, new Set()), null, "nothing before any lesson is practised");
  });
});

describe("the session", () => {
  test("empty state with nothing practised; 'done' with a deck but nothing today", () => {
    assert.deepEqual(startView([], false), { kind: "empty" });
    assert.deepEqual(startView([], true), { kind: "done" });
  });

  test("the provisional batch includes paid additions; without access the page rebuilds it from stored cards only", () => {
    const p = provisionalSession({ index: IDX, cards: {}, practised: new Set(["b1-z", "a1-x"]), nowMs: NOW, cal: CAL, log: undefined });
    assert.equal(p.ids.length, 10);
    assert.deepEqual(p.paidAdditions, ["b1-z-v001", "b1-z-v002", "b1-z-v003", "b1-z-v004", "b1-z-v005"]);
    // No access: only the free additions were stored; a stored paid card (after a refund) stays out.
    const stored: Record<string, CardState> = { "b1-z-v001": due() };
    for (const id of p.ids.filter((x) => x.startsWith("a1-"))) stored[id] = newCard(NOW);
    const ids = buildSession({ index: IDX, cards: stored, hasAccess: false, nowMs: NOW, cal: CAL, log: undefined });
    assert.ok(ids.length > 0 && ids.every((id) => id.startsWith("a1-")));
  });

  test("reveal, grade, a Not yet repeat at the end, the progress label and the summary", () => {
    let v: View = startView(["a", "b"], true);
    assert.deepEqual(progressLabel(v), { text: "1 / 2", spoken: "Card 1 of 2" });
    assert.deepEqual(gradeCard(v, "knew"), { view: v, record: null }, "no grade before the answer is shown");
    v = reveal(v);
    let r = gradeCard(v, "not-yet");
    assert.equal(r.record, "a");
    v = reveal(r.view);
    r = gradeCard(v, "knew");
    assert.equal(r.record, "b");
    assert.deepEqual(progressLabel(r.view), { text: "3 / 3", spoken: "Card 3 of 3" }, "the repeat is added to the total");
    r = gradeCard(reveal(r.view), "knew");
    assert.equal(r.record, null, "the repeat is practice only");
    assert.equal(r.view.kind, "summary");
    assert.deepEqual(r.view.kind === "summary" && summaryOf(r.view.results), { reviewed: 2, known: 1 });
  });

  test("keys: Space or Enter reveal; then 1 is Not yet and 2 is I knew it; nothing else", () => {
    const front = startView(["a"], true);
    const back = reveal(front);
    assert.equal(keyAction(" ", front), "reveal");
    assert.equal(keyAction("Enter", front), "reveal");
    assert.equal(keyAction("1", front), null);
    assert.equal(keyAction("1", back), "not-yet");
    assert.equal(keyAction("2", back), "knew");
    assert.equal(keyAction(" ", back), null);
    assert.equal(keyAction("2", { kind: "loading" }), null);
  });

  test("the next due day, after answers", () => {
    let cards: Record<string, CardState> = { "a1-x-v001": newCard(NOW), "b1-z-v001": { ...due(), dueAt: "2026-11-27T23:00:00.000Z" } };
    cards = { ...cards, "a1-x-v001": answer(cards["a1-x-v001"], "knew", NOW, CAL) };
    assert.equal(nextDueDay(IDX, cards, false, NOW, CAL), "2026-11-27");
    assert.equal(formatDay("2026-11-27", NOW, CAL), "tomorrow");
    assert.equal(formatDay("2026-11-30", NOW, CAL), "Mon 30 Nov");
    assert.equal(nextDueDay(IDX, {}, true, NOW, CAL), null);
    void logAnswer;
  });
});
