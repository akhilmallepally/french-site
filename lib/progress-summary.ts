// The figures on /progress (docs/plans/progress.md, section 9), from the lesson catalogue and the
// learner's progress. Pure: no I/O, no React. Ids in progress that aren't in the catalogue (a lesson
// removed or renamed) are ignored.
import { isCompleted, type ProgressData } from "./progress-core.ts";

/** What the dashboard needs per lesson: metadata only, the same as the public level pages show. */
export type CatalogueLesson = {
  id: string;
  title: string;
  href: string;
  level: string; // "A1" … "C2"
  unit: string;
  type: string; // grammar, vocabulary, communication, culture, review
  free: boolean; // A1 and A2; a paid lesson's link leads to the usual sign-in or paywall panel
  writingTask?: string; // the C2 writing task's exercise id
};

export type LessonActivity = { lesson: CatalogueLesson; at: string };

export type Summary = {
  /** No known lesson has any answer, run or writing record. */
  empty: boolean;
  /** The lesson practised last (latest answer, run or writing task marked done). */
  continueWith: LessonActivity | null;
  levels: { level: string; completed: number; total: number; units: { name: string; completed: number; total: number }[] }[];
  /** Practised but not completed, most recent first, at most 10. */
  started: LessonActivity[];
  /** Review lessons attempted but not completed, or not run yet although the rest of their unit is completed. */
  review: { lesson: CatalogueLesson; reason: "unfinished" | "unit-done" }[];
  /** C2 writing tasks: marked done or not. Status only, never text. */
  writing: { done: number; total: number; tasks: { lesson: CatalogueLesson; done: boolean; doneAt?: string }[] };
};

const MAX_STARTED = 10;
const ms = (t: string | undefined) => (t ? Date.parse(t) : Number.NaN);
const lessonIdOf = (exerciseId: string) => exerciseId.replace(/-ex\d+$/, "");

/** The latest activity time per known lesson id. */
function lastActivity(catalogue: Map<string, CatalogueLesson>, writingOwner: Map<string, string>, data: ProgressData): Map<string, string> {
  const latest = new Map<string, string>();
  const note = (lessonId: string | undefined, at: string | undefined) => {
    if (!lessonId || !catalogue.has(lessonId) || !Number.isFinite(ms(at))) return;
    const prev = latest.get(lessonId);
    if (!prev || ms(at) > ms(prev)) latest.set(lessonId, at!);
  };
  for (const [id, e] of Object.entries(data.exercises ?? {})) note(lessonIdOf(id), e?.lastAttemptedAt);
  for (const [id, l] of Object.entries(data.lessons ?? {})) note(id, l?.lastCompletedAt);
  for (const [id, w] of Object.entries(data.writingTasks ?? {})) if (w?.done) note(writingOwner.get(id) ?? lessonIdOf(id), w.doneAt);
  return latest;
}

/** `catalogue` in course order (as getAllLessons returns it). */
export function summarize(catalogue: CatalogueLesson[], data: ProgressData): Summary {
  const byId = new Map(catalogue.map((l) => [l.id, l]));
  const writingOwner = new Map(catalogue.filter((l) => l.writingTask).map((l) => [l.writingTask!, l.id]));
  const done = (id: string) => isCompleted(data.lessons?.[id]);
  const activity = lastActivity(byId, writingOwner, data);

  const recent = [...activity].map(([id, at]) => ({ lesson: byId.get(id)!, at })).sort((a, b) => ms(b.at) - ms(a.at) || (a.lesson.id < b.lesson.id ? -1 : 1));

  const levels: Summary["levels"] = [];
  for (const l of catalogue) {
    let level = levels.at(-1);
    if (!level || level.level !== l.level) levels.push((level = { level: l.level, completed: 0, total: 0, units: [] }));
    let unit = level.units.at(-1);
    if (!unit || unit.name !== l.unit) level.units.push((unit = { name: l.unit, completed: 0, total: 0 }));
    level.total++;
    unit.total++;
    if (done(l.id)) {
      level.completed++;
      unit.completed++;
    }
  }

  const review: Summary["review"] = [];
  for (const l of catalogue) {
    if (l.type !== "review" || done(l.id)) continue;
    if (activity.has(l.id)) {
      review.push({ lesson: l, reason: "unfinished" });
      continue;
    }
    const unitmates = catalogue.filter((o) => o.level === l.level && o.unit === l.unit && o.id !== l.id);
    if (!data.lessons?.[l.id] && unitmates.length > 0 && unitmates.every((o) => done(o.id))) review.push({ lesson: l, reason: "unit-done" });
  }

  const tasks = catalogue
    .filter((l) => l.writingTask)
    .map((l) => {
      const w = data.writingTasks?.[l.writingTask!];
      return w?.done ? { lesson: l, done: true, doneAt: w.doneAt } : { lesson: l, done: false };
    });

  return {
    empty: activity.size === 0,
    continueWith: recent[0] ?? null,
    levels,
    started: recent.filter((r) => !done(r.lesson.id)).slice(0, MAX_STARTED),
    review,
    writing: { done: tasks.filter((t) => t.done).length, total: tasks.length, tasks },
  };
}
