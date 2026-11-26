// Checks review sync against the real database with the dedicated TEST account (never a learner's).
// It runs the same path as syncReviewAction and getReviewAction after the session check: the
// validator, runReviewSync / runReviewGet, then apply_review and the read-back through
// lib/review-db.ts (the queries the actions use), with the real access check (an active purchase).
// Only the session differs: a password sign-in instead of the site's cookie.
//
// PowerShell (the test account's details come from .env.local, never typed on the command line):
//   npm run check:review-db
// It stops if the account already has review cards (pass -- --reuse to run anyway; they're deleted
// at the end either way). The cap check fills the account to 6,000 cards with made-up ids through
// apply_review (about 30 calls), then everything is deleted with the account's own delete policy.
// Add -- --skip-cap to leave the cap check out.
//
// Prints PASS or FAIL per check and exits 1 on any failure. Never run against production by Claude.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { hasActivePurchase, type EntitlementClient } from "../lib/entitlement.ts";
import type { ReviewIdIndex } from "../lib/review-catalogue.ts";
import { reviewDb } from "../lib/review-db.ts";
import { toItem } from "../lib/review-outbox.ts";
import type { CardState } from "../lib/review-scheduler.ts";
import { runReviewGet, runReviewSync } from "../lib/review-sync.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.PROGRESS_TEST_EMAIL;
const password = process.env.PROGRESS_TEST_PASSWORD;
const reuse = process.argv.includes("--reuse");
const skipCap = process.argv.includes("--skip-cap");

if (!url || !key || !email || !password) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, PROGRESS_TEST_EMAIL and PROGRESS_TEST_PASSWORD (in .env.local).");
  process.exit(2);
}

const INDEX: ReviewIdIndex = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", "review-card-ids.json"), "utf8"));
const ids = (free: boolean) =>
  Object.entries(INDEX.lessons)
    .filter(([, l]) => (l.level === "A1" || l.level === "A2") === free)
    .flatMap(([lesson, l]) => l.cards.map((s) => `${lesson}-${s}`));
const [F1, F2] = ids(true);
const [P1] = ids(false);

let failed = 0;
function check(ok: boolean, what: string, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${what}${!ok && detail !== undefined ? ` (${JSON.stringify(detail)})` : ""}`);
  if (!ok) failed++;
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
if (signInError || !signIn.user) {
  console.error(`Sign-in failed for the test account: ${signInError?.code ?? signInError?.message ?? "no user"}`);
  process.exit(2);
}
const userId = signIn.user.id;
const db = reviewDb(supabase, userId);
const realAccess = () => hasActivePurchase(supabase as unknown as EntitlementClient, userId, "lessons");
const ms = (offset: number) => new Date(Date.now() + offset).toISOString();
const H = 3600_000;

const existing = await db.readAll();
if (existing.length && !reuse) {
  console.error(`The test account already has ${existing.length} review card(s). Pass -- --reuse to run anyway (they're deleted at the end).`);
  process.exit(2);
}

try {
  const access = await realAccess();
  console.log(`The test account ${access ? "has" : "doesn't have"} access (an active purchase).`);
  const ctx = (hasAccess = realAccess) => ({ userId, index: INDEX, nowMs: Date.now(), db, hasAccess });
  const reviewed: CardState = { box: 2, dueAt: ms(72 * H), lastReviewedAt: ms(-60_000), reviews: 3, lapses: 1 };
  const fresh: CardState = { box: 0, dueAt: ms(-30_000), lastReviewedAt: null, reviews: 0, lapses: 0 };

  // Valid entries, plus two the validator rejects (never sent).
  const batch = [
    toItem(F1, reviewed),
    toItem(F2, fresh),
    { ...toItem(F1, reviewed), key: "r:bad-id", cardId: "a1-no-such-lesson-v001", lessonId: "a1-no-such-lesson" },
    { ...toItem(F2, reviewed), key: "r:future", lastReviewedAt: ms(25 * H) },
  ];
  const first = await runReviewSync({ expectedUserId: userId, items: batch }, ctx());
  check(first.status === "ok", "sync returns ok", first);
  if (first.status === "ok") {
    check(JSON.stringify([...first.applied].sort()) === JSON.stringify([`r:${F1}`, `r:${F2}`].sort()), "the two valid entries are applied", first.applied);
    const codes = Object.fromEntries(first.rejected.map((r) => [r.key, r.code]));
    check(codes["r:bad-id"] === "unknown_id" && codes["r:future"] === "future_time", "a bad id and a future time are rejected with their codes", first.rejected);
    check(JSON.stringify(first.rows[F1]) === JSON.stringify(reviewed), "a reviewed card is read back exactly, times to the millisecond", first.rows[F1]);
    check(JSON.stringify(first.rows[F2]) === JSON.stringify(fresh), "a new card (box 0) is read back exactly", first.rows[F2]);
  }

  // Idempotent: the same entries again change nothing; an older state doesn't win; a newer one does.
  const again = await runReviewSync({ expectedUserId: userId, items: batch.slice(0, 2) }, ctx());
  check(again.status === "ok" && JSON.stringify(again.rows[F1]) === JSON.stringify(reviewed), "resending the same entries changes nothing", again);
  const older = await runReviewSync({ expectedUserId: userId, items: [toItem(F1, { ...reviewed, box: 5, lastReviewedAt: ms(-2 * H), reviews: 9 })] }, ctx());
  check(older.status === "ok" && older.rows[F1]?.box === 2 && older.rows[F1]?.reviews === 9, "an older state keeps the stored one; the counts take the max", older);

  // Paid cards need access, checked by the action.
  if (!access) {
    const paid = await runReviewSync({ expectedUserId: userId, items: [toItem(P1, reviewed)] }, ctx());
    check(paid.status === "ok" && paid.rejected[0]?.code === "no_access" && !paid.rows[P1], "a paid card without access is rejected (no_access)", paid);
  } else {
    const paid = await runReviewSync({ expectedUserId: userId, items: [toItem(P1, reviewed)] }, ctx(async () => false));
    check(paid.status === "ok" && paid.rejected[0]?.code === "no_access", "a paid card is rejected when the access check says no (the account has access, so the check is forced off here)", paid);
    const allowed = await runReviewSync({ expectedUserId: userId, items: [toItem(P1, reviewed)] }, ctx());
    check(allowed.status === "ok" && !!allowed.rows[P1], "with real access, the paid card is applied", allowed);
  }

  // Whole-payload refusals write nothing.
  const withText = await runReviewSync({ expectedUserId: userId, items: [{ ...toItem(F2, reviewed), fr: "bonjour" }] }, ctx());
  check(withText.status === "invalid" && withText.code === "unexpected_field", "an entry carrying card text is refused whole", withText);
  const otherUser = await runReviewSync({ expectedUserId: "00000000-0000-4000-8000-000000000000", items: batch.slice(0, 1) }, ctx());
  check(otherUser.status === "wrong-user", "another user's payload is refused", otherUser);

  // apply_review's own check, called directly (as anyone with a session could).
  const direct = (await db.apply([{ ...toItem(F2, reviewed), lastReviewedAt: ms(25 * H) }])) as { rejected?: { code: string }[] };
  check(direct?.rejected?.[0]?.code === "future_time", "apply_review itself rejects a review 25 h ahead", direct);

  // The whole-user read (getReviewAction's query), paid cards only with access.
  const all = await runReviewGet({ userId, index: INDEX, db, hasAccess: realAccess });
  check(all.status === "ok" && !!all.cards[F1] && !!all.cards[F2] && (access ? !!all.cards[P1] : !all.cards[P1]), "the whole-user read returns the same cards", all.status);

  // The cap: 6,000 cards per user, checked on a new card only.
  if (!skipCap) {
    const have = (await db.readAll()).length;
    const filler = Array.from({ length: 6000 - have }, (_, i) => toItem(`zz-review-check-v${i + 1}`, fresh));
    for (let i = 0; i < filler.length; i += 200) {
      const r = (await db.apply(filler.slice(i, i + 200))) as { applied?: unknown[] };
      if (!Array.isArray(r?.applied) || r.applied.length !== Math.min(200, filler.length - i)) {
        check(false, "filling the account to the cap", r);
        break;
      }
    }
    check((await db.readAll()).length === 6000, "the account holds 6,000 cards");
    const over = (await db.apply([toItem("zz-review-check-v9999", fresh)])) as { rejected?: { code: string }[] };
    check(over?.rejected?.[0]?.code === "cap_reached", "a new card past the cap is rejected (cap_reached)", over);
    const update = await runReviewSync({ expectedUserId: userId, items: [toItem(F1, { ...reviewed, box: 3, lastReviewedAt: ms(-1000), reviews: 10 })] }, ctx());
    check(update.status === "ok" && update.rows[F1]?.box === 3, "an existing card still updates at the cap", update.status);
  }
} finally {
  // Clean up with the account's own delete policy (review_cards: delete own).
  try {
    await db.deleteAll();
    const left = await db.readAll();
    check(left.length === 0, "cleanup: the account's review cards are deleted", left.length);
  } catch (error) {
    check(false, "cleanup", (error as { code?: string })?.code ?? "error");
  }
  await supabase.auth.signOut();
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll review database checks PASSED");
process.exit(failed ? 1 : 0);
