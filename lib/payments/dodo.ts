import crypto from "node:crypto";
import { getPaymentsConfig, signMetadata } from "./config";
import type { CheckoutParams, PaymentProvider, ProductKey, WebhookEventResult } from "./types";

export class DodoPaymentProvider implements PaymentProvider {
  readonly name = "dodo" as const;

  getBaseUrl(apiKey?: string): string {
    const key = apiKey ?? process.env.PAYMENTS_API_KEY ?? "";
    return key.startsWith("dodo_test_") ? "https://test.dodopayments.com" : "https://live.dodopayments.com";
  }

  async createCheckout(params: CheckoutParams): Promise<{ checkoutUrl: string }> {
    const config = getPaymentsConfig();
    if (!config?.apiKey) {
      throw new Error("Dodo Payments API key is not configured");
    }

    const baseUrl = this.getBaseUrl(config.apiKey);
    const productId = config.productId || "p_lessons";
    const signature = signMetadata(params.userId, params.product, config.webhookSecret);

    const payload = {
      product_cart: [
        {
          product_id: productId,
          amount: params.priceCents,
          quantity: 1,
        },
      ],
      billing: {
        email: params.userEmail,
      },
      customer: {
        email: params.userEmail,
      },
      metadata: {
        ...params.metadata,
        user_id: params.userId,
        product: params.product,
        metadata_signature: signature,
      },
      return_url: params.redirectUrl,
    };

    const response = await fetch(`${baseUrl}/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Dodo Payments checkout creation failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { checkout_url?: string; payment_link?: string; url?: string };
    const checkoutUrl = data.checkout_url || data.payment_link || data.url;

    if (!checkoutUrl) {
      throw new Error("Dodo Payments response did not include a checkout URL");
    }

    return { checkoutUrl };
  }

  async verifyWebhookSignature(rawBody: string, headers: Headers): Promise<boolean> {
    const secret = process.env.PAYMENTS_WEBHOOK_SECRET;
    if (!secret) return false;

    const webhookId = headers.get("webhook-id");
    const webhookTimestamp = headers.get("webhook-timestamp");
    const webhookSignature = headers.get("webhook-signature");

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      return false;
    }

    // Replay attack prevention: verify timestamp is within +/- 300 seconds (5 minutes)
    const ts = parseInt(webhookTimestamp, 10);
    if (Number.isNaN(ts)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 300) {
      return false;
    }

    // Standard Webhooks secrets may be prefixed with 'whsec_' and base64-encoded
    let keyBuffer: Buffer;
    if (secret.startsWith("whsec_")) {
      keyBuffer = Buffer.from(secret.slice(6), "base64");
    } else {
      keyBuffer = Buffer.from(secret, "utf-8");
    }

    const signedPayload = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    const hmac = crypto.createHmac("sha256", keyBuffer).update(signedPayload);
    const expectedBase64 = hmac.digest("base64");
    const expectedHex = crypto.createHmac("sha256", keyBuffer).update(signedPayload).digest("hex");

    // Standard Webhooks signature header is space-delimited list of "v1,<sig>"
    const signatures = webhookSignature.split(" ");
    for (const item of signatures) {
      const [version, signatureValue] = item.split(",");
      if (version !== "v1" || !signatureValue) continue;

      // Check base64 encoding
      try {
        const expectedBuf = Buffer.from(expectedBase64, "base64");
        const actualBuf = Buffer.from(signatureValue, "base64");
        if (expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf)) {
          return true;
        }
      } catch {
        // Fall through to hex check
      }

      // Check hex encoding
      try {
        const expectedBuf = Buffer.from(expectedHex, "hex");
        const actualBuf = Buffer.from(signatureValue, "hex");
        if (expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf)) {
          return true;
        }
      } catch {
        // Continue
      }
    }

    return false;
  }

  async parseWebhookEvent(rawBody: string): Promise<WebhookEventResult> {
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { type: "ignored", provider: "dodo", reason: "Invalid JSON payload" };
    }

    const eventType = body.type;
    const data = body.data ?? {};

    if (eventType === "payment.succeeded") {
      const orderId = String(data.payment_id ?? data.id ?? "");
      const metadata = data.metadata ?? {};
      const userId = String(metadata.user_id ?? "");
      const product = (metadata.product ?? "lessons") as ProductKey;
      const amountCents = Number(data.total_amount ?? data.amount ?? 0);
      const currency = String(data.currency ?? "usd").toLowerCase();
      const metadataSignature = metadata.metadata_signature ? String(metadata.metadata_signature) : undefined;

      if (!orderId || !userId) {
        return {
          type: "ignored",
          provider: "dodo",
          reason: "payment.succeeded missing payment_id or user_id in metadata",
        };
      }

      return {
        type: "order_paid",
        provider: "dodo",
        orderId,
        userId,
        product,
        amountCents,
        currency,
        metadataSignature,
      };
    }

    if (eventType === "payment.refunded") {
      const orderId = String(data.payment_id ?? data.id ?? "");
      const metadata = data.metadata ?? {};
      const userId = metadata.user_id ? String(metadata.user_id) : undefined;
      const product = metadata.product ? (metadata.product as ProductKey) : undefined;

      if (!orderId) {
        return { type: "ignored", provider: "dodo", reason: "payment.refunded missing payment_id" };
      }

      return {
        type: "order_refunded",
        provider: "dodo",
        orderId,
        userId,
        product,
      };
    }

    if (eventType === "dispute.opened") {
      const orderId = String(data.payment_id ?? data.id ?? "");
      const metadata = data.metadata ?? {};
      const userId = metadata.user_id ? String(metadata.user_id) : undefined;
      const product = metadata.product ? (metadata.product as ProductKey) : undefined;

      if (!orderId) {
        return { type: "ignored", provider: "dodo", reason: "dispute.opened missing payment_id" };
      }

      return {
        type: "order_disputed",
        provider: "dodo",
        orderId,
        userId,
        product,
      };
    }

    return {
      type: "ignored",
      provider: "dodo",
      reason: `Unhandled event type: ${eventType}`,
    };
  }
}
