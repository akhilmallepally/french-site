// The daily-review card catalogue (docs/plans/review.md, decisions 1 to 3 and rollout step 2).
// Pure: it works on parsed lessons and the published-ids record passed in, so it can be tested
// on fixtures. scripts/build-review-cards.ts writes the committed files; validate:content checks them.
//
// Runs under plain Node (type stripping) too, so: relative .ts imports, no parameter properties.
import { compareLessons, isFreeLevel, type Lesson, type Level } from "./lessons.ts";

/** One review card. Its text comes from the entry whose vocab id is the card id. */
export type ReviewCard = {
  id: string;
  lessonId: string;
  level: Level;
  fr: string;
  en: string;
  pron?: string;
  group?: string;
  note?: string;
  /** Every vocab id on this card, in course order (the card id included). */
  vocabIds: string[];
};

/** Every vocab id and every card id published so far, by lesson, in course order. */
export type PublishedIds = { lessons: Record<string, { vocab: string[]; cards: string[] }> };

export type ReviewTotals = { vocab: number; eligible: number; cards: number };

export type ReviewCatalogue = { totals: ReviewTotals; free: ReviewCard[]; paid: ReviewCard[]; published: PublishedIds };

/** supabase/migrations/0008_review_cards.sql: the card_id check and the lesson_id length. */
export const CARD_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*-v[0-9]{1,6}$/;
export const MAX_CARD_ID = 160;
export const MAX_LESSON_ID = 120;
/** 0008's per-user cap (c_cap_cards). */
export const CARD_CAP = 6000;

/** Glossary entries are reading aids for longer texts, not cards (decision 2). */
export function isCardEligible(group: string | undefined): boolean {
  return group !== "glossary";
}

/**
 * The comparison form for repeats (decision 3): NFC, lower case, curly apostrophes straight, the
 * punctuation . , ; : ! ? … " « » ( ) [ ] as spaces, spaces collapsed, ends trimmed. Accents,
 * hyphens and apostrophes are kept, because they change meaning.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[.,;:!?…"«»()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchKey(fr: string, en: string): string {
  return `${normalizeForMatch(fr)}\u0000${normalizeForMatch(en)}`;
}

export const EMPTY_PUBLISHED: PublishedIds = { lessons: {} };

/**
 * Builds the cards. The card id of a group of matching entries is:
 * - a card id already published among the group's entries (it never changes); when an edit makes
 *   two published cards match, both stay, and the group's other entries join the earlier one;
 * - otherwise the vocab id of the group's earliest entry in course order.
 * An entry that stops matching its old card becomes a card under its own vocab id.
 * The published record returned is today's ids; checkPublished says whether it still covers the old one.
 */
export function buildReviewCatalogue(lessons: Lesson[], published: PublishedIds = EMPTY_PUBLISHED): ReviewCatalogue {
  const ordered = [...lessons].sort((a, b) => compareLessons(a.meta, b.meta));
  const publishedCards = new Set(Object.values(published.lessons).flatMap((l) => l.cards));

  type Entry = { lesson: Lesson; vocab: Lesson["vocab"][number]; rank: number };
  const groups = new Map<string, Entry[]>();
  let vocabCount = 0;
  let eligible = 0;
  for (const lesson of ordered) {
    for (const vocab of lesson.vocab) {
      vocabCount += 1;
      if (!isCardEligible(vocab.group)) continue;
      const entry = { lesson, vocab, rank: eligible };
      eligible += 1;
      const key = matchKey(vocab.fr, vocab.en);
      const group = groups.get(key);
      if (group) group.push(entry);
      else groups.set(key, [entry]);
    }
  }

  // card id -> its entries, in course order
  const members = new Map<string, Entry[]>();
  const owner = new Map<string, Entry>();
  for (const group of groups.values()) {
    const kept = group.filter((e) => publishedCards.has(e.vocab.id));
    const heads = kept.length ? kept : [group[0]];
    for (const h of heads) {
      members.set(h.vocab.id, []);
      owner.set(h.vocab.id, h);
    }
    for (const e of group) {
      const card = members.has(e.vocab.id) ? e.vocab.id : heads[0].vocab.id;
      members.get(card)!.push(e);
    }
  }

  const cards = [...owner.values()]
    .sort((a, b) => a.rank - b.rank)
    // A fixed key order, and the optional fields only when present.
    .map(({ lesson, vocab }): ReviewCard => ({
      id: vocab.id,
      lessonId: lesson.meta.id,
      level: lesson.meta.level,
      fr: vocab.fr,
      en: vocab.en,
      ...(vocab.pron !== undefined ? { pron: vocab.pron } : {}),
      ...(vocab.group !== undefined ? { group: vocab.group } : {}),
      ...(vocab.note !== undefined ? { note: vocab.note } : {}),
      vocabIds: members.get(vocab.id)!.map((e) => e.vocab.id),
    }));

  const cardIdsByLesson = new Map<string, string[]>();
  for (const c of cards) {
    const list = cardIdsByLesson.get(c.lessonId) ?? [];
    list.push(c.id);
    cardIdsByLesson.set(c.lessonId, list);
  }
  const current: PublishedIds = { lessons: {} };
  for (const lesson of ordered) {
    current.lessons[lesson.meta.id] = {
      vocab: lesson.vocab.map((v) => v.id),
      cards: cardIdsByLesson.get(lesson.meta.id) ?? [],
    };
  }

  return {
    totals: { vocab: vocabCount, eligible, cards: cards.length },
    free: cards.filter((c) => isFreeLevel(c.level)),
    paid: cards.filter((c) => !isFreeLevel(c.level)),
    published: current,
  };
}

/**
 * What changed for ids already published: an id that disappeared, or one that now belongs to
 * another lesson (for a card, that changes its meaning). New ids are fine. Empty when intact.
 */
export function checkPublished(old: PublishedIds, current: PublishedIds): string[] {
  const where = (kind: "vocab" | "cards") => {
    const m = new Map<string, string>();
    for (const [lessonId, l] of Object.entries(current.lessons)) for (const id of l[kind]) m.set(id, lessonId);
    return m;
  };
  const vocabNow = where("vocab");
  const cardsNow = where("cards");
  const changes: string[] = [];
  for (const [lessonId, l] of Object.entries(old.lessons)) {
    for (const id of l.vocab) {
      const now = vocabNow.get(id);
      if (!now) changes.push(`vocab id "${id}" (${lessonId}) was published and is gone`);
      else if (now !== lessonId) changes.push(`vocab id "${id}" moved from ${lessonId} to ${now}`);
    }
    for (const id of l.cards) {
      const now = cardsNow.get(id);
      if (now === lessonId) continue;
      if (now) changes.push(`card id "${id}" now points to ${now}, not ${lessonId}`);
      else if (vocabNow.has(id)) changes.push(`card id "${id}" (${lessonId}) was published and is no longer a card (is it now a glossary entry?)`);
      else changes.push(`card id "${id}" (${lessonId}) was published and is gone`);
    }
  }
  return changes;
}

/**
 * Rules every card must meet (0008's checks and the required text). The catalogue builds unique
 * ids by construction; the check is kept so a builder change can't slip one through.
 */
export function checkCards(cards: ReviewCard[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c.id)) problems.push(`card id "${c.id}" is used twice`);
    seen.add(c.id);
    if (!CARD_ID_PATTERN.test(c.id) || c.id.length > MAX_CARD_ID) {
      problems.push(`card id "${c.id}" doesn't match 0008's format (lower-case words and hyphens, then -v and 1 to 6 digits, at most ${MAX_CARD_ID} characters)`);
    }
    if (!c.lessonId || c.lessonId.length > MAX_LESSON_ID) problems.push(`card "${c.id}": lesson id must be 1 to ${MAX_LESSON_ID} characters`);
    if (!c.id.startsWith(`${c.lessonId}-v`)) problems.push(`card "${c.id}" must start with its lesson id "${c.lessonId}-v" (0008's lesson-prefix rule)`);
    for (const k of ["fr", "en"] as const) {
      if (typeof c[k] !== "string" || !c[k].trim()) problems.push(`card "${c.id}": "${k}" is missing or empty`);
    }
    for (const k of ["pron", "group", "note"] as const) {
      if (c[k] !== undefined && (typeof c[k] !== "string" || !c[k]!.trim())) problems.push(`card "${c.id}": "${k}" is an empty string`);
    }
    if (!c.vocabIds.includes(c.id)) problems.push(`card "${c.id}": its vocab ids must include the card id`);
  }
  if (cards.length > CARD_CAP) problems.push(`${cards.length} cards is more than 0008's per-user cap of ${CARD_CAP}`);
  return problems;
}

// ---------- The id index (no card text; safe for client code) ----------

/**
 * Per lesson, in course order: its level, the cards it owns (the part after "<lessonId>-", e.g.
 * "v001") and, under `joins`, other lessons' cards that one of its entries merged into. Practising
 * a lesson adds both to the deck. A card's level is its own lesson's level.
 */
export type ReviewIdIndex = { lessons: Record<string, { level: Level; cards: string[]; joins?: string[] }> };

export function buildIdIndex(lessons: Lesson[], cards: ReviewCard[]): ReviewIdIndex {
  const own = new Map<string, string[]>();
  const joins = new Map<string, string[]>();
  for (const c of cards) {
    own.set(c.lessonId, [...(own.get(c.lessonId) ?? []), c.id.slice(c.lessonId.length + 1)]);
    for (const v of c.vocabIds) {
      const lessonId = v.replace(/-v\d+$/, "");
      if (lessonId !== c.lessonId && !(joins.get(lessonId) ?? []).includes(c.id)) joins.set(lessonId, [...(joins.get(lessonId) ?? []), c.id]);
    }
  }
  const index: ReviewIdIndex = { lessons: {} };
  for (const { meta } of [...lessons].sort((a, b) => compareLessons(a.meta, b.meta))) {
    const o = own.get(meta.id) ?? [];
    const j = joins.get(meta.id);
    if (o.length || j) index.lessons[meta.id] = { level: meta.level, cards: o, ...(j ? { joins: j } : {}) };
  }
  return index;
}

// ---------- Committed file text (byte-identical across runs) ----------

/** One card per line, LF line ends, one trailing newline. */
export function serializeCards(access: "free" | "paid", cards: ReviewCard[]): string {
  const levels = [...new Set(cards.map((c) => c.level))];
  const head = `{\n  "access": ${JSON.stringify(access)},\n  "levels": ${JSON.stringify(levels)},\n  "count": ${cards.length},\n  "cards": [`;
  const body = cards.map((c) => `    ${JSON.stringify(c)}`).join(",\n");
  return `${head}${cards.length ? `\n${body}\n  ` : ""}]\n}\n`;
}

/** One lesson per line, in course order. */
export function serializePublished(p: PublishedIds): string {
  const rows = Object.entries(p.lessons).map(([id, l]) => `    ${JSON.stringify(id)}: ${JSON.stringify(l)}`);
  return `{\n  "lessons": {${rows.length ? `\n${rows.join(",\n")}\n  ` : ""}}\n}\n`;
}

/** One lesson per line, in course order. */
export function serializeIdIndex(index: ReviewIdIndex): string {
  const rows = Object.entries(index.lessons).map(([id, l]) => `    ${JSON.stringify(id)}: ${JSON.stringify(l)}`);
  return `{\n  "lessons": {${rows.length ? `\n${rows.join(",\n")}\n  ` : ""}}\n}\n`;
}
