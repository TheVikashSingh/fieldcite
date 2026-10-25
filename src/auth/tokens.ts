// One-time tokens for emailed links. Only the SHA-256 hash is stored, so a database read can't be
// turned into working links.

import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes as base64url: 43 characters, 256 bits. */
export const newToken = () => randomBytes(32).toString("base64url");

export const isToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

export const hashToken = (token: string): Buffer => createHash("sha256").update(token, "utf8").digest();

/** Lowercases and trims an address, or returns null when it isn't a plausible email. */
export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;
  // Deliberately simple: one @, a dot in the domain, no spaces. The emailed link is the real check.
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) ? email : null;
}
