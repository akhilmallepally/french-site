// The only way a `next` redirect target is trusted. Pure, so the server, the browser and the
// tests (lib/safe-next.test.ts) all use the same rules.

const CONTROL = /[\u0000-\u001F\u007F]/;
const MAX_LENGTH = 2048;

/**
 * Returns `next` as a same-origin path ("/lessons/b1/x?tab=1"), or "/" when it isn't safe.
 * Accepted: a relative path starting with a single "/", with no "//" or "/\" at the start
 * (also after percent-decoding), no backslash, no scheme, no control characters or newlines,
 * and that resolves to the same origin.
 */
export function safeNext(next: unknown, origin = "http://localhost"): string {
  if (typeof next !== "string" || next === "" || next.length > MAX_LENGTH) return "/";
  if (CONTROL.test(next) || next.includes("\\")) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";

  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return "/";
  }
  if (CONTROL.test(decoded) || decoded.includes("\\") || decoded.startsWith("//")) return "/";

  let base: URL;
  let url: URL;
  try {
    base = new URL(origin);
    url = new URL(next, base);
  } catch {
    return "/";
  }
  if (url.origin !== base.origin) return "/";
  return url.pathname + url.search + url.hash;
}
