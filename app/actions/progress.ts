"use server";
// Progress server actions (docs/plans/progress.md, section 7). Not called by the UI yet (step 4).
// - Signed in only: the user id comes from the session (getCurrentUser, which verifies the token
//   with the auth server), never from the payload. Without Supabase config there is no user, so
//   every action answers { status: "signed-out" } and touches nothing.
// - Ids are checked against lib/generated/progress-index.json, imported as a module: it's bundled
//   with the server code, so validating reads no files (and nothing here imports lib/lessons.ts).
// - Writes go only through apply_progress (0006) with the user's own session client, so RLS and the
//   function's own checks both apply. Logs carry error codes only, never inputs.
import { getCurrentUser } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/server";
import progressIndex from "@/lib/generated/progress-index.json";
import type { ProgressData } from "@/lib/progress";
import type { ProgressIndexData } from "@/lib/progress-validate";
import { rowsToProgress, runSync, type ExerciseRow, type LessonRow, type ProgressDb, type Rows, type SyncReply, type WritingRow } from "@/lib/progress-sync";

const INDEX = progressIndex as ProgressIndexData;
const PAGE = 1000; // PostgREST returns at most 1,000 rows per request by default

type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;

const LESSON_COLUMNS = "lesson_id, best_score, best_total, last_run_at, completed_at";
const EXERCISE_COLUMNS = "exercise_id, attempts, correct_count, last_result, last_attempt_at";
const WRITING_COLUMNS = "exercise_id, done, checked, done_at";

function logCode(where: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  console.warn(`[progress] ${where} failed, code:`, typeof code === "string" && code ? code : "unknown");
}

/** Every row of one table for this user, a page at a time, in primary-key order. */
async function readAll<T>(supabase: Client, table: string, columns: string, order: string, userId: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).eq("user_id", userId).order(order).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** This user's rows for the given ids (at most 200 per table, one request each). */
async function readSome<T>(supabase: Client, table: string, columns: string, idColumn: string, ids: string[], userId: string): Promise<T[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from(table).select(columns).eq("user_id", userId).in(idColumn, ids);
  if (error) throw error;
  return (data ?? []) as T[];
}

function progressDb(supabase: Client, userId: string): ProgressDb {
  return {
    async apply(items) {
      const { data, error } = await supabase.rpc("apply_progress", { p_items: items });
      if (error) throw error;
      return data;
    },
    async read(keys): Promise<Rows> {
      const [lessons, exercises, writing] = await Promise.all([
        readSome<LessonRow>(supabase, "lesson_progress", LESSON_COLUMNS, "lesson_id", keys.lessons, userId),
        readSome<ExerciseRow>(supabase, "exercise_results", EXERCISE_COLUMNS, "exercise_id", keys.exercises, userId),
        readSome<WritingRow>(supabase, "writing_task_progress", WRITING_COLUMNS, "exercise_id", keys.writing, userId),
      ]);
      return { lessons, exercises, writing };
    },
  };
}

/** The session user and their client, or a status to return as is. */
async function session(expectedUserId: unknown): Promise<{ userId: string; supabase: Client } | { status: "signed-out" | "wrong-user" | "unavailable" }> {
  const user = await getCurrentUser();
  if (!user) return { status: "signed-out" };
  if (typeof expectedUserId !== "string" || expectedUserId !== user.id) return { status: "wrong-user" };
  const supabase = await createClient();
  if (!supabase) return { status: "signed-out" };
  return { userId: user.id, supabase };
}

export type GetProgressReply = { status: "ok"; data: ProgressData } | { status: "signed-out" | "wrong-user" | "unavailable" };

/** The signed-in user's whole progress, read with RLS. Writes nothing. */
export async function getProgressAction(expectedUserId: string): Promise<GetProgressReply> {
  const s = await session(expectedUserId);
  if ("status" in s) return s;
  try {
    const [lessons, exercises, writing] = await Promise.all([
      readAll<LessonRow>(s.supabase, "lesson_progress", LESSON_COLUMNS, "lesson_id", s.userId),
      readAll<ExerciseRow>(s.supabase, "exercise_results", EXERCISE_COLUMNS, "exercise_id", s.userId),
      readAll<WritingRow>(s.supabase, "writing_task_progress", WRITING_COLUMNS, "exercise_id", s.userId),
    ]);
    return { status: "ok", data: rowsToProgress({ lessons, exercises, writing }) };
  } catch (error) {
    logCode("getProgress", error);
    return { status: "unavailable" };
  }
}

/**
 * Applies up to 200 entries. Returns { status: "ok", applied, rejected, rows }, where rows are the
 * server's stored records for every record the valid entries name, read back in the same request
 * (step 4: the cache replaces those records with these; the server wins on ties).
 */
export async function syncProgressAction(input: unknown): Promise<SyncReply> {
  const expected = typeof input === "object" && input !== null ? (input as { expectedUserId?: unknown }).expectedUserId : undefined;
  const s = await session(expected);
  if ("status" in s) return s;
  try {
    return await runSync(input, { userId: s.userId, index: INDEX, nowMs: Date.now(), db: progressDb(s.supabase, s.userId) });
  } catch (error) {
    logCode("sync", error);
    return { status: "unavailable" };
  }
}

export type ResetReply = { status: "ok" } | { status: "signed-out" | "wrong-user" | "unavailable" | "invalid" };

/** Deletes the user's progress rows in the three tables. Needs { confirm: "reset" }. No UI calls it yet. */
export async function resetProgressAction(input: { expectedUserId: string; confirm: "reset" }): Promise<ResetReply> {
  if (input?.confirm !== "reset") return { status: "invalid" };
  const s = await session(input.expectedUserId);
  if ("status" in s) return s;
  try {
    for (const table of ["exercise_results", "lesson_progress", "writing_task_progress"]) {
      const { error } = await s.supabase.from(table).delete().eq("user_id", s.userId);
      if (error) throw error;
    }
    return { status: "ok" };
  } catch (error) {
    logCode("reset", error);
    return { status: "unavailable" };
  }
}
