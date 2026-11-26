// Calls a progress server action over HTTP the way the Next.js client does (POST with a Next-Action
// header), for test:gating and test:no-supabase-env. The action id comes from the build's manifest.
import fs from "node:fs";
import path from "node:path";

const MANIFEST = path.join(process.cwd(), ".next", "server", "server-reference-manifest.json");

export function progressActionId(name) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const found = Object.entries(manifest.node ?? {}).find(([, v]) => v.exportedName === name && v.filename === "app/actions/progress.ts");
  if (!found) throw new Error(`${name} isn't in the server-reference manifest (is a page importing the progress wiring?)`);
  return found[0];
}

/** POSTs to a lesson page (one of the routes that load the progress wiring). Returns status and body. */
export async function callProgressAction(base, name, args, pagePath = "/lessons/a1/greetings") {
  const res = await fetch(base + pagePath, {
    method: "POST",
    headers: { "Next-Action": progressActionId(name), "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", Origin: base },
    body: JSON.stringify(args),
  });
  return { status: res.status, text: await res.text() };
}

/** The three actions, each with input a real client could send for some other user. */
export const PROGRESS_CALLS = [
  ["syncProgressAction", [{ expectedUserId: "11111111-1111-4111-8111-111111111111", items: [{ key: "r1", kind: "run", lessonId: "a1-greetings", score: 9, total: 10, runAt: new Date().toISOString() }] }]],
  ["getProgressAction", ["11111111-1111-4111-8111-111111111111"]],
  ["resetProgressAction", [{ expectedUserId: "11111111-1111-4111-8111-111111111111", confirm: "reset" }]],
];

/** True when the reply is exactly { status: "signed-out" } and carries no progress data. */
export const refusedSignedOut = (r) => r.status === 200 && /"status":"signed-out"/.test(r.text) && !/"(rows|data|applied)"/.test(r.text);

// ---------- Review actions (app/actions/review.ts, docs/plans/review.md step 4) ----------

/** A review action's id from the build's manifest, or null if no page loads it. */
export function reviewActionId(name, file = "app/actions/review.ts") {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const found = Object.entries(manifest.node ?? {}).find(([, v]) => v.exportedName === name && v.filename === file);
  return found ? found[0] : null;
}

/** The card-text action (app/actions/review-text.ts), and a free and a paid card to ask for. */
export const cardTextActionId = () => reviewActionId("getCardTextAction", "app/actions/review-text.ts");
const cardsOf = (f) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", f), "utf8")).cards;
export const SAMPLE_FREE_CARD = cardsOf("review-cards-free.json")[0];
// A paid card whose French and English are long enough to be unmistakable in a reply.
export const SAMPLE_PAID_CARD = cardsOf("review-cards-paid.json").find((c) => c.fr.length > 12 && c.en.length > 12);

export async function callReviewAction(base, id, args, pagePath = "/lessons/a1/greetings") {
  const res = await fetch(base + pagePath, {
    method: "POST",
    headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", Origin: base },
    body: JSON.stringify(args),
  });
  return { status: res.status, text: await res.text() };
}

export const REVIEW_CALLS = [
  ["syncReviewAction", [{ expectedUserId: "11111111-1111-4111-8111-111111111111", items: [{ key: "r:a1-greetings-v001", cardId: "a1-greetings-v001", lessonId: "a1-greetings", box: 0, dueAt: new Date().toISOString(), lastReviewedAt: null, reviews: 0, lapses: 0 }] }]],
  ["getReviewAction", ["11111111-1111-4111-8111-111111111111"]],
  ["resetReviewAction", [{ expectedUserId: "11111111-1111-4111-8111-111111111111", confirm: "reset" }]],
];

/** True when the reply is exactly { status: "signed-out" } and carries no review data. */
export const reviewRefusedSignedOut = (r) => r.status === 200 && /"status":"signed-out"/.test(r.text) && !/"(rows|cards|applied)"/.test(r.text);
