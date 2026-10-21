// Thin wrapper over the credit ledger functions in supabase/migrations (CS-4, CS-5).
// All the rules live in Postgres; this file only calls the functions and maps their errors.
// Server-side only: it needs a service-role connection.

/** Anything with pg's query method: a pg.Pool, pg.Client or pg.PoolClient. */
export interface Queryable {
  query<R extends object = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

export type ScanType = "free" | "paid";
export type FinishStatus = "completed" | "failed" | "cancelled";

export class LedgerError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}
/** CS-4: the balance can't cover the scan's full call budget. */
export class InsufficientCreditsError extends LedgerError {}
/** CS-5: the account already has a running scan. */
export class ScanAlreadyRunningError extends LedgerError {}
/** CS-5: the call budget is outside 1–150. */
export class CallBudgetError extends LedgerError {}
/** The scan has finished (or was never started), so nothing more can be recorded or refunded. */
export class ScanNotRunningError extends LedgerError {}
/** CS-4: the scan tried to record more calls than it reserved. */
export class ReservationExceededError extends LedgerError {}
export class NotFoundError extends LedgerError {}

const ERRORS: Record<string, new (message: string, code: string) => LedgerError> = {
  FC001: InsufficientCreditsError,
  FC002: ScanAlreadyRunningError,
  FC003: CallBudgetError,
  FC004: ScanNotRunningError,
  FC005: ReservationExceededError,
  FC006: NotFoundError,
};

/** Turns a Postgres error from the ledger functions into a typed error; rethrows others. */
export function mapLedgerError(err: unknown): never {
  const e = err as { code?: string; constraint?: string; message?: string };
  // The unique index is the backstop for CS-5 if the function check is ever bypassed.
  if (e?.code === "23505" && e.constraint === "scans_one_running_per_account") {
    throw new ScanAlreadyRunningError(e.message ?? "A scan is already running", "FC002");
  }
  const Ctor = e?.code ? ERRORS[e.code] : undefined;
  if (Ctor) throw new Ctor(e.message ?? e.code!, e.code!);
  throw err;
}

async function call<R extends object>(db: Queryable, text: string, values: unknown[]): Promise<R> {
  try {
    const { rows } = await db.query<R>(text, values);
    return rows[0];
  } catch (err) {
    mapLedgerError(err);
  }
}

export interface Reservation {
  scanId: string;
  balanceAfter: number;
}

/**
 * Starts a scan: reserves `calls` credits and creates a running scan in one transaction.
 * Throws InsufficientCreditsError, ScanAlreadyRunningError or CallBudgetError.
 */
export async function reserveScan(
  db: Queryable,
  input: { accountId: string; type: ScanType; calls: number; categoryId?: string | null; country?: string | null },
): Promise<Reservation> {
  const row = await call<{ scan_id: string; balance_after: number }>(db, "select * from public.reserve_scan($1, $2, $3, $4, $5)", [
    input.accountId,
    input.type,
    input.calls,
    input.categoryId ?? null,
    input.country ?? null,
  ]);
  return { scanId: row.scan_id, balanceAfter: row.balance_after };
}

export interface Settlement {
  callsUsed: number;
  refunded: number;
  /** Null for baseline scans, which have no account. */
  balanceAfter: number | null;
  costUsd: number;
}

/** Ends a running scan and refunds its unused calls. Finishing twice throws ScanNotRunningError. */
export async function finishScan(db: Queryable, scanId: string, status: FinishStatus = "completed"): Promise<Settlement> {
  const row = await call<{ calls_used: number; refunded: number; balance_after: number | null; cost_usd: string }>(
    db,
    "select * from public.finish_scan($1, $2)",
    [scanId, status],
  );
  return { callsUsed: row.calls_used, refunded: row.refunded, balanceAfter: row.balance_after, costUsd: Number(row.cost_usd) };
}

/** Adds credits (reason "grant") or corrects a balance (reason "adjust", may be negative). */
export async function grantCredits(db: Queryable, accountId: string, amount: number, reason: "grant" | "adjust" = "grant"): Promise<number> {
  const row = await call<{ balance: number }>(db, "select public.grant_credits($1, $2, $3) as balance", [accountId, amount, reason]);
  return row.balance;
}

export async function getBalance(db: Queryable, accountId: string): Promise<number> {
  const row = await call<{ credit_balance: number }>(db, "select credit_balance from public.accounts where id = $1", [accountId]);
  if (!row) throw new NotFoundError(`account ${accountId} not found`, "FC006");
  return row.credit_balance;
}
