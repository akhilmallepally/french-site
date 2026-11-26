// npm run test:sql: the SQL in real Postgres (PGlite: Postgres compiled to WebAssembly, a dev
// dependency, no server needed). It applies every migration in supabase/migrations from 0001 in
// order, then all of them again (each one must be safe to re-run), then supabase/tests/rls.sql,
// and fails on any error or if rls.sql doesn't end with "PASS: ALL RLS CHECKS PASSED".
// check:sql runs it too. Every SQL change must pass this before the owner is asked to run anything.
//
// What Supabase provides is stood in for at the start: the anon, authenticated and service_role
// roles (service_role bypasses RLS, as in Supabase) and the auth schema (auth.users, auth.uid() from
// request.jwt.claims). Nothing else is faked: the migrations and rls.sql run as written.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd();
const SUPABASE_STANDINS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key, email text, aud text, role text,
  raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

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
const dir = path.join(root, "supabase", "migrations");
const migrations = fs.readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
for (const pass of ["", " (again)"]) {
  for (const m of migrations) await run(`${m}${pass}`, fs.readFileSync(path.join(dir, m), "utf8"));
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

// The full undo, then a clean re-apply: rollback_all.sql really removes everything the migrations made.
await run("supabase/rollback/rollback_all.sql", fs.readFileSync(path.join(root, "supabase", "rollback", "rollback_all.sql"), "utf8"));
const leftover = await db.query(
  "select count(*)::int as n from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'",
);
if (leftover.rows[0].n !== 0) {
  failed++;
  console.log(`FAIL  rollback_all.sql left ${leftover.rows[0].n} table(s) in public`);
}
for (const m of migrations) await run(`${m} (after the rollback)`, fs.readFileSync(path.join(dir, m), "utf8"));
await db.close();

console.log(
  failed
    ? `\n${failed} problem(s).`
    : `\nSQL runs in Postgres: ${migrations.length} migrations applied twice, rls.sql ${passes} PASS checks, nothing left behind.`,
);
process.exit(failed ? 1 : 0);
