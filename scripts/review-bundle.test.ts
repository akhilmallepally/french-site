// Paid review card text (B1 to C2) must never be in client JavaScript or a public static file
// (docs/plans/review.md, section 4). Walks the client build output (.next/static) and public/, and
// fails if any paid card's French or English appears in it.
// Run: npm run test:review   (after npm run build)
//
// A string is "in" a file when it's a whole string literal there (minified code keeps card text as
// literals, JSON inside a literal included) or, in a non-code file, a whole-word match in its text.
// A card leaks when its French is in a file and is two or more words, when its English is and is
// three or more words, or when both its French and its (different) English are. Shorter strings
// alone aren't evidence: "online", "or", "if", "large" and "an account" are everyday code, CSS and
// English. Text that is also a free card's text is skipped: it's public by
// design (A1 and A2 vocab is on their pages).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { ReviewCard } from "../lib/review-catalogue.ts";

const root = process.cwd();
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(root, "lib", "generated", f), "utf8")) as { cards: ReviewCard[] };

export type Needle = { id: string; fr: string | null; en: string | null };

/** Each paid card's French and English, with null for text that is also free card text. */
export function paidNeedles(paid: ReviewCard[], free: ReviewCard[]): Needle[] {
  const publicText = new Set(free.flatMap((c) => [c.fr, c.en]));
  return paid.map((c) => ({ id: c.id, fr: publicText.has(c.fr) ? null : c.fr, en: publicText.has(c.en) ? null : c.en }));
}

const words = (s: string) => s.trim().split(/\s+/).length;
const isPhrase = (s: string) => words(s) >= 2;
const alone = (n: Needle, k: "fr" | "en") => words(n[k]!) >= (k === "fr" ? 2 : 3);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const LITERAL = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

/** Every string literal in a piece of code, decoded, plus the literals inside those (one level). */
export function stringLiterals(code: string, depth = 0): Set<string> {
  const out = new Set<string>();
  for (const m of code.matchAll(LITERAL)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    let value: string;
    try {
      value = JSON.parse(`"${raw.replace(/\\'/g, "'").replace(/\\`/g, "`").replace(/(?<!\\)"/g, '\\"')}"`);
    } catch {
      value = raw;
    }
    out.add(value);
    if (depth === 0 && /["'`]/.test(value)) for (const inner of stringLiterals(value, 1)) out.add(inner);
  }
  return out;
}

function walk(d: string): string[] {
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}

/** Leaks in every file under `dirs`: "file: card id fields". */
export function findLeaks(dirs: string[], needles: Needle[]): string[] {
  const leaks: string[] = [];
  for (const file of dirs.flatMap(walk)) {
    if (/\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|map)$/i.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const literals = /\.(js|mjs|cjs)$/.test(file) ? stringLiterals(text) : null;
    const has = (s: string | null) =>
      s !== null && (literals ? literals.has(s) : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(s)}(?![\\p{L}\\p{N}])`, "u").test(text));
    for (const n of needles) {
      const fr = has(n.fr);
      const en = has(n.en);
      if ((fr && en && n.fr !== n.en) || (fr && alone(n, "fr")) || (en && alone(n, "en"))) {
        leaks.push(`${path.relative(root, file)}: ${n.id} ${[fr && "fr", en && "en"].filter(Boolean).join("+")}`);
      }
    }
  }
  return leaks;
}

describe("paid review card text in the client build", () => {
  const paid = read("review-cards-paid.json").cards;
  const free = read("review-cards-free.json").cards;
  const needles = paidNeedles(paid, free);

  test("the detector finds a planted leak and ignores free text", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-bundle-"));
    // Two paid phrases with accents, and a paid card whose two sides are single words.
    const [a, b] = needles.filter((n) => n.fr && isPhrase(n.fr) && /[^\x00-\x7f]/.test(n.fr) && n.en && !isPhrase(n.en));
    const w = needles.find((n) => n.fr && n.en && !isPhrase(n.fr) && !isPhrase(n.en) && n.fr !== n.en)!;
    const asciiEscaped = (s: string) => JSON.stringify(s).replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
    fs.writeFileSync(path.join(dir, "chunk-1.js"), `var x=JSON.parse(${JSON.stringify(JSON.stringify({ fr: a.fr }))});`);
    fs.writeFileSync(path.join(dir, "chunk-2.js"), `e.jsx("p",{children:${asciiEscaped(b.fr!)}})`);
    fs.writeFileSync(path.join(dir, "chunk-3.js"), `e.jsx("p",{children:${JSON.stringify(free[0].fr)}}),f=${JSON.stringify(w.fr)}`);
    fs.writeFileSync(path.join(dir, "chunk-4.js"), `var c={a:${JSON.stringify(w.fr)},b:'${w.en!.replace(/'/g, "\\'")}'}`);
    fs.writeFileSync(path.join(dir, "note.txt"), `Words: ${b.fr}.`);
    const leaks = findLeaks([dir], needles).map((l) => l.replace(/^.*[\\/]/, ""));
    assert.deepEqual(
      leaks.sort(),
      [`chunk-1.js: ${a.id} fr`, `chunk-2.js: ${b.id} fr`, `chunk-4.js: ${w.id} fr+en`, `note.txt: ${b.id} fr`].sort(),
      "a phrase alone is a leak, a single word only with its other side, and free text never",
    );
  });

  test("no paid card's French or English is in .next/static or public/", () => {
    const staticDir = path.join(root, ".next", "static");
    assert.ok(fs.existsSync(staticDir), "no client build output: run npm run build first");
    const checked = needles.filter((n) => n.fr || n.en).length;
    assert.ok(checked > 0.95 * paid.length, `checking ${checked} of ${paid.length} paid cards`);
    const leaks = findLeaks([staticDir, path.join(root, "public")], needles);
    assert.deepEqual(leaks.slice(0, 20), [], `${leaks.length} paid card(s) found in client or public files`);
  });
});
