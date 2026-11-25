// Progress merge rules (docs/plans/progress.md, sections 7 and 8). Pure TypeScript, no I/O.
//
// Two families of functions:
// - apply*(stored, entry): exactly what apply_progress (supabase/migrations/0006_progress_sync.sql)
//   does to a stored row, including "a tie keeps the stored row". Use these to predict the server's
//   result (the store's cache, step 4).
// - merge*(a, b): the same rules made symmetric with a fixed tie-break, so merging is commutative,
//   associative and idempotent (outbox coalescing, combining snapshots). They differ from apply*
//   only on exact ties, where the server keeps whichever row it stored first.
//
// Times are never clamped: a time is accepted as sent or rejected (more than 24 hours ahead).
import type { AnswerStatus } from "./check-answer.ts";
import type { ExerciseProgress, LessonProgress, ProgressData, WritingTaskProgress } from "./progress.ts";

// ---------- Validation shared with apply_progress ----------

/** apply_progress rejects a time more than this far ahead of server time ("future_time"). */
export const MAX_AHEAD_MS = 24 * 60 * 60 * 1000;
/** The same pattern as c_time_re in 0006: ISO 8601 with seconds and a time zone. */
const TIME_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$/;

/** Milliseconds since the epoch, or null when the text isn't a time apply_progress would parse. */
export function parseTime(iso: unknown): number | null {
  if (typeof iso !== "string" || !TIME_RE.test(iso)) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export type TimeCheck = "ok" | "bad_time" | "future_time";

/** "ok" for any valid time up to exactly 24 hours ahead of `nowMs`; past times are always fine. */
export function checkTime(iso: unknown, nowMs: number): TimeCheck {
  const ms = parseTime(iso);
  if (ms === null) return "bad_time";
  return ms > nowMs + MAX_AHEAD_MS ? "future_time" : "ok";
}

/** A run or imported best: whole numbers, 1 ≤ total ≤ 1,000 and 0 ≤ score ≤ total. */
export function isValidRun(score: unknown, total: unknown): boolean {
  return (
    Number.isInteger(score) &&
    Number.isInteger(total) &&
    (total as number) >= 1 &&
    (total as number) <= 1000 &&
    (score as number) >= 0 &&
    (score as number) <= (total as number)
  );
}

/** The pass mark, score / total ≥ 0.8, in integers as in 0006 (same result as isCompleted). */
export function passes(score: number, total: number): boolean {
  return score * 5 >= total * 4;
}

/** True when a's ratio is strictly higher than b's, compared without division. */
export function beats(a: { bestScore: number; bestTotal: number }, b: { bestScore: number; bestTotal: number }): boolean {
  return a.bestScore * b.bestTotal > b.bestScore * a.bestTotal;
}

// ---------- Small helpers ----------

const earlier = (a: string | undefined, b: string | undefined): string | undefined => {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return compareTimes(a, b) <= 0 ? a : b;
};

const later = (a: string, b: string): string => (compareTimes(a, b) >= 0 ? a : b);

/** By instant, then by text, so two spellings of the same instant still order the same way. */
function compareTimes(a: string, b: string): number {
  const d = (parseTime(a) ?? Date.parse(a)) - (parseTime(b) ?? Date.parse(b));
  if (d !== 0 && Number.isFinite(d)) return d;
  return a < b ? -1 : a > b ? 1 : 0;
}

const withCompleted = (p: Omit<LessonProgress, "completedAt">, completedAt: string | undefined): LessonProgress =>
  completedAt === undefined ? { ...p } : { ...p, completedAt };

// ---------- Lessons (run, import-lesson) ----------

/** A finished run as a lesson record: completed at its own time if it passes. */
export function lessonFromRun(score: number, total: number, runAt: string): LessonProgress {
  return withCompleted({ bestScore: score, bestTotal: total, lastCompletedAt: runAt }, passes(score, total) ? runAt : undefined);
}

/**
 * An imported local record: completed only if its best passes, at completedAt when present,
 * otherwise at its last run (the best date the old format has). As in 0006.
 */
export function lessonFromImport(local: LessonProgress): LessonProgress {
  const done = passes(local.bestScore, local.bestTotal) ? (local.completedAt ?? local.lastCompletedAt) : undefined;
  return withCompleted({ bestScore: local.bestScore, bestTotal: local.bestTotal, lastCompletedAt: local.lastCompletedAt }, done);
}

/** apply_progress on lesson_progress: best by ratio (a tie keeps the stored row), later run, earlier completion. */
export function applyLesson(stored: LessonProgress | undefined, entry: LessonProgress): LessonProgress {
  if (!stored) return withCompleted(entry, entry.completedAt);
  const best = beats(entry, stored) ? entry : stored;
  return withCompleted(
    { bestScore: best.bestScore, bestTotal: best.bestTotal, lastCompletedAt: later(stored.lastCompletedAt, entry.lastCompletedAt) },
    earlier(stored.completedAt, entry.completedAt),
  );
}

/** Symmetric: on a ratio tie (4/5 and 8/10) the larger total wins, whichever side it's on. */
export function mergeLessons(a: LessonProgress, b: LessonProgress): LessonProgress {
  const best = beats(a, b) ? a : beats(b, a) ? b : a.bestTotal >= b.bestTotal ? a : b;
  return withCompleted(
    { bestScore: best.bestScore, bestTotal: best.bestTotal, lastCompletedAt: later(a.lastCompletedAt, b.lastCompletedAt) },
    earlier(a.completedAt, b.completedAt),
  );
}

// ---------- Exercises (import-exercise) ----------

// Only used to break an exact tie on time, so the merge doesn't depend on argument order.
const RESULT_RANK: Record<AnswerStatus, number> = { correct: 2, "correct-accents": 1, incorrect: 0 };

const exercise = (counts: { attempts: number; correct: number }, newer: ExerciseProgress): ExerciseProgress => ({
  attempts: counts.attempts,
  correct: counts.correct,
  lastResult: newer.lastResult,
  lastAttemptedAt: newer.lastAttemptedAt,
});

/** apply_progress for import-exercise: max of each count; result and time from the strictly newer side (a tie keeps the stored one). */
export function applyExerciseImport(stored: ExerciseProgress | undefined, entry: ExerciseProgress): ExerciseProgress {
  if (!stored) return { ...entry };
  const newer = compareTimes(entry.lastAttemptedAt, stored.lastAttemptedAt) > 0 ? entry : stored;
  return exercise({ attempts: Math.max(stored.attempts, entry.attempts), correct: Math.max(stored.correct, entry.correct) }, newer);
}

/** Symmetric: on an equal time, the higher result (correct > correct-accents > incorrect) wins. */
export function mergeExercises(a: ExerciseProgress, b: ExerciseProgress): ExerciseProgress {
  const t = compareTimes(a.lastAttemptedAt, b.lastAttemptedAt);
  const newer = t > 0 ? a : t < 0 ? b : RESULT_RANK[a.lastResult] >= RESULT_RANK[b.lastResult] ? a : b;
  return exercise({ attempts: Math.max(a.attempts, b.attempts), correct: Math.max(a.correct, b.correct) }, newer);
}

// ---------- Writing tasks ----------

/** apply_progress for writing: the strictly later doneAt wins whole; an equal time keeps the stored record. */
export function applyWriting(stored: WritingTaskProgress | undefined, entry: WritingTaskProgress): WritingTaskProgress {
  if (!stored) return { ...entry, checked: [...entry.checked] };
  const winner = compareTimes(entry.doneAt, stored.doneAt) > 0 ? entry : stored;
  return { ...winner, checked: [...winner.checked] };
}

/** Compares tick lists element by element, then by length. */
function compareChecked(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Symmetric: on an equal doneAt, the record with the greater tick list (compared in order) wins. */
export function mergeWriting(a: WritingTaskProgress, b: WritingTaskProgress): WritingTaskProgress {
  const t = compareTimes(a.doneAt, b.doneAt);
  const winner = t > 0 ? a : t < 0 ? b : compareChecked(a.checked, b.checked) >= 0 ? a : b;
  return { ...winner, checked: [...winner.checked] };
}

// ---------- Whole snapshots ----------

function mergeMaps<T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined, merge: (x: T, y: T) => T): Record<string, T> {
  const out: Record<string, T> = {};
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();
  for (const k of keys) {
    const x = a?.[k];
    const y = b?.[k];
    out[k] = x !== undefined && y !== undefined ? merge(x, y) : merge((x ?? y)!, (x ?? y)!);
  }
  return out;
}

/** Merges two snapshots record by record. Commutative, associative and idempotent; keys come out sorted. */
export function mergeProgress(a: ProgressData, b: ProgressData): ProgressData {
  const out: ProgressData = {
    exercises: mergeMaps(a.exercises, b.exercises, mergeExercises),
    lessons: mergeMaps(a.lessons, b.lessons, mergeLessons),
  };
  if (a.writingTasks !== undefined || b.writingTasks !== undefined) {
    out.writingTasks = mergeMaps(a.writingTasks, b.writingTasks, mergeWriting);
  }
  return out;
}
