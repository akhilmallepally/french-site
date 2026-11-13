// Lists grammar structures that a lesson uses before the lesson that teaches them (B1 and later).
// Run: npm run check:structures              (every lesson from B1 on)
// Or:  npm run check:structures -- b1-gerondif   (one lesson)
//
// The script scans what a learner reads as French: Example sentences, dialogues and longer texts,
// exercises (prompts with a gap, answers, options and reorder chips) and, from B2, the "En résumé"
// recap and whole French prompts. For each lesson in course order, it reports every match of a
// structure whose teaching lesson comes later, with the line in the file. Teaching lessons that
// aren't written yet are placed by their order in docs/syllabus.md.
//
// A match is ignored when it's part of a labelled fixed phrase recorded under the lesson in
// docs/review-needed.md, or part of a vocab entry of this or an earlier lesson (for example A2's
// "je voudrais"). From B2, a longer text may use at most 2 untaught structures, each glossed in an
// English "Note:" line of the same section that names the form in italics; the script counts those
// against the cap and reports unglossed uses and uses over the cap. Rules marked `from: "b2"` only
// apply to B2 and later, so B1 results stay as they were. The patterns are heuristics: read each hit
// before rewording.
//
// The output is a to-do list; the script never fails.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { italicLines, resumeFrench, splitSections, textNotes } from "./lesson-text.ts";
import { passeSimpleForms } from "./b2-lists.ts";

const ROOT = process.cwd();
const LESSONS_DIR = path.join(ROOT, "content", "lessons");
const LEVELS = ["a1", "a2", "b1", "b2", "c1", "c2"];
const rankOf = (level: string) => LEVELS.indexOf(level);
const GLOSS_CAP = 2;

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

// Orders of planned lessons, from docs/syllabus.md (for teaching lessons not written yet).
function plannedOrders(): Map<string, number> {
  const map = new Map<string, number>();
  const file = path.join(ROOT, "docs", "syllabus.md");
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*([abc][12]-[^\s|]+)\s*\|/);
    if (m) map.set(m[2], Number(m[1]));
  }
  return map;
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

// French segments a learner reads. `section` is set for longer-text lines (the glossing rule).
type Seg = { text: string; section?: string };
function segments(l: Lesson): Seg[] {
  const b2 = l.rank >= rankOf("b2");
  const out: Seg[] = [];
  for (const m of l.body.matchAll(/<Example fr="([^"]*)"/g)) out.push({ text: m[1] });
  for (const s of splitSections(l.body)) {
    if (s.kind === "dialogue") out.push(...italicLines(s.body).map((text) => ({ text })));
    if (s.kind === "text") out.push(...italicLines(s.body).map((text) => ({ text, section: s.heading })));
  }
  if (b2) out.push(...resumeFrench(l.body).map((text) => ({ text })));
  for (const e of l.exercises ?? []) {
    out.push(...(e.answers ?? []).map((text) => ({ text })));
    if (e.type === "multiple-choice" || e.type === "connector-choice") out.push(...(e.options ?? []).map((text) => ({ text })));
    const p = e.prompt ?? "";
    if (b2) out.push({ text: p.replace(/\([^)]*\)/g, " ") });
    else if (/___|«/.test(p) || /rewrite|filling each gap|report|join/i.test(p)) {
      const i = p.indexOf(": ");
      out.push({ text: (i >= 0 ? p.slice(i + 2) : p).replace(/\([^)]*\)/g, " ") });
    }
  }
  return out;
}

// ---- Patterns ---------------------------------------------------------------------------------
// JavaScript's \b treats accented letters as non-word characters, so a pattern that starts with é or à
// uses a lookbehind on French letters instead.
const W = "[a-zàâäçéèêëîïôöûùüÿœ]";          // one French letter
const SUBJ = "(?:je|j'|tu|il|elle|on|nous|vous|ils|elles|ce|ça|cela)";
// irregular stems taught in b1-subjonctif-irregular (two-stem verbs like prenne, vienne, boive are in b1-subjonctif-formation)
const IRREG_SUBJ = "(?:sois|soit|soyons|soyez|soient|aie|aies|ait|ayons|ayez|aient|fasse|fasses|fassent|fassions|fassiez|puisse|puisses|puissent|puissions|puissiez|sache|saches|sachent|sachions|sachiez|aille|ailles|aillent|veuille|veuilles|veuillent|pleuve)";
const TWO_STEM_SUBJ = "(?:vienne|viennes|viennent|prenne|prennes|prennent|boive|boives|boivent|doive|doives|doivent)";
const PART = `${W}{2,}(?:é|ée|és|ées|i|ie|is|ies|u|ue|us|ues|it|ite|its|ites|ert|erte|erts|ertes|eint|einte|aint|ainte|ort|orte)`;
const ETRE_PART = "(?:allée?s?|venue?s?|arrivée?s?|partie?s?|sortie?s?|entrée?s?|restée?s?|tombée?s?|née?s?|morte?s?|montée?s?|descendue?s?|rentrée?s?|retournée?s?|devenue?s?|revenue?s?|passée?s?|disparue?s?)";
// participle-looking words that aren't participles after avoir/être
const NOT_PART = new Set(["du", "tu", "lui", "qui", "ici", "aussi", "oui", "si", "ni", "parmi", "plus", "dessus", "souci", "midi", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "ami", "amie", "amis", "amies", "fini", "petit", "petite", "petits", "lit", "nuit", "huit", "tout", "beaucoup"]);
// B2 rules: participle-looking words to skip ("il y aura lieu", "un peu"), and short participles
// that the general pattern misses.
const NOT_PART_B2 = new Set(["du", "tu", "lui", "qui", "ici", "aussi", "oui", "si", "ni", "parmi", "plus", "dessus", "souci", "midi", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "ami", "amie", "amis", "amies", "petit", "petite", "petits", "lit", "nuit", "huit", "tout", "beaucoup", "lieu", "peu", "feu", "jeu", "bleu", "beau"]);
const B2_PART = `(?:su|pu|eu|dû|vu|lu|bu|été|${PART})`;
// imparfait or non-verb words that end like the conditionnel
const NOT_COND = new Set(["frais", "vrais", "trait", "portrait", "extrait", "abstrait", "attrait", "rions", "ouvrais", "ouvrait", "ouvraient", "couvrait", "découvrait", "livrait", "durait", "assurait", "admirait", "tirait", "respirait", "désirait"]);
// -ant words that aren't present participles
const NOT_PRES_PART = new Set(["maintenant", "pendant", "avant", "cependant", "durant", "enfant", "enfants", "restaurant", "étudiant", "étudiants", "important", "intéressant", "suivant", "suivante", "devant", "souvent", "vraiment", "tant", "quant", "gant", "géant", "élégant", "amant", "instant", "habitant", "habitants", "passant", "commerçant", "commerçants", "dirigeant", "dirigeants", "méchant", "brillant", "charmant", "courant", "pourtant", "néanmoins"]);
// words ending -re, -ir or -er after faire that aren't infinitives
const NOT_INF_AFTER_FAIRE = new Set(["plaisir", "noir", "partie", "attention", "mal", "leur", "notre", "votre", "autre", "entre", "contre", "loisir", "désir", "avenir", "souvenir", "hier", "cher", "fier", "premier", "dernier", "métier", "quartier", "papier", "dîner", "déjeuner", "goûter", "boulanger", "foyer", "hiver", "mer", "ordre", "lettre"]);

type Rule = { name: string; teaches: string; from?: "b2"; find: (s: string) => string[] };
const all = (re: RegExp) => (s: string) => [...s.matchAll(re)].map((m) => m[0]);

const RULES: Rule[] = [
  // ---- B1 structures (unchanged) ----
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
  { name: "subjunctive trigger (conjunction)", teaches: "b2-subjunctive-conjunctions", find: all(/(?<![a-zàâäçéèêëîïôöûùüÿœ])(?:avant|bien|à moins|sans|jusqu'à ce|à condition) qu(?:e\b|')/gi) },
  // pour que belongs to b2-purpose-expressions (B2 plan, decision 5)
  { name: "subjunctive trigger (purpose)", teaches: "b2-purpose-expressions", find: all(/\bpour qu(?:e\b|')/gi) },
  { name: "conditionnel", teaches: "b1-conditionnel-present", find: (s) => [...s.matchAll(new RegExp(`\\b${W}*(?:er|ir|rr|dr|vr|ur|ttr|îtr|aîtr)(?:ais|ait|ions|iez|aient)\\b`, "gi"))]
      .map((m) => m[0]).filter((w) => !NOT_COND.has(w.toLowerCase()) && !/(?:ouvr|couvr|livr)(?:ais|ait|ions|iez|aient)$/i.test(w)) },
  { name: "plus-que-parfait", teaches: "b1-plus-que-parfait", find: (s) => [
    ...[...s.matchAll(new RegExp(`\\b(?:avais|avait|avions|aviez|avaient)\\s+(?:(?:pas|déjà|jamais|bien|tout|rien|encore)\\s+)?(${PART})\\b`, "gi"))]
      .filter((m) => !NOT_PART.has(m[1].toLowerCase())).map((m) => m[0]),
    ...all(new RegExp(`(?<![a-zàâäçéèêëîïôöûùüÿœ])(?:étais|était|étions|étiez|étaient)\\s+(?:(?:pas|déjà|jamais|bien|encore)\\s+)?${ETRE_PART}\\b`, "gi"))(s),
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

  // ---- B2 structures (B2 lessons and later only), in outline order ----
  { name: "concession connector", teaches: "b2-concession-opposition", from: "b2", find: all(/\b(?:pourtant|cependant|néanmoins|toutefois|en revanche|quoique|malgré)\b/gi) },
  { name: "purpose expression", teaches: "b2-purpose-expressions", from: "b2", find: all(/\b(?:afin qu(?:e\b|')|afin de|de peur qu(?:e\b|')|de crainte qu(?:e\b|')|de sorte qu(?:e\b|')|de façon à)/gi) },
  { name: "conditionnel passé", teaches: "b2-conditionnel-passe", from: "b2", find: (s) => [
    ...[...s.matchAll(new RegExp(`\\b(?:aurais|aurait|aurions|auriez|auraient)\\s+(?:(?:pas|déjà|jamais|bien)\\s+)?(${B2_PART})\\b`, "gi"))]
      .filter((m) => !NOT_PART_B2.has(m[1].toLowerCase())).map((m) => m[0]),
    ...all(new RegExp(`\\b(?:serais|serait|serions|seriez|seraient)\\s+(?:(?:pas|déjà|jamais)\\s+)?${ETRE_PART}\\b`, "gi"))(s),
  ] },
  { name: "si + plus-que-parfait", teaches: "b2-si-plus-que-parfait", from: "b2", find: (s) => [
    ...[...s.matchAll(new RegExp(`\\bs(?:i|')\\b[^.?!,]{0,25}?\\b(?:avais|avait|avions|aviez|avaient)\\s+(?:(?:pas|déjà|jamais)\\s+)?(${B2_PART})\\b`, "gi"))]
      .filter((m) => !NOT_PART_B2.has(m[1].toLowerCase())).map((m) => m[0]),
    ...all(new RegExp(`\\bs(?:i|')\\b[^.?!,]{0,25}?(?<![a-zàâäçéèêëîïôöûùüÿœ])(?:étais|était|étions|étiez|étaient)\\s+(?:(?:pas|déjà|jamais)\\s+)?${ETRE_PART}\\b`, "gi"))(s),
  ] },
  { name: "futur antérieur", teaches: "b2-futur-anterieur", from: "b2", find: (s) => [
    ...[...s.matchAll(new RegExp(`\\b(?:aurai|auras|aura|aurons|aurez|auront)\\s+(?:(?:pas|déjà|bien)\\s+)?(${B2_PART})\\b`, "gi"))]
      .filter((m) => !NOT_PART_B2.has(m[1].toLowerCase())).map((m) => m[0]),
    ...all(new RegExp(`\\b(?:serai|seras|sera|serons|serez|seront)\\s+(?:(?:pas|déjà)\\s+)?${ETRE_PART}\\b`, "gi"))(s),
  ] },
  { name: "subjonctif passé", teaches: "b2-subjonctif-passe", from: "b2", find: (s) => [
    ...[...s.matchAll(new RegExp(`\\bqu(?:e\\s+|')(?:${SUBJ}\\s+)?(?:ne\\s+|n')?(?:aie|aies|ait|ayons|ayez|aient)\\s+(?:(?:pas|déjà|jamais)\\s+)?(${B2_PART})\\b`, "gi"))]
      .filter((m) => !NOT_PART_B2.has(m[1].toLowerCase())).map((m) => m[0]),
    ...all(new RegExp(`\\bqu(?:e\\s+|')(?:${SUBJ}\\s+)?(?:ne\\s+|n')?(?:sois|soit|soyons|soyez|soient)\\s+(?:(?:pas|déjà)\\s+)?${ETRE_PART}\\b`, "gi"))(s),
  ] },
  { name: "reported speech (past)", teaches: "b2-reported-speech-past", from: "b2", find: all(/\b(?:a|ont|avait|avaient)\s+(?:dit|demandé|expliqué|répondu|annoncé|affirmé|déclaré|précisé|raconté)\s+(?:que\b|qu'|si\b|s'il)/gi) },
  { name: "reported order", teaches: "b2-reported-questions-orders", from: "b2", find: all(new RegExp(`\\b(?:dit|dis|disent|demande|demandent|demandé|ordonne|ordonné|conseille|conseillé)\\s+(?:à\\s+\\S+\\s+)?de\\s+(?:ne\\s+pas\\s+)?${W}+(?:er|ir|re|oir)\\b`, "gi")) },
  { name: "passive (other tenses)", teaches: "b2-passive-voice", from: "b2", find: all(new RegExp(`\\b(?:sera|seront|serait|seraient|était|étaient|avait été|avaient été|aura été|auront été|soit|soient|fut|furent|être)\\s+(?:${PART})\\s+par\\b`, "gi")) },
  { name: "alternative to the passive", teaches: "b2-alternatives-to-passive", from: "b2", find: all(new RegExp(`\\bs(?:e\\s+|')(?:fait|font|faire|est fait|sont fait|voit|voient|voir|est vu|est vue)\\s+${W}+(?:er|ir|re)\\b`, "gi")) },
  { name: "relative lequel", teaches: "b2-relative-lequel", from: "b2", find: (s) =>
      [...s.matchAll(/\b(?:avec|pour|sans|sur|dans|par|chez|vers|entre|parmi|sous|à|de)\s+(?:lequel|laquelle|lesquels|lesquelles)\b|\b(?:auquel|auxquels|auxquelles|duquel|desquels|desquelles)\b/gi)]
        // "Avec lequel ?", "Auquel ?": the B1 question, at the start of a question
        .filter((m) => !((m.index ?? 0) < 12 && /\?\s*$/.test(s))).map((m) => m[0]) },
  { name: "preposition + relative pronoun", teaches: "b2-relative-prepositions", from: "b2", find: (s) => [
    ...all(/\bce\s+(?:à|sur|avec|contre|de|pour)\s+quoi\b/gi)(s),
    ...all(new RegExp(`\\b${W}{3,}\\s+(?:avec|pour|chez|contre|sans|à)\\s+qui\\s+(?:je|j'|tu|il|elle|on|nous|vous|ils|elles)\\b`, "gi"))(s),
  ] },
  { name: "subjunctive in a relative clause", teaches: "b2-subjunctive-relative-clauses", from: "b2", find: all(new RegExp(`\\b(?:cherche|cherches|cherchons|cherchez|cherchent|seul|seule|premier|première|dernier|dernière|meilleur|meilleure|aucun|aucune)\\b[^.?!]{0,40}?\\bqu(?:i|e|')\\s+(?:${SUBJ}\\s+)?(?:${IRREG_SUBJ}|${TWO_STEM_SUBJ})\\b`, "gi")) },
  { name: "idiomatic y / en", teaches: "b2-idiomatic-y-en", from: "b2", find: all(/\b(?:m'en|t'en|s'en|nous en|vous en)\s+(?:vais|vas|va|allons|allez|vont|aller|veux|veut|voulons|voulez|veulent|vouloir|fiche|fous|sortir|sors|sort)\b|\ben avoir (?:marre|assez)\b|\bj'en ai (?:marre|assez)\b|\bs'y (?:prendre|faire|connaître)\b/gi) },
  { name: "mise en relief", teaches: "b2-mise-en-relief", from: "b2", find: all(/\bc'est\s+(?:moi|toi|lui|elle|nous|vous|eux|elles)\s+qu[ie']|\bc'est\s+(?:à|en|pour|dans|avec|par|grâce à)\s+[^,.?!]{1,30}?\s+qu(?:e\b|')/gi) },
  { name: "faire causatif", teaches: "b2-faire-causatif", from: "b2", find: (s) =>
      [...s.matchAll(new RegExp(`\\b(?:fais|fait|faisons|faites|font|faire|ferai|feras|fera|ferons|ferez|feront|ferais|ferait|faisais|faisait|fasse)\\s+(${W}+(?:er|ir|re|oir))\\b`, "gi"))]
        .filter((m) => !NOT_INF_AFTER_FAIRE.has(m[1].toLowerCase())).map((m) => m[0]) },
  { name: "present participle", teaches: "b2-participles-and-gerund", from: "b2", find: (s) =>
      [...s.matchAll(new RegExp(`(?:^|,\\s+)(${W}+ant)\\s+(?:le|la|les|l'|un|une|des|du|de|d'|à|au|aux|que|qu'|en|son|sa|ses)\\b`, "gi"))]
        .filter((m) => !NOT_PRES_PART.has(m[1].toLowerCase())).map((m) => m[0].replace(/^,\s+/, "")) },
  // "après avoir" + participle is a B1 fixed phrase (b1-time-connectors)
  { name: "past infinitive", teaches: "b2-infinitif-passe", from: "b2", find: (s) =>
      [...s.matchAll(new RegExp(`\\b(?:sans|de|d'|pour|avant d')\\s*(?:avoir|être)\\s+(?:(?:pas|déjà|bien)\\s+)?(${B2_PART}|${ETRE_PART})\\b`, "gi"))]
        .filter((m) => !NOT_PART_B2.has(m[1].toLowerCase())).map((m) => m[0]) },
  { name: "logical connector", teaches: "b2-logical-connectors", from: "b2", find: all(/(?<![a-zàâäçéèêëîïôöûùüÿœ])(?:par conséquent|d'ailleurs|en effet|en outre|de ce fait|étant donné qu(?:e\b|')|vu qu(?:e\b|')|du fait qu(?:e\b|')|faute de|à force de|si bien qu(?:e\b|')|autrement dit|en somme|soit\b[^.?!]{1,40}?\bsoit|ou bien)/gi) },
  // il semble que is taught earlier, in b2-nuancing-opinions
  { name: "certainty and probability", teaches: "b2-certainty-and-probability", from: "b2", find: all(/\b(?:il se peut qu|il est (?:peu |très |fort )?probable qu|il est possible qu|il paraît probable qu|le fait qu)(?:e\b|')/gi) },
  { name: "concessive relative", teaches: "b2-relative-prepositions", from: "b2", find: all(/(?<![a-zàâäçéèêëîïôöûùüÿœ])(?:quoi qu(?:e\b|')|qui que\b|où que\b)/gi) },
  { name: "passé simple", teaches: "b2-arts-and-literature", from: "b2", find: passeSimpleForms },
  // C1 literary tenses. The passé antérieur rule only looks at avoir + participle, because fut + participle is also the passé simple passive.
  { name: "passé antérieur", teaches: "c1-passe-anterieur", from: "b2", find: all(/(?<![a-zàâçéèêëîïôûùüÿœ])(?:eus|eut|eûmes|eûtes|eurent)\s+[a-zàâçéèêëîïôûùüÿœ]+(?:é|i|u|is|it|ert|int|uit)(?![a-zàâçéèêëîïôûùüÿœ])/gi) },
  { name: "imparfait du subjonctif", teaches: "c1-imperfect-subjunctive", from: "b2", find: all(/(?<![a-zàâçéèêëîïôûùüÿœ])qu(?:'|e\s+)(?:il|elle|on|ils|elles|je|tu|nous|vous)\s+(?:fût|eût|fît|vînt|fussent|eussent|fissent|vinssent|fusse|eusse|pût|sût)(?![a-zàâçéèêëîïôûùüÿœ])/gi) },
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
// Where each teaching lesson sits: its file if it's written, otherwise its planned order.
const planned = plannedOrders();
const written = new Map(lessons.map((l) => [l.id, { rank: l.rank, order: l.order }]));
const positionOf = (id: string) => written.get(id) ?? (planned.has(id) ? { rank: rankOf(id.slice(0, 2)), order: planned.get(id)! } : null);
const phrases = fixedPhrases();
const vocabSoFar: string[] = [];
const report: string[] = [];
let total = 0;
for (const l of lessons) {
  for (const v of l.vocab ?? []) vocabSoFar.push(norm(v.fr));
  if (l.rank < rankOf("b1")) continue;
  if (filter && l.id !== filter) continue;
  const fixed = (phrases.get(l.id) ?? []).map(norm);
  const notes = textNotes(l.body).map((n) => ({ heading: n.heading, forms: n.forms.map(norm) }));
  const glossed: string[] = [];
  const glossForms = new Set<string>(); // distinct glossed forms: one Note can cover a form two rules match
  const seen = new Set<string>();
  for (const seg of segments(l)) {
    for (const r of RULES) {
      if (r.from === "b2" && l.rank < rankOf("b2")) continue;
      const at = positionOf(r.teaches);
      // Same output as before for B1: a teaching lesson at a higher level is "later level".
      if (at && (l.rank > at.rank || (l.rank === at.rank && l.order >= at.order))) continue;
      for (const hit of r.find(seg.text)) {
        const h = norm(hit);
        if (fixed.some((p) => p.includes(h)) || vocabSoFar.some((v) => v.includes(h))) continue;
        const line = lineOf(l, seg.text, hit);
        const key = `${r.name}|${line}|${h}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // B2 longer texts: a use glossed in a Note line of the same section counts against the cap.
        const note = seg.section !== undefined && l.rank >= rankOf("b2")
          ? notes.find((n) => n.heading === seg.section && n.forms.some((f) => f.includes(h) || h.includes(f)))
          : undefined;
        const form = note?.forms.find((f) => f.includes(h) || h.includes(f));
        const isGlossed = form !== undefined;
        if (form !== undefined) {
          glossForms.add(form);
          glossed.push(`${r.name}: "${hit}"`);
          if (glossForms.size <= GLOSS_CAP) continue;
        }
        const where = !at ? `${r.teaches} (not in the syllabus)` : at.rank > l.rank ? `${r.teaches} (later level)` : `${r.teaches} (order ${at.order})`;
        const extra = isGlossed ? ` (glossed, but over the cap of ${GLOSS_CAP} per lesson)` : seg.section ? " (longer text: gloss it in a Note line, or reword)" : "";
        report.push(`${l.id}:${line}  [${r.name}] "${hit}"  ← taught in ${where}${l.rank >= rankOf("b2") ? extra : ""}`);
        total++;
      }
    }
  }
  if (glossed.length && l.rank >= rankOf("b2")) report.push(`${l.id}  [glossed in longer texts: ${glossForms.size} of ${GLOSS_CAP}] ${glossed.join("; ")}`);
}
console.log(report.join("\n"));
console.log(`\n${total} structure hit(s)${filter ? ` in ${filter}` : " in B1 and later"}.`);
