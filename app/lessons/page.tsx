import type { Metadata } from "next";
import Link from "next/link";
import { LevelCompletion } from "@/components/progress-status";
import { getLevelSummaries, isFreeLevel } from "@/lib/lessons";

export const metadata: Metadata = { title: "Lessons" };

export default function LessonsPage() {
  const levels = getLevelSummaries();

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <h1 className="font-serif text-4xl font-semibold tracking-tight">Lessons</h1>
      <p className="mt-2 max-w-2xl text-muted">
        The course follows the six CEFR levels, from your first <em>bonjour</em> to fluent, nuanced French. Start at A1
        if you&apos;re new.
      </p>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {levels.map((l) => (
          <li key={l.level}>
            <Link
              href={`/lessons/${l.slug}`}
              className={`group flex h-full flex-col rounded-2xl border border-border p-6 transition ${
                l.comingLater
                  ? "bg-card/50 hover:border-border"
                  : "bg-card hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-sm"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={`font-serif text-4xl font-semibold ${l.comingLater ? "text-muted/60" : "text-accent"}`}
                >
                  {l.level}
                </span>
                {l.comingLater ? (
                  <span className="rounded-full bg-background px-2.5 py-0.5 text-xs font-medium text-muted">
                    Coming later
                  </span>
                ) : (
                  <span className="text-sm text-muted">
                    {l.lessonCount === 0 ? "In progress" : `${l.lessonCount} lesson${l.lessonCount === 1 ? "" : "s"}`}
                  </span>
                )}
              </div>
              <h2
                className={`mt-3 font-serif text-xl font-semibold ${
                  l.comingLater ? "text-muted" : "group-hover:text-accent"
                }`}
              >
                {l.name}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{l.summary}</p>
              {!isFreeLevel(l.level) && !l.comingLater && (
                <p className="mt-2 text-xs font-medium text-accent">Free with a Google sign-in</p>
              )}
              {l.lessonCount > 0 && <LevelCompletion lessonIds={l.lessonIds} />}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
