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
import {
  callProgressAction,
  callReviewAction,
  cardTextActionId,
  PROGRESS_CALLS,
  refusedSignedOut,
  REVIEW_CALLS,
  reviewActionId,
  reviewRefusedSignedOut,
  SAMPLE_FREE_CARD,
  SAMPLE_PAID_CARD,
} from "./progress-action-http.mjs";

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
      out.push({ folder, slug, type: data.type, path: `/lessons/${folder}/${slug}`, marker: markerFrom(content), answer: answerFrom(data.exercises) });
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

// Public pages: /pricing, /terms, /refund and /progress must return 200 and leak zero gated lesson markers/answers.
for (const pagePath of ["/pricing", "/terms", "/refund", "/progress", "/practice"]) {
  const r = await get(BASE_URL + pagePath);
  record("public page returns 200", r.status === 200, `${pagePath} status ${r.status}`);
  const leaked = [];
  for (const l of gated) {
    if (l.marker && r.text.includes(l.marker)) leaked.push(`${l.path} marker`);
    if (l.answer && r.text.includes(l.answer)) leaked.push(`${l.path} answer`);
  }
  record("no gated lesson content in public page", leaked.length === 0, `${pagePath} leaked: ${leaked.join(" | ")}`);
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

// The header's Progress link is on every kind of page (one header markup for every screen size).
for (const pagePath of ["/", "/lessons", "/lessons/a1", free[0]?.path, gated[0]?.path, "/pricing", "/progress", "/privacy"].filter(Boolean)) {
  const r = await get(BASE_URL + pagePath);
  record("header has the Progress link", r.status === 200 && /<a[^>]*href="\/progress"[^>]*>Progress<\/a>/.test(r.text), `${pagePath} status ${r.status}`);
}

// /practice: every review lesson listed, linking to its own page (#practice); paid ones lead to the
// usual sign-in or paywall there, and a signed-out visitor sees the lock on paid levels.
{
  const r = await get(BASE_URL + "/practice");
  const reviews = [...gated, ...free].filter((l) => l.type === "review");
  const missing = reviews.filter((l) => !r.text.includes(`href="${l.path}#practice"`)).map((l) => l.path);
  record("/practice links every review lesson to its own page", r.status === 200 && reviews.length > 0 && missing.length === 0, `status ${r.status}, missing: ${missing.join(", ")}`);
  record("/practice shows the lock on paid levels when signed out", (r.text.match(/Lifetime access/g) ?? []).length >= 4, `status ${r.status}`);
  record("/practice is indexable", r.status === 200 && !/<meta name="robots" content="noindex/.test(r.text), `status ${r.status}`);
}

// The shared (cached) price is part of the prerendered shell; only per-visitor slots stream.
// React streams a delayed part as <div hidden id="S:n">, so whatever comes before the first one was
// in the first pass with the rest of the page.
{
  const firstStreamed = (text) => {
    const i = text.indexOf('<div hidden id="S:');
    return i < 0 ? text.length : i;
  };
  const r = await get(BASE_URL + "/pricing");
  const priceAt = r.text.search(/one-time · lifetime access<\/span><\/div><p class="mt-2 text-sm text-muted">Founder price|<span class="font-serif text-4xl font-semibold">\$/);
  record("/pricing: the lifetime price is in the first pass, with the free card", r.status === 200 && priceAt >= 0 && priceAt < firstStreamed(r.text), `status ${r.status}, price at ${priceAt}, first streamed part at ${firstStreamed(r.text)}`);
  record("/pricing: the signed-out visitor's slot is the sign-in link", r.text.includes("Sign in with Google to unlock"), `status ${r.status}`);
  const p = await get(BASE_URL + "/practice");
  const listAt = p.text.indexOf('id="a1-getting-started"');
  record("/practice: the list is in the first pass; only the paid-level locks stream", listAt >= 0 && listAt < firstStreamed(p.text), `list at ${listAt}, first streamed part at ${firstStreamed(p.text)}`);
  const lesson = gated[0];
  const panel = await get(BASE_URL + lesson.path);
  record("paid lesson, signed out: the sign-in panel shows the shared price", panel.status === 200 && /one-time payment \((<!-- -->)?\$\d+/.test(panel.text), `${lesson.path} status ${panel.status}`);
}

// The founding offer (Prompt 76): the countdown on /pricing, the reminder banner on other pages.
{
  const live = Date.now() < Date.parse("2026-12-31T16:59:00Z");
  const pricing = await get(BASE_URL + "/pricing");
  const home = await get(BASE_URL + "/");
  const lesson = await get(BASE_URL + "/lessons/a1/greetings");
  if (live) {
    record("/pricing: the countdown and the static sentence for screen readers", /Founding offer ends in /.test(pricing.text) && pricing.text.replace(/<!-- -->/g, "").includes("The founding offer ends on 31 December 2026 at 23:59 Bangkok time."), `status ${pricing.status}`);
    record("/pricing: the ending date, rendered in Bangkok time", pricing.text.includes("Ends 31 Dec, 23:59 Bangkok time"), "");
    for (const [name, r] of [["/", home], ["/lessons/a1/greetings", lesson]]) {
      record("the banner is in prerendered pages while the offer is live", /role="region" aria-label="Founding offer"/.test(r.text) && /Founding offer: (<!-- -->)?\$\d+(<!-- -->)? for lifetime access, ends in /.test(r.text) && r.text.includes("data-founder-banner"), `${name} status ${r.status}`);
    }
    record("no banner on /pricing itself", !/aria-label="Founding offer"/.test(pricing.text), "");
    record("the banner's Dismiss is a real button", /<button type="button"[^>]*>Dismiss<\/button>/.test(home.text), "");
  } else {
    record("after the deadline: the ended state, and no banner", pricing.text.includes("New plan coming soon") && !/aria-label="Founding offer"/.test(home.text), "");
  }
}

// /progress: personal, so never indexed.
{
  const r = await get(BASE_URL + "/progress");
  record("/progress is noindex", r.status === 200 && /<meta name="robots" content="noindex/.test(r.text), `status ${r.status}`);
}

// Progress actions: a signed-out caller (no session cookie) is refused and gets no progress data.
for (const [name, args] of PROGRESS_CALLS) {
  const r = await callProgressAction(BASE_URL, name, args);
  record("progress action refuses a signed-out caller", refusedSignedOut(r), `${name} -> ${r.status} ${r.text.slice(-80)}`);
}

// Review actions (/review loads them): every one refuses a signed-out caller with no card data.
for (const [name, args] of REVIEW_CALLS) {
  const id = reviewActionId(name);
  if (!id) {
    record("review action refuses a signed-out caller", false, `${name} isn't in the build's manifest`);
    continue;
  }
  const r = await callReviewAction(BASE_URL, id, args, "/review");
  record("review action refuses a signed-out caller", reviewRefusedSignedOut(r), `${name} -> ${r.status} ${r.text.slice(-80)}`);
}
// The card-text read is the exception: free text for anyone, paid text never without access.
{
  const id = cardTextActionId();
  if (!id) record("card text: never returned without access", false, "getCardTextAction isn't in the manifest");
  else {
    // The daily review is part of lifetime access (Prompt 76): no card text without it, free cards included.
    const r = await callReviewAction(BASE_URL, id, [[SAMPLE_FREE_CARD.id, SAMPLE_PAID_CARD.id]], "/review");
    const leaks = [SAMPLE_FREE_CARD.fr, SAMPLE_FREE_CARD.en, SAMPLE_PAID_CARD.fr, SAMPLE_PAID_CARD.en].filter((t) => r.text.includes(JSON.stringify(t).slice(1, -1)));
    record("card text: a signed-out caller gets no card text, free or paid", r.status === 200 && leaks.length === 0 && /"cards":\{\}/.test(r.text) && /"access":false/.test(r.text), `${r.text.slice(-120)}`);
    const many = await callReviewAction(BASE_URL, id, [Array.from({ length: 41 }, (_, i) => `a1-greetings-v${String(i + 1).padStart(3, "0")}`)], "/review");
    record("card text: more than 40 ids is refused", /"code":"too_many_ids"/.test(many.text), many.text.slice(-80));
  }
}

// /review: prerendered, noindex, not in the sitemap, and no card text in the page itself.
{
  const r = await get(BASE_URL + "/review");
  record("/review is noindex", r.status === 200 && /<meta name="robots" content="noindex/.test(r.text), `status ${r.status}`);
  record("/review holds no card text", !r.text.includes(SAMPLE_FREE_CARD.en) && !r.text.includes(SAMPLE_PAID_CARD.fr), "");
  record("/review, signed out: the lifetime-access explanation and a link to /pricing", r.text.includes("Daily review is part of lifetime access: a few minutes a day to keep the words you've learned.") && /href="\/pricing"/.test(r.text), "");
  const sitemap = await get(BASE_URL + "/sitemap.xml");
  record("/review isn't in the sitemap", sitemap.status === 200 && !sitemap.text.includes("/review<"), "");
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
