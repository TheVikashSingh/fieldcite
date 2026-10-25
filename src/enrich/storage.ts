// cited_pages storage for enrichment (SPEC M-2, §6.2). Enrichment only fills empty fields, so a
// curator's edits are never overwritten; curator_notes, outreach_outcome and sponsorship_price
// are never written here at all. The table's contents stay in Postgres, never in the repo.

import type { Queryable } from "../ledger";

export interface CitedPageRecord {
  url: string;
  domain: string;
  pageType: string | null;
  publisher: string | null;
  contactUrl: string | null;
  submissionUrl: string | null;
  sponsorshipUrl: string | null;
  sponsorshipPrice: string | null;
  affiliateProgram: boolean | null;
  brandsMentioned: string[];
  lastFetchedAt: Date | null;
  curatorNotes: string | null;
  outreachOutcome: string | null;
}

export interface EnrichmentInput {
  url: string;
  domain: string;
  pageType?: string;
  publisher?: string;
  contactUrl?: string;
  submissionUrl?: string;
  sponsorshipUrl?: string;
  affiliateProgram?: boolean;
  brandsMentioned?: string[];
  /** When the fetch was attempted, successful or not (the 30-day re-fetch rule reads it). */
  fetchedAt: Date;
}

export interface CitedPageStore {
  get(url: string): Promise<CitedPageRecord | null>;
  /** Inserts the page or fills its empty fields. Returns the stored row. */
  upsertEnrichment(input: EnrichmentInput): Promise<CitedPageRecord>;
}

const empty = (url: string, domain: string): CitedPageRecord => ({
  url,
  domain,
  pageType: null,
  publisher: null,
  contactUrl: null,
  submissionUrl: null,
  sponsorshipUrl: null,
  sponsorshipPrice: null,
  affiliateProgram: null,
  brandsMentioned: [],
  lastFetchedAt: null,
  curatorNotes: null,
  outreachOutcome: null,
});

/** The fill-only-empty rule. The Postgres store implements the same rule in SQL. */
export function mergeEnrichment(existing: CitedPageRecord | null, input: EnrichmentInput): CitedPageRecord {
  const row = existing ? { ...existing, brandsMentioned: [...existing.brandsMentioned] } : empty(input.url, input.domain);
  row.domain ||= input.domain;
  row.pageType ??= input.pageType ?? null;
  row.publisher ??= input.publisher ?? null;
  row.contactUrl ??= input.contactUrl ?? null;
  row.submissionUrl ??= input.submissionUrl ?? null;
  row.sponsorshipUrl ??= input.sponsorshipUrl ?? null;
  row.affiliateProgram ??= input.affiliateProgram ?? null;
  if (row.brandsMentioned.length === 0) row.brandsMentioned = [...(input.brandsMentioned ?? [])];
  if (!row.lastFetchedAt || input.fetchedAt > row.lastFetchedAt) row.lastFetchedAt = input.fetchedAt;
  return row;
}

export class MemoryCitedPageStore implements CitedPageStore {
  readonly rows = new Map<string, CitedPageRecord>();

  constructor(seed: CitedPageRecord[] = []) {
    for (const r of seed) this.rows.set(r.url, r);
  }

  async get(url: string): Promise<CitedPageRecord | null> {
    return this.rows.get(url) ?? null;
  }

  async upsertEnrichment(input: EnrichmentInput): Promise<CitedPageRecord> {
    const row = mergeEnrichment(this.rows.get(input.url) ?? null, input);
    this.rows.set(input.url, row);
    return row;
  }
}

interface Row {
  url: string;
  domain: string;
  page_type: string | null;
  publisher: string | null;
  contact_url: string | null;
  submission_url: string | null;
  sponsorship_url: string | null;
  sponsorship_price: string | null;
  affiliate_program: boolean | null;
  brands_mentioned: string[];
  last_fetched_at: Date | null;
  curator_notes: string | null;
  outreach_outcome: string | null;
}

const COLUMNS =
  "url, domain, page_type, publisher, contact_url, submission_url, sponsorship_url, sponsorship_price, affiliate_program, brands_mentioned, last_fetched_at, curator_notes, outreach_outcome";

const fromRow = (r: Row): CitedPageRecord => ({
  url: r.url,
  domain: r.domain,
  pageType: r.page_type,
  publisher: r.publisher,
  contactUrl: r.contact_url,
  submissionUrl: r.submission_url,
  sponsorshipUrl: r.sponsorship_url,
  sponsorshipPrice: r.sponsorship_price,
  affiliateProgram: r.affiliate_program,
  brandsMentioned: r.brands_mentioned,
  lastFetchedAt: r.last_fetched_at,
  curatorNotes: r.curator_notes,
  outreachOutcome: r.outreach_outcome,
});

/** Needs a service-role connection: cited_pages has no client policies. */
export class PgCitedPageStore implements CitedPageStore {
  constructor(private readonly db: Queryable) {}

  async get(url: string): Promise<CitedPageRecord | null> {
    const { rows } = await this.db.query<Row>(`select ${COLUMNS} from public.cited_pages where url = $1`, [url]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async upsertEnrichment(input: EnrichmentInput): Promise<CitedPageRecord> {
    const { rows } = await this.db.query<Row>(
      `insert into public.cited_pages as cp
         (url, domain, page_type, publisher, contact_url, submission_url, sponsorship_url, affiliate_program, brands_mentioned, last_fetched_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (url) do update set
         domain = case when cp.domain = '' then excluded.domain else cp.domain end,
         page_type = coalesce(cp.page_type, excluded.page_type),
         publisher = coalesce(cp.publisher, excluded.publisher),
         contact_url = coalesce(cp.contact_url, excluded.contact_url),
         submission_url = coalesce(cp.submission_url, excluded.submission_url),
         sponsorship_url = coalesce(cp.sponsorship_url, excluded.sponsorship_url),
         affiliate_program = coalesce(cp.affiliate_program, excluded.affiliate_program),
         brands_mentioned = case when cardinality(cp.brands_mentioned) = 0 then excluded.brands_mentioned else cp.brands_mentioned end,
         last_fetched_at = greatest(cp.last_fetched_at, excluded.last_fetched_at),
         updated_at = now()
       returning ${COLUMNS}`,
      [
        input.url,
        input.domain,
        input.pageType ?? null,
        input.publisher ?? null,
        input.contactUrl ?? null,
        input.submissionUrl ?? null,
        input.sponsorshipUrl ?? null,
        input.affiliateProgram ?? null,
        input.brandsMentioned ?? [],
        input.fetchedAt,
      ],
    );
    return fromRow(rows[0]);
  }
}
