// Server wiring for free scans (SPEC F-1). Server-side only: reads DATABASE_URL, AUTH_SECRET and
// the Turnstile secret (CS-12).

import "server-only";
import { authSecret } from "../auth/session";
import { magicLinkDeps } from "../auth/server";
import { LogNotifier } from "../cost/notifier";
import { mailerFromEnv } from "../email/mailer";
import { appUrl, getDb } from "../server/db";
import { PgFreeScanStore } from "./pg-store";
import type { FreeScanDeps } from "./request";
import type { RunFreeScanDeps } from "./run";
import { turnstileFromEnv } from "./turnstile";

/** The client IP as the hosting proxy reports it (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || null;
}

/** Form dependencies, or null when free scans aren't configured (no database). */
export function freeScanDeps(): FreeScanDeps | null {
  const db = getDb();
  const magicLinks = magicLinkDeps();
  if (!db || !magicLinks) return null;
  return { store: new PgFreeScanStore(db), turnstile: turnstileFromEnv(), magicLinks, ipHashKey: authSecret() };
}

export function runFreeScanDeps(): RunFreeScanDeps | null {
  const db = getDb();
  if (!db) return null;
  return { pool: db, store: new PgFreeScanStore(db), mailer: mailerFromEnv(), notifier: new LogNotifier(), baseUrl: appUrl() };
}

export function freeScanStore(): PgFreeScanStore | null {
  const db = getDb();
  return db ? new PgFreeScanStore(db) : null;
}

/** Shown on the form only when Turnstile is configured; the site key is public by design. */
export const turnstileSiteKey = () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
