// C1 forward links: every <LessonLink> and `related` entry in a C1 lesson must point to a lesson that
// exists. Links to planned lessons are written as plain text and listed in docs/c1-forward-links.md;
// this script also reports a listed link whose target now exists, so that it gets restored.
// Run with: npm run check:c1-links
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const ROOT = process.cwd();
const ids = new Set<string>();
for (const lv of ["a1", "a2", "b1", "b2", "c1", "c2"]) {
  const d = path.join(ROOT, "content", "lessons", lv);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".mdx"))) ids.add(matter(fs.readFileSync(path.join(d, f), "utf8")).data.id);
}

const failures: string[] = [];
const dir = path.join(ROOT, "content", "lessons", "c1");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith(".mdx")) : [];
for (const f of files) {
  const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
  for (const m of content.matchAll(/<LessonLink\b[^>]*id="([^"]+)"/g)) {
    if (!ids.has(m[1])) failures.push(`${data.id}: LessonLink to missing lesson ${m[1]} (write it as plain text and list it in docs/c1-forward-links.md)`);
  }
  for (const r of (data.related ?? []) as string[]) {
    if (!ids.has(r)) failures.push(`${data.id}: related entry ${r} doesn't exist yet (remove it and list it in docs/c1-forward-links.md)`);
  }
}

// Pending links whose target has since been written.
const list = path.join(ROOT, "docs", "c1-forward-links.md");
if (fs.existsSync(list)) {
  for (const line of fs.readFileSync(list, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\|\s*(c1-[^\s|]+)\s*\|[^|]*\|\s*(c1-[^\s|]+)\s*\|/);
    if (m && ids.has(m[2])) failures.push(`${m[1]}: pending link to ${m[2]} can now be restored (the lesson exists)`);
  }
}

console.log(`c1-links: ${files.length} C1 lessons checked, ${failures.length} failure(s).`);
for (const f of failures) console.log(`  ${f}`);
if (failures.length) process.exit(1);
