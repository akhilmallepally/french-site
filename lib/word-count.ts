// Counts the words of a French text, one rule for the whole site (C2 writing tasks, contraction
// targets). Pure function, no React; also imported by scripts under plain Node.
//
// The convention (to verify, see docs/review-needed.md, "C2 plan"):
// - Words are separated by spaces; punctuation on its own is not a word (« » : ; ! ? – —).
// - An apostrophe separates words: l'homme = 2, qu'il = 2, jusqu'à = 2, c'est-à-dire = 2.
//   A few words have an apostrophe inside them and count as one: aujourd'hui, quelqu'un…
// - A hyphen joins: peut-être = 1, vingt-deux = 1, est-à-dire = 1.
// - A number written in figures is one word, with its thousands spaces and decimal comma:
//   1 000 = 1, 3,5 = 1, 12 % = 1 (the % sign is not a word).

const ONE_WORD_WITH_APOSTROPHE = new Set([
  "aujourd'hui", "quelqu'un", "quelqu'une", "presqu'île", "presqu'îles", "prud'homme", "prud'hommes",
]);
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
    const token = raw.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "").replace(/^'+|'+$/g, "");
    if (!token || !HAS_WORD_CHARACTER.test(token)) continue;
    if (ONE_WORD_WITH_APOSTROPHE.has(token.toLowerCase())) {
      words += 1;
      continue;
    }
    words += token.split("'").filter((part) => HAS_WORD_CHARACTER.test(part)).length;
  }
  return words;
}
