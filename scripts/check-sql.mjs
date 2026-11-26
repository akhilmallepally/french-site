// npm run check:sql: mistakes the Postgres parser doesn't catch, in every SQL file under supabase/
// (and the SQL blocks in docs/db-setup.md). No dependencies.
// - COALESCE, GREATEST, LEAST and NULLIF are SQL keywords (special syntax), not functions: the parser
//   accepts "pg_catalog.coalesce(...)" as a function call, but Postgres rejects it at run time
//   (42883, found when 0009 was first run). Write them unqualified.
// The full syntax check (SQL and PL/pgSQL, with the real parser, libpg_query) isn't a project
// dependency; it was run separately for each migration (docs/progress-log.md, Prompt 76).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const KEYWORD_FUNCS = /\bpg_catalog\s*\.\s*(coalesce|greatest|least|nullif)\s*\(/gi;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".sql") ? [path.join(d, e.name)] : []));

const sources = walk(path.join(root, "supabase")).map((f) => [path.relative(root, f), fs.readFileSync(f, "utf8")]);
const setup = fs.readFileSync(path.join(root, "docs", "db-setup.md"), "utf8");
for (const [i, m] of [...setup.matchAll(/```sql\n([\s\S]*?)```/g)].entries()) sources.push([`docs/db-setup.md (SQL block ${i + 1})`, m[1]]);

let problems = 0;
for (const [file, sql] of sources) {
  for (const m of sql.matchAll(KEYWORD_FUNCS)) {
    problems++;
    console.error(`${file}:${sql.slice(0, m.index).split("\n").length}: "${m[0]}": ${m[1]} is SQL syntax and can't be schema-qualified`);
  }
}
console.log(problems ? `\n${problems} problem(s) in ${sources.length} SQL source(s).` : `SQL OK: ${sources.length} source(s), no schema-qualified COALESCE, GREATEST, LEAST or NULLIF.`);
process.exit(problems ? 1 : 0);
