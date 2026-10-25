// Storage for free-scan requests (SPEC F-1, CS-11). Postgres in production (pg-store.ts); the
// in-memory version here backs the unit tests of the request checks.

import { randomUUID } from "node:crypto";
import type { Country } from "../engines/types";

export interface NewFreeScanRequest {
  email: string;
  domain: string;
  brandName: string;
  categorySlug: string;
  country: Country;
  competitors: string[];
  ipHash: Buffer;
  createdAt: Date;
}

export interface FreeScanRequestStore {
  /** Requests from this IP since `since` (CS-11: at most 3 per day). */
  countByIpSince(ipHash: Buffer, since: Date): Promise<number>;
  /** Verified requests for this email or domain since `since` (CS-11: 1 per 30 days each). */
  countVerifiedSince(email: string, domain: string, since: Date): Promise<number>;
  /** True while the CS-7 free or total breaker is over its limit at `at`. */
  freeScansPaused(at: Date): Promise<boolean>;
  createRequest(request: NewFreeScanRequest): Promise<string>;
}

export class MemoryFreeScanStore implements FreeScanRequestStore {
  readonly requests: (NewFreeScanRequest & { id: string; verifiedAt: Date | null })[] = [];
  paused = false;

  async countByIpSince(ipHash: Buffer, since: Date): Promise<number> {
    return this.requests.filter((r) => r.ipHash.equals(ipHash) && r.createdAt >= since).length;
  }

  async countVerifiedSince(email: string, domain: string, since: Date): Promise<number> {
    return this.requests.filter((r) => (r.email === email || r.domain === domain) && r.verifiedAt && r.verifiedAt >= since).length;
  }

  async freeScansPaused(): Promise<boolean> {
    return this.paused;
  }

  async createRequest(request: NewFreeScanRequest): Promise<string> {
    const id = randomUUID();
    this.requests.push({ ...request, id, verifiedAt: null });
    return id;
  }
}
