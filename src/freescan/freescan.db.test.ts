// The free-scan flow end to end against a real Postgres and mocked engines (SPEC F-1, CS-11):
// form → emailed link → confirm → 15-call scan through the ledger and breakers → stored report.
// This is the Week 3 exit check ("a stranger gets a report in under 3 minutes") with fixture
// engines. Runs in CI's db-test job; skipped when DATABASE_URL is unset.

import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmMagicLink } from "../auth/magic-link";
import { PgAuthStore } from "../auth/pg-store";
import { LogNotifier } from "../cost/notifier";
import { MemoryMailer } from "../email/mailer";
import { getBalance } from "../ledger";
import { PgReportSource, shareTokenHash } from "../report/pg-source";
import { confirmFreeScan } from "./confirm";
import { FREE_SCAN_CALLS, PgFreeScanStore } from "./pg-store";
import { submitFreeScan, type FreeScanDeps, type FreeScanInput } from "./request";
import { runFreeScan } from "./run";
import { SKIP_TURNSTILE } from "./turnstile";

const url = process.env.DATABASE_URL;
if (!url && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL is not set");
if (url && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) throw new Error("Database tests only run against a local Postgres");

let pool: pg.Pool;
const BASE_URL = "http://localhost:3000";

/** A day of its own, so this file's spend never trips another test's breakers (or theirs, ours). */
function uniqueDay(): Date {
  return new Date(Date.UTC(2400 + Math.floor(Math.random() * 500), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 27), 9));
}

/** A clock that starts at `start` and moves 1 s per reading, like a real scan. */
function clock(start: Date) {
  let t = start.getTime();
  return () => new Date((t += 1000));
}

function vendor() {
  const id = randomUUID().slice(0, 8);
  return { email: `owner@vendor-${id}.com`, domain: `vendor-${id}.com`, ip: `198.51.100.${Math.floor(Math.random() * 250)}-${id}` };
}

function input(v: ReturnType<typeof vendor>, extra: Partial<FreeScanInput> = {}): FreeScanInput {
  return { email: v.email, domain: v.domain, brandName: "Acme Pest Pro", categorySlug: "pest-control", country: "US", competitors: ["GorillaDesk"], turnstileToken: "t", ip: v.ip, ...extra };
}

function formDeps(mailer: MemoryMailer, now: () => Date): FreeScanDeps {
  return { store: new PgFreeScanStore(pool), turnstile: SKIP_TURNSTILE, magicLinks: { store: new PgAuthStore(pool), mailer, baseUrl: BASE_URL }, ipHashKey: "k".repeat(40), env: {}, now };
}

async function confirmLatest(mailer: MemoryMailer, email: string, now: () => Date) {
  const token = new URL(mailer.lastLinkTo(email)!).searchParams.get("token")!;
  const link = await confirmMagicLink({ store: new PgAuthStore(pool), now }, token);
  expect(link?.purpose).toBe("free_scan");
  return link!;
}

describe.skipIf(!url)("free scan end to end (Postgres, fixture engines)", () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url, max: 10 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("gets a stranger from the form to a stored report in under 3 minutes", async () => {
    const started = Date.now();
    const now = clock(uniqueDay());
    const mailer = new MemoryMailer();
    const v = vendor();
    const store = new PgFreeScanStore(pool);

    expect(await submitFreeScan(input(v), formDeps(mailer, now))).toEqual({ ok: true });
    const link = await confirmLatest(mailer, v.email, now);
    const scan = await confirmFreeScan(store, link, now());
    if (!scan.ok) throw new Error(`not started: ${scan.reason}`);

    const progress = await store.progressByToken(shareTokenHash(scan.reportToken));
    expect(progress).toMatchObject({ status: "running", callsReserved: FREE_SCAN_CALLS, hasReport: false });

    const outcome = await runFreeScan({ pool, store, mailer, notifier: new LogNotifier(() => {}), baseUrl: BASE_URL, env: {}, now, log: () => {} }, scan);
    expect(outcome).toBe("completed");

    const report = await new PgReportSource(pool).get(scan.reportToken);
    expect(report).not.toBeNull();
    expect(report!.dryRun).toBe(true);
    expect(report!.totals).toMatchObject({ plannedCalls: FREE_SCAN_CALLS, ok: FREE_SCAN_CALLS });
    expect(report!.targetBrand).toBe("Acme Pest Pro");
    expect(report!.fixList?.length).toBeGreaterThan(0);
    expect(await store.progressByToken(shareTokenHash(scan.reportToken))).toMatchObject({ status: "completed", callsUsed: FREE_SCAN_CALLS, hasReport: true });

    // Every call went through the ledger: 15 granted, 15 used, nothing left over (CS-4).
    expect(await getBalance(pool, link.accountId)).toBe(0);
    const { rows } = await pool.query<{ status: string; calls_used: number; type: string }>("select status, calls_used, type from public.scans where id = $1", [scan.scanId]);
    expect(rows[0]).toEqual({ status: "completed", calls_used: FREE_SCAN_CALLS, type: "free" });
    // Each call's cost was logged and rolled into free-scan spend (CS-9, CS-7).
    const { rows: calls } = await pool.query<{ n: number; usd: string }>("select count(*)::int as n, sum(cost_usd) as usd from public.engine_calls where scan_id = $1", [scan.scanId]);
    expect(calls[0].n).toBe(FREE_SCAN_CALLS);
    expect(Number(calls[0].usd)).toBeGreaterThan(0);

    // The report link was emailed.
    expect(mailer.sent.at(-1)).toMatchObject({ to: v.email, subject: "Your FieldCite report is ready" });
    expect(mailer.lastLinkTo(v.email)).toBe(`${BASE_URL}/r/${scan.reportToken}`);

    expect(Date.now() - started).toBeLessThan(180_000);
  });

  it("refuses a second free scan for the same email or domain within 30 days", async () => {
    const now = clock(uniqueDay());
    const mailer = new MemoryMailer();
    const v = vendor();
    const store = new PgFreeScanStore(pool);
    await submitFreeScan(input(v), formDeps(mailer, now));
    const scan = await confirmFreeScan(store, await confirmLatest(mailer, v.email, now), now());
    expect(scan.ok).toBe(true);

    expect(await submitFreeScan(input(v, { ip: `${v.ip}-2` }), formDeps(mailer, now))).toMatchObject({ ok: false, error: "repeat" });
    expect(await submitFreeScan(input(v, { email: `cto@${v.domain}`, ip: `${v.ip}-3` }), formDeps(mailer, now))).toMatchObject({ ok: false, error: "repeat" });
  });

  it("lets only one of two pending requests for the same domain start, even when confirmed at once", async () => {
    const now = clock(uniqueDay());
    const mailer = new MemoryMailer();
    const v = vendor();
    const store = new PgFreeScanStore(pool);
    const other = `ops@${v.domain}`;
    await submitFreeScan(input(v), formDeps(mailer, now));
    await submitFreeScan(input(v, { email: other, ip: `${v.ip}-b` }), formDeps(mailer, now));
    const [a, b] = await Promise.all([confirmLatest(mailer, v.email, now), confirmLatest(mailer, other, now)]);
    const at = now();
    const results = await Promise.all([confirmFreeScan(store, a, at), confirmFreeScan(store, b, at)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "repeat" });
    // The rejected account was never granted credits.
    const loser = results[0].ok ? b : a;
    expect(await getBalance(pool, loser.accountId)).toBe(0);
  });

  it("allows at most 3 free-scan requests per IP per day", async () => {
    const now = clock(uniqueDay());
    const mailer = new MemoryMailer();
    const ip = `203.0.113.9-${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 3; i++) expect(await submitFreeScan(input(vendor(), { ip }), formDeps(mailer, now))).toEqual({ ok: true });
    expect(await submitFreeScan(input(vendor(), { ip }), formDeps(mailer, now))).toMatchObject({ ok: false, error: "ip_limit" });
  });

  it("pauses free scans at the form and at confirmation while the free breaker is tripped (CS-7)", async () => {
    const day = uniqueDay();
    const now = clock(day);
    const mailer = new MemoryMailer();
    const v = vendor();
    const store = new PgFreeScanStore(pool);
    await submitFreeScan(input(v), formDeps(mailer, now));
    const link = await confirmLatest(mailer, v.email, now);

    // $10 of free-scan spend on this day trips the free breaker.
    await pool.query("insert into public.spend_daily (day, engine, scope, usd) values ($1, 'openai', 'free', 10)", [day.toISOString().slice(0, 10)]);
    expect(await submitFreeScan(input(vendor()), formDeps(mailer, now))).toMatchObject({ ok: false, error: "paused" });
    expect(await confirmFreeScan(store, link, now())).toEqual({ ok: false, reason: "paused" });
    expect(await getBalance(pool, link.accountId)).toBe(0);
  });

  it("stops a running free scan when the kill switch flips and refunds unused calls (CS-8, CS-4)", async () => {
    const now = clock(uniqueDay());
    const mailer = new MemoryMailer();
    const v = vendor();
    const store = new PgFreeScanStore(pool);
    await submitFreeScan(input(v), formDeps(mailer, now));
    const link = await confirmLatest(mailer, v.email, now);
    const scan = await confirmFreeScan(store, link, now());
    if (!scan.ok) throw new Error(scan.reason);

    const outcome = await runFreeScan(
      { pool, store, mailer, notifier: new LogNotifier(() => {}), baseUrl: BASE_URL, env: { SCANS_ENABLED: "false" }, now, log: () => {} },
      scan,
    );
    expect(outcome).toBe("failed");
    expect(await getBalance(pool, link.accountId)).toBe(FREE_SCAN_CALLS);
    expect(await new PgReportSource(pool).get(scan.reportToken)).toBeNull();
    expect(await store.progressByToken(shareTokenHash(scan.reportToken))).toMatchObject({ status: "failed" });
  });
});
