// Progress sync in a real browser, against the real Supabase project, as the TEST account
// (PROGRESS_TEST_EMAIL / PROGRESS_TEST_PASSWORD in .env.local). Run: npm run test:progress-e2e
//
// The site signs in with Google only, so the test signs in with the account's password through
// @supabase/ssr itself and gives the browser exactly the cookies the site would have.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

const LESSON = "/lessons/a1/alphabet-and-accents";
const LESSON_ID = "a1-alphabet-and-accents";

function testClient() {
  const jar = new Map<string, string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  return { client, jar };
}

async function signIn(context: BrowserContext) {
  const { client, jar } = testClient();
  const { data, error } = await client.auth.signInWithPassword({ email: process.env.PROGRESS_TEST_EMAIL!, password: process.env.PROGRESS_TEST_PASSWORD! });
  if (error || !data.user) throw new Error(`test account sign-in failed: ${error?.code ?? "no user"}`);
  await new Promise((r) => setTimeout(r, 200)); // the session cookies are written on the SIGNED_IN event
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" as const })));
  return { client, userId: data.user.id };
}

/** Answers every exercise of the run (whatever the answer) until "Practice finished". */
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
  throw new Error("the run never finished");
}

const bestLine = (page: Page) => page.locator("#practice p").first();

test.describe.serial("progress sync, signed in as the test account", () => {
  let userId = "";
  let db: ReturnType<typeof testClient>["client"];

  test.beforeAll(() => {
    if (!process.env.PROGRESS_TEST_EMAIL || !process.env.PROGRESS_TEST_PASSWORD) throw new Error("Set PROGRESS_TEST_EMAIL and PROGRESS_TEST_PASSWORD in .env.local");
  });

  test("practise, refresh, see it everywhere, sign out, sign back in", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    ({ client: db, userId } = await signIn(context));
    for (const table of ["exercise_results", "lesson_progress", "writing_task_progress"]) await db.from(table).delete().eq("user_id", userId);

    // Answer the whole set, then refresh: the best score is still there.
    await page.goto(LESSON);
    await doFullRun(page);
    await expect(bestLine(page)).toContainText(/Best score \d+ \/ \d+/);
    const best = (await bestLine(page).textContent())!.match(/Best score \d+ \/ \d+/)![0];
    await page.reload();
    await expect(bestLine(page)).toContainText(best);

    // /progress shows it, and every unit of every level has a name.
    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "Continue" })).toBeVisible();
    await expect(page.getByRole("link", { name: /The alphabet and accents/ }).first()).toBeVisible();
    for (const d of await page.locator("details").all()) await d.locator("summary").click();
    const units = await page.$$eval("details", (ds) =>
      ds.map((d) => ({ level: d.querySelector("summary span")?.textContent?.trim().slice(0, 2) ?? "", names: [...d.querySelectorAll(":scope > ul > li > :first-child")].map((s) => s.textContent ?? "") })),
    );
    expect(units.map((u) => u.level)).toEqual(["A1", "A2", "B1", "B2", "C1", "C2"]);
    for (const u of units) {
      expect(u.names.length, `${u.level} units`).toBeGreaterThan(0);
      for (const n of u.names) expect(n.trim(), `a unit name in ${u.level}`).not.toBe("");
    }

    // A unit name on /progress opens /practice at that unit (client-side navigation)...
    await page.getByRole("link", { name: "Getting started", exact: true }).click();
    await expect(page).toHaveURL(/\/practice#a1-getting-started$/);
    const unit = page.locator("#a1-getting-started");
    await expect(page.locator("#a1")).toHaveAttribute("open", "");
    await expect(unit.getByRole("link")).toBeVisible();
    await expect(unit).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("a1-getting-started-heading");
    // ...and its review lands on that lesson's exercises.
    await unit.getByRole("link").click();
    await expect(page).toHaveURL(/\/lessons\/a1\/review-getting-started#practice$/);
    await expect(page.locator("#practice")).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("practice-heading");

    // The row is in Supabase (sent within a few seconds of the last answer).
    await expect
      .poll(async () => (await db.from("lesson_progress").select("best_score, best_total").eq("user_id", userId).eq("lesson_id", LESSON_ID)).data?.length ?? 0, { timeout: 20_000 })
      .toBe(1);
    const { count } = await db.from("exercise_results").select("exercise_id", { count: "exact", head: true }).eq("user_id", userId);
    expect(count).toBeGreaterThan(0);

    // Sign out from the header: the account's progress is hidden.
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForTimeout(1000);
    await page.goto("/progress");
    await expect(page.getByText("Your progress is saved in this browser only.")).toBeVisible();
    await expect(page.getByRole("link", { name: /The alphabet and accents/ })).toHaveCount(0);
    await page.goto(LESSON);
    await expect(bestLine(page)).not.toContainText("Best score");

    // Sign back in: it's back (from the server: the synced copy was deleted at sign-out).
    await signIn(context);
    await page.goto(LESSON);
    await expect(bestLine(page)).toContainText(best, { timeout: 15_000 });
    await context.close();
  });
});
