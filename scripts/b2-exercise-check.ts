// Self-test for the B2 and C1 exercise types: every accepted answer must pass lib/check-answer.ts,
// and the text the learner starts from (the wrong or original sentence) must not.
// Run with: npm run test:b2-exercises
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { checkAnswer, checkChoice, sameWords } from "../lib/check-answer.ts";

const dirs = ["b2", "c1"].map((lv) => path.join(process.cwd(), "content", "lessons", lv)).filter((d) => fs.existsSync(d));
const TYPED = new Set(["reformulation", "register-shift", "error-correction"]);
const failures: string[] = [];
let checked = 0;

for (const dir of dirs) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".mdx"))) {
  const { data } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
  for (const e of (data.exercises ?? []) as any[]) {
    const answers: string[] = e.answers ?? [];
    const strict = e.strictAccents === true;
    if (TYPED.has(e.type)) {
      checked++;
      for (const a of answers) if (checkAnswer(a, answers, strict).status !== "correct") failures.push(`${e.id}: accepted answer fails: ${a}`);
      // The sentence after the instruction is what the learner starts from: it must not be accepted as is.
      const prompt = String(e.prompt ?? "");
      const cut = prompt.indexOf(" : ");
      const original = cut >= 0 ? prompt.slice(cut + 3).trim() : "";
      if (original && checkAnswer(original, answers, strict).status !== "incorrect") failures.push(`${e.id}: the original sentence is accepted: ${original}`);
    } else if (e.type === "connector-choice") {
      checked++;
      for (const a of answers) if (checkChoice(a, answers).status !== "correct") failures.push(`${e.id}: answer fails: ${a}`);
      for (const o of (e.options ?? []) as string[]) {
        if (!answers.includes(o) && checkChoice(o, answers).status === "correct") failures.push(`${e.id}: wrong option accepted: ${o}`);
      }
      if (!/___/.test(String(e.prompt ?? ""))) failures.push(`${e.id}: connector-choice prompt has no ___ gap`);
    } else if (e.type === "reorder") {
      checked++;
      const words: string[] = e.words ?? [];
      for (const a of answers) {
        if (!sameWords(words, a)) failures.push(`${e.id}: chips don't match the answer: ${a}`);
        if (checkAnswer(a, answers, strict).status !== "correct") failures.push(`${e.id}: accepted answer fails: ${a}`);
      }
    }
  }
}

// C1: every accepted fill-in and translate answer passes the checker, and the passé simple items reject
// the usual wrong forms (a missing cedilla is reported, not accepted; a regular ending on falloir is wrong).
{
  const dir = path.join(process.cwd(), "content", "lessons", "c1");
  const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith(".mdx")).flatMap((f) => (matter(fs.readFileSync(path.join(dir, f), "utf8")).data.exercises ?? []) as any[]) : [];
  for (const e of all.filter((x) => x.type === "fill-in" || x.type === "translate")) {
    checked++;
    for (const a of e.answers ?? []) if (checkAnswer(a, e.answers, e.strictAccents === true).status !== "correct") failures.push(e.id + ": accepted answer fails: " + a);
  }
  const wrong: [string, string][] = [["c1-passe-simple-ex017", "commenca"], ["c1-passe-simple-ex017", "commensa"], ["c1-passe-simple-ex018", "falla"], ["c1-passe-simple-ex018", "faillit"]];
  for (const [id, w] of wrong) {
    const e = all.find((x) => x.id === id);
    if (!e) failures.push(id + ": not found");
    else if (checkAnswer(w, e.answers, e.strictAccents === true).status === "correct") failures.push(id + ": wrong form accepted: " + w);
  }
}

// The reorder with a repeated word ("a" twice): the chips, in answer order, must rebuild the answer.
{
  const { data } = matter(fs.readFileSync(path.join(process.cwd(), "content", "lessons", "b2", "review-what-might-have-been.mdx"), "utf8"));
  const e = (data.exercises as any[]).find((x) => x.id === "b2-review-what-might-have-been-ex016");
  const words: string[] = e.words;
  const repeated = words.filter((w) => w === "a").length;
  if (repeated !== 2) failures.push(`ex016: expected the chip "a" twice, found ${repeated}`);
  if (!sameWords(words, e.answers[0])) failures.push("ex016: the chips with a repeated word don't rebuild the answer");
}

console.log(`b2-exercise-check: ${checked} exercises checked, ${failures.length} failure(s).`);
for (const f of failures) console.log(`  ${f}`);
if (failures.length) process.exit(1);
