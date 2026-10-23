import { describe, expect, it } from "vitest";
import { createAdapters } from "../engines";
import { AliasBrandExtractor } from "../extract/brands";
import { loadCategory, planScan } from "./plan";
import { runScan, type AnswerCache, type CacheKey, type CallGate, type CallRecord, type ScanStorage } from "./run";

function setup() {
  const plan = planScan({ category: loadCategory("pest-control"), country: "US", questions: 2, runs: 1, engines: ["openai", "perplexity"] });
  const adapters = createAdapters(plan.engines, { dryRun: true, env: {} });
  return { plan, adapters, extractor: new AliasBrandExtractor() };
}

describe("runScan storage", () => {
  it("runs without a storage (the CLI path)", async () => {
    const { plan, adapters, extractor } = setup();
    const result = await runScan(plan, adapters, extractor, { dryRun: true });
    expect(result.calls.map((c) => c.status)).toEqual(["ok", "ok", "ok", "ok"]);
  });

  it("writes every call's cost record to the storage (CS-9)", async () => {
    const { plan, adapters, extractor } = setup();
    const saved: CallRecord[] = [];
    const storage: ScanStorage = { recordCall: async (r) => void saved.push(r) };
    const result = await runScan(plan, adapters, extractor, { dryRun: true, storage });
    expect(saved).toEqual(result.calls);
    expect(saved.every((c) => c.costUsd > 0)).toBe(true);
  });

  it("stops the scan when a call can't be recorded (CS-4)", async () => {
    const { plan, adapters, extractor } = setup();
    let n = 0;
    const storage: ScanStorage = {
      recordCall: async () => {
        if (++n === 2) throw new Error("scan has used all its reserved calls");
      },
    };
    const result = await runScan(plan, adapters, extractor, { dryRun: true, storage });
    expect(result.calls.map((c) => c.status)).toEqual(["ok", "ok", "skipped", "skipped"]);
    expect(result.stoppedReason).toMatch(/reserved calls/);
    expect(n).toBe(2);
  });
});

describe("runScan gate and cache", () => {
  it("checks the gate before every call and stops the scan when it throws (CS-7)", async () => {
    const { plan, adapters, extractor } = setup();
    const seen: string[] = [];
    const gate: CallGate = {
      beforeCall: async ({ engine, run }) => {
        seen.push(`${engine}:${run}`);
        if (seen.length === 3) throw new Error("Circuit breaker total_daily is tripped (CS-7).");
      },
    };
    const result = await runScan(plan, adapters, extractor, { dryRun: true, gate });
    expect(seen).toHaveLength(3);
    expect(result.calls.map((c) => c.status)).toEqual(["ok", "ok", "skipped", "skipped"]);
    expect(result.stoppedReason).toMatch(/total_daily/);
  });

  it("reuses a cached answer at $0 with no engine call (CS-10)", async () => {
    const { plan, adapters, extractor } = setup();
    const keys: CacheKey[] = [];
    const cache: AnswerCache = {
      get: async (key) => {
        keys.push(key);
        if (key.engine !== "openai") return null;
        return { answerId: "answer-1", text: "Try GorillaDesk or Jobber.", model: "gpt-cached", citations: [{ url: "https://www.g2.com/categories/pest-control" }] };
      },
    };
    const asked: string[] = [];
    const counted = adapters.map((a) => ({ ...a, ask: (q: string, o: Parameters<typeof a.ask>[1]) => (asked.push(a.id), a.ask(q, o)) }));
    const result = await runScan(plan, counted, extractor, { dryRun: true, cache });

    expect(keys[0]).toEqual({ engine: "openai", model: adapters[0].model, question: plan.questions[0], country: "US", run: 1 });
    expect(asked).toEqual(["perplexity", "perplexity"]);
    const hit = result.calls[0];
    expect(hit).toMatchObject({ status: "ok", cacheHit: true, cachedAnswerId: "answer-1", costUsd: 0, attempts: 0, model: "gpt-cached" });
    expect(hit.mentions.map((m) => m.brand)).toEqual(["GorillaDesk", "Jobber"]);
    expect(hit.citations[0]).toMatchObject({ domain: "g2.com" });
    expect(result.calls[1]).toMatchObject({ engine: "perplexity", status: "ok" });
    expect(result.calls[1].cacheHit).toBeUndefined();
    expect(result.calls[1].costUsd).toBeGreaterThan(0);
  });
});
