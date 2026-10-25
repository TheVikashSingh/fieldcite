// Postgres storage for free-scan requests (SPEC F-1, CS-11). Server-side only: it needs a
// service-role connection.

import type pg from "pg";
import { grantCredits, reserveScan, ScanAlreadyRunningError, type Queryable } from "../ledger";
import type { Country } from "../engines/types";
import type { FreeScanRequestStore, NewFreeScanRequest } from "./store";
import { FREE_SCAN } from "./request";

/** 5 questions × 3 engines × 1 run (SPEC F-1). */
export const FREE_SCAN_CALLS = 15;

export interface StartedFreeScan {
  requestId: string;
  scanId: string;
}

export type StartResult = { ok: true; scan: StartedFreeScan } | { ok: false; reason: "not_found" | "repeat" | "paused" | "busy" };

export interface FreeScanRequestRow {
  id: string;
  email: string;
  domain: string;
  brand_name: string;
  category_slug: string;
  country: Country;
  competitors: string[];
  status: "pending" | "running" | "completed" | "failed" | "rejected";
  scan_id: string | null;
  error: string | null;
}

/** True while the free or total daily breaker is at or over its limit (CS-7). */
async function paused(db: Queryable, at: Date): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from public.breaker_levels($1) where breaker in ('free_daily', 'total_daily') and spend_usd >= limit_usd",
    [at],
  );
  return rows[0].n > 0;
}

export class PgFreeScanStore implements FreeScanRequestStore {
  constructor(private readonly pool: pg.Pool) {}

  async countByIpSince(ipHash: Buffer, since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>("select count(*)::int as n from public.free_scan_requests where ip_hash = $1 and created_at >= $2", [ipHash, since]);
    return rows[0].n;
  }

  async countVerifiedSince(email: string, domain: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      "select count(*)::int as n from public.free_scan_requests where (email = $1 or domain = $2) and verified_at >= $3",
      [email, domain, since],
    );
    return rows[0].n;
  }

  freeScansPaused(at: Date): Promise<boolean> {
    return paused(this.pool, at);
  }

  async createRequest(r: NewFreeScanRequest): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into public.free_scan_requests (email, domain, brand_name, category_slug, country, competitors, ip_hash, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [r.email, r.domain, r.brandName, r.categorySlug, r.country, r.competitors, r.ipHash, r.createdAt],
    );
    return rows[0].id;
  }

  /**
   * Runs when the emailed link is confirmed. In one transaction: re-checks the 30-day email and
   * domain limit (two pending requests can't both pass) and the breakers, grants the free scan's
   * 15 credits and reserves them (CS-4, CS-5), and marks the request running. Any failure rolls
   * the grant back, so credits are only ever granted together with a running scan.
   */
  async verifyAndStart(input: { requestId: string; email: string; accountId: string; reportTokenHash: Buffer; at: Date }): Promise<StartResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query<FreeScanRequestRow>(
        "select * from public.free_scan_requests where id = $1 and email = $2 and status = 'pending' for update",
        [input.requestId, input.email],
      );
      const request = rows[0];
      if (!request) {
        await client.query("rollback");
        return { ok: false, reason: "not_found" };
      }
      // Serializes confirmations for the same email or domain, so the count below can't race.
      await client.query("select pg_advisory_xact_lock(hashtextextended('free-scan:' || $1, 0))", [request.email]);
      await client.query("select pg_advisory_xact_lock(hashtextextended('free-scan:' || $1, 0))", [request.domain]);
      const since = new Date(input.at.getTime() - FREE_SCAN.repeatDays * 24 * 60 * 60 * 1000);
      const { rows: seen } = await client.query<{ n: number }>(
        "select count(*)::int as n from public.free_scan_requests where (email = $1 or domain = $2) and verified_at >= $3 and id <> $4",
        [request.email, request.domain, since, request.id],
      );
      const reason = seen[0].n > 0 ? "repeat" : (await paused(client, input.at)) ? "paused" : null;
      if (reason) {
        await client.query("update public.free_scan_requests set status = 'rejected', error = $2 where id = $1", [request.id, reason]);
        await client.query("commit");
        return { ok: false, reason };
      }
      await grantCredits(client, input.accountId, FREE_SCAN_CALLS);
      const { scanId } = await reserveScan(client, { accountId: input.accountId, type: "free", calls: FREE_SCAN_CALLS, country: request.country });
      await client.query(
        "update public.free_scan_requests set status = 'running', verified_at = $2, scan_id = $3, report_token_hash = $4 where id = $1",
        [request.id, input.at, scanId, input.reportTokenHash],
      );
      await client.query("commit");
      return { ok: true, scan: { requestId: request.id, scanId } };
    } catch (err) {
      await client.query("rollback");
      // CS-5: the account already has a running scan (the ledger wrapper maps it to FC002).
      if (err instanceof ScanAlreadyRunningError) return { ok: false, reason: "busy" };
      throw err;
    } finally {
      client.release();
    }
  }

  async getRequest(requestId: string): Promise<FreeScanRequestRow | null> {
    const { rows } = await this.pool.query<FreeScanRequestRow>("select * from public.free_scan_requests where id = $1", [requestId]);
    return rows[0] ?? null;
  }

  async finish(requestId: string, status: "completed" | "failed", error: string | null, at: Date): Promise<void> {
    await this.pool.query("update public.free_scan_requests set status = $2, error = $3, finished_at = $4 where id = $1", [requestId, status, error, at]);
  }

  /** Progress for the status page, by the hash of the token in its URL. */
  async progressByToken(tokenHash: Buffer): Promise<{ status: FreeScanRequestRow["status"]; callsUsed: number; callsReserved: number; hasReport: boolean } | null> {
    const { rows } = await this.pool.query<{ status: FreeScanRequestRow["status"]; calls_used: number | null; calls_reserved: number | null; has_report: boolean }>(
      `select r.status, s.calls_used, s.calls_reserved,
              exists (select 1 from public.scan_reports sr where sr.share_token_hash = r.report_token_hash and sr.revoked_at is null) as has_report
         from public.free_scan_requests r
         left join public.scans s on s.id = r.scan_id
        where r.report_token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    return { status: row.status, callsUsed: row.calls_used ?? 0, callsReserved: row.calls_reserved ?? FREE_SCAN_CALLS, hasReport: row.has_report };
  }
}
