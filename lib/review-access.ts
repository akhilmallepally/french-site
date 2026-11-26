// The last access answer the card-text action gave this browser's signed-in learner, so /review and
// /progress can count paid cards before the server answers again. Display only: the server checks
// access on every text read and every write. Signed out is always "no access" and isn't stored.
import { storedSessionUserId } from "./supabase-session-cookie.ts";

const KEY = "parlons-review-access-v1";

/** The browser's signed-in user (an unexpired session in the cookie), or null. No network. */
export function sessionUser(): string | null {
  if (typeof document === "undefined") return null;
  return storedSessionUserId(document.cookie, process.env.NEXT_PUBLIC_SUPABASE_URL, Date.now());
}

export function rememberedAccess(userId: string | null): boolean {
  if (!userId || typeof window === "undefined") return false;
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    return saved?.userId === userId && saved.access === true;
  } catch {
    return false;
  }
}

export function rememberAccess(userId: string | null, access: boolean): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ userId, access }));
  } catch {
    // Storage blocked: counts just start without paid cards.
  }
}
