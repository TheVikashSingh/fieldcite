// Answer cache (CS-10): identical (engine, model, normalized question, country, run) answers are
// reused for 72 h across accounts. Engine and model are columns of answer_cache; the rest is
// hashed. Country is in the key because answers change by country (SPEC §8).

import { createHash } from "node:crypto";
import type { Queryable } from "../ledger";
import type { AnswerCache, CacheKey, CachedAnswer } from "../scan/run";

/** CS-10: how long a fresh answer is reused. The SQL in record_engine_call uses the same value. */
export const CACHE_TTL_HOURS = 72;

/**
 * Case, Unicode form, spacing and trailing punctuation don't change what an engine is asked,
 * so they don't change the key. Wording does.
 */
export function normalizeQuestion(question: string): string {
  return question
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s?!.]+$/, "");
}

/** Bump the version whenever normalization changes, so old entries stop matching. */
export function cacheKeyHash(key: Pick<CacheKey, "question" | "country" | "run">): string {
  return createHash("sha256").update(`v1\n${key.country}\n${key.run}\n${normalizeQuestion(key.question)}`).digest("hex");
}

export class PgAnswerCache implements AnswerCache {
  constructor(private readonly db: Queryable) {}

  async get(key: CacheKey, at: Date): Promise<CachedAnswer | null> {
    const { rows } = await this.db.query<{ answer_id: string; text: string; model: string; citations: { url: string; title: string | null }[] }>(
      "select * from public.answer_cache_lookup($1, $2, $3, $4)",
      [key.engine, key.model, cacheKeyHash(key), at],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      answerId: row.answer_id,
      text: row.text,
      model: row.model,
      citations: row.citations.map((c) => (c.title ? { url: c.url, title: c.title } : { url: c.url })),
    };
  }
}
