"use server";
// The card text for /review (docs/plans/review.md, section 11): only the cards asked for, at most 40
// per call, and only for a signed-in learner with access (hasActiveEntitlement: a lifetime purchase
// or a subscription in its paid period), checked once per call. Without access (or without Supabase config)
// nothing comes back, free-level cards included.
// Its own module, so app/actions/review.ts stays free of card text. The only input is the list of
// ids: the user and the access check come from the session alone.
import { getCurrentUser } from "@/lib/current-user";
import { hasActiveEntitlement } from "@/lib/purchases";
import { getReviewCard } from "@/lib/review-cards-server";
import { runCardText, type CardTextReply } from "@/lib/review-text";

async function sessionHasAccess(): Promise<boolean> {
  const user = await getCurrentUser();
  return user ? hasActiveEntitlement(user.id, "lessons") : false;
}

export async function getCardTextAction(cardIds: unknown): Promise<CardTextReply> {
  return runCardText(cardIds, { lookup: getReviewCard, hasAccess: sessionHasAccess });
}
