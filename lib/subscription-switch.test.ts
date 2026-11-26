// Subscription rollout step 4 (Prompt 80), with an injected clock: the switch from the founder offer
// to the yearly plan (at the deadline, or when the spots run out first), an open page crossing the
// deadline, the subscription checkout's checks (the founder price refused after the switch, the
// yearly plan offered, "coming soon" without the product, the price-changed paths), failing safely
// when the access check errors, and what a subscriber is told for each status.
// Run: npm run test:checkout
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { accessDate, accessLine, alreadyHasAccessMessage, describeAccess, type SubscriptionRow } from "./access-wording.ts";
import { accessHidesBanner } from "./founder-banner.ts";
import {
  FOUNDER_STILL_ON_MESSAGE,
  FOUNDER_SWITCHED_MESSAGE,
  OFFER_ENDED_MESSAGE,
  YEARLY_UNCONFIRMED_MESSAGE,
  getPriceOffer,
  offerPhase,
  providerPriceMatches,
  runCheckout,
  yearlyOf,
  type CheckoutPlan,
  type PricingInput,
  type YearlyTerms,
} from "./pricing-offer.ts";

const ENDS = "2026-12-31T16:59:00.000Z";
const ENDS_MS = Date.parse(ENDS);
const BEFORE = ENDS_MS - 90_000; // 1.5 minutes before the deadline
const AFTER = ENDS_MS + 60_000;
const DAY = 86_400_000;

/** Pricing after 0012, with the yearly product configured (as on the test deployment). */
const pricing = (extra: Partial<PricingInput> = {}): PricingInput => ({
  available: true,
  spotsLeft: 42,
  founderPriceCents: 800,
  standardPriceCents: 1200,
  founderCap: 100,
  currency: "usd",
  founderEndsAt: ENDS,
  subscriptionPriceCents: 1200,
  yearlyProductConfigured: true,
  ...extra,
});
/** Production today: no PAYMENTS_YEARLY_PRODUCT_ID. */
const noProduct = (extra: Partial<PricingInput> = {}) => pricing({ yearlyProductConfigured: false, ...extra });

function provider() {
  const calls: { chargeCents: number; currency: string; plan: CheckoutPlan }[] = [];
  return {
    calls,
    create: async (chargeCents: number, currency: string, plan: CheckoutPlan) => {
      calls.push({ chargeCents, currency, plan });
      return { checkoutUrl: "https://checkout.example/session" };
    },
  };
}
/** The provider's product, as Dodo's GET /products/{id} would describe it. */
const product = (over: Partial<{ priceCents: number; currency: string; interval: string | null; intervalCount: number | null }> = {}) => ({
  priceCents: 1200,
  currency: "USD",
  interval: "Year",
  intervalCount: 1,
  ...over,
});
const confirmWith = (p: ReturnType<typeof product> | null) => async (terms: YearlyTerms) => providerPriceMatches(p, terms);

describe("the switch (an injected clock)", () => {
  test("before the deadline with spots: the founder offer, carrying the yearly plan it switches to", () => {
    const offer = getPriceOffer(pricing(), BEFORE);
    assert.equal(offer.state, "founder");
    assert.deepEqual(yearlyOf(offer), { chargeCents: 1200, currency: "usd" });
    assert.equal(offerPhase(offer, BEFORE), "founder");
  });

  test("at the deadline: the yearly subscription, decided per request", () => {
    for (const now of [ENDS_MS, AFTER, AFTER + 365 * DAY]) {
      assert.deepEqual(getPriceOffer(pricing(), now), { state: "yearly", chargeCents: 1200, currency: "usd", reason: "deadline", founderEndsAt: ENDS });
    }
    assert.equal(getPriceOffer(pricing(), ENDS_MS - 1).state, "founder", "a millisecond before");
  });

  test("the spots run out first: the yearly plan before the deadline", () => {
    assert.deepEqual(getPriceOffer(pricing({ spotsLeft: 0 }), BEFORE - 30 * DAY), { state: "yearly", chargeCents: 1200, currency: "usd", reason: "sold-out", founderEndsAt: ENDS });
  });

  test("an open page crossing the deadline switches without a reload (the page's clock decides the phase)", () => {
    const shown = getPriceOffer(pricing(), BEFORE); // rendered before the deadline
    assert.equal(offerPhase(shown, BEFORE), "founder");
    assert.equal(offerPhase(shown, ENDS_MS - 1), "founder");
    assert.equal(offerPhase(shown, ENDS_MS), "yearly", "at the deadline, on the open page");
    assert.equal(offerPhase(shown, AFTER), "yearly");
  });

  test("missing env (production today): 'New plan coming soon' after the switch, on an open page too", () => {
    const shown = getPriceOffer(noProduct(), BEFORE);
    assert.equal(shown.state === "founder" && shown.yearly, null);
    assert.equal(offerPhase(shown, AFTER), "soon");
    assert.deepEqual(getPriceOffer(noProduct(), AFTER), { state: "ended", reason: "deadline", founderEndsAt: ENDS });
    assert.deepEqual(getPriceOffer(noProduct({ spotsLeft: 0 }), BEFORE), { state: "ended", reason: "sold-out", founderEndsAt: ENDS });
  });

  test("before 0012 (no yearly price) or with a bad price: 'coming soon' too", () => {
    for (const cents of [null, 0, -1, 12.5]) assert.equal(getPriceOffer(pricing({ subscriptionPriceCents: cents }), AFTER).state, "ended", String(cents));
  });

  test("the comparison line uses the yearly price", () => {
    const offer = getPriceOffer(pricing({ subscriptionPriceCents: 1500 }), BEFORE);
    assert.equal(offer.state === "founder" && offer.yearlyCents, 1500);
  });

  test("unreadable pricing stays unavailable", () => {
    assert.equal(offerPhase(getPriceOffer(pricing({ available: false }), AFTER), AFTER), "unavailable");
  });
});

describe("subscription checkout (an injected clock)", () => {
  test("$8 is refused after the switch, even from a page opened before it", async () => {
    const p = provider();
    for (const now of [ENDS_MS, AFTER]) {
      assert.deepEqual(await runCheckout(pricing(), 800, p.create, now, { plan: "founder", confirmProviderPrice: confirmWith(product()) }), {
        ok: false,
        status: "price-changed",
        message: FOUNDER_SWITCHED_MESSAGE,
      });
    }
    assert.deepEqual(await runCheckout(pricing({ spotsLeft: 0 }), 800, p.create, BEFORE), { ok: false, status: "price-changed", message: FOUNDER_SWITCHED_MESSAGE }, "spots gone first");
    assert.equal(p.calls.length, 0);
  });

  test("$12/year is offered and charged after the switch, at subscription_price_cents", async () => {
    const p = provider();
    const outcome = await runCheckout(pricing(), 1200, p.create, AFTER, { plan: "yearly", confirmProviderPrice: confirmWith(product()) });
    assert.equal(outcome.ok && outcome.plan, "yearly");
    assert.deepEqual(p.calls, [{ chargeCents: 1200, currency: "usd", plan: "yearly" }]);
  });

  test("the yearly plan is refused while the founder offer is on", async () => {
    const p = provider();
    assert.deepEqual(await runCheckout(pricing(), 1200, p.create, BEFORE, { plan: "yearly", confirmProviderPrice: confirmWith(product()) }), {
      ok: false,
      status: "price-changed",
      message: FOUNDER_STILL_ON_MESSAGE,
    });
    assert.equal(p.calls.length, 0);
  });

  test("missing env: 'coming soon', nothing can be bought", async () => {
    const p = provider();
    for (const plan of ["founder", "yearly"] as const) {
      assert.deepEqual(await runCheckout(noProduct(), undefined, p.create, AFTER, { plan, confirmProviderPrice: confirmWith(product()) }), { ok: false, status: "price-changed", message: OFFER_ENDED_MESSAGE });
    }
    assert.equal(p.calls.length, 0);
  });

  test("price-changed: the page's price differs from subscription_price_cents", async () => {
    const p = provider();
    const outcome = await runCheckout(pricing({ subscriptionPriceCents: 1500 }), 1200, p.create, AFTER, { plan: "yearly", confirmProviderPrice: confirmWith(product({ priceCents: 1500 })) });
    assert.deepEqual(outcome, { ok: false, status: "price-changed", message: "The price has just changed to $15. Please check the updated price and try again." });
    assert.equal(p.calls.length, 0);
  });

  test("price-changed: the provider's product differs (price, currency, interval), can't be read, or the check fails", async () => {
    const p = provider();
    const cases: [string, ((t: YearlyTerms) => Promise<boolean>) | undefined][] = [
      ["another price", confirmWith(product({ priceCents: 1000 }))],
      ["another currency", confirmWith(product({ currency: "EUR" }))],
      ["monthly", confirmWith(product({ interval: "Month" }))],
      ["every 2 years", confirmWith(product({ intervalCount: 2 }))],
      ["no interval (a one-time product)", confirmWith(product({ interval: null, intervalCount: null }))],
      ["unreadable", confirmWith(null)],
      ["the check throws", async () => Promise.reject(new Error("network"))],
      ["no check at all", undefined],
    ];
    for (const [name, confirm] of cases) {
      assert.deepEqual(await runCheckout(pricing(), 1200, p.create, AFTER, { plan: "yearly", confirmProviderPrice: confirm }), { ok: false, status: "price-changed", message: YEARLY_UNCONFIRMED_MESSAGE }, name);
    }
    assert.equal(p.calls.length, 0, "nothing was created");
  });

  test("the founder checkout never asks the provider's yearly price", async () => {
    const p = provider();
    let asked = 0;
    await runCheckout(pricing(), 800, p.create, BEFORE, { plan: "founder", confirmProviderPrice: async () => (asked++, false) });
    assert.equal(asked, 0);
    assert.deepEqual(p.calls, [{ chargeCents: 800, currency: "usd", plan: "founder" }]);
  });
});

describe("failing safely when the access check errors", () => {
  test("the banner hides on unknown, as for access; only a definite no shows it", () => {
    assert.equal(accessHidesBanner("unknown"), true);
    assert.equal(accessHidesBanner(true), true);
    assert.equal(accessHidesBanner(false), false);
  });

  test("access details follow the check: unknown and no carry no wording", () => {
    assert.deepEqual(describeAccess("unknown", true, [], 0), { state: "unknown" });
    assert.deepEqual(describeAccess("no", true, [], 0), { state: "no" });
  });
});

describe("what a subscriber is told (an injected clock)", () => {
  const NOW = Date.parse("2027-03-01T12:00:00Z");
  const END = "2028-03-01T12:00:00.000Z";
  const sub = (status: string, cancel = false, end = END): SubscriptionRow => ({ status, current_period_end: end, cancel_at_period_end: cancel });
  const line = (subs: SubscriptionRow[], lifetime = false, now = NOW) => {
    const d = describeAccess("yes", lifetime, subs, now);
    assert.equal(d.state, "yes");
    return d.state === "yes" ? accessLine(d) : null;
  };

  test("lifetime keeps the lifetime wording, with or without a subscription", () => {
    assert.deepEqual(line([], true), { text: "You have lifetime access!", tone: "ok" });
    assert.deepEqual(line([sub("active")], true), { text: "You have lifetime access!", tone: "ok" });
  });

  test("active: renews on the period end", () => {
    assert.equal(accessDate(END), "1 March 2028");
    assert.deepEqual(line([sub("active")]), { text: "Your access renews on 1 March 2028", tone: "ok" });
  });

  test("cancelled at the period end (or active with the cancel flag): ends on the period end", () => {
    assert.deepEqual(line([sub("cancelled", true)]), { text: "Your access ends on 1 March 2028", tone: "ok" });
    assert.deepEqual(line([sub("active", true)]), { text: "Your access ends on 1 March 2028", tone: "ok" });
  });

  test("past_due: a payment problem, linking to /progress for now", () => {
    assert.deepEqual(line([sub("past_due", false, "2027-02-27T12:00:00.000Z")]), { text: "Payment problem: update your card", href: "/progress", tone: "warn" });
  });

  test("two subscriptions: the renewing one is described; ended rows are ignored", () => {
    assert.deepEqual(line([sub("refunded"), sub("cancelled", true, "2027-06-01T00:00:00.000Z"), sub("active", false, "2027-09-01T00:00:00.000Z")]), { text: "Your access renews on 1 September 2027", tone: "ok" });
    assert.deepEqual(line([sub("on_hold"), sub("expired"), sub("past_due", false, "2027-02-25T00:00:00.000Z")]), { text: "Payment problem: update your card", href: "/progress", tone: "warn" });
  });

  test("when the rows can't be read, neutral wording (access itself was confirmed)", () => {
    assert.deepEqual(line([], false), { text: "You have full access.", tone: "ok" }, "no entitling row found");
    const d = describeAccess("yes", null, null, NOW);
    assert.equal(d.state === "yes" && accessLine(d).text, "You have full access.");
  });

  test("checkout's refusal names the access the learner has", () => {
    const of = (lifetime: boolean, subs: SubscriptionRow[]) => {
      const d = describeAccess("yes", lifetime, subs, NOW);
      return d.state === "yes" ? alreadyHasAccessMessage(d) : "";
    };
    assert.equal(of(true, []), "You already have lifetime access to these lessons.");
    assert.equal(of(false, [sub("active")]), "You already have access to these lessons. Your access renews on 1 March 2028.");
    assert.equal(of(false, [sub("cancelled", true)]), "You already have access to these lessons. Your access ends on 1 March 2028.");
  });
});
