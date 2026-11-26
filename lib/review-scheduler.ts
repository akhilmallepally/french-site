// The daily-review scheduler (docs/plans/review.md, sections 3 and 9, rollout step 3). Pure: no
// I/O, no clock of its own. Pass in the time (ms) and a Calendar for the learner's time zone.
//
// Runs under plain Node (type stripping) too, so: relative .ts imports, no parameter properties.
import { isFreeLevel } from "./free-levels.ts";
import type { ProgressData } from "./progress-core.ts";
import type { ReviewIdIndex } from "./review-catalogue.ts";

// ---------- Card state (the fields of review_cards in 0008, without the user) ----------

/** box 0 = in the deck, never answered (lastReviewedAt null). Times are ISO strings, as sent to 0008. */
export type CardState = { box: number; dueAt: string; lastReviewedAt: string | null; reviews: number; lapses: number };

export type Grade = "knew" | "not-yet";

/** Days until the next review, by box (box 0 is never scheduled by interval). */
export const INTERVAL_DAYS = [0, 1, 3, 7, 16, 35] as const;
export const MAX_BOX = 5;
export const NEW_PER_DAY = 10;
export const REVIEWS_PER_DAY = 60;
export const SESSION_SIZE = 20;
/** 0008 rejects a lastReviewedAt more than this far ahead of server time (future_time). */
export const MAX_AHEAD_MS = 24 * 60 * 60 * 1000;

// ---------- Local calendar days ----------

/** "YYYY-MM-DD" in the learner's time zone, and the first instant of a given day there. */
export type Calendar = { dayOf(ms: number): string; startOfDay(day: string): number };

const pad = (n: number) => String(n).padStart(2, "0");

/** day + n calendar days, by date arithmetic (no time zone involved). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * The calendar of an IANA time zone, or of the device when none is given. startOfDay handles
 * daylight-saving changes, including zones where midnight itself is skipped (it's then the first
 * instant that falls on that day).
 */
export function calendarFor(timeZone?: string): Calendar {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const wall = (ms: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, asUtc: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) };
  };
  const dayOf = (ms: number) => wall(ms).day;
  return {
    dayOf,
    startOfDay(day: string): number {
      const [y, m, d] = day.split("-").map(Number);
      const midnightUtc = Date.UTC(y, m - 1, d);
      // Shift by the zone's offset, then once more in case that crossed a daylight-saving change.
      let t = midnightUtc - (wall(midnightUtc).asUtc - midnightUtc);
      t = midnightUtc - (wall(t).asUtc - t);
      t -= t % 1000;
      // Exact: step back while the previous minute is still the same day, forward while it's the day before.
      while (dayOf(t - 60_000) === day) t -= 60_000;
      while (dayOf(t) < day) t += 60_000;
      return t;
    },
  };
}

/** Due when dueAt falls on or before the end of `today` (a local day). Box 0 cards are new, not due. */
export function isDue(state: CardState, today: string, cal: Calendar): boolean {
  return state.box > 0 && cal.dayOf(Date.parse(state.dueAt)) <= today;
}

// ---------- Answers ----------

export function newCard(nowMs: number): CardState {
  return { box: 0, dueAt: new Date(nowMs).toISOString(), lastReviewedAt: null, reviews: 0, lapses: 0 };
}

/**
 * The state after one answer.
 * - "I knew it": up one box (box 5 stays at 5). A new card goes to box 1.
 * - "Not yet": back to box 1, and a lapse is counted when the card had been answered before
 *   (a new card's first "Not yet" isn't a lapse: it was never known).
 * - The next due date is the start of the local day `interval` days after today.
 * - The review time is now, or 1 ms after the stored review if the device clock went backwards,
 *   so the answer always wins the merge. It never goes more than 24 hours ahead of now.
 */
export function answer(state: CardState, grade: Grade, nowMs: number, cal: Calendar): CardState {
  const box = grade === "knew" ? Math.min(MAX_BOX, state.box + 1) : 1;
  const last = state.lastReviewedAt === null ? null : Date.parse(state.lastReviewedAt);
  const bumped = last !== null && last >= nowMs ? last + 1 : nowMs;
  const reviewedAt = bumped <= nowMs + MAX_AHEAD_MS ? bumped : nowMs;
  return {
    box,
    dueAt: new Date(cal.startOfDay(addDays(cal.dayOf(nowMs), INTERVAL_DAYS[box]))).toISOString(),
    lastReviewedAt: new Date(reviewedAt).toISOString(),
    reviews: state.reviews + 1,
    lapses: state.lapses + (grade === "not-yet" && state.box > 0 ? 1 : 0),
  };
}

// ---------- Daily limits (per local day) ----------

/**
 * The cards answered on `day`: new ones (box 0 before the answer) and reviews, each counted once.
 * Only these count towards the limits. `drawn` lists the cards put into today's sessions, so a
 * reopened /review offers the ones not answered yet first; drawing a card doesn't count.
 */
export type DailyLog = { day: string; newIds: string[]; reviewIds: string[]; drawn?: string[] };

export function logFor(log: DailyLog | undefined, today: string): DailyLog {
  return log && log.day === today ? log : { day: today, newIds: [], reviewIds: [] };
}

export function logAnswer(log: DailyLog | undefined, today: string, cardId: string, wasNew: boolean): DailyLog {
  const l = logFor(log, today);
  const list = wasNew ? l.newIds : l.reviewIds;
  if (list.includes(cardId) || l.newIds.includes(cardId)) return l;
  return wasNew ? { ...l, newIds: [...l.newIds, cardId] } : { ...l, reviewIds: [...l.reviewIds, cardId] };
}

/** Adds a session's cards to today's drawn list (in order, each once). */
export function logDrawn(log: DailyLog | undefined, today: string, cardIds: string[]): DailyLog {
  const l = logFor(log, today);
  const drawn = [...(l.drawn ?? [])];
  for (const id of cardIds) if (!drawn.includes(id)) drawn.push(id);
  return { ...l, drawn };
}

// ---------- The id index and access ----------

export type DeckIndex = {
  /** Every card id in course order. */
  order: string[];
  rank: Map<string, number>;
  levelOf: Map<string, string>;
  /** Lesson id -> the cards practising it adds (its own and the ones it joined). */
  byLesson: Map<string, string[]>;
};

export function deckIndex(index: ReviewIdIndex): DeckIndex {
  const order: string[] = [];
  const levelOf = new Map<string, string>();
  const byLesson = new Map<string, string[]>();
  for (const [lessonId, l] of Object.entries(index.lessons)) {
    const own = l.cards.map((suffix) => `${lessonId}-${suffix}`);
    for (const id of own) {
      order.push(id);
      levelOf.set(id, l.level);
    }
    byLesson.set(lessonId, [...own, ...(l.joins ?? [])]);
  }
  return { order, rank: new Map(order.map((id, i) => [id, i])), levelOf, byLesson };
}

/** Free-level cards for everyone; paid-level cards only with access. An unknown id never. */
export function cardAllowed(index: DeckIndex, cardId: string, hasAccess: boolean): boolean {
  const level = index.levelOf.get(cardId);
  return level !== undefined && (hasAccess || isFreeLevel(level));
}

// ---------- The deck ----------

const lessonOfExercise = (exerciseId: string) => exerciseId.replace(/-ex\d+$/, "");

/** Lessons with at least one answered exercise or a finished run. */
export function practisedLessons(progress: ProgressData): Set<string> {
  return new Set([...Object.keys(progress.exercises).map(lessonOfExercise), ...Object.keys(progress.lessons)]);
}

/** Cards to add to the deck (box 0), in course order: from practised lessons, allowed, not already in it. */
export function deckAdditions(
  index: DeckIndex,
  cards: Record<string, CardState>,
  practised: Set<string>,
  hasAccess: boolean,
): string[] {
  const add = new Set<string>();
  for (const lessonId of practised) {
    for (const id of index.byLesson.get(lessonId) ?? []) {
      if (!cards[id] && cardAllowed(index, id, hasAccess)) add.add(id);
    }
  }
  return [...add].sort((a, b) => index.rank.get(a)! - index.rank.get(b)!);
}

// ---------- Sessions ----------

export type SessionInput = {
  index: DeckIndex;
  cards: Record<string, CardState>;
  hasAccess: boolean;
  nowMs: number;
  cal: Calendar;
  log: DailyLog | undefined;
  /** Cards already in this visit's earlier batches ("Do another 20"): left out. They don't count against the limits. */
  exclude?: Iterable<string>;
  size?: number;
};

/**
 * Up to 20 cards, within today's limits (60 reviews, 10 new), which count only cards answered
 * today. First the cards drawn earlier today and not answered yet (a reopened /review), in the
 * order they were drawn; then due cards (oldest due first, then course order); then new cards in
 * course order. Cards without access never appear, even if their state exists. An empty list
 * means nothing more today.
 */
export function buildSession(input: SessionInput): string[] {
  const { index, cards, hasAccess, nowMs, cal } = input;
  const size = input.size ?? SESSION_SIZE;
  const today = cal.dayOf(nowMs);
  const log = logFor(input.log, today);
  const exclude = new Set(input.exclude ?? []);
  let reviewRoom = Math.max(0, REVIEWS_PER_DAY - log.reviewIds.length);
  let newRoom = Math.max(0, NEW_PER_DAY - log.newIds.length);
  const usable = (id: string) => !!cards[id] && !exclude.has(id) && cardAllowed(index, id, hasAccess);
  const byRank = (a: string, b: string) => (index.rank.get(a) ?? Infinity) - (index.rank.get(b) ?? Infinity);
  const due = Object.keys(cards)
    .filter((id) => usable(id) && isDue(cards[id], today, cal))
    .sort((a, b) => Date.parse(cards[a].dueAt) - Date.parse(cards[b].dueAt) || byRank(a, b));
  const fresh = Object.keys(cards)
    .filter((id) => usable(id) && cards[id].box === 0)
    .sort(byRank);

  const out: string[] = [];
  const taken = new Set<string>();
  const take = (id: string) => {
    if (out.length >= size || taken.has(id) || !usable(id)) return;
    if (cards[id].box === 0) {
      if (newRoom <= 0) return;
      newRoom -= 1;
    } else {
      if (reviewRoom <= 0 || !isDue(cards[id], today, cal)) return;
      reviewRoom -= 1;
    }
    taken.add(id);
    out.push(id);
  };
  for (const id of log.drawn ?? []) take(id); // answered ones are no longer new or due
  for (const id of due) take(id);
  for (const id of fresh) take(id);
  return out;
}

/**
 * One session's queue. "Not yet" puts the card back once at the end of the session; that second
 * showing is practice only: it doesn't change the card's schedule or count towards the limits.
 */
export type Session = { queue: string[]; position: number; repeats: string[] };

export function startSession(ids: string[]): Session {
  return { queue: [...ids], position: 0, repeats: [] };
}

export function currentCard(session: Session): string | null {
  return session.queue[session.position] ?? null;
}

/** Moves past the current card. `schedule` says whether this answer updates the card's state. */
export function nextInSession(session: Session, grade: Grade): { session: Session; schedule: boolean } {
  const id = currentCard(session);
  if (id === null) return { session, schedule: false };
  const isRepeat = session.queue.indexOf(id) < session.position;
  const requeue = grade === "not-yet" && !isRepeat && !session.repeats.includes(id);
  return {
    session: {
      queue: requeue ? [...session.queue, id] : session.queue,
      position: session.position + 1,
      repeats: requeue ? [...session.repeats, id] : session.repeats,
    },
    schedule: !isRepeat,
  };
}

// ---------- Merging (as apply_review in 0008) ----------

const time = (iso: string | null) => (iso === null ? null : Date.parse(iso));

/** True when `entry` is a strictly later review than `stored` (or the first one). */
function laterReview(entry: CardState, stored: CardState): boolean {
  const e = time(entry.lastReviewedAt);
  const s = time(stored.lastReviewedAt);
  return e !== null && (s === null || e > s);
}

/**
 * Exactly what apply_review does to a stored row: the strictly later lastReviewedAt wins whole
 * (box, dueAt, lastReviewedAt); a tie, or an unreviewed entry against a stored card, keeps the
 * stored state; the counts take the larger of each. With nothing stored, the entry is stored as is.
 */
export function applyReview(stored: CardState | undefined, entry: CardState): CardState {
  if (!stored) return { ...entry };
  const w = laterReview(entry, stored) ? entry : stored;
  return { box: w.box, dueAt: w.dueAt, lastReviewedAt: w.lastReviewedAt, reviews: Math.max(stored.reviews, entry.reviews), lapses: Math.max(stored.lapses, entry.lapses) };
}

/**
 * The same rules made symmetric, so merging is commutative, associative and idempotent. Only an
 * exact tie on lastReviewedAt differs from applyReview: the higher box wins, then the later dueAt.
 */
export function mergeReview(a: CardState, b: CardState): CardState {
  let w: CardState;
  if (laterReview(a, b)) w = a;
  else if (laterReview(b, a)) w = b;
  else if (a.box !== b.box) w = a.box > b.box ? a : b;
  else w = Date.parse(a.dueAt) >= Date.parse(b.dueAt) ? a : b;
  return { box: w.box, dueAt: w.dueAt, lastReviewedAt: w.lastReviewedAt, reviews: Math.max(a.reviews, b.reviews), lapses: Math.max(a.lapses, b.lapses) };
}

export function mergeCards(a: Record<string, CardState>, b: Record<string, CardState>): Record<string, CardState> {
  const out: Record<string, CardState> = {};
  for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    out[id] = a[id] && b[id] ? mergeReview(a[id], b[id]) : { ...(a[id] ?? b[id]) };
  }
  return out;
}
