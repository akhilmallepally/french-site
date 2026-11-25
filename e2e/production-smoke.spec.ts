// Production smoke test of progress sync against the live site (npm run test:prod-smoke).
// Signs in as the TEST account (PROGRESS_TEST_EMAIL / PROGRESS_TEST_PASSWORD in .env.local) with
// the real @supabase/ssr cookies, since the site itself offers Google sign-in only. Reads and deletes
// only that account's own rows, through its own session and the RLS policies (never the service role).
// Changes no app code. On a failure it stops and prints what it saw, and the cleanup SQL.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

const LESSON = "/lessons/a1/alphabet-and-accents";
const LESSON_ID = "a1-alphabet-and-accents";
const LESSON_TITLE = /The alphabet and accents/;
const TABLES = ["exercise_results", "lesson_progress", "writing_task_progress"] as const;

type Problems = string[];

function watch(page: Page, label: string, problems: Problems) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`[${label}] console ${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => problems.push(`[${label}] page error: ${e.message.slice(0, 300)}`));
  page.on("requestfailed", (r) => problems.push(`[${label}] request failed: ${r.method()} ${r.url().slice(0, 160)} (${r.failure()?.errorText})`));
  page.on("response", async (r) => {
    const action = r.request().headers()["next-action"];
    if (action || r.status() >= 400) {
      let body = "";
      if (action) body = (await r.text().catch(() => "")).slice(-200).replace(/\s+/g, " ");
      problems.push(`[${label}] ${action ? "server action" : "response"} ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 100)}${body ? ` → ${body}` : ""}`);
    }
  });
}

async function signIn(context: BrowserContext, baseURL: string) {
  const jar = new Map<string, string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: process.env.PROGRESS_TEST_EMAIL!, password: process.env.PROGRESS_TEST_PASSWORD! });
  if (error || !data.user) throw new Error(`test account sign-in failed: ${error?.code ?? "no user"}`);
  await new Promise((r) => setTimeout(r, 200)); // the cookies are written on the SIGNED_IN event
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL, sameSite: "Lax" as const })));
  return { client, userId: data.user.id };
}

/** Answers the whole set: "x" in typed answers, the first choice, the words in the given order. Mostly wrong on purpose. */
async function doFullRun(page: Page) {
  for (let step = 0; step < 40; step++) {
    if (await page.getByText("Practice finished").count()) return;
    const input = page.locator('input[aria-label="Your answer"]');
    const adds = page.locator('button[aria-label^="Add "]');
    const options = page.locator('#practice form button[type="button"]:not([aria-label])');
    if (await input.count()) await input.first().fill("x");
    else if (await adds.count()) while (await adds.count()) await adds.first().click();
    else if (await options.count()) await options.first().click();
    const check = page.getByRole("button", { name: "Check", exact: true });
    if ((await check.count()) && (await check.isEnabled())) await check.click();
    await page.getByRole("button", { name: /^(Next|See results)$/ }).first().click();
  }
  throw new Error("the exercise set never finished");
}

const cleanupSql = (email: string) =>
  TABLES.map((t) => `delete from public.${t.padEnd(21)} where user_id = (select id from auth.users where email = '${email.replace(/'/g, "''")}');`).join("\n");

test("progress sync on the live site", async ({ browser, baseURL }) => {
  const problems: Problems = [];
  let failed = true;
  const base = baseURL!;
  const first = await browser.newContext();
  const page = await first.newPage();
  watch(page, "device 1", problems);
  const { client: db, userId } = await signIn(first, base);
  const rowsFor = async (table: (typeof TABLES)[number], lessonOnly = true) => {
    let q = db.from(table).select("*").eq("user_id", userId);
    if (lessonOnly && table !== "writing_task_progress") q = q.eq("lesson_id", LESSON_ID);
    const { data, error } = await q;
    if (error) throw new Error(`${table} read failed: ${error.code}`);
    return data ?? [];
  };

  try {
    // Start clean, so the server checks below prove this run's data (own rows only, via RLS).
    for (const t of TABLES) await db.from(t).delete().eq("user_id", userId);

    let best = "";
    await test.step("1. sign in, answer the set with a partial score", async () => {
      await page.goto(LESSON);
      await doFullRun(page);
      const line = page.locator("#practice p").first();
      await expect(line).toContainText(/Best score \d+ \/ \d+/);
      best = (await line.textContent())!.match(/Best score (\d+) \/ (\d+)/)![0];
      const [, score, total] = best.match(/(\d+) \/ (\d+)/)!.map(Number);
      expect(score * 5, `${best} should be a partial score, not a pass`).toBeLessThan(total * 4);
      console.log(`  step 1: ${best}`);
    });

    await test.step("2. refresh: the best score is still shown", async () => {
      await page.reload();
      await expect(page.locator("#practice p").first()).toContainText(best, { timeout: 15_000 });
    });

    await test.step("3. /progress: under Started, not finished; every level shows its unit names", async () => {
      await page.goto("/progress");
      const started = page.locator("section[aria-labelledby='started-heading']");
      await expect(started.getByRole("link", { name: LESSON_TITLE })).toBeVisible({ timeout: 15_000 });
      for (const d of await page.locator("details").all()) await d.locator("summary").click();
      const units = await page.$$eval("details", (ds) =>
        ds.map((d) => ({ level: d.querySelector("summary span")?.textContent?.trim().slice(0, 2) ?? "", names: [...d.querySelectorAll(":scope > ul > li > :first-child")].map((s) => s.textContent ?? "") })),
      );
      expect(units.map((u) => u.level)).toEqual(["A1", "A2", "B1", "B2", "C1", "C2"]);
      for (const u of units) {
        expect(u.names.length, `${u.level} has units`).toBeGreaterThan(0);
        for (const n of u.names) expect(n.trim(), `a unit name in ${u.level}`).not.toBe("");
      }
      console.log(`  step 3: units per level ${units.map((u) => `${u.level} ${u.names.length}`).join(", ")}`);
    });

    await test.step("4. the server has the data (the account's own session, RLS)", async () => {
      await expect.poll(async () => (await rowsFor("exercise_results")).length, { timeout: 30_000 }).toBeGreaterThan(0);
      await expect.poll(async () => (await rowsFor("lesson_progress")).length, { timeout: 30_000 }).toBe(1);
      const lesson = (await rowsFor("lesson_progress"))[0] as { best_score: number; best_total: number };
      expect(`Best score ${lesson.best_score} / ${lesson.best_total}`).toBe(best);
      console.log(`  step 4: ${(await rowsFor("exercise_results")).length} exercise rows, lesson ${lesson.best_score}/${lesson.best_total}`);
    });

    await test.step("5. a second device sees the same lesson", async () => {
      const second = await browser.newContext();
      const page2 = await second.newPage();
      watch(page2, "device 2", problems);
      await signIn(second, base);
      await page2.goto("/progress");
      await expect(page2.getByRole("link", { name: LESSON_TITLE }).first()).toBeVisible({ timeout: 20_000 });
      await page2.goto(LESSON);
      await expect(page2.locator("#practice p").first()).toContainText(best, { timeout: 20_000 });
      await second.close();
    });

    await test.step("6. sign out on device 1: /progress no longer shows the account's progress", async () => {
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForTimeout(1500);
      await page.goto("/progress");
      await expect(page.getByText("Your progress is saved in this browser only.")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("link", { name: LESSON_TITLE })).toHaveCount(0);
    });

    await test.step("7. clean up the account's rows with its own session", async () => {
      for (const t of TABLES) {
        const { error } = await db.from(t).delete().eq("user_id", userId);
        if (error) throw new Error(`${t} delete failed: ${error.code}`);
      }
      for (const t of TABLES) expect(await rowsFor(t, false), `${t} rows left`).toHaveLength(0);
      console.log("  step 7: the test account's progress rows are deleted (own-row delete policy)");
    });
    failed = false;
  } finally {
    await first.close();
    const shown = failed ? problems : problems.filter((p) => !/response 404 .*_vercel|favicon/.test(p));
    if (shown.length) console.log(`\nConsole and network notes (${shown.length}):\n  ${shown.slice(0, 40).join("\n  ")}`);
    if (failed) console.log(`\nNot cleaned up. Run in the Supabase SQL editor:\n${cleanupSql(process.env.PROGRESS_TEST_EMAIL!)}`);
    await db.auth.signOut().catch(() => {});
  }
});
