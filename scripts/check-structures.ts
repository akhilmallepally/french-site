// Lists B1 grammar structures that a lesson uses before the B1 lesson that teaches them.
// Run: npm run check:structures              (every B1 lesson)
// Or:  npm run check:structures -- b1-gerondif   (one lesson)
//
// The script scans what a learner reads as French: Example sentences, dialogues and longer texts,
// and exercises (prompts with a gap, answers, options and reorder chips). For each B1 lesson in
// course order, it reports every match of a structure whose teaching lesson comes later, with the
// line in the file. A match is ignored when it's part of a labelled fixed phrase recorded under the
// lesson in docs/review-needed.md, or part of a vocab entry of this or an earlier lesson (for example
// A2's "je voudrais"). The patterns are heuristics: read each hit before rewording.
//
// The output is a to-do list; the script never fails.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { textSectionFrench } from "./lesson-text.ts";

const ROOT = process.cwd();
const LESSONS_DIR = path.join(ROOT, "content", "lessons");
const LEVELS = ["a1", "a2", "b1", "b2", "c1", "c2"];

type Exercise = { id: string; type: string; prompt?: string; options?: string[]; words?: string[]; answers?: string[] };
type Lesson = { id: string; order: number; rank: number; level: string; file: string; raw: string; vocab?: { fr: string }[]; exercises?: Exercise[]; body: string };

function readLessons(): Lesson[] {
  const lessons: Lesson[] = [];
  LEVELS.forEach((lv, rank) => {
    const dir = path.join(LESSONS_DIR, lv);
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".mdx")) continue;
      const file = path.join(dir, f);
      const raw = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const { data, content } = matter(raw);
      lessons.push({ ...(data as Lesson), body: content, rank, level: lv, file, raw });
    }
  });
  return lessons.sort((a, b) => a.rank - b.rank || a.order - b.order);
}

// Fixed phrases recorded in docs/review-needed.md: italic spans on lines that mention "fixed phrase",
// under the "## <lesson-id>" heading (same rule as check-words.ts).
function fixedPhrases(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const file = path.join(ROOT, "docs", "review-needed.md");
  if (!fs.existsSync(file)) return map;
  let current = "";
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const h = line.match(/^## ([abc][12]-[a-z0-9-]+)/);
    if (h) { current = h[1]; continue; }
    if (current && /fixed phrase/i.test(line)) {
      const phrases = [...line.replace(/\*\*/g, "").matchAll(/\*([^*]+)\*/g)].map((m) => m[1]).filter((p) => !/fixed phrase/i.test(p));
      map.set(current, [...(map.get(current) ?? []), ...phrases]);
    }
  }
  return map;
}

const norm = (s: string) => s.toLowerCase().normalize("NFC").replace(/[’]/g, "'").replace(/\s+/g, " ");

// French segments a learner reads.
function segments(l: Lesson): string[] {
  const out: string[] = [];
  for (const m of l.body.matchAll(/<Example fr="([^"]*)"/g)) out.push(m[1]);
  out.push(...textSectionFrench(l.body));
  for (const e of l.exercises ?? []) {
    out.push(...(e.answers ?? []));
    if (e.type === "multiple-choice") out.push(...(e.options ?? []));
    const p = e.prompt ?? "";
    if (/___|«/.test(p) || /rewrite|filling each gap|report|join/i.test(p)) {
      const i = p.indexOf(": ");
      out.push((i >= 0 ? p.slice(i + 2) : p).replace(/\([^)]*\)/g, " "));
    }
  }
  return out;
}

// ---- Patterns ---------------------------------------------------------------------------------
const W = "[a-zàâäçéèêëîïôöûùüÿœ]";          // one French letter
const SUBJ = "(?:je|j'|tu|il|elle|on|nous|vous|ils|elles|ce|ça|cela)";
// irregular stems taught in b1-subjonctif-irregular (two-stem verbs like prenne, vienne, boive are in b1-subjonctif-formation)
const IRREG_SUBJ = "(?:sois|soit|soyons|soyez|soient|aie|aies|ait|ayons|ayez|aient|fasse|fasses|fassent|fassions|fassiez|puisse|puisses|puissent|puissions|puissiez|sache|saches|sachent|sachions|sachiez|aille|ailles|aillent|veuille|veuilles|veuillent|pleuve)";
const TWO_STEM_SUBJ = "(?:vienne|viennes|viennent|prenne|prennes|prennent|boive|boives|boivent|doive|doives|doivent)";
const PART = `${W}{2,}(?:é|ée|és|ées|i|ie|is|ies|u|ue|us|ues|it|ite|its|ites|ert|erte|erts|ertes|eint|einte|aint|ainte|ort|orte)`;
const ETRE_PART = "(?:allée?s?|venue?s?|arrivée?s?|partie?s?|sortie?s?|entrée?s?|restée?s?|tombée?s?|née?s?|morte?s?|montée?s?|descendue?s?|rentrée?s?|retournée?s?|devenue?s?|revenue?s?|passée?s?|disparue?s?)";
// participle-looking words that aren't participles after avoir/être
const NOT_PART = new Set(["du", "tu", "lui", "qui", "ici", "aussi", "oui", "si", "ni", "parmi", "plus", "dessus", "souci", "midi", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "ami", "amie", "amis", "amies", "fini", "petit", "petite", "petits", "lit", "nuit", "huit", "tout", "beaucoup"]);
// imparfait or non-verb words that end like the conditionnel
const NOT_COND = new Set(["frais", "vrais", "trait", "portrait", "extrait", "abstrait", "attrait", "rions", "ouvrais", "ouvrait", "ouvraient", "couvrait", "découvrait", "livrait", "durait", "assurait", "admirait", "tirait", "respirait", "désirait"]);

type Rule = { name: string; teaches: string; find: (s: string) => string[] };
const all = (re: RegExp) => (s: string) => [...s.matchAll(re)].map((m) => m[0]);

const RULES: Rule[] = [
  // "Qu'est-ce que vous feriez" and other conditionnel forms after que aren't subjunctives
  { name: "subjunctive (regular)", teaches: "b1-subjonctif-formation", find: (s) => [
    ...all(new RegExp(`(?<!est-ce )\\bqu(?:e\\s+|')${SUBJ}\\s+(?:ne\\s+|n')?${W}+(?:issions|issiez|isse|isses|issent|ions|iez)\\b`, "gi"))(s)
      .filter((m) => !/\b(?:avions|aviez|étions|étiez)\b/i.test(m) && !/(?:er|rr|dr|vr|ur|ir|ttr)(?:ions|iez)$/i.test(m)),
    ...all(new RegExp(`(?<!est-ce )\\bqu(?:e\\s+|')(?:${SUBJ}\\s+)?(?:ne\\s+|n')?${TWO_STEM_SUBJ}\\b`, "gi"))(s),
  ] },
  { name: "subjunctive (irregular)", teaches: "b1-subjonctif-irregular", find: all(new RegExp(`(?<!est-ce )\\bqu(?:e\\s+|')(?:${SUBJ}\\s+)?(?:ne\\s+|n')?${IRREG_SUBJ}\\b`, "gi")) },
  // the subjunctive lessons 20 to 22 all use il faut que as their frame
  { name: "subjunctive trigger (necessity)", teaches: "b1-subjonctif-formation", find: all(/\b(?:il faut|il vaut mieux|il est important|il est nécessaire|il est essentiel) qu(?:e\b|')/gi) },
  { name: "subjunctive trigger (wishes, emotions)", teaches: "b1-subjonctif-wishes-emotions", find: all(/\b(?:veux|veut|voulons|voulez|veulent|voudrais|voudrait|aimerais|aimerait|préfère|préfères|préfèrent|souhaite|souhaites|souhaitent|content|contente|contents|heureux|heureuse|triste|désolé|désolée|dommage|peur) qu(?:e\b|')/gi) },
  { name: "subjunctive trigger (conjunction)", teaches: "b2-subjunctive-conjunctions", find: all(/\b(?:pour|avant|bien|à moins|sans) qu(?:e\b|')/gi) },
  { name: "conditionnel", teaches: "b1-conditionnel-present", find: (s) => [...s.matchAll(new RegExp(`\\b${W}*(?:er|ir|rr|dr|vr|ur|ttr|îtr|aîtr)(?:ais|ait|ions|iez|aient)\\b`, "gi"))]
      .map((m) => m[0]).filter((w) => !NOT_COND.has(w.toLowerCase()) && !/(?:ouvr|couvr|livr)(?:ais|ait|ions|iez|aient)$/i.test(w)) },
  { name: "plus-que-parfait", teaches: "b1-plus-que-parfait", find: (s) => [
    ...[...s.matchAll(new RegExp(`\\b(?:avais|avait|avions|aviez|avaient)\\s+(?:(?:pas|déjà|jamais|bien|tout|rien|encore)\\s+)?(${PART})\\b`, "gi"))]
      .filter((m) => !NOT_PART.has(m[1].toLowerCase())).map((m) => m[0]),
    ...all(new RegExp(`\\b(?:étais|était|étions|étiez|étaient)\\s+(?:(?:pas|déjà|jamais|bien|encore)\\s+)?${ETRE_PART}\\b`, "gi"))(s),
    ...all(new RegExp(`\\b(?:m'|t'|s'|nous\\s+|vous\\s+)(?:étais|était|étions|étiez|étaient)\\s+(?:(?:pas|déjà|jamais|bien)\\s+)?${PART}\\b`, "gi"))(s),
  ] },
  { name: "gérondif", teaches: "b1-gerondif", find: (s) => [...s.matchAll(new RegExp(`\\ben\\s+(?:se\\s+|s'|me\\s+|m'|te\\s+|t'|nous\\s+|vous\\s+)?(${W}+ant)\\b`, "gi"))]
      .filter((m) => !/^(?:tant|avant|enfant)$/i.test(m[1])).map((m) => m[0]) },
  { name: "passive with par", teaches: "b1-passive-voice-intro", find: all(new RegExp(`\\b(?:est|sont|a été|ont été|était|étaient|sera|seront)\\s+(?:${PART})\\s+par\\b`, "gi")) },
  { name: "double pronouns", teaches: "b1-double-object-pronouns", find: (s) => [
    ...all(/\b(?:me|te|se)\s+(?:(?:le|la|les)\b|l')/gi)(s),
    ...all(/\b(?:je|tu|il|elle|on|ils|elles|ne|n')\s+(?:nous|vous)\s+(?:(?:le|la|les)\b|l')/gi)(s),
    ...all(/\b(?:le|la|les|l')\s*(?:lui|leur)\b/gi)(s),
    ...all(/(?:\bm'|\bt'|\bs'|\blui\s+|\bleur\s+)en\b/gi)(s),
    ...all(/\b(?:je|tu|il|elle|on|ils|elles|ne|n')\s+(?:nous|vous)\s+en\b/gi)(s),
    ...all(/-(?:le|la|les)-(?:moi|toi|lui|nous|vous|leur)\b|-(?:m'|t'|lui-|leur-)en\b/gi)(s),
  ] },
  { name: "dont", teaches: "b1-relative-dont", find: all(/\bdont\b/gi) },
  { name: "ce qui / ce que", teaches: "b1-ce-qui-ce-que", find: all(/(?<!est-)\bce\s+qu(?:i\b|e\b|')/gi) },
  { name: "lequel family", teaches: "b1-interrogative-lequel", find: all(/\b(?:lequel|laquelle|lesquels|lesquelles|auquel|auxquels|auxquelles|duquel|desquels|desquelles)\b/gi) },
  { name: "ne… que", teaches: "b1-ne-que-ni-ni", find: all(/\bn(?:e\s+|')(?!(?:\S+\s+){0,3}?(?:pas|plus|jamais|rien|personne|aucun|aucune)\b)(?:\S+\s+){1,3}?qu(?:e\b|')/gi) },
  { name: "ni… ni", teaches: "b1-ne-que-ni-ni", find: all(/\bni\b[^.?!]*?\bni\b/gi) },
  { name: "demonstrative pronoun", teaches: "b1-demonstrative-pronouns", find: all(/\b(?:celui|celle|ceux|celles)\b/gi) },
  { name: "possessive pronoun", teaches: "b1-possessive-pronouns", find: all(/\b(?:le|la|les)\s+(?:mien|mienne|miens|miennes|tien|tienne|tiens|tiennes|sien|sienne|siens|siennes|nôtre|nôtres|vôtre|vôtres)\b|\bles\s+leurs\b/gi) },
  { name: "reported speech", teaches: "b1-reported-speech-present", find: all(/\b(?:(?:me|te|lui|nous|vous|leur)\s+|m'|t')?(?:dit|dis|disent|demande|demandes|demandent|explique|expliquent|répond|répondent)\s+(?:que\b|qu'|si\b|s'il)/gi) },
];

// Line of the file where a match appears: the first line containing the match, preferring one that
// also contains the start of its segment.
function lineOf(l: Lesson, seg: string, match: string): number {
  const lines = l.raw.split("\n");
  const m = norm(match), head = norm(seg).slice(0, 25);
  let i = lines.findIndex((x) => norm(x).includes(head) && norm(x).includes(m));
  if (i < 0) i = lines.findIndex((x) => norm(x).includes(m));
  return i + 1;
}

const filter = process.argv[2];
const lessons = readLessons();
const order = new Map(lessons.filter((l) => l.level === "b1").map((l) => [l.id, l.order]));
const phrases = fixedPhrases();
const vocabSoFar: string[] = [];
const report: string[] = [];
let total = 0;
for (const l of lessons) {
  for (const v of l.vocab ?? []) vocabSoFar.push(norm(v.fr));
  if (l.level !== "b1") continue;
  if (filter && l.id !== filter) continue;
  const fixed = (phrases.get(l.id) ?? []).map(norm);
  const seen = new Set<string>();
  for (const seg of segments(l)) {
    for (const r of RULES) {
      const at = r.teaches.startsWith("b1-") ? order.get(r.teaches) ?? Infinity : Infinity;
      if (l.order >= at) continue;
      for (const hit of r.find(seg)) {
        const h = norm(hit);
        if (fixed.some((p) => p.includes(h)) || vocabSoFar.some((v) => v.includes(h))) continue;
        const line = lineOf(l, seg, hit);
        const key = `${r.name}|${line}|${h}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const where = at === Infinity ? `${r.teaches} (later level)` : `${r.teaches} (order ${at})`;
        report.push(`${l.id}:${line}  [${r.name}] "${hit}"  ← taught in ${where}`);
        total++;
      }
    }
  }
}
console.log(report.join("\n"));
console.log(`\n${total} structure hit(s)${filter ? ` in ${filter}` : " in B1"}.`);
