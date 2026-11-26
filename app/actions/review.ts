"use server";
// Daily-review server actions (docs/plans/review.md, rollout step 4), called by the synced review
// store (lib/review-sync-store.ts) when NEXT_PUBLIC_REVIEW_SYNC is "on". The same pattern as
// app/actions/progress.ts:
// - Signed in only: the user comes from the session (getCurrentUser), never from the payload.
//   Without Supabase config there is no user, so every action answers { status: "signed-out" }.
// - Card ids are checked against lib/generated/review-card-ids.json, imported as a module (ids and
//   levels only, no card text; nothing here reads files or imports lib/lessons.ts).
// - Every card needs access (hasActiveEntitlement: a lifetime purchase or a subscription in its paid period),
//   checked at most once per call: without it, writes are rejected per entry (no_access) and reads
//   return no cards. Stored rows are kept, so a learner who pays later gets them back.
// - Writes go only through apply_review (0008) with the user's own session client. Logs carry error
//   codes only, never inputs.
import { getCurrentUser } from "@/lib/current-user";
import cardIds from "@/lib/generated/review-card-ids.json";
import { hasActiveEntitlement } from "@/lib/purchases";
import { createClient } from "@/lib/supabase/server";
import type { ReviewIdIndex } from "@/lib/review-catalogue";
import { reviewDb } from "@/lib/review-db";
import { runReviewGet, runReviewSync, type ReviewGetReply, type ReviewSyncReply } from "@/lib/review-sync";

const INDEX = cardIds as ReviewIdIndex;

type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;

function logCode(where: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  console.warn(`[review] ${where} failed, code:`, typeof code === "string" && code ? code : "unknown");
}

async function session(expectedUserId: unknown): Promise<{ userId: string; supabase: Client } | { status: "signed-out" | "wrong-user" }> {
  const user = await getCurrentUser();
  if (!user) return { status: "signed-out" };
  if (typeof expectedUserId !== "string" || expectedUserId !== user.id) return { status: "wrong-user" };
  const supabase = await createClient();
  if (!supabase) return { status: "signed-out" };
  return { userId: user.id, supabase };
}

/** Thrown when the access check failed: the action answers "unavailable", so nothing is rejected or dropped. */
class AccessUnknownError extends Error {
  readonly code = "access_unknown";
}

// "unknown" is never "no" (Prompt 80): a "no_access" rejection would drop the entry from the outbox
// for good, so the call fails as "unavailable" instead and the store retries later.
const accessFor = (userId: string) => async () => {
  const state = await hasActiveEntitlement(userId, "lessons");
  if (state === "unknown") throw new AccessUnknownError("access check failed");
  return state === "yes";
};

/** The signed-in user's cards, read with RLS; paid-level cards only with access. Writes nothing. */
export async function getReviewAction(expectedUserId: string): Promise<ReviewGetReply> {
  const s = await session(expectedUserId);
  if ("status" in s) return s;
  try {
    return await runReviewGet({ userId: s.userId, index: INDEX, db: reviewDb(s.supabase, s.userId), hasAccess: accessFor(s.userId) });
  } catch (error) {
    logCode("get", error);
    return { status: "unavailable" };
  }
}

/** Applies up to 200 card states. Returns { status, applied, rejected, rows }, rows read back in the same request. */
export async function syncReviewAction(input: unknown): Promise<ReviewSyncReply> {
  const expected = typeof input === "object" && input !== null ? (input as { expectedUserId?: unknown }).expectedUserId : undefined;
  const s = await session(expected);
  if ("status" in s) return s;
  try {
    return await runReviewSync(input, { userId: s.userId, index: INDEX, nowMs: Date.now(), db: reviewDb(s.supabase, s.userId), hasAccess: accessFor(s.userId) });
  } catch (error) {
    logCode("sync", error);
    return { status: "unavailable" };
  }
}

export type ReviewResetReply = { status: "ok" } | { status: "signed-out" | "wrong-user" | "unavailable" | "invalid" };

/** Deletes the user's review cards. Needs { confirm: "reset" }. No UI calls it yet. */
export async function resetReviewAction(input: { expectedUserId: string; confirm: "reset" }): Promise<ReviewResetReply> {
  if (input?.confirm !== "reset") return { status: "invalid" };
  const s = await session(input.expectedUserId);
  if ("status" in s) return s;
  try {
    await reviewDb(s.supabase, s.userId).deleteAll();
    return { status: "ok" };
  } catch (error) {
    logCode("reset", error);
    return { status: "unavailable" };
  }
}
