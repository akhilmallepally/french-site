"use client";

// A C2 writing task: ungraded. The text stays in this browser (lib/writing-draft.ts); progress
// records only "done" and the ticked self-check items (lib/progress.ts). Nothing is sent anywhere.
import { useEffect, useId, useRef, useState } from "react";
import { progressStore } from "@/lib/progress";
import type { WritingTaskExercise } from "@/lib/types";
import { countWords } from "@/lib/word-count";
import { loadDraft, saveDraft } from "@/lib/writing-draft";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const primaryButton = `min-h-11 rounded-full bg-accent px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;
const secondaryButton = `min-h-11 rounded-full border border-border bg-card px-5 py-2.5 font-medium transition hover:border-accent/40 ${focusRing}`;

export function WritingTask({ exercise }: { exercise: WritingTaskExercise }) {
  const uid = useId();
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [checked, setChecked] = useState<number[]>([]);
  const [doneAt, setDoneAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore the local draft and the saved checklist after mount (localStorage isn't available during render).
  // The draft is local and never waits for anything.
  useEffect(() => {
    setText(loadDraft(exercise.id));
    setLoaded(true);
  }, [exercise.id]);

  // The saved ticks and "done" fill in when read, and again when the stored copy changes, unless the
  // learner has already started changing the ticks on this page.
  const touched = useRef(false);
  useEffect(() => {
    let active = true;
    const load = () =>
      progressStore.getWritingTask(exercise.id).then((progress) => {
        if (!active || !progress) return;
        if (!touched.current) setChecked(progress.checked);
        if (progress.done) setDoneAt(progress.doneAt);
      });
    void load();
    const unsubscribe = progressStore.subscribe(() => void load());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [exercise.id]);

  // Save the draft locally, a moment after typing stops.
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDraft(exercise.id, text), 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [text, loaded, exercise.id]);

  const words = countWords(text);
  const [min, max] = exercise.wordTarget ?? [0, 0];
  const target = exercise.wordTarget ? `Target: ${min} to ${max} words.` : "";
  const inRange = exercise.wordTarget ? words >= min && words <= max : true;

  function toggle(index: number) {
    touched.current = true;
    setChecked((current) => (current.includes(index) ? current.filter((i) => i !== index) : [...current, index].sort((a, b) => a - b)));
  }

  async function markDone() {
    const saved = await progressStore.recordWritingTask(exercise.id, checked);
    setDoneAt(saved.doneAt);
  }

  const ids = { prompt: `${uid}-prompt`, count: `${uid}-count`, text: `${uid}-text`, model: `${uid}-model`, list: `${uid}-list` };

  return (
    <section id="writing-task" aria-labelledby={`${uid}-heading`} className="mt-10 scroll-mt-6 rounded-2xl border border-border bg-card p-5 sm:p-7">
      <h3 id={`${uid}-heading`} className="font-serif text-2xl font-semibold">
        Writing task
      </h3>
      <p className="mt-1 text-sm text-muted">Not marked: write, compare with the model, then check your text against the list.</p>
      <p id={ids.prompt} className="mt-4 font-serif text-xl leading-snug font-semibold">
        {exercise.prompt}
      </p>

      <label htmlFor={ids.text} className="mt-5 block text-sm font-medium">
        Your text <span className="font-normal text-muted">(saved in this browser only; never sent anywhere)</span>
      </label>
      <textarea
        id={ids.text}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-describedby={`${ids.prompt} ${ids.count}`}
        lang="fr"
        rows={10}
        spellCheck={false}
        className={`mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 font-serif text-lg leading-relaxed ${focusRing}`}
      />
      <p id={ids.count} className={`mt-1 text-sm ${inRange ? "text-muted" : "text-rose-800"}`}>
        {words} {words === 1 ? "word" : "words"}. {target}
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          aria-expanded={showModel}
          aria-controls={ids.model}
          onClick={() => setShowModel((v) => !v)}
          className={secondaryButton}
        >
          {showModel ? "Hide the model" : "Show the model"}
        </button>
      </div>
      <div id={ids.model} hidden={!showModel} className="mt-4 rounded-xl border border-border bg-background px-4 py-3">
        <p className="text-sm font-semibold">A model answer</p>
        <p lang="fr" className="mt-1 font-serif text-lg leading-relaxed whitespace-pre-line">
          {exercise.model}
        </p>
      </div>

      <fieldset className="mt-6">
        <legend id={ids.list} className="text-sm font-semibold">
          Check your text
        </legend>
        <ul className="mt-2 space-y-2">
          {exercise.checklist.map((item, index) => {
            const boxId = `${uid}-check-${index}`;
            return (
              <li key={index} className="flex items-start gap-3">
                <input
                  id={boxId}
                  type="checkbox"
                  checked={checked.includes(index)}
                  onChange={() => toggle(index)}
                  className={`mt-1 h-5 w-5 shrink-0 ${focusRing}`}
                />
                <label htmlFor={boxId}>{item}</label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={markDone} className={primaryButton}>
          Mark as done
        </button>
        <p aria-live="polite" className="text-sm text-muted">
          {doneAt ? "✓ Done. You can keep editing; your text stays in this browser." : ""}
        </p>
      </div>
    </section>
  );
}
