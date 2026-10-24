import { ReportView } from "../../../report/ReportView";
import { loadReportOr404, shareLinkSource } from "../../../report/server";

// Looked up on every request: share links can be revoked.
export const dynamic = "force-dynamic";

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await loadReportOr404(shareLinkSource(), token);
  return <ReportView report={report} />;
}
