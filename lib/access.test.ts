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

describe("checkAccess (fails closed)", () => {
  test("true only when has_access() answers true", async () => {
    assert.equal(await checkAccess(client({ data: true, error: null }), "lessons"), true);
    for (const data of [false, null, "true", 1, {}, [true]]) assert.equal(await checkAccess(client({ data, error: null }), "lessons"), false, JSON.stringify(data));
  });

  test("a database error or a network failure is no access, and only its code is reported", async () => {
    const codes: string[] = [];
    assert.equal(await checkAccess(client({ data: true, error: { code: "PGRST202", message: "secret details" } }), "lessons", (c) => codes.push(c)), false);
    assert.equal(await checkAccess(client("throws"), "lessons", (c) => codes.push(c)), false);
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
  "app/checkout/success/page.tsx",
  "app/practice/page.tsx", // the paid-level locks
  "app/pricing/page.tsx", // the pricing slot
  "app/review/page.tsx", // the Daily review gate
  "lib/auth.ts", // lesson gating, the paywall and the sign-in panel (checkLessonAccess)
].sort();

describe("every access check goes through hasActiveEntitlement()", () => {
  test("the call sites are exactly the known list", () => {
    assert.deepEqual(using(/\bhasActiveEntitlement\(/).filter((f) => f !== "lib/purchases.ts"), CALL_SITES);
  });

  test("has_access() is called in one place, and only lib/purchases.ts uses that function", () => {
    assert.deepEqual(using(/rpc\(\s*["']has_access["']/), ["lib/entitlement.ts"]);
    assert.deepEqual(using(/\bcheckAccess\b/).filter((f) => f !== "lib/entitlement.ts"), ["lib/purchases.ts"]);
    assert.deepEqual(using(/hasActivePurchase|EntitlementClient/), [], "the old purchases-only check is gone");
  });

  test("no other code reads purchases or subscriptions to decide access (the webhook writes them)", () => {
    const readers = using(/from\(\s*["'](purchases|subscriptions)["']\s*\)/).filter((f) => !f.startsWith("lib/payments/"));
    assert.deepEqual(readers, []);
  });

  test("it's computed once per request (React's request-scoped cache), keyed by user and product", () => {
    const src = fs.readFileSync(path.join(root, "lib", "purchases.ts"), "utf8");
    assert.match(src, /import \{ cache \} from "react";/);
    assert.match(src, /const entitlementFor = cache\(async \(_userId: string, product: ProductKey\)/);
    assert.match(src, /export function hasActiveEntitlement\(userId: string, product: ProductKey = "lessons"\): Promise<boolean> \{\s*return entitlementFor\(userId, product\);/);
  });

  test("signed-out visitors make no access call: every call site has the session's user first", () => {
    for (const f of CALL_SITES) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      assert.match(src, /getCurrentUser\(\)/, `${f} reads the session`);
      for (const m of src.matchAll(/hasActiveEntitlement\(([^,)]+)/g)) assert.match(m[1], /^(user\.id|userId)$/, `${f}: ${m[0]}`);
    }
  });

  test("the shared founder-offer endpoint stays per-visitor-free", () => {
    const src = fs.readFileSync(path.join(root, "app", "api", "founder-offer", "route.ts"), "utf8");
    assert.doesNotMatch(src, /hasActiveEntitlement|getCurrentUser/);
  });
});
