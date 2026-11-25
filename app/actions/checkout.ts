"use server";

import { getCurrentUser } from "@/lib/current-user";
import { getPaymentProvider } from "@/lib/payments/provider";
import { signMetadata } from "@/lib/payments/config";
import type { ProductKey } from "@/lib/payments/types";
import { getActivePricing, hasActiveEntitlement } from "@/lib/purchases";
import { runCheckout } from "@/lib/pricing-offer";

export type CreateCheckoutResult = {
  checkoutUrl?: string;
  redirectUrl?: string;
  error?: string;
  /** Set when no checkout was created because of pricing; `error` holds the message to show. */
  status?: "pricing-unavailable" | "price-changed";
};

/**
 * Server Action to create a payment checkout session.
 * Re-reads the user session, verifies entitlement, and computes the price strictly on the server
 * with runCheckout (lib/pricing-offer.ts), the same logic the pricing card and paywall display.
 * `expectedPriceCents` is the price the page showed; it is only compared, never charged.
 */
export async function createCheckoutAction(
  product: ProductKey = "lessons",
  expectedPriceCents?: number
): Promise<CreateCheckoutResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { redirectUrl: "/sign-in?next=/pricing" };
  }

  const alreadyEntitled = await hasActiveEntitlement(user.id, product);
  if (alreadyEntitled) {
    return {
      error: "You already have lifetime access to these lessons.",
      redirectUrl: "/lessons/b1",
    };
  }

  const pricing = await getActivePricing(product);

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const returnUrl = `${siteUrl}/checkout/success?product=${product}`;

  try {
    const provider = getPaymentProvider();
    const outcome = await runCheckout(pricing, expectedPriceCents, (priceCents, currency) =>
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
      })
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
 * Lightweight polling action used by the post-payment success page to check
 * if the webhook has finished granting the user's entitlement.
 */
export async function checkEntitlementStatusAction(
  product: ProductKey = "lessons"
): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  return hasActiveEntitlement(user.id, product);
}
