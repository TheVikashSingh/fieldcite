// Storage for magic links, users and their accounts. Postgres in production (pg-store.ts);
// the in-memory version here backs unit tests.

import { randomUUID } from "node:crypto";

export type LinkPurpose = "login" | "free_scan";

export interface NewMagicLink {
  tokenHash: Buffer;
  email: string;
  purpose: LinkPurpose;
  payload: Record<string, unknown>;
  expiresAt: Date;
  createdAt: Date;
}

export interface ConsumedLink {
  email: string;
  purpose: LinkPurpose;
  payload: Record<string, unknown>;
}

export interface AuthStore {
  createLink(link: NewMagicLink): Promise<void>;
  /** Links created for `email` (any purpose) since `since`, for rate limiting. */
  countLinksSince(email: string, since: Date): Promise<number>;
  /** Marks an unused, unexpired link used and returns it; null otherwise. Atomic: a link works once. */
  consumeLink(tokenHash: Buffer, at: Date): Promise<ConsumedLink | null>;
  /** Creates the user on first sign-in and marks the email verified. Returns the user id. */
  upsertVerifiedUser(email: string, at: Date): Promise<string>;
  /** The user's account, created on first sign-in (1 user per account, F-9). Returns the account id. */
  ensureAccount(userId: string, email: string): Promise<string>;
}

export class MemoryAuthStore implements AuthStore {
  readonly links: (NewMagicLink & { usedAt: Date | null })[] = [];
  readonly users = new Map<string, { id: string; verifiedAt: Date; lastLoginAt: Date }>();
  readonly accounts = new Map<string, { id: string; email: string }>();

  async createLink(link: NewMagicLink): Promise<void> {
    this.links.push({ ...link, usedAt: null });
  }

  async countLinksSince(email: string, since: Date): Promise<number> {
    return this.links.filter((l) => l.email === email && l.createdAt >= since).length;
  }

  async consumeLink(tokenHash: Buffer, at: Date): Promise<ConsumedLink | null> {
    const link = this.links.find((l) => l.tokenHash.equals(tokenHash));
    if (!link || link.usedAt || link.expiresAt <= at) return null;
    link.usedAt = at;
    return { email: link.email, purpose: link.purpose, payload: link.payload };
  }

  async upsertVerifiedUser(email: string, at: Date): Promise<string> {
    const user = this.users.get(email) ?? { id: randomUUID(), verifiedAt: at, lastLoginAt: at };
    user.lastLoginAt = at;
    this.users.set(email, user);
    return user.id;
  }

  async ensureAccount(userId: string, email: string): Promise<string> {
    const account = this.accounts.get(userId) ?? { id: randomUUID(), email };
    this.accounts.set(userId, account);
    return account.id;
  }
}
