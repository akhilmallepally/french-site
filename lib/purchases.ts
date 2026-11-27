import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ProductKey } from "@/lib/payments/types";
import { getYearlyProductId } from "@/lib/payments/config";
import { testSwitchAfter } from "@/lib/test-switch";
import { checkAccess, type AccessClient, type AccessState } from "@/lib/entitlement";
import { describeAccess, type AccessDetails, type SubscriptionRow } from "@/lib/access-wording";
import type { PortalRow } from "@/lib/portal";
import type { PricingInput } from "@/lib/pricing-offer";
import { loadPricing, PricingReadError, type PricingClient } from "@/lib/pricing-source";

export type { AccessState } from "@/lib/entitlement";
export type { AccessDetails } from "@/lib/access-wording";

export type ActivePricing = PricingInput & { product: ProductKey };

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
const entitlementFor = cache(async (_userId: string, product: ProductKey): Promise<AccessState> => {
  try {
    const supabase = await createClient();
    if (!supabase) return "unknown";
    return await checkAccess(supabase as unknown as AccessClient, product, (code) =>
      console.warn("[purchases] hasActiveEntitlement failed, code:", code),
    );
  } catch (error) {
    console.warn("[purchases] hasActiveEntitlement failed, code:", errorCode(error));
    return "unknown";
  }
});

/**
 * The one access check (docs/plans/subscription.md, section 3): a lifetime purchase, or a
 * subscription inside its paid period (plus the 7-day grace when active or past_due), decided by
 * public.has_access() with the session's own client, under RLS. Every access check in the app goes
 * through here.
 *
 * Three answers (Prompt 80): "yes", "no", or "unknown" when the check couldn't be made (missing
 * config, a database or network error). "unknown" is never treated as "no" where money is involved:
 * checkout refuses, and pages show "Couldn't check your access" with a Retry button, never the buy
 * paywall and never paid content.
 */
export function hasActiveEntitlement(userId: string, product: ProductKey = "lessons"): Promise<AccessState> {
  return entitlementFor(userId, product);
}

type Rows<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
type PurchasesRead = { from(table: "purchases"): { select(c: "id"): { eq(c: "product", v: string): { eq(c: "status", v: "active"): { limit(n: 1): Rows<unknown> } } } } };
type SubscriptionsRead = { from(table: "subscriptions"): { select(c: string): { eq(c: "product", v: string): Rows<SubscriptionRow> } } };

/**
 * Access with what to say about it (lib/access-wording.ts): lifetime, or the subscription's renewal
 * or end date, or a payment problem. The answer itself is hasActiveEntitlement's; the learner's own
 * purchases and subscriptions rows (RLS: own rows only) are read only to describe it, and only when
 * it's "yes". Once per request.
 */
export const getAccessDetails = cache(async (userId: string, product: ProductKey = "lessons"): Promise<AccessDetails> => {
  const state = await hasActiveEntitlement(userId, product);
  if (state !== "yes") return describeAccess(state, null, null, Date.now());
  try {
    const supabase = await createClient();
    if (!supabase) return describeAccess(state, null, null, Date.now());
    const [purchases, subs] = await Promise.all([
      (supabase as unknown as PurchasesRead).from("purchases").select("id").eq("product", product).eq("status", "active").limit(1),
      (supabase as unknown as SubscriptionsRead).from("subscriptions").select("status, current_period_end, cancel_at_period_end").eq("product", product),
    ]);
    const lifetime = purchases.error || !Array.isArray(purchases.data) ? null : purchases.data.length > 0;
    const rows = subs.error || !Array.isArray(subs.data) ? null : subs.data;
    if (lifetime === null || rows === null) console.warn("[purchases] getAccessDetails read failed, code:", errorCode(purchases.error ?? subs.error));
    return describeAccess(state, lifetime, rows, Date.now());
  } catch (error) {
    console.warn("[purchases] getAccessDetails failed, code:", errorCode(error));
    return describeAccess(state, null, null, Date.now());
  }
});

type OwnSubscriptionsRead = { from(table: "subscriptions"): { select(c: string): { eq(c: "product", v: string): Rows<PortalRow> } } };

/**
 * The learner's own subscription rows with the provider's customer id, for Manage subscription
 * (app/actions/subscription.ts). Read with the session's client: RLS returns the caller's rows only,
 * so the customer id can never be someone else's. Throws on any failure.
 */
export async function readOwnSubscriptions(product: ProductKey = "lessons"): Promise<PortalRow[]> {
  const supabase = await createClient();
  if (!supabase) throw new Error("not_configured");
  const { data, error } = await (supabase as unknown as OwnSubscriptionsRead)
    .from("subscriptions")
    .select("provider_customer_id, status, current_period_end, cancel_at_period_end")
    .eq("product", product);
  if (error || !Array.isArray(data)) throw Object.assign(new Error("subscriptions_read_failed"), { code: errorCode(error) });
  return data;
}

/**
 * The live pricing for checkout (never the shared cache): the same read as the shared price
 * (loadPricing), with the session's client, plus whether the yearly product is configured. On any
 * failure it's "unavailable" (available false): nothing is shown or charged (lib/pricing-offer.ts).
 */
export async function getActivePricing(product: ProductKey = "lessons"): Promise<ActivePricing> {
  const yearlyProductConfigured = getYearlyProductId() !== null;
  const fallback: ActivePricing = {
    product,
    available: false,
    // Not prices: with available false nothing is shown or charged.
    currency: "usd",
    spotsLeft: 0,
    founderPriceCents: 0,
    standardPriceCents: 0,
    founderCap: 0,
    founderEndsAt: "",
    subscriptionPriceCents: null,
    yearlyProductConfigured,
  };
  try {
    const supabase = await createClient();
    if (!supabase) return fallback;
    // Checkout honours the same test-mode override as the pages (Prompt 82): never the founder price there.
    return { ...(await loadPricing(supabase as unknown as PricingClient, product, yearlyProductConfigured, testSwitchAfter(process.env))), product };
  } catch (error) {
    console.warn("[purchases] getActivePricing failed, code:", error instanceof PricingReadError ? error.code : errorCode(error));
    return fallback;
  }
}
