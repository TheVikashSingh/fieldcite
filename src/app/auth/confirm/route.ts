import { after, NextResponse, type NextRequest } from "next/server";
import { confirmMagicLink, safeNextPath } from "../../../auth/magic-link";
import { magicLinkDeps, startSession } from "../../../auth/server";
import { confirmFreeScan } from "../../../freescan/confirm";
import { runFreeScan } from "../../../freescan/run";
import { freeScanStore, runFreeScanDeps } from "../../../freescan/server";
import { isSameOrigin } from "../../../server/origin";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers, request.url)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const deps = magicLinkDeps();
  const link = deps ? await confirmMagicLink(deps, String(form.get("token") ?? "")) : null;
  // Unknown, used and expired links all get the same answer.
  if (!link) return NextResponse.redirect(new URL("/login?error=expired", request.url), 303);
  // A confirmed link proves the address, so it also signs the person in (F-9).
  await startSession({ userId: link.userId, email: link.email });

  if (link.purpose === "free_scan") {
    const store = freeScanStore();
    const runDeps = runFreeScanDeps();
    const started = store && runDeps ? await confirmFreeScan(store, link) : ({ ok: false, reason: "not_found" } as const);
    if (!started.ok) return NextResponse.redirect(new URL(`/?error=${started.reason}#free-scan`, request.url), 303);
    // Runs after the response is sent. A job runner replaces this in a later week (ACTION_PLAN).
    after(() => runFreeScan(runDeps!, started));
    return NextResponse.redirect(new URL(`/scan/${started.reportToken}`, request.url), 303);
  }
  return NextResponse.redirect(new URL(safeNextPath(link.payload.next), request.url), 303);
}
