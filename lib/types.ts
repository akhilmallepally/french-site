// Content types shared by server code, client components and scripts.
// No Node imports here, so client components can use it.

/** A word or phrase taught in a lesson. `id` is permanent (e.g. "a1-numbers-0-20-v001"). */
export type VocabItem = {
  id: string;
  fr: string;
  pron: string; // simple respelling for English speakers; the only place respellings go
  en: string;
  group?: string; // lets a lesson show several smaller <VocabTable group="…" /> tables
  note?: string;
};

export const EXERCISE_TYPES = ["multiple-choice", "fill-in", "translate", "reorder"] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

/**
 * Fields every practice item has. `id` is permanent (e.g. "a1-numbers-0-20-ex001").
 * `answers` lists genuinely different phrasings only; see "Lesson writing rules" in
 * CLAUDE.md and lib/check-answer.ts for what gets normalized.
 */
type ExerciseBase = {
  id: string;
  prompt: string;
  answers: string[];
  explanation: string;
  strictAccents?: boolean; // dropping the accent gives a different valid word, so it counts as wrong
};

export type MultipleChoiceExercise = ExerciseBase & {
  type: "multiple-choice";
  options: string[]; // every answer must be one of these
};
export type FillInExercise = ExerciseBase & { type: "fill-in" }; // the prompt marks the gap with ___
export type TranslateExercise = ExerciseBase & { type: "translate" };
export type ReorderExercise = ExerciseBase & {
  type: "reorder";
  words: string[]; // each answer must use exactly these words
};

export type Exercise = MultipleChoiceExercise | FillInExercise | TranslateExercise | ReorderExercise;
