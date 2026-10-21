// Engine adapter contract (SPEC §6.1).

export type EngineId = "openai" | "perplexity" | "gemini";
export const ENGINE_IDS: readonly EngineId[] = ["openai", "perplexity", "gemini"];

/** Buyer markets we scan (SPEC §2.1). Location is pinned on every call (SPEC §8). */
export type Country = "US" | "UK" | "CA" | "AU";
export const COUNTRIES: readonly Country[] = ["US", "UK", "CA", "AU"];

export const COUNTRY_NAMES: Record<Country, string> = {
  US: "the United States",
  UK: "the United Kingdom",
  CA: "Canada",
  AU: "Australia",
};

/** ISO 3166-1 alpha-2 codes for engine location parameters ("UK" is "GB"). */
export const COUNTRY_ISO: Record<Country, string> = { US: "US", UK: "GB", CA: "CA", AU: "AU" };

export interface AskOptions {
  /** CS-6: hard cap on output tokens. Answer calls may not exceed 1,200. */
  maxOutputTokens: number;
  /** CS-5: per-attempt timeout. May not exceed 60,000 ms. */
  timeoutMs: number;
  /** SPEC §8: the buyer's country, pinned on every call. */
  country: Country;
}

export interface Citation {
  url: string;
  title?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  searchCalls: number;
}

export interface EngineAnswer {
  text: string;
  citations: Citation[];
  usage: Usage;
  /** Computed from the pricing table in code (CS-9). */
  costUsd: number;
  model: string;
  /** Raw provider response, stored for history (M-1). */
  raw: unknown;
  /** Attempts made, including retries (max 3, CS-5). */
  attempts: number;
}

export interface EngineAdapter {
  id: EngineId;
  model: string;
  ask(question: string, opts: AskOptions): Promise<EngineAnswer>;
}
