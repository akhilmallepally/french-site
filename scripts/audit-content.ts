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
import { splitSections, teachingText, italicLines, resumeWords } from "./lesson-text.ts";
import { NEW_MEANINGS, dropsNe, passeSimpleForms } from "./b2-lists.ts";

type Vocab = { id: string; fr: string; pron?: string; en?: string; note?: string; group?: string };
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
  type?: string;
  unit?: string;
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

  // Words rendered in a piece of body text, except vocab tables.
  const renderedWords = (text: string) => {
    let b = text.replace(/<VocabTable[^>]*\/>/g, " ");
    b = b.replace(/<Example\b[^>]*\/>/g, (t) => ` ${attr(t, "fr") ?? ""} ${attr(t, "en") ?? ""} `);
    b = b.replace(/<LessonLink\b[^>]*\/>/g, (t) => ` ${attr(t, "text") ?? byId.get(attr(t, "id") ?? "")?.title ?? ""} `);
    b = b.replace(/<Callout\b[^>]*>/g, (t) => ` ${attr(t, "title") ?? ""} `).replace(/<[^>]+>/g, " ");
    b = b.replace(/^\|[\s:|-]+\|\s*$/gm, " ").replace(/[*|#]/g, " ");
    return countWords(b);
  };

  // Planned ids and titles from the syllabus, for the Coming soon check.
  const planned = new Map<string, string>();
  const plannedOrder = new Map<string, number>();
  const unitNumber = new Map<string, number>(); // lesson id -> unit number within its level
  let currentUnit = 0;
  for (const line of fs.readFileSync(path.join(ROOT, "docs", "syllabus.md"), "utf8").split(/\r?\n/)) {
    const u = line.match(/^### Unit (\d+)/);
    if (u) currentUnit = Number(u[1]);
    const m = line.match(/^\|\s*(\d+)\s*\|\s*([abc][12]-[^\s|]+)\s*\|\s*([^|]*?)\s*\|/);
    if (m) {
      planned.set(m[2], m[3]);
      plannedOrder.set(m[2], Number(m[1]));
      unitNumber.set(m[2], currentUnit);
    }
  }

  // B2 landmarks and helpers (see "B2 conventions" in CLAUDE.md).
  const PASSE_SIMPLE_FROM = plannedOrder.get("b2-arts-and-literature") ?? Infinity;
  const SPOKEN_FROM = Math.min(plannedOrder.get("b2-registers") ?? Infinity, plannedOrder.get("b2-colloquial-french") ?? Infinity);
  const PRODUCTION = new Set(["translate", "reformulation", "register-shift", "error-correction"]);
  const TYPED = new Set(["fill-in", ...PRODUCTION]);
  const normSentence = (s: string) => s.toLowerCase().normalize("NFC").replace(/[’]/g, "'").replace(/[\s.!?…«»"]+/g, " ").trim();
  // French sentences (three words or more) and tip texts, for the "copied from an earlier level" check.
  const sentencesOf = (l: AuditLesson) => [
    ...[...l.body.matchAll(/<Example fr="([^"]*)"/g)].map((m) => m[1]),
    ...splitSections(l.body).filter((s) => s.kind === "dialogue" || s.kind === "text").flatMap((s) => italicLines(s.body)),
  ].map(normSentence).filter((s) => s.split(" ").length >= 3);
  const tipsOf = (l: AuditLesson) => [...l.body.matchAll(/<Callout type="tip"[^>]*>([\s\S]*?)<\/Callout>/g)].map((m) => normSentence(m[1]));
  // Sentences, tips and vocab of the levels already passed in the loop below.
  const earlier = { sentences: new Map<string, string>(), tips: new Map<string, string>(), vocab: new Map<string, string>() };

  const P: Record<string, string[]> = {
    length: [], callout: [], prereq: [], dupVocab: [], dupTip: [], dupAns: [],
    strictAccented: [], strictPlain: [], mc: [], reorder: [], many: [], coming: [], noReorder: [],
    b2Length: [], b2Resume: [], b2Mix: [], b2VocabRepeat: [], b2Copied: [], b2PasseSimple: [], b2Spoken: [], b2Text: [], b2Unused: [],
  };
  let lastRank = -1;
  const pendingRank: AuditLesson[] = [];
  // Adds a finished level's sentences, tips and vocab to `earlier` once the loop reaches a higher level.
  const flushLevel = () => {
    for (const p of pendingRank) {
      for (const s of sentencesOf(p)) if (!earlier.sentences.has(s)) earlier.sentences.set(s, p.id);
      for (const s of tipsOf(p)) if (!earlier.tips.has(s)) earlier.tips.set(s, p.id);
      for (const v of p.vocab ?? []) {
        const k = String(v.fr).normalize("NFC").trim().toLowerCase();
        if (!earlier.vocab.has(k)) earlier.vocab.set(k, `${p.id} (${v.id})`);
      }
    }
    pendingRank.length = 0;
  };

  // B2 checks: lengths, En résumé, the exercise and vocab mix, repeats from earlier levels,
  // the passé simple, and spoken features in answers.
  function auditB2(l: AuditLesson, whole: number) {
    const type = l.type ?? "";
    const teach = renderedWords(teachingText(l.body));
    const maxTeach = type === "grammar" ? 1200 : 1100;
    if (teach < 800 || teach > maxTeach) P.b2Length.push(`${l.id}: teaching text ${teach} words (B2: 800 to ${maxTeach})`);
    if (whole > 1800) P.b2Length.push(`${l.id}: whole lesson ${whole} words (B2 cap: 1800)`);

    const sections = splitSections(l.body);
    const resumeAt = sections.findIndex((s) => s.kind === "resume");
    const needsResume = type === "grammar" || type === "vocabulary";
    if (needsResume && resumeAt < 0) P.b2Resume.push(`${l.id}: no En résumé section (${type} lesson)`);
    if (!needsResume && resumeAt >= 0) P.b2Resume.push(`${l.id}: ${type} lessons don't have an En résumé section`);
    if (resumeAt >= 0) {
      const words = resumeWords(l.body);
      const unit = unitNumber.get(l.id) ?? 0;
      const [lo, hi] = unit >= 5 ? [100, 150] : [60, 100];
      if (words < lo || words > hi) P.b2Resume.push(`${l.id}: En résumé ${words} words (unit ${unit || "?"}: ${lo} to ${hi})`);
      const after = sections.slice(resumeAt + 1).map((s) => s.heading);
      if (after.some((h) => h !== "What's next")) P.b2Resume.push(`${l.id}: En résumé should be the last section before What's next`);
    }

    const vocab = (l.vocab ?? []).filter((v) => v.group !== "glossary");
    const isReview = type === "review";
    const [vlo, vhi] = isReview ? [3, 8] : type === "grammar" ? [12, 30] : [15, 30];
    if (vocab.length < vlo || vocab.length > vhi) {
      P.b2Mix.push(`${l.id}: ${vocab.length} vocab entries, glossary excluded (B2${isReview ? " review" : ""}: ${vlo} to ${vhi})`);
    }
    const exs = l.exercises ?? [];
    const count = (pred: (e: Exercise) => boolean) => exs.filter(pred).length;
    const production = count((e) => PRODUCTION.has(e.type));
    const issues: string[] = [];
    if (exs.length < 14 || exs.length > 16) issues.push(`${exs.length} exercises (14 to 16)`);
    if (production < 3) issues.push(`${production} production tasks (at least 3)`);
    if (!count((e) => e.type === "reorder")) issues.push("no reorder");
    if (!count((e) => e.type === "reformulation")) issues.push("no reformulation");
    if (issues.length) P.b2Mix.push(`${l.id}: ${issues.join(", ")}`);
    const dialogue = sections.find((s) => s.kind === "dialogue");
    if (dialogue) {
      const lines = dialogue.body.split("\n").filter((x) => /^- /.test(x.trim())).length;
      if (lines < 10 || lines > 14) P.b2Mix.push(`${l.id}: dialogue has ${lines} lines (B2: 10 to 14)`);
    }
    if ((type === "communication" || type === "culture") && !sections.some((s) => s.kind === "text")) {
      P.b2Mix.push(`${l.id}: no longer-text section (${type} lesson)`);
    }
    // The longer text: French words in the longer-text sections (italic lines; translations and notes left out).
    if (type === "communication" || type === "culture") {
      const words = countWords(sections.filter((s) => s.kind === "text").flatMap((s) => italicLines(s.body)).join(" "));
      if (words && (words < 150 || words > 250)) P.b2Text.push(`${l.id}: longer text ${words} French words (B2: 150 to 250)`);
    }

    for (const v of l.vocab ?? []) {
      const k = String(v.fr).normalize("NFC").trim().toLowerCase();
      const first = earlier.vocab.get(k);
      if (first && !(k in NEW_MEANINGS)) {
        P.b2VocabRepeat.push(`${l.id} (${v.id}): "${v.fr}" repeats ${first}. List it in NEW_MEANINGS (scripts/b2-lists.ts) with the reason, or drop it.`);
      }
    }

    // Vocab used in a complete sentence: an Example, a dialogue or longer-text line, the En résumé,
    // an italic sentence in the teaching text, or an exercise sentence (fill-in gaps filled in).
    // A term that is only named (alone in italics, or quoted in « » in a prompt) doesn't count.
    const spans: string[] = [
      ...[...l.body.matchAll(/<Example fr="([^"]*)"/g)].map((m) => m[1]),
      ...sections.filter((s) => s.kind === "dialogue" || s.kind === "text").flatMap((s) => italicLines(s.body)),
      ...sections.filter((s) => s.kind === "resume").flatMap((s) => s.body.split(/(?<=[.!?])\s+/)),
      ...sections.filter((s) => s.kind === "teaching").flatMap((s) => [...s.body.matchAll(/\*([^*\n]+)\*/g)].map((m) => m[1])),
      ...exs.flatMap((e) => {
        // The instruction before the colon is its own sentence; quoted « » terms are only named.
        const raw = (e.prompt ?? "").replace(/«[^»]*»/g, " ");
        const cut = raw.indexOf(":");
        const instruction = cut >= 0 ? raw.slice(0, cut) : "";
        const prompt = cut >= 0 ? raw.slice(cut + 1) : raw;
        const filled = prompt.includes("___") ? (e.answers ?? []).map((a) => prompt.replace(/___/g, a)) : [prompt];
        return [instruction, ...filled, ...(e.answers ?? []), ...(e.options ?? [])];
      }),
    ];
    // Words without accents, so that céder matches cède; irregular verbs also match their common forms.
    const wordsOf = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-zœæ-]+/).filter(Boolean);
    const spanWords = spans.map(wordsOf);
    const STOP = new Set(["le", "la", "les", "l", "un", "une", "des", "de", "d", "du", "a", "au", "aux", "que", "qu", "se", "s", "en", "y", "et", "ou", "quelqu", "quelque", "chose", "on", "son", "sa", "ses", "ne", "pas"]);
    const IRREGULAR: Record<string, string[]> = {
      avoir: ["a", "ai", "as", "avoi", "avons", "avez", "avai", "avi", "ont", "eu", "aur", "ait", "aient", "ay"],
      etre: ["etre", "est", "suis", "es", "sommes", "etes", "sont", "ete", "etai", "etan", "ser", "soi", "soy", "fu"],
      faire: ["fai", "fais", "fait", "font", "fer", "fass"],
      aller: ["vais", "vas", "va", "vont", "all", "irai", "iras", "ira", "iron", "irez", "aill"],
      pouvoir: ["peu", "pouv", "pourr", "puiss", "pu"],
      mettre: ["met", "mis"], prendre: ["prend", "pren", "pris"], tenir: ["tien", "ten", "tin"],
      venir: ["vien", "ven", "vin"], devoir: ["doi", "dev", "du"], savoir: ["sai", "sav", "sach", "su", "saur"],
      dire: ["dis", "dit", "dir", "dise"], voir: ["voi", "voy", "vu", "verr"], atteindre: ["attei", "atteign"], elire: ["eli", "elu"],
      admettre: ["admet", "admis"], promettre: ["promet", "promis"], permettre: ["permet", "permis"],
    };
    // A compound such as revenir or maintenir takes the forms of its base verb, with its prefix.
    const stemsOf = (tk: string) => {
      if (IRREGULAR[tk]) return IRREGULAR[tk];
      const base = Object.keys(IRREGULAR).find((k) => k.length >= 4 && tk.length > k.length && tk.endsWith(k));
      if (base) return IRREGULAR[base].filter((st) => st.length >= 2).map((st) => tk.slice(0, -base.length) + st);
      return [tk.length <= 4 ? tk : tk.slice(0, Math.max(3, tk.length - 3))];
    };
    // Stems of one or two letters (a, es, va, vu) match whole words only.
    const matches = (tk: string, w: string) => stemsOf(tk).some((st) => (st.length <= 2 ? w === st : w.startsWith(st)));
    const usedIn = (fr: string) => fr.split(/\s*\/\s*/).some((form) => {
      const clean = form.replace(/\(.*?\)/g, " ").split("+")[0].replace(/[…!?.]/g, " ");
      const all = wordsOf(clean);
      const toks = all.filter((w) => !STOP.has(w));
      if (!toks.length) return true;
      return spanWords.some((sw) => sw.length > all.length && toks.every((tk) => sw.some((w) => matches(tk, w))));
    });
    for (const v of l.vocab ?? []) {
      if (!usedIn(String(v.fr))) P.b2Unused.push(`${l.id} (${v.id}): "${v.fr}" is never used in a complete sentence`);
    }

    for (const s of sentencesOf(l)) {
      const first = earlier.sentences.get(s);
      if (first) P.b2Copied.push(`${l.id}: "${s}" is also in ${first}`);
    }
    for (const s of tipsOf(l)) {
      const first = earlier.tips.get(s);
      if (first) P.b2Copied.push(`${l.id}: tip text copied from ${first}`);
    }

    const french = [
      ...[...l.body.matchAll(/<Example fr="([^"]*)"/g)].map((m) => m[1]),
      ...sections.filter((s) => s.kind !== "teaching").flatMap((s) => (s.kind === "resume" ? [s.body] : italicLines(s.body))),
      ...exs.flatMap((e) => [e.prompt ?? "", ...(e.answers ?? []), ...(e.options ?? [])]),
    ];
    if (l.order < PASSE_SIMPLE_FROM) {
      const forms = [...new Set(french.flatMap(passeSimpleForms))];
      if (forms.length) P.b2PasseSimple.push(`${l.id}: passé simple before lesson ${PASSE_SIMPLE_FROM} (${forms.join(", ")})`);
    }
    for (const e of exs) {
      if (!TYPED.has(e.type)) continue;
      const forms = [...new Set((e.answers ?? []).flatMap(passeSimpleForms))];
      if (forms.length) P.b2PasseSimple.push(`${l.id} / ${e.id}: passé simple in an answer the learner types (${forms.join(", ")})`);
      if (l.order < SPOKEN_FROM) {
        for (const a of e.answers ?? []) {
          if (dropsNe(a)) P.b2Spoken.push(`${l.id} / ${e.id}: dropped ne before lesson ${SPOKEN_FROM}: ${JSON.stringify(a)}`);
        }
      }
    }
  }
  const vocabMap = new Map<string, { lesson: string; id: string; fr: string }[]>();
  const tipMap = new Map<string, string[]>();

  for (const l of lessons) {
    if (l.rank !== lastRank) {
      flushLevel();
      lastRank = l.rank;
    }
    pendingRank.push(l);
    const whole = renderedWords(l.body);
    if (l.id.startsWith("b2-")) {
      auditB2(l, whole);
    } else if (l.id.startsWith("b1-")) {
      // B1: teaching text excludes dialogues and longer texts (see CLAUDE.md, B1 conventions).
      const teach = renderedWords(teachingText(l.body));
      if (teach < 600 || teach > 900) P.length.push(`${l.id}: teaching text ${teach} words (B1: 600 to 900)`);
      if (whole > 1300) P.length.push(`${l.id}: whole lesson ${whole} words (B1 cap: 1300)`);
    } else if (whole < 450 || whole > 1000) {
      P.length.push(`${l.id}: ${whole} words`);
    }

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
      if (TYPED.has(e.type) && e.strictAccents !== true) {
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
      if (e.type === "multiple-choice" || e.type === "connector-choice") {
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
    ["Lesson length (A1/A2: 450 to 1000 words; B1: teaching text 600 to 900, whole lesson up to 1300)", P.length],
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
    ["B2 length (teaching text 800 to 1100, 1200 for grammar; whole lesson up to 1800)", P.b2Length],
    ["B2 En résumé (grammar and vocabulary lessons only; 60 to 100 words in units 1 to 4, 100 to 150 in units 5 to 8)", P.b2Resume],
    ["B2 mix (vocab 15 to 30, 12 to 30 in grammar lessons, 3 to 8 in reviews; 14 to 16 exercises with 3 production, 1 reorder, 1 reformulation; dialogue 10 to 14 lines; a longer text in communication and culture lessons)", P.b2Mix],
    ["B2 vocab entry repeating an A1 to B1 entry (an error unless listed in NEW_MEANINGS)", P.b2VocabRepeat],
    ["B2 French sentence or tip identical to one in an earlier level", P.b2Copied],
    ["B2 passé simple before b2-arts-and-literature, or in an answer the learner types", P.b2PasseSimple],
    ["B2 dropped ne in an exercise answer before b2-registers", P.b2Spoken],
    ["B2 longer text outside 150 to 250 French words (communication and culture lessons)", P.b2Text],
    ["B2 vocab entry not used in a complete sentence (text, dialogue or exercise; naming or glossing it doesn't count)", P.b2Unused],
  ];
  const out = [
    "# Audit report", "", `Audited ${lessons.length} written lessons. Generated by \`npm run audit:content\`.`, "",
    "## How each check counts", "",
    "- Word counts cover everything rendered in the lesson body except vocab tables, including Example sentences, callouts and hand-written tables. For B1, the teaching text also leaves out dialogue and longer-text sections (sections made mostly of French text lines, and every En français section).",
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
