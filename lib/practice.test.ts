// The /practice index, built from the real content. Run: npm run test:progress
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getAllLessons, getProgressIndex, isFreeLevel, parseLesson, readLessonSources } from "./lessons.ts";
import { buildPracticeIndex, listedReviews, slugify, unitAnchor, type PracticeLesson } from "./practice.ts";

const lessons = getAllLessons();
const index = getProgressIndex();
const catalogue: PracticeLesson[] = lessons.map((l) => ({
  id: l.id,
  title: l.title,
  href: l.href,
  level: l.level,
  unit: l.unit,
  type: l.type,
  free: isFreeLevel(l.level),
  exercises: index.lessons[l.id]?.exercises.length ?? 0,
}));
const levels = buildPracticeIndex(catalogue);

describe("/practice index", () => {
  test("lists every review lesson exactly once, and no other lesson", () => {
    const reviewIds = readLessonSources()
      .map((s) => parseLesson(s).lesson)
      .filter((l) => l?.meta.type === "review")
      .map((l) => l!.meta.id)
      .sort();
    const listed = listedReviews(levels).map((l) => l.id);
    assert.equal(listed.length, reviewIds.length, "each listed once");
    assert.deepEqual([...listed].sort(), reviewIds);
    assert.equal(reviewIds.length, 49);
    assert.ok(listedReviews(levels).every((l) => l.type === "review"));
  });

  test("each level's review is its last lesson, at the end of the level", () => {
    assert.deepEqual(
      levels.map((l) => l.levelReview?.id),
      ["a1-review-final", "a2-review-final", "b1-review-final", "b2-review-final", "c1-review-final", "c2-review-final"],
    );
  });

  test("every level's units appear, in course order, with names", () => {
    assert.deepEqual(levels.map((l) => l.level), ["A1", "A2", "B1", "B2", "C1", "C2"]);
    for (const l of levels) {
      const expected = [...new Set(lessons.filter((x) => x.level === l.level).map((x) => x.unit))];
      assert.deepEqual(l.units.map((u) => u.name), expected, `${l.level} units`);
      for (const u of l.units) assert.ok(u.name.trim(), `${l.level} has a unit with no name`);
    }
  });

  test("units with no unit review are listed as such", () => {
    const without = levels.flatMap((l) => l.units.filter((u) => !u.review).map((u) => `${l.level} ${u.name}`));
    assert.deepEqual(without, ["A1 Getting around", "A2 Everyday interactions", "B1 Food, culture and wrap-up", "B2 Registers and debate"]);
  });

  test("every level and unit has a unique, stable anchor", () => {
    const anchors = levels.flatMap((l) => [l.anchor, `${l.anchor}-level-review`, ...l.units.map((u) => u.anchor)]);
    assert.equal(new Set(anchors).size, anchors.length);
    for (const a of anchors) assert.match(a, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.equal(levels[0].anchor, "a1");
    assert.equal(levels[0].units[0].anchor, "a1-getting-started");
    assert.equal(unitAnchor("B1", "Home, money and problems"), "b1-home-money-and-problems");
    assert.equal(slugify("Towards DALF C1"), "towards-dalf-c1");
  });

  test("each entry carries its exercise count and links to its own lesson", () => {
    for (const r of listedReviews(levels)) {
      assert.ok(r.exercises > 0, `${r.id} has exercises`);
      assert.equal(r.href, lessons.find((l) => l.id === r.id)!.href);
    }
  });
});
