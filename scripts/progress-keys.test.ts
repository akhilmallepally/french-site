// Lesson keys (Prompt 59 audit) and the progress actions' import chain.
// Run: npm run test:progress
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const root = process.cwd();
const index = JSON.parse(fs.readFileSync(path.join(root, "lib", "generated", "progress-index.json"), "utf8")) as {
  lessons: Record<string, { slug: string; exercises: string[]; writingTask?: string }>;
};

describe("lesson keys", () => {
  test("the colliding slugs belong to distinct lesson ids, whose exercise ids never overlap", () => {
    const bySlug = new Map<string, string[]>();
    for (const [id, l] of Object.entries(index.lessons)) bySlug.set(l.slug, [...(bySlug.get(l.slug) ?? []), id]);
    const shared = [...bySlug].filter(([, ids]) => ids.length > 1);
    assert.deepEqual(Object.fromEntries(shared), {
      "review-final": ["a1-review-final", "a2-review-final", "b1-review-final", "b2-review-final", "c1-review-final", "c2-review-final"],
      "review-work": ["a2-review-work", "b1-review-work", "b2-review-work"],
      "review-pronouns": ["a2-review-pronouns", "b2-review-pronouns"],
    });
    for (const [, ids] of shared) {
      const owners = new Map<string, string>();
      for (const id of ids) {
        for (const ex of [...index.lessons[id].exercises, ...(index.lessons[id].writingTask ? [index.lessons[id].writingTask!] : [])]) {
          assert.ok(ex.startsWith(`${id}-ex`), `${ex} starts with its lesson id`);
          assert.equal(owners.get(ex), undefined, `${ex} belongs to one lesson only`);
          owners.set(ex, id);
        }
      }
    }
  });

  test("every progress caller passes a lesson id, never a slug", () => {
    const sources = ["components/lesson-body.tsx", "app/lessons/[level]/page.tsx", "app/lessons/page.tsx", "lib/lessons.ts"].map((f) => fs.readFileSync(path.join(root, f), "utf8"));
    const all = sources.join("\n");
    assert.match(all, /<ExercisePlayer key=\{lesson\.id\} lessonId=\{lesson\.id\}/);
    assert.match(all, /<LessonStatus lessonId=\{l\.id\} \/>/);
    assert.match(all, /lessonIds: levelLessons\.map\(\(l\) => l\.id\)/);
    assert.match(all, /return \{ kind: "lesson-full", id: lesson\.meta\.id,/);
    for (const dir of ["app", "components"]) {
      for (const file of fs.readdirSync(path.join(root, dir), { recursive: true }) as string[]) {
        if (!/\.tsx?$/.test(file)) continue;
        const text = fs.readFileSync(path.join(root, dir, file), "utf8");
        assert.doesNotMatch(text, /lessonIds?=\{[^}]*slug/, `${dir}/${file} passes a slug as a lesson id`);
      }
    }
  });
});

// ---------- Import chain of the progress actions ----------

const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\b)(?:[^"'`;]*?\sfrom\s+)?["']([^"']+)["']/gm;

/** Local files reachable from `entry` through value imports (type-only imports are erased), plus bare packages. */
function importClosure(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [path.join(root, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    if (file.endsWith(".json")) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const [, spec] of text.matchAll(IMPORT_RE)) {
      const local = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : null;
      if (!local) {
        packages.add(spec);
        continue;
      }
      const found = [local, `${local}.ts`, `${local}.tsx`, path.join(local, "index.ts")].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      assert.ok(found, `${path.relative(root, file)} imports ${spec}, which doesn't resolve`);
      queue.push(found!);
    }
  }
  return { files: [...files].map((f) => path.relative(root, f).split(path.sep).join("/")).sort(), packages: [...packages].sort() };
}

describe("progress actions read no files", () => {
  for (const entry of ["app/actions/progress.ts", "app/actions/checkout.ts", "lib/progress-validate.ts", "lib/progress-sync.ts"]) {
    test(`${entry}: no fs, no lib/lessons.ts, no getProgressIndex()`, () => {
      const { files, packages } = importClosure(entry);
      assert.ok(!packages.some((p) => p === "fs" || p === "node:fs" || p.startsWith("fs/") || p.startsWith("node:fs/")), `packages: ${packages.join(", ")}`);
      assert.ok(!files.includes("lib/lessons.ts"), `reaches lib/lessons.ts: ${files.join(", ")}`);
      for (const f of files) {
        if (f.endsWith(".json")) continue;
        assert.doesNotMatch(fs.readFileSync(path.join(root, f), "utf8"), /getProgressIndex\s*\(/, `${f} calls getProgressIndex()`);
      }
    });
  }

  test("the progress action's whole local chain is exactly these files", () => {
    assert.deepEqual(importClosure("app/actions/progress.ts").files, [
      "app/actions/progress.ts",
      "lib/current-user.ts",
      "lib/generated/progress-index.json",
      "lib/progress-db.ts",
      "lib/progress-merge.ts",
      "lib/progress-sync.ts",
      "lib/progress-validate.ts",
      "lib/supabase/env.ts",
      "lib/supabase/server.ts",
    ]);
  });
});
