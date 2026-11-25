// Validates syncProgressAction input (docs/plans/progress.md, section 7). Pure: no I/O. The content
// index is passed in (the action imports lib/generated/progress-index.json as a module), so nothing
// here reads the disk or calls lib/lessons.ts.
//
// Two levels, as in the plan:
// - The payload: its shape, at most 200 entries, at most 128 KiB, unique keys, and no field an entry
//   kind doesn't define (so writing text, or anything else, is refused). Any problem rejects the
//   whole call and nothing is written.
// - Each entry: ids in the content index and in the right lesson, counts, scores and times. A bad
//   entry is rejected with a code and never sent to apply_progress; the others go ahead.
import type { AnswerStatus } from "./check-answer.ts";
import { checkTime, isValidRun } from "./progress-merge.ts";

/** The shape of lib/generated/progress-index.json (built by lib/lessons.ts buildProgressIndex). */
export type ProgressIndexData = {
  totals: { lessons: number; exercises: number; writingTasks: number };
  lessons: Record<string, { slug: string; level: string; unit: string; exercises: string[]; writingTask?: string }>;
};

export type SyncItem =
  | { key: string; kind: "attempt"; lessonId: string; exerciseId: string; result: AnswerStatus; attemptedAt: string; addAttempts: number; addCorrect: number }
  | { key: string; kind: "import-exercise"; lessonId: string; exerciseId: string; lastResult: AnswerStatus; lastAttemptedAt: string; attempts: number; correct: number }
  | { key: string; kind: "run"; lessonId: string; score: number; total: number; runAt: string }
  | { key: string; kind: "import-lesson"; lessonId: string; bestScore: number; bestTotal: number; lastRunAt: string; completedAt?: string }
  | { key: string; kind: "writing"; lessonId: string; exerciseId: string; checked: number[]; doneAt: string };

export type SyncKind = SyncItem["kind"];

/** Per-entry codes: apply_progress's own (0006) plus unknown_id, wrong_lesson and wrong_kind. */
export type EntryCode =
  | "bad_item"
  | "bad_kind"
  | "bad_time"
  | "future_time"
  | "bad_id"
  | "unknown_id"
  | "wrong_lesson"
  | "wrong_kind"
  | "bad_count"
  | "bad_result"
  | "bad_score"
  | "bad_checked";

/** Whole-payload codes: nothing is written. */
export type PayloadCode = "bad_payload" | "too_many_items" | "too_large" | "duplicate_key" | "unexpected_field";

export type Rejection = { key: string; code: EntryCode | "cap_reached" | "invalid" | string };

export type PayloadResult =
  | { ok: false; code: PayloadCode }
  | { ok: true; expectedUserId: string; valid: SyncItem[]; rejected: Rejection[] };

export const MAX_ITEMS = 200; // c_max_items in 0006
export const MAX_PAYLOAD_BYTES = 128 * 1024; // 200 entries of the largest shape fit with room to spare
const MAX_KEY = 200; // apply_progress keeps the first 200 characters
const MAX_LESSON_ID = 120;
const MAX_EXERCISE_ID = 160;
const LESSON_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESULTS: readonly AnswerStatus[] = ["correct", "correct-accents", "incorrect"];

/** Every field an entry of each kind may have. Anything else rejects the payload. */
const FIELDS: Record<SyncKind, { required: readonly string[]; optional?: readonly string[] }> = {
  attempt: { required: ["key", "kind", "lessonId", "exerciseId", "result", "attemptedAt", "addAttempts", "addCorrect"] },
  "import-exercise": { required: ["key", "kind", "lessonId", "exerciseId", "lastResult", "lastAttemptedAt", "attempts", "correct"] },
  run: { required: ["key", "kind", "lessonId", "score", "total", "runAt"] },
  "import-lesson": { required: ["key", "kind", "lessonId", "bestScore", "bestTotal", "lastRunAt"], optional: ["completedAt"] },
  // No text field, by design (C2 privacy rule): a writing entry carries ids, ticks and a time only.
  writing: { required: ["key", "kind", "lessonId", "exerciseId", "checked", "doneAt"] },
};
const KINDS = Object.keys(FIELDS) as SyncKind[];

// ---------- Times ----------

const STRICT_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * "ok", "bad_time" or "future_time". Stricter than apply_progress: at most millisecond precision
 * (what Date#toISOString writes), and a real calendar date and clock time. Never clamped.
 */
export function checkSyncTime(value: unknown, nowMs: number): "ok" | "bad_time" | "future_time" {
  if (typeof value !== "string") return "bad_time";
  const m = STRICT_TIME_RE.exec(value);
  if (!m) return "bad_time";
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth || h > 23 || mi > 59 || s > 59) return "bad_time";
  if (m[9] && (Number(m[10]) > 15 || Number(m[11]) > 59)) return "bad_time";
  return checkTime(value, nowMs);
}

// ---------- Index lookups ----------

type Lookup = { exerciseLesson: Map<string, string>; writingLesson: Map<string, string> };
const lookups = new WeakMap<ProgressIndexData, Lookup>();

function lookupFor(index: ProgressIndexData): Lookup {
  let found = lookups.get(index);
  if (!found) {
    found = { exerciseLesson: new Map(), writingLesson: new Map() };
    for (const [lessonId, lesson] of Object.entries(index.lessons)) {
      for (const id of lesson.exercises) found.exerciseLesson.set(id, lessonId);
      if (lesson.writingTask) found.writingLesson.set(lesson.writingTask, lessonId);
    }
    lookups.set(index, found);
  }
  return found;
}

// ---------- Entries ----------

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkLessonId(v: unknown, index: ProgressIndexData): EntryCode | null {
  if (typeof v !== "string" || v.length < 1 || v.length > MAX_LESSON_ID || !LESSON_RE.test(v)) return "bad_id";
  return Object.prototype.hasOwnProperty.call(index.lessons, v) ? null : "unknown_id";
}

/** The exercise must be of the right kind (graded or writing) and belong to lessonId. */
function checkExerciseId(v: unknown, lessonId: string, writing: boolean, lookup: Lookup): EntryCode | null {
  if (typeof v !== "string" || v.length < 1 || v.length > MAX_EXERCISE_ID) return "bad_id";
  if (!v.startsWith(`${lessonId}-ex`) || !/^\d{1,6}$/.test(v.slice(lessonId.length + 3))) {
    // Still tell a real exercise in another lesson apart from an id that exists nowhere.
    return (writing ? lookup.writingLesson : lookup.exerciseLesson).has(v) ? "wrong_lesson" : "bad_id";
  }
  const own = (writing ? lookup.writingLesson : lookup.exerciseLesson).get(v);
  if (own === lessonId) return null;
  if (own) return "wrong_lesson";
  return (writing ? lookup.exerciseLesson : lookup.writingLesson).has(v) ? "wrong_kind" : "unknown_id";
}

/** Counts that agree with the last result: an accepted last answer means at least one correct. */
function checkCounts(result: unknown, attempts: unknown, correct: unknown, maxAttempts: number): EntryCode | null {
  if (!isInt(attempts) || attempts < 1 || attempts > maxAttempts) return "bad_count";
  if (typeof result !== "string" || !RESULTS.includes(result as AnswerStatus)) return "bad_result";
  if (!isInt(correct) || correct < 0 || correct > attempts) return "bad_count";
  if (result !== "incorrect" && correct < 1) return "bad_count";
  if (result === "incorrect" && correct > attempts - 1) return "bad_count";
  return null;
}

function checkEntry(e: Record<string, unknown>, index: ProgressIndexData, lookup: Lookup, nowMs: number): { item?: SyncItem; code?: EntryCode } {
  const kind = e.kind as SyncKind;
  const timeField = { attempt: "attemptedAt", "import-exercise": "lastAttemptedAt", run: "runAt", "import-lesson": "lastRunAt", writing: "doneAt" }[kind];
  const time = checkSyncTime(e[timeField], nowMs);
  if (time !== "ok") return { code: time };
  const lessonCode = checkLessonId(e.lessonId, index);
  if (lessonCode) return { code: lessonCode };
  const lessonId = e.lessonId as string;
  const key = e.key as string;

  if (kind === "attempt" || kind === "import-exercise") {
    const idCode = checkExerciseId(e.exerciseId, lessonId, false, lookup);
    if (idCode) return { code: idCode };
    const exerciseId = e.exerciseId as string;
    if (kind === "attempt") {
      const c = checkCounts(e.result, e.addAttempts, e.addCorrect, 1000);
      if (c) return { code: c };
      return {
        item: { key, kind, lessonId, exerciseId, result: e.result as AnswerStatus, attemptedAt: e.attemptedAt as string, addAttempts: e.addAttempts as number, addCorrect: e.addCorrect as number },
      };
    }
    const c = checkCounts(e.lastResult, e.attempts, e.correct, 100_000);
    if (c) return { code: c };
    return {
      item: { key, kind, lessonId, exerciseId, lastResult: e.lastResult as AnswerStatus, lastAttemptedAt: e.lastAttemptedAt as string, attempts: e.attempts as number, correct: e.correct as number },
    };
  }

  if (kind === "run") {
    if (!isValidRun(e.score, e.total)) return { code: "bad_score" };
    return { item: { key, kind, lessonId, score: e.score as number, total: e.total as number, runAt: e.runAt as string } };
  }

  if (kind === "import-lesson") {
    if (!isValidRun(e.bestScore, e.bestTotal)) return { code: "bad_score" };
    const hasCompleted = e.completedAt !== undefined && e.completedAt !== null;
    if (hasCompleted) {
      const c = checkSyncTime(e.completedAt, nowMs);
      if (c !== "ok") return { code: c };
    }
    return {
      item: {
        key,
        kind,
        lessonId,
        bestScore: e.bestScore as number,
        bestTotal: e.bestTotal as number,
        lastRunAt: e.lastRunAt as string,
        ...(hasCompleted ? { completedAt: e.completedAt as string } : {}),
      },
    };
  }

  // writing
  const idCode = checkExerciseId(e.exerciseId, lessonId, true, lookup);
  if (idCode) return { code: idCode };
  const checked = e.checked;
  if (!Array.isArray(checked) || checked.length > 10 || !checked.every((i) => isInt(i) && i >= 0 && i <= 9)) return { code: "bad_checked" };
  const ticks = [...new Set(checked as number[])].sort((a, b) => a - b);
  return { item: { key, kind, lessonId, exerciseId: e.exerciseId as string, checked: ticks, doneAt: e.doneAt as string } };
}

// ---------- Payload ----------

function byteLength(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return null; // cyclic or not serializable
  }
}

/**
 * Validates `{ expectedUserId, items }`. Returns either a whole-payload code, or the valid entries
 * (rebuilt from the allowed fields only, ticks deduplicated and sorted) and the rejected ones.
 */
export function validateSyncPayload(input: unknown, index: ProgressIndexData, nowMs: number): PayloadResult {
  if (!isObject(input)) return { ok: false, code: "bad_payload" };
  for (const k of Object.keys(input)) if (k !== "expectedUserId" && k !== "items") return { ok: false, code: "unexpected_field" };
  const { expectedUserId, items } = input;
  if (typeof expectedUserId !== "string" || expectedUserId.length < 1 || expectedUserId.length > 64) return { ok: false, code: "bad_payload" };
  if (!Array.isArray(items) || items.length < 1) return { ok: false, code: "bad_payload" };
  if (items.length > MAX_ITEMS) return { ok: false, code: "too_many_items" };
  const bytes = byteLength(input);
  if (bytes === null) return { ok: false, code: "bad_payload" };
  if (bytes > MAX_PAYLOAD_BYTES) return { ok: false, code: "too_large" };

  // Shape first, for the whole payload: a key on every entry, unique, and only known fields.
  const keys = new Set<string>();
  for (const e of items) {
    if (!isObject(e) || typeof e.key !== "string" || e.key.length < 1 || e.key.length > MAX_KEY) return { ok: false, code: "bad_payload" };
    if (keys.has(e.key)) return { ok: false, code: "duplicate_key" };
    keys.add(e.key);
    // An unknown kind may carry only key and kind, so no field (writing text included) slips through.
    const spec = KINDS.includes(e.kind as SyncKind) ? FIELDS[e.kind as SyncKind] : { required: ["key", "kind"] };
    const allowed = new Set([...spec.required, ...(spec.optional ?? [])]);
    for (const k of Object.keys(e)) if (!allowed.has(k)) return { ok: false, code: "unexpected_field" };
  }

  const lookup = lookupFor(index);
  const valid: SyncItem[] = [];
  const rejected: Rejection[] = [];
  for (const e of items as Record<string, unknown>[]) {
    const key = e.key as string;
    if (!KINDS.includes(e.kind as SyncKind)) {
      rejected.push({ key, code: "bad_kind" });
      continue;
    }
    const missing = FIELDS[e.kind as SyncKind].required.some((k) => !(k in e));
    if (missing) {
      rejected.push({ key, code: "bad_item" });
      continue;
    }
    const { item, code } = checkEntry(e, index, lookup, nowMs);
    if (item) valid.push(item);
    else rejected.push({ key, code: code! });
  }
  return { ok: true, expectedUserId, valid, rejected };
}
