// Share-link lookups: an unknown, malformed or revoked token gets the same 404, and nothing in
// the response says whether a token exists (SPEC F-2).

import { afterEach, describe, expect, it, vi } from "vitest";
import SharedReportPage from "../app/r/[token]/page";
import type { Queryable } from "../ledger";
import type { ScanReport } from "../scan/report";
import { DemoReportSource } from "./demo-source";
import { isShareToken, newShareToken, PgReportSource } from "./pg-source";
import { loadReportOr404, shareLinkSource } from "./server";

/** What next/navigation's notFound() throws; Next.js renders it as the 404 page. */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

function fakeDb(rows: Record<string, unknown>[] = []) {
  const queries: unknown[][] = [];
  const db: Queryable = {
    query: async <R extends object>(_text: string, values?: unknown[]) => {
      queries.push(values ?? []);
      return { rows: rows as R[] };
    },
  };
  return { db, queries };
}

afterEach(() => vi.unstubAllEnvs());

describe("share tokens", () => {
  it("are 32 url-safe characters and unique", () => {
    const tokens = new Set(Array.from({ length: 200 }, newShareToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(isShareToken(t)).toBe(true);
    expect(isShareToken("demo")).toBe(false);
    expect(isShareToken(`${newShareToken()}x`)).toBe(false);
  });
});

describe("PgReportSource", () => {
  it("looks up the token's SHA-256, never the token itself", async () => {
    const { db, queries } = fakeDb();
    const token = newShareToken();
    expect(await new PgReportSource(db).get(token)).toBeNull();
    expect(queries).toHaveLength(1);
    const [hash] = queries[0] as [Buffer];
    expect(Buffer.isBuffer(hash) && hash.length).toBe(32);
    expect(hash.toString("utf8")).not.toContain(token);
  });

  it("returns null without a query for malformed tokens", async () => {
    const { db, queries } = fakeDb([{ report: {} }]);
    for (const t of ["", "demo", "../etc/passwd", "a".repeat(33), `${"a".repeat(31)}!`]) {
      expect(await new PgReportSource(db).get(t)).toBeNull();
    }
    expect(queries).toHaveLength(0);
  });

  it("returns the stored report for a known token", async () => {
    const report = { category: { slug: "x", name: "X" } } as ScanReport;
    const { db } = fakeDb([{ report }]);
    expect(await new PgReportSource(db).get(newShareToken())).toBe(report);
  });
});

describe("404 path", () => {
  it("throws the same not-found for unknown and malformed tokens", async () => {
    const { db } = fakeDb();
    const source = new PgReportSource(db);
    const errors = await Promise.all(
      [newShareToken(), "nope", ""].map((t) => loadReportOr404(source, t).then(() => null, (e: unknown) => e)),
    );
    for (const e of errors) expect(e).toMatchObject(NOT_FOUND);
    const [first, ...rest] = errors.map((e) => JSON.stringify({ ...(e as object), message: (e as Error).message }));
    for (const r of rest) expect(r).toBe(first);
  });

  it("answers every token with 404 when no database is configured", async () => {
    await expect(loadReportOr404(shareLinkSource({}), newShareToken())).rejects.toMatchObject(NOT_FOUND);
    vi.stubEnv("DATABASE_URL", "");
    await expect(SharedReportPage({ params: Promise.resolve({ token: newShareToken() }) })).rejects.toMatchObject(NOT_FOUND);
  });

  it("serves the sample report only under the demo token", async () => {
    const demo = new DemoReportSource();
    expect(await demo.get("demo")).not.toBeNull();
    await expect(loadReportOr404(demo, newShareToken())).rejects.toMatchObject(NOT_FOUND);
  });
});
