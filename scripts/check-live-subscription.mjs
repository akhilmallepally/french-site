// npm run check:live-subscription: READ-ONLY checks of the live yearly product (docs/plans/subscription.md,
// "Going live"). It makes GET requests only: Dodo's live product, and the public price from Supabase
// (the publishable key, as any visitor). It never creates, changes or buys anything. Prints PASS or
// FAIL for each check and exits 1 on any FAIL.
// .env.local needs DODO_LIVE_API_KEY (a live key: keep it only on this machine) and
// LIVE_YEARLY_PRODUCT_ID (the live product's pdt_… id). Not part of any test run.
import { evaluateLiveProduct, liveKeyProblem } from "./live-subscription-checks.mjs";

const key = process.env.DODO_LIVE_API_KEY;
const productId = process.env.LIVE_YEARLY_PRODUCT_ID;
const problem = liveKeyProblem(key) ?? (productId ? null : "LIVE_YEARLY_PRODUCT_ID is not set (add the live product's pdt_… id to .env.local).");
if (problem) {
  console.error(`FAIL: ${problem}`);
  process.exit(1);
}

const res = await fetch(`https://live.dodopayments.com/products/${encodeURIComponent(productId)}`, {
  method: "GET",
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(10_000),
}).catch((e) => ({ ok: false, status: e.name }));
if (!res.ok) {
  console.error(`FAIL: couldn't read the live product (${res.status}). Check the key and the product id.`);
  process.exit(1);
}
const product = await res.json();

// The price the site shows and checkout compares (0012), read as the public would.
let dbPriceCents = null;
const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const sbKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (sbUrl && sbKey) {
  const r = await fetch(`${sbUrl}/rest/v1/pricing_settings?product=eq.lessons&select=subscription_price_cents`, { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }).catch(() => null);
  const rows = r?.ok ? await r.json().catch(() => null) : null;
  dbPriceCents = Array.isArray(rows) && typeof rows[0]?.subscription_price_cents === "number" ? rows[0].subscription_price_cents : null;
}

const results = evaluateLiveProduct(product, { priceCents: 1200, dbPriceCents });
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : ` (got ${JSON.stringify(r.got)}, want ${JSON.stringify(r.want)})`}`);
console.log("CHECK BY HAND  the 7-day grace with On Hold after it, immediate cancellation off and the customer emails");
console.log("               (Dodo's business settings, which the API doesn't show).");
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\nFAIL: ${failed} check(s) failed.` : "\nPASS: the live yearly product matches.");
process.exit(failed ? 1 : 0);
