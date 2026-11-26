// Shared by the real-browser specs (npm run test:progress-e2e): the TEST account's sign-in and a full
// practice run. The site signs in with Google only, so the test signs in with the account's password
// through @supabase/ssr itself and gives the browser exactly the cookies the site would have.
import type { BrowserContext, Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

export function testClient() {
  const jar = new Map<string, string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  return { client, jar };
}

export async function signIn(context: BrowserContext) {
  const { client, jar } = testClient();
  const { data, error } = await client.auth.signInWithPassword({ email: process.env.PROGRESS_TEST_EMAIL!, password: process.env.PROGRESS_TEST_PASSWORD! });
  if (error || !data.user) throw new Error(`test account sign-in failed: ${error?.code ?? "no user"}`);
  await new Promise((r) => setTimeout(r, 200)); // the session cookies are written on the SIGNED_IN event
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" as const })));
  return { client, userId: data.user.id };
}

/** Answers every exercise of the run (whatever the answer) until "Practice finished". */
export async function doFullRun(page: Page) {
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
  throw new Error("the run never finished");
}

