// What the site says to a learner who has access (Prompt 80, part D): lifetime holders keep the
// lifetime wording; a subscriber sees when their access renews or ends, or that a payment failed.
// Pure (no I/O; the time is passed in), so lib/access-wording.test.ts tests every status.
//
// Display only: whether the learner has access is always has_access()'s answer (lib/purchases.ts).
// describeAccess just picks which row to describe once access is known to be "yes".
import type { AccessState } from "./entitlement.ts";

/** A learner's own subscription row, as RLS lets them read it. */
export type SubscriptionRow = { status: string; current_period_end: string; cancel_at_period_end: boolean };

export type AccessDetails =
  | { state: "no" }
  | { state: "unknown" }
  | { state: "yes"; kind: "lifetime" }
  | { state: "yes"; kind: "subscription"; status: "renewing" | "ending" | "past_due"; periodEnd: string }
  /** Access is confirmed, but which kind couldn't be read: neutral wording. */
  | { state: "yes"; kind: "unknown" };

const GRACE_MS = 7 * 86_400_000; // the grace in has_access() (0010)

/**
 * The details to show. `lifetime` and `subs` are null when their read failed. A lifetime purchase
 * wins (it never ends). Otherwise the subscription row that gives access now: renewing first, then
 * ending (cancelled at the period end), then past due; the latest period end among equals.
 */
export function describeAccess(state: AccessState, lifetime: boolean | null, subs: SubscriptionRow[] | null, nowMs: number): AccessDetails {
  if (state !== "yes") return { state };
  if (lifetime === true) return { state: "yes", kind: "lifetime" };
  if (lifetime === null || subs === null) return { state: "yes", kind: "unknown" };
  const rank = { renewing: 0, ending: 1, past_due: 2 } as const;
  let best: { status: keyof typeof rank; periodEnd: string; endMs: number } | null = null;
  for (const s of subs) {
    const endMs = Date.parse(s.current_period_end);
    if (!Number.isFinite(endMs)) continue;
    let status: keyof typeof rank | null = null;
    if (s.status === "active" && nowMs < endMs + GRACE_MS) status = s.cancel_at_period_end ? "ending" : "renewing";
    else if (s.status === "past_due" && nowMs < endMs + GRACE_MS) status = "past_due";
    else if (s.status === "cancelled" && s.cancel_at_period_end && nowMs < endMs) status = "ending";
    if (!status) continue;
    if (!best || rank[status] < rank[best.status] || (rank[status] === rank[best.status] && endMs > best.endMs)) {
      best = { status, periodEnd: new Date(endMs).toISOString(), endMs };
    }
  }
  return best ? { state: "yes", kind: "subscription", status: best.status, periodEnd: best.periodEnd } : { state: "yes", kind: "unknown" };
}

/** "1 March 2028" (UTC, the billing date's own zone). */
export function accessDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

export type AccessLine = { text: string; href?: string; tone: "ok" | "warn" };

/** The line shown where the site used to say "You have lifetime access". */
export function accessLine(d: Extract<AccessDetails, { state: "yes" }>): AccessLine {
  if (d.kind === "lifetime") return { text: "You have lifetime access!", tone: "ok" };
  if (d.kind === "unknown") return { text: "You have full access.", tone: "ok" };
  if (d.status === "renewing") return { text: `Your access renews on ${accessDate(d.periodEnd)}`, tone: "ok" };
  if (d.status === "ending") return { text: `Your access ends on ${accessDate(d.periodEnd)}`, tone: "ok" };
  // The portal link comes in rollout step 5; /progress for now.
  return { text: "Payment problem: update your card", href: "/progress", tone: "warn" };
}

/** Checkout's refusal for a learner who already has access. */
export function alreadyHasAccessMessage(d: Extract<AccessDetails, { state: "yes" }>): string {
  if (d.kind === "lifetime") return "You already have lifetime access to these lessons.";
  const line = accessLine(d).text;
  return d.kind === "unknown" ? "You already have access to these lessons." : `You already have access to these lessons. ${line}.`;
}
