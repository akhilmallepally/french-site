// The outbox of the synced store (docs/plans/progress.md, section 6). Pure: no storage, no locks,
// no network. lib/progress-store.ts runs every change here under the outbox Web Lock.
//
// Per key (one exercise, one lesson or one writing task) there are at most two entries:
// - inFlight: sent and not yet confirmed. Frozen: a new answer never changes it.
// - pending: written since. New answers for the key are folded into it.
// Each outbox belongs to one user and says so; an outbox read under another user id is ignored.
import type { AnswerStatus } from "./check-answer.ts";
import type { ExerciseProgress, LessonProgress, ProgressData, WritingTaskProgress } from "./progress-core.ts";
import { applyAttempt, applyExerciseImport, applyLesson, applyWriting, lessonFromImport, lessonFromRun } from "./progress-merge.ts";
import type { Rejection, SyncItem } from "./progress-validate.ts";

export type AttemptEntry = { kind: "attempt"; seq: number; lessonId: string; exerciseId: string; result: AnswerStatus; attemptedAt: string; addAttempts: number; addCorrect: number };
/** Every run since the last send, merged by the server's rule and sent as one import-lesson entry. */
export type LessonEntry = { kind: "lesson"; seq: number; lessonId: string; record: LessonProgress };
export type WritingEntry = { kind: "writing"; seq: number; lessonId: string; exerciseId: string; checked: number[]; doneAt: string };
/** Signed-out progress imported at sign-in (section 8). Its own keys (ie:, il:, iw:), so live answers never fold into it. */
export type ImportExerciseEntry = { kind: "import-exercise"; seq: number; lessonId: string; exerciseId: string; record: ExerciseProgress };
export type ImportLessonEntry = { kind: "import-lesson"; seq: number; lessonId: string; record: LessonProgress };
export type OutboxEntry = AttemptEntry | LessonEntry | WritingEntry | ImportExerciseEntry | ImportLessonEntry;

export type Slot = { inFlight?: OutboxEntry; pending?: OutboxEntry };
export type Outbox = { v: 1; userId: string; seq: number; slots: Record<string, Slot> };

export const BATCH_MAX_ITEMS = 200; // syncProgressAction's limit (MAX_ITEMS)
export const BATCH_MAX_BYTES = 120 * 1024; // under the action's 128 KiB, leaving room for the wrapper
const MAX_ADD_ATTEMPTS = 1000; // apply_progress's limit for one attempt entry

export const emptyOutbox = (userId: string): Outbox => ({ v: 1, userId, seq: 0, slots: {} });

/** "a1-greetings-ex003" → "a1-greetings" (validate:content guarantees the prefix). */
export function lessonIdOf(exerciseId: string): string {
  return exerciseId.replace(/-ex\d+$/, "");
}

export const attemptKey = (exerciseId: string) => `e:${exerciseId}`;
export const lessonKey = (lessonId: string) => `l:${lessonId}`;
export const writingKey = (exerciseId: string) => `w:${exerciseId}`;
export const importExerciseKey = (exerciseId: string) => `ie:${exerciseId}`;
export const importLessonKey = (lessonId: string) => `il:${lessonId}`;
export const importWritingKey = (exerciseId: string) => `iw:${exerciseId}`;

const clone = (o: Outbox): Outbox => JSON.parse(JSON.stringify(o));
const later = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);

/** The latest time already used for a key, so a new entry's time can be kept strictly after it. */
export function lastTimeFor(outbox: Outbox, key: string): string | undefined {
  const slot = outbox.slots[key];
  const times = [slot?.inFlight, slot?.pending].filter(Boolean).map((e) => entryTime(e!));
  return times.length ? times.reduce(later) : undefined;
}

export function entryTime(e: OutboxEntry): string {
  if (e.kind === "attempt") return e.attemptedAt;
  if (e.kind === "writing") return e.doneAt;
  if (e.kind === "import-exercise") return e.record.lastAttemptedAt;
  return e.record.lastCompletedAt;
}

// ---------- Writes (into the pending entry, never the in-flight one) ----------

export function queueAttempt(outbox: Outbox, exerciseId: string, result: AnswerStatus, at: string): Outbox {
  const out = clone(outbox);
  const key = attemptKey(exerciseId);
  const slot = (out.slots[key] ??= {});
  const prev = slot.pending?.kind === "attempt" ? slot.pending : undefined;
  const addAttempts = Math.min((prev?.addAttempts ?? 0) + 1, MAX_ADD_ATTEMPTS);
  let addCorrect = (prev?.addCorrect ?? 0) + (result === "incorrect" ? 0 : 1);
  // The counts must agree with the last result, as apply_progress checks: never more correct than
  // attempts, and an incorrect last answer means at least one miss. (Only matters past 1,000 answers.)
  addCorrect = Math.min(addCorrect, result === "incorrect" ? addAttempts - 1 : addAttempts);
  slot.pending = { kind: "attempt", seq: prev?.seq ?? ++out.seq, lessonId: lessonIdOf(exerciseId), exerciseId, result, attemptedAt: at, addAttempts, addCorrect };
  return out;
}

export function queueRun(outbox: Outbox, lessonId: string, score: number, total: number, at: string): Outbox {
  const out = clone(outbox);
  const key = lessonKey(lessonId);
  const slot = (out.slots[key] ??= {});
  const run = lessonFromRun(score, total, at);
  const prev = slot.pending?.kind === "lesson" ? slot.pending : undefined;
  slot.pending = { kind: "lesson", seq: prev?.seq ?? ++out.seq, lessonId, record: prev ? applyLesson(prev.record, run) : run };
  return out;
}

export function queueWriting(outbox: Outbox, exerciseId: string, checked: number[], at: string): Outbox {
  const out = clone(outbox);
  const key = writingKey(exerciseId);
  const slot = (out.slots[key] ??= {});
  const prev = slot.pending;
  slot.pending = { kind: "writing", seq: prev?.seq ?? ++out.seq, lessonId: lessonIdOf(exerciseId), exerciseId, checked: [...checked], doneAt: at };
  return out;
}

// ---------- Sending ----------

/** The entry as syncProgressAction expects it, with the outbox key as its key. Never any text. */
export function toWire(key: string, e: OutboxEntry): SyncItem {
  if (e.kind === "attempt") {
    return { key, kind: "attempt", lessonId: e.lessonId, exerciseId: e.exerciseId, result: e.result, attemptedAt: e.attemptedAt, addAttempts: e.addAttempts, addCorrect: e.addCorrect };
  }
  if (e.kind === "writing") return { key, kind: "writing", lessonId: e.lessonId, exerciseId: e.exerciseId, checked: [...e.checked], doneAt: e.doneAt };
  if (e.kind === "import-exercise") {
    const x = e.record;
    return { key, kind: "import-exercise", lessonId: e.lessonId, exerciseId: e.exerciseId, lastResult: x.lastResult, lastAttemptedAt: x.lastAttemptedAt, attempts: x.attempts, correct: x.correct };
  }
  const r = e.record;
  return {
    key,
    kind: "import-lesson",
    lessonId: e.lessonId,
    bestScore: r.bestScore,
    bestTotal: r.bestTotal,
    lastRunAt: r.lastCompletedAt,
    ...(r.completedAt ? { completedAt: r.completedAt } : {}),
  };
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * Marks the next batch as in flight and returns it: every existing in-flight entry first (left by a
 * flusher that has gone, so it's sent again), then pending entries of keys with nothing in flight,
 * in the order they were written. At most BATCH_MAX_ITEMS entries and BATCH_MAX_BYTES of payload.
 */
export function takeBatch(outbox: Outbox): { outbox: Outbox; items: SyncItem[] } {
  const out = clone(outbox);
  const inFlight = Object.entries(out.slots).filter(([, s]) => s.inFlight).sort(([, a], [, b]) => a.inFlight!.seq - b.inFlight!.seq);
  const pending = Object.entries(out.slots).filter(([, s]) => !s.inFlight && s.pending).sort(([, a], [, b]) => a.pending!.seq - b.pending!.seq);
  const items: SyncItem[] = [];
  let size = bytes({ expectedUserId: out.userId, items: [] });
  for (const [key, slot] of [...inFlight, ...pending]) {
    if (items.length >= BATCH_MAX_ITEMS) break;
    const entry = slot.inFlight ?? slot.pending!;
    const wire = toWire(key, entry);
    const add = bytes(wire) + 1; // the comma
    if (size + add > BATCH_MAX_BYTES) break;
    size += add;
    items.push(wire);
    if (!slot.inFlight) {
      slot.inFlight = slot.pending;
      delete slot.pending;
    }
  }
  return { outbox: out, items };
}

/**
 * Applies an "ok" reply: applied and rejected keys lose their in-flight entry (a key's pending
 * entry, if any, is next). Keys the reply doesn't mention stay in flight and are sent again.
 */
export function settle(outbox: Outbox, applied: string[], rejected: Rejection[]): Outbox {
  const out = clone(outbox);
  for (const key of [...applied, ...rejected.map((r) => r.key)]) {
    const slot = out.slots[key];
    if (!slot) continue;
    delete slot.inFlight;
    if (!slot.pending) delete out.slots[key];
  }
  return out;
}

export const hasWork = (o: Outbox) => Object.values(o.slots).some((s) => s.inFlight || s.pending);

// ---------- The cache: server rows, then the outbox on top ----------

/** Applies one outbox entry to a snapshot by apply_progress's own rules (a resent attempt is a no-op). */
function applyEntry(data: ProgressData, e: OutboxEntry): void {
  if (e.kind === "attempt") data.exercises[e.exerciseId] = applyAttempt(data.exercises[e.exerciseId], e);
  else if (e.kind === "import-exercise") data.exercises[e.exerciseId] = applyExerciseImport(data.exercises[e.exerciseId], e.record);
  else if (e.kind === "lesson" || e.kind === "import-lesson") data.lessons[e.lessonId] = applyLesson(data.lessons[e.lessonId], e.record);
  else {
    data.writingTasks ??= {};
    data.writingTasks[e.exerciseId] = applyWriting(data.writingTasks[e.exerciseId], { done: true, checked: e.checked, doneAt: e.doneAt });
  }
}

/** The outbox's entries (in flight, then pending) applied on top of `data`, for the given keys or all. */
export function overlay(data: ProgressData, outbox: Outbox, keys?: Iterable<string>): ProgressData {
  const out: ProgressData = JSON.parse(JSON.stringify(data));
  const wanted = keys ? new Set(keys) : null;
  for (const [key, slot] of Object.entries(outbox.slots)) {
    if (wanted && !wanted.has(key)) continue;
    if (slot.inFlight) applyEntry(out, slot.inFlight);
    if (slot.pending) applyEntry(out, slot.pending);
  }
  return out;
}

/** The outbox keys of the records in `rows`. */
export function keysOfRows(rows: ProgressData): string[] {
  return [
    ...Object.keys(rows.exercises).flatMap((id) => [attemptKey(id), importExerciseKey(id)]),
    ...Object.keys(rows.lessons).flatMap((id) => [lessonKey(id), importLessonKey(id)]),
    ...Object.keys(rows.writingTasks ?? {}).flatMap((id) => [writingKey(id), importWritingKey(id)]),
  ];
}

// ---------- Importing signed-out progress (section 8) ----------

const timeOf = (t: unknown) => (typeof t === "string" ? Date.parse(t) : Number.NaN);

/**
 * Queues every signed-out record newer than `sinceMs` as an import entry (pending, in course of
 * the usual flush). Exercises become import-exercise, lessons import-lesson (completion: completedAt,
 * else the last run if the best passes), writing tasks writing entries with their ticks only, never
 * text. Malformed records are skipped. Returns the keys queued and the newest time imported.
 */
export function queueImport(outbox: Outbox, anonymous: ProgressData, sinceMs: number): { outbox: Outbox; keys: string[]; newestMs: number } {
  const out = clone(outbox);
  const keys: string[] = [];
  let newestMs = sinceMs;
  const put = (key: string, entry: OutboxEntry, ms: number) => {
    const slot = (out.slots[key] ??= {});
    slot.pending = { ...entry, seq: slot.pending?.seq ?? ++out.seq } as OutboxEntry;
    keys.push(key);
    newestMs = Math.max(newestMs, ms);
  };
  for (const [id, x] of Object.entries(anonymous.exercises ?? {})) {
    const ms = timeOf(x?.lastAttemptedAt);
    if (!(ms > sinceMs) || !Number.isInteger(x.attempts) || !Number.isInteger(x.correct) || typeof x.lastResult !== "string") continue;
    put(importExerciseKey(id), { kind: "import-exercise", seq: 0, lessonId: lessonIdOf(id), exerciseId: id, record: { ...x } }, ms);
  }
  for (const [id, l] of Object.entries(anonymous.lessons ?? {})) {
    const ms = Math.max(timeOf(l?.lastCompletedAt), timeOf(l?.completedAt));
    if (!(ms > sinceMs) || !Number.isInteger(l.bestScore) || !Number.isInteger(l.bestTotal) || typeof l.lastCompletedAt !== "string") continue;
    put(importLessonKey(id), { kind: "import-lesson", seq: 0, lessonId: id, record: lessonFromImport(l) }, ms);
  }
  for (const [id, w] of Object.entries(anonymous.writingTasks ?? {}) as [string, WritingTaskProgress][]) {
    const ms = timeOf(w?.doneAt);
    if (!(ms > sinceMs) || !w.done || !Array.isArray(w.checked)) continue;
    // Ticks and the time only. The draft text is in its own key (lib/writing-draft.ts) and never read here.
    put(importWritingKey(id), { kind: "writing", seq: 0, lessonId: lessonIdOf(id), exerciseId: id, checked: w.checked.filter((i) => Number.isInteger(i)), doneAt: w.doneAt }, ms);
  }
  return { outbox: out, keys, newestMs };
}

// ---------- Reading back from storage ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function validEntry(e: unknown): e is OutboxEntry {
  if (!isObj(e) || typeof e.seq !== "number" || typeof e.lessonId !== "string") return false;
  if (e.kind === "attempt") return typeof e.exerciseId === "string" && typeof e.attemptedAt === "string" && typeof e.addAttempts === "number" && typeof e.addCorrect === "number";
  if (e.kind === "lesson") return isObj(e.record) && typeof e.record.bestScore === "number" && typeof e.record.lastCompletedAt === "string";
  if (e.kind === "writing") return typeof e.exerciseId === "string" && Array.isArray(e.checked) && typeof e.doneAt === "string";
  if (e.kind === "import-exercise") return typeof e.exerciseId === "string" && isObj(e.record) && typeof e.record.lastAttemptedAt === "string";
  if (e.kind === "import-lesson") return isObj(e.record) && typeof e.record.bestScore === "number" && typeof e.record.lastCompletedAt === "string";
  return false;
}

/** The stored outbox for `userId`. Another user's, a corrupted one or malformed entries are dropped. */
export function parseOutbox(json: string | null, userId: string): Outbox {
  try {
    const o = JSON.parse(json ?? "null");
    if (!isObj(o) || o.v !== 1 || o.userId !== userId || !isObj(o.slots) || typeof o.seq !== "number") return emptyOutbox(userId);
    const slots: Record<string, Slot> = {};
    for (const [key, s] of Object.entries(o.slots)) {
      if (!isObj(s)) continue;
      const slot: Slot = {};
      if (validEntry(s.inFlight)) slot.inFlight = s.inFlight;
      if (validEntry(s.pending)) slot.pending = s.pending;
      if (slot.inFlight || slot.pending) slots[key] = slot;
    }
    return { v: 1, userId, seq: o.seq, slots };
  } catch {
    return emptyOutbox(userId);
  }
}
