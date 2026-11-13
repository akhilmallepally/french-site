// The only place that knows lessons live on disk. Swap the reading part for a
// DB/CMS later and the pages keep working as long as the return types stay the same.
//
// This file is also imported by scripts/validate-content.ts, which runs under
// plain Node (type stripping), so keep it free of path aliases and TS-only
// syntax like enums.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { sameWords } from "./check-answer.ts";
import { B2_EXERCISE_TYPES, EXERCISE_TYPES, OPTION_TYPES, type Exercise, type ExerciseType, type VocabItem } from "./types.ts";

export { EXERCISE_TYPES };
export type { Exercise, ExerciseType, VocabItem };

// ---------- Levels and types ----------

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Level = (typeof LEVELS)[number];

export const LESSON_TYPES = ["grammar", "vocabulary", "communication", "culture", "review"] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

export const LEVEL_INFO: Record<Level, { name: string; summary: string; comingLater?: boolean }> = {
  A1: { name: "Beginner", summary: "Greet people, introduce yourself, and handle simple everyday situations." },
  A2: { name: "Elementary", summary: "Talk about the past, your plans, and routine tasks in familiar settings." },
  B1: { name: "Intermediate", summary: "Give opinions, tell stories, and cope with most situations while travelling." },
  B2: { name: "Upper intermediate", summary: "Argue a point, follow the news, and speak with nuance and fluency." },
  C1: { name: "Advanced", summary: "Write and speak with precision, style, and control of register." },
  C2: { name: "Mastery", summary: "Near-native command of the language in any context.", comingLater: true },
};

export const CONTENT_DIR = path.join(process.cwd(), "content", "lessons");

export function levelToSlug(level: Level): string {
  return level.toLowerCase();
}

export function levelFromSlug(slug: string): Level | null {
  return LEVELS.find((l) => levelToSlug(l) === slug) ?? null;
}

export function levelIndex(level: Level): number {
  return LEVELS.indexOf(level);
}

/**
 * Free levels are readable without signing in. Everything else, including any level added
 * later, needs a Google sign-in (default deny). Accepts "A1" or the URL slug "a1".
 */
const FREE_LEVELS: readonly string[] = ["a1", "a2"];
export function isFreeLevel(level: Level | string): boolean {
  return FREE_LEVELS.includes(String(level).toLowerCase());
}

// ---------- Data shapes ----------

/**
 * Leak guard: a LessonMeta can never carry the lesson body, vocab or exercises. The page shell,
 * metadata, static params and level pages only ever receive LessonMeta, so passing body data
 * into them is a type error (see lib/lessons.typetest.ts).
 */
type NoBody = { content?: never; body?: never; vocab?: never; exercises?: never };

export type LessonMeta = NoBody & {
  id: string; // stable forever; never derive it from the filename
  slug: string; // from the filename; may change (add a redirect if it does)
  href: string;
  title: string;
  description: string;
  level: Level;
  unit: string;
  order: number; // position within the level, across all units
  type: LessonType;
  tags: string[];
  prerequisites: string[]; // lesson ids
  related: string[]; // lesson ids
};

/** A parsed lesson file, used by the validator and the scripts. Pages never receive it. */
export type Lesson = { meta: LessonMeta; content: string; vocab: VocabItem[]; exercises: Exercise[] };

/**
 * Proof that the server allowed this lesson to be read. Only lib/auth.ts creates it
 * (grantFreeAccess for A1 and A2, grantLessonAccess after a server-side getUser()).
 */
export type LessonAccess = { readonly grant: "lesson-access"; readonly lessonId: string };

/** The lesson body, vocab and exercises. Only loadLessonFull returns it, and only with a LessonAccess. */
export type LessonFull = {
  readonly kind: "lesson-full";
  readonly id: string;
  readonly body: string;
  readonly vocab: VocabItem[];
  readonly exercises: Exercise[];
};

export type Unit = { name: string; lessons: LessonMeta[] };

// ---------- Reading and parsing (shared with the validator) ----------

export type LessonSource = {
  file: string; // path relative to the content dir, for error messages
  folder: string; // level folder name, e.g. "a1"
  slug: string;
  data: Record<string, unknown>;
  content: string;
};

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `dir` overrides the content folder (the validator uses it for test fixtures). */
export function readLessonSources(dir?: string): LessonSource[] {
  return LEVELS.flatMap((level) => {
    const folder = levelToSlug(level);
    // The site path is written out literally so the bundler only traces content/lessons.
    const folderPath = dir
      ? path.join(/*turbopackIgnore: true*/ dir, folder)
      : path.join(process.cwd(), "content", "lessons", folder);
    if (!fs.existsSync(folderPath)) return [];

    return fs
      .readdirSync(folderPath)
      .filter((file) => file.endsWith(".mdx"))
      .map((file) => {
        const { data, content } = matter(fs.readFileSync(path.join(folderPath, file), "utf8"));
        return { file: `${folder}/${file}`, folder, slug: file.replace(/\.mdx$/, ""), data, content };
      });
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Checks one file's frontmatter. Returns the parsed lesson, or the problems found. */
export function parseLesson(src: LessonSource): { lesson?: Lesson; errors: string[] } {
  const d = src.data;
  const errors: string[] = [];

  for (const key of ["id", "title", "description", "unit"]) {
    if (typeof d[key] !== "string" || !(d[key] as string).trim()) errors.push(`"${key}" is missing or empty`);
  }
  if (typeof d.id === "string" && !SLUG_PATTERN.test(d.id)) {
    errors.push(`"id" must be lowercase letters, digits and hyphens (got "${d.id}")`);
  }
  if (!LEVELS.includes(d.level as Level)) {
    errors.push(`"level" must be one of ${LEVELS.join(", ")} (got ${JSON.stringify(d.level)})`);
  } else if (levelToSlug(d.level as Level) !== src.folder) {
    errors.push(`"level" is ${d.level} but the file is in the ${src.folder}/ folder`);
  }
  if (!LESSON_TYPES.includes(d.type as LessonType)) {
    errors.push(`"type" must be one of ${LESSON_TYPES.join(", ")} (got ${JSON.stringify(d.type)})`);
  }
  if (!Number.isInteger(d.order) || (d.order as number) < 1) {
    errors.push(`"order" must be a whole number of 1 or more (got ${JSON.stringify(d.order)})`);
  }
  for (const key of ["tags", "prerequisites", "related"]) {
    if (!isStringArray(d[key])) errors.push(`"${key}" must be a list of strings (use [] if empty)`);
  }
  if (!SLUG_PATTERN.test(src.slug)) {
    errors.push(`filename must be lowercase letters, digits and hyphens (got "${src.slug}.mdx")`);
  }
  const vocab = parseVocab(d.vocab, errors);
  const exercises = parseExercises(d.exercises, errors, d.level);

  if (errors.length) return { errors };

  const level = d.level as Level;
  return {
    errors,
    lesson: {
      content: src.content,
      vocab,
      exercises,
      meta: {
        id: d.id as string,
        slug: src.slug,
        href: `/lessons/${levelToSlug(level)}/${src.slug}`,
        title: d.title as string,
        description: d.description as string,
        level,
        unit: d.unit as string,
        order: d.order as number,
        type: d.type as LessonType,
        tags: d.tags as string[],
        prerequisites: d.prerequisites as string[],
        related: d.related as string[],
      },
    },
  };
}

const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** vocab is optional; when present, each item needs id, fr, pron and en. */
function parseVocab(value: unknown, errors: string[]): VocabItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`"vocab" must be a list`);
    return [];
  }
  return value.flatMap((item, i): VocabItem[] => {
    const v = (item ?? {}) as Record<string, unknown>;
    const where = `vocab[${i}]${isText(v.id) ? ` (${v.id})` : ""}`;
    const missing = ["id", "fr", "pron", "en"].filter((k) => !isText(v[k]));
    if (missing.length) errors.push(`${where}: missing ${missing.map((k) => `"${k}"`).join(", ")}`);
    for (const k of ["group", "note"]) if (v[k] !== undefined && !isText(v[k])) errors.push(`${where}: "${k}" must be text`);
    return missing.length ? [] : [v as VocabItem];
  });
}

/** exercises is optional; when present, each item is checked for its type's required fields. */
function parseExercises(value: unknown, errors: string[], level: unknown): Exercise[] {
  const belowB2 = LEVELS.includes(level as Level) && levelIndex(level as Level) < levelIndex("B2");
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`"exercises" must be a list`);
    return [];
  }
  return value.flatMap((item, i): Exercise[] => {
    const e = (item ?? {}) as Record<string, unknown>;
    const where = `exercises[${i}]${isText(e.id) ? ` (${e.id})` : ""}`;
    const before = errors.length;
    for (const k of ["id", "prompt", "explanation"]) if (!isText(e[k])) errors.push(`${where}: "${k}" is missing or empty`);
    if (!EXERCISE_TYPES.includes(e.type as ExerciseType)) {
      errors.push(`${where}: "type" must be one of ${EXERCISE_TYPES.join(", ")} (got ${JSON.stringify(e.type)})`);
    }
    if (belowB2 && B2_EXERCISE_TYPES.includes(e.type as ExerciseType)) {
      errors.push(`${where}: "${e.type}" exercises are only allowed from B2 on`);
    }
    if (!isStringArray(e.answers) || !e.answers.length) errors.push(`${where}: "answers" must be a non-empty list of strings`);
    if (OPTION_TYPES.includes(e.type as ExerciseType)) {
      if (!isStringArray(e.options) || e.options.length < 2) {
        errors.push(`${where}: ${e.type} needs "options" with at least 2 choices`);
      } else if (isStringArray(e.answers)) {
        for (const a of e.answers) if (!e.options.includes(a)) errors.push(`${where}: answer "${a}" is not one of the options`);
      }
    } else if (e.options !== undefined) {
      errors.push(`${where}: "options" is only allowed on multiple-choice and connector-choice exercises`);
    }
    if (e.type === "reorder") {
      if (!isStringArray(e.words) || !e.words.length) {
        errors.push(`${where}: reorder needs a non-empty "words" list`);
      } else if (isStringArray(e.answers)) {
        for (const a of e.answers) {
          if (!sameWords(e.words, a)) errors.push(`${where}: answer "${a}" doesn't use exactly the words in "words"`);
        }
      }
    } else if (e.words !== undefined) {
      errors.push(`${where}: "words" is only allowed on reorder exercises`);
    }
    if (e.strictAccents !== undefined && typeof e.strictAccents !== "boolean") {
      errors.push(`${where}: "strictAccents" must be true or false`);
    }
    if ((e.type === "fill-in" || e.type === "connector-choice") && isText(e.prompt) && !e.prompt.includes("___")) {
      errors.push(`${where}: ${e.type} prompts must mark the gap with ___`);
    }
    return errors.length > before ? [] : [e as unknown as Exercise];
  });
}

/** Course order: by level, then by order within the level. */
export function compareLessons(a: LessonMeta, b: LessonMeta): number {
  return levelIndex(a.level) - levelIndex(b.level) || a.order - b.order;
}

export function sortLessons(lessons: LessonMeta[]): LessonMeta[] {
  return [...lessons].sort(compareLessons);
}

/** Groups one level's lessons into units, ordered by each unit's first lesson. */
export function groupIntoUnits(levelLessons: LessonMeta[]): Unit[] {
  const units: Unit[] = [];
  for (const lesson of sortLessons(levelLessons)) {
    let unit = units.find((u) => u.name === lesson.unit);
    if (!unit) units.push((unit = { name: lesson.unit, lessons: [] }));
    unit.lessons.push(lesson);
  }
  return units;
}

// ---------- Syllabus (planned lessons) ----------

/** A lesson listed in docs/syllabus.md. It may or may not have a file yet. */
export type PlannedLesson = { id: string; title: string; level: Level; unit: string; type: LessonType };

/**
 * Reads the syllabus tables: a "## A1 …" heading sets the level, and each row
 * that starts with a number is `| # | id | title | unit | type | prerequisites | scope |`.
 */
export function parseSyllabus(markdown: string): PlannedLesson[] {
  const planned: PlannedLesson[] = [];
  let level: Level | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^## (A1|A2|B1|B2|C1|C2)\b/);
    if (heading) {
      level = heading[1] as Level;
      continue;
    }
    if (!level || !/^\|\s*\d+\s*\|/.test(line)) continue;
    const [, id, title, unit, type] = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (id) planned.push({ id, title, level, unit, type: type as LessonType });
  }
  return planned;
}

/** `file` overrides docs/syllabus.md (the validator uses it for test fixtures). A missing file means nothing is planned. */
export function readSyllabus(file?: string): PlannedLesson[] {
  const filePath = file ? path.resolve(/*turbopackIgnore: true*/ file) : path.join(process.cwd(), "docs", "syllabus.md");
  if (!fs.existsSync(filePath)) return [];
  return parseSyllabus(fs.readFileSync(filePath, "utf8"));
}

// ---------- Interconnections ----------

export type LessonConnections = {
  prerequisites: LessonMeta[]; // "Before this lesson"
  unlocks: LessonMeta[]; // lessons that list this one as a prerequisite (backlinks)
  related: LessonMeta[]; // from the related field, written lessons
  relatedPlanned: PlannedLesson[]; // from the related field, in the syllabus but not written yet
  sameTopic: LessonMeta[]; // shared tags, same or adjacent level, max 4
  prev: LessonMeta | null;
  next: LessonMeta | null;
};

const MAX_SAME_TOPIC = 4;

/** Pure: works on any list of lessons (already in course order) and any syllabus. */
export function computeConnections(
  lessons: LessonMeta[],
  id: string,
  planned: PlannedLesson[] = [],
): LessonConnections | null {
  const index = lessons.findIndex((l) => l.id === id);
  if (index === -1) return null;
  const lesson = lessons[index];
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const pick = (ids: string[]) => ids.map((i) => byId.get(i)).filter((l): l is LessonMeta => !!l);

  const prerequisites = pick(lesson.prerequisites);
  const unlocks = lessons.filter((l) => l.prerequisites.includes(id));
  const related = pick(lesson.related).filter((l) => !unlocks.includes(l)); // no repeats of "Builds on this"
  const relatedPlanned = lesson.related
    .filter((ref) => !byId.has(ref))
    .map((ref) => planned.find((p) => p.id === ref))
    .filter((p): p is PlannedLesson => !!p);

  // Don't repeat a lesson that's already listed in another section.
  const shown = new Set([id, ...[...prerequisites, ...unlocks, ...related].map((l) => l.id)]);
  const distance = (l: LessonMeta) => Math.abs(levelIndex(l.level) - levelIndex(lesson.level));
  const sameTopic = lessons
    .filter((l) => !shown.has(l.id) && distance(l) <= 1)
    .map((l) => ({ l, shared: l.tags.filter((t) => lesson.tags.includes(t)).length }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared || distance(a.l) - distance(b.l)) // stable: keeps course order on ties
    .slice(0, MAX_SAME_TOPIC)
    .map((x) => x.l);

  return {
    prerequisites,
    unlocks,
    related,
    relatedPlanned,
    sameTopic,
    prev: lessons[index - 1] ?? null,
    next: lessons[index + 1] ?? null,
  };
}

// ---------- Site API (what pages use) ----------

// The index keeps metadata only. Bodies, vocab and exercises are read from disk again by
// loadLessonFull, so nothing but metadata is held for the shell.
type ContentIndex = { lessons: LessonMeta[]; fileById: Map<string, { folder: string; slug: string }>; planned: PlannedLesson[] };

let cached: ContentIndex | null = null;

function load(): ContentIndex {
  if (cached) return cached;

  const parsed = readLessonSources().map((src) => ({ src, ...parseLesson(src) }));
  const broken = parsed.filter((p) => p.errors.length);
  if (broken.length) {
    const details = broken.map((p) => `  ${p.src.file}: ${p.errors.join("; ")}`).join("\n");
    throw new Error(`Invalid lesson frontmatter (run npm run validate:content):\n${details}`);
  }

  const lessons = parsed.map((p) => p.lesson!).sort((a, b) => compareLessons(a.meta, b.meta));
  const index: ContentIndex = {
    lessons: lessons.map((l) => l.meta),
    fileById: new Map(lessons.map((l) => [l.meta.id, { folder: levelToSlug(l.meta.level), slug: l.meta.slug }])),
    planned: readSyllabus(),
  };
  // Cache in production builds only, so edits show up immediately in dev.
  if (process.env.NODE_ENV === "production") cached = index;
  return index;
}

export function getAllLessons(): LessonMeta[] {
  return load().lessons;
}

export function getLessonById(id: string): LessonMeta | null {
  return getAllLessons().find((l) => l.id === id) ?? null;
}

/** A syllabus entry that has no file yet. Returns null once the lesson is written (use getLessonById then). */
export function getPlannedLesson(id: string): PlannedLesson | null {
  if (getLessonById(id)) return null;
  return load().planned.find((p) => p.id === id) ?? null;
}

/** Metadata only: safe for the page shell, generateMetadata and links. */
export function getLessonMeta(levelSlug: string, slug: string): LessonMeta | null {
  const level = levelFromSlug(levelSlug);
  if (!level || !SLUG_PATTERN.test(slug)) return null;
  return load().lessons.find((l) => l.level === level && l.slug === slug) ?? null;
}

/**
 * Reads the body, vocab and exercises of one lesson from disk. Requires a LessonAccess, which
 * only lib/auth.ts hands out, so a gated lesson can't be loaded without the server-side check.
 */
export function loadLessonFull(access: LessonAccess): LessonFull {
  const file = load().fileById.get(access.lessonId);
  if (!file) throw new Error(`Unknown lesson id: ${access.lessonId}`);
  const folderPath = path.join(process.cwd(), "content", "lessons", file.folder);
  const { data, content } = matter(fs.readFileSync(path.join(folderPath, `${file.slug}.mdx`), "utf8"));
  const { lesson, errors } = parseLesson({ file: `${file.folder}/${file.slug}.mdx`, folder: file.folder, slug: file.slug, data, content });
  if (!lesson) throw new Error(`Invalid lesson ${file.folder}/${file.slug}.mdx: ${errors.join("; ")}`);
  return { kind: "lesson-full", id: lesson.meta.id, body: lesson.content, vocab: lesson.vocab, exercises: lesson.exercises };
}

export function getLevelSummaries() {
  const lessons = getAllLessons();
  return LEVELS.map((level) => {
    const levelLessons = lessons.filter((l) => l.level === level);
    return {
      level,
      slug: levelToSlug(level),
      ...LEVEL_INFO[level],
      lessonCount: levelLessons.length,
      lessonIds: levelLessons.map((l) => l.id),
      unitCount: groupIntoUnits(levelLessons).length,
    };
  });
}

export function getLevel(levelSlug: string) {
  const level = levelFromSlug(levelSlug);
  if (!level) return null;
  const i = levelIndex(level);
  return {
    level,
    slug: levelSlug,
    ...LEVEL_INFO[level],
    units: groupIntoUnits(getAllLessons().filter((l) => l.level === level)),
    prevLevel: LEVELS[i - 1] ?? null,
    nextLevel: LEVELS[i + 1] ?? null,
  };
}

export function getLessonConnections(id: string): LessonConnections | null {
  const { lessons, planned } = load();
  return computeConnections(lessons, id, planned);
}
