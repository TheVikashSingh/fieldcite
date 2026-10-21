import { describe, expect, it, vi } from "vitest";
import { MissingApiKeyError } from "./base";
import { CallLimitError, ScansDisabledError, type Env } from "./guard";
import { createGeminiAdapter, geminiUrl } from "./gemini";
import type { FetchFn } from "./http";
import { createAdapters, fixtureFetch, loadFixtureResponses } from "./index";
import { createOpenAIAdapter, OPENAI_URL } from "./openai";
import { costUsd } from "./pricing";
import { createPerplexityAdapter, PERPLEXITY_URL } from "./perplexity";
import type { AskOptions, EngineAdapter, EngineId } from "./types";

const OPTS: AskOptions = { maxOutputTokens: 1_200, timeoutMs: 60_000, country: "UK" };
const noSleep = async () => {};
const enabled = { SCANS_ENABLED: "true" };

/** A fetch that records requests and replays one engine's fixtures. */
function recordingFetch(engine: EngineId) {
  const replay = fixtureFetch(loadFixtureResponses(engine));
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fn = vi.fn<FetchFn>(async (url, init) => {
    requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return replay(url, init);
  });
  return { fn, requests };
}

const FACTORIES = {
  openai: createOpenAIAdapter,
  perplexity: createPerplexityAdapter,
  gemini: createGeminiAdapter,
} as const;

function adapterWith(engine: EngineId, fetch: FetchFn, env: Env = enabled): EngineAdapter {
  return FACTORIES[engine]({ apiKey: "test-key", fetch, sleep: noSleep, env });
}

describe("OpenAI adapter", () => {
  it("sends web_search with the pinned country, max output tokens and the key in a header", async () => {
    const { fn, requests } = recordingFetch("openai");
    await adapterWith("openai", fn).ask("best pest control software", OPTS);
    const req = requests[0];
    expect(req.url).toBe(OPENAI_URL);
    expect(req.headers.authorization).toBe("Bearer test-key");
    expect(req.body).toMatchObject({
      model: "gpt-5-mini",
      input: "best pest control software",
      max_output_tokens: 1_200,
      tools: [{ type: "web_search", user_location: { type: "approximate", country: "GB" } }],
    });
  });

  it("returns text, citations, usage and cost", async () => {
    const { fn } = recordingFetch("openai");
    const a = await adapterWith("openai", fn).ask("q", OPTS);
    expect(a.text).toContain("GorillaDesk");
    expect(a.citations.map((c) => c.url)).toContain("https://www.g2.com/categories/pest-control");
    expect(a.usage).toEqual({ inputTokens: 8240, outputTokens: 610, searchCalls: 1 });
    expect(a.costUsd).toBe(costUsd("gpt-5-mini", a.usage));
    expect(a.attempts).toBe(1);
    expect(a.raw).toBeTruthy();
  });
});

describe("Perplexity adapter", () => {
  it("puts the country in the question and in user_location, with max_tokens set", async () => {
    const { fn, requests } = recordingFetch("perplexity");
    await adapterWith("perplexity", fn).ask("best pest control software", OPTS);
    const body = requests[0].body as { messages: { content: string }[]; max_tokens: number; web_search_options: unknown };
    expect(requests[0].url).toBe(PERPLEXITY_URL);
    expect(body.messages[0].content).toContain("the United Kingdom");
    expect(body.max_tokens).toBe(1_200);
    expect(body.web_search_options).toEqual({ user_location: { country: "GB" } });
  });

  it("reads search_results and the older citations list", async () => {
    const { fn } = recordingFetch("perplexity");
    const adapter = adapterWith("perplexity", fn);
    const first = await adapter.ask("q", OPTS);
    expect(first.citations[0]).toEqual({ url: "https://www.softwareadvice.com/pest-control/", title: "Best Pest Control Software for 2026" });
    const second = await adapter.ask("q", OPTS);
    expect(second.citations.map((c) => c.url)).toContain("https://www.briostack.com/");
    expect(second.costUsd).toBe(costUsd("sonar", second.usage));
  });
});

describe("Gemini adapter", () => {
  it("enables Google Search grounding, sets maxOutputTokens and turns off thinking", async () => {
    const { fn, requests } = recordingFetch("gemini");
    await adapterWith("gemini", fn).ask("best pest control software", { ...OPTS, country: "AU" });
    const req = requests[0];
    expect(req.url).toBe(geminiUrl("gemini-2.5-flash"));
    expect(req.headers["x-goog-api-key"]).toBe("test-key");
    expect(req.url).not.toContain("test-key");
    expect(req.body).toMatchObject({
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 1_200, thinkingConfig: { thinkingBudget: 0 } },
    });
    expect(JSON.stringify(req.body)).toContain("Australia");
  });

  it("returns grounding chunks as citations and bills one grounded prompt", async () => {
    const { fn } = recordingFetch("gemini");
    const a = await adapterWith("gemini", fn).ask("q", OPTS);
    expect(a.citations).toHaveLength(3);
    expect(a.citations[0].title).toBe("capterra.com");
    expect(a.usage.searchCalls).toBe(1);
    expect(a.costUsd).toBe(costUsd("gemini-2.5-flash", a.usage));
  });
});

describe.each(["openai", "perplexity", "gemini"] as const)("%s adapter safety", (engine) => {
  it("refuses maxOutputTokens above 1,200 (CS-6) without calling the API", async () => {
    const { fn } = recordingFetch(engine);
    await expect(adapterWith(engine, fn).ask("q", { ...OPTS, maxOutputTokens: 1_201 })).rejects.toBeInstanceOf(CallLimitError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("refuses a timeout above 60 s (CS-5) without calling the API", async () => {
    const { fn } = recordingFetch(engine);
    await expect(adapterWith(engine, fn).ask("q", { ...OPTS, timeoutMs: 60_001 })).rejects.toBeInstanceOf(CallLimitError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("makes no call when SCANS_ENABLED=false (CS-8)", async () => {
    const { fn } = recordingFetch(engine);
    await expect(adapterWith(engine, fn, { SCANS_ENABLED: "false" }).ask("q", OPTS)).rejects.toBeInstanceOf(ScansDisabledError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("stops retrying once the kill switch flips mid-call (CS-8)", async () => {
    const env: Env = { SCANS_ENABLED: "true" };
    const fn = vi.fn<FetchFn>(async () => {
      env.SCANS_ENABLED = "false";
      return new Response("busy", { status: 503 });
    });
    await expect(adapterWith(engine, fn, env).ask("q", OPTS)).rejects.toBeInstanceOf(ScansDisabledError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("makes at most 3 attempts on repeated 5xx errors (CS-5)", async () => {
    const fn = vi.fn<FetchFn>(async () => new Response("down", { status: 500 }));
    await expect(adapterWith(engine, fn).ask("q", OPTS)).rejects.toMatchObject({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("times out a hanging call (CS-5)", async () => {
    const fn = vi.fn<FetchFn>(
      (_url, init) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    await expect(adapterWith(engine, fn).ask("q", { ...OPTS, timeoutMs: 25 })).rejects.toThrow("timed out");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("requires an API key for real runs", () => {
    expect(() => createAdapters([engine], { dryRun: false, env: {} })).toThrow(MissingApiKeyError);
  });

  it("refuses a model with no price (CS-9)", () => {
    expect(() => FACTORIES[engine]({ apiKey: "k", model: "unpriced-model" })).toThrow(/No price/);
  });
});
