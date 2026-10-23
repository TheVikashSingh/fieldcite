// CS-8: SCANS_ENABLED=false stops new engine calls within 60 s, with no deploy, including for a
// scan that is already running. The real OpenAI adapter runs against a mocked fetch; the flag is
// flipped while a call is in flight.

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFixtureResponses } from "../engines";
import type { FetchFn } from "../engines/http";
import { createOpenAIAdapter } from "../engines/openai";
import { AliasBrandExtractor } from "../extract/brands";
import { loadCategory, planScan } from "./plan";
import { runScan } from "./run";

const plan = planScan({ category: loadCategory("pest-control"), country: "US", questions: 5, runs: 1, engines: ["openai"] });
const ok = () => new Response(JSON.stringify(loadFixtureResponses("openai")[0]), { status: 200 });

function scan(env: Record<string, string>, fetch: FetchFn) {
  const adapter = createOpenAIAdapter({ apiKey: "test", fetch, sleep: async () => {}, env });
  return runScan(plan, [adapter], new AliasBrandExtractor(), { dryRun: false, env });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CS-8 kill switch", () => {
  it("makes no call at all when scans are disabled", async () => {
    const fetch = vi.fn<FetchFn>(async () => ok());
    const result = await scan({ SCANS_ENABLED: "false" }, fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.calls.every((c) => c.status === "skipped")).toBe(true);
    expect(result.stoppedReason).toMatch(/SCANS_ENABLED=false/);
  });

  it("stops a running scan: the call in flight finishes and no new call starts", async () => {
    const env = { SCANS_ENABLED: "true" };
    const fetch = vi.fn<FetchFn>(async () => {
      if (fetch.mock.calls.length === 2) env.SCANS_ENABLED = "false"; // flipped during call 2
      return ok();
    });
    const result = await scan(env, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.calls.map((c) => c.status)).toEqual(["ok", "ok", "skipped", "skipped", "skipped"]);
    expect(result.stoppedReason).toMatch(/SCANS_ENABLED=false/);
  });

  it("never retries after the flip, even on a retryable error", async () => {
    const env = { SCANS_ENABLED: "true" };
    const fetch = vi.fn<FetchFn>(async () => {
      env.SCANS_ENABLED = "false";
      return new Response("overloaded", { status: 503 });
    });
    const result = await scan(env, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.calls[0]).toMatchObject({ status: "error", error: expect.stringMatching(/SCANS_ENABLED=false/) });
    expect(result.calls.slice(1).every((c) => c.status === "skipped")).toBe(true);
  });

  it("ends the scan within 60 s of the flip when the call in flight hangs", async () => {
    vi.useFakeTimers();
    const env = { SCANS_ENABLED: "true" };
    let flippedAt = 0;
    const fetch = vi.fn<FetchFn>((_url, init) => {
      if (fetch.mock.calls.length === 1) return Promise.resolve(ok());
      // Call 2 hangs until the 60 s timeout (CS-5) aborts it. The flag flips right as it starts.
      env.SCANS_ENABLED = "false";
      flippedAt = Date.now();
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    let done = false;
    const running = scan(env, fetch).finally(() => (done = true));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await running;

    expect(Date.now() - flippedAt).toBeLessThanOrEqual(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.calls.map((c) => c.status)).toEqual(["ok", "error", "skipped", "skipped", "skipped"]);
    expect(result.calls[1].error).toMatch(/timed out after 60000 ms/);
    expect(result.stoppedReason).toMatch(/SCANS_ENABLED=false/);
  });
});
