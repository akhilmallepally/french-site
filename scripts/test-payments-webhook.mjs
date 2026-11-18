// scripts/test-payments-webhook.mjs
// Unit and integration tests for Phases 2 & 3:
// - Metadata signing and timing-safe verification
// - Dodo Payments provider (URL selection, signature verification with 300s window, event parsing)
// - Lemon Squeezy provider (signature verification, event parsing)
// - Provider factory
// - Idempotent monotonic state transitions in webhook processor (replay protection, refund terminals)
// - Fail-closed handling when secrets are missing

import { register } from "node:module";
import crypto from "node:crypto";

// Hook into module loader to handle 'server-only' and resolve relative .ts imports in Node
register(
  "data:text/javascript," +
    encodeURIComponent(`
    export function resolve(specifier, context, nextResolve) {
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
const { processWebhookEvent } = await import("../lib/payments/webhook.ts");

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

console.log("\n--- 5. Testing Idempotent Monotonic Webhook Processor ---");

// In-memory Supabase mock client simulating public.purchases table
function createMockSupabase() {
  const table = new Map(); // key: provider_order_id -> row

  return {
    from(tableName) {
      if (tableName !== "purchases") throw new Error(`Unexpected table: ${tableName}`);

      return {
        select(cols) {
          return {
            eq(col, val) {
              return {
                async maybeSingle() {
                  if (col === "provider_order_id") {
                    const row = table.get(val);
                    return { data: row ? { id: row.id, status: row.status } : null, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
        async insert(record) {
          if (table.has(record.provider_order_id)) {
            const err = new Error("duplicate key value violates unique constraint purchases_provider_order_unique");
            err.code = "23505";
            return { error: err };
          }
          const row = { id: table.size + 1, ...record };
          table.set(record.provider_order_id, row);
          return { error: null };
        },
        update(updates) {
          return {
            eq(col, val) {
              return (async () => {
                for (const [orderId, row] of table.entries()) {
                  if (row.id === val) {
                    Object.assign(row, updates);
                    return { error: null };
                  }
                }
                return { error: null };
              })();
            },
          };
        },
      };
    },
    _get(orderId) {
      return table.get(orderId);
    },
  };
}

const mockDb = createMockSupabase();

// 1. Initial order_paid
const res1 = await processWebhookEvent(parsedPaid, mockDb);
assert(res1.outcome === "granted", "First order_paid grants entitlement (inserts active row)");
assert(mockDb._get("pay_dodo_123")?.status === "active", "Row in DB is status = 'active'");

// 2. Duplicate order_paid (replay / retry)
const res2 = await processWebhookEvent(parsedPaid, mockDb);
assert(
  res2.outcome === "idempotent_no_op",
  "Duplicate order_paid is an idempotent no-op without inserting duplicate row"
);
assert(mockDb._get("pay_dodo_123")?.status === "active", "Status remains active");

// 3. order_refunded
const res3 = await processWebhookEvent(parsedRefund, mockDb);
assert(res3.outcome === "revoked", "order_refunded updates status to 'refunded'");
assert(mockDb._get("pay_dodo_123")?.status === "refunded", "Status updated to 'refunded'");
assert(mockDb._get("pay_dodo_123")?.refunded_at !== undefined, "refunded_at timestamp is stamped");

// 4. Duplicate order_refunded
const res4 = await processWebhookEvent(parsedRefund, mockDb);
assert(res4.outcome === "already_refunded", "Duplicate order_refunded returns already_refunded");

// 5. CRITICAL: Replay of order_paid on a refunded order must NOT revive active status
const res5 = await processWebhookEvent(parsedPaid, mockDb);
assert(
  res5.outcome === "idempotent_no_op" && res5.existingStatus === "refunded",
  "order_paid on already refunded order does NOT revive active status (monotonic)"
);
assert(mockDb._get("pay_dodo_123")?.status === "refunded", "Status stays 'refunded'");

// 6. order_disputed
const orderDisputedEvent = {
  type: "order_disputed",
  provider: "dodo",
  orderId: "pay_dodo_456",
  userId,
  product: "lessons",
};
// First insert pay_dodo_456
await processWebhookEvent(
  {
    type: "order_paid",
    provider: "dodo",
    orderId: "pay_dodo_456",
    userId,
    product: "lessons",
    amountCents: 500,
    currency: "usd",
  },
  mockDb
);
const res6 = await processWebhookEvent(orderDisputedEvent, mockDb);
assert(res6.outcome === "disputed", "order_disputed marks active order as disputed");
assert(mockDb._get("pay_dodo_456")?.status === "disputed", "Status is 'disputed'");

// 7. Invalid metadata signature rejection
const tamperedPaidEvent = {
  ...parsedPaid,
  orderId: "pay_dodo_tampered",
  product: "max", // tampered product with old signature
};
const res7 = await processWebhookEvent(tamperedPaidEvent, mockDb);
assert(res7.outcome === "invalid_metadata_signature", "order_paid with tampered metadata signature is rejected");

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
