// Run: npm run test:checkout
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PRICING_UNAVAILABLE_MESSAGE,
  formatPrice,
  getPriceOffer,
  runCheckout,
  type PricingInput,
} from "./pricing-offer.ts";

const live = (spotsLeft: number, extra: Partial<PricingInput> = {}): PricingInput => ({
  available: true,
  spotsLeft,
  founderPriceCents: 800,
  standardPriceCents: 1200,
  founderCap: 100,
  currency: "usd",
  ...extra,
});

/** A fake provider that records every checkout it is asked to create. */
function fakeProvider() {
  const calls: { chargeCents: number; currency: string }[] = [];
  const create = async (chargeCents: number, currency: string) => {
    calls.push({ chargeCents, currency });
    return { checkoutUrl: "https://checkout.example/session" };
  };
  return { calls, create };
}

describe("runCheckout", () => {
  test("a pricing read failure creates no checkout", async () => {
    const provider = fakeProvider();
    // What getActivePricing returns when the pricing_settings read fails: fallback values, available false.
    const outcome = await runCheckout(live(100, { available: false }), undefined, provider.create);
    assert.deepEqual(outcome, { ok: false, status: "pricing-unavailable", message: PRICING_UNAVAILABLE_MESSAGE });
    assert.equal(provider.calls.length, 0);
  });

  test("founder state charges the founder price", async () => {
    const provider = fakeProvider();
    const outcome = await runCheckout(live(42), undefined, provider.create);
    assert.equal(outcome.ok, true);
    assert.deepEqual(provider.calls, [{ chargeCents: 800, currency: "usd" }]);
  });

  test("standard state (no spots left) charges the standard price", async () => {
    const provider = fakeProvider();
    const outcome = await runCheckout(live(0), undefined, provider.create);
    assert.equal(outcome.ok, true);
    assert.deepEqual(provider.calls, [{ chargeCents: 1200, currency: "usd" }]);
  });

  test("charges the live prices from pricing_settings, not fixed amounts", async () => {
    const provider = fakeProvider();
    await runCheckout(live(5, { founderPriceCents: 950, standardPriceCents: 1500 }), undefined, provider.create);
    await runCheckout(live(0, { founderPriceCents: 950, standardPriceCents: 1500 }), undefined, provider.create);
    assert.deepEqual(provider.calls.map((c) => c.chargeCents), [950, 1500]);
  });

  test("the price the page showed must match the price charged", async () => {
    const provider = fakeProvider();
    // The page showed $8, but the last founder spot went before the click.
    const changed = await runCheckout(live(0), 800, provider.create);
    assert.deepEqual(changed, {
      ok: false,
      status: "price-changed",
      message: "The price has just changed to $12. Please check the updated price and try again.",
    });
    assert.equal(provider.calls.length, 0);

    const same = await runCheckout(live(0), 1200, provider.create);
    assert.equal(same.ok, true);
    assert.deepEqual(provider.calls, [{ chargeCents: 1200, currency: "usd" }]);
  });
});

describe("getPriceOffer", () => {
  test("unavailable pricing shows no price", () => {
    assert.deepEqual(getPriceOffer(live(100, { available: false })), { state: "unavailable" });
  });

  test("founder offer shows the discount while spots remain", () => {
    const offer = getPriceOffer(live(1));
    if (offer.state === "unavailable") return assert.fail("should be available");
    assert.equal(offer.state, "founder");
    assert.equal(offer.chargeCents, 800);
    assert.equal(offer.showDiscount, true);
    assert.equal(offer.savePercent, 33);
  });

  test("standard price only after the spots run out", () => {
    const offer = getPriceOffer(live(0));
    if (offer.state === "unavailable") return assert.fail("should be available");
    assert.equal(offer.state, "standard");
    assert.equal(offer.chargeCents, 1200);
    assert.equal(offer.showDiscount, false);
  });

  test("no discount when the founder price equals the standard price", () => {
    const offer = getPriceOffer(live(10, { founderPriceCents: 1200 }));
    if (offer.state === "unavailable") return assert.fail("should be available");
    assert.equal(offer.showDiscount, false);
    assert.equal(offer.chargeCents, 1200);
  });

  test("formatPrice", () => {
    assert.equal(formatPrice(800), "$8");
    assert.equal(formatPrice(1250), "$12.50");
  });
});
