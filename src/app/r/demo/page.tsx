import { DEMO_TOKEN, DemoReportSource } from "../../../report/demo-source";
import { ReportView } from "../../../report/ReportView";
import { loadReportOr404 } from "../../../report/server";

// Built once at build time from the fixtures; it never changes between requests.
export const dynamic = "force-static";

export default async function DemoReportPage() {
  const report = await loadReportOr404(new DemoReportSource(), DEMO_TOKEN);
  return <ReportView report={report} sample />;
}
