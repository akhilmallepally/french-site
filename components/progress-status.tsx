"use client";

import { useEffect, useState } from "react";
import { isCompleted, progressStore, type ProgressData } from "@/lib/progress";

/**
 * Loads progress after mount, and again whenever the stored copy changes (the server's copy
 * arriving, an import, another account signing in). Never waits for the network.
 */
function useProgress(): ProgressData | null {
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
  return data;
}

/**
 * Completed badge and best score for one lesson row. Its slot is always there, as tall as a badge
 * and as wide as the widest one ("✓ Completed · 16 / 16"), so a badge appearing later (local data
 * after mount, or the server's copy) shifts nothing, on narrow screens too.
 */
export function LessonStatus({ lessonId }: { lessonId: string }) {
  const lesson = useProgress()?.lessons[lessonId];
  const score = lesson ? `${lesson.bestScore} / ${lesson.bestTotal}` : "";
  return (
    <span className="inline-flex h-5 min-w-[10.5rem] items-center">
      {lesson &&
        (isCompleted(lesson) ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">✓ Completed · {score}</span>
        ) : (
          <span className="rounded-full bg-background px-2.5 py-0.5 text-xs font-medium text-muted">Best {score}</span>
        ))}
    </span>
  );
}

/** "3 / 10 completed" for a level card. */
export function LevelCompletion({ lessonIds }: { lessonIds: string[] }) {
  const data = useProgress();
  return (
    <p className="mt-auto min-h-5 pt-3 text-sm font-medium text-muted">
      {data && `${lessonIds.filter((id) => isCompleted(data.lessons[id])).length} / ${lessonIds.length} completed`}
    </p>
  );
}
