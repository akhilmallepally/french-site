// The local daily-review store (docs/plans/review.md, rollout steps 3 and 4). It keeps card state
// only: ids, boxes, times and counts, never card text. The synced store (lib/review-sync-store.ts)
// implements the same interface; this one is used signed out, with the sync flag off, and until
// the facade has picked a store.
//
// Keys, following the progress store (lib/progress-store.ts, BrowserLocalStore):
// - Signed out: REVIEW_KEY, this browser's signed-out cards.
// - Signed in (a valid session read from the auth cookie, no network): reviewLocalKey(userId).
//   Writes go there, never to the signed-out key. Reads show the signed-out cards merged with the
//   account's own, as progress does, so nothing disappears when the learner signs in. They also
//   show that account's synced copy and unsent outbox (left by the synced store), so cards answered
//   while the flag was on still show when it's off. The synced store imports the account's local
//   key when it next runs.
//
// Saved shape, version 1 (compact, because a learner can have every card):
//   { "v": 1, "userId"?: string, "lessons": { "<lessonId>": { "<suffix>": [box, dueMs, lastMs|0, reviews, lapses] } },
//     "today"?: { "day", "newIds", "reviewIds", "drawn"? } }
// A card id is "<lessonId>-<suffix>". Anything unreadable is dropped, entry by entry.
import type { StorageLike } from "./progress-store.ts";
import { overlayCards, parseReviewCache, parseReviewOutbox, reviewCacheKey, reviewOutboxKey } from "./review-outbox.ts";
import { storedSessionUserId } from "./supabase-session-cookie.ts";
import {
  answer,
  logAnswer,
  logDrawn,
  logFor,
  MAX_BOX,
  mergeCards,
  newCard,
  type Calendar,
  type CardState,
  type DailyLog,
  type Grade,
} from "./review-scheduler.ts";

export const REVIEW_KEY = "parlons-review-v1";
export const reviewLocalKey = (userId: string) => `parlons-review-v1:local:${userId}`;

export type ReviewData = { cards: Record<string, CardState>; today?: DailyLog };

export interface ReviewStore {
  /** Everything this visitor sees. Never throws: unreadable storage gives an empty deck. */
  getAll(): Promise<ReviewData>;
  /** Adds new cards (box 0). Cards already in the deck are left as they are. */
  addCards(cardIds: string[], nowMs: number): Promise<void>;
  /** Records one answer and returns the card's new state, or null for a card not in the deck. */
  recordAnswer(cardId: string, grade: Grade, nowMs: number, cal: Calendar): Promise<CardState | null>;
  /** Notes the cards put into a session today, so a reopened /review offers the unanswered ones first. */
  recordDrawn(cardIds: string[], nowMs: number, cal: Calendar): Promise<void>;
  /** Called when what getAll returns may have changed (a server copy arrived, another store took over). */
  subscribe(listener: () => void): () => void;
}

type Packed = [number, number, number, number, number];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100_000;
const isMs = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0 && (n as number) < 8.64e15;
const ID_PART = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function unpack(p: unknown): CardState | null {
  if (!Array.isArray(p) || p.length !== 5) return null;
  const [box, due, last, reviews, lapses] = p;
  if (!Number.isInteger(box) || box < 0 || box > MAX_BOX || !isMs(due) || !isCount(reviews) || !isCount(lapses) || lapses > reviews) return null;
  if (box === 0 ? last !== 0 || reviews !== 0 : !isMs(last)) return null;
  return { box, dueAt: new Date(due).toISOString(), lastReviewedAt: box === 0 ? null : new Date(last).toISOString(), reviews, lapses };
}

function pack(s: CardState): Packed {
  return [s.box, Date.parse(s.dueAt), s.lastReviewedAt === null ? 0 : Date.parse(s.lastReviewedAt), s.reviews, s.lapses];
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []);

/** Parses a saved value. Wrong version, wrong owner, or junk: empty. Bad entries are dropped one by one. */
export function parseReviewData(text: string | null, userId: string | null): ReviewData {
  const empty: ReviewData = { cards: {} };
  let saved: unknown;
  try {
    saved = JSON.parse(text ?? "null");
  } catch {
    return empty;
  }
  if (!isObj(saved) || saved.v !== 1 || (saved.userId ?? null) !== userId || !isObj(saved.lessons)) return empty;
  const cards: Record<string, CardState> = {};
  for (const [lessonId, entries] of Object.entries(saved.lessons)) {
    if (!ID_PART.test(lessonId) || !isObj(entries)) continue;
    for (const [suffix, p] of Object.entries(entries)) {
      const state = /^v\d{1,6}$/.test(suffix) ? unpack(p) : null;
      if (state) cards[`${lessonId}-${suffix}`] = state;
    }
  }
  const t = saved.today;
  const today: DailyLog | undefined =
    isObj(t) && typeof t.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.day)
      ? { day: t.day, newIds: ids(t.newIds), reviewIds: ids(t.reviewIds), ...(t.drawn !== undefined ? { drawn: ids(t.drawn) } : {}) }
      : undefined;
  return today ? { cards, today } : { cards };
}

/** The saved text: cards grouped by lesson, sorted, so the same deck always gives the same text. */
export function serializeReviewData(data: ReviewData, userId: string | null): string {
  const lessons: Record<string, Record<string, Packed>> = {};
  for (const id of Object.keys(data.cards).sort()) {
    const m = /^(.*)-(v\d{1,6})$/.exec(id);
    if (!m) continue;
    (lessons[m[1]] ??= {})[m[2]] = pack(data.cards[id]);
  }
  return JSON.stringify({ v: 1, ...(userId ? { userId } : {}), lessons, ...(data.today ? { today: data.today } : {}) });
}

/** Both logs combined when they're for the same day; otherwise the later day's. */
export function mergeLogs(a: DailyLog | undefined, b: DailyLog | undefined): DailyLog | undefined {
  if (!a || !b) return a ?? b;
  if (a.day !== b.day) return a.day > b.day ? a : b;
  const u = (x: string[] = [], y: string[] = []) => [...new Set([...x, ...y])];
  const drawn = a.drawn || b.drawn ? { drawn: u(a.drawn, b.drawn) } : {};
  return { day: a.day, newIds: u(a.newIds, b.newIds), reviewIds: u(a.reviewIds, b.reviewIds), ...drawn };
}

export class LocalReviewStore implements ReviewStore {
  private readonly sessionUser: () => string | null;
  private readonly storage: () => StorageLike | null;

  constructor(sessionUser: () => string | null, storage: () => StorageLike | null) {
    this.sessionUser = sessionUser;
    this.storage = storage;
  }

  private where(): { storage: StorageLike; key: string; userId: string | null } | null {
    try {
      const storage = this.storage();
      if (!storage) return null;
      const userId = this.sessionUser();
      return { storage, key: userId ? reviewLocalKey(userId) : REVIEW_KEY, userId };
    } catch {
      return null;
    }
  }

  private read(storage: StorageLike, key: string, userId: string | null): ReviewData {
    try {
      return parseReviewData(storage.getItem(key), userId);
    } catch {
      return { cards: {} };
    }
  }

  private write(w: { storage: StorageLike; key: string; userId: string | null }, data: ReviewData): void {
    try {
      w.storage.setItem(w.key, serializeReviewData(data, w.userId));
    } catch {
      // Storage blocked or full: the answer just isn't saved, as for progress.
    }
  }

  /** The visitor's own key only (where writes go). */
  private own(): ReviewData {
    const w = this.where();
    return w ? this.read(w.storage, w.key, w.userId) : { cards: {} };
  }

  /** The account's synced copy with its unsent outbox on top (empty if there's none). */
  private synced(storage: StorageLike, userId: string): ReviewData {
    try {
      const cache = parseReviewCache(storage.getItem(reviewCacheKey(userId)), userId);
      const cards = overlayCards(cache?.cards ?? {}, parseReviewOutbox(storage.getItem(reviewOutboxKey(userId)), userId));
      return cache?.today ? { cards, today: cache.today } : { cards };
    } catch {
      return { cards: {} };
    }
  }

  async getAll(): Promise<ReviewData> {
    const w = this.where();
    if (!w) return { cards: {} };
    const mine = this.read(w.storage, w.key, w.userId);
    if (!w.userId) return mine;
    const signedOut = this.read(w.storage, REVIEW_KEY, null);
    const synced = this.synced(w.storage, w.userId);
    const today = mergeLogs(mergeLogs(signedOut.today, synced.today), mine.today);
    return { cards: mergeCards(mergeCards(signedOut.cards, synced.cards), mine.cards), ...(today ? { today } : {}) };
  }

  async addCards(cardIds: string[], nowMs: number): Promise<void> {
    const w = this.where();
    if (!w || !cardIds.length) return;
    const seen = await this.getAll();
    const data = this.own();
    let changed = false;
    for (const id of cardIds) {
      if (seen.cards[id] || data.cards[id]) continue;
      data.cards[id] = newCard(nowMs);
      changed = true;
    }
    if (changed) this.write(w, data);
  }

  async recordAnswer(cardId: string, grade: Grade, nowMs: number, cal: Calendar): Promise<CardState | null> {
    const w = this.where();
    if (!w) return null;
    const seen = await this.getAll();
    const before = seen.cards[cardId];
    if (!before) return null;
    const after = answer(before, grade, nowMs, cal);
    const data = this.own();
    data.cards[cardId] = after;
    data.today = logAnswer(logFor(seen.today, cal.dayOf(nowMs)), cal.dayOf(nowMs), cardId, before.box === 0);
    this.write(w, data);
    return after;
  }

  async recordDrawn(cardIds: string[], nowMs: number, cal: Calendar): Promise<void> {
    const w = this.where();
    if (!w || !cardIds.length) return;
    const seen = await this.getAll();
    const data = this.own();
    data.today = logDrawn(logFor(seen.today, cal.dayOf(nowMs)), cal.dayOf(nowMs), cardIds);
    this.write(w, data);
  }

  subscribe(): () => void {
    return () => {};
  }
}

/** The browser-only store: localStorage and the session from the auth cookie (no network). */
export function createLocalReviewStore(): ReviewStore {
  return new LocalReviewStore(
    () => (typeof document === "undefined" ? null : storedSessionUserId(document.cookie, process.env.NEXT_PUBLIC_SUPABASE_URL, Date.now())),
    () => (typeof window === "undefined" ? null : window.localStorage),
  );
}
