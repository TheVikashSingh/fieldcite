// HTTP plumbing for engine calls: per-attempt timeout and a bounded retry policy (CS-5).

import { MAX_RETRIES } from "./guard";

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** HTTP statuses worth retrying: the request was not processed, so it is not billed. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class EngineHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Engine API returned HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "EngineHttpError";
  }
  get retryable(): boolean {
    return RETRYABLE_STATUS.has(this.status);
  }
}

export class EngineTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Engine call timed out after ${timeoutMs} ms (CS-5)`);
    this.name = "EngineTimeoutError";
  }
}

export class EngineNetworkError extends Error {
  constructor(cause: unknown) {
    super(`Network error calling engine API: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "EngineNetworkError";
  }
}

/**
 * Timeouts are NOT retried: the provider may still finish (and bill) the timed-out request,
 * so a retry could double the cost. Network errors before a response and the statuses above are.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof EngineHttpError) return err.retryable;
  return err instanceof EngineNetworkError;
}

/** One POST with a hard timeout. Returns the parsed JSON body. */
export async function postJson(
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw new EngineTimeoutError(timeoutMs);
      throw new EngineNetworkError(err);
    }
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      if (timedOut) throw new EngineTimeoutError(timeoutMs);
      throw err;
    }
    if (!res.ok) throw new EngineHttpError(res.status, text);
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/** Exponential backoff with jitter: about 1 s, then 2 s. */
export function backoffMs(retry: number, random: () => number = Math.random): number {
  const base = 1_000 * 2 ** (retry - 1);
  return Math.round(base * (0.75 + random() * 0.5));
}

/**
 * Runs `attempt` once, plus at most MAX_RETRIES retries on retryable errors only (CS-5).
 * Returns the result and the number of attempts made.
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  sleep: SleepFn = realSleep,
): Promise<{ result: T; attempts: number }> {
  for (let attempts = 1; ; attempts++) {
    try {
      return { result: await attempt(), attempts };
    } catch (err) {
      const retriesUsed = attempts - 1;
      if (!isRetryable(err) || retriesUsed >= MAX_RETRIES) throw err;
      await sleep(backoffMs(retriesUsed + 1));
    }
  }
}
