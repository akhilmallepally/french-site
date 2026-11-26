// The review actions after the session check: validation, no_access, and the reply contract.
// Run: npm run test:review
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toItem } from "./review-outbox.ts";
import type { CardState } from "./review-scheduler.ts";
import { runReviewGet, runReviewSync, validateReviewPayload } from "./review-sync.ts";
import { A, B, CARD_INDEX, FREE_IDS, PAID_IDS, ReviewFakeServer } from "./review-test-fakes.ts";

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const H = 3600_000;
const F1 = FREE_IDS[0];
const F2 = FREE_IDS[1];
const P1 = PAID_IDS[0];
const reviewed = (box = 2, reviews = 3, lapses = 1): CardState => ({ box, dueAt: iso(72 * H), lastReviewedAt: iso(-H), reviews, lapses });
const fresh: CardState = { box: 0, dueAt: iso(0), lastReviewedAt: null, reviews: 0, lapses: 0 };
const item = (id: string, s: CardState, extra: Record<string, unknown> = {}) => ({ ...toItem(id, s), ...extra });

function ctx(server: ReviewFakeServer, user = A) {
  return { userId: user, index: CARD_INDEX, nowMs: NOW, db: server.db(user), hasAccess: async () => (server.accessChecks++, server.access.has(user)) };
}
const sync = (server: ReviewFakeServer, items: unknown[], user = A, expectedUserId = user) => runReviewSync({ expectedUserId, items }, ctx(server, user));

describe("review sync: validation", () => {
  test("valid entries are applied and read back in the same call, times in millisecond ISO", async () => {
    const server = new ReviewFakeServer();
    const r = await sync(server, [item(F1, reviewed()), item(F2, fresh)]);
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.deepEqual(r.applied, [`r:${F1}`, `r:${F2}`]);
    assert.deepEqual(r.rejected, []);
    assert.deepEqual(Object.keys(r).sort(), ["applied", "rejected", "rows", "status"], "the contract: status, applied, rejected, rows");
    assert.deepEqual(r.rows, { [F1]: reviewed(), [F2]: fresh });
    assert.equal(server.accessChecks, 0, "free cards only: access is never checked");
  });

  test("payload problems reject the whole call, and nothing is written", async () => {
    const server = new ReviewFakeServer();
    const ok = item(F1, reviewed());
    const cases: [unknown, string][] = [
      [null, "bad_payload"],
      [{ expectedUserId: A, items: [] }, "bad_payload"],
      [{ expectedUserId: A, items: [ok], extra: 1 }, "unexpected_field"],
      [{ expectedUserId: A, items: Array.from({ length: 201 }, (_, i) => item(FREE_IDS[i], fresh)) }, "too_many_items"],
      [{ expectedUserId: A, items: Array.from({ length: 150 }, (_, i) => ({ ...item(FREE_IDS[i], fresh), dueAt: "x".repeat(1000) })) }, "too_large"],
      [{ expectedUserId: A, items: [{ ...ok, key: "e:1" }] }, "bad_key"],
      [{ expectedUserId: A, items: [{ ...ok, key: undefined }] }, "bad_key"],
      [{ expectedUserId: A, items: [{ ...ok, key: `r:${"x".repeat(200)}` }] }, "bad_key"],
      [{ expectedUserId: A, items: [ok, { ...item(F2, fresh), key: ok.key }] }, "duplicate_key"],
      [{ expectedUserId: A, items: [{ ...ok, fr: "bonjour" }] }, "unexpected_field"],
      [{ expectedUserId: A, items: [{ ...ok, en: "hello" }] }, "unexpected_field"],
      [{ expectedUserId: A, items: [{ ...ok, userId: B }] }, "unexpected_field"],
      [{ expectedUserId: A, items: ["text"] }, "bad_payload"],
    ];
    for (const [input, code] of cases) {
      const r = await runReviewSync(input, ctx(server));
      assert.deepEqual(r, { status: "invalid", code }, JSON.stringify(input).slice(0, 80));
    }
    assert.equal(server.of(A).size, 0);
  });

  test("bad entries are rejected one by one with their code; the others go ahead", async () => {
    const server = new ReviewFakeServer();
    const bad: [Record<string, unknown>, string][] = [
      [{ ...item(F1, reviewed()), key: "r:1", cardId: "Not-An-Id" }, "bad_id"],
      [{ ...item(F1, reviewed()), key: "r:2", cardId: "a1-greetings-v999", lessonId: "a1-greetings" }, "unknown_id"],
      [{ ...item(F1, reviewed()), key: "r:3", lessonId: "a1-alphabet-and-accents" }, "wrong_lesson"],
      [{ ...item(F1, reviewed()), key: "r:4", box: 6 }, "bad_box"],
      [{ ...item(F1, reviewed()), key: "r:5", box: 1.5 }, "bad_box"],
      [{ ...item(F1, reviewed(2, 1, 2)), key: "r:6" }, "bad_count"],
      [{ ...item(F1, fresh), key: "r:7", reviews: 1 }, "bad_count"],
      [{ ...item(F1, reviewed(2, 0, 0)), key: "r:8" }, "bad_count"],
      [{ ...item(F1, fresh), key: "r:9", lastReviewedAt: iso(-H) }, "bad_time"],
      [{ ...item(F1, reviewed()), key: "r:10", lastReviewedAt: "2026-11-26 10:00" }, "bad_time"],
      [{ ...item(F1, reviewed()), key: "r:11", lastReviewedAt: "2026-11-26T10:00:00.123456Z" }, "bad_time"],
      [{ ...item(F1, reviewed()), key: "r:12", lastReviewedAt: iso(25 * H) }, "future_time"],
      [{ ...item(F1, reviewed()), key: "r:13", dueAt: iso(401 * 24 * H) }, "future_time"],
      [{ ...item(F1, fresh), key: "r:14", dueAt: iso(25 * H) }, "future_time"],
      [{ key: "r:15", cardId: F1 }, "bad_item"],
    ];
    const r = await sync(server, [...bad.map(([e]) => e), item(F2, reviewed())]);
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.deepEqual(r.rejected, bad.map(([e, code]) => ({ key: e.key, code })));
    assert.deepEqual(r.applied, [`r:${F2}`]);
    assert.deepEqual(Object.keys(r.rows), [F2]);
    // 23 hours ahead is accepted and stored as sent.
    const ahead = await sync(server, [item(F1, { ...reviewed(), lastReviewedAt: iso(23 * H) })]);
    assert.equal(ahead.status === "ok" && ahead.rows[F1].lastReviewedAt, iso(23 * H));
  });

  test("paid cards without access: rejected per entry as no_access, access checked once per call", async () => {
    const server = new ReviewFakeServer();
    const r = await sync(server, [item(P1, reviewed()), item(PAID_IDS[1], fresh), item(F1, reviewed())]);
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.deepEqual(r.rejected, [{ key: `r:${P1}`, code: "no_access" }, { key: `r:${PAID_IDS[1]}`, code: "no_access" }]);
    assert.deepEqual(r.applied, [`r:${F1}`]);
    assert.deepEqual(Object.keys(r.rows), [F1], "no paid row comes back");
    assert.equal(server.accessChecks, 1);
    server.access.add(A);
    const paid = await sync(server, [item(P1, reviewed())]);
    assert.ok(paid.status === "ok" && paid.applied.length === 1 && paid.rows[P1]);
    assert.equal(server.accessChecks, 2);
  });

  test("reads leave paid cards out without access (after a refund, say), and unknown rows always", async () => {
    const server = new ReviewFakeServer();
    server.access.add(A);
    await sync(server, [item(P1, reviewed()), item(F1, reviewed())]);
    server.of(A).set("zz-removed-lesson-v001", reviewed());
    const withAccess = await runReviewGet(ctx(server));
    assert.deepEqual(withAccess.status === "ok" && Object.keys(withAccess.cards).sort(), [F1, P1].sort());
    server.access.delete(A);
    const refunded = await runReviewGet(ctx(server));
    assert.deepEqual(refunded.status === "ok" && Object.keys(refunded.cards), [F1], "the paid row stays in the database, unread");
    assert.ok(server.of(A).has(P1));
  });

  test("the user is the session's: another user's payload is refused, and entries can't name a user", async () => {
    const server = new ReviewFakeServer();
    assert.deepEqual(await sync(server, [item(F1, reviewed())], A, B), { status: "wrong-user" });
    assert.equal(server.of(A).size + server.of(B).size, 0);
  });

  test("apply_review's own rejections (cap_reached) pass through; a malformed database reply is 'unavailable'", async () => {
    const server = new ReviewFakeServer();
    for (let i = 0; i < 6000; i++) server.of(A).set(`zz-cap-v${i}`, fresh);
    const r = await sync(server, [item(F1, fresh)]);
    assert.deepEqual(r.status === "ok" && r.rejected, [{ key: `r:${F1}`, code: "cap_reached" }]);
    const broken = { ...ctx(server), db: { ...server.db(A), apply: async () => ({ applied: ["r:not-sent"], rejected: [] }) } };
    assert.deepEqual(await runReviewSync({ expectedUserId: A, items: [item(F2, fresh)] }, broken), { status: "unavailable" });
  });

  test("validateReviewPayload never calls the access check for an invalid paid entry", async () => {
    let checks = 0;
    const res = await validateReviewPayload({ expectedUserId: A, items: [{ ...item(P1, reviewed()), box: 9 }] }, CARD_INDEX, NOW, async () => (checks++, true));
    assert.ok(res.ok && res.rejected[0].code === "bad_box");
    assert.equal(checks, 0);
  });
});
