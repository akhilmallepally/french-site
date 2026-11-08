import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TypeBadge } from "@/components/lesson-ui";
import { LessonStatus } from "@/components/progress-status";
import { LEVELS, getLevel, levelToSlug } from "@/lib/lessons";

export function generateStaticParams() {
  return LEVELS.map((level) => ({ level: levelToSlug(level) }));
}

export async function generateMetadata({ params }: PageProps<"/lessons/[level]">): Promise<Metadata> {
  const level = getLevel((await params).level);
  if (!level) return {};
  return { title: `${level.level} ${level.name}`, description: level.summary };
}

export default async function LevelPage({ params }: PageProps<"/lessons/[level]">) {
  const level = getLevel((await params).level);
  if (!level) notFound();

  const lessonCount = level.units.reduce((n, u) => n + u.lessons.length, 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/lessons" className="text-sm text-muted transition-colors hover:text-accent">
        ← All levels
      </Link>

      <header className="mt-6 border-b border-border pb-8">
        <span className="inline-block rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted">
          CEFR {level.level}
          {lessonCount > 0 && ` · ${lessonCount} lessons · ${level.units.length} units`}
        </span>
        <h1 className="mt-4 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">
          <span className="text-accent">{level.level}</span> {level.name}
        </h1>
        <p className="mt-3 text-lg text-muted">{level.summary}</p>
      </header>

      {lessonCount === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
          <p className="font-serif text-2xl font-semibold">{level.comingLater ? "Coming later" : "Lessons in progress"}</p>
          <p className="mx-auto mt-2 max-w-md text-muted">
            {level.comingLater
              ? `${level.level} lessons will be added once the earlier levels are complete.`
              : `${level.level} lessons are being written. Check back soon.`}
          </p>
        </div>
      ) : (
        <div className="mt-10 space-y-12">
          {level.units.map((unit, i) => (
            <section key={unit.name}>
              <p className="text-xs font-semibold uppercase tracking-widest text-accent">Unit {i + 1}</p>
              <h2 className="mt-1 font-serif text-2xl font-semibold">{unit.name}</h2>
              <ol className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                {unit.lessons.map((l) => (
                  <li key={l.id}>
                    <Link href={l.href} className="group flex items-start gap-4 px-5 py-4 transition hover:bg-background/60">
                      <span className="w-7 shrink-0 pt-0.5 font-serif text-lg font-semibold text-accent/70 tabular-nums">
                        {l.order}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-serif text-lg font-semibold group-hover:text-accent">{l.title}</span>
                          <TypeBadge type={l.type} />
                          <LessonStatus lessonId={l.id} />
                        </span>
                        <span className="mt-0.5 block text-sm text-muted">{l.description}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      <nav className="mt-14 flex justify-between gap-4 border-t border-border pt-6 text-sm">
        {level.prevLevel ? (
          <Link href={`/lessons/${levelToSlug(level.prevLevel)}`} className="text-muted hover:text-accent">
            ← {level.prevLevel}
          </Link>
        ) : (
          <span />
        )}
        {level.nextLevel && (
          <Link href={`/lessons/${levelToSlug(level.nextLevel)}`} className="text-muted hover:text-accent">
            {level.nextLevel} →
          </Link>
        )}
      </nav>
    </main>
  );
}
