// The app side of access over time (docs/plans/subscription.md, rollout step 3): the app's own access
// check (checkAccess, the core of hasActiveEntitlement) asks the real has_access() in real Postgres
// (PGlite, every migration applied) with an injected clock, and the daily review follows its answer:
// a learner whose subscription lapses loses the paid cards, their text and paid writes at once, and
// gets them back on renewal with the stored cards untouched. Lessons, the pricing slot, /practice
// and the banner take the same answer from the same helper (lib/access.test.ts checks the wiring).
// Run: npm run test:sql
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { migratedDatabase } from "../scripts/sql-harness.mjs";
import { checkAccess, type AccessClient } from "./entitlement.ts";
import type { ReviewCard } from "./review-catalogue.ts";
import { toItem } from "./review-outbox.ts";
import { cardAllowed, deckIndex, type CardState } from "./review-scheduler.ts";
import { runReviewGet, runReviewSync } from "./review-sync.ts";
import { runCardText } from "./review-text.ts";
import { CARD_INDEX, FREE_IDS, PAID_IDS, ReviewFakeServer } from "./review-test-fakes.ts";

type Db = Awaited<ReturnType<typeof migratedDatabase>>;

const T = Date.parse("2027-03-01T12:00:00Z");
const DAY = 86_400_000;
const L = "b0000000-0000-4000-8000-000000000001"; // the subscriber
const LIFETIME = "b0000000-0000-4000-8000-000000000002";
const NOBODY = "b0000000-0000-4000-8000-000000000003";

/** The injected clock. */
const clock = { now: T };

/**
 * A session client for one learner, as lib/supabase/server.ts gives the app: has_access() runs as
 * the authenticated role with that learner's claims. The time comes from the injected clock (the app
 * sends none, so in production the database's clock decides).
 */
function sessionClient(db: Db, userId: string): AccessClient & { calls: number } {
  const client = {
    calls: 0,
    rpc: async (fn: "has_access", args: { p_product: string }) => {
      client.calls++;
      assert.equal(fn, "has_access");
      assert.deepEqual(Object.keys(args), ["p_product"], "the app sends the product only");
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
      await db.exec("set role authenticated");
      try {
        const r = await db.query<{ a: boolean }>("select public.has_access($1, $2::timestamptz) as a", [args.p_product, new Date(clock.now).toISOString()]);
        return { data: r.rows[0].a, error: null };
      } catch (error) {
        return { data: null, error };
      } finally {
        await db.exec("reset role");
      }
    },
  };
  return client;
}

/** A status change, written the way lib/payments/webhook.ts writes it (as the service role would). */
const setSub = (db: Db, fields: string, at: number) =>
  db.query(`update public.subscriptions set ${fields}, last_event_at = $1 where provider_subscription_id = 'sub_app_l'`, [new Date(at).toISOString()]);

const read = (f: string) => (JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", f), "utf8")) as { cards: ReviewCard[] }).cards;
const byId = new Map<string, { card: ReviewCard; free: boolean }>([
  ...read("review-cards-free.json").map((c) => [c.id, { card: c, free: true }] as const),
  ...read("review-cards-paid.json").map((c) => [c.id, { card: c, free: false }] as const),
]);
const lookup = (id: string) => byId.get(id) ?? null;
const DECK = deckIndex(CARD_INDEX);

const F1 = FREE_IDS[0];
const P1 = PAID_IDS[0];
const P2 = PAID_IDS[1];

describe("access over time, as the app sees it", () => {
  let db: Db;
  const server = new ReviewFakeServer();
  const reviewed = (box: number): CardState => ({ box, dueAt: new Date(clock.now + 3 * DAY).toISOString(), lastReviewedAt: new Date(clock.now - 3_600_000).toISOString(), reviews: 2, lapses: 0 });

  /** What each part of the review shows the learner right now. */
  async function review() {
    const client = sessionClient(db, L);
    const hasAccess = () => checkAccess(client, "lessons");
    const got = await runReviewGet({ userId: L, index: CARD_INDEX, db: server.db(L), hasAccess });
    const text = await runCardText([F1, P1], { lookup, hasAccess });
    const sync = await runReviewSync({ expectedUserId: L, items: [toItem(P2, reviewed(1))] }, { userId: L, index: CARD_INDEX, nowMs: clock.now, db: server.db(L), hasAccess });
    const access = await hasAccess();
    return {
      access,
      cards: got.status === "ok" ? Object.keys(got.cards).sort() : null,
      text: text.status === "ok" ? Object.keys(text.cards).sort() : null,
      paidWrite: sync.status === "ok" ? (sync.applied.length ? "applied" : sync.rejected.map((r) => r.code).join(",")) : sync.status,
      paidLevelOpen: cardAllowed(DECK, P1, access),
      stored: [...server.of(L).keys()].sort(),
    };
  }

  before(async () => {
    db = await migratedDatabase();
    await db.query(
      "insert into auth.users (id, email, aud, role) values ($1, 'app-l@example.invalid', 'authenticated', 'authenticated'), ($2, 'app-life@example.invalid', 'authenticated', 'authenticated'), ($3, 'app-none@example.invalid', 'authenticated', 'authenticated')",
      [L, LIFETIME, NOBODY],
    );
    await db.query("insert into public.purchases (user_id, product, status, provider, provider_order_id, amount, currency) values ($1, 'lessons', 'active', 'dodo', 'pay_app_life', 800, 'usd')", [LIFETIME]);
    // subscription.active: a year from T.
    await db.query(
      "insert into public.subscriptions (user_id, product, provider, provider_subscription_id, status, current_period_end, last_event_at) values ($1, 'lessons', 'dodo', 'sub_app_l', 'active', $2, $3)",
      [L, new Date(T + 365 * DAY).toISOString(), new Date(T).toISOString()],
    );
    // Cards the learner already has: one free, one paid.
    server.of(L).set(F1, reviewed(2));
    server.of(L).set(P1, reviewed(3));
  });

  after(async () => db?.close());

  test("subscribed: the paid cards, their text and paid writes", async () => {
    clock.now = T + 10 * DAY;
    const r = await review();
    assert.equal(r.access, true);
    assert.deepEqual(r.cards, [F1, P1].sort());
    assert.deepEqual(r.text, [F1, P1].sort());
    assert.equal(r.paidWrite, "applied");
    assert.equal(r.paidLevelOpen, true);
  });

  test("past_due inside the 7-day grace: nothing changes", async () => {
    await setSub(db, "status = 'past_due'", T + 365 * DAY);
    clock.now = T + 368 * DAY;
    const r = await review();
    assert.equal(r.access, true);
    assert.deepEqual(r.cards, [F1, P1, P2].sort());
  });

  test("the grace runs out: access goes at once, and the stored cards stay", async () => {
    clock.now = T + 372 * DAY; // exactly 7 days after the period end
    const before = [...server.of(L).keys()].sort();
    const r = await review();
    assert.equal(r.access, false, "has_access() is false from the end of the grace");
    assert.deepEqual(r.cards, [], "no cards are read without access, free ones included (the review is paid)");
    assert.deepEqual(r.text, [], "no card text");
    assert.equal(r.paidWrite, "no_access", "a paid card's write is refused");
    assert.equal(r.paidLevelOpen, false);
    assert.deepEqual(r.stored, before, "nothing stored is deleted");
    await setSub(db, "status = 'on_hold'", T + 372 * DAY);
    assert.equal((await review()).access, false, "on_hold: still none");
  });

  test("renewal brings everything back, the same cards as before", async () => {
    await setSub(db, "status = 'active', cancelled_at = null, current_period_end = '" + new Date(T + 740 * DAY).toISOString() + "'", T + 375 * DAY);
    clock.now = T + 375 * DAY;
    const r = await review();
    assert.equal(r.access, true);
    assert.deepEqual(r.cards, [F1, P1, P2].sort(), "the cards kept through the lapse");
    assert.deepEqual(r.text, [F1, P1].sort());
    assert.equal(r.paidWrite, "applied");
  });

  test("cancelled at the period end: access until that end, none after (no grace)", async () => {
    await setSub(db, "status = 'cancelled', cancel_at_period_end = true, cancelled_at = '" + new Date(T + 400 * DAY).toISOString() + "'", T + 400 * DAY);
    clock.now = T + 740 * DAY - 1000;
    assert.equal((await review()).access, true);
    clock.now = T + 740 * DAY;
    const r = await review();
    assert.equal(r.access, false);
    assert.deepEqual(r.stored, [F1, P1, P2].sort());
  });

  test("refunded: no access at once, inside the period", async () => {
    await setSub(db, "status = 'refunded', cancelled_at = null, cancel_at_period_end = false, current_period_end = '" + new Date(T + 1200 * DAY).toISOString() + "'", T + 800 * DAY);
    clock.now = T + 800 * DAY;
    assert.equal((await review()).access, false);
  });

  test("lifetime access never lapses, and nobody else's rows count", async () => {
    clock.now = T + 3650 * DAY;
    assert.equal(await checkAccess(sessionClient(db, LIFETIME), "lessons"), true);
    assert.equal(await checkAccess(sessionClient(db, NOBODY), "lessons"), false);
  });

  test("one has_access() call per check, and the app never sends a time", async () => {
    const client = sessionClient(db, LIFETIME);
    await checkAccess(client, "lessons");
    assert.equal(client.calls, 1);
  });
});
