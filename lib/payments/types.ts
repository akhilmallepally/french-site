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
      orderId: string;
      userId: string;
      product: ProductKey;
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
