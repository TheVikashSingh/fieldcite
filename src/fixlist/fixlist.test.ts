import { describe, expect, it, vi } from "vitest";
import { MAX_FIX_LIST_OUTPUT_TOKENS } from "../engines/guard";
import type { EngineId } from "../engines/types";
import type { PageType } from "../extract/classify";
import { planScan, type Category } from "../scan/plan";
import { buildReport, toMarkdown } from "../scan/report";
import type { CallRecord, ScanResult } from "../scan/run";
import { generateFixList, MAX_FIXES, MIN_FIXES, rewordFixList, type FixAction, type FixListInput } from "./generate";
import { findGaps } from "./gaps";

// Synthetic calls only: no engine is called in these tests.
type Cite = { url: string; pageType: PageType; owner?: string };

function call(engine: EngineId, questionIndex: number, brands: string[], cites: Cite[], status: CallRecord["status"] = "ok"): CallRecord {
  return {
    engine,
    model: "m",
    questionIndex,
    question: `q${questionIndex + 1}`,
    run: 1,
    status,
    text: brands.join(", "),
    citations: cites.map((c) => ({ url: c.url, domain: new URL(c.url).hostname, pageType: c.pageType, owner: c.owner })),
    mentions: brands.map((brand, i) => ({ brand, position: i + 1, matched: brand, snippet: brand, source: "alias" as const })),
    usage: { inputTokens: 0, outputTokens: 0, searchCalls: 0 },
    costUsd: 0,
    attempts: 1,
    latencyMs: 0,
  };
}

const T = "Briostack";
const listicle = (n: number): Cite => ({ url: `https://list${n}.example/best-pest-control-software`, pageType: "listicle" });
const QUESTIONS = ["q1", "q2", "q3"];
const input = (calls: CallRecord[], questions = QUESTIONS): FixListInput => ({
  calls,
  gaps: findGaps(calls, T),
  target: T,
  trade: "pest control",
  country: "US",
  questions,
});

function expectEvidenceValid(actions: FixAction[], calls: CallRecord[]) {
  for (const a of actions) {
    expect(a.evidence.length, a.id).toBeGreaterThan(0);
    for (const e of a.evidence) {
      const c = calls[e.callIndex];
      expect(c.status).toBe("ok");
      expect(c.engine).toBe(e.engine);
      expect(c.mentions.some((m) => m.brand === T)).toBe(false);
      if (e.citationIndex !== undefined) {
        expect(c.citations[e.citationIndex].url).toBe(e.url);
        expect(a.pages.map((p) => p.url)).toContain(e.url);
      }
    }
    // Every competitor named in the "why" comes from the evidence answers.
    const named = new Set(a.evidence.flatMap((e) => calls[e.callIndex].mentions.map((m) => m.brand)));
    for (const b of a.strength.competitors) expect(named.has(b)).toBe(true);
  }
}

describe("findGaps", () => {
  const calls = [
    call("openai", 0, ["Jobber", "GorillaDesk"], [listicle(1), { url: "https://g2.example/pest", pageType: "review_site" }, listicle(1)]),
    call("perplexity", 0, ["Jobber", T], [listicle(1), listicle(2)]),
    call("gemini", 1, ["PestPac"], [listicle(1), { url: "https://briostack.com/", pageType: "vendor_page", owner: T }]),
    call("openai", 1, [], [listicle(3)]),
    call("gemini", 2, ["Jobber"], [listicle(4)], "error"),
  ];
  const gaps = findGaps(calls, T);

  it("lists pages cited by answers that name competitors but not the target", () => {
    expect(gaps.map((g) => g.url)).toEqual(["https://list1.example/best-pest-control-software", "https://g2.example/pest"]);
  });

  it("counts answers, engines and competitors", () => {
    expect(gaps[0]).toMatchObject({ citedIn: 3, answers: 4, gapAnswers: 2, targetAnswers: 1, engines: ["gemini", "openai"], competitors: ["GorillaDesk", "Jobber", "PestPac"] });
    expect(gaps[1]).toMatchObject({ citedIn: 1, gapAnswers: 1, engines: ["openai"], competitors: ["GorillaDesk", "Jobber"] });
  });

  it("links each gap answer to the citation of the page", () => {
    expect(gaps[0].evidence).toEqual([
      { answerId: "A1", callIndex: 0, engine: "openai", questionIndex: 0, run: 1, citationIndex: 0, url: listicle(1).url },
      { answerId: "A3", callIndex: 2, engine: "gemini", questionIndex: 1, run: 1, citationIndex: 0, url: listicle(1).url },
    ]);
  });

  it("skips pages only cited with the target, the target's own pages, brandless answers and failed calls", () => {
    const urls = gaps.map((g) => g.url);
    expect(urls).not.toContain(listicle(2).url);
    expect(urls).not.toContain("https://briostack.com/");
    expect(urls).not.toContain(listicle(3).url);
    expect(urls).not.toContain(listicle(4).url);
  });
});

describe("generateFixList", () => {
  it("ranks by evidence strength", () => {
    const calls = [
      call("openai", 0, ["Jobber"], [listicle(1), listicle(2), { url: "https://www.reddit.com/r/pestcontrol/t1", pageType: "forum" }]),
      call("perplexity", 0, ["Jobber", "PestPac"], [listicle(1), listicle(2)]),
      call("gemini", 1, ["GorillaDesk"], [listicle(1)]),
      call("openai", 1, ["Jobber"], [listicle(2)]),
      call("perplexity", 2, ["Jobber"], [{ url: "https://www.youtube.com/watch?v=x", pageType: "video" }]),
    ];
    const fixes = generateFixList(input(calls));
    const pageFixes = fixes.filter((f) => f.pages.length);
    // list1: 3 answers, 3 engines, 3 competitors = 18. list2: 3 answers, 2 engines, 2 competitors = 15.
    expect(pageFixes.map((f) => [f.id, f.strength.score])).toEqual([
      [`get_listed:${listicle(1).url}`, 18],
      [`get_listed:${listicle(2).url}`, 15],
      ["forum_answer:https://www.reddit.com/r/pestcontrol/t1", 6],
      ["video_review:https://www.youtube.com/watch?v=x", 6],
    ]);
    expect(fixes.map((f) => f.rank)).toEqual(fixes.map((_, i) => i + 1));
    for (let i = 1; i < pageFixes.length; i++) expect(pageFixes[i - 1].strength.score).toBeGreaterThanOrEqual(pageFixes[i].strength.score);
    expectEvidenceValid(fixes, calls);
  });

  it("puts the own comparison page first on a tie and groups competitor pages into it", () => {
    const calls = [
      call("openai", 0, ["Jobber"], [{ url: "https://getjobber.com/best", pageType: "vendor_page", owner: "Jobber" }, listicle(1)]),
      call("openai", 1, ["PestPac"], [{ url: "https://workwave.com/pestpac", pageType: "vendor_page", owner: "PestPac" }]),
    ];
    const fixes = generateFixList(input(calls));
    expect(fixes[0]).toMatchObject({ kind: "comparison_page", strength: { answers: 2 } });
    expect(fixes[0].pages.map((p) => p.url).sort()).toEqual(["https://getjobber.com/best", "https://workwave.com/pestpac"]);
    expect(fixes[0].why).toContain("Competitor-owned pages (Jobber and PestPac)");
    expect(fixes.filter((f) => f.kind === "comparison_page")).toHaveLength(1);
  });

  it("caps the list at 15", () => {
    const calls = Array.from({ length: 30 }, (_, i) => call("openai", 0, ["Jobber"], [listicle(i)]));
    const fixes = generateFixList(input(calls));
    expect(fixes).toHaveLength(MAX_FIXES);
    expectEvidenceValid(fixes, calls);
  });

  it("fills to 5 with question-level actions backed by answers", () => {
    const calls = [call("openai", 0, ["Jobber"], [listicle(1)]), call("openai", 1, ["PestPac"], []), call("openai", 2, ["GorillaDesk"], [])];
    const fixes = generateFixList(input(calls));
    expect(fixes).toHaveLength(MIN_FIXES);
    expect(fixes[0].kind).toBe("get_listed");
    expect(fixes.map((f) => f.kind).sort()).toEqual(["answer_page", "answer_page", "answer_page", "comparison_page", "get_listed"]);
    expectEvidenceValid(fixes, calls);
  });

  it("returns fewer than 5 rather than inventing actions", () => {
    const calls = [call("openai", 0, ["Jobber"], [listicle(1)])];
    const fixes = generateFixList(input(calls, ["q1"]));
    expect(fixes.length).toBeLessThan(MIN_FIXES);
    expectEvidenceValid(fixes, calls);
  });

  it("is empty when every answer names the target", () => {
    const calls = [call("openai", 0, ["Jobber", T], [listicle(1)])];
    expect(generateFixList(input(calls))).toEqual([]);
  });

  it("keeps every action's evidence on the fixture-sized scan", () => {
    const calls = [
      call("openai", 0, ["Jobber", "PestPac"], [listicle(1), { url: "https://g2.example/a", pageType: "review_site" }, { url: "https://g2.example/b", pageType: "review_site" }]),
      call("gemini", 0, ["GorillaDesk"], [{ url: "https://other.example/page", pageType: "other" }, { url: "https://getjobber.com/x", pageType: "vendor_page", owner: "Jobber" }]),
    ];
    const fixes = generateFixList(input(calls));
    expect(fixes.find((f) => f.kind === "review_profile")?.pages).toHaveLength(2);
    expect(fixes.length).toBeGreaterThanOrEqual(MIN_FIXES);
    expect(fixes.length).toBeLessThanOrEqual(MAX_FIXES);
    expectEvidenceValid(fixes, calls);
  });
});

describe("rewordFixList", () => {
  const calls = [call("openai", 0, ["Jobber"], [listicle(1)]), call("openai", 1, ["PestPac"], [listicle(2)])];
  const fixes = generateFixList(input(calls));

  it("asks for at most 1,500 output tokens (CS-6) and only changes title and detail", async () => {
    const reword = vi.fn(async ({ actions }: { actions: { id: string; title: string; detail: string }[] }) =>
      actions.map((a) => ({ id: a.id, title: `New ${a.title}`, detail: "" })),
    );
    const out = await rewordFixList(fixes, { reword });
    expect(reword).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: MAX_FIX_LIST_OUTPUT_TOKENS }));
    expect(MAX_FIX_LIST_OUTPUT_TOKENS).toBe(1500);
    expect(out).toHaveLength(fixes.length);
    out.forEach((a, i) => {
      expect(a.title).toBe(`New ${fixes[i].title}`);
      expect(a.detail).toBe(fixes[i].detail);
      expect({ ...a, title: "", detail: "" }).toEqual({ ...fixes[i], title: "", detail: "" });
    });
  });

  it("keeps the template text when the rewriter fails", async () => {
    const out = await rewordFixList(fixes, { reword: async () => Promise.reject(new Error("breaker tripped")) });
    expect(out).toEqual(fixes);
  });
});

describe("report", () => {
  const category: Category = {
    slug: "test",
    name: "Test software",
    trade: "pest control",
    brands: [{ name: "Jobber" }, { name: T, aliases: ["Brio Stack"] }],
    questions: ["q1", "q2"],
  };
  const calls = [call("openai", 0, ["Jobber"], [listicle(1)]), call("openai", 1, ["Jobber", T], [listicle(2)])];
  const result = (targetBrand?: string): ScanResult => ({
    plan: planScan({ category, country: "US", questions: 2, runs: 1, engines: ["openai"], targetBrand }),
    dryRun: true,
    startedAt: "2026-10-24T00:00:00.000Z",
    finishedAt: "2026-10-24T00:00:01.000Z",
    calls,
    totalCostUsd: 0,
  });

  it("has no gaps or fix list without a target brand", () => {
    const r = buildReport(result());
    expect(r).toMatchObject({ targetBrand: null, gaps: null, fixList: null });
    expect(toMarkdown(r)).toContain("No target brand was set");
  });

  it("adds gaps and the fix list for a target brand, matched by alias", () => {
    const r = buildReport(result("brio stack"));
    expect(r.targetBrand).toBe(T);
    expect(r.gaps?.map((g) => g.url)).toEqual([listicle(1).url]);
    expect(r.fixList?.length).toBeGreaterThan(0);
    expect(r.fixListNote).toMatch(/supports only/);
    const md = toMarkdown(r);
    expect(md).toContain(`## Gaps: pages that cite competitors and not ${T}`);
    expect(md).toContain(`## Fix list for ${T}`);
    expect(md).toContain("- Evidence: A1 (openai, Q1, run 1, citation 1)");
    expect(md).toContain("- A1 **openai** (run 1)");
  });

  it("rejects a brand outside the category", () => {
    expect(() => result("Workiz")).toThrow(/--brand must be one of the test brands/);
  });
});
