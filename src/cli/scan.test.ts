import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdapters } from "../engines";
import type { Env } from "../engines/guard";
import type { ScanReport } from "../scan/report";
import { main } from "./scan";

const dirs: string[] = [];
function tempOut() {
  const d = mkdtempSync(join(tmpdir(), "fieldcite-scan-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ARGS = ["--category", "pest-control", "--country", "US", "--questions", "3", "--runs", "2", "--engines", "openai,perplexity,gemini"];

describe("scan CLI", () => {
  it("--dry-run writes JSON and Markdown reports from fixtures", async () => {
    const out = tempOut();
    const lines: string[] = [];
    const code = await main([...ARGS, "--dry-run", "--out", out], { env: {}, log: (l) => lines.push(l) });
    expect(code).toBe(0);

    const files = readdirSync(out).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^scan-pest-control-us-dryrun-.*\.json$/);
    expect(files[1]).toMatch(/\.md$/);

    const report = JSON.parse(readFileSync(join(out, files[0]), "utf8")) as ScanReport;
    expect(report.dryRun).toBe(true);
    expect(report.totals).toMatchObject({ plannedCalls: 18, ok: 18, errors: 0 });
    expect(report.totals.costUsd).toBeGreaterThan(0);
    expect(report.shareOfVoice[0]).toMatchObject({ brand: "GorillaDesk", mentioned: 18, answers: 18 });
    expect(new Set(report.citedPages.map((p) => p.pageType))).toEqual(new Set(["review_site", "vendor_page", "forum", "listicle", "video"]));

    const md = readFileSync(join(out, files[1]), "utf8");
    expect(md).toContain("**Dry run.**");
    expect(md).toContain("official API with web search enabled");
    expect(md).toContain("| GorillaDesk | 6/6 | 6/6 | 6/6 | 18/18 |");
  });

  it("--brand adds gaps and a fix list to the reports and the output", async () => {
    const out = tempOut();
    const lines: string[] = [];
    const args = ["--category", "pest-control", "--country", "US", "--questions", "3", "--runs", "1", "--brand", "Briostack", "--dry-run", "--out", out];
    expect(await main(args, { env: {}, log: (l) => lines.push(l) })).toBe(0);

    const files = readdirSync(out).sort();
    const report = JSON.parse(readFileSync(join(out, files[0]), "utf8")) as ScanReport;
    expect(report.targetBrand).toBe("Briostack");
    expect(report.gaps!.length).toBeGreaterThan(0);
    expect(report.fixList!.length).toBeGreaterThanOrEqual(5);
    expect(report.fixList!.length).toBeLessThanOrEqual(15);
    expect(report.fixList![0].kind).toBe("comparison_page");
    for (const a of report.fixList!) {
      expect(a.evidence.length).toBeGreaterThan(0);
      for (const e of a.evidence) expect(report.calls[e.callIndex].mentions.some((m) => m.brand === "Briostack")).toBe(false);
    }

    const md = readFileSync(join(out, files[1]), "utf8");
    expect(md).toContain("## Gaps: pages that cite competitors and not Briostack");
    expect(md).toContain("## Fix list for Briostack");
    const text = lines.join("\n");
    expect(text).toMatch(/Gaps for Briostack: \d+ cited page/);
    expect(text).toMatch(/Fix list \(\d+ actions\):\n {2}1\. Publish your own/);
  });

  it("rejects a --brand outside the category before any call", async () => {
    const lines: string[] = [];
    const factory = vi.fn(createAdapters);
    const code = await main([...ARGS, "--brand", "Workiz", "--dry-run"], { env: {}, log: (l) => lines.push(l), createAdapters: factory });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("--brand must be one of the pest-control brands");
    expect(factory).not.toHaveBeenCalled();
  });

  it("honors SCANS_ENABLED=false before doing anything (CS-8)", async () => {
    const out = tempOut();
    const factory = vi.fn(createAdapters);
    const code = await main([...ARGS, "--dry-run", "--out", out], { env: { SCANS_ENABLED: "false" }, log: () => {}, createAdapters: factory });
    expect(code).toBe(3);
    expect(factory).not.toHaveBeenCalled();
    expect(readdirSync(out)).toEqual([]);
  });

  it("refuses more than 150 calls (CS-5)", async () => {
    const lines: string[] = [];
    const factory = vi.fn(createAdapters);
    const code = await main(["--category", "pest-control", "--country", "US", "--questions", "10", "--runs", "6", "--dry-run"], {
      env: {},
      log: (l) => lines.push(l),
      createAdapters: factory,
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toMatch(/180 engine calls; the limit is 150/);
    expect(factory).not.toHaveBeenCalled();
  });

  it("will not start a real run without --confirm", async () => {
    const factory = vi.fn(createAdapters);
    const lines: string[] = [];
    const code = await main(ARGS, { env: { OPENAI_API_KEY: "x" }, log: (l) => lines.push(l), createAdapters: factory });
    expect(code).toBe(4);
    expect(factory).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("Worst-case cost");
  });

  it("fails cleanly on a real run with no API keys", async () => {
    const lines: string[] = [];
    const code = await main([...ARGS, "--confirm"], { env: {}, log: (l) => lines.push(l) });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("OPENAI_API_KEY is not set");
  });

  it("rejects bad input", async () => {
    const log = () => {};
    expect(await main(["--category", "pest-control"], { env: {}, log })).toBe(2);
    expect(await main([...ARGS.slice(0, 2), "--country", "IN", "--questions", "1", "--dry-run"], { env: {}, log })).toBe(1);
    expect(await main([...ARGS, "--bogus"], { env: {}, log })).toBe(1);
  });

  it("stops the scan when the kill switch flips mid-run (CS-8)", async () => {
    const out = tempOut();
    const env: Env = {};
    let calls = 0;
    const code = await main([...ARGS, "--dry-run", "--out", out], {
      env,
      log: () => {},
      createAdapters: (engines, opts) =>
        createAdapters(engines, opts).map((a) => ({
          ...a,
          ask: (q, o) => {
            if (++calls === 4) env.SCANS_ENABLED = "false";
            return a.ask(q, o);
          },
        })),
    });
    expect(code).toBe(0);
    const json = readdirSync(out).find((f) => f.endsWith(".json"))!;
    const report = JSON.parse(readFileSync(join(out, json), "utf8")) as ScanReport;
    expect(report.totals).toMatchObject({ ok: 3, errors: 1, skipped: 14 });
    expect(report.totals.stoppedReason).toMatch(/SCANS_ENABLED=false/);
  });
});
