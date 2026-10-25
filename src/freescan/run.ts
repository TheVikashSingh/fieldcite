// Runs a verified free scan (SPEC F-1): 5 questions × 3 engines × 1 run = 15 calls, through
// the same guarded path as every scan: kill switch and breakers before each call (CS-7, CS-8),
// each call charged to the reservation and logged with its cost (CS-4, CS-9), and the answer
// cache (CS-10). The report is stored behind the request's share token and emailed.

import gemini from "../../fixtures/engines/gemini.json";
import openai from "../../fixtures/engines/openai.json";
import perplexity from "../../fixtures/engines/perplexity.json";
import { PgAnswerCache } from "../cost/cache";
import { PgCallGate } from "../cost/breakers";
import type { Notifier } from "../cost/notifier";
import type { Mailer } from "../email/mailer";
import { createAdapters } from "../engines";
import type { Env } from "../engines/guard";
import { ENGINE_IDS } from "../engines/types";
import { AliasBrandExtractor, type Brand } from "../extract/brands";
import { finishScan, type Queryable } from "../ledger";
import { PgScanStorage } from "../ledger/scan-storage";
import { saveReport } from "../report/pg-source";
import { planScan, type Category } from "../scan/plan";
import { buildReport } from "../scan/report";
import { runScan } from "../scan/run";
import { findCategory } from "./categories";
import type { PgFreeScanStore } from "./pg-store";
import { FREE_SCAN } from "./request";

export type EngineMode = "live" | "fixtures";

/**
 * "fixtures" runs the real adapters against canned responses: no network, no cost, and the
 * report says it's sample data. Production always runs live.
 */
export function engineMode(env: Env = process.env): EngineMode {
  if (env.NODE_ENV === "production") return "live";
  return env.ENGINE_MODE === "live" ? "live" : "fixtures";
}

const FIXTURES = { openai: openai.responses, perplexity: perplexity.responses, gemini: gemini.responses };

/** The category's brands plus the customer's, matched by domain or name when already listed. */
export function withCustomerBrand(category: Category, brandName: string, domain: string): { category: Category; target: string } {
  const lower = brandName.toLowerCase();
  const existing = category.brands.find(
    (b) => (b.domain && b.domain.toLowerCase().replace(/^www\./, "") === domain) || [b.name, ...(b.aliases ?? [])].some((n) => n.toLowerCase() === lower),
  );
  if (existing) return { category, target: existing.name };
  const customer: Brand = { name: brandName, domain };
  return { category: { ...category, brands: [...category.brands, customer] }, target: brandName };
}

export interface RunFreeScanDeps {
  pool: Queryable;
  store: PgFreeScanStore;
  mailer: Mailer;
  notifier: Notifier;
  baseUrl: string;
  env?: Env;
  now?: () => Date;
  log?: (line: string) => void;
}

export async function runFreeScan(deps: RunFreeScanDeps, input: { requestId: string; scanId: string; reportToken: string }): Promise<"completed" | "failed"> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const request = await deps.store.getRequest(input.requestId);
  try {
    if (!request) throw new Error(`free scan request ${input.requestId} not found`);
    const base = findCategory(request.category_slug);
    if (!base) throw new Error(`unknown category ${request.category_slug}`);
    const { category, target } = withCustomerBrand(base, request.brand_name, request.domain);
    const plan = planScan({ category, country: request.country, questions: FREE_SCAN.questions, runs: FREE_SCAN.runs, engines: [...ENGINE_IDS], targetBrand: target });

    const mode = engineMode(env);
    const adapters = createAdapters(plan.engines, { dryRun: mode === "fixtures", env, fixtures: FIXTURES });
    const result = await runScan(plan, adapters, new AliasBrandExtractor(), {
      dryRun: mode === "fixtures",
      env,
      now,
      log: deps.log,
      storage: new PgScanStorage(deps.pool, input.scanId, { brands: category.brands }),
      gate: new PgCallGate(deps.pool, input.scanId, deps.notifier, { env }),
      cache: new PgAnswerCache(deps.pool),
    });
    if (!result.calls.some((c) => c.status === "ok")) throw new Error(result.stoppedReason ?? "no engine answered");

    await saveReport(deps.pool, input.scanId, buildReport(result), input.reportToken);
    await finishScan(deps.pool, input.scanId, "completed");
    await deps.store.finish(input.requestId, "completed", null, now());
    const url = `${deps.baseUrl.replace(/\/+$/, "")}/r/${input.reportToken}`;
    await deps.mailer.send({
      to: request.email,
      subject: "Your FieldCite report is ready",
      text: `Your free scan for ${request.brand_name} is ready:\n\n${url}\n\nThe link is private: anyone with it can see the report, so share it only with your team.`,
      html: `<p>Your free scan for ${escapeHtml(request.brand_name)} is ready.</p><p><a href="${url}">Open your report</a></p><p>The link is private: anyone with it can see the report, so share it only with your team.</p>`,
    });
    return "completed";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (deps.log ?? ((l: string) => console.error(l)))(`free scan ${input.requestId} failed: ${message}`);
    // Refunds the unused calls (CS-4). Ignore "not running": the scan may already be settled.
    await finishScan(deps.pool, input.scanId, "failed").catch(() => {});
    await deps.store.finish(input.requestId, "failed", message.slice(0, 500), now());
    return "failed";
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
