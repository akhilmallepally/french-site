// The /review page's logic as pure functions (docs/plans/review.md, section 6), so it can be tested
// without a browser: today's counts, the deck from practised lessons, the session view and its
// keys, and the summary. components/review-session.tsx only wires these to the stores and the DOM.
import {
  addDays,
  buildSession,
  cardAllowed,
  currentCard,
  deckAdditions,
  isDue,
  logFor,
  NEW_PER_DAY,
  newCard,
  nextInSession,
  REVIEWS_PER_DAY,
  startSession,
  type Calendar,
  type CardState,
  type DailyLog,
  type DeckIndex,
  type Grade,
  type Session,
} from "./review-scheduler.ts";

// ---------- Today's counts (the /review header and the /progress line) ----------

export type TodayCounts = { due: number; newLeft: number; total: number };

/**
 * What's left to do today, within the limits: due reviews (at most 60 a day, minus the ones
 * answered) and new cards (at most 10 a day, minus the ones answered), counting cards that
 * practised lessons will add but that aren't in the deck yet.
 */
export function todayCounts(input: {
  index: DeckIndex;
  cards: Record<string, CardState>;
  practised: Set<string>;
  hasAccess: boolean;
  nowMs: number;
  cal: Calendar;
  log: DailyLog | undefined;
}): TodayCounts {
  const { index, cards, practised, hasAccess, nowMs, cal } = input;
  const today = cal.dayOf(nowMs);
  const log = logFor(input.log, today);
  const allowed = Object.keys(cards).filter((id) => cardAllowed(index, id, hasAccess));
  const dueNow = allowed.filter((id) => isDue(cards[id], today, cal)).length;
  const newNow = allowed.filter((id) => cards[id].box === 0).length + deckAdditions(index, cards, practised, hasAccess).length;
  const due = Math.min(dueNow, Math.max(0, REVIEWS_PER_DAY - log.reviewIds.length));
  const newLeft = Math.min(newNow, Math.max(0, NEW_PER_DAY - log.newIds.length));
  return { due, newLeft, total: due + newLeft };
}

/** The /progress line: null before any lesson is practised (nothing is shown then). */
export function dueLine(counts: TodayCounts, practised: Set<string>): string | null {
  if (!practised.size) return null;
  if (!counts.total) return "No cards due today";
  return `${counts.total} ${counts.total === 1 ? "card" : "cards"} due today`;
}

// ---------- The session to show ----------

/**
 * The cards for one batch, before access is known: the deck plus every card practised lessons would
 * add (paid ones included, as new cards that aren't stored), built as if the learner had access.
 * The page asks for their text; the reply says whether there's access, and resolveSession finishes it.
 */
export function provisionalSession(input: {
  index: DeckIndex;
  cards: Record<string, CardState>;
  practised: Set<string>;
  nowMs: number;
  cal: Calendar;
  log: DailyLog | undefined;
  exclude?: Iterable<string>;
}): { ids: string[]; cards: Record<string, CardState>; paidAdditions: string[] } {
  const free = new Set(deckAdditions(input.index, input.cards, input.practised, false));
  const paidAdditions = deckAdditions(input.index, input.cards, input.practised, true).filter((id) => !free.has(id));
  const cards = { ...input.cards };
  for (const id of [...free, ...paidAdditions]) cards[id] = newCard(input.nowMs);
  const ids = buildSession({ index: input.index, cards, hasAccess: true, nowMs: input.nowMs, cal: input.cal, log: input.log, exclude: input.exclude });
  return { ids, cards, paidAdditions };
}

// ---------- The view ----------

export type Result = { cardId: string; grade: Grade };

export type View =
  | { kind: "loading" }
  | { kind: "empty" } // nothing practised: no deck at all
  | { kind: "error"; retry: "start" | "more" }
  | { kind: "card"; session: Session; side: "front" | "back"; results: Result[] }
  | { kind: "summary"; results: Result[]; more: boolean }
  | { kind: "done" }; // a deck, but nothing left today

/** The first view for a batch: its cards, or "done" / "empty" when there are none. */
export function startView(ids: string[], hasDeck: boolean, results: Result[] = []): View {
  if (!ids.length) return hasDeck ? { kind: "done" } : { kind: "empty" };
  return { kind: "card", session: startSession(ids), side: "front", results };
}

export function reveal(view: View): View {
  return view.kind === "card" && view.side === "front" ? { ...view, side: "back" } : view;
}

/**
 * Grades the current card (only once its answer is shown). Returns the next view and, when the
 * answer changes the card's schedule, the card to record. A repeat of a "Not yet" card is practice
 * only. After the last card, the summary; `more` is filled in by the page.
 */
export function gradeCard(view: View, grade: Grade): { view: View; record: string | null } {
  if (view.kind !== "card" || view.side !== "back") return { view, record: null };
  const id = currentCard(view.session)!;
  const { session, schedule } = nextInSession(view.session, grade);
  const results = schedule ? [...view.results, { cardId: id, grade }] : view.results;
  const next: View = currentCard(session) === null ? { kind: "summary", results, more: false } : { kind: "card", session, side: "front", results };
  return { view: next, record: schedule ? id : null };
}

/** "7 / 20": the position among this batch's cards, repeats included in the total. */
export function progressLabel(view: View): { text: string; spoken: string } | null {
  if (view.kind !== "card") return null;
  const n = view.session.position + 1;
  const total = view.session.queue.length;
  return { text: `${n} / ${total}`, spoken: `Card ${n} of ${total}` };
}

/** Keyboard: Space or Enter shows the answer; then 1 is "Not yet" and 2 is "I knew it". */
export function keyAction(key: string, view: View): "reveal" | Grade | null {
  if (view.kind !== "card") return null;
  if (view.side === "front") return key === " " || key === "Enter" ? "reveal" : null;
  if (key === "1") return "not-yet";
  if (key === "2") return "knew";
  return null;
}

export function summaryOf(results: Result[]): { reviewed: number; known: number } {
  return { reviewed: results.length, known: results.filter((r) => r.grade === "knew").length };
}

/** The first day after today when an allowed card is due, or null. */
export function nextDueDay(index: DeckIndex, cards: Record<string, CardState>, hasAccess: boolean, nowMs: number, cal: Calendar): string | null {
  const today = cal.dayOf(nowMs);
  let best: string | null = null;
  for (const [id, s] of Object.entries(cards)) {
    if (s.box === 0 || !cardAllowed(index, id, hasAccess)) continue;
    const day = cal.dayOf(Date.parse(s.dueAt));
    if (day > today && (best === null || day < best)) best = day;
  }
  return best;
}

/** "tomorrow", or a short date such as "Mon 30 Nov". */
export function formatDay(day: string, nowMs: number, cal: Calendar): string {
  if (day === addDays(cal.dayOf(nowMs), 1)) return "tomorrow";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
