// Proves that gated lessons (every level except A1 and A2) don't reach a visitor without a session.
// Needs a running production server: npm run build && npm start, then npm run test:gating.
// BASE_URL defaults to http://localhost:3000; set it to the production URL after a deploy.
//
// For each gated lesson it takes a marker sentence (from the En résumé, else the first teaching
// paragraph) and one accepted answer, then fetches the page with no cookie as HTML, as an RSC
// payload and as each prefetch variant, and fails if either appears. It also scans .next/static
// and the prerendered files under .next/server/app/lessons/ for the markers, checks that a sample
// of A1 and A2 lessons still return their full content, and checks the auth callback's redirects.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const ROOT = process.cwd();
const CONTENT = path.join(ROOT, "content", "lessons");
const NEXT_DIR = path.join(ROOT, ".next");
const FREE = new Set(["a1", "a2"]);
const PANEL_TEXT = "Sign in with Google to read this lesson";
const SAFE = /^[^'"&<>*_`[\]{}|\\]+$/;

// ---------- Markers from the MDX source ----------

/** Plain-text runs of a paragraph that render contiguously (no markup inside). */
function plainRuns(line) {
  return line
    .replace(/<[^>]+>/g, "\u0000")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "\u0000")
    .split(/\u0000|\*+|`|_{2,}/)
    .map((s) => s.trim());
}

/** A window of at least 50 characters with no character that HTML or JSON would escape. */
function safeWindow(text) {
  const m = text.match(/[^'"&<>*_`[\]{}|\\]{50,}/);
  return m ? m[0].trim().slice(0, 70).trim() : null;
}

function markerFrom(body) {
  const lines = body.split(/\r?\n/);
  const resume = lines.findIndex((l) => /^## En résumé/.test(l));
  const candidates = [];
  if (resume >= 0) {
    for (let i = resume + 1; i < lines.length && !/^## /.test(lines[i]); i++) candidates.push(lines[i]);
  }
  for (const l of lines) {
    if (!l.trim() || /^\s*([#<|>-]|\d+\.)/.test(l)) continue; // headings, components, tables, lists
    candidates.push(l);
  }
  for (const line of candidates) {
    for (const run of plainRuns(line)) {
      const w = safeWindow(run);
      if (w && w.length >= 50 && !PUBLIC_TEXT.includes(w)) return w;
    }
  }
  return null;
}

// Titles, descriptions and unit names are public on purpose (page shell, metadata, level pages),
// so a marker or answer that also appears there would prove nothing. Skip those.
let PUBLIC_TEXT = "";

function answerFrom(exercises = []) {
  for (const e of exercises) {
    const a = (e.answers || []).find((x) => x.length >= 8 && SAFE.test(x) && !PUBLIC_TEXT.includes(x));
    if (a) return a;
  }
  return null;
}

function readLessons() {
  const sources = [];
  for (const folder of fs.readdirSync(CONTENT)) {
    const dir = path.join(CONTENT, folder);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".mdx"))) {
      const { data } = matter(fs.readFileSync(path.join(dir, file), "utf8"));
      sources.push([data.title, data.description, data.unit].join(" | "));
    }
  }
  PUBLIC_TEXT = sources.join(" | ");
  const out = [];
  for (const folder of fs.readdirSync(CONTENT)) {
    const dir = path.join(CONTENT, folder);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".mdx"))) {
      const { data, content } = matter(fs.readFileSync(path.join(dir, file), "utf8"));
      const slug = file.replace(/\.mdx$/, "");
      out.push({ folder, slug, path: `/lessons/${folder}/${slug}`, marker: markerFrom(content), answer: answerFrom(data.exercises) });
    }
  }
  return out;
}

// ---------- Fetching ----------

/** Undo the escaping that HTML and RSC payloads may apply, so plain markers match either way. */
function normalize(text) {
  return text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"');
}

async function get(url, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      let res = await fetch(url, { headers, redirect: "manual" });
      // RSC requests need a matching _rsc cache-busting query; Next answers 307 with the right one.
      // Follow it (same origin only) with the same headers, so the real payload is checked.
      for (let hop = 0; hop < 3 && res.status >= 300 && res.status < 400; hop++) {
        const loc = res.headers.get("location") || "";
        const target = new URL(loc, url);
        if (target.origin !== new URL(url).origin || !target.searchParams.has("_rsc")) break;
        res = await fetch(target, { headers, redirect: "manual" });
      }
      return { status: res.status, location: res.headers.get("location"), text: normalize(await res.text()) };
    } catch (err) {
      // A network error isn't a pass: report it as status 0 with no body.
      if (attempt >= 3) return { status: 0, location: null, text: "", error: String(err?.cause?.code ?? err) };
    }
  }
}

function segmentKeys(lesson) {
  const dir = path.join(NEXT_DIR, "server", "app", "lessons", lesson.folder, `${lesson.slug}.segments`);
  const keys = new Set(["/_tree", "/_full", "/_index"]);
  if (fs.existsSync(dir)) {
    const walk = (d) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (f.endsWith(".segment.rsc")) keys.add("/" + path.relative(dir, p).split(path.sep).join("/").replace(/\.segment\.rsc$/, ""));
      }
    };
    walk(dir);
  }
  return [...keys];
}

function variants(lesson) {
  const v = [
    { name: "html", headers: {} },
    { name: "rsc", headers: { RSC: "1" } },
    { name: "prefetch", headers: { RSC: "1", "Next-Router-Prefetch": "1" } },
  ];
  for (const key of segmentKeys(lesson)) {
    v.push({ name: `segment ${key}`, headers: { RSC: "1", "Next-Router-Prefetch": "1", "Next-Router-Segment-Prefetch": key } });
  }
  return v;
}

// ---------- File scans ----------

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

// ---------- Run ----------

const rows = [];
const failures = [];
const record = (check, ok, detail = "") => {
  let row = rows.find((r) => r.check === check);
  if (!row) rows.push((row = { check, pass: 0, fail: 0 }));
  if (ok) row.pass++;
  else {
    row.fail++;
    failures.push(`${check}: ${detail}`);
  }
};

const lessons = readLessons();
const gated = lessons.filter((l) => !FREE.has(l.folder));
const free = lessons.filter((l) => FREE.has(l.folder));

try {
  await fetch(BASE_URL, { redirect: "manual" });
} catch {
  console.error(`No server at ${BASE_URL}. Run npm run build && npm start first.`);
  process.exit(1);
}

for (const l of gated) {
  record("gated lesson has a marker and an answer", !!l.marker && !!l.answer, `${l.path} (marker ${!!l.marker}, answer ${!!l.answer})`);
  for (const v of variants(l)) {
    const r = await get(BASE_URL + l.path, v.headers);
    const leaked = [l.marker, l.answer].filter((m) => m && r.text.includes(m));
    record(`no content in ${v.name.startsWith("segment") ? "segment prefetch" : v.name}`, r.status !== 0 && leaked.length === 0, `${l.path} [${v.name}] leaks: ${leaked.join(" | ")}`);
    if (v.name === "html") record("sign-in panel in html", r.status === 200 && r.text.includes(PANEL_TEXT), `${l.path} status ${r.status}`);
  }
}

// Build output: client chunks and prerendered lesson files.
const staticFiles = filesUnder(path.join(NEXT_DIR, "static")).filter((f) => /\.(js|css|json|html|rsc|txt)$/.test(f));
const staticText = staticFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
for (const l of gated) {
  if (l.marker) record("no marker in .next/static", !staticText.includes(l.marker), `${l.path}`);
  const prerendered = filesUnder(path.join(NEXT_DIR, "server", "app", "lessons", l.folder)).filter((f) => {
    const base = path.basename(f);
    return base.startsWith(l.slug + ".") || f.includes(`${path.sep}${l.slug}.segments${path.sep}`);
  });
  const leaked = prerendered.filter((f) => {
    const t = normalize(fs.readFileSync(f, "utf8"));
    return (l.marker && t.includes(l.marker)) || (l.answer && t.includes(l.answer));
  });
  record("no content in prerendered files", leaked.length === 0, `${l.path}: ${leaked.map((f) => path.relative(ROOT, f)).join(", ")}`);
}

// Free levels: a sample still returns the full lesson with no session.
const step = Math.max(1, Math.floor(free.length / 8));
for (const l of free.filter((_, i) => i % step === 0).slice(0, 8)) {
  const r = await get(BASE_URL + l.path);
  const missing = [l.marker, l.answer].filter((m) => m && !r.text.includes(m));
  record("free lesson returns full content", r.status === 200 && missing.length === 0 && !r.text.includes(PANEL_TEXT), `${l.path} status ${r.status}, missing: ${missing.join(" | ")}`);
}

// Auth callback: hostile next values must stay on this origin.
for (const next of ["//evil.com", "https://evil.com", "/\\evil.com"]) {
  const r = await get(`${BASE_URL}/auth/callback?code=x&next=${encodeURIComponent(next)}`);
  let ok = r.status >= 300 && r.status < 400 && !!r.location;
  if (ok) {
    const target = new URL(r.location, BASE_URL);
    ok = target.origin === new URL(BASE_URL).origin;
  }
  record("callback redirect stays same-origin", ok, `next=${next} -> ${r.status} ${r.location}`);
}

console.log(`\nGating test against ${BASE_URL}: ${gated.length} gated lessons, ${free.length} free lessons.\n`);
console.log("| Check | Pass | Fail |\n|---|---|---|");
for (const r of rows) console.log(`| ${r.check} | ${r.pass} | ${r.fail} |`);
const total = rows.reduce((n, r) => n + r.fail, 0);
if (total) {
  console.log(`\n${total} failure(s). First 15:`);
  for (const f of failures.slice(0, 15)) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nAll gating checks passed.");
