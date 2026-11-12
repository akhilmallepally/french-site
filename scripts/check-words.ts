// Lists French words that a lesson uses without defining them.
// Run: npm run check:words              (every lesson)
// Or:  npm run check:words -- b1        (one level)   npm run check:words -- b1-relative-dont   (one lesson)
//
// A word counts as defined when it (or an inflected form of it) appears in the vocab of this lesson
// or of any earlier lesson in course order. The script looks at Example sentences, dialogues and
// longer texts, and exercises. It skips proper names, English prompt text and the IGNORE list below.
// It also lists the labelled fixed phrases recorded in docs/review-needed.md; their words count as defined.
// From B2 on, it also reads the "En résumé" recap and whole French prompts, treats the cognate
// allowlist and the exercise instruction words (scripts/b2-lists.ts) as known, and lists glossary
// entries (vocab group "glossary") that no longer text in the lesson uses.
//
// The output is a to-do list; the script never fails.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { resumeFrench, splitSections, textSectionFrench } from "./lesson-text.ts";
import { COGNATES, INSTRUCTION_WORDS } from "./b2-lists.ts";

const B2_RANK = ["a1", "a2", "b1", "b2", "c1", "c2"].indexOf("b2"); // same order as LEVELS below

const ROOT = process.cwd();
const LESSONS_DIR = path.join(ROOT, "content", "lessons");
const LEVELS = ["a1", "a2", "b1", "b2", "c1", "c2"];

// Grammar words, names and places that never need a vocab entry. Extend as needed.
const IGNORE = new Set([
  "plains", "plaint", "plainte", "plaignons", "plaignez", "plaignent",
  "agissons", "agissez", "agissent", "agissions",
  "rex",
  // articles, pronouns, prepositions, conjunctions
  "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux", "à",
  "et", "ou", "mais", "ce", "ça", "cette", "ces", "cet", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos",
  "votre", "vos", "leur", "leurs", "me", "te", "se", "lui", "y", "en", "ne", "pas", "que", "qui", "où", "pour", "avec", "dans", "sur",
  "sous", "par", "très", "plus", "moins", "bien", "oui", "non", "si", "quand", "comme", "moi", "toi", "eux", "est", "es", "suis",
  "sont", "a", "as", "ai", "ont", "avons", "avez", "c", "j", "l", "d", "m", "t", "s", "n", "qu",
  // names and places used in examples
  "paul", "marie", "léa", "karim", "anne", "marc", "sophie", "julien", "inès", "thomas", "hugo", "camille", "malik", "lucie", "nadia",
  "léo", "julie", "pierre", "emma", "sarah", "clara", "henri", "jeanne", "lucas", "nina", "lisbonne", "portugal", "claire", "simenon", "truffaut", "godard", "françois", "jean-luc", "olivier", "nakache", "toledano", "éric", "antoine", "dany", "boon", "bretagne", "victor", "lyon", "paris", "nice", "lille", "dijon", "nantes", "rennes", "toulouse", "bordeaux", "annecy",
  "pleuvoir", "pleut", "pleuvait", "pleuvra", "plu", "pleuvrait",
  // irregular forms of verbs defined elsewhere
  "souviens", "souvient", "souviennent", "souvenons", "souvenez",
  "deviendrais", "deviendrait", "deviendrai", "deviendra", "aperçu", "aperçue", "disparu", "disparue", "paie", "paies", "nourrisse", "nourrisses", "envoie", "envoies", "préviens", "prévient", "prévienne", "préviennent",
  "réussisse", "comprennent", "compreniez", "agisse", "promis", "promise", "tiendrait", "tiendrais", "permis", "admis", "rappelle", "rappellent", "pourront", "convienne", "convient", "reviens", "atteint", "atteints", "reviendrait", "ouvert", "ouverte",
  // grammar terms and film titles
  "plus-que-parfait", "parfait", "souffle", "intouchables", "ch'tis",
  "montréal", "québec", "genève", "marseille", "rouen", "avignon", "cannes", "dupont", "martin", "dubois",
  "figaro", "libération", "ouest-france", "canard", "enchaîné", "afp", "télévisions", "ouest",
]);

// English words: a segment made largely of these is skipped, and so is any of these words on its own
// (English answer options and glosses). Extend as needed.
const ENGLISH = new Set(("the a an to of and in is are was it you i he she we they this that what which with for on at by from " +
  "your my his her their be do does did not no word all only one some have has had can will would should who where when why how " +
  "like very far today tomorrow yesterday first last every always never small large black milky tall short noon midnight ten o'clock " +
  "firstly three everywhere weather silent plural singular feminine masculine woman man vowel consonant cheese butter bread meat wine fish coffee tea milk " +
  "hands wave older senior person speaks saying hi informally ending formal customer team counting its own years year days books " +
  "sounds make starts call back right wrong composé or so delighted worried disappointed happy sad " +
  "here currently actually finally hours two five eight meal vouchers overtime").split(" "));

const ENDINGS = ["issaient", "issions", "issons", "issez", "issent", "issait", "aient", "erons", "eront", "erez", "erai", "eras", "era",
  "ions", "iez", "ons", "ez", "ent", "ais", "ait", "ant", "ées", "és", "ée", "é", "euses", "euse", "eux", "ives", "ive", "if", "elles", "elle",
  "nnes", "nne", "aux", "al", "ales", "ale", "ues", "ue", "is", "it", "es", "e", "s", "x", "er", "ir", "re", "ra", "oir", "t", "us", "u", "i", "ai", "as", "r"];
const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
function strip(word: string): string[] {
  const out: string[] = [];
  for (const end of ENDINGS) {
    if (word.endsWith(end) && word.length - end.length >= 3) out.push(word.slice(0, word.length - end.length));
  }
  return out;
}
// Roots of a word: the word, its stems with one ending removed, and those stems with one more ending
// removed (so prendrai → prendr → prend, réussira → réussi → réuss). Accentless versions too.
function roots(word: string): string[] {
  const out = new Set<string>([word]);
  for (const r of strip(word)) { out.add(r); for (const r2 of strip(r)) out.add(r2); }
  for (const r of [...out]) out.add(stripAccents(r));
  return [...out];
}
const tokens = (s: string) => s.toLowerCase().normalize("NFC").replace(/[’]/g, "'")
  .split(/[^a-zà-ÿœæç'-]+/)
  .flatMap((w) => w.split(/(?<=^(?:l|d|j|m|t|s|n|c|qu|jusqu|lorsqu|puisqu)')/))
  .flatMap((w) => w.split("-"))
  .map((w) => w.replace(/^'+|'+$/g, ""))
  .filter(Boolean);

// Proper names: capitalised words that don't start a sentence.
function names(s: string): Set<string> {
  const out = new Set<string>();
  const re = /(^|[.!?…:«»]\s*)?([A-ZÀ-ÖØ-Þ][a-zà-ÿ'-]+)/g;
  for (const m of s.matchAll(re)) if (m[1] === undefined) out.add(m[2].toLowerCase());
  return out;
}
// More English words, used only for B2 and later, whose prompts and options mix in English sentences.
// (Kept apart so that A1 to B1 results don't change.)
const B2_ENGLISH = new Set(("say another way purchasing power volunteers help homeless people before after leave rains rain if wait until although late going out we'll it's we're don't i'll i'd you're there's that's mixed strong opinion meaning sentence word despite age he's still working stand someone up everyone heard him nobody hear careful shy soon you've arrived glad came about yourself promise future reproach someone without moving polite left wing party voting twice hearing witness's managing well leaving early convincing isn't finished yet struggle find housing because rising flats building check " +
  "").trim().split(/\s+/));
const isEnglishWord = (w: string, b2 = false) => ENGLISH.has(w) || (b2 && B2_ENGLISH.has(w));
const isEnglish = (s: string, b2 = false) => {
  const t = tokens(s);
  return t.length > 0 && t.filter((w) => isEnglishWord(w, b2)).length / t.length >= 0.3;
};

type Exercise = { id: string; type: string; prompt?: string; options?: string[]; words?: string[]; answers?: string[] };
type Lesson = { id: string; order: number; rank: number; vocab?: { fr: string; group?: string }[]; exercises?: Exercise[]; body: string };

function readLessons(): Lesson[] {
  const lessons: Lesson[] = [];
  LEVELS.forEach((lv, rank) => {
    const dir = path.join(LESSONS_DIR, lv);
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".mdx")) continue;
      const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      lessons.push({ ...(data as Omit<Lesson, "body" | "rank">), body: content.replace(/\r\n/g, "\n"), rank });
    }
  });
  return lessons.sort((a, b) => a.rank - b.rank || a.order - b.order);
}

// Fixed phrases recorded in docs/review-needed.md: lines under "## <lesson-id>" that mention "fixed phrase".
function fixedPhrases(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const file = path.join(ROOT, "docs", "review-needed.md");
  if (!fs.existsSync(file)) return map;
  let current = "";
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const h = line.match(/^## ([abc][12]-[a-z0-9-]+)/);
    if (h) { current = h[1]; continue; }
    if (current && /fixed phrase/i.test(line)) {
      // drop bold markers first, so only the italic French is picked up
      const phrases = [...line.replace(/\*\*/g, "").matchAll(/\*([^*]+)\*/g)].map((m) => m[1]).filter((p) => !/fixed phrase/i.test(p));
      map.set(current, [...(map.get(current) ?? []), ...phrases]);
    }
  }
  return map;
}

// French segments a learner reads: examples, dialogues and longer texts, exercises.
function segments(l: Lesson): string[] {
  const b2 = l.rank >= B2_RANK;
  const out: string[] = [];
  for (const m of l.body.matchAll(/<Example fr="([^"]*)"/g)) out.push(m[1]);
  out.push(...textSectionFrench(l.body), ...resumeFrench(l.body));
  for (const e of l.exercises ?? []) {
    out.push(...(e.answers ?? []), ...(e.words ?? []));
    if (e.type === "multiple-choice") out.push(...(e.options ?? []));
    const p = e.prompt ?? "";
    if (l.rank >= B2_RANK) {
      // B2 prompts are French (instructions from the fixed list, then the sentence). The part
      // after the first colon is left out when it's an English sentence to translate.
      const q = p.replace(/\([^)]*\)/g, " ");
      const i = q.indexOf(": ");
      if (i < 0) out.push(q);
      else {
        out.push(q.slice(0, i));
        if (!isEnglish(q.slice(i + 2), b2)) out.push(q.slice(i + 2));
      }
    } else if (/___/.test(p) || /rewrite|filling each gap/i.test(p)) {
      const q = p.replace(/\([^)]*\)/g, " ");
      const i = q.indexOf(": ");
      out.push(i >= 0 ? q.slice(i + 2) : q);
    }
  }
  // answers and options that are only an ending (such as "-aient") aren't words
  return out.filter((s) => !isEnglish(s, b2) && !s.trim().startsWith("-"));
}

const filter = process.argv[2];
const lessons = readLessons();
const phrases = fixedPhrases();
const knownRoots = new Set<string>();
let total = 0;
const report: string[] = [];
for (const l of lessons) {
  for (const v of l.vocab ?? []) for (const w of tokens(v.fr)) for (const r of roots(w)) knownRoots.add(r);
  const fixed = phrases.get(l.id) ?? [];
  const fixedWords = new Set(fixed.flatMap(tokens));
  if (filter && !l.id.startsWith(filter) && !l.id.startsWith(filter + "-")) continue;
  const missing = new Map<string, string>();
  for (const s of segments(l)) {
    const skip = names(s);
    for (const w of tokens(s)) {
      if (IGNORE.has(w) || isEnglishWord(w, l.rank >= B2_RANK) || skip.has(w) || fixedWords.has(w) || w.length < 2) continue;
      if (l.rank >= B2_RANK && (COGNATES.has(w) || INSTRUCTION_WORDS.has(w))) continue;
      if (roots(w).some((r) => knownRoots.has(r))) continue;
      if (!missing.has(w)) missing.set(w, s.length > 70 ? s.slice(0, 70) + "…" : s);
    }
  }
  const lines: string[] = [];
  for (const [w, s] of missing) lines.push(`  ${w}  ←  ${s}`);
  if (l.rank >= B2_RANK) {
    // Glossary entries should gloss words of the lesson's longer texts.
    const texts = splitSections(l.body).filter((s) => s.kind === "text").map((s) => s.body.toLowerCase()).join("\n");
    for (const v of (l.vocab ?? []).filter((x) => x.group === "glossary")) {
      const head = tokens(v.fr).filter((w) => !IGNORE.has(w))[0];
      if (head && !texts.includes(head)) lines.push(`  [glossary] "${v.fr}" isn't used in any longer text`);
    }
  }
  for (const p of fixed) {
    const there = l.body.includes(p) || (l.exercises ?? []).some((e) => JSON.stringify(e).includes(p));
    lines.push(`  [fixed phrase] ${p}${there ? "" : "  (listed in review-needed.md but not found in the lesson)"}`);
  }
  if (lines.length) report.push(`${l.id}`, ...lines);
  total += missing.size;
}
console.log(report.join("\n"));
console.log(`\n${total} undefined word(s)${filter ? ` in ${filter}` : ""}.`);
