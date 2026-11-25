// Checks progress sync against the real database with a dedicated TEST account (never a learner's).
// It runs the same path as syncProgressAction after the session check: the validator, runSync, then
// apply_progress and the read-back through lib/progress-db.ts (the queries the action uses). Only the
// session differs: a password sign-in instead of the site's cookie.
//
// PowerShell (values for the test account only; .env.local supplies the Supabase URL and key):
//   $env:PROGRESS_TEST_EMAIL = "progress-test@example.com"
//   $env:PROGRESS_TEST_PASSWORD = "..."
//   npm run check:progress-db
// Add -- --reuse to run again on an account that already has progress rows (otherwise it stops,
// so it never writes into an account that holds real progress). Delete the rows afterwards with the
// SQL in docs/progress-log.md ("Progress step 4").
//
// Prints PASS or FAIL per check and exits 1 on any failure.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { progressDb, readAllRows } from "../lib/progress-db.ts";
import { rowsToProgress, runSync } from "../lib/progress-sync.ts";
import type { ProgressIndexData } from "../lib/progress-validate.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.PROGRESS_TEST_EMAIL;
const password = process.env.PROGRESS_TEST_PASSWORD;
const reuse = process.argv.includes("--reuse");

if (!url || !key || !email || !password) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (from .env.local), PROGRESS_TEST_EMAIL and PROGRESS_TEST_PASSWORD.");
  process.exit(2);
}

const INDEX: ProgressIndexData = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", "progress-index.json"), "utf8"));

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
const db = progressDb(supabase, userId);
const ms = (offset: number) => new Date(Date.now() + offset).toISOString();

const before = await readAllRows(supabase, userId);
const existing = before.lessons.length + before.exercises.length + before.writing.length;
if (existing && !reuse) {
  console.error(`The test account already has ${existing} progress row(s). Delete them with the SQL in docs/progress-log.md, or pass --reuse.`);
  process.exit(2);
}

// Real ids from the content index (the lessons that share the slug "review-work" included).
const ex1 = "a2-review-work-ex001";
const ex2 = "b1-review-work-ex001";
const lesson = "a2-review-work";
const writingLesson = Object.entries(INDEX.lessons).find(([, l]) => l.writingTask)!;
const writingId = writingLesson[1].writingTask!;
const runAt = ms(-60_000);
const attemptAt = ms(-50_000);

const batch = [
  { key: "e:1", kind: "attempt", lessonId: lesson, exerciseId: ex1, result: "correct", attemptedAt: attemptAt, addAttempts: 2, addCorrect: 1 },
  { key: "e:2", kind: "import-exercise", lessonId: "b1-review-work", exerciseId: ex2, lastResult: "incorrect", lastAttemptedAt: ms(-40_000), attempts: 3, correct: 1 },
  { key: "l:1", kind: "import-lesson", lessonId: lesson, bestScore: 11, bestTotal: 12, lastRunAt: runAt },
  { key: "w:1", kind: "writing", lessonId: writingLesson[0], exerciseId: writingId, checked: [2, 0], doneAt: ms(-30_000) },
  // Rejected by the validator, never sent: an exercise of the other "review-work", and an unknown id.
  { key: "bad:1", kind: "attempt", lessonId: "b1-review-work", exerciseId: ex1, result: "correct", attemptedAt: attemptAt, addAttempts: 1, addCorrect: 1 },
  { key: "bad:2", kind: "run", lessonId: "a1-no-such-lesson", score: 1, total: 2, runAt },
];

const ctx = { userId, index: INDEX, nowMs: Date.now(), db };
const first = await runSync({ expectedUserId: userId, items: batch }, ctx);
check(first.status === "ok", "sync returns ok", first);
if (first.status === "ok") {
  check(JSON.stringify([...first.applied].sort()) === JSON.stringify(["e:1", "e:2", "l:1", "w:1"]), "the four valid entries are applied", first.applied);
  const codes = Object.fromEntries(first.rejected.map((r) => [r.key, r.code]));
  check(codes["bad:1"] === "wrong_lesson" && codes["bad:2"] === "unknown_id", "the two bad entries are rejected with their codes", first.rejected);
  const r = first.rows;
  check(r.exercises[ex1]?.attempts === 2 && r.exercises[ex1]?.correct === 1 && r.exercises[ex1]?.lastAttemptedAt === attemptAt, "attempt row read back, time to the millisecond", r.exercises[ex1]);
  check(r.exercises[ex2]?.attempts === 3 && r.exercises[ex2]?.lastResult === "incorrect", "imported exercise row read back", r.exercises[ex2]);
  check(r.lessons[lesson]?.bestScore === 11 && r.lessons[lesson]?.completedAt === runAt && r.lessons[lesson]?.lastCompletedAt === runAt, "lesson row: best, completion at the run's time", r.lessons[lesson]);
  check(JSON.stringify(r.writingTasks?.[writingId]?.checked) === "[0,2]", "writing row: ticks deduplicated and sorted, no text", r.writingTasks?.[writingId]);
}

// Idempotent: the same batch again changes nothing (a resent attempt isn't counted twice).
const again = await runSync({ expectedUserId: userId, items: batch.slice(0, 4) }, ctx);
check(again.status === "ok" && again.rows.exercises[ex1]?.attempts === 2, "resending the same entries changes nothing", again.status === "ok" ? again.rows.exercises[ex1] : again);

// apply_progress's own checks, called directly (as anyone with a session could).
const direct = (await db.apply([{ key: "f:1", kind: "run", lessonId: lesson, score: 1, total: 2, runAt: ms(25 * 3600_000) }])) as { rejected?: { key: string; code: string }[] };
check(direct?.rejected?.[0]?.code === "future_time", "apply_progress itself rejects a time 25 h ahead", direct);

// Whole-payload rejections write nothing.
const withText = await runSync({ expectedUserId: userId, items: [{ ...batch[3], key: "w:2", text: "Mon texte." }] }, ctx);
check(withText.status === "invalid" && withText.code === "unexpected_field", "a writing entry with text is refused whole", withText);
const otherUser = await runSync({ expectedUserId: "00000000-0000-4000-8000-000000000000", items: batch.slice(0, 1) }, ctx);
check(otherUser.status === "wrong-user", "another user's payload is refused", otherUser);

// The whole-user read (getProgressAction's query) matches.
const all = rowsToProgress(await readAllRows(supabase, userId));
check(all.exercises[ex1]?.attempts === 2 && all.lessons[lesson]?.bestScore === 11 && !!all.writingTasks?.[writingId], "the whole-user read returns the same rows", all);

await supabase.auth.signOut();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll progress database checks PASSED");
console.log("Delete the test rows with the SQL in docs/progress-log.md (\"Progress step 4\").");
process.exit(failed ? 1 : 0);
