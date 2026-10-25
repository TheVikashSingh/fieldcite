import { NextResponse, type NextRequest } from "next/server";
import { confirmMagicLink, safeNextPath } from "../../../auth/magic-link";
import { magicLinkDeps, startSession } from "../../../auth/server";
import { isSameOrigin } from "../../../server/origin";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers, request.url)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const deps = magicLinkDeps();
  const link = deps ? await confirmMagicLink(deps, String(form.get("token") ?? "")) : null;
  // Unknown, used and expired links all get the same answer.
  if (!link) return NextResponse.redirect(new URL("/login?error=expired", request.url), 303);
  await startSession({ userId: link.userId, email: link.email });
  return NextResponse.redirect(new URL(safeNextPath(link.payload.next), request.url), 303);
}
