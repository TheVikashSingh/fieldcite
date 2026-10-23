// Daily spend summary for the owner (CS-9, CS-13): spend by engine, by account, the top 5
// accounts, and alerts at 50/80/100% of the monthly forecast. Days are UTC.

import type { EngineId } from "../engines/types";
import type { Queryable } from "../ledger";
import type { Notifier, OwnerMessage } from "./notifier";

export const FORECAST_ALERT_LEVELS = [50, 80, 100] as const;
export type ForecastAlertLevel = (typeof FORECAST_ALERT_LEVELS)[number];

export interface AccountSpend {
  /** Null for internal baseline scans. */
  accountId: string | null;
  email: string | null;
  usd: number;
  calls: number;
}

export interface DailySpend {
  /** YYYY-MM-DD (UTC). */
  day: string;
  totalUsd: number;
  calls: number;
  cacheHits: number;
  byEngine: { engine: EngineId; usd: number }[];
  byScope: { scope: "free" | "paid" | "baseline"; usd: number }[];
  /** Highest spend first. */
  byAccount: AccountSpend[];
  /** From the 1st of the month to the end of `day`. */
  monthToDateUsd: number;
  monthlyForecastUsd: number;
  /** Breakers that tripped on `day`. */
  trips: { breaker: string; trippedAt: Date }[];
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** Every alert level month-to-date spend has reached (CS-13). */
export function forecastAlerts(monthToDateUsd: number, monthlyForecastUsd: number): ForecastAlertLevel[] {
  // Compared in cents so $40.00 of a $50 forecast is exactly 80%.
  const spent = Math.round(monthToDateUsd * 100);
  return FORECAST_ALERT_LEVELS.filter((level) => spent * 100 >= Math.round(monthlyForecastUsd * 100) * level);
}

function accountLabel(a: AccountSpend): string {
  return a.accountId ? `${a.email ?? "(no email)"} (${a.accountId})` : "Baseline scans (internal)";
}

const MAX_ACCOUNT_LINES = 100;

export function buildDailySpendMessage(data: DailySpend): OwnerMessage {
  const alerts = forecastAlerts(data.monthToDateUsd, data.monthlyForecastUsd);
  const pct = data.monthlyForecastUsd > 0 ? Math.round((data.monthToDateUsd / data.monthlyForecastUsd) * 100) : 0;
  const lines: string[] = [];

  if (alerts.length) {
    const top = alerts[alerts.length - 1];
    lines.push(
      top === 100
        ? `ALERT: month-to-date spend has reached 100% of the monthly forecast (${money(data.monthToDateUsd)} of ${money(data.monthlyForecastUsd)}).`
        : `Alert: month-to-date spend has passed ${top}% of the monthly forecast (${money(data.monthToDateUsd)} of ${money(data.monthlyForecastUsd)}).`,
      "",
    );
  }
  if (data.trips.length) {
    lines.push("Circuit breakers tripped today:", ...data.trips.map((t) => `  ${t.breaker} at ${t.trippedAt.toISOString()}`), "");
  }

  lines.push(
    `Spend on ${data.day}: ${money(data.totalUsd)} over ${data.calls} calls (${data.cacheHits} cache hits at $0).`,
    `Month to date: ${money(data.monthToDateUsd)} of ${money(data.monthlyForecastUsd)} forecast (${pct}%).`,
    "",
    "By engine:",
    ...(data.byEngine.length ? data.byEngine.map((e) => `  ${e.engine}: ${money(e.usd)}`) : ["  none"]),
    "",
    "By scan type:",
    ...(data.byScope.length ? data.byScope.map((s) => `  ${s.scope}: ${money(s.usd)}`) : ["  none"]),
    "",
    "Top 5 accounts by spend:",
    ...(data.byAccount.length ? data.byAccount.slice(0, 5).map((a, i) => `  ${i + 1}. ${accountLabel(a)}: ${money(a.usd)}`) : ["  none"]),
    "",
    `By account (${data.byAccount.length}):`,
    ...data.byAccount.slice(0, MAX_ACCOUNT_LINES).map((a) => `  ${accountLabel(a)}: ${money(a.usd)} over ${a.calls} calls`),
  );
  if (data.byAccount.length > MAX_ACCOUNT_LINES) lines.push(`  ...and ${data.byAccount.length - MAX_ACCOUNT_LINES} more`);

  const flag = alerts.length ? ` [${alerts[alerts.length - 1]}% of forecast]` : "";
  return { subject: `FieldCite spend ${data.day}: ${money(data.totalUsd)}${flag}`, text: lines.join("\n") };
}

export async function loadDailySpend(db: Queryable, day: string): Promise<DailySpend> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`day must be YYYY-MM-DD, got "${day}"`);
  const [engines, scopes, accounts, totals, month, trips] = await Promise.all([
    db.query<{ engine: EngineId; usd: string }>(
      "select engine, sum(usd) as usd from public.spend_daily where day = $1::date group by engine order by sum(usd) desc, engine",
      [day],
    ),
    db.query<{ scope: "free" | "paid" | "baseline"; usd: string }>(
      "select scope, sum(usd) as usd from public.spend_daily where day = $1::date group by scope order by sum(usd) desc, scope",
      [day],
    ),
    db.query<{ account_id: string | null; email: string | null; usd: string; calls: number }>(
      `select s.account_id, a.email, sum(ec.cost_usd) as usd, count(*)::int as calls
         from public.engine_calls ec
         join public.scans s on s.id = ec.scan_id
         left join public.accounts a on a.id = s.account_id
        where ec.created_at >= ($1::date at time zone 'UTC') and ec.created_at < (($1::date + 1) at time zone 'UTC')
        group by s.account_id, a.email
        order by sum(ec.cost_usd) desc, count(*) desc`,
      [day],
    ),
    db.query<{ calls: number; cache_hits: number }>(
      `select count(*)::int as calls, count(*) filter (where cache_hit)::int as cache_hits
         from public.engine_calls
        where created_at >= ($1::date at time zone 'UTC') and created_at < (($1::date + 1) at time zone 'UTC')`,
      [day],
    ),
    db.query<{ usd: string; forecast: string }>(
      `select coalesce((select sum(usd) from public.spend_daily
                         where day >= date_trunc('month', $1::date)::date and day <= $1::date), 0) as usd,
              (select monthly_forecast_usd from public.cost_settings) as forecast`,
      [day],
    ),
    db.query<{ breaker: string; tripped_at: Date }>(
      `select breaker, tripped_at from public.breaker_trips
        where tripped_at >= ($1::date at time zone 'UTC') and tripped_at < (($1::date + 1) at time zone 'UTC')
        order by tripped_at`,
      [day],
    ),
  ]);
  const byEngine = engines.rows.map((r) => ({ engine: r.engine, usd: Number(r.usd) }));
  return {
    day,
    totalUsd: byEngine.reduce((s, e) => s + e.usd, 0),
    calls: totals.rows[0].calls,
    cacheHits: totals.rows[0].cache_hits,
    byEngine,
    byScope: scopes.rows.map((r) => ({ scope: r.scope, usd: Number(r.usd) })),
    byAccount: accounts.rows.map((r) => ({ accountId: r.account_id, email: r.email, usd: Number(r.usd), calls: r.calls })),
    monthToDateUsd: Number(month.rows[0].usd),
    monthlyForecastUsd: Number(month.rows[0].forecast),
    trips: trips.rows.map((r) => ({ breaker: r.breaker, trippedAt: r.tripped_at })),
  };
}

/** Builds the summary for `day` and hands it to the notifier. Sending email comes later. */
export async function sendDailySpendSummary(db: Queryable, notifier: Notifier, day: string): Promise<OwnerMessage> {
  const message = buildDailySpendMessage(await loadDailySpend(db, day));
  await notifier.notify(message);
  return message;
}
