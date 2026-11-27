// The live-product checks (scripts/live-subscription-checks.mjs) without a key or a network.
// Run: npm run test:checkout
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { evaluateLiveProduct, liveKeyProblem } from "./live-subscription-checks.mjs";

const good = {
  product_id: "pdt_live",
  is_recurring: true,
  price: { type: "recurring_price", price: 1200, currency: "USD", payment_frequency_count: 1, payment_frequency_interval: "Year", subscription_period_count: 20, subscription_period_interval: "Year", trial_period_days: 0, tax_inclusive: false },
};
const failing = (product, db) => evaluateLiveProduct(product, { priceCents: 1200, dbPriceCents: db }).filter((r) => !r.ok).map((r) => r.name);

describe("check:live-subscription", () => {
  test("a product with the test product's settings passes every check", () => {
    assert.deepEqual(failing(good, 1200), []);
  });
  test("each setting that differs fails, by name", () => {
    const p = (over) => ({ ...good, price: { ...good.price, ...over } });
    assert.deepEqual(failing(p({ price: 1000 }), 1200), ["the price", "the same price as pricing_settings.subscription_price_cents"]);
    assert.deepEqual(failing(p({ currency: "EUR" }), 1200), ["the currency"]);
    assert.deepEqual(failing(p({ payment_frequency_interval: "Month" }), 1200), ["billed every 1 year"]);
    assert.deepEqual(failing(p({ subscription_period_count: 1 }), 1200), ["a 20-year subscription period"]);
    assert.deepEqual(failing(p({ trial_period_days: 7 }), 1200), ["no trial"]);
    assert.deepEqual(failing(p({ tax_inclusive: true }), 1200), ["tax added at checkout (not tax-inclusive)"]);
    assert.deepEqual(failing({ ...good, is_recurring: false, price: { ...good.price, type: "one_time_price" } }, 1200), ["a subscription (recurring price)"]);
    assert.deepEqual(failing(good, 1500), ["the same price as pricing_settings.subscription_price_cents"]);
  });
  test("an unreadable product fails everything it can't confirm", () => {
    assert.ok(failing(null, 1200).length >= 6);
  });
  test("the key must be a live key; a test key is refused", () => {
    assert.match(liveKeyProblem(undefined), /not set/);
    assert.match(liveKeyProblem("dodo_test_abc"), /TEST key/);
    assert.equal(liveKeyProblem("live_key_abc"), null);
  });
  test("the script only reads: GET requests, and nothing that writes", () => {
    const src = fs.readFileSync("scripts/check-live-subscription.mjs", "utf8");
    assert.ok(!/method:\s*"(POST|PATCH|PUT|DELETE)"/.test(src));
    assert.match(src, /method: "GET"/);
    assert.ok(!/SERVICE_ROLE/.test(src), "no service key");
  });
});
