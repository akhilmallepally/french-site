// Small presentational pieces shared by the lesson pages.
import Link from "next/link";
import type { LessonMeta, LessonType, PlannedLesson } from "@/lib/lessons";

export function ComingSoon({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-block select-none whitespace-nowrap rounded-full bg-border/60 px-2 py-0.5 align-middle text-[0.7rem] font-medium leading-none text-muted not-italic ${className}`}>
      Coming soon
    </span>
  );
}

const typeLabels: Record<LessonType, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  communication: "Communication",
  culture: "Culture",
  review: "Review",
};

const typeStyles: Record<LessonType, string> = {
  grammar: "bg-indigo-50 text-indigo-700",
  vocabulary: "bg-emerald-50 text-emerald-700",
  communication: "bg-orange-50 text-orange-700",
  culture: "bg-rose-50 text-rose-700",
  review: "bg-stone-100 text-stone-600",
};

export function TypeBadge({ type }: { type: LessonType }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${typeStyles[type]}`}>{typeLabels[type]}</span>
  );
}

/** A compact link card for one lesson, used in the connection lists. */
export function LessonChip({ lesson, showLevel }: { lesson: LessonMeta; showLevel?: boolean }) {
  return (
    <Link
      href={lesson.href}
      className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition hover:border-accent/40 hover:shadow-sm"
    >
      <span className="min-w-0">
        <span className="block truncate font-serif text-[1.05rem] font-semibold group-hover:text-accent">
          {lesson.title}
        </span>
        <span className="block truncate text-xs text-muted">
          {showLevel ? `${lesson.level} · ` : ""}
          {lesson.unit}
        </span>
      </span>
      <TypeBadge type={lesson.type} />
    </Link>
  );
}

/** Same shape as LessonChip, but not a link: the lesson is in the syllabus and not written yet. */
export function PlannedChip({ lesson, showLevel }: { lesson: PlannedLesson; showLevel?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-card/50 px-4 py-3">
      <span className="min-w-0">
        <span className="block truncate font-serif text-[1.05rem] font-semibold text-muted">{lesson.title}</span>
        <span className="block truncate text-xs text-muted">
          {showLevel ? `${lesson.level} · ` : ""}
          {lesson.unit}
        </span>
      </span>
      <ComingSoon />
    </div>
  );
}

export function ConnectionSection({
  title,
  hint,
  lessons,
  planned = [],
  showLevel,
  maxShown,
}: {
  title: string;
  hint: string;
  lessons: LessonMeta[];
  planned?: PlannedLesson[];
  showLevel?: boolean;
  maxShown?: number;
}) {
  if (!lessons.length && !planned.length) return null;
  const shown = maxShown === undefined ? lessons : lessons.slice(0, maxShown);
  const hidden = maxShown === undefined ? [] : lessons.slice(maxShown);
  return (
    <section>
      <h2 className="font-serif text-xl font-semibold">{title}</h2>
      <p className="mt-0.5 text-sm text-muted">{hint}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {shown.map((l) => (
          <LessonChip key={l.id} lesson={l} showLevel={showLevel} />
        ))}
        {planned.map((p) => (
          <PlannedChip key={p.id} lesson={p} showLevel={showLevel} />
        ))}
      </div>
      {hidden.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted hover:text-accent">Show {hidden.length} more</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {hidden.map((l) => (
              <LessonChip key={l.id} lesson={l} showLevel={showLevel} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
