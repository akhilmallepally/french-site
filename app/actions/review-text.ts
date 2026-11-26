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

export async function getCardTextAction(cardIds: unknown): Promise<CardTextReply> {
  // "unknown" (the access check failed) is never "no" (Prompt 80): the reply is "unavailable" and
  // the review shows its retry, instead of an empty session or a remembered "no access".
  let unknown = false;
  const sessionHasAccess = async (): Promise<boolean> => {
    const user = await getCurrentUser();
    const state = user ? await hasActiveEntitlement(user.id, "lessons") : "no";
    if (state === "unknown") unknown = true;
    return state === "yes";
  };
  const reply = await runCardText(cardIds, { lookup: getReviewCard, hasAccess: sessionHasAccess });
  return unknown ? { status: "unavailable", code: "access_unknown" } : reply;
}
