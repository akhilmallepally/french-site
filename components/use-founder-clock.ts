"use client";
// The founding offer's clock for the browser: the time the server rendered first (so hydration
// matches), then the browser's own clock, updated each minute and exactly at the deadline. Its own
// module, so the site-wide banner doesn't load the pricing card's checkout code.
import { useEffect, useState } from "react";

/** The time to show: `initialMs` first (as the server rendered), then the browser's clock, each minute. */
export function useFounderClock(founderEndsAt: string, initialMs: number): number {
  const [now, setNow] = useState(initialMs);
  useEffect(() => {
    setNow(Date.now());
    const timers: ReturnType<typeof setTimeout>[] = [];
    let interval: ReturnType<typeof setInterval> | undefined;
    // Tick on the minute boundary, then every minute.
    timers.push(
      setTimeout(() => {
        setNow(Date.now());
        interval = setInterval(() => setNow(Date.now()), 60_000);
      }, 60_000 - (Date.now() % 60_000)),
    );
    // And exactly at the deadline, so the offer ends on time (within the browser's own clock).
    const untilEnd = Date.parse(founderEndsAt) - Date.now();
    if (untilEnd > 0 && untilEnd < 2 ** 31 - 1) timers.push(setTimeout(() => setNow(Date.now()), untilEnd + 50));
    return () => {
      for (const t of timers) clearTimeout(t);
      if (interval) clearInterval(interval);
    };
  }, [founderEndsAt]);
  return now;
}
