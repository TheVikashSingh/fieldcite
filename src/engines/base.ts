// Shared adapter plumbing: every engine call goes through guardedCall (CS-5, CS-6, CS-8).

import { assertCallLimits, assertScansEnabled, type Env } from "./guard";
import { realSleep, withRetry, type FetchFn, type SleepFn } from "./http";
import { COUNTRY_NAMES, type AskOptions, type Country } from "./types";

export interface AdapterDeps {
  /** Server-side only (CS-12). Never pass a key to client code. */
  apiKey: string;
  model?: string;
  fetch?: FetchFn;
  sleep?: SleepFn;
  env?: Env;
}

export class MissingApiKeyError extends Error {
  constructor(envName: string) {
    super(`${envName} is not set. Add it to .env (see .env.example), or use --dry-run.`);
    this.name = "MissingApiKeyError";
  }
}

export function requireKey(deps: AdapterDeps, envName: string): string {
  if (!deps.apiKey) throw new MissingApiKeyError(envName);
  return deps.apiKey;
}

/**
 * Validates limits, then runs one attempt plus at most 2 retries on retryable errors.
 * The kill switch is checked before every attempt, so a retry never fires after SCANS_ENABLED=false.
 */
export async function guardedCall<T>(
  deps: AdapterDeps,
  opts: AskOptions,
  attempt: () => Promise<T>,
): Promise<{ result: T; attempts: number }> {
  assertCallLimits(opts);
  const env = deps.env ?? process.env;
  return withRetry(async () => {
    assertScansEnabled(env);
    return attempt();
  }, deps.sleep ?? realSleep);
}

export function defaultFetch(deps: AdapterDeps): FetchFn {
  return deps.fetch ?? ((url, init) => fetch(url, init));
}

/** SPEC §8: engines without a location parameter get the country in the question itself. */
export function withCountry(question: string, country: Country): string {
  return `${question.trim()} (I'm based in ${COUNTRY_NAMES[country]}.)`;
}

// Small helpers for reading untyped provider JSON defensively.
export const asObj = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
export const asArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
export const asStr = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);
export const asNum = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** Drops duplicate URLs, keeping the first title seen. */
export function dedupeCitations(list: { url: string; title?: string }[]): { url: string; title?: string }[] {
  const seen = new Map<string, { url: string; title?: string }>();
  for (const c of list) if (c.url && !seen.has(c.url)) seen.set(c.url, c);
  return [...seen.values()];
}
