"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { progressStore, type ProgressData, type ProgressMode } from "@/lib/progress";
import { summarize, type CatalogueLesson, type Summary } from "@/lib/progress-summary";
import { levelAnchor, practiceHref, unitAnchor, writingTaskHref } from "@/lib/practice";

type Loaded = { data: ProgressData; mode: ProgressMode; notice: string | null };

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * The /progress dashboard (docs/plans/progress.md, section 9). Reads the store after mount and
 * again whenever it changes, so local progress shows at once and the server's copy updates it in
 * place. Until the first read, a quiet placeholder of about the same size stands in, never a
 * "nothing yet" message.
 */
export function ProgressDashboard({ catalogue, levelNames }: { catalogue: CatalogueLesson[]; levelNames: Record<string, string> }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () =>
      Promise.all([progressStore.getAll(), progressStore.mode(), progressStore.importNotice()]).then(([data, mode, notice]) => {
        if (!active) return;
        setLoaded({ data, mode, notice: notice?.text ?? null });
        if (notice) {
          setNoticeOpen(true);
          void progressStore.markImportNoticeShown(); // once: it won't appear on the next visit
        }
      });
    void load();
    const unsubscribe = progressStore.subscribe(() => void load());
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!noticeOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNoticeOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [noticeOpen]);

  if (!loaded) return <Placeholder />;
  const summary = summarize(catalogue, loaded.data);

  return (
    <div className="mt-6">
      {noticeOpen && loaded.notice && (
        <div role="status" className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">
          <p>{loaded.notice}</p>
          <button
            type="button"
            onClick={() => setNoticeOpen(false)}
            className="shrink-0 rounded-full px-2 font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Dismiss
          </button>
        </div>
      )}

      {loaded.mode === "browser-signed-out" && (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4">
          <p className="text-sm text-muted">Your progress is saved in this browser only. Sign in to keep it across devices.</p>
          <Link
            href="/sign-in?next=/progress"
            className="inline-flex min-h-10 items-center rounded-full bg-accent px-5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Sign in
          </Link>
        </div>
      )}

      <p className="mb-8 text-sm">
        <Link href="/practice" className={`text-accent underline-offset-2 hover:underline ${linkClass}`}>
          Practice: every unit review in one place →
        </Link>
      </p>

      {summary.empty ? <EmptyState /> : <Sections summary={summary} levelNames={levelNames} />}
    </div>
  );
}

function EmptyState() {
  return (
    <section aria-labelledby="empty-heading" className="rounded-2xl border border-border bg-card p-8 text-center">
      <h2 id="empty-heading" className="font-serif text-2xl font-semibold">
        Nothing practised yet
      </h2>
      <p className="mx-auto mt-2 max-w-md text-muted">
        Your scores, completed lessons and lessons to revisit will show here. A1 is free and needs no account.
      </p>
      <Link
        href="/lessons/a1"
        className="mt-6 inline-flex min-h-11 items-center rounded-full bg-accent px-6 font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Start the first free lessons
      </Link>
    </section>
  );
}

const sectionHeading = "font-serif text-2xl font-semibold tracking-tight";
const linkClass = "font-medium underline-offset-2 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function Sections({ summary, levelNames }: { summary: Summary; levelNames: Record<string, string> }) {
  const c = summary.continueWith;
  return (
    <div className="space-y-12">
      {c && (
        <section aria-labelledby="continue-heading">
          <h2 id="continue-heading" className={sectionHeading}>
            Continue
          </h2>
          <Link href={practiceHref(c.lesson.href)} className="mt-4 block rounded-2xl border border-border bg-card p-5 transition hover:border-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className="block font-serif text-xl font-semibold">{c.lesson.title}</span>
            <span className="mt-1 block text-sm text-muted">
              {c.lesson.level} · {c.lesson.unit} · last practised {formatDate(c.at)}
            </span>
          </Link>
        </section>
      )}

      <section aria-labelledby="levels-heading">
        <h2 id="levels-heading" className={sectionHeading}>
          By level
        </h2>
        <ul className="mt-4 space-y-3">
          {summary.levels.map((l) => (
            <li key={l.level}>
              <details className="group rounded-2xl border border-border bg-card">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                  <span className="font-semibold">
                    <Link href={`/practice#${levelAnchor(l.level)}`} className={linkClass}>
                      {l.level}
                    </Link>{" "}
                    <span className="font-normal text-muted">· {levelNames[l.level]}</span>
                  </span>
                  <span className="flex items-center gap-3 text-sm text-muted">
                    <span className="h-2 w-28 overflow-hidden rounded-full bg-border" aria-hidden="true">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${l.total ? (100 * l.completed) / l.total : 0}%` }} />
                    </span>
                    {l.completed} / {l.total} completed
                  </span>
                </summary>
                <ul className="border-t border-border px-5 py-3 text-sm">
                  {l.units.map((u) => (
                    <li key={u.name} className="flex justify-between gap-4 py-1">
                      <Link href={`/practice#${unitAnchor(l.level, u.name)}`} className={linkClass}>
                        {u.name}
                      </Link>
                      <span className="shrink-0 text-muted tabular-nums">
                        {u.completed} / {u.total}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {summary.started.length > 0 && (
        <section aria-labelledby="started-heading">
          <h2 id="started-heading" className={sectionHeading}>
            Started, not finished
          </h2>
          <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
            {summary.started.map((s) => (
              <li key={s.lesson.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3">
                <Link href={practiceHref(s.lesson.href)} className={linkClass}>
                  {s.lesson.title}
                </Link>
                <span className="text-sm text-muted">
                  {s.lesson.level} · {formatDate(s.at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.review.length > 0 && (
        <section aria-labelledby="review-heading">
          <h2 id="review-heading" className={sectionHeading}>
            Review lessons to revisit
          </h2>
          <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
            {summary.review.map((r) => (
              <li key={r.lesson.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3">
                <Link href={practiceHref(r.lesson.href)} className={linkClass}>
                  {r.lesson.title}
                </Link>
                <span className="text-sm text-muted">{r.reason === "unfinished" ? "Not finished yet" : "The rest of the unit is done"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.writing.total > 0 && (
        <section aria-labelledby="writing-heading">
          <h2 id="writing-heading" className={sectionHeading}>
            C2 writing tasks
          </h2>
          <p className="mt-2 text-sm text-muted">
            {summary.writing.done} of {summary.writing.total} marked as done. Your texts stay in this browser and aren&apos;t shown here.
          </p>
          {summary.writing.done > 0 && (
            <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
              {summary.writing.tasks
                .filter((t) => t.done)
                .map((t) => (
                  <li key={t.lesson.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3">
                    <Link href={writingTaskHref(t.lesson.href)} className={linkClass}>
                      {t.lesson.title}
                    </Link>
                    <span className="text-sm text-muted">Done {t.doneAt ? formatDate(t.doneAt) : ""}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** Same rhythm as the loaded page (a heading and six level rows), with no text that could mislead. */
function Placeholder() {
  return (
    <div className="mt-6" aria-hidden="true">
      <div className="h-7 w-32 rounded-md bg-border/50" />
      <div className="mt-4 h-20 rounded-2xl border border-border bg-card/60" />
      <div className="mt-12 h-7 w-28 rounded-md bg-border/50" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-14 rounded-2xl border border-border bg-card/60" />
        ))}
      </div>
    </div>
  );
}
