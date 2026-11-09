"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { checkAnswer, checkChoice, type AnswerResult, type AnswerStatus } from "@/lib/check-answer";
import { isCompleted, progressStore, type LessonProgress } from "@/lib/progress";
import type { Exercise } from "@/lib/types";

const FRENCH_CHARACTERS = ["é", "è", "ê", "ë", "à", "â", "ç", "î", "ï", "ô", "œ", "ù", "û", "ü"];

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const primaryButton = `min-h-11 rounded-full bg-accent px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;
const secondaryButton = `min-h-11 rounded-full border border-border bg-card px-5 py-2.5 font-medium transition hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;

type Chip = { key: number; word: string };
/** One exercise with its display order fixed for this run. */
type Item = { exercise: Exercise; options: string[]; chips: Chip[] };
type Run = {
  id: number; // changes on every new run, to reset the question state
  mode: "full" | "retry";
  items: Item[];
  index: number;
  results: Record<string, AnswerStatus>;
  finished: boolean;
};

function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function shuffledChips(words: string[]): Chip[] {
  const chips = words.map((word, key) => ({ key, word }));
  // Avoid handing the learner the solved sentence.
  for (let tries = 0; tries < 5; tries++) {
    const candidate = shuffle(chips);
    if (candidate.map((c) => c.word).join(" ") !== words.join(" ")) return candidate;
  }
  return shuffle(chips);
}

// Shuffles use Math.random, so runs are only ever created after mount, never during render.
function createRun(exercises: Exercise[], id: number, mode: Run["mode"]): Run {
  return {
    id,
    mode,
    index: 0,
    results: {},
    finished: false,
    items: exercises.map((exercise) => ({
      exercise,
      options: exercise.type === "multiple-choice" ? shuffle(exercise.options) : [],
      chips: exercise.type === "reorder" ? shuffledChips(exercise.words) : [],
    })),
  };
}

const scoreOf = (run: Run) => run.items.filter((i) => run.results[i.exercise.id] !== "incorrect").length;

export function ExercisePlayer({ lessonId, exercises }: { lessonId: string; exercises: Exercise[] }) {
  const [run, setRun] = useState<Run | null>(null);
  const [best, setBest] = useState<LessonProgress | null>(null);

  useEffect(() => {
    let active = true;
    progressStore.getLessonProgress(lessonId).then((progress) => {
      if (!active) return;
      setBest(progress);
      // Keep a run in progress when a preserved route becomes visible again.
      setRun((current) => current ?? createRun(exercises, 1, "full"));
    });
    return () => {
      active = false;
    };
  }, [lessonId, exercises]);

  if (exercises.length === 0) return null;

  function handleAnswered(exerciseId: string, status: AnswerStatus) {
    progressStore.recordAttempt(exerciseId, status);
    setRun((r) => r && { ...r, results: { ...r.results, [exerciseId]: status } });
  }

  function handleNext() {
    if (!run) return;
    if (run.index < run.items.length - 1) {
      setRun({ ...run, index: run.index + 1 });
      return;
    }
    setRun({ ...run, finished: true });
    // Only a full run counts towards the best score.
    if (run.mode === "full") progressStore.recordRun(lessonId, scoreOf(run), run.items.length).then(setBest);
  }

  return (
    <section id="practice" aria-labelledby="practice-heading" className="mt-16 border-t border-border pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="practice-heading" className="font-serif text-3xl font-semibold tracking-tight">
          Practice
        </h2>
        {best && (
          <p className="text-sm font-medium text-muted">
            {isCompleted(best) && <span className="text-emerald-800">✓ Completed · </span>}
            Best score {best.bestScore} / {best.bestTotal}
          </p>
        )}
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-7">
        {!run ? (
          <p className="py-10 text-center text-muted">Loading practice…</p>
        ) : run.finished ? (
          <EndScreen
            run={run}
            onRetry={() => {
              const missed = run.items.filter((i) => run.results[i.exercise.id] === "incorrect").map((i) => i.exercise);
              setRun(createRun(missed, run.id + 1, "retry"));
            }}
            onRestart={() => setRun(createRun(exercises, run.id + 1, "full"))}
          />
        ) : (
          <Question
            key={`${run.id}-${run.index}`}
            item={run.items[run.index]}
            number={run.index + 1}
            total={run.items.length}
            takeFocus={run.index > 0 || run.id > 1}
            onAnswered={handleAnswered}
            onNext={handleNext}
          />
        )}
      </div>
    </section>
  );
}

function Question({
  item,
  number,
  total,
  takeFocus,
  onAnswered,
  onNext,
}: {
  item: Item;
  number: number;
  total: number;
  takeFocus: boolean; // false on page load, so the page doesn't jump down to the exercise
  onAnswered: (exerciseId: string, status: AnswerStatus) => void;
  onNext: () => void;
}) {
  const { exercise } = item;
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Chip[]>([]);
  const [result, setResult] = useState<AnswerResult | null>(null);

  const rootRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const caret = useRef<{ position: number; refocus: boolean } | null>(null);

  const typed = exercise.type === "fill-in" || exercise.type === "translate";
  const checked = result !== null;
  const canCheck =
    exercise.type === "multiple-choice" ? picked !== null : exercise.type === "reorder" ? placed.length > 0 : text.trim() !== "";

  useEffect(() => {
    if (takeFocus) rootRef.current?.querySelector<HTMLElement>("input, button:not([disabled])")?.focus();
    // Only when this question first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move to Next once checked: the input is disabled now, and Enter must still advance.
  useEffect(() => {
    if (result) nextRef.current?.focus();
  }, [result]);

  // Restore the caret after an accent button changes the text.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !caret.current) return;
    if (caret.current.refocus) el.focus();
    el.setSelectionRange(caret.current.position, caret.current.position);
    caret.current = null;
  }, [text]);

  function check(choice: string | null = picked) {
    if (checked) return;
    let outcome: AnswerResult;
    if (exercise.type === "multiple-choice") {
      if (choice === null) return;
      outcome = checkChoice(choice, exercise.answers);
    } else if (exercise.type === "reorder") {
      outcome = checkAnswer(placed.map((c) => c.word).join(" "), exercise.answers, exercise.strictAccents);
    } else {
      outcome = checkAnswer(text, exercise.answers, exercise.strictAccents);
    }
    setResult(outcome);
    onAnswered(exercise.id, outcome.status);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (checked) onNext();
    else if (canCheck) check();
  }

  function insertCharacter(character: string, event: MouseEvent) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    // event.detail is 0 for keyboard clicks: leave focus on the button so people can type several.
    caret.current = { position: start + character.length, refocus: event.detail !== 0 };
    setText(text.slice(0, start) + character + text.slice(end));
  }

  /** After a chip moves, its button is gone: keep keyboard users in the word bank. */
  function refocusAfterChip() {
    requestAnimationFrame(() => {
      const root = rootRef.current;
      root?.querySelector<HTMLElement>("[data-word-bank] button, button[type=submit]")?.focus();
    });
  }

  const inputProps = {
    ref: inputRef,
    value: text,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    disabled: checked,
    lang: "fr",
    autoCapitalize: "off",
    autoCorrect: "off",
    autoComplete: "off",
    spellCheck: false,
  } as const;
  const inputClass = `rounded-xl border border-border bg-background px-3 py-2 font-serif text-lg disabled:opacity-70 ${focusRing}`;

  const available = item.chips.filter((chip) => !placed.some((p) => p.key === chip.key));

  return (
    <form ref={rootRef} onSubmit={handleSubmit}>
      <div className="flex items-center justify-between gap-3 text-sm text-muted">
        <span>
          Question {number} of {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Practice progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={number}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-background"
      >
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(number / total) * 100}%` }} />
      </div>

      {exercise.type === "fill-in" ? (
        <FillInPrompt prompt={exercise.prompt} input={<input {...inputProps} aria-label="Your answer" className={`${inputClass} w-36 max-w-full`} />} />
      ) : (
        <p className="mt-6 font-serif text-xl leading-snug font-semibold sm:text-2xl">{exercise.prompt}</p>
      )}

      {exercise.type === "translate" && (
        <input {...inputProps} aria-label="Your answer" className={`${inputClass} mt-4 w-full`} />
      )}

      {typed && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Insert a French character">
          {FRENCH_CHARACTERS.map((character) => (
            <button
              key={character}
              type="button"
              disabled={checked}
              aria-label={`Insert ${character}`}
              // Keeps the input focused, so the caret position survives a mouse or touch press.
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => insertCharacter(character, e)}
              className={`h-11 w-11 rounded-lg border border-border bg-background font-serif text-lg transition hover:border-accent/40 disabled:opacity-40 ${focusRing}`}
            >
              {character}
            </button>
          ))}
        </div>
      )}

      {exercise.type === "multiple-choice" && (
        <div className="mt-4 grid gap-2">
          {item.options.map((option) => {
            const isPicked = picked === option;
            const isRight = checked && exercise.answers.includes(option);
            const isWrong = checked && isPicked && !isRight;
            return (
              <button
                key={option}
                type="button"
                disabled={checked}
                aria-pressed={isPicked}
                // Selecting an already selected option checks it, so Enter, Enter works from the keyboard.
                onClick={() => (isPicked ? check(option) : setPicked(option))}
                className={`min-h-12 rounded-xl border px-4 py-2.5 text-left transition ${focusRing} ${
                  isRight
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : isWrong
                      ? "border-rose-300 bg-rose-50 text-rose-900"
                      : isPicked
                        ? "border-accent bg-accent/5"
                        : "border-border bg-background hover:border-accent/40"
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      )}

      {exercise.type === "reorder" && (
        <div className="mt-4">
          <p className="sr-only">Your sentence</p>
          <div className="flex min-h-16 flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-background p-3">
            {placed.length === 0 && <span className="text-sm text-muted">Tap the words below to build the sentence.</span>}
            {placed.map((chip) => (
              <button
                key={chip.key}
                type="button"
                lang="fr"
                disabled={checked}
                aria-label={`Remove ${chip.word}`}
                onClick={() => {
                  setPlaced(placed.filter((p) => p.key !== chip.key));
                  refocusAfterChip();
                }}
                className={`min-h-11 rounded-lg border border-accent/40 bg-card px-3 py-1.5 font-serif text-lg disabled:opacity-70 ${focusRing}`}
              >
                {chip.word}
              </button>
            ))}
          </div>
          <div data-word-bank className="mt-3 flex min-h-11 flex-wrap gap-2">
            {available.map((chip) => (
              <button
                key={chip.key}
                type="button"
                lang="fr"
                disabled={checked}
                aria-label={`Add ${chip.word}`}
                onClick={() => {
                  setPlaced([...placed, chip]);
                  refocusAfterChip();
                }}
                className={`min-h-11 rounded-lg border border-border bg-background px-3 py-1.5 font-serif text-lg transition hover:border-accent/40 disabled:opacity-70 ${focusRing}`}
              >
                {chip.word}
              </button>
            ))}
          </div>
        </div>
      )}

      <div aria-live="polite">{result && <Feedback result={result} explanation={exercise.explanation} />}</div>

      <div className="mt-5 flex flex-wrap gap-3">
        {checked ? (
          <button ref={nextRef} type="submit" className={primaryButton}>
            {number === total ? "See results" : "Next"}
          </button>
        ) : (
          <button type="submit" disabled={!canCheck} className={primaryButton}>
            Check
          </button>
        )}
        {exercise.type === "reorder" && !checked && (
          <button type="button" disabled={placed.length === 0} onClick={() => setPlaced([])} className={secondaryButton}>
            Reset
          </button>
        )}
      </div>
    </form>
  );
}

function FillInPrompt({ prompt, input }: { prompt: string; input: React.ReactNode }) {
  const [before, ...rest] = prompt.split("___");
  return (
    <p className="mt-6 font-serif text-xl leading-loose font-semibold sm:text-2xl">
      {before}
      {input}
      {rest.join("___")}
    </p>
  );
}

function Feedback({ result, explanation }: { result: AnswerResult; explanation: string }) {
  const wrong = result.status === "incorrect";
  return (
    <div
      className={`mt-5 rounded-xl border px-4 py-3 ${
        wrong ? "border-rose-200 bg-rose-50 text-rose-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"
      }`}
    >
      <p className="font-semibold">
        {result.status === "correct" && "Correct!"}
        {result.status === "correct-accents" && (
          <>
            Almost: watch the accents. Write: <span lang="fr">{result.expected}</span>
          </>
        )}
        {wrong && (
          <>
            {result.accentMismatch ? "Not quite. The accent matters here. Write: " : "Not quite. Accepted answer: "}
            <span lang="fr">{result.expected}</span>
          </>
        )}
      </p>
      <p className="mt-1 text-[0.95rem] leading-relaxed">{explanation}</p>
    </div>
  );
}

function EndScreen({ run, onRetry, onRestart }: { run: Run; onRetry: () => void; onRestart: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const missed = run.items.filter((i) => run.results[i.exercise.id] === "incorrect");

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div>
      <h3 ref={headingRef} tabIndex={-1} className="font-serif text-2xl font-semibold outline-none">
        {run.mode === "retry" ? "Retry finished" : "Practice finished"}
      </h3>
      <p className="mt-2 font-serif text-5xl font-semibold text-accent">
        {scoreOf(run)} / {run.items.length}
      </p>

      {missed.length > 0 ? (
        <>
          <h4 className="mt-6 text-sm font-semibold">Questions you missed</h4>
          <ul className="mt-2 space-y-2">
            {missed.map(({ exercise }) => (
              <li key={exercise.id} className="rounded-xl border border-border bg-background px-4 py-3">
                <p>{exercise.prompt}</p>
                <p className="mt-0.5 text-sm text-muted">
                  Accepted answer: <span lang="fr">{exercise.answers[0]}</span>
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-muted">You got every question right.</p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {missed.length > 0 && (
          <button type="button" onClick={onRetry} className={primaryButton}>
            Retry missed questions
          </button>
        )}
        <button type="button" onClick={onRestart} className={secondaryButton}>
          Practice again
        </button>
      </div>
    </div>
  );
}
