// Dev script over untyped frontmatter data.
/* eslint-disable @typescript-eslint/no-explicit-any */
// C1 wrap-up audit: cross-level checks on all C1 lessons, written to docs/c1-wrapup.md.
// Run with: node --experimental-strip-types scripts/c1-wrapup.ts
// It never fails; read the report. The "Mechanical failures" count at the end should be 0.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { splitSections, teachingText, italicLines, resumeWords } from "./lesson-text.ts";
import { NEW_MEANINGS } from "./b2-lists.ts";

const ROOT = process.cwd();
const LEVELS = ["a1", "a2", "b1", "b2", "c1"];
type Lesson = { id: string; level: string; rank: number; order: number; unit: string; type: string; title: string; body: string; raw: string; vocab: any[]; exercises: any[]; prerequisites: string[] };

const lessons: Lesson[] = [];
for (const [rank, lv] of LEVELS.entries()) {
  const dir = path.join(ROOT, "content", "lessons", lv);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mdx"))) {
    const raw = fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");
    const { data, content } = matter(raw);
    lessons.push({ id: data.id, level: lv, rank, order: data.order, unit: data.unit, type: data.type, title: data.title, body: content, raw: raw.toLowerCase(), vocab: data.vocab ?? [], exercises: data.exercises ?? [], prerequisites: data.prerequisites ?? [] });
  }
}
lessons.sort((a, b) => a.rank - b.rank || a.order - b.order);
const byId = new Map(lessons.map((l) => [l.id, l]));
const c1 = lessons.filter((l) => l.level === "c1");
const earlier = lessons.filter((l) => l.rank < 4);

// Unit numbers, orders and unit names from the syllabus.
const syl = new Map<string, { unitNo: number; order: number; unit: string }>();
let cur = 0;
for (const line of fs.readFileSync(path.join(ROOT, "docs", "syllabus.md"), "utf8").split(/\r?\n/)) {
  const u = line.match(/^### Unit (\d+)/);
  if (u) cur = Number(u[1]);
  const m = line.match(/^\|\s*(\d+)\s*\|\s*(c1-[^\s|]+)\s*\|[^|]*\|\s*([^|]+?)\s*\|/);
  if (m) syl.set(m[2], { unitNo: cur, order: Number(m[1]), unit: m[3] });
}

const attr = (tag: string, name: string) => tag.match(new RegExp(name + '="([^"]*)"'))?.[1] ?? null;
const countWords = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const renderedWords = (text: string) => {
  let b = text.replace(/<VocabTable[^>]*\/>/g, " ");
  b = b.replace(/<Example\b[^>]*\/>/g, (t) => ` ${attr(t, "fr") ?? ""} ${attr(t, "en") ?? ""} `);
  b = b.replace(/<LessonLink\b[^>]*\/>/g, (t) => ` ${attr(t, "text") ?? byId.get(attr(t, "id") ?? "")?.title ?? ""} `);
  b = b.replace(/<Callout\b[^>]*>/g, (t) => ` ${attr(t, "title") ?? ""} `).replace(/<[^>]+>/g, " ");
  b = b.replace(/^\|[\s:|-]+\|\s*$/gm, " ").replace(/[*|#]/g, " ");
  return countWords(b);
};
const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[’]/g, "'").replace(/[«»"]/g, "").replace(/&quot;/g, "").replace(/\s+/g, " ").replace(/[\s.!?…]+$/, "").trim();
const sentencesOf = (l: Lesson) => [
  ...[...l.body.matchAll(/<Example fr="([^"]*)"/g)].map((m) => m[1]),
  ...splitSections(l.body).filter((s) => s.kind === "dialogue" || s.kind === "text").flatMap((s) => italicLines(s.body)),
].map(norm).filter((s) => s.split(" ").length >= 4);
const calloutTitles = (l: Lesson) => [...l.body.matchAll(/<Callout type="(\w+)" title="([^"]*)"/g)].map((m) => ({ type: m[1], title: norm(m[2]) }));
// Turn components into readable text before quoting a sentence: an Example becomes "fr (en)", a LessonLink its text.
const plain = (text: string) => text
  .replace(/<Example\b[^>]*\/>/g, (t) => `${attr(t, "fr") ?? ""} (${attr(t, "en") ?? ""})`)
  .replace(/<LessonLink\b[^>]*\/>/g, (t) => attr(t, "text") ?? byId.get(attr(t, "id") ?? "")?.title ?? attr(t, "id") ?? "")
  .replace(/<Callout\b[^>]*>/g, (t) => `${attr(t, "title") ?? ""}:`)
  .replace(/&quot;/g, '"');
const sentenceAround = (text: string, idx: number) => {
  const start = Math.max(text.lastIndexOf("\n", idx), text.lastIndexOf(". ", idx)) + 1;
  let end = text.indexOf("\n", idx); if (end < 0) end = text.length;
  const dot = text.indexOf(". ", idx); if (dot >= 0 && dot < end) end = dot + 1;
  return text.slice(start, end).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
};

const sections: string[][] = [];
let mechanical = 0;
const section = (title: string, rows: string[], counts = false) => {
  if (counts) mechanical += rows.length;
  sections.push([`## ${title}`, "", ...(rows.length ? rows.map((r) => `- ${r}`) : ["None."]), ""]);
};

// 1. Links.
const linkRows: string[] = [];
const forwardSignposts: string[] = [];
for (const l of c1) {
  if (l.prerequisites.length > 6 && l.id !== "c1-review-final") linkRows.push(`${l.id}: ${l.prerequisites.length} prerequisites (max 6)`);
  for (const p of l.prerequisites) if (!byId.has(p)) linkRows.push(`${l.id}: prerequisite ${p} has no lesson file`);
  const secs = splitSections(l.body);
  const next = secs.find((s) => s.heading === "What's next");
  if (!next) linkRows.push(`${l.id}: no What's next section`);
  else if (!/<LessonLink\b[^>]*id="([^"]+)"/.test(next.body)) linkRows.push(`${l.id}: What's next has no LessonLink`);
  for (const s of secs) for (const m of s.body.matchAll(/<LessonLink\b[^>]*id="([^"]+)"/g)) {
    const t = byId.get(m[1]);
    if (!t) { linkRows.push(`${l.id}: LessonLink to ${m[1]} has no lesson file`); continue; }
    if (t.rank === l.rank && t.order > l.order && s.heading !== "What's next") forwardSignposts.push(`${l.id} (order ${l.order}, "${s.heading}") → ${t.id} (order ${t.order})`);
  }
  for (const r of (matter(fs.readFileSync(path.join(ROOT, "content", "lessons", "c1", `${l.id.replace(/^c1-/, "")}.mdx`), "utf8")).data.related ?? []) as string[]) if (!byId.has(r)) linkRows.push(`${l.id}: related ${r} has no lesson file`);
  const s = syl.get(l.id);
  if (!s) linkRows.push(`${l.id}: not in docs/syllabus.md`);
  else {
    if (s.order !== l.order) linkRows.push(`${l.id}: order ${l.order}, syllabus says ${s.order}`);
    if (s.unit !== l.unit) linkRows.push(`${l.id}: unit "${l.unit}", syllabus says "${s.unit}"`);
  }
}
const fl = fs.readFileSync(path.join(ROOT, "docs", "c1-forward-links.md"), "utf8").split(/\r?\n/).filter((x) => /^\|\s*c1-/.test(x));
for (const row of fl) linkRows.push(`forward link still listed: ${row}`);

// 2. "You know X from Y" claims.
const claimRows: string[] = [];
const claimFlags: string[] = [];
for (const l of c1) {
  for (const para of l.body.split(/\n\n/)) {
    if (!/\b(?:you know|you've met|you met|you've seen|you learned|you've used|you've already|you recognize)\b/i.test(para)) continue;
    let prev = 0;
    for (const m of para.matchAll(/<LessonLink\b[^>]*id="([^"]+)"[^>]*\/>/g)) {
      const seg = para.slice(prev, m.index);
      prev = (m.index ?? 0) + m[0].length;
      const sentence = seg.split(/(?<=[.!?:;])\s+/).pop() ?? seg;
      if (!/\b(?:know|met|seen|learned|used|already|recognize)\b/i.test(sentence)) continue;
      const terms = [...sentence.replace(/\*\*[^*]+\*\*/g, " ").matchAll(/\*([^*]+)\*/g)].map((x) => x[1].trim()).filter((x) => x.length > 1);
      const target = byId.get(m[1]);
      for (const term of terms) {
        const flat = (x: string) => x.toLowerCase().replace(/…|\.\.\./g, " ").replace(/\s+/g, " ").trim();
        const ok = !!target && flat(target.raw).includes(flat(term));
        claimRows.push(`${l.id}: *${term}* from ${m[1]}: ${ok ? "found" : "NOT FOUND"}`);
        if (!ok) claimFlags.push(`${l.id}: *${term}* claimed from ${m[1]}, not found in its text or vocab`);
      }
    }
  }
}

// 3. Repeats.
const vocabRows: string[] = [];
const seenEarlier = new Map<string, string>();
for (const l of earlier) for (const v of l.vocab) { const k = norm(String(v.fr)); if (!seenEarlier.has(k)) seenEarlier.set(k, l.id); }
const seenC1 = new Map<string, string>();
for (const l of c1) for (const v of l.vocab) {
  const k = norm(String(v.fr));
  if (seenEarlier.has(k) && !(k in NEW_MEANINGS)) vocabRows.push(`${l.id} (${v.id}): "${v.fr}" repeats ${seenEarlier.get(k)}`);
  if (seenC1.has(k)) vocabRows.push(`${l.id} (${v.id}): "${v.fr}" is also an entry in ${seenC1.get(k)}`);
  else seenC1.set(k, l.id);
}
const sentRows: string[] = [];
const earlierSent = new Map<string, string>();
for (const l of earlier) for (const s of sentencesOf(l)) if (!earlierSent.has(s)) earlierSent.set(s, l.id);
const c1Sent = new Map<string, string>();
for (const l of c1) for (const s of new Set(sentencesOf(l))) {
  if (earlierSent.has(s)) sentRows.push(`${l.id}: "${s}" is also in ${earlierSent.get(s)}`);
  if (c1Sent.has(s)) sentRows.push(`${l.id}: "${s}" is also in ${c1Sent.get(s)}`);
  else c1Sent.set(s, l.id);
}
const titleRows: string[] = [];
const seenTitles = new Map<string, string>();
for (const l of [...earlier, ...c1]) for (const c of calloutTitles(l)) {
  const k = `${c.type}: ${c.title}`;
  if (seenTitles.has(k) && l.level === "c1") titleRows.push(`${l.id}: ${c.type} title "${c.title}" is also in ${seenTitles.get(k)}`);
  if (!seenTitles.has(k)) seenTitles.set(k, l.id);
}

// 4. Quotations: Examples whose French is a quotation in « », followed by an attribution in brackets.
const quoteRows: string[] = [];
const quoteFlags: string[] = [];
const quoteSeen = new Map<string, string>();
for (const l of c1) {
  const perAuthor = new Map<string, number>();
  for (const m of l.body.matchAll(/<Example fr="«\s*([^»]+?)\s*»\s*\(([^)]+)\)"/g)) {
    const quote = m[1].replace(/\[…\]/g, "").trim();
    const attrib = m[2].trim();
    const author = attrib.split(",")[0].trim();
    const year = attrib.match(/\b(1\d{3})\b/)?.[1] ?? (() => {
      const work = attrib.split(",")[1]?.trim();
      if (!work) return "";
      const near = l.body.match(new RegExp(`\\*${work.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*[^.]*?\\((\\d{4})`));
      return near?.[1] ?? "";
    })();
    const words = countWords(quote);
    quoteRows.push(`${l.id}: ${author} | ${attrib.split(",").slice(1).join(",").trim() || "(work named in the text)"} | ${year || "date in the text"} | ${words} words | « ${quote} »`);
    if (words >= 15) quoteFlags.push(`${l.id}: quotation of ${words} words (limit: under 15): « ${quote} »`);
    perAuthor.set(author, (perAuthor.get(author) ?? 0) + 1);
    const k = norm(quote);
    if (quoteSeen.has(k)) quoteFlags.push(`${l.id}: the same quotation is in ${quoteSeen.get(k)}: « ${quote} »`);
    else quoteSeen.set(k, l.id);
  }
  for (const [a, n] of perAuthor) if (n > 1 && !/^Constitution/.test(a)) quoteFlags.push(`${l.id}: ${n} quotations from ${a}`);
}

// 5. Dates.
const dateRows: string[] = [];
for (const l of c1) {
  const seen = new Set<string>();
  const texts = [plain(l.body), ...l.exercises.flatMap((e: any) => [e.prompt, ...(e.answers ?? []), e.explanation].filter(Boolean))];
  for (const t of texts) for (const m of String(t).matchAll(/\b(1[0-9]\d{2}|20\d{2})\b/g)) {
    const s = sentenceAround(String(t), m.index ?? 0);
    const k = `${m[1]}|${s}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dateRows.push(`${l.id} [${m[1]}]: ${s}`);
  }
}

// 6. Recurring invented places and people.
const NAMES = ["Saint-Aubin", "Saint-Rémy", "Saint-Jacques", "Montval", "Montvert", "Madame Morel", "Madame Garnier", "Madame Leroy", "Monsieur Dubois", "Monsieur Bernard", "Monsieur Petit", "Lucas Martin", "Léa Favre", "Claire Morand", "Claire Durand", "Adèle Morin", "Marthe", "Inès", "Karim", "Léa", "Julien", "Nadia", "Malik", "Clara", "Chloé", "Hugo", "Samira", "Paul"];
const placeRows: string[] = [];
for (const name of NAMES) {
  const hits: string[] = [];
  const re = new RegExp(`(?<![\\p{L}-])${name}(?![\\p{L}-])`, "u");
  for (const l of c1) {
    const lines = plain(l.body).split("\n").filter((x) => re.test(x) && !/^\(/.test(x.trim()));
    if (lines.length) hits.push(`${l.id}: ${lines.slice(0, 2).map((x) => x.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)).join(" / ")}`);
  }
  if (hits.length > 1) placeRows.push(`**${name}** (${hits.length} lessons): ${hits.join(" | ")}`);
}

// 7. Per unit, against the C1 limits.
const limitRows: string[] = [];
const PROD = ["translate", "reformulation", "register-shift", "error-correction"];
const units = new Map<string, Lesson[]>();
for (const l of c1) { if (!units.has(l.unit)) units.set(l.unit, []); units.get(l.unit)!.push(l); }
const statRows: string[] = ["| Unit | Lessons | Teaching words | Whole lesson | En résumé | Exercises | Production | Dialogue lines | Longer texts |", "|---|---|---|---|---|---|---|---|---|"];
const range = (a: number[]) => (a.length ? `${Math.min(...a)} to ${Math.max(...a)}` : "—");
for (const [unit, ls] of units) {
  const teach: number[] = [], whole: number[] = [], res: number[] = [], ex: number[] = [], prod: number[] = [], dl: number[] = [], lt: number[] = [];
  for (const l of ls) {
    const t = renderedWords(teachingText(l.body)); teach.push(t);
    const w = renderedWords(l.body); whole.push(w);
    const r = resumeWords(l.body); if (r) res.push(r);
    const p = l.exercises.filter((e) => PROD.includes(e.type)).length; prod.push(p); ex.push(l.exercises.length);
    const d = splitSections(l.body).find((s) => s.kind === "dialogue");
    const n = d ? d.body.split("\n").filter((x) => /^- /.test(x.trim())).length : 0; if (n) dl.push(n);
    const words = countWords(splitSections(l.body).filter((s) => s.kind === "text").flatMap((s) => italicLines(s.body)).join(" "));
    if (["communication", "culture", "review"].includes(l.type)) lt.push(words);
    const maxT = l.type === "grammar" ? 1300 : 1200;
    if (t < 900 || t > maxT) limitRows.push(`${l.id}: teaching text ${t} (900 to ${maxT})`);
    if (w >= 2100) limitRows.push(`${l.id}: whole lesson ${w} (under 2,100)`);
    const voc = l.vocab.filter((v) => v.group !== "glossary").length;
    const [lo, hi] = l.type === "review" ? [3, 8] : l.type === "grammar" ? [12, 30] : [15, 30];
    if (voc < lo || voc > hi) limitRows.push(`${l.id}: ${voc} vocab entries (${lo} to ${hi})`);
    if (l.exercises.length < 15 || l.exercises.length > 18) limitRows.push(`${l.id}: ${l.exercises.length} exercises (15 to 18)`);
    if (p < 4) limitRows.push(`${l.id}: ${p} production tasks (at least 4)`);
    if (!l.exercises.some((e) => e.type === "reorder")) limitRows.push(`${l.id}: no reorder`);
    if (!l.exercises.some((e) => e.type === "reformulation")) limitRows.push(`${l.id}: no reformulation`);
    if (n && (n < 12 || n > 16)) limitRows.push(`${l.id}: dialogue ${n} lines (12 to 16)`);
    if (["grammar", "vocabulary"].includes(l.type) && (r < 120 || r > 180)) limitRows.push(`${l.id}: En résumé ${r} (120 to 180)`);
    if (["communication", "culture", "review"].includes(l.type) && (words < 250 || words > 400)) limitRows.push(`${l.id}: longer text ${words} French words (250 to 400)`);
  }
  statRows.push(`| ${syl.get(ls[0].id)?.unitNo ?? "?"}. ${unit} | ${ls.length} | ${range(teach)} | ${range(whole)} | ${range(res)} | ${range(ex)} | ${range(prod)} | ${range(dl)} | ${range(lt)} |`);
}

section("Links, prerequisites, syllabus order", linkRows, true);
section("Claims not found in the linked lesson (mechanical: fix, or confirm by hand if the claim uses an inflected form)", claimFlags);
section("Vocab entries repeated (C1 vs A1 to B2 outside NEW_MEANINGS, and within C1)", vocabRows, true);
section("French sentences repeated (four words or more)", sentRows, true);
section("Callout titles repeated", titleRows, true);
section("Quotations flagged", quoteFlags, true);
section("Over a C1 limit", limitRows, true);
sections.push(["## Per unit", "", ...statRows, ""]);
section("Forward signposts outside What's next (judgement call)", forwardSignposts);
section("Quotations (author | work | date | words | text)", quoteRows);
section("Dates (check by hand)", dateRows);
section("Recurring invented places and people (check for contradictions)", placeRows);
section("All claims checked (for reference)", claimRows);

const header = [
  "# C1 wrap-up audit", "",
  `Generated by \`node --experimental-strip-types scripts/c1-wrapup.ts\`. ${c1.length} C1 lessons checked against ${earlier.length} A1 to B2 lessons.`, "",
  "## Judgement calls for the editor", "",
  ...fs.readFileSync(path.join(ROOT, "scripts", "c1-wrapup-judgements.md"), "utf8").trim().split(/\r?\n/), "",
  `**Mechanical failures: ${mechanical}** (links, vocab repeats, repeated sentences, callout titles, quotations, limits). Claim flags: ${claimFlags.length}.`, "",
];
fs.writeFileSync(path.join(ROOT, "docs", "c1-wrapup.md"), [...header, ...sections.flat()].join("\n"));
console.log(`c1-wrapup: ${linkRows.length} link rows, ${claimFlags.length} claim flags (of ${claimRows.length}), ${vocabRows.length} vocab repeats, ${sentRows.length} repeated sentences, ${titleRows.length} repeated callout titles, ${quoteRows.length} quotations (${quoteFlags.length} flagged), ${dateRows.length} dates, ${placeRows.length} recurring names, ${limitRows.length} limit rows. Mechanical failures: ${mechanical}.`);
