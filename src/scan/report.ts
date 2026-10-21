// Builds the JSON and Markdown scan reports (SPEC F-2, §8).

import { PRICES_CHECKED_ON } from "../engines/pricing";
import { COUNTRY_NAMES, type EngineId } from "../engines/types";
import { PAGE_TYPES, type PageType } from "../extract/classify";
import type { ScanResult } from "./run";

export const METHOD_NOTE =
  "Results come from each engine's official API with web search enabled. This approximates, but does not exactly match, what people see in the consumer apps. AI answers vary between runs.";

export interface ShareOfVoiceRow {
  brand: string;
  /** Answers mentioning the brand / answers received, per engine. */
  byEngine: Partial<Record<EngineId, { mentioned: number; answers: number }>>;
  mentioned: number;
  answers: number;
  /** Average position when mentioned (1 = named first). */
  avgPosition: number | null;
}

export interface CitedPageRow {
  url: string;
  domain: string;
  pageType: PageType;
  owner?: string;
  title?: string;
  /** Number of answers citing this page. */
  citedIn: number;
  engines: EngineId[];
  /** Brands named in the answers that cite this page. */
  brandsInAnswers: string[];
}

export interface ScanReport {
  generatedAt: string;
  dryRun: boolean;
  category: { slug: string; name: string };
  country: string;
  engines: { id: EngineId; model: string }[];
  questions: string[];
  runs: number;
  method: string;
  pricesCheckedOn: string;
  totals: { plannedCalls: number; ok: number; errors: number; skipped: number; costUsd: number; stoppedReason?: string };
  shareOfVoice: ShareOfVoiceRow[];
  citedPages: CitedPageRow[];
  pageTypeCounts: Record<PageType, number>;
  calls: ScanResult["calls"];
}

export function buildReport(result: ScanResult): ScanReport {
  const { plan, calls } = result;
  const ok = calls.filter((c) => c.status === "ok");

  const answersPerEngine = new Map<EngineId, number>();
  for (const c of ok) answersPerEngine.set(c.engine, (answersPerEngine.get(c.engine) ?? 0) + 1);

  const shareOfVoice: ShareOfVoiceRow[] = plan.category.brands.map((b) => {
    const byEngine: ShareOfVoiceRow["byEngine"] = {};
    const positions: number[] = [];
    for (const engine of plan.engines) {
      const engineCalls = ok.filter((c) => c.engine === engine);
      const hits = engineCalls.filter((c) => c.mentions.some((m) => m.brand === b.name));
      byEngine[engine] = { mentioned: hits.length, answers: engineCalls.length };
      for (const h of hits) positions.push(h.mentions.find((m) => m.brand === b.name)!.position);
    }
    const mentioned = positions.length;
    return {
      brand: b.name,
      byEngine,
      mentioned,
      answers: ok.length,
      avgPosition: mentioned ? Math.round((positions.reduce((s, p) => s + p, 0) / mentioned) * 10) / 10 : null,
    };
  });
  shareOfVoice.sort((a, b) => b.mentioned - a.mentioned || (a.avgPosition ?? 99) - (b.avgPosition ?? 99) || a.brand.localeCompare(b.brand));

  const pages = new Map<string, CitedPageRow & { brandSet: Set<string>; engineSet: Set<EngineId> }>();
  for (const c of ok) {
    for (const cite of c.citations) {
      const row =
        pages.get(cite.url) ??
        { url: cite.url, domain: cite.domain, pageType: cite.pageType, owner: cite.owner, title: cite.title, citedIn: 0, engines: [], brandsInAnswers: [], brandSet: new Set<string>(), engineSet: new Set<EngineId>() };
      row.citedIn++;
      row.engineSet.add(c.engine);
      for (const m of c.mentions) row.brandSet.add(m.brand);
      pages.set(cite.url, row);
    }
  }
  const citedPages: CitedPageRow[] = [...pages.values()]
    .map(({ brandSet, engineSet, ...row }) => ({ ...row, engines: [...engineSet], brandsInAnswers: [...brandSet].sort() }))
    .sort((a, b) => b.citedIn - a.citedIn || a.domain.localeCompare(b.domain));

  const pageTypeCounts = Object.fromEntries(PAGE_TYPES.map((t) => [t, 0])) as Record<PageType, number>;
  for (const p of citedPages) pageTypeCounts[p.pageType]++;

  const engineModels = new Map<EngineId, string>();
  for (const c of calls) if (c.model && !engineModels.has(c.engine)) engineModels.set(c.engine, c.model);

  return {
    generatedAt: result.finishedAt,
    dryRun: result.dryRun,
    category: { slug: plan.category.slug, name: plan.category.name },
    country: plan.country,
    engines: plan.engines.map((id) => ({ id, model: engineModels.get(id) ?? "" })),
    questions: plan.questions,
    runs: plan.runs,
    method: METHOD_NOTE,
    pricesCheckedOn: PRICES_CHECKED_ON,
    totals: {
      plannedCalls: plan.totalCalls,
      ok: ok.length,
      errors: calls.filter((c) => c.status === "error").length,
      skipped: calls.filter((c) => c.status === "skipped").length,
      costUsd: result.totalCostUsd,
      stoppedReason: result.stoppedReason,
    },
    shareOfVoice,
    citedPages,
    pageTypeCounts,
    calls,
  };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export function toMarkdown(r: ScanReport): string {
  const lines: string[] = [];
  lines.push(`# ${r.category.name}: who AI recommends in ${COUNTRY_NAMES[r.country as keyof typeof COUNTRY_NAMES] ?? r.country}`, "");
  if (r.dryRun) lines.push("> **Dry run.** These are synthetic fixture responses, not real engine answers. No API calls were made.", ">");
  lines.push(`> **Method.** ${r.method}`, "");
  lines.push(
    `Generated ${r.generatedAt}. Engines: ${r.engines.map((e) => `${e.id} (${e.model})`).join(", ")}. ` +
      `${r.questions.length} questions × ${r.runs} run(s). Calls: ${r.totals.ok} ok, ${r.totals.errors} failed, ${r.totals.skipped} skipped of ${r.totals.plannedCalls}. ` +
      `Cost: $${r.totals.costUsd.toFixed(4)} (prices checked ${r.pricesCheckedOn}).`,
    "",
  );
  if (r.totals.stoppedReason) lines.push(`**Stopped early:** ${r.totals.stoppedReason}`, "");

  lines.push("## Share of voice", "");
  const engines = r.engines.map((e) => e.id);
  lines.push(`| Brand | ${engines.join(" | ")} | Total | Avg position |`, `|---|${engines.map(() => "---|").join("")}---|---|`);
  for (const row of r.shareOfVoice) {
    const perEngine = engines.map((e) => {
      const v = row.byEngine[e];
      return v ? `${v.mentioned}/${v.answers}` : "-";
    });
    lines.push(`| ${cell(row.brand)} | ${perEngine.join(" | ")} | ${row.mentioned}/${row.answers} | ${row.avgPosition ?? "-"} |`);
  }
  lines.push("");

  lines.push("## Cited pages", "");
  lines.push(`Page types: ${PAGE_TYPES.map((t) => `${t.replace("_", " ")} ${r.pageTypeCounts[t]}`).join(" · ")}`, "");
  lines.push("| Page | Type | Owner | Cited in | Engines | Brands in those answers |", "|---|---|---|---|---|---|");
  for (const p of r.citedPages) {
    const label = cell(p.title && p.title !== p.domain ? `${p.title} (${p.domain})` : p.domain);
    lines.push(`| [${label}](${p.url}) | ${p.pageType.replace("_", " ")} | ${cell(p.owner ?? "")} | ${p.citedIn} | ${p.engines.join(", ")} | ${cell(p.brandsInAnswers.join(", "))} |`);
  }
  lines.push("");

  lines.push("## Answers", "");
  r.questions.forEach((q, qi) => {
    lines.push(`### Q${qi + 1}. ${q}`, "");
    for (const c of r.calls.filter((x) => x.questionIndex === qi)) {
      const head = `**${c.engine}** (run ${c.run})`;
      if (c.status !== "ok") {
        lines.push(`- ${head}: ${c.status}: ${cell(c.error ?? "")}`);
        continue;
      }
      const brands = c.mentions.map((m) => `${m.position}. ${m.brand}`).join(", ") || "no tracked brands";
      lines.push(`- ${head}: ${brands}. ${c.citations.length} citations. $${c.costUsd.toFixed(4)}`);
    }
    lines.push("");
  });

  return `${lines.join("\n").trimEnd()}\n`;
}
