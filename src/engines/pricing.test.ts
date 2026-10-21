import { describe, expect, it } from "vitest";
import { costUsd, DEFAULT_MODELS, getPrice, maxCostUsd, PRICES_CHECKED_ON, PRICING, UnknownModelPriceError } from "./pricing";

describe("pricing table (CS-9)", () => {
  it("records when prices were checked", () => {
    expect(PRICES_CHECKED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has a price for every default model", () => {
    for (const model of Object.values(DEFAULT_MODELS)) expect(() => getPrice(model)).not.toThrow();
  });

  it("matches the official list prices checked on 2026-10-21", () => {
    expect(PRICING["gpt-5-mini"]).toMatchObject({ inputPerMTok: 0.25, outputPerMTok: 2.0, perSearchCall: 0.01 });
    expect(PRICING["gpt-5-nano"]).toMatchObject({ inputPerMTok: 0.05, outputPerMTok: 0.4, perSearchCall: 0.01 });
    expect(PRICING.sonar).toMatchObject({ inputPerMTok: 0.25, outputPerMTok: 2.5 });
    expect(PRICING["gemini-2.5-flash"]).toMatchObject({ inputPerMTok: 0.3, outputPerMTok: 2.5, perSearchCall: 0.035 });
    expect(PRICING["gemini-2.5-flash-lite"]).toMatchObject({ inputPerMTok: 0.1, outputPerMTok: 0.4, perSearchCall: 0.035 });
  });

  it("computes OpenAI cost from tokens plus web search calls", () => {
    // 10,000 in × $0.25/M + 1,000 out × $2/M + 2 searches × $0.01
    expect(costUsd("gpt-5-mini", { inputTokens: 10_000, outputTokens: 1_000, searchCalls: 2 })).toBeCloseTo(0.0025 + 0.002 + 0.02, 6);
  });

  it("adds the Perplexity per-request fee even with zero tokens", () => {
    expect(costUsd("sonar", { inputTokens: 0, outputTokens: 0, searchCalls: 1 })).toBeCloseTo(0.005, 6);
    expect(costUsd("sonar", { inputTokens: 1_000_000, outputTokens: 1_000_000, searchCalls: 1 })).toBeCloseTo(0.25 + 2.5 + 0.005, 6);
  });

  it("charges Gemini per grounded prompt", () => {
    expect(costUsd("gemini-2.5-flash", { inputTokens: 0, outputTokens: 0, searchCalls: 1 })).toBeCloseTo(0.035, 6);
    expect(costUsd("gemini-2.5-flash", { inputTokens: 0, outputTokens: 0, searchCalls: 0 })).toBe(0);
  });

  it("rounds to a millionth of a dollar", () => {
    const c = costUsd("gpt-5-nano", { inputTokens: 1, outputTokens: 1, searchCalls: 0 });
    expect(c).toBe(Math.round(c * 1e6) / 1e6);
  });

  it("refuses to price an unknown model", () => {
    expect(() => costUsd("gpt-9-ultra", { inputTokens: 1, outputTokens: 1, searchCalls: 0 })).toThrow(UnknownModelPriceError);
  });

  it("worst-case cost is never below a realistic call", () => {
    const real = costUsd("gpt-5-mini", { inputTokens: 8_000, outputTokens: 600, searchCalls: 1 });
    expect(maxCostUsd("gpt-5-mini", 1_200)).toBeGreaterThan(real);
  });
});
