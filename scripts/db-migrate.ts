// Applies supabase/migrations/*.sql in order to the plain Postgres at DATABASE_URL (CI or
// local Docker). Each file runs in its own transaction and is recorded, so re-running only
// applies new files. On Supabase, use the Supabase CLI instead (`supabase db push`).
//
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:migrate

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const dir = join(import.meta.dirname, "..", "supabase", "migrations");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      create schema if not exists local_migrations;
      create table if not exists local_migrations.applied (
        name text primary key,
        applied_at timestamptz not null default now()
      )`);
    const done = new Set((await client.query<{ name: string }>("select name from local_migrations.applied")).rows.map((r) => r.name));
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into local_migrations.applied (name) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
      console.log(`applied ${file}`);
    }
    console.log(`Database is up to date (${files.length} migrations).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
