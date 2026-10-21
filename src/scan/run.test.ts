import { describe, expect, it } from "vitest";
import { createAdapters } from "../engines";
import { AliasBrandExtractor } from "../extract/brands";
import { loadCategory, planScan } from "./plan";
import { runScan, type CallRecord, type ScanStorage } from "./run";

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
