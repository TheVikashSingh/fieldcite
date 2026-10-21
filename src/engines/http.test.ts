import { describe, expect, it, vi } from "vitest";
import { MAX_RETRIES } from "./guard";
import { backoffMs, EngineHttpError, EngineNetworkError, EngineTimeoutError, isRetryable, postJson, withRetry, type FetchFn } from "./http";

const noSleep = vi.fn(async () => {});

describe("retry policy (CS-5)", () => {
  it("allows at most 2 retries", () => {
    expect(MAX_RETRIES).toBe(2);
  });

  it("stops after 3 attempts on a persistent retryable error", async () => {
    const attempt = vi.fn(async () => {
      throw new EngineHttpError(503, "unavailable");
    });
    const sleep = vi.fn(async () => {});
    await expect(withRetry(attempt, sleep)).rejects.toBeInstanceOf(EngineHttpError);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("never retries a non-retryable error", async () => {
    const attempt = vi.fn(async () => {
      throw new EngineHttpError(400, "bad request");
    });
    await expect(withRetry(attempt, noSleep)).rejects.toThrow("HTTP 400");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("never retries a timeout (the provider may still bill it)", async () => {
    const attempt = vi.fn(async () => {
      throw new EngineTimeoutError(60_000);
    });
    await expect(withRetry(attempt, noSleep)).rejects.toBeInstanceOf(EngineTimeoutError);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries 429 and succeeds on the next attempt", async () => {
    let n = 0;
    const attempt = vi.fn(async () => {
      if (n++ === 0) throw new EngineHttpError(429, "rate limited");
      return "ok";
    });
    await expect(withRetry(attempt, noSleep)).resolves.toEqual({ result: "ok", attempts: 2 });
  });

  it("classifies retryable errors", () => {
    for (const s of [429, 500, 502, 503, 504]) expect(isRetryable(new EngineHttpError(s, ""))).toBe(true);
    for (const s of [400, 401, 403, 404, 422]) expect(isRetryable(new EngineHttpError(s, ""))).toBe(false);
    expect(isRetryable(new EngineNetworkError(new Error("ECONNRESET")))).toBe(true);
    expect(isRetryable(new EngineTimeoutError(1))).toBe(false);
    expect(isRetryable(new Error("parse"))).toBe(false);
  });

  it("backs off exponentially", () => {
    expect(backoffMs(1, () => 0.5)).toBe(1_000);
    expect(backoffMs(2, () => 0.5)).toBe(2_000);
  });
});

describe("timeouts (CS-5)", () => {
  it("aborts a call that takes longer than the timeout", async () => {
    const hang: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const started = Date.now();
    await expect(postJson(hang, "https://example.test", {}, {}, 30)).rejects.toBeInstanceOf(EngineTimeoutError);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("turns a non-2xx response into an EngineHttpError", async () => {
    const fail: FetchFn = async () => new Response("nope", { status: 401 });
    await expect(postJson(fail, "https://example.test", {}, {}, 1_000)).rejects.toMatchObject({ status: 401 });
  });
});
