// npm run test:progress-e2e: builds the app with NEXT_PUBLIC_PROGRESS_SYNC=on, then runs the
// Playwright test in e2e/ (Chromium) against `next start`, signed in as the TEST account from
// .env.local (PROGRESS_TEST_EMAIL, PROGRESS_TEST_PASSWORD). It writes that account's rows in the
// real Supabase project; delete them with the SQL in docs/progress-log.md (Prompt 64).
//
// It leaves a flag-on build in .next: run `npm run build` afterwards before deploying or testing
// anything else.
import { spawnSync } from "node:child_process";

const isWin = process.platform === "win32";
for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "PROGRESS_TEST_EMAIL", "PROGRESS_TEST_PASSWORD"]) {
  if (!process.env[name]) {
    console.error(`FAIL: ${name} is not set (add it to .env.local).`);
    process.exit(1);
  }
}

const env = { ...process.env, NEXT_PUBLIC_PROGRESS_SYNC: "on" };
console.log("Building with NEXT_PUBLIC_PROGRESS_SYNC=on…");
const build = spawnSync("npm", ["run", "build"], { env, stdio: "inherit", shell: isWin });
if (build.status !== 0) {
  console.error("FAIL: the flag-on build failed");
  process.exit(1);
}

const run = spawnSync("npx", ["playwright", "test"], { env, stdio: "inherit", shell: isWin });
console.log("\nNote: .next now holds a build with the sync flag on. Run `npm run build` before anything else.");
process.exit(run.status ?? 1);
