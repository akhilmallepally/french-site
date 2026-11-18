import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminConfig, verifyMetadataSignature } from "./config";
import type { WebhookEventResult } from "./types";

/**
 * Returns a dedicated server-only Supabase client with the service role key,
 * bypassing RLS to record purchases and process refunds.
 */
export function getAdminClient(): SupabaseClient {
  const config = getSupabaseAdminConfig();
  if (!config) {
    throw new Error(
      "Missing Supabase admin config: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
    );
  }

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export type ProcessWebhookOutcome = {
  outcome:
    | "granted"
    | "revoked"
    | "revoked_out_of_order"
    | "disputed"
    | "idempotent_no_op"
    | "idempotent_concurrent"
    | "already_refunded"
    | "invalid_metadata_signature"
    | "unknown_order_ignored"
    | "unknown_order_disputed"
    | "ignored";
  existingStatus?: string;
};

/**
 * Processes a verified webhook event with idempotent, monotonic state transitions.
 * Writes exclusively to public.purchases via the Supabase service role.
 *
 * Rules:
 * 1. order_paid: verifies signed metadata. If provider_order_id exists (whether active,
 *    refunded, or disputed), treats as idempotent no-op so out-of-order retries never
 *    resurrect a refunded entitlement. Otherwise inserts status = 'active'.
 * 2. order_refunded: updates row to status = 'refunded', refunded_at = now().
 * 3. order_disputed: updates row to status = 'disputed' (unless already refunded).
 * 4. DB errors throw to trigger upstream HTTP 500 retry backoff.
 * 5. Logs are strictly non-PII.
 */
export async function processWebhookEvent(
  event: WebhookEventResult,
  clientOverride?: SupabaseClient
): Promise<ProcessWebhookOutcome> {
  if (event.type === "ignored") {
    console.info(`[payments:webhook] Ignored event for ${event.provider}: ${event.reason}`);
    return { outcome: "ignored" };
  }

  const supabase = clientOverride ?? getAdminClient();

  if (event.type === "order_paid") {
    // Verify metadata signature if provided
    if (event.metadataSignature) {
      const valid = verifyMetadataSignature(event.userId, event.product, event.metadataSignature);
      if (!valid) {
        console.warn(
          `[payments:webhook] Signature mismatch for order: ${event.orderId}, product: ${event.product}`
        );
        return { outcome: "invalid_metadata_signature" };
      }
    }

    // Check existing record by provider_order_id (idempotency check)
    const { data: existing, error: selectError } = await supabase
      .from("purchases")
      .select("id, status")
      .eq("provider_order_id", event.orderId)
      .maybeSingle();

    if (selectError) {
      console.error(`[payments:webhook] Select error for order ${event.orderId}:`, selectError.message);
      throw selectError;
    }

    if (existing) {
      // Idempotent: record already exists. Never change status back from refunded or disputed.
      console.info(
        `[payments:webhook] Idempotent order_paid received for order: ${event.orderId}, current status: ${existing.status}`
      );
      return { outcome: "idempotent_no_op", existingStatus: existing.status };
    }

    // Insert new active entitlement
    const { error: insertError } = await supabase.from("purchases").insert({
      user_id: event.userId,
      product: event.product,
      status: "active",
      provider: event.provider,
      provider_order_id: event.orderId,
      amount: event.amountCents,
      currency: event.currency,
    });

    if (insertError) {
      // Handle race condition where two identical webhook deliveries insert simultaneously
      if (insertError.code === "23505") {
        console.info(`[payments:webhook] Concurrent insert for order: ${event.orderId}, resolved gracefully.`);
        return { outcome: "idempotent_concurrent" };
      }
      console.error(`[payments:webhook] Insert error for order ${event.orderId}:`, insertError.message);
      throw insertError;
    }

    console.info(
      `[payments:webhook] Granted access for order: ${event.orderId}, product: ${event.product}, provider: ${event.provider}`
    );
    return { outcome: "granted" };
  }

  if (event.type === "order_refunded") {
    const { data: existing, error: selectError } = await supabase
      .from("purchases")
      .select("id, status")
      .eq("provider_order_id", event.orderId)
      .maybeSingle();

    if (selectError) {
      console.error(`[payments:webhook] Select error for refund on order ${event.orderId}:`, selectError.message);
      throw selectError;
    }

    if (existing) {
      if (existing.status === "refunded") {
        console.info(`[payments:webhook] Order ${event.orderId} already refunded.`);
        return { outcome: "already_refunded" };
      }

      const { error: updateError } = await supabase
        .from("purchases")
        .update({
          status: "refunded",
          refunded_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error(`[payments:webhook] Refund update error for order ${event.orderId}:`, updateError.message);
        throw updateError;
      }

      console.info(`[payments:webhook] Revoked access for order: ${event.orderId}`);
      return { outcome: "revoked" };
    }

    // Out-of-order handling: refund webhook arrived before order_paid webhook
    if (event.userId && event.product) {
      const { error: insertError } = await supabase.from("purchases").insert({
        user_id: event.userId,
        product: event.product,
        status: "refunded",
        provider: event.provider,
        provider_order_id: event.orderId,
        amount: 0,
        currency: "usd",
        refunded_at: new Date().toISOString(),
      });

      if (insertError) {
        if (insertError.code === "23505") {
          return { outcome: "already_refunded" };
        }
        console.error(`[payments:webhook] Out-of-order refund insert error for order ${event.orderId}:`, insertError.message);
        throw insertError;
      }

      console.info(`[payments:webhook] Recorded out-of-order refund for order: ${event.orderId}`);
      return { outcome: "revoked_out_of_order" };
    }

    console.warn(`[payments:webhook] Refund arrived for untracked order ${event.orderId}`);
    return { outcome: "unknown_order_ignored" };
  }

  if (event.type === "order_disputed") {
    const { data: existing, error: selectError } = await supabase
      .from("purchases")
      .select("id, status")
      .eq("provider_order_id", event.orderId)
      .maybeSingle();

    if (selectError) {
      console.error(`[payments:webhook] Select error for dispute on order ${event.orderId}:`, selectError.message);
      throw selectError;
    }

    if (existing) {
      if (existing.status === "refunded") {
        return { outcome: "already_refunded" };
      }

      const { error: updateError } = await supabase
        .from("purchases")
        .update({ status: "disputed" })
        .eq("id", existing.id);

      if (updateError) {
        console.error(`[payments:webhook] Dispute update error for order ${event.orderId}:`, updateError.message);
        throw updateError;
      }

      console.info(`[payments:webhook] Marked order ${event.orderId} as disputed`);
      return { outcome: "disputed" };
    }

    return { outcome: "unknown_order_disputed" };
  }

  return { outcome: "ignored" };
}
