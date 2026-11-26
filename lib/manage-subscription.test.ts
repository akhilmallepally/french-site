// Subscription rollout step 5 (Prompt 81): the "Your access" box on /progress for each status, the
// Manage subscription action (the learner's own customer id only, errors, no id, the rate limit),
// and the page texts (terms, refund, privacy, pricing, home, llms.txt).
// Run: npm run test:checkout
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { accessBox, describeAccess, type SubscriptionRow } from "./access-wording.ts";
import {
  PORTAL_ERROR_MESSAGE,
  PORTAL_NONE_MESSAGE,
  PORTAL_RATE_LIMITED_MESSAGE,
  PORTAL_SIGNED_OUT_MESSAGE,
  PortalLimiter,
  pickCustomerId,
  runPortal,
  safePortalLink,
  type PortalRow,
} from "./portal.ts";

const NOW = Date.parse("2027-03-01T12:00:00Z");
const END = "2028-03-01T12:00:00.000Z";
const sub = (status: string, cancel = false, end = END): SubscriptionRow => ({ status, current_period_end: end, cancel_at_period_end: cancel });
const box = (state: "yes" | "no" | "unknown", lifetime: boolean | null, subs: SubscriptionRow[] | null) => accessBox(describeAccess(state, lifetime, subs, NOW));

describe("the Your access box, for each status", () => {
  test("lifetime: 'Lifetime access', no button", () => {
    assert.deepEqual(box("yes", true, []), { kind: "lifetime", title: "Lifetime access" });
  });
  test("active: renews on the period end, with Manage subscription", () => {
    assert.deepEqual(box("yes", false, [sub("active")]), { kind: "subscription", title: "Yearly access: renews on 1 March 2028", warn: false });
  });
  test("cancelled at the period end: ends on it", () => {
    assert.deepEqual(box("yes", false, [sub("cancelled", true)]), { kind: "subscription", title: "Yearly access: ends on 1 March 2028", warn: false });
    assert.deepEqual(box("yes", false, [sub("active", true)]), { kind: "subscription", title: "Yearly access: ends on 1 March 2028", warn: false });
  });
  test("past_due: the payment problem, by the grace's last day (period end + 7 days)", () => {
    assert.deepEqual(box("yes", false, [sub("past_due", false, "2027-02-27T12:00:00.000Z")]), { kind: "subscription", title: "Payment problem: update your card by 6 March 2027", warn: true });
  });
  test("no access: nothing; unknown: the Retry state", () => {
    assert.deepEqual(box("no", null, null), { kind: "none" });
    assert.deepEqual(box("unknown", null, null), { kind: "unknown" });
  });
  test("access confirmed but the rows unreadable: neutral, and no button", () => {
    assert.deepEqual(box("yes", null, null), { kind: "access", title: "You have full access" });
  });
  test("the view: the button only for a subscription; Retry for unknown; nothing for none", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components", "access-box.tsx"), "utf8");
    assert.match(src, /if \(box\.kind === "none"\) return null;/);
    assert.match(src, /if \(box\.kind === "unknown"\) return <AccessUnknown compact/);
    assert.match(src, /\{box\.kind === "subscription" && \(\s*<div className="mt-3">\s*<ManageSubscriptionButton \/>/);
    assert.match(src, /id="your-access"/, "the Payment problem links land here");
    assert.match(fs.readFileSync(path.join(process.cwd(), "app", "progress", "page.tsx"), "utf8"), /<Suspense fallback=\{null\}>\s*<AccessBox \/>\s*<\/Suspense>\s*<ProgressDashboard/, "at the top of /progress, in its own slot");
  });
});

const row = (id: string | null, status: string, cancel = false, end = END): PortalRow => ({ provider_customer_id: id, status, current_period_end: end, cancel_at_period_end: cancel });

describe("Manage subscription (the portal action)", () => {
  const ok = (rows: PortalRow[], seen: string[] = []) => ({
    userId: "user-1",
    nowMs: NOW,
    limiter: new PortalLimiter(),
    readRows: async () => rows,
    createSession: async (customerId: string) => (seen.push(customerId), "https://customer.dodopayments.com/session/abc"),
  });

  test("opens the portal for the learner's own customer id, from their own rows", async () => {
    const seen: string[] = [];
    assert.deepEqual(await runPortal(ok([row("cus_own", "active")], seen)), { status: "ok", url: "https://customer.dodopayments.com/session/abc" });
    assert.deepEqual(seen, ["cus_own"]);
  });

  test("the action takes no input: the id can only come from the session's rows (RLS)", () => {
    const action = fs.readFileSync(path.join(process.cwd(), "app", "actions", "subscription.ts"), "utf8");
    assert.match(action, /export async function openSubscriptionPortalAction\(\): Promise<PortalReply>/);
    assert.match(action, /readRows: \(\) => readOwnSubscriptions\("lessons"\)/);
    assert.match(action, /userId: user\?\.id \?\? null/);
    assert.match(action, /createPortalSession\(customerId, `\$\{siteUrl\}\/progress`\)/, "return_url /progress");
    const purchases = fs.readFileSync(path.join(process.cwd(), "lib", "purchases.ts"), "utf8");
    assert.match(purchases, /export async function readOwnSubscriptions[\s\S]*?const supabase = await createClient\(\);[\s\S]*?\.select\("provider_customer_id, status, current_period_end, cancel_at_period_end"\)/, "the session's client, under RLS");
  });

  test("which customer: the subscription that gives access now, else the latest with an id", () => {
    assert.equal(pickCustomerId([row("cus_old", "expired", false, "2026-01-01T00:00:00Z"), row("cus_now", "active")], NOW), "cus_now");
    assert.equal(pickCustomerId([row("cus_due", "past_due", false, "2027-02-27T12:00:00Z"), row("cus_renew", "active")], NOW), "cus_renew");
    assert.equal(pickCustomerId([row("cus_a", "on_hold", false, "2027-01-01T00:00:00Z"), row("cus_b", "expired", false, "2027-02-01T00:00:00Z")], NOW), "cus_b", "on hold or expired: still the latest, to update the card");
    assert.equal(pickCustomerId([row(null, "active"), row("  ", "active")], NOW), null);
  });

  test("no subscription, or no customer id: a plain message, and no portal call", async () => {
    const seen: string[] = [];
    for (const rows of [[], [row(null, "active")]]) assert.deepEqual(await runPortal(ok(rows, seen)), { status: "none", message: PORTAL_NONE_MESSAGE });
    assert.deepEqual(seen, []);
  });

  test("errors: the read, the provider, or a link that isn't https all give the one message", async () => {
    const where: string[] = [];
    const onError = (w: string) => where.push(w);
    assert.deepEqual(await runPortal({ ...ok([]), readRows: async () => Promise.reject(new Error("db")), onError }), { status: "error", message: PORTAL_ERROR_MESSAGE });
    assert.deepEqual(await runPortal({ ...ok([row("cus", "active")]), createSession: async () => Promise.reject(new Error("502")), onError }), { status: "error", message: PORTAL_ERROR_MESSAGE });
    for (const link of ["http://insecure.example/x", "javascript:alert(1)", "", 42, null]) {
      assert.deepEqual(await runPortal({ ...ok([row("cus", "active")]), createSession: async () => link, onError }), { status: "error", message: PORTAL_ERROR_MESSAGE }, String(link));
    }
    assert.deepEqual(where.slice(0, 3), ["read", "create", "link"]);
    assert.equal(PORTAL_ERROR_MESSAGE, "Couldn't open subscription settings. Please try again.");
    assert.equal(safePortalLink("https://customer.dodopayments.com/x"), "https://customer.dodopayments.com/x");
  });

  test("signed out: nothing is read", async () => {
    let read = 0;
    assert.deepEqual(await runPortal({ ...ok([]), userId: null, readRows: async () => (read++, []) }), { status: "signed-out", message: PORTAL_SIGNED_OUT_MESSAGE });
    assert.equal(read, 0);
  });

  test("rate limit: 3 s between two, 5 in 10 minutes per learner; others aren't affected", async () => {
    const limiter = new PortalLimiter();
    const at = (t: number, userId = "user-1") => runPortal({ ...ok([row("cus", "active")]), limiter, userId, nowMs: NOW + t });
    assert.equal((await at(0)).status, "ok");
    assert.deepEqual(await at(1_000), { status: "rate-limited", message: PORTAL_RATE_LIMITED_MESSAGE }, "a double click");
    assert.equal((await at(1_000, "user-2")).status, "ok", "another learner");
    for (const t of [4_000, 8_000, 12_000, 16_000]) assert.equal((await at(t)).status, "ok");
    assert.equal((await at(20_000)).status, "rate-limited", "the sixth in 10 minutes");
    assert.equal((await at(10 * 60_000 + 1)).status, "ok", "after the window");
  });
});

describe("the pages", () => {
  const page = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), "utf8").replace(/\s+/g, " ").replace(/&apos;/g, "'");

  test("terms: the yearly subscription section", () => {
    const t = page("app", "terms", "page.tsx");
    for (const s of [
      "<h2>4. Yearly Subscription</h2>",
      "$12 a year, plus tax where applicable",
      "renews automatically every year, at the end of each paid year, until you cancel it",
      "<strong>Manage subscription</strong> on your Progress page, or with the link in the emails our Merchant of Record sends you",
      "your access continues until the end of the year you've already paid for",
      "you have 7 days to update your card",
      "your access pauses until the payment is made",
      "A change to the subscription price applies only to new subscriptions",
      "everyone who bought lifetime access keeps it",
      "Last updated: 27 November 2026",
    ]) assert.ok(t.includes(s), s);
  });

  test("refund policy: subscription payments final, a refund ends access at once, cancelling isn't a refund", () => {
    const r = page("app", "refund", "page.tsx");
    for (const s of ["Yearly subscription payments, the first one and each renewal, are <strong>final and non-refundable</strong>", "Cancelling a subscription isn't a refund", "a refunded payment ends that subscription's access at once", "Last updated: 27 November 2026"]) assert.ok(r.includes(s), s);
  });

  test("privacy: what's stored for a subscription, no card data, and Dodo's emails", () => {
    const p = page("app", "privacy", "page.tsx");
    for (const s of ["For a yearly subscription we also store its status", "when the current paid period ends", "Dodo Payments' customer and subscription identifiers", "We never see or store your payment card details", "Dodo Payments sends the receipts and, for a yearly subscription, the renewal reminders", "Last updated: 27 November 2026"]) assert.ok(p.includes(s), s);
  });

  test("pricing: the description and FAQ cover both phases; the refund FAQ matches the policy", () => {
    const p = page("app", "pricing", "page.tsx");
    assert.ok(p.includes("a one-time payment for lifetime access during the founding offer (until 31 December 2026), then yearly access"));
    assert.ok(p.includes("Until 31 December 2026 (23:59 Bangkok time), or until the founder places are taken if that comes first"));
    assert.ok(p.includes("After that, new learners get yearly access"));
    assert.ok(p.includes("lifetime purchases and yearly subscription payments for B1–C2 are final once unlocked"));
    assert.ok(p.includes("A refund ends access at once. Cancelling a subscription isn't a refund"));
  });

  test("home: the Daily review label fits both plans", () => {
    const h = page("app", "page.tsx");
    assert.ok(h.includes('label: "Included with paid access"'));
    assert.ok(!h.includes('label: "Lifetime access"'));
  });

  test("llms.txt: both plans, the yearly plan from 1 January 2027, and no price numbers", () => {
    const l = page("public", "llms.txt");
    assert.ok(l.includes("Yearly plan (from 1 January 2027)"));
    assert.ok(l.includes("Founding offer (lifetime access)"));
    assert.ok(!/[$€£]\s?\d|\d+\s?(USD|EUR|dollars?)\b/i.test(l), "no price numbers");
  });
});
