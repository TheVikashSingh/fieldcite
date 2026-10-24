// Server wiring for the report pages. DATABASE_URL (a service-role connection) is read here, on
// the server, and nowhere near a client component (CS-12).

import "server-only";
import { notFound } from "next/navigation";
import pg from "pg";
import type { ScanReport } from "../scan/report";
import { PgReportSource } from "./pg-source";
import type { ReportSource } from "./source";

let pool: pg.Pool | undefined;

/** No database configured (local dev, preview builds): every token is unknown. */
const NO_REPORTS: ReportSource = { get: async () => null };

export function shareLinkSource(env: Record<string, string | undefined> = process.env): ReportSource {
  const url = env.DATABASE_URL;
  if (!url) return NO_REPORTS;
  pool ??= new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 });
  return new PgReportSource(pool);
}

/**
 * Loads a report or renders the 404 page. Unknown, malformed and revoked tokens all take the same
 * path, so the response never says whether a token exists.
 */
export async function loadReportOr404(source: ReportSource, token: string): Promise<ScanReport> {
  const report = await source.get(token);
  if (!report) notFound();
  return report;
}
