import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as enrichCli } from "../cli/enrich";
import { main as scanCli } from "../cli/scan";
import type { Brand } from "../extract/brands";
import { enrichPages, type EnrichResult } from "./enrich";
import type { FetchOutcome, PageFetcher } from "./fetcher";
import { MemoryCitedPageStore, type CitedPageRecord } from "./storage";

const NOW = new Date("2026-11-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const BRANDS: Brand[] = [{ name: "GorillaDesk", domain: "gorilladesk.com" }, { name: "Jobber", domain: "getjobber.com" }];

const PAGE_HTML = `<html><head><meta property="og:site_name" content="Fresh Publisher"></head><body>
  <p>We may earn a commission. Email jane.doe@example.com.</p><h2>GorillaDesk</h2><h2>Jobber</h2>
  <a href="mailto:jane.doe@example.com">Contact</a><a href="/contact">Contact us</a>
  <a href="/submit-your-tool">Submit your tool</a><a href="/advertise">Advertise</a></body></html>`;

function stubFetcher(byUrl: Record<string, FetchOutcome> = {}) {
  const fetchPage = vi.fn(async (url: string): Promise<FetchOutcome> => byUrl[url] ?? { ok: true, url, finalUrl: url, status: 200, html: PAGE_HTML });
  return { fetchPage } satisfies PageFetcher;
}

const row = (url: string, patch: Partial<CitedPageRecord> = {}): CitedPageRecord => ({
  url,
  domain: new URL(url).hostname.replace(/^www\./, ""),
  pageType: null,
  publisher: null,
  contactUrl: null,
  submissionUrl: null,
  sponsorshipUrl: null,
  sponsorshipPrice: null,
  affiliateProgram: null,
  brandsMentioned: [],
  lastFetchedAt: null,
  curatorNotes: null,
  outreachOutcome: null,
  ...patch,
});

const target = (url: string, pageType = "listicle") => ({ url, domain: new URL(url).hostname.replace(/^www\./, ""), pageType });
const byUrl = (results: EnrichResult[]) => Object.fromEntries(results.map((r) => [r.url, r.status]));

describe("enrichPages", () => {
  it("stores every extracted field for a new page", async () => {
    const store = new MemoryCitedPageStore();
    const url = "https://www.blog.test/best";
    await enrichPages([target(url)], { fetcher: stubFetcher(), store, brands: BRANDS, limit: 10, now: () => NOW });
    expect(await store.get(url)).toEqual(
      row(url, {
        pageType: "listicle",
        publisher: "Fresh Publisher",
        contactUrl: "https://www.blog.test/contact",
        submissionUrl: "https://www.blog.test/submit-your-tool",
        sponsorshipUrl: "https://www.blog.test/advertise",
        affiliateProgram: true,
        brandsMentioned: ["GorillaDesk", "Jobber"],
        lastFetchedAt: NOW,
      }),
    );
  });

  it("re-fetches a page at most once every 30 days", async () => {
    const recent = "https://a.test/recent";
    const stale = "https://b.test/stale";
    const store = new MemoryCitedPageStore([row(recent, { lastFetchedAt: daysAgo(29) }), row(stale, { lastFetchedAt: daysAgo(31) })]);
    const fetcher = stubFetcher();
    const results = await enrichPages([target(recent), target(stale)], { fetcher, store, brands: BRANDS, limit: 10, now: () => NOW });
    expect(byUrl(results)).toEqual({ [recent]: "skipped_recent", [stale]: "enriched" });
    expect(fetcher.fetchPage.mock.calls.map((c) => c[0])).toEqual([stale]);
  });

  it("records failed attempts so they count for the 30-day rule", async () => {
    const url = "https://a.test/blocked";
    const store = new MemoryCitedPageStore();
    const fetcher = stubFetcher({ [url]: { ok: false, url, reason: "robots_disallowed" } });
    const first = await enrichPages([target(url)], { fetcher, store, brands: BRANDS, limit: 10, now: () => NOW });
    expect(first[0]).toMatchObject({ status: "fetch_failed", reason: "robots_disallowed" });
    expect((await store.get(url))?.lastFetchedAt).toEqual(NOW);
    const again = await enrichPages([target(url)], { fetcher, store, brands: BRANDS, limit: 10, now: () => daysAgo(-1) });
    expect(again[0].status).toBe("skipped_recent");
    expect(fetcher.fetchPage).toHaveBeenCalledTimes(1);
  });

  it("never overwrites curator edits; it only fills empty fields", async () => {
    const url = "https://www.blog.test/best";
    const curated = row(url, {
      publisher: "Curated Publisher Name",
      contactUrl: "https://www.blog.test/partnerships",
      affiliateProgram: false,
      brandsMentioned: ["Jobber"],
      sponsorshipPrice: "$450 per listing",
      curatorNotes: "Editor replies within a week",
      outreachOutcome: "listed 2026-10",
      lastFetchedAt: daysAgo(45),
    });
    const store = new MemoryCitedPageStore([curated]);
    await enrichPages([target(url)], { fetcher: stubFetcher(), store, brands: BRANDS, limit: 10, now: () => NOW });
    expect(await store.get(url)).toEqual({
      ...curated,
      pageType: "listicle",
      submissionUrl: "https://www.blog.test/submit-your-tool",
      sponsorshipUrl: "https://www.blog.test/advertise",
      lastFetchedAt: NOW,
    });
  });

  it("stores no personal emails or profiles", async () => {
    const store = new MemoryCitedPageStore();
    await enrichPages([target("https://www.blog.test/best")], { fetcher: stubFetcher(), store, brands: BRANDS, limit: 10, now: () => NOW });
    expect(JSON.stringify([...store.rows.values()])).not.toMatch(/@|jane/i);
  });

  it("dedupes, skips search redirects, and honors --limit", async () => {
    const urls = ["https://a.test/1", "https://a.test/1", "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x", "https://b.test/2", "https://c.test/3"];
    const fetcher = stubFetcher();
    const results = await enrichPages(
      urls.map((u) => target(u)),
      { fetcher, store: new MemoryCitedPageStore(), brands: BRANDS, limit: 2, now: () => NOW },
    );
    expect(results.map((r) => r.status)).toEqual(["enriched", "skipped_unfetchable", "enriched", "skipped_limit"]);
    expect(fetcher.fetchPage).toHaveBeenCalledTimes(2);
  });
});

describe("enrich CLI", () => {
  const dirs: string[] = [];
  const temp = () => {
    const d = mkdtempSync(join(tmpdir(), "fieldcite-enrich-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function dryRunReport(): Promise<string> {
    const out = temp();
    const code = await scanCli(["--category", "pest-control", "--country", "US", "--questions", "3", "--runs", "1", "--dry-run", "--out", out], { env: {}, log: () => {} });
    expect(code).toBe(0);
    return join(out, readdirSync(out).find((f) => f.endsWith(".json"))!);
  }

  it("--dry-run enriches a dry-run scan's cited pages from fixtures with no network", async () => {
    // The global fetch throws in unit tests (src/test/no-network.ts), so any real request fails this test.
    const report = await dryRunReport();
    const out = temp();
    const lines: string[] = [];
    const code = await enrichCli(["--from", report, "--dry-run", "--out", out], { env: {}, log: (l) => lines.push(l), now: () => NOW });
    expect(code).toBe(0);
    const written = JSON.parse(readFileSync(join(out, readdirSync(out)[0]), "utf8")) as { dryRun: boolean; results: EnrichResult[] };
    expect(written.dryRun).toBe(true);
    const enriched = written.results.filter((r) => r.status === "enriched");
    expect(enriched.length).toBeGreaterThan(3);
    expect(enriched.some((r) => r.facts?.submissionUrl && r.facts.affiliateProgram)).toBe(true);
    // The synthetic robots.txt disallows forum threads under /r/.
    expect(written.results.find((r) => r.url.includes("reddit.com/r/"))).toMatchObject({ status: "fetch_failed", reason: "robots_disallowed" });
    expect(written.results.filter((r) => r.url.includes("vertexaisearch")).every((r) => r.status === "skipped_unfetchable")).toBe(true);
    expect(JSON.stringify(written)).not.toMatch(/@example\.com/);
    expect(lines.at(-2)).toMatch(/^Done: /);
  });

  it("refuses to fetch a dry-run report for real, and real runs need a database", async () => {
    const report = await dryRunReport();
    const lines: string[] = [];
    expect(await enrichCli(["--from", report], { env: {}, log: (l) => lines.push(l) })).toBe(2);
    expect(lines.join("\n")).toMatch(/dry-run scan/);

    const real = join(temp(), "real.json");
    writeFileSync(real, JSON.stringify({ ...JSON.parse(readFileSync(report, "utf8")), dryRun: false }));
    lines.length = 0;
    expect(await enrichCli(["--from", real], { env: {}, log: (l) => lines.push(l) })).toBe(2);
    expect(lines.join("\n")).toMatch(/DATABASE_URL is not set/);
  });

  it("runs for real through the injected store and fetcher", async () => {
    const report = await dryRunReport();
    const real = join(temp(), "real.json");
    writeFileSync(real, JSON.stringify({ ...JSON.parse(readFileSync(report, "utf8")), dryRun: false }));
    const store = new MemoryCitedPageStore();
    const fetcher = stubFetcher();
    const code = await enrichCli(["--from", real, "--limit", "2", "--out", temp()], { env: {}, log: () => {}, store, fetcher, now: () => NOW });
    expect(code).toBe(0);
    expect(fetcher.fetchPage).toHaveBeenCalledTimes(2);
    expect(store.rows.size).toBe(2);
  });

  it("validates --limit and --from", async () => {
    const log = () => {};
    expect(await enrichCli([], { env: {}, log })).toBe(2);
    expect(await enrichCli(["--from", "x.json", "--limit", "0"], { env: {}, log })).toBe(2);
    expect(await enrichCli(["--from", "x.json", "--limit", "500"], { env: {}, log })).toBe(2);
    expect(await enrichCli(["--from", join(temp(), "missing.json"), "--dry-run"], { env: {}, log })).toBe(1);
  });
});
