import { formatPrice, PRICING_UNAVAILABLE_MESSAGE, TAX_ADDED_AT_CHECKOUT, type PriceOffer, type YearlyTerms } from "@/lib/pricing-offer";

type FounderOffer = Extract<PriceOffer, { state: "founder" }>;

/** The yearly plan's terms, under its price (docs/plans/subscription.md, section 5). */
export const YEARLY_TERMS_LINE = "Renews yearly until you cancel. Cancel any time; access runs to the end of the paid year.";

/** The auto-renewal disclosure next to the subscribe button (section 6). */
export function autoRenewLine(cents: number): string {
  return `Renews automatically at ${formatPrice(cents)} a year until you cancel.`;
}

/**
 * The yearly price block, after the switch: "$12 a year", shown the way the founder price is shown,
 * with "plus tax where applicable" while tax is added at checkout, and the renewal terms.
 */
export function YearlyRow({ terms, centered = false }: { terms: YearlyTerms; centered?: boolean }) {
  const justify = centered ? "justify-center" : "";
  return (
    <div data-testid="yearly-offer">
      <div className={`mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-2 ${justify}`}>
        <span className="font-serif text-4xl font-semibold" data-testid="yearly-price">
          {formatPrice(terms.chargeCents)}
        </span>
        <span className="text-sm text-muted">
          a year{TAX_ADDED_AT_CHECKOUT ? " · plus tax where applicable" : ""}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">{YEARLY_TERMS_LINE}</p>
    </div>
  );
}

/**
 * The founder price block used by the pricing card and the lesson paywall: the price, "one-time ·
 * lifetime access", the spots line, and the honest comparison with what comes after ("From 1
 * January: $12 per year."). It's only rendered while the founder offer is live. No struck-through
 * "regular" price: after the founding offer there is no lifetime price to compare with.
 */
export function PriceRow({ offer, centered = false }: { offer: FounderOffer; centered?: boolean }) {
  const justify = centered ? "justify-center" : "";
  return (
    <>
      <div className={`mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-2 ${justify}`}>
        <span className="font-serif text-4xl font-semibold">{formatPrice(offer.chargeCents)}</span>
        <span className="text-sm text-muted">one-time · lifetime access</span>
      </div>
      <p className="mt-2 text-sm text-muted">Founder price for the first {offer.founderCap} learners.</p>
      <p className="mt-1 text-sm text-muted" data-testid="yearly-comparison">
        From 1 January: {formatPrice(offer.yearlyCents)} per year.
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
