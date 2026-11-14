// Dev script over untyped frontmatter data.
/* eslint-disable @typescript-eslint/no-explicit-any */
// C2 coverage map: what A1 to C1 already teach, by lesson id, so C2 lessons can recap and link
// instead of re-teaching. Writes docs/c2-coverage.md.
// Run with: node --experimental-strip-types scripts/c2-lists.ts
// The map is built from lesson types, titles, tags, vocab and section headings, so "not listed"
// doesn't mean "not taught": check with scripts/c2-find.ts before claiming either.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { TENSE_WORDS, CONNECTORS } from "./c1-lists.ts";

const ROOT = process.cwd();
const LEVELS = ["a1", "a2", "b1", "b2", "c1"];
type Lesson = { id: string; level: string; order: number; type: string; title: string; tags: string[]; vocab: any[]; body: string };

const lessons: Lesson[] = [];
for (const lv of LEVELS) {
  const dir = path.join(ROOT, "content", "lessons", lv);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mdx"))) {
    const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
    lessons.push({ id: data.id, level: lv, order: data.order, type: data.type, title: data.title, tags: data.tags ?? [], vocab: data.vocab ?? [], body: content });
  }
}
lessons.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.order - b.order);
const tag = (l: Lesson) => `${l.title} \`${l.id}\``;
const byLevel = (ls: Lesson[]) => LEVELS.map((lv) => {
  const xs = ls.filter((l) => l.level === lv);
  return xs.length ? `**${lv.toUpperCase()}** (${xs.length}): ${xs.map(tag).join("; ")}` : "";
}).filter(Boolean);

// Grammar.
const grammar = lessons.filter((l) => l.type === "grammar");
const tenses = grammar.filter((l) => TENSE_WORDS.test(l.title));
// Grammar points C2 plans to refine: where earlier levels already touch them (title, tags or text).
const REFINE: [string, RegExp][] = [
  ["Past participle agreement (avoir, être, pronominal verbs)", /accord du participe|participle agreement|agreement of the past participle|pronominal|reflexive verbs in the passé composé/i],
  ["Faire / laisser + infinitive", /faire causatif|faire \+ infinitive|laisser \+ infinitive|se faire \+/i],
  ["Tout, quelque, même", /\btout, toute|\bquelque\b|\bmême\b.*adverb|tout\b.*adverb/i],
  ["Subjunctive in relative clauses and after superlatives", /subjunctive in relative|after (a |the )?superlative|le seul qui|le premier qui/i],
  ["Concordance des temps", /concordance des temps|sequence of tenses/i],
  ["Nominal style and ellipsis", /nominal style|nominalisation|style nominal|ellipsis|ellipse/i],
  ["Inversion and literary syntax", /inversion/i],
  ["Ne explétif and literary negation", /ne explétif|literary negation|ne… point/i],
];
const refineRows: string[] = [];
for (const [name, re] of REFINE) {
  const hits = lessons.filter((l) => re.test(l.title) || l.tags.some((t) => re.test(t)) || re.test(l.body.slice(0, 4000)));
  refineRows.push(`- **${name}**: ${hits.length ? hits.slice(0, 8).map((l) => `\`${l.id}\``).join(", ") + (hits.length > 8 ? ` and ${hits.length - 8} more` : "") : "no lesson found (check with c2-find)"}`);
}

// Vocabulary areas: vocabulary lessons by title; idioms and register vocab.
const vocabLessons = lessons.filter((l) => l.type === "vocabulary");
// Text types: communication lessons, and the headings of longer-text sections.
const comm = lessons.filter((l) => l.type === "communication");
const TEXT_TYPES: [string, RegExp][] = [
  ["Emails and formal letters", /email|courriel|letter|lettre|correspondence|complaint|cover letter/i],
  ["Articles, reviews and editorials", /article|review|critique|editorial|tribune|press|news/i],
  ["Essays, dissertation, synthesis, summaries", /essay|dissertation|synthesis|synthèse|summar|résumé|commentaire|commentary/i],
  ["Speeches, debates, presentations, meetings", /speech|discours|debate|débat|presentation|exposé|meeting|réunion/i],
  ["Stories, tales, poems", /story|tale|conte|récit|nouvelle|poem|poème|narrative/i],
  ["Reports and minutes", /report|rapport|minutes|compte rendu|relevé/i],
  ["Messages, forums, interviews", /message|forum|interview|texto|thread/i],
];
const textRows: string[] = [];
for (const [name, re] of TEXT_TYPES) {
  const hits = lessons.filter((l) => ["communication", "review", "culture"].includes(l.type) && (re.test(l.title) || l.tags.some((t) => re.test(t))));
  textRows.push(`- **${name}** (${hits.length}): ${hits.map((l) => `\`${l.id}\``).join(", ")}`);
}
// Registers.
const REG = /register|registre|colloquial|spoken|slang|argot|verlan|formal|soutenu|familier|diplomatic|euphemism|irony|discourse markers/i;
const registers = lessons.filter((l) => REG.test(l.title) || l.tags.some((t) => REG.test(t)));
// Culture.
const culture = lessons.filter((l) => l.type === "culture");
// Connectors and fixed phrases (A1 to C1).
const connectors = new Map<string, string>();
const fixed = new Map<string, string>();
const FIXED = /^(?:avoir|être|faire|mettre|prendre|tenir|donner|tirer|passer|poser|tomber|couper|en |il y a|ça )\S*\s+\S+\s+\S+/i;
for (const l of lessons) for (const v of l.vocab) {
  const fr = String(v.fr).split(/\s*\/\s*/)[0].trim();
  if (CONNECTORS.test(fr) && !connectors.has(fr.toLowerCase())) connectors.set(fr.toLowerCase(), `${fr} (${l.id})`);
  if ((FIXED.test(fr) || /idioms|proverbs/.test(l.id)) && !fixed.has(fr.toLowerCase())) fixed.set(fr.toLowerCase(), `${fr} (${l.id})`);
}
// Quotations already used (C1): authors and works, so C2 doesn't repeat them.
const quotes: string[] = [];
for (const l of lessons.filter((x) => x.level === "c1")) for (const m of l.body.matchAll(/<Example fr="«\s*([^»]+?)\s*»\s*\(([^)]+)\)"/g)) quotes.push(`${m[2]}: « ${m[1]} » (\`${l.id}\`)`);

const out: string[] = [
  "# C2 coverage map",
  "",
  `Generated by \`node --experimental-strip-types scripts/c2-lists.ts\` from ${lessons.length} A1 to C1 lessons. Before a C2 lesson teaches something, look it up here: if it's listed, recap it in 2 or 3 sentences and link the lesson that first taught it.`,
  "",
  "**This map is incomplete.** It's built from lesson types, titles, tags, vocab and the start of each lesson's text, so \"not listed\" doesn't mean \"not taught\", and a hit doesn't prove a full treatment. Check with `node --experimental-strip-types scripts/c2-find.ts \"phrase\"`, which searches every A1 to C1 lesson's vocab and text.",
  "",
  "## Grammar",
  "",
  "### Tenses and moods",
  "",
  ...tenses.map((l) => `- ${tag(l)}`),
  "",
  "### Points C2 plans to refine: where they already appear",
  "",
  ...refineRows,
  "",
  "### All grammar lessons, by level",
  "",
  ...byLevel(grammar).flatMap((r) => [r, ""]),
  "## Vocabulary areas (vocabulary lessons, by level)",
  "",
  ...byLevel(vocabLessons).flatMap((r) => [r, ""]),
  "## Text types (communication, culture and review lessons)",
  "",
  ...textRows,
  "",
  "### All communication lessons, by level",
  "",
  ...byLevel(comm).flatMap((r) => [r, ""]),
  "## Registers",
  "",
  ...byLevel(registers).flatMap((r) => [r, ""]),
  "## Culture topics (culture lessons, by level)",
  "",
  ...byLevel(culture).flatMap((r) => [r, ""]),
  "## Quotations already used in C1",
  "",
  ...quotes.map((q) => `- ${q}`),
  "",
  `## Connectors and discourse markers (${connectors.size})`,
  "",
  [...connectors.values()].join("; "),
  "",
  `## Fixed phrases, idioms and proverbs (${fixed.size})`,
  "",
  [...fixed.values()].join("; "),
  "",
];
fs.writeFileSync(path.join(ROOT, "docs", "c2-coverage.md"), out.join("\n"));
console.log(`c2-lists: ${lessons.length} lessons, ${grammar.length} grammar, ${vocabLessons.length} vocabulary, ${comm.length} communication, ${culture.length} culture, ${registers.length} register lessons, ${connectors.size} connectors, ${fixed.size} fixed phrases, ${quotes.length} quotations`);
