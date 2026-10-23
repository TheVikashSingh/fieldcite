import { describe, expect, it } from "vitest";
import { LogNotifier } from "./notifier";
import { buildDailySpendMessage, forecastAlerts, type DailySpend } from "./spend-summary";

function data(overrides: Partial<DailySpend> = {}): DailySpend {
  return {
    day: "2026-11-05",
    totalUsd: 4.5,
    calls: 300,
    cacheHits: 40,
    byEngine: [
      { engine: "openai", usd: 2.5 },
      { engine: "perplexity", usd: 1.5 },
      { engine: "gemini", usd: 0.5 },
    ],
    byScope: [
      { scope: "paid", usd: 3 },
      { scope: "free", usd: 1 },
      { scope: "baseline", usd: 0.5 },
    ],
    byAccount: [
      { accountId: "a1", email: "one@example.com", usd: 1.2, calls: 60 },
      { accountId: "a2", email: "two@example.com", usd: 1.0, calls: 50 },
      { accountId: null, email: null, usd: 0.5, calls: 40 },
      { accountId: "a3", email: "three@example.com", usd: 0.4, calls: 30 },
      { accountId: "a4", email: "four@example.com", usd: 0.3, calls: 30 },
      { accountId: "a5", email: "five@example.com", usd: 0.2, calls: 20 },
      { accountId: "a6", email: "six@example.com", usd: 0.1, calls: 10 },
    ],
    monthToDateUsd: 12,
    monthlyForecastUsd: 50,
    trips: [],
    ...overrides,
  };
}

describe("CS-13: forecast alerts", () => {
  it("fires at exactly 50%, 80% and 100% of the monthly forecast", () => {
    expect(forecastAlerts(24.99, 50)).toEqual([]);
    expect(forecastAlerts(25, 50)).toEqual([50]);
    expect(forecastAlerts(39.99, 50)).toEqual([50]);
    expect(forecastAlerts(40, 50)).toEqual([50, 80]);
    expect(forecastAlerts(49.99, 50)).toEqual([50, 80]);
    expect(forecastAlerts(50, 50)).toEqual([50, 80, 100]);
    expect(forecastAlerts(75, 50)).toEqual([50, 80, 100]);
  });
});

describe("CS-9: daily spend summary", () => {
  it("shows spend by engine, by account and the top 5 accounts", () => {
    const { subject, text } = buildDailySpendMessage(data());
    expect(subject).toBe("FieldCite spend 2026-11-05: $4.50");
    expect(text).toContain("Spend on 2026-11-05: $4.50 over 300 calls (40 cache hits at $0).");
    expect(text).toContain("Month to date: $12.00 of $50.00 forecast (24%).");
    expect(text).toMatch(/By engine:\n {2}openai: \$2\.50\n {2}perplexity: \$1\.50\n {2}gemini: \$0\.50/);

    const top = text.split("Top 5 accounts by spend:\n")[1].split("\n\n")[0].split("\n");
    expect(top).toEqual([
      "  1. one@example.com (a1): $1.20",
      "  2. two@example.com (a2): $1.00",
      "  3. Baseline scans (internal): $0.50",
      "  4. three@example.com (a3): $0.40",
      "  5. four@example.com (a4): $0.30",
    ]);
    expect(text).toContain("By account (7):");
    expect(text).toContain("  six@example.com (a6): $0.10 over 10 calls");
    expect(text).not.toMatch(/alert/i);
  });

  it("flags the highest forecast level reached", () => {
    const at80 = buildDailySpendMessage(data({ monthToDateUsd: 40 }));
    expect(at80.subject).toBe("FieldCite spend 2026-11-05: $4.50 [80% of forecast]");
    expect(at80.text.split("\n")[0]).toBe("Alert: month-to-date spend has passed 80% of the monthly forecast ($40.00 of $50.00).");

    const at100 = buildDailySpendMessage(data({ monthToDateUsd: 50 }));
    expect(at100.subject).toContain("[100% of forecast]");
    expect(at100.text.split("\n")[0]).toMatch(/^ALERT: .*100%/);
  });

  it("lists breakers that tripped and handles an empty day", () => {
    const { text } = buildDailySpendMessage(
      data({ totalUsd: 0, calls: 0, cacheHits: 0, byEngine: [], byScope: [], byAccount: [], monthToDateUsd: 0, trips: [{ breaker: "free_daily", trippedAt: new Date("2026-11-05T13:00:00Z") }] }),
    );
    expect(text).toContain("Circuit breakers tripped today:\n  free_daily at 2026-11-05T13:00:00.000Z");
    expect(text).toContain("By engine:\n  none");
    expect(text).toContain("Top 5 accounts by spend:\n  none");
  });

  it("goes through the notifier interface (log only for now)", async () => {
    const lines: string[] = [];
    await new LogNotifier((l) => lines.push(l)).notify(buildDailySpendMessage(data()));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[owner\] FieldCite spend 2026-11-05/);
  });
});
