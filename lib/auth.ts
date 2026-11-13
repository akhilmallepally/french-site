import "server-only";
// The real access check for gated lessons. Server-only: it reads the session cookie and asks the
// Supabase auth server who the user is with getUser(), which verifies the token. Never use
// getSession(), client auth state or proxy.ts as the check.
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { warnSupabaseEnvMissing } from "@/lib/supabase/env";
import { isFreeLevel, type LessonAccess, type LessonMeta } from "@/lib/lessons";

export type CurrentUser = { id: string; email: string | null };

/**
 * The signed-in user, or null. Reads cookies, so call it only inside a <Suspense> boundary.
 * Fails closed: missing config, a client error or an unreachable auth server all mean null.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const supabase = await createClient();
    if (!supabase) {
      warnSupabaseEnvMissing("getCurrentUser");
      return null;
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch (error) {
    // Let Next.js's own control-flow errors (request-time bail-outs during prerendering) through.
    unstable_rethrow(error);
    console.warn("[supabase] getUser failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Access to an A1 or A2 lesson. Reads no request data, so free lessons stay prerendered. */
export function grantFreeAccess(meta: LessonMeta): LessonAccess {
  if (!isFreeLevel(meta.level)) throw new Error(`${meta.id} is not in a free level`);
  return { grant: "lesson-access", lessonId: meta.id };
}

/** Access to any lesson: free levels always, other levels only for a signed-in user. */
export async function grantLessonAccess(meta: LessonMeta): Promise<LessonAccess | null> {
  if (isFreeLevel(meta.level)) return grantFreeAccess(meta);
  const user = await getCurrentUser();
  return user ? { grant: "lesson-access", lessonId: meta.id } : null;
}
