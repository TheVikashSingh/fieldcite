// Runs a planned scan sequentially through the engine adapters. One call at a time keeps spend
// predictable; the 150-call cap is checked again here so no caller can skip planScan (CS-5).
// Before every call the kill switch (CS-8) and the gate (the CS-7 breakers) are checked, then
// the answer cache (CS-10). With a storage, every call's cost is written as it happens (CS-9);
// without one (the CLI), nothing touches a database.

import { assertScanCallBudget, assertScansEnabled, ScansDisabledError, type Env } from "../engines/guard";
import type { Citation, Country, EngineAdapter, EngineId, Usage } from "../engines/types";
import type { BrandExtractor, BrandMention } from "../extract/brands";
import { classifyCitation, type ClassifiedCitation } from "../extract/classify";
import type { ScanPlan } from "./plan";

export interface CallRecord {
  engine: EngineId;
  /** The model that answered (a cache hit reports the cached answer's model). */
  model: string;
  /** The model the adapter asks for: part of the cache key (CS-10). */
  adapterModel?: string;
  country?: Country;
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
  /** When the call was made (ISO). Storage records it as the call's time. */
  at?: string;
  /** CS-10: the answer came from the cache. It cost $0 and made no engine call. */
  cacheHit?: boolean;
  cachedAnswerId?: string;
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

/** Runs before every call and throws to stop the scan. The Postgres version checks the CS-7 breakers. */
export interface CallGate {
  beforeCall(call: { engine: EngineId; question: string; run: number; at: Date }): Promise<void>;
}

/**
 * CS-10 cache key. The run number is part of it so a paid scan's two runs per engine stay two
 * real answers (SPEC §8); run 1 of one account's scan reuses run 1 of another's.
 */
export interface CacheKey {
  engine: EngineId;
  model: string;
  question: string;
  country: Country;
  run: number;
}

export interface CachedAnswer {
  answerId: string;
  text: string;
  model: string;
  citations: Citation[];
}

export interface AnswerCache {
  get(key: CacheKey, at: Date): Promise<CachedAnswer | null>;
}

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, searchCalls: 0 };

export async function runScan(
  plan: ScanPlan,
  adapters: EngineAdapter[],
  extractor: BrandExtractor,
  opts: {
    dryRun: boolean;
    now?: () => Date;
    log?: (line: string) => void;
    storage?: ScanStorage;
    gate?: CallGate;
    cache?: AnswerCache;
    /** Read before every call for the kill switch (CS-8). Defaults to process.env. */
    env?: Env;
  },
): Promise<ScanResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const env = opts.env ?? process.env;
  const byId = new Map(adapters.map((a) => [a.id, a]));
  const total = plan.questions.length * plan.runs * plan.engines.length;
  assertScanCallBudget(total);

  const startedAt = now().toISOString();
  const calls: CallRecord[] = [];
  let stoppedReason: string | undefined;

  async function record(call: CallRecord): Promise<void> {
    calls.push(call);
    if (!opts.storage) return;
    try {
      await opts.storage.recordCall(call);
    } catch (err) {
      // A call whose cost can't be logged, or that is past the reservation, stops the scan
      // (CS-4, CS-9). The call already made stays in the result.
      stoppedReason = `Could not record call: ${err instanceof Error ? err.message : String(err)}`;
      log(`  ${stoppedReason}`);
    }
  }

  for (let run = 1; run <= plan.runs; run++) {
    for (const [questionIndex, question] of plan.questions.entries()) {
      for (const engine of plan.engines) {
        const adapter = byId.get(engine);
        const base = { engine, model: adapter?.model ?? "", adapterModel: adapter?.model, country: plan.country, questionIndex, question, run };
        const skip = (error: string) =>
          calls.push({ ...base, status: "skipped", error, text: "", citations: [], mentions: [], usage: ZERO_USAGE, costUsd: 0, attempts: 0, latencyMs: 0 });
        if (stoppedReason || !adapter) {
          skip(stoppedReason ?? `No adapter for ${engine}`);
          continue;
        }

        const at = now();
        // CS-8, then CS-7. Any failure here stops the scan: if the breakers can't be checked,
        // no call is made.
        try {
          assertScansEnabled(env);
          await opts.gate?.beforeCall({ engine, question, run, at });
        } catch (err) {
          stoppedReason = err instanceof Error ? err.message : String(err);
          log(`  stopped: ${stoppedReason}`);
          skip(stoppedReason);
          continue;
        }

        const started = Date.now();
        try {
          const cached = await opts.cache?.get({ engine, model: adapter.model, question, country: plan.country, run }, at);
          if (cached) {
            const mentions = await extractor.extract(cached.text, plan.category.brands);
            log(`  ${engine} q${questionIndex + 1} run ${run}: cache hit, ${mentions.length} brands, $0`);
            await record({
              ...base,
              model: cached.model,
              status: "ok",
              text: cached.text,
              citations: cached.citations.map((c) => classifyCitation(c, plan.category.brands)),
              mentions,
              usage: ZERO_USAGE,
              costUsd: 0,
              attempts: 0,
              latencyMs: Date.now() - started,
              at: at.toISOString(),
              cacheHit: true,
              cachedAnswerId: cached.answerId,
            });
            continue;
          }

          const answer = await adapter.ask(question, { maxOutputTokens: plan.maxOutputTokens, timeoutMs: plan.timeoutMs, country: plan.country });
          const mentions = await extractor.extract(answer.text, plan.category.brands);
          log(`  ${engine} q${questionIndex + 1} run ${run}: ${mentions.length} brands, ${answer.citations.length} citations, $${answer.costUsd.toFixed(4)}`);
          await record({
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
            at: at.toISOString(),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // CS-8: the kill switch stops the whole scan, not just one call.
          if (err instanceof ScansDisabledError) stoppedReason = message;
          log(`  ${engine} q${questionIndex + 1} run ${run}: ERROR ${message}`);
          await record({ ...base, status: "error", error: message, text: "", citations: [], mentions: [], usage: ZERO_USAGE, costUsd: 0, attempts: 0, latencyMs: Date.now() - started, at: at.toISOString() });
        }
      }
    }
  }

  const totalCostUsd = Math.round(calls.reduce((s, c) => s + c.costUsd, 0) * 1_000_000) / 1_000_000;
  return { plan, dryRun: opts.dryRun, startedAt, finishedAt: now().toISOString(), stoppedReason, calls, totalCostUsd };
}
