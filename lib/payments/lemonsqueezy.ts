import crypto from "node:crypto";
import { getPaymentsConfig, signMetadata } from "./config";
import type { CheckoutParams, PaymentProvider, ProductKey, WebhookEventResult } from "./types";

export class LemonSqueezyPaymentProvider implements PaymentProvider {
  readonly name = "lemonsqueezy" as const;

  async createCheckout(params: CheckoutParams): Promise<{ checkoutUrl: string }> {
    const config = getPaymentsConfig();
    if (!config?.apiKey) {
      throw new Error("Lemon Squeezy API key is not configured");
    }

    const signature = signMetadata(params.userId, params.product, config.webhookSecret);
    const variantId = config.productId || "variant_lessons";

    const payload = {
      data: {
        type: "checkouts",
        attributes: {
          custom_price: params.priceCents,
          product_options: {
            redirect_url: params.redirectUrl,
          },
          checkout_data: {
            email: params.userEmail,
            custom: {
              ...params.metadata,
              user_id: params.userId,
              product: params.product,
              metadata_signature: signature,
            },
          },
        },
        relationships: {
          store: {
            data: {
              type: "stores",
              id: process.env.LEMONSQUEEZY_STORE_ID || "1",
            },
          },
          variant: {
            data: {
              type: "variants",
              id: variantId,
            },
          },
        },
      },
    };

    const response = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Lemon Squeezy checkout creation failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { data?: { attributes?: { url?: string } } };
    const checkoutUrl = data.data?.attributes?.url;

    if (!checkoutUrl) {
      throw new Error("Lemon Squeezy response did not include a checkout URL");
    }

    return { checkoutUrl };
  }

  async verifyWebhookSignature(rawBody: string, headers: Headers): Promise<boolean> {
    const secret = process.env.PAYMENTS_WEBHOOK_SECRET;
    if (!secret) return false;

    const signature = headers.get("x-signature");
    if (!signature) return false;

    try {
      const hmac = crypto.createHmac("sha256", secret).update(rawBody);
      const expectedHex = hmac.digest("hex");
      const expectedBuf = Buffer.from(expectedHex, "hex");
      const actualBuf = Buffer.from(signature, "hex");

      if (expectedBuf.length !== actualBuf.length || expectedBuf.length === 0) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  async parseWebhookEvent(rawBody: string): Promise<WebhookEventResult> {
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { type: "ignored", provider: "lemonsqueezy", reason: "Invalid JSON payload" };
    }

    const eventName = body.meta?.event_name;
    const customData = body.meta?.custom_data ?? {};
    const data = body.data ?? {};
    const attributes = data.attributes ?? {};

    if (eventName === "order_created") {
      const orderId = String(data.id ?? "");
      const userId = customData.user_id ? String(customData.user_id) : undefined;
      const customerEmail = attributes.user_email ? String(attributes.user_email) : undefined;
      const product = String(customData.product ?? "lessons");
      const amountCents = Number(attributes.total ?? 0);
      const currency = String(attributes.currency ?? "usd").toLowerCase();
      const metadataSignature = customData.metadata_signature ? String(customData.metadata_signature) : undefined;

      if (!orderId) {
        return { type: "ignored", provider: "lemonsqueezy", reason: "order_created missing id" };
      }

      return {
        type: "order_paid",
        provider: "lemonsqueezy",
        orderId,
        userId,
        customerEmail,
        product,
        amountCents,
        currency,
        metadataSignature,
      };
    }

    if (eventName === "order_refunded") {
      const orderId = String(data.id ?? "");
      const userId = customData.user_id ? String(customData.user_id) : undefined;
      const product = customData.product ? (customData.product as ProductKey) : undefined;

      if (!orderId) {
        return { type: "ignored", provider: "lemonsqueezy", reason: "order_refunded missing id" };
      }

      return {
        type: "order_refunded",
        provider: "lemonsqueezy",
        orderId,
        userId,
        product,
      };
    }

    return {
      type: "ignored",
      provider: "lemonsqueezy",
      reason: `Unhandled event: ${eventName || "unknown"}`,
    };
  }
}
