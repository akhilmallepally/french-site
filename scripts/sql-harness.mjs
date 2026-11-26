// Real Postgres for tests (PGlite: Postgres compiled to WebAssembly, a dev dependency, no server).
// Used by scripts/test-sql.mjs and lib/access-over-time.test.ts.
//
// What Supabase provides is stood in for: the anon, authenticated and service_role roles
// (service_role bypasses RLS, as in Supabase) and the auth schema (auth.users, auth.uid() from
// request.jwt.claims). Nothing else is faked: the migrations run as written.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

export const SUPABASE_STANDINS = `
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

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/** Every migration file, in order (0001_..., 0002_...). */
export const migrationFiles = () => fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

export const readMigration = (file) => fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

/** A fresh database with the stand-ins and every migration applied once. Throws on any error. */
export async function migratedDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDINS);
  for (const m of migrationFiles()) await db.exec(readMigration(m));
  return db;
}

export { PGlite };
