import { NextResponse } from "next/server";
import { getPaymentsConfig, getSupabaseAdminConfig } from "@/lib/payments/config";
import { getPaymentProvider } from "@/lib/payments/provider";
import { revalidateTag } from "next/cache";
import { processWebhookEvent } from "@/lib/payments/webhook";
import { PRICING_TAG, pricingChangingOutcome } from "@/lib/pricing-source";

export async function POST(request: Request) {
  // Fail closed if payment secrets or Supabase admin credentials are not configured
  const paymentsConfig = getPaymentsConfig();
  const supabaseAdminConfig = getSupabaseAdminConfig();

  if (!paymentsConfig || !supabaseAdminConfig) {
    console.error(
      "[payments:route] Webhook received but payments or Supabase admin credentials are not configured."
    );
    return new Response("Payment webhook service unconfigured", { status: 500 });
  }

  // 1. Read raw text body before any parsing (required for cryptographic verification)
  const rawBody = await request.text();

  // 2. Select active payment provider
  const provider = getPaymentProvider(paymentsConfig.provider);

  // 3. Verify webhook signature and timestamp freshness
  const isValidSignature = await provider.verifyWebhookSignature(rawBody, request.headers);
  if (!isValidSignature) {
    console.warn(`[payments:route] Invalid webhook signature or stale timestamp for ${provider.name}`);
    return new Response("Invalid signature", { status: 401 });
  }

  // 4. Parse the event payload
  const event = await provider.parseWebhookEvent(rawBody);

  if (event.type === "ignored") {
    return NextResponse.json(
      { received: true, ignored: true, reason: event.reason },
      { status: 200 }
    );
  }

  // 5. Process the event. It returns normally (HTTP 200) when the event was applied, was a resend,
  // or was recorded in unmatched_payment_events; it throws only for errors worth retrying.
  // The Standard Webhooks message id (Dodo) is kept with any unmatched event so it can be found.
  const eventId = request.headers.get("webhook-id");
  try {
    const result = await processWebhookEvent(event, undefined, { eventId });
    // A purchase was recorded, refunded or disputed: the founder spots (and so the price shown) may
    // have changed. Expire the shared price now, so the next visitor reads it fresh.
    if (pricingChangingOutcome(result.outcome)) revalidateTag(PRICING_TAG, { expire: 0 });
    return NextResponse.json(
      { received: true, outcome: result.outcome, ...(result.reason ? { reason: result.reason } : {}) },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "[payments:route] Retryable error processing webhook:",
      error instanceof Error ? error.message : error
    );
    // Return 500 so the provider retries automatically
    return new Response("Internal Server Error", { status: 500 });
  }
}
