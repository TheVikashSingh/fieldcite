// Share-link storage against a real Postgres (SPEC F-2, CS-12). Runs in CI's db-test job and is
// skipped when DATABASE_URL is unset. See the README for running it locally.

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDemoReport } from "./demo-source";
import { newShareToken, PgReportSource, saveReport } from "./pg-source";

const url = process.env.DATABASE_URL;
if (!url && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL is not set");
// These tests create scans, so never point them at a shared database.
if (url && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) throw new Error("Database tests only run against a local Postgres");

let pool: pg.Pool;

async function newScan(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>("insert into public.scans (type, calls_reserved) values ('baseline', 15) returning id");
  return rows[0].id;
}

describe.skipIf(!url)("scan_reports", () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("stores a report behind a token and finds it again", async () => {
    const report = await buildDemoReport();
    const scanId = await newScan();
    const token = await saveReport(pool, scanId, { ...report, calls: report.calls.map((c) => ({ ...c, raw: { big: true } })) });
    const found = await new PgReportSource(pool).get(token);
    expect(found?.fixList).toEqual(report.fixList);
    expect(found?.calls.every((c) => c.raw === undefined)).toBe(true);

    // The token itself is never stored.
    const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from public.scan_reports where report::text like $1 or encode(share_token_hash, 'escape') like $1", [`%${token}%`]);
    expect(rows[0].n).toBe(0);
  });

  it("returns null for unknown and revoked tokens", async () => {
    const source = new PgReportSource(pool);
    expect(await source.get(newShareToken())).toBeNull();
    const scanId = await newScan();
    const token = await saveReport(pool, scanId, await buildDemoReport());
    expect(await source.get(token)).not.toBeNull();
    await pool.query("update public.scan_reports set revoked_at = now() where scan_id = $1", [scanId]);
    expect(await source.get(token)).toBeNull();
  });

  it("is not readable by client roles", async () => {
    const client = await pool.connect();
    try {
      for (const role of ["anon", "authenticated"]) {
        await client.query("begin");
        await client.query(`set local role ${role}`);
        await expect(client.query("select report from public.scan_reports")).rejects.toThrow(/permission denied/);
        await client.query("rollback");
      }
    } finally {
      client.release();
    }
  });
});
