// Logging the SHAPE of Dodo's webhook payloads in test mode, to confirm it while the subscription
// webhooks are built (docs/plans/subscription.md, decision 1). Temporary: it's removed once the
// payloads are confirmed (rollout step 3 at the latest).
// - Turned on by server configuration only: PAYMENTS_CAPTURE_PAYLOADS exactly "on" AND a Dodo TEST
//   API key (dodo_test_…). Nothing in a payload can turn it on, and with a live key it never logs.
// - The route calls it only after the signature check, so nothing unsigned is logged.
// - It logs the event type, the ids (fields named "id" or "…_id") with their values, the status-like
//   values (status, payload_type, charge_type, dispute_status, currency, intervals), and every other
//   field's name and type only. Values that could identify a person (emails, names, phone numbers,
//   addresses, card holder, tax ids, free text) are never logged: they appear as "[masked]".

export function captureEnabled(env: Record<string, string | undefined>, apiKey: string | undefined): boolean {
  return env.PAYMENTS_CAPTURE_PAYLOADS === "on" && typeof apiKey === "string" && apiKey.startsWith("dodo_test_");
}

/** Field names whose values may be logged as they are: short enums, not personal data. */
const ENUM_FIELDS = new Set(["type", "status", "payload_type", "charge_type", "dispute_status", "dispute_stage", "currency", "payment_frequency_interval", "subscription_period_interval", "refund_status", "card_network", "card_type", "payment_method"]);
/** Fields that are or may hold personal data: always masked, whatever their type. */
const PERSONAL = /(^|_)(email|name|phone|phone_number|street|city|state|zipcode|zip|address|country|card_holder_name|card_last_four|tax_id|customer_business_name|comment|remarks|reason|cancellation_comment|cancellation_feedback|metadata_signature)$/i;
const ID = /(^|_)id$/;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** One flat list of "path: type", "path = value" (ids and enums) or "path: [masked]" lines. */
export function describePayload(rawBody: string): string[] {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return ["(not JSON)"];
  }
  const out: string[] = [];
  const walk = (v: unknown, p: string, key: string) => {
    if (PERSONAL.test(key) && v !== null) {
      out.push(`${p}: [masked]`);
      return;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const entries = Object.entries(v as Record<string, unknown>);
      if (!entries.length && p) out.push(`${p}: {}`);
      for (const [k, x] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) walk(x, p ? `${p}.${k}` : k, k);
      return;
    }
    if (Array.isArray(v)) {
      out.push(`${p}: array(${v.length})`);
      if (v.length) walk(v[0], `${p}[0]`, key);
      return;
    }
    if ((ID.test(key) || ENUM_FIELDS.has(key)) && (typeof v === "string" || typeof v === "number") && !String(v).includes("@")) {
      out.push(`${p} = ${JSON.stringify(v)}`);
      return;
    }
    out.push(`${p}: ${typeOf(v)}`);
  };
  walk(body, "", "");
  return out;
}

export function capturePayload(rawBody: string, log: (line: string) => void = (l) => console.info(l)): void {
  const shape = describePayload(rawBody).join("; ");
  log(`[payments:capture] ${shape.length > 20_000 ? `${shape.slice(0, 20_000)}…(trimmed)` : shape}`);
}
