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
  readLessonSources,
  readSyllabus,
  SLUG_PATTERN,
  sortLessons,
  type Lesson,
  type LessonMeta,
} from "../lib/lessons.ts";

export const SYLLABUS_FILE = path.join(process.cwd(), "docs", "syllabus.md");

export type ValidationResult = { lessonCount: number; errors: string[]; warnings: string[] };

export function validateContent(lessonsDir: string, syllabusFile: string): ValidationResult {
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
  const linkPattern = /<LessonLink\b[^>]*?\bid=["']([^"']+)["']/g;
  for (const l of lessons) {
    for (const match of bodyOf.get(l)!.matchAll(linkPattern)) {
      const ref = match[1];
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
      } else if (!id.startsWith(`${l.id}-`)) {
        warnings.push(`${file}: ${kind} id "${id}" doesn't start with this lesson's id "${l.id}"`);
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

  return { lessonCount: lessons.length, errors, warnings };
}

// CLI (skipped when another script imports this file).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lessonsDir = path.resolve(process.argv[2] ?? CONTENT_DIR);
  const syllabusFile = path.resolve(process.argv[3] ?? SYLLABUS_FILE);
  const { lessonCount, errors, warnings } = validateContent(lessonsDir, syllabusFile);

  const rel = path.relative(process.cwd(), lessonsDir) || ".";
  for (const w of warnings) console.warn(`  warning  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`  error    ${e}`);
    console.error(`\nContent check failed: ${errors.length} error(s) in ${rel}`);
    process.exit(1);
  }
  console.log(`Content OK: ${lessonCount} lesson(s) in ${rel}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
}
