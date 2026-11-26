// Capturing Dodo's webhook payloads in test mode, to confirm their exact shape before the
// subscription webhooks are written (docs/plans/subscription.md, decision 1, step 2).
// - Only when PAYMENTS_CAPTURE_PAYLOADS is exactly "on" AND the payments API key is a Dodo TEST key
//   (dodo_test_…). With a live key it never logs, whatever the flag says.
// - Only after the signature check has passed (the route calls it there), so nothing unsigned is logged.
// - It logs one line, "[payments:capture] <raw body>", trimmed to 20 KB. Test-mode payloads hold test
//   customers' details only; turn the flag off again when done.

const MAX_CAPTURE = 20_000;

export function captureEnabled(env: Record<string, string | undefined>, apiKey: string | undefined): boolean {
  return env.PAYMENTS_CAPTURE_PAYLOADS === "on" && typeof apiKey === "string" && apiKey.startsWith("dodo_test_");
}

export function capturePayload(rawBody: string, log: (line: string) => void = (l) => console.info(l)): void {
  const body = rawBody.length > MAX_CAPTURE ? `${rawBody.slice(0, MAX_CAPTURE)}…(trimmed, ${rawBody.length} chars)` : rawBody;
  log(`[payments:capture] ${body.replace(/\s*\n\s*/g, " ")}`);
}
