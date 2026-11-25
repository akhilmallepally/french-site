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
  const tables = { purchases: [], unmatched_payment_events: [] };
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
          } else if (rows.some((r) => r.provider === record.provider && r.provider_order_id === record.provider_order_id && r.reason === record.reason)) {
            return { error: { code: "23505", message: "duplicate key" } };
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
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
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
