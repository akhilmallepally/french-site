import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminConfig, getYearlyProductId, verifyMetadataSignature } from "./config";
import { getPaymentProvider } from "./provider";
import type { ProductKey, ProviderName, WebhookEventResult } from "./types";

/**
 * Returns a dedicated server-only Supabase client with the service role key. It has exactly the
 * privileges granted in supabase/migrations/0007_service_role_grants.sql (select, insert and
 * update on purchases, select and insert on unmatched_payment_events, find_user_id_by_email()) and
 * 0010 (select, insert and update on subscriptions and subscription_payments).
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
  | "paid_after_refund_or_dispute"
  | "subscription_unknown";

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
    | "ignored"
    | "restored"
    | "subscription_saved"
    | "subscription_stale"
    | "subscription_payment_recorded";
  existingStatus?: string;
  matchedBy?: "metadata" | "email";
  reason?: UnmatchedReason;
};

/**
 * Facts about the delivery that aren't in the event body (the Standard Webhooks message id), and
 * how to run follow-up work:
 * - `defer`: runs a task after the 200 reply (the route passes Next's after()). Without it the task
 *   runs before returning (tests, scripts). A deferred task never throws.
 * - `cancelInProvider`: cancels a subscription in the provider (tests inject a fake; the default is
 *   the provider's cancelSubscription with the server's API key).
 */
export type WebhookContext = {
  eventId?: string | null;
  defer?: (task: () => Promise<void>) => void;
  cancelInProvider?: (provider: ProviderName, subscriptionId: string) => Promise<"cancelled" | "already">;
};

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
/** unmatched_payment_events.event_type for each event (0011 added the subscription ones). */
const UNMATCHED_TYPE: Record<string, string> = {
  order_paid: "order_paid",
  order_refunded: "order_refunded",
  order_disputed: "order_disputed",
  order_dispute_won: "order_disputed",
  subscription: "subscription_event",
  subscription_paid: "subscription_payment",
};

async function recordUnmatched(
  supabase: SupabaseClient,
  event: { type: string; provider: ProviderName; orderId: string },
  reason: UnmatchedReason,
  context: WebhookContext,
  details: { product?: string; amountCents?: number; currency?: string } = {}
): Promise<ProcessWebhookOutcome> {
  const { error } = await supabase.from(UNMATCHED_TABLE).insert({
    provider: event.provider,
    provider_order_id: event.orderId.slice(0, 200),
    event_type: UNMATCHED_TYPE[event.type] ?? event.type,
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
  // A subscription charge: the refund ends the subscription's access at once (rules, section 4).
  const subPayment = await findSubscriptionPayment(supabase, event.orderId);
  if (subPayment) return setSubscriptionPaymentStatus(supabase, subPayment, "refunded", event.orderId, context);

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
  const subPayment = await findSubscriptionPayment(supabase, event.orderId);
  if (subPayment) return setSubscriptionPaymentStatus(supabase, subPayment, "disputed", event.orderId, context);

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

// ---------- Subscriptions (docs/plans/subscription.md, rollout step 2) ----------

type SubscriptionRow = {
  id: number;
  user_id: string;
  status: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  last_event_at: string | null;
};
type SubscriptionPaymentRow = { id: number; subscription_id: number; status: string };

/** Statuses only a refund or a dispute sets; the subscription's own events never undo them. */
const ENDED_BY_US = new Set(["refunded", "disputed"]);

async function findSubscription(supabase: SupabaseClient, subscriptionId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, user_id, status, current_period_end, cancel_at_period_end, cancelled_at, last_event_at")
    .eq("provider_subscription_id", subscriptionId)
    .maybeSingle();
  if (error) fail(`select subscription ${subscriptionId}`, error);
  return data as SubscriptionRow | null;
}

async function findSubscriptionPayment(supabase: SupabaseClient, paymentId: string): Promise<SubscriptionPaymentRow | null> {
  const { data, error } = await supabase
    .from("subscription_payments")
    .select("id, subscription_id, status")
    .eq("provider_payment_id", paymentId)
    .maybeSingle();
  if (error) fail(`select subscription payment ${paymentId}`, error);
  return data as SubscriptionPaymentRow | null;
}

/** A refund or dispute of a subscription charge (or a won dispute): the payment and its subscription. */
async function setSubscriptionPaymentStatus(
  supabase: SupabaseClient,
  payment: SubscriptionPaymentRow,
  to: "refunded" | "disputed" | "succeeded",
  paymentId: string,
  context: WebhookContext
): Promise<ProcessWebhookOutcome> {
  if (payment.status === "refunded") {
    // A resent refund: retry the provider cancellation if it hasn't been confirmed yet.
    if (to === "refunded") await requestProviderCancel(supabase, payment.subscription_id, "refunded", context);
    return { outcome: "already_refunded" };
  }
  if (payment.status === to) return { outcome: "idempotent_no_op", existingStatus: to };
  if (to === "succeeded" && payment.status !== "disputed") return { outcome: "idempotent_no_op", existingStatus: payment.status };
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("subscription_payments")
    .update(to === "refunded" ? { status: "refunded", refunded_at: now } : { status: to })
    .eq("id", payment.id);
  if (error) {
    if (isRetryable(error)) fail(`${to} subscription payment ${paymentId}`, error);
    return recordUnmatched(supabase, { type: "subscription_paid", provider: "dodo", orderId: paymentId }, "invalid_data", context);
  }
  // The subscription: refunded and disputed end access at once; a won dispute gives it back.
  const subStatus = to === "succeeded" ? "active" : to;
  const { error: subError } = await supabase
    .from("subscriptions")
    .update(to === "succeeded" ? { status: subStatus, cancelled_at: null } : { status: subStatus })
    .eq("id", payment.subscription_id);
  if (subError) fail(`${to} subscription ${payment.subscription_id}`, subError);
  console.info(`[payments:webhook] Subscription payment ${paymentId} ${to}: subscription ${subStatus}.`);
  // A refund ends the subscription here; cancel it in the provider too, so it never renews.
  if (to === "refunded") await requestProviderCancel(supabase, payment.subscription_id, "refunded", context);
  return { outcome: to === "refunded" ? "revoked" : to === "disputed" ? "disputed" : "restored" };
}

/**
 * A subscription event. Upserts the row keyed on the provider's subscription id:
 * - active and renewed: status active, the period end from next_billing_date (a recovery from on_hold
 *   too); updated: the cancel-at-period-end flag and the next billing date; past_due, on_hold,
 *   cancelled and expired: that status (cancelled keeps "at the period end" when it was set before).
 * - A refunded or disputed subscription stays so: only a refund or dispute event changes that.
 * - An event older than the last one applied (last_event_at) is ignored, so a late delivery never
 *   undoes a newer state. Equal times apply (each event sets a whole state; resends change nothing).
 * - A new row needs the buyer (signed metadata, else the email, as for purchases), the yearly
 *   product (PAYMENTS_YEARLY_PRODUCT_ID) and a valid next billing date; otherwise it's recorded as
 *   unmatched (HTTP 200).
 */
async function handleSubscription(
  supabase: SupabaseClient,
  event: Extract<WebhookEventResult, { type: "subscription" }>,
  context: WebhookContext
): Promise<ProcessWebhookOutcome> {
  const unmatchedEvent = { type: "subscription", provider: event.provider, orderId: event.subscriptionId };
  const yearly = getYearlyProductId();
  if (!yearly || event.productId !== yearly) {
    return recordUnmatched(supabase, unmatchedEvent, "unknown_product", context, { product: event.productId });
  }
  const product = event.product ?? "lessons";
  if (!isProductKey(product)) return recordUnmatched(supabase, unmatchedEvent, "unknown_product", context, { product });

  const existing = await findSubscription(supabase, event.subscriptionId);
  if (existing?.last_event_at && Date.parse(existing.last_event_at) > Date.parse(event.eventAt)) {
    console.info(`[payments:webhook] Older ${event.kind} event for subscription ${event.subscriptionId}: ignored (a newer one was applied).`);
    return { outcome: "subscription_stale" };
  }

  // The state this event describes.
  const periodEnd = event.nextBillingDate ?? existing?.current_period_end;
  // Final states (Prompt 84): a refunded or disputed subscription takes nothing from a later
  // subscription event (cancelled, updated, active, expired...): only its time is noted. Only
  // dispute.won restores it.
  const keepEnded = !!existing && ENDED_BY_US.has(existing.status);
  const next: Record<string, unknown> = { last_event_at: event.eventAt };
  if (event.customerId) next.provider_customer_id = event.customerId.slice(0, 200);
  if (!keepEnded) {
    if (periodEnd && (event.kind === "active" || event.kind === "renewed" || event.kind === "updated")) next.current_period_end = periodEnd;
    if (event.kind !== "cancelled") next.cancel_at_period_end = event.cancelAtNextBillingDate;
    if (event.kind === "active" || event.kind === "renewed") Object.assign(next, { status: "active", cancelled_at: null });
    else if (event.kind === "past_due" || event.kind === "on_hold" || event.kind === "expired") next.status = event.kind;
    else if (event.kind === "cancelled") {
      // Decided from the event, never from the stored flag (Prompt 84). At the period end when Dodo
      // says so (cancel_at_next_billing_date), or when the cancellation came at the end of the paid
      // period anyway: access to current_period_end. Otherwise (the flag false and cancelled_at
      // clearly before the period end) it's an immediate cancel: access ends at cancelled_at, and
      // the flag is cleared.
      const cancelledAt = event.cancelledAt ?? event.eventAt;
      const endMs = periodEnd ? Date.parse(periodEnd) : NaN;
      const atPeriodEnd = event.cancelAtNextBillingDate || (Number.isFinite(endMs) && Date.parse(cancelledAt) >= endMs - IMMEDIATE_CANCEL_MARGIN_MS);
      Object.assign(next, { status: "cancelled", cancelled_at: cancelledAt, cancel_at_period_end: atPeriodEnd });
    }
  }

  if (existing) {
    const { error } = await supabase.from("subscriptions").update(next).eq("id", existing.id);
    if (error) {
      if (isRetryable(error)) fail(`update subscription ${event.subscriptionId}`, error);
      return recordUnmatched(supabase, unmatchedEvent, "invalid_data", context);
    }
    console.info(`[payments:webhook] Subscription ${event.subscriptionId}: ${keepEnded ? `${event.kind} noted (it stays ${existing.status})` : `${event.kind} applied`}.`);
    // Dodo's own cancellation (or the end) confirms a cancellation we asked for.
    if (event.kind === "cancelled" || event.kind === "expired") await markProviderCancelDone(supabase, event.subscriptionId);
    return { outcome: "subscription_saved" };
  }

  // A new subscription: the period end and the buyer.
  if (!periodEnd) return recordUnmatched(supabase, unmatchedEvent, "invalid_data", context);
  const signatureOk =
    !event.metadataSignature || (!!event.userId && verifyMetadataSignature(event.userId, product, event.metadataSignature));
  let userId: string | null = signatureOk && isUuid(event.userId) ? event.userId : null;
  if (!userId) userId = await findUserIdByEmail(supabase, event.customerEmail);
  if (!userId) return recordUnmatched(supabase, unmatchedEvent, signatureOk ? "no_matching_user" : "invalid_metadata_signature", context);

  const status = (next.status as string | undefined) ?? "active";
  const row = {
    user_id: userId,
    product,
    provider: event.provider,
    provider_subscription_id: event.subscriptionId,
    provider_customer_id: event.customerId ?? null,
    status,
    current_period_end: periodEnd,
    cancel_at_period_end: (next.cancel_at_period_end as boolean | undefined) ?? false,
    cancelled_at: status === "cancelled" ? (next.cancelled_at as string) : null,
    last_event_at: event.eventAt,
  };
  const { error } = await supabase.from("subscriptions").insert(row);
  if (!error) {
    console.info(`[payments:webhook] Subscription ${event.subscriptionId} recorded (${status}).`);
    return { outcome: "subscription_saved" };
  }
  if (error.code === "23505") return handleSubscription(supabase, event, context); // a resend raced us: apply as an update
  if (error.code === "23503") return recordUnmatched(supabase, unmatchedEvent, "no_matching_user", context);
  if (isRetryable(error)) fail(`insert subscription ${event.subscriptionId}`, error);
  return recordUnmatched(supabase, unmatchedEvent, "invalid_data", context);
}

/**
 * A charge of a subscription: recorded once (keyed on the payment id) against its subscription, as
 * "new" for the first and "renewal" after. If the subscription isn't known yet (the payment arrived
 * before subscription.active), it throws, so the provider retries later. A refund or dispute that
 * arrived first is honoured: the payment is stored refunded or disputed, and so is the subscription.
 */
async function handleSubscriptionPaid(
  supabase: SupabaseClient,
  event: Extract<WebhookEventResult, { type: "subscription_paid" }>,
  context: WebhookContext
): Promise<ProcessWebhookOutcome> {
  const unmatchedEvent = { type: "subscription_paid", provider: event.provider, orderId: event.paymentId };
  const existing = await findSubscriptionPayment(supabase, event.paymentId);
  if (existing) return { outcome: "idempotent_no_op", existingStatus: existing.status };
  if (!Number.isSafeInteger(event.amountCents) || event.amountCents < 0) return recordUnmatched(supabase, unmatchedEvent, "invalid_amount", context);
  if (!CURRENCY_RE.test(event.currency)) return recordUnmatched(supabase, unmatchedEvent, "invalid_currency", context);

  const subscription = await findSubscription(supabase, event.subscriptionId);
  if (!subscription) {
    // Retry later (HTTP 500): subscription.active is usually a moment behind.
    console.warn(`[payments:webhook] Payment ${event.paymentId} for subscription ${event.subscriptionId}, not known yet: retry.`);
    throw new RetryableError(`subscription ${event.subscriptionId} not known yet`, null);
  }

  const { data: earlier, error: earlierError } = await supabase
    .from(UNMATCHED_TABLE)
    .select("reason")
    .eq("provider", event.provider)
    .eq("provider_order_id", event.paymentId)
    .in("reason", ["refund_unknown_order", "dispute_unknown_order"]);
  if (earlierError) fail(`select earlier refunds ${event.paymentId}`, earlierError);
  const endedFirst = (earlier ?? []) as { reason: string }[];
  const status = endedFirst.some((r) => r.reason === "refund_unknown_order") ? "refunded" : endedFirst.length ? "disputed" : "succeeded";

  const { data: others, error: othersError } = await supabase.from("subscription_payments").select("id").eq("subscription_id", subscription.id);
  if (othersError) fail(`select payments of subscription ${subscription.id}`, othersError);
  const { error } = await supabase.from("subscription_payments").insert({
    subscription_id: subscription.id,
    user_id: subscription.user_id,
    provider_payment_id: event.paymentId,
    charge_type: others && others.length ? "renewal" : "new",
    status,
    amount: event.amountCents,
    currency: event.currency,
    refunded_at: status === "refunded" ? new Date().toISOString() : null,
  });
  if (error) {
    if (error.code === "23505") return { outcome: "idempotent_concurrent" };
    if (isRetryable(error)) fail(`insert subscription payment ${event.paymentId}`, error);
    return recordUnmatched(supabase, unmatchedEvent, "invalid_data", context);
  }
  if (status !== "succeeded") {
    const { error: subError } = await supabase.from("subscriptions").update({ status }).eq("id", subscription.id);
    if (subError) fail(`${status} subscription ${subscription.id}`, subError);
    console.info(`[payments:webhook] Payment ${event.paymentId} arrived after its ${status === "refunded" ? "refund" : "dispute"}: subscription ${status}.`);
    return { outcome: "revoked_out_of_order" };
  }
  console.info(`[payments:webhook] Payment ${event.paymentId} recorded for subscription ${event.subscriptionId}.`);
  return { outcome: "subscription_payment_recorded" };
}

/** A won dispute: a subscription payment back to succeeded (and its subscription active), or a lifetime purchase back to active. */
async function handleDisputeWon(
  supabase: SupabaseClient,
  event: Extract<WebhookEventResult, { type: "order_dispute_won" }>,
  context: WebhookContext
): Promise<ProcessWebhookOutcome> {
  const subPayment = await findSubscriptionPayment(supabase, event.orderId);
  if (subPayment) return setSubscriptionPaymentStatus(supabase, subPayment, "succeeded", event.orderId, context);
  const existing = await findPurchase(supabase, event.orderId);
  if (!existing || existing.status !== "disputed") return { outcome: "idempotent_no_op", existingStatus: existing?.status };
  const { error } = await supabase.from("purchases").update({ status: "active" }).eq("id", existing.id);
  if (error) {
    if (isRetryable(error)) fail(`restore order ${event.orderId}`, error);
    return recordUnmatched(supabase, event, "invalid_data", context);
  }
  console.info(`[payments:webhook] Restored access for order ${event.orderId} (dispute won).`);
  return { outcome: "restored" };
}

/** A cancellation "clearly before the period end" is more than this before it (Prompt 84). */
const IMMEDIATE_CANCEL_MARGIN_MS = 24 * 60 * 60 * 1000;

/** Runs a follow-up task: after the reply when the route gave a defer, else now. Never throws. */
async function schedule(context: WebhookContext, task: () => Promise<void>): Promise<void> {
  const safe = async () => {
    try {
      await task();
    } catch (error) {
      console.error("[payments:webhook] Follow-up task failed:", error instanceof Error ? error.message : "unknown");
    }
  };
  if (context.defer) context.defer(safe);
  else await safe();
}

const defaultCancelInProvider = async (provider: ProviderName, subscriptionId: string): Promise<"cancelled" | "already"> => {
  const p = getPaymentProvider(provider);
  if (!p.cancelSubscription) throw Object.assign(new Error("cancel not supported"), { code: "not_supported" });
  return p.cancelSubscription(subscriptionId);
};

const shortCode = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return (typeof code === "string" && code ? code : error instanceof Error ? error.name : "unknown").slice(0, 100);
};

/**
 * After a refund or a lost dispute of a subscription payment: records that the subscription must be
 * cancelled in the provider (provider_cancellations, 0014), then cancels it there after the reply.
 * Idempotent: one row per subscription, and nothing is sent once it's done. A failure is recorded
 * (attempts, last_error) and retried on the next delivery of the refund; docs/payments-recovery.md
 * has the manual step.
 */
async function requestProviderCancel(supabase: SupabaseClient, subscriptionRowId: number, reason: "refunded" | "dispute_lost", context: WebhookContext): Promise<void> {
  const { data: sub, error } = await supabase.from("subscriptions").select("id, provider, provider_subscription_id").eq("id", subscriptionRowId).maybeSingle();
  if (error || !sub) {
    console.warn("[payments:webhook] Provider cancellation: subscription not found, code:", shortCode(error));
    return;
  }
  const insert = await supabase
    .from("provider_cancellations")
    .insert({ provider: sub.provider, provider_subscription_id: sub.provider_subscription_id, subscription_id: sub.id, reason });
  if (insert.error && insert.error.code !== "23505") console.warn("[payments:webhook] Provider cancellation not recorded, code:", shortCode(insert.error));
  const { data: row } = await supabase.from("provider_cancellations").select("done_at").eq("provider_subscription_id", sub.provider_subscription_id).maybeSingle();
  if (row?.done_at) return; // already cancelled there
  await schedule(context, () => attemptProviderCancel(supabase, sub.provider as ProviderName, sub.provider_subscription_id, context));
}

/** One attempt to cancel in the provider; the outcome is written to provider_cancellations. */
async function attemptProviderCancel(supabase: SupabaseClient, provider: ProviderName, subscriptionId: string, context: WebhookContext): Promise<void> {
  const { data: row } = await supabase.from("provider_cancellations").select("attempts, done_at").eq("provider_subscription_id", subscriptionId).maybeSingle();
  if (row?.done_at) return;
  const attempts = (typeof row?.attempts === "number" ? row.attempts : 0) + 1;
  const now = new Date().toISOString();
  try {
    const result = await (context.cancelInProvider ?? defaultCancelInProvider)(provider, subscriptionId);
    await supabase.from("provider_cancellations").update({ done_at: now, attempts, last_error: null, updated_at: now }).eq("provider_subscription_id", subscriptionId);
    console.info(`[payments:webhook] Subscription ${subscriptionId} cancelled in ${provider} (${result}).`);
  } catch (error) {
    await supabase.from("provider_cancellations").update({ attempts, last_error: shortCode(error), updated_at: now }).eq("provider_subscription_id", subscriptionId);
    console.error(`[payments:webhook] Couldn't cancel subscription ${subscriptionId} in ${provider} (attempt ${attempts}, code ${shortCode(error)}); see docs/payments-recovery.md.`);
  }
}

/** The provider says the subscription is cancelled or over: a cancellation we asked for is done. */
async function markProviderCancelDone(supabase: SupabaseClient, subscriptionId: string): Promise<void> {
  const { data: row } = await supabase.from("provider_cancellations").select("done_at").eq("provider_subscription_id", subscriptionId).maybeSingle();
  if (!row || row.done_at) return;
  const now = new Date().toISOString();
  await supabase.from("provider_cancellations").update({ done_at: now, last_error: null, updated_at: now }).eq("provider_subscription_id", subscriptionId);
}

/**
 * dispute.lost: access stays ended (the dispute already suspended it). A subscription payment's
 * subscription is marked disputed if it wasn't, and cancelled in the provider so it never renews.
 */
async function handleDisputeLost(
  supabase: SupabaseClient,
  event: Extract<WebhookEventResult, { type: "order_dispute_lost" }>,
  context: WebhookContext
): Promise<ProcessWebhookOutcome> {
  const subPayment = await findSubscriptionPayment(supabase, event.orderId);
  if (!subPayment) return { outcome: "idempotent_no_op" }; // a lifetime purchase: it stays disputed
  const result =
    subPayment.status === "succeeded"
      ? await setSubscriptionPaymentStatus(supabase, subPayment, "disputed", event.orderId, context)
      : { outcome: "idempotent_no_op" as const, existingStatus: subPayment.status };
  await requestProviderCancel(supabase, subPayment.subscription_id, "dispute_lost", context);
  return result;
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
  if (event.type === "order_dispute_won") return handleDisputeWon(supabase, event, context);
  if (event.type === "order_dispute_lost") return handleDisputeLost(supabase, event, context);
  if (event.type === "subscription") return handleSubscription(supabase, event, context);
  if (event.type === "subscription_paid") return handleSubscriptionPaid(supabase, event, context);
  return { outcome: "ignored" };
}
