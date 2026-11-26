// The last access answer the server gave this browser's signed-in learner (the review actions, or
// the reminder banner's access check), so /progress and the founding-offer banner can decide what to
// show before the server answers again. Display only: the server checks access on every read, every
// write and every checkout. Signed out is always "no access" and isn't stored.
import { storedSessionUserId } from "./supabase-session-cookie.ts";

/** Also read by the banner's pre-paint script (components/founder-banner-slot.tsx). */
export const ACCESS_KEY = "parlons-access-v1";
const KEY = ACCESS_KEY;

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

/** Fired on window when a server answer changes the remembered access (a lapse or a renewal). */
export const ACCESS_CHANGED_EVENT = "parlons-access-changed";

export function rememberAccess(userId: string | null, access: boolean): void {
  if (!userId || typeof window === "undefined") return;
  const changed = rememberedAccess(userId) !== access;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ userId, access }));
  } catch {
    // Storage blocked: counts just start without paid cards.
  }
  // A page already showing the old answer (the /progress due line) updates at once.
  if (changed) window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
}

/** Calls fn whenever a server answer changes the remembered access. Returns the unsubscribe. */
export function onAccessChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ACCESS_CHANGED_EVENT, fn);
  return () => window.removeEventListener(ACCESS_CHANGED_EVENT, fn);
}
