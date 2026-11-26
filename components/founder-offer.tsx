"use client";
// The offer in the browser: the founder price with its countdown and the buy button, which switch at
// the deadline on an open page, without a reload, to the yearly plan (Prompt 80) or, when it can't be
// sold here, to "New plan coming soon".
// - The server renders them for a time it knows (the request's, or when the shared price was read)
//   and in the deadline's own zone (Bangkok); the first browser render uses the same props, so there
//   is no hydration mismatch. After mounting, the browser's clock and time zone take over, and the
//   countdown is updated each minute (and exactly at the deadline).
// - Screen readers get one static sentence with the date; the ticking text is hidden from them, so
//   nothing is announced every minute.
// - What's for sale is still decided by the server at checkout (lib/pricing-offer.ts).
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useFounderClock } from "@/components/use-founder-clock";
import { CheckoutButton } from "@/components/checkout-button";

export { useFounderClock };
import { autoRenewLine, PriceRow, YearlyRow } from "@/components/price-offer";
import { FOUNDER_ENDS_AT } from "@/lib/founder-constants";
import {
  beforeDeadline,
  DEADLINE_ZONE,
  deadlineDate,
  endsLabel,
  formatPrice,
  offerPhase,
  timeLeft,
  yearlyOf,
  type PriceOffer,
} from "@/lib/pricing-offer";

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

const endsAtOf = (offer: PriceOffer) => (offer.state === "unavailable" ? FOUNDER_ENDS_AT : offer.founderEndsAt);

/**
 * Shows one of its server-rendered children for the offer's phase on this page's clock, so copy
 * around the price (headings, descriptions, the sign-in panel) switches with it at the deadline.
 * When pricing can't be read, `unavailable` shows; it defaults to the founder copy before the
 * deadline and the "coming soon" copy after it.
 */
export function OfferSwitch({
  offer,
  nowMs,
  founder,
  yearly,
  soon,
  unavailable,
}: {
  offer: PriceOffer;
  nowMs: number;
  founder: ReactNode;
  yearly: ReactNode;
  soon: ReactNode;
  unavailable?: ReactNode;
}) {
  const now = useFounderClock(endsAtOf(offer), nowMs);
  const phase = offerPhase(offer, now);
  if (phase === "founder") return <>{founder}</>;
  if (phase === "yearly") return <>{yearly}</>;
  if (phase === "soon") return <>{soon}</>;
  return <>{unavailable ?? (beforeDeadline(FOUNDER_ENDS_AT, now) ? founder : soon)}</>;
}

/** The countdown lines: "Founding offer ends in 12 days 4 hours" and "Ends 31 Dec, 23:59 Bangkok time". */
export function Countdown({
  founderEndsAt,
  nowMs,
  centered = false,
  switchesTo,
}: {
  founderEndsAt: string;
  nowMs: number;
  centered?: boolean;
  /** What the page shows after the deadline ("yearly" or "soon"), for tests and debugging. */
  switchesTo?: "yearly" | "soon";
}) {
  const zone = useVisitorZone();
  const left = timeLeft(founderEndsAt, nowMs);
  if (!left) return null;
  return (
    <div className={`mt-3 text-sm ${centered ? "text-center" : ""}`} data-testid="founder-countdown" data-switches-to={switchesTo}>
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

/** What's shown once the founding offer is over and the yearly plan can't be sold here. */
export function OfferEnded({ centered = false, reason }: { centered?: boolean; reason: "deadline" | "sold-out" }) {
  return (
    <div className={`mt-6 ${centered ? "text-center" : ""}`} data-testid="founder-ended">
      <p className="font-serif text-2xl font-semibold">{reason === "sold-out" ? "The founder spots are all taken." : "The founding offer has ended."}</p>
      <p className="mt-2 text-sm text-muted">New plan coming soon.</p>
    </div>
  );
}

const reasonOf = (offer: Decided): "deadline" | "sold-out" => (offer.state === "founder" ? "deadline" : offer.reason);

/**
 * The price block: the founder price with its countdown, then (at the deadline, on this clock) the
 * yearly price, or the ended state. `ribbon`: the "Founding Offer" tab on the pricing card.
 */
export function FounderPrice({ offer, nowMs, centered = false, ribbon = false }: { offer: Decided; nowMs: number; centered?: boolean; ribbon?: boolean }) {
  const now = useFounderClock(offer.founderEndsAt, nowMs);
  const phase = offerPhase(offer, now);
  const yearly = yearlyOf(offer);
  if (phase === "yearly" && yearly) return <YearlyRow terms={yearly} centered={centered} />;
  if (!liveAt(offer, now)) return <OfferEnded centered={centered} reason={reasonOf(offer)} />;
  return (
    <>
      {ribbon && (
        <div className="absolute -top-3.5 right-6 rounded-full bg-accent px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-white">
          Founding Offer
        </div>
      )}
      <PriceRow offer={offer} centered={centered} />
      <Countdown founderEndsAt={offer.founderEndsAt} nowMs={now} centered={centered} switchesTo={offer.yearly ? "yearly" : "soon"} />
    </>
  );
}

/**
 * The buy slot: while the founding offer is live, its checkout button (or, signed out, the sign-in
 * link); after the switch, "Subscribe for $12 a year" with the auto-renewal line; when nothing can be
 * sold, a disabled "New plan coming soon". The server refuses $8 after the deadline anyway.
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
  const phase = offerPhase(offer, now);
  const yearly = yearlyOf(offer);
  const base = className ?? "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-accent px-6 py-2.5 font-medium text-white transition hover:opacity-90";
  if (phase === "yearly" && yearly) {
    return <YearlyBuy cents={yearly.chargeCents} signedIn={signedIn} signInHref={signInHref} className={base} />;
  }
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

/** "Subscribe for $12 a year", with the auto-renewal disclosure right under it. */
export function YearlyBuy({ cents, signedIn, signInHref, className }: { cents: number; signedIn: boolean; signInHref: string; className: string }): ReactNode {
  return (
    <div className="flex w-full flex-col items-center">
      {signedIn ? (
        <CheckoutButton product="lessons" plan="yearly" className={className} label={`Subscribe for ${formatPrice(cents)} a year`} expectedPriceCents={cents} />
      ) : (
        <Link href={signInHref} className={className}>
          Sign in with Google to subscribe
        </Link>
      )}
      <p className="mt-2 text-center text-xs text-muted" data-testid="auto-renew">
        {autoRenewLine(cents)}
      </p>
    </div>
  );
}
