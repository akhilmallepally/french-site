// Dev script over untyped frontmatter data.
/* eslint-disable @typescript-eslint/no-explicit-any */
// Find where a phrase is taught in A1 to B2: prints each lesson id whose vocab or text contains it.
// Usage: node --experimental-strip-types scripts/c1-find.ts "de crainte que" "après que"
// A hit in the text isn't proof that the lesson teaches the phrase: read the line it shows.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const LEVELS = ["a1", "a2", "b1", "b2"];
const phrases = process.argv.slice(2);
if (!phrases.length) { console.log('Usage: c1-find.ts "phrase" ["phrase" ...]'); process.exit(1); }
const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[’]/g, "'").replace(/\*/g, "");

const lessons: { id: string; rank: number; order: number; vocab: string[]; body: string[] }[] = [];
for (const [rank, lv] of LEVELS.entries()) {
  const dir = path.join(process.cwd(), "content", "lessons", lv);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mdx"))) {
    const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
    lessons.push({ id: data.id, rank, order: data.order, vocab: (data.vocab ?? []).map((v: any) => String(v.fr)), body: content.split(/\r?\n/) });
  }
}
lessons.sort((a, b) => a.rank - b.rank || a.order - b.order);

for (const p of phrases) {
  const q = norm(p);
  const hits: string[] = [];
  for (const l of lessons) {
    const v = l.vocab.find((x) => norm(x).includes(q));
    if (v) { hits.push(`  ${l.id}  [vocab] ${v}`); continue; }
    const line = l.body.find((x) => norm(x).includes(q));
    if (line) hits.push(`  ${l.id}  [text] ${line.trim().slice(0, 100)}`);
  }
  console.log(`${p}: ${hits.length ? "" : "not found in A1 to B2"}`);
  for (const h of hits.slice(0, 4)) console.log(h);
  if (hits.length > 4) console.log(`  … and ${hits.length - 4} more`);
}
