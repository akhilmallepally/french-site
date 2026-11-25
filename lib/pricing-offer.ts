// The one place that turns pricing data into what learners see and what checkout charges, so the
// pricing card, the lesson paywall, the sign-in panel and createCheckoutAction can never disagree.
// Pure: no I/O and no server-only imports, so it can be unit-tested (lib/pricing-offer.test.ts).

export const PRICING_UNAVAILABLE_MESSAGE = "Pricing is temporarily unavailable. Please try again in a minute.";
/** Shown after a price-changed refusal; the button then refreshes the page so the new price appears. */
export function priceChangedMessage(currentCents: number): string {
  return `The price has just changed to ${formatPrice(currentCents)}. Please check the updated price and try again.`;
}

/** The fields of ActivePricing (lib/purchases.ts) that decide the offer. */
export type PricingInput = {
  /** False when the prices are a hard-coded fallback because the pricing read failed. */
  available: boolean;
  spotsLeft: number;
  founderPriceCents: number;
  standardPriceCents: number;
  founderCap: number;
  currency: string;
};

export type PriceOffer =
  | { state: "unavailable" }
  | {
      /** "founder" while founder spots remain, "standard" after. */
      state: "founder" | "standard";
      /** What checkout charges, and the main price shown. */
      chargeCents: number;
      currency: string;
      founderCents: number;
      standardCents: number;
      founderCap: number;
      /** Strikethrough, "Save N%" badge and founder line: only while the founder price is really lower. */
      showDiscount: boolean;
      savePercent: number;
    };

export function getPriceOffer(pricing: PricingInput): PriceOffer {
  if (!pricing.available) return { state: "unavailable" };
  const founder = pricing.spotsLeft > 0;
  const { founderPriceCents: founderCents, standardPriceCents: standardCents } = pricing;
  const savePercent = standardCents > 0 ? Math.round((1 - founderCents / standardCents) * 100) : 0;
  return {
    state: founder ? "founder" : "standard",
    chargeCents: founder ? founderCents : standardCents,
    currency: pricing.currency,
    founderCents,
    standardCents,
    founderCap: pricing.founderCap,
    showDiscount: founder && founderCents < standardCents && savePercent >= 1,
    savePercent,
  };
}

/** "$8", or "$8.50" when there are cents. Prices are in US dollars. */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

export type CheckoutOutcome<T> =
  | { ok: true; chargeCents: number; currency: string; result: T }
  | { ok: false; status: "pricing-unavailable" | "price-changed"; message: string };

/**
 * Decides whether to create a checkout and for how much, then calls `create` at most once.
 * - Pricing unavailable: refuses, and `create` is never called.
 * - `expectedCents` (the price the page showed) differs from the current price, e.g. the last
 *   founder spot went in the meantime: refuses, so nobody is charged a price they weren't shown.
 * - Otherwise charges the offer's chargeCents (founder while spots remain, standard after).
 * The amount always comes from `pricing`, never from the caller.
 */
export async function runCheckout<T>(
  pricing: PricingInput,
  expectedCents: number | undefined,
  create: (chargeCents: number, currency: string) => Promise<T>,
): Promise<CheckoutOutcome<T>> {
  const offer = getPriceOffer(pricing);
  if (offer.state === "unavailable") {
    return { ok: false, status: "pricing-unavailable", message: PRICING_UNAVAILABLE_MESSAGE };
  }
  if (expectedCents !== undefined && expectedCents !== offer.chargeCents) {
    return { ok: false, status: "price-changed", message: priceChangedMessage(offer.chargeCents) };
  }
  const result = await create(offer.chargeCents, offer.currency);
  return { ok: true, chargeCents: offer.chargeCents, currency: offer.currency, result };
}
