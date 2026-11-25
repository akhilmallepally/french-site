"use server";
// Progress server actions (docs/plans/progress.md, section 7), called by the synced store
// (lib/progress-store.ts) when NEXT_PUBLIC_PROGRESS_SYNC is "on".
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
import type { ProgressData } from "@/lib/progress-core";
import { deleteAllRows, progressDb, readAllRows } from "@/lib/progress-db";
import type { ProgressIndexData } from "@/lib/progress-validate";
import { rowsToProgress, runSync, type SyncReply } from "@/lib/progress-sync";

const INDEX = progressIndex as ProgressIndexData;

type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;

function logCode(where: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  console.warn(`[progress] ${where} failed, code:`, typeof code === "string" && code ? code : "unknown");
}

/** The session user and their client, or a status to return as is. */
async function session(expectedUserId: unknown): Promise<{ userId: string; supabase: Client } | { status: "signed-out" | "wrong-user" }> {
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
    return { status: "ok", data: rowsToProgress(await readAllRows(s.supabase, s.userId)) };
  } catch (error) {
    logCode("getProgress", error);
    return { status: "unavailable" };
  }
}

/**
 * Applies up to 200 entries. Returns { status: "ok", applied, rejected, rows }, where rows are the
 * server's stored records for every record the valid entries name, read back in the same request
 * (the store's cache replaces those records with these; the server wins on ties).
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
    await deleteAllRows(s.supabase, s.userId);
    return { status: "ok" };
  } catch (error) {
    logCode("reset", error);
    return { status: "unavailable" };
  }
}
