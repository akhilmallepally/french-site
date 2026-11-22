import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminConfig, verifyMetadataSignature } from "./config";
import type { ProductKey, ProviderName, WebhookEventResult } from "./types";

/**
 * Returns a dedicated server-only Supabase client with the service role key. It has exactly the
 * privileges granted in supabase/migrations/0007_service_role_grants.sql: select, insert and
 * update on purchases, select and insert on unmatched_payment_events, and find_user_id_by_email().
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

/** Where events that can't be applied are recorded (see docs/payments-recovery.md). */
export const UNMATCHED_TABLE = "unmatched_payment_events";

export type UnmatchedReason =
  | "no_matching_user"
  | "invalid_metadata_signature"
  | "unknown_product"
  | "invalid_amount"
  | "invalid_currency"
  | "invalid_data"
  | "refund_unknown_order"
  | "dispute_unknown_order"
  | "paid_after_refund_or_dispute";

export type ProcessWebhookOutcome = {
  outcome:
    | "granted"
    | "revoked"
    | "revoked_out_of_order"
    | "disputed"
    | "idempotent_no_op"
    | "idempotent_concurrent"
    | "already_refunded"
    | "unmatched_recorded"
    | "ignored";
  existingStatus?: string;
  matchedBy?: "metadata" | "email";
  reason?: UnmatchedReason;
};

/** Facts about the delivery that aren't in the event body (the Standard Webhooks message id). */
export type WebhookContext = { eventId?: string | null };

type DbError = { code?: string; message?: string } | null | undefined;

const PRODUCTS: readonly ProductKey[] = ["lessons", "pro", "max"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_RE = /^[a-z]{3}$/;

const isProductKey = (value: unknown): value is ProductKey => PRODUCTS.includes(value as ProductKey);
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

/**
 * Whether retrying the same event later could succeed. Postgres classes 22 (data exception) and 23
 * (integrity constraint) can't: the same data fails the same way. Everything else can, because it's
 * a connection problem, an outage or a configuration error the owner can fix (for example a missing
 * grant, 42501): the provider retries on HTTP 500.
 */
export function isRetryable(error: DbError): boolean {
  return !/^(22|23)/.test(error?.code ?? "");
}

class RetryableError extends Error {
  constructor(where: string, error: DbError) {
    super(`${where}: ${error?.code ?? "no code"} ${error?.message ?? ""}`.trim());
  }
}

function fail(where: string, error: DbError): never {
  console.error(`[payments:webhook] ${where}:`, error?.code ?? "", error?.message ?? "");
  throw new RetryableError(where, error);
}

async function findPurchase(supabase: SupabaseClient, orderId: string) {
  const { data, error } = await supabase
    .from("purchases")
    .select("id, status")
    .eq("provider_order_id", orderId)
    .maybeSingle();
  if (error) fail(`select purchase ${orderId}`, error);
  return data as { id: number; status: string } | null;
}

/**
 * Records an event that can't be applied, once per (provider, order, reason), and returns 200.
 * Only a retryable failure to record it throws (HTTP 500), so the event is never lost silently.
 */
async function recordUnmatched(
  supabase: SupabaseClient,
  event: { type: "order_paid" | "order_refunded" | "order_disputed"; provider: ProviderName; orderId: string },
  reason: UnmatchedReason,
  context: WebhookContext,
  details: { product?: string; amountCents?: number; currency?: string } = {}
): Promise<ProcessWebhookOutcome> {
  const { error } = await supabase.from(UNMATCHED_TABLE).insert({
    provider: event.provider,
    provider_order_id: event.orderId.slice(0, 200),
    event_type: event.type,
    event_id: context.eventId ? String(context.eventId).slice(0, 200) : null,
    reason,
    product: details.product ? String(details.product).slice(0, 40) : null,
    amount: Number.isSafeInteger(details.amountCents) ? details.amountCents : null,
    currency: details.currency ? String(details.currency).slice(0, 10) : null,
  });

  if (error && error.code !== "23505") {
    if (isRetryable(error)) fail(`record unmatched ${event.orderId}`, error);
    // A data error while recording: retrying can't fix it. Log enough to find it, and stop.
    console.error(
      `[payments:webhook] Could not record unmatched event: provider=${event.provider} order=${event.orderId} event=${context.eventId ?? "-"} reason=${reason} code=${error.code}`
    );
  } else {
    console.warn(
      `[payments:webhook] Unmatched event recorded in ${UNMATCHED_TABLE}: provider=${event.provider} order=${event.orderId} event=${context.eventId ?? "-"} reason=${reason}${error ? " (already recorded)" : ""}`
    );
  }
  return { outcome: "unmatched_recorded", reason };
}

type InsertResult = "inserted" | "duplicate" | "no_such_user" | "bad_data";

async function insertPurchase(supabase: SupabaseClient, row: Record<string, unknown>): Promise<InsertResult> {
  const { error } = await supabase.from("purchases").insert(row);
  if (!error) return "inserted";
  if (error.code === "23505") return "duplicate"; // same provider_order_id: a resend raced us
  if (error.code === "23503") return "no_such_user"; // user_id not in auth.users (deleted account)
  if (!isRetryable(error)) {
    console.error(`[payments:webhook] Purchase rejected by the database (${error.code}) for order ${String(row.provider_order_id)}`);
    return "bad_data";
  }
  fail(`insert purchase ${String(row.provider_order_id)}`, error);
}

async function findUserIdByEmail(supabase: SupabaseClient, email: string | undefined): Promise<string | null> {
  if (!email || !email.trim()) return null;
  const { data, error } = await supabase.rpc("find_user_id_by_email", { p_email: email });
  if (error) {
    if (isRetryable(error)) fail("find_user_id_by_email", error);
    return null;
  }
  return isUuid(data) ? data : null;
}

async function handlePaid(
  supabase: SupabaseClient,
  event: Extract<WebhookEventResult, { type: "order_paid" }>,
  context: WebhookContext
): Promise<ProcessWebhookOutcome> {
  const details = { product: event.product, amountCents: event.amountCents, currency: event.currency };

  // 1. Idempotent on the provider's payment id: a resend never creates a second row, and never
  //    changes a refunded or disputed purchase back to active.
  const existing = await findPurchase(supabase, event.orderId);
  if (existing) {
    console.info(`[payments:webhook] Resent payment for order ${event.orderId}, status ${existing.status}: no change.`);
    return { outcome: "idempotent_no_op", existingStatus: existing.status };
  }

  // 2. Values the database would refuse: record them instead of failing forever.
  if (!isProductKey(event.product)) return recordUnmatched(supabase, event, "unknown_product", context, details);
  if (!Number.isSafeInteger(event.amountCents) || event.amountCents < 0) {
    return recordUnmatched(supabase, event, "invalid_amount", context, details);
  }
  if (!CURRENCY_RE.test(event.currency)) return recordUnmatched(supabase, event, "invalid_currency", context, details);

  // 3. A refund or dispute for this order arrived first (and couldn't be matched): never grant.
  const { data: earlier, error: earlierError } = await supabase
    .from(UNMATCHED_TABLE)
    .select("reason")
    .eq("provider", event.provider)
    .eq("provider_order_id", event.orderId)
    .in("reason", ["refund_unknown_order", "dispute_unknown_order"]);
  if (earlierError) fail(`select earlier refunds ${event.orderId}`, earlierError);
  if (earlier && earlier.length > 0) {
    return recordUnmatched(supabase, event, "paid_after_refund_or_dispute", context, details);
  }

  const row = (userId: string) => ({
    user_id: userId,
    product: event.product,
    status: "active",
    provider: event.provider,
    provider_order_id: event.orderId,
    amount: event.amountCents,
    currency: event.currency,
  });

  // 4. Match the buyer: the checkout metadata user id first (signature checked when present).
  const signatureOk =
    !event.metadataSignature || (!!event.userId && verifyMetadataSignature(event.userId, event.product, event.metadataSignature));
  if (!signatureOk) {
    console.warn(`[payments:webhook] Metadata signature mismatch for order ${event.orderId}: falling back to the email.`);
  }

  if (signatureOk && isUuid(event.userId)) {
    const result = await insertPurchase(supabase, row(event.userId));
    if (result === "inserted") {
      console.info(`[payments:webhook] Granted access for order ${event.orderId} (matched by metadata).`);
      return { outcome: "granted", matchedBy: "metadata" };
    }
    if (result === "duplicate") return { outcome: "idempotent_concurrent" };
    if (result === "bad_data") return recordUnmatched(supabase, event, "invalid_data", context, details);
    // no_such_user: fall through to the email.
  }

  // 5. Fallback: the buyer's email, compared without regard to case.
  const emailUserId = await findUserIdByEmail(supabase, event.customerEmail);
  if (emailUserId) {
    const result = await insertPurchase(supabase, row(emailUserId));
    if (result === "inserted") {
      console.info(`[payments:webhook] Granted access for order ${event.orderId} (matched by email).`);
      return { outcome: "granted", matchedBy: "email" };
    }
    if (result === "duplicate") return { outcome: "idempotent_concurrent" };
    if (result === "bad_data") return recordUnmatched(supabase, event, "invalid_data", context, details);
  }

  // 6. Nobody matches: record it (HTTP 200) so the provider stops retrying and the owner can act.
  return recordUnmatched(supabase, event, signatureOk ? "no_matching_user" : "invalid_metadata_signature", context, details);
}

async function handleRefunded(
  supabase: SupabaseClient,
  event: Extract<WebhookEventResult, { type: "order_refunded" }>,
  context: WebhookContext
): Promise<ProcessWebhookOutcome> {
  // Two passes at most: if the out-of-order insert collides with a payment row that was just
  // written, the second pass refunds that row.
  for (let pass = 0; pass < 2; pass++) {
    const existing = await findPurchase(supabase, event.orderId);

    if (existing) {
      if (existing.status === "refunded") return { outcome: "already_refunded" };
      const { error } = await supabase
        .from("purchases")
        .update({ status: "refunded", refunded_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) {
        if (isRetryable(error)) fail(`refund order ${event.orderId}`, error);
        return recordUnmatched(supabase, event, "invalid_data", context);
      }
      console.info(`[payments:webhook] Revoked access for order ${event.orderId} (refunded).`);
      return { outcome: "revoked" };
    }

    // The refund arrived before the payment: record a refunded row so the later payment event
    // finds it and grants nothing.
    if (!isUuid(event.userId) || !isProductKey(event.product)) break;
    const result = await insertPurchase(supabase, {
      user_id: event.userId,
      product: event.product,
      status: "refunded",
      provider: event.provider,
      provider_order_id: event.orderId,
      amount: 0,
      currency: "usd",
      refunded_at: new Date().toISOString(),
    });
    if (result === "inserted") {
      console.info(`[payments:webhook] Recorded out-of-order refund for order ${event.orderId}.`);
      return { outcome: "revoked_out_of_order" };
    }
    if (result !== "duplicate") break; // no such user, or bad data
  }

  return recordUnmatched(supabase, event, "refund_unknown_order", context);
}

async function handleDisputed(
  supabase: SupabaseClient,
  event: Extract<WebhookEventResult, { type: "order_disputed" }>,
  context: WebhookContext
): Promise<ProcessWebhookOutcome> {
  const existing = await findPurchase(supabase, event.orderId);
  if (!existing) return recordUnmatched(supabase, event, "dispute_unknown_order", context);
  if (existing.status === "refunded") return { outcome: "already_refunded" };
  if (existing.status === "disputed") return { outcome: "idempotent_no_op", existingStatus: "disputed" };

  const { error } = await supabase.from("purchases").update({ status: "disputed" }).eq("id", existing.id);
  if (error) {
    if (isRetryable(error)) fail(`dispute order ${event.orderId}`, error);
    return recordUnmatched(supabase, event, "invalid_data", context);
  }
  console.info(`[payments:webhook] Marked order ${event.orderId} as disputed (access suspended).`);
  return { outcome: "disputed" };
}

/**
 * Processes a verified webhook event. Writes only through the service-role client.
 *
 * - Payment: idempotent on the provider payment id. Matches the buyer by the checkout metadata
 *   user id (its signature checked when present), then by email without regard to case. If nobody
 *   matches, or the data can't be stored, the event is recorded in unmatched_payment_events and
 *   the caller returns 200.
 * - Refund: marks the purchase refunded (access ends). If the refund arrives first, it records a
 *   refunded row (when the metadata names a user) or an unmatched event, so the later payment
 *   never grants access.
 * - Dispute: marks the purchase disputed (access suspended) unless it's already refunded.
 * - Throws only for errors worth retrying (the route returns 500). Logs never include emails.
 */
export async function processWebhookEvent(
  event: WebhookEventResult,
  clientOverride?: SupabaseClient,
  context: WebhookContext = {}
): Promise<ProcessWebhookOutcome> {
  if (event.type === "ignored") {
    console.info(`[payments:webhook] Ignored event for ${event.provider}: ${event.reason}`);
    return { outcome: "ignored" };
  }

  const supabase = clientOverride ?? getAdminClient();

  if (event.type === "order_paid") return handlePaid(supabase, event, context);
  if (event.type === "order_refunded") return handleRefunded(supabase, event, context);
  if (event.type === "order_disputed") return handleDisputed(supabase, event, context);
  return { outcome: "ignored" };
}
