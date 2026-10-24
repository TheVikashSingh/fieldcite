// Where the report page gets its ScanReport from (SPEC F-2). The page only sees this interface,
// so the share-link lookup (Postgres) and the sample report (fixtures) render the same way.

import type { ScanReport } from "../scan/report";

export interface ReportSource {
  /** The report behind a share token, or null when there is none. Callers answer null with a 404. */
  get(token: string): Promise<ScanReport | null>;
}

/** Drops raw provider payloads: they are large, kept in the answers table (M-1), and never shown. */
export function withoutRaw(report: ScanReport): ScanReport {
  return { ...report, calls: report.calls.map((call) => ({ ...call, raw: undefined })) };
}
