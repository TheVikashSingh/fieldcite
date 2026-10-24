// Builds engine adapters. Dry runs use the real adapters with a fixture-backed fetch, so
// parsing and cost math are exercised end to end without any network call.

import { readFileSync } from "node:fs";
import type { AdapterDeps } from "./base";
import type { Env } from "./guard";
import { createGeminiAdapter } from "./gemini";
import type { FetchFn } from "./http";
import { createOpenAIAdapter } from "./openai";
import { createPerplexityAdapter } from "./perplexity";
import type { EngineAdapter, EngineId } from "./types";

const KEY_ENV: Record<EngineId, string> = {
  openai: "OPENAI_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const FACTORIES: Record<EngineId, (deps: AdapterDeps) => EngineAdapter> = {
  openai: createOpenAIAdapter,
  perplexity: createPerplexityAdapter,
  gemini: createGeminiAdapter,
};

export function loadFixtureResponses(engine: EngineId): unknown[] {
  const file = new URL(`../../fixtures/engines/${engine}.json`, import.meta.url);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { responses?: unknown[] };
  if (!parsed.responses?.length) throw new Error(`No fixture responses for ${engine}`);
  return parsed.responses;
}

/** A fetch that never touches the network: it cycles through canned provider responses. */
export function fixtureFetch(responses: unknown[]): FetchFn {
  let i = 0;
  return async () => {
    const body = responses[i++ % responses.length];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
}

export interface CreateAdaptersOptions {
  dryRun: boolean;
  env?: Env;
  /** Dry runs only: canned responses per engine instead of reading fixtures/engines/*.json (bundled code can't read them). */
  fixtures?: Partial<Record<EngineId, unknown[]>>;
}

export function createAdapters(engines: EngineId[], { dryRun, env = process.env, fixtures }: CreateAdaptersOptions): EngineAdapter[] {
  return engines.map((id) =>
    dryRun
      ? FACTORIES[id]({ apiKey: "dry-run", fetch: fixtureFetch(fixtures?.[id] ?? loadFixtureResponses(id)), sleep: async () => {}, env })
      : FACTORIES[id]({ apiKey: env[KEY_ENV[id]] ?? "", env }),
  );
}
