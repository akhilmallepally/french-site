// Scan French classical verse: count syllables and check the caesura.
//
// Usage:
//   node --experimental-strip-types scripts/scan-alexandrines.ts "Le jour n'est pas plus pur que le fond de mon cœur."
//   node --experimental-strip-types scripts/scan-alexandrines.ts --file content/lessons/c1/culture-french-poetry.mdx --section "An original poem"
//   node --experimental-strip-types scripts/scan-alexandrines.ts --test
//
// Rules (classical prosody):
// - Each vowel group is one syllable. Groups that may be one or two syllables (i, u or ou before
//   another vowel: ie, ui, ion, oué…) are not guessed: the word must be in DICT, with the count a
//   dictionary of versification gives (synérèse or diérèse). Otherwise the line fails.
// - The mute e at the end of a word after a consonant (-e, -es, verb -ent) is counted before a
//   consonant or an h aspiré, elided before a vowel or an h muet (-e only), and never counted at
//   the end of the line.
// - A mute e after a vowel (vie, joie, aimée) must be elided or end the line; before a consonant
//   it is an error, as in classical verse.
// - An alexandrine has 12 syllables and a caesura after the 6th: a word must end on the 6th
//   syllable, and that syllable can't be a counted mute e.
// Words in -ent are taken as verbs (mute e) unless they are listed in NON_VERB_ENT.
// With --file, every italic line of five words or more in the named section is scanned.
// Exit code 1 if any line fails.
import fs from "node:fs";

const VOWELS = "aeiouyàâäéèêëîïôöùûüœæ";
const TREMA = "ëïüÿ";
const isVowel = (c: string) => VOWELS.includes(c);
// Groups that are always one syllable.
const SAFE = new Set(["a", "e", "i", "o", "u", "y", "é", "è", "ê", "ë", "à", "â", "î", "ï", "ô", "ö", "ù", "û", "ü", "œ", "æ",
  "ai", "aî", "ei", "au", "eau", "eu", "œu", "ou", "où", "oû", "oi", "oî", "ue"]);
// Words whose vowel groups are ambiguous, with their syllable count in classical verse
// (not counting a final mute e). Add a word only with a dictionary's count.
const DICT: Record<string, number> = {
  vieux: 1, suis: 1, bruit: 1, nuit: 1, lui: 1, puis: 1, hui: 1, ciel: 1, rien: 1, bien: 1, pied: 1,
  mien: 1, tien: 1, viens: 1, vient: 1, lion: 2, nation: 3, milieu: 2, dernier: 2, derniers: 2,
};
// h aspiré: no elision before these words.
const H_ASPIRE = ["héros", "haut", "haute", "hauts", "hautes", "haine", "hâte", "hasard", "honte", "hibou", "halte", "hameau",
  "hache", "hardi", "harpe", "haïr", "hêtre", "hors", "huit", "hurler", "hanter", "hameaux", "haie", "hall", "hamac", "hareng"];
// Words in -ent that aren't verbs (the e is not mute).
const NON_VERB_ENT = new Set(["souvent", "moment", "lent", "vent", "dent", "argent", "content", "présent", "absent", "comment",
  "seulement", "lentement", "doucement", "longtemps", "parent", "enfant", "accent", "talent", "torrent", "serpent", "cent", "ent"]);

type Word = { raw: string; core: number; mute: "none" | "C-e" | "C-s" | "V-e" | "V-s"; error?: string };

function groups(w: string): string[] {
  let s = w.replace(/qu(?=[aeiouyàâéèêîôû])/g, "q").replace(/gu(?=[eiéèêy])/g, "g").replace(/ge(?=[aoâôu])/g, "g");
  if (/^y[aeiouéèêàâôû]/.test(s)) s = "j" + s.slice(1);
  const out: string[] = [];
  let cur = "";
  for (const c of s) {
    if (isVowel(c)) {
      if (cur && TREMA.includes(c)) { out.push(cur); cur = c; } else cur += c;
    } else if (cur) { out.push(cur); cur = ""; }
  }
  if (cur) out.push(cur);
  return out;
}

function countCore(core: string, whole: string): { n: number; error?: string } {
  if (whole in DICT) return { n: DICT[whole] };
  let n = 0;
  for (const g of groups(core)) {
    if (!SAFE.has(g)) return { n: 0, error: `"${whole}": ambiguous vowel group "${g}" (add it to DICT with a dictionary count)` };
    n++;
  }
  return { n };
}

function analyse(token: string): Word {
  const parts = token.split("'");
  const main = parts.pop() as string;
  let core = 0;
  for (const p of parts) core += countCore(p.replace(/qu$/, "q"), p).n; // l', qu', jusqu', aujourd'
  if (main in DICT) return { raw: token, core: core + DICT[main], mute: "none" };
  if (/(ai|oi)ent$/.test(main)) { // -aient, -oient: one syllable, the e is silent
    const c = countCore(main.slice(0, -3), main);
    return { raw: token, core: core + c.n, mute: "none", error: c.error };
  }
  const g = groups(main);
  if (g.length === 1 && g[0] === "e") return { raw: token, core: core + 1, mute: "none" }; // le, de, que, je
  let stem = main, mute: Word["mute"] = "none";
  const cons = main.match(new RegExp(`[^${VOWELS}](e|es|ent)$`));
  const vow = main.match(new RegExp(`[${VOWELS}](e|es)$`));
  if (cons && !(cons[1] === "ent" && NON_VERB_ENT.has(main))) {
    stem = main.slice(0, -cons[1].length);
    mute = cons[1] === "e" ? "C-e" : "C-s";
  } else if (vow) {
    stem = main.slice(0, -vow[1].length);
    mute = vow[1] === "e" ? "V-e" : "V-s";
  }
  const c = countCore(stem, main);
  return { raw: token, core: core + c.n, mute, error: c.error };
}

function startsWithVowelSound(token: string | undefined): boolean {
  if (!token) return false;
  const t = token.replace(/^[^a-zàâäéèêëîïôöùûüœæ]+/, "");
  if (H_ASPIRE.includes(t.split("'")[0])) return false;
  if (t.startsWith("h")) return true;
  return isVowel(t[0] ?? "");
}

export type Scan = { line: string; count: number; caesura: boolean; detail: string; errors: string[] };

export function scanLine(line: string): Scan {
  const tokens = line.toLowerCase().replace(/[’‘]/g, "'").replace(/[.,;:!?«»"()…—–]/g, " ").replace(/-/g, " ")
    .split(/\s+/).filter((t) => /[a-zàâäéèêëîïôöùûüœæ]/.test(t));
  const words = tokens.map(analyse);
  const errors: string[] = [];
  let total = 0, caesura = false;
  const detail: string[] = [];
  words.forEach((w, i) => {
    if (w.error) errors.push(w.error);
    const last = i === words.length - 1;
    const beforeVowel = startsWithVowelSound(tokens[i + 1]);
    let muteCounted = 0;
    if (w.mute === "C-e") muteCounted = last || beforeVowel ? 0 : 1;
    else if (w.mute === "C-s") muteCounted = last ? 0 : 1;
    else if (w.mute === "V-e" && !last && !beforeVowel) errors.push(`"${w.raw}": mute e after a vowel before a consonant`);
    else if (w.mute === "V-s" && !last) errors.push(`"${w.raw}": -es after a vowel inside the line`);
    total += w.core + muteCounted;
    detail.push(`${w.raw}(${w.core + muteCounted})`);
    if (total === 6) caesura = muteCounted === 0; // the 6th syllable can't be a counted mute e
  });
  return { line, count: total, caesura, detail: detail.join(" "), errors };
}

function report(lines: string[], expected = 12): boolean {
  let ok = true;
  for (const line of lines) {
    const s = scanLine(line);
    const good = s.errors.length === 0 && s.count === expected && (expected !== 12 || s.caesura);
    if (!good) ok = false;
    console.log(`${good ? "ok  " : "FAIL"} ${s.count} syllables, caesura ${s.caesura ? "after 6" : "missing"}: ${line}`);
    console.log(`     ${s.detail}`);
    for (const e of s.errors) console.log(`     error: ${e}`);
  }
  return ok;
}

const args = process.argv.slice(2);
if (args[0] === "--test") {
  // Known lines from authors on the CLAUDE.md safe list, with their counts.
  const ok12 = report([
    "Le jour n'est pas plus pur que le fond de mon cœur.",            // Racine, Phèdre
    "Demain, dès l'aube, à l'heure où blanchit la campagne,",          // Hugo, Les Contemplations
    "Souvent, pour s'amuser, les hommes d'équipage",                   // Baudelaire, Les Fleurs du mal
  ]);
  const ok6 = report(["Il pleure dans mon cœur", "Comme il pleut sur la ville"], 6); // Verlaine
  const bad = scanLine("La vie belle et la nuit douce sous les étoiles");
  const okBad = bad.errors.length > 0;
  console.log(`${okBad ? "ok  " : "FAIL"} rejects a mute e after a vowel before a consonant (vie belle)`);
  process.exit(ok12 && ok6 && okBad ? 0 : 1);
} else if (args[0] === "--file") {
  const file = args[1];
  const si = args.indexOf("--section");
  const section = si >= 0 ? args[si + 1] : "";
  const body = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const start = body.indexOf(`## ${section}\n`);
  if (start < 0) { console.log(`Section "${section}" not found in ${file}`); process.exit(1); }
  const end = body.indexOf("\n## ", start + 3);
  const lines = body.slice(start, end < 0 ? undefined : end).split("\n")
    .filter((l) => /^\*[^*].*\*$/.test(l.trim())).map((l) => l.trim().slice(1, -1))
    .filter((l) => l.split(/\s+/).length >= 5);
  process.exit(report(lines) ? 0 : 1);
} else if (args.length) {
  process.exit(report(args) ? 0 : 1);
} else {
  console.log('Usage: scan-alexandrines.ts "line" … | --file <mdx> --section "<heading>" | --test');
  process.exit(1);
}
