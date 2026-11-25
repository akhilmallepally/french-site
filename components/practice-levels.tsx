"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { watchHashTarget } from "@/lib/hash-target";
import { isCompleted, progressStore, type ProgressData } from "@/lib/progress";
import { practiceHref, type PracticeLesson, type PracticeLevel } from "@/lib/practice";

/**
 * The /practice list. The structure comes from the server (static); this learner's best scores are
 * read from progressStore after mount, from local data at once (the server's copy updates them in
 * place), into slots of fixed width so nothing shifts. Arriving at #a1 or #a1-getting-started opens
 * that level, scrolls the unit to the top and moves focus there.
 */
export function PracticeLevels({ levels, levelNames, locks }: { levels: PracticeLevel[]; levelNames: Record<string, string>; locks: Record<string, ReactNode> }) {
  const [data, setData] = useState<ProgressData | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      progressStore.getAll().then((all) => {
        if (active) setData(all);
      });
    void load();
    const unsubscribe = progressStore.subscribe(() => void load());
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const ids = levels.flatMap((l) => [l.anchor, ...l.units.map((u) => u.anchor), `${l.anchor}-level-review`]);
    return watchHashTarget(ids, (id) => `${id}-heading`);
  }, [levels]);

  return (
    <ul className="mt-8 space-y-3">
      {levels.map((l) => (
        <li key={l.level}>
          <details id={l.anchor} className="group scroll-mt-6 rounded-2xl border border-border bg-card">
            <summary
              id={`${l.anchor}-heading`}
              className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <h2 className="font-serif text-xl font-semibold">
                {l.level} <span className="font-sans text-base font-normal text-muted">· {levelNames[l.level]}</span>
              </h2>
              {l.free ? <span className="text-xs font-medium text-muted">Free</span> : locks[l.level]}
            </summary>
            <div className="border-t border-border px-5 py-2">
              {l.units.map((u) => (
                <section key={u.anchor} id={u.anchor} aria-labelledby={`${u.anchor}-heading`} className="scroll-mt-6 border-b border-border py-3 last:border-b-0">
                  <h3 id={`${u.anchor}-heading`} className="text-sm font-semibold text-muted">
                    {u.name}
                  </h3>
                  {u.review ? <ReviewRow lesson={u.review} data={data} /> : <p className="mt-1 text-sm text-muted">No review for this unit yet</p>}
                </section>
              ))}
              {l.levelReview && (
                <section id={`${l.anchor}-level-review`} aria-labelledby={`${l.anchor}-level-review-heading`} className="scroll-mt-6 py-3">
                  <h3 id={`${l.anchor}-level-review-heading`} className="text-sm font-semibold text-muted">
                    {l.level} level review
                  </h3>
                  <ReviewRow lesson={l.levelReview} data={data} />
                </section>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function ReviewRow({ lesson, data }: { lesson: PracticeLesson; data: ProgressData | null }) {
  const best = data?.lessons[lesson.id];
  const status = !data ? "" : best ? `${isCompleted(best) ? "✓ " : ""}Best ${best.bestScore} / ${best.bestTotal}` : "Not started";
  return (
    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <Link href={practiceHref(lesson.href)} className="font-medium hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        {lesson.title}
      </Link>
      <span className="flex shrink-0 items-baseline gap-3 text-sm text-muted">
        <span className="tabular-nums">{lesson.exercises} exercises</span>
        <span className={`inline-block min-w-[8.5rem] text-right tabular-nums ${best && isCompleted(best) ? "text-emerald-800" : ""}`}>{status}</span>
      </span>
    </div>
  );
}
