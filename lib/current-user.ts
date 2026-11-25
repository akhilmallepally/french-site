import "server-only";
// Who is signed in, verified with the Supabase auth server (getUser(), never getSession()).
// Its own module, so callers that need only the user (app/actions/*) don't import lib/lessons.ts,
// which reads the content folder from disk. lib/auth.ts re-exports it.
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseEnv, warnSupabaseEnvMissing } from "@/lib/supabase/env";
import { cookies } from "next/headers";
import { connection } from "next/server";

/** A Supabase auth cookie (sb-<ref>-auth-token, or one of its .0, .1 chunks). */
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export type CurrentUser = { id: string; email: string | null };

/**
 * The signed-in user, or null. Reads cookies, so call it only inside a <Suspense> boundary.
 * Fails closed: missing config, a client error or an unreachable auth server all mean null.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    if (!getSupabaseEnv()) {
      warnSupabaseEnvMissing("getCurrentUser");
      return null;
    }
    // Signed out (no auth cookie at all): answer at once, with no Supabase client and no auth call.
    await connection();
    if (!(await cookies()).getAll().some((c) => AUTH_COOKIE.test(c.name))) return null;
    const supabase = await createClient();
    if (!supabase) return null;
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
