// Whether the signed-in learner has access, as the database decides it: public.has_access()
// (migration 0010), called with the learner's own session client. One rule, in one place:
//   - an active lifetime purchase (refunded and disputed don't count; duplicates are fine); or
//   - a subscription that is active or past_due, until current_period_end plus the 7-day grace; or
//   - a subscription cancelled at the period end, until current_period_end (no grace after it).
// has_access() is security invoker and reads auth.uid(), so it can only ever answer for the session's
// own user. No time is sent: the database's clock decides (tests inject one through p_now).
// Pure apart from the client passed in, so lib/access.test.ts tests it with a fake. The only caller
// in the app is hasActiveEntitlement, in lib/purchases.ts.

/** The part of a Supabase client the check needs. */
export type AccessClient = {
  rpc(fn: "has_access", args: { p_product: string }): PromiseLike<{ data: unknown; error: unknown }>;
};

/** The error's code (a Postgres/PostgREST code, or its name), never its message. */
function codeOf(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === "string" && code) return code;
    if (typeof name === "string" && name) return name;
  }
  return "unknown";
}

/**
 * "yes" or "no" as has_access() answers, or "unknown" when it couldn't answer (an error, a network
 * failure, or anything but a boolean). Unknown is never "no" where money is involved (Prompt 80):
 * checkout refuses, and pages show "Couldn't check your access" with a Retry button, never the buy
 * paywall and never paid content.
 */
export type AccessState = "yes" | "no" | "unknown";

export async function checkAccess(client: AccessClient, product: string, onError?: (code: string) => void): Promise<AccessState> {
  try {
    const { data, error } = await client.rpc("has_access", { p_product: product });
    if (error) {
      onError?.(codeOf(error));
      return "unknown";
    }
    if (data === true) return "yes";
    if (data === false) return "no";
    onError?.("not_boolean");
    return "unknown";
  } catch (error) {
    onError?.(codeOf(error));
    return "unknown";
  }
}
