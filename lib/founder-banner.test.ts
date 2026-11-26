// The founding-offer banner's rules: shown, hidden for learners with access, on /pricing and in
// checkout, dismissed for 3 days, back in the last 48 hours, gone at the deadline; and the
// pre-paint script agrees with them. Run: npm run test:checkout
import assert from "node:assert/strict";
import vm from "node:vm";
import { describe, test } from "node:test";
import { BANNER_DISMISSED_KEY, BANNER_ENDED_KEY, bannerPathAllowed, bannerText, bannerVisible, DISMISS_MS, dismissalHides, ENDED_MEMORY_MS, LAST_HOURS_MS, prePaintScript, type BannerInput } from "./founder-banner.ts";

const ENDS = "2026-12-31T16:59:00.000Z";
const ENDS_MS = Date.parse(ENDS);
const NOW = ENDS_MS - 12 * 86400_000 - 3600_000; // 12 days 1 hour before
const base: BannerInput = { pathname: "/", founderOnSale: true, founderEndsAt: ENDS, nowMs: NOW, dismissedAtMs: null, hasAccess: false };

describe("founding-offer banner", () => {
  test("shown on ordinary pages while the offer is live, with the days left", () => {
    for (const p of ["/", "/lessons/a1", "/lessons/b1/some-lesson", "/progress", "/review", "/terms", "/practice", "/pricingx"]) {
      assert.equal(bannerVisible({ ...base, pathname: p }), true, p);
    }
    assert.equal(bannerText(800, 1200, ENDS, NOW), "Founding offer: $8 for lifetime access, ends in 12 days. From 1 January: $12 per year.");
    // The static page (no clock): the date instead of the countdown, and only the static rules.
    assert.equal(bannerText(800, 1200, ENDS, null), "Founding offer: $8 for lifetime access until 31 December 2026. From 1 January: $12 per year.");
    assert.equal(bannerVisible({ ...base, nowMs: null, dismissedAtMs: NOW }), true, "before mounting, the pre-paint script decides the time rules");
    assert.equal(bannerVisible({ ...base, nowMs: null, pathname: "/pricing" }), false);
  });

  test("hidden on /pricing and in checkout, for learners with access, when not on sale, and at the deadline", () => {
    for (const p of ["/pricing", "/pricing/", "/checkout", "/checkout/success"]) assert.equal(bannerPathAllowed(p), false, p);
    assert.equal(bannerVisible({ ...base, hasAccess: true }), false);
    assert.equal(bannerVisible({ ...base, founderOnSale: false }), false, "sold out (or pricing unreadable)");
    assert.equal(bannerVisible({ ...base, nowMs: ENDS_MS }), false);
    assert.equal(bannerText(800, 1200, ENDS, ENDS_MS), null);
  });

  test("a dismissal lasts 3 days, then it comes back", () => {
    assert.equal(bannerVisible({ ...base, dismissedAtMs: NOW - 1000 }), false);
    assert.equal(bannerVisible({ ...base, dismissedAtMs: NOW - DISMISS_MS + 1000 }), false);
    assert.equal(bannerVisible({ ...base, dismissedAtMs: NOW - DISMISS_MS }), true, "3 days later");
    assert.equal(dismissalHides(NOW + 60_000, NOW, ENDS), true, "a dismissal a minute ahead of the page's clock (it ticks once a minute) counts");
    assert.equal(dismissalHides(NOW + 2 * 86_400_000, NOW, ENDS), false, "a dismissal days 'in the future' (a wrong clock) is ignored");
  });

  test("in the last 48 hours it shows even if just dismissed", () => {
    const lastDays = ENDS_MS - LAST_HOURS_MS;
    assert.equal(bannerVisible({ ...base, nowMs: lastDays - 1, dismissedAtMs: lastDays - 1000 }), false);
    assert.equal(bannerVisible({ ...base, nowMs: lastDays, dismissedAtMs: lastDays - 1000 }), true);
    assert.equal(bannerText(800, 1200, ENDS, ENDS_MS - 30 * 3600_000), "Founding offer: $8 for lifetime access, ends in 30 hours. From 1 January: $12 per year.");
  });

  test("the pre-paint script hides it exactly when the rules do (dismissed, or remembered access with a session cookie)", () => {
    const run = (items: Record<string, string>, cookie: string, now: number) => {
      const attrs: Record<string, string> = {};
      const context = {
        Date: { now: () => now, parse: Date.parse },
        JSON,
        parseInt,
        localStorage: { getItem: (k: string) => items[k] ?? null },
        document: { cookie, documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
      };
      vm.runInNewContext(prePaintScript(ENDS, "parlons-access-v1"), context);
      return attrs["data-founder-banner"] === "hidden";
    };
    const access = JSON.stringify({ userId: "u1", access: true });
    assert.equal(run({}, "", NOW), false);
    assert.equal(run({ [BANNER_DISMISSED_KEY]: String(NOW - 1000) }, "", NOW), true);
    assert.equal(run({ [BANNER_DISMISSED_KEY]: String(NOW - DISMISS_MS - 1) }, "", NOW), false);
    assert.equal(run({ [BANNER_DISMISSED_KEY]: String(ENDS_MS - LAST_HOURS_MS) }, "", ENDS_MS - LAST_HOURS_MS + 1000), false, "the last 48 hours");
    assert.equal(run({ "parlons-access-v1": access }, "sb-abc-auth-token=base64-x", NOW), true);
    assert.equal(run({ "parlons-access-v1": access }, "sb-abc-auth-token.0=base64-x; other=1", NOW), true);
    assert.equal(run({ "parlons-access-v1": access }, "", NOW), false, "signed out: the remembered access doesn't count");
    assert.equal(run({ "parlons-access-v1": "not json" }, "sb-abc-auth-token=x", NOW), false, "broken storage never throws");
    assert.equal(run({}, "", ENDS_MS), true, "after the deadline (a static page served late): hidden before paint");
    assert.equal(run({ [BANNER_ENDED_KEY]: String(NOW - 60_000) }, "", NOW), true, "recently found sold out");
    assert.equal(run({ [BANNER_ENDED_KEY]: String(NOW - ENDED_MEMORY_MS - 1) }, "", NOW), false, "an old 'sold out' is checked again");
  });
});
