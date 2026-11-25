// The progress tables through a Supabase client signed in as the user (RLS applies). Shared by
// app/actions/progress.ts (the cookie session) and scripts/check-progress-db.ts (a test account),
// so the check exercises the same queries the action runs. No file reads, no Next.js imports.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExerciseRow, LessonRow, ProgressDb, Rows, WritingRow } from "./progress-sync.ts";

const PAGE = 1000; // PostgREST returns at most 1,000 rows per request by default

const LESSON_COLUMNS = "lesson_id, best_score, best_total, last_run_at, completed_at";
const EXERCISE_COLUMNS = "exercise_id, attempts, correct_count, last_result, last_attempt_at";
const WRITING_COLUMNS = "exercise_id, done, checked, done_at";

/** Every row of one table for this user, a page at a time, in primary-key order. */
async function readAll<T>(supabase: SupabaseClient, table: string, columns: string, order: string, userId: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).eq("user_id", userId).order(order).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** This user's rows for the given ids (at most 200 per table in one call). */
async function readSome<T>(supabase: SupabaseClient, table: string, columns: string, idColumn: string, ids: string[], userId: string): Promise<T[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from(table).select(columns).eq("user_id", userId).in(idColumn, ids);
  if (error) throw error;
  return (data ?? []) as T[];
}

/** apply_progress and the read-back, for runSync. */
export function progressDb(supabase: SupabaseClient, userId: string): ProgressDb {
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

/** All of the user's progress rows. */
export async function readAllRows(supabase: SupabaseClient, userId: string): Promise<Rows> {
  const [lessons, exercises, writing] = await Promise.all([
    readAll<LessonRow>(supabase, "lesson_progress", LESSON_COLUMNS, "lesson_id", userId),
    readAll<ExerciseRow>(supabase, "exercise_results", EXERCISE_COLUMNS, "exercise_id", userId),
    readAll<WritingRow>(supabase, "writing_task_progress", WRITING_COLUMNS, "exercise_id", userId),
  ]);
  return { lessons, exercises, writing };
}

/** Deletes the user's rows in the three progress tables (delete grants kept in 0006). */
export async function deleteAllRows(supabase: SupabaseClient, userId: string): Promise<void> {
  for (const table of ["exercise_results", "lesson_progress", "writing_task_progress"]) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error) throw error;
  }
}
