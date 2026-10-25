// cited_pages enrichment upsert against a real Postgres (SPEC M-2). Runs in CI's db-test job
// and is skipped when DATABASE_URL is unset. See the README for running it locally.

import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgCitedPageStore } from "./storage";

const url = process.env.DATABASE_URL;
if (!url && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL is not set");
if (url && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) throw new Error("Database tests only run against a local Postgres");

let pool: pg.Pool;
const pageUrl = () => `https://enrich-${randomUUID()}.test/best-software`;

describe.skipIf(!url)("PgCitedPageStore", () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("inserts a new page with every enriched field", async () => {
    const store = new PgCitedPageStore(pool);
    const u = pageUrl();
    const at = new Date("2026-11-16T12:00:00Z");
    const saved = await store.upsertEnrichment({
      url: u,
      domain: new URL(u).hostname,
      pageType: "listicle",
      publisher: "Fresh Publisher",
      contactUrl: `${new URL(u).origin}/contact`,
      submissionUrl: `${new URL(u).origin}/get-listed`,
      sponsorshipUrl: `${new URL(u).origin}/advertise`,
      affiliateProgram: true,
      brandsMentioned: ["Jobber", "GorillaDesk"],
      fetchedAt: at,
    });
    expect(saved).toMatchObject({ publisher: "Fresh Publisher", affiliateProgram: true, brandsMentioned: ["Jobber", "GorillaDesk"], curatorNotes: null });
    expect(saved.lastFetchedAt?.toISOString()).toBe(at.toISOString());
    expect(await store.get(u)).toEqual(saved);
  });

  it("fills only empty fields and never touches curator columns", async () => {
    const store = new PgCitedPageStore(pool);
    const u = pageUrl();
    // A row as record_engine_call creates it (url + empty domain), then edited by a curator.
    await pool.query(
      `insert into public.cited_pages (url, domain, publisher, affiliate_program, brands_mentioned, sponsorship_price, curator_notes, outreach_outcome, last_fetched_at)
       values ($1, '', 'Curated Name', false, '{Jobber}', '$450', 'Replies in a week', 'listed', '2026-12-01T00:00:00Z')`,
      [u],
    );
    const saved = await store.upsertEnrichment({
      url: u,
      domain: new URL(u).hostname,
      pageType: "listicle",
      publisher: "Fresh Publisher",
      contactUrl: `${new URL(u).origin}/contact`,
      affiliateProgram: true,
      brandsMentioned: ["GorillaDesk"],
      fetchedAt: new Date("2026-11-16T12:00:00Z"),
    });
    expect(saved).toMatchObject({
      domain: new URL(u).hostname,
      pageType: "listicle",
      publisher: "Curated Name",
      contactUrl: `${new URL(u).origin}/contact`,
      submissionUrl: null,
      affiliateProgram: false,
      brandsMentioned: ["Jobber"],
      sponsorshipPrice: "$450",
      curatorNotes: "Replies in a week",
      outreachOutcome: "listed",
    });
    // last_fetched_at never moves backwards.
    expect(saved.lastFetchedAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("returns null for an unknown page", async () => {
    expect(await new PgCitedPageStore(pool).get(pageUrl())).toBeNull();
  });
});
