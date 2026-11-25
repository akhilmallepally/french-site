// Writes the daily-review card catalogue (docs/plans/review.md, rollout step 2):
//   lib/generated/review-cards-free.json   A1 and A2 cards; may be bundled for the browser later
//   lib/generated/review-cards-paid.json   B1 to C2 cards; server-only (lib/review-cards-server.ts)
//   lib/generated/review-published-ids.json  every vocab id and card id published so far
//   lib/generated/review-card-ids.json     card ids by lesson, with levels, no text (for the deck)
// Run: npm run build:review-cards     (works in PowerShell; no shell commands)
//
// The same content always gives byte-identical files. A published id is never dropped: if one
// disappeared or moved, the script stops and lists it, and validate:content fails the same way.
// New ids are added. validate:content fails when the committed files are out of date.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CONTENT_DIR, parseLesson, readLessonSources, type Lesson } from "../lib/lessons.ts";
import {
  buildIdIndex,
  buildReviewCatalogue,
  checkPublished,
  EMPTY_PUBLISHED,
  serializeCards,
  serializeIdIndex,
  serializePublished,
  type PublishedIds,
  type ReviewCatalogue,
} from "../lib/review-catalogue.ts";

export const REVIEW_REGENERATE_COMMAND = "npm run build:review-cards";

export type ReviewFiles = { free: string; paid: string; published: string; ids: string };
const KINDS = ["free", "paid", "published", "ids"] as const;

const GENERATED = path.join(process.cwd(), "lib", "generated");
export const REVIEW_FILES: ReviewFiles = {
  free: path.join(GENERATED, "review-cards-free.json"),
  paid: path.join(GENERATED, "review-cards-paid.json"),
  published: path.join(GENERATED, "review-published-ids.json"),
  ids: path.join(GENERATED, "review-card-ids.json"),
};

/** Line ends are compared as LF, because Git on Windows may check files out with CRLF. */
function readLf(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
}

export function readPublished(file: string): PublishedIds {
  const text = readLf(file);
  return text === null ? EMPTY_PUBLISHED : (JSON.parse(text) as PublishedIds);
}

/** Lessons with frontmatter errors are left out (validate:content reports them). */
export function readLessons(lessonsDir: string): Lesson[] {
  return readLessonSources(lessonsDir)
    .map((src) => parseLesson(src).lesson)
    .filter((l): l is Lesson => !!l);
}

export type ReviewBuild = {
  catalogue: ReviewCatalogue;
  /** Published ids that disappeared or changed lesson (empty when intact). */
  changes: string[];
  texts: Record<keyof ReviewFiles, string>;
};

export function buildReviewFiles(lessons: Lesson[], publishedFile: string): ReviewBuild {
  const old = readPublished(publishedFile);
  const catalogue = buildReviewCatalogue(lessons, old);
  return {
    catalogue,
    changes: checkPublished(old, catalogue.published),
    texts: {
      free: serializeCards("free", catalogue.free),
      paid: serializeCards("paid", catalogue.paid),
      published: serializePublished(catalogue.published),
      ids: serializeIdIndex(buildIdIndex(lessons, [...catalogue.free, ...catalogue.paid])),
    },
  };
}

/** Which committed files don't match the content (empty when all are current). */
export function staleReviewFiles(build: ReviewBuild, files: ReviewFiles): string[] {
  return KINDS
    .filter((k) => readLf(files[k]) !== build.texts[k])
    .map((k) => path.relative(process.cwd(), files[k]) || files[k]);
}

// CLI (skipped when another script imports this file).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const build = buildReviewFiles(readLessons(CONTENT_DIR), REVIEW_FILES.published);
  if (build.changes.length) {
    console.error("Published ids changed. Ids are permanent once published (CLAUDE.md), so restore these:");
    for (const c of build.changes) console.error(`  ${c}`);
    console.error("\nNothing was written.");
    process.exit(1);
  }
  fs.mkdirSync(GENERATED, { recursive: true });
  for (const k of KINDS) fs.writeFileSync(REVIEW_FILES[k], build.texts[k]);
  const { totals, free, paid } = build.catalogue;
  const size = (k: "free" | "paid") => `${(Buffer.byteLength(build.texts[k]) / 1024).toFixed(0)} KiB`;
  console.log(`Review cards: ${totals.vocab} vocab items, ${totals.eligible} eligible (glossary excluded), ${totals.cards} cards.`);
  console.log(`  free (A1, A2): ${free.length} cards, ${size("free")}    paid (B1 to C2): ${paid.length} cards, ${size("paid")}`);
  console.log(`Wrote ${Object.values(REVIEW_FILES).map((f) => path.relative(process.cwd(), f)).join(", ")}.`);
}
