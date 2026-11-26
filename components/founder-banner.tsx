"use client";
// The founding-offer reminder banner, at the top of every page while the offer is live (rules in
// lib/founder-banner.ts). Pages stay static: the banner reads no data on the server. It's rendered
// from fixed facts (lib/founder-constants.ts: the deadline, the prices) with no clock, and the
// layout's pre-paint script hides it before paint when it shouldn't show. After mounting:
// - the browser's clock adds "ends in 12 days" and hides it at the deadline;
// - /api/founder-offer (cached 60 s) is fetched in the background: sold out (or prices that differ)
//   hides it or corrects the text, and "ended" is remembered for the pre-paint script;
// - signed in (a session cookie), the access check runs in the background (never for signed-out
//   visitors), and the answer is remembered for the next page.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getAccessAction } from "@/app/actions/access";
import { BANNER_DISMISSED_KEY, BANNER_ENDED_KEY, bannerText, bannerVisible } from "@/lib/founder-banner";
import { FOUNDER_ENDS_AT, FOUNDER_PRICE_CENTS, YEARLY_PRICE_CENTS } from "@/lib/founder-constants";
import { rememberAccess, rememberedAccess, sessionUser } from "@/lib/review-access";

function readNumber(key: string): number | null {
  try {
    const v = parseInt(window.localStorage.getItem(key) ?? "", 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: this page only.
  }
}

type Offer = { onSale: boolean; founderCents: number; yearlyCents: number; founderEndsAt: string };

export function FounderBanner() {
  const pathname = usePathname();
  // Before mounting there's no clock: the static text and the pre-paint script's decision.
  const [now, setNow] = useState<number | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [offer, setOffer] = useState<Offer>({ onSale: true, founderCents: FOUNDER_PRICE_CENTS, yearlyCents: YEARLY_PRICE_CENTS, founderEndsAt: FOUNDER_ENDS_AT });

  // The clock: now, then each minute.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setDismissedAt(readNumber(BANNER_DISMISSED_KEY));
    let active = true;
    // Whether it's still on sale (sold out, or pricing changed): cached for everyone, never blocking.
    fetch("/api/founder-offer")
      .then((r) => (r.ok ? r.json() : null))
      .then((r: { state?: string; founderCents?: number; yearlyCents?: number; founderEndsAt?: string } | null) => {
        if (!active || !r) return;
        if (r.state === "founder" && typeof r.founderCents === "number" && typeof r.yearlyCents === "number" && typeof r.founderEndsAt === "string") {
          write(BANNER_ENDED_KEY, null);
          setOffer({ onSale: true, founderCents: r.founderCents, yearlyCents: r.yearlyCents, founderEndsAt: r.founderEndsAt });
        } else if (r.state === "ended") {
          write(BANNER_ENDED_KEY, String(Date.now()));
          setOffer((o) => ({ ...o, onSale: false }));
        }
        // "unavailable": keep the fixed facts (the deadline still applies).
      })
      .catch(() => {});
    const user = sessionUser();
    if (user) {
      setHasAccess(rememberedAccess(user));
      getAccessAction()
        .then((r) => {
          if (!active || !r.signedIn) return;
          rememberAccess(r.userId, r.access);
          setHasAccess(r.access);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, []);

  const visible = bannerVisible({ pathname, founderOnSale: offer.onSale, founderEndsAt: offer.founderEndsAt, nowMs: now, dismissedAtMs: dismissedAt, hasAccess });
  const text = bannerText(offer.founderCents, offer.yearlyCents, offer.founderEndsAt, now);
  if (!visible || !text) return null;

  const dismiss = () => {
    const t = Date.now();
    write(BANNER_DISMISSED_KEY, String(t));
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
