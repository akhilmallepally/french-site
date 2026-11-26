// The one access check (docs/plans/subscription.md, section 3 and rollout step 3): checkAccess()
// fails closed, and every place that decides access goes through hasActiveEntitlement()
// (lib/purchases.ts), which asks has_access() once per request. The behaviour over time, against the
// real has_access() in Postgres, is in lib/access-over-time.test.ts (npm run test:sql).
// Run: npm run test:checkout
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { checkAccess, type AccessClient } from "./entitlement.ts";

const client = (reply: { data: unknown; error: unknown } | "throws", seen: unknown[] = []): AccessClient => ({
  rpc: async (fn, args) => {
    seen.push([fn, args]);
    if (reply === "throws") throw Object.assign(new Error("fetch failed"), { name: "TypeError" });
    return reply;
  },
});

describe("checkAccess (three answers, Prompt 80)", () => {
  test("yes and no as has_access() answers; anything else is unknown, never no", async () => {
    assert.equal(await checkAccess(client({ data: true, error: null }), "lessons"), "yes");
    assert.equal(await checkAccess(client({ data: false, error: null }), "lessons"), "no");
    for (const data of [null, "true", 1, {}, [true]]) assert.equal(await checkAccess(client({ data, error: null }), "lessons"), "unknown", JSON.stringify(data));
  });

  test("a database error or a network failure is unknown, and only its code is reported", async () => {
    const codes: string[] = [];
    assert.equal(await checkAccess(client({ data: true, error: { code: "PGRST202", message: "secret details" } }), "lessons", (c) => codes.push(c)), "unknown");
    assert.equal(await checkAccess(client("throws"), "lessons", (c) => codes.push(c)), "unknown");
    assert.deepEqual(codes, ["PGRST202", "TypeError"]);
  });

  test("it asks for the product only: no user id and no time (the session and the database clock decide)", async () => {
    const seen: unknown[] = [];
    await checkAccess(client({ data: true, error: null }, seen), "pro");
    assert.deepEqual(seen, [["has_access", { p_product: "pro" }]]);
  });
});

// ---------- the wiring ----------
const root = process.cwd();
const walk = (d: string): string[] =>
  fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(d, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : walk(rel);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$|test-fakes\.ts$|\.typetest\.ts$/.test(e.name) ? [rel] : [];
  });
const sources = ["app", "components", "lib"].flatMap(walk).map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")] as const);
const using = (re: RegExp) => sources.filter(([, s]) => re.test(s)).map(([f]) => f).sort();

/** Every place that decides access (Prompt 79 call-site list). */
const CALL_SITES = [
  "app/actions/access.ts", // the founder banner's check
  "app/actions/checkout.ts", // checkout's "already has access", and the success page's poll
  "app/actions/review-text.ts", // the card-text action
  "app/actions/review.ts", // the review read and sync
  "app/practice/page.tsx", // the paid-level locks
  "app/pricing/page.tsx", // the pricing slot
  "app/review/page.tsx", // the Daily review gate
  "lib/auth.ts", // lesson gating, the paywall and the sign-in panel (checkLessonAccess)
].sort();

describe("every access check goes through hasActiveEntitlement()", () => {
  test("the call sites are exactly the known list", () => {
    assert.deepEqual(using(/\bhasActiveEntitlement\(/).filter((f) => f !== "lib/purchases.ts"), CALL_SITES);
    // The wording (lifetime, renews, ends, payment problem) comes from getAccessDetails, which asks
    // hasActiveEntitlement first: the pricing slot, checkout's refusal, and the success page.
    assert.deepEqual(using(/\bgetAccessDetails\(/).filter((f) => f !== "lib/purchases.ts"), ["app/actions/checkout.ts", "app/checkout/success/page.tsx", "app/pricing/page.tsx"]);
    assert.match(fs.readFileSync(path.join(root, "lib", "purchases.ts"), "utf8"), /getAccessDetails = cache\(async \(userId: string, product: ProductKey = "lessons"\): Promise<AccessDetails> => \{\s*const state = await hasActiveEntitlement\(userId, product\);\s*if \(state !== "yes"\)/);
  });

  test("unknown is never treated as no: every gate handles it before the paywall or the buy button", () => {
    const src = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
    // Checkout refuses before reading the price or creating anything.
    const checkout = src("app/actions/checkout.ts");
    const unknownAt = checkout.indexOf('if (access === "unknown") {');
    assert.ok(unknownAt > 0 && unknownAt < checkout.indexOf("getActivePricing(product)") && unknownAt < checkout.indexOf("runCheckout("), "checkout refuses on unknown first");
    assert.match(checkout, /return \{ status: "access-unknown", error: ACCESS_UNKNOWN_MESSAGE \};/);
    // Lessons, /review, /practice and the pricing slot show "Couldn't check your access".
    assert.match(src("lib/auth.ts"), /if \(access === "unknown"\) return \{ status: "unknown" \};\s*return \{ status: "unpaid"/);
    assert.match(src("components/lesson-body.tsx"), /if \(result\.status === "unknown"\) return <AccessUnknown \/>;\s*if \(result\.status === "unpaid"\)/);
    assert.match(src("app/review/page.tsx"), /if \(access === "yes"\) return <ReviewSession \/>;\s*\/\/[^\n]*\n\s*if \(access === "unknown"\) return <AccessUnknown/);
    assert.match(src("app/practice/page.tsx"), /if \(access === "unknown"\) return <LockSlot level=\{level\} locked="unknown" \/>;/);
    assert.match(src("app/pricing/page.tsx"), /if \(access === "unknown"\) return <AccessUnknown compact \/>;/);
    // The review actions answer "unavailable" (nothing rejected or dropped); card text too.
    assert.match(src("app/actions/review.ts"), /if \(state === "unknown"\) throw new AccessUnknownError/);
    assert.match(src("app/actions/review-text.ts"), /return unknown \? \{ status: "unavailable", code: "access_unknown" \} : reply;/);
    // The banner stays hidden and doesn't remember an unknown answer.
    assert.match(src("components/founder-banner.tsx"), /if \(r\.access !== "unknown"\) rememberAccess\(r\.userId, r\.access\);\s*setHasAccess\(accessHidesBanner\(r\.access\)\);/);
  });

  test("has_access() is called in one place, and only lib/purchases.ts uses that function", () => {
    assert.deepEqual(using(/rpc\(\s*["']has_access["']/), ["lib/entitlement.ts"]);
    assert.deepEqual(using(/\bcheckAccess\b/).filter((f) => f !== "lib/entitlement.ts"), ["lib/purchases.ts"]);
    assert.deepEqual(using(/hasActivePurchase|EntitlementClient/), [], "the old purchases-only check is gone");
  });

  test("no other code reads purchases or subscriptions (the webhook writes them; lib/purchases.ts reads own rows only to word the answer)", () => {
    const readers = using(/from\(\s*["'](purchases|subscriptions)["']\s*\)/).filter((f) => !f.startsWith("lib/payments/"));
    assert.deepEqual(readers, ["lib/purchases.ts"]);
  });

  test("it's computed once per request (React's request-scoped cache), keyed by user and product", () => {
    const src = fs.readFileSync(path.join(root, "lib", "purchases.ts"), "utf8");
    assert.match(src, /import \{ cache \} from "react";/);
    assert.match(src, /const entitlementFor = cache\(async \(_userId: string, product: ProductKey\)/);
    assert.match(src, /export function hasActiveEntitlement\(userId: string, product: ProductKey = "lessons"\): Promise<AccessState> \{\s*return entitlementFor\(userId, product\);/);
  });

  test("signed-out visitors make no access call: every call site has the session's user first", () => {
    for (const f of [...CALL_SITES, "app/checkout/success/page.tsx"]) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      assert.match(src, /getCurrentUser\(\)/, `${f} reads the session`);
      for (const m of src.matchAll(/(?:hasActiveEntitlement|getAccessDetails)\(([^,)]+)/g)) assert.match(m[1], /^(user\.id|userId)$/, `${f}: ${m[0]}`);
    }
  });

  test("the shared founder-offer endpoint stays per-visitor-free", () => {
    const src = fs.readFileSync(path.join(root, "app", "api", "founder-offer", "route.ts"), "utf8");
    assert.doesNotMatch(src, /hasActiveEntitlement|getCurrentUser/);
  });
});
