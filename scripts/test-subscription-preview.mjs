// npm run test:subscription-preview -- <phase>: the yearly subscription end to end in Dodo's TEST
// mode on the Vercel Preview (e2e/subscription-preview.spec.ts), one phase at a time:
//   subscribe, cancel, refund, past-due, on-hold (in that order; on-hold 7 days after past-due).
// It refuses to start unless the setup is safe:
//   - SUBSCRIPTION_PREVIEW_URL is an https *.vercel.app address (never the live site);
//   - SUBSCRIPTION_TEST_EMAIL / SUBSCRIPTION_TEST_PASSWORD are set, and aren't the first test account;
//   - for past-due, DODO_TEST_API_KEY starts with dodo_test_ (the only Dodo key it ever uses).
// The preview itself must say it's in the test switch (yearly only): checked over HTTP below.
import { spawnSync } from "node:child_process";

const PHASES = ["subscribe", "cancel", "refund", "past-due", "on-hold"];
const phase = process.argv[2];
const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exit(1);
};

if (!PHASES.includes(phase)) fail(`give a phase: ${PHASES.join(", ")} (for example: npm run test:subscription-preview -- subscribe)`);
for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUBSCRIPTION_PREVIEW_URL", "SUBSCRIPTION_TEST_EMAIL", "SUBSCRIPTION_TEST_PASSWORD"]) {
  if (!process.env[name]) fail(`${name} is not set (add it to .env.local).`);
}
let url;
try {
  url = new URL(process.env.SUBSCRIPTION_PREVIEW_URL);
} catch {
  fail("SUBSCRIPTION_PREVIEW_URL isn't a URL.");
}
// A branch URL looks like https://<project>-git-subscription-test-<team>.vercel.app: never the live domain.
if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app")) {
  fail("SUBSCRIPTION_PREVIEW_URL must be the preview's https://…vercel.app address, never the live site.");
}
if (process.env.PROGRESS_TEST_EMAIL && process.env.SUBSCRIPTION_TEST_EMAIL.toLowerCase() === process.env.PROGRESS_TEST_EMAIL.toLowerCase()) {
  fail("SUBSCRIPTION_TEST_EMAIL must be the second test account, not the lifetime one.");
}
if (phase === "past-due" && !(process.env.DODO_TEST_API_KEY ?? "").startsWith("dodo_test_")) fail("DODO_TEST_API_KEY must be set to a Dodo TEST key (dodo_test_…) for past-due.");

// The preview must be in the test switch: /api/founder-offer says the founding offer has ended there
// (PAYMENTS_TEST_SWITCH=after with a test key), so no founder spot can be taken.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const res = await fetch(new URL("/api/founder-offer", url), { headers: bypass ? { "x-vercel-protection-bypass": bypass } : {} }).catch((e) => fail(`couldn't reach the preview: ${e.message}`));
if (res.status === 401 || res.status === 403) fail(`the preview answered ${res.status}: set VERCEL_AUTOMATION_BYPASS_SECRET (Deployment Protection).`);
const offer = await res.json().catch(() => null);
if (offer?.state !== "ended") fail(`the preview still sells the founding offer (state: ${offer?.state ?? "unknown"}). Set PAYMENTS_TEST_SWITCH=after and a dodo_test_ key on the branch, and redeploy.`);

console.log(`Preview ${url.origin}: the founding offer is off there (test switch). Running phase "${phase}"…`);
const run = spawnSync("npx", ["playwright", "test", "--config", "playwright.preview.config.ts", "--grep", `@${phase}:`], {
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(run.status ?? 1);
