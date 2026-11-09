import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link from "next/link";
import { ComingSoon } from "@/components/lesson-ui";
import { getLessonById, getPlannedLesson, type VocabItem } from "@/lib/lessons";

/**
 * Shows a lesson's vocab (from its frontmatter). In MDX it's written as <VocabTable /> or
 * <VocabTable group="…" />; the lesson page supplies `items`, so MDX never passes data.
 */
export function VocabTable({ items, group }: { items: VocabItem[]; group?: string }) {
  const rows = group ? items.filter((v) => v.group === group) : items;
  return (
    <div className="not-prose my-6 overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[28rem] border-collapse text-left text-[0.95rem]">
        <thead className="bg-background">
          <tr>
            {["French", "Pronunciation", "English"].map((h) => (
              <th key={h} className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-b border-border last:border-b-0">
              <td lang="fr" className="px-4 py-3 align-top font-serif text-lg">
                {v.fr}
              </td>
              <td className="px-4 py-3 align-top text-muted">{v.pron}</td>
              <td className="px-4 py-3 align-top">
                {v.en}
                {v.note && <span className="mt-0.5 block text-sm text-muted">{v.note}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Links to a lesson by its stable id, so in-text links survive slug and title changes.
 * A lesson that's planned in the syllabus but not written yet renders as plain text
 * with a "Coming soon" label, and becomes a link automatically once its file exists.
 */
export function LessonLink({ id, text, children }: { id: string; text?: string; children?: ReactNode }) {
  const label = text ?? children;
  const lesson = getLessonById(id);
  if (!lesson) {
    const planned = getPlannedLesson(id);
    if (planned) {
      return (
        <span>
          {label ?? planned.title}
          <ComingSoon className="ml-1.5" />
        </span>
      );
    }
    // validate-content catches this before a build; this is just a visible fallback in dev.
    return <span className="text-red-700 underline decoration-wavy" title={`Unknown lesson id: ${id}`}>{label ?? id}</span>;
  }
  return <Link href={lesson.href}>{label ?? lesson.title}</Link>;
}

type CalloutType = "tip" | "warning" | "note";

const calloutStyles: Record<CalloutType, { box: string; title: string; label: string }> = {
  tip: { box: "border-emerald-200 bg-emerald-50", title: "text-emerald-800", label: "Tip" },
  warning: { box: "border-amber-200 bg-amber-50", title: "text-amber-800", label: "Watch out" },
  note: { box: "border-sky-200 bg-sky-50", title: "text-sky-800", label: "Note" },
};

export function Callout({
  type = "note",
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
}) {
  const s = calloutStyles[type] ?? calloutStyles.note;
  return (
    <aside className={`not-prose my-6 rounded-xl border px-5 py-4 ${s.box}`}>
      <p className={`text-sm font-semibold ${s.title}`}>{title ?? s.label}</p>
      <div className="mt-1 text-[0.95rem] leading-relaxed text-foreground [&_strong]:font-semibold [&_p+p]:mt-2">
        {children}
      </div>
    </aside>
  );
}

export function Example({ fr, en }: { fr: string; en: string }) {
  return (
    <div className="not-prose my-3 rounded-xl border border-border bg-card px-5 py-4">
      <p lang="fr" className="font-serif text-xl text-foreground">
        {fr}
      </p>
      <p className="mt-1 text-sm text-muted">{en}</p>
    </div>
  );
}

export const mdxComponents = {
  Callout,
  Example,
  LessonLink,
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="not-prose my-6 overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[28rem] border-collapse text-left text-[0.95rem]" {...props} />
    </div>
  ),
  thead: (props: ComponentPropsWithoutRef<"thead">) => (
    <thead className="bg-background" {...props} />
  ),
  th: (props: ComponentPropsWithoutRef<"th">) => (
    <th
      className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted"
      {...props}
    />
  ),
  td: (props: ComponentPropsWithoutRef<"td">) => (
    <td
      className="border-b border-border px-4 py-3 align-top [tr:last-child_&]:border-b-0 first:font-serif first:text-lg"
      {...props}
    />
  ),
};
