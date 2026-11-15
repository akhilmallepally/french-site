// Run: npm run test:checker (with lib/check-answer.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords } from "./word-count.ts";

test("plain words separated by spaces", () => {
  assert.equal(countWords("Le chat dort sur le canapé"), 6);
  assert.equal(countWords("  Le   chat\n\tdort  "), 3);
  assert.equal(countWords(""), 0);
});

test("elision: an apostrophe separates two words", () => {
  assert.equal(countWords("l'homme"), 2);
  assert.equal(countWords("Qu'il vienne jusqu'à demain"), 6); // qu' il vienne jusqu' à demain
  assert.equal(countWords("l’homme"), 2); // curly apostrophe
});

test("words that keep their apostrophe count as one", () => {
  assert.equal(countWords("aujourd'hui"), 1);
  assert.equal(countWords("Quelqu'un est venu aujourd'hui"), 4);
});

test("hyphens join a compound into one word", () => {
  assert.equal(countWords("peut-être"), 1);
  assert.equal(countWords("vingt-deux"), 1);
  assert.equal(countWords("c'est-à-dire"), 2); // c' + est-à-dire
  assert.equal(countWords("Viendra-t-il ?"), 1);
});

test("numbers in figures are one word each", () => {
  assert.equal(countWords("1 000 personnes"), 2);
  assert.equal(countWords("1 000 000 euros"), 2);
  assert.equal(countWords("3,5 % des voix"), 3); // the % sign is not a word
  assert.equal(countWords("en 1905"), 2);
});

test("punctuation alone is not a word", () => {
  assert.equal(countWords("« Bonjour ! » – dit-il ; puis : rien…"), 4);
  assert.equal(countWords("— ? ! ; :"), 0);
});
