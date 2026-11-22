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
};

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
      type: "ignored";
      provider: ProviderName;
      reason: string;
    };

export interface PaymentProvider {
  readonly name: ProviderName;
  createCheckout(params: CheckoutParams): Promise<{ checkoutUrl: string }>;
  verifyWebhookSignature(rawBody: string, headers: Headers): Promise<boolean>;
  parseWebhookEvent(rawBody: string): Promise<WebhookEventResult>;
}
