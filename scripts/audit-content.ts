// Audits every written lesson and regenerates two reports:
//   docs/all-data.md      every lesson's vocab and exercises, in course order
//   docs/audit-report.md  the checks below, with a summary table
// Run: npm run audit:content
//
// The audit never fails the build. It only writes the reports and prints the summary.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { sameWords } from "../lib/check-answer.ts";

type Vocab = { id: string; fr: string; pron?: string; en?: string; note?: string };
type Exercise = {
  id: string;
  type: string;
  prompt?: string;
  options?: string[];
  words?: string[];
  answers?: string[];
  explanation?: string;
  strictAccents?: boolean;
};
type AuditLesson = {
  id: string;
  title: string;
  order: number;
  prerequisites?: string[];
  related?: string[];
  vocab?: Vocab[];
  exercises?: Exercise[];
  body: string;
  rank: number;
};

const ROOT = process.cwd();
const LESSONS_DIR = path.join(ROOT, "content", "lessons");
const LEVELS = ["a1", "a2", "b1", "b2", "c1", "c2"];

// Accent pairs a learner could confuse: unaccented spelling -> accented spelling.
const PAIRS: Record<string, string> = {
  a: "à", ou: "où", sur: "sûr", du: "dû", la: "là", passe: "passé",
  mange: "mangé", parle: "parlé", ete: "été", des: "dès",
};
const ACCENTED = new Set(Object.values(PAIRS));
// Pairs whose unaccented member may appear without strictAccents (see CLAUDE.md).
const PLAIN_ALLOWED = new Set(["la", "du", "des", "sur"]);

function readLessons(): AuditLesson[] {
  const lessons: AuditLesson[] = [];
  LEVELS.forEach((lv, rank) => {
    const dir = path.join(LESSONS_DIR, lv);
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".mdx")) continue;
      const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      lessons.push({ ...(data as Omit<AuditLesson, "body" | "rank">), body: content.replace(/\r\n/g, "\n"), rank });
    }
  });
  return lessons.sort((a, b) => a.rank - b.rank || a.order - b.order);
}

const one = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v).replace(/\s*\n\s*/g, " "));
const list = (v: unknown) => (Array.isArray(v) ? JSON.stringify(v) : "—");
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const normAns = (s: string) => strip(s).toLowerCase().replace(/[’ʼ`]/g, "'").replace(/[\s.!?…]+$/g, "").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(name + '="([^"]*)"'))?.[1] ?? null;
const countWords = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

function writeAllData(lessons: AuditLesson[]) {
  const out = ["# All lesson data", "", `${lessons.length} written lessons, in course order.`, ""];
  for (const l of lessons) {
    out.push(`## ${l.id}`, "", "### Vocab", "", "fr | pron | en | note", "");
    for (const v of l.vocab ?? []) out.push(`- ${one(v.fr)} | ${one(v.pron)} | ${one(v.en)} | ${one(v.note)}`);
    if (!(l.vocab ?? []).length) out.push("(none)");
    out.push("", "### Exercises", "", "id | type | prompt | options | answers | strictAccents | explanation", "");
    for (const e of l.exercises ?? []) {
      out.push(`- ${one(e.id)} | ${one(e.type)} | ${one(e.prompt)} | ${list(e.options)} | ${list(e.answers)} | ${e.strictAccents === true} | ${one(e.explanation)}`);
    }
    if (!(l.exercises ?? []).length) out.push("(none)");
    out.push("");
  }
  fs.writeFileSync(path.join(ROOT, "docs", "all-data.md"), out.join("\n"));
}

function audit(lessons: AuditLesson[]) {
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const titles = new Map(lessons.map((l) => [l.title, l.id]));

  // Teaching text: everything rendered in the body except vocab tables.
  const teachingWords = (l: AuditLesson) => {
    let b = l.body.replace(/<VocabTable[^>]*\/>/g, " ");
    b = b.replace(/<Example\b[^>]*\/>/g, (t) => ` ${attr(t, "fr") ?? ""} ${attr(t, "en") ?? ""} `);
    b = b.replace(/<LessonLink\b[^>]*\/>/g, (t) => ` ${attr(t, "text") ?? byId.get(attr(t, "id") ?? "")?.title ?? ""} `);
    b = b.replace(/<Callout\b[^>]*>/g, (t) => ` ${attr(t, "title") ?? ""} `).replace(/<[^>]+>/g, " ");
    b = b.replace(/^\|[\s:|-]+\|\s*$/gm, " ").replace(/[*|#]/g, " ");
    return countWords(b);
  };

  // Planned ids and titles from the syllabus, for the Coming soon check.
  const planned = new Map<string, string>();
  for (const line of fs.readFileSync(path.join(ROOT, "docs", "syllabus.md"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\|\s*\d+\s*\|\s*([abc][12]-[^\s|]+)\s*\|\s*([^|]*?)\s*\|/);
    if (m) planned.set(m[1], m[2]);
  }

  const P: Record<string, string[]> = {
    length: [], callout: [], prereq: [], dupVocab: [], dupTip: [], dupAns: [],
    strictAccented: [], strictPlain: [], mc: [], reorder: [], many: [], coming: [], noReorder: [],
  };
  const vocabMap = new Map<string, { lesson: string; id: string; fr: string }[]>();
  const tipMap = new Map<string, string[]>();

  for (const l of lessons) {
    const w = teachingWords(l);
    if (w < 450 || w > 1000) P.length.push(`${l.id}: ${w} words`);

    const callouts = l.body.match(/<Callout\b[^>]*>/g) ?? [];
    const types = callouts.map((t) => attr(t, "type"));
    const miss = [];
    if (!types.includes("warning")) miss.push("no warning callout");
    if (!types.includes("tip")) miss.push("no tip callout");
    if (miss.length) P.callout.push(`${l.id}: ${miss.join(", ")}`);
    for (const t of callouts) {
      if (attr(t, "type") !== "tip") continue;
      const k = attr(t, "title") ?? "(no title)";
      tipMap.set(k, [...(tipMap.get(k) ?? []), l.id]);
    }

    const prereqs = l.prerequisites ?? [];
    if (prereqs.length > 6 && !l.id.endsWith("review-final")) P.prereq.push(`${l.id}: ${prereqs.length} prerequisites`);

    for (const v of l.vocab ?? []) {
      const k = String(v.fr).normalize("NFC").trim().toLowerCase();
      vocabMap.set(k, [...(vocabMap.get(k) ?? []), { lesson: l.id, id: v.id, fr: v.fr }]);
    }

    const exs = l.exercises ?? [];
    if (!exs.some((e) => e.type === "reorder")) P.noReorder.push(l.id);
    for (const e of exs) {
      const ans = e.answers ?? [];
      for (let i = 0; i < ans.length; i++) {
        for (let j = i + 1; j < ans.length; j++) {
          if (normAns(ans[i]) === normAns(ans[j])) P.dupAns.push(`${l.id} / ${e.id}: ${JSON.stringify(ans[i])} and ${JSON.stringify(ans[j])}`);
        }
      }
      if ((e.type === "fill-in" || e.type === "translate") && e.strictAccents !== true) {
        const accented = new Set<string>();
        const plain = new Set<string>();
        for (const a of ans) {
          for (const tok of a.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)) {
            if (!(strip(tok) in PAIRS)) continue;
            if (ACCENTED.has(tok)) accented.add(tok);
            else if (!PLAIN_ALLOWED.has(tok)) plain.add(tok);
          }
        }
        const row = `${l.id} / ${e.id}: ${[...accented, ...plain].join(", ")} in ${JSON.stringify(ans)}`;
        if (accented.size) P.strictAccented.push(row);
        else if (plain.size) P.strictPlain.push(row);
      }
      if (e.type === "multiple-choice") {
        for (const a of ans) if (!(e.options ?? []).includes(a)) P.mc.push(`${l.id} / ${e.id}: answer ${JSON.stringify(a)} not in options ${JSON.stringify(e.options)}`);
      }
      if (e.type === "reorder") {
        for (const a of ans) if (!sameWords(e.words ?? [], a)) P.reorder.push(`${l.id} / ${e.id}: ${JSON.stringify(a)} vs chips ${JSON.stringify(e.words)}`);
      }
      if (ans.length > 5) P.many.push(`${l.id} / ${e.id}: ${ans.length} answers`);
    }

    // A link shows Coming soon when no lesson has its id. Flag planned ids whose file or title already exists.
    const targets: [string, string | null][] = [
      ...(l.body.match(/<LessonLink\b[^>]*>/g) ?? []).map((t): [string, string | null] => ["LessonLink", attr(t, "id")]),
      ...(l.related ?? []).map((r): [string, string | null] => ["related", r]),
    ];
    for (const [kind, id] of targets) {
      if (!id || byId.has(id) || !planned.has(id)) continue;
      const lv = id.slice(0, 2);
      const slug = id.replace(/^[abc][12]-/, "");
      const fileThere = fs.existsSync(path.join(LESSONS_DIR, lv, slug + ".mdx"));
      const sameTitle = titles.get(planned.get(id) ?? "");
      if (fileThere || sameTitle) {
        P.coming.push(`${l.id}: ${kind} ${id} shows Coming soon, but ${fileThere ? `the file ${lv}/${slug}.mdx exists` : `${sameTitle} has the same title`}`);
      }
    }
  }
  for (const rows of vocabMap.values()) {
    if (new Set(rows.map((r) => r.lesson)).size > 1) P.dupVocab.push(`${rows[0].fr}: ${rows.map((r) => `${r.lesson} (${r.id})`).join("; ")}`);
  }
  for (const [title, ids] of tipMap) if (ids.length > 1) P.dupTip.push(`"${title}": ${ids.join("; ")}`);

  const sections: [string, string[]][] = [
    ["Teaching text under 450 or over 1000 words", P.length],
    ["No warning callout or no tip callout", P.callout],
    ["More than six prerequisites (final reviews excepted)", P.prereq],
    ["Same French text in two lessons' vocab (informational only)", P.dupVocab],
    ["Two tips with the same title", P.dupTip],
    ["Answers differing only by accents, capitals, final punctuation or apostrophe style", P.dupAns],
    ["Typed exercise without strictAccents: accented member of a pair in the answer", P.strictAccented],
    ["Typed exercise without strictAccents: only the unaccented member of a pair in the answer (la, du, des, sur excluded)", P.strictPlain],
    ["Multiple-choice answer not exactly one of its options", P.mc],
    ["Reorder answer not using exactly the listed chips", P.reorder],
    ["More than five accepted answers", P.many],
    ["LessonLink or related entry showing Coming soon for a lesson that now exists", P.coming],
    ["Lesson with no reorder exercise", P.noReorder],
  ];
  const out = [
    "# Audit report", "", `Audited ${lessons.length} written lessons. Generated by \`npm run audit:content\`.`, "",
    "## How each check counts", "",
    "- Word counts cover everything rendered in the lesson body except vocab tables, including Example sentences, callouts and hand-written tables.",
    "- Reorder chips are compared with the site's own `sameWords`, which ignores capitals and punctuation.",
    "- The accent-pair check is split in two: answers containing the accented word, and answers containing only the unaccented one. The unaccented check skips la, du, des and sur, which may stay without strictAccents.",
    "- Duplicate vocab across lessons is informational only: recycling a word in a later lesson isn't a defect.",
    "- A link only shows Coming soon when no lesson has that id, so that check looks for planned ids whose file, or whose title, already exists.",
    "", "## Summary", "", "| Category | Problems |", "|---|---|",
  ];
  for (const [t, rows] of sections) out.push(`| ${t} | ${rows.length} |`);
  out.push("");
  for (const [t, rows] of sections) {
    out.push(`## ${t}`, "");
    if (rows.length) for (const r of rows) out.push(`- ${r}`);
    else out.push("None.");
    out.push("");
  }
  fs.writeFileSync(path.join(ROOT, "docs", "audit-report.md"), out.join("\n"));
  return sections;
}

const lessons = readLessons();
writeAllData(lessons);
const sections = audit(lessons);
console.log(`Audited ${lessons.length} lessons. Wrote docs/all-data.md and docs/audit-report.md.\n`);
console.log("| Category | Problems |\n|---|---|");
for (const [t, rows] of sections) console.log(`| ${t} | ${rows.length} |`);
