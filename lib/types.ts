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

export const EXERCISE_TYPES = [
  "multiple-choice", "fill-in", "translate", "reorder",
  // B2 and later (see "B2 conventions" in CLAUDE.md)
  "reformulation", "register-shift", "connector-choice", "error-correction",
] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

/** Types only allowed from B2 on. */
export const B2_EXERCISE_TYPES: readonly ExerciseType[] = ["reformulation", "register-shift", "connector-choice", "error-correction"];
/** Types where the learner picks from `options`. */
export const OPTION_TYPES: readonly ExerciseType[] = ["multiple-choice", "connector-choice"];
/** Types where the learner types a whole answer in a text box (fill-in has its own gap input). */
export const TYPED_TYPES: readonly ExerciseType[] = ["translate", "reformulation", "register-shift", "error-correction"];

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

/** B2: rewrite a sentence with a given structure; typed, graded against `answers`. */
export type ReformulationExercise = ExerciseBase & { type: "reformulation" };
/** B2: rewrite a sentence in another register (formal ↔ informal); typed. */
export type RegisterShiftExercise = ExerciseBase & { type: "register-shift" };
/** B2: pick the connector that fits the gap (___) in the prompt. */
export type ConnectorChoiceExercise = ExerciseBase & {
  type: "connector-choice";
  options: string[]; // every answer must be one of these
};
/** B2: retype the sentence with its mistake corrected; typed. */
export type ErrorCorrectionExercise = ExerciseBase & { type: "error-correction" };

export type Exercise =
  | MultipleChoiceExercise | FillInExercise | TranslateExercise | ReorderExercise
  | ReformulationExercise | RegisterShiftExercise | ConnectorChoiceExercise | ErrorCorrectionExercise;
