// "Manage subscription" (docs/plans/subscription.md, section 5; Prompt 81): a Dodo customer-portal
// session for the signed-in learner, then a redirect to its link. Pure apart from what's passed in,
// so lib/manage-subscription.test.ts tests it with fakes; app/actions/subscription.ts wires it.
//
// - The customer id comes only from the learner's own subscription rows (read with their session,
//   under RLS), never from the request: the action takes no input at all.
// - Rate-limited per learner, so the button can't be used to flood the provider.
// - Any failure gives one plain message; nothing about the error reaches the learner or the logs
//   beyond its code.
import { GRACE_MS } from "./access-wording.ts";

export const PORTAL_ERROR_MESSAGE = "Couldn't open subscription settings. Please try again.";
export const PORTAL_NONE_MESSAGE = "There's no subscription to manage on this account.";
export const PORTAL_RATE_LIMITED_MESSAGE = "Please wait a moment before trying again.";
export const PORTAL_SIGNED_OUT_MESSAGE = "Please sign in again to manage your subscription.";

/** A learner's own subscription row, as RLS lets them read it. */
export type PortalRow = { provider_customer_id: string | null; status: string; current_period_end: string; cancel_at_period_end: boolean };

export type PortalReply = { status: "ok"; url: string } | { status: "signed-out" | "none" | "rate-limited" | "error"; message: string };

/**
 * The customer to open the portal for: the one on the subscription that gives access now (as
 * describeAccess ranks them: renewing, ending, past due), else the latest one with a customer id
 * (an on-hold or expired subscription can still update its card or see its invoices).
 */
export function pickCustomerId(rows: PortalRow[], nowMs: number): string | null {
  const withId = rows.filter((r) => typeof r.provider_customer_id === "string" && r.provider_customer_id.trim() !== "");
  const rank = (r: PortalRow): number => {
    const end = Date.parse(r.current_period_end);
    if (!Number.isFinite(end)) return 9;
    if (r.status === "active" && nowMs < end + GRACE_MS) return r.cancel_at_period_end ? 1 : 0;
    if (r.status === "cancelled" && r.cancel_at_period_end && nowMs < end) return 1;
    if (r.status === "past_due" && nowMs < end + GRACE_MS) return 2;
    return 3;
  };
  const sorted = [...withId].sort((a, b) => rank(a) - rank(b) || Date.parse(b.current_period_end) - Date.parse(a.current_period_end));
  return sorted[0]?.provider_customer_id?.trim() ?? null;
}

/**
 * At most `max` sessions per learner in `windowMs`, and `gapMs` between two. Kept in the server's
 * memory, so on several server instances the limit is per instance: enough to stop a stuck or
 * hammered button, not a security boundary (the portal itself is the provider's).
 */
export class PortalLimiter {
  private hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly gapMs: number;
  private readonly maxUsers: number;
  constructor(max = 5, windowMs = 10 * 60_000, gapMs = 3_000, maxUsers = 10_000) {
    this.max = max;
    this.windowMs = windowMs;
    this.gapMs = gapMs;
    this.maxUsers = maxUsers;
  }

  allow(userId: string, nowMs: number): boolean {
    const recent = (this.hits.get(userId) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (recent.length >= this.max || (recent.length && nowMs - recent[recent.length - 1] < this.gapMs)) {
      this.hits.set(userId, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.delete(userId);
    this.hits.set(userId, recent);
    // Forget the oldest learners first, so the map never grows without bound.
    while (this.hits.size > this.maxUsers) this.hits.delete(this.hits.keys().next().value as string);
    return true;
  }
}

/** A link we're willing to send the learner to: an https URL. */
export function safePortalLink(link: unknown): string | null {
  if (typeof link !== "string") return null;
  try {
    const u = new URL(link);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function runPortal(deps: {
  /** The session's user id, or null when signed out. */
  userId: string | null;
  nowMs: number;
  limiter: PortalLimiter;
  /** The learner's own subscription rows (their session, RLS). */
  readRows: () => Promise<PortalRow[]>;
  /** Creates the portal session for that customer; resolves to its link. */
  createSession: (customerId: string) => Promise<unknown>;
  onError?: (where: "read" | "create" | "link", error?: unknown) => void;
}): Promise<PortalReply> {
  if (!deps.userId) return { status: "signed-out", message: PORTAL_SIGNED_OUT_MESSAGE };
  if (!deps.limiter.allow(deps.userId, deps.nowMs)) return { status: "rate-limited", message: PORTAL_RATE_LIMITED_MESSAGE };
  let rows: PortalRow[];
  try {
    rows = await deps.readRows();
  } catch (error) {
    deps.onError?.("read", error);
    return { status: "error", message: PORTAL_ERROR_MESSAGE };
  }
  const customerId = pickCustomerId(rows, deps.nowMs);
  if (!customerId) return { status: "none", message: PORTAL_NONE_MESSAGE };
  let link: unknown;
  try {
    link = await deps.createSession(customerId);
  } catch (error) {
    deps.onError?.("create", error);
    return { status: "error", message: PORTAL_ERROR_MESSAGE };
  }
  const url = safePortalLink(link);
  if (!url) {
    deps.onError?.("link");
    return { status: "error", message: PORTAL_ERROR_MESSAGE };
  }
  return { status: "ok", url };
}
