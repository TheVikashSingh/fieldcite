// Writes each engine call's cost record to engine_calls (CS-9). An insert trigger charges
// the call to the scan's reservation, so a scan can't record more calls than it reserved
// (CS-4), and nothing can be recorded after the scan has finished.

import type { CallRecord, ScanStorage } from "../scan/run";
import { mapLedgerError, type Queryable } from "./index";

export class PgScanStorage implements ScanStorage {
  constructor(
    private readonly db: Queryable,
    readonly scanId: string,
  ) {}

  async recordCall(record: CallRecord): Promise<void> {
    // Skipped calls were never made, so there is nothing to charge.
    if (record.status === "skipped") return;
    try {
      await this.db.query(
        `insert into public.engine_calls
           (scan_id, engine, model, question_text, run, input_tokens, output_tokens, search_calls,
            cost_usd, latency_ms, attempts, status, error, cache_hit)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false)`,
        [
          this.scanId,
          record.engine,
          record.model,
          record.question,
          record.run,
          record.usage.inputTokens,
          record.usage.outputTokens,
          record.usage.searchCalls,
          record.costUsd,
          record.latencyMs,
          record.attempts,
          record.status,
          record.error ?? null,
        ],
      );
    } catch (err) {
      mapLedgerError(err);
    }
  }
}
