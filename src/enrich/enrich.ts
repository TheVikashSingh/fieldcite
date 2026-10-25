// Cited-page enrichment run (SPEC M-2): fetch each cited page politely, extract the facts and
// fill the empty fields of its cited_pages row. A page is fetched at most once every 30 days.

import { readFileSync } from "node:fs";
import type { Brand } from "../extract/brands";
import { extractPageFacts, type PageFacts } from "./extract";
import type { FetchFailure, PageFetcher } from "./fetcher";
import type { CitedPageStore } from "./storage";

export const REFETCH_AFTER_DAYS = 30;
const REFETCH_AFTER_MS = REFETCH_AFTER_DAYS * 24 * 60 * 60 * 1000;

/** Gemini grounding links are Google redirects, not the cited page; we don't fetch through them. */
const REDIRECT_HOSTS = ["vertexaisearch.cloud.google.com"];

export interface EnrichTarget {
  url: string;
  domain: string;
  pageType?: string;
}

export type EnrichStatus = "enriched" | "fetch_failed" | "skipped_recent" | "skipped_unfetchable" | "skipped_limit";

export interface EnrichResult {
  url: string;
  domain: string;
  status: EnrichStatus;
  reason?: FetchFailure | string;
  facts?: PageFacts;
}

export interface EnrichOptions {
  fetcher: PageFetcher;
  store: CitedPageStore;
  brands: Brand[];
  /** Pages to fetch in this run, after skips. */
  limit: number;
  now?: () => Date;
  log?: (line: string) => void;
}

function unfetchable(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return "not an http(s) URL";
    if (REDIRECT_HOSTS.includes(u.hostname.toLowerCase())) return "search redirect, not the cited page";
    return null;
  } catch {
    return "invalid URL";
  }
}

export async function enrichPages(targets: EnrichTarget[], opts: EnrichOptions): Promise<EnrichResult[]> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const seen = new Set<string>();
  const results: EnrichResult[] = [];
  const toFetch: { target: EnrichTarget; result: EnrichResult }[] = [];

  for (const target of targets) {
    if (seen.has(target.url)) continue;
    seen.add(target.url);
    const result: EnrichResult = { url: target.url, domain: target.domain, status: "enriched" };
    results.push(result);
    const why = unfetchable(target.url);
    if (why) {
      Object.assign(result, { status: "skipped_unfetchable", reason: why });
      continue;
    }
    const existing = await opts.store.get(target.url);
    if (existing?.lastFetchedAt && now().getTime() - existing.lastFetchedAt.getTime() < REFETCH_AFTER_MS) {
      Object.assign(result, { status: "skipped_recent", reason: `fetched ${existing.lastFetchedAt.toISOString()}` });
      continue;
    }
    if (toFetch.length >= opts.limit) {
      Object.assign(result, { status: "skipped_limit", reason: `--limit ${opts.limit}` });
      continue;
    }
    toFetch.push({ target, result });
  }

  // The fetcher enforces per-domain pacing and the global in-flight cap.
  await Promise.all(
    toFetch.map(async ({ target, result }) => {
      const outcome = await opts.fetcher.fetchPage(target.url);
      const fetchedAt = now();
      const base = { url: target.url, domain: target.domain, pageType: target.pageType, fetchedAt };
      if (!outcome.ok) {
        // The attempt still counts for the 30-day rule, so a failing page isn't retried every run.
        await opts.store.upsertEnrichment(base);
        Object.assign(result, { status: "fetch_failed", reason: outcome.status ? `${outcome.reason} (${outcome.status})` : outcome.reason });
        log(`  ${target.url}: ${result.reason}`);
        return;
      }
      const facts = extractPageFacts(outcome.html, outcome.finalUrl, opts.brands);
      await opts.store.upsertEnrichment({
        ...base,
        publisher: facts.publisher,
        contactUrl: facts.contactUrl,
        submissionUrl: facts.submissionUrl,
        sponsorshipUrl: facts.sponsorshipUrl,
        affiliateProgram: facts.affiliateProgram,
        brandsMentioned: facts.brandsMentioned,
      });
      result.facts = facts;
      log(`  ${target.url}: enriched (${facts.publisher})`);
    }),
  );
  return results;
}

/**
 * Dry runs: serves fixtures/pages instead of the network. robots.txt comes from
 * fixtures/pages/robots.txt and each page from the fixture for its page type.
 */
export function fixturePageFetch(pageTypes: Map<string, string>): (url: string, init: RequestInit) => Promise<Response> {
  const read = (name: string) => readFileSync(new URL(`../../fixtures/pages/${name}`, import.meta.url), "utf8");
  return async (url) => {
    const u = new URL(url);
    if (u.pathname === "/robots.txt") return new Response(read("robots.txt"), { status: 200, headers: { "content-type": "text/plain" } });
    const type = pageTypes.get(url) ?? "other";
    const file = ["listicle", "review_site", "vendor_page", "forum"].includes(type) ? `${type}.html` : "other.html";
    return new Response(read(file), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
}
