// Cited-page enrichment from a scan report (SPEC M-2, ACTION_PLAN week 3).
//
//   npm run enrich -- --from out/scan-pest-control-us-dryrun-….json --dry-run
//   npm run enrich -- --from out/scan-….json --limit 20      (needs DATABASE_URL)
//
// Dry runs read fixtures/pages and keep results in memory: no network requests at all.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import type { Env } from "../engines/guard";
import type { Brand } from "../extract/brands";
import { enrichPages, fixturePageFetch, REFETCH_AFTER_DAYS, type EnrichResult } from "../enrich/enrich";
import { PoliteFetcher, type PageFetcher } from "../enrich/fetcher";
import { MemoryCitedPageStore, PgCitedPageStore, type CitedPageStore } from "../enrich/storage";
import { loadCategory } from "../scan/plan";
import type { ScanReport } from "../scan/report";

const USAGE = `Usage: enrich --from <scan report JSON> [--limit N] [--dry-run] [--out out]

  --limit    pages to fetch in this run (default 25, max 200)
  --dry-run  use fixtures/pages, keep results in memory, make no network requests`;

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;

export interface EnrichCliDeps {
  env?: Env;
  log?: (line: string) => void;
  now?: () => Date;
  /** Real runs only: overrides the Postgres store (tests). */
  store?: CitedPageStore;
  /** Real runs only: overrides the polite network fetcher (tests). */
  fetcher?: PageFetcher;
}

function readReport(path: string): ScanReport {
  const report = JSON.parse(readFileSync(path, "utf8")) as ScanReport;
  if (!report || !Array.isArray(report.citedPages) || !report.category?.slug) throw new Error(`${path} is not a scan report JSON.`);
  return report;
}

/** The category's brand list (with domains and aliases), or just the report's brand names. */
function brandsFor(report: ScanReport): Brand[] {
  try {
    return loadCategory(report.category.slug).brands;
  } catch {
    return report.shareOfVoice.map((r) => ({ name: r.brand }));
  }
}

const counts = (results: EnrichResult[]) =>
  Object.entries(Object.groupBy(results, (r) => r.status))
    .map(([status, rows]) => `${status} ${rows?.length ?? 0}`)
    .join(", ");

/** Returns a process exit code. Never throws for expected input errors. */
export async function main(argv: string[], deps: EnrichCliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((line: string) => console.log(line));
  let pool: pg.Pool | null = null;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        from: { type: "string" },
        limit: { type: "string", default: String(DEFAULT_LIMIT) },
        "dry-run": { type: "boolean", default: false },
        out: { type: "string", default: "out" },
        help: { type: "boolean", default: false },
      },
      strict: true,
    });
    if (values.help) {
      log(USAGE);
      return 0;
    }
    if (!values.from) {
      log(USAGE);
      return 2;
    }
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      log(`--limit must be a whole number from 1 to ${MAX_LIMIT}.`);
      return 2;
    }

    const report = readReport(values.from);
    const dryRun = values["dry-run"];
    // A dry-run report's URLs come from synthetic fixtures: never fetch them for real.
    if (report.dryRun && !dryRun) {
      log("This report came from a dry-run scan. Enrich it with --dry-run.");
      return 2;
    }

    let store: CitedPageStore;
    let fetcher: PageFetcher;
    if (dryRun) {
      store = new MemoryCitedPageStore();
      fetcher = new PoliteFetcher({
        fetch: fixturePageFetch(new Map(report.citedPages.map((p) => [p.url, p.pageType]))),
        config: { perDomainIntervalMs: 0 },
        env,
      });
    } else {
      if (!deps.store && !env.DATABASE_URL) {
        log("DATABASE_URL is not set. Real runs store results in cited_pages; use --dry-run to try it without a database.");
        return 2;
      }
      store = deps.store ?? new PgCitedPageStore((pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 })));
      fetcher = deps.fetcher ?? new PoliteFetcher({ env });
    }

    const targets = report.citedPages.map((p) => ({ url: p.url, domain: p.domain, pageType: p.pageType }));
    log(`Enriching ${targets.length} cited page(s) from ${basename(values.from)}${dryRun ? " (dry run: fixtures only, no network)" : ""}.`);
    if (!dryRun) log(`At most 1 request per domain every 10 s; pages fetched in the last ${REFETCH_AFTER_DAYS} days are skipped.`);
    const results = await enrichPages(targets, { fetcher, store, brands: brandsFor(report), limit, now: deps.now, log });

    for (const r of results) {
      if (!r.facts) continue;
      const f = r.facts;
      log(`- ${r.domain}: publisher ${f.publisher}; contact ${f.contactUrl ?? "-"}; submission ${f.submissionUrl ?? "-"}; ` +
        `sponsorship ${f.sponsorshipUrl ?? "-"}; affiliate ${f.affiliateProgram ? "yes" : "-"}; brands ${f.brandsMentioned.join(", ") || "-"}`);
    }
    log(`Done: ${counts(results)}.`);

    // Results stay out of the repo (out/ is gitignored, SPEC M-2).
    const outDir = resolve(values.out);
    mkdirSync(outDir, { recursive: true });
    const stamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
    const file = join(outDir, `enrich-${report.category.slug}-${dryRun ? "dryrun-" : ""}${stamp}.json`);
    writeFileSync(file, `${JSON.stringify({ from: basename(values.from), dryRun, results }, null, 2)}\n`);
    log(`Wrote ${file}`);
    return results.some((r) => r.status === "enriched") || results.every((r) => r.status.startsWith("skipped")) ? 0 : 1;
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await pool?.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
