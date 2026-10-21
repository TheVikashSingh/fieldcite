// Pricing table in code (CS-9). Every call's cost is computed from here.
//
// Sources, checked 2026-10-21 (re-check before 2027-01-01, when Gemini Flash prices change):
// - OpenAI: https://developers.openai.com/api/docs/pricing
//   Web search tool: $10.00 per 1k calls; for reasoning models (gpt-5 family) the search
//   content tokens are billed at the model's normal input rate and already appear in usage.
// - Perplexity: https://docs.perplexity.ai/getting-started/models (sonar: $0.25 in / $2.50 out per 1M).
//   The page states no per-request search fee. Until a real run is reconciled against the
//   dashboard we add a conservative $5 per 1k requests so logged cost errs high, never low.
// - Gemini: https://ai.google.dev/gemini-api/docs/pricing
//   2.5 Flash / Flash-Lite grounding: $35 per 1k grounded prompts after 1,500 free per day
//   (500/day on the free tier). We log the paid list price so cost errs high; on the
//   no-billing free tier (CS-2) the real charge is $0.

import type { EngineId, Usage } from "./types";

export const PRICES_CHECKED_ON = "2026-10-21";

export interface ModelPrice {
  engine: EngineId;
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens (including reasoning / thinking tokens). */
  outputPerMTok: number;
  /** USD per search call or grounded prompt. */
  perSearchCall: number;
  /** USD per request regardless of searches. */
  perRequest: number;
}

export const PRICING: Record<string, ModelPrice> = {
  "gpt-5-mini": { engine: "openai", inputPerMTok: 0.25, outputPerMTok: 2.0, perSearchCall: 0.01, perRequest: 0 },
  "gpt-5-nano": { engine: "openai", inputPerMTok: 0.05, outputPerMTok: 0.4, perSearchCall: 0.01, perRequest: 0 },
  sonar: { engine: "perplexity", inputPerMTok: 0.25, outputPerMTok: 2.5, perSearchCall: 0, perRequest: 0.005 },
  "gemini-2.5-flash": { engine: "gemini", inputPerMTok: 0.3, outputPerMTok: 2.5, perSearchCall: 0.035, perRequest: 0 },
  "gemini-2.5-flash-lite": { engine: "gemini", inputPerMTok: 0.1, outputPerMTok: 0.4, perSearchCall: 0.035, perRequest: 0 },
};

/** Default model per engine (SPEC §6: mini/nano-class models only). */
export const DEFAULT_MODELS: Record<EngineId, string> = {
  openai: "gpt-5-mini",
  perplexity: "sonar",
  gemini: "gemini-2.5-flash",
};

export class UnknownModelPriceError extends Error {
  constructor(model: string) {
    super(`No price for model "${model}". Add it to src/engines/pricing.ts before calling it (CS-9).`);
    this.name = "UnknownModelPriceError";
  }
}

export function getPrice(model: string): ModelPrice {
  const price = PRICING[model];
  if (!price) throw new UnknownModelPriceError(model);
  return price;
}

/** Cost of one call in USD, rounded to 1/1,000,000 of a dollar. */
export function costUsd(model: string, usage: Usage): number {
  const p = getPrice(model);
  const usd =
    (usage.inputTokens * p.inputPerMTok) / 1_000_000 +
    (usage.outputTokens * p.outputPerMTok) / 1_000_000 +
    usage.searchCalls * p.perSearchCall +
    p.perRequest;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * Worst-case cost of one call, used to estimate a scan before it runs.
 * Assumes the given input tokens, the full output cap and the given number of searches.
 */
export function maxCostUsd(model: string, maxOutputTokens: number, assumedInputTokens = 10_000, assumedSearches = 2): number {
  return costUsd(model, { inputTokens: assumedInputTokens, outputTokens: maxOutputTokens, searchCalls: assumedSearches });
}
