import { describe, expect, it } from "vitest";
import { assertScanCallBudget, CallLimitError, MAX_CALLS_PER_SCAN } from "../engines/guard";
import { estimateMaxCostUsd, loadCategory, parseCountry, parseEngines, PlanError, planScan, type Category } from "./plan";

const category: Category = {
  slug: "test",
  name: "Test",
  trade: "test",
  brands: [{ name: "Jobber" }],
  questions: Array.from({ length: 60 }, (_, i) => `question ${i + 1}`),
};

describe("150-call cap (CS-5)", () => {
  it("is 150", () => {
    expect(MAX_CALLS_PER_SCAN).toBe(150);
  });

  it("allows exactly 150 calls", () => {
    const plan = planScan({ category, country: "US", questions: 50, runs: 1, engines: ["openai", "perplexity", "gemini"] });
    expect(plan.totalCalls).toBe(150);
  });

  it("refuses 151+ calls", () => {
    expect(() => planScan({ category, country: "US", questions: 51, runs: 1, engines: ["openai", "perplexity", "gemini"] })).toThrow(CallLimitError);
    expect(() => planScan({ category, country: "US", questions: 26, runs: 2, engines: ["openai", "perplexity", "gemini"] })).toThrow(/limit is 150/);
    expect(() => assertScanCallBudget(151)).toThrow(CallLimitError);
  });

  it("refuses zero or fractional counts", () => {
    expect(() => planScan({ category, country: "US", questions: 0, runs: 1, engines: ["openai"] })).toThrow(PlanError);
    expect(() => planScan({ category, country: "US", questions: 1.5, runs: 1, engines: ["openai"] })).toThrow(PlanError);
    expect(() => planScan({ category, country: "US", questions: 1, runs: Number.NaN, engines: ["openai"] })).toThrow(PlanError);
  });

  it("refuses more questions than the category has", () => {
    expect(() => planScan({ category, country: "US", questions: 61, runs: 1, engines: ["openai"] })).toThrow(/has 60 questions/);
  });

  it("pins answer calls to 1,200 output tokens and 60 s", () => {
    const plan = planScan({ category, country: "UK", questions: 1, runs: 1, engines: ["gemini"] });
    expect(plan).toMatchObject({ maxOutputTokens: 1_200, timeoutMs: 60_000, country: "UK" });
  });
});

describe("argument parsing", () => {
  it("accepts only the four markets", () => {
    expect(parseCountry("uk")).toBe("UK");
    expect(() => parseCountry("IN")).toThrow(PlanError);
  });

  it("accepts only known engines and drops duplicates", () => {
    expect(parseEngines("openai, gemini,openai")).toEqual(["openai", "gemini"]);
    expect(() => parseEngines("openai,claude")).toThrow(PlanError);
    expect(() => parseEngines("")).toThrow(PlanError);
  });

  it("loads committed categories and rejects path tricks", () => {
    expect(loadCategory("pest-control").questions.length).toBeGreaterThanOrEqual(10);
    expect(() => loadCategory("../package")).toThrow(PlanError);
    expect(() => loadCategory("no-such-category")).toThrow(/Unknown category/);
  });

  it("estimates a positive worst-case cost", () => {
    const plan = planScan({ category, country: "US", questions: 5, runs: 1, engines: ["openai", "perplexity", "gemini"] });
    expect(estimateMaxCostUsd(plan)).toBeGreaterThan(0);
  });
});
