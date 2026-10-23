// Records each engine call through record_engine_call() (supabase/migrations), which writes in
// one transaction: the engine_calls cost record (CS-9), charged to the scan's reservation by a
// trigger so a scan can't record more calls than it reserved (CS-4); its spend_daily rollup;
// the answer, citations and brand mentions (M-1); and, for fresh answers, the cache entry (CS-10).

import { cacheKeyHash } from "../cost/cache";
import type { Brand } from "../extract/brands";
import type { CallRecord, ScanStorage } from "../scan/run";
import { mapLedgerError, type Queryable } from "./index";

export class PgScanStorage implements ScanStorage {
  private readonly domains: Map<string, string>;

  constructor(
    private readonly db: Queryable,
    readonly scanId: string,
    /** The category's brands, to store mentions against brand rows (matched by domain). */
    opts: { brands?: Brand[] } = {},
  ) {
    this.domains = new Map((opts.brands ?? []).flatMap((b) => (b.domain ? [[b.name, b.domain] as const] : [])));
  }

  async recordCall(record: CallRecord): Promise<void> {
    // Skipped calls were never made, so there is nothing to charge.
    if (record.status === "skipped") return;
    const ok = record.status === "ok";
    const cacheable = ok && !record.cacheHit && record.adapterModel && record.country;
    const payload = {
      scan_id: this.scanId,
      engine: record.engine,
      model: record.model,
      question_text: record.question,
      run: record.run,
      input_tokens: record.usage.inputTokens,
      output_tokens: record.usage.outputTokens,
      search_calls: record.usage.searchCalls,
      cost_usd: record.costUsd,
      latency_ms: record.latencyMs,
      attempts: record.attempts,
      status: record.status,
      error: record.error ?? null,
      cache_hit: record.cacheHit ?? false,
      created_at: record.at ?? null,
      answer: ok ? { text: record.text, raw: record.raw ?? null, cached_from_answer_id: record.cachedAnswerId ?? null } : null,
      citations: record.citations.map((c, i) => ({ url: c.url, title: c.title ?? null, domain: c.domain, position: i + 1 })),
      mentions: record.mentions.map((m) => ({ brand: m.brand, domain: this.domains.get(m.brand) ?? null, position: m.position })),
      cache: cacheable
        ? { model: record.adapterModel, hash: cacheKeyHash({ question: record.question, country: record.country!, run: record.run }) }
        : null,
    };
    try {
      await this.db.query("select public.record_engine_call($1::jsonb)", [JSON.stringify(payload)]);
    } catch (err) {
      mapLedgerError(err);
    }
  }
}
