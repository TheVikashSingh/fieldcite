import { NextResponse, type NextRequest } from "next/server";
import { endSession } from "../../../auth/server";
import { isSameOrigin } from "../../../server/origin";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers, request.url)) return new NextResponse("Forbidden", { status: 403 });
  await endSession();
  return NextResponse.redirect(new URL("/", request.url), 303);
}
