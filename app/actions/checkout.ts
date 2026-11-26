"use server";

import { getCurrentUser } from "@/lib/current-user";
import { getPaymentProvider } from "@/lib/payments/provider";
import { getYearlyProductId } from "@/lib/payments/config";
import type { ProductKey } from "@/lib/payments/types";
import { getAccessDetails, getActivePricing, hasActiveEntitlement } from "@/lib/purchases";
import { alreadyHasAccessMessage } from "@/lib/access-wording";
import { ACCESS_UNKNOWN_MESSAGE, providerPriceMatches, runCheckout, type CheckoutPlan } from "@/lib/pricing-offer";

export type CreateCheckoutResult = {
  checkoutUrl?: string;
  redirectUrl?: string;
  error?: string;
  /**
   * Set when no checkout was created; `error` holds the message to show. "pricing-unavailable" and
   * "price-changed" refresh the page so the current offer shows; "access-unknown" means the access
   * check failed, and nothing is charged until it can be made.
   */
  status?: "pricing-unavailable" | "price-changed" | "access-unknown";
};

/**
 * Server Action to create a payment checkout session.
 * Re-reads the user session, verifies access, and decides the plan and price strictly on the server
 * with runCheckout (lib/pricing-offer.ts), the same logic the pricing card and paywall display.
 * `expectedPriceCents` is the price the page showed and `plan` the plan it offered; both are only
 * compared, never trusted.
 * - Access unknown (the check failed): refused, never treated as "no access".
 * - Access already (lifetime or a subscription): refused.
 * - The founder price after the switch, or the yearly plan before it: refused with price-changed.
 * - The yearly plan: the subscription product's price at the provider must match ours first.
 */
export async function createCheckoutAction(
  product: ProductKey = "lessons",
  expectedPriceCents?: number,
  plan: CheckoutPlan = "founder"
): Promise<CreateCheckoutResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { redirectUrl: "/sign-in?next=/pricing" };
  }

  const access = await hasActiveEntitlement(user.id, product);
  if (access === "unknown") {
    return { status: "access-unknown", error: ACCESS_UNKNOWN_MESSAGE };
  }
  if (access === "yes") {
    const details = await getAccessDetails(user.id, product);
    return {
      error: details.state === "yes" ? alreadyHasAccessMessage(details) : "You already have access to these lessons.",
      redirectUrl: "/lessons/b1",
    };
  }

  const pricing = await getActivePricing(product);

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const returnUrl = `${siteUrl}/checkout/success?product=${product}`;

  try {
    const provider = getPaymentProvider();
    // The time of this request: an offer that changed after the page was opened is refused here.
    const outcome = await runCheckout(
      pricing,
      expectedPriceCents,
      (priceCents, currency, chosen) =>
        provider.createCheckout({
          userId: user.id,
          userEmail: user.email ?? "",
          product,
          priceCents,
          currency,
          redirectUrl: returnUrl,
          metadata: {
            user_id: user.id,
            product,
          },
          plan: chosen,
        }),
      Date.now(),
      {
        plan: plan === "yearly" ? "yearly" : "founder",
        // The subscription product's own price must be ours, billed yearly, or nothing is created.
        confirmProviderPrice: async (terms) => {
          const productId = getYearlyProductId();
          if (!productId || !provider.getProductPrice) return false;
          const ok = providerPriceMatches(await provider.getProductPrice(productId), terms);
          if (!ok) console.error("[actions:checkout] The yearly product's price doesn't match subscription_price_cents; no checkout created.");
          return ok;
        },
      },
    );

    if (!outcome.ok) {
      return { status: outcome.status, error: outcome.message };
    }
    return { checkoutUrl: outcome.result.checkoutUrl };
  } catch (error) {
    console.error("[actions:checkout] Error creating checkout:", error instanceof Error ? error.message : error);
    return { error: "Unable to start checkout. Please try again later." };
  }
}

/**
 * Lightweight polling action used by the post-payment success page to check if the webhook has
 * finished granting access: a lifetime purchase or a new subscription row (has_access() counts both).
 * "unknown" (the check failed) keeps it polling.
 */
export async function checkEntitlementStatusAction(
  product: ProductKey = "lessons"
): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  return (await hasActiveEntitlement(user.id, product)) === "yes";
}
