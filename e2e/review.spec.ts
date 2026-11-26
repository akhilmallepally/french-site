// The daily review in a real browser, against the real Supabase project, as the TEST account
// (PROGRESS_TEST_EMAIL / PROGRESS_TEST_PASSWORD in .env.local), with NEXT_PUBLIC_PROGRESS_SYNC and
// NEXT_PUBLIC_REVIEW_SYNC on. Run: npm run test:progress-e2e
// It deletes the account's review cards and progress rows at the start and the end, with the
// account's own delete policies.
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { doFullRun, signIn, type testClient } from "./helpers.ts";

const LESSON = "/lessons/a1/alphabet-and-accents";
const TABLES = ["review_cards", "exercise_results", "lesson_progress", "writing_task_progress"];

type Card = { id: string; lessonId: string; fr: string; en: string };
const cards = (f: string): Card[] => JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", f), "utf8")).cards;
const PAID = cards("review-cards-paid.json").find((c) => c.fr.length > 12 && c.en.length > 12)!;
const FREE = cards("review-cards-free.json")[0];

const fr = (page: Page) => page.getByTestId("review-fr");
const progress = (page: Page) => page.getByTestId("review-progress");

/** Space shows the answer, then 2 (I knew it) or 1 (Not yet). Returns the card's French. */
async function answer(page: Page, key: "1" | "2"): Promise<string> {
  await expect(fr(page)).toBeVisible();
  const text = (await fr(page).textContent())!;
  await page.keyboard.press("Space");
  await expect(page.getByTestId("review-en")).toBeVisible();
  await page.keyboard.press(key);
  return text;
}

async function cleanUp(db: ReturnType<typeof testClient>["client"], userId: string) {
  for (const t of TABLES) await db.from(t).delete().eq("user_id", userId);
}

test.describe.serial("daily review", () => {
  test("practise, review, refresh to resume, finish, rows in Supabase, sign out hides the cards", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const { client: db, userId } = await signIn(context);
    await cleanUp(db, userId);
    try {
      // Home links to /review.
      await page.goto("/");
      await expect(page.getByRole("link", { name: /Daily review/ })).toHaveAttribute("href", "/review");

      // Practise a free lesson, then open /review: 10 new cards (the daily limit).
      await page.goto(LESSON);
      await doFullRun(page);
      await page.goto("/review");
      await expect(page.getByRole("heading", { level: 1, name: "Daily review" })).toBeVisible();
      await expect(progress(page)).toHaveText("1 / 10", { timeout: 15_000 });
      await expect(page.getByTestId("review-counts")).toHaveText("0 due today · 10 new cards left today");

      // Answer four (one "Not yet"), then refresh: the six unanswered come back, counts right.
      const answered = [await answer(page, "2"), await answer(page, "2"), await answer(page, "2"), await answer(page, "1")];
      await expect(progress(page)).toHaveText("5 / 11", { timeout: 5000 }); // the Not yet card repeats at the end
      await page.reload();
      await expect(progress(page)).toHaveText("1 / 6", { timeout: 15_000 });
      await expect(page.getByTestId("review-counts")).toHaveText("0 due today · 6 new cards left today");
      expect(answered).not.toContain(await fr(page).textContent());

      // Finish: the summary, and nothing more today.
      for (let i = 0; i < 6; i++) await answer(page, "2");
      await expect(page.getByTestId("review-summary")).toHaveText("6 cards reviewed, 6 known.");
      await expect(page.getByText("All done for today")).toBeVisible();
      await expect(page.getByText("Next cards due tomorrow.")).toBeVisible();

      // The rows are in Supabase: ten answered (box 1 or more), the rest of the lesson's cards new.
      await expect
        .poll(async () => (await db.from("review_cards").select("card_id", { count: "exact", head: true }).eq("user_id", userId).gte("box", 1)).count ?? 0, { timeout: 20_000 })
        .toBe(10);

      // /progress has the Daily review line.
      await page.goto("/progress");
      await expect(page.getByTestId("review-due-line")).toContainText("No cards due today");

      // Sign out from the header: the account's cards are hidden.
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForTimeout(1000);
      await page.goto("/review");
      await expect(page.getByText("Practise a lesson to add its words to your review.")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Sign in to keep your review across devices.")).toBeVisible();
    } finally {
      await cleanUp(db, userId);
      const { count } = await db.from("review_cards").select("card_id", { count: "exact", head: true }).eq("user_id", userId);
      expect(count, "cleanup").toBe(0);
      await context.close();
    }
  });

  test("a learner without access: a paid card never appears and its text is never returned", async ({ browser }) => {
    // Signed out has no access whatever the test account has, so this path is always a learner without access.
    const context = await browser.newContext();
    const page = await context.newPage();
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (r.request().method() === "POST") bodies.push(await r.text().catch(() => ""));
    });
    await page.goto("/review");
    const past = Date.now() - 2 * 86400_000;
    const [paidSuffix, freeSuffix] = [PAID.id.slice(PAID.lessonId.length + 1), FREE.id.slice(FREE.lessonId.length + 1)];
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      {
        key: "parlons-review-v1",
        value: JSON.stringify({ v: 1, lessons: { [PAID.lessonId]: { [paidSuffix]: [2, past, past - 3 * 86400_000, 2, 0] }, [FREE.lessonId]: { [freeSuffix]: [2, past, past - 3 * 86400_000, 2, 0] } } }),
      },
    );
    await page.reload();
    await expect(progress(page)).toHaveText("1 / 1", { timeout: 15_000 });
    await expect(fr(page)).toHaveText(FREE.fr);
    await expect(page.getByTestId("review-counts")).toHaveText("1 due today · 0 new cards left today");
    // At 375 px: no sideways scroll, and the card keeps its size when the answer is shown.
    await page.setViewportSize({ width: 375, height: 740 });
    const card = page.getByRole("region", { name: "Review card" });
    const front = (await card.boundingBox())!;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.keyboard.press("Space");
    await expect(page.getByTestId("review-en")).toBeVisible();
    const back = (await card.boundingBox())!;
    expect([back.y, back.height]).toEqual([front.y, front.height]);
    await page.keyboard.press("2");
    await expect(page.getByTestId("review-summary")).toHaveText("1 card reviewed, 1 known.");
    const html = await page.content();
    expect(html).not.toContain(PAID.fr);
    expect(html).not.toContain(PAID.en);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b).not.toContain(PAID.fr);
      expect(b).not.toContain(PAID.en);
    }
    await context.close();
  });

  test("offline: a calm message and Retry; answers given before are kept", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/review");
    const past = Date.now() - 2 * 86400_000;
    const free = cards("review-cards-free.json").slice(0, 2);
    const lessons: Record<string, Record<string, number[]>> = {};
    for (const c of free) (lessons[c.lessonId] ??= {})[c.id.slice(c.lessonId.length + 1)] = [2, past, past - 3 * 86400_000, 2, 0];
    await page.evaluate((value) => localStorage.setItem("parlons-review-v1", value), JSON.stringify({ v: 1, lessons }));
    await page.reload();
    await expect(progress(page)).toHaveText("1 / 2", { timeout: 15_000 });
    const first = await answer(page, "2");

    // The connection drops (server action calls fail); a reload can't fetch the card text.
    await page.route("**/*", (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue()));
    await page.reload();
    await expect(page.getByText("Couldn't load your cards. Check your connection and try again.")).toBeVisible({ timeout: 15_000 });
    const saved = await page.evaluate(() => localStorage.getItem("parlons-review-v1"));
    expect(JSON.parse(saved!).today.reviewIds.length, "the answer before going offline is kept").toBe(1);

    // Back online: Retry shows the card not yet answered.
    await page.unroute("**/*");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(progress(page)).toHaveText("1 / 1", { timeout: 15_000 });
    expect(await fr(page).textContent()).not.toBe(first);
    await context.close();
  });
});
