import type { Metadata } from "next";
import { ProgressDashboard } from "@/components/progress-dashboard";
import { getAllLessons, getProgressIndex, isFreeLevel, LEVEL_INFO, LEVELS } from "@/lib/lessons";
import type { CatalogueLesson } from "@/lib/progress-summary";

// Personal, so never indexed (and not in the sitemap).
export const metadata: Metadata = {
  title: "Your progress",
  description: "Your French Properly progress: where to continue, each level and unit, and lessons to revisit.",
  robots: { index: false, follow: true },
};

/**
 * Prerendered for everyone: the server part is the public lesson catalogue (metadata only, as on
 * the level pages); the learner's progress is read in the browser by ProgressDashboard, so the page
 * reads no cookies. The catalogue is a slim list, not the content index.
 */
export default function ProgressPage() {
  const index = getProgressIndex();
  const catalogue: CatalogueLesson[] = getAllLessons().map((l) => {
    const writingTask = index.lessons[l.id]?.writingTask;
    return { id: l.id, title: l.title, href: l.href, level: l.level, unit: l.unit, type: l.type, free: isFreeLevel(l.level), ...(writingTask ? { writingTask } : {}) };
  });
  const levelNames = Object.fromEntries(LEVELS.map((level) => [level, LEVEL_INFO[level].name]));

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-serif text-4xl font-semibold tracking-tight">Your progress</h1>
      <ProgressDashboard catalogue={catalogue} levelNames={levelNames} />
    </main>
  );
}
