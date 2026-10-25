// Magic-link storage against a real Postgres (SPEC F-9). Runs in CI's db-test job and is
// skipped when DATABASE_URL is unset. See the README for running it locally.

import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryMailer } from "../email/mailer";
import { confirmMagicLink, sendMagicLink } from "./magic-link";
import { PgAuthStore } from "./pg-store";
import { hashToken, newToken } from "./tokens";

const url = process.env.DATABASE_URL;
if (!url && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL is not set");
if (url && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) throw new Error("Database tests only run against a local Postgres");

let pool: pg.Pool;
const uniqueEmail = () => `owner-${randomUUID().slice(0, 8)}@vendor.test`;

describe.skipIf(!url)("magic-link auth (Postgres)", () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("signs in once per link and creates one user and one account per address", async () => {
    const store = new PgAuthStore(pool);
    const mailer = new MemoryMailer();
    const email = uniqueEmail();
    const deps = { store, mailer, baseUrl: "http://localhost:3000" };

    await sendMagicLink(deps, { email, purpose: "login" });
    const first = new URL(mailer.lastLinkTo(email)!).searchParams.get("token")!;
    const a = await confirmMagicLink(deps, first);
    expect(a).toMatchObject({ email, purpose: "login" });
    expect(await confirmMagicLink(deps, first)).toBeNull();

    await sendMagicLink(deps, { email, purpose: "login" });
    const b = await confirmMagicLink(deps, new URL(mailer.lastLinkTo(email)!).searchParams.get("token")!);
    expect(b?.userId).toBe(a?.userId);
    expect(b?.accountId).toBe(a?.accountId);

    const { rows } = await pool.query<{ n: number; verified: boolean }>(
      "select count(*)::int as n, bool_and(email_verified_at is not null) as verified from public.users where email = $1",
      [email],
    );
    expect(rows[0]).toEqual({ n: 1, verified: true });
    expect(await store.countLinksSince(email, new Date(Date.now() - 60_000))).toBe(2);
  });

  it("lets only one of two simultaneous confirmations through", async () => {
    const store = new PgAuthStore(pool);
    const token = newToken();
    const now = new Date();
    await store.createLink({ tokenHash: hashToken(token), email: uniqueEmail(), purpose: "login", payload: {}, expiresAt: new Date(now.getTime() + 60_000), createdAt: now });
    const results = await Promise.all([store.consumeLink(hashToken(token), new Date()), store.consumeLink(hashToken(token), new Date())]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses expired links and keeps tokens out of the table", async () => {
    const store = new PgAuthStore(pool);
    const token = newToken();
    const created = new Date(Date.now() - 20 * 60_000);
    await store.createLink({ tokenHash: hashToken(token), email: uniqueEmail(), purpose: "login", payload: {}, expiresAt: new Date(created.getTime() + 15 * 60_000), createdAt: created });
    expect(await store.consumeLink(hashToken(token), new Date())).toBeNull();
    const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from public.magic_links where payload::text like $1 or email like $1", [`%${token}%`]);
    expect(rows[0].n).toBe(0);
  });

  it("is not readable by client roles", async () => {
    const { rows } = await pool.query<{ users: boolean; links: boolean }>(
      "select has_table_privilege('anon', 'public.users', 'select') as users, has_table_privilege('authenticated', 'public.magic_links', 'select') as links",
    );
    expect(rows[0]).toEqual({ users: false, links: false });
  });
});
