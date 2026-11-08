// Learner progress, behind an interface so localStorage can be swapped for Supabase later.
// The methods are async because a database will be. Everything is keyed by stable ids,
// never by title or slug. Only call this from effects or event handlers, never during render.
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
};

export type ProgressData = {
  exercises: Record<string, ExerciseProgress>; // by exercise id
  lessons: Record<string, LessonProgress>; // by lesson id
};

export interface ProgressStore {
  getLessonProgress(lessonId: string): Promise<LessonProgress | null>;
  /** Records one answered exercise. */
  recordAttempt(exerciseId: string, result: AnswerStatus): Promise<void>;
  /** Records a finished full run of a lesson, keeping the best score. Returns the updated progress. */
  recordRun(lessonId: string, score: number, total: number): Promise<LessonProgress>;
  getAll(): Promise<ProgressData>;
  reset(): Promise<void>;
}

const COMPLETED_AT = 0.8;

export function isCompleted(lesson: LessonProgress | null | undefined): boolean {
  return !!lesson && lesson.bestTotal > 0 && lesson.bestScore / lesson.bestTotal >= COMPLETED_AT;
}

const STORAGE_KEY = "parlons-progress-v1";
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

class LocalProgressStore implements ProgressStore {
  async getLessonProgress(lessonId: string) {
    return read().lessons[lessonId] ?? null;
  }

  async recordAttempt(exerciseId: string, result: AnswerStatus) {
    const data = read();
    const previous = data.exercises[exerciseId];
    data.exercises[exerciseId] = {
      attempts: (previous?.attempts ?? 0) + 1,
      correct: (previous?.correct ?? 0) + (result === "incorrect" ? 0 : 1),
      lastResult: result,
      lastAttemptedAt: new Date().toISOString(),
    };
    write(data);
  }

  async recordRun(lessonId: string, score: number, total: number) {
    const data = read();
    const previous = data.lessons[lessonId];
    const beatsBest = !previous || score / total > previous.bestScore / previous.bestTotal;
    const updated: LessonProgress = {
      bestScore: beatsBest ? score : previous.bestScore,
      bestTotal: beatsBest ? total : previous.bestTotal,
      lastCompletedAt: new Date().toISOString(),
    };
    data.lessons[lessonId] = updated;
    write(data);
    return updated;
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

export const progressStore: ProgressStore = new LocalProgressStore();
