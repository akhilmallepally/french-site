// Run with: npm run test:safe-next
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "./safe-next.ts";

const ORIGIN = "https://example.org";

test("keeps a same-origin lesson path", () => {
  assert.equal(safeNext("/lessons/b1/x", ORIGIN), "/lessons/b1/x");
  assert.equal(safeNext("/lessons/c1/passe-simple?tab=1#ex", ORIGIN), "/lessons/c1/passe-simple?tab=1#ex");
});

test("rejects protocol-relative and absolute URLs", () => {
  assert.equal(safeNext("//evil.com", ORIGIN), "/");
  assert.equal(safeNext("https://evil.com", ORIGIN), "/");
  assert.equal(safeNext("http:/evil.com", ORIGIN), "/");
  assert.equal(safeNext("javascript:alert(1)", ORIGIN), "/");
  assert.equal(safeNext("evil.com", ORIGIN), "/");
});

test("rejects backslash tricks", () => {
  assert.equal(safeNext("/\\evil.com", ORIGIN), "/");
  assert.equal(safeNext("/\\/evil.com", ORIGIN), "/");
  assert.equal(safeNext("/lessons\\..\\x", ORIGIN), "/");
});

test("rejects encoded slashes and backslashes at the start", () => {
  assert.equal(safeNext("/%2F/evil.com", ORIGIN), "/");
  assert.equal(safeNext("/%2f%2fevil.com", ORIGIN), "/");
  assert.equal(safeNext("/%5Cevil.com", ORIGIN), "/");
});

test("rejects control characters and newlines", () => {
  assert.equal(safeNext("/lessons\n/x", ORIGIN), "/");
  assert.equal(safeNext("/lessons%0d%0aSet-Cookie:x", ORIGIN), "/");
  assert.equal(safeNext("/\t/evil.com", ORIGIN), "/");
});

test("falls back to / for empty, missing or non-string values", () => {
  assert.equal(safeNext("", ORIGIN), "/");
  assert.equal(safeNext(null, ORIGIN), "/");
  assert.equal(safeNext(undefined, ORIGIN), "/");
  assert.equal(safeNext(["/lessons/b1/x"], ORIGIN), "/");
  assert.equal(safeNext("/" + "a".repeat(3000), ORIGIN), "/");
});

test("the result always resolves to the same origin", () => {
  for (const input of ["//evil.com", "https://evil.com", "/\\evil.com", "/%2F/evil.com", "/lessons/b1/x", "/./../x"]) {
    assert.equal(new URL(safeNext(input, ORIGIN), ORIGIN).origin, ORIGIN, input);
  }
});
