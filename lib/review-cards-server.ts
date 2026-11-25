import "server-only";
// The review card text for server code (docs/plans/review.md, section 4). This is the only module
// that may import lib/generated/review-cards-paid.json: B1 to C2 card text must never reach client
// JavaScript or a public file (scripts/review-bundle.test.ts checks the build output, and
// scripts/review-cards.test.ts checks that nothing else imports the paid file). The access check
// belongs to the caller (the review server actions, rollout step 4); nothing calls this yet.
import freeCards from "@/lib/generated/review-cards-free.json";
import paidCards from "@/lib/generated/review-cards-paid.json";
import type { ReviewCard } from "@/lib/review-catalogue";

type CardFile = { access: "free" | "paid"; levels: string[]; count: number; cards: ReviewCard[] };

const FREE = freeCards as CardFile;
const PAID = paidCards as CardFile;

let byId: Map<string, { card: ReviewCard; free: boolean }> | null = null;

/** A card by its id, and whether it's in a free level. Null for an unknown id. */
export function getReviewCard(id: string): { card: ReviewCard; free: boolean } | null {
  if (!byId) {
    byId = new Map();
    for (const card of FREE.cards) byId.set(card.id, { card, free: true });
    for (const card of PAID.cards) byId.set(card.id, { card, free: false });
  }
  return byId.get(id) ?? null;
}
