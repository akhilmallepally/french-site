// Subscription rollout step 6 (Prompt 82): the whole yearly subscription in Dodo's TEST mode, on the
// Vercel Preview of the subscription-test branch, as the SECOND test account (SUBSCRIPTION_TEST_EMAIL).
// Run one phase at a time with npm run test:subscription-preview -- <phase> (scripts/test-subscription-
// preview.mjs checks the setup first). The browser is visible: where Dodo's pages need a person (the
// card form, the portal, the dashboard refund) the test says what to do in the terminal and waits.
//
// Every database check reads the account's own rows through its own session (RLS), never the
// service key. The preview must have PAYMENTS_TEST_SWITCH=after (yearly only), so no founder spot
// is ever taken: Previews share the production database.
//
// Phases, in order (each one starts from where the last one left the account):
//   subscribe  /pricing shows the yearly offer; pay with 4242; access, B1, Daily review, /progress
//   cancel     Manage subscription; cancel at the next billing date; "ends on", access continues
//   refund     refund the payment in Dodo's dashboard; access ends at once; progress and cards kept
//   past-due   subscribe again with 0341; next_billing_date moved close (TEST API); past_due;
//              "Payment problem"; access ends after the grace (checked with has_access's clock)
//   on-hold    (7 days later, optional) on_hold: access has ended; progress and cards kept
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { doFullRun, testClient } from "./helpers";

const BASE = (process.env.SUBSCRIPTION_PREVIEW_URL ?? "").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const STATE_FILE = path.join(process.cwd(), ".subscription-preview-state.json");
const DAY = 86_400_000;
const GRACE = 7 * DAY;

type Db = ReturnType<typeof testClient>["client"];
type SubRow = { provider_subscription_id: string; status: string; current_period_end: string; cancel_at_period_end: boolean; cancelled_at: string | null };
type PayRow = { provider_payment_id: string; charge_type: string; status: string; amount: number };

/** "1 March 2028", as the site writes it (lib/access-wording.ts, accessDate). */
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
const say = (...lines: string[]) => console.log(["", "  >>> " + lines[0], ...lines.slice(1).map((l) => "      " + l), ""].join("\n"));

async function start(context: BrowserContext): Promise<{ db: Db; page: Page }> {
  const page = await context.newPage();
  // Deployment Protection: one visit with the bypass secret sets a cookie for the preview only, so
  // the secret is never sent to Dodo's pages.
  if (BYPASS) await page.goto(`${BASE}/?x-vercel-protection-bypass=${encodeURIComponent(BYPASS)}&x-vercel-set-bypass-cookie=true`);
  const { client, jar } = testClient();
  const { data, error } = await client.auth.signInWithPassword({ email: process.env.SUBSCRIPTION_TEST_EMAIL!, password: process.env.SUBSCRIPTION_TEST_PASSWORD! });
  if (error || !data.user) throw new Error(`second test account sign-in failed: ${error?.code ?? "no user"}`);
  await new Promise((r) => setTimeout(r, 200));
  const domain = new URL(BASE).hostname;
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain, path: "/", secure: true, sameSite: "Lax" as const })));
  return { db: client, page };
}

async function subs(db: Db): Promise<SubRow[]> {
  const { data, error } = await db.from("subscriptions").select("provider_subscription_id, status, current_period_end, cancel_at_period_end, cancelled_at").eq("product", "lessons");
  if (error) throw new Error(`subscriptions read failed: ${error.code}`);
  return (data ?? []) as SubRow[];
}
async function payments(db: Db): Promise<PayRow[]> {
  const { data, error } = await db.from("subscription_payments").select("provider_payment_id, charge_type, status, amount");
  if (error) throw new Error(`subscription_payments read failed: ${error.code}`);
  return (data ?? []) as PayRow[];
}
async function hasAccess(db: Db, atIso?: string): Promise<boolean> {
  const { data, error } = await db.rpc("has_access", atIso ? { p_product: "lessons", p_now: atIso } : { p_product: "lessons" });
  if (error || typeof data !== "boolean") throw new Error(`has_access failed: ${error?.code ?? "not a boolean"}`);
  return data;
}
async function counts(db: Db) {
  const n = async (table: string) => {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`${table} count failed: ${error.code}`);
    return count ?? 0;
  };
  return { lessons: await n("lesson_progress"), exercises: await n("exercise_results"), cards: await n("review_cards") };
}
/** Polls the account's own rows until `ok` holds (Dodo's webhooks take a moment). */
async function until<T>(what: string, read: () => Promise<T>, ok: (v: T) => boolean, timeoutMs: number): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

const saveCounts = (c: Awaited<ReturnType<typeof counts>>) => fs.writeFileSync(STATE_FILE, JSON.stringify({ savedAt: new Date().toISOString(), ...c }, null, 2));
function expectKept(c: Awaited<ReturnType<typeof counts>>) {
  if (!fs.existsSync(STATE_FILE)) return say("No saved counts (run the subscribe phase first): progress and cards not compared.");
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  expect(c.lessons, "lesson progress kept").toBeGreaterThanOrEqual(saved.lessons);
  expect(c.exercises, "exercise results kept").toBeGreaterThanOrEqual(saved.exercises);
  expect(c.cards, "review cards kept").toBeGreaterThanOrEqual(saved.cards);
}

/** Best effort: fills Dodo's card form if it uses the standard autocomplete fields; the rest is the owner's. */
async function tryFillCard(page: Page, card: string) {
  for (let i = 0; i < 15; i++) {
    for (const frame of page.frames()) {
      const num = frame.locator('input[autocomplete="cc-number"]');
      if (await num.count()) {
        await num.first().fill(card).catch(() => {});
        await frame.locator('input[autocomplete="cc-exp"]').first().fill("06/32").catch(() => {});
        await frame.locator('input[autocomplete="cc-csc"]').first().fill("123").catch(() => {});
        return true;
      }
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

/** Clicks Subscribe on /pricing, lets the owner pay in Dodo's test checkout, and waits for the return. */
async function subscribe(page: Page, card: string) {
  await page.goto(`${BASE}/pricing`);
  await expect(page.getByTestId("yearly-offer").first()).toContainText("$12");
  await expect(page.getByTestId("yearly-offer").first()).toContainText("a year · plus tax where applicable");
  await expect(page.getByRole("heading", { name: "Yearly Access" })).toBeVisible();
  await expect(page.getByTestId("founder-countdown")).toHaveCount(0);
  expect(await page.locator("main").innerText(), "no founder price on the preview").not.toMatch(/\$8\b/);
  await expect(page.getByTestId("auto-renew")).toHaveText("Renews automatically at $12 a year until you cancel.");
  await page.getByRole("button", { name: "Subscribe for $12 a year" }).click();
  await page.waitForURL((u) => !u.href.startsWith(BASE), { timeout: 60_000 });
  const filled = await tryFillCard(page, card);
  say(
    `Dodo's test checkout is open in the browser${filled ? " (card number, expiry and CVV filled in)" : ""}.`,
    `Pay with card ${card.replace(/(\d{4})(?=\d)/g, "$1 ")}, expiry 06/32, CVV 123, any name and address.`,
    "Click Pay/Subscribe. The test waits (up to 10 minutes) for you to come back to the site.",
  );
  await page.waitForURL((u) => u.href.startsWith(`${BASE}/checkout/success`), { timeout: 10 * 60_000 });
  await expect(page.getByRole("heading", { name: "You're in!" })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("main")).toContainText("Thank you for subscribing");
}

/** A B1 lesson opens (no paywall), or shows the paywall. */
async function b1Opens(page: Page): Promise<boolean> {
  await page.goto(`${BASE}/lessons/b1`);
  const href = await page.locator('a[href^="/lessons/b1/"]').first().getAttribute("href");
  await page.goto(`${BASE}${href}`);
  const body = page.locator("#practice");
  const paywall = page.getByRole("heading", { name: "Continue your learning from B1 to Mastery" });
  await expect(body.or(paywall).first()).toBeVisible({ timeout: 30_000 });
  return (await body.count()) > 0;
}

test.describe.configure({ mode: "serial" });

test("@subscribe: the yearly offer, a 4242 payment, then access everywhere", async ({ browser }) => {
  const context = await browser.newContext();
  const { db, page } = await start(context);
  expect(await hasAccess(db), "the second test account must start without access (see the clean-up SQL)").toBe(false);
  const before = (await subs(db)).map((s) => s.provider_subscription_id);

  await subscribe(page, "4242424242424242");
  const sub = await until("the new subscription row (active)", () => subs(db), (r) => r.some((s) => !before.includes(s.provider_subscription_id) && s.status === "active"), 5 * 60_000);
  const row = sub.find((s) => !before.includes(s.provider_subscription_id))!;
  const end = Date.parse(row.current_period_end);
  expect(end - Date.now(), "the period ends in about a year").toBeGreaterThan(360 * DAY);
  expect(end - Date.now()).toBeLessThan(370 * DAY);
  expect(row.cancel_at_period_end).toBe(false);
  const pays = await until("the first payment row", () => payments(db), (p) => p.some((x) => x.charge_type === "new" && x.status === "succeeded"), 5 * 60_000);
  expect(pays.filter((p) => p.charge_type === "new" && p.status === "succeeded").at(-1)!.amount).toBe(1200);
  expect(await hasAccess(db)).toBe(true);

  // A B1 lesson opens; practise it, so there's progress to keep.
  expect(await b1Opens(page), "a B1 lesson opens").toBe(true);
  await doFullRun(page);
  // Daily review works: the session shows cards, not the lock.
  await page.goto(`${BASE}/review`);
  await expect(page.getByTestId("review-locked")).toHaveCount(0);
  await expect(page.getByTestId("review-progress").or(page.getByTestId("review-summary")).first()).toBeVisible({ timeout: 30_000 });
  // /progress: the renewal date and Manage subscription.
  await page.goto(`${BASE}/progress`);
  await expect(page.getByTestId("access-box")).toContainText(`Yearly access: renews on ${day(row.current_period_end)}`);
  await expect(page.getByRole("button", { name: "Manage subscription" })).toBeVisible();
  await page.waitForTimeout(5000); // let the progress and review syncs finish
  saveCounts(await counts(db));
  await context.close();
});

test("@cancel: Manage subscription, cancel at the next billing date, access continues", async ({ browser }) => {
  const context = await browser.newContext();
  const { db, page } = await start(context);
  // Re-runnable (Prompt 83): if the subscription is already set to cancel at the period end (a
  // previous run got that far), skip the portal and go straight to the checks.
  const now = Date.now();
  const live = (await subs(db)).filter((s) => ["active", "past_due", "cancelled"].includes(s.status) && Date.parse(s.current_period_end) > now);
  const already = live.find((s) => s.cancel_at_period_end);
  const active = already ?? live.find((s) => s.status === "active" && !s.cancel_at_period_end);
  expect(active, "an active subscription to cancel (run the subscribe phase first)").toBeTruthy();
  if (already) {
    say("The subscription is already set to cancel at the period end: skipping the portal, checking only.");
  } else {
    await page.goto(`${BASE}/progress`);
    await page.getByRole("button", { name: "Manage subscription" }).click();
    await page.waitForURL((u) => /dodopayments\.com$/.test(u.hostname) || u.hostname.endsWith(".dodopayments.com"), { timeout: 60_000 });
    say(
      "Dodo's customer portal is open in the browser.",
      'Cancel the subscription with "Cancel at next billing date" (not "Cancel now"), and confirm.',
      "The test waits (up to 10 minutes) for the webhook to record it.",
    );
  }
  const rows = await until(
    "the cancellation at the period end",
    () => subs(db),
    (r) => r.some((s) => s.provider_subscription_id === active!.provider_subscription_id && s.cancel_at_period_end && ["active", "cancelled"].includes(s.status)),
    10 * 60_000,
  );
  const row = rows.find((s) => s.provider_subscription_id === active!.provider_subscription_id)!;
  expect(await hasAccess(db), "access continues to the end of the paid year").toBe(true);
  expect(await hasAccess(db, new Date(Date.parse(row.current_period_end) + 60_000).toISOString()), "and ends with it (no grace after a cancellation)").toBe(false);
  await page.goto(`${BASE}/progress`);
  await expect(page.getByTestId("access-box")).toContainText(`Yearly access: ends on ${day(row.current_period_end)}`);
  expect(await b1Opens(page), "a B1 lesson still opens").toBe(true);
  await context.close();
});

test("@refund: a refund in Dodo's dashboard ends access at once; progress and cards are kept", async ({ browser }) => {
  const context = await browser.newContext();
  const { db, page } = await start(context);
  const paid = (await payments(db)).filter((p) => p.status === "succeeded");
  expect(paid.length, "a payment to refund (run the subscribe phase first)").toBeGreaterThan(0);
  say(
    `In Dodo's dashboard (TEST mode): Transactions, then Payments. Open the $12.00 payment by ${process.env.SUBSCRIPTION_TEST_EMAIL}`,
    "(the most recent), click Refund, choose the full amount, and confirm.",
    "The test waits (up to 15 minutes) for the webhook to record it.",
  );
  await until("the refunded payment and subscription", async () => ({ p: await payments(db), s: await subs(db) }), (v) => v.p.some((p) => p.status === "refunded") && v.s.some((s) => s.status === "refunded"), 15 * 60_000);
  expect(await hasAccess(db), "access ends at once").toBe(false);
  expect(await b1Opens(page), "a B1 lesson shows the paywall").toBe(false);
  await page.goto(`${BASE}/progress`);
  await expect(page.getByTestId("access-box")).toHaveCount(0);
  await page.goto(`${BASE}/review`);
  await expect(page.getByTestId("review-locked")).toBeVisible({ timeout: 30_000 });
  expectKept(await counts(db));
  await context.close();
});

test("@past-due: a failed renewal (0341), past_due with the grace, then no access after it", async ({ browser }) => {
  test.setTimeout(60 * 60_000);
  const key = process.env.DODO_TEST_API_KEY ?? "";
  expect(key.startsWith("dodo_test_"), "DODO_TEST_API_KEY must be a Dodo TEST key").toBe(true);
  const context = await browser.newContext();
  const { db, page } = await start(context);
  expect(await hasAccess(db), "no access before buying again (run the refund phase first)").toBe(false);
  const before = (await subs(db)).map((s) => s.provider_subscription_id);

  await subscribe(page, "4000000000000341");
  const rows = await until("the new subscription row (active)", () => subs(db), (r) => r.some((s) => !before.includes(s.provider_subscription_id) && s.status === "active"), 5 * 60_000);
  const subId = rows.find((s) => !before.includes(s.provider_subscription_id))!.provider_subscription_id;
  say(
    "If the checkout declined 4000 0000 0000 0341 and you paid with 4242 instead: on /progress click",
    "Manage subscription, change the card to 4000 0000 0000 0341 (06/32, 123), come back.",
    "Then click Resume in the Playwright Inspector window (also when nothing was needed).",
  );
  await page.pause();

  // Move the next billing date close, with Dodo's TEST API only (the base URL is fixed to test mode).
  const next = new Date(Date.now() + 3 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const res = await fetch(`https://test.dodopayments.com/subscriptions/${encodeURIComponent(subId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ next_billing_date: next }),
  });
  expect(res.ok, `PATCH next_billing_date (${res.status})`).toBe(true);
  say(`next_billing_date moved to ${next}. Waiting (up to 45 minutes) for the renewal to fail and the subscription to be past_due.`);
  const due = (await until("past_due", () => subs(db), (r) => r.some((s) => s.provider_subscription_id === subId && s.status === "past_due"), 45 * 60_000)).find((s) => s.provider_subscription_id === subId)!;

  const graceEnd = Date.parse(due.current_period_end) + GRACE;
  await page.goto(`${BASE}/progress`);
  await expect(page.getByTestId("access-box")).toContainText(`Payment problem: update your card by ${day(new Date(graceEnd).toISOString())}`);
  expect(await hasAccess(db), "access continues in the grace").toBe(true);
  expect(await b1Opens(page)).toBe(true);
  // After the grace: has_access's own clock (p_now), on the account's real rows.
  expect(await hasAccess(db, new Date(graceEnd - 60_000).toISOString()), "a minute before the grace ends").toBe(true);
  expect(await hasAccess(db, new Date(graceEnd + 1000).toISOString()), "after the grace").toBe(false);
  expectKept(await counts(db));
  say("Dodo puts the subscription on hold when its 7-day grace runs out. Run the on-hold phase after that (optional).");
  await context.close();
});

test("@on-hold: after Dodo's grace, on_hold: access has ended; progress and cards are kept", async ({ browser }) => {
  const context = await browser.newContext();
  const { db, page } = await start(context);
  expect((await subs(db)).some((s) => s.status === "on_hold"), "a subscription on hold (7 days after past_due)").toBe(true);
  expect(await hasAccess(db)).toBe(false);
  expect(await b1Opens(page)).toBe(false);
  await page.goto(`${BASE}/progress`);
  await expect(page.getByTestId("access-box")).toHaveCount(0);
  expectKept(await counts(db));
  await context.close();
});
