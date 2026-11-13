// The two public Supabase settings, or null when either is missing or empty. Used by the proxy and
// both clients so a missing variable means "signed out" everywhere instead of a crash.
// The variables are written out in full so Next.js can inline them into the browser bundle.
export type SupabaseEnv = { url: string; key: string };

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

let warned = false;

/** Logs one warning per process when Supabase isn't configured. */
export function warnSupabaseEnvMissing(where: string): void {
  if (warned) return;
  warned = true;
  console.warn(
    `[supabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing (${where}). ` +
      "Sessions are skipped and gated lessons stay locked.",
  );
}
