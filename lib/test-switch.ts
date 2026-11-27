// The test-mode switch override (Prompt 82): PAYMENTS_TEST_SWITCH=after forces the "after the
// switch" state (the yearly plan only; the founder offer is never offered or charged), so a Vercel
// Preview can sell test subscriptions without ever taking a founder spot. Previews share the
// production database, so this matters: a founder purchase there would be a real row.
//
// Honoured ONLY when all three hold:
//   - PAYMENTS_TEST_SWITCH is exactly "after";
//   - PAYMENTS_API_KEY starts with "dodo_test_" (Dodo's test mode: no real money can move);
//   - VERCEL_ENV isn't "production" (never on the live site, whatever else is set).
// Anything else (a live key, Production, another value, nothing set) ignores it. Pure: the
// environment is passed in, so lib/test-switch.test.ts proves each case.

export type SwitchEnv = Record<string, string | undefined>;

export function testSwitchAfter(env: SwitchEnv): boolean {
  return env.PAYMENTS_TEST_SWITCH === "after" && (env.PAYMENTS_API_KEY ?? "").startsWith("dodo_test_") && env.VERCEL_ENV !== "production";
}
