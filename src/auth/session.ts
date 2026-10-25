// Signed session cookie (SPEC F-9). The value is `v1.<payload>.<signature>`: a base64url JSON
// payload and its HMAC-SHA256 under AUTH_SECRET. Nothing secret is in the payload.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "fc_session";
export const SESSION_DAYS = 30;
const MIN_SECRET_LENGTH = 32;

export interface Session {
  userId: string;
  email: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

export function authSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.AUTH_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigError(`AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters (see .env.example).`);
  }
  return secret;
}

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(`v1.${payload}`).digest("base64url");

export function encodeSession(session: Omit<Session, "exp">, secret: string, now: Date = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const payload = Buffer.from(JSON.stringify({ u: session.userId, e: session.email, exp }), "utf8").toString("base64url");
  return `v1.${payload}.${sign(payload, secret)}`;
}

/** The session in a cookie value, or null if it is missing, tampered with or expired. */
export function decodeSession(value: string | undefined, secret: string, now: Date = new Date()): Session | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, payload, signature] = parts;
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown; e?: unknown; exp?: unknown };
    if (typeof data.u !== "string" || typeof data.e !== "string" || typeof data.exp !== "number") return null;
    if (data.exp <= Math.floor(now.getTime() / 1000)) return null;
    return { userId: data.u, email: data.e, exp: data.exp };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  secure,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
});
