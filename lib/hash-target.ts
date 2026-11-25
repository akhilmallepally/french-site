// Brings the element named by the URL's #hash into view: opens any closed <details> around it,
// scrolls it to the top (CSS scroll-margin keeps a gap), and moves keyboard focus to it. Used on
// /practice (level and unit anchors) and on lesson pages (#practice, #writing-task), on a full
// load, after a client-side navigation and on a same-page hash change. Browser only.

/** Returns true when it found the target. `focusId` focuses a different element (a heading) instead. */
export function revealHashTarget(hash: string = typeof window === "undefined" ? "" : window.location.hash, focusId?: string): boolean {
  if (typeof document === "undefined" || !hash || hash === "#") return false;
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return false;
  }
  const target = document.getElementById(id);
  if (!target) return false;
  for (let el: HTMLElement | null = target; el; el = el.parentElement) {
    if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
  }
  if (target instanceof HTMLDetailsElement && !target.open) target.open = true;
  target.scrollIntoView({ block: "start" });
  const focusEl = (focusId && document.getElementById(focusId)) || target;
  if (!focusEl.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(focusEl.tagName)) focusEl.setAttribute("tabindex", "-1");
  focusEl.focus({ preventScroll: true });
  return true;
}

/**
 * Reveals the hash target now and on every hash change; a few retries cover content that streams
 * in just after mount (a gated lesson's body). Returns the cleanup for a React effect.
 */
export function watchHashTarget(ids: readonly string[], focusFor: (id: string) => string | undefined = () => undefined): () => void {
  if (typeof window === "undefined") return () => {};
  const run = () => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!ids.includes(id) && !ids.includes("*")) return true;
    return revealHashTarget(window.location.hash, focusFor(id));
  };
  let tries = 0;
  let timer: number | undefined;
  const attempt = () => {
    if (run() || ++tries > 10) return;
    timer = window.setTimeout(attempt, 100);
  };
  attempt();
  const onHash = () => run();
  window.addEventListener("hashchange", onHash);
  return () => {
    window.removeEventListener("hashchange", onHash);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
