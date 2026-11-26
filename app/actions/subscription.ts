"use server";
// Manage subscription (docs/plans/subscription.md, section 5; Prompt 81): a Dodo customer-portal
// session for the signed-in learner, with no email sent and /progress as the way back. The action
// takes no input: the user comes from the session and the customer id from their own subscription
// row (RLS), never from the request. The logic and its limits are in lib/portal.ts.
import { getCurrentUser } from "@/lib/current-user";
import { getPaymentProvider } from "@/lib/payments/provider";
import { readOwnSubscriptions } from "@/lib/purchases";
import { PortalLimiter, runPortal, type PortalReply } from "@/lib/portal";

const limiter = new PortalLimiter();

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code ? code : error instanceof Error ? error.name : "unknown";
}

export async function openSubscriptionPortalAction(): Promise<PortalReply> {
  const user = await getCurrentUser();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const provider = getPaymentProvider();
  return runPortal({
    userId: user?.id ?? null,
    nowMs: Date.now(),
    limiter,
    readRows: () => readOwnSubscriptions("lessons"),
    createSession: async (customerId) => {
      if (!provider.createPortalSession) throw new Error("portal_not_supported");
      return provider.createPortalSession(customerId, `${siteUrl}/progress`);
    },
    // Error codes only: never the customer id, the link or the provider's message.
    onError: (where, error) => console.warn(`[subscription] portal ${where} failed, code:`, codeOf(error)),
  });
}
