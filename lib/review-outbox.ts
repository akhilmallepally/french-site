// The review outbox and storage keys (docs/plans/review.md, rollout step 4). Pure: no storage, no
// locks, no network. lib/review-sync-store.ts runs every change here under the review outbox lock.
//
// One key per card ("r:<cardId>"), with at most two entries, as for progress:
// - inFlight: sent and not yet confirmed. Frozen.
// - pending: written since. A new state for the card is merged into it (mergeReview).
// An entry is a whole card state, not a delta, and apply_review's merge is idempotent, so a resend
// or an import of the same card is harmless. Each outbox names its user; another user's is ignored.
import { MAX_BOX, mergeReview, type CardState } from "./review-scheduler.ts";

// ---------- Keys ----------

/** The synced copy of a user's cards (server rows with the outbox on top), with that day's log. */
export const reviewCacheKey = (userId: string) => `parlons-review-v1:u:${userId}`;
export const REVIEW_CACHE_PREFIX = "parlons-review-v1:u:";
export const reviewOutboxKey = (userId: string) => `parlons-review-outbox-v1:${userId}`;
export const reviewRejectedKey = (userId: string) => `parlons-review-rejected-v1:${userId}`;
/** The newest signed-out card time already imported (the signed-out cards themselves stay). */
export const REVIEW_IMPORTED_MARKER_KEY = "parlons-review-imported-v1";
/** The account the review facade picked last (its own key, so it never disturbs progress's). */
export const REVIEW_LAST_USER_KEY = "parlons-review-last-user-v1";

export const cardKey = (cardId: string) => `r:${cardId}`;

/** "a1-greetings-v003" → "a1-greetings" (0008's lesson-prefix rule). */
export const lessonIdOfCard = (cardId: string) => cardId.replace(/-v\d+$/, "");

// ---------- The wire entry (apply_review's shape, plus nothing) ----------

export type ReviewItem = {
  key: string;
  cardId: string;
  lessonId: string;
  box: number;
  dueAt: string;
  lastReviewedAt: string | null;
  reviews: number;
  lapses: number;
};

export function toItem(cardId: string, s: CardState): ReviewItem {
  return { key: cardKey(cardId), cardId, lessonId: lessonIdOfCard(cardId), box: s.box, dueAt: s.dueAt, lastReviewedAt: s.lastReviewedAt, reviews: s.reviews, lapses: s.lapses };
}

// ---------- The outbox ----------

export type ReviewEntry = { seq: number; cardId: string; state: CardState };
export type ReviewSlot = { inFlight?: ReviewEntry; pending?: ReviewEntry };
export type ReviewOutbox = { v: 1; userId: string; seq: number; slots: Record<string, ReviewSlot> };

export const REVIEW_BATCH_MAX_ITEMS = 200; // the action's limit
export const REVIEW_BATCH_MAX_BYTES = 120 * 1024; // under the action's 128 KiB

export const emptyReviewOutbox = (userId: string): ReviewOutbox => ({ v: 1, userId, seq: 0, slots: {} });
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** Puts a card's state in its pending entry (merged with a pending one already there). */
export function queueCard(outbox: ReviewOutbox, cardId: string, state: CardState): ReviewOutbox {
  const out = clone(outbox);
  putCard(out, cardId, state);
  return out;
}

/** queueCard on an outbox already copied (in place). */
function putCard(out: ReviewOutbox, cardId: string, state: CardState): void {
  const slot = (out.slots[cardKey(cardId)] ??= {});
  const prev = slot.pending;
  slot.pending = { seq: prev?.seq ?? ++out.seq, cardId, state: prev ? mergeReview(prev.state, state) : { ...state } };
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * Marks the next batch as in flight and returns it: in-flight entries first (left by a flusher that
 * has gone), then pending entries of keys with nothing in flight, in the order they were written.
 * At most 200 entries and 120 KiB.
 */
export function takeReviewBatch(outbox: ReviewOutbox): { outbox: ReviewOutbox; items: ReviewItem[] } {
  const out = clone(outbox);
  const inFlight = Object.entries(out.slots).filter(([, s]) => s.inFlight).sort(([, a], [, b]) => a.inFlight!.seq - b.inFlight!.seq);
  const pending = Object.entries(out.slots).filter(([, s]) => !s.inFlight && s.pending).sort(([, a], [, b]) => a.pending!.seq - b.pending!.seq);
  const items: ReviewItem[] = [];
  let size = bytes({ expectedUserId: out.userId, items: [] });
  for (const [, slot] of [...inFlight, ...pending]) {
    if (items.length >= REVIEW_BATCH_MAX_ITEMS) break;
    const entry = slot.inFlight ?? slot.pending!;
    const wire = toItem(entry.cardId, entry.state);
    const add = bytes(wire) + 1;
    if (size + add > REVIEW_BATCH_MAX_BYTES) break;
    size += add;
    items.push(wire);
    if (!slot.inFlight) {
      slot.inFlight = slot.pending;
      delete slot.pending;
    }
  }
  return { outbox: out, items };
}

/** An "ok" reply: applied and rejected keys lose their in-flight entry; unmentioned keys are sent again. */
export function settleReview(outbox: ReviewOutbox, applied: string[], rejectedKeys: string[]): ReviewOutbox {
  const out = clone(outbox);
  for (const key of [...applied, ...rejectedKeys]) {
    const slot = out.slots[key];
    if (!slot) continue;
    delete slot.inFlight;
    if (!slot.pending) delete out.slots[key];
  }
  return out;
}

export const reviewHasWork = (o: ReviewOutbox) => Object.values(o.slots).some((s) => s.inFlight || s.pending);

/** The outbox's states merged over `cards` (in flight, then pending), for the given card ids or all. */
export function overlayCards(cards: Record<string, CardState>, outbox: ReviewOutbox, cardIds?: Iterable<string>): Record<string, CardState> {
  const out = clone(cards);
  const wanted = cardIds ? new Set([...cardIds].map(cardKey)) : null;
  for (const [key, slot] of Object.entries(outbox.slots)) {
    if (wanted && !wanted.has(key)) continue;
    for (const e of [slot.inFlight, slot.pending]) {
      if (e) out[e.cardId] = out[e.cardId] ? mergeReview(out[e.cardId], e.state) : { ...e.state };
    }
  }
  return out;
}

// ---------- Reading back from storage ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTime = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));

/** A card state as stored or sent (the same rules 0008 checks on its shape). */
export function isCardState(s: unknown): s is CardState {
  if (!isObj(s)) return false;
  const { box, dueAt, lastReviewedAt, reviews, lapses } = s;
  if (!Number.isInteger(box) || (box as number) < 0 || (box as number) > MAX_BOX || !isTime(dueAt)) return false;
  if (!Number.isInteger(reviews) || !Number.isInteger(lapses) || (lapses as number) < 0 || (lapses as number) > (reviews as number)) return false;
  return box === 0 ? lastReviewedAt === null && reviews === 0 : isTime(lastReviewedAt);
}

function validEntry(e: unknown): e is ReviewEntry {
  return isObj(e) && typeof e.seq === "number" && typeof e.cardId === "string" && isCardState(e.state);
}

export function parseReviewOutbox(json: string | null, userId: string): ReviewOutbox {
  try {
    const o = JSON.parse(json ?? "null");
    if (!isObj(o) || o.v !== 1 || o.userId !== userId || !isObj(o.slots) || typeof o.seq !== "number") return emptyReviewOutbox(userId);
    const slots: Record<string, ReviewSlot> = {};
    for (const [key, s] of Object.entries(o.slots)) {
      if (!isObj(s)) continue;
      const slot: ReviewSlot = {};
      if (validEntry(s.inFlight) && cardKey(s.inFlight.cardId) === key) slot.inFlight = s.inFlight;
      if (validEntry(s.pending) && cardKey(s.pending.cardId) === key) slot.pending = s.pending;
      if (slot.inFlight || slot.pending) slots[key] = slot;
    }
    return { v: 1, userId, seq: o.seq, slots };
  } catch {
    return emptyReviewOutbox(userId);
  }
}

/** A user's cached synced cards (and that day's log), or null when there's none or it names someone else. */
export type ReviewCache = { cards: Record<string, CardState>; today?: { day: string; newIds: string[]; reviewIds: string[]; drawn?: string[] } };

export function parseReviewCache(json: string | null, userId: string): ReviewCache | null {
  try {
    const c = JSON.parse(json ?? "null");
    if (!isObj(c) || c.userId !== userId || !isObj(c.cards)) return null;
    const cards: Record<string, CardState> = {};
    for (const [id, s] of Object.entries(c.cards)) if (isCardState(s)) cards[id] = s;
    const t = c.today;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const today = isObj(t) && typeof t.day === "string" ? { day: t.day, newIds: strings(t.newIds), reviewIds: strings(t.reviewIds), drawn: strings(t.drawn) } : undefined;
    return today ? { cards, today } : { cards };
  } catch {
    return null;
  }
}

export function serializeReviewCache(cache: ReviewCache, userId: string): string {
  return JSON.stringify({ userId, cards: cache.cards, ...(cache.today ? { today: cache.today } : {}) });
}

// ---------- Importing (docs/plans/review.md, section 5: the progress import rules) ----------

/** The time a card was last changed: its review, or when it was added (box 0). */
export const cardTime = (s: CardState) => Date.parse(s.lastReviewedAt ?? s.dueAt);

/** Queues every card changed after `sinceMs`. Returns the keys queued and the newest time. */
export function queueReviewImport(outbox: ReviewOutbox, cards: Record<string, CardState>, sinceMs: number): { outbox: ReviewOutbox; keys: string[]; newestMs: number } {
  const out = clone(outbox);
  const keys: string[] = [];
  let newestMs = sinceMs;
  for (const id of Object.keys(cards).sort()) {
    const s = cards[id];
    if (!isCardState(s)) continue;
    const t = cardTime(s);
    if (!(t > sinceMs)) continue;
    putCard(out, id, s);
    keys.push(cardKey(id));
    newestMs = Math.max(newestMs, t);
  }
  return { outbox: out, keys, newestMs };
}
