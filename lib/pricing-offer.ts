// The one place that turns pricing data into what learners see and what checkout charges, so the
// pricing card, the lesson paywall, the sign-in panel, the reminder banner and createCheckoutAction
// can never disagree. Pure: no I/O, no clock of its own (the time is passed in), and no server-only
// imports, so it can be unit-tested (lib/pricing-offer.test.ts) and used by client components.
//
// Pricing v2 (Prompt 76): the founding offer ($8 once, lifetime access) is live only while founder
// spots remain AND the time is before founder_ends_at (migration 0009: 2026-12-31T16:59:00Z, 23:59 in
// Bangkok). After that (the switch, Prompt 80), new buyers get the yearly subscription at
// pricing_settings.subscription_price_cents (0012), when the yearly product is configured
// (PAYMENTS_YEARLY_PRODUCT_ID). Without it the offer is "ended": "New plan coming soon", nothing to buy.

export const PRICING_UNAVAILABLE_MESSAGE = "Pricing is temporarily unavailable. Please try again in a minute.";
export const OFFER_ENDED_MESSAGE = "The founding offer has ended. A new plan is coming soon.";
/** The founder price was asked for after the switch: the page refreshes to show the yearly plan. */
export const FOUNDER_SWITCHED_MESSAGE = "The founding offer has ended. Yearly access is now available: please check the new price.";
/** The yearly plan was asked for while the founding offer is still on (a page ahead of the server's clock). */
export const FOUNDER_STILL_ON_MESSAGE = "The founding offer is still on. Please check the price and try again.";
/** The payment provider's product doesn't match the yearly price we show: nothing is charged. */
export const YEARLY_UNCONFIRMED_MESSAGE = "We couldn't confirm the yearly price. Please try again in a minute.";
/** The access check failed: never treated as "no access" where money is involved. */
export const ACCESS_UNKNOWN_MESSAGE = "We couldn't confirm your access. Please try again in a minute.";

/**
 * Whether tax may be added on top of the shown yearly price at checkout. Dodo (the Merchant of
 * Record) adds tax at checkout unless the product's price is set to "tax inclusive"; the code never
 * sets it, so the product's own setting decides (docs/plans/subscription.md, section 8). While this
 * is true, the yearly price says "plus tax where applicable".
 */
export const TAX_ADDED_AT_CHECKOUT = true;
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
  /** When the founding offer ends, for everyone (ISO, from pricing_settings.founder_ends_at). */
  founderEndsAt: string;
  /** The yearly price (pricing_settings.subscription_price_cents, 0012); null before 0012 or when invalid. */
  subscriptionPriceCents: number | null;
  /** True when the yearly product is configured (PAYMENTS_YEARLY_PRODUCT_ID, server-side). */
  yearlyProductConfigured: boolean;
};

/** What the yearly plan costs, when it can be bought. */
export type YearlyTerms = { chargeCents: number; currency: string };

/** The yearly plan's terms, or null when it can't be sold (no product configured, or no valid price). */
export function yearlyTerms(pricing: PricingInput): YearlyTerms | null {
  const cents = pricing.subscriptionPriceCents;
  if (!pricing.yearlyProductConfigured || typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) return null;
  return { chargeCents: cents, currency: pricing.currency };
}

export type PriceOffer =
  | { state: "unavailable" }
  | {
      /** Founder spots remain and the deadline hasn't passed. */
      state: "founder";
      /** What checkout charges, and the price shown. */
      chargeCents: number;
      currency: string;
      founderCents: number;
      founderCap: number;
      spotsLeft: number;
      founderEndsAt: string;
      /** The yearly price new buyers get after the founding offer, for the honest comparison line. */
      yearlyCents: number;
      /** What an open page switches to at the deadline: the yearly plan, or null ("New plan coming soon"). */
      yearly: YearlyTerms | null;
    }
  | {
      /** After the switch (the deadline passed, or the spots ran out first): the yearly subscription. */
      state: "yearly";
      chargeCents: number;
      currency: string;
      reason: "deadline" | "sold-out";
      founderEndsAt: string;
    }
  | {
      /** The founding offer is over and the yearly plan can't be sold here: "New plan coming soon". */
      state: "ended";
      reason: "deadline" | "sold-out";
      founderEndsAt: string;
    };

/** What a page shows: the founder offer, the yearly plan, "coming soon", or nothing (pricing unreadable). */
export type OfferPhase = "founder" | "yearly" | "soon" | "unavailable";

/** True while the deadline hasn't passed at `nowMs`. An unreadable deadline counts as passed. */
export function beforeDeadline(founderEndsAt: string, nowMs: number): boolean {
  const ends = Date.parse(founderEndsAt);
  return Number.isFinite(ends) && nowMs < ends;
}

/** The offer at `nowMs`. Worked out every time it's asked: never cached. */
export function getPriceOffer(pricing: PricingInput, nowMs: number): PriceOffer {
  if (!pricing.available) return { state: "unavailable" };
  const yearly = yearlyTerms(pricing);
  const after = (reason: "deadline" | "sold-out"): PriceOffer =>
    yearly ? { state: "yearly", ...yearly, reason, founderEndsAt: pricing.founderEndsAt } : { state: "ended", reason, founderEndsAt: pricing.founderEndsAt };
  if (!beforeDeadline(pricing.founderEndsAt, nowMs)) return after("deadline");
  if (pricing.spotsLeft <= 0) return after("sold-out");
  return {
    state: "founder",
    chargeCents: pricing.founderPriceCents,
    currency: pricing.currency,
    founderCents: pricing.founderPriceCents,
    founderCap: pricing.founderCap,
    spotsLeft: pricing.spotsLeft,
    founderEndsAt: pricing.founderEndsAt,
    yearlyCents: pricing.subscriptionPriceCents ?? pricing.standardPriceCents,
    yearly,
  };
}

/**
 * What to show at `nowMs` for an offer the server decided earlier (an open page's clock): a founder
 * offer whose deadline has passed becomes the yearly plan it carries, or "coming soon".
 */
export function offerPhase(offer: PriceOffer, nowMs: number): OfferPhase {
  if (offer.state === "unavailable") return "unavailable";
  if (offer.state === "yearly") return "yearly";
  if (offer.state === "ended") return "soon";
  if (beforeDeadline(offer.founderEndsAt, nowMs)) return "founder";
  return offer.yearly ? "yearly" : "soon";
}

/** The yearly plan an offer shows or switches to, if any. */
export function yearlyOf(offer: PriceOffer): YearlyTerms | null {
  if (offer.state === "yearly") return { chargeCents: offer.chargeCents, currency: offer.currency };
  if (offer.state === "founder") return offer.yearly;
  return null;
}

/** "$8", or "$8.50" when there are cents. Prices are in US dollars. */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

// ---------- The countdown and the deadline in words ----------

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * "12 days 4 hours"; in the last 24 hours "4 hours 12 minutes"; in the last minute "less than a
 * minute"; null once it has passed. Rounded down, so it never promises more time than is left.
 */
export function timeLeft(founderEndsAt: string, nowMs: number): string | null {
  const ms = Date.parse(founderEndsAt) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days >= 1) return hours ? `${plural(days, "day")} ${plural(hours, "hour")}` : plural(days, "day");
  if (hours >= 1) return mins ? `${plural(hours, "hour")} ${plural(mins, "minute")}` : plural(hours, "hour");
  return plural(mins, "minute");
}

/** The banner's shorter form: "12 days" (from 2 days), else "30 hours", "4 hours", "12 minutes". */
export function timeLeftShort(founderEndsAt: string, nowMs: number): string | null {
  const ms = Date.parse(founderEndsAt) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return plural(Math.floor(hours / 24), "day");
  if (hours >= 1) return plural(hours, "hour");
  const mins = Math.floor(ms / 60_000);
  return mins >= 1 ? plural(mins, "minute") : "less than a minute";
}

/** The city of an IANA zone ("Asia/Bangkok" → "Bangkok", "America/New_York" → "New York"). */
export function zoneCity(timeZone: string): string {
  const city = timeZone.split("/").pop() ?? timeZone;
  return city.replace(/_/g, " ");
}

/** "Ends 31 Dec, 23:59 Bangkok time", in the given zone (the visitor's, once known in the browser). */
export function endsLabel(founderEndsAt: string, timeZone: string): string {
  const d = new Date(founderEndsAt);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `Ends ${day}, ${time} ${timeZone === "UTC" || timeZone === "Etc/UTC" ? "UTC" : `${zoneCity(timeZone)} time`}`;
}

/** The deadline's own zone: the server renders in it, and the browser switches to the visitor's. */
export const DEADLINE_ZONE = "Asia/Bangkok";

/** "31 December 2026" (in Bangkok), for pages that state the date. */
export function deadlineDate(founderEndsAt: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: DEADLINE_ZONE, day: "numeric", month: "long", year: "numeric" }).format(new Date(founderEndsAt));
}

// ---------- Checkout ----------

/** Which plan a checkout is for: the one-time founder price, or the yearly subscription. */
export type CheckoutPlan = "founder" | "yearly";

export type CheckoutOutcome<T> =
  | { ok: true; plan: CheckoutPlan; chargeCents: number; currency: string; result: T }
  | { ok: false; status: "pricing-unavailable" | "price-changed"; message: string };

/**
 * Decides whether to create a checkout, for which plan and how much, then calls `create` at most once.
 * What's for sale is decided at `nowMs` (the request's time), never by the page:
 * - Pricing unavailable: refuses, and `create` is never called.
 * - `plan` "founder" (the default): charged only while the founding offer is live. After the switch
 *   it's refused with price-changed, even if the page showing $8 was opened before.
 * - `plan` "yearly": only after the switch, and only when the yearly plan can be sold (otherwise
 *   "coming soon"). Before `create`, `confirmProviderPrice` must confirm that the provider's product
 *   costs the same; a missing check, a mismatch or an error refuses.
 * - `expectedCents` (the price the page showed) differs from the current price: refuses, so nobody
 *   is charged a price they weren't shown.
 * The amount always comes from `pricing`, never the caller.
 */
export async function runCheckout<T>(
  pricing: PricingInput,
  expectedCents: number | undefined,
  create: (chargeCents: number, currency: string, plan: CheckoutPlan) => Promise<T>,
  nowMs: number,
  options: { plan?: CheckoutPlan; confirmProviderPrice?: (terms: YearlyTerms) => Promise<boolean> } = {},
): Promise<CheckoutOutcome<T>> {
  const plan = options.plan ?? "founder";
  const offer = getPriceOffer(pricing, nowMs);
  if (offer.state === "unavailable") {
    return { ok: false, status: "pricing-unavailable", message: PRICING_UNAVAILABLE_MESSAGE };
  }
  if (offer.state === "ended") {
    return { ok: false, status: "price-changed", message: OFFER_ENDED_MESSAGE };
  }
  if (plan === "founder" && offer.state === "yearly") {
    return { ok: false, status: "price-changed", message: FOUNDER_SWITCHED_MESSAGE };
  }
  if (plan === "yearly" && offer.state === "founder") {
    return { ok: false, status: "price-changed", message: FOUNDER_STILL_ON_MESSAGE };
  }
  if (expectedCents !== undefined && expectedCents !== offer.chargeCents) {
    return { ok: false, status: "price-changed", message: priceChangedMessage(offer.chargeCents) };
  }
  if (offer.state === "yearly") {
    let confirmed = false;
    try {
      confirmed = options.confirmProviderPrice ? await options.confirmProviderPrice({ chargeCents: offer.chargeCents, currency: offer.currency }) : false;
    } catch {
      confirmed = false;
    }
    if (!confirmed) return { ok: false, status: "price-changed", message: YEARLY_UNCONFIRMED_MESSAGE };
  }
  const result = await create(offer.chargeCents, offer.currency, plan);
  return { ok: true, plan, chargeCents: offer.chargeCents, currency: offer.currency, result };
}

/** The provider's product price, as read before a yearly checkout (null when it can't be read). */
export type ProviderPrice = { priceCents: number; currency: string; interval: string | null; intervalCount: number | null };

/** The same price and currency, billed every 1 year. Anything else is a mismatch. */
export function providerPriceMatches(price: ProviderPrice | null, terms: YearlyTerms): boolean {
  return (
    !!price &&
    price.priceCents === terms.chargeCents &&
    price.currency.toLowerCase() === terms.currency.toLowerCase() &&
    (price.interval ?? "").toLowerCase() === "year" &&
    price.intervalCount === 1
  );
}
