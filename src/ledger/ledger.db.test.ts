// Credit ledger tests against a real Postgres (CS-4, CS-5). They run in CI's db-test job and
// are skipped when DATABASE_URL is unset. See the README for running them locally.

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdapters } from "../engines";
import { AliasBrandExtractor } from "../extract/brands";
import { loadCategory, planScan } from "../scan/plan";
import { runScan, type CallRecord } from "../scan/run";
import {
  CallBudgetError,
  finishScan,
  getBalance,
  grantCredits,
  InsufficientCreditsError,
  ReservationExceededError,
  reserveScan,
  ScanAlreadyRunningError,
  ScanNotRunningError,
} from "./index";
import { PgScanStorage } from "./scan-storage";

const url = process.env.DATABASE_URL;
if (!url && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL is not set");
// These tests create accounts and scans, so never point them at a shared database.
if (url && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) throw new Error("Database tests only run against a local Postgres");

let pool: pg.Pool;

async function createAccount(credits: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "insert into public.accounts (owner_id, email) values (gen_random_uuid(), 'test@example.com') returning id",
  );
  if (credits > 0) await grantCredits(pool, rows[0].id, credits);
  return rows[0].id;
}

/**
 * Makes concurrent calls really overlap: holds the account's row lock while `start` fires the
 * calls, waits until `waiters` of them are blocked on that lock, then lets them all go at once.
 */
async function race<T>(accountId: string, waiters: number, start: () => Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
  const holder = await pool.connect();
  try {
    await holder.query("begin");
    await holder.query("select 1 from public.accounts where id = $1 for update", [accountId]);
    const settled = Promise.allSettled(start());
    for (let i = 0; ; i++) {
      // Polled outside the holder's transaction: pg_stat_activity is a per-transaction snapshot.
      const { rows } = await pool.query<{ n: number }>(
        "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like '%reserve_scan%' and pid <> pg_backend_pid()",
      );
      if (rows[0].n >= waiters) break;
      if (i > 400) throw new Error(`Only ${rows[0].n} of ${waiters} calls blocked on the account lock`);
      await new Promise((r) => setTimeout(r, 25));
    }
    await holder.query("commit");
    return await settled;
  } finally {
    holder.release();
  }
}

async function ledgerRows(accountId: string) {
  const { rows } = await pool.query<{ delta: number; reason: string; balance_after: number }>(
    "select delta, reason, balance_after from public.credit_ledger where account_id = $1 order by id",
    [accountId],
  );
  return rows;
}

async function runningScans(accountId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from public.scans where account_id = $1 and status = 'running'", [accountId]);
  return rows[0].n;
}

function call(costUsd: number, status: CallRecord["status"] = "ok"): CallRecord {
  return {
    engine: "openai",
    model: "gpt-test",
    questionIndex: 0,
    question: "best pest control software",
    run: 1,
    status,
    text: "",
    citations: [],
    mentions: [],
    usage: { inputTokens: 100, outputTokens: 50, searchCalls: 1 },
    costUsd,
    attempts: 1,
    latencyMs: 10,
  };
}

describe.skipIf(!url)("credit ledger (Postgres)", () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  describe("CS-4: two scans racing for the last credits", () => {
    it("lets exactly one of two reservations take the last credits", async () => {
      const account = await createAccount(15);
      const results = await race(account, 2, () => [
        reserveScan(pool, { accountId: account, type: "paid", calls: 10 }),
        reserveScan(pool, { accountId: account, type: "paid", calls: 10 }),
      ]);

      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r) => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCreditsError);

      expect(await getBalance(pool, account)).toBe(5);
      expect(await runningScans(account)).toBe(1);
      const rows = await ledgerRows(account);
      expect(rows.map((r) => [r.reason, r.delta, r.balance_after])).toEqual([
        ["grant", 15, 15],
        ["reserve", -10, 5],
      ]);
    });

    it("never overdraws with 20 reservations at once", async () => {
      const account = await createAccount(25);
      const results = await race(account, 20, () =>
        Array.from({ length: 20 }, () => reserveScan(pool, { accountId: account, type: "paid", calls: 20 })),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCreditsError);
      }
      expect(await getBalance(pool, account)).toBe(5);
    });

    it("rejects a scan the balance can't cover in full", async () => {
      const account = await createAccount(9);
      await expect(reserveScan(pool, { accountId: account, type: "free", calls: 10 })).rejects.toBeInstanceOf(InsufficientCreditsError);
      expect(await getBalance(pool, account)).toBe(9);
      expect(await runningScans(account)).toBe(0);
    });
  });

  describe("CS-5: one running scan per account", () => {
    it("lets only one of two scans started at once run", async () => {
      const account = await createAccount(100);
      const results = await race(account, 2, () => [
        reserveScan(pool, { accountId: account, type: "paid", calls: 10 }),
        reserveScan(pool, { accountId: account, type: "paid", calls: 10 }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(lost).toHaveLength(1);
      expect(lost[0].reason).toBeInstanceOf(ScanAlreadyRunningError);
      // The losing scan reserved nothing.
      expect(await getBalance(pool, account)).toBe(90);
      expect(await runningScans(account)).toBe(1);
    });

    it("allows the next scan once the running one finishes", async () => {
      const account = await createAccount(30);
      const first = await reserveScan(pool, { accountId: account, type: "paid", calls: 10 });
      await expect(reserveScan(pool, { accountId: account, type: "paid", calls: 10 })).rejects.toBeInstanceOf(ScanAlreadyRunningError);
      await finishScan(pool, first.scanId);
      const second = await reserveScan(pool, { accountId: account, type: "paid", calls: 10 });
      expect(second.scanId).not.toBe(first.scanId);
    });

    it("refuses call budgets outside 1–150", async () => {
      const account = await createAccount(500);
      await expect(reserveScan(pool, { accountId: account, type: "paid", calls: 151 })).rejects.toBeInstanceOf(CallBudgetError);
      await expect(reserveScan(pool, { accountId: account, type: "paid", calls: 0 })).rejects.toBeInstanceOf(CallBudgetError);
      expect(await getBalance(pool, account)).toBe(500);
    });
  });

  describe("refunds and the reservation cap", () => {
    it("refunds unused calls on completion and totals the cost", async () => {
      const account = await createAccount(20);
      const { scanId } = await reserveScan(pool, { accountId: account, type: "paid", calls: 10 });
      const storage = new PgScanStorage(pool, scanId);
      for (const cost of [0.01, 0.02, 0.005]) await storage.recordCall(call(cost));
      await storage.recordCall(call(0, "error"));
      await storage.recordCall(call(0, "skipped")); // never made, so not charged

      const settled = await finishScan(pool, scanId);
      expect(settled).toEqual({ callsUsed: 4, refunded: 6, balanceAfter: 16, costUsd: 0.035 });
      expect((await ledgerRows(account)).map((r) => [r.reason, r.delta, r.balance_after])).toEqual([
        ["grant", 20, 20],
        ["reserve", -10, 10],
        ["refund", 6, 16],
      ]);
    });

    it("never refunds twice and records nothing after the scan ends", async () => {
      const account = await createAccount(10);
      const { scanId } = await reserveScan(pool, { accountId: account, type: "free", calls: 5 });
      await finishScan(pool, scanId, "cancelled");
      await expect(finishScan(pool, scanId)).rejects.toBeInstanceOf(ScanNotRunningError);
      await expect(new PgScanStorage(pool, scanId).recordCall(call(0.01))).rejects.toBeInstanceOf(ScanNotRunningError);
      expect(await getBalance(pool, account)).toBe(10);
    });

    it("refuses calls past the reservation, even when recorded concurrently", async () => {
      const account = await createAccount(10);
      const { scanId } = await reserveScan(pool, { accountId: account, type: "paid", calls: 3 });
      const storage = new PgScanStorage(pool, scanId);
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => storage.recordCall(call(0.01))));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ReservationExceededError);
      }
      expect(await finishScan(pool, scanId)).toMatchObject({ callsUsed: 3, refunded: 0, balanceAfter: 7 });
    });

    it("stops runScan at the reservation (end to end with fixture engines)", async () => {
      const plan = planScan({ category: loadCategory("pest-control"), country: "US", questions: 2, runs: 1, engines: ["openai", "perplexity"] });
      const account = await createAccount(50);
      // Reserve one call fewer than planned: the last call is made but can't be recorded.
      const { scanId } = await reserveScan(pool, { accountId: account, type: "paid", calls: plan.totalCalls - 1 });
      const result = await runScan(plan, createAdapters(plan.engines, { dryRun: true, env: {} }), new AliasBrandExtractor(), {
        dryRun: true,
        storage: new PgScanStorage(pool, scanId),
      });
      expect(result.stoppedReason).toMatch(/used all its reserved calls/);
      const settled = await finishScan(pool, scanId);
      expect(settled.callsUsed).toBe(plan.totalCalls - 1);
      expect(settled.costUsd).toBeGreaterThan(0);
    });
  });

  describe("row-level security", () => {
    async function asUser<T>(ownerId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("set local role authenticated");
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
        return await fn(c);
      } finally {
        await c.query("rollback");
        c.release();
      }
    }

    it("shows a user only their own account and ledger, and blocks writes", async () => {
      const mine = await createAccount(10);
      const theirs = await createAccount(10);
      const { rows } = await pool.query<{ owner_id: string }>("select owner_id from public.accounts where id = $1", [mine]);
      const owner = rows[0].owner_id;

      const seen = await asUser(owner, async (c) => ({
        accounts: (await c.query("select id from public.accounts")).rows.map((r) => r.id),
        ledger: (await c.query("select distinct account_id from public.credit_ledger")).rows.map((r) => r.account_id),
      }));
      expect(seen.accounts).toEqual([mine]);
      expect(seen.ledger).toEqual([mine]);
      expect(seen.accounts).not.toContain(theirs);

      await expect(asUser(owner, (c) => c.query("update public.accounts set credit_balance = 1000000 where id = $1", [mine]))).rejects.toMatchObject({ code: "42501" });
      await expect(asUser(owner, (c) => c.query("select public.grant_credits($1, 1000)", [mine]))).rejects.toMatchObject({ code: "42501" });
      await expect(asUser(owner, (c) => c.query("select * from public.reserve_scan($1, 'paid', 5)", [mine]))).rejects.toMatchObject({ code: "42501" });
      await expect(asUser(owner, (c) => c.query("select * from public.cited_pages"))).rejects.toMatchObject({ code: "42501" });
    });
  });
});
