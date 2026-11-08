// Compares a learner's answer to the accepted answers. Pure functions, no React.
// Also imported by scripts under plain Node, so keep it free of path aliases.

export type AnswerStatus = "correct" | "correct-accents" | "incorrect";

export type AnswerResult = {
  status: AnswerStatus;
  /** The accepted answer that matched, properly accented. If nothing matched, the first accepted answer. */
  expected: string;
};

/**
 * Ignores capitals, spacing (including French spaces before ? and !), punctuation
 * and apostrophe style, and treats œ as oe and æ as ae. Accents are kept.
 * Hyphens and inner commas count as punctuation, because lessons don't list those variants.
 */
export function normalizeAnswer(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[.,;:!?…«»"“”()\-–—]/g, " ")
    .replace(/\s+/g, " ") // \s also covers non-breaking spaces
    .trim()
    .replace(/^'+|'+$/g, ""); // so "j'" and "j" match in a gap like ___'habite
}

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

/** Checks typed or built answers. Accent-less input is never reported as an exact match. */
export function checkAnswer(input: string, answers: string[]): AnswerResult {
  const given = normalizeAnswer(input);
  if (given) {
    const exact = answers.find((a) => normalizeAnswer(a) === given);
    if (exact !== undefined) return { status: "correct", expected: exact };

    const bare = stripAccents(given);
    const nearly = answers.find((a) => stripAccents(normalizeAnswer(a)) === bare);
    if (nearly !== undefined) return { status: "correct-accents", expected: nearly };
  }
  return { status: "incorrect", expected: answers[0] };
}

/** Multiple choice: the chosen option must exactly equal an accepted answer. */
export function checkChoice(chosen: string, answers: string[]): AnswerResult {
  return answers.includes(chosen)
    ? { status: "correct", expected: chosen }
    : { status: "incorrect", expected: answers[0] };
}

function wordList(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'")
    .replace(/[.,;:!?…«»"“”()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** True if `sentence` uses exactly `words` (same multiset), ignoring capitals and punctuation. */
export function sameWords(words: string[], sentence: string): boolean {
  const a = words.flatMap(wordList).sort();
  const b = wordList(sentence).sort();
  return a.length === b.length && a.every((word, i) => word === b[i]);
}
