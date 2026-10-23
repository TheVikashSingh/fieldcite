// Global circuit breakers (CS-7). The rules live in Postgres (check_breakers in
// supabase/migrations); this file asks before every engine call and sends each trip to the owner.

import { assertScansEnabled, type Env } from "../engines/guard";
import { mapLedgerError, type Queryable } from "../ledger";
import type { CallGate } from "../scan/run";
import type { Notifier, OwnerMessage } from "./notifier";

export type BreakerId = "free_daily" | "total_daily" | "baseline_monthly";

const DESCRIPTIONS: Record<BreakerId, string> = {
  free_daily: "Free-scan spend today reached its daily limit. Free scans are paused until 00:00 UTC.",
  total_daily: "Total spend today reached its daily limit. Everything except paid scans already running is paused until 00:00 UTC.",
  baseline_monthly: "Baseline spend this month is $60 or more above forecast. Baseline scans are paused until the 1st.",
};

export class BreakerTrippedError extends Error {
  constructor(readonly breaker: BreakerId) {
    super(`Circuit breaker ${breaker} is tripped (CS-7). ${DESCRIPTIONS[breaker]}`);
    this.name = "BreakerTrippedError";
  }
}

export interface BreakerTrip {
  breaker: BreakerId;
  /** First day of the period the trip covers (the day, or the month for baseline_monthly). */
  periodStart: string;
  trippedAt: Date;
  spendUsd: number;
  limitUsd: number;
}

export interface BreakerState {
  breaker: BreakerId;
  periodStart: string;
  spendUsd: number;
  limitUsd: number;
  tripped: boolean;
  trippedAt: Date | null;
}

interface TripRow {
  breaker: BreakerId;
  period_start: string;
  tripped_at: Date;
  spend_usd: string;
  limit_usd: string;
}

const toTrip = (r: TripRow): BreakerTrip => ({
  breaker: r.breaker,
  periodStart: r.period_start,
  trippedAt: r.tripped_at,
  spendUsd: Number(r.spend_usd),
  limitUsd: Number(r.limit_usd),
});

/** The breaker blocking this scan's next call at `at`, or null if the call may go ahead. */
export async function checkBreakers(db: Queryable, scanId: string, at: Date = new Date()): Promise<BreakerId | null> {
  try {
    const { rows } = await db.query<{ blocked: BreakerId | null }>("select public.check_breakers($1, $2) as blocked", [scanId, at]);
    return rows[0].blocked;
  } catch (err) {
    mapLedgerError(err);
  }
}

/** Trips in the current periods that no one has notified yet. Each trip is returned once. */
export async function claimTripNotifications(db: Queryable, at: Date = new Date()): Promise<BreakerTrip[]> {
  // Dates as text: pg would turn them into local-time Date objects.
  const { rows } = await db.query<TripRow>(
    "select breaker, period_start::text, tripped_at, spend_usd, limit_usd from public.claim_breaker_notifications($1) order by tripped_at",
    [at],
  );
  return rows.map(toTrip);
}

/** The breaker_status view: every breaker's spend, limit and state right now. */
export async function breakerStatus(db: Queryable): Promise<BreakerState[]> {
  const { rows } = await db.query<TripRow & { tripped: boolean; tripped_at: Date | null }>(
    "select breaker, period_start::text, spend_usd, limit_usd, tripped, tripped_at from public.breaker_status order by breaker",
  );
  return rows.map((r) => ({
    breaker: r.breaker,
    periodStart: r.period_start,
    spendUsd: Number(r.spend_usd),
    limitUsd: Number(r.limit_usd),
    tripped: r.tripped,
    trippedAt: r.tripped_at,
  }));
}

export function tripMessage(trip: BreakerTrip): OwnerMessage {
  return {
    subject: `FieldCite: circuit breaker ${trip.breaker} tripped`,
    text: [
      DESCRIPTIONS[trip.breaker],
      "",
      `Spend: $${trip.spendUsd.toFixed(2)} (limit $${trip.limitUsd.toFixed(2)})`,
      `Period starting: ${trip.periodStart}`,
      `Tripped at: ${trip.trippedAt.toISOString()}`,
      "",
      "To stop every engine call now, set SCANS_ENABLED=false (CS-8).",
    ].join("\n"),
  };
}

/**
 * The gate runScan calls before every engine call: the kill switch (CS-8), then the breakers
 * (CS-7). New trips go to the notifier first, so the owner hears about a trip even when it
 * stops this very scan.
 */
export class PgCallGate implements CallGate {
  constructor(
    private readonly db: Queryable,
    private readonly scanId: string,
    private readonly notifier: Notifier,
    private readonly opts: { env?: Env; onNotifyError?: (err: unknown) => void } = {},
  ) {}

  async beforeCall({ at }: { at: Date }): Promise<void> {
    assertScansEnabled(this.opts.env ?? process.env);
    const blocked = await checkBreakers(this.db, this.scanId, at);
    for (const trip of await claimTripNotifications(this.db, at)) {
      try {
        await this.notifier.notify(tripMessage(trip));
      } catch (err) {
        // A failed message must not change the decision. The trip stays visible in breaker_status.
        (this.opts.onNotifyError ?? ((e) => console.error("Breaker notification failed:", e)))(err);
      }
    }
    if (blocked) throw new BreakerTrippedError(blocked);
  }
}
