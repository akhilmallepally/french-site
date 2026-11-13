// Proves the site fails safe when Supabase isn't configured: it builds and starts the app with
// NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY set to empty strings (an empty
// process variable stops Next.js from filling it from .env.local, which is left untouched), then
// checks that / and an A1 lesson return 200, that a B1 lesson returns the sign-in panel and none of
// its content (HTML and RSC), that the callback falls back to the sign-in error page, and that the
// server logs the missing-config warning and no errors.
//
// Run: npm run test:no-supabase-env   (PowerShell is fine; the script sets the variables itself)
// It overwrites .next with a no-config build. Run `npm run build` afterwards before npm start or
// test:gating.
import { spawn, spawnSync } from "node:child_process";

const PORT = process.env.PORT || "3100";
const BASE = `http://localhost:${PORT}`;
const PANEL = "Sign in with Google to read this lesson";
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" };
const isWin = process.platform === "win32";

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${msg}`);
  if (!cond) failed++;
};

console.log("Building with the Supabase variables empty…");
const build = spawnSync("npm", ["run", "build"], { env, stdio: "inherit", shell: isWin });
if (build.status !== 0) {
  console.error("FAIL: build failed with the Supabase variables empty");
  process.exit(1);
}

let log = "";
const server = spawn("npx", ["next", "start", "-p", PORT], { env, shell: isWin });
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

function stop() {
  if (isWin) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
}

async function get(path, headers = {}) {
  let res = await fetch(BASE + path, { headers, redirect: "manual" });
  // RSC requests get a 307 to the same path with an _rsc cache-busting query.
  const loc = res.headers.get("location");
  if (headers.RSC && res.status === 307 && loc?.includes("_rsc")) res = await fetch(new URL(loc, BASE), { headers, redirect: "manual" });
  return { status: res.status, text: await res.text(), location: res.headers.get("location") };
}

try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try {
      await fetch(BASE + "/", { redirect: "manual" });
      ready = true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!ready) throw new Error("server did not start");

  const home = await get("/");
  ok(home.status === 200, `/ -> ${home.status}`);
  ok(home.text.includes("Sign in"), "/ renders the signed-out Sign in button");

  const a1 = await get("/lessons/a1/adjective-agreement");
  ok(a1.status === 200, `A1 lesson -> ${a1.status}`);
  ok(!a1.text.includes(PANEL) && a1.text.includes("By the end of this lesson"), "A1 lesson shows its body, no panel");

  // Markers from content/lessons/b1/agreeing-disagreeing.mdx that are not in its public title or description.
  const markers = ["be able to agree, disagree", "Moi non plus", "Au contraire", "du tout"];
  const b1 = await get("/lessons/b1/agreeing-disagreeing");
  ok(b1.status === 200, `B1 lesson -> ${b1.status}`);
  ok(b1.text.includes(PANEL), "B1 lesson shows the sign-in panel");
  ok(markers.every((m) => !b1.text.includes(m)), "B1 HTML has none of the lesson content");
  const rsc = await get("/lessons/b1/agreeing-disagreeing", { RSC: "1" });
  ok(rsc.status === 200 && rsc.text.includes(PANEL), "B1 RSC payload has the panel");
  ok(markers.every((m) => !rsc.text.includes(m)), "B1 RSC payload has none of the lesson content");

  const signIn = await get("/sign-in?next=/lessons/b1/agreeing-disagreeing");
  ok(signIn.status === 200 && signIn.text.includes("Continue with Google"), `/sign-in -> ${signIn.status} with the Google button`);

  const cb = await get("/auth/callback?code=bad&next=//evil.example");
  ok(cb.status === 307 && cb.location?.startsWith(`${BASE}/sign-in?error=auth`), `callback -> ${cb.status} ${cb.location}`);

  await new Promise((r) => setTimeout(r, 500));
  ok(log.includes("[supabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing"), "server logged the missing-config warning");
  ok(!/⨯|Error:|unhandledRejection/.test(log), "server logged no errors");
} catch (error) {
  ok(false, String(error));
} finally {
  stop();
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll no-config checks passed.");
console.log("Note: .next now holds a no-config build. Run `npm run build` before npm start or test:gating.");
process.exit(failed ? 1 : 0);
