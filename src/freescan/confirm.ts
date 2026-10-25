// Turns a confirmed free-scan link into a running scan (SPEC F-1). The emailed link is the
// "verified email" of CS-11; the scan only starts here, never at form submission.

import type { ConfirmedLink } from "../auth/magic-link";
import { newShareToken, shareTokenHash } from "../report/pg-source";
import type { PgFreeScanStore, StartResult } from "./pg-store";

export type ConfirmFreeScanResult =
  | { ok: true; requestId: string; scanId: string; reportToken: string }
  | { ok: false; reason: Exclude<StartResult, { ok: true }>["reason"] };

export async function confirmFreeScan(store: PgFreeScanStore, link: ConfirmedLink, at: Date = new Date()): Promise<ConfirmFreeScanResult> {
  const requestId = typeof link.payload.requestId === "string" ? link.payload.requestId : null;
  if (link.purpose !== "free_scan" || !requestId) return { ok: false, reason: "not_found" };
  // The status page and the report share this token: /scan/<token> while it runs, /r/<token> after.
  const reportToken = newShareToken();
  const started = await store.verifyAndStart({ requestId, email: link.email, accountId: link.accountId, reportTokenHash: shareTokenHash(reportToken), at });
  if (!started.ok) return started;
  return { ok: true, requestId: started.scan.requestId, scanId: started.scan.scanId, reportToken };
}
