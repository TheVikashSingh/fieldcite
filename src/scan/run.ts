// Runs a planned scan sequentially through the engine adapters. One call at a time keeps spend
// predictable; the 150-call cap is checked again here so no caller can skip planScan (CS-5).
// With a storage, every call's cost is written as it happens (CS-9); without one (the CLI),
// nothing touches a database.

import { assertScanCallBudget, ScansDisabledError } from "../engines/guard";
import type { EngineAdapter, EngineId, Usage } from "../engines/types";
import type { BrandExtractor, BrandMention } from "../extract/brands";
import { classifyCitation, type ClassifiedCitation } from "../extract/classify";
import type { ScanPlan } from "./plan";

export interface CallRecord {
  engine: EngineId;
  model: string;
  questionIndex: number;
  question: string;
  run: number;
  status: "ok" | "error" | "skipped";
  error?: string;
  text: string;
  citations: ClassifiedCitation[];
  mentions: BrandMention[];
  usage: Usage;
  costUsd: number;
  attempts: number;
  latencyMs: number;
  raw?: unknown;
}

export interface ScanResult {
  plan: ScanPlan;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  stoppedReason?: string;
  calls: CallRecord[];
  totalCostUsd: number;
}

/**
 * Optional persistence for engine calls. The Postgres version (src/ledger/scan-storage.ts)
 * charges each call to the scan's credit reservation (CS-4) and refuses calls past it.
 */
export interface ScanStorage {
  recordCall(record: CallRecord): Promise<void>;
}

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, searchCalls: 0 };

export async function runScan(
  plan: ScanPlan,
  adapters: EngineAdapter[],
  extractor: BrandExtractor,
  opts: { dryRun: boolean; now?: () => Date; log?: (line: string) => void; storage?: ScanStorage },
): Promise<ScanResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const byId = new Map(adapters.map((a) => [a.id, a]));
  const total = plan.questions.length * plan.runs * plan.engines.length;
  assertScanCallBudget(total);

  const startedAt = now().toISOString();
  const calls: CallRecord[] = [];
  let stoppedReason: string | undefined;

  for (let run = 1; run <= plan.runs; run++) {
    for (const [questionIndex, question] of plan.questions.entries()) {
      for (const engine of plan.engines) {
        const adapter = byId.get(engine);
        const base = { engine, model: adapter?.model ?? "", questionIndex, question, run };
        if (stoppedReason || !adapter) {
          calls.push({ ...base, status: "skipped", error: stoppedReason ?? `No adapter for ${engine}`, text: "", citations: [], mentions: [], usage: ZERO_USAGE, costUsd: 0, attempts: 0, latencyMs: 0 });
          continue;
        }
        const started = Date.now();
        let record: CallRecord;
        try {
          const answer = await adapter.ask(question, { maxOutputTokens: plan.maxOutputTokens, timeoutMs: plan.timeoutMs, country: plan.country });
          const mentions = await extractor.extract(answer.text, plan.category.brands);
          record = {
            ...base,
            model: answer.model,
            status: "ok",
            text: answer.text,
            citations: answer.citations.map((c) => classifyCitation(c, plan.category.brands)),
            mentions,
            usage: answer.usage,
            costUsd: answer.costUsd,
            attempts: answer.attempts,
            latencyMs: Date.now() - started,
            raw: answer.raw,
          };
          log(`  ${engine} q${questionIndex + 1} run ${run}: ${mentions.length} brands, ${answer.citations.length} citations, $${answer.costUsd.toFixed(4)}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // CS-8: the kill switch stops the whole scan, not just one call.
          if (err instanceof ScansDisabledError) stoppedReason = message;
          record = { ...base, status: "error", error: message, text: "", citations: [], mentions: [], usage: ZERO_USAGE, costUsd: 0, attempts: 0, latencyMs: Date.now() - started };
          log(`  ${engine} q${questionIndex + 1} run ${run}: ERROR ${message}`);
        }
        calls.push(record);
        if (opts.storage) {
          try {
            await opts.storage.recordCall(record);
          } catch (err) {
            // A call whose cost can't be logged, or that is past the reservation, stops the scan
            // (CS-4, CS-9). The call already made stays in the result.
            stoppedReason = `Could not record call: ${err instanceof Error ? err.message : String(err)}`;
            log(`  ${stoppedReason}`);
          }
        }
      }
    }
  }

  const totalCostUsd = Math.round(calls.reduce((s, c) => s + c.costUsd, 0) * 1_000_000) / 1_000_000;
  return { plan, dryRun: opts.dryRun, startedAt, finishedAt: now().toISOString(), stoppedReason, calls, totalCostUsd };
}
