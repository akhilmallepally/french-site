import { formatPrice, PRICING_UNAVAILABLE_MESSAGE, type PriceOffer } from "@/lib/pricing-offer";

type AvailableOffer = Exclude<PriceOffer, { state: "unavailable" }>;

/**
 * The price block used by the pricing card and the lesson paywall. While the founder discount runs:
 * the founder price, the struck standard price, a "Save N%" badge and the founder line. Otherwise
 * the one price checkout charges. Screen readers hear "Regular price $12, now $8." once.
 */
export function PriceRow({ offer, centered = false }: { offer: AvailableOffer; centered?: boolean }) {
  const founder = formatPrice(offer.founderCents);
  const standard = formatPrice(offer.standardCents);
  const justify = centered ? "justify-center" : "";

  if (!offer.showDiscount) {
    return (
      <div className={`mt-6 flex items-baseline gap-2 ${justify}`}>
        <span className="font-serif text-4xl font-semibold">{formatPrice(offer.chargeCents)}</span>
        <span className="text-sm text-muted">one-time · lifetime access</span>
      </div>
    );
  }

  return (
    <>
      <div className={`mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-2 ${justify}`}>
        <span className="sr-only">
          Regular price {standard}, now {founder}.
        </span>
        <span aria-hidden="true" className="flex items-baseline gap-3">
          <span className="font-serif text-4xl font-semibold">{founder}</span>
          <s className="font-serif text-2xl text-muted">{standard}</s>
        </span>
        <span className="self-center rounded-full border border-accent bg-card px-2.5 py-0.5 text-xs font-semibold text-accent">
          Save {offer.savePercent}%
        </span>
        <span className="text-sm text-muted">one-time · lifetime access</span>
      </div>
      <p className="mt-2 text-sm text-muted">
        Founder price for the first {offer.founderCap} learners, then {standard}.
      </p>
    </>
  );
}

/** Shown in place of the buy button when the price can't be read. Nothing can be bought. */
export function PricingUnavailable({ id, className = "w-full" }: { id: string; className?: string }) {
  return (
    <div>
      <button
        type="button"
        disabled
        aria-describedby={id}
        className={`inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-full bg-accent px-6 py-2.5 font-medium text-white opacity-60 ${className}`}
      >
        Get Lifetime Access
      </button>
      <p id={id} className="mt-3 text-center text-sm text-muted">
        {PRICING_UNAVAILABLE_MESSAGE}
      </p>
    </div>
  );
}
