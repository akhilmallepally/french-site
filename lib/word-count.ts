// Counts the words of a French text, one rule for the whole site (C2 writing tasks, contraction
// targets). Pure function, no React; also imported by scripts under plain Node.
//
// The convention (chosen in Prompt 45; conventions vary between institutions, see
// docs/review-needed.md, "C2 plan"): a word is any group of letters between spaces, hyphens or
// apostrophes.
// - l'homme = 2, qu'il = 2, jusqu'à = 2, peut-être = 2, c'est-à-dire = 4, viendra-t-il = 3.
// - One exception: aujourd'hui = 1.
// - A number written in figures is one word, with its thousands spaces and decimal comma:
//   1 000 = 1, 3,5 = 1 (the % sign is not a word).
// - Punctuation on its own is not a word (« » : ; ! ? – —).

const ONE_WORD = new Set(["aujourd'hui"]);
const SPACES = /[\s  ]+/;
const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u;

export function countWords(text: string): number {
  const normalized = text
    .normalize("NFC")
    .replace(/[’‘ʼ]/g, "'")
    // Thousands separators inside a number ("1 000", "1 000 000") don't start a new word.
    .replace(/(\d)[   ](?=\d{3}(?!\d))/g, "$1");
  let words = 0;
  for (const raw of normalized.split(SPACES)) {
    const token = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!token || !HAS_WORD_CHARACTER.test(token)) continue;
    if (ONE_WORD.has(token.toLowerCase())) {
      words += 1;
      continue;
    }
    words += token.split(/['\-‐‑]/).filter((part) => HAS_WORD_CHARACTER.test(part)).length;
  }
  return words;
}
