// The no-leak guarantee for review card text (docs/plans/review.md, section 6 rules): no client code
// imports the card text files, directly or through other modules. The text scan of the build
// (scripts/review-bundle.test.ts) stays as a backup.
// Run: npm run test:review
//
// Client code = every module with a "use client" directive in app/, components/ and lib/, and
// everything it imports (static, export-from, dynamic import(), require), as Next.js bundles it. A
// "use server" module imported from the client is only a reference to a server action, so the walk
// stops there.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

const root = process.cwd();
const SOURCE = /\.(tsx?|jsx?|mjs|cjs)$/;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"];
const IMPORT = /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;

/** Text-only forbidden in client code: the whole card files and the server module that reads them. */
export const FORBIDDEN = ["lib/generated/review-cards-paid.json", "lib/generated/review-cards-free.json", "lib/review-cards-server.ts"];

function directive(text: string): "client" | "server" | null {
  const m = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use (client|server)["']/.exec(text);
  return m ? (m[1] as "client" | "server") : null;
}

/** Module specifiers a file imports at run time (type-only imports are erased, so they're skipped). */
export function importsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(IMPORT)) {
    if (/^\s*(import|export)\s+type\s/.test(m[0])) continue;
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

function resolve(fromFile: string, spec: string, base: string): string | null {
  let target: string;
  if (spec.startsWith("@/")) target = path.join(base, spec.slice(2));
  else if (spec.startsWith(".")) target = path.resolve(path.dirname(fromFile), spec);
  else return null; // a package
  for (const ext of EXTENSIONS) {
    const f = target + ext;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  // "./x.ts" written with its extension but not on disk, or a missing file: nothing to follow.
  return null;
}

function walkDir(d: string): string[] {
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : walkDir(p);
    return SOURCE.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

export type ClientGraph = { entries: string[]; reached: Map<string, string> };

/** Every module reachable from client code, with the client entry it was reached from. */
export function clientGraph(base: string, dirs = ["app", "components", "lib"], extraEntries: string[] = []): ClientGraph {
  const files = dirs.flatMap((d) => walkDir(path.join(base, d)));
  const entries = [...files.filter((f) => directive(fs.readFileSync(f, "utf8")) === "client"), ...extraEntries.map((e) => path.join(base, e))];
  return walkGraph(base, entries, true);
}

/**
 * Every module reachable from `entries`. With `stopAtServer`, a "use server" module other than an
 * entry is a leaf (the client only gets a reference to it). Bare specifiers (packages, node:fs) are
 * kept in `packages` by the file that imports them.
 */
export function walkGraph(base: string, entries: string[], stopAtServer: boolean): ClientGraph & { packages: Map<string, string[]> } {
  const reached = new Map<string, string>();
  const packages = new Map<string, string[]>();
  const stack = entries.map((e) => [e, e] as const);
  while (stack.length) {
    const [file, entry] = stack.pop()!;
    if (reached.has(file)) continue;
    reached.set(file, entry);
    if (!SOURCE.test(file)) continue; // JSON: a leaf
    const text = fs.readFileSync(file, "utf8");
    if (stopAtServer && file !== entry && directive(text) === "server") continue; // a server action reference
    for (const spec of importsOf(text)) {
      const next = resolve(file, spec, base);
      if (next && !reached.has(next)) stack.push([next, entry]);
      else if (!next && !spec.startsWith(".") && !spec.startsWith("@/")) packages.set(file, [...(packages.get(file) ?? []), spec]);
    }
  }
  return { entries, reached, packages };
}

const rel = (base: string, f: string) => path.relative(base, f).split(path.sep).join("/");

export function forbiddenReached(base: string, graph: ClientGraph, forbidden = FORBIDDEN): string[] {
  return [...graph.reached]
    .filter(([f]) => forbidden.includes(rel(base, f)))
    .map(([f, entry]) => `${rel(base, f)} (reached from ${rel(base, entry)})`);
}

describe("client import graph", () => {
  test("finds a planted import, through other modules, and stops at server actions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-imports-"));
    const write = (f: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), text);
    };
    write("lib/generated/review-cards-paid.json", "{}");
    write("lib/generated/review-cards-free.json", "{}");
    write("lib/review-cards-server.ts", 'import "server-only";\nimport paid from "@/lib/generated/review-cards-paid.json";');
    write("lib/helper.ts", 'export { default } from "./generated/review-cards-free.json";');
    write("components/leaky.tsx", '"use client";\nimport type { X } from "@/lib/review-cards-server";\nconst h = () => import("../lib/helper");');
    write("components/safe.tsx", "'use client';\nimport { act } from \"@/app/actions/review\";");
    write("app/actions/review.ts", '"use server";\nimport "@/lib/review-cards-server";\nexport async function act() {}');
    write("app/page.tsx", 'import "@/lib/review-cards-server";'); // a server component may
    const graph = clientGraph(dir);
    assert.deepEqual(graph.entries.map((f) => rel(dir, f)).sort(), ["components/leaky.tsx", "components/safe.tsx"]);
    assert.deepEqual(forbiddenReached(dir, graph), ["lib/generated/review-cards-free.json (reached from components/leaky.tsx)"],
      "a dynamic import through a re-export is found; a type-only import, a server action and a server component aren't");
  });

  test("the review server actions validate against the id index only: no fs, no lib/lessons.ts, no card text", () => {
    const graph = walkGraph(root, [path.join(root, "app", "actions", "review.ts")], false);
    const files = [...graph.reached.keys()].map((f) => rel(root, f));
    assert.ok(files.includes("lib/generated/review-card-ids.json"), "the id index is imported as a module");
    for (const banned of [...FORBIDDEN, "lib/lessons.ts", "lib/generated/review-published-ids.json"]) assert.ok(!files.includes(banned), `${banned} is reachable`);
    const fsUsers = [...graph.packages].filter(([, specs]) => specs.some((x) => x === "fs" || x === "node:fs" || x.startsWith("node:fs/"))).map(([f]) => rel(root, f));
    assert.deepEqual(fsUsers, [], "no module the action loads reads files");
    console.log(`  review action graph: ${files.length} modules, packages: ${[...new Set([...graph.packages.values()].flat())].sort().join(", ")}`);
  });

  test("the review store (lib/review.ts) as client code reaches no card text and no lib/lessons.ts", () => {
    const graph = clientGraph(root, ["app", "components", "lib"], ["lib/review.ts"]);
    const files = [...graph.reached.keys()].map((f) => rel(root, f));
    assert.ok(files.includes("lib/review-sync-store.ts") && files.includes("lib/review-wiring.ts") && files.includes("app/actions/review.ts"));
    assert.ok(!files.includes("lib/generated/review-card-ids.json"), "the action's imports stay on the server");
    assert.ok(!files.includes("lib/lessons.ts"), "no client module pulls in the disk reader");
    assert.deepEqual(forbiddenReached(root, graph), []);
  });

  test("no client code reaches the review card text or its server module", () => {
    const graph = clientGraph(root);
    assert.ok(graph.entries.length >= 8, `found ${graph.entries.length} client entries`);
    assert.ok([...graph.reached.keys()].some((f) => rel(root, f) === "lib/progress-store.ts"), "the walk follows client imports");
    console.log(`  import graph: ${graph.entries.length} client entries, ${graph.reached.size} client modules`);
    assert.deepEqual(forbiddenReached(root, graph), []);
  });
});
