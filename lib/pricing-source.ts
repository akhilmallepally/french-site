// Reading the live price and the founder spots, shared by the cached price (lib/shared-pricing.ts)
// and its tests. Pure apart from the client passed in: no Next.js imports, no cookies.
//
// loadPricing throws on any failure (Supabase error, no active pricing row, the founder-spots call
// failing). The cached wrapper relies on that: a thrown result is never stored (the default cache
// handler skips an errored entry), so a failure is never served from the cache.
import type { PricingInput } from "./pricing-offer.ts";

/** The cache tag of the shared price; the payments webhook expires it when a purchase changes. */
export const PRICING_TAG = "pricing";

/** Webhook outcomes that change the founder spots or who has access, so the shared price must refresh. */
const PRICE_CHANGING_OUTCOMES = new Set(["granted", "revoked", "revoked_out_of_order", "disputed", "restored"]);

export function pricingChangingOutcome(outcome: string): boolean {
  return PRICE_CHANGING_OUTCOMES.has(outcome);
}

type QueryResult<T> = PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>;

/** The part of a Supabase client loadPricing needs (any client: the anon one, or a test fake). */
export type PricingClient = {
  from(table: "pricing_settings"): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): {
          maybeSingle(): QueryResult<{ founder_price_cents: number; standard_price_cents: number; founder_cap: number; currency: string; founder_ends_at: string; subscription_price_cents?: unknown }>;
        };
      };
    };
  };
  rpc(fn: "get_founder_spots_left", args: { p_product: string }): QueryResult<number>;
};

export class PricingReadError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`pricing read failed: ${code}`);
    this.name = "PricingReadError";
    this.code = code;
  }
}

/** A positive whole number of cents, or null (the column is missing before 0012, or the value is bad). */
function cents(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
}

/**
 * The live price, founder spots, the founding offer's deadline and the yearly price. Throws
 * PricingReadError on any failure. `yearlyProductConfigured` comes from the server's config
 * (PAYMENTS_YEARLY_PRODUCT_ID); the caller passes it, so this stays free of env reads.
 */
export async function loadPricing(client: PricingClient, product = "lessons", yearlyProductConfigured = false): Promise<PricingInput> {
  // Both calls at once: they don't depend on each other. "*" so the read still works before 0012
  // adds subscription_price_cents (the yearly plan then stays "coming soon").
  const [settings, spots] = await Promise.all([
    client.from("pricing_settings").select("*").eq("product", product).eq("is_active", true).maybeSingle(),
    client.rpc("get_founder_spots_left", { p_product: product }),
  ]);
  if (settings.error) throw new PricingReadError(settings.error.code || "settings_error");
  if (!settings.data) throw new PricingReadError("no_active_row");
  if (spots.error) throw new PricingReadError(spots.error.code || "spots_error");
  if (typeof spots.data !== "number") throw new PricingReadError("spots_not_a_number");
  // Before migration 0009 the column is missing; missing or bad, it fails closed here.
  if (typeof settings.data.founder_ends_at !== "string" || !Number.isFinite(Date.parse(settings.data.founder_ends_at))) {
    throw new PricingReadError("no_founder_deadline");
  }
  return {
    available: true,
    spotsLeft: spots.data,
    founderPriceCents: settings.data.founder_price_cents,
    standardPriceCents: settings.data.standard_price_cents,
    founderCap: settings.data.founder_cap,
    currency: settings.data.currency.toLowerCase(),
    founderEndsAt: new Date(settings.data.founder_ends_at).toISOString(),
    subscriptionPriceCents: cents(settings.data.subscription_price_cents),
    yearlyProductConfigured,
  };
}
