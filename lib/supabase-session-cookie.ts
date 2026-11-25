// Reads the Supabase session that @supabase/ssr keeps in the browser's cookies, synchronously and
// without loading the Supabase client, so the progress facade can decide what to show before the
// session is known (docs/plans/progress.md, section 6). Pure: pass in document.cookie and the time.
//
// Format (@supabase/ssr 0.12, checked in node_modules): the cookie is named
// "sb-<project-ref>-auth-token", where the ref is the first label of the Supabase hostname. Long values are
// split into "<name>.0", "<name>.1", … chunks joined in order. The value is "base64-" followed by
// base64url-encoded JSON (older versions wrote the JSON as is). The JSON is the session:
// { access_token, refresh_token, expires_at (seconds), user: { id, … } }.

/** The user id of a stored session that hasn't expired yet, or null (none, expired, unreadable). */
export function storedSessionUserId(cookieHeader: string, supabaseUrl: string | undefined, nowMs: number): string | null {
  if (!supabaseUrl || !cookieHeader) return null;
  let key: string;
  try {
    key = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    try {
      cookies.set(name, decodeURIComponent(part.slice(eq + 1).trim()));
    } catch {
      cookies.set(name, part.slice(eq + 1).trim());
    }
  }
  let value = cookies.get(key) ?? null;
  if (value === null) {
    const chunks: string[] = [];
    for (let i = 0; cookies.has(`${key}.${i}`); i++) chunks.push(cookies.get(`${key}.${i}`)!);
    value = chunks.length ? chunks.join("") : null;
  }
  if (!value) return null;
  try {
    const json = value.startsWith("base64-") ? fromBase64Url(value.slice("base64-".length)) : value;
    const session = JSON.parse(json) as { expires_at?: unknown; user?: { id?: unknown } } | null;
    const expiresAt = typeof session?.expires_at === "number" ? session.expires_at * 1000 : Number.NaN;
    const id = session?.user?.id;
    return typeof id === "string" && id && expiresAt > nowMs ? id : null;
  } catch {
    return null;
  }
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
