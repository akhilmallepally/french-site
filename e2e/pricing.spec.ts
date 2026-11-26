// The founding offer in a real browser (Prompt 76), signed out, with Playwright's fake clock: the
// countdown, the switch to the ended state on an open page at the deadline, the reminder banner and
// its dismissal, and no hydration errors. Writes nothing to the database. Run: npm run test:progress-e2e
import { expect, test, type Page } from "@playwright/test";

const ENDS = Date.parse("2026-12-31T16:59:00Z");

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat|did not match|mismatch/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test.describe("founding offer", () => {
  test("an open /pricing page switches to the ended state at the deadline, without a reload", async ({ page }) => {
    const errors = watchErrors(page);
    await page.clock.install({ time: ENDS - 90_000 }); // 1.5 minutes before the deadline
    await page.goto("/pricing");
    await expect(page.getByTestId("founder-time-left").first()).toHaveText("1 minute");
    await expect(page.getByRole("link", { name: "Sign in with Google to unlock" })).toBeVisible();
    await page.clock.fastForward(120_000); // past the deadline
    await expect(page.getByTestId("founder-ended").first()).toContainText("The founding offer has ended.");
    await expect(page.getByText("New plan coming soon").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "New plan coming soon" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Sign in with Google to unlock" })).toHaveCount(0);
    expect(await page.locator("main").innerText(), "the page no longer offers $8").not.toMatch(/\$8\b/);
    expect(errors, "no hydration errors").toEqual([]);
  });

  test("the countdown uses the visitor's time zone; screen readers get one static sentence", async ({ browser }) => {
    const context = await browser.newContext({ timezoneId: "Europe/Paris" });
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.clock.install({ time: ENDS - (12 * 24 + 4) * 3_600_000 - 30_000 });
    await page.goto("/pricing");
    await expect(page.getByTestId("founder-time-left").first()).toHaveText("12 days 4 hours");
    await expect(page.getByText("Ends 31 Dec, 17:59 Paris time").first()).toBeVisible();
    await expect(page.locator("p.sr-only", { hasText: "The founding offer ends on 31 December 2026 at 23:59 Bangkok time." }).first()).toHaveCount(1);
    await expect(page.locator("[aria-live]").filter({ hasText: /ends in/ })).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("the banner: on other pages, not on /pricing; Dismiss hides it for 3 days, and it's back in the last 48 hours", async ({ page }) => {
    const errors = watchErrors(page);
    const start = ENDS - 10 * 86_400_000 - 3_600_000; // 10 days and an hour before
    await page.clock.install({ time: start });
    await page.goto("/");
    const banner = page.getByRole("region", { name: "Founding offer" });
    await expect(banner).toContainText("Founding offer: $8 for lifetime access, ends in 10 days.");
    await expect(banner.getByRole("link", { name: "See pricing →" })).toHaveAttribute("href", "/pricing");
    await page.goto("/pricing");
    await expect(page.getByRole("region", { name: "Founding offer" })).toHaveCount(0);

    await page.goto("/lessons/a1");
    await page.getByRole("region", { name: "Founding offer" }).getByRole("button", { name: "Dismiss" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Founding offer" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: "Founding offer" })).toBeHidden(); // hidden before paint, then removed

    // 3 days later it's back.
    await page.clock.setFixedTime(start + 3 * 86_400_000 + 60_000);
    await page.reload();
    await expect(page.getByRole("region", { name: "Founding offer" })).toBeVisible();

    // Dismissed again, but in the last 48 hours it shows anyway.
    await page.getByRole("region", { name: "Founding offer" }).getByRole("button", { name: "Dismiss" }).click();
    await page.clock.setFixedTime(ENDS - 47 * 3_600_000);
    await page.reload();
    await expect(page.getByRole("region", { name: "Founding offer" })).toContainText("ends in 47 hours.");
    expect(errors).toEqual([]);
  });
});
