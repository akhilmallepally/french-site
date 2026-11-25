// Learner progress: the types, the local (browser-only) store and the update rules both stores
// share. lib/progress.ts re-exports all of it and picks the store (lib/progress-store.ts).
// Everything is keyed by stable ids, never by title or slug. Only call a store from effects or
// event handlers, never during render.
import type { AnswerStatus } from "./check-answer";

export type ExerciseProgress = {
  attempts: number;
  correct: number;
  lastResult: AnswerStatus;
  lastAttemptedAt: string; // ISO timestamp
};

export type LessonProgress = {
  bestScore: number;
  bestTotal: number;
  lastCompletedAt: string; // ISO timestamp of the last full run
  /**
   * When the lesson was first completed (a run reached the pass mark). Only ever moves earlier.
   * Optional: records saved before it existed don't have it, and it is never invented on load.
   */
  completedAt?: string;
};

/**
 * A C2 writing task: only that it was marked done and which self-check items were ticked.
 * Never the learner's text: that stays as a local draft (lib/writing-draft.ts) and is never
 * stored here, so no future store (Supabase included) ever receives it.
 */
export type WritingTaskProgress = {
  done: boolean;
  checked: number[]; // indices of the ticked checklist items
  doneAt: string; // ISO timestamp
};

export type ProgressData = {
  exercises: Record<string, ExerciseProgress>; // by exercise id
  lessons: Record<string, LessonProgress>; // by lesson id
  writingTasks?: Record<string, WritingTaskProgress>; // by exercise id (optional: older saves lack it)
};

export interface ProgressStore {
  getLessonProgress(lessonId: string): Promise<LessonProgress | null>;
  /** Records one answered exercise. */
  recordAttempt(exerciseId: string, result: AnswerStatus): Promise<void>;
  /** Records a finished full run of a lesson, keeping the best score. Returns the updated progress. */
  recordRun(lessonId: string, score: number, total: number): Promise<LessonProgress>;
  /** Records a writing task as done, with the ticked checklist items. Takes no text, by design. */
  recordWritingTask(exerciseId: string, checked: number[]): Promise<WritingTaskProgress>;
  getWritingTask(exerciseId: string): Promise<WritingTaskProgress | null>;
  getAll(): Promise<ProgressData>;
  reset(): Promise<void>;
}

const COMPLETED_AT = 0.8;

export function isCompleted(lesson: LessonProgress | null | undefined): boolean {
  return !!lesson && lesson.bestTotal > 0 && lesson.bestScore / lesson.bestTotal >= COMPLETED_AT;
}

/**
 * The first-completion time after a run at `now`. Kept once set: runs only happen later, so it
 * never moves later. A record saved before completedAt existed whose best already passed keeps its
 * last run time, about to be overwritten, as the completion date: the lesson was already complete
 * then. That's the same date the import rule uses for old records (docs/plans/progress.md,
 * section 8), and it's never a made-up time. Otherwise it's this run's time if this run passes.
 */
export function firstCompletion(previous: LessonProgress | undefined, score: number, total: number, now: string): string | undefined {
  if (previous?.completedAt) return previous.completedAt;
  if (previous && isCompleted(previous)) return previous.lastCompletedAt;
  return isCompleted({ bestScore: score, bestTotal: total, lastCompletedAt: now }) ? now : undefined;
}

// ---------- Update rules (the local store and the synced store's cache both use these) ----------

/** One more answer: counts go up by one, the result and time are this answer's. */
export function nextAttempt(previous: ExerciseProgress | undefined, result: AnswerStatus, now: string): ExerciseProgress {
  return {
    attempts: (previous?.attempts ?? 0) + 1,
    correct: (previous?.correct ?? 0) + (result === "incorrect" ? 0 : 1),
    lastResult: result,
    lastAttemptedAt: now,
  };
}

/** A finished full run: a strictly higher ratio replaces the best; the last run moves on. */
export function nextRun(previous: LessonProgress | undefined, score: number, total: number, now: string): LessonProgress {
  const beatsBest = !previous || score / total > previous.bestScore / previous.bestTotal;
  const updated: LessonProgress = {
    bestScore: beatsBest ? score : previous.bestScore,
    bestTotal: beatsBest ? total : previous.bestTotal,
    lastCompletedAt: now,
  };
  const completedAt = firstCompletion(previous, score, total, now);
  if (completedAt) updated.completedAt = completedAt;
  return updated;
}

/** "Mark as done": ticks deduplicated and sorted, never any text. */
export function nextWriting(checked: number[], now: string): WritingTaskProgress {
  return {
    done: true,
    checked: [...new Set(checked)].filter((i) => Number.isInteger(i) && i >= 0).sort((a, b) => a - b),
    doneAt: now,
  };
}

/** The anonymous (signed-out) progress of this browser. */
export const STORAGE_KEY = "parlons-progress-v1";
const empty = (): ProgressData => ({ exercises: {}, lessons: {} });

function read(): ProgressData {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (parsed?.exercises && parsed?.lessons) return parsed;
  } catch {
    // Storage blocked (private mode) or corrupted data: start empty.
  }
  return empty();
}

function write(data: ProgressData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage blocked or full: progress just isn't saved.
  }
}

/** Signed out, sync off or Supabase not configured: everything stays in this browser. */
export class LocalProgressStore implements ProgressStore {
  async getLessonProgress(lessonId: string) {
    return read().lessons[lessonId] ?? null;
  }

  async recordAttempt(exerciseId: string, result: AnswerStatus) {
    const data = read();
    data.exercises[exerciseId] = nextAttempt(data.exercises[exerciseId], result, new Date().toISOString());
    write(data);
  }

  async recordRun(lessonId: string, score: number, total: number) {
    const data = read();
    const updated = nextRun(data.lessons[lessonId], score, total, new Date().toISOString());
    data.lessons[lessonId] = updated;
    write(data);
    return updated;
  }

  async recordWritingTask(exerciseId: string, checked: number[]) {
    const data = read();
    const entry = nextWriting(checked, new Date().toISOString());
    data.writingTasks = { ...(data.writingTasks ?? {}), [exerciseId]: entry };
    write(data);
    return entry;
  }

  async getWritingTask(exerciseId: string) {
    return read().writingTasks?.[exerciseId] ?? null;
  }

  async getAll() {
    return read();
  }

  async reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage blocked: nothing to clear.
    }
  }
}

