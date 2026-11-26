// The one place that turns pricing data into what learners see and what checkout charges, so the
// pricing card, the lesson paywall, the sign-in panel, the reminder banner and createCheckoutAction
// can never disagree. Pure: no I/O, no clock of its own (the time is passed in), and no server-only
// imports, so it can be unit-tested (lib/pricing-offer.test.ts) and used by client components.
//
// Pricing v2 (Prompt 76): the founding offer ($8 once, lifetime access) is live only while founder
// spots remain AND the time is before founder_ends_at (migration 0009: 2026-12-31T16:59:00Z, 23:59 in
// Bangkok). After that, new buyers get a subscription (not built yet): until it ships, the offer is
// "ended" and nothing can be bought.

export const PRICING_UNAVAILABLE_MESSAGE = "Pricing is temporarily unavailable. Please try again in a minute.";
export const OFFER_ENDED_MESSAGE = "The founding offer has ended. A new plan is coming soon.";
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
};

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
    }
  | {
      /** The founding offer is over: the deadline passed, or the spots ran out first. Nothing to buy yet. */
      state: "ended";
      reason: "deadline" | "sold-out";
      founderEndsAt: string;
    };

/** True while the deadline hasn't passed at `nowMs`. An unreadable deadline counts as passed. */
export function beforeDeadline(founderEndsAt: string, nowMs: number): boolean {
  const ends = Date.parse(founderEndsAt);
  return Number.isFinite(ends) && nowMs < ends;
}

/** The offer at `nowMs`. Worked out every time it's asked: never cached. */
export function getPriceOffer(pricing: PricingInput, nowMs: number): PriceOffer {
  if (!pricing.available) return { state: "unavailable" };
  if (!beforeDeadline(pricing.founderEndsAt, nowMs)) return { state: "ended", reason: "deadline", founderEndsAt: pricing.founderEndsAt };
  if (pricing.spotsLeft <= 0) return { state: "ended", reason: "sold-out", founderEndsAt: pricing.founderEndsAt };
  return {
    state: "founder",
    chargeCents: pricing.founderPriceCents,
    currency: pricing.currency,
    founderCents: pricing.founderPriceCents,
    founderCap: pricing.founderCap,
    spotsLeft: pricing.spotsLeft,
    founderEndsAt: pricing.founderEndsAt,
  };
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

export type CheckoutOutcome<T> =
  | { ok: true; chargeCents: number; currency: string; result: T }
  | { ok: false; status: "pricing-unavailable" | "price-changed"; message: string };

/**
 * Decides whether to create a checkout and for how much, then calls `create` at most once.
 * - Pricing unavailable: refuses, and `create` is never called.
 * - The founding offer has ended at `nowMs` (the deadline passed, or the last spot went): refuses
 *   with price-changed, even if the page showing $8 was opened before. Nothing else is on sale yet.
 * - `expectedCents` (the price the page showed) differs from the current price: refuses, so nobody
 *   is charged a price they weren't shown.
 * - Otherwise charges the founder price. The amount always comes from `pricing`, never the caller.
 */
export async function runCheckout<T>(
  pricing: PricingInput,
  expectedCents: number | undefined,
  create: (chargeCents: number, currency: string) => Promise<T>,
  nowMs: number,
): Promise<CheckoutOutcome<T>> {
  const offer = getPriceOffer(pricing, nowMs);
  if (offer.state === "unavailable") {
    return { ok: false, status: "pricing-unavailable", message: PRICING_UNAVAILABLE_MESSAGE };
  }
  if (offer.state === "ended") {
    return { ok: false, status: "price-changed", message: OFFER_ENDED_MESSAGE };
  }
  if (expectedCents !== undefined && expectedCents !== offer.chargeCents) {
    return { ok: false, status: "price-changed", message: priceChangedMessage(offer.chargeCents) };
  }
  const result = await create(offer.chargeCents, offer.currency);
  return { ok: true, chargeCents: offer.chargeCents, currency: offer.currency, result };
}
