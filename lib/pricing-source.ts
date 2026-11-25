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
const PRICE_CHANGING_OUTCOMES = new Set(["granted", "revoked", "revoked_out_of_order", "disputed"]);

export function pricingChangingOutcome(outcome: string): boolean {
  return PRICE_CHANGING_OUTCOMES.has(outcome);
}

type QueryResult<T> = PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>;

/** The part of a Supabase client loadPricing needs (any client: the anon one, or a test fake). */
export type PricingClient = {
  from(table: "pricing_settings"): {
    select(columns: string): {
      eq(column: string, value: unknown): { eq(column: string, value: unknown): { maybeSingle(): QueryResult<{ founder_price_cents: number; standard_price_cents: number; founder_cap: number; currency: string }> } };
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

/** The live price and founder spots for a product. Throws PricingReadError on any failure. */
export async function loadPricing(client: PricingClient, product = "lessons"): Promise<PricingInput> {
  // Both calls at once: they don't depend on each other.
  const [settings, spots] = await Promise.all([
    client.from("pricing_settings").select("founder_price_cents, standard_price_cents, founder_cap, currency").eq("product", product).eq("is_active", true).maybeSingle(),
    client.rpc("get_founder_spots_left", { p_product: product }),
  ]);
  if (settings.error) throw new PricingReadError(settings.error.code || "settings_error");
  if (!settings.data) throw new PricingReadError("no_active_row");
  if (spots.error) throw new PricingReadError(spots.error.code || "spots_error");
  if (typeof spots.data !== "number") throw new PricingReadError("spots_not_a_number");
  return {
    available: true,
    spotsLeft: spots.data,
    founderPriceCents: settings.data.founder_price_cents,
    standardPriceCents: settings.data.standard_price_cents,
    founderCap: settings.data.founder_cap,
    currency: settings.data.currency.toLowerCase(),
  };
}
