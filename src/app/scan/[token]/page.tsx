import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { freeScanStore } from "../../../freescan/server";
import { isShareToken, shareTokenHash } from "../../../report/pg-source";

export const metadata: Metadata = { title: "Your scan · FieldCite", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Shown while a free scan runs. The token is the report's share token: once the report is
// stored, this page sends the visitor to /r/<token>.
export default async function ScanStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const store = isShareToken(token) ? freeScanStore() : null;
  const progress = store ? await store.progressByToken(shareTokenHash(token)) : null;
  if (!progress) notFound();
  if (progress.hasReport) redirect(`/r/${token}`);

  if (progress.status === "failed" || progress.status === "rejected") {
    return (
      <main className="site-narrow">
        <h1>We couldn&apos;t finish your scan</h1>
        <p>Something went wrong while asking the AI engines. Unused calls were not charged. Please request a new free scan from the home page.</p>
      </main>
    );
  }

  return (
    <main className="site-narrow">
      {/* Reloads every 3 seconds until the report is ready. */}
      <meta httpEquiv="refresh" content="3" />
      <h1>Your scan is running</h1>
      <p role="status">
        {progress.callsUsed} of {progress.callsReserved} answers collected. This page opens your report as soon as it&apos;s ready, usually within two
        minutes. We&apos;ll also email you the link.
      </p>
      <progress max={progress.callsReserved} value={progress.callsUsed} style={{ width: "100%" }} />
    </main>
  );
}
