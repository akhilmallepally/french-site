// Production smoke test of progress sync, then the daily review, against the live site
// (npm run test:prod-smoke). The review part runs after the progress part (serial) and needs
// NEXT_PUBLIC_REVIEW_SYNC=on in the live build, and (Prompt 76) the test account needs lifetime access:
// grant it with the SQL in docs/db-setup.md ("Test accounts"), which never uses a founder spot.
// Signs in as the TEST account (PROGRESS_TEST_EMAIL / PROGRESS_TEST_PASSWORD in .env.local) with
// the real @supabase/ssr cookies, since the site itself offers Google sign-in only. Reads and deletes
// only that account's own rows, through its own session and the RLS policies (never the service role).
// Changes no app code. On a failure it stops and prints what it saw, and the cleanup SQL.
import { expect, test, type BrowserContext, type Page, type Response } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

const LESSON = "/lessons/a1/alphabet-and-accents";
const LESSON_ID = "a1-alphabet-and-accents";
const LESSON_TITLE = /The alphabet and accents/;
const TABLES = ["exercise_results", "lesson_progress", "writing_task_progress"] as const;

type Problems = string[];

// The two parts run in order; if progress fails, the review part doesn't run.
test.describe.configure({ mode: "serial" });

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
  // Clicks before hydration are lost: wait until React has hydrated the practice section.
  await page.waitForFunction(() => {
    const el = document.querySelector("#practice form button, #practice form input");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
  }, undefined, { timeout: 20_000 });
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

const cleanupSql = (email: string, tables: readonly string[] = TABLES) =>
  tables.map((t) => `delete from public.${t.padEnd(21)} where user_id = (select id from auth.users where email = '${email.replace(/'/g, "''")}');`).join("\n");

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

// ---------- Daily review (docs/plans/review.md, rollout step 6) ----------

// A free lesson with 8 cards and no cards shared with other lessons: one session covers it all.
const REVIEW_LESSON = "/lessons/a1/greetings";
const REVIEW_CARDS = 8;
const REVIEW_TABLES = ["review_cards", ...TABLES] as const;
const REVIEW_LOCKED = "Daily review is part of lifetime access: a few minutes a day to keep the words you've learned.";
const REVIEW_FLAG_OFF = "Review sync is not on in production; set it to exactly on and redeploy without the build cache.";

/** test.step, printing one line per step: PASS or FAIL. */
async function step(name: string, body: () => Promise<void>) {
  try {
    await test.step(name, body);
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.log(`FAIL: ${name}`);
    throw error;
  }
}

/**
 * True for a review server action's "ok" reply carrying cards (getReviewAction). With the flag off
 * the review store makes no network calls at all, so such a reply proves review sync is on in the
 * live build, whatever the minifier did to the inlined flag.
 */
async function isReviewGetOk(r: Response): Promise<boolean> {
  if (!r.request().headers()["next-action"] || r.request().method() !== "POST") return false;
  const body = await r.text().catch(() => "");
  return /"status":"ok","cards":\{/.test(body);
}

test("daily review on the live site", async ({ browser, baseURL }) => {
  const problems: Problems = [];
  let failed = true;
  const base = baseURL!;

  const first = await browser.newContext();
  const page = await first.newPage();
  watch(page, "review device 1", problems);
  const { client: db, userId } = await signIn(first, base);
  const reviewed = async () => {
    const { count, error } = await db.from("review_cards").select("card_id", { count: "exact", head: true }).eq("user_id", userId).gte("box", 1);
    if (error) throw new Error(`review_cards read failed: ${error.code}`);
    return count ?? 0;
  };
  const answerKnew = async (p: Page) => {
    await expect(p.getByTestId("review-fr")).toBeVisible();
    await p.keyboard.press("Space");
    await expect(p.getByTestId("review-en")).toBeVisible();
    await p.keyboard.press("2");
  };

  try {
    await step("R0. review sync is on in the live build: signed in, /review gets an \"ok\" reply from the review get action", async () => {
      // The daily review is for learners with access (Prompt 76): without it /review never loads the store.
      const { data: active } = await db.from("purchases").select("status").eq("user_id", userId).eq("status", "active");
      if (!active?.length) throw new Error("The test account has no lifetime access in production: run the \"Test accounts\" SQL in docs/db-setup.md first.");
      const reply = page.waitForResponse(isReviewGetOk, { timeout: 10_000 }).catch(() => null);
      await page.goto("/review");
      const got = await reply;
      if (!got) throw new Error(REVIEW_FLAG_OFF);
      console.log(`  R0: getReviewAction answered "ok" (${got.request().url().replace(/^https?:\/\/[^/]+/, "")})`);
    });

    for (const t of REVIEW_TABLES) await db.from(t).delete().eq("user_id", userId);

    await step("R1. practise a free lesson, open /review, answer 3 cards, refresh: the session resumes", async () => {
      await page.goto(REVIEW_LESSON);
      await doFullRun(page);
      await page.goto("/review");
      await expect(page.getByTestId("review-progress")).toHaveText(`1 / ${REVIEW_CARDS}`, { timeout: 20_000 });
      const seen: string[] = [];
      for (let i = 0; i < 3; i++) {
        seen.push((await page.getByTestId("review-fr").textContent())!);
        await answerKnew(page);
      }
      await page.reload();
      await expect(page.getByTestId("review-progress")).toHaveText(`1 / ${REVIEW_CARDS - 3}`, { timeout: 20_000 });
      await expect(page.getByTestId("review-counts")).toHaveText(`0 due today · ${REVIEW_CARDS - 3} new cards left today`);
      expect(seen).not.toContain(await page.getByTestId("review-fr").textContent());
    });

    await step("R2. finish the session: the summary, and the rows exist (the account's own session, RLS)", async () => {
      for (let i = 0; i < REVIEW_CARDS - 3; i++) await answerKnew(page);
      await expect(page.getByTestId("review-summary")).toHaveText(`${REVIEW_CARDS - 3} cards reviewed, ${REVIEW_CARDS - 3} known.`);
      await expect.poll(reviewed, { timeout: 30_000 }).toBe(REVIEW_CARDS);
      console.log(`  R2: ${await reviewed()} answered cards on the server`);
    });

    await step("R3. a second device shows the same due count on /progress", async () => {
      await page.goto("/progress");
      const line = (await page.getByTestId("review-due-line").textContent({ timeout: 20_000 }))!.trim();
      const second = await browser.newContext();
      const page2 = await second.newPage();
      watch(page2, "review device 2", problems);
      await signIn(second, base);
      await page2.goto("/progress");
      // Without the synced cards, device 2 would offer the lesson's cards as new ("8 cards due today").
      await expect(page2.getByTestId("review-due-line")).toHaveText(line, { timeout: 20_000 });
      await page2.goto("/review");
      await expect(page2.getByText("All done for today")).toBeVisible({ timeout: 20_000 });
      console.log(`  R3: both devices: "${line}"`);
      await second.close();
    });

    await step("R4. sign out on device 1: /review no longer shows the account's cards, and explains it's part of lifetime access", async () => {
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForTimeout(1500);
      await page.goto("/review");
      await expect(page.getByText(REVIEW_LOCKED)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("review-fr")).toHaveCount(0);
    });

    await step("R4b. a free learner (a fresh browser, signed out): the explanation, and no card text in any reply", async () => {
      const free = await browser.newContext();
      const p = await free.newPage();
      const bodies: string[] = [];
      p.on("response", async (r) => {
        if (r.request().method() === "POST") bodies.push(await r.text().catch(() => ""));
      });
      await p.goto(REVIEW_LESSON);
      await doFullRun(p);
      await p.goto("/review");
      await expect(p.getByText(REVIEW_LOCKED)).toBeVisible({ timeout: 15_000 });
      await p.waitForTimeout(1500);
      expect(await p.getByTestId("review-fr").count()).toBe(0);
      expect(bodies.some((b) => /"cards":\{"/.test(b)), "no card text or card state came back").toBe(false);
      await free.close();
    });

    await step("R5. clean up the account's review and progress rows with its own session", async () => {
      for (const t of REVIEW_TABLES) {
        const { error } = await db.from(t).delete().eq("user_id", userId);
        if (error) throw new Error(`${t} delete failed: ${error.code}`);
      }
      for (const t of REVIEW_TABLES) {
        const { count } = await db.from(t).select("user_id", { count: "exact", head: true }).eq("user_id", userId);
        expect(count, `${t} rows left`).toBe(0);
      }
    });
    failed = false;
  } finally {
    await first.close();
    const shown = failed ? problems : problems.filter((p) => !/response 404 .*_vercel|favicon/.test(p));
    if (shown.length) console.log(`\nConsole and network notes (${shown.length}):\n  ${shown.slice(0, 40).join("\n  ")}`);
    if (failed) console.log(`\nNot cleaned up. Run in the Supabase SQL editor:\n${cleanupSql(process.env.PROGRESS_TEST_EMAIL!, REVIEW_TABLES)}`);
    await db.auth.signOut().catch(() => {});
  }
});
