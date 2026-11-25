// Checks every lesson's frontmatter and the links between lessons.
// Run: npm run validate:content            (also runs automatically before npm run build)
// Or:  node --experimental-strip-types scripts/validate-content.ts [lessons-dir] [syllabus.md]
//
// Ids listed in docs/syllabus.md count as "planned". `related` and <LessonLink>
// may point to planned ids that have no file yet; `prerequisites` may not.
//
// Exits with code 1 if anything is wrong. Warnings are printed but don't fail.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CONTENT_DIR,
  LEVELS,
  levelIndex,
  levelToSlug,
  parseLesson,
  PROGRESS_INDEX_FILE,
  readLessonSources,
  readSyllabus,
  SLUG_PATTERN,
  sortLessons,
  type Lesson,
  type LessonMeta,
} from "../lib/lessons.ts";
import { progressIndexProblem } from "./build-progress-index.ts";
import { buildReviewFiles, REVIEW_FILES, REVIEW_REGENERATE_COMMAND, staleReviewFiles, type ReviewFiles } from "./build-review-cards.ts";
import { checkCards, type ReviewTotals } from "../lib/review-catalogue.ts";

export const SYLLABUS_FILE = path.join(process.cwd(), "docs", "syllabus.md");

export type ContentTotals = { lessons: number; exercises: number; writingTasks: number };
export type ValidationResult = { lessonCount: number; totals: ContentTotals; reviewTotals: ReviewTotals; errors: string[]; warnings: string[] };
export type ValidationOptions = {
  /** Fail unless the committed progress index (lib/generated/progress-index.json) matches the lessons. */
  progressIndexFile?: string;
  /** Fail unless the content has exactly these totals (the real site; fixtures leave it out). */
  expectedTotals?: ContentTotals;
  /** Fail unless the committed review cards and published ids (lib/generated/review-*.json) match the lessons. */
  reviewFiles?: ReviewFiles;
  /** Fail unless the review catalogue has exactly these totals. */
  expectedReviewTotals?: ReviewTotals;
};

/** The site's content today (docs/plans/progress.md, section 2). Change it here when lessons are added. */
export const EXPECTED_TOTALS: ContentTotals = { lessons: 326, exercises: 4620, writingTasks: 25 };

/** The review catalogue today (docs/plans/review.md, decision 3). Change it here when vocab is added. */
export const EXPECTED_REVIEW_TOTALS: ReviewTotals = { vocab: 5228, eligible: 4855, cards: 4817 };

// Database limits from supabase/migrations/0006_progress_sync.sql (apply_progress).
const MAX_LESSON_ID = 120;
// Exercise ids (0006) and vocab ids, which become card ids (0008), share the 160-character limit.
const MAX_ITEM_ID = 160;
const DB_CAPS: ContentTotals = { lessons: 600, exercises: 6000, writingTasks: 200 };

export function validateContent(lessonsDir: string, syllabusFile: string, options: ValidationOptions = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const planned = new Set(readSyllabus(syllabusFile).map((p) => p.id));

  // 1. Folder layout: every lesson must live in a level folder.
  const levelFolders = new Set(LEVELS.map(levelToSlug));
  for (const entry of fs.readdirSync(lessonsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !levelFolders.has(entry.name)) {
      errors.push(`${entry.name}/: unknown folder. Lessons go in ${[...levelFolders].join(", ")}.`);
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      errors.push(`${entry.name}: lesson is not inside a level folder (move it to e.g. a1/).`);
    }
  }

  // 2. Each file's frontmatter.
  const lessons: LessonMeta[] = [];
  const fileOf = new Map<LessonMeta, string>();
  const bodyOf = new Map<LessonMeta, string>();
  const fullOf = new Map<LessonMeta, Lesson>();
  for (const src of readLessonSources(lessonsDir)) {
    const { lesson, errors: fileErrors } = parseLesson(src);
    for (const e of fileErrors) errors.push(`${src.file}: ${e}`);
    if (lesson) {
      lessons.push(lesson.meta);
      fileOf.set(lesson.meta, src.file);
      bodyOf.set(lesson.meta, src.content);
      fullOf.set(lesson.meta, lesson);
    }
  }

  // 3. Duplicate ids.
  const byId = new Map<string, LessonMeta>();
  for (const l of lessons) {
    const existing = byId.get(l.id);
    if (existing) errors.push(`${fileOf.get(l)}: duplicate id "${l.id}" (also used by ${fileOf.get(existing)})`);
    else byId.set(l.id, l);
  }

  // 3b. Lesson id length: apply_progress (0006) accepts 1 to 120 characters.
  for (const l of lessons) {
    if (l.id.length > MAX_LESSON_ID) errors.push(`${fileOf.get(l)}: lesson id "${l.id}" is longer than ${MAX_LESSON_ID} characters (the database limit)`);
  }

  // 4. Duplicate order numbers within a level.
  const byLevelOrder = new Map<string, LessonMeta>();
  for (const l of lessons) {
    const key = `${l.level}:${l.order}`;
    const existing = byLevelOrder.get(key);
    if (existing) {
      errors.push(`${fileOf.get(l)}: order ${l.order} is already used in ${l.level} by ${fileOf.get(existing)}`);
    } else byLevelOrder.set(key, l);
  }

  // 5. References. Prerequisites must be written lessons; related may also be planned ones.
  //    Prerequisites can't be at a higher level.
  for (const l of lessons) {
    const file = fileOf.get(l);
    for (const field of ["prerequisites", "related"] as const) {
      const seen = new Set<string>();
      for (const ref of l[field]) {
        if (seen.has(ref)) warnings.push(`${file}: "${ref}" is listed twice in ${field}`);
        seen.add(ref);
        if (ref === l.id) errors.push(`${file}: lists itself in ${field}`);
        else if (byId.has(ref)) continue;
        else if (!planned.has(ref)) {
          errors.push(`${file}: ${field} references unknown lesson id "${ref}" (no file, and not in the syllabus)`);
        } else if (field === "prerequisites") {
          errors.push(
            `${file}: prerequisite "${ref}" is planned in the syllabus but not written yet. Prerequisites must be written lessons.`,
          );
        }
      }
    }
    for (const ref of l.prerequisites) {
      const pre = byId.get(ref);
      if (!pre || pre === l) continue;
      if (levelIndex(pre.level) > levelIndex(l.level)) {
        errors.push(`${file}: prerequisite "${ref}" is ${pre.level}, higher than this ${l.level} lesson`);
      } else if (pre.level === l.level && pre.order > l.order) {
        warnings.push(`${file}: prerequisite "${ref}" (order ${pre.order}) comes after this lesson (order ${l.order})`);
      }
      if (l.related.includes(ref)) warnings.push(`${file}: "${ref}" is in both prerequisites and related`);
    }
  }

  // 6. Prerequisite cycles (depth-first search; "visiting" = on the current path).
  const state = new Map<string, "visiting" | "done">();
  const reportedCycles = new Set<string>();
  const visit = (id: string, trail: string[]) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      const cycle = [...trail.slice(trail.indexOf(id)), id];
      const key = cycle.slice(0, -1).sort().join(",");
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        errors.push(`prerequisite cycle: ${cycle.join(" -> ")}`);
      }
      return;
    }
    state.set(id, "visiting");
    for (const ref of byId.get(id)?.prerequisites ?? []) if (byId.has(ref)) visit(ref, [...trail, id]);
    state.set(id, "done");
  };
  for (const id of byId.keys()) visit(id, []);

  // 7. In-text <LessonLink id="..." /> must point at a written or planned lesson.
  //    Attributes are read as quoted pairs, so a `text` value can't be mistaken for the id.
  const linkPattern = /<LessonLink\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for (const l of lessons) {
    for (const match of bodyOf.get(l)!.matchAll(linkPattern)) {
      const attrs = new Map([...match[1].matchAll(/(\w+)=(?:"([^"]*)"|'([^']*)')/g)].map((a) => [a[1], a[2] ?? a[3]]));
      const ref = attrs.get("id");
      if (!ref) {
        errors.push(`${fileOf.get(l)}: <LessonLink> is missing its id`);
        continue;
      }
      if (attrs.has("text") && !attrs.get("text")!.trim()) {
        errors.push(`${fileOf.get(l)}: <LessonLink id="${ref}"> has an empty text prop`);
      }
      if (!byId.has(ref) && !planned.has(ref)) {
        errors.push(`${fileOf.get(l)}: <LessonLink id="${ref}"> points to an unknown lesson (no file, and not in the syllabus)`);
      }
    }
  }

  // 8. Units should be contiguous in order, otherwise prev/next jumps between units.
  for (const level of LEVELS) {
    const seq = sortLessons(lessons.filter((l) => l.level === level));
    const finished = new Set<string>();
    seq.forEach((l, i) => {
      if (i > 0 && seq[i - 1].unit !== l.unit) finished.add(seq[i - 1].unit);
      if (finished.has(l.unit)) warnings.push(`${fileOf.get(l)}: unit "${l.unit}" is split by lessons from another unit`);
    });
  }

  // 9. Vocab and exercise ids: right format, and unique across the whole site.
  const itemOwners = new Map<string, string>();
  for (const l of lessons) {
    const file = fileOf.get(l);
    const { vocab, exercises } = fullOf.get(l)!;
    const items = [
      ...vocab.map((v) => ({ id: v.id, kind: "vocab", suffix: /-v\d{3}$/ })),
      ...exercises.map((e) => ({ id: e.id, kind: "exercise", suffix: /-ex\d{3}$/ })),
    ];
    for (const { id, kind, suffix } of items) {
      if (!SLUG_PATTERN.test(id) || !suffix.test(id)) {
        errors.push(`${file}: ${kind} id "${id}" should look like "${l.id}${kind === "vocab" ? "-v001" : "-ex001"}"`);
      } else if (kind === "exercise" && !id.startsWith(`${l.id}-ex`)) {
        // Progress derives the lesson from this prefix, and apply_progress (0006) rejects any other id.
        errors.push(`${file}: exercise id "${id}" must be "${l.id}-ex" plus digits (progress uses the prefix)`);
      } else if (!id.startsWith(`${l.id}-`)) {
        warnings.push(`${file}: ${kind} id "${id}" doesn't start with this lesson's id "${l.id}"`);
      }
      if (id.length > MAX_ITEM_ID) {
        errors.push(`${file}: ${kind} id "${id}" is longer than ${MAX_ITEM_ID} characters (the database limit)`);
      }
      const owner = itemOwners.get(id);
      if (owner) errors.push(`${file}: ${kind} id "${id}" is already used in ${owner}`);
      else itemOwners.set(id, file!);
    }
  }

  // 10. <VocabTable /> needs vocab to show, and every vocab item should appear in some table.
  const tablePattern = /<VocabTable\b([^>]*?)\/?>/g;
  for (const l of lessons) {
    const file = fileOf.get(l);
    const { vocab } = fullOf.get(l)!;
    const shown = new Set<string>();
    for (const match of bodyOf.get(l)!.matchAll(tablePattern)) {
      const group = match[1].match(/\bgroup=["']([^"']+)["']/)?.[1];
      const rows = group ? vocab.filter((v) => v.group === group) : vocab;
      if (!rows.length) {
        errors.push(`${file}: <VocabTable${group ? ` group="${group}"` : ""} /> has no vocab items to show`);
      }
      for (const v of rows) shown.add(v.id);
    }
    const hidden = vocab.filter((v) => !shown.has(v.id));
    if (hidden.length) warnings.push(`${file}: vocab not shown in any <VocabTable />: ${hidden.map((v) => v.id).join(", ")}`);
  }

  // 11. "Source text" sections (a text to comment on or contract): C2 only, at most one per lesson,
  //     with French text lines (*…*) and an English translation line ((…)).
  for (const l of lessons) {
    const file = fileOf.get(l);
    const sections = bodyOf.get(l)!.split(/^(?=## )/m).filter((s) => /^## Source text\b/i.test(s));
    if (!sections.length) continue;
    if (l.level !== "C2") {
      errors.push(`${file}: "Source text" sections are only allowed at C2`);
      continue;
    }
    if (sections.length > 1) errors.push(`${file}: at most one "Source text" section per lesson (found ${sections.length})`);
    for (const s of sections) {
      const heading = s.split(/\r?\n/)[0].replace(/^## /, "").trim();
      const lines = s.split(/\r?\n/).slice(1).map((x) => x.trim());
      if (!lines.some((x) => /^\*[^*].*\*$/.test(x))) errors.push(`${file}: "${heading}" has no French text lines (*…*)`);
      if (!lines.some((x) => /^\(.+\)$/.test(x))) errors.push(`${file}: "${heading}" has no English translation line ((…))`);
    }
  }

  // 12. Progress (docs/plans/progress.md, step 2): totals, the database caps, the committed index.
  const totals: ContentTotals = { lessons: lessons.length, exercises: 0, writingTasks: 0 };
  for (const l of lessons) {
    for (const e of fullOf.get(l)!.exercises) {
      if (e.type === "writing-task") totals.writingTasks += 1;
      else totals.exercises += 1;
    }
  }
  for (const k of ["lessons", "exercises", "writingTasks"] as const) {
    if (totals[k] >= DB_CAPS[k] * 0.8) {
      warnings.push(`${totals[k]} ${k} is at least 80% of the per-user database cap of ${DB_CAPS[k]} (0006 apply_progress)`);
    }
  }
  if (options.expectedTotals) {
    const want = options.expectedTotals;
    if (totals.lessons !== want.lessons || totals.exercises !== want.exercises || totals.writingTasks !== want.writingTasks) {
      errors.push(
        `totals changed: ${totals.lessons} lessons, ${totals.exercises} graded exercises, ${totals.writingTasks} writing tasks ` +
          `(expected ${want.lessons}, ${want.exercises}, ${want.writingTasks}). If the change is intended, update EXPECTED_TOTALS ` +
          `in scripts/validate-content.ts and run npm run build:progress-index.`,
      );
    }
  }
  if (options.progressIndexFile) {
    const problem = progressIndexProblem(lessonsDir, options.progressIndexFile);
    if (problem) errors.push(problem);
  }

  // 13. Review cards (docs/plans/review.md, step 2): 0008's id rules, the required text, the
  //     committed catalogue, the published ids and the totals.
  const review = buildReviewFiles([...fullOf.values()], options.reviewFiles?.published ?? "");
  const { totals: reviewTotals } = review.catalogue;
  for (const p of checkCards([...review.catalogue.free, ...review.catalogue.paid])) errors.push(`review cards: ${p}`);
  if (options.reviewFiles) {
    for (const c of review.changes) {
      errors.push(`review ids: ${c}. Published ids are permanent: restore it (see lib/generated/review-published-ids.json).`);
    }
    const stale = staleReviewFiles(review, options.reviewFiles);
    if (stale.length && !review.changes.length) {
      errors.push(`review cards: ${stale.join(", ")} out of date with the lessons. Run: ${REVIEW_REGENERATE_COMMAND}`);
    }
  }
  if (options.expectedReviewTotals) {
    const want = options.expectedReviewTotals;
    if (reviewTotals.vocab !== want.vocab || reviewTotals.eligible !== want.eligible || reviewTotals.cards !== want.cards) {
      errors.push(
        `review totals changed: ${reviewTotals.vocab} vocab items, ${reviewTotals.eligible} eligible, ${reviewTotals.cards} cards ` +
          `(expected ${want.vocab}, ${want.eligible}, ${want.cards}). If the change is intended, update EXPECTED_REVIEW_TOTALS ` +
          `in scripts/validate-content.ts and run ${REVIEW_REGENERATE_COMMAND}.`,
      );
    }
  }

  return { lessonCount: lessons.length, totals, reviewTotals, errors, warnings };
}

// Checks the planned order in a syllabus for the given levels (e.g. ["b2"]): orders run 1..N with
// no gaps or repeats, units are contiguous, every prerequisite is planned and comes earlier, no more
// than six prerequisites (final reviews excepted), and no cycles. Used by test:content to keep the
// B2 order consistent after re-planning; validate:content itself doesn't run it.
export function checkSyllabusOrder(syllabusFile: string, levels: string[]): string[] {
  const errors: string[] = [];
  type Row = { order: number; id: string; level: string; unit: string; pre: string[] };
  const rows: Row[] = [];
  for (const line of fs.readFileSync(syllabusFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*([abc][12]-[a-z0-9-]+)\s*\|[^|]*\|\s*([^|]*?)\s*\|[^|]*\|\s*([^|]*?)\s*\|/);
    if (!m) continue;
    rows.push({ order: Number(m[1]), id: m[2], level: m[2].slice(0, 2), unit: m[3], pre: m[4].split(",").map((p) => p.trim()).filter((p) => /^[abc][12]-/.test(p)) });
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rank = (lv: string) => ["a1", "a2", "b1", "b2", "c1", "c2"].indexOf(lv);
  for (const level of levels) {
    const lv = rows.filter((r) => r.level === level);
    lv.forEach((r, i) => {
      if (r.order !== i + 1) errors.push(`${r.id}: order ${r.order}, expected ${i + 1} (orders must run 1..N in table order)`);
      if (i > 0 && lv[i - 1].unit !== r.unit && lv.slice(0, i - 1).some((x) => x.unit === r.unit)) errors.push(`${r.id}: unit "${r.unit}" is split by another unit`);
      for (const p of r.pre) {
        const pre = byId.get(p);
        if (!pre) errors.push(`${r.id}: prerequisite ${p} isn't in the syllabus`);
        else if (rank(pre.level) > rank(r.level) || (pre.level === r.level && pre.order >= r.order)) errors.push(`${r.id}: prerequisite ${p} comes later`);
      }
      if (r.pre.length > 6 && !r.id.endsWith("review-final")) errors.push(`${r.id}: ${r.pre.length} prerequisites (max 6)`);
    });
    const state = new Map<string, "visiting" | "done">();
    const visit = (id: string, trail: string[]) => {
      if (state.get(id) === "done") return;
      if (state.get(id) === "visiting") { errors.push(`prerequisite cycle: ${[...trail, id].join(" -> ")}`); return; }
      state.set(id, "visiting");
      for (const p of byId.get(id)?.pre ?? []) if (byId.get(p)?.level === level) visit(p, [...trail, id]);
      state.set(id, "done");
    };
    for (const r of lv) visit(r.id, []);
  }
  return errors;
}

// CLI (skipped when another script imports this file).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lessonsDir = path.resolve(process.argv[2] ?? CONTENT_DIR);
  const syllabusFile = path.resolve(process.argv[3] ?? SYLLABUS_FILE);
  // The real content is held to its totals and its committed progress index; other folders aren't.
  const isSiteContent = lessonsDir === path.resolve(CONTENT_DIR);
  const { lessonCount, totals, reviewTotals, errors, warnings } = validateContent(
    lessonsDir,
    syllabusFile,
    isSiteContent
      ? { progressIndexFile: PROGRESS_INDEX_FILE, expectedTotals: EXPECTED_TOTALS, reviewFiles: REVIEW_FILES, expectedReviewTotals: EXPECTED_REVIEW_TOTALS }
      : {},
  );

  const rel = path.relative(process.cwd(), lessonsDir) || ".";
  for (const w of warnings) console.warn(`  warning  ${w}`);
  console.log(`Totals: ${totals.lessons} lessons, ${totals.exercises} graded exercises, ${totals.writingTasks} writing tasks.`);
  console.log(`Review: ${reviewTotals.vocab} vocab items, ${reviewTotals.eligible} eligible, ${reviewTotals.cards} cards.`);
  if (errors.length) {
    for (const e of errors) console.error(`  error    ${e}`);
    console.error(`\nContent check failed: ${errors.length} error(s) in ${rel}`);
    process.exit(1);
  }
  console.log(`Content OK: ${lessonCount} lesson(s) in ${rel}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
}
