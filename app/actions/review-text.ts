"use server";
// The card text for /review (docs/plans/review.md, section 11): only the cards asked for, at most 40
// per call. Free cards (A1, A2) for anyone, also without Supabase config; paid cards only for a
// signed-in learner with access (an active purchase), checked once per call, otherwise left out.
// Its own module, so app/actions/review.ts stays free of card text. The only input is the list of
// ids: the user and the access check come from the session alone.
import { getCurrentUser } from "@/lib/current-user";
import { hasActivePurchase, type EntitlementClient } from "@/lib/entitlement";
import { getReviewCard } from "@/lib/review-cards-server";
import { createClient } from "@/lib/supabase/server";
import { runCardText, type CardTextReply } from "@/lib/review-text";

async function sessionHasAccess(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = await createClient();
  if (!supabase) return false;
  return hasActivePurchase(supabase as unknown as EntitlementClient, user.id, "lessons");
}

export async function getCardTextAction(cardIds: unknown): Promise<CardTextReply> {
  return runCardText(cardIds, { lookup: getReviewCard, hasAccess: sessionHasAccess });
}
