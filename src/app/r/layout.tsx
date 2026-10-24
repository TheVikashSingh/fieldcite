import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./report.css";

// Reports are private (SPEC F-2): never indexed, and next.config.ts also sends X-Robots-Tag
// and no-referrer for /r/*, so a share token never leaks to the pages a report links to.
export const metadata: Metadata = {
  title: "Report · FieldCite",
  robots: { index: false, follow: false },
};

export default function ReportLayout({ children }: { children: ReactNode }) {
  return children;
}
