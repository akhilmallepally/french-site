// The test-mode switch override (Prompt 82): PAYMENTS_TEST_SWITCH=after forces the yearly-only
// state, but only with a Dodo test key and never on Vercel Production. Run: npm run test:checkout
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { FOUNDER_SWITCHED_MESSAGE, getPriceOffer, runCheckout, type PricingInput } from "./pricing-offer.ts";
import { testSwitchAfter } from "./test-switch.ts";

const ENDS = "2026-12-31T16:59:00.000Z";
const BEFORE = Date.parse("2026-12-01T00:00:00Z");
const pricing = (forceAfterSwitch: boolean): PricingInput => ({
  available: true,
  spotsLeft: 50,
  founderPriceCents: 800,
  standardPriceCents: 1200,
  founderCap: 100,
  currency: "usd",
  founderEndsAt: ENDS,
  subscriptionPriceCents: 1200,
  yearlyProductConfigured: true,
  forceAfterSwitch,
});

describe("the guard", () => {
  const on = { PAYMENTS_TEST_SWITCH: "after", PAYMENTS_API_KEY: "dodo_test_abc", VERCEL_ENV: "preview" };

  test("honoured with the flag, a Dodo test key and a non-production deployment (Preview, or local)", () => {
    assert.equal(testSwitchAfter(on), true);
    assert.equal(testSwitchAfter({ ...on, VERCEL_ENV: undefined }), true, "local next start");
    assert.equal(testSwitchAfter({ ...on, VERCEL_ENV: "development" }), true);
  });

  test("never on Vercel Production, whatever else is set", () => {
    assert.equal(testSwitchAfter({ ...on, VERCEL_ENV: "production" }), false);
  });

  test("never with a live key, or no key", () => {
    for (const key of ["dodo_live_abc", "sk_live_x", "", undefined, " dodo_test_abc", "DODO_TEST_abc"]) assert.equal(testSwitchAfter({ ...on, PAYMENTS_API_KEY: key }), false, String(key));
  });

  test("only the exact value 'after' turns it on", () => {
    for (const v of [undefined, "", "on", "true", "AFTER", "after ", "before"]) assert.equal(testSwitchAfter({ ...on, PAYMENTS_TEST_SWITCH: v }), false, String(v));
  });
});

describe("what it does", () => {
  test("the founder offer is never offered: yearly only, before the deadline with spots left", () => {
    assert.equal(getPriceOffer(pricing(false), BEFORE).state, "founder");
    assert.deepEqual(getPriceOffer(pricing(true), BEFORE), { state: "yearly", chargeCents: 1200, currency: "usd", reason: "deadline", founderEndsAt: ENDS });
  });

  test("so a test checkout can never take a founder spot: $8 is refused, $12/year is charged", async () => {
    const calls: string[] = [];
    const create = async (cents: number, _c: string, plan: string) => (calls.push(`${plan}:${cents}`), { checkoutUrl: "https://x" });
    assert.deepEqual(await runCheckout(pricing(true), 800, create, BEFORE, { plan: "founder" }), { ok: false, status: "price-changed", message: FOUNDER_SWITCHED_MESSAGE });
    assert.equal((await runCheckout(pricing(true), 1200, create, BEFORE, { plan: "yearly", confirmProviderPrice: async () => true })).ok, true);
    assert.deepEqual(calls, ["yearly:1200"]);
  });
});

describe("where it's read", () => {
  const root = process.cwd();
  const walk = (d: string): string[] =>
    fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => {
      const rel = path.posix.join(d, e.name);
      if (e.isDirectory()) return e.name === "generated" ? [] : walk(rel);
      return /\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\.(ts|mjs)$/.test(e.name) ? [rel] : [];
    });
  const files = ["app", "components", "lib"].flatMap(walk).map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")] as const);

  test("only the server's two pricing reads apply it, from process.env (never from a request)", () => {
    assert.deepEqual(files.filter(([, s]) => /\btestSwitchAfter\(/.test(s)).map(([f]) => f).sort(), ["lib/purchases.ts", "lib/shared-pricing.ts", "lib/test-switch.ts"]);
    for (const f of ["lib/purchases.ts", "lib/shared-pricing.ts"]) assert.match(fs.readFileSync(path.join(root, f), "utf8"), /testSwitchAfter\(process\.env\)/, f);
    assert.deepEqual(files.filter(([, s]) => s.includes("PAYMENTS_TEST_SWITCH")).map(([f]) => f), ["lib/test-switch.ts"]);
  });

  test("no browser code imports it", () => {
    for (const [f, s] of files) if (/^["']use client["']/.test(s)) assert.ok(!s.includes("test-switch"), f);
  });
});
