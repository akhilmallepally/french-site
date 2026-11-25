// Production smoke test of progress sync (npm run test:prod-smoke): Chromium against the live site,
// no local server. Uses the TEST account from .env.local and cleans up its rows at the end.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "production-smoke.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [["list"]],
  use: { baseURL: process.env.SMOKE_BASE_URL ?? "https://frenchproperly.com", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
