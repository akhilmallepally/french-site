// What the review server actions do (docs/plans/review.md, rollout step 4), with the database and
// the access check passed in, so it can be tested without Supabase. app/actions/review.ts wires it
// to Supabase. Pure apart from those: no file reads, no lib/lessons.ts, no card text anywhere.
//
// Two levels, as for progress:
// - The payload: { expectedUserId, items }, 1 to 200 entries, at most 128 KiB, every key "r:…" and
//   unique, and no field but the eight below (so card text, or anything else, is refused). Any
//   problem rejects the whole call and nothing is written.
// - Each entry: the card id in the id index and in the right lesson, the box, the counts, the times
//   (never more than 24 h ahead, dueAt within 0008's limits), and access: the daily review is
//   part of lifetime access (Prompt 76), so every card, free-level ones included, needs it.
//   A bad entry is rejected with a code; the others go ahead.
import { isFreeLevel } from "./free-levels.ts";
import { checkSyncTime } from "./progress-validate.ts";
import type { ReviewIdIndex } from "./review-catalogue.ts";
import type { ReviewItem } from "./review-outbox.ts";
import { MAX_AHEAD_MS, MAX_BOX, type CardState } from "./review-scheduler.ts";

export const REVIEW_MAX_ITEMS = 200; // c_max_items in 0008
export const REVIEW_MAX_PAYLOAD_BYTES = 128 * 1024;
const MAX_KEY = 200;
const MAX_COUNT = 100_000; // 0008's review_count check
const MAX_DUE_MS = 400 * 24 * 3600_000; // 0008's c_max_due
const CARD_RE = /^[a-z0-9]+(-[a-z0-9]+)*-v[0-9]{1,6}$/;
const FIELDS = ["key", "cardId", "lessonId", "box", "dueAt", "lastReviewedAt", "reviews", "lapses"] as const;

export type ReviewEntryCode =
  | "bad_item"
  | "bad_id"
  | "unknown_id"
  | "wrong_lesson"
  | "bad_box"
  | "bad_count"
  | "bad_time"
  | "future_time"
  | "no_access";
export type ReviewPayloadCode = "bad_payload" | "too_many_items" | "too_large" | "bad_key" | "duplicate_key" | "unexpected_field";
export type ReviewRejection = { key: string; code: ReviewEntryCode | "cap_reached" | "invalid" | string };

// ---------- The id index ----------

type Lookup = Map<string, { lessonId: string; free: boolean }>;
const lookups = new WeakMap<ReviewIdIndex, Lookup>();

/** Card id → its lesson and whether its level is free, from lib/generated/review-card-ids.json. */
export function cardLookup(index: ReviewIdIndex): Lookup {
  let found = lookups.get(index);
  if (!found) {
    found = new Map();
    for (const [lessonId, l] of Object.entries(index.lessons)) {
      for (const suffix of l.cards) found.set(`${lessonId}-${suffix}`, { lessonId, free: isFreeLevel(l.level) });
    }
    lookups.set(index, found);
  }
  return found;
}

// ---------- Validation ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

/** Per-entry checks, without access (that's checked once per call, after these). */
function checkItem(e: Record<string, unknown>, lookup: Lookup, nowMs: number): { item?: ReviewItem; code?: ReviewEntryCode } {
  if (FIELDS.some((k) => !(k in e))) return { code: "bad_item" };
  const { cardId, lessonId, box, dueAt, lastReviewedAt, reviews, lapses } = e;
  if (typeof cardId !== "string" || cardId.length > 160 || !CARD_RE.test(cardId)) return { code: "bad_id" };
  if (typeof lessonId !== "string" || lessonId.length < 1 || lessonId.length > 120) return { code: "bad_id" };
  const known = lookup.get(cardId);
  if (!known) return { code: "unknown_id" };
  if (known.lessonId !== lessonId) return { code: "wrong_lesson" };
  if (!isInt(box) || box < 0 || box > MAX_BOX) return { code: "bad_box" };
  if (!isInt(reviews) || !isInt(lapses) || reviews < 0 || reviews > MAX_COUNT || lapses < 0 || lapses > reviews) return { code: "bad_count" };
  if (box === 0 ? reviews !== 0 : reviews < 1) return { code: "bad_count" };
  if (box === 0) {
    if (lastReviewedAt !== null) return { code: "bad_time" };
  } else {
    const t = checkSyncTime(lastReviewedAt, nowMs); // ISO with at most milliseconds, at most 24 h ahead
    if (t !== "ok") return { code: t };
  }
  // dueAt: a valid time; at most 24 h ahead for a new card, 400 days otherwise (0008).
  if (checkSyncTime(dueAt, Number.POSITIVE_INFINITY) !== "ok") return { code: "bad_time" };
  if (Date.parse(dueAt as string) > nowMs + (box === 0 ? MAX_AHEAD_MS : MAX_DUE_MS)) return { code: "future_time" };
  return {
    item: { key: e.key as string, cardId, lessonId, box, dueAt: dueAt as string, lastReviewedAt: (lastReviewedAt as string | null) ?? null, reviews, lapses },
  };
}

export type ReviewPayloadResult =
  | { ok: false; code: ReviewPayloadCode }
  | { ok: true; expectedUserId: string; valid: ReviewItem[]; rejected: ReviewRejection[] };

function byteLength(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return null;
  }
}

/**
 * Validates `{ expectedUserId, items }`. `hasAccess` is called at most once, and only when some
 * entry is otherwise valid; without access every such entry is rejected as no_access (free-level
 * cards too: the daily review is for learners with access). Stored rows are never touched.
 */
export async function validateReviewPayload(input: unknown, index: ReviewIdIndex, nowMs: number, hasAccess: () => Promise<boolean>): Promise<ReviewPayloadResult> {
  if (!isObj(input)) return { ok: false, code: "bad_payload" };
  for (const k of Object.keys(input)) if (k !== "expectedUserId" && k !== "items") return { ok: false, code: "unexpected_field" };
  const { expectedUserId, items } = input;
  if (typeof expectedUserId !== "string" || expectedUserId.length < 1 || expectedUserId.length > 64) return { ok: false, code: "bad_payload" };
  if (!Array.isArray(items) || items.length < 1) return { ok: false, code: "bad_payload" };
  if (items.length > REVIEW_MAX_ITEMS) return { ok: false, code: "too_many_items" };
  const bytes = byteLength(input);
  if (bytes === null) return { ok: false, code: "bad_payload" };
  if (bytes > REVIEW_MAX_PAYLOAD_BYTES) return { ok: false, code: "too_large" };

  const keys = new Set<string>();
  for (const e of items) {
    if (!isObj(e)) return { ok: false, code: "bad_payload" };
    if (typeof e.key !== "string" || e.key.length < 3 || e.key.length > MAX_KEY || !e.key.startsWith("r:")) return { ok: false, code: "bad_key" };
    if (keys.has(e.key)) return { ok: false, code: "duplicate_key" };
    keys.add(e.key);
    for (const k of Object.keys(e)) if (!(FIELDS as readonly string[]).includes(k)) return { ok: false, code: "unexpected_field" };
  }

  const lookup = cardLookup(index);
  const checked: ReviewItem[] = [];
  const rejected: ReviewRejection[] = [];
  for (const e of items as Record<string, unknown>[]) {
    const { item, code } = checkItem(e, lookup, nowMs);
    if (item) checked.push(item);
    else rejected.push({ key: e.key as string, code: code! });
  }

  if (checked.length && !(await hasAccess())) {
    for (const item of checked) rejected.push({ key: item.key, code: "no_access" });
    return { ok: true, expectedUserId, valid: [], rejected };
  }
  return { ok: true, expectedUserId, valid: checked, rejected };
}

// ---------- Rows and replies ----------

export type ReviewRow = { card_id: string; box: number; due_at: string; last_reviewed_at: string | null; review_count: number; lapse_count: number };

export interface ReviewDb {
  /** One apply_review call with the entries in order. */
  apply(items: ReviewItem[]): Promise<unknown>;
  /** The caller's rows for these card ids (RLS: own rows only). */
  read(cardIds: string[]): Promise<ReviewRow[]>;
  /** All of the caller's rows. */
  readAll(): Promise<ReviewRow[]>;
  /** Deletes all of the caller's rows. */
  deleteAll(): Promise<void>;
}

export type ReviewSyncReply =
  | { status: "ok"; applied: string[]; rejected: ReviewRejection[]; rows: Record<string, CardState> }
  | { status: "invalid"; code: ReviewPayloadCode }
  | { status: "signed-out" }
  | { status: "wrong-user" }
  | { status: "unavailable" };

export type ReviewGetReply = { status: "ok"; cards: Record<string, CardState> } | { status: "signed-out" | "wrong-user" | "unavailable" };

const isoMs = (value: string) => {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error("unparseable time from the database");
  return new Date(ms).toISOString();
};

/** Rows as client card states, keys sorted, times as millisecond ISO. Rows the id index doesn't know are left out. */
export function rowsToCards(rows: ReviewRow[], lookup: Lookup): Record<string, CardState> {
  const out: Record<string, CardState> = {};
  for (const r of [...rows].sort((a, b) => (a.card_id < b.card_id ? -1 : 1))) {
    if (!lookup.get(r.card_id)) continue;
    out[r.card_id] = {
      box: r.box,
      dueAt: isoMs(r.due_at),
      lastReviewedAt: r.last_reviewed_at === null ? null : isoMs(r.last_reviewed_at),
      reviews: r.review_count,
      lapses: r.lapse_count,
    };
  }
  return out;
}

/** apply_review's reply, checked: only keys that were sent, in the documented shape. */
function readApplyReply(reply: unknown, sent: Set<string>): { applied: string[]; rejected: ReviewRejection[] } | null {
  if (!isObj(reply)) return null;
  const { applied, rejected } = reply;
  if (!Array.isArray(applied) || !Array.isArray(rejected)) return null;
  if (!applied.every((k) => typeof k === "string" && sent.has(k))) return null;
  if (!rejected.every((r) => isObj(r) && typeof r.key === "string" && sent.has(r.key) && typeof r.code === "string")) return null;
  return { applied: applied as string[], rejected: (rejected as { key: string; code: string }[]).map((r) => ({ key: r.key, code: r.code })) };
}

export type ReviewContext = { userId: string; index: ReviewIdIndex; nowMs: number; db: ReviewDb; hasAccess: () => Promise<boolean> };

/** A cached access check, so one call asks the database at most once. */
// A failed check is not "no access" (Prompt 80): it throws through, and the action answers
// "unavailable", so no entry is rejected as no_access (which drops it from the outbox for good) and
// no read comes back empty. The store retries later.
function once(fn: () => Promise<boolean>): () => Promise<boolean> {
  let p: Promise<boolean> | null = null;
  return () => (p ??= fn());
}

/**
 * syncReviewAction after the session check. The user is the session's; the payload's
 * expectedUserId is only compared with it. Entries that fail validation never reach the database.
 * After apply_review, the stored rows the valid entries name are read back in the same request.
 */
export async function runReviewSync(input: unknown, ctx: ReviewContext): Promise<ReviewSyncReply> {
  const hasAccess = once(ctx.hasAccess);
  const checked = await validateReviewPayload(input, ctx.index, ctx.nowMs, hasAccess);
  if (!checked.ok) return { status: "invalid", code: checked.code };
  if (checked.expectedUserId !== ctx.userId) return { status: "wrong-user" };
  if (!checked.valid.length) return { status: "ok", applied: [], rejected: checked.rejected, rows: {} };
  const sent = new Set(checked.valid.map((i) => i.key));
  const reply = readApplyReply(await ctx.db.apply(checked.valid), sent);
  if (!reply) return { status: "unavailable" };
  // Valid entries exist only with access, so the rows read back are the learner's to see.
  const rows = rowsToCards(await ctx.db.read([...new Set(checked.valid.map((i) => i.cardId))].sort()), cardLookup(ctx.index));
  return { status: "ok", applied: reply.applied, rejected: [...checked.rejected, ...reply.rejected], rows };
}

/**
 * getReviewAction after the session check: all the user's cards with access, nothing without
 * (the rows aren't even read, and stay in the database for when the learner has access again).
 */
export async function runReviewGet(ctx: Omit<ReviewContext, "nowMs">): Promise<ReviewGetReply> {
  if (!(await once(ctx.hasAccess)())) return { status: "ok", cards: {} };
  return { status: "ok", cards: rowsToCards(await ctx.db.readAll(), cardLookup(ctx.index)) };
}
