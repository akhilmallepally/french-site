// The subscription test on the Vercel Preview (npm run test:subscription-preview -- <phase>):
// Chromium, visible (Dodo's checkout, portal and dashboard steps need a person), no local server.
// scripts/test-subscription-preview.mjs checks the setup before it runs this.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "subscription-preview.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  reporter: [["list"]],
  use: { baseURL: process.env.SUBSCRIPTION_PREVIEW_URL, headless: false, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], headless: false } }],
});
