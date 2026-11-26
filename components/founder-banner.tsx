"use client";
// The founding-offer reminder banner, at the top of every page while the offer is live (rules in
// lib/founder-banner.ts). The server renders it into the static page; a pre-paint script hides it
// at once when it's dismissed or the learner is remembered to have access. After mounting:
// - dismissal and the clock come from the browser (it disappears at the deadline);
// - signed in (a session cookie), the access check runs in the background (never for signed-out
//   visitors), and the answer is remembered for the next page.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getAccessAction } from "@/app/actions/access";
import { useFounderClock } from "@/components/use-founder-clock";
import { BANNER_DISMISSED_KEY, bannerText, bannerVisible } from "@/lib/founder-banner";
import { rememberAccess, rememberedAccess, sessionUser } from "@/lib/review-access";

function readDismissed(): number | null {
  try {
    const v = parseInt(window.localStorage.getItem(BANNER_DISMISSED_KEY) ?? "", 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function FounderBanner({ founderCents, founderEndsAt, readAtMs }: { founderCents: number; founderEndsAt: string; readAtMs: number }) {
  const pathname = usePathname();
  const now = useFounderClock(founderEndsAt, readAtMs);
  // Before mounting: as the server rendered it (the pre-paint script may already hide it).
  const [mounted, setMounted] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDismissedAt(readDismissed());
    const user = sessionUser();
    if (!user) return; // signed out: no access call
    setHasAccess(rememberedAccess(user));
    let active = true;
    getAccessAction()
      .then((r) => {
        if (!active || !r.signedIn) return;
        rememberAccess(r.userId, r.access);
        setHasAccess(r.access);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const visible = bannerVisible({
    pathname,
    founderOnSale: true,
    founderEndsAt,
    nowMs: now,
    dismissedAtMs: mounted ? dismissedAt : null,
    hasAccess: mounted && hasAccess,
  });
  const text = bannerText(founderCents, founderEndsAt, now);
  if (!visible || !text) return null;

  const dismiss = () => {
    const t = Date.now();
    try {
      window.localStorage.setItem(BANNER_DISMISSED_KEY, String(t));
    } catch {
      // Storage blocked: it's hidden for this page only.
    }
    setDismissedAt(t);
  };

  return (
    <div role="region" aria-label="Founding offer" data-founder-banner-slot className="border-b border-accent/20 bg-accent/5 text-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <p>
          <span data-testid="founder-banner-text">{text}</span>{" "}
          <Link href="/pricing" className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            See pricing →
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-full px-2 py-1 font-medium text-muted underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
