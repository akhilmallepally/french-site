// Writes lib/generated/progress-index.json from the lessons (docs/plans/progress.md, step 2).
// Run: npm run build:progress-index     (works in PowerShell; no shell commands)
//
// The same content always gives byte-identical output. validate:content fails when the committed
// file is out of date and prints this command.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildProgressIndex,
  CONTENT_DIR,
  parseLesson,
  PROGRESS_INDEX_FILE,
  readLessonSources,
  serializeProgressIndex,
  type Lesson,
} from "../lib/lessons.ts";

export const REGENERATE_COMMAND = "npm run build:progress-index";

/** The index text for a lessons folder. Lessons with frontmatter errors are left out (validate:content reports them). */
export function progressIndexText(lessonsDir: string): string {
  const lessons = readLessonSources(lessonsDir)
    .map((src) => parseLesson(src).lesson)
    .filter((l): l is Lesson => !!l);
  return serializeProgressIndex(buildProgressIndex(lessons));
}

/**
 * Null when `indexFile` matches the content, otherwise the reason. Line ends are compared as LF,
 * because Git on Windows may check the file out with CRLF.
 */
export function progressIndexProblem(lessonsDir: string, indexFile: string): string | null {
  if (!fs.existsSync(indexFile)) return `${path.relative(process.cwd(), indexFile)} is missing. Run: ${REGENERATE_COMMAND}`;
  const committed = fs.readFileSync(indexFile, "utf8").replace(/\r\n/g, "\n");
  if (committed !== progressIndexText(lessonsDir)) {
    return `${path.relative(process.cwd(), indexFile)} is out of date with the lessons. Run: ${REGENERATE_COMMAND}`;
  }
  return null;
}

// CLI (skipped when another script imports this file).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = progressIndexText(CONTENT_DIR);
  fs.mkdirSync(path.dirname(PROGRESS_INDEX_FILE), { recursive: true });
  fs.writeFileSync(PROGRESS_INDEX_FILE, text);
  const { totals } = JSON.parse(text);
  console.log(
    `Wrote ${path.relative(process.cwd(), PROGRESS_INDEX_FILE)} (${Buffer.byteLength(text)} bytes): ` +
      `${totals.lessons} lessons, ${totals.exercises} graded exercises, ${totals.writingTasks} writing tasks.`,
  );
}
