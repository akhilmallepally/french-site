import crypto from "node:crypto";
import { getPaymentsConfig, getYearlyProductId, signMetadata } from "./config";
import type { CheckoutParams, PaymentProvider, ProductKey, ProductPrice, SubscriptionEventKind, WebhookEventResult } from "./types";

/** The subscription events we act on (docs/plans/subscription.md, section 2). */
const SUBSCRIPTION_KINDS: Record<string, SubscriptionEventKind> = {
  "subscription.active": "active",
  "subscription.renewed": "renewed",
  "subscription.updated": "updated",
  "subscription.past_due": "past_due",
  "subscription.on_hold": "on_hold",
  "subscription.cancelled": "cancelled",
  "subscription.expired": "expired",
};
/** Subscription events we receive but don't use: one plan, no pausing, and creation failures change nothing. */
const SUBSCRIPTION_IGNORED = new Set(["subscription.failed", "subscription.paused", "subscription.unpaused", "subscription.plan_changed", "subscription.update_payment_method"]);

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const isoOrUndefined = (v: unknown): string | undefined => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined);

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
    const yearly = params.plan === "yearly";
    const yearlyId = getYearlyProductId();
    if (yearly && !yearlyId) throw new Error("PAYMENTS_YEARLY_PRODUCT_ID is not configured");
    const signature = signMetadata(params.userId, params.product, config.webhookSecret);

    // The yearly plan: the subscription product at its own price (already checked against ours).
    // The lifetime plan: the one-time product at the founder price, as before.
    const cartItem = yearly
      ? { product_id: yearlyId as string, quantity: 1 }
      : { product_id: config.productId || "p_lessons", amount: params.priceCents, quantity: 1 };

    // The same customer email, signed metadata and return URL for both plans.
    const payload = {
      product_cart: [cartItem],
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

  /**
   * The product's price (GET /products/{id}): price.price in cents, its currency, and for a
   * subscription payment_frequency_interval and _count. Null when it can't be read or has another shape.
   */
  async getProductPrice(productId: string): Promise<ProductPrice | null> {
    const config = getPaymentsConfig();
    if (!config?.apiKey) return null;
    const response = await fetch(`${this.getBaseUrl(config.apiKey)}/products/${encodeURIComponent(productId)}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.warn("[payments:dodo] product price read failed, status:", response.status);
      return null;
    }
    return parseProductPrice(await response.json().catch(() => null));
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
    // The envelope's time (Standard Webhooks "timestamp"): used to ignore an older event arriving late.
    const eventAt = isoOrUndefined(body.timestamp) ?? new Date().toISOString();

    if (typeof eventType === "string" && SUBSCRIPTION_KINDS[eventType]) {
      const subscriptionId = text(data.subscription_id);
      if (!subscriptionId) return { type: "ignored", provider: "dodo", reason: `${eventType} missing subscription_id` };
      const metadata = data.metadata ?? {};
      return {
        type: "subscription",
        provider: "dodo",
        kind: SUBSCRIPTION_KINDS[eventType],
        subscriptionId,
        customerId: text(data.customer?.customer_id),
        productId: text(data.product_id),
        userId: metadata.user_id ? String(metadata.user_id) : undefined,
        product: metadata.product ? String(metadata.product) : undefined,
        metadataSignature: metadata.metadata_signature ? String(metadata.metadata_signature) : undefined,
        customerEmail: text(data.customer?.email),
        nextBillingDate: isoOrUndefined(data.next_billing_date),
        cancelAtNextBillingDate: data.cancel_at_next_billing_date === true,
        cancelledAt: isoOrUndefined(data.cancelled_at),
        eventAt,
      };
    }
    if (typeof eventType === "string" && SUBSCRIPTION_IGNORED.has(eventType)) {
      return { type: "ignored", provider: "dodo", reason: `${eventType}: not used (one yearly plan, no pausing)` };
    }
    if (eventType === "payment.failed") {
      return { type: "ignored", provider: "dodo", reason: "payment.failed: logged only (the subscription events change access)" };
    }

    // A charge of a subscription: recorded against it, never treated as a lifetime purchase.
    if (eventType === "payment.succeeded" && text(data.subscription_id)) {
      const paymentId = String(data.payment_id ?? "");
      if (!paymentId) return { type: "ignored", provider: "dodo", reason: "payment.succeeded missing payment_id" };
      return {
        type: "subscription_paid",
        provider: "dodo",
        paymentId,
        subscriptionId: String(data.subscription_id),
        amountCents: Number(data.total_amount ?? data.amount ?? 0),
        currency: String(data.currency ?? "usd").toLowerCase(),
      };
    }

    if (eventType === "payment.succeeded") {
      const orderId = String(data.payment_id ?? data.id ?? "");
      const metadata = data.metadata ?? {};
      const userId = metadata.user_id ? String(metadata.user_id) : undefined;
      const customerEmail = data.customer?.email ?? data.billing?.email;
      const product = String(metadata.product ?? "lessons");
      const amountCents = Number(data.total_amount ?? data.amount ?? 0);
      const currency = String(data.currency ?? "usd").toLowerCase();
      const metadataSignature = metadata.metadata_signature ? String(metadata.metadata_signature) : undefined;

      // Without a payment id there is nothing to key the purchase on. A missing user id is fine:
      // the processor falls back to the buyer's email, then records the event as unmatched.
      if (!orderId) {
        return { type: "ignored", provider: "dodo", reason: "payment.succeeded missing payment_id" };
      }

      return {
        type: "order_paid",
        provider: "dodo",
        orderId,
        userId,
        customerEmail: customerEmail ? String(customerEmail) : undefined,
        product,
        amountCents,
        currency,
        metadataSignature,
      };
    }

    if (eventType === "payment.refunded" || eventType === "refund.succeeded") {
      const orderId = String(data.payment_id ?? data.id ?? "");
      const metadata = data.metadata ?? {};
      const userId = metadata.user_id ? String(metadata.user_id) : undefined;
      const product = metadata.product ? (metadata.product as ProductKey) : undefined;

      if (!orderId) {
        return { type: "ignored", provider: "dodo", reason: `${eventType} missing payment_id` };
      }

      return {
        type: "order_refunded",
        provider: "dodo",
        orderId,
        userId,
        product,
      };
    }

    if (eventType === "dispute.won") {
      const orderId = String(data.payment_id ?? "");
      if (!orderId) return { type: "ignored", provider: "dodo", reason: "dispute.won missing payment_id" };
      return { type: "order_dispute_won", provider: "dodo", orderId };
    }
    if (eventType === "dispute.lost") {
      // Access already ended when the dispute opened; it stays ended.
      return { type: "ignored", provider: "dodo", reason: "dispute.lost: access stays ended" };
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

/** Dodo's product price object, defensively: { price: { price, currency, payment_frequency_interval, payment_frequency_count } }. */
export function parseProductPrice(body: unknown): ProductPrice | null {
  const price = (body as { price?: Record<string, unknown> } | null)?.price;
  if (!price || typeof price !== "object") return null;
  const cents = price.price;
  const currency = price.currency;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || typeof currency !== "string") return null;
  const interval = typeof price.payment_frequency_interval === "string" ? price.payment_frequency_interval : null;
  const count = typeof price.payment_frequency_count === "number" ? price.payment_frequency_count : null;
  return { priceCents: cents, currency, interval, intervalCount: count };
}
