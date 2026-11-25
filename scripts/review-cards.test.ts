// The review card catalogue: determinism, glossary exclusion, the repeat-merge rule, stable card
// ids, published-id protection, the free/paid split, and who may import the paid cards.
// Run: npm run test:review
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { Lesson } from "../lib/lessons.ts";
import {
  buildReviewCatalogue,
  checkCards,
  checkPublished,
  matchKey,
  normalizeForMatch,
  serializeCards,
  serializePublished,
  type ReviewCard,
} from "../lib/review-catalogue.ts";
import { buildReviewFiles, readLessons, REVIEW_FILES, staleReviewFiles, type ReviewFiles } from "./build-review-cards.ts";
import { validateContent } from "./validate-content.ts";

const fixture = path.join(process.cwd(), "scripts", "fixtures", "review-cards");
const lessonsDir = path.join(fixture, "lessons");
const syllabus = path.join(fixture, "syllabus.md");
const totals = { vocab: 10, eligible: 9, cards: 6 };

const ids = (cards: ReviewCard[]) => cards.map((c) => c.id);
const card = (cards: ReviewCard[], id: string) => cards.find((c) => c.id === id);

/** A throwaway copy of the fixture with its review files built, and `edit` applied afterwards. */
function builtCopy(edit?: (dir: string) => void): { dir: string; files: ReviewFiles } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-cards-"));
  fs.cpSync(lessonsDir, path.join(dir, "lessons"), { recursive: true });
  const files = { free: path.join(dir, "free.json"), paid: path.join(dir, "paid.json"), published: path.join(dir, "published.json") };
  const build = buildReviewFiles(readLessons(path.join(dir, "lessons")), files.published);
  for (const k of ["free", "paid", "published"] as const) fs.writeFileSync(files[k], build.texts[k]);
  edit?.(path.join(dir, "lessons"));
  return { dir: path.join(dir, "lessons"), files };
}

function editFile(dir: string, file: string, from: string, to: string): void {
  const target = path.join(dir, file);
  const before = fs.readFileSync(target, "utf8");
  assert.ok(before.includes(from), `fixture ${file} must contain ${from}`);
  fs.writeFileSync(target, before.replace(from, to));
}

function reviewErrors(dir: string, files: ReviewFiles, expected = totals): string[] {
  return validateContent(dir, syllabus, { reviewFiles: files, expectedReviewTotals: expected }).errors;
}

/** An in-memory lesson with only the fields the catalogue reads. */
function lesson(id: string, level: string, order: number, vocab: Lesson["vocab"]): Lesson {
  return { meta: { id, level, order } as Lesson["meta"], content: "", vocab, exercises: [] };
}

describe("review catalogue", () => {
  test("is deterministic: byte-identical files, whatever order lessons are read in", () => {
    const lessons = readLessons(lessonsDir);
    const a = buildReviewCatalogue(lessons);
    const b = buildReviewCatalogue([...lessons].reverse());
    assert.equal(serializeCards("free", b.free), serializeCards("free", a.free));
    assert.equal(serializeCards("paid", b.paid), serializeCards("paid", a.paid));
    assert.equal(serializePublished(b.published), serializePublished(a.published));
    const text = serializeCards("paid", a.paid);
    assert.ok(text.endsWith("}\n") && !text.includes("\r"), "LF line ends and one trailing newline");
    assert.deepEqual(JSON.parse(text).cards, a.paid, "the text parses back to the cards");
    assert.deepEqual(a.totals, totals);
  });

  test("leaves out glossary entries", () => {
    const { free, paid, published } = buildReviewCatalogue(readLessons(lessonsDir));
    assert.ok(![...free, ...paid].some((c) => c.vocabIds.includes("b2-four-v002")), "the glossary entry is no card");
    assert.ok(card(paid, "b2-four-v001"), "the lesson's other entry is a card");
    assert.deepEqual(published.lessons["b2-four"], { vocab: ["b2-four-v001", "b2-four-v002"], cards: ["b2-four-v001"] },
      "the glossary id is still a published vocab id, but not a card id");
  });

  test("merges repeats only when French and English both match after normalizing", () => {
    assert.equal(normalizeForMatch("  Bonjour ! "), "bonjour");
    assert.equal(normalizeForMatch("l’ami"), "l'ami");
    assert.equal(normalizeForMatch("« Oui », (non) [peut-être]…"), "oui non peut-être");
    assert.notEqual(normalizeForMatch("où"), normalizeForMatch("ou"), "accents are kept");
    assert.notEqual(normalizeForMatch("peut-être"), normalizeForMatch("peut être"), "hyphens are kept");
    assert.notEqual(matchKey("le temps", "the weather"), matchKey("le temps", "time"));

    const { free } = buildReviewCatalogue(readLessons(lessonsDir));
    assert.deepEqual(card(free, "a1-one-v001")!.vocabIds, ["a1-one-v001", "a1-two-v001", "b1-three-v002"],
      "case and punctuation don't stop a match, across levels too");
    assert.deepEqual(card(free, "a1-one-v003")!.vocabIds, ["a1-one-v003", "a1-two-v003"], "curly and straight apostrophes match");
    assert.ok(card(free, "a1-one-v002") && card(free, "a1-two-v002"), "same French, different English: two cards");
    assert.equal(card(free, "a1-one-v002")!.en, "the weather");
    assert.equal(card(free, "a1-one-v002")!.note, "Also: time.");
    assert.equal(card(free, "a1-one-v001")!.fr, "bonjour", "the card's text is its earliest entry's");
  });

  test("a published card id stays fixed when an earlier or later lesson adds a matching entry", () => {
    const v = (id: string, fr: string, en: string) => ({ id, fr, en, pron: "x" });
    const before = [lesson("a1-b", "A1", 2, [v("a1-b-v001", "le chat", "the cat")])];
    const published = buildReviewCatalogue(before).published;

    const later = [...before, lesson("a1-c", "A1", 3, [v("a1-c-v001", "Le chat.", "the cat")])];
    assert.deepEqual(ids(buildReviewCatalogue(later, published).free), ["a1-b-v001"]);

    const earlier = [lesson("a1-a", "A1", 1, [v("a1-a-v001", "le chat", "the cat")]), ...before];
    assert.deepEqual(ids(buildReviewCatalogue(earlier).free), ["a1-a-v001"], "unpublished: the earliest entry gives the id");
    const kept = buildReviewCatalogue(earlier, published);
    assert.deepEqual(ids(kept.free), ["a1-b-v001"], "published: the id doesn't move to the earlier entry");
    assert.deepEqual(kept.free[0].vocabIds, ["a1-a-v001", "a1-b-v001"], "the new entry joins the existing card");
    assert.deepEqual(checkPublished(published, kept.published), []);
    assert.deepEqual(checkCards(kept.free), []);

    // An edit that makes two published cards match keeps both.
    const two = [lesson("a1-b", "A1", 2, [v("a1-b-v001", "le chat", "the cat"), v("a1-b-v002", "le chien", "the dog")])];
    const both = buildReviewCatalogue(two).published;
    const merged = [lesson("a1-b", "A1", 2, [v("a1-b-v001", "le chat", "the cat"), v("a1-b-v002", "le chat", "the cat")])];
    assert.deepEqual(ids(buildReviewCatalogue(merged, both).free), ["a1-b-v001", "a1-b-v002"]);
    // An entry that stops matching becomes its own card; the old card keeps its id.
    const split = [lesson("a1-b", "A1", 2, [v("a1-b-v001", "le chat", "the cat"), v("a1-b-v002", "la chatte", "the cat (female)")])];
    const fromMerged = buildReviewCatalogue([lesson("a1-b", "A1", 2, [v("a1-b-v001", "le chat", "the cat"), v("a1-b-v002", "le chat", "the cat")])]).published;
    assert.deepEqual(ids(buildReviewCatalogue(split, fromMerged).free), ["a1-b-v001", "a1-b-v002"]);
  });

  test("splits free (A1, A2) from paid (B1 to C2) cards by the card's own level", () => {
    const { free, paid } = buildReviewCatalogue(readLessons(lessonsDir));
    assert.deepEqual(ids(free), ["a1-one-v001", "a1-one-v002", "a1-one-v003", "a1-two-v002"]);
    assert.deepEqual(ids(paid), ["b1-three-v001", "b2-four-v001"]);
    assert.ok(free.every((c) => c.level === "A1" || c.level === "A2"));
    assert.ok(paid.every((c) => !["A1", "A2"].includes(c.level)));
    assert.equal(JSON.parse(serializeCards("paid", paid)).access, "paid");
  });

  test("checks 0008's id rules and the required text", () => {
    const good: ReviewCard = { id: "a1-x-v001", lessonId: "a1-x", level: "A1", fr: "oui", en: "yes", vocabIds: ["a1-x-v001"] };
    assert.deepEqual(checkCards([good]), []);
    assert.deepEqual(checkCards([good, good]), ['card id "a1-x-v001" is used twice']);
    assert.match(checkCards([{ ...good, id: "A1-x-v001", vocabIds: ["A1-x-v001"] }]).join(), /0008's format/);
    assert.match(checkCards([{ ...good, lessonId: "a1-y" }]).join(), /lesson-prefix rule/);
    assert.match(checkCards([{ ...good, en: " " }]).join(), /"en" is missing or empty/);
    assert.match(checkCards([{ ...good, note: "" }]).join(), /"note" is an empty string/);
  });
});

describe("validate:content and the committed review files", () => {
  test("passes when the files are current, and the real site's files are current", () => {
    const { dir, files } = builtCopy();
    assert.deepEqual(reviewErrors(dir, files), []);
    const site = buildReviewFiles(readLessons(path.join(process.cwd(), "content", "lessons")), REVIEW_FILES.published);
    assert.deepEqual(site.changes, []);
    assert.deepEqual(staleReviewFiles(site, REVIEW_FILES), [], "run npm run build:review-cards");
  });

  test("a new entry makes the files stale; the rebuild adds its id and changes no published id", () => {
    const { dir, files } = builtCopy((d) =>
      editFile(d, "b1/three.mdx", 'en: "democracy" }', 'en: "democracy" }\n  - { id: "b1-three-v003", fr: "le vote", pron: "luh VOTT", en: "the vote" }'));
    const errors = reviewErrors(dir, files, { vocab: 11, eligible: 10, cards: 7 });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /out of date with the lessons\. Run: npm run build:review-cards/);
    const rebuilt = buildReviewFiles(readLessons(dir), files.published);
    assert.deepEqual(rebuilt.changes, []);
    assert.ok(JSON.parse(rebuilt.texts.published).lessons["b1-three"].cards.includes("b1-three-v003"));
  });

  test("a published vocab id that disappears, or a card that stops being one, fails with what changed", () => {
    const removed = builtCopy((d) => editFile(d, "a1/two.mdx", '  - { id: "a1-two-v002", fr: "le temps", pron: "luh TAHN", en: "time" }\n', ""));
    const errors = reviewErrors(removed.dir, removed.files, { vocab: 9, eligible: 8, cards: 5 });
    assert.deepEqual(errors, [
      'review ids: vocab id "a1-two-v002" (a1-two) was published and is gone. Published ids are permanent: restore it (see lib/generated/review-published-ids.json).',
      'review ids: card id "a1-two-v002" (a1-two) was published and is gone. Published ids are permanent: restore it (see lib/generated/review-published-ids.json).',
    ]);

    const glossary = builtCopy((d) => editFile(d, "b1/three.mdx", '{ id: "b1-three-v001", fr:', '{ id: "b1-three-v001", group: "glossary", fr:'));
    assert.match(reviewErrors(glossary.dir, glossary.files, { vocab: 10, eligible: 8, cards: 5 }).join("\n"),
      /card id "b1-three-v001" \(b1-three\) was published and is no longer a card/);
  });

  test("a published id that moves to another lesson fails", () => {
    const old = { lessons: { "a1-one": { vocab: ["a1-one-v001"], cards: ["a1-one-v001"] } } };
    const moved = { lessons: { "a1-one": { vocab: [], cards: [] }, "a1-two": { vocab: ["a1-one-v001"], cards: ["a1-one-v001"] } } };
    assert.deepEqual(checkPublished(old, moved), [
      'vocab id "a1-one-v001" moved from a1-one to a1-two',
      'card id "a1-one-v001" now points to a1-two, not a1-one',
    ]);
    assert.deepEqual(checkPublished(old, old), [], "unchanged ids pass");
  });

  test("changed totals fail with how to update them deliberately", () => {
    const { dir, files } = builtCopy();
    assert.deepEqual(reviewErrors(dir, files, { vocab: 10, eligible: 9, cards: 7 }), [
      "review totals changed: 10 vocab items, 9 eligible, 6 cards (expected 10, 9, 7). If the change is intended, " +
        "update EXPECTED_REVIEW_TOTALS in scripts/validate-content.ts and run npm run build:review-cards.",
    ]);
  });
});

describe("paid card text stays on the server", () => {
  const root = process.cwd();
  /** Source files of the app (not scripts or generated files). */
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (rel !== path.join("lib", "generated")) out.push(...sources(rel));
      } else if (/\.(tsx?|jsx?|mjs|cjs|json)$/.test(e.name)) out.push(rel);
    }
    return out;
  }

  test("only lib/review-cards-server.ts imports the paid cards, and it is server-only", () => {
    const importers = ["app", "components", "lib"].flatMap(sources).filter((f) => /review-cards-paid/.test(fs.readFileSync(path.join(root, f), "utf8")));
    assert.deepEqual(importers.map((f) => f.split(path.sep).join("/")), ["lib/review-cards-server.ts"]);
    assert.match(fs.readFileSync(path.join(root, "lib", "review-cards-server.ts"), "utf8"), /^import "server-only";/);
  });

  test("no review card file is under public/", () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]));
    assert.deepEqual(walk(path.join(root, "public")).filter((n) => /review/i.test(n)), []);
  });
});
