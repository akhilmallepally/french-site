// Compile-time leak guard, checked by `npx tsc --noEmit`. Each @ts-expect-error line must stay
// an error: if one compiles, lesson body data could reach the page shell. Never imported.
import type { LessonFull, LessonMeta } from "./lessons";

declare const meta: LessonMeta;
declare const full: LessonFull;

function shell(lesson: LessonMeta) {
  return lesson.title;
}

shell(meta);

// @ts-expect-error A LessonFull is not a LessonMeta.
shell(full);

// @ts-expect-error A LessonMeta can't carry the body.
shell({ ...meta, content: full.body });

// @ts-expect-error A LessonMeta can't carry exercises (and their answers).
shell({ ...meta, exercises: full.exercises });

// @ts-expect-error A LessonMeta can't carry vocab.
shell({ ...meta, vocab: full.vocab });
