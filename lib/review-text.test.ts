// The card-text read (app/actions/review-text.ts): free cards for anyone, paid cards only with access,
// at most 40 ids, no Supabase config; and the access check can't be steered by a request.
// Run: npm run test:review
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { ReviewCard } from "./review-catalogue.ts";
import { runReviewGet, runReviewSync } from "./review-sync.ts";
import { MAX_TEXT_IDS, runCardText } from "./review-text.ts";
import { A, CARD_INDEX, PAID_IDS, ReviewFakeServer } from "./review-test-fakes.ts";
import { toItem } from "./review-outbox.ts";

const read = (f: string) => (JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", f), "utf8")) as { cards: ReviewCard[] }).cards;
const FREE = read("review-cards-free.json");
const PAID = read("review-cards-paid.json");
const byId = new Map<string, { card: ReviewCard; free: boolean }>([...FREE.map((c) => [c.id, { card: c, free: true }] as const), ...PAID.map((c) => [c.id, { card: c, free: false }] as const)]);
const lookup = (id: string) => byId.get(id) ?? null;

function deps(access: boolean | "throws") {
  const calls = { n: 0 };
  return {
    calls,
    deps: {
      lookup,
      hasAccess: async () => {
        calls.n++;
        if (access === "throws") throw new Error("down");
        return access;
      },
    },
  };
}

describe("card text", () => {
  test("with access: the text fields only, free and paid cards alike, access checked once per call", async () => {
    const d = deps(true);
    const r = await runCardText([FREE[0].id, PAID[0].id, FREE[1].id], d.deps);
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.deepEqual(Object.keys(r.cards), [FREE[0].id, PAID[0].id, FREE[1].id]);
    for (const c of Object.values(r.cards)) assert.deepEqual(Object.keys(c).filter((k) => !["fr", "en", "pron", "group", "note"].includes(k)), [], "no vocab ids or levels");
    assert.equal(r.cards[FREE[0].id].fr, FREE[0].fr);
    assert.equal(r.access, true);
    assert.equal(d.calls.n, 1);
  });

  test("without access (or if the check fails) nothing comes back, free-level cards included", async () => {
    const ids = [PAID[0].id, PAID[1].id, FREE[0].id];
    const without = deps(false);
    const r = await runCardText(ids, without.deps);
    assert.deepEqual(r, { status: "ok", cards: {}, access: false });
    assert.equal(without.calls.n, 1);
    assert.ok(!JSON.stringify(r).includes(FREE[0].fr) && !JSON.stringify(r).includes(PAID[0].en), "no card text anywhere in the reply");
    assert.deepEqual(await runCardText(ids, deps("throws").deps), { status: "ok", cards: {}, access: false }, "fails closed");
  });

  test("at most 40 ids; bad input is refused; unknown ids are left out", async () => {
    const d = deps(true).deps;
    assert.equal(MAX_TEXT_IDS, 40);
    assert.ok((await runCardText(FREE.slice(0, 40).map((c) => c.id), d)).status === "ok");
    assert.deepEqual(await runCardText(FREE.slice(0, 41).map((c) => c.id), d), { status: "invalid", code: "too_many_ids" });
    assert.deepEqual(await runCardText("a1-greetings-v001", d), { status: "invalid", code: "bad_payload" });
    assert.deepEqual(await runCardText([1], d), { status: "invalid", code: "bad_payload" });
    assert.deepEqual(await runCardText([FREE[0].id, FREE[0].id], d), { status: "invalid", code: "duplicate_id" });
    const r = await runCardText(["a1-no-such-v001", "Not An Id", FREE[0].id], d);
    assert.ok(r.status === "ok" && Object.keys(r.cards).join() === FREE[0].id);
    assert.deepEqual(await runCardText([], d), { status: "ok", cards: {}, access: null });
  });

  test("with no Supabase config (no session, so no access), nothing comes back", async () => {
    // What the action's access check gives without config: getCurrentUser() is null, so false.
    const r = await runCardText([FREE[0].id, PAID[0].id], { lookup, hasAccess: async () => false });
    assert.deepEqual(r, { status: "ok", cards: {}, access: false });
  });
});

describe("the access check can't be reached from a request (Prompt 73, item 0)", () => {
  const root = process.cwd();
  const source = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

  test("the actions build the access check from the session alone, and read no environment at request time", () => {
    const review = source("app/actions/review.ts");
    const calls = review.match(/runReview(?:Sync|Get)\([^;]*\)/g) ?? [];
    assert.equal(calls.length, 2);
    for (const c of calls) assert.match(c, /hasAccess: accessFor\(s\.userId\)/);
    // The one access check (Prompt 79): hasActiveEntitlement, for the session's user. "unknown" fails
    // the call as "unavailable" (Prompt 80), so no entry is rejected as no_access and dropped.
    assert.match(review, /const accessFor = \(userId: string\) => async \(\) => \{\s*const state = await hasActiveEntitlement\(userId, "lessons"\);\s*if \(state === "unknown"\) throw new AccessUnknownError\("access check failed"\);\s*return state === "yes";/);
    const text = source("app/actions/review-text.ts");
    assert.match(text, /runCardText\(cardIds, \{ lookup: getReviewCard, hasAccess: sessionHasAccess \}\)/);
    assert.match(text, /const user = await getCurrentUser\(\);\s*const state = user \? await hasActiveEntitlement\(user\.id, "lessons"\) : "no";/);
    for (const f of [review, text]) assert.ok(!/process\.env|headers\(\)|searchParams/.test(f), "no env, header or query read");
    // The only "forced off" access is the database check script's own injected function.
    for (const f of ["app/actions/review.ts", "app/actions/review-text.ts", "lib/review-sync.ts", "lib/review-text.ts"]) {
      assert.ok(!/async \(\) => (false|true)/.test(source(f)), `${f} has no hard-coded access`);
    }
  });

  test("an access check that fails (unknown) fails the whole call: no entry is rejected as no_access or written", async () => {
    const server = new ReviewFakeServer();
    const now = Date.now();
    const state = { box: 1, dueAt: new Date(now + 86_400_000).toISOString(), lastReviewedAt: new Date(now - 3_600_000).toISOString(), reviews: 1, lapses: 0 };
    const failing = async (): Promise<boolean> => {
      throw new Error("access check failed");
    };
    await assert.rejects(runReviewSync({ expectedUserId: A, items: [toItem(PAID_IDS[0], state)] }, { userId: A, index: CARD_INDEX, nowMs: now, db: server.db(A), hasAccess: failing }));
    assert.equal(server.of(A).size, 0, "nothing written; the action answers unavailable and the store retries");
    await assert.rejects(runReviewGet({ userId: A, index: CARD_INDEX, db: server.db(A), hasAccess: failing }), "a read fails too, instead of coming back empty");
  });

  test("a payload can't carry an access flag: any field but expectedUserId and items rejects the call", async () => {
    const server = new ReviewFakeServer();
    for (const extra of [{ hasAccess: false }, { access: true }, { ctx: {} }]) {
      const r = await runReviewSync({ expectedUserId: A, items: [], ...extra }, { userId: A, index: CARD_INDEX, nowMs: Date.now(), db: server.db(A), hasAccess: async () => true });
      assert.deepEqual(r, { status: "invalid", code: "unexpected_field" });
    }
  });
});
