// The review scheduler: box moves, lapses, intervals, local days and time zones, daily limits,
// sessions, access, the deck, and the merge rules against apply_review (0008).
// Run: npm run test:review
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { ProgressData } from "./progress-core.ts";
import type { ReviewIdIndex } from "./review-catalogue.ts";
import {
  addDays,
  answer,
  applyReview,
  buildSession,
  calendarFor,
  cardAllowed,
  currentCard,
  deckAdditions,
  deckIndex,
  INTERVAL_DAYS,
  isDue,
  logAnswer,
  logDrawn,
  logFor,
  MAX_AHEAD_MS,
  mergeCards,
  mergeReview,
  newCard,
  nextInSession,
  practisedLessons,
  startSession,
  type CardState,
  type DailyLog,
} from "./review-scheduler.ts";

const PARIS = calendarFor("Europe/Paris");
const UTC = calendarFor("UTC");
const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

const card = (box: number, dueAt: string, lastReviewedAt: string | null, reviews = box ? 1 : 0, lapses = 0): CardState =>
  ({ box, dueAt, lastReviewedAt, reviews, lapses });

// A small index: two free lessons and one paid lesson, 20 cards each, plus a paid card a free lesson joined.
const SMALL: ReviewIdIndex = {
  lessons: {
    "a1-x": { level: "A1", cards: Array.from({ length: 20 }, (_, i) => `v${String(i + 1).padStart(3, "0")}`) },
    "a2-y": { level: "A2", cards: Array.from({ length: 20 }, (_, i) => `v${String(i + 1).padStart(3, "0")}`), joins: ["b1-z-v001"] },
    "b1-z": { level: "B1", cards: Array.from({ length: 20 }, (_, i) => `v${String(i + 1).padStart(3, "0")}`) },
  },
};
const IDX = deckIndex(SMALL);
const id = (lesson: string, n: number) => `${lesson}-v${String(n).padStart(3, "0")}`;

describe("local days", () => {
  test("dayOf and startOfDay follow the time zone, daylight saving included", () => {
    assert.equal(PARIS.dayOf(at("2026-11-26T22:59:59Z")), "2026-11-26");
    assert.equal(PARIS.dayOf(at("2026-11-26T23:00:00Z")), "2026-11-27");
    assert.equal(iso(PARIS.startOfDay("2026-11-27")), "2026-11-26T23:00:00.000Z");
    assert.equal(iso(PARIS.startOfDay("2026-07-01")), "2026-06-30T22:00:00.000Z");
    assert.equal(iso(PARIS.startOfDay("2026-03-29")), "2026-03-28T23:00:00.000Z", "the day clocks go forward");
    assert.equal(iso(PARIS.startOfDay("2026-03-30")), "2026-03-29T22:00:00.000Z");
    assert.equal(iso(calendarFor("Asia/Kolkata").startOfDay("2026-11-27")), "2026-11-26T18:30:00.000Z");
    assert.equal(iso(calendarFor("Pacific/Kiritimati").startOfDay("2026-11-27")), "2026-11-26T10:00:00.000Z");
    assert.equal(iso(calendarFor("America/Los_Angeles").startOfDay("2026-11-01")), "2026-11-01T07:00:00.000Z", "the day clocks go back");
    // Chile skips midnight when daylight saving starts: the day begins at 01:00.
    const santiago = calendarFor("America/Santiago");
    const start = santiago.startOfDay("2026-09-06");
    assert.equal(santiago.dayOf(start), "2026-09-06");
    assert.equal(santiago.dayOf(start - 1000), "2026-09-05");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  });

  test("due means dueAt on or before the end of today, in the learner's zone", () => {
    const c = card(1, "2026-11-26T23:00:00.000Z", "2026-11-25T10:00:00.000Z"); // midnight 27 Nov in Paris
    assert.equal(isDue(c, PARIS.dayOf(at("2026-11-26T22:59:59Z")), PARIS), false, "23:59:59 on the 26th in Paris");
    assert.equal(isDue(c, PARIS.dayOf(at("2026-11-26T23:00:00Z")), PARIS), true, "00:00 on the 27th in Paris");
    assert.equal(isDue(c, UTC.dayOf(at("2026-11-26T23:30:00Z")), UTC), true, "in UTC that instant is already the 26th");
    assert.equal(isDue(card(0, "2026-01-01T00:00:00.000Z", null), "2026-11-26", PARIS), false, "new cards aren't due cards");
  });
});

describe("answers", () => {
  const now = at("2026-11-26T21:30:00Z"); // 22:30 in Paris

  test("I knew it: up one box, at most 5; the due date is the start of the local day after the interval", () => {
    let s = newCard(now);
    const boxes: number[] = [];
    for (let i = 0; i < 6; i++) {
      s = answer(s, "knew", now, PARIS);
      boxes.push(s.box);
      assert.equal(s.dueAt, iso(PARIS.startOfDay(addDays("2026-11-26", INTERVAL_DAYS[s.box]))));
    }
    assert.deepEqual(boxes, [1, 2, 3, 4, 5, 5]);
    assert.equal(s.reviews, 6);
    assert.equal(s.lapses, 0);
    assert.equal(answer(newCard(now), "knew", now, PARIS).dueAt, "2026-11-26T23:00:00.000Z", "box 1: tomorrow, from midnight");
    assert.deepEqual([...INTERVAL_DAYS], [0, 1, 3, 7, 16, 35]);
  });

  test("Not yet: back to box 1 and a lapse, except on a new card's first answer", () => {
    const first = answer(newCard(now), "not-yet", now, PARIS);
    assert.deepEqual([first.box, first.reviews, first.lapses], [1, 1, 0]);
    const lapsed = answer(card(4, "2026-11-26T00:00:00.000Z", "2026-11-10T10:00:00.000Z", 4, 0), "not-yet", now, PARIS);
    assert.deepEqual([lapsed.box, lapsed.reviews, lapsed.lapses], [1, 5, 1]);
    assert.equal(lapsed.lastReviewedAt, iso(now));
  });

  test("interval days are calendar days, across a daylight-saving change", () => {
    const sat = at("2026-03-28T22:30:00Z"); // 23:30 on Saturday 28 March in Paris
    assert.equal(answer(newCard(sat), "knew", sat, PARIS).dueAt, "2026-03-28T23:00:00.000Z", "due from Sunday's midnight, not Monday's");
  });

  test("times never go more than 24 hours ahead; a clock that went back still gives a later review", () => {
    const ahead = card(2, "2026-11-28T00:00:00.000Z", iso(now + 2 * 3600_000), 2);
    const s = answer(ahead, "knew", now, PARIS);
    assert.equal(s.lastReviewedAt, iso(now + 2 * 3600_000 + 1), "1 ms after the stored review, so it wins the merge");
    const tooFar = card(2, "2026-11-28T00:00:00.000Z", iso(now + 2 * MAX_AHEAD_MS), 2);
    assert.equal(answer(tooFar, "knew", now, PARIS).lastReviewedAt, iso(now), "never past now + 24 h");
    const fromBox5 = answer(card(5, "2026-11-26T00:00:00.000Z", "2026-10-01T00:00:00.000Z", 5), "knew", now, PARIS);
    assert.ok(Date.parse(fromBox5.dueAt) - now < 400 * 24 * 3600_000, "within 0008's 400-day limit");
    assert.ok(Date.parse(newCard(now).dueAt) <= now + MAX_AHEAD_MS, "a new card's dueAt is within 0008's 24 h for box 0");
  });
});

describe("sessions and daily limits", () => {
  const now = at("2026-11-26T10:00:00Z");
  const today = PARIS.dayOf(now);
  const dueDay = (n: number) => iso(at("2026-11-01T00:00:00Z") + n * 3600_000); // older first for smaller n
  const deck = (due: number, fresh: number, lesson = "a1-x", lesson2 = "a2-y") => {
    const cards: Record<string, CardState> = {};
    for (let i = 1; i <= due; i++) cards[id(i <= 20 ? lesson : lesson2, ((i - 1) % 20) + 1)] = card(2, dueDay(100 - i), "2026-10-20T00:00:00.000Z");
    for (let i = 1; i <= fresh; i++) cards[id("b1-z", i)] = card(0, iso(now), null);
    return cards;
  };

  test("due cards first, oldest due first, then new cards in course order, 20 at most", () => {
    const cards = deck(5, 20);
    const s = buildSession({ index: IDX, cards, hasAccess: true, nowMs: now, cal: PARIS, log: undefined });
    assert.deepEqual(s.slice(0, 5), [5, 4, 3, 2, 1].map((n) => id("a1-x", n)), "oldest due first");
    assert.deepEqual(s.slice(5), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => id("b1-z", n)), "then 10 new cards, the daily limit");
    assert.equal(s.length, 15);
    // Equal due times: course order.
    const tie = { [id("a2-y", 1)]: card(1, dueDay(1), "2026-10-20T00:00:00.000Z"), [id("a1-x", 7)]: card(1, dueDay(1), "2026-10-20T00:00:00.000Z") };
    assert.deepEqual(buildSession({ index: IDX, cards: tie, hasAccess: true, nowMs: now, cal: PARIS, log: undefined }), [id("a1-x", 7), id("a2-y", 1)]);
  });

  test("Do another 20, within 60 reviews and 10 new cards a day", () => {
    const cards = deck(40, 20);
    let log: DailyLog | undefined;
    const seen: string[] = [];
    const sizes: number[] = [];
    for (let round = 0; round < 5; round++) {
      const batch = buildSession({ index: IDX, cards, hasAccess: true, nowMs: now, cal: PARIS, log, exclude: seen });
      sizes.push(batch.length);
      if (!batch.length) break;
      for (const c of batch) {
        log = logAnswer(log, today, c, cards[c].box === 0);
        cards[c] = answer(cards[c], "knew", now, PARIS);
      }
      seen.push(...batch);
    }
    assert.deepEqual(sizes, [20, 20, 10, 0], "40 due, then 10 new, then nothing");
    assert.deepEqual([log!.reviewIds.length, log!.newIds.length], [40, 10]);
  });

  test("60 reviews a day at most, counting only cards answered that local day", () => {
    const cards: Record<string, CardState> = {};
    for (const lesson of ["a1-x", "a2-y", "b1-z"]) for (let i = 1; i <= 20; i++) cards[id(lesson, i)] = card(3, dueDay(i), "2026-10-01T00:00:00.000Z");
    const log: DailyLog = { day: today, newIds: [], reviewIds: Array.from({ length: 50 }, (_, i) => `done-${i}`) };
    assert.equal(buildSession({ index: IDX, cards, hasAccess: true, nowMs: now, cal: PARIS, log }).length, 10, "50 answered today: 10 more");
    const yesterday = { ...log, day: addDays(today, -1) };
    assert.equal(buildSession({ index: IDX, cards, hasAccess: true, nowMs: now, cal: PARIS, log: yesterday }).length, 20, "yesterday's count doesn't apply");
    const first = buildSession({ index: IDX, cards, hasAccess: true, nowMs: now, cal: PARIS, log: undefined, size: 50 });
    assert.equal(first.length, 50);
    const next = buildSession({ index: IDX, cards, hasAccess: true, nowMs: now, cal: PARIS, log: undefined, exclude: first });
    assert.equal(next.length, 10, "the 50 drawn but unanswered don't count: the other 10 cards come next");
  });

  test("drawn but unanswered cards don't count, and a reopened /review offers them first", () => {
    const cards = deck(0, 20); // 20 new paid-level cards, with access
    const s1 = buildSession({ index: IDX, cards, hasAccess: true, nowMs: now, cal: PARIS, log: undefined });
    assert.equal(s1.length, 10, "10 new a day");
    // Two answered, then the page is closed; a new card was added earlier in course order meanwhile.
    let log = logDrawn(undefined, today, s1);
    for (const c of s1.slice(0, 2)) {
      log = logAnswer(log, today, c, true);
      cards[c] = answer(cards[c], "knew", now, PARIS);
    }
    cards[id("a1-x", 1)] = card(0, iso(now), null);
    const reopened = buildSession({ index: IDX, cards, hasAccess: true, nowMs: now, cal: PARIS, log });
    assert.deepEqual(reopened, s1.slice(2), "the 8 unanswered first, in their order, filling today's 8 remaining new cards");
    assert.deepEqual(log.drawn, s1);
    assert.equal(logFor(log, addDays(today, 1)).drawn, undefined, "a new day starts a new list");
  });

  test("without access, paid cards never appear, even when their state exists", () => {
    const cards = deck(0, 5);
    cards[id("b1-z", 20)] = card(2, dueDay(1), "2026-10-20T00:00:00.000Z");
    cards[id("a1-x", 1)] = card(0, iso(now), null);
    cards["c2-gone-v001"] = card(2, dueDay(1), "2026-10-20T00:00:00.000Z"); // not in the index (removed content)
    assert.deepEqual(buildSession({ index: IDX, cards, hasAccess: false, nowMs: now, cal: PARIS, log: undefined }), [id("a1-x", 1)]);
    assert.equal(buildSession({ index: IDX, cards, hasAccess: true, nowMs: now, cal: PARIS, log: undefined }).length, 7);
    assert.equal(cardAllowed(IDX, id("b1-z", 1), false), false);
    assert.equal(cardAllowed(IDX, id("a2-y", 1), false), true);
    assert.equal(cardAllowed(IDX, "c2-gone-v001", true), false);
  });

  test("Not yet brings a card back once at the end; the repeat doesn't change its schedule", () => {
    let s = startSession(["a", "b", "c"]);
    const shown: string[] = [];
    const scheduled: boolean[] = [];
    const grades = { a: ["not-yet", "not-yet"], b: ["knew"], c: ["not-yet", "knew"] } as Record<string, ("knew" | "not-yet")[]>;
    while (currentCard(s) !== null) {
      const c = currentCard(s)!;
      shown.push(c);
      const r = nextInSession(s, grades[c].shift()!);
      scheduled.push(r.schedule);
      s = r.session;
    }
    assert.deepEqual(shown, ["a", "b", "c", "a", "c"], "each Not yet card comes back once, a second Not yet doesn't requeue");
    assert.deepEqual(scheduled, [true, true, true, false, false]);
  });
});

describe("the deck", () => {
  const progress: ProgressData = {
    exercises: { "a2-y-ex003": { attempts: 1, correct: 0, lastResult: "incorrect", lastAttemptedAt: "2026-11-25T10:00:00.000Z" } },
    lessons: { "a1-x": { bestScore: 3, bestTotal: 5, lastCompletedAt: "2026-11-25T10:00:00.000Z" } },
  };

  test("practised lessons add their cards (box 0), joined cards included, paid ones only with access", () => {
    assert.deepEqual([...practisedLessons(progress)].sort(), ["a1-x", "a2-y"]);
    const free = deckAdditions(IDX, {}, practisedLessons(progress), false);
    assert.equal(free.length, 40);
    assert.ok(!free.includes("b1-z-v001"), "a joined paid card needs access");
    const all = deckAdditions(IDX, { [id("a1-x", 1)]: card(3, "2026-12-01T00:00:00.000Z", "2026-11-20T00:00:00.000Z") }, practisedLessons(progress), true);
    assert.equal(all.length, 40, "a card already in the deck isn't added again; the joined paid card is");
    assert.equal(all.at(-1), "b1-z-v001", "course order");
    assert.deepEqual(deckAdditions(IDX, {}, new Set(["b1-z"]), false), [], "a paid lesson adds nothing without access");
    assert.deepEqual(deckAdditions(IDX, {}, new Set(["nowhere"]), true), []);
  });

  test("the real id index lists the catalogue's 4,817 cards in course order", () => {
    const real = deckIndex(JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", "review-card-ids.json"), "utf8")));
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", f), "utf8")).cards.map((c: { id: string }) => c.id);
    assert.deepEqual(real.order, [...read("review-cards-free.json"), ...read("review-cards-paid.json")]);
  });
});

describe("merging (apply_review, 0008)", () => {
  const t = (h: number) => iso(at("2026-11-26T12:00:00Z") + h * 3600_000);

  test("applyReview follows the cases in supabase/tests/rls.sql", () => {
    const first = card(1, t(24), t(-1), 1);
    assert.deepEqual(applyReview(undefined, card(0, t(0), null)), card(0, t(0), null), "a new card is stored as sent");
    assert.deepEqual(applyReview(card(0, t(0), null), first), first, "the first review wins over box 0");
    assert.deepEqual(applyReview(first, first), first, "a resend changes nothing");
    assert.deepEqual(applyReview(first, card(3, t(7 * 24), t(-2), 5, 1)), card(1, t(24), t(-1), 5, 1), "an older state: the later state stays, counts take the max");
    assert.deepEqual(applyReview(first, card(4, t(16 * 24), t(-1), 1)), first, "a tie keeps the stored state");
    assert.deepEqual(applyReview(first, card(0, t(0), null)), first, "an unreviewed entry against a reviewed card keeps it");
    assert.deepEqual(applyReview(first, card(2, t(72), t(-0.5), 6, 1)), card(2, t(72), t(-0.5), 6, 1), "a newer review wins whole");
  });

  // Every combination of a few values, to check the laws exhaustively on a small space.
  const states: CardState[] = [];
  for (const last of [null, t(-2), t(-1)]) {
    for (const box of last === null ? [0] : [1, 3]) {
      for (const due of [t(1), t(30)]) for (const [r, l] of [[2, 0], [3, 1]]) states.push(card(box, due, last, last === null ? 0 : r, last === null ? 0 : l));
    }
  }

  test("mergeReview is commutative, associative and idempotent", () => {
    for (const a of states) {
      assert.deepEqual(mergeReview(a, a), a);
      for (const b of states) {
        assert.deepEqual(mergeReview(a, b), mergeReview(b, a));
        for (const c of states) assert.deepEqual(mergeReview(mergeReview(a, b), c), mergeReview(a, mergeReview(b, c)));
      }
    }
    const x = { k: states[3], j: states[0] };
    const y = { k: states[7] };
    assert.deepEqual(mergeCards(x, y), mergeCards(y, x));
    assert.deepEqual(Object.keys(mergeCards(x, y)), ["j", "k"]);
  });

  test("mergeReview equals applyReview except on an exact tie of lastReviewedAt", () => {
    for (const a of states) {
      for (const b of states) {
        if (a.lastReviewedAt === b.lastReviewedAt) {
          const m = mergeReview(a, b);
          assert.equal(m.lastReviewedAt, a.lastReviewedAt);
          assert.deepEqual([m.reviews, m.lapses], [Math.max(a.reviews, b.reviews), Math.max(a.lapses, b.lapses)]);
        } else {
          assert.deepEqual(mergeReview(a, b), applyReview(a, b));
        }
      }
    }
  });
});
