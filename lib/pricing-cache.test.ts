// The shared (cached) price and its invalidation. Run: npm run test:checkout (the access check is in lib/access.test.ts)
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getPriceOffer, runCheckout, type PricingInput } from "./pricing-offer.ts";
import { loadPricing, PricingReadError, pricingChangingOutcome, type PricingClient } from "./pricing-source.ts";

const ENDS = "2026-12-31T16:59:00.000Z";
const NOW = Date.parse("2026-12-01T00:00:00Z");
const live = (spotsLeft: number): PricingInput => ({ available: true, spotsLeft, founderPriceCents: 800, standardPriceCents: 1200, founderCap: 100, currency: "usd", founderEndsAt: ENDS, subscriptionPriceCents: 1200, yearlyProductConfigured: false });

describe("a cached price can never be charged", () => {
  test("the page shows the cached founder price, the last spot has gone: checkout refuses, nothing is charged", async () => {
    const cached = getPriceOffer(live(1), NOW); // what the cached page shows
    assert.equal(cached.state === "founder" && cached.chargeCents, 800);
    const charged: number[] = [];
    const outcome = await runCheckout(live(0), cached.state === "founder" ? cached.chargeCents : undefined, async (cents) => {
      charged.push(cents);
      return {};
    }, NOW);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.status, "price-changed");
    assert.deepEqual(charged, []);
  });

  test("the page's price is only compared: the amount charged is always the live one", async () => {
    const charged: number[] = [];
    await runCheckout({ ...live(5), founderPriceCents: 900 }, 900, async (cents) => (charged.push(cents), {}), NOW);
    assert.deepEqual(charged, [900]);
  });

  test("the cache holds the numbers and the deadline, never the 'is live' answer", () => {
    // The same cached pricing is live a minute before the deadline and ended a minute after.
    const cached = live(5);
    assert.equal(getPriceOffer(cached, Date.parse(ENDS) - 60_000).state, "founder");
    assert.equal(getPriceOffer(cached, Date.parse(ENDS) + 60_000).state, "ended");
  });
});

/** A fake public client: settings and spots answers, and a count of calls in flight at once. */
function fakeClient(settings: { data: unknown; error: unknown }, spots: { data: unknown; error: unknown }) {
  let inFlight = 0;
  let maxInFlight = 0;
  const later = <T,>(value: T) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<T>((r) => setTimeout(() => (inFlight--, r(value)), 5));
  };
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => later(settings) }) }) }) }),
    rpc: () => later(spots),
  } as unknown as PricingClient;
  return { client, maxInFlight: () => maxInFlight };
}
const row = { founder_price_cents: 800, standard_price_cents: 1200, founder_cap: 100, currency: "USD", founder_ends_at: "2026-12-31T16:59:00+00:00" };

describe("loadPricing (what the shared cache stores)", () => {
  test("reads the settings and the founder spots in parallel", async () => {
    const f = fakeClient({ data: row, error: null }, { data: 37, error: null });
    // Before 0012 (no subscription_price_cents): the yearly price is null, so the yearly plan stays "coming soon".
    assert.deepEqual(await loadPricing(f.client), { available: true, spotsLeft: 37, founderPriceCents: 800, standardPriceCents: 1200, founderCap: 100, currency: "usd", founderEndsAt: ENDS, subscriptionPriceCents: null, yearlyProductConfigured: false });
    assert.equal(f.maxInFlight(), 2, "both calls at once");
  });

  test("the yearly price (0012) and the configured product are passed through; a bad price is null", async () => {
    const withPrice = fakeClient({ data: { ...row, subscription_price_cents: 1200 }, error: null }, { data: 37, error: null });
    const got = await loadPricing(withPrice.client, "lessons", true);
    assert.deepEqual([got.subscriptionPriceCents, got.yearlyProductConfigured], [1200, true]);
    for (const bad of [0, -5, 12.5, "1200", null]) {
      const f = fakeClient({ data: { ...row, subscription_price_cents: bad }, error: null }, { data: 37, error: null });
      assert.equal((await loadPricing(f.client, "lessons", true)).subscriptionPriceCents, null, String(bad));
    }
  });

  test("never returns a failure to cache: every failure throws", async () => {
    const cases: [string, ReturnType<typeof fakeClient>][] = [
      ["settings error", fakeClient({ data: null, error: { code: "PGRST301" } }, { data: 3, error: null })],
      ["no active row", fakeClient({ data: null, error: null }, { data: 3, error: null })],
      ["spots error", fakeClient({ data: row, error: { code: "42501" } }, { data: null, error: null })],
      ["spots not a number", fakeClient({ data: row, error: null }, { data: "3", error: null })],
      ["no deadline (before 0009)", fakeClient({ data: { ...row, founder_ends_at: null }, error: null }, { data: 3, error: null })],
      ["a bad deadline", fakeClient({ data: { ...row, founder_ends_at: "soon" }, error: null }, { data: 3, error: null })],
    ];
    for (const [name, f] of cases) await assert.rejects(loadPricing(f.client), PricingReadError, name);
  });
});

describe("cache invalidation on the payments webhook", () => {
  test("a purchase granted, refunded or disputed expires the shared price; no-ops don't", () => {
    for (const o of ["granted", "revoked", "revoked_out_of_order", "disputed"]) assert.equal(pricingChangingOutcome(o), true, o);
    for (const o of ["idempotent_no_op", "idempotent_concurrent", "already_refunded", "ignored", "unmatched_recorded"]) assert.equal(pricingChangingOutcome(o), false, o);
  });
});

describe("the webhook route wires the invalidation", () => {
  test("after a price-changing outcome it expires the pricing tag at once", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("app/api/webhooks/payments/route.ts", "utf8");
    assert.match(src, /if \(pricingChangingOutcome\(result\.outcome\)\) revalidateTag\(PRICING_TAG, \{ expire: 0 \}\);/);
  });
});
