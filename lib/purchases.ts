import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ProductKey } from "@/lib/payments/types";
import { checkAccess, type AccessClient } from "@/lib/entitlement";

export type ActivePricing = {
  product: ProductKey;
  currency: string;
  spotsLeft: number;
  founderPriceCents: number;
  standardPriceCents: number;
  founderCap: number;
  /** When the founding offer ends (pricing_settings.founder_ends_at, migration 0009). "" when unavailable. */
  founderEndsAt: string;
  /**
   * False when the prices are the hard-coded fallback (no Supabase config, the pricing_settings
   * read failed, or no active row). Nothing is shown or charged then: getPriceOffer() turns it into
   * the "unavailable" state and checkout refuses (lib/pricing-offer.ts).
   */
  available: boolean;
};

/** Only the error code (a Postgres/PostgREST code, or the error's name) is ever logged. */
function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === "string" && code) return code;
    if (typeof name === "string" && name) return name;
  }
  return "unknown";
}

// Once per request and product: React's cache() is scoped to the request, so a page whose lesson
// gate, pricing slot and locks all ask makes one has_access() call. userId is the key and proof of a
// session (callers pass getCurrentUser()'s id; signed-out visitors never get here); has_access()
// itself answers for the session's user (auth.uid()), never for an id passed in.
const entitlementFor = cache(async (_userId: string, product: ProductKey): Promise<boolean> => {
  try {
    const supabase = await createClient();
    if (!supabase) return false;
    return await checkAccess(supabase as unknown as AccessClient, product, (code) =>
      console.warn("[purchases] hasActiveEntitlement failed, code:", code),
    );
  } catch (error) {
    console.warn("[purchases] hasActiveEntitlement failed, code:", errorCode(error));
    return false;
  }
});

/**
 * The one access check (docs/plans/subscription.md, section 3): a lifetime purchase, or a
 * subscription inside its paid period (plus the 7-day grace when active or past_due), decided by
 * public.has_access() with the session's own client, under RLS. Every access check in the app goes
 * through here. Fails closed (false) on missing config or any database error.
 */
export function hasActiveEntitlement(userId: string, product: ProductKey = "lessons"): Promise<boolean> {
  return entitlementFor(userId, product);
}

/**
 * Returns the number of founder pricing spots remaining for a product.
 * Calls public.get_founder_spots_left() via Supabase RPC. Fails closed (returns 0) on error.
 */
export async function getFounderSpotsLeft(product: ProductKey = "lessons"): Promise<number> {
  try {
    const supabase = await createClient();
    if (!supabase) return 0;

    const { data, error } = await supabase.rpc("get_founder_spots_left", { p_product: product });
    if (error) {
      console.warn("[purchases] getFounderSpotsLeft failed, code:", errorCode(error));
      return 0;
    }
    if (typeof data !== "number") return 0;
    return data;
  } catch (error) {
    console.warn("[purchases] getFounderSpotsLeft failed, code:", errorCode(error));
    return 0;
  }
}

/**
 * Reads active pricing settings and founder spots. The price shown and charged is derived from this
 * by getPriceOffer() in lib/pricing-offer.ts, never here.
 * Editable directly from the Supabase dashboard without redeployment.
 */
export async function getActivePricing(product: ProductKey = "lessons"): Promise<ActivePricing> {
  const fallback: ActivePricing = {
    product,
    currency: "usd",
    // Not prices: with available false nothing is shown or charged.
    spotsLeft: 0,
    founderPriceCents: 0,
    standardPriceCents: 0,
    founderCap: 0,
    founderEndsAt: "",
    available: false,
  };

  try {
    const supabase = await createClient();
    if (!supabase) return fallback;

    const { data, error } = await supabase
      .from("pricing_settings")
      .select("founder_price_cents, standard_price_cents, founder_cap, currency, is_active, founder_ends_at")
      .eq("product", product)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.warn("[purchases] getActivePricing failed, code:", errorCode(error));
      return fallback;
    }
    if (!data) {
      console.warn("[purchases] getActivePricing failed, code: no_active_row");
      return fallback;
    }

    if (typeof data.founder_ends_at !== "string" || !Number.isFinite(Date.parse(data.founder_ends_at))) {
      console.warn("[purchases] getActivePricing failed, code: no_founder_deadline");
      return fallback;
    }

    const spotsLeft = await getFounderSpotsLeft(product);

    return {
      product,
      currency: data.currency.toLowerCase(),
      spotsLeft,
      founderPriceCents: data.founder_price_cents,
      standardPriceCents: data.standard_price_cents,
      founderCap: data.founder_cap,
      founderEndsAt: new Date(data.founder_ends_at).toISOString(),
      available: true,
    };
  } catch (error) {
    console.warn("[purchases] getActivePricing failed, code:", errorCode(error));
    return fallback;
  }
}
