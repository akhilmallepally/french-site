import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GatedLessonBody, LessonBody, LessonBodySkeleton } from "@/components/lesson-body";
import { ConnectionSection, LessonChip, TypeBadge } from "@/components/lesson-ui";
import { grantFreeAccess } from "@/lib/auth";
import { compareLessons, getAllLessons, getLessonConnections, getLessonMeta, isFreeLevel, levelToSlug, type LessonMeta } from "@/lib/lessons";

type Props = PageProps<"/lessons/[level]/[slug]">;

const MAX_PREREQS_SHOWN = 4;

export function generateStaticParams() {
  return getAllLessons().map((l) => ({ level: levelToSlug(l.level), slug: l.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { level, slug } = await params;
  const meta = getLessonMeta(level, slug);
  if (!meta) return {};
  return { title: `${meta.title} (${meta.level})`, description: meta.description };
}

export default async function LessonPage({ params }: Props) {
  const { level, slug } = await params;
  // The shell only ever sees metadata. The body, vocab and exercises are loaded inside LessonBody.
  const meta = getLessonMeta(level, slug);
  if (!meta) notFound();

  const links = getLessonConnections(meta.id)!;
  const nearestFirst = [...links.prerequisites].sort((a, b) => compareLessons(b, a));
  const nearPrereqs = nearestFirst.slice(0, MAX_PREREQS_SHOWN);
  const earlierPrereqs = nearestFirst.slice(MAX_PREREQS_SHOWN);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <nav className="text-sm text-muted">
        <Link href="/lessons" className="transition-colors hover:text-accent">
          Lessons
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/lessons/${level}`} className="transition-colors hover:text-accent">
          {meta.level}
        </Link>
        <span className="mx-2">/</span>
        <span>{meta.unit}</span>
      </nav>

      <header className="mt-6 border-b border-border pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted">
            {meta.level} · Lesson {meta.order}
          </span>
          <TypeBadge type={meta.type} />
        </div>
        <h1 className="mt-4 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">{meta.title}</h1>
        {meta.description && <p className="mt-3 text-lg text-muted">{meta.description}</p>}
      </header>

      {links.prerequisites.length > 0 && (
        <aside className="mt-8 rounded-2xl border border-border bg-card/60 p-5">
          <h2 className="text-sm font-semibold">Before this lesson</h2>
          <p className="mt-0.5 text-sm text-muted">This lesson assumes you&apos;ve done:</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {nearPrereqs.map((l) => (
              <LessonChip key={l.id} lesson={l} showLevel={l.level !== meta.level} />
            ))}
          </div>
          {earlierPrereqs.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-muted hover:text-accent">
                Show {earlierPrereqs.length} earlier {earlierPrereqs.length === 1 ? "lesson" : "lessons"}
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {earlierPrereqs.map((l) => (
                  <LessonChip key={l.id} lesson={l} showLevel={l.level !== meta.level} />
                ))}
              </div>
            </details>
          )}
        </aside>
      )}

      {isFreeLevel(meta.level) ? (
        // A1 and A2: no request data, so the whole lesson is prerendered as before.
        <LessonBody access={grantFreeAccess(meta)} />
      ) : (
        // Other levels: checked on the server at request time; the static shell holds only the skeleton.
        <Suspense fallback={<LessonBodySkeleton />}>
          <GatedLessonBody meta={meta} />
        </Suspense>
      )}

      {(links.prev || links.next) && (
        <nav className="mt-14 grid gap-4 border-t border-border pt-8 sm:grid-cols-2">
          {links.prev ? (
            <PrevNextCard lesson={links.prev} label="← Previous" current={meta} />
          ) : (
            <div className="hidden sm:block" />
          )}
          {links.next && <PrevNextCard lesson={links.next} label="Next →" current={meta} alignRight />}
        </nav>
      )}

      {(links.unlocks.length > 0 || links.related.length > 0 || links.relatedPlanned.length > 0 || links.sameTopic.length > 0) && (
        <div className="mt-14 border-t border-border pt-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Keep exploring</p>
          <div className="mt-6 space-y-10">
            <ConnectionSection
              title="Builds on this"
              hint="This lesson unlocks these. They list it as a prerequisite."
              lessons={links.unlocks}
              maxShown={5}
              showLevel
            />
            <ConnectionSection
              title="Related lessons"
              hint="Connected, but not required."
              lessons={links.related}
              planned={links.relatedPlanned}
              showLevel
            />
            <ConnectionSection
              title="More on this topic"
              hint="Other lessons that share a topic with this one."
              lessons={links.sameTopic}
              showLevel
            />
          </div>
        </div>
      )}
    </main>
  );
}

function PrevNextCard({
  lesson,
  label,
  current,
  alignRight,
}: {
  lesson: LessonMeta;
  label: string;
  current: LessonMeta;
  alignRight?: boolean;
}) {
  // Say so when the link crosses into another level or unit.
  const context =
    lesson.level !== current.level
      ? `${lesson.level} · ${lesson.unit}`
      : lesson.unit !== current.unit
        ? lesson.unit
        : null;
  return (
    <Link
      href={lesson.href}
      className={`group rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-sm ${alignRight ? "sm:text-right" : ""}`}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <p className="mt-1 font-serif text-lg font-semibold group-hover:text-accent">{lesson.title}</p>
      {context && <p className="mt-0.5 text-xs text-muted">{context}</p>}
    </Link>
  );
}
