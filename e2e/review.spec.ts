// The daily review in a real browser, against the real Supabase project, as the TEST account
// (PROGRESS_TEST_EMAIL / PROGRESS_TEST_PASSWORD in .env.local), with NEXT_PUBLIC_PROGRESS_SYNC and
// NEXT_PUBLIC_REVIEW_SYNC on. Run: npm run test:progress-e2e
// The daily review is part of lifetime access (Prompt 76): the test account needs access, granted
// with the SQL in docs/db-setup.md ("Test accounts"), which never uses a founder spot.
// It deletes the account's review cards and progress rows at the start and the end, with the
// account's own delete policies (never its purchase).
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { doFullRun, signIn, type testClient } from "./helpers.ts";

const LESSON = "/lessons/a1/alphabet-and-accents";
const TABLES = ["review_cards", "exercise_results", "lesson_progress", "writing_task_progress"];
const LOCKED = "Daily review is part of lifetime access: a few minutes a day to keep the words you've learned.";

type Card = { id: string; lessonId: string; fr: string; en: string };
const cards = (f: string): Card[] => JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", f), "utf8")).cards;
const PAID = cards("review-cards-paid.json").find((c) => c.fr.length > 12 && c.en.length > 12)!;
const FREE = cards("review-cards-free.json").find((c) => c.fr.length > 6 && c.en.length > 6)!;

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
  test("a paid learner: practise, review, refresh to resume, offline and Retry, finish, rows in Supabase, sign out", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const { client: db, userId } = await signIn(context);
    const { data: purchases } = await db.from("purchases").select("status").eq("user_id", userId).eq("status", "active");
    expect(purchases?.length ?? 0, "the test account needs access: run the SQL in docs/db-setup.md (Test accounts)").toBeGreaterThan(0);
    await cleanUp(db, userId);
    try {
      // Home links to /review, labelled as part of lifetime access.
      await page.goto("/");
      const card = page.getByRole("link", { name: /Daily review/ });
      await expect(card).toHaveAttribute("href", "/review");
      await expect(card).toContainText("Included with paid access");

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

      // Offline: the server actions fail; a calm message and Retry; the four answers are kept.
      await page.route("**/*", (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue()));
      await page.reload();
      await expect(page.getByText("Couldn't load your cards. Check your connection and try again.")).toBeVisible({ timeout: 15_000 });
      await page.unroute("**/*");
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(progress(page)).toHaveText("1 / 6", { timeout: 15_000 });
      await expect(page.getByTestId("review-counts")).toHaveText("0 due today · 6 new cards left today");

      // Finish: the summary, and nothing more today.
      for (let i = 0; i < 6; i++) await answer(page, "2");
      await expect(page.getByTestId("review-summary")).toHaveText("6 cards reviewed, 6 known.");
      await expect(page.getByText("All done for today")).toBeVisible();
      await expect(page.getByText("Next cards due tomorrow.")).toBeVisible();

      // The rows are in Supabase: ten answered (box 1 or more), the rest of the lesson's cards new.
      await expect
        .poll(async () => (await db.from("review_cards").select("card_id", { count: "exact", head: true }).eq("user_id", userId).gte("box", 1)).count ?? 0, { timeout: 20_000 })
        .toBe(10);

      // /progress has the Daily review line (paid learners only).
      await page.goto("/progress");
      await expect(page.getByTestId("review-due-line")).toContainText("No cards due today", { timeout: 15_000 });

      // Sign out from the header: the account's cards are hidden, and /review explains it's part of lifetime access.
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForTimeout(1000);
      await page.goto("/review");
      await expect(page.getByText(LOCKED)).toBeVisible({ timeout: 15_000 });
      await expect(fr(page)).toHaveCount(0);
      await page.goto("/progress");
      await expect(page.getByTestId("review-due-line")).toHaveCount(0);
    } finally {
      await cleanUp(db, userId);
      const { count } = await db.from("review_cards").select("card_id", { count: "exact", head: true }).eq("user_id", userId);
      expect(count, "cleanup").toBe(0);
      await context.close();
    }
  });

  test("a free learner: the explanation, no deck, and no card text (cards in the browser stay hidden)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const bodies: string[] = [];
    page.on("response", async (r) => {
      if (r.request().method() === "POST") bodies.push(await r.text().catch(() => ""));
    });
    // Cards already in this browser (from before Prompt 76, say): they stay, but never show.
    await page.goto("/");
    const past = Date.now() - 2 * 86400_000;
    const lessons: Record<string, Record<string, number[]>> = {};
    for (const c of [FREE, PAID]) (lessons[c.lessonId] ??= {})[c.id.slice(c.lessonId.length + 1)] = [2, past, past - 3 * 86400_000, 2, 0];
    const saved = JSON.stringify({ v: 1, lessons });
    await page.evaluate((value) => localStorage.setItem("parlons-review-v1", value), saved);
    await page.goto(LESSON);
    await doFullRun(page); // practised: a deck would be built for a learner with access

    await page.goto("/review");
    await expect(page.getByText(LOCKED)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "See pricing", exact: true })).toHaveAttribute("href", "/pricing");
    await expect(fr(page)).toHaveCount(0);
    await page.waitForTimeout(1500);
    const html = await page.content();
    for (const t of [FREE.fr, FREE.en, PAID.fr, PAID.en]) {
      expect(html).not.toContain(t);
      for (const b of bodies) expect(b).not.toContain(t);
    }
    expect(await page.evaluate(() => localStorage.getItem("parlons-review-v1")), "no deck built; the cards in the browser are untouched").toBe(saved);
    await context.close();
  });
});
