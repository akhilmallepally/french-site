// B2 links and ids: every LessonLink target exists (documented exceptions only), vocab ids follow
// the display order of the VocabTables, and each lesson's unit title matches its syllabus unit.
// Run with: node --experimental-strip-types scripts/b2-links-ids.ts
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const ROOT = process.cwd();
// Links to planned lessons that are allowed for now. Keep this list short and documented in docs/project-state.md.
// C1 pilot: the "What's next" links of c1-passe-anterieur and c1-stylistic-inversion point to the next planned lessons.
const ALLOWED_MISSING = new Set<string>(["c1-future-in-the-past", "c1-ne-expletif"]);

const ids = new Set<string>();
for (const lv of ["a1", "a2", "b1", "b2", "c1", "c2"]) {
  const d = path.join(ROOT, "content", "lessons", lv);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".mdx"))) ids.add(matter(fs.readFileSync(path.join(d, f), "utf8")).data.id);
}

// Syllabus: B2 lesson id -> unit title.
const unitOf = new Map<string, string>();
let level = "";
let title = "";
for (const line of fs.readFileSync(path.join(ROOT, "docs", "syllabus.md"), "utf8").split(/\r?\n/)) {
  const lv = line.match(/^##\s+(A1|A2|B1|B2|C1|C2)\b/);
  if (lv) level = lv[1];
  const u = line.match(/^### Unit \d+:\s*(.+)$/);
  if (u) title = u[1].trim();
  const m = line.match(/^\|\s*\d+\s*\|\s*((?:b2|c1)-[^\s|]+)\s*\|/);
  if (m) unitOf.set(m[1], title);
}

const failures: string[] = [];
const files = ["b2", "c1"].map((lv) => path.join(ROOT, "content", "lessons", lv)).filter((d) => fs.existsSync(d)).flatMap((d) => fs.readdirSync(d).filter((x) => x.endsWith(".mdx")).map((x) => path.join(d, x)));
for (const f of files) {
  const { data, content } = matter(fs.readFileSync(f, "utf8"));
  for (const m of content.matchAll(/<LessonLink\b[^>]*id="([^"]+)"/g)) {
    if (!ids.has(m[1]) && !ALLOWED_MISSING.has(m[1])) failures.push(`${data.id}: LessonLink to missing lesson ${m[1]}`);
  }
  const groups = [...content.matchAll(/<VocabTable(?:\s+group="([^"]+)")?\s*\/>/g)].map((m) => m[1] ?? "*");
  const rank = (g: string | undefined) => { const k = groups.indexOf(g ?? "*"); return k < 0 ? (groups.includes("*") ? 0 : 999) : k; };
  const vocab = (data.vocab ?? []) as any[];
  const nums = vocab.map((v) => Number(String(v.id).match(/-v(\d+)$/)?.[1]));
  const displayed = vocab.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v.group) - rank(b.v.group) || a.i - b.i).map((x) => Number(String(x.v.id).match(/-v(\d+)$/)?.[1]));
  if (displayed.some((n, i) => i > 0 && n < displayed[i - 1])) failures.push(`${data.id}: vocab ids not in display order (${displayed.join(",")})`);
  if (new Set(nums).size !== nums.length) failures.push(`${data.id}: duplicate vocab ids`);
  const expected = unitOf.get(data.id);
  if (!expected) failures.push(`${data.id}: not in the syllabus`);
  else if (expected !== data.unit) failures.push(`${data.id}: unit "${data.unit}" but syllabus says "${expected}"`);
}
console.log(`b2-links-ids: ${files.length} B2 and C1 lessons checked, ${failures.length} failure(s).`);
for (const f of failures) console.log(`  ${f}`);
if (failures.length) process.exit(1);
