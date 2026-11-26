// The card-text read for /review (docs/plans/review.md, section 11). Pure: the card lookup and the
// access check are passed in (app/actions/review-text.ts wires them to lib/review-cards-server.ts
// and the session). Only the text of the cards asked for, at most 40 per call, and only for a
// learner with access: the daily review is part of lifetime access (Prompt 76), so free-level cards
// need it too. Without access nothing comes back.

export type CardText = { fr: string; en: string; pron?: string; group?: string; note?: string };

/** `access` is the check's result when a known card was asked for, and null when none was. */
export type CardTextReply = { status: "ok"; cards: Record<string, CardText>; access: boolean | null } | { status: "invalid"; code: "bad_payload" | "too_many_ids" | "duplicate_id" };

export const MAX_TEXT_IDS = 40;
const CARD_RE = /^[a-z0-9]+(-[a-z0-9]+)*-v[0-9]{1,6}$/;

type Found = { card: { fr: string; en: string; pron?: string; group?: string; note?: string }; free: boolean } | null;

export async function runCardText(input: unknown, deps: { lookup(id: string): Found; hasAccess(): Promise<boolean> }): Promise<CardTextReply> {
  if (!Array.isArray(input)) return { status: "invalid", code: "bad_payload" };
  if (input.length > MAX_TEXT_IDS) return { status: "invalid", code: "too_many_ids" };
  const seen = new Set<string>();
  for (const id of input) {
    if (typeof id !== "string" || id.length > 160) return { status: "invalid", code: "bad_payload" };
    if (seen.has(id)) return { status: "invalid", code: "duplicate_id" };
    seen.add(id);
  }
  let access: boolean | null = null;
  const cards: Record<string, CardText> = {};
  for (const id of input as string[]) {
    const found = CARD_RE.test(id) ? deps.lookup(id) : null;
    if (!found) continue; // an unknown id is left out
    if (access === null) {
      try {
        access = await deps.hasAccess();
      } catch {
        access = false; // fails closed
      }
    }
    if (!access) continue;
    const c = found.card;
    cards[id] = { fr: c.fr, en: c.en, ...(c.pron ? { pron: c.pron } : {}), ...(c.group ? { group: c.group } : {}), ...(c.note ? { note: c.note } : {}) };
  }
  return { status: "ok", cards, access };
}
