"use client";

import { useEffect, useState } from "react";
import { isCompleted, progressStore, type ProgressData } from "@/lib/progress";

/** Loads progress after mount, and again whenever a preserved route becomes visible. */
function useProgress(): ProgressData | null {
  const [data, setData] = useState<ProgressData | null>(null);
  useEffect(() => {
    let active = true;
    progressStore.getAll().then((all) => {
      if (active) setData(all);
    });
    return () => {
      active = false;
    };
  }, []);
  return data;
}

/** Completed badge and best score for one lesson row. Renders nothing until attempted. */
export function LessonStatus({ lessonId }: { lessonId: string }) {
  const lesson = useProgress()?.lessons[lessonId];
  if (!lesson) return null;
  const score = `${lesson.bestScore} / ${lesson.bestTotal}`;
  return isCompleted(lesson) ? (
    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
      ✓ Completed · {score}
    </span>
  ) : (
    <span className="rounded-full bg-background px-2.5 py-0.5 text-xs font-medium text-muted">Best {score}</span>
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
