// Command-line scanner (ACTION_PLAN week 1).
//
//   npm run scan -- --category pest-control --country US --questions 5 --runs 1 \
//     --engines openai,perplexity,gemini --dry-run
//
// Real runs need API keys in .env and --confirm, after showing the worst-case cost.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createAdapters } from "../engines";
import { scansEnabled, type Env } from "../engines/guard";
import type { EngineAdapter, EngineId } from "../engines/types";
import { AliasBrandExtractor, type BrandExtractor } from "../extract/brands";
import { estimateMaxCostUsd, loadCategory, parseCountry, parseEngines, planScan } from "../scan/plan";
import { buildReport, toMarkdown } from "../scan/report";
import { runScan } from "../scan/run";

const USAGE = `Usage: scan --category <slug> --country <US|UK|CA|AU> --questions N [--runs R]
            [--engines openai,perplexity,gemini] [--dry-run] [--confirm] [--out out]`;

export interface CliDeps {
  env?: Env;
  log?: (line: string) => void;
  now?: () => Date;
  createAdapters?: (engines: EngineId[], opts: { dryRun: boolean; env: Env }) => EngineAdapter[];
  extractor?: BrandExtractor;
}

/** Returns a process exit code. Never throws for expected input errors. */
export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((line: string) => console.log(line));
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        category: { type: "string" },
        country: { type: "string" },
        questions: { type: "string" },
        runs: { type: "string", default: "1" },
        engines: { type: "string", default: "openai,perplexity,gemini" },
        "dry-run": { type: "boolean", default: false },
        confirm: { type: "boolean", default: false },
        out: { type: "string", default: "out" },
        help: { type: "boolean", default: false },
      },
      strict: true,
    });
    if (values.help) {
      log(USAGE);
      return 0;
    }
    if (!values.category || !values.country || !values.questions) {
      log(USAGE);
      return 2;
    }

    // CS-8: the kill switch is honored before anything else, dry runs included.
    if (!scansEnabled(env)) {
      log("Scans are disabled (SCANS_ENABLED=false). Nothing was run.");
      return 3;
    }

    const plan = planScan({
      category: loadCategory(values.category),
      country: parseCountry(values.country),
      questions: Number(values.questions),
      runs: Number(values.runs),
      engines: parseEngines(values.engines),
    });
    const dryRun = values["dry-run"];
    const maxCost = estimateMaxCostUsd(plan);
    log(`Plan: ${plan.category.slug} / ${plan.country}: ${plan.questions.length} questions × ${plan.runs} run(s) × ${plan.engines.length} engine(s) = ${plan.totalCalls} calls.`);
    log(`Worst-case cost: $${maxCost.toFixed(2)}${dryRun ? " (dry run: $0, fixtures only)" : ""}.`);

    if (!dryRun && !values.confirm) {
      log("Real run not started. Re-run with --confirm to spend up to the amount above, or use --dry-run.");
      return 4;
    }

    const adapters = (deps.createAdapters ?? createAdapters)(plan.engines, { dryRun, env });
    const result = await runScan(plan, adapters, deps.extractor ?? new AliasBrandExtractor(), { dryRun, now: deps.now, log });
    const report = buildReport(result);

    const outDir = resolve(values.out);
    mkdirSync(outDir, { recursive: true });
    const stamp = result.startedAt.replace(/[:.]/g, "-");
    const base = join(outDir, `scan-${plan.category.slug}-${plan.country.toLowerCase()}-${dryRun ? "dryrun-" : ""}${stamp}`);
    writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(`${base}.md`, toMarkdown(report));
    log(`Done: ${report.totals.ok}/${plan.totalCalls} calls ok, cost $${report.totals.costUsd.toFixed(4)}.`);
    log(`Wrote ${base}.json and ${base}.md`);
    return report.totals.ok > 0 ? 0 : 1;
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
