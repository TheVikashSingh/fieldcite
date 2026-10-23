// Spend rollup, circuit breakers (CS-7), answer cache (CS-10) and the daily summary (CS-9, CS-13)
// against a real Postgres. They run in CI's db-test job and are skipped when DATABASE_URL is unset.
//
// Spend is global, so every test works in its own random far-future day or month (calls carry
// their own timestamps). Tests can then run in parallel with the ledger tests and with each other.

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdapters } from "../engines";
import type { Country, EngineId } from "../engines/types";
import { AliasBrandExtractor } from "../extract/brands";
import { finishScan, grantCredits, reserveScan, ScanNotRunningError, type ScanType } from "../ledger";
import { PgScanStorage } from "../ledger/scan-storage";
import { loadCategory, planScan } from "../scan/plan";
import { runScan, type CallRecord } from "../scan/run";
import { breakerStatus, BreakerTrippedError, checkBreakers, PgCallGate } from "./breakers";
import { PgAnswerCache } from "./cache";
import type { Notifier, OwnerMessage } from "./notifier";
import { loadDailySpend } from "./spend-summary";

const url = process.env.DATABASE_URL;
if (!url && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL is not set");
if (url && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) throw new Error("Database tests only run against a local Postgres");

let pool: pg.Pool;
const HOUR = 3_600_000;

/** Noon UTC on the 1st of a random month in 2100–2899, so no two tests share a period. */
function uniqueMonth(): Date {
  const n = Math.floor(Math.random() * 9_600);
  return new Date(Date.UTC(2100 + Math.floor(n / 12), n % 12, 1, 12));
}
const plusDays = (d: Date, days: number) => new Date(d.getTime() + days * 24 * HOUR);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function startScan(type: ScanType | "baseline", startedAt: Date): Promise<string> {
  let scanId: string;
  if (type === "baseline") {
    const { rows } = await pool.query<{ id: string }>("insert into public.scans (type, calls_reserved) values ('baseline', 150) returning id");
    scanId = rows[0].id;
  } else {
    const { rows } = await pool.query<{ id: string }>(
      "insert into public.accounts (owner_id, email) values (gen_random_uuid(), $1) returning id",
      [`${type}-${Math.random().toString(36).slice(2)}@example.com`],
    );
    await grantCredits(pool, rows[0].id, 150);
    scanId = (await reserveScan(pool, { accountId: rows[0].id, type, calls: 150 })).scanId;
  }
  await pool.query("update public.scans set started_at = $2 where id = $1", [scanId, startedAt]);
  return scanId;
}

function call(costUsd: number, at: Date, engine: EngineId = "openai"): CallRecord {
  return {
    engine,
    model: "test-model",
    questionIndex: 0,
    question: "best pest control software",
    run: 1,
    status: "ok",
    text: "",
    citations: [],
    mentions: [],
    usage: { inputTokens: 100, outputTokens: 50, searchCalls: 1 },
    costUsd,
    attempts: 1,
    latencyMs: 10,
    at: at.toISOString(),
  };
}

const spend = (scanId: string, usd: number, at: Date, engine?: EngineId) => new PgScanStorage(pool, scanId).recordCall(call(usd, at, engine));

async function spendRow(day: Date, engine: EngineId, scope: string): Promise<number> {
  const { rows } = await pool.query<{ usd: string }>("select usd from public.spend_daily where day = $1::date and engine = $2 and scope = $3", [isoDay(day), engine, scope]);
  return rows.length ? Number(rows[0].usd) : 0;
}

class Collect implements Notifier {
  messages: OwnerMessage[] = [];
  async notify(m: OwnerMessage) {
    this.messages.push(m);
  }
}

describe.skipIf(!url)("cost safety (Postgres)", () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url, max: 20 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  describe("spend_daily rollup", () => {
    it("adds each call's cost by day, engine and scan type", async () => {
      const t = uniqueMonth();
      const free = await startScan("free", t);
      const paid = await startScan("paid", t);
      await spend(free, 0.01, t);
      await spend(free, 0.02, t);
      await spend(paid, 0.5, t, "gemini");
      await spend(paid, 0.25, plusDays(t, 1), "gemini");

      expect(await spendRow(t, "openai", "free")).toBe(0.03);
      expect(await spendRow(t, "gemini", "paid")).toBe(0.5);
      expect(await spendRow(plusDays(t, 1), "gemini", "paid")).toBe(0.25);
      expect(await spendRow(t, "openai", "paid")).toBe(0);
    });

    it("adds nothing when the call can't be recorded (same transaction)", async () => {
      const t = uniqueMonth();
      const scan = await startScan("paid", t);
      await spend(scan, 1, t);
      await finishScan(pool, scan);
      await expect(spend(scan, 5, t)).rejects.toBeInstanceOf(ScanNotRunningError);
      expect(await spendRow(t, "openai", "paid")).toBe(1);
    });
  });

  describe("CS-7 circuit breakers", () => {
    it("pauses free scans at exactly $10/day of free spend, and nothing else", async () => {
      const t = uniqueMonth();
      const free = await startScan("free", t);
      const paidLater = await startScan("paid", plusDays(t, 0.01));
      const baseline = await startScan("baseline", t);

      await spend(free, 6, t);
      await spend(free, 3.99, t, "perplexity");
      expect(await checkBreakers(pool, free, t)).toBeNull();

      await spend(free, 0.01, t, "gemini"); // $10.00 exactly
      expect(await checkBreakers(pool, free, t)).toBe("free_daily");
      expect(await checkBreakers(pool, paidLater, plusDays(t, 0.02))).toBeNull();
      expect(await checkBreakers(pool, baseline, t)).toBeNull();
      // A new day resets it.
      expect(await checkBreakers(pool, free, plusDays(t, 1))).toBeNull();
    });

    it("pauses everything except in-flight paid scans at exactly $30/day total", async () => {
      const t = uniqueMonth();
      const inFlight = await startScan("paid", new Date(t.getTime() - HOUR));
      const free = await startScan("free", new Date(t.getTime() - HOUR));
      const baseline = await startScan("baseline", new Date(t.getTime() - HOUR));
      const paidLater = await startScan("paid", new Date(t.getTime() + 60_000));

      await spend(inFlight, 20, t);
      await spend(baseline, 9.99, t);
      for (const s of [inFlight, free, baseline]) expect(await checkBreakers(pool, s, t)).toBeNull();

      await spend(free, 0.01, t); // $30.00 exactly; tripped at t
      const later = new Date(t.getTime() + 2 * 60_000);
      expect(await checkBreakers(pool, inFlight, later)).toBeNull();
      expect(await checkBreakers(pool, free, later)).toBe("total_daily");
      expect(await checkBreakers(pool, baseline, later)).toBe("total_daily");
      expect(await checkBreakers(pool, paidLater, later)).toBe("total_daily");
    });

    it("lets a paid scan in flight finish through the gate after the $30 breaker trips", async () => {
      const t = uniqueMonth();
      const inFlight = await startScan("paid", new Date(t.getTime() - HOUR));
      const other = await startScan("paid", new Date(t.getTime() - HOUR));
      await spend(other, 30, t); // trips total_daily at t
      const lateScan = await startScan("paid", new Date(t.getTime() + 60_000));

      const plan = planScan({ category: loadCategory("pest-control"), country: "US", questions: 3, runs: 1, engines: ["openai", "perplexity"] });
      const at = new Date(t.getTime() + 5 * 60_000);
      const run = (scanId: string, notifier: Notifier) =>
        runScan(plan, createAdapters(plan.engines, { dryRun: true, env: {} }), new AliasBrandExtractor(), {
          dryRun: true,
          env: {},
          now: () => at,
          storage: new PgScanStorage(pool, scanId),
          gate: new PgCallGate(pool, scanId, notifier, { env: {} }),
        });

      const survived = await run(inFlight, new Collect());
      expect(survived.stoppedReason).toBeUndefined();
      expect(survived.calls.every((c) => c.status === "ok")).toBe(true);

      const blocked = await run(lateScan, new Collect());
      expect(blocked.calls.every((c) => c.status === "skipped")).toBe(true);
      expect(blocked.stoppedReason).toMatch(/total_daily/);
      expect((await finishScan(pool, lateScan)).callsUsed).toBe(0);
    });

    it("pauses baseline scans at exactly $60 above the monthly forecast", async () => {
      const t = uniqueMonth();
      const { rows } = await pool.query<{ forecast: string; overrun: string }>(
        "select baseline_monthly_forecast_usd as forecast, baseline_monthly_overrun_usd as overrun from public.cost_settings",
      );
      const limit = Number(rows[0].forecast) + Number(rows[0].overrun);
      expect(Number(rows[0].overrun)).toBe(60);

      const baseline = await startScan("baseline", t);
      const paid = await startScan("paid", t);
      const free = await startScan("free", t);
      // Spread over days so no day reaches the $30 total breaker.
      let left = Math.round((limit - 0.01) * 100) / 100;
      for (let day = 0; left > 0; day++) {
        const usd = Math.min(25, left);
        await spend(baseline, usd, plusDays(t, day));
        left = Math.round((left - usd) * 100) / 100;
      }
      const end = plusDays(t, 5);
      expect(await checkBreakers(pool, baseline, end)).toBeNull();

      await spend(baseline, 0.01, end);
      expect(await checkBreakers(pool, baseline, end)).toBe("baseline_monthly");
      expect(await checkBreakers(pool, paid, end)).toBeNull();
      expect(await checkBreakers(pool, free, end)).toBeNull();
      // The next calendar month starts clean.
      const nextMonth = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1, 12));
      expect(await checkBreakers(pool, baseline, nextMonth)).toBeNull();
    });

    it("notifies the owner once per trip, even with concurrent checks", async () => {
      const t = uniqueMonth();
      const free = await startScan("free", t);
      await spend(free, 10, t);
      const notifier = new Collect();
      const gates = Array.from({ length: 5 }, () => new PgCallGate(pool, free, notifier, { env: {} }));
      const results = await Promise.allSettled(gates.map((g) => g.beforeCall({ at: t })));

      for (const r of results) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(BreakerTrippedError);
      expect(notifier.messages).toHaveLength(1);
      expect(notifier.messages[0].subject).toBe("FieldCite: circuit breaker free_daily tripped");
      expect(notifier.messages[0].text).toContain("Spend: $10.00 (limit $10.00)");
      await expect(gates[0].beforeCall({ at: t })).rejects.toBeInstanceOf(BreakerTrippedError);
      expect(notifier.messages).toHaveLength(1);
    });

    it("stops the scan if the gate can't check (fails closed) and honours the kill switch", async () => {
      const t = uniqueMonth();
      const scan = await startScan("paid", t);
      await expect(new PgCallGate(pool, scan, new Collect(), { env: { SCANS_ENABLED: "false" } }).beforeCall({ at: t })).rejects.toThrow(/SCANS_ENABLED=false/);
      await expect(new PgCallGate(pool, "00000000-0000-0000-0000-000000000000", new Collect(), { env: {} }).beforeCall({ at: t })).rejects.toThrow(/not found/);
    });

    it("shows breaker state in the breaker_status view, service role only", async () => {
      const states = await breakerStatus(pool);
      expect(states.map((s) => s.breaker)).toEqual(["baseline_monthly", "free_daily", "total_daily"]);
      for (const s of states) expect(s.tripped).toBe(s.trippedAt !== null);
      expect(states.find((s) => s.breaker === "free_daily")!.limitUsd).toBe(10);
      expect(states.find((s) => s.breaker === "total_daily")!.limitUsd).toBe(30);

      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("set local role authenticated");
        await expect(c.query("select * from public.breaker_status")).rejects.toMatchObject({ code: "42501" });
      } finally {
        await c.query("rollback");
        c.release();
      }
    });

    it("refuses limits above the spec values", async () => {
      await expect(pool.query("update public.cost_settings set total_daily_limit_usd = 31")).rejects.toMatchObject({ code: "23514" });
      await expect(pool.query("update public.cost_settings set free_daily_limit_usd = 10.01")).rejects.toMatchObject({ code: "23514" });
      await expect(pool.query("update public.cost_settings set baseline_monthly_overrun_usd = 61")).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("CS-10 answer cache", () => {
    const category = loadCategory("pest-control");
    const adapters = () => createAdapters(["openai"], { dryRun: true, env: {} });

    async function scanOnce(question: string, at: Date, opts: { country?: Country; runs?: number } = {}) {
      const base = planScan({ category, country: opts.country ?? "US", questions: 1, runs: opts.runs ?? 1, engines: ["openai"] });
      const plan = { ...base, questions: [question] };
      const scanId = await startScan("paid", at);
      const result = await runScan(plan, adapters(), new AliasBrandExtractor(), {
        dryRun: true,
        env: {},
        now: () => at,
        storage: new PgScanStorage(pool, scanId, { brands: category.brands }),
        cache: new PgAnswerCache(pool),
      });
      return { scanId, result };
    }

    async function history(scanId: string) {
      const { rows } = await pool.query<{ cache_hit: boolean; cost_usd: string; answer_id: string; text: string; cached_from_answer_id: string | null; citations: number; mentions: number }>(
        `select ec.cache_hit, ec.cost_usd, an.id as answer_id, an.text, an.cached_from_answer_id,
                (select count(*)::int from public.citations ci where ci.answer_id = an.id) as citations,
                (select count(*)::int from public.brand_mentions bm where bm.answer_id = an.id) as mentions
           from public.engine_calls ec join public.answers an on an.engine_call_id = ec.id
          where ec.scan_id = $1 order by ec.run`,
        [scanId],
      );
      return rows;
    }

    it("reuses an answer across accounts for 72 h at $0 and still stores history (M-1)", async () => {
      const t = uniqueMonth();
      const q = `Best pest control software? ${Math.random()}`;
      const first = await scanOnce(q, t);
      expect(first.result.calls[0]).toMatchObject({ status: "ok", cacheHit: undefined });
      const [original] = await history(first.scanId);
      expect(original.cache_hit).toBe(false);
      expect(Number(original.cost_usd)).toBeGreaterThan(0);
      expect(original.citations).toBeGreaterThan(0);

      // Another account, a differently written question, 71 h 59 m later: a hit.
      const hit = await scanOnce(`  ${q.replace("Best", "BEST")}  `, new Date(t.getTime() + 72 * HOUR - 60_000));
      expect(hit.result.calls[0]).toMatchObject({ status: "ok", cacheHit: true, costUsd: 0, cachedAnswerId: original.answer_id });
      const [copy] = await history(hit.scanId);
      expect(copy).toMatchObject({ cache_hit: true, cached_from_answer_id: original.answer_id, text: original.text, citations: original.citations, mentions: original.mentions });
      expect(Number(copy.cost_usd)).toBe(0);
      expect(copy.answer_id).not.toBe(original.answer_id);
      // A hit costs nothing, so it adds no spend.
      expect(await spendRow(t, "openai", "paid")).toBe(Number(original.cost_usd));
      expect(await spendRow(new Date(t.getTime() + 72 * HOUR - 60_000), "openai", "paid")).toBe(0);

      // At 72 h it has expired: a fresh call, which becomes the new cache entry.
      const expired = await scanOnce(q, new Date(t.getTime() + 72 * HOUR));
      expect(expired.result.calls[0].cacheHit).toBeUndefined();
      expect(expired.result.calls[0].costUsd).toBeGreaterThan(0);
    });

    it("never reuses an answer from another country or another run", async () => {
      const t = uniqueMonth();
      const q = `Jobber alternatives for a cleaning business ${Math.random()}`;
      await scanOnce(q, t, { country: "US" });

      const uk = await scanOnce(q, new Date(t.getTime() + HOUR), { country: "UK" });
      expect(uk.result.calls[0].cacheHit).toBeUndefined();

      // Run 1 hits the US answer; run 2 is a second real answer (SPEC §8).
      const twoRuns = await scanOnce(q, new Date(t.getTime() + 2 * HOUR), { country: "US", runs: 2 });
      expect(twoRuns.result.calls.map((c) => c.cacheHit ?? false)).toEqual([true, false]);
    });
  });

  describe("CS-9 daily spend summary", () => {
    it("loads spend by engine, scan type and account for one UTC day", async () => {
      const t = plusDays(uniqueMonth(), 10);
      const big = await startScan("paid", t);
      const small = await startScan("free", t);
      const baseline = await startScan("baseline", t);
      await spend(big, 2, t);
      await spend(big, 1, t, "gemini");
      await spend(small, 0.5, t, "perplexity");
      await spend(baseline, 0.75, t);
      await spend(big, 4, plusDays(t, -1)); // yesterday: month to date only
      await spend(big, 9, plusDays(t, 1)); // tomorrow: not counted

      const data = await loadDailySpend(pool, isoDay(t));
      expect(data.totalUsd).toBe(4.25);
      expect(data.calls).toBe(4);
      expect(data.byEngine).toEqual([
        { engine: "openai", usd: 2.75 },
        { engine: "gemini", usd: 1 },
        { engine: "perplexity", usd: 0.5 },
      ]);
      expect(data.byScope).toEqual([
        { scope: "paid", usd: 3 },
        { scope: "baseline", usd: 0.75 },
        { scope: "free", usd: 0.5 },
      ]);
      expect(data.byAccount.map((a) => [a.email?.split("-")[0] ?? null, a.usd, a.calls])).toEqual([
        ["paid", 3, 2],
        [null, 0.75, 1],
        ["free", 0.5, 1],
      ]);
      expect(data.monthToDateUsd).toBe(8.25);
      expect(data.monthlyForecastUsd).toBeGreaterThan(0);
      expect(data.trips).toEqual([]);
    });
  });
});
