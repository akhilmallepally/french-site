"use client";
// The founding offer in the browser: the price with its countdown, and the buy button, both of
// which switch to the ended state at the deadline on an open page, without a reload.
// - The server renders them for a time it knows (the request's, or when the shared price was read)
//   and in the deadline's own zone (Bangkok); the first browser render uses the same props, so there
//   is no hydration mismatch. After mounting, the browser's clock and time zone take over, and the
//   countdown is updated each minute (and exactly at the deadline).
// - Screen readers get one static sentence with the date; the ticking text is hidden from them, so
//   nothing is announced every minute.
// - Whether the offer is live is still decided by the server at checkout (lib/pricing-offer.ts).
import Link from "next/link";
import { useEffect, useState } from "react";
import { useFounderClock } from "@/components/use-founder-clock";
import { CheckoutButton } from "@/components/checkout-button";

export { useFounderClock };
import { PriceRow } from "@/components/price-offer";
import { beforeDeadline, DEADLINE_ZONE, deadlineDate, endsLabel, formatPrice, timeLeft, type PriceOffer } from "@/lib/pricing-offer";

type Decided = Exclude<PriceOffer, { state: "unavailable" }>;

/** The deadline's zone first (as the server rendered), then the visitor's own. */
function useVisitorZone(): string {
  const [zone, setZone] = useState(DEADLINE_ZONE);
  useEffect(() => {
    try {
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || DEADLINE_ZONE);
    } catch {
      // Keep Bangkok time.
    }
  }, []);
  return zone;
}

/** Live at the shown time: a founder offer whose deadline hasn't passed on this clock. */
export function liveAt(offer: Decided, nowMs: number): offer is Extract<Decided, { state: "founder" }> {
  return offer.state === "founder" && beforeDeadline(offer.founderEndsAt, nowMs);
}

/** The countdown lines: "Founding offer ends in 12 days 4 hours" and "Ends 31 Dec, 23:59 Bangkok time". */
export function Countdown({ founderEndsAt, nowMs, centered = false }: { founderEndsAt: string; nowMs: number; centered?: boolean }) {
  const zone = useVisitorZone();
  const left = timeLeft(founderEndsAt, nowMs);
  if (!left) return null;
  return (
    <div className={`mt-3 text-sm ${centered ? "text-center" : ""}`} data-testid="founder-countdown">
      <p className="sr-only">The founding offer ends on {deadlineDate(founderEndsAt)} at 23:59 Bangkok time.</p>
      <p aria-hidden="true" className="font-medium text-accent">
        Founding offer ends in <span data-testid="founder-time-left">{left}</span>
      </p>
      <p aria-hidden="true" className="mt-0.5 text-xs text-muted">
        {endsLabel(founderEndsAt, zone)}
      </p>
    </div>
  );
}

/** What's shown once the founding offer is over, until the yearly plan exists (Pricing v2, Part B). */
export function OfferEnded({ centered = false, reason }: { centered?: boolean; reason: "deadline" | "sold-out" }) {
  return (
    <div className={`mt-6 ${centered ? "text-center" : ""}`} data-testid="founder-ended">
      <p className="font-serif text-2xl font-semibold">{reason === "sold-out" ? "The founder spots are all taken." : "The founding offer has ended."}</p>
      <p className="mt-2 text-sm text-muted">New plan coming soon.</p>
    </div>
  );
}

/** The price block with its countdown, or the ended state. `ribbon`: the "Founding Offer" tab on the pricing card. */
export function FounderPrice({ offer, nowMs, centered = false, ribbon = false }: { offer: Decided; nowMs: number; centered?: boolean; ribbon?: boolean }) {
  const now = useFounderClock(offer.founderEndsAt, nowMs);
  if (!liveAt(offer, now)) return <OfferEnded centered={centered} reason={offer.state === "ended" ? offer.reason : "deadline"} />;
  return (
    <>
      {ribbon && (
        <div className="absolute -top-3.5 right-6 rounded-full bg-accent px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-white">
          Founding Offer
        </div>
      )}
      <PriceRow offer={offer} centered={centered} />
      <Countdown founderEndsAt={offer.founderEndsAt} nowMs={now} centered={centered} />
    </>
  );
}

/**
 * The buy slot: while the offer is live, the checkout button (or, signed out, the sign-in link);
 * once it has ended, a disabled "New plan coming soon". The server refuses $8 after the deadline anyway.
 */
export function FounderBuy({
  offer,
  nowMs,
  signedIn,
  signInHref = "/sign-in?next=/pricing",
  className,
  labelPrefix = "Get Founder Access",
}: {
  offer: Decided;
  nowMs: number;
  signedIn: boolean;
  signInHref?: string;
  className?: string;
  labelPrefix?: string;
}) {
  const now = useFounderClock(offer.founderEndsAt, nowMs);
  const base = className ?? "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-accent px-6 py-2.5 font-medium text-white transition hover:opacity-90";
  if (!liveAt(offer, now)) {
    return (
      <button type="button" disabled className={`${base} cursor-not-allowed opacity-60`}>
        New plan coming soon
      </button>
    );
  }
  if (!signedIn) {
    return (
      <Link href={signInHref} className={base}>
        Sign in with Google to unlock
      </Link>
    );
  }
  return <CheckoutButton product="lessons" className={base} label={`${labelPrefix} for ${formatPrice(offer.chargeCents)}`} expectedPriceCents={offer.chargeCents} />;
}
