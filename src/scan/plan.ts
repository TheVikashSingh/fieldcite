// Scan planning: loads a category and checks the call budget before anything runs (CS-3, CS-5).

import { readFileSync } from "node:fs";
import { assertScanCallBudget, MAX_ANSWER_OUTPUT_TOKENS, MAX_TIMEOUT_MS } from "../engines/guard";
import { DEFAULT_MODELS, maxCostUsd } from "../engines/pricing";
import { COUNTRIES, ENGINE_IDS, type Country, type EngineId } from "../engines/types";
import type { Brand } from "../extract/brands";

export interface Category {
  slug: string;
  name: string;
  trade: string;
  brands: Brand[];
  questions: string[];
}

export interface ScanPlan {
  category: Category;
  country: Country;
  questions: string[];
  runs: number;
  engines: EngineId[];
  maxOutputTokens: number;
  timeoutMs: number;
  totalCalls: number;
}

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

export function loadCategory(slug: string): Category {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new PlanError(`Invalid category slug "${slug}" (use lowercase letters, digits and dashes).`);
  const file = new URL(`../../data/categories/${slug}.json`, import.meta.url);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new PlanError(`Unknown category "${slug}". Add data/categories/${slug}.json.`);
  }
  return JSON.parse(text) as Category;
}

export function parseCountry(value: string): Country {
  const c = value.trim().toUpperCase();
  if (!(COUNTRIES as readonly string[]).includes(c)) throw new PlanError(`--country must be one of ${COUNTRIES.join(", ")}; got "${value}".`);
  return c as Country;
}

export function parseEngines(value: string): EngineId[] {
  const list = [...new Set(value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const bad = list.filter((e) => !(ENGINE_IDS as readonly string[]).includes(e));
  if (bad.length || list.length === 0) throw new PlanError(`--engines must be a comma list of ${ENGINE_IDS.join(", ")}; got "${value}".`);
  return list as EngineId[];
}

function positiveInt(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new PlanError(`${name} must be a whole number of at least 1; got ${value}.`);
  return value;
}

export function planScan(input: { category: Category; country: Country; questions: number; runs: number; engines: EngineId[] }): ScanPlan {
  const n = positiveInt("--questions", input.questions);
  const runs = positiveInt("--runs", input.runs);
  if (n > input.category.questions.length) {
    throw new PlanError(`Category "${input.category.slug}" has ${input.category.questions.length} questions; asked for ${n}.`);
  }
  const totalCalls = n * runs * input.engines.length;
  assertScanCallBudget(totalCalls); // CS-5: refuses more than 150 calls.
  return {
    category: input.category,
    country: input.country,
    questions: input.category.questions.slice(0, n),
    runs,
    engines: input.engines,
    maxOutputTokens: MAX_ANSWER_OUTPUT_TOKENS,
    timeoutMs: MAX_TIMEOUT_MS,
    totalCalls,
  };
}

/** Worst-case spend for the plan, shown before any call is made. */
export function estimateMaxCostUsd(plan: ScanPlan): number {
  const perRound = plan.engines.reduce((sum, e) => sum + maxCostUsd(DEFAULT_MODELS[e], plan.maxOutputTokens), 0);
  return Math.round(perRound * plan.questions.length * plan.runs * 100) / 100;
}
