// Postgres report source: finds a report by its share token (SPEC F-2). Server-side only: it
// needs a service-role connection, and the import below fails the build if a client component
// pulls it in (CS-12).

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Queryable } from "../ledger";
import type { ScanReport } from "../scan/report";
import { withoutRaw, type ReportSource } from "./source";

/** 24 random bytes as base64url: 32 characters, 192 bits, not guessable. */
const TOKEN_BYTES = 24;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const newShareToken = () => randomBytes(TOKEN_BYTES).toString("base64url");

export const isShareToken = (token: string) => TOKEN_PATTERN.test(token);

const tokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest();

/** Stores a scan's report and returns its share token. The token is not stored, only its hash. */
export async function saveReport(db: Queryable, scanId: string, report: ScanReport): Promise<string> {
  const token = newShareToken();
  await db.query("insert into public.scan_reports (scan_id, share_token_hash, report) values ($1, $2, $3)", [
    scanId,
    tokenHash(token),
    JSON.stringify(withoutRaw(report)),
  ]);
  return token;
}

export class PgReportSource implements ReportSource {
  constructor(private readonly db: Queryable) {}

  async get(token: string): Promise<ScanReport | null> {
    // A malformed token can't match, so skip the query. Unknown, malformed and revoked tokens all
    // come back as null, and the page turns every null into the same 404.
    if (!isShareToken(token)) return null;
    const { rows } = await this.db.query<{ report: ScanReport }>(
      "select report from public.scan_reports where share_token_hash = $1 and revoked_at is null",
      [tokenHash(token)],
    );
    return rows[0]?.report ?? null;
  }
}
