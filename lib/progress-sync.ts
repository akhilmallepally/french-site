// What the progress server actions do, with the database passed in so it can be tested without
// Supabase (docs/plans/progress.md, section 7). app/actions/progress.ts wires it to Supabase.
// Pure apart from the injected `db`: no file reads, no lib/lessons.ts.
import type { AnswerStatus } from "./check-answer.ts";
import type { ExerciseProgress, LessonProgress, ProgressData, WritingTaskProgress } from "./progress-core.ts";
import { validateSyncPayload, type PayloadCode, type ProgressIndexData, type Rejection, type SyncItem } from "./progress-validate.ts";

// ---------- Rows as the database returns them ----------

export type LessonRow = { lesson_id: string; best_score: number; best_total: number; last_run_at: string; completed_at: string | null };
export type ExerciseRow = { exercise_id: string; attempts: number; correct_count: number; last_result: AnswerStatus; last_attempt_at: string };
export type WritingRow = { exercise_id: string; done: boolean; checked: number[]; done_at: string };
export type Rows = { lessons: LessonRow[]; exercises: ExerciseRow[]; writing: WritingRow[] };

/** The records named by a sync call, by table. */
export type RowKeys = { lessons: string[]; exercises: string[]; writing: string[] };

export interface ProgressDb {
  /** One apply_progress call with the entries in order. */
  apply(items: SyncItem[]): Promise<unknown>;
  /** The caller's rows for these ids (RLS: own rows only). */
  read(keys: RowKeys): Promise<Rows>;
}

// ---------- Replies (small status objects only) ----------

export type SyncReply =
  | { status: "ok"; applied: string[]; rejected: Rejection[]; rows: ProgressData }
  | { status: "invalid"; code: PayloadCode }
  | { status: "signed-out" }
  | { status: "wrong-user" }
  | { status: "unavailable" };

/** Database times as millisecond ISO strings ("2026-11-20T09:14:03.120Z"). Throws on an unparseable time. */
export function toIsoMs(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error("unparseable time from the database");
  return new Date(ms).toISOString();
}

/** Database rows as the client's ProgressData shape, keys sorted, times in millisecond ISO. */
export function rowsToProgress(rows: Rows): ProgressData {
  const lessons: Record<string, LessonProgress> = {};
  for (const r of [...rows.lessons].sort((a, b) => (a.lesson_id < b.lesson_id ? -1 : 1))) {
    lessons[r.lesson_id] = {
      bestScore: r.best_score,
      bestTotal: r.best_total,
      lastCompletedAt: toIsoMs(r.last_run_at),
      ...(r.completed_at ? { completedAt: toIsoMs(r.completed_at) } : {}),
    };
  }
  const exercises: Record<string, ExerciseProgress> = {};
  for (const r of [...rows.exercises].sort((a, b) => (a.exercise_id < b.exercise_id ? -1 : 1))) {
    exercises[r.exercise_id] = { attempts: r.attempts, correct: r.correct_count, lastResult: r.last_result, lastAttemptedAt: toIsoMs(r.last_attempt_at) };
  }
  const writingTasks: Record<string, WritingTaskProgress> = {};
  for (const r of [...rows.writing].sort((a, b) => (a.exercise_id < b.exercise_id ? -1 : 1))) {
    writingTasks[r.exercise_id] = { done: r.done, checked: [...r.checked].sort((a, b) => a - b), doneAt: toIsoMs(r.done_at) };
  }
  return { exercises, lessons, writingTasks };
}

/** Which rows a set of entries touches. */
export function keysOf(items: SyncItem[]): RowKeys {
  const lessons = new Set<string>();
  const exercises = new Set<string>();
  const writing = new Set<string>();
  for (const i of items) {
    if (i.kind === "run" || i.kind === "import-lesson") lessons.add(i.lessonId);
    else if (i.kind === "writing") writing.add(i.exerciseId);
    else exercises.add(i.exerciseId);
  }
  return { lessons: [...lessons].sort(), exercises: [...exercises].sort(), writing: [...writing].sort() };
}

/** apply_progress's reply, checked: only keys that were sent, in the documented shape. */
function readApplyReply(reply: unknown, sent: Set<string>): { applied: string[]; rejected: Rejection[] } | null {
  if (typeof reply !== "object" || reply === null) return null;
  const { applied, rejected } = reply as { applied?: unknown; rejected?: unknown };
  if (!Array.isArray(applied) || !Array.isArray(rejected)) return null;
  if (!applied.every((k) => typeof k === "string" && sent.has(k))) return null;
  const rows = rejected as { key?: unknown; code?: unknown }[];
  if (!rows.every((r) => typeof r?.key === "string" && sent.has(r.key) && typeof r.code === "string")) return null;
  return { applied: applied as string[], rejected: rows.map((r) => ({ key: r.key as string, code: r.code as string })) };
}

/**
 * syncProgressAction after the session check. The user id is the session's (`userId`); the
 * payload's expectedUserId is only compared with it. Entries that fail validation never reach the
 * database. After apply_progress, the stored rows for every record the valid entries name are read
 * back in the same request and returned; if that read fails the reply is "unavailable" (resending is
 * harmless: every entry is idempotent).
 */
export async function runSync(input: unknown, ctx: { userId: string; index: ProgressIndexData; nowMs: number; db: ProgressDb }): Promise<SyncReply> {
  const checked = validateSyncPayload(input, ctx.index, ctx.nowMs);
  if (!checked.ok) return { status: "invalid", code: checked.code };
  if (checked.expectedUserId !== ctx.userId) return { status: "wrong-user" };

  if (!checked.valid.length) {
    return { status: "ok", applied: [], rejected: checked.rejected, rows: { exercises: {}, lessons: {}, writingTasks: {} } };
  }
  const sent = new Set(checked.valid.map((i) => i.key));
  const reply = readApplyReply(await ctx.db.apply(checked.valid), sent);
  if (!reply) return { status: "unavailable" };
  const rows = rowsToProgress(await ctx.db.read(keysOf(checked.valid)));
  return { status: "ok", applied: reply.applied, rejected: [...checked.rejected, ...reply.rejected], rows };
}
