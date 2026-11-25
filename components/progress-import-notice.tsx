"use client";

import { useEffect, useState } from "react";
import { progressStore } from "@/lib/progress";

/**
 * The one-time line after this browser's signed-out progress was added to the learner's account
 * (docs/plans/progress.md, section 8, decision 7). Shown once, only after an import with at least
 * one confirmed entry; never for an empty import, and never with sync off (the local store has none).
 * Fixed to the bottom of the screen, so appearing shifts nothing. Esc or the button closes it.
 */
export function ProgressImportNotice() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const check = () =>
      progressStore.importNotice().then((notice) => {
        if (!active || !notice) return;
        setText(notice.text);
        void progressStore.markImportNoticeShown(); // once: it won't come back on the next page
      });
    void check();
    const unsubscribe = progressStore.subscribe(() => void check());
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!text) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setText(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [text]);

  if (!text) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex max-w-lg items-center gap-4 rounded-2xl border border-border bg-card px-5 py-3 text-sm text-foreground shadow-md"
      >
        <p>{text}</p>
        <button
          type="button"
          onClick={() => setText(null)}
          className="shrink-0 rounded-full px-3 py-1 font-medium text-accent hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
