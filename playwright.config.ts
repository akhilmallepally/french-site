// Real-browser progress test (npm run test:progress-e2e), Chromium only. The script builds the app
// with NEXT_PUBLIC_PROGRESS_SYNC=on first; Playwright then starts `next start` on its own port.
import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  testDir: "e2e",
  // Live-site test: npm run test:prod-smoke (playwright.prod.config.ts). Preview subscription test:
  // npm run test:subscription-preview (playwright.preview.config.ts).
  testIgnore: ["production-smoke.spec.ts", "subscription-preview.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
