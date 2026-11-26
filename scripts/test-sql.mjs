// npm run test:sql: the SQL in real Postgres (PGlite: Postgres compiled to WebAssembly, a dev
// dependency, no server needed). It applies every migration in supabase/migrations from 0001 in
// order, then all of them again (each one must be safe to re-run), then supabase/tests/rls.sql,
// and fails on any error or if rls.sql doesn't end with "PASS: ALL RLS CHECKS PASSED".
// check:sql runs it too. Every SQL change must pass this before the owner is asked to run anything.
//
// Then supabase/tests/access-over-time.sql: has_access() through a subscription's life with an
// injected clock (rollout step 3), which must end with "PASS: ALL ACCESS-OVER-TIME CHECKS PASSED".
//
// What Supabase provides (the roles and the auth schema) is stood in for at the start, by
// scripts/sql-harness.mjs. Nothing else is faked: the migrations and the tests run as written.
import fs from "node:fs";
import path from "node:path";
import { migrationFiles, PGlite, readMigration, SUPABASE_STANDINS } from "./sql-harness.mjs";

const root = process.cwd();

const db = new PGlite();
let failed = 0;

async function run(label, sql, onNotice) {
  try {
    await db.exec(sql, onNotice ? { onNotice } : undefined);
    console.log(`OK    ${label}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${label}: ${e.message}${e.where ? `\n      where: ${String(e.where).split("\n")[0]}` : ""}`);
  }
}

await run("Supabase stand-ins (roles, auth schema)", SUPABASE_STANDINS);
const migrations = migrationFiles();
for (const pass of ["", " (again)"]) {
  for (const m of migrations) await run(`${m}${pass}`, readMigration(m));
}

const notices = [];
await run("supabase/tests/rls.sql", fs.readFileSync(path.join(root, "supabase", "tests", "rls.sql"), "utf8"), (n) => notices.push(n.message));
const passes = notices.filter((n) => n.startsWith("PASS")).length;
if (!notices.includes("PASS: ALL RLS CHECKS PASSED")) {
  failed++;
  console.log(`FAIL  rls.sql did not reach "PASS: ALL RLS CHECKS PASSED" (last notice: ${notices.at(-1) ?? "none"})`);
}
const left = await db.query("select count(*)::int as n from auth.users");
if (left.rows[0].n !== 0) {
  failed++;
  console.log(`FAIL  rls.sql left ${left.rows[0].n} user(s) behind (it must end in ROLLBACK)`);
}

// Access over time: has_access() with an injected clock.
const timeNotices = [];
await run("supabase/tests/access-over-time.sql", fs.readFileSync(path.join(root, "supabase", "tests", "access-over-time.sql"), "utf8"), (n) => timeNotices.push(n.message));
const timePasses = timeNotices.filter((n) => n.startsWith("PASS")).length;
if (!timeNotices.includes("PASS: ALL ACCESS-OVER-TIME CHECKS PASSED")) {
  failed++;
  console.log(`FAIL  access-over-time.sql did not reach "PASS: ALL ACCESS-OVER-TIME CHECKS PASSED" (last notice: ${timeNotices.at(-1) ?? "none"})`);
}
const leftAfterTime = await db.query("select count(*)::int as n from auth.users");
if (leftAfterTime.rows[0].n !== 0) {
  failed++;
  console.log(`FAIL  access-over-time.sql left ${leftAfterTime.rows[0].n} user(s) behind (it must end in ROLLBACK)`);
}

// The full undo, then a clean re-apply: rollback_all.sql really removes everything the migrations made.
await run("supabase/rollback/rollback_all.sql", fs.readFileSync(path.join(root, "supabase", "rollback", "rollback_all.sql"), "utf8"));
const leftover = await db.query(
  "select count(*)::int as n from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'",
);
if (leftover.rows[0].n !== 0) {
  failed++;
  console.log(`FAIL  rollback_all.sql left ${leftover.rows[0].n} table(s) in public`);
}
for (const m of migrations) await run(`${m} (after the rollback)`, readMigration(m));
await db.close();

console.log(
  failed
    ? `\n${failed} problem(s).`
    : `\nSQL runs in Postgres: ${migrations.length} migrations applied twice, rls.sql ${passes} PASS checks, access-over-time.sql ${timePasses}, nothing left behind.`,
);
process.exit(failed ? 1 : 0);
