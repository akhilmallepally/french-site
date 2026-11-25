import "server-only";
// The real access check for gated lessons. Server-only: it reads the session cookie and asks the
// Supabase auth server who the user is with getUser(), which verifies the token. Never use
// getSession(), client auth state or proxy.ts as the check.
import { getCurrentUser } from "@/lib/current-user";
import { isFreeLevel, type LessonAccess, type LessonMeta } from "@/lib/lessons";
import { getActivePricing, hasActiveEntitlement } from "@/lib/purchases";
import { getPriceOffer, type PriceOffer } from "@/lib/pricing-offer";

export { getCurrentUser, type CurrentUser } from "@/lib/current-user";

export type LessonAccessResult =
  | { status: "granted"; access: LessonAccess }
  | { status: "signed-out"; offer: PriceOffer }
  | { status: "unpaid"; offer: PriceOffer };


/** Access to an A1 or A2 lesson. Reads no request data, so free lessons stay prerendered. */
export function grantFreeAccess(meta: LessonMeta): LessonAccess {
  if (!isFreeLevel(meta.level)) throw new Error(`${meta.id} is not in a free level`);
  return { grant: "lesson-access", lessonId: meta.id };
}

/**
 * Comprehensive access check for any lesson:
 * - Free levels (A1, A2) are always granted and read no request data.
 * - Gated levels check the user session:
 *   * If signed out -> status: "signed-out"
 *   * If signed in and entitled -> status: "granted" with LessonAccess proof
 *   * If signed in but unpaid -> status: "unpaid" with live pricing & founder spots
 */
export async function checkLessonAccess(meta: LessonMeta): Promise<LessonAccessResult> {
  if (isFreeLevel(meta.level)) {
    return { status: "granted", access: grantFreeAccess(meta) };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { status: "signed-out", offer: getPriceOffer(await getActivePricing("lessons")) };
  }

  const isEntitled = await hasActiveEntitlement(user.id, "lessons");
  if (isEntitled) {
    return { status: "granted", access: { grant: "lesson-access", lessonId: meta.id } };
  }

  return { status: "unpaid", offer: getPriceOffer(await getActivePricing("lessons")) };
}

/** Access helper returning LessonAccess if granted, or null if gated. Kept for backwards compatibility. */
export async function grantLessonAccess(meta: LessonMeta): Promise<LessonAccess | null> {
  const result = await checkLessonAccess(meta);
  return result.status === "granted" ? result.access : null;
}
