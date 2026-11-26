"use client";
// The /review session (docs/plans/review.md, section 6). State comes from the local stores at once
// (never the network); the card text of the batch is fetched in one call before the first card
// (app/actions/review-text.ts) and kept in memory only. The logic lives in lib/review-session.ts.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCardTextAction } from "@/app/actions/review-text";
import cardIndex from "@/lib/generated/review-card-ids.json";
import { progressStore } from "@/lib/progress";
import { reviewStore } from "@/lib/review";
import { rememberAccess, rememberedAccess, sessionUser } from "@/lib/review-access";
import type { ReviewIdIndex } from "@/lib/review-catalogue";
import { buildSession, calendarFor, currentCard, deckAdditions, deckIndex, practisedLessons, type Grade } from "@/lib/review-scheduler";
import {
  formatDay,
  gradeCard,
  keyAction,
  nextDueDay,
  progressLabel,
  provisionalSession,
  reveal,
  startView,
  summaryOf,
  todayCounts,
  type TodayCounts,
  type View,
} from "@/lib/review-session";
import type { CardText } from "@/lib/review-text";

const INDEX = deckIndex(cardIndex as ReviewIdIndex);
// Written out in full so Next.js inlines them.
const SYNC_ON =
  process.env.NEXT_PUBLIC_REVIEW_SYNC === "on" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const ERROR_TEXT = "Couldn't load your cards. Check your connection and try again.";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const primary = `inline-flex min-h-14 items-center justify-center rounded-full bg-accent px-6 text-base font-medium text-white hover:opacity-90 ${focusRing}`;
const secondary = `inline-flex min-h-14 items-center justify-center rounded-full border border-border bg-background px-6 text-base font-medium hover:border-accent/40 hover:text-accent ${focusRing}`;
const cardBox = "flex min-h-[24rem] flex-col rounded-2xl border border-border bg-card p-6 sm:p-8";

async function fetchTexts(ids: string[]): Promise<Awaited<ReturnType<typeof getCardTextAction>>> {
  const out: Record<string, CardText> = {};
  let access: boolean | null = null;
  for (let i = 0; i < ids.length; i += 40) {
    const reply = await getCardTextAction(ids.slice(i, i + 40));
    if (reply.status !== "ok") return reply;
    Object.assign(out, reply.cards);
    if (reply.access !== null) access = reply.access;
  }
  return { status: "ok", cards: out, access };
}

export function ReviewSession() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [counts, setCounts] = useState<TodayCounts | null>(null);
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [signInLine, setSignInLine] = useState(false);
  const texts = useRef(new Map<string, CardText>());
  const drawnThisVisit = useRef<string[]>([]);
  const access = useRef(false);
  const busy = useRef(false);
  const cardRef = useRef<HTMLElement>(null);
  const cal = useRef(calendarFor());

  /** Reads the stores (local, no network) and updates the header and the next due day. */
  const refreshCounts = useCallback(async () => {
    const [progress, data] = await Promise.all([progressStore.getAll(), reviewStore.getAll()]);
    const now = Date.now();
    const practised = practisedLessons(progress);
    setCounts(todayCounts({ index: INDEX, cards: data.cards, practised, hasAccess: access.current, nowMs: now, cal: cal.current, log: data.today }));
    const day = nextDueDay(INDEX, data.cards, access.current, now, cal.current);
    setNextDue(day ? formatDay(day, now, cal.current) : null);
    return { practised, data };
  }, []);

  /** Builds the next batch, fetches its text in one go, and shows its first card. */
  const loadBatch = useCallback(
    async (retry: "start" | "more") => {
      if (busy.current) return;
      busy.current = true;
      try {
        const now = Date.now();
        const user = sessionUser();
        access.current = rememberedAccess(user);
        let { practised, data } = await refreshCounts();
        const free = deckAdditions(INDEX, data.cards, practised, false);
        if (free.length) {
          await reviewStore.addCards(free, now);
          data = await reviewStore.getAll();
        }
        if (!practised.size && !Object.keys(data.cards).length) {
          setView({ kind: "empty" });
          return;
        }
        const exclude = drawnThisVisit.current;
        const prov = provisionalSession({ index: INDEX, cards: data.cards, practised, nowMs: now, cal: cal.current, log: data.today, exclude });
        let ids = prov.ids;
        if (ids.length) {
          setView({ kind: "loading" });
          const reply = await fetchTexts(ids.filter((id) => !texts.current.has(id)));
          if (reply.status !== "ok") throw new Error(reply.code);
          for (const [id, t] of Object.entries(reply.cards)) texts.current.set(id, t);
          if (reply.access !== null) {
            access.current = reply.access;
            rememberAccess(user, reply.access);
          }
          if (access.current && prov.paidAdditions.length) await reviewStore.addCards(prov.paidAdditions, now);
          if (!access.current) {
            // No access: only stored cards a learner without access may see.
            ids = buildSession({ index: INDEX, cards: data.cards, hasAccess: false, nowMs: now, cal: cal.current, log: data.today, exclude });
            const missing = ids.filter((id) => !texts.current.has(id));
            if (missing.length) {
              const again = await fetchTexts(missing);
              if (again.status !== "ok") throw new Error(again.code);
              for (const [id, t] of Object.entries(again.cards)) texts.current.set(id, t);
            }
          }
          ids = ids.filter((id) => texts.current.has(id));
        }
        if (ids.length) {
          await reviewStore.recordDrawn(ids, now, cal.current);
          drawnThisVisit.current.push(...ids);
        }
        await refreshCounts();
        setView(startView(ids, true));
      } catch {
        setView({ kind: "error", retry });
      } finally {
        busy.current = false;
      }
    },
    [refreshCounts],
  );

  useEffect(() => {
    setSignInLine(SYNC_ON && !sessionUser());
    void loadBatch("start");
    const unsubscribe = reviewStore.subscribe(() => void refreshCounts());
    return unsubscribe;
  }, [loadBatch, refreshCounts]);

  const onGrade = useCallback(
    async (grade: Grade) => {
      const { view: next, record } = gradeCard(view, grade);
      if (record) await reviewStore.recordAnswer(record, grade, Date.now(), cal.current);
      if (next.kind === "summary") {
        const data = await reviewStore.getAll();
        const more = buildSession({ index: INDEX, cards: data.cards, hasAccess: access.current, nowMs: Date.now(), cal: cal.current, log: data.today, exclude: drawnThisVisit.current });
        await refreshCounts();
        setView({ ...next, more: more.length > 0 });
      } else {
        setView(next);
        void refreshCounts();
      }
    },
    [view, refreshCounts],
  );

  // Keyboard: Space or Enter shows the answer, then 1 = Not yet, 2 = I knew it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return; // their own keys
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const action = keyAction(e.key, view);
      if (!action) return;
      e.preventDefault();
      if (action === "reveal") setView(reveal(view));
      else void onGrade(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, onGrade]);

  // Each new card and each reveal: focus the card, so the keys work and nothing is lost.
  const position = view.kind === "card" ? `${view.session.position}:${view.side}` : view.kind;
  useEffect(() => {
    if (view.kind === "card") cardRef.current?.focus({ preventScroll: true });
  }, [position, view.kind]);

  const label = progressLabel(view);

  return (
    <div className="mt-6">
      <p className="min-h-6 text-sm text-muted" data-testid="review-counts">
        {counts ? `${counts.due} due today · ${counts.newLeft} new ${counts.newLeft === 1 ? "card" : "cards"} left today` : " "}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {label?.spoken ?? ""}
      </p>

      <div className="mt-4">
        {view.kind === "card" ? (
          <CardView view={view} text={texts.current.get(currentCard(view.session)!)} cardRef={cardRef} label={label!.text} onReveal={() => setView(reveal(view))} onGrade={onGrade} />
        ) : (
          <section className={`${cardBox} items-center justify-center text-center`} aria-labelledby={view.kind === "loading" ? undefined : "review-state"}>
            {view.kind === "loading" && <p className="text-muted">Loading your cards…</p>}
            {view.kind === "empty" && (
              <>
                <h2 id="review-state" className="font-serif text-2xl font-semibold">
                  Practise a lesson to add its words to your review.
                </h2>
                <Link href="/practice" className={`${primary} mt-6`}>
                  Go to Practice
                </Link>
              </>
            )}
            {view.kind === "error" && (
              <>
                <h2 id="review-state" className="font-serif text-xl font-semibold" role="alert">
                  {ERROR_TEXT}
                </h2>
                <button type="button" className={`${primary} mt-6`} onClick={() => void loadBatch(view.retry)}>
                  Retry
                </button>
              </>
            )}
            {view.kind === "done" && (
              <>
                <h2 id="review-state" className="font-serif text-2xl font-semibold">
                  All done for today
                </h2>
                {nextDue && <p className="mt-2 text-muted">Your next cards are due {nextDue}.</p>}
                <Link href="/practice" className={`${primary} mt-6`}>
                  Go to Practice
                </Link>
              </>
            )}
            {view.kind === "summary" && <Summary view={view} nextDue={nextDue} onMore={() => void loadBatch("more")} />}
          </section>
        )}
      </div>

      {signInLine && (
        <p className="mt-6 text-sm text-muted">
          Sign in to keep your review across devices.{" "}
          <Link href="/sign-in?next=/review" className={`font-medium text-accent underline-offset-2 hover:underline ${focusRing}`}>
            Sign in
          </Link>
        </p>
      )}
    </div>
  );
}

function CardView({
  view,
  text,
  cardRef,
  label,
  onReveal,
  onGrade,
}: {
  view: Extract<View, { kind: "card" }>;
  text: CardText | undefined;
  cardRef: React.RefObject<HTMLElement | null>;
  label: string;
  onReveal: () => void;
  onGrade: (g: Grade) => void;
}) {
  const back = view.side === "back";
  return (
    <section ref={cardRef} tabIndex={-1} aria-label="Review card" className={`${cardBox} ${focusRing}`}>
      <div className="flex min-h-6 items-center justify-between text-sm text-muted">
        <span>{text?.group ?? ""}</span>
        <span aria-hidden="true" data-testid="review-progress">
          {label}
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
        <p lang="fr" className="font-serif text-3xl font-semibold sm:text-4xl" data-testid="review-fr">
          {text?.fr}
        </p>
        {text?.pron && <p className="mt-2 text-muted">{text.pron}</p>}
        {/* The answer always takes its space, so the card doesn't change size when it's shown. */}
        <div className={back ? "" : "invisible"} aria-hidden={!back}>
          <p className="mt-6 text-xl" data-testid="review-en">
            {text?.en}
          </p>
          {text?.note && <p className="mt-2 text-sm text-muted">{text.note}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {back ? (
          <>
            <button type="button" className={secondary} onClick={() => onGrade("not-yet")}>
              Not yet <span className="ml-2 hidden text-xs text-muted sm:inline">1</span>
            </button>
            <button type="button" className={primary} onClick={() => onGrade("knew")}>
              I knew it <span className="ml-2 hidden text-xs opacity-80 sm:inline">2</span>
            </button>
          </>
        ) : (
          <button type="button" className={`${primary} col-span-2`} onClick={onReveal}>
            Show answer
          </button>
        )}
      </div>
    </section>
  );
}

function Summary({ view, nextDue, onMore }: { view: Extract<View, { kind: "summary" }>; nextDue: string | null; onMore: () => void }) {
  const { reviewed, known } = summaryOf(view.results);
  return (
    <>
      <h2 id="review-state" className="font-serif text-2xl font-semibold">
        Session complete
      </h2>
      <p className="mt-2" data-testid="review-summary">
        {reviewed} {reviewed === 1 ? "card" : "cards"} reviewed, {known} known.
      </p>
      {nextDue && <p className="mt-1 text-muted">Next cards due {nextDue}.</p>}
      {view.more ? (
        <button type="button" className={`${primary} mt-6`} onClick={onMore}>
          Do another 20
        </button>
      ) : (
        <>
          <p className="mt-6 font-medium">All done for today</p>
          <Link href="/practice" className={`${secondary} mt-4`}>
            Go to Practice
          </Link>
        </>
      )}
    </>
  );
}
