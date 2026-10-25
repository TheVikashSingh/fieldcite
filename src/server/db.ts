// The app's Postgres pool. DATABASE_URL is a service-role connection, read only on the server (CS-12).

import "server-only";
import pg from "pg";
import type { Env } from "../engines/guard";

let pool: pg.Pool | undefined;

/** The shared pool, or null when no database is configured (local dev without Postgres, preview builds). */
export function getDb(env: Env = process.env): pg.Pool | null {
  const url = env.DATABASE_URL;
  if (!url) return null;
  pool ??= new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5_000, statement_timeout: 10_000 });
  return pool;
}

/** The public origin used in emailed links. Production must set APP_URL. */
export function appUrl(env: Env = process.env): string {
  if (env.APP_URL) return env.APP_URL.replace(/\/+$/, "");
  if (env.NODE_ENV === "production") throw new Error("APP_URL must be set in production.");
  return "http://localhost:3000";
}
