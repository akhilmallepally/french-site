// The /practice index: the review lessons that already exist, by level and unit, in course order.
// Pure: no I/O and no React, shared by app/practice (the page), components/progress-dashboard.tsx
// (links to the unit sections) and lib/practice.test.ts.
//
// Review lessons are found by the content's own lesson type ("review"), never by slug. A level's
// review is the review lesson that is the level's last lesson in course order (A1 to B2 end with one;
// C1 and C2 end with a unit review and then the level review). Every other review lesson is the
// review of its unit.
import type { CatalogueLesson } from "./progress-summary.ts";

export type PracticeLesson = CatalogueLesson & { exercises: number };
export type PracticeUnit = { name: string; anchor: string; review: PracticeLesson | null };
export type PracticeLevel = { level: string; anchor: string; free: boolean; units: PracticeUnit[]; levelReview: PracticeLesson | null };

/** "Home, money and problems" → "home-money-and-problems". */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "A1" → "a1": the level's section on /practice. */
export const levelAnchor = (level: string) => level.toLowerCase();
/** ("A1", "Getting started") → "a1-getting-started": the unit's section on /practice. */
export const unitAnchor = (level: string, unit: string) => `${levelAnchor(level)}-${slugify(unit)}`;
/** The level review's entry on /practice. */
export const levelReviewAnchor = (level: string) => `${levelAnchor(level)}-level-review`;
/** Where a lesson's exercises start (components/exercise-player.tsx). */
export const practiceHref = (href: string) => `${href}#practice`;
/** Where a lesson's C2 writing task starts (components/writing-task.tsx). */
export const writingTaskHref = (href: string) => `${href}#writing-task`;

/** `catalogue` in course order (as getAllLessons returns it). */
export function buildPracticeIndex(catalogue: PracticeLesson[]): PracticeLevel[] {
  const levels: PracticeLevel[] = [];
  for (const lesson of catalogue) {
    let level = levels.at(-1);
    if (!level || level.level !== lesson.level) {
      levels.push((level = { level: lesson.level, anchor: levelAnchor(lesson.level), free: lesson.free, units: [], levelReview: null }));
    }
    let unit = level.units.at(-1);
    if (!unit || unit.name !== lesson.unit) level.units.push((unit = { name: lesson.unit, anchor: unitAnchor(lesson.level, lesson.unit), review: null }));
  }
  for (const level of levels) {
    const lessons = catalogue.filter((l) => l.level === level.level);
    const last = lessons.at(-1);
    if (last?.type === "review") level.levelReview = last;
    for (const unit of level.units) {
      const reviews = lessons.filter((l) => l.unit === unit.name && l.type === "review" && l !== level.levelReview);
      unit.review = reviews.at(-1) ?? null;
    }
  }
  return levels;
}

/** Every review lesson the index lists (unit reviews and level reviews), for tests and counts. */
export function listedReviews(levels: PracticeLevel[]): PracticeLesson[] {
  return levels.flatMap((l) => [...l.units.map((u) => u.review).filter((r): r is PracticeLesson => !!r), ...(l.levelReview ? [l.levelReview] : [])]);
}
