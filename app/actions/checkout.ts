"use server";

import { getCurrentUser } from "@/lib/auth";
import { getPaymentProvider } from "@/lib/payments/provider";
import { signMetadata } from "@/lib/payments/config";
import type { ProductKey } from "@/lib/payments/types";
import { getActivePricing, hasActiveEntitlement } from "@/lib/purchases";

export type CreateCheckoutResult = {
  checkoutUrl?: string;
  redirectUrl?: string;
  error?: string;
};

/**
 * Server Action to create a payment checkout session.
 * Re-reads the user session, verifies entitlement, and computes the price strictly on the server.
 */
export async function createCheckoutAction(
  product: ProductKey = "lessons"
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
    const { checkoutUrl } = await provider.createCheckout({
      userId: user.id,
      userEmail: user.email ?? "",
      product,
      priceCents: pricing.priceCents,
      currency: pricing.currency,
      redirectUrl: returnUrl,
      metadata: {
        user_id: user.id,
        product,
      },
    });

    return { checkoutUrl };
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
