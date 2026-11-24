import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProductKey } from "@/lib/payments/types";

export type ActivePricing = {
  product: ProductKey;
  priceCents: number;
  currency: string;
  spotsLeft: number;
  isFounder: boolean;
  founderPriceCents: number;
  standardPriceCents: number;
  founderCap: number;
  /**
   * False when the prices are the hard-coded fallback (no Supabase config, the pricing_settings
   * read failed, or no active row). The pricing card then hides the price; checkout still uses
   * the fallback values below.
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

/**
 * Checks whether a user has an active entitlement for the specified product.
 * Uses the authenticated user's session client and respects Row Level Security.
 * Fails closed (returns false) on any missing config or database error.
 */
export async function hasActiveEntitlement(
  userId: string,
  product: ProductKey = "lessons"
): Promise<boolean> {
  try {
    const supabase = await createClient();
    if (!supabase) return false;

    const { data, error } = await supabase
      .from("purchases")
      .select("id")
      .eq("user_id", userId)
      .eq("product", product)
      .eq("status", "active")
      .maybeSingle();

    if (error || !data) return false;
    return true;
  } catch (error) {
    console.warn("[purchases] hasActiveEntitlement error:", error instanceof Error ? error.message : error);
    return false;
  }
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
 * Reads active pricing settings and founder spots to determine the live price.
 * Editable directly from the Supabase dashboard without redeployment.
 */
export async function getActivePricing(product: ProductKey = "lessons"): Promise<ActivePricing> {
  const fallback: ActivePricing = {
    product,
    priceCents: 800,
    currency: "usd",
    spotsLeft: 100,
    isFounder: true,
    founderPriceCents: 800,
    standardPriceCents: 1200,
    founderCap: 100,
    available: false,
  };

  try {
    const supabase = await createClient();
    if (!supabase) return fallback;

    const { data, error } = await supabase
      .from("pricing_settings")
      .select("founder_price_cents, standard_price_cents, founder_cap, currency, is_active")
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

    const spotsLeft = await getFounderSpotsLeft(product);
    const isFounder = spotsLeft > 0;
    const priceCents = isFounder ? data.founder_price_cents : data.standard_price_cents;

    return {
      product,
      priceCents,
      currency: data.currency.toLowerCase(),
      spotsLeft,
      isFounder,
      founderPriceCents: data.founder_price_cents,
      standardPriceCents: data.standard_price_cents,
      founderCap: data.founder_cap,
      available: true,
    };
  } catch (error) {
    console.warn("[purchases] getActivePricing failed, code:", errorCode(error));
    return fallback;
  }
}
