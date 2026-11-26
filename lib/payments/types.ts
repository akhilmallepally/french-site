export type ProductKey = "lessons" | "pro" | "max";
export type ProviderName = "dodo" | "lemonsqueezy";

export type CheckoutParams = {
  userId: string;
  userEmail: string;
  product: ProductKey;
  priceCents: number;
  currency: string;
  redirectUrl: string;
  metadata?: Record<string, string>;
  /**
   * "founder" (the default): the one-time lifetime product at priceCents. "yearly": the subscription
   * product (PAYMENTS_YEARLY_PRODUCT_ID), whose price is the product's own (checked against
   * priceCents before the checkout is created, lib/pricing-offer.ts).
   */
  plan?: "founder" | "yearly";
};

/** A product's price as the provider has it (Dodo: GET /products/{id}), or null when unreadable. */
export type ProductPrice = { priceCents: number; currency: string; interval: string | null; intervalCount: number | null };

export type WebhookEventResult =
  | {
      type: "order_paid";
      provider: ProviderName;
      orderId: string; // the provider's payment or order id: the idempotency key
      /** From the checkout metadata; may be missing, malformed or for a deleted account. */
      userId?: string;
      /** The buyer's email, for the fallback match (compared without regard to case). Never logged or stored. */
      customerEmail?: string;
      /** As sent; checked against ProductKey before anything is written. */
      product: string;
      amountCents: number;
      currency: string;
      metadataSignature?: string;
    }
  | {
      type: "order_refunded";
      provider: ProviderName;
      orderId: string;
      userId?: string;
      product?: ProductKey;
    }
  | {
      type: "order_disputed";
      provider: ProviderName;
      orderId: string;
      userId?: string;
      product?: ProductKey;
    }
  | {
      /** A dispute decided in our favour: access comes back (dispute.won). */
      type: "order_dispute_won";
      provider: ProviderName;
      orderId: string;
    }
  | {
      /** A yearly subscription changed (docs/plans/subscription.md, section 2). */
      type: "subscription";
      provider: ProviderName;
      kind: SubscriptionEventKind;
      subscriptionId: string;
      customerId?: string;
      /** The provider's product id; it must be the yearly product (PAYMENTS_YEARLY_PRODUCT_ID). */
      productId?: string;
      /** From the checkout metadata (signed), as for one-time purchases. */
      userId?: string;
      product?: string;
      metadataSignature?: string;
      /** For the fallback match, compared without regard to case. Never logged or stored. */
      customerEmail?: string;
      nextBillingDate?: string;
      cancelAtNextBillingDate: boolean;
      cancelledAt?: string;
      /** The provider's event time (the envelope's timestamp): an older event never undoes a newer one. */
      eventAt: string;
    }
  | {
      /** A charge of a subscription (payment.succeeded with a subscription_id). */
      type: "subscription_paid";
      provider: ProviderName;
      paymentId: string;
      subscriptionId: string;
      amountCents: number;
      currency: string;
    }
  | {
      type: "ignored";
      provider: ProviderName;
      reason: string;
    };

export type SubscriptionEventKind = "active" | "renewed" | "updated" | "past_due" | "on_hold" | "cancelled" | "expired";

export interface PaymentProvider {
  readonly name: ProviderName;
  createCheckout(params: CheckoutParams): Promise<{ checkoutUrl: string }>;
  /** The product's price, read before a yearly checkout. Providers without it can't sell the yearly plan. */
  getProductPrice?(productId: string): Promise<ProductPrice | null>;
  /** A customer-portal session for that customer (Manage subscription); resolves to its link. */
  createPortalSession?(customerId: string, returnUrl: string): Promise<string>;
  verifyWebhookSignature(rawBody: string, headers: Headers): Promise<boolean>;
  parseWebhookEvent(rawBody: string): Promise<WebhookEventResult>;
}
