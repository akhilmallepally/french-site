// The checks behind npm run check:live-subscription (scripts/check-live-subscription.mjs), kept pure
// so scripts/live-subscription-checks.test.mjs can test them without a key or a network.
// The yearly product must match the test product's settings (docs/plans/subscription.md, section 8):
// $12.00 USD, billed every 1 year, a 20-year subscription period, no trial, tax added at checkout
// (not tax-inclusive: the site shows "plus tax where applicable"), and the same price as
// pricing_settings.subscription_price_cents.

const lower = (v) => (typeof v === "string" ? v.toLowerCase() : v);

/**
 * @param {unknown} product Dodo's GET /products/{id} body.
 * @param {{ priceCents: number, dbPriceCents?: number | null }} expected
 * @returns {{ name: string, ok: boolean, got: unknown, want: unknown }[]}
 */
export function evaluateLiveProduct(product, expected) {
  const p = product && typeof product === "object" ? product : {};
  const price = p.price && typeof p.price === "object" ? p.price : {};
  const checks = [
    ["a subscription (recurring price)", p.is_recurring === true || price.type === "recurring_price", price.type ?? p.is_recurring, "recurring_price"],
    ["the price", price.price === expected.priceCents, price.price, expected.priceCents],
    ["the currency", lower(price.currency) === "usd", price.currency, "USD"],
    ["billed every 1 year", lower(price.payment_frequency_interval) === "year" && price.payment_frequency_count === 1, `${price.payment_frequency_count} ${price.payment_frequency_interval}`, "1 Year"],
    ["a 20-year subscription period", lower(price.subscription_period_interval) === "year" && price.subscription_period_count === 20, `${price.subscription_period_count} ${price.subscription_period_interval}`, "20 Year"],
    ["no trial", (price.trial_period_days ?? 0) === 0, price.trial_period_days ?? 0, 0],
    ["tax added at checkout (not tax-inclusive)", price.tax_inclusive === false, price.tax_inclusive, false],
  ];
  if (expected.dbPriceCents !== undefined) {
    checks.push(["the same price as pricing_settings.subscription_price_cents", expected.dbPriceCents === price.price, expected.dbPriceCents, price.price]);
  }
  return checks.map(([name, ok, got, want]) => ({ name, ok: !!ok, got, want }));
}

/** The live key must not be a test key (and a test key is never sent to the live API). */
export function liveKeyProblem(key) {
  if (!key) return "DODO_LIVE_API_KEY is not set (add it to .env.local).";
  if (key.startsWith("dodo_test_")) return "DODO_LIVE_API_KEY is a TEST key; this check reads the LIVE product.";
  return null;
}
