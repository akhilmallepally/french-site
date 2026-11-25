import Link from "next/link";
import { CheckoutButton } from "@/components/checkout-button";
import { PriceRow, PricingUnavailable } from "@/components/price-offer";
import { formatPrice, type PriceOffer } from "@/lib/pricing-offer";

interface PaywallPanelProps {
  /** From getPriceOffer(getActivePricing()), the same source as the pricing card and checkout. */
  offer: PriceOffer;
  next?: string;
}

export function PaywallPanel({ offer }: PaywallPanelProps) {
  const isFounder = offer.state === "founder";

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card px-6 py-10 text-center sm:px-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">
        {isFounder ? "Founder Lifetime Access" : "Lifetime Access"}
      </p>
      <h2 className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">
        Continue your learning from B1 to Mastery
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-muted leading-relaxed">
        You&apos;ve finished the free levels. Bravo! We hope A1 and A2 were useful. B1 to C2 is a one-time
        payment, with all future written lessons and curriculum updates included.
      </p>

      {offer.state !== "unavailable" && <PriceRow offer={offer} centered />}

      <div className="mt-6 flex justify-center">
        {offer.state === "unavailable" ? (
          <PricingUnavailable id="paywall-pricing-unavailable" className="px-8" />
        ) : (
          <CheckoutButton
            product="lessons"
            label={`${isFounder ? "Get founder access" : "Get lifetime access"} for ${formatPrice(offer.chargeCents)}`}
            expectedPriceCents={offer.chargeCents}
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
