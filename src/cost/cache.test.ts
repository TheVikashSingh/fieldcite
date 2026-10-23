import { describe, expect, it } from "vitest";
import { cacheKeyHash, normalizeQuestion } from "./cache";

describe("CS-10: cache key normalization", () => {
  it("ignores case, spacing, Unicode form, curly quotes and trailing punctuation", () => {
    const base = normalizeQuestion("Best pest control software for a 3-person team's office");
    for (const q of [
      "best pest control software for a 3-person team's office?",
      "  BEST   pest control\tsoftware for a 3-person team’s office ?! ",
      "Best pest control software for a 3-person team's office.",
      "Ｂest pest control software for a 3-person team's office", // full-width B (NFKC)
    ]) {
      expect(normalizeQuestion(q)).toBe(base);
    }
    expect(base).toBe("best pest control software for a 3-person team's office");
  });

  it("keeps wording and inner punctuation", () => {
    expect(normalizeQuestion("Jobber vs. Housecall Pro?")).toBe("jobber vs. housecall pro");
    expect(normalizeQuestion("best HVAC app")).not.toBe(normalizeQuestion("best HVAC apps"));
  });

  it("puts country and run in the key, so answers never cross countries or runs", () => {
    const key = { question: "Best pest control software?", country: "US" as const, run: 1 };
    const hash = cacheKeyHash(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKeyHash({ ...key, question: "  best PEST control software " })).toBe(hash);
    expect(cacheKeyHash({ ...key, country: "UK" })).not.toBe(hash);
    expect(cacheKeyHash({ ...key, run: 2 })).not.toBe(hash);
  });
});
