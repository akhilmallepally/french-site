import "server-only";
// The price everyone sees (founder price, standard price, founder spots), cached for all visitors
// for about a minute and tagged so the payments webhook can expire it at once. It never depends on
// the visitor: no cookies, read with the public (anon) key, whose RLS allows exactly these two reads.
//
// - getSharedPricing is a `use cache` function. With a 60 s life it's filled while the page
//   prerenders, so the price is in the static shell, in the same pass as the free card.
// - A failure is never cached. A `use cache` function mustn't throw (a throw during prerender fails
//   the build), so on a failure it returns { ok: false } with cacheLife expire 0: Next.js then
//   leaves it out of the prerender (a request-time hole) and its default handler never stores an
//   expire-0 entry, so every request reads again until pricing is back. Meanwhile the offer is
//   "unavailable".
// - Checkout never uses this: it reads the live price (getActivePricing), and refuses with
//   price-changed if the page's (cached) price is out of date.
// - The cache holds the numbers, the spots and the deadline, plus when they were read (readAtMs),
//   never the "is the founding offer live" answer: that is worked out by getPriceOffer for the time
//   of the request (or, in a prerendered page, of the read, and again in the browser on its clock).
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getYearlyProductId } from "@/lib/payments/config";
import { testSwitchAfter } from "@/lib/test-switch";
import { getPriceOffer, type PriceOffer, type PricingInput } from "@/lib/pricing-offer";
import { loadPricing, PRICING_TAG, PricingReadError, type PricingClient } from "@/lib/pricing-source";

export type SharedPricing = { ok: true; pricing: PricingInput; readAtMs: number } | { ok: false; code: string };

/** Cached for all visitors when it succeeds; a failure is never stored (expire 0). */
export async function getSharedPricing(product = "lessons"): Promise<SharedPricing> {
  "use cache";
  cacheTag(PRICING_TAG);
  const env = getSupabaseEnv();
  try {
    if (!env) throw new PricingReadError("not_configured");
    const client = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as PricingClient;
    // The test-mode override (Prompt 82) is decided from the server's environment only.
    const pricing = await loadPricing(client, product, getYearlyProductId() !== null, testSwitchAfter(process.env));
    cacheLife({ stale: 60, revalidate: 60, expire: 300 });
    return { ok: true, pricing, readAtMs: Date.now() };
  } catch (error) {
    cacheLife({ stale: 0, revalidate: 0, expire: 0 }); // never cached, never part of a prerender
    const code = error instanceof PricingReadError ? error.code : "unknown";
    if (code !== "not_configured") console.warn("[pricing] shared read failed, code:", code);
    return { ok: false, code };
  }
}

/**
 * The offer at `nowMs` from the shared price, or "unavailable" (never cached) when it can't be read.
 * Request-time callers pass Date.now() (after connection()); a prerendered part passes "read", the
 * time the shared price was read, and lets the browser re-check on its own clock.
 */
export async function getSharedOffer(product: string, nowMs: number | "read"): Promise<PriceOffer> {
  const shared = await getSharedPricing(product);
  if (!shared.ok) return { state: "unavailable" };
  return getPriceOffer(shared.pricing, nowMs === "read" ? shared.readAtMs : nowMs);
}
