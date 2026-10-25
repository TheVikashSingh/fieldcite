// Server wiring for login (SPEC F-9): reads and writes the session cookie and builds the
// magic-link dependencies. Server-side only.

import "server-only";
import { cookies } from "next/headers";
import { mailerFromEnv } from "../email/mailer";
import { appUrl, getDb } from "../server/db";
import type { MagicLinkDeps } from "./magic-link";
import { PgAuthStore } from "./pg-store";
import { authSecret, decodeSession, encodeSession, SESSION_COOKIE, sessionCookieOptions, type Session } from "./session";

/** Magic-link dependencies, or null when login isn't configured (no database). */
export function magicLinkDeps(): MagicLinkDeps | null {
  const db = getDb();
  if (!db) return null;
  return { store: new PgAuthStore(db), mailer: mailerFromEnv(), baseUrl: appUrl() };
}

export async function getSession(): Promise<Session | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  return decodeSession(value, authSecret());
}

export async function startSession(user: { userId: string; email: string }): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, encodeSession(user, authSecret()), sessionCookieOptions(process.env.NODE_ENV === "production"));
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
