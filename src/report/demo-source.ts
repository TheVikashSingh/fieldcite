// Sample report for /r/demo, built from the synthetic fixtures through the same dry-run path as
// `npm run scan -- --dry-run`: real adapters, a fixture-backed fetch, no network and no API key.
// The category and fixtures are imported rather than read from disk, so the built page has them.

import "server-only";
import pestControl from "../../data/categories/pest-control.json";
import gemini from "../../fixtures/engines/gemini.json";
import openai from "../../fixtures/engines/openai.json";
import perplexity from "../../fixtures/engines/perplexity.json";
import { createAdapters } from "../engines";
import { ENGINE_IDS } from "../engines/types";
import { AliasBrandExtractor } from "../extract/brands";
import { planScan, type Category } from "../scan/plan";
import { buildReport, type ScanReport } from "../scan/report";
import { runScan } from "../scan/run";
import { withoutRaw, type ReportSource } from "./source";

export const DEMO_TOKEN = "demo";

/** Same shape as a free scan (F-1): 5 questions × 3 engines × 1 run. */
const DEMO_PLAN = { country: "US", questions: 5, runs: 1, brand: "Briostack" } as const;
const FIXTURES = { openai: openai.responses, perplexity: perplexity.responses, gemini: gemini.responses };
/** Fixed clock so the sample page is the same on every build. */
const DEMO_TIME = new Date("2026-11-09T12:00:00Z");

export async function buildDemoReport(): Promise<ScanReport> {
  const plan = planScan({
    category: pestControl as Category,
    country: DEMO_PLAN.country,
    questions: DEMO_PLAN.questions,
    runs: DEMO_PLAN.runs,
    engines: [...ENGINE_IDS],
    targetBrand: DEMO_PLAN.brand,
  });
  // An empty env: the dry-run adapters never read a key, and this keeps it that way. The kill
  // switch (CS-8) guards engine calls; a fixture run makes none.
  const env = {};
  const adapters = createAdapters(plan.engines, { dryRun: true, env, fixtures: FIXTURES });
  let tick = 0;
  const now = () => new Date(DEMO_TIME.getTime() + 1000 * tick++);
  const result = await runScan(plan, adapters, new AliasBrandExtractor(), { dryRun: true, now, env });
  return withoutRaw(buildReport(result));
}

export class DemoReportSource implements ReportSource {
  async get(token: string): Promise<ScanReport | null> {
    return token === DEMO_TOKEN ? buildDemoReport() : null;
  }
}
