// scripts/test-payments-webhook.mjs
// Unit and integration tests for Phases 2 & 3:
// - Metadata signing and timing-safe verification
// - Dodo Payments provider (URL selection, signature verification with 300s window, event parsing)
// - Lemon Squeezy provider (signature verification, event parsing)
// - Provider factory
// - Webhook processor: idempotency on the payment id, metadata then email matching, unmatched events,
//   retryable vs final errors, refunds and disputes
// - The route: bad signature and stale timestamp refused with 401
// - Fail-closed handling when secrets are missing

import { register } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Hook into module loader to handle 'server-only' and resolve relative .ts imports in Node
const ROOT = new URL("../", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
    const ROOT = ${JSON.stringify(ROOT)};
    export function resolve(specifier, context, nextResolve) {
      if (specifier === "next/server") {
        return nextResolve("next/server.js", context);
      }
      if (specifier === "next/cache") {
        return nextResolve("next/cache.js", context);
      }
      if (specifier.startsWith("@/")) {
        const target = new URL(specifier.slice(2), ROOT).href;
        return nextResolve(/\\.(ts|js|mjs)$/.test(target) ? target : target + ".ts", context);
      }
      if (specifier === "server-only") {
        return {
          format: "module",
          shortCircuit: true,
          url: "data:text/javascript,"
        };
      }
      if (specifier.startsWith(".") && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs")) {
        try {
          return nextResolve(specifier + ".ts", context);
        } catch {
          // fall through
        }
      }
      return nextResolve(specifier, context);
    }
  `),
  import.meta.url
);

// Dynamic imports after module.register hook is active
const { getPaymentsConfig, getSupabaseAdminConfig, signMetadata, verifyMetadataSignature } = await import(
  "../lib/payments/config.ts"
);
const { DodoPaymentProvider } = await import("../lib/payments/dodo.ts");
const { LemonSqueezyPaymentProvider } = await import("../lib/payments/lemonsqueezy.ts");
const { getPaymentProvider } = await import("../lib/payments/provider.ts");
const { processWebhookEvent, isRetryable } = await import("../lib/payments/webhook.ts");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

console.log("\n--- 1. Testing Metadata Signing & Verification ---");
const testSecret = "test_webhook_secret_key_1234567890";
const userId = "11111111-1111-4111-8111-111111111111";
const product = "lessons";

const signature = signMetadata(userId, product, testSecret);
assert(typeof signature === "string" && signature.length === 64, "signMetadata generates a 64-char hex HMAC-SHA256");

assert(
  verifyMetadataSignature(userId, product, signature, testSecret) === true,
  "verifyMetadataSignature accepts valid signature"
);
assert(
  verifyMetadataSignature(userId, "pro", signature, testSecret) === false,
  "verifyMetadataSignature rejects tampered product"
);
assert(
  verifyMetadataSignature("22222222-2222-4222-8222-222222222222", product, signature, testSecret) === false,
  "verifyMetadataSignature rejects tampered userId"
);
assert(
  verifyMetadataSignature(userId, product, "bad_signature_hex", testSecret) === false,
  "verifyMetadataSignature rejects invalid signature hex"
);
assert(
  verifyMetadataSignature(userId, product, null, testSecret) === false,
  "verifyMetadataSignature rejects null signature"
);
assert(
  verifyMetadataSignature(userId, product, signature, "wrong_secret") === false,
  "verifyMetadataSignature rejects mismatched secret"
);

console.log("\n--- 2. Testing Dodo Payments Provider ---");
const dodo = new DodoPaymentProvider();

assert(
  dodo.getBaseUrl("dodo_test_key_abc") === "https://test.dodopayments.com",
  "Dodo selects test base URL for dodo_test_ prefix"
);
assert(
  dodo.getBaseUrl("dodo_live_key_xyz") === "https://live.dodopayments.com",
  "Dodo selects live base URL for live keys"
);

process.env.PAYMENTS_WEBHOOK_SECRET = testSecret;
const dodoRawBody = JSON.stringify({
  type: "payment.succeeded",
  data: {
    payment_id: "pay_dodo_123",
    total_amount: 500,
    currency: "USD",
    metadata: {
      user_id: userId,
      product: "lessons",
      metadata_signature: signature,
    },
  },
});

const now = Math.floor(Date.now() / 1000);
const webhookId = "msg_dodo_test_001";
const signedPayload = `${webhookId}.${now}.${dodoRawBody}`;
const expectedDodoHex = crypto.createHmac("sha256", testSecret).update(signedPayload).digest("hex");
const expectedDodoBase64 = crypto.createHmac("sha256", testSecret).update(signedPayload).digest("base64");

// Standard Webhooks signature verification
const validHeaders = new Headers({
  "webhook-id": webhookId,
  "webhook-timestamp": String(now),
  "webhook-signature": `v1,${expectedDodoBase64}`,
});

assert(
  (await dodo.verifyWebhookSignature(dodoRawBody, validHeaders)) === true,
  "Dodo verifies valid Standard Webhooks base64 signature"
);

const validHexHeaders = new Headers({
  "webhook-id": webhookId,
  "webhook-timestamp": String(now),
  "webhook-signature": `v1,${expectedDodoHex}`,
});
assert(
  (await dodo.verifyWebhookSignature(dodoRawBody, validHexHeaders)) === true,
  "Dodo verifies valid Standard Webhooks hex signature"
);

// Stale timestamp (> 300s)
const staleHeaders = new Headers({
  "webhook-id": webhookId,
  "webhook-timestamp": String(now - 350),
  "webhook-signature": `v1,${expectedDodoBase64}`,
});
assert(
  (await dodo.verifyWebhookSignature(dodoRawBody, staleHeaders)) === false,
  "Dodo rejects stale timestamp older than 300s (replay protection)"
);

// Tampered body
assert(
  (await dodo.verifyWebhookSignature(dodoRawBody + "tamper", validHeaders)) === false,
  "Dodo rejects tampered body"
);

// Missing headers
assert(
  (await dodo.verifyWebhookSignature(dodoRawBody, new Headers({ "webhook-id": webhookId }))) === false,
  "Dodo rejects missing signature headers"
);

// Dodo event parsing
const parsedPaid = await dodo.parseWebhookEvent(dodoRawBody);
assert(
  parsedPaid.type === "order_paid" &&
    parsedPaid.orderId === "pay_dodo_123" &&
    parsedPaid.userId === userId &&
    parsedPaid.product === "lessons" &&
    parsedPaid.amountCents === 500 &&
    parsedPaid.currency === "usd",
  "Dodo parses payment.succeeded into order_paid"
);

const dodoRefundBody = JSON.stringify({
  type: "payment.refunded",
  data: {
    payment_id: "pay_dodo_123",
    metadata: { user_id: userId, product: "lessons" },
  },
});
const parsedRefund = await dodo.parseWebhookEvent(dodoRefundBody);
assert(
  parsedRefund.type === "order_refunded" && parsedRefund.orderId === "pay_dodo_123",
  "Dodo parses payment.refunded into order_refunded"
);

const dodoRefundSucceededBody = JSON.stringify({
  type: "refund.succeeded",
  data: {
    payment_id: "pay_dodo_123",
    metadata: { user_id: userId, product: "lessons" },
  },
});
const parsedRefundSucceeded = await dodo.parseWebhookEvent(dodoRefundSucceededBody);
assert(
  parsedRefundSucceeded.type === "order_refunded" && parsedRefundSucceeded.orderId === "pay_dodo_123",
  "Dodo parses refund.succeeded into order_refunded"
);

const dodoDisputeBody = JSON.stringify({
  type: "dispute.opened",
  data: {
    payment_id: "pay_dodo_123",
    metadata: { user_id: userId, product: "lessons" },
  },
});
const parsedDispute = await dodo.parseWebhookEvent(dodoDisputeBody);
assert(
  parsedDispute.type === "order_disputed" && parsedDispute.orderId === "pay_dodo_123",
  "Dodo parses dispute.opened into order_disputed"
);

const dodoUnknownBody = JSON.stringify({ type: "subscription.created", data: {} });
const parsedUnknown = await dodo.parseWebhookEvent(dodoUnknownBody);
assert(parsedUnknown.type === "ignored", "Dodo safely ignores unhandled event types");

console.log("\n--- 3. Testing Lemon Squeezy Provider ---");
const lemonsqueezy = new LemonSqueezyPaymentProvider();

const lsRawBody = JSON.stringify({
  meta: {
    event_name: "order_created",
    custom_data: {
      user_id: userId,
      product: "lessons",
      metadata_signature: signature,
    },
  },
  data: {
    id: "ord_ls_987",
    attributes: {
      total: 500,
      currency: "USD",
      status: "paid",
    },
  },
});

const lsHex = crypto.createHmac("sha256", testSecret).update(lsRawBody).digest("hex");
const lsValidHeaders = new Headers({ "x-signature": lsHex });

assert(
  (await lemonsqueezy.verifyWebhookSignature(lsRawBody, lsValidHeaders)) === true,
  "Lemon Squeezy verifies valid x-signature HMAC-SHA256"
);
assert(
  (await lemonsqueezy.verifyWebhookSignature(lsRawBody + "tamper", lsValidHeaders)) === false,
  "Lemon Squeezy rejects tampered raw body"
);
assert(
  (await lemonsqueezy.verifyWebhookSignature(lsRawBody, new Headers())) === false,
  "Lemon Squeezy rejects missing x-signature header"
);

const lsParsedPaid = await lemonsqueezy.parseWebhookEvent(lsRawBody);
assert(
  lsParsedPaid.type === "order_paid" &&
    lsParsedPaid.orderId === "ord_ls_987" &&
    lsParsedPaid.userId === userId &&
    lsParsedPaid.product === "lessons" &&
    lsParsedPaid.amountCents === 500 &&
    lsParsedPaid.currency === "usd",
  "Lemon Squeezy parses order_created into order_paid"
);

const lsRefundBody = JSON.stringify({
  meta: { event_name: "order_refunded", custom_data: { user_id: userId, product: "lessons" } },
  data: { id: "ord_ls_987", attributes: {} },
});
const lsParsedRefund = await lemonsqueezy.parseWebhookEvent(lsRefundBody);
assert(
  lsParsedRefund.type === "order_refunded" && lsParsedRefund.orderId === "ord_ls_987",
  "Lemon Squeezy parses order_refunded"
);

console.log("\n--- 4. Testing Provider Factory ---");
assert(getPaymentProvider("dodo").name === "dodo", "getPaymentProvider('dodo') returns Dodo provider");
assert(
  getPaymentProvider("lemonsqueezy").name === "lemonsqueezy",
  "getPaymentProvider('lemonsqueezy') returns Lemon Squeezy provider"
);

console.log("\n--- 5. Testing the webhook processor (idempotency, matching, unmatched events, retries) ---");

const PRODUCTS = ["lessons", "pro", "max"];

// In-memory stand-in for the service-role client: purchases (unique provider_order_id, user_id
// must exist, product check), unmatched_payment_events (unique provider + order + reason), and
// find_user_id_by_email() (case-insensitive, trimmed). failOn makes one operation return an error.
function createMockSupabase({ users = {}, failOn = {} } = {}) {
  const tables = { purchases: [], unmatched_payment_events: [], subscriptions: [], subscription_payments: [] };
  const SUB_STATUSES = ["active", "past_due", "on_hold", "cancelled", "expired", "refunded", "disputed"];
  const EVENT_TYPES = ["order_paid", "order_refunded", "order_disputed", "subscription_event", "subscription_payment"];
  const userIds = new Set(Object.values(users));
  let nextId = 1;

  function query(table) {
    const filters = [];
    const run = () => {
      const error = failOn[`${table}.select`] ?? null;
      return { rows: error ? [] : tables[table].filter((r) => filters.every((f) => f(r))), error };
    };
    const q = {
      eq(col, val) {
        filters.push((r) => r[col] === val);
        return q;
      },
      in(col, vals) {
        filters.push((r) => vals.includes(r[col]));
        return q;
      },
      async maybeSingle() {
        const { rows, error } = run();
        return { data: rows[0] ? { ...rows[0] } : null, error };
      },
      then(resolve, reject) {
        const { rows, error } = run();
        return Promise.resolve({ data: rows, error }).then(resolve, reject);
      },
    };
    return q;
  }

  return {
    from(table) {
      if (!tables[table]) throw new Error(`Unexpected table: ${table}`);
      return {
        select() {
          return query(table);
        },
        async insert(record) {
          await Promise.resolve(); // let concurrent calls interleave, as real requests would
          if (failOn[`${table}.insert`]) return { error: failOn[`${table}.insert`] };
          const rows = tables[table];
          if (table === "purchases") {
            if (rows.some((r) => r.provider_order_id === record.provider_order_id)) return { error: { code: "23505", message: "duplicate key" } };
            if (!userIds.has(record.user_id)) return { error: { code: "23503", message: "foreign key" } };
            if (!PRODUCTS.includes(record.product)) return { error: { code: "23514", message: "check" } };
          } else if (table === "subscriptions") {
            if (rows.some((r) => r.provider_subscription_id === record.provider_subscription_id)) return { error: { code: "23505", message: "duplicate key" } };
            if (!userIds.has(record.user_id)) return { error: { code: "23503", message: "foreign key" } };
            if (!PRODUCTS.includes(record.product) || !SUB_STATUSES.includes(record.status)) return { error: { code: "23514", message: "check" } };
            if (record.status === "cancelled" && !record.cancelled_at) return { error: { code: "23514", message: "cancelled check" } };
          } else if (table === "subscription_payments") {
            if (rows.some((r) => r.provider_payment_id === record.provider_payment_id)) return { error: { code: "23505", message: "duplicate key" } };
            if (!tables.subscriptions.some((x) => x.id === record.subscription_id)) return { error: { code: "23503", message: "foreign key" } };
            if (!["new", "renewal"].includes(record.charge_type) || !["succeeded", "refunded", "disputed"].includes(record.status)) return { error: { code: "23514", message: "check" } };
          } else if (rows.some((r) => r.provider === record.provider && r.provider_order_id === record.provider_order_id && r.reason === record.reason)) {
            return { error: { code: "23505", message: "duplicate key" } };
          } else if (!EVENT_TYPES.includes(record.event_type)) {
            return { error: { code: "23514", message: "event_type check" } };
          }
          rows.push({ id: nextId++, ...record });
          return { error: null };
        },
        update(updates) {
          return {
            async eq(col, val) {
              if (failOn[`${table}.update`]) return { error: failOn[`${table}.update`] };
              for (const r of tables[table]) if (r[col] === val) Object.assign(r, updates);
              return { error: null };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      if (name !== "find_user_id_by_email") throw new Error(`Unexpected rpc: ${name}`);
      if (failOn.rpc) return { data: null, error: failOn.rpc };
      const wanted = String(args.p_email ?? "").trim().toLowerCase();
      const ids = Object.entries(users).filter(([email]) => email.toLowerCase() === wanted).map(([, id]) => id);
      return { data: ids.length === 1 ? ids[0] : null, error: null };
    },
    purchasesFor(orderId) {
      return tables.purchases.filter((r) => r.provider_order_id === orderId);
    },
    unmatchedFor(orderId) {
      return tables.unmatched_payment_events.filter((r) => r.provider_order_id === orderId);
    },
    subscriptionFor(subscriptionId) {
      return tables.subscriptions.filter((r) => r.provider_subscription_id === subscriptionId);
    },
    paymentsFor(subscriptionId) {
      const sub = tables.subscriptions.find((r) => r.provider_subscription_id === subscriptionId);
      return sub ? tables.subscription_payments.filter((r) => r.subscription_id === sub.id) : [];
    },
  };
}

const otherUserId = "33333333-3333-4333-8333-333333333333";
const deletedUserId = "44444444-4444-4444-8444-444444444444";
const users = { "learner@example.com": userId, "Other.Learner@Example.com": otherUserId };
const paidEvent = (overrides = {}) => ({
  type: "order_paid",
  provider: "dodo",
  orderId: "pay_x",
  product: "lessons",
  amountCents: 800,
  currency: "usd",
  ...overrides,
});

// 5.1 Granted by metadata, then a resent payment never creates a second row.
{
  const db = createMockSupabase({ users });
  const first = await processWebhookEvent(parsedPaid, db, { eventId: "msg_1" });
  assert(first.outcome === "granted" && first.matchedBy === "metadata", "order_paid with signed metadata grants access (matched by metadata)");
  assert(db.purchasesFor("pay_dodo_123")[0]?.status === "active", "the purchase row is active");
  const resent = await processWebhookEvent(parsedPaid, db, { eventId: "msg_1" });
  assert(resent.outcome === "idempotent_no_op", "a resent payment is a no-op");
  assert(db.purchasesFor("pay_dodo_123").length === 1, "a resent payment never creates a second row");

  // Refund, duplicate refund, then a replayed payment: stays refunded.
  assert((await processWebhookEvent(parsedRefund, db)).outcome === "revoked", "refund marks the purchase refunded");
  assert(db.purchasesFor("pay_dodo_123")[0]?.refunded_at !== undefined, "refunded_at is stamped");
  assert((await processWebhookEvent(parsedRefund, db)).outcome === "already_refunded", "a resent refund is a no-op");
  const replay = await processWebhookEvent(parsedPaid, db);
  assert(replay.outcome === "idempotent_no_op" && replay.existingStatus === "refunded", "a replayed payment never revives a refunded purchase");
  assert(db.purchasesFor("pay_dodo_123")[0]?.status === "refunded", "status stays refunded");
}

// 5.2 Two deliveries of the same payment at once: one row.
{
  const db = createMockSupabase({ users });
  const ev = paidEvent({ orderId: "pay_race", userId });
  const [a, b] = await Promise.all([processWebhookEvent(ev, db), processWebhookEvent(ev, db)]);
  const outcomes = [a.outcome, b.outcome].sort().join(",");
  assert(outcomes === "granted,idempotent_concurrent", `concurrent deliveries: one grant, one no-op (got ${outcomes})`);
  assert(db.purchasesFor("pay_race").length === 1, "concurrent deliveries create one row");
}

// 5.3 Unmatched user: recorded once with the event id, HTTP 200 (no throw), no purchase.
{
  const db = createMockSupabase({ users });
  const ev = paidEvent({ orderId: "pay_stranger", customerEmail: "stranger@example.com" });
  const first = await processWebhookEvent(ev, db, { eventId: "msg_unmatched_1" });
  assert(first.outcome === "unmatched_recorded" && first.reason === "no_matching_user", "no matching user is recorded, not retried");
  const rows = db.unmatchedFor("pay_stranger");
  assert(rows.length === 1 && rows[0].event_id === "msg_unmatched_1" && rows[0].event_type === "order_paid", "the unmatched row keeps the event id and type");
  assert(!JSON.stringify(rows[0]).includes("stranger@example.com"), "the unmatched row holds no email");
  const resent = await processWebhookEvent(ev, db, { eventId: "msg_unmatched_2" });
  assert(resent.outcome === "unmatched_recorded" && db.unmatchedFor("pay_stranger").length === 1, "a resent unmatched event adds no second row");
  assert(db.purchasesFor("pay_stranger").length === 0, "an unmatched payment grants nothing");
}

// 5.4 Email fallback, without regard to case.
{
  const db = createMockSupabase({ users });
  const res = await processWebhookEvent(paidEvent({ orderId: "pay_case", customerEmail: "  LEARNER@Example.COM " }), db);
  assert(res.outcome === "granted" && res.matchedBy === "email", "an email in a different case matches the account");
  assert(db.purchasesFor("pay_case")[0]?.user_id === userId, "the purchase goes to the matched user");

  const res2 = await processWebhookEvent(paidEvent({ orderId: "pay_case2", customerEmail: "other.learner@EXAMPLE.com" }), db);
  assert(res2.outcome === "granted" && db.purchasesFor("pay_case2")[0]?.user_id === otherUserId, "a mixed-case stored email matches too");

  const res3 = await processWebhookEvent(paidEvent({ orderId: "pay_deleted", userId: deletedUserId, customerEmail: "learner@example.com" }), db);
  assert(res3.outcome === "granted" && res3.matchedBy === "email", "a metadata user id with no account falls back to the email");

  const res4 = await processWebhookEvent(paidEvent({ orderId: "pay_baduuid", userId: "not-a-uuid", customerEmail: "learner@example.com" }), db);
  assert(res4.outcome === "granted" && res4.matchedBy === "email", "a malformed metadata user id falls back to the email");
}

// 5.5 Metadata signature mismatch: never trusted; email fallback, else recorded.
{
  const db = createMockSupabase({ users });
  const tampered = { ...parsedPaid, orderId: "pay_tampered", userId: otherUserId };
  const res = await processWebhookEvent(tampered, db);
  assert(res.outcome === "unmatched_recorded" && res.reason === "invalid_metadata_signature", "a bad metadata signature with no email is recorded");
  assert(db.purchasesFor("pay_tampered").length === 0, "a bad metadata signature grants nothing by itself");
  const res2 = await processWebhookEvent({ ...tampered, orderId: "pay_tampered2", customerEmail: "learner@example.com" }, db);
  assert(res2.outcome === "granted" && db.purchasesFor("pay_tampered2")[0]?.user_id === userId, "a bad metadata signature falls back to the email, not the metadata user");
}

// 5.6 Data the database would refuse: recorded, not retried.
{
  const db = createMockSupabase({ users });
  const r1 = await processWebhookEvent(paidEvent({ orderId: "pay_gold", userId, product: "gold" }), db);
  assert(r1.outcome === "unmatched_recorded" && r1.reason === "unknown_product", "an unknown product is recorded");
  const r2 = await processWebhookEvent(paidEvent({ orderId: "pay_nan", userId, amountCents: Number.NaN }), db);
  assert(r2.outcome === "unmatched_recorded" && r2.reason === "invalid_amount", "a bad amount is recorded");
  const db2 = createMockSupabase({ users, failOn: { "purchases.insert": { code: "22P02", message: "invalid input" } } });
  const r3 = await processWebhookEvent(paidEvent({ orderId: "pay_22", userId }), db2);
  assert(r3.outcome === "unmatched_recorded" && r3.reason === "invalid_data", "a data error from the database is recorded, not retried");
}

// 5.7 Errors worth retrying throw (the route returns 500).
for (const [label, failOn, withUser] of [
  ["permission denied (42501) on the select", { "purchases.select": { code: "42501", message: "permission denied for table purchases" } }, true],
  ["a network failure on the insert", { "purchases.insert": { code: "", message: "TypeError: fetch failed" } }, true],
  ["an outage while recording an unmatched event", { "unmatched_payment_events.insert": { code: "08006", message: "connection failure" } }, false],
]) {
  const db = createMockSupabase({ users, failOn });
  let threw = false;
  try {
    await processWebhookEvent(paidEvent({ orderId: "pay_retry", customerEmail: "stranger@example.com", userId: withUser ? userId : undefined }), db);
  } catch {
    threw = true;
  }
  assert(threw, `${label} throws, so the provider retries`);
}
assert(
  isRetryable({ code: "42501" }) && isRetryable({ code: "" }) && !isRetryable({ code: "23514" }) && !isRetryable({ code: "22P02" }),
  "isRetryable: 22xxx and 23xxx are final, the rest are retried"
);

// 5.8 Refunds and disputes.
{
  const db = createMockSupabase({ users });
  // A refund for an unknown order with no user: recorded; the later payment grants nothing.
  const r1 = await processWebhookEvent({ type: "order_refunded", provider: "dodo", orderId: "pay_refund_first" }, db, { eventId: "msg_r1" });
  assert(r1.outcome === "unmatched_recorded" && r1.reason === "refund_unknown_order", "a refund for an unknown order is recorded");
  const r2 = await processWebhookEvent(paidEvent({ orderId: "pay_refund_first", userId }), db);
  assert(r2.outcome === "unmatched_recorded" && r2.reason === "paid_after_refund_or_dispute", "a payment after an unmatched refund grants nothing and is recorded");
  assert(db.purchasesFor("pay_refund_first").length === 0, "no purchase row after refund-then-payment");

  // A refund first with the user in the metadata: a refunded row blocks the later grant.
  const r3 = await processWebhookEvent({ type: "order_refunded", provider: "dodo", orderId: "pay_refund_meta", userId, product: "lessons" }, db);
  assert(r3.outcome === "revoked_out_of_order", "a refund first, with the user in the metadata, records a refunded row");
  const r4 = await processWebhookEvent(paidEvent({ orderId: "pay_refund_meta", userId }), db);
  assert(r4.outcome === "idempotent_no_op" && r4.existingStatus === "refunded", "the later payment leaves it refunded");

  // Dispute: suspends an active purchase; a second dispute is a no-op; unknown order is recorded.
  await processWebhookEvent(paidEvent({ orderId: "pay_dispute", userId }), db);
  const d1 = await processWebhookEvent({ type: "order_disputed", provider: "dodo", orderId: "pay_dispute" }, db);
  assert(d1.outcome === "disputed" && db.purchasesFor("pay_dispute")[0]?.status === "disputed", "a dispute marks the purchase disputed");
  const d2 = await processWebhookEvent({ type: "order_disputed", provider: "dodo", orderId: "pay_dispute" }, db);
  assert(d2.outcome === "idempotent_no_op", "a resent dispute is a no-op");
  const d3 = await processWebhookEvent({ type: "order_disputed", provider: "dodo", orderId: "pay_dispute_unknown" }, db);
  assert(d3.outcome === "unmatched_recorded" && d3.reason === "dispute_unknown_order", "a dispute for an unknown order is recorded");
}

// 5.9 Parsing: a payment without metadata keeps the email for the fallback.
{
  const parsed = await dodo.parseWebhookEvent(
    JSON.stringify({
      type: "payment.succeeded",
      data: { payment_id: "pay_nometa", total_amount: 800, currency: "USD", customer: { email: "Learner@Example.com" } },
    })
  );
  assert(
    parsed.type === "order_paid" && parsed.userId === undefined && parsed.customerEmail === "Learner@Example.com",
    "Dodo payment.succeeded without metadata keeps the customer email"
  );
}

// 5.10 The route: a bad signature is refused with 401 before anything is processed.
{
  process.env.PAYMENTS_PROVIDER = "dodo";
  process.env.PAYMENTS_API_KEY = "dodo_test_key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9"; // never contacted
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const { POST } = await import("../app/api/webhooks/payments/route.ts");
  const ts = String(Math.floor(Date.now() / 1000));
  const badSig = crypto.createHmac("sha256", "wrong_secret").update(`msg_bad.${ts}.${dodoRawBody}`).digest("base64");
  const res = await POST(
    new Request("http://localhost/api/webhooks/payments", {
      method: "POST",
      body: dodoRawBody,
      headers: { "webhook-id": "msg_bad", "webhook-timestamp": ts, "webhook-signature": `v1,${badSig}` },
    })
  );
  assert(res.status === 401, "the route refuses a bad signature with 401");
  const stale = await POST(
    new Request("http://localhost/api/webhooks/payments", {
      method: "POST",
      body: dodoRawBody,
      headers: { "webhook-id": webhookId, "webhook-timestamp": String(now - 350), "webhook-signature": `v1,${expectedDodoBase64}` },
    })
  );
  assert(stale.status === 401, "the route refuses a stale timestamp with 401");

  // 5.11 Capturing payloads in test mode (docs/plans/subscription.md, decision 1): only with the flag
  // AND a Dodo test key, and only after the signature check.
  const { captureEnabled, capturePayload } = await import("../lib/payments/capture.ts");
  assert(captureEnabled({ PAYMENTS_CAPTURE_PAYLOADS: "on" }, "dodo_test_abc") === true, "capture: on with the flag and a test key");
  assert(captureEnabled({ PAYMENTS_CAPTURE_PAYLOADS: "on" }, "dodo_live_abc") === false, "capture: never with a live key");
  assert(captureEnabled({ PAYMENTS_CAPTURE_PAYLOADS: "true" }, "dodo_test_abc") === false, "capture: the flag must be exactly 'on'");
  assert(captureEnabled({}, "dodo_test_abc") === false, "capture: off by default");
  const lines = [];
  const examples = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "dodo-webhook-examples.json"), "utf8")).events;
  for (const e of Object.values(examples)) capturePayload(JSON.stringify(e), (l) => lines.push(l));
  const all = lines.join("\n");
  assert(lines.length === 13 && lines.every((l) => l.startsWith("[payments:capture] ")), "capture: one line per payload");
  assert(all.includes('type = "subscription.renewed"') && all.includes('data.subscription_id = "sub_7EeHq2ewQuadropD2ra"') && all.includes("data.next_billing_date: string") && all.includes("data.amount: string"), "capture: the event type, ids and field names with types (the shape)");
  const personal = ["learner@example.com", "Test user", "John Doe", "Jane Doe", "New York", "11th Main", "08002", "+15555550100", "+447700900123", "DE999999999", "Example GmbH", "Switching to a competitor", "too_expensive", "0119", "fraudulent"];
  assert(personal.every((p) => !all.includes(p)), `capture: no email, name, phone, address, tax id or free text (found: ${personal.filter((p) => all.includes(p)).join(", ") || "none"})`);
  assert(all.includes("data.customer.email: [masked]") && all.includes("data.billing.street: [masked]"), "capture: personal fields appear only as [masked]");
  assert(captureEnabled({ PAYMENTS_CAPTURE_PAYLOADS: undefined }, "dodo_test_abc") === false && !String(captureEnabled).includes("rawBody"), "capture: turned on by server configuration only, never by the payload");

  const realInfo = console.info;
  const captured = [];
  console.info = (...args) => captured.push(args.join(" "));
  process.env.PAYMENTS_CAPTURE_PAYLOADS = "on";
  try {
    await POST(new Request("http://localhost/api/webhooks/payments", { method: "POST", body: dodoRawBody, headers: { "webhook-id": "msg_bad", "webhook-timestamp": ts, "webhook-signature": `v1,${badSig}` } }));
    assert(!captured.some((l) => l.startsWith("[payments:capture]")), "capture: nothing is logged for a bad signature");
    const freshTs = String(Math.floor(Date.now() / 1000));
    const goodSig = crypto.createHmac("sha256", testSecret).update(`msg_cap.${freshTs}.${dodoRawBody}`).digest("base64");
    await POST(new Request("http://localhost/api/webhooks/payments", { method: "POST", body: dodoRawBody, headers: { "webhook-id": "msg_cap", "webhook-timestamp": freshTs, "webhook-signature": `v1,${goodSig}` } })).catch(() => null);
    assert(captured.some((l) => l.startsWith("[payments:capture] ") && l.includes('"payment.succeeded"')), "capture: a verified test-mode payload is logged");
    captured.length = 0;
    process.env.PAYMENTS_API_KEY = "dodo_live_key";
    await POST(new Request("http://localhost/api/webhooks/payments", { method: "POST", body: dodoRawBody, headers: { "webhook-id": "msg_cap2", "webhook-timestamp": freshTs, "webhook-signature": `v1,${goodSig}` } })).catch(() => null);
    assert(!captured.some((l) => l.startsWith("[payments:capture]")), "capture: nothing is logged with a live key, even with the flag on");
  } finally {
    console.info = realInfo;
    delete process.env.PAYMENTS_CAPTURE_PAYLOADS;
    process.env.PAYMENTS_API_KEY = "dodo_test_key";
  }
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

console.log("\n--- 5b. The founding offer's deadline (Prompt 76) ---");
// The deadline is enforced when a checkout is created (createCheckoutAction refuses $8 after it).
// A payment the provider confirms later, for a checkout created before the deadline, was charged:
// the webhook must still grant it (refusing would take money without access). It reads no clock,
// deadline or offer at all.
{
  const db = createMockSupabase({ users });
  const realNow = Date.now;
  Date.now = () => Date.parse("2027-01-01T00:30:00Z"); // after 2026-12-31T16:59:00Z
  try {
    const late = await processWebhookEvent(paidEvent({ orderId: "pay_after_deadline", customerEmail: "learner@example.com" }), db, { eventId: "msg_late" });
    assert(late.outcome === "granted", "a payment confirmed after the deadline (checkout created before) still grants access");
    assert(db.purchasesFor("pay_after_deadline")[0]?.status === "active", "the late payment's purchase row is active");
  } finally {
    Date.now = realNow;
  }
  const src = fs.readFileSync(path.join(process.cwd(), "lib", "payments", "webhook.ts"), "utf8");
  assert(!/founder_ends_at|founderEndsAt|getPriceOffer|Date\.now\(\)/.test(src), "the webhook processor reads no deadline, offer or clock");
}

console.log("\n--- 5c. Subscriptions: Dodo's payload shapes and every event (docs/plans/subscription.md, step 2) ---");
{
  const YEARLY = "pdt_0NsnLuCUBOY030rpuYJ9l"; // the test-mode yearly product
  process.env.PAYMENTS_YEARLY_PRODUCT_ID = YEARLY;
  const examples = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "dodo-webhook-examples.json"), "utf8")).events;
  const parser = new DodoPaymentProvider();
  const at = (minutes) => new Date(Date.UTC(2026, 11, 1, 12, minutes)).toISOString();
  /** Dodo's example for `type`, made ours: the yearly product, a time, and optional data overrides. */
  const example = (type, { minutes = 0, data = {}, signed } = {}) => {
    const e = JSON.parse(JSON.stringify(examples[type]));
    if (e.data.payload_type === "Subscription") e.data.product_id = YEARLY;
    if (signed) e.data.metadata = { user_id: signed, product: "lessons", metadata_signature: signMetadata(signed, "lessons", testSecret) };
    Object.assign(e.data, data);
    e.timestamp = at(minutes);
    return e;
  };
  const deliver = async (db, e) => processWebhookEvent(await parser.parseWebhookEvent(JSON.stringify(e)), db, { eventId: `msg_${e.type}_${e.timestamp}` });
  const SUB = examples["subscription.active"].data.subscription_id;

  // Every example parses to the event we act on (the shapes confirmed from Dodo's test mode).
  const kinds = {};
  for (const [type, e] of Object.entries(examples)) {
    const parsed = await parser.parseWebhookEvent(JSON.stringify(e));
    kinds[type] = parsed.type === "subscription" ? `subscription:${parsed.kind}` : parsed.type;
  }
  assert(JSON.stringify(kinds) === JSON.stringify({
    "dispute.lost": "ignored", "dispute.opened": "order_disputed", "dispute.won": "order_dispute_won",
    "payment.failed": "ignored", "payment.succeeded": "order_paid", "refund.succeeded": "order_refunded",
    "subscription.active": "subscription:active", "subscription.cancelled": "subscription:cancelled", "subscription.expired": "subscription:expired",
    "subscription.on_hold": "subscription:on_hold", "subscription.past_due": "subscription:past_due", "subscription.renewed": "subscription:renewed",
    "subscription.updated": "subscription:updated",
  }), `each of Dodo's 13 example events maps to its handler (${JSON.stringify(kinds)})`);
  const active = await parser.parseWebhookEvent(JSON.stringify(examples["subscription.active"]));
  assert(active.subscriptionId === SUB && active.customerId === "cus_8VbC6JDZzPEqfBPUdpj0K" && active.nextBillingDate === "2025-08-23T12:01:14.672Z" && active.cancelAtNextBillingDate === false && active.customerEmail === "learner@example.com", "a subscription's id, customer, next billing date and cancel flag are read from Dodo's shape");
  const cancelled = await parser.parseWebhookEvent(JSON.stringify(examples["subscription.cancelled"]));
  assert(cancelled.cancelledAt === "2025-08-04T05:48:25.139Z", "subscription.cancelled carries cancelled_at");
  const subPaid = await parser.parseWebhookEvent(JSON.stringify(example("payment.succeeded", { data: { subscription_id: SUB } })));
  assert(subPaid.type === "subscription_paid" && subPaid.paymentId === "pay_2IjeQm4hqU6RA4Z4kwDee" && subPaid.amountCents === 400 && subPaid.currency === "usd", "payment.succeeded with a subscription_id is a subscription charge (amount a number, currency lower case)");
  for (const t of ["subscription.failed", "subscription.paused", "subscription.unpaused", "subscription.plan_changed", "subscription.update_payment_method"]) {
    const r = await parser.parseWebhookEvent(JSON.stringify({ type: t, timestamp: at(0), data: { subscription_id: SUB } }));
    assert(r.type === "ignored", `${t} is ignored (one yearly plan, no pausing)`);
  }

  // subscription.active: a new row, matched by email (the example's metadata is empty); a resend changes nothing.
  const db = createMockSupabase({ users });
  let r = await deliver(db, example("subscription.active", { minutes: 0 }));
  let row = db.subscriptionFor(SUB)[0];
  assert(r.outcome === "subscription_saved" && row?.user_id === userId && row.status === "active" && row.current_period_end === "2025-08-23T12:01:14.672Z" && row.provider_customer_id === "cus_8VbC6JDZzPEqfBPUdpj0K", "subscription.active creates the subscription (email match), period end = next_billing_date");
  r = await deliver(db, example("subscription.active", { minutes: 0 }));
  assert(r.outcome === "subscription_saved" && db.subscriptionFor(SUB).length === 1, "a resent subscription.active keeps one row");

  // Signed metadata wins over the email.
  const db2 = createMockSupabase({ users });
  r = await deliver(db2, example("subscription.active", { signed: otherUserId }));
  assert(db2.subscriptionFor(SUB)[0]?.user_id === otherUserId, "the signed metadata user id is used before the email");
  const bad = example("subscription.active");
  bad.data.metadata = { user_id: otherUserId, product: "lessons", metadata_signature: "f".repeat(64) };
  const db2b = createMockSupabase({ users });
  await deliver(db2b, bad);
  assert(db2b.subscriptionFor(SUB)[0]?.user_id === userId, "a bad metadata signature falls back to the email");

  // Another product, or nobody to match: recorded, never applied.
  const db3 = createMockSupabase({ users });
  r = await deliver(db3, { ...example("subscription.active"), data: { ...example("subscription.active").data, product_id: "pdt_something_else" } });
  assert(r.outcome === "unmatched_recorded" && r.reason === "unknown_product" && db3.unmatchedFor(SUB)[0]?.event_type === "subscription_event" && db3.subscriptionFor(SUB).length === 0, "a subscription for another product is recorded as unmatched");
  r = await deliver(createMockSupabase({ users: {} }), example("subscription.active"));
  assert(r.outcome === "unmatched_recorded" && r.reason === "no_matching_user", "a subscription nobody matches is recorded as unmatched");
  delete process.env.PAYMENTS_YEARLY_PRODUCT_ID;
  r = await deliver(createMockSupabase({ users }), example("subscription.active"));
  assert(r.reason === "unknown_product", "without PAYMENTS_YEARLY_PRODUCT_ID nothing is applied");
  process.env.PAYMENTS_YEARLY_PRODUCT_ID = YEARLY;

  // Payments: the first is "new", the next "renewal"; a resend is a no-op; before the subscription, retry.
  const pay = (id, minutes) => example("payment.succeeded", { minutes, data: { subscription_id: SUB, payment_id: id, total_amount: 1200 } });
  let threw = false;
  try {
    await deliver(createMockSupabase({ users }), pay("pay_early", 0));
  } catch {
    threw = true;
  }
  assert(threw, "a payment for a subscription not seen yet throws, so Dodo retries it (HTTP 500)");
  r = await deliver(db, pay("pay_y1", 1));
  r = await deliver(db, pay("pay_y1", 1));
  assert(r.outcome === "idempotent_no_op" && db.paymentsFor(SUB).length === 1, "a resent subscription payment is a no-op");
  await deliver(db, pay("pay_y2", 2));
  assert(JSON.stringify(db.paymentsFor(SUB).map((p) => [p.charge_type, p.status, p.amount])) === JSON.stringify([["new", "succeeded", 1200], ["renewal", "succeeded", 1200]]), "the first charge is 'new', the next 'renewal'");

  // renewed moves the period end; an older event arriving late is ignored.
  r = await deliver(db, example("subscription.renewed", { minutes: 10, data: { next_billing_date: "2027-12-01T12:00:00Z" } }));
  assert(db.subscriptionFor(SUB)[0].current_period_end === "2027-12-01T12:00:00.000Z" && db.subscriptionFor(SUB)[0].status === "active", "subscription.renewed moves the period end a year on");
  r = await deliver(db, example("subscription.on_hold", { minutes: 5 }));
  assert(r.outcome === "subscription_stale" && db.subscriptionFor(SUB)[0].status === "active", "an older on_hold arriving after a newer renewal is ignored (out of order)");

  // A failed renewal: past_due (grace), then on_hold, then a recovery back to active.
  await deliver(db, example("subscription.past_due", { minutes: 20 }));
  assert(db.subscriptionFor(SUB)[0].status === "past_due" && db.subscriptionFor(SUB)[0].current_period_end === "2027-12-01T12:00:00.000Z", "past_due keeps the period end (the 7-day grace counts from it)");
  await deliver(db, example("subscription.on_hold", { minutes: 30 }));
  assert(db.subscriptionFor(SUB)[0].status === "on_hold", "on_hold: access ends");
  await deliver(db, example("subscription.active", { minutes: 40, data: { next_billing_date: "2027-12-01T12:00:00Z" } }));
  assert(db.subscriptionFor(SUB)[0].status === "active", "subscription.active after on_hold restores it (recovery)");

  // Cancel at the period end (portal), then cancelled: access to the period end.
  await deliver(db, example("subscription.updated", { minutes: 50, data: { cancel_at_next_billing_date: true, next_billing_date: "2027-12-01T12:00:00Z" } }));
  row = db.subscriptionFor(SUB)[0];
  assert(row.cancel_at_period_end === true && row.status === "active", "subscription.updated sets cancel at the period end, status unchanged");
  await deliver(db, example("subscription.cancelled", { minutes: 60 }));
  row = db.subscriptionFor(SUB)[0];
  assert(row.status === "cancelled" && row.cancel_at_period_end === true && row.cancelled_at === "2025-08-04T05:48:25.139Z", "subscription.cancelled keeps 'at the period end' (access to the end of the paid year)");
  await deliver(db, example("subscription.expired", { minutes: 70 }));
  assert(db.subscriptionFor(SUB)[0].status === "expired", "subscription.expired: access ends");

  // A cancellation with no "at the period end" before it (for example by the merchant): at once.
  const db4 = createMockSupabase({ users });
  await deliver(db4, example("subscription.active", { minutes: 0 }));
  await deliver(db4, example("subscription.cancelled", { minutes: 1 }));
  assert(db4.subscriptionFor(SUB)[0].cancel_at_period_end === false && db4.subscriptionFor(SUB)[0].status === "cancelled", "a cancellation not set for the period end ends access at once");

  // Refunds and disputes carry only payment_id: found through subscription_payments.
  const db5 = createMockSupabase({ users });
  await deliver(db5, example("subscription.active", { minutes: 0, data: { next_billing_date: "2027-12-01T12:00:00Z" } }));
  await deliver(db5, pay("pay_r1", 1));
  r = await deliver(db5, example("refund.succeeded", { data: { payment_id: "pay_r1" } }));
  assert(r.outcome === "revoked" && db5.paymentsFor(SUB)[0].status === "refunded" && db5.subscriptionFor(SUB)[0].status === "refunded", "a refund of a subscription charge ends the subscription's access at once");
  r = await deliver(db5, example("refund.succeeded", { data: { payment_id: "pay_r1" } }));
  assert(r.outcome === "already_refunded", "a resent refund is a no-op");
  await deliver(db5, example("subscription.active", { minutes: 90 }));
  assert(db5.subscriptionFor(SUB)[0].status === "refunded", "a later subscription event never undoes a refund");
  assert(db5.purchasesFor("pay_r1").length === 0, "a subscription refund never touches lifetime purchases");

  const db6 = createMockSupabase({ users });
  await deliver(db6, example("subscription.active", { minutes: 0, data: { next_billing_date: "2027-12-01T12:00:00Z" } }));
  await deliver(db6, pay("pay_d1", 1));
  r = await deliver(db6, example("dispute.opened", { data: { payment_id: "pay_d1" } }));
  assert(r.outcome === "disputed" && db6.subscriptionFor(SUB)[0].status === "disputed", "a dispute of a subscription charge suspends access");
  r = await deliver(db6, example("dispute.lost", { data: { payment_id: "pay_d1" } }));
  assert(r.outcome === "ignored" && db6.subscriptionFor(SUB)[0].status === "disputed", "dispute.lost keeps it ended");
  r = await deliver(db6, example("dispute.won", { data: { payment_id: "pay_d1" } }));
  assert(r.outcome === "restored" && db6.paymentsFor(SUB)[0].status === "succeeded" && db6.subscriptionFor(SUB)[0].status === "active", "dispute.won gives access back");

  // A refund that arrives before its payment: recorded, and the payment then ends access.
  const db7 = createMockSupabase({ users });
  await deliver(db7, example("subscription.active", { minutes: 0, data: { next_billing_date: "2027-12-01T12:00:00Z" } }));
  r = await deliver(db7, example("refund.succeeded", { data: { payment_id: "pay_late" } }));
  assert(r.outcome === "unmatched_recorded" && r.reason === "refund_unknown_order", "a refund before its payment is recorded as unmatched");
  r = await deliver(db7, pay("pay_late", 2));
  assert(r.outcome === "revoked_out_of_order" && db7.paymentsFor(SUB)[0].status === "refunded" && db7.subscriptionFor(SUB)[0].status === "refunded", "the payment that follows is stored refunded, and the subscription ends");

  // A lifetime purchase's dispute won: access back, and the founder spots refresh.
  const db8 = createMockSupabase({ users });
  await processWebhookEvent(paidEvent({ orderId: "pay_life", userId }), db8);
  await deliver(db8, example("dispute.opened", { data: { payment_id: "pay_life" } }));
  assert(db8.purchasesFor("pay_life")[0].status === "disputed", "a lifetime purchase's dispute suspends it (as before)");
  r = await deliver(db8, example("dispute.won", { data: { payment_id: "pay_life" } }));
  assert(r.outcome === "restored" && db8.purchasesFor("pay_life")[0].status === "active", "dispute.won restores a lifetime purchase");
  const { pricingChangingOutcome } = await import("../lib/pricing-source.ts");
  assert(pricingChangingOutcome("restored") && !pricingChangingOutcome("subscription_saved") && !pricingChangingOutcome("subscription_payment_recorded"), "a restored lifetime purchase refreshes the founder spots; subscription events don't");

  // The one-time flow is unchanged: payment.succeeded without a subscription_id is a lifetime purchase.
  const lifetime = await parser.parseWebhookEvent(JSON.stringify(examples["payment.succeeded"]));
  assert(lifetime.type === "order_paid" && lifetime.orderId === "pay_2IjeQm4hqU6RA4Z4kwDee", "payment.succeeded with subscription_id null stays the lifetime flow");
  delete process.env.PAYMENTS_YEARLY_PRODUCT_ID;
}

console.log("\n--- 6. Testing Fail-Closed Config Helpers ---");
const savedKey = process.env.PAYMENTS_API_KEY;
const savedSecret = process.env.PAYMENTS_WEBHOOK_SECRET;

delete process.env.PAYMENTS_API_KEY;
delete process.env.PAYMENTS_WEBHOOK_SECRET;

assert(getPaymentsConfig() === null, "getPaymentsConfig() returns null when keys are missing (fails closed)");
assert(getSupabaseAdminConfig() === null, "getSupabaseAdminConfig() returns null when keys are missing");

process.env.PAYMENTS_API_KEY = savedKey;
process.env.PAYMENTS_WEBHOOK_SECRET = savedSecret;

console.log(`\n========================================`);
console.log(`Test Results: ${passed} passed, ${failed} failed.`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
