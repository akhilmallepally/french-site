// Run: npm run test:checkout
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  OFFER_ENDED_MESSAGE,
  PRICING_UNAVAILABLE_MESSAGE,
  beforeDeadline,
  deadlineDate,
  endsLabel,
  formatPrice,
  getPriceOffer,
  runCheckout,
  timeLeft,
  timeLeftShort,
  zoneCity,
  type PricingInput,
} from "./pricing-offer.ts";

/** The real deadline (migration 0009): 31 Dec 2026, 23:59 in Bangkok. */
const ENDS = "2026-12-31T16:59:00.000Z";
const ENDS_MS = Date.parse(ENDS);
const BEFORE = Date.parse("2026-12-19T12:59:00Z"); // 12 days 4 hours before
const AFTER = ENDS_MS + 1;

const live = (spotsLeft: number, extra: Partial<PricingInput> = {}): PricingInput => ({
  available: true,
  spotsLeft,
  founderPriceCents: 800,
  standardPriceCents: 1200,
  founderCap: 100,
  currency: "usd",
  founderEndsAt: ENDS,
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

describe("runCheckout (an injected clock)", () => {
  test("a pricing read failure creates no checkout", async () => {
    const provider = fakeProvider();
    const outcome = await runCheckout(live(100, { available: false }), undefined, provider.create, BEFORE);
    assert.deepEqual(outcome, { ok: false, status: "pricing-unavailable", message: PRICING_UNAVAILABLE_MESSAGE });
    assert.equal(provider.calls.length, 0);
  });

  test("before the deadline with spots left: charges the founder price from pricing_settings", async () => {
    const provider = fakeProvider();
    assert.equal((await runCheckout(live(42), undefined, provider.create, BEFORE)).ok, true);
    await runCheckout(live(5, { founderPriceCents: 950 }), undefined, provider.create, BEFORE);
    assert.deepEqual(provider.calls, [{ chargeCents: 800, currency: "usd" }, { chargeCents: 950, currency: "usd" }]);
  });

  test("after the deadline: refuses $8 with price-changed, even from a page opened before it", async () => {
    const provider = fakeProvider();
    const shown = getPriceOffer(live(42), BEFORE); // the open page
    assert.equal(shown.state, "founder");
    for (const now of [ENDS_MS, AFTER, AFTER + 86400_000]) {
      const outcome = await runCheckout(live(42), 800, provider.create, now);
      assert.deepEqual(outcome, { ok: false, status: "price-changed", message: OFFER_ENDED_MESSAGE }, `at ${new Date(now).toISOString()}`);
    }
    assert.deepEqual(await runCheckout(live(42), undefined, provider.create, AFTER), { ok: false, status: "price-changed", message: OFFER_ENDED_MESSAGE });
    assert.equal(provider.calls.length, 0);
    // One millisecond before: still on sale.
    assert.equal((await runCheckout(live(42), 800, provider.create, ENDS_MS - 1)).ok, true);
  });

  test("the spots run out first: refused before the deadline too", async () => {
    const provider = fakeProvider();
    assert.deepEqual(await runCheckout(live(0), 800, provider.create, BEFORE), { ok: false, status: "price-changed", message: OFFER_ENDED_MESSAGE });
    assert.equal(provider.calls.length, 0);
  });

  test("the price the page showed must match the price charged", async () => {
    const provider = fakeProvider();
    const changed = await runCheckout(live(10, { founderPriceCents: 900 }), 800, provider.create, BEFORE);
    assert.deepEqual(changed, { ok: false, status: "price-changed", message: "The price has just changed to $9. Please check the updated price and try again." });
    assert.equal(provider.calls.length, 0);
  });

  test("an unreadable deadline fails closed", async () => {
    const provider = fakeProvider();
    assert.equal((await runCheckout(live(10, { founderEndsAt: "" }), 800, provider.create, BEFORE)).ok, false);
    assert.equal(beforeDeadline("not a date", BEFORE), false);
  });
});

describe("getPriceOffer", () => {
  test("unavailable pricing shows no price", () => {
    assert.deepEqual(getPriceOffer(live(100, { available: false }), BEFORE), { state: "unavailable" });
  });

  test("live only while spots remain AND before the deadline", () => {
    const offer = getPriceOffer(live(1), BEFORE);
    assert.equal(offer.state, "founder");
    if (offer.state === "founder") assert.deepEqual([offer.chargeCents, offer.founderCap, offer.founderEndsAt, offer.yearlyCents], [800, 100, ENDS, 1200]);
    assert.deepEqual(getPriceOffer(live(1), ENDS_MS), { state: "ended", reason: "deadline", founderEndsAt: ENDS });
    assert.deepEqual(getPriceOffer(live(0), BEFORE), { state: "ended", reason: "sold-out", founderEndsAt: ENDS });
    assert.deepEqual(getPriceOffer(live(0), AFTER), { state: "ended", reason: "deadline", founderEndsAt: ENDS }, "after the deadline, whatever the spots");
  });

  test("formatPrice", () => {
    assert.equal(formatPrice(800), "$8");
    assert.equal(formatPrice(1250), "$12.50");
  });
});

describe("the countdown", () => {
  test("days and hours; hours and minutes in the last 24 hours; nothing after", () => {
    assert.equal(timeLeft(ENDS, BEFORE), "12 days 4 hours");
    assert.equal(timeLeft(ENDS, ENDS_MS - 86400_000), "1 day");
    assert.equal(timeLeft(ENDS, ENDS_MS - 86400_000 + 1), "23 hours 59 minutes");
    assert.equal(timeLeft(ENDS, ENDS_MS - 4 * 3600_000 - 12 * 60_000 - 30_000), "4 hours 12 minutes", "rounded down");
    assert.equal(timeLeft(ENDS, ENDS_MS - 3600_000), "1 hour");
    assert.equal(timeLeft(ENDS, ENDS_MS - 5 * 60_000), "5 minutes");
    assert.equal(timeLeft(ENDS, ENDS_MS - 30_000), "less than a minute");
    assert.equal(timeLeft(ENDS, ENDS_MS), null);
    assert.equal(timeLeft(ENDS, AFTER), null);
  });

  test("the banner's short form", () => {
    assert.equal(timeLeftShort(ENDS, BEFORE), "12 days");
    assert.equal(timeLeftShort(ENDS, ENDS_MS - 49 * 3600_000), "2 days");
    assert.equal(timeLeftShort(ENDS, ENDS_MS - 47 * 3600_000), "47 hours");
    assert.equal(timeLeftShort(ENDS, ENDS_MS - 90_000), "1 minute");
    assert.equal(timeLeftShort(ENDS, AFTER), null);
  });

  test("the date in the visitor's zone, named by its city", () => {
    assert.equal(endsLabel(ENDS, "Asia/Bangkok"), "Ends 31 Dec, 23:59 Bangkok time");
    assert.equal(endsLabel(ENDS, "Europe/Paris"), "Ends 31 Dec, 17:59 Paris time");
    assert.equal(endsLabel(ENDS, "America/New_York"), "Ends 31 Dec, 11:59 New York time");
    assert.equal(endsLabel(ENDS, "Pacific/Auckland"), "Ends 1 Jan, 05:59 Auckland time");
    assert.equal(endsLabel(ENDS, "UTC"), "Ends 31 Dec, 16:59 UTC");
    assert.equal(zoneCity("America/Argentina/Buenos_Aires"), "Buenos Aires");
    assert.equal(deadlineDate(ENDS), "31 December 2026");
  });
});
