import Link from "next/link";
import { FounderBuy, FounderPrice, OfferSwitch } from "@/components/founder-offer";
import { PricingUnavailable } from "@/components/price-offer";
import type { PriceOffer } from "@/lib/pricing-offer";

interface PaywallPanelProps {
  /** From getSharedOffer for this request's time: the same rules as the pricing card and checkout. */
  offer: PriceOffer;
  /** The request's time: the countdown starts from it, then follows the browser's clock. */
  nowMs: number;
  next?: string;
}

/**
 * The paywall for a signed-in learner without access. Its copy, price and button follow the offer on
 * the page's clock (Prompt 80): the founder offer, then (at the deadline, without a reload) yearly
 * access, or "coming soon" when the yearly plan can't be sold.
 */
export function PaywallPanel({ offer, nowMs }: PaywallPanelProps) {
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card px-6 py-10 text-center sm:px-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">
        <OfferSwitch offer={offer} nowMs={nowMs} founder="Founder Lifetime Access" yearly="Yearly Access" soon="Lifetime Access" unavailable="Lifetime Access" />
      </p>
      <h2 className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">
        Continue your learning from B1 to Mastery
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-muted leading-relaxed">
        <OfferSwitch
          offer={offer}
          nowMs={nowMs}
          founder={<>You&apos;ve finished the free levels. Bravo! We hope A1 and A2 were useful. During the founding offer, B1 to C2 is a one-time payment, with all future written lessons and curriculum updates included.</>}
          yearly={<>You&apos;ve finished the free levels. Bravo! We hope A1 and A2 were useful. Yearly access opens B1 to C2, all future written lessons and curriculum updates, and the daily review.</>}
          soon={<>You&apos;ve finished the free levels. Bravo! We hope A1 and A2 were useful. The founding offer has ended, and a new plan for B1 to C2 is coming soon.</>}
        />
      </p>

      {offer.state !== "unavailable" && <FounderPrice offer={offer} nowMs={nowMs} centered />}

      <div className="mt-6 flex justify-center">
        {offer.state === "unavailable" ? (
          <PricingUnavailable id="paywall-pricing-unavailable" className="px-8" />
        ) : (
          <FounderBuy
            offer={offer}
            nowMs={nowMs}
            signedIn
            labelPrefix="Get founder access"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-8 py-2.5 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        )}
      </div>

      <p className="mt-4 text-xs text-muted">
        Try all A1 & A2 lessons free before unlocking ·{" "}
        <Link href="/pricing" className="underline underline-offset-2 hover:text-accent">
          Pricing details
        </Link>{" "}
        ·{" "}
        <Link href="/refund" className="underline underline-offset-2 hover:text-accent">
          Refund policy
        </Link>
      </p>
    </section>
  );
}
