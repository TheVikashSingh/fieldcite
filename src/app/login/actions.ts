"use server";

import { redirect } from "next/navigation";
import { safeNextPath, sendMagicLink } from "../../auth/magic-link";
import { magicLinkDeps } from "../../auth/server";
import { normalizeEmail } from "../../auth/tokens";

export async function requestLogin(formData: FormData): Promise<void> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const next = safeNextPath(formData.get("next"));
  if (!email) redirect(`/login?error=email&next=${encodeURIComponent(next)}`);
  const deps = magicLinkDeps();
  if (!deps) redirect("/login?error=unavailable");
  // Same page whether the link was sent or rate-limited, so it never reveals anything about an address.
  await sendMagicLink(deps, { email, purpose: "login", payload: { next } });
  redirect("/login?sent=1");
}
